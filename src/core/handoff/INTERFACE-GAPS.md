# `handoff/` — interface gaps

Things this module needs from a neighbour and worked around instead of editing. Each entry
names the owner, the workaround now in the code, and what the real fix looks like.

## 1. `store/` has no query by prose meta

**Owner:** `store/` (the same gap `schemas/INTERFACE-GAPS §2` records).
**Needed:** "the handoff row for THIS directory", in one query.
**Have:** `findHandoffRow` lists `{ type: "schema", kind: "place", archived: false }` — the
columns box 2 does index — and then reads prose per row to compare `meta.scope`. It is the
same shape `findSelfPage` uses for `meta.role`, and it is bounded by the number of schema
rows about places, which is a handful in any store anyone has.

**The real fix** is a meta-indexed lookup, which F5 may make cheap when bodies move into
rows. Until then: do not put this call on a hot path. It runs at a boundary (`anyLive`), at
a wake (`pointer`) and at a write, and nowhere else.

## 2. `expandHandle` has no scope filter

**Owner:** `mcp/deliberate.ts`.
**Needed:** a handoff reachable by id from the directory it belongs to, and only there.
**Have:** `recall({ handle: <id> })` expands any live row by exact id or title, and a handoff
is deliberately NOT refused there — the pointer's shape is "a line of it, and its id".
Credit is refused (`counterpart.ts#creditReferences`), so expanding one reinforces nothing;
what is not refused is the READ.

**The exposure, stated plainly:** a session that is handed another directory's handoff id can
read that body. The id appears only in that directory's own wake, so this needs a session to
be *told* an id, not to find one. It is the same shape as any other id in this store, which
is why it was not closed unilaterally — a scope filter on `expandHandle` is a change to how
every id resolves, and that belongs to `mcp/`.

**The real fix:** `expandHandle` consults the caller's scope for rows that carry one, and
says "handle-unknown" rather than "refused" so the answer carries no information.

## 3. `self/briefing.ts` owns the splice; this module owns the block

**Owner:** shared, on purpose.
**Needed:** insert two lines above the tail sentinel and keep both byte counts true.
**Have:** `spliceBeforeSentinel` lives in `self/briefing.ts` beside `applyPreface`, because
the byte fixed point, the two comment regexes and the "a damaged bundle is left alone" rule
all live there and a second copy would be the staleness the first one exists to prevent.
This module composes the block and knows nothing about the bundle.

**What it costs:** a change to the wake's comment format is now a change two modules must
agree on, and `handoff/` has no test of the bundle's shape of its own — `test/handoff.test.ts`
asserts it through `readSentinel`, which is `self/`'s own reader.

## 4. Nothing shows the handoff to the OWNER outside the fired view

**Owner:** `cli/` and `dashboard/`.
**Needed:** constitution 16 — the owner can read what the system is carrying.
**Have:** `handoff.written` / `handoff.shown` rows in the fired view and the dashboard's
event log, and the row itself readable by `counterparts show <id>` like anything else.
There is no `counterparts handoff` command, no dashboard panel, and no way for the owner to
clear one by hand short of `remove`.

**The real fix** is a small console door — list the handoffs by directory, print one, clear
one — shaped like `counterparts self-page`. It was left out rather than guessed at: the
owner has not used this mechanism yet, and the first thing he wants from it is not a thing
to decide in advance (constitution line 15).

## 5. Every handoff row is one more file `Schemas.load` reads at open

**Owner:** `store/` (F5 closes it).
**Needed:** nothing — this is recorded, not worked around.
**Have:** `Schemas.load` reads every `type: "schema"` row's prose at open, and on a v5 store
a missing prose file throws `PROSE_FILE_MISSING` from `Counterpart.open` before anything
else runs: the session stands down and doctor reads RED. That is the self page's hazard
(`docs/adversarial-review-s1c-2026-09-20.md` MAJOR-1), and a handoff row is one more of the
same, once per directory the owner works in.

**The real fix is F5**, which moves bodies into rows and removes the class. Nothing is done
here: adding a second read path for one row would be machinery bought against a failure that
is already being fixed at its root.

## 6. No host but Claude Code passes a scope at wake

**Owner:** whoever writes the next adapter.
**Needed:** `Counterpart.wake(budget, delivery, here)`'s third argument.
**Have:** only `claude-code/hooks.ts#sessionStart` passes it. Every other caller — the CLI,
the dashboard, replay — passes nothing and gets the published bundle with no pointer, which
is correct for all of them. A host that resolves a working directory and does not pass it
gets no pointer and no error, which is the quiet direction.
