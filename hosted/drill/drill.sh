#!/usr/bin/env bash
# THE HOSTED RESTORE DRILL (docs/hosted/RUNBOOK.md, "The drill with the real binary"):
# production's deployed image, real Litestream, the drill bucket on R2 with SSE-C, a
# throwaway recovery keypair (WB1: the bucket's keys are sealed to it, and the lost
# volume's keys come back only with its private key, through `hold` + `recover-keys`,
# as on Railway). On a Mac, with Docker, from a checkout with hosted/'s dependencies
# (bun install --cwd hosted --frozen-lockfile).
#
#   hosted/drill/drill.sh              the whole drill, steps 0-13 (refuses while a run's state exists)
#   hosted/drill/drill.sh --from N     resume a failed run at step N (the state file has its keys, tokens, ids)
#   hosted/drill/drill.sh --rehearse   steps 0-3 with BACKUPS=off on a scratch volume: no bucket, no credentials
#                                      (--rehearse --from N resumes a rehearsal)
#   hosted/drill/drill.sh --local      the whole drill against a LOCAL S3 with SSE-C (SeaweedFS in Docker, its
#                                      own throwaway TLS certificate and credentials), no R2 and no account:
#                                      the image built from this checkout's HEAD. For a change before it deploys
#   hosted/drill/drill.sh --sha <commit>   build the image from that commit instead of production's deployed one
#
# Run it as one background process. Everything it writes goes to one scratch directory
# outside the repository, $COUNTERPARTS_DRILL_DIR (default $TMPDIR/counterparts-drill):
# RESULTS.md (REHEARSAL.md for --rehearse), the container logs, the state with the
# throwaway keys (deleted at step 13), and the worktree at the commit that the image is
# built from. The R2 credentials come from ~/.config/counterparts-drill.env (not with
# --local). Nothing secret is printed or put on a command line: docker gets secrets by
# name (-e NAME), from this shell's env; a private key goes in on stdin.
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
MADE=0; [[ -d $SCRATCH ]] || MADE=1
mkdir -p "$SCRATCH"
SCRATCH=$(cd "$SCRATCH" && pwd -P)
# Inside ANY git work tree (this repository, a worktree of it, ~/counterparts-notes): refused, it could be pushed.
if git -C "$SCRATCH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  (( MADE )) && rmdir "$SCRATCH" 2>/dev/null
  echo "COUNTERPARTS_DRILL_DIR ($SCRATCH) is inside a git work tree: the drill's state, KEKs and logs never go there" >&2; exit 2
fi
WT=$SCRATCH/worktree   # production's deployed commit, for the image (made at step 0, removed at step 13)
SHA=''                 # that commit: read from GitHub's deployments at step 0, kept in the state for a resume
IMAGE=''

FROM=0
REHEARSE=0
LOCAL=0
MIGRATION=0
OLD_SHA=''
WANT_SHA=''
while (( $# )); do
  case $1 in
    --from) FROM=${2:?--from N}; [[ $FROM =~ ^([0-9]|1[0-3])$ ]] || { echo "--from takes 0-13" >&2; exit 2; }; shift 2 ;;
    --rehearse) REHEARSE=1; LAST=3; shift ;;
    --local) LOCAL=1; shift ;;
    --migration) LOCAL=1; MIGRATION=1; LAST=7; shift ;;
    --old-sha) OLD_SHA=${2:?--old-sha <commit>}; shift 2 ;;
    --sha) WANT_SHA=${2:?--sha <commit>}; shift 2 ;;
    *) echo "usage: drill.sh [--rehearse] [--local | --migration [--old-sha <commit>]] [--sha <commit>] [--from N]" >&2; exit 2 ;;
  esac
done
(( LOCAL && REHEARSE )) && { echo "--local and --rehearse: the rehearsal has no bucket at all" >&2; exit 2; }

# --local: a local S3 (SeaweedFS, which enforces SSE-C over TLS) on a Docker network of
# its own. The server reaches it as https://s3:8333, this script's client as
# https://127.0.0.1:8333; both trust only the drill's own throwaway CA.
S3IMAGE=chrislusf/seaweedfs:4.50
S3NAME=drill-s3
NET=cp-drill-net
CERTS=$SCRATCH/s3
if (( REHEARSE )); then
  NAME=drill-rehearsal VOL=cp-drill-rehearsal TAG=rehearsal RESULTS=$SCRATCH/REHEARSAL.md
  BACKUP_ARGS=(-e BACKUPS=off)
