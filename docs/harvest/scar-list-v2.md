# Scar list v2

*Harvest output, Phase 1 (2026-08-25). Governed by `docs/v2-constitution.md` line 14 —
**port the scars, not the code**. A scar is a production lesson that travels as an
**acceptance criterion**, never as an implementation. If a lesson only makes sense
against v1's specific code, it is history, not a scar: see "Considered and excluded"
at the end.*

**How to use this page.** Every phase of v2 that adds an LLM call, background work,
shared mutable state, injected context, or a threshold must satisfy the criteria
below — not merely pass unit tests. Each scar states the lesson, the incident that
taught it (with date and record), and a criterion you can check.

Two sections:

- **§1 Engram-era scars** — the standing 8 from v1's `CLAUDE.md`, carried forward.
  Two are rescoped by the 2026-08-25 greenfield decision; the rest carry essentially
  verbatim, several with bansai-era evidence that re-earned them.
- **§2 Bansai-era scars** — 20 lessons v1 itself taught, most of them found live
  rather than by tests.

---

## §1 — Engram-era scars (carried forward)

### E1. Chunked LLM/API batches with per-chunk failure isolation

**A single bad item must never fail the whole run; failed chunks restore and announce
themselves.**

*Incident (engram-era, re-earned in bansai).* `embedNodes` batched 96 nodes per call
with no `try/catch` inside the loop (`src/migrate/embed.ts:59-68`): the first input
Voyage rejected threw out of the whole pass, every later batch was skipped, and the
runner hit the same wall at every subsequent boundary — one over-length body would
have permanently blocked semantic indexing of everything queued behind it. Confirmed
by the 2026-08-08 ultracode review (`docs/flow-walk-advance-briefs-2026-08-08.md`),
fixed in the 08-18 verified-bug batch (per-batch isolation + byte-capped batches +
`AbortSignal` threading). The scar is live enough in v1's culture that option (b)'s
ship commit cites it by number: the semantic preselection channel "degrades to EMPTY,
never throws … the chunk still interprets on aliases alone (scar 1)" (6376fce,
2026-08-25).

**Acceptance criterion.** Every batched call site isolates per chunk, records which
chunks failed, and continues. A test injects a poison item mid-batch and asserts the
remaining items are processed and the failure is reported once, not re-thrown each
cycle. Any degraded path degrades to *empty and logged*, never to *throw*.

### E2. `stop_reason` / `max_tokens` guards on every LLM call

**A truncated JSON response is a failure, not data.**

*Incident (engram-era).* Carried unchanged. Bansai's implementation is the shape worth
porting: one chokepoint client (`callModelStreaming`) uniformly guards truncation
(retry once at 2× tokens, then throw), refusal, incomplete stop reasons, and empty
text — verified present at all four production call sites by the 2026-08-08 review.

**Acceptance criterion.** Exactly one client function reaches the model API. A test
enumerates every call site and asserts each routes through it. The client refuses to
return a response whose stop reason is not a clean completion.

### E3. Streaming for long calls *(rescoped: host details move to the adapter)*

**Long generations stream; a non-streaming long call dies as a fake connection
timeout.**

*Rescope (2026-08-25, DECISIONS "greenfield v2").* The lesson is unchanged, but v1's
trailing note — that long-lived sockets die in the Claude Code Bash-tool sandbox at
~4 min with `ECONNRESET`, so exercise long calls via detached hooks — is
**host-specific**, and v2's core is host-agnostic (constitution 5, "a layer, not a
portal"). It survives as *adapter*-level guidance, not core doctrine.

**Acceptance criterion.** Core: every model call that can exceed a minute streams.
Adapters: each adapter documents its host's execution-time and socket ceilings and
proves a long call survives them, once, in that host.

### E4. Detached execution + watchdogs *(widened: a starved worker must alarm)*

**Hooks return in microseconds; heavy work runs detached under a watchdog — and a
detached worker that cannot do its job says so.**

