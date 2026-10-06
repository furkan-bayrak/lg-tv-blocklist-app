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
 *             upstream has no annotation for the name. ZONE ROWS ARE THE ONE
 *             TRANSFORMATION of that text (see anchorNote()): the upstream prose
 *             for an anchor ("kills all X subdomains") describes the STRICT
 *             preset, where the anchor ships as a bare whole-subtree entry. The
 *             SAFE preset carries no bare anchor at all, so the same row ON there
 *             adds only the exact apex rule (`=X`) — the note says which tier
 *             delivers what instead of promising the subtree in a tier that does
 *             not block it. Names, tiers, categories and zones are untouched by
 *             the transformation; nothing is dropped for its prose.
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
 * SECOND OUTPUT — src/domains.gen.ts (the UI's copy). The webview cannot read
 * files at runtime and the fixed bridge command set has no read command, so the
 * row metadata the S6b domain-list UI renders has to be compiled in. The same
 * run emits it from the same rows: a committed plain-script TypeScript module
 * (global LgDomains), field-per-row plus each tier's preset entry count. That
 * count is list_entry_count's rule from common.sh — every non-comment,
 * non-blank line of the tier's shipped preset list — i.e. exactly the number
 * check.sh reports as entries=<N> for that tier with no overrides stored.
 * Unlike domains.json this file is also regenerable from COMMITTED files alone
 * (no checkout, no network), because the UI work must not depend on the pin:
 *     node tools/gen-domains.mjs --emit-ts [tsOutPath]
 * The two paths emit the same bytes for the same data: --emit-ts reads the
 * committed domains.json and preset lists, and the full run emits from the
 * domains.json it just wrote. The full run only emits the module when its
 * output is the default app/filter/domains.json (a fixture run into a temp dir
 * must not touch the repo's src/).
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
 *   <repo>/app/filter/domains.json. Emits src/domains.gen.ts as well when the
 *   output path is the default one.
 *        node tools/gen-domains.mjs --emit-ts [tsOutPath]
 *   Offline: reads only <repo>/app/filter/domains.json and the shipped preset
 *   lists and writes only the TypeScript module (default
 *   <repo>/src/domains.gen.ts).
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
// The committed UI module --emit-ts / the full default run writes.
const DEFAULT_TS_PATH = join(REPO_ROOT, 'src', 'domains.gen.ts');

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

const ARGS = process.argv.slice(2);
// --emit-ts is the OFFLINE path: it reads the committed app/filter/domains.json
// plus the two shipped preset lists and writes only the TypeScript module, so it
// needs no pinned upstream checkout and no network. Without it the positional
// arguments are the checkout and the domains.json destination, as before.
const EMIT_TS_ONLY = ARGS.indexOf('--emit-ts') !== -1;
let tsOutPath = DEFAULT_TS_PATH;
let positional = ARGS;
if (EMIT_TS_ONLY) {
  positional = ARGS.slice(0, ARGS.indexOf('--emit-ts')).concat(ARGS.slice(ARGS.indexOf('--emit-ts') + 1));
  if (positional.length > 1) {
    fail('--emit-ts takes at most one argument (the module destination).');
  }
  if (positional.length === 1) {
    tsOutPath = resolve(positional[0]);
  }
  positional = [];
}
const blocklistRepo = positional[0] ? resolve(positional[0]) : DEFAULT_BLOCKLIST_REPO;
const outPath = positional[1] ? resolve(positional[1]) : join(FILTER_DIR, 'domains.json');
const outDir = dirname(outPath);
const DEFAULT_DOMAINS_PATH = join(FILTER_DIR, 'domains.json');

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

// The one place this script does NOT ship upstream prose verbatim. Upstream's
// anchor note ("umbrella zone — kills all lge.com subdomains") is true of the
// STRICT preset, which ships the anchor as a bare entry, i.e. as the whole
// subtree; it is false of SAFE, which ships no bare anchor at all, so the same row
// ON there adds only the exact apex rule (=lge.com). The suffix states which tier
// delivers what, so the shipped copy can never promise a subtree the active tier
// does not block (S6b review F4: the note is UI copy and T7's blast-radius warning
// is tier-aware for the same reason). An anchor with no upstream prose keeps ""
// (the unannotated warning still fires; the UI falls back to its own zone
// warning) — nothing is invented for it.
function anchorNote(note, name) {
  if (note === '') {
    return '';
  }
  return (
    note + ' (blocked as a whole zone under STRICT; under SAFE this row blocks only ' + name + ')'
  );
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

// --- the committed TypeScript module the UI consumes -------------------------
// Everything below is the SECOND output: src/domains.gen.ts, generated from the
// committed domains.json plus the shipped preset lists. It is deliberately
// independent of the pinned checkout so the UI work can regenerate and test it
// offline (--emit-ts).

const ROW_KEYS = ['name', 'tier', 'category', 'zone', 'note'];
const TIERS = ['safe', 'strict', 'zone'];

// list_entry_count() from app/scripts/common.sh, to the byte: every line that is
// neither a comment nor blank is one blocked_names entry. check.sh reports this
// number as `entries=<N>` for the materialized list, so with no overrides stored
// (the preset materialized unchanged) the value is the preset list's own count.
function listEntryCount(file) {
  let count = 0;
  for (const line of readLines(file)) {
    if (line !== '' && line.charAt(0) !== '#') {
      count += 1;
    }
  }
  return count;
}

// A TypeScript double-quoted string literal, ASCII only: JSON.stringify does the
// quoting/escaping, then every non-ASCII code point becomes \uXXXX. Notes are
// upstream copy and carry typographic characters (em dashes, arrows); escaping
// them keeps the generated bytes encoding-independent and the module safe to
// load from a plain <script> tag.
function tsString(value) {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (ch) => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

// The generated module text, header and body from one place so the exact
// regeneration command appears once and cannot drift from the CLI.
function tsModuleText(rows, entries) {
  const anchors = rows.filter((row) => row.anchor).length;
  const lines = [];
  lines.push('/*');
  // ASCII only: the whole generated file is 7-bit so its bytes are the same
  // under any editor encoding, and a plain <script> tag cannot mis-decode it.
  lines.push(' * src/domains.gen.ts -- GENERATED FILE, DO NOT EDIT BY HAND.');
  lines.push(' *');
  lines.push(' * Generator: tools/gen-domains.mjs');
  lines.push(' * Regenerate from the COMMITTED files alone (no network, no upstream checkout):');
  lines.push(' *');
  lines.push(' *     node tools/gen-domains.mjs --emit-ts');
  lines.push(' *');
  lines.push(' * The full regeneration (node tools/gen-domains.mjs, which needs the pinned');
  lines.push(' * lg-tv-blocklist checkout) writes app/filter/domains.json first and emits this');
  lines.push(' * module from it, so both paths produce the same bytes for the same data.');
  lines.push(' *');
  lines.push(' * The TV webview cannot read files at runtime and the fixed bridge command set');
  lines.push(' * has no read command, so the row metadata has to be compiled in. The single');
  lines.push(' * source of truth stays app/filter/domains.json; this is that file in the shape');
  lines.push(' * the UI consumes. rows is domains.json file order (category, then name) with');
  lines.push(' * anchor true iff the row is a zone anchor (tier === zone, zone === name).');
  lines.push(' * presetEntries is each tier preset ENTRY COUNT, counted from the shipped');
  lines.push(' * preset lists with list_entry_count()\'s rule (app/scripts/common.sh), i.e.');
  lines.push(' * what check.sh reports as entries=<N> for that tier with no overrides.');
  lines.push(' *');
  lines.push(' * ES5: plain object literal, no Map/Set, no getters, no template literals, so');
  lines.push(' * tools/check-es5.mjs and tools/check-node8.mjs stay green on the compiled file.');
  lines.push(' */');
  lines.push('');
  lines.push('interface LgDomainRow {');
  lines.push('  name: string;');
  lines.push('  tier: \'safe\' | \'strict\' | \'zone\';');
  lines.push('  category: string;');
  lines.push('  zone: string;');
  lines.push('  anchor: boolean;');
  lines.push('  note: string;');
  lines.push('}');
  lines.push('');
  lines.push('interface LgDomainsModule {');
  lines.push('  schema: number;');
  lines.push('  count: number;');
  lines.push('  anchors: number;');
  lines.push('  presetEntries: { safe: number; strict: number };');
  lines.push('  rows: LgDomainRow[];');
  lines.push('}');
  lines.push('');
  lines.push('var LgDomains: LgDomainsModule = {');
  lines.push('  schema: 1,');
  lines.push('  count: ' + rows.length + ',');
  lines.push('  anchors: ' + anchors + ',');
  lines.push('  presetEntries: { safe: ' + entries.safe + ', strict: ' + entries.strict + ' },');
  lines.push('  rows: [');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    lines.push(
      '    { name: ' +
        tsString(row.name) +
        ', tier: ' +
        tsString(row.tier) +
        ', category: ' +
        tsString(row.category) +
        ', zone: ' +
        tsString(row.zone) +
        ', anchor: ' +
        (row.anchor ? 'true' : 'false') +
        ', note: ' +
        tsString(row.note) +
        ' }' +
        (i === rows.length - 1 ? '' : ',')
    );
  }
  lines.push('  ]');
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function requireCommitted(file, why) {
  if (!existsSync(file)) {
    fail('missing committed ' + file + ' (' + why + ') — regenerate it before emitting the UI module.');
  }
  return file;
}

// The committed domains.json held to the shape this module ships: exactly the
// five keys in their generated order, every value the documented type. A
// hand-edited, truncated or reordered file must fail here, before a byte is
// written, rather than ship a UI that groups or toggles on a lie.
function readCommittedRows(file) {
  requireCommitted(file, 'the UI module\'s source of truth');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(file + ' is not valid JSON (' + (error.message || error) + ').');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail(file + ' is not a non-empty array of rows.');
  }
  const rows = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    const where = file + ' row ' + (i + 1);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(where + ' is not an object.');
    }
    if (Object.keys(raw).join(',') !== ROW_KEYS.join(',')) {
      fail(where + ' keys are [' + Object.keys(raw).join(', ') + '], expected [' + ROW_KEYS.join(', ') + '].');
    }
    if (typeof raw.name !== 'string' || !/^[a-z0-9.-]+$/.test(raw.name)) {
      fail(where + ' has an invalid name.');
    }
    if (!TIERS.includes(raw.tier)) {
      fail(where + ' has tier ' + JSON.stringify(raw.tier) + '; expected safe|strict|zone.');
    }
    if (typeof raw.category !== 'string' || raw.category === '') {
      fail(where + ' has an invalid category.');
    }
    if (typeof raw.zone !== 'string') {
      fail(where + ' has an invalid zone.');
    }
    if (typeof raw.note !== 'string') {
      fail(where + ' has an invalid note.');
    }
    const anchor = raw.tier === 'zone';
    // An anchor is its own zone; a covered row names a different anchor; a row
    // that names itself without being an anchor cannot be covered by anything.
    if (anchor && raw.zone !== raw.name) {
      fail(where + ' is an anchor but its zone is ' + JSON.stringify(raw.zone) + '.');
    }
    if (!anchor && raw.zone === raw.name) {
      fail(where + ' is not an anchor but its zone is its own name.');
    }
    rows.push({
      name: raw.name,
      tier: raw.tier,
      category: raw.category,
      zone: raw.zone,
      anchor: anchor,
      note: raw.note
    });
  }
  // The UI renders rows in file order; a hand-edited file out of order would
  // silently change the list view, so it is refused here too.
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const ordered = prev.category < cur.category || (prev.category === cur.category && prev.name < cur.name);
    if (!ordered) {
      fail(file + ' is not in category-then-name order: ' + prev.name + ' -> ' + cur.name + '.');
    }
  }
  return rows;
}

