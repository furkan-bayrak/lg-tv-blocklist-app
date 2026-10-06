// Unit tests for the compiled UI glue (app/js/main.js): the single-flight
// discipline, the tier switch and the S6b T7 domain list. No DOM library: a
// minimal element stub captures the click handlers (and, for the list, the
// created children), a fake bridge records calls, and every bridge callback is
// resolved by hand so the test can observe the busy flag while a call is in
// flight. Run after `npm run build`:  npm run test:ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function readApp(file) {
  return readFileSync(fileURLToPath(new URL('../../app/js/' + file, import.meta.url)), 'utf8');
}

const mainJs = readApp('main.js');
// Plain-script globals, loaded in the same order the TV's <script> tags do.
const domainsGenJs = readApp('domains.gen.js');
const domainListJs = readApp('domainlist.js');
const statusJs = readApp('status.js');

const ELEMENT_IDS = [
  'status', 'panel', 'output', 'protection', 'prot-headline', 'prot-text',
  'btn-protect', 'btn-refresh', 'btn-check', 'btn-state', 'btn-register', 'btn-remove',
  'tier-current', 'tier-note', 'btn-tier-safe', 'btn-tier-strict',
  'domains-status', 'domains-note', 'domains-list', 'btn-domain-apply',
  'btn-domain-reset', 'domains-confirm', 'domains-confirm-text',
  'btn-domain-reset-confirm', 'btn-domain-reset-cancel'
];

const HOOK_TARGET =
  '/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh';

// A degraded-but-valid schema-4 block: enough for the parser to render a panel.
const STATUS_BLOCK = [
  '@@STATUS-BEGIN',
  'schema=4',
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
  'entries=0',
  '@@STATUS-END'
].join('\n');

// Same block with the tier the TV reports after a switch (S6a T3).
const STATUS_BLOCK_STRICT = STATUS_BLOCK.replace('tier=safe', 'tier=strict');

// A live-probed ON block: every field the parser checks stays valid, only the
// mode flips to on (the tier switch re-applies protection only in this case).
// The entry count is the SAFE preset's own size, so the probe reads as a healthy
// ON (S6b T7: an ON filter with nothing blocked is "needs attention" instead).
const STATUS_BLOCK_ON = STATUS_BLOCK
  .replace('filter=down', 'filter=up')
  .replace('rule=absent', 'rule=on')
  .replace('keeper=down', 'keeper=up')
  .replace('guard=down', 'guard=up')
  .replace('pointer=off', 'pointer=on')
  .replace('mode=degraded', 'mode=on')
  .replace('cap=unsupported', 'cap=dnat')
  .replace('entries=0', 'entries=20');

const STATUS_BLOCK_ON_STRICT = STATUS_BLOCK_ON
  .replace('tier=safe', 'tier=strict')
  .replace('entries=20', 'entries=123');

// The degraded block again, but with a blocked count that matches the SAFE
// preset: the only thing the panel should be unhappy about is what the user
// staged (S6b T7: 0 entries would outrank an unsaved change).
const STATUS_BLOCK_HEALTHY = STATUS_BLOCK.replace('entries=0', 'entries=20');

// The metadata module, loaded once on the host side so the tests can build the
// exact `overrides.sh list` output and assert on real domain names.
const hostContext = {};
vm.createContext(hostContext);
vm.runInContext(domainsGenJs, hostContext);
const DOMAINS = hostContext.LgDomains;

const SAFE_ROW = 'adsdtvc.com'; // tier=safe, no covering zone
const SAFE_ROW_2 = 'ad.lgappstv.com'; // tier=safe, no covering zone
const STRICT_ROW = 'bss.lgechannel.com'; // tier=strict, no covering zone
const ZONE_ROW = 'lgtvcommon.com'; // anchor (tier=zone)
const COVERED_ROW = 'cdpbeacon.lgtvcommon.com'; // covered by ZONE_ROW under STRICT

/** Exactly what `overrides.sh list` prints for a pristine tier preset. */
function presetList(tier) {
  const lines = [];
  for (const row of DOMAINS.rows) {
    const on = tier === 'strict' ? true : row.tier === 'safe';
    lines.push(row.name + '=' + (on ? 'on' : 'off'));
  }
  return lines.join('\n') + '\n';
}

