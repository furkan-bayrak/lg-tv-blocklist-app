#!/usr/bin/env node
/*
 * build-filter-input.mjs — generate the dnscrypt-proxy blocked_names snapshot
 * from the lg-tv-blocklist repo outputs.
 *
 * Port of the S0-proven reference implementation
 * (app-s0/candidate/build-filter-input.py); semantics are pinned by S0:
 *   =name  exact match (dnscrypt-proxy '=' prefix)
 *   name   whole-zone/suffix match (dnscrypt-proxy 'name' shorthand)
 * Region filtering (owner region DE): drop 'us.*' entries, keep 'de.*'.
 * Zone anchors: all src/zones.txt entries except lines mentioning RETIRED.
 *
 * Usage: node tools/build-filter-input.mjs [blocklistRepoPath] [outPath]
 *   Defaults: <repo>/../lg-tv-blocklist (sibling checkout) and
 *   app/filter/filter-input.txt (relative to this repo root).
 *
 * Deterministic output: deduplicated, sorted, LF only. Node built-ins only.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BLOCKLIST_REPO = resolve(REPO_ROOT, '..', 'lg-tv-blocklist');
const DEFAULT_OUT = join(REPO_ROOT, 'app', 'filter', 'filter-input.txt');

const blocklistRepo = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_BLOCKLIST_REPO;
const outPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUT;

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

const strict = cleanEntries(join(blocklistRepo, 'lists', 'strict-domains.txt'));
const zones = zoneAnchors(join(blocklistRepo, 'src', 'zones.txt'));

const entries = [];
for (const d of strict) {
  if (d.startsWith('us.')) {
    continue;
  }
  entries.push('=' + d);
}
for (const z of zones) {
  entries.push(z);
}

// Deterministic output: dedupe + stable sort (ASCII order keeps all '=name'
// exact rules before the bare zone anchors), then write LF-only text.
const unique = Array.from(new Set(entries)).sort();

const headSha = execFileSync('git', ['-C', blocklistRepo, 'rev-parse', 'HEAD'], {
  encoding: 'utf8'
}).trim();

const header = [
  '# lg-tv-blocklist-app filter input — GENERATED, DO NOT EDIT',
  '# generator: tools/build-filter-input.mjs',
  '# source: lg-tv-blocklist @ ' + headSha,
  '# generated: ' + new Date().toISOString()
];

const text = header.concat(unique).join('\n') + '\n';
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, text, 'utf8');

console.log('filter-input: ' + unique.length + ' entries -> ' + outPath);
