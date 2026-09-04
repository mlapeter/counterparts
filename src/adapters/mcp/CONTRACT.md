# `adapters/mcp/` — CONTRACT

## 1. Purpose

The deliberate tools — note, recall, status — exposed over MCP to any host that speaks it.

## 2. Brain analog

Effortful, voluntary retrieval and rehearsal, as distinct from the ambient reminding that
`recall/` provides. **Named deviation** (constitution line 8): deliberate remembering is
**the exception, not the interface**. A tool the model must remember to call cannot be
load-bearing, and this adapter is designed on the assumption that it will be used rarely.

## 3. Keeps

- **An explicit "remember this" channel exists, and is never the interface.** [v1]
  decisions-triage 07-23, constitution line 8.
- **One tool, not two.** [v1] test-triage `mcp.test.ts` — a real design decision, kept.
- **Deliberate recall is a deeper effort with different thresholds**, adds a **labeled**
  lower-confidence tier, and returns footnote-tier items as bodies. [v1] behavioral-spec
  §9.1 G2.
- **One argument, two paths**: a handle expands *that* memory exactly; a question runs a
  query. Expansion must never degrade into fuzzy search. [v1] §9.1 G1.
- **Ranking is not recording** — deliberate recall trains nothing and deposits nothing.
  [v1] §9.1 G4.
- **A candidate count must not become an undercount** — a top-K tuned for surfacing is
  wrong for an aggregation question. [v1] §9.1 G3.
- **Confidentiality is enforced at the boundary of the ask**; withholding is *stated* for a
  direct lookup and silent in a list. [v1] §9.1 G5.
- **A census surface exists and includes what was removed** — counts and dates, never
  bodies or hashes. [v1] §9.1 G6, scar §2.20.
- **Observer stands down over the wire.** [v1] test-triage `mcp.test.ts`, scar E7.

## 4. Drops / simplifies

- **The v1 self-store tool is superseded by experiencer authorship** — self-writing became
  the primary path (owner decision, settled). This adapter therefore exposes **no
  self-authorship tool**: identity writing happens at the boundary, by construction, not
  through a tool description. The plain note survives as the named exception it always was.
- **`protected.add` as a callable operation is dropped** with the second-signature queue.
  **PROPOSED** — owner call at check-in; see `schemas/CONTRACT.md` §4 for the evidence and
  counter-argument.
- **No tool writes an entity, a belief, or a revision.** Entities are born by mention and
  die by decay; revision is `updates:` plus arithmetic (owner decisions, settled). The
  vocabulary this adapter exposes is deliberately three verbs wide.

## 5. Contract

**Inputs** — MCP tool calls: `note(text[, salience][, relevance, emotional, predictive])`,
`recall(handle | question)`, `status()`, `session_end(memories[])` whose entries take the
same optional dimensions; the session's observer role.
**Outputs** — a stored memory (note), ranked memories with a confidence label (recall), a
census (status); telemetry by reference.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] `note` traverses the same write seam as every other entrance** — the gate battery
   included (scar §2.7).
2. **[M] Every privilege the tool description states is mechanized.** v1's note claimed a
   high-salience floor **in its prompt only**, with no engine backstop — the single place a
   stated guarantee had no enforcement (§4.1 known gap). Here the claimed salience is a
   floor clamped in `physics/` §5.2, or the description does not claim it.
   The same guarantee now covers **silence**: an entry that claims no salience gets the
   authored channel's default floor at the mint seam rather than a zero (measured
   2026-09-04: 48 authored rows, all dimensions zero, most unclaimed — the deliberate
   channel's own deposits were the weakest things in the store). The ask never told the
   model to set salience, so silence is the common case, and a mechanism that only works
   when the model remembers to speak is the same class of gap this guarantee exists for.
   An author's own **dimensions** (relevance, emotional, predictive) may be given per note
   and per session-end entry; they reach the row exactly as written, an out-of-range one is
   refused by name rather than clamped or dropped, and `novelty` remains unclaimable —
   prediction error is measured, never asserted.
3. **[M] Every tool carries an admission test and at least one named negative example** in
   its description, plus an engine-side check wherever the rule is safety-relevant
   (scar §2.16 — v1's `thread.open` shipped with no criteria and produced 33 opens and zero
   closes in 13 days).
4. **[M] `recall` and `status` write nothing and train nothing**, asserted by a test that
   runs both against a populated store and checks canonical state is byte-identical.
5. **[M] Under observer, every tool stands down over the wire and says so** (scars E7,
   §2.4).
6. **[M] Confidential material is returned only in the owner's own session.**
7. **[M] The census names what was removed** — counts, kinds, dates; never bodies, never
   hashes.
8. **[A] Wire-protocol framing is host trivia** and may change without touching a core
   contract.
9. **[M] The core imports nothing from this directory.**

## 6. Scars honored

**E7** (stand-down over the wire) · **§2.4** (a stood-down tool is distinguishable from a
broken one) · **§2.6** (mechanize invariants; instruct only preferences — guarantee 2 is
this scar's direct descendant) · **§2.7** (the note traverses the one write chokepoint) ·
**§2.16** (every model-facing operation carries an admission test and a negative example) ·
**§2.20** (the census is content-by-reference).

## 7. Open questions

1. **Does `note` still need to exist** once the experiencer writes at every session end?
   Its job is the in-the-moment mark, which the jot channel also serves. Two doors to the
   same room is how v1 ended up with a self-store nobody called.
2. **What does `status` show?** v1's answer grew into a dashboard. The useful minimum is
   probably the symmetry counters (created versus exited per kind, up-moves versus
   down-moves) — the numbers that made v1's pathologies visible — not a store census.
3. **Should `recall` expose the confidence label as a tier name or a number?** v1 labeled
   the fallback tier and left the rest implicit.
4. **NAMED GAP: the stated-emotion gate cannot supply the `emotional` dimension.**
   The obvious brain-faithful move — affect at encoding stamping a memory vivid — is not
   available here, for two separate reasons, and neither was papered over. (a)
   `encode/emotion.ts#gateEmotion` returns a `DurableFeeling` of `{type, subject}`: a
   feeling that SURVIVED, with no magnitude anywhere on it, so there is no number to feed
   `emotional` without inventing one — and inventing one is retro-typing emotion, which
   §3 forbids. (b) These tool schemas expose no `feeling` field at all, so on the MCP
   door the gate has nothing to fire on in the first place. Closing this means deciding
   what a feeling's magnitude IS (a fired-cue count? a stated intensity the author
   supplies alongside the type?) — a design question, not a wiring one. Until then the
   author's own `emotional` score is the only route, which is why it is now exposed.
