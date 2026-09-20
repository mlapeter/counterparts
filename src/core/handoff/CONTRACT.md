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
  not a fault. A handoff row whose WORDS have gone missing is a different matter and is not
  this module's line to print: on the v6 floor a tombstoned row is skipped by
  `Schemas.load` and the session starts normally, and a FAULTED one (blank body, a hash
  that still names it) stands the session down as `MEMORY_BODY_MISSING` — which `verify`
  names by id and `counterparts remove <id>` clears. Both measured, both tested.
- **No second lane in the wake, and no new trim order.** The pointer is reserved for, not
  ranked.
- **No scope registry of its own.** The directory arrives as a string from the adapter that
  resolved it (`adapters/scopes.ts`); this module canonicalises nothing.

## 5. Contract

**Inputs** — a body, a canonical directory, a session id (or null), the lived-day clock,
and a gate (`bridge.episodeGate`, injected).
**Outputs** — one schema row per directory with `meta.role = "handoff"`; a two-line pointer
block for a given directory and day; four durable event names (`written`, `shown`,
`cleared`, `refused`).

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
   is named and durable — except under observer, where nothing at all is written. Every
   refusal in this module goes through one private seam, so that is checkable in one place;
   the two shapes that used to escape it (`no-scope` short-circuited at the MCP door, and a
   present-but-blank field, which was total silence) were the adversarial review's MAJOR-2
   and are closed.
3b. **[M] A `handoff` field that is PRESENT and blank RETIRES the directory's pointer.**
   The row is archived by the ordinary means, its words stay readable on it, and one
   `handoff.cleared` row says so. An ABSENT field means "leave what stands"; a field that is
   not text is a named, durable refusal. This is the only retirement there is, and the tool
   description says so.
4. **[M] Credentials are redacted or the write is refused**, by the same battery every other
   entrance passes, and the writer is told which happened.
5. **[M] The pointer expires in LIVED days.** After `HANDOFF_LIFE_DAYS` it is not shown and
   no row claims it was. A handoff with no recorded lived day has already expired.
6. **[M] With no live handoff in the store, the wake is byte-identical to what this tree
   composed before this module existed.** The delivery splice happens only when a pointer is
   found, and the compose-budget reserve is taken only while some directory holds a live
   one. Proved by `tools/wake-dump.ts` against another checkout, `diff` exit 0; the
   adversarial review widened the same proof to 2,824 compositions with the same result.
7. **[M] The pointer never puts the bundle over the host's ceiling.** Its room is reserved
   out of the compose budget at the boundary (see §6 for who pays); at delivery a bundle
   that would still exceed the ceiling is delivered WITHOUT the pointer rather than over the
   limit, and that drop leaves a durable `handoff.refused{reason: "no-room"}` row, deduped
   per row per lived day.
7b. **[M] It never gets a vector** (`store/#noVector`, asked at all three doors:
   `indexOne` at write time, `unembeddedIds` for the backfill, `embedOne` for a caller
   naming an id). One could not reach a turn — `activate` skips the row — but it would give
   the prose this module calls the likeliest to carry a token a second representation
   outside its row, and put a floor under the embed backlog `doctor` watches. The SELF PAGE
   is excluded by the same rule as a working default (2026-09-20, the coordinating session's
   ask — not an owner ruling, and revisable); the journal is NOT, and
   why is in `INTERFACE-GAPS.md` §7. The LEXICAL index still holds both, so the owner can
   still find a row by searching for it.
8. **[M] The sentinel stays true.** The splice re-solves the byte fixed point so the opening
   comment and the tail sentinel both state the delivered total, and the lane counts and
   `elements=` are untouched.
9. **[M] Nothing in a payload is a directory path or a body.** Telemetry is ids, counts,
   bytes, reasons and flags (store §5 G10); which directory a row is about is on the row.
10. **[A] The wording of the pointer's two lines is advisory.** What is mechanized is that a
    pointer states its date, a first line of SUBSTANCE (headings are skipped) and its id,
    names the door to the whole of it, and carries no control or bidi-override character
    into the bundle.

## 6. Where it sits in the wake's order — who pays, when, and how much

The pointer is **furniture at the foot of the bundle**, above the tail sentinel and below
every lane. It is not in `TRIM_ORDER`, which is a LANE order: the trim loop pops elements,
and the pointer is not an element.

