// Tests for tools/check-es5.mjs itself.
//
// Why they exist: the scan that guards app/scripts/*.js — the code dnsq.sh
// execs on the TV's node v8.12.0 — is a build gate nobody can run by hand on
// the target. If the gate silently stops scanning (wrong dir, empty tree,
// over-eager masking of strings/comments/regex literals), a post-ES5 construct
// ships and the failure only shows up on the TV. Each test asserts the exact
// exit code and message.
//
// Soundness of the masker is pinned here too: the checker blanks non-code spans
// before matching, so a regex literal holding `/` used to swallow real code and
// every case in the "blinding" group below passed with rc 0 at e4bb2e9.
//
// Every fixture tree is built in os.tmpdir() and the REAL checker is run with
// cwd set to that tree: the checker resolves app/js, app/scripts and src
// relative to cwd, so nothing inside the repository is written or moved. The
// trees are removed again in the after() hook below — before it, every run left
// eight unique /tmp/check-es5-* trees behind.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(new URL('../../tools/check-es5.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'check-es5-'));

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

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
function runChecker(files, emptyDirs = []) {
  seq += 1;
  const tree = join(ROOT, 'tree' + seq);
  for (const rel of emptyDirs) {
    mkdirSync(join(tree, rel), { recursive: true });
  }
  for (const rel of Object.keys(files)) {
    mkdirSync(join(tree, dirname(rel)), { recursive: true });
    writeFileSync(join(tree, rel), files[rel]);
  }
  const r = spawnSync(process.execPath, [CHECKER], { cwd: tree, encoding: 'utf8' });
  assert.equal(r.error, undefined, `checker failed to start: ${r.error}`);
  return r;
}

// The post-ES5 construct must be found in BOTH trees the checker walks: app/js
// is the webview's code, app/scripts is the code node v8.12.0 executes.
function assertFailsInBothTrees(name, code, expected) {
  for (const target of ['app/js/main.js', 'app/scripts/dnsq.js']) {
    const r = runChecker({ ...baseFiles(), [target]: code });
    assert.equal(
      r.status,
      1,
      `${name}: ${target} expected rc 1, got ${r.status} (stdout=${r.stdout} stderr=${r.stderr})`
    );
    assert.match(r.stderr, expected, `${name}: ${target} expected ${expected}, stderr=${r.stderr}`);
  }
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
    // dnsq.js:33's real comment is the reason comments are masked.
    'app/scripts/dnsq.js':
      'var x = 1; // type + class + ttl + rdlen must be present\n' +
      '/* let and const and ... and => and ` all live in a comment */\n',
  });
  assert.equal(r.status, 0, `comments must not fail the check (stderr=${r.stderr})`);
});

// ---------------------------------------------------------------------------
// The masker must not be blindable.
//
// A regex literal that contains `/` (or a character class holding `/*`) used to
// be read as the start of a comment: the rest of the line/file was blanked, so
// the post-ES5 construct after it was never matched. All of the payloads below
// passed with rc 0 at e4bb2e9 (old checker 36f6d64 failed them by accident, on
// the raw text); each must FAIL now, in both trees.
// ---------------------------------------------------------------------------
test('blinding case 1: a regex literal with an escaped slash must not hide const', () => {
  assertFailsInBothTrees('case 1', 'var re = /\\//; const x = 1;\n', /contains const/);
});

test('blinding case 2: replace(/\\//g, ...) must not hide let', () => {
  assertFailsInBothTrees('case 2', "p.replace(/\\//g,'-'); let n = 1;\n", /contains let/);
});

test('blinding case 3: if (/\\//.test(p)) must not hide let', () => {
  assertFailsInBothTrees('case 3', 'if (/\\//.test(p)) { let q = 1; }\n', /contains let/);
});

test('blinding case 4: a regex literal must not hide an arrow function', () => {
  assertFailsInBothTrees('case 4', 'var re = /\\//; var f = () => 1;\n', /contains arrow function/);
});

test('blinding case 5: a regex literal must not hide a template literal', () => {
  assertFailsInBothTrees('case 5', 'var re = /\\//; var s = `x`;\n', /contains template literal/);
});

test('blinding case 7: /[//]/ must not hide const (a slash in a class does not end the literal)', () => {
  assertFailsInBothTrees('case 7', 'var re = /[//]/; const x = 1;\n', /contains const/);
});

