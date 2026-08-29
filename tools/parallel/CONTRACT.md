# `tools/parallel/` — CONTRACT

## 1. Purpose

The irreducible live-verify: v1 (bansai, `~/bansai`, reference only) and Counterparts
running side by side on the owner's real sessions for 1–2 weeks, with the dashboard as
the owner's window. Replay validated the physics and the discipline layer against a
recorded month; this run measures the one thing replay structurally could not — **the
turn loop**: recall surfacing on real turns, reinforcement on real use, episodes and the
authored session-end write, and the wake chain across real days. Its output is the
machine-readable pass record the cutover switch reads.

## 2. Brain analog

Almost none — this is an instrument, and the measuring layer inherits the replay
harness's whole stance: it leaves every store as it found it (scar E7). But unlike
replay, the *subjects* are live and change their own stores; only the instrument is an
observer. The closest human analog is the **split-brain preparation**: one stream of
experience, two encoding systems, only one holding the microphone. The analogy is named
for what it warns — the mute hemisphere still learns, and behavior is driven by
whichever side speaks. Hence primacy is single, explicit, and recorded, never emergent.

## 3. Keeps

- **One voice per session.** [v1] A/B contract 10: "alternate-day assignment, never both
  injecting in one session" — and the mechanism SURVIVES in v1's live code (read
  2026-08-29: `src/ab.ts`, `hooks/session-start.ts`, `hooks/user-prompt-submit.ts`,
  `hooks/stop.ts`): one assignment file outside either data dir mutes v1's wake, recall
  injection, and episode ask while **encode always runs** ("gates OUTPUT, never
  collection"). Shadow-v1 is one config write; zero v1 code changes; live-fire-fixes-only
  is never tested.
- **Phases, not day-alternation.** [v1] decisions-triage 07-17: "The A/B never produced
  data." Day-alternation fragments the next-wake-remembers chain — the exact loop this
  run exists to measure. The pairing's *mechanism* is kept; its schedule is dropped.
- **The four-value verdict vocabulary and a pass record a runtime switch reads.** [v1]
  §17.2, replay G4 — nothing silently passes; the cutover gate is a precondition, not a
  document.
- **Ranges, not points; not-comparable, and say so.** [v1] §17.3 — encode-side
  comparisons here are same-day, same-input (both systems encode every session, all
  run); delivered-loop comparisons are cross-phase and therefore different-days, and are
  reported as ranges with that caveat, never as paired numbers.
- **The independent-scorer rule.** [v1] §17.2, replay G5 — the scorer implements its own
  arithmetic and imports neither system under test.
- **The two richest comparison surfaces**, now produced by BOTH systems on the SAME
  lived days: the per-turn surfacing decision record and the per-boundary summary
  vector. Content-by-reference, so comparable without handling memory text. [v1] §17.3.
- **One content-address function joins the corpora** — and takes on a second duty here:
  it is the **cross-encoding meter** (§5 G7), detecting one system's ritual text minted
  into the other's store. [v1] §17.1.
- **Delivery telemetry, distinct from render.** [v1] scar §2.3 — the wake loop is graded
  on the adapter's two events (`adapter.wake.injected` vs `adapter.wake.delivered`), and
  v1's `ab.muted` is the mute's own delivery telemetry: a primary-phase day is only
  credited when the shadow's mute is *evidenced*, not assumed.
- **Created-versus-exited per kind, per system, per day.** [v1] scar §2.17 — how a
  starved curation path becomes visible, now side by side.
- **The pre-committed bars discipline.** [v1] §17.2 — every bar in §7 is committed
  before Phase P begins; v1's numbers are calibration to re-earn, not law (replay G10).
- **The carry-forward rule, extended to run continuity.** [v1] §17.2 — a mid-run change
  to v2 keeps its accumulated verdicts only when the machine-scored surface set is
  provably identical; otherwise the phase clock restarts (§5 G12).
- **Verified live, not merged.** [v1] §17.4 — this run *is* that guarantee's referent
  (replay G11: "a 1–2 week parallel run beside v1 is the irreducible live-verify").

## 4. Drops / simplifies

- **The alternate-day schedule.** Only the assignment file's `override` field is used;
  the `mode`/`anchor` machinery goes untouched. Phases flip primacy once, not nightly.
- **No counterfactual crediting, no simulated delivery.** Replay G6 inverted: a harness
  that constructs state the production path never has measures a system that does not
  exist — and so does a run that credits reinforcement for memories never delivered.
  Shadow-side delivered-loop metrics read `not-exercised`, never simulated.
- **No mid-run tuning.** A run measures one configuration. The carry-forward rule (§5
  G12) prices every change; nothing is smuggled in as "just telemetry" without the
  surface-set proof.
- **Replay's temp-store rule narrows to the instrument.** The subjects write their own
  live stores — that is the point of the run. Everything in `tools/parallel/` remains
  bound by the replay rule verbatim.
- **v1-side code changes are out of scope entirely.** The run leans only on v1 config
  that already exists. Where v1's behavior is inconvenient (it keeps injected text in
  its capture buffer by design — `hooks/boundary.ts` NOISE_PREFIXES excludes from
  pacing only), the answer is a meter, not a patch to the reference instance (§9 OQ4).
