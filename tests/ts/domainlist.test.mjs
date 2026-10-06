// Unit tests for the domain list view's DOM-free half (app/js/domainlist.js):
// the join of `overrides.sh list` with the committed metadata module, the staged
// toggle model, the attention thresholds and the refusal copy. Run after
// `npm run build`:  npm run test:ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const domainsGenJs = readFileSync(
  fileURLToPath(new URL('../../app/js/domains.gen.js', import.meta.url)),
  'utf8'
);
const domainListJs = readFileSync(
  fileURLToPath(new URL('../../app/js/domainlist.js', import.meta.url)),
  'utf8'
);

// Same vm harness structure as status.test.mjs: the compiled scripts are plain
// scripts that assign globals, exactly as the TV loads them with <script> tags
// (domains.gen.js first — the view reads its rows).
function loadView() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(domainsGenJs, context);
  vm.runInContext(domainListJs, context);
  return { api: context.LgDomainList, domains: context.LgDomains };
}

// Names that pin every control kind the view distinguishes.
const SAFE_ROW = 'adsdtvc.com'; // tier=safe, no covering zone
const SAFE_ROW_2 = 'ad.lgappstv.com'; // tier=safe, no covering zone
const STRICT_ROW = 'bss.lgechannel.com'; // tier=strict, no covering zone
const ZONE_ROW = 'lgtvcommon.com'; // anchor (tier=zone)
const COVERED_ROW = 'cdpbeacon.lgtvcommon.com'; // covered by ZONE_ROW under STRICT

/** Exactly what `overrides.sh list` prints for a pristine tier preset. */
function presetList(domains, tier) {
  return domains.rows
    .map((row) => {
      const on = tier === 'strict' ? true : row.tier === 'safe';
      return row.name + '=' + (on ? 'on' : 'off');
    })
    .join('\n') + '\n';
}

function state(tier) {
  const { api, domains } = loadView();
  const states = api.parse(presetList(domains, tier));
  assert.ok(states, 'the preset list parses');
  return { api, domains, state: api.create(tier, states) };
}

function controlOf(s, name) {
  const row = s.api.row(s.state, name);
  assert.ok(row, 'row ' + name + ' exists');
  return row.control;
}

// The staged diff as plain host strings: the module's arrays come from the vm
// realm, so a cross-realm deepEqual would compare prototypes, not contents.
function changesOf(api, state) {
  const out = [];
  const changes = api.changes(state);
  for (let i = 0; i < changes.length; i++) {
    out.push(changes[i].name + '=' + (changes[i].on ? 'on' : 'off'));
  }
  return out;
}

test('parse accepts exactly the script\'s list and refuses everything else', () => {
  const { api, domains } = loadView();
  const good = presetList(domains, 'safe');
  assert.equal(Object.keys(api.parse(good)).length, domains.rows.length);
  // No trailing newline is fine too (the same bytes a `printf` without LF gives).
  assert.ok(api.parse(good.replace(/\n$/, '')));
  // Short, long, duplicated, unknown, malformed and CR-bearing lists are all
  // refused as a whole: the view never renders a partial join.
  const lines = good.trim().split('\n');
  assert.equal(api.parse(lines.slice(1).join('\n')), null, 'missing a row');
  assert.equal(api.parse(good + lines[0] + '\n'), null, 'one row too many');
  assert.equal(api.parse(lines[0] + '\n' + lines[0] + '\n'), null, 'duplicate row');
  assert.equal(api.parse(good.replace(/^[^=]+/, 'evil.example')), null, 'unknown name');
  assert.equal(api.parse(good.replace('=on', '=yes')), null, 'unknown state word');
  assert.equal(api.parse(good.replace(/\n/, '\r\n')), null, 'CR');
  assert.equal(api.parse(lines[0] + '=on=off\n'), null, 'two equals signs');
  assert.equal(api.parse(''), null);
  assert.equal(api.parse(null), null);
  assert.equal(api.parse(good.replace('=on', '=ON')), null, 'case matters');
});

test('the row set is the module\'s, in module order, joined 1:1 with the list', () => {
  const { api, domains } = loadView();
  const states = api.parse(presetList(domains, 'safe'));
  const view = api.create('safe', states);
  assert.equal(view.rows.length, domains.rows.length);
  for (let i = 0; i < domains.rows.length; i++) {
    assert.equal(view.rows[i].name, domains.rows[i].name);
    assert.equal(view.rows[i].baseline, domains.rows[i].tier === 'safe');
  }
  assert.equal(api.knownNames().length, domains.rows.length);
  assert.equal(api.knownNames().filter((n) => n === SAFE_ROW).length, 1);
  assert.deepEqual(api.presetEntries(), domains.presetEntries);
});

