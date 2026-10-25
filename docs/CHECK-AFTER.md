# Experiments to watch

Most changes here are **experiments, not rulings**: we try something, lightly held, watch it on a real store for a
few days, then keep, tune or revert it. This file is where each one is tracked so none is forgotten. (It began as
"Things to check after a few days", Mike's ask on 2026-10-11; renamed 2026-10-19, his ask, to say what it is.)

Each entry says what we're trying and why, what to look at and where, when, what result would change it, and how
to revert. When it's checked, write the date and what was seen, and move its row in the index to "Checked". The
reasons behind each experiment live in `docs/decisions.d/` fragments and `docs/IMPROVEMENTS.md`; this file is the
follow-through.

Read-only on the owner's store: open it with `sqlite3 "file:$HOME/.counterparts/store/counterparts.sqlite?mode=ro"`
or the CLI's read commands (`counterparts mechanisms --dir …`, `counterparts doctor --config …`,
`counterparts claims-era --dir …`). Anything heavier runs on a snapshot copy, never the live store.

**How to read by build (since 2026-10-22).** Split a number by the build that wrote the rows instead of by date.
Rows that carry JSON say it at write time: `memories.meta`, every event `payload` that is an object (`recall.decision`,
`dream.*`, `adapter.*`, …), `reflections.detail` and `dream_changes.detail` have `build` (the package version, or
`unknown`); rows written before the stamp have none (NULL). **The stamped field is authoritative**: read it wherever
a row has one. The build log in `meta` has `build.<version>.since` (the lived day that build first opened the store
for writing) and `build.<version>.settings` (tunables set from outside, `[]` on Mike's store), and `counterparts
doctor` prints the build running and the last three logged as its Builds line. Rows with no JSON column (edges,
`belief_support`, `core_events`) can only be joined to the log by lived day, and **that join is approximate**: the
old and the new build share the day one arrives (a row from that day could be either), and the log keeps one row
per version, so a downgrade to a build already logged adds no row and its days read as the newer build's. Trust the
day join only between arrival days, and only when no downgrade happened. For example, footnotes per turn by build:

```sql
SELECT json_extract(payload, '$.build') AS build, COUNT(*) AS turns,
       ROUND(AVG(json_extract(payload, '$.footnoteCount')), 2) AS footnotes_per_turn
FROM events WHERE name = 'recall.decision' GROUP BY build ORDER BY MIN(seq);
```

## Index (updated 2026-10-22)

**Open: being built, or live and waiting for a check**

| Experiment | Started | Check | Section / source |
|---|---|---|---|
| Head wins (#526): the newer memory stands in with the earlier one's bar (or its own); the earlier one is held back whenever a head stands in | 0.3.27, 10-19 | ~2 lived days after install: settled-over memories shown alone → ~0 | `docs/decisions.d/fix-head-wins-gap-1019.md` |
| Association: no links written when a memory is stored (`WRITE_LINK_MAX` 0, was 4); contiguity kept, old ones fade | 0.3.27, 10-19 (#528) | ~2 lived days after install: pointers and links per node from co-use alone; revert if the graph starves | `docs/decisions.d/chore-write-links-slot-flag-1019.md` |
| Slot detector flags only: no provisional fade (`SLOT_FADE` 1, was 0.8); the fade comes with the dream's or the writer's confirmation | 0.3.27, 10-19 (#528) | ~2 lived days after install: proposals' `faded: false`, the dream's same true/false, confirmed ones at the full fade | `docs/decisions.d/chore-write-links-slot-flag-1019.md` |
| The reflection closes open threads that are plainly done (`closeNow`, a why each, said in the share; `reopen` undoes), and still asks about the unsure ones | merged 10-20, unreleased | ~10-24: how many it closed itself (`reflections.detail.selfClosed`, `reflection.finished`'s `selfClosed`) (any folder, by Mike's 10-20 exception) and how many it asked instead, reopened (`closeAskedInstead`; confidential ones too until 10-21), whether any was wrong (`detail.reopened`, `reflection.reopened`), how the wake's Still open count moves from 58; revert by putting back the 10-16 `close` line in the prompt | `docs/decisions.d/feat-reflection-closes-done-threads-1020.md` |
| Personal news flows across folders: the reflection is offered 24 unmarked memories a night (was 5), the personal-looking first, and marks the personal ones owner or us; the `about` field says what a mark does | in review 10-20, unreleased | ~10-24: how many it marked owner/us, any Mike reverses, whether personal news reaches other folders | "Due ~2026-10-24 (personal news across folders)" below; `docs/decisions.d/feat-unmarked-personal-marks-1020.md` |
| The nightly writers held to the page's 4,600-byte room: the night's first page past it is sent back to be cut; a second try is kept; one never sent again is kept at the run's end. A page past the room with a short version shows it in the wake | built 10-20, unreleased | ~10-23 (three mornings after install): the page's bytes each morning, `past-room` holds and how each night ended, the wake's `elements=` and the page's rung | "Due ~2026-10-23 (the nightly writers held…)" below; `docs/decisions.d/feat-page-held-to-room-1020.md` |
| Meaning computed in line whenever no fresh cue is ready (#521) | 0.3.27, 10-19 | ~2 lived days after install: share of turns `in-line`, footnote ratings | `docs/decisions.d/fix-first-prompt-meaning-1019.md` |
| Wake polish (#517) + the ~/random session's 10-19 notes (one session named four times, a today-dated item under Still open in another folder's wake, three tags at the top) | 0.3.26, 10-18 | ~10-20 | "Due ~2026-10-20" below |
| Wake without repeats (fix/wake-dedupe-1020): each episode once, no bare ids in Yesterday, ONE tag at the top, about-me line says its folder first, a plain reminder due tomorrow counted at a session start, every Coming up item with its own id, one snapshot a day | in review 10-20, unreleased | the first two mornings after install | "Due ~2 mornings after install (the wake without repeats)" below; `docs/decisions.d/fix-wake-dedupe-1020.md` |
| A weekly reminder done for this week (`status: "done"` at its id closes this occurrence only; F6b: drewOn credits a memory this session replaced) | not released, 10-20 | ~10-27, the next Tuesday | "Due ~2026-10-27" below; `docs/decisions.d/feat-reminder-done-this-week.md` |
| The elsewhere lines name what was written: "Today, elsewhere" and "Since you started" carry up to two memory titles a folder (work in progress first), gated like the chapters, and "Here, also open:" the other live sessions in this folder with theirs, within the same 300 bytes | in review 10-20, unreleased | ~10-23 | "Due ~2026-10-23 (the elsewhere lines' titles)" below; `docs/decisions.d/feat-elsewhere-titles-1020.md` |
| Facts title tail (the next 20 matches as title · id · date lines after the 10 bodies; credits nothing) + soft time words ("lately" ranks recent first, doesn't filter); from the benchmark loss read | in review 10-20, unreleased | ~10-27 on the live store: how often a tail title gets opened, whether the tail is noise | "Due ~2026-10-27 (the facts title tail …)" below; `docs/decisions.d/feat-facts-title-tail-1020.md` |
| Core questions that waited a week: the reflection is offered up to 3 core memories waiting 7+ lived days on keep-or-retire (with their unsettled pair) and decides where it can, said in the share with the way back; the wake leads with one, both labels shown | not released, 10-20 | ~10-27 | "Due ~2026-10-27 (core questions)" below; `docs/decisions.d/feat-core-questions-waited-1020.md` |
| Another project's work faces a slightly higher bar in ambient recall (`CROSS_PROJECT_BAR_LIFT` 1.25; the hard filter `RECALL_BY_PROJECT` built, off) | not released, 10-21 (Mike's "a slightly higher bar, and review after a week") | ~2026-10-29: footnote ratings home vs crossing, ~/counterparts ↔ ~/random apart; `crossProjectLifted` per turn | "Due ~2026-10-29 (a higher bar for another project's work)" below |
| Beliefs shown (wave 2 lane E): the beliefs slot in ambient recall (`recall.BELIEFS_IN_RECALL`), tags as a priming partner source — **priming changed again** (`recall.TAGS_PRIME`), the wake's project line (`self.WAKE_PROJECT_LINE`); plus per-footnote priming flags (`primed.by`, `top`, `tag`) | not released, 10-22 (ships in the first release after the 10-22 read of 0.3.27) | ~2026-10-29, with the cross-project bar and the re-read of the four 0.3.27 experiments | "Due ~2026-10-29 (beliefs shown, and priming changed again)" below |
| Open threads mean someone owes an answer: the narrower `unresolved` text and Stop ask, the Stop ask naming the session's own open items (`STOP_OPEN_MAX` 5), and an untouched ownerless open item no longer carried after `OPEN_CARRY_DAYS` (21) lived days — out of Still open, its count and `staleOpen`; the share says the count once | not released, 10-22 | first look ~2026-10-29; the real check 2026-11-05 | "Due ~2026-10-29 (open threads mean someone owes an answer)" below; `docs/decisions.d/feat-open-threads-carry-1022.md` |
| The dream's fresh intake: the fresh list may cost 16,000 characters (`dream.FRESH_LIST_CHARS`, was 12,000), 4 neighbours a new memory (`dream.NEIGHBOURS`, was 6); 44 → ~64 new memories a night on the 10-22 compare | not released, 10-23 | ~2026-10-29: `dream.begun` queue fresh/waiting/agedOut by build; whether dreams got thinner (whole 20 → 11) | "Due ~2026-10-29 (the dream's fresh intake)" below; `docs/decisions.d/feat-dream-intake-1023.md` |
| The page split by section (`self.PAGE_SPLIT`, N1 part 2): the page writer in its own child first, amending every section but `## Core`; the reflection writes `## Core` alone; kept sentences keep their cites | not released, 10-23 | 3–4 nights after install | "Due 3–4 nights after the page split" below |
| Day's end (the page writer, renamed) reads the day as told: the chapters by their summaries and the 12 strongest memories with ids, citing them (`self.DAYS_END_INPUT`); the reflection's room long view first, `dreamSaw` cut to what the dream changed and 40 older (`dream.REFLECT_ROOM_ORDER`) | not released, 10-23 | 3–4 nights after install | "Due 3–4 nights after day's end" below; `docs/decisions.d/feat-days-end-reflection-room-1023.md` |
| The reflection's core candidates capped at 30 a night, 10 of them rotated through the rest, the rest counted in one line (`REFLECT_TUNABLES.CANDIDATES`, switch `dream.REFLECT_CANDIDATES_CAP`); the per-lane shown counts kept on the reflection's row (`detail.lanes`), which with `chaptersAs` now survive the finish | 0.3.35, 10-24 | 3–4 nights after install, with day's end's check | "Due 3–4 nights after the candidates' cap" below; `docs/decisions.d/feat-reflect-candidates-cap-1024.md` |
| Use credit refuses the memory's writing session on its birth day (`own-write`), not everyone: another session's use credits a newborn memory once that day; unknown/unbound writers keep the birth-day rule (switch `physics.OWN_WRITE_GATE`) | 0.3.35, 10-24 (R2) | ~7 nights after install: promotions and core growth | "Due ~7 nights after own-write" below; `docs/decisions.d/fix-own-write-not-birth-day.md` |
| Consolidation every lived day (`sleep` `CADENCE.consolidate` 1, was 3): the core is decided at every night's sleep, still at most 3 a night (`CORE_MAX_PER_SLEEP`); read with 0.3.35's R2 (own-write), since both feed the core | not released, 10-24 (0.3.36) | ~7 nights after install | "Due ~7 nights after daily consolidation" below; `docs/decisions.d/feat-daily-consolidation.md` |
| Cue learning (R3, store v15 `cue_edges`): the words of a turn that showed a memory, which was then used or rated, wire to it, and a learned pair reads as one more cue (`w × share × CUE_PAIR_UNITS`); switch `physics.CUE_LEARNING` | not released, 10-24 (0.3.36) | ~7 lived days after install | "Due ~7 lived days after cue learning" below; `docs/decisions.d/feat-cue-learning.md` |
| "Today so far here" in a session start's wake (this folder's earlier chapters today, with their summaries; `self.TODAY_SO_FAR`) and the Yesterday line led by day's end's summary behind a privacy gate (`self.YESTERDAY_FROM_SUMMARY`) | not released, 10-24 (W1) | ~5 days after install: mid-day wakes in two folders | "Due ~5 days after Today so far" below; `docs/decisions.d/feat-today-so-far.md` |
| An awake repeat counts (B1): a belief written in the moment that says what one already says is still refused `near-duplicate`, and its memory is filed as support for that belief, at most once per belief per session (unbound: once a lived day); events `schema.support.filed` with `via: awake-duplicate`; switch `schemas.AWAKE_SUPPORT_ON_DUPLICATE` | not released, 10-24 | 3–5 days after the release that carries it | "Due 3–5 days after awake belief support" below; `docs/decisions.d/feat-awake-belief-support.md` |
| An unsettled pair competes (E3): when a turn reaches both members, the older counts at `1 − k·sim·fresh` (k 0.6, cosine over 0.8, 7 lived days) for the loud tier and the order, never admission; the label stays; switch `recall.UNSETTLED_COMPETES` | not released, 10-24 (0.3.36) | ~7 lived days after install | "Due ~7 lived days after unsettled competition" below; `docs/decisions.d/feat-unsettled-competes.md` |
| The unmarked offer on the record (D1, a fix): every reflection row says what it was offered to mark (`detail.unmarked`, an empty list too) and which it marked (`detail.unmarkedMarked`, `counts.unmarkedOffered`/`unmarkedMarked`); the offer keeps its lines when the fixed parts fill the room (with `dream.REFLECT_ROOM_ORDER`) | not released, 10-24 | 3 nights after install | "Due 3 nights after the unmarked offer's record" below |
| The day summary (`self.DAY_SUMMARY`): day's end leaves a few lines about the day on the night's row; the dream opens with it, the reflection sees 21 days as a line a day | not released, 10-23 | 7 nights after install | "Due 7 nights after the day summary" below; `docs/decisions.d/feat-day-summary-1023.md` |
| What a night costs (`usage` on `dream.night`, per child and total), to read the Haiku tag child's real tokens | not released, 10-23 | ~2026-10-27 (reminder mem_8f7e7db449bb) | "Due ~2026-10-27 (what the tag child costs)" below; `docs/decisions.d/feat-night-usage-debug-1023.md` |
| Emotion's weight (about ×11 slower fading at a strong feeling vs ×2.8 designed), kept to watch | 10-18 | 2026-11-01 | "Checked 2026-10-18" below |
| Mood-matched recall re-test, once drewOn gives a signal | 10-11 | when credit flows (after the feedback loop) | "Once drewOn gives a signal" below |
| Forgetting: archiving resumes after 0.3.24 restarted the 14-lived-day wait | 10-14 | ~late October | "Ongoing" below |

