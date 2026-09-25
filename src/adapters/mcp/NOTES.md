# `adapters/mcp/` — NOTES

*Decisions taken while building, and the ones deliberately left open. Working
defaults, revisable without ceremony (constitution 13).*

## Built

`protocol.ts` (JSON-RPC 2.0 framing) · `tools.ts` (the registry that makes a
description auditable) · `deliberate.ts` (the deeper look) · `server.ts` (message
dispatch and the four tools) · `stdio.ts` (the pump) · `bin/serve.ts` (entry).
No SDK, no dependency: the wire is ~160 lines because newline-delimited JSON-RPC
is a small thing to write and a large thing to depend on.

## Four tools, and why not three

The contract says three verbs. `session_end` is the fourth because
`claude-code/INTERFACE-GAPS.md` §7 filed a live gap: the boundary raises an
Stop ask into the model's context, and a hook cannot receive the answer.
In this host, the return channel is a tool. Without it, `Counterpart.submitSessionEnd`
— the primary path by which memory is supposed to form — is reachable only by a
caller holding the object, and the crash fallback silently carries the whole
load.

It is deliberately NOT a general "write a memory" tool: it is bound to one
session at launch, and it refuses when unbound. That refusal is what keeps it
from becoming the second front door CONTRACT §7 OQ1 warns about.

## Open, and left open

1. **OQ1 — does `note` still need to exist?** Both `note` and `session_end` now
   ship, which is two doors to one room. The answer will come from telemetry:
   `mcp.note` versus `mcp.session_end` counts over real use. If the dump carries
   everything, `note` is the one to drop.
2. **OQ3 — tier name or number?** Shipped as NAMES (`vivid`/`quiet`/`dim`), with
   the meaning of each spelled out in the payload. A number would imply a
   calibration nobody has done (scar §2.8).
3. **Confidentiality has no writer** — see INTERFACE-GAPS §2. Owner call.
4. **Protocol versions** are a hardcoded list. When the MCP spec moves, adding a
   string to `PROTOCOL_VERSIONS` is the whole change; unknown versions already
   negotiate down rather than failing.

## Not built, on purpose

- **No self-authorship tool** (§4 — superseded by experiencer authorship).
- **No `protected.add`** (§4, and the module-map Rulings list it under settled
  drops).
- **No tool that writes an entity, a belief, or a revision.** Entities are born
  by mention; revision is `updates:` plus arithmetic. `session_end` accepts an
  `updates` field on an entry, which is the experiencer DECLARING a revision, not
  a tool performing one — the arithmetic still happens in `physics/`.
- **No `tools/list` change notifications, no resources, no prompts.** The
  capability block advertises `tools` only.

## Host wiring the owner still has to do

`package.json` has no `bin` entry for the server (this build was scoped to
`src/adapters/mcp/`, `src/adapters/cli/` and their two test files). A host
registers it as:

```
bun run <repo>/src/adapters/mcp/bin/serve.ts --session <id> --scope <project dir>
```

Neither flag is reachable on Claude Code, which registers MCP servers from a static
configuration. Without `--scope` the server resolves `CLAUDE_PROJECT_DIR` and then its
own working directory (`server.ts#hostScope`) — the first of those is the one the hooks
also file a session under, which is what makes a deposit's coverage land on the spans it
covers rather than in another directory.

`--owner` marks the owner's own session (confidential material is returned only
there); `--observer` stands every tool down over the wire.

## Verified live? No — and the suite says so

Every test here runs against a temp store with a faked stdin. Nothing has spoken
to a real MCP client. Per CLAUDE.md's definition of done, that makes this
**merged, not verified**: the outstanding proof is one real host completing a
handshake, listing the tools, and calling `session_end` at a real boundary.

## The configuration is named the same way everywhere now (2026-09-05)

`bin/serve.ts` read `~/.counterparts/claude-code.json` and nothing else, which is
how the cold-stranger critic of 2026-09-04 came to embed on the owner's key: the
store was redirected with `COUNTERPARTS_DATA_DIR` and the credentials were not,
because there was no way to redirect them.

The rule is `adapters/config-path.ts`, shared with the hook, the worker and the
console: `--config <absolute path>`, else `COUNTERPARTS_CONFIG`, else the same
default as before. **The environment variable exists FOR THIS ENTRY POINT.** This
host registers an MCP server from a static configuration — command, args, env —
so there is no command line for an operator to add a flag to; `-e
COUNTERPARTS_CONFIG=…` in the `claude mcp add` line is the only channel, and
`counterparts install --config` prints exactly that line.

Two properties, both deliberate:

- **The store is still not decided here.** `--dir` / `COUNTERPARTS_DATA_DIR` /
  the default choose the store; the configuration answers "whose keys, whose
  embedder knob". Reading `config.dataDir` here would quietly fix half of
  QUICKSTART §11.3 and leave the docs claiming the other half.
