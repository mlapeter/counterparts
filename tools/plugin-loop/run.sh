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
# Usage:  tools/plugin-loop/run.sh [--bundle | --bundle=directory] [workdir]
# Default workdir: a fresh `plugin-loop-<pid>` under $TMPDIR.
# Env:    CLAUDE_BIN  the Claude Code executable (default: `claude` on PATH)
#
# --bundle: install the GENERATED plugin bundle (tools/plugin-bundle/build.ts,
# the folder a repository of its own would hold) instead of the whole working
# tree. The pin still comes from this repository's marketplace.json; the
# installed copy must also stay inside the directory's file limit and carry no
# test or module doc. Everything after the install is the same loop.
#
# --bundle=directory: the same, for the bundle's DIRECTORY flavor (the sources
# transpiled to .js, no launcher): every step runs the entries by their own
# path, the way its plugin.json, hooks.json and commands do, so the loop proves
# Claude Code starts them by their shebang from a copy installed out of git
# (exec bit included). The steps about choosing a runtime (COUNTERPARTS_RUNTIME,
# Node) do not apply to it and are skipped, said once each.
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
# WHAT IT INSTALLS: the working tree, never the release the repository pins.
# The repository's marketplace entry names GitHub at a release tag (`ref`), so
# a stranger only ever gets a released version. The loop keeps that entry's
# `ref` and swaps only where it points: at a git snapshot of the working tree,
# tagged with the same name inside the loop's own throwaway clone, with one
# more commit on its branch past the tag. The install must come out as the
# tagged snapshot, not that later commit — which is the pin doing its job.
#
# WHAT IT CANNOT VERIFY: a model turn (Stop capture of a real transcript, the
# model calling a memory tool), Claude Desktop's Code tab, Cowork, `claude
# plugin eval`. See docs/plugin.md.

set -uo pipefail

REAL_HOME="$HOME"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
BUNDLE=0
FLAVOR=full
case "${1:-}" in
  --bundle | --bundle=full)
    BUNDLE=1
    shift
    ;;
  --bundle=directory)
    BUNDLE=1
    FLAVOR=directory
    shift
    ;;
esac

# launch <plugin root> <hook|mcp|cli>: sets LAUNCH to the words that start the
# plugin's <mode> as its own files do: `sh plugin-run.sh <mode>`, or, in the
# directory flavor, the entry run by its path (its shebang starts Bun).
LAUNCH=()
launch() {
  if [ "$FLAVOR" = directory ]; then
    case "$2" in
      hook) LAUNCH=("$1/src/adapters/claude-code/bin/hook.js") ;;
      mcp) LAUNCH=("$1/src/adapters/mcp/bin/serve.js") ;;
      cli) LAUNCH=("$1/src/adapters/cli/bin/counterparts.js") ;;
    esac
  else
    LAUNCH=(sh "$1/src/adapters/plugin-run.sh" "$2")
  fi
}

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
# the system. Claude Code runs the plugin's dependency install (the working
# tree's bun.lock → bun; the bundle's package-lock.json → npm) and its hooks
# with this PATH. For a bundle, npm is borrowed too, with the Node beside it;
# the launcher still picks Bun first (a Node older than 22.15 it skips).
LOCKFILE="bun.lock"
NPM_DIR=""
if [ "$BUNDLE" = 1 ]; then
  LOCKFILE="package-lock.json"
  NPM_BIN="$(command -v npm || true)"
  [ -x "$NPM_BIN" ] || { echo "REFUSED: --bundle needs npm (its lockfile is npm's)."; exit 1; }
  NPM_DIR="$(dirname "$NPM_BIN"):"
  # npm's cache follows HOME, like bun's.
  export npm_config_cache="$FAKE_HOME/.npm"
fi
export PATH="$(dirname "$BUN_BIN"):$NPM_DIR$(dirname "$GIT_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT="$HOME/project"
MARKET_SRC="$WORK/marketplace-src"
MARKET_GIT="$WORK/counterparts.git"
# The repository's own marketplace (its catalog and pin): the snapshot's copy,
# or, for a bundle (which carries none), a copy of this repository's.
REPO_MARKET="$MARKET_SRC"
[ "$BUNDLE" = 1 ] && REPO_MARKET="$WORK/repo-marketplace"