test('SAFE: safe rows toggle, STRICT-only rows and zone rows are informational', () => {
  const s = state('safe');
  assert.equal(controlOf(s, SAFE_ROW), 'toggle');
  assert.equal(controlOf(s, STRICT_ROW), 'info');
  assert.equal(controlOf(s, ZONE_ROW), 'info');
  // A SAFE row that a zone would cover under STRICT stays switchable under SAFE:
  // the SAFE preset ships no bare anchors, so nothing covers it there.
  assert.equal(controlOf(s, COVERED_ROW), 'toggle');
  // The informational rows explain why, in the app's own words.
  assert.ok(s.api.rowDetail('safe', s.api.row(s.state, STRICT_ROW)).includes('STRICT'));
  const zoneDetail = s.api.rowDetail('safe', s.api.row(s.state, ZONE_ROW));
  assert.ok(zoneDetail.includes('SAFE'), 'tier-aware zone warning');
  assert.ok(zoneDetail.includes(ZONE_ROW), 'and it names the row\'s own name');
});

test('STRICT: covered rows point at the zone, anchors are zone-level switches', () => {
  const s = state('strict');
  assert.equal(controlOf(s, STRICT_ROW), 'toggle');
  assert.equal(controlOf(s, COVERED_ROW), 'covered');
  assert.equal(controlOf(s, ZONE_ROW), 'toggle');
  assert.equal(s.api.row(s.state, COVERED_ROW).coveredBy, ZONE_ROW);
  assert.ok(s.api.rowDetail('strict', s.api.row(s.state, COVERED_ROW)).includes(ZONE_ROW));
  // A covered row is not switchable, and toggle() says so instead of changing it.
  assert.equal(s.api.toggle(s.state, COVERED_ROW), false);
  assert.equal(s.api.row(s.state, COVERED_ROW).on, true, 'unchanged');
  // The STRICT zone warning differs from the SAFE one and promises the blast
  // radius in its own words.
  const strictZone = s.api.zoneWarning('strict', ZONE_ROW);
  assert.notEqual(strictZone, s.api.zoneWarning('safe', ZONE_ROW));
  assert.ok(strictZone.includes(ZONE_ROW) && strictZone.includes('subtree'));
  // Turning the anchor off makes the rows it covered individually manageable —
  // status and control both come from the staged state.
  assert.equal(s.api.toggle(s.state, ZONE_ROW), true);
  assert.equal(controlOf(s, COVERED_ROW), 'toggle');
  assert.equal(s.api.row(s.state, COVERED_ROW).coveredBy, '');
});

test('staged toggles build a sparse diff of only the changed rows', () => {
  const s = state('safe');
  assert.deepEqual(changesOf(s.api, s.state), [], 'nothing staged → nothing to send');
  assert.equal(s.api.toggle(s.state, SAFE_ROW), true);
  assert.deepEqual(changesOf(s.api, s.state), [SAFE_ROW + '=off']);
  assert.equal(s.state.changedCount, 1);
  assert.equal(s.api.toggle(s.state, SAFE_ROW_2), true);
  // Module order, not toggle order: the same changes always serialize the same.
  assert.deepEqual(changesOf(s.api, s.state), [SAFE_ROW_2 + '=off', SAFE_ROW + '=off']);
  // Back to the reported value → the row drops out of the diff again.
  assert.equal(s.api.toggle(s.state, SAFE_ROW), true);
  assert.deepEqual(changesOf(s.api, s.state), [SAFE_ROW_2 + '=off']);
  // A fresh list that already reports the staged value is not a change either,
  // and a row the user did not touch follows the script.
  const next = parsePairs(s.domains, 'safe');
  next[SAFE_ROW_2] = false;
  s.api.applyList(s.state, next);
  assert.deepEqual(changesOf(s.api, s.state), []);
  // Unknown names and non-toggleable rows are no-ops.
  assert.equal(s.api.toggle(s.state, 'not-a-domain.example'), false);
  assert.equal(s.api.toggle(s.state, ZONE_ROW), false);
  assert.deepEqual(changesOf(s.api, s.state), []);
});

/** The same name→state map `parse` builds, for applyList() inputs. */
function parsePairs(domains, tier) {
  const map = Object.create(null);
  for (const row of domains.rows) {
    map[row.name] = tier === 'strict' ? true : row.tier === 'safe';
  }
  return map;
}

