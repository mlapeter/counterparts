# `schemas/` — implementation notes

*Where the CONTRACT was silent, what this module decided, and why. Decisions are
defaults (constitution line 13): every one of these is revisable, and the ones
carrying a measurement debt say so.*

## 1. One prose family, three roles

The contract describes an entity schema as *sectioned prose* — core, current
state, beliefs, protected, lineage. This build stores the sections as
**separate rows in the `schema` prose family**, discriminated by
`meta.role: "entity" | "belief" | "current-state"`, rather than as sections
inside one document.

Reason: physics operates on rows. A belief needs its own strength, its own
pressure field, its own supersede chain and its own decay — §5.6's pressure
accumulator is a *field on the target row*, and there is no target row if the
belief is a paragraph inside its entity's markdown. The sectioned-prose *view*
is reconstructible (`slices()`, `beliefs()`, `currentState()`); the reverse is
not. It also means `no silent destruction` and archive-on-overwrite apply to a
belief for free, because they already apply to every row.

Cost, recorded: an entity's prose file is no longer the whole schema. An owner
reading `prose/schema/sch_*.md` sees the stub and its names, not the beliefs.
The dashboard's schema view has to join. If that trade turns out wrong, the fix
is a render pass, not a storage change.

## 2. A belief's `kind` is its ENTITY's kind

Fixed at mint, never re-derived. This is what makes "revision bars differ by
kind" arithmetic instead of policy: a belief about a person inherits iota 0.8
and the slow-kind daily force cap; project status on an entity inherits 0.5 and
no cap — "a loosening chosen out loud" (§4.3), so world-state flips on one clear
correction while a model of a friend takes ~3 lived days.

## 3. What the successor belief is made of

On REVISE the contract says the old element is retained with lineage; it does not
say what the new one says or how strongly it is held. This build:

- **body** — `input.statement`, defaulting to the challenging memory's own prose.
  The engine mints; the model never hands over a belief edit (§5 G1).
- **salience** — the challenger's. A belief is held as strongly as the evidence
  that carried it, and inheriting the *old* belief's salience would make a
  revised belief permanently as strong as the thing it replaced.
- **physics** — `physics.successorSeed(target)`: pressure resets to 0, identity
  membership is inherited. Not this module's rule; physics owns it.

## 4. A re-mention credits at the `referenced` tier

Deliberate, and the arithmetic depends on it. `surfaced` (w = 0.25) leaves a
daily-mentioned stub at base 0.03, below `PHI_PRUNE` — a stub that is mentioned
every day would still fade, which is not the lifecycle the contract describes. A
mention is the entity *being used*, and physics already refuses the credit on the
birth day and on any day already credited, so "accumulates" means distinct lived
days by construction.

## 5. What kills an entity (contract open question 1)

`physics.pruneVerdict` **plus one blocker of this module's own**: an entity with
live beliefs or live current-state rows attached does not fade, however weak its
own row is. That is the "zero live attached memories" rule the open question
calls obvious, scoped to the elements this module can see.

Not answered, still open: *a person with one faded memory is not the same as a
project that ended.* Both fade here on the same five physics conditions. The
per-kind distinction, if it is real, belongs in `KINDS` as a per-kind
`D_FLOOR_DAYS`, not in a special case here.

## 6. A faded name mentioned again is a NEW birth

Death by decay archives the entity; `store` has no unarchive, and this build does
not want one. Re-mention mints a fresh stub — the old entity died, and the
mention is a new place for memories to attach. The old id stays resolvable and
keeps its exit in the lifecycle counts, and the birth emits
`schema.birth.after-fade` with the prior id, so born → faded → born again is a
countable fact rather than an argument (scar §2.17's shape: if the churn is a
defect, telemetry has to be able to say so).

The alternative — reviving the archived row — would need an unarchive verb on the
store and would make "died by decay" a lie the first time it happened.

## 7. Near collision is token containment, and it is CAL

"Mike" against "Mike Chen" refuses. The rule is token containment because that is
the exact shape §14.3 names, it needs no embedder, and it fails toward refusal
rather than toward a silent merge. **It is not a measured similarity bar**
(scar §2.8): v1's 0.60 embedding floor was intuited and inert, because arbitrary
same-corpus pairs already sat at 0.576. When the real name space is measured, the
measured rule replaces `collision()` — which is why it is one exported function
and a tunable, not an `if` in the birth path.

Known false negative: "Mike Chen" against "Michael Chen" reads as `none`. An
edit-distance or phonetic arm would catch it and would also start refusing real
distinct names; neither direction should be chosen without the measurement.

## 8. The per-chunk birth counter is process-local

`MAX_BIRTHS_PER_CHUNK` is enforced against an in-memory map keyed by `chunkRef`.
Two `Schemas` instances over one store — or one process restart mid-run — do not
share the count. Acceptable because the cap guards against *one confused chunk*
inventing five entities, which is a within-run phenomenon; a chunk is not
re-interpreted across processes. If interpretation ever becomes resumable, the
counter moves into box 2 with the run record.

## 9. Confidence, and the protected queue

Both contract §4 items marked **PROPOSED** are implemented as proposed:

- **No separate belief confidence.** Strength alone carries "weakly-held beliefs
  fall easier", because the revision bar is `iota × strength(old)`. One number,
  and it cannot go inert unnoticed.
- **No second-signature queue for protection.** `addBelief({ protected: true })`
  sets the flag at the mint, and protected beliefs refuse every revision path.
  The corrective that shipped and worked in v1 was legibility, not a cadence:
  every protected element is enumerable at will (`beliefs()` carries the flag).
  Scar §2.19's risk — permanent ink at the lowest write bar — is live and named.

