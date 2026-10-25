### Decided by Mike and the B1 builder, 2026-10-24, lightly held (an awake repeat counts, once a session)

- Decided by Mike, 2026-10-24 18:04, lightly held (night list row 22 / note B, step 1 of B1):
  a belief written in the moment that says what an existing belief says still answers
  `near-duplicate` with that belief's id, and its memory is now filed as support for it
  (`schemas.fileSupport`, route read off said_by), at most once per belief per session. Why:
  what a session notices awake should count awake, so a session at 2pm isn't a day behind the
  self. The #583 protection (eight repeats pumped one belief to 8) is kept as the per-session
  cap. Lineage #583 → B1. Switch `schemas.AWAKE_SUPPORT_ON_DUPLICATE` (default on); off is the
  old reply exactly. Check 3–5 days after the release (docs/CHECK-AFTER.md). Step 2 (a
  `supports:` field on remember) waits for that check and for E2.
- Decided by the B1 builder, 2026-10-24: "this session" is the memory's `origin_session` (what
  `remember` already writes; the field physics' spread reads), and any support row from it
  counts, the belief's own birth included. An unknown or unbound session (`mcp`) falls back to
  once per belief per lived day. The filing's `schema.support.filed` event carries
  `via: awake-duplicate`, and each awake repeat, filed or held, writes a `belief.support.awake`
  events row for the check after. The reply adds `support: {filed, route, weight}` or
  `{filed: false, reason}` beside the refusal.
