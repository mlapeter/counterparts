# `schemas/` — CONTRACT

*This contract guides the work; it doesn't limit it. Anything here, RESOLVED items included, can be raised for discussion at any time and revised when there's a better way (constitution line 13).*

## 1. Purpose

Semantic memory: the entities experience organizes itself around — people, places, skills,
projects, systems — and the beliefs held about them, born by mention and revised by
physics.

## 2. Brain analog

Schema formation and semantic memory: repeated episodes abstract into a structure that new
experience is compared against, which is what makes prediction error possible. **Named
deviation** (constitution line 12): beliefs never blend into each other. Generalization is
only ever an explicit, provenance-carrying revision — biology's interference and source
confusion are the bugs, not the architecture (owner ratification 2026-08-08). Beliefs are
being built (wave 2 lane C, 2026-10-21): born weak, earned by support (guarantee 15); until
2026-10-21 the live schema rows were entity, person and place cards only. Today the one
many-into-one path is the dream's fold (it names its sources). Wave 2 may add others.

## 3. Keeps

- **The entity schema as the organizing unit** — a person, a place, a skill, a
  project/system, the self. Sectioned prose: stable core; current state; relations; beliefs
  with provenance and confidence; protected elements; lineage of everything superseded.
  [v1] behavioral-spec §4.2(b).
- **Project state does not live in identity; entities get their own homes.** [v1]
  earned-mechanism #5 — v1 measured ~72 KB of dated project status rendered verbatim into
  every self-keyed prompt, and 14 of self's 19 active beliefs were about projects with no
  retrieval key. **v2 decides where status lives on day one.**
- **Revision bars differ by kind, and a loosening is chosen out loud.** [v1] §4.3, §6.2 G3
  — world-state should flip on one clear correction; identity should not. The inertia
  table lives in `physics/` §5.3.
- **A newborn schema is empty except its names.** [v1] §14.3 — "birth creates a place for
  memories to attach, never a claim about what is true of the thing."
- **Whole-name matching, one definition, shared with preselection.** [v1] §8 G3 — birth
  must test a proposed name by *exactly* the rule preselection uses, or a name that "was in
  the span" for one is not for the other.
- **Near collisions refuse loudly rather than merging.** [v1] §14.3 — the engine has no
  evidence that "Mike Chen" is the "Mike" it already knows, and silently deciding either
  way is worse than declining and saying so.
- **Never a second self.** [v1] §14.3 — "one identity core; a second is a category error no
  evidence could justify," refused structurally.
- **Beliefs and current state render verbatim to the encoder; core renders compressed.**
  [v1] §8 G7 — a paraphrase of a belief cannot be honestly confirmed or contradicted.
- **Elements carry stable, immutable handles; prose is the content, the handle is the
  identity.** [v1] §4.2 G1–G2.
- **Archive is a state, not a deletion** — an archived element keeps its id and stays
  resolvable; it simply never surfaces. [v1] §4.2 G3.
- **Aliases are first-class and change only through explicit alias operations**, never as a
  side effect of editing prose. [v1] §4.2 G4.
- **Revision keeps its reason**: the old element is retained as superseded with lineage.
  [v1] §16 G3, earned-mechanism #14 — earned live 2026-08-24, when accommodation's
  forensics needed the retained element.

## 4. Drops / simplifies

- **Entities are born by mention (for now, at night, once a name has come up in at least 3
  memories on 2 different days; `BIRTH_TALLY`) and die by decay; there is no approval gate** (owner
  decision 2026-08-25, settled). v1's autonomous-birth gate is not ported: zero births
  *and* zero refusals across 89 interpreter runs recorded the gate as unexercised, not
  proven — "a gate with no knocks is unmeasured." What survives from it are the *mechanical*
  grounds that are cheap and still true: an allowed kind, the name occurring in the span as
  a whole name, no exact-or-near collision, aliases verified individually and **dropped
  rather than fatal**, never a second self.
- **The accommodation subsystem — invitations, authorized single core edits, repair-only
  unreachability, per-invitation caps, decline half-lives, refusal cooldowns, forensics
  holds — is replaced by strength-weighted revision** (owner decision 2026-08-25, settled).
  The property it protected survives whole and is now cheaper: a belief changes only when a
  challenger's force exceeds its kind's inertia times its current strength (`physics/`
  §5.6), and the old version is retained with lineage. **The guardrail that made
  accommodation work — no model may edit a belief directly — is preserved by construction:
  no model-facing operation edits a belief at all; models write memories, and revision is
  arithmetic.**
