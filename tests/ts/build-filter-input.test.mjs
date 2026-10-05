// Reproducibility tests for tools/build-filter-input.mjs: the snapshot header
// must not carry a wall-clock timestamp, and regenerating from the same source
// commit must be byte-identical. The generator is exercised against a throwaway
// git fixture repo, so no sibling checkout is needed (CI-safe).
// S6a T1: the generator emits the two tier lists (SAFE/STRICT) plus the legacy
// single file; the SAFE side carries no zone anchors (zones are STRICT-only
// upstream), the STRICT side is byte-identical to what the pre-S6a single-list
// run produced.
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
  writeFileSync(join(dir, 'lists', 'safe-domains.txt'), [
    '# safe domains',
    'us.safe.example',           // dropped: us.* region (same rule as strict)
    'de.safe.example',           // kept
    'safe-dup.example',
    'safe-dup.example',          // deduplicated
    'zone-one.example'           // kept as an EXACT rule only — never an anchor
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

const HEADER_1 = '# lg-tv-blocklist-app filter input — GENERATED, DO NOT EDIT';
const HEADER_2 = '# generator: tools/build-filter-input.mjs';

function headerFor(sha) {
  return [HEADER_1, HEADER_2, '# source: lg-tv-blocklist @ ' + sha];
}

function cleanup(dir) {
  // Best-effort temp cleanup: a locked file must not fail the test.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // ignored
  }
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
    // An explicit outPath keeps the pre-S6a contract: ONE file, STRICT rules.
    const expected = headerFor(source.sha).concat([
      '=alpha.example',
      '=de.regional.example',
      '=dup.example',
      '=zeta.example',
      'zone-one.example',
      'zone-two.example',
      ''
    ]).join('\n');
    assert.equal(first, expected);
  } finally {
    cleanup(source.dir);
  }
});

test('default mode writes both tier lists plus the legacy single file', () => {
  const source = makeSourceRepo();
  const outDir = mkdtempSync(join(tmpdir(), 'lgtvb-out-'));
  try {
    execFileSync(process.execPath, [GENERATOR, source.dir], {
      env: Object.assign({}, process.env, { LGTVB_FILTER_OUT_DIR: outDir })
    });
    const safe = readFileSync(join(outDir, 'filter-input-safe.txt'), 'utf8');
    const strict = readFileSync(join(outDir, 'filter-input-strict.txt'), 'utf8');
    const legacy = readFileSync(join(outDir, 'filter-input.txt'), 'utf8');

    // SAFE: exact rules only — the zone anchors are STRICT-only upstream, so a
    // name that is BOTH a safe-source domain and a zone anchor stays exact here.
    assert.equal(safe, headerFor(source.sha).concat([
      '=de.safe.example',
      '=safe-dup.example',
      '=zone-one.example',
      ''
    ]).join('\n'));
    assert.doesNotMatch(safe, /^zone-/m);

    // STRICT: same as the pre-S6a single list, anchors included.
    assert.equal(strict, headerFor(source.sha).concat([
      '=alpha.example',
      '=de.regional.example',
      '=dup.example',
      '=zeta.example',
      'zone-one.example',
      'zone-two.example',
      ''
    ]).join('\n'));

    // The legacy name is the strict list, byte for byte (older bundle fallback).
    assert.equal(legacy, strict);

    // Region filtering and the RETIRED rule apply on both sides.
    for (const text of [safe, strict]) {
      assert.doesNotMatch(text, /us\./);
      assert.doesNotMatch(text, /RETIRED/);
    }
  } finally {
    cleanup(source.dir);
    cleanup(outDir);
  }
});

test('committed snapshots carry no timestamp and pin a source commit', () => {
  const snapshot = readFileSync(
    fileURLToPath(new URL('../../app/filter/filter-input.txt', import.meta.url)),
    'utf8'
  );
  assert.doesNotMatch(snapshot, /^# generated:/m);
  assert.match(snapshot, /^# source: lg-tv-blocklist @ [0-9a-f]{40}$/m);
});

test('committed tier lists: same header and pin as the legacy file', () => {
  const dir = fileURLToPath(new URL('../../app/filter/', import.meta.url));
  const safe = readFileSync(join(dir, 'filter-input-safe.txt'), 'utf8');
  const strict = readFileSync(join(dir, 'filter-input-strict.txt'), 'utf8');
  const legacy = readFileSync(join(dir, 'filter-input.txt'), 'utf8');

  for (const text of [safe, strict]) {
    assert.match(text, /^# source: lg-tv-blocklist @ [0-9a-f]{40}$/m);
    assert.doesNotMatch(text, /^# generated:/m);
    assert.equal(text.split('\n')[0], HEADER_1);
    assert.equal(text.split('\n')[1], HEADER_2);
  }
  // Only the tier source and the zone anchors differ between the two lists:
  // STRICT is the pre-S6a snapshot unchanged, and the legacy file is that list.
  assert.equal(strict, legacy);
  // The committed SAFE list holds no whole-zone anchor line...
  const safeEntries = safe.split('\n').filter((line) => line !== '' && line.charAt(0) !== '#');
  assert.ok(safeEntries.length > 0);
  for (const line of safeEntries) {
    assert.equal(line.charAt(0), '=', line);
  }
  // ...while the committed STRICT list does (its anchor lines are the bare ones).
  const strictAnchors = strict.split('\n')
    .filter((line) => line !== '' && line.charAt(0) !== '#' && line.charAt(0) !== '=');
  assert.ok(strictAnchors.length > 0);
});