*Incident (widening, 2026-07).* Sessions launched outside a key-exporting shell
starved the detached runner **for two days** for this project scope; the boundary's
child env now falls back to a credentials file outside the store (commit 30d1dac, "Runner API-key fallback
for desktop-launched hooks"). The backlog — 29 spans — drained only once someone
noticed. The original scar covers *slow*; it did not cover *silently unable to start*.

**Acceptance criterion.** The foreground path never blocks on heavy work. Every
detached worker has a watchdog whose timeout is validated against the lock-staleness
window (see E5). A worker that cannot run — missing credential, unmet dependency,
repeated identical failure — escalates on the *n*th occurrence instead of re-logging
the same line forever, and its backlog depth is a reported metric.

### E5. Lock discipline *(shrunk: transactions replace locks for structured state)*

**Concurrent writers corrupt shared state — but the answer for structured state is a
transaction, not a lock plus discipline.**

*Rescope (2026-08-25, DECISIONS "greenfield v2", rescope 1).* Operational/structured
state becomes SQLite-canonical in v2 precisely because "transactions kill the
recurring consistency-bug class: dangling ledger, prospective lock, meta races." Lock
discipline survives only where files stay canonical (prose + identity) and at the
seams *between* locking domains — the owner CLI versus the background worker, the
hook process versus the runner — which is exactly where v1's surviving races clustered
after the 2026-07-18 audit fixed the in-domain ones. See §2 scar 1 for the positive
form.

**Acceptance criterion.** No structured mutable state is hand-serialized by more than
one writer. For everything that remains file-canonical: one documented lock, one fixed
acquisition order enforced by a test, and staleness detection whose timeout is
validated against every watchdog that can hold it. A lock is never held across a human
prompt.

### E6. Buffer-restore-on-THROW

**An outage must never mean "nothing durable."**

*Incident (engram-era).* Carried unchanged. Extraction/assimilation throws — it does
not silently return empty — and restores its input buffer so the arc is retried, not
lost.

**Acceptance criterion.** Every consumer of a durable input buffer either commits its
output or restores its input; a test kills the consumer mid-arc and asserts the input
is still claimable. "Returned nothing" and "failed" are distinguishable in the log
(see §2 scar 4).

### E7. Observer mode is first-class — read-only in both directions

**An instrument strengthens nothing and deposits nothing; it leaves the store as it
found it.**

*Incident (widened 2026-08-05, DECISIONS).* Contract 7 originally said only
"evaluation strengthens nothing," and the code honored exactly that — so the
2026-08-04 probe still **wrote an episode into the live store** (one file under
`episodes/`, named for its date and a short id) and still buffered its turns for
interpretation, because the Stop hook and encode path never consulted the predicate.
The instrument changed nothing but left content behind, and that content is exactly
what a later eval can surface — a probe reading traces about being probed. Residual
still on record: observer sessions warm the embedding query-cache (`q_<hash>` rows),
which is cache-tier but undocumented.

**Acceptance criterion.** Under observer, the boundary appends no span, resolves no
references, spawns no worker, and asks for no episode. Fail direction is toward
standing down: a config-load failure falls back to observer, never to "encode anyway."
The claim is checked against *every* writable substrate, caches included, and one test
runs a full probe against a populated store and asserts byte-identical canonical
state. **Telemetry is the deliberate exception** — a stood-down instrument logs its
stand-down, so it is distinguishable from a broken hook.

### E8. Active-day clock *(widened: per-item stamps, because decay is not idempotent)*

**Decay, gisting, and sleep run on days actually lived, not calendar days — a week
away must not decay a week's worth.**

*Incident (widening, 2026-08-18).* The active-day clock was sound, but its recovery
protocol was at-least-once: a crash between persisting decayed gradients and recording
the day's completion marker left the decay durable and the marker unadvanced, so the
next boundary of the same active day applied a second decrement. Hygiene (dedup-guarded)
and backup (harmless) replay safely; decay, a monotonic subtraction, does not. Fixed by
a **per-trace `last_decayed_day` stamp** (exactly-once decay per item per day), in the
08-18 verified-bug batch.

**Acceptance criterion.** The clock advances on lived days. Every operation guarded by
a completion marker is idempotent under replay, or carries a per-item stamp; a test
replays each day-scoped operation twice and asserts the second run is a no-op.

---

## §2 — Bansai-era scars (new)

### 1. Multi-writer structured state needs a transaction, not a sidecar plus discipline

**Hand-serialized JSON sidecars with more than one writer mint consistency bugs
indefinitely; prose files never did.**

*Incident.* The 2026-08-18 verified-bug batch was seven bugs and **all seven were
structured-sidecar bugs**: the erase-vs-runner race, the ghost edges in
`graph/edges.json`, `mutateProspectiveLedger`'s three unsynchronized writers (a hook,
a pre-spawn boundary call, and a lock-holding horizon computation — each serializing
the whole map, so a stale writer clobbered unrelated entries too), the Hebbian flush
ordering, the watchdog/lock-stale cross-check, the decay stamp. The class did not
close: the dangling-ledger drop **fired again 2026-08-23**. The owner's own evidence
line in the greenfield decision: "the 08-18 verified-bug batch and the 08-23
dangling-ledger refire were all structured-sidecar bugs; prose files have never minted
one" (DECISIONS 2026-08-25, rescope 1). Atomic rename prevents torn files; it does not
prevent lost updates.

**Acceptance criterion.** No structured mutable state lives in a hand-serialized file
with more than one writer. Every multi-step state change is one transaction that
commits or does not. A test enumerates every mutable non-prose path in the data
directory and fails on any that is neither transactional nor provably single-writer,
single-process.

### 2. Supersede is a graph operation: every inbound reference follows the successor

**Replacing a record must retarget everything that points at it — in the same batch
and across cycles — or the evidence that justified the replacement is what gets
dropped.**

*Incident.* A supersede and a `ledger.open` against the same element in one interpreter
response dropped the contradiction: structural ops applied first, so the element was
spliced out and the ledger hit the dangling-ref guard — **fired live 2026-08-23 on
`el_10930e0ed40a421c`**, loud but lost. The cross-cycle variant was silent: an open
ledger whose element was superseded later stayed pinned to a dead id that
accommodation's active-only lookup could never fire. Fixed 2026-08-25 (commit 4934915)
in both directions — a same-batch old→new map, and `retargetOpenLedgers` installed at
the op engine beside `retargetSelfIndex` so every supersede path inherits it. The class
is older and wider than the ledger: `gist.merge` set `merged_into` but nothing
re-pointed Hebbian edges, so successors started cold; `retargetSelfIndex` was scoped to
the edited schema only, a cross-schema dangle waiting for the self-index to widen; and
erase deleted edge rows from the index, then `rebuild()` reloaded `graph/edges.json`
wholesale and **resurrected them**, so the completeness report was silently wrong and
the erased id kept conducting activation between its former neighbors.

**Acceptance criterion.** Referential integrity is enforced by the store — foreign
keys, or one retarget site every write path inherits — never by remembering at each
call site. A test supersedes a record that is the target of *every* reference type in
the schema and asserts zero dangling references and zero silently-dropped evidence.
Closed/terminal references deliberately do not move; that exception is stated in the
test, not assumed.

