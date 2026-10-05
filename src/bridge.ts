/*
 * Bridge to the Homebrew Channel Luna service (org.webosbrew.hbchannel.service).
 *
 * Fixed-command discipline (S2, extended in S3): the only way to use the
 * bridge is through the named wrappers below; there is no public generic exec().
 * Adding privileged behavior means adding a new constant + wrapper here, which
 * gets reviewed (design spec D13a: no user input, no downloaded content, no
 * eval, no sourcing — ever). The S3 protection wrappers take no parameters:
 * the command strings are constants, so nothing user- or file-supplied can
 * ever flow into a command.
 *
 * Status contract (D13b): scripts emit one machine-readable block delimited by
 * @@STATUS-BEGIN/@@STATUS-END (parsed by src/status.ts). The UI never parses
 * un-delimited stdout.
 *
 * Tier (S6a T3): the SAFE/STRICT switch is two constants + two wrappers
 * (setTierSafe/setTierStrict). The only thing that varies between them is argv,
 * and it is a compile-time literal, so no user-supplied string ever reaches a
 * command line.
 *
 * Domain toggles (S6b T6): three more wrappers (saveOverrides/clearOverrides/
 * listOverrides) for app/scripts/overrides.sh. clear/list are fixed constants
 * like every other command here. save is the ONE command in this file whose
 * bytes come from outside, and it is built as a literal head + payload +
 * literal tail:
 *
 *     printf '%s' '<payload>' | sh <APP_DIR>/scripts/overrides.sh save
 *
 * The payload is not a string a caller may pass in: saveOverrides() takes the
 * UI's changes and runs them through LgOverrides.serialize() (src/overrides.ts),
 * whose output is the ONLY thing this file will quote into a command. It is
 * then re-checked with LgOverrides.isSafePayload() and refused if it is not
 * exactly `[a-z0-9._-]=on|off` lines, so the accepted alphabet contains no
 * quote, backslash, space, `$`, backtick, glob, `;`, `|`, `&`, `<`, `>` or CR
 * that could escape the quotes and change the command. A refusal answers with
 * returnValue=false and is never sent. overrides.sh re-validates every line
 * anyway — it is the boundary, this file is only the choke point.
 *
 * Why a pipe and single quotes at all: the HBC service has no argv or stdin
 * parameter (its exec payload is `{ command: string }`), and it runs that
 * string through child_process.exec, i.e. a shell — which is also what the
 * existing `&&`-chained register command already relies on.
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
  runApply(onDone: (response: HbExecResponse) => void): void;
  runRollback(onDone: (response: HbExecResponse) => void): void;
  setTierSafe(onDone: (response: HbExecResponse) => void): void;
  setTierStrict(onDone: (response: HbExecResponse) => void): void;
  saveOverrides(
    entries: OverrideChange[],
    knownNames: string[],
    onDone: (response: HbExecResponse) => void
  ): void;
  clearOverrides(onDone: (response: HbExecResponse) => void): void;
  listOverrides(onDone: (response: HbExecResponse) => void): void;
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
  // S3 protection control: ordered fail-open apply / rules-first rollback. No
  // arguments, no variable content — the exact strings are pinned by
  // tests/ts/bridge.test.mjs.
  var CMD_APPLY = 'sh ' + APP_DIR + '/scripts/apply.sh';
  var CMD_ROLLBACK = 'sh ' + APP_DIR + '/scripts/rollback.sh';
  // S6a T3: the tier switch. TWO constants, one per allowed value — the tier is
  // never assembled at runtime and never comes from the DOM, storage, a query
  // parameter or the network, so there is no string that could carry user
  // content into the command line. tier.sh itself re-checks the argument and
  // refuses anything that is not exactly safe|strict (writing nothing).
  var CMD_TIER_SAFE = 'sh ' + APP_DIR + '/scripts/tier.sh safe';
  var CMD_TIER_STRICT = 'sh ' + APP_DIR + '/scripts/tier.sh strict';
  // S6b T6: the domain toggles. `save` is split into a head and a tail so the
  // payload (and only the payload) can sit between two constants; every byte
  // that reaches overrides.sh comes from LgOverrides.serialize(), whose output
  // the gate below re-checks. `clear` and `list` are ordinary constants.
  var CMD_OVERRIDES_SAVE_HEAD = "printf '%s' '";
  var CMD_OVERRIDES_SAVE_TAIL = "' | sh " + APP_DIR + '/scripts/overrides.sh save';
  var CMD_OVERRIDES_CLEAR = 'sh ' + APP_DIR + '/scripts/overrides.sh clear';
  var CMD_OVERRIDES_LIST = 'sh ' + APP_DIR + '/scripts/overrides.sh list';

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

  function runApply(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_APPLY, onDone);
  }

  function runRollback(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_ROLLBACK, onDone);
  }

  function setTierSafe(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_TIER_SAFE, onDone);
  }

  function setTierStrict(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_TIER_STRICT, onDone);
  }

  /**
   * Write the changed domain rows. The changes are validated here and only their
   * serialized form is quoted into the command; an invalid or unsafe payload is
   * refused (returnValue=false, nothing sent). `knownNames` is the app's domain
   * list (app/filter/domains.json) — required, because a name that is not in it
   * is exactly what the writer refuses.
   */
  function saveOverrides(
    entries: OverrideChange[],
    knownNames: string[],
    onDone: (response: HbExecResponse) => void
  ): void {
    if (typeof LgOverrides === 'undefined' || !LgOverrides) {
      onDone({
        returnValue: false,
        errorText: 'The domain changes were not sent: the js/overrides.js module is not loaded, ' +
          'so nothing could be validated. The installed package looks incomplete - reinstall it.'
      });
      return;
    }
    var result = LgOverrides.serialize(entries, knownNames);
    if (!result.ok || !LgOverrides.isSafePayload(result.payload)) {
      onDone({
        returnValue: false,
        errorText: 'The domain changes were not sent: ' +
          (result.detail === '' ? 'the payload did not pass the local safety check.' : result.detail + '.')
      });
      return;
    }
    exec(CMD_OVERRIDES_SAVE_HEAD + result.payload + CMD_OVERRIDES_SAVE_TAIL, onDone);
  }

  /** Reset every domain to the active tier's preset. Idempotent, no payload. */
  function clearOverrides(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_OVERRIDES_CLEAR, onDone);
  }

  /** The effective set (one `name=on|off` line per domain row); the UI parses it. */
  function listOverrides(onDone: (response: HbExecResponse) => void): void {
    exec(CMD_OVERRIDES_LIST, onDone);
  }

  return {
    available: available,
    diagnose: diagnose,
    libVersion: libVersion,
    getConfiguration: getConfiguration,
    registerHook: registerHook,
    removeHook: removeHook,
    readHookState: readHookState,
    runCheck: runCheck,
    runApply: runApply,
    runRollback: runRollback,
    setTierSafe: setTierSafe,
    setTierStrict: setTierStrict,
    saveOverrides: saveOverrides,
    clearOverrides: clearOverrides,
    listOverrides: listOverrides
  };
})();