test('a staged edit survives a list refresh, an untouched row follows the script', () => {
  const s = state('safe');
  s.api.toggle(s.state, SAFE_ROW);
  // The TV now reports the row back off (somebody else applied it) and an
  // unrelated row on; the staged row keeps the user's value, the others follow.
  const next = parsePairs(s.domains, 'safe');
  next[SAFE_ROW] = false;
  next[STRICT_ROW] = true;
  s.api.applyList(s.state, next);
  assert.equal(s.api.row(s.state, SAFE_ROW).on, false);
  assert.equal(s.api.row(s.state, SAFE_ROW).baseline, false);
  assert.deepEqual(changesOf(s.api, s.state), [], 'the staged value is now the reported one');
  assert.equal(s.api.row(s.state, STRICT_ROW).on, true);
  assert.equal(s.api.row(s.state, STRICT_ROW).changed, false);
  // discardStages() (used by Reset) drops every staged edit.
  s.api.toggle(s.state, SAFE_ROW_2);
  assert.equal(s.state.changedCount, 1);
  s.api.discardStages(s.state);
  assert.equal(s.state.changedCount, 0);
  assert.deepEqual(changesOf(s.api, s.state), []);
});

test('tier changes re-derive coverage from the newly reported states', () => {
  const s = state('safe');
  assert.equal(s.state.tier, 'safe');
  assert.equal(controlOf(s, COVERED_ROW), 'toggle');
  assert.equal(controlOf(s, ZONE_ROW), 'info');
  // The switch is always followed by a fresh list (main.js re-reads it): the
  // same rows then join against the STRICT preset, where the anchor is on.
  s.api.setTier(s.state, 'strict');
  s.api.applyList(s.state, parsePairs(s.domains, 'strict'));
  assert.equal(controlOf(s, COVERED_ROW), 'covered');
  assert.equal(controlOf(s, STRICT_ROW), 'toggle');
  s.api.setTier(s.state, 'safe');
  s.api.applyList(s.state, parsePairs(s.domains, 'safe'));
  assert.equal(controlOf(s, COVERED_ROW), 'toggle');
  assert.equal(controlOf(s, STRICT_ROW), 'info');
});

test('attention: zero entries is the strongest state, below half is a notice', () => {
  const { api, domains } = loadView();
  assert.equal(domains.presetEntries.safe, 20);
  assert.equal(domains.presetEntries.strict, 123);
  // SAFE: 0 empty, 1..9 low (9*2 < 20), 10.. ok.
  assert.equal(api.attention(0, 'safe'), 'empty');
  assert.equal(api.attention(1, 'safe'), 'low');
  assert.equal(api.attention(9, 'safe'), 'low');
  assert.equal(api.attention(10, 'safe'), 'ok');
  assert.equal(api.attention(20, 'safe'), 'ok');
  // STRICT: half of 123 is 61.5, so 61 is still low and 62 is ok.
  assert.equal(api.attention(0, 'strict'), 'empty');
  assert.equal(api.attention(61, 'strict'), 'low');
  assert.equal(api.attention(62, 'strict'), 'ok');
  // The wording is the UI's own and names the count and the preset.
  const empty = api.attentionMessage('empty', 'safe', 0);
  assert.ok(empty.includes('0'));
  assert.ok(empty.includes('Nothing is blocked'), 'strongest wording: ' + empty);
  const low = api.attentionMessage('low', 'strict', 5);
  assert.ok(low.includes('5') && low.includes('123') && low.includes('STRICT'));
  assert.equal(api.attentionMessage('ok', 'strict', 123), '');
  // Nonsense counts never invent an alarm.
  assert.equal(api.attention(-1, 'safe'), 'ok');
  assert.equal(api.attention(NaN, 'safe'), 'ok');
});

