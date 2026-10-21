### Decided by the confidential-removal builder, 2026-10-21, lightly held (the adapters' half)

- Decided by the confidential-removal builder, 2026-10-21, lightly held: the
  `--include-confidential` flag (console) and `includeConfidential` (the dashboard's
  export action) are accepted and ignored for one release, with one stderr line, then
  removed; a database export still refuses the flag by name. `ExportReport`'s three
  omitted counts stay at 0 for the same release. Why: the flag sits in scripts and in
  the shipped changelog (Mike's Q5 ruling).
- Decided the same way: an old event row keeps reading. `blockedBy` rows carrying
  `confidential-withheld` are narrated like any verdict, and an old `store.export` row's
  `omittedConfidential` is still said, since it is true of that copy.
- The dashboard's absent-row fold stays, under a plain name (`shownOf`'s `absent`),
  and the sidebar mod's `feed.ts` is left for the mod's own release.
