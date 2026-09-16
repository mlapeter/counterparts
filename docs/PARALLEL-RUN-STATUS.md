# Parallel run — status

*The living record of the v1/v2 parallel run: what started and when, the watches and
their four-value discipline, the daily check, and the REVERT lever. The contract is
`tools/parallel/CONTRACT.md` (PR #7); the instrument is `tools/parallel/` (README
there). Numbers here are copied from run-directory artifacts, never typed from memory.*

## State — 2026-09-16: the daily is ACTIVE on 09-15; a minted successor HELD at a real bar; no declaration today

*Appended by the coordinating session after the morning check (~14:00Z). Numbers from `counterparts doctor`, the
2026-09-15 daily (`days/2026-09-15.json`) and read-only `sqlite3` on `operational.sqlite` `events` under the
standing permission. Master moved three times today (#92, #111, #110); the shared checkout is still `76223ab`.*

- **Daily 2026-09-15: ACTIVE.** 17 turns counted from `v2:adapter.recall` (floor 5); v1 muted-consistent (18
  `ab.muted`); v2 memories 16,189, created 367; `memory.reinforced` **FAIL** (935 post-launch rows, 0 reinforced,
  0 uses); `self.schema.pressure` still the hard-coded NOT-EXERCISED — #111 merged after this run, so 09-16 is the
  first daily to read the rows; cross-encoding 0/2 and 0/4, no red-line.
- **`run.json` `activeDays {0:1, P:4}`** — four of the ≥ 7 phase-P days counted. **Earliest PROMOTE verdict
  ~2026-09-19.**
- **Three `revision.pressure` rows, and the third is the one that matters.** 20:55:37Z `sch_f4024c2866d6` (bar 0,
  force .144) → superseded by `sch_6aa99f5cdef6`; 21:40:24Z `sch_003f1c03a61f` (bar 0, force .36) → superseded by
  `sch_9e9f42231384`; and at **21:27:06Z** the target was **`sch_6aa99f5cdef6` itself** — the successor minted by
  the first revision, band semantic, real dimensions — bar **0.534** against force .25 ⇒ **HELD**, no supersede. The zero bar is a property of the migrated rows alone; accommodation's own output carries a
  real bar and CONSTITUTION 7's slow half works as written. LAUNCH-STATUS **G56**, ruled (a) today.
- **No declaration today.** Everything that landed is adapter, tools or docs: #92 `f17ba4f`, #111 `95acd06`, #110
  `b9f4dd6`. Hash **`c3af0bef00209ba6`** unchanged; `src/core` untouched by all three.
- **#112 merged `24d3d26` (adapter; hash unchanged), deployed `24d3d26` ~19:10Z, restart #9 at 19:12:43Z** with
  `--date 2026-09-11` (same-date re-restart: `activeDays {0:1, P:4}` kept, 13 days of history kept). `doctor` after:
  0 red / 0 amber / 13 green, lived day 190. The next core batch (G56 seeding, G57 credit filter, I39 pragma reorder) is one
  declaration and one restart of its own.

## State — 2026-09-15: doctor's first morning, green; I33 closed; band of record 0; the first live revision landed on a zero bar

*Appended by the session that ran the morning check (~21:00Z; the day's first session opened 20:48Z). Numbers
from `counterparts doctor`, `verify --dir`, the 2026-09-14 daily (`days/2026-09-14.json`) and read-only
`sqlite3` on `operational.sqlite` `events` under the standing permission. Nothing merged, nothing restarted;
master and the shared checkout both `76223ab`.*

- **`doctor` (first live run):** 0 red, 1 amber, 12 green. Config → `~/.counterparts/store`; credentials file
  mode 600 naming both keys; checkout `origin/master` detached `76223ab` clean; clock lived day 189,
  `lastActiveDate` 2026-09-15, newest boundary today; newest `sweep.gate` ran 3 of 15 scopes; newest
  `sleep.cycle` 0 failed phases; newest `recall.credit` `no-candidates`; no spawn refusals standing. The amber is
  **Vectors: 2 live memories with no vector, 0 skipped** — see the last bullet; not a regression.
- **Daily 2026-09-14: ACTIVE.** 95 turns counted from `v2:adapter.recall` (floor 5); v2 84 `adapter.boundary` /
  75 episode-ask; v1 muted-consistent (99 `ab.muted`: 4 session_start, 95 user_prompt_submit); memories 15,879,
  created 85; cross-encoding 0/2 and 0/4, no red-line. **`memory.reinforced` FAIL** as forecast: 631 post-launch
  rows, 0 with `reinforced_days ≥ 1`, 0 with `uses ≥ 1`, the oldest 5 lived days old. `run.json` `activeDays` after this daily:
  `{0:1, P:3}` — three of the ≥ 7 phase-P days counted.
- **I33 CLOSED.** `adapter.embed.backfill` since restart #6 (15:15Z 09-14): 64, 64, 40, 5 embedded in the first
  seven minutes (`remaining` 97 → 39 → 0), then single-digit runs at every boundary; `failed` 0 and `codes` empty
  on every row; `skipped` 0 throughout — the two surrogate ids were EMBEDDED after sanitization (lone surrogate →
  U+FFFD, #95), not skipped, which is better than the handoff expected. `verify --dir`: 14,877 float32 vectors,
  0 indexed-but-not-live.
- **Band of record: 0 of 14,557 live rows disagree** (0 not yet ranked) — U8's forecast (~869, then 0 after the
  first decay pass) held; the newest `sleep.cycle` decay entry carries `reconciled: 931`.
- **The new rows, since restart #7 (16:43Z 09-14):** 40 `sleep.cycle` (every one `reason: ran`, `failed: 0`,
  every phase named); 40 `recall.credit` (22 `no-candidates`, 18 `nothing-to-credit`, credited 0 — the
  expected reading until a session expands or quotes; no `failed`, no `budget-exceeded`); **1 `self.briefing`**
  (2026-09-15 20:56:14Z, day 189, 7,463 of 8,840 B, lanes identity 3 / craft 0 / threads 6 / hints 1 /
  horizon 2, trimmed 7) — ONE per lived day is the design: the briefing phase reads `already-done-today` on 39
  cycles and `ran` on 1, and day 188's render predates the restart, so the missing 09-14 row is timing, not a
  gap; **1 `adapter.checkout`** (`reason: master`, `76223ab`, `atMaster: true`, `dirty: 0`) — the I36 guard is
  visible; 2 wakes delivered (7,557 B and 7,577 B of 9,000; `sentinel: true`).
- **The first live revision of a self belief, 20:55:37Z** (`revision.pressure`, the first such row this store has
  ever held): the detached worker's interpret run (five `gate.chunk` rows 20:51:58–20:55:36) credited a
  challenge from `mem_93a718c73736` (source `fallback`, born 188) against `sch_f4024c2866d6` (self belief,
  `migrated`, born 184): force 0.144, pressure after 0.144, **bar 0 → REVISE**. Successor `sch_6aa99f5cdef6`
  (`accommodation`, band semantic, relevance/emotional/predictive 0.85/0.3/0.8); the old row archived
  `revised-by-pressure`, one `versions` row. The mechanism did what CONSTITUTION 7 says — pressure, bar,
  supersede with lineage — **but the bar was zero because `bar = iota(kind) × strength(old, d)` and every
  migrated schema row has relevance = emotional = predictive = 0**: 453 of 453 live migrated schema rows (268
  entity, 100 self — 71 episodic, 29 semantic — 52 person, 33 skill). For the migrated self, the "slow half" is a
  no-op: the first credited challenge revises. Post-launch accommodation rows carry dimensions and a real bar.
  → LAUNCH-STATUS **G56** (ruling: seed dimensions for migrated schema rows, or accept that the migrated self is
  cheap to revise).
- **The daily's `self.schema.pressure` watch is now false**, not just unexercised: `tools/parallel/record.ts`
  hard-codes "no durable revision-pressure row exists in this build" while one now does. → **G55**, a
  tools-side fix (read `revision.pressure` rows on the date: count, targets, and whether a supersede followed).
- **Why doctor's amber is 2 and the newest backfill says 0:** the worker's post-deposit cycle at 20:56Z writes
  `sweep.gate` + `sleep.cycle` + `self.briefing` and runs no backfill (that is a hook-boundary step); the two
  unembedded rows are `sch_6aa99f5cdef6` and `sch_8c4576259364`, both minted at 20:55:37Z after the last hook
  boundary (20:51:07Z). The next boundary embeds them. Ordering, not disagreement.
- **Not driven today:** `sleep.symmetry` (no `--lived-day` given), `self.schema.tripped` / `.quarantined` (not
  rows). No restart owed; no core change landed.

## State — 2026-09-14, night: the evening batch landed (#104, #105, #106, #108), deployed, restart #8

*Appended by the coordinating session after the batch. Numbers from `gh pr view`, `restarts.jsonl`,
`tools/deploy-checkout.sh`'s output and the two sessions' review reports; the live store was not opened for this
entry.*

- **Landed in order under four declarations, one restart:** #104 `1aed64c` (peer, OQ4 step 1 + probe + titles +
  session_end reasons) → #105 `cbeb210` (deploy script, docs class) → #106 `598d72d` (G48, U8, U4, G47(b)) →
  #108 `a849696` (doctor, notice, credentials, checkout guard). Each reviewed on Opus by the OTHER session; every
  required fix landed and both sides re-verified. Hash `c3af0bef00209ba6` unchanged at every step.
