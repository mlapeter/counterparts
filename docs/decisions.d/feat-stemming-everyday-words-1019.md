### Decided 2026-10-19, approved by Mike as an experiment, lightly held (stemmed words and everyday-word weights in recall)

From the first-prompt recall diagnosis (`~/counterparts-notes/2026-10-19-first-prompt-recall-diagnosis.md`,
Bug 2, options 1 and 2; Mike approved both as an experiment 10-19 11:19). **Check ~10-22; revert
by 11-02** unless the live record or the bench shows them earning their place. Both apply to
ambient recall and to facts mode.

- **Trying: a cue word's rarity is scaled by how everyday the word is in English, to see
  whether question words stop outvoting the topic word.** The measure is the static table's
  own row norm (`Store.wordNorm`, potion-base-8M only): 0 at or below `EVERYDAY_NORM_LOW` (20),
  1 at or above `EVERYDAY_NORM_HIGH` (70), a smoothstep between. This revises "rarity replaces
  stop lists" in `recall/cues.ts` (the old reasoning is kept there as history). Undo: set
  HIGH <= LOW. What it cannot do, measured: the norm does not separate "tips" (79) or
  "inviting" (89) from "guitar" (80) or "kitchen" (74), so it only quiets true function words
  and a grey zone ("any" 33 → 0.17, "music" 59 → 0.89).
- **Trying: light stemming in the word index, to see whether "bake" reaching "baking" brings
  the obvious memory.** Porter's step 1 and 5a plus "-ie" → "-i", written in-repo
  (`store/stem.ts`), never inside `tokenize()`. Known merges, accepted because both sides
  agree: even/evening, morning/morn, sim/sims, horse → "hor", use/uses but not used/using
  ("news" stays "news": Porter2's exceptions are kept).
  Tokens with a digit or under four letters are never touched.
- **Cache v7, not a store bump; the re-stem runs in the worker, not at open.** Until it
  finishes (`cache_meta.terms`), lookups ask for both the surface form and the stem, so a
  mixed index loses no word recall. Measured on the bench copies: 79–126 ms for 300–366
  memories, so about 0.7 s at the live store's 2,207; one run's budget is 5 s and it
  resumes. To see it landed on a store: `cache_meta` key `terms` = `light-1` in box 3,
  `<data dir>/cache/cache.sqlite` (Mike's to open read-only, never a session's:
  `sqlite3 "file:$HOME/.counterparts/store/cache/cache.sqlite?mode=ro" "select value from cache_meta where key='terms'"`).
  A harness that rebuilds a copied store gets the same result from
  `store.rebuildCache({ keepVectors: true })` (it resets box 3, which marks it stemmed, and
  re-indexes every row stemmed) or, cheaper, `store.restemIndex({ budgetMs: Infinity })`.
- **A revert is not free.** Code that looks words up unstemmed misses every stemmed row, so
  undoing stemming means another cache bump whose worker step re-indexes from prose. The
  discount alone is undone by the two tunables.
- **Flags, not fixed:** an observer opens no embedder, so its cues are undiscounted (a live
  vs. observer divergence). The discount couples word cues to one table; another table gets
  none until someone measures it (`embed-client.ts#WORD_NORM_CALIBRATED`). Every
  `store.search` caller is stemmed (sweep, reconsolidation, dream, meaning, removal's scan,
  dashboard search), because the index is.
- **Bench, five first prompts + one facts question** (copies of `s500-m1017`; master /
  this branch before the worker's re-stem / after): the baking memory shows after the
  re-stem (it never did before); kitchen shows a target in all three; the cocktail question
  shows a target before the re-stem (in line) and after it (dark only); photography and guitar
  stay unreachable, as the diagnosis predicted; the Zumba facts rank moves 29 → 27 → 28
  (inside the bench's 30 throughout). Five questions are thin evidence either way.
