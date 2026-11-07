- **The night closes done release steps itself, and stops asking.** When a work memory in a folder says a release
  happened ("0.3.50 released"), the night closes the open items in that folder that were earlier steps of the same
  series ("0.3.46 ready to publish", "0.3.47 after-publish steps", "0.3.48 cut"). Each close is recorded with its
  reason and the memory that showed it, and the next wake says what closed in one line under "Last night". A
  question to the owner is never closed this way. What only might be done (a pinned build whose series moved on, a
  PR a later memory says merged, or what the night's reflection wasn't sure of) is no longer asked about in the
  morning share: `recall "still open"` marks it `mayBeDone`. Say one isn't done and it reopens (the reflect tool's
  `reopen`, or a write that updates it and says it's still open).
