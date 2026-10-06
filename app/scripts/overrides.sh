#!/bin/sh
# overrides.sh — write the per-domain overrides. Fixed entrypoint: exactly one
# argument, one of save|clear|list; anything else exits 2 without touching the
# state. The UI only ever sends those three constants (src/bridge.ts holds the
# command strings verbatim, and the payload has one documented entry path), and
# this check is what keeps that true if the wrapper set ever changes.
#
# WHAT IT WRITES, AND WHERE THE STATE COMES FROM
# $STATE/overrides.txt holds ONLY the difference against the ACTIVE TIER's
# preset (the bundled list materialize_config copies): `+name` / `-name` lines,
# read back by overrides_apply() in common.sh, the same reader materialize has
# used since S6a. A row that matches its preset is not stored, so the preset is
# always the baseline and an absent file means "exactly the preset": a tier
# switch, or a bundle whose list grew a domain, cannot fight a stale diff.
#
# So save has to know which rows the preset already blocks, and it takes that
# from the SAME resolver materialize uses — tier_list() for the active tier,
# NEVER from the materialized $STATE/filter-input.txt. That distinction is the
# point: a saved-but-not-yet-applied change must still read back as saved (the
# UI renders `list` while the filter may still run the previous list), and a
# stale materialized file must never become the new baseline.
#
# The candidate state is then computed by the SAME reader: copy the preset list
# itself, apply the stored overrides, apply the payload, and only then take the
# difference. save can therefore never store a line that materialize would
# interpret differently (the copy holds the preset's real shapes — exact rules
# and bare zone anchors — not a name list, because the reader's '+name' branch
# tests for the exact rule it adds).
#
# USAGE
#   printf '%s' '<payload>' | sh overrides.sh save
#       Payload on stdin: one `name=on|off` per line for the rows the UI
#       CHANGED (a dense list of every row is equally valid and idempotent;
#       unmentioned rows keep their stored state). Blank lines are ignored, so a
#       trailing newline is not a special case. Grammar — a violation rejects the
#       WHOLE payload (exit 2, journaled, nothing written): name in
#       [a-z0-9._-]{1,128}, exactly one '=', state on|off, name must be a row of
#       $APP_DIR/filter/domains.json, no duplicates, at most 512 lines and 16384
#       bytes, at least one assignment.
#       `name=on` means "this name is blocked": the exact rule '=name' is added
#       (the existing `+name` semantics). Turning ON a zone anchor in the SAFE
#       tier therefore blocks that name exactly, not the whole subtree: the SAFE
#       preset ships no bare anchors by design, and whole-zone blocking is the
#       STRICT preset's bare anchor. The zone's own covered domains are SAFE rows
#       in their own right, so they stay blocked either way.
#   sh overrides.sh clear
#       Remove the file (back to the preset). Idempotent, no payload.
#   sh overrides.sh list
#       The effective set, one `name=on|off` per domains.json row, in file order,
#       no header, never empty while domains.json has rows. Dense on purpose: the
#       UI renders it as-is, and it must be a pure function of the active tier's
#       preset + overrides.txt (never of the materialized filter input).
#
# Rejections (exit 2, journaled as "overrides-reject reason=<r>"[, detail], nothing
# written):
#   bad-usage empty-payload oversized bad-shape bad-charset name-too-long
#   unknown-domain duplicate reject-last
# `reject-last` is the one refusal that is about the RESULT rather than the
# payload: a candidate effective list with no entries at all would leave the
# panel claiming protection while nothing was blocked. It is asked of EVERY
# preset list this bundle ships, not just the active tier's (S6b review F1(a)):
# the stored diff is a diff against whatever tier is active, so a change that is
# harmless under STRICT can empty the SAFE list, and a later `tier.sh safe` would
# apply it without asking again. The refusal is journaled with the preset that
# would have been emptied (`overrides-reject reason=reject-last tier=<t>`), and
# `materialize_config()` refuses the same result a second time from the reader's
# side (`materialize-fail reason=empty-list`, nothing published), which covers a
# diff that pre-exists or a preset that changed under it.
#
# Every rejection above ALSO emits one machine-readable line on stderr, for the
# UI:
#   OVERRIDES-REJECT reason=<reason>[ tier=<name>]
# It is ASCII, single-line, grep-able and carries no user data — never the
# offending name or line number, only the reason word and, for reject-last, the
# preset that would have been emptied (safe|strict, or legacy for a pre-tier
# bundle: the same value the journal detail carries). It is emitted before the
# human prose line, which is unchanged, as are the journal lines and the reason
# words' order. materialize_config() emits the same family for the sibling
# empty-list refusal (OVERRIDES-REJECT reason=empty-list tier=<active>), so the
# UI parses one prefix for "refused: this would leave nothing blocked".
#
# Failures to read the world are exit 1 (journaled "overrides-fail reason=<r>"):
#   no-preset (the active tier's bundled list is missing — the same refusal
#   materialize makes, see the F1 note in common.sh), no-domains, read-failed,
#   write-failed.
#
# Writes are atomic (tmp + chmod 600 + mv). A materialize running at the same
# time sees either the old file or the new one, never half of a diff, so the
# worst case is a single apply cycle that is stale — the same property tier.sh
# has. Nothing else is touched: no lock, no firewall, no filter, no pointer, no
# pointer file. Making the change effective stays the EXISTING apply path, so the
# UI calls runApply() after this when protection is on.
#
# Usage: sh overrides.sh save|clear|list
# Exit:  0 = done · 2 = bad usage / rejected payload (nothing written) ·
#        1 = state unavailable or write failed
#
# LC_ALL=C: every name is ASCII, and the same candidate state must produce the
# same bytes (and the same ordering) on the TV's busybox and on a host.
LC_ALL=C
export LC_ALL

SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

DOMAINS_JSON="$APP_DIR/filter/domains.json"
OV_FILE="$OVERRIDES_FILE"
OV_MAX_BYTES=16384
OV_MAX_LINES=512

# Scratch files, all under $STATE (never in the bundle, never world-readable).
# Every name carries $$: two invocations may overlap (the UI can refresh `list`
# while a `save` runs), and a shared scratch path would let one run's EXIT trap
# delete the other's file — which a first cut of this script did, turning a
# concurrent `list` into a bogus "oversized" rejection. The trap below removes
# this run's files on every exit path; the stored state itself lands on $OV_FILE
# through one mv only.
OV_TMP="$OV_FILE.$$.tmp"
OV_PRE="$STATE/overrides.pre.$$.tmp"
OV_CAND="$STATE/overrides.cand.$$.tmp"
OV_LIST="$STATE/overrides.eff.$$.tmp"
OV_PAY="$STATE/overrides.pay.$$.tmp"
OV_RAW="$STATE/overrides.raw.$$.tmp"
OV_SEEN="$STATE/overrides.seen.$$.tmp"
OV_ROWS="$STATE/overrides.rows.$$.tmp"
OV_SHIP="$STATE/overrides.ship.$$.tmp"
OV_ACT="$STATE/overrides.act.$$.tmp"
trap 'rm -f "$OV_TMP" "$OV_PRE" "$OV_CAND" "$OV_LIST" "$OV_PAY" "$OV_RAW" "$OV_SEEN" "$OV_ROWS" "$OV_SHIP" "$OV_ACT"' EXIT

# Rejected payload / bad usage: nothing written, exit 2. The journal records the
# reason (and the line number where it applies), never the payload's text: the
# journal is read by other components, and the UI already has the payload.
ov_reject() {  # $1 reason, $2 detail (journal only), $3 message (stderr), $4 token field (optional)
  log "overrides-reject reason=$1${2:+ $2}"
  # The UI's copy of the refusal (see the header): stable, ASCII, no user data.
  # $4 is only ever the tier field for reject-last; nothing else may be added.
  echo "OVERRIDES-REJECT reason=$1${4:+ $4}" >&2
  echo "overrides.sh: $3" >&2
  exit 2
}
# Environment not readable/writable: exit 1, nothing written.
ov_fail() {  # $1 reason, $2 message
  log "overrides-fail reason=$1"
  echo "overrides.sh: $2" >&2
  exit 1
}

