### Decided with Mike's go 2026-10-20, lightly held, an experiment (the wake without repeats: each episode once, no bare ids, one tag)

From Mike's 10-16 ask ("remove duplication") and two sessions' reads of the 10-20 morning
wakes in ~/counterparts and ~/random. Each is undone by its switch or by reverting the PR;
nothing is stored differently.

- **Each episode is named once, by the line that says most about it.** At a session start
  the Yesterday line leaves out the episode "Last here" names first (that line says when the
  session was here and how it began; `Counterpart#lastHereNewest`); it is neither listed nor
  counted there. Every other one of yesterday's episodes is the Yesterday line's, and the
  furniture spliced below the body leaves out what the body already names: "Before it", "+N
  more here on …" (which named them by bare id) and the about-me line (`named` in
  `handoff/last-here.ts#lastHereBlock`, the body's text in `Counterpart#addHandoffPointer`).
  The 10-20 ~/counterparts wake would read: Yesterday with the two other Oct 19 titles here and
  the SEO chapter from ~/counterparts-site; Last here with the newest; no "+2 more here", no
  about-me line. Why this split and not "Last here absorbs Yesterday": Last here's "+N more"
  names ids only, and Yesterday's titles are the better words for those; Last here's newest
  line is the richer one for its own episode. Handoffs are left as they are: a handoff is
  where work was left, named by session and its own id, never by the chapter's title or id.
  The cost: Yesterday is composed inside the body before the furniture is spliced, so when
  "Last here" itself gets no room (`handoff.lasthere.noroom`), its episode is in no line that
  morning. Not rare on a full wake with no handoff here (the review of #536: 10 of 61 ceilings
  from 8,700 to 9,300 in a full fixture; 0 of 61 with a handoff, whose reserve keeps the
  line). Seen on a test fixture: a wake that no longer has a Yesterday line
  can fit without borrowing the furniture's room, and then the leftover-room upgrade (#489 C)
  prints "Still open"'s first item as a line rather than whole; which items are listed does
  not change.
- **No bare ids as items in the Yesterday line.** A chapter with no title, or no room for
  its title, joins the count ("and 3 more"); the shorter forms give one title at a time to
  the count, down to one title, and the line drops whole below that. This reverses the
  2026-10-10 "pointers instead of titles" (a title given up left its id in its place).
  Revert: `yesterdayLine`/`yesterdayShorter` in `handoff/last-here.ts`.
- **One tag at the top, not three** (supersedes the 10-16 tag line). The onboarding and
  store markers are now fields of the wake's own head tag: `<!-- counterparts:wake meet=done
  store=st_… elements=… bytes=… -->`, where `day=` sat until 10-16, so every reader of the
  head (`OPEN_RE`, the transcript's head sighting, the forged-marker guards) reads it as
  before. The core puts them in last, after the furniture is spliced, only when the whole
  still fits the ceiling, and re-solves both byte counts (`self/briefing.ts#withHeadFields`),
  so the delivered block states its own length, the delivery check's expected tail is the one
  delivered, and the fields never take the room "Last here" needs (review of #536: put in
  before the splice, they cost that line, and with it its episode, on 8 of 61 ceilings from
  8,700 to 9,300 in a full fixture). A wake with no head tag (a resume's short line, a
  bootstrap line), or one with no room left for ~43 bytes, carries one tag of its own in
  front: `<!-- counterparts:session meet=… store=… -->`. The sidebar in this build reads
  `meet=`/`store=` from all three forms. A sidebar from before this change (the plugin's
  0.3.23–0.3.27, until it updates; Mike's is 0.3.25) finds neither and reads both as
  unknown: no store check, and the meeting's state stays unknown, so the footer keeps its
  "5-minute intro" line even after the meeting (and a new install gets no speak-first). It
  has no other read of the state: `/api/onboarding` is not fetched. Ship the plugin with the
  core. Revert: `ONE_TAG` (`adapters/store-id.ts`).
- **The about-me line says what it is and where first**: "A chapter about me from
  ~/counterparts-site: session 088bce9d on Opus 5.5, Oct 19 — "…" (epi_…)." in place of
  "About me, from another project: session …, Oct 19 in ~/counterparts-site — …". Dropped when
  the body already names the episode (above). Revert: `ELSEWHERE_HEAD` and `elsewhereLine`.
- **A plain reminder due tomorrow is not "due today" at a session start.** `plainDueOn` counts
  the day after because the evening boundary's bundle is read the next morning; the session
  start's own assembly is read the day it is made, and used the same rule, so on 10-20 an
  Oct 21 plain reminder was listed under "Coming up" (and took the lane's first room) while
  the overdue items were counted. Now at a session start it is counted with the rest of the
  dates. The deliberate 10-16 rule (overdue counted, not listed) is unchanged. Revert:
  `READ_TODAY_AT_START` (`core/briefing.ts`).
- **Every "Coming up" item carries its own id** (Mike's ask via ~/random): a recurring
  reminder printed whole showed only "(earlier: [mem_…])", its earlier occurrence's id, so a
  session had no handle for the one due. The id goes before the standing's pointer, which
  stays; the bytes are counted where the line is. How occurrences close is not changed here.
  Revert: `HORIZON_OWN_ID` (`self/briefing.ts`).
- **One copy a day when two runs start together.** The daily snapshot was taken twice ~50 ms
  apart on 10-14, 10-16, 10-17 and 10-18: two workers spawned at one boundary both passed
  "today's copy already made" before either renamed its copy in. A run now claims the day
  first (`<snapshots>/.taking-<date>`, a file created exclusively), looks again under the
  claim, and lets it go once its copy is in place or has failed; the run that finds it held
  writes nothing (`already-today`). A killed run's claim is stale after 30 minutes
  (`PARTIAL_STALE_MS`) and taken over or swept. A claim that cannot be made at all copies
  without one, as before.

**Investigated, not changed:**
- ~/random's "Last here" named 8afbccf7 (ended 10:11) while "Last said here" named c6329163
  at 11:06. "Last here" is built from chapters (`chaptersBySession` → `chaptersHere`): a
  session that has not written a chapter yet — still open, or ended without `session_end`
  and not yet written up by the night — is not in it, by design; "Last said here" reads the
  span buffer, which every turn-end fills. A resume keeps its session id in Claude Code (the
  hooks' `resumesToday` relies on it), so a resume is not the cause. Not read on the live
  store. If it should change: name the newer session with no chapter yet on the Last here
  line ("a newer session here, 10:15–11:06, no chapter yet"); left for Mike.
- "Coming up"'s order: listed are the items due on the wake's day, a plain reminder due the
  day it is read, and an undated one; every other date is counted, overdue first in the count
  line (`Self#comingUp`, the 10-16 trims, review of #511). Overdue plain reminders are said
  outright at the top (`plainDueToday`). With the tomorrow fix above, a not-yet-due item no
  longer lists ahead of an overdue one; recommendation: keep overdue counted.
