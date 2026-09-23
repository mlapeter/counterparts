#!/usr/bin/env bash
#
# The clean-room install loop.
#
# It installs Counterparts the way a stranger would — from the packed tarball,
# into a HOME that has never seen this project, with no repo checkout on its
# PATH — and then exercises the three things an install has to produce: the
# owner's console, a wake block out of the SessionStart hook, and a note ->
# recall round trip through the MCP server over stdio JSON-RPC.
#
# Two rules it enforces on itself, in this order, before anything runs:
#
#   1. **It refuses to run in the real home.** `~/.counterparts` is somebody's
#      live memory. Every command below resolves its paths from `$HOME`, so a
#      loop that ran with the real `$HOME` would install over it. The guard is
#      first, it is unconditional, and there is no flag to skip it.
#   2. **It refuses a pre-set `COUNTERPARTS_DATA_DIR`.** cli CONTRACT §5 G3: no
#      tool honors an inherited data-directory variable when it claims a
#      throwaway directory. The store the loop asserts about is the store the
#      loop made, and both sides are resolved before they are compared.
#
# And one rule it enforces on the DOCS: the commands QUICKSTART shows a reader
# (install, version, scripted install, scope, connect, disconnect) must appear
# there verbatim. `doc_check` greps for the line before it is executed, so a doc
# edit that changes one of them fails the loop. The other steps run commands the
# guide does not show, and are checked for behaviour only.
#
# Usage:  tools/install-loop/run.sh [workdir]
# Default workdir: a fresh `install-loop-<pid>` under $TMPDIR.
#
# What this loop CANNOT verify: it never launches Claude Code, so the hooks block and the MCP registration are
# checked as files and processes, never as a live session.

set -uo pipefail

REAL_HOME="$HOME"
REAL_PATH="$PATH"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
QUICKSTART="$REPO/docs/QUICKSTART.md"

# ── the guard ───────────────────────────────────────────────────────────────

WORK="${1:-${TMPDIR:-/tmp}/install-loop-$$}"
WORK="${WORK%/}"

if [ -z "${REAL_HOME:-}" ]; then
  echo "REFUSED: \$HOME is unset; the guard cannot tell the real home from a temp one."
  exit 1
