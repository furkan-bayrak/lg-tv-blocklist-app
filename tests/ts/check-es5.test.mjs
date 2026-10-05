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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
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
// `links` are [linkPath, target] pairs created after the files, so a fixture can
// hold a broken link, a loop or a link out of the tree at an exact path.
function runChecker(files, emptyDirs = [], links = []) {
  seq += 1;
  const tree = join(ROOT, 'tree' + seq);
  for (const rel of emptyDirs) {
    mkdirSync(join(tree, rel), { recursive: true });
  }
  for (const rel of Object.keys(files)) {
    mkdirSync(join(tree, dirname(rel)), { recursive: true });
    writeFileSync(join(tree, rel), files[rel]);
  }
  for (const [rel, target] of links) {
    mkdirSync(join(tree, dirname(rel)), { recursive: true });
    symlinkSync(target, join(tree, rel));
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
  assert.match(r.stdout, /OK: app\/js has nothing on the pattern list \(main\.js\)/);
  assert.match(r.stdout, /OK: app\/scripts\/\*\.js has nothing on the pattern list \(dnsq\.js\)/);
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

// ---------------------------------------------------------------------------
// Round 2, hole C2: ESM syntax had no rule for app/js or app/scripts (both
// measured rc 0), and the src guard was line-anchored so any statement on the
// same line defeated it. Measured with node v8.17.0: `import fs from "fs";`
// and `export default 1;` are FATAL in app/scripts; app/js is loaded as a
// plain <script> with no module loader.
// ---------------------------------------------------------------------------
test('ESM import/export fails in both trees (node-8 fatal in app/scripts, no loader in app/js)', () => {
  for (const code of ['import fs from "fs";\n', 'export default 1;\n', 'export const x = 1;\n']) {
    assertFailsInBothTrees(code.trim(), code, /contains ESM import\/export statement/);
  }
});

test('src guard is position-aware: a preceding statement on the same line does not defeat it', () => {
  for (const code of ['"use strict"; export const x = 1;\n', 'var n = 1; import fs from "fs";\n']) {
    const r = runChecker({ ...baseFiles(), 'src/main.ts': code });
    assert.equal(r.status, 1, `expected rc 1 for ${JSON.stringify(code)} (stdout=${r.stdout})`);
    assert.match(r.stderr, /FAIL: src\/main\.ts uses import\/export/, `stderr=${r.stderr}`);
  }
});

test('still passes: import/export in comments and as ES5 property names', () => {
  const r = runChecker({
    ...baseFiles(),
    'app/js/main.js':
      'var o = { import: 1, export: 2 };\nvar f = o.exports;\n// import fs from "fs" — a comment, not code\n',
  });
  assert.equal(r.status, 0, `expected rc 0 (stdout=${r.stdout} stderr=${r.stderr})`);
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
  ['numeric separator in an exponent (`1e1_0`)', 'var x = 1e1_0;\n', /contains numeric separator/],
  ['numeric separator in hex (`0x1_0`)', 'var x = 0x1_0;\n', /contains numeric separator/],
  ['BigInt literal (`1n`)', 'var x = 1n;\n', /contains BigInt literal/],
  ['BigInt literal in hex (`0x1fn`)', 'var x = 0x1fn;\n', /contains BigInt literal/],
  ['BigInt literal in binary (`0b1010n`)', 'var x = 0b1010n;\n', /contains BigInt literal/],
  ['BigInt literal in octal (`0o7n`)', 'var x = 0o7n;\n', /contains BigInt literal/],
  ['optional catch binding (`catch {`)', 'try { f(); } catch { g(); }\n', /contains optional catch binding/],
  ['class with a private field (`class{ #x = 1; … }`)', 'var C = class{ #x = 1; get y() { return this.#x; } };\n', /contains class/],
];

for (const [name, code, expected] of NODE8_FATAL) {
  test(`node-8-fatal: ${name} fails in both trees`, () => {
    assertFailsInBothTrees(name, code, expected);
  });
}

// ---------------------------------------------------------------------------
// Round 2, hole C1: the `class` rule needed whitespace after the keyword
// (`/\bclass\s/`), so `var C = class{};` and `class Foo {}` — class in
// expression and declaration position, with or without a space — both passed
// with rc 0. node v8.17.0 accepts a bare `class{}`, so this one is ES5 policy
// rather than device-fatal, but the webview's older engine does not. In the
// other direction the rule fired on `var x = obj.class + 'a';`, a legal ES5
// member access.
// ---------------------------------------------------------------------------
test('class: expression position without a space fails in both trees (ES5 policy)', () => {
  assertFailsInBothTrees('class expression', 'var C = class{};\n', /contains class/);
});

test('class: declaration position fails in both trees (ES5 policy)', () => {
  assertFailsInBothTrees('class declaration', 'class Foo {\n  m() {}\n}\n', /contains class/);
});

test('still passes: `obj.class` and `{class: 1}` are ES5 property names, not syntax', () => {
  const r = runChecker({
    ...baseFiles(),
    'app/js/main.js': "var x = obj.class + 'a';\nvar o = {class: 1, class2: 2};\nvar p = { class : 3 };\n",
  });
  assert.equal(r.status, 0, `expected rc 0 (stdout=${r.stdout} stderr=${r.stderr})`);
  assert.doesNotMatch(r.stderr, /contains class/);
});

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

// ---------------------------------------------------------------------------
// Round 2, hole D: the round-1 numeric-separator lookbehind only protected a
// `_d_d` run preceded by another word character, so these three legal ES5
// identifiers were all rc 1. The separator test now runs on the numeric TOKEN,
// never on the raw text, and `1_000` is still caught (see NODE8_FATAL above).
// ---------------------------------------------------------------------------
test('still passes: ES5 identifiers whose first character is `_` (no numeric-separator false positive)', () => {
  for (const code of [
    'var y = _1_2;\n',
    'var y = obj._1_2;\n',
    'var arr = [_1_2];\n',
    'var y = a1_2 + _3;\n',
    'var o = { _1_2: _1_2 };\n',
  ]) {
    const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
    assert.equal(r.status, 0, `${JSON.stringify(code)} must pass (stdout=${r.stdout} stderr=${r.stderr})`);
    assert.doesNotMatch(r.stderr, /numeric separator|BigInt literal/);
  }
});

test('still caught: `1_000` and `1n` after the token-based rewrite', () => {
  for (const [code, expected] of [
    ['var x = 1_000;\n', /contains numeric separator/],
    ['var n = 1n;\n', /contains BigInt literal/],
  ]) {
    const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
    assert.equal(r.status, 1, `${JSON.stringify(code)} must fail (stdout=${r.stdout})`);
    assert.match(r.stderr, expected, `stderr=${r.stderr}`);
  }
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
// Round 2, hole C4: regex literal bodies are masked by design, so a pattern
// node 8 cannot compile sailed through with rc 0. Verified against the real
// node v8.17.0 binary — /(?<ip>\d+)/ and /\p{L}/u pass `--check` but throw
// SyntaxError when the literal is compiled, and /a/d, /a/v are refused at
// `--check`; all four are a device break. The literals node 8.17 ACCEPTS
// (lookbehind, the `s`/`y`/`u` flags, \u{…}u) are deliberately not flagged.
// ---------------------------------------------------------------------------
test('node-8-fatal regex features fail in both trees (named group, \\p{…}/u, d and v flags)', () => {
  for (const [name, code, expected] of [
    ['named capture group', 'var re = /(?<ip>\\d+)/;\n', /contains named capture group/],
    ['Unicode property escape', 'var re = /\\p{L}+/u;\n', /contains Unicode property escape/],
    ['negative Unicode property escape', 'var re = /\\P{L}+/u;\n', /contains Unicode property escape/],
    ['hasIndices flag', 'var re = /a.b/d;\n', /contains hasIndices regular expression flag/],
    ['unicodeSets flag', 'var re = /[a&&b]/v;\n', /contains unicodeSets regular expression flag/],
  ]) {
    assertFailsInBothTrees(name, code, expected);
  }
});

test('still passes: regex features node v8.17.0 accepts (lookbehind, s/y/u flags, \\u{…}u)', () => {
  for (const code of [
    'var a = /(?<=x)y/;\n',
    'var b = /(?<!x)y/;\n',
    'var c = /a.b/s;\n',
    'var d = /a/gimy;\n',
    'var e = /\\u{1F600}/u;\n',
  ]) {
    const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
    assert.equal(r.status, 0, `${JSON.stringify(code)} must pass (stdout=${r.stdout} stderr=${r.stderr})`);
  }
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
  assert.match(clean.stdout, /OK: app\/js has nothing on the pattern list \(lib\/deep\.js\)/);
  assert.doesNotMatch(clean.stderr, /no \.js files found/);
  const dirty = runChecker({ ...files, 'app/js/lib/deep.js': 'var n = 1;\nconst deep = 2;\n' });
  assert.equal(dirty.status, 1, `the nested file must be reported (stdout=${dirty.stdout})`);
  assert.match(dirty.stderr, /FAIL: lib\/deep\.js contains const/);
});

// ---------------------------------------------------------------------------
// Round 3, hole A: parenKind() decided "this `(` opens a control header" from
// the previous word's TEXT alone, without asking whether that word is a real
// keyword or a PROPERTY NAME. ES5 allows every reserved word as a member name,
// so `obj.catch(x)` is a call: the `/` after it is division, and reading it as a
// regex literal erased the rest of the line. Measured against the checker at
// 6f12c41, in both shipped trees:
//   obj.catch(x) / 2; const HIDDEN = 1; var g = 1 / 3;   rc 0 — silent pass
//   obj.catch(x) / 2; var f = () => 1; var g = 1 / 3;    rc 0 — silent pass,
//     and `npm run check:node8` is rc 0 too: node 8 PARSES an arrow, so the
//     parser gate cannot see this class at all (measured: bare `var f = () => 1;`
//     is `node@8.17.0 --check` rc 0);
//   obj.if(x) / 2;                                       rc 1 — false FAIL
//     ("unterminated regular expression" on legal ES5 with nothing hidden).
// One missing test produced both directions, for all six of
// if/while/for/with/switch/catch and for the object-key form `{if: f}.if(x)`.
// The same route also hid node-8-FATAL syntax: `obj.catch(x) / 2; var v = a?.b;
// var g = 1 / 3;` was rc 0 here while the real node v8.17.0 binary refuses the
// file. A keyword after `.` is never a header, so the fix is one test in
// parenKind() plus a `member` flag on the word token the masker builds.
// ---------------------------------------------------------------------------
const HEADER_KEYWORDS = ['if', 'while', 'for', 'with', 'switch', 'catch'];

test('control-keyword property: the construct behind it is reported, not read as a regex', () => {
  for (const kw of HEADER_KEYWORDS) {
    const code = `obj.${kw}(x) / 2; const HIDDEN = 1; var g = 1 / 3;\n`;
    assertFailsInBothTrees(`obj.${kw}(…)`, code, /contains const/);
    for (const target of ['app/js/main.js', 'app/scripts/dnsq.js']) {
      const r = runChecker({ ...baseFiles(), [target]: code });
      assert.equal(r.status, 1, `${kw}: ${target} must fail (stderr=${r.stderr})`);
      // The message must name the hidden construct: a regex complaint means the
      // masking bug is back (that is what "unterminated regular expression" was).
      assert.match(r.stderr, /contains const/, `${kw}: stderr=${r.stderr}`);
      assert.doesNotMatch(r.stderr, /unterminated regular expression/, `${kw}: stderr=${r.stderr}`);
    }
  }
});

test('control-keyword property: an arrow function behind it is reported, not swallowed', () => {
  assertFailsInBothTrees(
    'obj.catch(…) + arrow',
    'obj.catch(x) / 2; var f = () => 1; var g = 1 / 3;\n',
    /contains arrow function/
  );
});

test('control-keyword property: `{if: f}.if(x)` and node-8-fatal syntax behind it are reported', () => {
  for (const [name, code, expected] of [
    ['object key then member call', '{if: f}.if(x) / 2; const HIDDEN = 1; var g = 1 / 3;\n', /contains const/],
    [
      'node-8-fatal optional chaining',
      'obj.catch(x) / 2; var v = a?.b; var g = 1 / 3;\n',
      /contains optional chaining/,
    ],
  ]) {
    assertFailsInBothTrees(name, code, expected);
  }
});

test('legal ES5: a control keyword as a property name stays clean (was a false FAIL)', () => {
  for (const kw of HEADER_KEYWORDS) {
    const code = `obj.${kw}(x) / 2;\n`;
    const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
    assert.equal(r.status, 0, `${JSON.stringify(code)} must pass (stderr=${r.stderr})`);
    assert.doesNotMatch(r.stderr, /unterminated regular expression/);
  }
  for (const code of [
    '{if: f}.if(x) / 2;\n',
    'obj.catch(x) / 2; var g = 1 / 3;\n',
    'x.if(y) / 2 / 3;\n',
    'var a = obj.catch(x) / 2; var b = a.b.while(y) / 3;\n',
    "var a = obj['catch'](x) / 2;\n",
    'var a = a.b.c.for(x) / 2;\n',
  ]) {
    const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
    assert.equal(r.status, 0, `${JSON.stringify(code)} must pass (stderr=${r.stderr})`);
  }
});

test('genuine control headers keep statement position (after ) } ; else do try and a label)', () => {
  for (const code of [
    'if (x) if (y) /[/*]/.test(z); var n = 1;\n',
    'if (x) { } if (y) /[/*]/.test(z); var n = 1;\n',
    '; if (y) /[/*]/.test(z); var n = 1;\n',
    'if (a) { } else if (y) /[/*]/.test(z); var n = 1;\n',
    'do if (y) /[/*]/.test(z); while (0); var n = 1;\n',
    'do f(); while (y) /[/*]/.test(z); var n = 1;\n',
    'try { f(); } catch (e) /[/*]/.test(z); var n = 1;\n',
    'loop: for (;;) /[/*]/.test(z); var n = 1;\n',
    'outer: while (x) /[/*]/.test(z); var n = 1;\n',
  ]) {
    const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
    assert.equal(r.status, 0, `statement-position regex must stay legal: ${JSON.stringify(code)} (stderr=${r.stderr})`);
  }
  // Round-2 closure: a header regex whose own `/*` would open a phantom comment
  // must still report the code behind it, in both trees.
  assertFailsInBothTrees(
    'header regex cannot hide const',
    'if (x) /[/*]/.test(y); const AFTER = 1;\nvar z = 1;\n*/\n',
    /contains const/
  );
});

test('division after a call whose callee is a plain identifier stays clean', () => {
  for (const code of ['f() / 2;\n', 'arr[0] / 2;\n', '(a+b) / 2;\n', '(function(){}) / 2;\n', 'a / b / c;\n']) {
    const r = runChecker({ ...baseFiles(), 'app/js/main.js': code });
    assert.equal(r.status, 0, `${JSON.stringify(code)} must pass (stderr=${r.stderr})`);
  }
});

// ---------------------------------------------------------------------------
// Round 3, hole B: the directory walk used statSync on every entry, which
// follows links and throws on an entry it cannot stat. Measured before this fix:
//   - `ln -s /nonexistent app/scripts/broken.js`  -> uncaught ENOENT stack trace
//   - `ln -s . app/scripts/loop`                  -> ELOOP stack trace once the
//     walk descended into its own parent, again and again;
//   - `ln -s /tmp app/scripts/ext`                -> a directory OUTSIDE the
//     scanned tree was followed and its files scanned (rc 1 on a file under
//     /tmp, for content the app never ships).
// rc 1 either way, but a stack trace is not a verdict, and following a link out
// of the tree is a scan the tool does not control. The walk now reads dirents
// (lstat semantics), never descends a link, and reports each link or unreadable
// directory as a FAIL line instead of skipping it: a silent skip is exactly the
// hole this whole checker exists to close.
// ---------------------------------------------------------------------------
test('a broken symlink fails with a FAIL line, not an uncaught stack trace', () => {
  const r = runChecker(baseFiles(), [], [['app/scripts/broken.js', '/nonexistent']]);
  assert.equal(r.status, 1, `expected rc 1 (stdout=${r.stdout} stderr=${r.stderr})`);
  assert.match(
    r.stderr,
    /FAIL: app\/scripts\/broken\.js is an unresolvable symbolic link to \/nonexistent \(ENOENT\)/
  );
  assert.doesNotMatch(r.stderr, /node:fs|at statSync|Error: ENOENT/);
  assert.doesNotMatch(r.stdout, /OK: app\/scripts/);
});

test('a symlink loop fails with a FAIL line instead of recursing into its own parent', () => {
  for (const [name, target, expected] of [
    ['a self-referential link (`loop -> loop`)', 'loop', /unresolvable symbolic link to loop \(ELOOP\)/],
    ['a link to its own directory (`loop -> .`)', '.', /is a symbolic link to /],
  ]) {
    const r = runChecker(baseFiles(), [], [['app/scripts/loop', target]]);
    assert.equal(r.status, 1, `${name}: expected rc 1 (stdout=${r.stdout} stderr=${r.stderr})`);
    assert.match(r.stderr, expected, `${name}: stderr=${r.stderr}`);
    assert.doesNotMatch(r.stderr, /node:fs|ELOOP:/, `${name}: stderr=${r.stderr}`);
  }
});

test('a directory symlink out of the tree is not followed (outside content is never scanned)', () => {
  const outside = mkdtempSync(join(tmpdir(), 'check-es5-outside-'));
  try {
    writeFileSync(join(outside, 'outside.js'), 'var v = a?.b;\n');
    const r = runChecker(baseFiles(), [], [['app/scripts/ext', outside]]);
    assert.equal(r.status, 1, `expected rc 1 (stdout=${r.stdout} stderr=${r.stderr})`);
    assert.match(r.stderr, /FAIL: app\/scripts\/ext is a symbolic link to .* \(outside app\/scripts\)/);
    // The hook: before the fix this file WAS scanned and blamed.
    assert.doesNotMatch(r.stderr, /optional chaining/, `stderr=${r.stderr}`);
    assert.doesNotMatch(r.stderr, /outside\.js/, `stderr=${r.stderr}`);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlink in place of a scanned tree root is refused, not scanned through', () => {
  const files = baseFiles();
  delete files['app/js/main.js'];
  const outside = mkdtempSync(join(tmpdir(), 'check-es5-rootlink-'));
  try {
    writeFileSync(join(outside, 'main.js'), 'var v = a?.b;\n');
    const r = runChecker(files, [], [['app/js', outside]]);
    assert.equal(r.status, 1, `expected rc 1 (stdout=${r.stdout} stderr=${r.stderr})`);
    assert.match(r.stderr, /FAIL: app\/js is a symbolic link to /);
    assert.doesNotMatch(r.stderr, /optional chaining/, `stderr=${r.stderr}`);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a resolvable `.js` symlink inside the tree is reported, an unrelated one is not news', () => {
  const reported = runChecker(baseFiles(), [], [['app/scripts/alias.js', 'dnsq.js']]);
  assert.equal(reported.status, 1, `expected rc 1 (stdout=${reported.stdout} stderr=${reported.stderr})`);
  assert.match(reported.stderr, /FAIL: app\/scripts\/alias\.js is a symbolic link to .*dnsq\.js/);
  // The walk ignores non-`.js` files in these trees either way, so a `.sh` link
  // is not a finding — it must not turn the gate red on its own.
  const ignored = runChecker(baseFiles(), [], [['app/scripts/alias.sh', 'dnsq.js']]);
  assert.equal(ignored.status, 0, `expected rc 0 (stdout=${ignored.stdout} stderr=${ignored.stderr})`);
});

test('the repository trees hold no symlinks today (the walk would refuse to follow one)', () => {
  const found = [];
  for (const root of ['app', 'src', 'tools']) {
    const stack = [join(REPO_ROOT, root)];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink()) found.push(relative(REPO_ROOT, path));
        else if (entry.isDirectory()) stack.push(path);
      }
    }
  }
  assert.deepEqual(found, [], `symlinks must not appear in a scanned tree: ${found.join(', ')}`);
});
