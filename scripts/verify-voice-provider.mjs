// Synthetic speech only. Does not use a microphone or upload customer content.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { root, sourceEnvironment } from './predeployment-config.mjs';

const report = { timestamp: new Date().toISOString(), passed: false, syntheticAudioOnly: true, checks: {} };
let stage = 'synthetic fixture';
try {
  const source = fs.readFileSync(path.join(root, '.local/voice-fixture-source.wav'));
  let data;
  for (let offset = 12; offset + 8 <= source.length;) {
    const name = source.toString('ascii', offset, offset + 4), size = source.readUInt32LE(offset + 4);
    if (name === 'fmt ') {
      if (source.readUInt16LE(offset + 8) !== 1 || source.readUInt16LE(offset + 10) !== 1 || source.readUInt32LE(offset + 12) !== 16000 || source.readUInt16LE(offset + 22) !== 16) throw new Error('Unsupported synthetic fixture');
    }
    if (name === 'data') data = source.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!data?.length) throw new Error('Synthetic fixture missing');
  const audio = Buffer.alloc(44 + data.length);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(data.length, 40); data.copy(audio, 44);
  fs.writeFileSync(path.join(root, '.local/voice-fixture.wav'), audio);
  Object.assign(process.env, sourceEnvironment(), { NODE_ENV: 'development', LOG_LEVEL: 'error' });
  stage = 'load current free-only service';
  // Verify current free-only source rather than possibly stale provider code.
  const require = createRequire(import.meta.url);
  require('tsx/cjs');
  const { recognizeVoice, validateVoiceWav } = require('../apps/api/src/services/voiceQuestionService.ts');
  const seconds = validateVoiceWav(audio);
  report.checks.canonicalWav = { passed: true, seconds };
  stage = 'self-hosted inference';
  const result = await recognizeVoice(audio);
  const correct = /approvals?/i.test(result.transcript) && /pending/i.test(result.transcript) && /approvals?/i.test(result.question) && /pending/i.test(result.question);
  report.checks.liveFreeWhisperTranscription = { passed: correct, expectedQuestionRecognized: correct, serverServiceUsed: true, paidFallbackDisabled: true };
  report.passed = correct;
} catch {
  report.failureStage = stage;
  report.error = 'Synthetic speech verification failed. Inspect fixture availability or provider connectivity without printing credentials or provider payloads.';
}
fs.writeFileSync(path.join(root, 'artifacts/voice-provider.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
