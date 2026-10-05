// Unit tests for the compiled status-block parser (app/js/status.js), schema 3.
// Run after `npm run build`:  npm run test:ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const statusJs = readFileSync(
  fileURLToPath(new URL('../../app/js/status.js', import.meta.url)),
  'utf8'
);

// Same vm harness structure as bridge.test.mjs. The compiled parser is a plain
// script that assigns the global LgStatus (no CommonJS), so the context needs
// no exports object — the global is read off the context exactly as a plain
// <script> tag load would expose it on the TV.
function loadParser() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(statusJs, context);
  return context.LgStatus;
}

function parse(text) {
  return loadParser().parse(text);
}

const BLOCK = [
  '@@STATUS-BEGIN',
  'schema=3',
  'ts=1789550329',
  'hook=linked',
  'hook_target=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh',
  'scripts=ok',
  'filter=up',
  'rule=on',
  'keeper=up',
  'guard=up',
  'pointer=on',
  'gaveup=no',
  'mode=on',
  'upstream=192.168.179.1',
  'cap=dnat',
  'tier=safe',
  '@@STATUS-END'
].join('\n');

function withoutKey(key) {
  return BLOCK.split('\n').filter((line) => !line.startsWith(key + '=')).join('\n');
}

test('parses the schema-3 sample fixture and returns every typed field', () => {
  const raw = readFileSync(
    fileURLToPath(new URL('./fixtures/status-schema3-sample.txt', import.meta.url)),
    'utf8'
  );
  const block = parse(raw);
  assert.ok(block);
  assert.equal(block.schema, '3');
  assert.equal(block.ts, 1789550329);
  assert.equal(block.hook, 'linked');
  assert.equal(
    block.hookTarget,
    '/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh'
  );
  assert.equal(block.scripts, 'ok');
  assert.equal(block.filter, 'up');
  assert.equal(block.rule, 'on');
  assert.equal(block.keeper, 'up');
  assert.equal(block.guard, 'up');
  assert.equal(block.pointer, 'on');
  assert.equal(block.gaveup, 'no');
  assert.equal(block.mode, 'on');
  assert.equal(block.upstream, '192.168.179.1');
  assert.equal(block.cap, 'dnat');
  assert.equal(block.tier, 'safe');
});

test('rejects the old schema-2 block (stale check.sh → no tier is ever guessed)', () => {
  const raw = readFileSync(
    fileURLToPath(new URL('./fixtures/status-schema2-sample.txt', import.meta.url)),
    'utf8'
  );
  // Fail closed: an older IPK's check.sh reports schema 2 and no tier. The panel
  // must show its unknown/error state rather than a tier it did not parse.
  assert.equal(parse(raw), null);
});

test('rejects the old schema-1 G1 capture (schema must be exactly 3)', () => {
  const raw = readFileSync(
    fileURLToPath(new URL('./fixtures/real-block-g1.txt', import.meta.url)),
    'utf8'
  );
  assert.equal(parse(raw), null);
});

test('rejects a block with the guard key missing', () => {
  assert.equal(parse(withoutKey('guard')), null);
});

test('rejects a block with the cap key missing', () => {
  assert.equal(parse(withoutKey('cap')), null);
});

test('rejects a block with the tier key missing', () => {
  assert.equal(parse(withoutKey('tier')), null);
});

test('rejects a duplicate key', () => {
  assert.equal(parse(BLOCK.replace('rule=on', 'rule=on\nrule=on')), null);
});

test('rejects a duplicate tier key', () => {
  assert.equal(parse(BLOCK.replace('tier=safe', 'tier=safe\ntier=strict')), null);
});

test('rejects an unknown key', () => {
  assert.equal(parse(BLOCK.replace('cap=dnat', 'cap=dnat\nmodel=x')), null);
});

test('rejects a bad filter enum value', () => {
  assert.equal(parse(BLOCK.replace('filter=up', 'filter=maybe')), null);
});

