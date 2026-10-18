import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function dashboardOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      /^(localhost|127\.|\[::1\])|\.example\.(com|test)$/.test(url.hostname)) {
    throw new Error('Set DEPLOY_WEB_URL to the actual public HTTPS Vercel origin, without a path.');
  }
  return url.origin;
}

export function prepareFirebaseHosting(value, outputRoot) {
  const origin = dashboardOrigin(value);
  const escaped = origin.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="AI Workforce: your AI team for business operations, powered by Gemini.">
<title>AI Workforce</title><style>
:root{color-scheme:dark light;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#0b131b;color:#e6f1f5}main{width:min(100%,680px);padding:clamp(24px,6vw,56px);border:1px solid #3b5765;border-radius:24px;background:radial-gradient(ellipse at top right,#1c3c3b,transparent),#12212c}p{line-height:1.8;color:#b8ccd7}small{color:#9be3cf;letter-spacing:.12em}h1{font-size:clamp(36px,8vw,64px);letter-spacing:-.04em;margin:24px 0 12px}a{display:inline-block;margin-top:16px;padding:14px 22px;border-radius:12px;background:#9be3cf;color:#0b2821;text-decoration:none;font-weight:650}a:focus-visible{outline:3px solid white;outline-offset:5px}footer{margin-top:32px;font-size:13px;color:#b8ccd7}@media(prefers-color-scheme:light){body{background:#edf5f4;color:#102c32}main{background:#fff;border-color:#8eacae}p,footer{color:#395960}small{color:#216a5a}a:focus-visible{outline-color:#102c32}}
</style></head><body><main><small>YOUR AI, AT WORK</small><h1>AI Workforce</h1>
<p>Bring your team, approvals and business operations into focus. Ask questions in text or voice and get answers grounded in your workspace.</p>
<a href="${escaped}/dashboard">Open your workspace &rarr;</a>
<footer>Gemini powers AI features. This entry page is served by Firebase Hosting; the dashboard and API run on Vercel.</footer>
</main></body></html>`;
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, 'index.html'), html);
  fs.writeFileSync(path.join(outputRoot, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Page not found</title><h1>Page not found</h1><p><a href="/">Return to AI Workforce</a></p></html>');
  return { dashboardOrigin: origin, files: ['index.html', '404.html'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = prepareFirebaseHosting(process.env.DEPLOY_WEB_URL, path.join(root, 'deploy/firebase/public'));
    console.log(JSON.stringify({ passed: true, ...result, note: 'Static entry page only; no Next.js server code or credentials are published.' }, null, 2));
  } catch {
    console.error('Set DEPLOY_WEB_URL to your actual HTTPS Vercel origin before preparing Firebase Hosting.');
    process.exitCode = 1;
  }
}
