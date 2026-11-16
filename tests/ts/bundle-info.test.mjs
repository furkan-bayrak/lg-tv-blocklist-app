import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const generator = join(root, 'tools', 'gen-bundle-info.mjs');
const revision = '0123456789abcdef0123456789abcdef01234567';
const sourceDate = '2001-02-03';

function header(sha = revision, date = sourceDate) {
  return '# source: lg-tv-blocklist @ ' + sha + '\n# source-date: ' + date + '\n';
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lgtvb-bundle-info-'));
  mkdirSync(join(dir, 'filter'));
  writeFileSync(join(dir, 'appinfo.json'), JSON.stringify({ version: '9.8.7' }));
  writeFileSync(join(dir, 'filter', 'filter-input-safe.txt'), header() + '=safe.example\n');
  writeFileSync(join(dir, 'filter', 'filter-input-strict.txt'), header() + '=safe.example\nstrict.example\n');
  return dir;
}

function generate(dir) {
  return spawnSync(process.execPath, [generator, dir, join(dir, 'bundle-info.gen.ts')], { encoding: 'utf8' });
}

function moduleValue(text) {
  const context = {};
  vm.runInNewContext(text, context);
  return JSON.parse(JSON.stringify(context.LgBundleInfo));
}

test('bundle info derives app version and source commit identity offline, deterministically', () => {
  const dir = fixture();
  try {
    const out = join(dir, 'bundle-info.gen.ts');
    assert.equal(generate(dir).status, 0);
    const first = readFileSync(out, 'utf8');
    assert.deepEqual(moduleValue(first), { appVersion: '9.8.7', listRevision: revision, listDate: sourceDate });
    assert.equal(generate(dir).status, 0);
    assert.equal(readFileSync(out, 'utf8'), first);
    writeFileSync(join(dir, 'appinfo.json'), JSON.stringify({ version: '9.8.8' }));
    assert.equal(generate(dir).status, 0);
    assert.deepEqual(moduleValue(readFileSync(out, 'utf8')), { appVersion: '9.8.8', listRevision: revision, listDate: sourceDate });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [name, strictHeader] of [
  ['different source revision', header('f'.repeat(40))],
  ['different source date', header(revision, '2001-02-04')],
  ['missing source date', '# source: lg-tv-blocklist @ ' + revision + '\n']
]) {
  test('bundle info refuses ' + name + ' without overwriting output', () => {
    const dir = fixture();
    try {
      assert.equal(generate(dir).status, 0);
      const out = join(dir, 'bundle-info.gen.ts');
      const before = readFileSync(out, 'utf8');
      writeFileSync(join(dir, 'filter', 'filter-input-strict.txt'), strictHeader);
      assert.notEqual(generate(dir).status, 0);
      assert.equal(readFileSync(out, 'utf8'), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