fi
# BEFORE `mkdir`, on the path as GIVEN: a guard that creates the directory it is
# about to refuse has already written into somebody's home. Checked again below
# on the resolved path, because this first test cannot see through a symlink.
case "$WORK/" in
  "$REAL_HOME"/*)
    echo "REFUSED: the workdir ($WORK) is inside the real home ($REAL_HOME)."
    echo "The loop writes a whole HOME; it may not write one inside yours."
    exit 1
    ;;
esac
mkdir -p "$WORK" || { echo "cannot create $WORK"; exit 1; }
WORK="$(cd "$WORK" && pwd -P)"
# And again, resolved: scar §2.13 — a path guard resolves both sides before it
# compares, so a symlink into the home is caught too.
case "$WORK/" in
  "$REAL_HOME"/*)
    echo "REFUSED: the workdir resolves to $WORK, inside the real home ($REAL_HOME)."
    exit 1
    ;;
esac
if [ -n "${COUNTERPARTS_DATA_DIR:-}" ]; then
  echo "REFUSED: COUNTERPARTS_DATA_DIR is already set ($COUNTERPARTS_DATA_DIR)."
  echo "A tool that claims a throwaway directory never honors an inherited one (cli §5 G3)."
  exit 1
fi
if [ -n "${COUNTERPARTS_CONFIG:-}" ]; then
  # Same rule, same reason, one level along: this variable names the file that
  # says where the store is and whose keys to use. A clean room that inherited
  # one would be testing somebody else's install.
  echo "REFUSED: COUNTERPARTS_CONFIG is already set ($COUNTERPARTS_CONFIG)."
  echo "The loop resolves its own configuration; it never honors an inherited one."
  exit 1
fi
# UNSET, not refused, and not armed: `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` makes
# the store and the config resolver refuse their `~/.counterparts` defaults
# (`store/paths.ts`, `adapters/config-path.ts#implicitConfigRefusal`). It is
# exported in every agent shell of this repo, so the loop inherits it — and
# inside the clean room it would fight the loop's own design: the stranger's
# path IS the defaults (`counterparts install` with no `--config`, the hook
# with no flag, `rebrief` falling back to the hooks' config), resolved in a HOME
# that the guards above have already made throwaway. A stranger has no such
# variable; the loop measures a stranger. One step below arms it on purpose,
# to prove the installed console and hook carry the refusal.
unset COUNTERPARTS_REQUIRE_EXPLICIT_DIR

FAKE_HOME="$WORK/home"
rm -rf "$FAKE_HOME"
mkdir -p "$FAKE_HOME"
FAKE_HOME="$(cd "$FAKE_HOME" && pwd -P)"

export HOME="$FAKE_HOME"
if [ "$HOME" = "$REAL_HOME" ]; then
  echo "REFUSED: HOME did not change."
  exit 1
fi

# bun is the runtime a reader is told to install; here it comes from the real
# home, because this machine has one bun. Its BINARY is borrowed; its HOME is
# not — `BUN_INSTALL` puts every installed package under the temp home, so the
# global install cannot reach the real one.
BUN_BIN="$(command -v bun || echo "$REAL_HOME/.bun/bin/bun")"
if [ ! -x "$BUN_BIN" ]; then
  echo "REFUSED: no bun executable found."
  exit 1
fi
# npm is used for ONE thing — packing the tarball — which is the maintainer's
# step, not the reader's. It is resolved now, from the real PATH, because the
# clean room's PATH deliberately has no package manager on it.
NPM_BIN="$(command -v npm || true)"
if [ ! -x "${NPM_BIN:-}" ]; then
  echo "REFUSED: no npm executable found; the loop packs the tarball with it."
  exit 1
fi

export BUN_INSTALL="$HOME/.bun"
# A PATH with no repo on it and no user bin dir: bun's own directory, the temp
# install's bin, and the system.
export PATH="$BUN_INSTALL/bin:$(dirname "$BUN_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"

STORE="$HOME/.counterparts/store"
BASE="$HOME/.counterparts"
SESSION="install-loop-$$"
mkdir -p "$HOME/project"

echo "clean room"
echo "  HOME         $HOME"
echo "  BUN_INSTALL  $BUN_INSTALL"
echo "  PATH         $PATH"
echo "  bun          $("$BUN_BIN" --version)"
echo "  repo         $REPO (packed only; never on PATH)"
echo

# ── plumbing ────────────────────────────────────────────────────────────────

PASS=0
FAIL=0
STEP=0
CURRENT=""
STEP_T0=0

# Milliseconds. macOS `date` has no %N, so this falls back to perl and then to
# whole seconds rather than printing a wrong number.
now_ms() {
  local n
  n=$(date +%s%3N 2>/dev/null)
  case "$n" in
    *[!0-9]*|"") ;;
    *) echo "$n"; return ;;
  esac
  if command -v perl >/dev/null 2>&1; then
    perl -MTime::HiRes -e 'printf("%d", Time::HiRes::time()*1000)' && return
  fi
  echo $(( $(date +%s) * 1000 ))
}

step() {
  STEP=$((STEP + 1))
  CURRENT="$1"
  STEP_T0=$(now_ms)
}

ok() {
  PASS=$((PASS + 1))
  printf 'PASS  %-54s %6s ms\n' "$STEP. $CURRENT" "$(( $(now_ms) - STEP_T0 ))"
}

no() { # no <why> [output]
  FAIL=$((FAIL + 1))
  printf 'FAIL  %-54s %6s ms\n' "$STEP. $CURRENT" "$(( $(now_ms) - STEP_T0 ))"
  printf '      %s\n' "$1"
  if [ -n "${2:-}" ]; then
    printf '      --- output ---\n'
    printf '%s\n' "$2" | sed 's/^/      /'
  fi
}

# Lockstep. A command QUICKSTART shows is checked against it before it is
# executed; if the doc no longer contains it verbatim, the step fails.
doc_check() {
  grep -qF -- "$1" "$QUICKSTART"
}

# A realistic hook payload: the four fields `bin/hook.ts#toHookInput` reads.
payload() { # payload <event> [session id]
  printf '{"hook_event_name":"%s","session_id":"%s","cwd":"%s","transcript_path":"%s"}' \
    "$1" "${2:-$SESSION}" "$HOME/project" "$HOME/project/transcript.jsonl"
}

T0=$(date +%s)

# ── 1. install from the packed tarball ──────────────────────────────────────

step "npm pack produces a tarball"
# STDERR GOES TO A FILE, NOT INTO THE PIPE (2026-09-20, finding 5). `npm pack`
# prints the tarball name on stdout and its notices — npm's update banner, a
# workspace warning, an audit line — on stderr. With `2>&1` the two are
# interleaved, so `tail -1` returned whatever npm said last and the step failed
# about one run in five with a name that was never a file.
PACK_ERR="$WORK/npm-pack.stderr"
PACK_OUT=$(cd "$REPO" && PATH="$REAL_PATH" "$NPM_BIN" pack --pack-destination "$WORK" 2>"$PACK_ERR")
TARBALL=$(printf '%s\n' "$PACK_OUT" | tail -1)
if [ -f "$WORK/$TARBALL" ]; then
  ok
else
  no "npm pack produced no tarball" "$(printf 'stdout:\n%s\nstderr:\n%s\n' "$PACK_OUT" "$(cat "$PACK_ERR" 2>/dev/null)")"
fi

step "the tarball ships sources and licence, and no tests or internal tools"
LISTING=$(tar -tzf "$WORK/$TARBALL" 2>&1)
STOWAWAYS=$(printf '%s\n' "$LISTING" | grep -E '^package/(test|docs/harvest|\.claude|tools/(parallel|migrate|replay|demo|audit|recall-bench))/' || true)
if printf '%s\n' "$LISTING" | grep -q '^package/LICENSE$' &&
   printf '%s\n' "$LISTING" | grep -q '^package/src/adapters/cli/bin/counterparts.ts$' &&
   printf '%s\n' "$LISTING" | grep -q '^package/docs/QUICKSTART.md$' &&
   [ -z "$STOWAWAYS" ]; then
  ok
else
  no "tarball contents are wrong (stowaways: ${STOWAWAYS:-none})" "$LISTING"
fi

step "every relative file the shipped docs link to is IN the tarball"
# A README that points at five files the package does not contain is a package
# whose own evidence is unauditable by its reader (cold-stranger review, §6.6).
mkdir -p "$WORK/unpacked"
tar -xzf "$WORK/$TARBALL" -C "$WORK/unpacked"
DEAD=""
for doc in README.md docs/QUICKSTART.md; do
  # Links to an ABSOLUTE url are deliberate pointers at the repository and are
  # struck out first, label and all — otherwise the backticked path inside the
  # label reads as a broken relative reference.
  BODY=$(sed -E 's/\[[^]]*\]\(https?:[^)]*\)//g' "$REPO/$doc")
  # What is left: markdown links to a repo path, and backticked repo paths.
  for ref in $(printf '%s\n' "$BODY" |
      grep -oE '\]\((docs|tools|src)/[A-Za-z0-9._/-]+\)|`(docs|tools|src)/[A-Za-z0-9._/-]+\.(md|sh|ts)`' |
      sed -E 's/^\]\(//; s/\)$//; s/^`//; s/`$//'); do
    [ -e "$WORK/unpacked/package/$ref" ] || DEAD="$DEAD $doc->$ref"
  done
done
if [ -z "$DEAD" ]; then ok; else no "shipped docs link to files not in the package:$DEAD"; fi

step "bun installs the tarball globally into the clean HOME"
mkdir -p "$WORK/pkg"
# The REAL filename npm produced, not a convenient rename: the docs tell the
# reader to install `counterparts-*.tgz`, and so does this.
cp "$WORK/$TARBALL" "$WORK/pkg/$TARBALL"
cd "$WORK/pkg" || exit 1
CMD='bun add -g "$PWD"/counterparts-*.tgz'
if ! doc_check "$CMD"; then
  no "not in QUICKSTART verbatim: $CMD"
else
  OUT=$(eval "$CMD" 2>&1)
  if [ -x "$BUN_INSTALL/bin/counterparts" ]; then ok; else no "no counterparts executable after install" "$OUT"; fi
fi

step "the four executables are on PATH, and are the installed ones"
MISSING=""
for b in counterparts counterparts-hook counterparts-mcp counterparts-dashboard; do
  p=$(command -v "$b" 2>/dev/null)
  case "$p" in
    "$BUN_INSTALL"/bin/*) ;;
    *) MISSING="$MISSING $b(${p:-absent})" ;;
  esac
done
if [ -z "$MISSING" ]; then ok; else no "not installed, or resolved elsewhere:$MISSING"; fi

step "the installed CLI says which version it is, and EXITS 0"
CMD='counterparts --version'
if ! doc_check "$CMD"; then
  no "not in QUICKSTART verbatim: $CMD"
else
  OUT=$(eval "$CMD" 2>&1)
  CODE=$?
  # THE FIRST COMMAND A STRANGER RUNS, and it was `--help` until 2026-09-22:
  # a wall of text as the answer to "did that install work?" (findings #17,
  # #23). This one answers it in four words, opens no store and reads no
  # configuration. Exit 1 here kills any `set -e` wrapper.
  if [ "$CODE" = "0" ] && printf '%s' "$OUT" | grep -qE '^counterparts [0-9]+\.[0-9]+'; then
    ok
  else
    no "expected 'counterparts <version>' and exit 0, got exit $CODE" "$OUT"
  fi
fi

# ── 2. the install command ──────────────────────────────────────────────────

step "counterparts install writes the store, the config and the credentials"
# Verbatim, placeholder included: what the loop runs is the line the docs print,
# down to the name a reader is told to replace.
CMD='counterparts install --budget 9000 --name "Your Name"'
INSTALL_OUT=""
if ! doc_check "$CMD"; then
  no "not in QUICKSTART verbatim: $CMD"
else
  INSTALL_OUT=$(eval "$CMD" 2>&1)
  if [ -f "$STORE/counterparts.sqlite" ] && [ -f "$BASE/claude-code.json" ] && [ -f "$BASE/credentials.env" ]; then
    ok
  else
    no "install did not produce store + config + credentials" "$INSTALL_OUT"
  fi
fi

step "the data dir it made is inside the clean room"
RESOLVED=$(cd "$STORE" 2>/dev/null && pwd -P)
case "${RESOLVED:-/nowhere}/" in
  "$WORK"/*) ok ;;
  *) no "the store resolved to ${RESOLVED:-nothing}, which is outside $WORK" ;;
esac

step "the config sits BESIDE the store, and the store still opens"
if [ -f "$STORE/claude-code.json" ]; then
  no "the config landed INSIDE the data dir; the layout check refuses that at open"
else
  OUT=$(counterparts status --dir "$STORE" 2>&1)
  if printf '%s' "$OUT" | grep -q "^Memories: "; then ok; else no "status could not open the store" "$OUT"; fi
fi

step "the credentials file is 0600"
MODE=$(stat -f '%OLp' "$BASE/credentials.env" 2>/dev/null || stat -c '%a' "$BASE/credentials.env" 2>/dev/null)
if [ "$MODE" = "600" ]; then ok; else no "credentials.env is mode ${MODE:-unknown}, not 600"; fi

step "install PRINTED the host's two steps and wrote no host file"
if printf '%s' "$INSTALL_OUT" | grep -q 'claude mcp add counterparts' &&
   printf '%s' "$INSTALL_OUT" | grep -q 'bin/hook.ts' &&
   [ ! -e "$HOME/.claude/settings.json" ] && [ ! -e "$HOME/.claude.json" ]; then
  ok
else
  no "either the blocks were not printed, or a host file was written" "$INSTALL_OUT"
fi

step "the printed hook command runs on a PATH with no bun on it"
# The failure this catches is the one the rest of the loop is blind to: the loop
# deliberately puts bun on PATH, and a real host does not. The printed command is
# lifted out of install's own output and run with a system-only PATH — if it
# names a bare `counterparts-hook`, this is "command not found" and no memory.
HOOK_CMD=$(printf '%s\n' "$INSTALL_OUT" | sed -n 's/.*"command": "\(.*\)".*/\1/p' | head -1 | sed 's/\\"/"/g')
if [ -z "$HOOK_CMD" ]; then
  no "no hook command found in install's output" "$INSTALL_OUT"
