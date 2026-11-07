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
- Decided by the builder, lightly held: a reader with no folder (claude.ai) keeps the old rule, every plain
  reminder said. Why: it has no folder of its own to wait for; holding work back there would make it never said in
  a chat. Revisit if chats should get personal ones only.
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