- **No benchmark scoring in-run.** longmemeval was measured on a different seat and does
  not travel (replay §4); a re-run is a separate, later baseline.

## 5. Contract

### Preconditions — each verified by the preflight, none waived by prose

1. **The replay gate is green** — the post-fix-batch re-run's machine-readable pass
   record, read by this harness at start (replay review: "the re-run that answers
   everything at once"). A `not-exercised` that only the parallel run can exercise is
   acceptable; a `fail` is not.
2. **The G12 symmetry consumer is live** (BUILD-STATUS gap 2: the ratchet tripwire
   "must be live DURING the parallel run; that is when it earns its keep").
3. **`scanSecrets` is bounded** (replay review follow-up: a non-ablatable gate with a
   pathological worst case now sits on the live turn path).
4. **The poison-pill retry is bounded** (replay review follow-up: unbounded restore is
   one model call per boundary, forever, on the owner's account).
5. **The self-store pressure valve has a wired relief** (replay review §10: the trip
   fired 7× in 26 replayed days with no compaction path; this run is longer).
6. **If the starting store is migrated (§9 OQ2): the confidentiality mapping lands**
   (BUILD-STATUS gap 5) **and the import path runs the secrets gate** (test-triage).
7. **The run is priced and approved, not assumed** — marginal spend is v2's embeddings
   plus crash-fallback sweeps; the authored dump rides the owner's session context, and
   that cost is named too.

### Shape

- **Phase 0 — preflight (no lived days count).** Realpath-disjoint data dirs; env
  pinned; assignment-file health; canary probes on **every injection channel, both
  directions** (v2's wake and recall canaries must not appear in v1's buffer as
  minted memories' sources beyond the metered channel; v1's wake, `<bansai-memory>`
  injections, and ritual asks must not enter v2's capture at all); the host's hook
  execution model measured, not assumed — if hooks run sequentially, two per-turn
  races stack, and the turn budget must be re-approved (scar §2.18).
- **Phase S — v1 primary, v2 shadow. ≥3 active days.** v1 runs exactly as it has all
  bake-in; v2 captures and encodes every session, delivers nothing, asks nothing. v2's
  encode loop, gates, mint volume, and store health are graded here against v1's on the
  same days. Exit on a checklist, not a date: isolation meters clean, encode parity
  bands holding, zero red-lines.
- **Phase P — v2 primary, v1 shadow. ≥7 active days.** One write to the assignment
  file's `override` mutes v1 (its wake, recall injection, and episode ask stand down
  with `ab.muted` telemetry; its encode continues untouched — v1's own A/B design, the
  vocabulary of its file honored as-is, with v2 occupying the slot engram vacated).
  v2 delivers the wake, surfaces recalls, owns the session-end choreography: the
  authored dump and the episode ask. Every delivered-loop criterion is graded here.
- **Verdict.** At Phase P's minimum with the scorecard rendered: PROMOTE, EXTEND, or
  REVERT (§7). REVERT is one config write back — reversibility is a file, which is why
  the run reuses v1's mechanism instead of inventing one.

### Inputs

Live host sessions (the owner's real days); v1's store and event logs, **read-only,
through the explicitly-designed read-only tooling class the repo's standing rules carve
out** (CLAUDE.md; same class as replay); v2's live store, written **only** by v2's own
production path; the shared primacy assignment file; the replay pass record; the
migration record if OQ2 resolves to migrated; a pinned vector generation; the
pre-committed bars.

### Outputs

A run record per active day (primacy, seat, vector generation, both systems' config
hashes, mute evidence, isolation meters); a cumulative scorecard with a four-value
verdict per criterion; the paired-rating queue and the owner's recorded verdicts;
divergence logs; the cutover pass record; the dashboard comparison views.

### Guarantees — **[M]** mechanized, **[A]** advisory

1. **[M] The instrument writes nothing but its own run directory.** Read-only open
   modes on both stores are test-asserted; `~/.bansai` and `~/.claude-engram` are never
   written by anything in `tools/parallel/`; no write handle is ever held on v2's live
   store (scars E7, §2.13; replay G1–G3, narrowed to the measuring layer).
2. **[M] Both subjects run their real production paths — no harness-threaded state**
   (replay G6, verbatim), **and every scorecard number is recomputable from the two
   durable stores plus logs after the fact.** The store the run leaves behind is the
   evidence; a metric derivable only from a live event ring is not a metric here.
3. **[M] Exactly one system delivers at any time.** Primacy is a single value in one
   shared file outside both data dirs; v1's resolver is its existing `src/ab.ts`,
   unchanged; v2's resolver **fails toward mute** where v1's fails toward inject — so
   the joint failure state of a torn or missing file is *v1-only, the status quo ante*,
   never two voices and never silence.
4. **[M] The mute is evidenced, not assumed.** v1's `ab.muted` events and v2's
   stand-down events are counted per day; a primary-phase day showing the shadow's
   delivery events (`wake.delivered` from the muted side) is a **contaminated day** —
   machine-detected from logs, excluded from phase minimums, and named in the
   scorecard (scar §2.4: a stood-down instrument must be distinguishable from a broken
   one — and from a revived one).
5. **[M] Shadow is encode-only, and honest.** No reinforcement fires on undelivered
   surfacing; no episode is asked by the shadow; every delivered-loop metric on the
   shadow side reads `not-exercised` for that phase.
6. **[M] Isolation preflight gates day 1.** Data dirs realpath-disjoint; the spawner
   pins the child's data-dir variable last (existing adapter G5); canary probes per
   injection channel, per direction, pass before any day counts (scar §2.18: a
   guarantee carried by the host's transcript format is verified, never assumed).
7. **[M] Cross-encoding is metered continuously, both directions, by content address** —
   v2's wake/dump/ritual text scanned against v1's spans and mints, v1's ritual text
   against v2's — with a pre-committed bar; above the bar it is a red-line, below it a
   named finding. What cannot be pattern-excluded (free-prose ritual answers) is
   metered, never assumed absent.
8. **[M] v2's capture excludes v1's injected material and recognizable ritual asks by
   pattern**, canary-verified — the adapter's existing "injected context never enters
   capture" (its G10 blind spot) extended with the v1-specific recognizers for the
   run's duration.
9. **[M] v1 exits the run unharmed.** No code path in this tool or in v2 opens a v1
   path for write (test-asserted). **[A]** The one cost that remains is named: during
   Phase P, v1 captures without delivering, so it earns no reinforcement and asks no
   episodes for those days — strength drift, bounded by the phase length, is the price
   of a hot standby, and the fallback rail (v1 flips public as-is) survives by
   construction.
10. **[M] Red-lines halt and preserve.** Silent span loss (E6 class), store corruption,
    a secrets-gate miss in either store, an isolation breach, a session broken by
    either system's hooks, cross-encoding above its bar, any write into v1: the run
    stops counting days, preserves both stores and the run directory as evidence, and
    the scorecard cannot render green.
11. **[M] The lived-day clock governs phase minimums** (scar E8) — active days, not
    calendar days — and every run record carries the acting seat, the pinned vector
    generation, both config hashes, and that day's primacy (the acting-seat rule,
    replay G8).
12. **[M] The carry-forward rule governs mid-run change.** Any change to v2 re-derives
    the machine-scored surface set; unless provably identical, the current phase's day
    count restarts and human-rated verdicts do not carry (replay's carry-forward keep,
    promoted to run law).
13. **[M] Four-value verdicts; a `not-exercised` is never silently green; the cutover
    switch reads the pass record**, not this document (replay G4 + the pass-record
    keep).
14. **[M] The dashboard comparison view is observer by construction and total**: every
    liveness row is displayed or marked absent (scar §2.17, dashboard G-totality);
    ids in state, text at render (scar §2.20 kin); the owner's ratings flow through
    the run directory, never through either store.
15. **[A] The bars are committed before Phase P begins**, in the run directory, dated —
    and v1's numbers are calibration to re-earn, not inherited law (replay G10).
16. **[A] Shadow-recall telemetry is optional and second-class.** v2 MAY compute
    undelivered surfacing decisions during Phase S for same-turn comparison against
    v1's delivered ones — reinforcement structurally off, never admissible as liveness
    evidence, and dropped without ceremony if the preflight shows the turn budget
    cannot afford a second race.

## 6. What this run measures that replay could not — the turn loop

Replay's own review said it plainly: *"the store looks healthy; this run does not
demonstrate that the system is."* Replay drove no turns. The four surfaces below are
the charter; each criterion is graded four-valued against §5 G15's committed bars.

**Recall.** Per-turn surfacing decision records on real turns — tier counts, affect
flags, ids with salience. Loud-tier intrusion ≤5% (needs-rater) and coverage ≥60%,
re-earned, not inherited; footnote-flood and affect-noise retune bars live. The
dark-behavior class gets its only honest test: per-session gate state, session dedup,
the emotional refractory, cue zeroing, and cross-session carry-over each show evidence
of firing **on the true host path** — the exact class that was tested-and-inert in v1
because only a harness ever threaded the state (replay G6's origin). The surfacing
race's win rate and timeout rate under the real turn budget.

**Reinforcement.** The loop replay structurally zeroed (`uses=0` on every row, review
§7): recall credit on real use, with the assistant-stream rule (a user mentioning a
memory is not the assistant using it). At least one promotion earned through the
N=3-distinct-days gate. Band transitions BY DIRECTION with the G12 symmetry watchdog
live and its verdict rendered by reason — the ratchet tripwire earning its keep (scar
§2.10). The salience-lift watch (replay F5: 97.9% of mints lifted, shaping the whole
store) finally gains its independent check: lifted claims that never earn reinforcement
are now *visible* as a divergence, not just a lift rate.

**Episodes — and the authored path, which has no replay counterpart at all** (replay
OQ2: measurable only forward; this is where). The experiencer's session-end dump: fire
rate per session-ending path, coverage claimed by hash, malformed-degraded-to-span
rate. The self front door actually fed — v1's `selfstore.append` recorded zero fires in
a month, the starved-front-door scar; "reachable by construction" is now observed
firing, not asserted. Episode ingest; the self-mint mix against replay F8's
sweep-only baseline. Boundary coverage becomes falsifiable (review §7's tautology
dies here): real aborts, real compactions, the crash-fallback trigger on a real miss.

**Wakes.** Render versus arrival, per session (scar §2.3's two events). The injection
ceiling discovered in the live host, not assumed. The next-wake-remembers chain
observed across real days on a growing store — the loop the replay fixture proved once,
now under churn. Briefing budget and trim order at real store sizes; wake usefulness as
an owner-rated criterion.

**Riding along:** the true chunk-size distribution at real capture cadence (replay's
mega-chunks were a driver artifact); the blind rate on its honest clock — reported
*still-stabilizing* if the window is short, never laundered into a pass; hook latency
and detached-worker health under real days; marginal cost per day.

## 7. What "v2 wins" means — the decision rule

**PROPOSED** (the bar itself is §9 OQ1; the structure below is the contract):

1. **Zero red-lines** (§5 G10) across the whole run.
2. **Liveness green**: every turn-loop mechanism in §6 fired at least once, genuinely,
   on the production path — and anything that did not is named `not-exercised` on the
   scorecard, which then cannot render green without an owner-signed waiver naming it.
3. **Parity bands held** (machine-scored, distributional): daily mint volume in v1's
   neighborhood on the same days; kind mix; gates-**acting** rate (replay F7's
   reframe — v1's refusal vocabulary does not map, so acting-rate is the comparable);
   duplication share; briefing bytes under ceiling; hook latency within the host
   budget. Encode-side bands are same-day paired — the strongest comparability this
   project has ever had; delivered-loop bands are cross-phase and say so.
4. **The owner's paired verdict, not-worse**: blind, paired samples — the same
   session's minted memories from both systems, origin-masked — with the owner rating
   which memory of the week they would rather wake up with. This is the authorship
   thesis's direct test, and it is a needs-rater criterion; the carry-forward rule
   protects the ratings.

**The verdict is one of three, recorded in the pass record:** **PROMOTE** — v2 stays
primary, v1's hooks retire to warm standby, the post-run watches (§9 OQ7) begin.
**EXTEND** — a named `not-exercised` or still-stabilizing metric buys more days,
bounded by the rail. **REVERT** — one config write; the failure is named; re-entry is
priced by the carry-forward rule. The ~09-22 rail is not renegotiated by this tool: if
no green verdict exists in time, v1 flips public as-is (DECISIONS, 2026-08-25) and the
run becomes evidence for v2's next attempt rather than a gate that slipped.

## 8. Scars honored

**E4** (both systems' heavy work stays detached and watchdogged; the run adds no
foreground weight to a turn beyond the measured budget) · **E6** (silent span loss is a
red-line, on either side) · **E7** (the measuring layer leaves every store as it found
it) · **E8** (phase minimums count lived days) · **§2.3** (render vs delivery, and the
mute's own delivery telemetry) · **§2.4** (contaminated days are counted, not silently
dropped; a stood-down side is distinguishable from a broken one) · **§2.10** (G12 live
during the run — strengthening without a live-verified softening path is a ratchet) ·
**§2.13** (realpath'd isolation, env pinned, no environment default honored) · **§2.17**
(created-versus-exited per kind, per system, side by side) · **§2.18** (host hook
semantics measured at preflight, never assumed) · **§2.20** (comparison surfaces are
content-by-reference; ids in state, text at render).

## 9. Open questions — ranked, for the owner

1. **The cutover bar: parity-plus-strategy, or measured superiority?** §7 proposes
   parity (the strategic wins — SQLite-canonical operational state, packaging,
   legibility — ride outside the scorecard). The stricter bar: the paired rating must
   show v2 *preferred*, not tied. One sentence from you makes the verdict mechanical.
2. **The starting store: migrated from v1, or empty?** PROPOSED: migrated — the run
   then live-verifies the migration (which cutover needs anyway), and v2's recall is
   not starved for the whole run. Costs: gap 5 (confidentiality mapping) graduates to
   hard precondition, and migrated rows must be origin-marked so paired ratings
   compare only same-window mints. Empty is cleaner but measures an amnesiac cutover
   nobody plans to perform.
3. **At PROMOTE, is the parallel store THE production store?** PROPOSED: yes —
   anything else discards the verified weeks and performs a second, unverified
   migration.
4. **Cross-encoding disposition: accept-and-meter, or patch v1?** PROPOSED:
   accept-and-meter (§5 G7). v1 keeps injected text in its capture buffer *by design*
   (`hooks/boundary.ts`); a v1-side stripper is a capture behavior change to the
   reference instance mid-bake-in — the reference stops being a reference. You set the
   meter's red-line bar.
5. **Phase minimums, spend, and the rail arithmetic.** 3+7 active days plus preflight
   fits before ~09-22 only if the §5 preconditions close by roughly 09-08. Priced and
   approved, not assumed — including the authored dump's session-context cost, which
   lands on your account, not an API line item.
6. **Which v1 window anchors the parity bands?** PROPOSED: v1's standing 30-day
   baselines set the band; the same-run shadow days are shown beside them as the
   paired anecdote. Same-days alone is too small an n to be a band; the standing
   window alone ignores the best-matched data the run produces.
7. **Which watches outlive PROMOTE?** Blind rate and self-share need weeks the run
   does not have; the salience-lift divergence and birth-rate watches are young.
   PROPOSED: a named post-cutover watch list with the same four-value discipline, and
   v1's store kept readable indefinitely — it is the owner's history, not a fixture.