- **Restart #8**: `2026-09-14T18:29:13.705Z`, `date` 2026-09-11, `clearedActiveDays {0:1, P:2}` (kept), reason
  names the four merges and the deploy sha. **Deploy step** (new, before the restart): `tools/deploy-checkout.sh`
  moved the shared checkout `1aed64c` → `a849696`; between 17:00Z and 18:29Z every boundary ran `1aed64c` or
  older while master moved three times — LAUNCH-STATUS I36.
- **What the instrument reads from tomorrow:** `sweep.gate:refused` (NOISY_NOW only), `adapter.checkout:off-master`,
  `recall.credit:*`, `sleep.cycle:failed`; the `memory.reinforced` watch (expected FAIL); `joinAvailable` on
  session-bearing rows. Expected first live readings: `verify` band-of-record disagreement ~869 then 0 after the
  first decay pass; the `sleep.cycle` decay entry with `reconciled`; one `adapter.checkout` row (reason
  `master`); a SessionStart with a plain wake (nothing red) — if the terminal shows a `counterparts:` line, that
  is the notice working.

## State — 2026-09-14, evening: the credit seam is live (#99), the sleep cycle leaves rows (#100), restart #7

*Appended by the coordinating session after the merges. Numbers from `gh pr view`, `restarts.jsonl` and the review
reports; the live store was not opened for this entry.*

- **U10, verified twice:** nothing born since launch had ever been credited with a use; `Recall.resolveUse` had no
  adapter caller. LAUNCH-STATUS I35.
- **Landed in plan order under two declarations (both recorded BEFORE merge, below):** #101 `b22b264` → #100
  `10abffb` → #99 `8d7bd97`. Both core; both adversarially reviewed on Opus with every fix re-verified; hash
  `c3af0bef00209ba6` unchanged throughout. **Restart #7**: `restartedAt` `2026-09-14T16:43:08.801Z`, `date`
  2026-09-11 (same-date re-restart), `clearedActiveDays {0:1, P:2}` — kept, not lost. Master `8d7bd97`.
- **What the instrument reads from tomorrow:** `sleep.cycle`, `self.briefing`, `recall.credit` in
  `DURABLE_DETECTORS` with reason splits; the new watch **`memory.reinforced`** (post-launch = `source <> 'migrated'`,
  live rows; `fail` when the oldest post-launch row is ≥ N_PROMOTION_DAYS old and none is reinforced). It is expected to
  read **FAIL** on 2026-09-15 and to turn `pass` after the first `recall.credit:credited` row. The four older watches
  still read `not-exercised`.
- **Owner rulings recorded:** credit only on the referenced tier; identity lane rotates; R1 merge = uses only; R2 credit
  per (session, memory, lived day); R3 quote window needs ≥ 3 content words. All landed inside #99 before its merge, so
  the batch cost one restart.

## State — 2026-09-14: the worker runs; the referee had gone quiet (turn floor after G38); #95 reviewed and fixed

*Appended 2026-09-14 by the session that ran the health check. Numbers from the live store read-only (owner's
ask), `days/2026-09-1{1,2,3}.json` written under the standing daily permission, and `gh pr view`.*

- **The 09-11 hand fixes hold.** `dataDir`, both keys and the `embedder` block intact; `meta.livedDay` 187,
  `lastActiveDate` 2026-09-13, every `sleep.marker.*` at 187; asks fire (4/day, then `day-chapter-cap`),
  session-end deposits land, sweep rows every boundary, wake 8,351 B of 9,000. 09-12 had no capture because its
  only sessions were in an observer directory (bookkeeping) — by design.
- **I33 still live until #95 lands:** every `adapter.embed.backfill` row since 2026-09-11 17:05Z is
  `embedded 0 / failed 64`; 211 live rows have no vector, including every row born on lived days 186–187.
- **I34 — the turn floor read a bansai row G38 removed.** `record.ts` counted `turns` from v1's
  `buffer.append`, written by bansai's Stop hook; G38 (09-10) removed that hook and checked only that
  `muted-consistent` still read. Dailies for 09-11 and 09-13 first graded THIN "0 conversational turns" against
  47 and 18 v2 boundaries. **Owner ruling 2026-09-14 (option 1 of three): when v1 is muted-consistent and logged
  no per-turn row, count `adapter.recall` (one durable row per user prompt) and name the source on the record.**
  PR #96 (instrument only, suite 1857/0, five tests). Re-graded: **09-11 ACTIVE** (40 turns, `v2:adapter.recall`),
  **09-12 THIN** (no session), **09-13 ACTIVE** (13). `run.json` `activeDays.P` = **2**, counting from the
  09-11 restart. `bars.json`'s `why` still says "(v1 buffer.append events)" — the owner's one-line edit.
- **#95 reviewed on Opus (adversarial), MERGE WITH FIXES, fixes applied and pushed** (head `9ab3073`; suite 1867/0
  on the head and on a preview merge with master; install-loop 47/47; hash `c3af0bef00209ba6` unchanged). The
  declaration is below. **Merged 2026-09-14T15:15Z as master `456a4fd`**; restart RUN with the owner's permission: `restarts.jsonl` line 6, `2026-09-14T15:25:23.291Z`, `--date 2026-09-11`, `activeDays` kept at `{0:1, P:2}`, hash unchanged. #96 merged `f8a435d`, #97 `c34439c`.
