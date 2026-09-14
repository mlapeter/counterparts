# `adapters/claude-code/` — NOTES

*Implementation choices the CONTRACT left open, and the reasoning behind them.
Gaps and obligations live in `INTERFACE-GAPS.md`; this file is the "why it looks
like this" record.*

## 1. One entry script, not five

`bin/hook.ts` dispatches on the host's `hook_event_name` rather than shipping a
script per hook. Host hook names, wiring and settings-file mechanics are
advisory (CONTRACT §5 G9), and one executable means one place where the payload
is parsed, one place that always exits 0, and one place that closes the store.
`HOOKS` and `SESSION_ENDING` are the enumerations a test walks; the dispatch is
`ClaudeCodeAdapter.hook()`, which is total over `HookName` by the compiler.

Suggested wiring (host trivia, not a contract):

```json
{ "hooks": { "SessionStart": [{ "hooks": [{ "type": "command",
  "command": "~/.bun/bin/bun run <repo>/src/adapters/claude-code/bin/hook.ts" }] }] } }
```

…and the same command for `UserPromptSubmit`, `Stop`, `SessionEnd`, `PreCompact`.

## 2. The pure/impure split in `spawn.ts`

`planSpawn` is pure and returns a checkable `SpawnPlan`; `spawnDetached` is the
six lines that start a process. Everything worth asserting — the watchdog
validated against `remember/`'s staleness window, the credential precondition,
the environment assembled with `COUNTERPARTS_DATA_DIR` written LAST, the observer
refusal, the escalation counter — is in the pure half, so the tests prove the
properties without ever forking. `Spawner` is injected for the same reason.

## 3. Why the adapter holds a `Counterpart` rather than the modules

Every hook needs two or three modules at once (recall needs schemas, prospective
and associate; the boundary needs spans and self). Assembling them here would be
a second composition root, and the one thing SEAMS exists to prevent is a caller
who forgets a channel and silently loses the safety half riding with it. The
adapter takes the assembled brain and adds nothing but host translation.

## 4. Delivery telemetry rides on the NEXT hook

`sessionStart` records the sentinel it rendered; `userPromptSubmit` reports the
last line the host actually placed in context. That ordering is forced: nothing
inside the session-start hook can know what the host did with its return value.
It is also exactly scar §2.3's shape — v1 shipped eleven days of truncated wakes
because only the render was instrumented — so the two records are deliberately
separate events (`adapter.wake.injected` vs `adapter.wake.delivered`), not one
event with a flag.

## 5. The anti-loop guard is per (hook, session), in process