else
  OUT=$(payload SessionStart "bunless-$$" | env -i HOME="$HOME" PATH="/usr/bin:/bin" sh -c "$HOOK_CMD" 2>"$WORK/bunless.err")
  CODE=$?
  if [ "$CODE" = "0" ] && printf '%s' "$OUT" | grep -q "has not lived a boundary"; then
    ok
  else
    no "the printed hook command failed without bun on PATH (exit $CODE): $HOOK_CMD" "$OUT
$(cat "$WORK/bunless.err")"
  fi
fi

step "counterparts status runs read-only against the fresh store"
CMD='counterparts status --dir "$HOME/.counterparts/store"'
if true; then
  BEFORE=$(find "$STORE" -type f | sort | wc -l)
  OUT=$(eval "$CMD" 2>&1)
  AFTER=$(find "$STORE" -type f | sort | wc -l)
  if printf '%s' "$OUT" | grep -q "^Memories: " && [ "$BEFORE" = "$AFTER" ]; then ok; else no "status failed or was not a pure read" "$OUT"; fi
fi

# ── 3. the product, from the console ────────────────────────────────────────

# THE STRANGER'S REAL FIRST ACT, and the one the loop was blind to until round 2:
# a store with exactly one memory in it, asked for that memory. It failed for a
# day — `considered: 0` at store size one, because rarity was exactly zero when
# every memory in the store held the term — and it is a permanent step now, not
# a regression test filed away, because a bug at n=1 is invisible to every check
# that seeds two rows.
FIRSTSTORE="$WORK/first-memory-store"
step "the ONLY memory in a fresh store is recallable by question"
counterparts init --dir "$FIRSTSTORE" >/dev/null 2>&1
OUT=$(counterparts note "The espresso machine in the kitchen is a Rancilio Silvia." --dir "$FIRSTSTORE" 2>&1)
if ! printf '%s' "$OUT" | grep -q "Remembered mem_"; then
  no "the note itself failed" "$OUT"
else
  OUT=$(counterparts recall "what espresso machine is in the kitchen?" --dir "$FIRSTSTORE" 2>&1)
  if printf '%s' "$OUT" | grep -q "Rancilio Silvia"; then
    ok
  else
    no "the store's only memory did not come back (storeSize==1 regression)" "$OUT"
  fi
fi

step "a mistyped --dir is REFUSED, and the note does not land somewhere else"
# The critical finding of 2026-09-04, as a step. `note "…" --dirr <store2>` used
# to print `Remembered mem_… — minted.` while store2 stayed empty and the DEFAULT
# store took the words — which on a real machine is the owner's live memory. The
# assertion is in three parts: the command refuses, it names the flag, and NO
# store anywhere grew a memory.
BEFORE_DEFAULT=$(counterparts status --dir "$STORE" 2>/dev/null | sed -n 's/^Memories: \([0-9]*\).*/\1/p' | head -1)
OUT=$(counterparts note "This must not land anywhere." --dirr "$FIRSTSTORE" 2>&1)
CODE=$?
AFTER_DEFAULT=$(counterparts status --dir "$STORE" 2>/dev/null | sed -n 's/^Memories: \([0-9]*\).*/\1/p' | head -1)
if [ "$CODE" = "2" ] &&
   printf '%s' "$OUT" | grep -q "unknown flag --dirr" &&
   printf '%s' "$OUT" | grep -q "did you mean --dir?" &&
   [ "$BEFORE_DEFAULT" = "$AFTER_DEFAULT" ]; then
  ok
else
  no "a mistyped --dir was not refused, or something was written (exit $CODE, live $BEFORE_DEFAULT -> $AFTER_DEFAULT)" "$OUT"
fi

step "COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 refuses an UNNAMED store and an UNNAMED config"
# LAUNCH-STATUS I21, through the installed binaries rather than the source: an
# agent's shell on a machine with an install exports this, and a command that
# names no store must then refuse by name — before any open — rather than reach
# `$HOME/.counterparts/store`. Three parts: the console refuses and names the
# guard and the remedy; the hook stands down for the same reason (the default
# config NAMES a store); and neither wrote a thing — the sessions count is the
# tripwire. The loop's own environment stays unarmed (see the guard block).
BEFORE_SESSIONS=$(ls "$STORE/sessions" 2>/dev/null | wc -l | tr -d ' ')
OUT=$(COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 counterparts status 2>&1)
CODE=$?
HOOK_OUT=$(payload SessionStart "install-loop-guard-$$" | COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 counterparts-hook 2>"$WORK/hook-guard.err")
HOOK_CODE=$?
AFTER_SESSIONS=$(ls "$STORE/sessions" 2>/dev/null | wc -l | tr -d ' ')
if [ "$CODE" = "2" ] &&
   printf '%s' "$OUT" | grep -q "COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1" &&
   printf '%s' "$OUT" | grep -q "$STORE" &&
   printf '%s' "$OUT" | grep -q -- "--dir" &&
   [ "$HOOK_CODE" = "0" ] && [ -z "$HOOK_OUT" ] &&
   grep -q "stood down" "$WORK/hook-guard.err" &&
   grep -q "COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1" "$WORK/hook-guard.err" &&
   [ "$BEFORE_SESSIONS" = "$AFTER_SESSIONS" ]; then
  ok
else
  no "the guard did not refuse the unnamed default (console exit $CODE, hook exit $HOOK_CODE, sessions $BEFORE_SESSIONS -> $AFTER_SESSIONS)" "$OUT
$HOOK_OUT
$(cat "$WORK/hook-guard.err")"
fi

step "note and recall NAME the store they wrote to or read from"
OUT=$(counterparts note "A memory that says where it went." --dir "$FIRSTSTORE" 2>&1)
OUT2=$(counterparts recall "where did it go?" --dir "$FIRSTSTORE" 2>&1)
if printf '%s\n' "$OUT" | head -1 | grep -q "^Store: $FIRSTSTORE$" &&
   printf '%s\n' "$OUT2" | head -1 | grep -q "^Store: $FIRSTSTORE$"; then
  ok
else
  no "the destination was not the first line" "note: $OUT
recall: $OUT2"
fi

step "the note-and-ask demo DISCRIMINATES: two notes, one question, the right memory"
# The one-row case (step 14) proves the store answers. It cannot prove RECALL,
# because a store with one row returns that row to any question at all — the
# cold-stranger review asked a one-row store about Mars and got the espresso
# machine. So this demo is two notes and a question only one of them answers,
# and this step asserts the OTHER note stayed out of the result.
NOTE_A='counterparts note "The espresso machine in the kitchen is a Rancilio Silvia."'
NOTE_B='counterparts note "Postgres in dev listens on port 5433, not 5432."'
RECALL_CMD='counterparts ask "which port does postgres use in dev?"'
if true; then
  eval 'export COUNTERPARTS_DATA_DIR="$HOME/.counterparts/store"'
  OUT=$(eval "$NOTE_A" 2>&1; eval "$NOTE_B" 2>&1)
  RECALL_OUT=$(eval "$RECALL_CMD" 2>&1)
  unset COUNTERPARTS_DATA_DIR
  if printf '%s' "$RECALL_OUT" | grep -q "port 5433" &&
     ! printf '%s' "$RECALL_OUT" | grep -q "Rancilio Silvia" &&
     printf '%s' "$RECALL_OUT" | grep -q "semantic embedder-off"; then
    ok
  else
    no "recall did not pick the one memory that answers the question" "notes: $OUT