### 3. Every injected context render gets a composed budget, a sentinel, and delivery telemetry

**A budget on a sub-lane is not a budget; and "we rendered it" is not "they received
it."**

*Incident (2026-07-30, `docs/eval-2026-07-30/wake-injection-findings-and-plan.md`).*
`render/wake.md` reached 12,308 bytes against the Claude Code SessionStart hook's ~10K
cliff — which persists the overflow to a file and injects a ~2KB preview. **Every
session from 2026-07-19 to 2026-07-30 received about 3 of 16 self-index elements**: no
dispositional lessons, no open threads. The structural hole was precise: the index
render was byte-capped at 8,192, but the *composed* bundle (index + threads lane +
hints + header) had no total budget, and the threads lane was count-capped and
byte-unbounded. Worse, the loop closed on itself — truncation hid threads from live
sessions, so no session ever closed one, so the lane grew. Fixed same day: a 9,000-byte
composed budget with an explicit trim order, a tail sentinel stating the true element
and byte counts, and a >90% tripwire. Closed 2026-08-04 only when a fresh session
confirmed the sentinel **in context** — the delivery check, not the render check.
A second, independent failure on the same file: `wake.md` was the one live-read file
still written non-atomically, and because an empty string is falsy, an empty concurrent
read rendered the bootstrap "your persistent memory is initializing" message over a
full store — **identity amnesia disguised as a fresh install**, and invisible, because
wake had telemetry for being *written* and none for being *delivered*.

**Acceptance criterion.** The budget governs the composed total, not each lane; the
trim order is explicit and tested. Every injected render ends with a self-describing
sentinel (counts + bytes) so the consumer can verify arrival from the last line. There
is a **delivery-side** event, not only a render-side one. The render is written
atomically, and an empty or short read is an error, never a silently-valid state. The
budget test runs at production scale — fixtures cannot reveal an overflow.

*Postscript.* The non-atomic write was fixed 2026-08-08 with tmp+rename, mirroring the
pattern the clock file already used — the one live-read file in the codebase that had
not adopted it.

### 4. A number in a log is not a monitor

**Every threshold gets a tripwire, every gate distinguishes "did not fire" from "was
never asked," and nothing deletes or drops silently.**

