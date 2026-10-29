### Decided by the coordinator (counterparts-be) from the 10-29 read, 2026-10-29, lightly held, marked for review (K1: three knobs and a finding)

- Decided by the coordinator from the 10-29 read, lightly held: context priming's train share
  is 0 (`recall.PRIME_TRAIN_SHARE`, was 0.5). Why: train-lifted footnotes were the worst-rated
  group of the week, n 199 at 44% noise / 11% useful (on turns a person typed, n 80 at 48% / 6%),
  against link-lifted 22% / 50% (n 18). Link priming (`PRIME_LINK_UNITS`) and tag priming
  (`TAGS_PRIME`) stay as they were. Revert: `recall.PRIME_TRAIN_SHARE=0.5`.
- Decided by the K1 builder, lightly held: at 0 the train is OFF, not just weightless. No train
  is handed to scoring (`prime.ts#planPrime`), so no candidate's vector is read for it, no
  candidate gets a train head start, and the turn's row says `primed.train: false`,
  `trainCentre: null`, `byTrain: 0`. Before this, with the share at 0 the row would still have
  said `train: true` from a session's second turn, because the train exists. The train itself
  is still kept per session (one gate row, as before), so a revert to 0.5 starts warm rather
  than from nothing. Why keep it: one small row a session, and a revert that starts cold would
  read worse than it is for its first few turns.
- Decided by the coordinator from the 10-29 read, lightly held: the night's kinds ask covers 30
  cards (`schemas.TAGS_KINDS_PER_NIGHT`, was 10). Why: 144 of 207 live cards were kindless; about
  10 are born kindless a day and the night set about 7, so the backlog only grew (people such as
  Clark, Jason, Ellis and Allex were still kindless after five nights). Cost, measured by the K1
  builder: on the 10-29 snapshot copy the tags child's read goes from 16,840 to 23,688 bytes
  (card lines 3,416 → 10,264, about 340 bytes a card, widest 451); with every part at its
  widest (40 long memories, 10 look-alike pairs, 30 cards each named in four 120-character
  titles) the dream tool's result is 31,163 characters on the wire, under the 40,000 ceiling
  (`fit/TOOL_RESULT_CEILING`), uncut. The child's limits (`NIGHT_TAGS_MAX_TURNS` 8,
  `NIGHT_TAGS_MS` 5 minutes, on Haiku) are unchanged: the answer is one more call's worth of
  `kinds` items, about 45 bytes each. Revert: the value back in `src/core/schemas/tunables.ts`.
- Decided by the K1 builder, lightly held: the wake's project line (`self.WAKE_PROJECT_LINE`)
  writes a durable row, `self.project.line`, one per wake delivered in a folder that belongs to a
  project, with the line on: `shown`, `reason` (`shown`, `below-floor`, `no-room`, or
  `no-sentinel`), `lines` of `of`, `held` (the project's live beliefs), `bytes` added, `budget`,
  `was`, the belief `ids` shown, the project as `ref`, `scope`, and `session` when the host
  named one. Ids, counts and bytes, never text; no row under observer. Not written when the line
  is off or the folder has no project (nothing was asked), so off is still a clean revert. No
  `dedupKey`: each delivery is one showing, as a turn's `recall.decision` is. Why this shape:
  the brief said to follow `self.briefing.counted`, which no code writes; the nearest durable
  per-wake rows are the line's two neighbours in the same splice, `handoff.lasthere.noroom` and
  `self.work.overflow`, so it follows them (`store.appendEvent` in the events table, no store
  format change) and is registered beside them (dashboard registry, narrator, flow and lanes,
  `fired`).
- Finding, no change (K1 builder): the beliefs slot (`recall.BELIEFS_IN_RECALL`) showed only
  `sch_305a1aabc8fa` in 62 showings because, by the code as written, no other held belief can
  reach it. Of the six beliefs held on the 10-29 snapshot copy, four are about me or us and
  attach to the self subject, which has no name and is left out of the slot by design
  (`schemas/index.ts#beliefsNamedIn`: "the self is the wake's page"). Two of those four are
  above the slot's 0.3 floor (0.378 and 0.348). The fifth, `sch_4faa5260842d` (about Mike, one
  support), is offered whenever a turn names Mike but stands at 0.203 against a strict 0.3
  floor. This is not a bug against the slot's contract. Decided 10-29: page-only stays (the self lives on the page, per the wave-2 design); the owner has it as an FYI; if any later earn an ambient door, the "us" beliefs are the likelier ones. The slot's
  own read now waits until 3+ beliefs about other people pass the floor (`docs/CHECK-AFTER.md`).
  Details in `src/core/recall/NOTES.md`
  ("The beliefs slot shows one belief").
