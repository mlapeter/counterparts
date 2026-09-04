# `adapters/claude-code/` — CONTRACT

## 1. Purpose

The launch adapter: wake injection at session start, the end-of-session write, and crash
detection — everything host-specific, so the core stays host-agnostic.

## 2. Brain analog

None. This is the body, not the brain: the sensory and motor surface through which a
particular host delivers experience and receives context. **Named deviation** (constitution
line 5, "a layer, not a portal"): every host limit that v1 baked into its memory design —
the 9 KB injection cliff, the socket lifetime, the shell that happened to export a
credential — belongs here, discovered at runtime, never assumed by the core.

## 3. Keeps

- **Hooks return in microseconds; heavy work runs detached under a watchdog.** [engram E4,
  v1] The foreground path never blocks on a model call.
- **Every session-ending path is a boundary** — normal stop, session end, and
  pre-compaction. [v1] behavioral-spec §2 G5 — compaction destroying the transcript must
  not destroy the day. This is the compaction-amnesia backstop.
- **The wake never fails the session.** [v1] §1 G7 — missing bundle, unreadable config, or
  failed telemetry means the bootstrap line or nothing, and a clean exit.
- **The injected block is framed as context, not instruction.** [v1] §1.
- **Delivery telemetry, distinct from render telemetry.** [v1] scar §2.3 — the adapter is
  the only thing that can report *arrival*, and v1 shipped eleven days of truncated wakes
  because only the render was instrumented.
- **Injected context is excluded from pacing but kept in capture.** [v1] §2 G11 —
  host-injected material that is user-role but is not the user speaking must not pace a
  ritual.
- **Conversational text only**; tool output, file contents, images, and injected context
  never enter capture. [v1] §2 G10.
- **The episode ask is one ask, committed before it blocks**, and any error in it is
  fail-open — collection never depends on the ritual. [v1] §13 G3–G5.
- **A detached worker that cannot run escalates rather than re-logging.** [engram E4's
  widening] v1's runner starved for two days for one project scope because it expected to
  inherit a credential from whatever shell launched the session; the backlog drained only
  when someone noticed.
- **The credential comes from the environment first and, where the host gives a process
  none, from the ONE file this package's own config names (`credentialsFile`).** [v1's
  `.env` fallback, ported as a scar rather than as code] Measured day 0 of the parallel
  run: this host's hook processes carry neither documented name even with both exported in
  the owner's shell rc. A file the config NAMES is "one configured source the package
  owns" (§2.18); a file found by CONVENTION is not, and stays forbidden. Only the two
  documented names are honored, the environment always wins, and only names and counts
  ever leave.
- **Anti-loop re-entrancy guard on the turn hook.** [v1] test-triage `hooks.test.ts`.
- **Observer stands down at the hook boundary and at the store seam.** [v1] §15, scar E7.

## 4. Drops / simplifies

- **The A/B day-alternating wake mute is gone** — the *day-alternation*, that is. Computing
  a parity off an anchor date is not a memory property (§1) and no schedule decides who
  speaks here. What survives is smaller and temporary: for the **parallel run** beside v1,
  a **primacy resolver** (`primacy.ts`) behind the `parallel.enabled` config flag. It reads
  v1's own assignment file and lets the delivering hooks speak only when that file names the
  slot v2 occupies; it **fails toward mute** where v1 fails toward inject, so the joint
  failure state is v1-only rather than two voices or none. Absent flag ⇒ v2 delivers, which
  is the ordinary build. The flag, the resolver, and the two durable events are **retired at
  PROMOTE** — they are scaffolding for a comparison, not a feature.
- **The 9,000-byte wake budget is not a constant here or anywhere.** The adapter
  **discovers or asserts** its host's injection ceiling and reports it as a capability;
  the core composes to whatever it is told (scar §2.18). v1's number was 90% of one host's
  cliff, encoded as though it were physiology.
