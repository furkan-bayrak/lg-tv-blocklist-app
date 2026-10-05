#!/usr/bin/env node
/*
 * Scans the shipped JavaScript for syntax the device must not see.
 *
 * Read this as a conservative PATTERN CHECK plus a masking lexer, NOT an ES5
 * parser: it fails loudly when a construct the oldest engine we claim cannot
 * read appears in a file we ship. The two lists below say exactly what is and
 * is not enforced, so the OK line can be read for what it is.
 *
 * Why two trees, both scanned RECURSIVELY (a file one directory down is shipped
 * just the same):
 *   - app/js/ is loaded by the webview as plain <script> tags, so CommonJS
 *     tokens are banned there as well (layer 2 of the plain-script guard);
 *   - app/scripts/ is executed on the TV by node v8.12.0 — dnsq.sh execs
 *     app/scripts/dnsq.js — where require() is the contract, so no CommonJS ban.
 * A third tree, src/, is checked by the plain-script guard only: one
 * import/export in a .ts file makes tsc emit CommonJS and the webview breaks at
 * load time. A tree that is missing, or that yields no file to scan, is a FAIL.
 * Dependency-free on purpose; the app must run on the oldest engine we claim
 * (design spec §3). ares-package's own compatibility detection
 * (webosbrew-ipk-verify) runs in CI; this catches regressions in seconds on the
 * developer machine.
 *
 * WHAT THIS CATCHES. Every entry was measured with the real node v8.17.0
 * binary — `--check` AND a real run, because for regex features `--check`
 * accepts what the engine then throws on:
 *   - syntax node v8 itself refuses: optional chaining, nullish coalescing,
 *     logical assignment, numeric separators, BigInt literals in every base,
 *     optional catch binding, ESM import/export, class bodies with private
 *     fields, regex named capture groups, \p{…}/\P{…} with the u flag, and the
 *     `d` and `v` regex flags;
 *   - ES6 syntax node v8 does accept but the TV's older webview must not see
 *     (ES5 policy, not device-fatal): let, const, arrow functions, class in
 *     declaration and expression position (`class{}`, `class Foo {}`), template
 *     literals, generators, spread/rest arguments, async/await.
 *
 * WHAT THIS DOES NOT CATCH — a gap stated rather than hidden, because no pattern
 * separates these from legal ES5 without also firing on legal ES5:
 *   - destructuring, for..of, shorthand methods, getters, computed property
 *     names, default/rest parameters and `**`. node v8.17.0 ACCEPTS all of
 *     them, so they are an ES5-policy gap for the webview rather than a device
 *     break for the TV, and they pass this check;
 *   - regex lookbehind `(?<=…)`/`(?<!…)`, the `s`/`y`/`u` flags and `\u{…}u`:
 *     node 8.17 accepts those too, so they are not flagged;
 *   - anything else only a parser can see. `npm run check:node8` closes that
 *     hole for syntax: it runs the REAL node 8 parser over every .js file in
 *     app/js and app/scripts in CI. A real parser cannot be blinded by a regex
 *     literal, so it subsumes the whole class of masker-soundness bugs for
 *     syntax, and this pattern list is left responsible only for the policy
 *     forms the parser accepts.
 *
 * KNOWN FALSE POSITIVES (measured, accepted): a keyword rule matches a keyword
 * used as code, but a legal ES5 identifier or property name can still look like
 * one in an unusual position — `var y = obj.let - 1;` and `var async = 1;` both
 * fail. Biased on purpose: a loud false FAIL is acceptable in this tool, a
 * silent pass is not.
 *
 * Patterns are matched against a masked copy of the source: ONE left-to-right
 * lexer pass blanks the contents of every non-code span — single- and
 * double-quoted strings, template literals, line and block comments, and REGEX
 * LITERALS (whose body and flags are recorded first, so the regex-feature rules
 * above still see them). A comment-only scrub cannot be sound: it cannot tell
 * `p.replace(/\//g, '-')` from `a // comment`, so the `/` inside the regex opens
 * a comment that swallows the rest of the line — real code included. The masker
 * therefore classifies every span as it walks. Escapes are honoured and a `/`
 * inside a character class does not end the literal.
 *
 * Regex vs division is decided by the previous significant token: after an
 * operator, `(`, `,`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `{`, `;`, a
 * statement-position `}` or a value-position keyword (`return`, `typeof`,
 * `case`, …) a `/` opens a regex literal, while after an identifier, number,
 * string, `)`, `]`, `++`/`--` or an expression-position `}` it is division.
 *
 * Two positions cannot be settled lexically at all:
 *   - a `/` after a `}` that may close either a statement block
 *     (`if (x) {} /re/.test(y)`) or a function-EXPRESSION body
 *     (`var f = function () {} / 2;`);
 *   - a `/` after a `)` that may close an `if`/`while`/`for`/`with`/`catch`/
 *     `switch` header (statement position) or a call, grouping, or parameter
 *     list (expression position).
 * The masker remembers what opened each paren and brace, and where the kind is
 * ambiguous it FAILS CLOSED (`ambiguous / after }`, `ambiguous / after )`)
 * instead of guessing. Both guesses are unsound: read a regex as division and
 * its own `/*` or `//` bytes open a phantom comment that hides real code; read
 * a division as a regex and the “body” swallows to the next `/`. Measured
 * before this rule: `var f = function () {} / 2; const HIDDEN = 42;` and
 * `if (x) /[/*]/.test(y); const AFTER = 1;` (plus a later comment
 * terminator) both printed OK. Where a `/` follows a statement-position `}` it
 * still opens a regex, and a regex after a control header `)` is statement
 * position again.
 *
 * The masker FAILS CLOSED everywhere else too: an unterminated string, template
 * literal, comment or regex, and any `/` after a token it does not know, fail
 * the file with a clear message — the gate must never print OK for a file it
 * could not read. Backticks stay visible, so template literals are still
 * detected. A false FAIL is acceptable here; a silent pass is not.
 *
 * Plain-script guard (S3/T7): index.html loads js/bridge.js, js/status.js and
 * js/main.js as plain <script> tags — there is no module loader — so every
 * file in app/js/ must stay a plain-script IIFE global. One `import`/`export`
 * in src/ makes tsc emit CommonJS (`exports.`/`require(`) and the webview
 * breaks at load time; the ES5 checks alone would not notice. Two layers:
 *   1. every .ts file under src/: no import/export anywhere (the root cause);
 *   2. app/js/*.js: no CommonJS tokens (the compiled symptom).
 * Both layers are position-aware: a keyword only counts where a parser would
 * see it as code, never as a property name (`obj.export`, `{ class: 1 }`).
 */
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

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

