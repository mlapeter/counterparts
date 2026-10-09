# `fit/` — INTERFACE-GAPS

What this module still owes, or asks of others. Newest last.

## §1. The dashboard (2026-09-28)

The lookup count is in doctor (`Lookups`). The dashboard does not show it yet, nor the queue
(`dream.begun`'s `queue`, `waiting`, `agedOut`), nor the fidelity a merge or gist was made at
(`dream_changes.detail.fidelity`). Those belong to the dashboard's own session.

**CLOSED 2026-10-01 by #306 (`a08d20d`), noted 2026-10-09:** the Health page's checks say
the Lookups line in words, the dream's `dream.begun` row narrates what waited and what aged
out, and the dreams view says what a merge or a gist was made from (its fidelity).

## §2. Other mechanisms that could fit this way

- The page writer's day (`self/writer.ts`, 8 KB by strength): one long statement can take most
  of the room; a line per statement would fit more.
- The wake's lanes (`self/identity.ts`): a "N more" pointer per lane. *(Built 2026-09-29,
  #285: `self/briefing.ts#moreLine`, every lane but Nearby since 10-01; noted 2026-10-09.)*
- One budget per hook envelope (SessionStart, UserPromptSubmit). *(Built 2026-09-29, #285,
  `b475748`; noted 2026-10-09.)*