# The domains.json rows, in file order, one name per line. domains.json is
# generated (tools/gen-domains.mjs) with two-space indentation, so a name is the
# only thing a `"name":` line can hold; tools/gen-domains.mjs pins that shape
# from the other side, and tests/shell/run-tests.sh compares the two.
ov_rows() {
  sed -n 's/^[[:space:]]*"name": "\([a-z0-9._-]\{1,\}\)",$/\1/p' "$DOMAINS_JSON"
}

# The preset's names: one per line, deduplicated. A zone anchor appears twice in
# a list (the exact rule and the bare anchor); both mean "this name is blocked",
# which is what every consumer here asks, and deduplicating keeps the candidate
# comparison and the diff one line per name.
ov_preset_names() {  # $1 list file
  sed -e 's/^=//' -e '/^#/d' -e '/^$/d' "$1" | sort -u
}

# The preset path for the active tier, or exit 1: sets OV_PRESET and fills
# OV_PRE with the baseline names. tier_list() is the F1 resolver shared with
# materialize — this tier's file, the legacy file only when BOTH tier files are
# absent, and a refusal on a partial install (journaled under this script's tag
# so the reason is not mistaken for a materialize run).
ov_preset_file() {
  OV_PRESET=$(tier_list "$(tier_get)" overrides) || ov_fail no-preset \
    "the $(tier_get) preset list is missing (see the journal)"
  [ -f "$OV_PRESET" ] || ov_fail no-preset "$OV_PRESET is missing"
  ov_preset_names "$OV_PRESET" > "$OV_PRE"
  [ -s "$OV_PRE" ] || ov_fail no-preset "$OV_PRESET has no entries"
}

# The candidate the overrides ask for: a copy of the preset LIST (not of the
# names — the reader's '+name' branch adds the exact rule '=name' and tests for
# it, so it has to see the same shapes materialize sees), then the override files
# in order through overrides_apply. $1 = destination, $2.. = override files.
# The candidate the overrides ask for: a copy of the preset LIST (not of the
# names — the reader's '+name' branch adds the exact rule '=name' and tests for
# it, so it has to see the same shapes materialize sees), then the override files
# in order through overrides_apply. $1 = preset list to start from,
# $2 = destination, $3.. = override files.
ov_candidate() {
  [ "$#" -ge 2 ] || ov_fail read-failed "ov_candidate needs a preset and a destination"
  ov_c_preset=$1
  ov_c_dest=$2
  shift 2
  cp "$ov_c_preset" "$ov_c_dest" || ov_fail read-failed "cannot copy $ov_c_preset"
  for ov_f in "$@"; do
    overrides_apply "$ov_c_dest" "$ov_f" || ov_fail read-failed "cannot apply $ov_f"
  done
}

# Every preset list this bundle ships, one path per line: both tier lists when
# they are present, the legacy file only when NEITHER tier file exists — the same
# fallback rule tier_list() applies, written out here because the question is
# "which lists could this install ever materialize", not "which one is active".
ov_shipped_presets() {
  ov_sp_any=0
  for ov_sp_t in safe strict; do
    if [ -f "$APP_DIR/filter/filter-input-$ov_sp_t.txt" ]; then
      printf '%s\n' "$APP_DIR/filter/filter-input-$ov_sp_t.txt"
      ov_sp_any=1
    fi
  done
  [ "$ov_sp_any" -eq 1 ] || printf '%s\n' "$FILTER_INPUT_SRC"
}

# The tier label of a preset path, for the journal detail only.
ov_tier_of() {
  case $1 in
    */filter-input-safe.txt) printf 'safe\n' ;;
    */filter-input-strict.txt) printf 'strict\n' ;;
    *) printf 'legacy\n' ;;
  esac
}

[ "$#" -eq 1 ] || ov_reject bad-usage '' "expected exactly one argument: save|clear|list"
case "$1" in
  save|clear|list) ov_cmd=$1 ;;
  *) ov_reject bad-usage '' "refusing an unknown command (expected save|clear|list)" ;;
