# Parallel run — status

*The living record of the v1/v2 parallel run: what started and when, the watches and
their four-value discipline, the daily check, and the REVERT lever. The contract is
`tools/parallel/CONTRACT.md` (PR #7); the instrument is `tools/parallel/` (README
there). Numbers here are copied from run-directory artifacts, never typed from memory.*

## State — 2026-09-04, day 1: the first conversation reviewed, ten fixes merged and LIVE

**Day 1 is the review day.** The first real conversation on counterparts (one session
spanning 2026-09-03 into 2026-09-04, 13 owner turns) was reviewed from three sources:
the store read-only, the transcript on disk, and the instance that lived it (asked six
questions over cross-session messaging; it answered with counts). Verdict: **the
plumbing held and identity carried; retrieval, authorship and revision did not.**
Numbers, all from rows:

| Measure for that session | Value |
|---|---|
| Wake | 8,859 B, 8 identity elements, every other lane 0; framed as counterparts only in the HTML comment |
| Recall footnotes delivered / judged relevant by the instance | 9 / 0 — the same nine 9–20 KB migrated memories (store median 1.1 KB) surfaced for every topic, in two unrelated sessions |
| Recall latency, first to last turn | 455 → 995 ms against the 1,200 ms budget; one abort at turn 1 |
| Stop asks | about a dozen in 13 turns (two independent pacers alternating) |
| Notes stored / refused / with `updates:` as prose | 34 / 0 / 4 (no field existed; targets untouched) |
| Sweep chunks / proposals / refused | 13 / 64 / 0 — ran after nearly every Stop, 61 memories, roughly half paraphrase twins of the notes |
| Episodes written | 0 — no session bound, AND no tool on this host called `appendChapter` |
| Revision declarations / with any effect | 1 / 0 — `challengeBelief` had callers only in tests |
| Bansai deliveries while muted | 0; cross-encoding v2→v1 15 and 24 verbatim lines, ratios 0.0125 / 0.020, under the 0.1 bar |

**Root causes found under those numbers** (each now a named memory in the store and a
PR below): neither live recall path attached a turn vector, so 13,862 embeddings were
consulted by nothing; the lexical scorer had no length normalization and the token cache
no document length; only the sweep warmed embeddings (all 40 authored notes and all 224
episodes unembedded); the sweep ran at every Stop against a contract that says *only*
when the experiencer never got the pen; the MCP server is launched from static config
with no session id and defaulted its scope to the store directory; the wake is rendered
once at sleep and served identically all day; `updates:` had a field on `session_end`
only; every authored memory had zero computed salience (sal = max(mean dims, claimed),
and most notes arrive unclaimed); the daily still read `primacy: v1` from `run.json`
and could not see a muted bansai's boundaries.

**Owner rulings (2026-09-04, plain):** the sweep is a crash fallback only — not Stop,
not session end, not compaction; `updates` by target: beliefs and identity elements take
pressure, current-state replaces with lineage, plain memories link only; the phase clock
restarts when the recall and wake fixes land; no embedding on the hot path (one-turn
lag); `run.json` stamped primacy v2 / phase P at 14:57 UTC with a backup beside it.
Fixes are grounded in `CONSTITUTION.md` and the module CONTRACTs, with bansai as a
reference point, not a template.

**Merged 2026-09-04, in this order, each verified on master (suite 1239 → 1411, tsc
clean), and LIVE at once because the hooks run this checkout:**

