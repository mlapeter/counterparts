- **For code that embeds Counterparts: the confidential leftovers are gone from the
  API.** `confidentialByMeta`, `isConfidential`, `StoredMemory.confidential`,
  `TraitRead.confidential` / `withheld`, the `includeConfidential` option on the trait
  reads and `{ confidential }` on `memoryCountsByScopeSince` / `planCandidates`, the
  `confidential` member of `copiesOf` and `coreList()`, and the verdict and refusal
  names `confidential-withheld`, `handle-confidential-withheld`, `confidential` and
  `other-directory` no longer exist; the dashboard's JSON rows no longer carry a
  `confidential` field. Nothing changes on screen. `export --include-confidential` is
  still accepted, and ignored, this release.
