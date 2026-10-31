### Decided by the FI1 builder, 2026-10-30, lightly held (folds and merges keep named ids)

- Decided by the FI1 builder, 2026-10-30, lightly held (ROADMAP 10-30 06:38): the ids go in the text, a last line
  `Names: mem_…`, because see-also reads text and it needs no store change. Not on `meta`, which would have taken a
  second reader in see-also and left the memory's words silent about what it points at. The cost: the line is in the
  word index and the vector, and it shows when the memory is shown. Measured at review on a copy of the 10-30 snapshot
  with the static embedder, the 121 dreamed rows, each fold found by its own title against the ordinary memories: in the
  top 10 for 94 with no line, 81 with one id, 70 with two, 49 with four (cosine to its own text: 0.979, 0.937 and 0.857,
  where a plain sentence added is 0.993). An id breaks into many word pieces in a mean of them. Word index: on that copy,
  30 folds with the line and 30 without, ten prompts saying "name" or "names": neither showed once. On a store of about
  200 the bare word "names" does bring one, since nothing else there says it.
- At most 4 named in all, `SEE_ALSO_NAMES_READ`, since recall reads no further. Source order, first mention first; not
  ranked by strength, which would be more machinery than a line of pointers needs.
- Fold and merge only. A plain gist's sources aren't held back. Dedup never rewrites a survivor (§5.7), and a revision's
  body is its challenger's by construction. Named in `core/dream/NOTES.md`.
- See-also now asks the folder setting of the one row it would bring (coordinator's check on #688's fence, 10-30). Tried
  first through the hook: a personal memory in a folder set off came along by a named id, since it isn't another project's
  work. The write-side check alone can't reach a fold made while the folder was on, or an id in a dream's or a person's
  own words. A cued memory isn't touched, nor a session's asking: that's #688's "an ordinary session's recall isn't
  fenced", and widening it is a separate question.
- An inhibited note's named ids don't ride along, ROADMAP's lean, for now (`core/recall/NOTES.md`).
