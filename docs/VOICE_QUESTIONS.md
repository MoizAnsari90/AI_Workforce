# Voice questions in the workforce assistant

The dashboard assistant accepts typed questions and short microphone recordings. The first release returns the existing agent's text answer; it does not implement continuous voice calls or spoken answer playback.

## User flow

1. Select the microphone next to the send button and grant browser permission.
2. Record up to 60 seconds, then stop. Cancel discards the recording and preserves the typed draft.
3. Listen to the local preview. No audio is uploaded during recording or preview.
4. Select **Use recording** to send it to Gemini for transcription.
5. Review the editable transcript in the composer. Existing typed text is preserved. When a faithful English interpretation differs, it is displayed before submission.
6. Select the normal send button. The existing workforce assistant answers using its normal permissions, verified business-data services and question-credit rules.

English, Urdu, Arabic and mixed-language audio are requested from Gemini. Recognition accuracy depends on the speaker, microphone, noise and provider; native-speaker/device testing is still appropriate. The UI supports all three interface languages independently of the recording language. The existing assistant can return English answers.

The English interpretation is used for existing business-query routing only while the transcript remains unchanged. Editing the transcript sends the edited text instead. Editing or retrying never silently submits the question automatically. The same normalized question and request ID are preserved on answer retries.

## Browser implementation

`VoiceQuestionControl` owns the capture lifecycle. It detects a secure context, microphone APIs and MediaRecorder support, negotiates an available recording format, stops/releases tracks on stop/cancel/navigation and when the page is hidden, and revokes temporary playback URLs. Late permission responses and async conversion results are discarded after cancellation or unmount. Typed chat remains available after microphone errors.

`voice-audio.ts` decodes the browser recording locally and produces canonical mono, 16-bit, 16 kHz WAV. That avoids forwarding browser-specific WebM/MP4 containers. A 60-second PCM recording is about 1.92 MB. Captured data is capped at 5 MB, with output clipped to the 60-second limit. The deployment must use HTTPS; supported browsers also permit microphone capture on loopback localhost during development.

## Request and trust boundaries

- Web: `POST /api/voice/transcribe?tenantId=...`, raw `audio/wav`, UUID `x-voice-request-id`.
- API: `POST /api/v1/tenants/:tenantId/workforce/transcribe`.
- The web handler requires the HTTP-only session, checks a supplied Origin, validates request metadata and bounds the streamed body before forwarding binary bytes. It never exposes the token or Gemini key to the browser.
- The API enforces authentication, tenant isolation and `operations:read` before parsing audio. It limits each authenticated user to six transcription requests per minute.
- The server validates PCM headers, actual length, format, duration and a completely silent signal before inference. Unknown/empty model output is rejected. Malformed provider errors are not exposed.
- The transcriber only returns transcript and English interpretation; it has no tools and cannot execute business actions. The existing assistant remains read-only.

No new secrets, dependencies, migration or permanent audio storage are required. `GEMINI_API_KEY` and `GEMINI_MODEL` are read from existing server environment configuration. Audio is held in memory and sent to Gemini when the user chooses **Use recording**; provider-side handling follows the configured Gemini account's data policies.

## Retries, retention and costs

Transcription idempotency is scoped to tenant, user, recording request ID and audio hash. Successful duplicates replay the cached response, pending duplicates return 409, and failed recordings are not automatically sent again. Network uncertainty retains the same audio/request ID for a manual retry. A failed recording can be discarded and recorded again.

Raw audio is not written to application files or the database. The existing `IdempotencyLog` stores the transcript/English interpretation for replay, so text follows that table's retention and access policies. Cancellation cannot undo an inference already started by the provider.

Transcription uses Gemini quota and may incur provider charges. It does not separately consume a workflow-question credit; sending the reviewed question uses the existing one-credit assistant flow. No Vapi/telephone service is involved. Automatic SDK retries are disabled for transcription to limit uncertain repeated inference.

## Verification

```powershell
.\scripts\with-d-drive.cmd node scripts/run-api-tests.mjs
node --test scripts/test-language.mjs scripts/test-appearance.mjs
.\scripts\with-d-drive.cmd npm.cmd run build --workspace=@ai-employee/api
.\scripts\with-d-drive.cmd npm.cmd run build --workspace=@ai-employee/web
.\scripts\with-d-drive.cmd node scripts/verify-local-predeployment.mjs --voice-browser
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-voice-fixture.ps1
.\scripts\with-d-drive.cmd node scripts/verify-voice-provider.mjs
```

The provider check requires the synthetic Windows speech fixture at `.local/voice-fixture-source.wav`; it is not a customer recording. It calls the production transcription service with that fixture and writes only safe result metadata to `artifacts/voice-provider.json`.

Browser verification uses a temporary Edge profile and a synthetic microphone, deterministic transcription fixtures, and an actual answer from the isolated local API. Results are in `artifacts/voice-browser.json`. A live Gemini check is separate, so a mocked browser result is not represented as live provider proof. Real mobile hardware, Safari and Firefox require device-specific verification; automated Chromium checks do not certify those environments.