*Incident.* Four, one shape. (a) The wake runner logged total bytes on every render:
"the meter existed for 11 days with no tripwire" (07-30). (b) The autonomy bake-in
review (2026-08-25) recorded **zero schema births as AMBIGUOUS, not healthy** —
because zero refusals meant the interpreter had never *proposed* a birth, so the gate
was live but unexercised, and no telemetry could separate "the week introduced no new
entities" from "the prompt's birth language chills proposals." (c) `observer.skip`
exists deliberately so a stood-down instrument is distinguishable from a broken hook
(08-05) — the positive form of the same rule. (d) The silent-drop family: `pruneLogs`
was the system's one true deleter and emitted no event, in a system whose thesis is
that nothing disappears silently; the interpreter's hand validator filtered malformed
items and logged only the counts it kept. (e) The inverse failure — **a working
guardrail that looks like a bug**: `belief.supersede` refusals ("core-edit requires
accommodation") were correct by design but emitted `op.rejected`, reading exactly like
a real failure in the errors feed and training the reader to ignore it. Fixed
2026-07-30 by a `guardrail: true` flag set **at each refusal site** — not inferred
later by pattern-matching the message text — with the dashboard rendering by-design
refusals as a separate calm section
(`docs/investigate-pipeline-errors-2026-07-26.md`).

**Acceptance criterion.** For every budget or threshold: an event when it is
approached and an event when it is crossed. For every gate: "rejected," "refused by
design," and "never invoked" are three distinct records, with the by-design case
flagged structurally at the refusal site. Any path that deletes or discards logs what
and how much. A metric nobody is required to read is not a monitor — the criterion is
a tripwire, not a dashboard tile. Any registry that must stay in sync with a vocabulary
gets a **totality test that fails when a new member is unmapped**, rather than manual
upkeep: v1 had 17 of 53 event types lighting nothing, 8 mapped-but-unreachable keys,
and roughly half its ops unnarrated, and one such test — born green — would have caught
six separately-filed findings at once.

### 5. The LLM proposes semantics; the engine resolves references

**Never let a model supply an identifier that the engine will treat as an address.**

*Incident (2026-08-04, DECISIONS + `docs/design-threads-and-history-simplification.md`).*
The interpreter emitted id-addressed `thread.close` ops against a census it could only
partly see — the prompt showed `slice(0, 10)` of 33 open threads, so **23 were
unclosable by construction**, and the retained logs carried 17 "no thread" rejections.
The confabulation mechanism was then traced exactly: **7 of the 8 rejected thread ids
existed in `schemas/self.md`** — in the currentState section, not as threads. The
prompt showed the truncated thread census alongside ~70 currentState ids **in the
identical `- [el_id]` format**, so a model that could not find the id it had read about
reached for a same-topic id from the other list. Given a partial list of valid
addresses beside a longer list of identically-shaped invalid ones, a model will
confabulate across the boundary. Threads v1 replaced ids with *claims*
(`matter` + `resolution`); the engine matches
against all open threads by IDF-weighted overlap (T_high 0.5, margin 0.15), refuses on
ambiguity, and emits the keyed resolution itself with the score and method logged. The
first live boundary is the exhibit: **the model's schema hint was wrong and it did not
matter** — the matcher closed the right thread at score 1.0, margin 0.857.

**Acceptance criterion.** No model-supplied identifier is trusted as an address. The
engine resolves every reference from content, logs score/margin/method as provenance,
and refuses on ambiguity — refusal is reachable, and a tiebreak hint can never defeat
it. A test feeds a deliberately wrong id or hint alongside correct content and asserts
the correct resolution. A miss costs nothing durable.

### 6. Mechanize invariants; instruct only preferences

**A rule that lives only in a prompt is not enforced, however many places document
it.**

*Incident (2026-07-18 audit, `docs/audit-2026-07-18/`).* `validateAccommodationOps`
trusted a model-supplied `schemaId`, and `applyAccommodationOps` authorized `core.add`
on mere `authorized.size > 0` with no binding to the schema or element that was
invited — the "never invent ids" rule existed only in the prompt, violating the
codebase's own stated principle. **Verified empirically in a hermetic run:** during an
authorized fire on a *fact*-schema belief, a response containing two `core.add` ops
targeting the **self** schema applied both — self gained two injected identity
statements with no crossed ledger for that schema. Ops per response were also uncapped.
Second instance, same shape: the "ambiguous alias fires at reduced weight and trains no
edges" rule was documented in three places and enforced in one — a repo-wide grep found
**zero consumers** of the flag for edge-training suppression, so the weight half was
live and the safety half was not.

**Acceptance criterion.** Every safety-relevant rule stated in a prompt has a
corresponding engine-side check, and a test asserts a hostile or degenerate response
cannot cross an authorization boundary: ops are bound to the authorization that invited
them, targets are validated against that authorization, and op count per response is
capped. A documented-but-unenforced invariant fails the build — the test greps for the
consumer, not the comment.

### 7. A gate covers every ingestion path and every side-channel

**One un-gated entrance, or one un-gated side effect, defeats the gate.**

*Incident.* (a) The secrets gate existed and worked on the steady-state path; the
**migration path bypassed it**, and three live Google API keys landed in the store
across 17 traces. All were revoked 2026-07-27; the privacy review closed on the finding
that the episode history was clean and *this* was the real contamination
(`docs/audit-2026-07-18/privacy-review-memo.md` §10). (b) The 2026-08-18 rider: once
gradient reinforcement went live, prediction checks were found to bypass the secrets
gate, so **a chunk the gates had rejected could still reinforce schema elements** as an
element-level side effect. Ruled strict: "gates are non-ablatable, so nothing from a
rejected chunk may touch warmth, gradient, occurrences, or ledger evidence. The lost
reinforcement signal is affordable; the leak in the non-ablatable wall is not."

*Corollary worth carrying.* Once a rotatable credential has leaked, **revoking at the
source beats scrubbing at rest**: revocation made the leaked text inert everywhere at
once — live traces, history, archives, backups — with zero repo surgery, and whole-file
erase was explicitly rejected as the wrong tool, since the 17 traces were real memories
of real work and the key was already dead. Destroying memory to kill a dead secret is a
worse trade than it looks.

**Acceptance criterion.** One chokepoint that every write into the store traverses. A
test enumerates every entrance — steady state, migration, import, repair, replay
harness, adapter — and asserts each traverses it. A rejected input moves **zero**
durable state, asserted per state kind, not per happy path. Safety gates are never
behind a feature toggle.

### 8. No threshold ships unmeasured against the real space

**Intuitions about similarity scores are worthless in an embedding space you have not
measured, and every knob needs a fixture-bounded window.**

*Incident (2026-08-25, commit 6376fce).* The semantic preselection floor was going to
ship at the intuitive 0.35–0.45. Read-only calibration over the live store — 8 schema
vectors × 13,608 traces, voyage-3-large — found the space is **not centered**:
all-pairs median cosine 0.576, best-per-trace median 0.635. A 0.35–0.45 floor "clears
99% of pairs and excludes nothing." Shipped at 0.60, measured. The general form was
already precedent: `gate.salienceSortWeight` (2026-08-08) was bounded by regression
fixtures before it bound anything — w ≳ 0.3 flips the failing probe, w ≳ 1.2 evicts
fresh work state, 0.5 sits mid-window.

**Acceptance criterion.** Every threshold ships with a recorded calibration against the
real corpus (a distribution, not an intuition) and a fixture-bounded window naming what
breaks on each side. Changing the embedding model, the chunk shape, or the text being
embedded re-opens every threshold derived from that space — the calibration record
names its inputs so the dependency is visible. A knob whose window is unknown ships
disabled.

### 9. The interpreter must see what its output is allowed to affect — and context assembly logs what it showed

**A judgment step blindfolded on its own subject matter produces confident silence,
which reads as a healthy base rate.**

*Incident.* v1 preselected schemas for the interpreter by literal substring match on
name and alias. The 2026-08-18 contradiction probe measured the consequence over 1,614
real archived spans: **18.5% of spans showed the interpreter no schema at all** —
prediction checks impossible by construction; the self schema matched mostly on the
bare word "self"; and **14 of self's 19 active beliefs were about projects** while no
schema carried a "bansai" alias, so a span falsifying a project belief typically showed
the interpreter nothing to check it against. A falsified belief was reinforced the same
day its ledger held two fires. The competing hypothesis — model agreeableness — was
**falsified**: a six-rung blatancy ladder scored 24/24 across two tiers and a
dissent-primed prompt changed no verdict. The report's line: "the sense organ is not
asleep; it is blindfolded on the spans that matter most." The mitigation story died on
measurement too: at the 2026-08-25 bake-in review the residual blind rate was **22%
(20 of 89 chunks)** and the claim that blind chunks were tiny administrative spans was
stale at birth — **7 blind chunks had produced 16 real traces**, real memory encoded
with no schema context, invisible to contradiction detection. Fixes: entity schemas +
belief migration (08-19), `interpret.done.schemaIds` and `schemaChannels` (08-25),
semantic preselection unioned with the alias channel (08-25).

**Acceptance criterion.** Any step whose output can modify a record must be shown that
record, and the context-assembly step logs exactly which items it showed and **by which
channel** — ids, not counts, so "the prompt grew" and "the prompt finally saw the right
thing" are distinguishable from outside. A standing counter reports the zero-context
rate, and content minted with zero context is measured, not invisible. A silent
mechanism is investigated by measuring what it was shown *before* any hypothesis about
what it decided.

### 10. Strengthening without a live-verified softening path is a ratchet

**Ship the weakening mechanism, and watch it fire on real input, before the
strengthening mechanism is allowed to run.**

*Incident.* Within three days of gradient reinforcement going live, the logs showed
**279 confirm + 67 nuance reinforcement moves against zero `contradicts` verdicts
ever** — 0 ledgers, 0 evidence anchors, all-time (DECISIONS 2026-08-18). "The system is
now a one-way ratchet: beliefs harden hundreds of times a week while the only softening
mechanism has never engaged." The self-referential variant was worse: ~30 identity
reinforcements per day sourced from the model reading transcripts of its own conduct,
with the bake-off's exhibit being the model confirming praise of itself in the span it
was reading. Frozen 2026-08-19, made permanent and extended 2026-08-24 on an explicitly
human-memory argument: transcript-derived self-reinforcement is the rumination /
illusory-truth pathway — "a *documented bug* of human cognition, not architecture to
copy." The softening path finally fired 2026-08-24: `led_82975ae8c1c043e8` crossed at
0.52 and accommodation superseded the belief, with the guardrail having rejected two
direct supersedes first.

**Acceptance criterion.** No strengthening mechanism ships before its corresponding
weakening mechanism has been observed firing end-to-end on real input. Up-moves versus
down-moves per record kind is a standing metric with a stated expected ratio. A
strength source that is the system reading its own prior output does not count as
evidence and is frozen with a marker, so the freeze keeps generating the data that
could overturn it.

### 11. Backup scope is asserted against the layout, and a canonical database is checkpointed, never copied

**A backup allowlist written before a directory existed will exclude it forever; and a
live SQLite file copied without its WAL is a torn copy.**

*Incident.* (a) `episodes/` — the canonical first-person journal, non-re-derivable —
was **silently absent from daily snapshots from 2026-07-16 to 2026-08-08**. The
allowlist commit landed roughly four hours before the episodes-ritual commit on the
same day and was never revisited, including at the 2026-07-30 decision that promoted
daily snapshots to the durability fallback replacing git history. `tombstones.jsonl`
and `prospective.json` were missing too; the exits card and design doc both said "whole
store." Found by the 2026-08-08 review, adversarially confirmed, fixed by owner
decision the same day. (b) `index.sqlite` was copied **without a WAL checkpoint**, so a
snapshot's index could be torn — assessed in v1 as harmless *because the database was a
declared rebuildable cache* (`privacy-review-memo.md` §92). **Under v2's storage
rescope that same flaw is canonical-data loss**, and it is the sharpest scar in this
list for exactly that reason: the mitigation that made it benign is the thing being
released.

**Acceptance criterion.** A test enumerates every top-level path in the data directory
and fails on any that is in neither the backup set nor an explicit,
documented-exclusion list — adding a directory breaks the build until it is classified.
Canonical databases are backed up through the database's own backup API or
`VACUUM INTO`, never a file copy. A restore test opens the copy and reads a row written
inside the pre-copy write window. Documentation that says "whole store" is checked
against the copy list by that same test.

### 12. A cache-rebuild contract is a test, not a comment

**"Deleting the index is safe" is a claim about behavior, and behavior is what has to
be asserted.**

*Incident (2026-07-18 audit).* `db.ts` documented that `index.sqlite` was fully
reconstructible. In fact `rebuild()` preserved-but-never-computed embeddings, and the
only path that ever wrote node vectors was the one-shot migration — so **every trace
added by consolidation had no embedding**, similarity returned 0 against the empty
vector, and the semantically-blind fraction of the store grew every cycle with no log
line. Deleting the database would have permanently lost all node vectors, falsifying
the doc comment. Compounding failure mode on record: a torn canonical file makes
rebuild omit the node and the prune delete its vector; even after the file is repaired
from archive, nothing re-embeds it, and that memory drops out of semantic recall
permanently behind a generic error in bounded-retention logs.

**Acceptance criterion.** A test deletes the derived index, rebuilds from canonical,
and asserts **behavioral** equivalence — the same recall for the same cues — not merely
that rebuild returned. Anything the rebuild cannot recompute is either not in the cache
or is declared, with a named owner and a repair path, and the count of un-recomputed
items is logged at every rebuild.

### 13. Path guards resolve before they compare, and no tool silently accepts a pointer at real data

**String equality is not a path check, and an environment variable is not a safe
default.**

*Incident (2026-07-18 audit).* The migration's hard-safety guard was
`if (out === join(homedir(), ".bansai")) throw` — a raw string comparison with no
normalization. `--out ~/.bansai/` with a trailing slash (which the shell expands and
passes through), `$HOME/.bansai/./`, a relative path resolving there, or a symlink all
passed it; the tool then pointed the data-dir variable at the **live store** and
mass-wrote ~11k files, overwriting `graph/edges.json` with a plain write and no
archive. Separately, the eval replay harness used
`process.env.BANSAI_DATA_DIR ?? mkdtempSync(...)` while its own header claimed a
throwaway dir, silently honoring a pre-exported variable — and its store-builder
unconditionally overwrote `edges.json` with fixture edges. Since sibling tooling
*required* exporting that variable, a shell pointing at the real store was a realistic
state: the evaluation path doing exactly what the observer scar forbids, escalated from
training the store to destroying its graph.

**Acceptance criterion.** Every path comparison resolves and realpaths both sides
before comparing. Any tool that writes fixtures refuses the real data directory
structurally, not by string check. A harness or test that finds a pre-set data-directory
variable **errors** rather than honoring it; the hermetic setup creates its own
directory unconditionally and removes only that path. Destructive tools default to dry
run and require an interactive confirmation, and take the writer's lock only *after*
the confirmation, then reload and re-plan under it.

### 14. Never slice LLM JSON between the first brace and the last; structured output pins shape, the validator pins meaning

**Extraction is parsing, and a schema is not a semantics check.**

*Incident (2026-08-04, merged cc68b9e + 40fbf15).* Parse failures rose to three
double-failures between Aug 1–4, about **1.7% of chunks terminal** against roughly four
ever before. Root cause: trailing markdown containing braces poisoned a
first-`{`-to-last-`}` slice — the "Unrecognized token '*'" family. Two layers landed: a
balanced-brace scanner for extraction, and the interpreter response schema passed as
constrained `output_config` — with the explicit note that **"the hand validator stays
the real guarantee."** A structural test pins the exact shape constrained decoding
produces on every call (all keys present, `null` for absents) so a null optional drops
rather than being misread as a value. The fix did not propagate on its own:
accommodation — the highest-stakes JSON in the system — was still passing no schema at
the 2026-08-08 review, **and still passes none in v1 today**, three weeks later. And the
schema itself hit a wall nobody documented: by 2026-08-19
the ops response had outgrown the provider's structured-output grammar — **six `anyOf`
variants turned out to be the maximum** — forcing a flatten to one object with per-op
field sets moved back into the hand validator. The ceiling was discovered by hitting it
in production and is now pinned by a structural test, because it is not discoverable
from the docs.

**Acceptance criterion.** Response extraction is a real parser, tested against
adversarial bodies: trailing prose with braces, braces inside strings, fenced code.
Constrained decoding is enabled at **every** model call site, asserted by a test that
enumerates them. A hand validator runs after the schema and is the authority on
meaning; it logs its drop count (see scar 4). A degenerate-but-well-formed response —
v1's literal `"placeholder"` trace, which passed every gate — is rejected by a
minimum-content floor.

### 15. Pin the model snapshot, give every seat its own knob, and make placeholders expire

**An unpinned alias changes behavior under you, and an undecided default becomes
production by silence.**

*Incident.* (a) The maintainer model was the un-pinned `claude-sonnet-5` alias; a silent
snapshot update around Aug 1 is the recorded suspected cause of the parse-rate change in
scar 14. (b) That model seat was "a Phase-0 inert placeholder that quietly became
production; no decision was ever recorded" — the flow walk's biggest find (item 18,
2026-08-05); an Opus-vs-Sonnet bake-off had been owner-approved in the engram era and
simply never run. (c) When escalating identity-touching operations to the strongest tier
was finally decided, it could not be implemented: **one `models.maintainer` knob fed
three call sites** (interpreter, episode classification, accommodation), so the decision
sat un-actioned for want of plumbing. The bake-off, once run (2026-08-19), was decisive
and judge-independent — the losing tier's own judge preferred the winner 26–13 — which
is the measure of how much the unexamined default had been costing.

