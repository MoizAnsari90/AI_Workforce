import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function moduleFrom(file, imports = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const context = { exports: {}, require: name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; } };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
const catalogs = Object.fromEntries(['en', 'ur', 'ar'].map(locale => [locale, JSON.parse(fs.readFileSync(`apps/web/locales/${locale}.json`, 'utf8'))]));
const { LANGUAGES, selectLocale, direction, isLocale } = moduleFrom('apps/web/lib/language.ts');
const { translate } = moduleFrom('apps/web/lib/translate.ts', { '@/locales/ur.json': catalogs.ur, '@/locales/ar.json': catalogs.ar });

test('only the three requested languages are supported, with correct text direction', () => {
  assert.deepEqual(Array.from(LANGUAGES, language => language.code), ['en', 'ur', 'ar']);
  assert.equal(direction('en'), 'ltr'); assert.equal(direction('ur'), 'rtl'); assert.equal(direction('ar'), 'rtl');
  for (const value of ['en-US', 'es', '<script>', null, {}, '__proto__']) assert.equal(isLocale(value), false);
});
test('saved preference wins over browser language, with safe English fallback', () => {
  assert.equal(selectLocale('en', 'ur-PK,ar;q=0.9'), 'en');
  assert.equal(selectLocale('ar', 'en-US'), 'ar');
  assert.equal(selectLocale('invalid', 'ur-PK,ar;q=0.9'), 'ur');
  assert.equal(selectLocale(undefined, 'es;q=1,ar-SA;q=0.8,en;q=0.5'), 'ar');
  assert.equal(selectLocale(undefined, 'ur;q=0,ar;q=invalid'), 'en');
  assert.equal(selectLocale(undefined, 'en;q=0.2,ar;q=0.9'), 'ar');
  assert.equal(selectLocale(undefined, 'fr-FR'), 'en');
});
test('all translation catalogs contain matching non-empty keys and preserve named parameters', () => {
  const expected = Object.keys(catalogs.en).sort(); assert.ok(expected.length > 900);
  const parameters = value => [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();
  for (const locale of ['ur', 'ar']) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), expected);
    for (const key of expected) {
      assert.ok(catalogs[locale][key].trim(), `${locale}: empty ${key}`);
      assert.deepEqual(parameters(catalogs[locale][key]), parameters(key), `${locale}: missing parameter ${key}`);
      assert.ok(!catalogs[locale][key].includes('\ufffd'), `${locale}: invalid UTF-8 ${key}`);
    }
  }
});
test('lookup and interpolation preserve unknown provider text and user values', () => {
  assert.equal(translate('en', 'Workspace'), 'Workspace');
  assert.equal(translate('ur', 'Workspace'), 'ورک اسپیس');
  assert.equal(translate('ar', 'Workspace'), 'مساحة العمل');
  assert.equal(translate('ar', 'Provider returned error ABC123'), 'Provider returned error ABC123');
  assert.equal(translate('ar', '__proto__'), '__proto__');
  assert.equal(translate('ur', 'constructor'), 'constructor');
  assert.equal(translate('ur', 'Pause {name}', { name: 'Customer {literal} اسم' }), 'Customer {literal} اسم کو روکیں');
  assert.equal(translate('ar', 'Pause {name}'), 'إيقاف {name} مؤقتًا');
});
test('every literal translation call in frontend source exists in the English catalog', () => {
  const missing = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'api' || entry.name === 'node_modules') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.tsx')) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        function visit(node) {
          if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && ts.isStringLiteral(node.arguments[0]) && !Object.hasOwn(catalogs.en, node.arguments[0].text)) missing.push(`${file}: ${node.arguments[0].text}`);
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  walk('apps/web/app'); walk('apps/web/components'); walk('apps/web/contexts');
  assert.deepEqual(missing, []);
});
test('server uses the same locale as the provider and leaves auth proxy contracts intact', () => {
  const layout = fs.readFileSync('apps/web/app/layout.tsx', 'utf8');
  assert.match(layout, /cookies\(\)/); assert.match(layout, /selectLocale\(/);
  assert.match(layout, /lang=\{locale\} dir=\{direction\(locale\)\}/);
  assert.match(layout, /initialLocale=\{locale\}/);
  const proxy = fs.readFileSync('apps/web/proxy.ts', 'utf8');
  assert.match(proxy, /request\.cookies\.get\("token"\)/);
  assert.doesNotMatch(proxy, /\[locale\]|\[lang\]/);
});
