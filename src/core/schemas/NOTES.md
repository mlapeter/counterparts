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
