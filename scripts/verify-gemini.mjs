// Real provider check using synthetic text only. Never prints provider errors or credentials.
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { sourceEnvironment, root } from './predeployment-config.mjs';

const source = sourceEnvironment();
const generationOnly = process.argv.includes('--generation-only');
const report = { timestamp: new Date().toISOString(), passed: false, checks: {}, scope: generationOnly ? 'generation only' : 'generation and embeddings', syntheticInputOnly: true };
if (!source.GEMINI_API_KEY) report.checks.credentials = { passed: false, reason: 'GEMINI_API_KEY missing' };
else {
  const ai = new GoogleGenAI({ apiKey: source.GEMINI_API_KEY, httpOptions: { timeout: 60000, retryOptions: { attempts: 1 } } });
  const checks = [
    ['generation', async () => {
      const model = source.GEMINI_MODEL || 'gemini-3.8-flash';
      const thinkingConfig = /^gemini-3\./.test(model) ? { thinkingLevel: ThinkingLevel.LOW } : undefined;
      const response = await ai.models.generateContent({ model, contents: 'Reply with only the word READY.', config: { temperature: 0, maxOutputTokens: 512, thinkingConfig } });
      if (!response.text?.trim()) throw new Error('empty response');
      return { model, nonemptyResponse: true };
    }],
    ['embeddings', async () => {
      const model = source.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
      const response = await ai.models.embedContent({ model, contents: 'Synthetic deployment readiness check.', config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 } });
      const vector = response.embeddings?.[0]?.values;
      if (vector?.length !== 768 || !vector.every(Number.isFinite)) throw new Error('invalid vector');
      return { model, dimensions: vector.length };
    }],
  ];
  for (const [name, check] of checks) {
    if (generationOnly && name !== 'generation') continue;
    try { report.checks[name] = { passed: true, ...await check() }; }
    catch (error) {
      const status = Number(error.status || error.code) || null;
      report.checks[name] = { passed: false, model: name === 'generation' ? source.GEMINI_MODEL || 'gemini-3.8-flash' : source.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001', status, category: status === 429 ? 'quota/rate limit' : status === 404 ? 'model unavailable' : [400, 401, 403].includes(status) ? 'credential/request/access rejected' : 'network/provider failure' };
    }
  }
}
report.passed = Object.values(report.checks).every(check => check.passed);
fs.writeFileSync(path.join(root, generationOnly ? 'artifacts/predeployment-gemini-generation.json' : 'artifacts/predeployment-gemini.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
