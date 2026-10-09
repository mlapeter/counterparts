#!/bin/sh
# The Claude Code plugin's launcher (prototype, 2026-10-09).
#
#   sh plugin-run.sh hook   - the five hooks (hooks/hooks.json)
#   sh plugin-run.sh mcp    - the memory server (.claude-plugin/plugin.json)
#   sh plugin-run.sh cli …  - the console, for a plugin user with no
#                             `counterparts` on PATH (commands/doctor.md)
#
# Claude Code runs this with `sh` and the absolute path, so it needs no exec
# bit and no runtime of its own. Its one job is the one the npm install does
# at `install` time and a plugin cannot: FIND A RUNTIME. The install writes the
# absolute path of the runtime it ran under into the host's configuration
# (cli/install.ts, scar 2.18: a host's PATH is not the login shell's); a
# plugin's command is fixed in a file we ship, so the search happens here, at
# every launch, in this order:
#
#   1. COUNTERPARTS_RUNTIME, when set: that executable and nothing else.
#   2. Bun 1.3+: on PATH, then $BUN_INSTALL/bin, ~/.bun/bin, Homebrew.
#   3. Node 22.15+: on PATH, then Homebrew, /usr/local, Volta, nvm, fnm, asdf,
#      mise. A Node older than 22.15 is skipped, not run (it cannot load the
#      TypeScript sources: adapters/runtime.ts#NODE_FLOOR).
#
# Bun first, because that is what the npm bins do (cli/bin/counterparts.mjs).
# The entry it runs is the same one those bins run (hook.mjs, serve.mjs,
# counterparts.mjs), so the runtime choice is the only difference.
#
# With no runtime: a hook says so ONCE, at SessionStart, as a systemMessage the
# person sees (and a line of context, so the model can say it too), and exits 0;
# every other event exits 0 in silence. The server exits 127 with the reason on
# stderr, which /mcp shows. Claude Code's own native binary does not double as
# a JavaScript runtime (BUN_BE_BUN=1 is ignored; measured on 2.1.295).
#
# Only shell built-ins and parameter expansion below, plus the runtimes'
# own --version: a PATH with nothing on it still reaches the message.

mode="${1:-}"
[ $# -gt 0 ] && shift

here="${0%/*}"
[ "$here" = "$0" ] && here="."

case "$mode" in
  hook) entry="$here/claude-code/bin/hook.mjs" ;;
  mcp) entry="$here/mcp/bin/serve.mjs" ;;
  cli)
    entry="$here/cli/bin/counterparts.mjs"
    # The console launched FROM THE PLUGIN says so: a Bash call (the plugin's
    # /counterparts:doctor) carries no CLAUDE_PLUGIN_ROOT of its own, and doctor
    # needs to know it is the plugin's copy (adapters/plugin.ts#pluginDoctorLine).
    CLAUDE_PLUGIN_ROOT="$(cd "$here/../.." && pwd -P)"
    export CLAUDE_PLUGIN_ROOT
    ;;
  *)
    echo "counterparts plugin-run: usage: sh plugin-run.sh hook|mcp|cli [args]" >&2
    exit 2
    ;;
esac

runtime=""

# version_at_least <version> <major> <minor>  (a leading "v" is ignored)
version_at_least() {
  v="${1#v}"
  major="${v%%.*}"
  rest="${v#*.}"
  minor="${rest%%.*}"
  minor="${minor%%-*}"
  case "$major" in "" | *[!0-9]*) return 1 ;; esac
  case "$minor" in "" | *[!0-9]*) return 1 ;; esac
  [ "$major" -gt "$2" ] && return 0
  [ "$major" -eq "$2" ] && [ "$minor" -ge "$3" ] && return 0
  return 1
}

try_bun() {
  [ -n "$1" ] && [ -x "$1" ] || return 1
  v="$("$1" --version 2>/dev/null)" || return 1
  version_at_least "$v" 1 3 || return 1
  runtime="$1"
}

try_node() {
  [ -n "$1" ] && [ -x "$1" ] || return 1
  v="$("$1" --version 2>/dev/null)" || return 1
  version_at_least "$v" 22 15 || return 1
  runtime="$1"
}

try_node_glob() { # a glob of node binaries: the first that is new enough
  for candidate in "$@"; do
    try_node "$candidate" && return 0
  done
  return 1
}

if [ -n "${COUNTERPARTS_RUNTIME:-}" ]; then
  case "${COUNTERPARTS_RUNTIME##*/}" in
    node*) try_node "$COUNTERPARTS_RUNTIME" ;;
    *) try_bun "$COUNTERPARTS_RUNTIME" ;;
  esac
else
  try_bun "$(command -v bun 2>/dev/null)" ||
    try_bun "${BUN_INSTALL:-$HOME/.bun}/bin/bun" ||
    try_bun "$HOME/.bun/bin/bun" ||
    try_bun /opt/homebrew/bin/bun ||
    try_bun /usr/local/bin/bun ||
    try_node "$(command -v node 2>/dev/null)" ||
    try_node /opt/homebrew/bin/node ||
    try_node /usr/local/bin/node ||
    try_node /usr/bin/node ||
    try_node "$HOME/.volta/bin/node" ||
    try_node_glob "$HOME"/.nvm/versions/node/v*/bin/node ||
    try_node_glob "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node ||
    try_node_glob "$HOME/Library/Application Support/fnm/node-versions"/*/installation/bin/node ||
    try_node_glob "$HOME"/.asdf/installs/nodejs/*/bin/node ||
    try_node_glob "$HOME"/.local/share/mise/installs/node/*/bin/node
fi

if [ -n "$runtime" ]; then
  exec "$runtime" "$entry" "$@"
fi

said="Counterparts (memory) is not running: it needs Bun 1.3+ or Node.js 22.15+ and found neither on PATH or in the usual places. Install one (https://bun.sh or https://nodejs.org), then restart Claude Code."

if [ "$mode" = "hook" ]; then
  payload=""
  while IFS= read -r line || [ -n "$line" ]; do
    payload="$payload$line"
  done
  case "$payload" in
    *'"hook_event_name":"SessionStart"'* | *'"hook_event_name": "SessionStart"'*)
      printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' \
        "$said" "Counterparts memory is not running in this session (no Bun 1.3+ or Node.js 22.15+ found). If the person asks about memory, tell them that."
      ;;
  esac
  exit 0
fi

echo "$said" >&2
exit 127
