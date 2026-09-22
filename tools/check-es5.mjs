#!/usr/bin/env node
/*
 * Fails if any compiled file in app/js/ uses syntax newer than ES5.
 *
 * Why: the app must run on the oldest web engine we claim (design spec §3).
 * ares-package's own compatibility detection (webosbrew-ipk-verify) runs in CI;
 * this catches regressions in seconds on the developer machine.
 * Dependency-free on purpose.
 *
 * Patterns are matched against a copy of the source with quoted string
 * contents removed, so UI copy like 'Loading...' cannot false-positive the
 * spread/rest check. Backticks survive that scrubbing, so template literals
 * are still detected.
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

const dir = 'app/js';
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

let failed = false;
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.js')) {
    continue;
  }
  const text = stripStringLiterals(readFileSync(join(dir, name), 'utf8'));
  for (const entry of patterns) {
    const label = entry[0];
    const pattern = entry[1];
    if (pattern.test(text)) {
      console.error('FAIL: ' + name + ' contains ' + label);
      failed = true;
    }
  }
  for (const entry of commonJsTokens) {
    const label = entry[0];
    const pattern = entry[1];
    if (pattern.test(text)) {
      console.error(
        'FAIL: ' + name + ' contains ' + label + ' — app/js must stay plain-script <script>-loadable'
      );
      failed = true;
    }
  }
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
  const text = stripStringLiterals(readFileSync(file, 'utf8'));
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

const checked = readdirSync(dir).filter((name) => name.endsWith('.js'));
console.log('OK: app/js is conservative ES5 (' + checked.join(', ') + ')');
console.log('OK: plain-script guard — src/**/*.ts import/export-free, app/js/*.js CommonJS-token-free');
