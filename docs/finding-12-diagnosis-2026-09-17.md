# Finding 12 diagnosis — why the crash fallback out-wrote the author 4.5 : 1

Read-only. Code read at `/Users/mlapeter/counterparts/.claude/worktrees/storage-spec`
(HEAD `54e419d`, branch `docs/storage-spec-2026-09-17`). Store read only as
`sqlite3 -readonly "file:$HOME/.counterparts/store/operational.sqlite?immutable=1"`.
No memory body text was read or quoted; counts, kinds, sources, days, scopes, session
ids and event names only.

> **2026-09-18 — do not reuse this recipe once the store is in WAL mode (F1, PR #137).** `?immutable=1` makes SQLite ignore the `-wal`, so every query reads the database as of the last checkpoint — silently short, no error (proved in `docs/adversarial-review-f1-2026-09-18.md`). Use plain `sqlite3 -readonly <path>`. What is written here is what was run at the time, under DELETE mode, where it was right.


**Reconciliation of the spec's numbers.** The spec's cut is exactly
`birth_day >= 184 AND archived = 0 AND type = 'memory' AND learned_on <= '2026-09-16'`:

```sql
select coalesce(source,'(null)'), count(*) from memories
 where birth_day>=184 and archived=0 and type='memory' and learned_on<='2026-09-16'
 group by 1;
-- fallback 888 | authored 193 | migrated 123 | episode 10   (total 1214)
```

**The store is live and moving under the read.** Between 15:05Z and 15:30Z on 2026-09-17
the fallback count rose from 938 to 954 (90 rows learned `2026-09-17`). Every number below
is pinned to `learned_on <= '2026-09-16'` unless marked otherwise, so drift does not touch it.

---

## 1. The answer, in plain language

The authored path is not losing a fight; it is almost never invited, and the fallback is
handed whole sessions at a time.

1. **The experiencer is offered the pen four times a day, total.** `MAX_CHAPTERS_PER_DAY = 4`
   (`src/core/self/tunables.ts:116`), and the cap is charged to the **day**, shared across
   every session that day holds (`src/core/self/episodes.ts:292`). Under the single pacer
   (2026-09-04 onward, dates ≤09-16), **264 Stop moments produced an ask decision and only 26 of
   them raised an ask** — 196 refused `day-chapter-cap`, 42 `not-enough-substance`. Counting the
   two pacers it replaced, 400 decisions and 61 asks raised across the whole run. The store's own
   counters show the cap pinned
   at its ceiling on every day it recorded: `self.episode.day.185 = 4`, `.186 = 4`, `.187 = 4`,
   `self.episode.day.2026-09-14 = 4`, `.2026-09-15 = 4`, `.2026-09-16 = 4`. On 2026-09-10,
   **27 Stops, zero asks** — all 27 capped.
2. **A quarter of the 888 predates the rule that made the sweep a fallback.** The crash gate
   (`96f7869`, "The sweep is a crash fallback in fact, not only in the contract") deployed
   mid-afternoon on 2026-09-04: the last unconditional sweep call is `gate.chunk` at
   **2026-09-04 15:37:36Z** and the first crash-gate row is `sweep.gate` at **15:39:17Z**, after
   which every gate row that day reads `ran: 0`. Everything before that line — 54 rows on 09-03
   and 163 on 09-04 — is the sweep doing its old job as the *primary* path. That is
   **217 of the 888 (24.4 %)**, cleanly separable by timestamp.
3. **Of the remaining 671, the sweep's definition of "crashed" catches sessions that are alive.**
   A session is crashed when it has no `session-end` boundary in that scope and has been silent
   for 12 hours (`CRASH_STALE_MS = 12h`, `src/core/remember/tunables.ts:50`; predicate
   `src/core/remember/spans.ts:634-651`). A Claude Code terminal left open overnight is exactly
   that. **535 of the 888 (60 %, and 80 % of the post-gate rows)** came from four sessions that
   *did* eventually record a `session-end` — 17.3 h, 20.0 h, 45.4 h and 47.6 h after their last
   Stop. They were swept while still alive.
4. **The last 136 (15 %)** came from four sessions that never recorded a `session-end` at all
   (terminal killed, or still open) — the genuine crash case the fallback was built for.
5. **Each sweep writes about ten memories; each authored answer writes one.** 88 sweep model
   calls (`gate.chunk`) produced 852 accepted proposals through 09-16 (≈9.7 each); 106
   `gate.deposit` rows produced exactly 106 authored memories (1.0 each). The *number* of events
   is comparable (22 asks raised vs 26 scope-sweeps that ran over 09-10→09-16); the
   **memories per event differ by ~10x**, and that is the single largest multiplier.
6. **A backlog effect on top:** 136 of the 888 (15 %) landed in one burst on 09-11, when the
   worker's credential was restored after a week of `NO_CREDENTIAL` and a week's spans were swept
   at once; 338 more on 09-15 and 152 on 09-16 are the same shape. The sweep can catch up in
   bursts. The author cannot — its moment has passed.

**What did NOT happen:** the model is not refusing and it is not ignoring the ask. Every one of
the 106 `gate.deposit` rows reads `accepted: 1, refused: 0`, and in the window where answers are
measurable (09-11 → 09-16) **every one of the 9 session-days that got an ask produced deposits —
9 of 9**.

---

## 2. Per-day table

The lived-day clock and the calendar diverge badly (7 lived days over 15 calendar days), so the
table is keyed on calendar date with the lived day as a column. 2026-09-05 → 09-09 are absent
because **v2 reached no session boundary at all on those days** — a separately recorded incident
(`docs/PARALLEL-RUN-STATUS.md:207-211`: "0 stop primacy, 0 episode-ask, 0 adapter.boundary").
09-12 has no rows either.

| cal date | lived day(s) | fallback | authored | episode | ask decisions | asks raised | capped | paced | deposits (answers) | sweep scope-runs | sweep model calls | sweep proposals |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-09-03 | 184 | 54 | 5 | 0 | 26 | 10 | — | — | n/a | n/a | 11 | 54 |
| 2026-09-04 | 184→185 | 163 | 82 | 0 | 137 | 29 | 18 | 5 | n/a | 0 | 27 | 163 |
| 2026-09-05→09 | 185 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-09-10 | 185 | 0 | 10 | 0 | 27 | **0** | 27 | 0 | 10 (all `jot`) | 0 | 0 | 0 |
| 2026-09-11 | 185→186 | **136** | 20 | 5 | 37 | 4 | 28 | 5 | 20 (19 `session-end`) | 9 | 10 | 121 |
| 2026-09-13 | 186→187 | 0 | 14 | 1 | 13 | 4 | 2 | 7 | 14 | 0 | 0 | 0 |
| 2026-09-14 | 187→188 | 45 | 28 | 2 | 75 | 6 | 59 | 10 | 28 | 2 | 5 | 45 |
| 2026-09-15 | 188→189 | **338** | 18 | 1 | 9 | 4 | 0 | 5 | 18 | 12 | 25 | 317 |
| 2026-09-16 | 189→190 | 152 | 16 | 1 | 76 | 4 | 62 | 10 | 16 | 3 | 10 | 152 |
| **total ≤09-16** | | **888** | **193** | **10** | **400** | **61** | **196** | **42** | **106** | **26** | **88** | **852** |
| 2026-09-17 (partial, live) | 190→191 | 90+ | 0 | 0 | 2 | 0 | 0 | 2 | 0 | 5 | 8 | 101 |

Notes on the columns:
- "ask decisions" and "asks raised" pool three event names. `adapter.ask` is the single pacer
  since 2026-09-04; `adapter.episode.ask` + `adapter.authorship.ask` are the two pacers it
  replaced, which is why 09-03 and 09-04 have inflated decision counts (two asks could fire at one
  Stop). **The `capped`/`paced` columns count `adapter.ask` rows only** — the old pacers record a
  different vocabulary (`chapter-cap` on the episode pacer, a bare `paced: true` on the authorship
  one). The old pacers' suppressions, excluded from those two columns, are 16 on 09-03 and 85 on
  09-04 (101 total); decisions − raised − capped − paced closes on exactly those.
- "deposits" = `gate.deposit` rows. The event shipped in the 09-04 overnight batch
  (`9231f50`, merged 2026-09-04 23:03) so 09-03/09-04 have none — hence `n/a`. From 09-10 the
  deposit count **equals the authored-memory count exactly** on every date: one deposit, one memory.
- **Asks answered**, as a separate measurement (deposits count memories, not answers). Joining
  `adapter.ask` rows with `outcome='asked'` on (session, date) against `gate.deposit` rows with
  `source='session-end'` on (session, `date(at)`):

  | date | session-days that got an ask | of those, session-days that deposited |
  |---|---|---|
  | 2026-09-04 | 2 | 0 — **unmeasurable**, `gate.deposit` did not exist yet |
  | 2026-09-11 | 3 | 3 |
  | 2026-09-13 | 1 | 1 |
  | 2026-09-14 | 2 | 2 |
  | 2026-09-15 | 1 | 1 |
  | 2026-09-16 | 2 | 2 |
  | **09-11 → 09-16** | **9** | **9 (100 %)** |

  Deposit counts per answered session-day: 6, 10, 3, 14, 13, 14, 18, 8, 8.
- "sweep scope-runs" = `sum(payload.ran)` on `sweep.gate`. The 39 gate rows on 09-04 carry the
  older payload shape (`{"scopes":8,"ran":0,...,"minted":0}`) and under-report; `gate.chunk` is the
  honest unit for that date.
- "sweep model calls" = `gate.chunk` rows (one per chunk the interpreter actually answered).

Queries:

```sql
-- memories per date by source
select learned_on, source, count(*) from memories
 where birth_day>=184 and archived=0 and type='memory' group by 1,2 order by 1;

-- ask decisions / raised / suppressed, all three event names
select json_extract(payload,'$.date'), name,
       sum(json_extract(payload,'$.asked') in (1,'true')) raised,
       count(*) decisions
  from events where name in ('adapter.ask','adapter.episode.ask','adapter.authorship.ask')
 group by 1,2 order by 1,2;

-- suppression reasons
select json_extract(payload,'$.date'), json_extract(payload,'$.outcome'),
       json_extract(payload,'$.reason'), count(*)
  from events where name='adapter.ask' group by 1,2,3 order by 1,4 desc;

-- answers
select date(at/1000,'unixepoch'), json_extract(payload,'$.source'), count(*),
       sum(json_extract(payload,'$.accepted')), sum(json_extract(payload,'$.refused'))
  from events where name='gate.deposit' group by 1,2 order by 1;

-- sweeps
select date(at/1000,'unixepoch'), count(*), sum(json_extract(payload,'$.ran')),
       sum(json_extract(payload,'$.minted'))
  from events where name='sweep.gate' group by 1 order by 1;
select date(at/1000,'unixepoch'), count(*), sum(json_extract(payload,'$.accepted'))
  from events where name='gate.chunk' group by 1 order by 1;
```

### The 888, partitioned by session (exclusive, sums to 888)

```sql
with fb as (select origin_session s, count(*) n from memories
            where birth_day>=184 and archived=0 and type='memory'
              and source='fallback' and learned_on<='2026-09-16' group by 1),
     b  as (select json_extract(payload,'$.session') s,
                   max(case when json_extract(payload,'$.kind')<>'session-end' then at end) last_stop,
                   min(case when json_extract(payload,'$.kind')='session-end' then at end) first_se
            from events where name='adapter.boundary' group by 1)
select fb.s, fb.n, datetime(b.last_stop/1000,'unixepoch'),
       coalesce(datetime(b.first_se/1000,'unixepoch'),'NEVER'),
       round((b.first_se-b.last_stop)/3600000.0,1) gap_h
  from fb left join b on b.s=fb.s order by fb.n desc;
```

The first cut is the **era**, and it is a clean timestamp, not an overlay:

```sql
select date(at/1000,'unixepoch') cal, name, count(*),
       datetime(min(at)/1000,'unixepoch'), datetime(max(at)/1000,'unixepoch')
  from events where name in ('sweep.gate','gate.chunk')
   and date(at/1000,'unixepoch') in ('2026-09-03','2026-09-04') group by 1,2;
-- 09-03 gate.chunk  11   20:42:55 → 22:21:59
-- 09-04 gate.chunk  27   02:28:58 → 15:37:36
-- 09-04 sweep.gate  39   15:39:17 → 21:15:35     (every one ran:0, minted:0)
```

The crash gate's first row is 15:39:17Z on 09-04 and no sweep ran after it that day. So every
`gate.chunk` on 09-03 and 09-04 is pre-gate.

| bucket | sessions | memories | share | last Stop → first `session-end` |
|---|---|---|---|---|
| **PRE-GATE** — sweep was the primary path by design, before 2026-09-04 15:39Z | `bfc78e11` 100, `c781252f` 61, `7c973b1c` 40, `f7043663` 6, `7fc8037b` 4, `ebdcb593` 4, `ebcb075f` 2 | **217** | **24.4 %** | (irrelevant: no gate yet) |
| **A. post-gate, alive but idle >12 h** — `session-end` arrived, far too late | `a8e0b78f` 224, `d3c84833` 152, `00302161` 114, `c889d472` 45 | **535** | **60.2 %** | +47.6 h, +17.3 h, +45.4 h, +20.0 h |
| **B. post-gate, no `session-end` ever** | `bfc78e11` 77, `e451e6af` 32, `2f46ee9f` 15, `8745ffb1` 12 | **136** | **15.3 %** | NEVER |

A + B = 671 post-gate rows; A is 80 % of them.

**Caveat on the session attribution.** `origin_session` on a swept memory is
`chunk.spans[0]?.session` (`src/core/counterpart.ts:2524`) — the chunk's *first* span's session,
stamped on every memory that chunk produced. `chunkSpans`
(`src/core/remember/fallback.ts:~430`) packs by bytes and does not partition by session, so a
chunk holding two crashed sessions attributes all its output to one of them. The A/B split is
therefore approximate at the margins; the era cut, which is by timestamp, is exact.

### Scope clustering

```sql
select origin_scope, source, count(distinct origin_session), count(*) from memories
 where birth_day>=184 and archived=0 and type='memory' and source in ('authored','fallback')
   and learned_on<='2026-09-16' group by 1,2 order by 4 desc;
```

| scope | fallback | authored |
|---|---|---|
| `/Users/mlapeter/counterparts` | 360 | 78 |
| `/Users/mlapeter/counterparts/.claude/worktrees/coord-docs` | **279** | **0** |
| `/Users/mlapeter/random` | 176 | 45 |
| `/Users/mlapeter` | 61 | 0 |
| `/Users/mlapeter/.counterparts/store` | 0 | 60 |
| `/Users/mlapeter/counterparts/.claude/worktrees/agent-ad930289c8793d360` | 19 | 0 |
| a `~/random` subdirectory (name withheld) | 15 | 0 |
| four bookkeeping scopes (names withheld) | 22 | 10 |
| `/Users/mlapeter/bansai` | 4 | 0 |
| `/Users/mlapeter/counterparts-parallel-run/…/probe-project` | 2 | 0 |

The two worktree scopes account for **298 fallback and 0 authored**. Their session ids
(`a8e0b78f`, `d3c84833`, `bfc78e11`) are the *same* ids that authored memories in
`/Users/mlapeter/counterparts` — one session, several scopes, one `session-end` row.

---

## 3. Hypotheses

### (a) The ask is rarely RAISED — **CONFIRMED. This is the upstream cause.**

**The pacer.** `src/core/self/episodes.ts:270-308` (`askDue`). Order of refusals:
`observer` → `anonymous-session` → `day-chapter-cap` → substance.
`src/core/self/episodes.ts:292`: `if ((opts.dayAsks ?? 0) >= t.MAX_CHAPTERS_PER_DAY) return no("day-chapter-cap");`

**The numbers** (`src/core/self/tunables.ts:110-117`):

| tunable | value |
|---|---|
| `FIRST_ASK_TURNS` | 6 |
| `FIRST_ASK_BYTES` | 4 000 |
| `SOLO_ASK_BYTES` | 12 000 |
| `REASK_TURNS` | 8 |
| `REASK_BYTES` | 8 000 |
| **`MAX_CHAPTERS_PER_DAY`** | **4** |

The first ask needs `turns>=6 AND bytes>=4000`, or `bytes>=12000` alone. Re-asks need
`sinceTurns>=8 AND sinceBytes>=8000` — the AND was measured and tightened on 2026-09-04
(`episodes.ts:302-305`). The cap is **per day across every session the day holds**, explicitly
(`src/core/self/tunables.ts:83-91`) because "this host opens a session per invocation".

**Measured.**

```sql
select json_extract(payload,'$.outcome'), count(*) from events
 where name='adapter.ask' and json_extract(payload,'$.date')<='2026-09-16' group by 1;
-- capped 196 | paced 42 | asked 26     (264 rows)
```

26 of 264 = **9.8 %** of Stop moments raised an ask. 196 of the 238 suppressions (82 %) were the
day cap, not the substance pacer. (Bounded to dates ≤09-16 because the unbounded aggregate moved
between reads — the live session writes `adapter.ask` rows as this runs.)

**The counters, in the store's own `meta` table:**

```sql
select key, value from meta where key like '%episode%day%';
-- self.episode.day.185 = 4        self.episode.day.2026-09-14 = 4
-- self.episode.day.186 = 4        self.episode.day.2026-09-15 = 4
-- self.episode.day.187 = 4        self.episode.day.2026-09-16 = 4
-- self.episode.day.188 = 2
```

Every recorded day sat at the ceiling. The counter is bumped when the ask is *raised*, not when
it is answered (`src/core/self/index.ts:1183-1192`, and the comment at 1177-1182: "what the cap is
protecting is the OWNER'S ATTENTION").

**The compounding bug that made this far worse.** Before I32 the cap keyed on the **lived day**,
and the lived-day clock is advanced by the worker — which was refused `NO_CREDENTIAL` for the
week of 09-04→09-11. So lived day 185 spanned calendar **09-04 through 09-11** and got **four asks
for eight calendar days**. That is why 2026-09-10 shows 27 Stops and zero asks, all capped. The
scar is written into the code that fixed it, `src/adapters/claude-code/hooks.ts:1103-1110`:
"a frozen clock meant `self.episode.day.185 = 4` forever, and the model was never asked for a
chapter again." The fix (keying on `input.at`, the host's calendar date) is visible in the `meta`
rows above as the switch from `.185` to `.2026-09-14`.

### (b) The ask is raised but rarely ANSWERED — **REFUTED where it is measurable (09-11 → 09-16); undetermined before that.**

Two halves, tested separately.

**Half 1 — is a submitted answer rejected? No.**

```sql
select json_extract(payload,'$.source'), count(*),
       sum(json_extract(payload,'$.accepted')), sum(json_extract(payload,'$.refused'))
  from events where name='gate.deposit' group by 1;
-- jot           12 | accepted 12 | refused 0
-- session-end   94 | accepted 94 | refused 0
```

**Zero refusals in 106 deposits.** From 09-10 onward the deposit count equals the
authored-memory count on every single date (10/10, 20/20, 14/14, 28/28, 18/18, 16/16), so nothing
is dropped between the tool call and the row.

**Half 2 — does the model call the tool at all after an ask?** Joining the ask rows to the
deposit rows on (session, calendar date):

```sql
with asked as (select distinct json_extract(payload,'$.session') s, json_extract(payload,'$.date') d
               from events where name='adapter.ask' and json_extract(payload,'$.outcome')='asked'
                 and json_extract(payload,'$.date')<='2026-09-16'),
     dep   as (select distinct json_extract(payload,'$.session') s, date(at/1000,'unixepoch') d
               from events where name='gate.deposit'
                 and json_extract(payload,'$.source')='session-end')
select asked.d, count(*) asked_session_days,
       sum(dep.s is not null) answered
  from asked left join dep on dep.s=asked.s and dep.d=asked.d group by 1;
-- 09-04: 2 asked, 0 answered   09-11: 3/3   09-13: 1/1
-- 09-14: 2/2                   09-15: 1/1   09-16: 2/2
```

**Nine of nine** from 09-11 on, with 3–18 deposits each. The 09-04 zero is an **instrument gap,
not a refusal**: `gate.deposit` shipped in the 09-04 overnight batch (`9231f50`, merged
2026-09-04 23:03) and its first row in the store is 2026-09-10, while 82 authored memories were
nevertheless minted on 09-04. So for 09-03/09-04 the question cannot be answered from this store.
Where it can be answered, the author answers every time.

### (c) Most sessions end without a usable Stop, so the sweep picks the span up later — **CONFIRMED, and it is the dominant proximate cause of the 671 post-gate rows.**

The gate (`src/core/remember/fallback.ts:190-215`, predicate `src/core/remember/spans.ts:614-651`):
a session is crashed iff it recorded **no `session-end` boundary in that scope**, has been silent
for `CRASH_STALE_MS`, and holds uncovered spans. `CRASH_STALE_MS = 12 * 60 * 60_000`
(`src/core/remember/tunables.ts:50`) — 12 hours, confirmed live in the gate payload
(`"crashStaleMs":43200000`).

Boundaries by kind:

```sql
select json_extract(payload,'$.kind'), count(*), count(distinct json_extract(payload,'$.session'))
  from events where name='adapter.boundary'
   and json_extract(payload,'$.date')<='2026-09-16' group by 1;
-- stop 366 (26 sessions) | session-end 27 (25 sessions) | pre-compaction 2
--   395 rows, 32 distinct sessions
```

**Twenty-seven `session-end` boundaries against 366 Stops.** But the sharper finding is the
*timing*: of the 671 post-gate rows, **535 (80 %)** came from four sessions that recorded a
`session-end` **17.3–47.6 hours after their last Stop**. `a8e0b78f` ran 2026-09-14 14:37→18:33
(39 Stops) and did not record a `session-end` until 2026-09-16 18:09 — 47.6 h later. Its 12-hour
window matured around 2026-09-15 06:33, and 224 fallback memories were minted with
`learned_on = 2026-09-15`. The session was alive the whole time. Same shape for `d3c84833`
(+17.3 h, 152 memories learned 09-16), `00302161` (+45.4 h, 114 learned 09-15) and `c889d472`
(+20.0 h, 45 learned 09-14). The remaining 136 post-gate rows are the genuine case: four sessions
with no `session-end` row at all.

**A related hazard, code-verified but with no measured victims.** The boundary record is written
for `input.scope` only — `this.counterpart.boundary({ session, scope: input.scope, kind })`,
`src/adapters/claude-code/hooks.ts:824-828` — while `crashedSessions` reads one scope's
`boundaries.jsonl` (`src/core/remember/spans.ts:634-651`). A session working in a project *and* a
worktree therefore records its end in one of them and stays "crashed" forever in the other.
My first pass attributed 77 memories to this. **That was wrong**: all 77 were minted before
2026-09-04 15:39Z, i.e. before the crash gate existed at all, so they need no explanation beyond
the era. The hazard is real in the code and nothing in the store yet demonstrates it firing.

No evidence either way for compaction: only 2 `pre-compaction` boundaries exist, and the code
states plainly that compaction alone does not make a session crashed
(`src/core/remember/spans.ts:627-632`).

### (d) Sessions that CANNOT answer (subagents, worktrees, headless, observer) — **PARTLY CONFIRMED, as scope-clustering rather than session-kind.**

The two agent-worktree scopes wrote **298 fallback and 0 authored** (see §2). But the session ids
involved (`a8e0b78f`, `d3c84833`, `bfc78e11`) are the *same ids* that authored memories in
`/Users/mlapeter/counterparts`, and all three fall in buckets A and B — sessions swept because
they went quiet, not because they were a kind of session that cannot answer. So the worktree
clustering is a symptom of (c), not independent evidence of (d). `/Users/mlapeter` (61 fallback,
0 authored) and a `~/random` subdirectory (name withheld) (15 / 0) are the same shape.

What *is* independently true: a scope only ever receives authored memories if a session was asked
while working in it, and the day cap makes that rare. Four of the eleven fallback-bearing scopes
have never received a single authored memory.

Observer scopes are not a factor: every `sweep.gate` row in the store reads `"OBSERVER":0`, and
observer sessions are refused at the ask (`src/core/self/episodes.ts:289`) and write nothing
(`src/core/remember/fallback.ts:180-183`).

I could not test the headless/`-p` sub-hypothesis: nothing in the store distinguishes a headless
session from an interactive one.

### (e) DOUBLE WRITING — **REFUTED as a designed mechanism, but PARTLY CONFIRMED by an unbound-session coverage hole.**

The sweep drops a proposal's own span outright (`withheldHashes`) and excludes already-covered
spans from the chunk input; covered spans only "ride along, marked"
(`src/core/remember/fallback.ts:232-247`). Coverage is claimed sequentially so successive
proposals *partition* a session rather than each claiming the backlog
(`src/core/remember/spans.ts:1055-1085`).

And it works: **176 of the 264** `adapter.ask` rows (dates ≤09-16) report `covered > 0`. Across
those rows the repeated-measures totals are 8 323 span-observations, 2 263 covered (**27 %**),
6 060 uncovered — so roughly **three quarters of captured spans are never covered by an authored
proposal**, which is the *feedstock* for the sweep, not a double write.

The reverse also holds: across all 267 `sweep.gate` rows, `NOTHING_UNCLAIMED` fired **twice**
(`select sum(json_extract(payload,'$.refusals.NOTHING_UNCLAIMED')) from events where
name='sweep.gate';` → 2). Twice in the whole run did the sweep find a crashed session whose
material had already been authored in full. In the two biggest fallback producers the last ask row
reads `covered: 0` — nothing at all had been authored in those scopes.

**But there is a hole, and it is large.** Coverage is claimed by session id —
`.filter((s) => s.session === input.session && ...)`, `src/core/remember/spans.ts:1076-1077` —
and an MCP server that was never bound to a session deposits under the literal string `"mcp"`
(`const session = this.session ?? "mcp";`, `src/adapters/mcp/server.ts:551`, same at `:613`).
That id matches no captured span, so **such a deposit marks nothing covered**.

```sql
select learned_on, origin_scope, count(*) from memories
 where birth_day>=184 and archived=0 and type='memory'
   and source='authored' and origin_session='mcp' group by 1,2;
-- 2026-09-03  /Users/mlapeter/.counterparts/store   5
-- 2026-09-04  /Users/mlapeter/.counterparts/store  55
-- 2026-09-10  /Users/mlapeter/counterparts          3
-- 2026-09-10  /Users/mlapeter/random                7
-- 2026-09-11  /Users/mlapeter/random                1
```

**71 of the 193 authored memories (37 %) carry `origin_session = 'mcp'`** — including 60 of the
87 authored on 09-03/09-04 (69 %). Those 60 also landed in scope
`/Users/mlapeter/.counterparts/store`, a directory that holds no captured spans and never received
a sweep. So on the two days when the sweep was still the primary path, most of what the author
wrote could not take a single span off the sweep's pile, and the sweep went on to paraphrase the
same stretches. *Inference, not measurement*: the store records no link between a swept memory and
an authored one, so "the same stretches" follows from the sessions and scopes lining up, not from a
row that says so. The mechanism (a `'mcp'` deposit covers nothing) is code-verified; the
consequence for those 217 pre-gate rows is inferred.

From 09-13 onward every authored memory carries a real session id, so the hole appears closed in
the current code path.

### (f) GRANULARITY — **CONFIRMED, and it is the largest single multiplier.**

| unit | events | memories | per event |
|---|---|---|---|
| sweep model call (`gate.chunk`, ≤09-16) | 88 | 852 accepted proposals → 888 rows | **≈9.7–10.1** |
| sweep scope-run (`sweep.gate.ran`, 09-11→09-16) | 26 | 671 | **≈25.8** |
| ask raised (all three pacers, ≤09-16) | 61 | 193 | **≈3.2** |
| ask raised (09-10→09-16 only) | 22 | 106 | **≈4.8** |
| authored deposit (`gate.deposit`) | 106 | 106 | **1.0** |

The *event* counts are comparable — 22 asks raised against 26 scope-sweeps in the instrumented
window. The 4.5 : 1 outcome is therefore mostly **memories per event**, not events. The reason is
structural: an ask covers the moment it interrupts, while one sweep is handed a crashed session's
entire uncovered backlog and chunks it at `CHUNK_BYTES`, emitting as many proposals as it likes
per chunk (the largest live chunk observed carried 24 accepted proposals).

### (g) Credential / worker effects — **CONFIRMED as a large timing artefact and a cap amplifier.**

`NO_CREDENTIAL`: `planSpawn` refused at every boundary because hooks inherit no environment
(`docs/LAUNCH-STATUS.md:1274-1275`, `docs/PARALLEL-RUN-STATUS.md:167`). Fixed by #95, restart
2026-09-11.

Two distinct effects:

- **Backlog dumps.** 136 of the 888 (15 %) were minted in one burst on 2026-09-11 — nine
  scope-sweeps, 10 model calls, 121 proposals, covering a week of spans. 338 more landed on 09-15
  (12 scope-sweeps, 25 model calls) and 152 on 09-16. The sweep writes in bursts on the day the
  worker comes back; the author cannot, because its moment has passed.
- **The cap amplifier**, already stated in (a): the frozen lived-day clock kept
  `self.episode.day.185` at 4 for eight calendar days.

Ratio before vs after the 09-11 fix (fallback : authored):
09-03/09-04 → 217 : 87 = 2.5 : 1; 09-10 → 0 : 10; 09-11 onward → 671 : 96 = **7.0 : 1**. The
fallback's dominance got *worse* after the credential fix, because the worker started running
every boundary again.

---

## 4. What would have to change for the authored path to be the main writer

Observations tied to the evidence above, not a design.

1. **The four-per-day cap is the binding constraint, and it binds every day it was measured.**
   `meta` shows the counter at its ceiling on 6 of 7 recorded days; 196 of 238 suppressions are the
   cap, not the substance pacer. On lived day 185 — 16 sessions, 133 Stops — four asks were the
   whole allowance. Any arrangement that keeps `MAX_CHAPTERS_PER_DAY = 4` shared across sessions
   leaves ~90 % of Stops offering nobody the pen.
2. **A `session-end` boundary that arrives hours late is, mechanically, the same as none.** The
   12-hour crash window expires while the terminal is still open: 535 of the 888 were written
   about sessions that were alive and reachable at the moment they were swept. Silence is the only
   crash signal the predicate uses (`src/core/remember/spans.ts:618-626` states this explicitly as
   an accepted limitation), while the adapter separately maintains a live-session registry.
3. **Boundary records are per-scope; sessions are not.** One session working in a project and a
   worktree is "ended" in one scope and crashed in the other forever
   (`hooks.ts:824-828` × `spans.ts:634-651`). No rows in this store are yet attributable to it, but
   298 fallback memories and zero authored came out of the two worktree scopes, so the exposure is
   there.
4. **Coverage is the real ledger, and it sits at ~27 %.** Even on days when the ask fires, roughly
   three quarters of captured spans are never claimed by an authored proposal, and those are
   exactly what the sweep is fed.
5. **Coverage is keyed on session id, and 37 % of authored memories carry the id `'mcp'`.** A
   deposit from an unbound MCP server marks nothing covered
   (`spans.ts:1076-1077` × `mcp/server.ts:551`). That is authorship that does not reduce the
   sweep's input at all.
6. **One deposit is one memory; one sweep chunk is about ten.** At comparable event counts (22
   asks raised vs 26 scope-sweeps over 09-10→09-16) the sweep still out-wrote the author 6.3 : 1
   in that window.
7. **Nothing here is about model willingness.** 106 deposits, 106 accepted, 0 refused; 9 of 9
   asked session-days answered. The author writes whenever it is asked.

---

## 5. What I could not determine, and what it would take

- **Whether specific sessions were subagent or headless (`-p`) runs.** The store records session
  id, scope and boundary kind, and nothing distinguishes a headless invocation. It would take
  either a new field on the boundary row or a read of the host's own transcript index (out of scope
  for a read-only diagnosis, and it would mean reading transcript files).
- **Whether the cross-scope hazard has ever fired.** `adapter.boundary` payloads carry no `scope`,
  so a session's `session-end` cannot be placed in a scope from the events table. Deciding it means
  reading `boundaries.jsonl` per scope under `~/.counterparts` — metadata only, no transcript text —
  which I did not do. Adding `scope` to the `adapter.boundary` payload would make it directly
  measurable in future. My first pass wrongly attributed 77 rows to it; corrected above.
- **Whether the author's answers on 09-03/09-04 reached the model at all.** `gate.deposit` did not
  exist until 09-10, so for those two days there is no record of tool calls — only of the 87
  memories that resulted. The "9 of 9 answered" figure covers 09-11 → 09-16 only.
- **Whether the 09-03/09-04 sweeps re-paraphrased stretches the author had already written about.**
  The `'mcp'` coverage hole makes it mechanically possible and the sessions/scopes line up, but the
  store keeps no link between a swept memory and an authored one. Deciding it would mean comparing
  bodies, which the privacy rule forbids.
- **Why the run recorded zero boundaries on 2026-09-05 → 09-09 and on 09-12.** The parallel-run
  status records the symptom ("the PRIMARY system reached no session boundary on this day",
  `docs/PARALLEL-RUN-STATUS.md:207-211`) but the cause is not settled there; it is a distinct
  investigation.
- **Whether the sweep's per-chunk yield of ~10 is prompt-driven or material-driven.** Sizing that
  would mean reading the sweep's prompt cards and proposal bodies, which the privacy rule forbids.
- **The 27 % coverage figure is a repeated-measures ratio** (each Stop re-reads the whole scope
  buffer), not a count of distinct spans. The per-session snapshot in §2 corroborates the order of
  magnitude but the exact distinct-span coverage would need a read of `coverage.jsonl` and the span
  streams under `~/.counterparts`.