test('blinding case 8: /[/*]/ … const … */ must not hide const (nor pass on the trailing */)', () => {
  assertFailsInBothTrees('case 8', 'var re = /[/*]/;\nconst x = 1;\n*/\n', /contains const/);
});

test('blinding case 6: a regex literal must not hide `??` and `?.`', () => {
  const code = 'var re = /\\//; var a = b ?? 1; var c = d?.e;\n';
  for (const target of ['app/js/main.js', 'app/scripts/dnsq.js']) {
    const r = runChecker({ ...baseFiles(), [target]: code });
    assert.equal(r.status, 1, `case 6: ${target} expected rc 1, got ${r.status} (stdout=${r.stdout})`);
    assert.match(r.stderr, /contains nullish coalescing/, `case 6: ${target} stderr=${r.stderr}`);
    assert.match(r.stderr, /contains optional chaining/, `case 6: ${target} stderr=${r.stderr}`);
  }
});

// ---------------------------------------------------------------------------
// The pattern list must cover what node v8 actually refuses.
//
// Measured with the real node v8.17.0 binary (`npx node@8.17.0 --check`): it
// rejects every sample below, and before these rules existed all of them passed
// this gate with rc 0 — the gate advertised as the automated compatibility check
// for the code the TV executes could not see the syntax that breaks the TV.
// ---------------------------------------------------------------------------
const NODE8_FATAL = [
  ['optional chaining (`b?.c`)', 'var x = b?.c;\n', /contains optional chaining/],
  ['nullish coalescing (`b ?? 1`)', 'var x = b ?? 1;\n', /contains nullish coalescing/],
  ['logical assignment (`a ||= 1`)', 'var x = a ||= 1;\n', /contains logical assignment/],
  ['logical assignment (`a &&= 1`)', 'var x = a &&= 1;\n', /contains logical assignment/],
  ['nullish assignment (`a ??= 1`)', 'var x = a ??= 1;\n', /contains nullish coalescing/],
  ['numeric separator (`1_000`)', 'var x = 1_000;\n', /contains numeric separator/],
  ['BigInt literal (`1n`)', 'var x = 1n;\n', /contains BigInt literal/],
  ['optional catch binding (`catch {`)', 'try { f(); } catch { g(); }\n', /contains optional catch binding/],
];

for (const [name, code, expected] of NODE8_FATAL) {
  test(`node-8-fatal: ${name} fails in both trees`, () => {
    assertFailsInBothTrees(name, code, expected);
  });
}

test('still passes: ES5 neighbours of the new rules (`flag ?.5 : 1`, identifiers like `step_1_2`)', () => {
  const r = runChecker({
    ...baseFiles(),
    // `?.` followed by a digit is the ES5 conditional with a `.5` literal, not
    // optional chaining (the spec forbids a digit right after `?.`), and
    // `step_1_2` is an identifier, not a numeric separator.
    'app/js/main.js':
      'var flag = 1;\nvar n = flag ? .5 : 1;\nvar m = flag ?.5 : 1;\nvar step_1_2 = n + m;\n',
  });
  assert.equal(r.status, 0, `expected rc 0 (stdout=${r.stdout} stderr=${r.stderr})`);
});

// The other direction: division must stay division. If a `/` after a value is
// mistaken for a regex literal, the "body" it swallows can hide real code — the
// same silent pass from the other side.
test('division after a number, `)`, `]` or an object-literal `}` cannot hide const', () => {
  for (const code of [
    'var n = 10 / 2; const x = 1;\n',
    'var n = f() / 2; const x = 1;\n',
    'var n = arr[0] / 2; const x = 1;\n',
    'var n = { a: 1 } / 2; const x = 1;\n',
  ]) {
    const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
    assert.equal(r.status, 1, `expected rc 1 for ${JSON.stringify(code)} (stderr=${r.stderr})`);
    assert.match(r.stderr, /contains const/, `expected const to be reported (stderr=${r.stderr})`);
  }
});

// Fail closed: a file the masker cannot read reliably must FAIL, never pass.
// Every one of these was a silent rc 0 at e4bb2e9 (or a pass for the wrong
// reason), because the span never terminated where the old scrub expected.
test('fail-closed: an unterminated single-quoted string fails instead of reporting OK', () => {
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': "var s = 'abc\n" });
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /unterminated single-quoted string/);
});

test('fail-closed: an unterminated double-quoted string fails instead of reporting OK', () => {
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': 'var s = "abc\n' });
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /unterminated double-quoted string/);
});

