- **Ask Claude to delete one memory, with a day to change your mind.** On hosted and on a local
  install, "delete the memory about X" makes Claude find it, say which one it is, and delete it:
  it's hidden at once from recall, the wake, footnotes and the night, and erased for good after
  24 hours. "Undo that" brings it back whole before then; recall's handle `deleted` lists what's
  waiting, and the wake counts it. On hosted the erase runs on the server's own timer and the
  backups let go of it within about a day after; on a local install it's erased at the first
  session after the 24 hours. `counterparts remove <id> --confirm` still deletes at once, and
  finishes a memory deleted in chat.
- **Recalling a removed memory by its id no longer fails with an internal error;** it reads as
  not found.
- **The starter notes say so too.** Two of them changed with this: the one about seeing and
  changing what Claude keeps now says one memory can be deleted in chat and undone within a day
  (on hosted it used to say a memory couldn't be removed yet), and the tips list gains "Delete
  that". An existing install gets the new words once, at its next session, but only where those
  two notes are still exactly as they started; one you corrected or let go stays as it is.
