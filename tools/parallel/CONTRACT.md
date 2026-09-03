# `tools/parallel/` — CONTRACT

*Adversarially reviewed 2026-09-03 before merge — six blockers and five should-fixes,
all applied in this text (PR #7). A design document; the build follows the owner's §9
rulings.*

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
  is never tested. **This reopens the harvest's A/B disposition for the run's duration
  only** (decisions-triage: obsolete; adapter CONTRACT §4: "settled by the harvest"):
  v2's participation is a run-scoped primacy resolver behind an adapter flag
  (`parallel.enabled`), not a resumption of the dropped A/B, and the adapter's §4 stands
  after the run. Noted too: v1's resolver was never fail-safe toward silence — it fails
  open to "both", which is two voices.
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

1. **The replay gate is green for this run's purposes** — read by the preflight from a
   machine-readable pass record through a predicate THIS tool defines,
   `parallelGateOpen(record)`: `readOnlyProof && totalityOk && counts.fail === 0 &&`
   every `not-exercised` id ∈ `PARALLEL_EXERCISABLE` ∪ `NOT_APPLICABLE_TO_RUN` `&&` every
   `needs-rater` id ∈ `RATER_DEFERRED` — all three sets enumerated in `tools/parallel/`
   and copied into the run directory; an id outside them shuts the gate. (The third set
   was forced by the build: 23 registry rows read `not-exercised`, and only 13 name a
   surface this run can move; the other 10 are v1 mechanisms with no v2 counterpart —
   `ops.outcomeMix`, `gradient.moveMix`, `runner.duration` and their kin — and are
   G13's `not-applicable`, named as such rather than laundered into "exercisable".) Replay's own `gateOpen()` (which
   also demands zero `not-exercised` and zero `needs-rater`) is the CUTOVER gate and
   cannot be satisfied by any replay record: its 23 `not-exercised` rows are §6's
   charter and its 2 `needs-rater` rows have no rater outside this run (replay
   INTERFACE-GAPS §3, §5, §7). It is untouched and unused here. What the predicate
   still requires is `fail === 0`, which only a re-run produces: either the full 26-day
   re-run, or the queued sample (`--days 5..7`), whose `sample: true` the predicate
   refuses unless an **owner-signed waiver file** in the run directory names that
   record's id and the reason — the preflight reads the waiver; prose does not. **Owner
   decision, dated in the run record; drop-dead 2026-09-08** (OQ5's arithmetic).
   **RULED 2026-09-03 (owner): the sample route** — the queued `--days 5..7` sample,
   its previously-failing channels read on the per-day trend, and the signed waiver
   file naming that record; the full re-run stays available if the trend is bad.
2. **The G12 symmetry consumer is live** (BUILD-STATUS gap 2: the ratchet tripwire
   "must be live DURING the parallel run; that is when it earns its keep").
3. **`scanSecrets` is bounded** (replay review follow-up: a non-ablatable gate with a
   pathological worst case now sits on the live turn path).
4. **The poison-pill retry is bounded** (replay review follow-up: unbounded restore is
   one model call per boundary, forever, on the owner's account).
5. **The self-store pressure valve has a wired relief, or evidence it no longer trips**
   (replay review §10: the trip fired 7× in 26 replayed days with no compaction path;
   this run is longer). The F8 quarantine (owner ruling 2026-08-29) removed the trip's
   dominant source — 205 sweep-minted self rows in the blind replay. Two readings decide
   whether relief is still owed: the sample re-run's `self.schema.tripped` count, and
   `schemaBytes` on the migrated store at preflight. Relief is built only for a failure
   still named in real use (Amendment 15), and the preflight records which reading
   closed this line.
6. **If the starting store is migrated (§9 OQ2): the confidentiality mapping lands**
   (BUILD-STATUS gap 5) **and the import path runs the secrets gate** (test-triage).
7. **The run is priced and approved, not assumed** — marginal spend is v2's embeddings
   plus crash-fallback sweeps; the authored dump rides the owner's session context, and
   that cost is named too.
8. **The ask channel is proven on this host — before Phase P.** A v2 Stop-hook ask is
   observed arriving in the model's context at least once in a throwaway session, with
   the channel and exit code recorded as an adapter capability (adapter G4, scar §2.18).
   v2's `bin/hook.ts` writes its asks to plain stdout and exits 0, a channel no v2 hook
   has yet demonstrated on this host (v1 blocks with stderr + exit 2). Phase S asks
   nothing, so Phase P day 1 is the authored dump's first fire anywhere: a dead channel
   there is a silent zero, not a low number. Gates the S→P flip, not day 1.
9. **The per-turn surfacing decision record is durable — before Phase P.** G2 and G12
   both stand on it (replay INTERFACE-GAPS §7: not persisted today). Without it no §6
   Recall criterion is recomputable from the store and G12's "provably identical" has
   nothing to hash. Gates the S→P flip, not day 1.

### Shape

- **Phase 0 — preflight (no lived days count).** Realpath-disjoint data dirs; env
  pinned; **assignment-file health: the path resolves to the same realpath from both
  hook processes' environments (`MEMORY_AB_DIR` unset for both), the file parses, and
  `override` is exactly `"bansai"` or `"engram"`** — null, absent or `"none"` is a
  preflight FAILURE, not a default, because it re-arms v1's alternate-day parity against
  a system that no longer exists (G3); canary probes on **every injection channel, both
  directions** (v2's wake and recall canaries must not appear in v1's buffer as
  minted memories' sources beyond the metered channel; v1's wake, `<bansai-memory>`
  injections, and ritual asks must not enter v2's capture at all — the wake and recall
  halves are carried by the host's transcript shape, not by v2, and are re-probed on any
  host upgrade during the run); the host's hook execution model measured, not assumed
  — if hooks run sequentially, two per-turn races stack, and the turn budget must be
  re-approved (scar §2.18); the SessionEnd budget the host shares across all hooks
  measured with both systems' hooks installed. The cross-encoding bar (G7) and the
  active-day floor (below) are committed here, dated, before Phase S day 1.
- **Phase S — v1 primary, v2 shadow. ≥3 active days.** v1 runs exactly as it has all
  bake-in; v2 captures and encodes every session, delivers nothing, asks nothing. v2's
  encode loop, gates, mint volume, and store health are graded here against v1's on the
  same days. Exit on a checklist, not a date: isolation meters clean, encode parity
  bands holding, zero red-lines.
- **Phase P — v2 primary, v1 shadow. ≥7 active days.** One write to the assignment
  file's `override` — `"engram"`, the slot v2 occupies; the only field touched; written
  tmp+rename **with no host session open** (v1's resolver re-reads the file at every
  hook and latches nothing per session, so a mid-session flip is two voices in one
  session); the file backed up beside itself first, dated; the flip's wall clock stamped
  in the run record — mutes v1 (its wake and recall injection stand down with
  `ab.muted` telemetry, its episode ask stands down WITHOUT one — G4; its encode
  continues untouched — v1's own A/B design, the vocabulary of its file honored as-is).
  v2 delivers the wake, surfaces recalls, owns the session-end choreography: the
  authored dump and the episode ask. Every delivered-loop criterion is graded here.
- **Verdict.** At Phase P's minimum with the scorecard rendered: PROMOTE, EXTEND, or
  REVERT (§7). REVERT is one config write back — reversibility is a file, which is why
  the run reuses v1's mechanism instead of inventing one.
- **What counts as a day.** An **active day** is a lived day (scar E8) on which both
  systems reached at least one session boundary AND the day carried at least K
  conversational turns, K committed in the run directory before Phase S day 1. Every
  other lived day is recorded with a class and NOT counted toward a phase minimum:
  **thin** (below the floor), **contaminated** (the muted side delivered — G4),
  **mixed** (a session straddled the flip: a delivery event and a later `ab.muted` in
  the same v1 session), **silent** (v1 muted at session start and no v2
  `adapter.wake.injected` for that session — the state G4 cannot see by counting extra
  voices, so it is counted by its absence). Classes are reported side by side with the
  active count, never folded into it.

### Inputs

Live host sessions (the owner's real days); v1's store and event logs, **read-only,
through the explicitly-designed read-only tooling class the repo's standing rules carve
out** (CLAUDE.md; same class as replay); v2's live store, written **only** by v2's own
production path and read by the instrument through the same read-only handle class as
replay's corpus reader — never through `Store.open()`, which mkdirs and runs DDL at open
(CLI §7); the shared primacy assignment file; the replay pass record; the
migration record if OQ2 resolves to migrated; a pinned vector generation; the
pre-committed bars.

### Outputs

A run record per lived day (its class; primacy, seat, vector generation, both systems'
config hashes, mute evidence, isolation meters) with **that day's relevant v1 log lines
copied in, read-only** — G2's evidence must not depend on v1's 30-day log retention —
and the wake-delivery denominator defined as sessions with at least one user prompt
after session start (delivery telemetry rides on the next hook — adapter NOTES §4); a
cumulative scorecard with a four-value
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
   Build note (2026-09-03): v2's delivery records (`adapter.wake.injected`,
   `adapter.wake.delivered`, `adapter.recall`, `adapter.episode.ask`) and its primacy
   verdicts are durable rows with the calendar date and session in the payload; the
   symmetry verdict, the quarantine count and the self-store bytes are recomputed
   read-only from durable state rather than stored — named as such by the instrument.
3. **[M] Exactly one system delivers at any time.** Primacy is a single value in one
   shared file outside both data dirs; v1's resolver is its existing `src/ab.ts`,
   unchanged; v2's resolver delivers **only** on `override === "engram"` and **fails
   toward mute** on everything else, where v1's fails toward inject — so the joint
   failure state of a torn or missing file is *v1-only, the status quo ante*. Three
   reachable states break "one voice", and each has a named guard: a null/absent
   `override` re-arms v1's alternate-day parity while v2 mutes — **silence** on
   alternate days — so the preflight asserts `override ∈ {"bansai","engram"}` exactly;
   a mid-session flip is two voices because v1 re-reads the file at every hook — so the
   flip is written with no session open and a straddling session marks a **mixed** day;
   `MEMORY_AB_DIR` can split the two processes onto different files (scar §2.13, in the
   one file both must share) — so the preflight asserts the same realpath from both
   environments.
4. **[M] The mute is evidenced, not assumed — per channel, by named detector.** Mute
   evidence: v1's `ab.muted {hook: session_start}` and `ab.muted {hook:
   user_prompt_submit}`, and v2's `adapter.primacy.standdown {hook}`, counted per day
   from durable logs. Contamination: a primary-phase day on which the muted side emits
   ANY of `wake.rendered` / `wake.delivered` (wake), `surface.decision {phase: inject}`
   (recall), `episode.asked` (ritual) on v1's side, or `adapter.wake.injected` with
   bytes / `adapter.recall` with bytes / `adapter.episode.ask` on v2's side, is a
   **contaminated day** — machine-detected, excluded from phase minimums, named in the
   scorecard (scar §2.4: a stood-down instrument must be distinguishable from a broken
   one — and from a revived one). **[A] The episode-ask channel has no mute event in
   v1**: `hooks/stop.ts` logs nothing on the muted branch, so its silence is
   byte-identical to ordinary pacing. That channel is graded by the absence of
   `episode.asked` only — a weaker claim, named here rather than laundered into the [M]
   above, and not patched (§4: no v1-side code changes). Noted: v1's `wake.delivered`
   fires at its render site despite the name; on v1's side the two events are one, and
   the run says so wherever it cites them.
5. **[M] Shadow is encode-only, and honest.** No reinforcement fires on undelivered
   surfacing; no episode is asked by the shadow; every delivered-loop metric on the
   shadow side reads `not-exercised` for that phase.
6. **[M] Isolation preflight gates day 1.** Data dirs realpath-disjoint; the spawner
   pins the child's data-dir variable last (existing adapter G5); canary probes per
   injection channel, per direction, pass before any day counts (scar §2.18: a
   guarantee carried by the host's transcript format is verified, never assumed).
7. **[M] Cross-encoding is metered continuously, both directions, by content address** —
   v2's wake/dump/ritual text scanned against v1's spans and mints, v1's ritual text
   against v2's — with a bar committed **before Phase S day 1** (the meter is a red-line
   from the preflight forward; a bar committed at Phase P would leave it toothless for
   the phase that exposes v2 most); above the bar it is a red-line, below it a named
   finding. Rows whose mint source is `migrated` (PR-2 doctrine) are excluded from the
   meter by construction — v1-origin text in v2's store is the migration, not
   contamination. **[A] Content address catches verbatim re-minting and nothing else.**
   The dominant path is semantic: the primary injects a recall, the assistant restates
   it in its own words, the restatement is conversation-source and enters the shadow's
   capture legitimately. That is not detectable by this meter and is not claimed; it is
   bounded by the recall volume the primary delivered, reported beside the meter as the
   exposure denominator. Naming the blind spot is the guarantee.
8. **[M] v2's capture excludes v1's ritual material by SOURCE, not by regex on text**:
   host-fed hook feedback carrying a v1 ritual marker is classified at `transcript.ts`
   as a new `TurnSource` (`foreign`) that `remember/`'s `enters()` refuses — one
   recognizer list, one place, for the run's duration. This leaves the adapter's G11
   split untouched (host-injected context stays kept-in-capture, excluded-from-pacing),
   which the first draft of this line contradicted. Measured on this host (2026-09-03):
   v1's wake and `<bansai-memory>` blocks arrive as `hook_additional_context`
   attachments with no message role and never reach capture today — an exclusion
   carried by the host's transcript shape, not by v2 (scar §2.18), hence canary-probed
   at preflight and re-probed on any host upgrade; a canary found in v2's capture is a
   red-line. The one channel that DOES land as a user-role message — v1's episode ask,
   `Stop hook feedback:` + `[bansai] …` — is the `foreign` case.
9. **[M] No code path in this tool or in v2 opens a v1 path for write**
   (test-asserted). "Unharmed" means *unwritten by this tool*, never *unchanged*.
   **[A] Two costs are named, not denied.** (a) During Phase P v1 captures without
   delivering: no reinforcement, no episodes — strength drift bounded by the phase
   length, plus **a ≥7-day gap in v1's episode journal that REVERT does not fill**; the
   owner's authored episodes for that window exist only in v2's store. (b) v1 keeps
   v2's injected text in its capture buffer by design (OQ4), so v1's own sweep mints
   v2-derived memories on those days: metered by G7, identifiable by lived day, and
   removable through v1's own owner path if REVERT is taken. v1 is the ~09-22 rail —
   this is the shipping product's memory, not instrument exhaust. **REVERT is therefore
   one config write PLUS a named disposition for v2's Phase-P authored episodes** —
   they are the owner's data (constitution 6, 7), exported to the run directory before
   the store is set aside.
10. **[M] Red-lines halt and preserve.** Silent span loss (E6 class), store corruption,
    a secrets-gate miss in either store, an isolation breach, a session broken by
    either system's hooks, cross-encoding above its bar, any write into v1: the run
    stops counting days, preserves both stores and the run directory as evidence, and
    the scorecard cannot render green.
11. **[M] The lived-day clock governs phase minimums** (scar E8) — active days, not
    calendar days — and every run record carries the acting seat, the pinned vector
    generation, both config hashes, and that day's primacy (the acting-seat rule,
    replay G8).
12. **[M] The carry-forward rule governs mid-run change, by class, declared before the
    change lands.** The machine-scored surface set is the hash of the per-turn
    surfacing decision records' fields (tier counts, affect flags, ids with salience,
    budget, reason — precondition 9) plus the gate-record and band-transition fields,
    re-derived on any change to v2. **Identical** hash (telemetry-only, run-directory
    only): day count and ratings carry. **Red-line fix** (G10): the clock restarts only
    for the criteria whose surface set moved, and the scorecard names them — the run
    must survive its first bug or it measures nothing (replay G11's own premise).
    **Anything else**: the phase restarts and human-rated verdicts do not carry. The
    class is recorded in the run record before the change lands, never argued after.
13. **[M] Four-value verdicts plus one pre-declared exclusion; a `not-exercised` is
    never silently green; the cutover switch reads the pass record**, not this document
    (replay G4 + the pass-record keep). The fifth value, **`not-applicable`**, is a
    criterion structurally out of scope for a phase (every delivered-loop metric on the
    shadow side — G5), **enumerated in the run directory before the phase begins**; it
    needs no waiver and can never render green. `not-exercised` is reserved for a
    mechanism that should have fired and did not — that is what §7's waiver covers.
    Without the split every scorecard carries by-design `not-exercised` rows, the owner
    signs routinely, and a genuinely starved mechanism rides through (scar §2.4).
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
flags, ids with salience. Loud-tier intrusion (needs-rater) and coverage, each against
a bar re-earned in the run directory, never a number inherited from v1 into this text;
footnote-flood and affect-noise retune bars live. The
dark-behavior class gets its only honest test: per-session gate state, session dedup,
the emotional refractory, cue zeroing, and cross-session carry-over each show evidence
of firing **on the true host path** — the exact class that was tested-and-inert in v1
because only a harness ever threaded the state (replay G6's origin). The surfacing
race's win rate and timeout rate under the real turn budget.

**Reinforcement.** The loop replay structurally zeroed (`uses=0` on every row, review
§7): recall credit on real use, with the assistant-stream rule (a user mentioning a
memory is not the assistant using it). At least one promotion earned through the
N=3-distinct-days gate (presumes a starting store with reinforceable history — OQ2
migrated; on an empty store the criterion is `not-applicable`, not a failure). Band transitions BY DIRECTION with the G12 symmetry watchdog
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
   budget. Encode-side bands are same-day paired **for v2's crash-fallback sweep, which
   is what Phase S exercises** — the strongest comparability this project has ever had,
   for the path v2 intends to demote; v2's authored path has no same-day v1 pairing by
   construction and is reported cross-phase, as a range, with that caveat, as are the
   delivered-loop bands.
4. **The owner's paired verdict, not-worse**: paired samples — the same lived day's
   minted memories from both systems, origin-masked, drawn **within a single day and
   presented in randomized order**, never grouped by week or phase (the week identifies
   the phase, and the owner performed the flip). The prose style is itself the
   authorship thesis — first-person experiencer against third-person sweep — so the
   blind is not assumed intact: the rater records a **guess of origin before the
   preference**, the guess rate is reported with the verdict, and above chance the
   criterion downgrades openly to a labeled preference test. Phase-S pairs (both
   systems sweeping) are the clean same-path comparison; Phase-P pairs compare authored
   against swept and say so on their face. A needs-rater criterion; the carry-forward
   rule protects the ratings.

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
   **RULED 2026-09-03 (owner): parity-plus-strategy.** Seven active days is a small
   rating sample; a tie on it with the strategic wins outside the scorecard is an
   honest PROMOTE, and the strict bar would convert noise into REVERT.
2. **The starting store: migrated from v1, or empty?** PROPOSED: migrated — the run
   then live-verifies the migration (which cutover needs anyway), and v2's recall is
   not starved for the whole run. Costs: gap 5 (confidentiality mapping) graduates to
   hard precondition, and migrated rows must be origin-marked so paired ratings
   compare only same-window mints. Empty is cleaner but measures an amnesiac cutover
   nobody plans to perform. **RULED 2026-09-03 (owner): migrated.** Precondition 6 is
   therefore hard; the confidentiality mapping and the import-path secrets gate exist
   with named tests (`test/migrate.test.ts` G1, G2), and what remains is the real
   `--apply` into a fresh v2 data dir with the source-manifest proof.
3. **At PROMOTE, is the parallel store THE production store?** PROPOSED: yes —
   anything else discards the verified weeks and performs a second, unverified
   migration. **RULED 2026-09-03 (owner): yes.**
4. **Cross-encoding disposition: accept-and-meter, or patch v1?** PROPOSED:
   accept-and-meter (§5 G7). v1 keeps injected text in its capture buffer *by design*
   (`hooks/boundary.ts`); a v1-side stripper is a capture behavior change to the
   reference instance mid-bake-in — the reference stops being a reference. You set the
   meter's red-line bar. **RULED 2026-09-03 (owner): accept-and-meter.** The bar, in
   two numbers: Phase S, ZERO verbatim hits in either direction (the host's transcript
   shape carries v1's exclusion, so any hit means the host changed — red-line); Phase P,
   any hit is a named finding, and a red-line only above **10% of v1's daily mints**
   carrying a verbatim v2 line.
5. **Phase minimums, spend, and the rail arithmetic.** 3+7 active days plus preflight
   fits before ~09-22 only if the §5 preconditions close by roughly 09-08. Priced and
   approved, not assumed — including the authored dump's session-context cost, which
   lands on your account, not an API line item. If the replay-record decision
   (precondition 1) and preconditions 4–5 do not land inside that window, the run does
   not start and v1 flips as-is — the outcome §7 already contemplates, and better than a
   run whose clock restarts on its first red-line. **RULED 2026-09-03 (owner): approved
   in principle** — the API side (v2's embeddings plus crash-fallback sweeps) is dollars,
   the actual to be logged against the sample run's measured cost; the authored dump's
   cost lands on the owner's subscription context and is named as such.
6. **Which v1 window anchors the parity bands?** PROPOSED: v1's standing 30-day
   baselines set the band; the same-run shadow days are shown beside them as the
   paired anecdote. Same-days alone is too small an n to be a band; the standing
   window alone ignores the best-matched data the run produces. **RULED 2026-09-03
   (owner): the 30-day window sets the band; same-run days shown beside it.**
7. **Which watches outlive PROMOTE?** Blind rate and self-share need weeks the run
   does not have; the salience-lift divergence and birth-rate watches are young.
   PROPOSED: a named post-cutover watch list with the same four-value discipline, and
   v1's store kept readable indefinitely — it is the owner's history, not a fixture.
   **RULED 2026-09-03 (owner): as proposed** — the list is written into the run
   directory at PROMOTE, and v1's store stays readable.