- **A named configuration that cannot be honoured refuses the launch** — exit 1,
  the reason on stderr — rather than falling back to a default that, on a machine
  with an install, is somebody else's keys. "Cannot be honoured" includes an
  absolute path to a file that is not there, which the first version honoured
  silently (`claude-code/NOTES.md` §11). The server also writes the file it
  read to stderr at every launch, before a byte of protocol: stdout is the wire.

## 2026-09-10 — `COUNTERPARTS_OBSERVER` and `COUNTERPARTS_OWNER` learn the guard's vocabulary

**The defect (LAUNCH-STATUS G39).** `launchOptions` matched both stance variables
by exact, untrimmed string — `"1"` or `"true"` — through a single `flag()`
closure. One directory over, `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` accepts
`1|true|on`, trimmed and case-insensitive, and `store/paths.ts` describes itself
in a comment as *"a SUPERSET of the two `COUNTERPARTS_OBSERVER` accepts"*. That
sentence is an invitation to reason by analogy, and a person who did — exporting
`COUNTERPARTS_OBSERVER=on`, or `=True`, or with a stray space — got an **ordinary**
server: the stance they were trying to leave. The console had the identical bug
in `cli/commands.ts`.

**Why it was deferred, and why it is not any more.** #80 widened the guard and
promised to leave this launch path instruction-for-instruction identical, so
`store/NOTES.md` recorded the mismatch and said widening observer *"is a
behaviour change to an unrelated variable and wants its own ruling"*. G39 is that
ruling (HANDOFF 2026-09-08, follow-up 4).

**The shape.** `adapters/stance-env.ts` — beside `config-path.ts`, at the level
both the console and this entry point already share — imports
`EXPLICIT_DIR_ARMING_VALUES` and `EXPLICIT_DIR_DISARMING_VALUES` rather than
retyping them. Two lists that must agree and are written twice have already begun
to disagree; that is what this whole entry is about.

**The two fail directions are opposite, and both are "less power."** Observer
collapses an unreadable value to **observer** — `docs/observer-mode.md` G5, "fail
toward standing down", already mechanized in `core/observer.ts`, where a
non-boolean stance field resolves to observer rather than to "encode anyway".
Owner collapses it to **not owner**. Same helper, one line apart, because the
polarity of the boolean is opposite: `owner` grants reach and `observer`
withholds it, so least privilege is `false` for one and `true` for the other.

Note that observer's junk handling is deliberately **not** the guard's. The
explicit-dir guard REFUSES junk, because refusing is fail-closed for a thing
whose job is to stop a run. A stance's job is to withhold writes, so standing
down is fail-closed for it — and the failure is far cheaper: a refused MCP server
answers nothing and the host reports only "MCP server failed", while a stood-down
one answers every read. Junk is never silent either way: `launchOptions` returns
`unreadable`, a list of ready-made lines, and `main` prints them on stderr before
anything else (stdout is the wire). Keeping the printing outside `launchOptions`
is what keeps that function the one thing here a test can call over a fresh
object with no process involved.

**Still owed, in core, for the owner:** three comments now describe the world
before this ruling and call the guard's word lists a superset —
`store/paths.ts` above `EXPLICIT_DIR_ARMING_VALUES`, `store/NOTES.md`
2026-09-05, and `store/CONTRACT.md` §5. They are text, not behaviour.

## 2026-09-20 — `mcp.recall`, the first durable row this adapter has ever written

`docs/recall-surfacing-diagnosis-2026-09-18.md` put it plainly: the whole tool surface
wrote no durable row. `deliberate.ts` ran every time a session went looking for something
on purpose and left nothing but an in-process ring, so "the session asked and nothing came
back" and "the session never asked" were the same silence, and `fired` could only mark the
mechanism blind.

One row per `recall` call, through `Counterpart.noteAdapterEvent` like every other adapter
fact, so an observer stands down at the core's own seam rather than by a check here.

**What it carries, and what it deliberately does not.** Counts, verdicts, sizes. Never the
question — `queryChars` is its LENGTH, because a deliberate question is the one string on
this path that could carry somebody's private words and a row read months later may not
hold it (scar §2.20). And no memory ids: the counts answer this row's question, and a
durable pairing of ids with the moment somebody asked for them is a link the store has no
need of. `recall.credit` carries ids because crediting is *about* those ids; this is not.

**`blockedBy` carries `confidential-withheld`. THREE audiences, not two.** An adversarial
review corrected the first version of this note, which said "the durable row" versus "the
wire" and missed the third.

1. **The wire** — whoever called the tool, who may be any session. Silent, unchanged:
   §9.1 G5's rule is that a list announcing its gaps leaks their existence, and
   `answerQuestion` still `continue`s past the verdict before building `memories`.
2. **The durable row** — the owner, reading their own store, where the memory itself is
   already sitting. It carries the count, keyed by verdict name and nothing else. Without
   it the confidentiality gate stays exactly as unreadable as the 2026-09-17 inventory
   found it: "a withholding that happened and one that never had to are the same absence."