recall: $RECALL_OUT"
  fi
fi

step "an answer names the TIER it came back at"
# `answered` says the question reached something, never that it is right. The
# tier is the only confidence signal there is, so it is glossed on screen.
if printf '%s' "$RECALL_OUT" | grep -qE '^  (vivid|quiet|dim) = '; then
  ok
else
  no "no tier gloss under the results" "$RECALL_OUT"
fi

step "a recall that finds nothing SAYS so, in a sentence"
OUT=$(counterparts recall "xylophone quokka semaphore" --dir "$FIRSTSTORE" 2>&1)
if printf '%s' "$OUT" | grep -q "NOTHING CAME BACK"; then ok; else no "an empty recall did not announce itself" "$OUT"; fi

step "the removal plan NAMES the span buffer, and says it will be chased"
# §I2's surface, in the clean room. The dry run is all a non-interactive console
# can reach — `remove --confirm` refuses without a prompt, which the next step
# asserts — but the dry run is where the disclosure lives.
SPAN_COUNT="chase spans: 1"
SPAN_TAIL="the removal strikes them out of it."
SPAN_LINE="the raw capture buffer holds this"
OUT=$(counterparts note "A note whose words ride the capture buffer before they are minted." --dir "$FIRSTSTORE" 2>&1)
DOOMED=$(printf '%s\n' "$OUT" | grep -o 'mem_[0-9a-f]*' | head -1)
if [ -z "$DOOMED" ]; then
  no "the note printed no id to remove" "$OUT"
else
  PLAN=$(counterparts remove "$DOOMED" --dir "$FIRSTSTORE" 2>&1)
  if printf '%s' "$PLAN" | grep -qF "$SPAN_COUNT" &&
     printf '%s' "$PLAN" | grep -qF "chased — spans/" &&
     printf '%s' "$PLAN" | grep -qF "$SPAN_LINE" &&
     printf '%s' "$PLAN" | grep -qF "$SPAN_TAIL" &&
     printf '%s' "$PLAN" | grep -q "Dry run. Nothing has changed."; then
    ok
  else
    no "the plan did not name the buffer as a chased surface" "$PLAN"
  fi
fi

step "remove --confirm REFUSES without an interactive prompt, and nothing moves"
# Its OWN note and its own id: a step that borrows the previous step's variable
# reports a false pass when that step failed before setting it.
OUT=$(counterparts note "A second note, taken so this step owns the id it removes." --dir "$FIRSTSTORE" 2>&1)
TARGET=$(printf '%s\n' "$OUT" | grep -o 'mem_[0-9a-f]*' | head -1)
if [ -z "$TARGET" ]; then
  no "the note printed no id to remove" "$OUT"
else
  BEFORE=$(counterparts status --dir "$FIRSTSTORE" 2>&1)
  OUT=$(counterparts remove "$TARGET" --confirm --dir "$FIRSTSTORE" 2>&1)
  RC=$?
  AFTER=$(counterparts status --dir "$FIRSTSTORE" 2>&1)
  if [ "$RC" -ne 0 ] &&
     printf '%s' "$OUT" | grep -q "interactive confirmation" &&
     [ "$BEFORE" = "$AFTER" ]; then
    ok
  else
    no "a non-interactive --confirm did not refuse cleanly (rc=$RC)" "$OUT"
  fi
fi

step "the plan says WHAT it matched by, and refuses a content chase it cannot scope"
# The two disclosures the adversarial review made blocking: the plan names the
# evidence it is acting on, and a memory with no recorded scope is NOT chased by
# content across every project on the machine.
MATCHED_BY="matched by the span hash its mint recorded"
REFUSAL="would have to visit EVERY project on this machine"
if [ -z "$DOOMED" ]; then
  no "no id from the earlier note"
else
  PLAN=$(counterparts remove "$DOOMED" --dir "$FIRSTSTORE" 2>&1)
  if printf '%s' "$PLAN" | grep -qF "$MATCHED_BY"; then ok; else no "the plan did not say what it matched by" "$PLAN"; fi
fi

# ── 4. the SessionStart hook ────────────────────────────────────────────────

step "SessionStart returns the honest bootstrap line on a store that never woke"
OUT=$(payload SessionStart | counterparts-hook 2>"$WORK/hook.err")
HOOK_CODE=$?
if [ "$HOOK_CODE" = "0" ] && printf '%s' "$OUT" | grep -q "has not lived a boundary"; then
  ok
else
  no "expected the bootstrap line and exit 0 (got exit $HOOK_CODE)" "$OUT
$(cat "$WORK/hook.err")"
fi

step "the hook registered the session under <dataDir>/sessions/"
if [ -f "$STORE/sessions/$SESSION.json" ]; then ok; else no "no session record at $STORE/sessions/$SESSION.json"; fi

# THE STEP NOBODY COULD RUN BEFORE. Until the one-config rule (2026-09-05) the
# hook read `$HOME/.counterparts/claude-code.json` and took no flag, so the only
# way to drive it at another store was to move a whole HOME — which is what this
# loop does and what a machine with an existing install cannot. With `--config`
# the hook is redirectable like every other entry point, and the assertion is in
# three parts: it worked on the named store, it RECORDED which file sent it
# there, and the clean room's own default store never heard of the session.
SECOND_BASE="$WORK/second-install"
SECOND_STORE="$SECOND_BASE/store"
SECOND_CONFIG="$SECOND_BASE/claude-code.json"
SECOND_SESSION="install-loop-second-$$"
mkdir -p "$SECOND_BASE"
printf '{\n  "dataDir": "%s",\n  "injectionBudgetBytes": 9000\n}\n' "$SECOND_STORE" > "$SECOND_CONFIG"

step "counterparts-hook --config drives the hook at a SECOND store"
OUT=$(payload SessionStart "$SECOND_SESSION" | counterparts-hook --config "$SECOND_CONFIG" 2>"$WORK/hook-config.err")
CODE=$?
if [ "$CODE" != "0" ] || ! printf '%s' "$OUT" | grep -q "has not lived a boundary"; then
  no "the hook did not run against the named config (exit $CODE)" "$OUT
$(cat "$WORK/hook-config.err")"
elif [ ! -f "$SECOND_STORE/sessions/$SECOND_SESSION.json" ]; then
  no "no session record under the named store at $SECOND_STORE/sessions/$SECOND_SESSION.json"
elif ! grep -q "$SECOND_CONFIG" "$SECOND_STORE/sessions/$SECOND_SESSION.json"; then
  # A hook cannot print to the owner — its stdout is the model's context — so
  # the durable answer to "which config was that?" is this field.
  no "the session record does not name the config it read" "$(cat "$SECOND_STORE/sessions/$SECOND_SESSION.json")"
elif [ -f "$STORE/sessions/$SECOND_SESSION.json" ]; then
  no "the DEFAULT store also got a record for that session — the flag did not redirect"
else
  ok
fi

