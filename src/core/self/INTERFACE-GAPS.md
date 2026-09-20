# `self/` — interface gaps

Things this module needs from a neighbour and worked around instead of editing. Each
entry names the owner, the workaround now in the code, and what the real fix looks like.

## 0. The identity core's home row — `schemas/`'s requirement, ADOPTED with one caveat

**Owner:** this module (`schemas/INTERFACE-GAPS.md` §5 filed it here, mid-build).
**Needed:** `schemas/` refuses to birth `kind: "self"` in two independent layers, so the
row that says *the self exists as an entity here* can only come from `self/`. Without it,
its placement rule degrades from `status-on-identity-refused` to `entity-unknown` — the
wrong refusal, silently, on the guarantee that carries the ~72 KB lesson.
**Adopted:** `Self.ensureIdentityCore({ name, aliases })` mints exactly the asked-for
shape — `type: "schema"`, `kind: "self"`, `meta: { role: "entity", name, aliases }` —
idempotently (a second call returns the existing row; a second core is a category error).
`boundary({ identityCore })` is the door that reaches it, so it is not a method waiting
for someone to remember it. `findIdentityCore(store)` is the read.

**The caveat, stated so it is not mistaken for agreement on everything:** this module
mints a PLACE, never a claim, and it does not invent a NAME. `ensureIdentityCore` with a
blank name returns `reason: "no-name"` and writes nothing — the core's name is the
owner's, arriving from the adapter at install. Whoever wires the composition root owns
that string; there is no default and there will not be one.

**Two divergences from what §5's wording assumes, both deliberate:**

1. **There is no identity *document* here to mint.** Identity STATEMENTS are ordinary
   memories carrying strength (contract §4 drops v1's identity index; module-map ruling 2:
   nothing is born into identity, promotion is N = 3 at consolidation). The schema row is
   one empty home, not the self-schema's content, so `schemas/` will index a place with
   nothing in it — which is what "a newborn schema is empty except its names" says, and
   the right outcome, but not what "self writes its core" might suggest.
2. **`schemas/` can also answer its question without this row.** `store.list({ band:
   "identity" })` is the index-free way to know whether an id is identity-band, and it
   needs no cross-module minting contract at all. The row is adopted because §5 asked and
   it is cheap; if the seam test ever gets awkward, that read is the simpler fix.

