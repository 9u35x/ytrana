FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_URL=sqlite:////data/ytrana.db \
    UPLOAD_DIR=/data/uploads

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && useradd --system --create-home --uid 10001 ytrana \
    && mkdir -p /data/uploads \
    && chown -R ytrana:ytrana /data

COPY backend /app/backend
WORKDIR /app/backend

USER ytrana
VOLUME ["/data"]
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
