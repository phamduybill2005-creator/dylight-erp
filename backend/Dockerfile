# Debian 12 is supported by the pinned Playwright 1.49 browser dependencies.
FROM python:3.12-slim-bookworm

# Không ghi file .pyc, log ra stdout ngay (tốt cho container)
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /code

# Cài thư viện hệ thống cần cho psycopg2/bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# VPS chạy cả nút Đồng bộ ngay và scheduler nên cần browser TRONG image.
# Giữ build mặc định nhẹ cho môi trường dùng job riêng (VD GitHub Actions).
# docker-compose.yml bật tùy chọn này cho VPS; recreate không làm mất browser.
ARG INSTALL_YUNATT_BROWSER=false
RUN if [ "$INSTALL_YUNATT_BROWSER" = "true" ]; then \
      python -m playwright install --with-deps chromium && \
      rm -rf /var/lib/apt/lists/*; \
    fi

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
