# `self/` — CONTRACT

## 1. Purpose

The autobiographical self: identity documents, the first-person episode journal, and the
wake briefing that restores a continuous self at session start.

## 2. Brain analog

Autobiographical memory and the narrative self — episodic replay feeding a stable
self-schema, re-inhabited on waking rather than looked up. **Named deviations**
(constitution line 12): (a) humans never author their episodes — encoding is involuntary —
while here it is a ritual, which is the authorship thesis; (b) identity-band memories do
not decay here, where flashbulb memories do in humans; (c) **transcript-derived
self-reinforcement is deliberately not copied** — it is the rumination / illusory-truth
pathway, a documented bug of human cognition rather than architecture (owner ruling
2026-08-24).

## 3. Keeps

- **The briefing, grown up.** [v0] `top-60 by strength → Active Context / Core Knowledge /
  Recent Patterns / Fading Context, under 2000 characters` — the ancestor of v1's composed
  bundle and of this module's output. The section vocabulary is v0's and is worth re-reading
  before inventing another.
- **Identity is re-inhabited, not retrieved** — core memories are constitutive, not
  competed for in a ranker — and the briefing is framed as **context, not instruction**.
  [v1 §1]
- **Zero compute, zero model calls, zero network at wake**; the cost was paid by the
  previous boundary, so cold-start cost is constant in store size. [v1 §1 G1]
- **A composed byte budget, a declared trim order (v1: hints → craft → threads → horizon →
  identity last), and untrimmable riders.** A budget on a sub-lane is not a budget, and trim
  order *within* a lane is policy too: *truncation must never be iteration luck.* [v1 §1 G3,
  scar §2.3]
- **Header and tail sentinel each state the bundle's own true counts and bytes**, so a
  truncated injection is detectable from a truncation preview alone. [v1 §1 G2]
- **Delivery telemetry distinct from render telemetry** — v1 shipped 11 days of truncated
  wakes because only the render was instrumented. [v1 §1, scar §2.3]
- **Atomic publish**; an empty or short read is an error, never silently valid. [v1 §1 G5] —
  v1's empty concurrent read printed "your persistent memory is initializing" over a full
  store: identity amnesia disguised as a fresh install.
- **The wake never fails the session** — bootstrap line or nothing, then a clean exit.
  [v1 §1 G7]
- **Episodes are substance-paced, appended live, asked exactly once per blocked moment, the
  advance committed before the ask blocks, and collection never depends on the ritual.**
  [v1 §13 G1–G5] *Broken and restored 2026-09-04: v2 raised a second ask (authorship) on a
  second pacer beside this one, and the two fired on different Stops — about a dozen asks
  in a 13-turn evening. The pacing itself had drifted too: v1 re-asked on bytes AND turns,
  v2 on bytes OR turns with a byte threshold a third of v1's. One ask, one pacer, a
  conjunction — and a cap that is spent by the LIVED DAY rather than by the session, since
  the calibration ("a work day gets about three") was always stated in days.*
