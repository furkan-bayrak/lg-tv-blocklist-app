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
 * Patterns are matched against a masked copy of the source: ONE left-to-right
 * lexer pass blanks the contents of every non-code span — single- and
 * double-quoted strings, template literals, line and block comments, and REGEX
 * LITERALS. A comment-only scrub cannot be sound: it cannot tell
 * `p.replace(/\//g, '-')` from `a // comment`, so the `/` inside the regex opens
 * a comment that swallows the rest of the line — real code included. The masker
 * therefore classifies every span as it walks. Regex vs division is decided by
 * the previous significant token: after an operator, `(`, `,`, `=`, `:`, `[`,
 * `!`, `&`, `|`, `?`, `{`, `}`, `;` or a value-position keyword (`return`,
 * `typeof`, `case`, …) a `/` opens a regex literal, while after an identifier,
 * number, `)`, `]` or an expression-position `}` it is division. Escapes are
 * honoured and a `/` inside a character class does not end the literal.
 *
 * The masker FAILS CLOSED: an unterminated string, template literal, comment or
 * regex, or a `/` it cannot classify, fails the file with a clear message (the
 * gate must never print OK for a file it could not read). Anything it does not
 * understand is left visible, which can only cause a false FAIL, never a silent
 * pass. Backticks stay visible, so template literals are still detected.
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

// Keywords after which a `/` opens a regex literal (they expect an expression).
const VALUE_KEYWORDS = new Set([
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'typeof',
  'void',
  'yield',
]);

// Every operator and delimiter the classifier needs to name a token, longest
// first so `>>>=` is not read as three `>` tokens.
const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=',
  '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%',
  '&', '|', '^', '!', '~', '?', ':', '=', '.',
];

function isLineTerminator(ch) {
  return ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029';
}

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\v' || ch === '\f' || ch === '\u00a0' || ch === '\ufeff';
}

function isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

// Index just past the closing quote, or -1 when the literal never closes on its
// own line.
function scanQuoted(source, start, quote) {
  for (let j = start + 1; j < source.length; j += 1) {
    const ch = source[j];
    if (ch === '\\') {
      j += 1;
      continue;
    }
    if (ch === quote) return j + 1;
    if (isLineTerminator(ch)) return -1;
  }
  return -1;
}

// Index just past the closing backtick, or -1. `${…}` interpolations are masked
// along with the rest: the file already fails on the backtick pattern, so no
// construct inside one can go unnoticed.
function scanTemplate(source, start) {
  for (let j = start + 1; j < source.length; j += 1) {
    if (source[j] === '\\') {
      j += 1;
      continue;
    }
    if (source[j] === '`') return j + 1;
  }
  return -1;
}

// { bodyEnd, end } for the regex literal at source[start], or null when it is
// unterminated. Inside a character class a `/` is just a character.
function scanRegex(source, start) {
  let inClass = false;
  for (let j = start + 1; j < source.length; j += 1) {
    const ch = source[j];
    if (ch === '\\') {
      j += 1;
      continue;
    }
    if (isLineTerminator(ch)) return null;
    if (ch === '[') {
      inClass = true;
    } else if (ch === ']' && inClass) {
      inClass = false;
    } else if (ch === '/' && !inClass) {
      let end = j + 1;
      while (end < source.length && isIdentPart(source[end])) end += 1;
      return { bodyEnd: j, end };
    }
  }
  return null;
}

// A `{` opens a statement/function body after `)`, `;`, another `{`/`}`, `=>`,
// `else`/`do`/`try`/`finally` or at the start of the input — elsewhere it is an
// object literal. The distinction only matters for a `/` directly after `}`:
// statement position opens a regex, expression position is division.
function braceKind(prev) {
  if (prev === null) return 'block';
  if (prev.type === 'punct') {
    if (prev.text === ')' || prev.text === ';' || prev.text === '{' || prev.text === '}' || prev.text === '=>') {
      return 'block';
    }
  }
  if (
    prev.type === 'word' &&
    (prev.text === 'else' || prev.text === 'do' || prev.text === 'try' || prev.text === 'finally')
  ) {
    return 'block';
  }
  return 'object';
}

