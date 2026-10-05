// Tests for tools/gen-domains.mjs (S6b T4): the committed app/filter/domains.json
// and the generator that produces it.
//
// Two halves:
//   - the fixture half drives the real generator against a throwaway git fixture
//     repo (no sibling checkout, CI-safe): row shape, sorting, tier/category
//     rules, zone coverage, the never-drop fallbacks, byte determinism, and every
//     fail-loudly path (missing source, pin mismatch, no pinned lists, name-set
//     drift) together with "a failure never leaves output behind";
//   - the artifact half checks the COMMITTED file the UI will read: one row per
//     domain in the shipped tier lists, counts per tier, category-then-name
//     order, the zone invariants, and that each row's category is what the
//     current classifier table produces for its note (so a table change without a
//     regeneration fails here).
// Run after `npm run build`:  npm run test:ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classify } from '../../tools/gen-domains.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const GENERATOR = join(REPO_ROOT, 'tools', 'gen-domains.mjs');
const LIST_GENERATOR = join(REPO_ROOT, 'tools', 'build-filter-input.mjs');
const FILTER_DIR = join(REPO_ROOT, 'app', 'filter');
const DOMAINS = join(FILTER_DIR, 'domains.json');
// The categories the UI groups by; 'zone' comes from the tier, never from prose.
const CATEGORIES = [
  'acr',
  'ads',
  'channels',
  'interop',
  'ota',
  'other',
  'store',
  'telemetry',
  'thinq',
  'voice',
  'zone'
];

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function makeSourceRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'lgtvb-dom-src-'));
  mkdirSync(join(dir, 'lists'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'lists', 'strict-domains.txt'), [
    '# strict domains',
    'us.regional.example',       // dropped: us.* region, same rule as the tier lists
    'de.regional.example',       // kept, annotated below (OTA)
    'dup.example',
    'dup.example',               // deduplicated: one row
    'naked.example',             // in the list, in NO src/*.txt: still gets a row
    'sub.zone-two.example',      // covered by the zone-two.example anchor
    'zeta.example',              // annotated: interop
    'alpha.example'              // annotated: prose no rule matches -> other
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'lists', 'safe-domains.txt'), [
    '# safe domains',
    'us.safe.example',           // dropped: us.* region
    'de.safe.example',           // kept, annotated below (ads)
    'safe-dup.example',
    'safe-dup.example',          // deduplicated
    'zone-one.example'           // kept as an EXACT rule only — never an anchor
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'src', 'safe.txt'), [
    '# safe annotations',
    'de.safe.example # SAFE: ad delivery (ads.example family)',
    'safe-dup.example # SAFE: ACR beacon (6-min heartbeat)',
    'zone-one.example # SAFE: nudge/notification telemetry',
    'us.safe.example # SAFE: SDP telemetry, region endpoint'
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'src', 'strict.txt'), [
    '# strict annotations',
    'de.regional.example # STRICT: firmware OTA check server',
    'dup.example # STRICT: weak — unknown (DNS only)',
    'sub.zone-two.example # STRICT: telemetry endpoint (covered by the zone)',
    'zeta.example # STRICT: interop: QuickSet Cloud (UEI) discovery API',
    'alpha.example # STRICT: prose that no category rule matches'
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'src', 'zones.txt'), [
    '# zones',
    'zone-two.example # ZONE: umbrella zone — kills all zone-two.example subdomains',
    'retired.example RETIRED — skipped on the raw line',
    'zone-one.example  # comment stripped, first token is the anchor'
  ].join('\n') + '\n');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'fixture');
  return { dir: dir, sha: git(dir, 'rev-parse', 'HEAD').trim() };
}

// The two tier lists the app ships, generated from the fixture by the real
// generator — the pin domains.json is verified against comes from their header.
function makeOutDir(sourceDir) {
  const outDir = mkdtempSync(join(tmpdir(), 'lgtvb-dom-out-'));
  execFileSync(process.execPath, [LIST_GENERATOR, sourceDir], {
    env: Object.assign({}, process.env, { LGTVB_FILTER_OUT_DIR: outDir })
  });
  return outDir;
}

