/*
 * Bridge to the Homebrew Channel Luna service (org.webosbrew.hbchannel.service).
 *
 * S1 scope: prove the bridge and the startup-hook symlink convention on real
 * hardware. Blocking logic starts in S3/S4 (design spec D12/D13).
 *
 * Contracts already in force (design spec D13):
 *  - Privileged work runs only through fixed commands built from the constants
 *    below. No user input ever reaches a command string. No eval, no sourcing.
 *  - The UI never parses un-delimited stdout; machine-readable status blocks
 *    (@@STATUS-BEGIN/@@STATUS-END) arrive in S2. For S1 the raw response text
 *    is shown to the operator only.
 *
 * ES5 discipline: compiled with target ES5; async/await and generators are
 * banned project-wide (guarded by tools/check-es5.mjs).
 */

interface HbExecResponse {
  returnValue: boolean;
  stdoutString?: string;
  stderrString?: string;
  errorText?: string;
}

interface HbConfiguration {
  returnValue?: boolean;
  root?: boolean;
  homebrewBaseDir?: string;
  telnetDisabled?: boolean;
  failsafe?: boolean;
  sshdEnabled?: boolean;
  blockUpdates?: boolean;
  errorText?: string;
}

interface WebOSRequestOptions {
  method: string;
  parameters?: { [key: string]: unknown };
  onSuccess?: (response: unknown) => void;
  onFailure?: (error: unknown) => void;
}

interface WebOSServiceApi {
  // Library version string (e.g. "1.2.13"); webOSTV.js sets it, old shims may not.
  libVersion?: string;
  service?: {
    request?: (uri: string, options: WebOSRequestOptions) => void;
  };
}

interface WebOSRequestTarget {
  request: (uri: string, options: WebOSRequestOptions) => void;
}

// Set by the vendored webOSTV.js (app/vendor/webOSTV.js), which index.html loads
// before this script. The TV platform does NOT inject it: without the bundle the
// global is simply undefined (provenance: THIRD-PARTY-NOTICES.md). diagnose()
// turns both failure modes into an honest UI message.
declare var webOS: WebOSServiceApi | undefined;

interface LgBlocklistBridgeApi {
  available(): boolean;
  diagnose(): string;
  libVersion(): string;
  getConfiguration(onDone: (response: HbConfiguration) => void): void;
  exec(command: string, onDone: (response: HbExecResponse) => void): void;
  registerHook(onDone: (response: HbExecResponse) => void): void;
  removeHook(onDone: (response: HbExecResponse) => void): void;
  readHookState(onDone: (response: HbExecResponse) => void): void;
}

var LgBlocklistBridge: LgBlocklistBridgeApi = (function (): LgBlocklistBridgeApi {
  var HBC_SERVICE = 'luna://org.webosbrew.hbchannel.service';

  // App install path on a rooted TV (same convention as webosbrew/custom-screensaver
  // and the webosbrew startup-script guide). Task 5 verifies this on the G1; if the
  // hardware test resolves a different path, update this constant, rebuild, and
  // re-run the test (contingency step).
  var APP_DIR = '/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist';
  var HOOK_LINK = '/var/lib/webosbrew/init.d/50-lgtv-blocklist-app';
  var HOOK_TARGET = APP_DIR + '/scripts/boot.sh';

  // Fixed commands only (design spec D13a). All are idempotent.
  var CMD_REGISTER_HOOK =
    'mkdir -p /var/lib/webosbrew/init.d && chmod +x ' + HOOK_TARGET +
    ' && ln -sf ' + HOOK_TARGET + ' ' + HOOK_LINK;
  var CMD_REMOVE_HOOK = 'rm -rf ' + HOOK_LINK;
  var CMD_HOOK_STATE = 'readlink ' + HOOK_LINK;

  function getRequestTarget(): WebOSRequestTarget | null {
    if (typeof webOS === 'undefined' || !webOS) {
      return null;
    }
    var service = webOS.service;
    if (!service || typeof service.request !== 'function') {
      return null;
    }
    return service as WebOSRequestTarget;
  }

  function libVersion(): string {
    if (typeof webOS === 'undefined' || !webOS || typeof webOS.libVersion !== 'string') {
      return '';
    }
    return webOS.libVersion;
  }

  // Empty string = bridge usable; otherwise a reason for the UI. Review fix: the app
  // must never boot to a bare "Bridge unavailable" without saying which piece is missing.
  function diagnose(): string {
    if (typeof webOS === 'undefined' || !webOS) {
      return 'webOSTV.js did not load (window.webOS is undefined), so this app cannot reach ' +
        'the Homebrew Channel service. The installed package looks incomplete - reinstall it ' +
        'from the Homebrew Channel.';
    }
    if (!getRequestTarget()) {
      var found = libVersion();
      var detail = found ? ' (found webOSTV.js ' + found + ')' : '';
      return 'The bundled webOSTV.js is missing webOS.service.request' + detail + ' - it is ' +
        'too old or damaged. Reinstall the app package (it bundles webOSTV.js 1.2.13).';
    }
    return '';
  }

  function available(): boolean {
    return diagnose() === '';
  }

  function describeError(error: unknown): string {
    if (error && typeof error === 'object') {
      var record = error as { errorText?: string };
      if (record.errorText) {
        return record.errorText;
      }
    }
    return String(error);
  }

  function request(
    method: string,
    parameters: { [key: string]: unknown },
    onSuccess: (response: unknown) => void,
    onFailure: (error: unknown) => void
  ): void {
    var target = getRequestTarget();
    if (!target) {
      onFailure({ errorText: 'webOS.service bridge is not available in this window' });
      return;
    }
    target.request(HBC_SERVICE, {
      method: method,
      parameters: parameters,
      onSuccess: onSuccess,
      onFailure: onFailure
    });
  }

  function exec(command: string, onDone: (response: HbExecResponse) => void): void {
    request('exec', { command: command }, function (response: unknown): void {
      onDone(response as HbExecResponse);
    }, function (error: unknown): void {
      onDone({ returnValue: false, errorText: describeError(error) });
    });
  }

  function getConfiguration(onDone: (response: HbConfiguration) => void): void {
    request('getConfiguration', {}, function (response: unknown): void {
      onDone(response as HbConfiguration);
    }, function (error: unknown): void {
      onDone({ returnValue: false, errorText: describeError(error) });
    });
  }

  function registerHook(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_REGISTER_HOOK, onDone);
  }

  function removeHook(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_REMOVE_HOOK, onDone);
  }

  function readHookState(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_HOOK_STATE, onDone);
  }

  return {
    available: available,
    diagnose: diagnose,
    libVersion: libVersion,
    getConfiguration: getConfiguration,
    exec: exec,
    registerHook: registerHook,
    removeHook: removeHook,
    readHookState: readHookState
  };
})();