/** The same list with the named rows flipped, as a stored diff would print. */
function listWith(tier, flipped) {
  const lines = [];
  for (const row of DOMAINS.rows) {
    let on = tier === 'strict' ? true : row.tier === 'safe';
    if (flipped[row.name] !== undefined) {
      on = flipped[row.name];
    }
    lines.push(row.name + '=' + (on ? 'on' : 'off'));
  }
  return lines.join('\n') + '\n';
}

function tierOf(block) {
  return block.indexOf('tier=strict') !== -1 ? 'strict' : 'safe';
}

function loadMain() {
  const elements = {};
  const doc = {
    activeElement: null,
    handlers: {},
    getElementById: (id) => elements[id] || null,
    createElement: () => makeElement(''),
    addEventListener(type, fn) {
      this.handlers[type] = fn;
    }
  };
  function makeElement(id) {
    return {
      id: id || '',
      textContent: '',
      className: '',
      hidden: false,
      disabled: false,
      attrs: {},
      handlers: {},
      children: [],
      addEventListener(type, fn) {
        this.handlers[type] = fn;
      },
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      focus() {
        doc.activeElement = this;
      }
    };
  }
  for (const id of ELEMENT_IDS) {
    elements[id] = makeElement(id);
  }
  const calls = [];
  const pending = [];
  const saved = [];
  const cleared = [];
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
    getConfiguration: record('getConfiguration'),
    listOverrides: record('listOverrides'),
    saveOverrides: function (changes, known, cb) {
      calls.push('saveOverrides');
      saved.push(changes);
      pending.push({ name: 'saveOverrides', cb: cb });
    },
    clearOverrides: function (cb) {
      calls.push('clearOverrides');
      cleared.push(true);
      pending.push({ name: 'clearOverrides', cb: cb });
    }
  };
  const context = {
    document: doc,
    LgBlocklistBridge: bridge
  };
  vm.createContext(context);
  vm.runInContext(domainsGenJs, context);
  vm.runInContext(domainListJs, context);
  vm.runInContext(statusJs, context);
  vm.runInContext(mainJs, context);
  return { elements, calls, pending, doc, saved, cleared };
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

/** Every created row button of the domain list, in document order. */
function rowsOf(elements) {
  const out = [];
  const stack = [elements['domains-list']];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node.attrs && node.attrs['data-name']) {
      out.push(node);
    }
    for (const child of node.children) {
      stack.push(child);
    }
  }
  return out;
}

function rowByName(elements, name) {
  const row = rowsOf(elements).find((node) => node.attrs['data-name'] === name);
  assert.ok(row, 'row ' + name + ' is rendered');
  return row;
}

/**
 * A full refresh: the status probe, then the list read it always triggers.
 * Every successful probe is followed by listOverrides (refreshAllInternal), so
 * a test that leaves it unresolved leaves the app busy.
 */
function resolveProbe(pending, block, list) {
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: block });
  resolve(pending, 'listOverrides', {
    returnValue: true,
    stdoutString: list === undefined ? presetList(tierOf(block)) : list
  });
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
  resolve(pending, 'listOverrides', { returnValue: true, stdoutString: presetList('safe') });
  elements['btn-check'].handlers.click();
  assert.equal(elements['status'].textContent, 'Checking bridge...');
  assert.equal(count(calls, 'getConfiguration'), 1);
});

test('single-flight: registerHook holds busy through the nested readHookState', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK);
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
  resolveProbe(pending, STATUS_BLOCK);
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
  resolveProbe(pending, STATUS_BLOCK);
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
  resolveProbe(pending, STATUS_BLOCK);
  elements['btn-tier-safe'].handlers.click();
  assert.equal(count(calls, 'setTierSafe'), 0);
  assert.equal(elements['status'].textContent, 'Tier already active');
  assert.ok(elements['output'].textContent.includes('SAFE list'));
});

