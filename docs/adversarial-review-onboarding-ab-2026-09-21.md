# Adversarial review — PR #161 (`onboarding/ab-wire-uninstall`), 2026-09-21

**VERDICT: MERGE AFTER FIXES.** One blocker, and it is small and contained.

**BLOCKER 1 · MAJOR 3 · MINOR 8 · NIT 5**

Reviewed at `5680022` (detached). Everything below was run in a throwaway `HOME` under
the session scratchpad with a stub `claude` on PATH (records its argv, exits 0) and, where
a bare box was needed, a stub `ps` that reports nothing. No real store, host file or
`claude` binary was touched. Harness: `$SCR = <scratchpad>/adv`, `cp.sh <home> <argv…>`
runs the CLI under `env -i HOME=<home>`; `drivepty.py` drives a real pty.

---

## BLOCKER

### B1. `--park` renames, and `--delete-memories` `rm -rf`s, the WHOLE directory the configuration sits in — whatever else is in it

`uninstall.ts:267` takes `base = resolve(join(configPath, ".."))` and the only test that it
is a Counterparts directory is `existsSync(join(base, CONFIG_FILE))` (`baseRefusal`,
`uninstall.ts:147`). Any directory holding a `claude-code.json` is fair game, and
`install --config <path>` is the supported way to put one anywhere. The warning then
enumerates only our own files — "the store, the configuration, the credentials file, the
scopes registry and every snapshot" — which is false for every other thing in that
directory, and the count says nothing about them.

**Repro A — the host's own config directory is renamed away.**

```bash
H=$SCR/h2; mkdir -p "$H/.claude/projects/myproj" "$H/.claude/todos"
# a normal ~/.claude: settings.json, transcripts, todos
$SCR/cp.sh "$H" install --name S --config "$H/.claude/claude-code.json" --no-wire
BARE=1 $SCR/cp.sh "$H" uninstall --park --yes --config "$H/.claude/claude-code.json"
```

Observed (exit 0):

```
Your memory, parked
ok    ~/.claude
        -> ~/.claude.parked-2026-09-21
      One rename. Nothing was copied, nothing was deleted, and the store was never opened.
$ ls -A ~           →  .claude.parked-2026-09-21
$ ls -A ~/.claude.parked-2026-09-21
claude-code.json  credentials.env  projects  settings.json  store  todos
```

Claude Code's entire user configuration — settings, project transcripts, todos — moved,
under a heading that says "Your memory, parked".

**Repro B — `--delete-memories` destroys unrelated files, on a real pty, after warning
about "1 memory".**

```bash
H=$SCR/h3; mkdir -p "$H/Documents/taxes" "$H/Documents/photos"
echo x > "$H/Documents/taxes/2025.pdf"; echo y > "$H/Documents/photos/a.jpg"
$SCR/cp.sh "$H" install --name S --config "$H/Documents/claude-code.json" --no-wire
REALHOME=$HOME BARE=1 python3 $SCR/drivepty.py "$H" 'DELETE MEMORIES' -- \
  ~/.bun/bin/bun run <repo>/src/adapters/cli/bin/counterparts.ts \
  uninstall --delete-memories --config "$H/Documents/claude-code.json"
```

Observed:

```
fail  WARNING: this will delete 1 memory.
      Everything under that directory goes: the store, the configuration, the
      credentials file, the scopes registry and every snapshot.
Type DELETE MEMORIES to go ahead: DELETE MEMORIES
Deleted
ok    1 memory is gone, and so is ~/Documents.
$ ls ~/Documents   →  No such file or directory      (taxes/ and photos/ with it)
```

**Why it matters:** the person is told one memory is at stake and consents to that; a
directory of their own files goes with it, irreversibly, with no line naming any of them.

**Smallest fix I would accept:** in `baseRefusal`, list `base` and refuse both moving arms
when it holds an entry that is not one this package writes (`claude-code.json`,
`credentials.env`, the store dir, `scopes*`, `snapshots*`, `*.tmp`, our own backups).
Failing that, count and NAME the foreign entries inside the warning
(`WARNING: this will delete N memories AND 3 other things in ~/Documents: taxes/, photos/, …`)
and make `--park`'s heading name the directory rather than "your memory".

---

## MAJOR

### M1. When the store lives outside the config directory, the warning counts memories that are then NOT deleted — and says they are gone

