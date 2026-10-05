#!/usr/bin/env node
/*
 * gen-domains.mjs — generate app/filter/domains.json: one row per domain the app
 * knows about, with the metadata the S6b domain-list UI needs.
 *
 * WHY A GENERATED FILE. The categories the UI groups rows by exist upstream only
 * as prose ("SAFE: ad delivery (querylog family)"), so the mapping from prose to
 * category is a classifier, and a classifier must be reviewable and re-runnable.
 * The output is committed so the owner can read every row and correct it, and so
 * the UI never has to parse the upstream repo at runtime.
 *
 * SOURCES (the SAME pinned checkout tools/build-filter-input.mjs uses):
 *   lists/safe-domains.txt, lists/strict-domains.txt
 *                        the authoritative NAME sets — exactly what the app
 *                        blocks, with the same region filter (drop us.*)
 *   src/safe.txt, src/strict.txt, src/zones.txt
 *                        the annotated entries, `hostname # TAG: free text`;
 *                        src/safe.txt is the SAFE tier, src/strict.txt the STRICT
 *                        delta, src/zones.txt the zone anchors (RETIRED skipped,
 *                        same rule as the tier lists)
 *
 * ROW SHAPE — exactly these five keys, in this order:
 *   name      the domain, as it appears in the tier lists
 *   tier      safe | strict | zone — which preset blocks it. 'zone' is an anchor;
 *             anchors are tier 'zone' even though they live in the strict list.
 *   category  the UI group. Zone anchors are 'zone' BY TIER, never by text, so a
 *             non-anchor row cannot land in the zone group by accident. Every
 *             other row goes through CATEGORIES below.
 *   zone      the COVERING zone anchor: the anchor whose suffix this name is
 *             (dot-boundary), "" when no anchor covers it, and the anchor's own
 *             name for an anchor row. An anchor row is `zone === name`; a
 *             covered row is blocked by that anchor as a whole zone and is
 *             therefore not individually toggleable — the UI points at the
 *             anchor's row instead. Consequence of the anchor set: a RETIRED
 *             anchor (lgunifiedsmart.com) stays in the strict list as an exact
 *             entry but covers nothing, so its row keeps zone "".
 *   note      the upstream annotation text with the leading `TAG:` marker
 *             removed (the tag is already machine-readable in `tier`), "" when
 *             upstream has no annotation for the name.
 *
 * never drop a domain: a row is emitted for every name in the two lists no matter
 * what its prose says. A note that matches no category rule is filed under
 * `other`, and a name with no annotation at all is still emitted (note "", a
 * warning on stderr) — the UI must show every blockable domain.
 *
 * OUTPUT IS DETERMINISTIC: sorted by category then name (ASCII), LF only, no
 * timestamp, key order fixed, so the same source commit regenerates byte-
 * identical content. Written atomically (tmp + rename) and only after every
 * check below has passed: a failure leaves the previous file untouched.
 *
 * FAILS LOUDLY, before writing anything, when
 *   - a source file is missing (lists/*, src/safe.txt, src/strict.txt, src/zones.txt);
 *   - the checkout is not a git repository, or its HEAD is not the commit the
 *     tier lists next to the output are pinned at (they carry it in their
 *     header): domains.json and the lists MUST describe one upstream revision,
 *     so when the checkout has moved on, regenerate the lists first;
 *   - the tier lists next to the output are not there at all (nothing to pin to);
 *   - the name set derived here differs from the names those tier lists block
 *     (a stale/edited list would otherwise ship a UI that cannot see every
 *     blocked domain, or can toggle a domain that is not in any list).
 *
 * Usage: node tools/gen-domains.mjs [blocklistRepoPath] [outPath]
 *   Defaults: <repo>/../lg-tv-blocklist (sibling checkout) and
 *   <repo>/app/filter/domains.json.
 *   LGTVB_FILTER_OUT_DIR=<dir> (test/CI seam, same style as the LGTVB_*
 *   overrides in app/scripts/common.sh) redirects the default out directory.
 *   An outPath must live next to the tier lists it is checked against.
 *   Node built-ins only.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BLOCKLIST_REPO = resolve(REPO_ROOT, '..', 'lg-tv-blocklist');
const FILTER_DIR = process.env.LGTVB_FILTER_OUT_DIR
  ? resolve(process.env.LGTVB_FILTER_OUT_DIR)
  : join(REPO_ROOT, 'app', 'filter');

// The categories the UI groups by. THE ORDER IS THE ALGORITHM: the first match
// wins, most specific service first, so an entry whose prose names several
// things is filed under the one that says what the endpoint DOES on the wire
// ("ad delivery on the lgappstv store CDN family" is ads, not store). Every rule
// was written against the upstream prose that exists today; a note that matches
// none of them is `other`, which is the explicit fallback and never an error.
// Tests pin the behaviour: the unit test drives classify() directly, and the
// fixture test drives the whole script (a note that matches nothing -> other).
const CATEGORIES = [
  // ACR: the always-on viewing-data beacon family (cdpbeacon/eic./aic./kic.).
  // `beacon` alone is NOT a rule: upstream also calls the SDP telemetry apex a
  // beacon, and that row belongs in telemetry.
  { category: 'acr', text: /\bacr\b|cdpbeacon/i },
  // ThinQ: the appliance-cloud stack; killing it is the documented STRICT cost.
  { category: 'thinq', text: /thinq/i },
  // LG Channels (FAST) — the free-streaming app, feature-killed by design.
  { category: 'channels', text: /lg ?channels|\blgechannel\b|\(fast\)/i },
  // Firmware/content updates: the freeze-by-design family. `app-update` is
  // deliberately NOT here — that is the store's updater (see store below).
  { category: 'ota', text: /\bota\b|firmware|file[- ]transfer|update[- ](check|transfer)|update transfer/i },
  // Ad delivery, promos, recommendations, nudge banners.
  { category: 'ads', text: /\bads?\b|advert|ad serving|ad delivery|promo|recommend|nudge/i },
  // Voice search backend (blocking it breaks the remote's voice search).
  { category: 'voice', text: /voice/i },
  // Third-party interop: Philips Hue N-UPnP discovery, QuickSet Cloud (UEI).
  { category: 'interop', text: /\binterop\b|\bhue\b|quickset|\buei\b|upnp/i },
  // Generic telemetry/config/metrics not named above.
  { category: 'telemetry', text: /telemetry|\bconfig\b|cloud-config|metrics|analytic|heartbeat/i },
  // LG store, shop, billing and the content apps it serves (Gallery+/SDX).
  { category: 'store', text: /\bstore\b|\bshop\b|gallery|billing|\bsdx\b|app[- ]update/i },
  // The fallback. Anything here is prose the captain has not classified yet.
  { category: 'other', text: null }
];

const blocklistRepo = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_BLOCKLIST_REPO;
const outPath = process.argv[3] ? resolve(process.argv[3]) : join(FILTER_DIR, 'domains.json');
const outDir = dirname(outPath);

// Every failure below happens before the first write, so "no partial output" is
// structural: nothing is written until the whole file is built and validated.
function fail(message) {
  console.error('FAIL: ' + message);
  process.exit(1);
}

function readLines(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/);
}

function requireSource(file, why) {
  if (!existsSync(file)) {
    fail('missing source ' + file + ' (' + why + ') — refusing to emit a partial domains.json.');
  }
  return file;
}

// clean_lines() from the reference implementation, same as build-filter-input:
// strip the comment, trim, drop blanks. These are the NAME sets, so the comment
// text is not needed here.
function listNames(file) {
  const names = [];
  for (const raw of readLines(file)) {
    const s = raw.split('#', 1)[0].trim();
    if (s) {
      names.push(s);
    }
  }
  return names;
}

// src/*.txt: `hostname # TAG: free text`. Returns name -> note (the free text
// with the leading SAFE/STRICT/ZONE marker removed). A name that appears twice
// keeps its first annotation: the sources are delta files, so a duplicate is a
// bug upstream, and silently overwriting would hide which line won.
function annotations(file) {
  const map = new Map();
  for (const raw of readLines(file)) {
    const s = raw.trim();
    if (s === '' || s.startsWith('#')) {
      continue;
    }
    const hash = s.indexOf('#');
    const name = (hash === -1 ? s : s.slice(0, hash)).trim().split(/\s+/)[0];
    if (name === '') {
      continue;
    }
    let note = hash === -1 ? '' : s.slice(hash + 1).trim();
    const tag = /^(SAFE|STRICT|ZONE)\b[:\s-]*(.*)$/i.exec(note);
    if (tag !== null) {
      note = tag[2].trim();
    }
    if (!map.has(name)) {
      map.set(name, note);
    }
  }
  return map;
}

// Same rule as build-filter-input's zoneAnchors(): RETIRED is checked on the raw
// line (the marker sits inside the comment), then the comment is stripped and the
// first whitespace-separated token is the anchor.
function zoneAnchors(file) {
  const anchors = [];
  for (const raw of readLines(file)) {
    if (raw.toUpperCase().includes('RETIRED')) {
      continue;
    }
    const s = raw.split('#', 1)[0].trim();
    if (s) {
      anchors.push(s.split(/\s+/)[0]);
    }
  }
  return anchors;
}

export function classify(note) {
  for (const rule of CATEGORIES) {
    if (rule.text !== null && rule.text.test(note)) {
      return rule.category;
    }
  }
  return 'other';
}

// The covering anchor: the longest anchor this name is or is a suffix of at a dot
// boundary. Longest, not first, so a future nested anchor (a.example.com under
// example.com) reports the narrow one.
function coveringZone(name, anchors) {
  let best = '';
  for (const anchor of anchors) {
    const covered = name === anchor || name.endsWith('.' + anchor);
    if (covered && anchor.length > best.length) {
      best = anchor;
    }
  }
  return best;
}

// The pin: the tier list that ships next to the output carries the upstream
// commit it was generated from in its header. domains.json is JSON and cannot
// carry a comment, so the pin is read from there — which is exactly the
// guarantee wanted: the lists and domains.json must describe one revision.
function pinnedSha(listFile) {
  const text = readFileSync(listFile, 'utf8');
  const match = /^# source: lg-tv-blocklist @ ([0-9a-f]{40})$/m.exec(text);
  if (match === null) {
    fail(
      listFile +
        ' has no "# source: lg-tv-blocklist @ <sha>" header — regenerate the tier lists with ' +
        'tools/build-filter-input.mjs first: domains.json has to be pinned to the lists it ships with.'
    );
  }
  return match[1];
}

function headSha() {
  try {
    return execFileSync('git', ['-C', blocklistRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (error) {
    fail(blocklistRepo + ' is not a git checkout (git rev-parse HEAD failed) — no pin to verify.');
  }
}

// Names blocked by a shipped tier list: '=name' exact rules and bare zone
// anchors, headers/comments/blank lines skipped.
function shippedNames(file) {
  const names = [];
  for (const raw of readLines(file)) {
    const s = raw.split('#', 1)[0].trim();
    if (s === '') {
      continue;
    }
    names.push(s.startsWith('=') ? s.slice(1) : s);
  }
  return names;
}

function compareSets(derived, shipped, label) {
  const missing = [...derived].filter((name) => !shipped.has(name));
  const extra = [...shipped].filter((name) => !derived.has(name));
  if (missing.length === 0 && extra.length === 0) {
    return;
  }
  const sample = (names) =>
    names.slice(0, 5).join(', ') + (names.length > 5 ? ', … (+' + (names.length - 5) + ')' : '');
  fail(
    label + ': the tier lists and this checkout disagree about which domains exist — ' +
      'in the checkout but not in the shipped list: [' +
      sample(missing) +
      ']; in the shipped list but not in the checkout: [' +
      sample(extra) +
      ']. Regenerate both with tools/build-filter-input.mjs from the pinned commit.'
  );
}

function main() {
  const listSafe = requireSource(join(blocklistRepo, 'lists', 'safe-domains.txt'), 'SAFE name set');
  const listStrict = requireSource(join(blocklistRepo, 'lists', 'strict-domains.txt'), 'STRICT name set');
  const srcSafe = requireSource(join(blocklistRepo, 'src', 'safe.txt'), 'SAFE annotations');
  const srcStrict = requireSource(join(blocklistRepo, 'src', 'strict.txt'), 'STRICT annotations');
  const srcZones = requireSource(join(blocklistRepo, 'src', 'zones.txt'), 'zone anchors');

  // Pin first: a checkout that moved on must not produce rows for a list it no
  // longer matches, and the message should say what to do about it.
  const shippedStrict = join(outDir, 'filter-input-strict.txt');
  const shippedSafe = join(outDir, 'filter-input-safe.txt');
  if (!existsSync(shippedStrict) || !existsSync(shippedSafe)) {
    fail(
      'no pinned tier lists in ' +
        outDir +
        ' (expected filter-input-{safe,strict}.txt) — run tools/build-filter-input.mjs there first: ' +
        'domains.json is checked against them and has to be pinned to their commit.'
    );
  }
  const pin = pinnedSha(shippedStrict);
  const head = headSha();
  if (head !== pin) {
    fail(
      'pin mismatch: ' +
        blocklistRepo +
        ' is at ' +
        head +
        ' but the tier lists in ' +
        outDir +
        ' are pinned at ' +
        pin +
        ' — regenerate the tier lists from this checkout first (tools/build-filter-input.mjs), ' +
        'then domains.json; the two artifacts must not describe different revisions.'
    );
  }

  // Same region filter as the tier lists: us.* is dropped by owner policy, so
  // such a name is in no list and gets no row (annotated or not).
  const safeNames = listNames(listSafe).filter((name) => !name.startsWith('us.'));
  const strictNames = listNames(listStrict).filter((name) => !name.startsWith('us.'));
  const anchors = zoneAnchors(srcZones);
  const anchorSet = new Set(anchors);
  const safeSet = new Set(safeNames);

  // One row per name, deduplicated across both lists (safe is a subset of strict
  // upstream, and the zone anchors are in the strict list too).
  const names = new Set(strictNames);
  for (const name of safeNames) {
    names.add(name);
  }
  for (const anchor of anchors) {
    names.add(anchor);
  }

  const notes = new Map();
  const annotated = new Set();
  for (const file of [srcSafe, srcStrict, srcZones]) {
    for (const [name, note] of annotations(file)) {
      if (!notes.has(name)) {
        notes.set(name, note);
      }
      if (note !== '') {
        annotated.add(name);
      }
    }
  }

  const rows = [];
  const unannotated = [];
  for (const name of names) {
    const tier = anchorSet.has(name) ? 'zone' : safeSet.has(name) ? 'safe' : 'strict';
    const note = notes.has(name) ? notes.get(name) : '';
    if (note === '' && !notes.has(name)) {
      unannotated.push(name);
    }
    rows.push({
      name,
      tier,
      category: tier === 'zone' ? 'zone' : classify(note),
      zone: coveringZone(name, anchors),
      note
    });
  }

  rows.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category < b.category ? -1 : 1;
    }
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    return 0;
  });

  // The invariant the tests assert, enforced before the write: every domain the
  // shipped lists block is a row, and no row is a domain they do not block.
  compareSets(
    new Set(rows.map((row) => row.name)),
    new Set([...shippedNames(shippedSafe), ...shippedNames(shippedStrict)]),
    'name set'
  );

  const text = JSON.stringify(rows, null, 2) + '\n';
  mkdirSync(outDir, { recursive: true });
  const tmp = outPath + '.tmp';
  try {
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, outPath);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch (cleanup) {
      // The tmp file never existed, or is already gone: the failure below is the
      // one that matters.
    }
    fail('could not write ' + outPath + ' (' + (error.code || error.message) + ').');
  }

  if (unannotated.length > 0) {
    console.error(
      'warn: ' + unannotated.length + ' name(s) have no upstream annotation and were emitted with an ' +
        'empty note and category other: ' + unannotated.join(', ')
    );
  }
  const annotatedDropped = [...annotated].filter((name) => !names.has(name));
  if (annotatedDropped.length > 0) {
    console.log(
      'domains: note — annotated source entries with no row (not in any shipped list, region-filtered, ' +
        'or a retired anchor): ' +
        annotatedDropped.join(', ')
    );
  }

  const byTier = { safe: 0, strict: 0, zone: 0 };
  const byCategory = new Map();
  for (const row of rows) {
    byTier[row.tier] += 1;
    byCategory.set(row.category, (byCategory.get(row.category) || 0) + 1);
  }
  console.log(
    'domains: ' + rows.length + ' rows (safe ' + byTier.safe + ', strict ' + byTier.strict + ', zone ' + byTier.zone + ') -> ' + outPath
  );
  console.log(
    'domains: pinned at lg-tv-blocklist @ ' +
      pin +
      '; categories — ' +
      [...byCategory.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([category, count]) => category + ' ' + count)
        .join(', ')
  );
}

// Importable for the category table's unit test without running the generator:
// only a run as the script itself reaches main(); importing this module (the
// test imports classify) has no side effects.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