## 10. Protection is checked BEFORE the arithmetic

A protected belief accrues no pressure at all, rather than accruing pressure that
can never cash. Permanence that quietly builds a case against itself is a
different and worse guarantee than permanence, and the pressure field would grow
without bound behind a refusal nobody sees.

## 11. Telemetry: names are hashed, bodies never appear

A schema name is author content that the store indexes, so events carry
`nameHash`, kinds, counts and reasons — never the name, never a statement. This
is the same rule `encode/` follows when it logs a dropped alias by index. The
event ring is in memory; durability is the adapter's through `onEvent`
(INTERFACE-GAPS §1).

## 12. Where status lives (contract open question 3)

**A timestamped `current-state` row on the entity** — the first of the two
options, not "an ordinary memory with an event date". Two reasons: a wake
briefing can render it (it is addressable by entity), and the placement rule
needs a *thing to refuse*, which an ordinary memory would not give it. The second
option remains more brain-faithful and cheaper to clean up; if current-state rows
turn out never to be re-read, that is the evidence to switch on.

**And what happens when a current-state row is CONTRADICTED** (owner ruling
2026-09-04, `replaceCurrentState`, SEAMS item O): it is replaced immediately,
with lineage, and no pressure is accumulated. Two things this build decided that
the ruling did not say:

- **The successor's `statedOn` is the replacing day, not the target's.** A
  replaced status is a status as of the day that replaced it; carrying the old
  date forward would make a fresh correction read as stale, which is the exact
  failure the timestamp exists to prevent.
- **The versions row says `replaced-by-declaration`, not
  `revised-by-pressure`.** They are different crossings and a reader of the
  lineage must be able to tell a climbed bar from a fact that simply changed
  (scar §2.4). Both strings live in `tunables.ts`, one spelling each.

The refusal itself — `status-on-identity-refused` — is the ~72 KB lesson
mechanized. It refuses on the *identity schema*, not on "status-shaped text",
because a text classifier here would be a second, softer gate with no admission
test (scar §2.16).

## 13. A removed schema row is skipped, not read (2026-09-18)

Found by the adversarial review of the F3 refactor, pre-existing since removal
shipped, and proved end to end through the real command rather than the seam.

`MEMORY_BEARING` permits a `schema` target, so an entity or a belief is a legal
`counterparts remove`. The chase KEEPS the row and blanks `prose_path`
(`store/owner-op-seam.ts`); `store.list({type: "schema"})` still returns it; and
`load` had no guard, so `readProseFile("")` threw `PROSE_FILE_MISSING` out of
`Schemas.open` and therefore out of `Counterpart.open`.

**What that looked like is the reason this could not wait for the floor work.**
Not a crash. The hook entry point catches everything out of `main()`, writes one
line to stderr and exits 0, so every session after the removal had no wake, no
recall and no capture — silently. The CLI and the MCP server fail loudly; the
hook is the path the owner actually lives in. One `remove` on a person would have
switched his memory off until someone read the stderr.

The second face of the same root cause: in the dark-only state (marked, chase not
yet run) `slices()` threw `REMOVED`, through `element` → `physicsOf` →
`requireRow`. `slices()` is a model path.

**The fix is to skip, and the CHASED half is one predicate — `removed()` — that
`load` and `entity` share.** It is free: `prose_path === ""`, and the row is
already in hand. The DARK half needs the deny-list, and who asks it differs by
what each caller is already paying for. `load` fetches `deniedIds()` ONCE for the
whole walk, because it runs at every open over every schema row and a removal
must cost the index one query, not one per row. `entity` asks per call — it has
no other store read to borrow from, which costs `entities()` about 2 ms at 120
entities, measured and accepted rather than paid for with a private view-builder.
`element` borrows the refusal from the `physicsOf` call it has to make anyway,
which is why `slices()` did not get slower (66.7 ms → 64.5 ms over 120 entities ×
6 beliefs; an earlier draft that asked `deniedIds()` per element measured 76.5 ms
and was rewritten). Either way the question is asked LIVE, not trusted from
`load`: an in-process `Schemas` can be older than a removal the owner has since
run in another process.

Skipping — rather than rendering a placeholder — is the honest answer:
`Store.read` still refuses the id BY NAME, so "removed" and "never existed" stay
distinguishable to anyone who asks for it directly.

It also turns a piece of luck into a check. `element` refused a denied id before
this only because `physicsOf` happened to be evaluated *after* `statement` in the
same object literal: reordering two lines would have lost the gate, and the
removed prose was read off disk into memory before the throw discarded it. It is
now a statement above the read, with its `catch` narrowed to `REMOVED` /
`ID_UNKNOWN` (`isAbsence`) so a broken database cannot present as a quietly empty
index.

**What this does NOT reach, because `Schemas` builds its index at open and no
process tells another one anything.** In a long-lived process — the MCP server —
a removal run from the CLI is invisible to `this.meta` and `this.index` until the
next start. So in that window `liveElementIds`'s `attached` count still counts a
dark-marked belief (a number, off by one; it renders nothing), and a dark-marked
ENTITY is still in the alias index, so `aliasIndex().lookup("ada")` returns it.
Neither is new and neither is removal's fault: it is the same staleness the
server already has for every write another process makes. Worth closing when
something needs cross-process invalidation, not before.

**Removal does not cascade, and this does not make it.** Beliefs hanging off a
removed entity keep their rows. They are invisible in every rendering — every
path starts at an entity and hers is gone — and still readable by their own id.
Whether the ceremony should chase them is `cli/removal.ts`'s question; naming
the orphaned state is this file's.
