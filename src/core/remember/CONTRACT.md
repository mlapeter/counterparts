# `remember/` — CONTRACT

## 1. Purpose

The authorship contract: the experiencer writes its own memories at session end, jots in
the moment where the host allows, and a transcript sweep exists only as the crash fallback.

## 2. Brain analog

Hippocampal encoding — binding a lived experience into a durable trace while the context
is still present. **Named deviation** (constitution line 12): in humans encoding is
involuntary; here it is authored. That is the whole thesis of this module, and its risk is
named honestly — an author can decline to write, where a hippocampus cannot. The mitigation
is that the ask is ambient (constitution line 8) and its coverage is measured, not assumed.

## 3. Keeps

- **The lived mind writes its own memory.** [v0] v0 had the authorship shape right: the
  model that lived the conversation wrote the dump, and a one-line strength formula did the
  filing. [v1] behavioral-spec §4.1: an in-session proposal is "honored, not re-judged."
- **Encoding sits as close to the lived experience as the host allows.** [v1]
  earned-mechanism (decisions-triage 08-05), now constitution line 2 nearly verbatim.
- **Self-assessed signals outrank inferred ones.** [v1] §4.1 G1 — stated inside the
  narration block, not in the system prompt, so a stretch with no narration is not told to
  narrow toward nothing.
- **A self-authored proposal is minted by the engine, not paraphrased by a sweep.** [v1]
  §4.1 G2 — routing it through an interpreter returns the author's own words as someone
  else's paraphrase and its self-assessment as someone else's guess.
- **Self-assessed salience is a floor, mechanized.** [v1] §4.1 G3 (the clamp now lives in
  `physics/` §5.2 and governs every memory).
- **Coverage is claimed by hash, by the engine, and coverage means down-weight, not
  deletion.** [v1] §4.1 G4 — successive writes *partition* a session rather than each
  claiming the backlog. What the fallback loses is permission to write the same memory
  twice, not sight of the material.
- **A rejected proposal claims no coverage.** [v1] §4.1 G5.
- **Coverage marks are prompt-side only** — never in the text the gates check, *so no gate
  can be loosened by a mark the engine wrote.* [v1] §4.1 G6.
- **A malformed proposal degrades to an ordinary span**, read by the fallback. [v1] §4.1 G8.
- **Deliberate deposits are idempotent by CONTENT, not by span text.** [v1] §4.1 G9.
- **Every session-ending path is a boundary** — normal stop, session end, and
  pre-compaction. Compaction destroying the transcript must not destroy the day. [v1] §2 G5
  — the compaction-amnesia backstop, and the reason a fallback exists at all.
- **A span is never lost between read and encode**: the read cursor advances only after a
  successful append; content-hash dedup makes the retry idempotent. **Bounded duplication
  is an acceptable failure; loss is not.** [v1] §2 G2.
- **Two dedup layers, both needed** — a per-session read cursor for a growing transcript,
  a content hash for exact repeats. Hash dedup alone cannot catch cursor regression,
  because a superset slice hashes differently. [v1] §2 G3–G4.
- **Claim/consume is atomic-rename choreography, not a mutex**; the claim is truncated only
  after results are applied *and* persisted; a failed restore forbids consuming the claim.
  [v1] §2 G6–G7, [engram E6].
- **Every scope holding experience gets swept**, not only the one whose boundary fired.
  [v1] §2 G9.
- **Conversational text only** — tool output, file contents, images, and injected context
  never enter capture, and this is a **declared blind spot**. [v1] §2 G10.
- **Foreign material never enters** — text ANOTHER memory system's hooks put into the
  host's context is `foreign`, and `enters()` refuses it outright (unlike `injected`,
  which is kept and merely unpaced). Added for the parallel run beside v1: without it,
  each system encodes the other's briefing as a memory of having thought it.
- **Boundaries are appenders, not thinkers.** Capture completes in microseconds; the host
  never waits on a model call at a boundary. [v1] §2 G1, [engram E4].

## 4. Drops / simplifies

- **The transcript-reading interpreter is demoted from primary path to crash fallback**
  (owner decision 2026-08-25, settled). The experiencer writes at session end with lived
  context (rung 2 of the authorship ladder); in-the-moment jots run where the host allows
  them; transcript interpretation runs **only** when the experiencer never got the pen —
  a crash, a compaction that ate the session, a host with no end-of-session hook.
- **The v1 self-store tool is superseded by experiencer authorship** — self-writing became
  the primary path, not silently dropped. Its doctrine is kept whole (lived salience is the
  only legitimate identity input); only its delivery shape is gone. A tool the model must
  remember to call is not ambient (constitution line 8), and v1's `selfstore.append`
  recorded zero fires in the month after ship. **The starved-front-door lesson is the
  design requirement here**: if the doctrine names the only legitimate inputs, those inputs
  must be reachable **by construction** — which the end-of-session ask is and a tool
  description is not.
- **The interpreter's chunked-sweep machinery shrinks with its role**, but does not
  disappear: the fallback still chunks with per-chunk failure isolation, still guards
  `stop_reason`, still streams, still restores on throw (scars E1, E2, E3, E6). A fallback
  that runs after a crash is exactly the path that must not lose the day.