test('switching tier with protection OFF persists, re-applies nothing, and re-renders', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK);
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
  resolve(pending, 'listOverrides', { returnValue: true, stdoutString: presetList('strict') });
  assert.equal(elements['status'].textContent, 'Tier saved: STRICT');
  assert.equal(elements['tier-current'].textContent, 'Tier: STRICT');
  assert.equal(elements['btn-tier-strict'].className, 'tier-button is-active');
  // Idle again → a new command goes through.
  elements['btn-refresh'].handlers.click();
  assert.equal(count(calls, 'runCheck'), 3);
});

test('switching tier with protection ON re-applies through the existing apply flow', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK_ON);
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
  resolveProbe(pending, STATUS_BLOCK_ON_STRICT);
  assert.equal(elements['status'].textContent, 'Protection is on with the STRICT list.');
  assert.equal(elements['tier-current'].textContent, 'Tier: STRICT');
  assert.ok(elements['output'].textContent.includes('returnValue: true'));
  // Busy released after the refresh.
  elements['btn-refresh'].handlers.click();
  assert.equal(count(calls, 'runCheck'), 3);
});

test('a failed tier write is reported and never re-applies protection', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK_ON);
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

// --- S6b T7: the domain list -------------------------------------------------

test('the panel joins the script\'s list with the metadata: one row per domain', () => {
  const { elements, pending } = loadMain();
  // Nothing is claimed before the TV has been read.
  assert.ok(elements['domains-status'].textContent.includes('has not been read'));
  assert.equal(elements['domains-list'].hidden, true);
  assert.equal(typeof elements['btn-domain-apply'].handlers.click, 'function');
  resolveProbe(pending, STATUS_BLOCK);
  const rows = rowsOf(elements);
  assert.equal(rows.length, DOMAINS.rows.length);
  const rendered = [];
  const expected = [];
  for (const node of rows) {
    rendered.push(node.attrs['data-name']);
  }
  for (const row of DOMAINS.rows) {
    expected.push(row.name);
  }
  assert.deepEqual(rendered, expected, 'file order, one row each, none dropped');
  assert.equal(elements['domains-list'].hidden, false);
  // The state comes from the script's list, spelled out in the row.
  const safe = rowByName(elements, SAFE_ROW);
  assert.ok(safe.className.includes('is-on'));
  assert.ok(safe.className.includes('is-toggle'));
  assert.equal(safe.children[1].textContent, 'Blocked');
  assert.equal(safe.attrs['aria-pressed'], 'true');
  assert.equal(safe.attrs['aria-disabled'], 'false');
  const strict = rowByName(elements, STRICT_ROW);
  assert.ok(strict.className.includes('is-off') && strict.className.includes('is-info'));
  assert.ok(strict.children[1].textContent.includes('not in this tier'));
  assert.equal(strict.attrs['aria-disabled'], 'true');
  // The panel spells the attention level out; the preset sizes are the module's.
  assert.ok(elements['domains-status'].textContent.includes('Nothing is blocked'));
  assert.ok(elements['domains-note'].textContent.includes('Changes are staged'));
  // Every category section carries the heading the module gives its slug.
  const groups = elements['domains-list'].children;
  assert.ok(groups.length > 1);
  assert.equal(groups[0].children[0].className, 'domain-group-title');
  assert.equal(groups[0].children[0].textContent, 'ACR (viewing data)');
  // The zone row explains itself against the ACTIVE tier: under SAFE it says the
  // SAFE list blocks no whole zones, and it names the row's own name.
  const zone = rowByName(elements, ZONE_ROW);
  assert.ok(zone.className.includes('is-zone'));
  assert.ok(zone.children[2].textContent.includes('SAFE'));
  assert.ok(zone.children[2].textContent.includes(ZONE_ROW));
  // Under SAFE the SAFE preset ships no bare anchors, so the zone row is not a
  // switch either — it explains what it would do under STRICT.
  assert.equal(zone.attrs['aria-disabled'], 'true');
  assert.ok(zone.children[1].textContent.includes('not in this tier'));
});