- **Episodes are context and source, in that order**, ingested once as ordinary self-kind
  memories with named handles. **"Episode" is not a memory kind.** [v1 §13 G6, Appendix A #11]
  *Reachable only from 2026-09-04: `ingestEpisode` had no caller outside its own tests, so
  the journal was a file that never became a memory. The door is `reconcileEpisodes` at
  `Counterpart.sessionEnd` — the boundary, not a script.*
- **The narration→span join is identity-safe** — spans with no session identity are skipped
  outright, because every anonymous session collapses to the same marker. [v1 §13 G7]
- **Ingestion is ordinary and the gates apply**: a first-person reflection is not exempt from
  never durably encoding a credential. [v1 §13 G8]
- **Add-first regrowth within a bounded window that CLOSES** — a deliberate deviation from
  human reconsolidation, which reopens on every retrieval. [v1 §13 G11–G12]
- **Named handles are aliases, not a second lookup path** — "the porch conversation" enters
  through the ordinary rarity-weighted name channel. [v1 §9.2]
- **Lived salience is the only legitimate identity input.** [v1 §14.2, earned 2026-08-24]
- **Freeze, but keep counting** — the frozen arm runs the identical walk with identical
  guards, mutates nothing, and emits the same per-occasion event with a frozen marker.
  *The event IS the measurement; the movement is what is withheld.* [v1 earned-mechanism #8]
- **Recompression is render-only and archive-first, and the author's verbatim marks are
  durable state no model-facing path can set or clear** — "a choice that lives in prose is a
  choice the next autonomous run silently overrules." [v1 §7 G1–G4]
- **Every derived surface owes a scheduled reconciler** — "a script the owner runs
  occasionally" is not one — and every identity surface owes an answer to *which door
  reaches this?* (v1's craft file was reachable through neither of its two doors for weeks).
  [v1 §1 known gap]

## 4. Drops / simplifies

- **The v1 self-store tool is superseded by experiencer authorship.** Self-writing became
  the primary path — the doctrine that identity strength comes from lived salience is kept
  whole, and the end-of-session write *is* the front door it names. Not a silent drop: it
  resolves v1's own open watch, which recorded the deliberate channel at zero uses for a
  month while the doctrine named it as one of only three legitimate identity inputs.
  **If a doctrine names the only legitimate inputs, those inputs must be reachable by
  construction, not by a tool description nobody reads.**
- **The frozen-reinforcement machinery simplifies to a rule about authorship.** With the
  transcript sweep demoted to crash fallback, the channel the freeze blocks barely runs. The
  freeze stays — mechanized, on the fallback path, keeping its marker and its count — but as
  a guard on an exception rather than a permanent slice through the main loop. Softening is
  untouched on every kind: **the fallback remains a reporter on identity — it may soften, it
  never strengthens.**
- **The second-signature queue for permanent protection is dropped; legibility is kept.**
  **PROPOSED** — owner call at check-in; evidence and counter-argument in
  `schemas/CONTRACT.md` §4. The wake's untrimmable second-signature reminder goes with it;
  the self-store pointer goes with the tool.
- **The identity *index* as a separate derived surface — its own budget, warmth ordering,
  promotion path, and reconciler — is dropped.** **PROPOSED** — owner call at check-in. Why
  it looks safe: the index existed because canonical identity prose was too big to inject,
  and its promotion path had **zero production callers**, so the "warm shelf" could only
  cool. With identity elements as ordinary memories carrying strength, the briefing ranks by
  `strength` — v0's original design, needing no second structure and no reconciler to go
  stale. Recompression then applies to the briefing render, as v1's applied to the index.
- **The wake byte budget is not a core constant.** v1's 9,000 bytes was 90% of one host's
  injection cliff. **In v2 the ceiling is a host capability the adapter reports** (scar
  §2.18). The trim order, the sentinel, and the composed-budget discipline are core; the
  number is not.

## 5. Contract

**Inputs** — identity-kind memories and their strengths; the episode journal; open
`unresolved` memories; the prospective horizon; the host's reported injection ceiling; the
lived day; the observer predicate.
**Outputs** — one pre-rendered briefing, published atomically; ingested episode memories;
recompression proposals and their archive; render and delivery telemetry.

**Guarantees** — **[M]** mechanized · **[A]** advisory:

1. **[M]** The briefing is pre-rendered by the previous boundary and is that boundary's last
   content write. Wake performs no ranking, no prose read, no model call, no network access.
   *A wake that is a DELIVERY also composes its preface (G3), which costs two meta reads and
   one `COUNT(*)` — the store's size is a delivery-time fact a bundle rendered yesterday
   cannot state. Nothing else, and a non-delivering read still pays one meta row.*
2. **[M]** The budget governs the composed total, not each lane; the trim order is explicit
   and tested; the budget test runs **at production scale** — fixtures cannot reveal an
   overflow (scar §2.3). **The identity lane has a SHARE of that total** (`IDENTITY_SHARE`):
   while the other lanes have content, identity takes at most that fraction, by whole
   elements; when they cannot fill the remainder, identity takes the leftover back. It is
   not a lane budget — the total still governs — it is how the total is SPLIT when lanes
   compete, and it exists because identity trims LAST: measured 2026-09-03/04, a migrated
   store's ~1.1 KB identity elements filled all 9,000 bytes of every session's wake with 8
   identity statements and four empty lanes, while v1's wake the same day carried 20
   elements across four lanes. *Named limit: a share taken by whole elements is
   deterministic at a fixed budget — the host's case — but does not preserve the
   smaller-budget-is-a-subset property across budgets when one element is larger than the
   difference between them (NOTES §9, with the measurement). Truncating a belief to keep
   that property is the worse trade.*
3. **[M]** Header and sentinel each state true counts and bytes. Because both state a number
   that composing them changes, composition iterates to a fixed point. A delivery-side event
   exists, not only a render-side one. **The delivered bundle carries a preface composed at
   WAKE and never stored** — which system, which lived day, today's date, how many live
   memories — because a bundle composed at a boundary is served unchanged to every session
   until the next one and cannot say any of that about the day it is read (2026-09-03: the
   memory system changed mid-day, the body went on speaking as the old one, and only the
   HTML comment named the new). Both stated byte counts are re-solved for the DELIVERED
   text, the renderer reserves the preface's room from the host's ceiling, and a damaged
   bundle is delivered exactly as found — never rewritten.
4. **[M]** Status does not accumulate on the self. A memory whose truth expires with a date
   is not an identity element, discriminated at encode time by one question: *would this
   still be a true memory worth holding after the date passes?* A standing counter reports
   self-schema bytes and trips before it can dominate a prompt again (earned-mechanism #5:
   ~72 KB, measured). The counter weighs what THIS system accumulates on the self:
   episodes (the journal, not the schema) and migrated rows are excluded and counted
   beside the fallback-minted quarantine — a migrated store read 3 MB tripped on day 0
   before anyone had written to it (2026-09-03).
5. **[M]** Identity strength comes from lived salience only. A fallback-authored
   confirmation against a self- or skill-kind element moves nothing — no `uses`, no strength,
   no band crossing, no lived day burned — and emits its frozen marker anyway, on the
   identical walk, so the frozen rate stays comparable to the live one.
6. **[M]** Softening is untouched on every kind. Freezing both directions would make the
   identity model unrevisable in both.
7. **[M]** Claims about other people are ordinary memory — learning about others from what
   they say is not self-narration.
8. **[M]** The freeze is decided on the *resolved* element, so a confirmation addressed to
   the wrong id still freezes.
9. **[M]** Recompression touches the render, never the canonical; the complete proposal set
   — accepted *and* rejected, with reasons and both texts — is archived **before** anything
   is applied; every proposal is re-judged at write time and rejected if empty, over cap, or
   not actually shorter; protected content is excluded independently of any mark.
10. **[M]** Episodes ingest idempotently by identity, against active *and* archived memories,
    so archival decisions are not resurrected by a stray touch.
11. **[M]** Observers receive the wake and are never asked for an episode. Accepted cost:
    instrument runs leave no episode (scar E7).
12. **[M]** Every derived surface has a scheduled reconciler, and a test asserts each runs at
    a boundary — not from a script the owner remembers to run. **The episode journal's is
    `reconcileEpisodes`, called by `Counterpart.sessionEnd` before the cycle**, so an
    ingested episode is inside the boundary that decays it and renders the briefing around
    it. It skips on a state read plus a hash, so an episode already ingested at its current
    text costs no scan. Found the day it was wired: `ingestEpisode` had no production
    caller at all, which is precisely the "which door reaches this?" failure §3 names.
13. **[A]** The ask's wording is a preference and a probe. That an ask exists at
    every session-ending path, that there is exactly ONE of it per blocked moment, and that
    its orphanable tail is bounded and logged, is mechanized. Tool names and session ids are
    the ADAPTER's vocabulary and live there (constitution 5); this module's `askText` is the
    host-agnostic wording.
14. **[M]** Chapters are counted by what was WRITTEN, asks by what was asked, and the two
    are separate fields. The ask names `chapters + 1`. A second append with no new ask
    continues the chapter it is part of — appending in the moment is the doctrine's headline
    case (§13 G2), not an edge. Measured 2026-09-04: with the ask advancing the chapter
    count, the hook's number reached 7 in a session whose episode held nothing.

**The briefing's tunables** — every one CAL (scar §2.8), all of them in `tunables.ts`, none
of them a budget. The composed budget is the caller's and lives nowhere in this module.

| Knob | Value | What it bounds |
| --- | --- | --- |
| `IDENTITY_MAX` | 24 | Identity elements *considered*. The budget and the share are the real bounds; this only stops a pathological store from composing a megabyte to throw it away. |
| `IDENTITY_SHARE` | 0.5 | The largest fraction of the composed budget identity may take **while other lanes have content to spend the rest on** (G2). By whole elements; released back to identity when nothing else can use the room. |
| `CRAFT_MAX` | 8 | Craft (skill-kind) elements considered. |
| `THREADS_MAX` | 12 | Open threads considered. Dark on a migrated store — INTERFACE-GAPS §8, and no cap can fix a missing source. |
| `HINTS_MAX` | 8 | Warm-shelf hints considered. |
| `HORIZON_MAX` | 6 | Arriving occasions considered (source borrowed — INTERFACE-GAPS §3). |
| `WARM_FLOOR` | 0.35 | Decayed strength a non-identity element must reach to be craft or a hint. Identity faces no floor. |
| `BUDGET_PRESSURE` | 0.9 | Fraction of the budget that fires the pressure event (scar §2.4). |
| `FIRST_ASK_TURNS` / `FIRST_ASK_BYTES` | 6 / 4,000 | The first ask needs both — or `SOLO_ASK_BYTES` alone. |
| `SOLO_ASK_BYTES` | 12,000 | Bytes alone, so a one-prompt agentic session still journals. |
| `REASK_TURNS` / `REASK_BYTES` | 8 / 8,000 | Further substance since the last ask, **both** required. |
| `MAX_CHAPTERS_PER_DAY` | 4 | Chapters one LIVED DAY may open, across every session it holds. v1 measured "about three" on a work day; the fourth is headroom for a genuinely long one. |

`PREFACE_RESERVE_BYTES` (128) is **not** tunable: it is the room the renderer subtracts from
the host's ceiling because delivery will add exactly that line, and one test bounds the
preface at its widest plausible day, date and store size against the same constant.

## 6. Scars honored

**E7** (observers receive but deposit nothing) · **E8** (episode pacing and the regrow
window run on lived days — and, from 2026-09-04, the chapter CAP does too) · **the journal
is not a duplicate of the memory made from it** (dedup walked every row, and the ingested
memory carries the episode's own prose, so the first real ingestion was merged into its own
journal at the boundary that minted it — `sleep/dedup.ts` skips `type: "episode"`) · **§2.3** (composed budget, sentinel, delivery telemetry, atomic
write) · **§2.4** (frozen markers are the measurement; a withheld move is a record, not a
silence) · **§2.7** (episode ingestion traverses the same gate as everything else — v1's
most heavily gated surface, 66% of all gate fires) · **§2.10** (strengthening without a live
softening path is a ratchet) · **§2.17** (every identity surface names the door that reaches
it) · **§2.18** (the injection ceiling is a host limit, never assumed) · **§2.19**
(permanence and write bar scale together).

## 7. Open questions

1. **Does the briefing keep v0's four sections or v1's lanes?** v0's are legible to a
   reader; v1's map to real data structures. The lineage argues for reconciling them once
   rather than accreting both.
2. **What is the honest reconciler cadence** when a session ends without a boundary?
   Pre-rendering means the briefing is always one session stale by design — a feature until
   the day's own episode is the thing the next session needs.
3. **Is the freeze still needed** once the transcript sweep is a crash fallback? It costs
   almost nothing to keep and keeps generating the evidence that could overturn it — which
   is also why its firing rate will now be near zero and hard to read.
