import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './predeployment-config.mjs';

export async function checkCompanionBrowser({ protocol, navigate, screenshot }) {
  const report = { timestamp: new Date().toISOString(), passed: false, checks: {} };
  let stage = 'asset';
  const language = async locale => {
    await protocol.evaluate(`(()=>{const select=document.querySelector('.wf-language-control select');select.value=${JSON.stringify(locale)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await protocol.wait(`document.documentElement.lang===${JSON.stringify(locale)}`);
  };
  try {
    await protocol.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'prefers-color-scheme', value: 'dark' }] });
    await protocol.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    await navigate('/dashboard'); await language('en');
    await protocol.evaluate('document.querySelector(".wf-companion").scrollIntoView({block:"center"})');
    await protocol.wait('document.querySelector(".wf-companion img")?.complete && document.querySelector(".wf-companion img").naturalWidth>0');
    assert.equal(await protocol.evaluate('document.querySelector(".wf-companion img").naturalWidth'), 640);
    assert.equal(await protocol.evaluate('document.querySelector(".wf-dashboard-rail").firstElementChild.matches(".wf-companion") && document.querySelector(".wf-companion").nextElementSibling.matches(".wf-attention")'), true);
    report.checks.optimizedAssetAndRequestedPlacement = true;
    stage = 'responsive matrix';
    for (const locale of ['en', 'ur', 'ar']) {
      await language(locale);
      for (const width of [320, 390, 768, 1024, 1366, 1440, 1920]) {
        await protocol.send('Emulation.setDeviceMetricsOverride', { width, height: 1050, deviceScaleFactor: 1, mobile: width < 700 });
        await protocol.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const bounds = await protocol.evaluate('(()=>{const el=document.querySelector(".wf-companion"),r=el.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth+2}})()');
        assert.equal(bounds.overflow, false, `${locale} ${width}: horizontal overflow`);
        assert.ok(bounds.left >= 0 && bounds.right <= width + 1, `${locale} ${width}: companion outside viewport`);
        if (width < 700) assert.ok(bounds.height < 230, 'Mobile companion must stay compact');
        const chatGap = await protocol.evaluate('(()=>{const chat=document.querySelector(".wf-dashboard-primary .wf-assistant").getBoundingClientRect(),cards=document.querySelector(".wf-dashboard-primary .wf-bottom-grid").getBoundingClientRect();return cards.top-chat.bottom})()');
        assert.ok(chatGap >= 16 && chatGap <= 24, `${locale} ${width}: unexpected gap below chat (${chatGap}px)`);
        report.checks[`${locale}:${width}px`] = true;
        if (locale === 'en' && width === 1440 || locale === 'ar' && width === 390 || locale === 'en' && width === 768) {
          await protocol.evaluate('document.querySelector(".wf-companion").scrollIntoView({block:"center"})');
          await screenshot(`companion-${locale}-${width}`);
        }
      }
    }
    stage = 'animation controls'; await language('en');
    const pause = 'document.querySelector(".wf-companion-heading button")';
    await protocol.evaluate(`${pause}.click()`);
    assert.equal(await protocol.evaluate('getComputedStyle(document.querySelector(".wf-companion-portrait")).animationName'), 'none');
    assert.equal(await protocol.evaluate(`${pause}.getAttribute('aria-pressed')`), 'true');
    await protocol.evaluate(`${pause}.click()`);
    report.checks.pauseAndResume = true;
    await protocol.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await protocol.evaluate('getComputedStyle(document.querySelector(".wf-companion-portrait")).animationName'), 'none');
    report.checks.reducedMotionStatic = true;
    stage = 'theme matrix';
    await protocol.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await protocol.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['light', 'dark']) {
      await protocol.evaluate('document.querySelector(".wf-appearance-trigger").click()');
      await protocol.wait('!!document.querySelector(".wf-appearance-panel")');
      await protocol.evaluate(`(()=>{const el=document.querySelector('.wf-appearance-panel select');el.value=${JSON.stringify(theme)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await protocol.evaluate('document.querySelector(".wf-appearance-close").click()');
      await protocol.wait(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);
      await protocol.evaluate('document.querySelector(".wf-companion").scrollIntoView({block:"center"})');
      await screenshot(`companion-${theme}`); report.checks[`${theme}:rendering`] = true;
    }
    await protocol.evaluate('document.querySelector(".wf-companion-footer a").click()');
    assert.equal(await protocol.evaluate('document.activeElement.id'), 'workforce-question');
    report.checks.chatShortcutFocus = true;
    report.passed = true;
  } catch (error) { report.error = { stage, message: error.code === 'ERR_ASSERTION' || error.message?.startsWith('Browser') ? error.message : 'Companion browser verification failed' }; }
  finally { fs.writeFileSync(path.join(root, 'artifacts/companion-browser.json'), JSON.stringify(report, null, 2)); }
  assert.ok(report.passed, `Companion browser verification failed at ${stage}`);
  return report;
}
