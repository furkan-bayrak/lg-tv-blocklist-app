/*
 * S6b T7: the domain list view's decisions — with no DOM in it.
 *
 * The view is driven by EXACTLY two sources and nothing else:
 *
 *  1. `overrides.sh list` (through LgBlocklistBridge.listOverrides) is the state
 *     of the world: one `name=on|off` line per domain row, in domains.json order,
 *     already the active tier's preset with the stored overrides applied. The UI
 *     never recomputes the effective set locally — it renders what the script
 *     reports.
 *  2. src/domains.gen.ts (global LgDomains, compiled into the bundle) is the
 *     metadata: name, tier, category, covering zone, anchor flag and display
 *     note for the same 115 rows, plus each tier's preset ENTRY count.
 *
 * `parse()` holds the script's output to the module's own row set — every row
 * once, `name=on|off` only, no duplicates, no extra names — so a `list` output
 * the UI cannot join totally is an error, never a partially rendered guess.
 *
 * What a row can do (S6b T7 + the plan's "covered by a zone" rule):
 *   - toggle  : a real on/off switch the user may flip (staged, never sent per
 *               toggle — main.ts batches them into one Apply).
 *   - covered : the row's `zone` names a zone ANCHOR row that is effectively ON,
 *               and the active tier is STRICT. Whole-subtree blocking is a
 *               bare-anchor property of the STRICT preset, so while the anchor
 *               is on the zone decides this domain and flipping the row's own
 *               exact rule would not change what the TV blocks. The row points
 *               at the zone row instead.
 *   - info    : the row is not part of the active preset at all. Under SAFE that
 *               is every STRICT-only row: it is shown (with its note) but not
 *               switched — the SAFE list is the 20 rows it ships. Under STRICT
 *               every non-anchor row is in the preset, so `info` cannot occur
 *               there.
 * A zone anchor row is a `toggle` in BOTH tiers (S6b T7 review F2): under STRICT
 * switching it on blocks the whole subtree, under SAFE it adds only that name's
 * exact apex rule (the SAFE preset ships no bare anchor) — the row's own note and
 * the tier-aware zone warning say exactly which is which. Coverage stays a
 * STRICT-only property, so a SAFE zone row never makes other rows `covered`.
 * Coverage is recomputed from the STAGED state, so turning a zone row off makes
 * the rows it covers individually manageable without another round trip.
 *
 * Attention thresholds (S6b review F3, owner decision): the schema-4 `entries=`
 * count check.sh reports is the number of blocked_names ENTRIES in the
 * materialized list, and LgDomains.presetEntries holds the same kind of count
 * for each tier's preset (safe 20, strict 123), so the two are directly
 * comparable. Exactly two thresholds exist, no more:
 *   entries === 0                     -> 'empty' : nothing is blocked right now.
 *   entries * 2 < presetEntries(tier) -> 'low'   : under half of the preset.
 *   entries not a finite, >= 0 number -> 'unknown': the count could not be read,
 *                                       so it is never reported as healthy.
 * Anything else is 'ok'. A one-entry list is a legitimate debug state and stays
 * a visible warning, never a refusal (the writers accept it by design).
 *
 * Refusals: overrides.sh answers a rejected save with rc 2 plus ONE machine
 * line on stderr, `OVERRIDES-REJECT reason=<reason>[ tier=<safe|strict|legacy>]`
 * (materialize_config emits the sibling `reason=empty-list`). The UI maps every
 * reason to ITS OWN sentence and never renders the script's text as a message;
 * `reject-last` is the reason the tier field exists — it has to name the preset
 * that would have been emptied, and `legacy` is a real answer on a pre-tier
 * install. An unrecognised reason still gets a fixed sentence.
 *
 * Plain script, not a module: the TV loads compiled JS with plain <script> tags,
 * so the emitted file must stay CommonJS-free. Same pattern as src/bridge.ts,
 * src/status.ts and src/overrides.ts — one IIFE assigned to a global.
 */

type LgDomainTier = 'safe' | 'strict';
type LgDomainControl = 'toggle' | 'covered' | 'info';
type LgDomainAttention = 'ok' | 'low' | 'empty' | 'unknown';

interface LgDomainRowView {
  name: string;
  tier: 'safe' | 'strict' | 'zone';
  category: string;
  zone: string;
  anchor: boolean;
  note: string;
  // What `list` reported for this row, and the user's staged value on top.
  baseline: boolean;
  on: boolean;
  changed: boolean;
  control: LgDomainControl;
  coveredBy: string; // '' unless control === 'covered'
}

