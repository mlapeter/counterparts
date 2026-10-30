#!/bin/sh
# The sidebar mod's three checks, in a throwaway HOME:
#
#   1. `claude plugin validate` on the repository's plugin (the five classic
#      hooks, the server, and this module under "modules") and on this folder;
#   2. `claude plugin test hooks/sidebar`: the mod's own tests, terminal and
#      desktop (this folder is a plugin root of its own so the runner sees only
#      them; the repository's bun tests would not load there);
#   3. `tsc -p hooks/sidebar`, against the engine's declarations.
#
# Usage: sh hooks/sidebar/check.sh   (from anywhere; CLAUDE_BIN overrides `claude`)
#
# The declarations: the engine lays them beside a mod it loads from a folder it
# hot-reloads (`.claude-plugin/types/`). A check run never loads one that way,
# so this lays them itself, from the first of: this folder's own (already
# laid), the repository root's (a `claude --plugin-dir` session laid them), or
# the plugin-authoring skill's copy, which Claude Code writes to its temp
# directory when that skill loads. All three are gitignored.
#
# Nothing here touches the real ~/.claude: every `claude` call runs with HOME
# set to a temp directory this script makes and removes.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$HERE/../.." && pwd -P)"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
[ -n "$CLAUDE_BIN" ] || { echo "check.sh: no claude on PATH (set CLAUDE_BIN)"; exit 1; }

REAL_HOME="$HOME"
FAKE_HOME="$(mktemp -d "${TMPDIR:-/tmp}/sidebar-check.XXXXXX")"
trap 'rm -rf "$FAKE_HOME"' EXIT
case "$FAKE_HOME/" in "$REAL_HOME"/*) echo "check.sh: the temp HOME is inside the real one; refusing"; exit 1 ;; esac

claude() { HOME="$FAKE_HOME" "$CLAUDE_BIN" "$@"; }

TYPES="$HERE/.claude-plugin/types/claude-code/index.d.ts"
if [ ! -f "$TYPES" ]; then
  FOUND=""
  if [ -f "$ROOT/.claude-plugin/types/claude-code/index.d.ts" ]; then
    FOUND="$ROOT/.claude-plugin/types/claude-code/index.d.ts"
  else
    # the skill's copy, newest first
    FOUND="$(ls -t "${TMPDIR:-/tmp}"/../claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts \
      /tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts \
      /private/tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts 2>/dev/null | head -1 || true)"
  fi
  if [ -z "$FOUND" ]; then
    echo "check.sh: no engine declarations found. Load the plugin-authoring skill once (or run"
    echo "  claude --plugin-dir $ROOT) and run this again."
    exit 1
  fi
  mkdir -p "$(dirname "$TYPES")"
  cp "$FOUND" "$TYPES"
  echo "laid the engine's declarations from $FOUND"
fi

echo "== validate: the repository's plugin"
claude plugin validate "$ROOT"
echo "== validate: the mod's own folder"
claude plugin validate "$HERE"
echo "== test"
claude plugin test "$HERE"
echo "== tsc"
if [ -x "$ROOT/node_modules/.bin/tsc" ]; then TSC="$ROOT/node_modules/.bin/tsc"; else TSC="tsc"; fi
"$TSC" -p "$HERE"
echo "all three clean"