// True when the previous significant token is `.` (or `?.`), i.e. the next word
// is a PROPERTY NAME, never a keyword: ES5 allows every reserved word as a
// member name, and a property name cannot introduce a control statement.
// Measured (round 3, why this exists): without the test,
//   obj.catch(x) / 2; const HIDDEN = 1; var g = 1 / 3;   -> was OK, rc 0
//   obj.catch(x) / 2; var f = () => 1; var g = 1 / 3;    -> was OK, rc 0
//   obj.if(x) / 2;                     (legal ES5)       -> was rc 1
// — the property name sent `(` down the control-header branch, the `/` after
// `)` was read as a regex literal, and that “literal” swallowed the rest of the
// line, `const` and the arrow included. The keyword-as-property list is exactly
// the six entries of CONTROL_HEADERS plus the object-key form `{if: f}.if(x)`.
function isMemberAccess(prev) {
  return prev !== null && prev.type === 'punct' && (prev.text === '.' || prev.text === '?.');
}

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
    // A word after `.` is a property name (`obj.if(…)`, `obj.catch(…)`), so its
    // `(` is a call, not a header: the statement-position rule must not apply.
    if (!prev.member && CONTROL_HEADERS.has(prev.text)) return 'header';
    if (!prev.member && prev.text === 'function') return 'params';
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
  const regexes = [];
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
        regexes.push({
          body: source.slice(i + 1, regex.bodyEnd),
          flags: source.slice(regex.bodyEnd + 1, regex.end),
        });
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
      // `member` is what lets parenKind() tell a header keyword from a property
      // name; it is recorded here because only the masker sees token order.
      prev = { type: 'word', text: source.slice(i, j), member: isMemberAccess(prev) };
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

  return { text: masked.join(''), errors, regexes };
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

