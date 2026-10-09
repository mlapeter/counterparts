# `adapters/mcp/` — NOTES

*Decisions taken while building, and the ones deliberately left open. Working
defaults, revisable without ceremony (constitution 13).*

## Built

`protocol.ts` (JSON-RPC 2.0 framing) · `tools.ts` (the registry that makes a
description auditable) · `deliberate.ts` (the deeper look) · `server.ts` (message
dispatch and the tools — nine today: note, recall, status, session_end, chapter,
scope, self_page, dream, reflect) · `write-up.ts` (the next-session write-up's door)
· `stdio.ts` (the pump) · `bin/serve.ts` (entry). No SDK, no dependency: the wire is
~160 lines because newline-delimited JSON-RPC is a small thing to write and a large
thing to depend on.

## Four tools, and why not three

*(Written when there were four; the section's argument is about `session_end` and
still holds. The tools since are recorded where each was added, below.)*

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
- **No `tools/list` change notifications, no resources.** The capability block
  advertises `tools` only — to every client but Claude Desktop's, which since
  2026-09-30 is also offered one prompt ("Start with Counterparts") and an
  `instructions` line (below).

## Host wiring the owner still has to do

*(Now: `package.json` has the `counterparts-mcp` bin entry, and `counterparts install`
registers it with `claude mcp add`. The paragraph below is the state when this was
first built.)*

`package.json` had no `bin` entry for the server (this build was scoped to
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

## Verified live? Yes, since the parallel run

*(Updated 2026-09-30.)* When this was written nothing had spoken to a real MCP client.
It has since run as the owner's live memory from 2026-09-03, through Claude Code's
handshake, tool listing and real `session_end` / `chapter` calls at real boundaries, and
from the published package since 2026-09-21. The suite still runs against a temp store with
a faked stdin; the live record is the store's `mcp.*` and `adapter.*` rows, not a test.

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
- **A write-up's PROPOSALS are the WRITING session's, and B3 reads them that way** (the
  MEMORY is the ended session's since 2026-10-01: origin, lived date, `secondHand`). They
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

## 2026-09-25 — feelings on `note` and `session_end` (schema v7)

`feelings: [{ whose, core, emotion, strength, carried_by?, beneath? }]` on a `note` or a
`session_end` entry (`beneath` is another item's index). `readFeelings` reads and runs
the store's pure `checkFeelings` BEFORE the deposit, so a bad list refuses its note or
its one entry (`feelings-malformed`, naming the item and reason; siblings still run) and
no memory lands with its feelings dropped. After a mint, `recordFeelings` writes them
with the session's model and answers `feelings: { stored, other? }`; each `other` item
carries the nearest wheel keys and a one-line note to rewrite with. A throw there costs
the feelings, never the memory, and says so. No salience, decay or recall change.

### Review of #231 (2026-09-25)

- **`note` before a bind records NULL for `model`, and that is accepted (N3).** On the
  live host the server is launched with no `--session`, so `sessionModel()` has nothing
  to read until a `chapter` or `session_end` binds it. Other effects of the bind:
  - After `/model`, the first write is credited to the previous model; the record is
    refreshed at the next boundary.
  - A write is never credited to another session's model, because the bind is frozen for
    the life of the process.
- **S2 and S3.** `readFeelings` now works as follows:
  - It checks `whose`, `core`, `emotion`, `carried_by` and `other_word` are strings before
    anything else runs.
  - `checkFeelings` refuses an over-long `emotion` or `other_word` before any
    edit-distance scoring.
  - Any throw in the reader becomes that entry's `feelings-malformed`, so the siblings in
    a `session_end` still land.
  - At the door, `beneath` must be an integer index, so an id can no longer pass the door
    and fail only after the memory has minted.
  - `other_word` is now in the published schema, so the schema and the reader agree.
- **N6.** A note that did not land (a duplicate, a gate) answers
  `feelings: { stored: 0, reason: "memory-not-stored" }`.

## 2026-09-26 — `eventDate` and `remind` on `note` and `session_end` (PR B)

An optional `eventDate` (a day, a month, a year or an `a..b` range, read by
`time.ts#parseCalendarDate`) and `remind: "plain" | "quiet"` on a `note` and on every
`session_end` entry, the write-up door's included. `readReminder` checks both BEFORE
anything is captured or minted: an unreadable date refuses the note, or that one entry,
as `event-date-unreadable` with the four shapes in `detail`; anything but the two words is
`remind-unknown`. The model converts "late October" itself — nothing here, or anywhere,
reads a date out of the text. A deposit that landed answers `reminder: { eventDate,
remind }` (plus a note when the date is a bare year, which never comes back on its own);
`remind` sent with no date is dropped and said (`reminder: { ignored: "remind" }`), and
the memory still lands. The `remind` description carries the owner's plain-vs-quiet
guidance: plain for a real deadline or an important date, or when
the person says it matters; quiet otherwise. What happens after the deposit is
`prospective/` NOTES §12.

**Review, same day (owner decision):** an explicit `eventDate` now qualifies a quiet
reminder whatever its salience — choosing a date is itself the importance signal — so the
description no longer says "about 0.6". The salience floor still gates a date a caller
extracted; decay (faded) and archival still keep a memory from arriving.

**Follow-ups, same day (review N7, N8).** `eventDate` also takes `null` (the schema type is
now `["string", "null"]`): on a revision it drops the date. `readReminder` passes `remind`
through only when it was SENT, so `remember/intake` can tell a left-out mode from a stated
one (`DateIntent`). The echo reports what was RECORDED, not what was sent: a revision that
carried a date answers `reminder: { eventDate, remind, from, carriedOver }`, and one that
dropped it `reminder: { cleared: true, from }` (the carry itself is `core/counterpart.ts`,
`prospective/` NOTES §13). A date whose last day is before the person's today —
`time.ts#todayIn` in the store's zone, off this server's injectable clock — is kept and
answered with `note: "That date has already passed — it won't come back as a reminder."`;
that note wins over the bare-year one. A plain past date is indeed never said; a quiet one
could still be cued in the week of grace after it, which the note does not spell out —
its job is to let the model catch a wrong year. The carry runs only for an `updates`
address that resolved as an ID (`Store#resolve` is id-only): a handle or title falls to
content matching, which carries nothing — so the `eventDate` description says "by its id".

**After the adversarial review of #247.** `from` in a carried or cleared reply names the
memory the reminder came FROM, which is not always the id the author sent: when that
memory's reminder had already moved on, the carry follows it (`Counterpart#reminderHolder`,
prospective NOTES §13), so a cancel or a reschedule sent against the first id still lands.
A revision that sends `eventDate: null` and reaches no dated memory now answers
`reminder: { cleared: false, note }` instead of nothing; a fresh note sending `null` (no
`updates`) still answers nothing, since a client that fills every optional field with null
would otherwise get the note on every deposit.

## 2026-09-26 — `dream`, the eighth tool

One tool with phases (`launch`, `begin`, `propose`, `journal`, `decline`) because a
dream is one act in steps, and the audit wants every door enumerated. Every phase binds
the session (`requireBoundSession`): the dreamer is a background agent the session
launched, talking to this same server, and its writes belong to that session. `launch`
writes nothing and returns the prompt `dream/` composes; the in-session model hands it to
the Agent tool unchanged. `begin` returns the bundle as JSON behind the dream's mark;
`journal` returns the hand-back the dreamer must end on. Under observer every phase
stands down. The schema gate's "every tool refuses" fixture calls `launch`.


## 2026-09-27 — `reflect`, the ninth tool; `about` on the two doors

`reflect` has phases `launch`, `begin`, `finish`, `told`, each binding the session as
`dream` does; under observer every phase stands down, and `launch` writes nothing (the
schema gate's fixture calls it). `begin` returns the bundle behind the mark and plain
instructions (`how`); `finish` returns the hand-back the reflecting mind must end on, plus
what landed and what was refused, each by name. `dream`'s `journal` now answers with
`next` (reflect, or fall back to the hand-back) and `launch`'s `how` asks for the share to
be told in the session's own words, then `told`.

`note` and `session_end` entries take `about` (`me`, `us`, `owner`, `work`, `world`),
set after the memory lands (`about_by = writer`), the way feelings are. An unknown value
refuses that entry (`about-malformed`); a core mark on a `skill` memory is not stored and
the answer says why; a memory that did not land takes its mark with it and says so.

- **2026-09-27, owner ruling D3 on #256:** the entry point passes the host config's
  `pageWriter.mode` to `openServer` (beside `snapshotsDir` and `timeZone`), and on to
  `Counterpart.open({ pageWriterMode })`. `off` stops the reflection's page write; the
  reflection still keeps its entry and offers its share.

## 2026-09-27 — `traits` on `note`, `session_end` entries and `reflect finish`

Trait nudges (folded into v9, `store/traits.ts`; working defaults, held lightly):
`traits: [{ axis, toward, strength, carried_by? }]`, read and checked BEFORE the memory
mints, like feelings — an unknown axis, a pole of another axis, a strength outside 0..1
refuse that entry as `traits-malformed`, with what is allowed (and, for a pole given on
the wrong axis, which axis it belongs to). After the memory lands the nudges are written
through `Counterpart#addTraits` (secrets scrubbed from `carried_by`) and answered as
`traits: { stored }`; a memory that did not land says its nudges did not either. The
write-up door (`session_end` with `writeUp`) rides the same road, since it goes through
`depositEntries`. `reflect finish` passes `traits: [{ id, … }]` to the reflection and
answers what landed and what was refused, by name.

The tool text (`TRAITS_TEXT`, shared by the three doors) names all seven axes with both
poles, says "only when this memory really shows how you acted; most carry none" and
"Don't make up depth", and says the nudges are shown on the dashboard only. The axis and
pole enums in `tools.ts` are literal (the tools file imports nothing from the core); a
test holds them equal to `TRAIT_AXES`.

## 2026-09-28 — recall by id reads whole, in parts (build B, held lightly)

By id, a body stopped at 4,000 characters with no way to read further, and the `budget` hint
promised "full bodies". Now: `ids` takes up to `RECALL_MAX_IDS` (10, was 3) — an index's
lines name this lookup, and a batch is its normal shape; each body comes a part of
`RECALL_BODY_CHARS` (8,000) at a time (`part: 2, 3, …`; `part` and `parts` on each memory;
the parts join back exactly); ids past `RECALL_ID_RESULT_CHARS` (40,000) wait, named, with the
call that fetches them. The list path is unchanged. The `mcp.recall` row counts expansions an
index offered only in part (`fromIndex`), per mechanism — `core/fit/`.

After the adversarial review of #278 (2026-09-28): the by-id room is measured on the SERIALISED
memories (pretty JSON, a non-ASCII character counted as three, both the text and the
`structuredContent` copy counted — a host may count both), `RECALL_ID_RESULT_CHARS` 56,000 in
those units; the old content cap came to ~73k on the wire. Lookups are counted from the ids the
result DELIVERED, once per index; an id is fetched whole only when its last part went out.


## 2026-09-29 — the bundle rides in structuredContent again

The first real headless run (PR #282) reported that "the dream and reflection bundles came back
to me as counts only". Cause: since acd5c9a (review of build B, after 0.3.6) the long `bundle`
rode only in the text content, with `bundleChars` in its place in `structuredContent` — and
Claude Code 2.1.284, when a result carries `structuredContent`, hands the model that
(serialized) and drops the text items (read in the host build's own result conversion). Every
dream and reflection on master was blind; 0.3.6 was not, which is why the in-session run on the
live store saw everything. The whole payload is now in both, and the fitting test measures the
structured copy against the ceiling too. `test/dreaming-headless.test.ts` opens a server from the
headless child's own `--mcp-config` env and checks the bodies reach `structuredContent`.

## 2026-09-29 — contradictions at the doors (held lightly)

- **`how` beside `updates`** on `note` and each `session_end` entry: `changed` (the
  default), `corrected`, `open`. Intake validates it (`HOW_UNKNOWN`) and drops one sent
  without `updates`. The result's `settled` says what happened — the pair, the kind, the
  cut (strength before and after) or the archive, flags it closed — or, when the writer
  sent a `how` at a belief, a core memory, a current-state fact, an entity or a protected
  memory, that it was not applied and which path ran.
- **Neighbours at write time**: a stored memory comes back with up to three of its
  nearest live memories (`neighbours`: id, title, excerpt) and one `neighboursHint` line
  (once per `session_end` call). In the PAYLOAD, so in `structuredContent`, which is what
  Claude Code hands the model (f387f55). Nothing when nothing clears the bar.
- **Settling a pair that exists: `note` with `settle`** (`pair` or `holds` + `over`,
  `how`, `why`), with or without `text`, rather than a new tool — every tool costs
  context, and `note` is already the deliberate door. `text` is no longer `required` in
  the published schema; the server still refuses `text-required` when neither is sent.
  When both are sent, `isError` follows the note. The reflection settles through its own
  phase (`reflect` phase `settle`) so the trail can name it.
- **Descriptions**: the `how` field says what each kind means and asks for the journey
  in the writer's own words. `session_end`'s two settle privileges sit at the end of its
  list, because the host serves the first 2,048 characters and the salience claims must
  stay inside them (`test/stop-ask-quiet.test.ts`).

### After the review of #284

- **Neighbours**: a `session_end` entry never lists a sibling written by the same call,
  and one call lists at most `NEIGHBOURS_PER_CALL` (12) across its entries (M1).
- **`note` with `text` and `settle`** is an error only when nothing landed (M2).
- **`already-settled`** tells a session to raise it with the owner, whose `counterparts
  settle --undo` it is; the owner is told to undo first (M3).
- **A `how` sent at a core memory** reports that pressure runs and that the pair is
  recorded unsettled meanwhile (M9). The published `note` schema has `required: []`;
  watch whether empty notes rise (M10).

## Claude Desktop's chat (2026-09-30, host groundwork PR B)

What the build learned and decided; the rules themselves are CONTRACT §5 G13–G16.

- **The client's name is the signal.** Desktop sends `clientInfo.name` `claude-ai` (chat)
  and `local-agent-mode-<entry>` (Cowork) at `initialize` (measured, design §10), and the
  same config entry is ALSO loaded by Desktop's Code tab, where the client is Claude Code.
  So `install --host claude-desktop` passes nothing that says "desktop": a flag would be
  false in the Code tab. The client's name decides, at `initialize`, and everything else
  stays exactly as a Claude Code client has always seen it (`test/desktop-chat.test.ts`
  pins the handshake, the nine tools and the `prompts/*` method-not-found). A belt under
  it: the Code tab's client name was never measured, so a process started by Claude Code
  (its environment carries `CLAUDE_PROJECT_DIR`, `CLAUDECODE` or `CLAUDE_CODE_ENTRYPOINT`)
  stays Claude Code's even if its client said `claude-ai`, and logs `mcp.host.kept`. If
  Cowork's server turns out to carry one of those, Cowork falls back to today's behaviour.
- **The place is a name.** `claude-desktop:` (`hosts.ts#DESKTOP_SCOPE`) is one pseudo-scope
  for every Desktop chat and Cowork (owner, 2026-09-30). It is never resolved against a
  working directory (`isPseudoScope` in `canonicalScope` and `canonicalScopePath`), and
  `scopes.json` accepts it as a key, so the `scope` tool can set Desktop on, observer or off.
  A launch that declared `--scope` keeps it.
- **Binding is per call.** The lazy bind froze one session for the life of the process;
  Desktop's one process serves every chat, so a Desktop call binds afresh each time — the
  id it names, else the most recent live Desktop session, and the result says so. Every
  bound call refreshes the record (`sessions.ts#touchDesktopSession`): with no hooks, a
  tool call is the only sign of life.
- **The write-up ask** rides on a tool result: `DESKTOP_ASK_CALLS` (3) calls AND
  `DESKTOP_ASK_AFTER_MS` (20 min) since the later of the wake, the last `session_end` /
  `chapter`, and the last ask (`config.ts#TUNABLES`). Never on a `session_end` or `chapter`
  result. `session_end` could always be called more than once; in Desktop it is how a long
  chat keeps being written up, and the e2e test calls it twice.
- **What `wake` includes, and what it leaves.** In: the wake, the clock, today's plain
  reminders (claimed — a tool result is certain delivery), the worker spawn (the runner's
  path is `spawn.ts#WORKER_RUNNER_PATH` now, equal to the hook's), the day's dream line when
  it is an ASK, the update line (the loaded build against `package.json` on disk now) and
  doctor's red-only notice (a closure from `bin/serve.ts`, since this library may not import
  `claude-code/`), and the write-up pointer measured against `TOOL_RESULT_CHARS`. Out: the
  first-launch question, primacy, and the headless nightly run. Under the owner's `auto`
  a headless offer is left UNCLAIMED and unsaid, for Claude Code's first prompt — a
  Desktop-only person on `auto` therefore gets no dream line in Desktop (a known limit).
  Core's ask says "shown … in the terminal" and "a background agent (the Agent tool)";
  Desktop has neither, so the wake adds one line (`DESKTOP_DREAM_NOTE`) rather than
  rewriting core's words.
- **`status`'s `owner: false`** confused both Desktop chats in the experiment; it now
  carries one phrase saying what it means (`ownerMeans`). Kept to one key in the census,
  because another session's branch edits the status body.
- **Not built:** the SKILL.md (brief item 9, deferred), Cowork's `roots` as a real
  per-folder scope, pruning `scopes.json`.

### After the review of #294

- **The ask only for a chat's OWN calls.** Desktop's `note`, `recall`, `status` and `scope`
  had no `session` in their schemas, so a chat could not name its session there, fell back
  to the most recent one — possibly another chat's — and after three calls and twenty
  minutes carried THAT chat's write-up ask. Now every Desktop schema takes an optional
  `session`, only named calls count toward and carry the ask, and a fallback-bound call
  moves nothing on the record it borrowed (which also stops "most recent" flapping between
  chats). A model that never passes its id is never asked, and its session goes quiet
  after `SESSION_TTL_MS`; tools that need a session then say to call `wake`.
- **Observer, per call.** A registry `observer` used to be fixed at launch from the
  process's working directory, which for Desktop is wherever the app started it — so the
  `scope` tool's `observer` never took effect, and an `observer` on that directory muted
  Desktop. The store now gets the registry's `observer` only when Claude Code started the
  process; otherwise the server holds it (`launchObserver`) for non-Desktop clients, and a
  Desktop client reads `claude-desktop:`'s entry per call. A cost, named: with no Claude
  Code markers and an `observer` launch directory, the process log stays off even if the
  client turns out to be Desktop.
- **Wording.** `ownerMeans` stays for Claude Code too (one of two deliberate Claude Code
  changes, with the scratch-workspace skip). The scope-off/paused refusal is per host.
  `install --host claude-desktop` names the store a replaced entry pointed at, and says to
  quit Desktop first (it rewrites its own config file while it runs).

## 2026-09-30 — the census counts replaced apart from exited (U13)

`status`'s `symmetry` gains `replaced` per kind, and `exited` narrows to what left for
good: let go (pruned, faded), removed, or archived under a reason nobody mapped. A
revision, a merge (sleep's or a dream's), a handoff cleared and a journal copy rebuilt when
its chapter grew (`episode-regrown`) are `replaced` — a live row carries them. On the live
store 72 of 74 self-kind "exits" were rebuilt copies. The table is `core/leaving.ts`, the
same one the dashboard's archive words take their groups from; the server asks it through
`counterpart.leftAs` so this change adds no import to `server.ts`. `exited` CHANGED MEANING
without a version marker (nothing in the code reads it): a daily or a note comparing it
across days sees a step on the day this is installed. The CHANGELOG says so.

The `recall` tool's description now says that in a question about feeling "I" is the
counterpart and "you" the owner (review of #293, B1).

## 2026-10-01 — Desktop's Code tab reaches Desktop's server (lane 5)

Measured live, read-only: a Code-tab session (entrypoint `claude-desktop`) was woken by
its own SessionStart hook, and its own MCP server (child of the tab's `claude` CLI, with
Claude Code's env markers) stayed in Claude Code mode — guarantee 18 held. But the
`mcp__counterparts__*` tools the model saw were Claude Desktop's server's (`wake` in the
list, `recall` taking `session`): same name, Desktop's shadows the session's own. An
unnamed `status` from the tab was filed under the most recent Desktop chat. Guarantee
18's picture of the Code tab — a Claude Code client that "gets the handshake, tools and
refusals it always got" — was half right: its own server is Claude Code's, but the tools
its model calls are Desktop's.

So the Desktop server serves a Code-tab call AS the Claude Code session it names
(guarantee 21). What the build learned:

- **Per call, not sticky, and not by mutating `scope`.** `scope` became an accessor over
  `placeScope` (the server's place) and `callAs` (the call's), and `session` reads
  `callAs` first. The heartbeat is an unref'd timer and a call awaits (embedders), so a
  tick can land mid-call; `beat()` reads `placeScope` explicitly. Both are pinned by a
  test that fails when either is reverted (`test/codetab-session.test.ts`).
- **The binding decision comes before the place is read**, so the project's own
  `off`/`paused`/`observer` govern the call, and `desktopCall` is false for it — no bind
  note, no pacer, no `mcp.desktop.call`, no ask. `mcp.session.served` marks it.
- **Two host lookups.** A result's words about the PLACE (scope on/off/paused) are Claude
  Code's for a served call (`placeHost`); the reconnect sentence stays Desktop's, because
  the process holding an old build is Desktop's.
- **Refusals stopped telling a Code-tab model to `wake`**: `session-required`,
  `session-unknown` and the bind note now carry the Claude Code clause, and an ENDED
  hook-registered id answers `session-not-live`, not `session-unknown`.
- **The Stop ask was left alone**: it already says `session: <id>` on the two tools it
  names, which take `session` on every host. The wake line (`hooks.ts#codeTabSessionLine`)
  carries the instruction for the rest.
- **Left as is, named:** a Code-tab model that calls `wake` anyway mints a Desktop
  session (the server cannot tell; the description is the mitigation). A served call
  reads `scopes.json` from the Desktop server's config dir — the same file as the hooks'
  when both were installed from one configuration.

### After the review of #309

- **Observer leaked through the `scope` door.** Desktop exempts `claude-desktop:`'s own
  `observer` there so the tool can set it back; a served call inherited the exemption
  and could lift an observer PROJECT from inside. A served call now stands where Claude
  Code's server stands (`this.observer`).
- **The Code tab only** (coordinator's decision): `claudeCodeSessionNamed` requires the
  record's `entrypoint` to be `claude-desktop`; a terminal session is refused
  `session-not-code-tab`.
- **A stale id was filed silently.** Only a Stop refreshed liveness (TTL 4 h), so a Code
  tab idle past it had its first turn's `note` land unbound under `claude-desktop:` as
  `stored: true`. Root fix: the prompt hook refreshes an EXISTING record before the model
  calls anything (never creates one — a missing record is the off→on flip, and a
  claude-code test pins that). And any named id that did not bind now says why on the
  result (`sessionRefused`, `sessionNote`).
- `DESKTOP_INSTRUCTIONS` and the unnamed-handoff refusal now carry the Code-tab clause.


## 2026-10-01 — the morning catch-up (wake build 3)

- **The granted path, smoothed.** "Ended" is the ledger's (#289): a crash with no
  `endedAt` that captured nothing since the date changed is served; one still at work
  today is `live-session` with a detail. No registry record is needed for the subject.
  `owedWriteUps`' full-first rotation is not asked on a grant — the launcher chose — so a
  small debt is not refused while a larger one waits elsewhere, and every refusal says
  why. The runner goes on to the next part once one comes back, to the claim's `upTo`.
- **Claim-first** is a field on the progress map (`claim: { by, at, upTo? }`), taken in
  the same `BEGIN IMMEDIATE` transaction that re-reads the map (`Store#updateMeta`, review
  of #308): the second of two fetchers at the same instant is told `claimed`, and the
  launcher passes over a subject claimed between its plan and its grant (`busy`). The
  SessionStart pointer saves the same way, keeping a claim it did not read and deferring
  (`claimed`) when the subject is held. A claim
  nobody lets go runs out after `WRITE_UP_CLAIM_MS` (2 h); a killed night's runner record
  is ended by the next run (`endStaleRunners`), and the door refuses its grant
  (`grant-expired`) either way.
- **The memory is the ended session's.** `mint.ts` takes `writeUp: { session, happenedOn }`
  from the door through `SessionEndDepositContext.writeUp`: `origin_session` is the ended
  session, `happened_on` the date of the part's latest piece, `meta.secondHand` and
  `meta.writtenUpBy` say who wrote it. The proposal record keeps the writer's id, which is
  how the ledger still classifies the claim as `next-session`.
- **Replies ride along** (`[its reply]`, each cut at `WRITE_UP_REPLY_BYTES`, 1.5 KB; a reply
  to a turn already written up is left out with it). Both the pointer's part count and the
  door's parts read the one `writeUpEntries`, so they agree; a part count recorded before
  this build may grow by the replies' bytes, which the door already tolerates.

## 2026-10-01 — `chapter` takes an `about` mark (lane 8)

#311 found a chapter's copy crosses directories only when marked me, us or owner, and
nothing a session could send set that mark: the copy was minted unmarked and only a
reflection or the v9 upgrade marked one. The chapter tool now takes `about`; the
description asks for it and says a session that was only building is `work`. The mark
goes on the episode's meta and on the live copy at once (a closed regrow window would
otherwise never carry it), and a regrown copy takes its predecessor's mark, so a
reflection's later mark is kept too. A later chapter's mark replaces an earlier one.

## 2026-10-01 — the `unresolved` flag reaches the write tools (lane 8)

The threads lane read `meta.unresolved` and no tool could set it, so it never fired. `note` and
each `session_end` entry take `unresolved` (a boolean, passed as sent). Beside a declared
`updates`, SAYING it (true or false) clears the old row's flag (`counterpart.ts#closeThread`):
false is an answer, true carries the thread to the newer row, so one thread lives on one row,
the reminder's rule. Left out, a revision does not close anything. The result says
`thread: { closed: <id> }`. `how: changed` already took a settled row out of every lane.
Review of #313: closing passes the revision step's checks first — a protected row refuses
(`protected-refuses-revision`), an archived one (`target-archived`), and a session not the
owner's closes nothing confidential (`confidential`) or written in another directory
(`other-directory`). The result says `thread: { closed: null, reason }`. (2026-10-02: such a
refusal no longer settles the thread over either, and a Claude Code session is the owner's —
see that day's note.)

## 2026-10-02 — every result under one ceiling, and the net behind it

Claude Code saves a tool result past 50,000 characters (or 25,000 tokens) to a file and hands
the model a 2 KB preview; the headless nightly run cannot open the file. On 10-01 and 10-02 the
dream's begin and part 2 and the reflection's begin went that way, and the run went on thin.
The caps now derive from `fit/TOOL_RESULT_CEILING` (40,000), and `withinCeiling`, the last step
of `call`, measures every result as the host does (`structuredContent` serialized, by
`wireChars`). Over it, the longest top-level string is cut to fit, a `cut` field says so, and
one durable `mcp.result.oversize` row records the tool, the phase and the sizes. A margin and a
stated cut, never a refusal. Each part a dream's or a reflection's bundle is handed in —
part 1 being the begin — leaves an `mcp.part` row, so doctor's Tool results line can hold the
parts a run was promised against the parts it fetched. `RECALL_ID_RESULT_CHARS` (56,000, counted
over both copies) is ~28,000 per copy: under the ceiling, and left as it was.

After the adversarial review of #315: the net's cut is a FIXED target, searched by halving (the
first version shrank its target each try and kept a fraction of the room for escaped text). The
`mcp.part` row is written after the net, with the size that left and `cut`. Telemetry rows a
READ leaves (a part, `mcp.recall`, the lookup ledger) go through `telemetry`, which puts the write
guard's verdict back as it was: a lock met by the row is the row's loss, never the read's refusal.
Write-up parts are sized by the larger of bytes and escaped wire cost, so none meets the net.

## 2026-10-02 — `note` takes `feelingsNow` (lane B, owner pick 2)

- **Why `note` and not `session_end`.** The moment an old memory feels different is
  mid-session, when it comes up; `session_end` is one call at the end, long after. And
  `note` already acts on existing memories without writing one (`settle`, 2026-09-29), so
  `text` may be left out the same way — `feelings-now-only` — or sent with it, and both
  happen. Not a new tool.
- **"Shown in this session"** is what this server process handed it (`seenHere`: the
  memories `recall` returned, the neighbours a write showed) and what ambient recall
  surfaced for the session (its gate record), when the session is known. There is no
  per-session record of the wake's memories; one shown only there is refused with the way
  in — read it with recall by id first. Loose by design: the bound is the shown set, not a
  refusal of a feeling.
- The core is `Reflections#feelAgain`, the reflection's own path (`dream/NOTES.md`,
  2026-10-02).

### After the review of #316

- **Only what recall DELIVERED is shown** — the payload's memories, not the ids left
  `waiting` for room. A footnote or a link's pointer in ambient recall is a title, not
  the memory: only `tier: surfaced` rows count.
- **Kept per session** (`seenBySession`, the newest 32): Desktop's one server serves many
  sessions, and a Claude Code process starts a new session on /clear. The key is the
  session the call is served as on Desktop, else the session the host is running now,
  else the bound one.
- **An error only when nothing landed**: a note refused beside a feeling that was
  recorded is not an error — else the model resends and meets `once-a-day`.

## 2026-10-02 — a stale server says so on every result

A server left open across an install keeps the tool list it loaded, so an argument the new
version added (`note`'s `about`, `unresolved`) was dropped without a word until the host
reconnected, and Desktop heard of the update only in `wake`. `withUpdateNotice` now adds an
`updated` field to every result but `wake` (which keeps its own line) while this process's
build differs from the package on disk, or a newer build has stamped the store's wake
(`self.wake.build`). One manifest read and one meta read per call. It is forward-looking: a
server from before this change (0.3.10, 0.3.11) left open says nothing.

## 2026-10-02 — the owner's own sessions are the owner (owner ruling)

Claude Code's memory server started without `COUNTERPARTS_OWNER` — no install sets it — so it
was a guest while its hooks and worker, reading the configuration's `owner: true`, were the
owner. Closing an `unresolved` thread from another directory was refused `other-directory`,
and the same deposit's settle took the thread off "Still open" anyway. The owner's decision:
his own sessions count as owner. `bin/serve.ts#ownerStance`: with nothing said on the launch
(`LaunchOptions.ownerSaid: "unset"`), the configuration's `owner: true` makes a server Claude
Code started (`claudeCodeEnvMarker`) the owner's, and lets Desktop's server serve a Code-tab
call (`callAs`) as the owner's (`codeTabOwner`, read by the `owner` getter and passed to the
deposit as `DepositContext.owner`). A Desktop chat stays a guest. The order is flag, then
environment, then configuration: `--owner` wins outright; else `COUNTERPARTS_OWNER` when set —
`=0` is the opt-out (`ownerFrom: "off"`), junk is not owner and is not upgraded; else the
configuration. An observer configuration is nobody's. The opt-out is the memory server's: the
hooks and the worker read the configuration's `owner` alone. `status` says `ownerFrom` in words. The headless nightly run pins
`COUNTERPARTS_OWNER=0` on its one server (`night-run.ts#nightMcpConfig`): it keeps the stance
it had until that is decided on its own.

What the owner bit opens on such a server, which a guest did not reach: confidential memories
in `recall` (by question and by id) and in a write's neighbours; closing a confidential thread,
and one opened in another directory; and, through core, a plain reminder's confidential line
and the core list's confidential titles; and feeling again, awake (`note`'s `feelingsNow`), a
confidential memory its recall showed it — the call's own bit reaches `Reflections#feelAgain`,
so a Code-tab call on Desktop's server may too. The Desktop `wake`'s chapters and "Last here"
stay a guest's (Desktop chat).

What it does NOT open (review of #318): a dream's or a reflection's bundle. Those are read as a
guest on every server (`dream/tunables.ts#BUNDLE_OWNER`) — kept as before, a coordinator default
the owner may revisit — because a dream's journal and a nomination's `why` carry no
confidentiality mark and are read later by other bundles and the dashboard. So the in-session
dream (`ask`, the default) and `reflect launch`, whose background agent calls the session's
owner server, build the same bundle the pinned nightly server does. The dream's gate (what
counts as new for the ask) is still the session's own stance. And whatever the stance, the close and the list agree now
(`counterpart.ts`): a close this session may not make leaves the thread unsettled — the
declaration stays a link — so it stays under "Still open", as the refusal says.

## 2026-10-02 — Desktop: wake first, and Always allow

Measured in a Desktop chat: the model never called `wake`, answered "what do you remember about
yesterday" from `recall` alone, and called that slice the full record; called, the wake carried
the store-wide Yesterday line. The likely cause is Desktop's per-tool permission prompt: until
the owner picks Always allow, the model does not call a tool it was not asked for. Text only:
`DESKTOP_INSTRUCTIONS` and `WAKE`'s admission say to wake first in every new chat, before
anything about the person, the past or ongoing work, and a negative example says recall alone
is a slice, never the record; `hosts.ts#DESKTOP_ALWAYS_ALLOW` is said by the install, the help,
QUICKSTART and doctor's Claude Desktop line, which cannot measure it. "The first call carries
the wake" is not built: it waits on the owner's test.

## 2026-10-03 — the writer's three fields (Release A of deliberate recall)

`note` and each `session_end` entry (so write-ups too) take `occurredOn`, `saidBy` and
`status`, read by `server.ts#readWriteFacts` before anything mints, and not a refusal: an
unreadable date or an unknown word is dropped and said (`facts.dropped`, with what to send
instead), the memory stored all the same. A date in the future is kept with a note that a
reminder date is `eventDate`. Null is "none" (a revision carries nothing over for it). The
answer's `facts` says what was recorded after `Counterpart#carryFacts`, what was carried
over and from where. The descriptions teach the one thing that matters: resolve "last
week" to a date now, leave it out when unknown, `occurredOn` is when it happened and
`eventDate` a future date — and `EVENT_DATE_PROPERTY` now points back at `occurredOn`.
Recall's behaviour did not change in this release.

## 2026-10-03 — meaning mode (Release B of deliberate recall)

`meaning.ts#meaningRecall(ctx, question, { page })` and `renderMeaning(result)`; B-facts'
dispatch calls them for `mode: "meaning"`. `MeaningContext` is what `recallTool` already holds
after `embedQuestion`: the counterpart, the session, `owner`, the vector and its `semantic`
reason (the function is synchronous, so the embedder is not in it). What the build learned:

- **A bare write is weak, not faded.** `strength` of a memory `put` without salience measures
  0.09 on its first day, so an absolute floor called fresh memories faded. Faded reads the
  share KEPT instead: `decay × fadeOf ≤ 0.2`.
- **Possessives did not link.** The shared whole-word rule keeps an apostrophe inside a word,
  so "Han's birthday" named no card and got no `memory_subjects` row, and a question saying
  "Han's" reached no card either. Fixed in review: `encode/words.ts#nameRegex` reads a
  trailing possessive as the name, for the alias index (links, the backfill, crediting) and
  for meaning mode's reading of a chapter's words.
- **Moments are placed, not resolved.** `chapter-address.ts#chapterTimesOf` reads an
  episode's chapter moments once and `chapterAt` places a memory by `resolveChapter`'s span
  rule; only the chapters shown read their whole span (for feelings).
- **The chapter address opens since Release B's facts half** (#323): `ids` / `handle`
  read `epi_…#N` as that chapter (`deliberate.ts#expandChapter`).

## 2026-10-03 — facts mode, and the recall tool's two modes (Release B of deliberate recall)

- **Its own path, not `build()` re-tiered.** Facts mode (`facts.ts`) reads every live row's
  columns once (`Store#recallRows`), searches each content word with a limit of its own
  document count (so every hit, not a top-K), weights words by rarity
  (`cues.ts#informativeness`), reads subjects off the v12 links, and caps only meaning (100).
  Measured on a synthetic 15,000-row store where every memory shares the common words: about
  1.3 s for a question of common words, 14 ms for a rare one; the in-line embedding comes on
  top. The live store's words are far less uniform.
- **Score = the sum of the ways.** Words are the share of the question's rarity a memory
  holds, shaded by BM25 within each word; meaning is the cosine above the embedder's inline
  floor, scaled to 0..1; a subject is its card's rarity against the question's. So a memory
  matched two ways ranks above one matched one way about as strongly, and recency only breaks
  ties. Weak (below a fifth of the best) is left out and counted.
- **Near-duplicates fold** at the gate's token overlap (0.85), walked in rank order only as
  far as the page needs, so pages stay stable. Templated memories that differ by one word
  ("note 1", "note 2") fold — the header says how many.
- **Faded is shared with meaning mode** (`deliberate.ts#hasFaded`: decay × fade ≤ 0.2,
  agreed with the B-meaning builder). An absolute floor failed: a fresh bare write measures
  about 0.09.
- **Quote credit for deliberate answers** rides a new gate-record kind, `asked`, written by
  the server for the session that asked (`seenKey`), read only by
  `Counterpart#creditReferences` — never by the ambient gate, whose dedup reads `surfaced`.
  The candidates are not `cued`, so the display decides, as for an expansion.
- **Time** (`recall/time-ask.ts`) reuses `recency-ask.ts` for days and clock times and adds
  weeks, months, parts of months, dates, "since", and two anchors the store resolves: an
  event ("around the cut-over", an article required — "questions around pricing" is not
  time) and the last session. An anchor nothing names filters nothing, and says so.
- **The console's `ask`** keeps its short list (top five, two lines each), counted by facts'
  `matched`; `--full` is the facts answer; `--json` the `FactsResult`, whose `memories`,
  `considered` and `id`/`title`/`body`/`kind` the dashboard's search already reads. `--voiced`
  is accepted and unused (feelings are meaning's).
  (2026-10-09: the dashboard read more than that — `tier`, `from` and a date at the front of
  the body — and lost them quietly, its tests fed by hand in the old shape; see the
  dashboard's NOTES of that day. `ask` takes `--mode meaning` now, and there `--voiced`
  decides whose "I" a question about feeling means.)

## 2026-10-09 — meaning's subject is the card the question is about

Meaning mode took the card with the most memories as the arc. On a real store that is
usually the owner's own card, so "what has Ilya been to Mike" answered about Mike, with Ilya
under "also named". The review of #333 found it on the dashboard and fixed that side by
turning the owner's "I" into "you"; the `recall` tool picked the same way. Reproduced on the
demo store through the tool: "what has Ilya Broadbent been to Rosalind Achebe" (6 memories
against the owner's 10) answered about Rosalind, and "how has Ilya Broadbent changed since
Nkechi Abernathy arrived" answered about Nkechi.

- **Grammar first, then the order of the names, then counts** (`meaning.ts#subjectOf`). Each
  name is read in place by the words just before it: asked about ("what has X been", "how
  has X changed", "how did X", "about X", "my arc with X", "between X and Y"), an aside
  ("been to Y", "meant for Y", "since Y", "after Y", "than Y"), or plain. A bare "to" is
  not an aside: "what happened to X after Y left" is X's. A name joined to the one before it
  ("X and Y", "X, Y") shares its place. The best place wins; within it the first named; a
  longer name at the same spot, then more memories, then the name, break a tie.
- **The owner leaves a place he shares.** Every memory in his store is his, so beside
  another card in the same place the other says more ("Rosalind and Ilya" is Ilya's arc).
  When the grammar puts him alone in the subject's place ("what has Rosalind been to Ilya")
  he is the subject, and the person is the one-liner.
- **Ambiguity is said, not hidden.** More than one card left in the best place: the arc
  follows the first, and a note says "it asks about A and B alike: this follows A, named
  first". "Also named" already offers the other's arc by name.
- **The owner's "I", asked about, is his card again.** The pronoun that means the owner by
  `feeling-ask.ts`'s rule ("you" when the counterpart asks, "I"/"me"/"myself" when the
  owner does) counts as his card, read by the identity core's id rather than his name, only
  where it sits in an asked-about place. So the dashboard's "what have I been like" (sent as
  "what have you been like", voiced) finds his card, as it did before #333; "do you remember
  the budget" names nothing and is read by its words; "my" and "your" own a topic and name
  no one. Off for a question about feeling (the pronoun says whose feeling, so "how have you
  felt lately" stays the feelings answer) and for "us".
- **Facts mode is untouched.** `facts.ts` reads `subjectsIn` itself and imports nothing from
  `meaning.ts`. The only code changed is `meaning.ts`; the `recall` description gained one
  sentence in its meaning claim, so a benchmark pinned to facts answers the same.
- **Not done:** an arc of two cards together (the memories naming both). "What has Rosalind
  been to Ilya" is still one card's arc; the overlap would be the better answer, and a
  bigger change.
- **Review of #334: two seams, both regressions against master.** (1) The owner's pronoun
  took the about place's full rank, so "what have I done on Driftwood", "how have I been
  with Nkechi" and "what have you learned from Ilya" answered with his own card where
  master answered with the card named. It now ranks under any card named in a plain or
  about place and over an aside (`mentionRank`): "how have I been since Driftwood" and
  "what have I been to Ilya" stay his; a name joined to the pronoun still takes the about
  place. (2) The alias index matches a name in any case, so a card named with a common
  word — Will, Hope, Bridge — is found in "how will Driftwood go" and "I hope Ilya is ok",
  and "first named wins" made it the arc, with an "alike" note. A name typed in lower case
  where its card writes a capital is now a step under the same place typed as written; a
  question typed all in lower case loses the step on every name, so the grammar still
  decides. The matching itself (and a Will card linking every "will" in the store's
  memories at birth) is the alias index's, untouched here.

## 2026-10-09 — `recurring` beside `eventDate` (the owner's design, held lightly)

- **The field**: `recurring: "daily" | "weekly" | "monthly" | "yearly" | null` on `note`
  and on each `session_end` entry, one sentence on the field (served whole; the tool
  descriptions are cut at 2,048 characters, so the field is where the model reads it).
  The plain/quiet privilege grew one short sentence — "A recurring date counts each time
  it comes round as its own" — rather than a new privilege, so nothing the cut tests pin
  moves.
- **Refused by name, before anything is captured** (`readReminder`), as an unreadable
  date is: an unknown word is `recurring-unknown` (the detail lists the four, and says
  every other week and the like are not kept); a word beside a month, a range or a year
  is `recurring-needs-day`. On `session_end` either refuses its own entry only. With no
  `eventDate` it is dropped and said (`ignored: "recurring"`), unless a revision carries
  a date for it.
- **The answer**: `reminder` carries `recurring`, `every` ("every May 14") and `next`
  (the next occurrence on or after today) — and never the "already passed" note, which
  a birthday anchored in 1990 would otherwise get. A revision's `carriedOver` can name
  `recurring`.
- **Meaning recall** dates a repeating reminder by its next occurrence and says how
  often: `dated 2026-10-12, every October 12`. Facts mode and an expansion show no
  reminder date today, so they have nothing to add it beside.

## 2026-10-09 — facts mode: "last Saturday", and a word in front of a date

The LongMemEval run (counterparts-87, about 2,000 facts searches) found two misreadings in
`recall/time-ask.ts`. "Last Saturday" was no time at all, so nothing was filtered. "Before
7/22" filtered to 07-22 alone: only "since" was read in front of a date, and every other
word was left in the question while the date stood as one exact day. "Two weeks ago" was
right (asked on 2023-02-01: 01-16..01-22, checked on a benchmark store).

- **What changed meaning, exactly.** (1) "last <weekday>" and "this past <weekday>", full
  names only, any case, a possessive allowed ("last Saturday's"): was no window; now the
  most recent such day strictly before today, exact (no stretch). Asked on a Saturday,
  "last Saturday" is a week back. (2) "before" / "prior to" a date: was that one day; now
  `OPEN_START`..the day before. (3) "after" a date: was that one day; now the day
  after..`OPEN_END`. (4) "until", "till", "up to", "up until", "by" a date: was that one
  day; now `OPEN_START`..the date. Each in every date shape the parser reads: ISO day and
  month (`2026-07-22`, `2026-07`), `7/22` and `07-22` (month first, as before), "July 22",
  "22 July", "July 22nd". A "the" between the word and the date is allowed ("after the 4th
  of July"). (5) `7/22/2023` and "July 22, 2023" / "22 July 2023": the written year was
  ignored (the date took `yearFor`'s year, and `/2023` stayed in the question's words);
  now it is the year. (6) "since" + "last <weekday>" runs from that day to today, as
  "since" + a date always did. "Since" + a date is unchanged, its month stretch included.
- **The rule for "last <weekday>"** is the CONTRACT's (§6f). Exact, as "yesterday" and
  "the day before yesterday" are: a named day. A day's stretch would not cover the other
  reading people mean by it (the Saturday a week earlier) anyway. Not "the last Saturday"
  (the last of something: "of June").
- **An open end is a sentinel, not a null.** `OPEN_START = 0001-01-01`, `OPEN_END =
  9999-12-31`, so `DayWindow` keeps its shape and `inWindow`'s string comparisons, the
  chapter-date filter and the only-time pool work unchanged. The header and the dashboard's
  Ask line read them as "through 07-21" and "07-23 onward"; `ask --json` shows the
  sentinels as they are. `stretched` leaves an open end open.
- *Choices:*
  - "After" is open-ended, where "since" stops at today. "Since" means "from then until
    now"; "after" does not, and a plan dated past today ("what is coming after 7/22") is
    inside it.
  - A bound does not stretch, even under a month ("before 2026-07" is through 06-30): the
    person named the cutoff. "Since" keeps the stretch it had.
  - "By" reads as "through" (a deadline). Only right in front of the date: "by the way on
    7/22" is 07-22 alone.
  - "The day after 7/22", "a week after 7/22", "the night before 7/22" read as the bound
    ("after 7/22", "before 7/22"): wider than meant, but they cover the day meant. They
    were 07-22 alone, which missed it.
  - *Review of #338:* a date that names a thing on that day keeps that day under "before"
    and "after". "What did I eat before the 7/22 flight" was through 07-21, and the meal
    was on 07-22 (master's 07-22 alone found it; the bound hid it). "After the July 22
    launch" was 07-23 on, hiding the launch day; 07-22 alone would hide the days after.
    So: a "the" between the word and the date and a word after the date that is not the
    question going on (`PHRASE_STOP`: "after the 4th of July we sailed" is still a cutoff),
    or an 's on the date ("after July 22's standup", "after last Saturday's party"), and
    the window is through the date / from the date on. Only the date leaves the question
    ("what did I eat before the flight"), and the header says "before the 7/22". Wider by
    one day than a cutoff, never narrower than either earlier reading.
- **Not done:** a month NAME under a bound ("before September" is still no time;
  "before September 2023" is still all of September, stretched), "between X and Y" and
  "from X to Y" (still the first date alone), "this Saturday" and "on Saturday" (either can
  be the coming one), "last weekend" (no time), a two-digit year (`7/22/23` is still 7/22
  with `yearFor`'s year, `/23` left in), `2023/07/22`. The learned-date fallback for a row
  with no `occurred_on` is the owner's decision and untouched.

## 2026-10-09 — tool descriptions inside the host's 2,048-character cut

The review of #328 read the 2.1.295 binary: Claude Code keeps each MCP tool description
twice, cut at 2,048 and at 16,384 characters, and sends the long copy only to a tool
loaded through tool search (on by default). A tool loaded up front gets the 2,048 copy
and `… [truncated]`: with `ENABLE_TOOL_SEARCH=false`, behind a custom base URL or proxy,
on a model without tool search, or for an always-loaded tool. Seven of the nine
descriptions run past 2,048 (session_end 7,218, recall 6,176, note 5,091, self_page
4,522, dream 3,785, reflect 2,815, chapter 2,097).

- **What was cut, measured.** Not the "Do NOT" lines: `renderDescription` already puts
  the summary, the When: line and every negative example before the guarantees list, and
  on every tool they end before 2,048 (the longest, dream, at 1,782; wake at 1,229). What
  a host cuts is the tail of the guarantees list.
- **The field descriptions are not cut** (2.1.296: the schema goes through
  `param_descriptions` overrides and two Chrome/computer-use injectors, none of which
  shortens anything). The longest is session_end's `handoff`, 1,005 characters, served
  whole. They already carry most of the how-to-call detail (`updates` is a field, the
  date shapes, `[]` is an answer, `ifVersion`), which is why that detail was put there.
- **The change: order only, no wording.** Each list leads with the claims that say how to
  call the tool, then the ones about what the engine does with it:
  - note: `updates` and `eventDate` are fields, the salience floor, the default floor,
    the three dimensions, a stub is refused. Out of the cut: the same road, credentials
    (a Do NOT already says it), the same content twice, the buffer span.
    `DATE_PRIVILEGES` is split into `EVENT_DATE_FIELD_PRIVILEGE` and
    `REMINDER_PRIVILEGES` for this; session_end renders them in the old order.
  - recall: mode, handle, ids; "a search strengthens nothing" now starts at 1,823 and is cut.
  - session_end: bound session, `updates`, both salience claims (still pinned by
    `test/stop-ask-quiet.test.ts`), and the empty-`memories` answer. The id check, the
    same road and the authorship record moved out. The settle claims stay last.
  - reflect: `settle` moved up to third.
  - chapter (only the observer line is cut), self_page (one claim fits), dream (none fits
    whole in 179 characters; its `begin` prompt states the limits) and status, scope and
    wake (served whole) are unchanged.
- **`test/description-cut.test.ts`** holds the layout (summary, When:, each Do NOT whole
  inside 2,048 and before the list, for both Claude Code's and Desktop's lists), the
  leading claims per tool, and records each description's total and pre-list length in
  one table. A change of length fails it until the table is updated, so the growth shows
  in the diff.
- The CONTRACT promises content (G2: every claim mechanized; G3: an admission test and
  a negative example), not an order, so it is unchanged.

## 2026-10-09 — facts mode: amounts, fractions, and a day not yet come

Three of #338's reviewer's findings predated it (items 3 and 4 of that review), all in
`recall/time-ask.ts`; this is them.

- **What changed meaning, exactly.** (1) A `M-D` or `M/D` with a unit or counting noun
  right after it is an amount, not a date: "7-8 hours", "3-4pm", "5-10%", "3/4 cup", "1/2
  of the budget", "lost 5-10 lbs" (a decimal tail too: "7-8.5 hours"). A price is one too:
  "$5-10". They were dates ("7-8 hours" July 8, and under "up to" through 07-08; "$5-10"
  May 10). The scan goes on past an
  amount, so "slept 7-8 hours before 9/21" is through 09-20; anything else stops it where
  it stopped before. (2) "Cut it by 1/2", "reduced the dose to 1/3": a fraction after a
  word of quantity is no date. It was through 01-02 (master before #338: 01-02 alone).
  (3) "Since" and "after" a month and day with no year that has not come yet this year
  (a later day of this month, the only case `yearFor` left in the future) now mean last
  year's. "Since 10/25" asked on 10-03 was empty (10-25..10-03); now it is
  2025-10-25..10-03. "After 10/25" was only what is still to come; now it is 2025-10-26
  onward, which holds that too. The event form follows ("after the 10/25 launch" is
  2025-10-25 onward). A Feb 29 not yet come reaches back to the last Feb 29 there was.
- *Choices:*
  - The fraction rule is narrow on purpose: a slash, no year written, the number above
    smaller than the one below and the one below at most 10 (halves to tenths), and a
    word of quantity (cut, reduce, increase, decrease, divide, multiply, grow, shrink,
    raise, lower, halve, trim, slash, boost, scale, drop, fall, rise, in their forms) at
    most three words before the "by" or "to". Anything else stays a date: "finish by
    1/2" is through 01-02, "cut costs by 3/15" is a March deadline. When it guesses
    wrong the other way ("drop it off by 1/2"), nothing is filtered, which hides nothing.
  - The year moves only under "since" and "after". Under "before", "until", "by" and a
    day alone this year's coming day is kept: "before 10/25" asked on 10-03 is through
    this year's 10-24, which holds everything that has happened plus the plans before
    it, where last year's would hide a year; "by 10/25" is a deadline ahead; "on 10/25"
    can be a plan. So the CONTRACT's "before 1/5" asked on 01-03 (through this year's
    01-04) stands.
  - "Today" is the person's own day (the store's zone), as everywhere here: at 04:00 UTC
    on 10-04, "since 10/4" is last year's in Denver (still 10-03) and today on Kiritimati.
  - The event-day rule of #338 ("before the 7/22 flight" keeps 07-22) is unchanged and
    now tested in Denver and on Kiritimati.
- **Not done:** an amount written with words between the number and the unit ("7-8 full
  hours"), a score ("rated it 8/10" is still August 10), a later MONTH under "by" or
  "until" (still last year's by `yearFor`, as before), and a number range with "to"
  ("7 to 8 hours" was never a date).
- *Review of #345:* two follow-ons of the amount rule. (1) Passing "2-3" over as an amount
  left "3 weeks ago" to be read alone: the week three back, which hid the week two back
  (and "3-4 days ago" left "3-" in the question). A range in front of the count ("2-3",
  "2/3", "two or three", "2 to 3") now covers both ends: "2-3 weeks ago" asked on 10-03
  is 09-07..09-20 before the stretch, "3-4 days ago" 09-29..09-30. "3 or 4 days ago" was
  the same misreading on master. (2) A zero-padded month or day ("the 09-28 minutes",
  "7/08 hours") is a date: no amount is written that way, and this owner writes his dates
  so. Probed and left as they are: a date followed with no comma by a unit or counting
  noun ("on 7/8 hours were cut", "on 9/12 people came", "the 9/28 minutes") is no time,
  because "on 7-8 hours of sleep" is an amount after the same "on" and no time hides
  nothing; with a comma ("on 5/6, days later") it is a date. "7/8 hours before the
  launch" is no time (an amount, and the launch is not resolved).
