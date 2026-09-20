# `handoff/` — implementation notes

Choices the CONTRACT does not make, recorded here rather than left to be re-discovered from
the code. None is a guarantee; each is the smallest rule that could work, and each names
what would have to fail before machinery is added. True for now (2026-09-20), not law.

## 1. Why the pointer is spliced at DELIVERY and not composed into the bundle

The wake bundle is composed once per boundary and published under one meta key. `Self.wake()`
reads that one bundle back with zero compute, and every session in every directory reads the
same bytes. So "which directory am I in" is not knowable when the body is composed — it is a
delivery-time fact, exactly like today's date and the store's current size, which is why the
delivery preface exists at all (`self/briefing.ts#prefaceLine`).

The splice therefore reuses the preface's own mechanism, pointed at the other end of the
bundle: `spliceBeforeSentinel` inserts above the tail sentinel and re-solves the byte fixed
point so both comment lines state the delivered total. A damaged bundle is returned
untouched, for `applyPreface`'s reason — rewriting the byte count of a damaged bundle erases
the damage the sentinel exists to show.

Joined at `counterpart.ts` and not inside `self/`: `self/` knows nothing about directories
and gains nothing by learning. The composition root is the one place that holds the
published bundle, the host's ceiling and the scope at once.

## 2. Why the reserve is CONDITIONAL, and what the unconditional version costs

`wakeReserveBytes()` adds `HANDOFF_RESERVE_BYTES` to the preface's reserve only while some
directory in this store holds a live, unexpired handoff.

- **Unconditional** would make every wake in every store 448 bytes smaller than master's
  forever, including on the blank store the owner is about to start on. The claim "with no
  handoff written the wake is byte-identical" would be false, and the first thing anyone
  would notice is a store that trims one more element than it used to for no visible reason.
- **No reserve at all** fails the other way, and worse, because it fails silently and late.
  The boundary trims the composition to exactly `budget - PREFACE_RESERVE`, so on any store
  with enough elements the bundle fills the ceiling and a pointer spliced afterwards would be
  dropped at every wake. It would work on a new store for two weeks and then stop, and the
  only symptom would be `handoff.shown` going quiet — which is exactly the shape of failure
  the fired view exists to catch and exactly the shape nobody looks for.

The scan `anyLive()` runs is bounded by the number of schema rows of the place kind, which is
a handful, and it is wrapped: a store that will not answer reserves nothing, which composes
the wake master composes.

**Named cost: the reserve lags one boundary.** The first handoff a directory ever gets is
written at a boundary whose composition was already published, so the very next wake in that
directory may be the one case where the pointer does not fit. It is delivered without the
pointer, `counterpart.handoff.noroom` is emitted, and the boundary after that has the room.
Every wake fact behaves this way; it is not worth a second publish to fix.

## 3. Why `type: "schema"`, `kind: "place"`, `meta.role = "handoff"`

`ProseType` is a closed union of three in `store/prose.ts`, and `store/` is not this module's
to edit. `Kind` is a closed union of six enumerated exhaustively in the MCP tool schemas, the
census, the claim counters and the CLI — adding to it would make "handoff" a kind a model can
propose a memory as, which is the opposite of the point.

So the row goes on the shelf the self page uses, one role along. `kind: "place"` is the
honest subject (a handoff is about a directory, a place of work) and it also keeps the recall
scan's exemption cheap: the prose read is gated on `type === "schema" && kind === "place"`,
so only schema rows about places pay for it.

**What that placement buys free**, all of it by mechanisms that already existed: dedup skips
schema rows by name; `scanActive` lists `{ type: "memory" }` so no lane can reach it; and
`schemas/#toMetaRecord` returns null for any role but entity, belief and current-state, so
the index build skips it rather than mis-filing it.

## 4. Why NOT `protected`, and the dwell clock that follows from it

The self page is `protected` at birth because it is standing ink. The handoff is the one
standing row in the store that is *meant* to be let go, so it is not — `protected` is exactly
what would stop `physics#pruneVerdict` ever archiving it.

That makes one thing load-bearing: `store.revise` writes prose and a version row and touches
no physics column. A row born on day 1 and rewritten on day 200 would still read
`lastUsedDay = 1` — dwell 199, strength under the floor, band episodic — and the prune would
archive a pointer written that morning. So every write does
`updatePhysics(id, { lastUsedDay: day })`. That is the whole of the interaction, and it is
tested by name.

The numbers it leans on: `D_FLOOR_DAYS = 90` and `PHI_PRUNE = 0.02`. A pointer expires from
view at 14 lived days and the row survives roughly 90 more before the prune can take it. The
gap is deliberate — the row is the only copy, and an owner reading the dashboard three weeks
later should still find what was handed over.

## 5. Why expansion by id is allowed, and credit is not

The brief asks for the pointer to be expandable through the door that already exists, which
is `recall({ handle: <id> })` → `deliberate.ts#expandHandle`. The self page is refused there;
the handoff is not, because the pointer's whole shape is "here is a line of it, and here is
its id".

That opens the one path by which working context could reinforce itself:
`expandHandle` → `recordHandleResolution` → `creditAtBoundary` → `creditReferences` →
`resolveUse`, which advances `uses` and `reinforced_days`, which is the input
`promotionEligibility` reads. So the refusal sits in `creditReferences`' own filter, beside
`unknown-id` and `archived`, and is counted as `handoff` rather than swallowed.

**Named cost:** `expandHandle` has no scope filter, so a session that somehow holds another
directory's handoff id can read that body. The id only ever appears in that directory's own
wake, so this is a hazard for a session that was told an id, not one that can find one. Filed
in INTERFACE-GAPS §2.

## 6. Why the field is processed BEFORE `session_end` checks `memories`

`session_end` requires a non-empty `memories` array. A session that learned nothing worth
keeping but is leaving a directory half-finished would otherwise have its handoff thrown away
with the refusal. So the handoff is written right after the session bind, and its outcome
rides out on the refusal as well as on the success. The `memories` contract is unchanged.

## 7. Why the excerpt reserves three bytes for its ellipsis

`…` is U+2026 and is three bytes in UTF-8. The first draft reserved one character's worth and
a 160-byte cap rendered 161. Measured, not reasoned about — and the same class of mistake as
every other byte cap in this tree that counts characters somewhere and bytes somewhere else.
