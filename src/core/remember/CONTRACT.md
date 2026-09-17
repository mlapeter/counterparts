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
- **This system's OWN ritual text never enters either** — an ask this system emitted, read
  back off a host that returns hook output into the model's context, is `ritual`, and
  `enters()` refuses it. Foreign's mirror image: the failure there is encoding someone
  else's words as ours, the failure here is encoding our own words as something that
  happened to us. Both refusals are COUNTED in `CaptureResult.excluded`, so a boundary
  that captured nothing because everything was excluded is distinguishable from a boundary
  where nothing happened.
- **Boundaries are appenders, not thinkers.** Capture completes in microseconds; the host
  never waits on a model call at a boundary. [v1] §2 G1, [engram E4].

## 4. Drops / simplifies

- **The transcript-reading interpreter is demoted from primary path to crash fallback**
  (owner decision 2026-08-25, settled). The experiencer writes at session end with lived
  context (rung 2 of the authorship ladder); in-the-moment jots run where the host allows
  them; transcript interpretation runs **only** when the experiencer never got the pen.

  **What "crashed" means, mechanically** (owner ruling 2026-09-04, closing the adapter's
  open question 3; implemented as `SpanBuffer.crashedSessions`). A session is crashed
  when all three hold:

  1. it holds **uncovered spans** — something nobody authored;
  2. it has recorded **no `session-end` boundary**, ever;
  3. it has had **no boundary activity for `CRASH_STALE_MS`** (12 hours, CAL — see
     `tunables.ts` for the measurement that set it and the falsifier still owed). A
     session that recorded *no* boundary at all is therefore not crashed either: nothing
     of it has ended, and its author may still get the pen.

  Nothing else is swept. Not an ordinary Stop — the ask goes out at every Stop and the
  author still has the pen. Not `pre-compaction` on its own: compaction destroying the
  transcript is answered by the **capture** at that boundary, which is unconditional;
  the sweep only follows if that session then never comes back. A host with no
  end-of-session event has every session swept once it goes quiet, which is the intended
  degradation for a host that cannot ask.

  **Why the rule needed teeth.** The demotion was written here on 2026-08-25 and the
  implementation drifted: the worker spawned at every Stop and the sweep took every
  uncovered span it could see. Measured 2026-09-04 on the live store — one evening
  billed 13 chunks and minted 61 memories beside 34 the model had authored itself,
  producing paraphrase twins no dedup threshold can merge. A contract a mechanism does
  not keep is a comment.

  **Three named costs**, since this rule buys its savings with them:

  - **Up to one ask-interval of trailing turns per session is never encoded** unless the
    model deposited. A session that ends normally is never swept, so anything after its
    last authored deposit is forgotten — by design (constitution 3: forget the trials),
    but it is a real loss and it is this rule's price.
  - **Those spans stay in the buffer.** Nothing consumes the spans of a session that
    ended normally, so `buffer.jsonl` grows with every such session. Bounded growth is
    not designed for here; it is named as open question 5 rather than pre-solved
    (constitution 15).
  - **An idle-but-alive session past the window is indistinguishable from a crash** and
    will be swept. If its author later writes, that stretch has twins after all — which
    is the measurement `CRASH_STALE_MS` owes: count sessions swept-then-authored. The
    live store already produced one 4h07m idle-then-resume gap, which is why the window
    is 12 hours and not the hour first proposed.

  And the recovery is **delayed, never lost**: a crashed session's spans wait for the
  first worker run past the window, which needs a boundary in *some* session to spawn
  one.

  **The fallback reads as ITSELF, not as a stranger** (owner ruling 2026-09-17). Ahead of
  the transcript its prompt carries the WAKE — the same composed self a live session is
  given at session start, built once per sweep against a byte cap (`SWEEP_WAKE_BYTES`, or
  the host's ordinary wake budget) — and it is told to write in the first person, in its
  own voice, as the author would have at the time. What makes a model call "me" is the
  memory it wakes with; read cold, the fallback wrote the owner's own day back as
  paraphrase (`docs/finding-12-diagnosis-2026-09-17.md`: 888 fallback memories against 193
  authored). Three limits are mechanized, not intended: the wake is composed read-only and
  moves no rotation or published bundle; confidential and protected rows never enter it,
  because this prompt leaves the machine (constitution 6); and the memories it produces are
  still `source: fallback`, so the authored/fallback ratio stays legible. A store with
  nothing to say, or a host that reported no ceiling, carries no wake and behaves exactly
  as before.
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
fallback path, claimed spans, their schema slices, and the composed wake the interpreter is
woken with.
**Outputs** — proposals handed to `encode/`; a claim record; coverage claims by hash; the
assistant's own turns kept separately (the substrate for "was a surfaced memory actually
used?"); telemetry by reference — including, since 2026-09-05, the gate's own per-gate
records RELAYED unread from the verdict to whoever writes the durable row (replay
INTERFACE-GAPS §2a; this module still never gates and never reads them).

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
   log (scar §2.4). **Retry is BOUNDED**: the sweep records each span's failures by lived day, and on
   the `MAX_SPAN_FAILURES`-th distinct day the span is *quarantined* — written out in full, counted, and never
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
13. **[M] The fallback reads a transcript only for a CRASHED session**, by the
    three-clause definition in §4, and every run records which of the two it was —
    `sweep.gate` in the durable log carries `ran`, `skippedNotCrashed` and the window it
    used, so "no sweep today" is a fact about the day and not a silence that could also
    be a dead worker (constitution 16, scar §2.4). The gate is answered **before** the
    claim, so a scope with nothing crashed costs no rename and no model call.
14. **[M] A span can be destroyed on the owner's say-so, and only on the owner's say-so.**
    The buffer holds lived experience verbatim, so "anything can be removed loudly"
    (constitution 6/7) has to be true of it too — it was not, and a removed note's words
    survived in `jots.jsonl` where a later backup copied them (LAUNCH-STATUS §I2). The
    door is `owner-strike-seam.ts`, reachable only by importing that file: the buffer
    hands it a capability at construction, `WRITE_SITES` carries `strike` so an
    instrument's stand-down covers it, and a caller-universality test pins the two files
    allowed to import it. It rewrites each text-bearing stream WITHOUT the struck lines,
    by the same rename-aside choreography a claim uses, after recording the struck hashes
    in the terminal ledger — so a re-capture, a restore and an orphan merge all refuse to
    re-admit them. **Nothing is ever RAM-only across a destructive step**: survivors sit
    on disk in the aside until a durable append has landed, and a crashed strike's aside
    is folded home unconditionally by the next one, whatever that one was asked to do.
    **A predicate may only ever take a jot** — a conversation span is many turns joined
    and belongs to no single memory. It records counts and never a hash or a word
    (§16 G9). One window is NAMED rather than closed: a worker already holding a claim in
    memory finishes its arc (NOTES §14).

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
   this scale. **Narrowed 2026-09-04**: the gate now makes the question answerable — count
   `sweep.gate` rows with `ran > 0` against the days they cover.
3. **Where do jots live between deposit and boundary** — in the buffer with spans, or as
   already-formed proposals in the operational database? The second is simpler; the first
   makes the ordering guarantees uniform.
4. **Does the experiencer see its own `updates:` candidates?** It must, or every revision
   degrades to content matching. But showing a census of ids is precisely what produced
   v1's confabulation incident (scar §2.5: 7 of 8 rejected thread ids existed in the
   schema, in a different section, in the identical `- [el_id]` format).
