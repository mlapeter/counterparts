# `schemas/` — implementation notes

*Where the CONTRACT was silent, what this module decided, and why. Decisions are
defaults (constitution line 13): every one of these is revisable, and the ones
carrying a measurement debt say so.*

## 1. One id family, three roles

The contract describes an entity schema as *sectioned prose* — core, current
state, beliefs, protected, lineage. This build stores the sections as
**separate rows in the `sch_` family**, discriminated by
`meta.role: "entity" | "belief" | "current-state"`, rather than as sections
inside one document.

Reason: physics operates on rows. A belief needs its own strength, its own
pressure field, its own supersede chain and its own decay — §5.6's pressure
accumulator is a *field on the target row*, and there is no target row if the
belief is a paragraph inside its entity's body. The sectioned-prose *view*
is reconstructible (`slices()`, `beliefs()`, `currentState()`); the reverse is
not. It also means `no silent destruction` and archive-on-overwrite apply to a
belief for free, because they already apply to every row.

Cost, recorded: an entity's own document is no longer the whole schema. An
owner reading one entity row sees the stub and its names, not the beliefs.
*(Written on the file floor, where that document was `prose/schema/sch_*.md` and
the cost was a file that did not say everything; since the floor — schema v6,
2026-09-20 — it is a row, and the cost is the same one.)*
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
`D_FLOOR_DAYS`, not in a special case here. *(2026-09-24: it landed as this
module's own fade tunables instead — a calendar floor for every card, longer
floors for people — see §14.)*

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

**The two skips are counted apart.** A row the deny-list names was removed by the
owner, and its absence is the point. A row with a blanked `prose_path` and NO
removal record is something else — a half-written migration, a disk event — and
skipping that one buys uptime with data disappearing without a word. Both are
still skipped, because a session that cannot start helps nobody, but `load` keeps
the counts apart and `loadSkips()` returns them (a count for the removed, the ids
for the unaccounted, which is what a `doctor` or `verify` line would want to
print). Nothing prints them yet; that is the hook for the follow-up, and it was
left out of this change because those files are being edited elsewhere.

**Removal does not cascade, and the consequence is VISIBLE — the first draft of
this section was wrong about that.** Beliefs hanging off a removed entity keep
their rows: orphaned, not destroyed. They vanish from every path that starts at
an entity — slices, the alias index, preselection, the rendered schema context,
and so recall — and they remain ordinary rows to every path that does not.

The proved counter-example is the owner's own dashboard. `counterparts dashboard
identity` enumerates `store.list({ band: "identity", archived: false })` and
`store.list({ archived: false })` (`self/identity.ts#enumerate`) and reads the
prose itself (`adapters/dashboard/identity.ts`). It never asks an entity anything.
So after removing a person, a promoted belief ABOUT her still prints there in
full, under "Identity band", while `browse --id <her entity>` correctly says
`[removed by the owner]`. The protected list is the same loop and the same story.
`Schemas.element(id)` and `Store.read(id)` answer for the orphans too, by design —
they were not removed.

This is not a regression: before the fix the store could not be opened at all
after such a removal, so nothing rendered because nothing ran. It is what a
working session then shows, and "I removed her and her salary is still on the
screen" is the worst possible way for the owner to find out that removal does not
cascade. **So the cascade question goes to him, in words, rather than being
discovered.** Implementing it — chasing an entity's elements, or teaching
`enumerate` to skip elements whose entity is denied — is a behaviour change and
`cli/removal.ts`'s to make; naming the orphaned state is this file's.

**What this does NOT reach, because `Schemas` builds its index at open and no
process tells another one anything.** In a long-lived process — the MCP server —
a removal run from the CLI is invisible to `this.meta` and `this.index` until the
next start. So in that window `liveElementIds`'s `attached` count still counts a
dark-marked belief (a number, off by one; it renders nothing), and a dark-marked
ENTITY is still in the alias index, so `aliasIndex().lookup("ada")` returns it.
The stale alias cannot leak text: its only consumer is `retrieval.ts` →
`Turn.aliases` → recall, and `recall/activate.ts` filters denied ids before
candidates are formed, so such an entity can be MATCHED and never SURFACED.
Neither is new and neither is removal's fault: it is the same staleness the
server already has for every write another process makes. Worth closing when
something needs cross-process invalidation, not before.

## 14. Gentle fading, and who runs it (2026-09-24)

The owner's direction: wire the fade in, but not aggressively — don't let people fade
too quickly; use lived days, or lived AND calendar days. So physics' prune verdict (§5) is
now necessary but not sufficient. A card fades only when, in addition:

- **a calendar floor has passed since its last use** — `FADE.CALENDAR_FLOOR_DAYS` (180),
  or the kind's own (`person`: 365). Lived days alone are too quick for someone who uses
  the tool daily, where lived ≈ calendar;
