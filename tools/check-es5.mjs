#!/usr/bin/env node
/*
 * Fails if any compiled file in app/js/ — or any TV-side script in
 * app/scripts/ — uses syntax newer than ES5.
 *
 * Why: the app must run on the oldest web engine we claim (design spec §3).
 * ares-package's own compatibility detection (webosbrew-ipk-verify) runs in CI;
 * this catches regressions in seconds on the developer machine.
 * Dependency-free on purpose.
 *
 * app/scripts/ holds the TV-side programs: dnsq.sh execs app/scripts/dnsq.js
 * on the platform's node v8.12.0. That tree gets the same syntax patterns, but
 * never the CommonJS ban — require() is those CLIs' contract. Its compatibility
 * used to rest on a manual `npx node@8.17.0` run; this scan is the automated gate.
 *
 * Patterns are matched against a copy of the source with quoted string
 * contents and comments removed, so UI copy like 'Loading...' or a comment that
 * mentions "type + class" cannot false-positive the spread/rest or class check.
 * Neither scrub can hide a real construct: quoted contents and comments are not
 * syntax the engine ever reads. Backticks survive that scrubbing, so template
 * literals are still detected.
 *
 * Plain-script guard (S3/T7): index.html loads js/bridge.js, js/status.js and
 * js/main.js as plain <script> tags — there is no module loader — so every
 * file in app/js/ must stay a plain-script IIFE global. One `import`/`export`
 * in src/ makes tsc emit CommonJS (`exports.`/`require(`) and the webview
 * breaks at load time; the ES5 checks alone would not notice. Two layers:
 *   1. every .ts file under src/: no top-level import/export (the root cause).
 *   2. app/js/*.js: no CommonJS tokens (the compiled symptom).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function stripStringLiterals(source) {
  return source
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

// Comments are scrubbed as well: they never run, and prose like dnsq.js's
// "type + class + ttl" would otherwise false-positive the class rule. Strings
// go first, so a quoted URL ('luna://…') cannot open a comment.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

function scrub(source) {
  return stripComments(stripStringLiterals(source));
}

const dir = 'app/js';
const scriptsDir = 'app/scripts';
const patterns = [
  ['arrow function', /=>/],
  ['class', /\bclass\s/],
  ['let', /\blet\s/],
  ['const', /\bconst\s/],
  ['async', /\basync\s/],
  ['await', /\bawait\s/],
  ['generator', /function\s*\*/],
  ['template literal', /`/],
  ['spread/rest argument', /\.\.\./],
];
const commonJsTokens = [
  ['module.exports', /\bmodule\s*\.\s*exports\b/],
  ['exports. access', /\bexports\s*[.[]/],
  ['require() call', /\brequire\s*\(/],
];

function listFilesRecursive(root, suffix) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        stack.push(path);
      } else if (name.endsWith(suffix)) {
        out.push(path);
      }
    }
  }
  return out;
}

if (!existsSync(dir)) {
  console.error('FAIL: ' + dir + ' does not exist — run `npm run build` first.');
  process.exit(1);
}

// One scanner for every tree we check: the rule list supplies both its patterns
// and the message suffix, so no rule set is walked twice and a rule's reason
// stays next to the rule. `prefix` keeps the message a path the developer can
// open. Exit convention is the caller's: scanTokens only reports.
function scanTokens(root, names, prefix, tokens, suffix = '') {
  let failed = false;
  for (const name of names) {
    const text = scrub(readFileSync(join(root, name), 'utf8'));
    for (const entry of tokens) {
      const label = entry[0];
      const pattern = entry[1];
      if (pattern.test(text)) {
        console.error('FAIL: ' + prefix + name + ' contains ' + label + suffix);
        failed = true;
      }
    }
  }
  return failed;
}

let failed = false;
const checked = readdirSync(dir).filter((name) => name.endsWith('.js'));
if (scanTokens(dir, checked, '', patterns)) {
  failed = true;
}
// app/js is loaded by the webview as plain <script>: CommonJS tokens break it.
if (scanTokens(dir, checked, '', commonJsTokens, ' — app/js must stay plain-script <script>-loadable')) {
  failed = true;
}

// The TV-side scripts are what node v8.12.0 really executes (dnsq.sh execs
// app/scripts/dnsq.js), so they get the syntax patterns — but never the
// CommonJS ban, because require() is exactly what these CLIs may use. A missing
// or empty tree is a failure, not a silent skip: the check must not pass just
// because the code it guards went away.
const scriptFiles = existsSync(scriptsDir)
  ? readdirSync(scriptsDir).filter((name) => name.endsWith('.js'))
  : [];
if (scriptFiles.length === 0) {
  console.error('FAIL: no .js files found under ' + scriptsDir + ' — cannot check the TV-side scripts.');
  failed = true;
} else if (scanTokens(scriptsDir, scriptFiles, scriptsDir + '/', patterns)) {
  failed = true;
}

// Layer 1 of the plain-script guard: the source itself must never use
// top-level import/export (tsc would silently switch the output to CommonJS).
const srcDir = 'src';
const srcFiles = existsSync(srcDir) ? listFilesRecursive(srcDir, '.ts') : [];
if (srcFiles.length === 0) {
  console.error('FAIL: no .ts files found under ' + srcDir + ' — cannot check the plain-script guard.');
  failed = true;
}
for (const file of srcFiles) {
  const text = scrub(readFileSync(file, 'utf8'));
  if (/^\s*(?:import|export)\b/m.test(text)) {
    console.error(
      'FAIL: ' + file + ' uses import/export — src must stay plain-script (IIFE globals), not CommonJS modules.'
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log('OK: app/js is conservative ES5 (' + checked.join(', ') + ')');
console.log('OK: app/scripts/*.js is conservative ES5 (' + scriptFiles.join(', ') + ')');
console.log('OK: plain-script guard — src/**/*.ts import/export-free, app/js/*.js CommonJS-token-free');
