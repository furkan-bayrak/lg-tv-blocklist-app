// Reproducibility tests for tools/build-filter-input.mjs: the snapshot header
// must not carry a wall-clock timestamp, and regenerating from the same source
// commit must be byte-identical. The generator is exercised against a throwaway
// git fixture repo, so no sibling checkout is needed (CI-safe).
// Run after `npm run build`:  npm run test:ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATOR = fileURLToPath(new URL('../../tools/build-filter-input.mjs', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function makeSourceRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'lgtvb-src-'));
  mkdirSync(join(dir, 'lists'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'lists', 'strict-domains.txt'), [
    '# strict domains',
    'us.regional.example',       // dropped: us.* region
    'de.regional.example',       // kept: de.* region
    'dup.example',
    'dup.example',               // deduplicated
    '',
    'zeta.example',
    'alpha.example'
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'src', 'zones.txt'), [
    '# zones',
    'zone-two.example  # comment stripped, first token is the anchor',
    'retired.example RETIRED — skipped on the raw line',
    'zone-one.example'
  ].join('\n') + '\n');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'fixture');
  return { dir: dir, sha: git(dir, 'rev-parse', 'HEAD').trim() };
}

test('generator output is reproducible: no timestamp, byte-identical reruns', () => {
  const source = makeSourceRepo();
  try {
    const out1 = join(source.dir, 'out1.txt');
    const out2 = join(source.dir, 'out2.txt');
    execFileSync(process.execPath, [GENERATOR, source.dir, out1]);
    execFileSync(process.execPath, [GENERATOR, source.dir, out2]);
    const first = readFileSync(out1, 'utf8');
    const second = readFileSync(out2, 'utf8');
    assert.equal(first, second);
    assert.doesNotMatch(first, /^# generated:/m);
    const expected = [
      '# lg-tv-blocklist-app filter input — GENERATED, DO NOT EDIT',
      '# generator: tools/build-filter-input.mjs',
      '# source: lg-tv-blocklist @ ' + source.sha,
      '=alpha.example',
      '=de.regional.example',
      '=dup.example',
      '=zeta.example',
      'zone-one.example',
      'zone-two.example',
      ''
    ].join('\n');
    assert.equal(first, expected);
  } finally {
    // Best-effort temp cleanup: a locked file must not fail the test.
    try {
      rmSync(source.dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // ignored
    }
  }
});

test('committed snapshot carries no timestamp and pins a source commit', () => {
  const snapshot = readFileSync(
    fileURLToPath(new URL('../../app/filter/filter-input.txt', import.meta.url)),
    'utf8'
  );
  assert.doesNotMatch(snapshot, /^# generated:/m);
  assert.match(snapshot, /^# source: lg-tv-blocklist @ [0-9a-f]{40}$/m);
});