test('fail-closed: an unterminated template literal fails instead of reporting OK', () => {
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': 'var s = `abc\n' });
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /unterminated template literal/);
});

test('fail-closed: an unterminated block comment fails instead of reporting OK', () => {
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': '/* let and const\n' });
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /unterminated block comment/);
});

test('fail-closed: an unterminated regex literal fails instead of reporting OK', () => {
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': 'var re = /abc\n' });
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /unterminated regular expression/);
});

test('fail-closed: a `/` the masker cannot classify fails instead of reporting OK', () => {
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': 'var a = 1 @ / 2;\n' });
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /cannot classify/);
});

// ---------------------------------------------------------------------------
// Round 2, hole B: two measured routes printed OK while hiding constructs the
// checker catches everywhere else.
//
// B1 — `var f = function () {} / 2; const HIDDEN = 42; var g = 1 / 3;` was rc 0.
// The `}` closing a function-expression body was classified as a statement
// block, so the division `/` opened a regex literal that swallowed the rest of
// the line — HIDDEN included (the same route also hid `var v = x?.y;` and
// `var n = 1_000;`).
//
// B2 — `if (x) /[/*]/.test(y); const AFTER = 1;` was rc 0 (and so was the
// `/[//]/` variant): a `/` after *any* `)` was called division, so the regex's
// own `/*` bytes opened a comment span that ran to the next real `*/`.
//
// Both positions are lexically ambiguous, so the masker refuses to guess and
// FAILS CLOSED with an explicit “ambiguous” message. A loud false FAIL is
// acceptable here; a silent pass is not (real code almost never divides by a
// function expression).
// ---------------------------------------------------------------------------
test('fail-closed (B1): a `/` after a function-expression body `}` is ambiguous, not a regex', () => {
  const code = 'var f = function () {} / 2; const HIDDEN = 42; var g = 1 / 3;\n';
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /ambiguous \/ after \} at offset \d+/);
  assert.match(r.stderr, /contains const/, 'the construct the old route erased must be reported');
});

test('fail-closed (B1): the same route must not hide `?.` or a numeric separator', () => {
  for (const [hidden, expected] of [
    ['var v = x?.y;', /contains optional chaining/],
    ['var n = 1_000;', /contains numeric separator/],
  ]) {
    const r = runChecker({
      ...baseFiles(),
      'app/scripts/dnsq.js': `var f = function () {} / 2; ${hidden} var g = 1 / 3;\n`,
    });
    assert.equal(r.status, 1, `expected rc 1 for ${hidden} (stdout=${r.stdout})`);
    assert.match(r.stderr, /ambiguous \/ after \}/, `stderr=${r.stderr}`);
    assert.match(r.stderr, expected, `expected ${expected}, stderr=${r.stderr}`);
  }
});

test('fail-closed (B2): a regex layer after an `if (…)` header cannot hide const', () => {
  const code = 'if (x) /[/*]/.test(y); const AFTER = 1;\nvar z = 1;\n*/\n';
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /contains const/, `stderr=${r.stderr}`);
});

test('fail-closed (B2): the `/[//]/` variant fails in both trees', () => {
  for (const target of ['app/js/main.js', 'app/scripts/dnsq.js']) {
    const r = runChecker({ ...baseFiles(), [target]: 'if (x) /[//]/.test(y); const AFTER = 1;\n' });
    assert.equal(r.status, 1, `${target}: expected rc 1, got ${r.status} (stdout=${r.stdout})`);
    assert.match(r.stderr, /contains const/, `${target}: stderr=${r.stderr}`);
  }
});

test('a `/` after any control header `)` is statement position: if/while/for/with/catch/switch', () => {
  for (const header of ['if (x)', 'while (x)', 'for (;x;)', 'with (x)', 'catch (x)', 'switch (x)']) {
    const r = runChecker({ ...baseFiles(), 'app/js/main.js': `${header} /[//]/.test(y); const AFTER = 1;\n` });
    assert.equal(r.status, 1, `${header}: expected rc 1, got ${r.status} (stdout=${r.stdout})`);
    assert.match(r.stderr, /contains const/, `${header}: stderr=${r.stderr}`);
  }
});

test('fail-closed (B2): a `/` after a `)` of unclassifiable kind fails instead of guessing', () => {
  const r = runChecker({ ...baseFiles(), 'app/js/main.js': 'var a = 1 @ (x) / 2;\n' });
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /ambiguous \/ after \) at offset \d+/);
});

