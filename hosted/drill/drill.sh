#!/usr/bin/env bash
# THE HOSTED RESTORE DRILL (docs/hosted/RUNBOOK.md, "The drill with the real binary"):
# production's deployed image, real Litestream, the drill bucket on R2 with SSE-C, a
# throwaway KEK. On a Mac, with Docker, from a checkout with hosted/'s dependencies
# (bun install --cwd hosted --frozen-lockfile).
#
#   hosted/drill/drill.sh              the whole drill, steps 0-13 (refuses while a run's state exists)
#   hosted/drill/drill.sh --from N     resume a failed run at step N (the state file has its KEKs, tokens, ids)
#   hosted/drill/drill.sh --rehearse   steps 0-3 with BACKUPS=off on a scratch volume: no bucket, no credentials
#                                      (--rehearse --from N resumes a rehearsal)
#
# Run it as one background process. Everything it writes goes to one scratch directory
# outside the repository, $COUNTERPARTS_DRILL_DIR (default $TMPDIR/counterparts-drill):
# RESULTS.md (REHEARSAL.md for --rehearse), the container logs, the state with the
# throwaway KEKs (deleted at step 13), and the worktree at the deployed commit that the
# image is built from. The R2 credentials come from ~/.config/counterparts-drill.env.
# Nothing secret is printed or put on a command line: docker gets secrets by name
# (-e NAME), from this shell's env.
set -Eeuo pipefail
umask 077

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
CLIENT=$HERE/drill-client.ts
TMP=${TMPDIR:-/tmp}
SCRATCH=${COUNTERPARTS_DRILL_DIR:-${TMP%/}/counterparts-drill}
SCRATCH=${SCRATCH%/}
GH_REPO=mlapeter/counterparts
BUN=$HOME/.bun/bin/bun
ENVFILE=$HOME/.config/counterparts-drill.env
LAST=13
case $SCRATCH/ in
  /*) ;;
  *) echo "COUNTERPARTS_DRILL_DIR must be an absolute path" >&2; exit 2 ;;
esac
case $SCRATCH/ in
  "$REPO"/*) echo "COUNTERPARTS_DRILL_DIR is inside the repository ($REPO): the drill's state, KEKs and logs never go there" >&2; exit 2 ;;
esac
mkdir -p "$SCRATCH"
WT=$SCRATCH/worktree   # production's deployed commit, for the image (made at step 0, removed at step 13)
SHA=''                 # that commit: read from GitHub's deployments at step 0, kept in the state for a resume
IMAGE=''

FROM=0
REHEARSE=0
while (( $# )); do
  case $1 in
    --from) FROM=${2:?--from N}; [[ $FROM =~ ^([0-9]|1[0-3])$ ]] || { echo "--from takes 0-13" >&2; exit 2; }; shift 2 ;;
    --rehearse) REHEARSE=1; LAST=3; shift ;;
    *) echo "usage: drill.sh [--rehearse] [--from N]" >&2; exit 2 ;;
  esac
done

if (( REHEARSE )); then
  NAME=drill-rehearsal VOL=cp-drill-rehearsal TAG=rehearsal RESULTS=$SCRATCH/REHEARSAL.md
  BACKUP_ARGS=(-e BACKUPS=off)
else
  NAME=drill VOL=cp-drill TAG=drill RESULTS=$SCRATCH/RESULTS.md
  BACKUP_ARGS=(-e R2_ENDPOINT -e R2_BUCKET -e R2_ACCESS_KEY_ID -e R2_SECRET_ACCESS_KEY)
fi
STATE=$SCRATCH/$TAG-state.env                 # this script's: KEKs, store ids, TXIDs, step reached
export DRILL_STATE=$SCRATCH/$TAG-state.json   # the client's: emails, invite codes, cookie jars, tokens, nonces
export DRILL_NAME=$NAME
LOGS=$SCRATCH/logs-$TAG
mkdir -p "$LOGS"
LOG=$LOGS/none.log
STEP=pre
RUN_PID=0

# ── results, failures, state ──────────────────────────────────────────────────
redact() { sed -E 's/token=[^&[:space:]]+/token=REDACTED/g; s/v1:[A-Za-z0-9+\/=]{20,}/v1:REDACTED/g; s#[a-z0-9]{32}\.r2\.cloudflarestorage\.com#<account>.r2.cloudflarestorage.com#g'; }
note() { printf '%s\n' "$*" | redact | tee -a "$RESULTS" >&2; } # stderr: never swallowed by a $(…)
pass() { note "- step $STEP **pass**: $*"; }
finding() { note "- step $STEP FINDING: $*"; }
FAILED=$LOGS/.failed; rm -f "$FAILED" # a marker file: a fail inside a $(…) subshell must reach the EXIT trap too
fail() {
  : > "$FAILED"
  note "- step $STEP **FAIL**: expected $1; saw $2. Log: $LOG"
  if [[ $STEP != pre ]]; then note "  (resume after fixing: drill.sh --from $STEP)"; fi
  exit 1
}
# Anything that fails without saying so (a docker or git command under set -e) still leaves its line here.
trap 'LAST_ERR="line $LINENO: $BASH_COMMAND"' ERR
trap 'LAST_ERR="a signal (killed)"; exit 143' TERM INT HUP
# On exit, this script's log followers end too (the detached container lives on); a resume
# attaches exactly one new follower, so no line is written twice.
trap 'rc=$?; for j in $(jobs -p); do kill -INT "$j" 2>/dev/null; kill "$j" 2>/dev/null; done; if [[ $rc -ne 0 && ! -f $FAILED ]]; then note "- step $STEP **FAIL**: ${LAST_ERR:-a command} exited $rc. Log: $LOG"; [[ $STEP == pre ]] || note "  (resume after fixing: drill.sh --from $STEP)"; fi' EXIT
save() { touch "$STATE"; chmod 600 "$STATE"; sed -i '' "/^$1=/d" "$STATE"; printf '%s=%q\n' "$1" "$2" >> "$STATE"; printf -v "$1" '%s' "$2"; }
# The client: its stdout is the result line, or "expected …; saw …" with exit 1 (its stderr goes to a log).
c() {
  local out
  if out=$(cd "$SCRATCH" && "$BUN" "$CLIENT" "$@" 2>>"$LOGS/client-stderr.log"); then printf '%s\n' "$out"; else
    : > "$FAILED"; note "- step $STEP **FAIL** (drill-client $1): $out. Log: $LOG"; note "  (resume after fixing: drill.sh --from $STEP)"; exit 1
  fi
}
cn() { local out; out=$(c "$@") || exit 1; note "  $out"; } # a client result, noted
ctry() { (cd "$SCRATCH" && "$BUN" "$CLIENT" "$@" 2>>"$LOGS/client-stderr.log"); } # may fail: the caller decides
now() { perl -MTime::HiRes=time -e 'printf "%.1f", time'; }

# ── the container ─────────────────────────────────────────────────────────────
# One container, detached (no --rm: this script removes it, so a killed script never takes
# the container with it), its output appended to $LOG after a start marker by a
# `docker logs -f` follower. RUN_PID is the follower: it ends when the container stops.
port_free() { [[ -z $(lsof -nP -iTCP:8080 -sTCP:LISTEN 2>/dev/null) ]] || fail "port 8080 free" "$(lsof -nP -iTCP:8080 -sTCP:LISTEN | tail -1 | awk '{print $1, $2}')"; }
start() { # start <log> [docker args, e.g. -e RESTORE_ON_BOOT=1]
  LOG=$1; shift
  gone || fail "no $NAME container before a start (docker stop $NAME; docker rm $NAME first)" "one exists"
  port_free
  printf '=== drill start %s\n' "$(date '+%H:%M:%S')" >> "$LOG"
  docker run -d --name "$NAME" -p 127.0.0.1:8080:8080 -v "$VOL":/data \
    -e HOSTED_DATA_ROOT=/data -e PUBLIC_ORIGIN=http://127.0.0.1:8080 -e MAIL=log -e HOSTED_KEKS \
    "${BACKUP_ARGS[@]}" "$@" "$IMAGE" serve > /dev/null
  docker logs -f "$NAME" >> "$LOG" 2>&1 &
  RUN_PID=$!
}
# This container's part of $LOG: everything after the last start marker.
logtext() { awk '/^=== drill start /{buf=""; next} {buf=buf $0 "\n"} END{printf "%s", buf}' "$LOG"; }
lg() { grep "$@" <<<"$(logtext)"; }
running() { [[ -n $(docker ps -q -f "name=^/${NAME}$") ]]; }
gone() { [[ -z $(docker ps -aq -f "name=^/${NAME}$") ]]; }
wait_serving() { # wait_serving <seconds>: 0 once it says serving, 1 if it exited first or time ran out
  local until=$((SECONDS + $1))
  while (( SECONDS < until )); do
    lg -q '\[hosted\] serving ' && return 0
    running || { sleep 1; lg -q '\[hosted\] serving ' && return 0; return 1; }
    sleep 0.5
  done
  return 1
}
wait_gone() { local i; for i in $(seq 1 60); do gone && return 0; sleep 0.5; done; return 1; }
end_follower() { if (( RUN_PID > 0 )); then wait "$RUN_PID" 2>/dev/null || true; fi; RUN_PID=0; }
remove() { docker rm "$NAME" > /dev/null; wait_gone || fail "the container removed" "it is still listed"; }
serve() { # serve <log> [docker args]: start, and fail unless it serves
  start "$@"
  wait_serving 300 || fail '"[hosted] serving" within 300 s' "$(hosted_lines | tail -5 | tr '\n' ' ')"
}
# A resumed run: the container from step $1 must be up; its log is re-attached (this shell didn't start it).
need_running() {
  running || fail "container $NAME running (resume needs the one from step $1; else start again from step $1)" "no such container"
  if (( RUN_PID == 0 )); then
    printf '=== drill re-attached %s (log lines from before this are missing)\n' "$(date '+%H:%M:%S')" >> "$LOG"
    docker logs -f --since "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NAME" >> "$LOG" 2>&1 &
    RUN_PID=$!
  fi
}
# A start that must refuse: its exit code. One that serves instead is stopped at once, and fails the step.
refused_start() { # refused_start <log> [docker args] -> sets RC
  start "$@"
  local until=$((SECONDS + 120))
  while running; do
    if lg -q '\[hosted\] serving ' || (( SECONDS > until )); then
      docker stop -t 5 "$NAME" >/dev/null 2>&1 || true; end_follower; docker rm "$NAME" >/dev/null 2>&1 || true
      fail "a refusal (exit 1, no serving)" "$(lg -q '\[hosted\] serving ' && echo "it served" || echo "still running after 120 s")"
    fi
    sleep 0.5
  done
  RC=$(docker wait "$NAME")
  end_follower; remove
}
fresh_volume() { # a step that starts from an empty volume (and works under --from after a failure)
  if running; then docker stop -t 60 "$NAME" >/dev/null; fi
  end_follower
  if ! gone; then remove; fi
  docker volume rm -f "$VOL" >/dev/null
}
stop_timed() { # stop_timed: docker stop -t 60, sets STOP_S; then the container is removed
  local t0 t1
  t0=$(now); docker stop -t 60 "$NAME" >/dev/null; t1=$(now)
  STOP_S=$(perl -e "printf '%.1f', $t1 - $t0")
  end_follower
  remove
}
hosted_lines() { { lg -E '^\[hosted\]' || true; } | grep -v 'an email for' | redact | sed 's/^/    /'; }
volume_ls() { docker run --rm -v "$VOL":/data --entrypoint sh "$IMAGE" -c 'cd /data && find . -mindepth 1 | sort | head -20'; }
user1_store() { docker exec "$NAME" sh -c 'ls -d /data/tenants/*/store/counterparts.sqlite 2>/dev/null' || true; }
# Litestream's own view of every database it replicates, beside whatever its log lines in $LOG say
# (a build from before 2026-11-02 dropped them: Litestream logged to stdout, which the sidecar ignores).
ltx_diagnostic() {
  local out=$LOGS/$STEP-litestream-ltx.log db
  export LITESTREAM_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
  for db in $(docker exec "$NAME" sed -n 's/^  - path: "\(.*\)"$/\1/p' /data/litestream.yml 2>/dev/null); do
    { echo "== $db"; docker exec -e LITESTREAM_ACCESS_KEY_ID -e LITESTREAM_SECRET_ACCESS_KEY "$NAME" litestream ltx -config /data/litestream.yml -level all "$db" 2>&1 || true; } >> "$out"
  done
  note "  diagnostic: litestream ltx for each database in $out"
}
wait_txid() { # wait_txid <prefix> <baseline> -> prints the new maxTXID line; on timeout, the diagnostic and FAIL
  local out
  if out=$(cd "$SCRATCH" && "$BUN" "$CLIENT" r2-wait "$1" "$2" 60 2>>"$LOGS/client-stderr.log"); then printf '%s\n' "$out"; else
    ltx_diagnostic; fail "replication: maxTXID under $1 above $2 within 60 s" "$out"
  fi
}

