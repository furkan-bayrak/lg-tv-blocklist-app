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
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
}

if (failed) {
  process.exit(1);
}

const checked = readdirSync(dir).filter((name) => name.endsWith('.js'));
console.log('OK: app/js is conservative ES5 (' + checked.join(', ') + ')');