- **`protected.add`'s second-signature queue is dropped; protection itself is kept.**
  **Decided, for now** (owner, 2026-10-20; settled by module-map Rulings 3 of 2026-08-25). The evidence: zero `protected.queued` events ever,
  and the 2026-08-24 identity review replaced the corrective with **legibility** — every
  standing protected element enumerable on demand, a list rather than a cadence — which is
  the half that shipped and works. The risk if this is wrong is scar §2.19's exactly:
  permanent, unfalsifiable ink with the lowest write bar. Counter-argument for the owner:
  protection is now proposed only by the experiencer at session end, which is the highest-
  context author the system has, not a sweep model reading a transcript.
- **Belief confidence as a separate stored number is dropped in favour of strength.**
  Open, for wave 2. v1 held both, and the ledger's evidence weight
  multiplied by `(1 − confidence)`; `physics/` §5.6 gets the same "weakly-held beliefs fall
  easier" behaviour out of `strength(old)` alone. Simpler, one number, and it cannot go
  inert unnoticed.
- **Threads as a schema section are dropped** — an open loop is an ordinary memory with an
  `unresolved` flag (v1's own recorded v2 direction, §6.3). Settled by the harvest, not by
  this contract.

## 5. Contract

**Inputs** — accepted proposals with their kinds, scopes, names, and aliases; revision
verdicts from `physics/`; the lived day; cue queries from `recall/` and `encode/`.
**Outputs** — schema slices for encode-time preselection; entity and belief rows; lineage;
name/alias resolution; birth and death telemetry.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] No model-facing operation edits a belief.** There is no such verb. Revision is
   `physics/` §5.6 applied to a declared `updates:`; a belief's text changes only as the
   result of that arithmetic, and the prior text is retained.
   **1b. [M] A resolved `updates:` does what its TARGET allows, and the dispatch is the
   engine's** (owner ruling 2026-09-04; wired at `src/core/revision.ts`, SEAMS item O).
   A **belief** and an **identity element** accumulate PRESSURE and are superseded only
   past the bar. A **current-state** row — a "now" fact — is REPLACED immediately with
   lineage (`replaceCurrentState`), because world-state flips on one clear correction
   (§4.3) and a stale status has no reason to climb a bar. An **entity** row is LINKED and
   nothing else (`meta.updates` already records the relation). An **ordinary memory** is
   SETTLED when an author declared it (2026-09-29, `src/core/reconsolidation.ts`, renamed from
   `contradictions.ts` 2026-10-11): `how` is
   `changed` (the default — one strength cut, labelled earlier), `corrected` (archived:
   out of recall, readable by its id) or `open` (both kept); a SWEPT declaration carries no
   `how` and stays a link. **Before any of it, an authored `changed` or `corrected` declared
   by id is read against the memory it names** (2026-10-09, the update guard,
   `Counterpart#guardUpdate` → `reconsolidation.ts#updateRelatedness`): by meaning through the
   embedder (cosine under `UPDATE_COSINE`, 0.30 CAL, looks unrelated), by shared content words
   when there is no embedder. A pair that looks unrelated is HELD — the new memory lands with
   no `updates`, so nothing is linked, carried, closed, settled or pressed; the writer is
   shown the old memory's title and text and asked to settle it itself (`note` settle) if it
   meant to; a `contradiction.held` row records it; no pair is written. A CLOSE OR A REDATE
   goes straight through: the memory named is an open thread, or the write sends a reminder
   field (`eventDate`, a date or null, or `remind`) and it holds a date, or the write sends a
   `status` and it has a different one. `open`, a content match the engine made itself and a
   swept declaration are not read. A batch writer (a write-up, the nightly catch-up) has
   nobody to read the reply, so its hold stays a hold. A **protected** element refuses every one of those paths. Authored
   declarations count for more than swept ones through the PHYSICS alone — a fallback
   challenger's claim was already cut at the minting seam — and no second weighting
   exists here. A CONFIRMATION (the engine matched a restatement rather than an author
   addressing an id) enters none of it. **Since 2026-10-11 (Group 2b) every "A over B" on a
   memory row goes through one door** (`reconsolidation.ts#supersede`): a pair, a trail row
   and an undo, the effect from `how` alone. An identity element's crossing writes its pair
   there (source `pressure`): the minted successor holds over the old one `changed`, and the
   old one leaves the core, fades, stays live and is labelled earlier (decided by random-06,
   2026-10-11, lightly held; it used to be archived with a forwarding address); an authored
   `changed` or `corrected` at one credits at least `F_DAY_CAP_SLOW` a day (still three lived
   days for a slow kind); and a core memory holding a state (a status not `done`, or a date)
   that a `done` memory updates leaves the core at once, `changed` under it (source
   `fulfilled`). The belief and current-state arms are left as they were, not routed: a
   belief revises under its own pressure here (`supersedeBelief`). They had no live
   producer when this was written; since wave 2 (lane C, 0.3.31) the night's reflection
   and a session form beliefs (`addBelief`), and a current state still has none. Found as a gap on 2026-09-04: the pressure
   accumulator had no live caller, and the running store held zero pressure, zero
   `superseded_by` and zero `revision.pressure` events for its whole life.