function cleanup(...dirs) {
  for (const dir of dirs) {
    // Best-effort temp cleanup: a locked file must not fail the test.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // ignored
    }
  }
}

// spawnSync, not execFileSync: the generator's warnings (an unannotated name) go
// to stderr and are part of what these tests check, so stderr has to be captured
// on success too — and must not leak into the TAP output.
function runGenerator(sourceDir, outPath) {
  const result = spawnSync(process.execPath, [GENERATOR, sourceDir, outPath], { encoding: 'utf8' });
  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

test('classify(): the documented table, most-specific-first, with an other fallback', () => {
  assert.equal(classify('telemetry/ACR beacon (6-min heartbeat pattern observed)'), 'acr');
  assert.equal(classify('ad delivery (querylog family)'), 'ads');
  assert.equal(classify('recommendations/promos'), 'ads');
  assert.equal(classify('nudge/notification telemetry'), 'ads');
  // 'beacon' alone is deliberately not an ACR rule: upstream calls the SDP
  // telemetry apex a beacon too, and that row belongs in telemetry.
  assert.equal(classify('SDP telemetry apex (service delivery platform beacons)'), 'telemetry');
  assert.equal(classify('IoT telemetry (largest observed family)'), 'telemetry');
  assert.equal(classify('cloud-config telemetry'), 'telemetry');
  assert.equal(classify('firmware OTA check server'), 'ota');
  assert.equal(classify('update transfer on SDP family'), 'ota');
  assert.equal(classify('ThinQ cloud sync backend'), 'thinq');
  assert.equal(classify('LG Channels (FAST) backend — feature kill by design'), 'channels');
  assert.equal(classify('interop: QuickSet Cloud (UEI) discovery API'), 'interop');
  assert.equal(classify('Philips Hue cloud bridge discovery (N-UPnP)'), 'interop');
  assert.equal(classify('weak — LG Shop service (SDX)'), 'store');
  assert.equal(classify('voice search backend; blocking breaks remote voice search'), 'voice');
  // An entry that names several things is filed under what it DOES on the wire.
  assert.equal(classify('ad delivery on the lgappstv store CDN family (store unaffected)'), 'ads');
  // The explicit fallback: no rule matches, so the row still exists, as `other`.
  assert.equal(classify('prose that no category rule matches'), 'other');
  assert.equal(classify('weak — unknown'), 'other');
  assert.equal(classify(''), 'other');
  // 'zone' is never returned by prose: it is assigned from the tier, so a
  // non-anchor row cannot land in the zone group by accident.
  assert.equal(classify('umbrella zone — kills all lge.com subdomains'), 'other');
});

test('fixture: rows, tiers, categories, zone coverage and the never-drop fallbacks', () => {
  const source = makeSourceRepo();
  const outDir = makeOutDir(source.dir);
  try {
    const outPath = join(outDir, 'domains.json');
    const result = runGenerator(source.dir, outPath);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(outPath, 'utf8')), [
      {
        name: 'safe-dup.example',
        tier: 'safe',
        category: 'acr',
        zone: '',
        note: 'ACR beacon (6-min heartbeat)'
      },
      {
        name: 'de.safe.example',
        tier: 'safe',
        category: 'ads',
        zone: '',
        note: 'ad delivery (ads.example family)'
      },
      {
        name: 'zeta.example',
        tier: 'strict',
        category: 'interop',
        zone: '',
        note: 'interop: QuickSet Cloud (UEI) discovery API'
      },
      {
        name: 'de.regional.example',
        tier: 'strict',
        category: 'ota',
        zone: '',
        note: 'firmware OTA check server'
      },
      {
        name: 'alpha.example',
        tier: 'strict',
        category: 'other',
        zone: '',
        note: 'prose that no category rule matches'
      },
      {
        name: 'dup.example',
        tier: 'strict',
        category: 'other',
        zone: '',
        note: 'weak — unknown (DNS only)'
      },
      // No annotation upstream: still a row (note ""), never dropped.
      { name: 'naked.example', tier: 'strict', category: 'other', zone: '', note: '' },
      {
        name: 'sub.zone-two.example',
        tier: 'strict',
        category: 'telemetry',
        zone: 'zone-two.example',
        note: 'telemetry endpoint (covered by the zone)'
      },
      // An anchor is tier 'zone' even though the SAFE source names it: it is in
      // the strict list, and the zone is what blocks its subdomains.
      {
        name: 'zone-one.example',
        tier: 'zone',
        category: 'zone',
        zone: 'zone-one.example',
        note: 'nudge/notification telemetry'
      },
      {
        name: 'zone-two.example',
        tier: 'zone',
        category: 'zone',
        zone: 'zone-two.example',
        note: 'umbrella zone — kills all zone-two.example subdomains'
      }
    ]);
    // The unannotated name is reported (loudly, on stderr) but not dropped.
    assert.match(result.stderr, /naked\.example/);
    // A RETIRED anchor covers nothing, and a region-filtered annotated name gets
    // no row: neither appears anywhere in the file.
    const text = readFileSync(outPath, 'utf8');
    assert.doesNotMatch(text, /retired\.example|us\.safe\.example|us\.regional\.example/);
  } finally {
    cleanup(source.dir, outDir);
  }
});

