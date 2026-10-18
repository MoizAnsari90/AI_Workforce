import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = ts.transpileModule(fs.readFileSync('apps/web/lib/companion.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {} }; vm.runInNewContext(compiled, context);
const { voiceCompanionState: voice, assistantCompanionState: assistant } = context.exports;
test('listening is shown only for actual recording, not permission, preview or idle', () => {
  for (const stage of ['permission', 'ready', 'idle']) assert.equal(voice(stage, false), 'ready');
  assert.equal(voice('recording', false), 'listening');
  assert.equal(voice('preparing', false), 'thinking'); assert.equal(voice('uploading', false), 'thinking');
  assert.equal(voice('idle', true), 'error');
});
test('active work takes priority over a previous answer and errors are not reported as success', () => {
  assert.equal(assistant(true, 'ready', { answer: 'Previous answer' }), 'thinking');
  assert.equal(assistant(false, 'listening', { answer: 'Previous answer' }), 'listening');
  assert.equal(assistant(false, 'error', { answer: 'Previous answer' }), 'error');
  assert.equal(assistant(false, 'ready', { error: 'Failed' }), 'error');
  assert.equal(assistant(false, 'ready', { answer: 'Answer' }), 'answered');
  assert.equal(assistant(false, 'ready'), 'ready');
});
