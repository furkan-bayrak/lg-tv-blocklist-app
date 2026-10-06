// Tests for the SECOND output of tools/gen-domains.mjs: src/domains.gen.ts, the
// committed TypeScript module the UI layer consumes (S6b T7/T8 enablement).
//
// Why this file exists: the webview cannot read files at runtime and the fixed
// bridge command set has no read command, so the row metadata and each tier's
// preset entry count have to be compiled in. The module must therefore be
//   - regenerable from COMMITTED files alone (no network, no sibling checkout),
//     byte for byte, which is what the --emit-ts half proves here — the
//     sibling-checkout regen test in domains.test.mjs is to be skipped in this
//     environment and is deliberately left alone;
//   - in agreement with the two facts it will be trusted for: the rows in
//     app/filter/domains.json and the entry counts check.sh reports for the
//     shipped preset lists.
// Run after `npm run build`:  npm run test:ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const GENERATOR = join(REPO_ROOT, 'tools', 'gen-domains.mjs');
const FILTER_DIR = join(REPO_ROOT, 'app', 'filter');
const DOMAINS = join(FILTER_DIR, 'domains.json');
const SAFE_LIST = join(FILTER_DIR, 'filter-input-safe.txt');
const STRICT_LIST = join(FILTER_DIR, 'filter-input-strict.txt');
const MODULE_TS = join(REPO_ROOT, 'src', 'domains.gen.ts');
const MODULE_JS = join(REPO_ROOT, 'app', 'js', 'domains.gen.js');

// list_entry_count() in app/scripts/common.sh, written out independently of the
// generator so this is a real cross-check: every line that is neither a comment
// nor blank is one blocked_names entry. check.sh reports that same number as
// entries=<N> for the materialized preset (no overrides stored = the preset
// copied unchanged), so it is the value the UI must treat as the preset count.
function listEntryCount(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .length;
}

function loadCompiledModule() {
  const sandbox = {};
  vm.runInNewContext(readFileSync(MODULE_JS, 'utf8'), sandbox);
  return sandbox.LgDomains;
}

test('--emit-ts regenerates the committed module byte for byte, offline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgtvb-domts-'));
  try {
    const out = join(dir, 'domains.gen.ts');
    // Hermetic by construction: --emit-ts reads only committed files under
    // app/filter. No network, and no ../lg-tv-blocklist checkout is consulted —
    // this environment's sibling is at a different commit than the pin and this
    // test still has to run.
    const res = spawnSync(process.execPath, [GENERATOR, '--emit-ts', out], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /domains-ts: 115 rows \(safe 20, strict 87, zone 8\)/);
    assert.equal(
      readFileSync(out, 'utf8'),
      readFileSync(MODULE_TS, 'utf8'),
      'src/domains.gen.ts is stale: run `node tools/gen-domains.mjs --emit-ts`'
    );
    // Atomic write: nothing but the destination is left behind.
    assert.deepEqual(readdirSync(dir), ['domains.gen.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--emit-ts refuses extra arguments instead of guessing (writes nothing)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgtvb-domts-args-'));
  try {
    const out = join(dir, 'domains.gen.ts');
    const res = spawnSync(process.execPath, [GENERATOR, '--emit-ts', out, 'extra'], { encoding: 'utf8' });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /at most one argument/);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compiled module carries exactly the committed domains.json rows', () => {
  const rows = JSON.parse(readFileSync(DOMAINS, 'utf8'));
  const mod = loadCompiledModule();

  assert.equal(mod.schema, 1);
  assert.equal(mod.count, rows.length);
  assert.equal(rows.length, 115);
  assert.equal(mod.rows.length, rows.length);

  // Same rows, same order, same values — plus the derived anchor flag, which the
  // UI needs to know which row owns a whole zone.
  const expected = rows.map((row) => ({
    name: row.name,
    tier: row.tier,
    category: row.category,
    zone: row.zone,
    anchor: row.tier === 'zone',
    note: row.note
  }));
  // Rows come out of a vm realm, so compare JSON round-trips: this also proves
  // every value in the module is JSON-plain data (no live objects, no functions).
  assert.deepEqual(JSON.parse(JSON.stringify(mod.rows)), expected);

  const perTier = rows.reduce((acc, row) => {
    acc[row.tier] = (acc[row.tier] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(perTier, { safe: 20, strict: 87, zone: 8 });
  assert.equal(mod.anchors, perTier.zone);
  // The anchor flag is the tier, not a fourth list.
  assert.equal(mod.rows.filter((row) => row.anchor).length, perTier.zone);
  for (const row of mod.rows) {
    assert.equal(row.anchor, row.tier === 'zone', row.name);
    if (row.anchor) {
      assert.equal(row.zone, row.name, row.name + ' anchor must be its own zone');
    } else {
      assert.notEqual(row.zone, row.name, row.name + ' is covered, not an anchor');
    }
  }
});

test('preset entry counts equal the shipped lists\' list_entry_count', () => {
  const mod = loadCompiledModule();
  const safe = listEntryCount(SAFE_LIST);
  const strict = listEntryCount(STRICT_LIST);

  // The numbers themselves, pinned so a silent list regeneration cannot slip by.
  assert.equal(safe, 20);
  assert.equal(strict, 123);
  assert.deepEqual(JSON.parse(JSON.stringify(mod.presetEntries)), { safe, strict });

  // And the arithmetic that ties counts to rows, i.e. the invariant the
  // generator asserts before writing: every row is one exact rule in the STRICT
  // preset, and each anchor adds one bare whole-zone entry; the SAFE preset is
  // exactly the tier-safe rows (no anchors by design).
  const rows = JSON.parse(readFileSync(DOMAINS, 'utf8'));
  const safeRows = rows.filter((row) => row.tier === 'safe').length;
  const anchors = rows.filter((row) => row.tier === 'zone').length;
  assert.equal(strict, rows.length + anchors);
  assert.equal(safe, safeRows);
});

test('the committed module is self-describing, ASCII, and hand-edit-resistant', () => {
  const text = readFileSync(MODULE_TS, 'utf8');

  assert.ok(text.startsWith('/*\n * src/domains.gen.ts'), 'generated banner first');
  assert.match(text, /GENERATED FILE, DO NOT EDIT BY HAND/);
  assert.ok(
    text.includes('node tools/gen-domains.mjs --emit-ts'),
    'the exact offline regeneration command must be in the header'
  );
  // ASCII only: notes are upstream copy with typographic characters, escaped as
  // \uXXXX, so the file is byte-identical whatever encoding an editor assumes
  // and still loads from a plain <script>.
  assert.match(text, /^[\t\n\x20-\x7e]*$/, 'non-ASCII byte in the generated module');
  assert.ok(text.endsWith('};\n'), 'trailing newline, object literal close');
  // A plain object literal, so the compiled file stays ES5 (check:es5 /
  // check:node8 enforce the rest).
  assert.ok(text.includes('var LgDomains: LgDomainsModule = {\n  schema: 1,'));
  assert.ok(text.includes('  presetEntries: { safe: 20, strict: 123 },'));
});
