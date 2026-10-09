#!/usr/bin/env bash
#
# The plugin loop: Counterparts installed as a Claude Code PLUGIN, the way a
# stranger would get it from a marketplace, in a HOME that has never seen it —
# and then the things a plugin install has to produce: Claude Code launching
# the hooks and the server from the plugin root, a first run with no terminal
# install, a memory written and read back, the double-install guard, and an
# uninstall that leaves the memory where it was.
#
# Prototype (2026-10-09). Companion to tools/install-loop/run.sh, which proves
# the npm install; this one proves the plugin.
#
# Usage:  tools/plugin-loop/run.sh [workdir]
# Default workdir: a fresh `plugin-loop-<pid>` under $TMPDIR.
# Env:    CLAUDE_BIN  the Claude Code executable (default: `claude` on PATH)
#
# WHAT IT NEVER DOES, and how that is proved rather than hoped:
#
#   - It never runs with the real HOME. Claude Code resolves ~/.claude,
#     ~/.claude.json and its plugin cache from $HOME, and so does every
#     Counterparts process. The guard is first and unconditional.
#   - Before any command that could fire a hook, step 1 PROVES isolation:
#     `claude plugin list` must show none of the real home's plugins, `auth
#     status` must name the throwaway config directory, and a `--debug-file` of
#     a bare `--init-only` must name no settings file under the real home.
#   - It never logs in and never copies a credential. Without a login there is
#     no model turn, so the "conversation" parts are driven the way Claude Code
#     drives them — the plugin's own hook and server commands, with the
#     variables Claude Code sets — and the steps that need a real turn are in
#     docs/plugin.md as a manual checklist.
#
# WHAT IT CANNOT VERIFY: a model turn (Stop capture of a real transcript, the
# model calling a memory tool), Claude Desktop's Code tab, Cowork, `claude
# plugin eval`. See docs/plugin.md.

set -uo pipefail

REAL_HOME="$HOME"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"

# ── the guard ───────────────────────────────────────────────────────────────

WORK="${1:-${TMPDIR:-/tmp}/plugin-loop-$$}"
WORK="${WORK%/}"
if [ -z "${REAL_HOME:-}" ]; then
  echo "REFUSED: \$HOME is unset; the guard cannot tell the real home from a temp one."
  exit 1