interface LgDomainState {
  tier: LgDomainTier;
  rows: LgDomainRowView[];
  byName: { [name: string]: LgDomainRowView };
  onCount: number;
  changedCount: number;
}

interface LgDomainListApi {
  available(): boolean;
  knownNames(): string[];
  presetEntries(): { safe: number; strict: number };
  parse(raw: string): { [name: string]: boolean } | null;
  create(tier: LgDomainTier, states: { [name: string]: boolean }): LgDomainState;
  setTier(state: LgDomainState, tier: LgDomainTier): void;
  applyList(state: LgDomainState, states: { [name: string]: boolean }): void;
  discardStages(state: LgDomainState): void;
  toggle(state: LgDomainState, name: string): boolean;
  row(state: LgDomainState, name: string): LgDomainRowView | null;
  changes(state: LgDomainState): OverrideChange[];
  categoryLabel(category: string): string;
  stateLabel(row: LgDomainRowView): string;
  rowDetail(tier: LgDomainTier, row: LgDomainRowView): string;
  zoneWarning(tier: LgDomainTier, name: string): string;
  attention(entries: number, tier: LgDomainTier): LgDomainAttention;
  attentionMessage(level: LgDomainAttention, tier: LgDomainTier, entries: number): string;
  refusalMessage(stderr: string): string;
  saveResult(stdout: string): 'saved' | 'cleared' | null;
}

