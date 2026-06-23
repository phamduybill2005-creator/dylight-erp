FROM python:3.12-slim

# Không ghi file .pyc, log ra stdout ngay (tốt cho container)
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /code

# Cài thư viện hệ thống cần cho psycopg2/bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Trình duyệt Chromium + thư viện hệ thống cho Playwright (đồng bộ chấm công Yunatt).
# Đặt sau pip install để tận dụng cache; --with-deps tự cài các gói apt cần thiết.
RUN playwright install --with-deps chromium

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
