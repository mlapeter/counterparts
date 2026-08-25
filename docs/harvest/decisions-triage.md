# DECISIONS triage for v2

*Phase-1 harvest output. Input: `docs/DECISIONS.md`, all 32 entries, 2026-07-15 → 2026-08-25.
Authority: `docs/v2-constitution.md` (lines cited as C1–C14). Judged by the evidence each entry
names, not by how often the claim is repeated elsewhere. The three 2026-08-25 rescopes (storage
split, no-silent-egress, destruction kernel) are treated as already decided and applied
mechanically.*

**Classes**

- **KEEP-AS-PROPERTY** — a principle the constitution already carries (or should); cite the line.
  A property needs no porting: it is already law. This class is not a compliment, it is a pointer.
- **KEEP-AS-EARNED** — a mechanism that fired in real use and produced a number, a bug, or a
  live fire. These are the rows v2 must actually carry forward as acceptance criteria.
- **RELEASED** — overweighted, superseded, or never earned; one line on what covers the risk.
- **OBSOLETE** — v1 operational record (migrations, batch ships, config values, tuned constants).

**Split rule.** Most entries mix property, mechanism, and operational record. Each distinct claim
gets its own row. Counting rule is declared at the bottom and reported two ways.

---

## The table

| Entry | Claim (split where mixed) | Class | Rationale |
|---|---|---|---|
| 07-15 Clean-room rebuild | Rebuild rather than extend when the design conflicts; learnings travel, code does not | KEEP-AS-PROPERTY | C14. The engram→bansai precedent is what legitimizes v2 itself (08-25 cites it). |
| 07-15 | Hermetic tests, fresh temp data dir, never touch live memory | KEEP-AS-PROPERTY | C11 ("Tests are hermetic") — verbatim. |
| 07-15 | Zero runtime dependencies in the core | RELEASED | Was a proxy for C10 simplicity, and already leaked (07-26 exemption). v2 ships as an embeddable npm package where dep hygiene is a packaging judgment, not a vow. |
| 07-17 A/B paused | Side-by-side against engram abandoned same evening | OBSOLETE | The A/B never produced data; engram is gone from v2's world entirely. |
| 07-17 Accommodation default-ON | Accommodation with its four guardrails (protected-exclusion, belief-minting, per-event cap, occasions rule) | KEEP-AS-EARNED | Validated run 3c, then fired live 08-24: `led_82975ae8c1c043e8` crossed at 0.52 and the guardrail had rejected two direct supersedes first (08-19, 08-22). |
| 07-17 | The accommodation A/B toggle | RELEASED | Never used for an A/B; C11 says mechanisms earn their place by firing, not by being switchable. |
| 07-19 Episode ritual | First-person episodes are the model's own record, appended in the moment | KEEP-AS-PROPERTY | C4 (self first-class) + C2 (encoding close to the lived experience). Named a legitimate lived-salience source by the 08-24 review. |
| 07-19 | Stop-hook gate, per-session chapters, ingest-at-boundary mechanics | OBSOLETE | Host-specific plumbing; v2's core knows nothing about any host (C5). |
| 07-23 `bansai_note` | An explicit "remember this" channel exists, but is never the interface | KEEP-AS-PROPERTY | C8. Its own successor's zero fire rate (below) is the evidence that the deliberate channel cannot be load-bearing. |
| 07-25 No silent destruction | Kernel: no system/AI-reachable path destroys the only copy; anything can be removed loudly | KEEP-AS-PROPERTY | C7. Rescope 3 kept exactly this and released the rest. |
| 07-25 | Enforce it structurally (no `delete` export exists; a test asserts the absence) rather than by discipline | KEEP-AS-EARNED | Earned 08-24: accommodation forensics were only possible because the superseded element was retained. |
| 07-25 | Staged, tombstoned, CLI-confirmed erase ceremony (871 lines) | RELEASED | Rescope 3: never production-fired in six weeks of bake-in, and de-scoped 07-29 for lack of any designated target. Plain owner-initiated delete + tombstone row covers the kernel. |
| 07-25 | Safety invariants are not ablatable — no toggle whose "off" arm is a data-loss hazard | KEEP-AS-EARNED | → scar list. Earned 08-18: prediction checks bypassed the secrets gate, so a fully-gated chunk could still reinforce schema elements — a real leak in the wall. |
| 07-25 Retention | Keep what you learned, not what you said (`keepRawSpans` FALSE) | KEEP-AS-PROPERTY | C2 + C9. The one place v1's design was un-human and it knew it. |
| 07-25 | Local-only, absolutely, nothing ever leaves | RELEASED | Rescope 2: the property is no silent egress (C6). Local-only was never true anyway — bodies already transit LLM and embedding APIs — and single-copy loss is the real threat to a memory that compounds over years. |
| 07-25 | Retention day-counts, unencrypted backups, the API-key cleanup | OBSOLETE | v1 config and incident record. |
| 07-26 Dashboard zero-deps exemption | The observer may use packages the core may not | RELEASED | An exemption to a rule v2 does not have; C10 governs each module directly. |
| 07-29 Prospective merged dark | "Human judgment is the last gate" for features that change what the model says to the owner | RELEASED | Superseded in posture by the 08-19 autonomy principle and validated by the 08-25 bake-in review (every autonomous channel behaved). The surviving owner-in-the-loop list is short and named, not a general precedent. |
| 07-30 Prospective GOES LIVE | Prospective memory as a first-class module | KEEP-AS-EARNED | Owner rated the 23-fire PR-F sheet 23/23 apt — the journal's cleanest human-graded result. C12: prospective memory is a named brain system, not an invention. |
| 07-30 Git removed | Dev scaffolding must never become load-bearing; the app performs no VCS ops; git never forgets, which fights the thesis | KEEP-AS-PROPERTY | C3 + C10. Earned in the same breath: removal killed the whole `git.commitAll` bug family and −861 lines. |
| 07-30 | The removal execution, `dev-history.sh`, the strength-record reversal | OBSOLETE | v1 execution record; v2's core never had git in it. |
| 07-30 Threads (IN DESIGN) | Content-addressed direction endorsed | OBSOLETE | Explicitly superseded by the 08-04 implementation entry; do not count the mechanism twice. |
| 08-04 Threads implemented | **The LLM proposes semantics; the engine resolves references** | KEEP-AS-EARNED | First live boundary: the model's schema hint was WRONG and it did not matter — the matcher closed the right thread at score 1.0, margin 0.857. |
| 08-04 | Ambiguity refuses; a miss costs nothing (the resolution still lands as a trace) | KEEP-AS-EARNED | Same fire. Design note that generalizes: recency must not be allowed to break a tie, or refusal becomes unreachable. |
| 08-04 | Threads become ordinary memories (kind: loop) with gradient and decay | KEEP-AS-PROPERTY | C10 + C3 — a lifecycle every other memory already has; a special-case subsystem is the smell. |
| 08-04 | T_high 0.5 / margin 0.15, IDF overlap, top-5 id-less census | OBSOLETE | Tuned on v1's 42-thread set; re-tune from v2's own fixtures. |
| 08-05 Observer read-only | An instrument strengthens nothing AND deposits nothing | KEEP-AS-EARNED | Caught in the act: the 08-04 probe wrote `episodes/2026-08-04-5410d07e.md` into the live store while "measuring" it. Fail direction is toward standing down. |
| 08-05 | Telemetry is the deliberate exception — a stood-down instrument must be distinguishable from a broken hook | KEEP-AS-EARNED | → scar list. Silence is indistinguishable from failure; `observer.skip` is the cheapest possible fix. |
| 08-05 Raw-span bounded | Owner 30d / shipped ~1d archive window | OBSOLETE | A config number. Its principle ("the verbatim archive is the un-human part") is already held above and by C9. |
| 08-05 Memory authorship | Encoding sits as close to the lived experience as the host allows | KEEP-AS-PROPERTY | C2 — the constitution carries this sentence nearly verbatim. The strongest single transfer in the journal. |
| 08-05 | The self-store as the primary authorship channel | RELEASED | **Never earned.** `selfstore.append` has fired ZERO times in the month since ship (08-24 rider, still zero at 08-25). A channel the model must remember to call is not ambient (C8); v2 should get lived salience from encoding, not from a tool. The owner's discoverability watch is genuinely still open — this release rests on the shape, not on that zero. |
| 08-05 | Episode-as-lens: self-assessed signals outrank inferred ones in the sweep | KEEP-AS-PROPERTY | C2 — proximity to the experience is the ranking principle, not a heuristic. |
| 08-05 | Which model sits in which seat; the bake-off's scope | RELEASED | C2 says explicitly: which seat is a design choice, never doctrine. |
| 08-08 Ranker | Method: classify a headline defect into failure modes with regression fixtures BEFORE moving code, and bound the knob by fixture (w ≳ 0.3 flips probe 2, w ≳ 1.2 evicts fresh work-state) | KEEP-AS-EARNED | Three probes' worth of "the ranker is broken" resolved into one real bug and two non-bugs. The method is the artifact. |
| 08-08 | Preserve a pure-recency discovery channel alongside the salience-ranked pick | KEEP-AS-EARNED | Probes 4 and 6 were carried by recency; blending globally would have evicted fresh work-state unmeasured. |
| 08-08 | `gate.salienceSortWeight` default 0.5 | OBSOLETE | v1 tuning constant. |
| 08-08 Store physics | Materialized decay: the daily tick physically rewrites gradients into trace files | RELEASED | Rescope 1: decay state is operational, and operational state goes SQLite-canonical. The whole consistency-bug class the 08-18 verified-bug batch and the 08-23 dangling-ledger refire chased lived in structured sidecars — that history is evidence FOR the release, not for keeping. |
| 08-08 | **The discreteness break: traces never blend; generalization is only ever an explicit, provenance-carrying merge** | KEEP-AS-PROPERTY | C7 + C9, and a model instance of C12 — a deliberate, named deviation from biology (no substrate confabulation, zero interference). Near-duplicates are the accepted rent. |
| 08-08 | The mid-salience near-duplicate band that no collector touches | OBSOLETE | Filed as an open question, never decided; carry the problem to v2's consolidation design, not the entry. |
| 08-08 Snapshot scope | `episodes/`+tombstones+prospective in, `archive/` out | OBSOLETE | v1 allowlist config. → scar list for the *shape* of the bug: the allowlist landed hours before the episodes dir existed and silently omitted the canonical journal for three weeks. |
| 08-15 Gradient | **What fades becomes harder to bring to mind — fading must be a recall term, not biography** | KEEP-AS-PROPERTY | C3 + C7. The deciding owner intuition, and the reason a decay axis nothing reads is a bug rather than a style. |
| 08-15 | Core memories are constitutive, not retrieved — the identity band's contract is presence | KEEP-AS-PROPERTY | C4. Identity is injected, not competed for in a ranker. |
| 08-15 | Telemetry before teeth: instrument an axis before it is allowed to rank | KEEP-AS-EARNED | The inert-gradient finding is what it caught — 10,470 of 12,375 traces at exactly 0 — and verification caught a double-count (baseLevel's frequency term vs gradient's repetition path) before the blend shipped. |
| 08-15 | The "two clocks" fiction: a shipped card claimed behavior the code did not perform | KEEP-AS-EARNED | → scar list. Claims-match-code is a data-integrity property, not copy hygiene. |
| 08-15 | The two-stage plan and blend-weight mechanics | OBSOLETE | v1 sequencing against a v1 store. |
| 08-18 Surprise pipeline | **Revision must be symmetric and counted**: measure confirms against contradicts, or you ship a one-way ratchet | KEEP-AS-EARNED | 279 confirm + 67 nuance reinforcement moves in three days against ZERO `contradicts` verdicts, ever — 0 ledgers, 0 evidence anchors, all-time. The counter is what made the pathology visible. |
| 08-18 | A fully-gated chunk moves NO durable state — not warmth, gradient, occurrences, or ledger evidence | KEEP-AS-EARNED | → scar list. Element-level side effects were leaking around a chunk-level gate. |
| 08-18 | Probe discipline: observer-safe against a throwaway store copy; acceptance is that the pipeline FIRES end-to-end, not that the probe ran | KEEP-AS-PROPERTY | C11 — "verified live, not merged," stated as an acceptance criterion. |
| 08-18 Open source | The core is the memory itself — a real memory for AI modeled on human memory, and the agent-autonomy/self arc it unlocks; positioning is tactics, not identity | KEEP-AS-PROPERTY | C1–C5. The constitution's thesis is this correction, enshrined. |
| 08-18 | Speed-to-traction is the top risk; the release bar stays finite | KEEP-AS-PROPERTY | C11 + C13; already operationalized as the 08-25 four-week safety rail. |
| 08-18 | AGPL-3.0 + CLA, repo public | OBSOLETE | The 08-25 entry explicitly defers the v2 core license to v2 design; v1's license binds v1. |
| 08-19 Preselection | **The interpreter must see the schema context for what it is encoding** | KEEP-AS-EARNED | 18.5% of spans saw zero schemas at the probe; still 22% (20/89) at the bake-in review, and 7 blind chunks produced 16 real traces (~9% of the window) — memory encoded invisible to contradiction detection. |
| 08-19 | Project state does not live in identity; entities get their own homes | KEEP-AS-PROPERTY | C4. The self being first-class means the self is not the junk drawer — 14 of self's 19 beliefs were project status with no retrieval key. |
| 08-19 | Revision bars differ by kind, and a loosening is chosen out loud | KEEP-AS-PROPERTY | C7. World-state should flip on one clear correction; identity should not. The numbers are v1's; the graduation is the property. |
| 08-19 | Hold a mechanism behind a counter and let evidence graduate it | KEEP-AS-EARNED | Worked twice: gradient stage 2, and option (b) — which graduated 08-25 precisely because the counter killed the mitigation story it was held on. |
| 08-19 | Alias word-boundary fix, the belief-migration script | OBSOLETE | v1 data repair. |
| 08-19 Item 18 | **Autonomy by default, legible through the dashboard**; owner-in-the-loop only where genuinely warranted, and candidates get discussed, not assumed | KEEP-AS-PROPERTY | C4 (governed, owner-visible) + C8 (very little is ever asked of the user). Earned too: the 08-25 review found every autonomous channel behaved. |
| 08-19 | Compression touches the render, never the canonical | KEEP-AS-PROPERTY | C9 — one memory, many fidelities, stated as an implementation constraint. |
| 08-19 | Autonomous self-index recompression | KEEP-AS-EARNED | One clean autonomous fire 08-22: over-budget trigger, 14/14 applied, 0 rejected, archive written, author's keep-verbatim choices intact. n=1 but it is a real fire. |
| 08-19 | `protected.add` second-signature queue | RELEASED | Zero `protected.queued` events, ever. The 08-24 review replaced the corrective with legibility (list every standing protected element), which is the half that shipped and works. |
| 08-19 | Autonomous schema birth behind a gate | RELEASED | Zero births AND zero refusals across 89 interpreter runs — the gate is unexercised, not proven, and the 08-25 review recorded that zero as AMBIGUOUS. v2 should design entity creation fresh rather than port a gate that never opened. |
| 08-19 | Identity ops pinned to the strongest tier | RELEASED | C2: seat assignment is never doctrine, and the model lineup will have moved. |
| 08-19 Sweep seat | The Opus pin | RELEASED | Same: C2. |
| 08-19 | **Bake-off method**: real archived chunks through the real path, blind-judged by two judges including the losing tier | KEEP-AS-EARNED | Produced judge-independent exhibits (sonnet-as-judge preferred opus 26–13); the losing tier returned an EMPTY result on a span whose whole substance was a falsified premise. |
| 08-19 | Measure what preselection drags into a prompt | KEEP-AS-EARNED | ~24K input tokens against a mean 8.8KB chunk, because `self` was preselected on 50.8% of chunks and 90% of those via the alias "Claude." Doubled the bill for content no prompt needed. |
| 08-19 Dashboard naming | Observability must name the specific memory, not the mechanism | KEEP-AS-PROPERTY | C4 (owner-visible) — the owner's own verdict on generic narration was "so generic it's not helpful at all." |
| 08-19 | Logs carry ids and hashes; text resolves at render time | KEEP-AS-EARNED | → scar list. Strictly stronger than secrets-gating log text: an erased memory stops resolving the instant it leaves the store, where baked-in text would outlive erasure for the whole retention window. |
| 08-19 Freeze + floor | The self-confirm freeze, "until the identity review rules" | OBSOLETE | Interim; explicitly superseded by 08-24 (permanent + extended). |
| 08-19 | Minimum-content floor: a degenerate trace must not become a durable memory | KEEP-AS-EARNED | The bake-off minted a literal `"placeholder"` trace that passed every gate. |
| 08-24 Identity review | **Identity strength comes from lived salience only — never from transcript reading** | KEEP-AS-PROPERTY | C4 + C12's sharpest instance: transcript self-reinforcement is the rumination / illusory-truth pathway, a documented *bug* of human cognition, deliberately not copied. The interpreter reports on identity and softens it; it never strengthens it. |
| 08-24 | **Freeze, but keep counting** — the frozen channel keeps logging, so the decision keeps generating the evidence that could overturn it | KEEP-AS-EARNED | ~30 identity reinforcements/day from the model agreeing with its own narration, down to 6 withheld in 5 days post-slice. The markers are why both numbers exist. |
| 08-24 | Permanent-includes-wrong is doctrine; the corrective is legibility (every unfalsifiable anchor inspectable at will), not a review cadence | KEEP-AS-PROPERTY | C4 + C12 (flashbulb memory: factually decayed yet load-bearing — the improvement over biology is inspectability, not accuracy). |
| 08-25 Bake-in review | **A zero is not a pass**: zero refusals means the gate was never asked | KEEP-AS-EARNED | → scar list. The zero-birth reading recorded as AMBIGUOUS is the model for reading every quiet counter in v2. |
| 08-25 | The review's counts, the protected re-signing, the retired watches | OBSOLETE | Operational record of a v1 instance. |
| 08-25 currentState migration | **Identity silently accumulates project status until it dominates every prompt** | KEEP-AS-EARNED | → scar list. 103 items / ~72KB rendered verbatim into every self-keyed prompt; the "compressed slice" win never materialized on the live path (83KB measured vs ~7.5KB claimed). Post-migration: 10.8KB. |
| 08-25 | The migration run, the person-vs-entity heuristic, the three overrides | OBSOLETE | v1 data repair against v1 data. |
| 08-25 Greenfield v2 | Greenfield as launch vehicle; the three rescopes; decisions are working defaults, not commandments | KEEP-AS-PROPERTY | C6, C7, C10, C13. This entry is the mandate for this triage. |
| 08-25 Constitution ratified | One page has standing authority; everything else is revisable | KEEP-AS-PROPERTY | C13, including itself. |