test('rejects a bad mode enum value', () => {
  assert.equal(parse(BLOCK.replace('mode=on', 'mode=weird')), null);
});

test('rejects a bad tier enum value (case matters, no guessing)', () => {
  assert.equal(parse(BLOCK.replace('tier=safe', 'tier=aggressive')), null);
  assert.equal(parse(BLOCK.replace('tier=safe', 'tier=SAFE')), null);
  assert.equal(parse(BLOCK.replace('tier=safe', 'tier=')), null);
});

test('accepts tier=strict', () => {
  const block = parse(BLOCK.replace('tier=safe', 'tier=strict'));
  assert.ok(block);
  assert.equal(block.tier, 'strict');
});

test('rejects an out-of-range upstream address', () => {
  assert.equal(parse(BLOCK.replace('upstream=192.168.179.1', 'upstream=999.1.1.1')), null);
});

test('rejects a near-miss upstream value', () => {
  assert.equal(parse(BLOCK.replace('upstream=192.168.179.1', 'upstream=none.')), null);
});

test('rejects a non-numeric ts', () => {
  assert.equal(parse(BLOCK.replace('ts=1789550329', 'ts=abc')), null);
});

test('rejects an oversized ts', () => {
  assert.equal(parse(BLOCK.replace('ts=1789550329', 'ts=12345678901234567890')), null);
});

test('rejects a non-absolute hook_target', () => {
  assert.equal(parse(BLOCK.replace(/^hook_target=.*$/m, 'hook_target=relative/path')), null);
});

test('rejects an empty value', () => {
  assert.equal(parse(BLOCK.replace('rule=on', 'rule=')), null);
});

test('rejects CR bytes inside the block', () => {
  assert.equal(parse(BLOCK.replace('scripts=ok', 'scripts=ok\r')), null);
});

test('rejects a missing END delimiter', () => {
  assert.equal(parse(BLOCK.replace('@@STATUS-END', '')), null);
});

test('rejects swapped BEGIN/END delimiters', () => {
  const lines = BLOCK.split('\n');
  lines[0] = '@@STATUS-END';
  lines[lines.length - 1] = '@@STATUS-BEGIN';
  assert.equal(parse(lines.join('\n')), null);
});

test('rejects junk before the BEGIN delimiter', () => {
  assert.equal(parse('noise\n' + BLOCK), null);
});

test('rejects junk after the END delimiter', () => {
  assert.equal(parse(BLOCK + '\nnoise'), null);
});

test('rejects two concatenated blocks', () => {
  assert.equal(parse(BLOCK + '\n' + BLOCK), null);
});

test('accepts a shuffled key order (keys are position-independent)', () => {
  const lines = BLOCK.split('\n');
  const body = lines.slice(1, lines.length - 1).reverse();
  const block = parse([lines[0]].concat(body, [lines[lines.length - 1]]).join('\n'));
  assert.ok(block);
  assert.equal(block.schema, '3');
  assert.equal(block.cap, 'dnat');
  assert.equal(block.tier, 'safe');
});

test('accepts hook_target=none and upstream=none', () => {
  const text = BLOCK
    .replace('hook=linked', 'hook=missing')
    .replace(/^hook_target=.*$/m, 'hook_target=none')
    .replace('upstream=192.168.179.1', 'upstream=none');
  const block = parse(text);
  assert.ok(block);
  assert.equal(block.hook, 'missing');
  assert.equal(block.hookTarget, 'none');
  assert.equal(block.upstream, 'none');
});

test('accepts degraded mode with cap=unsupported', () => {
  const text = BLOCK.replace('mode=on', 'mode=degraded').replace('cap=dnat', 'cap=unsupported');
  const block = parse(text);
  assert.ok(block);
  assert.equal(block.mode, 'degraded');
  assert.equal(block.cap, 'unsupported');
  // Tier is independent of protection state: degraded still reports the tier.
  assert.equal(block.tier, 'safe');
});

test('rejects non-string input', () => {
  assert.equal(parse(null), null);
  assert.equal(parse(undefined), null);
});
