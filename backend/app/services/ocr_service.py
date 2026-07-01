"""
==========================================================================
 DỊCH VỤ AI OCR — BÓC TÁCH DỮ LIỆU HÓA ĐƠN TỪ ẢNH
==========================================================================
Đầu vào : bytes ảnh + mime type.
Đầu ra  : OcrResult (Tên NCC, MST, Số HĐ, Ngày, Tiền trước VAT, VAT, Tổng).

Hỗ trợ 3 chế độ qua biến môi trường OCR_PROVIDER:
  - "openai" : dùng GPT-4o Vision (chính xác nhất với hóa đơn tiếng Việt).
  - "google" : dùng Google Cloud Vision (text detection) + regex bóc tách.
  - "mock"   : sinh dữ liệu mẫu để chạy demo end-to-end mà KHÔNG cần API key.
==========================================================================
"""
import base64
import json
import random
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import httpx

from app.config import settings
from app.schemas import OcrResult


# --------------------------------------------------------------------------
# HÀM CÔNG KHAI — router chỉ cần gọi extract_invoice(...)
# --------------------------------------------------------------------------
async def extract_invoice(image_bytes: bytes, mime_type: str = "image/jpeg") -> OcrResult:
    """Chọn nhà cung cấp OCR theo cấu hình và trả về dữ liệu chuẩn hóa.

    QUAN TRỌNG (toàn vẹn số liệu): KHI DÙNG THẬT tuyệt đối KHÔNG bịa số. Nếu AI lỗi
    hoặc chưa cấu hình khóa -> trả kết quả TRỐNG (số = 0) để kế toán nhập tay, thay vì
    sinh số ngẫu nhiên. Dữ liệu demo ngẫu nhiên CHỈ chạy khi OCR_PROVIDER == "mock".
    """
    provider = settings.OCR_PROVIDER.lower()
    if provider == "openai" and settings.OPENAI_API_KEY:
        try:
            return await _extract_openai(image_bytes, mime_type)
        except Exception as exc:  # noqa: BLE001 — không để AI lỗi làm sập upload
            print(f"[OCR] Lỗi OpenAI: {exc}. Trả kết quả TRỐNG để kế toán nhập tay.")
            return _empty_result()
    if provider == "google" and settings.GOOGLE_VISION_API_KEY:
        try:
            return await _extract_google(image_bytes)
        except Exception as exc:  # noqa: BLE001
            print(f"[OCR] Lỗi Google Vision: {exc}. Trả kết quả TRỐNG để nhập tay.")
            return _empty_result()
    if provider == "mock":
        return _extract_mock()   # CHỈ chế độ demo mới sinh dữ liệu ngẫu nhiên
    # Chọn provider thật nhưng THIẾU API key -> để trống (KHÔNG bịa số).
    print(f"[OCR] Provider '{provider}' chưa có API key -> trả kết quả trống (nhập tay).")
    return _empty_result()


def _empty_result() -> OcrResult:
    """Không đọc được -> để trống cho kế toán nhập tay (KHÔNG bịa số tiền)."""
    return OcrResult(confidence=Decimal(0))


# --------------------------------------------------------------------------
# 1) OPENAI GPT-4o VISION
# --------------------------------------------------------------------------
_PROMPT = (
    "Bạn là hệ thống bóc tách hóa đơn GTGT Việt Nam. Hãy đọc ảnh hóa đơn và "
    "TRẢ VỀ DUY NHẤT một object JSON (không kèm giải thích, không markdown) với "
    "các khóa: supplier_name (tên người bán), supplier_tax_code (mã số thuế, chỉ "
    "chữ số), invoice_number (số hóa đơn), invoice_date (YYYY-MM-DD), "
    "amount_no_vat (tiền hàng trước thuế, số), vat_amount (tiền thuế GTGT, số), "
    "total_amount (tổng thanh toán, số), category (đoán hạng mục chi phí: vật tư, "
    "nhiên liệu, nhân công, thiết bị, vận chuyển, khác). Nếu không đọc được trường "
    "nào thì để null hoặc 0."
)


async def _extract_openai(image_bytes: bytes, mime_type: str) -> OcrResult:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = {
        "model": settings.OPENAI_VISION_MODEL,
        "messages": [
            {"role": "system", "content": _PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Bóc tách hóa đơn trong ảnh sau."},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{b64}"},
                    },
                ],
            },
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 800,
        "temperature": 0,
    }
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            json=payload, headers=headers,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
    data = json.loads(content)
    return _to_result(data, default_confidence=Decimal("95"))


