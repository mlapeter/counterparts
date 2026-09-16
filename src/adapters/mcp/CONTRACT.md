# `adapters/mcp/` — CONTRACT

## 1. Purpose

The deliberate tools — note, recall, status — plus the two return channels the Stop ask
needs (`session_end` for memories, `chapter` for the episode), exposed over MCP to any host
that speaks it.

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
- **Exposure is not recording; retrieval is.** A SEARCH strengthens nothing — `build()` is
  pure, and nothing on that path calls `resolveUse` or `coactivate`, so a memory that was
  merely ranked and listed is no stronger for it. EXPANDING one in full, by id or by title
  handle, is USING it, and the owner's credit ruling of 2026-09-14 credits it at the
  session boundary, once per lived day, in the other adapter. So the handle path leaves one
  HOST-STATE line (`adapters/expansions.ts`: a salted hash of the handle, the id it reached
  or `null`, a timestamp, the project) so that boundary can tell which memory a TITLE
  reached. No tool here writes a memory and none touches physics.
  **Named deviation** (2026-09-15/16, G50): the rule this replaces was "[v1] §9.1 G4 —
  ranking is not recording, deliberate recall trains nothing", an ABSOLUTE written against
  the wake/footnote rich-get-richer problem. That is an EXPOSURE problem, and the absolute
  over-reached past it: the brain's rule — the testing effect, spacing — is that RETRIEVAL
  strengthens, and a memory read in full was retrieved. Corrected by owner ruling
  2026-09-16: "Exposure never strengthens. Retrieval always does."
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
  vocabulary this adapter exposes is deliberately three verbs wide, plus the return
  channels — a return channel is not a fourth verb, it is the other end of an ask the
  system already makes.
- **`chapter` is NOT the self-store tool coming back** (added 2026-09-04). The dropped v1
  tool wrote identity prose directly. This one appends to the session's own journal, and
  what it writes becomes memory only through `ingestEpisode`'s ordinary gated path at the
  boundary — a self-kind memory like any other. It exists because the ask has said "add
  chapter N to this session's episode" since the ritual shipped while nothing on this host
  could accept one: zero episode files, eleven chapters written as `note`s titled
  "chapter N". *If a doctrine names the only legitimate inputs, those inputs must be
  reachable by construction* — the sentence that justified the ask now justifies its door.

## 5. Contract

**Inputs** — MCP tool calls:
`note(text[, salience, relevance, emotional, predictive, kind, title, updates])`,
`recall(handle | question)`, `status()`, `session_end(session, memories[])` whose entries
take the same optional dimensions, `chapter(session, text[, title])`; the session's observer
role; the launch's session, scope and data dir when the host can supply them.
**Outputs** — a stored memory (note), ranked memories with a confidence label (recall), a
census (status), an appended chapter with the episode's id and the chapter number the store
actually wrote (chapter); telemetry by reference.

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
10. **[M] A session is bound ONCE, and a lazy bind is corroborated by host state the
    model cannot write.** A server launched with `--session` is bound to it and consults
    nothing else — that path is unchanged and preferred. A server launched without one
    binds to the FIRST `session` argument that (a) names an id `adapters/sessions.ts`'s
    registry holds, (b) is live there — not ended, last boundary inside
    `SESSION_TTL_MS` — and (c) carries the same scope as this server. The bind lasts the
    process's lifetime; a second, different id is refused. A claim with no id, an
    unknown id, a dead id or a foreign scope is refused with WHICH of the four it was,
    because a model that cannot tell "unknown id" from "wrong project" cannot act on
    either.
11. **[M] The scope defaults to the working directory, never silently to the store.**
    `process.cwd()` is the project on this host (measured with `lsof`, 2026-09-04); the
    store's dir survives only as the answer when there is no working directory at all,
    and which default won is stated in a startup event (`mcp.scope`).
12. **[M] `updates` is a FIELD on `note` and on a `session_end` entry**, resolved through
    the same `remember/updates.ts` path every deposit uses, with the RESOLVED id written
    to `doc.meta["updates"]` by `mint.ts`. An unresolvable declaration lands unlinked; it
    is never a refusal.

13. **[M] `chapter` binds by exactly the same rules as `session_end`**, through the one
    `requireBoundSession` path, and every refusal names `chapter` rather than the tool the
    check was written for. **The chapter number it returns is the STORE's** — one past what
    was written, never one past what was asked — and a second call with no new ask in
    between continues the chapter it is part of rather than opening another, because
    appending in the moment is the doctrine's headline case (`self/` §13 G2). The journal
    is a gated entrance like every other: the gate's text, possibly redacted, is what
    lands.

### The residual risk of the lazy bind, named

**Two live sessions in the same directory are told apart only by the id the ask names.**
Scope narrows a claim to one project; it cannot narrow it to one session, because both
sessions' records carry the same scope and both are live. That is why the id is REQUIRED
rather than inferred: there is no "the obvious live session here" to fall back on, and a
server that guessed would let session B's model write into session A's day — the exact
privilege guarantee 10 exists to withhold. What the mechanism buys is that the id cannot
be *invented*: it must already be in host state the hooks wrote, live, and in this
project. The model can only name a session it was told about, and on this host it is
told about exactly one — its own, in its own Stop ask.

Two smaller residuals, recorded rather than fixed:

- **A session started from a linked checkout.** If SessionStart fires from a linked
  working copy while the MCP server's cwd is the parent project, the two scopes differ
  and the bind is refused. The registry never rewrites a scope after the first write, so
  the failure is stable and legible (`scope-mismatch`) rather than intermittent — but it
  is a real refusal, and the fix (a scope both surfaces agree on) is not this adapter's
  to make alone.
- **The data dir has to agree.** The registry lives under it, and the two sides resolve
  it independently — the hooks from `claude-code.json`, the server from `--dir` /
  `COUNTERPARTS_DATA_DIR` / the default. A host that sets one and not the other gets
  `session-unknown` on every claim, which is at least a refusal that names itself.

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
5. **Is four hours the right TTL?** CAL. Every Stop refreshes the clock and the ask is
   delivered AT a Stop, so the window only ever bounds the gap between an ask and its
   answer: four hours is far past any plausible think-time and comfortably inside a day,
   so last night's session cannot be claimed into today's memory. The number to watch is
   `session-not-live` refusals — more than a rare one means the window is wrong.
6. **Should `note` take a session claim too?** Today it deposits under the bound session
   when there is one and under the literal `"mcp"` when there is not. Letting it BIND
   would give an in-the-moment jot the power to claim a day, which is more privilege
   than the tool needs; leaving it means an unbound server's notes still carry no
   session. Neither is obviously right yet.
