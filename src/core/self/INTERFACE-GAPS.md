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

**Half closed 2026-09-16** (branch `dashboard/flat`, the one commit on top of `0a7bea4`; a
commit cannot cite its own sha, so the merge sha replaces this at merge, the way
`docs/IMPROVEMENTS.md` records them): `MemoryFilter` now carries
`protected?: boolean`, so `list({ archived: false, protected: true })` is one indexed WHERE
and `enumerate()` reads prose for the protected elements ALONE instead of for every live
row (~15 000 file reads on the owner's store, the last floor under the dashboard's
`/api/overview` and `/api/mind`). `countMemories` inherits the key through the shared
WHERE. `unresolved` is untouched — it is still a prose `meta` key, so `scanActive()` and
`episodes.ts` still scan, and the real fix above still stands for that half.

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

## The cap's day is UTC, and that is a decision (I32, 2026-09-11)

The chapter cap now keys on the calendar date a caller supplies. On this host
that date is the hook's `input.at` — `new Date().toISOString().slice(0, 10)`,
UTC — chosen so that it matches every other `date` field in the store rather
than introducing a second clock.

For an owner at UTC−6 this means the day's ask allowance resets at 18:00 local,
in the middle of an evening's work. Nobody has decided that is right; it is what
falls out of having one zone. The alternatives, none taken here:

1. a `timezone` in the adapter config, applied where `input.at` is composed —
   one place, one field, and the store's other dates stay UTC (they are records
   of when something happened, not of whose day it was);
2. the owner's identity core carries the zone, and `self/` resolves the key —
   more correct in principle, and it puts a host concern inside core;
3. leave it, and revisit only if a reset mid-evening is ever actually felt.

What must NOT happen is the cap silently reading one zone while the gate rows
beside it read another. If this changes, it changes in one place and the change
is named.

## The tail verdict and the ask now share a counter

`noteOrphanTail` takes the same optional `date` and passes it to `askDue`, so the
"what did the last ask not cover" telemetry is computed against the counter the
ask was actually charged to. Threading it was two lines; not threading it would
have left a ring line reporting `day-chapter-cap` for a day with asks left, which
is the shape of finding this bug twice.
