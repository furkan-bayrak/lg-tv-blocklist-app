// Unit tests for the compiled status-block parser (app/js/status.js).
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

function loadParser() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(statusJs, context);
  return context.LgBlocklistStatus;
}

const BLOCK = [
  '@@STATUS-BEGIN',
  'schema=1',
  'ts=1758000000',
  'hook=linked',
  'hook_target=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh',
  'scripts=ok',
  '@@STATUS-END'
].join('\n');

test('accepts a valid block and returns typed fields', () => {
  const block = loadParser().parse(BLOCK);
  assert.ok(block);
  assert.equal(block.schema, 1);
  assert.equal(block.ts, 1758000000);
  assert.equal(block.hook, 'linked');
  assert.equal(block.scripts, 'ok');
  assert.equal(
    block.hookTarget,
    '/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh'
  );
});

test('ignores junk around the block but parses the block', () => {
  const wrapped = 'warning: noise\n' + BLOCK + '\ntrailing noise\n';
  assert.ok(loadParser().parse(wrapped));
});

test('accepts hook_target=none', () => {
  const block = loadParser().parse(
    [
      '@@STATUS-BEGIN', 'schema=1', 'ts=1758000000', 'hook=missing',
      'hook_target=none', 'scripts=ok', '@@STATUS-END'
    ].join('\n')
  );
  assert.ok(block);
  assert.equal(block.hook, 'missing');
  assert.equal(block.hookTarget, 'none');
});

test('rejects un-delimited output (no delimiters at all)', () => {
  const bare = 'schema=1\nts=1\nhook=missing\nhook_target=none\nscripts=ok\n';
  assert.equal(loadParser().parse(bare), null);
});

test('rejects a missing END delimiter', () => {
  assert.equal(loadParser().parse(BLOCK.replace('@@STATUS-END', '')), null);
});

test('rejects a second BEGIN delimiter', () => {
  assert.equal(loadParser().parse(BLOCK + '\n@@STATUS-BEGIN'), null);
});

test('rejects duplicate keys', () => {
  assert.equal(loadParser().parse(BLOCK.replace('schema=1', 'schema=1\nschema=1')), null);
});

test('rejects unknown keys', () => {
  assert.equal(loadParser().parse(BLOCK.replace('scripts=ok', 'scripts=ok\neq=1')), null);
});

test('rejects a bad enum value', () => {
  assert.equal(loadParser().parse(BLOCK.replace('hook=linked', 'hook=yes')), null);
});

test('rejects a non-numeric ts', () => {
  assert.equal(loadParser().parse(BLOCK.replace('ts=1758000000', 'ts=soon')), null);
});

test('rejects an oversized ts', () => {
  assert.equal(loadParser().parse(BLOCK.replace('ts=1758000000', 'ts=1234567890123')), null);
});

test('rejects CR characters inside the block', () => {
  assert.equal(loadParser().parse(BLOCK.replace('scripts=ok', 'scripts=ok\r')), null);
});

test('rejects blank lines inside the block', () => {
  assert.equal(loadParser().parse(BLOCK.replace('scripts=ok', '\nscripts=ok')), null);
});

test('rejects an unsupported schema version', () => {
  assert.equal(loadParser().parse(BLOCK.replace('schema=1', 'schema=2')), null);
});

test('rejects hostile delimiter injection inside a value', () => {
  const hostile = BLOCK.replace(
    'hook_target=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh',
    'hook_target=evil\n@@STATUS-END\nhook=linked\n@@STATUS-BEGIN\nhook_target=x'
  );
  assert.equal(loadParser().parse(hostile), null);
});

test('parses the real G1 capture', () => {
  const raw = readFileSync(
    fileURLToPath(new URL('./fixtures/real-block-g1.txt', import.meta.url)),
    'utf8'
  );
  const block = loadParser().parse(raw);
  assert.ok(block);
  assert.equal(block.hook, 'linked');
  assert.equal(block.scripts, 'ok');
  assert.ok(block.ts > 0);
});