step "an absolute --config that is NOT THERE stands the hook down too"
# The hole the PR's own review found: an absolute path to a file that does not
# exist was honoured silently — read as an absent config, resolved to observer,
# and then fallen through to the default data dir, which on a machine with an
# install is the live store. A typo in the one flag that says WHICH MEMORY has
# to be as loud as a typo in --dir already is.
BEFORE_SESSIONS=$(ls "$STORE/sessions" 2>/dev/null | wc -l | tr -d ' ')
OUT=$(payload SessionStart "install-loop-missing-$$" | counterparts-hook --config "$WORK/nowhere/claude-code.json" 2>"$WORK/hook-missing.err")
CODE=$?
AFTER_SESSIONS=$(ls "$STORE/sessions" 2>/dev/null | wc -l | tr -d ' ')
# STDOUT CARRIES A NOTICE AND NO CONTEXT, since H1 (`30a9b91`, 2026-09-18): a
# stand-down that is a FAULT says so where the owner will see it. This step used
# to demand an empty stdout and has been failing ever since; the property it
# guards is unchanged and one clause stronger — nothing is injected, and the
# terminal is told why. `additionalContext` is what must not be there.
if [ "$CODE" = "0" ] &&
   ! printf '%s' "$OUT" | grep -q "additionalContext" &&
   printf '%s' "$OUT" | grep -q "memory is OFF for this session" &&
   grep -q "stood down" "$WORK/hook-missing.err" &&
   grep -q "could not be read" "$WORK/hook-missing.err" &&
   [ ! -e "$WORK/nowhere" ] &&
   [ "$BEFORE_SESSIONS" = "$AFTER_SESSIONS" ]; then
  ok
else
  no "a missing --config was not a clean stand-down (exit $CODE, sessions $BEFORE_SESSIONS -> $AFTER_SESSIONS)" "$OUT
$(cat "$WORK/hook-missing.err")"
fi

step "a relative --config STANDS THE HOOK DOWN rather than using the default store"
# The failure direction that matters: an entry point told to use a config it
# cannot honour must not quietly fall back, because on a real machine the
# default is somebody's live memory. Exit 0 all the same — a hook never fails
# the host — and nothing INJECTED, which since H1 is the honest test rather
# than an empty stdout (see the step above).
BEFORE_SESSIONS=$(ls "$STORE/sessions" 2>/dev/null | wc -l | tr -d ' ')
OUT=$(payload SessionStart "install-loop-relative-$$" | counterparts-hook --config claude-code.json 2>"$WORK/hook-relative.err")
CODE=$?
AFTER_SESSIONS=$(ls "$STORE/sessions" 2>/dev/null | wc -l | tr -d ' ')
if [ "$CODE" = "0" ] &&
   ! printf '%s' "$OUT" | grep -q "additionalContext" &&
   printf '%s' "$OUT" | grep -q "memory is OFF for this session" &&
   grep -q "stood down" "$WORK/hook-relative.err" &&
   [ "$BEFORE_SESSIONS" = "$AFTER_SESSIONS" ]; then
  ok
else
  no "a relative --config was not a clean stand-down (exit $CODE, sessions $BEFORE_SESSIONS -> $AFTER_SESSIONS)" "$OUT
$(cat "$WORK/hook-relative.err")"
fi

# THE DAY-0 WAKE. The finding (LAUNCH-STATUS round 2, self/NOTES §11): `install
# --name` seeds an identity core that no lane could reach — `scanActive` lists
# `{ type: "memory" }` and the core is a schema row — so the first composed wake
# was 385 bytes of furniture that named nobody, over a store whose one live row
# was the stranger's own name.
step "the first composed wake has an empty identity lane and zero elements"
OUT=$(counterparts rebrief --dir "$HOME/.counterparts/store" 2>&1)
if printf '%s' "$OUT" | grep -q "Re-rendered the wake bundle" &&
   printf '%s' "$OUT" | grep -q "identity 0" &&
   printf '%s' "$OUT" | grep -q "elements 0"; then
  ok
else
  no "the first rebrief declined, or ranked an identity element it should not have" "$OUT"
fi

step "SessionStart injects it, and an empty identity lane still names the core"
OUT=$(payload SessionStart | counterparts-hook 2>"$WORK/hook-day0.err")
if printf '%s' "$OUT" | grep -q "has not lived a boundary"; then
  no "still the bootstrap line after a rebrief" "$OUT"
elif printf '%s' "$OUT" | grep -q "Who I am:" &&
     printf '%s' "$OUT" | grep -q "This memory is for Your Name" &&
     printf '%s' "$OUT" | grep -q "identity=0"; then
  ok
else
  no "the wake did not name the core the install seeded" "$OUT
$(cat "$WORK/hook-day0.err")"
fi

# ── 5. the MCP round trip ───────────────────────────────────────────────────

CANARY="The install loop canary: the espresso machine in the kitchen is a Rancilio Silvia."

step "the MCP server handshakes over stdio JSON-RPC and declares its tools"
RPC=$(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
)
# `printf '%s\n'`, not `%s`: command substitution strips the trailing newline,
# and the server's framer holds an unterminated final line rather than parsing
# it — so a missing newline silently drops the last request.
MCP_OUT=$(printf '%s\n' "$RPC" | COUNTERPARTS_DATA_DIR="$STORE" counterparts-mcp 2>"$WORK/mcp.err")
if printf '%s' "$MCP_OUT" | grep -q '"serverInfo"' && printf '%s' "$MCP_OUT" | grep -q '"recall"'; then
  ok
else
  no "no handshake, or no tools declared" "$MCP_OUT
$(cat "$WORK/mcp.err")"
fi

step "note then recall round-trips through the MCP server"
# The canary is deliberately plain ASCII with no quotes or backslashes, so it
# needs no JSON escaping to be embedded here.
NOTE_PARAMS=$(printf '{"name":"note","arguments":{"text":"%s"}}' "$CANARY")
RECALL_PARAMS='{"name":"recall","arguments":{"question":"what espresso machine is in the kitchen?"}}'
RPC=$(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":%s}\n' "$NOTE_PARAMS"
  printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":%s}\n' "$RECALL_PARAMS"
)
MCP_OUT=$(printf '%s\n' "$RPC" | COUNTERPARTS_DATA_DIR="$STORE" counterparts-mcp 2>"$WORK/mcp2.err")
printf '%s' "$MCP_OUT" > "$WORK/mcp-roundtrip.jsonl"
NOTED=$(printf '%s\n' "$MCP_OUT" | grep '"id":2' || true)
RECALLED=$(printf '%s\n' "$MCP_OUT" | grep '"id":3' || true)
if printf '%s' "$NOTED" | grep -q '"isError":true'; then
  no "the note was refused" "$NOTED"
elif printf '%s' "$RECALLED" | grep -q 'Rancilio Silvia'; then
  ok
else
  no "recall did not return the note" "note:   $NOTED
recall: $RECALLED
$(cat "$WORK/mcp2.err")"
fi

step "recall says out loud that it ran without an embedder"
# The no-key mode is a documented mode, not a silent one: recall names it.
if printf '%s' "$RECALLED" | grep -q '"semantic":"embedder-off"'; then ok; else no "recall did not report the embedder as off" "$RECALLED"; fi

step "session_end binds LAZILY through the hooks' registry and writes the day"
# THE FIFTH HOST BEHAVIOUR, and the only one nobody had exercised outside the
# owner's machine. Claude Code launches MCP servers from a static configuration,
# so the server never receives `--session`; the hooks know the id and leave a
# record at <dataDir>/sessions/<id>.json, and the server binds to it on the first
# claim. Until now this loop asserted only that the RECORD exists — the thing the
# bind reads, not the bind — and the docs claimed more than that.
#
# Two things have to line up for a bind: the id must be live in the registry (the
# SessionStart step above wrote it), and the session's scope must match this
# server's. The hook recorded the payload's cwd, so the server is told the same
# scope rather than being run from that directory.
SESSION_END_PARAMS=$(printf '{"name":"session_end","arguments":{"session":"%s","memories":[{"content":"%s"}]}}' \
  "$SESSION" "The install loop proved the lazy session bind end to end.")
RPC=$(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":%s}\n' "$SESSION_END_PARAMS"
)
MCP_OUT=$(printf '%s\n' "$RPC" |
  COUNTERPARTS_DATA_DIR="$STORE" COUNTERPARTS_SCOPE="$HOME/project" counterparts-mcp 2>"$WORK/mcp3.err")
