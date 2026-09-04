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
its scope (the hook's own cwd, set once so a later hook cannot move it), and the
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
