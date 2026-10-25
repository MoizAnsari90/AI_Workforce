import base64
import hashlib
import hmac
import http.client
import io
import json
import math
import struct
import threading
import time
import unittest
from unittest.mock import Mock
from types import SimpleNamespace

import worker

SECRET = 'fixture-only-worker-secret-never-used-in-production'


def wav(silent=False):
    samples = b''.join(struct.pack('<h', 0 if silent else round(math.sin(i / 16) * 5000)) for i in range(16000))
    return struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36 + len(samples), b'WAVE', b'fmt ', 16, 1, 1, 16000, 32000, 2, 16, b'data', len(samples)) + samples


def token(audio, **changes):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=').decode()
    now = int(time.time())
    claims = dict(iss='ai-workforce-api', aud='voice-worker', policy='free-only', iat=now, exp=now + 60,
                  jti='fixture-request', audioSha256=hashlib.sha256(audio).hexdigest())
    claims.update(changes)
    body = encode(dict(alg='HS256', typ='JWT')) + '.' + encode(claims)
    key = hmac.new(SECRET.encode(), b'ai-workforce:voice-worker:v1', hashlib.sha256).digest()
    signature = base64.urlsafe_b64encode(hmac.new(key, body.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    return body + '.' + signature


class WorkerTrustBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Mock()
        auth_key = hmac.new(SECRET.encode(), b'ai-workforce:voice-worker:v1', hashlib.sha256).hexdigest()
        cls.server = worker.create_server(cls.engine, auth_key, '127.0.0.1', 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.engine.reset_mock()
        self.engine.transcribe.side_effect = None
        self.engine.transcribe.return_value = dict(transcript='Fixture speech', question='Fixture speech')

    def post(self, audio=None, authorization=None, policy='free-only'):
        audio = wav() if audio is None else audio
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {'Content-Type': 'audio/wav', 'X-Voice-Payment-Policy': policy}
        if authorization is not None:
            headers['Authorization'] = 'Bearer ' + authorization
        connection.request('POST', '/transcribe', audio, headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_authentication_is_required_before_inference(self):
        status, _ = self.post()
        self.assertEqual(status, 401)
        self.engine.transcribe.assert_not_called()

    def test_token_is_bound_to_exact_audio_bytes(self):
        audio = wav()
        changed = audio[:-2] + b'\x01\x00'
        status, _ = self.post(changed, token(audio))
        self.assertEqual(status, 401)
        self.engine.transcribe.assert_not_called()

    def test_expired_or_wrong_audience_tokens_are_rejected(self):
        audio = wav()
        for changes in [dict(exp=int(time.time()) - 1), dict(aud='another-worker')]:
            with self.subTest(changes=changes):
                self.assertEqual(self.post(audio, token(audio, **changes))[0], 401)
        self.engine.transcribe.assert_not_called()

    def test_paid_request_is_blocked_without_inference(self):
        audio = wav()
        status, body = self.post(audio, token(audio), 'paid')
        self.assertEqual(status, 402)
        self.assertEqual(body['error']['code'], 'VOICE_PAID_UPGRADE_BLOCKED')
        self.engine.transcribe.assert_not_called()

    def test_response_identifies_pinned_free_engine(self):
        audio = wav()
        status, body = self.post(audio, token(audio))
        self.assertEqual(status, 200)
        self.assertEqual(body['engine'], 'faster-whisper')
        self.assertEqual(body['policy'], 'free-only')
        self.assertFalse(body['billingRequired'])
        self.assertEqual(body['modelRevision'], worker.MODEL_REVISION)
        self.assertEqual(body['question'], 'Fixture speech')
        self.engine.transcribe.assert_called_once_with(audio)

    def test_invalid_and_silent_audio_do_not_reach_inference(self):
        for audio, expected in [(b'not a wav', 400), (wav(True), 422)]:
            with self.subTest(expected=expected):
                self.assertEqual(self.post(audio, token(audio))[0], expected)
        self.engine.transcribe.assert_not_called()

    def test_busy_worker_does_not_queue_or_start_another_model(self):
        audio = wav()
        self.server.inference_lock.acquire()
        try:
            self.assertEqual(self.post(audio, token(audio))[0], 503)
            self.engine.transcribe.assert_not_called()
        finally:
            self.server.inference_lock.release()

    def test_inference_failures_do_not_expose_private_details(self):
        self.engine.transcribe.side_effect = RuntimeError('patient details credentials audio content')
        audio = wav()
        status, body = self.post(audio, token(audio))
        self.assertEqual(status, 503)
        self.assertNotIn('patient details', json.dumps(body))


class FreeOnlyPolicy(unittest.TestCase):
    def test_non_english_speech_keeps_original_transcript_and_english_review_question(self):
        engine = worker.Engine.__new__(worker.Engine)
        engine.model = Mock()
        engine.model.transcribe.side_effect = [
            ([SimpleNamespace(text='کتنی منظوریاں باقی ہیں؟')], SimpleNamespace(language='ur')),
            ([SimpleNamespace(text='How many approvals are pending?')], SimpleNamespace(language='en')),
        ]
        result = engine.transcribe(wav())
        self.assertEqual(result['transcript'], 'کتنی منظوریاں باقی ہیں؟')
        self.assertEqual(result['question'], 'How many approvals are pending?')

    def test_any_unreviewed_model_engine_or_license_change_is_blocked(self):
        manifest = dict(modelRevision=worker.MODEL_REVISION, engineVersion=worker.ENGINE_VERSION, license='MIT', policy='free-only')
        worker.assert_free_policy(manifest, worker.ENGINE_VERSION, 'free-only')
        for change in [dict(modelRevision='latest'), dict(engineVersion='999.0.0'), dict(license='paid'), dict(policy='paid')]:
            with self.subTest(change=change), self.assertRaises(worker.PaidUpgradeBlocked):
                worker.assert_free_policy({**manifest, **change}, worker.ENGINE_VERSION, 'free-only')
        with self.assertRaises(worker.PaidUpgradeBlocked):
            worker.assert_free_policy(manifest, '999.0.0', 'free-only')
        with self.assertRaises(worker.PaidUpgradeBlocked):
            worker.assert_free_policy(manifest, worker.ENGINE_VERSION, 'paid')


if __name__ == '__main__':
    unittest.main()