elif (( LOCAL )); then
  NAME=drill VOL=cp-drill TAG=drill-local RESULTS=$SCRATCH/RESULTS-local.md
  if (( MIGRATION )); then TAG=drill-migration RESULTS=$SCRATCH/RESULTS-migration.md; fi
  BACKUP_ARGS=(--network "$NET" -v "$CERTS:/certs:ro" -e NODE_EXTRA_CA_CERTS=/certs/ca.pem -e SSL_CERT_FILE=/certs/ca.pem -e R2_ENDPOINT -e R2_BUCKET -e R2_ACCESS_KEY_ID -e R2_SECRET_ACCESS_KEY)
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
redact() { sed -E 's/token=[^&[:space:]]+/token=REDACTED/g; s/v1:[A-Za-z0-9+\/=]{20,}/v1:REDACTED/g; s/cp-recovery:[A-Za-z0-9+\/=]{20,}/cp-recovery:REDACTED/g; s#[a-z0-9]{32}\.r2\.cloudflarestorage\.com#<account>.r2.cloudflarestorage.com#g'; }
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
# --local: the client reaches the local S3 on the host's port, trusting the drill's own CA.
client() {
  if (( LOCAL )); then (cd "$SCRATCH" && R2_ENDPOINT=https://127.0.0.1:8333 NODE_EXTRA_CA_CERTS="$CERTS/ca.pem" "$BUN" "$CLIENT" "$@" 2>>"$LOGS/client-stderr.log")
  else (cd "$SCRATCH" && "$BUN" "$CLIENT" "$@" 2>>"$LOGS/client-stderr.log"); fi
}
c() {
  local out
  if out=$(client "$@"); then printf '%s\n' "$out"; else
    : > "$FAILED"; note "- step $STEP **FAIL** (drill-client $1): $out. Log: $LOG"; note "  (resume after fixing: drill.sh --from $STEP)"; exit 1
  fi
}
cn() { local out; out=$(c "$@") || exit 1; note "  $out"; } # a client result, noted
ctry() { client "$@"; } # may fail: the caller decides
now() { perl -MTime::HiRes=time -e 'printf "%.1f", time'; }

# ── the container ─────────────────────────────────────────────────────────────
# One container, detached (no --rm: this script removes it, so a killed script never takes
# the container with it), its output appended to $LOG after a start marker by a
# `docker logs -f` follower. RUN_PID is the follower: it ends when the container stops.
port_free() { # names a container holding the port (a rehearsal's left after a failure: docker rm -f drill-rehearsal)
  [[ -z $(lsof -nP -iTCP:8080 -sTCP:LISTEN 2>/dev/null) ]] && return 0
  local who; who=$(docker ps --filter publish=8080 --format '{{.Names}}' 2>/dev/null | tr '\n' ' ')
  fail "port 8080 free" "${who:+container $who(docker rm -f $who) }$(lsof -nP -iTCP:8080 -sTCP:LISTEN | tail -1 | awk '{print $1, $2}')"
}
CMD=serve # what start() runs: serve, or hold (the start-command override a restore uses on Railway)
CMDARGS=() # and its arguments (migrate-keys --recovery-fingerprint <fp>)
start() { # start <log> [docker args, e.g. -e RESTORE_ON_BOOT=1]
  LOG=$1; shift
  gone || fail "no $NAME container before a start (docker stop $NAME; docker rm $NAME first)" "one exists"
  port_free
  printf '=== drill start %s\n' "$(date '+%H:%M:%S')" >> "$LOG"
  docker run -d --name "$NAME" -p 127.0.0.1:8080:8080 -v "$VOL":/data \
    -e HOSTED_DATA_ROOT=/data -e PUBLIC_ORIGIN=http://127.0.0.1:8080 -e MAIL=log -e HOSTED_RECOVERY_PUBKEY \
    "${BACKUP_ARGS[@]}" "$@" "$IMAGE" "$CMD" ${CMDARGS[@]+"${CMDARGS[@]}"} > /dev/null
  docker logs -f "$NAME" >> "$LOG" 2>&1 &
  RUN_PID=$!
}
# THE RAILWAY RESTORE, step by step (RUNBOOK, Restore): the container started on `hold` (a
# start-command override), `recover-keys` run inside it with the private key on stdin
# (railway ssh), then the container stopped. Sets RK (its stdout) and RKC (its exit code).
recover_in_hold() { # recover_in_hold <log> <private key file> [recover-keys args]
  local log=$1 key=$2; shift 2
  CMD=hold start "$log"
  local until=$((SECONDS + 60))
  until lg -q 'holding on port'; do
    (( SECONDS < until )) && running || fail "hold to say \"holding on port\" within 60 s" "$(hosted_lines | tail -3 | tr '\n' ' ')"
    sleep 0.5
  done
  [[ $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/readyz) == 200 ]] || fail "hold's /readyz 200 (the platform keeps the container)" "another status"
  RKC=0
  RK=$(docker exec -i "$NAME" node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts recover-keys "$@" < "$key" 2>>"$LOGS/$STEP-recover-keys.stderr") || RKC=$?
  printf '%s\n' "$RK" >> "$LOGS/$STEP-recover-keys.stdout"
  docker stop -t 10 "$NAME" >/dev/null; end_follower; remove
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
  if out=$(client r2-wait "$1" "$2" 60); then printf '%s\n' "$out"; else
    ltx_diagnostic; fail "replication: maxTXID under $1 above $2 within 60 s" "$out"
  fi
}

