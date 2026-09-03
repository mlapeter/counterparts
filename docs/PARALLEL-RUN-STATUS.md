# Parallel run — status

*The living record of the v1/v2 parallel run: what started and when, the watches and
their four-value discipline, the daily check, and the REVERT lever. The contract is
`tools/parallel/CONTRACT.md` (PR #7); the instrument is `tools/parallel/` (README
there). Numbers here are copied from run-directory artifacts, never typed from memory.*

## State — 2026-09-03

**NOT STARTED.** Preconditions closed in code (branch reviewed twice, PR #8); the
sample replay is done and read below, and it opens the gate on the wiring-alive
predicate — there is no waiver to wait for. Day 0 needs the owner's hand several times
(snapshot, hook wiring, the throwaway session, the flip) and happens in-session; the
flip is day 0's LAST step, and day 1 is v2-primary.

| | |
|---|---|
| Phase | 0 (day 0, pre-flip) — then P, from day 1. There is no Phase S |
| Run directory | `~/counterparts-parallel-run/<start-date>/` — not yet created |
| v2 data dir | `~/.counterparts/store` (a subdirectory on purpose — see *Known hazards*) |
| v2 config | `~/.counterparts/claude-code.json` — drafted, not written |
| Assignment file | `~/.memory-ab/assignment.json` = `override: "bansai"` (v1 primary; flipped to `"engram"` at the end of day 0) |
| Rail | ~2026-09-22: no green verdict by then ⇒ v1 flips public as-is |

## Rulings (owner, 2026-09-03 — all seven §9 questions, plus two the same evening)

- **P1** the sample route, and **NO WAIVER**: the `--days 7 --embed` sample, trend read
  per day, judged by the **wiring-alive predicate** — cards shown, blind rate under
  1.0, refusal mix computed. *"I'm not sure our intent was to require signing things to
  change them."* Band failures are the run's to re-earn, not anyone's to waive;
  `waivers.json` no longer exists.
- **NO SHADOW PHASE**: v2 is primary from day 1. v1 stays installed, muted by the
  one-line `override: "engram"` flip, and KEEPS ENCODING; the instrument watches both;
  REVERT is one line back. The **day-1 go/no-go** replaces the shadow days.
- **OQ1** parity-plus-strategy. **OQ2** migrated starting store. **OQ3** the parallel
  store is the production store at PROMOTE. **OQ4** accept-and-meter; the two ruled
  numbers now read by DIRECTION: v1→v2 zero verbatim hits in every phase (host shape,
  red-line), v2→v1 a named finding, red-line above 10% of v1's daily mints.
  **OQ5** spend approved in principle, actuals logged below.
  **OQ6** v1's 30-day window sets the bands; same-run days beside them. **OQ7** a named
  post-cutover watch list; v1's store readable indefinitely.

Journal: `~/bansai/docs/DECISIONS.md`, entries dated 2026-09-03.

## Preconditions — each with its named verification

| # | Precondition | Status | Verification |
|---|---|---|---|
| 1 | Replay gate green — the wiring proven alive | **closed by the sample** | `parallelGateOpen` over `pass-record.json` alone; the three `WIRING_ALIVE` channels; preflight row `replay.gate` |
| 2 | G12 symmetry consumer live | closed | `test/sleep.test.ts` ("a RATCHET trips…", "never-asked…"), `test/dashboard.test.ts` ("renders by REASON"); daily: `sleep.symmetry` recomputed from `band.transition` |
| 3 | `scanSecrets` bounded | closed on branch | `SCHEME_TAIL {0,32}` and the `url-path-token` host/path class `{0,512}`; `test/encode.test.ts` "the scan is bounded" (four shapes); measured 744ms → 2ms at 32KB, 179ms → linear on the URL-list shape |
| 4 | Poison-pill retry bounded | closed on branch | `MAX_SPAN_FAILURES=3` **distinct lived days** (an outage day is one failure), `failures.jsonl`, `quarantine.jsonl`, `remember.span.quarantined`; seven tests in `test/remember.test.ts` |
| 5 | Self-store valve: relief or evidence | **pending two readings** | the sample's `self.schema.tripped` count; `schemaBytes` on the migrated store (preflight row `store.schemaBytes`) |
| 6 | Migration: confidentiality + secrets gate | code closed; **apply pending** | `test/migrate.test.ts` G1/G2; dry run 2026-09-03 on the live store: 26 redactions (19 google-api-key), 10 floor refusals named; `--apply` from a quiescent snapshot on day 0 with `source_readonly.identical: true` |
| 7 | Priced and approved | approved in principle | `pricing.json` in the run dir; actuals below |
| 8 | Ask channel proven on host | **day 0, pre-flip** | a v2 Stop-hook ask observed in a throwaway session in which v2 DELIVERS (it never asks while muted); recorded as `ask-channel.json` `{observedAt, channel, exitCode, session}` in the run dir, read by the `--phase 0` preflight |
| 9 | Surfacing decision record durable | closed on branch; **evidenced on day 0** | `recall.decision` rows (written only on a turn v2 delivered — the throwaway session); `surfaceSetFields()` hash in `run.json` from the day-0 daily; `test/counterpart.test.ts` "the surfacing decision is DURABLE" |

Also landed on the branch: v2's primacy resolver (deliver iff `override === "engram"`,
fail toward mute) behind `parallel.enabled`; the four delivery records durable with
date and session; the `foreign` turn source (v1's episode ask never enters v2's
capture); the G9 source tripwire; `tools/parallel/` with its own G1 proofs.

