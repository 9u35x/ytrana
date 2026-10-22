"""جسر WSGI خفيف لخدمة تطبيق FastAPI في بيئات الاستضافة القديمة."""
import asyncio
import json
import os
import sys
from http import HTTPStatus

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)

from config import settings  # noqa: E402
from main import app  # noqa: E402

MAX_REQUEST_BYTES = max(1, settings.max_upload_mb, settings.max_reel_mb) * 1024 * 1024 + 256 * 1024


def _early_response(start_response, status_code: int, detail: str):
    try:
        phrase = HTTPStatus(status_code).phrase
    except ValueError:
        phrase = "Unknown Status"
    body = json.dumps({"detail": detail}, ensure_ascii=False).encode("utf-8")
    start_response(f"{status_code} {phrase}", [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Length", str(len(body))),
    ])
    return [body]


def application(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET")
    path_info = environ.get("PATH_INFO", "")
    query_string = environ.get("QUERY_STRING", "").encode()

    try:
        content_length = int(environ.get("CONTENT_LENGTH", 0) or 0)
    except (TypeError, ValueError):
        return _early_response(start_response, 400, "طول الطلب غير صالح")
    if content_length < 0:
        return _early_response(start_response, 400, "طول الطلب غير صالح")
    if content_length > MAX_REQUEST_BYTES:
        return _early_response(start_response, 413, "حجم الطلب يتجاوز الحد المسموح")

    headers = []
    for key, value in environ.items():
        if key.startswith("HTTP_"):
            header_name = key[5:].replace("_", "-").lower()
            headers.append((header_name.encode(), value.encode()))
        elif key == "CONTENT_TYPE":
            headers.append((b"content-type", value.encode()))
        elif key == "CONTENT_LENGTH":
            headers.append((b"content-length", value.encode()))

    body = environ["wsgi.input"].read(content_length) if content_length else b""
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": environ.get("SERVER_PROTOCOL", "HTTP/1.1").replace("HTTP/", ""),
        "method": method,
        "path": path_info,
        "query_string": query_string,
        "headers": headers,
        "client": (environ.get("REMOTE_ADDR", "127.0.0.1"), 0),
        "server": (environ.get("SERVER_NAME", "localhost"), int(environ.get("SERVER_PORT", 80) or 80)),
        "scheme": environ.get("wsgi.url_scheme", "http"),
    }

    response = {}
    response_body = []
    request_delivered = False

    async def receive():
        nonlocal request_delivered
        if request_delivered:
            return {"type": "http.disconnect"}
        request_delivered = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        if message["type"] == "http.response.start":
            response["status"] = message["status"]
            response["headers"] = message.get("headers", [])
        elif message["type"] == "http.response.body":
            response_body.append(message.get("body", b""))

    asyncio.run(app(scope, receive, send))

    status_code = response.get("status", 500)
    try:
        phrase = HTTPStatus(status_code).phrase
    except ValueError:
        phrase = "Unknown Status"
    status_line = f"{status_code} {phrase}"
    resp_headers = [(key.decode(), value.decode()) for key, value in response.get("headers", [])]
    start_response(status_line, resp_headers)
    return [b"".join(response_body)]
