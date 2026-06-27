FROM python:3.12-slim

# Không ghi file .pyc, log ra stdout ngay (tốt cho container)
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /code

# Cài thư viện hệ thống cần cho psycopg2/bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# LƯU Ý: KHÔNG cài Chromium ở đây. Việc cào Yunatt (Playwright) đã chuyển sang
# GitHub Actions (.github/workflows/yunatt-sync.yml). Bước "playwright install
# --with-deps chromium" rất nặng, làm build BACKEND HỎNG trên gói Render free.
# yunatt_service import Playwright kiểu lazy nên ảnh không có Chromium vẫn chạy
# bình thường (chỉ nút "Đồng bộ ngay" thủ công là không dùng được — đã tắt qua
# YUNATT_ENABLED=false; đồng bộ tự động do Actions lo).

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
