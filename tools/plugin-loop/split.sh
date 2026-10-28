#!/usr/bin/env bash
#
# The split loop (2026-10-20): the two plugins of our own marketplace —
# `counterparts` (memory) and `counterparts-sidebar` (the mod, depending on it)
# — installed for real by Claude Code, each scenario in a HOME that has never
# seen either, from bundles this checkout builds (tools/plugin-bundle/build.ts
# --flavor core|sidebar), served from local git repositories by a local
# marketplace named `counterparts`, so the install ids are the real ones.
#
#   1. the sidebar alone pulls in counterparts through `dependencies`;
#   2. counterparts alone shows no sidebar and still wakes;
#   3. an npm install (this checkout's own hook and server, wired the way
#      `counterparts install` wires them) plus the sidebar plugin: one pane, the
#      plugin's server stands down (no tool offered twice), and the npm side
#      writes the sidebar's status file;
#   4. a counterparts@counterparts install from before the split (the `full`
#      flavor, tagged v<old>), then the marketplace moves to the split: what
#      `marketplace update` + `plugin update` gives, and what installing the
#      sidebar then gives; 4b: the sidebar installed WITHOUT updating core
#      first (the dependency's range refuses it); 4c, for the record: the
#      same with a bare dependency (two panes);
#   5. core's repository without the counterparts--v<version> tag the range
#      resolves against: the sidebar does not install.
#
# Usage:  tools/plugin-loop/split.sh [workdir] [old-version]
# Env:    CLAUDE_BIN  the Claude Code executable (default: `claude` on PATH)
#         SPLIT_OLD   the release before the split that scenario 4 upgrades
#                     from (same as old-version; default below, "the bundles")
#
# It runs before the split release, on the split's release commit and on every
# release after it: the versions it labels the bundles with are worked out
# below, and the pre-split plugin is always this checkout built as `full`.
#
# A pane is drawn only in an interactive terminal, so "one sidebar" is read
# from Claude Code's debug log of a `--init-only` start: the hooks modules it
# loaded (`hooks module <id> loaded`), which is what draws a pane.
#
# NEVER the real HOME (the guard is run.sh's), never a real store: every
# Counterparts process here gets COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1,
# COUNTERPARTS_UPDATE_CHECK=off and a COUNTERPARTS_CONFIG inside the
# scenario's own HOME.

set -uo pipefail