esac

ensure_state

case "$ov_cmd" in

  save)
    # 1. Read the payload and hold it to the grammar. Every check happens before
    #    anything is written or removed, and any failure rejects the whole
    #    payload: a half-applied payload is the one outcome the UI could not
    #    explain.
    cat > "$OV_RAW" || ov_fail write-failed "cannot read the payload"
    [ "$(wc -c < "$OV_RAW" | tr -d ' ')" -le "$OV_MAX_BYTES" ] \
      || ov_reject oversized '' "payload is larger than $OV_MAX_BYTES bytes"
    [ "$(awk 'END { print NR }' "$OV_RAW")" -le "$OV_MAX_LINES" ] \
      || ov_reject oversized '' "payload has more than $OV_MAX_LINES lines"

    [ -f "$DOMAINS_JSON" ] || ov_fail no-domains "$DOMAINS_JSON is missing"
    ov_rows > "$OV_ROWS"
    [ -s "$OV_ROWS" ] || ov_fail no-domains "$DOMAINS_JSON has no domain rows"

    # A payload without a trailing newline is still a payload. Normalising the
    # terminator (one extra empty line at most, and blank lines are ignored) keeps
    # the loop below exact: every line read once, no EOF special case.
    [ -s "$OV_RAW" ] && printf '\n' >> "$OV_RAW"

    : > "$OV_PAY"
    : > "$OV_SEEN"
    ov_n=0
    ov_ln=0
    while IFS= read -r ov_line; do
      ov_ln=$((ov_ln + 1))
      [ -n "$ov_line" ] || continue
      case $ov_line in
        *=*) ov_name=${ov_line%%=*}; ov_state=${ov_line#*=} ;;
        *) ov_reject bad-shape "line=$ov_ln" "line $ov_ln is not <name>=<on|off>" ;;
      esac
      case $ov_state in
        on|off) ;;
        *) ov_reject bad-shape "line=$ov_ln" "line $ov_ln: the state must be on or off" ;;
      esac
      [ -n "$ov_name" ] || ov_reject bad-shape "line=$ov_ln" "line $ov_ln: empty name"
      case $ov_name in
        *[!a-z0-9._-]*) ov_reject bad-charset "line=$ov_ln" "line $ov_ln: the name has a character outside [a-z0-9._-]" ;;
      esac
      [ "${#ov_name}" -le "$OVERRIDE_NAME_MAX" ] \
        || ov_reject name-too-long "line=$ov_ln" "line $ov_ln: the name is longer than $OVERRIDE_NAME_MAX characters"
      if ! grep -F -x -q -e "$ov_name" "$OV_ROWS"; then
        ov_reject unknown-domain "line=$ov_ln" "line $ov_ln: $ov_name is not a domain in domains.json"
      fi
      if grep -F -x -q -e "$ov_name" "$OV_SEEN"; then
        ov_reject duplicate "line=$ov_ln" "line $ov_ln: $ov_name appears more than once"
      fi
      printf '%s\n' "$ov_name" >> "$OV_SEEN"
      if [ "$ov_state" = on ]; then
        printf '%s\n' "+$ov_name" >> "$OV_PAY"
      else
        printf '%s\n' "-$ov_name" >> "$OV_PAY"
      fi
      ov_n=$((ov_n + 1))
    done < "$OV_RAW"
    [ "$ov_n" -gt 0 ] || ov_reject empty-payload '' "the payload has no assignments"

    # 2. The candidate the payload asks for: preset, stored state, payload — and
    #    the same question asked of EVERY preset this bundle ships, because the
    #    stored diff is re-baselined by a tier switch: a change that leaves the
    #    active STRICT list 95 entries can still empty the SAFE list, and
    #    `tier.sh safe` would then apply it without asking again (review F1(a)).
    #    The active tier's candidate is the one the diff is taken against; the
    #    others exist only to be held to the same "at least one entry" rule, and
    #    the one that is empty names itself in the journal.
    ov_preset_file
    ov_shipped_presets > "$OV_SHIP"
    : > "$OV_ACT"
    while IFS= read -r ov_p; do
      [ -n "$ov_p" ] || continue
      ov_candidate "$ov_p" "$OV_LIST" "$OV_FILE" "$OV_PAY"
      ov_preset_names "$OV_LIST" > "$OV_CAND"
      if [ ! -s "$OV_CAND" ]; then
        ov_reject reject-last "tier=$(ov_tier_of "$ov_p")" \
          "refusing to turn off the last blocked domain: the $(ov_tier_of "$ov_p") preset list would have no entries left" \
          "tier=$(ov_tier_of "$ov_p")"
      fi
      [ "$ov_p" = "$OV_PRESET" ] && cp "$OV_CAND" "$OV_ACT"
    done < "$OV_SHIP"
    [ -s "$OV_ACT" ] || ov_fail read-failed "the active preset list was not among the shipped ones"
    cp "$OV_ACT" "$OV_CAND"

    # 3. Store the difference against the preset, and only that. Two sorted name
    #    lists are all the diff needs: a name in the candidate but not the preset
    #    is a '+', in the preset but not the candidate a '-'. An empty diff is not
    #    an empty file — it is the absence of one, so the preset is authoritative
    #    again (and a bundle that later grows an entry cannot be fought by a stale
    #    line).
    ov_diff=$(awk '
      NR == FNR { preset[$0] = 1; next }
      { if (!($0 in preset)) print "+" $0; cand[$0] = 1 }
      END { for (n in preset) if (!(n in cand)) print "-" n }
    ' "$OV_PRE" "$OV_CAND" | sort)

    if [ -z "$ov_diff" ]; then
      rm -f "$OV_FILE" || ov_fail write-failed "cannot remove $OV_FILE"
      [ ! -f "$OV_FILE" ] || ov_fail write-failed "$OV_FILE is still there"
      log "overrides-save lines=0 cleared=1"
      echo "RESULT=overrides"
      echo "reason=cleared"
      exit 0
    fi

    ov_lines=$(printf '%s\n' "$ov_diff" | awk 'END { print NR }')
    (umask 077 && printf '%s\n' "$ov_diff" > "$OV_TMP") \
      || ov_fail write-failed "cannot write $OV_TMP"
    chmod 600 "$OV_TMP" 2>/dev/null
    mv -f "$OV_TMP" "$OV_FILE" || ov_fail write-failed "cannot move $OV_TMP into place"
    # Read-back, not trust: the file the filter will read must hold the diff.
    [ "$(cat "$OV_FILE" 2>/dev/null)" = "$ov_diff" ] \
      || ov_fail write-failed "$OV_FILE does not match the diff that was written"
    log "overrides-save lines=$ov_lines"
    echo "RESULT=overrides"
    echo "reason=saved"
    ;;

  clear)
    # No preset and no domains.json needed: clearing is the one command that must
    # work on a damaged install too, because it is the way back to the preset.
    rm -f "$OV_FILE" || ov_fail write-failed "cannot remove $OV_FILE"
    [ ! -f "$OV_FILE" ] || ov_fail write-failed "$OV_FILE is still there"
    log "overrides-clear"
    echo "RESULT=overrides"
    echo "reason=cleared"
    ;;

  list)
    ov_preset_file
    ov_candidate "$OV_PRESET" "$OV_LIST" "$OV_FILE"
    ov_preset_names "$OV_LIST" > "$OV_CAND"
    [ -f "$DOMAINS_JSON" ] || ov_fail no-domains "$DOMAINS_JSON is missing"
    ov_rows > "$OV_ROWS"
    [ -s "$OV_ROWS" ] || ov_fail no-domains "$DOMAINS_JSON has no domain rows"
    # Dense and ordered by domains.json: the UI's row order is the file's, and a
    # row missing from this output would look like a domain the UI forgot.
    awk 'NR == FNR { blocked[$0] = 1; next }
         { printf "%s=%s\n", $0, (($0 in blocked) ? "on" : "off") }' "$OV_CAND" "$OV_ROWS"
    ;;

esac
exit 0
