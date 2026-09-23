# `adapters/claude-code/` — INTERFACE-GAPS

*Everything the composition root and this adapter needed from a module they may
not edit, plus three holes found by building them. Filed rather than hacked
around (the no-cross-edits rule); each entry says what exists today, what the
honest fix is, and where the proof lives.*

Written 2026-08-25, alongside `src/core/counterpart.ts`, `test/counterpart.test.ts`
and `test/claude-code.test.ts`.

---

## 1. `remember/`'s `ProposalSource` has no member for a swept proposal

**What exists.** `ProposalSource = "session-end" | "jot"`. Both mean "the
experiencer wrote this". A crash-fallback sweep is neither, and
`Counterpart.applySweep` must build a `Proposal` to reach `mintProposal` — so it
sets `source: "session-end"` (`SWEPT_SOURCE`, named and commented at the top of
`counterpart.ts`) and carries the truth in `MintOptions.channel: "fallback"`.

**Why it is not urgent.** Nothing downstream reads `proposal.source`:
`mintProposal` reads content, kind, salience, updates, aliases, feeling, title
and day, and takes the authorship record from `channel`, which is engine-set and
unclaimable (SEAMS N). `test/seams.test.ts` already mints with
`channel: "fallback"` from a `source: "session-end"` proposal, so the composition
root is doing exactly what the seam suite does.

**The honest fix.** Add `"fallback"` to `ProposalSource` and let the fallback
path say what it is. One-line union change in `remember/proposals.ts`, plus the
places that switch on it (none today).

## 2. `Store.open({ dir })` does not run its own path guard — FOUND LIVE

**What happened.** `dataDir()` calls `assertSafeDataDir()`, so the
environment-resolved path is guarded. An EXPLICIT `dir` goes straight into the
constructor, which `mkdirSync`s `prose/`, `versions/`, `tmp/` and `cache/` before
anything checks it. Writing `test/counterpart.test.ts` created a directory under
`~/.bansai` — v1's live memory — proving the guard by violating it.

**What was done.** `Counterpart`'s constructor now calls
`assertSafeDataDir(opts.dir)` before anything opens, and
`test/counterpart.test.ts` — "an explicit data dir aimed at v1's live store is
refused BEFORE anything is created" — asserts the refusal AND that nothing was
created on the way to it.

**Why that is not enough.** The root is one entrance. `Store.open({ dir })` is
public and every adapter, tool and test can reach it directly. Scar §2.13 is
"path guards resolve before they compare, and no tool silently accepts a pointer
at real data" — the guard exists and resolves correctly; the gap is that the
entrance a caller actually uses does not consult it.

**The honest fix.** One line at the top of `Store`'s constructor:
`this.dir = assertSafeDataDir(opts.dir ?? dataDir())`. `assertSafeDataDir`
already resolves both sides before comparing, so `~/.bansai/../.bansai/x` is
caught too; the root's call then becomes redundant belt-and-braces rather than
the only belt.

**Residue.** The bug had already created what it describes: an empty v2-shaped
directory as a **new sibling** inside v1's store root. Nothing of v1's own data
was read, written or modified — every pre-existing entry was untouched — and the
session could not clean it up either, because the sandbox correctly refuses all
writes under a live store, deletions included. Removing a stray directory from a
live store is an operator action, not an agent one; that is the design, and the
guard above is what stops the next one being created.

## 3. `self.appendChapter` has no gate — FOUND BY THE CALLER-UNIVERSALITY TEST

**What happened.** `SelfOptions.gate` is consulted by `ingestEpisode` and by
nothing else. `appendChapter` writes the chapter straight into the episode's
canonical prose. So a credential written into a chapter landed in
`prose/episodes/*.md` and stayed there — while the memory minted from that same
episode was correctly redacted. Scar §2.7 is "a gate covers every ingestion path
**and every side-channel**", and the journal is the side channel.

**What was done.** `Counterpart.appendEpisode` routes the chapter through the
same `bridge.episodeGate()` and appends the GATE's text, refusing outright when
the battery refuses. Proof: `test/claude-code.test.ts` — "the entrances are
enumerated, and each one refuses or redacts a credential" walks all four
ingestion entrances and then asserts no canonical byte anywhere under `prose/`
holds the secret.

**The honest fix.** `self/` should consult its injected gate in `appendChapter`
the way it does in `ingestEpisode`, so the next caller inherits the rule instead
of having to remember it — the same reasoning that put the observer stand-down at
the store seam rather than at entry points.

## 4. SEAMS queued item 12 is now ANSWERABLE, and is answered here