echo "clean room"
echo "  HOME     $HOME"
echo "  PATH     $PATH"
echo "  claude   $CLAUDE_BIN ($("$CLAUDE_BIN" --version 2>/dev/null))"
echo "  bun      $("$BUN_BIN" --version)"
if [ "$BUNDLE" = 1 ]; then
  echo "  repo     $REPO (its generated plugin bundle, $FLAVOR flavor, snapshotted into git; never loaded in place)"
else
  echo "  repo     $REPO (snapshotted into a git marketplace; never loaded in place)"
fi
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

rm -rf "$MARKET_SRC" "$MARKET_GIT"
if [ "$BUNDLE" = 1 ]; then
  step "generate the plugin bundle ($FLAVOR flavor) and snapshot it into git (the bundle repository's root is the plugin)"
  BUILD_OUT=$("$BUN_BIN" "$REPO/tools/plugin-bundle/build.ts" --flavor "$FLAVOR" "$MARKET_SRC" 2>&1)
  printf '%s\n' "$BUILD_OUT" > "$WORK/bundle-build.txt"
  rm -rf "$REPO_MARKET"
  mkdir -p "$REPO_MARKET/.claude-plugin"
  cp "$REPO/.claude-plugin/marketplace.json" "$REPO_MARKET/.claude-plugin/marketplace.json"
else
  step "snapshot the working tree into a git marketplace (tracked + new files, no node_modules)"
  mkdir -p "$MARKET_SRC"
  ( cd "$REPO" && git ls-files -co --exclude-standard -z ) |
    ( cd "$REPO" && xargs -0 -I{} sh -c 'mkdir -p "$1/$(dirname "$2")" && cp -p "$2" "$1/$2"' _ "$MARKET_SRC" {} )
fi
(
  cd "$MARKET_SRC" &&
    git init -q -b main &&
    git -c user.name=plugin-loop -c user.email=plugin-loop@example.invalid add -A &&
    git -c user.name=plugin-loop -c user.email=plugin-loop@example.invalid commit -q -m snapshot &&
    git clone -q --bare . "$MARKET_GIT"
) >/dev/null 2>&1
if [ -f "$MARKET_GIT/HEAD" ] && [ -f "$MARKET_SRC/.claude-plugin/plugin.json" ] && [ -f "$REPO_MARKET/.claude-plugin/marketplace.json" ]; then
  ok
  [ "$BUNDLE" = 1 ] && sed 's/^/      /' "$WORK/bundle-build.txt"
else
  no "no snapshot" "${BUILD_OUT:-}"
fi

