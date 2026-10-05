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
 * The pattern list below is a conservative ES5 superset, not an ES5-exact parse:
 * it catches the syntax the TV's engine and node v8 reject, and each rule is
 * deliberately noisy-free around legal ES5 neighbours (`flag ?.5 : 1`,
 * identifiers like `step_1_2`), but a rule can in principle fire on something
 * ES5 in an unusual position. A false FAIL is acceptable; a missed construct is
 * not, which is why the new-syntax rules err on the side of reporting.
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

// The keywords whose `(…)` is a control-statement HEADER: the grammar expects a
// STATEMENT after the `)`, so a `/` there opens a regex literal. After any
// other `)` the position is an expression, so `/` is division. Telling these
// two apart is what stops a regex's own `/*` or `//` bytes from opening a fake
// comment span that swallows real code (measured: hole B2).
const CONTROL_HEADERS = new Set(['if', 'while', 'for', 'with', 'catch', 'switch']);

// What opened a `(`. Only the token AFTER the matching `)` depends on it, and
// 'unknown' is passed on so a following `/` fails closed instead of guessed at.
//   'header'  if/while/for/with/catch/switch header — statement position after `)`
//   'params'  a function's parameter list
//   'call'    f(…), a(…)(…), a[0](…)
//   'group'    grouping parentheses / arrow parameters
//   'unknown' the masker cannot tell
function parenKind(prev) {
  if (prev === null) return 'group';
  if (prev.type === 'unknown') return 'unknown';
  if (prev.type === 'word') {
    if (CONTROL_HEADERS.has(prev.text)) return 'header';
    if (prev.text === 'function') return 'params';
    return 'call';
  }
  if (prev.type === 'punct') {
    if (prev.text === ')' || prev.text === ']' || prev.text === '}') return 'call';
    if (prev.text === '=>') return 'params';
  }
  return 'group'; // operators, `(`, `,`, `[`, `:`, `?`, values… all expect an expression
}

// What opened a `{`. Only a `/` directly after the matching `}` depends on it:
// after a statement-position `}` that `/` opens a regex literal, after an
// expression-position `}` it is division. Some closers are genuinely ambiguous
// — `var f = function () {} / 2` (expression, division) against
// `function f() {} /re/.test(x)` (statement, regex) — and an ambiguous `}` is
// reported instead of guessed at, because a wrong guess in the "regex"
// direction erases code while a wrong guess in the "division" direction lets a
// regex open a phantom comment.
//   'stmt'      `;`, `{`, `}`, a control header's `)`, else/do/try/finally, start
//   'expr'      object literal, an arrow's body `}`
//   'ambiguous' a function/expression body `}` whose position depends on how the
//               function is used
function braceKind(prev) {
  if (prev === null) return 'stmt';
  if (prev.type === 'punct') {
    if (prev.text === ';' || prev.text === '{' || prev.text === '}') return 'stmt';
    if (prev.text === ')') return prev.paren === 'header' ? 'stmt' : 'ambiguous';
    if (prev.text === '=>') return 'expr'; // an arrow body is always an expression
    if (prev.text === ':') return 'ambiguous'; // object value, ternary or `case x: {`
  }
  if (
    prev.type === 'word' &&
    (prev.text === 'else' || prev.text === 'do' || prev.text === 'try' || prev.text === 'finally')
  ) {
    return 'stmt';
  }
  return 'expr';
}

