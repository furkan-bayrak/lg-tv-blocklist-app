// Unit tests for the compiled bridge (app/js/bridge.js): S2 fixed-command gate.
// Run after `npm run build`:  npm run test:ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const bridgeJs = readFileSync(
  fileURLToPath(new URL('../../app/js/bridge.js', import.meta.url)),
  'utf8'
);
// index.html loads js/overrides.js before js/bridge.js: the save wrapper calls the
// payload validator, so the vm context has to match the page.
const overridesJs = readFileSync(
  fileURLToPath(new URL('../../app/js/overrides.js', import.meta.url)),
  'utf8'
);
const overridesSh = readFileSync(
  fileURLToPath(new URL('../../app/scripts/overrides.sh', import.meta.url)),
  'utf8'
);

const APP_DIR = '/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist';
const HOOK_LINK = '/var/lib/webosbrew/init.d/50-lgtv-blocklist-app';

function loadBridge(options = {}) {
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
  if (options.withOverrides !== false) {
    vm.runInContext(overridesJs, context);
  }
  vm.runInContext(bridgeJs, context);
  return { bridge: context.LgBlocklistBridge, calls: calls, overrides: context.LgOverrides };
}

test('public API is exactly the fixed wrapper set — no generic exec', () => {
  const { bridge } = loadBridge();
  assert.deepEqual(
    Object.keys(bridge).sort(),
    [
      'available', 'clearOverrides', 'diagnose', 'getConfiguration', 'libVersion',
      'listOverrides', 'readHookState', 'registerHook', 'removeHook', 'runApply',
      'runCheck', 'runRollback', 'saveOverrides', 'setTierSafe', 'setTierStrict'
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
  // S6b T6: clear/list are ordinary constants and fit the same set. save is the
  // documented exception (a payload must be quoted and piped into overrides.sh),
  // and it is held to its own, stricter alphabet by the test below.
  bridge.clearOverrides(noop);
  bridge.listOverrides(noop);
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

// --- S6b T6: the domain toggles ---------------------------------------------

const CHANGE_KNOWN = ['lge.com', 'lgthinq.com'];
// The domains the UI renders, and the SAFE preset's blocked names, as shipped:
// the end-to-end test below picks its two rows out of these rather than
// hardcoding a name that a regenerated list could take away.
const DOMAIN_ROWS = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../app/filter/domains.json', import.meta.url)), 'utf8')
).map((row) => row.name);
const SAFE_BLOCKED = readFileSync(
  fileURLToPath(new URL('../../app/filter/filter-input-safe.txt', import.meta.url)),
  'utf8'
)
  .split('\n')
  .filter((line) => line.startsWith('='))
  .map((line) => line.slice(1));

// What the wrapper must compose: the payload quoted into the one command that
// carries data, plus the two verbs that carry none.
const SAVE_HEAD = "printf '%s' '";
const SAVE_TAIL = "' | sh " + APP_DIR + '/scripts/overrides.sh save';

function saveCommandFor(changes, knownNames) {
  const { bridge, calls } = loadBridge();
  bridge.saveOverrides(changes, knownNames, () => {});
  assert.equal(calls.length, 1, 'expected exactly one command');
  return calls[0].parameters.command;
}

test('clearOverrides / listOverrides send exactly the fixed overrides.sh commands', () => {
  const { bridge, calls } = loadBridge();
  bridge.clearOverrides(() => {});
  bridge.listOverrides(() => {});
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.uri, 'luna://org.webosbrew.hbchannel.service');
    assert.equal(call.method, 'exec');
  }
  assert.equal(calls[0].parameters.command, 'sh ' + APP_DIR + '/scripts/overrides.sh clear');
  assert.equal(calls[1].parameters.command, 'sh ' + APP_DIR + '/scripts/overrides.sh list');
});

test('saveOverrides sends the serialized payload between two fixed literals', () => {
  const command = saveCommandFor(
    [{ name: 'lgthinq.com', on: false }, { name: 'lge.com', on: true }],
    CHANGE_KNOWN
  );
  assert.equal(command, SAVE_HEAD + 'lgthinq.com=off\nlge.com=on\n' + SAVE_TAIL);
  // Nothing between the literals but the payload the serializer produced.
  assert.equal(command.slice(SAVE_HEAD.length, command.length - SAVE_TAIL.length), 'lgthinq.com=off\nlge.com=on\n');
});

test('the save command can only ever carry the accepted alphabet', () => {
  const command = saveCommandFor([{ name: 'lge.com', on: false }], CHANGE_KNOWN);
  const payload = command.slice(SAVE_HEAD.length, command.length - SAVE_TAIL.length);
  // Lines only, and every character inside [a-z0-9._-] plus '=' and LF: no quote,
  // backslash, space, '$', backtick, glob, ';', '|', '&', '<', '>' or CR can
  // appear, so the single quotes around the payload cannot be escaped.
  assert.match(payload, /^[a-z0-9._-]+=(on|off)(\n[a-z0-9._-]+=(on|off))*\n$/);
  assert.equal(/[^a-z0-9._\-=\n]/.test(payload), false);
  // The whole command: the literals (which do contain a quote and a pipe, by
  // design) plus that alphabet, and nothing else.
  assert.equal(/^[A-Za-z0-9 '%\/._&+=|\n-]+$/.test(command), true, command);
  for (const ch of ['"', '`', '$', '\\', ';', '>', '<', '(', ')', '*', '?', '~', '\t', '\r']) {
    assert.equal(command.includes(ch), false, 'the command must not contain ' + JSON.stringify(ch));
  }
});

test('a caller cannot smuggle anything into the save command: refused payloads are never sent', () => {
  const hostile = [
    [{ name: "lge.com' ; rm -rf /", on: true }],
    [{ name: 'lge.com=on\nrm -rf /', on: true }],
    [{ name: 'lge.com$(id)', on: true }],
    [{ name: 'lge.com`id`', on: true }],
    [{ name: 'lge.com | sh', on: true }],
    [{ name: 'lge.com\nlge.com=off', on: true }],
    [{ name: 'LGE.com', on: true }],
    [{ name: 'lge.com', on: true }, { name: 'lge.com', on: true }],
    [{ name: 'not-in-the-list.example', on: true }],
    [{ name: 'lge.com', on: 'on' }],
    [{ name: 'lge.com' }],
    [null],
    'lge.com=on\n',
    undefined,
    []
  ];
  for (const changes of hostile) {
    const { bridge, calls } = loadBridge();
    const seen = [];
    assert.doesNotThrow(() => {
      bridge.saveOverrides(changes, CHANGE_KNOWN, (response) => seen.push(response));
    }, 'must not throw for ' + JSON.stringify(changes));
    assert.equal(calls.length, 0, 'nothing may be sent for ' + JSON.stringify(changes));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].returnValue, false);
    assert.equal(typeof seen[0].errorText, 'string');
    assert.equal(seen[0].errorText.length > 0, true);
  }
});

test('an unknown-domain name is refused locally, so the writer never sees it', () => {
  const { bridge, calls } = loadBridge();
  const seen = [];
  bridge.saveOverrides([{ name: 'lge.com', on: false }, { name: 'zzz.example', on: false }], CHANGE_KNOWN, (r) => seen.push(r));
  assert.equal(calls.length, 0);
  assert.equal(seen[0].returnValue, false);
  assert.match(seen[0].errorText, /domain list/);
});

test('clear/list work without js/overrides.js; save refuses with an honest message', () => {
  // The payload validator is a separate script: if the package is incomplete the
  // destructive-free commands must still work, and save must never fall back to
  // sending something unvalidated.
  const { bridge, calls } = loadBridge({ withOverrides: false });
  bridge.clearOverrides(() => {});
  bridge.listOverrides(() => {});
  assert.equal(calls.length, 2);
  const seen = [];
  bridge.saveOverrides([{ name: 'lge.com', on: false }], CHANGE_KNOWN, (r) => seen.push(r));
  assert.equal(calls.length, 2, 'save must not send anything without the validator');
  assert.equal(seen[0].returnValue, false);
  assert.match(seen[0].errorText, /overrides\.js/);
});

test('the save/clear/list verbs are exactly the verbs overrides.sh accepts', () => {
  const arm = /^\s*(save\|clear\|list)\)/m.exec(overridesSh);
  assert.ok(arm !== null, 'overrides.sh has no fixed save|clear|list dispatch');
  const verbs = arm[1].split('|');
  for (const command of [
    saveCommandFor([{ name: 'lge.com', on: false }], CHANGE_KNOWN),
    'sh ' + APP_DIR + '/scripts/overrides.sh clear',
    'sh ' + APP_DIR + '/scripts/overrides.sh list'
  ]) {
    assert.equal(verbs.includes(command.slice(command.lastIndexOf(' ') + 1)), true, command);
  }
});