printf '%s' "$MCP_OUT" > "$WORK/mcp-session-end.jsonl"
ENDED=$(printf '%s\n' "$MCP_OUT" | grep '"id":2' || true)
# The refusals this step exists to catch, by name: a server that could not find
# the record says `session-unknown`; one in the wrong project says
# `scope-mismatch`; one that was never told an id says `session-required`.
if printf '%s' "$ENDED" | grep -qE 'session-unknown|scope-mismatch|session-required|session-not-live'; then
  no "the lazy bind refused — the registry record was not usable" "$ENDED
$(cat "$WORK/mcp3.err")"
elif printf '%s' "$ENDED" | grep -q '"stored":true'; then
  ok
else
  no "session_end did not report a deposit" "$ENDED
$(cat "$WORK/mcp3.err")"
fi

step "COUNTERPARTS_CONFIG points the MCP server at another install's config"
# The flag's equivalent for a host that launches from a STATIC registration —
# which is how this host launches MCP servers, so `-e COUNTERPARTS_CONFIG=…` in
# the `claude mcp add` line is the only channel there is. The server says which
# file it read on stderr (stdout is the JSON-RPC wire) and serves normally.
RPC=$(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
)
MCP_OUT=$(printf '%s\n' "$RPC" |
  COUNTERPARTS_DATA_DIR="$SECOND_STORE" COUNTERPARTS_CONFIG="$SECOND_CONFIG" counterparts-mcp 2>"$WORK/mcp-config.err")
if printf '%s' "$MCP_OUT" | grep -q '"serverInfo"' &&
   grep -q "config: $SECOND_CONFIG (named by COUNTERPARTS_CONFIG)" "$WORK/mcp-config.err"; then
  ok
else
  no "the server did not start on the named config, or did not name it" "$MCP_OUT
$(cat "$WORK/mcp-config.err")"
fi

step "a relative COUNTERPARTS_CONFIG REFUSES the server rather than falling back"
OUT=$(printf '%s\n' "$RPC" |
  COUNTERPARTS_DATA_DIR="$SECOND_STORE" COUNTERPARTS_CONFIG=claude-code.json counterparts-mcp 2>"$WORK/mcp-relative.err")
CODE=$?
if [ "$CODE" != "0" ] && grep -q "ABSOLUTE" "$WORK/mcp-relative.err" && [ -z "$OUT" ]; then
  ok
else
  no "a relative COUNTERPARTS_CONFIG did not refuse the launch (exit $CODE)" "$OUT
$(cat "$WORK/mcp-relative.err")"
fi

step "the note is durable: the console counts it after both processes exited"
OUT=$(counterparts status --dir "$STORE" 2>&1)
LIVE=$(printf '%s\n' "$OUT" | sed -n 's/^Memories: \([0-9]*\).*/\1/p' | head -1)
# The four populations are on ONE line now, each labelled, because adding them
# together and calling the total "memories" is how three surfaces came to report
# three different sizes (round 8). `Memories:` is the number the wake states.
if [ -n "$LIVE" ] && [ "$LIVE" -ge 1 ] 2>/dev/null &&
   printf '%s' "$OUT" | grep -q 'Journal: ' &&
   printf '%s' "$OUT" | grep -q 'Beliefs and entities: '; then
  ok
else
  no "expected at least one memory and the labelled census, read '${LIVE:-nothing}'" "$OUT"
fi

# ── 6. the wake carries something ───────────────────────────────────────────

step "counterparts rebrief renders a wake bundle from the store"
CMD='counterparts rebrief --dir "$HOME/.counterparts/store"'
if true; then
  OUT=$(eval "$CMD" 2>&1)
  # It must NAME the file the ceiling came from. On the default layout that is
  # the config beside the store — the same file the hooks read.
  if printf '%s' "$OUT" | grep -q "Re-rendered the wake bundle" &&
     printf '%s' "$OUT" | grep -q "budget 9000 bytes from $BASE/claude-code.json"; then
    ok
  else
    no "rebrief declined, or did not name the config it read" "$OUT"
  fi
fi

step "rebrief on a store with NO config beside it says which file it fell back to"
# The divergence the cold-stranger review found and this loop could not see: the
# default layout puts the beside-the-store config and the hooks' config at the
# same path, so the fallback never showed. A SECOND store, with no config of its
# own, is the only shape that exercises it — and the point of the step is the
# printed source line, not the number.
OUT=$(counterparts rebrief --dir "$FIRSTSTORE" 2>&1)
if printf '%s' "$OUT" | grep -q "budget 9000 bytes from $BASE/claude-code.json"; then
  ok
else
  no "the fallback to the hooks' config was silent, or named the wrong file" "$OUT"
fi

step "rebrief with no ceiling anywhere refuses and lists every path it tried"
NOCONFIG="$WORK/no-config-store"
counterparts init --dir "$NOCONFIG" >/dev/null 2>&1
OUT=$(env HOME="$WORK/empty-home" counterparts rebrief --dir "$NOCONFIG" 2>&1)
if printf '%s' "$OUT" | grep -q "no injection ceiling" &&
   printf '%s' "$OUT" | grep -q "$WORK/claude-code.json" &&
   printf '%s' "$OUT" | grep -q "$WORK/empty-home/.counterparts/claude-code.json"; then
  ok
else
  no "the refusal did not name both places it looked" "$OUT"
fi

step "SessionStart injects the re-rendered bundle, still naming the core"
# The identity lane is still empty here — a promotion needs reinforcement on
# several distinct lived days, and this loop lives one — so the day-0 line is
# still the honest thing to say, now over a store that has memories in it.
OUT=$(payload SessionStart | counterparts-hook 2>"$WORK/hook2.err")
if printf '%s' "$OUT" | grep -q "has not lived a boundary"; then
  no "still the bootstrap line after a rebrief" "$OUT"
elif printf '%s' "$OUT" | grep -q "This memory is for Your Name"; then
  ok
else
  no "the hook injected nothing, or stopped naming the core" "$(cat "$WORK/hook2.err")
$OUT"
fi

step "the dashboard opens the same store"
CMD='counterparts-dashboard status --dir "$HOME/.counterparts/store"'
if true; then
  OUT=$(eval "$CMD" 2>&1)
  if printf '%s' "$OUT" | grep -q "What I am, right now"; then ok; else no "the dashboard did not render its status view" "$OUT"; fi
fi

step "the web dashboard REFUSES to open the default store without --dir"
# The default data dir is the owner's live memory on any machine with an
# install, and `serve` used to open it behind a warning printed AFTER the socket
# was bound. The alarm is the point of the perl wrapper: if the refusal ever
# regresses, the server starts and never returns, and a hanging loop is a loop
# nobody reads. With the alarm, a regression fails this step in ten seconds.
# The way through is `--default-store`, and it is the ONLY flag that means it:
# `--yes` means "skip an interactive confirmation" everywhere in this package
# (owner ruling 2026-09-05), `serve` has none to skip, so `serve --yes` is an
# unknown flag — refused before the store is resolved, under the same alarm.
OUT=$(perl -e 'alarm 10; exec @ARGV or exit 127' counterparts-dashboard serve 2>&1)
CODE=$?
YES_OUT=$(perl -e 'alarm 10; exec @ARGV or exit 127' counterparts-dashboard serve --yes 2>&1)
YES_CODE=$?
if [ "$CODE" = "1" ] &&
   printf '%s' "$OUT" | grep -q "Refused" &&
   printf '%s' "$OUT" | grep -q -- "--default-store" &&
   ! printf '%s' "$OUT" | grep -q -- "--yes" &&
   [ "$YES_CODE" = "1" ] &&
   printf '%s' "$YES_OUT" | grep -q -- "unknown flag --yes"; then
  ok
else
  no "a stray 'serve' was not refused, or 'serve --yes' was not refused as unknown (exit $CODE / $YES_CODE)" "$OUT
$YES_OUT"
fi

