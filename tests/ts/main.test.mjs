// Unit tests for the compiled UI glue (app/js/main.js): the single-flight
// discipline. No DOM library: a minimal element stub captures the click
// handlers, a fake bridge records calls, and every bridge callback is resolved
// by hand so the test can observe the busy flag while a call is in flight.
// Run after `npm run build`:  npm run test:ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const mainJs = readFileSync(
  fileURLToPath(new URL('../../app/js/main.js', import.meta.url)),
  'utf8'
);
// main.js uses the LgStatus global; the TV loads status.js before main.js with
// plain <script> tags, so the vm context must do the same.
const statusJs = readFileSync(
  fileURLToPath(new URL('../../app/js/status.js', import.meta.url)),
  'utf8'
);

const ELEMENT_IDS = [
  'status', 'panel', 'output', 'protection', 'prot-headline', 'prot-text',
  'btn-protect', 'btn-refresh', 'btn-check', 'btn-state', 'btn-register', 'btn-remove',
  'tier-current', 'tier-note', 'btn-tier-safe', 'btn-tier-strict'
];

const HOOK_TARGET =
  '/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh';

// A degraded-but-valid schema-3 block: enough for the parser to render a panel.
const STATUS_BLOCK = [
  '@@STATUS-BEGIN',
  'schema=3',
  'ts=1789550329',
  'hook=missing',
  'hook_target=none',
  'scripts=ok',
  'filter=down',
  'rule=absent',
  'keeper=down',
  'guard=down',
  'pointer=off',
  'gaveup=no',
  'mode=degraded',
  'upstream=none',
  'cap=unsupported',
  'tier=safe',
  '@@STATUS-END'
].join('\n');

// Same block with the tier the TV reports after a switch (S6a T3).
const STATUS_BLOCK_STRICT = STATUS_BLOCK.replace('tier=safe', 'tier=strict');

// A live-probed ON block: every field the parser checks stays valid, only the
// mode flips to on (the tier switch re-applies protection only in this case).
const STATUS_BLOCK_ON = STATUS_BLOCK
  .replace('filter=down', 'filter=up')
  .replace('rule=absent', 'rule=on')
  .replace('keeper=down', 'keeper=up')
  .replace('guard=down', 'guard=up')
  .replace('pointer=off', 'pointer=on')
  .replace('mode=degraded', 'mode=on')
  .replace('cap=unsupported', 'cap=dnat');

const STATUS_BLOCK_ON_STRICT = STATUS_BLOCK_ON.replace('tier=safe', 'tier=strict');

function loadMain() {
  const elements = {};
  for (const id of ELEMENT_IDS) {
    elements[id] = {
      textContent: '',
      className: '',
      disabled: false,
      attrs: {},
      handlers: {},
      addEventListener(type, fn) {
        this.handlers[type] = fn;
      },
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      focus() {}
    };
  }
  const calls = [];
  const pending = [];
  function record(name) {
    return function (cb) {
      calls.push(name);
      pending.push({ name: name, cb: cb });
    };
  }
  const bridge = {
    available: () => true,
    diagnose: () => null,
    libVersion: () => '1.2.13',
    runCheck: record('runCheck'),
    runApply: record('runApply'),
    runRollback: record('runRollback'),
    setTierSafe: record('setTierSafe'),
    setTierStrict: record('setTierStrict'),
    registerHook: record('registerHook'),
    removeHook: record('removeHook'),
    readHookState: record('readHookState'),
    getConfiguration: record('getConfiguration')
  };
  const context = {
    document: {
      getElementById: (id) => elements[id] || null,
      addEventListener() {}
    },
    LgBlocklistBridge: bridge
  };
  vm.createContext(context);
  vm.runInContext(statusJs, context);
  vm.runInContext(mainJs, context);
  return { elements, calls, pending };
}

function resolve(pending, name, response) {
  const index = pending.findIndex((entry) => entry.name === name);
  assert.notEqual(index, -1, 'no pending ' + name + ' call');
  const entry = pending.splice(index, 1)[0];
  entry.cb(response);
}