test('the composed save command runs and the real writer accepts its stdin', () => {
  // The end-to-end proof for the pipe + single quotes: nothing here is mocked
  // except the one path the bridge pins by design (the installed APP_DIR). The
  // sandbox state dir is the only writable location, exactly like on the TV.
  const appDir = fileURLToPath(new URL('../../app', import.meta.url)).replace(/\/$/, '');
  // Two shipped rows: one the SAFE preset blocks, one it does not. Filing the
  // first off and the second on makes the writer store BOTH kinds of line, so
  // the test also pins that the payload means what the UI meant by it.
  const blocked = SAFE_BLOCKED.filter((name) => DOMAIN_ROWS.includes(name))[0];
  const unblocked = DOMAIN_ROWS.filter((name) => !SAFE_BLOCKED.includes(name))[0];
  assert.equal(typeof blocked, 'string', 'no domains.json row is in the SAFE preset');
  assert.equal(typeof unblocked, 'string', 'every domains.json row is in the SAFE preset');
  const stateDir = mkdtempSync(join(tmpdir(), 'lgtvb-overrides-bridge-'));
  try {
    const command = saveCommandFor(
      [{ name: blocked, on: false }, { name: unblocked, on: true }],
      DOMAIN_ROWS
    );
    const runnable = command.split(APP_DIR).join(appDir);
    const stdout = execFileSync('sh', ['-c', runnable], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { LGTVB_STATE_DIR: stateDir })
    });
    assert.equal(stdout, 'RESULT=overrides\nreason=saved\n');
    const file = join(stateDir, 'overrides.txt');
    assert.equal(existsSync(file), true, 'the writer did not store a diff');
    // Diff only, against the active tier's preset (SAFE is the default this fresh
    // state dir starts in), in the writer's own '+name'/'-name' shape, sorted.
    assert.equal(readFileSync(file, 'utf8'), ['+' + unblocked, '-' + blocked].sort().join('\n') + '\n');
    // And the same bytes read back as the effective set, via the third verb.
    const listed = execFileSync('sh', ['-c', 'sh ' + appDir + '/scripts/overrides.sh list'], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { LGTVB_STATE_DIR: stateDir })
    });
    const rows = listed.split('\n').filter((line) => line !== '');
    assert.equal(rows.length, DOMAIN_ROWS.length);
    assert.equal(rows.includes(unblocked + '=on'), true);
    assert.equal(rows.includes(blocked + '=off'), true);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
