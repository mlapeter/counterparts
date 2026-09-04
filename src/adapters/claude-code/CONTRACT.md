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
3. ~~**Which host event, if any, means "crashed"?**~~ **ANSWERED 2026-09-04 (owner
   ruling).** *No host event does* — and that is the answer, not a gap. This host has no
   crash signal: an abrupt exit, a killed terminal and an ordinary close all leave the
   same trace. So "crashed" is defined on the boundary record instead, and the definition
   is host-agnostic enough to live in the core (`remember/spans.ts#crashedSessions`):

   > A session is CRASHED when it holds uncovered spans, has recorded **no `session-end`
   > boundary**, and has had **no boundary activity for `CRASH_STALE_MS`** (12 hours,
   > CAL).

   Two consequences this adapter owns. First, `session-end` is now load-bearing beyond
   its ask: it is the host's own statement that the author got the pen, and a session
   carrying one is never swept, however much trailing material it left. **That this host
   actually delivers it is measured, not assumed** (2026-09-04, live store): durable
   `adapter.boundary` rows carry `hook: "session-end"` for 5 of the 9 sessions that ever
   reached a boundary, and the other 4 are sessions still open. The hook is wired in the
   host settings and lands inside its shared budget. It stays a **standing watch** rather
   than a settled fact — session-end boundaries per ended session, on the daily — because
   the whole "a normally-ended session is never swept" clause rests on it: were the hook
   to go silent, the live behaviour would degrade to "everything is swept once it goes
   quiet", which still fixes the Stop-time twin race but moves the twin risk to idle
   sessions. Second,
   `pre-compact` is **not** a crash. It was the closest thing to a named catastrophe and
   it is still wired — but what answers compaction is the unconditional *capture* at that
   boundary, not a model call; the sweep follows only if that session then goes silent.

   The hook path is unchanged by this: boundaries still capture at all three paths and
   the worker still spawns at Stop and SessionEnd for the Hebbian flush and the sleep
   cycle. Only the worker's sweep step is gated, and its skip is a durable `sweep.gate`
   row so a quiet sweep is distinguishable from a dead one.