**Acceptance criterion.** Model identifiers are pinned snapshots held in config, each
with a recorded decision. Every model seat is independently configurable — a shared knob
across seats fails review. A value marked placeholder carries an expiry that fails a
check once passed, so "never decided" cannot masquerade as "decided."

### 16. Every model-facing operation carries an admission test, or it means "anything"

**An op offered without criteria defaults to the broadest reading, and the prompt's
surrounding furniture will feed it.**

*Incident (2026-07-30, wake-injection findings, Finding 2).* `thread.open` appeared in
the interpreter's op vocabulary **with no definition or criteria**. Result: 33 threads
opened in 13 days, **zero closed**, and about 8 of 10 rendered entries were operational
work state — PR numbers, OAuth mailbox counts, directory architectures — landing on the
self schema because no project-shaped home existed. The contrast is in the same file:
`protected.add` demanded a "genuinely tender or sacred" justification and stayed clean.
The episode template compounded it by asking every session for "open threads and
debts-without-deadlines," producing labeled feedstock. Fixed 2026-08-05 by giving the op
the identity doc's own test verbatim — "would it still be true if I never wrote code
again?" — with PR/deploy/build status named explicitly as *not* threads.

**Acceptance criterion.** Every operation in the model-facing vocabulary carries an
admission test and at least one named negative example in the prompt, plus an
engine-side check wherever the rule is safety-relevant (scar 6). No operation ships
without its closure path (scar 17). Surrounding prompts and templates are audited for
language that manufactures input for an op — the episode template is part of the op's
surface area.