# ── preflight (every run) ─────────────────────────────────────────────────────
STEP=pre
[[ -d $REPO/hosted/node_modules/oauth4webapi && -d $REPO/hosted/node_modules/aws4fetch ]] || fail "hosted deps installed in this checkout (bun install --cwd hosted --frozen-lockfile)" "no hosted/node_modules/oauth4webapi or aws4fetch"
[[ -x $BUN ]] || fail "bun at $BUN" "none"
(( LOCAL )) || [[ -n $WANT_SHA ]] || command -v gh >/dev/null || fail "gh (signed in) for the deployed commit" "no gh"
docker info >/dev/null 2>&1 || fail "Docker running" "docker info failed"
if (( LOCAL )); then
  # The local S3's own names; its secret is made at step 0 and kept in the state (a resume reads it there).
  export R2_ENDPOINT=https://s3:8333 R2_BUCKET=counterparts-drill R2_ACCESS_KEY_ID=drill-local
elif (( ! REHEARSE )); then
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
  { echo; echo "# $( ((REHEARSE)) && echo Rehearsal || { ((LOCAL)) && echo "Drill (--local: a local S3 with SSE-C, no R2)" || echo Drill; } ) $(date '+%Y-%m-%d %H:%M %Z')"; echo; echo "Scripts from checkout $(git -C "$REPO" rev-parse --short HEAD), container $NAME, volume $VOL. Logs: $LOGS"; echo; } >> "$RESULTS"