step "counterparts status on a MISSING store exits non-zero and offers the right --dir"
# Two halves of one cold-stranger finding (#11): a census of nothing at all is
# not a success — `set -e` around it sailed straight past a typo'd --dir — and
# `counterparts init` offered on its own would create the store in the DEFAULT
# place rather than the one the sentence above it just named.
NOWHERE="$WORK/no-store-here"
OUT=$(counterparts status --dir "$NOWHERE" 2>&1)
CODE=$?
if [ "$CODE" != "0" ] &&
   printf '%s' "$OUT" | grep -q "No store at $NOWHERE" &&
   printf '%s' "$OUT" | grep -q "counterparts init --dir $NOWHERE" &&
   [ ! -d "$NOWHERE" ]; then
  ok
else
  no "status on a missing store did not refuse, or minted one (exit $CODE)" "$OUT"
fi

step "counterparts <command> --help prints THAT command's flags"
# It printed the whole console's usage, so the flags a command takes were
# listed nowhere a person could ask for them.
OUT=$(counterparts note --help 2>&1)
CODE=$?
if [ "$CODE" = "0" ] &&
   printf '%s' "$OUT" | grep -q "^counterparts note — " &&
   printf '%s' "$OUT" | grep -q -- "--salience" &&
   ! printf '%s' "$OUT" | grep -q -- "--confirm"; then
  ok
else
  no "note --help did not print note's own flags (exit $CODE)" "$OUT"
fi

# ── 6. which directories it remembers ───────────────────────

# The scope registry is HOST configuration, beside `claude-code.json` — so these
# steps open no store and name none, and the one that matters is the third: a
# directory set `off` produces a hook that writes NOTHING and says NOTHING. The
# scratch directory is its own, so the loop's earlier hook steps (which run in
# $HOME/project) are untouched by it.
SCOPED="$HOME/scoped-project"
mkdir -p "$SCOPED"

step "counterparts scope --list says nothing is set on a fresh install"
CMD='counterparts scope --list'
if ! doc_check "$CMD"; then
  no "not in QUICKSTART verbatim: $CMD"
else
  OUT=$(eval "$CMD" 2>&1)
  if printf '%s' "$OUT" | grep -q "Nothing is set"; then ok; else no "scope --list did not report an empty registry" "$OUT"; fi
fi

step "counterparts scope . --off writes the registry beside the config"
CMD='counterparts scope . --off'
if ! doc_check "$CMD"; then
  no "not in QUICKSTART verbatim: $CMD"
else
  OUT=$( (cd "$SCOPED" && eval "$CMD") 2>&1 )
  if ! printf '%s' "$OUT" | grep -q "Scope set:"; then
    no "scope --off did not report what it wrote" "$OUT"
  elif [ ! -f "$BASE/scopes.json" ]; then
    no "no registry at $BASE/scopes.json"
  elif ! grep -q '"off"' "$BASE/scopes.json"; then
    no "the registry does not hold the mode it printed" "$(cat "$BASE/scopes.json")"
  else
    ok
  fi
fi

step "the SessionStart hook in an OFF directory prints nothing and writes nothing"
# The whole guarantee: nothing is constructed, so there is nothing to print and
# nothing to write. Byte-for-byte empty stdout, and no session record.
OFF_SESSION="install-loop-off-$$"
OFF_PAYLOAD=$(printf '{"hook_event_name":"SessionStart","session_id":"%s","cwd":"%s"}' "$OFF_SESSION" "$SCOPED")
OUT=$(printf '%s' "$OFF_PAYLOAD" | counterparts-hook 2>"$WORK/hook-off.err")
CODE=$?
if [ "$CODE" != "0" ]; then
  no "the hook did not exit 0 in an off directory (exit $CODE)" "$(cat "$WORK/hook-off.err")"
elif [ -n "$OUT" ]; then
  no "the hook produced output in an off directory" "$OUT"
elif [ -s "$WORK/hook-off.err" ]; then
  no "the hook wrote to stderr in an off directory" "$(cat "$WORK/hook-off.err")"
elif [ -f "$STORE/sessions/$OFF_SESSION.json" ]; then
  no "the hook registered a session in an off directory"
else
  ok
fi

step "counterparts scope . says the mode and which entry decided it"
CMD='counterparts scope .'
if ! doc_check "$CMD"; then
  no "not in QUICKSTART verbatim: $CMD"
else
  OUT=$( (cd "$SCOPED" && eval "$CMD") 2>&1 )
  if printf '%s' "$OUT" | grep -q "off" && printf '%s' "$OUT" | grep -q "Decided by"; then ok; else no "scope did not report the effective mode and its entry" "$OUT"; fi
fi

step "counterparts scope . --resume gives the directory back, and the hook wakes there"
CMD='counterparts scope . --resume'
if ! doc_check "$CMD"; then
  no "not in QUICKSTART verbatim: $CMD"
else
  OUT=$( (cd "$SCOPED" && eval "$CMD") 2>&1 )
  BACK_SESSION="install-loop-back-$$"
  BACK_PAYLOAD=$(printf '{"hook_event_name":"SessionStart","session_id":"%s","cwd":"%s"}' "$BACK_SESSION" "$SCOPED")
  HOOK_OUT=$(printf '%s' "$BACK_PAYLOAD" | counterparts-hook 2>"$WORK/hook-back.err")
  if ! printf '%s' "$OUT" | grep -q -- "— on."; then
    no "scope --resume did not put the directory back on" "$OUT"
  elif [ -z "$HOOK_OUT" ]; then
    no "the hook stayed silent after --resume" "$(cat "$WORK/hook-back.err")"
  elif [ ! -f "$STORE/sessions/$BACK_SESSION.json" ]; then
    no "the hook did not register the session after --resume"
  else
    ok
  fi
fi

step "the package's own exports map resolves as a library import"
# package.json declares `main` and `exports`. A declared entry point nobody
# imports is a claim, not a fact.
mkdir -p "$WORK/lib"
cd "$WORK/lib" || exit 1
LIB_OUT=$("$BUN_BIN" add "$WORK/pkg/$TARBALL" 2>&1 &&
  "$BUN_BIN" -e 'import("counterparts").then((m) => console.log("Counterpart:" + typeof m.Counterpart))' 2>&1)
if printf '%s' "$LIB_OUT" | grep -q "Counterpart:function"; then ok; else no "importing the package did not yield Counterpart" "$LIB_OUT"; fi
cd "$WORK/pkg" || exit 1