fi
case "$WORK/" in
  "$REAL_HOME"/*)
    echo "REFUSED: the workdir ($WORK) is inside the real home ($REAL_HOME)."
    exit 1
    ;;
esac
mkdir -p "$WORK" || { echo "cannot create $WORK"; exit 1; }
WORK="$(cd "$WORK" && pwd -P)"
case "$WORK/" in
  "$REAL_HOME"/*)
    echo "REFUSED: the workdir resolves to $WORK, inside the real home ($REAL_HOME)."
    exit 1
    ;;
esac
for v in COUNTERPARTS_DATA_DIR COUNTERPARTS_CONFIG CLAUDE_CONFIG_DIR CLAUDE_CODE_PLUGIN_CACHE_DIR CLAUDE_CODE_PLUGIN_DIRS; do
  if [ -n "${!v:-}" ]; then
    echo "REFUSED: $v is already set (${!v}). The loop names its own; it never inherits one."
    exit 1
  fi
done
# The explicit-dir guard is UNSET inside the clean room for the reason
# install-loop gives: the stranger's path IS the defaults, in a HOME the guards
# above have already made throwaway.
unset COUNTERPARTS_REQUIRE_EXPLICIT_DIR

CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
  echo "REFUSED: no Claude Code executable (set CLAUDE_BIN)."
  exit 1
fi
# Resolve a symlinked launcher to the binary itself, so nothing below can be
# redirected by a later change to a link in the real home.
if command -v readlink >/dev/null 2>&1 && [ -L "$CLAUDE_BIN" ]; then
  CLAUDE_BIN="$(cd "$(dirname "$CLAUDE_BIN")" && cd "$(dirname "$(readlink "$CLAUDE_BIN")")" && pwd -P)/$(basename "$(readlink "$CLAUDE_BIN")")"
fi
BUN_BIN="$(command -v bun || echo "$REAL_HOME/.bun/bin/bun")"
GIT_BIN="$(command -v git || true)"
[ -x "$BUN_BIN" ] || { echo "REFUSED: no bun executable found."; exit 1; }
[ -x "$GIT_BIN" ] || { echo "REFUSED: no git executable found."; exit 1; }

FAKE_HOME="$WORK/home"
rm -rf "$FAKE_HOME"
mkdir -p "$FAKE_HOME/project"
FAKE_HOME="$(cd "$FAKE_HOME" && pwd -P)"
export HOME="$FAKE_HOME"
[ "$HOME" != "$REAL_HOME" ] || { echo "REFUSED: HOME did not change."; exit 1; }
export USERPROFILE="$HOME"
export DISABLE_AUTOUPDATER=1
# bun's caches follow HOME; its binary is borrowed, its home is not.
export BUN_INSTALL="$HOME/.bun"
# A PATH with no repo on it and no user bin dir: the borrowed bun and git, and
# the system. Claude Code runs the plugin's dependency install (bun.lock → bun)
# and its hooks with this PATH.
export PATH="$(dirname "$BUN_BIN"):$(dirname "$GIT_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT="$HOME/project"
MARKET_SRC="$WORK/marketplace-src"
MARKET_GIT="$WORK/counterparts.git"

echo "clean room"
echo "  HOME     $HOME"
echo "  PATH     $PATH"
echo "  claude   $CLAUDE_BIN ($("$CLAUDE_BIN" --version 2>/dev/null))"
echo "  bun      $("$BUN_BIN" --version)"
echo "  repo     $REPO (snapshotted into a git marketplace; never loaded in place)"
echo

# ── plumbing ────────────────────────────────────────────────────────────────

PASS=0
FAIL=0
STEP=0
CURRENT=""
step() { STEP=$((STEP + 1)); CURRENT="$1"; }
ok() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$STEP. $CURRENT"; }
no() {
  FAIL=$((FAIL + 1))
  printf 'FAIL  %s\n      %s\n' "$STEP. $CURRENT" "$1"
  if [ -n "${2:-}" ]; then printf '%s\n' "$2" | sed 's/^/      | /' | head -40; fi
}
# A command with a ceiling (macOS has no `timeout`).
t() { perl -e 'alarm shift; exec @ARGV' "$@"; }
claude() { t 300 "$CLAUDE_BIN" "$@"; }

# ── 1. isolation, proved before anything can fire ──────────────────────────

step "isolation: Claude Code sees the throwaway home and nothing of the real one"
LIST=$(claude plugin list 2>&1)
AUTH=$(claude auth status 2>&1 || true)
( cd "$PROJECT" && claude --debug-file "$WORK/debug-isolation.log" --init-only >/dev/null 2>&1 )
SETTINGS_READ=$(grep -o 'settings.json at path: .*' "$WORK/debug-isolation.log" 2>/dev/null | sed 's/settings.json at path: //' || true)
if ! grep -q "No plugins installed" <<<"$LIST"; then
  no "plugin list is not empty — this is not a fresh home" "$LIST"
elif ! grep -qF "\"configDirectory\": \"$HOME/.claude\"" <<<"$AUTH"; then
  no "auth status names another config directory" "$AUTH"
elif grep -qF "$REAL_HOME/.claude" "$WORK/debug-isolation.log"; then
  no "the debug log names the real ~/.claude" "$(grep -F "$REAL_HOME/.claude" "$WORK/debug-isolation.log" | head -5)"
elif [ -z "$SETTINGS_READ" ]; then
  no "the debug log names no settings files; cannot prove which were read" ""
else
  ok
  printf '      settings files Claude Code looked for:\n'
  printf '%s\n' "$SETTINGS_READ" | sed "s|$WORK|<work>|; s/^/        /"
fi
if [ "$FAIL" -gt 0 ]; then
  echo "STOPPING: isolation was not proved, and every later step could fire a hook."
  exit 1
fi

# ── 2. a marketplace the way GitHub would serve it ─────────────────────────

step "snapshot the working tree into a git marketplace (tracked + new files, no node_modules)"
rm -rf "$MARKET_SRC" "$MARKET_GIT"
mkdir -p "$MARKET_SRC"
( cd "$REPO" && git ls-files -co --exclude-standard -z ) |
  ( cd "$REPO" && xargs -0 -I{} sh -c 'mkdir -p "$1/$(dirname "$2")" && cp -p "$2" "$1/$2"' _ "$MARKET_SRC" {} )
(
  cd "$MARKET_SRC" &&
    git init -q -b main &&
    git -c user.name=plugin-loop -c user.email=plugin-loop@example.invalid add -A &&
    git -c user.name=plugin-loop -c user.email=plugin-loop@example.invalid commit -q -m snapshot &&
    git clone -q --bare . "$MARKET_GIT"
) >/dev/null 2>&1
if [ -f "$MARKET_GIT/HEAD" ] && [ -f "$MARKET_SRC/.claude-plugin/marketplace.json" ]; then ok; else no "no snapshot" ""; fi

step "claude plugin validate passes the plugin and the marketplace"
V1=$(claude plugin validate "$MARKET_SRC" 2>&1)
printf '%s\n' "$V1" > "$WORK/validate.txt"
if grep -q "Validation passed" <<<"$V1" && ! grep -q "Validation failed" <<<"$V1"; then
  ok
  grep -iE "warn|⚠" <<<"$V1" | sed 's/^/      /' | head -10
else
  no "validate did not pass" "$V1"
fi

step "the repository's own marketplace.json adds, and lists the plugin"
# Added from the local path (Claude Code reads a directory marketplace in
# place), checked, and removed again: the install below takes the COPY path.
ADD0=$(claude plugin marketplace add "$MARKET_SRC" 2>&1)
LISTED=$(claude plugin marketplace list 2>&1)
REMOVED=$(claude plugin marketplace remove counterparts 2>&1)
if grep -q "counterparts" <<<"$LISTED" && ! grep -qi "error\|invalid\|✘" <<<"$ADD0"; then
  ok
else
  no "the repository's marketplace did not add" "$ADD0
$LISTED
$REMOVED"
fi

step "plugin install through a git source: Claude Code clones, copies into its cache, installs dependencies"
# `marketplace add` refuses a file:// URL, but a plugin ENTRY may name one
# (`url` source), and that is the same path a GitHub source takes: clone,
# copy into ~/.claude/plugins/cache, dependency install. So the loop's own
# one-entry marketplace points at the snapshot's bare clone.
LOOP_MARKET="$WORK/loop-marketplace"
mkdir -p "$LOOP_MARKET/.claude-plugin"
cat > "$LOOP_MARKET/.claude-plugin/marketplace.json" <<EOF
{
  "name": "counterparts-loop",
  "owner": { "name": "plugin-loop" },
  "plugins": [
    { "name": "counterparts", "source": { "source": "url", "url": "file://$MARKET_GIT" } }
  ]
}
EOF
ADD=$(claude plugin marketplace add "$LOOP_MARKET" 2>&1)
INSTALL=$(claude plugin install counterparts@counterparts-loop 2>&1)
printf '%s\n%s\n' "$ADD" "$INSTALL" > "$WORK/install.txt"
JSON=$(claude plugin list --json 2>/dev/null || true)
printf '%s\n' "$JSON" > "$WORK/plugin-list.json"
INSTALL_PATH=$(bun -e '
  const list = JSON.parse(process.argv[1] || "[]");
  const all = Array.isArray(list) ? list : (list.plugins ?? list.installed ?? []);
  const p = all.find((x) => String(x.id ?? x.name ?? "").startsWith("counterparts"));
  console.log(p?.installPath ?? p?.path ?? "");
' "$JSON" 2>/dev/null || true)
if [ -z "$INSTALL_PATH" ] && [ -f "$HOME/.claude/plugins/installed_plugins.json" ]; then
  INSTALL_PATH=$(bun -e '
    const f = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const recs = f.plugins ?? f;
    for (const [id, v] of Object.entries(recs)) {
      if (!id.startsWith("counterparts@")) continue;
      const r = Array.isArray(v) ? v[0] : v;
      console.log(r.installPath ?? "");
    }
  ' "$HOME/.claude/plugins/installed_plugins.json" 2>/dev/null || true)
fi
if [ -n "$INSTALL_PATH" ] && [ -f "$INSTALL_PATH/.claude-plugin/plugin.json" ]; then
  ok
  echo "      installed at ${INSTALL_PATH/#$HOME/~}"
else
  no "the plugin is not installed (or its path could not be read)" "$ADD
$INSTALL
$JSON"
  echo "STOPPING: nothing to exercise."
  echo "workdir: $WORK"
  exit 1
fi

step "the install is a COPY in the cache, with no .git (so doctor reads it as an installed package)"
if [ -d "$INSTALL_PATH/.git" ]; then no "the cached copy carries .git" "$(ls -la "$INSTALL_PATH" | head -20)"; else ok; fi

step "Claude Code installed the one dependency (the embedding table) from bun.lock"
if [ -f "$INSTALL_PATH/node_modules/counterparts-model-potion/package.json" ]; then
  ok
  echo "      node_modules: $(du -sh "$INSTALL_PATH/node_modules" 2>/dev/null | cut -f1)"
else
  no "no node_modules/counterparts-model-potion in the cached copy (recall by meaning will be off)" \
    "$(ls "$INSTALL_PATH/node_modules" 2>&1 | head -10)
$(claude plugin list 2>&1 | head -20)"
fi

# ── 3. a session wakes: Claude Code fires the plugin's SessionStart ─────────

step "first session (--init-only): the plugin's SessionStart makes the store, no terminal install"
rm -f "$WORK/debug-wake.log"
( cd "$PROJECT" && claude --debug-file "$WORK/debug-wake.log" --init-only >/dev/null 2>&1 )
if [ -f "$HOME/.counterparts/claude-code.json" ] && [ -f "$HOME/.counterparts/store/counterparts.sqlite" ]; then
  ok
else
  no "no store or configuration after the first session" "$(grep -i 'hook' "$WORK/debug-wake.log" | tail -20)"
fi

step "the wake reached the session: SessionStart output carries the first-run line and the context block"
WAKE=$(grep -F 'Hook SessionStart:startup (SessionStart) success' "$WORK/debug-wake.log" || true)
if grep -q "first run" <<<"$WAKE" && grep -q "additionalContext" <<<"$WAKE"; then
  ok
else
  no "no first-run wake in the debug log" "$(grep -iE 'hook|counterparts' "$WORK/debug-wake.log" | tail -20)"
fi

# ── 4. the server, launched by Claude Code from the plugin root ────────────

step "claude mcp list starts the plugin's server from the plugin root, and it connects"
MCPL=$( cd "$PROJECT" && claude mcp list 2>&1 )
printf '%s\n' "$MCPL" > "$WORK/mcp-list.txt"
if grep -q "plugin:counterparts:counterparts" <<<"$MCPL" && grep -E "plugin:counterparts:counterparts" <<<"$MCPL" | grep -qi "connected"; then
  ok
else
  no "the plugin's server is not listed as connected" "$MCPL"
fi

# ── 5. a memory written, and the store shows it ────────────────────────────

# The server exactly as plugin.json declares it, with the variables Claude Code
# exports to a plugin's stdio server. (A model calling `note` needs a login;
# see docs/plugin.md.)
CANARY="The plugin loop left a note about a teal bicycle named Ferrous."
SERVE_ENV=(env CLAUDE_PLUGIN_ROOT="$INSTALL_PATH" CLAUDE_PLUGIN_DATA="$HOME/.claude/plugins/data/counterparts-counterparts-loop" CLAUDE_PROJECT_DIR="$PROJECT" CLAUDECODE=1)

step "note → recall through the plugin's server"
RPC=$(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"claude-code","version":"plugin-loop"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"note","arguments":{"text":"%s"}}}\n' "$CANARY"
  printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"recall","arguments":{"question":"what is the bicycle called?","mode":"facts"}}}'
)
MCP_OUT=$( cd "$PROJECT" && printf '%s\n' "$RPC" | t 120 "${SERVE_ENV[@]}" sh "$INSTALL_PATH/src/adapters/plugin-run.sh" mcp 2>"$WORK/mcp.err" )
printf '%s\n' "$MCP_OUT" > "$WORK/mcp-roundtrip.jsonl"
NOTED=$(grep '"id":2' <<<"$MCP_OUT" || true)
RECALLED=$(grep '"id":3' <<<"$MCP_OUT" || true)
if grep -q '"isError":true' <<<"$NOTED"; then
  no "the note was refused" "$NOTED"
elif grep -q "Ferrous" <<<"$RECALLED"; then
  ok
else
  no "recall did not return the note" "note: $NOTED
recall: $RECALLED
$(cat "$WORK/mcp.err")"
fi

step "the store shows it: the console (from the plugin) finds the note"
CLI_OUT=$( cd "$PROJECT" && t 120 "${SERVE_ENV[@]}" sh "$INSTALL_PATH/src/adapters/plugin-run.sh" cli recall "teal bicycle" 2>&1 )
printf '%s\n' "$CLI_OUT" > "$WORK/cli-recall.txt"
if grep -q "Ferrous" <<<"$CLI_OUT"; then ok; else no "the console did not find the note" "$CLI_OUT"; fi

step "a turn is captured: UserPromptSubmit and Stop through the plugin's hook command"
SESSION="plugin-loop-$$"
TRANSCRIPT="$PROJECT/transcript.jsonl"
cat > "$TRANSCRIPT" <<EOF
{"type":"user","message":{"role":"user","content":"My sister Odalys keeps bees on her roof in Tucson."},"timestamp":"2026-10-09T10:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Bees on a Tucson roof, that is a lovely detail about Odalys."}]},"timestamp":"2026-10-09T10:00:05Z"}
EOF
hook() { # hook <event> [extra json]
  printf '{"hook_event_name":"%s","session_id":"%s","cwd":"%s","transcript_path":"%s"%s}' "$1" "$SESSION" "$PROJECT" "$TRANSCRIPT" "${2:-}" |
    ( cd "$PROJECT" && t 120 "${SERVE_ENV[@]}" CLAUDE_CODE_SESSION_ID="$SESSION" sh "$INSTALL_PATH/src/adapters/plugin-run.sh" hook )
}
hook SessionStart ',"source":"startup"' >"$WORK/hook-start.out" 2>"$WORK/hook-start.err"
hook UserPromptSubmit ',"prompt":"My sister Odalys keeps bees on her roof in Tucson."' >"$WORK/hook-prompt.out" 2>"$WORK/hook-prompt.err"
hook Stop ',"stop_hook_active":false' >"$WORK/hook-stop.out" 2>"$WORK/hook-stop.err"
hook SessionEnd ',"reason":"exit"' >"$WORK/hook-end.out" 2>"$WORK/hook-end.err"
# The worker the Stop spawned writes in the background; give it a moment.
sleep 5
STATUS=$( cd "$PROJECT" && t 120 "${SERVE_ENV[@]}" sh "$INSTALL_PATH/src/adapters/plugin-run.sh" cli status 2>&1 )
printf '%s\n' "$STATUS" > "$WORK/cli-status.txt"
# Keyless by design: the hooks CAPTURE the turn into the store's span buffer,
# and the model makes memories of it (the Stop ask, `session_end`, the night
# run). So the evidence of capture is the turn's own words in the buffer, and
# the process log's hook lines under this session.
if grep -rqs "Odalys keeps bees" "$HOME/.counterparts/store/spans" &&
   grep -q "\"proc\":\"hook:stop\",\"pid\":[0-9]*,\"session\":\"$SESSION\"" "$HOME/.counterparts/store/sessions/log/"*.log; then
  ok
  grep -E '^(Memories|Today)' <<<"$STATUS" | sed 's/^/      /'
else
  no "the turn is not in the store's capture buffer" "$(cat "$WORK/hook-stop.err")
$STATUS"
fi

# ── 6. the double-install guard ────────────────────────────────────────────

step "with the npm hooks ALSO wired, the plugin stands down and says so once; one wake, not two"
mkdir -p "$HOME/.claude"
cp "$HOME/.claude/settings.json" "$WORK/settings.before.json" 2>/dev/null || echo '{}' > "$WORK/settings.before.json"
NPM_HOOK="\"$BUN_BIN\" run \"$INSTALL_PATH/src/adapters/claude-code/bin/hook.ts\""
bun -e '
  const fs = require("fs");
  const [file, cmd] = process.argv.slice(1);
  const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  s.hooks = {};
  for (const e of ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd", "PreCompact"]) {
    s.hooks[e] = [{ hooks: [{ type: "command", command: cmd }] }];
  }
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
' "$HOME/.claude/settings.json" "$NPM_HOOK"
rm -f "$WORK/debug-twice.log"
( cd "$PROJECT" && claude --debug-file "$WORK/debug-twice.log" --init-only >/dev/null 2>&1 )
OUTS=$(grep -F 'Hook SessionStart:startup (SessionStart) success' "$WORK/debug-twice.log" || true)
# A wake is the block that opens "Now: <date>" — plain stdout, or inside the
# JSON envelope when a line for the person rides with it.
WAKES=$(grep -c 'Now: ' <<<"$OUTS" || true)
if grep -q "installed twice" <<<"$OUTS" && [ "$WAKES" = "1" ]; then
  ok
else
  no "expected one wake and one stand-down line (wakes: $WAKES)" "$OUTS"
fi

step "moving to the plugin (the npm hooks removed): the plugin wakes again, same store"
cp "$WORK/settings.before.json" "$HOME/.claude/settings.json"
rm -f "$WORK/debug-moved.log"
( cd "$PROJECT" && claude --debug-file "$WORK/debug-moved.log" --init-only >/dev/null 2>&1 )
OUTS=$(grep -F 'Hook SessionStart:startup (SessionStart) success' "$WORK/debug-moved.log" || true)
if grep -q "Now: " <<<"$OUTS" && ! grep -q "installed twice" <<<"$OUTS" && ! grep -q "first run" <<<"$OUTS"; then
  ok
else
  no "the plugin did not wake on the existing store" "$OUTS"
fi

# ── 7. uninstall keeps the memory ──────────────────────────────────────────

step "plugin uninstall removes the plugin and leaves ~/.counterparts whole"
UNINSTALL=$(claude plugin uninstall counterparts@counterparts-loop 2>&1)
if [ -f "$HOME/.counterparts/store/counterparts.sqlite" ] && ! claude plugin list 2>&1 | grep -q "counterparts@counterparts-loop"; then
  ok
else
  no "after uninstall: store or plugin list not as expected" "$UNINSTALL
$(claude plugin list 2>&1)"
fi

echo
echo "$PASS passed, $FAIL failed"
echo "workdir (debug logs, transcripts of every step): $WORK"
[ "$FAIL" -eq 0 ]
