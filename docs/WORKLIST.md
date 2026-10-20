# Worklist

*The details behind the roadmap's "To do" list. Started 2026-10-20. One entry per thing still to do: what it is,
why, where it stands. Close an entry by moving it to "Done" with the date and the PR; drop it after a release.
Experiments with a date to check live in [CHECK-AFTER](CHECK-AFTER.md); this file points there rather than
repeating them.*

---

## Being built

- **F1. The reflection closes what is plainly done** (PR #535, in review). Open threads only closed when the
  finishing session knew of them, or on the owner's yes to the morning share, so threads opened in one session and
  finished in another piled up (59 open, 12 untouched 2+ weeks on 10-20). Now the reflection closes the clear ones
  itself (`closeNow`, with a reason), says so in the share with how to undo (reflect `reopen`), and still asks about
  the unsure ones. Across folders, on Mike's word 10-20 ("i think its ok for nightly run to close threads from
  other folders"); confidential threads stay asked-only; night write-ups keep the 10-02 rule. Check ~10-24.
- **F2. Wake fixes** (Mike, 10-16: "remove duplication"). Each session named once (on 10-20 each 10-19 session
  showed twice, in ~/random up to three times); no bare `epi_` ids in the Yesterday line; the three top tags as one;
  the cross-project line readable from another folder; each Coming up item shows its own id. Looked into in the
  same lane: "Last here" naming an older session than "Last said here" (~/random); overdue items counted while a
  not-yet-due one is listed; the daily snapshot taken twice ~50 ms apart (10-14, 10-16, 10-17, 10-18).
- **F6. A weekly reminder can be marked done for this week.** The backup ran at 08:40 on 10-20 and a new session at
  ~09:15 still reminded him. Cause (~/random, from the code): an occurrence closes only when a session names the
  reminder's own id in `drewOn` (`creditDrewOn` → `prospective.actedOn`); saying it's done, or writing a "done"
  memory, doesn't touch it, and `eventDate: null` ends the whole repeat. Building: an `updates` with
  `status: done` closes this occurrence only; maybe a "done" memory beside an open reminder offers to close it.
- **F6b. drewOn credit for a memory superseded minutes earlier** (same lane as F6). It's refused as
  "faded-under-newer" even when that stale memory is what made the session catch and fix the record.
- **F7. A read-only way to see a dream's or reflection's record.** recall answers `drm_` / `rfl_` ids with
  "handle-unknown", and `counterparts dream` (it can also undo) is refused by auto mode as a change. Building: recall
  reads both ids, plus a read-only `show` on the CLI.

## Queued (waiting on a build above, same files)

- **F4. Sessions see each other's work** (after F2). "Today, elsewhere" says which sessions are open and how many
  memories they wrote, not what; two sessions did the same wake check on 10-20. Proposed: the newest one or two
  titles per live session, e.g. "~/counterparts, 08:33: wake check (mem_5701…)".
- **F5. The self page held to its room** (after F1). 4,928 B on 10-17, 4,756 then 4,956 B on 10-20, against 4,600:
  the reflection rewrites the page after the page writer and isn't held to the room, so the wake shows it whole by
  borrowing from other sections (4 → 3 this morning).

## Needs a talk first

- **Lists vs attachments.** Decided 10-15, lightly held: lists and tables stay word for word in memory bodies, no
  attachments table yet (only 2 verbatim lists in ~700 memories, both inside the ~3 KB meaning window). The trigger
  to build attachments is a real list past ~3 KB, or the bench showing blur on long bodies. Mike's long-run lean is
  toward attachments. Re-check due 10-22; it's also part of the notes-module question below.
- **The notes module.** Brief written 10-15 (`~/counterparts-notes/2026-10-15-notes-module-brief.md`): a separate
  module for exact records (the great-assistant "which drawer the VIN is in"), notes as the source layer, files plus
  an index, a deliberate notes tool, and recall pointing into notes. Recommended next on 10-19, because it's the only
  mechanism talk that leaves 0.3.27's experiments untouched.
- **Dream throughput.** About 40–55 new memories a night by priority; the queue holds at 400–590; on a busy day about
  1 in 10 new memories is ever dreamed (389 waited after the 10-20 night). Is that enough? Talk after ~10-22, so a
  change doesn't muddy #523's reading.
- **Schemas, with gist.** Beliefs and entities that grow from what's lived; the only mechanism not built. Dreams write
  about 8 gists a week, and many episodes becoming one understanding happens only by chance.
- **F3. The decisive memory stays quiet at the moment of action.** When Mike ran the backup on 10-20, ~/random was
  offered unrelated footnotes; the 10-13 decision that backups hold no conversation text never came up, and the
  memory that did was the stale one saying backups copy spans, so a non-problem got flagged. Same root as the 10-19
  big-picture thread 1 (memory and use barely touch). Take this test case, and footnote noise (~2 of 7 useful in
  ~/random on 10-20; 47% noise / 18% useful measured 10-19), into the ~10-22 check before designing anything.
- **From the retired 10-10 decisions list** ([IMPROVEMENTS](IMPROVEMENTS.md), "Decisions to review"; retired as a
  walk 10-20 with Mike's agreement, now a record). Promised a look that never came, or sent for Mike's review with
  no sign he saw it:
  - *Skill and place salience weigh 1.0* (Mike 10-10, "revisit after ~5 lived days"); no check since. His call
    to keep: skill notes could now crowd reach if they're over-written. Heading: "Decided by the Group 1a builder,
    2026-10-10".
  - *The symmetry tripwire flags only up-ratchets* (Mike 10-10, same promise, same heading); no check since. His
    call to keep: it no longer sees a memory falling too fast.
  - *Tool descriptions trimmed to what changes a call* (#415, "needs the bench A/B before merge"): merged 10-11
    with no A/B on record (the probe fixtures are still in `test/fixtures/description-probe/`). It changes what the
    model reads at every write-up. Heading: "Decided by the context-trims builder, 2026-10-11".
  - *A note claims only its own turn of the backlog* (coordinator 10-11, "for random-06's and Mike's review"). It
    decides what counts as written up. Heading: "Decided by the coordinator, 2026-10-11 (a note claims its own turn)".
  - *Routine work left at the default salience by the tool text* (Mike 10-14): "option B (scale work claims in
    code) only if the median doesn't move"; the median hasn't been read again, and option B is his to choose. Heading: "Decided by Mike,
    2026-10-14 (the Group 1 check-in)".
  - *A core memory being reconsidered that is also unsettled never takes the first "Still open" place*, against
    #430's rotation; "revisit if one sits unanswered more than a week", with nothing watching it. Keeping or
    retiring a core memory is partly his decision, so a flag he never sees matters. Heading:
    "Decided by the wake-polish builder, 2026-10-18", "Left open by the review".
- **Benchmark-motivated changes from 10-18** (Mike: lightly held, review in about a week): #516's "may be inside the
  window" label and the rest of that day's list. Due ~10-25.
- **The synthetic bench's drift**: re-tune check (BENCHMARK session's).

## Outside this repo (other sessions)

- **The plugin in Anthropic's directory** (submitted 10-14, holds waiting on a reviewer). On 10-21: if it still isn't
  approved, decide whether to make the r/ClaudeCode maker post without it (distribution, in ~/random).
- **The directory flavor** of the plugin, held (mod session).
- **The site** (counterparts.ai SEO/AEO push, in ~/counterparts-site).

## Later (on the roadmap, not scheduled)

More hosts (claude.ai needs a tunnel or a hosted piece); the dashboard walk (Health, Flow, mobile); Windows (WSL
first); the nightly run's timing (a real night run needs a scheduler); dates written into memories' words; the site
as a public roadmap. Ideas and Parked: see the [roadmap](ROADMAP.md).

## Done

- **10-20**: two stale threads closed on Mike's yes (the Han page line, the 10-09 bench plan); the 10-16 rebuild
  reminder closed (it ran as full-1017, 10-17→10-18); spans out of backups confirmed as the 10-13 design (f771a6b2);
  F8 checked: the page's "spending pauses until a product change could move a score" rests on the 10-19 rec and
  Mike's "fix real recall bugs before more benchmark spending".