else
  [[ -f $STATE ]] || fail "a state file to resume from ($STATE)" "none: start from step 0"
  . "$STATE"
  [[ -n $SHA ]] || fail "the deployed commit in the state file" "none: start from step 0"
  IMAGE=counterparts-drill:${SHA:0:8}
  docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "the image $IMAGE from step 0" "no such image: start from step 0"
  export HOSTED_RECOVERY_PUBKEY=$PUB1
  if (( MIGRATION )); then export HOSTED_KEKS=$KOLD; OLDIMAGE=counterparts-drill-old:${OLDSHA:0:8}; fi
  if (( LOCAL )); then export R2_SECRET_ACCESS_KEY=$S3SECRET; fi
  note ""; note "## resumed at step $FROM, $(date '+%H:%M:%S') (last passed: ${REACHED:-none})"
  LOG=$(ls -t "$LOGS"/*.log 2>/dev/null | head -1 || echo "$LOGS/none.log")
  RUN_PID=0
fi

# ── the steps ─────────────────────────────────────────────────────────────────

step_0() { # preflight: deployed sha and its worktree, Docker, port, no leftovers, empty bucket, the image
  LOG=$LOGS/0-build.log
  # The hosted service's environment only (Railway project fabulous-recreation, service counterparts,
  # deploying from the hosted-live branch): its newest deployment whose latest status is success.
  # The image is built from exactly that commit, whatever this checkout is on.
  local env="fabulous-recreation / production" deployed="" id state
  if [[ -n $WANT_SHA ]] || (( LOCAL )); then
    # --sha, or --local's default: this checkout's HEAD (committed work only: the worktree is made at it).
    deployed=$(git -C "$REPO" rev-parse "${WANT_SHA:-HEAD}^{commit}" 2>/dev/null || true)
    env="${WANT_SHA:-HEAD} (not production's deployed commit)"
  else
    for id in $(gh api "repos/$GH_REPO/deployments?environment=fabulous-recreation%20%2F%20production&per_page=10" --jq '.[].id'); do
      state=$(gh api "repos/$GH_REPO/deployments/$id/statuses" --jq '.[0].state')
      if [[ $state == success ]]; then deployed=$(gh api "repos/$GH_REPO/deployments/$id" --jq .sha); break; fi
    done
  fi
  [[ $deployed =~ ^[0-9a-f]{40}$ ]] || fail "the sha of $env" "${deployed:-none found}"
  SHA=$deployed IMAGE=counterparts-drill:${deployed:0:8}
  (( LOCAL )) || git -C "$REPO" fetch -q origin
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
  if (( LOCAL )); then local_s3; fi
  if (( ! REHEARSE )); then cn r2-empty; fi
  docker build -f "$WT/hosted/Dockerfile" -t "$IMAGE" "$WT" > "$LOG" 2>&1 || fail "the image builds" "docker build failed"
  local lsv; lsv=$(docker run --rm --entrypoint litestream "$IMAGE" version)
  local want; want=$(sed -n 's/^ARG LITESTREAM_VERSION=//p' "$WT/hosted/Dockerfile")
  [[ -n $want && $lsv == *"$want"* ]] || fail "Litestream ${want:-(no ARG LITESTREAM_VERSION in the Dockerfile)} in the image, as the Dockerfile pins" "$lsv"
  # Two throwaway recovery keypairs (WB1): P1, the drill's, and P2, a wrong one. The private keys
  # go to 0600 files in the scratch dir (deleted at step 13) and reach a container on stdin only.
  local made p
  for p in 1 2; do
    rm -f "$SCRATCH/p$p.key"
    # recovery-keygen prints the private key and writes no file: its line goes straight into the 0600 file (umask 077).
    made=$(cd "$REPO" && "$BUN" hosted/src/main.ts recovery-keygen 2>>"$LOGS/0-keygen.stderr") || fail "recovery-keygen to make P$p" "it failed ($LOGS/0-keygen.stderr)"
    grep -E '^cp-recovery:' <<<"$made" > "$SCRATCH/p$p.key" || fail "recovery-keygen to print a private key" "none"
    [[ $(stat -f %Lp "$SCRATCH/p$p.key") == 600 ]] || fail "P$p's private key file mode 600" "mode $(stat -f %Lp "$SCRATCH/p$p.key")"
    save "PUB$p" "$(sed -n 's/^HOSTED_RECOVERY_PUBKEY=//p' <<<"$made")"
    save "FP$p" "$(sed -n 's/^fingerprint //p' <<<"$made")"
  done
  [[ $FP1 =~ ^[0-9a-f]{16}$ && $FP2 =~ ^[0-9a-f]{16}$ && $FP1 != "$FP2" ]] || fail "two recovery keypairs, different fingerprints" "$FP1 / $FP2"
  save SHA "$SHA"
  . "$STATE"
  export HOSTED_RECOVERY_PUBKEY=$PUB1
  pass "$env: sha $SHA, port 8080 free, no $NAME container or $VOL volume, image $(docker image inspect -f '{{.Id}}' "$IMAGE" | cut -c8-19) ($(docker image inspect -f '{{.Architecture}}' "$IMAGE")), litestream $lsv; throwaway recovery keypairs P1 ($FP1) and P2 ($FP2, the wrong one) made"
}

# --local's S3: a throwaway CA and certificate (s3 and 127.0.0.1), credentials made now, SeaweedFS on
# its own network, the bucket made. Everything under $CERTS goes at step 13.
local_s3() {
  docker rm -f "$S3NAME" >/dev/null 2>&1 || true
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  rm -rf "$CERTS"
  (umask 022 && mkdir -p "$CERTS" && cd "$CERTS" \
    && openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout ca.key -out ca.pem -days 2 -subj /CN=counterparts-drill-ca 2>/dev/null \
    && openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout s3.key -out s3.csr -subj /CN=s3 2>/dev/null \
    && printf 'subjectAltName=DNS:s3,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' > ext.cnf \
    && openssl x509 -req -in s3.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out s3.pem -days 2 -extfile ext.cnf 2>/dev/null \
    && rm -f ca.key s3.csr ca.srl ext.cnf) || fail "the local S3's certificate" "openssl failed"
  save S3SECRET "$(openssl rand -hex 24)"
  export R2_SECRET_ACCESS_KEY=$S3SECRET
  (umask 022 && printf '{"identities":[{"name":"drill","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}\n' "$R2_ACCESS_KEY_ID" "$S3SECRET" > "$CERTS/s3.json")
  docker run -d --name "$S3NAME" --network "$NET" --network-alias s3 -p 127.0.0.1:8333:8333 -v "$CERTS:/certs:ro" "$S3IMAGE" \
    server -dir=/data -s3 -s3.port=8333 -s3.config=/certs/s3.json -s3.cert.file=/certs/s3.pem -s3.key.file=/certs/s3.key > /dev/null || fail "the local S3 ($S3IMAGE) starts" "docker run failed"
  local i
  for i in $(seq 1 60); do
    if echo "s3.bucket.create -name $R2_BUCKET" | docker exec -i "$S3NAME" weed shell >/dev/null 2>&1 && ctry r2-list keys/ >/dev/null 2>&1; then
      note "  local S3: $S3IMAGE on $NET, its own CA, bucket $R2_BUCKET"; return 0
    fi
    sleep 1
  done
  fail "the local S3 answering, its bucket made, within 60 s" "$(docker logs --tail 5 "$S3NAME" 2>&1 | tr '\n' ' ')"
}

step_1() { # serve sealing to P1, two invites
  export HOSTED_RECOVERY_PUBKEY=$PUB1
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
    [[ $(grep -c . <<<"$keys") == 3 && $keys == *keys/control.sealed* ]] || fail "keys/: control.sealed + one per sign-up (3)" "$(tr '\n' ' ' <<<"$keys")"
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
    grep -qx "keys/$STORE1.sealed" <<<"$keys" && [[ $STORE1 != control ]] || fail "keys/$STORE1.sealed in the bucket, not control" "$(tr '\n' ' ' <<<"$keys")"
    STORE2=$(grep -v -e "keys/$STORE1.sealed" -e keys/control.sealed <<<"$keys" | sed -E 's#^keys/(.*)\.sealed$#\1#'); save STORE2 "$STORE2"
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

step_5() { # SSE-C: plain GETs refused, the plain key object not; every key object sealed to P1 (WB1)
  LOG=$LOGS/1-serve.log; need_running 1
  local out sealed; out=$(c ssec-check "$STORE1"); sealed=$(c sealed-check "$STORE1" "$FP1")
  lg -q "key objects sealed to recovery key $FP1" || fail "serve's line \"key objects sealed to recovery key $FP1\"" "$(hosted_lines | tail -4 | tr '\n' ' ')"
  pass "$out; $sealed"
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
  export HOSTED_RECOVERY_PUBKEY=$PUB1
  local before after; before=$(c r2-snapshot)
  refused_start "$LOGS/8-refuse.log"
  [[ $RC == 1 ]] || fail "exit 1" "exit $RC"
  lg -q 'this volume has no accounts database, but the bucket has backups' || fail '"this volume has no accounts database, but the bucket has backups"' "$(hosted_lines | tr '\n' ' ')"
  after=$(c r2-snapshot); [[ $after == "$before" ]] || fail "the bucket unchanged ($before)" "$after"
  local left; left=$(volume_ls); [[ -z $left ]] || fail "the volume empty" "$(tr '\n' ' ' <<<"$left")"
  note "  refusal:"; hosted_lines | tee -a "$RESULTS"
  pass "exit 1, refused; bucket unchanged ($after); volume empty"
}

step_9() { # RESTORE_ON_BOOT=1 with no private key, then recover-keys with the WRONG one (P2): both refused, harmlessly
  fresh_volume
  local before after; before=$(c r2-snapshot)
  export HOSTED_RECOVERY_PUBKEY=$PUB1
  refused_start "$LOGS/9-no-private-key.log" -e RESTORE_ON_BOOT=1
  [[ $RC == 1 ]] || fail "exit 1" "exit $RC"
  lg -q "sealed to the recovery key, which the server never holds: run recover-keys" || fail "the refusal \"… sealed to the recovery key, which the server never holds: run recover-keys …\" (backup.ts, KEY_SEALED)" "$(hosted_lines | tr '\n' ' ')"
  ! lg -q '\[hosted\] serving' || fail "no serving without the private key" "it served"
  ! lg -q 'restored the control databases' || fail "no control databases restored without the private key" "$(lg 'restored the control')"
  note "  RESTORE_ON_BOOT=1, exit $RC; refusal:"; hosted_lines | tee -a "$RESULTS"
  after=$(c r2-snapshot); [[ $after == "$before" ]] || fail "the bucket unchanged ($before)" "$after"
  recover_in_hold "$LOGS/9-wrong-private-key.log" "$SCRATCH/p2.key"
  [[ $RKC == 1 ]] || fail "recover-keys with P2 to exit 1" "exit $RKC: $RK"
  grep -q "isn't the recovery key the bucket's keys are sealed to ($FP1)" "$LOGS/$STEP-recover-keys.stderr" || fail "recover-keys with P2: \"… isn't the recovery key the bucket's keys are sealed to ($FP1)\"" "$(tail -2 "$LOGS/$STEP-recover-keys.stderr" | redact | tr '\n' ' ')"
  note "  recover-keys with the wrong private key (P2, $FP2) in hold: exit $RKC; $(grep -o "this private key.*written" "$LOGS/$STEP-recover-keys.stderr" | head -1)"
  after=$(c r2-snapshot); [[ $after == "$before" ]] || fail "the bucket unchanged ($before)" "$after"
  local left; left=$(volume_ls)
  ! docker run --rm -v "$VOL":/data --entrypoint test "$IMAGE" -e /data/control/accounts.sqlite || fail "no accounts database on the volume" "$(tr '\n' ' ' <<<"$left")"
  ! docker run --rm -v "$VOL":/data --entrypoint test "$IMAGE" -e /data/keys/volume.kek || fail "no volume key made by either refusal" "$(tr '\n' ' ' <<<"$left")"
  note "  volume after: ${left:-empty}" ; docker volume rm "$VOL" >/dev/null
  pass "refused both ways (no private key: exit 1; the wrong one: exit 1), nothing restored, no volume key made, bucket unchanged; volume removed"
}

step_10() { # the Railway restore: hold, recover-keys with P1 (stdin), then RESTORE_ON_BOOT=1: everything back, the old token, then the refresh
  fresh_volume
  export HOSTED_RECOVERY_PUBKEY=$PUB1
  local before; before=$(c r2-snapshot)
  recover_in_hold "$LOGS/10-hold.log" "$SCRATCH/p1.key" --dry-run
  [[ $RKC == 0 && $RK == *"2 keys would be brought back from the bucket (each proven against its replica)"* && $RK == *"1 not adopted: no replica"* ]] || fail "recover-keys --dry-run with P1: 2 keys proven against their replicas (control, user 1); user 2's never-opened store, with no replica, not adopted" "exit $RKC: $(redact <<<"$RK" | tr '\n' ' ')"
  note "  recover-keys --dry-run with P1 in hold: $(sed -n 2p <<<"$RK")"
  recover_in_hold "$LOGS/10-hold.log" "$SCRATCH/p1.key"
  [[ $RKC == 0 && $RK == *"2 keys brought back from the bucket"* ]] || fail "recover-keys with P1: 2 keys brought back (user 2's store gets a new key at its first open)" "exit $RKC: $(redact <<<"$RK" | tr '\n' ' ')"
  note "  recover-keys with P1 in hold (the private key on stdin): $(sed -n 2p <<<"$RK" | redact)"
  [[ $(c r2-snapshot) == "$before" ]] || fail "the bucket unchanged by recover-keys" "it changed"
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
  export HOSTED_RECOVERY_PUBKEY=$PUB1
  recover_in_hold "$LOGS/12-hold.log" "$SCRATCH/p1.key"
  [[ $RKC == 0 && $RK == *"2 keys brought back from the bucket"* ]] || fail "recover-keys with P1: 2 keys brought back" "exit $RKC: $(redact <<<"$RK" | tr '\n' ' ')"
  note "  recover-keys with P1 in hold: $(sed -n 2p <<<"$RK" | redact)"
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
  if (( LOCAL )); then
    docker rm -f "$S3NAME" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    rm -rf "$CERTS"
    [[ -z $(docker ps -aq -f "name=^/${S3NAME}$") && ! -e $CERTS ]] || fail "the local S3, its network and certificate removed" "something is left"; did+=("local S3, its network and certificate removed")
  fi
  rm -P -f "$STATE" "$DRILL_STATE" "$SCRATCH/p1.key" "$SCRATCH/p2.key" 2>/dev/null || rm -f "$STATE" "$DRILL_STATE" "$SCRATCH/p1.key" "$SCRATCH/p2.key"
  [[ ! -e $STATE && ! -e $DRILL_STATE && ! -e $SCRATCH/p1.key && ! -e $SCRATCH/p2.key ]] || fail "state files and private keys deleted" "they are still there"; did+=("state files and the throwaway private keys deleted")
  local line="" d; for d in "${did[@]}"; do line+="${line:+, }$d"; done
  pass "$line (logs kept in $LOGS)"
  (( LOCAL )) || note "  next: delete the drill token and the emptied bucket (docs/hosted/RUNBOOK.md, The drill, Cleanup)"
}

# ── --migration: today's production shape (HOSTED_KEKS, the image before WB1) to write-only backups ──
# Mike's steps on a throwaway volume and the local S3: the old image serves under a throwaway KEK; the new
# image serves with HOSTED_KEKS still set (it seals); the dry run beside it, the fingerprint named (no private key);
# migrate-keys as a start command, twice; serve without HOSTED_KEKS; then a lost volume restored.

# A one-shot command in the container, as a Railway start-command override: its exit code in RC.
run_cmd() { # run_cmd <log> <command> [docker args]
  local log=$1 cmd=$2; shift 2
  CMD=$cmd start "$log" "$@"
  RC=$(docker wait "$NAME")
  end_follower; remove
}

mstep_0() { # the new image (HEAD) and the local S3 as step 0 does, then the old image and a throwaway KEK
  step_0
  STEP=0
  LOG=$LOGS/0-build-old.log
  local old; old=$(git -C "$REPO" rev-parse "${OLD_SHA:-$(git -C "$REPO" merge-base HEAD origin/master)}^{commit}" 2>/dev/null || true)
  [[ $old =~ ^[0-9a-f]{40}$ ]] || fail "the old commit (--old-sha, or this branch's merge-base with origin/master)" "${old:-none}"
  local owt=$SCRATCH/worktree-old
  if [[ ! -e $owt ]]; then (umask 022 && git -C "$REPO" worktree add -q --detach "$owt" "$old") || fail "git worktree add $owt $old" "it failed"; fi
  OLDIMAGE=counterparts-drill-old:${old:0:8}
  docker build -f "$owt/hosted/Dockerfile" -t "$OLDIMAGE" "$owt" > "$LOG" 2>&1 || fail "the old image builds" "docker build failed"
  ! docker run --rm --entrypoint grep "$OLDIMAGE" -q recover-keys hosted/src/main.ts || fail "the old image from before WB1 (no recover-keys)" "it has WB1"
  save OLDSHA "$old"
  save KOLD "v1:$(openssl rand -base64 32)"
  export HOSTED_KEKS=$KOLD
  pass "old image $OLDIMAGE (before WB1: no recover-keys in it), a throwaway KEK (v1:, the shape of production's HOSTED_KEKS)"
}

mstep_1() { # the OLD image under HOSTED_KEKS: an invite, a sign-up, OAuth, wake, remember A, replicated
  local IMAGE=$OLDIMAGE
  # The image from before WB1 passes no SSL_CERT_FILE to its Litestream: the local S3's CA goes where Go looks by default.
  serve "$LOGS/1-old.log" -e HOSTED_KEKS -v "$CERTS/ca.pem:/etc/ssl/certs/ca-certificates.crt:ro"
  cn invite 1
  cn signup 1 "$LOG"
  cn oauth; cn wake
  local db; db=$(user1_store); [[ -n $db ]] || fail "user 1's store database" "none"
  STORE1=$(sed -E 's#^/data/tenants/([^/]+)/store/.*#\1#' <<<"$db"); save STORE1 "$STORE1"
  cn remember A
  wait_txid "tenants/$STORE1/" 0 >/dev/null; wait_txid control/accounts.sqlite/ 0 >/dev/null; wait_txid control/oauth.sqlite/ 0 >/dev/null
  local keys; keys=$(c r2-list keys/)
  [[ $keys == *keys/control.wrapped* && $keys == *"keys/$STORE1.wrapped"* && $keys != *.sealed* ]] || fail "today's shape: keys/*.wrapped, no .sealed" "$(tr '\n' ' ' <<<"$keys")"
  stop_timed
  pass "the old image served under HOSTED_KEKS: the store and both control databases replicated at control/<db>/; keys/*.wrapped only"
}

mstep_2() { # Mike's step 3: the release (the new image) with HOSTED_KEKS still set; then the proof beside it (step 4)
  serve "$LOGS/2-release.log" -e HOSTED_KEKS
  lg -q 'keys are still under HOSTED_KEKS: stop the server and run migrate-keys' || fail '"N keys are still under HOSTED_KEKS …"' "$(hosted_lines | tail -4 | tr '\n' ' ')"
  lg -q "key objects sealed to recovery key $FP1" || fail "\"key objects sealed to recovery key $FP1\"" "$(hosted_lines | tail -4 | tr '\n' ' ')"
  cn recall A
  local keys; keys=$(c r2-list keys/)
  [[ $keys == *keys/control.sealed* && $keys == *keys/control.wrapped* ]] || fail "sealed objects beside the old ones" "$(tr '\n' ' ' <<<"$keys")"
  # Step 4: the dry run beside the running server, naming the fingerprint checked against the offline copies. No private key.
  local dry rc=0
  dry=$(docker exec "$NAME" node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts migrate-keys --dry-run --recovery-fingerprint "$FP1" 2>>"$LOGS/2-migrate-dry.stderr") || rc=$?
  [[ $rc == 0 && $dry == *"recovery key $FP1: the one named"* && $dry == *"control would be re-keyed"* && $dry == *"a run would finish the migration"* ]] || fail "migrate-keys --dry-run --recovery-fingerprint beside the running server: a run would finish" "exit $rc: $(redact <<<"$dry" | tr '\n' ' ')"
  note "  migrate-keys --dry-run beside the running server:"; redact <<<"$dry" | sed 's/^/    /' | tee -a "$RESULTS"
  # And the real run beside it: refused (the server's heartbeat).
  rc=0; docker exec "$NAME" node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts migrate-keys --recovery-fingerprint "$FP1" >/dev/null 2>"$LOGS/2-migrate-beside.stderr" || rc=$?
  [[ $rc == 1 ]] && grep -q 'a server is running on this volume' "$LOGS/2-migrate-beside.stderr" || fail "migrate-keys beside the running server: refused" "exit $rc: $(tail -1 "$LOGS/2-migrate-beside.stderr" | redact)"
  stop_timed
  pass "the release served with HOSTED_KEKS (sealed every key, said to migrate); A recalled; the dry run beside it would finish (no private key on the server); the real run beside it refused"
}

mstep_3() { # Mike's step 5: migrate-keys as a start command (server stopped), then once more (a restart re-running it)
  CMDARGS=(--recovery-fingerprint "$FP1")
  run_cmd "$LOGS/3-migrate.log" migrate-keys -e HOSTED_KEKS
  [[ $RC == 0 ]] || fail "migrate-keys exit 0" "exit $RC: $(lg -v '^\[hosted\] re-key' | redact | tail -6 | tr '\n' ' ')"
  lg -q 'control re-keyed' || fail '"control re-keyed …"' "$(logtext | redact | tail -8 | tr '\n' ' ')"
  lg -q 'done: nothing here or in the bucket needs HOSTED_KEKS now' || fail '"done: …"' "$(logtext | redact | tail -8 | tr '\n' ' ')"
  note "  migrate-keys:"; logtext | grep -v '^\[hosted\] re-key' | redact | sed 's/^/    /' | tee -a "$RESULTS"
  local keys control; keys=$(c r2-list keys/); control=$(c r2-list control/)
  [[ $keys != *.wrapped* ]] || fail "no keys/*.wrapped left" "$(tr '\n' ' ' <<<"$keys")"
  ! grep -qE '^control/(accounts|oauth)\.sqlite/' <<<"$control" || fail "the old control replicas (control/<db>/) deleted" "$(grep -cE '^control/(accounts|oauth)\.sqlite/' <<<"$control") left"
  CBASE=$(sed -nE 's#^(control/[A-Za-z0-9_-]{22}/)accounts\.sqlite/.*#\1#p' <<<"$control" | head -1); save CBASE "$CBASE"
  [[ -n $CBASE ]] && grep -q "^${CBASE}oauth.sqlite/" <<<"$control" || fail "both control databases at a new base, control/<key id>/" "$(head -3 <<<"$control" | tr '\n' ' ')"
  run_cmd "$LOGS/3-migrate-again.log" migrate-keys -e HOSTED_KEKS
  [[ $RC == 0 ]] && lg -q '^0 keys moved' && lg -q 'done:' && ! lg -q 're-keyed' || fail "migrate-keys again: exit 0, nothing to do" "exit $RC: $(logtext | redact | tail -6 | tr '\n' ' ')"
  CMDARGS=()
  pass "migrate-keys: done; every old key object gone; control re-keyed to $CBASE, the old control replicas deleted; a second run did nothing"
}

mstep_4() { # Mike's step 6: HOSTED_KEKS removed; serve; recall A, remember B, replicated (control at its new base)
  local c0 t0 t c1; c0=$(c r2-txid "${CBASE}accounts.sqlite/")
  serve "$LOGS/4-serve.log"
  ! lg -q 'HOSTED_KEKS' || fail "no line about HOSTED_KEKS" "$(lg HOSTED_KEKS | redact)"
  ! lg -qE 'sidecar\.backoff|level=ERROR' || finding "$(lg -E 'sidecar\.backoff|level=ERROR' | redact | head -3 | tr '\n' ' ')"
  cn recall A
  t0=$(c r2-settle "tenants/$STORE1/")
  cn remember B
  t=$(wait_txid "tenants/$STORE1/" "$t0")
  stop_timed
  c1=$(c r2-txid "${CBASE}accounts.sqlite/")
  note "  tenants/${STORE1:0:8}… maxTXID rose: $t; ${CBASE}accounts.sqlite maxTXID $c0 before this serve, $c1 after its stop"
  pass "served without HOSTED_KEKS: A recalled, B remembered and replicated"
}

mstep_5() { # the volume lost after the migration: hold + recover-keys, RESTORE_ON_BOOT=1; A and B back
  fresh_volume
  recover_in_hold "$LOGS/5-hold.log" "$SCRATCH/p1.key"
  [[ $RKC == 0 && $RK == *"2 keys brought back from the bucket"* ]] || fail "recover-keys: control and user 1's keys brought back, proven against their replicas" "exit $RKC: $(redact <<<"$RK" | tr '\n' ' ')"
  note "  recover-keys: $(sed -n 2p <<<"$RK" | redact)"
  serve "$LOGS/5-restore.log" -e RESTORE_ON_BOOT=1
  lg -q 'restored the control databases: 2 restored' || fail '"restored the control databases: 2 restored"' "$(hosted_lines | tr '\n' ' ')"
  lg -q 'RESTORE_ON_BOOT: 1 store databases restored' || fail '"RESTORE_ON_BOOT: 1 store databases restored"' "$(hosted_lines | tr '\n' ' ')"
  local out
  if ! out=$(ctry recall A B); then cn refresh; out=$(c recall A B); fi
  note "  $out"
  pass "restored from the new control replicas and the store's: A and B recalled"
}

mstep_6() { # what the env from before the migration still opens: nothing of control
  local control; control=$(c r2-list control/)
  ! grep -qE '^control/(accounts|oauth)\.sqlite/' <<<"$control" || fail "no control replica under the old key's place" "some"
  pass "the bucket holds no control replica under the control key HOSTED_KEKS could open (it was re-keyed); keys/ holds no .wrapped"
}

mstep_7() { # cleanup, and the old image and worktree
  step_13
  STEP=7
  docker image rm "$OLDIMAGE" >/dev/null 2>&1 || true
  if [[ -e $SCRATCH/worktree-old ]]; then git -C "$REPO" worktree remove --force "$SCRATCH/worktree-old"; fi
  pass "the old image and its worktree removed"
}

for (( s = FROM; s <= LAST; s++ )); do
  STEP=$s
  if (( MIGRATION )); then "mstep_$s"; else "step_$s"; fi
  [[ -f $STATE ]] && save REACHED "$s"
done
if (( REHEARSE )); then
  # A rehearsal cleans up after itself, so the drill finds port 8080 free and no state (a failed one stays, for --from).
  docker stop -t 60 "$NAME" >/dev/null; end_follower; remove
  docker volume rm -f "$VOL" >/dev/null
  rm -f "$STATE" "$DRILL_STATE" "$SCRATCH/p1.key" "$SCRATCH/p2.key"
  note "- rehearsal done through step $LAST; container, volume $VOL and state removed (the image and the worktree stay for the drill)"
fi
exit 0
