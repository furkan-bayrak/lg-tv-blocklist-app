/*
 * Bridge to the Homebrew Channel Luna service (org.webosbrew.hbchannel.service).
 *
 * S2 scope: fixed-command discipline is now ENFORCED — the only way to use the
 * bridge is through the named wrappers below; there is no public generic exec().
 * Adding privileged behavior means adding a new constant + wrapper here, which
 * gets reviewed (design spec D13a: no user input, no downloaded content, no
 * eval, no sourcing — ever).
 *
 * Status contract (D13b): scripts emit one machine-readable block delimited by
 * @@STATUS-BEGIN/@@STATUS-END (parsed by src/status.ts). The UI never parses
 * un-delimited stdout.
 *
 * Platform ceilings (measured on the G1 during S0, see the S0 spike report):
 *  - /exec stdout cap is 204800 bytes; at the cap the child is killed and
 *    returnValue comes back false even though the transport exits 0. Always
 *    trust `returnValue`, never the transport exit code. Keep outputs tiny.
 *  - The bridge has no concurrency lock: callers must serialize calls
 *    (the UI keeps a single in-flight command).
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
  registerHook(onDone: (response: HbExecResponse) => void): void;
  removeHook(onDone: (response: HbExecResponse) => void): void;
  readHookState(onDone: (response: HbExecResponse) => void): void;
  runCheck(onDone: (response: HbExecResponse) => void): void;
}

var LgBlocklistBridge: LgBlocklistBridgeApi = (function (): LgBlocklistBridgeApi {
  var HBC_SERVICE = 'luna://org.webosbrew.hbchannel.service';

  // App install path on a rooted TV (verified on the G1 in S1, Task 5).
  var APP_DIR = '/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist';
  var HOOK_LINK = '/var/lib/webosbrew/init.d/50-lgtv-blocklist-app';
  var HOOK_TARGET = APP_DIR + '/scripts/boot.sh';

  // Fixed commands only (design spec D13a). All are idempotent. The app-side
  // contract test (tests/ts/bridge.test.mjs) pins the exact strings below.
  var CMD_REGISTER_HOOK =
    'mkdir -p /var/lib/webosbrew/init.d && chmod +x ' + HOOK_TARGET +
    ' && ln -sf ' + HOOK_TARGET + ' ' + HOOK_LINK;
  var CMD_REMOVE_HOOK = 'rm -rf ' + HOOK_LINK;
  var CMD_HOOK_STATE = 'readlink ' + HOOK_LINK;
  // Runs the live status probe (app/scripts/check.sh); block parsing happens in
  // src/status.ts, never here.
  var CMD_CHECK = 'sh ' + APP_DIR + '/scripts/check.sh';

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

  // Private on purpose (S2, D13a): the only callers are the fixed wrappers
  // below. Never export this.
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

  function runCheck(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_CHECK, onDone);
  }

  return {
    available: available,
    diagnose: diagnose,
    libVersion: libVersion,
    getConfiguration: getConfiguration,
    registerHook: registerHook,
    removeHook: removeHook,
    readHookState: readHookState,
    runCheck: runCheck
  };
})();
