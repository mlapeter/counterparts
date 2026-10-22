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

Since 2026-09-24 a saved memory naming the faded card in its text counts as "mentioned
again" too, through the same birth (§15).

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
handled is skipped. One pass over the live index per memory, and one over the faded
cards' handles.

What it does not do:

- **birth a card that never existed.** Text only refreshes cards that exist, or brings
  back one that faded (below).
- **credit an ambiguous handle.** A handle two cards share — live or faded — credits and
  revives neither, as the title path refuses it. A card still named by its own
  unambiguous name or alias is credited.
- **bring back a card pruned or removed.** Only cards archived by the fade come back.
- **touch the identity core.** A `kind: "self"` card is skipped, as the title path refuses it.
- **write under observer.** No door mints under observer, and the composition checks too.

**A faded card named in the text comes back** (owner, 2026-09-24: if you're talking about
someone again, they matter again). It returns the way a title mention returns it (§6): a
fresh birth through `mention`'s own tail (`settle` → `birth`), tagged
`schema.birth.after-fade`, plus a `schema.mention.revived` event naming the prior id.
The new card carries the old name and aliases, so a later alias mention resolves; an
alias a live card now holds is dropped, as at any birth. The title path's refusals
apply (a near collision with a live card keeps it faded); the per-chunk birth cap does
not, since nothing is invented. Faded cards live in a second `AliasIndex` fed at open,
by the sweep, and when a card faded by another process is dropped from the live index.
A faded card whose exact name a live card holds is that card's past life, not a rival
handle; of several faded cards with one name, the latest-born speaks. So two memories
naming a faded person on one lived day make one card, and later bodies credit it.

Known gap: a long-lived index (an MCP server) that never heard another process bring a
card back still sees only the faded one, and a body mention there would bring it back a
second time — two live cards, one name. The title path has had the same gap since §14;
body mentions make it likelier. Closing it wants a meta query (INTERFACE-GAPS §2).

One difference from the title path, on purpose: when the title path refuses a mention
(say a memory titled "Portland" as a `person` while a `place` card holds the name), the
text pass still credits the place card the body names — it is still being talked about.

Episode ingestion reaches this through an injected `onMemoryMinted` on `self/` (it cannot
import this module). An episode that regrows re-ingests its whole text, so names from
earlier chapters are credited again on the regrowth day — bounded by the regrow window.

Short or common names: the guards are the ones births already have — `NAME_MIN_CHARS`,
aliases' `ALIAS_MIN_CHARS`, and whole-word matching (so "Mikey" is not "Mike"). There is
no stopword list; a card named with a common word is credited whenever prose uses that
word, the same exposure preselection already has.

Also: `fadedNamed` now matches only cards archived by the fade (`FADE_REASON`), so a card
archived for another reason no longer labels the next birth `schema.birth.after-fade`.

## 16. The ordinary-memory arm settles (2026-09-29, contradictions)

`revision.ts`'s last arm was "link only" for an ordinary memory (owner ruling
2026-09-04): the loser stayed live and in recall, and nothing said it was over. An
AUTHORED `updates` now carries `how` (`changed` by default) and the arm calls
`reconsolidation.ts#settleOnWrite`, which writes a pair and its trail row: `changed` cuts
the old memory's strength once through `physics.changedFade` and recall labels it
earlier; `corrected` archives it `corrected`; `open` keeps both and labels each with the
other. The rows above it are untouched — belief and identity take pressure, a
current-state fact is replaced, an entity links, protected refuses — and a `how` sent at
one of them is reported as not applied rather than bent to fit. A swept declaration
(`applySweep`) sends no `how`: a retelling of a transcript does not settle what the
experiencer did not, so it stays a link. A journal chapter (`type` episode) stays a link
too: it is not a claim.

## 2026-10-03 — subjects: what a memory names (schema v12)

- **`subjectsIn(text)`** is the finder the store links with at every memory write
  (`Store#findSubjectsWith`, installed by `Counterpart`): the live cards a text names, by
  `creditNamedIn`'s rules — the one whole-word rule, `NAME_MIN_CHARS`, exactly one live
  holder (a handle two cards hold links neither). A faded card is not a subject: a mention
  revives it through `creditNamedIn`, and the rebirth looks back.
- **A birth looks back** (`linkNamingMemories`, from `birth`, so a revival too): the
  memories already written that name the new card are linked `via: birth`. One read of the
  memories' words and one regex per term; fail-open. `addAliases` does not look back for
  the memories naming a new alias — the brief asked for creation; an alias added later
  links the memories written after it, and a re-run of the backfill would catch the rest.