| PR | What |
|---|---|
| #17 | Peer sessions' messages attributed to their sender in spans; Stop-hook asks are `ritual` and enter nothing, counted as excluded |
| #19 | Live-session registry under `<dataDir>/sessions/` (TTL 4 h), lazy binding of `session_end` to a registered live session in the same scope, server scope defaults to `process.cwd()`, `updates` field on `note`, the ask names the session id and the tool |
| #21 | Daily refuses on a primacy disagreement, grades a muted v1's missing boundaries as `muted-consistent`, names the four not-durable watches, `bin/restart.ts` for the phase clock |
| #20 | `IDENTITY_SHARE` 0.5 by whole elements; a delivery-time preface (system, lived day, date, store size) composed in the SessionStart hook with its room reserved once; threads stay dark: zero migrated memories carry `unresolved` |
| #22 | `core/revision.ts`: a resolved `updates:` reaches the engine from every door — belief → `challengeBelief` pressure; current-state → immediate supersede with lineage; identity-band memory → pressure + supersede; other memory → link only; four telemetry records, nothing throws |
| #18 | Sweep only for crashed sessions: uncovered spans, no session-end boundary, `CRASH_STALE_MS` 12 h silent (calibrated on the 4 h 07 m idle gap in the first conversation); captures unchanged at Stop / SessionEnd / pre-compaction; `sweep.gate` durable record so a quiet sweep is a receipt, not silence |
| #23 | Semantic channel: the worker embeds the turn AND ranks (the nearest scan costs 590–1,040 ms at 13.8K JSON-text vectors), passing top hits to the next turn; the recall tool embeds in line under a 15 s budget; embedding backfill 64/run, authored and episodes first |
| #24 | `AUTHORED_DEFAULT_CLAIM` 0.25 for unclaimed authored memories (0.25 + CONS_BONUS < THETA_SEM, so the default alone never reaches the semantic band; v1's F5 scar closed as arithmetic); per-dimension fields on `note`/`session_end`; `backfill-claims` CLI (dry run by default; 20 live rows qualify; **owner runs `--apply`**) |
| #26 | ONE ask on ONE pacer (first at 6 turns and 4,000 B or 12,000 B alone; re-ask 8 turns AND 8,000 B; cap 4 per lived day, shared across sessions), naming the session and both tools; the `chapter` MCP tool — the first door on this host that reaches `appendChapter`; dedup no longer merges an ingested memory into its own episode |
| #27 | `isJournal()`: decay, prune, consolidate and dedup skip episode rows with a named skip; the census no longer counts a chapter as a memory born today |
| #29, #30 | Every wake element carries its date (`2026-07-26 ·`, 14 bytes; a differing content date as `(of …)`); migrated elements with no surviving date render an upper bound, `by 2026-09-03 ·`, never the import day as a plain claim; `counterparts rebrief` re-renders and republishes the wake now without moving a sleep marker. Run on the live store 2026-09-04: lanes identity 3 / threads 6 / horizon 2, craft 0 (migrated skills sit below the warm floor), 11 elements, 8,784 B. **Migration finding:** 12,334 of 14,529 migrated memories carry the import day as `learned_on` (v1 traces mostly had no `created` field; `bornDay` kept the age, so physics is unaffected); only 1,918 carry `happened_on`. Dates are recoverable for many rows from engram-era ids (millisecond timestamps) and session references; a later, owner-approved repair. |
| #25, #28 | Recall length normalization (BM25 in the SQL before `ORDER BY … LIMIT`; CUE_LENGTH_NORM 0.5 one-sided, CUE_DOC_CAP 3.0), per-document cap, `SNR_GLOBAL` 1.2 → 1.6, `MAX_SURFACED` 2 → 1, the `tools/recall-bench/` operator bench, tool output capped with `ids` expansion. Bench on the 13 real prompts (store copy, lexical channel): hub deliveries 31 → **0**, turns with a hub 13/13 → 0/13, ambient should-surface 0 → 1, deliberate 1 → 3, recurrence 78% → 37%, tool result 73K → 6.7K chars. **Not met:** loud surfacings 3/13 turns → **13/13** (one item each), delivered per turn 2.5 → 4.8. Cause: v2's absolute floors are v1's 0–1 numbers against an activation that sums idf × evidence to 13–48 per turn, so they have never fired and only the relative bar gates loud; a cue-poor turn's thin background clears it easiest (scar §2.8). Resolved the same day by **#28**: document frequency had been read off the length of a bounded top-24 fetch, so on the live store every word in ≥24 memories measured as equally rare and the "rarity replaces stop-lists" guarantee had switched itself off as the store grew; with df counted and the floors expressed in cue units (`FLOOR_GLOBAL_UNITS` 0.2, `FLOOR_STRONG_DEFAULT_UNITS` 4.5, `COLD_START_FLOOR_UNITS` 0.4; `prospective.CUE_STRENGTH` folded the same way) the bench reads loud 3/13 turns (the three that should be), turn 3 silent, 2.8 delivered per turn, hubs 0, positives 7, no id on ≥3 turns, warm 29–39 ms per turn. Watch: a cold `COUNT(*)` on high-df tokens costs up to ~516 ms on a fresh process's early turns, inside the 1,200 ms budget. §7 OQ5 answered. |

