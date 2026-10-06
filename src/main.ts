/*
 * S3 UI: ON/OFF protection control plus the live status panel.
 *
 * The big action area shows exactly one of four honest states, derived ONLY
 * from the live-probed @@STATUS block (src/status.ts) — never from a command's
 * own claim of success:
 *   on         mode=on                        — green, "Protection is ON"
 *   off        mode=off, clean pointer        — "Protection is OFF"
 *   attention  gaveup=yes, or pointer=on while mode=off (recovery failed
 *              mid-way / keeper died)          — amber warning, no fake success
 *   degraded   mode=degraded (no firewall)    — gray, action disabled
 * Action results (apply/rollback) are parsed with the same strictness as the
 * status block: only the fixed keys RESULT=/reason=/upstream= are accepted,
 * and only known result/reason pairs; anything malformed maps to a fixed
 * message — script text is never rendered as a message.
 *
 * Single-flight: the HBC bridge has no concurrency lock (S0 measurement), so
 * all commands share one busy flag; a second command while one runs is refused
 * with a plain message. The refresh that follows an action reuses the same
 * flag, so action and refresh never overlap.
 *
 * Spatial navigation is hand-rolled: the buttons form one row (the protection
 * button first), arrow keys move focus, OK/Enter activates the focused button
 * (native button behavior). No framework, no runtime dependencies (design
 * spec §3).
 *
 * S6a T3: the tier row (inside the protection area) shows which list the TV is
 * running and offers the SAFE/STRICT switch. Both facts come from the parsed
 * block — never from the switch command's own claim — and the switch is only
 * offered when a block has been parsed, because without one the app cannot say
 * which tier is active. Switching writes the tier through the fixed tier.sh
 * wrapper, then re-applies protection through the EXISTING apply flow while the
 * filter is running (that is what restarts it with the new list); no new
 * privileged command was added for it.
 *
 * S6b T7: the domain list panel joins the script's `list` output (the effective
 * set, the only source of state) with the generated metadata module
 * (src/domains.gen.ts, the only source of display attributes) and stages
 * on/off toggles locally. Nothing is written until one explicit Apply, because
 * every write costs a filter restart (a 2-3 s DNS gap); Apply with protection
 * off only saves and says so. A refused save arrives as rc 2 plus the
 * OVERRIDES-REJECT token, which is mapped to the app's own sentence — script
 * text is never rendered as a message. The decisions themselves (join,
 * coverage, thresholds, copy) live in src/domainlist.ts, DOM-free.
 *
 * Status parsing lives in src/status.ts — like src/bridge.ts it is a plain
 * script exposing one global (LgStatus), not a module: the TV loads the
 * compiled JS with plain <script> tags, so CommonJS output must never appear.
 * The TvStatus interface is shared program-wide, exactly like the Hb* types.
 */