---

## What v2 must not lose

The KEEP-AS-EARNED list, with the evidence that earned it. These are the rows that should become
acceptance criteria (C14: learnings travel as criteria, never as copy-paste).

**Encoding and interpretation**

1. **The interpreter must see the schema context for what it is encoding.** 18.5% blind at the
   probe, still 22% (20/89 chunks) at the bake-in review; 7 blind chunks minted 16 real traces.
   Blind encoding is invisible to contradiction detection and belief ops.
2. **The LLM proposes semantics; the engine resolves references.** First live boundary: the
   model's schema hint was wrong and it did not matter — the matcher closed the right thread at
   1.0/0.857. Corollary: ambiguity refuses, a miss costs nothing, and recency must never break a
   tie or refusal becomes unreachable.
3. **A degenerate output must not become a durable memory.** A literal `"placeholder"` trace
   passed every gate in the bake-off.
4. **Measure what preselection drags into a prompt.** ~24K input tokens for an 8.8KB chunk;
   `self` preselected on 50.8% of chunks, 90% of those via the alias "Claude."
5. **Identity silently accumulates status until it dominates every prompt.** ~72KB of dated
   project state rendered verbatim into every self-keyed prompt; the claimed compression (~7.5KB)
   measured at 83KB on the live path. v2 decides where status lives on day one.