`censusOf(base, dataDir)` (`uninstall.ts:208`) counts the store at `dataDir`; `deleteBase`
(`:479`) removes `base` only. `install --dir <elsewhere>` is a documented arrangement
(`commands.ts:2397` prints a paragraph about it).

```bash
H=$SCR/h4; mkdir -p "$H/elsewhere"
$SCR/cp.sh "$H" install --name S --dir "$H/elsewhere/store" --no-wire
REALHOME=$HOME BARE=1 python3 $SCR/drivepty.py "$H" 'DELETE MEMORIES' -- \
  ~/.bun/bin/bun run <repo>/src/adapters/cli/bin/counterparts.ts uninstall --delete-memories
```

```
fail  WARNING: this will delete 1 memory.
ok    1 memory is gone, and so is ~/.counterparts.
      Nothing in this package can bring it back.
$ ls ~/elsewhere/store  →  cache counterparts.sqlite counterparts.sqlite-shm counterparts.sqlite-wal
```

The store is intact on disk. The same shape on `--park`: heading "Your memory, parked",
one rename of `~/.counterparts`, and the memory still live at `~/elsewhere/store`
(repro `r15.sh` X4). Both directions are lies a person acts on — "I deleted my memory"
when they did not (privacy), and "nothing can bring it back" when everything can.

**Fix:** when `dataDir` is not within `base`, say so before the phrase and act on both, or
refuse the moving arms and print the two paths the person has to deal with.

### M2. `--park` / `--delete-memories` proceed when the MCP deregistration did not happen

`unwire` returns `outcome: "ok"` with `mcp: "printed"` when `claude` is missing, hangs
(30 s timeout) or exits non-zero; `uninstall` gates the move on `removed.outcome !== "ok"`
only (`uninstall.ts:403`). So the irreversible arm runs and leaves a registration pointing
at a store that no longer exists.

```bash
H=$SCR/q1; $SCR/cp.sh "$H" install --name S --no-wire; $SCR/cp.sh "$H" wire --yes
# ~/.claude.json as a real `claude mcp add` leaves it:
printf '{"mcpServers":{"counterparts":{"command":"bun","args":["run","/pkg/serve.ts"],"env":{"COUNTERPARTS_DATA_DIR":"%s/.counterparts/store"}}}}' "$H" > "$H/.claude.json"
BARE=1 NOCLAUDE=1 $SCR/cp.sh "$H" uninstall --park --yes
```

```
ok    5 Counterparts hooks removed from ~/.claude/settings.json
warn  `claude` is not on this PATH, so the MCP server was not deregistered.
ok    ~/.counterparts   ->  ~/.counterparts.parked-2026-09-21
$ grep COUNTERPARTS_DATA_DIR ~/.claude.json  →  "~/.counterparts/store"      (still there)
```

The file's own argument for blocking — "hooks pointing at a directory that is not there
fail at every session start, silently" — applies to the registration too; the positive
control (unwire cannot write → nothing moved, exit 3) works, so only this half is missing.

**Fix:** on the moving arms, treat `mcp === "printed"` as blocking (or, for `--park`,
require the person to acknowledge that the registration stays and re-print the
`claude mcp remove` line at the end rather than in the middle).

### M3. The process refusal fails OPEN on the destructive verb

`realProcessLister` (`wire.ts:729`) returns `[]` for every failure — no `ps`, a timeout, a
sandbox that refuses process listing — and `uninstall` wraps it in another `catch` that
also yields `[]` (`uninstall.ts:314`). "I could not look" is indistinguishable from
"nothing is running".

```bash
H=$SCR/q3; $SCR/cp.sh "$H" install --name S --no-wire
env -i PATH=$SCR/nops HOME="$H" ~/.bun/bin/bun run <repo>/…/counterparts.ts uninstall --park --yes
# (PATH holds no `ps` at all)
→ ok  ~/.counterparts parked; nothing printed about not being able to check
```

**Fix:** have the lister return `{ processes, looked: boolean }` (or throw), and on the two
moving arms refuse — or at minimum print "could not check whether anything is running" —
when the look failed. Keep fail-open for the cosmetic `sessionsNote`.

---

## MINOR

### m1. `wire` replaces, and `unwire` deletes, a hook command that merely CONTAINS our marker

