// Headless Chromium/Edge checks against the isolated predeployment application.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root } from './predeployment-config.mjs';

class Protocol {
  constructor(url) { this.url = url; this.sequence = 0; this.pending = new Map(); this.handlers = new Set(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const entry = this.pending.get(message.id); if (!entry) return;
        this.pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(`${entry.method}: browser protocol command failed`)); else entry.resolve(message.result);
      } else for (const handler of this.handlers) handler(message);
    });
  }
  send(method, params = {}, sessionId = this.sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 20000);
      this.pending.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(expression, sessionId = this.sessionId) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${expression.slice(0, 150)}`);
    return result.result.value;
  }
  async wait(expression, sessionId = this.sessionId) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      try { if (await this.evaluate(expression, sessionId)) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`Browser condition timed out: ${expression.slice(0, 140)}`);
  }
  close() { for (const item of this.pending.values()) clearTimeout(item.timer); this.socket?.close(); }
}

export async function checkAppearanceBrowser({ origin, cookie, session }) {
  const base = path.resolve(root, '.local/theme-browser'); fs.mkdirSync(base, { recursive: true });
  const profile = fs.mkdtempSync(path.join(base, 'run-'));
  const screenshots = path.join(root, 'artifacts/appearance'); fs.mkdirSync(screenshots, { recursive: true });
  const candidates = [process.env.BROWSER_EXECUTABLE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
  const executable = candidates.find(file => fs.existsSync(file));
  const report = { timestamp: new Date().toISOString(), passed: false, checks: {}, screenshots: [], hydrationWarnings: 0, note: 'Real isolated application; cookie installed only in a temporary browser profile. UI session responses reuse an independently validated real session to avoid consuming the auth rate limit during the reload matrix. Onboarding redirect is bypassed only in the browser test response for the overview. No actual integration readiness is changed.' };
  let browser, protocol;
  try {
    assert.ok(executable, 'A Chromium-based browser is required');
    browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', ...(process.argv.includes('--voice-browser') || process.argv.includes('--companion-browser') ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : []), '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => {});
    const portFile = path.join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(portFile) && Date.now() < deadline) {
      if (browser.exitCode !== null) throw new Error('Browser exited before debugging became ready');
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const [port, socketPath] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    protocol = new Protocol(`ws://127.0.0.1:${port}${socketPath}`); await protocol.connect();
    const target = await protocol.send('Target.createTarget', { url: 'about:blank' }, null);
    protocol.sessionId = (await protocol.send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await protocol.send('Page.enable'); await protocol.send('Runtime.enable'); await protocol.send('Network.enable');
    await protocol.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await protocol.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    await protocol.send('Network.setCookie', { name: 'token', value: token, url: origin, httpOnly: true, secure: false, sameSite: 'Lax' });
    let overview = false;
    let voiceHandler;
    protocol.handlers.add(event => {
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        const text = event.params.args.map(arg => arg.value || arg.description || '').join(' ');
        if (/hydration|did not match|server rendered HTML/i.test(text)) report.hydrationWarnings++;
      }
      if (event.method === 'Fetch.requestPaused') {
        const request = event.params;
        if (new URL(request.request.url).pathname === '/api/voice/transcribe' && voiceHandler) {
          Promise.resolve(voiceHandler(event)).catch(() => {});
        } else if (new URL(request.request.url).pathname === '/api/auth/me') {
          protocol.send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(session)).toString('base64') }, event.sessionId).catch(() => {});
        } else if (request.request.url.includes('/onboarding-status') && overview) {
          protocol.send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ success: true, data: { needsOnboarding: false, nextStep: 'ready' } })).toString('base64') }, event.sessionId).catch(() => {});
        } else if (request.request.url.includes('/onboarding-status')) protocol.send('Fetch.continueRequest', { requestId: request.requestId }, event.sessionId).catch(() => {});
        else protocol.send('Fetch.failRequest', { requestId: request.requestId, errorReason: 'BlockedByClient' }, event.sessionId).catch(() => {});
      }
    });
    const key = 'ai-workforce.appearance.v1';
    const initial = { theme: 'dark', palette: 'accessible', contrast: 'high' };
    const seed = await protocol.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify(initial))})}catch{}` });
    // Blocking JavaScript bundles proves the inline initializer works without React effects.
    await protocol.send('Fetch.enable', { patterns: [{ resourceType: 'Script', requestStage: 'Request' }] });
    await protocol.send('Page.navigate', { url: `${origin}/login` });
    await protocol.wait('document.documentElement.dataset.palette === "accessible" && document.documentElement.dataset.contrast === "high" && !!document.querySelector(".wf-auth-panel")');
    assert.equal(await protocol.evaluate('document.documentElement.dataset.theme'), 'dark');
    report.checks.beforeHydration = true;
    await protocol.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier });
    await protocol.send('Fetch.disable');
    // Intercept only the onboarding guard, leaving all application data requests real.
    await protocol.send('Fetch.enable', { patterns: [{ urlPattern: '*onboarding-status*', requestStage: 'Request' }, { urlPattern: '*/api/auth/me', requestStage: 'Request' }] });

    async function navigate(route) {
      overview = route === '/dashboard';
      await protocol.send('Page.navigate', { url: `${origin}${route}` });
      await protocol.wait(`location.pathname === ${JSON.stringify(route)} && document.readyState === "complete" && !!document.querySelector('.wf-appearance-trigger')`);
      await protocol.wait('!!document.querySelector(".wf-appearance-trigger svg")');
      await protocol.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    }
    async function open(sessionId = protocol.sessionId) {
      await protocol.wait('document.querySelector(".wf-appearance-trigger")?.disabled === false', sessionId);
      await protocol.evaluate('document.querySelector(".wf-appearance-trigger").click()', sessionId);
      await protocol.wait('!!document.querySelector(".wf-appearance-panel") && document.activeElement?.tagName === "SELECT"', sessionId);
    }
    async function select(index, value, sessionId = protocol.sessionId) {
      await protocol.evaluate(`(()=>{const el=document.querySelectorAll('.wf-appearance-panel select')[${index}];el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`, sessionId);
    }
    async function settings(theme, palette, contrast) {
      await open(); await select(0, theme); await select(1, palette);
      await protocol.evaluate(`(()=>{const el=document.querySelector('.wf-appearance-contrast input');if(el.checked!==${contrast === 'high'})el.click()})()`);
      await protocol.wait(`document.documentElement.dataset.theme === ${JSON.stringify(theme)} && document.documentElement.dataset.palette === ${JSON.stringify(palette)} && document.documentElement.dataset.contrast === ${JSON.stringify(contrast)}`);
      await protocol.evaluate('document.querySelector(".wf-appearance-close").click()');
    }
    async function screenshot(name) {
      const result = await protocol.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(screenshots, `${name}.png`), Buffer.from(result.data, 'base64'));
      report.screenshots.push(`artifacts/appearance/${name}.png`);
    }
    await navigate('/dashboard'); await protocol.wait('!!document.querySelector(".wf-dashboard-home .wf-stats")');
    for (const theme of ['light', 'dark']) for (const palette of ['standard', 'accessible']) for (const contrast of ['standard', 'high']) {
      await settings(theme, palette, contrast);
      const saved = await protocol.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
      assert.deepEqual(saved, { theme, palette, contrast });
      const colors = await protocol.evaluate('({fg:getComputedStyle(document.querySelector(".wf-shell")).color,bg:getComputedStyle(document.body).backgroundColor})');
      assert.notEqual(colors.fg, colors.bg);
      report.checks[`${theme}/${palette}/${contrast}`] = true;
      if (palette === 'standard' && contrast === 'standard' || palette === 'accessible' && contrast === 'high') await screenshot(`dashboard-${theme}-${palette}-${contrast}`);
    }
    await settings('light', 'standard', 'standard');
    await protocol.send('Page.reload'); await protocol.wait('document.readyState === "complete" && document.documentElement.dataset.theme === "light"');
    await open(); assert.equal(await protocol.evaluate('document.querySelectorAll(".wf-appearance-panel select")[0].value'), 'light');
    await protocol.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await protocol.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await protocol.evaluate('document.activeElement === document.querySelectorAll(".wf-appearance-panel select")[1]'), true);
    await protocol.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await protocol.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await protocol.wait('!document.querySelector(".wf-appearance-panel") && document.activeElement.classList.contains("wf-appearance-trigger")');
    report.checks.refreshPersistence = true; report.checks.keyboardFocusAndEscape = true;
    await open();
    const outside = await protocol.evaluate('(()=>{const r=document.querySelector(".wf-breadcrumb").getBoundingClientRect();return {x:r.left+10,y:r.top+10}})()');
    await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...outside, button: 'left', clickCount: 1 });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...outside, button: 'left', clickCount: 1 });
    await protocol.wait('!document.querySelector(".wf-appearance-panel")');
    report.checks.outsideClickDismissal = true;

    // Real cross-tab storage events, using a second page in the same temporary profile.
    const second = await protocol.send('Target.createTarget', { url: `${origin}/login` }, null);
    const session2 = (await protocol.send('Target.attachToTarget', { targetId: second.targetId, flatten: true }, null)).sessionId;
    await protocol.send('Runtime.enable', {}, session2);
    await protocol.wait('document.readyState === "complete" && !!document.querySelector(".wf-appearance-trigger")', session2);
    await open(session2); await select(0, 'dark', session2);
    await protocol.wait('document.documentElement.dataset.theme === "dark"');
    report.checks.crossTabSync = true;
    await protocol.send('Target.closeTarget', { targetId: second.targetId }, null);
    await open(); await select(0, 'system');
    await protocol.wait('document.documentElement.dataset.theme === "light"');
    await protocol.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await protocol.wait('document.documentElement.dataset.theme === "dark"');
    await select(0, 'light');
    await protocol.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    assert.equal(await protocol.evaluate('document.documentElement.dataset.theme'), 'light');
    await protocol.evaluate('document.querySelector(".wf-appearance-close").click()');
    report.checks.systemChangesAndManualOverride = true;

    for (const route of ['/', '/login', '/register', '/dashboard/onboarding', '/dashboard/settings/business', '/dashboard/settings/whatsapp', '/dashboard/integrations', '/dashboard/billing', '/dashboard/healthcare', '/dashboard/real-estate', '/dashboard/support-inbox', '/dashboard/reports', '/dashboard/approvals', '/dashboard/templates', '/dashboard/voice-logs', '/missing-appearance-test-page']) {
      await navigate(route);
      assert.equal(await protocol.evaluate('document.documentElement.dataset.theme'), 'light');
      report.checks[`route:${route}`] = true;
    }
    // Inspect mobile and vision modes on a real form without requiring a connected bundle.
    await navigate('/dashboard/settings/business');
    await protocol.wait('!!document.querySelector(".wf-field")');
    await protocol.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
    await open();
    const bounds = await protocol.evaluate('(()=>{const r=document.querySelector(".wf-appearance-panel").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()');
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height);
    await screenshot('mobile-appearance-menu');
    await protocol.evaluate('document.querySelector(".wf-appearance-close").click()');
    report.checks.mobileMenuWithinViewport = true;
    await protocol.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await settings('light', 'accessible', 'standard');
    for (const type of ['deuteranopia', 'protanopia', 'tritanopia']) {
      await protocol.send('Emulation.setEmulatedVisionDeficiency', { type });
      await screenshot(`accessible-${type}`);
    }
    await protocol.send('Emulation.setEmulatedVisionDeficiency', { type: 'none' });
    report.checks.colorVisionSimulationScreenshots = true;
    await protocol.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    assert.equal(await protocol.evaluate('matchMedia("(forced-colors: active)").matches'), true);
    report.checks.forcedColors = true;
    await protocol.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }] });
    assert.equal(await protocol.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
    const reducedDuration = await protocol.evaluate('(()=>{const el=document.createElement("span");el.className="wf-spin";document.body.append(el);const duration=getComputedStyle(el).animationDuration;el.remove();return parseFloat(duration)})()');
    assert.ok(reducedDuration <= .001, 'Reduced motion must shorten animations');
    report.checks.reducedMotion = true;

    await protocol.evaluate(`localStorage.setItem(${JSON.stringify(key)},'{malformed')`);
    await navigate('/login');
    await protocol.wait('document.documentElement.dataset.theme === "light" && document.documentElement.dataset.palette === "standard"');
    report.checks.invalidStorageFallback = true;
    const blocked = await protocol.send('Page.addScriptToEvaluateOnNewDocument', { source: 'Storage.prototype.getItem=function(){throw new DOMException("Blocked","SecurityError")};Storage.prototype.setItem=function(){throw new DOMException("Blocked","SecurityError")};' });
    await navigate('/login'); await open(); await select(0, 'dark');
    await protocol.wait('document.documentElement.dataset.theme === "dark"');
    report.checks.blockedStorageSessionStillWorks = true;
    await protocol.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.identifier });
    if (process.argv.includes('--language-browser')) {
      const { checkLanguageBrowser } = await import('./check-language-browser.mjs');
      const language = await checkLanguageBrowser({ protocol, navigate, screenshot, origin, cookie });
      report.checks.languages = { passed: language.passed, report: 'artifacts/language-browser.json' };
    }
    if (process.argv.includes('--voice-browser') || process.argv.includes('--companion-browser')) {
      const { checkVoiceBrowser } = await import('./check-voice-browser.mjs');
      const voice = await checkVoiceBrowser({ protocol, navigate, screenshot, setVoiceHandler: handler => { voiceHandler = handler; } });
      report.checks.voice = { passed: voice.passed, report: 'artifacts/voice-browser.json' };
    }
    if (process.argv.includes('--companion-browser')) {
      const { checkCompanionBrowser } = await import('./check-companion-browser.mjs');
      const companion = await checkCompanionBrowser({ protocol, navigate, screenshot });
      report.checks.companion = { passed: companion.passed, report: 'artifacts/companion-browser.json' };
    }
    assert.equal(report.hydrationWarnings, 0, 'Hydration warning detected');
    report.passed = true;
  } catch (error) {
    report.error = error.message?.startsWith('Browser') || error.code === 'ERR_ASSERTION' ? error.message : 'Browser verification failed; credential-bearing details suppressed';
  } finally {
    try { await protocol?.send('Browser.close', {}, null); } catch {}
    protocol?.close();
    if (browser && browser.exitCode === null) {
      await new Promise(resolve => { const timer = setTimeout(() => { browser.kill(); resolve(); }, 5000); browser.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    // Resolve and verify the exact owned temporary directory before recursive removal.
    const resolved = path.resolve(profile); const relative = path.relative(base, resolved);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.dirname(resolved) === base) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); report.profileRemoved = true; } catch { report.profileRemoved = false; }
    }
    fs.writeFileSync(path.join(root, 'artifacts/appearance-browser.json'), JSON.stringify(report, null, 2));
  }
  return report;
}
