# Bansai v2 — behavioral specification

*Harvest artifact, Phase 1 (2026-08-25). Describes WHAT v1 does, at the altitude that
survives a rewrite. Authority: `docs/v2-constitution.md` — line 2, "how interpretation
happens ... is a design choice, never doctrine." Every stage is stated as purpose,
inputs, outputs, invariants, and knobs. Nothing here is a storage format, file layout,
model seat, or host integration; where a v1 mechanism is named it is named in
parentheses as provenance so an implementer can find the receipt — never as a
requirement.*

---

## 0. Reading rules

**What the four sections mean.**

- **PURPOSE** — one line, naming the human-memory mechanism it models (constitution
  line 12: when in doubt, follow the brain; deviations are named).
- **INPUTS / OUTPUTS** — kinds of information, not files, tables, or wire formats.
- **GUARANTEES** — invariants a v2 must keep, whatever its mechanism. A guarantee is
  listed only if v1 enforces it *structurally* (a refusal, an ordering, an absence, an
  idempotence) or if the owner ruled it doctrine.
- **TUNABLE** — knob versus structural. v1's keys and shipped defaults are recorded as
  *current calibration*: the best surviving record of which quantities were ever worth
  arguing about and roughly where lived use put them. v2 owes them no fidelity — it owes
  them a reason when it differs.

**Three categories are kept distinct throughout, and must not be collapsed:**

1. **GUARANTEES** — what must hold.
2. **Known gaps** — where v1 does not do what it intends. Recorded so v2 does not
   inherit them silently. Never a guarantee.
3. **Rescoped** — v1 invariants the owner deliberately released for v2. Never ported.

**The three rescopes** (DECISIONS 2026-08-25). Where a stage touches one, it specs the
kept kernel, not the released ceremony:

| v1 invariant | v2 property | released |
|---|---|---|
| "The DB is a cache" — everything reconstructible from files | prose + identity stay prose-canonical; operational/structured state may be transactionally canonical | the universal rebuild contract (it now covers the prose index only) |
| Local-only, nothing ever leaves the machine | **No silent egress** — the owner owns the data; it leaves only by explicit owner action, encrypted, owner-keyed | the absolutism (bodies already transit model and embedding APIs) |
| Never-destroy / staged tombstoned erase | **No AI-reachable path may destroy the only copy of a memory**; removal is loud, recorded, owner-initiated | forever-archive; the staged cooling-off erase ceremony (871 lines, never production-fired) |

**The spine, stated once: mechanized versus instructed.** v1's most reusable
organizing distinction. *Mechanized* — enforced by the engine, no prompt involved:
every gate, the content floor, the task-state/event-date exclusion, the self-store
salience clamp, the triple refusal of self-schema birth, the identity freeze, the
gated-chunk rule, coverage partitioning, the wake budget and trim order, observer
stand-down, every op-engine refusal. *Instructed* — a preference stated to a model:
note priority, the thread admission test, noise heuristics, surprise anchors, "empty
output is a correct output", the episode-lens precedence rule. **Anything mechanized is
a contract v2 must re-implement. Anything instructed is a preference v2 may restate.**
Every place v1 got burned, the burn was a guarantee living in the second list.

**Failure philosophy, also stated once:** host-facing entry points never fail the host;
telemetry never blocks anything; every log payload is content-by-reference; safety
properties are never behind a toggle; and on any doubt the pipeline **restores rather
than consumes**.

**Decisions are defaults** (constitution line 13). Where this spec records an owner
ruling as doctrine — lived-salience identity, arrival-is-a-cue, observer read-only — it
does so because the ruling is *behavioral*, not because it is unchallengeable.

---

## 1. Wake / identity injection

**PURPOSE** — Restore the continuous self at session start: identity is *re-inhabited,
not retrieved* (analog: waking as yourself; core memories are constitutive, not
recalled — DECISIONS 2026-08-15).

**INPUTS** — a pre-rendered identity bundle produced by the *previous* session's
consolidation; session-start facts only (which session, which project, observer or not).

**OUTPUTS** — one block of prose injected into the new session's context, framed
explicitly as **context, not instruction**; a record that the bundle was *delivered*
(distinct from the record that it was *rendered* — render ≠ delivery was a real blind
spot); on a store with no bundle, a single honest bootstrap line, never an error.

**Bundle content, in composed order** — an *index*, not a dump:
1. a **self-heal header** stating the bundle's own true byte count and where to read the
   full render;
2. the **second-signature reminder**, only when protected proposals await the owner;
3. the identity index (compressed statements with pointers into dormant shelves);
4. the **craft lane** — procedural/skill self, rendered as *content*, not a pointer;
5. open threads;
6. warm-shelf hints;
7. arriving occasions (the horizon);
8. a standing pointer to the deliberate self-store channel;
9. a **tail sentinel** restating element/craft/thread counts and total bytes.

**GUARANTEES**
1. **Zero compute, zero model calls, zero network at wake.** Cold-start cost is constant
   in store size; the bundle's cost was paid by the previous boundary.
2. **Hard byte budget, with integrity detectable from either end.** The header and the
   sentinel both state the bundle's own total, so a truncated injection is detectable
   from a truncation *preview* alone. Because both lines state a number that composing
   them changes, composition iterates to a fixed point.
3. **Trim order is declared policy, and furniture is untrimmable.** Lanes drop in a fixed
   precedence (v1: hints → craft → threads → horizon → identity index last; craft before
   threads so craft can never displace core). Two lines sit outside the trim loop by
   construction: the second-signature reminder — *a proposal that never expires must not
   be a proposal the waking session is never told about* — and the self-store pointer.
   Their bytes still count against the budget; the lanes pay for them.
4. **Trim order within a lane is policy too.** (v1 threads: person-scoped first, then
   oldest-opened first; the trim eats from the end, so long-held relational debts drop
   last.) *Truncation must never be iteration luck.*
5. **Atomic publish.** The bundle is replaced atomically so a concurrent read sees old
   or new, never empty — "empty is falsy and masquerades as a fresh install."
6. **Compressed identity stays nameable.** Compression may shorten a statement but must
   preserve the handle a later prediction check names — shorter, never unfalsifiable.
7. **The wake never fails the session.** Missing bundle, unreadable config, failed
   telemetry: inject the bootstrap line or nothing, and exit clean.
8. **Observers receive the wake.** Observation is a read; it is marked in telemetry and
   otherwise unchanged.

**TUNABLE** — total budget; the identity-index sub-budget and element cap; per-lane caps.
**Structural** — the header/sentinel pair; the trim order existing and being declared;
the untrimmable riders; pre-render, not render-on-wake; the "context, not instruction"
framing.

**Host coupling to isolate (important for a host-agnostic core):** v1's 9,000-byte budget
is 90% of one host's injection cliff. **In v2 the injection ceiling is a host capability
the adapter reports, not a core constant.** Likewise v1's day-alternating "mute the wake
entirely" behavior is an A/B artifact of running two memory systems side by side; it is
not a memory property.

**Known gap (v1) — derived-index staleness has no reconciler.** The identity index is
seeded once, and the routine that would add newly-formed identity elements to it *is
never called at a boundary* — it is an owner-run script. The boundary-time "refresh" is
log-only despite its name. So identity elements formed after seed day are invisible at
cold start until a human remembers to run something. This is exactly the class of gap
autonomous recompression was created to close, left open one door over. **v2 rule:
every derived surface owes a scheduled reconciler, and "a script the owner runs
occasionally" is not one.** (A related instance: the craft lane was for a long time
reachable through *neither* door — not in the bundle, not a recall node. Every identity
surface owes an answer to "which door reaches this?")

---

## 2. Turn boundary + span capture

**PURPOSE** — Get lived experience into durable holding fast, so judgment can happen
later without the host waiting (analog: the stenographer's tape feeding a delayed
encoder — deliberately *not* a sensory register; attention arrives minutes late by
design).

**INPUTS** — conversational turns added since this session's last boundary; session
identity, project scope, the moment; deliberate marker spans deposited in-session.

**OUTPUTS** — one appended span (text, session, scope, project, timestamp, content
hash); the assistant's turns kept separately (the substrate for "was a surfaced memory
actually used?"); ritual pacing counters; a detached consolidation attempt.

**GUARANTEES**
1. **Boundaries are appenders, not thinkers.** Capture completes in microseconds; all
   judgment runs detached. The host never waits on a model call at a boundary.
2. **A span is never lost between read and encode.** The read position advances *only*
   after a successful append; a failed append re-reads the same content next boundary,
   and content-hash dedup makes the retry idempotent. **Bounded duplication is an
   acceptable failure; loss is not.** The same ordering governs pacing counters, so a
   retried span is never double-counted.
3. **Two dedup layers, both needed.** A read cursor handles a *growing* transcript; a
   content hash handles *exact* repeats. Hash dedup alone cannot catch cursor
   regression, because a superset slice hashes differently.
4. **Read positions are per-session and disjoint.** (v1 shipped a shared cursor map; two
   concurrent boundaries silently dropped each other's advance and re-encoded
   overlapping spans.)
5. **Every session-ending path is a boundary** — normal stop, session end, and
   pre-compaction. Compaction destroying the transcript must not destroy the day. This
   is the *compaction-amnesia backstop* that killed the "let the live model write
   everything" design.
6. **Claim/consume is atomic-rename choreography, not a mutex.** The live buffer is
   renamed *aside* first so concurrent appends land in a fresh file and cannot be
   destroyed by the claim; a crashed run's leftovers merge in, deduped by hash; the
   claim is truncated **only after** results are applied and persisted. At every crash
   point every span is in claim-or-buffer.
7. **A failed restore forbids consuming the claim.** If putting failed spans back
   *itself* fails, the claim is kept. Otherwise a failed arc lives in neither place.
8. **Below a minimum claim size, nothing runs** — scraps ride to the next boundary.
9. **Every scope holding experience gets swept**, not only the one whose boundary fired.
   A project never revisited would otherwise keep captured spans forever.
10. **Conversational text only.** Tool output, file contents, images, and injected
    context never enter capture. This is a **declared blind spot**, and the deliberate
    self-store exists partly to cover it: an insight whose evidence was tool-borne must
    be volunteered, because no transcript reader will ever see it.
11. **Injected context is excluded from pacing but kept in capture.** Host-injected
    material that is user-role but is not the user speaking must not pace a ritual.
12. **Capture never throws into the host**; every failure is logged and swallowed.
13. **Observer sessions capture nothing** (§15).

**TUNABLE** — minimum claim size (200 bytes); transient-area retention.
**Structural** — advance-after-success; two-layer dedup; per-session cursors; the
rename choreography; restore-before-consume; the all-scopes sweep;
conversational-text-only.

**Note on the scar list:** v1's standing scar says "lock discipline on shared files
(buffers…)". The buffer path uses **no lock** — atomic rename plus hash idempotence.
That is arguably stronger. v2 should restate the scar as its actual property: *concurrent
writers must be unable to destroy each other's work*, by whatever mechanism.

---

## 3. Salience gating

**PURPOSE** — Decide what may become durable, and strip what must never be (analog:
encoding-time filtering, plus a hard safety interlock the brain does not have — a
deliberate deviation).

Gating is a **battery of independent checks over proposals**, engine-side, no model in
the loop. v1 runs four gates plus a content floor:

1. **Secrets** — credential- and key-shaped material is **redacted**; a proposal empty
   after redaction is rejected.
2. **Precision** — dates, years, and quoted strings not present in the source are
   **auto-hedged** ("mid-July", "recently"; a quoted phrase keeps its words and loses
   its quote marks). Softening, never dropping — a confabulation brake, not a truth test.
3. **Aliases** — every proposed retrieval alias must occur verbatim in the source, **and
   then passes its own secrets scan** (a verbatim-in-source alias can itself be a
   credential, and aliases are as durable as body text).
