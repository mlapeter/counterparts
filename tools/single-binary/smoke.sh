#!/usr/bin/env bash
#
# The single binary's end-to-end smoke test (spike, 2026-10-09 —
# docs/notes/single-binary-spike.md). HERMETIC: a fresh temp HOME, store and
# configuration it makes and deletes; a PATH with no bun and no node on it;
# COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 so nothing it runs can fall back to a
# real ~/.counterparts.
#
#   tools/single-binary/smoke.sh <absolute path to the binary> [workdir]
#
# It runs ONLY the binary: install, a SessionStart wake, a UserPromptSubmit,
# the worker the hooks spawn of themselves, the MCP server over stdio
# (tools/list, note, recall — by meaning as well as words), doctor, the
# dashboard's page and static files, and the nightly mode's stand-down.

set -uo pipefail

BIN="${1:?usage: smoke.sh <absolute path to the binary> [workdir]}"
case "$BIN" in /*) ;; *) echo "REFUSED: the binary path must be absolute"; exit 1 ;; esac
[ -x "$BIN" ] || { echo "REFUSED: $BIN is not an executable"; exit 1; }

REAL_HOME="$HOME"
WORK="${2:-$(mktemp -d "${TMPDIR:-/tmp}/single-binary-smoke.XXXXXX")}"
WORK="${WORK%/}"
case "$WORK/" in "$REAL_HOME"/*) echo "REFUSED: workdir $WORK is inside the real home"; exit 1 ;; esac
mkdir -p "$WORK" && WORK="$(cd "$WORK" && pwd -P)"
case "$WORK/" in "$REAL_HOME"/*) echo "REFUSED: workdir resolves inside the real home"; exit 1 ;; esac
[ -z "${COUNTERPARTS_DATA_DIR:-}" ] || { echo "REFUSED: COUNTERPARTS_DATA_DIR is inherited"; exit 1; }
[ -z "${COUNTERPARTS_CONFIG:-}" ] || { echo "REFUSED: COUNTERPARTS_CONFIG is inherited"; exit 1; }

FAKE_HOME="$WORK/home"
BASE="$FAKE_HOME/cp"
STORE="$BASE/store"
CFG="$BASE/claude-code.json"
PROJECT="$FAKE_HOME/project"
SESSION="smoke-$$"
mkdir -p "$FAKE_HOME" "$PROJECT"
CLEAN_PATH="/usr/bin:/bin:/usr/sbin:/sbin"

# Every run of the binary goes through here: an EMPTY environment but for these.
run() {
  env -i HOME="$FAKE_HOME" PATH="$CLEAN_PATH" TMPDIR="$WORK" COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 "$@"
}

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
no() {
  FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"
  [ -n "${2:-}" ] && printf '%s\n' "$2" | head -40 | sed 's/^/      /'
  return 0
}
payload() { # payload <event> [extra json fields]
  printf '{"hook_event_name":"%s","session_id":"%s","cwd":"%s","transcript_path":"%s"%s}' \
    "$1" "$SESSION" "$PROJECT" "$PROJECT/transcript.jsonl" "${2:-}"
}
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}'
INITED='{"jsonrpc":"2.0","method":"notifications/initialized"}'
mcp() { # mcp <request lines…> — one server process, newline-delimited JSON-RPC
  { printf '%s\n' "$INIT" "$INITED" "$@"; sleep 1; } |
    (cd "$PROJECT" && run COUNTERPARTS_DATA_DIR="$STORE" COUNTERPARTS_CONFIG="$CFG" COUNTERPARTS_SCOPE="$PROJECT" "$BIN" mcp 2>>"$WORK/mcp.err")
}

echo "binary  $BIN"
echo "work    $WORK"
echo

# ── 0. nothing to fall back on ──────────────────────────────────────────────
if run sh -c 'command -v bun || command -v node' >/dev/null 2>&1; then
  no "the clean PATH has no bun and no node" "$(run sh -c 'command -v bun; command -v node')"
else
  ok "the clean PATH has no bun and no node"
fi

OUT=$(run "$BIN" selfcheck 2>&1)
if [ $? = 0 ]; then ok "selfcheck: every embedded file is where packagePath looks"; else no "selfcheck" "$OUT"; fi

OUT=$(run "$BIN" cli --version 2>&1)
if grep -qE '^counterparts [0-9]+\.[0-9]+\.[0-9]+$' <<<"$OUT"; then ok "cli --version: $OUT"; else no "cli --version" "$OUT"; fi

# ── 1. install, non-interactive ─────────────────────────────────────────────
INSTALL_OUT=$(cd "$PROJECT" && run "$BIN" cli install --config "$CFG" --name "Smoke Test" --budget 9000 --no-connect 2>&1)
if [ -f "$STORE/counterparts.sqlite" ] && [ -f "$CFG" ]; then
  ok "install made the store (bun:sqlite, migrated) and the config"
else
  no "install did not make store + config" "$INSTALL_OUT"
fi
if grep -qF "\"$BIN\" hook" <<<"$INSTALL_OUT" || grep -qF "\\\"$BIN\\\" hook" <<<"$INSTALL_OUT"; then
  ok "install printed a hook command that runs the binary itself (\"<bin>\" hook)"
else
  no "install's printed hook command is not the binary's" "$(grep -n 'command' <<<"$INSTALL_OUT" | head -5)"
fi
if grep -q "claude mcp add counterparts" <<<"$INSTALL_OUT" && grep -qF -- "-- \"$BIN\" mcp" <<<"$INSTALL_OUT"; then
  ok "install printed an MCP registration that runs the binary itself (-- \"<bin>\" mcp)"
else
  no "install's MCP line is not the binary's" "$(grep 'claude mcp add' <<<"$INSTALL_OUT")"
fi

OUT=$(run "$BIN" cli rebrief --dir "$STORE" --config "$CFG" 2>&1)
grep -q "Re-rendered the wake bundle" <<<"$OUT" && ok "rebrief composed the first wake" || no "rebrief" "$OUT"

# ── 2. hooks ────────────────────────────────────────────────────────────────
OUT=$(payload SessionStart ',"source":"startup"' | (cd "$PROJECT" && run "$BIN" hook --config "$CFG" 2>"$WORK/hook-start.err"))
CODE=$?
if [ "$CODE" = 0 ] && grep -q "Who I am:" <<<"$OUT" && grep -q "This memory is for Smoke Test" <<<"$OUT"; then
  ok "SessionStart returned a wake ($(printf '%s' "$OUT" | wc -c | tr -d ' ') bytes)"
else
  no "SessionStart (exit $CODE)" "$OUT
$(cat "$WORK/hook-start.err")"
fi

OUT=$(payload UserPromptSubmit ',"prompt":"What espresso machine do we have in the kitchen?"' |
  (cd "$PROJECT" && run "$BIN" hook --config "$CFG" 2>"$WORK/hook-prompt.err"))
CODE=$?
if [ "$CODE" = 0 ] && [ ! -s "$WORK/hook-prompt.err" ]; then
  ok "UserPromptSubmit exit 0, nothing on stderr (stdout ${#OUT} bytes)"
else
  no "UserPromptSubmit (exit $CODE)" "$OUT
$(cat "$WORK/hook-prompt.err")"
fi

# ── 3. the MCP server over stdio ────────────────────────────────────────────
OUT=$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
if grep -q '"serverInfo"' <<<"$OUT" && grep -q '"name":"recall"' <<<"$OUT" && grep -q '"name":"note"' <<<"$OUT"; then
  ok "mcp: initialize + tools/list ($(grep -o '"name":"[a-z_]*"' <<<"$OUT" | wc -l | tr -d ' ') names)"
else
  no "mcp tools/list" "$OUT
$(tail -5 "$WORK/mcp.err")"
fi

CANARY="The espresso machine in the kitchen is a Rancilio Silvia."
OUT=$(mcp \
  "$(printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"note","arguments":{"text":"%s"}}}' "$CANARY")" \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"recall","arguments":{"question":"what espresso machine is in the kitchen?","mode":"facts"}}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"recall","arguments":{"question":"which coffee maker do we own?","mode":"facts"}}}')
NOTED=$(grep '"id":2' <<<"$OUT" || true)
RECALLED=$(grep '"id":3' <<<"$OUT" || true)
MEANING=$(grep '"id":4' <<<"$OUT" || true)
if grep -q '"isError":true' <<<"$NOTED" || [ -z "$NOTED" ]; then no "mcp note" "$NOTED"; else ok "mcp: note landed"; fi
grep -q 'Rancilio Silvia' <<<"$RECALLED" && ok "mcp: recall returned the note" || no "mcp recall" "$RECALLED"
grep -q '"semantic":"in-line"' <<<"$RECALLED" && ok "mcp: recall embedded the question with the embedded table (semantic in-line)" ||
  no "mcp recall did not use the table" "$RECALLED"
grep -q 'Rancilio Silvia' <<<"$MEANING" && ok "mcp: recall by meaning alone ('which coffee maker do we own?' shares no word with the note)" ||
  no "recall by meaning alone" "$MEANING"
# The control: the same question with the table pointed at an empty folder
# must NOT find it — so the step above is the table working, not "the store's
# only memory comes back whatever is asked".
mkdir -p "$WORK/no-weights"
CTL=$({ printf '%s\n' "$INIT" "$INITED" '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"recall","arguments":{"question":"which coffee maker do we own?","mode":"facts"}}}'; sleep 1; } |
  (cd "$PROJECT" && run COUNTERPARTS_DATA_DIR="$STORE" COUNTERPARTS_CONFIG="$CFG" COUNTERPARTS_STATIC_WEIGHTS_DIR="$WORK/no-weights" "$BIN" mcp 2>/dev/null) | grep '"id":4' || true)
if ! grep -q 'Rancilio Silvia' <<<"$CTL" && grep -q '"semantic":"embed-failed"' <<<"$CTL"; then
  ok "control: with no table the same question finds nothing (semantic embed-failed)"
else
  no "control: the meaning-only question was answered without the table" "$CTL"
fi

# ── 4. doctor, the dashboard, the nightly mode, the last hooks ──────────────
DOC=$(cd "$PROJECT" && run "$BIN" cli doctor --config "$CFG" 2>&1)
CODE=$?
if grep -qi "local table" <<<"$DOC"; then
  ok "doctor ran (exit $CODE) and found the table: $(grep -i 'local table' <<<"$DOC" | head -1 | sed 's/^ *//' | cut -c1-110)"
