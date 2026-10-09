# `prospective/` — implementation notes

Choices the CONTRACT does not make, recorded here rather than left to be re-discovered
from the code. None of these is a guarantee; each is the smallest brain-faithful rule
that could work (constitution line 15), and each names what would have to fail before
machinery is added.

## 1. Calendar days for windows, lived days for brakes

Scar E8 says windows, ramps and once-per-day brakes run on lived days. That is
implemented as a SPLIT, deliberately:

- **Window bounds and the ramp are calendar arithmetic** on the event date. "Three days
  before September 4th" is not computable in lived days, because nobody has lived the
  days between here and there yet — the lived-day clock only counts backwards over days
  that happened.
- **The once-per-occasion brake is lived days.** `last_fired_day` is the store's
  lived-day integer, and `fire()` compares against a lived day the caller passes (or
  `store.livedDay()`). A week away therefore cannot spend a week of fire budget.

The scar's intent survives intact: the thing that must not be inflated by absence is the
FIRING RATE, and firing rate is on the lived clock.

## 2. Nothing in this module reads a clock

`at` (a `YYYY-MM-DD` calendar key) and `day` (a lived-day integer) are arguments
everywhere, following `recall/`'s injectable-clock pattern. Two payoffs: as-of questions
("was this arriving on July 5th?") are the same code path as today's, which §4.2's
three-dates rule requires; and every test is hermetic without sleeping or freezing time.

## 3. `task-state` is excluded by the type system, not by a refusal code

§12 G3 excludes task-state "structurally". In v2 that is literally true: `Kind` is
`self | person | entity | skill | place | fact` and there is no task member, so a
task-state memory cannot be constructed to be refused. `EXCLUDED_KINDS` therefore lists
only `skill`. Minting a `task-state` refusal code that can never fire would be a number
in a log that is not a monitor (scar §2.4) — the opposite of the point.

## 4. The salience floor reads `sal()`, never `strength()`

§12 G2 names the predicate's inputs: event date, encode date, salience, flags. Salience
is fixed at encoding, so the floor is stable and a memory cannot become prospective by
being used. Reading decayed strength here would ALSO quietly contradict §12 G10 (no decay
exemption before arrival) by turning decay into an eligibility input on the arrival path.
Strength appears in an `Arrival` for ORDERING only, and `recall/`'s ordinary gate is
where a faded memory actually loses — which is the whole "no bypass lane" claim.

`sal()` is imported from `physics/`. A local mean would be a second implementation of the
one arithmetic rule, which is exactly the divergence v1's "two clocks" produced.

