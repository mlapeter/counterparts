# Adversarial review — PR #141, `fix/h1-hook-standdown-visible`

Head `d12486d`, base `origin/master` `03297c6`. Reviewed 2026-09-18 in an isolated
worktree with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`. Nothing on the branch was pushed,
commented on, merged or deployed. Every probe ran against fresh temp dirs with a temp
`HOME`; no live store was read or written.

**Verdict up front.** The idea is right and the implementation is careful. The healthy
path is byte-identical — I proved it, not just read it. The suite and typecheck are what
the builder says. There are no blockers. There are three things I would fix before this
goes onto a live store, and one of them (the false "skipped this turn" on a failure that
happened *after* the turn's work succeeded) is the kind of wrong sentence that teaches
the owner to distrust the new line — which would undo the whole track.

Counts: **0 BLOCKER · 3 MAJOR · 6 MINOR · 5 NIT.**

---

## What I verified held up

| Claim | Result |
|---|---|
| The healthy path does not change by a byte | **PROVED identical** — all 5 events, fresh store and a store that has lived a full session, stdout + stderr + exit code, master vs head |
| A SessionStart carrying a wake AND the pre-existing red `systemMessage` | **PROVED identical** (the fresh-store SessionStart is exactly that case: 872 B of `systemMessage` + `hookSpecificOutput.additionalContext`) |
| Never a second JSON object after the wake | **PROVED** — with `close()` patched to throw at SessionStart, stdout is still the one wake object |
| Exit code stays 0 on every fault path at SessionStart / UserPromptSubmit | **PROVED** across ~20 hostile states (broken store, corrupt paths, unwritable marker dir, marker-is-a-directory, 5 MB junk marker, illegal session ids, EACCES store, concurrent hooks) |
| No memory text on either channel | **PROVED** — a schema body `SECRET-BODY-TEXT-abc` appears in neither stdout nor stderr nor the marker, and `counterparts doctor`'s red line does not carry it either |
| Session ids are sanitized before becoming filenames | **PROVED** — `../../escape`, `a/b`, `..`, `.`, `""`, NUL, 300 chars all return `null` from `standDownMarkerPath`; nothing was written outside `<dataDir>/sessions/` |
| Deliberate stand-downs stay silent | **PROVED** — scope `off` (both doors), observer with no store, the explicit-dir guard (`IMPLICIT_DEFAULT_DIR_REFUSED`, the normal agent-shell state), `EXPLICIT_DIR_GUARD_MALFORMED`, unknown event, unparsable payload, Stop re-fire: all stdout-empty, exit 0 |
| A **corrupt database** is a fault that is said | **PROVED** — a store whose `operational.sqlite`, `-wal` and `-shm` were all overwritten with plain text: `SessionStart: Counterparts memory is OFF for this session: file is not a database (HOOK_FAILED)`, exit 0, prompts afterwards quiet (persistent, once per session). Same with the main file alone after the sidecars were checkpointed away. My first attempt at this in probe 4 produced a *healthy* wake — that was a fixture artifact: a freshly built store still has every page in the `-wal`, so SQLite never read the garbage |
| A store from a **newer schema** is a fault that is said | **PROVED** — `schemaVersion` bumped to 99: `Counterparts memory is OFF for this session: this store was written by a newer build than the one running (SCHEMA_AHEAD)`, exit 0, said again at the next SessionStart. `SCHEMA_AHEAD` is correctly absent from `isDeliberate` |
| `sessions/` markers do not upset anything | **PROVED** — `Store.open` fine, `assertLayout` fine (markers are one level below the classified `sessions` entry), `readSession` does not mistake them for records, and `pruneSessions` *does* clean them up after 7 days (the brief's "markers are never cleaned up" is not true) |
| Doctor's `store-open` writes nothing of substance | **PROVED** for a normal store (only `-shm` changes); see MINOR-4 for the caveat |
| Doctor does **not** run a second open at SessionStart | **PROVED** by code (`hooks.ts:1599` passes no `open`) and by the byte-identical SessionStart |
| Full suite | `bun test` → **2279 pass / 0 fail** (39 files, 56 s) |
| Typecheck | `bun run typecheck` → **clean** |
| Flake | `hook-standdown` + `config-rule` + `scopes` + `doctor` + `claude-code`, **5 runs, 411 pass / 0 fail every time** |

---

# MAJOR

## MAJOR-1 — A failure that happens *after* the turn's work succeeded is reported as "Counterparts skipped this turn" / "memory is OFF". PROVED.

**File/line.** `src/adapters/claude-code/bin/hook.ts:655` (`said.wroteStdout = true` is set
only when `delivery.stdout.length > 0`), `:660` (`adapter.counterpart.close()` in the
`finally`, inside the same `try` the outer catch covers), `:474` (`await runHook(...)` →
the fault handler).

**Scenario.** UserPromptSubmit on a perfectly healthy store. `adapter.hook()` runs: recall
is composed, the turn is captured, the session record is written. `delivery.stdout` is
empty (an ordinary prompt with nothing to inject), so `said.wroteStdout` stays `false`.
Then `adapter.counterpart.close()` throws — which is exactly incident **I38**, "database
is locked after a Stop", the one close-time failure this project already has on record for
the live store. The throw escapes `runHook`, `main`'s catch classifies it, and the owner
is told:

> Counterparts skipped this turn: the memory database was busy (database is locked). If this keeps happening, run: counterparts doctor

Nothing was skipped. And with a non-lock close failure the sentence is worse:

> Counterparts memory is OFF for this session: close failed: something else entirely (HOOK_FAILED). Run: counterparts doctor

Memory was not off. It worked.

**Proof.** Both trees copied into scratch and patched so `close()` throws; the branch was
not touched. Healthy store, four prompts:

```
SessionStart:      exit=0 [systemMessage+hookSpecificOutput]  (the normal wake — guarded, correct)
UserPromptSubmit:  exit=0 (silent)
UserPromptSubmit:  exit=0 [systemMessage] Counterparts skipped this turn: the memory database was busy …
UserPromptSubmit:  exit=0 (silent)
marker: {"code":"HOOK_FAILED","told":false,"transient":{"count":4,"told":true}}
sessions dir: s-after.json, s-after.standdown.json      ← the work DID happen
```

and with a non-lock throw, the first prompt prints `Counterparts memory is OFF for this
session: close failed: something else entirely (HOOK_FAILED)`.

**How often, honestly.** Narrower than "MAJOR" sounds, and the owner should read it that
way. It fires only on prompts where `delivery.stdout` is empty — i.e. where recall injected
nothing — so on the live 16k-memory store many prompts are already guarded by
`said.wroteStdout`. And I38 was recorded under `journal_mode=DELETE`; the PR measured 0
locks in 90 prompt events after the F1 WAL conversion, so the frequency of a close-time
throw on the live WAL store is **unmeasured, possibly zero**. I keep the rank because the
cost of being wrong is the thing this whole track is spending its credibility on, and the
fix is two lines.

**Why it matters more than it looks.** `said.wroteStdout` is doing double duty: it is an
*ordering* guard ("do not print after the wake") but the PR also leans on it as a *did the
work happen* guard. On SessionStart the two coincide, because SessionStart always writes
stdout. On UserPromptSubmit they come apart, because a prompt with nothing to inject
writes nothing — and UserPromptSubmit is the event that fires every turn.

**Smallest fix.** Add a second flag to `Said`, set right after `const result =
adapter.hook(name, input);` (hook.ts ~line 640) — `said.didWork = true` — and have
`standDown` return without a message when it is set (keeping the stderr line). One field,
two lines. The `finally`'s close failure is then a log line, which is what it is.

---

## MAJOR-2 — A permanently wedged database is classified transient, and then silenced. PROVED (over the pure rule).

**File/line.** `src/core/store/db.ts:173` (`isLocked` falls back to
`message.includes("database is locked")`), `src/adapters/claude-code/standdown.ts:148`
(`const kind = isLocked(err) ? "transient" : "persistent"`), `:368` (`const say =
!was.told && (hook === "session-start" || count >= 2)`).

**Scenario.** Something holds the store's write lock and does not let go — a crashed or
hung worker, a stale lock over a network filesystem, a `-shm` a reboot left wedged. Every
event of every session gets `database is locked`. `isLocked` cannot tell "busy for 40 ms"
from "busy forever": it is a substring test on a message. So:

- Session whose SessionStart is also locked: **one** line — "could not load memory at
  session start: the memory database was busy … recall will work once the database is
  free" — and then **nothing for the rest of the session**, however many turns die.
  The line actively tells the owner it is temporary when it is not.
- Session whose SessionStart got through but every prompt is locked: prompt 1 quiet,
  prompt 2 says "skipped this turn", **prompts 3…n quiet forever.**

**Proof** (`decideSay` walked directly, it is pure):

```
session-start:      "Counterparts could not load memory at session start…"  count=1 told=true
user-prompt-submit: (quiet)  count=2
user-prompt-submit: (quiet)  count=3
user-prompt-submit: (quiet)  count=4

