#!/usr/bin/env node
/*
 * build-filter-input.mjs — generate the dnscrypt-proxy blocked_names snapshots
 * (SAFE/STRICT tiers) from the lg-tv-blocklist repo outputs.
 *
 * Port of the S0-proven reference implementation
 * (app-s0/candidate/build-filter-input.py); semantics are pinned by S0:
 *   =name  exact match (dnscrypt-proxy '=' prefix)
 *   name   whole-zone/suffix match (dnscrypt-proxy 'name' shorthand)
 * Region filtering (owner region DE): drop 'us.*' entries, keep 'de.*'.
 * Zone anchors: all src/zones.txt entries except lines mentioning RETIRED.
 *
 * Tiers (S6a T1) — same rules on both sides, two differences only:
 *   safe   — lists/safe-domains.txt, exact entries ONLY. Zones are STRICT-only
 *            upstream (src/zones.txt: "STRICT-only zone anchors"; build.py:
 *            "strict = safe + strict-delta (+ zone anchors)"), and the
 *            fresh-install default must not block whole zones, so the SAFE
 *            list carries no anchor.
 *   strict — lists/strict-domains.txt + the zone anchors. This is exactly the
 *            pre-S6a single list, byte for byte.
 * filter-input.txt is written as a byte-identical copy of the strict list: it
 * is the fallback name an older bundled copy of app/scripts/common.sh looks
 * for, and its content keeps the blocking behaviour that existed before tiers.
 *
 * Usage: node tools/build-filter-input.mjs [blocklistRepoPath] [outPath]
 *   Defaults: <repo>/../lg-tv-blocklist (sibling checkout) and, with no
 *   outPath, the three bundled snapshots app/filter/filter-input-{safe,strict}.txt
 *   plus app/filter/filter-input.txt (relative to this repo root).
 *   An explicit outPath writes exactly one file, with the STRICT rules — the
 *   pre-S6a interface, unchanged for callers that pass a path.
 *   LGTVB_FILTER_OUT_DIR=<dir> (test/CI seam, same style as the LGTVB_*
 *   overrides in app/scripts/common.sh) redirects the no-outPath default mode
 *   into <dir> instead of app/filter; an explicit outPath still wins.
 *
 * Deterministic output: deduplicated, sorted, LF only. Node built-ins only.
 * The pinned ref is the source checkout's HEAD, recorded in the header; there
 * is no wall-clock timestamp, so the same source commit regenerates byte-identical
 * files (the commit date of the generated file is the provenance).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BLOCKLIST_REPO = resolve(REPO_ROOT, '..', 'lg-tv-blocklist');
const FILTER_DIR = process.env.LGTVB_FILTER_OUT_DIR
  ? resolve(process.env.LGTVB_FILTER_OUT_DIR)
  : join(REPO_ROOT, 'app', 'filter');

// Tier → source list, and whether the zone anchors apply (STRICT only).
const TIERS = [
  { tier: 'safe', source: 'safe-domains.txt', zones: false },
  { tier: 'strict', source: 'strict-domains.txt', zones: true }
];

const blocklistRepo = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_BLOCKLIST_REPO;
const outPath = process.argv[3] ? resolve(process.argv[3]) : null;

function readLines(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/);
}

// Same as the .py clean_lines(): strip comments, trim, drop blanks.
function cleanEntries(file) {
  const out = [];
  for (const raw of readLines(file)) {
    const s = raw.split('#', 1)[0].trim();
    if (s) {
      out.push(s);
    }
  }
  return out;
}

// Same as the .py zone loop: RETIRED is checked on the raw line (the marker
// lives inside the comment), then the comment is stripped and the first
// whitespace-separated token is the anchor.
function zoneAnchors(file) {
  const zones = [];
  for (const raw of readLines(file)) {
    if (raw.toUpperCase().includes('RETIRED')) {
      continue;
    }
    const s = raw.split('#', 1)[0].trim();
    if (s) {
      zones.push(s.split(/\s+/)[0]);
    }
  }
  return zones;
}

// One tier's entry list: '=name' per domain (region-filtered), plus the zone
// anchors for STRICT. Deduplicated and stable-sorted (ASCII order keeps all
// '=name' exact rules before the bare zone anchors).
function tierEntries(tier, zones) {
  const entries = [];
  for (const d of cleanEntries(join(blocklistRepo, 'lists', tier.source))) {
    if (d.startsWith('us.')) {
      continue;
    }
    entries.push('=' + d);
  }
  if (tier.zones) {
    for (const z of zones) {
      entries.push(z);
    }
  }
  return Array.from(new Set(entries)).sort();
}

function writeList(outFile, entries) {
  const text = header.concat(entries).join('\n') + '\n';
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, text, 'utf8');
  console.log('filter-input: ' + entries.length + ' entries -> ' + outFile);
}

const zones = zoneAnchors(join(blocklistRepo, 'src', 'zones.txt'));

const headSha = execFileSync('git', ['-C', blocklistRepo, 'rev-parse', 'HEAD'], {
  encoding: 'utf8'
}).trim();

const header = [
  '# lg-tv-blocklist-app filter input — GENERATED, DO NOT EDIT',
  '# generator: tools/build-filter-input.mjs',
  '# source: lg-tv-blocklist @ ' + headSha
];

if (outPath) {
  // Pre-S6a interface: one file, STRICT rules.
  writeList(outPath, tierEntries(TIERS[1], zones));
} else {
  for (const tier of TIERS) {
    writeList(join(FILTER_DIR, 'filter-input-' + tier.tier + '.txt'), tierEntries(tier, zones));
  }
  // Legacy single-file name: the strict list, byte-identical (fallback path in
  // app/scripts/common.sh when a bundle has no tier files).
  writeList(join(FILTER_DIR, 'filter-input.txt'), tierEntries(TIERS[1], zones));
}