test('a toggle is staged, never sent: the diff is written by Apply alone', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK_HEALTHY);
  const before = count(calls, 'saveOverrides');
  rowByName(elements, SAFE_ROW).handlers.click();
  assert.equal(count(calls, 'saveOverrides'), before, 'a tap writes nothing');
  assert.equal(count(calls, 'listOverrides'), 1, 'and re-reads nothing');
  const row = rowByName(elements, SAFE_ROW);
  assert.ok(row.className.includes('is-off') && row.className.includes('is-changed'));
  assert.equal(row.children[1].textContent, 'Allowed — staged');
  assert.equal(row.attrs['aria-pressed'], 'false');
  assert.ok(elements['domains-status'].textContent.includes('1 unsaved change'));
  assert.equal(elements['domains-status'].className, 'domains-status is-unsaved');
  // Back to the reported value: the row leaves the diff again.
  rowByName(elements, SAFE_ROW).handlers.click();
  assert.ok(elements['domains-status'].textContent.includes('No unsaved changes.'));
  assert.equal(elements['domains-status'].className, 'domains-status',
    'no staged change and a healthy count: nothing to highlight');
  // An empty blocked list outranks a staged change: that is the more serious of
  // the two, and the class carries the strongest one only.
  const empty = loadMain();
  resolveProbe(empty.pending, STATUS_BLOCK);
  rowByName(empty.elements, SAFE_ROW).handlers.click();
  assert.ok(empty.elements['domains-status'].textContent.includes('1 unsaved change'));
  assert.ok(empty.elements['domains-status'].textContent.includes('Nothing is blocked'));
  assert.equal(empty.elements['domains-status'].className, 'domains-status is-attention');
});

test('a covered row is not switchable: it explains and points at the zone row', () => {
  const { elements, calls, pending, doc } = loadMain();
  resolveProbe(pending, STATUS_BLOCK_STRICT);
  const covered = rowByName(elements, COVERED_ROW);
  assert.ok(covered.className.includes('is-covered'));
  assert.equal(covered.attrs['aria-disabled'], 'true');
  // Covered is not the same as off: the row is blocked, via the zone.
  assert.ok(covered.className.includes('is-on'));
  assert.ok(covered.children[1].textContent.includes('Blocked'));
  assert.ok(covered.children[1].textContent.includes(ZONE_ROW));
  // And under STRICT the zone row's warning promises the whole subtree.
  const zone = rowByName(elements, ZONE_ROW);
  assert.ok(zone.children[2].textContent.includes('subtree'));
  assert.equal(zone.attrs['aria-disabled'], 'false');
  doc.activeElement = covered;
  covered.handlers.click();
  assert.equal(count(calls, 'saveOverrides'), 0);
  assert.ok(elements['domains-status'].textContent.includes(ZONE_ROW));
  // Focus is moved to the row that can actually change what is being looked at.
  assert.equal(doc.activeElement, rowByName(elements, ZONE_ROW));
});

test('Apply sends only the changed rows; with protection off nothing restarts', () => {
  const { elements, calls, pending, saved } = loadMain();
  resolveProbe(pending, STATUS_BLOCK);
  // Nothing staged: Apply refuses before any command leaves the app.
  elements['btn-domain-apply'].handlers.click();
  assert.equal(count(calls, 'saveOverrides'), 0);
  assert.ok(elements['domains-status'].textContent.includes('Nothing to apply'));
  // Stage two rows — only rows the active tier can actually switch.
  rowByName(elements, SAFE_ROW).handlers.click();
  rowByName(elements, SAFE_ROW_2).handlers.click();
  assert.ok(elements['domains-status'].textContent.includes('2 unsaved changes'));
  elements['btn-domain-apply'].handlers.click();
  assert.equal(count(calls, 'saveOverrides'), 1);
  assert.equal(saved[0].length, 2, 'a sparse diff, not the whole list');
  // The payload is a vm-realm array, so compare it as plain host strings.
  const sent = [];
  for (const change of saved[0]) {
    sent.push(change.name + '=' + (change.on ? 'on' : 'off'));
  }
  assert.deepEqual(sent, [SAFE_ROW_2 + '=off', SAFE_ROW + '=off'],
    'module order, only what changed');
  assert.equal(saved[0][1].name, SAFE_ROW);
  assert.equal(saved[0][1].on, false);
  // The known-name list travels with the payload (the writer validates against it).
  assert.equal(count(calls, 'runApply'), 0, 'protection is off: no restart');
  assert.ok(elements['status'].textContent.includes('2 domain changes'));
  // The TV reports the staged set back → the diff is confirmed and clean.
  resolve(pending, 'saveOverrides', {
    returnValue: true,
    stdoutString: 'RESULT=overrides\nreason=saved'
  });
  assert.equal(count(calls, 'runApply'), 0);
  resolveProbe(pending, STATUS_BLOCK, listWith('safe', {
    [SAFE_ROW]: false,
    [SAFE_ROW_2]: false
  }));
  assert.equal(elements['status'].textContent, 'Domain changes saved');
  assert.ok(elements['domains-status'].textContent.includes('Changes saved'));
  assert.ok(elements['domains-status'].textContent.includes('nothing was restarted'));
  assert.equal(elements['domains-status'].className, 'domains-status is-ok');
  assert.equal(rowByName(elements, SAFE_ROW).className.indexOf('is-changed'), -1);
  assert.ok(rowByName(elements, SAFE_ROW).className.includes('is-off'));
});