## Sample replay (precondition 1's evidence)

Fired 2026-09-03 17:05 UTC: `run-replay --days 7 --embed --fire`, Opus seat, Voyage
live, corpus days 2026-07-27..08-04 (292 span files, 52 sessions, ~4.3 MB), code at
`065fcb5`. Output: `~/counterparts-replay-runs/sample-7d-2026-09-03/`.

Finished 2026-09-03 19:01 UTC, exit 0. Record `run_6530ad2ee770`, harness `replay/2`,
`sample: true`, `readOnlyProof: true`, `totalityOk: true`; counts 15 pass / 11 fail /
2 needs-rater / 23 not-exercised / 5 watch. 166 chunks, 2,379 mints, lived day 7.
Cost: no usage logging in the runner; from token volume (≈1.2M input from spans plus
prompt overhead, ≈0.3M output) about **$16–20** on Opus 5 pricing, under the $25–40
estimate. The console bill is the actual.

**The per-day trend — the wiring proof (early days blind by construction):**

| corpus day | chunks gated | blind | mean cards shown |
|---|---|---|---|
| 07-27 (d0) | 3 | 3 (100%) | 0.00 |
| 07-29 | 7 | 7 (100%) | 0.00 |
| 07-30 | 25 | 20 (80%) | 0.20 |
| 07-31 | 11 | 9 (82%) | 0.18 |
| 08-01 | 27 | 22 (81%) | 0.22 |
| 08-03 | 17 | 2 (12%) | 1.12 |
| 08-04 | 63 | 29 (46%) | 0.79 |

Read honestly: the cards channel is alive and climbing (schemas shown 0 → 1.12 → 0.79;
aggregate 0.54 passes its band), the blind rate falls from 100% to 12% by day 6 and
sits at 46% on the heaviest day — **still-stabilizing**, not in v1's 10–35% band
(aggregate 60% fails, as a 7-day window starting empty must). Novelty is non-null on 61
of 153 chunks (40%; null only on blind chunks) against zero in the first run. Refusal
mix passes. Salience: 62% of mints lifted (first run 98%), and the reteller's cap bit
on 76% of lifts — the mint-source doctrine working. Schema-birth grounding barely
moved: 12 births / 390 attempts (96.9% refused, 97% of them `name-not-in-source`; first
run 98.9%) — a named watch, not a wiring failure. Channel mix: 82% of shown cards
reached by the semantic channel alone (fails a band calibrated on one v1 day).