- **The backfill's reading** (`subjectLinksForAll`) goes through `AliasIndex#scanner`, the
  same hits as `matchesIn` with a word-token prefilter (`encode/words.ts#wordTokens`, the
  matcher's own word class) and every candidate confirmed by the one rule — so the
  prefilter can skip work without changing an answer (`test/recall-write-side.test.ts`).

## 2026-10-09 — the update guard: a `changed` or `corrected` is read before it moves anything

**Why.** §16's arm settles on the writer's word. A 10-02 benchmark read (counterparts-87,
LongMemEval, a Haiku 4.5 writer) found the `updates` pointing at an unrelated memory in
about two thirds of 149 sampled pairs — one memory about a mole removal retired a passport
name change. On the owner's store (Opus) all 10 checked were right. The risk is the weaker
host model, and the bad moment. The bench harness had dropped such links on its own side
(`plausiblyRelated`, `tools/longmemeval/store.ts` on `bench/longmemeval`); it drops that
once this lands.

**What.** Contract §5 1b states the rule. `Counterpart#guardUpdate` runs between intake
and mint, so a hold is a proposal with no `updates`: no `meta.updates` link, no reminder
carried or moved, no facts inherited, no thread closed, no settle, no pressure, and an
unrelated pair is never shown as a disagreement. The writer gets the old memory's words
and the neighbours' ask (`HELD_HINT`); `settle` with `holds`/`over` needs no new code. The
record is a durable `contradiction.held` row (ids and numbers, no text) and its reader
`heldCorrections`, which no line calls yet (mcp INTERFACE-GAPS §12).

**The calibration** (scratch script, not committed; potion-base-8M, the full index text
of each memory, cosine). 120 labelled pairs: 31 related and 29 unrelated from the demo
store's script (the challenges against their beliefs, the current-state correction, later
notes that change earlier ones on the same subject; unrelated = two notes on different
subjects, in one tight domain where "rota", "ward" and "shift" are everywhere), and 30 and
30 hand-written life and work facts (related ones worded differently on purpose — "lives
in Austin" / "Colorado is home now", "Postgres on RDS" / "migrated the main DB to
Aurora"; unrelated ones like the mole and the passport). Counts are related passed /
related held | unrelated passed / unrelated held:

| rule | related | unrelated |
|---|---|---|
| shared content word (the bench rule) | 46 / 15 | 12 / 47 |
| meaning ≥ 0.30 (**chosen**) | 50 / 11 | 1 / 58 |
| meaning ≥ 0.35 | 44 / 17 | 1 / 58 |
| meaning ≥ 0.40 | 38 / 23 | 0 / 59 |
| word AND meaning ≥ 0.30 (the brief's "both pass") | 41 / 20 | 1 / 58 |
| word OR meaning ≥ 0.40 | 50 / 11 | 12 / 47 |

The unrelated pairs topped out at 0.29 but one: two demo notes about reading (a solver's
constraint list, a printed rota) at 0.37, arguably related. Meaning alone holds the fewest
related pairs at the same one false pass; the words, as a second requirement, only add
held corrections, and as a second way in they let through every pair that shares a
common word ("back", "because", "staff"). So meaning decides when there are two vectors
and the words only when there are not. That is a departure from the brief's "both clearly
pass", named and held lightly.

**Limits seen.** Mean-pooled static vectors dilute: "Mike moved to Denver." / "Mike lives
in Colorado now." reads 0.68, but "Mike lives in Austin, Texas, in a rented house near
Zilker Park." / "Moved to Denver last month; Colorado is home now." reads 0.23 and is held.
Short texts lean on their function words: "The user changed her name on her passport." /
"The user had a mole removed." reads 0.28 — under the bar, not by much. Renames of a
technology (React → Svelte 0.17, GitHub Actions → Buildkite 0.27) read as unrelated. A
writer that is reading its replies settles those itself; a batch writer leaves them held,
both memories live, which costs a stale memory staying at full strength, never a wrong one
archived.

**Where it does not apply.** `open` (moves nothing). A content match (`content`,
`content+hint`): the engine's own reading, already held to a score floor. A sweep (no
`how`). And a close or a redate: an open thread (both documented roads close one, and an
answer rarely shares its question's words — "which cache?" / "Redis" reads −0.08), a
reminder field at a memory holding a date, a status unlike the one it had. A field the
memory has nothing for — `eventDate` on an undated memory, `status` where it had none —
dates or describes the new memory, so the pair is read. The cost of the open-thread rule:
a wrong id that happens to name an open thread closes it, `corrected` included — the
wake's "Still open" lane hands those ids out, so a writer pointing there is usually
pointing on purpose, and an unanswered thread held open by the guard would be the quieter
failure (the coordinator's call, 10-09).

### Review of #340 (2026-10-09): the false holds, the batch writers, and three ways to hold fewer

**Which writers are batch.** The nightly catch-up's child may call `session_end` and
nothing else (`night-catch-up.ts#CATCH_UP_TOOLS`): it cannot recall, so the only memory
ids it ever sees are the neighbours its own `session_end` replies list, and it cannot
`note` a settle even when it reads a hold. So on the owner's store few of its corrections
are declared by id at all, and those that are point at a neighbour, close to something it
just wrote. The SessionStart write-up and a live session's `session_end` are written by a
session that has `recall` and `note` and reads its replies. The benchmark writer calls
`submitSessionEnd` directly and today drops unrelated links on its own side, by the
shared-word rule. `writeUp` in the deposit context is not a batch signal: the SessionStart
write-up sends it too. The only crisp night signal is the runner's `writeup-` session
prefix, an adapter fact.

**The three ways to hold fewer, measured** (the builder's 120 pairs with real subject
cards: the demo store seeded into a temp dir, and a card for each person, pet, place,
project and product the hand set names; plus 20 pairs written for this review BEFORE
scoring, in the owner's style: ten corrections — a PR merged, a default turned on, a
decision dropped, a release changing hands, a role changing, a vendor replaced — and ten
wrong pointers between memories of the same project). Related held | unrelated passed:

| rule | 120 labelled | owner-style 20 |
|---|---|---|
| meaning ≥ 0.30 (the PR) | 11/61 (18%) · 1/59 (2%) | 0/10 · 0/10 |
| meaning OR a shared subject card | 11/61 · 1/59 | 0/10 · 1/10 |
| meaning OR a shared content word | 6/61 (10%) · 12/59 (20%) | 0/10 · 1/10 |
| a shared content word alone (the bench harness today) | 15/61 (25%) · 12/59 | 1/10 · 1/10 |

- **A shared subject card rescues none of the eleven.** Thirteen related demo pairs name a
  card in common, and every one already clears 0.30: a rare name weighs heavily in a
  static vector, so a pair that shares one is close in meaning anyway. The held eleven are
  substitutions (React to Svelte, Postgres to Aurora, Austin to Denver), which name no card
  in common. What the pass adds is a way through for two memories that name a hub card
  ("Counterparts", 0.27). And on the benchmark stores, 9 cards in 498 stores: idle where
  the weak writer is. Not built.
- **Guarding only `corrected` lets the default through.** `changed` is what a write gets
  when it sends no `how`, and facts mode folds a `changed`-settled memory under the new
  one as its earlier version (`mcp/facts.ts`), so a wrong `changed` is a wrong answer,
  not a harmless fade. Not built.
- **Meaning OR words for batch writers** (the coordinator's proposal) halves the false
  holds and lets a fifth of the wrong pointers through ("third", "doctor", "staff",
  "because"). For a writer wrong two times in three (the 10-02 Haiku read), wrong outcomes
  per declared update are about 0.07 under meaning alone and 0.17 under OR; for a writer
  almost always right, 0.17 and 0.10. OR is the better rule only for a strong batch
  writer, and core knows neither which writer is batch nor how strong it is. Not built;
  an owner question on the PR.

**Overfit?** The bar sits at the top edge of the unrelated pairs (the highest held one
reads 0.293), and five related pairs sit within 0.04 above it, so a fresh set will move
both counts. The owner-style twenty were not tuned to it: all ten corrections passed
(lowest 0.324, a contractor replaced) and all ten wrong pointers were held (highest
0.271). The hand-written related pairs were worded to share no word on purpose, so 18% is
likely the pessimistic end for the owner's own corrections. `heldCorrections`'
`settledAfter / held` is the number that will say.

**Terse closes.** A thread closes on the real table with a "done" the guard would
otherwise hold, through `note` and through `session_end`
(`test/update-guard.test.ts`). The tersest a write can be is the content floor's (20
characters, 3 words): "Done." alone is refused before the guard, as it was before it.

## The slot detector: noticing without being told (2026-10-11, Group 2)

Reviews 04 and 10 found the "A over B" machinery a declaration channel: 58 of 64 settles
came from the writer naming the old memory, and the same slot across days was almost never
linked (2 of 23). `reconsolidation.ts#detectSlot` is the door that needs no declaration, and
no model call. At every authored write, after the declared revision: the session's own
recent writes first, then the memory's stored neighbours (box 3, written at `put`), no more
than `SLOT_WINDOW_DAYS` lived days older, same kind, same `about`, both authored. A slot when
cos ≥ `SLOT_COSINE` (0.85), or cos ≥ 0.80 and either status lineage (`planned`, now `done`)
or the two titles at ≥ 0.85. Never a dated memory (a reminder is its own thing — three dated
reminders for one event read 0.94 to each other), a reading or world memory (consecutive
readings read 0.85), one already settled over (the head is what a newer one sits over), one
already waiting as the older of a proposal, the core, the protected, or a pair that was ever
a pair.

A hit is PROVISIONAL (review 10, D2): an unsettled pair with source `slot`, the trail's
`propose` row naming which holds, and the older's fade × `SLOT_FADE` (0.8; 1, no cut, since
2026-10-19, an experiment: the proposal flags only and the fade waits for a confirmation). Recall labels
the older "may be out of date"; the write's result carries the slot and the ask; the dream
sees it to confirm or undo (`slot {pair, same}`, at most four a night, beside the ranked
items). Whatever answers a proposal LIFTS its cut first, so a confirmed `changed` lands at
`CHANGED_FADE` in all, `open` and `corrected` leave no provisional cut behind, and an undo
puts the provisional cut back with the pair unsettled again (`settleDetail().lifts`).
Withdrawn ("two things"), the cut is put back and the pair is never proposed again.

On the 10-11 copy of the owner's store, the rule as it would have read at each write (all
20 lived days, the nearest qualifying older per new memory): 29 proposals, 20 of which the
writer had settled `changed` itself, sooner or later. A hand-read of 20 drawn at random: 17
right, 1 wrong (one the reviews had also called wrong), 2 unsure. Replayed on the store as it stands (the writer's settles already made, so a memory
already settled over is no candidate): 5 proposals over 20 lived days, 4 of them in the last 7
— about one a day of what nobody linked. The bench's a2f3aa27 pair ("1250 followers" / "close
to 1300") reads 0.82 by its whole text, 0.89 by its titles: the title arm is what catches it.

## Cards are born where names are (2026-10-11, Group 3 part D)

Review 12 found the only birth door title-shaped: `counterpart.ts#mentionFromProposal` passed
an authored memory's title as the name, and a title is a sentence that never occurs verbatim
in its own body, so 84 entity and person memories gave 0 births, and after 19 lived days the
owner's store had one card, the install-seeded identity core. The decision (item 17, revised:
KEEP) keeps the card as recall's person and project index — `subjectsIn` →
`memoriesNaming`, facts mode's subject channel — and fixes its birth. Rich person and project
pages are views over what a card links; not built.

