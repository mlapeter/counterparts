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