**Revision and identity**

6. **Revision must be symmetric and counted.** 279 confirms + 67 nuances in three days against
   zero `contradicts` ever recorded. Without a counter comparing the two directions, a memory
   system ratchets one way and looks healthy doing it.
7. **Accommodation with guardrails works, and the guardrails are the reason.** `led_82975ae8c1c043e8`
   crossed at 0.52 on 08-24 and superseded its element cleanly — after the guardrail had rejected
   two direct supersedes (08-19, 08-22).
8. **Freeze, but keep counting.** The frozen channel keeps logging, so the decision keeps
   generating the evidence that could overturn it: ~30/day → 6 in 5 days.
9. **Hold a mechanism behind a counter and let evidence graduate it.** Worked twice (gradient
   stage 2; option (b), graduated 08-25 when the counter killed the mitigation story).
10. **Telemetry before teeth.** The inert-gradient finding (10,470 of 12,375 traces at exactly 0)
    and the freq-vs-gradient double-count were both found by instrumenting before ranking.
11. **A zero is not a pass.** Zero refusals means the gate was never asked, not that it works.

**Instruments and safety**

12. **An instrument leaves the store as it found it — read-only in both directions.** The 08-04
    probe deposited an episode into the live store while measuring it. Fail direction is toward
    standing down.