- **its kind's lived dwell has passed** — physics' `D_FLOOR_DAYS` times
  `FADE.LIVED_DWELL_FACTOR_BY_KIND` (`person`: 2, so 180 lived days). This answers §5's
  open "per-kind `D_FLOOR_DAYS`" question in this module's tunables, not in physics' `KINDS`;
- the old blockers still hold — live attached elements, `protected`, band — plus one new
  one, `identity-core`: a `kind: "self"` card never fades.

Kind is the row's own `kind` column (`person` / `entity` / `skill` / `place`), fixed at
birth.

**Where "last used on a calendar date" comes from.** The store keeps last use as a lived
day (`last_used_day`) and no date. Rather than touch the store or the mention path,
`calendarDaysSinceUse` takes the largest of three lower bounds, so it can undercount and
never overcount — undercounting only makes a card fade later:

1. the lived-day gap itself (each lived day is a distinct date);
2. the birth date (`learned_on`) when birth was the last use — exact for the common case,
   a stub nobody mentioned twice;
3. an **anchor** the sweep writes in box-2 meta (`schemas.fade.anchor.<id>` =
   `{ day, date }`) for every live card that has none, or has been used since its anchor.
   An anchor older than the last use is ignored until the next sweep replaces it.

So a card re-mentioned today has only the lived gap to go on until the next sweep anchors
it; at a 3-day cadence that loses a few days of precision, toward fading later. The sweep's
date is the cycle's date; `learned_on` is UTC provenance. They can differ by a day.

**Who runs it.** `sleep/`'s `fade` phase, after `prune` (sleep NOTES §17). Until now the
prune phase was archiving entity cards at 90 lived days, beliefs attached or not, because
nothing told it a card was different from a memory; it now skips them.

**Coming back.** A mention of a faded card's name is a fresh birth (§6), one live card,
tagged `schema.birth.after-fade`. One gap closed on the way: a long-lived process (the MCP
server) whose index still held a card that another process's cycle archived would
REINFORCE the archived row on mention — credited, never surfacing. `mention` now drops an
indexed card whose row is archived (`fadedElsewhere`) and births afresh; near-collision
refusals skip such cards too. The new card does not inherit the old one's aliases —
open, if it turns out to matter.

The numbers are experimental defaults, not measurements. On the demo store (13 cards,
lived day 30), a daily user going quiet would see 0 cards fade at +90 calendar days, 4 at
+180 and 5 at +365 — none of them people, all of whom have beliefs attached. The old prune
alone would have taken 8, 10 and 13 (the identity core included).

## 15. A card named in a saved memory's text counts as used (2026-09-24)

Until now a card was used only when a saved memory was TITLED with its name and its kind
was entity/person/place (`counterpart.ts#mentionFromProposal`). Someone the owner talks
about every day, in memories titled otherwise, never refreshed their card and faded once
§14's floors passed. The owner's intent: a card someone is still talking about stays.

Now every door that mints — a deposit (session_end, note, CLI note), a crash-fallback
sweep, an episode ingestion — hands the memory's title and body to `creditNamedIn`, which
credits each live card named there as a whole word (the one rule, `encode/words.ts`,
through `AliasIndex.matchesIn`). The credit is the title path's: `store.reinforce` at
`MENTION_TIER`, so physics' birth-day and once-per-lived-day refusals apply, and a card is
credited at most once per memory however often it is named. The card the title path just
handled is skipped. One pass over the live index per memory.

What it does not do:

- **birth.** Only the title path births; text only refreshes cards that exist.
- **credit an ambiguous handle.** A handle two live cards share credits neither, as the
  title path refuses it. A card still named by its own unambiguous name or alias is credited.
- **revive a faded card.** An archived card is not in the index (and one faded by another
  process is dropped at the lookup, as `mention` does). Re-birth stays the title path's
  job. Open question: whether a faded person named in bodies should come back — for now,
  titling a memory with the name is how they do.
- **touch the identity core.** A `kind: "self"` card is skipped, as the title path refuses it.
- **write under observer.** No door mints under observer, and the composition checks too.

Episode ingestion reaches this through an injected `onMemoryMinted` on `self/` (it cannot
import this module). An episode that regrows re-ingests its whole text, so names from
earlier chapters are credited again on the regrowth day — bounded by the regrow window.

Short or common names: the guards are the ones births already have — `NAME_MIN_CHARS`,
aliases' `ALIAS_MIN_CHARS`, and whole-word matching (so "Mikey" is not "Mike"). There is
no stopword list; a card named with a common word is credited whenever prose uses that
word, the same exposure preselection already has.

Also: `fadedNamed` now matches only cards archived by the fade (`FADE_REASON`), so a card
archived for another reason no longer labels the next birth `schema.birth.after-fade`.