**The item.** "Once entrances exist (adapters), enumerate every ingestion
entrance and prove the gate battery covers each (encode's caller-side half)."

**The entrances this build creates**, all four through `Counterpart`:

| entrance | gate | wired at |
|---|---|---|
| `submitSessionEnd` | `bridge.batteryGate()` (per proposal) | `counterpart.ts` `deposit()` |
| `submitJot` | `bridge.batteryGate()` (per proposal) | `counterpart.ts` `deposit()` |
| `appendEpisode` + `ingestEpisode` | `bridge.episodeGate()` | `counterpart.ts`, and `Self`'s `gate` option |
| `sweepFallback` → apply | `bridge.gateSweepChunk()` (CHUNK level) | `counterpart.ts` `applySweep()` |

**Not yet covered, and named so it is not mistaken for covered:** anything an
adapter other than this one adds. `mcp/`, `cli/` and `dashboard/` do not exist
yet; when they do, the table above is the thing to extend, and the totality test
in `test/claude-code.test.ts` is the shape to copy.

## 5. `kind` defaults in two places (SEAMS queued item 9, still open)

`remember/proposals.ts` defaults a kindless draft to `"fact"` for the authored
door. The fallback door reaches `encode/` through `gateSweepChunk`, which needs a
`kind` on every proposal, so `counterpart.ts` spells the same default
(`DEFAULT_KIND`). Two spellings of one rule. The fix queued item 9 already
names — move the default behind the gate verdict — closes both.

## 7. The Stop ask has no RETURN CHANNEL in this host's hooks

**What exists.** `stop()` raises `stopAsk(sessionId, chapter)` when `self/`'s pacer says a
chapter is due; the coverage read from `SpanBuffer.coverageReport` rides along as a
measurement of the unaskable tail rather than as a second condition. The entry script
prints it into the model's context.
`Counterpart.submitSessionEnd` is the entrance that turns a written dump into a
memory, and it is fully wired and tested.

**The gap.** A hook can only put text INTO the context; it cannot receive the
model's answer. So the ask goes out and the deposit has nowhere to come back
through — in this host, that channel is a TOOL, which is `mcp/CONTRACT.md`'s
job. Until the MCP adapter exists, the authored front door is reachable only by a
caller holding the `Counterpart` directly, and the crash fallback carries the
load the dump was meant to carry.

**Why the ask ships anyway.** Every session-ending path must raise an ask (spec
§2 G5/G11's mechanized half), and an ask that exists before its return channel is
the right order: the alternative is a channel nobody is ever invited to use. The
telemetry says which happened — `adapter.ask` records `uncovered` every time, so
the day the channel lands, the backlog it inherits is already a measured
number.

**CLOSED 2026-09-04, and what closing it cost.** The MCP adapter exists, so the
channel exists — but the first run measured it shut anyway: this host registers
MCP servers from a STATIC configuration (command, args, env), so the server never
receives `--session`, and `session_end` refused every dump with
`no-bound-session`. Zero episodes were written; the model fell back to `note` 34
times in one session.

The fix is a note the hooks leave where the tool can read it —
`adapters/sessions.ts`, `<dataDir>/sessions/<id>.json`, written at SessionStart,
refreshed at Stop, closed at SessionEnd — plus an ask that now NAMES the session
id, because on this host the id can only reach the server through the model. What
the hooks owe the seam is exactly three things and they are all here: the record,
its scope (the directory the session STARTED in — set at a start and never moved,
and from 2026-09-17 the SOURCE every later hook reads its own scope back from, so
a shell that walks into a worktree cannot file the session anywhere else), and the
id in the ask's text. Everything about what the server then does with a claim is
`mcp/CONTRACT.md` §5 G10 and its residual-risk note.

**THE SECOND HALF, closed 2026-09-04: the CHAPTER had no channel either.** The ask
said "add chapter N to this session's episode" from the day the ritual shipped, and
`Counterpart.appendEpisode` was wired, gated and tested — with no adapter calling it.
So the invitation named a door that did not exist: measured on the live host, zero
episode files, every `self.episode` meta row carrying a null `episodeId`, and eleven
chapters written as `note`s titled "chapter N" because a note was the only thing that
would take prose. `mcp`'s `chapter` tool is that door, binding through the same
`requireBoundSession` rules as `session_end`, and the number it returns is the store's,
never the ask's. The ask that names it is now ONE text on ONE pacer: the authorship half
and the chapter half fired at different Stops and drew about a dozen asks in a 13-turn
evening, which is exactly what spec §13 G3 forbids.

## 6. `sleep/`'s `SleepStore` and `Store` agree structurally, undocumented

`runCycle({ store })` accepts the real `Store` directly (this build passes it
without a wrapper); `test/seams.test.ts` wraps it in an explicit adapter object.
Both work, which means the structural compatibility is load-bearing and nothing
asserts it. A one-line `const _: SleepStore = store` type test in `sleep/`'s
suite would keep a future signature change from silently forcing every caller
into the wrapper.

---

## Host-side gaps — this adapter's own open questions (CONTRACT §7)

1. **Is there a jot channel in this host?** `Counterpart.captureJot` and
   `submitJot` exist and are tested; no hook calls them, because the host offers
   no in-the-moment deposit surface this adapter can see. The MCP adapter is the
   likely home (`mcp/CONTRACT.md`: note, recall, status). Cost to the turn:
   unmeasured.
2. **The orphanable tail is measured, not bounded by anything host-specific.**
   `noteOrphanTail` runs on `session-end` and `pre-compact`, and its bound is
   `self/`'s re-ask thresholds — a memory number, not a host one. The host-local
   number (how long after the last session-ending event a session can keep
   living) is still unknown.
3. **Which host event means "crashed"? — CLOSED 2026-09-04.** None does, and the
   answer is a definition rather than an event: a session is crashed when it
   holds uncovered spans, recorded no `session-end` boundary, and has been silent
   for `CRASH_STALE_MS` (`remember/spans.ts#crashedSessions`, CONTRACT §7.3). The
   old eligibility rule — *any* boundary ∧ uncovered spans — made the sweep the
   primary path in fact: it ran after every Stop, and on 2026-09-04 one evening's
   sweeps billed 13 chunks and minted 61 memories beside 34 authored ones.
   `pre-compact` is still wired and still captures; it is not by itself a crash.
4. **Long-call survival is asserted, not proven in this host (CONTRACT §5 G6).**
   The call streams (scar E3) and `socketLifetimeMs` is a reported capability
   with no reporter. The proof G6 asks for — one long call surviving this host's
   ceilings, in this host — needs a live run with a real credential, which no
   test here is entitled to make.
5. **`executionCeilingMs` has no consumer.** It is reported and checkable; no
   code compares against it yet, because every foreground path is an appender and
   the heavy work is already detached. When something in the foreground can grow,
   this is the number it must be measured against.
6. **On first launch in a new directory, nobody is asked whether this should be
   on. — CLOSED 2026-09-10 (G41).** The hooks are registered globally, so a
   project directory that had never heard of Counterparts inherited capture,
   deposit and the wake the first time a session opened in it.

   The mechanism is the one this gap predicted: a written record plus an ask in
   the first wake, not a prompt. `SessionStart` appends `SCOPE_ASK` — one short
   block asking the model to ask the person, in plain words, and naming the
   console line that records the answer — whenever the scope registry says
   `unset`, at most once per session (`SessionRecord.askedScope`), and only when
   it fits the ceiling the host reported. It rides `HookResult.ask` rather than
   the injection, because the wake's sentinel states its own byte count and must
   stay its last line (scar §2.3); when there is no room it defers with an event
   and leaves the record unmarked, so the next session asks instead.

   **What it does NOT close.** The default while unset is still ON, so the
   session that raises the question is itself recorded. That is deliberate —
   every directory the parallel run touches is unset, and defaulting to observer
   would have muted the live run on the day it shipped — and it is the one
   decision in this feature the owner was asked to confirm rather than told.
7. **Turning it OFF for one directory takes four moving parts. — CLOSED
   2026-09-10 (G42).** It was a project `.claude/settings.json` with an `env`
   block naming an observer configuration through `COUNTERPARTS_CONFIG` and
   setting `COUNTERPARTS_OBSERVER=1` — verified that day to reach both the hooks
   and this host's MCP servers, which was the part that was not obvious. It
   worked; it was a JSON file, a second config file and two environment variables
   to say "not here".

   It is now one line: `counterparts scope . --off`, writing one entry in
   `<config dir>/scopes.json` (`adapters/scopes.ts`). `off` is stronger than the
   old mechanism as well as shorter — the old one was observer, which still
   delivered the wake and recall; this one produces no output and writes nothing,
   because the entry point refuses before a store is opened (CONTRACT §5 G19).
   `--observer` is the same word for the old behaviour, and `--on` puts it back.

   **The old mechanism is untouched and still governs.** The stance the
   configuration and the environment produce is combined with the registry's by
   `effectiveStance`, most restrictive wins — so the three private directories,
   which have no registry entry, behave exactly as they did. (G39's complaint —
   that the guard and `COUNTERPARTS_OBSERVER` accepted different value sets — was
   closed separately, in `adapters/stance-env.ts`.)

8. **There is no pause/resume for a directory that is normally on. — CLOSED
   2026-09-10 (G43).** `counterparts scope . --pause` is off-for-now and records
   `resumeTo` — what the directory thought it was — so `--resume` puts back
   `observer` where the directory was observer, and `on` where it was on or was
   simply switched off. The directory never changes its mind about what it is;
   the pause is the temporary version this gap asked for, and it is a command
   rather than an edit. The MCP `scope` tool takes `pause` and `resume` too, so a
   session can be paused from inside itself.

**Host fact, 2026-09-10:** three private project directories are running in
observer mode by the mechanism in item 7. Sessions there deliver wake and recall
and capture nothing, by configuration. A daily record that reads few turns from
those directories is reading the configuration working, not a fault. **They are
unchanged by the scope registry** — they hold no entry in it, and the combination
rule only ever adds restriction — so the migration to `counterparts scope
<path> --observer` is the owner's to make when they feel like it, not something
this change did to them.

---

## 8. The embedder: what it closed, and the four things it deliberately did not

Written 2026-08-29 alongside `embed-client.ts` — the first embedder this package
has ever had. `Store.open({ embed })` held the socket from the day it was
written and nothing constructed one, so every memory in the store recorded
`novelty: null`, reason `no-chunk-vector` (replay review F4/F5).

**Closed.** A Voyage client on bare `fetch`, chunked with per-chunk failure
isolation (E1), credential from `VOYAGE_API_KEY` alone with a named pre-flight
refusal (§2.18), its own pinned seat with an expiring placeholder (§2.15), and
egress behind an explicit `embedder.enabled` knob that defaults OFF. Both
composition roots build it: `openAdapter` and `bin/runner.ts` — the second
matters more, because the sweep is where most memories are minted.

### 8a. `Embedder` was widened to `(text) => number[] | null` — a core edit

A production embedder is a network client behind a cache, and `put` /
`rebuildCache` are synchronous: a lookup that misses has nothing to return.
Throwing would fail a write over a rebuildable cache; returning `[]` would write
a dim-0 row that every cosine reads as 0.0 similarity. So a miss is `null` and is
counted as `unrecomputed` — the same shape `tools/replay/INTERFACE-GAPS §4` asks
for ("a cache miss must be a counted `not-exercised`"). Two call sites in
`store/index.ts` changed; every existing sync embedder still typechecks.

### 8b. The sweep door and `chunkVector` — CLOSED 2026-08-29 (the slices ruling)

The owner ruled, and the vector now reaches `encodeChunk`: `sweepFallback`
memoizes one chunk vector per content key (raw transcript crossing
`redactSecrets` before the embedder — the egress rule held on a pre-battery
surface) and both the prompt cards and the gate select against it. Swept
memories record real novelty whenever a vector source is wired; without one
the semantic channel reads `skipped` and the run is lexical-only, said out
loud. The warm call remains the box-3 half.

### 8c. The episode door is BLIND, and now says so instead of pretending

`EpisodeGate` is synchronous by type, so `episodeGate()` cannot pay for a live
embedding the way `batteryGate()` can (`GateFn` may return a promise, and
`submitProposal` awaits it). The first draft therefore gave it a cache-only
lookup — which was worse than nothing: `EpisodeGateVerdict` has **no field for a
novelty number**, so anything computed there fed a gate decision that never reads
it (`gateProposal` consults `input.novelty` only after its refusal branch has
returned) and was then dropped. A decorative wire, the same defect 8d describes,
caught in review before it shipped.

The parameter was REMOVED rather than kept with an apology in a comment.
`episodeGate()` takes no vector source, computes `computeNovelty(null, [])`, and
episodes record `novelty: null` with reason `no-chunk-vector` — which is exactly
what they did before this build and is now the honest statement of it.

**The honest fix, two halves, both outside this build:** `EpisodeGateVerdict`
needs somewhere to carry the number (8d's change, applied to the other verdict
type), and `self/` should consult its injected gate everywhere the way
`ingestEpisode` does (gap 3). Until both, the door is blind by construction.

### 8e. FOUND IN REVIEW: the authored door embedded RAW text — fixed by reordering

**What happened.** `batteryGate` embedded `input.content` — the author's draft —
and gated it afterwards. An adversarial review proved the leak through the real
`submitSessionEnd` path: a planted Google API key reached the recorded embedder
**verbatim** while the prose written to disk was correctly redacted. Egress
bypassed a gate the store did not.

Every existing secrets test passed the whole time, and that is the lesson worth
keeping: they all assert what is DURABLE (`prose/` holds no credential), and this
leak was on the wire. "A gate covers every ingestion path and every side channel"
(scar §2.7) had an unwritten clause — the side channel can also be an EXIT.

**The fix** is the ordering the sweep door already used
(`counterpart.applySweep` warms `result.accepted`, post-gate): gate first with
novelty not yet known, return immediately on a refusal (nothing refused is ever
embedded), embed the gate's text, then compute novelty and attach it. Safe
because the battery's accept/refuse never consults novelty — verified by reading
`battery.ts`, not assumed. The rejected shortcut was calling `redactSecrets`
before embedding: it would have stopped the credential and left 8f standing.

**The tripwire** is `test/claude-code.test.ts` — "the embedder is handed the
GATED text": it records what the embedder was actually handed and asserts
`[REDACTED:` present and the credential absent. Confirmed to FAIL on the pre-fix
tree (its failure message prints the raw key), which is the only reason to
believe it would catch a regression.

### 8f. FOUND IN REVIEW: a gate rewrite used to throw away the vector it paid for

The same ordering bug, wearing its other face. The cache keys on the text it was
asked for; `Store.indexOne` looks up `indexTextOf(title, body)` where `body` is
the GATE's output. Embedding the raw draft therefore cached under a key the store
never asks for, so every redaction, hedge or alias rewrite — 18.9% of chunks in
the replay corpus — silently cost the deposit its vector, leaving box 3 emptier
than the run's own telemetry implied.

Fixed by the same reorder: one string, embedded once, looked up by the same key.
Held by "a gate REWRITE keeps its vector", also confirmed failing pre-fix. The
comments at `counterpart.ts` (`LiveVectors`) and `store/index.ts`
(`indexTextOf`) asserted this property while it was false; both now name the
ordering that makes it true and what breaks if it is reversed.

### 8d. `GateVerdict` gained `novelty` — without it the wire was decorative

The battery computed novelty at the authored door and the verdict had nowhere to
put it, so `submitProposal` built the `Proposal` from the DRAFT's salience and
the number was discarded before `mintProposal` ever saw it. Three lines in
`remember/proposals.ts` (an optional field on the `ok` arm, and a merge into
`proposal.salience`) carry it to the mint. It is optional and null-able on
purpose: a gate with no vector source omits it, a gate that tried and could not
measure sends `null`, and those stay different records. `verdictFor` therefore
attaches NOTHING — it runs before any vector exists — and `batteryGate` attaches
the value after the gate has spoken, which is what keeps the omitted/null
distinction real rather than documented.

---

## 9. The hooks and the MCP server can name different stores, and nothing notices — FOUND LIVE

*Written 2026-09-10, from the live host. LAUNCH-STATUS I31.*

**What happened.** This host registers MCP servers from a static configuration:
`~/.claude.json` carries the server's `env`, and the counterparts server is
launched with `COUNTERPARTS_DATA_DIR` naming the live store. The hooks do not
read that file at all — they take `dataDir` from
`~/.counterparts/claude-code.json`. From 2026-09-04 15:16 until 2026-09-10 08:15
those two named **different directories**: the config's `dataDir` had been
overwritten with a temp path (I29), while the server kept opening the live store.

**What it cost, and why it was invisible for six days.** Gap 7 above describes the
session record this adapter writes so the tool can find the session:
`<dataDir>/sessions/<id>.json`, written at SessionStart, refreshed at Stop. The
hook writes it into ITS store. `requireBoundSession` in
`src/adapters/mcp/server.ts` reads it back with `readSession(registryDir)` — the
SERVER's store. Split the two and the mechanism has a writer in one directory and
a reader in another, so **every `session_end` and every `chapter` call was refused
`session-unknown`** for the whole window. The authored front door that gap 7 was
written to open was shut again, by configuration rather than by design, and the
refusal names the session rather than the split, so the message told nobody what
was actually wrong.

Nothing leaked: the live store's `operational.sqlite` mtime stayed at 2026-09-05
and its last active date stayed 2026-09-04 through every daily record. The server
held the live store open and refused every write that reached it. The refusals are
the evidence.

**The honest fix, and it belongs to `mcp/`.** The server can see this at startup
and the operator cannot. When it resolves its registry dir, it should also resolve
the hooks' configured `dataDir` and **refuse to bind a session when the two
differ**, naming both paths — the same shape as `assertSafeDataDir`: resolve both
sides, compare, refuse before anything opens. The alternative sometimes proposed —
have the hook write the session record into both stores — makes the split legal
instead of loud, and a split store is never what anyone wanted.

**Why the #80 guard does not cover this.** `COUNTERPARTS_REQUIRE_EXPLICIT_DIR`
refuses a store nobody named. Both of these stores were named, confidently, by two
different files. A guard against silence does not catch two voices disagreeing;
that needs a comparison, which is what the fix above is.

---

## 10. `remember/` has no way to ADVANCE A CURSOR without depositing (#92 review, F1)

*Written 2026-09-15, from the scope-controls review.*

**The ask.** A boundary that discovers it joined the memory late — no session
record, cursor still 0, because this directory was `off` or `paused` when the
session started and has been turned back on since — must move the read cursor to
the end of the transcript it can see WITHOUT appending any of it
(`CONTRACT.md` §5 G22). `remember/` has no such method: `capture` is the only
thing that writes a cursor, and it writes one as part of depositing.

**What the adapter does instead, and why it is a workaround rather than a
design.** `hooks.ts#sealJoinedLate` calls `captureSpans` with `turns.length`
PLACEHOLDER turns whose `source` is `tool`. `enters()` refuses that source, so
`SpanBuffer.captureInner` takes its ALL_EXCLUDED arm — "nothing conversational
happened: still advance, or the same tool output is re-scanned forever" — which
advances the cursor to `turns.length` and appends nothing. It is correct and it
is tested, and it depends on an arm of a core function that exists for another
reason, through an argument that is a lie about what happened.

**What would say it instead:** `SpanBuffer.sealCursor(scope, session, turns)` —
one `mutate("capture", …)` around `writeCursor`, returning the same
`CaptureResult` shape with a `SEALED` reason, and `Counterpart.sealSpanCursor`
beside `captureSpans` to reach it. Roughly fifteen lines in
`core/remember/spans.ts` plus a name in `CaptureReason`. It is a CORE change and
the review that found the bug deliberately did not make one; the fix shipped
adapter-side and this is the entry that says what it is standing in for.

---

## 11. `self/` does not export what a sentinel LOOKS like (2026-09-17, S2)

*Written from the wake-delivery repair.*

**The ask.** `self/briefing.ts` composes both wake sentinels and holds the two
regexes that read them back — `OPEN_RE` and `SENTINEL_RE` — as module-private
constants. `readSentinel` is exported, but it answers only for a string that IS a
whole bundle: it takes the LAST LINE and requires the stated bytes to equal the
string's own. What arrives at the host is not that string. It is the injected
block (the wake plus, on a first launch, the scope question) or, on a day that
carried a notice, the JSON envelope the hook printed — so the sentinel has to be
recognised INSIDE a larger text, and its stated bytes cannot be checked against
that text's length.

**What the adapter does instead.** `transcript.ts` carries a second spelling of
both patterns — the literal prefix located with `indexOf`, then an anchored
pattern run on one bounded slice, so a match is the sentinel string byte for byte
and the scan stays linear over an arbitrary transcript. Two copies of one shape,
in two modules, which is exactly the arrangement `FOREIGN_MARKERS` exists as one
exported constant to avoid.

**What would say it instead:** export the two patterns from `self/`, or a
`findSentinels(text)` that answers `{ head, tail }` over an arbitrary string
beside today's whole-bundle `readSentinel`. A handful of lines, and a CORE
change — which is why the repair shipped adapter-side and this entry stands in
for it.

**A residual of the repair: the check identifies its own hook BY ITS COMMAND
LINE.** `COUNTERPARTS_HOOK_COMMAND` knows two spellings — the source path the
owner's host runs (what the 2026-09-17 measurement read off a live transcript)
and the `counterparts-hook` bin `package.json` installs. A third is possible and
unmeasured: a compiled binary under some other name, which the runtime question
in LAUNCH-STATUS may yet produce. The cost of missing it is a session that reads
`not-found` on a wake that actually arrived — visible rather than silent, and
one token to fix once the launch wiring is decided.

**The second half, still open: nothing checks that RECALL arrived.** A recall
block states its own sentinel at every `UserPromptSubmit`, and the line that used
to hold it was the same dead in-process `Map` the wake's expectation lived in, so
it never answered either. The wake's answer works because the bundle is delivered
ONCE per session and the host records it in an attachment at the head of the
file; a recall block is delivered every turn, and checking each one means a
per-turn expectation and a read positioned against the turn rather than the head.
That is a different mechanism, not a wider parameter, and it is not built.

---

## What the spawn-seam repair still owes (I32/I33, 2026-09-11)

1. **Nothing SAYS the worker has not run — CLOSED 2026-09-14.** `spawnRefusals()`
   and the durable `adapter.spawn.refused` rows made the fact readable and no
   surface read them, which is exactly the posture that let I32 run for a week.
   Both surfaces now exist and share one library (`doctor.ts`), so they cannot
   disagree: `ClaudeCodeAdapter#notice` puts the worst RED finding in the
   owner's terminal at SessionStart as the hook's `systemMessage` (red only, no
   nag; amber is the console's), and `counterparts doctor` prints the whole
   reading read-only, exit 1 on any red. The counters are read by `doctor`'s
   Spawn finding, which goes red at `TUNABLES.ESCALATE_AFTER` and names the
   reason. See NOTES, "The warning reaches the terminal".
2. **No command restores a credential — CLOSED 2026-09-14.**
   `counterparts credentials set <NAME>` writes one name into the file the
   configuration names, at 0600, with the value from stdin or `--from-env <VAR>`
   and never from argv, never echoed, never logged. It replaces that name's line
   (the template's commented placeholder included) and keeps every other line and
   comment; `credentials list` says which names the file holds. `install --force`
   keeping a file that holds a key (§E) was the other half.
3. **The ask cap's day is UTC — LIVE AGAIN 2026-09-18.** This read MOOT from
   2026-09-17, when the cap counted per SESSION for the session's whole life and
   had no day at all. It counts per session PER CALENDAR DAY again, on
   `Store#today` (UTC), so an owner at UTC−6 gets the day's allowance back at
   18:00 local. `input.at` is still the host's UTC ISO date and still stamps
   every `adapter.ask` row, because every other `date` field in the store is UTC
   and two clocks in one store is a scar this repo already has a name for. The
   fix, if the mid-evening reset is ever felt, is one per-owner zone read
   wherever a day is decided — `self/INTERFACE-GAPS` carries the decision.
4. **The two poisoned titles are not repaired.** The embedder no longer chokes on
   them and the backfill no longer stalls behind them, but the two memories on the
   owner's store still hold a lone surrogate in their payload JSON,
   and what gets embedded for them is the U+FFFD form. A versioned title repair
   is a live-store write and the owner's wording (G46 item 5).
5. **The refusal counter never decays on its own.** It is cleared by a spawn that
   starts, and by nothing else. A host that refuses once, is fixed by hand, and
   never reaches another boundary keeps a stale count until it does. Acceptable
   — the counter's only consumer is an escalation that a start disarms — but it
   is not a time series, and nothing should read it as one.
6. **Overlapping runners contend for box 2.** I33 measured six workers at one
   boundary against a 5 s `BUSY_TIMEOUT`. Every meta write this PR adds (the
   refusal counters, the per-id embed failures) is wrapped so a lost lock costs
   the counter and never the run — but the contention itself is unaddressed, and
   a worker that skips its own increment is a counter that reads low. The
   embed counters are at least down to ONE transaction per run
   (`Store.setMetaMany`) rather than one per id; the spawn counter still takes
   its own.
7. **The give-up gate is per FILL, not per id.** `embed.failed.<id>` may only
   climb when the last fill blamed one input — a 400 the bisector narrowed to a
   single item — which is what stops a 503 or a watchdog abort from retiring a
   healthy window. But a `ChunkFailure` carries offsets into the embedder's own
   deduped batch, which do not address the backfill's ids, so the test is "did
   this fill see poison at all". A fill that mixed an isolated 400 with a 500
   elsewhere therefore still charges the 500's victims. Closing it means carrying
   the failing texts' hashes out of `EmbedderStats` — a new surface, and the
   cache-key hygiene rules apply to it, so it was not taken here.

## What `doctor` and the checkout finding still owe (2026-09-14)

1. **`Store.eventLog` has no descending read**, so "the newest row of this name"
   costs a ladder of lived-day windows instead of one query. Filed in full as
   `cli/INTERFACE-GAPS` §10, where the console's other asks against `store/`
   live; the workaround is exact, not approximate, and the cost is up to five
   queries on a 150 ms hot path.
2. **`adapter.checkout` is a durable name in `core/counterpart.ts`.** The third
   time the core has learned a string for an adapter's sake, and for the same
   narrow reason the spawn names did: `dashboard/registries.ts` derives
   `DurableEventName` from these literals, so a durable event named in the
   adapter would fail the registry's totality silently. The core knows a string;
   it knows nothing about git. If that derivation ever moves, this line and the
   two above it should move with it.
3. **The checkout reading is a git subprocess on a foreground hook.** Bounded by
   `CHECKOUT_BUDGET_MS` (1 s for the WHOLE reading, each call taking what is left
   of it, never throwing, degrading to a neutral finding) and cheap in practice,
   but it is still four to seven `git` invocations per session start, and it is
   the only place this adapter shells out at all. The budget is the answer to the
   review of #108, which measured 7.81 s against a sleeping git when each call
   had its own 2 s ceiling and nothing bounded the set. If it ever shows up in a
   session-start measurement again, the cheap fix is to read `.git/HEAD` and
   `.git/refs/remotes/origin/master` directly and keep git for the ancestry test.
4. **It grades `origin/master` AS LAST FETCHED, and never fetches.** A tree
   nobody has fetched in a week reads `master` while origin has moved on, which
   is the exact failure the `behind` grade exists to catch — one layer earlier
   than this reading can see. The honest fix is a fetch somebody else performs
   (a cron, the merge itself), not a network call on the wake's path.
5. **The notice is red-only and says so, which means AMBER has exactly one
   reader: the owner running `doctor`.** A store that sits amber for a month —
   embedder off, vectors uncovered, a checkout quietly behind — tells nobody
   until somebody asks. That is the deliberate trade (a notice people mute is
   worth less than one they read), and it is a trade, not a property.
6. **The notice loses to the wake, and the owner is not told when it does.** The
   host caps a hook's stdout at 10,000 characters, so over `ENVELOPE_MAX_CHARS`
   the hook prints the plain wake and drops the notice — which means the red day
   with the longest wake is the day the terminal is most likely to stay silent.
   All that is left behind is an `adapter.notice.dropped` ring row, and a ring row
   dies with the process. Closing it properly means either a durable row (a write
   on the wake's path, which §5 G2 argues against) or a second channel that is
   not the wake's — neither was taken here.
7. **Three findings cannot say "I do not know" — they say green.** `Severity` is
   red / amber / green, so the unknown-newest-row reading (`undetermined`) is
   reported as GREEN with a sentence that explains it is not a grade. Right for
   the notice (unknown must not warn) and wrong for a reader counting greens. A
   fourth severity is the honest shape, and it touches the report, the JSON, the
   dashboard and every caller that partitions on three.

## 12. Nobody has run a windowless host session, and this adapter cannot prove one from inside the suite (2026-09-20, S2)

Host mode is the owner's pick for the nightly page writer, and every part of it that is
this package's — the plan, the argument and environment shape, the watchdog, the claim, how
the outcome is read back — is under test against a stub executable. Three things are not,
and cannot be without a real machine and a real login:

1. **Keychain access from a background process.** The child authenticates with the
   subscription login, and the detached worker that starts it is not a terminal. The
   documented route for unattended runs is `claude setup-token` (spec §16). Until somebody
   runs it, `NO_CREDENTIAL`-shaped failures will surface as `failed(exit …)` on the run's
   row, which is honest but not diagnostic.
2. **That SessionStart hooks actually fire inside `claude -p`.** The whole reason for host
   mode is that they do — it is what makes the child a session of the self rather than a
   stranger with a prompt. The docs say so; no probe here has watched it happen.
3. **That `--allowedTools` with one MCP tool name and `--permission-mode default` really
   leaves the child with one tool.** The SPELLING is confirmed — this host lists its
   counterparts tools as `mcp__counterparts__chapter`, `mcp__counterparts__session_end` and
   so on, so `mcp__counterparts__self_page` follows the convention. What is unproved is the
   flag pair's effect on a windowless run. A spelling or a flag the host does not honour
   fails CLOSED (the tool prompts, nobody answers, the run ends with the page untouched and
   a `nothing-to-say` row), which is the right direction but is indistinguishable from a
   night that genuinely had nothing to say.

Filed here rather than guessed at: the exact steps the owner has to run by hand are in the
PR that landed this, and until one of those runs happens, `session` mode is the one that is
known to work.

## 13. The "nightly" writer is not nightly anywhere west of UTC (2026-09-20, S2 review)

`store.today()` is `new Date().toISOString().slice(0, 10)` — UTC, like every other date in
this store, by the decision `store/index.ts#dateOf` records. The page writer keys its night
off that date, so from US Pacific the day rolls over at 5 p.m. local: "yesterday" becomes
available, is claimed and is written **in the late afternoon**, and the window it covers is
5 p.m.-to-5 p.m. local rather than a person's day. The morning session finds the night
already claimed.

**Nothing here is being changed for it.** Two clocks in one store is a scar this repo
already has a name for, and `learned_on` — the field the writer selects the day by — is
stamped on the same calendar, so a locally-dated writer would read a UTC-dated day and get
a different set of memories than the one it named.

**What WAS changed is the words.** The block, the doctor line and the contracts say which
DATE a run is about and never "last night" or "this morning", because those were the only
part of it that was actually false.

The real fix, if the owner wants one, is the one `self/INTERFACE-GAPS` §9's neighbour asks
for: a per-owner zone read wherever a day is decided — one clock, moved once — and not a
second clock bolted onto this mechanism. Until then it belongs on the findings list for the
first blank-store trial, where it is a thing to notice rather than a thing to fix.

## 14. A prompt typed while the model is working never reaches the transcript reader (2026-09-23, B1 review M3)

**Pre-existing; found by the adversarial review of PR #186, measured on the owner's
machine (shapes only).** When the person types while the model is still working, Claude
Code writes the prompt as an ATTACHMENT, not a user entry:

- `type: "attachment"`, `attachment.type: "queued_command"`, `attachment.commandMode:
  "prompt"`, `attachment.origin.kind: "human"`, the text in `attachment.prompt` (a string,
  or an object when an image was pasted), plus `source_uuid` and sometimes `humanTurn`,
  with `rendered` / `renderedInHumanTurn` on the entry;
- 76 seen. **58 appear nowhere else in their file**; 18 are later written again as an
  ordinary user entry.

`parseTranscript` reads only entries with a `message.role`, so those 58 are the person's
own words missing from BOTH pacing and capture — about 6% of typed turns on this machine.
(The same attachment type also carries `commandMode: "task-notification"` and `peer`
prompts; those are host-written and are correctly not the person.)

**Why it was not fixed in B1.** Reading them means inserting new turns into the list, and
the per-session capture cursor indexes into that list: a session that spans the deploy
would have its uncaptured tail re-sliced, the failure `transcript.ts`'s header names. It
also needs a dedupe against the later user entry for the 18 that are written twice —
by uuid (`source_uuid` → the later entry, if the link holds; unmeasured) or by exact text.

**What a fix needs:** (1) a cursor that survives turns being inserted before it (an
entry-uuid cursor rather than an index, which is `remember/`'s to offer); (2) the dedupe
rule, measured; (3) a fixture with one queued prompt that is later duplicated and one that
is not, pacing as one and two turns respectively.