**The door.** Sleep's `births` phase, right after the fade, every lived day, calls
`Schemas#birthsFromNames`: `names.ts#tallyNames` over the live memories, then `mention()` for
each name, most-named first, up to sleep's nightly budget (10). The gates are `mention()`'s,
unchanged. What the tally counts as a name, and why each rule is there:

- A run of one to three capitalized words seen **mid-sentence** at least once. A sentence's
  first word is capitalized by grammar. The run counts wherever it appears once proposed.
- **Counted by `nameRegex`**, the linker's rule, so the count reported is what the newborn card
  links when it looks back.
- **Not mostly a word.** The matcher has no case option, so "Will" would name every "will".
  A name that a quarter or more of its memories write in another case, in prose, is refused
  (`LOWER_CASE_SHARE` 0.25, CAL). Code and addresses don't count as prose: a path, a command
  in backticks, a version, a domain. Without that the project's own name, which is also its
  command and its directory, read as a word (0.53); with it, 0.16. The first cut ("never in
  lower case") refused it, and refused a name written in lower case in 2 of its 64 memories.
- Not a weekday or a month or their short forms ("Sep", "Fri" were the first junk seen).
- **The whole name, not a piece.** A name said as part of a longer one in at least half its
  memories gives way to it: "Kettle" to "Copper Kettle", "Lights" to "Harbour Lights". A card for
  the piece would refuse the whole name as a near collision for good.

**Kind** comes from what memories are ABOUT: the person/place/entity memories that carry the
name in their title. A person when those say person at least as often, then a place, else an
entity. Counting every naming memory's kind made a model and an API "people" (each had two
person-kind memories mentioning it in passing). A skill is never inferred from a name.