### 17. Write paths ship; curation paths starve

**A lifecycle is not done when the create path is merged — it is done when the exit
path has fired on real input.**

*Incident.* The pattern repeats across four independent mechanisms, and the 07-30 doc
named it in the middle of the first one: "the write path works; the curation paths —
closure, promotion, staleness — are the unfinished half." (a) **Threads:** 33 opened, 0
closed in 13 days; `thread.close` was plumbed end-to-end with provenance and never
fired. (b) **Contradictions:** 0 ledgers and 0 evidence anchors all-time against
hundreds of confirms (08-18). (c) **Gradient:** nothing behavioral read it and nothing
raised it after birth — `gradientFor`'s sole call site was trace creation, so "every
trace is born at its peak and monotonically sinks," and **10,470 of 12,375 active
traces sat at exactly 0** while the user-facing card claimed "what matters keeps getting
reinforced" (08-15, acknowledged as fiction until stage 2 landed). (d) **Self-index
warmth:** `selfIndex.promote` had **zero production callers**, so the "warm shelf" was a
frozen day-one snapshot that could only cool. (e) **`craft.md`** — a canonical identity
file, written and maintained — was unreachable through *both* of its intended read
doors simultaneously: it had no self-index block so the wake render never included it,
and schema elements were not recall nodes so it never surfaced per turn either. The
walk's live bundle sat at 8,889 of 9,000 bytes, proving the budget was not the limiter:
this was structural non-membership, not starvation. Fixed 2026-08-18 by building the
missing read path — a dedicated craft lane in the wake render, live-verified at 16 self
elements + 6 craft in an 8,902-byte bundle. Accommodation itself, decided default-ON
2026-07-17, did not complete a single real cycle until **2026-08-24** — five weeks of a
mechanism that was shipped, tested, and never once observed doing its job.