**Two follow-ups from the 10-19 overdue checks** (`~/counterparts-notes/2026-10-19-overdue-checks.md`)

| Change | Why | When |
|---|---|---|
| Head wins: hold back a settled-over memory whenever its head was brought in for it (gate.ts ~L452) | 36 footnotes since 10-12 showed an earlier memory while its head didn't (21 ids) | done: #526 |
| Slot detector: a proposal flags only, no provisional fade until the dream confirms | 4 of 7 right by hand-read, under the ~3-in-4 bar; the dream said "not the same" on 3 of 4; raising SLOT_COSINE doesn't separate them | done: #528 (`SLOT_FADE` 1), in 0.3.27 |

**Checked** (kept below for the record): **10-22 the four 0.3.27 reads** (feedback loop builders 1 and 2, stemming, context priming: nothing reverted; two asks for Mike; all re-read ~10-29 with the cross-project bar, see "Checked 2026-10-22" below and `~/counterparts-notes/2026-10-22-0327-read.md`); 10-12 first new-curve pass; 10-14 check-in; 10-18 wake trims, exit at 7
vs 14 days, Group 4 association; **10-19 the five overdue ones**: catch-up cost (1.75x the estimate, caps fine),
reflection/dream child context (peak 127.5k of ~150k, creeping up from 114k: watch), verbatim trial (keep; barely
exercised), Group 2/2b (fine, except head wins and the slot detector above), ongoing (head wins as above; the era's
effect on archives folds into the late-October forgetting check). Details: `~/counterparts-notes/2026-10-19-overdue-checks.md`.

## Due 3–4 nights after the page split (2026-10-23, Mike's go, very lightly held, an experiment — `self.PAGE_SPLIT`)

What: the night writes the page in two lanes instead of two whole-page rewrites. The page writer, in a child of its
own and first, amends every section but `## Core` from the day; the reflection writes `## Core` alone; each held at
the door (what is outside a lane is kept as it stood, and said). A sentence kept word for word keeps its cites.

Look at, per night since install (read-only):
- one writer and one reflection version a night, each touching only its sections:
  `SELECT json_extract(payload,'$.by') AS by, json_extract(payload,'$.laneKept') AS kept, COUNT(*) FROM events
   WHERE name='self.page.revised' AND day >= <install day> GROUP BY 1, 2;`
  (`laneKept` non-null means a write strayed and was held; a few is fine, every night is a prompt to fix);
- `## Lately` current (it names the last few days), `## Core` stable night to night (Mike reads the pages);
- cites kept: `claimsCarried` on the same rows, and the share of page sentences with a cite (5 of 62 on 10-23);
- the dream child's context smaller (its `childUsage`, once logged), the writer child's own cost, and doctor's
  Nightly run line for "the page writer was missed";
- the page's size: the reflection can only cut Core when held past the room.

Changes it: Core drifting or empty, Lately stale, the writer missed most nights, or Mike preferring the old pages.
Revert: `self.PAGE_SPLIT=false` (one switch: the writer back inside the dream's child, both rewriting the whole
page, nothing carried), or revert the PR.

## Due 7 nights after the day summary (2026-10-23, Mike's go 15:32, lightly held — `self.DAY_SUMMARY`)

What: day's end leaves a few lines about the day (600 characters at most) with its closing `self_page` call, on the
night's `self.page.writer.ran` row; the dream's bundle opens with it ("## today, as day's end told it"); the
reflection reads the last 21 days a line a day (a day without one, by its chapters). Replay on the 10-23 corpus: the
dream +~640 characters, the reflection +~5k (4 parts either way, the same memories shown).

Look at, after 7 nights (read-only):
- a summary every night: `SELECT json_extract(payload,'$.about'), json_extract(payload,'$.outcome'),
  length(json_extract(payload,'$.summary')) FROM events WHERE name='self.page.writer.ran' AND
  json_extract(payload,'$.summary') IS NOT NULL ORDER BY seq;` and the dream opened with it:
  `SELECT json_extract(payload,'$.daysEnd') FROM events WHERE name='dream.begun' ORDER BY seq DESC LIMIT 7;`
- read 3 dream journals (`counterparts night show <drm_…>`): do they open from the day summary's framing?
- does the reflection's entry name a pattern across days it could not have seen before (one older than the 3 days of
  chapters)?