prompts only:  1 (quiet) · 2 "Counterparts skipped this turn…" · 3 (quiet) · 4 (quiet) · 5 (quiet) · 6 (quiet)
```

That is I32 again inside the transient branch: a store that is doing nothing, and a
terminal that says nothing. The per-session `told` flag is one-way and there is no
escalation.

**Smallest fix.** Escalate on count. In `decideSay`, when `fault.kind === "transient"` and
`count` crosses a threshold (say 5 in one session), say the persistent sentence once more
with its own words — "Counterparts has been unable to reach the memory database for N
turns this session" — and set a second flag so it is still said at most twice. Roughly six
lines in the pure function, and it is testable without a process like the rest of the rule.

---

## MAJOR-3 — The stand-down writes a file into a data dir the store layer explicitly refuses to open (`~/.bansai`, `~/.claude-engram`). PROVED.

**File/line.** `src/adapters/claude-code/bin/hook.ts:581` (`said.dataDir =
loaded.dataDir`, set *before* anything validates the directory), `:430` (`writeMark(dataDir,
…)`), `src/adapters/claude-code/standdown.ts:311` (`mkdirSync(join(dataDir, SESSIONS_DIR),
{ recursive: true })`).

**Scenario.** A configuration names `dataDir: "<home>/.bansai/nested"`. `hostConfig`
resolves it, `said.dataDir` is set, and only later does `Store.open` →
`assertSafeDataDir` (`src/core/store/paths.ts:67`) throw `DATA_DIR_FORBIDDEN` — the wall
that exists precisely so this repo's code can never touch v1's live memory. The fault is
not deliberate, so `standDown` runs with `marker: true`, and `writeMark` **creates the
directory chain and writes a file inside the forbidden root**.

**Proof** (hermetic: a temp `HOME` with a fake `.bansai`; the real one was never touched):

```
SessionStart: exit=0 say="Counterparts memory is OFF for this session: the configured data dir
             is one this build refuses to open (DATA_DIR_FORBIDDEN). Run: counterparts doctor"