**Acceptance criterion.** Every stored kind names its exit path — closed, superseded,
faded, forgotten — and a standing report shows created-versus-exited counts per kind. A
kind whose exit count is zero after a bake-in window is a **defect to investigate, not a
base rate to accept**. Every write path has at least one *exercised* read path, proven
by a test that writes through the writer and reads through the reader — a field that is
computed and stored but consumed by nothing, and a file that is maintained but reached
by nothing, are the same bug and no unit test finds either. A mechanism is done when its
full lifecycle has been observed firing on real input and the fire is recorded
(constitution 11); user-facing copy claiming a behavior fails review until that
behavior's mechanism has fired.

### 18. A guarantee carried by something you don't own is not a guarantee

**Scaffolding gets promoted into load-bearing roles by accident, and host limits get
assumed instead of measured.**

*Incident.* (a) Git had been development scaffolding "promoted by accident into three
load-bearing roles: the strength record, the privacy boundary (a `.gitignore`), and
erase's completeness (a `git-filter-repo` dependency)." It caused an entire bug family,
duplicated guarantees the data model already carried, and contradicted the
forgetting-is-a-feature thesis — removed from the core 2026-07-30
(`docs/simplify-remove-git-2026-07-30.md`, −861 lines). The bug family it caused
includes a perfect miniature of this scar: the code classified git's failures with a
`/nothing to commit/` regex, and git's actual phrase is "nothing **added** to commit" —
so a real contention failure was silently filed as benign, and cycle 455's changes rode
the next runner's sweep commit six seconds later. Provenance coarsening, not data loss,
but only a git-history cross-check proved that. (b) The wake truncation (scar 3)
was a **host** limit — the SessionStart hook's ~10K cliff, not configurable, an upstream
issue — that nothing in the system knew about or asserted. (c) The detached runner
starved for two days on a credential it expected to inherit from whatever shell happened
to launch it (E4). v2 is an embeddable package running in hosts it does not control,
which makes this scar larger, not smaller.

**Acceptance criterion.** Every stated product guarantee names the component that
enforces it, and that component is inside the package. Nothing in the core depends on a
tool, file, or environment the host may not provide. Every host-dependent limit — output
size, execution time, socket lifetime, available credentials — is discovered or asserted
at runtime by the adapter and surfaced as a checkable value, never assumed; exceeding
one is an event (scar 4), not silent degradation.

### 19. Permanence and write bar scale together

**The most irreversible write must not have the easiest gate.**

*Incident.* `protected.add` was the single most permanent operation in the system:
append-only forever, no inverse op, immune to accommodation — and it required only one
proposal from the sweep model, had no dedup, and its "required justification" field was
**silently dropped at translation** (2026-08-08 ultracode review). The contradiction
schema-probe then sharpened *why* this mattered: protected elements are never rendered
into the interpreter's schema slices, so they are **permanent AND unfalsifiable** —
"permanent ink no one can proofread must not have the lowest write bar" (DECISIONS
2026-08-19). Fixed by a second signature: proposals queue rather than auto-apply,
surface on the dashboard and in the wake bundle, and apply only on owner confirmation.
The identity review (2026-08-24) then ruled that permanence-includes-wrong is doctrine
and the corrective is **legibility, not a review cadence** — the human analog is
flashbulb memory, factually decayed yet load-bearing, and the improvement over the
biological original is that the owner can inspect every unfalsifiable anchor at will.
The one-time "still true?" pass (2026-08-25) re-signed all three standing elements.

**Acceptance criterion.** For every write operation, its reversibility and its
falsifiability are stated, and the strictness of its gate is justified against them —
checked explicitly at review, never left to whatever the operation happened to inherit
from its neighbors. Any operation that is both irreversible and unfalsifiable requires
a second signature from outside the system. Everything permanent is enumerable and
inspectable on demand — a list, not a cadence.