step "everything the run wrote is inside the clean room"
# Deliberately phrased as "what did we write", not "did we touch the real home":
# the real `~/.counterparts` is somebody's live memory and this loop does not
# stat it to find out. Instead: every path the run produced is resolved and must
# live under $WORK, and the session record must be the one in the temp store.
STRAY=""
for p in "$STORE" "$BASE/claude-code.json" "$BASE/credentials.env" "$BUN_INSTALL/bin/counterparts"; do
  r=$(cd "$(dirname "$p")" 2>/dev/null && pwd -P)
  case "${r:-/nowhere}/" in
    "$WORK"/*) ;;
    *) STRAY="$STRAY $p->${r:-absent}" ;;
  esac
done
if [ -z "$STRAY" ] && [ -f "$STORE/sessions/$SESSION.json" ]; then ok; else no "wrote outside the clean room:${STRAY:- (no session record)}"; fi

# ── 7. the host's own files, and leaving ──────────────
#
# THESE RUN LAST, and they have to: the last of them RENAMES `$BASE`, which is
# the directory every step above resolves its paths from. The clean-room check
# is therefore the step before this section rather than the end of the file.
#
# Two things are faked here, and only two. `claude` is a STUB on PATH that
# records its argv — the real binary would edit the machine's own `~/.claude.json`
# and this loop never touches anything outside its room. And the settings file is
# pre-seeded with ANOTHER TOOL'S HOOK, because "your other hooks survive" is the
# property this whole command is judged on and an empty file cannot prove it.

STUBBIN="$WORK/stubbin"
CLAUDE_LOG="$WORK/claude-argv.log"
mkdir -p "$STUBBIN"
cat >"$STUBBIN/claude" <<STUB
#!/bin/sh
printf '%s\n' "\$*" >> "$CLAUDE_LOG"
exit 0
STUB
chmod +x "$STUBBIN/claude"
export PATH="$STUBBIN:$PATH"

SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
cat >"$SETTINGS" <<'JSON'
{
  "model": "opus",
  "hooks": {
    "SessionStart": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "/usr/local/bin/other-tool --hook" }] }
    ]
  }
}
JSON

# How many backups sit beside the settings file right now.
backup_count() {
  ls "$HOME/.claude" 2>/dev/null | grep -c 'counterparts-backup' || true
}

step "counterparts connect merges the five hooks BESIDE another tool's, and backs the file up"
CMD='counterparts connect'
if ! doc_check "$CMD"; then
  no "not in QUICKSTART verbatim: $CMD"
else
  OUT=$(eval "$CMD" 2>&1)
  HOOKED=$(grep -c 'bin/hook.ts' "$SETTINGS" || true)
  BACKUPS=$(backup_count)
  if [ "$HOOKED" != "5" ]; then
    no "expected 5 hook entries in the settings file, found $HOOKED" "$(cat "$SETTINGS")"
  elif ! grep -q 'other-tool' "$SETTINGS"; then
    no "the other tool's hook is GONE — the one thing this may never do" "$(cat "$SETTINGS")"
  elif ! grep -q '"model": "opus"' "$SETTINGS"; then
    no "another top-level key was lost" "$(cat "$SETTINGS")"
  elif [ "$BACKUPS" != "1" ]; then
    no "expected exactly one backup beside the settings file, found $BACKUPS" "$OUT"
  elif ! grep -q 'mcp add counterparts -s user' "$CLAUDE_LOG"; then
    no "the MCP registration did not go out through \`claude mcp add\`" "$(cat "$CLAUDE_LOG" 2>/dev/null)"
  else
    ok
  fi
fi

step "connecting TWICE changes nothing and takes no second backup"
BEFORE=$(cksum <"$SETTINGS")
OUT=$(counterparts connect 2>&1)
AFTER=$(cksum <"$SETTINGS")
BACKUPS=$(backup_count)
if [ "$BEFORE" != "$AFTER" ]; then
  no "a second connect rewrote the settings file" "$OUT"
elif [ "$BACKUPS" != "1" ]; then
  no "a second connect took another backup ($BACKUPS beside the file)" "$OUT"
else
  ok
fi

step "counterparts disconnect removes ONLY ours, and the other tool's hook is untouched"
CMD='counterparts disconnect'
if ! doc_check "$CMD"; then
  no "not in QUICKSTART verbatim: $CMD"
else
  OUT=$(eval "$CMD" 2>&1)
  if grep -q 'bin/hook.ts' "$SETTINGS"; then
    no "a Counterparts hook survived the disconnect" "$(cat "$SETTINGS")"
  elif ! grep -q 'other-tool' "$SETTINGS"; then
    no "the other tool's hook went with ours" "$(cat "$SETTINGS")"
  elif ! grep -q 'mcp remove counterparts' "$CLAUDE_LOG"; then
    no "the deregistration did not go out through \`claude mcp remove\`" "$(cat "$CLAUDE_LOG" 2>/dev/null)"
  else
    ok
  fi
fi

step "counterparts uninstall leaves the memory where it is, and names what removes the package"
# Re-connected first, so the plain uninstall has something to take out.
counterparts connect >/dev/null 2>&1
CMD='counterparts uninstall --yes'
if true; then
  OUT=$(eval "$CMD" 2>&1)
  if [ ! -f "$STORE/counterparts.sqlite" ]; then
    no "the store is gone — uninstall never deletes memory by default" "$OUT"
  elif grep -q 'bin/hook.ts' "$SETTINGS"; then
    no "the hooks were not removed" "$(cat "$SETTINGS")"
  elif ! printf '%s' "$OUT" | grep -q 'bun remove -g counterparts'; then
    no "it did not say the one command that removes the package" "$OUT"
  else
    ok
  fi
fi

step "counterparts uninstall will not touch a directory that holds anything else (B1)"
# THE BLOCKER, as a step. A configuration somewhere of the person's own —
# `install --config <path>` is the supported way to do that — and the directory
# around it must come through untouched whatever happens to ours.
MINE="$HOME/Documents"
mkdir -p "$MINE/taxes"
echo "not yours" > "$MINE/taxes/2025.pdf"
counterparts install --config "$MINE/claude-code.json" --budget 9000 --name "Someone" >/dev/null 2>&1
PLAN=$(printf 'no\n' | counterparts uninstall --config "$MINE/claude-code.json" --park 2>&1)
# WHAT MUST HOLD EITHER WAY: nothing that is not ours moved. Whether the plan
# is reached at all depends on the machine — the process check runs first and
# refuses on a box with a live Counterparts server of its own, which is step
# 58's situation too.
if [ ! -f "$MINE/taxes/2025.pdf" ] || [ "$(cat "$MINE/taxes/2025.pdf")" != "not yours" ]; then
  no "a file that is not ours was touched" "$PLAN"
elif printf '%s' "$PLAN" | grep -q "still running\|could not check"; then
  ok   # refused before the plan: the guard, doing its job
elif ! printf '%s' "$PLAN" | grep -q "itself STAYS"; then
  no "the plan did not say the directory stays" "$PLAN"
elif ! printf '%s' "$PLAN" | grep -q "taxes"; then
  no "the plan did not name the foreign entry it is leaving" "$PLAN"
else
  ok
fi

step "counterparts uninstall --park moves the whole directory aside, or refuses because something of ours runs"
# BOTH OUTCOMES ARE CORRECT, and which one happens is a fact about the machine
# the loop is running on rather than about the package: the refusal is scoped to
# "a Counterparts MCP server, worker or dashboard from ANY install", so a
# developer with a live install of their own gets the refusal and a bare CI box
# gets the rename. The step asserts whichever one it got, in full.
CMD='counterparts uninstall --park --yes'
if true; then
  OUT=$(eval "$CMD" 2>&1)
  CODE=$?
  PARKED=$(ls -d "$BASE".parked-* 2>/dev/null | head -1)
  if [ "$CODE" = "0" ]; then
    if [ -d "$BASE" ]; then
      no "it exited 0 and left the directory where it was" "$OUT"
    elif [ -z "$PARKED" ] || [ ! -f "$PARKED/store/counterparts.sqlite" ]; then
      no "nothing parked beside $BASE holds the store" "$OUT"
    elif ! printf '%s' "$OUT" | grep -q 'To bring it back later'; then
      # The guarded `mv` used to be the last thing on this screen; since
      # 2026-09-22 (finding #22) the way back is a command, and the shell line
      # lives in `counterparts help uninstall`.
      no "it did not say how to bring the parked memory back" "$OUT"
    else
      ok
    fi
  else
    if [ ! -d "$BASE" ]; then
      no "it refused and the directory is gone anyway" "$OUT"
    elif ! printf '%s' "$OUT" | grep -q 'Close Claude Code sessions and try again'; then
      no "it refused without saying what to do about it (exit $CODE)" "$OUT"
    else
      ok
    fi
  fi
fi

# ── done ────────────────────────────────────────────────────────────────────

T1=$(date +%s)
echo
echo "steps: $((PASS + FAIL))   PASS $PASS   FAIL $FAIL   total $((T1 - T0))s"
echo "clean room left at $WORK (rm -rf it when you are done)"
# Any failure exits non-zero. There is no category of failure this loop tolerates:
# a loop that returned success beside a live bug would be the "verify says
# everything is fine" failure the cold-stranger review already caught once.
[ "$FAIL" -eq 0 ] || exit 1