A hook's own injection lands in the transcript, and a host that re-fires on
injected text would recall on its own render forever. The guard is a set of
`hook:sessionId` keys held for the duration of the call — in-process on purpose,
because the failure it prevents is re-entrancy within one hook invocation, not a
race between two processes. Recall has its own, stronger protection at the cue
layer (`STRIPPERS`' `counterparts-injection` entry), so this is the second of two
independent defences rather than the only one.

## 6. `substanceOf` is one function on purpose

Spec §2 G10 (conversational text only) and §2 G11 (injected context is kept in
capture, excluded from pacing) are two halves of one decision about the same turn
list. They are computed a few lines apart, from the same input, so they cannot
drift: `captureSpans` receives every turn and lets `remember/`'s `enters()` drop
the blind spot; `substanceOf` counts only `source === "conversation"`.

## 7. The interpreter prompt asks for `remember/`'s vocabulary and trusts none of it

`SYSTEM_PROMPT` names exactly the fields `ProposalDraft` accepts. That is a
convenience for the model, not a security boundary: `intake()` re-validates every
field, unknown keys are dropped and counted, and a privileged operation has
nowhere to live because `Proposal` has no field for one (§4.1 G7). The prompt
could be wrong or ignored and nothing downstream would weaken.

## 8. Why the response is parsed rather than schema-pinned

Structured outputs (`output_config.format`) would pin the shape server-side and
is the better answer. It is not used here because this build cannot exercise the
live endpoint — every test fakes `fetch` — and shipping an unverified request
shape into the one network call in the package would be exactly the kind of
"verified merged, not verified live" claim the constitution's line 11 rejects.
What ships instead is a string/escape-aware scanner (`extractJson`) that never
slices between the first brace and the last (scar §2.14), with `intake()` as the
validator. Pinning the shape is a follow-up for the first session with a real
credential; `InterpretClientOptions` is where the knob would go.

## 9. The model seat: one knob, pinned, and a placeholder that expires

`DEFAULT_INTERPRET_MODEL` is a pinned identifier held in configuration, and there
is exactly one seat because there is exactly one model call in the package. The
`placeholder` / `expires` machinery exists anyway, unused by the default, because
scar §2.15's third clause is about the shape of the config rather than about
today's value: an undecided default must be able to expire, or "never decided"
becomes "decided" by silence. `seatStatus` refuses a placeholder with no expiry
outright, which is the case v1 actually shipped.

## 10. `readTranscript` tags the blind spot rather than dropping it

Tool results, images and documents come back as zero-length turns tagged `tool` /
`image` / `file`, and `remember/`'s `enters()` is what drops them. One rule, one
place. The alternative — filtering here — would put a second copy of the
conversational-text-only rule in a file that changes with the host.

## 11. One config rule, and what the hook does instead of printing (2026-09-05)

`bin/hook.ts` and `bin/runner.ts` each hard-coded
`join(homedir(), ".counterparts", "claude-code.json")` and took no flag, as did
`mcp/bin/serve.ts`. That was filed as LAUNCH-STATUS G1, and its cost was not
theoretical: the clean-room install loop could redirect every entry point but the
hook, so "the hook honours the configuration it was given" was a step nobody
could write, and a reviewer on a machine with an existing install could not run
the hook at all without moving a whole `HOME`.

The rule is now one sentence, in `adapters/config-path.ts` and nowhere else:
`--config <absolute path>`, else `COUNTERPARTS_CONFIG`, else the default. The
default did not move — the live host passes neither, and a test asserts that the
no-flag no-env case resolves exactly the old constant, at the module level and in
a real hook process.

Three decisions worth keeping:

**A named configuration that cannot be honoured refuses; it never falls back.**
A `--config` that is relative, or absolute and not there, or not a JSON object,
is a stand-down: one line on stderr, exit 0, nothing injected. Falling back to
the default would mean a scratch run writing into the live store, which is the
accident the whole rule is a reaction to. The refusal direction costs nothing on
the live host, which never names a configuration.

The MISSING-FILE arm was not in the first version, and the review of PR #72
(2026-09-05) reproduced what that cost: `--config /definitely/not/here.json`
exited 0, printed a wake and minted a store. The read error is swallowed into
`loadConfig(undefined)` — the observer default, which is the right fail direction
for a config nobody named — and the data dir then falls through to `dataDir()`.
So a typo in the one flag that says WHICH MEMORY landed on the live store, which
is the same shape as the `--dirr` finding the console already refuses. The check
is `namedConfigRefusal`, a separate function rather than a line inside
`configRefusal`, because `install --config <path>` resolves through the same rule
and its file does not exist yet: writing it is the command. An absent DEFAULT
stays ordinary — a fresh machine has none and the hook must still stand up.

Two arms followed from that one. **The pin and the refusal collided**: `spawn.ts`
pins the parent's resolved path onto EVERY worker, the default included, so on a
machine with no config the worker would have seen a "named" file that is not
there and stood down — nothing would ever sweep or sleep there. `isNamed` is the
fix, and it is the same test `install` uses to decide whether to print a flag:
the PATH, not how it arrived. **And `unreadable` is not `absent`**: `loadConfig`
reports it for a file that parses but whose fields do not typecheck, and resolves
it to `{ observer: true }`, whose store then falls through to `dataDir()`. For a
file somebody NAMED that is a stand-down nobody asked for at a store nobody
named, so the three entry points carry the loader's verdict out
(`namedUnreadableRefusal`). An unreadable DEFAULT is unchanged: observer, as
observer-mode G5 requires.

**The hook RECORDS rather than prints, and the record is the session file.** A
hook's stdout is the model's context and its stderr is a host log nobody reads,
so `<dataDir>/sessions/<id>.json` gains a `config` field — host state, no
content, beside the id and the scope it already carried. A new *durable event*
name would have been the other option and was rejected: `AdapterDurableEventName`
lives in `core/counterpart.ts`, and this is not worth a core change. The ring
event (`adapter.config.file`) is there too, mirroring `adapter.credentials.file`,
for anything reading the ring in-process.

**The worker is PINNED, not re-resolved.** `spawn.ts` writes
`COUNTERPARTS_CONFIG` onto the child last, beside `COUNTERPARTS_DATA_DIR` and for
the same reason (scar §2.13): a hook driven by `--config` that spawned a worker
which then resolved the default file would sweep and sleep against a store nobody
named.

---

## The week the worker never started (I32, 2026-09-11)

A forced `install --force` on 2026-09-04 replaced `credentials.env` with the
template — a file with zero non-comment lines. `planSpawn` refused
`NO_CREDENTIAL` at every boundary for the seven days that followed, and nothing
that happened next was visible from any surface a person looks at.

**What the refusal actually cost.** The worker carries five jobs. Exactly one of
them — the crash-fallback sweep — needs a model call. The other four are the
lagged semantic cue, the embedding backfill, the Hebbian flush, and the sleep
cycle (decay, prune, dedup, consolidate, briefing). The sleep cycle is also the
only thing that advances the lived-day clock. So a missing key stopped the clock
at 185; `self.episode.day.185 = 4` was the day's ask cap, spent on 09-04 and
never reset, so all 39 Stops between the restore and the finding read
`capped: day-chapter-cap` and the model was never asked for a chapter again;
live memories without a vector rose from 219 to 229; and every turn's recall
read `semantic: none`.

Meanwhile the wake delivered, recall rendered, spans captured, `verify` was
clean and the daily graded the day ACTIVE. **The foreground was healthy and the
background had been dead for a week.**

**Three repairs, and the third is the general one.**

1. *Degrade, do not refuse.* The credential is no longer a spawn precondition.
   `runner.ts` asks its own question at the one step that needs an answer and
   passes `sweep: { skipped: "no-credential" }`, which still writes the gate row.
   A guard that protects one job by stopping five is a single point of failure
   with a name on it.
2. *Durable refusals.* `spawn.refused` / `spawn.escalated` were ring-only, and a
   hook process's ring lives for one turn. Scar §2.4 says the door that failed
   must not look like the door nobody opened; at this seam it did. The refusal
   now writes `adapter.spawn.refused`, latched one row per reason per calendar
   date.
3. *Persisted escalation.* `spawnFailures` was a `Map` on an adapter instance.
   Every hook is a fresh process, so "consecutive refusals" was always 1 and
   scar E4's widening — a repeated refusal reaches a human — was inert from the
   day it shipped. The counter is in box 2's meta now
   (`adapter.spawn.refusals.<reason>`), cleared when a spawn starts.

**What is deliberately NOT here.** The refusal row's `count` is the counter at
the moment the row was written, which for the first refusal of a date is 1. The
row is evidence that it happened; `spawnRefusals()` and the meta counter are the
evidence of how deep it got. A row per boundary would be three hundred rows a day
saying the same thing, which is a different way of being unreadable.

## Head-of-line, and why isolation units matter (I33, 2026-09-11)

Two migrated memories carried a lone UTF-16 surrogate in their title. Voyage
answers HTTP 400 for the whole chunk; `BACKFILL_LIMIT` (64) is smaller than the
client's batch size, so the chunk WAS the batch; `missingVectors` returns a
stable order, so the same head-64 was re-asked at every boundary for a week while
165 blind memories queued behind it. Thirty-two consecutive `adapter.embed.backfill`
rows read `0 embedded / 64 failed / reason: ran` — a row with no code on it, so
it read as a flaky provider rather than as two bad bytes.

Three changes, each needed on its own:

- **Sanitize the request body.** `toWellFormed()`, in `callOnce`, and nowhere
  else. The cache key and everything `store.embedOne` compares stay on the
  ORIGINAL string: sanitizing before the cache write would file the vector under
  a key the store never asks for, and the backfill would become a paid-for no-op
  that reports success — the failure the file's own header warns about.
- **Bisect a 400.** Only a 400: the provider read the body and refused it, so the
  poison is in there. A 429 or a 500 says nothing about which input is bad, and
  splitting a 429 multiplies the rate that caused it.
- **Give up after three, but only on the item's own failures.** Sanitizing fixes
  THIS poison; the skip list is what keeps the NEXT one from holding the queue.
  `embed.failed.<id>` in meta, excluded from `missingVectors`, named by
  `skippedVectorIds()` and printed by `verify` — a give-up nobody can read is
  indistinguishable from a coverage number that has stopped meaning anything.
  The counter climbs ONLY when the fill blamed one input (a 400 the bisector
  narrowed to a single item). The first cut counted every failure, and that made
  the watchdog's own abort — which fails the whole window, every time — retire
  sixty-four healthy rows after three bad boundaries while `unembeddedCount`
  read COMPLETE: I33 inverted, and the coverage watch failing upward, which is
  the one direction it may never fail in.
- **A skip needs a way out that a skip cannot close.** The counter is cleared by
  a run that lands, and a skipped id is never offered to a run — so
  `verify --retry-skipped` is the door: it clears every counter, names the ids,
  and writes nothing else. `rebuildCache` is not that door; it has no embedder
  and never touches meta.

## The warning reaches the terminal, and one command repairs it (I32's close, 2026-09-14)

The owner's ruling on 2026-09-11 was one sentence: **the warning must reach the
USER's terminal.** #95 made the spawn refusals durable and persisted the
escalation counter; the evidence existed, and nothing said it out loud. This is
the half that does.

**The channel, measured and then documented.** The owner ran a probe on
2026-09-11: a SessionStart hook that exits 0 and prints JSON with a top-level
`systemMessage` gets that text DISPLAYED in the terminal (`SessionStart:startup
says: …`), non-blocking, while `additionalContext` and stderr do not show. The
current hooks reference — https://code.claude.com/docs/en/hooks (the old
docs.claude.com path 301s there) — says the same thing and adds the rule that
decides the shape: **when a hook's stdout parses as JSON, the raw stdout is NOT
also added to context; only the JSON's fields are.** The exact names, verbatim
from that page: `systemMessage` ("A message shown to Claude in the UI. For most
events, this is added as a system message in the conversation."), and for
SessionStart `hookSpecificOutput: { hookEventName: "SessionStart",
additionalContext: "string to add to Claude's context" }`, with plain-text stdout
added as context for `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`
and `PostModelSwitch` and only those.

So: the wake rides ENTIRELY in `additionalContext`, byte for byte what plain
stdout would have carried, and **a day with nothing red prints the plain form it
has printed since day 0**. The JSON wrapper is a transport that has been measured
once, on one host, by one probe; a healthy session does not get to be the place
it is tried again. `hostDelivery` stays pure, takes the notice as an argument,
and a test holds the two forms to each other.

**Red only, and only at SessionStart.** Amber is `doctor`'s to print; a notice
that fired on one un-embedded memory is a notice people learn to scroll past, and
the owner asked for a warning, not a nag. Nothing at all on
`user-prompt-submit` — that hook fires every turn.

**The reading is bounded and cannot fail the wake.** `doctor.ts` is one library,
called by the console and by `ClaudeCodeAdapter#notice`, so the two cannot
disagree about what red means. At session start it runs under a 150 ms budget
(the credit seam's number, for the same reason), checked BETWEEN finding groups —
config, credentials and the checkout first, because those carry I32's own
signature — and what the budget cut off is a finding rather than an omission.
Every failure returns null and leaves one `adapter.doctor.failed` ring row; an
observer returns null before any read.

**The one thing the console does differently from the hook, and it is the whole
point.** The console loads the credentials file against a SCRATCH environment, so
what it reports is what the FILE holds. Counting its own shell would have read
green all week on the owner's machine — his `~/.zshrc` exports both names, and
hook processes inherit neither (measured day 0). What the shell has and the file
lacks is reported as its own clause instead. The hook hands in its own load,
whose `skippedPresent` names what ITS environment answered, because there the
environment is the environment the worker will be spawned with.

**`credentials set` writes the value nowhere it can be read back.** Not argv
(argv is shell history, and a key in shell history is a key on disk in plaintext
forever), not stdout, not an error. stdin, or one named environment variable, and
the console says `set <NAME> in <path>`. The mode is set twice — `writeFileSync`'s
`mode` applies only on create, so `chmodSync` is what actually holds the 0600
promise on a file that was already there.

## Which checkout is live (2026-09-14)

The hooks are invoked BY ABSOLUTE PATH out of `~/.claude/settings.json`, so the
install tree's working state is the memory layer the owner is using. Twice in one
day that mattered: a peer session developed a branch in that tree and it was live
for seven minutes, and after a merge the tree sat DETACHED at an older sha for
thirty minutes while "it's merged" was true of the remote and false of the
machine.

So `doctor` grades the checkout, and the grade is against the local
`refs/remotes/origin/master` as last fetched — never the local `master` branch,
and never by fetching (a network call on a foreground hook is the one thing the
wake's contract forbids). HEAD IS origin/master, branch or detached, is GREEN:
detached at origin/master is the deploy state, not a fault. An ancestor of it is
AMBER (`behind`, with the count) — old code, but merged code. Anything else is
RED, and tracked modifications are RED wherever HEAD sits. `--untracked-files=no`
on purpose: the shared tree carries untracked files by design, and they change
nothing about what runs.

The root comes from the RUNNING CODE's own path (`import.meta.url` up to the
package root) and from no configuration value — that is what makes the hook grade
the install tree and a console run from a worktree grade the worktree, each
correctly. Every git call is `spawnSync` with a 2 s timeout and never throws; a
git that will not answer, and a repository with no `origin/master`, are neutral
and leave no row.

One durable `adapter.checkout` row per session start — reason, branch, short sha,
tracked-modification count, `behindBy`, `originMaster`, date — latched per
date+head+dirty, so a day on master leaves one row and a day that wandered leaves
one per state. The daily's split is `adapter.checkout:off-master` (every reason
but `master`), so "what code produced this day's numbers" is answerable from the
record instead of from memory.