5. **What retires the spans of a session that ended normally?** (Opened 2026-09-04 by the
   crash gate.) Nothing does: they are never claimed, so the buffer keeps them. On the
   parallel run's volume that is kilobytes a day and a file the owner can read, which is
   why no pruner is built here (constitution 15) — but the growth is real, unbounded, and
   should be watched. The candidate answers, in order of preference: a coverage-driven
   retirement that consumes covered spans without any model call; an age-based sweep of
   the buffer on the lived-day clock; nothing at all, if the measured growth stays
   trivial.
6. **A session that moved scope is judged per scope.** `crashedSessions` reads one
   scope's `boundaries.jsonl`, so a session that captured under scope A and then ended
   under scope B leaves A holding only `stop` boundaries — and A's spans for it are swept
   once the window passes, even though the author did get the pen elsewhere. PR-1 found
   11 real session ids under more than one scope, so this is not hypothetical; whether it
   ever coincides with a session END in another scope is unmeasured.
7. **Is 12 hours the right window?** `CRASH_STALE_MS` is CAL and shipped enabled. It was
   raised from a guessed 60 minutes after the live store falsified that number — session
   `c781252f` sat idle 4h07m with its author still holding the pen, then resumed and
   authored 20 more notes. The falsifier is unchanged and still owed: sessions swept under
   this rule that later received an authored deposit. The other direction now has a cost
   too — a genuinely crashed session waits up to half a day for its fallback, which is
   only a delay but is a longer one than before.