test('every refusal reason gets its own sentence — never the script\'s text', () => {
  const { api } = loadView();
  const reasons = [
    'bad-usage', 'empty-payload', 'oversized', 'bad-shape', 'bad-charset',
    'name-too-long', 'unknown-domain', 'duplicate', 'reject-last', 'empty-list'
  ];
  const sentences = [];
  for (const reason of reasons) {
    const token = 'OVERRIDES-REJECT reason=' + reason +
      (reason === 'reject-last' ? ' tier=safe' : '');
    const message = api.refusalMessage(token + '\n');
    assert.notEqual(message, '', 'reason ' + reason + ' has its own message');
    assert.ok(!message.includes('OVERRIDES'), 'no token text in ' + reason);
    assert.ok(!message.includes(reason), 'the reason word is not rendered: ' + reason);
    assert.ok(!message.includes('reason='), 'no key=value text: ' + reason);
    sentences.push(message);
  }
  assert.equal(new Set(sentences).size, sentences.length, 'all sentences differ');
  // reject-last names WHICH preset would have been emptied: that is why the
  // writer sends the tier at all.
  const safe = api.refusalMessage('OVERRIDES-REJECT reason=reject-last tier=safe\n');
  const strict = api.refusalMessage('OVERRIDES-REJECT reason=reject-last tier=strict\n');
  const legacy = api.refusalMessage('OVERRIDES-REJECT reason=reject-last tier=legacy\n');
  const unknown = api.refusalMessage('OVERRIDES-REJECT reason=reject-last\n');
  assert.ok(safe.includes('SAFE') && !safe.includes('STRICT'));
  assert.ok(strict.includes('STRICT') && !strict.includes('SAFE'));
  assert.ok(legacy.includes('installed list') && legacy.includes('no SAFE/STRICT split'));
  assert.ok(!legacy.includes('the SAFE list') && !legacy.includes('the STRICT list'));
  assert.notEqual(unknown, '');
  assert.notEqual(new Set([safe, strict, legacy, unknown]).size, 1, 'the tiers differ');
  // The token may sit among other stderr lines, but not twice.
  assert.notEqual(api.refusalMessage('overrides-fail reason=X\nOVERRIDES-REJECT reason=oversized\n'), '');
  assert.equal(api.refusalMessage('OVERRIDES-REJECT reason=oversized\nOVERRIDES-REJECT reason=duplicate\n'), '');
  // No token, a partial token, an unknown reason word, a trailing CR inside the
  // line and a human message alone: all a fixed generic sentence or nothing.
  assert.equal(api.refusalMessage(''), '');
  assert.equal(api.refusalMessage('overrides-fail reason=write-failed\n'), '');
  assert.equal(api.refusalMessage('OVERRIDES-REJECT reason='), '');
  assert.equal(api.refusalMessage('OVERRIDES-REJECT tier=safe'), '');
  assert.notEqual(api.refusalMessage('OVERRIDES-REJECT reason=brand-new-reason\n'), '');
  assert.equal(api.refusalMessage('OVERRIDES-REJECT reason=oversized tier=safe\r\n'), '');
});

test('the save result is parsed strictly: RESULT=overrides plus a known reason', () => {
  const { api } = loadView();
  assert.equal(api.saveResult('RESULT=overrides\nreason=saved\n'), 'saved');
  assert.equal(api.saveResult('RESULT=overrides\nreason=cleared\n'), 'cleared');
  // The UI never restates a claim it could not parse.
  assert.equal(api.saveResult('RESULT=overrides\nreason=whatever\n'), null);
  assert.equal(api.saveResult('RESULT=tier\nreason=saved\n'), null);
  assert.equal(api.saveResult('reason=saved\n'), null);
  assert.equal(api.saveResult('RESULT=overrides\n'), null);
  assert.equal(api.saveResult('RESULT=overrides\nRESULT=overrides\nreason=saved\n'), null);
  assert.equal(api.saveResult('RESULT=overrides\nreason=saved\nreason=saved\n'), null);
  assert.equal(api.saveResult('RESULT=on\nreason=verified\n'), null);
  assert.equal(api.saveResult('RESULT=overrides\nreason=saved\r\n'), null);
  assert.equal(api.saveResult(''), null);
});

test('category labels come from the module and never drop a category', () => {
  const { api, domains } = loadView();
  const seen = new Set();
  for (const row of domains.rows) {
    const label = api.categoryLabel(row.category);
    assert.ok(label.length > 0, 'label for ' + row.category);
    seen.add(label);
  }
  assert.equal(seen.size, new Set(domains.rows.map((r) => r.category)).size);
  // An unknown slug is shown as itself rather than being swallowed.
  assert.equal(api.categoryLabel('future-category'), 'future-category');
});

test('state labels spell out the state instead of relying on color', () => {
  const s = state('safe');
  assert.equal(s.api.stateLabel(s.api.row(s.state, SAFE_ROW)), 'Blocked');
  s.api.toggle(s.state, SAFE_ROW);
  assert.equal(s.api.stateLabel(s.api.row(s.state, SAFE_ROW)), 'Allowed');
  // Covered and informational rows say so.
  const strict = state('strict');
  assert.ok(strict.api.stateLabel(strict.api.row(strict.state, COVERED_ROW)).includes(ZONE_ROW));
  assert.ok(s.api.stateLabel(s.api.row(s.state, STRICT_ROW)).includes('not in this tier'));
});

test('the view module is a plain-script global with no state of its own', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(domainsGenJs, context);
  vm.runInContext(domainListJs, context);
  assert.equal(typeof context.LgDomainList, 'object');
  assert.equal(typeof context.LgDomainList.parse, 'function');
  // Two views never share rows: staging in one cannot leak into the other.
  const states = context.LgDomainList.parse(presetList(context.LgDomains, 'safe'));
  const a = context.LgDomainList.create('safe', states);
  const b = context.LgDomainList.create('safe', states);
  context.LgDomainList.toggle(a, SAFE_ROW);
  assert.equal(a.changedCount, 1);
  assert.equal(b.changedCount, 0);
});
