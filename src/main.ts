/*
 * S2 UI: the S1 skeleton plus the bridge-spine screen — one button runs the
 * on-device status script through the Homebrew Channel bridge and renders the
 * parsed @@STATUS block (src/status.ts). Raw output is shown for the operator,
 * never parsed outside the block contract (design spec D13b).
 *
 * Single-flight: the HBC bridge has no concurrency lock (S0 measurement), so
 * all commands share one busy flag; a second command while one runs is refused
 * with a plain message.
 *
 * Spatial navigation is hand-rolled: the buttons form one row, arrow keys move
 * focus, OK/Enter activates the focused button (native button behavior).
 * No framework, no runtime dependencies (design spec §3).
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
  var buttons: HTMLElement[] = [
    el('btn-refresh'), el('btn-check'), el('btn-state'), el('btn-register'), el('btn-remove')
  ];
  var focusIndex = 0;
  var busy = false;

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
        finish();
        showExecResult('Register boot hook', response);
        LgBlocklistBridge.readHookState(function (state: HbExecResponse): void {
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

  function hookLine(block: LgStatusBlock): string {
    var state = block.hook === 'linked' ? 'linked to our script'
      : block.hook === 'other' ? 'present but points elsewhere'
      : 'not installed';
    if (block.hookTarget !== 'none') {
      state = state + ' — ' + block.hookTarget;
    }
    return 'Boot hook: ' + state;
  }

  function scriptsLine(block: LgStatusBlock): string {
    return 'Scripts: ' + (block.scripts === 'ok' ? 'present' : 'missing');
  }

  function probedLine(block: LgStatusBlock): string {
    if (block.ts === 0) {
      return 'Probed: TV clock is not set';
    }
    return 'Probed: ' + new Date(block.ts * 1000).toISOString();
  }

  function refreshStatus(): void {
    runGuarded(function (): void {
      if (!LgBlocklistBridge.available()) {
        show('Bridge unavailable', LgBlocklistBridge.diagnose());
        finish();
        return;
      }
      show('Reading status...', 'Running the on-device check script through the Homebrew Channel bridge.');
      LgBlocklistBridge.runCheck(function (response: HbExecResponse): void {
        finish();
        var raw = response.stdoutString || '';
        if (!response.returnValue) {
          panel.textContent = 'Status: not readable — the check command failed.';
          show('Status check failed', formatExec(response));
          return;
        }
        var block = LgBlocklistStatus.parse(raw);
        if (!block) {
          panel.textContent = 'Status: unreadable (malformed block) — reinstall the app.';
          show('Status block rejected', 'Raw output (never parsed outside the block):\n' + rawPreview(raw));
          return;
        }
        panel.textContent = [hookLine(block), scriptsLine(block), probedLine(block)].join('\n');
        var healthy = block.hook === 'linked' && block.scripts === 'ok';
        show(healthy ? 'Status: ok' : 'Status: needs attention',
          'Raw status block:\n' + rawPreview(raw));
      });
    });
  }

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
