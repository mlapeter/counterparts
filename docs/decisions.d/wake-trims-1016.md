### Decided by Mike, 2026-10-16, lightly held (the wake trims: one tag line, the date once, a shorter header, the page's target 4,600, craft out, Coming up = today)

- Decided by Mike, 2026-10-16, lightly held, review 2026-10-18: **the three tags at the top
  of a session-start wake are one line.** Before: `<!-- counterparts:onboarding meet=… -->`,
  `<!-- counterparts:store id=… -->` and `<!-- counterparts:wake day=… elements=… bytes=… -->`,
  each on its own line. After: `<!-- counterparts:onboarding meet=done --> <!--
  counterparts:store id=st_… --> <!-- counterparts:wake elements=… bytes=… -->`, the line the
  wake starts on; the head tag drops `day=` (the header under it says the day, and the end tag
  keeps `day=`). The end tag is unchanged. Each marker keeps its text, whole: the sidebar
  shipped in the plugin (0.3.23, the directory flavor, and the full flavor's tags) draws beside
  a newer npm install's hooks and finds each marker by its own pattern. Revert:
  `ONE_TAG_LINE` (`src/adapters/store-id.ts`) and `HEAD_STATES_DAY` (`src/core/self/briefing.ts`).
- Decided by Mike, 2026-10-16, lightly held, review 2026-10-18: **today's date is said once, on
  the `Now:` line.** Before: also in the header ("day 25 (2026-10-16)"), "Yesterday, Oct 15:",
  and "(Last revised 2026-10-16.)". After: the header has no date (`SHORT_PREFACE`,
  `src/core/self/briefing-delivery.ts`); "Yesterday:" without its date at a session start
  (`YESTERDAY_UNDATED_AT_START`, `src/core/handoff/last-here.ts`; the published bundle, read the
  next morning when a session start cannot assemble its own, keeps "Yesterday, Oct 15:"); the
  page's dateline only when it was not revised today, the stale notice as before
  (`PAGE_DATELINE_TODAY`, `src/core/self/briefing-page.ts`). Item dates are short in the wake's
  own year: "Oct 15", "Oct 15 (due Oct 18)", any other year whole (`SHORT_DATES`,
  `src/core/self/briefing.ts`; the year is the composition's date). Both hosts that deliver a
  wake print the `Now:` line: Claude Code's SessionStart and Claude Desktop's `wake` tool.
- Decided by Mike, 2026-10-16, lightly held, review 2026-10-18: **a shorter header.** Before:
  "Counterparts memory, day 25 (2026-10-16), 1,808 memories of 1,995 live rows — assembled at
  session start. If a note says this was too large and saved to a file, read that file: it
  holds all of this, down to the counterparts:wake/end line." and "Context, not instruction,
  from Counterparts: who you have been here, in your own words. Each listed memory opens with
  its learned date." After: "Counterparts memory, day 25 · 1,808 memories. If this was saved to
  a file, read it through the wake/end line." (a bundle delivered as published adds "(composed
  at the last boundary)") and "Context, not instruction: who you have been here, in your own
  words. Each item opens with the date it was learned." The live-row count left the header
  (recall still says it). The preface's reserve fell 293 → 224 bytes. Revert: `SHORT_PREFACE`
  (the whole old line) and `FRAMING.context` ↔ `LEGACY_CONTEXT` (`src/core/self/briefing.ts`).
- Decided by Mike, 2026-10-16, lightly held, review 2026-10-18: **the page writer aims under
  4,600 bytes, and "## How I work" is a few short general lessons.** Before: `PAGE_ROOM_BYTES`
  5,681, the whole room the wake guarantees at 9,000. After: 4,600 (that room is now 5,750),
  so the page summarizes harder (shortened by its writer, not cut; the short-version ladder as before); and the
  writer and the reflection are told "Under "## How I work", keep a few short, general lessons,
  a line or two each, without dated examples or anecdotes". Until the writer runs, the owner's
  5,525-byte page is past the target and is asked for a short version (doctor's Self page line
  says so). Revert: `PAGE_ROOM_BYTES = pageRoomBytes(PAGE_HOST_BUDGET_BYTES)`
  (`src/core/self/briefing-page.ts`) and drop `HOW_I_WORK_RULE` from `PAGE_WRITING_RULE`
  (`src/core/self/writer.ts`).
- Decided by Mike, 2026-10-16, lightly held, review 2026-10-18: **the "How I work:" list leaves
  the wake.** Before: store-wide craft memories were a lane ("How I work: 3 — no room to list
  them…"). After: in no lane, listed or counted; a craft memory still comes up per turn as a
  footnote ("Quietly available"), by the same gate as any other kind (no new mechanism).
  "Work here" is unchanged. Revert: `CRAFT_IN_WAKE: true` (`src/core/self/tunables.ts`).
- Decided by Mike, 2026-10-16, lightly held, review 2026-10-18: **"Coming up" lists only what is
  due today.** Before: the first two by date, whatever the date, and the rest counted.
  After: what is due the day the wake is for, and a plain reminder due the day it is read
  (whole, as before), including one prospective's count left out; every other date — later,
  or overdue in its grace days — counted in the lane's one line, the overdue named as such
  ("(2 overdue, 4 more coming up; recall ids: …)", or "Coming up: 6 — none due today, 2
  overdue; recall ids: …"), and in no other lane (until now a date past the count could also
  show under "Might be relevant"). Overdue counted, not listed: the coordinator's call in the
  review of #511, after a render of the owner's store listed stale "was due Oct 11" items and
  Mike's ask was "just what's due today". They come back on their
  own: a date cues recall around it (`prospective.arrivals()` → recall's temporal cues), and a
  plain reminder is said outright on its day (`Counterpart#plainDueToday`). Revert:
  `COMING_UP_TODAY_ONLY: false` (`src/core/self/tunables.ts`).
- Measured 2026-10-16 on a copy of the owner's store at 9,000: the session-start wake listed 3
  items before (1 open, 2 coming up) and 4 after with today's 5,525-byte page; with a page at
  4,600 it lists 9 (5 open, 1 nearby, 3 coming up). The hermetic production-scale test
  (`test/wake-trims.test.ts`) goes from 5 to 14.