// Writes atomically (tmp + rename) after every check has passed: a failure
// leaves the previous file untouched, exactly like domains.json.
function writeTextAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  try {
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch (cleanup) {
      // The tmp file never existed, or is already gone: the failure below is the
      // one that matters.
    }
    fail('could not write ' + file + ' (' + (error.code || error.message) + ').');
  }
}

export function emitTypeScript(domainsFile, safeList, strictList, tsOut) {
  requireCommitted(safeList, 'the SAFE preset list');
  requireCommitted(strictList, 'the STRICT preset list');
  const rows = readCommittedRows(domainsFile);
  const entries = { safe: listEntryCount(safeList), strict: listEntryCount(strictList) };
  // The counts come from the shipped lists (the same rule check.sh uses); the row
  // data has to agree with them, or the module would carry a count and a row set
  // that describe different lists. Both invariants are proven before the write,
  // and the test suite asserts them from the other side as well.
  const safeRows = rows.filter((row) => row.tier === 'safe').length;
  const anchors = rows.filter((row) => row.anchor).length;
  if (entries.safe !== safeRows) {
    fail(
      'preset entry count mismatch: ' +
        safeList +
        ' holds ' +
        entries.safe +
        ' entries but ' +
        safeRows +
        ' rows are tier safe.'
    );
  }
  if (entries.strict !== rows.length + anchors) {
    fail(
      'preset entry count mismatch: ' +
        strictList +
        ' holds ' +
        entries.strict +
        ' entries but the rows need ' +
        (rows.length + anchors) +
        ' (one exact rule per row plus one bare anchor per anchor).'
    );
  }
  writeTextAtomic(tsOut, tsModuleText(rows, entries));
  console.log(
    'domains-ts: ' +
      rows.length +
      ' rows (safe ' +
      safeRows +
      ', strict ' +
      (rows.length - safeRows - anchors) +
      ', zone ' +
      anchors +
      '), preset entries safe ' +
      entries.safe +
      ' / strict ' +
      entries.strict +
      ' -> ' +
      tsOut
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
      note: tier === 'zone' ? anchorNote(note, name) : note
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

  writeTextAtomic(outPath, JSON.stringify(rows, null, 2) + '\n');

  // The UI's copy of the same rows, but only for a real regeneration into the
  // repo's app/filter (fixture runs into a temp dir must not touch src/). It
  // re-reads the file just written through the same validation the offline path
  // uses, so both paths emit identical bytes for identical data.
  if (outPath === DEFAULT_DOMAINS_PATH) {
    emitTypeScript(outPath, shippedSafe, shippedStrict, tsOutPath);
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
  if (EMIT_TS_ONLY) {
    emitTypeScript(
      DEFAULT_DOMAINS_PATH,
      join(FILTER_DIR, 'filter-input-safe.txt'),
      join(FILTER_DIR, 'filter-input-strict.txt'),
      tsOutPath
    );
  } else {
    main();
  }
}
