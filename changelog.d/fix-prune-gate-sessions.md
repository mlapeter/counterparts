- **Recall's per-conversation bookkeeping no longer piles up.** The record of what each
  conversation was already shown (so nothing repeats) is now cleared once a conversation
  has gone unused for the retention window, 90 days of use by default, in the nightly run
  beside the old-version cleanup. A conversation used inside the window keeps all of it.
