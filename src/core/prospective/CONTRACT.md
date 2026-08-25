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
- **Prospectivity is DERIVED, never stored.** [v1] §12 G2 — eligibility is a predicate over
  the event date, the encode date, salience, and flags, so the property expires by itself
  when the window passes: no cleanup pass, no second source of truth, nothing for decay to
  special-case. Afterwards it is simply an ordinary dated memory.
- **Eligibility excludes what can never tactfully arrive**: task-state (structurally),
  archived memories, skill memories, undated "someday" references, year-only precision.
  **A missing encode date fails conservatively.** [v1] §12 G3.
- **Precision is carried by the date's own format**, never rounded, and the ramp differs by
  precision — a stated month *means* early month more than the 29th. [v1] §12 G4.
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
- **Recurrence stays absent.** [v1's recorded punt, kept] Annual re-arm is scheduling
  physics, and scheduling physics is where task-queue behavior creeps back in.
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
tasks"*, and/or a temporal cue fed into the ordinary turn-time pass; firing-state
transitions; telemetry by reference.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] There is no bypass lane.** A temporal cue enters `recall/` through the same
   activation and gate path as any other cue; a test asserts no second injection path
   exists.
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
