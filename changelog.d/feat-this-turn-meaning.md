- **Recall's meaning lookup is about what you just asked.** Each turn now looks up memories by the meaning of
  its own prompt, not the exchange before it, so a change of subject is followed at once rather than a turn
  later. A store too large to look up in line on every turn still uses the previous exchange, as before.
  Asking `recall` directly is unchanged. To go back: `recall.SEMANTIC_THIS_TURN` false.
