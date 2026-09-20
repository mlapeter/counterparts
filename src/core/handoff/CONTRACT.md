# `handoff/` — CONTRACT

## 1. Purpose

Carry, for one directory, *where the work stands and what to pick up next* — and stop
carrying it. One live pointer per place, delivered at the wake of a session that opens
there, and never a memory.

## 2. Brain analog

**Prospective working context**, not episodic memory: the note you leave on the bench about
the half-finished job, which is useful for a fortnight and then is clutter. Human memory
keeps this in a different register from what was *learned* — it is bound to the place and
the task, it does not consolidate overnight, and it is not part of who you are.

**Named deviation** (constitution line 12): the brain does not keep a per-directory ledger.
The directory stands in for the place-and-task binding a person gets for free, because in
this host a directory is what a piece of work *is*.

## 3. Keeps

- **The lane itself.** [v1] `task-state` — an expiring, non-consolidating store of "what I
  was doing here". v1 had it, it worked, and the clean-room rebuild dropped it. The spec's
  §6.4 and §15 item 6 are where it comes back, in the owner's words: today he types "prep a
  handoff so we can pick up from here in a new session", and he wants that to happen on its
  own.
- **One ask, one pacer.** [v2, `self/CONTRACT.md` §13 G3's scar] The handoff is a FIELD on
  the `session_end` call the end-of-session ask already names. There is no second ask, no
  second tool and no second pacer; growing the blocked moment back into two asks is the
  measured failure that scar is named for.
- **Refused, never cut.** [v2, S1's rule] Past `HANDOFF_MAX_BYTES` the write is refused with
  a named reason: what gets cut at write time is the only copy.
- **Every entrance passes the battery.** [v2, SEAMS H] A handoff is prose written in a hurry
  at the end of a session, which is exactly the kind of text a credential gets pasted into.
- **A cap reports what it refused, where the owner will see it.** [owner ruling 2's
  corollary, 2026-09-18] Refusals are durable rows, not silence.
- **Furniture, not an element.** [v2, the self page's placement] The pointer carries no
  `- ` bullet, enters no lane, and leaves `counts` and the sentinel's `elements=` true of
  the bundle that holds it.

## 4. Drops / simplifies

- **No forgetting mechanism of its own.** The pointer stops showing after
  `HANDOFF_LIFE_DAYS` lived days; the row is then let go by the ordinary prune, because it
  is born unprotected in the episodic band with nothing on any salience dimension. Adding a
  sweep for it would be a second forgetting for one row (constitution line 15).
- **No archived row per revision.** A newer handoff for the same directory REVISES the same
  row, so the one it replaces is an ordinary version, bounded by the ordinary version
  retention. The self page's precedent; the alternative leaves superseded rows for every
  reader of `list()` to skip.
- **No doctor line.** The fired view carries both halves, and a handoff that nobody left is
  not a fault.
- **No second lane in the wake, and no new trim order.** The pointer is reserved for, not
  ranked.
- **No scope registry of its own.** The directory arrives as a string from the adapter that
  resolved it (`adapters/scopes.ts`); this module canonicalises nothing.

## 5. Contract

**Inputs** — a body, a canonical directory, a session id (or null), the lived-day clock,
and a gate (`bridge.episodeGate`, injected).
**Outputs** — one schema row per directory with `meta.role = "handoff"`; a two-line pointer
block for a given directory and day; three durable event names.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] It is never a memory.** It is out of the recall scan (`recall/activate.ts`), it
   takes no use credit even when a session expands it by id
   (`counterpart.ts#creditReferences`), it is skipped by dedup (`sleep/types.ts#isSchemaRow`),
   it is invisible to the schemas index (`toMetaRecord` returns null for its role), and
   `scanActive` lists `{ type: "memory" }` so it can reach no briefing lane. With `uses` and
   `reinforced_days` structurally pinned at zero, `physics#promotionEligibility` can never
   be satisfied and the row can never cross into the identity band.
2. **[M] One live row per directory.** A second write revises the first; the body it
   replaces is a readable version on the same row. Last writer wins, loser kept.
3. **[M] The body is refused past `HANDOFF_MAX_BYTES`, never truncated**, and every refusal
   is named and durable — except under observer, where nothing at all is written.
4. **[M] Credentials are redacted or the write is refused**, by the same battery every other
   entrance passes, and the writer is told which happened.
5. **[M] The pointer expires in LIVED days.** After `HANDOFF_LIFE_DAYS` it is not shown and
   no row claims it was. A handoff with no recorded lived day has already expired.
6. **[M] With no live handoff in the store, the wake is byte-identical to what this tree
   composed before this module existed.** The delivery splice happens only when a pointer is
   found, and the compose-budget reserve is taken only while some directory holds a live
   one. Proved by `tools/wake-dump.ts` against another checkout, `diff` exit 0.
7. **[M] The pointer never puts the bundle over the host's ceiling.** Its room is reserved
   out of the compose budget at the boundary; at delivery a bundle that would still exceed
   the ceiling is delivered WITHOUT the pointer rather than over the limit, and that drop is
   an event.
8. **[M] The sentinel stays true.** The splice re-solves the byte fixed point so the opening
   comment and the tail sentinel both state the delivered total, and the lane counts and
   `elements=` are untouched.
9. **[M] Nothing in a payload is a directory path or a body.** Telemetry is ids, counts,
   bytes, reasons and flags (store §5 G10); which directory a row is about is on the row.
10. **[A] The wording of the pointer's two lines is advisory.** What is mechanized is that a
    pointer states its date, a first line and its id, and names the door to the whole of it.

## 6. Where it sits in the wake's order

The pointer is **furniture at the foot of the bundle**, above the tail sentinel and below
every lane. It is not in `TRIM_ORDER`, which is a LANE order: the trim loop pops elements,
and the pointer is not an element. Its place in the order of who gives up bytes is
therefore stated here rather than in that array — **the pointer gives up its bytes before
any lane element does.** Its room is reserved before the lanes compose, so it never causes
a trim; and if the ceiling at delivery cannot hold it, the pointer is dropped whole while
every lane element stays. A fortnight of working context is worth less than a memory.

## 7. Scars honored

**§2.3** (delivery telemetry is distinct from render telemetry — `handoff.written` and
`handoff.shown` are two rows because "we wrote one" is not "a session was handed one") ·
**§2.18** (the host's ceiling is reported, never invented, and the reserve is what makes it
survive a delivery-time splice) · **§1 G2** (both comment lines state the delivered total) ·
**§1 G7** (a store that will not answer never fails a wake) · **observer G3** (an instrument
does not log its own refusal) · **§13 G3** (one ask at the blocked moment).

## 8. Open questions

1. **Does the host's own file memory duplicate this?** The spec names it as the thing to
   watch in real use (§15 item 6). A directory with a `CLAUDE.md` that already says where
   the work stands may be carrying the same sentence twice.
2. **Is a fortnight right?** `HANDOFF_LIFE_DAYS` is a guess with a reason, not a measurement.
   The row to watch is `handoff.shown`'s `ageDays`: if pointers are only ever read within a
   day or two, the life is too long and the cost is context nobody uses.
3. **Should an expired row be archived rather than left to the prune?** Today it sits live
   and unread for the 90 lived days `D_FLOOR_DAYS` asks for. That is correct and it is also
   a row `list()` walks for three months after it stopped mattering.
