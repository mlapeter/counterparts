### Decided by the SO1 step 2 builder, 2026-11-07, lightly held (a done memory is never overdue)

- From Mike's 11-07 brief (SO1, Fable review item 3): `status: done` with a date already
  behind the day asked about reads the date as when it happened. The read side does it in
  `prospective/derive.ts` (a new refusal, `done`, off the row's status at derive time, plus
  the same skip in `plainDue`), so every reader of the horizon (the wake's Coming up, its
  overdue count, the `coming up` handle, Arriving, the cue path) agrees, and rows written
  before it need no migration or store-format change.
- "Behind" is the date's last day before today (`lastDay < at`), the same boundary as the
  write's "That date has already passed" note. A done dated today still shows as due today
  and leaves the next day; a month or range still running is left alone. A done with a
  future date is left alone too (ambiguous; not this step).
- A repeat is exempt on both sides: a done at a repeat closes one occurrence
  (`closeOccurrence`), and a repeating row marked done still comes round.
- The write side (`server-args.ts#doneDateAsOccurred`, both `remember` and `session_end`)
  turns a passed eventDate on a done write into `occurredOn`, keeps an `occurredOn` sent
  too and different, and says it in `facts.dropped` (field `eventDate`). It skips a write
  with `updates`: its target may repeat, and the deposit's own close decides it; the read
  side covers a done one-off revision either way. A done write no longer gets the
  "reads like a reminder but has no eventDate" hint.
