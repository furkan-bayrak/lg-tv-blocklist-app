// Unit tests for the domain-toggle payload (src/overrides.ts → app/js/overrides.js):
// S6b T6. Run after `npm run build`:  npm run test:ts
//
// Two contracts are pinned here:
//  1. serialize() refuses everything app/scripts/overrides.sh would refuse, with
//     the same reason, BEFORE anything is sent to the TV — a rejection that only
//     showed up on the device would reach the user as silence.
//  2. isSafePayload() accepts only text that cannot change the meaning of the
//     shell command src/bridge.ts builds around it (that gate is what makes the
//     save command safe at all), and serialize() can only ever return such text.
// The grammar lives in two languages, so the last test reads the shell script and
// fails if the numbers or the character class ever drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const overridesJs = readFileSync(
  fileURLToPath(new URL('../../app/js/overrides.js', import.meta.url)),
  'utf8'
);
const shell = readFileSync(
  fileURLToPath(new URL('../../app/scripts/overrides.sh', import.meta.url)),
  'utf8'
);
const common = readFileSync(
  fileURLToPath(new URL('../../app/scripts/common.sh', import.meta.url)),
  'utf8'
);
const domains = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../app/filter/domains.json', import.meta.url)), 'utf8')
);
const DOMAIN_NAMES = domains.map((row) => row.name);

function load() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(overridesJs, context);
  return context.LgOverrides;
}

const LgOverrides = load();

// vm-realm objects have a different Object.prototype, so a raw reference can
// never deep-equal a test-realm object (same reason as tests/ts/bridge.test.mjs):
// copy the fields out before comparing, and never compare the vm object itself.
function plain(result) {
  return Object.assign({}, result);
}

const KNOWN = ['lge.com', 'thinq.com', 'lgtvcommon.com'];

// 129 lines of `www…w.com=on` = 129 x 128 bytes: every line is inside the
// grammar, the payload is not inside the byte cap. Its 128-line prefix is exactly
// 16384 bytes and must pass, which is the boundary the test below also asserts.
const WIDE_LINE = 'w'.repeat(120) + '.com=on\n';
const WIDE_129 = WIDE_LINE.repeat(129);

test('serialize builds one `name=on|off` line per change, in order, LF-terminated', () => {
  const result = LgOverrides.serialize(
    [
      { name: 'thinq.com', on: false },
      { name: 'lge.com', on: true }
    ],
    KNOWN
  );
  assert.deepEqual(plain(result), {
    ok: true,
    payload: 'thinq.com=off\nlge.com=on\n',
    reason: '',
    line: 0,
    detail: ''
  });
  assert.equal(LgOverrides.isSafePayload(result.payload), true);
});

test('serialize is sparse: one changed row produces one line, not a full list', () => {
  // The writer keeps every row the payload does not mention, and stores only the
  // difference against the active tier's preset, so a payload that restates the
  // preset has to mean "clear" rather than "pin".
  const result = LgOverrides.serialize([{ name: 'thinq.com', on: false }], KNOWN);
  assert.equal(result.ok, true);
  assert.equal(result.payload, 'thinq.com=off\n');
});

test('every shipped domain row serializes: the UI can send any row it renders', () => {
  const entries = DOMAIN_NAMES.map((name) => ({ name: name, on: true }));
  const result = LgOverrides.serialize(entries, DOMAIN_NAMES);
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.split('\n').slice(0, -1), DOMAIN_NAMES.map((name) => name + '=on'));
  // 115 rows is well inside both caps, so nothing here is a cap accident.
  assert.equal(DOMAIN_NAMES.length < LgOverrides.MAX_LINES, true);
});

test('serialize refuses a name outside the writer\'s character set', () => {
  // Uppercase, quotes, shell metacharacters, newline injection: the plan's list.
  const hostile = [
    'ThinQ.com', // uppercase: the writer only knows lowercase
    "a'b",
    'a"b',
    'a;b',
    'a|b',
    'a&b',
    'a>b',
    'a<b',
    'a`id`b',
    'a$(id)b',
    'a b',
    'a\\b',
    'a*b',
    'a=on\nb',
    'lge.com=on\nrm -rf /',
    'lge.com\n',
    'a\nb',
    'ünïcode.com'
  ];
  for (const name of hostile) {
    const result = LgOverrides.serialize([{ name: name, on: true }], KNOWN.concat([name]));
    assert.equal(result.ok, false, 'must refuse: ' + JSON.stringify(name));
    assert.equal(result.reason, 'bad-charset', JSON.stringify(name));
    assert.equal(result.payload, '');
    assert.equal(result.line, 1);
    assert.match(result.detail, /\[a-z0-9\._-]/);
  }
});