**Facts the day taught that are not PRs:** MCP servers keep the code they were launched
with — every session open across a merge has the old doors until it restarts (this
session's own ask named `session_end` and the old server refused it). The vector cache is
177.5 MB of JSON-text vectors (~12.7 KB each vs 4 KB as float32) and `indexDoc`
rewrites a document's token rows on every index call — the growth watch and the recall
latency are the same fact from two sides; still owed. A Stop boundary's scope follows the
hook's cwd, so a session that `cd`s records span scopes in worktree paths. Three
merges conflicted, one semantically with no git conflict (the revision PR's sweep tests
assumed sweep-at-Stop); the dry-run integration in a scratch worktree found it.

**Open rulings for the owner:** an authored `updates:` that resolves only by content plus
the author's hint is classed a *confirmation* and takes no pressure (standing SEAMS N
doctrine; the ruling's most ambiguous corner); an unclaimed note (0.25) does not outrank a
typical swept memory (~0.55 from interpreter dims) — closing that is a swept-side change,
not a bigger default; the 224 migrated episodes are now permanent by construction.

**Day-2 watches (added to the list above):** craft lane empty because migrated skills sit below the warm floor; migrated elements dominate the identity lane by strength until lived ones outgrow them; the recall tool's `storeSize` counts every live row (14,440) while the preface counts memories (13,751), label it; `sweep.gate` per day (`ran: 0,
skippedNotCrashed == scopes` is health; no row on a day the worker spawned is not);
session-end boundaries per ended session; `adapter.embed.backfill` remaining → 0; the
loud-tier rate after #25's retune; `salience.defaulted` vs claimed counts (from prose
meta); `adapter.ask` outcomes per day against the cap of 4; episode files appearing under
`prose/episodes/` from sessions started after the merges; `meta["updates"]` links and
`revision.pressure` rows now that the wire exists; scope churn from `cd`.

**The phase clock:** restarted 2026-09-04 16:41 UTC with `bin/restart.ts`, first counting
day **2026-09-05** (`run.json` `phaseRestart`, `restarts.jsonl`; surface set
`800a9a9421cd969f`; the day-0 record kept as history). Day 1 of the counted phase is the
first full day on the merged code. The daily for 2026-09-04 should still be run tomorrow
morning as the review day's record.

## State — 2026-09-03, evening: STARTED

**The run is live.** Day 0 closed READY on every preflight row at 21:01 UTC; the flip
(`override: "engram"`) was written at 20:43 UTC with no session open, backup beside the
file, stamped in `flips.jsonl`. Counterparts is primary; bansai is muted and still
encoding. **Day 1 is 2026-09-04.** Phase P minimum: ≥7 active days before a verdict.

| | |
|---|---|
| Phase | P (from day 1) |
| Run directory | `~/counterparts-parallel-run/2026-09-03/` |
| v2 data dir | `~/.counterparts/store` (14,753 memories imported; 13,727 vectors) |
| v2 config | `~/.counterparts/claude-code.json` (`credentialsFile` → `~/.counterparts/credentials.env`, 0600) |
| Hooks | counterparts' `bin/hook.ts` on all five events beside bansai's; backup `~/.claude/settings.json.bak-2026-09-03-pre-counterparts` |
| MCP | `counterparts` (note, recall, status, session_end) registered; `bansai` and `engram` removed for the run (`mcp-servers-removed.json`; backup `~/.claude.json.bak-2026-09-03-pre-counterparts-mcp`) |
| Assignment file | `~/.memory-ab/assignment.json` = `override: "engram"` |
| Code | master `38a2829` (PRs #7–#14), suite 1239, typecheck clean — the hooks run the checkout, so master stays checked out for the run |
| Rail | ~2026-09-22 |

**Day-0 go/no-go evidence (all from the store and transcripts, none from impression):**
the first wake injected (8,859 B, 8 identity elements) and saved for the owner to read
at `first-wake-2026-09-03.md`; recall delivered footnotes on a real turn; the ask
reached the model through stderr + exit 2 (precondition 8); one `recall.decision` row
(precondition 9); bansai muted at every hook since the flip with zero deliveries; four
sweeps ran once the credentials file landed; cross-encoding zero both directions.

**Day-1 watches added from day 0:** recall `latency-abort` rate — diagnosed on day 0:
the first recall in every fresh hook process paid ~800 ms warming the page cache over
the token index after the worker's writes and aborted at the 250 ms budget (5 of 6
real turns; the MCP recall tool reported an empty store); the budget is 1200 ms since
PR #16 (calibration, surface set unchanged), and the structural watch is the cache
file itself: `cache.sqlite` grew 101 → 263 MB in the first hour (1.06 M token rows,
no duplicate embeddings), which reads as the index being rewritten each cycle —
measure its size per daily; mint yield per day against bansai's; the ask cadence (now paced on 8 turns
and 8,000 bytes since the last ask); vector coverage (512 texts unembedded); **the
wake's lane balance** — the first speaking session's wake was eight identity elements
filling the whole 9 KB budget with craft, threads and horizon at zero (the trim order
lets identity eat the budget on a migrated store); propose an identity-lane cap with
day 1's numbers. The model in that session attributed the wake to bansai (the content
is bansai-era memory, the frame was anonymous — fixed in PR #15) and wrote a
misdiagnosis into its answer; a later session should revise it with `updates:`.

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

## Carry-forward declarations (CONTRACT §5 G12) — recorded BEFORE the change lands

**2026-09-04, declared before merge — PR #37 (default data dir → `~/.counterparts/store`) and PR #38 (recall: the first memory in a fresh store is cueable; `MIN_RARITY_STORE = 2`). Class: IDENTICAL.**

- Surface-set hash, computed with `tools/parallel/surface.ts#surfaceSetHash()`: master `28121d0` → `800a9a9421cd969f`; branch `fix/default-data-dir` `c55c11f` → `800a9a9421cd969f`; branch `fix/recall-first-memory` `c0822b5` → `800a9a9421cd969f`; `run.json` (read-only) records `800a9a9421cd969f`. Neither change touches a field of the per-turn surfacing decision, gate-chunk or band-transition records.
- Live-host reach, #37: every live entry point resolves its data dir before the default — the hooks read `dataDir` from `claude-code.json` (`hook.ts:84`), the worker is pinned by the hook and reads the config (`runner.ts:268`), the MCP server is launched with `COUNTERPARTS_DATA_DIR` (`serve.ts:76-79`; a server without it would have failed at open on the old default, and the tools answer daily). The only live path that moves is the unreadable-config fallback, from "no memory at all" to a correct read-only open. Adversarial review: MERGE WITH CHANGES (record the class first; the test HOME guard, PR #39, landed first; `counterparts verify` guarded before merge).
- Live-host reach, #38: `df >= 1` always, so `storeSize === 1` is the only reachable change; idf at N = 2, 100 and 14,000 is bit-identical, asserted in a test against the pre-fix expression. The live store holds ~14,000 rows. Bench re-run on a store copy: NEEDS-OWNER, for the record only.
- Consequence claimed: day count and ratings CARRY; no phase restart. The preflight compares `run.json` `surfaceSet` to the build on the next daily; a mismatch there would refute this declaration, not argue with it.

**2026-09-04, declared before merge — `fix/revision-successor-survives` (§I8: sleep's dedup archived a revision's successor into the challenger it was minted from). Class: ANYTHING ELSE (§5 G12's third class). The phase clock restarts.**

- **Why not "red-line fix".** G10's list is closed — span loss, corruption, a secrets miss, an isolation breach, a broken session, cross-encoding, a write into v1 — and a successor archived with a valid merge record is none of them. It is a behaviour-changing correctness fix, which is what the third class is for. The same-day precedent settles it without argument: the phase clock was already restarted 2026-09-04 16:41 UTC for behaviour-changing fixes **at this same surface-set hash**, `800a9a9421cd969f`.
- **Why not "identical" either.** Surface-set hash, computed with `tools/parallel/surface.ts#surfaceSetHash()` on this branch (first measured at merge-base `5c8c056`; re-measured after the review at merge-base `2a40340` — master moved past the `07ccc13` named in the review while the changes were being made): `800a9a9421cd969f`, unchanged at every one of them. **A hash match does not make the class identical.** G12's first class is *telemetry-only AND provably identical*; this is neither. The hash covers FIELD NAMES on three record shapes — the per-turn surfacing decision, gate-chunk, band-transition — and no field moved, but what the store HOLDS after a revision did: before, the successor was archived `merged` at the next dedup pass and the element left the live set; after, the successor stays live and no `sleep.merged.<id>` is written for it. Recall then has one more live row to consider and one fewer archived one, and the wake and slice renders show a belief where they showed nothing. No surfacing field moved; the surfaced CONTENT can. Per #41's record the same hash stood on master and in `run.json`; `run.json` is NOT re-read here — the run directory is off-limits to the session that made this change, and the preflight compares it on the next daily.
- **Live reach:** any cycle where a revision's successor and its challenger are both live — not merely the crossing's own evening, since the pair stays live and identical until something merges it. Nothing is repaired retroactively: a successor already archived `merged` stays archived, with its prose, its id and its merge record intact.
- **UNVERIFIED — do not lean on it.** The day-1 reading "1 revision declaration with 0 effect; zero rows with `superseded_by`, zero `revision.pressure` events" is still owed a recount by master's day-2 watch list, and this session cannot open that store. It is also the wrong claim to lean on: the CURRENT-STATE arm supersedes on ONE declaration with no bar to climb and PR #22 is live, so a successor may already exist with no pressure event to show for it. **Owner's read-only check:** `memory.merged` events whose `candidateId` starts with `sch_` — that one query answers "has an element ever been archived as a duplicate here", for this finding and for the open one below.
- **Measured** on the demo seeder (`tools/demo/seed.ts`, 30 lived days): `merged` 3 → 1. Two of the three "duplicates" were the two revisions' successors — the belief arm and the current-state arm — and the third is a genuine duplicate that still merges. **The two further doors the adversarial review found in the first draft's pair relation are CLOSED here** (`sleep/NOTES.md` §12: a twin of the challenger's sentence born earlier, which took both the challenger and the successor and left the element with no live version; and two challengers with one body revising two elements on one day, where the second element silently lost its revision). Both are regression-tested and both fail without the wider clause.
- **Still open, named not fixed** (`sleep/NOTES.md` §12, probe H): an element and an ordinary memory can collide with no revision anywhere — an `addBelief` with statement X and a memory with body X — and the belief loses the `mem_` < `sch_` tie-break. Migrated elements carry the import day while migrated memories kept their v1 birth day, so on a migrated store the memory is older on every such pair. Same read-only check as above.
- **Consequence: the phase clock restarts.** Days before 2026-09-05 stop counting; zero counted days are lost, because the 16:41 UTC restart had already set the first counting day to 2026-09-05.

**2026-09-05, PROPOSED and not yet recorded by the owner — `overnight/schema-not-dedup` (probe H: a `type: "schema"` row is no longer a dedup candidate at all; plus `counterparts repair-merged-beliefs` and the seam's `unarchiveMerged`). Class: ANYTHING ELSE (§5 G12's third class).** *This entry is written by the session that made the change and is a PROPOSAL: G12 says the declaration is recorded before the change lands, and the owner merges core. Confirm or amend it at merge.*

- **Why not "red-line fix".** G10's list is closed — span loss, corruption, a secrets miss, an isolation breach, a broken session, cross-encoding, a write into v1 — and a belief archived with a valid merge record is none of them. It is a behaviour-changing correctness fix, the same shape and the same night as `fix/revision-successor-survives` above.
- **Why not "identical" either.** Surface-set hash, `tools/parallel/surface.ts#surfaceSetHash()`: master `7fe3e9f` → `800a9a9421cd969f`; branch `overnight/schema-not-dedup` → `800a9a9421cd969f`. Unchanged, and **that does not make the class identical**: the hash covers FIELD NAMES on three record shapes and no field moved, while what the store HOLDS does move. Before, an element whose statement matched an ordinary memory's body was archived `merged` at the next cycle and left the live set; after, it stays live and no `sleep.merged.<id>` is written for it. Recall then has one more live row to weigh, and the wake and every schema slice show a belief where they showed nothing. `run.json` is NOT re-read here — the run directory is off-limits to this session, and the preflight compares it on the next daily.
- **Live reach, and why "no live row is affected" is NOT claimable.** Any cycle in which an element and an ordinary memory carry the same body. Migration settles the DIRECTION of that loss and NOT its frequency, and the difference matters: `tools/migrate/apply.ts#writeElement` minted every migrated element at the IMPORT day while migrated memories kept their v1 `birthDay`, so on any such pair the memory is strictly older and the element loses without even needing the `mem_` < `sch_` tie-break — but a pair needs two DISTINCT v1 items whose gated text is byte-identical (`plan.ts` sends each item down one route, `element()` trims where `planElementAsMemory` does not, and `hashText` is a raw sha256 with no normalisation), so nothing in the migration code gives a count. **The direction of the loss is certain; the count is unknown, and only the owner's dry run can say.** The day-1 record says nothing either way about schema/memory collisions and this session cannot open that store, so the honest class is the third one.
- **Nothing is repaired by the fix itself.** An element already archived `merged` stays archived, with its prose, its id and its merge record intact. The repair is separate and owner-run: `counterparts repair-merged-beliefs --dry-run --dir ~/.counterparts/store` (read-only; it also ANSWERS the read-only check the entry above asks for), then `--apply` if the owner chooses. No agent has run either against the live store.
- **The credit stays credited.** `--apply` un-archives and records; it does not take back the `uses` the merge gave the original. The delta is written into the `memory.unmerged` record so it is auditable rather than silently reversed.
- **Consequence claimed: the phase clock restarts**, on the same argument as the entry above. Whether this needs its own `restart.ts` run or rides G16's — same night, same hash, same class — is the owner's call; the session that made the change may not run it.

**2026-09-05, declared before merge — `overnight/day-zero-wake` (PR #71: an identity lane with no elements renders one line of furniture naming the identity core). Class: ANYTHING ELSE (§5 G12's third class), riding the restart the overnight core batch already requires.**

- **Surface-set hash unchanged.** `tools/parallel/surface.ts#surfaceSetHash()`: master `7fe3e9f` → `800a9a9421cd969f`; branch → `800a9a9421cd969f`. Both re-measured after the adversarial review. Nothing in this PR touches a field of the per-turn surfacing decision, gate-chunk or band-transition records, and the briefing has no record among the three at all. `run.json` is NOT re-read here — the run directory is off-limits to this session, and the preflight compares it on the next daily.
- **Why not IDENTICAL, despite the hash.** G12's first class is *telemetry-only AND provably identical* (`tools/parallel/CONTRACT.md`), and this is not telemetry-only: wake CONTENT moves on any store whose identity lane is empty at a boundary. The first draft of this declaration claimed IDENTICAL on an unreachability argument — the guard is `lanes.identity.length === 0`, and the owner's store ranks eight or more identity elements (`self/CONTRACT.md` §5 G2, measured 2026-09-03/04), so on that store neither the lookup nor the branch executes and `compose` receives exactly the arguments it received before. The argument is sound in substance and is recorded here as the reach; it is **not** a fourth class, and asking the run record to accept "identical by unreachability" would cost more than it saves. The overnight core batch restarts the phase clock regardless, so this rides it.
- **Live reach:** a store whose identity lane is empty at a boundary — a fresh store, or a young one before its first promotion. The owner's is neither, on the recorded measurement above, which is the whole evidence base: the live store was not opened by this session or by its reviewer.
- **Consequence: the phase clock restarts with the batch.** No separate `restart.ts` command is owed by this PR.

**2026-09-05, declared before merge — `core/require-explicit-dir` (LAUNCH-STATUS I21 / G25: `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` armed — `1`, `true` or `on`; `0`, `false`, `off` and blank stand it down; anything else is refused rather than read as off — makes the store's implicit default `~/.counterparts/store` and the configuration's implicit default `~/.counterparts/claude-code.json` REFUSE by name; OFF by default, ON in `test/preload.ts`, the demo seeder, the visual loop, the recall bench and the agent shells the owner ruled it into. The review round added one refusal that needs NO variable: `install` will not write the default `~/.counterparts/claude-code.json` with a `dataDir` under a temp root, the shape of the 2026-09-04 incident that left the owner's memory pointed at a throwaway store for three days). Class: ANYTHING ELSE (§5 G12's third class), riding today's owed restart.** *Written by the session that made the change; the owner merges core and confirms or amends at merge.*

- **Surface-set hash unchanged.** `tools/parallel/surface.ts#surfaceSetHash()`: master `ef82cd5` → `c3af0bef00209ba6`; branch `core/require-explicit-dir` → `c3af0bef00209ba6`, measured after every edit. Nothing in this PR touches a field of the per-turn surfacing decision, gate-chunk or band-transition records. `run.json` is NOT re-read here — the run directory is off-limits to this session, and the preflight compares it on the next daily.
- **Why not IDENTICAL, despite an argument stronger than the hash.** With the variable unset — every installed host, the live one included — every function in the change returns the same value and performs the same side effects it did before, for every input: the new code sits behind an environment read that answers `unset`. (`install`'s throwaway-default refusal is unconditional, but it is an OWNER OPERATION on a cold start — the parallel run launches no `install`, and on this machine the live install already exists.) By live entry point: the MCP server is launched with `COUNTERPARTS_DATA_DIR`, and `dataDir()`'s env-set arm now returns BEFORE the guard is read (zero new instructions on that path); the hook and the worker take the dir from the config and never call `dataDir()`, and their config resolution evaluates one new side-effect-free comparison (`implicitConfigRefusal`: source `default`, guard unset → `null`); the console's and dashboard's fallback arms each evaluate one new side-effect-free environment read. That is value-identity, and it is recorded here as the reach — but it is not the class's definition. G12's first class is *telemetry-only AND provably identical* by its text (`tools/parallel/CONTRACT.md` §5 G12), a path guard is not telemetry, and the day-zero-wake entry above already declined to mint "identical by unreachability" as a fourth class; "identical by opt-in" is the same request from the other side. The owner may reclass to IDENTICAL at merge if he accepts opt-in-gated code as identical: nothing the run measures moves either way, and the honest cost of the third class today is zero.
- **Live reach: none unless the live host sets the variable**, which it does not and this PR does not ask it to. Where it IS set, the only behaviour that moves is a refusal — a `StoreError` or a stand-down sentence, before anything opens — never a different store.
- **Consequence: rides the restart already owed** (the core batch, PR #75, second restart per the day's record). No separate `restart.ts` command is owed by this PR; the session that made the change may not run it.