**Not offered:** a name a live card holds (the write path credits it), and a name a faded card
holds — the old memories that were there when it faded would rebirth it the next night, so it
comes back the way a faded card does, when a new memory names it.

**Kept out of results.** A newborn card's body is a stub ("Born by mention… Asserts nothing
yet."). Once cards were born, a turn naming someone footnoted the stub, and facts mode listed
it among her memories; both now leave cards out (recall CONTRACT §5, `facts.ts#neverAResult`).

**Measured on a copy of the owner's store** (2026-10-11 snapshot, 1,009 live memories, lived
day 20; the copy migrated v12 → v13 on open and its lexical index rebuilt first):
- Before: 1 card (the identity core). The tally: 763 names proposed, 99 over the bar, 141
  refused as words; 274 ms.
- Twelve simulated nights: 10 born a night for nine nights, 90 in all (85 entity, 5 person),
  none faded or lost; nights 10–12 offered only the 11 the gates refuse every night (10
  `collision-near`, 1 `name-not-in-source`, a name only ever written possessive). A session
  end took ~650–740 ms on a birth night, ~230–310 ms after.
- The spouse case: her card was born on night 3, kind person, 15 memories linked. Facts mode
  by her name: 14 matched before, 14 after, none lost. The memories that name her only by her
  role ("his wife") are not reached: an alias would reach them, and nothing produces aliases
  (`addAliases` has no live caller; the `remember` tool does not take them).