test('fixture: byte-identical on a re-run, LF only, no tmp file left behind', () => {
  const source = makeSourceRepo();
  const outDir = makeOutDir(source.dir);
  try {
    const out1 = join(outDir, 'domains.json');
    const out2Dir = mkdtempSync(join(tmpdir(), 'lgtvb-dom-out2-'));
    const out2 = join(out2Dir, 'domains.json');
    // The second run needs the pinned tier lists next to it, like the real dir.
    execFileSync(process.execPath, [LIST_GENERATOR, source.dir], {
      env: Object.assign({}, process.env, { LGTVB_FILTER_OUT_DIR: out2Dir })
    });
    assert.equal(runGenerator(source.dir, out1).status, 0);
    assert.equal(runGenerator(source.dir, out2).status, 0);
    const first = readFileSync(out1, 'utf8');
    assert.equal(first, readFileSync(out2, 'utf8'));
    assert.doesNotMatch(first, /\r/);
    assert.match(first, /\n$/);
    assert.equal(existsSync(out1 + '.tmp'), false);
    assert.equal(existsSync(out2 + '.tmp'), false);
    cleanup(out2Dir);
  } finally {
    cleanup(source.dir, outDir);
  }
});

test('fails loudly and writes nothing: missing source, pin mismatch, no lists, drift', () => {
  const source = makeSourceRepo();
  const outDir = makeOutDir(source.dir);
  const outPath = join(outDir, 'domains.json');
  const SENTINEL = '{"previous":"content"}\n';
  try {
    writeFileSync(outPath, SENTINEL);
    // 1) a missing source file is named, and the previous output is untouched.
    const zones = join(source.dir, 'src', 'zones.txt');
    const zonesText = readFileSync(zones, 'utf8');
    rmSync(zones);
    const missing = runGenerator(source.dir, outPath);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /missing source .*zones\.txt/);
    assert.equal(readFileSync(outPath, 'utf8'), SENTINEL);
    assert.equal(existsSync(outPath + '.tmp'), false);
    writeFileSync(zones, zonesText);

    // 2) the shipped list names a domain this checkout does not have (a stale or
    // hand-edited list): the name-set check refuses, both sides named. HEAD still
    // matches the pin, so only this check can catch it.
    const strictList = join(outDir, 'filter-input-strict.txt');
    const strictText = readFileSync(strictList, 'utf8');
    writeFileSync(strictList, strictText + '=ghost.example\n');
    const drift = runGenerator(source.dir, outPath);
    assert.notEqual(drift.status, 0);
    assert.match(drift.stderr, /name set/);
    assert.match(drift.stderr, /ghost\.example/);
    assert.equal(readFileSync(outPath, 'utf8'), SENTINEL);
    assert.equal(existsSync(outPath + '.tmp'), false);
    writeFileSync(strictList, strictText);

    // 3) the checkout moved on: the shipped lists are pinned at an older commit.
    git(source.dir, 'commit', '-q', '--allow-empty', '-m', 'move on');
    const moved = runGenerator(source.dir, outPath);
    assert.notEqual(moved.status, 0);
    assert.match(moved.stderr, /pin mismatch/);
    assert.match(moved.stderr, new RegExp(source.sha));
    assert.equal(readFileSync(outPath, 'utf8'), SENTINEL);
    assert.equal(existsSync(outPath + '.tmp'), false);

    // 4) nothing to pin to: no tier lists next to the output.
    const emptyDir = mkdtempSync(join(tmpdir(), 'lgtvb-dom-empty-'));
    const unPinned = runGenerator(source.dir, join(emptyDir, 'domains.json'));
    assert.notEqual(unPinned.status, 0);
    assert.match(unPinned.stderr, /no pinned tier lists/);
    assert.equal(existsSync(join(emptyDir, 'domains.json')), false);
    cleanup(emptyDir);
  } finally {
    cleanup(source.dir, outDir);
  }
});