var LgDomainList: LgDomainListApi = (function (): LgDomainListApi {
  // Every category the generator emits, with the heading the panel shows. A
  // category outside this table is still rendered (never dropped) under its own
  // slug, so a future generator category cannot make a row disappear.
  var CATEGORY_LABELS: { [key: string]: string } = {
    acr: 'ACR (viewing data)',
    ads: 'Ads',
    channels: 'LG Channels',
    interop: 'Interop',
    ota: 'Firmware updates (OTA)',
    other: 'Other',
    store: 'LG Store',
    telemetry: 'Telemetry',
    thinq: 'ThinQ',
    voice: 'Voice search',
    zone: 'Zones'
  };

  // Same charset overrides.sh and src/overrides.ts accept; membership in the
  // module's rows is what bounds the length (no second copy of NAME_MAX).
  var LINE = /^([a-z0-9._-]+)=(on|off)$/;
  // The writer's refusal token: exactly the reason word and, for reject-last,
  // the preset that would have been emptied. Nothing else is accepted, and a
  // line with a trailing CR does not match the anchored pattern.
  var TOKEN = /^OVERRIDES-REJECT reason=([a-z][a-z0-9-]{0,31})(?: tier=([a-z]+))?$/;

  function available(): boolean {
    return typeof LgDomains !== 'undefined' && !!LgDomains && !!LgDomains.rows &&
      LgDomains.rows.length > 0;
  }

  // A map with no prototype chain, so a domain called '__proto__' would be a key
  // like any other (the same rule src/overrides.ts applies).
  function newMap(): { [name: string]: boolean } {
    return Object.create(null) as { [name: string]: boolean };
  }

  function knownNames(): string[] {
    if (!available()) {
      return [];
    }
    var names: string[] = [];
    for (var i = 0; i < LgDomains.rows.length; i++) {
      names.push(LgDomains.rows[i].name);
    }
    return names;
  }

  function presetEntries(): { safe: number; strict: number } {
    if (!available()) {
      return { safe: 0, strict: 0 };
    }
    return { safe: LgDomains.presetEntries.safe, strict: LgDomains.presetEntries.strict };
  }

  /**
   * Strict parse of `overrides.sh list`: one `name=on|off` line per module row,
   * every row exactly once, nothing else. Anything off that contract returns
   * null and the panel shows an explicit error instead of a partial list.
   */
  function parse(raw: string): { [name: string]: boolean } | null {
    if (!available() || typeof raw !== 'string' || raw === '') {
      return null;
    }
    if (raw.indexOf('\r') !== -1) {
      return null;
    }
    var lines = raw.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    if (lines.length !== LgDomains.rows.length) {
      return null;
    }
    var states = newMap();
    for (var i = 0; i < lines.length; i++) {
      var match = LINE.exec(lines[i]);
      if (!match) {
        return null;
      }
      var name = match[1];
      if (states[name] !== undefined) {
        return null;
      }
      states[name] = match[2] === 'on';
    }
    // The join is total or it is nothing: every row of the metadata module must
    // have been reported by the script.
    for (var r = 0; r < LgDomains.rows.length; r++) {
      if (states[LgDomains.rows[r].name] === undefined) {
        return null;
      }
    }
    return states;
  }

  function controlFor(tier: LgDomainTier, row: LgDomainRowView, covered: boolean): LgDomainControl {
    if (row.anchor) {
      // S6b T7 review F2: a zone row is a switch in BOTH tiers. Under STRICT the
      // preset ships the anchor as a bare whole-subtree entry; under SAFE it
      // ships no bare anchor, so switching this row on adds only the exact apex
      // rule (the row's own note states the same split). Its reported state is
      // rendered as what it is, never as "not in this tier".
      return 'toggle';
    }
    if (covered) {
      return 'covered';
    }
    if (tier === 'strict') {
      return 'toggle';
    }
    return row.tier === 'safe' ? 'toggle' : 'info';
  }

  function recompute(state: LgDomainState): void {
    // Coverage: the row's zone anchor is ON and the active preset ships bare
    // anchors (STRICT only) — under SAFE a zone row, even switched on, adds the
    // exact apex rule, which covers nothing.
    var anchorsOn = newMap();
    if (state.tier === 'strict') {
      for (var a = 0; a < state.rows.length; a++) {
        if (state.rows[a].anchor && state.rows[a].on) {
          anchorsOn[state.rows[a].name] = true;
        }
      }
    }
    var onCount = 0;
    var changedCount = 0;
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      // The covering zone is only a covering zone when the metadata says it is an
      // anchor AND that anchor is on: a row's `zone` is a pointer to the row that
      // decides the whole subtree, not a claim about this row's own state.
      var coveringZone = '';
      if (row.zone !== '' && row.zone !== row.name) {
        var anchor = state.byName[row.zone];
        if (anchor && anchor.anchor && anchorsOn[anchor.name] === true) {
          coveringZone = anchor.name;
        }
      }
      row.coveredBy = coveringZone;
      row.control = controlFor(state.tier, row, coveringZone !== '');
      row.changed = row.on !== row.baseline;
      if (row.on) {
        onCount++;
      }
      if (row.changed) {
        changedCount++;
      }
    }
    state.onCount = onCount;
    state.changedCount = changedCount;
  }

  function create(tier: LgDomainTier, states: { [name: string]: boolean }): LgDomainState {
    var byName = Object.create(null) as unknown as { [name: string]: LgDomainRowView };
    var state: LgDomainState = {
      tier: tier,
      rows: [],
      byName: byName,
      onCount: 0,
      changedCount: 0
    };
    for (var i = 0; i < LgDomains.rows.length; i++) {
      var source = LgDomains.rows[i];
      var on = states[source.name] === true;
      var view: LgDomainRowView = {
        name: source.name,
        tier: source.tier,
        category: source.category,
        zone: source.zone,
        anchor: source.anchor,
        note: source.note,
        baseline: on,
        on: on,
        changed: false,
        control: 'info',
        coveredBy: ''
      };
      state.rows.push(view);
      state.byName[view.name] = view;
    }
    recompute(state);
    return state;
  }

  function setTier(state: LgDomainState, tier: LgDomainTier): void {
    state.tier = tier;
    recompute(state);
  }

  /**
   * Adopt a fresh `list` result. Rows the user changed keep the user's staged
   * value (the TV changing underneath must not silently drop an edit); every
   * other row follows the script, which is the only source of state.
   */
  function applyList(state: LgDomainState, states: { [name: string]: boolean }): void {
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      var baseline = states[row.name] === true;
      if (row.on === row.baseline) {
        row.on = baseline;
      }
      row.baseline = baseline;
    }
    recompute(state);
  }

  /** Drop every staged edit and follow the reported baseline again. */
  function discardStages(state: LgDomainState): void {
    for (var i = 0; i < state.rows.length; i++) {
      state.rows[i].on = state.rows[i].baseline;
    }
    recompute(state);
  }

  /** Flip a toggleable row. Returns false (and changes nothing) otherwise. */
  function toggle(state: LgDomainState, name: string): boolean {
    var row = state.byName[name];
    if (!row || row.control !== 'toggle') {
      return false;
    }
    row.on = !row.on;
    recompute(state);
    return true;
  }

  function row(state: LgDomainState, name: string): LgDomainRowView | null {
    return state.byName[name] || null;
  }

  /** The SPARSE payload: only rows whose staged value differs from the TV's. */
  function changes(state: LgDomainState): OverrideChange[] {
    var out: OverrideChange[] = [];
    for (var i = 0; i < state.rows.length; i++) {
      if (state.rows[i].changed) {
        out.push({ name: state.rows[i].name, on: state.rows[i].on });
      }
    }
    return out;
  }

  function categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] !== undefined ? CATEGORY_LABELS[category] : category;
  }

  function stateLabel(row: LgDomainRowView): string {
    var label = row.on ? 'Blocked' : 'Allowed';
    if (row.control === 'covered') {
      return label + ' — covered by the ' + row.coveredBy + ' zone';
    }
    if (row.control === 'info') {
      return label + ' — not in this tier';
    }
    return label;
  }

  function zoneWarning(tier: LgDomainTier, name: string): string {
    if (tier === 'strict') {
      return 'Zone row: this blocks the whole ' + name + ' subtree, including subdomains that ' +
        'have no row of their own. Turning it off stops that whole-zone block; domains listed ' +
        'under it stay blocked by their own rows.';
    }
    // Same split the committed row note states: under SAFE the row is a real
    // switch, but it buys only the exact apex rule (S6b T7 review F2).
    return 'Zone row: under SAFE this row blocks only ' + name + ' itself, not its subdomains. ' +
      'Under STRICT the same row blocks the whole ' + name + ' subtree. Turning it off stops ' +
      'that one rule; domains listed under it stay blocked by their own rows.';
  }

  function rowDetail(tier: LgDomainTier, row: LgDomainRowView): string {
    if (row.control === 'covered') {
      return 'The ' + row.coveredBy + ' zone row decides this domain while it is on. Turn that ' +
        'zone row off first to change this domain on its own.';
    }
    if (row.anchor) {
      // The tier-aware blast-radius note: it differs by tier and, on the SAFE
      // branch, names this row's own name. It is the fallback the panel uses
      // when the row carries no upstream note, and it is always shown for zone
      // rows (the note alone promises only what the preset keeps — review F4).
      return zoneWarning(tier, row.name);
    }
    if (row.control === 'info') {
      return 'This row is only part of the STRICT list. Switch to STRICT to manage it.';
    }
    return '';
  }

  /**
   * Attention level for the TV's reported entry count. Two thresholds, no more:
   * an empty list is the strongest state, and a list below half of the active
   * tier's preset gets the milder notice. Both are display-only. A count the app
   * cannot read is 'unknown', never 'ok' (S6b T7 review F5): the caller must not
   * be able to render a confident healthy state from an unreadable number.
   */
  function attention(entries: number, tier: LgDomainTier): LgDomainAttention {
    if (typeof entries !== 'number' || !isFinite(entries) || entries < 0) {
      return 'unknown';
    }
    if (entries === 0) {
      return 'empty';
    }
    var preset = tier === 'strict' ? presetEntries().strict : presetEntries().safe;
    return preset > 0 && entries * 2 < preset ? 'low' : 'ok';
  }

  function attentionMessage(level: LgDomainAttention, tier: LgDomainTier, entries: number): string {
    var preset = tier === 'strict' ? presetEntries().strict : presetEntries().safe;
    if (level === 'unknown') {
      return 'The TV\'s blocked-entry count could not be read as a number, so this app cannot ' +
        'tell how much is blocked. Press "Refresh status" to try again — reinstall the app if ' +
        'this keeps happening.';
    }
    if (level === 'empty') {
      return 'Nothing is blocked right now: the TV reports 0 blocked entries. Apply your staged ' +
        'changes, or press Reset to preset.';
    }
    if (level === 'low') {
      return 'Only ' + entries + ' of the ' + preset + ' entries in the ' +
        (tier === 'strict' ? 'STRICT' : 'SAFE') + ' preset are blocked. That can be a deliberate ' +
        'debug state — check the list if it is not what you wanted.';
    }
    return '';
  }

  function rejectLastSentence(tier: string): string {
    var tail = ' Turn at least one domain back on, or press Reset to preset.';
    if (tier === 'safe') {
      return 'That change would leave the SAFE list with nothing blocked, so the TV refused it.' + tail;
    }
    if (tier === 'strict') {
      return 'That change would leave the STRICT list with nothing blocked, so the TV refused it.' + tail;
    }
    if (tier === 'legacy') {
      return 'That change would leave the installed list — this TV has no SAFE/STRICT split — with ' +
        'nothing blocked, so the TV refused it.' + tail;
    }
    return 'That change would leave one of the preset lists with nothing blocked, so the TV ' +
      'refused it.' + tail;
  }

  // One sentence per reason word, and none of them contains the reason word or
  // any other script text: the UI never renders the TV's message.
  function reasonSentence(reason: string, tier: string): string {
    switch (reason) {
      case 'bad-usage':
        return 'The app sent the TV a request it did not understand, so nothing was changed.';
      case 'empty-payload':
        return 'There was nothing to save: no domain changes were staged.';
      case 'oversized':
        return 'Too many domain changes were sent at once, so nothing was saved. Apply them in ' +
          'smaller batches.';
      case 'bad-shape':
        return 'One of the domain changes was malformed, so nothing was saved.';
      case 'bad-charset':
        return 'One of the domain names has characters the TV does not accept, so nothing was saved.';
      case 'name-too-long':
        return 'One of the domain names is too long, so nothing was saved.';
      case 'unknown-domain':
        return 'One of the changed domains is not in this app\'s domain list, so nothing was ' +
          'saved. Reinstall the app if this keeps happening.';
      case 'duplicate':
        return 'The same domain appeared twice in one change, so nothing was saved.';
      case 'reject-last':
        return rejectLastSentence(tier);
      case 'empty-list':
        return 'The TV would have been left with an empty block list, so it refused the change.' +
          ' Turn at least one domain back on, or press Reset to preset.';
      default:
        return 'The TV refused the change. The domain list was not modified.';
    }
  }

  /**
   * The refusal token from stderr, mapped to the UI's own sentence — or '' when
   * there is no token (the caller then shows a fixed generic message). Exactly
   * one token line is required: a stderr with two of them is ambiguous and is
   * not interpreted.
   */
  function refusalMessage(stderr: string): string {
    if (typeof stderr !== 'string' || stderr === '') {
      return '';
    }
    var lines = stderr.split('\n');
    var reason = '';
    var tier = '';
    var hits = 0;
    for (var i = 0; i < lines.length; i++) {
      var match = TOKEN.exec(lines[i]);
      if (!match) {
        continue;
      }
      hits++;
      reason = match[1];
      tier = match[2] || '';
    }
    if (hits !== 1) {
      return '';
    }
    return reasonSentence(reason, tier);
  }

  /**
   * The save command's own success claim, parsed strictly: exactly the two fixed
   * keys, RESULT=overrides and reason=saved|cleared. Anything else is null — the
   * caller then re-lists and reports what the TV actually reports.
   */
  function saveResult(stdout: string): 'saved' | 'cleared' | null {
    if (typeof stdout !== 'string' || stdout === '' || stdout.indexOf('\r') !== -1) {
      return null;
    }
    var lines = stdout.split('\n');
    var result = '';
    var reason = '';
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === '') {
        continue;
      }
      var eq = lines[i].indexOf('=');
      if (eq <= 0) {
        return null;
      }
      var key = lines[i].substring(0, eq);
      var value = lines[i].substring(eq + 1);
      if (key === 'RESULT') {
        if (result !== '') {
          return null;
        }
        result = value;
      } else if (key === 'reason') {
        if (reason !== '') {
          return null;
        }
        reason = value;
      } else {
        return null;
      }
    }
    if (result !== 'overrides') {
      return null;
    }
    if (reason === 'saved' || reason === 'cleared') {
      return reason;
    }
    return null;
  }

  return {
    available: available,
    knownNames: knownNames,
    presetEntries: presetEntries,
    parse: parse,
    create: create,
    setTier: setTier,
    applyList: applyList,
    discardStages: discardStages,
    toggle: toggle,
    row: row,
    changes: changes,
    categoryLabel: categoryLabel,
    stateLabel: stateLabel,
    rowDetail: rowDetail,
    zoneWarning: zoneWarning,
    attention: attention,
    attentionMessage: attentionMessage,
    refusalMessage: refusalMessage,
    saveResult: saveResult
  };
})();