# ── preflight (every run) ─────────────────────────────────────────────────────
STEP=pre
[[ -d $REPO/hosted/node_modules/oauth4webapi && -d $REPO/hosted/node_modules/aws4fetch ]] || fail "hosted deps installed in this checkout (bun install --cwd hosted --frozen-lockfile)" "no hosted/node_modules/oauth4webapi or aws4fetch"
[[ -x $BUN ]] || fail "bun at $BUN" "none"
command -v gh >/dev/null || fail "gh (signed in) for the deployed commit" "no gh"
docker info >/dev/null 2>&1 || fail "Docker running" "docker info failed"
if (( ! REHEARSE )); then
  [[ -f $ENVFILE ]] || fail "$ENVFILE (R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY; chmod 600; docs/hosted/RUNBOOK.md, The drill)" "no such file"
  [[ $(stat -f %Lp "$ENVFILE") == 600 ]] || fail "$ENVFILE mode 600" "mode $(stat -f %Lp "$ENVFILE")"
  # KEY=VALUE lines, parsed rather than sourced: comments, blank lines and quotes allowed, nothing run.
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%%[[:space:]]#*}
    [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?(R2_ENDPOINT|R2_BUCKET|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)=(.*)$ ]] || continue
    key=${BASH_REMATCH[2]} val=${BASH_REMATCH[3]}
    val=${val%"${val##*[![:space:]]}"}
    if [[ $val =~ ^\"(.*)\"$ || $val =~ ^\'(.*)\'$ ]]; then val=${BASH_REMATCH[1]}; fi
    export "$key=$val"
  done < "$ENVFILE"
  for v in R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do [[ -n ${!v:-} ]] || fail "$v set in $ENVFILE" "empty"; done
  [[ $R2_BUCKET == counterparts-drill ]] || fail "R2_BUCKET=counterparts-drill (never the production bucket)" "$R2_BUCKET"
  [[ $R2_ENDPOINT =~ ^https://[a-z0-9]+\.r2\.cloudflarestorage\.com$ ]] || fail "R2_ENDPOINT https://<account-id>.r2.cloudflarestorage.com, no /bucket on the end" "$(sed -E 's#//[a-z0-9]+\.#//<account>.#' <<<"$R2_ENDPOINT")"
fi

if (( FROM == 0 )); then
  if [[ -f $STATE || -f $DRILL_STATE ]]; then
    reached=$(sed -n 's/^REACHED=//p' "$STATE" 2>/dev/null || true)
    fail "no run in progress" "state from a run that passed step ${reached:-none}: drill.sh --from $(( ${reached:-0} + 1 )), or remove $STATE and $DRILL_STATE"
  fi
  { echo; echo "# $( ((REHEARSE)) && echo Rehearsal || echo Drill ) $(date '+%Y-%m-%d %H:%M %Z')"; echo; echo "Scripts from checkout $(git -C "$REPO" rev-parse --short HEAD), container $NAME, volume $VOL. Logs: $LOGS"; echo; } >> "$RESULTS"
else
  [[ -f $STATE ]] || fail "a state file to resume from ($STATE)" "none: start from step 0"
  . "$STATE"
  [[ -n $SHA ]] || fail "the deployed commit in the state file" "none: start from step 0"
  IMAGE=counterparts-drill:${SHA:0:8}
  docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "the image $IMAGE from step 0" "no such image: start from step 0"
  export HOSTED_KEKS=$K1
  note ""; note "## resumed at step $FROM, $(date '+%H:%M:%S') (last passed: ${REACHED:-none})"
  LOG=$(ls -t "$LOGS"/*.log 2>/dev/null | head -1 || echo "$LOGS/none.log")
  RUN_PID=0
fi

# ── the steps ─────────────────────────────────────────────────────────────────

step_0() { # preflight: deployed sha and its worktree, Docker, port, no leftovers, empty bucket, the image
  LOG=$LOGS/0-build.log
  # The hosted service's environment only (Railway project fabulous-recreation, service counterparts;
  # content-beauty deploys from the same repository): its newest deployment whose latest status is success.
  # The image is built from exactly that commit, whatever this checkout is on.
  local env="fabulous-recreation / production" deployed="" id state
  for id in $(gh api "repos/$GH_REPO/deployments?environment=fabulous-recreation%20%2F%20production&per_page=10" --jq '.[].id'); do
    state=$(gh api "repos/$GH_REPO/deployments/$id/statuses" --jq '.[0].state')
    if [[ $state == success ]]; then deployed=$(gh api "repos/$GH_REPO/deployments/$id" --jq .sha); break; fi
  done
  [[ $deployed =~ ^[0-9a-f]{40}$ ]] || fail "the sha of $env's newest successful deployment" "${deployed:-none found}"
  SHA=$deployed IMAGE=counterparts-drill:${deployed:0:8}
  git -C "$REPO" fetch -q origin
  git -C "$REPO" cat-file -e "$SHA^{commit}" 2>/dev/null || fail "commit $SHA in this checkout after git fetch" "not found"
  if [[ -e $WT ]]; then
    [[ $(git -C "$WT" rev-parse HEAD 2>/dev/null || true) == "$SHA" ]] || fail "the worktree $WT at $SHA (or remove it: git -C $REPO worktree remove --force $WT)" "$(git -C "$WT" rev-parse HEAD 2>/dev/null || echo "not a worktree")"
  else
    # umask 022, not this script's 077: the image copies these files as they are, and runs as node, not root.
    (umask 022 && git -C "$REPO" worktree add -q --detach "$WT" "$SHA") || fail "git worktree add --detach $WT $SHA" "it failed"
  fi
  [[ -z $(git -C "$WT" status --porcelain) ]] || fail "the worktree $WT clean" "local changes"
  [[ $(stat -f %Lp "$WT/src") == 755 ]] || fail "the worktree readable by the image's user (src/ mode 755: made under umask 022)" "mode $(stat -f %Lp "$WT/src") (remove it: git -C $REPO worktree remove --force $WT)"
  port_free
  gone || fail "no container named $NAME" "one exists"
  ! docker volume inspect "$VOL" >/dev/null 2>&1 || fail "no volume $VOL" "it exists"
  if (( ! REHEARSE )); then cn r2-empty; fi
  docker build -f "$WT/hosted/Dockerfile" -t "$IMAGE" "$WT" > "$LOG" 2>&1 || fail "the image builds" "docker build failed"
  local lsv; lsv=$(docker run --rm --entrypoint litestream "$IMAGE" version)
  [[ $lsv == *0.5.17* ]] || fail "Litestream 0.5.17 in the image" "$lsv"
  local r1 r2 k
  r1=$(openssl rand -base64 32) || fail "openssl rand to succeed" "it failed"
  r2=$(openssl rand -base64 32) || fail "openssl rand to succeed" "it failed"
  for k in "$r1" "$r2"; do
    [[ $(printf '%s' "$k" | base64 -D | wc -c | tr -d ' ') == 32 ]] || fail "a throwaway key of 32 bytes" "$(printf '%s' "$k" | base64 -D | wc -c | tr -d ' ') bytes"
  done
  [[ $r1 != "$r2" ]] || fail "K1 and K2 different" "the same"
  save SHA "$SHA"
  save K1 "v1:$r1"
  save K2 "v1:$r2" # the same label, other bytes: a mistyped key
  . "$STATE"
  pass "$env's deployed sha $SHA, port 8080 free, no $NAME container or $VOL volume, image $(docker image inspect -f '{{.Id}}' "$IMAGE" | cut -c8-19) ($(docker image inspect -f '{{.Architecture}}' "$IMAGE")), litestream $lsv; throwaway K1 and K2 (v1:, 32 bytes each, different) made"
}

step_1() { # serve under K1, two invites
  export HOSTED_KEKS=$K1
  serve "$LOGS/1-serve.log"
  note "  $(lg -m1 '\[hosted\] serving')"
  cn invite 1; cn invite 2
  if (( ! REHEARSE )); then
    ACC0=$(c r2-settle control/accounts.sqlite/); save ACC0 "$ACC0"
    note "  control/accounts.sqlite maxTXID after the invites (settled): $ACC0"
  fi
  pass "serving; two invites"
}

step_2() { # two sign-ups; 10 s before any /mcp; the sign-up's backup before the first open
  LOG=$LOGS/1-serve.log; need_running 1
  local before; before=$(wc -l < "$LOG")
  cn signup 1 "$LOG"; cn signup 2 "$LOG"
  sleep 10
  local since; since=$(tail -n +"$((before + 1))" "$LOG")
  local starts exits; starts=$(grep -c 'sidecar.start' <<<"$since" || true); exits=$(grep -c 'sidecar.exit' <<<"$since" || true)
  note "  sidecar during the sign-ups: $exits sidecar.exit, $starts sidecar.start (exit then start = the normal reload)"
  if grep -qE 'sidecar\.backoff|sidecar\.kill|Error:' <<<"$since"; then finding "$(grep -E 'sidecar\.backoff|sidecar\.kill|Error:' <<<"$since" | redact | head -5 | tr '\n' ' ')"; fi
  [[ -z $(user1_store) ]] || fail "no store database on the volume before any /mcp" "$(user1_store)"
  note "  store directories on the volume: $(docker exec "$NAME" sh -c 'ls /data/tenants 2>/dev/null | wc -l' | tr -d ' '), store databases: 0"
  if (( ! REHEARSE )); then
    local keys; keys=$(c r2-list keys/)
    [[ $(grep -c . <<<"$keys") == 3 && $keys == *keys/control.wrapped* ]] || fail "keys/: control.wrapped + one per sign-up (3)" "$(tr '\n' ' ' <<<"$keys")"
    local rose; rose=$(wait_txid control/accounts.sqlite/ "$ACC0")
    note "  control/accounts.sqlite maxTXID after the sign-ups: $rose, while no store database exists yet"
    local acc1 oa1; acc1=$(c r2-settle control/accounts.sqlite/); oa1=$(c r2-settle control/oauth.sqlite/)
    save ACC1 "$acc1"; save OA1 "$oa1"
    note "  baselines for step 4 (settled): control/accounts.sqlite $acc1, control/oauth.sqlite $oa1"
  fi
  pass "two sign-ups through the emailed link; paused 10 s; user 2 never connects"
}

step_3() { # user 1: OAuth, wake, remember A; the store id
  LOG=$LOGS/1-serve.log; need_running 1
  cn oauth
  cn wake
  local db; db=$(user1_store)
  [[ $(grep -c . <<<"$db") == 1 ]] || fail "one store database after wake (user 1's)" "${db:-none}"
  STORE1=$(sed -E 's#^/data/tenants/([^/]+)/store/.*#\1#' <<<"$db"); save STORE1 "$STORE1"
  if (( ! REHEARSE )); then
    local keys; keys=$(c r2-list keys/)
    grep -qx "keys/$STORE1.wrapped" <<<"$keys" && [[ $STORE1 != control ]] || fail "keys/$STORE1.wrapped in the bucket, not control" "$(tr '\n' ' ' <<<"$keys")"
    STORE2=$(grep -v -e "keys/$STORE1.wrapped" -e keys/control.wrapped <<<"$keys" | sed -E 's#^keys/(.*)\.wrapped$#\1#'); save STORE2 "$STORE2"
    T0=$(c r2-settle "tenants/$STORE1/"); save T0 "$T0"
    note "  user 1's store ${STORE1:0:8}… (key object in the bucket; user 2's ${STORE2:0:8}…); tenants/ maxTXID before remember A (settled after wake): $T0"
  else
    note "  user 1's store ${STORE1:0:8}…"
  fi
  cn remember A
  if (( REHEARSE )); then
    # The rehearsal's own extras: recall, the refresh flow, and both across a plain restart.
    cn recall A
    cn refresh
    cn recall A
    stop_timed; note "  docker stop -t 60 took $STOP_S s"
    serve "$LOGS/3-restart.log"
    note "  restarted on the same volume:"
    cn recall A
    cn refresh
    cn recall A
    cn remember B; cn remember C
    cn recall A 'B!' C
  fi
  pass "OAuth (DCR, PKCE, Allow), wake, remember A"
}

step_4() { # replication by TXID: the store, and both control databases (the grant, markOpened)
  LOG=$LOGS/1-serve.log; need_running 1
  local t1 a o
  t1=$(wait_txid "tenants/$STORE1/" "$T0"); save T1 "${t1%% *}"
  a=$(wait_txid control/accounts.sqlite/ "$ACC1")
  o=$(wait_txid control/oauth.sqlite/ "$OA1")
  pass "maxTXID rose: tenants/${STORE1:0:8}… $t1; control/accounts.sqlite $a; control/oauth.sqlite $o"
}

step_5() { # SSE-C: plain GETs refused, the plain key object not
  LOG=$LOGS/1-serve.log; need_running 1
  local out; out=$(c ssec-check "$STORE1"); pass "$out"
}

step_6() { # remember B, then stop at once (does B survive the stop?)
  LOG=$LOGS/1-serve.log; need_running 1
  cn remember B
  stop_timed
  note "  docker stop -t 60 took $STOP_S s"
  if lg -q 'sidecar.kill'; then finding "sidecar.kill in the log: the shutdown sync was cut short"; fi
  note "  last [hosted] lines of the log:"; hosted_lines | tail -n 6 | tee -a "$RESULTS"
  local t; t=$(c r2-txid "tenants/$STORE1/")
  note "  tenants/${STORE1:0:8}… maxTXID after the stop: $t (after remember A: $T1)"
  pass "stopped in $STOP_S s (record only, not Railway's drain setting); whether B survived the stop is step 10's recall"
}

step_7() { # the volume is gone
  LOG=$LOGS/1-serve.log
  gone || fail "no $NAME container (removed after the stop)" "it is still listed"
  docker volume rm "$VOL" >/dev/null
  ! docker volume inspect "$VOL" >/dev/null 2>&1 || fail "docker volume inspect $VOL to fail" "it succeeded"
  pass "container gone, volume $VOL removed"
}

step_8() { # an empty volume beside a bucket with backups: refused without RESTORE_ON_BOOT
  fresh_volume
  export HOSTED_KEKS=$K1
  local before after; before=$(c r2-snapshot)
  refused_start "$LOGS/8-refuse.log"
  [[ $RC == 1 ]] || fail "exit 1" "exit $RC"
  lg -q 'this volume has no accounts database, but the bucket has backups' || fail '"this volume has no accounts database, but the bucket has backups"' "$(hosted_lines | tr '\n' ' ')"
  after=$(c r2-snapshot); [[ $after == "$before" ]] || fail "the bucket unchanged ($before)" "$after"
  local left; left=$(volume_ls); [[ -z $left ]] || fail "the volume empty" "$(tr '\n' ' ' <<<"$left")"
  note "  refusal:"; hosted_lines | tee -a "$RESULTS"
  pass "exit 1, refused; bucket unchanged ($after); volume empty"
}

step_9() { # RESTORE_ON_BOOT=1 under a wrong KEK (K2, same v1 label): refused, harmlessly
  fresh_volume
  local before after; before=$(c r2-snapshot)
  export HOSTED_KEKS=$K2
  refused_start "$LOGS/9-wrong-key.log" -e RESTORE_ON_BOOT=1
  export HOSTED_KEKS=$K1
  [[ $RC == 1 ]] || fail "exit 1" "exit $RC"
  lg -q "open with the KEK ring" || fail "the refusal \"… doesn't open with the KEK ring …\" (backup.ts:236)" "$(hosted_lines | tr '\n' ' ')"
  ! lg -q '\[hosted\] serving' || fail "no serving under the wrong KEK" "it served"
  ! lg -q 'restored the control databases' || fail "no control databases restored under the wrong KEK" "$(lg 'restored the control')"
  after=$(c r2-snapshot); [[ $after == "$before" ]] || fail "the bucket unchanged ($before)" "$after"
  local left; left=$(volume_ls)
  ! docker run --rm -v "$VOL":/data --entrypoint test "$IMAGE" -e /data/control/accounts.sqlite || fail "no accounts database on the volume" "$(tr '\n' ' ' <<<"$left")"
  note "  exit $RC; refusal:"; hosted_lines | tee -a "$RESULTS"
  note "  volume after: ${left:-empty}" ; docker volume rm "$VOL" >/dev/null
  pass "refused (exit $RC), nothing restored, bucket unchanged; volume removed"
}

step_10() { # RESTORE_ON_BOOT=1 under K1: everything back, the old token, then the refresh
  fresh_volume
  export HOSTED_KEKS=$K1
  serve "$LOGS/10-restore.log" -e RESTORE_ON_BOOT=1
  lg -q 'restored the control databases: 2 restored' || fail '"restored the control databases: 2 restored"' "$(hosted_lines | tr '\n' ' ')"
  lg -q 'RESTORE_ON_BOOT: 1 store databases restored' || fail '"RESTORE_ON_BOOT: 1 store databases restored"' "$(hosted_lines | tr '\n' ' ')"
  ! lg -qE 'FAILED|waits? for a restore' || fail "no FAILED and no \"wait(s) for a restore\" (user 2's never-opened store included)" "$(lg -E 'FAILED|waits? for a restore' | redact)"
  note "  start-up:"; hosted_lines | tee -a "$RESULTS"
  local age out b; age=$(c token-age)
  if (( age < 58 )); then note "  with the access token from before the restore ($age min old):"; out=$(c recall A 'B!'); note "  $out"
  else note "  the access token is $age min old: expired by time (ACCESS_TTL 1 h), not by the restore; straight to the refresh"; fi
  cn refresh
  note "  with the new access token:"; out=$(c recall A 'B!'); note "  $out"
  if [[ $out == *"NOT found"* ]]; then b="B did NOT survive the stop"; finding "B's newest nonce (remembered just before step 6's stop) is not in the restored store: the last write before a stop was lost"
  else b="B survived the stop (B's newest nonce recalled)"; fi
  pass "control databases and user 1's store restored, user 2's never-opened store no failure; A recalled; $b; the refresh works"
}

step_11() { # replication after a restore
  LOG=$LOGS/10-restore.log; need_running 10
  local t2 t3; t2=$(c r2-settle "tenants/$STORE1/") # after the restore's own writes and the recalls' wakes
  cn remember C
  t3=$(wait_txid "tenants/$STORE1/" "$t2")
  ! lg -q 'sidecar.backoff' || fail "no sidecar.backoff after the restore" "$(lg -c sidecar.backoff) of them"
  pass "remember C replicated: tenants/${STORE1:0:8}… maxTXID $t3; no sidecar.backoff"
}

step_12() { # a second cycle: stop, volume gone, restore, A B C
  LOG=$LOGS/10-restore.log; need_running 10
  local oa; oa=$(c r2-settle control/oauth.sqlite/) # step 10's refresh rotated the tokens: let that reach the bucket
  note "  control/oauth.sqlite maxTXID before the stop (settled): $oa"
  stop_timed; note "  docker stop -t 60 took $STOP_S s"
  if lg -q 'sidecar.kill'; then finding "sidecar.kill in the log: the shutdown sync was cut short"; fi
  docker volume rm "$VOL" >/dev/null
  export HOSTED_KEKS=$K1
  serve "$LOGS/12-restore.log" -e RESTORE_ON_BOOT=1
  lg -q 'restored the control databases: 2 restored' || fail '"restored the control databases: 2 restored"' "$(hosted_lines | tr '\n' ' ')"
  lg -q 'RESTORE_ON_BOOT: 1 store databases restored' || fail '"RESTORE_ON_BOOT: 1 store databases restored"' "$(hosted_lines | tr '\n' ' ')"
  ! lg -qE 'FAILED|waits? for a restore' || fail "no FAILED, no \"wait(s) for a restore\"" "$(lg -E 'FAILED|waits? for a restore' | redact)"
  note "  start-up:"; hosted_lines | tee -a "$RESULTS"
  local out
  if out=$(ctry recall A 'B!' C); then note "  $out"; pass "second restore: A, B and C recalled with step 10's refreshed token (B: as in step 10)"; return; fi
  [[ $out == *"HTTP 401"* ]] || fail "recall A B C after the second restore" "$out"
  finding "the access token from step 10's refresh got 401 after the second restore: the rotation (control/oauth.sqlite, $oa before the stop) is not in the restored database. The plan names refresh-token rotations after the last sync as a lost window; a person would connect again"
  note "  so: a new connection from user 1's browser (its session is in accounts.sqlite)"
  cn oauth
  cn recall A 'B!' C
  pass "second restore: A, B and C recalled (after a new connection: see the finding)"
}

step_13() { # cleanup
  LOG=$LOGS/13-cleanup.log
  local did=()
  if running; then docker stop -t 60 "$NAME" >/dev/null; did+=("container stopped"); fi
  end_follower
  if ! gone; then remove; did+=("container removed"); fi
  docker volume rm -f "$VOL" >/dev/null
  ! docker volume inspect "$VOL" >/dev/null 2>&1 || fail "volume $VOL removed" "it is still there"; did+=("volume $VOL removed")
  if (( ! REHEARSE )); then cn r2-empty; did+=("bucket emptied (listing empty)"); fi
  docker image rm "$IMAGE" >/dev/null; did+=("image $IMAGE removed")
  if [[ -e $WT ]]; then git -C "$REPO" worktree remove --force "$WT"; fi
  [[ ! -d $WT ]] || fail "worktree $WT removed" "it is still there"; did+=("worktree removed")
  rm -P -f "$STATE" "$DRILL_STATE" 2>/dev/null || rm -f "$STATE" "$DRILL_STATE"
  [[ ! -e $STATE && ! -e $DRILL_STATE ]] || fail "state files deleted" "they are still there"; did+=("state files deleted")
  local line="" d; for d in "${did[@]}"; do line+="${line:+, }$d"; done
  pass "$line (logs kept in $LOGS)"
  note "  next: delete the drill token and the emptied bucket (docs/hosted/RUNBOOK.md, The drill, Cleanup)"
}

for (( s = FROM; s <= LAST; s++ )); do
  STEP=$s
  "step_$s"
  [[ -f $STATE ]] && save REACHED "$s"
done
(( REHEARSE )) && note "- rehearsal done through step $LAST (container left running for inspection: $NAME on $VOL)"
exit 0