// --- the committed artifact the UI reads -------------------------------------

function committed() {
  return JSON.parse(readFileSync(DOMAINS, 'utf8'));
}

// Names blocked by a shipped tier list: '=name' exact rules and bare anchors.
function listNames(file) {
  const names = [];
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (line !== '') {
      names.push(line.startsWith('=') ? line.slice(1) : line);
    }
  }
  return names;
}

test('committed domains.json: one row per domain in the shipped tier lists', () => {
  const rows = committed();
  const safeNames = listNames(join(FILTER_DIR, 'filter-input-safe.txt'));
  const strictNames = listNames(join(FILTER_DIR, 'filter-input-strict.txt'));
  const names = rows.map((row) => row.name);
  assert.equal(new Set(names).size, names.length, 'no duplicate rows');
  for (const name of safeNames.concat(strictNames)) {
    assert.ok(names.includes(name), name + ' is blocked by a tier list but has no row');
  }
  assert.equal(names.length, new Set(safeNames.concat(strictNames)).size, 'no rows for unlisted domains');
  // Counts per tier, pinned: 20 SAFE (all of them in the strict list as well,
  // since strict = safe + delta), 87 strict-only, 8 live zone anchors.
  const tiers = { safe: 0, strict: 0, zone: 0 };
  for (const row of rows) {
    tiers[row.tier] += 1;
  }
  assert.deepEqual(tiers, { safe: 20, strict: 87, zone: 8 });
  assert.equal(rows.length, 115);
});

test('committed domains.json: shape, order, category table and the zone invariants', () => {
  const rows = committed();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    assert.deepEqual(Object.keys(row), ['name', 'tier', 'category', 'zone', 'note']);
    assert.match(row.name, /^[a-z0-9.-]+$/);
    assert.ok(['safe', 'strict', 'zone'].includes(row.tier), row.name + ': tier ' + row.tier);
    assert.ok(CATEGORIES.includes(row.category), row.name + ': category ' + row.category);
    assert.equal(typeof row.note, 'string');
    // The upstream `TAG:` marker is machine-readable in `tier` and stripped here.
    assert.doesNotMatch(row.note, /^(SAFE|STRICT|ZONE)\b/, row.name + ': note keeps the tag');
    // Sorted by category then name, the order the UI renders.
    const later = rows[i + 1];
    if (later !== undefined) {
      assert.ok(
        row.category < later.category ||
          (row.category === later.category && row.name < later.name),
        row.name + ' -> ' + later.name + ' is out of category-then-name order'
      );
    }
  }
  // The category is what the current table says about the note, for every row
  // the tier does not decide: a table edit without a regeneration fails here.
  for (const row of rows) {
    if (row.tier !== 'zone') {
      assert.equal(row.category, classify(row.note), row.name + ' category is stale');
    }
  }
  const anchors = new Set(rows.filter((row) => row.tier === 'zone').map((row) => row.name));
  assert.equal(anchors.size, 8);
  for (const row of rows) {
    if (row.tier === 'zone') {
      // An anchor is its own zone and is category 'zone' by tier.
      assert.equal(row.zone, row.name);
      assert.equal(row.category, 'zone');
      continue;
    }
    assert.notEqual(row.category, 'zone', row.name + ': only an anchor may be category zone');
    if (row.zone !== '') {
      // Covered by a zone: the row names an anchor that exists in this same
      // file (that is the row the UI points at instead of toggling this one).
      assert.ok(anchors.has(row.zone), row.name + ': zone ' + row.zone + ' is not a row');
      assert.ok(row.name.endsWith('.' + row.zone) || row.name === row.zone);
    }
  }
});

