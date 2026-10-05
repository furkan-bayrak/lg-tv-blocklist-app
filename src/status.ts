/**
 * Strict parser for the app's @@STATUS block (schema 4).
 *
 * Contract (lockstep with app/scripts/check.sh, same IPK):
 *   - exactly one @@STATUS-BEGIN / @@STATUS-END pair, BEGIN first, END last
 *   - exactly 16 keys, each exactly once: schema, ts, hook, hook_target,
 *     scripts, filter, rule, keeper, guard, pointer, gaveup, mode, upstream,
 *     cap, tier, entries
 *   - schema must be exactly '4'
 *   - any other line, duplicate key, missing key, malformed value → REJECT
 * Fail-closed: a rejected block makes the panel show its unknown/error state.
 * It must never render a tier (or any other field) it did not parse — which is
 * why the schema-2 block is rejected outright instead of being read with tier
 * defaulted: an older check.sh is not running the tier-aware behaviour. For the
 * same reason the schema was bumped 3 → 4 when `entries` was added (S6b review
 * F3): a schema-3 block carries no entries count, and a panel that rendered one
 * would have to invent the number.
 * Never parse un-delimited output; never guess.
 *
 * Plain script, not a module: the TV loads compiled JS with plain <script>
 * tags, so the emitted file must stay CommonJS-free. Same pattern as
 * src/bridge.ts — one IIFE assigned to a global (LgStatus); nothing exported.
 */

interface TvStatus {
  schema: '4';
  ts: number;
  hook: 'linked' | 'other' | 'missing';
  hookTarget: string; // absolute path or 'none'
  scripts: 'ok' | 'missing';
  filter: 'up' | 'down';
  rule: 'on' | 'off' | 'absent';
  keeper: 'up' | 'down';
  guard: 'up' | 'down';
  pointer: 'on' | 'off';
  gaveup: 'yes' | 'no';
  mode: 'on' | 'off' | 'degraded';
  upstream: string; // IPv4 or 'none'
  cap: 'none' | 'dnat' | 'unsupported';
  tier: 'safe' | 'strict';
  // Count of blocked_names entries in the effective (materialized) list: every
  // line that is neither a comment nor blank. 0 = no list in place yet; a
  // published list is never 0 (materialize refuses to publish an empty one).
  entries: number;
}

var LgStatus: { parse: (text: string) => TvStatus | null } = (function () {
  var BEGIN = '@@STATUS-BEGIN';
  var END = '@@STATUS-END';
  var KEYS = [
    'schema', 'ts', 'hook', 'hook_target', 'scripts', 'filter', 'rule',
    'keeper', 'guard', 'pointer', 'gaveup', 'mode', 'upstream', 'cap', 'tier',
    'entries'
  ] as const;
  type Key = (typeof KEYS)[number];

  var ENUMS: Record<string, readonly string[]> = {
    hook: ['linked', 'other', 'missing'],
    scripts: ['ok', 'missing'],
    filter: ['up', 'down'],
    rule: ['on', 'off', 'absent'],
    keeper: ['up', 'down'],
    guard: ['up', 'down'],
    pointer: ['on', 'off'],
    gaveup: ['yes', 'no'],
    mode: ['on', 'off', 'degraded'],
    cap: ['none', 'dnat', 'unsupported'],
    tier: ['safe', 'strict']
  };

  function isIpv4(v: string): boolean {
    const parts = v.split('.');
    if (parts.length !== 4) return false;
    for (let i = 0; i < parts.length; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) return false;
      const n = Number(parts[i]);
      if (n < 0 || n > 255) return false;
    }
    return true;
  }

  /** Parse strict schema-4 status text. Returns null on ANY contract violation. */
  function parse(text: string): TvStatus | null {
    if (typeof text !== 'string') return null;
    if (text.indexOf('\r') !== -1) return null;
    const lines = text.split('\n');
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    if (lines.length !== KEYS.length + 2) return null;
    if (lines[0] !== BEGIN) return null;
    if (lines[lines.length - 1] !== END) return null;

    const seen: Partial<Record<Key, string>> = {};
    for (let i = 1; i < lines.length - 1; i++) {
      const line = lines[i];
      const eq = line.indexOf('=');
      if (eq <= 0) return null;
      const key = line.substring(0, eq) as Key;
      const value = line.substring(eq + 1);
      if (KEYS.indexOf(key) === -1) return null;
      if (seen[key] !== undefined) return null;
      if (value.length === 0) return null;
      seen[key] = value;
    }
    for (let i = 0; i < KEYS.length; i++) {
      if (seen[KEYS[i]] === undefined) return null;
    }

    const schema = seen.schema as string;
    if (schema !== '4') return null;
    const tsRaw = seen.ts as string;
    if (!/^\d{1,12}$/.test(tsRaw)) return null;
    // A count, not a guess: decimal digits only, no sign, no leading spaces, and
    // bounded well above any list this app can ship (the shipped lists hold ~123).
    const entriesRaw = seen.entries as string;
    if (!/^\d{1,7}$/.test(entriesRaw)) return null;

    const enumsValid = (() => {
      const keyList = Object.keys(ENUMS);
      for (let i = 0; i < keyList.length; i++) {
        const k = keyList[i];
        const allowed = ENUMS[k];
        if (allowed.indexOf(seen[k as Key] as string) === -1) return false;
      }
      return true;
    })();
    if (!enumsValid) return null;

    const hookTarget = seen.hook_target as string;
    if (hookTarget !== 'none' && hookTarget.charAt(0) !== '/') return null;

    const upstream = seen.upstream as string;
    if (upstream !== 'none' && !isIpv4(upstream)) return null;

    return {
      schema: '4',
      ts: Number(tsRaw),
      hook: seen.hook as TvStatus['hook'],
      hookTarget,
      scripts: seen.scripts as TvStatus['scripts'],
      filter: seen.filter as TvStatus['filter'],
      rule: seen.rule as TvStatus['rule'],
      keeper: seen.keeper as TvStatus['keeper'],
      guard: seen.guard as TvStatus['guard'],
      pointer: seen.pointer as TvStatus['pointer'],
      gaveup: seen.gaveup as TvStatus['gaveup'],
      mode: seen.mode as TvStatus['mode'],
      upstream,
      cap: seen.cap as TvStatus['cap'],
      tier: seen.tier as TvStatus['tier'],
      entries: Number(entriesRaw)
    };
  }

  return { parse: parse };
})();