// The single masking pass. Returns the masked text (same length, same line
// breaks) plus every span it could not read; the caller turns those into a
// failure, so a file the masker does not understand can never pass.
function maskSource(source) {
  const masked = source.split('');
  const errors = [];
  const braces = [];
  let prev = null; // the previous significant token: { type, text } or null
  let i = 0;

  function blank(from, to) {
    for (let k = from; k < to && k < source.length; k += 1) {
      if (!isLineTerminator(masked[k])) masked[k] = ' ';
    }
  }

  function fail(message, offset) {
    errors.push(message + ' at offset ' + offset);
  }

  // Value position opens a regex literal; expression position means division.
  // `null` = the masker cannot tell, which must fail closed.
  function regexAllowed() {
    if (prev === null) return true;
    if (prev.type === 'value') return false;
    if (prev.type === 'unknown') return null;
    if (prev.type === 'word') return VALUE_KEYWORDS.has(prev.text);
    if (prev.text === ')' || prev.text === ']') return false;
    if (prev.text === '++' || prev.text === '--') return false;
    if (prev.text === '}') return prev.brace !== 'object';
    return true;
  }

  while (i < source.length) {
    const ch = source[i];

    if (isLineTerminator(ch) || isSpace(ch)) {
      i += 1;
      continue;
    }

    // Comments are recognised before regex/division: `//` and `/*` can never
    // open a regex literal. A comment is not a token, so `prev` is unchanged.
    if (ch === '/' && source[i + 1] === '/') {
      let j = i + 2;
      while (j < source.length && !isLineTerminator(source[j])) j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close === -1) {
        fail('unterminated block comment', i);
        blank(i, source.length);
        break;
      }
      blank(i, close + 2);
      i = close + 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const end = scanQuoted(source, i, ch);
      if (end === -1) {
        fail('unterminated ' + (ch === "'" ? 'single' : 'double') + '-quoted string', i);
        blank(i + 1, source.length);
        break;
      }
      blank(i + 1, end - 1); // the quotes stay visible
      i = end;
      prev = { type: 'value' };
      continue;
    }

    if (ch === '`') {
      const end = scanTemplate(source, i);
      if (end === -1) {
        fail('unterminated template literal', i);
        blank(i + 1, source.length);
        break;
      }
      blank(i + 1, end - 1); // the backticks stay visible
      i = end;
      prev = { type: 'value' };
      continue;
    }

    if (ch === '/') {
      const allowed = regexAllowed();
      if (allowed === null) {
        fail('cannot classify this "/" (previous token ' + JSON.stringify(prev.text) + ' is not known ES5 syntax)', i);
        i += 1;
        prev = { type: 'punct', text: '/' };
        continue;
      }
      if (allowed) {
        const regex = scanRegex(source, i);
        if (regex === null) {
          fail('unterminated regular expression', i);
          blank(i + 1, source.length);
          break;
        }
        blank(i + 1, regex.bodyEnd); // body
        blank(regex.bodyEnd + 1, regex.end); // flags
        i = regex.end;
        prev = { type: 'value' };
        continue;
      }
      i += 1; // division stays visible
      prev = { type: 'punct', text: '/' };
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < source.length && isIdentPart(source[j])) j += 1;
      prev = { type: 'word', text: source.slice(i, j) };
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(source[i + 1] || ''))) {
      let j = i + 1;
      while (j < source.length && (isIdentPart(source[j]) || source[j] === '.')) j += 1;
      prev = { type: 'value' };
      i = j;
      continue;
    }

    const punct = PUNCTUATORS.find((token) => source.startsWith(token, i));
    if (punct === undefined) {
      // Not syntax this masker knows (a decorator, a hash name…). Remember it
      // so a following `/` is reported instead of guessed at.
      prev = { type: 'unknown', text: ch };
      i += 1;
      continue;
    }
    if (punct === '{') {
      braces.push(braceKind(prev));
    } else if (punct === '}') {
      prev = { type: 'punct', text: '}', brace: braces.length > 0 ? braces.pop() : 'block' };
      i += 1;
      continue;
    }
    prev = { type: 'punct', text: punct };
    i += punct.length;
  }

  return { text: masked.join(''), errors };
}

function readMasked(path) {
  return maskSource(readFileSync(path, 'utf8'));
}

// A file is masked once and its masking errors are reported once, even though a
// tree with two rule sets (app/js: syntax + CommonJS) scans the same file twice.
const maskedFiles = new Map();
const maskErrorsReported = new Set();

function masked(path) {
  if (!maskedFiles.has(path)) maskedFiles.set(path, readMasked(path));
  return maskedFiles.get(path);
}

function reportMaskErrors(path, label) {
  const { errors } = masked(path);
  if (errors.length === 0 || maskErrorsReported.has(path)) return errors.length > 0;
  maskErrorsReported.add(path);
  for (const message of errors) {
    console.error('FAIL: ' + label + ' — ' + message + '; cannot verify the file, fix the syntax.');
  }
  return true;
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
    const path = join(root, name);
    if (reportMaskErrors(path, prefix + name)) failed = true;
    const { text } = masked(path);
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
  if (reportMaskErrors(file, file)) failed = true;
  const { text } = masked(file);
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
