- **Recall by meaning works on a session's first prompt.** Until now the first prompt of a
  session, and any prompt whose background cue from the turn before wasn't ready, was
  matched by words only. Those prompts are now matched by meaning too, computed on the spot
  with the same local table. It adds a few tens of milliseconds on a typical store.
- **Asking for facts ignores "how many" and "how often" wording.** Words like "many",
  "much", "often", "typical" and "usually" no longer count as part of what the question is
  about, so they stop pulling in memories that merely contain them.
