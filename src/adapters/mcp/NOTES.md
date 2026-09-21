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