- **Threads/loops are not a special structure.** An open loop is an ordinary memory with an
  `unresolved` flag, carrying salience, decay, and dedup like everything else; it closes
  when a later memory declares `updates:` on it. This is v1's own recorded v2 direction
  (§6.3): "as a special structure outside the memory model it became the one data type in a
  forgetting-is-a-feature system that never forgets — and its exception tax was a whole bug
  family."
- **Per-session gate state is persisted** rather than reconstructed per turn — see
  `recall/`, where the decision belongs. Named here because span capture and gate state
  share the session lifetime.

## 5. Contract

**Inputs** — the session's turns since the last boundary; session identity, scope, the
lived day and the moment; the observer predicate; jots deposited in-session; on the
fallback path, claimed spans and their schema slices.
**Outputs** — proposals handed to `encode/`; a claim record; coverage claims by hash; the
assistant's own turns kept separately (the substrate for "was a surfaced memory actually
used?"); telemetry by reference.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] The host never waits on a model call at a boundary.** Capture is an append;
   authorship and any fallback run detached, under a watchdog whose timeout is validated
   against the lock-staleness window (scars E4, E5).
2. **[M] Capture never throws into the host.** Every failure is logged and swallowed.
3. **[M] Advance-after-success**, two-layer dedup, per-(scope, session) cursors, rename
   choreography, restore-before-consume — all four, all structural.
4. **[M] Restore-on-throw**: an outage means the arc is *retried*, not lost. The consumer
   commits its output or restores its input; a test kills it mid-arc and asserts the input
   is still claimable (scar E6). "Returned nothing" and "failed" are distinguishable in the
   log (scar §2.4). **Retry is BOUNDED**: the sweep records each span's failures, and at
   `MAX_SPAN_FAILURES` the span is *quarantined* — written out in full, counted, and never
   swept again — so a permanently-failing span cannot bill one model call per boundary
   forever. Retried, then set aside; never silently dropped (NOTES §13).
5. **[M] The engine claims coverage, never the author** — the author cannot see the buffer.
6. **[M] A rejected proposal claims no coverage.**
7. **[M] Coverage marks never enter gated text.**
8. **[M] Observer sessions capture nothing, ask for nothing, and write nothing** — checked
   at the store seam, not only at the entry point (scar E7).
9. **[M] Dedup survives a re-read of overlapping content.** The transcript-compaction
   cursor case — a superset slice hashes differently, so hash dedup misses it — is a v1
   hypothesis that was never verified and carries into v2 **as a test to write**, not as
   an assumption (scar list, "considered and excluded").
10. **[M] No model-supplied identifier is trusted as an address without a fallback.** The
    author declares `updates: <id>`; the engine validates that the id resolves, and on a
    miss falls back to **content matching** against candidate memories — score and margin
    both required, ambiguity refuses, the author's hint is a tiebreak inside the margin and
    can never defeat a refusal, and score/margin/method are logged as provenance
    (scar §2.5). A miss costs nothing durable: the memory still lands.
11. **[A] The ask's wording is load-bearing and is part of the spec** — first person, the
    author's own voice, what happened and what mattered, how it felt, what was learned
    about the person and about oneself. It sanctions honesty about a routine stretch and
    closes *"write for the next you, not as a report."* Wording is a preference; that an
    ask exists at every session-ending path is mechanized.
12. **[M] Coverage of the session is measured, not assumed.** The stretch after the last
    session-ending event that nobody can ask about is **bounded and logged**, so the miss
    is measurable before anyone debates a reconstruction fallback (§13 known gap: *that is
    the right shape for an unfixable gap — bound it, measure it, don't pretend*).

## 6. Scars honored

**E1** (chunked fallback with per-chunk isolation) · **E2** (one client chokepoint; a
truncated response is a failure, not data) · **E3** (long generations stream) · **E4**
(detached execution + watchdogs; a worker that *cannot start* escalates rather than
re-logging the same line forever) · **E6** (buffer-restore-on-throw) · **E7** (observer
deposits nothing) · **§2.4** (returned-nothing versus failed are distinct records) ·
**§2.5** (the author proposes semantics; the engine resolves references) · **§2.16** (every
declarable field carries an admission test and a named negative example — v1's
`thread.open` shipped with no criteria and produced 33 opens and 0 closes in 13 days) ·
**§2.17** (a write path is not done until its read path has fired on real input).

## 7. Open questions

1. **The `remember`/`encode` boundary** — the module map's third standing check-in
   question. See `encode/CONTRACT.md` open question 1; the two modules must be decided
   together.
2. **What does the fallback actually cost when it runs?** v1 ran the sweep as the primary
   path, so there is no measurement of a sweep that only ever runs post-crash. Its blind
   rate, its yield, and whether it needs the full preselection machinery are all unknown at
   this scale.
3. **Where do jots live between deposit and boundary** — in the buffer with spans, or as
   already-formed proposals in the operational database? The second is simpler; the first
   makes the ordering guarantees uniform.
4. **Does the experiencer see its own `updates:` candidates?** It must, or every revision
   degrades to content matching. But showing a census of ids is precisely what produced
   v1's confabulation incident (scar §2.5: 7 of 8 rejected thread ids existed in the
   schema, in a different section, in the identical `- [el_id]` format).
