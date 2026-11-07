### Decided by the SO1 step 3 builder, 2026-11-07, lightly held (each item shows where it can be acted on)

- Decided with Mike, 11-07 (roadmap): what he saw in motelier was plain reminders to do things from other folders.
  Another folder's work plain reminder no longer shows or is told in this folder; personal ones (about me, us,
  owner) still cross, folded once told. `about: world` no longer counts as personal for open threads or dated
  items (`self/work.ts#threadPlace`). Why: the door read (`~/counterparts-notes/2026-11-07-briefs/SO1-step3-door-read.md`)
  found the plain-due row the only door showing another folder's work whole since 11-02 (16/34/33/3/16 a day), and
  the about-world thread in all 8 non-random readers.
- Decided by the builder, lightly held: the telling path holds another folder's reminder back unclaimed
  (`Counterpart#plainAway`, beside `plainHeldBack`), not just the wake block. Why: told in the folder that wakes
  first, it wrote the latch and its own folder's first wake folded it to "shown earlier".
- Decided with the roadmap (fix round of #780): a reader with no folder (claude.ai and other hosts with no folder)
  is told only personal plain reminders, and a telling counts as "shown earlier" for a folder's work only when it was
  in one of that folder's readers' folders, so a chat's told mark never folds it at home.
- Decided with the roadmap (fix round): the fallback. A work plain reminder unsaid through its window because its
  folder had no session crosses ONCE, in the next session a person is in, 2 lived days past its last day, with its
  folder named. Live cases it covers: deadfront's 11-16 founder note (no writes there since 10-09), hearddd-v2's
  2027-03 month item, sitting-duck's 2027-03-01..10 range. Builder's calls, lightly held:
  - a lived day is a calendar day a person had a session, from the host's registry (headless entrypoints and the
    night's runner don't count), today included;
  - its latch is its own row, `prospective.plain.crossed`, not a beat, so the fold and the beat readers don't treat
    it as told on its day;
  - a late beat told in its own folder is the telling (no crossing beside it);
  - not a closed folder's, not a repeating one, not one marked done or that already happened, and not past 30 days
    after its last day (`PLAIN_CROSS_LOOKBACK_DAYS`), so an install doesn't flood a session with old ones.
- Decided with the roadmap (fix round): doctor reads "due while its folder had no session" as info, and amber only
  once the day it should have crossed has passed with a session and it still wasn't said. A presence row that names
  no session counts as its folder's (the old reading). The unsaid wording is now "due where a session could say it,
  and not said".
- Decided by the builder, lightly held: "in other folders" names up to two of the other folders' plain reminders due
  today ("garden: title", titles cut at 48 characters, then "and N more"), only in room the lines didn't need, so
  it never costs a line. Dated items that aren't plain are still only counted.
- Noted for Mike (not built): dated `about: world` items now show only in their folder (e.g. random's "Anthropic's
  rule … takes effect Nov 12"). A world-news flavour for those could come later.
- Decided by the builder, lightly held: a journal copy marked world stays personal (as `isWorkMemory` reads a
  journal copy); unmarked rows personal by kind (`self`, `person`) still cross.
- Proposed, not built (step 4 on hold): the four classes, from fields on the row, first match wins.
  0. `status: done` → no class (steps 1/2: done-but-open).
  1. Personal: `about` ∈ {me, us, owner}. Crosses folders.
  2. Mine: title or `settlesWhen` reads CHECK-AFTER, "Check due", "Check ~" or "Experiment check". Own folder and
     joined projects only.
  3. Mike's: `status: asked`, or `settlesWhen` starts "Mike" or "he". Own folder; at most once a day (step 4).
  4. World's: any other `settlesWhen`, or a future `eventDate`. Silent until the date or the settle.
  5. Else: mine.
  `said_by` is not used (it records who said a thing, not who owes it). Steps 1-2 need only 1 against the rest,
  which `threadPlace` already expresses, so no classifier code was added.
