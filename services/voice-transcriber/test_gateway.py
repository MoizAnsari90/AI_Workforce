import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import unittest

import gateway


class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.server.calls += 1
        self.send_response(self.server.response_status)
        if self.server.response_status == 302:
            self.send_header('Location', 'https://payment.example.invalid/upgrade')
        self.end_headers()
        self.wfile.write(b'{"policy":"free-only"}')


class GatewayBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        cls.proxy = gateway.create_proxy('127.0.0.1', 0, '127.0.0.1', cls.upstream.server_port)
        cls.threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in [cls.upstream, cls.proxy]]
        for thread in cls.threads:
            thread.start()

    @classmethod
    def tearDownClass(cls):
        for server in [cls.upstream, cls.proxy]:
            server.shutdown()
            server.server_close()
        for thread in cls.threads:
            thread.join()

    def setUp(self):
        self.upstream.calls, self.upstream.response_status = 0, 200

    def get(self, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.proxy.server_port, timeout=5)
        connection.request('GET', path)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_proxies_only_to_the_fixed_worker(self):
        self.assertEqual(self.get('/health')[0], 200)
        self.assertEqual(self.upstream.calls, 1)

    def test_payment_errors_stay_blocked(self):
        self.upstream.response_status = 402
        self.assertEqual(self.get('/health')[0], 402)
        self.assertEqual(self.upstream.calls, 1)

    def test_redirects_are_never_followed_or_forwarded(self):
        self.upstream.response_status = 302
        status, headers, body = self.get('/health')
        self.assertEqual(status, 402)
        self.assertNotIn('Location', headers)
        self.assertIn(b'VOICE_PAID_UPGRADE_BLOCKED', body)
        self.assertEqual(self.upstream.calls, 1)

    def test_client_cannot_select_an_upstream_url(self):
        self.assertEqual(self.get('/health?url=https://payment.example.invalid')[0], 404)
        self.assertEqual(self.upstream.calls, 0)


if __name__ == '__main__':
    unittest.main()