(function (): void {
  function el(id: string): HTMLElement {
    var node = document.getElementById(id);
    if (!node) {
      throw new Error('Missing element: ' + id);
    }
    return node;
  }

  var statusLine = el('status');
  var panel = el('panel');
  var output = el('output');
  var protection = el('protection');
  var protHeadline = el('prot-headline');
  var protText = el('prot-text');
  var protectButton = el('btn-protect') as HTMLButtonElement;
  // S6a T3: the tier row lives inside the protection area (which tier is
  // running, and the SAFE/STRICT switch next to it).
  var tierCurrent = el('tier-current');
  var tierNote = el('tier-note');
  var tierSafeButton = el('btn-tier-safe') as HTMLButtonElement;
  var tierStrictButton = el('btn-tier-strict') as HTMLButtonElement;
  // S6b T7: the domain list panel. Its rows are built ONCE from the generated
  // metadata module (global LgDomains) and reused; what they show comes from the
  // script's `list` output, never from a locally computed effective set.
  var domainsStatus = el('domains-status');
  var domainsNote = el('domains-note');
  var domainsList = el('domains-list');
  var domainsApplyButton = el('btn-domain-apply') as HTMLButtonElement;
  var domainsResetButton = el('btn-domain-reset') as HTMLButtonElement;
  var domainsConfirm = el('domains-confirm');
  var domainsConfirmText = el('domains-confirm-text');
  var domainsConfirmButton = el('btn-domain-reset-confirm') as HTMLButtonElement;
  var domainsCancelButton = el('btn-domain-reset-cancel') as HTMLButtonElement;
  // Arrow-key order follows the visual order, tier buttons included. It is
  // rebuilt whenever the set of controls changes: the reset confirmation
  // replaces Apply/Reset while it is open, and 115 domain rows are appended
  // once the list has been read. Outside those states every control keeps its
  // place, so focus identity survives a re-render.
  var nav: HTMLElement[] = [];
  var focusIndex = 0;
  var busy = false;

  // What the protection button does right now; null until the first status
  // block arrives (or while the TV state could not be read).
  var protectAction: 'turn-on' | 'turn-off' | 'blocked' | null = null;
  // Last live-probed truth (never a command's own claim): the tier switch
  // re-applies protection only while the filter is actually running, and the
  // active tier is only ever the one a parsed block reported.
  var protectionOn = false;
  var currentTier: 'safe' | 'strict' | null = null;
  // The last successfully parsed block, kept for the domain panel's attention
  // line. Null means the TV state could not be read (the panel then says so).
  var lastBlock: TvStatus | null = null;

  // Domain list view state (S6b T7). `domainState` is null until the script's
  // list has been read at least once; the list is never rendered from a guess.
  var domainState: LgDomainState | null = null;
  var domainsBuilt = false;
  var rowParts: { [name: string]: LgDomainRowEls } = {};
  var rowOrder: string[] = [];
  var domainMessage = '';
  var domainMessageKind = ''; // '' | 'is-ok' | 'is-error'
  var confirmOpen = false;

  function show(statusText: string, bodyText: string): void {
    statusLine.textContent = statusText;
    output.textContent = bodyText;
  }

  function formatExec(response: HbExecResponse): string {
    var parts: string[] = ['returnValue: ' + String(response.returnValue)];
    if (response.stdoutString) {
      parts.push('stdout:\n' + response.stdoutString);
    }
    if (response.stderrString) {
      parts.push('stderr:\n' + response.stderrString);
    }
    if (response.errorText) {
      parts.push('errorText: ' + response.errorText);
    }
    return parts.join('\n\n');
  }

  function showExecResult(label: string, response: HbExecResponse): void {
    var verdict = response.returnValue ? 'done' : 'FAILED';
    show(label + ': ' + verdict, formatExec(response));
  }

  function rawPreview(raw: string): string {
    var LIMIT = 2000;
    if (raw.length <= LIMIT) {
      return raw;
    }
    return raw.substring(0, LIMIT) + '\n…(truncated)';
  }

  function runGuarded(action: () => void): void {
    if (busy) {
      show('Busy', 'A command is already running — wait for it to finish.');
      return;
    }
    busy = true;
    action();
  }

  function finish(): void {
    busy = false;
  }

  // ---- focus order -----------------------------------------------------------

  // The focusable controls in visual order. Rebuilt from parts (never mutated in
  // place) so a hidden control — the Apply/Reset pair while the reset
  // confirmation is open — can never be focused by an arrow key.
  function rebuildNav(): void {
    var next: HTMLElement[] = [protectButton, tierSafeButton, tierStrictButton];
    if (confirmOpen) {
      next.push(domainsConfirmButton, domainsCancelButton);
    } else {
      next.push(domainsApplyButton, domainsResetButton);
    }
    for (var i = 0; i < rowOrder.length; i++) {
      next.push(rowParts[rowOrder[i]].button);
    }
    next.push(el('btn-refresh'), el('btn-check'), el('btn-state'), el('btn-register'), el('btn-remove'));
    nav = next;
    var active: Element | null = document.activeElement || null;
    var index = active ? nav.indexOf(active as HTMLElement) : -1;
    focusIndex = index === -1 ? 0 : index;
  }

  function setFocused(node: HTMLElement): void {
    node.focus();
  }

  function currentFocusIndex(): number {
    var active: Element | null = document.activeElement || null;
    if (active) {
      var index = nav.indexOf(active as HTMLElement);
      if (index !== -1) {
        return index;
      }
    }
    return focusIndex;
  }

  // ---- protection state (live-probed only) ----------------------------------

  type ProtectState = 'on' | 'off' | 'attention' | 'degraded' | 'unknown';

  function protectState(block: TvStatus): ProtectState {
    if (block.mode === 'degraded') {
      return 'degraded';
    }
    if (block.mode === 'on') {
      // S6b T7 (review F3): protection can be nominally ON while the materialized
      // list is empty or nearly so — that is not a healthy green state. The
      // entry count is the TV's own report, so the card can never claim more
      // than the TV does.
      return entriesAttention(block) === 'ok' ? 'on' : 'attention';
    }
    // mode=off: a give-up marker or a stale pointer means something failed
    // mid-way — needs attention, never a clean green claim.
    if (block.gaveup === 'yes' || block.pointer === 'on') {
      return 'attention';
    }
    return 'off';
  }

  function renderProtection(state: ProtectState): void {
    protection.className = 'protection is-' + state;
    protectionOn = state === 'on';
    if (state === 'on') {
      protHeadline.textContent = 'Protection is ON';
      protText.textContent = 'LG ad and tracking domains are blocked on this TV.';
      protectAction = 'turn-off';
      protectButton.textContent = 'Turn off protection';
      protectButton.disabled = false;
    } else if (state === 'attention') {
      // Two different histories reach this state: a recovery that failed while
      // protection is off (below), and protection that IS on with a list far
      // shorter than the active preset's (the entries note wins when there is
      // one). The button always offers the action that is actually possible.
      var note = lastBlock && lastBlock.mode === 'on' ? entriesAttentionNote(lastBlock) : '';
      protHeadline.textContent = 'Protection needs attention';
      if (note) {
        protText.textContent = note;
        protectAction = 'turn-off';
        protectButton.textContent = 'Turn off protection';
      } else {
        protText.textContent = 'Protection is off. Your TV is working normally. Turn it on to try again.';
        protectAction = 'turn-on';
        protectButton.textContent = 'Turn on protection';
      }
      protectButton.disabled = false;
    } else if (state === 'degraded') {
      protHeadline.textContent = "This TV can't enforce filtering";
      protText.textContent =
        "This TV can't enforce filtering (no firewall layer). Protection can't be turned on here.";
      protectAction = 'blocked';
      protectButton.textContent = 'Turn on protection';
      protectButton.disabled = true;
    } else if (state === 'off') {
      protHeadline.textContent = 'Protection is OFF';
      protText.textContent =
        'LG ad and tracking domains are not blocked. Turn protection on to block them.';
      protectAction = 'turn-on';
      protectButton.textContent = 'Turn on protection';
      protectButton.disabled = false;
    } else {
      protHeadline.textContent = 'Protection state unknown';
      protText.textContent =
        'The current state could not be read from the TV. Press "Refresh status" to try again.';
      protectAction = null;
      protectButton.textContent = 'Not available';
      protectButton.disabled = true;
      // No parsed block → no tier. Render the unknown tier rather than keeping
      // the last one on screen: the panel must never claim a tier it could not
      // read, and the switch is refused until a block arrives.
      renderTier(null);
    }
  }

  // ---- tier (SAFE/STRICT) ---------------------------------------------------

  // Renders ONLY from the live-probed block (or null when there is none).
  function renderTier(tier: 'safe' | 'strict' | null): void {
    currentTier = tier;
    tierSafeButton.className = 'tier-button' + (tier === 'safe' ? ' is-active' : '');
    tierStrictButton.className = 'tier-button' + (tier === 'strict' ? ' is-active' : '');
    tierSafeButton.setAttribute('aria-pressed', tier === 'safe' ? 'true' : 'false');
    tierStrictButton.setAttribute('aria-pressed', tier === 'strict' ? 'true' : 'false');
    if (tier === 'safe') {
      tierCurrent.textContent = 'Tier: SAFE (default)';
      tierNote.textContent =
        'SAFE blocks the known LG ad and tracking domains. Switching rewrites the list and ' +
        'restarts the filter for a few seconds.';
    } else if (tier === 'strict') {
      tierCurrent.textContent = 'Tier: STRICT';
      tierNote.textContent =
        'STRICT blocks the SAFE domains plus whole LG zones: the store and LG account login can ' +
        'break, ThinQ and LG Channels stop working, and firmware updates are frozen. Switching ' +
        'rewrites the list and restarts the filter for a few seconds.';
    } else {
      tierCurrent.textContent = 'Tier: unknown';
      tierNote.textContent =
        'The active tier could not be read from the TV. Press "Refresh status" to try again.';
    }
  }

  function tierLabel(tier: 'safe' | 'strict'): string {
    return tier === 'strict' ? 'STRICT' : 'SAFE';
  }

  // Message for the re-apply that follows a tier change: parsed with the same
  // strict result parser as the protection actions, so script text is never
  // rendered as a message.
  function tierApplyMessage(label: string, response: HbExecResponse): string {
    if (!response.returnValue) {
      return 'The TV didn\'t run the command to re-apply protection. Press "Turn on protection" ' +
        'to try again.';
    }
    var parsed = parseResult(response.stdoutString || '');
    if (!parsed) {
      return 'The TV didn\'t return a clear result. Check the status below.';
    }
    if (parsed.result === 'on') {
      return 'Protection is on with the ' + label + ' list.';
    }
    return reasonMessage(parsed.reason);
  }

  function runTierSwitch(target: 'safe' | 'strict'): void {
    // Guards first, and they run before the busy flag is taken: without a parsed
    // block there is no known current tier, so the app refuses instead of
    // guessing (or writing a tier it cannot confirm afterwards).
    if (currentTier === null) {
      show('Tier not switchable yet',
        'The active tier could not be read from the TV. Press "Refresh status" first - the app ' +
        'never changes a tier it cannot confirm.');
      return;
    }
    if (currentTier === target) {
      show('Tier already active',
        'The TV is already using the ' + tierLabel(target) + ' list.');
      return;
    }
    setDomainMessage('', '');
    runGuarded(function (): void {
      if (!LgBlocklistBridge.available()) {
        show('Bridge unavailable', LgBlocklistBridge.diagnose());
        finish();
        return;
      }
      var label = tierLabel(target);
      var detail = protectionOn
        ? 'Saving the tier, then re-applying protection so the filter restarts with the new ' +
          'list (can take a few seconds).'
        : 'Saving the tier. Protection is off, so nothing is restarted.';
      show('Switching to ' + label + '…', detail);
      var onWritten = function (response: HbExecResponse): void {
        if (!response.returnValue) {
          finish();
          show('Tier not saved', formatExec(response));
          return;
        }
        if (!protectionOn) {
          // Nothing to restart: persist-and-report. The refresh below shows the
          // tier the TV now reports, which is the only claim the panel makes.
          refreshAllInternal(function (): void {
            show('Tier saved: ' + label,
              'Protection is off, so the filter was not restarted. The ' + label +
              ' list is used next time protection is turned on.');
          });
          return;
        }
        // The filter is running: re-apply through the EXISTING apply flow (same
        // fixed command, same single-flight flag) so the new list is
        // materialized and the filter restarts with it.
        var onApplied = function (applyResponse: HbExecResponse): void {
          var message = tierApplyMessage(label, applyResponse);
          refreshAllInternal(function (): void {
            show(message, formatExec(applyResponse));
          });
        };
        LgBlocklistBridge.runApply(onApplied);
      };
      if (target === 'safe') {
        LgBlocklistBridge.setTierSafe(onWritten);
      } else {
        LgBlocklistBridge.setTierStrict(onWritten);
      }
    });
  }

  // ---- action result parsing (fixed keys only) ------------------------------

  interface ProtectResult {
    result: 'on' | 'off' | 'fail' | 'degraded';
    reason: string;
    upstream: string;
  }

  // The complete reason vocabulary of the fixed scripts (lockstep with
  // app/scripts/apply.sh + rollback.sh). A reason outside this set makes the
  // whole result malformed — unexpected text is never rendered.
  function reasonMessage(reason: string): string {
    switch (reason) {
      case 'verified':
        return 'Protection is on.';
      case 'user-off':
        return 'Protection is off.';
      case 'filter-sideport':
        return "The filter didn't start. Try again.";
      case 'upstream-unreachable':
        return "Your network's DNS isn't reachable yet — try again in a minute.";
      case 'verify-canary':
        return 'Verification failed — protection was rolled back. TV works normally.';
      case 'verify-blocked':
        return "The filter didn't block as expected — rolled back.";
      case 'rules-add':
        return "Couldn't apply firewall rules — rolled back.";
      case 'materialize':
        return "Setup files couldn't be written.";
      case 'locked':
        return 'Busy — try again in a moment.';
      case 'no-firewall-layer':
        return "This TV can't enforce filtering (no firewall layer). Protection can't be turned on here.";
      default:
        return '';
    }
  }

  function resultMatchesReason(result: string, reason: string): boolean {
    if (result === 'on') {
      return reason === 'verified';
    }
    if (result === 'off') {
      return reason === 'user-off';
    }
    if (result === 'degraded') {
      return reason === 'no-firewall-layer';
    }
    if (result === 'fail') {
      return reason === 'locked' || reason === 'upstream-unreachable' || reason === 'materialize' ||
        reason === 'filter-sideport' || reason === 'rules-add' || reason === 'verify-canary' ||
        reason === 'verify-blocked';
    }
    return false;
  }

  function isIpv4(value: string): boolean {
    var parts = value.split('.');
    if (parts.length !== 4) {
      return false;
    }
    for (var i = 0; i < parts.length; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) {
        return false;
      }
      var n = Number(parts[i]);
      if (n < 0 || n > 255) {
        return false;
      }
    }
    return true;
  }

  // Strict parser for the apply/rollback result block: at most the three fixed
  // keys, each at most once; RESULT + reason required, upstream optional
  // (IPv4); the result/reason pair must be a known combination. Anything else
  // returns null and the caller shows a fixed message instead.
  function parseResult(raw: string): ProtectResult | null {
    if (!raw || raw.indexOf('\r') !== -1) {
      return null;
    }
    var lines = raw.split('\n');
    var result = '';
    var reason = '';
    var upstream = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === '') {
        continue;
      }
      var eq = line.indexOf('=');
      if (eq <= 0) {
        return null;
      }
      var key = line.substring(0, eq);
      var value = line.substring(eq + 1);
      if (value === '') {
        return null;
      }
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
      } else if (key === 'upstream') {
        if (upstream !== '') {
          return null;
        }
        upstream = value;
      } else {
        return null;
      }
    }
    if (result === '' || reason === '' || !reasonMessage(reason) || !resultMatchesReason(result, reason)) {
      return null;
    }
    if (upstream !== '' && !isIpv4(upstream)) {
      return null;
    }
    return { result: result as ProtectResult['result'], reason: reason, upstream: upstream };
  }

  function actionResultMessage(action: 'on' | 'off', response: HbExecResponse): string {
    if (!response.returnValue) {
      return action === 'on'
        ? "The TV didn't run the command to turn protection on. Try again."
        : "The TV didn't run the command to turn protection off. Try again.";
    }
    var parsed = parseResult(response.stdoutString || '');
    if (!parsed) {
      return "The TV didn't return a clear result. Check the status below.";
    }
    return reasonMessage(parsed.reason);
  }

  // ---- domain list (S6b T7) --------------------------------------------------

  // One row's live nodes; the row buttons are created once and only their text
  // and classes are updated, so remote focus keeps pointing at the same node.
  interface LgDomainRowEls {
    button: HTMLButtonElement;
    name: HTMLElement;
    state: HTMLElement;
    detail: HTMLElement;
    note: HTMLElement;
  }

  // The DOM-free half of the view. Null means the compiled metadata module is
  // missing (a damaged package) — never "no domains".
  function listModule(): LgDomainListApi | null {
    if (typeof LgDomainList === 'undefined' || !LgDomainList) {
      return null;
    }
    return LgDomainList.available() ? LgDomainList : null;
  }

  function entriesAttention(block: TvStatus): LgDomainAttention {
    var api = listModule();
    return api ? api.attention(block.entries, block.tier) : 'ok';
  }

  function entriesAttentionNote(block: TvStatus): string {
    var api = listModule();
    if (!api) {
      return '';
    }
    return api.attentionMessage(api.attention(block.entries, block.tier), block.tier, block.entries);
  }

  function setDomainMessage(text: string, kind: string): void {
    domainMessage = text;
    domainMessageKind = kind;
  }

  function buildDomainRows(api: LgDomainListApi): void {
    if (domainsBuilt || typeof LgDomains === 'undefined' || !LgDomains) {
      return;
    }
    var rows = LgDomains.rows;
    var group: HTMLElement | null = null;
    var category = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (group === null || row.category !== category) {
        category = row.category;
        var section = document.createElement('div');
        section.className = 'domain-group';
        var heading = document.createElement('h3');
        heading.className = 'domain-group-title';
        heading.textContent = api.categoryLabel(category);
        section.appendChild(heading);
        domainsList.appendChild(section);
        group = section;
      }
      var button = document.createElement('button') as HTMLButtonElement;
      button.className = 'domain-row';
      button.setAttribute('data-name', row.name);
      var nameEl = document.createElement('span');
      nameEl.className = 'domain-name';
      nameEl.textContent = row.name;
      var stateEl = document.createElement('span');
      stateEl.className = 'domain-state';
      var detailEl = document.createElement('span');
      detailEl.className = 'domain-detail';
      var noteEl = document.createElement('span');
      noteEl.className = 'domain-note';
      button.appendChild(nameEl);
      button.appendChild(stateEl);
      button.appendChild(detailEl);
      button.appendChild(noteEl);
      bindDomainRow(button, row.name);
      group.appendChild(button);
      rowParts[row.name] = {
        button: button,
        name: nameEl,
        state: stateEl,
        detail: detailEl,
        note: noteEl
      };
      rowOrder.push(row.name);
    }
    domainsBuilt = true;
    rebuildNav();
  }

  function bindDomainRow(button: HTMLButtonElement, name: string): void {
    button.addEventListener('click', function (): void {
      onDomainRowClick(name);
    });
  }

  function domainRowClass(row: LgDomainRowView): string {
    var parts = ['domain-row', row.on ? 'is-on' : 'is-off'];
    parts.push(row.control === 'toggle' ? 'is-toggle' : row.control === 'covered' ? 'is-covered' : 'is-info');
    if (row.anchor) {
      parts.push('is-zone');
    }
    if (row.changed) {
      parts.push('is-changed');
    }
    return parts.join(' ');
  }

  function renderDomainRow(row: LgDomainRowView, tier: LgDomainTier, api: LgDomainListApi): void {
    var parts = rowParts[row.name];
    if (!parts) {
      return;
    }
    var state = api.stateLabel(row) + (row.changed ? ' — staged' : '');
    var detail = api.rowDetail(tier, row);
    parts.button.className = domainRowClass(row);
    parts.button.setAttribute('aria-pressed', row.on ? 'true' : 'false');
    parts.button.setAttribute('aria-disabled', row.control === 'toggle' ? 'false' : 'true');
    parts.button.setAttribute('aria-label',
      row.name + ' — ' + state + (row.control === 'toggle' ? ' — press to change' : ''));
    parts.state.textContent = state;
    parts.detail.textContent = detail;
    parts.detail.hidden = detail === '';
    parts.note.textContent = row.note;
    parts.note.hidden = row.note === '';
  }

  // The whole panel text is composed here, from the parsed block and the parsed
  // list only: no script text, no device text.
  function domainStatusText(api: LgDomainListApi): string {
    var lines: string[] = [];
    if (domainMessage) {
      lines.push(domainMessage);
    }
    if (domainState) {
      var changed = domainState.changedCount;
      lines.push(changed === 0
        ? 'No unsaved changes.'
        : changed + (changed === 1 ? ' unsaved change' : ' unsaved changes') +
          ' — press Apply to write them to the TV.');
    } else if (!domainMessage) {
      lines.push('The domain list has not been read from the TV yet — press "Refresh status".');
    }
    if (domainState && !lastBlock) {
      lines.push('The active tier could not be read, so which rows are switchable may be out of date.');
    }
    if (domainState && lastBlock) {
      var level = api.attention(lastBlock.entries, lastBlock.tier);
      var note = api.attentionMessage(level, lastBlock.tier, lastBlock.entries);
      if (note) {
        lines.push(note);
      }
    }
    return lines.join('\n');
  }

  function domainStatusClass(): string {
    if (domainMessageKind) {
      return ' ' + domainMessageKind;
    }
    if (domainState && lastBlock) {
      var level = entriesAttention(lastBlock);
      if (level === 'empty') {
        return ' is-attention';
      }
      if (level === 'low') {
        return ' is-notice';
      }
    }
    if (domainState && domainState.changedCount > 0) {
      return ' is-unsaved';
    }
    return '';
  }

  // Apply/reset cost depends on whether the filter is running (owner decision).
  function domainNoteText(): string {
    if (protectionOn) {
      return 'Changes are staged: press Apply to write them to the TV. Applying restarts the ' +
        'filter — DNS pauses for 2-3 seconds. Press Reset to preset to drop every domain change.';
    }
    return 'Changes are staged: press Apply to write them to the TV. Protection is off, so ' +
      'nothing restarts — the changes take effect when protection is switched on.';
  }

  function renderDomains(): void {
    var api = listModule();
    if (!api) {
      domainsStatus.textContent =
        'The bundled domain list is missing — the installed package looks incomplete. Reinstall ' +
        'the app.';
      domainsStatus.className = 'domains-status is-error';
      domainsNote.textContent = '';
      return;
    }
    domainsList.hidden = domainState === null;
    domainsStatus.textContent = domainStatusText(api);
    domainsStatus.className = 'domains-status' + domainStatusClass();
    domainsNote.textContent = domainNoteText();
  }

  function renderAllDomainRows(): void {
    var api = listModule();
    var state = domainState;
    if (!api || !state || !domainsBuilt) {
      return;
    }
    for (var i = 0; i < state.rows.length; i++) {
      renderDomainRow(state.rows[i], state.tier, api);
    }
  }

  function onDomainRowClick(name: string): void {
    var api = listModule();
    var state = domainState;
    if (!api || !state) {
      return;
    }
    var row = api.row(state, name);
    if (!row) {
      return;
    }
    if (row.control === 'toggle') {
      // Staged, never sent: one Apply writes the sparse diff (a per-toggle
      // write would restart the filter every time).
      api.toggle(state, name);
      setDomainMessage('', '');
      renderAllDomainRows();
      renderDomains();
      return;
    }
    // Not switchable: say why, in the app's own words, and move focus to the row
    // that can change what the user is looking at.
    setDomainMessage(api.stateLabel(row) + '. ' + api.rowDetail(state.tier, row), '');
    var covered = row.control === 'covered' ? rowParts[row.coveredBy] : undefined;
    if (covered) {
      setFocused(covered.button);
    }
    renderDomains();
  }

  // ---- reading the list ------------------------------------------------------

  /**
   * Read the effective set from the script and join it with the metadata. Called
   * with the busy flag held; `after` is responsible for releasing it. A list that
   * cannot be parsed clears the rows (an explicit error, never stale state).
   */
  function loadDomainsInternal(after: () => void): void {
    var api = listModule();
    if (!api) {
      domainState = null;
      setDomainMessage('', '');
      renderDomains();
      after();
      return;
    }
    if (!lastBlock) {
      // No tier, no view: the joined rows cannot say what is switchable
      // without it, and guessing is exactly what the panel must not do.
      domainState = null;
      renderDomains();
      after();
      return;
    }
    if (!LgBlocklistBridge.available()) {
      domainState = null;
      setDomainMessage('The Homebrew Channel bridge is not available, so the domain list could ' +
        'not be read.', 'is-error');
      renderDomains();
      after();
      return;
    }
    loadDomainsWith(api, lastBlock, after);
  }

  function loadDomainsWith(api: LgDomainListApi, block: TvStatus, after: () => void): void {
    LgBlocklistBridge.listOverrides(function (response: HbExecResponse): void {
      var states = response.returnValue && response.stdoutString
        ? api.parse(response.stdoutString)
        : null;
      if (!states) {
        // An unreadable list is shown as an error, never as the last known one:
        // the rows would claim a state nobody can confirm.
        domainState = null;
        setDomainMessage('The TV did not return a readable domain list, so nothing is shown. ' +
          'Press "Refresh status" to try again, and reinstall the app if this keeps happening.',
          'is-error');
        renderDomains();
        show('Domain list not readable', formatExec(response));
        after();
        return;
      }
      if (domainState) {
        api.setTier(domainState, block.tier);
        api.applyList(domainState, states);
      } else {
        domainState = api.create(block.tier, states);
        buildDomainRows(api);
      }
      renderAllDomainRows();
      renderDomains();
      after();
    });
  }

  // ---- writing the list ------------------------------------------------------

  function refusalFallback(response: HbExecResponse): string {
    if (response.errorText && !response.stdoutString && !response.stderrString) {
      return 'The TV did not run the command, so the domain list was not modified. Check the ' +
        'Homebrew Channel bridge with "Check bridge".';
    }
    return 'The TV refused the change and did not say why, so the domain list was not modified.';
  }

  interface LgDomainWriteOutcome {
    message: string;
    ok: boolean;
  }

  function domainApplyOutcome(api: LgDomainListApi, response: HbExecResponse): LgDomainWriteOutcome {
    if (!response.returnValue) {
      return {
        message: 'Changes saved, but the TV did not run the command to re-apply protection. ' +
          'Press "Turn on protection" to try again.',
        ok: false
      };
    }
    var parsed = parseResult(response.stdoutString || '');
    if (!parsed) {
      return {
        message: 'Changes saved, but the TV did not return a clear apply result. Check the ' +
          'status below.',
        ok: false
      };
    }
    if (parsed.result === 'on') {
      return { message: 'Domain changes applied. Protection is on.', ok: true };
    }
    var token = api.refusalMessage(response.stderrString || '');
    return {
      message: 'Changes saved, but protection was not re-applied. ' +
        (token || reasonMessage(parsed.reason)),
      ok: false
    };
  }

  /** True when the TV reports back exactly the set the user staged. */
  function stagedMatchesReported(api: LgDomainListApi): boolean {
    var state = domainState;
    return state !== null && api.changes(state).length === 0;
  }

  /** Writes the staged diff with one command, then re-applies or just saves. */
  function applyDomainChanges(): void {
    var api = listModule();
    if (!api) {
      setDomainMessage('The bundled domain list is missing, so nothing can be changed. Reinstall ' +
        'the app.', 'is-error');
      renderDomains();
      return;
    }
    var pending = domainState;
    if (!pending) {
      setDomainMessage('The domain list has not been read from the TV yet — press "Refresh ' +
        'status" first.', 'is-error');
      renderDomains();
      return;
    }
    runApplyDomainChanges(api, pending);
  }

  function runApplyDomainChanges(api: LgDomainListApi, state: LgDomainState): void {
    runGuarded(function (): void {
      if (!LgBlocklistBridge.available()) {
        setDomainMessage('The Homebrew Channel bridge is not available, so nothing was sent.', 'is-error');
        renderDomains();
        show('Bridge unavailable', LgBlocklistBridge.diagnose());
        finish();
        return;
      }
      var changes = api.changes(state);
      if (changes.length === 0) {
        setDomainMessage('Nothing to apply: no domain changes are staged.', '');
        renderDomains();
        finish();
        return;
      }
      setDomainMessage('', '');
      var count = changes.length;
      show('Saving ' + count + (count === 1 ? ' domain change…' : ' domain changes…'),
        protectionOn
          ? 'Writes the changed domains, then re-applies protection so the filter restarts ' +
            '(DNS pauses for 2-3 seconds).'
          : 'Writes the changed domains. Protection is off, so nothing is restarted.');
      LgBlocklistBridge.saveOverrides(changes, api.knownNames(), function (response: HbExecResponse): void {
        if (!response.returnValue) {
          setDomainMessage(api.refusalMessage(response.stderrString || '') || refusalFallback(response),
            'is-error');
          finish();
          renderDomains();
          show('Domain changes not saved', formatExec(response));
          return;
        }
        if (api.saveResult(response.stdoutString || '') === null) {
          setDomainMessage('The TV did not return a clear save result, so the change was not ' +
            'confirmed.', 'is-error');
          finish();
          renderDomains();
          show('Domain save: unclear result', formatExec(response));
          return;
        }
        if (!protectionOn) {
          // Protection is off: persist and re-list, no restart (owner decision).
          refreshAllInternal(function (): void {
            var match = stagedMatchesReported(api);
            setDomainMessage(match
              ? 'Changes saved. Protection is off, so nothing was restarted — they take effect ' +
                'when protection is switched on.'
              : 'The TV did not report the staged domains back, so the list may not match what ' +
                'you staged.', match ? 'is-ok' : 'is-error');
            renderDomains();
            show('Domain changes saved', formatExec(response));
          });
          return;
        }
        show('Re-applying protection…',
          'The filter restarts with the new domain changes (DNS pauses for 2-3 seconds).');
        LgBlocklistBridge.runApply(function (applyResponse: HbExecResponse): void {
          var outcome = domainApplyOutcome(api, applyResponse);
          refreshAllInternal(function (): void {
            var match = stagedMatchesReported(api);
            setDomainMessage(match ? outcome.message :
              'The TV did not report the staged domains back, so the list may not match what you staged.',
              match && outcome.ok ? 'is-ok' : 'is-error');
            renderDomains();
            show('Domain changes saved', formatExec(applyResponse));
          });
        });
      });
    });
  }

  // ---- reset to preset -------------------------------------------------------

  function resetRestartNote(): string {
    return protectionOn
      ? ' The filter restarts when you confirm (DNS pauses for 2-3 seconds).'
      : ' Protection is off, so nothing is restarted.';
  }

  function resetPrompt(): string {
    if (currentTier === null) {
      return 'Reset every domain to the active preset? This clears all domain changes — applied ' +
        'and staged — and restores that preset exactly as it ships.' + resetRestartNote();
    }
    var label = tierLabel(currentTier);
    return 'Reset every domain to the ' + label + ' preset? This clears all domain changes — ' +
      'applied and staged — and restores the ' + label + ' preset exactly as it ships.' +
      resetRestartNote();
  }

  function resetTargetLabel(): string {
    return currentTier === null ? 'active' : tierLabel(currentTier);
  }

  function openResetConfirm(): void {
    if (!listModule()) {
      setDomainMessage('The bundled domain list is missing, so nothing can be reset here. ' +
        'Reinstall the app.', 'is-error');
      renderDomains();
      return;
    }
    setDomainMessage('', '');
    confirmOpen = true;
    domainsConfirmText.textContent = resetPrompt();
    domainsConfirm.hidden = false;
    rebuildNav();
    setFocused(domainsConfirmButton);
    renderDomains();
  }

  function closeResetConfirm(notice: string): void {
    confirmOpen = false;
    domainsConfirm.hidden = true;
    rebuildNav();
    setFocused(domainsResetButton);
    if (notice) {
      setDomainMessage(notice, '');
    }
    renderDomains();
  }

  function confirmReset(): void {
    var api = listModule();
    if (!api) {
      closeResetConfirm('The bundled domain list is missing, so nothing was reset.');
      return;
    }
    runConfirmReset(api, domainState);
  }

  function runConfirmReset(api: LgDomainListApi, state: LgDomainState | null): void {
    runGuarded(function (): void {
      if (!LgBlocklistBridge.available()) {
        confirmOpen = false;
        domainsConfirm.hidden = true;
        rebuildNav();
        setFocused(domainsResetButton);
        setDomainMessage('The Homebrew Channel bridge is not available, so nothing was reset.', 'is-error');
        renderDomains();
        show('Bridge unavailable', LgBlocklistBridge.diagnose());
        finish();
        return;
      }
      confirmOpen = false;
      domainsConfirm.hidden = true;
      rebuildNav();
      setFocused(domainsResetButton);
      setDomainMessage('', '');
      show('Resetting domains…', protectionOn
        ? 'Clearing the domain changes, then re-applying protection so the filter restarts.'
        : 'Clearing the stored domain changes. Protection is off, so nothing is restarted.');
      LgBlocklistBridge.clearOverrides(function (response: HbExecResponse): void {
        if (!response.returnValue) {
          setDomainMessage(api.refusalMessage(response.stderrString || '') ||
            'The TV did not clear the domain changes, so nothing was reset.', 'is-error');
          finish();
          renderDomains();
          show('Reset not saved', formatExec(response));
          return;
        }
        if (api.saveResult(response.stdoutString || '') !== 'cleared') {
          setDomainMessage('The TV did not return a clear reset result, so it was not confirmed.',
            'is-error');
          finish();
          renderDomains();
          show('Reset: unclear result', formatExec(response));
          return;
        }
        // The staged edits belonged to the diff the reset just removed.
        if (state) {
          api.discardStages(state);
        }
        if (!protectionOn) {
          refreshAllInternal(function (): void {
            renderDomains();
            setDomainMessage('Domains reset to the ' + resetTargetLabel() + ' preset. Protection ' +
              'is off, so nothing was restarted — the preset is used next time protection is ' +
              'turned on.', 'is-ok');
            renderDomains();
            show('Domains reset', formatExec(response));
          });
          return;
        }
        LgBlocklistBridge.runApply(function (applyResponse: HbExecResponse): void {
          var outcome = domainApplyOutcome(api, applyResponse);
          refreshAllInternal(function (): void {
            renderDomains();
            setDomainMessage(outcome.ok
              ? 'Domains reset to the ' + resetTargetLabel() + ' preset; protection is on.'
              : outcome.message, outcome.ok ? 'is-ok' : 'is-error');
            renderDomains();
            show('Domains reset', formatExec(applyResponse));
          });
        });
      });
    });
  }

  // ---- actions ---------------------------------------------------------------

  function runProtection(target: 'on' | 'off'): void {
    runGuarded(function (): void {
      if (!LgBlocklistBridge.available()) {
        show('Bridge unavailable', LgBlocklistBridge.diagnose());
        finish();
        return;
      }
      var turningOn = target === 'on';
      show(turningOn ? 'Turning protection on…' : 'Turning protection off…',
        'Running the fixed ' + (turningOn ? 'apply' : 'rollback') +
        ' command through the Homebrew Channel bridge (can take a few seconds).');
      protectButton.textContent = turningOn ? 'Turning on…' : 'Turning off…';
      var onDone = function (response: HbExecResponse): void {
        var message = actionResultMessage(target, response);
        // Keep the busy flag through the refresh (single-flight), then show the
        // action message: it explains the tap; the panel above stays live-probed.
        refreshStatusInternal(function (): void {
          show(message, formatExec(response));
        });
      };
      if (turningOn) {
        LgBlocklistBridge.runApply(onDone);
      } else {
        LgBlocklistBridge.runRollback(onDone);
      }
    });
  }

  function checkBridge(): void {
    runGuarded(function (): void {
      if (!LgBlocklistBridge.available()) {
        show('Bridge unavailable', LgBlocklistBridge.diagnose());
        finish();
        return;
      }
      show('Checking bridge...', 'Calling getConfiguration (may take a moment after boot).');
      LgBlocklistBridge.getConfiguration(function (config: HbConfiguration): void {
        finish();
        var healthy = config.root ? 'root access confirmed' : 'root NOT available';
        show('Bridge: ' + healthy, JSON.stringify(config, null, 2));
      });
    });
  }

  function showHookState(): void {
    runGuarded(function (): void {
      show('Reading boot hook state...', 'readlink on the init.d symlink.');
      LgBlocklistBridge.readHookState(function (response: HbExecResponse): void {
        finish();
        var target = response.stdoutString ? response.stdoutString : '(none)';
        show('Boot hook: ' + target, formatExec(response));
      });
    });
  }

  function registerHook(): void {
    runGuarded(function (): void {
      show('Registering boot hook...', 'symlink only — the script is never copied (store rule).');
      LgBlocklistBridge.registerHook(function (response: HbExecResponse): void {
        showExecResult('Register boot hook', response);
        // The nested readHookState is part of the same action: the busy flag stays
        // held until it returns, so no second bridge command can interleave (S3
        // review: finish() used to release it before this call).
        LgBlocklistBridge.readHookState(function (state: HbExecResponse): void {
          finish();
          var target = state.stdoutString ? state.stdoutString : '(none)';
          output.textContent = formatExec(response) + '\n\nBoot hook now: ' + target;
        });
      });
    });
  }

  function removeHook(): void {
    runGuarded(function (): void {
      show('Removing boot hook...', 'rm -rf on the init.d symlink.');
      LgBlocklistBridge.removeHook(function (response: HbExecResponse): void {
        finish();
        showExecResult('Remove boot hook', response);
      });
    });
  }

  function hookLine(block: TvStatus): string {
    var state = block.hook === 'linked' ? 'linked to our script'
      : block.hook === 'other' ? 'present but points elsewhere'
      : 'not installed';
    if (block.hookTarget !== 'none') {
      state = state + ' — ' + block.hookTarget;
    }
    return 'Boot hook: ' + state;
  }

  function scriptsLine(block: TvStatus): string {
    return 'Scripts: ' + (block.scripts === 'ok' ? 'present' : 'missing');
  }

  function probedLine(block: TvStatus): string {
    if (block.ts === 0) {
      return 'Probed: TV clock is not set';
    }
    return 'Probed: ' + new Date(block.ts * 1000).toISOString();
  }

  function modeLabel(block: TvStatus): string {
    if (block.mode === 'on') {
      return 'ON (live-probed)';
    }
    if (block.mode === 'degraded') {
      return "can't filter on this TV (no firewall layer)";
    }
    return 'OFF';
  }

  function ruleLabel(rule: TvStatus['rule']): string {
    if (rule === 'on') {
      return 'active';
    }
    if (rule === 'off') {
      return 'not active';
    }
    return 'not installed';
  }

  function statusPanel(block: TvStatus): string {
    return [
      'Protection: ' + modeLabel(block),
      'Tier: ' + tierLabel(block.tier) + (block.tier === 'safe' ? ' (default)' : ''),
      entriesLine(block),
      'Filter: ' + (block.filter === 'up' ? 'running' : 'not running'),
      'Firewall rules: ' + ruleLabel(block.rule),
      'Keeper: ' + (block.keeper === 'up' ? 'running' : 'not running'),
      'Guard: ' + (block.guard === 'up' ? 'running' : 'not running'),
      'Upstream DNS: ' + (block.upstream === 'none' ? 'not set' : block.upstream),
      'Gave up: ' + (block.gaveup === 'yes' ? 'yes — turn on to try again' : 'no'),
      hookLine(block),
      scriptsLine(block),
      probedLine(block)
    ].join('\n');
  }

  function entriesLine(block: TvStatus): string {
    var api = listModule();
    if (!api) {
      return 'Blocked entries: ' + block.entries;
    }
    return 'Blocked entries: ' + block.entries + ' (this tier\'s preset has ' +
      api.presetEntries()[block.tier] + ')';
  }

  function stateHeadline(state: ProtectState): string {
    if (state === 'on') {
      return 'Status: protection ON';
    }
    if (state === 'off') {
      return 'Status: protection OFF';
    }
    if (state === 'attention') {
      return 'Status: needs attention';
    }
    if (state === 'degraded') {
      return 'Status: filtering not supported on this TV';
    }
    return 'Status: unknown';
  }

  // Shared refresh path. The busy flag is managed by the caller (or is already
  // held); it is released when the status response arrives — unless `keepBusy`
  // is set, in which case the completion callback owns the release (the domain
  // list read that follows a refresh must not race a second command). `after`
  // runs once the panel is rendered, inside the same callback.
  function refreshStatusInternal(after: (() => void) | null, keepBusy?: boolean): void {
    function done(): void {
      if (!keepBusy) {
        finish();
      }
      if (after) {
        after();
      }
    }
    if (!LgBlocklistBridge.available()) {
      lastBlock = null;
      renderProtection('unknown');
      renderDomains();
      show('Bridge unavailable', LgBlocklistBridge.diagnose());
      done();
      return;
    }
    show('Reading status...', 'Running the on-device check script through the Homebrew Channel bridge.');
    LgBlocklistBridge.runCheck(function (response: HbExecResponse): void {
      var raw = response.stdoutString || '';
      if (!response.returnValue) {
        lastBlock = null;
        renderProtection('unknown');
        panel.textContent = 'Status: not readable — the check command failed.';
        renderDomains();
        show('Status check failed', formatExec(response));
        done();
        return;
      }
      var block = LgStatus.parse(raw);
      if (!block) {
        lastBlock = null;
        renderProtection('unknown');
        panel.textContent = 'Status: unreadable (malformed block) — reinstall the app.';
        renderDomains();
        show('Status block rejected', 'Raw output (never parsed outside the block):\n' + rawPreview(raw));
        done();
        return;
      }
      lastBlock = block;
      panel.textContent = statusPanel(block);
      var state = protectState(block);
      renderProtection(state);
      renderTier(block.tier);
      // The panel above is driven by the same block: the attention line and the
      // apply/reset copy follow the protection mode that was just probed.
      renderDomains();
      show(stateHeadline(state), 'Raw status block:\n' + rawPreview(raw));
      done();
    });
  }

  /**
   * Status + domain list, one guarded step. Every entry point that may have
   * changed the TV's list (boot, refresh, apply, reset, tier switch) goes
   * through here, so what the panel shows always comes from the TV and never
   * from the command that was just run.
   */
  function refreshAllInternal(after: (() => void) | null): void {
    refreshStatusInternal(function (): void {
      if (!lastBlock) {
        finish();
        if (after) {
          after();
        }
        return;
      }
      loadDomainsInternal(function (): void {
        finish();
        if (after) {
          after();
        }
      });
    }, true);
  }

  function refreshStatus(): void {
    runGuarded(function (): void {
      refreshAllInternal(null);
    });
  }

  protectButton.addEventListener('click', function (): void {
    if (protectAction === 'turn-on') {
      runProtection('on');
    } else if (protectAction === 'turn-off') {
      runProtection('off');
    } else {
      show('Protection', 'The TV state is not known yet — press "Refresh status" first.');
    }
  });
  el('btn-refresh').addEventListener('click', refreshStatus);
  tierSafeButton.addEventListener('click', function (): void {
    runTierSwitch('safe');
  });
  tierStrictButton.addEventListener('click', function (): void {
    runTierSwitch('strict');
  });
  el('btn-check').addEventListener('click', checkBridge);
  el('btn-state').addEventListener('click', showHookState);
  el('btn-register').addEventListener('click', registerHook);
  el('btn-remove').addEventListener('click', removeHook);
  // S6b T7: every domain change is staged in the panel; these two write it.
  domainsApplyButton.addEventListener('click', applyDomainChanges);
  domainsResetButton.addEventListener('click', openResetConfirm);
  domainsConfirmButton.addEventListener('click', confirmReset);
  domainsCancelButton.addEventListener('click', function (): void {
    closeResetConfirm('Reset cancelled: the domains were left alone.');
  });

  document.addEventListener('keydown', function (event: KeyboardEvent): void {
    if (nav.length === 0) {
      return;
    }
    var key = event.key;
    var index = currentFocusIndex();
    if (key === 'ArrowDown' || key === 'ArrowRight') {
      setFocused(nav[(index + 1) % nav.length]);
      event.preventDefault();
    } else if (key === 'ArrowUp' || key === 'ArrowLeft') {
      setFocused(nav[(index + nav.length - 1) % nav.length]);
      event.preventDefault();
    }
  });

  rebuildNav();
  if (nav.length > 0) {
    setFocused(nav[0]);
  }

  // The tier row starts in the unknown state (the same text index.html ships as
  // its pre-script fallback), so the app owns its initial render and never
  // inherits a tier claim from markup.
  renderTier(null);
  renderDomains();

  // Review fix (S1): state the concrete reason when the bridge cannot work instead
  // of a bare "Bridge unavailable". webOS.* comes from the vendored webOSTV.js,
  // so a missing/damaged bundle is the realistic failure mode.
  var problem = LgBlocklistBridge.diagnose();
  if (problem) {
    renderProtection('unknown');
    show('Bridge unavailable', problem);
  } else {
    var version = LgBlocklistBridge.libVersion();
    var hint = 'Press "Refresh status" to probe the TV.';
    if (version) {
      hint = hint + ' webOSTV.js ' + version + ' loaded.';
    }
    show('Not checked yet', hint);
    refreshStatus();
  }
})();