- **Multi-file API-key rotation and per-key cursor bookkeeping are dropped**; credentials
  come from one configured source the package owns, not from an inherited shell
  environment (scar §2.18: "nothing in the core depends on a tool, file, or environment the
  host may not provide"). Settled by the scar.
- **Model-seat pins are dropped.** **PROPOSED** — owner call at check-in. Constitution
  line 2 says which seat runs which job is a design choice, never doctrine, and the model
  lineup will have moved. What is **kept** is the bake-off *method* (earned-mechanism #20:
  real archived inputs through the real path, blind-judged, including the losing tier as a
  judge) and scar §2.15's requirements: pinned snapshots rather than aliases, one knob per
  seat rather than one shared across three call sites, and a placeholder that **expires**
  so "never decided" cannot masquerade as "decided."

## 5. Contract

**Inputs** — host hook events (session start, user turn, stop, session end, pre-compaction);
the host's transcript slice since the last boundary; host configuration.

Two of that transcript's shapes arrive **user-role and are not the owner speaking**, and
both are named here because a reader that misses either mints someone else's words as the
owner's (measured 2026-09-04, `fix/transcript-peer-speakers`):

- **`<cross-session-message from="…" from-name="…" from-mode="…">…</cross-session-message>`** —
  a message from another of the owner's Claude Code sessions
  ([docs](https://code.claude.com/docs/en/cross-session-messaging); the attribute set
  `from`, `from-name`, `from-session`, `from-mode`, `hop-chain` read off the v2.1.260
  bundle). The content is **real experience and is kept**; the wrapper is replaced **in
  place** with `[message from another Claude session, <name>]: …`, because a span is text
  and attribution has to survive in the words. The name is `from-name`, then
  `from-session`, then `unnamed`; **`from` is deliberately not a fallback** — it is a
  machine-local socket path, and a path has no business in prose that outlives the socket. A block that is nothing but a peer message
  is `injected` (kept in capture, out of pacing); a block that mixes the owner's own text
  with a wrapper stays `conversation`. The rewrite never splits a block into extra turns —
  the per-session read cursor indexes into that list. The sibling **idle notice** is plain
  text, not a wrapper (`[Cross-session idle notice] "x" is idle now` / `… has exited`), so
  it gets no rewrite; it and any other `<cross-session-*>` wrapper the host may add are
  classified `injected` as the conservative reading of a shape not yet measured.
- **`Stop hook feedback: …`** — the host returning a blocking Stop hook's stderr to the
  model. It carries **this adapter's own asks**, so it is `ritual` and enters nothing
  (G11). One carrying a v1 marker is still `foreign`: foreign is checked first.
**Outputs** — an injected context block or the empty string; appended spans; the
end-of-session ask; a detached worker spawn; capability reports (injection ceiling,
execution ceiling, socket lifetime, credential availability AND which source answered —
`env` or `file`, name-level only); delivery and stand-down telemetry.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] The core imports nothing from this directory**, and a test asserts the dependency
   direction (constitution line 5).
2. **[M] No hook ever fails the host.** Every failure is logged and swallowed; every hook
   returns within its stated budget.
3. **[M] Every session-ending path reaches the boundary**, and a test enumerates the host's
   session-ending events and asserts each is wired.
4. **[M] Host-dependent limits are discovered or asserted at runtime and surfaced as
   checkable values**, never assumed; exceeding one is an event, not silent degradation
   (scar §2.18).
5. **[M] The spawner pins the child's environment last**, so no caller can leak a run into
   the wrong store (scar §2.13).
6. **[M] A long call proves it survives this host's ceilings, once, in this host** —
   adapter-level evidence, per scar E3's rescope.
7. **[M] Under observer, the boundary appends no span, resolves no references, spawns no
   worker, and asks for no episode** — and logs that it stood down (scar E7, §2.4).
8. **[M] The read cursor is per-session and advances only after a successful append**, and
   a test covers the compaction case: a re-read of overlapping content must not re-encode
   (the v1 hypothesis that was never verified — carried as a test to write).
9. **[A] Hook names, wiring, and settings-file merge mechanics are host trivia** and may
   change with the host without touching a core contract.
10. **[M] Foreign injection never enters capture.** Text another memory system's hooks put
    into this host's transcript is tagged `foreign`, and `enters()` refuses it — unlike
    `injected`, which is kept and only excluded from pacing. The recognizers are ONE
    exported constant (`FOREIGN_MARKERS`), so the preflight canary and the reader cannot
    disagree about what foreign looks like. Without this, a parallel run makes each system
    encode the other's briefing as a memory of having thought it.
11. **[M] This system's OWN ritual text never enters capture, and the refusal is counted.**
    A host that returns hook output into the model's context (`Stop hook feedback:`) hands
    this adapter its own authorship and episode asks back as user-role prose. That text is
    tagged `ritual`, `enters()` refuses it, and — because it is refused rather than dropped
    quietly — it lands in the boundary record's `excluded` count, so a boundary that
    captured nothing because everything was ritual is distinguishable from a boundary where
    nothing happened. The ask's durable record is `adapter.authorship.ask`, not the
    transcript copy. This **supersedes** the earlier reading that excluding the wrapper
    would blind the reader to its own voice: what the transcript copy actually bought was
    the ask's wording becoming a memory of having thought it.
12. **[M] A peer session's words are kept, but never as the owner's.** A
    `<cross-session-message>` block is rewritten in place to name its speaker before it can
    reach a span, and a block that is only a peer message does not pace a ritual. Without
    this the fallback sweep mints another instance's findings as things the owner said in
    conversation — the failure this guarantee is named after.
13. **[M] The live session is recorded where this host's TOOLS can find it.** SessionStart
    writes `<dataDir>/sessions/<id>.json` (id, scope, started, last boundary), Stop
    refreshes the clock — creating the record when it is missing — and SessionEnd closes
    it. The writes are atomic (temp + rename), tiny, and silent on failure, because a hook
    may not fail the host (G2) and SessionEnd's hooks share 1.5 s between them. It exists
    because this host launches its MCP servers from a static configuration and cannot tell
    them which session they serve: without this note `session_end` refuses every dump —
    measured for the whole of the first run — and the authored front door is shut. The
    scope is set once, by SessionStart, so a later hook cannot move the project out from
    under a server that already matched it. An observer records nothing.
14. **[M] The authorship ask names the session id and the tool that takes it**, and says
    `updates` is a FIELD rather than prose. The wording is advisory; the two facts it
    carries are mechanized elsewhere — the id is what the MCP server binds itself with,
    and the field is what `remember/updates.ts` resolves. The old wording ("say
    `updates: <id>`") produced four notes whose declaration landed as the first words of
    their own prose, unlinked. The ask's text is the same text G11 refuses when the host
    hands it back — it is delivered by the hook and recorded by
    `adapter.authorship.ask`, never by its transcript copy.
15. **[M] The prompt path opens no socket, and the semantic cue is LAGGED.** The
    embedding a turn's recall consults is computed by the detached worker AFTER the
    previous turn and read out of per-session gate state on the next one — the same
    one-turn lag carried cues already run on (owner ruling, 2026-09-04). Measured on the
    live store: `RecallTurn.vector` existed from `recall/`'s first commit and neither
    live path ever set it, so 13,862 embeddings were consulted by nothing; and every
    hook process already spends 700-1000 ms cold against a 1200 ms budget, so an in-line
    embed would have bought a `latency-abort`, not a channel. A test spies
    `globalThis.fetch` AND injects a throwing `embedFetch`, so neither route can quietly
    reappear. **The RANKING travels with the cue, not the vector**: `Store.nearestTo`
    over a live-sized index measured 590-1040 ms, so carrying a vector would have moved
    the network call off the hot path and left the scan on it.
16. **[M] The worker gives vectors to memories that have none, at a bounded rate.** Up
    to `BACKFILL_LIMIT` (64) per run, first-person material first — what the experiencer
    authored and its own episodes, then everything else oldest-first — with
    `{embedded, remaining, failed}` written durably (`adapter.embed.backfill`) so the
    coverage watch reads a number out of the store rather than out of a dead process's
    stderr. The authored door still warms its own vector when a `vectors` socket is
    wired; this is the GUARANTEED path, because a memory that predates the embedder, or
    arrived by migration, has nothing and no future deposit comes back for it.
17. **[M] The deliberate ask MAY embed in line, and says which channel answered.** The
    MCP entry point loads the same 0600 credentials file the hook entry point names and
    hands the server an opened embedder or null; the server never sees a key. A missing
    one degrades the ask to lexical-only and the result carries `semantic:
    "embedder-off" | "embed-failed"` rather than a quietly narrower answer.

## 6. Scars honored

**E3** (streaming, with the host's socket ceiling proven here rather than assumed by the
core) · **E4** (detached execution, watchdogs, and a worker that alarms when it cannot
start) · **E7** (stand-down at the hook boundary) · **§2.3** (delivery telemetry) ·
**§2.13** (the spawner pins the data directory; no environment default) · **§2.15** (pinned
model snapshots, one knob per seat, placeholders that expire) · **§2.18** (a guarantee
carried by something you don't own is not a guarantee — this scar is this adapter's
charter).

## 7. Open questions

1. **Does the host offer an in-the-moment jot channel at all?** The owner's decision allows
   jots "where the host allows"; whether this host does, and at what cost to the turn, is
   unmeasured.
2. **What is the honest bound on the orphanable tail** — the stretch after the last
   session-ending event nobody can ask about — in this host specifically? v1 bounded it by
   its re-ask threshold and logged it, which is the right shape; the number is host-local.
3. **Which host event, if any, means "crashed"?** Crash-fallback interpretation is the only
   remaining transcript-reading path, and it needs a trigger that is not merely "no
   end-of-session write happened," since that also describes an ordinary abrupt exit.
