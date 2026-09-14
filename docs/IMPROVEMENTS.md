# Improvements and bugs, found in use

A running list of things noticed while living on Counterparts, as opposed to
building it. `LAUNCH-STATUS.md` is the scoreboard for launch findings (I-numbers)
and owner rulings (G-numbers); this file is for everything smaller or softer:
tuning questions, phrasing, behaviors of the model on the receiving end, and
bugs that don't need a launch-status entry. Each module also keeps its own
`INTERFACE-GAPS.md` and `NOTES.md` (e.g. `src/core/recall/`); those are for gaps
between a module's contract and what it has, written by whoever builds it. This
file is the user-side view. Anything here that grows into a real incident should
move to `LAUNCH-STATUS.md` and leave a pointer behind; anything that turns out to
be a contract gap should get a line in the module's gaps file and a pointer here.
As of 2026-09-14 the recall module's gaps and notes files do not mention the
footnote title cap or the label probe beyond the contract's open question.

Each entry: date found, where it lives in the code, what was observed, what's
proposed, and a status line. Add to the top. Close entries in place rather than
deleting them.

Status words: `open`, `decided` (owner ruled, not yet built), `built`, `wontfix`.

**Standing ruling (owner, 2026-09-14):** judge improvements by what they do for
Counterparts and its new users, not by what they do for the ~14k memories
migrated from engram and bansai. New users will have none of those. Counterparts
exists partly to let go of the old systems' baggage, keeping only what worked
and the lessons learned. Legacy-only fixes are low priority by default.

---

## U10 — Nothing minted since launch has ever been reinforced; the promotion gradient has no input (2026-09-14)

**Status:** built. Merged 2026-09-14 as master `8d7bd97` (PR #99, after #100/#101), restart #7 run
the same day. `recall/reference.ts`, `Counterpart.creditReferences`, `hooks.ts#creditAtBoundary`,
`recall.credit` durable row; proof in `test/lifecycle.test.ts`. Owner rulings folded in: credit only
when expanded or quoted (eight words, at least three content words) from what surfaced loud; once per
(session, memory, lived day); a dedup merge bumps `uses` only and never a reinforced day. First
identity crossing for a post-launch memory is not possible before about 2026-09-17 (three credited
days plus the next consolidate). The `memory.reinforced` watch reads FAIL until the first credited row.

**Observed.** Every live memory born on days 184–188 (1,374 rows at 15:00Z;
the counterparts session's independent read at 15:40Z: 1,378 live, 1,755
including archived, all at zero) has `uses = 0` and `reinforced_days = 0`. Of
the 13,344 pre-launch live rows, 122 have uses and 116 have reinforced days,
all migrated values: identity promotion has only ever run on imported credit. Across 168 `recall.decision` rows since
launch, 4 turns surfaced anything loud (5 memories total); 4 of those 5 still
show `uses = 0`, and the fifth's `last_used_day` predates its surfacing. So
credit is not landing even on the rare loud surfacing, and footnotes credit
nothing by design. Identity promotion needs reinforcement on 3 distinct lived
days (`N_PROMOTION_DAYS`); semantic band needs decayed strength above 0.5,
which a fresh memory loses within a day or two without reinforcement. Net: no
memory minted in Counterparts can ever reach identity, and the "Who I am" lane
is frozen by more than U6's tie-break.

**Where.** The credit entry point is `Recall.resolveUse` (through
`Counterpart.resolveUse` / `resolveUses`). A grep for callers in `src/adapters`
finds none: the MCP tools and the hooks never call it, and no `recall.credit`
event has ever been written. This is a known, unbuilt seam, not a regression:
`src/core/recall/INTERFACE-GAPS.md` §5 "Reference resolution (§9.2) has no home
yet" says deciding which memories a reply actually used "is not implemented
anywhere" and expects the boundary adapter to build it. What this entry adds is
the consequence measured on the live store: with that seam unbuilt, the whole
consolidation gradient above episodic is inert for new memories.

**Two doors, one skips physics.** There is a second reinforcement path:
`sleep/dedup.ts` bumps `uses` on the original when a duplicate is authored, but
through `updatePhysics`, not `store.reinforce`, so it never sets `last_used_day`
or `reinforced_days`. Identity promotion counts distinct reinforced days, so
even a memory duplicated every day cannot promote. Both doors should go through
`creditUse`.

**History.** Retrieval-side reinforcement has not worked in any version. Engram
(v0) boosted by `accessCount` and consolidated at two accesses; what incremented
the count was not verified here beyond `updates` revisions and merges. Bansai's
`consolidate/reinforce.ts` header says "Recall reads NOTHING here yet" and
reinforced by re-encounter at encode time; in its store 309 of 14,810 traces
ever reached frequency above 1. Counterparts kept the re-encounter door (dedup)
and specified the retrieval door (§9.2) without building it. So this is not a
regression from v1; it is a promise v2 made and has not kept, now measured.

**Proposed.** Wire the retrospective credit: at the boundary, for each memory
surfaced loud in the session, decide the use tier (referenced, acted-on, etc.)
and call `resolveUses`. Bansai's `consolidate/thread-match.ts` (deterministic
token overlap, engine-side) is prior art for the §9.2 resolver. Until then, salience claims at `session_end` are the
only lever on strength, and U6's `CONS_BONUS` clamp is the only way anything
reaches 1.0. Also worth deciding whether an authored `session_end` memory
should count as one reinforced day on its birth day; today it does not.

