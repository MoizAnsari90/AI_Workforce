"""Private CPU-only Whisper worker. No paid providers or runtime model downloads."""
import base64
import hashlib
import hmac
import io
import json
import math
import os
from pathlib import Path
import socket
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from voice_policy import ENGINE_VERSION, MODEL_REVISION, VoiceError, PaidUpgradeBlocked, assert_free_policy

MAX_BYTES = 5 * 1024 * 1024


def validate_audio(audio):
    invalid = VoiceError('Recording is invalid.', 400, 'INVALID_VOICE_AUDIO')
    if len(audio) < 44 or len(audio) > MAX_BYTES:
        raise invalid
    header = struct.unpack('<4sI4s4sIHHIIHH4sI', audio[:44])
    if (header != (b'RIFF', len(audio) - 8, b'WAVE', b'fmt ', 16, 1, 1, 16000, 32000, 2, 16, b'data', len(audio) - 44)
            or (len(audio) - 44) % 2 or not 0.3 <= (len(audio) - 44) / 32000 <= 60.25):
        raise invalid
    energy = sum((sample[0] / 32768) ** 2 for sample in struct.iter_unpack('<h', audio[44:]))
    if math.sqrt(energy / ((len(audio) - 44) / 2)) < 0.0001:
        raise VoiceError('No clear speech was detected.', 422, 'VOICE_NO_SPEECH')


def verify_token(authorization, secret):
    try:
        if not authorization.startswith('Bearer '):
            raise ValueError()
        token = authorization[7:]
        if len(token) > 4096:
            raise ValueError()
        header, payload, signature = token.split('.')
        decode = lambda part: base64.b64decode(part + '=' * (-len(part) % 4), altchars=b'-_', validate=True)
        expected = hmac.new(secret, (header + '.' + payload).encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, decode(signature)):
            raise ValueError()
        metadata, claims = json.loads(decode(header)), json.loads(decode(payload))
        now = time.time()
        if (metadata != {'alg': 'HS256', 'typ': 'JWT'} or claims.get('iss') != 'ai-workforce-api'
                or claims.get('aud') != 'voice-worker' or claims.get('policy') != 'free-only'
                or type(claims.get('exp')) is not int or type(claims.get('iat')) is not int
                or not now < claims['exp'] <= now + 120 or claims['iat'] > now + 10
                or claims['exp'] - claims['iat'] > 120 or not claims.get('jti')
                or not isinstance(claims.get('audioSha256'), str) or len(claims['audioSha256']) != 64):
            raise ValueError()
        return claims
    except Exception:
        raise VoiceError('Invalid voice service authentication.', 401, 'VOICE_UNAUTHORIZED') from None