// Post-ES5 features INSIDE a regex literal. The masker blanks literal bodies on
// purpose (their `/` bytes must not be read as code), so no text pattern can
// see them and this pass reads the recorded literals instead. Every entry was
// measured against the real node v8.17.0 binary; the ones node 8 ACCEPTS are
// deliberately absent (see the header for the policy gap that leaves):
//   /(?<ip>\d+)/  --check passes, then SyntaxError when the literal is compiled
//   /\p{L}/u       --check passes, then SyntaxError when the literal is compiled
//   /a/d, /a/v     SyntaxError at --check
//   /(?<=a)b/, /a/s, /\u{1F600}/u   accepted by node 8.17 — not flagged
const REGEX_FEATURES = [
  ['named capture group (ES2018)', (body) => /\(\?<[A-Za-z_$]/.test(body)],
  [
    'Unicode property escape (ES2018) with the u flag',
    (body, flags) => flags.includes('u') && /\\[pP]\{/.test(body),
  ],
  ['hasIndices regular expression flag "d" (ES2022)', (body, flags) => flags.includes('d')],
  ['unicodeSets regular expression flag "v" (ES2024)', (body, flags) => flags.includes('v')],
];

// One FAIL line per file, so a literal with two features does not report twice.
function scanRegexFeatures(root, names, prefix) {
  let failed = false;
  for (const name of names) {
    const { regexes } = masked(join(root, name));
    const hit = REGEX_FEATURES.find(([, test]) =>
      regexes.some((literal) => test(literal.body, literal.flags))
    );
    if (hit !== undefined) {
      console.error('FAIL: ' + prefix + name + ' contains ' + hit[0]);
      failed = true;
    }
  }
  return failed;
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
// True when any of `words` appears as CODE: not as a member name (`obj.class`)
// and not as an object-literal key (`{ class: 1 }`) — the legal ES5 neighbours a
// keyword rule must tolerate. Non-code spans are blanked by the masker before
// any rule runs, so a bare match means a parser would really see the keyword.
function codeWord(...words) {
  return (text) => codeWordHit(text, words) !== null;
}

// The first of `words` that appears as code, or null. `import`/`export` cannot
// legally appear as an identifier at all (ES5 reserves both), so any non-key
// occurrence is either ESM syntax or a syntax error — both must fail here:
// both trees are plain scripts, app/js has no module loader and node v8 refuses
// `import`/`export` outright.
function codeWordHit(text, words) {
  for (const word of words) {
    const re = new RegExp('\\b' + word + '\\b', 'g');
    let match;
    while ((match = re.exec(text)) !== null) {
      if (isPropertyName(text, match.index, match[0].length)) continue;
      return word;
    }
  }
  return null;
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

// Numeric literals the way a lexer sees them: hex/octal/binary (with separators
// and an optional BigInt suffix), decimal with an optional fraction and
// exponent, or a bare `.5`. The lookbehind keeps a leading `.` or identifier
// character out of the match, so `_1_2`, `obj._1_2` and `a1_2` are identifiers
// and never numeric tokens. Matching the TOKEN (instead of looking for `_` or
// `n` anywhere near a digit) is what fixes both directions of hole C3/D: all
// three BigInt bases and the exponent separator are caught, while legal ES5
// identifiers are not.
const NUMERIC_LITERAL =
  /(?<![\w$.])(?:0[xX][\da-fA-F_]*|0[bB][01_]*|0[oO][0-7_]*|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?[\d_]*)?|\.\d[\d_]*(?:[eE][+-]?[\d_]*)?)n?/g;

function numericTokens(text) {
  return [...text.matchAll(NUMERIC_LITERAL)].map((match) => match[0]);
}

// `1_000`, `0x1_0`, `1e1_0`: a separator only counts inside a numeric token.
function hasNumericSeparator(text) {
  return numericTokens(text).some((token) => token.includes('_'));
}

// `1n`, `0x1fn`, `0b1010n`, `0o7n`: BigInt in every base (all node-8 fatal; the
// old /\b\d+n\b/ only saw the decimal form).
function hasBigIntLiteral(text) {
  return numericTokens(text).some((token) => token.endsWith('n'));
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
  // ESM syntax: measured rc 0 in both trees before this rule. node v8.17.0
  // refuses it in app/scripts, and app/js is loaded as plain <script> — there is
  // no module loader in the webview either.
  ['ESM import/export statement', codeWord('import', 'export')],
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
  ['numeric separator', hasNumericSeparator],
  ['BigInt literal', hasBigIntLiteral],
  ['optional catch binding', /\bcatch\s*\{/],
];
const commonJsTokens = [
  ['module.exports', /\bmodule\s*\.\s*exports\b/],
  ['exports. access', /\bexports\s*[.[]/],
  ['require() call', /\brequire\s*\(/],
];

// A FAIL line for a symbolic link the walk refuses to follow, or null when the
// link could not have been part of the scan anyway: a resolvable link to a
// non-directory whose name does not match `scanned` (a `.sh` link, say) was
// never read by this walk and still is not, so it is not news. Everything else
// is reported instead of skipped — a link to a directory (the walk would have
// descended), a link whose name would have been scanned, and a link that cannot
// be resolved at all (it may have been either).
function linkProblem(path, root, realRoot, scanned) {
  let raw = null;
  try {
    raw = readlinkSync(path);
  } catch (error) {
    raw = null;
  }
  let target = null;
  try {
    target = realpathSync(path);
  } catch (error) {
    return (
      path + ' is an unresolvable symbolic link to ' + (raw === null ? '?' : raw) +
      ' (' + (error.code || error.message) + ') — the walk never follows a link, so nothing behind it is verified.'
    );
  }
  if (!scanned && !isDirectory(target)) return null;
  const outside = realRoot !== null && !isInside(target, realRoot) ? ' (outside ' + root + ')' : '';
  return (
    path + ' is a symbolic link to ' + target + outside +
    ' — the walk never follows a link, so nothing behind it is verified.'
  );
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    return false;
  }
}

function isInside(target, realRoot) {
  return target === realRoot || target.startsWith(realRoot + sep);
}

function tryRealpath(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    return null;
  }
}

// Every tree the checker walks is walked recursively: a construct hidden one
// directory down (`app/scripts/lib/deep.js`) is still shipped and still breaks
// the device. Sorted so the OK banner and the FAIL order are stable.
//
// The walk never follows a symbolic link and never lets `stat` follow one for
// it. Measured before this (round 3): `ln -s /nonexistent app/scripts/broken.js`
// and a self-referential `app/scripts/loop -> .` both ended in an uncaught
// node:fs stack trace (ENOENT, ELOOP — rc 1 either way, but the FAIL was
// unreadable), and `ln -s /tmp app/scripts/ext` followed a directory OUTSIDE the
// tree and scanned it (rc 1 on a file under /tmp, a tree the app never ships).
// Dirents from readdir carry `lstat` semantics, so `isSymbolicLink()` answers
// "is this a link" without following it: a link is never descended into and
// never read, and it is reported unless it resolves to a non-directory this
// walk would have ignored anyway. An unreadable directory is reported the same
// way instead of throwing.
function listFilesRecursive(root, suffix) {
  const names = [];
  const problems = [];
  const realRoot = tryRealpath(root);
  let rootStat = null;
  try {
    rootStat = lstatSync(root);
  } catch (error) {
    rootStat = null;
  }
  if (rootStat === null) {
    problems.push(root + ' cannot be read — nothing under it is verified.');
    return { names, problems };
  }
  if (rootStat.isSymbolicLink()) {
    // A symlinked ROOT (`app/js -> /tmp/x`) is the same hazard one level up:
    // lstat sees the link, so the scan refuses instead of reading through it.
    problems.push(linkProblem(root, root, realRoot, true));
    return { names, problems };
  }
  if (!rootStat.isDirectory()) {
    problems.push(root + ' is not a directory — there is nothing to scan.');
    return { names, problems };
  }
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      problems.push(
        current + ' cannot be read (' + (error.code || error.message) + ') — nothing under it is verified.'
      );
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const problem = linkProblem(path, root, realRoot, entry.name.endsWith(suffix));
        if (problem !== null) problems.push(problem);
      } else if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.name.endsWith(suffix)) {
        names.push(path);
      }
    }
  }
  return { names: names.sort(), problems };
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
// because the code it guards went away is worse than no gate. An entry the walk
// could not verify (a symbolic link, an unreadable directory) is reported for
// the same reason and counts as a failure too.
//
// `names` are relative to `root` (see relativeTo); `failed` is the caller's
// verdict for this tree, so a caller cannot forget the failure a problem means.
function filesIn(root, suffix, missingHint, emptyReason) {
  if (!existsSync(root)) {
    console.error('FAIL: ' + root + ' does not exist — ' + missingHint);
    return { names: [], failed: true };
  }
  const { names, problems } = listFilesRecursive(root, suffix);
  if (names.length === 0) {
    console.error('FAIL: no ' + suffix + ' files found under ' + root + ' — ' + emptyReason);
  }
  for (const problem of problems) {
    console.error('FAIL: ' + problem);
  }
  return { names: relativeTo(root, names), failed: names.length === 0 || problems.length > 0 };
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
if (checked.failed) failed = true;
if (scanTokens(dir, checked.names, '', patterns)) {
  failed = true;
}
if (scanRegexFeatures(dir, checked.names, '')) {
  failed = true;
}
// app/js is loaded by the webview as plain <script>: CommonJS tokens break it.
if (scanTokens(dir, checked.names, '', commonJsTokens, ' — app/js must stay plain-script <script>-loadable')) {
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
if (scriptFiles.failed) {
  failed = true;
} else {
  if (scanTokens(scriptsDir, scriptFiles.names, scriptsDir + '/', patterns)) failed = true;
  if (scanRegexFeatures(scriptsDir, scriptFiles.names, scriptsDir + '/')) failed = true;
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
if (srcFiles.failed) failed = true;
for (const file of srcFiles.names) {
  const path = join(srcDir, file);
  if (reportMaskErrors(path, path)) failed = true;
  const { text } = masked(path);
  // Position-aware, not line-anchored: `"use strict"; export const x = 1;`
  // slipped past the old /^\s*(?:import|export)\b/m guard because the statement
  // did not start the line.
  if (codeWordHit(text, ['import', 'export']) !== null) {
    console.error(
      'FAIL: ' + path + ' uses import/export — src must stay plain-script (IIFE globals), not CommonJS modules.'
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log('OK: app/js has nothing on the pattern list (' + checked.names.join(', ') + ')');
console.log('OK: app/scripts/*.js has nothing on the pattern list (' + scriptFiles.names.join(', ') + ')');
console.log('OK: plain-script guard — src/**/*.ts import/export-free, app/js/*.js CommonJS-token-free');