2. **[M] Birth requires the name to occur in the source as a whole name**, by the same
   whole-word function preselection uses — a schema whose name the source never said is a
   hallucinated entity.
3. **[M] At most one birth per chunk, counted by the engine.** A span that appears to
   introduce five new entities is far more likely to be one confused chunk than five
   discoveries. **Since 2026-10-11 (Group 3 part D) the one live birth door is the night's
   name tally** (`Schemas#birthsFromNames` over `names.ts#tallyNames`, run by sleep's
   `births` phase): a name at least `BIRTH_TALLY.MIN_MEMORIES` (3) live memories on
   `MIN_DAYS` (2) lived days say, mid-sentence and capitalized, and not written in another
   case in prose by `LOWER_CASE_SHARE` of them, is offered to `mention()` with those
   memories as its source; every gate here still judges it. Each name is its own chunk, so
   the cap that binds is sleep's nightly budget (`BUDGETS.births`, 10), most-named first,
   the rest counted and offered again. A name a live or faded card holds is not offered. The
   title door (`counterpart.ts#mentionFromProposal`, an authored title passed as the name)
   is gone: it refused every authored write `name-not-in-source` (review 12 §3a). A write
   still credits the cards it names and brings a faded one back (G14, NOTES §15).
   **Since 2026-10-21 (wave 2 lane B) a second door, for TOPICS** (`Schemas#birthsFromTags`,
   in the same `births` phase): a tag (through its merges) on memories weighing
   `TOPIC_MIN_MEMORIES` (5; each used awake counts `TOPIC_USED_WEIGHT` more, each felt
   `TOPIC_FELT_WEIGHT` more) on `TOPIC_MIN_DAYS` (3) lived days in `TOPIC_MIN_SESSIONS` (2)
   sessions becomes a topic card, `TOPIC_BIRTHS_PER_NIGHT` (5) a night — not a stop word
   (`tags.ts#isStopTag`: a date word, a word with a digit), not a word a card already holds
   as a name, not a topic already born. A topic card has NO name and no aliases (the
   `ensureSelfSubject` shape), so the alias index, recall's aliases and a write's credit are
   untouched; its tag and merged words are `meta.topic` / `meta.topicAliases`, its
   `subject_kind` is `topic`, and its memories are the tagged ones (no `memory_subjects`
   rows). Behind `TAGS_NIGHT`. Lightly held, check 2026-10-26.
   **Since 2026-10-22, one name has one live card again** (`Schemas#mergeTwinCards`, first
   in the `births` phase, once per store, behind `TWINS_MERGE`): the pairs the race #578
   closed are merged by archiving the second-born under `TWIN_REASON` (`card-twin`, never the
   dedup pass's `merged`) and recording the card it stands under (`schemas.twin.<id>`), so
   nothing moves and the owner's undo is un-archiving (`store/owner-op-seam.ts#unarchiveTwin`,
   `counterparts dream --undo-twins`). A group of three or more, or a pair whose links,
   aliases, beliefs, folders, protection or kinds differ, is left alone and counted.
   A card's kind of SUBJECT is the night's to judge, not its birth kind's (`store/`
   CONTRACT; `tags.ts#repairBirthKindSubjects`).
4. **[M] Exact and near name collisions refuse, loudly**, and the refusal is a distinct
   record from "not proposed" (scar §2.4 — v1's zero births were ambiguous precisely
   because the two were indistinguishable). **The proposal is logged, not only the
   outcome.**