3. **A SCREEN** — the dashboard's narration and the `fired` view. Silent, and this was the
   correction: the first version printed "1 more was kept out (confidential-withheld)" in
   plain English on a page. No id, no title, no body — but a page gets screenshotted,
   screen-shared and demoed, and that sentence is the gap announced. `narrate.ts`'s
   `UNNAMEABLE_VERDICTS` folds it into an unnamed total ("kept out by a gate"), and
   `fired.ts`'s reader for this row counts only `dim-cap:*`.

The rule that came out of it, worth keeping: **the row records it; no renderer names it.**

**The row is inside `operational.sqlite`**, so it travels in any `backup` or snapshot like
every other event row. No `export` surface serialises the event log.

**No `dedupKey`.** A tool call is a deliberate act by a session, bounded by the host's own
tool budget — not a boundary that repeats on a timer. The spawn seam's rows are latched
because they fire at every boundary; this one is not.

One test narrowed with it, and it was hiding something: "recall writes nothing"
fingerprinted `operational.sqlite`, which has been in WAL mode since F1 — the file is
unchanged whatever is written to it until a checkpoint, so that assertion proved nothing
either way. It now asserts what §9.1 G4 actually guarantees: no memory, no version, no
use, no `recall.decision` row.

## 2026-09-21 — a handoff with no memories is not an error (new-user finding 12)

`session_end` refused `memories-required` for a call that carried a `handoff` and an empty
`memories` array — after the handoff had already been written. The Stop ask's own last
line says "nothing worth keeping is a real answer", so the door was contradicting the
invitation, and a model that reads its own result learns from that either to stop sending
handoffs or to invent a memory.

Three cases now, and only the first is new:

- a handoff that LANDED (written, revised or cleared) with no memories → success,
  `reason: "handoff-only"`, `deposited: 0`, no `isError`;
- a handoff that was sent and REFUSED (`no-scope`, `too-large`, `not-text`,
  `nothing-to-clear`) with no memories → nothing landed, so `memories-required` stands and
  the handoff's own outcome rides out on it;
- neither — and a `memories` that is not an array, because a caller who sent the wrong
  TYPE wants to be told → `memories-required`, exactly as before.

The gate is the handoff's OUTCOME (`written === true`) and not its presence, which is the
distinction the first draft of this would have got wrong.

The other half of the finding — "the published schema does not list `handoff`" — was
already false on master: `handoff` has been in `SESSION_END.inputSchema` since E1
(`d6eea0a`), `toolDefinitions()` publishes `spec.inputSchema` unfiltered, and
`test/handoff.test.ts` asserts it. `memories` stays `required` in the schema: a
handoff-only call sends `memories: []`, which that requirement already permits.

## 2026-09-23 — the unrestarted server: the schema gate, the launch record, the notice (roadmap E)

**The hazard.** The host starts this server once per session and keeps it; the hooks are
fresh processes at every event. After an upgrade the hooks run the new build and this
server keeps the one it loaded (LAUNCH-STATUS I36). If the new build bumps a schema, the
first hook to open the store migrates it — and `SCHEMA_AHEAD`, which is decided at OPEN,
never runs here again, because this process opened the store before the migration and
still holds the handle. Nothing had bumped a schema since the floor, so nothing had hit
this yet; the owner's rule (2026-09-23) was to decide it before the first bump.