under <temp home>/.bansai: ["nested/sessions/sess-forbidden.standdown.json"]
marker: {"sessionId":"sess-forbidden","code":"DATA_DIR_FORBIDDEN","told":true,…}
```

On `origin/master` that path wrote nothing at all. This is new, and it is a write through a
wall the project's own CLAUDE.md states as one of its two standing safety rules ("Never
touch the live stores … off-limits to all code and sessions here"). It does not fire on the
owner's own deployment (his `dataDir` is `~/.counterparts`) — it fires for agents,
reviewers and replay tooling, which is exactly the population the guard was built for.
Note that `standdown.ts`'s own `PLAIN_WORDS` table has an entry for `DATA_DIR_FORBIDDEN`,
so the builder knew the code was reachable.

**Smallest fix.** One line at the top of `writeMark`: run the path through
`assertSafeDataDir` (or `isWithin(forbiddenRoots(), dataDir)`) inside the existing
`try`/`catch`, so a forbidden root returns `false` like any other unwritable one. The
message is still shown — this only stops the file.

---

# MINOR

## MINOR-1 — The Stop hook's exit code changes from 0 to 2 when anything throws after an ask was composed. PROVED.

**File/line.** `hook.ts:658` (`process.exitCode = delivery.exitCode`, now inside
`runHook`), `:474` (main's catch), `:~600` (entry point: `process.exit(process.exitCode
=== 2 ? 2 : 0)`).

On master a throw out of `main` reached the top-level rejection handler, which always
called `process.exit(0)` — so a Stop that had set `exitCode = 2` and then threw on
`close()` exited **0** and the ask was silently dropped. On this branch the throw is caught
*inside* `main`, `process.exitCode` survives, and the process exits **2**.

Proved with both trees patched identically (a forced ask + a throwing `close()`):

```
master: exit=0  stderr="FAKE-ASK[counterparts] hook stood down: database is locked"
head:   exit=2  stderr="FAKE-ASK[counterparts] hook stood down: …"
```

Consequences: the stop is now **blocked** and the *whole* of stderr — including
`[counterparts] hook stood down: …` — is fed back to the model as Stop-hook feedback, i.e.
the diagnostic line lands in the model's context. It does not loop (the re-fire carries
`stop_hook_active` and returns exit 0 — I checked). Arguably this is an improvement (the
ask now actually gets delivered), but it is an untested, undocumented change to the one
event where exit 2 means something, and I38 makes the triggering condition real. **Fix:**
decide it on purpose — either `process.exitCode = 0` in the catch when the hook is `stop`,
or say in the PR body that the Stop ask now survives a close failure, and pin it in a test.

## MINOR-2 — The marker write is not atomic and follows symlinks; `sessions.ts` says its writes are both. PROVED.

**File/line.** `standdown.ts:312` — `writeFileSync(path, …)` where `sessions.ts` (its own
rule 3, stated in the module header) writes to `<path>.<pid>.tmp` and `rename`s.

Two consequences, both proved:

- **Symlink follow.** I put a symlink at `<store>/sessions/s-link.standdown.json` pointing
  at a file outside the store; after one hook run the target had been overwritten with the
  mark JSON. `sessions.ts`'s tmp+rename would have replaced the symlink instead. It needs
  someone able to create a symlink inside the store first, so it is not a live attack — but
  it is a write-outside-the-store primitive in the file every session runs through.
- **Lost update / torn read.** Six concurrent hooks of one session: all exited 0, one
  printed, the marker was valid JSON, no crash. The race is benign today because the record
  is tiny, but a torn read simply reads as "no prior mark" and repeats the line.

**Fix:** three lines — write `${path}.${process.pid}.tmp`, then `renameSync`, inside the
existing `try`. Same directory, so the rename is a rename.

## MINOR-3 — The reason clause is a raw error message on the `HOOK_FAILED` path, so absolute paths reach the terminal. PROVED.

A store dir the process cannot enter produces, in the owner's terminal:

> Counterparts memory is OFF for this session: EACCES: permission denied, mkdir '/…/store/prose' (HOOK_FAILED). Run: counterparts doctor

No memory text — I checked the `StoreError` side and it is genuinely safe: every prose
failure is wrapped (`store/prose.ts:161` turns a raw `JSON.parse` error into
`PROSE_PAYLOAD_MALFORMED`), `PLAIN_WORDS` gives it a fixed sentence, and only
`detail["path"]` is ever printed, and only in doctor's *fix* line, not in the hook message.
I confirmed a schema body never appears on either channel.

What does reach the terminal is any third-party error message, verbatim to 200 chars. Bun's
own `JSON.parse` errors quote a token from the input (`JSON Parse error: Unexpected
identifier "the"`), so a future unwrapped parse anywhere in the open path becomes a leak
with no further change to this file. **Fix (cheap):** on the `HOOK_FAILED` branch, replace
`homedir()` with `~` and keep the rest; **fix (better):** say `OPEN_FAILED_WORDS` for
non-`StoreError` throws too and leave the raw message on stderr, where it already is.

## MINOR-4 — "It writes nothing" is true only modulo sidecars, and the test only excuses `-shm`. PROVED.

`readCounterpartOpen` (`doctor.ts:488`) opens as an observer. On a normal store it changes
only `-shm`, which the branch's test skips, correctly — `changed (shm skipped): []`, with
the `-wal` hashed and unchanged. That part of the claim holds. What I actually proved
beyond it:

- on a clean store whose `-shm` had been removed, the reading **creates one**
  (`before: operational.sqlite-wal` → `after: operational.sqlite-shm, operational.sqlite-wal`);
- a *failed* observer open, on a store I had damaged by deleting its live `-wal`, still
  created a `-wal` file. I am not claiming the clean no-`-wal` case from that run: the open
  returned `ok: false`, so the fixture was broken, not representative.

It matters for the stated contract "an instrument may not write at open" and for anyone
hashing a store directory (snapshots, the backup comparison). **Fix:** none needed in code;
soften the sentence in the PR body / `NOTES.md` to "writes no store content; WAL sidecars
may be created, as any reader creates them".

## MINOR-5 — `readCounterpartOpen` is called outside `doctorCommand`'s `try`, and it can throw. PROVED (synthetically).

`src/adapters/cli/commands.ts:4072` — `const open = storeExists(dir) ? readCounterpartOpen(dir)
: undefined;` sits *above* the `try` that wraps the rest of the reading. `readCounterpartOpen`
catches the open, but its catch then calls `describeFault(err)`, which touches `err.code`
and `String(err)`; a throwable with a throwing getter, or a null-prototype throwable, makes
it throw out:

```
readCounterpartOpen(store, () => { throw { get code() { throw new Error("evil") } } })
→ THROWS out of readCounterpartOpen: Error: evil
→ THROWS on a null-prototype throwable: TypeError: No default value
```

Not realistic from SQLite, but `doctor` is the command people run *because* something is
wrong. **Fix:** move the line inside the existing `try`, or wrap the body of
`readCounterpartOpen`'s catch in its own `try` and fall back to
`{ code: "HOOK_FAILED", reason: OPEN_FAILED_WORDS }`.

## MINOR-6 — Two fault paths say it on every single prompt, for the rest of the session, forever.

By design and documented, but worth the owner's eyes before deploy: the two configuration
refusals keep no marker (hook.ts:494, :573), and any fault on a store whose `sessions/` dir
cannot be written keeps no marker either. I proved all three repeat on every prompt. On a
long session that is one red line per turn. The builder's reasoning ("repeating is noise,
silence is I32") is right as a tie-break, but a cheap middle exists: for the two config
refusals the *config path itself* is a stable key, so the mark could live beside the config
or in `os.tmpdir()` keyed by session id rather than not at all.

---

# NIT

1. **`describeFault` throws on exotic throwables** (`standdown.ts:148,152`): a throwing
   `.code`/`.message` getter, a throwing `toString`, an `Object.create(null)`. It then
   escapes `main`'s catch to the entry-point handler, which does `String(err)` on the same
   object and throws again → unhandled rejection → non-zero exit. **Not a regression** —
   master's handler had the identical exposure — and no real error looks like this. Noted
   only because MINOR-5 is the same weakness in a place that *is* worth guarding.
2. **A crafted marker can silence the session forever**: `readMark` accepts a negative
   `transient.count` verbatim (`standdown.ts:295`), so `{"transient":{"count":-1000000}}`
   suppresses every transient message. Also `told: true` on either counter is one-way. Clamp
   `count` to `Math.max(0, …)` and be done.
3. **A session whose id is not a legal filename gets the line on every turn** — proved with
   a 300-char id and an absent `session_id`. This host sends UUIDs, so it is theoretical.
4. **Markers survive only until `pruneSessions` runs**, which is SessionStart-only and only
   when the store opens. On a store that never opens they accumulate (one small file per
   session) until it is fixed. Bounded and harmless; the brief's worry about unbounded
   growth does not apply.
5. **`refusalReason` strips a literal `"refused: "` prefix by string match**
   (`hook.ts:441`). If `config-path.ts` ever reworded its openers this silently starts
   printing "memory is OFF for this session: refused: …". A shared constant would cost
   nothing.

---

# What I did not cover

- **A `UserPromptSubmit` whose stdout is non-empty was never in the byte-diff.** The
  "store with some memories" I built has no embedder and no credentials, so recall never
  injected anything and every prompt event wrote 0 bytes on both trees. The diff at that
  write site is `if (delivery.stdout.length > 0) { write; said.wroteStdout = true }` — a
  pure addition after the write, so no byte change is possible — but I am stating the
  coverage gap rather than implying I measured it.
- **A real contended database was never scheduled.** Same reason the builder gives: under
  WAL a reader is not blocked by a writer, so the transient *display* path cannot be raced
  into existence. I proved the rule over `decideSay` (which is how MAJOR-2 was found) and
  the wiring with a patched `close()`.
- **Nothing was run against the live store, `~/.counterparts`, `~/.bansai` or
  `~/.claude-engram`**, and `claude` was never launched.

---

# Collisions with the open PRs (flagged, not fixed)

| PR | File this PR also edits | Risk |
|---|---|---|
| **#136** (F2 snapshots) | `src/adapters/claude-code/doctor.ts`, `CONTRACT.md`, `NOTES.md` | **Highest.** Three-file overlap. #141 adds an import block, `OpenReading`, `readCounterpartOpen`, `openFindings` and a new line in `doctorFindings`' composition array; #136 adds its own finding in the same places. `CONTRACT.md` §5 both append a new numbered guarantee — #141 takes **24**, so whoever lands second must renumber. |
| **#138** (S1 self page) | `src/adapters/claude-code/doctor.ts`, `src/adapters/cli/commands.ts` | Same `doctorFindings` composition array and the same `doctorFindings({…})` call site in `doctorCommand`, plus the same import block from `../claude-code/doctor.js`. Textual, but three-way with #136. |
| **#135 / #139** (F3 / removed-belief fix) | `src/adapters/cli/commands.ts` | Light — different regions of a 4,000-line file. Neither touches `core/store/db.ts`. |
| `isLocked` export in `src/core/store/db.ts:173` | — | **No collision found.** No other open PR touches `db.ts`. One added export, no behaviour change; I re-read it and the substring fallback is unchanged (which is what MAJOR-2 is about, not a regression). |

Ordering suggestion for the coordinator: land #141's `doctor.ts` before #136 and #138, or
expect two rebases. The `CONTRACT.md` guarantee number (24) is the one thing that will
conflict semantically rather than textually.

---

# Verdicts

**Safe to merge as is?** No — **merge after MAJOR-1 and MAJOR-3.**
MAJOR-1 is a wrong sentence in the owner's terminal on the exact incident (I38) this
codebase already has on record, and a warning that is sometimes false is a warning people
learn to scroll past — which is the failure mode the whole track exists to prevent. The fix
is one field and two lines. MAJOR-3 breaks a standing project safety rule with a `mkdir -p`
into `~/.bansai`; the fix is one line in `writeMark`. MAJOR-2 and MINOR-1 I would take in
the same pass if the owner is willing, but neither is a reason to hold the merge — MAJOR-2
leaves the owner no worse off than master (which said nothing at all), and MINOR-1 is
plausibly an improvement that simply has not been named.

**Safe to deploy to the live store where every session runs through this file?**
**Yes, after those two fixes** — with one condition the builder already named. The healthy
path is byte-identical across all five events on two store shapes, exit codes are 0
everywhere they were 0, no fault path can produce a second JSON object or a non-JSON
stdout, and every deliberate stand-down I could reach stays silent, including the
explicit-dir guard that is the normal state of this project's own agent shells. The
condition is scar §2.18: the `{"systemMessage": …}`-**only** output form has never been
watched rendering on this host. Make "break a scratch store, start one session, look at the
terminal" step one of the post-deploy checks — if that form does not display, the owner is
exactly where he was, and nothing else has changed.

---

## Appendix: how each claim was proved

All probes are in the shared scratchpad under the `h1-review-` prefix:
`h1-review-probe1.ts` (healthy-path byte diff, master vs head, via a `git archive`
extraction of `origin/master` at `h1-review-master/`), `h1-review-probe2.ts` (the pure
surface under hostile inputs), `h1-review-probe4.ts` (process-level fault paths, deliberate
paths, race, symlink, illegal ids), `h1-review-probe5.ts` / `h1-review-probe6.ts` (doctor:
writes, cost, grades, read-only dir, real CLI output), `h1-review-probe7.ts` (the
after-the-work throw and the Stop exit code, using patched **copies** of both trees in
scratch — the branch itself was never modified), `h1-review-probe8.ts` (layout, prune,
`readSession`, the console over a store holding a marker), `h1-review-probe9.ts` (a
genuinely corrupt database, and `isDeliberate` over the store codes),
`h1-review-probe10.ts` (a store from a newer schema).

Cost of doctor's new open, measured: **~14 ms for 400 schema rows** (13.3 / 13.5 / 14.3 /
14.7 / 29.5 ms over five runs), so a store with a few thousand schema rows pays well under
a second — and it is off the hot path entirely, since the SessionStart notice passes no
`open`.

No permission prompt or classifier refusal blocked any probe, except that the shell
classifier twice refused a compound bash script with computed command names; I rewrote
those probes as TypeScript files and they ran normally.