function count(calls, name) {
  return calls.filter((call) => call === name).length;
}

test('single-flight: a second command is refused while the status probe runs', () => {
  const { elements, calls, pending } = loadMain();
  // The initial auto-refresh starts on load.
  assert.equal(elements['status'].textContent, 'Reading status...');
  elements['btn-check'].handlers.click();
  assert.equal(elements['status'].textContent, 'Busy');
  assert.equal(count(calls, 'getConfiguration'), 0);
  // Resolving the probe releases the flag and renders the panel.
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK });
  assert.equal(elements['status'].textContent, 'Status: filtering not supported on this TV');
  elements['btn-check'].handlers.click();
  assert.equal(elements['status'].textContent, 'Checking bridge...');
  assert.equal(count(calls, 'getConfiguration'), 1);
});

test('single-flight: registerHook holds busy through the nested readHookState', () => {
  const { elements, calls, pending } = loadMain();
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK });
  elements['btn-register'].handlers.click();
  assert.equal(count(calls, 'registerHook'), 1);
  // First response arrives: the result is shown, but the action is not done —
  // the nested readHookState is part of it.
  resolve(pending, 'registerHook', { returnValue: true, stdoutString: 'linked' });
  assert.equal(count(calls, 'readHookState'), 1);
  // Nested read in flight → a second command must still be refused.
  elements['btn-refresh'].handlers.click();
  assert.equal(elements['status'].textContent, 'Busy');
  assert.equal(count(calls, 'runCheck'), 1);
  // Nested read resolves → idle again, and the hook target is rendered.
  resolve(pending, 'readHookState', { returnValue: true, stdoutString: HOOK_TARGET });
  assert.ok(elements['output'].textContent.includes('Boot hook now: ' + HOOK_TARGET));
  elements['btn-refresh'].handlers.click();
  assert.equal(count(calls, 'runCheck'), 2);
});

// --- S6a T3: the tier row and the SAFE/STRICT switch -------------------------

test('the tier comes only from a parsed block, and switching is refused before one arrives', () => {
  const { elements, calls, pending } = loadMain();
  // No block yet → no tier is claimed and the switch is refused, not guessed.
  assert.equal(elements['tier-current'].textContent, 'Tier: unknown');
  elements['btn-tier-strict'].handlers.click();
  assert.equal(elements['status'].textContent, 'Tier not switchable yet');
  assert.equal(count(calls, 'setTierStrict'), 0);
  // The refusal is not a busy state: the probe in flight is untouched.
  assert.equal(count(calls, 'runCheck'), 1);
  // Blocks are resolved by hand, newest last: render the probed tier.
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK });
  assert.equal(elements['tier-current'].textContent, 'Tier: SAFE (default)');
  assert.equal(elements['btn-tier-safe'].className, 'tier-button is-active');
  assert.equal(elements['btn-tier-strict'].className, 'tier-button');
  assert.equal(elements['btn-tier-safe'].attrs['aria-pressed'], 'true');
  assert.equal(elements['btn-tier-strict'].attrs['aria-pressed'], 'false');
  assert.ok(elements['panel'].textContent.includes('Tier: SAFE (default)'));
  // The note says out loud that switching restarts the filter.
  assert.ok(elements['tier-note'].textContent.includes('restarts the filter'));
});

test('a rejected block clears the rendered tier — no stale claim survives', () => {
  const { elements, calls, pending } = loadMain();
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK });
  assert.equal(elements['tier-current'].textContent, 'Tier: SAFE (default)');
  elements['btn-refresh'].handlers.click();
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: 'not a block' });
  assert.equal(elements['tier-current'].textContent, 'Tier: unknown');
  assert.equal(elements['btn-tier-safe'].attrs['aria-pressed'], 'false');
  elements['btn-tier-strict'].handlers.click();
  assert.equal(count(calls, 'setTierStrict'), 0);
  assert.equal(elements['status'].textContent, 'Tier not switchable yet');
});