5. **[M] Never a second self**, refused independently of the birth path's other checks.
6. **[M] A newborn schema asserts nothing** — names and aliases only.
7. **[M] Death is decay, not deletion by decision.** An entity with no live memories
   attached and no reinforcement for `D_floor` lived days fades out of preselection and is
   archived, keeping its id resolvable. No model can kill an entity.
   **7b. [M] The OWNER can, and this index survives it.** `counterparts remove` accepts a
   schema target, and after the chase the row is still listed with its pointer blanked. The
   REMOVED ROW is SKIPPED — by `load`, by `entity` and by `element` — so it is in no slice,
   no alias lookup, no preselection and no schema context, and nothing built on this index
   can render it. (A long-lived process that has not reopened can still *match* a
   dark-marked entity through its cached alias index; it cannot surface it — `recall/`
   filters denied ids before candidates are formed. NOTES §13.)
   Until 2026-09-18 it was not skipped: reading it threw out of `Schemas.open`, out of
   `Counterpart.open`, and the hook caught that and exited 0, so the owner's next session
   simply had no memory and said nothing about it.
   **Removal does NOT cascade, and the consequence is visible.** Elements hanging off a
   removed entity keep their rows: they are orphaned, not destroyed. They vanish from every
   path that STARTS AT AN ENTITY — the four above — and remain ordinary rows to every path
   that does not. The proved example is the dashboard's identity view, whose band and
   protected lists enumerate `store.list({ band, archived })` and read the prose directly
   (`adapters/dashboard/identity.ts` over `self/identity.ts#enumerate`): a promoted belief
   about a removed person still prints there, in full, while `browse --id <entity>` says
   `[removed by the owner]`. `Schemas.element(id)` and `Store.read(id)` answer for them too,
   by design — they were not removed. **Whether removal should cascade to what hangs off its
   target is the owner's open question**, and it is `cli/removal.ts`'s to implement, not this
   module's: the difference between "forget this person" and "forget everything I ever
   concluded about her".
8. **[M] Beliefs and current state render verbatim in every schema slice**; elided items
   are announced as a count, never silently omitted.
9. **[M] Every element has a stable handle, and compression may shorten a statement but
   must preserve the handle a later revision names** — shorter, never unfalsifiable
   (§1 G6, §7 G3).
10. **[M] Referential integrity on supersede is the store's job, not this module's** —
    inherited at one retarget site every write path crosses (scar §2.2).
11. **[M] Protected elements refuse every revision path**, and their permanence is
    disclosed: permanent-includes-permanently-wrong is doctrine, and the corrective is that
    the owner can list every unfalsifiable anchor at will (§14.1 G9, earned 2026-08-24).
12. **[A] What belongs in "core" versus "current state" is a preference** stated to the
    author. That current state is timestamped and that status does not accumulate on the
    self schema is mechanized — see `self/` guarantee 4.
13. **[M] Every kind reports created-versus-exited counts.** A kind whose exit count is
    zero after the bake-in window is a **defect to investigate, not a base rate to accept**
    (scar §2.17).
14. **[M] A memory's subjects are the live cards its words name** (v12, 2026-10-03; working
    default). `subjectsIn` reads them by `creditNamedIn`'s rules — the one whole-word rule
    with a trailing possessive read as the name ("Han's" names Han; `words.ts#nameRegex`,
    2026-10-03), `NAME_MIN_CHARS`, exactly one live holder — and the store links them at every memory
    write through the finder `Counterpart` installs. A card's birth (a revival too) links
    the memories already naming it. The backfill's reading goes through
    `AliasIndex#scanner`, which gives exactly `matchesIn`'s hits (a test holds them equal).
    `addAliases` does not look back.
