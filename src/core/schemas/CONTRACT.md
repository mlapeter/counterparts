# `schemas/` — CONTRACT

## 1. Purpose

Semantic memory: the entities experience organizes itself around — people, places, skills,
projects, systems — and the beliefs held about them, born by mention and revised by
physics.

## 2. Brain analog

Schema formation and semantic memory: repeated episodes abstract into a structure that new
experience is compared against, which is what makes prediction error possible. **Named
deviation** (constitution line 12): beliefs never blend into each other. Generalization is
only ever an explicit, provenance-carrying revision — biology's interference and source
confusion are the bugs, not the architecture (owner ratification 2026-08-08).

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

- **Entities are born by mention and die by decay; there is no approval gate** (owner
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
  **PROPOSED** — owner call at check-in. The evidence: zero `protected.queued` events ever,
  and the 2026-08-24 identity review replaced the corrective with **legibility** — every
  standing protected element enumerable on demand, a list rather than a cadence — which is
  the half that shipped and works. The risk if this is wrong is scar §2.19's exactly:
  permanent, unfalsifiable ink with the lowest write bar. Counter-argument for the owner:
  protection is now proposed only by the experiencer at session end, which is the highest-
  context author the system has, not a sweep model reading a transcript.
- **Belief confidence as a separate stored number is dropped in favour of strength.**
  **PROPOSED** — owner call at check-in. v1 held both, and the ledger's evidence weight
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
2. **[M] Birth requires the name to occur in the source as a whole name**, by the same
   whole-word function preselection uses — a schema whose name the source never said is a
   hallucinated entity.
3. **[M] At most one birth per chunk, counted by the engine.** A span that appears to
   introduce five new entities is far more likely to be one confused chunk than five
   discoveries.
4. **[M] Exact and near name collisions refuse, loudly**, and the refusal is a distinct
   record from "not proposed" (scar §2.4 — v1's zero births were ambiguous precisely
   because the two were indistinguishable). **The proposal is logged, not only the
   outcome.**
5. **[M] Never a second self**, refused independently of the birth path's other checks.
6. **[M] A newborn schema asserts nothing** — names and aliases only.
7. **[M] Death is decay, not deletion by decision.** An entity with no live memories
   attached and no reinforcement for `D_floor` lived days fades out of preselection and is
   archived, keeping its id resolvable. No model can kill an entity.
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

## 6. Scars honored

**§2.2** (supersede is a graph operation) · **§2.4** (log the proposal, not only the
outcome; three distinct records per gate) · **§2.5** (the model proposes semantics; the
engine resolves references — names and aliases are content-matched, never
model-addressed) · **§2.8** (the near-collision similarity bar is measured, not intuited) ·
**§2.9** (the encoder must see the beliefs its output can affect) · **§2.16** (every
declarable field carries an admission test and a named negative example) · **§2.17** (write
paths ship, curation paths starve — every entity kind names its exit) · **§2.19**
(permanence and write bar scale together — the live question behind the protected-queue
PROPOSED drop).

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
