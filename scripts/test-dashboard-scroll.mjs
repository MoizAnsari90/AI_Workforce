// Real Chromium wheel input against the live dashboard with fixture-only API data.
// No customer account, credentials, database writes, or provider calls are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const origin = process.env.SCROLL_TEST_ORIGIN || 'https://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Use a local dev server');
const executable = [process.env.SCROLL_TEST_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(value => value && fs.existsSync(value));
assert.ok(executable, 'Chromium browser is required');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-scroll-'));
const pending = new Map();
let browser, socket, sessionId, sequence = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}, session = sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!result.exceptionDetails, 'Browser evaluation failed');
  return result.result.value;
}
async function wait(expression) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await pause(150);
  }
  throw new Error('Dashboard did not become ready');
}
const tenantId = '00000000-0000-4000-8000-000000000001';
function fixture(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/auth/me') return { userId: 'scroll-fixture', tenantId, tenantName: 'Scroll fixture', email: 'fixture@example.invalid', role: 'admin', permissions: [] };
  if (pathname.endsWith('/onboarding-status')) return { needsOnboarding: false, nextStep: 'dashboard' };
  if (pathname.endsWith('/operations/dashboard')) return {
    inventoryCount: 0, lowStockAlerts: 0, pendingApprovals: 0, tasksCompleted: 0,
    aiRepliesPer100Inbound: null, businessProfile: { profile: { industry: 'ecommerce' } },
    checkedAt: new Date().toISOString(), recentActivity: [],
    agents: [{ id: 'fixture-agent', name: 'E-commerce Operations AI Bundle Worker', department: 'operations', isActive: true, _count: { tasks: 0 }, tasks: [] }],
  };
  if (pathname.endsWith('/workforce/ask')) return { answer: Array(90).fill('Fixture answer for checking conversation scrolling.').join('\n'), source: 'database' };
  return {};
}

async function wheelOverConversation(deltaY, innerPosition) {
  const before = await evaluate(`(() => {
    const log = document.querySelector('.wf-conversation');
    const top = log.getBoundingClientRect().top + scrollY;
    window.scrollTo(0, top - 350);
    log.scrollTop = ${innerPosition === 'bottom' ? 'log.scrollHeight' : '0'};
    const rect = log.getBoundingClientRect();
    return { page: scrollY, pageMax: document.scrollingElement.scrollHeight - innerHeight, chat: log.scrollTop, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(before.y > 0 && before.y < 900, 'Wheel target must be inside the viewport');
  assert.ok(deltaY > 0 ? before.pageMax - before.page > 1 : before.page > 1, 'The page must have room to scroll in the requested direction');
  await pause(100);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y });
  // Complete gestures include wheel begin/end phases and settle fractional pixels.
  await send('Input.synthesizeScrollGesture', { x: before.x, y: before.y, yDistance: -deltaY, speed: 1000, gestureSourceType: 'mouse' });
  await pause(400);
  if (innerPosition === 'bottom' && deltaY > 0) {
    // Chromium can consume the first gesture rounding a programmatically set
    // fractional bottom offset by one pixel. Continued scrolling must chain.
    await send('Input.synthesizeScrollGesture', { x: before.x, y: before.y, yDistance: -deltaY, speed: 1000, gestureSourceType: 'mouse' });
    await pause(400);
  }
  const after = await evaluate(`(() => { const log = document.querySelector('.wf-conversation'); return { page: scrollY, chat: log.scrollTop, chatMax: log.scrollHeight - log.clientHeight, overscroll: getComputedStyle(log).overscrollBehaviorY }; })()`);
  return { pageDelta: after.page - before.page, chatDelta: after.chat - before.chat };
}

try {
  browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--ignore-certificate-errors', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let launchError;
  browser.on('error', error => { launchError = error; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 45_000;
  while (!fs.existsSync(portFile) && !launchError && browser.exitCode === null && Date.now() < deadline) await pause(100);
  if (launchError) throw launchError;
  assert.ok(fs.existsSync(portFile), 'Browser debugging port unavailable');
  const [port, socketPath] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Fetch.requestPaused') {
      void send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ success: true, data: fixture(message.params.request.url) })).toString('base64') }, message.sessionId).catch(error => console.error(error.message));
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  const target = await send('Target.createTarget', { url: 'about:blank' });
  sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.setCookie', { name: 'token', value: 'scroll-fixture-only', url: origin, secure: origin.startsWith('https:') });
  await send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/api/*`, requestStage: 'Request' }] });
  const failures = [];
  for (const width of [1800, 1200, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${origin}/dashboard` });
    await wait(`!!document.querySelector('.wf-conversation') && !!document.querySelector('.wf-bundle-agent')`);
    for (const [label, deltaY, boundary] of [['empty-down', 300, 'bottom'], ['empty-up', -150, 'top']]) {
      const result = await wheelOverConversation(deltaY, boundary);
      const passed = Math.sign(result.pageDelta) === Math.sign(deltaY);
      console.log(JSON.stringify({ width, check: label, ...result, passed }));
      if (!passed) failures.push(`${width}px ${label}: page scroll is trapped`);
    }
    await evaluate(`document.querySelector('.wf-suggestions button').click()`);
    await wait(`document.querySelector('.wf-answer p')?.textContent.includes('Fixture answer')`);
    const within = await wheelOverConversation(150, 'top');
    const withinPassed = within.chatDelta > 0 && within.pageDelta === 0;
    console.log(JSON.stringify({ width, check: 'scroll-history', ...within, passed: withinPassed }));
    if (!withinPassed) failures.push(`${width}px conversation history does not scroll independently`);
    for (const [label, deltaY, boundary] of [['history-bottom', 300, 'bottom'], ['history-top', -150, 'top']]) {
      const result = await wheelOverConversation(deltaY, boundary);
      const passed = Math.sign(result.pageDelta) === Math.sign(deltaY);
      console.log(JSON.stringify({ width, check: label, ...result, passed }));
      if (!passed) failures.push(`${width}px ${label}: page scroll is trapped`);
    }
  }
  assert.deepEqual(failures, [], 'Wheel scrolling should pass to the page at chat boundaries');
  console.log('PASS: 15 dashboard scroll checks across desktop, tablet and narrow layouts');
} finally {
  try { if (socket?.readyState === WebSocket.OPEN) await send('Browser.close', {}, null); } catch {}
  socket?.close();
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Browser closed')); }
  if (browser && browser.exitCode === null) browser.kill();
  const relativeProfile = path.relative(os.tmpdir(), profile);
  assert.match(relativeProfile, /^dashboard-scroll-[^\\/]+$/, 'Only remove the generated temporary profile');
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch { console.warn('Temporary browser profile cleanup deferred until its files are released'); }
}