13. **Telemetry is the deliberate exception**: a stood-down instrument must be distinguishable
    from a broken one.
14. **Structural enforcement beats discipline** for the destruction kernel — no delete function
    exists, and a test asserts its absence. Earned 08-24, when accommodation forensics needed the
    retained superseded element.
15. **Safety invariants are not ablatable, and gates must bind every downstream effect.** A
    fully-gated chunk was still reinforcing schema elements through an element-level side path.
16. **Logs carry ids; text resolves at render time.** Strictly stronger than gating log text — an
    erased memory stops resolving immediately, where baked-in text outlives erasure for the whole
    retention window.
17. **Claims must match code.** The "two clocks" fiction: a shipped card described reinforcement
    the code never performed.

**Method**

18. **Classify a defect into failure modes with regression fixtures before moving code, and bound
    the knob by fixture.** Three "broken ranker" probes resolved into one bug and two non-bugs.
19. **Preserve a discovery channel** (pure recency) alongside a salience-ranked pick; probes 4/6
    were carried by it.
20. **Bake-offs use real inputs through the real path, blind-judged, including the losing tier as
    a judge.** That is what made the exhibits judge-independent.
21. **Prospective memory is worth having**: 23/23 fires rated apt by the owner — the journal's
    cleanest human-graded result.
