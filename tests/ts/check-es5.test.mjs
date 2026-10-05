// Tests for tools/check-es5.mjs itself.
//
// Why they exist: the scan that guards app/scripts/*.js — the code dnsq.sh
// execs on the TV's node v8.12.0 — is a build gate nobody can run by hand on
// the target. If the gate silently stops scanning (wrong dir, empty tree,
// over-eager comment scrubbing), a post-ES5 construct ships and the failure
// only shows up on the TV. Each test asserts the exact exit code and message.
//
// Every fixture tree is built in os.tmpdir() and the REAL checker is run with
// cwd set to that tree: the checker resolves app/js, app/scripts and src
// relative to cwd, so nothing inside the repository is written or moved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(new URL('../../tools/check-es5.mjs', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'check-es5-'));

// Baseline tree: an ES5 IIFE in app/js, a node CLI in app/scripts, a
// plain-script .ts under src/. require()/module.exports are deliberate — they
// are legal in app/scripts and the scan must not reject them there.
function baseFiles() {
  return {
    'app/js/main.js': "'use strict';\n(function () {\n  var n = 1;\n  return n;\n})();\n",
    'app/scripts/dnsq.js': "var dgram = require('dgram');\nmodule.exports = dgram;\n",
    'src/main.ts': "'use strict';\n(function () {\n  var n = 1;\n  return n;\n})();\n",
  };
}

let seq = 0;
function runChecker(files) {
  seq += 1;
  const tree = join(ROOT, 'tree' + seq);
  for (const rel of Object.keys(files)) {
    mkdirSync(join(tree, dirname(rel)), { recursive: true });
    writeFileSync(join(tree, rel), files[rel]);
  }
  const r = spawnSync(process.execPath, [CHECKER], { cwd: tree, encoding: 'utf8' });
  assert.equal(r.error, undefined, `checker failed to start: ${r.error}`);
  return r;
}

test('passes on an ES5-only tree and reports both scanned trees', () => {
  const r = runChecker(baseFiles());
  assert.equal(r.status, 0, `expected rc 0, got ${r.status} (stderr=${r.stderr})`);
  assert.match(r.stdout, /OK: app\/js is conservative ES5 \(main\.js\)/);
  assert.match(r.stdout, /OK: app\/scripts\/\*\.js is conservative ES5 \(dnsq\.js\)/);
  assert.match(r.stdout, /OK: plain-script guard/);
});

test('fails on a post-ES5 construct in app/scripts — the tree the TV runs', () => {
  const r = runChecker({ ...baseFiles(), 'app/scripts/dnsq.js': 'const injected = 1;\n' });
  assert.equal(r.status, 1, 'a post-ES5 construct in app/scripts must fail the gate');
  assert.match(r.stderr, /FAIL: app\/scripts\/dnsq\.js contains const/);
});

test('tolerates require()/module.exports in app/scripts (the CommonJS ban is app/js only)', () => {
  const r = runChecker(baseFiles());
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /app\/scripts/);
});

test('fails on a post-ES5 construct in app/js (existing check unchanged)', () => {
  const r = runChecker({
    ...baseFiles(),
    'app/js/main.js': "'use strict';\n(function () {\n  var f = () => 1;\n})();\n",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL: main\.js contains arrow function/);
});

test('fails on CommonJS tokens in app/js (plain-script guard unchanged)', () => {
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': 'module.exports = 1;\n' });
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /FAIL: main\.js contains module\.exports — app\/js must stay plain-script <script>-loadable/
  );
});

test('fails on top-level import/export under src (plain-script guard unchanged)', () => {
  const r = runChecker({ ...baseFiles(), 'src/main.ts': 'export const x = 1;\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL: src\/main\.ts uses import\/export/);
});

test('does not false-positive on prose: comments may mention class/let/const/.../=>', () => {
  const r = runChecker({
    ...baseFiles(),
    // dnsq.js:33's real comment is the reason comments are scrubbed.
    'app/scripts/dnsq.js':
      'var x = 1; // type + class + ttl + rdlen must be present\n' +
      '/* let and const and ... and => and ` all live in a comment */\n',
  });
  assert.equal(r.status, 0, `comments must not fail the check (stderr=${r.stderr})`);
});

test('fails when app/scripts has no .js files instead of silently skipping it', () => {
  const files = baseFiles();
  delete files['app/scripts/dnsq.js'];
  const r = runChecker(files);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL: no \.js files found under app\/scripts/);
});