**Known, not resolved.** The owner's own card is the identity core, kind `self`, so "facts
about him" have no person card to sit on, and none can be born: his name is held, and a near
variant is refused `collision-near`. That is review 12 §4.5's collision, left for cards as
views (synthesis L). The identity core's aliases are minted once from config; a nickname of
the owner said often enough would be born as a person card (none on the copy), and so would
a misspelling of his two-word name (a test with a synthetic owner: his first or last name
alone is refused `collision-near`; "Firstnme Lastname" and a diminutive are born). The config's
aliases are what close that.

**A card the owner removed stays removed** (review of #429). The chase blanks a card's name,
so the tally could no longer recognise it and would give the name a new card from the same
memories, undoing the removal. The chase now keeps the ids the card linked (meta
`removal.card.<id>`, `Store#cardTombstoneLinks`) — never the name or a hash of it, which store
§16 G9 forbids because a name is low-entropy — and `birthsFromNames` refuses a name whose
memories cover 0.8 of those still live (`removed-by-owner`). Its own name covers them all for
as long as they say it, so new memories naming it do not bring it back. A different name is
refused only if it is in nearly every memory the card linked. If the owner removes those
memories too, the record holds nothing: the name could then be born again from new ones.

## 2026-10-21 — `ensureSelfSubject`: the card my beliefs about me attach to (store v14)

- One public write, for wave 2's lane C: `ensureSelfSubject()` calls `Store#ensureSelfSubject`
  (make once, protected, revive an archived one; the store's comment has why its kind is
  `fact`) and registers the card in this module's loaded meta, so `addBelief` on it is not
  refused `entity-unknown` in a `Schemas` opened before the card existed. The card has no
  name, so the alias index gains no handle. Nothing calls it yet. Lightly held.

## Beliefs, born weak and earned by life (2026-10-21, wave 2 lane C)

`addBelief` had no caller from August to October. Lane C gives it producers (C2, C3) and,
first, a way to be earned (C1). What C1 decided, each lightly held:

- **Born weak through the seam.** The ceiling caps the dimensions and the claim at
  `clampSalienceAtSeam` (the seam's ceiling is the lower of the channel's and
  `BELIEF_BIRTH_CEILING`), so a cut is recorded as a `salience.lifted` with `capped`, as the
  sweep's always was. With nothing said the claim is the ceiling itself: a belief at 0 would
  be below reach the day it is born. A `migrated` belief keeps its strength (the 2026-08-29
  ruling that migrated is lived v1 state); the tests that exercise the pressure arithmetic
  on a strong belief use that channel, since no born belief reaches their strength.
- **Testimony and choice are read, never claimed.** A caller's `testimony` on a memory with
  no `said_by` is filed `found` with a note — accept and repair, not refuse.
- **What is lived.** A `memory` or an `episode` row, not a dream's words or a reflection's
  entry (`reflect.ts#notLivedReason`'s two sources). A card is not support; another belief
  is, only by `link`, and only at `SUPPORT_LINK_FLOOR` (0.35) — just above a newborn's 0.3,
  so a newborn lends nothing.
- **`use` and beliefs about me.** Refused on a belief marked me/us or on the self subject or
  the identity core: a belief about me grows from what fits, not from being used at work.
- **Contrary support contests; it never rewrites.** The revision path as built made the
  successor's statement the contrary memory's body ("Wren slept through the ferry…" as the
  new belief). For a belief born under lane C the crossing now marks it contested and cuts
  it once (physics §5.13); the reflection revises or retires it, and the owner's correction
  is the settle door, at once. A migrated belief keeps the old path and its successor stays
  migrated.
- **The self subject** is `ensureSelfSubject` above (lane A's door). C1 only reads it: a
  belief on it, or marked me/us, is "about me" for `use`.

## 2026-10-21 — tags at night, and topics (wave 2 lane B, second PR)

Design §1 (`counterparts-notes/2026-10-21-beliefs-design.md`), brief B items 2, 4–7.

- **`tags.ts`** is the arithmetic: the stop list, the merge map (`resolveTag` follows a chain,
  a cycle stops where it closes), the tally the topic bar reads, the look-alike pairs the
  night asks about (one's words inside the other's, or a letter apart on words of five or
  more, two on eight or more — two on five asked "denver" / "enter" on the corpus copy; a "not the same" answer kept under `schemas.tags.notSame.<a>|<b>` so it is not asked
  again), and `nightTagWork`, the tags phase's body: card names as tags (`via: card`), stem
  merges (`via: stem`, the alias the less-carried word), and a merge whose alias AND tag are
  on no memory at all let go (review of #569). Merges are applied on read, never by
  rewriting `memory_tags`, so undoing one is one row.
- **A name is a tag already promoted**: the night writes a linked card's name onto its
  memories, and a tag that a card holds as a name (or alias, live or faded) is never born a
  topic. The identity core's name is not written: the owner on everything about him says
  nothing.
- **Topic cards stay out of the alias index** for now (no name, like the self subject), which
  is what keeps lane B's promise that no recall result or wake line changes. Lane E decides
  how topics reach recall; lane D shows them. The fade sweep reads them like any card: no
  use credits a topic yet, so one fades on the calendar floor (180 days) — lane E's credit
  will change that.
- **Stems at night only.** The stored tag is the word as written; `stemKey` (store/stem.ts)
  is the merge key. If the stemming experiment is reverted, the `via: stem` merges stay
  recorded and undoable; nothing stored depends on the stemmer.
- **Measured on a copy of the 10-20 corpus**: 90 distinct tags after the card-name backlog
  (all names: the corpus has no writer tags yet), 75 of them over the topic bar and all 75
  refused `a-name-already` — so no topic is born from the corpus today; topics come from
  writer and night tags. 120 named cards have no subject kind (10 a night asked: 12 nights).
- **The journal's own rows are not tagged** (review of #573): a chapter's copy or summary
  (`source = 'episode'`) retells memories tagged on their own, and tagging it would count
  one moment twice in `tagCounts`, the cloud's weight. The night skips them in both the
  card-name pass and the tagging ask (`tag-reads.ts#NOT_JOURNAL`); `tagCounts` is left as A
  wrote it.
- **Known gaps, held for later:** a topic card the owner removes can be born again from the
  same tag (the tombstone keeps no `meta.topic`; lane D's "this is wrong" is the likelier
  door); a faded topic is not born again (`topicCards` reads archived ones too); TWIN
  entity cards of one name (40 pairs on the corpus copy, each pair born the same day with
  the same body) are not merged here. Their cause is a stale index: `Schemas` loads its
  cards once, at open, so two processes whose boundaries both run the births phase on one
  lived day each birth a name the other just did (reproduced: two `Counterpart`s on one
  store, each `sessionEnd`, two cards). The fix and a one-time twin merge are their own
  change; the night writes a twin pair's shared name once per memory. A card kind the v14
  upgrade got wrong (a project card of kind `place`) is never asked again: the kinds ask
  reads only cards with none.

## 2026-10-21 — review of #576: topics under the write lock, honest counts

- A topic birth asks "does a topic already hold any of these words?" again inside its own
  insert (`Store#putUnless`, the same method #578 adds for name births — identical text, so
  the two land as one), so two processes' cycles on one day cannot mint a twin; the loser is
  counted `a-topic-already`. `topicCards` maps a topic's merged words too.
- A merge that would close a loop (its tag already reads, through the merges, as the alias)
  is refused inside `recordTagMerge`'s own transaction (`store/wave2.ts`).
- Both births report `attempts`, what a night would try within each door's own limit, and the
  observer's report reads it: min(names, 10) + min(topics, 5), not min(names + topics, 10).

## Card twins: one name, two cards, from two workers at once (2026-10-21)

**What the corpus showed.** The 10-20 corpus copy has 40 pairs of live entity cards with the
same name (Google/Google, Bash/Bash…): 80 of its 131 live cards. Each pair has one birth day and
one stub body, and they come in tens: exactly 10 pairs on each of lived days 23, 25, 26 and 27,
the births phase's whole nightly budget, twice. No triplets. Days 21, 22, 24, 28 and 29 have
none.

**Why.** A session closing fires Stop and then SessionEnd, and each spawns a worker that runs
the sleep cycle. On day 23 the two `sleep.cycle` rows are 94 ms apart: in the second, decay,
prune, dedup, versions and log all say `already-done-today`, and births says `ran`. The marker
gate works for every fast phase and not for the slow one: births took ~1.3–1.9 s on the corpus
copy, and the second worker read its marker as due while the first was still minting. Each
worker then judged every name against its own index, read at open (INTERFACE-GAPS §2), so each
gave every name a card. The twins' `created_at`s interleave within a pair (the second-born id
is sometimes the earlier one), so the two ran at once, not one after the other.

**The fix, in `Schemas`.**
- A birth asks again under the write lock. `Store#putUnless` runs a check inside the
  `BEGIN IMMEDIATE` that would insert the card, and `birth` asks there `settle`'s three name
  gates — an exact holder, a near collision, an alias held — of the live cards this index has
  not taken in (`heldUnseen`). A yes stages nothing; the index then takes in those cards
  (`adopt`), and the mention is judged again, which ends at the other card (`existing`, the
  name reinforced as a re-mention would be), a refusal, or a birth without the alias it lost.
  `schema.birth.raced` counts it. The check reads only, so a birth with no race changes nothing
  else in the index.
- `birthsFromNames` takes in other processes' cards before the tally, so a name one of them
  holds is not offered at all. This covers a long-lived process whose index predates a card;
  it does NOT cover the corpus case alone (both workers read before either wrote), which is why
  the check under the lock is the fix and this the shortcut.
- A name offered as free that comes back `existing` spends the night's budget, as a birth
  would. On a copy of the corpus with two workers released together: 5 born each, 10 in all,
  no twin. Master on the same copy: 10 each, 20 in all, 10 new twins.

**Not done here.**
- The marker itself. Making the due read and the marker write one transaction means claiming
  the phase before its work, and property 2 of `sleep/cycle.ts` is that a marker advances only
  after the work: a worker killed mid-phase would skip the day. A claim that keeps that needs
  its own key with a lease (a wall clock in `sleep/`) and a new phase reason. With the check
  above, a second worker's births phase costs a tally and finds the names taken; what is left
  is the budget, which the two can still overshoot when one tallies after the other has born
  some (each counts from its own list). The briefing renders twice too, the same bytes.
- Merging the 40 existing pairs. Both cards of a pair ran `linkNamingMemories`, so a merge
  has to move or dedupe subject links, not only archive one card. Its own mechanism; until
  then each pair is an ambiguous handle, which recall already refuses to train on (SEAMS C).
- The identity core, minted by `self/` after this index loads on a store's first open, is now
  taken in by a birth that names it, which refuses it (`second-self-refused`) instead of
  giving the owner's name a person card.

**Review of #578, two fixes.**
- *A card killed between its birth and its look-back.* The birth commits the card, then
  `linkNamingMemories` links the memories already naming it. A process killed between the two
  left a card nothing links, and nothing would: the tally skips a name a card holds. Now, before
  the night's tally, a live card with no `birth` link looks back (`relinkUnlinked`, one read to
  find them, outside any write lock; `schema.subjects.relinked`). A births card always has some.
  On the corpus copy the only live card without one is the identity core, which is left alone, so
  nothing on it looks back at all. A card looks back ONCE: a look-back that ran leaves
  `schema.relinked.<id>` in meta (a card that truly names no memory would otherwise cost a full
  regex pass over every memory every night, ~80 ms at 2.5k memories); one that failed leaves
  none and is tried again.
- *"Unseen" meant never walked.* The check under the lock read only ids this index had never
  walked, so a card archived when it loaded and brought back by another process since was
  invisible to it. It now reads the live cards the index does not hold (`unseenCards`), and
  `adopt` registers them.

## 2026-10-22 — beliefs reach a session (wave 2 lane E)

Three reads for recall and one for the wake, no writes: `beliefsNamedIn` (the live cards a text
names by the alias index's one rule, plus the topics it names by their word —
`tags.ts#topicsNamedIn`, every word of the tag in order, stemmed as the index stems — and each
subject's `beliefStanding` with its name; never the self subject, which no turn names);
`tagPartnersOf` over `tags.ts#tagPartners` (a source's tags through the merges at 1, its concept
edges' top neighbours at 0.5; stop tags and tags on more than recall's cap skipped); and
`aboutMeBelief`, the check the slot's rating makes before a use. The wake's project line reads
`beliefStanding` on the folder's project card (lane G's `projectOf`). G15's "invisible for now" is
amended in the contract: beliefs are still never a recall candidate, a fact or a core element;
they are seen only in the slot and the project line. The store's `reinforce` now credits a belief
a use through one door (`beliefSlot`, a rating of the slot), refused for a belief marked about me
or us; support is untouched by it — the shown → used → stronger loop stays closed at support.

## 2026-10-22 — a card's birth kind is not its kind of subject (wave 2 follow-ups)

**What was wrong.** The v14 upgrade, and every insert since, read an entity card's birth kind as
its kind of subject: kind `person` a person, `place` a place. The birth kind is `kindForName`'s
vote over the kinds of the memories whose titles carry the name, and a memory of kind `person` is
about a person (usually the owner), not about the name in its title. On a copy of the 10-22
snapshot one such title made "Anthropic" a person, and one place memory beside one entity memory
made "Counterparts" a place. Katie, Clark, Jason, Ellis and Claude were also persons on one
title each. No threshold fixes that vote: "Counterparts" re-tallied today reads person 3, place 1,
entity 1.

**The fix.** `store/operational.ts#deterministicSubjectKind` now marks only the identity core
(a person, the owner). Every other card waits for the night's kinds ask, which a model answers
and which is shown the birth kind and titles as hints. `kindForName` breaks a tie with entity
toward entity ("a thing until a memory is about it"); that only moves how slowly a future card
fades. The night's tags phase gives the old rule's rows back once per store
(`tags.ts#repairBirthKindSubjects`): a row whose kind is the old rule's for its birth kind,
that nobody is recorded as setting (`schemas.subjectKind.<id>`), and that today's rule doesn't
give the same kind, goes back to NULL. The repair is recorded first in `schemas.kinds.repaired`,
with each id and what it was. It sits behind `TAGS_NIGHT`, because with the switch off nobody
would sort the cards it hands back.

**On the copy.** Live entity cards: person 10, place 1, unsorted 150 before; person 1 (the
identity core), unsorted 160 after. The ask takes 10 a night, most-linked first:
Counterparts, Claude and Anthropic on night 1, Katie on night 2, and the last of them (the two
Allex twins) on night 13.

**The twins: not merged here.** The brief asked to merge the existing twin cards (50 pairs on the
copy, not 40: ten more were born on lived day 31, before #578 reached live) through the dream's
merge path. That path can't take a card. `Dreams.showable` refuses any row that isn't
`type: memory` (dream CONTRACT §3: "no ... schema row"). The merge mints a new `type: memory` row
from the originals. The settle door it goes through (`reconsolidation.ts#doorRefusal`) refuses an
entity as `not-a-memory`. Its record (`dreams` + `dream_changes`, `Dreams.undo`) could carry a
change with no schema change only under a `dreams` row, and every reader of that table takes such
a row for a night's dream: `lastDream`, the night run's "began anything since", the dashboard and
doctor. So it was stopped and reported. On the copy every pair has identical
`memory_subjects` sets, no aliases, no beliefs, no folders and the same birth day. A merge
there is "archive one card with a reason of its own, record the card it stands under, undo =
un-archive", with nothing to move.
