/*
 * Domain-toggle payload: the UI's write path into the filter state.
 *
 * `overrides.sh save` is the only thing that may change $STATE/overrides.txt,
 * and it takes its input on stdin as `name=on|off` lines. The bridge has no
 * stdin parameter (HBC's exec payload is `{ command: string }` only), so
 * src/bridge.ts composes the command as a literal head + payload + literal tail:
 *
 *     printf '%s' '<payload>' | sh <APP_DIR>/scripts/overrides.sh save
 *
 * The payload is therefore BYTES ON A COMMAND LINE — the one place in this app
 * where data crosses into a shell string. Two rules keep that safe, and this
 * module owns both:
 *
 *  1. serialize() is the only producer. It validates each change against the
 *     grammar overrides.sh enforces (name charset, name length, membership in
 *     the app's domain list, no duplicates, the line and byte caps) IN THE
 *     WRITER'S ORDER - caps before per-line - so a bad change is refused in the
 *     UI, with the same reason a human would read in the TV's journal, and
 *     without a round trip that would fail in the dark. Every refusal is
 *     all-or-nothing: no partial payload is ever built.
 *  2. isSafePayload() is the gate bridge.ts calls before composing. It accepts
 *     only text that CANNOT change the meaning of the command it lands in:
 *     `[a-z0-9._-]` names, one `=`, `on`/`off`, LF separators, nothing else —
 *     no quote, no backslash, no space, no `$`, no backtick, no glob, no
 *     `;` `|` `&` `<` `>`, no CR, no empty line. A payload that passes can only
 *     ever be the bytes it looks like.
 *
 * The payload is SPARSE: one line per row the UI changed. Unmentioned rows keep
 * their stored state. `name=on` means "this domain is blocked"; overrides.sh
 * stores only the difference against the active tier's preset, so a payload that
 * merely restates the preset clears the file instead of pinning it. Zero changes
 * is a refusal ('empty-payload'), not an empty write: resetting to the preset is
 * `overrides.sh clear`.
 *
 * The grammar exists in one other language (app/scripts/overrides.sh). Its
 * numbers and its character class are pinned against that file by
 * tests/ts/overrides.test.mjs, which reads the script and common.sh: a silent
 * drift between the two ends would otherwise become a payload the writer
 * rejects on the TV, where nobody can see why.
 *
 * Plain script, not a module: the TV loads compiled JS with plain <script> tags
 * (index.html), so the emitted file must stay CommonJS-free. Same pattern as
 * src/bridge.ts and src/status.ts — one IIFE assigned to a global (LgOverrides).
 */

// One row the UI changed. `on` means "this domain is blocked".
interface OverrideChange {
  name: string;
  on: boolean;
}

// Why a payload was refused. The first seven mirror overrides.sh's reject
// reasons one for one, so both ends name the same condition the same way.
// 'unsafe-payload' is local to this module: it can only come from the
// invariant check at the end of serialize() and never reaches the TV.
type OverrideRejectReason =
  | 'empty-payload'
  | 'oversized'
  | 'bad-shape'
  | 'bad-charset'
  | 'name-too-long'
  | 'unknown-domain'
  | 'duplicate'
  | 'unsafe-payload';

interface OverridePayloadResult {
  ok: boolean;
  payload: string; // '' unless ok
  reason: OverrideRejectReason | ''; // '' unless !ok
  line: number; // 1-based index of the change the reason is about, 0 for the payload as a whole
  detail: string; // ASCII, never echoes a payload line — safe to render as-is
}

interface LgOverridesApi {
  serialize(entries: OverrideChange[], knownNames: string[]): OverridePayloadResult;
  isSafePayload(payload: string): boolean;
  MAX_LINES: number;
  MAX_BYTES: number;
  NAME_MAX: number;
}