# --------------------------------------------------------------------------
# 2) GOOGLE CLOUD VISION (text detection) + regex bóc tách
# --------------------------------------------------------------------------
async def _extract_google(image_bytes: bytes) -> OcrResult:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    url = f"https://vision.googleapis.com/v1/images:annotate?key={settings.GOOGLE_VISION_API_KEY}"
    body = {
        "requests": [{
            "image": {"content": b64},
            "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
        }]
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=body)
        resp.raise_for_status()
        ann = resp.json()["responses"][0]
    full_text = ann.get("fullTextAnnotation", {}).get("text", "")
    return _parse_vietnamese_invoice_text(full_text)


def _parse_vietnamese_invoice_text(text: str) -> OcrResult:
    """Bóc tách thô từ text OCR bằng các mẫu thường gặp trên hóa đơn VN."""
    result = OcrResult(confidence=Decimal("75"))

    # MST: 10 hoặc 13 chữ số (có thể có dấu gạch)
    mst = re.search(r"(?:MST|Mã số thuế)[:\s]*([\d\-]{10,15})", text, re.IGNORECASE)
    if mst:
        result.supplier_tax_code = re.sub(r"\D", "", mst.group(1))

    # Tổng tiền thanh toán
    total = re.search(
        r"(?:Tổng cộng thanh toán|Tổng thanh toán|Tổng cộng)[:\s]*([\d\.\,]+)",
        text, re.IGNORECASE,
    )
    if total:
        result.total_amount = _money(total.group(1))

    # Tiền thuế GTGT
    vat = re.search(r"(?:Tiền thuế GTGT|Thuế GTGT)[:\s]*([\d\.\,]+)", text, re.IGNORECASE)
    if vat:
        result.vat_amount = _money(vat.group(1))

    # Ngày hóa đơn dd/mm/yyyy
    d = re.search(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", text)
    if d:
        try:
            result.invoice_date = date(int(d.group(3)), int(d.group(2)), int(d.group(1)))
        except ValueError:
            pass

    if result.total_amount and result.vat_amount:
        result.amount_no_vat = result.total_amount - result.vat_amount
    return result


# --------------------------------------------------------------------------
# 3) MOCK — dữ liệu mẫu để demo
# --------------------------------------------------------------------------
_SUPPLIERS = [
    ("Công ty TNHH Vật tư Xây dựng Hòa Phát", "0301234567", "vật tư"),
    ("Công ty CP Bê tông Thăng Long", "0312345678", "vật tư"),
    ("DNTN Xăng dầu Petrolimex CN5", "0109876543", "nhiên liệu"),
    ("Công ty TNHH Cho thuê Thiết bị Đông Đô", "0105556677", "thiết bị"),
    ("Công ty CP Vận tải Sông Hồng", "0107778899", "vận chuyển"),
]


def _extract_mock() -> OcrResult:
    name, mst, cat = random.choice(_SUPPLIERS)
    amount = Decimal(random.randint(5, 250)) * Decimal(1_000_000)
    vat = (amount * Decimal("0.1")).quantize(Decimal("1"))
    return OcrResult(
        supplier_name=name,
        supplier_tax_code=mst,
        invoice_number=f"{random.randint(1, 9)}C{random.randint(10,99)}TYY/{random.randint(1000,9999)}",
        invoice_date=date.today(),
        amount_no_vat=amount,
        vat_amount=vat,
        total_amount=amount + vat,
        category=cat,
        confidence=Decimal("88"),
    )


# --------------------------------------------------------------------------
# Tiện ích chung
# --------------------------------------------------------------------------
def _money(s: str) -> Decimal:
    """Chuyển '12.345.678' hoặc '12,345,678' -> Decimal."""
    cleaned = re.sub(r"[^\d]", "", s or "")
    try:
        return Decimal(cleaned) if cleaned else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


def _to_result(data: dict, default_confidence: Decimal) -> OcrResult:
    """Chuẩn hóa dict JSON (từ LLM) thành OcrResult an toàn kiểu dữ liệu."""
    def dec(v) -> Decimal:
        if v in (None, "", "null"):
            return Decimal(0)
        try:
            return Decimal(str(v).replace(",", ""))
        except (InvalidOperation, ValueError):
            return Decimal(0)

    inv_date = None
    raw_date = data.get("invoice_date")
    if raw_date:
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                inv_date = datetime.strptime(str(raw_date), fmt).date()
                break
            except ValueError:
                continue

    return OcrResult(
        supplier_name=data.get("supplier_name") or None,
        supplier_tax_code=(re.sub(r"\D", "", str(data["supplier_tax_code"]))
                           if data.get("supplier_tax_code") else None),
        invoice_number=data.get("invoice_number") or None,
        invoice_date=inv_date,
        amount_no_vat=dec(data.get("amount_no_vat")),
        vat_amount=dec(data.get("vat_amount")),
        total_amount=dec(data.get("total_amount")),
        category=data.get("category") or None,
        confidence=default_confidence,
    )
