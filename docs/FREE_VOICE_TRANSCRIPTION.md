# Free-only voice transcription

Voice recordings use the self-hosted `services/voice-transcriber` worker. The voice
path has no Gemini, OpenAI, paid-provider, or automatic provider fallback. Other
existing assistant features retain their existing configuration.

## Payment and upgrade lock

- Only `VOICE_TRANSCRIPTION_PROVIDER=self-hosted-whisper` and
  `VOICE_PAYMENT_POLICY=free-only` are accepted. Any other value blocks voice with
  `VOICE_PAID_UPGRADE_BLOCKED` (HTTP 402).
- A worker payment-required response, changed model revision, changed protocol,
  changed engine, or non-free policy is rejected. No checkout, plan upgrade, or
  second provider is attempted.
- The Python base image is pinned by digest. All Python dependencies, including
  transitive dependencies, are pinned by version and artifact SHA-256 hash.
- The public MIT model is pinned to a commit. Model files are downloaded only
  during an explicit image build. The worker verifies its engine version,
  manifest policy, model revision, and file checksums at startup.
- Runtime model downloads are disabled. The Compose worker runs on an internal
  network without internet egress, with a read-only filesystem and fixed CPU/RAM
  limits. There is no update agent or paid API credential in the worker.
- Any future upgrade requires an explicit source/lock-file review, tests, and
  image rebuild. Do not replace the pinned model with `latest`.

This controls application behavior. It cannot control a hosting company's pricing,
account billing, free quotas, or future plan changes. Hosting resources may cost
money; no hosting resource or paid subscription is provisioned by this change.

## Local Windows / Docker Desktop

The worker is built for Linux amd64 / Python 3.12; Docker supplies that runtime.
The helper reads the existing API configuration and derives a purpose-specific
voice key in memory from `JWT_SECRET`. Only that derived key is passed to the
worker. It does not write or print secrets. No speech-provider key is required.

```powershell
node scripts/voice-worker.mjs build
node scripts/voice-worker.mjs start
node scripts/voice-worker.mjs status
```

With the API running locally, its default worker origin is
`http://127.0.0.1:8091`. A small local gateway bridges that loopback-only port to
the isolated worker; the inference container itself has no internet route. The
gateway has no authentication secret and only forwards the two fixed worker
paths without following redirects. If API configuration
is supplied explicitly, set `VOICE_TRANSCRIBER_URL` to that origin and retain the
two free-only policy values above. Empty example placeholders use these defaults.

The first image build downloads the pinned model and dependencies. The model is
loaded once when the worker starts. The ready health check verifies model loading
has completed. CPU inference can take longer than hosted transcription; the UI,
web proxy, and API allow a bounded two-minute upload operation.

## Live deployment

The production Compose file includes a private voice worker and routes the API to
`http://voice-transcriber:8091`. It explicitly keeps application billing disabled
and does not publish the worker's port. A voice worker outage does not prevent the
API from starting; voice returns a safe unavailable error.
Supply the same dedicated 64-character hexadecimal `VOICE_WORKER_AUTH_KEY` to
both services through the deployment secret configuration. An absent or invalid
worker key prevents the worker from starting; it never enables anonymous access.

For an API deployed on Vercel, run this worker on a separately provisioned host
with sufficient CPU/RAM and configure `VOICE_TRANSCRIBER_URL` with its dedicated
HTTPS **origin** (no path). Configure the same dedicated 64-character hexadecimal
`VOICE_WORKER_AUTH_KEY` in the API and worker secret stores. Keep the application's
`JWT_SECRET` private to the API. Place a TLS reverse proxy in front of port 8091;
do not expose the plain HTTP worker publicly. The worker authenticates each
transcription using a short-lived, purpose-specific HMAC token bound to the exact
audio bytes. Changing the voice key invalidates access until both sides agree.

This implementation does not publish a worker or change production secrets. A
reachable worker host must be available before live voice can succeed. Do not
connect a paid transcription endpoint or enable a paid hosting plan automatically.

## Recording and retry behavior

Only validated mono PCM WAV recordings up to 60 seconds are accepted. Audio is
processed in memory; the worker does not save recordings or log audio/transcripts.
The original transcript is returned for review, with a local English translation
for non-English speech. Recognition accuracy, especially names/SKUs and mixed
speech, must be reviewed before sending the question.

Postgres stores the existing idempotency result, not the recording. A successful
request is replayed without new inference. Temporary local-service failures may
be retried explicitly using the same recording; an atomic Postgres claim prevents
concurrent duplicate retries. Paid-policy failures remain blocked on replay.

## Checks

```powershell
python -m unittest discover -s services/voice-transcriber -p test_*.py -v
node scripts/run-api-tests.mjs tests/voiceFreeOnly.test.ts tests/voiceQuestion.test.ts tests/voiceLocalIntegration.test.ts tests/voiceUploadProxy.test.ts
node --test scripts/test-compose-security.mjs
node scripts/verify-voice-provider.mjs
node scripts/voice-worker.mjs test
```

Use a dedicated test Postgres URL and Redis database. Authenticated Redis tests
also require `TEST_REDIS_PASSWORD`; never use a production Redis database for tests.
The last two checks require the synthetic fixture generated by
`scripts/generate-voice-fixture.ps1` and the running worker. The live test is opt-in
in the ordinary suite; the helper supplies its local endpoint and scoped key in
memory and runs it against the isolated test database.
