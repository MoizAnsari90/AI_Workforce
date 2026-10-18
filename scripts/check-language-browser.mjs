import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './predeployment-config.mjs';

/** Reuses the isolated Chromium session, real local application and safe auth fixture. */
export async function checkLanguageBrowser({ protocol, navigate, screenshot, origin, cookie }) {
  const report = { timestamp: new Date().toISOString(), passed: false, checks: {}, locales: ['en', 'ur', 'ar'], note: 'UI verification on the isolated local application. Unknown provider messages, customer records, conversations and AI responses retain their original content.' };
  const labels = { en: 'Workspace', ur: 'ورک اسپیس', ar: 'مساحة العمل' };
  const titles = { en: 'Built around your business.', ur: 'آپ کے کاروبار کے مطابق۔', ar: 'مصمم لنشاطك.' };
  let stage = 'initialization';
  const select = async locale => {
    await protocol.evaluate(`(()=>{const select=document.querySelector('.wf-language-control select');select.value=${JSON.stringify(locale)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await protocol.wait(`document.documentElement.lang===${JSON.stringify(locale)} && document.querySelector('.wf-language-control select')?.value===${JSON.stringify(locale)}`);
    await protocol.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  };
  try {
    await protocol.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await protocol.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate('/dashboard/settings/business');
    const choices = await protocol.evaluate('Array.from(document.querySelectorAll(".wf-language-control option"), option=>({value:option.value,label:option.textContent}))');
    assert.deepEqual(choices, [{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو' }, { value: 'ar', label: 'العربية' }]);
    report.checks.exactLanguageChoices = true;
    await protocol.wait('!!document.querySelector(".wf-business-form")');
    const profileValues = await protocol.evaluate('Array.from(document.querySelectorAll(".wf-business-form input,.wf-business-form select"), field=>({value:field.value,checked:field.checked}))');
    for (const locale of report.locales) {
      stage = `${locale}: switch and persistence`;
      await select(locale);
      assert.equal(await protocol.evaluate('document.documentElement.dir'), locale === 'en' ? 'ltr' : 'rtl');
      assert.equal(await protocol.evaluate('document.querySelector(".wf-page-heading h1").textContent'), titles[locale]);
      assert.equal(await protocol.evaluate('document.querySelector(".wf-breadcrumb-workspace").textContent'), labels[locale]);
      assert.deepEqual(await protocol.evaluate('Array.from(document.querySelectorAll(".wf-business-form input,.wf-business-form select"), field=>({value:field.value,checked:field.checked}))'), profileValues);
      assert.ok(await protocol.evaluate(`document.cookie.includes('ai-workforce-language=${locale}')`));
      report.checks[`${locale}:switchWithoutChangingBusinessValues`] = true;
      // Verify server-rendered language and text without executing JavaScript.
      const response = await fetch(`${origin}/dashboard/settings/business`, { headers: { Cookie: `${cookie}; ai-workforce-language=${locale}` } });
      const html = await response.text();
      assert.equal(response.status, 200); assert.ok(html.includes(`lang="${locale}"`));
      assert.ok(html.includes(`dir="${locale === 'en' ? 'ltr' : 'rtl'}"`));
      assert.ok(html.includes(titles[locale]), 'SSR must use the saved locale');
      report.checks[`${locale}:serverRendering`] = true;
      await navigate('/dashboard/settings/business');
      assert.equal(await protocol.evaluate('document.documentElement.lang'), locale);
      assert.equal(await protocol.evaluate('document.querySelector(".wf-page-heading h1").textContent'), titles[locale]);
      report.checks[`${locale}:refreshPersistence`] = true;
      stage = `${locale}: navigation and layout`;
      for (const route of ['/dashboard', '/dashboard/onboarding', '/dashboard/integrations', '/dashboard/billing', '/dashboard/reports', '/dashboard/support-inbox', '/dashboard/healthcare', '/dashboard/real-estate', '/dashboard/approvals', '/dashboard/templates', '/dashboard/voice-logs', '/dashboard/settings/whatsapp', '/', '/login', '/register', '/missing-language-test-page']) {
        await navigate(route);
        assert.equal(await protocol.evaluate('document.documentElement.lang'), locale);
        assert.equal(await protocol.evaluate('document.querySelector(".wf-language-control select")?.value'), locale);
        assert.equal(await protocol.evaluate('document.documentElement.scrollWidth > innerWidth + 2'), false, `Horizontal overflow: ${locale} ${route}`);
        report.checks[`${locale}:${route}`] = true;
      }
      if (locale !== 'en') {
        await navigate('/dashboard'); await protocol.wait('!!document.querySelector(".wf-dashboard-home .wf-stats")');
        const geometry = await protocol.evaluate('(()=>{const side=document.querySelector(".wf-sidebar").getBoundingClientRect();const main=document.querySelector(".wf-workspace-main").getBoundingClientRect();return {side:side.left,main:main.right}})()');
        assert.ok(geometry.side >= geometry.main - 2, 'RTL sidebar must move to the right');
        await screenshot(`language-${locale}-desktop`);
        report.checks[`${locale}:sidebarMirrored`] = true;
      }
      stage = `${locale}: mobile and keyboard`;
      await protocol.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: true });
      await navigate('/login');
      await protocol.evaluate('document.querySelector(".wf-language-control select").focus()');
      assert.equal(await protocol.evaluate('document.activeElement.matches(".wf-language-control select")'), true);
      assert.equal(await protocol.evaluate('document.documentElement.scrollWidth > innerWidth + 2'), false);
      if (locale !== 'en') await screenshot(`language-${locale}-mobile`);
      await navigate('/dashboard/settings/business');
      const bounds = await protocol.evaluate('(()=>{const rect=document.querySelector(".wf-language-control").getBoundingClientRect();return {left:rect.left,right:rect.right}})()');
      assert.ok(bounds.left >= 0 && bounds.right <= 321, 'Header language control must fit on mobile');
      report.checks[`${locale}:mobileAndKeyboard`] = true;
      await protocol.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
    stage = 'localized validation';
    await navigate('/login'); await select('ar');
    await protocol.evaluate('document.querySelector(".wf-auth-form button[type=submit]").click()');
    await protocol.wait('document.querySelector(".wf-field-error")?.textContent.includes("أدخل")');
    assert.equal(await protocol.evaluate('getComputedStyle(document.querySelector("input[type=email]")).direction'), 'ltr');
    report.checks.localizedValidationAndEmailDirection = true;
    await select('en');
    report.passed = true;
  } catch (error) {
    report.error = { stage, message: error.code === 'ERR_ASSERTION' || error.message?.startsWith('Browser') ? error.message : 'Browser check failed; response details suppressed.' };
  } finally {
    fs.writeFileSync(path.join(root, 'artifacts/language-browser.json'), JSON.stringify(report, null, 2));
  }
  assert.ok(report.passed, `Language browser checks failed at ${stage}`);
  return report;
}