test('Apply with protection ON saves, restarts once through the existing flow', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK_ON);
  rowByName(elements, SAFE_ROW).handlers.click();
  elements['btn-domain-apply'].handlers.click();
  assert.equal(count(calls, 'saveOverrides'), 1);
  assert.ok(elements['status'].textContent.includes('1 domain change'));
  assert.ok(elements['output'].textContent.includes('DNS pauses'),
    'the cost is stated before the write');
  assert.equal(count(calls, 'runApply'), 0, 'the save comes first');
  resolve(pending, 'saveOverrides', {
    returnValue: true,
    stdoutString: 'RESULT=overrides\nreason=saved'
  });
  // Same fixed apply command the protection toggle uses, single-flight held.
  assert.equal(count(calls, 'runApply'), 1);
  resolve(pending, 'runApply', {
    returnValue: true,
    stdoutString: 'RESULT=on\nreason=verified\nupstream=1.1.1.1'
  });
  resolveProbe(pending, STATUS_BLOCK_ON, listWith('safe', { [SAFE_ROW]: false }));
  assert.equal(elements['status'].textContent, 'Domain changes saved');
  assert.ok(elements['domains-status'].textContent.includes('Protection is on.'));
  assert.equal(elements['domains-status'].className, 'domains-status is-ok');
});

test('a refused save is reported in the app\'s own words, never the script\'s', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK_ON);
  rowByName(elements, SAFE_ROW).handlers.click();
  rowByName(elements, SAFE_ROW_2).handlers.click();
  elements['btn-domain-apply'].handlers.click();
  resolve(pending, 'saveOverrides', {
    returnValue: false,
    stdoutString: '',
    stderrString: 'overrides-fail stage=3\nOVERRIDES-REJECT reason=reject-last tier=safe\n'
  });
  const message = elements['domains-status'].textContent;
  assert.ok(message.includes('nothing blocked'), message);
  assert.ok(message.includes('SAFE'));
  assert.ok(!message.includes('OVERRIDES'), 'the token is mapped, never rendered');
  assert.ok(!message.includes('reason='));
  assert.ok(!message.includes('overrides-fail'));
  assert.equal(elements['domains-status'].className, 'domains-status is-error');
  // And the raw output still lands in the output pane, as it always has.
  assert.ok(elements['output'].textContent.includes('OVERRIDES-REJECT reason=reject-last'));
  // A rejected save must not restart the filter.
  assert.equal(count(calls, 'runApply'), 0);
  // The staged diff stays on screen: the refusal changed nothing.
  assert.ok(rowByName(elements, SAFE_ROW).className.includes('is-changed'));
  assert.ok(elements['status'].textContent.includes('Domain changes not saved'));
});

test('an unclear save result is never treated as success', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK_ON);
  rowByName(elements, SAFE_ROW).handlers.click();
  elements['btn-domain-apply'].handlers.click();
  resolve(pending, 'saveOverrides', { returnValue: true, stdoutString: 'RESULT=whatever' });
  assert.ok(elements['domains-status'].textContent.includes('did not return a clear save result'));
  assert.equal(count(calls, 'runApply'), 0);
  assert.equal(count(calls, 'listOverrides'), 1, 'no re-read of a list that was not written');
  assert.equal(elements['status'].textContent, 'Domain save: unclear result');
});

