import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const webPackage = JSON.parse(await readFile(new URL('../apps/web/package.json', import.meta.url), 'utf8'));

test('web runtime imports are production dependencies', () => {
  for (const dependency of ['clsx', 'tailwind-merge', 'lucide-react', 'cookies-next']) {
    assert.ok(webPackage.dependencies[dependency], `${dependency} must be in dependencies`);
    assert.ok(!webPackage.devDependencies[dependency], `${dependency} must not be in devDependencies`);
  }
});