22. **Autonomous recompression fired clean** (08-22: 14/14 applied, 0 rejected, archive written,
    keep-verbatim intact). n=1, but real.

---

## Released, and why safe

| Released | Why it is safe to let go |
|---|---|
| Zero runtime deps in the core | A proxy for C10 that already needed an exemption (07-26); v2 is a distributable package where dep hygiene is judgment, not a vow. |
| The accommodation A/B toggle | The mechanism is live-fired and default-on; C11 earns place by firing, not by switchability. |
| The staged erase ceremony (871 lines) | Rescope 3. Never production-fired, no designated target since 07-29. Owner-initiated delete + tombstone row keeps the kernel: nothing disappears silently. |
| Local-only as an absolute | Rescope 2. The property is no silent egress (C6); bodies already transit LLM/embedding APIs, and single-copy loss is the larger threat to a decade-long memory. |
| The dashboard's zero-deps exemption | An exemption to a rule v2 does not have. |
| "Human judgment is the last gate" as a general precedent | Superseded by autonomy-by-default (08-19), which the 08-25 review validated across every channel. The short named owner-in-the-loop list survives; the general precedent does not. |
| The self-store as primary authorship channel | Never earned: zero `selfstore.append` events in the month since ship. C8 says remembering is ambient — a tool the model must remember to call is the wrong shape, whatever the fire rate. (The 08-24 wake pointer shipped hours before the review, so the discoverability question is genuinely untested and the owner's watch stays open; the release rests on the shape, not on that zero.) The doctrine it serves (08-24) is KEPT; only this delivery mechanism is released. |
| Model-seat pins (Opus sweep seat, identity-tier escalation) | C2: which seat is a design choice, never doctrine. The bake-off *method* is kept. |
| Materialized decay rewriting gradients into trace files | Rescope 1. Decay is operational state; operational state goes SQLite-canonical, where transactions kill the consistency-bug class (verified-bug batch 08-18, dangling ledger refired 08-23) that only ever bit structured sidecars. |
| `protected.add` second-signature queue | Zero fires ever; the 08-24 review replaced the corrective with legibility, which shipped and works. |
| Autonomous schema birth behind a gate | Zero births and zero refusals across 89 runs — unexercised, not proven; recorded as ambiguous by the owner himself. Design entity creation fresh. |

---

## Counts

**Counting rule.** Two denominators, both reported, because they answer different questions.

- **Row-level (78 rows):** each distinct claim inside an entry counted separately. This is the
  honest unit, since most entries mix a principle, a mechanism, and a config value.
- **Entry-level (32 entries):** each entry assigned its dominant half, ties broken toward the
  claim in the entry's own headline.

| Class | Rows (of 78) | Entries (of 32) |
|---|---|---|
| KEEP-AS-PROPERTY | 25 (32%) | 13 (41%) |
| KEEP-AS-EARNED | 24 (31%) | 9 (28%) |
| RELEASED | 13 (17%) | 4 (12%) |
| OBSOLETE | 16 (21%) | 6 (19%) |

**Against the owner's ~half estimate — it depends which question is being asked, and both answers
are worth having:**

- **"How much was misguided or is now dead weight?"** RELEASED + OBSOLETE = **29 of 78 rows
  (37%)**, or **10 of 32 entries (31%)**. Below the estimate. Notably, RELEASED alone is only 17%
   — very little of the journal turned out to be *wrong*; most of what goes is simply spent
  (migrations, batch ships, tuned constants).
- **"How much of the journal does v2 actually need to port?"** Only KEEP-AS-EARNED — **24 rows
  (31%)**. Everything classed KEEP-AS-PROPERTY is already law in the constitution's 14 lines and
  needs no carrying; adding it to the released and obsolete rows, **54 of 78 rows (69%) do not
  travel to v2 as decisions.** Above the estimate.

The estimate lands between the two, and the gap between them is itself the finding: the v1
journal's bulk is not error, it is **lamination** — principles restated across many entries until
re-reading them each session became law. The constitution collapses 25 property rows into 14
lines. The 24 earned rows are the only part that must be carried forward, and they belong in the
scar list and the behavioral spec, not in a journal that gets re-read as scripture.

**Cross-references for the rest of Phase 1:** eight rows are marked "→ scar list" — safety
invariants are not ablatable (07-25); the stood-down-vs-broken telemetry exception (08-05); the
snapshot allowlist's silent three-week omission (08-08); the two-clocks claims-match-code fiction
(08-15); a gated chunk moving durable state through an element-level side path (08-18);
render-time id resolution (08-19); a zero is not a pass (08-25); and identity's silent status
accumulation (08-25). They fold to seven scars if the two gate findings (07-25 and 08-18) are
written as one. Handed to the scar-list-v2 harvest item rather than duplicated here.