15. **[M] A belief is born weak and earned by support** (wave 2 lane C, 2026-10-21; working
    defaults, physics §5.13). `addBelief` takes a birth route (`store#BIRTH_ROUTES`), writes
    it on the row, and caps the dimensions and the claim at `BELIEF_BIRTH_CEILING` at the
    seam, with no feeling, whoever writes it; a `migrated` belief keeps the strength, the
    inertia and the accommodation path it lived (for now) — `migrated` is read off the birth
    route alone, a channel that disagrees is refused, and a route is never changed after
    birth. Beliefs
    about me or us carry `about` me/us. `fileSupport` is the one door support comes through:
    a lived memory (a memory or a chapter, not a dream's words or a reflection's entry) or,
    by `link`, another belief at `SUPPORT_LINK_FLOOR`; never the belief itself, and no word
    but a support route (a rating, a showing or a recall is none), no stance but `support`
    or `contrary`; `testimony` and `choice`
    read off the memory's `said_by`, never claimed; `use` not on a belief about me or us.
    Each memory counts once per belief (the table's key: filing again is `already-counted`).
    A contrary filing presses through `challengeBelief` at its weight, against a bar that
    grows with the belief's support (physics §5.13); past it the belief is CONTESTED — its
    text stands (no memory's body ever becomes a belief's), it is cut once and marked
    `meta.contested` — never rewritten. The owner's correction or an awake session's settle
    reaches a belief at once through `reconsolidation.ts#settle`, as the one settled over,
    passing no bar; a dream's never, a reflection's only once the belief is contested.
    **Other births and the correction** (lane C3): a session may write one in the moment
    (`Counterpart#sessionBelief`, `remember`'s `belief`) — from the owner's words, my own
    choice or a moment felt strongly at the time (its recorded feelings) only, on the self
    subject, route `session`, at most `BELIEF_SESSION_BIRTHS_PER_DAY` a lived day, kept to
    `MAX_BELIEF_CHARS`; a repeat is refused `near-duplicate` with that belief's id, and
    (#583 → B1, 2026-10-24; was: files nothing) its memory is filed as support for that
    belief at most once per belief per session — the memory's `origin_session`, any support
    row from it counting, the birth's included; unknown or unbound (`mcp`), once a lived day
    — said beside the refusal as `support`, the event marked `via: awake-duplicate`, each repeat
    recorded as a `belief.support.awake` row; off
    with `AWAKE_SUPPORT_ON_DUPLICATE` (files nothing, as before). The owner's words that a belief is wrong
    (`Counterpart#correctBelief`, lane D's button — a bare "That's wrong." is enough; or an
    awake write `said_by` owner that `updates` it) settle it `corrected` at once, the
    owner's settle (`revision.ts`, reading the row, not the index), past the update guard,
    which reads anyone else's update of one. **Across processes**: a belief another process
    wrote is learned on a miss by id, and every unseen one before a subject's beliefs are
    read — its meta only; a card another process named reaches this process's alias index
    at its next open, as before, for now.
    **Where they are seen** (lane E, 2026-10-22): recall's candidates, facts mode
    and the core lanes still leave belief rows out by role (`meta.role: belief`);
    a turn that names a subject (a card through the alias index, a topic by its
    word) shows its strongest beliefs in recall's own beliefs slot
    (`beliefsNamedIn`, recall `BELIEFS_IN_RECALL`), and a project's folder shows
    its project's at the wake (`self.WAKE_PROJECT_LINE`). A rating of the slot is
    a use of the belief (`Store#reinforce`'s `beliefSlot`), once a lived day,
    never support, nothing for a belief about me or us (`aboutMeBelief`). The
    core stays lane F's, behind its own switch.

## 6. Scars honored

**§2.2** (supersede is a graph operation) · **§2.4** (log the proposal, not only the
outcome; three distinct records per gate) · **§2.5** (the model proposes semantics; the
engine resolves references — names and aliases are content-matched, never
model-addressed) · **§2.8** (the near-collision similarity bar is measured, not intuited) ·
**§2.9** (the encoder must see the beliefs its output can affect) · **§2.16** (every
declarable field carries an admission test and a named negative example) · **§2.17** (write
paths ship, curation paths starve — every entity kind names its exit) · **§2.19**
(permanence and write bar scale together — the live question behind the protected-queue
drop, **decided, for now** (owner, 2026-10-20; settled by module-map Rulings 3 of 2026-08-25)).

## 7. Open questions

1. **What kills an entity, precisely?** "Death by decay" is settled; the predicate is not.
   Zero live attached memories is the obvious rule, but a person with one faded memory is
   not the same as a project that ended.
2. **Does a belief need provenance beyond its lineage chain?** v1 carried provenance and
   confidence as separate fields; dropping confidence (above) leaves provenance doing more
   work.
3. **Where does *status* live now that it is off the self schema** — a current-state
   section on the project entity, or ordinary memories with an event date that expire on
   their own? The second is more brain-faithful and has no cleanup pass; the first is what
   a wake briefing can render.