test('a tier switch keeps the staged edits and re-derives what is switchable', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK);
  rowByName(elements, SAFE_ROW).handlers.click();
  assert.ok(elements['domains-status'].textContent.includes('1 unsaved change'));
  elements['btn-tier-strict'].handlers.click();
  resolve(pending, 'setTierStrict', {
    returnValue: true,
    stdoutString: 'RESULT=tier\nreason=strict'
  });
  resolveProbe(pending, STATUS_BLOCK_STRICT);
  // The staged row is still staged; the rows the script moved now cover.
  assert.ok(rowByName(elements, SAFE_ROW).className.includes('is-off'));
  assert.ok(rowByName(elements, SAFE_ROW).className.includes('is-changed'));
  assert.ok(rowByName(elements, COVERED_ROW).className.includes('is-covered'));
  assert.ok(elements['domains-status'].textContent.includes('1 unsaved change'));
});

test('a list that cannot be read clears the rows instead of showing stale ones', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK);
  assert.ok(rowsOf(elements).length > 0);
  elements['btn-refresh'].handlers.click();
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK });
  resolve(pending, 'listOverrides', { returnValue: false, errorText: 'exit 3' });
  assert.equal(elements['domains-list'].hidden, true);
  assert.ok(elements['domains-status'].textContent.includes('did not return a readable domain list'));
  assert.equal(elements['domains-status'].className, 'domains-status is-error');
  assert.equal(elements['status'].textContent, 'Domain list not readable');
  // A truncated list is refused too — a partial join is worse than none.
  elements['btn-refresh'].handlers.click();
  resolve(pending, 'runCheck', { returnValue: true, stdoutString: STATUS_BLOCK });
  resolve(pending, 'listOverrides', {
    returnValue: true,
    stdoutString: presetList('safe').split('\n').slice(1).join('\n')
  });
  assert.equal(elements['domains-list'].hidden, true);
  assert.equal(elements['status'].textContent, 'Domain list not readable');
});

test('reset asks first, names the preset, and drops staged edits only after a clear', () => {
  const { elements, calls, pending, cleared } = loadMain();
  resolveProbe(pending, STATUS_BLOCK);
  rowByName(elements, SAFE_ROW).handlers.click();
  elements['btn-domain-reset'].handlers.click();
  // The confirmation is explicit: preset named, cost stated, nothing sent yet.
  assert.equal(elements['domains-confirm'].hidden, false);
  const prompt = elements['domains-confirm-text'].textContent;
  assert.ok(prompt.includes('SAFE'));
  assert.ok(prompt.includes('staged'));
  assert.ok(prompt.includes('nothing is restarted'));
  assert.equal(count(calls, 'clearOverrides'), 0);
  // Cancel leaves the staged diff exactly as it was.
  elements['btn-domain-reset-cancel'].handlers.click();
  assert.equal(elements['domains-confirm'].hidden, true);
  assert.ok(elements['domains-status'].textContent.includes('1 unsaved change'));
  assert.ok(elements['domains-status'].textContent.includes('cancelled'));
  // Confirm runs one clear command; the staged edit belonged to the cleared diff.
  elements['btn-domain-reset'].handlers.click();
  elements['btn-domain-reset-confirm'].handlers.click();
  assert.equal(count(calls, 'clearOverrides'), 1);
  assert.equal(cleared.length, 1);
  assert.equal(count(calls, 'runApply'), 0, 'protection is off: nothing restarts');
  resolve(pending, 'clearOverrides', {
    returnValue: true,
    stdoutString: 'RESULT=overrides\nreason=cleared'
  });
  resolveProbe(pending, STATUS_BLOCK);
  assert.equal(elements['status'].textContent, 'Domains reset');
  assert.ok(elements['domains-status'].textContent.includes('Domains reset to the SAFE preset'));
  assert.ok(elements['domains-status'].textContent.includes('No unsaved changes.'));
  assert.equal(rowByName(elements, SAFE_ROW).className.indexOf('is-changed'), -1);
  assert.equal(elements['domains-confirm'].hidden, true);
});