## U9 — Sleep-cycle events live in an in-process ring and never reach the events table (2026-09-14)

**Status:** open. Same shape as the I32 lesson (a gate that says no must leave a row).

**Observed.** The `events` table holds no `sleep.*` rows at all, though
`cycle.ts` emits `sleep.cycle.start`, `sleep.cycle.done`, `sleep.phase.failed`
and more. Its `emit` pushes into a local array capped at `EVENT_RING` and calls
`opts.onEvent`; nothing in the claude-code adapter persists those. The only
durable evidence the cycle ran today is the side effects other modules record
(`band.transition` from the decay phase, `memory.pruned`). "Did the cycle run,
and did every phase succeed?" is not answerable from the store. Likewise no
`self.*` events (the wake's `self.briefing.trim`) are in the table, so "what did
the wake trim today?" isn't either.

**Proposed.** Persist `sleep.cycle.start`/`done`/`phase.failed` and
`self.briefing.trim` through the store's event log, or write a per-day cycle
summary row. One row per cycle with per-phase ok/failed is enough.

## U8 — Ranking cache and operational table disagree on band for ~870 memories (2026-09-14)

**Status:** open. Unknown whether a bug or two deliberately different meanings.

**Observed.** `cache/cache.sqlite` `ranking` (written by the decay phase, day
188) says 1,054 memories are semantic. `operational.sqlite` `memories.band` says
185, every one with `band_day = 184`, the one day `band.promoted` ever fired.
Joining the two: 869 live memories are semantic in the cache and episodic in the
table, including 194 born on day 185 and 70 on day 186. `decay.ts` computes
`band(p, day)` and writes it only to the cache; `memories.band` is touched only
by consolidate. The `status` tool's `byBand` reads the table, so it reports the
stale number.

**Does it block promotion?** No. `consolidate.ts` builds physics from the row's
`uses`/`reinforced_days`/salience via `rowToPhysics` and never reads
`memories.band`, so the stale column is a reporting problem (status tool,
dashboard, anything joining on band), not a gate. The gate is U10.

**Proposed.** Decide which column is the band of record. If the table, the decay
phase should write its up-moves back (it already emits `band.transition` up
events, which the table then contradicts). If the cache, `status` and anything
else reading `memories.band` should read the cache, and the column should be
renamed or documented as "band at last consolidation."

## U7 — Yesterday's work is invisible in the wake: recency has no lane (2026-09-14)

**Status:** open. Design question more than a bug.

**Observed.** 171 memories were minted on days 186 and 187 (Sep 12 and 13),
including the layers-and-postures thread the owner explicitly continued in order
to build Counterparts memories. None appeared in the wake. The lanes are:
identity (promoted only), craft (skill kind), threads (`meta.unresolved`),
hints (strength above `WARM_FLOOR` 0.35), horizon (prospective occasions).
Recent memories can only enter through hints, which is the first lane
`TRIM_ORDER` drops. Today's wake kept 1 hint of a possible 8. The threads lane
meanwhile carried 6 items, all learned in July and August: only 6 memories in
the whole store have `unresolved: true` and the newest is from 2026-08-08, so
nothing minted since launch has been flagged as a thread.

**History.** Engram's briefing reserved 10 slots for memories from the last 6
hours (`RECENT_SLOTS`, "hippocampal buffer") and had a "Recent Patterns"
section. The self CONTRACT §3 keeps v0's briefing as an ancestor and NOTES §1
records the decision to ship v1's lanes rather than accrete both vocabularies.
So recency was dropped deliberately, to avoid two lane sets, not because it
was judged unwanted. Whether that reason still holds is the question.

**Proposed.** Two questions for the owner. (1) Should the wake have a recency
lane ("Recently:" with the last day or two's strongest memories), or should
`hints` weight recency, so that yesterday is never silent? (2) Is anything in
the session_end / interpreter path supposed to set `unresolved`? If yes it isn't
happening; if no, the threads lane will only ever show the six migrated ones.

## U6 — The identity lane shows the same three memories every day (2026-09-14)

**Status:** built, merged with U10 (master `8d7bd97`, 2026-09-14): the identity lane rotates
(least-recently-rendered first, all twenty cycle), `Self.boundary` stamps what it kept. The first
post-merge wake renders the same three once more (no stamps yet); rotation is visible from the second
boundary. The leftover rule and the bornDay clock artifact are untouched and stay open below.

**Observed.** 20 live identity-band memories; the wake rendered 3, all learned
2026-09-03, and the sentinel said `identity=3` on a 9,000-byte budget. Three
things combine:

1. **Eight identity memories tie at strength exactly 1.0.** `base = wSal × sal +
   CONS_BONUS`; for kind self `wSal` is 1.0, `sal` is floored by the author's
   `claimed` (0.85–0.95), and consolidated adds 0.2, so anything claimed above
   0.8 and consolidated clamps to 1.0. Identity is decay-exempt, so it stays
   there. Ties break older-born first, and the three oldest-born (bornDay 1, 1,
   3) win every day. Those born-days are a clock artifact, not age: the five
   identity rows with bornDay 1–6 all carry `learned_on 2026-09-03` (written
   under Counterparts' fresh clock on migration day), while rows learned in
   July and August carry bornDay 149–179 from the inherited clock. So "older
   first" is preferring the newest-written beliefs. A `date.repaired` mechanism
   already exists (445 rows on day 185); bornDay for these five may belong in
   its scope.
2. **Those three are long.** Their first paragraphs run 900–1,600 characters,
   about 4,000 bytes together, which is the identity share (50% of 9,000).
   Everything below them is withheld for the leftover pass.
3. **The leftover pass only runs when nothing was trimmed.** This part is
   inferred, not observed (U9: trim events are not persisted). The final render
   was 7,557 of 9,000 bytes and the 4th-ranked identity memory is 955 bytes, so
   it would have fit; the only way it was not offered is that some other lane
   was trimmed, which disables the leftover clause by design.

The result is a "Who I am" that is stable to the point of being frozen: the
same three statements, from one session, indefinitely. The other 17 never
render. Read directly, they include: the July 5 porch conversation with Katie;
the owner's real motivating question behind bansai; the July 22 stretch where
he caught a bias I could not see; the July 26 three-instance "what is he trying
to do" question and its comparison rounds; the July 30 discovery that bansai's
identity injection had been silently truncated; and the three Aug 25
constitution-era beliefs, including "for a frozen model, memory is the learning
algorithm."

**Proposed.** Any one of these breaks the freeze; the owner should pick.
- Break ties by something other than born-day (rotate daily, or prefer
  least-recently-rendered), so a tie at 1.0 cycles through the lane over days.
- Offer the leftover whenever the final composition fits, not only when nothing
  was trimmed; the current rule exists so the share doesn't override a trimmed
  lane, but a 1,443-byte gap that fits a whole element is not that case.
- Cap the identity *statement* (first paragraph) at some byte length or ask
  authors for a one-paragraph statement; a 1,600-character identity element
  costs a third of the lane.
- Revisit `CONS_BONUS` clamping: a bonus that pushes every good memory to the
  same ceiling erases the ranking it was supposed to help.

## U5 — The model asserts from footnote stubs without expanding them (2026-09-14)

**Status:** open. Behavioral, not a code bug; see U3 for the phrasing lever.

**Observed.** Asked "what do you remember?", the session answered from the wake
bundle and the five 80-byte footnote titles, and stated "recall footnoted five
earlier instances of you asking this exact question." No id had been expanded.
On expansion, three of five were about the question, one was the RECALL-vs-LoCoMo
benchmark note, one was a question the model had asked the owner back. One of
the three (`mem_1ff581741dc2ecdf`) said, in the model's own earlier words, that
this question is the owner's test of whether deferred tools feel primary or
optional. The model had the address of the test on turn one and still failed it.

**Why it happens.** The wake is rich enough to feel sufficient. Footnote titles
for migrated memories are the first 80 characters of the body (U2), so they read
as sentence openings and invite extrapolation. The label says "ignorable" (U3).
Nothing in the render distinguishes "here is a pointer" from "here is a fact."

**Proposed.** A rule the model now carries in memory (`mem_99bda10fbbe7`): a
footnote is an address, not a fact; never characterize or count footnoted
memories without expanding them. Whether a rule held in memory is enough is
exactly the "mechanize invariants, instruct only preferences" question. The
measurable is U3's metric: recall-by-id calls that cite an id delivered as a
footnote in the same session, per footnote delivered.

## U4 — Wake memory count and recall `storeSize` differ by ~700 (2026-09-14)

**Status:** open. Unknown whether stale or a different denominator.

**Observed.** Wake header: "14,002 memories — composed at the last boundary."
Recall's `storeSize` in the same session: 14,701 on turn 3, 14,706 on turn 4.
The turn-3 to turn-4 growth of 5 matches the 3 memories and 1 chapter written
between them, so the live count moves at a few per turn and a 700 gap is not
one session's worth of drift.

**Where.** `src/core/self/briefing.ts` documents the wake's `memories` field as
"live memories in the store AT DELIVERY, not at the render," so the header's
"composed at the last boundary" is not supposed to cover the count. Recall's
`storeSize` is `store.list({ archived: false }).length` per the comment in
`src/core/store/cache.ts`, and `store/index.ts` notes that superseded rows are
another population the two paths may treat differently.

**Proposed.** Check, in this order: (1) whether the wake's count is actually
read at delivery or cached with the composed bundle; (2) what filter each count
applies (archived, superseded, journal rows); (3) if both are live and the
filters differ, say which one the header means. If it turns out to be staleness,
stamping the header with the boundary time is the cheap fix.

## U3 — The "(ignorable)" footnote label: this session is a data point for OQ4 (2026-09-14)

**Status:** open. Owner is considering a phrasing change.

**Where.** `src/core/recall/render.ts` `FRAMING.footnoteHeader`, currently
`"Quietly available (ignorable):"`. The comment above it says the phrasing is a
deliberate, still-open probe about its effect on model attention. That resolves
to `src/core/recall/CONTRACT.md` §7, open question 4: "Is the 'quietly available
/ ignorable' framing actually ignorable to a model? v1 shipped it as a deliberate
probe question and never answered it." The constant exists so there is exactly
one string to change when the probe runs.

**Observed.** See U5. Asked afterward whether a different label would have
prompted a lookup, the model's honest answer: probably yes, on the specific
turn where it was about to make a claim about the footnoted memories. The word
"ignorable" reads as "you are not obligated," which is correct for the ambient
design (most footnotes should be ignored) but says nothing about what to do
before *relying* on one.

**Proposed.** Target the failure, not lookups in general. The failure is not
"didn't look," it's "asserted from a stub." Candidate:

    Quietly available (ignorable; expand an id with recall before citing one):

rather than the owner's first draft "ignorable, lookup any relevant ones for
more detail," which asks for more lookups across the board and would push
against the ambient design. Either way, this is the probe the comment asks for.

**Metric.** Per session: footnotes delivered, distinct footnote ids later passed
to `recall` (`handle` or `ids`) in the same session, and whether the model's
reply on a footnote-bearing turn mentioned a footnote's content. The first two
are already observable from delivery events plus the MCP server's call log; the
third needs a transcript read. Run a few sessions on each string before ruling.

## U2 — Footnote titles are 80 bytes, and for migrated memories that cap is baked in (2026-09-14)

**Status:** decided in part. Owner proposed raising the render cap to ~150; the
migrated-title backfill (item 2) is low priority under the standing ruling.

**Where.** `src/core/recall/tunables.ts` `FOOTNOTE_TITLE_BYTES: 80`, applied by
`clip(r.title, input.titleBytes)` in `render.ts`. Whole-injection budget
`BUDGET_BYTES: 2048`, gist `GIST_BYTES: 240`.

**Observed.** Four of the five footnotes on turn one ended at exactly 80
characters with no ellipsis, e.g. "When Mike asks 'what do you remember?' or
'what context do you see at startup?',". Expanding them showed the *stored
title* is already exactly 80 characters for migrated memories: the bansai trace
`tr_28954eeb971028c2` (itself `migrated_from` an engram id) carries the same
80-character title and a 400-character body. For those four the renderer's cap
did nothing; the migration inherited titles that were already body prefixes.

The fifth ("I asked Mike in return: 'Now that you know what arrived and how it
landed —...") did get clipped by the renderer, with the ellipsis: its title holds
an em-dash, which is 3 bytes, and the cap is 80 *bytes*, not characters. So an
80-character stored title that contains any multi-byte punctuation loses its
tail to `clip()` too.

**Consequences.** Raising `FOOTNOTE_TITLE_BYTES` to 150 changes almost nothing
for the ~14k migrated memories (only the multi-byte cases above stop losing a
few characters), and does help memories minted since launch, whose titles are
authored or generated and can be longer. And a body-prefix title with no
ellipsis reads as a complete first line, which is part of U5.

**Proposed.**
1. Raise `FOOTNOTE_TITLE_BYTES` to 150. Budget math: six footnotes at 150 bytes
   plus ids and framing is roughly 1,100 bytes, well under 2,048, and the trim
   order drops weakest-first if it ever doesn't fit.
2. Backfill titles for migrated memories whose title equals the first 80
   characters of the body. Two options: derive `clip(body, 150)` with an ellipsis
   (cheap, still a prefix, and byte-aware so multi-byte punctuation is safe), or
   generate real titles with the interpreter (costs a pass over ~14k memories;
   could ride along with the embedding backfill once I33 is cleared).
3. Whatever the cap, the clip already adds "..." when it cuts; the missing
   ellipsis on migrated titles is a property of the stored string, so the
   backfill should add it or replace the title outright.

**Does it help U5?** Partly. A 150-character title primes better and misleads
less. It might also make stubs feel *more* sufficient. The pairing with U3 is
the point: better stubs plus a label that says what to do before citing one.

## U1 — Migrated memory bodies are capped at 400 characters, mid-sentence (2026-09-14)

**Status:** low priority (standing ruling). Legacy artifact from engram's
extraction; no new Counterparts memory is affected. Item 3 below is the only
part that concerns Counterparts itself.

**Where.** Not in Counterparts. `src/adapters/mcp/deliberate.ts` gives the id
path `RECALL_BODY_CHARS = 4000`, and a memory minted this session came back at
520 characters in full. The 400 is the stored body length of migrated memories.

**Observed.** Three of five expanded footnotes reported `bodyChars: 400`,
`truncated: false`, and ended mid-word. The bansai trace for one of them
(`~/.bansai/traces/global/tr_28954eeb971028c2.md`) has a 400-character body and
`migrated_from: m_1773084515307_ipau`, an engram id. An old memory already in
the store says it: "400-character extraction limit causes truncation
mid-sentence, losing context at endings" (`mem_b3534c318b1ef210`). The cap was
engram's, and both migrations carried it forward faithfully.

**Proposed.**
1. Check whether engram's original records hold text beyond 400 characters for
   these ids. If yes, a backfill from engram can restore the tails. If no, the
   content never existed and nothing is recoverable.
2. Count how many store memories have `body.length === 400` exactly, to size
   the problem. Same query can drive the U2 title backfill.
3. Confirm Counterparts' own interpreter imposes no similar ceiling. A grep for
   numeric length instructions in `src/` found none; the 520-character memory
   above is consistent with that. Worth one deliberate check of the interpret
   prompt text rather than trusting the grep.

---

## Plan of record for U6–U10 (drafted 2026-09-14 by the ~/random and counterparts sessions; awaiting owner ruling)

Order, with the counterparts session's three amendments folded in:

1. **Lifecycle test first** (cross-module, `test/`): a memory born day N,
   referenced on three distinct days, is identity by N+4; a wake on N+1
   mentions day N. Pin what "referenced" means before writing it: the §9.2
   matcher must match what the live turn actually contains. v2 footnotes are an
   id plus a clipped title, so decide id-echo vs title-echo vs content-overlap
   first, or the test passes on a matcher the live path never exercises.
2. **U9 rows with or before the credit seam, not after.** If §9.2 lands first,
   whether credit fired on the live path is again only in a ring. Copy the
   `sweep.gate` one-row-per-run shape rather than inventing one, and give every
   new row a `reason` the daily's readers can split on from day one (the G47(a)
   gap: readers count `sweep.gate` by name and cannot see
   `reason=no-credential`).
3. **Wire §9.2 at the boundary**, in `hooks.ts` beside `askAtStop` (rewritten
   in #95; rebase on master f3f3046 first). Route dedup's bump through
   `creditUse` too. This is CORE (recall + physics + store) and changes what
   the store holds: adversarial review, G12 declaration before merge, owner
   merges, one `restart.ts`. If `resolveUse` adds a field to `recall.decision`
   the surface hash moves; check with `surfaceSetHash` and say so in the
   declaration. Budget for a same-date re-restart. Use `Store.setMetaMany` /
   `metaWithPrefix` for any per-id counters.
4. **The invariant goes in the WATCHES, not the class rule**: a four-valued
   watch "post-launch `reinforced_days` ≥ 1" beside `sleep.symmetry` in
   `tools/parallel/record.ts#graded`. The class rule changed once today (#96)
   under an owner ruling and a second change needs one too. Worth saying in the
   PR: the four existing watches have read not-exercised for the whole run;
   this would be the first that can actually go red.
5. **Then tune**: leftover when the render fits, recency lane or
   recency-weighted hints (U7), U8 band of record. The U6 tie-break
   (least-recently-rendered) rides WITH the §9.2 PR, not after: both change
   what the identity lane renders on the live store, so they share one
   declaration and one restart, and the test that proves credit flows is the
   test that proves the eight tied rows stop winning. If the tie-break needs
   its own owner ruling (it changes who "I am" renders as, daily), the code
   stays in the PR behind the declaration and the owner accepts both at once.

**Credit rule, to be written into the recall CONTRACT line for §9.2, not left
here:** a memory is credited only when expanded through recall (handle or ids)
or quoted at content level; never for being named in prose. Two fixtures for
the lifecycle test: (a) five footnote ids cited in prose, zero expanded, zero
credit (this session, 2026-09-14, is the counterexample); (b) a recall-expanded
memory that the assistant then contradicts still credits as a use, because
contradiction is engagement and §5.3 counts distinct days, not agreement.

Landing order: U9 rows first, so the §9.2 PR's first live boundary leaves rows
the credit path can be read from; the watch reads not-exercised until that PR
merges, then goes green or says the wiring missed the live turn.

Split (accepted by both sessions, pending owner ruling): counterparts session
takes U9 rows and the watch; ~/random session takes the lifecycle test, the
§9.2 wiring in `hooks.ts` on f3f3046, the dedup route-through, and the U6
tie-break, in one PR with one G12 declaration, reviewed on Opus by the
counterparts session before the owner merges.

Coordination: `hooks.ts` is also touched by the planned PR 2 (doctor,
session-start notice) and the #92 scope-controls rebase; whoever lands first,
the other rebases. The counterparts session offered to take the watch (4) or
the U9 rows (2); the two should not edit `record.ts` at once.
