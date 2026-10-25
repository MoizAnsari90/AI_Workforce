"""Development-only loopback bridge to the isolated worker; never follows redirects."""
import http.client
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BYTES = 5 * 1024 * 1024


class Gateway(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, data):
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True

    def forward(self):
        connection = None
        try:
            self.connection.settimeout(10)
            if (self.command, self.path) not in [('GET', '/health'), ('POST', '/transcribe')]:
                self.reply(404, b'{"error":{"code":"NOT_FOUND"}}')
                return
            body = None
            if self.command == 'POST':
                length = self.headers.get('Content-Length', '')
                if not length.isdecimal() or self.headers.get('Transfer-Encoding'):
                    self.reply(400, b'{"error":{"code":"INVALID_VOICE_AUDIO"}}')
                    return
                length = int(length)
                if length > MAX_BYTES:
                    self.reply(413, b'{"error":{"code":"VOICE_TOO_LARGE"}}')
                    return
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError()
            # The destination and paths are fixed; client input cannot select a URL.
            connection = http.client.HTTPConnection(self.server.upstream_host, self.server.upstream_port, timeout=115)
            headers = {name: self.headers[name] for name in ['Authorization', 'Content-Type', 'X-Voice-Payment-Policy'] if name in self.headers}
            connection.request(self.command, self.path, body, headers)
            response = connection.getresponse()
            if 300 <= response.status < 400:
                self.reply(402, b'{"error":{"code":"VOICE_PAID_UPGRADE_BLOCKED"}}')
                return
            data = response.read(32769)
            if len(data) > 32768:
                raise ValueError()
            self.reply(response.status, data)
        except Exception:
            self.reply(503, b'{"error":{"code":"VOICE_UNAVAILABLE","message":"The free voice worker is unavailable."}}')
        finally:
            if connection:
                connection.close()

    do_GET = forward
    do_POST = forward


def create_proxy(host='0.0.0.0', port=8091, upstream_host='voice-transcriber', upstream_port=8091):
    server = ThreadingHTTPServer((host, port), Gateway)
    server.daemon_threads = True
    server.upstream_host, server.upstream_port = upstream_host, upstream_port
    return server


if __name__ == '__main__':
    create_proxy().serve_forever()
