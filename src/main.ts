/*
 * S1 skeleton UI: proves the Homebrew Channel bridge and the startup-hook
 * symlink convention on real hardware. Blocking logic starts in S3/S4.
 *
 * Spatial navigation is hand-rolled: the four buttons form one row, arrow keys
 * move focus, OK/Enter activates the focused button (native button behavior).
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
  var output = el('output');
  var buttons: HTMLElement[] = [
    el('btn-check'), el('btn-state'), el('btn-register'), el('btn-remove')
  ];
  var focusIndex = 0;

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

  function checkBridge(): void {
    if (!LgBlocklistBridge.available()) {
      show('Bridge unavailable', LgBlocklistBridge.diagnose());
      return;
    }
    show('Checking bridge...', 'Calling getConfiguration (may take a moment after boot).');
    LgBlocklistBridge.getConfiguration(function (config: HbConfiguration): void {
      var healthy = config.root ? 'root access confirmed' : 'root NOT available';
      show('Bridge: ' + healthy, JSON.stringify(config, null, 2));
    });
  }

  function showHookState(): void {
    show('Reading boot hook state...', 'readlink on the init.d symlink.');
    LgBlocklistBridge.readHookState(function (response: HbExecResponse): void {
      var target = response.stdoutString ? response.stdoutString : '(none)';
      show('Boot hook: ' + target, formatExec(response));
    });
  }

  function registerHook(): void {
    show('Registering boot hook...', 'symlink only — the script is never copied (store rule).');
    LgBlocklistBridge.registerHook(function (response: HbExecResponse): void {
      showExecResult('Register boot hook', response);
      LgBlocklistBridge.readHookState(function (state: HbExecResponse): void {
        var target = state.stdoutString ? state.stdoutString : '(none)';
        output.textContent = formatExec(response) + '\n\nBoot hook now: ' + target;
      });
    });
  }

  function removeHook(): void {
    show('Removing boot hook...', 'rm -rf on the init.d symlink.');
    LgBlocklistBridge.removeHook(function (response: HbExecResponse): void {
      showExecResult('Remove boot hook', response);
    });
  }

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

  // Review fix: state the concrete reason when the bridge cannot work instead of a
  // bare "Bridge unavailable". webOS.* comes from the vendored webOSTV.js, so a
  // missing/damaged bundle is the realistic failure mode.
  var problem = LgBlocklistBridge.diagnose();
  if (problem) {
    show('Bridge unavailable', problem);
  } else {
    var version = LgBlocklistBridge.libVersion();
    var hint = 'Press "Check bridge (root)" to query the Homebrew Channel service.';
    if (version) {
      hint = hint + ' webOSTV.js ' + version + ' loaded.';
    }
    show('Not checked yet', hint);
  }
})();