var LgOverrides: LgOverridesApi = (function (): LgOverridesApi {
  // Lockstep with the TV side: app/scripts/overrides.sh (OV_MAX_BYTES,
  // OV_MAX_LINES) and app/scripts/common.sh (OVERRIDE_NAME_MAX, the bound its
  // reader overrides_apply() already applies). tests/ts/overrides.test.mjs reads
  // both files and fails if these numbers ever drift apart.
  var MAX_BYTES = 16384;
  var MAX_LINES = 512;
  var NAME_MAX = 128;

  // The accepted alphabet, in the two places this module needs it. Every
  // character is ASCII, so a length IS a byte count and the writer's `wc -c`
  // agrees with us. The character class is the one overrides.sh tests for
  // (`*[!a-z0-9._-]*` rejects); the bound in the line pattern is NAME_MAX.
  var NAME_CHARS = /^[a-z0-9._-]+$/;
  var LINE = new RegExp('^[a-z0-9._-]{1,' + NAME_MAX + '}=(?:on|off)$');

  function reject(
    reason: OverrideRejectReason,
    line: number,
    detail: string
  ): OverridePayloadResult {
    return { ok: false, payload: '', reason: reason, line: line, detail: detail };
  }

  // A map with no prototype chain, so a name like '__proto__' or 'constructor'
  // is a key like any other and membership is exactly what was put in.
  function newMap(): { [key: string]: boolean } {
    return Object.create(null) as { [key: string]: boolean };
  }

  /** True when `payload` can be quoted into the save command without changing it. */
  function isSafePayload(payload: string): boolean {
    if (typeof payload !== 'string' || payload.length === 0) return false;
    // The writer measures the bytes it reads (trailing newline included) with
    // `wc -c`, and rejects anything larger than OV_MAX_BYTES: same rule, same
    // counting, so a payload this gate accepts is one it accepts too.
    if (payload.length > MAX_BYTES) return false;
    var lines = payload.split('\n');
    // A trailing newline terminates the last line; it does not add one. This is
    // how the writer counts too (awk NR over the same bytes).
    if (lines[lines.length - 1] === '') lines.pop();
    if (lines.length === 0 || lines.length > MAX_LINES) return false;
    for (var i = 0; i < lines.length; i++) {
      if (!LINE.test(lines[i])) return false;
    }
    return true;
  }

  /**
   * Build the payload for the rows the UI changed, or say why it cannot.
   *
   * The ORDER of the checks is the writer's own order (S6b review F5), because
   * the reason reported here is the reason the TV would journal for the same
   * bytes: a TS-local shape pre-pass for things the writer cannot even receive
   * (it sees bytes, and unparseable bytes are its `bad-shape`), then THE CAPS -
   * overrides.sh measures bytes and lines before it reads a single line, so 600
   * duplicate lines are `oversized` there and must not be `duplicate` here -
   * then the per-line checks (charset, length, membership, duplicate), then
   * `empty-payload` (the writer reports it after its loop), and the
   * isSafePayload invariant last. Only the shape pre-pass has no shell
   * counterpart, and that is documented in each of its refusals.
   */
  function serialize(entries: OverrideChange[], knownNames: string[]): OverridePayloadResult {
    // --- shape, this end only: the writer never sees an array or a boolean ---
    if (!Array.isArray(entries)) {
      return reject('bad-shape', 0, 'the changes were not sent as a list');
    }
    if (!Array.isArray(knownNames)) {
      return reject('unknown-domain', 0, 'the app\'s domain list was not available');
    }
    var known = newMap();
    var knownCount = 0;
    for (var k = 0; k < knownNames.length; k++) {
      if (typeof knownNames[k] === 'string') {
        known[knownNames[k]] = true;
        knownCount++;
      }
    }
    if (knownCount === 0) {
      // Without the domain list no name can be checked against it, and sending a
      // payload the writer will reject line by line is worse than not sending.
      return reject('unknown-domain', 0, 'the app\'s domain list is empty');
    }
    for (var s = 0; s < entries.length; s++) {
      var candidate = entries[s];
      var at = 'change ' + (s + 1);
      if (candidate === null || typeof candidate !== 'object') {
        return reject('bad-shape', s + 1, at + ' is not a name and a state');
      }
      if (typeof candidate.name !== 'string' || typeof candidate.on !== 'boolean') {
        return reject('bad-shape', s + 1, at + ' needs a string name and a true/false state');
      }
      // The writer calls an empty name bad-shape too (its `bad-shape` branch for
      // a line with nothing before the `=`), so the reason words still agree.
      if (candidate.name.length === 0) {
        return reject('bad-shape', s + 1, at + ' has an empty name');
      }
    }

    // --- the caps, in the writer's order: bytes first, then lines ---
    // Measured from what the payload WILL hold: one `name=on|off` line per
    // change, LF-terminated. Name lengths are counted in characters, not bytes;
    // every name that survives the per-line check below is ASCII (a character
    // outside [a-z0-9._-] is refused, and isSafePayload checks the same alphabet
    // again), so the two counts can only differ for a payload that is going to be
    // refused anyway - never for one that is sent.
    var bytes = 0;
    for (var b = 0; b < entries.length; b++) {
      bytes += entries[b].name.length + 4; // '=on' | '=off' + one LF
    }
    if (bytes > MAX_BYTES) {
      return reject('oversized', 0, 'the changes need more than ' + MAX_BYTES + ' bytes');
    }
    if (entries.length > MAX_LINES) {
      return reject('oversized', 0, 'the changes need more than ' + MAX_LINES + ' lines');
    }

    // --- per line, in the writer's order: charset, length, membership, duplicate ---
    var seen = newMap();
    var payload = '';
    for (var i = 0; i < entries.length; i++) {
      var line = i + 1;
      var entry = entries[i];
      var where = 'change ' + line;
      var name = entry.name;
      var on = entry.on;
      if (!NAME_CHARS.test(name)) {
        return reject('bad-charset', line, where + ': the name has a character outside [a-z0-9._-]');
      }
      if (name.length > NAME_MAX) {
        return reject('name-too-long', line, where + ': the name is longer than ' + NAME_MAX + ' characters');
      }
      if (known[name] !== true) {
        return reject('unknown-domain', line, where + ': the name is not in the app\'s domain list');
      }
      if (seen[name] === true) {
        return reject('duplicate', line, where + ': the name appears more than once');
      }
      seen[name] = true;
      payload += name + (on ? '=on' : '=off') + '\n';
    }

    // --- zero assignments, where the writer reports it: after its loop ---
    if (entries.length === 0) {
      return reject('empty-payload', 0, 'no domain changes were given');
    }
    // The invariant the command in src/bridge.ts rests on: what this function
    // returns must pass the gate the bridge applies before composing. Two
    // different code paths, one grammar, so this can only fire if one of them
    // was changed on its own — in which case nothing may be sent.
    if (!isSafePayload(payload)) {
      return reject('unsafe-payload', 0, 'the changes could not be quoted into a shell command');
    }

    return { ok: true, payload: payload, reason: '', line: 0, detail: '' };
  }

  return {
    serialize: serialize,
    isSafePayload: isSafePayload,
    MAX_LINES: MAX_LINES,
    MAX_BYTES: MAX_BYTES,
    NAME_MAX: NAME_MAX
  };
})();