test('still passes: a regex after a statement block `}` (block, not expression position)', () => {
  const r = runChecker({
    ...baseFiles(),
    'app/js/main.js': 'if (x) { y(); } /re/.test(x);\n',
  });
  assert.equal(r.status, 0, `expected rc 0 (stdout=${r.stdout} stderr=${r.stderr})`);
});

test('still passes: strings with `//`/`/*` and a regex holding a quote and a slash in a class', () => {
  const r = runChecker({
    ...baseFiles(),
    'app/js/main.js':
      "var u = 'http://example.com/x';\n" +
      "var c = '/* not a comment */';\n" +
      'var m = /[\'"]\\//.test(u);\n' +
      'var n = 1;\n',
  });
  assert.equal(r.status, 0, `expected rc 0 (stdout=${r.stdout} stderr=${r.stderr})`);
});

test(
  'still passes: the real repository tree (app/js, app/scripts, src)',
  { skip: !existsSync(join(REPO_ROOT, 'app/js')) && 'app/js is a build artifact — run `npm run build` first' },
  () => {
    const r = spawnSync(process.execPath, [CHECKER], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(r.error, undefined, `checker failed to start: ${r.error}`);
    assert.equal(r.status, 0, `the real tree must stay green (stdout=${r.stdout} stderr=${r.stderr})`);
    assert.doesNotMatch(r.stderr, /FAIL/);
  }
);

test('fails when app/js has no .js files instead of printing an empty OK line', () => {
  const files = baseFiles();
  delete files['app/js/main.js'];
  const r = runChecker(files, ['app/js']);
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /FAIL: no \.js files found under app\/js/);
});

test('fails when src has no .ts files instead of silently skipping the plain-script guard', () => {
  const files = baseFiles();
  delete files['src/main.ts'];
  const r = runChecker(files, ['src']);
  assert.equal(r.status, 1, `expected rc 1, got ${r.status} (stdout=${r.stdout})`);
  assert.match(r.stderr, /FAIL: no \.ts files found under src/);
});

test('fails when app/scripts has no .js files instead of silently skipping it', () => {
  const files = baseFiles();
  delete files['app/scripts/dnsq.js'];
  const r = runChecker(files, ['app/scripts']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL: no \.js files found under app\/scripts/);
});

// ---------------------------------------------------------------------------
// Round 2, hole A: filesIn() recursed for src only, so a nested file in
// app/scripts or app/js was never scanned. Measured before the fix: a nested
// `app/scripts/lib/deep.js` holding `var v = a?.b;` — which the real node
// v8.17.0 binary rejects with rc 1 — passed this gate with rc 0.
// ---------------------------------------------------------------------------
test('scans nested files in every tree (a subdirectory cannot hide a construct)', () => {
  for (const [target, payload, expected] of [
    ['app/js/lib/deep.js', 'const deep = 1;\n', /FAIL: lib\/deep\.js contains const/],
    ['app/scripts/lib/deep.js', 'var v = a?.b;\n', /FAIL: app\/scripts\/lib\/deep\.js contains optional chaining/],
    ['src/lib/deep.ts', 'export const deep = 1;\n', /FAIL: src\/lib\/deep\.ts uses import\/export/],
  ]) {
    const r = runChecker({ ...baseFiles(), [target]: payload });
    assert.equal(r.status, 1, `${target} must be scanned (stdout=${r.stdout} stderr=${r.stderr})`);
    assert.match(r.stderr, expected, `${target}: stderr=${r.stderr}`);
  }
});

test('a tree holding only nested .js files counts as non-empty (no false "no .js files" FAIL)', () => {
  const files = baseFiles();
  delete files['app/js/main.js'];
  const clean = runChecker({ ...files, 'app/js/lib/deep.js': 'var n = 1;\n' });
  assert.equal(clean.status, 0, `expected rc 0 (stdout=${clean.stdout} stderr=${clean.stderr})`);
  assert.match(clean.stdout, /OK: app\/js is conservative ES5 \(lib\/deep\.js\)/);
  assert.doesNotMatch(clean.stderr, /no \.js files found/);
  const dirty = runChecker({ ...files, 'app/js/lib/deep.js': 'var n = 1;\nconst deep = 2;\n' });
  assert.equal(dirty.status, 1, `the nested file must be reported (stdout=${dirty.stdout})`);
  assert.match(dirty.stderr, /FAIL: lib\/deep\.js contains const/);
});
