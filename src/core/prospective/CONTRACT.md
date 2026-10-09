# `prospective/` — CONTRACT

## 1. Purpose

Know that the remembered future has arrived, and be *inclined* rather than *reminded*.

## 2. Brain analog

Time-based prospective memory — the intention that resurfaces on its own when the moment
comes, rather than a queue you check. **Named deviation** (constitution line 12): human
prospective memory fails toward *forgetting*; this fails toward *tact* — a system that
surfaces every stored commitment at first retrievability is a task queue wearing memory's
clothes. **Hold debts, lose deadlines.**

## 3. Keeps

- **The tact principle, which is the spec.** [v1] behavioral-spec §12 — the question for
  every fire is *is this the moment it MEANS something, or merely the first moment it's
  retrievable?*
- **Arrival is a cue, not a command. There is no bypass lane.** [v1] §12 G1 — the calendar
  turning to June is treated exactly like the user saying "Portland": one more cue into the
  same activation → gate → tier competition, under the same floors, refractory, dedup, and
  footnote-first tiering as everything else.
  **One named exception, by the owner's decision (2026-09-25/26, a working default, not a
  rule): a PLAIN item.** When the author of a dated memory marks it `remind: "plain"` —
  because the person said "don't let me forget", or it is a real deadline — it is *also*
  said outright on its day: one line to the person (the host's terminal) and the same line
  to the model, at most once per beat (a day item on its day; a month or range the first
  day it is seen open and again on its last day). That is a bypass lane on purpose, and it
  is bounded like one: no salience floor (it was asked for), but never under observer,
  never for an archived, superseded, removed or journal row, never for a year, and never
  twice for the same beat (`Prospective.plainDue` / `claimPlain`), and a beat is claimed
  only by a host about to show it (the Claude Code hooks claim after the envelope is known
  to carry the line, 2026-09-26 review). Quiet — the default —
  is everything above, unchanged. A plain item told today is not also offered as a quiet
  cue that day (`told-plainly-today`), and once its LAST beat is told (the day; a month's
  or range's last day) it leaves the wake's horizon lane for the rest of its grace
  (2026-09-29): it was said, and "Arriving:" would say it again as still to come. It
  still arrives as a cue, so recall still finds it.
- **A date can repeat, by the owner's design (2026-10-09, a working default, held
  lightly).** A dated memory may carry `recurring: daily | weekly | monthly | yearly`,
  anchored on its event date and kept in its meta beside `remind` (no schema bump): a
  birthday stored as `1990-05-14` with `yearly` comes back every May 14. Each
  OCCURRENCE is its own window, keyed by its own date (`d:2027-05-14`), so everything
  above that is per window — the fire cap, once per lived day, the plain beat, the
  referenced stop, and what a revision's `lineage` counts — is per occurrence: told once
  each May 14, never once ever, never twice. Two occurrences are never open together: an
  occurrence's window opens no earlier than the day after the last one and closes the day
  before the next one opens (the coming lead wins over the last grace), so a daily date's
  window is its day and a weekly one runs from three days before to three days after.
  A daily one takes no wake line (review of #339): it is every day, not arriving, and a
  wake rendered the evening before would date it yesterday. Only a DAY repeats; a month, a range or a year with `recurring` is refused at the door.
  **A repeat is kept alive by coming round** (owner decision 2026-10-09, held lightly):
  the first DELIVERY of each occurrence — a quiet fire the gate admitted, or a plain line
  the host claimed — counts as one use of the memory (`surfaced`, no return), credited by
  the composition root through the store's reinforce seam; this module answers only
  whether the occurrence is still undelivered (`occurrenceUndelivered`). Never for a
  one-off date or a dropped repeat. And physics' prune refuses a live repeat by name
  (`recurring`), because one use a year does not outlast a yearly gap. Fading is
  unchanged, so G10 below still holds for a repeat: a quiet yearly that faded by its next
  date is not cued that year (NOTES §16).
  Two calendar rules, counted from the anchor every time so nothing drifts: **monthly on
  the 29th, 30th or 31st falls on the last day of a month too short to have it** (Jan 31
  → Feb 28, or 29 → Mar 31 → Apr 30), and **yearly on Feb 29 falls on Feb 28 in a common
  year**. Out, loose first: every other week, "the first Monday", and anything finer
  than a day.
- **Prospectivity is DERIVED, never stored.** [v1] §12 G2 — eligibility is a predicate over
  the event date, the encode date, salience, and flags, so the property expires by itself
  when the window passes: no cleanup pass, no second source of truth, nothing for decay to
  special-case. Afterwards it is simply an ordinary dated memory.
- **Eligibility excludes what can never tactfully arrive**: task-state (structurally),
  archived memories, skill memories, undated "someday" references, year-only precision,
  and — a v2 addition, 2026-09-04 — **the journal**. A chapter's content date is the day
  it was LIVED, so "arriving" is a category error about it and no label repairs that; the
  refusal is `DerivableMemory.journal` in the predicate rather than at any one of
  `derive`'s seven call sites. Found by adversarial review when a dated chapter rendered
  in the wake's horizon lane as a thing about to happen.
  **A missing encode date fails conservatively.** [v1] §12 G3.
  **An explicit date is its own importance signal** (owner decision 2026-09-26, a working
  default): a memory whose author wrote its `eventDate` is exempt from the salience floor,
  which now gates only a date a caller extracted. Decay is not exempted — a dated memory
  faded to `FADED_STRENGTH` refuses as `faded` (G10) — and archived, skill and journal
  still refuse.
- **Precision is carried by the date's own format**, never rounded, and the ramp differs by
  precision — a stated month *means* early month more than the 29th. [v1] §12 G4. Since
  2026-09-26 there are four shapes (`core/time.ts`): a day, a month, a year (no window), and
  a RANGE `a..b` — the author saying exactly which days, so it is at full intensity for the
  whole span. The date is the `memories.event_date` column (schema v7), written by `note`
  and `session_end` as an explicit field; nothing in this module or upstream of it reads a
  date out of prose.
- **A temporal cue alone reaches the footnote tier at most.** [v1] §12 G5.
- **Once-ness has four independent brakes**: one ambient fire per occasion per lived day;
  a cap per window; session dedup; and — decisive — **once the assistant is observed to
  have used the memory, zero further fires this window.** *Remembering completes by being
  lived, not by acknowledgment UI.* [v1] §12 G6.
- **Crisis deference.** [v1] §12 G7 — arrival cues are suppressed during a refractory
  period, and the horizon beat is suppressed wholesale after a high-affect previous
  session. A window is days wide; deferring past someone's hard week costs nothing. *A
  friend doesn't pivot from the ashes to "so, June!"*
- **A rescheduled plan is correctable through a gated compare-and-swap** — the correction
  names the exact current value, carries a reason, and archives the old. [v1] §12 G8.
- **The firing key is the window itself**, which buys two properties free: a clock repair
  can never re-arm an already-fired window, and a reschedule opens a fresh window that owes
  nothing to the old one's spent budget. [v1] §12 G9.
- **No decay exemption before arrival.** [v1] §12 G10 — a future-dated memory that decays
  into insignificance before its window was an occasion that didn't matter; forgetting it
  is memory working.
- **Firing state is not canonical memory**, and the write budget is set by that cost:
  losing it risks one extra polite mention, never a memory, so contended writers skip the
  update loudly rather than stall a host-facing path. [v1] §12 G12.
- **Three dates, kept distinct** — when it happened, when it was learned, which lived day
  it was born on. [v1] §4.2. A July-4 event encoded July-6 must not be invisible to
  as-of-July-5 reasoning, and eligibility reads all three.
- **The mechanism earned its place by human rating**, not by argument: 23 of 23 fires rated
  apt by the owner. [v1] earned-mechanism #21 — the journal's cleanest human-graded result.

## 4. Drops / simplifies

- **The hand-serialized prospective ledger file is gone.** Firing state lives as rows in
  the operational database (owner rescope 1, settled). v1's `mutateProspectiveLedger` had
  three unsynchronized writers — a hook, a pre-spawn boundary call, and a lock-holding
  horizon computation — each serializing the whole map, so a stale writer clobbered
  unrelated entries too (scar §2.1). Transactions close the class.
- **Recurrence was absent until 2026-10-09.** [v1's recorded punt, kept until then]
  "Annual re-arm is scheduling physics, and scheduling physics is where task-queue
  behavior creeps back in." The owner lifted it (§3): a repeating date re-arms nothing
  and stores nothing new — each occurrence is DERIVED from the anchor at read time, under
  every brake a one-off date has. The risk the punt named is still the one to watch.
- **v1's knob set is not inherited as defaults.** Salience floor, lead days, grace days, cue
  strength, fires per window, horizon lines per wake: each ships with a recorded
  calibration and a fixture-bounded window, or ships disabled (scar §2.8). v1's values are
  recorded in §12 as the starting point.
- **The gate record that must pass before this channel turns on is kept, not dropped.**
  PR-A through PR-F are restated as v2 gates by `tools/replay/`; the discipline — commit
  the bar *before* the mechanism is allowed on — is the harvest, and the numbers are
  calibration.

## 5. Contract

**Inputs** — memories carrying an event date at a stated precision; the lived-day clock;
the cue and gate machinery of `recall/`; per-occasion firing history; the previous
session's affect summary; the observer predicate.
**Outputs** — at most a line or two on the session's horizon, framed *"remembered, not
tasks"* (day-dated items only, since 2026-09-26), and/or a temporal cue fed into the
ordinary turn-time pass; for a PLAIN item, a claimed record the host turns into one line on
its day (§3's named exception) — records, never words; firing-state transitions;
telemetry by reference; and for a repeating date, whether an occurrence is still
undelivered, which the caller turns into one credited use (§3) — this module writes no
physics.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] There is no bypass lane for a quiet item.** A temporal cue enters `recall/`
   through the same activation and gate path as any other cue; a test asserts no second
   injection path exists. The plain lane (§3) is the one named exception, and this module
   still holds no words for it — it hands out records, and a test asserts the exports.
2. **[M] Eligibility is a pure predicate, computed at read time.** Nothing stores
   "prospective"; nothing has to clean it up.
3. **[M] A missing or year-only encode date fails closed.**
4. **[M] A temporal cue alone cannot reach the loud tier.**
5. **[M] All four once-ness brakes are independently enforced**, and referenced-stop is the
   decisive one.
6. **[M] Arrival cues are suppressed during refractory, and the horizon beat is suppressed
   wholesale after a high-affect previous session.**
7. **[M] Rescheduling is a compare-and-swap that names the current value**, so a stale
   proposal cannot clobber a fresher date; the old value is archived with a reason.
8. **[M] The firing key is the window.** A clock repair cannot re-arm a spent window.
9. **[M] Firing state never advances under observer** — an evaluation must not consume the
   real store's fire budget (scar E7).
10. **[M] Out-of-window fires and fires during refractory are hard-zero criteria**, scored
    by an **independent** scorer that implements its own window arithmetic rather than
    calling the code under test — *a shared bug must not grade itself* (§17.2).
11. **[A] The horizon line's exact wording and whether a post-window grace beat is warm or
    creepy are open probe questions, deliberately.** *The words are load-bearing for tact,
    and that is an honest thing for a spec to say.*
12. **[M] Every dated memory names its exit** — fired, expired, superseded by a
    reschedule, or faded — and the counts are reported (scar §2.17).

## 6. Scars honored

**E7** (no firing-state advance under observer) · **E8** (windows, ramps, and once-per-day
brakes run on lived days) · **§2.1** (firing state is transactional rows, not a
hand-serialized map with three writers) · **§2.4** (a suppressed fire is a distinct record
from a fire that never became eligible) · **§2.8** (every ramp constant ships measured or
disabled) · **§2.16** (the "would this still be true after the date passes?" test is the
admission criterion, with a named negative example) · **§2.17** (exit paths are counted).

## 7. Open questions

1. **Is the post-window grace beat — "how did the move go?" — warm or creepy?** v1 shipped
   this as an explicit lived-probe question and never answered it. Carried forward as open,
   deliberately.
2. **Does the horizon belong in the wake briefing at all**, now that the briefing is
   ranked by strength rather than assembled from lanes? A dated memory near its window has
   a real claim on attention; expressing that as a strength modifier instead of a separate
   lane would be simpler and more brain-faithful.
3. **What replaces `session dedup` if `recall/`'s per-session gate state is not persisted?**
   One of the four brakes depends on it — see `recall/` open question 1.
4. **Is "plain" the right amount of loud?** (2026-09-26.) Once on the day, twice for a
   month or range, only on the stated span — no lead-day warning, no nag when the day is
   missed. The owner's first weeks of use answer it; nothing here measured it.
5. **What should repeat beyond a day?** (2026-10-09.) "Every October" (a month, yearly),
   "hourly", every other week, "the first Monday" — each left out, loose first, until a
   real use asks for one.
