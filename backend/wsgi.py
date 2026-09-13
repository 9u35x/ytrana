import sys
import os

path = '/home/270zw/ytrana/backend'
if path not in sys.path:
    sys.path.append(path)

os.chdir(path)

import asyncio
from main import app


def application(environ, start_response):
    method = environ['REQUEST_METHOD']
    path_info = environ.get('PATH_INFO', '')
    query_string = environ.get('QUERY_STRING', '').encode()

    headers = []
    for key, value in environ.items():
        if key.startswith('HTTP_'):
            header_name = key[5:].replace('_', '-').lower()
            headers.append((header_name.encode(), value.encode()))
        elif key == 'CONTENT_TYPE':
            headers.append((b'content-type', value.encode()))
        elif key == 'CONTENT_LENGTH':
            headers.append((b'content-length', value.encode()))

    content_length = int(environ.get('CONTENT_LENGTH', 0) or 0)
    body = environ['wsgi.input'].read(content_length) if content_length else b''

    scope = {
        'type': 'http',
        'asgi': {'version': '3.0'},
        'http_version': '1.1',
        'method': method,
        'path': path_info,
        'query_string': query_string,
        'headers': headers,
        'client': (environ.get('REMOTE_ADDR', '127.0.0.1'), 0),
        'server': (environ.get('SERVER_NAME', 'localhost'), int(environ.get('SERVER_PORT', 80) or 80)),
        'scheme': environ.get('wsgi.url_scheme', 'http'),
    }

    response = {}
    response_body = []

    async def receive():
        return {'type': 'http.request', 'body': body, 'more_body': False}

    async def send(message):
        if message['type'] == 'http.response.start':
            response['status'] = message['status']
            response['headers'] = message.get('headers', [])
        elif message['type'] == 'http.response.body':
            response_body.append(message.get('body', b''))

    asyncio.run(app(scope, receive, send))

    status_code = response.get('status', 500)
    status_line = f"{status_code} OK"
    resp_headers = [(k.decode(), v.decode()) for k, v in response.get('headers', [])]
    start_response(status_line, resp_headers)
    return [b''.join(response_body)]