test('serialize refuses malformed changes with a shape reason', () => {
  const bad = [null, 42, 'lge.com', [], undefined, { name: 'lge.com' }, { on: true }, { name: 7, on: true }, { name: 'lge.com', on: 'on' }, { name: 'lge.com', on: 1 }];
  for (const entry of bad) {
    const result = LgOverrides.serialize([{ name: 'lge.com', on: true }, entry], KNOWN);
    assert.equal(result.ok, false, 'must refuse: ' + JSON.stringify(entry));
    assert.equal(result.reason, 'bad-shape', JSON.stringify(entry));
    assert.equal(result.line, 2); // the second change is the one that is wrong
  }
  assert.equal(LgOverrides.serialize([{ name: '', on: true }], KNOWN).reason, 'bad-shape');
  assert.equal(LgOverrides.serialize([{ name: '', on: true }], KNOWN).line, 1);
});

test('serialize refuses an empty payload, a non-list and an unknown-domain-only list', () => {
  const empty = plain(LgOverrides.serialize([], KNOWN));
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'empty-payload');
  assert.equal(empty.line, 0);
  assert.equal(LgOverrides.serialize('lge.com=on\n', KNOWN).reason, 'bad-shape');
  assert.equal(LgOverrides.serialize([{ name: 'lge.com', on: true }], 'lge.com').reason, 'unknown-domain');
  assert.equal(LgOverrides.serialize([{ name: 'lge.com', on: true }], []).reason, 'unknown-domain');
  assert.equal(
    LgOverrides.serialize([{ name: 'lge.com', on: true }], [7, null, {}]).reason,
    'unknown-domain'
  );
});

test('serialize refuses a name that is not in the app\'s domain list', () => {
  const result = LgOverrides.serialize([{ name: 'not-a-domain.example', on: true }], DOMAIN_NAMES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown-domain');
  assert.equal(result.line, 1);
  // And the same name is accepted the moment the list contains it, so the check
  // is membership, not a name pattern.
  assert.equal(
    LgOverrides.serialize([{ name: 'not-a-domain.example', on: true }], DOMAIN_NAMES.concat(['not-a-domain.example'])).ok,
    true
  );
});

test('serialize refuses a duplicate name and reports the second line', () => {
  const result = LgOverrides.serialize(
    [{ name: 'lge.com', on: true }, { name: 'thinq.com', on: false }, { name: 'lge.com', on: false }],
    KNOWN
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'duplicate');
  assert.equal(result.line, 3);
  // Opposite states for the same name are still a duplicate, not an update: the
  // writer's per-line semantics have no "last one wins".
  assert.equal(LgOverrides.serialize([{ name: 'lge.com', on: true }, { name: 'lge.com', on: true }], KNOWN).reason, 'duplicate');
});

test('serialize enforces the writer\'s name-length bound (128, not 129)', () => {
  const name = 'a'.repeat(128);
  const longer = 'a'.repeat(129);
  assert.equal(LgOverrides.NAME_MAX, 128);
  assert.equal(LgOverrides.serialize([{ name: name, on: true }], [name]).ok, true);
  const result = LgOverrides.serialize([{ name: longer, on: true }], [longer]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'name-too-long');
  assert.equal(result.line, 1);
});

test('serialize enforces both caps: 512 lines, 16384 bytes', () => {
  const many = [];
  const names = [];
  for (let i = 0; i < 520; i++) {
    const name = 'd' + String(i).padStart(3, '0') + '.example';
    many.push({ name: name, on: true });
    names.push(name);
  }
  assert.equal(LgOverrides.serialize(many.slice(0, 512), names).ok, true);
  const tooMany = plain(LgOverrides.serialize(many.slice(0, 513), names));
  assert.equal(tooMany.reason, 'oversized');
  assert.equal(tooMany.line, 0);

  // The byte cap is a second, independent limit: 128 lines of 124-character
  // names is exactly 16384 bytes (124 + '=on' + LF) and passes; one more line
  // exceeds it while the line count is still far below 512.
  const wide = [];
  const wideNames = [];
  for (let i = 0; i < 129; i++) {
    const name = 'w'.repeat(117) + String(i).padStart(3, '0') + '.com';
    assert.equal(name.length, 124);
    wide.push({ name: name, on: true });
    wideNames.push(name);
  }
  const exact = LgOverrides.serialize(wide.slice(0, 128), wideNames);
  assert.equal(exact.ok, true);
  assert.equal(exact.payload.length, 16384);
  const tooLong = plain(LgOverrides.serialize(wide, wideNames));
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.reason, 'oversized');
  assert.match(tooLong.detail, /16384 bytes/);
});

