- **A memory that couldn't be saved can be saved again.** When the store was locked or full
  at the moment of writing, the note was recorded as handled anyway: nothing was stored, sending
  it again was refused as a duplicate, and its raw copy started its 3-day clock, along with
  everything else that session had said if it was a `session_end`. Now nothing is marked
  until the memory is on disk, so sending it again saves it once, and an unsaved note's words
  stay owed for a later write-up. `remember` says what happened and to send it again, and the
  failure shows in doctor. A write-up part with a memory that didn't land stays open to be
  sent again, unless it's the last part and another memory from it landed; then the reply
  says to save the rest with `remember`.
