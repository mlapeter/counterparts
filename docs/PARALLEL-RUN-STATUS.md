# Parallel run — status

*The living record of the v1/v2 parallel run: what started and when, the watches and
their four-value discipline, the daily check, and the REVERT lever. The contract is
`tools/parallel/CONTRACT.md` (PR #7); the instrument is `tools/parallel/` (README
there). Numbers here are copied from run-directory artifacts, never typed from memory.*

## State — 2026-09-03

**NOT STARTED.** Preconditions closing; the sample replay is running; the
preconditions branch is under adversarial review. Day 0 needs the owner's hand three
times (snapshot, hook wiring, and later the Phase P flip) and happens in-session.

| | |
|---|---|
| Phase | 0 (preflight) |
| Run directory | `~/counterparts-parallel-run/<start-date>/` — not yet created |
| v2 data dir | `~/.counterparts/store` (a subdirectory on purpose — see *Known hazards*) |
| v2 config | `~/.counterparts/claude-code.json` — drafted, not written |
| Assignment file | `~/.memory-ab/assignment.json` = `override: "bansai"` (v1 primary; unchanged for Phase S) |
| Rail | ~2026-09-22: no green verdict by then ⇒ v1 flips public as-is |

## Rulings (owner, 2026-09-03 — all seven §9 questions plus precondition 1)

- **P1** the sample route: `--days 7 --embed` sample, trend read per day, an owner-signed
  waiver file in the run directory names the record. Machine-read, not prose.
- **OQ1** parity-plus-strategy. **OQ2** migrated starting store. **OQ3** the parallel
  store is the production store at PROMOTE. **OQ4** accept-and-meter; bar: Phase S zero
  verbatim hits either direction (red-line), Phase P named finding, red-line above 10%
  of v1's daily mints. **OQ5** spend approved in principle, actuals logged below.
  **OQ6** v1's 30-day window sets the bands; same-run days beside them. **OQ7** a named
  post-cutover watch list; v1's store readable indefinitely.

Journal: `~/bansai/docs/DECISIONS.md`, entries dated 2026-09-03.

## Preconditions — each with its named verification

| # | Precondition | Status | Verification |
|---|---|---|---|
| 1 | Replay gate green for this run | **pending the sample** | `parallelGateOpen` over `pass-record.json` + `waivers.json`; preflight row `replay.gate` |
| 2 | G12 symmetry consumer live | closed | `test/sleep.test.ts` ("a RATCHET trips…", "never-asked…"), `test/dashboard.test.ts` ("renders by REASON"); daily: `sleep.symmetry` recomputed from `band.transition` |
| 3 | `scanSecrets` bounded | closed on branch | `SCHEME_TAIL {0,32}` and the `url-path-token` host/path class `{0,512}`; `test/encode.test.ts` "the scan is bounded" (four shapes); measured 744ms → 2ms at 32KB, 179ms → linear on the URL-list shape |
| 4 | Poison-pill retry bounded | closed on branch | `MAX_SPAN_FAILURES=3` **distinct lived days** (an outage day is one failure), `failures.jsonl`, `quarantine.jsonl`, `remember.span.quarantined`; seven tests in `test/remember.test.ts` |
| 5 | Self-store valve: relief or evidence | **pending two readings** | the sample's `self.schema.tripped` count; `schemaBytes` on the migrated store (preflight row `store.schemaBytes`) |
| 6 | Migration: confidentiality + secrets gate | code closed; **apply pending** | `test/migrate.test.ts` G1/G2; dry run 2026-09-03 on the live store: 26 redactions (19 google-api-key), 10 floor refusals named; `--apply` from a quiescent snapshot on day 0 with `source_readonly.identical: true` |
| 7 | Priced and approved | approved in principle | `pricing.json` in the run dir; actuals below |
| 8 | Ask channel proven on host | **pre-Phase-P** | a v2 Stop-hook ask observed in a throwaway session; recorded as `ask-channel.json` `{observedAt, channel, exitCode, session}` in the run dir, read by the `--phase P` preflight |
| 9 | Surfacing decision record durable | closed on branch | `recall.decision` rows; `surfaceSetFields()`; `test/counterpart.test.ts` "the surfacing decision is DURABLE" |

Also landed on the branch: v2's primacy resolver (deliver iff `override === "engram"`,
fail toward mute) behind `parallel.enabled`; the four delivery records durable with
date and session; the `foreign` turn source (v1's episode ask never enters v2's
capture); the G9 source tripwire; `tools/parallel/` with its own G1 proofs.

## Sample replay (precondition 1's evidence)

Fired 2026-09-03 17:05 UTC: `run-replay --days 7 --embed --fire`, Opus seat, Voyage
live, corpus days 2026-07-27..08-04 (292 span files, 52 sessions, ~4.3 MB), code at
`065fcb5`. Output: `~/counterparts-replay-runs/sample-7d-2026-09-03/`.

Per-day trend (filled from `report.txt` when the run ends): blind rate · schemas shown ·
refusal mix · novelty non-null · birth grounding · `self.schema.tripped`.

*Result: pending.*

## Day 0 — the start sequence (owner present)

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
   `crossEncodingBar: 0` (Phase S), `crossEncodingRatioBar: 0.10` (Phase P, OQ4),
   `crossEncodingMinLineChars` (the probe floor), `committedAt`, `preconditionDropDead:
   2026-09-08` — plus `pricing.json` and `waivers.json` (P1). The instrument refuses to
   run without them; it never invents a bar.
6. Preflight: `bun tools/parallel/bin/preflight.ts --run-dir <dir> --v2-config … --replay-out … --transcripts …`
   must exit 0 with `ready: true`.
7. Wire v2's hooks into `~/.claude/settings.json` beside v1's (same command for
   SessionStart, UserPromptSubmit, Stop, SessionEnd, PreCompact; hooks on one event run
   in parallel; SessionEnd shares a 1.5 s budget across all hooks).
8. First session: confirm v2 captured (spans under the data dir), stood down at every
   delivering hook (`adapter.primacy.standdown` rows for the date), spawned its worker,
   and that v1 ran exactly as before. Then `daily.ts --date <today>` → class `thin` is
   fine on day 0; `contaminated` is not.

## The daily check (two minutes)

```
bun tools/parallel/bin/daily.ts --run-dir <dir> --date <YYYY-MM-DD> --v1-wake ~/.bansai/render/wake.md [--v1-ritual "<the ask's first line>"]
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
| Encode parity (Phase S) | v2 tally vs v1 tally, same day | band from OQ6's 30-day window |
| Symmetry (G12 consumer) | dashboard status | `never-asked` is not health |
| Self-store bytes (P5) | preflight `store.schemaBytes`, daily | pressure/trip named |
| Quarantine (P4) | `quarantine.jsonl` line counts | any growth is a named finding |
| Delivered loop (Phase P only) | `recall.decision`, `adapter.*` rows | `not-applicable` in Phase S |

## Pre-Phase-P checklist (before the flip)

- Precondition 8: a v2 Stop-hook ask observed arriving in the model's context in a
  throwaway project session; record the channel and exit code as a capability.
- Precondition 9 present (it is, on the branch); `surfaceSetFields()` hash recorded in
  `run.json` as the G12 baseline.
- Bars for the delivered-loop criteria committed in `bars.json`, dated.
- `not-applicable` list for Phase P enumerated in the run dir (G13).
- Phase S exit: ≥3 active days, isolation meters clean, encode parity bands holding,
  zero red-lines.
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
| Sample replay (7 days, Opus + Voyage) | $25–40 | *pending* |
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
