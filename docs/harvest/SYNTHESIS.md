# Harvest synthesis — the v2 design brief

*2026-08-25. Synthesizes the six harvest outputs in this directory against the ratified
constitution (`docs/v2-constitution.md`). Everything here is stratified by authority on
purpose: mixing owner decisions with agent proposals in one flat list is the lamination
mechanism v2 exists to break. Stratum 3 is proposals — nothing in it is decided by
appearing here.*

---

## Stratum 1 — Decided by the owner (standing)

- **The constitution** (14 lines, ratified 08-25) — sole standing authority.
- **Greenfield v2 is the launch vehicle**; v1 frozen to live-fire fixes; fallback rail
  ~2026-09-22 (v1 flips public as-is if v2 isn't launchable).
- **Three rescopes**: operational state SQLite-canonical / prose+identity files;
  local-only → no-silent-egress; destruction kernel kept, ceremony released.
- **v2 core license deferred** to v2 design; v1 stays AGPL+CLA.
- **Decisions are defaults** — including every proposal in Stratum 3.

## Stratum 2 — Evidence, settled (measured, not opinion)

- **Lamination measured**: of DECISIONS.md, 31% of entries are misguided/spent, but 69%
  of rows don't travel as decisions — 25 property rows collapse into the constitution's
  14 lines; 24 earned rows travel as acceptance criteria (`decisions-triage.md`).
- **Fire counts** (`log-audit.md`): assimilation/encode/episodes/wake LIVE;
  accommodation + observer-mode INSURANCE-EARNED (accommodation's single fire is the
  08-24 acceptance); erase/threads-ambiguous/clock-clamp UNTESTED; archival read-back is
  **unmeasurable** — nothing logs it (v2 instrumentation requirement).
- **Dark behaviors found** (`behavioral-spec.md` risk #1): session dedup, emotional
  refractory, cue zeroing, cross-session carry-over are implemented and tested but never
  run live — the turn hook discards per-session gate state. **Disposition: recorded, not
  fixed in v1 (frozen); specced correctly in v2; replay must exercise the real hook
  path.** Plus a catalogued tail of doc-vs-code drift (spec Appendix A) so v2 docs start
  true.
- **Coupling is scatter, not tangle**: 13 modules hand-roll file I/O; mechanisms are
  storage-agnostic. The brain layer ports; the storage layer is replaced.
- **Test spine**: 52 behavior files (24 P1, organized by constitution property), 14
  mechanism files dropped, 13 mixed (`test-triage.md`).
- **28 scars** (8 engram-era + 20 bansai-era, `scar-list-v2.md`) as v2 acceptance
  criteria. Load-bearing three: transactions-not-sidecars; curation-paths-starve (a zero
  exit count on any memory kind is a defect); backup-must-checkpoint-canonical-DB (the
  v1 footnote flaw that the storage rescope would have promoted to data loss).

### Adjudications (cross-source conflicts, resolved)

1. **API-keys-in-tests scar REINSTATED.** The scar agent excluded "tests passed while
   making real API calls" as undocumented — correct for the repo, but the incident is
   on record outside it: the runtime silently loaded real API keys into drills that were
   supposed to run keyless, so the drills passed for the wrong reason. The lesson is to
   assert the failure *reason*, not the outcome. That the repo's own docs never recorded
   it is itself the finding — a documentation gap, caught from outside.
2. **"Zero contradicts ever" is dated 08-18** — the pre-preselection-fix disease. The
   08-24 ledger crossing is the post-fix counter-evidence. No conflict: the earned
   lesson is *count both directions* (a one-way ratchet looks healthy), and the counter
   is what made the pathology visible.
3. **Materialized decay**: the mechanism is released by rescope 1 (decay state is
   operational → SQLite). The store-mined **50–100x store-size trigger** for switching
   to lazy/read-time decay survives as an explicit v2 revisit condition
   (`tr_0fff254df39d4f40`).
4. **Curation-starvation dedupe**: scar §2.17 and earned-mechanism #6 are the same
   lesson (symmetry counters + exit paths); cited once as the scar, referenced from the
   earned list.

## Stratum 3 — Proposals awaiting the owner's call (NOT decided)

From the triage's released table, these go beyond the three rescopes and are
**agent-proposed releases** — each needs Mike's yes/no at v2 design, not before:

- **Self-store as primary authorship channel — proposed release on shape** (a tool the
  model must remember to call violates "remembering is ambient"), *not* on the
  one-month zero (the discoverability fix shipped hours before the review; the owner's
  watch is open). The lived-salience doctrine is kept regardless. **Disclosure: the
  synthesizing assistant is the user of this channel; its stake is named, and the call
  is the owner's.**
- **Autonomous schema birth — proposed redesign-fresh** (zero births AND zero refusals
  in 89 runs = unexercised, not proven).
- **`protected.add` second-signature queue — proposed release** (zero fires; the 08-24
  review replaced the corrective with legibility).
- **Model-seat pins — proposed release** (constitution line 2: seats are design
  choices); the bake-off *method* is kept.
- **Zero-runtime-deps as a vow — proposed release** (becomes dependency judgment for a
  distributable package).

## Time-critical actions

1. **Baseline capture — DONE 08-25** (`replay-baselines.md`, window 07-27→08-25).
   Two replay constraints it surfaced: (a) input-for-input replay reaches back only the
   rolling 30 days of `buffer-archive/` (782 spans; older history is distributional
   only) — v1 keeps rolling the window forward while it runs, so replay depth stays
   ~30 days whenever v2 is ready; (b) the embedding cache holds two model generations
   (voyage-3-large current, voyage-3.5 legacy 9,600 rows) — replay must pin one
   explicitly. Also: the CLAUDE.md 22% blind-rate figure was a 6-day sub-window; the
   full-window rate is 17% with 0–78% daily swings — this metric needs weeks to
   stabilize and v2 gates on it should say so.
2. **Human-eye privacy pass over `docs/v2-harvest/` before the repo flips public.**
   `store-design-memory.md` quotes trace content; the miner's privacy filter was agent
   judgment, not review.

## Phase-2 agenda (the design session(s) with the owner)

1. **The authorship ladder / interpreter seat** — owner explicitly reserved this as its
   own discussion; the brief does not resolve it. Inputs: encoding-proximity gradient
   (constitution line 2), the store-mined four-rung staging, per-session gate-state
   requirement, "mechanize invariants; instruct only preferences."
2. **Storage design** — the split as specced; two-file question (canonical DB vs
   embedding cache); versioned-row retention bound; backup via checkpoint.
3. **Entity/schema creation** — designed fresh (see Stratum 3).
4. **v2 core license** — with the market session's verified table as evidence.
5. **The compounding benchmark** — the shadow run's pipeline-divergence logs as its
   first instrument.

*The build (Phase 3) starts when Phase-2's decisions are made and frozen. Port,
don't redesign — except where a Stratum-3 call says otherwise.*