**An earlier draft of this section said the pointer "never causes a trim". That was the
reverse of the mechanism, and the adversarial review of 2026-09-20 measured it.** What is
true:

- **The reserve is what causes the trim.** `reserveBytes` is subtracted from the compose
  budget, so the trim loop runs against a smaller ceiling and pops lane elements *to make
  room for the pointer*. A memory is dropped so a handoff can be shown.
- **The reserve is store-wide; the pointer is per-directory.** One bundle is published per
  store. A handoff written in project A shrinks the wake composed for every session in
  every directory of that store, and a session in project B pays for a pointer it will
  never be handed.
- **What that cost was, measured, at the flat 448-byte reserve:** at a 1,200-byte ceiling a
  session in a directory with no handoff lost 4 of its 6 identity elements; at 2,000, 4 of
  13; at 3,000, 5 of 23. At the 9,000 the parallel run uses, the lane caps bind before the
  byte ceiling does and the cost is zero.
- **What it is now.** Two changes, both in `reserveBytes`, and neither of them a second
  budgeter: the reserve is sized to the pointer block that ACTUALLY EXISTS (the widest live
  one, one per directory) plus a small margin, capped at the widest block this module can
  produce; and it is **not taken at all** unless the ceiling is at least
  `HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE` times it. Below that the reserve is zero, no lane
  pays anything, and the pointer is simply not carried at that ceiling — `handoff.refused
  {reason: "no-room"}` says so, once per row per lived day.
- **At delivery**, a bundle that would still exceed the ceiling drops the pointer whole
  while every lane element stays.

So the order of who gives up bytes, stated plainly: **above the share rule's threshold the
pointer is paid for first, out of the compose budget, by whatever lane the trim order
reaches — store-wide. Below it the pointer gives up everything and the lanes give up
nothing.** A fortnight of working context is worth less than a memory, and the threshold is
where this module says so in numbers rather than in a sentence.

**Worktrees, and why they are not a surprise.** The directory a session is filed under is
`CLAUDE_PROJECT_DIR` where the host sets it (`bin/hook.ts#startDirectory`,
`mcp/server.ts#hostScope`), which stays put when a session `cd`s or enters a git worktree.
So a session launched at a repo root and working inside `.claude/worktrees/x` shares the
repo's pointer, and a session *launched* inside the worktree gets its own. Both are
defensible; what would not be is neither being written down.

## 7. Scars honored

**§2.3** (delivery telemetry is distinct from render telemetry — `handoff.written` and
`handoff.shown` are two rows because "we wrote one" is not "a session was handed one") ·
**§2.18** (the host's ceiling is reported, never invented, and the reserve is what makes it
survive a delivery-time splice) · **§1 G2** (both comment lines state the delivered total) ·
**§1 G7** (a store that will not answer never fails a wake) · **observer G3** (an instrument
does not log its own refusal) · **§13 G3** (one ask at the blocked moment).

## 8. Open questions

1. **Is the share rule's threshold right?** `HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE` is 8,
   which turns the reserve on from about 2,400 bytes of ceiling. It is a judgement about
   what a pointer is worth against a memory, made once, in numbers; the owner's hosts all
   report far more than that, so nothing he runs is near it today.
2. **Does the host's own file memory duplicate this?** The spec names it as the thing to
   watch in real use (§15 item 6). A directory with a `CLAUDE.md` that already says where
   the work stands may be carrying the same sentence twice.
3. **Is a fortnight right?** `HANDOFF_LIFE_DAYS` is a guess with a reason, not a measurement.
   The row to watch is `handoff.shown`'s `ageDays`, which is now ONE row per directory per
   lived day — before that it was one per wake, and the distribution would have been
   dominated by a session re-waking rather than by distinct pickups. Read it as written; no
   further dedupe is needed.
4. **CLOSED (2026-09-20): a stale pointer now has a one-word retirement.** The ask fires up
   to six times a session, so a session can write "half done" early and finish by the last
   ask. Sending the field PRESENT and blank clears the directory's pointer (§5 G3b). What
   remains open is whether models actually reach for it; the row to watch is
   `handoff.cleared` against `handoff.written`.
5. **Should an expired row be archived rather than left to the prune?** Today it sits live
   and unread for the 90 lived days `D_FLOOR_DAYS` asks for. That is correct and it is also
   a row `list()` walks for three months after it stopped mattering.
