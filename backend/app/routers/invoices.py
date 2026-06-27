"""
==========================================================================
 ROUTER QUẢN LÝ HÓA ĐƠN (tích hợp AI OCR) — TÍNH NĂNG LÕI
==========================================================================
Luồng:
  1) Cán bộ hiện trường POST ảnh hóa đơn -> /invoices/upload
  2) Lưu ảnh vào ổ đĩa, gọi dịch vụ AI bóc tách dữ liệu.
  3) Tạo bản ghi Invoice trạng thái EXTRACTED (chờ kế toán duyệt).
  4) Kế toán PATCH chỉnh sửa nếu cần rồi /verify -> tính vào chi phí.
==========================================================================
"""
import os
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import ActivityLog, Invoice, InvoiceStatus, User, UserRole
from app.schemas import InvoiceOut, InvoiceUpdate
from app.services.ocr_service import extract_invoice

router = APIRouter(prefix="/invoices", tags=["Hóa đơn (AI)"])

_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


@router.post("/upload", response_model=InvoiceOut, status_code=201)
async def upload_invoice(
    file: UploadFile = File(..., description="Ảnh hóa đơn chụp từ hiện trường"),
    project_id: int | None = Form(None),
    contract_id: int | None = Form(None),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Nhận ảnh hóa đơn, chạy AI OCR và lưu kết quả."""
    if file.content_type not in _ALLOWED_MIME:
        raise HTTPException(415, "Định dạng tệp không hỗ trợ (chỉ JPG/PNG/WEBP/PDF).")

    raw = await file.read()
    size_mb = len(raw) / (1024 * 1024)
    if size_mb > settings.MAX_UPLOAD_MB:
        raise HTTPException(413, f"Tệp vượt quá {settings.MAX_UPLOAD_MB}MB.")

    # --- Lưu ảnh vào ổ đĩa (production nên đẩy lên S3/Cloud Storage) ---
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1] or ".jpg"
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(settings.UPLOAD_DIR, stored_name)
    with open(stored_path, "wb") as f:
        f.write(raw)

    # --- Gọi AI bóc tách ---
    ocr = await extract_invoice(raw, file.content_type)

    invoice = Invoice(
        company_id=current.company_id,
        project_id=project_id,
        contract_id=contract_id,
        uploaded_by_id=current.id,
        image_url=f"/static/{stored_name}",
        original_filename=file.filename,
        supplier_name=ocr.supplier_name,
        supplier_tax_code=ocr.supplier_tax_code,
        invoice_number=ocr.invoice_number,
        invoice_date=ocr.invoice_date,
        amount_no_vat=ocr.amount_no_vat,
        vat_amount=ocr.vat_amount,
        total_amount=ocr.total_amount,
        category=ocr.category,
        ocr_confidence=ocr.confidence,
        ocr_raw=ocr.model_dump(mode="json"),
        status=InvoiceStatus.EXTRACTED,
    )
    db.add(invoice)
    db.flush()
    db.add(ActivityLog(
        company_id=current.company_id, user_id=current.id,
        action="invoice.upload", entity_type="invoice", entity_id=invoice.id,
        detail=f"AI bóc tách: {ocr.supplier_name} - {ocr.total_amount}",
    ))
    db.commit()
    db.refresh(invoice)
    return invoice


@router.get("", response_model=list[InvoiceOut])
def list_invoices(
    status: InvoiceStatus | None = None,
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Liệt kê hóa đơn; lọc theo ?status= và ?project_id=."""
    q = db.query(Invoice).filter(Invoice.company_id == current.company_id)
    if status:
        q = q.filter(Invoice.status == status)
    if project_id:
        q = q.filter(Invoice.project_id == project_id)
    return q.order_by(Invoice.created_at.desc()).all()


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    inv = db.get(Invoice, invoice_id)
    if not inv or inv.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy hóa đơn.")
    return inv


@router.patch("/{invoice_id}", response_model=InvoiceOut)
def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    db: Session = Depends(get_db),
    # Chỉ Quản lý/Kế toán/Giám đốc được sửa hóa đơn (nhân viên hiện trường chỉ upload).
    current: User = Depends(require_roles(UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)),
):
    """Chỉnh sửa dữ liệu hóa đơn (kế toán đối chiếu lại số AI đọc)."""
    inv = db.get(Invoice, invoice_id)
    if not inv or inv.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy hóa đơn.")
    # Đã duyệt thì khóa sửa (số tiền đã vào chi phí/báo cáo) — muốn sửa phải /reject trước.
    if inv.status == InvoiceStatus.VERIFIED:
        raise HTTPException(409, "Hóa đơn đã duyệt — không thể sửa. Hãy từ chối (reject) trước nếu cần chỉnh.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(inv, k, v)
    db.commit()
    db.refresh(inv)
    return inv


@router.post("/{invoice_id}/verify", response_model=InvoiceOut)
def verify_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.ACCOUNTANT, UserRole.DIRECTOR, UserRole.MANAGER)),
):
    """Duyệt hóa đơn -> trạng thái VERIFIED -> được tính vào chi phí dự án."""
    inv = db.get(Invoice, invoice_id)
    if not inv or inv.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy hóa đơn.")
    if inv.total_amount <= Decimal(0):
        raise HTTPException(400, "Hóa đơn chưa có số tiền hợp lệ để duyệt.")
    inv.status = InvoiceStatus.VERIFIED
    db.add(ActivityLog(
        company_id=current.company_id, user_id=current.id,
        action="invoice.verify", entity_type="invoice", entity_id=inv.id,
    ))
    db.commit()
    db.refresh(inv)
    return inv