**THE RELEASE CONSTRAINT — read this before shipping E (#187 review, MAJOR-1).** Everything
below protects the upgrade AFTER the one that installs it. A server started on 0.2.0 has no
gate and writes no launch record, so on the upgrade that brings E it neither refuses nor
records itself. The stamp below makes the hook say so once, but a pre-E server keeps
running its old code until the session reconnects — and if the same release bumps a schema
(the roadmap's C1 plans a cache v5 in that round), that old code meets the migrated store
first. So: **the 0.3.0 upgrade instruction is: quit every Claude Code session before
installing.** (Or `/mcp` → Reconnect each one straight after; quitting is the one that
cannot be half-done.) From the release after that, the gate and the notice cover it.

**The rule, built (`server.ts#schemaGate`).** Every tool call re-reads box 2's
`meta.schemaVersion` and box 3's `cache_meta.schemaVersion` on the handles this process
already holds (`Store.schemaVersions()`, two primary-key reads, statements prepared once).
Either one AHEAD of the code this process loaded refuses EVERY tool — `scope` and `status`
included, before the scope gate, the stand-down, or any argument is looked at — with one
sentence, `STALE_SERVER_REFUSAL`, which ends in the same remedy as the hook's notice.
**And at every write.** Three tools can WAIT between that entry check and their writes:
`recall` embeds its question in line (the review's MAJOR-3: with a real embedder the window
was the embed latency, and the stale server wrote its `mcp.recall` row into the migrated
store), and `note` and `session_end` embed at write time — `session_end` once per entry, in
a loop — whenever this server's counterpart has a live embedder (the re-review's N5; today
`openServer` hands it none, so those awaits settle as microtasks, but that is an accident of
wiring, not a rule). So the server installs a WRITE GUARD on its store
(`Store.guardWrites`): before every write the store makes for this server — every
`WRITE_METHODS` site, after the stance check and before the transaction — the same two
stamps are read again (~3 µs a write), and a stale one throws there, stages nothing, and
turns the whole call into the same refusal (`at: "write"` on the ring row). `recall` also
asks straight after its await, so the read and the handle log are skipped too. Entries a
`session_end` wrote BEFORE the migration landed stay: they went into the old schema before
the migration, which carried them. A stamp that cannot be
read at all (a table another build dropped) refuses under `schema-unreadable`; a store
LOCKED past the busy timeout (`db.ts#isLocked`, the hooks' own test) refuses under
`store-busy` with a retry, not a reconnect that would not fix it. Behind, absent or
non-numeric is NOT refused: an older store is the hooks' to migrate, as before. (The
comparison is a local `schemaAhead` in `server.ts`; #190 exports a strict one from the
store, and when it merges this should import that instead — a TODO marks the spot.) No refusal
writes — its event goes to this process's ring and the host's `onEvent`, never to the
store — and `test/schema-gate.test.ts` proves that from a SEPARATE connection: row counts
in every table of both files, the `events` table, `PRAGMA data_version` (which moves when
any other connection commits), every host-state file under the data dir, and the scope
registry `scope` would have written. The same calls on a current store each do their work
(the control), so the census can see a write.

It SEES the other process's migration because neither read runs inside a transaction:
each statement starts a fresh read on the connection and reads what was last committed,
WAL or not.

**Cost, measured** (bun 1.3.10, Apple M3 Pro, a store of 2,000 memories, 20,000 reads):
**mean 3.3 µs, p99 4.7–5.3 µs** per call for both stamps together; **mean 7.7–9.1 µs**
when another connection has just committed (the WAL index is re-read); the first call,
which prepares the two statements, **85–111 µs**, once per process. Two to three orders of
magnitude under the millisecond the ruling allowed. The suite asserts the mean stays
under 1 ms over 5,000 reads — generous on purpose, so a loaded machine cannot make it
flaky.

**The launch record (decision 1, and where it had to bend).** The ruling said the server
writes its version "into the live-session record at launch". It cannot: at launch this
process does not know its session — the host registers it from a static configuration and
passes none (`bin/serve.ts`'s header), and the lazy bind happens at the first Stop ask it
answers. So the server writes its OWN record into the live-session registry instead:
`<dataDir>/sessions/mcp-server@<pid>.json` = `{ pid, hostPid, scope, startedAt, build:
{ version, storeSchema, cacheSchema } }` (`server.ts#recordLaunch`, called once by
`bin/serve.ts`; removed at a clean exit). `version` is `package.json#version` read beside the
code; the two schema numbers are the constants this process loaded. The `@` keeps the file
out of `isSessionId`'s alphabet, so no session id and no model-supplied claim can name it.
Two kinds of server write none: an observer, and — the review's MAJOR-2 — a server whose
directory is set `off` or `paused`, whose own refusal there says "nothing is recorded or
read here" (and whose hooks return before they could ask anyway). That is followed for the
server's whole life, not only at launch (the re-review's N2): each heartbeat re-reads the
setting, takes the record away when the directory goes off and writes it back — the same
record, identity fixed at launch — when it comes on, including for a server that was
launched off.

A HEARTBEAT pins the record to the process rather than to a pid (MINOR-3): an unref'd
timer touches the file every `SERVER_HEARTBEAT_MS` (a minute), and a record is believed
only while its pid runs AND its mtime is inside `SERVER_STALE_MS` (ten minutes)
(`sessions.ts#serverBelieved`). A pid the OS hands to a stranger after a hard kill stops
counting within ten minutes, and `pruneSessions` (SessionStart) removes it then. A server
whose record was pruned while its laptop slept writes it again at its next beat; the beat
never creates a directory.

**The stamp (MAJOR-1's code half).** Every session record a hook on this build CREATES —
at SessionStart, a Stop, the seal, SessionEnd — carries `opened: { build, hookPpid }`
(`recordSession`, when there was no record before). That is what makes "no stamp" mean one
thing only, a record a build before E wrote; the first cut stamped at SessionStart alone,
and a record first created at a Stop (a directory switched on mid-session, a SessionStart
that stood down) read as pre-E and printed a false "was updated" — the re-review's N1,
now a test through the real hook processes. When a session OPENS — SessionStart at
`startup`, `resume`, `clear` or `fork`, never `compact`, which is the same session and the
same server carrying on — the hook refreshes the stamp (`sessions.ts#stampSessionOpened`),
AFTER the wake is written, and the refresh CLEARS `updateNoticeShown` (N3): an open is
often a new host and so a new server, and a session `--resume`d onto a fresh host must be
told about THAT server. `clear` and `fork` are stamped too, beyond the review's
`startup|resume`, because an unstamped `/clear` behind a non-`exec` shell would tell a
session with a CURRENT server it was out of date; the cost is one case — a pre-E server
whose session is cleared before its first prompt after the upgrade — which the old session
id's first prompt has normally already told. An in-process `/resume` keeps its server, so a
stale one there is announced once more — the same accepted cost as `/clear`. A session
record WITHOUT `opened` therefore means "written by a build before E", and the notice reads
that (below). `hookPpid` is also how a person checks the host match (the recipe, step 2).

**The notice (`sessions.ts#decideUpdateNotice`).** The UserPromptSubmit hook runs the
INSTALLED build every turn. In order: (1) the believed servers in this session's scope
whose `hostPid` is the hook's own parent — the same host process, so exactly this session's
server — decide when there are any; (2) otherwise a session with no `opened` stamp is due,
once — its server was started before E and may record nothing about itself; (3) otherwise
every believed server in the scope, and ANY stale one makes it due. Deciding writes
nothing; the mark is the other half (`markUpdateNoticeShown`), and `bin/hook.ts` orders the
two: decide, build the turn's output with the line in it, and only if that output really
carries it, mark the session record `updateNoticeShown: true` — then print, and print the
line only if the mark landed. So it is shown once per session; a mark that will not write
is silence rather than a notice every turn; and a line the output could not carry is never
marked as shown. No session record → nothing (nowhere to mark). It never throws. A
downgrade — the server NEWER than what is installed — says `Counterparts was changed to an
older version. Run /mcp and Reconnect to load it.` instead of "was updated". Fallback (3)
can speak once to a session whose own server is current while a second session in the
same directory runs an old one; the advice is harmless, and it never stays silent about
this session's. `/clear` gives a new session id on the same server process, so a stale
server is announced once per `/clear` — accepted.

**Every mark merges into the record's RAW JSON** (`mergeIntoRecord`, MINOR-1), never
through `parseRecord`'s whitelist: the hooks' `recordSession` rewrites a record whole, which
is right for the newest code, but a write from a process on an older build — the
unrestarted MCP server above all — would erase every field a newer hook had added. That is
this notice's mark, SessionStart's stamp, and #186's `markNothingNew`, which the MCP server
itself writes at `session_end` and which was converted when this branch was rebased onto it.
A mark written this way keeps fields it does not know.

**The registry is not locked, and that is accepted** (the rest of MINOR-1). Every writer of
a session record — the hooks' `recordSession`, these marks, the server's `markNothingNew` —
is a read-modify-write with an atomic rename and no lock. Two that interleave can lose the
one field the slower did not read: an update notice shown a second time, a `nothingNewAt`
missing from one answer, a stamp missing until the session next opens. The events of one
session are sequential and the server's writes follow a Stop, so it takes two processes
within milliseconds of each other; every field in the record has lived with that since the
registry was written. The note is in `sessions.ts#mergeIntoRecord` too.

It runs **every turn, ~0.3 ms** — one `readdir` of `sessions/`, the session record, the
server records, a stat and a signal-0 per server; with a current server it never speaks, so
it is paid all session long — which departs from `pruneSessions`' "one `readdir` per
session, never per turn". Measured: **mean 0.26–0.31 ms, p99 0.4–0.56 ms** per turn
against a 601-entry `sessions/` with two live servers (bun 1.3.10, M3 Pro), inside a
UserPromptSubmit budget of 1,200 ms. `package.json#version` is read once per process by
`sessions.ts#installedVersion`, a second copy of `cli/commands.ts#packageVersion` kept
because an adapter leaf may not import the console.

**Where its decisions can be seen (MINOR-2).** The hook process lives for one event, so its
ring dies with it. On a turn that had something to decide — due, shown, mark-failed,
dropped, failed — `bin/hook.ts` copies the rows to stderr, the host's debug log:
`[counterparts] adapter.update.notice: {"reason":"due","matchedBy":"host","servers":1,"hookPpid":…}`.
A durable row would be a new `AdapterDurableEventName`, a core change this build did not
own. `test/hook-standdown.test.ts` proves the host match through the real process (the
hook's parent is the test process, as the host is in production when it `exec`s its hooks).

**The terminal (`bin/hook.ts`).** The adapter's doors are `ClaudeCodeAdapter#updateNotice`,
`#markUpdateNotice` and `#stampOpened`, beside `userPromptSubmit`; `bin/hook.ts` asks at
`user-prompt-submit` the way it asks `notice()` at `session-start`, and `hostDelivery` prints
the line as a top-level `systemMessage` — the channel the owner's probe of 2026-09-11
measured displaying at both events (`SAYS_SO_HOOKS`); the host's reference lists
`systemMessage` as a field every event accepts ("Warning message shown to the user"). The
turn's recall rides whole in `hookSpecificOutput.additionalContext` (`hookEventName:
"UserPromptSubmit"`); a turn with no recall prints the `systemMessage` alone; a prompt with
no notice prints exactly what it printed before. The size rule is SessionStart's: over
`ENVELOPE_MAX_CHARS` the recall wins, the plain recall is printed, the notice is dropped
with an `adapter.notice.dropped` row — and, because the mark follows the envelope, it is not
marked, so the next turn tries again. At a prompt the lines are ALL OR NOTHING — joined into
the one `systemMessage`, or all dropped; SessionStart's priority order is SessionStart's
alone — which is what lets the mark follow "the envelope carried it". Today there is one.

**Fail-open by construction, not only by each callee's own `try`** (the re-review's N4).
`bin/hook.ts#deliverTurn` computes the plain output first and returns it whenever anything
about the notice goes wrong — a door that throws, a mark that will not land — and the
SessionStart stamp runs AFTER the output is written (`stampWhenOpened`, swallowed if it
throws). Forced throws in all three doors leave the 474-byte healthy wake and a turn's
recall printing byte for byte (`test/hook-standdown.test.ts`, "the update notice is
fail-open"), and a structural test pins "written, then stamped" in `runHook`. (The host measures each JSON field against its cap
separately, so measuring the whole envelope is stricter than it needs to be — harmless at
the default 2,048-byte per-turn recall.)

**Does a snapshot precede a migration? No — checked, not built.** The migration runs in
`operational.ts#openOperational`, inside `Store`'s constructor, so the first process to OPEN
the store on the new build migrates it — and that is a hook (SessionStart or the first
prompt), not the worker. The automatic snapshot (`adapters/snapshots.ts#runSnapshot`, the
doctor's Snapshots line) runs only in the worker (`claude-code/bin/runner.ts`), in its
`finally`, after `Counterpart.open` has already opened — and so migrated — the store, and at
most once a day. So the newest pre-migration copy is whichever daily snapshot was taken
before the upgrade: yesterday's, or today's if a worker already ran today. `SCHEMA_AHEAD`
stays one-way, and rollback past a bump is that copy.

**Residuals, named rather than fixed.**

- **Microseconds wide, not zero.** The write guard reads the stamps just before a write's
  transaction opens, not inside it; a migration that commits in those microseconds is not
  caught. A migration takes the write lock, so the old write serializes after it and lands
  in the new schema — harmless for the additive migrations `ADDED_COLUMNS` makes, not for a
  destructive one. Host-state FILES a tool writes (the span buffer, the handle log) are not
  store writes and are not guarded; the entry check covers them.
- **A store that is MOVED or REPLACED is invisible to the handle.** `counterparts
  start-fresh` renames the store directory: the old server's handles follow the parked
  inode, the gate passes (the parked stamp never moves), and its writes land in the parked
  store. Its launch record moves into the parked `sessions/` with the directory — and then
  the next heartbeat writes it again at the ORIGINAL path, in the fresh store's `sessions/`
  once that exists, so the fresh store shows a live server of the same build, which is
  true and harmless (the re-review's NIT). A future build that replaced the database file
  would do the same. `start-fresh`'s
  own liveness read (`cli/start-fresh.ts#readLiveness`) skips `mcp-server@*.json`, because
  a server record has no `lastBoundaryAt` — yet a believed server record is the one sign of
  an open session that stays true while it is idle. Filed in INTERFACE-GAPS §10.
- **A server the host kills outright leaves its record.** It stops being believed when its
  pid dies or its heartbeat goes stale (ten minutes), and is pruned at the next
  SessionStart. Inside those ten minutes a reused pid could cost one needless notice per
  session in that directory.
- **`cache.ts#openCache` stamps an AHEAD cache backwards** instead of refusing it (it
  re-runs the DDL on any version that differs). The unrestarted server never reopens, so
  this is not the gate's hole — it is a downgrade's. `cache.ts` belongs to another build;
  filed in INTERFACE-GAPS §10.

### Reconnect — a recipe for the owner, run once (nobody has run `/mcp` → Reconnect yet)

Everything here lives under one throwaway directory, `$T`. It never names
`~/.counterparts`, `~/.counterparts/claude-code.json` or the user-scoped `counterparts`
server, and it writes nothing outside `$T`. Run it after this round's build is what
`counterparts --version` reports (the installed `counterparts-hook` and `counterparts-mcp`
are what it starts) — an install from before this change prints no notice at step 4.

**1. A throwaway store, configuration, project, hooks and server.**

```sh
export COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1
T="$(mktemp -d /tmp/cp-reconnect.XXXXXX)"
mkdir -p "$T/project/.claude" "$T/cp/store" "$T/claude-home"
printf '{ "dataDir": "%s", "owner": true }\n' "$T/cp/store" > "$T/cp/claude-code.json"
HOOK="$(command -v counterparts-hook)"; MCP="$(command -v counterparts-mcp)"
cat > "$T/project/.claude/settings.json" <<JSON
{ "hooks": {
  "SessionStart":     [{ "hooks": [{ "type": "command", "command": "\"$HOOK\" --config \"$T/cp/claude-code.json\"" }] }],
  "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "\"$HOOK\" --config \"$T/cp/claude-code.json\"" }] }],
  "Stop":             [{ "hooks": [{ "type": "command", "command": "\"$HOOK\" --config \"$T/cp/claude-code.json\"" }] }]
} }
JSON
cat > "$T/mcp.json" <<JSON
{ "mcpServers": { "counterparts-trial": {
  "type": "stdio", "command": "$MCP",
  "args": ["--dir", "$T/cp/store", "--config", "$T/cp/claude-code.json"],
  "env": { "COUNTERPARTS_REQUIRE_EXPLICIT_DIR": "1" }
} } }
JSON
```

**2. Start a session that reads none of your own configuration.** `CLAUDE_CONFIG_DIR`
moves the host's user-level files (so your user hooks and your user-scoped `counterparts`
server are not read); `--strict-mcp-config` loads only the trial server. Both are what the
host's docs say; neither has been tried here. If the relocated config dir asks you to log
in, that is expected. There is no second route: every other way of starting a session in
`$T/project` runs your own user-level hooks against your live store. If logging in there
is not acceptable, stop here and say so.

```sh
cd "$T/project" && CLAUDE_CONFIG_DIR="$T/claude-home" claude --strict-mcp-config --mcp-config "$T/mcp.json"
```

Accept the trust prompt. SessionStart may ask the first-launch scope question for this
directory; answer it or ignore it. Send `hello`, then in another terminal (same `$T`):

```sh
ls "$T/cp/store/sessions/"                      # <session-id>.json and mcp-server@<pid>.json
cat "$T/cp/store/sessions/"mcp-server@*.json    # pid, hostPid, scope, build {version, storeSchema, cacheSchema}
for f in "$T/cp/store/sessions/"mcp-server@*.json; do p="${f##*@}"; ps -o pid,ppid,command -p "${p%.json}"; done
grep -o '"opened":{[^}]*}[^}]*}' "$T/cp/store/sessions/"[!m]*.json   # the session's stamp: build, hookPpid
```

There should be exactly ONE `mcp-server@…` file; two means an earlier server's record was
left behind (look at which pid `ps` still finds). `build.version` should equal `counterparts
--version`, and `hostPid` should be the `claude` process. **Write down whether the session's
`opened.hookPpid` equals the server's `hostPid`:** equal means this host `exec`s its hooks
and the notice matches this session's own server exactly; different means it matches by
directory (still correct for one session; it can speak once for a sibling's server).

*If `/mcp` (step 5) offers no Reconnect for a server loaded with `--mcp-config`* — the
host's docs do not say it does — register the trial server at PROJECT scope instead and
start without the two flags: from inside `$T/project`, `CLAUDE_CONFIG_DIR="$T/claude-home"
claude mcp add -s project counterparts-trial -e COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 --
"$MCP" --dir "$T/cp/store" --config "$T/cp/claude-code.json"` (it writes
`$T/project/.mcp.json`, which dies with `$T`), then `CLAUDE_CONFIG_DIR="$T/claude-home"
claude` and approve the project server when asked.

**3. Pretend the install moved on.** The server wrote its record at launch and only
touches its mtime after that (the heartbeat); the hook compares it with the installed
build every turn. Make the record say an older version:

```sh
F="$(ls "$T/cp/store/sessions/"mcp-server@*.json)"; OLD_PID="${F##*@}"; OLD_PID="${OLD_PID%.json}"
sed -i '' 's/"version":"[^"]*"/"version":"0.0.0"/' "$F"
```

**4. The notice.** Send any prompt. Expected: ONE line in the terminal, the host's prefix
and then `Counterparts was updated. Run /mcp and Reconnect to load it.` (This rests on the
owner's own probe of 2026-09-11, which is why `bin/hook.ts#SAYS_SO_HOOKS` names that
event; the host's reference lists `systemMessage` for every event. If nothing shows, that
is the finding to write down.) Send two more prompts: nothing more. The session record now
carries `"updateNoticeShown":true` (`cat "$T/cp/store/sessions/"<session-id>.json`).

**5. Reconnect.** `/mcp` → `counterparts-trial` → Reconnect. Then:

```sh
ls "$T/cp/store/sessions/"            # a NEW mcp-server@<pid>.json; the old one gone (a clean exit removes it)
ps -p "$OLD_PID" || echo "old server gone"
cat "$T/cp/store/sessions/"mcp-server@*.json   # version back to the installed one
```

and ask the session to call the trial server's `status` tool: it should answer. Worth
writing down: whether the old pid was gone, and whether its record was removed (a clean
exit) or left behind (the host killed it; it stops being believed within ten minutes and
SessionStart prunes it).

**6. Optional — the gate itself, live.** Pretend a newer build migrated the store:

```sh
DB="$T/cp/store/counterparts.sqlite"
V="$(sqlite3 "$DB" "SELECT value FROM meta WHERE key = 'schemaVersion'")"
sqlite3 "$DB" "UPDATE meta SET value = '99' WHERE key = 'schemaVersion'"
```

Ask the session to call `status`: it should refuse with `Counterparts was updated and this
server is still running the old version, so this tool did nothing. Run /mcp and Reconnect
to load it.` The hooks now refuse to open the store too (`SCHEMA_AHEAD` at open, the red
"memory is OFF" line), because nothing newer actually exists — put the stamp back before
anything else: `sqlite3 "$DB" "UPDATE meta SET value = '$V' WHERE key = 'schemaVersion'"`.

**7. Clean up.** Quit the session; `rm -rf "$T"`. Nothing outside it was written.

## The write-up door (C2, 2026-09-23)

- **A field, not a tool.** `session_end` with `writeUp` is diverted to `write-up.ts` after
  the bind and before the handoff and the nothing-new mark are looked at. A sibling tool
  would have been a new approval for anyone who allowlisted the server's tools one by one,
  and `TOOL_NAMES` is pinned exactly. The per-entry deposit loop was EXTRACTED
  (`depositEntries`) rather than copied, so a write-up's entries cannot take a different
  road from an answer's.
- **The fetch leaves `memories` out, so the published schema no longer requires it**
  (PR #192 review, m2). The server still refuses a call that lands neither memories nor a
  handoff (`memories-required`), and on the write-up path `memories: []` with no fetch on
  record is read AS the fetch — so a host or model that sends the required-looking field
  anyway still gets the words. **Unmeasured on the real host:** no live session has yet
  shown whether Claude Code's model leaves `memories` out, sends `[]`, or both; either
  works, and the first real write-up is the measurement.
- **Whose words a write-up's memories cover is core's to say** (`SessionEndDepositContext.cover`,
  MAJOR 4). The door passes `false` on an earlier part — nothing covered, or parts not yet
  served would read as kept — and the ENDED session on the last part in a project, so the
  memories claim its words there under their own proposal ids and never the writer's own.
  `finish` then claims whatever is left of the ended session's words here (all of them
  after an empty last answer) under `writeup:<writer>`.
- **The words ride in the JSON result** (`text`, beside `part`, `of` and `next`), not under
  the hook's 10,000-character cap — the reason the SessionStart block became a pointer.
- **An unrestarted pre-C2 server ignores `writeUp`.** Its `session_end` drops the unknown
  field; a fetch reads as `memories-required`, and an answer deposits the memories as the
  WRITING session's ordinary answer without marking the ended one, which is then pointed
  at again. The build-mismatch notice (roadmap E) is what tells the person to reconnect.
- **The owner's removal of a write-up's memory** follows its coverage like any other: a
  memory from the LAST part in a project covers the ended session's words there, so
  removal's echo walk finds them; a memory from an earlier part covers nothing, and those
  words age out with the ended session's own seven days.
- **Duplicates count as landed**, and an empty batch is a real answer (owner, 2026-09-23):
  a batch whose every entry is `duplicate-content` says what the store already holds, and
  `[]` says nothing in the part was worth keeping. Only a non-empty batch the gate refused
  entirely (`nothing-landed`) leaves the part open.
- **A write-up's memories are the WRITING session's, and B3 reads them that way.** They
  are accepted `session-end` proposals under the live session's id, so if that session
  had already been asked at a Stop, `owes.ts` counts them as its answer to that ask. The
  pointer arrives at SessionStart, before any Stop ask, so the ordinary order is the
  harmless one; the other order is named, not guarded.

## Keyless (2026-09-24)

`bin/serve.ts` no longer loads a credentials file or warns about its mode: the only
embedder is the local table, so `questionEmbedder` reads the configuration and opens the
table (or nothing, when the configuration switches it off). The notes above about "whose
keys" a configuration answers are history — it now answers "whose embedder knob".

## 2026-09-25 — every row a tool writes names its model (schema v7)

`sessionModel()` reads the bound session's registry record — the relay `chapter` has used
since #217 — and `note`, each `session_end` entry (the write-up door's included),
`chapter` and `self_page` pass it down to the row's `model` column. Unbound (a `note`
before any tool named a session) it is undefined and the row records NULL. The schema gate
is unchanged and was checked against the 0.3.1 build on a store this build migrated: the
old server refuses every tool `schema-ahead` ("Run /mcp and Reconnect"). `status`'s
removal dates are the person's day (`localDate(at, store.zone())`), no longer UTC.