// The single masking pass. Returns the masked text (same length, same line
// breaks) plus every span it could not read; the caller turns those into a
// failure, so a file the masker does not understand can never pass.
function maskSource(source) {
  const masked = source.split('');
  const errors = [];
  const braces = [];
  const parens = [];
  let prev = null; // the previous significant token: { type, text, … } or null
  let i = 0;

  function blank(from, to) {
    for (let k = from; k < to && k < source.length; k += 1) {
      if (!isLineTerminator(masked[k])) masked[k] = ' ';
    }
  }

  function fail(message, offset) {
    errors.push(message + ' at offset ' + offset);
  }

  // Value position opens a regex literal, expression position means division. A
  // STRING return value is the reason the masker cannot tell the two apart, and
  // those positions fail closed: classifying a regex as division lets its `/*`
  // or `//` bytes open a phantom comment that swallows real code, while
  // classifying a division as a regex lets the "body" swallow to the next `/`.
  function regexMode() {
    if (prev === null) return true;
    if (prev.type === 'value') return false;
    if (prev.type === 'unknown') {
      return (
        'cannot classify this "/" (previous token ' + JSON.stringify(prev.text) + ' is not known ES5 syntax)'
      );
    }
    if (prev.type === 'word') return VALUE_KEYWORDS.has(prev.text);
    if (prev.text === ')') {
      if (prev.paren === 'header') return true; // `if (x) /re/.test(y);` — statement position
      if (prev.paren === 'call' || prev.paren === 'params' || prev.paren === 'group') return false;
      return 'ambiguous / after )';
    }
    if (prev.text === ']') return false;
    if (prev.text === '++' || prev.text === '--') return false;
    if (prev.text === '}') {
      if (prev.brace === 'stmt') return true;
      if (prev.brace === 'expr') return false;
      return 'ambiguous / after }';
    }
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
      const mode = regexMode();
      if (typeof mode === 'string') {
        fail(mode, i);
        i += 1;
        prev = { type: 'punct', text: '/' };
        continue;
      }
      if (mode) {
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
    } else if (punct === '(') {
      parens.push(parenKind(prev));
    } else if (punct === ')') {
      prev = { type: 'punct', text: ')', paren: parens.length > 0 ? parens.pop() : 'unknown' };
      i += 1;
      continue;
    } else if (punct === '}') {
      prev = { type: 'punct', text: '}', brace: braces.length > 0 ? braces.pop() : 'ambiguous' };
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
// True when `word` appears as CODE: not as a member name (`obj.class`) and not
// as an object-literal key (`{ class: 1 }`) — the two legal ES5 neighbours a
// keyword rule must tolerate. Non-code spans are blanked by the masker before
// any rule runs, so a bare match means a parser would really see the keyword.
function codeWord(word) {
  return (text) => {
    const re = new RegExp('\\b' + word + '\\b', 'g');
    let match;
    while ((match = re.exec(text)) !== null) {
      if (isPropertyName(text, match.index, match[0].length)) continue;
      return true;
    }
    return false;
  };
}

// `x.class`, `x.import`, `{ class: 1 }` — ES5 allows reserved-ish words as
// property names, so a member access or an object key is not new syntax.
function isPropertyName(text, index, length) {
  let k = index - 1;
  while (k >= 0 && /\s/.test(text[k])) k -= 1;
  if (k >= 0 && text[k] === '.') return true;
  let j = index + length;
  while (j < text.length && /\s/.test(text[j])) j += 1;
  return text[j] === ':';
}

// A rule is a RegExp tested against the masked text, or a function taking the
// masked text (for rules a single pattern cannot express, such as “this token
// is a numeric literal AND it contains a separator”).
const patterns = [
  ['arrow function', /=>/],
  // `class` in declaration or expression position, with or without a space
  // (`class{`, `class{}`, `class Foo {`, `var C = class{}`). node v8 accepts a
  // plain `class{}` but the webview's older engine does not, so this stays a
  // policy rule; `obj.class` / `{class: 1}` are legal ES5 and must not fire.
  ['class', codeWord('class')],
  ['let', /\blet\s/],
  ['const', /\bconst\s/],
  ['async', /\basync\s/],
  ['await', /\bawait\s/],
  ['generator', /function\s*\*/],
  ['template literal', /`/],
  ['spread/rest argument', /\.\.\./],
  // node v8 (and the webview's older engine) refuses these as well: measured
  // with the real v8.17.0 binary, `--check` rejects all of them while this gate
  // used to pass them. Keep the reasons next to the rule, like the list above.
  ['optional chaining', /\?\.\s*[A-Za-z_$[(]/], // `?.` + digit is ES5's `? .5`
  ['nullish coalescing', /\?\?/],
  ['logical assignment', /(?:\|\||&&)\s*=/],
  ['numeric separator', /(?<![\w$])(?:0[xXoObB])?[\d_]*\d_\d/],
  ['BigInt literal', /\b\d+n\b/],
  ['optional catch binding', /\bcatch\s*\{/],
];
const commonJsTokens = [
  ['module.exports', /\bmodule\s*\.\s*exports\b/],
  ['exports. access', /\bexports\s*[.[]/],
  ['require() call', /\brequire\s*\(/],
];

// Every tree the checker walks is walked recursively: a construct hidden one
// directory down (`app/scripts/lib/deep.js`) is still shipped and still breaks
// the device. Sorted so the OK banner and the FAIL order are stable.
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
  return out.sort();
}

// Names are relative to `root`: the recursive lister returns nested paths
// (`lib/deep.js`), which is what the messages print and what scanTokens joins
// back onto the tree root.
function relativeTo(root, paths) {
  return paths.map((path) => (path.startsWith(root + '/') ? path.slice(root.length + 1) : path));
}

// One rule for every tree the checker walks: the tree is ALWAYS walked
// recursively — a construct one directory down (`app/scripts/lib/deep.js`) is
// shipped and breaks the device just the same — and a tree that is missing, or
// holds none of the files it is supposed to hold, is a FAIL. A gate that passes
// because the code it guards went away is worse than no gate.
function filesIn(root, suffix, missingHint, emptyReason) {
  if (!existsSync(root)) {
    console.error('FAIL: ' + root + ' does not exist — ' + missingHint);
    return [];
  }
  const names = relativeTo(root, listFilesRecursive(root, suffix));
  if (names.length === 0) {
    console.error('FAIL: no ' + suffix + ' files found under ' + root + ' — ' + emptyReason);
  }
  return names;
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
      const matcher = entry[1];
      const hit = matcher instanceof RegExp ? matcher.test(text) : matcher(text);
      if (hit) {
        console.error('FAIL: ' + prefix + name + ' contains ' + label + suffix);
        failed = true;
      }
    }
  }
  return failed;
}

let failed = false;
const checked = filesIn(dir, '.js', 'run `npm run build` first.', 'cannot check the webview scripts.');
if (checked.length === 0) failed = true;
if (scanTokens(dir, checked, '', patterns)) {
  failed = true;
}
// app/js is loaded by the webview as plain <script>: CommonJS tokens break it.
if (scanTokens(dir, checked, '', commonJsTokens, ' — app/js must stay plain-script <script>-loadable')) {
  failed = true;
}

// The TV-side scripts are what node v8.12.0 really executes (dnsq.sh execs
// app/scripts/dnsq.js), so they get the syntax patterns — but never the
// CommonJS ban, because require() is exactly what these CLIs may use.
const scriptFiles = filesIn(
  scriptsDir,
  '.js',
  'refusing to pass without the TV-side scripts.',
  'cannot check the TV-side scripts.'
);
if (scriptFiles.length === 0) {
  failed = true;
} else if (scanTokens(scriptsDir, scriptFiles, scriptsDir + '/', patterns)) {
  failed = true;
}

// Layer 1 of the plain-script guard: the source itself must never use
// top-level import/export (tsc would silently switch the output to CommonJS).
const srcDir = 'src';
const srcFiles = filesIn(
  srcDir,
  '.ts',
  'the plain-script guard would silently skip.',
  'cannot check the plain-script guard.'
);
if (srcFiles.length === 0) failed = true;
for (const file of srcFiles) {
  const path = join(srcDir, file);
  if (reportMaskErrors(path, path)) failed = true;
  const { text } = masked(path);
  if (/^\s*(?:import|export)\b/m.test(text)) {
    console.error(
      'FAIL: ' + path + ' uses import/export — src must stay plain-script (IIFE globals), not CommonJS modules.'
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
