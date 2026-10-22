### Decided by the build-stamp builder, 2026-10-22, lightly held (provenance; brief 2026-10-22)

- The build log is keyed by version alone. A build's settings are the ones its first writable
  open ran with. A same-version run with other settings logs nothing new, and neither does a
  downgrade and back. Why: the brief's "one row per build, never rewritten"; settings differ
  only on the harness's own throwaway stores, whose run records carry each run's settings.
- Settings are what the harness applied, mirrored into core (`setSettingsInForce`), not a diff
  against every module's defaults. Why: a core registry of the tunables would import
  `self/tunables`, which reaches `store/index.ts` (a cycle), and nothing in the product sets a
  tunable at runtime.
- Every event payload that is a JSON object carries `build`, not only the rows the brief named.
  Why: one rule in one place, reverted in one line. It is the store's envelope, not part of
  the surface set: `RECALL_DECISION_FIELDS` and `GATE_*_FIELDS` are unchanged, so
  `tools/parallel`'s hash is too.
- A memory's build is its birth build; a revise keeps it. `belief_support` and `dreams` have no
  object JSON column: support rows and the dream row join the log on their lived day, and the
  dream's own JSON rows (`dream.*` events, `dream_changes.detail`) are stamped.