REAL_HOME="$HOME"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
WORK="${1:-${TMPDIR:-/tmp}/split-loop-$$}"
WORK="${WORK%/}"
[ -n "${REAL_HOME:-}" ] || { echo "REFUSED: \$HOME is unset"; exit 1; }
case "$WORK/" in "$REAL_HOME"/*) echo "REFUSED: the workdir ($WORK) is inside the real home"; exit 1 ;; esac
mkdir -p "$WORK" || exit 1
WORK="$(cd "$WORK" && pwd -P)"
case "$WORK/" in "$REAL_HOME"/*) echo "REFUSED: the workdir resolves inside the real home"; exit 1 ;; esac
for v in COUNTERPARTS_DATA_DIR COUNTERPARTS_CONFIG CLAUDE_CONFIG_DIR CLAUDE_CODE_PLUGIN_CACHE_DIR CLAUDE_CODE_PLUGIN_DIRS; do
  if [ -n "${!v:-}" ]; then echo "REFUSED: $v is already set (${!v})"; exit 1; fi
done

CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
[ -x "$CLAUDE_BIN" ] || { echo "REFUSED: no Claude Code executable (set CLAUDE_BIN)"; exit 1; }
if [ -L "$CLAUDE_BIN" ]; then
  CLAUDE_BIN="$(cd "$(dirname "$CLAUDE_BIN")" && cd "$(dirname "$(readlink "$CLAUDE_BIN")")" && pwd -P)/$(basename "$(readlink "$CLAUDE_BIN")")"
fi
BUN_BIN="$(command -v bun || echo "$REAL_HOME/.bun/bin/bun")"
GIT_BIN="$(command -v git || true)"
NPM_BIN="$(command -v npm || true)"
[ -x "$BUN_BIN" ] && [ -x "$GIT_BIN" ] && [ -x "$NPM_BIN" ] || { echo "REFUSED: needs bun, git and npm"; exit 1; }
export PATH="$(dirname "$BUN_BIN"):$(dirname "$NPM_BIN"):$(dirname "$GIT_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"
export DISABLE_AUTOUPDATER=1
export COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1
# The daily update check (U1b) asks registry.npmjs.org; a loop measures the
# install, not npm, so it stays off in the clean room.
export COUNTERPARTS_UPDATE_CHECK=off

t() { perl -e 'alarm shift; exec @ARGV' "$@"; }
claude() { t 300 "$CLAUDE_BIN" "$@"; }
G=(git -c user.name=split-loop -c user.email=split-loop@example.invalid)

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/      | /' | head -30; return 0; }
say() { printf '      %s\n' "$@"; }

# A HOME of the scenario's own: Claude Code's files, the store, npm's and bun's caches.
fresh_home() { # fresh_home <name>
  export HOME="$WORK/$1/home"
  rm -rf "$WORK/$1"
  mkdir -p "$HOME/project"
  [ "$HOME" != "$REAL_HOME" ] || { echo "REFUSED: HOME did not change"; exit 1; }
  export USERPROFILE="$HOME" BUN_INSTALL="$HOME/.bun" npm_config_cache="$HOME/.npm"
  # Named, both, so the explicit-dir guard lets the store open (a first run
  # skips its own setup when a configuration is named: the wake is checked
  # by its "Now:" block, not by the first-run line).
  export COUNTERPARTS_CONFIG="$HOME/.counterparts/claude-code.json"
  export COUNTERPARTS_DATA_DIR="$HOME/.counterparts/store"
  PROJECT="$HOME/project"
  LOGS="$WORK/$1"
}

# The hooks modules a start loads (what draws a pane), one id per line;
# Claude Code's own (`@builtin`) aside.
modules_loaded() { # modules_loaded <debug log>
  grep -oE 'hooks module [^ ]+ loaded' "$1" 2>/dev/null | awk '{print $3}' | grep -v '@builtin$' | sort -u
}
START_RC=0
start() { # start <log name>: one --init-only start in the project, its debug log and exit kept
  ( cd "$PROJECT" && claude --debug-file "$LOGS/$1.log" --init-only >"$LOGS/$1.out" 2>&1 )
  START_RC=$?
  [ "$START_RC" -eq 0 ] || say "(that start exited $START_RC: $(tail -3 "$LOGS/$1.out" | tr '\n' ' ' | cut -c1-300))"
}
woke() { # woke <log name>: the SessionStart output carried a wake ("Now: ...")
  grep -F 'Hook SessionStart:startup (SessionStart) success' "$LOGS/$1.log" | grep -q 'Now: '
}
installed() { # the install ids and versions Claude Code recorded
  "$BUN_BIN" -e '
    const f = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const [id, v] of Object.entries(f.plugins ?? {})) for (const r of [].concat(v)) console.log(`${id} ${r.version}`);
  ' "$HOME/.claude/plugins/installed_plugins.json" 2>/dev/null | sort
}
install_path() { # install_path <id>
  "$BUN_BIN" -e '
    const f = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log([].concat(f.plugins?.[process.argv[2]] ?? [])[0]?.installPath ?? "");
  ' "$HOME/.claude/plugins/installed_plugins.json" "$1" 2>/dev/null
}

# ── the bundles and their repositories ───────────────────────────────────────

# FLOOR: the split's release (build.ts FIRST_SPLIT_RELEASE), the floor of the
# sidebar's dependency. NEW: the release under test, as core and sidebar are
# labelled: package.json's version once it reaches the floor (the split's
# release commit and every release after it); before that, the floor itself.
# OLD: the release before the split, which the one plugin (`full`) stands for:
# SPLIT_OLD or the second argument, else the newest v* tag below the floor,
# else package.json's version if it is below the floor, else the floor's
# patch less one. Whatever OLD is, the bundle is THIS checkout's sources built
# as the full flavor (planBundle, which the command's tripwire does not stop),
# labelled v$OLD: the one plugin that draws the sidebar itself, so scenario 4
# proves the upgrade from it at any version.
vnum() { "$BUN_BIN" -e 'const [a,b,c]=process.argv[1].split("-")[0].split(".").map(Number); console.log(a*1e6+b*1e3+c)' "$1"; }
PKG="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$REPO/package.json")"
FLOOR="$("$BUN_BIN" -e 'console.log((await import(process.argv[1])).FIRST_SPLIT_RELEASE)' "$REPO/tools/plugin-bundle/build.ts")"
if [ "$(vnum "$PKG")" -ge "$(vnum "$FLOOR")" ]; then NEW="$PKG"; else NEW="$FLOOR"; fi
OLD="${SPLIT_OLD:-${2:-}}"
if [ -z "$OLD" ]; then
  for tag in $("$GIT_BIN" -C "$REPO" tag -l 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null | sed 's/^v//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n); do
    [ "$(vnum "$tag")" -lt "$(vnum "$FLOOR")" ] && OLD="$tag"
  done
fi
if [ -z "$OLD" ] && [ "$(vnum "$PKG")" -lt "$(vnum "$FLOOR")" ]; then OLD="$PKG"; fi
if [ -z "$OLD" ]; then OLD="$(sed -E 's/^([0-9]+\.[0-9]+)\.([0-9]+)$/\1.\2/' <<<"$FLOOR" | awk -F. '{ print $1"."$2"."($3-1) }')"; fi
if ! [[ "$OLD" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || [ "$(vnum "$OLD")" -ge "$(vnum "$FLOOR")" ]; then
  echo "REFUSED: the release before the split ($OLD) must be a version below the split's ($FLOOR)"
  exit 1
fi
B="$WORK/bundles"
rm -rf "$B"
echo "building: full (standing for v$OLD, the one plugin before the split), core and sidebar (v$NEW; the split's floor is v$FLOOR)"
# full through planBundle: from the split on, the command refuses it (the tripwire).
"$BUN_BIN" -e '
  const { planBundle, writeBundle, bundlePaths } = await import(process.argv[1]);
  const plan = planBundle(undefined, "full");
  writeBundle(plan, process.argv[2]);
  console.log(`wrote the full flavor: ${bundlePaths(plan).length} files`);
' "$REPO/tools/plugin-bundle/build.ts" "$B/full" | head -1 | sed 's/^/      /'
for f in core sidebar; do
  "$BUN_BIN" "$REPO/tools/plugin-bundle/build.ts" --flavor "$f" "$B/$f" | head -1 | sed 's/^/      /'
done
# Each manifest says the release it stands for (a release bumps package.json).
relabel() { # relabel <bundle> <version>
  [ "$2" = "$PKG" ] && return 0
  sed -i.bak "s/\"version\": \"$PKG\"/\"version\": \"$2\"/" "$B/$1/.claude-plugin/plugin.json" && rm "$B/$1/.claude-plugin/plugin.json.bak"
}
relabel full "$OLD"
relabel core "$NEW"
relabel sidebar "$NEW"
# 4c's sidebar: the same with a bare dependency (no version range), for the record.
cp -R "$B/sidebar" "$B/sidebar-bare"
"$BUN_BIN" -e '
  const fs = require("fs"); const p = process.argv[1]; const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.dependencies = ["counterparts"];
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
' "$B/sidebar-bare/.claude-plugin/plugin.json"

# counterparts-plugin: the old full bundle at v$OLD, then core at v$NEW and
# counterparts--v$NEW (the tag the sidebar's range resolves against, which a
# release pushes beside v<version>). counterparts-sidebar: the sidebar at v$NEW.
repo_of() { # repo_of <name> <bundle dir> <tag>... (appends a commit to <name>.git)
  local name="$1" dir="$2"; shift 2
  local wt="$WORK/git/$name"
  [ -d "$wt/.git" ] || { mkdir -p "$wt" && "${G[@]}" -C "$wt" init -q -b main; }
  find "$wt" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  cp -R "$dir/." "$wt/"
  "${G[@]}" -C "$wt" add -A >/dev/null && "${G[@]}" -C "$wt" commit -q -m "$name $*"
  for tag in "$@"; do "${G[@]}" -C "$wt" tag "$tag"; done
  rm -rf "$WORK/git/$name.git" && "$GIT_BIN" clone -q --bare "$wt" "$WORK/git/$name.git"
}
rm -rf "$WORK/git"
repo_of counterparts-plugin "$B/full" "v$OLD"
repo_of counterparts-plugin "$B/core" "v$NEW" "counterparts--v$NEW"
repo_of counterparts-sidebar "$B/sidebar" "v$NEW"
repo_of counterparts-sidebar-bare "$B/sidebar-bare" "v$NEW"
# 5's core repository: release tags only (`v<version>`), as the bundle repository has today.
repo_of counterparts-plugin-plain "$B/full" "v$OLD"
repo_of counterparts-plugin-plain "$B/core" "v$NEW"
CORE_URL="file://$WORK/git/counterparts-plugin.git"
SIDEBAR_URL="file://$WORK/git/counterparts-sidebar.git"

# The marketplace: a folder named like ours. `old` is today's one entry;
# `new` is THIS checkout's marketplace.json with each GitHub URL pointed at the
# local repository and each pin moved to the next release, as a release does.
MKT="$WORK/marketplace"
market() { # market old|new|bare|plain
  mkdir -p "$MKT/.claude-plugin"
  "$BUN_BIN" -e '
    const fs = require("fs");
    const [repoMarket, out, kind, oldV, newV, coreUrl, sidebarUrl, bareUrl, plainUrl] = process.argv.slice(1);
    const m = JSON.parse(fs.readFileSync(repoMarket, "utf8"));
    const urls = {
      "counterparts": kind === "plain" ? plainUrl : coreUrl,
      "counterparts-sidebar": kind === "bare" ? bareUrl : sidebarUrl,
    };
    if (kind === "old") m.plugins = m.plugins.filter((p) => p.name === "counterparts");
    // Before the split release the repository lists core alone; the release
    // commit adds the sidebar entry the way this does (docs/RELEASING.md).
    else if (!m.plugins.some((p) => p.name === "counterparts-sidebar")) {
      m.plugins.push({
        name: "counterparts-sidebar",
        source: { source: "url", url: "https://github.com/counterparts-ai/counterparts-sidebar.git", ref: "" },
        description: "A pane beside the chat that shows what your counterpart'"'"'s memory is doing, with a fox. Installs counterparts with it.",
        category: "memory",
      });
    }
    for (const p of m.plugins) {
      p.source = { ...p.source, url: urls[p.name], ref: `v${kind === "old" ? oldV : newV}` };
    }
    fs.writeFileSync(out, JSON.stringify(m, null, 2) + "\n");
  ' "$REPO/.claude-plugin/marketplace.json" "$MKT/.claude-plugin/marketplace.json" "$1" "$OLD" "$NEW" "$CORE_URL" "$SIDEBAR_URL" \
    "file://$WORK/git/counterparts-sidebar-bare.git" "file://$WORK/git/counterparts-plugin-plain.git"
}
market new
V=$(claude plugin validate "$MKT" 2>&1)
if grep -q "Validation passed" <<<"$V"; then ok "the split marketplace validates"; else no "the split marketplace does not validate" "$V"; fi
for f in core sidebar; do
  V=$(claude plugin validate "$B/$f" 2>&1)
  if grep -q "Validation passed" <<<"$V"; then ok "the $f bundle validates"; else no "the $f bundle does not validate" "$V"; fi
done

# ── 1. the sidebar alone ─────────────────────────────────────────────────────

echo
echo "1. a fresh HOME installs counterparts-sidebar alone"
fresh_home s1
market new
claude plugin list 2>&1 | grep -q "No plugins installed" || { echo "STOPPING: s1 HOME is not fresh"; exit 1; }
claude plugin marketplace add "$MKT" >"$LOGS/add.txt" 2>&1
claude plugin install counterparts-sidebar@counterparts >"$LOGS/install.txt" 2>&1
say "\$ claude plugin install counterparts-sidebar@counterparts" && sed 's/^/        /' "$LOGS/install.txt" | head -8
INST=$(installed)
say "installed:" && sed 's/^/        /' <<<"$INST"
if grep -q "^counterparts@counterparts $NEW" <<<"$INST" && grep -q "^counterparts-sidebar@counterparts $NEW" <<<"$INST"; then
  ok "1. the dependency installed counterparts with the sidebar"
else
  no "1. expected both plugins at $NEW" "$(cat "$LOGS/install.txt")"
fi
start wake
MODS=$(modules_loaded "$LOGS/wake.log")
if [ "$MODS" = "counterparts-sidebar@counterparts" ]; then ok "1. one hooks module loads, the sidebar's"; else no "1. hooks modules loaded: ${MODS:-none}" "$(grep -iE 'hooks module|dependenc' "$LOGS/wake.log" | head -10)"; fi
if woke wake; then ok "1. core's SessionStart ran and woke the session"; else no "1. no first-run wake" "$(grep -i 'SessionStart' "$LOGS/wake.log" | tail -5)"; fi
ERRS=$(grep -iE 'refused|does not validate|dependency.*(missing|not installed|disabled)' "$LOGS/wake.log" | head -5)
[ -z "$ERRS" ] && ok "1. no refusal or dependency error in the debug log" || no "1. errors in the debug log" "$ERRS"

# ── 2. counterparts alone ────────────────────────────────────────────────────

echo
echo "2. a fresh HOME installs counterparts alone"
fresh_home s2
market new
claude plugin marketplace add "$MKT" >"$LOGS/add.txt" 2>&1
claude plugin install counterparts@counterparts >"$LOGS/install.txt" 2>&1
INST=$(installed)
say "installed:" && sed 's/^/        /' <<<"$INST"
if [ "$INST" = "counterparts@counterparts $NEW" ]; then ok "2. counterparts alone, nothing else"; else no "2. installed: $INST" "$(cat "$LOGS/install.txt")"; fi
CORE_PATH=$(install_path counterparts@counterparts)
if [ -n "$CORE_PATH" ] && [ ! -e "$CORE_PATH/hooks/sidebar" ] && ! grep -q '"modules"' "$CORE_PATH/hooks/hooks.json" && ! grep -q '"types"' "$CORE_PATH/.claude-plugin/plugin.json"; then
  ok "2. the installed core carries no sidebar, no modules, no types"
else
  no "2. the installed core carries sidebar pieces" "$(ls "$CORE_PATH/hooks" 2>&1)"
fi
start wake
MODS=$(modules_loaded "$LOGS/wake.log")
[ -z "$MODS" ] && ok "2. no hooks module loads (no sidebar)" || no "2. hooks modules loaded: $MODS"
if woke wake; then ok "2. it works: SessionStart woke the session"; else no "2. no first-run wake" "$(grep -i 'SessionStart' "$LOGS/wake.log" | tail -5)"; fi
MCPL=$( cd "$PROJECT" && claude mcp list 2>&1 )
printf '%s\n' "$MCPL" >"$LOGS/mcp-list.txt"
if grep -E "plugin:counterparts:counterparts" <<<"$MCPL" | grep -qi connected; then ok "2. the memory server connects"; else no "2. the memory server did not connect" "$MCPL"; fi

# ── 3. npm install + the sidebar plugin ─────────────────────────────────────

echo
echo "3. a fresh HOME with the npm install wired, then the sidebar plugin"
fresh_home s3
market new
# The npm install, as `counterparts install` wires it: hooks in the user
# settings, the server registered as `counterparts` in the user scope. This
# checkout's sources stand in for the package (they write npm-live.json too).
mkdir -p "$HOME/.claude"
"$BUN_BIN" -e '
  const fs = require("fs"); const [file, cmd] = process.argv.slice(1);
  const s = { hooks: {} };
  for (const e of ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd", "PreCompact"]) s.hooks[e] = [{ hooks: [{ type: "command", command: cmd }] }];
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
' "$HOME/.claude/settings.json" "\"$BUN_BIN\" run \"$REPO/src/adapters/claude-code/bin/hook.ts\""
claude mcp add -s user counterparts -- "$BUN_BIN" run "$REPO/src/adapters/mcp/bin/serve.ts" >"$LOGS/mcp-add.txt" 2>&1
claude plugin marketplace add "$MKT" >"$LOGS/add.txt" 2>&1
claude plugin install counterparts-sidebar@counterparts >"$LOGS/install.txt" 2>&1
INST=$(installed)
say "installed:" && sed 's/^/        /' <<<"$INST"
start wake
MODS=$(modules_loaded "$LOGS/wake.log")
[ "$MODS" = "counterparts-sidebar@counterparts" ] && ok "3. one hooks module loads: one sidebar" || no "3. hooks modules loaded: ${MODS:-none}"
OUTS=$(grep -F 'Hook SessionStart:startup (SessionStart) success' "$LOGS/wake.log" || true)
WAKES=$(grep -c 'Now: ' <<<"$OUTS" || true)
if [ "$WAKES" = "1" ]; then ok "3. one wake, not two (the plugin's hooks stand down)"; else no "3. wakes: $WAKES" "$OUTS"; fi
CORE_PATH=$(install_path counterparts@counterparts)
RPC=$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"claude-code","version":"split-loop"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
tools_of() { "$BUN_BIN" -e '
  const l = require("fs").readFileSync(0, "utf8").split("\n").find((x) => x.includes("\"id\":2"));
  console.log(((JSON.parse(l ?? "{}").result ?? {}).tools ?? []).map((t) => t.name).join(" "));'; }
PLUGIN_TOOLS=$( cd "$PROJECT" && printf '%s\n' "$RPC" | t 60 env CLAUDE_PLUGIN_ROOT="$CORE_PATH" CLAUDE_PROJECT_DIR="$PROJECT" CLAUDECODE=1 sh "$CORE_PATH/src/adapters/plugin-run.sh" mcp 2>"$LOGS/plugin-mcp.err" | tools_of )
# The npm server, kept open long enough for its first status write (a few seconds after start).
NPM_TOOLS=$( cd "$PROJECT" && { printf '%s\n' "$RPC"; sleep 8; } | t 60 env CLAUDE_PROJECT_DIR="$PROJECT" CLAUDECODE=1 "$BUN_BIN" run "$REPO/src/adapters/mcp/bin/serve.ts" 2>"$LOGS/npm-mcp.err" | tools_of )
say "plugin server tools: ${PLUGIN_TOOLS:-(none)}" "plugin server said: $(head -1 "$LOGS/plugin-mcp.err")" "npm server tools: $NPM_TOOLS"
if [ -z "$PLUGIN_TOOLS" ] && [ "$(wc -w <<<"$NPM_TOOLS" | tr -d ' ')" -ge 5 ]; then ok "3. no tool offered twice: the plugin's server stands down, the npm server serves"; else no "3. plugin tools: '${PLUGIN_TOOLS}', npm tools: '${NPM_TOOLS}'"; fi
if [ -f "$HOME/.counterparts/sidebar.json" ]; then ok "3. the npm server wrote ~/.counterparts/sidebar.json for the sidebar"; else no "3. no sidebar.json" "$(ls -la "$HOME/.counterparts" 2>&1 | head -20)"; fi
WANTED=$( "$BUN_BIN" -e '
  const { sidebarInstalled } = await import(process.argv[1]);
  console.log(sidebarInstalled({ ...process.env, CLAUDE_PLUGIN_ROOT: "" }, process.env.HOME, process.env.COUNTERPARTS_CONFIG, Date.now() + 2 * 24 * 3600e3));
' "$REPO/src/adapters/sidebar-status.ts" 2>&1 )
[ "$WANTED" = "true" ] && ok "3. the npm side counts the sidebar installed from Claude Code's record alone (no presence marker)" || no "3. sidebarInstalled from the record: $WANTED"

# ── 4. an install from before the split ─────────────────────────────────────

before_split() { # before_split <scenario>: counterparts@counterparts as released today
  fresh_home "$1"
  market old
  claude plugin marketplace add "$MKT" >"$LOGS/add.txt" 2>&1
  claude plugin install counterparts@counterparts >"$LOGS/install-old.txt" 2>&1
  start before
}

echo
echo "4. counterparts@counterparts $OLD (one plugin with the sidebar), then the marketplace moves to the split"
before_split s4
say "before: $(installed | tr '\n' ' ')  modules: $(modules_loaded "$LOGS/before.log" | tr '\n' ' ')"
[ "$(modules_loaded "$LOGS/before.log")" = "counterparts@counterparts" ] && ok "4. before: the one plugin draws the sidebar" || no "4. before: modules $(modules_loaded "$LOGS/before.log")"
market new
claude plugin marketplace update counterparts >"$LOGS/mkt-update.txt" 2>&1
say "\$ claude plugin marketplace update counterparts" && sed 's/^/        /' "$LOGS/mkt-update.txt" | head -4
say "after marketplace update alone: $(installed | tr '\n' ' ')"
claude plugin update counterparts@counterparts >"$LOGS/update.txt" 2>&1
say "\$ claude plugin update counterparts@counterparts" && sed 's/^/        /' "$LOGS/update.txt" | head -4
start after-update
INST=$(installed)
MODS=$(modules_loaded "$LOGS/after-update.log")
say "after plugin update: $(tr '\n' ' ' <<<"$INST") modules: ${MODS:-none}"
if [ "$INST" = "counterparts@counterparts $NEW" ] && [ -z "$MODS" ]; then
  ok "4. updated: counterparts is memory alone, and the sidebar is gone until it is installed"
else
  no "4. after update: $INST / modules: ${MODS:-none}"
fi
claude plugin install counterparts-sidebar@counterparts >"$LOGS/install-sidebar.txt" 2>&1
start after-sidebar
MODS=$(modules_loaded "$LOGS/after-sidebar.log")
say "then /plugin install counterparts-sidebar@counterparts: $(installed | tr '\n' ' ') modules: ${MODS:-none}"
[ "$MODS" = "counterparts-sidebar@counterparts" ] && ok "4. installing the sidebar brings the pane back, once" || no "4. modules: ${MODS:-none}"

echo
echo "4b. the same install, the marketplace updated, and the sidebar installed WITHOUT updating counterparts first"
before_split s4b
market new
claude plugin marketplace update counterparts >"$LOGS/mkt-update.txt" 2>&1
claude plugin install counterparts-sidebar@counterparts >"$LOGS/install-sidebar.txt" 2>&1
say "\$ claude plugin install counterparts-sidebar@counterparts" && sed 's/^/        /' "$LOGS/install-sidebar.txt" | head -4
start after
MODS=$(modules_loaded "$LOGS/after.log")
say "installed: $(installed | tr '\n' ' ') modules: $(tr '\n' ' ' <<<"${MODS:-none}")"
if grep -q "does not satisfy: >=$FLOOR" "$LOGS/install-sidebar.txt" && [ "$MODS" = "counterparts@counterparts" ]; then
  ok "4b. refused, naming the update to run; the old counterparts keeps its one pane"
else
  no "4b. expected a refusal and the old pane alone (modules: ${MODS:-none})" "$(cat "$LOGS/install-sidebar.txt")"
fi
claude plugin update counterparts@counterparts >"$LOGS/update.txt" 2>&1
say "\$ claude plugin update counterparts@counterparts" && sed 's/^/        /' "$LOGS/update.txt" | head -3
start after-update
MODS=$(modules_loaded "$LOGS/after-update.log")
say "installed: $(installed | tr '\n' ' ') modules: $(tr '\n' ' ' <<<"${MODS:-none}")"
[ "$MODS" = "counterparts-sidebar@counterparts" ] && ok "4b. after that update: the sidebar plugin's pane, once" || no "4b. modules after the update: ${MODS:-none}"

echo
echo "4c. for the record: as 4b, with a bare dependency (no version range)"
before_split s4c
market bare
claude plugin marketplace update counterparts >"$LOGS/mkt-update.txt" 2>&1
claude plugin install counterparts-sidebar@counterparts >"$LOGS/install-sidebar.txt" 2>&1
say "\$ claude plugin install counterparts-sidebar@counterparts" && sed 's/^/        /' "$LOGS/install-sidebar.txt" | head -4
start after
say "installed: $(installed | tr '\n' ' ') modules: $(modules_loaded "$LOGS/after.log" | tr '\n' ' ')"
say "(the old counterparts meets a bare dependency, and both draw a pane: why the range)"

echo
echo "5. a fresh HOME installs the sidebar while core's repository has release tags only (no counterparts--v$NEW)"
fresh_home s5
market plain
claude plugin marketplace add "$MKT" >"$LOGS/add.txt" 2>&1
claude plugin install counterparts-sidebar@counterparts >"$LOGS/install.txt" 2>&1
say "\$ claude plugin install counterparts-sidebar@counterparts" && sed 's/^/        /' "$LOGS/install.txt" | head -3
if grep -q "has no git tag satisfying" "$LOGS/install.txt" && [ -z "$(installed)" ]; then
  ok "5. refused, installing nothing: a release must push counterparts--v<version> to core's repository"
else
  no "5. expected the missing-tag refusal" "$(cat "$LOGS/install.txt")"
fi

echo
echo "$PASS passed, $FAIL failed. Logs: $WORK"
[ "$FAIL" -eq 0 ]