**One finding that is not a wiring question: mint yield.** 15.06 mints per chunk
(2,379 / 158) against v1's 1.85 and the first run's ~6.7. The one-idea prompt teeth
split memories finer by design, and the sample's days are heavy, but at this yield
v2's daily mint volume would sit far above v1's on the same days and fail parity band
§7.3. Carried as the first watch of the run; v1 keeps encoding while muted, so every
run day measures it on the same days — the strongest comparability this project has,
and it survives dropping the shadow phase.

**P5, first reading:** `self.schema.tripped` never fired in 7 days; the F8 quarantine
fired 7 times (sweep-minted self rows set aside). The second reading is `schemaBytes`
on the migrated store at preflight.

*Precondition 1 on this record: OPEN. `readOnlyProof` and `totalityOk` hold; the
wiring reads `preselect.meanSchemasShown` pass (0.54), `preselect.blindRate` 0.60 (a
band failure, and far under the 1.0 that would mean a dead wire), `gate.refusalMix`
computed. The 11 band failures are the run's to re-earn (§5 G15), not anyone's to sign
for.*

## Day 0 log — 2026-09-03 (owner present)

- Snapshot of `~/.bansai` taken by the owner (files the migration reads only); import
  applied from it in 61 s: 14,753 memories created (1,066 archived merge sources), 224
  episodes, 9 entities born, 470 elements, 430 edges; 26 credential redactions (19 the
  v1 scar's own key shape); source byte-identical after (14,396 files hashed).
  Report: `migration-report.json` in the run dir.
- Config written at `~/.counterparts/claude-code.json` (data dir subdirectory, owner,
  parallel on, embedder on, identity anchor); loads as non-observer.
- Embeddings: 13,727 vectors persisted for the live rows (≈90%); 512 texts in four
  batches failed as units and stay lexically indexed — a named gap, retried later.
- Preflight rehearsal found two things planning had not: (1) the self-store byte valve
  read 3 MB tripped on the migrated store — it was weighing all 224 episodes and every
  migrated self trace; the measure is corrected to the self schema (episodes and migrated
  rows counted, protected ones still weighed): 35 KB over 23 elements, under the 72 KB
  trip. (2) **The hook environment carries neither API key** (probe session one, names
  only): Claude Code's process env is not the login shell's, and bansai only works
  because it reads a fallback file. Counterparts now takes credentials from a file its
  own config names (`credentialsFile`), the environment still winning when present.
- Probe session one (v2 muted): captured in two scopes, boundary rows written, stood
  down at every delivering hook with reason `override-bansai`; no sweep ran (no key —
  the worker refused, loudly, as designed). Hooks wired on all five events with the
  owner's go; backup at `~/.claude/settings.json.bak-2026-09-03-pre-counterparts`.
- `host.hooks` preflight row: the host records no attachment for a silent hook, so the
  execution model and the SessionEnd budget cannot be timed from transcripts on a muted
  day; the row now passes by COMPLETION evidence (a durable session-end boundary row on
  the day) with the documented parallel model, and says so.

## Day 0 — the start sequence (owner present; the flip is the LAST step)

1. Close every Claude Code session (v1's hooks mutate `~/.bansai` at every Stop).
2. Snapshot: `rsync -a --exclude index.sqlite* --exclude buffer --exclude buffer-archive
   --exclude logs ~/.bansai/ ~/counterparts-migration-source-<date>/` — the migration
   reads files only; those exclusions never travel (migrate CONTRACT §7).
3. Apply: `bun run tools/migrate/bin/migrate.ts <snapshot> ~/.counterparts/store --apply`;
   save the report as `migration-report.json` in the run dir; `source_readonly.identical`
   must be true. Then `rebuildCache()` with the embedder (embeddings are not computed
   at import).
4. Write `~/.counterparts/claude-code.json` (draft: dataDir subdirectory, `owner: true`,
   `injectionBudgetBytes: 9000`, `embedder.enabled: true`, `parallel.enabled: true`,
   identity anchor).
5. Write `bars.json` into the run dir — all five fields, dated: `activeDayTurnFloor`,
   `crossEncodingBar: 0` (v1→v2, every phase), `crossEncodingRatioBar: 0.10` (v2→v1,
   OQ4), `crossEncodingMinLineChars` (the probe floor), `committedAt`,
   `preconditionDropDead: 2026-09-08` — plus `pricing.json`. The instrument refuses to
   run without them; it never invents a bar. (No `waivers.json`: there is no such file.)
6. Wire v2's hooks into `~/.claude/settings.json` beside v1's (same command for
   SessionStart, UserPromptSubmit, Stop, SessionEnd, PreCompact; hooks on one event run
   in parallel; SessionEnd shares a 1.5 s budget across all hooks).
7. A first, ordinary session with v2 still muted: confirm v2 captured (spans under the
   data dir), stood down at every delivering hook (`adapter.primacy.standdown` rows for
   the date), spawned its worker, and that v1 ran exactly as before. `contaminated` here
   is a stop.
8. `daily.ts --date <today> --phase 0` → writes `run.json` with G12's baseline
   `surfaceSet` hash (P9's second half); class `thin` is fine on day 0. **Run this
   BEFORE step 9, and once.** The throwaway session below is v2 speaking on a day whose
   primacy is v1, which is exactly what the G4 detector calls `contaminated` — a daily
   re-run after it would class day 0 contaminated and exit 1, on rows from the one
   session that was *supposed* to speak. Day 0 counts toward no minimum either way.
9. **The ask-channel throwaway session (P8), with v2 DELIVERING.** v2's Stop ask never
   fires while it is standing down, and there is no per-session way to ask it to: the
   adapter reads one fixed config (`~/.counterparts/claude-code.json`), so "a throwaway
   project with delivery on" is not a thing that exists. Use the run's own mechanism,
   twice, **with no session open** each time: flip `override` to `"engram"` (tmp+rename),
   run the throwaway session, flip it back to `"bansai"`. One voice throughout, and if
   the preflight then refuses, primacy is already back where it was. Watch the ask
   arrive in the model's context; record `ask-channel.json`
   `{observedAt, channel, exitCode, session}`. The same session leaves the first
   `recall.decision` rows, which is P9's first half. **Read the first rendered v2 wake
   by hand** before any workday runs on it.
10. Preflight LAST: `bun tools/parallel/bin/preflight.ts --run-dir <dir> --phase 0 --v2-config … --replay-out … --transcripts …`
   must exit 0 with `ready: true`. Every row binds, 8 and 9 included; nothing is deferred.
11. **The flip** (no session open): back up `assignment.json` beside itself, dated;
   write `override: "engram"` via tmp+rename; stamp the wall clock in `run.json`. Day 1
   is v2-primary.

## Day 1 — the go/no-go (the shadow days' replacement)

Before a second workday runs on v2, all of it named in `run.json`:

- Wake bytes sane, and **a human read the first rendered v2 wake** before a workday ran
  on it.
- Recalls non-empty on real turns (`recall.decision` rows with surfaced ids).
- The ask observed reaching the model (the authored dump actually fired).
- The mute evidenced: v1's `ab.muted` present at session start and user-prompt-submit,
  and no v1 delivery events for the day.
- The cross-encoding meter clean in both directions.

Any failure is REVERT the same day, named — not an extension, not a wait.

## The daily check (two minutes)

```
bun tools/parallel/bin/daily.ts --run-dir <dir> --date <YYYY-MM-DD> --phase P --v1-wake ~/.bansai/render/wake.md [--v1-ritual "<the ask's first line>"]
```

The daily refuses to run without a v1 probe (the wake render file is the natural one),
and exits non-zero on a red-line, an unreadable v2 store, a truncated read, or a
contaminated day. Its class vocabulary has six values: active / thin / contaminated /
mixed / silent / unreadable.

Read three lines of `days/<date>.json`: the **class** (active / thin / contaminated /
mixed / silent — only `active` counts toward a phase minimum), the **cross-encoding
meter** against its bar, and the **v2 tally** (memories created by source, quarantine
count). Then the dashboard status view on the v2 store, read-only
(`COUNTERPARTS_DATA_DIR=~/.counterparts/store`): symmetry by reason, self bytes.

## Watches — four values, never a silent green

| Watch | Where | pass / fail / needs-rater / not-exercised |
|---|---|---|
| Mute evidenced (G4) | `days/*.json` → `mute` | fail on a contaminated day |
| Cross-encoding (G7) | `crossEncoding` vs `bars.json` | red-line above bar |
| Isolation (G6) | preflight `datadirs.disjoint`, `assignment.*` | re-run on any host upgrade |
| Encode parity (every day) | v2 tally vs v1 tally, same day — v1 encodes while muted | band from OQ6's 30-day window |
| Symmetry (G12 consumer) | dashboard status | `never-asked` is not health |
| Self-store bytes (P5) | preflight `store.schemaBytes`, daily | pressure/trip named |
| Quarantine (P4) | `quarantine.jsonl` line counts | any growth is a named finding |
| Delivered loop | `recall.decision`, `adapter.*` rows | `not-applicable` on day 0, graded from day 1 |

## Pre-flip checklist (the end of day 0)

- Precondition 8: a v2 Stop-hook ask observed arriving in the model's context in a
  throwaway session run **with `override: "engram"`, flipped back afterwards** (there is
  no per-session delivery switch); record the channel and exit code as a capability in
  `ask-channel.json`.
- Precondition 9: `recall.decision` rows in the store from that session, and the
  `surfaceSetFields()` hash recorded in `run.json` as the G12 baseline.
- Bars for the delivered-loop criteria committed in `bars.json`, dated.
- `not-applicable` list for Phase P enumerated in the run dir (G13).
- The preflight at `--phase 0` exits 0: every row passes, nothing deferred.
- The flip: back up `assignment.json` beside itself (dated, matching the existing
  `.bak-2026-07-18`), write `override: "engram"` via tmp+rename **with no session
  open**, stamp the wall clock in `run.json`.

## REVERT — one config write, plus one export

Set `override` back to `"bansai"` (tmp+rename, no session open). Name the failure in
`run.json`. Before setting the v2 store aside, export v2's Phase-P authored episodes to
the run directory — they are the owner's data (constitution 6, 7) and v1's journal has
a gap for those days that nothing else fills. Re-entry is priced by the carry-forward
rule (G12): a red-line fix restarts only the criteria whose surface set moved.

## Spend — estimates vs actuals

| Item | Estimate | Actual |
|---|---|---|
| Sample replay (7 days, Opus + Voyage) | $25–40 | ≈$16–20 by token volume (1.2M+ in / 0.3M out); bill is the actual |
| Run, API side (embeddings + crash-fallback sweeps) | dollars/day | *per day, from run.json* |
| Authored dump | owner's subscription context, not an API line | — |

## Known hazards and limitations

- v2's default data dir is `~/.counterparts` itself and the hook config lives inside it;
  the store's layout check rejects the config file at open. The run uses a subdirectory.
  Filed for the launch session.
- `silent` is a per-session join on the host session id, which v1's log and v2's
  durable payloads both carry; the assumption that the two ids are the same string is
  asserted in the instrument's tests and re-checked on day 1.
- The cross-encoding meter takes its v1 probes from `--v1-wake` / `--v1-ritual`; there
  is no built-in v1 ritual text constant (the recognizers are prefixes, and the meter
  addresses whole lines), so the wake render is the probe source.
- The cross-encoding meter catches verbatim lines only; the paraphrase path is named as
  its blind spot and bounded by the delivered recall volume (`exposureDenominator`).
- v1's Stop hook logs no `ab.muted`; the episode-ask mute is graded by absence only.
