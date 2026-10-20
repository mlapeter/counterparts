### An experiment, Mike's go 2026-10-20, lightly held: core questions that waited a week get answered. Check on ~10-27

- **Trying**: a core memory flagged "being reconsidered" (keep, or retire to ordinary
  fading) that has waited `CORE_WAITING_DAYS` (7) lived days with no decision is offered
  to the nightly reflection, at most `CORE_ASK_MAX` (3) a night, with its unsettled pair
  when it is in one (both sides shown). The reflection decides keep or retire with a why
  where it can and leaves the rest; a plain pair it may settle after the retire. The
  morning share says what it decided in one line, with the way back. Fresh flags are not
  offered: the waking session has the first week.
- **And the wake**: "Still open" leads with a week-old one, ahead of the rest; the
  reconsidered ones take turns in one rotation, unsettled or not (#430's ask; 10-18 had put
  the unsettled ones after the plain); and a line keeps "keep or retire it" beside its
  "Unsettled — may be out of date" label instead of losing it.
- **Why**: measured 2026-10-20 on Mike's store, five core memories flagged on 10-13 had two
  answers by 10-20; three had waited 7+ lived days, two of them also in unsettled pairs for
  11–13 lived days. The wake asks one at a time, the unsettled ones never led, and the
  reflection's `core` field had no push to use. That day Mike's session answered all three
  by hand. Mike: "i agree with your recs, lightly held, lets try it and see how it goes".
- **The way back**: an awake keep (`remember`'s core keep, or `counterparts core
  --reaffirm <id> --reason "..."`) now puts back a memory a reflection retired
  (`keepCore`'s `restored`). A retire by Mike or by a waking session stays sticky, as
  before. A kept one can be retired the usual way.
- **Order of a pair**: a core memory cannot be settled over (`core-takes-pressure`), so the
  reflection retires it in `finish` first and then settles the pair, the order Mike's
  session used on 10-20.
- **Check ~10-27**: how many core questions waited past 7 lived days (doctor's Reflection
  line), what the reflection decided (`reflections.detail.coreDecided`,
  `reflection.finished`'s `coreKept`/`coreRetired`), and whether Mike reversed any
  (`band.core.restored` events, or a retire after a reflection's keep).
- **Revert by** filtering the reflection's offer back to every flagged memory without the
  prompt's push (`dream/reflect.ts`, the `core` instruction line), and `rankLanes`' `waiting`
  to an empty set; the restore door can stay.
