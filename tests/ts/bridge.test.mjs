// Unit tests for the compiled bridge (app/js/bridge.js): S2 fixed-command gate.
// Run after `npm run build`:  npm run test:ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const bridgeJs = readFileSync(
  fileURLToPath(new URL('../../app/js/bridge.js', import.meta.url)),
  'utf8'
);

const APP_DIR = '/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist';
const HOOK_LINK = '/var/lib/webosbrew/init.d/50-lgtv-blocklist-app';

function loadBridge() {
  const calls = [];
  const context = {
    webOS: {
      libVersion: '1.2.13',
      service: {
        request(uri, options) {
          // Copy into this realm: node:assert/strict deepEqual checks [[Prototype]]
          // with ===, and vm-realm plain objects have a different Object.prototype
          // (nodejs/node#44462), so a raw reference can never deep-equal a
          // test-realm {}. Bookkeeping only; the bridge code is untouched.
          const params = options.parameters
            ? Object.assign({}, options.parameters)
            : options.parameters;
          calls.push({ uri: uri, method: options.method, parameters: params });
          if (options.onSuccess) {
            options.onSuccess({ returnValue: true, stdoutString: '' });
          }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(bridgeJs, context);
  return { bridge: context.LgBlocklistBridge, calls: calls };
}

test('public API is exactly the fixed wrapper set — no generic exec', () => {
  const { bridge } = loadBridge();
  assert.deepEqual(
    Object.keys(bridge).sort(),
    [
      'available', 'diagnose', 'getConfiguration', 'libVersion', 'readHookState',
      'registerHook', 'removeHook', 'runCheck', 'runApply', 'runRollback',
      'setTierSafe', 'setTierStrict'
    ].sort()
  );
  assert.equal(bridge.exec, undefined);
  assert.equal(bridge.runFixedCommand, undefined);
});

test('each wrapper sends its exact fixed command to the HBC service', () => {
  const { bridge, calls } = loadBridge();
  const noop = () => {};
  bridge.registerHook(noop);
  bridge.removeHook(noop);
  bridge.readHookState(noop);
  bridge.runCheck(noop);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.uri, 'luna://org.webosbrew.hbchannel.service');
    assert.equal(call.method, 'exec');
  }
  assert.equal(
    calls[0].parameters.command,
    'mkdir -p /var/lib/webosbrew/init.d && chmod +x ' + APP_DIR + '/scripts/boot.sh' +
      ' && ln -sf ' + APP_DIR + '/scripts/boot.sh ' + HOOK_LINK
  );
  assert.equal(calls[1].parameters.command, 'rm -rf ' + HOOK_LINK);
  assert.equal(calls[2].parameters.command, 'readlink ' + HOOK_LINK);
  assert.equal(calls[3].parameters.command, 'sh ' + APP_DIR + '/scripts/check.sh');
});

test('every fixed command stays inside the conservative character set', () => {
  const { bridge, calls } = loadBridge();
  const noop = () => {};
  bridge.registerHook(noop);
  bridge.removeHook(noop);
  bridge.readHookState(noop);
  bridge.runCheck(noop);
  bridge.runApply(noop);
  bridge.runRollback(noop);
  bridge.setTierSafe(noop);
  bridge.setTierStrict(noop);
  // `+` is required by the reviewed register command (`chmod +x`).
  const allowed = /^[A-Za-z0-9 \/._&+-]+$/;
  for (const call of calls) {
    assert.match(call.parameters.command, allowed);
  }
});

test('runApply sends exactly the fixed apply.sh command', () => {
  const { bridge, calls } = loadBridge();
  bridge.runApply(() => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].uri, 'luna://org.webosbrew.hbchannel.service');
  assert.equal(calls[0].method, 'exec');
  assert.equal(calls[0].parameters.command, 'sh ' + APP_DIR + '/scripts/apply.sh');
});

test('runRollback sends exactly the fixed rollback.sh command', () => {
  const { bridge, calls } = loadBridge();
  bridge.runRollback(() => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].uri, 'luna://org.webosbrew.hbchannel.service');
  assert.equal(calls[0].method, 'exec');
  assert.equal(calls[0].parameters.command, 'sh ' + APP_DIR + '/scripts/rollback.sh');
});

test('getConfiguration goes through the same service without a command', () => {
  const { bridge, calls } = loadBridge();
  bridge.getConfiguration(() => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'getConfiguration');
  assert.deepEqual(calls[0].parameters, {});
});

// --- S6a T3: the tier switch ------------------------------------------------

test('setTierSafe / setTierStrict send exactly the fixed tier.sh commands', () => {
  const { bridge, calls } = loadBridge();
  bridge.setTierSafe(() => {});
  bridge.setTierStrict(() => {});
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.uri, 'luna://org.webosbrew.hbchannel.service');
    assert.equal(call.method, 'exec');
  }
  assert.equal(calls[0].parameters.command, 'sh ' + APP_DIR + '/scripts/tier.sh safe');
  assert.equal(calls[1].parameters.command, 'sh ' + APP_DIR + '/scripts/tier.sh strict');
});

test('the tier argument is fixed per wrapper: caller arguments cannot reach argv', () => {
  const { bridge, calls } = loadBridge();
  const seen = [];
  // Extra arguments (and a tier value the caller would rather send) are ignored
  // by design: each wrapper owns one constant command string, so no DOM,
  // storage, query or network value can ever become argv.
  bridge.setTierSafe((response) => seen.push(response), 'strict; rm -rf /');
  bridge.setTierStrict((response) => seen.push(response), 'safe');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].parameters.command, 'sh ' + APP_DIR + '/scripts/tier.sh safe');
  assert.equal(calls[1].parameters.command, 'sh ' + APP_DIR + '/scripts/tier.sh strict');
  assert.deepEqual(seen.map((response) => response.returnValue), [true, true]);
  // There is no generic tier setter that would take the value as data.
  assert.equal(bridge.setTier, undefined);
  assert.equal(bridge.setTierValue, undefined);
});