test('committed domains.json: notes come from upstream, anchors and a covered row', () => {
  const rows = committed();
  const byName = new Map(rows.map((row) => [row.name, row]));
  // A live zone anchor.
  const lge = byName.get('lge.com');
  assert.deepEqual(lge, {
    name: 'lge.com',
    tier: 'zone',
    category: 'zone',
    zone: 'lge.com',
    note: 'umbrella zone — kills all lge.com subdomains in adblock format'
  });
  // A covered SAFE row: blocked by the anchor as a whole zone, so the UI must
  // point at the anchor's row instead of letting this row be toggled directly.
  const covered = byName.get('eic.lgtviot.com');
  assert.equal(covered.tier, 'safe');
  assert.equal(covered.zone, 'lgtviot.com');
  assert.equal(covered.category, 'telemetry');
  assert.equal(covered.note, 'IoT telemetry (largest observed family, ~5.1k queries)');
  // A RETIRED anchor: it is in the strict list as an exact entry, so it has a
  // row — but it covers nothing, so it stays individually toggleable (zone "").
  const retired = byName.get('lgunifiedsmart.com');
  assert.equal(retired.tier, 'strict');
  assert.equal(retired.zone, '');
  assert.equal(retired.category, 'other');
  assert.match(retired.note, /^smart-family umbrella/);
});

test('committed domains.json is regenerable from the pinned checkout', (t) => {
  // Needs a checkout of the upstream repo at the pinned commit. By default that
  // is the sibling checkout the generator uses; LGTVB_BLOCKLIST_REPO points at a
  // copy elsewhere (a pinned clone in /tmp, say) to actually run this check.
  // Without one — CI, a fresh clone — say so instead of pretending this ran: the
  // artifact itself is already pinned by the tests above.
  const repo = process.env.LGTVB_BLOCKLIST_REPO
    ? resolve(process.env.LGTVB_BLOCKLIST_REPO)
    : resolve(REPO_ROOT, '..', 'lg-tv-blocklist');
  const pinMatch = /^# source: lg-tv-blocklist @ ([0-9a-f]{40})$/m.exec(
    readFileSync(join(FILTER_DIR, 'filter-input-strict.txt'), 'utf8')
  );
  assert.ok(pinMatch !== null, 'the committed strict list carries the upstream pin');
  const pin = pinMatch[1];
  let head = '';
  try {
    head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    t.skip('no sibling checkout at ' + repo + ' — regeneration check skipped');
    return;
  }
  if (head !== pin) {
    t.skip('sibling checkout is at ' + head + ', the lists are pinned at ' + pin);
    return;
  }
  const outDir = mkdtempSync(join(tmpdir(), 'lgtvb-dom-live-'));
  try {
    // The tier lists must sit next to the output (that is the pin's source), so
    // copy the committed ones in unchanged.
    for (const file of ['filter-input-safe.txt', 'filter-input-strict.txt']) {
      writeFileSync(join(outDir, file), readFileSync(join(FILTER_DIR, file)));
    }
    const outPath = join(outDir, 'domains.json');
    const result = runGenerator(repo, outPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(outPath, 'utf8'), readFileSync(DOMAINS, 'utf8'));
  } finally {
    cleanup(outDir);
  }
});
