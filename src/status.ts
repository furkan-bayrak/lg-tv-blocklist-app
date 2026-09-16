/*
 * Parser for the machine-readable status block emitted by app/scripts/*.sh
 * (design spec D13b). Everything the UI trusts lives between exactly one
 * @@STATUS-BEGIN / @@STATUS-END pair. Text outside the pair is ignored;
 * anything inside that is not an allowlisted key=value line causes the whole
 * block to be rejected — the block is never partially parsed.
 *
 * Schema 1 keys (all required, exactly once each):
 *   schema=1                    block format version (lockstep with the app)
 *   ts=<epoch-seconds>          when the block was produced (0 = clock not set)
 *   hook=linked|other|missing   boot-hook symlink state
 *   hook_target=<path|none>     symlink target when it is a plain path
 *   scripts=ok|missing          script files present next to the app
 *
 * The scripts and this app ship in the same IPK, so the key set is strict:
 * unknown or missing keys => reject and tell the user to reinstall.
 *
 * ES5 discipline: target ES5, no async/await/generators (tools/check-es5.mjs).
 */

interface LgStatusBlock {
  schema: number;
  ts: number;
  hook: string;
  hookTarget: string;
  scripts: string;
}

interface LgStatusParser {
  SCHEMA: number;
  parse(text: string): LgStatusBlock | null;
}

var LgBlocklistStatus: LgStatusParser = (function (): LgStatusParser {
  var SCHEMA = 1;
  var BEGIN = '@@STATUS-BEGIN';
  var END = '@@STATUS-END';
  var MAX_BODY_BYTES = 4096;

  var REQUIRED_KEYS: string[] = ['schema', 'ts', 'hook', 'hook_target', 'scripts'];
  var HOOK_VALUES: string[] = ['linked', 'other', 'missing'];
  var SCRIPT_VALUES: string[] = ['ok', 'missing'];
  var PATH_PATTERN = /^[A-Za-z0-9\/._-]+$/;
  var DIGITS_PATTERN = /^[0-9]+$/;
  var KEY_PATTERN = /^[a-z_]+$/;

  function inList(value: string, list: string[]): boolean {
    for (var i = 0; i < list.length; i++) {
      if (list[i] === value) {
        return true;
      }
    }
    return false;
  }

  function parse(text: string): LgStatusBlock | null {
    var beginAt = text.indexOf(BEGIN);
    var endAt = text.indexOf(END);
    if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
      return null;
    }
    // Exactly one delimiter pair: a second BEGIN anywhere (or a second END
    // after the first) means we are looking at junk, not a block.
    if (text.indexOf(BEGIN, beginAt + 1) !== -1) {
      return null;
    }
    if (text.indexOf(END, endAt + 1) !== -1) {
      return null;
    }
    var body = text.substring(beginAt + BEGIN.length, endAt);
    if (body.length > MAX_BODY_BYTES) {
      return null;
    }
    if (body.indexOf('\r') !== -1) {
      return null;
    }
    if (body.charAt(0) !== '\n' || body.charAt(body.length - 1) !== '\n') {
      return null;
    }
    var lines = body.substring(1, body.length - 1).split('\n');
    var values: { [key: string]: string } = Object.create(null);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var eq = line.indexOf('=');
      if (eq <= 0 || eq === line.length - 1) {
        return null;
      }
      var key = line.substring(0, eq);
      var value = line.substring(eq + 1);
      if (!KEY_PATTERN.test(key)) {
        return null;
      }
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        return null;
      }
      values[key] = value;
    }
    for (var r = 0; r < REQUIRED_KEYS.length; r++) {
      if (!Object.prototype.hasOwnProperty.call(values, REQUIRED_KEYS[r])) {
        return null;
      }
    }
    for (var k in values) {
      if (!inList(k, REQUIRED_KEYS)) {
        return null;
      }
    }
    if (values['schema'] !== '1') {
      return null;
    }
    if (!DIGITS_PATTERN.test(values['ts']) || values['ts'].length > 12) {
      return null;
    }
    if (!inList(values['hook'], HOOK_VALUES)) {
      return null;
    }
    if (values['hook_target'] !== 'none' &&
        (values['hook_target'].length > 256 || !PATH_PATTERN.test(values['hook_target']))) {
      return null;
    }
    if (!inList(values['scripts'], SCRIPT_VALUES)) {
      return null;
    }
    return {
      schema: SCHEMA,
      ts: parseInt(values['ts'], 10),
      hook: values['hook'],
      hookTarget: values['hook_target'],
      scripts: values['scripts']
    };
  }

  return {
    SCHEMA: SCHEMA,
    parse: parse
  };
})();
