// Real Chromium layout measurements with fixture-only workspace API data.
// No customer account, credentials, database writes, or provider calls are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const origin = process.env.LAYOUT_TEST_ORIGIN || 'https://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Use a local dev server');
const executable = [process.env.LAYOUT_TEST_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(value => value && fs.existsSync(value));
assert.ok(executable, 'Chromium browser is required');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-scroll-'));
const pending = new Map();
let browser, socket, sessionId, sequence = 0, closing = false;
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
  throw new Error('Workspace page did not become ready');
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
  if (pathname.endsWith('/whatsapp/onboarding/connection')) return { connected: false };
  if (pathname.endsWith('/whatsapp/onboarding/config')) return { appId: 'fixture', configId: 'fixture', graphApiVersion: 'v26.0' };
  if (pathname.endsWith('/store-reports')) return { settings: { enabled: false, recipient: '', deliveryTime: '09:00', templateName: '', templateLanguage: 'en_US', consent: false, timezone: 'Asia/Karachi' }, reports: [] };
  if (pathname.endsWith('/workforce/ask')) return { answer: Array(90).fill('Fixture answer for checking conversation scrolling.').join('\n'), source: 'database' };
  return {};
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
      void send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ success: true, data: fixture(message.params.request.url) })).toString('base64') }, message.sessionId).catch(error => { if (!closing && !error.message.includes('Invalid InterceptionId')) console.error(error.message); });
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('ai-workforce.appearance.v1', JSON.stringify({theme:'dark',palette:'standard',contrast:'standard'})); } catch {}` });
  await send('Network.setCookie', { name: 'token', value: 'scroll-fixture-only', url: origin, secure: origin.startsWith('https:') });
  await send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/api/*`, requestStage: 'Request' }] });
  const failures = [];
  async function screenshot(name) {
    fs.mkdirSync('.local', { recursive: true });
    const result = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join('.local', name), Buffer.from(result.data, 'base64'));
  }
  function check(label, metrics, passed) {
    console.log(JSON.stringify({ check: label, ...metrics, passed }));
    if (!passed) failures.push(label);
  }
  for (const width of [320, 390, 600, 1200]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: origin + '/dashboard' });
    await wait("!!document.querySelector('.wf-conversation') && !!document.querySelector('.wf-topbar .wf-appearance-trigger:not(:disabled)')");
    const header = await evaluate(`(() => {
      const bar = document.querySelector('.wf-topbar').getBoundingClientRect();
      const button = document.querySelector('.wf-topbar .wf-appearance-trigger').getBoundingClientRect();
      const language = document.querySelector('.wf-topbar select').getBoundingClientRect();
      return { width: innerWidth, bottomGap: bar.bottom - button.bottom, centerDifference: Math.abs((language.top + language.bottom - button.top - button.bottom) / 2), overflow: document.documentElement.scrollWidth - innerWidth };
    })()`);
    check('header-' + width, header, header.bottomGap >= 8 && header.centerDifference <= 1 && header.overflow <= 1);
    if (width === 390) await screenshot('workspace-layout-mobile.png');
    await evaluate("document.querySelector('.wf-topbar .wf-appearance-trigger').click()");
    const popover = await evaluate(`(() => { const r = document.querySelector('.wf-appearance-panel').getBoundingClientRect(); return { left: r.left, right: r.right, viewport: innerWidth }; })()`);
    check('appearance-menu-' + width, popover, popover.left >= 0 && popover.right <= width);
    await send('Page.navigate', { url: origin + '/dashboard/reports' });
    await wait("!!document.querySelector('input[type=date]')");
    const report = await evaluate(`(() => {
      const input = document.querySelector('input[type=date]').getBoundingClientRect();
      const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Preview report')).getBoundingClientRect();
      return { inputTop: input.top, inputBottom: input.bottom, buttonTop: button.top, buttonBottom: button.bottom, buttonLeft: button.left, inputRight: input.right, overflow: document.documentElement.scrollWidth - innerWidth };
    })()`);
    check('report-preview-' + width, report, report.overflow <= 1 && (width > 700 ? Math.abs(report.inputTop - report.buttonTop) <= 1 && Math.abs(report.inputBottom - report.buttonBottom) <= 1 && report.buttonLeft >= report.inputRight : report.buttonTop >= report.inputBottom));
    if (width === 1200) await screenshot('workspace-layout-report.png');
    if (width >= 1200) {
      await send('Page.navigate', { url: origin + '/dashboard/settings/whatsapp' });
      await wait("document.querySelector('.wf-whatsapp-setup .wf-badge')?.textContent === 'Not connected' && !!document.querySelector('.wf-onboarding-aside > .wf-access-note')");
      const panels = await evaluate(`(() => {
        const left = document.querySelector('.wf-whatsapp-setup').getBoundingClientRect();
        const note = document.querySelector('.wf-onboarding-aside > .wf-access-note').getBoundingClientRect();
        return { leftBottom: left.bottom, noteBottom: note.bottom, difference: Math.abs(left.bottom - note.bottom) };
      })()`);
      check('whatsapp-bottom-' + width, panels, panels.difference <= 1);
      await screenshot('workspace-layout-whatsapp.png');
    }
  }
  assert.deepEqual(failures, [], 'Workspace controls and panels must align');
  console.log('PASS: 13 workspace layout checks');

} finally {
  closing = true;
  try { if (socket?.readyState === WebSocket.OPEN) await send('Browser.close', {}, null); } catch {}
  socket?.close();
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Browser closed')); }
  if (browser && browser.exitCode === null) browser.kill();
  const relativeProfile = path.relative(os.tmpdir(), profile);
  assert.match(relativeProfile, /^dashboard-scroll-[^\\/]+$/, 'Only remove the generated temporary profile');
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch { console.warn('Temporary browser profile cleanup deferred until its files are released'); }
}