- **Sweep row reading, corrected:** `sweep.gate.otherRefusals` is chronically 5–7 on the live run and it is
  `NOTHING_TO_SWEEP` for scopes whose crashed session was already retired (`crashedSessions` never forgets); the
  code comment "nonzero with ran:0 is NOT a quiet day" is false on every day of this run. Read `ran` and
  `skippedNotCrashed`; a reason split is LAUNCH-STATUS G48.

## State — 2026-09-11: 09-10 recorded ACTIVE, but the worker has not run on the live store since 09-04 (I32)

*Appended 2026-09-11 morning. Numbers from `days/2026-09-10.json` and a read-only look at the live
store's `meta` and `events` tables, on the owner's ask.*

- **2026-09-10: ACTIVE.** 18 turns (floor 5), primacy VERIFIED, v1 pass (10 `session.end`, 40 `ab.muted`),
  v2 pass (0 stop primacy, 27 episode-ask, 30 `adapter.boundary`), 10 memories created. Cross-encoding
  v1→v2 0/2, v2→v1 1/4 against 1493 v1 mints, ratio 0.0007 — a named finding, no red-line. Four watches
  `not-exercised`. `activeDays.P` = 1.
- **But the day measured the foreground only.** `meta.livedDay` is still 185 and `lastActiveDate`
  2026-09-04; all 27 asks were `capped: day-chapter-cap` (the day-185 cap of 4 was spent on 09-04); no
  `sweep.gate` / `adapter.semantic.lag` / `adapter.embed.backfill` row since 2026-09-04 21:15. Cause:
  `~/.counterparts/credentials.env` holds no key (the 09-04 install rewrote it to the template beside
  `dataDir`, I29's unrecorded half) and hooks inherit none, so `planSpawn` refuses `NO_CREDENTIAL` at every
  boundary; the same install also dropped the `embedder` block, so vectors stay off until it is restored. Full record: `docs/LAUNCH-STATUS.md` I32, G44, G45.
- **Owner ruling wanted (G44):** whether the ≥ 7 Phase-P active days count from 2026-09-10 as recorded, or
  from the first day the worker actually runs on the live store. The daily's `class` rule is unchanged; this
  note is the caveat beside the number.

## State — 2026-09-10: the second core batch merged, restart #4, the run's clock starts again

*Appended 2026-09-10. Every number below is copied from `~/counterparts-parallel-run/2026-09-03/`
(`run.json`, `restarts.jsonl`, `days/*.json`) or from `gh pr view`, read read-only. Nothing here
was measured by opening a live store.*

### The two restarts since the last entry

| # | `restartedAt` | `date` | Reason, as recorded | surfaceSet |
|---|---|---|---|---|
| 3 | `2026-09-05T14:54:16.681Z` | 2026-09-05 | "overnight core batch #64-#72: surfaceSet 800a9a9421cd969f -> c3af0bef00209ba6 (#65 gate.deposit); class anything-else" | `800a9a9421cd969f` → **`c3af0bef00209ba6`** |
| 4 | `2026-09-10T14:15:48.392Z` | 2026-09-10 | "second core batch #79 #80 #81: prose paths relative (schema v5), explicit-dir guard, events pruned in sleep; surfaceSet c3af0bef00209ba6 unchanged; class anything-else; hooks restored to the live store" | `c3af0bef00209ba6` unchanged |

Source: `restarts.jsonl` lines 3 and 4. Both entries record `phase: "P"` and
`clearedActiveDays: {"0":1,"P":0}`.

`run.json` after restart #4: `phaseRestart.date` **2026-09-10**, `phaseRestart.phase` `"P"`,
`activeDays` **`{"0":1,"P":0}`**, `surfaceSet` `c3af0bef00209ba6`, `updatedAt`
`2026-09-10T14:19:28.314Z`. **The ≥ 7 Phase-P active days therefore count from 2026-09-10.**
Zero counted days are lost: the count was already 0.

The merges the two restarts price, from `gh pr view`:

- **#75**, the first core batch (#64–#72), merged `2026-09-05T14:41:15Z` as `ef82cd5`. Restart 3
  followed it thirteen minutes later.
- **#82**, the second core batch (#79, #80, #81), merged `2026-09-10T14:13:23Z` as **`2b95f21`**.
  Restart 4 followed it two minutes later. #79, #80 and #81 each read `MERGED` (closed by the
  batch at `2026-09-10T14:13:26Z`); no PR is open.

### The days, 09-04 through 09-09

| Date | `class` | `turns` | What the record's `why` says |
|---|---|---|---|
| 2026-09-04 | **active** | 97 | "the primary (v2) reached a boundary and the muted side graded pass (v2 by 86 stop-hook primacy record(s) and 82 episode-ask record(s)) and the day carried 97 turn(s), at or above the committed floor of 5" |
| 2026-09-05 | thin | 86 | "the PRIMARY system (v2) reached no session boundary on this day — v1 pass (11 session.end, 124 ab.muted row(s)) · v2 fail (0 stop primacy, 0 episode-ask, 0 adapter.boundary)" |
| 2026-09-06 | thin | 0 | same v2 failure; "v1 not-exercised (no log for this day)" |
| 2026-09-07 | thin | 60 | same v2 failure; "v1 pass (1 session.end, 66 ab.muted row(s))" |
| 2026-09-08 | thin | 0 | same v2 failure; "v1 not-exercised (no log for this day)" |
| 2026-09-09 | thin | 26 | same v2 failure; "v1 pass (3 session.end, 32 ab.muted row(s))" |

`class`, `turns` and `why` copied from `days/<date>.json`; `run.json`'s `days` array agrees on
every class. The records for **09-07, 09-08 and 09-09 were written on 2026-09-10**, under the
owner's standing permission of 2026-09-05 to run `daily.ts` for a previous day.

**Every thin day above is I29, not a quiet day.** The hooks were reading `dataDir` from
`~/.counterparts/claude-code.json`, which pointed at a temp store from 2026-09-04 15:16 until the
owner restored it on 2026-09-10 08:15 (LAUNCH-STATUS I29, and I31 for the second half of the same
fault). The primary side reached no boundary in the LIVE store because nothing was writing to the
live store. Three of the six days carried turns well above the floor — 86, 60 and 26 against
`turnFloor: 5` — and were still classed thin.

**An instrument wording debt, named so it is not mistaken for a red line.** `tools/parallel/CONTRACT.md`
§5, "What counts as a day" (line 236), glosses the class as "**thin** (below the floor)". The
instrument's `thin` is wider than that gloss: the same paragraph defines `active` as *the primary
side reached a boundary AND the day carried at least K turns*, so a day that clears the turn floor
and misses the boundary half is `thin` too. **Three of the five thin days here prove it** — 09-05,
09-07 and 09-09, at 86, 60 and 26 turns against a floor of 5; 09-06 and 09-08 carried 0 turns and
are thin under either reading. The records say so in their own `why` field, and `turnFloor: 5` sits
beside `turns: 86` on 09-05. The instrument is behaving as
the definition specifies; the parenthetical gloss is the thing that is wrong. Filed as a wording
fix owed to the CONTRACT, not as a finding against the run.

### The watches

All **four** watches read `not-exercised` on every one of 09-04 → 09-09, with the reasons the
instrument writes:

- `sleep.symmetry` — "band.transition carries only the store's LIVED day and no `--lived-day` was
  given, so no transition can be attributed to this date — the watch was not driven here (a zero
  would be scar §2.4)".
- `self.schema.pressure` — until 2026-09-15 this read "no durable revision-pressure row exists in this
  build", which became false the day the first `revision.pressure` row fired (G55). **PR #111** (open,
  `tools/daily-pressure-watch`) makes it read the rows on the UTC date by `events.at`: ≥ 1 row →
  `needs-rater` naming each target's force, bar, pressure and whether a supersede followed (read off
  the target row as it stands, never recomputed); no row → `not-exercised` with the attribution rule
  on the record as `v2.revisionPressure.attribution`. `pass`/`fail` stay unreachable: the rows say a
  challenge was credited, not that crediting it was right.
- `self.schema.tripped` — "not a row: the trip is `schemaBytes` over the self rows, recomputed
  read-only by the preflight's `store.schemaBytes` check".
- `self.schema.quarantined` — "not a row: the F8 fallback quarantine is subtracted INSIDE
  `schemaBytes`".

The last two are `not-exercised` **by construction** — they are not rows in this build. The first
two are the pair a future daily could actually drive, and they are what the next session should
look at before any verdict is written.

### Cross-encoding: one named finding, on 2026-09-09

`days/2026-09-09.json` `crossEncoding`:

| Field | Value |
|---|---|
| v1 → v2 | 0 hits, against a bar of **0** in every phase |
| v2 → v1 | **3** hits, `distinctHits` 1 (address `f802320fad782067`), `scanned` 565 |
| `ratioDenominator` | 1502 v1 mints that day |
| `ratio` | **0.0019973368841544607** (≈ 0.0020) |
| `ratioBar` | 0.1 |
| `redLine` | `false` — `namedFinding` **`true`** |

