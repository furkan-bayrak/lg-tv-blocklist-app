#!/usr/bin/env node
/*
 * Runs the REAL node 8 parser (`node@8.17.0 --check`) over every shipped .js
 * file: the TV-side tree, which dnsq.sh execs on the platform's node v8.12.0,
 * and the webview bundle in app/js.
 *
 * Why it exists next to tools/check-es5.mjs: that checker is a pattern match
 * over masked text, so a gap in its pattern list — or a masking bug in the
 * lexer that decides which bytes are code — can hide a file node 8 refuses to
 * parse. A parser cannot be misled that way, so this is the ground truth for
 * “does the device's engine accept this file”, and the pattern list is left
 * responsible only for the ES5-policy forms node 8 accepts anyway.
 *
 * Usage: npm run check:node8
 *   CHECK_NODE8_BIN=/path/to/node8   use a node 8 binary already on the machine
 *                                    (no registry access needed)
 *   CHECK_NODE8_ALLOW_SKIP=1         when node 8 cannot be obtained (offline),
 *                                    print UNVERIFIED and exit 0 instead of
 *                                    failing — a gate that never ran must never
 *                                    report OK, so the default is exit 2.
 *
 * It is NOT part of `npm test`: fetching node@8.17.0 needs the npm registry, and
 * a unit-test run must not depend on the network. CI runs it as its own step.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TREES = ['app/js', 'app/scripts'];
// dnsq.sh execs this file on the TV: if the recursive walk ever stops listing
// it, this gate would quietly stop covering the device.
const REQUIRED = ['app/scripts/dnsq.js'];
const NODE8_ARGS = ['--yes', 'node@8.17.0'];
const DOWNLOAD_TIMEOUT_MS = 600_000;
const CHECK_TIMEOUT_MS = 120_000;
const ALLOW_SKIP = process.env.CHECK_NODE8_ALLOW_SKIP === '1';

function run(command, args, timeout) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function listJsFiles(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) return null;
  const found = [];
  const walk = (dir, prefix) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : prefix + '/' + entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.isFile() && entry.name.endsWith('.js')) found.push(join(root, rel));
    }
  };
  walk(root, '');
  return found;
}

function versionOf(bin) {
  const r = run(bin, ['--version'], CHECK_TIMEOUT_MS);
  if (r.error || r.status !== 0) return null;
  const out = (r.stdout || '').trim();
  return /^v8\./.test(out) ? out : null;
}

// Ask node 8 for its own path once and then drive that binary directly: one
// registry round-trip for the whole run instead of one per file.
function resolveNode8() {
  const override = process.env.CHECK_NODE8_BIN;
  if (override !== undefined && override !== '') {
    const version = versionOf(override);
    // A node 8 binary that cannot even print its version is not usable either.
    return version === null
      ? { error: 'CHECK_NODE8_BIN=' + override + ' is not a node v8 binary' }
      : { bin: override, version };
  }
  const download = run(
    'npx',
    [...NODE8_ARGS, '-e', 'process.stdout.write(process.execPath)'],
    DOWNLOAD_TIMEOUT_MS
  );
  if (download.error || download.status !== 0) {
    const why = download.error
      ? download.error.code || download.error.message
      : 'npx exited ' + download.status;
    return { error: 'could not obtain node@8.17.0 via npx (' + why + ')' };
  }
  const bin = (download.stdout || '').trim();
  const version = bin === '' ? null : versionOf(bin);
  return version === null
    ? { error: 'npx did not yield a usable node v8 binary path' }
    : { bin, version };
}

function unverified(reason) {
  console.error('UNVERIFIED: the node 8 parse gate did not run — ' + reason);
  console.error('  Point CHECK_NODE8_BIN at a node v8 binary, or run with registry access.');
  if (ALLOW_SKIP) {
    console.error('  CHECK_NODE8_ALLOW_SKIP=1 is set: reporting UNVERIFIED and exiting 0.');
    process.exit(0);
  }
  console.error(
    '  Refusing to exit 0 for a gate that never ran — set CHECK_NODE8_ALLOW_SKIP=1 to skip loudly.'
  );
  process.exit(2);
}

let files = [];
for (const tree of TREES) {
  const found = listJsFiles(tree);
  if (found === null) {
    console.error('FAIL: ' + tree + ' is missing — there is nothing to parse.');
    process.exit(1);
  }
  if (found.length === 0) {
    console.error('FAIL: no .js files found under ' + tree + ' — refusing to pass an empty tree.');
    process.exit(1);
  }
  files = files.concat(found);
}
const unreached = REQUIRED.filter((file) => !files.includes(file));
if (unreached.length > 0) {
  console.error('FAIL: the walk never reached ' + unreached.join(', ') + ' — the TV entry point would be unchecked.');
  process.exit(1);
}

const node8 = resolveNode8();
if (node8.error) unverified(node8.error);

const failures = [];
for (const file of files) {
  const r = run(node8.bin, ['--check', file], CHECK_TIMEOUT_MS);
  if (r.error) {
    failures.push(file + ': could not run the parser (' + (r.error.code || r.error.message) + ')');
    continue;
  }
  if (r.status !== 0) {
    const detail = (r.stderr || '').trim().split('\n').slice(0, 8).join('\n  ');
    failures.push(file + ' is not parseable by ' + node8.version + ':\n  ' + detail);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error('FAIL: ' + failure);
  console.error(
    '\n' + failures.length + ' of ' + files.length + ' file(s) rejected by node ' + node8.version + '.'
  );
  console.error('This is the parser the device runs, so the app would not start there.');
  process.exit(1);
}

console.log(
  'OK: node ' + node8.version + ' --check passed on ' + files.length + ' file(s) — ' + files.join(', ')
);
