### Decided by the S2 builder, 2026-10-26, lightly held (short sessions written up; Mike: "sounds good")

- Decided by the S2 builder, 2026-10-26, lightly held: a session that left no record of its
  own owes its unwritten stretch from ONE piece (`coverage.UNRECORDED_OWED_PIECES` 1), whatever
  its span. A record is any claim that is not an in-the-moment note's (told apart by the note's
  `own` mark: a handback's memories, "nothing new", a chapter, a write-up), or a write-up mark.
  The 3-pieces-over-15-minutes floor stays for the tail after a record. Why: the Dana week
  (0.3.36) and H0's check-ins week had 3–5-turn sessions that were never owed, so never
  written up. No bytes floor (guards loose-first): a lone "hi" is owed, and the writer may
  answer it with nothing. Revert: `UNRECORDED_OWED_PIECES` very high (1e9).
- Decided by the S2 builder, 2026-10-26, lightly held: when a night would run for its catch-up
  alone because of `too-little-new`, each session owed from an earlier day counts as one new
  memory toward `MIN_NEW` (`dream.OWED_COUNTS_AS_NEW`); at three the night runs whole, the
  catch-up first. `first-day` stays the catch-up alone. Why: the addendum's "owed write-ups
  and remembers count as new material". On H0 `checkins` it moves one whole night (day 8's to
  day 7's); the catch-up-only nights it starts every morning are S2's floor change, not this.
  Revert: false.
- Decided by the S2 builder, 2026-10-26, lightly held: "Last here" names a later session with
  no chapter (the folder's newest, newer than every chapter here, with words still held or a
  memory of its own) with its newest memory — the night's write-up, or a note it made — or
  "not written up yet", and the newest chapter after it as "Before it". Recall's "the most
  recent session" is unchanged. Why: the Dana week's "Last here" named day 1's meeting until
  day 6. No switch.
- Decided in the S2 review, 2026-10-26, lightly held: a night made whole by owed write-ups
  says so (`night:owed-as-new`) and reads the dream's queue again after its catch-up; under
  `MIN_NEW` it ends as the catch-up alone. Why: the promotion is a forecast made before the
  catch-up runs, and a seat that refuses or fails the catch-up kept the debt — and so the
  promotion — every morning until it lapsed, three model children a night on too little new.
- Decided in the S2 review, 2026-10-26: a session that is not a person's conversation
  (`claude -p`, the Agent SDK) is held to the floor for the night and the pointer
  (`pointable`), small or not — on the builder's head a six-line headless run under 15
  minutes was owed, not small, and written up.
- Decided in the S2 review, 2026-10-26: "Last here"'s later session quotes only a memory
  filed in this folder (`memoryFolder`); a session at work in two folders had the other
  folder's note quoted.
- Not done, on evidence: batching several short sessions into one write-up part. H0's "36
  parts for 9 sessions" was the refusing night seat re-planning everything owed so far each
  night; with a working catch-up each night plans only the day before's sessions (1–2 parts,
  all in ONE child), and per part the extra cost is two tool turns against the child's own
  start. A multi-session part would change the door's protocol (per-session `happened_on`,
  `cover` and marks) for a few cents a night.