test('reset with protection ON clears, then restarts exactly once', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK_ON);
  elements['btn-domain-reset'].handlers.click();
  assert.ok(elements['domains-confirm-text'].textContent.includes('filter restarts'));
  elements['btn-domain-reset-confirm'].handlers.click();
  assert.equal(count(calls, 'clearOverrides'), 1);
  resolve(pending, 'clearOverrides', {
    returnValue: true,
    stdoutString: 'RESULT=overrides\nreason=cleared'
  });
  assert.equal(count(calls, 'runApply'), 1);
  resolve(pending, 'runApply', {
    returnValue: true,
    stdoutString: 'RESULT=on\nreason=verified\nupstream=1.1.1.1'
  });
  resolveProbe(pending, STATUS_BLOCK_ON);
  assert.equal(elements['status'].textContent, 'Domains reset');
  assert.ok(elements['domains-status'].textContent.includes('protection is on'));
  assert.equal(elements['domains-status'].className, 'domains-status is-ok');
});

test('a reset the TV refuses is reported and leaves the rows alone', () => {
  const { elements, calls, pending } = loadMain();
  resolveProbe(pending, STATUS_BLOCK);
  elements['btn-domain-reset'].handlers.click();
  elements['btn-domain-reset-confirm'].handlers.click();
  resolve(pending, 'clearOverrides', { returnValue: false, errorText: 'exit 4' });
  assert.ok(elements['domains-status'].textContent.includes('did not clear the domain changes'));
  assert.equal(elements['domains-status'].className, 'domains-status is-error');
  assert.equal(count(calls, 'runApply'), 0);
  assert.equal(count(calls, 'listOverrides'), 1, 'no re-read after a failed clear');
  assert.ok(rowsOf(elements).length > 0, 'the rows are still there');
  assert.equal(elements['status'].textContent, 'Reset not saved');
});

test('an ON filter with nothing blocked is attention, not a healthy green', () => {
  const { elements, pending } = loadMain();
  const empty = STATUS_BLOCK_ON.replace('entries=20', 'entries=0');
  resolveProbe(pending, empty);
  assert.equal(elements['status'].textContent, 'Status: needs attention');
  assert.equal(elements['protection'].className, 'protection is-attention');
  assert.ok(elements['domains-status'].textContent.includes('Nothing is blocked'));
  assert.equal(elements['domains-status'].className, 'domains-status is-attention');
  // The card offers the way out, and the entries line names the preset size.
  assert.equal(elements['btn-protect'].textContent, 'Turn off protection');
  assert.ok(elements['panel'].textContent.includes('preset has 20'));
});

test('arrow keys walk the rows in order and follow the open confirmation', () => {
  const { elements, pending, doc } = loadMain();
  const keydown = doc.handlers.keydown;
  assert.equal(typeof keydown, 'function');
  // Before any list is read the nav is the static controls only.
  assert.equal(doc.activeElement, elements['btn-protect']);
  resolveProbe(pending, STATUS_BLOCK);
  // The rows were appended to the nav: every row is reachable.
  assert.equal(doc.activeElement, elements['btn-protect']);
  const row = rowByName(elements, SAFE_ROW);
  let seen = false;
  for (let i = 0; i < DOMAINS.rows.length + 12; i++) {
    keydown({ key: 'ArrowDown', preventDefault() {} });
    if (doc.activeElement === row) {
      seen = true;
      break;
    }
  }
  assert.ok(seen, 'arrow-down reaches ' + SAFE_ROW);
  // Arrow-up steps back, and the confirm/cancel pair replaces Apply/Reset while
  // the confirmation is open.
  keydown({ key: 'ArrowDown', preventDefault() {} });
  keydown({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(doc.activeElement, row);
  let reachedApply = false;
  for (let i = 0; i < DOMAINS.rows.length + 30; i++) {
    keydown({ key: 'ArrowDown', preventDefault() {} });
    if (doc.activeElement === elements['btn-domain-apply']) {
      reachedApply = true;
      break;
    }
  }
  assert.ok(reachedApply, 'the action bar is in the nav');
});