step "the repository's entry pins a release tag; the snapshot is tagged with it, and its branch moves past it"
# The pin, read from the repository's own marketplace.json: our GitHub URL at a tag.
PIN=$(bun -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const e = (m.plugins ?? []).find((p) => p.name === "counterparts");
  const s = e?.source;
  console.log(s && typeof s === "object" && s.source === "url" && /^https:\/\/github\.com\/(mlapeter|counterparts-ai)\//.test(s.url ?? "") ? (s.ref ?? "") : "");
' "$REPO_MARKET/.claude-plugin/marketplace.json" 2>/dev/null || true)
# Inside the throwaway bare clone only: the snapshot gets the pin's tag, and the
# branch gets one more commit (a marker file) the pin must not install.
PAST="$WORK/past-the-pin"
rm -rf "$PAST"
if [[ "$PIN" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  (
    git -C "$MARKET_GIT" tag "$PIN" main &&
      git clone -q "$MARKET_GIT" "$PAST" &&
      cd "$PAST" &&
      echo "a commit past the pinned tag; a pinned install never has this file" > PAST-THE-PIN &&
      git -c user.name=plugin-loop -c user.email=plugin-loop@example.invalid add PAST-THE-PIN &&
      git -c user.name=plugin-loop -c user.email=plugin-loop@example.invalid commit -q -m "past the pin" &&
      git push -q origin HEAD:main
  ) >/dev/null 2>&1
fi
TAGGED=$(git -C "$MARKET_GIT" rev-parse -q --verify "refs/tags/$PIN^{commit}" 2>/dev/null || true)
BRANCH=$(git -C "$MARKET_GIT" rev-parse -q --verify "refs/heads/main" 2>/dev/null || true)
if [[ ! "$PIN" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  no "the repository's entry is not our GitHub URL at a release tag (ref: '${PIN}')" "$(cat "$REPO_MARKET/.claude-plugin/marketplace.json")"
elif [ -z "$TAGGED" ] || [ -z "$BRANCH" ] || [ "$TAGGED" = "$BRANCH" ]; then
  no "could not tag the snapshot $PIN and move its branch past it" "tag: $TAGGED
main: $BRANCH"
else
  ok
  echo "      pin: $PIN (the loop installs the working tree under that tag)"
fi

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
ADD0=$(claude plugin marketplace add "$REPO_MARKET" 2>&1)
LISTED=$(claude plugin marketplace list 2>&1)
REMOVED=$(claude plugin marketplace remove counterparts 2>&1)
if grep -q "counterparts" <<<"$LISTED" && ! grep -qi "error\|invalid\|✘" <<<"$ADD0"; then
  ok
else
  no "the repository's marketplace did not add" "$ADD0
$LISTED
$REMOVED"
fi

# `marketplace add` refuses a file:// URL, but a plugin ENTRY may name one
# (`url` source), and that is the same path a GitHub source takes: clone at
# the entry's `ref`, copy into ~/.claude/plugins/cache, dependency install. So
# the loop's own one-entry marketplace points at the snapshot's bare clone,
# with the repository's pin as its `ref`.
LOOP_MARKET="$WORK/loop-marketplace"
mkdir -p "$LOOP_MARKET/.claude-plugin"
loop_market() { # loop_market <ref>
  cat > "$LOOP_MARKET/.claude-plugin/marketplace.json" <<EOF
{
  "name": "counterparts-loop",
  "owner": { "name": "plugin-loop" },
  "plugins": [
    { "name": "counterparts", "source": { "source": "url", "url": "file://$MARKET_GIT", "ref": "$1" } }
  ]
}
EOF
}

step "pinned to a tag that does not exist yet (master before the first plugin release): the install fails and installs nothing"
loop_market "v999.0.0"
ADD=$(claude plugin marketplace add "$LOOP_MARKET" 2>&1)
UNTAGGED=$(claude plugin install counterparts@counterparts-loop 2>&1)
UNTAGGED_RC=$?
printf '%s\n%s\nexit %s\n' "$ADD" "$UNTAGGED" "$UNTAGGED_RC" > "$WORK/install-untagged.txt"
if [ "$UNTAGGED_RC" -ne 0 ] &&
   ! grep -qs '"counterparts@counterparts-loop"' "$HOME/.claude/plugins/installed_plugins.json" &&
   [ ! -d "$HOME/.claude/plugins/cache/counterparts-loop" ]; then
  ok
  grep -m1 -oE "fatal: .*" <<<"$UNTAGGED" | cut -c1-160 | sed 's/^/      /'
else
  no "an entry naming a missing tag installed something (exit $UNTAGGED_RC)" "$ADD
$UNTAGGED
$(ls -R "$HOME/.claude/plugins/cache" 2>&1 | head -10)"
fi

step "plugin install through a git source at the pinned tag: Claude Code clones, copies into its cache, installs dependencies"
loop_market "$PIN"
UPDATE=$(claude plugin marketplace update counterparts-loop 2>&1)
INSTALL=$(claude plugin install counterparts@counterparts-loop 2>&1)
printf '%s\n%s\n' "$UPDATE" "$INSTALL" > "$WORK/install.txt"
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
  no "the plugin is not installed (or its path could not be read)" "$UPDATE
$INSTALL
$JSON"
  echo "STOPPING: nothing to exercise."
  echo "workdir: $WORK"
  exit 1
fi

step "the install is the tagged snapshot (the working tree), not the branch head past the tag"
if [ -e "$INSTALL_PATH/PAST-THE-PIN" ]; then
  no "the install carries the commit past $PIN: Claude Code took the branch, not the pin" "$(ls "$INSTALL_PATH" | head -20)"
elif ! cmp -s "$MARKET_SRC/.claude-plugin/plugin.json" "$INSTALL_PATH/.claude-plugin/plugin.json"; then
  no "the installed plugin.json is not the snapshot's" "$(diff "$MARKET_SRC/.claude-plugin/plugin.json" "$INSTALL_PATH/.claude-plugin/plugin.json" | head -20)"
else
  ok
fi

step "the install is a COPY in the cache, with no .git (so doctor reads it as an installed package)"
if [ -d "$INSTALL_PATH/.git" ]; then no "the cached copy carries .git" "$(ls -la "$INSTALL_PATH" | head -20)"; else ok; fi

if [ "$BUNDLE" = 1 ]; then
  step "the installed bundle is inside the directory's limits: ≤ 512 files, no tests, no module docs, no symlinks"
  SHIPPED=$( cd "$INSTALL_PATH" && find . -path ./node_modules -prune -o \( -type f -o -type l \) -print | sed 's|^\./||' | sort )
  COUNT=$(printf '%s\n' "$SHIPPED" | grep -c . || true)
  STRAY=$(printf '%s\n' "$SHIPPED" | grep -E '(^|/)(NOTES|CONTRACT|INTERFACE-GAPS)\.md$|\.test\.[cm]?[jt]sx?$|(^|/)tests?/|\.DS_Store$' || true)
  LINKS=$( cd "$INSTALL_PATH" && find . -path ./node_modules -prune -o -type l -print )
  if [ "$COUNT" -le 512 ] && [ -z "$STRAY" ] && [ -z "$LINKS" ]; then
    ok
    echo "      $COUNT files (node_modules aside)"
  else
    no "$COUNT files; stray: ${STRAY:-none}; links: ${LINKS:-none}" ""
  fi
fi

if [ "$FLAVOR" = directory ]; then
  step "directory flavor: the installed entries are executable and start Bun by their shebang; no launcher, no TypeScript under src/"
  BAD=""
  for e in src/adapters/claude-code/bin/hook.js src/adapters/mcp/bin/serve.js src/adapters/cli/bin/counterparts.js; do
    [ -x "$INSTALL_PATH/$e" ] || BAD="$BAD $e(not executable)"
    head -1 "$INSTALL_PATH/$e" 2>/dev/null | grep -q '^#!/usr/bin/env -S bun ' || BAD="$BAD $e(no shebang)"
  done
  [ -e "$INSTALL_PATH/src/adapters/plugin-run.sh" ] && BAD="$BAD plugin-run.sh(present)"
  LEFT_TS=$( cd "$INSTALL_PATH" && find src -name '*.ts' -o -name '*.tsx' | head -3 )
  [ -n "$LEFT_TS" ] && BAD="$BAD ts-left:$LEFT_TS"
  if [ -z "$BAD" ]; then
    ok
    head -1 "$INSTALL_PATH/src/adapters/mcp/bin/serve.js" | sed 's/^/      /'
  else
    no "$BAD" "$(ls -l "$INSTALL_PATH/src/adapters/claude-code/bin" "$INSTALL_PATH/src/adapters/mcp/bin" "$INSTALL_PATH/src/adapters/cli/bin" 2>&1)"
  fi
fi

step "Claude Code installed the one dependency (the embedding table) from $LOCKFILE"
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
if grep -q "Counterparts is set up" <<<"$WAKE" && grep -q "additionalContext" <<<"$WAKE"; then
  ok
else
  no "no first-run wake in the debug log" "$(grep -iE 'hook|counterparts' "$WORK/debug-wake.log" | tail -20)"
fi

step "the sidebar mod loads: Claude Code registers the plugin's hooks module"
MODULE=$(grep -E 'hooks module counterparts@counterparts-loop loaded' "$WORK/debug-wake.log" | head -1 || true)
if [ -n "$MODULE" ] && grep -q 'ui.render' <<<"$MODULE"; then
  ok
  sed 's/^.*\(hooks module counterparts\)/      \1/' <<<"$MODULE" | cut -c1-160
else
  no "no 'hooks module counterparts@… loaded' line in the debug log" "$(grep -iE 'hooks module|modules' "$WORK/debug-wake.log" | tail -10)"
fi

step "/counterparts:doctor is registered (its command is run for real under 'doctor' below)"
# Every command the installed copy carries, so a new one (dashboard.md) does not fail this.
COMMANDS=$(ls "$INSTALL_PATH/commands/"*.md 2>/dev/null | wc -l | tr -d ' ')
if [ -f "$INSTALL_PATH/commands/doctor.md" ] && grep -q "Loaded $COMMANDS commands from plugin counterparts" "$WORK/debug-wake.log"; then
  ok
else
  no "Claude Code loaded no command from the plugin" "$(grep -iE 'plugin commands|commands from plugin' "$WORK/debug-wake.log" | tail -5)"
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
  # The list first: it is the long reply, and the server stops when stdin ends.
  printf '%s\n' '{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}'
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"note","arguments":{"text":"%s"}}}\n' "$CANARY"
  printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"recall","arguments":{"question":"what is the bicycle called?","mode":"facts"}}}'
)
launch "$INSTALL_PATH" mcp
MCP_OUT=$( cd "$PROJECT" && printf '%s\n' "$RPC" | t 120 "${SERVE_ENV[@]}" "${LAUNCH[@]}" 2>"$WORK/mcp.err" )
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

step "the plugin's server lists its tools"
LISTED_TOOLS=$(bun -e '
  const line = require("fs").readFileSync(process.argv[1], "utf8").split("\n").find((l) => l.includes("\"id\":4"));
  const r = JSON.parse(line ?? "{}");
  console.log((r.result?.tools ?? []).map((t) => t.name).join(" "));
' "$WORK/mcp-roundtrip.jsonl" 2>/dev/null || true)
TOOL_COUNT=$(wc -w <<<"$LISTED_TOOLS" | tr -d ' ')
if [ "${TOOL_COUNT:-0}" -ge 5 ] && grep -qw remember <<<"$LISTED_TOOLS" && grep -qw recall <<<"$LISTED_TOOLS"; then
  ok
  echo "      $TOOL_COUNT tools: $LISTED_TOOLS"
else
  no "tools/list did not name the memory tools" "$(grep '"id":4' <<<"$MCP_OUT" | cut -c1-400)"
fi

step "the store shows it: the console (from the plugin) finds the note"
launch "$INSTALL_PATH" cli
CLI_OUT=$( cd "$PROJECT" && t 120 "${SERVE_ENV[@]}" "${LAUNCH[@]}" recall "teal bicycle" 2>&1 )
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
    ( launch "$INSTALL_PATH" hook && cd "$PROJECT" && t 120 "${SERVE_ENV[@]}" CLAUDE_CODE_SESSION_ID="$SESSION" "${LAUNCH[@]}" )
}
hook SessionStart ',"source":"startup"' >"$WORK/hook-start.out" 2>"$WORK/hook-start.err"
hook UserPromptSubmit ',"prompt":"My sister Odalys keeps bees on her roof in Tucson."' >"$WORK/hook-prompt.out" 2>"$WORK/hook-prompt.err"
hook Stop ',"stop_hook_active":false' >"$WORK/hook-stop.out" 2>"$WORK/hook-stop.err"
hook SessionEnd ',"reason":"exit"' >"$WORK/hook-end.out" 2>"$WORK/hook-end.err"
# The worker the Stop spawned writes in the background; give it a moment.
sleep 5
launch "$INSTALL_PATH" cli
STATUS=$( cd "$PROJECT" && t 120 "${SERVE_ENV[@]}" "${LAUNCH[@]}" status 2>&1 )
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

step "doctor (what /counterparts:doctor runs) reads the plugin install as connected"
launch "$INSTALL_PATH" cli
DOCTOR=$( cd "$PROJECT" && t 120 "${SERVE_ENV[@]}" "${LAUNCH[@]}" doctor 2>&1 )
printf '%s\n' "$DOCTOR" > "$WORK/doctor.txt"
if grep -q "connected as the Claude Code plugin (counterparts@counterparts-loop" <<<"$DOCTOR" &&
   grep -qE "^GREEN +Recall by meaning +on" <<<"$DOCTOR" &&
   grep -qE "^GREEN +Checkout +not a git checkout" <<<"$DOCTOR"; then
  ok
  grep -E "^[0-9]+ red" <<<"$DOCTOR" | sed 's/^/      /'
else
  no "doctor did not read the plugin install (or recall/checkout lines differ)" "$(grep -E "Claude Code|Recall by meaning|Checkout|red,|^RED|^AMBER" <<<"$DOCTOR")"
fi

if [ "$BUNDLE" = 1 ]; then
  if [ "$FLAVOR" = directory ]; then
    echo "SKIP  Bun named outright (COUNTERPARTS_RUNTIME): the directory flavor has no launcher to choose a runtime; Bun ran every step above"
  else
  step "Bun, named outright (COUNTERPARTS_RUNTIME), finds the table npm installed"
  BUN_DOCTOR=$( cd "$PROJECT" && t 120 "${SERVE_ENV[@]}" COUNTERPARTS_RUNTIME="$BUN_BIN" sh "$INSTALL_PATH/src/adapters/plugin-run.sh" cli doctor 2>&1 )
  printf '%s\n' "$BUN_DOCTOR" > "$WORK/doctor-bun.txt"
  if grep -qE "^GREEN +Recall by meaning +on" <<<"$BUN_DOCTOR"; then
    ok
    grep -E "Recall by meaning" <<<"$BUN_DOCTOR" | cut -c1-140 | sed 's/^/      /'
  else
    no "under Bun, doctor's Recall by meaning line is not green" "$(grep -E "Recall by meaning|^RED|^AMBER" <<<"$BUN_DOCTOR")"
  fi
  fi

  # WHEN THE DEPENDENCY INSTALL DID NOT RUN (no npm, the 60 s limit, offline):
  # a copy of the install without node_modules, each run on a store of its own
  # (a throwaway home inside this workdir): a first session, then doctor.
  NODEPS="$WORK/no-deps-copy"
  rm -rf "$NODEPS"
  cp -R "$INSTALL_PATH" "$NODEPS" && rm -rf "$NODEPS/node_modules"
  nodeps_doctor() { # nodeps_doctor <runtime> <home> → doctor's output
    rm -rf "$2"
    mkdir -p "$2/project"
    local envs=(env HOME="$2" USERPROFILE="$2" BUN_INSTALL="$2/.bun" COUNTERPARTS_RUNTIME="$1" CLAUDE_PLUGIN_ROOT="$NODEPS" CLAUDE_PLUGIN_DATA="$2/.claude/plugins/data/counterparts-counterparts-loop" CLAUDE_PROJECT_DIR="$2/project" CLAUDECODE=1)
    # A whole session, so the processes the hooks start (the runner, the
    # embedding worker) run too, then doctor.
    local tr="$2/project/transcript.jsonl"
    printf '%s\n' '{"type":"user","message":{"role":"user","content":"Our neighbour Ilse restores harpsichords in a barn."},"timestamp":"2026-10-11T10:00:00Z"}' \
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Harpsichords in a barn: noted about Ilse."}]},"timestamp":"2026-10-11T10:00:05Z"}' > "$tr"
    local ev
    for ev in 'SessionStart","source":"startup' 'UserPromptSubmit","prompt":"Our neighbour Ilse restores harpsichords in a barn.' 'Stop","stop_hook_active":false' 'SessionEnd","reason":"exit'; do
      printf '{"session_id":"no-deps-%s","cwd":"%s","transcript_path":"%s","hook_event_name":"%s"}' "$$" "$2/project" "$tr" "$ev" |
        ( launch "$NODEPS" hook && cd "$2/project" && t 120 "${envs[@]}" "${LAUNCH[@]}" ) >>"$2.hook.out" 2>&1
    done
    sleep 8
    ( launch "$NODEPS" cli && cd "$2/project" && t 120 "${envs[@]}" "${LAUNCH[@]}" doctor 2>&1 )
  }

  # A Node 22.15+ from the real home's version managers, borrowed like bun.
  NODE_OK=""
  for n in "$REAL_HOME"/.nvm/versions/node/v2[2-9]*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$n" ] || continue
    v="$("$n" --version 2>/dev/null)"; v="${v#v}"
    major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
    if [ "$major" -gt 22 ] 2>/dev/null || { [ "$major" -eq 22 ] && [ "$minor" -ge 15 ]; } 2>/dev/null; then NODE_OK="$n"; break; fi
  done
  if [ "$FLAVOR" = directory ]; then
    echo "SKIP  no dependency install, under Node: the directory flavor runs under Bun alone"
  else
  step "no dependency install, under Node: doctor's Recall by meaning line is amber and says recall still matches on words"
  if [ -z "$NODE_OK" ]; then
    no "no Node 22.15+ to run this with (nvm, Homebrew, /usr/local)" ""
  else
    NODEPS_DOCTOR=$(nodeps_doctor "$NODE_OK" "$WORK/home-no-deps-node")
    printf '%s\n' "$NODEPS_DOCTOR" > "$WORK/doctor-no-deps-node.txt"
    if grep -qE "^AMBER +Recall by meaning +on \(a local table\), but .*recall still matches on words" <<<"$NODEPS_DOCTOR"; then
      ok
      echo "      node $("$NODE_OK" --version):"
      grep -A1 -E "Recall by meaning" <<<"$NODEPS_DOCTOR" | cut -c1-220 | sed 's/^/      /'
    else
      no "doctor did not name the missing table" "$(grep -A1 -E "Recall by meaning" <<<"$NODEPS_DOCTOR")"
    fi
  fi
  fi

  # Under Bun, with no node_modules anywhere above the plugin, Bun's runtime
  # would fetch the package from the npm registry into ~/.bun/install/cache at
  # first use, unpinned. empty-bunfig.toml, which every Bun launch names (the
  # runner and embedding worker included), turns that off, so the table stays
  # missing and doctor says so, as under Node.
  step "no dependency install, under Bun: no auto-install (nothing in ~/.bun/install/cache), doctor's line is amber"
  NODEPS_DOCTOR=$(nodeps_doctor "$BUN_BIN" "$WORK/home-no-deps-bun")
  printf '%s\n' "$NODEPS_DOCTOR" > "$WORK/doctor-no-deps-bun.txt"
  CACHED=$(ls -d "$WORK/home-no-deps-bun/.bun/install/cache/"* 2>/dev/null | head -3)
  if [ -z "$CACHED" ] && grep -qE "^AMBER +Recall by meaning +on \(a local table\), but .*recall still matches on words" <<<"$NODEPS_DOCTOR"; then
    ok
    grep -E "Recall by meaning" <<<"$NODEPS_DOCTOR" | cut -c1-200 | sed 's/^/      /'
  else
    no "Bun fetched something, or doctor's line is not amber (cache: ${CACHED:-empty})" "$(grep -A1 -E "Recall by meaning" <<<"$NODEPS_DOCTOR")"
  fi
  rm -rf "$NODEPS"
fi

# ── 6. the double-install guard ────────────────────────────────────────────

if [ "$FLAVOR" = directory ]; then
  # The directory flavor never reads ~/.claude.json (runtime.ts#readsHostUserConfig):
  # it stands down by the npm install's marker (npm-live.ts) instead, which only a
  # source install writes. The "npm hooks" here are this bundle's own entries wired
  # into settings, a transpiled tree that writes none, so nothing stands down; the
  # marker's stand-down is held by test/plugin-bundle.test.ts against the written tree.
  step "with the npm hooks ALSO wired, the directory flavor does not stand down (it has no stand-down to make) and says nothing of it"
else
  step "with the npm hooks ALSO wired, the plugin stands down and says so once; one wake, not two"
fi
mkdir -p "$HOME/.claude"
cp "$HOME/.claude/settings.json" "$WORK/settings.before.json" 2>/dev/null || echo '{}' > "$WORK/settings.before.json"
HOOK_SRC="$INSTALL_PATH/src/adapters/claude-code/bin/hook.ts"
[ "$FLAVOR" = directory ] && HOOK_SRC="$INSTALL_PATH/src/adapters/claude-code/bin/hook.js"
NPM_HOOK="\"$BUN_BIN\" run \"$HOOK_SRC\""
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
if [ "$FLAVOR" = directory ]; then
  # Both hooks run; the per-event claim decides how many wakes the session gets.
  if ! grep -q "installed twice" <<<"$OUTS" && [ "${WAKES:-0}" -ge 1 ]; then
    ok
    echo "      wakes with both wired: $WAKES"
  else
    no "expected a wake and no stand-down line (wakes: $WAKES)" "$OUTS"
  fi
elif grep -q "installed twice" <<<"$OUTS" && [ "$WAKES" = "1" ]; then
  ok
else
  no "expected one wake and one stand-down line (wakes: $WAKES)" "$OUTS"
fi

step "moving to the plugin (the npm hooks removed): the plugin wakes again, same store"
cp "$WORK/settings.before.json" "$HOME/.claude/settings.json"
rm -f "$WORK/debug-moved.log"
( cd "$PROJECT" && claude --debug-file "$WORK/debug-moved.log" --init-only >/dev/null 2>&1 )
OUTS=$(grep -F 'Hook SessionStart:startup (SessionStart) success' "$WORK/debug-moved.log" || true)
if grep -q "Now: " <<<"$OUTS" && ! grep -q "installed twice" <<<"$OUTS" && ! grep -q "Counterparts is set up" <<<"$OUTS"; then
  ok
else
  no "the plugin did not wake on the existing store" "$OUTS"
fi

if [ "$FLAVOR" = directory ]; then
  step "directory flavor: ~/.claude.json is never opened (a live npm registration there stands nothing down; as a FIFO no read could pass, the hook, the server and doctor all finish)"
  [ -f "$HOME/.claude.json" ] || echo '{}' > "$HOME/.claude.json"
  cp "$HOME/.claude.json" "$WORK/claude-json.before"
  bun -e '
    const fs = require("fs");
    const [file, exe, serve] = process.argv.slice(1);
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    s.mcpServers = { ...(s.mcpServers ?? {}), counterparts: { type: "stdio", command: exe, args: ["run", serve], env: {} } };
    fs.writeFileSync(file, JSON.stringify(s, null, 2));
  ' "$HOME/.claude.json" "$BUN_BIN" "$INSTALL_PATH/src/adapters/mcp/bin/serve.js"
  LIST_RPC=$(
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"claude-code","version":"plugin-loop"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}'
  )
  tools_in() { # tools_in <jsonl file>: how many tools the tools/list reply names
    bun -e '
      const line = require("fs").readFileSync(process.argv[1], "utf8").split("\n").find((l) => l.includes("\"id\":4"));
      console.log((JSON.parse(line ?? "{}").result?.tools ?? []).length);
    ' "$1" 2>/dev/null || echo 0
  }
  launch "$INSTALL_PATH" mcp
  ( cd "$PROJECT" && printf '%s\n' "$LIST_RPC" | t 60 "${SERVE_ENV[@]}" "${LAUNCH[@]}" ) >"$WORK/mcp-registered.jsonl" 2>"$WORK/mcp-registered.err"
  REGISTERED_TOOLS=$(tools_in "$WORK/mcp-registered.jsonl")
  # The FIFO: a read of it blocks until a writer comes, and none does; `t`
  # ends a blocked process with SIGALRM (exit 142).
  rm -f "$HOME/.claude.json"
  mkfifo "$HOME/.claude.json"
  hook SessionStart ',"source":"startup"' >"$WORK/fifo-hook.out" 2>"$WORK/fifo-hook.err"; FIFO_HOOK=$?
  ( cd "$PROJECT" && printf '%s\n' "$LIST_RPC" | t 60 "${SERVE_ENV[@]}" "${LAUNCH[@]}" ) >"$WORK/fifo-mcp.jsonl" 2>"$WORK/fifo-mcp.err"; FIFO_MCP=$?
  launch "$INSTALL_PATH" cli
  ( cd "$PROJECT" && t 120 "${SERVE_ENV[@]}" "${LAUNCH[@]}" doctor ) >"$WORK/fifo-doctor.txt" 2>&1; FIFO_DOCTOR=$?
  FIFO_TOOLS=$(tools_in "$WORK/fifo-mcp.jsonl")
  rm -f "$HOME/.claude.json"
  cp "$WORK/claude-json.before" "$HOME/.claude.json"
  if [ "${REGISTERED_TOOLS:-0}" -ge 5 ] && [ "$FIFO_HOOK" != 142 ] && [ "$FIFO_MCP" != 142 ] && [ "$FIFO_DOCTOR" != 142 ] &&
     grep -q "Now: " "$WORK/fifo-hook.out" && [ "${FIFO_TOOLS:-0}" -ge 5 ] &&
     grep -q "connected as the Claude Code plugin (counterparts@counterparts-loop" "$WORK/fifo-doctor.txt" &&
     ! grep -q "standing down" "$WORK/fifo-doctor.txt"; then
    ok
  else
    no "a reader opened ~/.claude.json, or the registration stood something down (tools beside a registration: $REGISTERED_TOOLS; past the FIFO: hook exit $FIFO_HOOK, server exit $FIFO_MCP and $FIFO_TOOLS tools, doctor exit $FIFO_DOCTOR)" "$(cat "$WORK/fifo-hook.err" "$WORK/fifo-mcp.err"; grep -E "Claude Code|standing" "$WORK/fifo-doctor.txt")"
  fi
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
