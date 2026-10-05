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
  'btn-protect', 'btn-refresh', 'btn-check', 'btn-state', 'btn-register', 'btn-remove'
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

function loadMain() {
  const elements = {};
  for (const id of ELEMENT_IDS) {
    elements[id] = {
      textContent: '',
      className: '',
      disabled: false,
      handlers: {},
      addEventListener(type, fn) {
        this.handlers[type] = fn;
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