test('pressing the already-active tier is a no-op with a visible reason', () => {
  const { elements, calls, pending } = loadMain();
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK });
  elements['btn-tier-safe'].handlers.click();
  assert.equal(count(calls, 'setTierSafe'), 0);
  assert.equal(elements['status'].textContent, 'Tier already active');
  assert.ok(elements['output'].textContent.includes('SAFE list'));
});

test('switching tier with protection OFF persists, re-applies nothing, and re-renders', () => {
  const { elements, calls, pending } = loadMain();
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK });
  elements['btn-tier-strict'].handlers.click();
  assert.equal(count(calls, 'setTierStrict'), 1);
  assert.equal(elements['status'].textContent, 'Switching to STRICT…');
  assert.equal(count(calls, 'runApply'), 0, 'apply starts only after the tier is written');
  // Single-flight: the switch holds the busy flag until its refresh lands.
  elements['btn-refresh'].handlers.click();
  assert.equal(elements['status'].textContent, 'Busy');
  resolve(pending, 'setTierStrict', {
    returnValue: true,
    stdoutString: 'RESULT=tier\nreason=strict'
  });
  assert.equal(count(calls, 'runApply'), 0, 'nothing is running, so nothing restarts');
  // The panel is re-probed; the message never quotes the script's own claim.
  assert.equal(elements['status'].textContent, 'Reading status...');
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK_STRICT });
  assert.equal(elements['status'].textContent, 'Tier saved: STRICT');
  assert.equal(elements['tier-current'].textContent, 'Tier: STRICT');
  assert.equal(elements['btn-tier-strict'].className, 'tier-button is-active');
  // Idle again → a new command goes through.
  elements['btn-refresh'].handlers.click();
  assert.equal(count(calls, 'runCheck'), 3);
});

test('switching tier with protection ON re-applies through the existing apply flow', () => {
  const { elements, calls, pending } = loadMain();
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK_ON });
  assert.equal(elements['status'].textContent, 'Status: protection ON');
  elements['btn-tier-strict'].handlers.click();
  assert.equal(count(calls, 'setTierStrict'), 1);
  assert.equal(count(calls, 'runApply'), 0, 'the tier is written first');
  resolve(pending, 'setTierStrict', {
    returnValue: true,
    stdoutString: 'RESULT=tier\nreason=strict'
  });
  // Same fixed apply command, same single-flight flag, no extra probe in between.
  assert.equal(count(calls, 'runApply'), 1);
  assert.equal(count(calls, 'runCheck'), 1);
  elements['btn-refresh'].handlers.click();
  assert.equal(elements['status'].textContent, 'Busy');
  resolve(pending, 'runApply', {
    returnValue: true,
    stdoutString: 'RESULT=on\nreason=verified\nupstream=1.1.1.1'
  });
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK_ON_STRICT });
  assert.equal(elements['status'].textContent, 'Protection is on with the STRICT list.');
  assert.equal(elements['tier-current'].textContent, 'Tier: STRICT');
  assert.ok(elements['output'].textContent.includes('returnValue: true'));
  // Busy released after the refresh.
  elements['btn-refresh'].handlers.click();
  assert.equal(count(calls, 'runCheck'), 3);
});

test('a failed tier write is reported and never re-applies protection', () => {
  const { elements, calls, pending } = loadMain();
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK_ON });
  elements['btn-tier-strict'].handlers.click();
  resolve(pending, 'setTierStrict', { returnValue: false, errorText: 'exit 2' });
  assert.equal(count(calls, 'runApply'), 0, 'a failed write must not restart the filter');
  assert.equal(elements['status'].textContent, 'Tier not saved');
  // The panel keeps the last live-probed tier, never the attempted one.
  assert.equal(elements['tier-current'].textContent, 'Tier: SAFE (default)');
  assert.equal(elements['btn-tier-safe'].className, 'tier-button is-active');
  assert.equal(elements['btn-tier-strict'].className, 'tier-button');
  // Busy released → the next command runs.
  elements['btn-refresh'].handlers.click();
  assert.equal(count(calls, 'runCheck'), 2);
});
