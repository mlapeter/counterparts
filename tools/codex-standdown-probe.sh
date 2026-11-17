#!/bin/sh
# WHAT A CODEX HOOK SEES WHEN CLAUDE CODE STARTED CODEX (CX2 addendum 2, 2026-11-09).
#
# The Codex adapter stands down when Codex was started from inside Claude Code
# (codex-plugin-cc's /codex:rescue, /codex:review, the review gate), on two
# signals (src/adapters/codex/words.ts#codexStandDown): the hook's environment
# (CODEX_COMPANION_*, or Claude Code's CLAUDECODE / CLAUDE_CODE_ENTRYPOINT /
# CLAUDE_PROJECT_DIR), then the rollout's session_meta.originator ("Claude
# Code", the plugin's client name). Neither is measured yet. This prints what a
# hook really sees, names only — never a value.
#
# Run it once, by hand:
#   1. Add it as a SessionStart hook beside ours in ~/.codex/hooks.json:
#        { "hooks": [ { "type": "command", "command": "/ABSOLUTE/PATH/tools/codex-standdown-probe.sh" } ] }
#      appended to the "SessionStart" list.
#   2. Start `codex`, approve it in /hooks, restart, and open one session (row A,
#      the control). Then, in Claude Code with codex-plugin-cc installed, run
#      /codex:rescue on anything small (row B, the plugin).
#   3. THE DAEMON CASE. Codex's TUI runs sessions in one app-server daemon per
#      CODEX_HOME, and the daemon outlives the terminal that started it — so if
#      the FIRST `codex` after a quiet spell is started from a shell inside Claude
#      Code, every later session may inherit its environment. To see it: quit
#      every Codex, wait for the daemon to go (`pgrep -fl "app-server --managed-daemon"`
#      prints nothing; or wait ~30 min), then start `codex` from Claude Code's
#      terminal (its `!codex`, or a shell it opened) and open one session (row C);
#      then, from an ordinary terminal, start `codex` again WITHOUT stopping the
#      daemon and open one session (row D).
#   4. Read the log: cat "${TMPDIR:-/tmp}/counterparts-codex-probe.log"
#   5. Take the hook back out of ~/.codex/hooks.json.
# Each row: time, event, which marker variables were SET (names only), and the
# rollout's originator and source. What to check:
#   - row A: no markers, originator codex-tui (a plain session works);
#   - row B: a marker or an originator naming Claude Code (else neither signal holds);
#   - row D: if it shows Claude Code markers, a plain session after a daemon born
#     inside Claude Code would stand down wrongly — then the env signal must go
#     and the originator alone decides.
LOG="${TMPDIR:-/tmp}/counterparts-codex-probe.log"
IN=$(cat)
EVENT=$(printf '%s' "$IN" | sed -n 's/.*"hook_event_name":"\([^"]*\)".*/\1/p')
TP=$(printf '%s' "$IN" | sed -n 's/.*"transcript_path":"\([^"]*\)".*/\1/p')
SET=""
for v in CODEX_COMPANION_SESSION_ID CODEX_COMPANION_APP_SERVER_ENDPOINT CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_PROJECT_DIR CLAUDE_PLUGIN_DATA; do
  eval "val=\${$v:-}"
  [ -n "$val" ] && SET="$SET $v"
done
ORIG=""; SRC=""
if [ -n "$TP" ] && [ -f "$TP" ]; then
  FIRST=$(head -n 1 "$TP")
  ORIG=$(printf '%s' "$FIRST" | sed -n 's/.*"originator":"\([^"]*\)".*/\1/p')
  SRC=$(printf '%s' "$FIRST" | sed -n 's/.*"source":"\([^"]*\)".*/\1/p')
fi
printf '%s event=%s markers=[%s ] originator=%s source=%s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "${EVENT:-?}" "$SET" "${ORIG:-?}" "${SRC:-?}" >> "$LOG"
exit 0