class Engine:
    def __init__(self, model_directory):
        directory = Path(model_directory)
        manifest = json.loads((directory / 'manifest.json').read_text())
        assert_free_policy(manifest, version('faster-whisper'), os.environ.get('VOICE_PAYMENT_POLICY', 'free-only'))
        for name in ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt']:
            digest = hashlib.sha256((directory / name).read_bytes()).hexdigest()
            if manifest.get('files', {}).get(name) != digest:
                raise PaidUpgradeBlocked()
        # Offline is enforced before importing the engine: no registry/API upgrades.
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['HF_DATASETS_OFFLINE'] = '1'
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio
        # Exercise the decoder before reporting ready, using in-memory silence.
        samples = bytes(3200)
        probe = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36 + len(samples), b'WAVE', b'fmt ', 16, 1, 1, 16000, 32000, 2, 16, b'data', len(samples)) + samples
        decode_audio(io.BytesIO(probe), sampling_rate=16000)
        threads = max(1, min(4, int(os.environ.get('VOICE_CPU_THREADS', '2'))))
        self.model = WhisperModel(str(directory), device='cpu', compute_type='int8',
                                  cpu_threads=threads, num_workers=1, local_files_only=True)

    def transcribe(self, audio):
        options = dict(beam_size=1, best_of=1, temperature=0, condition_on_previous_text=False, vad_filter=True)
        segments, info = self.model.transcribe(io.BytesIO(audio), task='transcribe', **options)
        transcript = ' '.join(segment.text.strip() for segment in segments).strip()
        if info.language == 'en':
            question = transcript
        else:
            segments, _ = self.model.transcribe(io.BytesIO(audio), task='translate', language=info.language, **options)
            question = ' '.join(segment.text.strip() for segment in segments).strip()
        if not transcript or not question or len(transcript) > 2000 or len(question) > 2000:
            raise VoiceError('No clear speech was detected. Record a shorter question.', 422, 'VOICE_NO_SPEECH')
        return dict(transcript=transcript, question=question)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_args):
        pass  # No tokens, audio, transcripts, patient details, or request URLs in logs.

    def send_json(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Connection', 'close')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True

    def do_GET(self):
        if self.path != '/health':
            self.send_json(404, {'error': {'code': 'NOT_FOUND'}})
            return
        self.send_json(200, {'status': 'healthy', 'engine': 'faster-whisper', 'engineVersion': ENGINE_VERSION, 'policy': 'free-only',
                             'billingRequired': False, 'modelRevision': MODEL_REVISION, 'protocolVersion': 1})

    def do_POST(self):
        try:
            self.connection.settimeout(10)
            if self.path != '/transcribe':
                raise VoiceError('Route not found.', 404, 'NOT_FOUND')
            claims = verify_token(self.headers.get('Authorization', ''), self.server.signing_secret)
            if self.headers.get('X-Voice-Payment-Policy') != 'free-only':
                raise PaidUpgradeBlocked()
            if self.headers.get('Content-Type', '').lower() != 'audio/wav':
                raise VoiceError('Only WAV recordings are accepted.', 415, 'VOICE_FORMAT')
            length = self.headers.get('Content-Length', '')
            if not length.isdecimal() or self.headers.get('Transfer-Encoding') or self.headers.get('Content-Encoding', 'identity') != 'identity':
                raise VoiceError('Invalid audio upload.', 400, 'INVALID_VOICE_AUDIO')
            length = int(length)
            if length > MAX_BYTES:
                raise VoiceError('Recording is too large or invalid.', 413, 'VOICE_TOO_LARGE')
            if length < 44:
                raise VoiceError('Recording is invalid.', 400, 'INVALID_VOICE_AUDIO')
            audio = self.rfile.read(length)
            if len(audio) != length or not hmac.compare_digest(hashlib.sha256(audio).hexdigest(), claims['audioSha256']):
                raise VoiceError('Invalid audio binding.', 401, 'VOICE_UNAUTHORIZED')
            validate_audio(audio)
            if not self.server.inference_lock.acquire(blocking=False):
                raise VoiceError('The free voice service is busy. Retry this recording.', 503, 'VOICE_BUSY')
            try:
                result = self.server.engine.transcribe(audio)
            finally:
                self.server.inference_lock.release()
            self.send_json(200, {**result, 'engine': 'faster-whisper', 'engineVersion': ENGINE_VERSION, 'policy': 'free-only',
                                 'billingRequired': False, 'modelRevision': MODEL_REVISION, 'protocolVersion': 1})
        except VoiceError as error:
            self.send_json(error.status, {'error': {'code': error.code, 'message': str(error)}})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except Exception:
            self.send_json(503, {'error': {'code': 'VOICE_UNAVAILABLE', 'message': 'The free voice service is unavailable.'}})


def create_server(engine, secret, host='0.0.0.0', port=8091):
    try:
        if len(secret) != 64:
            raise ValueError()
        secret = bytes.fromhex(secret)
        if len(secret) != 32:
            raise ValueError()
    except ValueError:
        raise RuntimeError('Configure the purpose-specific VOICE_WORKER_AUTH_KEY (64 hexadecimal characters).') from None
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.engine, server.signing_secret = engine, secret
    server.inference_lock = threading.Lock()
    return server


if __name__ == '__main__':
    try:
        server = create_server(None, os.environ.get('VOICE_WORKER_AUTH_KEY', ''), port=int(os.environ.get('PORT', '8091')))
        server.engine = Engine(os.environ.get('VOICE_MODEL_PATH', '/models/whisper-base'))
        print('Free-only voice worker ready; automatic upgrades and paid providers disabled.', flush=True)
        server.serve_forever()
    except PaidUpgradeBlocked as error:
        raise SystemExit(str(error)) from None