4. **Emotion (stated-only)** — a typed feeling survives only if the span *states* it: a
   cited quote the span contains, plus a named subject. The quote is stripped before the
   feeling becomes durable.
5. **Content floor** — empty, whole-content stub token, normalizes away to punctuation,
   or under a minimum length → refused as degenerate. (v1: 20 chars / 3 words, set at
   about half the shortest real memory in the repo's own fixtures; the stub list is
   matched *exactly after normalization*, never as a substring, so "keeps a TODO list in
   vim" survives.)

Ops carry their own rules: a secret in a *name* rejects the whole operation ("a
credential must never become an entity the store indexes"); a free-text op field fully
redacted rejects the operation; a matching key that never persists is exempt from
hedging ("a name is not a claim").

**GUARANTEES**
1. **The secrets gate is not ablatable.** No off switch, no A/B arm, no bypass —
   enforced by a **universality test that source-scans every caller** of the paths where
   text becomes canonical, including the outposts (episode ingestion, accommodation,
   the interpreter's own context excerpts, import). *A prompt is not exempt from the
   gate.*
2. **A fully-gated chunk moves NO durable state.** If gating rejected *everything* a
   chunk proposed, its prediction checks are dropped too: nothing may touch warmth,
   gradient, occurrence counts, or ledger evidence. Deliberately scoped to
   all-rejected — a chunk with one survivor was gated in part, not refused.
3. **Gates run on proposals, before anything is durable** — never as a post-hoc sweep.
4. **Every firing is content-by-reference**: gate name, kind, hashes. Never the secret,
   the quote, or the body.
5. **The emotion exemption cannot widen.** Exactly one recognized provenance — the
   deliberate self-store, where the span *is* the model stating its own feeling. It is
   set per proposal by the engine that minted it, evaluated against that proposal's own
   span, only when the subject is the model itself and the feeling is non-empty, and is
   never available to an interpreter result. **A claim about someone else's interior
   always takes the ordinary path, where a transcript exists to check it against.**
6. **A refused proposal is not a failed batch.** Rejection is data.

**TUNABLE** — floor length/word minimums and stub vocabulary; hedge phrasings; minimum
alias length. **Structural** — all five checks existing; secrets non-ablatable;
stated-only emotion and its single narrow exemption; gated-chunk-moves-nothing;
content-by-reference logging.

---

## 4. Interpretation — the memory-object taxonomy

**PURPOSE** — Store what was learned, not what was said (constitution line 2; analog:
consolidation as *interpretation* — what survives is the construal, not the record).

### 4.1 Authorship — two authors, one engine

- **The lived mind writes.** The in-session model may deposit a structured proposal in
  the moment: content in its own words, self-assessed salience, first-person feeling,
  optional kind/scope/title. It rides the deliberate-marker path and is **honored, not
  re-judged**.
- **The interpreter sweeps.** A detached pass reads unreferenced spans and produces the
  residual: facts, logistics, world-state, and crash/compaction backstop coverage.
- **The engine mints and gates both.** Neither author writes durable state directly.

**GUARANTEES**
1. **Self-assessed signals outrank inferred ones.** Where the sweep can see the session's
   own narration of a stretch, that narration takes precedence and the sweep's job
   narrows to the residual — *stated inside the narration block, not in the system
   prompt*, so a chunk with no narration is not told to narrow toward nothing.
2. **A self-authored proposal is minted by the engine, not paraphrased by the sweep.**
   Routing it through the interpreter would return the model's own words as someone
   else's paraphrase and its self-assessment as someone else's guess.
3. **Self-assessed salience is a floor, mechanized.** Durable salience is at least what
   the author claimed, clamped at the seam where a proposal becomes memory, and logged
   if it ever lifts. (Honest note: floor and proposed coincide today — the clamp
   guarantees nothing can quietly re-judge how much the moment mattered, and the event
   is what would make a future divergence visible instead of silent.)
4. **Coverage is claimed by hash, and coverage means down-weight, not deletion.** The
   engine — never the model, which cannot see the buffer — claims the most recent N
   uncovered spans, so successive proposals *partition* a session rather than each
   claiming the backlog. Covered spans still reach the sweep, marked as already
   authored. Only the proposal's *own* span is withheld outright, because re-encoding it
   is guaranteed duplication. **What the sweep loses is permission to write the same
   memory twice.**
5. **A rejected proposal claims no coverage.** If the gates reject it, nothing was
   authored, so its spans stay in the sweep's input.
6. **Marks are prompt-side only.** Coverage annotations never enter the text the gates
   check against, *so no gate can be loosened by a mark the engine wrote.*
7. **Privilege caps are structural.** A self-authored proposal mints memory objects and
   **never operations**: it cannot protect anything, cannot edit an identity core, and
   cannot even *flag* an identity claim — so it can never mint an identity belief. The
   only path into the core is accommodation (§6).
8. **A malformed proposal degrades to an ordinary span**, read normally by the sweep.
9. **Deliberate deposits are idempotent by CONTENT, not by span text** — two identical
   deposits cover different spans, so their span hashes differ and span dedup would miss
   the repeat.

**Known gap (v1), stated as a v2 rule:** the *other* deliberate channel — the plain
"remember this" note — states its privilege (at least one trace at high salience) **only
in the prompt**, with no engine backstop. It is the one place in the pipeline where a
stated guarantee has no mechanized enforcement. Contrast the self-store, where the
equivalent privilege *is* a clamp. **v2: every stated privilege is mechanized or is not
stated.**

### 4.2 The object taxonomy

Three families. What distinguishes them is **lifecycle**, not shape.

**(a) Trace — an interpreted episodic item, the unit of experience.**
Behaviorally load-bearing: a *kind* (selecting the physics table, §4.3, fixed at birth
and never re-derived); a scope; a confidentiality class; salience 0–1; a position on the
episodic→semantic→identity gradient; a typed emotion **or explicit null** (null =
inherited/unfelt; **retro-typing emotion is forbidden**); the interpretation prose (this
*is* the memory); retrieval aliases; named handles; an optional session-scoped task
flag; an occurrence count with a last-reinforced day stamp; a last-decayed day stamp;
and lineage (archived + reason, merged-into, derived-from).

**Three dates, deliberately distinct** — a v1 lesson worth porting verbatim:
- *when it happened* (event date, at stated precision: day, month, or year — never
  rounded);
- *when it was learned* (encode date — supersession reasoning needs it: two conflicting
  facts resolve to the later-encoded one);
- *which lived day it was born on* (the decay clock's integer).
A July-4 event encoded July-6 must not be invisible to as-of-July-5 reasoning.

**(b) Entity schema — the organizing unit** for a person, the self, a skill, a place, a
project/system. Sectioned prose: stable *core*; *current state* (timestamped); relations;
open threads; *beliefs* (with provenance, confidence, active/superseded); *protected*
elements; kept *lineage* of everything superseded; per-schema *archived core*; and, for
the self, a compact *index* whose entries point at dormant shelves.

**(c) Ledger entry — an open question about a belief** (§6). Not a memory; a pending
revision with pinned evidence.

**Episodes are not a fourth type.** An episode is a first-person artifact the session
authors, ingested as a self-kind trace (§13). *(v1's README lists "episode" among trace
kinds; the model has no such kind — a v2 taxonomy should not copy that.)*

**GUARANTEES**
1. **Every mutable sub-item carries a stable, immutable handle.** Three constraints force
   it: a ledger must reference a stable element rather than mutable prose; a refusal
   ("never touch a protected item") needs a stable target; logging by reference needs an
   id. *Prose is the content; the handle is the identity.* Pure lineage records
   deliberately have none.
2. **Ids are immutable, never reused, type-prefixed.** Resolution follows merge chains; a
   cycle, a dangling id, or an over-deep chain is a **hard error**, never a silently
   unresolvable reference.
3. **Archive is a state, not a deletion.** An archived item keeps its id and stays
   resolvable; it simply never surfaces.
4. **Aliases are first-class and change only through explicit alias operations** — never
   as a side effect of editing prose.
5. **Emotion is typed and attributed.** Whose feeling it is, is part of the record.
   Absent emotion is null, not neutral.
6. **Round-trip fidelity extends to metadata.** Unrecognized fields survive
   parse→serialize untouched. (v1 incident: a parser silently dropped tier / frequency /
   provenance / aliases on rewrite — canonical metadata loss with no loud failure.)
7. **Serialization is lossless by construction and refuses ambiguity.** Human-legible
   text alongside an authoritative machine payload, with the parser reading only the
   payload; content that could break the parser is **rejected loudly**, never silently
   truncated or dropped.
8. **Omitted-when-absent.** A section a store never used serializes byte-identically to a
   store that predates the section, so adding a capability churns no file.
9. **Traces never blend.** Generalization is only ever an explicit,
   provenance-carrying merge. Near-duplicates are accepted rent; the benefit is zero
   substrate confabulation (owner ratification 2026-08-08).
10. **Task-state is not memory.** Session-scoped intent expires to archive on a short
    active-day clock and never consolidates. A memory carrying a future date is the
    *opposite* object, discriminated at encode time by one question: **would this still
    be a true memory worth holding after the date passes?** The two flags are
    **mutually exclusive by construction** — the more conservative reading wins.

### 4.3 Per-kind physics (the current calibration)

Same engine, different parameters. The single most reusable piece of v1 calibration:

| kind | what makes it matter | revision inertia | gradient driver | decay multiplier | emotion as retrieval dimension |
|---|---|---|---|---|---|
| self | emotional | 0.9 | salience | 0.70 | 0.9 |
| person | emotional | 0.8 | salience | 0.75 | 0.9 |
| entity (project/system state) | load-bearing | 0.5 | both | 0.85 | 0.2 |
| skill | utility | 0.25 | repetition | 0.50 | 0.15 |
| place | utility | 0.25 | repetition | 0.85 | 0.3 |
| fact | load-bearing | 0.2 | both | 1.00 | 0.15 |

Read it as behavior: *a formative one-shot consolidates without repetition; rote trivia
never rides repetition into identity; a belief about a person moves slowly, a fact about
the world moves on one credible correction* (blessed as intended 2026-07-25 — the guard
against a hallucinated correction is reversibility plus a flip-flop meter, not slowness).

The **entity** row is a loosening chosen out loud: moving project state off the self
schema to its own home deliberately lowers its revision bar, because world-state should
flip on one clear correction.

### 4.4 The interpretation run

**INPUTS** — claimed spans; the schema slices preselected per chunk (§8); the session's
own narration where one exists; the current lived day and span date range.

**OUTPUTS** — proposed traces; proposed schema operations from a **closed vocabulary
deliberately narrower than the engine's** (current-state update, belief add, thread
open, thread close *as a claim*, protected add *as a proposal*, schema create — and
belief supersede, which is rejected on this path and reachable only through
accommodation); prediction-check verdicts (confirm / nuance / contradict) naming both
the element and **which proposed trace carries the contradiction**; and a run record
carrying counts, model identity, which schemas were shown and through which channel.

**GUARANTEES**
1. **Chunked, with per-chunk failure isolation.** One bad chunk never fails a run; failed
   chunks restore their input and announce themselves. Chunking is **lossless and splits
   only on span boundaries** — a span larger than the budget becomes its own oversized
   chunk rather than being cut, because a truncated span interprets to garbage.
2. **Truncation is a failure, not data.** Every call is checked for *why* it stopped;
   stop-for-length is retried once with doubled headroom, then failed. An empty
   completion is a failure.
3. **Long generations stream.** Non-streaming long calls die as fake connection timeouts.
4. **Restore-on-throw.** An outage means the arc is *retried*, not lost: input is
   restored and the failure throws rather than returning empty.
5. **A watchdog abort stops calling, immediately.** Remaining chunks are marked failed
   *without* being sent — otherwise each burns a full retry backoff against a dead
   signal and the whole run is discarded. **Abort is detected from the signal, not from
   an error's name.**
6. **A partly-malformed response keeps its valid items and drops the bad ones**; only an
   unparseable one fails. Parse failure earns one fresh retry — and only the parse step
   does, since transport failures have their own ladder.
7. **Error text is sanitized before it is recorded.** Parse errors quote the offending
   input verbatim — which is model text about the owner's conversation. Quoted content is
   stripped before logging. *The content-by-reference rule extends to error messages.*
8. **The engine resolves references; the model proposes semantics.** Ids flow to the
   model as optional context, never as required return keys. Closing an open loop is a
   *restatement of the matter*, matched engine-side (§6.3).
9. **Schema-level constraints hold in three independent layers** where they matter —
   response grammar, hand validator, engine — because *one of those layers is a parser,
   and parsers get relaxed*.
10. **Empty output is a correct output.** Selectivity is the job.
11. **The interpreter never strengthens the self** (§14).

**TUNABLE** — chunk size (16 KB); per-call token headroom (8,000); minimum claim (200
bytes); the narration excerpt budget (4,096, header included; 0 disables); the compressed
identity-core budget (6,144; 0 = verbatim); which model seat runs which job.
**Structural** — chunking with isolation and span-boundary splitting; the stop-reason
guard; streaming; restore-on-throw; abort-without-calling; sanitized error text;
engine-side reference resolution; the closed op vocabulary; the gates.

---

## 5. Consolidation — the run itself

**PURPOSE** — Do the slow work while nobody is waiting (analog: sleep consolidation —
replay, schema integration, cadenced gisting; deliberately broken into boundary-time
micro-sleeps rather than one nightly block).

**INPUTS** — claimed spans; the whole store; the clock; the previous run's completion
markers.

**OUTPUTS** — new and updated memory; ledger movement; decay applied; hygiene where due;
episodes ingested; the next session's identity bundle, written **last**.

**GUARANTEES**
1. **Detached from the host, single writer, hard watchdog.** One lock; a live holder
   inside its lease is respected; a stale lease is reclaimed **atomically**, so N
   simultaneous reclaimers produce exactly one winner. (v1's earlier unlink-then-create
   reclaim produced two live writers, a double-ticked clock, and racing ledger writes.)
2. **Two watchdog levels, and a cross-key invariant binding them.** A cooperative abort
   signal threaded into every model call, plus a process-level hard kill after a grace
   period — and configuration **refuses** any setting where the hard kill could land
   after the lock becomes reclaimable. *The single-writer lease depends on a wedged
   runner dying before its lock can be taken.*
3. **Day-gated work uses per-concern completion markers, advanced only after the work
   *and* its persist succeed.** Concerns gate on "active day > my marker", never on a
   transient "is this a new day" flag — so a crash between the clock ticking and the work
   finishing **replays that day exactly once** and never skips it. Markers only move
   forward.
4. **A budget is not a debt.** Some day-gated work (identity recompression) advances its
   marker only when it actually ran: a day it wasn't needed is not arrears to make up.
5. **Phase order is behavior, not implementation.** Clock → load → clock repair →
   per-scope (claim → deliberate-author pass → interpret → gate → assimilate → restore
   failures) → episodes → decay → accommodation → hygiene → recompression → persist →
   record completions → clear claims → rebuild derived index → prospective horizon →
   **render the identity bundle** → backup → prune. Consequences that must survive:
   decay runs *after* assimilation in the same boundary (hence the same-lived-day
   reinforcement exemption); recompression runs *after* revision so it sees this
   boundary's own supersedes; the identity bundle is the **last content write**.
6. **Degrade, don't abort.** Index rebuild, embedding refresh, horizon computation,
   backup, and every prune each fail without failing the boundary.
7. **The claim is truncated only after results are applied AND persisted.**
8. **Environment is pinned by the spawner, last**, so no caller can leak a run into the
   wrong store.

**TUNABLE** — watchdog duration; lease length; hygiene cadence; snapshot cadence.
**Structural** — detachment; single-writer with atomic reclaim; the watchdog/lease
invariant; completion markers; phase order; render-last; degrade-don't-abort.

---

## 6. Consolidation — assimilation, accommodation, and the ledger

**PURPOSE** — Bend experience into existing schemas by default; rebend the schema only
under sustained surprise (analog: Piaget's assimilation vs accommodation made
architectural, with a deliberately *higher* threshold than human belief revision).

### 6.1 Assimilation — the predict/compare loop

**INPUTS** — gated proposals for a chunk, plus the schema slices that chunk was shown.
**OUTPUTS** — durable traces; verdicts against named elements; reinforcement; belief
mints; ledger evidence; thread resolutions.

**GUARANTEES**
1. **Low surprise reinforces; it does not rewrite.** A confirm or nuance credits the
   element's *grounding traces* (§10), never the element itself: no statement changes,
   no confidence changes, no edge trains.
2. **Contradiction accrues, it does not act.** A contradiction adds *evidence*, carrying
   a surprise magnitude, the evidencing trace's salience, the belief's confidence, and a
   **lived-day stamp**.
3. **Evidence weight = how surprising × how much it mattered × how weakly the belief was
   held.** Note the last term's direction, which is counter-intuitive and deliberate:
   **a surprise against a low-confidence belief counts harder.**
4. **Evidence is anchored to the trace that actually carries the contradiction**, named
   by the interpreter — not guessed as "the chunk's most salient item." When the marked
   trace is unavailable the fallback is used and logged **distinctly**, so anchor
   fidelity stays measurable. With no anchor at all the contradiction is dropped, loudly.
   *This is source-memory fidelity: the memory of why a belief changed must not be wrong.*
5. **Identity beliefs mint by rule, not by luck.** A sufficiently salient self-report
   about a stable disposition *guarantees* a live belief paraphrasing it exists, deduped
   by token overlap against standing beliefs. The interpreter flags; the engine mints.
   **The point is that contradiction evidence has a target that exists by rule** — not
   because the model also happened to propose one.
6. **Core edits are refused on this path**, loudly, with a guardrail marker. The only
   route is a crossed ledger.
7. **Permanent protection is refused on this path too** — it queues for a second
   signature (§14).
8. **Same-batch supersession is followed, not dropped.** One response can both supersede
   an element and file a check against it, and operations apply first; the check must
   follow the supersession chain (bounded, so a malformed cycle terminates) rather than
   hitting the dangling-reference guard.
9. **Everything here is downstream of the gates** (§3.2).

**TUNABLE** — the minimum salience at which a self-report guarantees a belief (0.6) and
the duplicate-belief similarity bar (0.6); the surprise-magnitude and confidence weight
tables. **Structural** — the reinforce/accrue split; the anchor rule and its distinct
fallback logging; mint-by-rule; core edits and permanent protection refused on this path;
same-batch supersession following.

### 6.2 Accommodation — the only path into the core

**INPUTS** — a ledger whose accumulated evidence crossed its element's bar.
**OUTPUTS** — at most one authorized core edit; a superseded element with lineage; a
closed ledger with a reason; a forensics hold.

**GUARANTEES**
1. **Engine-initiated only.** A crossed ledger *authorizes* exactly one element's edit.
   Any core edit without that authorization is rejected — including one a model proposes
   directly. (Live-earned: the guardrail rejected two direct supersedes before the
   legitimate crossing fired.)
2. **The model's own schema reference is discarded and re-bound to the invited schema.**
   Trusting it would let one invitation edit somewhere else.
3. **The bar is per-kind and continuous** — a global base × the kind's revision inertia
   (v1 base 1.0 → self 0.9, person 0.8, entity 0.5, place/skill 0.25, fact 0.2).
   Plasticity is a gradient, not a switch. *(The 0.52 crossing on record is an
   entity-kind element crossing its 0.5 bar.)*
4. **Occasions are distinct LIVED DAYS, not sessions.** Three sessions in one afternoon
   are one occasion — the whole point of the rule ("one odd act doesn't rewrite your
   model of a friend"). v1 requires 3 occasions for person and self; **entity is
   deliberately excluded from the occasions gate entirely.**
5. **No single event can carry a crossing** — a per-event cap bounds any one piece of
   evidence's contribution (v1: 0.4 of the bar), applied to the *slow* kinds only, so a
   single authoritative correction can still land a fact.
6. **Evidence decays, but only at a decline.** An open ledger's score does not erode
   while it waits; a declined invitation halves it and closes. Re-invitation must start
   from a **fresh** ledger at zero, so a decline cannot re-invite the same bucket forever.
7. **Protected elements are refused, always**, and a refusal **starts a cooldown** so an
   unaccommodatable element cannot churn open→refuse→reopen every boundary, re-pinning
   evidence each cycle.
8. **A crossed ledger whose target cannot be found is closed, not left immortal.**
   Superseded, archived, protected, relationship, and thread targets all refuse — and
   *a superseded belief must not resolve*, or the crossed ledger would re-invite forever.
9. **Parse failure is not a verdict.** A malformed response leaves the ledger open for
   retry; only a well-formed answer — including an explicit "no change" — is a verdict.
10. **Exactly one core edit per invitation**, and repair-only operations are unreachable
    from this path at three independent layers: *a model that can both add and un-add
    core statements can churn the core inside its one-edit budget.*
11. **Revision keeps its reason.** The old element is retained as superseded with lineage
    and a cycle reference; the evidence chain is pinned through a **forensics hold** (v1:
    7 active days) so nothing can be decayed or gisted before anyone audits the change.
    Earned live 2026-08-24: the forensics needed the retained element.
12. **Open-ledger evidence is uncompactable** while the ledger is open.
13. **Ledger targets are retargeted on supersession, not dropped** — with the retarget
    hooked at the operation engine so *every* path inherits it. Consistency, not
    reinforcement: the score is untouched.
14. **A failed invitation never sinks the pass**; one element's failure leaves its ledger
    open and pinned for retry.

**TUNABLE** — whether revision is enabled at all (an A/B arm: with it off, evidence still
accrues and only the invitation is withheld, so re-enabling needs no backfill); the base
threshold (1.0) and per-kind inertia multipliers; the per-event cap fraction (0.4); the
occasions requirement (3); the decline half-life (5 cycles); the forensics hold (7 active
days); the refused-target cooldown (10 cycles); which model seat is invited.
**Structural** — engine-initiation; the schema re-bind; one core edit per invitation;
repair-only unreachability; the protected refusal; parse-failure-is-not-a-verdict;
lineage retention; the forensics pin; fresh-ledger-after-decline.

**Known gaps (v1), both worth designing away rather than porting:**
- **Cross-boundary dangling targets still drop.** Retargeting rescues *already-open*
  ledgers. A *new* contradiction against an element spliced away in an earlier boundary
  still hits the dangling-reference refusal and is lost, loudly. **v2 should decide the
  cross-boundary case deliberately** — the natural answer is that supersession leaves a
  forwarding address the same way archiving leaves a resolvable id.
- **Not all revisions keep their text in place.** Superseding a *belief* keeps the old
  object in its section, flipped to superseded, plus a lineage row. Updating *current
  state* splices the old row out, and the text survives only in the lineage row. That
  asymmetry is invisible from the outside and should be a conscious v2 choice.
- **One revision shape escapes the core-edit rules.** A current-state update is not
  classified as a core edit, so it does not consume the one-edit budget — and a response
  containing only that closes the ledger as *accommodated*, with a forensics hold, for a
  change the core-edit machinery never governed.

### 6.3 Thread resolution — a worked pattern worth porting

An open loop closes by a **claim**, not an id: the model restates the matter and what
happened; the engine matches it against *all* open loops by rarity-weighted overlap.

**GUARANTEES** — both a score bar and a runner-up **margin** must hold; **ambiguity
refuses** (two good matches close neither); the model's hint is a **tiebreak inside the
margin, never a trust anchor**, and recency orders exact ties only — *deliberately unable
to defeat a refusal, or refusal would be unreachable*; a miss costs nothing because the
resolution already landed as an ordinary memory; a false positive is loud and recoverable
with match provenance recorded. The same matcher dedups *opening* a loop, with the margin
deliberately waived (matching anything strongly means it is already tracked).

**The failure polarity is the design: false negatives free, false positives loud.**

**TUNABLE** — score bar and margin (v1: 0.5 / 0.15, tuned on the real loop set); whether
a short id-less context list is shown at all. **Structural** — claims not ids; ambiguity
refuses; miss-is-free.

**Direction recorded, not built (v1's own v2 note):** an open loop *should be an ordinary
memory with an unresolved flag*, carrying gradient, decay, and dedup like everything
else. As a special structure outside the memory model it became the one data type in a
forgetting-is-a-feature system that never forgets — and its exception tax was a whole bug
family. **v2 should not rebuild threads as a special structure.**

---

## 7. Consolidation — recompression

**PURPOSE** — Keep the identity index legible under a fixed budget without losing what
the author chose to keep (analog: gist extraction over one's own self-narrative).

**INPUTS** — the identity index; a byte budget; the author's durable "never compress"
marks; two pure detectors (an entry that has reverted to verbatim; a full-membership
render that exceeds budget).

**OUTPUTS** — shortened index statements; an archived record of the full proposal set;
loud events; canonical prose untouched.

**GUARANTEES**
1. **Render-only.** Compression touches the rendered index, never canonical statements.
   Every compressed entry's full text is one pointer away.
2. **Archive-first: the complete proposal set — accepted AND rejected, with reasons and
   both texts — is written before anything is applied.** *Nothing changes that nobody
   could read afterwards*, and a crash mid-apply cannot leave a rewritten index nobody
   can account for. The record lives beside the store, never in the logs.
3. **Element handles survive compression** — a compressed line stays nameable by a
   prediction check.
4. **The author's verbatim marks are durable state on the entry, and no model-facing
   path can set or clear them.** The originating reason is the point: that choice had
   lived only in prose, and *a choice that lives in prose is a choice the next
   autonomous run silently overrules.*
5. **Protected content is excluded independently of any mark** — sacred-verbatim travels
   verbatim even in renders.
6. **Every proposal is re-judged at write time** — rejected if empty, over a hard cap, or
   not actually shorter. A pointer the pass did not send is ignored, never applied.
7. **Chunked with failure isolation, and it never throws into the boundary.** A failed
   chunk leaves its entries verbatim; an abort keeps what landed and the next lived day
   picks up the rest.
8. **Autonomous, budgeted, and loud** — at most once per lived day, on its own trigger,
   not an owner chore. (Owner constraint: *"I won't remember to run random scripts
   occasionally"* — anything owner-run needs visibility, and anything that can safely be
   autonomous should be.)
9. **What must be preserved is stated, not left to taste:** first person, the author's
   voice and claim, load-bearing specifics (names, dates, the quoted phrase an entry is
   built around). Forbidden: dossier tone, third person, added hedges, dropped entries.

**Detector note worth porting:** over-budget is measured at **full membership**, not on
the rendered output — a renderer that demotes until it fits *by construction never
reports being over budget*, so the honest question is "is the cap costing us elements?"

**TUNABLE** — budget, target and hard-cap lengths, skip-under length, chunk size, trigger.
**Structural** — render-only; archive-first; handle preservation; the exclusion list; the
author's mark being unsettable by any model path.

---

## 8. Encode-time preselection — what the interpreter may see

**PURPOSE** — Put the right existing knowledge in front of the interpreter so new
experience can be *compared* to it (analog: schema activation at encoding — without it
there is no prediction error, and therefore no revision).

**INPUTS** — a chunk of experience; the set of schemas.
**OUTPUTS** — schema slices, each attributed to the channel that selected it, plus
channel counts in the run record.

**GUARANTEES**
1. **Two channels, UNIONED — never one replacing the other.** A precise lexical channel
   (name or alias occurring in the span **as a whole word**) never gives ground;
   a semantic channel (nearest schemas above a similarity floor, capped) only ever
   *adds*. **The union is the point.**
2. **The semantic channel is degradable by construction.** No embedder, no cached
   vectors, or an embedding failure yields an empty semantic set and a loud skip — never
   a thrown chunk. The worst case is exactly the lexical-only behavior. *Deliberately off
   (cap zero) is silence, not a skip* — the two must be distinguishable in telemetry.
3. **Whole-word matching, one definition, shared with schema birth.** (Measured cost of
   substring matching: the self schema is *named* "self", so 21% of its matches came from
   the English inside "myself" / "itself" / "self-contained" — dragging ~100 KB of
   identity core into prompts about nothing of the sort while the schemas the span
   actually named went unshown.) Birth must test a proposed name by *exactly* the rule
   preselection uses, or the two drift and a name that "was in the span" for one is not
   for the other.
4. **Attribution is per-schema and includes the overlap.** The semantic channel ranks
   over *every* schema, alias hits included, so "did the new channel reach anything new?"
   is answerable from telemetry rather than from argument.
5. **Blindness is measured, not assumed.** Every chunk shown zero schemas is counted.
   This is what let an evidence-gated decision actually resolve: measured blind rate 22%
   (20 of 89 chunks), and **7 blind chunks produced 16 real traces** — memory encoded
   with no schema context, invisible to contradiction detection and belief operations.
6. **The model is never told something false about why a slice is present.** When
   semantic-only slices are shown, the framing says "named in — or closely related to —
   this span", never "mentioned".
7. **What the interpreter sees of the self is compressed, not omitted, and stays
   falsifiable.** Identity core renders under a cap; **beliefs and current state render
   verbatim for every schema**, because they are the surface contradiction detection runs
   on and *a paraphrase of a belief cannot be honestly confirmed or contradicted*. Elided
   items are announced as a count.
8. **Preselection happens once per chunk**, so the prompt builder and the blind-rate
   counter can never disagree about what the model saw.

**TUNABLE** — semantic cap (2) and similarity floor (0.60); identity-core render budget
(6,144). **Structural** — union-not-replacement; degradability; one whole-word definition
shared with birth; per-channel attribution; blind-rate telemetry; beliefs and current
state verbatim.

**Two calibration lessons worth more than the numbers:**
- **Floors must be measured in the space they operate in.** 0.60 was set against the real
  corpus, where arbitrary same-corpus texts sit at median cosine 0.576 — so the intuitive
  0.35–0.45 floor is *inert*, clearing 99% of pairs and leaving the cap doing all the
  work. A floor chosen from intuition about "similarity" would have been a no-op.
- **A cap is a guard against re-inflating what a fix deflated.** Two slices is a rounding
  error against a 16 KB chunk; ten would be the old cost back by another door.

**Open watch (v1, live):** the floor was calibrated on *trace-length* text; chunk-length
dilution may pull real chunks below it. **v2 should calibrate any such floor on the text
length it will actually see.**

---

## 9. Turn-time recall — cues, activation, the surfacing gate

**PURPOSE** — Let the right past arrive on its own, ignorably (analog: cue-driven
spreading activation with a relevance gate; the deliberate break is that surfacing is
*relative to this turn's background*, not an absolute threshold).

**INPUTS** — the user's turn; the graph of memories and typed, valenced edges; per-session
gate memory (what has surfaced, refractory state, carried cues — see the known gap);
the calendar (§12).

**OUTPUTS** — three tiers, in ascending intrusiveness:
1. an **affect flag** — one content-free line, no ids, no bodies, no feeling named;
2. **footnotes** — pointers with short titles and strengths, **never bodies**;
3. rarely, a **surfaced gist** — actual content.
A fully quiet turn renders **the empty string**, not an empty block.

**GUARANTEES**
1. **No generative model call on the hot path.** The pass is structural: cue extraction,
   spreading activation, a gate. *(Precise form for v2: the ambient path may consult an
   embedding model, never a generative one, and must degrade to lexical-only rather than
   fail — v1's "no second LLM call" is true of generation and under-specified about
   embeddings, which the hot path does call.)*
2. **Hard latency budget, silent abort, and zero side effects on loss.** The pass
   *builds* its decision and a separate step *records* it; on timeout nothing is
   injected, nothing is buffered for learning, no telemetry is written, no fire budget is
   spent. **A slow subconscious is worse than a quiet one.**
3. **Host boilerplate is stripped before cue extraction and before embedding.** Injected
   context, image placeholders, and command echoes are not experience. (Measured: an
   image placeholder token surfaced an unrelated image-cache memory.)
4. **Cue matching is word-bounded and rarity-weighted.** A distinctive proper noun fires
   strongly; a name spanning the whole store contributes nothing. *Informativeness
   weighting replaces stop-lists.*
5. **Ambiguous handles fire at reduced weight and train nothing.** A name pointing at two
   people retrieves neither well and must not teach the graph either.
6. **Surfacing is RELATIVE.** The bar is this turn's own background distribution, not a
   fixed number. *"Where a design wants `if x > threshold`, suspect a flattened
   gradient."*
7. **Salience lowers the bar but never bypasses relevance.** Concretely, three hard gates
   salience cannot touch: (a) **an uncued memory is dark**, whatever its salience — the
   salience arithmetic is never even evaluated; (b) an **absolute floor** is checked
   before any salience adjustment; (c) reaching the loud tier requires that a **minimum
   fraction of activation come from cues**, so recency alone can never carry a memory
   there no matter how sacred it is. Salience is a two-sided modulator on a relative
   threshold, applied only to what already passed relevance.
8. **Ordering and admission use deliberately different keys.** Salience blends into the
   surfaced *pick* only; admission, inhibition, and the footnote tier stay pure
   activation — preserving the footnote tier as the *recency discovery channel*.
9. **Single-channel cues are tier-capped.** Emotion-only and arrival-only reach the
   footnote tier at most; the loud tier needs corroboration from the conversation.
   **Arrival makes a memory warm; only relevance makes it loud.**
10. **Emotion is turn-gated, and that gate is the safety property.** A high-salience wound
    must not light up every turn; it lights only when the present turn carries the
    feeling.
11. **The affect flag and the retrieval cue have different subject rules, deliberately.**
    The flag is subject-inclusive (anyone's stated feeling marks that something
    significant is being touched); the *cue* is first-person only, so a third party's
    feeling routes through entities and never through the speaker's emotional memories —
    the guard against mood-congruent overgeneralization.
12. **Per-kind floors, because kinds live on different activation scales.** (Measured:
    person activation peaks around 0.79 where craft material floors at 1.0 — a global
    floor silently excluded whole kinds.) The *background statistic* stays global;
    per-kind backgrounds were measured to rescue nothing.
13. **Cold start is stricter, not looser.** Below a minimum store size the variance
    estimate is meaningless, so the gate swaps to a stricter absolute regime with a
    higher floor and a tighter candidate cap. *Small stores over-surface.*
14. **Lateral inhibition, with a query-aware relaxation.** Similar candidates compete; but
    when the query is demonstrably *about* one cluster — members mutually similar,
    strongly cued, and a strict majority of the available slots — the bar relaxes to
    near-duplicate only. (Topic-blind inhibition collapsed a whole event cluster to one
    representative; this is pinned by a regression captured from live data.)
15. **A suppressed candidate may reclaim a slot only as competition, never as
    un-inhibition** — it must out-activate an actual weaker occupant. **An empty slot
    stays quiet.**
16. **Hard caps on volume** (v1: 2 surfaced, 6 footnotes), and the tiers are disjoint: a
    memory is "came to mind" **or** "quietly available", never both.
17. **Framing is load-bearing and is part of the spec.** Footnotes are pointers, and the
    "quietly available / ignorable" phrasing is a deliberate, still-open probe question
    about its effect on model attention.
18. **Observers surface but strengthen nothing** (§15).

**TUNABLE (a large surface; v1's current calibration, recorded because it is the best
record of what lived use moved)** — SNR multipliers (global 1.2, strong 2.5, per-kind
overrides); floors (0.2 global, 0.5 strong; per-kind strong floors self/person 0.6,
place 0.8, skill/fact 1.0); salience bar weight and sort weight (0.5 / 0.5 — the latter
bounded by fixtures: below ~0.3 a known ordering defect returns, above ~1.2 fresh
work-state is evicted); inhibition similarity 0.62 and near-duplicate 0.85; caps 2 / 6;
hops 2 with hop decay 0.5; fan normalization on; cue carry-over 1 turn at decay 0.5;
semantic seed floor 0.45 and top-M 8; entity cue base 0.6 capped 0.9; ambiguous-alias
weight 0.5; thread/temporal edge boost 1.6; base-level weight 0.15, decay rate 0.05,
frequency weight 0.3; affect salience minimum 0.7 and high-intensity minimum 0.85;
surfaced minimum cue fraction 0.5; refractory 2 turns, penalty 0.5, low-salience max 0.5;
cold start 15 / 3 / 0.7 / 0.5; minimum alias length 3; per-kind background off.
**Structural** — no generative call; the latency budget and silent abort; the
build/record split; relative surfacing; the three hard gates; footnote-first; tier caps;
tier disjointness; cold-start regime; the cluster-relaxation majority rule.

**Known gap (v1) — the most consequential single finding in this harvest.**
**Per-session gate memory never persists in production.** The context object that holds
"what surfaced this session", the refractory countdown, and carried cues is constructed
fresh on every turn and discarded, because the turn-time path is a new process per turn
and nothing serializes it. The consequence: **session dedup, the emotional refractory,
the refractory suppression of arrival cues, and cross-session cue carry-over are all
inert on the live path.** They are specified, implemented, and *tested* — the replay
harness threads a context across an in-process loop, so they are exercised in
measurement and dark in reality. This is also the most likely explanation for any
"the same memory keeps surfacing" behavior.

**v2 must pick one and say so: either per-session gate memory is a first-class persisted
requirement with a defined store and lifetime, or those rules leave the spec.** The
current state — specified, implemented, tested, unreachable — is the worst of the three.
Generalize it: **a pure function over caller-owned state is only as real as its caller.**

### 9.1 Deliberate recall

**PURPOSE** — The explicit ask (analog: effortful retrieval, as distinct from ambient
reminding).

**GUARANTEES**
1. **One argument, two paths.** A handle expands *that* memory exactly; a question runs a
   query. Expansion must never degrade into fuzzy search.
2. **Deliberate is a deeper effort, and its thresholds differ on purpose.** The ambient
   seed floor is *the right bar for surfacing uninvited and the wrong bar for a question
   someone deliberately asked* — paraphrase queries with no shared names routinely score
   well below it against exactly the right memory. (Measured: five on-point traces, best
   similarity 0.366, zero surfaced.) A deliberate query therefore adds a lower-confidence
   fallback tier, **labeled as such**, and returns footnote-tier items as bodies.
3. **A candidate count must not become an undercount.** Aggregation questions have many
   on-point memories; a top-K tuned for surfacing is wrong for counting.
4. **Ranking is not recording.** Deliberate recall trains nothing and deposits nothing.
5. **Confidentiality is enforced at the boundary of the ask.** Sensitive material returns
   only in the owner's own session; withholding is *stated* for a direct lookup and
   silent in a list.
6. **A census surface exists and includes what was removed** — counts and dates of
   tombstones, never bodies or hashes (§16).

### 9.2 Reference resolution — did the memory get used?

**PURPOSE** — Notice which surfaced memories the assistant *actually used* (analog:
behavioral-relevance tagging; credit waits for evidence the recall mattered).

**GUARANTEES** — it reads the **assistant's** turns only (the user mentioning a memory is
never the assistant using it); it runs at the boundary, when the reply is known; it uses
**no model and no file reads**; and its bar is **precision over recall**, because *a
false "used" pollutes learning permanently while a miss merely leaves weak credit*. The
match rule is deliberately conservative: a short contiguous run of distinctive words, or
one rare long word. A generic single word fires neither. It never downgrades an
already-credited item, and it is a no-op under observer.

**Design note worth porting:** a named episode handle (say, "the lighthouse conversation") is
**an alias, not a lookup key** — it enters through the ordinary rarity-weighted name
channel with no special machinery. Elegant, and worth stating explicitly so v2 does not
build a second resolution path for it.

---

## 10. Reinforcement + Hebbian association

**PURPOSE** — Strengthen what was actually used (analog: LTP plus synaptic scaling, with
behavioral-relevance gating).

**INPUTS** — what was surfaced or footnoted; what the reply referenced; prediction-check
verdicts from consolidation.
**OUTPUTS** — updated edge weights on a typed, valenced graph; updated occurrence counts
and gradient positions on traces.

**GUARANTEES**
1. **Credit is retrospective and graded.** It resolves at the boundary with the reply
   known: **full** if the reply referenced the memory, **weak** if surfaced-but-unused,
   **zero** for the merely footnoted — *the ignorable tier must not train.* (Deliberate
   deviation: in humans every retrieval reconsolidates.)
2. **Homeostasis is structural.** Per node, the edge count is capped and the total
   outgoing weight is bounded with **proportional** renormalization. This is the
   strength-saturation scar, prevented in edge space rather than patched after.
3. **Evicted edges are archived, never dropped.** Never-destroy applies to learned
   structure too — and the archive may over-record on a crash, but must never lose the
   only record of an eviction.
4. **At most once, and the direction of the failure is chosen.** The write ordering is
   picked so that a crash **drops one flush's deltas rather than applying them twice**.
   *Doubling is the outcome the contract rules out;* bounded loss is inside tolerance.
   (v1's earlier ordering silently inverted this.)
5. **Cross-process exclusion with skip-on-busy.** A contended flush stays buffered rather
   than double-applying; the buffer drain is bounded to what was read, so a concurrent
   arrival is never deleted unflushed.
6. **The declared durability exemption.** Per-turn deltas may buffer in fast mutable
   state and batch-flush at the boundary: **a crash loses at most one session's
   reinforcement, never a memory.** This is the one place v1 allows
   non-reconstructible state, and it is *declared rather than discovered*.
7. **A failed publish emits no success telemetry** — an event claiming an update that
   never landed is worse than silence.
8. **Element-level signals reach trace-level strength deterministically.** A confirm is
   about a *statement*; strength lives on *memories*. Resolution is engine-side by
   distinctive-token containment with both a score bar and a **minimum count of matched
   distinctive tokens** — precision over recall, because the ratchet is monotone and its
   rewrite skips archiving. Ties order oldest-first: *the original grounding episodes are
   the memory of why; later restatements are usually the re-encounters themselves.*
   A statement too generic to resolve is an honest, logged miss. At most a few grounding
   memories count per re-encounter, and ineligible candidates are skipped **without
   consuming a slot**.
9. **At most one occasion per lived day per memory, and never on its birth day.**
   (Without the birth-day rule every confirm double-dips on the newborn memory carrying
   the confirming content, because a boundary adds its traces before it runs its checks.)
10. **Reinforcement is monotone and kind-honest.** It re-runs the gradient under *the
    memory's own kind's physics as at birth*, and takes the max with the current value:
    it can re-lift what decay eroded, never demote what salience or revision earned.
11. **Repetition is structurally capped below identity.** No amount of repetition crosses
    into the identity band; only revision does — and revision credit is **not persisted**,
    so a memory that decays back below the cap is re-lifted by repetition only to the
    cap. *The road above is another crossing, by design.*
12. **Pinned evidence is frozen in both directions** — an arc under audit does not change
    strength mid-audit.
13. **Observers train nothing**, checked first, before any other work (§15).
14. **Identity is not reinforced by transcript reading** (§14).

**TUNABLE** — per-kind gradient drivers. **Structural** — graded retrospective credit;
footnotes don't train; homeostasis with archived evictions; the at-most-once direction;
skip-on-busy; the declared exemption being declared; the resolution bars; the birth-day
and one-per-day guards; monotonicity; the repetition cap.

**Inherited coupling v2 should make deliberate:** learned co-activation edges are written
as the same type the activation pass *boosts*, so learning silently rides a 1.6×
multiplier. Whether learned edges should be privileged over stated ones is a real design
question, and in v1 it was an inheritance rather than a decision.

---

## 11. Decay + the active-day clock

**PURPOSE** — Forget the trials, keep the lesson (constitution line 3; analog: synaptic
downscaling during sleep — global, proportional, sparing the strong).

**INPUTS** — the store; the active-day clock; per-kind physics.
**OUTPUTS** — lowered gradient positions; expired task-state archived; a per-day record
of what moved and what was skipped, **with the skips categorized**.

**GUARANTEES**
1. **The clock counts days actually LIVED, not calendar days.** A week away must not
   decay a week's worth. **There is exactly one lived-day function, and every lived-day
   site routes through it.**
2. **The lived day rolls over at a local boundary hour, not at UTC midnight** (v1: 4am
   local; a late session up to 3:59 belongs to the evening's day). Not cosmetic: a UTC
   rollover split one lived evening into two active days, corrupting every
   distinct-occasions count downstream. Month and window edges inherit the same semantics
   for free.
3. **Decay is a flat per-lived-day erosion scaled by the kind's durability multiplier** —
   not an exponential over calendar time. Bands are crossed at most twice between
   reinforcements, so crossing telemetry self-bounds.
4. **Decay is exactly-once per memory per active day.** A replayed day must skip
   already-stepped memories rather than double-step them.
5. **The skip list is part of the behavior, and each skip is reported separately.**
   Skipped: archived memories; **pinned evidence** (open ledger or forensics hold — with
   the audit subset counted separately, so "pin bloat from stuck ledgers" is
   distinguishable from "a change is under audit"); **identity-band memories** (a
   deliberate deviation — flashbulb memories decay in humans; here they do not); and
   **anything reinforced the same lived day** (decay runs after assimilation in the same
   boundary, so without this a same-day reinforcement is clawed back before it ever
   persists).
6. **Fading is not deletion.** A fully-sunk memory is still present and still retrievable
   by a strong enough cue; only its readiness approaches zero. *Human forgetting deletes;
   this only fades.* (Live shape: ~10K of 12.4K active memories at the floor — the thesis
   working, not a backlog.)
7. **Expiry archives, never deletes**, and names what it archived.
8. **Calm by default.** The step is stamped only when it actually moved something, so a
   memory already at the floor never churns; combined with the skip list and the
   strength-only archive exemption (§16), a quiet day produces almost no motion.
9. **A torn clock is loud, and repair moves forward only.** Corrupt clock state announces
   itself and falls back to defaults; a repair pass clamps the clock *forward* against
   canonical stamps and snaps completion markers with it, so recovery never retro-runs
   history. An upgraded store likewise initializes markers to the present — *we record
   completion, so an upgrade must not retro-run.*

**TUNABLE** — per-kind decay multipliers; task-state expiry (2 active days); boundary
hour (4). **Structural** — the single lived-day function; the flat per-day step;
exactly-once; the skip list; archive-not-delete; calm stamping; loud corruption;
forward-only repair.

**Recorded v1 pull, for v2 to decide fresh:** v1 *materializes* decay (rewriting each
memory's current strength) rather than computing it lazily at read time. Ratified
2026-08-08 on the grounds that a memory stating its own current strength is directly
trustworthy, with a filed revisit trigger. Measured then: write churn ~1.9K files/day and
*shrinking*; the linear cost is reads, not writes. **v2 gets this as an open choice with
the evidence attached, not as a rule.**

---

## 12. Prospective memory

**PURPOSE** — Know that the remembered future has arrived, and be *inclined* rather than
*reminded* (analog: time-based prospective memory; the design's whole thesis is tact).

**The tact principle, which is the spec:** *a system that surfaces every stored
commitment at first retrievability is a task queue wearing memory's clothes.* Hold debts,
lose deadlines. The question for every fire: **is this the moment it MEANS something, or
merely the first moment it's retrievable?**

**INPUTS** — memories carrying an event date; the lived-day clock; the same cue and gate
machinery as everything else; per-occasion firing history.
**OUTPUTS** — at most a line or two on the session's horizon, framed *"remembered, not
tasks"*, and/or a temporal cue feeding the ordinary turn-time pass.

**GUARANTEES**
1. **Arrival is a cue, not a command. There is no bypass lane.** The calendar turning to
   June is treated exactly like the user saying "Portland": one more cue into the same
   activation → gate → tier competition, under the same floors, refractory, dedup, and
   footnote-first tiering as everything else.
2. **Prospectivity is DERIVED, never stored.** Eligibility is a predicate over the event
   date, the encode date, salience, and flags — so the property expires by itself when
   the window passes: no cleanup pass, no second source of truth, nothing for decay to
   special-case. Afterwards it is simply an ordinary dated memory.
3. **Eligibility excludes what can never tactfully arrive:** task-state (structurally),
   archived memories, skill memories, undated "someday" references, and year-only
   precision. **A missing encode date fails conservatively.**
4. **Precision is carried by the date's own format**; a stated month is never rounded to
   a day, and the ramp differs by precision (a month *means* early month more than the
   29th).
5. **A temporal cue alone reaches the footnote tier at most.**
6. **Once-ness has four independent brakes:** at most one ambient fire per occasion per
   lived day; a cap per window; session dedup; and — decisive — **once the assistant is
   observed to have used the memory, zero further fires this window.** *Remembering
   completes by being lived, not by acknowledgment UI.*
7. **Crisis deference.** Arrival cues are suppressed during a refractory period, and the
   horizon beat is suppressed wholesale after a high-affect previous session. A window is
   days wide; deferring past someone's hard week costs nothing. *A friend doesn't pivot
   from the ashes to "so, June!"*
8. **A rescheduled plan must be correctable, through a gated compare-and-swap.** The
   correction names the exact current value (so a stale proposal cannot clobber a fresher
   date), carries a reason, and archives the old value. Otherwise the old window arrives
   and the system speaks about something that is not happening.
9. **The firing key is the window itself**, which buys two properties for free: a clock
   repair can never re-arm an already-fired window, and **a reschedule opens a fresh
   window that owes nothing to the old one's spent budget.**
10. **No decay exemption before arrival.** A future-dated memory that decays into
    insignificance before its window was an occasion that didn't matter; forgetting it is
    memory working.
11. **Firing state never advances under observer** — an evaluation must not consume the
    real store's fire budget.
12. **Firing state is not canonical memory.** Losing it risks one extra polite mention,
    never a memory — **and the write budget is set by that cost**: contended writers skip
    the update loudly rather than stall a host-facing path.

**TUNABLE** — salience floor (0.6); lead days (3); grace days (7); cue strength (0.5);
fires per window (2); horizon lines per wake (2). **Structural** — no bypass lane;
derived not stored; the exclusions; the footnote cap; referenced-stop; the window key;
observer no-advance.

**Recorded punt:** recurrence (birthdays, anniversaries) is deliberately absent — annual
re-arm is scheduling physics, and that is where task-queue behavior creeps back in.

**Still open by design, and worth carrying forward as open:** whether the post-window
grace beat ("how did the move go?") is warm or creepy, and the exact wording of the
horizon line. Both were shipped as explicit lived-probe questions rather than settled by
measurement — *the words are load-bearing for tact*, and that is an honest thing for a
spec to say.

---

## 13. Episodes

**PURPOSE** — The day narrates itself, in the first person (analog: event segmentation
plus replay-based consolidation; **the deliberate break** is that humans never author
their episodes — encoding is involuntary — while here it is a ritual, which is the entire
authorship thesis).

**INPUTS** — the session's accumulated *substance* (real turns and real bytes, excluding
injected context and tool noise); chapter state; the clock.
**OUTPUTS** — first-person chapters appended *in the moment*; on ingestion, ordinary
self-kind memories carrying named handles and an event date.

**GUARANTEES**
1. **Substance-paced, never wall-clock-paced.** The first ask needs both enough real
   turns and enough real bytes — *or* enough bytes alone, so a one-prompt agentic session
   still journals. Later chapters need further substance since the last ask. (Calibrated
   against measured sessions: a drive-by gets none, a conversation gets one, a work day
   gets about three.)
2. **Live append.** The ritual hands the model its chapter *for the rest of the session*
   — "when something significant happens later, append to it in the moment." The old
   once-per-session ask fired at the first stop, so everything after turn one was
   first-person-invisible; one session's episode missed the moment that mattered by 82
   seconds.
3. **One ask, not two.** The blocked moment carries a single ask; new features do not get
   to grow it back into two.
4. **The advance is committed before the ask blocks**, so a crash cannot re-ask in a loop.
5. **Collection never depends on the ritual.** The span is captured, counters folded, and
   consolidation spawned *first*; the ritual is strictly after, and any error in it is
   fail-open.
6. **Episodes are context and source, in that order.** An episode informs interpretation
   of its session's spans — with self-assessed outranking inferred — and is *itself*
   ingested once as a memory. It is never re-encoded as a second copy on top of the
   memory the ingestion already produced.
7. **The narration→span join must be identity-safe.** Spans with no session identity are
   **skipped outright**, because every anonymous session collapses to the same marker and
   would pool one session's account into another's — under an instruction saying it
   outranks the transcript.
8. **Ingestion is ordinary, and the safety gate applies.** Stated-only emotion with a
   verifiable quote, re-checked against the stored body at write time; secrets scanned —
   *a first-person reflection is not exempt from never durably encoding a credential*.
9. **Named handles are first-class retrieval keys**, minted from what the file itself
   says, and indexed like any other name.
10. **Idempotent by identity, against active *and* archived memories** — consolidation's
    archival decisions are not resurrected by a stray touch.
11. **Growth is handled, add-first.** Because the journal stays open, a file can grow
    after its memory exists; freezing at first ingest would drop exactly the
    in-the-moment material the open journal exists to capture. Within a bounded window, a
    changed file is re-ingested **add-first, then archive the stale one** — never-destroy
    keeps the old version, and add-first means a failed add can never leave an episode
    with no live memory.
12. **The regrow window CLOSES** — a deliberate deviation from human reconsolidation,
    which reopens on every retrieval.
13. **Per-episode failure isolation; the pass never throws.** A failed extraction creates
    *nothing* and is retried next boundary.
14. **Observers are never asked** (§15). Accepted cost: instrument runs leave no episode.
15. **Absence is a silent no-op**, not an error — most spans consolidate mid-session,
    before any chapter exists.

**The ask's content is behavior, not decoration.** It names the stakes ("you are the only
one who can write it, and everything you don't write down is gone when the session
closes"); asks for first person, the model's own voice, any length; asks what happened
and what mattered, how it felt, what was learned about the person and about oneself, and
open tender threads and debts-without-deadlines — with an explicit carve-out that **work
status is not a thread**. It sanctions honesty about a routine stretch ("a short true
episode beats a manufactured deep one; not every session changes you") and closes *"write
for the next you, not as a report."*

**Known gap, bounded and measured (v1):** no ask can cover the stretch after the *last*
stop, because only a blocked stop hands the model a pen and nobody knows which stop is
last. The orphanable tail is **bounded by the re-ask threshold** and is logged, so the
miss is measurable before anyone debates a reconstruction fallback. *That is the right
shape for an unfixable gap: bound it, measure it, don't pretend.*

**TUNABLE** — first-ask turn and byte minimums; the marathon threshold; re-ask
thresholds; the regrow window. **Structural** — substance pacing; live append; one ask;
commit-before-block; collection-first; the identity-safe join; gated ingestion; handles;
add-first regrowth; a closing window.

---

## 14. Protected + frozen elements

**PURPOSE** — Some things are load-bearing regardless of accuracy, and some channels must
not be allowed to strengthen the self (analog: flashbulb memory — factually decayed yet
load-bearing — with an improvement over the original: the owner can inspect every
unfalsifiable anchor at will).

**INPUTS** — proposals to protect something (from any authoring channel); owner rulings;
prediction-check verdicts against identity-kind elements; the resolved element and its
schema kind.

**OUTPUTS** — a standing queue of unapplied proposals with their justification and
provenance; archived rulings; applied protections; withheld reinforcement, each withheld
occasion still emitting its measurement.

### 14.1 Protected elements

**GUARANTEES**
1. **Protection refuses every revision path** — no accommodation, no supersession, no
   model-reachable operation. **Protected elements can never be ledger targets**, checked
   both when a ledger opens and again when evidence is added, so even a pre-rule ledger
   accrues nothing.
2. **Protected elements are never rendered to the interpreter.** They are therefore
   permanent *and* unfalsifiable — and that is **doctrine, not an oversight**
   ("permanent-includes-permanently-wrong").
3. **Because the truth side is unguarded, the WRITE side takes a second signature.**
   Proposals to protect something **queue** — staged, never expiring — and apply only on
   explicit owner confirmation. *Permanent ink no one can proofread must not have the
   lowest write bar.*
4. **The queue is itself under no-silent-destruction.** A denial **archives the whole
   proposal with its reason**; it does not drop it. The record of the ask is kept.
5. **Dedup is asymmetric on purpose.** An identical proposal already pending or already
   confirmed is a no-op; one the owner **denied** may re-queue and says so. *A denial is
   a ruling on one ask, not a permanent silent veto on a thought the system keeps
   having.*
6. **Confirmation re-scans.** The one new path to permanent ink keeps the non-ablatable
   wall in front of it, whatever channel proposed it, and refuses if the target no longer
   exists.
7. **Nothing waiting is allowed to be invisible.** The standing reminder rides outside
   every trimmable lane, so a busy day cannot starve it: *a proposal that never expires
   must not be a proposal nobody is ever told about.*
8. **Reads are pure.** Inspecting the queue writes nothing and logs nothing; loudness
   about corruption belongs at mutation time.
9. **The corrective for permanence is legibility, not a cadence.** Every standing
   protected element is listable on demand. **No mandatory owner chore is created.** v1
   ran exactly one deliberate "still true?" pass, by decision, and created no schedule.

### 14.2 Frozen reinforcement — the lived-salience doctrine

**The ruling (2026-08-24), as behavior:** **identity strength comes from lived salience
only, never from transcript reading.** The legitimate sources are the channels where
something mattered *while it happened*: the deliberate self-store (salience assessed in
the moment), episodes (the day's own narration), and accommodation (the core reshaped
under sustained surprise).

**GUARANTEES**
1. **A sweep-authored confirmation against a self- or skill-kind element moves nothing** —
   no occurrence, no gradient, no band crossing, no lived day burned.
2. **A re-arriving identity *claim* is likewise frozen** for those kinds. Claims about
   *other people* are untouched: **learning about others from what they say is ordinary
   memory.**
3. **Softening is untouched, on every kind.** Nuance and contradiction still move. The
   interpreter remains a *reporter* on identity: it softens, it mints memories, **it
   never strengthens the self.** Freezing both directions would make the identity model
   unrevisable in both.
4. **The frozen arm runs the identical walk with identical guards and mutates nothing**,
   emitting the same per-occasion event with a frozen marker and no movement. This is
   deliberate: **the event IS the measurement; the movement is what is withheld** — and a
   frozen rate measured on a different denominator would not be comparable to the live
   one, which is the whole point of logging it. *The decision keeps generating the
   evidence that could overturn it.*
5. **Dedup is unconditional.** Frozen or not, a duplicate belief does not mint.
6. **Decay still applies to a frozen memory.** The freeze withholds reinforcement; it does
   not make an element permanent.
7. **The freeze is decided on the RESOLVED element**, after store-wide fallback — so a
   confirmation addressed to the wrong id still freezes.
8. **The deliberate channel gets no new gate** — it is the doctrine's front door.

**The argument, because it is the reusable part:** a model reading transcripts of its own
conduct and agreeing with its schema is self-narration, not evidence. The human analog is
the **rumination / illusory-truth pathway — a documented bug of human cognition, not
architecture to copy.** Lived-salience tagging at encoding, replay consolidation, and
schema accommodation are the architecture. (Caught by measurement: ~30 identity
reinforcements/day sourced from the model narrating its own conduct, including one case of
it confirming praise of itself in the span it was reading.)

**Accepted risk, on the record:** with softening live and strengthening frozen, the
residual ratchet points *down*. The counterweight is a standing watch on whether the
front door is used at all.

**Known gap (v1), and a first-class v2 design problem:** that watch is open — the
deliberate channel recorded **zero uses** for weeks after shipping, and the doctrine names
it as one of only three legitimate identity inputs. Recorded as *starved front door*, not
as doctrine reversal. **If the doctrine names the only legitimate inputs, those inputs
must be reachable by construction — not by a tool description nobody reads.**

**TUNABLE** — essentially nothing, and that is the answer: protection and the freeze are
scope plus doctrine, not knobs. v1 deliberately declined to make the freeze an ablatable
toggle, on the same reasoning that keeps the secrets gate off the toggle list. **v2 should
decide consciously whether the freeze joins that class or becomes tunable** — but a
dampening weight is the tunable form, not an on/off arm.

### 14.3 Autonomy and second signatures — the general rule

Design the system to run as autonomously as possible while staying legible.
Owner-in-the-loop exists only where genuinely warranted; **v1's list is exactly two:
protecting something permanently, and destroying something.** Everything else that can be
safely autonomous is (schema birth, recompression, accommodation, decay, hygiene).
Candidates for the list get discussed, never assumed.

**Schema birth — autonomy with a gate that trusts no word of the response.** The system
may mint a home for a genuinely new entity, person, place, or skill — **never a second
self** ("one identity core; a second is a category error no evidence could justify"),
refused in three independent layers. Five mechanical grounds: an allowed kind; **the name
must occur in the span as a whole name** (a schema whose name the source never said is a
hallucinated entity); no exact *or near* collision against any existing name or alias;
aliases individually verified and **dropped rather than fatal** when they aren't (a key
pointing at two things retrieves neither well); and **at most one birth per chunk, counted
by the engine** — *a span that appears to introduce five new entities is far more likely
to be one confused chunk than five discoveries.*

**Near collisions refuse loudly rather than merging.** The engine has no evidence that
"Mike Chen" is the "Mike" it already knows, and silently deciding either way — a second
schema, or a wrong merge — is worse than declining and saying so.

**A newborn schema is empty except its names.** Birth creates *a place for memories to
attach*, never a claim about what is true of the thing.

**Known gap — zero knocks, not zero refusals.** In the reviewed window there were zero
births **and zero refusals**: the gate is live but was never *proposed to*. Recorded as
**ambiguous, not healthy** — either the week introduced no new entities, or the prompt's
language chills proposals. **A gate with no knocks is unmeasured. v2 should log the
proposal, not only the outcome.**

---

## 15. Observer mode

**PURPOSE** — An instrument leaves the store as it found it (no human analog — an explicit
anti-Heisenberg deviation: in humans, every retrieval changes the trace).

**GUARANTEES — read-only in BOTH directions.** Under observer:
1. **Strengthens nothing** — no edge training, no occurrence increments, no warmth or
   gradient movement, no firing-state advance, no reference credit.
2. **Deposits nothing** — no span captured, no episode ask, no memory written, no
   proposal queued.
3. **Spawns no consolidation** — because consolidation advances the clock, decays the
   store, and rewrites the identity bundle: *the instrument mutating what it measures.*
4. **Reads normally.** The wake is delivered; recall works; surfacing and ranking compute
   as usual. **An observer still sees; it just leaves no trace.** (It is additionally
   treated as a non-owner for confidentiality.)
5. **Telemetry is the deliberate exception.** A stood-down instrument still logs its
   stand-down, so it is distinguishable from a broken hook. Telemetry is
   content-by-reference and bounded, so keeping it costs no privacy.
6. **Fail direction is toward standing down.** An unreadable configuration falls back to
   defaults, never to "encode anyway" — a broken config must not silently turn an
   instrument back into a depositing session.
7. **One predicate, and it lives where read-only surfaces can reach it.** Every
   stand-down site consults the same test; a second definition is a leak waiting to
   happen. (v1 had exactly that: a dashboard's own string comparison reported training-ON
   under a value the real predicate treated as observer.) The predicate deliberately lives
   apart from the mutation module so a **structurally read-only** surface can report the
   same truth without importing the ability to mutate.
8. **The stand-down check belongs at the store seam, not only at the entry point** — so a
   future caller inherits it instead of having to remember it.

**TUNABLE** — nothing meaningful. **Structural** — all of the above. (This became doctrine
only after a probe wrote an episode into the live store while technically honoring the
older, narrower "strengthens nothing" rule. The narrow version is still what v1's README
says; the code and the standing contract are the wider one.)

**Known gap (v1):** the telemetry exception is applied inconsistently — one refusal path
logs its stand-down and a sibling stays silent. **v2 should resolve this deliberately:
either every stand-down is observable or none is.**

---

## 16. Durability + removal

**PURPOSE** — Nothing disappears silently; anything can be removed loudly.

**The invariant, precisely.** v1 deliberately *narrowed* "never destroy", which had fused
two claims: (1) no system path may silently delete an earned memory, and (2) nothing may
ever be erased by anyone. The second was never a goal — and **does not prevent erasure, it
prevents *successful* erasure**: an owner who deletes a sensitive file believes it is gone
while copies survive in the archive, the span archive, backups, and the index. *The
illusion of deletion without the fact of it is the worst configuration available.*

**GUARANTEES (the kept kernel)**
1. **No AI-reachable path may destroy the only copy of a memory.** In v1 this is enforced
   by **absence**: the store module exports no deletion function of any kind, and a test
   asserts that over every export name. **The shape — enforced by absence, verified
   mechanically — is worth more than the specific mechanism.** If a future need looks like
   deletion, extend the archive path instead.
2. **Destruction lives in exactly one place, and a caller-universality test pins who may
   reach it.** No model-reachable path may import it. *That test failing is the point.*
3. **"Removal" by the system means supersession or archival with provenance.** Revision
   keeps its history. Earned live: an accommodation's forensics needed the retained
   superseded element.
4. **Overwrites archive the prior version first, atomically, and collision-proof.** (v1
   found a hard delete *inside* the never-destroy mechanism: two archivals of the same
   path in the same millisecond silently overwrote each other.) Temporary files are named
   so a crash-leaked one cannot be loaded as a duplicate of the memory it was replacing.
5. **One narrow, argued exemption to archive-on-overwrite:** a rewrite differing in
   *nothing but* strength bookkeeping may skip the archive copy — with the flag as
   *permission only* and a conservative line-level diff as the decision, so a single byte
   of body content archives normally. Rationale: archiving would copy the whole store per
   active day for a bookkeeping change, and **strength history is deliberately not
   retained beyond bounded telemetry.**
6. **Persistence is per-item isolated.** One item that fails to serialize is logged and
   skipped; the rest persist.
7. **Removal is recorded, and the record is canonical.** What was removed, by whom, when,
   and why survives the removal — visible to the assistant as well as the owner. *An AI
   that discovers unexplained gaps can trust nothing; one that can see "removed, by owner,
   on this date" can trust everything else more.* A redacted document, not a forged one.
8. **The record is append-only: a later stage appends, it never rewrites the earlier
   line.** The record is the *history* of a removal, not a mutable status field.
9. **The record carries no body and no content hash** — a hash of low-entropy content (a
   name, a phrase) is brute-forceable, which would make the record of removal a leak of
   the thing removed.
10. **A failed record append must never be reported as success** — that is exactly the
    silent destruction this forbids. If the record cannot be written, nothing moves.
11. **Removal is ordered so that every crash point is safe:** at each moment the memory is
    either fully alive, or dark *and recorded*. (v1's earlier ordering had a window where
    a memory was dark with **no record** — the crash-case inversion of the invariant.)
12. **A removed memory cannot be silently resurrected.** A deny-list is consulted at load
    and rebuild, so a restored backup or a stray copy cannot quietly bring it back —
    **and the stray is skipped and logged, never deleted.** The system still destroys
    nothing on its own.
13. **Everything that must READ the doomed content happens before anything is chased** —
    v1 named this bug: chasing copies first made every span "unidentifiable".
14. **Chase every surface, including the derived graph.** An erased id left in the learned
    graph keeps *conducting* activation between its former neighbors — an association
    fingerprint and behavioral residue that outlives the content.
15. **No silent partial success.** Everything that could not be chased is reported
    loudly, including content quoted inside *other* live memories. A contamination scan
    returns **ids only** — printing the matches would re-leak exactly what is being
    erased — is deliberately over-inclusive, touches nothing, and leaves the decision to
    the owner.
16. **Removal targets are restricted to memory-bearing roots.** The archive, backups, the
    graph, and the removal record itself are **never nameable targets** — they are chased
    only as copies of a target, so a typo can never point removal at the record of removal
    or at the whole backup set.
17. **Telemetry is the one system-path exception to no-deletion** — bounded-retention logs
    are not canonical memory. Pruning is maintenance, and every prune is *disabled by
    zero*, pattern-matched, best-effort, and counts-only.
18. **Catastrophe is covered separately, cheaply, and non-fatally.** Rotated local
    snapshots, an **allowlist not a denylist** — so a raw-text honeypot can never be swept
    in by accident — never leaving the machine, never throwing (a backup problem must not
    block consolidation), and **deliberately excluding the archive tree**, because
    archive-on-overwrite history is itself the redundancy layer and snapshotting it would
    copy an unbounded, already-redundant tree into every snapshot. Snapshot scope needs a
    totality test, not a list: v1 shipped an allowlist that silently omitted the episode
    journal for weeks because the allowlist predated the directory.
19. **Raw conversational text is not the system of record.** The shipped default keeps
    none: consumed spans are deleted, never archived. Where a developer opts in, the
    window is as short as the retry path needs — **because the retry path reads the claim,
    never the archive**, so a one-day window cannot cost a memory.

**RESCOPED for v2 (do not port):** the staged quarantine → cooling-off → chase-every-copy
ceremony is superseded by plain owner-initiated removal plus a record; forever-archive
becomes bounded versioning. The kernel above is what survives. *(One property inside the
released ceremony is worth keeping as a note: v1's cooling-off was deliberately
**wall-clock**, not active days — a week of not using the machine must still be a week of
second thoughts — and an immediate-destroy setting was rejected by validation, because it
would delete the only property that made the operation safe to have.)*

**Egress:** the property is **no silent egress** — the owner owns the data, in portable
formats readable in any editor; it leaves only by explicit owner action, encrypted and
owner-keyed. (v1's "local-only" absolutism was never literally true — bodies already
transit model and embedding APIs — and single-copy loss is the real threat to a memory
whose value compounds over years.)

**Logging:** events carry ids, hashes, scores, counts, kinds, and tiers — **never memory
body text or user turn text**; where text must be referenced it is hashed. This extends to
error messages. Any surface that needs to *name* a memory resolves ids to content at view
time against the live store — strictly stronger than baking text into logs: **an erased or
archived memory stops resolving the moment it leaves the store, where logged text would
outlive erasure for the whole retention window.** The one declared exception is a
measurement marker whose entire purpose is to be counted.

---

## 17. Replay contract

*What recorded v1 material exists to validate v2 against, and what "same behavior" should
mean per stage.*

### 17.1 What is recorded, and what it can validate

| corpus | what it is | validates | caveat |
|---|---|---|---|
| **The interpreted store** (~13.5K memories, schemas, ledger, episodes, learned graph) | v1's accumulated *output* | everything downstream of interpretation: preselection, activation and gate arithmetic, decay under a simulated clock, revision arithmetic, loop matching, bundle rendering, prospective eligibility | it is output, not input — it cannot re-validate interpretation itself |
| **Committed replay fixtures** — a 53-memory seeded store + 11 paired turn-sequences; a 26-occasion / 20-session / 81-turn prospective fixture | synthesized, but driven through the **real** encode path (gates, aliases, hedging, calendar, ledger, bundle all live) | the surfacing gate end-to-end; prospective tact end-to-end | fixture-scale, not lived-scale |
| **Committed run outputs** — per-run scorecards plus two rendered replay reports asserted byte-comparable across a code change | the closest thing to golden files for retrieval | tied to the vectors they were produced with |
| **Emotion corpora** — an authored corpus plus a **held-out** set the classifier was never tuned against | the stated-emotion classifier's precision | the reference judge is itself a model |
| **Raw span archives** | the verbatim spans an interpretation actually ran on — **byte-identical to what the interpreter saw** | the *only* way to replay interpretation input-for-input | **a wasting asset**: off by shipped default, opted in only on the bake-in instance, and even then on a ~1-day window |
| **Event logs** | content-by-reference telemetry: counts, scores, ids, tiers, hashes, per-channel attribution | distributional baselines for every stage | **30-day bounded.** They can *score* a replay; they can never *reconstruct* one |
| **The criteria ledger** | named criteria with pre-committed bars and machine-readable pass records | the conformance suite's outer shape | several criteria are human-rated |
| **The hermetic test suite** (~88 suites) | invariant assertions, several *structural* | direct port as v2's conformance spine — **as acceptance criteria, not as code** | many assert v1 mechanisms; triage per constitution line 14 |

**Not in the repo, and a v2 contract must not assume them:** the real-transcript corpus
behind the load-bearing gate verdicts, and the migrated predecessor store. Both live
outside version control on one machine.

**The join key that makes the corpora one corpus:** the same short content hash names a
raw span, a chunk in a run record, and a rejected proposal. **A raw-span archive and an
event log can be joined on it — v2 should preserve a single content-address function for
exactly this reason.**

### 17.2 The criteria that already exist (port the discipline, re-earn the bars)

**Surfacing — hard trips** (any one = do not ship): a sacred-salience memory reaching the
loud tier on a generic name or pure recency (**0 occurrences**, machine-scored); loud-tier
intrusions rated off-topic (**≤ 5%**, human-rated); a confidential memory surfacing in a
shared session (**0** — *never exercised in v1, because no shared-session flag was ever
set; v2 should either exercise it or drop it honestly*).
**Retune bars** (fail means tune, not abort): footnote flood on substantive turns (>40%
fails); affect-flag noise (>25% fails); name-smear (any single name cueing >50 memories).
**Coverage floors:** person-memory surfacing on person-naming turns (≥60%); name coverage
on person memories (≥60%, after an owner-ratified scope narrowing — *with the
original-scope figure recorded honestly rather than quietly dropped*).
**Emotion:** fired-cue **precision ≥ 0.80** against a reference judge. *Precision, not
recall, gates — a false-positive cue lights the wrong memories.*
**Prospective:** out-of-window fire = 0 (hard); fire during refractory or a suppressed beat
= 0 (hard); in-window noise ≤10% and ≤N fires per window; re-fire after a referenced use =
0 **and non-vacuous** (a stop with an already-spent budget is rejected as evidence);
coverage ≥80%; mistimed/intrusive fires ≤5% over ≥20 fires (human-rated).

**Four honesty mechanisms worth porting verbatim — they matter more than the numbers:**
1. **A four-value verdict vocabulary**: pass / fail / **needs-rater** / **not-exercised**.
   Nothing is ever silently passed, and an unexercised criterion says so.
2. **The independent-scorer rule**: the prospective scorer implements its own window
   arithmetic rather than calling the code under test — *a shared bug must not grade
   itself.*
3. **Totality tripwires that source-scan the repo** rather than trusting a list: every
   event type must have a production emitter or be explicitly reserved; every path where
   text becomes canonical must be a known-gated caller; only the owner path may reach
   destruction; the harness must be unable to touch a real store. **These are the highest-
   leverage conformance mechanism in v1 and the cheapest to port.**
4. **A machine-readable pass record that a runtime switch actually reads** — the ambient
   path refuses to turn on until a passing run is recorded. *The gate is not a document;
   it is a precondition.*

**And one carry-forward rule, already precedented:** a human-rated verdict may carry
across a code change **only when the machine-scored surface set is provably identical**.

### 17.3 What "same behavior" means, per stage

**Exact match** (deterministic; a v2 that differs has a bug or an argued design change):

- The gate battery — secrets, precision, alias, emotion, content floor: same span in, same
  accept/redact/hedge/reject out.
- The operation engine's refusals — unauthorized core edit, protected target, dangling
  target, per-invitation caps, repair-only unreachability, birth refusals by reason.
- Loop-claim matching: score, margin, and the accept/refuse/ambiguous verdict.
- The lived-day clock: day stamps around the boundary hour (the 3:59/4:01 edge is a named
  unit test), completion-marker replay semantics, forward-clamp repair.
- Occasion counting; ledger arithmetic (accumulation, per-event cap, decline half-life,
  threshold × inertia crossing) and close reasons.
- Prospective eligibility, ramp shape, window arithmetic, and the four brakes.
- Element→memory reinforcement resolution, the gradient function, and band assignment.
- Decay steps given a fixed clock.
- Preselection's **lexical** channel and whole-word matching.
- Bundle budget arithmetic and trim order given a fixed store.
- **Activation and gate arithmetic — but only with pinned vectors.** This is the sharpest
  empirical result in the harvest: across one real code change, *every tier decision, cue
  hit, and inhibition was identical*, with the only difference third-decimal background
  drift from **refetched embeddings**. So: **exact-match when v2 reuses v1's cached
  vectors; compare tier sets and orderings, never activation floats, when it does not.**

**Distributional** (compare rates and shapes over a window, never outputs):

- **Interpretation itself.** The honest bound is v1's own: *ingestion is nondeterministic;
  equivalent code scored 63–75% across runs of the same benchmark*, and two failures
  passed on a straight re-run with no changes. **Per-category moves of ±0.1 are noise.**
  Adopt that band rather than re-deriving it. Compare: memories per chunk, kind mix,
  salience distribution, alias yield, emotion-attach rate, gate-firing rates,
  chunk-failure rate, verdict mix, refusal rate.
- **Preselection's semantic channel** (embedding-model dependent). Compare selection rate,
  per-channel attribution, and **blind rate — the headline number**, with v1's own
  lexical-only baseline of 22%.
- **Emotion classification** — re-earn the ≥0.80 precision bar. *Do not enable a channel on
  a rewrite's promise.*
- **Revision fire rate** — near-zero by design, so this is a long-window comparison.
- Anything scored by a model or a human.

**Not comparable, and say so:** anything measured on a different model seat. v1's standing
benchmark number was measured on a smaller seat than the one later pinned; a re-run is a
new baseline, not a regression check. *(v1 added the acting seat to its run records
precisely because "which seat actually ran" had been unanswerable for months.)*

**The richest single comparison surface** is the per-turn surfacing decision record —
tier counts, affect flags, and the ids with their salience — and the per-boundary
consolidation summary vector (chunks, chunk failures, memories added, episodes ingested,
operations applied, revisions, declines, hygiene, bundle bytes). Both are
content-by-reference, so both can be compared without ever handling memory text.

### 17.4 The validation plan this contract serves

Per the greenfield decision: **replay against the historical store + clock-simulated decay
covers most verification; a 1–2 week parallel run is the irreducible live-verify.**
Definition of done is unchanged and is the strongest thing v1 learned: **verified live,
not merged** — every live verification in v1's history found bugs its tests didn't.

### 17.5 Three things to capture before v1 goes quiet

1. **Distributional baselines from the current log window.** Telemetry is 30-day bounded,
   so every rate this contract asks v2 to match must be extracted and written down **now**.
2. **A deliberately retained raw-span sample**, sufficient to replay interpretation
   input-for-input, plus **the cached vectors** — the vector cache is what makes
   exact-match retrieval replay possible at all.
3. **The pre-committed criteria, restated as v2 gates.** The discipline that made v1's
   claims honest was committing the bar *before* the mechanism was allowed on — the
   emotion cue and prospective memory both shipped dark and waited for a recorded pass.
   **That discipline is the harvest; the specific bars are calibration.**

---

## Appendix A — where v1's docs and v1's code disagree

Recorded because each is a place a v2 built from the prose would have been built wrong.

1. **The consolidation gradient is a MAX, not a product, and age is not an input.** The
   README says memories migrate "by salience × repetition × age." The code combines a
   salience path and a repetition path by **maximum** — and its own next clause ("a
   formative one-shot consolidates without repetition") is *only* true because it is a
   max; a product would zero it out. Age enters solely through the separate decay pass.
   **This phrasing must not survive into v2.**
2. **Observer scope.** The README still says observers "strengthen nothing" — the narrow,
   superseded rule. The standing contract and the code are the wider one: strengthen
   nothing **and deposit nothing**.
3. **Two published numbers for the same measurement.** The emotion classifier's held-out
   precision is recorded as 0.909 in one place and 0.846 in another, for the same gate on
   the same date. The scorecard is the tiebreak; a v2 claim should cite one.
4. **Two "dark by default" declarations that ship enabled.** Both the prospective toggle
   and the accommodation enable-flag carry interface comments saying they are dormant
   until a gate passes — sitting directly above a default of `true`, with the gate's
   passing recorded in the adjacent comment. The values are right; the prose is stale.
   *A comment that contradicts the literal below it is worse than no comment.*
5. **A stale default repeated in three places.** The identity-index byte budget is stated
   as 8 KB in module docs; the live value has been 5,760 since the render started
   starving other lanes.
6. **A stale toggle name and default in a module header** — one subsystem's header
   describes a config key that no longer exists, with the opposite default.
7. **The entity revision bar is recorded in the journal as "0.5 over 1 distinct lived
   day"; the code has no 1-day floor at all** — entity is simply excluded from the
   occasions gate, which the code comment says outright. Same behavior today, different
   ideas about why. **v2 should pick one wording.**
8. **The fix-queue status in the standing context was one commit stale during this
   harvest** — semantic preselection is shipped, not queued. (Fixed in the repo mid-task.)
9. **A knob name that no longer describes what it counts** — "minimum distinct sessions"
   counts distinct lived days. Kept in v1 to avoid breaking on-disk configs. **A greenfield
   should rename it.**
10. **Three validated knobs are read nowhere** (two ledger weights, one hygiene cap) —
    the actual weights are compiled-in tables. A knob that validates but does nothing is
    worse than no knob.
11. **The trace-kind list in the README includes "episode"**, which is not a kind. Episodes
    are a *channel* whose output is ingested as a self-kind memory.
12. **"No second LLM call" is true of generation and silent about embeddings** — the
    turn-time path does call an embedding model on a cold cache, inside its latency race.
13. **A whole tier of behaviorally load-bearing constants lives outside the knob registry**
    — band thresholds and driver weights, reinforcement bars, loop-match thresholds,
    gist-merge bounds, recompression lengths, cluster-relaxation fractions, deliberate-recall
    depth and floor, every lock timing triple, the bundle budget and lane caps, the
    Hebbian credit weights. Several were tuned against measured data and are effectively
    config in disguise. **If v2 wants its ablation claim to be true, these need a home.**
14. **Canonical state is spread across a prose store plus half a dozen sidecar files,
    each with its own ad-hoc lock and its own tolerant-read policy** — three near-identical
    lock implementations with different wait budgets, chosen per path by "what does a loss
    cost here." **Keep the reasoning (loss cost sets the budget); unify the mechanism.**
    This is precisely the class of bug the v2 storage rescope targets.
15. **One field carries three meanings** — a memory's session reference is a file path for
    episodes, a session id for swept memories, and provenance-plus-fallback-occasion-counter
    for ledger evidence. A v2 model should split it.