else
  no "doctor (exit $CODE)" "$DOC"
fi
printf '%s\n' "$DOC" > "$WORK/doctor.txt"

PORT=$((20000 + $$ % 20000))
(cd "$PROJECT" && run COUNTERPARTS_DATA_DIR="$STORE" "$BIN" dashboard serve --port "$PORT" --dir "$STORE" >"$WORK/dash.out" 2>&1) &
DASH=$!
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.25; done
P=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")
J=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/app.js")
THREE=$(cd "$(dirname "$0")/../../src/adapters/dashboard/web" && ls shared/vendor/*.js 2>/dev/null | head -1)
V=$(curl -s -o /dev/null -w '%{http_code} %{size_download}' "http://127.0.0.1:$PORT/$THREE")
F=$(cd "$(dirname "$0")/../../src/adapters/dashboard/web" && ls shared/fonts/*.woff2 2>/dev/null | head -1)
W=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/$F")
A=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/overview")
pkill -f "$BIN dashboard serve --port $PORT" 2>/dev/null; wait "$DASH" 2>/dev/null
if [ "$P" = 200 ] && [ "$J" = 200 ] && [ "${V%% *}" = 200 ] && [ "$W" = 200 ]; then
  ok "dashboard: page $P, app.js $J, $THREE ${V}B, $F $W, /api/overview $A"
else
  no "dashboard: page $P, app.js $J, three ${V}, font $W, api $A" "$(cat "$WORK/dash.out")"
fi

OUT=$(run COUNTERPARTS_CONFIG="$CFG" "$BIN" nightly 2>&1)
grep -q "nightly run stood down" <<<"$OUT" && ok "nightly mode dispatches (stands down with no run pinned)" || no "nightly mode" "$OUT"

for EV in Stop SessionEnd; do
  OUT=$(payload "$EV" | (cd "$PROJECT" && run "$BIN" hook --config "$CFG" 2>"$WORK/hook-$EV.err"))
  CODE=$?
  [ "$CODE" = 0 ] && ok "$EV exit 0" || no "$EV (exit $CODE)" "$OUT $(cat "$WORK/hook-$EV.err")"
done

# The worker the hooks spawn OF THEMSELVES at Stop and SessionEnd: `<bin> runner`, detached.
for _ in $(seq 1 40); do pgrep -f "$BIN runner" >/dev/null || break; sleep 0.5; done
WORKER_LINES=$(cat "$STORE"/sessions/log/* 2>/dev/null | grep -c '"proc":"worker"' || true)
RAN=$(cat "$STORE"/sessions/log/* 2>/dev/null | grep '"proc":"worker"' | grep -c '"name":"process.end".*"reason":"ran"' || true)
if [ "${WORKER_LINES:-0}" -gt 0 ] && [ "${RAN:-0}" -gt 0 ]; then
  ok "the hooks spawned the binary as their worker ($RAN worker runs ended \"ran\", $WORKER_LINES log lines)"
else
  no "no worker log lines under the store" "$(find "$STORE" -maxdepth 2 | head -30)"
fi

# ── cleanup: no child of the binary may outlive its store ───────────────────
# The pattern names a MODE: Linux's pgrep, unlike macOS's, also matches this
# script, whose own command line carries the binary's path.
LIVE="$BIN (hook|mcp|cli|dashboard|runner|nightly)"
for _ in $(seq 1 60); do pgrep -f "$LIVE" >/dev/null || break; sleep 0.5; done
if pgrep -f "$LIVE" >/dev/null; then
  no "binary processes still running at cleanup" "$(pgrep -fl "$LIVE")"
  pkill -f "$LIVE"
fi

echo
echo "$PASS passed, $FAIL failed"
if [ -z "${KEEP:-}" ]; then rm -rf "$WORK"; else echo "kept $WORK"; fi
[ "$FAIL" = 0 ]
