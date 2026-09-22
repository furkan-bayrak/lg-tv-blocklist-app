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
  var buttons: HTMLElement[] = [
    protectButton, el('btn-refresh'), el('btn-check'), el('btn-state'), el('btn-register'), el('btn-remove')
  ];
  var focusIndex = 0;
  var busy = false;

  // What the protection button does right now; null until the first status
  // block arrives (or while the TV state could not be read).
  var protectAction: 'turn-on' | 'turn-off' | 'blocked' | null = null;

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

  // ---- protection state (live-probed only) ----------------------------------

  type ProtectState = 'on' | 'off' | 'attention' | 'degraded' | 'unknown';

  function protectState(block: TvStatus): ProtectState {
    if (block.mode === 'degraded') {
      return 'degraded';
    }
    if (block.mode === 'on') {
      return 'on';
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
    if (state === 'on') {
      protHeadline.textContent = 'Protection is ON';
      protText.textContent = 'LG ad and tracking domains are blocked on this TV.';
      protectAction = 'turn-off';
      protectButton.textContent = 'Turn off protection';
      protectButton.disabled = false;
    } else if (state === 'attention') {
      protHeadline.textContent = 'Protection needs attention';
      protText.textContent = 'Protection is off. Your TV is working normally. Turn it on to try again.';
      protectAction = 'turn-on';
      protectButton.textContent = 'Turn on protection';
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
    }
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
  // held); it is released when the status response arrives. `after` runs once
  // the panel is rendered, inside the same callback.
  function refreshStatusInternal(after: (() => void) | null): void {
    if (!LgBlocklistBridge.available()) {
      renderProtection('unknown');
      show('Bridge unavailable', LgBlocklistBridge.diagnose());
      finish();
      if (after) {
        after();
      }
      return;
    }
    show('Reading status...', 'Running the on-device check script through the Homebrew Channel bridge.');
    LgBlocklistBridge.runCheck(function (response: HbExecResponse): void {
      finish();
      var raw = response.stdoutString || '';
      if (!response.returnValue) {
        renderProtection('unknown');
        panel.textContent = 'Status: not readable — the check command failed.';
        show('Status check failed', formatExec(response));
        if (after) {
          after();
        }
        return;
      }
      var block = LgStatus.parse(raw);
      if (!block) {
        renderProtection('unknown');
        panel.textContent = 'Status: unreadable (malformed block) — reinstall the app.';
        show('Status block rejected', 'Raw output (never parsed outside the block):\n' + rawPreview(raw));
        if (after) {
          after();
        }
        return;
      }
      panel.textContent = statusPanel(block);
      var state = protectState(block);
      renderProtection(state);
      show(stateHeadline(state), 'Raw status block:\n' + rawPreview(raw));
      if (after) {
        after();
      }
    });
  }

  function refreshStatus(): void {
    runGuarded(function (): void {
      refreshStatusInternal(null);
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
  el('btn-check').addEventListener('click', checkBridge);
  el('btn-state').addEventListener('click', showHookState);
  el('btn-register').addEventListener('click', registerHook);
  el('btn-remove').addEventListener('click', removeHook);

  document.addEventListener('keydown', function (event: KeyboardEvent): void {
    var key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowRight') {
      focusIndex = (focusIndex + 1) % buttons.length;
      buttons[focusIndex].focus();
      event.preventDefault();
    } else if (key === 'ArrowUp' || key === 'ArrowLeft') {
      focusIndex = (focusIndex + buttons.length - 1) % buttons.length;
      buttons[focusIndex].focus();
      event.preventDefault();
    }
  });

  focusIndex = 0;
  buttons[0].focus();

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