`HOOK_COMMAND_MARK` matches a composite command. A person who wrapped our hook keeps
neither half.

```bash
# "command": "$HOME/bin/log-start.sh && counterparts-hook", "timeout": 20
$SCR/cp.sh "$H" wire --yes
→ SessionStart: replacing a Counterparts hook that names $HOME/bin/log-start.sh && counterparts-hook
→ command becomes ours alone (timeout: 20 kept)

# "command": "/opt/mytool/bin/wrap --then counterparts-hook"
$SCR/cp.sh "$H" unwire --yes
→ settings.json is now {}      (the wrapper entry is gone entirely)
```

`wire.ts:1049` claims "Nothing belonging to another tool is read as a candidate at any
point"; that is not true of a composite command. **Fix:** when the matched command is not
exactly a `hookCommand(...)` shape (or contains `&&`, `||`, `;`, `|`), refuse to rewrite or
remove it and print it for hand-editing. `doctor` may keep the loose mark for reporting.

### m2. A dangling `settings.json` symlink is silently replaced by a regular file

`realpathDeep` cannot resolve a dangling link, so it returns the link's own path;
`sightSettings` then reports `exists: false` and `writeSettings` renames a new file over
the link. No backup is taken (nothing existed), and the docstring at `wire.ts:211` says the
opposite ("the target is where the file WOULD live, and creating it there is what the
person who made the link asked for"). The out-of-home refusal also never fires for a
dangling link, for the same reason.

```bash
ln -s "$H/dotfiles/settings.json" "$H/.claude/settings.json"   # $H/dotfiles does not exist yet
$SCR/cp.sh "$H" wire --yes
→ ok 5 hooks written to ~/.claude/settings.json
→ ls -l ~/.claude/settings.json   →  -rw-r--r--   (a regular file; the link is gone)
→ ~/dotfiles/settings.json        →  No such file or directory
```

**Fix:** if `lstat` says symlink and the target does not resolve, refuse and say so (that
is a dotfiles arrangement mid-restore), or `readlinkSync` the target and apply the
inside-home test to it.

### m3. A symlinked `~/.claude` DIRECTORY pointing out of the home is written through

The symlink guard only looks at the `settings.json` entry, not at the directory above it.

```bash
ln -s $SCR/outside_s3 "$H/.claude"; $SCR/cp.sh "$H" wire --yes
→ ok 5 hooks written to ~/.claude/settings.json
→ $SCR/outside_s3 now holds our hooks AND the backup, outside the home
```

Harmless in intent (it is where the host reads), but the file docstring promises
"a link pointing outside the home directory is refused", and the output names the tilde
path, so nothing tells the person where the bytes landed. **Fix:** run the inside-home test
on `realpathDeep(dirname(named))` too, or print the resolved target when it differs.

### m4. Ctrl-C at the readline prompts exits 0 and says nothing

`bin/counterparts.ts:38` builds `ask` with no `SIGINT` handling, so Ctrl-C at the name or
the wire question ends the process silently with **exit 0**. At the name prompt nothing has
been created yet; at the wire prompt the store, the config and the 0600 credentials file
all exist and nothing says so — and a `&&` chain or a wrapper script reads exit 0 as
"installed".

```bash
python3 $SCR/drivepty.py "$H" 'Ada;CTRLC' -- … install
→ Wire Claude Code now? [Y/n]        (then nothing)
→ EXIT=0 ; store exists, host untouched, no summary printed
```

The keys step is correct by contrast (PromptAborted → "stopped; nothing else was changed",
exit 2). **Fix:** make `ask` reject `PromptAborted("interrupt")` on `SIGINT` and let the
existing handler print the honest summary and a non-zero code.

### m5. The number in `WARNING: this will delete N memories` is not the number any other surface calls memories

`censusOf` calls `countMemories()` with no filter; every other caller filters
(`{ type: "memory", archived: false }` in `self/index.ts:1354`, `doctor.ts:1405`, …).

```bash
$SCR/cp.sh "$H" status   →  Memories: 0   Beliefs and entities: 1   Archived: 0
uninstall --delete-memories → "WARNING: this will delete 1 memory."
```

On a real store the warning will read high by every archived row, superseded version row,
person, entity and self page. **Fix:** use the same filter as `status`, or word it as rows
("1,204 rows, of which 812 memories").

### m6. The default `uninstall` — "your memory stays exactly where it is" — opens the store READ-WRITE

`censusOf` uses `Store.open({ dir })`, which is a writer (`isObserver` → false), with
`initialize: true`. The plain arm deliberately does NOT check for running processes, so
this can take the write lock against a live session (the I38 "database is locked" shape),
and on a schema-behind store it would migrate during a command that says it touches
nothing. Measured: on an up-to-date store the file digest is unchanged (`r14.sh` W1).
**Fix:** `Store.open({ dir, observer: true })` — the size fallback already covers the
refusals observer adds.

### m7. `terminalWidth` floors a terminal reporting ZERO columns at 30

Known and flagged in the PR body; confirmed on a real pty that has not been sized: every
line of the install conversation folds at 30 characters, including
`ok set ANTHROPIC_API_KEY in` / `~/.counterparts/credentials.env` on two lines.
`columns: 0` means "I do not know", which is what `FALLBACK_WIDTH` is for (`ui.ts:168`).

### m8. The "already wired, nothing to ask" short-circuit depends on reading `~/.claude.json`

When that read does not see the registration (the host moved the file, `CLAUDE_CONFIG_DIR`
differs, or `claude mcp add` wrote elsewhere), an interactive re-run asks "Wire Claude Code
now?" again and re-runs `claude mcp add` even though the hooks are identical. Observed with
the stub `claude` (which does not write the file). Harmless, but the PR's "an install that
is already wired says so instead of asking" holds only when that one file agrees.

---

## NIT

- **n1.** The first `wire` re-serialises the whole settings file: 4-space indent, tabs and
  CRLF all become 2-space + LF. Content and unknown keys survive and a backup is taken;
  the second run is byte-identical (verified).
- **n2.** A settings file with comments (JSONC) or a UTF-8 BOM is refused with the
  hand-merge block. Safe direction; worth confirming Claude Code itself rejects those
  before treating the refusal as correct.
- **n3.** After the confirmation, `wire`/`unwire` re-read and re-merge but write on the
  FIRST plan's `changed`, not the second's: if another process did the work during the
  prompt, we still take a backup and rewrite (identical bytes).
- **n4.** `writeCredential` and `enableEmbedder` both use a fixed `<path>.tmp` sibling; two
  concurrent writers race on that name, and a failed rename leaves the 0600 temp behind.
  Six concurrent `credentials set` runs produced one correct 0600 file (no corruption seen).
- **n5.** `uninstall --park`'s heading is "Your memory, parked" even when the census could
  not be taken and even when nothing of the memory moved (see M1).

---

## Attacked and CLEAN

**settings.json merge.** Foreign hook on the same event with `matcher`, `timeout` and an
unknown key: kept in place, index preserved. A bare string, `{"hooks": "not an array"}`, an
inner entry with no `command`, an event we do not use (`SomeFutureEvent`), unknown
top-level keys: all carried through byte-for-byte, and `unwire` restores the pre-wire array
exactly. Empty file, `{}`, missing file, missing `~/.claude`: handled. Non-regular file
(directory) and mode-000 file: refused, nothing changed. Read-only directory: refused at
the backup, original intact. File mode preserved on both the file and the backup (0600 in,
0600 out). Backups never overwrite: `-2`, `-3` inside one second, via `COPYFILE_EXCL`.
Symlinked `settings.json` into the home: written through, link survives, backup beside the
target. Symlink out of the home: refused. 5 MB file: 73 ms, everything preserved. Second
`wire`: byte-identical, no second backup. `--dry-run`: nothing written, `claude` never
called. A stale entry of ours is repaired in place (its `timeout` kept). Our block pasted
TWICE by hand: `wire` prints "dropping 1 duplicate entry of ours" on each event and leaves
exactly one group with one inner entry on each of the five.

**The `claude` shell-out.** `spawnSync` with an argv array and no shell; a store path
containing spaces, `$`, and a single quote arrives as one argument (stub logged each
`ARG[…]`). `claude` missing → warning, printed line, exit 0. Exit 7 with stderr → warning,
first lines echoed, printed line, exit 0. 30 s timeout exists. Nothing is passed through a
shell anywhere.

**uninstall guard ring.** A `--config` inside a (fake) `~/.bansai` is refused by name on
both spellings, exit 2, "nothing was read". Relative `--config` refused. `..` in the path
normalises correctly. A symlinked configuration directory is refused. `--park` +
`--delete-memories` together: refused. `--delete-memories` has no `--yes`, refuses a pipe,
refuses `yes 'DELETE MEMORIES' |`, and the phrase is exact — `delete memories`,
` DELETE MEMORIES`, `DELETE MEMORIES `, `DELETE  MEMORIES` all refuse and keep the store.
The delete does not follow a symlink out of the tree (a linked directory outside `base`
survived). Old-floor store: `STORE_PRE_ROWS`, so the warning gives a size and says why —
never "0 memories". The count and the phrase are asked BEFORE the unwire. `--dir` is
refused on all three verbs. `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` refuses `wire` and
`uninstall` with no `--config`. `unwire` works with no configuration at all.

**keys.** Driven on a real pty with canary values: the keys appear in **no** terminal byte
and in exactly one file, `credentials.env` at 0600. No echo, the prompt prints one newline.
A name containing quotes is JSON-escaped into the config. The embedder moved only after the
explicit second yes, writing exactly `"embedder": { "enabled": true }` with every other key
and its order preserved. Ctrl-C at a key prompt aborts with exit 2 and summarises from the
FILE; a key written before the abort is reported as written. A key pasted with a trailing
CR is stored without it and does not eat the next prompt; a value containing a space is
refused, not echoed, and nothing is written (`sk-ant-CRLFCANARY` landed clean,
`pa-SPACE CANARY` was refused).

**install conversation.** Non-interactive output is byte-identical to `origin/master` for
the same argv (`install --name Ada`, `--budget 4000`), except two additive lines pointing at
`counterparts wire`; the written config is identical, and `injectionBudgetBytes: 9000` is
written on the interactive arm only. `--yes` through a pipe does not wire — it prints the
blocks. A re-run does not re-ask the name and does not reseed the identity core.

**`store.created` (piece D).** Fresh writer open stamps `dateOf(nowFn())`; a later re-open
leaves it alone (`INSERT OR IGNORE` plus `fresh`); observer on a fresh dir refuses
`STORE_UNINITIALIZED` and creates no directory; observer on an existing store writes
nothing; an old-floor store refuses `STORE_PRE_ROWS` with its directory entries unchanged —
the stamp is after that refusal and after `openOperational`. It fires again only if the
database file itself has been deleted, which is a new store by every other definition.
Nothing scans all of `meta` (only `metaWithPrefix` with `embed.failed.`, `rendered.`,
`spawn.refusal.`), so no hash, digest or `verify` reading changes.

**Not attacked, or not observable — do not read these as CLEAN**

- **`HOME` unset.** Deliberately not run: `homedir()` falls back to the passwd entry, i.e.
  the REAL home, and every path in this command family would have resolved there. The
  hazard is pre-existing and not introduced by this PR; it wants a separate look with a
  fake passwd or an `opts.home` override.
- **A hook mid-flight during `--park` / `--delete-memories`.** `PROCESS_MARKS`
  (`wire.ts:704`) matches the worker (`runner.ts`), the MCP servers and the dashboard —
  **not** `claude-code/bin/hook.ts`. A SessionStart hook holding the store open is
  invisible to the refusal. Short window and an observer-stance reader, so NIT at most,
  but the refusal is narrower than "nothing of ours is running".
- **Terminal state after Ctrl-C at the hidden prompt.** Not observable through the driver
  (the pty dies with the process); `finish()` restores raw mode and pauses the stream by
  code read.
- **Disk-full / partial write, and a writer racing between the re-read and the `rename`.**
  Not simulated. By code read the temp file is removed on failure and the original is never
  truncated (`rename(2)` in the same directory).
- **Whether Claude Code itself accepts a BOM or comments in `settings.json`** (n2), and
  whether it re-reads the file mid-session.

**install loop.** 57/57 PASS in 5 s on a clean checkout. Non-vacuity proved by sabotage:
making `wire` write nothing failed 53, 54 and 55; making the recogniser claim every command
is ours failed 53 ("the other tool's hook is GONE") and 55 ("the other tool's hook went with
ours"). Source restored; `git status` clean. Note step 57 took the refusal branch on this
machine (a live MCP server), so the park branch is still only covered by unit tests.
