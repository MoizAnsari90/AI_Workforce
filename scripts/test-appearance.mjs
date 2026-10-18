import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import postcss from 'postcss';

const source = fs.readFileSync('apps/web/lib/appearance.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const context = { exports: {} }; vm.runInNewContext(compiled, context);
const { appearanceBootScript, normalizeAppearance, resolveTheme, APPEARANCE_KEY } = context.exports;
const css = postcss.parse(fs.readFileSync('apps/web/app/appearance.css', 'utf8'));

function boot(value, systemDark, denied = false) {
  const root = { dataset: {}, style: {}, classList: { toggle: (name, enabled) => { root.dark = enabled; } } };
  vm.runInNewContext(appearanceBootScript, { document: { documentElement: root }, localStorage: { getItem: key => { assert.equal(key, APPEARANCE_KEY); if (denied) throw new Error('blocked'); return value; } }, matchMedia: () => ({ matches: systemDark }) });
  return root;
}
test('theme resolves from device unless the user selected an explicit theme', () => {
  assert.equal(resolveTheme('system', true), 'dark'); assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light'); assert.equal(resolveTheme('dark', false), 'dark');
});
test('first-paint script applies all preferences before React and tolerates unavailable storage', () => {
  const selected = boot(JSON.stringify({ theme: 'light', palette: 'accessible', contrast: 'high' }), true);
  assert.equal(selected.dataset.theme, 'light'); assert.equal(selected.dataset.palette, 'accessible'); assert.equal(selected.dataset.contrast, 'high'); assert.equal(selected.dark, false);
  assert.equal(boot('{invalid', false).dataset.theme, 'light');
  assert.equal(boot(null, true, true).dataset.theme, 'dark');
  const sanitized = normalizeAppearance({ theme: 'unexpected', palette: '<script>', contrast: null });
  assert.equal(sanitized.theme, 'system'); assert.equal(sanitized.palette, 'standard'); assert.equal(sanitized.contrast, 'standard');
});
function palette(attributes) {
  const variables = {};
  css.nodes.filter(node => node.type === 'rule').forEach(rule => {
    if (!rule.selector.startsWith(':root')) return;
    if (![...rule.selector.matchAll(/\[data-(\w+)="(\w+)"\]/g)].every(([, key, value]) => attributes[key] === value)) return;
    rule.nodes.filter(node => node.type === 'decl' && node.prop.startsWith('--wf-')).forEach(decl => { variables[decl.prop] = decl.value; });
  });
  const resolve = name => variables[name].startsWith('var(') ? resolve(variables[name].slice(4, -1)) : variables[name];
  return resolve;
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
for (const theme of ['light', 'dark']) for (const colors of ['standard', 'accessible']) for (const level of ['standard', 'high']) {
  test(`readable text, status and controls: ${theme}/${colors}/${level}`, () => {
    const get = palette({ theme, palette: colors, contrast: level });
    for (const [fg, bg] of [['text', 'bg'], ['text', 'panel'], ['muted', 'panel'], ['faint', 'input'], ['on-primary', 'primary'], ['accent', 'accent-soft'], ['info', 'info-bg'], ['warning', 'warning-bg'], ['danger', 'danger-bg'], ['violet', 'violet-bg']]) {
      const ratio = contrast(get(`--wf-${fg}`), get(`--wf-${bg}`));
      assert.ok(ratio >= 4.5, `${fg}/${bg}: ${ratio.toFixed(2)}:1`);
    }
    assert.ok(contrast(get('--wf-control-border'), get('--wf-input')) >= 3, 'Input boundary contrast');
    assert.ok(contrast(get('--wf-focus'), get('--wf-panel')) >= 3, 'Keyboard focus contrast');
  });
}
test('component styles inherit palettes and every theme variable is defined', () => {
  const names = new Set(); css.walkDecls(decl => { if (decl.prop.startsWith('--wf-')) names.add(decl.prop); });
  for (const file of ['apps/web/app/(protected)/dashboard/workforce.css', 'apps/web/components/workforce/public.css']) {
    const raw = fs.readFileSync(file, 'utf8'); const parsed = postcss.parse(raw);
    parsed.walkDecls(decl => {
      assert.ok(!decl.prop.startsWith('--wf-'), 'Components must not shadow root theme variables');
      for (const [, name] of decl.value.matchAll(/var\((--wf-[a-z-]+)/g)) assert.ok(names.has(name), `${file}: missing ${name}`);
    });
    assert.ok(!/#[\da-f]{3,8}\b/i.test(raw), 'Component color literals were migrated');
  }
});
