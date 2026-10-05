// Tests for tools/check-node8.mjs — the gate that runs the REAL node 8 parser
// (`node@8.17.0 --check`) over the shipped .js files, the same parser dnsq.js
// meets on the TV's node v8.12.0.
//
// No test here touches the npm registry: every case drives the gate through
// CHECK_NODE8_BIN, so a developer offline and CI both run the same assertions.
// The resolved-download path is exercised by `npm run check:node8` itself (a CI
// step), and its UNVERIFIED / refusal behaviour is pinned below, because a gate
// that never ran must not look like a gate that passed.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = fileURLToPath(new URL('../../tools/check-node8.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
// `/bin/echo --version` prints "--version", so the gate sees a binary that is
// not node 8 — the same branch an offline `npx node@8.17.0` failure takes.
const NOT_NODE8 = '/bin/echo';
const EMPTY_TREE = mkdtempSync(join(tmpdir(), 'check-node8-'));

after(() => {
  rmSync(EMPTY_TREE, { recursive: true, force: true });
});

function runGate({ cwd = REPO_ROOT, bin, allowSkip = false } = {}) {
  const env = { ...process.env, CHECK_NODE8_BIN: bin };
  if (allowSkip) env.CHECK_NODE8_ALLOW_SKIP = '1';
  else delete env.CHECK_NODE8_ALLOW_SKIP;
  const r = spawnSync(process.execPath, [GATE], { cwd, encoding: 'utf8', env });
  assert.equal(r.error, undefined, `gate failed to start: ${r.error}`);
  return r;
}

test('fails (rc 1) when a shipped tree is missing, instead of passing an empty run', () => {
  const r = runGate({ cwd: EMPTY_TREE, bin: NOT_NODE8 });
  assert.equal(r.status, 1, `expected rc 1 (stdout=${r.stdout} stderr=${r.stderr})`);
  assert.match(r.stderr, /FAIL: app\/js is missing/);
});

test('refuses to report OK (rc 2) when node 8 cannot be obtained', () => {
  const r = runGate({ bin: NOT_NODE8 });
  assert.equal(r.status, 2, `expected rc 2 (stdout=${r.stdout} stderr=${r.stderr})`);
  assert.match(r.stderr, /UNVERIFIED: the node 8 parse gate did not run/);
  assert.match(r.stderr, /is not a node v8 binary/);
  assert.doesNotMatch(r.stdout, /^OK:/m);
});

test('the same situation is skippable, but only loudly (CHECK_NODE8_ALLOW_SKIP=1)', () => {
  const r = runGate({ bin: NOT_NODE8, allowSkip: true });
  assert.equal(r.status, 0, `expected rc 0 (stdout=${r.stdout} stderr=${r.stderr})`);
  assert.match(r.stderr, /UNVERIFIED: the node 8 parse gate did not run/);
  assert.match(r.stderr, /CHECK_NODE8_ALLOW_SKIP=1 is set/);
  assert.doesNotMatch(r.stdout, /^OK:/m, 'a skipped gate must not print the OK line');
});

test('a non-v8 node binary is rejected rather than treated as node 8', (t) => {
  // Guard the guard: if this suite itself runs under node 8, the gate would
  // accept process.execPath and start a download; skip instead of hitting the
  // network.
  if (/^v8\./.test(process.version)) {
    t.skip('the test binary is node 8 itself');
    return;
  }
  const r = runGate({ bin: process.execPath });
  assert.equal(r.status, 2, `expected rc 2 (stdout=${r.stdout} stderr=${r.stderr})`);
  assert.match(r.stderr, /UNVERIFIED: the node 8 parse gate did not run/);
  assert.doesNotMatch(r.stdout, /^OK:/m);
});