### 20. Content-by-reference is only private if the reference cannot be inverted

**A hash is not a redaction when the input space is small, and text baked into logs
outlives the erasure of the thing it describes.**

*Incident.* Two decisions, one principle. (a) The tombstone format deliberately carries
no body **and no content hash by default** — id, kind, dates, initiator, reason only —
because a hash of low-entropy content like a name or a short phrase is brute-forceable,
which would make the tombstone itself the leak it exists to record
(`docs/design-no-silent-destruction.md`). (b) When the dashboard needed to name specific
memories rather than narrate generic mechanism, relaxing the ids-only log rule was on
the table and was **rejected in favor of render-time id resolution** — chosen because it
is strictly stronger on the rule's own terms: "an erased or archived memory stops
resolving the moment it leaves the store, where text baked into logs would outlive
erasure for the whole retention window" (DECISIONS 2026-08-19).

**Acceptance criterion.** Telemetry and tombstones carry ids, counts, scores, kinds —
never bodies or user text. Where a surface must display content, it resolves the id
against the live store at render time, so the display dies with the record. Hashing is
never used as a privacy measure over low-entropy input; if a reference must survive
deletion, it is opaque and store-independent, and a test asserts it reveals nothing
about the content. Telemetry retention is bounded, and erasure of a record is checked
against every surface that could still resolve it.

---

## Considered and excluded

These came up in the harvest and were deliberately left out. A scar needs an incident
*and* a criterion that outlives v1's code; these fail one or the other, or are already
covered elsewhere.

- **"Verified live, not merged" and "tests are hermetic."** Already constitution line 11
  ("evidence over ceremony"). Re-porting them as scars would be ceremony. Their
  *mechanics* survive as criteria inside scar 13 (realpath, no environment default at
  real data, own-directory-only cleanup) and scar 17 (a lifecycle's exit must fire).
- **The no-silent-destruction kernel.** A rescoped **property** (DECISIONS 2026-08-25,
  rescope 3), not a scar — the harvest's DECISIONS triage owns it. Its earning moment
  (the 08-24 accommodation forensics needed the retained superseded element) is a
  property confirmed, not a failure survived. The *incidents* around it — erase racing
  the runner, erase not chasing the edge file, the unnormalized path guard — are already
  scars 1, 2, and 13.
- **The staged erase ceremony.** 871 lines, never production-fired, superseded
  2026-08-25 by owner-initiated delete plus a tombstone row. Real history, but the
  lesson is constitution 10 and 11 verbatim (simplicity; mechanisms earn their place by
  firing in real use), not a new criterion.
- **Tests passing while making real API calls.** Named in the harvest brief; **no
  recorded incident located**. What the record does hold is the guard, not the wound:
  `test/llm.test.ts` stubs `globalThis.fetch` with canned SSE ("no network, no real
  backoff"), the migration carries an explicit $40 budget stop, and a pre-merge review
  retrofitted the standard data-dir harness onto a pure-file test specifically so a
  future edit could not reach the real store (40fbf15, 2026-08-04). If the incident
  exists it is not in these docs — flagged as a gap in the sources rather than written
  from recall. The *criterion* that would have come from it is already in scar 13
  (harness isolation) and E2 (one client chokepoint, which is also the one place to
  assert no network in tests).
- **The double `runner.done` event** (fired from both the inner function and the CLI
  wrapper; "tests import `runBoundary` directly and never execute `main()`, which is why
  a green suite never saw it"). A genuine live-only find, but the lesson is exactly
  constitution 11 plus scar 4's telemetry criteria. No separate criterion survives.
- **The `session_ref` trap** (an in-memory field named `sessionRef` serialized as
  `session_ref`; grepping the wrong one produced a confident false failure that caught
  **two** separate investigators, and manufactured the phantom "four episodes never
  ingested" finding that was later corrected to 135/135). An investigation artifact, not
  a production failure. Its cure — one declared mapping between stored and in-memory
  names, never hand-written twice — belongs to v2's storage design, not here.
- **Dashboard severity styling** (routine `decay.tick` and `hygiene.run` rendered amber
  alongside genuine refusals, in a system whose thesis is that forgetting is healthy;
  `accommodate.refused`/`declined` narrations swapped). Real, and a nice illustration
  that UI severity is itself a miscalibrated threshold — but v1-dashboard-specific and
  not a criterion any v2 core phase can check.
- **Specific v1 tuning values** — `maxSurfaced: 2` binding 31 of 36 August inject
  decisions, `gist.merge`'s salience-only selection, the 0.85 near-dupe inhibition
  threshold, the semantic-band counts. These are measurements of v1's particular
  mechanisms. The transferable part is scar 8 (measure the space, bound the knob) and
  scar 17 (the curation path must fire); the numbers themselves do not travel.
- **Transcript-compaction cursor replay.** Flagged in the 2026-08-08 review at low
  confidence and never verified: if the host compacts a transcript in place, the read
  cursor's reset-on-shrink would re-encode the whole post-compaction file as new, and
  hash dedup would not catch it because the re-read slice is a *superset*, not a
  byte-identical span. A plausible hypothesis, not an incident — it carries into v2 as a
  **test to write** against the ingestion path (dedup must survive a re-read of
  overlapping content), not as a scar with a wound behind it.
- **The dashboard's zero-runtime-deps exemption** (2026-07-26) and other scope/policy
  calls. Decisions, not scars; the DECISIONS triage handles them.