**Seam test still owed (the coordinator's, not mine — it must not import `schemas/`):**
mint through `Self.ensureIdentityCore`, then assert
`schemas.addCurrentState({ entityId: coreId, ... }).reason === "status-on-identity-refused"`.

## 1. The episode input shape is a SEAM, not an import — `remember/` owns authorship

**Owner:** `remember/`.
**Needed:** episodes arrive from the experiencer's authorship path (contract §3: the
end-of-session write *is* the front door the lived-salience doctrine names). v1's
self-store tool is superseded by exactly that path, so `self/` has no tool surface and
depends on someone else handing it prose.
**Have:** `remember/proposals.ts` exports `ProposalDraft` / `Proposal` with the fields
this module needs (`content`, `title`, `aliases`, `claimed`, `salience`) plus a great
many it does not, and the dependency direction is wrong: authorship is upstream of the
self, so `self/` must not import `remember/` (a test asserts the absence of that import).
**Workaround:** `episodes.ts` restates the shape it accepts as `EpisodeProposal`
(`sessionId`, `content`, `title?`, `handles?`, `happenedOn?`, `claimed?`, `salience?`,
`day?`) with its own `intakeEpisode()` validator returning reasons. `handles` is this
module's name for what `remember` calls `aliases` — named handles are aliases, not a
second lookup path (contract §3, §9.2).
**Real fix (the coordinator's, at the seam pass):** one direction of dependency, declared.
Either `remember/` calls `Self.appendChapter` / `Self.ingestEpisode` with its own
`Proposal` narrowed to these fields, or a shared `core/types.ts` grows an
`AuthoredMemory` both modules read. Until then the two shapes must be kept honest by
hand, which is the thing this file exists to make visible rather than silent.

## 2. `store/` has no metadata index — `unresolved` and `protected` cost a full scan

**Owner:** `store/`.
**Needed:** the threads lane is "memories flagged `unresolved`" and the enumeration is
"memories flagged `protected`" (contract §5, constitution 16, scar §2.19).
**Have:** `list({ type, kind, band, archived })` — no `protected` filter, and prose `meta`
is not queryable at all. `protected` is a real column in box 2; `unresolved` is a prose
`meta` key.
**Workaround:** `scanActive()` reads every active memory's prose once per boundary, and
`enumerate()` reads them again for the protected list. Correct, and O(store) per boundary
call — acceptable because it runs at a boundary and never at wake, but it is the wrong
shape at 10⁴ memories.

**Amended 2026-09-04:** wake no longer reads *only* one meta row. A wake that is a
DELIVERY also reads the lived day and one `COUNT(*)` over `memories`, because the delivery
preface states how big the store is and a bundle rendered at yesterday's boundary cannot
know that. `Store.countMemories(filter)` is `list()`'s WHERE counted in SQL — deliberately
not `list().length`, which would materialize every id — and it is the one aggregate on the
wake path. A read that is not a delivery still pays exactly one meta row.
**Real fix:** `list({ protected: true })` (the column is already there) and either an
`unresolved` column or a store-side `meta` index. `episodes.ts`'s `findIngested()` and
`memoriesForEpisode()` scan for the same reason and would collapse to one indexed query.

## 3. `prospective/` does not exist — the horizon is caller-supplied

**Owner:** `prospective/`.
**Needed:** "arriving occasions" is a briefing lane (behavioral-spec §1, contract §5
INPUTS: *the prospective horizon*).
**Have:** `Store.prospectiveFor(id)` answers "what windows does THIS memory have"; there
is no "what is due on day d" read, and no module owning the ordering.
**Workaround:** `BoundaryRequest.horizon?: HorizonItem[]` — the caller passes ids, in the
order it wants them, and `self/` ranks nothing: it resolves them at render time like any
other lane and trims them in `TRIM_ORDER` position. A caller that passes nothing gets an
empty lane, which is silent by design (an empty horizon is a real state).
**Real fix:** `prospective.due(day)` returning ordered memory ids, consumed here directly.
The lane, its heading, and its trim position are already built; only the source is
borrowed.

## 4. The published briefing lives in a `meta` row, not a render file

**Owner:** `store/`.
**Needed:** atomic publish of one text blob that the wake path reads with no computation
(contract §5 G1, §1 G5 — "an empty or short read is an error, never silently valid").
**Have:** `setMeta(key, value)`, transactional in box 2 — genuinely atomic, so a
concurrent reader sees the old bundle or the new one and never an empty string, which is
the property v1's non-atomic `wake.md` lacked. What it is not is a FILE: the owner cannot
read their own briefing in an editor, which is a constitution-6 smell ("prose readable in
any editor"), and box 2 is not where large text belongs.
**Workaround:** `BRIEFING_KEY = "self.briefing"`, one `setMeta` per boundary, integrity
verified from the sentinel on read.
**Real fix (store's call):** a `render/` top-level directory with a `LAYOUT` entry —
`paths.ts` is store-owned and this module may not edit it — written tmp+rename, with the
same sentinel check on read. The reader would then be `readFileSync` + `readSentinel`,
which is the same two lines.

## 5. The episode gate is injected, and its default REFUSES

**Owner:** `encode/` (the gate battery: secrets, precision, the emotion exemption).
**Needed:** "ingestion is ordinary and the gates apply — a first-person reflection is not
exempt from never durably encoding a credential" (contract §3, scar §2.7: episode
ingestion was v1's most heavily gated surface, 66% of all gate fires).
**Have:** `encode/battery.ts` exists but its input shape (`GateInput`) is `remember`'s
proposal-shaped one, and SEAMS.md items 2–3 record that it is still missing channels.
**Workaround:** `EpisodeGate` — `(text, handles, sessionId) => ok | {gate, reason}` — with
`NO_GATE` as the default, which REFUSES, exactly as `remember`'s does. An absent gate is
not an open one, and "NO_GATE_INJECTED" is a loud reason in the ingest result.
**Real fix:** the coordinator wires `encode`'s battery in at the composition root, and
this module's default stops being reachable in production. The `self.episode.ingest.refused`
event already carries the gate name, so the day the battery is wired the telemetry
distinguishes "refused by the real gate" from "nobody wired one".

## 6. `sleep/` expects a `RenderFn`; `Self.boundary` is it, minus the budget

**Owner:** the coordinator (both modules were built in parallel and neither imports the
other — `sleep/briefing.ts` says so in its header, and a test on each side asserts it).
**Needed:** the re-render must be the cycle's LAST content write, after revision, so it
sees this boundary's own supersedes, promotions, merges and prunes.
**Have:** `sleep` injects `RenderFn = (ctx: { store, day, observer }) => { bytes?, elements? }`.
`Self.boundary({ budgetBytes, day, horizon? })` returns `{ briefing: { bytes, elements }, ... }`,
so the adapter is a one-liner **except for `budgetBytes`**, which `sleep`'s context does
not carry and this module refuses to invent (scar §2.18: the ceiling is a host
capability). The wiring is therefore a closure over the host's reported ceiling:

    const render: RenderFn = (ctx) =>
      new Self({ store: ctx.store }).boundary({ budgetBytes: host.ceiling, day: ctx.day })
        .briefing;

**Real fix:** `budgetBytes` joins `sleep`'s cycle options, sourced from the adapter, so
the closure is not the only thing standing between a host's real cliff and the render.
Until then: whoever writes that line owns the number, and a wrong one is visible — an
under-floor ceiling fires `self.briefing.overbudget` at every boundary.

## 7. Reference resolution for confirmations has no caller yet

`Self.noteSelfConfirmation` is the freeze seam: whoever decides that a fallback sweep has
produced a confirmation against an existing element calls it, and it resolves, decides,
counts and (only in the live arm) reinforces. Deciding *that* — which claim in a sweep is
a repeat of which element — is `remember/`'s crash-fallback path plus `schemas/`'s dedup,
and neither wires it today. Recorded here so the freeze does not become v1's
"documented in three places, enforced in one, consumed by nobody" (scar §2.6). The
guarantee that this seam is reachable is the coordinator's, not this module's.

## 8. The threads lane has no source on a migrated store — nothing carries `unresolved`

**Owner:** `remember/` (who mints and revises memories) plus `tools/migrate` (what came
across from v1).
**Needed:** the threads lane is "memories flagged `unresolved`", person-scoped first, oldest
first (contract §5, behavioral-spec §1). It is the lane that says *what we were in the
middle of*, and it is second only to identity in what a waking session actually uses.
**Have, measured on the live store 2026-09-04:** of 14,700 migrated memories, **zero** carry
the `unresolved` flag. v1's open threads did not migrate as threads — they came across as
ordinary memories — and nothing in v2 sets the flag yet, because opening and closing a
thread is a lifecycle this module deliberately does not own (NOTES §7). The store holds
2,862 skill-kind memories, so craft fills the moment it is given room; threads stay dark
regardless of `THREADS_MAX`, of the identity share, or of any other cap. Said plainly here
rather than papered over: **the empty "Still open:" lane is a missing source, not a tuning
problem, and no number in `tunables.ts` will light it.**
**Workaround:** none, and none is wanted. The lane, its heading, its ordering and its trim
position exist and are tested; an empty lane renders as no lane at all, which is honest.
**Real fix, in the order they would land:** (1) whoever mints memories sets `unresolved` on
the ones that are genuinely open — the end-of-session authorship path is the obvious door,
since the experiencer knows what it left hanging; (2) something closes them, or they are
worse than nothing within a week; (3) optionally, a migration pass that re-reads v1's own
open-thread list and flags the memories it can still resolve — cheap, one-shot, and it is
the only way the pre-migration years get a threads lane at all.

---

## The cap has a day again, so the zone question is live again — REOPENED 2026-09-18

This closed on 2026-09-17, when the cap became the session's own for the
session's whole life: no day, so no zone. The cap is now the session's own **per
calendar day** (`MAX_ASKS_PER_SESSION`, owner's ruling 2026-09-18), and that day
is `Store#today` — UTC, the same zone as every other `date` in this store, on
purpose: two clocks in one store is a scar this repo already has a name for.

**The consequence, named rather than hidden:** an owner at UTC−6 gets the day's
allowance back at 18:00 local. A session working through the evening therefore
starts a fresh six mid-evening rather than at midnight. Nobody has reported
feeling it, and the pacer still spaces asks at roughly eight turns apart, so the
visible effect is at most a few more asks in a late session. The fix, if it is
ever wanted, is a per-owner zone — one clock, read wherever a day is decided —
and not a second clock bolted on here. **What the zone question also survives
in** is the `date` stamped on every `adapter.ask` row, which is the number any
"how often today" reading is grouped by.

## The tail verdict and the ask read the same state — CLOSED 2026-09-17

This said `noteOrphanTail` had to be handed the same `date` as the ask, or the
"what did the last ask not cover" telemetry would be computed against a
different day counter and report a cap for a day that had asks left — the shape
of finding one bug twice. With the cap on the session, both sides read the
session's own `asks` and there is no second counter to disagree with. The
guarantee is unchanged and now free: the tail verdict is the ask's verdict.

## 9. The nightly writer's claim wants a compare-and-swap the store does not have (2026-09-20, S2)

`writer.ts` claims a night by appending one durable row and then refusing to start a second
run while it stands. Between the read that finds no claim and the append that writes one
there is a window — small, but real — in which two hooks on two terminals, or two machines
against one synced store, can both claim the same night.

What would close it is a conditional write: `appendEvent` with a uniqueness constraint on
`(name, about)`, or a `setMeta` that fails when the key already holds a value. `store/` has
neither today; `setMeta` is insert-or-replace and `appendEvent` has no unique key but
`dedup_key`, which silently collapses rather than reporting that it collapsed — "the write
landed" and "somebody else was here first" are the same return.

**Not raised as an ask yet, because the cost of losing the race is small and bounded.** A
duplicated ask is one extra block beside one wake, inside an allowance that already permits
two; a duplicated `claude -p` is one extra model call and a second revision that the page's
own `ifVersion` refuses with a row saying so. The gap is filed rather than fixed so that if
`store/` ever grows a conditional write — F5's row work is the likely moment — this is one
of the callers waiting for it.

A `dedupKey` that REPORTED the collapse (`appendEvent` returning 0 for "already there"
rather than a seq) would be enough on its own, and is the smaller of the two asks.

## 10. There is no recency to sort a single day by (2026-09-20, S2 review)

`writer.ts#dayMemories` orders the day by salience and then by the store's own id order,
and the contract now says exactly that. What it would rather say is "and then the newest
first", because within one calendar day salience ties on almost every pair — every row has
the same `birth_day`, no uses, and identical decay — so the tie-break is what actually
decides which 40 of 400 the writer sees.

Nothing in the `Store` API can break that tie. `learned_on` is a DATE. `birth_day` is the
lived day. `newId` is six random bytes (`store/index.ts#newId`), so ids carry no time.
`list()` returns `ORDER BY id`, which is therefore arbitrary-but-stable rather than
chronological.

**The ask, if it is ever wanted:** an ordering key on `MemoryRow` that is monotonic in
insertion — the rowid `list` already sorts against, exposed; or `list({ order: "minted" })`.
It is one column that already exists in box 2 and is not published.

**Why it is filed rather than pressed.** The property the cut actually needs is that it was
CHOSEN rather than iteration luck (§1 G3), and a deterministic id order has that. What is
lost is only that "the end of the day" — often the part a person would most want written
about — has no better chance than the middle of it. Worth revisiting the first time the
page reads as if it were written about the wrong half of a day.