- Mike reads.
- ~~the known misread (0.3.34)~~ **fixed in 0.3.35 (#609)**: a summary sent alone and then a page now reads `revised`
  and keeps the summary. For nights on 0.3.34 only, the old reading: a night whose `self.page.writer.ran` row says `nothing-to-say` with a summary,
  followed by a page version from day's end that same night, means it sent the summary alone and then wrote a page
  anyway: the row misreads that night. Count how often: the nights from `SELECT json_extract(payload,'$.about')
  FROM events WHERE name='self.page.writer.ran' AND json_extract(payload,'$.outcome')='nothing-to-say' AND
  json_extract(payload,'$.summary') IS NOT NULL;`, each beside that night's page versions (`counterparts night
  last` / the dashboard's page strip); a few is the prompt's slip, many is a fix.

Changes it: journals that only echo the summary, a reflection that reads the timeline as instructions, summaries
past the cap night after night. Revert: `self.DAY_SUMMARY=false` (no summary asked for or kept; the dream's and the
reflection's bundles exactly as before), or revert the PR.

## Due 3–4 nights after day's end (2026-10-23, Mike's go 15:32, lightly held — `self.DAYS_END_INPUT`, `dream.REFLECT_ROOM_ORDER`)

What: the page writer is called day's end and reads the day as told (each chapter of the day by its summary, with
its address; the day's 12 strongest memories with ids, which Lately may cite). The reflection's room is filled long
view first: the page, its last reflections and the dream's own summary; the whole core, the candidates (every one
until 0.3.35's cap: 30 a night since) and the 10 most felt, a line each at least; the last 3 days' chapters by their summaries; what the dream changed and at most
40 older memories it saw (tonight's new ones only in `recent`); then the rest. Replay on 10-22/10-23: shownAs went
from 0 core / 0 candidates (lined 75, all chapter lines) to every core memory and candidate lined, at 89–92k a night
across 4 parts (was ~105k).

Look at, per night since install (read-only):
- the reflection showed the long view every night, core, candidates and felt each shown (0.3.34's release check:
  the shownAs on a copy): `reflections.detail` `fit` (`lined` and `whole` ≥ core +
  candidates) and `chaptersAs = 'summaries'`. Until 0.3.35 a finish dropped `chaptersAs`, so this finds only begun
  rows on 0.3.34; from 0.3.35 a finished row keeps it, with the lanes shown (`detail.lanes`):
  `SELECT date, state, json_extract(detail,'$.lanes'), json_extract(detail,'$.fit') FROM reflections WHERE json_extract(detail,'$.chaptersAs')='summaries';`
- Lately reads as the day, and cites: the page's trace (`counterparts doctor`'s "Self page claims" line, claims with
  no memory behind them falling from 57 of 62);
- one page version per child per night (with the page split's check above);
- Mike reads the pages.

Changes it: Core or the reflection's entries getting worse without the chapters' words (it can recall a chapter by
its address: count recalls of `epi_…#N` in the reflection child), Lately thinner, or a night's parts going past 4.
Revert: `dream.REFLECT_ROOM_ORDER=false` and/or `self.DAYS_END_INPUT=false` (each puts back exactly what was), or
revert the PR. The name stays either way.

## Due 3–4 nights after the candidates' cap (2026-10-24, R1, Mike's go 10:58, lightly held — `dream.REFLECT_CANDIDATES_CAP`)

What: the reflection is shown at most 30 core candidates a night (`REFLECT_TUNABLES.CANDIDATES`): the 20 strongest
felt and newest, and 10 rotated through the rest, the least recently shown first (by the `shown` of the last 30
reflections), so every candidate still comes round to be cited, felt and marked — the reflection's cites and feelings
are the core lanes' strongest feed. The rest are one line, "+N more candidates, not shown". Replay on the 10-24
corpus (composition only): candidates 132 → 30, their lines ~29.3k → ~8.6k, the bundle 85.1k in 4 parts → 73.6k in 3.

Look at, per night since install (read-only):
- the counts every finished reflection keeps — core, candidates, felt shown and the candidates not shown:
  `SELECT date, state, json_extract(detail,'$.lanes.core') AS core, json_extract(detail,'$.lanes.candidates') AS candidates, json_extract(detail,'$.lanes.felt') AS felt, json_extract(detail,'$.lanes.candidatesNotShown') AS not_shown, json_extract(detail,'$.fit.parts') AS parts FROM reflections WHERE json_extract(detail,'$.lanes') IS NOT NULL ORDER BY started_at;`
  candidates 30 while there are more than 30, not_shown about the backlog less 30, parts 3 where they were 4;
- promotions keep coming (`core_events` `promoted` by day), from the tail as well as the head: a candidate promoted
  that was outside the night's first 20 says the rotation works.
- the felt lane: the cut candidates join its pool (replay: felt of 24 → 50). Do its 10 slots fill with candidates the
  cap cut instead of the other felt memories (people, moments)? `lanes.feltFromCut` counts the felt shown that were
  cut candidates (recorded from 0.3.35's fix to this lane; absent on rows before it):
  `SELECT date, state, json_extract(detail,'$.lanes.felt') AS felt, json_extract(detail,'$.lanes.feltFromCut') AS felt_from_cut FROM reflections WHERE json_extract(detail,'$.lanes.feltFromCut') IS NOT NULL ORDER BY started_at;`
  a night or two at 0–3 of 10 is the pool doing its job; most nights at 7+ of 10 means felt has become a second
  candidates lane, and `feltAll` should filter on every candidate, not the capped ones.

Changes it: the core stops growing, or the reflection's entries or the page lose a thread they used to carry from an
older candidate. Revert: `dream.REFLECT_CANDIDATES_CAP=false` (every candidate, exactly as before; the lane counts
are still kept), or revert the PR.

## Due 3 nights after the unmarked offer's record (2026-10-24, D1, a fix — no switch of its own)

What: from 10-10 to 10-23 no reflection row recorded `detail.unmarked`. On a night with a dream the fixed parts (the
dream's saw list, the chapters, the page) took the whole room, the offer's reserve was bounded by what was left (0),
every offered id waited and was dropped, and an empty offer wrote no key. 0.3.34's room order (`dream.REFLECT_ROOM_ORDER`)
already shrank the fixed parts; this fix holds the offer's lines back like the long view's, whatever the room, and
always records it: `detail.unmarked` (the ids offered, `[]` too), `detail.unmarkedMarked` (the offered ids it marked,
across finishes), and `counts.unmarkedOffered` / `counts.unmarkedMarked`. The 10-24 night (0.3.35) may already show
an offer; the "every row has the key" check starts at the first night of the release that carries this.

Look at, per night since install (read-only):
- every reflection row has the key, and how many it was offered and marked:
  `SELECT date, state, json_type(detail,'$.unmarked') AS has_key, json_array_length(detail,'$.unmarked') AS offered, json_array_length(detail,'$.unmarkedMarked') AS marked, json_extract(detail,'$.counts.unmarkedOffered') AS c_offered, json_extract(detail,'$.counts.unmarkedMarked') AS c_marked, json_extract(detail,'$.build') AS build FROM reflections ORDER BY started_at DESC LIMIT 7;`
  `has_key` should read `array` on every row from the release on (a begun, unfinished row too);
- the marks themselves, per night, and where they went:
  `SELECT r.date, m.about, COUNT(*) FROM reflections r, json_each(r.detail,'$.unmarkedMarked') j JOIN memories m ON m.id = j.value GROUP BY r.date, m.about ORDER BY r.date;`
- the pool: `SELECT COUNT(*) FROM memories WHERE type='memory' AND archived=0 AND about IS NULL AND kind IN ('fact','entity','place','skill') AND origin_scope LIKE '/%' AND COALESCE(source,'') NOT IN ('dreamed','reflection');`
  (about 13 on the 10-24 copy, after Mike's 10-21 hand pass).

Changes it: `offered` 0 on a night the pool is not empty means the offer is filtered before the fit — first suspect
the folder setting (`server.ts#folderOn` answers "off" for every folder when the scopes file will not read, which
drops every candidate, all of which carry a directory scope). Marked 0 for three nights with a pool says the prompt
line is ignored, not lost: read an entry's `about` part. Revert: the record is a record; the room change goes with
`dream.REFLECT_ROOM_ORDER=false` (#383's bound, as before), or revert the PR.

## Due ~7 nights after own-write (2026-10-24, R2, Mike's go, lightly held — `physics.OWN_WRITE_GATE`)

What: use credit refuses the session that wrote a memory on its birth day (`own-write`), not every session. Another
session that draws on a newborn memory credits it once that day (0.1, a glimpse); unknown or unbound writers ("mcp",
a null origin) keep the old birth-day rule, and a return on the birth day is still refused for everyone. With
parallel sessions, new memories will now routinely get a reinforced day at birth, which feeds promotion.

Look at, over ~7 nights since install (read-only):
- promotions by day (`core_events` `promoted`) and the core's size, against the week before: a clear jump with no
  change in what is written says birth-day credit is pushing memories through;
- how many memories got a use on their birth day from another session, and whether they are the ones being promoted.

Changes it: core growth that outruns the reflection's capacity to read it, or promotions of memories that were only
glimpsed. Revert: `physics.OWN_WRITE_GATE=false` (exactly as before), or revert the PR.

## Due ~7 nights after daily consolidation (2026-10-24, E1, Mike's go 14:19, lightly held — `sleep` `CADENCE.consolidate`)

What: the consolidate phase, which decides the core, runs at every lived day's sleep instead of every third. The only
reason given for 3 was v0's "every 3 days"; eligibility is arithmetic over rows written in real time, so waiting
gained nothing. The cap stays at 3 a night (`CORE_MAX_PER_SLEEP`), now literally per night. Replay on the 10-24
corpus: the same 12 core at the end and the same 12 promotions, landing earlier (the first three on day 8, not day
10); at most 3 on any night (day 8: 3, day 9: 2). On the live record the last
consolidation (lived day 31) had nothing waiting at the cap, so the first daily night should promote 0–3, not a burst.

Read it together with R2's own-write entry (0.3.35: a memory can be credited the day it was written by any session
but the writer's, so a newborn can earn a reinforced day at birth). R2's entry is just above; both
feed the core, so split the nights by build: R2 alone from 0.3.35's arrival day, both from 0.3.36's (`meta`
`build.<version>.since`; `counterparts doctor`'s Builds line).

Look at, per night since install (read-only):
- promotions per lived day, by lane: `SELECT day, COUNT(*) AS promoted, GROUP_CONCAT(lane) AS lanes FROM core_events WHERE action = 'promoted' GROUP BY day ORDER BY day DESC LIMIT 14;`
  expect 0–3 most nights, where it was 0–3 every third night (live, lived days 10 → 31: 3, 3, 3, 3, 2, 1, 0, 1);
- the consolidate pass every night, and what waited at the cap: `SELECT e.day, json_extract(e.payload,'$.promoted') AS promoted, json_extract(c.value,'$.skipped."promotion:cap"') AS cap_waiting, json_extract(c.value,'$.status') AS status FROM events e, json_each(e.payload,'$.phases') c WHERE e.name = 'sleep.cycle' AND json_extract(c.value,'$.phase') = 'consolidate' AND json_extract(c.value,'$.status') LIKE 'ran%' ORDER BY e.seq DESC LIMIT 14;`
  one `ran` / `ran-nothing-found` row per lived day; `cap_waiting` empty or small;
- the core's size (`counterparts core`, or the dashboard's Self page) against 0.3.35's.

What would change it: a core growing faster than ~3 a week for more than a week, or promotions Mike reads as wrong
(a memory demoted soon after). Revert: `CADENCE.consolidate` back to 3 in `src/core/sleep/tunables.ts` (one number;
the dashboard and mechanisms read it).


## Due ~7 lived days after cue learning (2026-10-24, R3, Mike's go 14:01, ships on its own store bump — `physics.CUE_LEARNING`)

What: a credited use or a rating of a shown memory wires that turn's index words to it (`cue_edges`: token, memory_id,
weight, last_day, source); a learned pair then reads as one more cue at the word's share of the turn, so a bare word
can bring its memory back loud after a few credited uses (the ping → pong demo: 4th → 1st loud after 3 credits in the
test). Bounded per pair (`CUE_W_CAP` 1), per word (`CUE_MAX_OUT` 1.5), fading with lived days (`S_CUE` 60). Only words
already in the word index are learned; an owner erase deletes the memory's pairs.

Look at (read-only):
- growth and shape: `SELECT COUNT(*) AS pairs, COUNT(DISTINCT token) AS words, COUNT(DISTINCT memory_id) AS memories, ROUND(MAX(weight),2) AS top, ROUND(AVG(weight),3) AS mean FROM cue_edges;`
  and the strongest: `SELECT token, memory_id, ROUND(weight,2), source, last_day FROM cue_edges ORDER BY weight DESC LIMIT 20;`
  expect a few hundred pairs a week, a handful near the cap; a token with dozens of memories means a common word slipped through;
- the demo, live: a bare "ping" in a fresh session brings the ping memory back first and loud;
- footnote ratings (noise vs useful, mem_2d998d1c230c baseline 47% / 18%) by build, from `recall.rated`: learned pairs
  should not raise noise.

Not stored: how many memories a learned pair reached each turn (`learned` on the activation stats is reported, not
recorded), so whether a footnote came by a learned pair can't be read from the store yet; adding it to
`recall.decision` is a follow-up if the check needs it.

Changes it: noise rising, a common word wiring to many memories, or a memory Mike reads as wrong surfacing by a learned
word. Revert: `physics.CUE_LEARNING=false` (nothing recorded, trained or read; the table stays), or revert the PR.

## Due ~5 days after Today so far (2026-10-24, W1, Mike's go 17:45, lightly held — `self.TODAY_SO_FAR`, `self.YESTERDAY_FROM_SUMMARY`)

What: at a session start the wake carries "Today so far here:" under the Yesterday line: today's chapters written in
this folder before the one "Last here" names (newest 4, each by time, title, id and its summary's first sentence cut
at 120 bytes), and "Last here" no longer lists them as "Before it" / "+N more". The Yesterday line opens "Yesterday,
in day's end's words:" with day's end's summary when (a) every memory it cites is nameable in this wake, (b) every
chapter that day is from this folder or a scope-on folder, and (c) every folder that wrote a memory that day is too
— archived and merged rows included, a memory lived that day included wherever it was written up, and a row with no
folder failing it (review of #614). Otherwise the old chapter list. Corpus replay (10-24 corpus, 15:00 on 10-23, every folder's scope on): ~/counterparts
8,799 → 8,941 bytes, ~/counterparts-phone 8,628 → 8,673; the new line cost 3 "Still open" items in each (Still open
keeps its first item and its count); start time within noise (numbers in the PR). W1b (10-24, Mike 21:11, lightly
held): the summaries now step down to titles before "Still open" drops an item — on the same replay Still open keeps
2 items instead of 1 in both folders, and "Today so far" shows titles only.

The wake writes no row, so read it where it lands (read-only):
- two or three mid-day session starts, one in ~/counterparts and one in another folder: the SessionStart context in
  each transcript. Each chapter named once; "Today so far" ≠ "Today, elsewhere"; nothing from a scope-off folder;
- whether the summary ever shows. Day's end's summaries: `SELECT json_extract(payload,'$.about') AS about, json_array_length(json_extract(payload,'$.summaryCites')) AS cites FROM events WHERE name = 'self.page.writer.ran' AND json_extract(payload,'$.summary') IS NOT NULL ORDER BY seq DESC LIMIT 7;`
  then replay the next morning's wake on a copy of a nightly snapshot in a temp dir (never the live store) to see which
  gate held it back. Expect it to fall back on days with work in a scope-off folder, or with a cited work memory from
  another folder (only about-me cites cross);
- whether the Still-open items it costs in a full wake are missed (Mike's read; since W1b it gives up its summaries
  first, and its titles still cost Still open past its first item), and whether the summaries are missed when they go.

Changes it: the summary almost never showing (then the gate's cite rule is what to revisit with Mike, not the
chapter/folder rules), a repeat across lanes, or Still open losing items Mike wanted. Revert: either switch false
(both false: the wake byte for byte as before), or revert the PR.

## Due 3–5 days after awake belief support (2026-10-24, B1, Mike's yes 18:04, lightly held — `schemas.AWAKE_SUPPORT_ON_DUPLICATE`)

What: a session's belief that says what an existing belief says used to file nothing (review of #583: eight repeats
had pumped one belief to 8 in a session). Now its memory counts as support for that belief, once per belief per
session (the memory's `origin_session`; any support row from that session counts, the birth's included). An unbound
session (`mcp`) falls back to once a lived day. Physics' spread still discounts a second session the same day (×0.5).

Look at, per lived day since install (read-only). The awake door keeps its own row, `belief.support.awake` (`ref` the
belief; payload memoryId, session, `filed` with route and weight, or `filed: false` with `reason`); `belief_support`
holds every filing, the reflection's included:
- awake filings and held repeats a day: `SELECT day, SUM(json_extract(payload,'$.filed')) AS filed, SUM(json_extract(payload,'$.filed') = 0) AS held, GROUP_CONCAT(DISTINCT json_extract(payload,'$.reason')) AS why_held FROM events WHERE name = 'belief.support.awake' GROUP BY day ORDER BY day DESC LIMIT 10;`
  against all filings that day: `SELECT day, COUNT(*) AS filed FROM belief_support GROUP BY day ORDER BY day DESC LIMIT 10;`
  (all minus awake = the reflection's plus a session birth's first support);
- any belief whose support rose by more than one awake filing in a day: `SELECT day, ref AS belief, COUNT(*) AS n, GROUP_CONCAT(json_extract(payload,'$.session')) AS sessions, GROUP_CONCAT(ROUND(json_extract(payload,'$.weight'),2)) AS weights FROM events WHERE name = 'belief.support.awake' AND json_extract(payload,'$.filed') = 1 GROUP BY day, ref HAVING n > 1 ORDER BY n DESC;`
  expect a few, each from a different session, the later ones at the same-day weight (×0.5); many from one session, or
  a null session more than once a day, is a bug;
- did an awake-filed belief cross a core or page threshold sooner than it would have: for each belief above, its rows
  (`SELECT memory_id, route, day, ROUND(weight,2) FROM belief_support WHERE belief_id = ? ORDER BY day`) and whether it
  reached the page or the core in those days; its support without the awake rows is what it would have had.

What would change it: one belief climbing by several awake filings a day for days (sessions repeating a
belief instead of noticing new things), or a belief reaching the page on awake repeats alone. Revert:
`schemas.AWAKE_SUPPORT_ON_DUPLICATE=false` (the old reply, nothing filed; rows already filed stay, counted), or revert
the PR. Step 2 of B1 (`supports:` on remember) is briefed from these numbers.

## Due ~7 lived days after unsettled competition (2026-10-24, E3, Mike's go 14:47, lightly held — `recall.UNSETTLED_COMPETES`)

What: when a turn reaches both members of a standing unsettled pair (the slot detector's "newer state of" proposal, or
a dream's unsettled flag), the older one, already labelled "Unsettled — may be out of date", counts at
`activation × (1 − k · sim · fresh)` for the loud tier and the order, never for admission: the newer wins a close race,
the older still shows, labelled, when there's room. k 0.6; `sim` = cosine over 0.8, over 0.2; `fresh` falls to 0 over 7
lived days. Only a newer past the absolute floor presses. Replay on the 10-24 corpus: in the 8 proposals' windows (≤ 1
lived day each) 322 turns ran and none showed both members; the 3 the dream undid had 50 turns and neither member
shown. So expect it to fire rarely: a same-day turn about something just rewritten.

Look at (read-only):
- how often it fires: `SELECT COUNT(*) AS turns, SUM(json_extract(payload,'$.pairsCompeted') > 0) AS competed FROM events WHERE name = 'recall.decision' AND json_extract(payload,'$.pairsCompeted') IS NOT NULL;`
- the olders it weighed that still showed, with their newer and weight: `SELECT e.day, json_extract(f.value,'$.id') AS older, json_extract(f.value,'$.competed.with') AS newer, json_extract(f.value,'$.competed.factor') AS factor FROM events e, json_each(e.payload,'$.footnotes') f WHERE e.name = 'recall.decision' AND json_extract(f.value,'$.competed') IS NOT NULL ORDER BY e.seq DESC LIMIT 20;`
  (and the same over `$.surfaced`);
- the cost side: for pairs the dream WITHDREW since install (`SELECT pair_id, day FROM contradiction_settles WHERE action = 'withdraw' AND actor = 'dream'`),
  any turn above with that pair's older — a wrong newer that won a race; Mike reads whether any mattered.

Not stored: an older the weight pushed out of a full tier (`capped`) appears only in the count, not by id.

Changes it: Mike reading a true memory pushed below a wrong "newer" more than once a week, or an outdated fact still shown
first beside its newer. Revert: `recall.UNSETTLED_COMPETES=false` in `src/core/recall/tunables.ts` (nothing read; the
turn and its row exactly as before), or revert the PR.

## Due ~2026-10-27 (what the tag child costs, 2026-10-23 — docs/decisions.d/feat-night-usage-debug-1023.md; reminder mem_8f7e7db449bb)

What: every night's `dream.night` row now carries `usage`: each child's tokens from its own `result` line and the
total. Read the tag child's real tokens over the nights since install, and the writer's and the dream's beside it:

```sql
SELECT json_extract(payload,'$.date') AS date,
       json_extract(payload,'$.usage.tags.input') + json_extract(payload,'$.usage.tags.output')
         + json_extract(payload,'$.usage.tags.cacheRead') + json_extract(payload,'$.usage.tags.cacheCreate') AS tags_tokens,
       json_extract(payload,'$.usage.writer') AS writer, json_extract(payload,'$.usage.dream') AS dream,
       json_extract(payload,'$.usage.total') AS total
FROM events WHERE name = 'dream.night' AND json_extract(payload,'$.usage') IS NOT NULL ORDER BY seq;
```

`counterparts night` prints the latest night's total; doctor's Nightly run line too. Changes it: the tag child far
past ~60–80k tokens a night → raise turning it off (`schemas.TAGS_NIGHT=false`). A child's `null` means it said no
usage (stopped mid-stream); many of those is its own question. Revert of the record itself: revert the PR (nothing
reads `usage` but the two lines above).

## Checked 2026-10-12 (lived day 21, the first new-curve pass, on 0.3.18)

All four entries due today were read on the live store (read-only) after the 00:19 night run. Nothing here
changes a decision.

- **The new curve ran.** `decay.curve` is present (power-law, era on, `eraReads` 2). At 08:30, 29 live rows had
  a NULL next-change day. 28 had been touched since the pass (written on day 21, a return or a dream on day 21,
  or a new feeling; the feelings triggers clear it too). One, mem_a11cc5968ef4 (last return and dream on day
  18), shows no touch I could find; a small open question, not a fault, because NULL only means "look again at
  the next pass" (the pass selects NULL or due rows), so nothing goes unexamined.
- **Below reach: 233** (`counterparts mechanisms`), against ~230 predicted on the copy. The 10-11 live 56 was
  the old curve's ranking; the reader is fine.
- **Dated memories archived on the first pass: none.**
- **Personal memories below reach after 0.3.18: 4, none at the old 0.25 default.** The 18 old-default
  owner/us memories the copy predicted are back in reach (#395 applies). The 4 below hold explicit low claims
  (three "me" at 0.30, one owner at 0.20: Mike typing ';exit'), which the era keeps as claimed.
- The era reads 591 old memories at today's default (485 lower, 106 higher).

## Due 2026-10-14 (the check-in, reminder mem_8a53c5d0bc95)

### The tax deadline shows under Arriving on 10-13 and 10-14
- **Look at:** the wake in a session on the morning of 10-13 and of 10-14: "Arriving:" lists the
  Oct-15 tax deadline (a plain reminder).
- **Why:** two quiet items due 10-14 took both of Arriving's lines from it (found by the 0.3.17
  release check); Arriving now ranks plain reminders first, then nearest date (IMPROVEMENTS,
  "Decided by random-06, 2026-10-11").
- **Changes a decision if:** it is still missing → the cap needs to grow, not just reorder.

### Decision 1: faded matches crowding fresh ones in facts recall
- **Look at:** a few real facts-mode recalls on the live store (Mike's normal questions); count how often a
  faded match ranks above a fresh one that answered the question better.
- **Why:** Decision 1 (kept, Mike 10-11) ranks faded matches inline with bodies, for the benchmark's counting
  questions. Mike: be cautious about changing the core app to fit the benchmark.
- **Changes a decision if:** faded matches visibly crowd fresh ones → switch to the fallback variant (a″), a
  mild fade-scaled penalty on the order only (IMPROVEMENTS item 1).

### The rest of the Decisions list
- **Look at:** items 4, 5, 6, 8 (kept 10-11, lightly held) with the first lived days of data: the in-reach
  curve over days 21–23, which memories left reach, whether any core or owner/us memory moved.
- **Changes a decision if:** a memory Mike would miss left reach, or routine work notes are still in reach
  after ~3 lived days.

## Checked 2026-10-22 (lived day 31, on 0.3.30: 0.3.27's experiments two lived days after the 10-19 install)

Read-only on the live store (sqlite `?mode=ro`, doctor, probe-oq4, mechanisms). The two lived days were heavy build
days (372 and 317 memories written against ~100 a day the week before; ~430 recall turns a day, many from
background agents), which colours every per-turn number. Full read with the per-day tables:
`~/counterparts-notes/2026-10-22-0327-read.md`. **Nothing reverted.**

- **Ratings (probe-oq4):** noise 43% / useful 19% on 10-20, 47% / 22% on 10-21, against 47% / 18% before. No
  direction yet; no jump toward 2–3 right after install. Coverage 85% of ambient showings.
- **Builder 1, A credits:** ~40% of rated showings now credit something (was ~3%): 7 days, 179 uses credited (32
  glimpses, 109 rated 1, 37 rated 2, 1 rated 3), 242 not (mostly birth-day). drewOn named 7–9 a day, never at the cap
  of 3 in a call. The one core promotion since install (mem_8412e26dc04e, cards form from strength) was earned
  awake (rated 3 after an expansion, then drewOn + 3), not by glimpses; no never-used ruling crossed. Below reach
  1,145 (753 on 10-18): up, with writes tripled, so glimpses aren't keeping noise alive at the population level.
- **Builder 1, B links — the trigger is met, kept on purpose:** the graph's first signal ever: 6 quiet pointers
  shown in two days (none in ~9,500 links before 10-19), 1 later expanded, **5 of 5 rated were 0**. 45 links at or
  above 0.40. Four memories sit at the 4.0 outgoing bound, all Reddit memories, nearly all of it co-use weight since
  10-19. Mike's 10-19 call was "error on too strong, so we can see what it looks like": this is what it looks
  like, so the cap/deposit change is his call (asked 10-22). Link-primed footnotes were rated 20% noise against 45%
  (n 40). Support measure keeps its links column.
- **Builder 1, D habituation:** 97 habituated now, 23 got through anyway; 3 were later rated 2–3 while habituated,
  none twice; a dozen hand-read are stale work notes. Kept.
- **Builder 2:** C echo skip removed 87 and 139 showings a day (of ~400), nothing recorded as missed; E the dream
  replays 20 `today` memories a night (11 dreamed), `replayed` 8→25; `waiting` 374→610 tracks writes a day tripling
  with intake flat at 44–46, not the replay; F holds by time window (no session but the parent had a recall row
  inside the 10-20/21/22 nights) — the store holds no child session id, follow-up in WORKLIST.
- **Stemming (#529):** re-stem landed (terms = light-1). Items shown per turn fell from 1.4–2.0 to 0.85–0.94 (1.15
  with echo-skipped showings added back): the revert trigger as written, but four changes landed together and the
  turns were agent-heavy; ratings did not fall. Not reverted; re-read ~10-29; Mike asked whether his own opening
  questions found what he meant.
- **Context priming (#530):** 250 and 228 primed showings a day, 63 and 56 lifted past the bar (train mostly, link
  25–32), a lift on ~11% of turns. Rated: neither 45% noise / 17% useful (n 455), train 45% / 21% (328), link 20% /
  22% (40). Longest same-source run across turns: 2. Gap: `lifted` is a per-turn count, not a per-footnote flag, so
  lifted ones can't be rated (handed to the TAGS_PRIME lane).
- Page writer: the restored "grows out of many ordinary memories" line survived into page v51, reworded. Lists in
  bodies (10-15 decision): no non-chapter body over 3 KB since; keep holds.
- **Re-read all four ~2026-10-29**, with the cross-project bar's check.

## Checked 2026-10-18 (lived day 27, on 0.3.25)

These were read on the live store (read-only) and on a copy of that morning's snapshot, after the 10-18 night run (drm_5984d5ba350a, rfl_6192bae891bc). None of it changes a decision. One result, emotion, is for Mike to look at.

- **Wake trims, elements and bytes.** The morning wake in ~/counterparts was `elements=6 bytes=8857`, against `elements=3 bytes=8885` on 10-16. So the room went to the lists once the page fit (the copy predicted 4 → 9).
- **Wake trims, the page writer.** Page v38 is 4,504 B, under the 4,600 target. The first night after the trims (10-17) overshot at 4,928 B with no short version. The second night hit it.
- **Wake trims, a due item missed.** Nothing due 10-16..10-18 was missed. Doctor's "counted, not listed" newest is 10-16, so there has been none since 0.3.25 was installed. The vote reminders were closed on 10-15 (Mike voted 10-14). Today's 3 overdue ids are old planned items (10-11, 10-15, 10-16); the next one is the weekly backup reminder (10-20). Still open: "Still open" leads with a 09-26 item marked "may be out of date". That needs a resolution prompt, not more trims (random-6c's 10-17 item 1).
- **Emotion, felt vs unfelt (mem_af0111512110).** For the 176 felt, non-core live memories, take the same memory with its feeling removed and compare. Stability ratio (median): I < 0.4 ×3.3, I 0.4–0.6 ×7.4, I 0.6–0.8 ×11, I ≥ 0.8 ×25. Lived days in reach: ×3.7, ×8.4, ×14, ×38. Height ratio is only ×1.1–1.3. Review 02's target was ×2.8 at I = 0.6 and ×3.7 at 0.9. The curve gives `exp(STABILITY_GAIN · EMO_Q · I)` = `exp(4·I)`, about ×11 at 0.6, so feeling now does about 4× what was asked. In practice: memories born on the new curve (day 21+) are 100% in reach when felt (31) and 67% when unfelt (526). The felt ones are mostly me/us/owner (119 of 176). The 31 felt work memories are milestones, not routine notes. **For Mike:** keep it, or bring `EMO_Q` down toward ~0.2 (×3.3 at 0.6) to match the target.
- **Era fix + the 14-day wait (mem_fb50024ddae2).** 753 live memories are below reach, against 233 on 10-12; the era scale-down of 10-14 lowered more of them. 519 of the 753 are work and 209 have no mark. 21 are me/us/owner: done reminders (taxes, votes), two dream gists, a few notes about how Mike works, and Mike typing ';exit'. A possible miss is mem_44a87ca1f96c (Careless People: summaries first). Deliberate recall still finds all of them. **Prune exits since 10-13: none** (one `pruned` on 10-13, before the wait), so the wait holds. Footnote ratings (0–3, 206 rated): old pre-era memories average 0.47 (63% rated 0), new ones 0.81 (40% rated 0). The old ones still being shown are mostly unhelpful, which supports the era.
- **Item 6, exit at 7 vs 14 (dry run on the copy, `runPrune` under observer).** Only 20 live memories are under the prune floor at all. With the wait reset by the curve change, 0 would be archived at either 7 or 14. On the curve alone (wait reset ignored), 2 at both, and **0 differ**. The number of days doesn't matter yet; the floor's height decides it (753 below reach, 20 under the floor). Look again at lived day ~40.

## Due 2026-10-18 (the wake trims, 2026-10-16, lightly held — docs/decisions.d/wake-trims-1016.md) — checked 2026-10-18, above

Two days after they are installed, on the owner's session-start wakes (read-only).

### The wake's elements and bytes
- **Look at:** the end tag of a morning wake (`<!-- counterparts:wake/end … elements=N bytes=M -->`)
  and the lines above it: how many items "Still open", "Might be relevant" and "Coming up" list,
  and what is only counted. 10-16 before: `elements=3 bytes=8885`.
- **Why:** the trims (one tag line, the date once, a shorter header, craft out, "Coming up" =
  today, a page target of 4,600) were for room for the lists; a copy of the store measured 4 with
  today's page and 9 with a page at 4,600.
- **Changes a decision if:** elements stays near 3–4 after the page is rewritten → the room is
  going elsewhere ("Work here", the handoffs), and the order in `ROOM_ORDER` is the next question,
  not more trims.

### Whether the page writer hit ~4,600
- **Look at:** the page's size (`counterparts self-page`, doctor's Self page line) after the 10-16
  and 10-17 nights, and its "## How I work" section.
- **Why:** the writer is told to aim under 4,600 and to keep "How I work" to short general
  lessons without dated examples.
- **Changes a decision if:** still well over 4,600, or it lost something Mike misses → the
  target goes back toward 5,750 (`PAGE_ROOM_BYTES`), or the instruction is reworded.

### Whether a due item was missed
- **Look at:** reminders and dated items due 10-16..10-18: each was under "Coming up" on its day
  (or said plainly under the clock for a plain one), and a later one showed as a footnote around
  its date; doctor's Wake line for a dated item counted, not listed.
- **Why:** "Coming up" now lists only what is due today; the rest — overdue and later — is a
  count with ids, the overdue named as such.
- **Changes a decision if:** anything due was missed, or an overdue item counted rather than
  listed was let slip → list the overdue again (after today's, or the first N), or
  `COMING_UP_TODAY_ONLY` off.

## Due at lived day 27 (7 lived days after the new curve's first pass) — checked 2026-10-18, above

### Item 6: exit at 7 instead of 14 — a dry run
- **Look at:** on a SNAPSHOT COPY, run the prune's eligibility with `D_FLOOR_DAYS` = 7 (read-only: compute,
  don't archive) and list what WOULD be archived, against what 14 archives.
- **Why:** Mike wants a faster read on whether exit at 14 is right (item 6, kept 10-11).
- **Changes a decision if:** the 7-day list holds nothing he'd miss → consider 7; if it holds things he'd miss,
  14 stays (or the curve is too steep for those kinds).
- **How:** there's no CLI for it yet; a short script on the copy using `physics` + `sleep/prune.ts`'s
  eligibility with the constant overridden. Ask the coordinator for a lane if it's needed.

## Once drewOn gives a signal (≥ ~5 lived days after it ships)

### Item 9: mood-matched recall re-test
- **Look at:** with `drewOn` and opens as the use signal, compare how often memories lifted by a matching mood
  are used vs not lifted (the 10-10 evidence was 1.3% vs 2.4% on the old use metric).
- **Changes a decision if:** mood-lifted memories are used as often or more → turn the mood weights back up
  (code kept, weights 0).
- **Also look at:** doctor's Credit line's 7-day `drewOn` count. Zero after a week means the field isn't being
  used, which is a prompt problem, not a mechanism result.

## Due ~2026-10-20, two days after it is installed (the wake polish, 2026-10-18, lightly held — docs/decisions.d/feat-wake-polish-1018.md)

On the owner's session-start wakes in ~/counterparts and ~/random (read-only).

### "Still open" shows this week's items
- **Look at:** the items under "Still open" and the count line under them. The plain items
  should be ones born or used in the last two weeks; the count line should read
  `(N more still open, M untouched for 2+ weeks; …)`. M won't match #489 D's nightly close
  offer: that one looks from 4 lived days and offers at most 5 a night. Watch M fall as its
  closes land.
- **Why:** the old order (oldest-opened first) led every wake with the same three-week-old
  questions (random-6c, 10-17).
- **Changes a decision if:** the shown items are recent but noise (the old ones were the
  live ones) → the stale days are too short, or "touched" should count a wake showing; or M
  stays large for days while the close offers keep landing → the wake should say more than
  a count, which is #489 D's to answer.

### The handoff block reads at a glance
- **Look at:** "Where the work in this directory was left off". A stale handoff says
  `N days old; since then: …` in one parenthesis; when every listed one is stale, only one is
  listed and the rest are `+N older here: ids`.
- **Changes a decision if:** a session works from a stale handoff it should have read past,
  or misses an older handoff it needed because only one was listed → list two when all are
  stale.

### Yesterday names folders
- **Look at:** the Yesterday line in ~/random: `…; and 2 sessions in ~/counterparts`.
- **Changes a decision if:** a folder Mike keeps apart shows up there → the gate is not the
  one the "Today, elsewhere" line uses, and it is a bug.

### Went in after this check (2026-10-20, fix/wake-dedupe-1020)
The 10-20 reads of this section's wakes found repeats, bare ids and three tags; those went
into the change below, which has its own section.

## Due ~2 mornings after install (the wake without repeats, 2026-10-20, lightly held — docs/decisions.d/fix-wake-dedupe-1020.md)

On the owner's session-start wakes in ~/counterparts and ~/random (read-only), and the
snapshots folder.

- **Look at:** every `epi_…` id in the wake. Each should appear once: "Last here" names the
  newest chapter written in the folder; the Yesterday line names the rest of yesterday's by
  title; no "+N more here on …" or about-me line repeats one of them. A handoff still names
  its session (that is where work was left, not the chapter).
- **Look at:** the Yesterday line: titles and a count ("; and 2 more"), never a lone `epi_…`.
- **Look at:** the top of the wake: one comment, `<!-- counterparts:wake meet=… store=st_…
  elements=… bytes=… -->`, and the sidebar still shows the meeting state and the store check
  (Mike's plugin sidebar; an older plugin, his is 0.3.25, reads both as unknown until it
  updates: no store check, and the footer keeps its "5-minute intro" line).
- **Look at:** an about-me line from another folder reads "A chapter about me from ~/x:
  session …, Oct 19 — "…" (epi_…)." and appears only when Yesterday does not already name it.
- **Look at:** "Coming up": nothing listed that is due tomorrow; each listed item ends with its
  own `[mem_…]`, then any "(earlier: …)".
- **Look at:** `~/.counterparts/snapshots/`: one folder per date from the install day on, and
  no `.taking-…` file left over an hour later.
- **Look at:** a morning with a `handoff.lasthere.noroom` row (not rare on a full wake with no
  handoff here: 10 of 61 ceilings in the review of #536's fixture). There should be no "Last
  here" line, and the Yesterday line names that episode (or counts it). The wake is assembled
  twice on those mornings: the `counterpart.wake.assembled` ring event fires twice.
- **Changes a decision if:** the episode is in no line on such a morning → the second
  assembly's check is wrong; or the session start is noticeably slower → measure the second
  assembly. Or a session reads the Yesterday line as all of
  yesterday and misses the one under Last here → say "(and the one under Last here)". Or the
  sidebar loses the store check on Mike's machine → the plugin sidebar is older than this core.

## Due ~2026-10-23 (the elsewhere lines' titles, 2026-10-20, Mike's go, an experiment — docs/decisions.d/feat-elsewhere-titles-1020.md)

On the owner's session-start wakes and per-prompt lines on a morning with two or three
sessions open at once (read-only; ask the sessions themselves too).

- **Look at:** did a session starting while another was open see what that one was doing
  ("Today, elsewhere: ~/x open since … (live), N memories: "…" (mem_…)") and not redo it?
  The 10-20 case was two sessions doing the same wake check. And in one folder: with
  COUNTERPARTS, a roadmap session, MOD and BENCHMARK open in ~/counterparts, does each
  wake's "Here, also open:" name the others with what they are doing, and does "Work here"
  not repeat those ids?
- **Look at:** are the titles the useful ones (work in progress, things done today), or
  noise (small findings, half-sentences from untitled memories)? Ask the sessions, and see
  whether any expanded a title's `mem_` id with recall.
- **Look at:** "Since you started" never names a title twice in one session, and still says
  nothing when nothing new was written.
- **Look at:** nothing from a folder that is off, paused or observed, nothing marked about
  me, us or the owner, in either line.
- **Look at:** the wake's lanes did not lose room to the line (doctor's Wake line, the
  `counterpart.wake.assembled` bytes; the line is still at most 300 bytes).
- **Changes a decision if:** sessions still duplicate work → give the line more room, or the
  clause here more titles; titles read as noise → keep only status-marked
  memories, or one title a folder; a gate leak → revert at once (`git revert` of the PR).

## Due ~2026-10-24 (personal news across folders, 2026-10-20, Mike's go, lightly held, an experiment — docs/decisions.d/feat-unmarked-personal-marks-1020.md)

Trying: the reflection is offered 24 unmarked memories a night (was 5), the personal-looking first
(`src/core/dream/unmarked.ts`), with room for 32 about marks (was 8), so the personal ones get marked owner or us
and reach every folder; and the `about` field on `remember`/`session_end` says what a mark does. Revert:
`REFLECT_TUNABLES.UNMARKED` 5 and `LIMITS.about` 8 (`src/core/dream/reflect.ts`).

- **First, the switch:** `counterparts core` says "Open" or "Closed to reflection alone". Closed, the reflection may
  only mark work or world (owner ruling D1 on #256) and none of this moves; opening it is Mike's call.
- **The baseline, before the first night on it:** `bun tools/audit/unmarked-offer.ts <a COPY of the newest
  snapshot's counterparts.sqlite>` — the unmarked work pool, how many a lived day adds, how many look personal.
  Counts only; it refuses a path under ~/.counterparts. Not run at build time (the session's permissions refused
  the copy), so the cap of 24 is unmeasured: if a day adds far more than 24, raise it; if the pool empties in a
  night or two, lower it.
- **How many it marked owner or us:** `core_events` rows with `action = 'about'` and `actor = 'reflection'` since
  install, by the mark set (the memory's `about` now) and the `reason`'s "was …"; `counts.about` on each
  `reflection.finished`. The pool again with the probe: is it shrinking?
- **Wrong marks Mike reverses:** an `about` row by the owner (`counterparts about`, the dashboard) on a memory the
  reflection marked, or a work note that turns up in another folder's Nearby. If the reflection marks build notes
  personal, tighten the prompt's "owner or us when it is personal" before touching the order.
- **Does personal news reach other folders:** a wake in a folder other than ~/counterparts (or Desktop chat):
  are recent personal things (a visit, how a week left Mike) in Nearby that were "Work here" only before?
- **The morning share:** past three re-labels it says two by name and the rest as a count. Is that enough for him?
- **The child's context** (review of #558): the bundle does not grow — the offer's lines (≤ 24 × ~320 chars) come
  out of the same 80,000-character room, so on a full night they displace other memories (measured on a test
  full night: 62 memories shown instead of 78, the first part +0.5k chars). What can grow is the reflection
  reading offered ids whole before it marks them, and the finish's 24 whys. Check the reflection child's peak
  against the 10-19 watch (127.5k of ~150k); past ~140k, lower `UNMARKED` before anything else.

## Due ~2026-10-27 (core questions that waited a week, 2026-10-20, Mike's go, an experiment — docs/decisions.d/feat-core-questions-waited-1020.md)

- **Trying:** a core memory flagged "being reconsidered" 7+ lived days ago with no decision
  is offered to the nightly reflection (at most 3 a night, with its unsettled pair); it
  decides keep or retire with a why where it can, and the share says it in one line with
  the way back. The wake's "Still open" leads with one, and keeps "keep or retire it"
  beside an unsettled label.
- **Look at:** how many core questions waited past 7 lived days on 10-20 (three) and now
  (doctor's Reflection line, `coreWaited`; `counterparts core --list`'s "since lived day").
  What the reflection decided: `reflections.detail` → `coreOffered`, `coreDecided` (with
  why), `counts.coreKept`/`coreRetired`, and the `reflection.finished` events. Whether a
  pair was settled after a retire (`contradiction_settles` with actor `reflection`).
  Whether Mike reversed any: `band.core.restored` events, or a retire of one a reflection
  kept (`core_events` `demoted` after a `reaffirmed` by `reflection`). And a wake or two:
  does a week-old one lead "Still open", with both labels?
- **Changes it:** a decision Mike reverses, or a why that reads like a guess, → narrow the
  prompt toward "keep unless plainly not who I am" or offer only the ones with a plain
  category (a plan, not about me or us). Nothing waits past 7 and nothing was decided →
  the wake did the work; the reflection's half may be unneeded.
- **Revert:** filter the reflection's offer back to every flagged memory without the push
  (`dream/reflect.ts`, the `core` instruction line) and pass no `waiting` to `rankLanes`;
  the restore door (`keepCore`'s `restored`) can stay.

## Due ~2026-10-27, the next Tuesday (a weekly reminder done for this week, 2026-10-20, Mike's go, an experiment — docs/decisions.d/feat-reminder-done-this-week.md)

### The backup reminder closes for the week, and comes back
- **Trying:** a memory that `updates` a repeating reminder with `status: "done"` closes only the
  occurrence open that day; the reminder keeps its date, repeat and standing.
- **Look at:** after Mike says the backup is done on a Tuesday, the write's answer (`reminder.
  occurrenceClosed: true`, `next`), then a new session the same day: no plain line, no
  "Arriving:" line, no footnote for the backup reminder. On 10-27 it is said again. In the store:
  the reminder's firing row for that `d:<date>` window in state `suppressed`, the
  reminder row's `event_date` and `meta.recurring` unchanged, its `fade` unchanged, no
  contradictions pair over it.
- **Also look at:** whether sessions write the done memory with `updates` (or follow the
  `answers` hint when they don't), and whether a `drewOn` naming a memory the session itself
  corrected comes back credited with `replacedHere` instead of `faded-under-newer`.
- **Changes a decision if:** the reminder still comes back the same day after a done (a path that
  doesn't read the window state), it does NOT come back the next Tuesday, it closes the wrong
  week (a done said Saturday, with that Tuesday's still open, closes the coming Tuesday's), or
  the reminder fades or leaves the core after a done.
- **Revert:** revert the PR; a done at a repeat then ends the repeat again.

## Due ~2026-10-27 (the facts title tail and soft time words, 2026-10-20, from the benchmark loss read, lightly held, an experiment — docs/decisions.d/feat-facts-title-tail-1020.md)

Lands while 0.3.27's recall experiments are read (~10-22). It changes only deliberate facts
answers (`recall` with `mode: "facts"`), never ambient footnotes, the wake or meaning mode, so
it does not move that read.

### Is a tail title opened, or is the tail noise?
- **Trying:** after a facts answer's 10 bodies, the next 20 matches as one line each (title ·
  id · date), so a memory ranked 11th–30th is in sight and can be opened by id. Listed is not
  shown: no credit for being listed.
- **Look at:** the `mcp.recall` rows with `mode: "facts"` since install: how many carry `tail`
  (and its size), then, for each, whether a later `mcp.recall` row in the same `session` opened
  (`path: "handle"`, its `ids`) one of that row's `tailIds`. Share of facts answers whose tail
  led to an open; share of opens that came from a tail rather than a body. Read a few answers
  live: does the answer quote or use a tail title without opening it (a guess from a title),
  does page 2 still get asked as often, are the 48-character titles readable.
- **Changes a decision if:** tail opens are ~0 over a week of facts calls (noise: cut to 10 or
  off), answers lean on tail titles without opening them (wrong guesses: reword the header or
  drop it), or answers run out of room more often (the ceiling's shrink ladder now drops the
  tail before excerpts go below 60).
- **Revert:** `FACTS_TAIL_SIZE = 0` in `src/adapters/mcp/facts.ts`.

### Soft time words rank, they don't filter
- **Trying:** "lately", "recently", "these days", "nowadays" no longer keep only the past week
  in a facts answer that asks something else; the past week's matches rank first.
- **Look at:** `mcp.recall` rows with `time: "soft"`: how many, and in a few live answers
  whether the right one led, or an older match crowded a recent one the question meant.
- **Changes a decision if:** "recently" questions start answering with old matches first
  (raise `FACTS_SOFT_RECENT_BONUS` from 0.25, or filter again with a fallback past the window).
- **Revert:** drop `{ soft: true }` from the soft branch in `src/core/recall/time-ask.ts`.

## Due ~2026-10-29 (a higher bar for another project's work, 2026-10-21, Mike's ruling on lane G item 4, an experiment)

**What we're trying.** In ambient recall, a memory that is ANOTHER project's work (written in a folder outside the
turn's folder's project, `folder_projects`; work by `self/work.ts#isWorkMemory`) faces bars ×1.25
(`recall.CROSS_PROJECT_BAR_LIFT`, the way habituation's ×1.5 lift works). Personal memories and craft are never lifted.
The hard filter (`recall.RECALL_BY_PROJECT`) is built and off.

**Baseline** (the 2026-10-20 corpus copy, `recall.rated` footnote ratings 0–3, a session's folder taken from its own
memories): home work n=163 mean 0.94; home personal/craft n=124 mean 0.81; crossing work, other folders n=38 mean
0.37; crossing work, ~/counterparts ↔ ~/random n=37 mean 0.70; crossing personal/craft n=111 mean 0.51.

**What to look at.** Re-measure the same split on the live store with a week more ratings (the script is lane G's
`ratings.ts`; the same joins in SQL work). Also `recall.decision`'s `crossProjectLifted` per turn: how many a day the
lift kept below the bar, and in which folder pairs. Read it as "kept below the bar", not "would have shown": one it
counts might still have lost to the footnote cap or the budget's trim, and a loud item the lift demoted to a footnote
is not counted.

**What would change it.** Crossing work still rated well under home work → raise the lift (1.5?), or turn on the
hard filter for pairs other than ~/counterparts ↔ ~/random (or join ~/random to the project). Crossing ratings rise
toward home ones and no complaint of missing context → keep. ~/counterparts ↔ ~/random footnotes the owner misses →
join ~/random to the Counterparts project (`counterparts project join ~/random ~/counterparts`), which removes the
lift there.

**Revert.** `recall.CROSS_PROJECT_BAR_LIFT` to 1.

## Due ~2026-10-29 (open threads mean someone owes an answer, 2026-10-22, shape agreed by Mike, an experiment — docs/decisions.d/feat-open-threads-carry-1022.md; the real check 2026-11-05)

**What we're trying.** Three changes upstream of the reflection, which already saw every stale item twice a week and
closed almost nothing (10-17..10-22: 5 shown a night, 1 closed in six nights; the stale list ~20 deep):

- **Write time.** `unresolved`'s description on `remember` and `session_end`, and the Stop ask, say open means
  someone owes an answer — a question to the owner, a check with a date, a promise; a bug note, a design note or a
  fact gets no flag.
- **Close time.** The Stop ask's last line names THIS session's own open items (wrote, or used with a return), title
  and id, at most `STOP_OPEN_MAX` (5); none, no line.
- **Carry.** An open item with no eventDate, not `asked`, untouched (born, used beyond a glimpse, revised — not a
  footnote left unrated, not a dream's or a reflection's return, not being listed) for `self.OPEN_CARRY_DAYS` (21)
  lived days is no longer carried: out of the wake's Still open and its count (both wakes), and the reflection's
  `staleOpen`. Not closed. "Used" is `meta.usedDay`, written at every credited use but the glimpse. The
  reflection's bundle says `noLongerCarried` (what no share already holds) and the share says it once. A glimpse
  not being a touch is the coordinator's call (10-22, lightly held, for Mike); it still restarts the memory's fade
  (Mike's 10-19 ruling); `self.OPEN_CARRY_GLIMPSE_TOUCH` true reverts that rule alone.
  `STALE_OPEN` stays 5.

**Baseline** (live store, read-only, 10-22, lived day 31): 88 open in the wake (10 untouched 2+ weeks), 129
`unresolved` memories in the store; the reflection's closed/proposed per night above. Two items born on lived days 11
and 12, untouched since, should stop being carried on lived days 32 and 33.

**What to look at.** The wake's Still open count (its "N more still open" line) against 88, and the store's open
count against 129; new open items per day (`memories` with `"unresolved":true` by `birth_day`) before and after the
narrower text; closures per `session_end` (`counterpart.thread.closed` ring events) and whether sessions close the
items the Stop ask named; items no longer carried per night (`reflections.detail.notCarried`, length and the
difference night to night) and whether the share said the count once; the reflection's closed/proposed per night
(`detail.selfClosed`, `detail.closeProposed`) — should stay or rise, since what it sees is now real threads. Spot-read
a few no-longer-carried items: is any one a real debt someone still waits on — and was it one the conversation kept
surfacing as footnotes (`returns` rows `shown`), the case the glimpse rule deliberately lets go? Whether the Stop
ask's list ever names another folder's item (it should not: only what the session wrote or used).

**What would change it.** A real debt dropped → lengthen `OPEN_CARRY_DAYS` (28? 35?), or carry `said_by: owner` too;
one dropped while the conversation kept glimpsing it → count glimpses as touches again (Mike's call:
`self.OPEN_CARRY_GLIMPSE_TOUCH` true). Still open
still near 88 after two weeks → look at what keeps them touched or narrow the write-time text further. Sessions never close the named items → change the line's wording, or drop it (`STOP_OPEN_MAX` 0).

**Revert.** `self.OPEN_CARRY_DAYS` very large (`Infinity`: carries everything, as before); the `unresolved`
description and the Stop ask's `OPEN_MEANS` clause back to the 10-21 text; `STOP_OPEN_MAX` 0 (the ask as before, two
lines); the glimpse rule alone: `self.OPEN_CARRY_GLIMPSE_TOUCH` true.

## Due at the first live catch-up (the nightly run's or `counterparts catch-up`)

### Catch-up's real per-part cost
- **Look at:** the run's `adapter.night.writeup` row (parts, batches) and its children's transcripts / usage
  (runners `writeup-nrn_…` / `writeup-cup_…`): output + cache_write tokens per part, and tool calls per part.
  Compare with the estimate (~7k new-work tokens and 2 calls a part) and the nightly baseline (246k new work,
  20 calls; `~/counterparts-notes/2026-10-10-nightly-cost-baseline.md`).
- **Why:** both ceilings (100 parts a night, 400 for the command, Mike 10-11) rest on that per-part estimate,
  which was worked out from part sizes, never measured from a catch-up transcript.
- **Changes a decision if:** the real cost per part is far above the estimate → lower the night's cap
  (`NIGHT_WRITE_UP_PARTS`), and look again at the command's.

## Due at the first live nights with the reflection in its own child

### Peak context per child on a heavy night
- **Look at:** the `dream.night` row's `children` (expect `dream:0,reflection:0`), and the two children's
  transcripts under `~/.claude/projects/-Users-mlapeter--counterparts-store/` (one session each): peak context
  (max input + cache write + cache read over a child's turns, deduped by message id) and new work per child.
- **Why:** measured once on a light night only (one agent 148k, then dream child 98k and reflection child 70k;
  `src/core/dream/NOTES.md`, 2026-10-11). A heavy night (the writer writing, 50+ fresh) was not measured.
- **Changes a decision if:** the dream child alone goes past ~150k → the dream bundle's room (`NIGHT_CHARS`) or
  the queue (Group 3) is next; if new work goes past the 2× cap (~490k), look at the reflection's re-written cache.

## Due 1 lived day after the verbatim trial ships

### Verbatim in the memory's body: first look
- **Look at:** the bench 76-question slice (counterparts-07) for meaning-search blur on long bodies: do memories
  holding a long verbatim block still come back for questions about their gist? And on the live store, any
  memory written with a list or a table since the ship (a facts line ending "(a list, N items; read whole by
  id)" finds them): did it come back whole by id, and was it findable by what it is, whose, when?
- **Why:** Mike's trial (2026-10-11, very lightly held): `remember` and `session_end` now ask for a list, a
  table or a pasted text whose specifics matter word for word in the body, with the search words in the title
  and the first line. The body is stored and read whole, but the meaning vector is made from the title and the
  body's first ~3,072 characters (at most 512 tokens; a numbered list reaches 512 tokens sooner), so the rest
  of a long block is reached by words only. Also watch: a facts answer saying "near-duplicates … left out"
  over two lists that were different (since the review of #409, a list or a table is compared by its lines,
  not its word set; two near-identical versions of one list still fold, and the older may be the one shown).
- **Changes a decision if:** long bodies blur meaning search, or real lists don't come back whole and findable
  → move to an attachments table (Mike's long-run lean), with the memory holding the context and keywords
  that find the attachment.

## Due ~4 lived days after the verbatim trial ships

### Verbatim in the memory's body: second look, and decide
- **Look at:** the same as the first look, on the days since: the bench slice again if anything changed, and
  every live memory written with a list, a table or a pasted text.
- **Changes a decision if:** decide the trial → keep it, or → attachments (a table of the blocks, the memory
  holding the context and keywords that find one). Record the call in `docs/IMPROVEMENTS.md`.

## .18 / Group 2 (one model for "this replaces that"), the first week after it is installed

### No settled-over memory outranks its head in ambient results (MOD #3)
- **Look at:** `recall.decision` events since the install: any id in `surfaced` or `footnotes` for which a
  settled `changed` / `corrected` pair names it as `over` (and whose head is live), on a turn where the head
  is not also shown. With the head-wins rule (recall CONTRACT §6b) that should be none (a guest session with a
  confidential head was the exception until 10-21). Also the wake's lanes, which already left settled-over memories out.
- **Why:** on 10-10 earlier versions were shown 55 times after their settle, 51 of them without the newer.
- **Changes a decision if:** an earlier one still shows beside or above its head → the gate's inhibition is
  missing a door (a quiet pointer, a carried cue): a bug lane. The head showing for an earlier the turn reached
  when the head reads wrong for the turn → the swap needs a bar of its own.

### Detector precision on the owner's store: hand-read 20 proposed slots
- **Look at:** `counterparts settle --dir …` ("Proposed as a newer state") and `contradiction.proposed`
  events: how many a day, and a hand-read of 20 (ids and verdicts only), with what the dream did to each
  (`slot` same true / false in `dream_changes`).
- **Why:** before install, on the 10-11 copy, a replay of the write-time rule over 20 lived days read 17 of
  20 right, 1 wrong, 2 unsure; replayed on the store as it stands now (the writer's own settles already made) it
  proposes 5 over 20 lived days, 4 of them in the last 7.
- **Changes a decision if:** fewer than ~3 in 4 are right → raise `SLOT_COSINE` or drop the title arm; the
  dream says `same: false` to most → the provisional cut should be a flag only (no fade) until confirmed.

### The dream's confirm/undo stays inside the night
- **Look at:** the dream bundle's "to-confirm" items (at most 4) and `toConfirmMore`, the dream's `slot`
  changes per night, and whether the night run's part count (`NIGHT_WRITE_UP_PARTS`, 100, shared with
  catch-up) or its time moved. The detector itself makes no model call; confirming rides the one dream.
- **Why:** on the 10-11 copy the 4 waiting proposals cost ~1.1k characters of on-mind text plus their memory
  lines in the fitted room; nothing else.
- **Changes a decision if:** `toConfirmMore` keeps growing night over night → proposals outpace the dream's
  4: raise `SLOT_PER_NIGHT` or tighten the rule.

## .19 / Group 2b (one door for "A over B"), the first week after it is installed

The forward run on the 10-11 copy (snapshot before the v13 migration, lived day 20; branch against master, +0/+1/+7
lived days with a boundary a day, no model calls) is the baseline. Only the open-time passes can fire in it: the
moved-reminder pass wrote 2 rows at +0 (mem_6d94a37a10c5 under mem_828f37a7eaa1, mem_828f37a7eaa1 under
mem_96410a0916f3; both fade 1.0 → 0.5, strength 0.346 → 0.173 and 0.456 → 0.228) and 0 after; the corrected-links
pass carried 10 corrected memories' links. Core: no movement (no declared change in a forward run). Owner/us: 0 of
227 memories differ from master at any checkpoint. The doors that need a write or a dream (write, settle, slot,
dream-merge, pressure, fulfilled) wrote nothing in the run; from the copy's history a dream merge would have written
one row per original (40 originals so far).

### Every door's rows, by source
- **Look at:** `SELECT source, how, state, count(*) FROM contradictions WHERE created_at > <install> GROUP BY 1,2,3`,
  and `contradiction.settled` events' `source` and `howSent`.
- **Why:** after this, every "A over B" writes a row; a door that writes none is a door that was missed. Expect
  `write` most days, `dream-merge` on dream nights (one per original), `reminder-moved` rarely (a reminder carried
  from further along its chain), `pressure` / `fulfilled` only on a declared change at a core memory.
- **Changes a decision if:** a merge night writes no `dream-merge` rows → the door refused (the merge's result note
  says "was not settled under the merged memory"; look for a merged memory's `meta.mergedFrom` ids with no pair):
  a bug lane. `howSent: false` on most
  `write` rows that turn out wrong on a hand-read → default `how` to `open` instead of `changed`.

### The dashboard no longer counts one settle twice
- **Look at:** `/api/mechanisms` Interference and Reconsolidation backing ids: no event id under both.
- **Why:** review 10 found the same event ids under both cards. Interference now counts merges, dream flags,
  slot proposals and confirmed slots; Reconsolidation counts declared settles and pressure.
- **Changes a decision if:** they still overlap → the split missed a source value; or Interference sits idle for a
  week while slots are proposed → its proofs read the wrong events.

### Corrected memories' rows swept only after their links were carried
- **Look at:** meta `associate.corrected.relink` present after the first open; edge rows whose endpoint is archived
  `corrected` (25 on the copy) go to ~0 at the first flush after it; the holder keeps the links.
- **Why:** `corrected` joined the sweep's terminal list with this build; the open-time pass carries the old ones
  first and the sweep waits for its latch.
- **Changes a decision if:** the latch is missing a day later (the pass keeps failing) → the sweep never takes
  `corrected`, which is the safe side, but find out why.

### A core memory moves only on a declared change
- **Look at:** `revision.pressure` rows (force 0.35 for an authored change at a slow-kind core memory) and pairs with
  source `pressure` or `fulfilled`.
- **Why:** before this no path moved a core memory in practice. The Han pair (mem_def8b46df5cc, no status, no date)
  is not fast-laned: it needs three lived days of declared changes at the floor. Whether such items should be in the
  core at all is Group 3's.
- **Changes a decision if:** a `fulfilled` takes a core memory out of the core that a hand-read says was not a plan → narrow the fast
  lane (status only, not a date); or the Han pair is still in the core after the owner has declared it kept on
  three days → the floor is not reaching it.

### A merge's originals stay live, behind the merged memory (random-06's ruling, review of #427)
- **Look at:** live memories that are the `over` of a settled `dream-merge` pair: their count, their strength
  (fade 0.5), and whether any shows in a turn's ambient block beside its merged memory (the recall log) or unfolded in
  a facts-mode answer.
- **Why:** a merge no longer archives its originals; they fade ×0.5, are labelled earlier and leave by their own curve.
  The cost accepted was more live near-copies for a couple of weeks, hidden from ambient.
- **Changes a decision if:** an original shows beside its merged memory in ambient recall → head-wins misses a case
  (a bug lane); or the live originals pile up past a few weeks without reaching the floor → revisit the cut for
  a merge (a smaller `factor`, still `changed`).

## Group 4 (association), due ~5 lived days after it ships — checked 2026-10-18

**Checked 2026-10-18** (lived day 27, copy of the 10-18 snapshot plus a bench copy; full write-up
~/counterparts-notes/2026-10-18-association-diagnosis.md). Two triggers are met; the decisions are Mike's:
- **Edges per day:** write-time 163, contiguity 1,247, replay 1,486, co-use 36, drewOn 3 over the week.
  Write-time is 0.13× contiguity, so the 3× trigger is not met.
- **Write-time links later reinforced:** at most 3 of 161 (≤2%); replay 1.5%, contiguity 0.9%. **The "~0"
  trigger is met.**
- **Hand-read of 20 write-time edges:** 5 right, 4 unsure, 11 noise. **The "still mostly noise" trigger is
  met** (narrowly).
- **linksReached:** 0 over 7 lived days (0 since the field exists). The Association light is amber. The
  replay arms were rerun: at 0.0125 there are 71 pointers shown on 54 of 1,375 turns, and 2 of 20 hand-read
  fit the turn, so the result argues against lowering `LINK_POINTER_MIN_FRACTION`.
- **The clinic pair (bench):** linked both ways at 0.05 after two nights (the first night left it waiting),
  too faint to change recall.
- **Why spread is starved (ranked):** (1) edges are too weak: decayed max 0.159, below the ~0.16 a hop needs
  to carry past a seed and the 0.4 a lone pointer needs; use rarely reinforces them (58 of 1,986 shows
  credited). (2) A hop adds a median 2% activation, while a below-bar candidate needs a median +76%.
  (3) Pointers are gated twice (threshold, then anchor).
- **Recommendation (not decided):** keep the pointer threshold; consider dropping write-time links; the
  lever is upstream, in what counts as use; the Association light could read "partly built".


The fast-forward on the 10-11 copy (7 lived days replayed with write-time links, replay deposits and
co-use running, no model calls) is the baseline: write-time 95 new trails (904 before the review of #423
narrowed them to a jot's own turn), replay ~505, co-use 46 pairs (all on links that already existed); 0
pointer candidates at the current threshold, ~200 of 635 turns at 0.0125; the first flush swept ~2,040
inert rows (regrown copies and merge originals). A forward simulation has no awake use, so it cannot say
how many new trails use would confirm.

### Edges laid per day, by source
- **Look at:** per lived day, `sum(json_extract(payload,'$.deposited'))` over `associate.flush`, its
  `atWrite.landed`, `contiguity.landed`, and `dream.begun`'s `replayLinks`; the drewOn `recall.credit` rows'
  `linked`.
- **Why:** "links made" counted rows rewritten until now; these are the pairs that landed. On the copy,
  write-time links were 0–59 a lived day once only jots get them; the replay is now the larger source.
- **Changes a decision if:** write-time rows swamp the table (more than ~3× contiguity's) → lower
  `WRITE_LINK_MAX`, or drop write-time links (IMPROVEMENTS, Group 4).

### The share of write-time links later reinforced
- **Look at:** the share of write-time links later reinforced, on the live store, measured a week after the
  release that ships this installs: of the pairs laid by `atWrite` (and, beside it, the replay), how many
  weigh more than 0.05 a few days later (a co-use or a drewOn deposit landed on them): `edges` with
  `weight > 0.06` whose pair first appeared on an `atWrite`/replay day.
- **Why:** the ants rule only works if use confirms some trails, and only real use can show it.
- **Changes a decision if:** ~0 after a week of drewOn → the trails are noise that nothing confirms: lower
  `WRITE_LINK_MAX` or drop write-time links; and item 4's reinforced column (v14) has nothing to act on yet.

### Hand-read 20 write-time edges for noise
- **Look at:** 20 random pairs from `atWrite` days, both memories' titles, right / noise / unsure.
- **Why:** on the copy, after the tightening, 40 read 5 right, 6 unsure, 29 noise (before it, 20 read 1, 3,
  16, the batch ones 0, 2, 14). Every own-turn candidate was a footnote; G1b's footnote precision was
  0.17–0.33.
- **Changes a decision if:** still mostly noise on real use → drop write-time links and let drewOn and the
  replay lay trails.

### "Links reached recall" > 0, and the Association light
- **Look at:** `sum(json_extract(payload,'$.linksReached'))` over `recall.decision` for the last 7 lived
  days; the dashboard's Association light.
- **Why:** it goes amber when links were laid and none reached recall, once the store has lived 14 days and
  laid 20 links that week (waiting before that). The owner's store passes both, so expect amber there after
  install: the copy had 0 pointer candidates at the current threshold.
- **Changes a decision if:** 0 for 7 lived days with deposit running → re-run the 10-02 replay arms on a fresh
  copy and decide the pointer threshold (`LINK_POINTER_MIN_FRACTION` 0.05 → 0.0125, review 06 C7).

### The clinic pair, on the bench store
- **Look at:** copy the bench store `s500-t-h55-clean/73d42213` and run one dream; the 7 AM memory and the
  memories that say the last clinic trip took two hours are linked (`edges` both ways, ≥ 0.05).
- **Why:** bench item 5/6: before, edges only ran between memories of the same conversation. The bench
  writes every memory in a session-end write-up with no recall while it writes, so write-time links never
  fire there; the replay is what links it (it did on a copy at review, 10-11).
- **Changes a decision if:** not linked → the dream's neighbours miss what a real writer had in mind; look
  at which.

## Ongoing (first two weeks)

### No settled-over memory outranks its head in ambient results
- **Look at:** turn-recall footnotes ("Quietly available", "Came to mind"), the wake's Nearby, and the other
  wake lanes, for a memory that a `changed` or `corrected` settle made earlier, shown above the memory that
  replaced it, or shown without it.
- **Why:** MOD's #3 (10-11): a settled-over memory's title showed bare beside newer ones, and a session repeated
  a corrected rule from it. Marking those titles is its own lane; this is about whether the earlier one
  ranks above its head at all.
- **Changes a decision if:** it happens → interference/supersede ranking needs a fix (Group 2).

### The old-claims era's effect on archives
- **Look at:** `counterparts claims-era --dir …` (count read at default) and archives with no
  `archived_reason` of corrected / dream-merge / episode-regrown / handoff-cleared, i.e. exits by fading, split
  by whether the era read them at default.
- **Why:** the era (Mike 10-10) reads 468 old claims at their default; on the 10-10 copy it caused 50 more
  archives by +30 lived days than without it (73 vs 23). Since 10-11 the count has two parts, read lower
  and read higher (old defaults below today's, e.g. owner/us at 0.25 → 0.40), so it jumps by the read-higher ones.
- **Changes a decision if:** the era's archives include memories Mike would miss → `counterparts claims-era
  --off` reads claims as stored again (archives already made stay archived, readable by id).

## Checked 2026-10-22 (see "Checked 2026-10-22" above), was due ~2026-10-22, two lived days after install: the feedback loop, Builder 1 (an experiment — docs/decisions.d/feat-feedback-loop-credit-1019.md)

Trying ratings as use (A), strong co-use links (B) and light habituation (D) to see whether the day starts
teaching the system. Read-only on the owner's store: `counterparts doctor --config …` (the **Feedback loop**
and **Association** lines), `counterparts probe-oq4 --dir …` (the ratings by date), and the `recall.rated`
rows' `credited` / `notCredited` / `coUse` / `together` fields. Each entry names its revert.

### A. Credits per day by tier, and the footnote ratings
- **Look at:** the Feedback loop line's uses credited (glimpses, rated 1, 2, 3) and not credited; per day,
  the same sums over `recall.rated` rows. Then probe-oq4's score distribution after install against before
  (47% noise / 35% on topic, not needed / 18% useful).
- **Why:** the loop is meant to credit far more than the 3% of shown memories credited before.
- **Changes a decision if:** the useful share does not rise, or the noise share stays near half → the
  credit may be strengthening noise; lower `W_SHOWN` first. If the distribution jumps toward 2–3 right
  after install, the new tool words ("a score counts as use") may be steering the ratings → reword.

### A. Standing rulings and the core
- **Look at:** memories footnoted in 3+ sessions and never rated 2–3 or opened (the ~270 of 10-14): did any
  cross into the core (`core_events` since install), and how many of them sit at or near their peak strength
  (`counterparts mechanisms` below-reach count against 10-18's).
- **Why:** a glimpse re-anchors a memory's curve, so a memory footnoted daily does not fade while it keeps
  showing (kept as built, Mike 2026-10-19). Toward the core a glimpse-only day is 0.1 of a day, never alone,
  never the anchor; but daily glimpses plus two full days in 30 (two reflection citations, or one and a
  rating of 2 or a drewOn) do cross the slow lane (hermetic, 2026-10-19), where before it took about four.
- **Changes a decision if:** a never-used ruling reached the core → the recurrence fractions are too high;
  or below reach drops sharply with the noise share flat, or the footnotes look cluttered with the same
  memories → glimpses keep noise alive; the fallback to try is a glimpse that credits `uses` without moving
  the decay clock, or `W_SHOWN` 0.

### A. drewOn as a full use
- **Look at:** drewOn ids per day and their returns (`returns.source = 'awake'` on a drewOn day, not
  `engaged`), and whether memories named in drewOn start crossing into the core.
- **Why:** Mike, 2026-10-19: trying drewOn as a full use (it was half), so its return is an awake one.
- **Changes a decision if:** drewOn lists grow to the cap of 3 at most boundaries, or name memories the turn
  barely touched → it is being used as a vote; set `W_ENGAGED` back to 0.5.

### B. Links at pointer weight, and pointers used
- **Look at:** the Feedback loop line's "links at or above the quiet-pointer weight (0.40)" and co-use pairs
  sent; the Association line's quiet pointers shown and later expanded. Hand-read 10 pointers shown since
  install against the turn they came on.
- **Why:** two co-uses at 0.25 now clear 0.4, so pointers should begin to show within a day or two.
- **Changes a decision if:** pointers show but mostly beside the point (the 10-18 hand-read was 2 right of
  20 at a lowered threshold) → lower `CO_USE_DEPOSIT` or raise `CO_USE_MIN_SCORE` to 3; or memories hit the
  outgoing bound (a node's links summing to 4.0; the hermetic heavy month put five "hub" memories there with
  72 evictions) → cap co-use deposits per pair per day. Revert: both deposits to 0.

### D. Habituated memories
- **Look at:** the Feedback loop line's "memories habituated now" and "habituated showings got through
  anyway"; then hand-read the habituated ids (the `note:habituation` row in the cache, or rows rated 0 in two
  sessions): are they noise?
- **Why:** a memory rated 0 in two sessions within 7 lived days faces a ×1.5 bar until the ratings age out
  or a later 2 clears it.
- **Changes a decision if:** a habituated memory turns out to be one a session later needed (rated 2–3
  after habituating) more than once → the lift is too strong or two sessions too few; if none ever
  habituates while noise stays near half → the lift is too light. Revert: `HABITUATION_BAR_LIFT` 0.

## Checked 2026-10-22 (see "Checked 2026-10-22" above), was due ~2026-10-22, two lived days after install: the feedback loop, Builder 2 (an experiment — docs/decisions.d/feat-feedback-loop-gate-dream-1019.md)

Trying three things together to see whether the day teaches the system (#523): footnotes skip what this session
wrote (C), the dream replays what the day used (E), and the nightly run's own sessions get no footnotes (F). Revert
by the paths in the fragment.

- **C, the echo skip:** `echoSkipped` per day and per session on `recall.decision` rows, and `adapter.recall`'s
  `echoWindow` (`compaction` / `session` / `unread`; one `unread` per session is normal, since the transcript is
  written only after the first prompt). How many showings a long session lost; whether compacted sessions get their
  early memories back. Footnote ratings over the same days: does the 47% noise share drop? **Changes it if** a
  session misses something it wrote earlier and needed → narrow the window.
- **E, the day replay:** `dream.begun`'s `today`, `todayReward`, `todayDreamed`, `todayPairs`, `freshMarked`; how many
  `today` memories the dream replayed or linked (`dream.changed`); whether used memories get dream returns more
  often. **Changes it if** `today` crowds out new memories (`queue.waiting` rising) → lower `TODAY_FIT` or `TODAY_COUNT`.
- **F, the nightly run:** night children's sessions have no `recall.decision` rows after install, and their
  `recall.credit` rows read `shownFootnotes: 0`.

## Checked 2026-10-22 (see "Checked 2026-10-22" above), was due ~2026-10-22 (stemming + everyday-word weights, 2026-10-19, an experiment — docs/decisions.d/feat-stemming-everyday-words-1019.md)

- **Trying:** the word index stores light stems (bake/bakes/baked/baking are one word), and a cue word's
  rarity is scaled down when the embedder's table says it is everyday English ("any", "what", "you"), to see
  whether first prompts surface what they are about. Both ambient recall and facts mode.
- **Look at:** (1) the re-stem landed: `sqlite3 "file:$HOME/.counterparts/store/cache/cache.sqlite?mode=ro"
  "select value from cache_meta where key='terms'"` says `light-1` after the first worker run. (2) Footnote
  ratings and items shown per turn since install, against the week before (`adapter.recall` rows), especially
  first prompts. (3) A few of Mike's own opening questions: did the memory he meant show?
- **Changes a decision if:** items shown per turn drop, or ratings fall, or a name/id he searches for stops
  matching → revert. A stem merging two different words in his real use (known: even/evening, morning/morn,
  sim/sims) → add an exception.
- **Revert:** the discount alone: set `EVERYDAY_NORM_HIGH <= EVERYDAY_NORM_LOW` (recall tunables). Stemming is
  not free to undo: unstemmed lookups miss stemmed rows, so it needs a build that indexes surface words again
  and keeps asking for both forms, or another cache bump whose worker step re-indexes from prose.
  **Not by installing 0.3.26 over the v7 cache:** its memory server refuses every tool and its hooks miss
  stemmed rows. If that happens: delete `~/.counterparts/store/cache/cache.sqlite*`, then run
  `counterparts verify --rebuild --keep-vectors` on that build (deleting alone leaves word recall empty).
  `counterparts rollback` does not cover a cache-only change.

## Checked 2026-10-22 (see "Checked 2026-10-22" above), was due ~2026-10-22 (context priming, 2026-10-19, an experiment — docs/decisions.d/feat-context-priming-1019.md)

Trying a downward direction for recall (#530): what the session used and wrote, and the folder's open threads and
handoffs, give their linked partners and memories near a centred train-of-thought vector a head start; it can lift
a candidate past the bar but never introduce one. Revert: `PRIME_LINK_UNITS` and `PRIME_TRAIN_SHARE` to 0
(centring alone: `PRIME_TRAIN_CENTRE` 0).

- **Look at:** `recall.decision` rows' `primed` summary (sources by kind, `train`, `trainCentre`, `shown`,
  `lifted`, `byLink`, `byTrain`) and each shown row's `primed` part. How many footnotes a day were primed, and how
  many only because of it.
- **Ratings:** primed against unprimed footnotes (`recall.rated` joined on ids): are primed ones rated 2–3 more
  often? The lifted ones especially.
- **Changes it if** tunnel vision: the same primed cluster turn after turn while the prompts changed subject, or the
  same `from` source priming several turns running → lower `PRIME_CEILING` or `PRIME_TRAIN_SHARE` first, then
  `PRIME_SOURCE_DECAY`. On lagged turns the train can still outweigh the lagged cue; watch that too.

## Due ~2026-10-23 (the nightly writers held to the page's room, 2026-10-20, an experiment — docs/decisions.d/feat-page-held-to-room-1020.md)

Trying: the page writer and the reflection are refused the night's first page past the 4,600-byte room ("cut,
don't add a short version"); a second try is kept, and a held page never sent again is kept at the run's end. A
page past the room with a short version shows that in the wake. Revert: `PAGE_HELD_TO_ROOM` and
`PAGE_SHORT_PAST_ROOM` false (`src/core/self/tunables.ts`), and the 2026-10-10 sentence back in place of
`PAGE_ROOM_RULE` (`src/core/self/writer.ts`).

- **Look at, three mornings:** the page's bytes after each night (`self.page.revised` rows: `bytes`, `by`; the
  last one before the morning's first session), and whether it is within 4,600. The holds: `self.page.refused`
  rows with `reason: "past-room"` (`bytes`, `over`, `by`), and whether the same night then has a revised row by
  the same door within the room (cut), past it (kept on the second try), or one whose reason ends "kept at the
  run's end" or "kept at a later boundary" (never sent again; the second is a night with no run end).
- **The wake:** the session-start wake's `elements=` count in its head tag (or `self.briefing` rows'
  `elements`) and the page's rung (`page.rung` on the same row: `whole`, or `short` past the room), against the
  10-20 morning: 4 sections down to 3 with a 4,956-byte page.
- **Changes it if:** the pages come in thin but lose things that mattered (read one beside the 10-20 page), or
  a night's held page was kept at the run's end most nights (the resend isn't happening: look at the words the
  writer is sent back with), or the hold keeps firing every night by a few bytes (the room may be too tight for
  this page).

## Due ~2026-10-29 (beliefs shown, and priming changed again — wave 2 lane E, 2026-10-22, experiments)

**What we're trying.** Beliefs (lane C) reach a session for the first time, and priming gains a source.

- **The beliefs slot** (`recall.BELIEFS_IN_RECALL`, on): a turn that names a subject (a card, or a topic by its
  word) shows its strongest beliefs above 0.3, at most 3, in their own block after the footnotes, each with a
  strength word, its support count and its id, once a session. Footnotes stay belief-free. A rating of a belief
  line is a use of it (once a lived day), never support, and nothing for a belief about me or us.
- **Tags prime — PRIMING CHANGED AGAIN** (`recall.TAGS_PRIME`, on): a source's tags are a partner source beside
  its links, at 0.1 a shared tag and 0.05 through a concept edge. This lands after the 10-22 read of #530's
  context priming, so the re-read on this date sees both; read tag-primed footnotes apart (`primed.by: "tag"`).
- **The wake's project line** (`self.WAKE_PROJECT_LINE`, on, an experiment that has to earn its room): in a
  project's folder, its strongest beliefs (at most 3, 480 bytes), spliced last, the first thing a full wake drops.
- **Per-footnote priming flags** (the 10-22 read's ask): each shown row's `primed` now carries `by` (link, tag or
  train), `top` (the source id that gave most) and `tag`, beside `lifted`.

**What to look at.** On `recall.decision` rows: `beliefs` (null off; `shown` non-empty = the slot fired; `bytes`
per turn) — fire rate per turn and per session. On `recall.rated` rows: ratings with `lane: "beliefs"` against the
footnote baseline (10-19: 47% noise, 18% useful), and `notCredited["belief-about-me"]`. Priming: `primed.byTag` on
the decision rows, and footnote ratings joined per row on `primed.lifted` / `primed.by` / `primed.top` (tunnel
vision: the longest run of one `top` across consecutive turns of a session). The project line: ring events
`counterpart.project.shown` / `.noroom` (bytes), and whether its ids are opened or rated later; and (review of
#588) how often the line takes the head tag's room — `tagged` false in project folders, 216 of 430 ceilings in the
reviewer's scan — and whether `adapter.injection.overbudget` rows follow (the host's ~60-byte tag sits outside the
ceiling; self NOTES). And the design's
new eval: how often a session repeats something already corrected or re-raises something settled — the slot
should not raise it. Read it with `counterparts mechanisms --dir ~/.counterparts/store` (the line "Settled things
drawn on again: N of M pairs this week (changed a of b, corrected c of d — …); came up again R; shown only S", the
"beside it" line and the "by build" split by kind) or
`counterparts mechanisms --dir ~/.counterparts/store --json | jq '.settled | {pairs, repeats, reraised, viaWinner, shownOnly, byHow, byBuild}'`
(counts by kind, by way in, per build, example ids). Compare the pre-0.3.32 bucket (`pre-stamp`, or 0.3.31) with
0.3.32's, each beside its turns and lived days. Baseline, the 10-22 snapshot copy (window 10-16..10-22, all
pre-stamp, 1,254 recall turns on 8 lived days): drawn on again 2 of 231 (changed 2 of 210 — both rated 3 by a
session, one also named in `drewOn` and refused, 1 without its winner in the same row; corrected 0 of 21), came up
again 0, the winner in a newer pair 0, shown only 14. The definition, and where it departs from the brief:
`docs/decisions.d/feat-repeat-reraise-eval-1022.md`.

**What would change it.** Belief lines rated as noise as often as footnotes or more → raise the floor or the
strength a belief needs (`BELIEFS_SLOT_FLOOR`), or show fewer (`BELIEFS_SLOT_MAX`). Tag-primed footnotes rated no
better than unprimed → lower `TAGS_PRIME_WEIGHT` or turn `TAGS_PRIME` off. The project line dropped for room most
wakes, or its ids never drawn on → turn it off.

**Revert.** Each switch false: `recall.BELIEFS_IN_RECALL`, `recall.TAGS_PRIME`, `self.WAKE_PROJECT_LINE` (each off
is the build without it, byte for byte); or revert the PR. Compare first with `harness compare --set …=false`.

## Due ~2026-10-29 (card kinds back to the night; twin cards merged once — wave 2 follow-ups, 2026-10-22)

**What changed.** A card's birth kind no longer counts as its kind of subject. Only the identity core is a person
without a judgement. Once per store, the night's tags phase gives the rows the old rule wrote back to the kinds
ask (`schemas.kinds.repaired` holds each id and what it was). On the 10-22 corpus copy that was 10 cards:
Counterparts (place), and Anthropic, Claude, Katie, Montaigne, Clark, Jason, Ellis and the two Allex cards (person).
The same-name twin cards are merged once per store by the births phase (`schemas.TWINS_MERGE`, on):
the younger card of each pair is archived `card-twin` under the elder (`schemas.twin.<id>`, the run in
`schemas.twins.merged`). On the copy that was all 50 pairs, none skipped; live cards 161 → 111; the keepers gained 287
links on 208 live memories (23 cards) that named them while the twins lived (`linked` and `linkedMemories` on the record; doctor's v14 line says both).

**What to look at, on the 10-29 snapshot (a copy).** The kind distribution of live entity cards:
`SELECT coalesce(subject_kind,'NULL'), COUNT(*) FROM memories WHERE type='schema' AND json_extract(meta,'$.role')='entity' AND archived=0 AND body != '' GROUP BY 1`,
and who set each kind (`meta` keys `schemas.subjectKind.%`, `by`). Did the ask call Counterparts a project and
Anthropic not a person? Twin pairs still live:
`SELECT lower(json_extract(meta,'$.name')) n, COUNT(*) c FROM memories WHERE type='schema' AND json_extract(meta,'$.role')='entity' AND archived=0 AND body != '' AND coalesce(json_extract(meta,'$.name'),'') != '' GROUP BY n HAVING c > 1`
(50 on the 10-22 copy, 0 expected after the first night; any above 0 is a pair the pass skipped,
counted in `schemas.twins.merged`'s `skipped`, or a new race).

**What would change it.** The ask sorting people wrongly, or too slowly (10 a night) → raise `TAGS_KINDS_PER_NIGHT`,
or bring back the person rule for cards the ask has not reached. A twin the owner wants back →
`counterparts dream --undo-twins [card]`. **Revert.** `schemas.TWINS_MERGE=false` before the pass runs (it runs
once; after it, the undo door); revert the commits for the rest. The repaired kinds stay NULL until the ask
sorts them (the record lists what each was).

## Due ~2026-10-29 (the dream's fresh intake, 2026-10-23, Mike's go 10-22, an experiment — docs/decisions.d/feat-dream-intake-1023.md)

**What changed.** The dream's fresh list may cost 16,000 characters (`dream.FRESH_LIST_CHARS`, was 12,000; Mike okayed 24k, see the decision) and each
new memory carries 4 nearest older neighbours (`dream.NEIGHBOURS`, was 6). The composition compare on the 10-22
snapshot read 44 → 64 fresh a night, nothing left out, whole texts 20 → 11, about +1.3k tokens.

**What to look at (read-only).** The nights' intake from `dream.begun` events, split by build (0.3.33 on):
`SELECT json_extract(payload,'$.build') b, date(at/1000,'unixepoch') d, json_extract(payload,'$.fresh') fresh, json_extract(payload,'$.queue') queue, json_extract(payload,'$.waiting') waiting, json_extract(payload,'$.agedOut') aged, json_extract(payload,'$.whole') whole, json_extract(payload,'$.parts') parts FROM events WHERE name='dream.begun' ORDER BY seq DESC LIMIT 12`
— `fresh` (expect ~60, not ~44), `waiting`, `agedOut`, and `whole` (near 11, not 20). The last night on
0.3.32 (10-23) read fresh 42, queue 671, waiting 629, agedOut 119, whole 19, 4 parts. Read one or two dream journal entries from before and after: did a
dream with less whole text get thinner (fewer links made, shorter gists, fewer contradictions raised)?

**What would change it.** Dreams noticeably thinner → NEIGHBOURS back to 6 (at 6 the fresh room binds before the list: ~51 fresh).
Fresh still ~44 → a setting didn't take (check `build.<version>.settings` and the values in the shipped
tunables). The queue still grows either way; draining it needs `FRESH_SHARE` or `NIGHT_CHARS`, which costs
tokens and is Mike's call. **Revert.** Both values back in `src/core/dream/tunables.ts`.