**Revised 2026-09-26 (owner decision, PR #243 review).** A memory with an EXPLICIT
`eventDate` (the `event_date` column its author wrote) no longer faces the floor: choosing
a date is itself the importance signal, and an ordinary note sits at the 0.25 authored
default, so the floor made quiet reminders dead for most notes. The floor still gates a
date a caller extracted (`extraDates`). With the floor lifted, decay needed saying
explicitly, so the predicate gained a `faded` refusal — strength at or below
`FADED_STRENGTH`, the same line §8's `faded` exit uses, computed by `load()` so `derive`
stays pure. That is G10 kept, not broken: a dated memory that faded before its window
still does not arrive. Archived, journal and skill still refuse as before. Measured end to
end: a quiet `note` at the authored default reaches the footnote tier on its day and spends
its fire (`test/prospective-review-pr243.test.ts`).

## 5. Ramp shape: linear, two anchors, both CAL

`RAMP_OPEN = 0.4` rising to 1 at the peak, then falling to `RAMP_CLOSE = 0.2` at the last
grace day. Linear, because there is no measurement to justify a curve: v1 recorded lead
DAYS and grace DAYS and never a shape at all, so any curve here would be invented
precision (scar §2.8). The month case falls out of the same two anchors — a month window
peaks on the 1st and decays across the whole month plus grace, which is §12 G4's "a
stated month *means* early month more than the 29th" as arithmetic rather than as a
rounded date.

Replace this with a measured shape when `tools/replay` has one; until then it is two
numbers in the TUNABLE table where they can be audited.

## 6. A fire is a surfacing that HAPPENED, not an offer that was made

`arrivals()` writes nothing; `fire()` is a separate call the caller makes after
`recall/`'s gate actually admitted the memory. This mirrors `recall/`'s build/record
split and it is what makes "arrival is a cue, not a command" structural: nothing in this
module can cause the surfacing whose budget it counts, and a session that computes
arrivals and then decides to stay quiet has spent nothing.

The brakes therefore run TWICE — advisory in `arrivals()` (do not offer a cue for a spent
window) and authoritative in `fire()`. They are one function, `brakeFor`, so the two
paths cannot disagree about what a spent window is.

## 7. The four store states, and why `expired` is both written and derived

| state | meaning | who writes it |
|---|---|---|
| `armed` | a derived window, no fires spent | `arm()`, `reschedule()` |
| `fired` | >= 1 ambient fire spent; budget may remain | `fire()` |
| `suppressed` | TERMINAL by referenced-stop — the decisive brake | `reference()` only |
| `expired` | TERMINAL: the window closed, or a reschedule replaced it | `expire()`, `reschedule()` |

`expired` is also what a row with NO stamp reads as once its window passes, because
`phaseOf()` says so. That is §12 G2 doing its job: the property expires by itself and
nothing has to sweep. `expire()` exists for the explicit case (a reschedule retiring a
window), never as a cleanup pass.

Terminal states are never resurrected. `arm()` on a spent key keeps the spent state — the
firing key is the window (§12 G9), so a clock repair, a replayed hook, or a stale caller
cannot re-arm what is done.

**arm records, fire judges.** `arm()` accepts any well-formed key without re-deriving,
where `fire()` re-derives every time. The asymmetry is deliberate and cheap: an arm is a
note-to-self about a window, and a wrong one is inert — `fire()` refuses it as
`window-not-derived`, `arrivals()` never offers it, and `exitReport()` classifies it as a
window that passed. Nothing downstream trusts a row, so nothing is gained by making the
cheap write expensive.

## 8. The `faded` exit is defined here, not in the contract

§5 G12 names four exits — fired, expired, superseded by a reschedule, faded — without
saying what separates the last two. The rule implemented: a window that closed with zero
fires exits **faded** when the memory is archived, or when its decayed strength is at or
below `FADED_STRENGTH` (defaulting to physics' `PHI_PRUNE`); otherwise **expired**. The
distinction is worth having because it answers different questions: `expired` means the
occasion passed unremarked, `faded` means the memory itself stopped mattering first,
which is §12 G10 working rather than a miss.

`referenced` and `open` are counted alongside the contract's four. A window that ended
because the memory was actually USED is the best exit there is, and folding it into
`fired` would hide it.

## 9. Recurrence stays absent, and so does anything that could grow into it

**Was true until 2026-10-09** — the owner lifted it; §15 is what replaced it.

No re-arm, no next-occurrence, no "annual" flag, no date arithmetic that produces a date
the author never stated. The recorded punt (CONTRACT §4) is not a to-do: annual re-arm is
scheduling physics, and scheduling physics is where task-queue behavior creeps back in.
A birthday that matters will be remembered again, by being lived again.

## 10. Open, deliberately

CONTRACT §7's three open questions are untouched by this implementation:

1. Whether the post-window grace beat ("how did the move go?") is warm or creepy. The
   grace days exist and the ramp tails through them; whether anything is ever *said*
   there is not this module's call, and the wording — which is load-bearing for tact —
   does not exist anywhere in this directory.
2. Whether the horizon belongs in the wake briefing at all, or should be a strength
   modifier. `horizon()` returns records, not lines, so either answer stays reachable.
3. Session dedup's home — INTERFACE-GAPS #3.

## 11. Two durable rows, added 2026-09-20 (E2)

Until today this module wrote no event at all — the 2026-09-17 mechanism inventory found
"zero `appendEvent` in the module" and marked both prospective rows RING-ONLY. `fires` is
a counter and `last_fired_day` is one day, so the store could say a window had ever fired
and never *when*, never how often, and never why one did not. The owner's fourteen windows
carried counters from a v1 import with `last_fired_day` null on every one, and nothing
could tell that from a mechanism working quietly.

**Two names, not one with an `outcome`.** `prospective.fire` for a fire,
`prospective.fire.refused` for a brake that held. A refusal counted as a firing is exactly
the bug the fired view exists to catch, and two names keep them apart in every reader by
construction — the same split `snapshot.taken` / `snapshot.failed` makes for the same
reason.

**The refusal is latched per memory, window, reason and lived day.** Eligibility is
re-derived every turn (§12 G2), so an unlatched row would write once a turn forever for a
window whose date has passed. Latched, it says "this window was stopped by this, on this
day", which is the smallest fact that answers the question.

The ring emits are untouched: they are the live debugging channel and they die with the
process. What is new is the half that outlives it.

**Was true until 2026-09-26:** `fire()` had one caller in the whole tree
(`tools/demo/seed.ts`). §12 names the live one.

## 12. PR B, 2026-09-26: reminders actually working

Owner decisions of 2026-09-25/26, all experimental working defaults.

**The date is a field the model writes.** `note` and every `session_end` entry (so the
write-up door too — it deposits through the same `depositEntries`) take `eventDate` in the
v7 shapes and `remind: "plain" | "quiet"`. The MCP adapter checks the date with
`time.ts#parseCalendarDate` before anything is captured and refuses an unreadable one by
name, listing the shapes; `remember/proposals.ts#intake` checks it again at the one front
door (`EVENT_DATE_UNREADABLE`, `REMIND_UNKNOWN`). `mint.ts` writes it to the column and
`remind` to `meta.remind` (`CUE_MODE_META`) — no schema bump. `remind` with no date is
dropped, counted, and said in the tool's reply; the memory still lands. The sweep never
dates anything.

**The caller of `fire()` is `Counterpart#spendArrivals`, reached from
`Counterpart#recallForTurn`** — the UserPromptSubmit hook's recall. `recallForTurn` now
reads `arrivals()` itself (so each cue keeps its window key), hands the cues to recall as
`turn.temporal` (so `composeTurn` does not read them a second time), and after the gate
spends one fire for each arrival whose memory the turn actually surfaced or footnoted. An
aborted turn spends nothing; an observer's `fire()` stands down on its own. The wake's
horizon lines do NOT spend a fire: the bundle is rendered at a boundary and served to
every session until the next one, so a render is an offer, not a surfacing. They are
bounded anyway, because `horizon()` reads `arrivals()` and a spent window is not offered.

**Enumeration is the index.** `arrivals()` asks `Store.datedMemories(at − GRACE_DAYS,
at + LEAD_DAYS)` — exactly the memories whose window can be open — plus any `extraDates`
ids; `exitReport()` asks `datedMemories` over all time with archived rows included, plus
`Store.prospectiveMemoryIds()` for rows that outlived a cleared date. No `store.list()`
scan remains. Two consequences: `window-not-open` and `window-passed` are now reachable
only through a caller's `extraDates` (the index never hands over a date whose window is
shut), and the old sources are gone — `happenedOn` (a past date by name, and every
belief's `statedOn` lands there) and the `meta.eventDate` convention (nothing ever wrote
it). Nobody had dated memories yet, so nothing was migrated.

**Range precision, and year.** A range `a..b` opens `LEAD_DAYS` before `a`, holds full
intensity from `a` through `b` (a plateau: "late October" means all of it), and decays
through grace after `b`. Its key is `r:a..b`. A year still has no window and is never told
plainly: it names no day it could mean.

**The four July tune questions** (bansai `eval/replay/GATES.md` finding 3), each with an
acceptance test in `test/prospective-reminders.test.ts`:

- (a) *Stagger month warmth.* A month's peak is its 1st plus a stable per-memory offset
  (FNV-1a of the id, mod `MONTH_STAGGER_DAYS` = 7). The window KEY is unchanged — the
  stagger lives only in `peakOn` — so G9 holds.
- (b) *Space a month's fires so it gets an "after" beat.* With `FIRES_PER_WINDOW >= 2`, a
  month or range window's last fire is held (`held-for-after`) until the stated span has
  ended; it can then land in grace. Applied to ranges too, since a range front-loads its
  budget the same way. A day window is untouched: it already had grace.
- (c) *Only day-dated items take wake lines.* `horizon()` filters to day precision. Month
  and range items still arrive as cues every day of their windows.
- (d) *Imminence breaks salience ties.* `arrivals()` sorts by ramp × strength; scores
  within 1e-9 are a tie, broken by days until the span starts, then span width (narrower
  first), then key. The v1 caveat — month items must not be starved by a stream of
  imminent day items — is bounded as v1 said: each occasion needs at most two slots, and
  (c) already takes months out of the wake entirely.

**Plain items** (CONTRACT §3's named exception). `plainDue({at})` lists plain memories
whose STATED span covers `at` (no lead, no grace) and whose beat has not been told;
`claimPlain` writes the `prospective.plain` row with a `dedupKey` per memory, window and
beat, and returns true only when this call wrote it — so two hook processes cannot both
say it. `Counterpart#plainDueToday` reads and adds `what` (title, else the first line);
`claimPlainReminder` claims one; `plainReminders` is the two together. The claude-code
adapter words it (`hooks.ts#plainLine`, clipped to `PLAIN_WHAT_MAX_CHARS`), puts it under
the `Now:` line for the model, and returns it as `notices` + `plain` for the terminal's
`systemMessage` at SessionStart and at a prompt (a day that began mid-session is said at
the next prompt) — UNCLAIMED: `bin/hook.ts#deliverTurn` claims only once it knows the
envelope carries the line (see the review, below). Beats: `day` on the day; `opens` the first
day a month or range is seen open; `last-day` on its last day. The latch is by beat, and a
beat belongs to a CALENDAR day — not the lived-day counter, which only moves at a boundary
and would keep "today" shut all morning. No salience floor: the floor gates unasked
surfacing, and an ordinary note sits at the 0.25 authored default. A plain item told today
is not also offered as a quiet cue that day (`told-plainly-today`). A confidential one is
told only in the owner's own session, recall's boundary gate kept by hand.

Two edges, named by the builder. The model's copy sits under the `Now:` line, above the
wake block; the delivery check finds the wake's sentinels by searching the attachment's
text, not by line, so the extra lines cost it nothing. The second — a beat claimed before
anyone knew the envelope would carry it — was FIXED by the review (below).

**The review's fixes (2026-09-26, `docs/adversarial-review-pr243-2026-09-26.md`).**

- *Claim only what is certainly leaving.* The adapter returns plain lines UNCLAIMED;
  `bin/hook.ts#deliverTurn` puts them first among the notices, probes the envelope, and
  claims (`ClaudeCodeAdapter#claimPlain`) only if it fits. No room — a ~9 KB wake at
  SessionStart leaves none in the host's 10,000-character envelope — means no claim, and
  the lines are stripped from the model's copy too (`withoutPlain`), so the first prompt
  says them instead. A claim lost to another process strips the same way. The update
  notice can no longer cost a plain line that fit: when the two do not fit together, the
  delivery without the update notice stands.
- *The page writer's headless child* (`COUNTERPARTS_PAGE_WRITER`; removed with host mode
  2026-09-29 — the nightly run's child, `COUNTERPARTS_NIGHT_RUN`, is told nothing the same way) is told nothing, so it
  cannot spend a beat nobody sees (`HookInput.pageWriter`). Any OTHER headless `claude -p`
  with the hooks on still can: SessionStart gives no sign it is headless.
- *Said outright means not also cued* on the same prompt: the plain ids are withheld from
  that turn's temporal cues (`recallForTurn`'s `withhold`), since the claim that makes
  `told-plainly-today` true now lands after recall.
- *A fire row carries its calendar `date`*, as the plain row does, so the fired view counts
  it on the day it was asked in any zone (the gauge test failed in Pacific/Auckland).

The dashboard's "N today" counts rows on the current LIVED day, like its seven-day window;
it stays on yesterday's number in the morning until a boundary moves the clock.

**Still not wired:** `reference()` (brake 4, referenced-stop) has no live caller — when the
model uses a dated memory, nothing yet stops its window. Session dedup (brake 3) is still
in-process only, and every hook is its own process, so in live use brakes 1 and 2 are the
ones doing the work. No bad-day or crisis switch was flipped: `refractory` and
`previousSessionHighAffect` exist, and no live caller passes them.

## 13. A revision owns the reminder (review N7, 2026-09-26)

The review's N7 said a `note` with `updates:` and no `eventDate` minted an undated
successor, "once the old one is superseded the reminder is gone". The premise was half
right: revising an ORDINARY memory is link-only (`revision.ts`'s table) — nothing
supersedes it — so the old row kept its date and kept coming back, while the newest version
of the thing was undated. Carrying the date over alone would therefore have doubled the
reminder (two live dated rows; the plain latch is per memory, so said twice on its day),
and a reschedule already left the old day firing.

So the carry and a move, in `Counterpart#carryReminder` / `#moveReminder`, on the authored
path only: field by field, what the author sent wins, `eventDate: null` drops the date,
anything left out comes from the memory being revised; then the revised row's date is
cleared with `Store#revise({ eventDate: null, reason: "reminder-moved" })`, which keeps the
old date in its version (constitution 7). One reminder, on the newest memory. `remind`
carries on its own, so a reschedule of a plain item that does not repeat `remind` stays
plain, and `remind` alone on a revision reshapes the carried date rather than being
ignored.

Only for an address the author DECLARED and the store resolved. A content-matched link is
the engine's guess; moving a date off a guessed row would be a wrong write, and leaving it
where it is loses nothing. The sweep never dates anything and builds its proposals without
a `DateIntent`, so it neither carries nor moves.

**The adversarial review of #247 (same day) closed three holes in the first cut.**
(`docs/adversarial-review-pr247-2026-09-26.md`.)

- *The reminder is found where it moved.* The old row stays LIVE after a move (link-only),
  so recall keeps showing it and the model's next `updates:` names it again — the normal
  case, not an edge. The first cut read the date off that row only, found none, and so a
  cancel by the old id did nothing (silently) and a reschedule by it minted a second dated
  row beside the carried one, at quiet. Now the move writes `meta.reminderMovedTo` on the
  old row in the SAME `revise` that clears its date, and `Counterpart#reminderHolder` walks
  that chain (each hop through `Store#resolve`, bounded by `DATE_LINEAGE_MAX`) to the
  live memory holding the date; `from` in the reply names that holder. A cancel that finds
  no dated memory at all now says so (`reminder: { cleared: false }`).
- *A move is not a new reminder.* The plain latch and the quiet firing rows are keyed by
  memory id, so the successor started with nothing spent: a month or range already opened
  was told "opens" again on any later day of it (not only the same day, as first noted), and
  a quiet window the assistant had already used came back with a fresh budget. The
  successor's `meta.reminderFrom` names its predecessor, and `lineage` lets the plain reads
  (`plainTold`, `plainToldOn`) and the brakes (`firingRowsFor`, in `arrivals` and `fire`)
  count what was spent for the SAME window key on the memories it moved through. A new date
  is a new key and starts fresh, as `reschedule` does. Read-side on purpose: copying the
  plain rows would have added `prospective.plain` rows for tells that never happened.
- *An archived holder carries nothing*, matching `revision.ts`'s `target-archived`: a
  reminder that faded or was put away is not revived onto a live row by a revision.

Still open, left alone: the old memory's firing rows stay where they are, so `exitReport`
can count a moved window twice (once per memory); and a failed clear (`moved: false`,
evented, `unmoved: true` in the reply) leaves the reminder on both rows — a double, never a
loss, because the successor is minted first.

## 14. A told plain reminder leaves "Arriving" (2026-09-29)

A dated memory stays in the wake's horizon lane from `LEAD_DAYS` before its date to
`GRACE_DAYS` after. A PLAIN reminder that was said outright on its day then sat in
"Arriving:" for a week more, as though still to come. `horizon()` now leaves out a plain
arrival whose window's LAST beat is told (`toldForGood`: `day` for a day item, `last-day`
for a month or range). Only the lane: `arrivals()` is unchanged, so recall's cue path still
finds it; quiet reminders are unchanged; a plain reminder whose day passed UNTOLD (no
session that day) keeps its grace week in the lane.

Named, not proved through the lane: month and range items take no wake line at all
(tune question c), so the `last-day` half of the rule has no visible effect today. It is
written for both precisions so the two cannot drift if that changes.

## 15. A date that repeats (2026-10-09, the owner's design, held lightly)

`recurring: daily | weekly | monthly | yearly` on a `note` or `session_end` entry, beside
`eventDate` and `remind`, anchored on the event date. What the build chose:

- **Where it lives: `meta.recurring`, beside `meta.remind`** (`store`'s `RECURRING_META`).
  No schema bump: the owner wanted it in 0.3.13 without a store-format change, and a
  build that never heard of it (0.3.12) reads the same file and sees a one-off date that
  has passed — inert, never wrong in the loud direction. The anchor stays on
  `event_date`, as stated, so `datedMemories` keeps its meaning ("the date as stated
  reaches this span"); `Store.recurringMemories()` is the other half — live rows with a
  day `event_date` and the word in meta, a loose text match on the meta (as
  `planCandidates` does for `unresolved`) that the parsed meta confirms. `arrivals()` and
  `plainDue()` union the two; `time.ts#occurrenceBetween` decides which repeats reach the
  span.
- **Prospectivity is still derived.** `contentDates` carries the rule to `derive`, which
  asks `windows.ts#recurringWindowAt` for the ONE occurrence window open on `at` — or the
  next, pending. Nothing is re-armed and nothing is stored per occurrence until it fires,
  exactly as a one-off date. A repeating date therefore never reads `window-passed`.
- **The key is the occurrence's date** (`d:2027-05-14`). That one choice makes every
  per-window brake per occurrence without a line of its own: `FIRES_PER_WINDOW`, once per
  lived day, the plain latch per beat, referenced-stop, `told-plainly-today`. And it is
  what keeps a revision from telling or firing the same occurrence twice: `lineage`
  (§13) counts what was spent "for the SAME window key" on the memories a reminder moved
  through, and an occurrence's key does not change when the words do. A revision that
  moves the anchor to another day of the year starts fresh, like a reschedule.
- **Two occurrences are never open together.** Lead (3) and grace (7) make a window
  eleven days wide, so a weekly date would have two open and a daily one eleven, each with
  its own fire budget — a task queue by arithmetic. So each occurrence's window opens no
  earlier than the day after the previous occurrence and closes the day before the next
  one opens: the coming lead wins over the last grace. Daily: the day. Weekly: Friday to
  Thursday around a Monday. Monthly and yearly: untouched.
- **Only a day repeats.** A month, a range or a year beside `recurring` is refused at the
  door (`recurring-needs-day`, `RECURRING_NEEDS_DAY`); a revision that moves a repeating
  date to a month drops the repeat and says so. "Every October" is an owner question
  (CONTRACT §7.5), not a gap.
- **The calendar is `time.ts`'s**, counted from the anchor every time: monthly on the
  29th–31st falls on the last day of a shorter month; yearly on Feb 29 falls on Feb 28 in
  a common year; never an occurrence before the anchor. `readableRecurrence` gives the
  words ("every May 14", "every Monday", "every month on the 31st", "every day"), from the
  anchor so a February occurrence of the 31st still reads as the 31st. Words live there,
  not here: this module still exports nothing that produces text.
- **Carried field by field on `updates`** (`Counterpart#carryReminder`): sent wins,
  `null` stops the repeat (the date stays, once), left out comes from the memory being
  revised. The old row keeps its `meta.recurring` when its date is cleared — inert with no
  date, and kept in its version either way.

Named, not fixed: `exitReport` (§5 G12, "every dated memory names its exit") sees a
repeating memory's CURRENT or next occurrence, plus any past occurrence that left a firing
row. A past occurrence nobody fired — a quiet birthday in a week with no sessions, or a
plain one told only through the plain latch, which writes an event and no firing row —
exits nowhere, so G12 is narrower for repeats than for one-off dates. And a past
occurrence's row is re-derived with `windowFor`, which does not know the clipping, so its
phase can read a few days long. Both only colour the exit count. The dream's
"coming up" list and the dashboard's "ahead" list read `datedMemories` alone, so they do
not show a repeating date's next occurrence yet.

Review of #339 (2026-10-09), measured through the hooks with an evening boundary each
simulated day:

- **A daily repeat takes no wake line** (`horizon()`). The wake is rendered at the
  boundary with `at` = that evening's day (`runner.ts`) and read the next morning, so a
  quiet daily read "due <yesterday>, every day" at every first wake, and kept one of the
  two lines for good. A one-off's date is fixed, so a day-old render of it stays true. A
  plain daily is still said outright each day; a quiet one still cues recall each turn
  (one fire a day). A weekly one keeps its line; rendered on the Thursday it closes, it
  reads last Monday at Friday's wake — one day in seven, like a one-off's grace.
- **A quiet weekly spends both fires in its lead** when it is surfaced every day: Friday
  and Saturday, and nothing on the Monday itself. That is the one-off rule (a day window
  holds no fire back for its day); a repeat just shows it every week.
- **Decay still holds, and a repeat has to outlive it** (named here; the owner's answer
  is the next section). A memory noted at the default salience fades below `FADED_STRENGTH` and becomes
  prunable at about 152 lived days unless it is used: `derive` then refuses it as
  `faded`, and once prune archives it `recurringMemories()` no longer finds it, so even a
  plain repeat stops. A one-off dated that far out has the same fate; a birthday or a
  daily pill is meant to last for good.

## 16. A repeat is kept alive by coming round (2026-10-09, the owner's decision, held lightly)

The answer to §15's last bullet. **Each occurrence that is actually delivered counts as a
use of the memory**, the way rehearsal keeps a memory alive, and the prune refuses a live
repeat by name. What the build chose:

- **Delivered, not computed.** The two points where an occurrence certainly reached
  someone: a quiet fire (`fire()`, which `Counterpart#spendArrivals` calls only for an
  arrival the gate put in the turn's surfaced or footnoted set) and a plain line the
  host claimed (`claimPlain()`, which the hooks call only for a line their envelope
  carries). The wake's horizon lane is not one: it is rendered at the boundary and read
  later, and a weekly or longer repeat in it also cues recall, which fires.
- **Credited by the composition root, not here.** `Counterpart#creditOccurrence` calls
  `store.reinforce(id, day, "surfaced")` — the seam recall's credit ends in, so physics'
  own refusals (birth day, already credited today) hold. This module only answers the
  read `occurrenceUndelivered(memoryId, windowKey)`, asked BEFORE the fire or the claim:
  the memory still repeats (`recurrenceOf`, read now) and nothing has delivered this key
  yet — no fire row with a fire spent, no plain beat told, on the memory or one its
  reminder moved from (`firingRowsFor`, `plainTold`). Firing state stays firing state; no
  new durable row and no new event name, because the two latches already there are the
  record of a delivery.
- **Once per occurrence.** A quiet weekly fired on two lived days is credited on the
  first; a plain weekly fired quietly in its lead and told on its Monday is one
  occurrence, credited at the lead fire. A daily one is credited each day it is said.
- **`surfaced`, not `referenced`.** It was shown; nothing says the reply used it. And a
  surfaced credit earns no return (`creditReturn` refuses `not-referenced`), so a daily
  reminder about myself cannot reach the core's slow lane on the calendar alone.
- **Not a one-off, and not a dropped repeat.** `recurrenceOf` is read at the moment of
  credit, so a one-off date (its key `d:2027-05-14` looks the same) is never credited,
  and a repeat revised with `recurring: null` stops being credited from that revision on.
- **The prune's sixth gate** (physics NOTES, 2026-10-09). One credit a year does not
  carry a yearly repeat across 365 lived days at the default salience; measured through
  the hooks, the test's birthday was let go 263 lived days after its first May 14
  without the gate. `pruneVerdict` refuses `recurring`, as it refuses `protected`.

Named, not fixed — **a quiet yearly still fades** (the owner kept fading and display as
they were). Between its dates a default-salience yearly falls under `FADED_STRENGTH`;
`derive` then refuses it `faded` at its next occurrence, so a QUIET one is alive,
unpruned and not cued that year. A PLAIN one is still said (`plainDue` reads no decay, as
before) and credited. Daily, weekly and monthly repeats are credited before they fade.
A higher salience, or the owner exempting live repeats from the `faded` refusal too, are
the two ways to change it; neither is built.

Named, not fixed — **the same-day stronger credit.** If the reply also quotes a repeat
that recall surfaced loud on the turn its occurrence fired, the boundary's `referenced`
credit for it is refused `already-credited-today` (physics' one credit a lived day): that
day counts at 0.25 instead of 1, with no return. Only a repeat, only on the day its
occurrence is first delivered, and only when it was loud; a temporal cue alone is
footnoted and earns no boundary credit anyway.