The instrument's own note: "v2→v1 3 v1 line(s) carrying a verbatim v2 line against 1502 v1 mint(s)
that day — red-line above 0.1 (OQ4: v1 keeps v2's text by design)". Roughly fiftyfold under the
bar, in the direction the run expects to leak. **Named, not a red line.** 09-07 and 09-08 read
0 in both directions; 09-08 has no denominator at all (no v1 log), so its `ratioNote` records that
any hit there would have been a red line until the denominator could be read.

### `mute.v2DeliverByHook` is empty on 09-07, 09-08 and 09-09

`{}` on all three records. That is not evidence the delivery path is dead: the hooks were
delivering out of the temp store for the whole window, so the live store the daily reads has no
delivery rows to show. See I29 and I31. The reading becomes meaningful again from 2026-09-10, the
first day the hooks and the store agree.

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

> **RECORDED 2026-09-10 — no longer a proposal.** The change went in as PR **#69**, inside the
> first core batch **#75**, merged `2026-09-05T14:41:15Z` as `ef82cd5` (`gh pr view 75`). The
> owner confirmed the class by running the restart it asks for: `restarts.jsonl` line 3,
> `2026-09-05T14:54:16.681Z`, class anything-else. The heading above is left as it was written;
> this note is the record of its confirmation.

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
- **Consequence: the phase clock restarts — and all three ride the single restart the owner runs after this batch merges.** (Reconciled by the integrator of the second core batch, branch `overnight/core-batch-2` (PR #82): these three declarations were each written against "today's owed restart" on 2026-09-05 and are landed together; there is ONE restart, dated the merge day, and a same-date re-restart is accepted.) No separate `restart.ts` run is owed by this PR; the session that made the change may not run one.

**2026-09-05, PROPOSED and not yet recorded by the owner — `core/prose-paths-relative`, PR #79 (finding I22 / LAUNCH-STATUS G26: `memories.prose_path` and `versions.path` become STORE-RELATIVE; store schema v4 → v5; a copied or restored store reads and chases its own prose). Class: ANYTHING ELSE (§5 G12's third class) — a durable field's REPRESENTATION changes on the live store at its first writer open after the merge — riding the day's single restart.** *Written by the session that made the change; the owner merges core and confirms or amends this at merge.*

> **RECORDED 2026-09-10 — no longer a proposal.** PR **#79** went in inside the second core batch
> **#82**, merged `2026-09-10T14:13:23Z` as `2b95f21` (`gh pr view 82`; #79 itself reads `MERGED`,
> closed at `2026-09-10T14:13:26Z`). The owner confirmed the class by running the restart it asks
> for: `restarts.jsonl` line 4, `2026-09-10T14:15:48.392Z`, `surfaceSet c3af0bef00209ba6`
> unchanged, class anything-else. The conversion happened: `store.migrate.paths` at
> `2026-09-10T14:16:03Z`, schema 4 → 5, 15,541 prose rows and 468 version rows converted, 0
> unplaceable (the owner's `verify`, relayed 2026-09-10 — see LAUNCH-STATUS, G36). The heading
> above is left as it was written; this note is the record of its confirmation.

- **Surface-set hash unchanged.** `tools/parallel/surface.ts#surfaceSetHash()`: master `ef82cd5` → `c3af0bef00209ba6`; branch `core/prose-paths-relative` → `c3af0bef00209ba6`. `prose_path` is a store column, not a field of the per-turn surfacing decision, gate-chunk, gate-deposit or band-transition records, and no record shape moved. `run.json` is NOT re-read here — the run directory is off-limits to this session; the preflight compares it on the next daily.
- **Why not IDENTICAL, despite the hash.** G12's first class is *telemetry-only AND provably identical*, and this is not telemetry-only: two canonical columns are rewritten on ~15,000 `memories` rows and every `versions` row of the live store, in one transaction, at the first WRITER open after the merge (a session start, the MCP server, the worker). Recall, wake and every surfaced string are unchanged on a store opened where it was written — the resolved path is the same file — so no scored number is expected to move; but "expected" is not "provably", and the class is chosen for what the store HOLDS, not for what the meter reads.
- **Why not "red-line fix".** G10's list is closed and a copied store reading another store's prose is none of its seven items — no live write went wrong, no span was lost. It is a correctness fix to a durable representation, which is the third class.
- **Live reach, stated plainly.** (1) The first writer open after the merge converts the rows and appends one counts-only `store.migrate.paths` event; `counterparts verify` prints "Prose paths: N relative, M absolute (unmigrated), K missing files" before and "… M absolute (unplaceable) …" after, read-only (`OBSERVER_READ_FLOOR = 4` lets a v5 instrument read a v4 store, so `status`/`verify`/`backup`/the dashboard keep working in the window between merge and first open). (2) **The revert lever for v2's CODE becomes one-way at that open**: a pre-v5 build refuses a v5 store by name (`SCHEMA_AHEAD`) rather than misreading it — deliberate, because v4 code on relative paths would report a removal's prose as gone while the file survived. The run's REVERT lever proper (override back to bansai) is untouched; it does not need v2's code. Reverting the code after the first open means restoring a pre-v5 backup or rewriting the two columns by hand. (3) Existing backups under `~/counterparts-parallel-run/…` and any `counterparts backup` taken before today carry absolute rows naming the live store; under ANY v5 reader — instrument or writer — those rows are placed against the directory the backup is opened from (the adversarial review's required change; before it, an instrument on the backup read the live store's files until a writer converted them), and a writer open converts them in place. Under a pre-v5 build they are exactly what that build wrote. **Before merging, the owner takes `counterparts backup --out <dir outside the store and outside ~/.counterparts>` of the live store and keeps it until the run's verdict; merge with no session open, before the restart** — an old-code MCP server still alive when a new-code writer migrates the store would resolve `prose/…` against its own cwd and fail every prose read loudly until restarted. No agent opened the live store for this change.
- **Measured on temp stores only** (`test/store-portable.test.ts`, 12 tests after the review): pre-fix, (a) reading through a copy after deleting the source's file fails `PROSE_FILE_MISSING` naming the SOURCE's path, and (b) a removal through the copy exits 0 with the copy's own file still on disk — the source's was deleted (the three master-API tests, run in isolation against `ef82cd5`; the committed file as a whole imports v5-only names and fails at import there); post-fix both hold, a `backup` snapshot opens standalone with the source wiped, absolute rows under the store's own dir AND under a `/private/var` spelling convert at open, a second open is byte-identical, an unplaceable row is left and counted, a blanked pointer resolves to `""` and never to the store root, an INSTRUMENT on a v4 copy or moved store reads that store's own files with the source wiped and writes nothing, and a hand-edited `../ESCAPE/…` row is refused by name and counted. **Cost of the live conversion, measured** on a synthetic store of 15,000 `memories` + 2,000 `versions` rows with absolute paths, stamped v4: the first writer open took 79 / 82 / 67 ms on three fresh stores (every row converted, one event); the steady-state open after it, under a millisecond (`store/NOTES.md` 2026-09-05).
- **Consequence: the phase clock restarts — and all three ride the single restart the owner runs after this batch merges.** (Reconciled by the integrator of the second core batch, branch `overnight/core-batch-2` (PR #82): these three declarations were each written against "today's owed restart" on 2026-09-05 and are landed together; there is ONE restart, dated the merge day, and a same-date re-restart is accepted.) No separate `restart.ts` run is owed by this PR; the session that made the change may not run one.

**2026-09-05, declared before merge — `core/prune-events` (I23 / G27: `Store.pruneEvents` had no caller; sleep gains a terminal `log` phase that deletes unlatched event rows older than 90 lived days, at most 5,000 per pass, oldest first). Class: ANYTHING ELSE (§5 G12's third class), riding the day's single restart.**

- **Surface-set hash unchanged.** `tools/parallel/surface.ts#surfaceSetHash()`: master `ef82cd5` → `c3af0bef00209ba6`; branch `core/prune-events` → `c3af0bef00209ba6`. No field of the per-turn surfacing decision, gate-chunk, gate-deposit or band-transition records moves; the phase adds no record shape of its own (its `sleep.log.swept` is in-memory telemetry, and `store.events.pruned` already existed). `run.json` is NOT re-read here — the run directory is off-limits to this session, and the preflight compares it on the next daily.
- **Why not IDENTICAL, despite the hash.** A sleep pass gains a step that DELETES durable rows. The first class is *telemetry-only AND provably identical*, and a deletion from box 2 is not telemetry-only even when what it deletes is telemetry: what the store HOLDS moves. The declaration takes the third class on that alone.
- **Why not a red-line fix.** G10's list is closed and an unswept log is on none of it — the table grew, nothing was lost or corrupted. It is a behaviour change made on purpose (owner ruling 2026-09-05), which is what the third class is for.
- **What the instrument reads, and why the window is safe for it.** `tools/parallel/readers.ts` reads `adapter.*`, `sweep.gate`, `recall.decision` and the two durable exit rows for ONE date at a time (SQL-filtered by lived day or payload date) plus a whole-table count of `recall.decision`; the run needs ≥ 7 active days plus review slack; the window is 90 lived days and a test pins the default at ≥ 90 with this run as the reason. Every record kind — `memory.pruned`, `memory.merged`, `memory.unmerged`, `band.promoted`, `band.transition`, `revision.pressure`, `gate.chunk` — carries a latch and is kept at any age. The owner's I17 check (`memory.merged` rows whose `candidateId` starts with `sch_`) reads latched rows and is unaffected.
- **Live reach — arithmetic, then a measurement.** Every `appendEvent` site passes a `day` taken from `livedDay()` at write time; `advanceClock` refuses to move backwards; `tools/migrate` writes no events. The live store has lived at most the calendar days since 2026-08-25 (eleven), and the cutoff is `livedDay − 90`, so **the first pass on the live store should delete 0 rows**, whatever v1's `activeDay` set the clock to, and keep deleting 0 until the store has lived 90 days past its first v2 event. **The premise that argument rests on, named by the adversarial review:** no event was written before migration set the clock. `tools/migrate/apply.ts#setMetaIfChanged` moves `livedDay` through `setMeta` — the side door around `advanceClock`'s forward-only promise — with no fresh-store guard, so a store that had run a hook, `verify` or an install before migration would carry day-0 rows a 400-ish clock puts far past the cutoff (reviewer's probe: 5 rows then clock → 400, first pass deleted 5; clock first then rows, 0). **Measured on the live store, read-only, by the coordinator on 2026-09-05:** `counterparts verify` printed **1,342 rows held, oldest lived day 184, 0 past the window** — the live store is the second shape and the first pass deletes nothing. The session that made the change did not open the store. If a future `verify` shows a non-zero `past the window`, the named suspect is a `setMeta`-moved clock over rows that predate it.
- **Consequence: the phase clock restarts — and all three ride the single restart the owner runs after this batch merges.** (Reconciled by the integrator of the second core batch, branch `overnight/core-batch-2` (PR #82): these three declarations were each written against "today's owed restart" on 2026-09-05 and are landed together; there is ONE restart, dated the merge day, and a same-date re-restart is accepted.) No separate `restart.ts` run is owed by this PR; the session that made the change may not run one.

**2026-09-10, RECORDED AFTER THE FACT — `#65 gate.deposit` (workstream 6, replay §2a: a durable `gate.deposit` record per authored deposit, 28 ids-only fields; a registries total; the replay refusal mix computed over both record kinds). Class: ANYTHING ELSE (§5 G12's third class). This is the change that moved the surface-set hash to `c3af0bef00209ba6`.** *Written 2026-09-10 by a docs session. G12's rule is that the declaration is recorded BEFORE the change lands; this one was not, and saying so is the point of the entry. The change landed 2026-09-05 with its class stated in the overnight PR table and its restart run the same afternoon, but the declarations section here never got an entry of its own — the hash it moved was cited by every neighbouring declaration and the record that moved it was missing. Filling the hole late is better than leaving it; it is not a precedent for declaring late.*

- **The class, as it was stated at the time.** `docs/LAUNCH-STATUS.md` line 840, the overnight PR table of 2026-09-05: class **"anything else (hash moved by design)"**, review verdict MERGE WITH CHANGES → applied (`6cdb542`), hash on branch **`c3af0bef00209ba6`**.
- **Why the hash moved, and why that is not the reason for the class.** `#65` adds a FOURTH hashed component to the surface set — `gate.deposit` — beside the per-turn surfacing decision, gate-chunk and band-transition records. `tools/parallel/surface.ts#surfaceSetHash()` hashes field NAMES, so a new record shape moves it by construction: `800a9a9421cd969f` → **`c3af0bef00209ba6`**. The class would be the third one regardless: a durable record that did not exist before now exists on every authored deposit, so what the store HOLDS moves.
- **Why not "identical".** G12's first class is *telemetry-only AND provably identical*. `gate.deposit` IS telemetry — the review's applied change kept the feeling word out of it and left it ids-only, 28 fields — but the two halves are an AND, and a new durable row is not identical to no row. Both halves fail together.
- **Why not "red-line fix".** G10's list is closed — span loss, corruption, a secrets miss, an isolation breach, a broken session, cross-encoding, a write into v1 — and adding a record is on none of it.
- **Consequence, and what actually happened.** The phase clock restarts. It did: `restarts.jsonl` line 3, `2026-09-05T14:54:16.681Z`, reason "overnight core batch #64-#72: surfaceSet 800a9a9421cd969f -> c3af0bef00209ba6 (#65 gate.deposit); class anything-else", `clearedActiveDays {"0":1,"P":0}`. The batch itself is PR **#75**, merged `2026-09-05T14:41:15Z` as `ef82cd5` (`gh pr view 75`). Thirteen minutes between merge and restart; zero counted days lost, because the count was 0.
- **Not measured by this entry.** No live store was opened to write it. The reach on the owner's store — how many `gate.deposit` rows exist — is a number the next `verify` or daily can read; nothing here claims one.

**2026-09-10, RECORDED at merge — the second core batch, PR #82 (`overnight/core-batch-2`: PR #79 prose paths relative / schema v5, PR #80 the explicit-dir guard, PR #81 events pruned in sleep's `log` phase). Class: ANYTHING ELSE for all three, on the three declarations above. ONE restart covers the batch.**

- **What merged, and when.** #82 merged **`2026-09-10T14:13:23Z`** as master **`2b95f21`** (`gh pr view 82`). #79, #80 and #81 each read `MERGED`, closed by the batch at `2026-09-10T14:13:26Z`; no PR is open. The owner merged it with no session open, as G35 asked.
- **Surface-set hash unchanged: `c3af0bef00209ba6`**, on every one of the three branch declarations above and in `run.json` after the restart. Nothing in the batch adds or renames a field of the per-turn surfacing decision, gate-chunk, gate-deposit or band-transition records.
- **The single restart.** `restarts.jsonl` line 4: `restartedAt` **`2026-09-10T14:15:48.392Z`**, `date` 2026-09-10, `phase` P, reason "second core batch #79 #80 #81: prose paths relative (schema v5), explicit-dir guard, events pruned in sleep; surfaceSet c3af0bef00209ba6 unchanged; class anything-else; hooks restored to the live store", `clearedActiveDays {"0":1,"P":0}`. This is the reconciliation the three 2026-09-05 declarations each promised: they were written against "today's owed restart", they landed together, and there is one restart dated the merge day.

**2026-09-14, declared before merge — `fix/degrade-durable-poison`, PR #95 (I32 / I33: the worker degrades instead of refusing without a key, spawn refusals and runner failures are durable rows with a persisted escalation counter, the ask cap keys on the calendar date, the embedder sanitizes lone surrogates and bisects a 400 to the poison item, ids that fail on their own three times are skipped with `verify --retry-skipped` as the way back, `install --force` keeps a credentials file that holds a key). Class: ANYTHING ELSE (§5 G12's third class). ONE restart, `--date 2026-09-11` (a same-date re-restart keeps 09-11 as day 1).**

- **Surface-set hash unchanged: `c3af0bef00209ba6`**, measured on the PR head `9ab3073` and on a preview merge with master `bbfea7c` (`tools/parallel/surface.ts#surfaceSetHash()`). The four hashed record shapes are untouched; `sweep.gate` is not one of them and gains a `reason` field (`ran` | `no-credential`).
- **Why not IDENTICAL, despite the hash.** What the store HOLDS moves on the live store at the first boundary after merge: the keyless path now runs the sleep cycle (clock, decay, prune, dedup, consolidate, briefing) where it ran nothing; the ask counter is charged to a calendar-date key; new durable rows (`adapter.spawn.refused` / `adapter.spawn.failed` / `adapter.runner.failed`) and new meta keys (`adapter.spawn.refusals.<reason>`, `embed.failed.<id>`) appear; and the embedding backfill, blocked since 09-04, will land vectors for ~211 live rows over the next four boundaries, which changes what the semantic channel can surface. Not telemetry-only, not provably identical.
- **Why not a red-line fix.** G10's list is closed; a refused worker and a poisoned embed chunk are on none of it. These are behaviour changes made on purpose (owner rulings 2026-09-11).
- **Review record.** Adversarial review on Opus, 2026-09-14: two CONFIRMED blockers in the skip list (whole-chunk failures of any code retired healthy ids after three runs and `unembeddedCount()` then read complete — I33 inverted; a skipped id had no in-product way back and `verify` named a rebuild that does not clear the counter), one medium (64 box-2 write transactions per failing run), and three low — all fixed in `2798ce2` and `9ab3073` with seven tests. Deferred, not blocking (LAUNCH-STATUS G47): the daily's readers count `sweep.gate` by name and cannot see the `no-credential` reason; the new row can flip `joinAvailable` on a date with no session-bearing rows; G45 asked for a `spawn.escalated` row and the PR folds escalation into `escalate` on the refused row (owner sign-off). Residue named in the adapter's `INTERFACE-GAPS` item 7: attribution is per fill, so a fill mixing an isolated 400 with a 500 elsewhere still charges the 500's victims.
- **Not measured by this entry.** The declaration was written before the merge; the restart line and the first post-merge backfill row are the next daily's to read.

**2026-09-14, declared before merge — `core/durable-sleep-rows`, PR #100 (IMPROVEMENTS U9: one durable `sleep.cycle` row per sleep cycle with every phase's status, one durable `self.briefing` row per wake render with lane counts and the trimmed ids; the daily reads both, splits `sweep.gate` / `sleep.cycle` / `recall.credit` by reason, and gains the `memory.reinforced` watch). Class: ANYTHING ELSE (§5 G12's third class). Lands BEFORE #99 (plan of record, step 2) and rides the same single restart as #99 when both merge the same day; `--date 2026-09-11`, same-date re-restart.**

- **Surface-set hash unchanged: `c3af0bef00209ba6`**, measured by the coordinator on a preview merge of head `460e451` with master `f3f3046`. Neither new row is one of the four hashed record shapes and none of those four gains or loses a field.
- **Why not IDENTICAL, despite the hash.** Two new durable rows land in box 2 at every boundary on the live store; what the store HOLDS moves, even though what it surfaces does not. The first class is *telemetry-only AND provably identical*; these rows ARE telemetry (ids-only, no text, unlatched like `sweep.gate`), but a new durable row is not identical to no row — the same reasoning as the `#65 gate.deposit` entry above. Both halves must hold and one does not.
- **Why not a red-line fix.** G10's list is closed; an unrecorded sleep cycle is on none of it. It is a behaviour change made on purpose (owner ruling 2026-09-14 on the plan of record).
- **What the instrument reads, and what changes on the record.** Two names join `DURABLE_DETECTORS`; the totals for existing names are unchanged, so every recorded day re-grades identically. The new watch `memory.reinforced` is expected to read **FAIL** on the live store from its first daily (post-launch rows exist, none reinforced — U10) and to turn `pass` after #99's credit seam lands and the first `recall.credit:credited` row appears. That red reading is the row we wanted, not a defect of the instrument.
- **Not measured by this entry.** Written before the merge; the first `sleep.cycle` and `self.briefing` rows on the live store are the next daily's to read.

**2026-09-14, declared before merge — `core/sweep-reasons-band-of-record`, PR #106 (G48: `sweep.gate` gains `refusals` by reason and `noisyRefusals`; U8: the decay phase writes `memories.band` / `band_day` back to the table so the column follows physics and `verify` counts disagreements; U4: the wake preface says "N memories of M live rows"; G47(b): the daily's silent-session join counts session-bearing rows only). Class: ANYTHING ELSE (§5 G12's third class). Rides the evening batch's ONE restart with #104 and PR 2, `--date 2026-09-11`, same-date re-restart.**

- **Surface-set hash unchanged: `c3af0bef00209ba6`**, measured by the coordinator on a preview merge of head `a7ee054` with master `cbeb210` (suite 1944/0 there). `band.transition`'s fields are untouched — the decay phase adds a table write beside the row it already emitted, not a field to the row. `sweep.gate` is not hashed.
- **Why not IDENTICAL, despite the hash.** Three things the store HOLDS move: two new fields on every `sweep.gate` row; at the first decay pass after merge, `memories.band` / `band_day` are rewritten on every live row whose column disagrees with physics (~869 on the live store by the 09-14 audit) — the crossing record stays the latched `band.transition` row, and nothing gates on the column, but the column is canonical data; and the wake's first line changes on every boundary. Not telemetry-only, not provably identical.
- **Why not a red-line fix.** G10's list is closed; an uninformative counter, a stale reporting column and a header count are on none of it. Behaviour changes made on purpose (owner's standing instruction 2026-09-14 evening: keep fixing what can be fixed; the plan of record for U6–U10).
- **What the instrument reads.** New split `sweep.gate:refused` (a row with any non-quiet reason); `joinAvailable` now keyed to `SESSION_BEARING_EVENTS`, so a date with only worker rows and a muted v1 session grades `silent` instead of join-unavailable — a day recorded before this change re-grades only if it had that shape (none in this run did; the join-unavailable note was printed on no recorded day). `v2DateRows` keeps its meaning.
- **Not measured by this entry.** Written before the merge; the first post-merge `verify` on the live store should print the band-of-record disagreement count, and the first decay pass should bring it to 0 — the next daily's to read.
- **The schema conversion happened as declared.** `store.migrate.paths` at `2026-09-10T14:16:03Z`: `from` 4, `to` 5, **15,541** prose paths converted, **468** version paths converted, **0** unplaceable. `verify` after the first wake reads "Prose paths: 15541 relative, 0 absolute (unplaceable), 0 missing files / Version paths: 468 relative, 0 absolute, 0 missing" (the owner's command output, relayed 2026-09-10; see LAUNCH-STATUS G36). The revert lever for v2's CODE is now one-way — a pre-v5 build refuses a v5 store by name — which is why G34's backup was taken first.
- **#81's pass will delete nothing when it runs, as the arithmetic said.** `verify`: "Events: 1349 held (104 latched) oldest lived day 184 (2026-09-03) window 90 lived days". The oldest row is 184 against a lived day of 185, so the cutoff (day − 90) catches no row. **Not yet exercised:** the `log` phase runs inside a sleep cycle, and the `verify` above was taken before the first Stop-boundary sleep pass of the new session — so this is what the first pass will read, not a report of one that ran. The pre-merge census read 1,342; seven rows were added between that reading and this one.
- **#80's guard is off on the live host and stays off.** It arms on `COUNTERPARTS_REQUIRE_EXPLICIT_DIR`, which the hooks and the MCP server do not set. Where it IS set — the test preload, the demo seeder, the loops, the bench, every agent shell — the only behaviour that moves is a refusal before anything opens.
- **The run's own clock.** `run.json` after the restart: `phaseRestart.date` 2026-09-10, `activeDays {"0":1,"P":0}`. The ≥ 7 Phase-P active days count from 2026-09-10, the first day the hooks and the live store agree (I29/I31, closed by G37 the same morning).

**2026-09-14, declared before merge — `fix/credit-seam-and-identity-rotation` (IMPROVEMENTS U10 + U6: reference resolution built and wired at every session-ending boundary; dedup's re-encounter routed through `creditUse`; the identity lane rotates instead of ranking). Class: ANYTHING ELSE (§5 G12's third class). The phase clock restarts; one `restart.ts`.**

- **Why not "red-line fix".** Nothing on G10's closed list: no span loss, no corruption, no secrets miss, no isolation breach, no broken session, no cross-encoding, no write into v1. What was wrong was an absence — a consumer the recall INTERFACE-GAPS §5 named and nobody built — and its consequence on the live store, measured read-only before the change: 1,374 memories minted since launch (days 184–188), every one at `uses = 0`, `reinforced_days = 0`, `promoted_identity = 0`; the only reinforced rows in the store carry values imported from bansai. Verified independently by the counterparts session at 15:40Z (1,378 live / 1,755 with archived, all zero).
- **Why not "identical" either.** Physics columns will move for memories minted since launch, which they never have; `memories.band` will change for anything the new credit carries across a threshold; and the identity lane's rendered CONTENT changes on the live store — rotation means the wake's "Who I am" stops showing the same three of twenty beliefs.
- **Surface-set hash, computed with `tools/parallel/surface.ts#surfaceSetHash()`:** master `f3f3046` → `c3af0bef00209ba6`; this branch → `c3af0bef00209ba6`. Unchanged: the change adds ONE new durable event name (`recall.credit`, one row per boundary, `reason`-keyed) and no field on `recall.decision`. The counterparts session's U9 PR adds the reader for it (`readers.ts` `DURABLE_DETECTORS`, split `recall.credit:credited` / `:failed` / `:budget-exceeded`).
- **Live reach.** Every `stop`, `session-end` and `pre-compact` hook now runs reference resolution over exactly the slice capture just took (the same cursor), under `TUNABLES.CREDIT_BUDGET_MS` = 150 ms, and leaves a `recall.credit` row whatever it decided (`credited` / `nothing-to-credit` / `no-candidates` / `budget-exceeded` / `failed`). Every boundary's briefing stamps the identity ids it KEPT (`self.rendered.<id>`, store meta). Every dedup merge credits the original through `store.reinforce` (the record's new `credit` field says what physics answered) instead of bumping `uses` behind physics' back. The MCP tools are untouched; the transcript reader lifts recall `tool_use` blocks into `expansions` beside the turn list, and the turn list itself does not grow (a live session's cursor indexes into it).
- **The credit rule, as ruled by the owner 2026-09-14 and written into `recall/CONTRACT.md` §9.2:** credited when EXPANDED through deliberate recall (`ids` / `handle` on the tool call — never ids parsed from prose) or QUOTED at content level (eight consecutive body words, verbatim, inside one assistant turn; only what surfaced LOUD is quotable). Never for being named, surfaced, footnoted, or rendered in a wake. The `surfaced` and `footnoted` use tiers stay unused by this consumer. Agreement is not judged: expanded-then-contradicted credits. Fixtures in `test/lifecycle.test.ts`: five ids cited in prose, none read, zero credit (the 2026-09-14 session); expanded and argued with, credited.
- **Expected first readings, so the daily can refute rather than argue.** (1) `recall.credit` rows from the first Stop after merge; `no-candidates` / `nothing-to-credit` until a session expands or quotes. A re-fired blocked Stop (`stop_hook_active`) writes a second row for the same boundary (`no-candidates`, `turns: 0`), consistent with `adapter.boundary`: two rows per blocked Stop is the expected shape, not a double credit (the slice is empty). (2) The `memory.reinforced` watch reads FAIL on merge (its own PR says so) and flips only after such a session, then the next consolidate (`CONSOLIDATION_EVERY_DAYS` = 3) is the earliest a post-launch memory can cross to identity, and only with three distinct reinforced days. (3) The identity lane: on the first post-merge boundary every identity row carries no stamp, so the tie falls through to strength and born-day and the SAME three render once more; rotation is visible from the second boundary, and all twenty have rendered within about seven boundaries at today's budget.
- **Three rulings from the review of #99, all ruled by the owner 2026-09-14 and landed INSIDE this PR (one restart, not two):** **R1** — a dedup merge bumps `uses` only, never a reinforced day (`MergeRecord.credit: "uses-only"`): a merge is a re-encounter on the record, not engagement, and promotion stays gated on expanded-or-quoted use. **R2** — `Recall.resolveUse`'s never-downgrade check is keyed to (session, memory, LIVED DAY): a session that spans days and expands the same memory each day credits it once per day, physics' own occasion rule; before, the first consumer of that gate credited once EVER per session. `CreditRecord` carries the day; the `credited` gate row's `last_day` is the credit's own day. **R3** — the eight-word quote window must carry at least three non-stopword tokens (`QUOTE_CONTENT_WORDS`), so "I think it would be a good idea to …" shared by two sentences is boilerplate, not a quote.
- **Owner choices this PR makes, named so they can be narrowed:** credit on the `referenced` tier only; identity rotation ahead of strength (all twenty cycle, not just the eight tied at 1.0); `QUOTE_WINDOW_WORDS` = 8 and the 150 ms budget are tunables, not contract.
- **Consequence: the phase clock restarts** (class anything-else). Budget for a same-date re-restart if the U9 PR lands the same day; the two share one restart if merged together.

**2026-09-14 (evening batch), declared before merge — `fix/wake-leftover-titles-label-and-enum` (IMPROVEMENTS U2 footnote title cap, U3 the OQ4 probe advanced one step with its metric, U11 session_end names a malformed reason; U6 leftover rule examined and left as is). Class: ANYTHING ELSE. Rides the evening batch's ONE restart with the counterparts session's core/adapter PRs; no restart of its own.**

- **Why not "red-line fix".** Nothing on G10's list. Two rendering changes and one tool-result field.
- **Why not "identical".** What the store surfaces changes on every turn with footnotes: the header string (U3) and the title width (U2, authored titles only). What the store holds changes by one field on `recall.credit` (`expandedIds`, `expandedTotal`, ids only, capped 64).
- **Surface-set hash:** `c3af0bef00209ba6` on master `e0f4a34` and on this branch — no hashed record touched; `recall.decision` unchanged.
- **U3 is the OQ4 probe, advanced one step, not a fix.** `render.ts` keeps `FOOTNOTE_HEADER_STEP_0` ("Quietly available (ignorable):", live through 2026-09-14) beside `FOOTNOTE_HEADER_STEP_1` (adds "expand an id with recall before citing one"); `FRAMING.footnoteHeader` points at step 1. Reversal is one line and one ruling. The measurement lands in the same PR: `recall/probe.ts` + `counterparts probe-oq4`, per calendar date, footnotes delivered (`recall.decision.footnotes[].id`) vs. later expanded (`recall.credit.expandedIds`). The before/after line is NOT the restart: hooks are fresh processes that run whatever `~/counterparts` has checked out, and this branch was developed IN the shared checkout, so step 1 and the `expandedIds` field were live for every session on the machine from the moment the edits hit disk — `render.ts` last written **2026-09-14T16:51Z**, one `recall.credit` row carrying `expandedIds` at 16:57Z (the counterparts session's boundary, reason nothing-to-credit) — until **16:58Z**, when the shared checkout went back to `origin/master` (e0f4a34) and the branch moved to a worktree (`.claude/worktrees/random-batch`). Seven minutes, one boundary, zero footnotes expanded; the probe aggregates by calendar date, so 2026-09-14 reads as step 0 with that leak named. The step-1 side starts at the merge. Rule, companion to G51: **the shared checkout stays at `origin/master`; nobody develops in it.** What the probe can and cannot say at merge: `expandedIds` only exists from #99 (8d7bd97, 2026-09-14 ~16:43Z), so the ONLY measured step-0 window is 8d7bd97 → 16:51Z — a few hours, named as thin. The 2026-09-03 → 09-13 dates have decision rows (423 footnotes delivered) and no credit rows; the probe prints them as "-" (unmeasured), not 0.000, and keeps them out of the totals (review of #104, M1). Nothing before today recorded what was expanded, so nothing is known about it.
- **U2:** `FOOTNOTE_TITLE_BYTES` 80 → 150. Migrated titles are STORED at 80 characters and render as before EXCEPT those carrying a multi-byte character (em-dash, curly quote, accent) inside the 80, which were clipped at 80 BYTES and whose tail now renders; the recall bench's numbers do not move (it scores ids, not title widths); authored titles render whole. Six footnotes at 150 bytes plus ids and framing ≈ 1,100 bytes against the 2,048 default; the composed budget and trim order are untouched.
- **U6 leftover rule: examined, NOT changed.** `self/NOTES.md` §9 rule 4 keeps the element set a superset across budgets; rotation (#99) removes the reason to want the change. Recorded in IMPROVEMENTS U6.
- **U11:** `DepositResult.malformed` (optional, intake's `MalformedReason`); `session_end`'s per-entry outcome names it and, for `KIND_UNKNOWN`, lists the kinds. Tool-result shape gains two optional fields; nothing durable.
- **Expected first readings:** the recall block's footnote header changes on the first turn after the restart — the parallel-run transcript canary matches on `counterparts:recall` markers, not the header text, so nothing trips; `counterparts probe-oq4 --dir ~/.counterparts/store` prints a table from the day #99 landed onward.

## Owner ruling, 2026-09-10 — what PROMOTE does to v1

Neither this document nor `tools/parallel/CONTRACT.md` §7 said what happens to bansai (v1) on
a PROMOTE verdict. The owner ruled on 2026-09-10: **keep everything, turn it off completely.**

- **Kept, untouched, read-only:** `~/.bansai` (its store, logs and journal) and the `~/bansai`
  repository — for later review or restoration. Nothing in either is deleted or rewritten.
- **Turned off at the verdict:** bansai's two remaining hook entries (`session-start`,
  `user-prompt-submit`; the three encoding hooks were already removed on 2026-09-10 under
  G38) and their guard script; any bansai MCP registration; the `parallel.enabled` knob in
  the live configuration (retired per `config.ts`'s own note); the primacy assignment file's
  `override` is left as it is until the run directory's post-cutover watch list (OQ7) is
  written, then the assignment file is archived into the run directory.
- **Order on verdict day:** the day's daily record → verdict written into the run directory →
  hooks removed with no session open → one `counterparts status` from a fresh session →
  OQ7 watch list written. Revert after that point is a restore from the kept `~/.bansai`,
  not a config flip.

Recorded here so verdict day has a script; the CONTRACT is not amended (it is the design's
record, and §7 stays as written).