test('isSafePayload accepts exactly the alphabet the save command can quote', () => {
  const safe = [
    'lge.com=on\n',
    'lge.com=off\nthinq.com=on\n',
    'lge.com=on', // no trailing newline: the writer normalises that, so it is safe
    '_x-1.a=on\n',
    'a'.repeat(128) + '=off\n'
  ];
  for (const payload of safe) {
    assert.equal(LgOverrides.isSafePayload(payload), true, JSON.stringify(payload));
  }
  const unsafe = [
    '',
    '\n',
    'lge.com=on\n\n', // a blank line: the writer ignores it, this gate is a whitelist
    'lge.com=ON\n',
    'lge.com=on\r\n',
    'lge.com =on\n',
    'lge.com/on\n',
    'lge.com==on\n',
    'lge.com=on; rm -rf /\n',
    'lge.com=on$(id)\n',
    "lge.com=on'\n",
    'lge.com=on\\\n',
    'lge.com=on | sh\n',
    'a'.repeat(129) + '=on\n',
    WIDE_129 // 129 valid lines of 128 bytes: refused by the byte cap, not by the grammar
  ];
  for (const payload of unsafe) {
    assert.equal(LgOverrides.isSafePayload(payload), false, JSON.stringify(payload));
  }
  for (const value of [undefined, null, 7, {}, [], true, Buffer.from('lge.com=on\n')]) {
    assert.equal(LgOverrides.isSafePayload(value), false, String(value));
  }
  // 512 lines of a 3-character name is 3584 bytes: fine. 513 is not.
  assert.equal(LgOverrides.isSafePayload('a=on\n'.repeat(512)), true);
  assert.equal(LgOverrides.isSafePayload('a=on\n'.repeat(513)), false);
  assert.equal(WIDE_129.length, 16512);
  assert.equal(LgOverrides.isSafePayload(WIDE_LINE.repeat(128)), true); // exactly 16384 bytes
  assert.equal(LgOverrides.isSafePayload(WIDE_129), false);
});

test('a payload that passes the gate is byte-identical to what the writer reads', () => {
  // The gate's whole job: the bytes the shell quotes between its single quotes
  // must be the bytes the writer parses. A round trip through JSON (which cannot
  // change a string) plus a re-parse is enough to pin that no escaping, trimming
  // or newline normalisation is hiding in here.
  const result = LgOverrides.serialize(
    [{ name: 'lge.com', on: true }, { name: 'thinq.com', on: false }],
    KNOWN
  );
  assert.equal(result.ok, true);
  const roundTripped = JSON.parse(JSON.stringify(result.payload));
  assert.equal(roundTripped, result.payload);
  assert.deepEqual(roundTripped.split('\n').slice(0, -1), ['lge.com=on', 'thinq.com=off']);
  assert.equal(roundTripped.length, result.payload.length);
});

test('the grammar matches app/scripts/overrides.sh and common.sh (no silent drift)', () => {
  const bytes = /OV_MAX_BYTES=(\d+)/.exec(shell);
  const lines = /OV_MAX_LINES=(\d+)/.exec(shell);
  const nameMax = /OVERRIDE_NAME_MAX=(\d+)/.exec(common);
  assert.ok(bytes !== null, 'OV_MAX_BYTES not found in overrides.sh');
  assert.ok(lines !== null, 'OV_MAX_LINES not found in overrides.sh');
  assert.ok(nameMax !== null, 'OVERRIDE_NAME_MAX not found in common.sh');
  assert.equal(Number(bytes[1]), LgOverrides.MAX_BYTES);
  assert.equal(Number(lines[1]), LgOverrides.MAX_LINES);
  assert.equal(Number(nameMax[1]), LgOverrides.NAME_MAX);
  // The character class itself, not just the numbers: the writer rejects a name
  // containing anything outside [a-z0-9._-], which is the same set this module
  // builds its line pattern from.
  assert.ok(shell.includes('[!a-z0-9._-]'), 'the writer\'s charset test changed');
  // Every reason this module reports for a real (non-local) refusal is a reason
  // the writer names too; 'unsafe-payload' is local-only and must stay that way.
  for (const reason of ['empty-payload', 'oversized', 'bad-shape', 'bad-charset', 'name-too-long', 'unknown-domain', 'duplicate']) {
    assert.ok(shell.includes(reason), reason + ' is not a reason overrides.sh reports');
  }
  assert.equal(shell.includes('unsafe-payload'), false);
});
