# `adapters/claude-code/` — CONTRACT

## 1. Purpose

The launch adapter: wake injection at session start, the end-of-session write, and crash
detection — everything host-specific, so the core stays host-agnostic. Session start is
where this adapter delivers a wake; it is no longer the only place one is read, because
since 2026-09-17 the core composes a read-only one into the crash fallback's prompt — the
same composer, minus the prospective lane and minus anything protected or confidential —
and this adapter's interpret client put that prompt on the wire until 2026-09-24 (see
§1a: the sweep no longer interprets here).

## 1a. Keyless (owner, 2026-09-24)

The package reads no API key and calls no model API of its own. Removed that day: the
Anthropic write-up of crashed sessions (`interpret-client.ts`, the `crashWriteUp: "api"`
opt-in, the worker's `sweepAware`), the Voyage embedder (the paid half of
`embed-client.ts`, `embedder.kind: "voyage"`, the `models` seats), the credentials file
(`credentials.ts`, `credentialsFile`) and the `credential` capability row. Why: the owner
wants to say "no keys; nothing leaves your machine except through Claude Code" without an
asterisk, and essentially no install had a key. The page writer's `pageWriter.command`
went at the same time — a configuration that could name the program the worker starts —
and the tests now inject it through code (`PageWriterPlanInput.command`).

A configuration that still names any of these is read, not refused: the setting is
ignored and listed in `AdapterConfig.retired`, which doctor prints as one green `Old
settings` note. `kind: "voyage"` reads as the local table. The paragraphs below that
describe the removed paths are kept as history and say so where it matters.

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
- **The delivery preface is composed HERE, at injection.** The bundle was composed at the
  last boundary and is served unchanged to every session until the next one, so the line
  naming which system this is, the lived day, TODAY'S DATE (the adapter's own fact) and the
  store's current size can only be written at delivery. `self/` owns its wording and its
  byte accounting; this adapter owns asking for it and reporting the delivered bytes,
  sentinel included (2026-09-03: the memory system changed mid-day and the body went on
  speaking as the old one).
- **Delivery telemetry, distinct from render telemetry.** [v1] scar §2.3 — the adapter is
  the only thing that can report *arrival*, and v1 shipped eleven days of truncated wakes
  because only the render was instrumented. SessionStart writes the sentinel it printed
  into the session registry record, and the session's FIRST PROMPT reads the head of the
  host's transcript for this package's SessionStart attachment — what the hook printed
  beside what the host recorded as injected — and leaves one `adapter.wake.delivered` row
  saying `delivered`, `truncated`, `mismatch`, `printed-unverified` (this host build
  records no injected copy to check against), `not-found` or `no-wake-expected`, in counts
  and flags. No text from the bundle rides on that row: the sentinel is compared where it
  is found and only the answer comes back. The expectation is persisted rather than held in memory because every
  hook is its own process: it was a `Map` on an adapter instance until 2026-09-17, tested
  against a field no caller set, and wrote 0 rows in two weeks of live running (mechanism
  inventory §3 S2).
- **Injected context is excluded from pacing but kept in capture.** [v1] §2 G11 —
  host-injected material that is user-role but is not the user speaking must not pace a
  ritual.
- **Conversational text only**; tool output, file contents, images, and injected context
  never enter capture. [v1] §2 G10.
- **The blocked moment carries ONE ask, committed before it blocks**, and any error in
  it is fail-open — collection never depends on the ritual. [v1] §13 G3–G5. *Violated
  2026-09-03/04 and restored: v2 grew a second ask (authorship) on a second pacer beside
  the episode's, and the two fired on different Stops — about a dozen asks in a 13-turn
  evening. "New features do not get to grow it back into two" is the guarantee, and the
  feature was the return channel, not a second moment.*
- **A detached worker that cannot run escalates rather than re-logging, DURABLY.** [engram
  E4's widening] v1's runner starved for two days for one project scope because it expected
  to inherit a credential from whatever shell launched the session; the backlog drained
  only when someone noticed. v2 repeated it for a WEEK (I32, 2026-09-11) because both
  halves of the guarantee were ring-deep: the refusal left no durable row, and the
  per-reason counter lived on an adapter instance that dies with its one-turn hook process,
  so `escalate` read false at every one of a hundred boundaries. Since 2026-09-11 the
  refusal writes `adapter.spawn.refused` / `adapter.spawn.failed` (one row per reason per
  calendar date) and the counter lives in box 2's meta.
- **A worker DEGRADES step by step; it does not refuse the run.** [I32] Exactly one of the
  worker's five jobs needs a model credential. Refusing the spawn without one stopped the
  other four — the lived-day clock, the Hebbian flush, the semantic cue, the embedding
  backfill and the whole sleep cycle — and froze the day's ask cap with them. Each step now
  asks its own question and records its own answer by name (`sweep.gate` with
  `reason: "no-credential"`; `no-credentials` / `embedder-off` on the vector steps).
- *(Removed 2026-09-24 with the keys — §1a.)* **The credential comes from the environment
  first and, where the host gives a process none, from the ONE file this package's own
  config names (`credentialsFile`).** [v1's
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
  (G11). One carrying a v1 marker is still `foreign`: foreign is checked first. A
  user-role line whose metadata says the HOST wrote it (below) and that opens with the
  ask's own first words, bare or behind any `<Event> hook <word>:` frame
  (`transcript.ts#OWN_ASK`), is `ritual` too — the JSON shape's return frame is
  unmeasured, and this keeps it out of capture either way. Never a line with no metadata
  (it may be the person) and never the assistant's own text.

**And who wrote a user-role line is read from the entry's own metadata first** (B1,
2026-09-23; shapes measured on 2.1.28x, table in `NOTES.md`): `origin.kind: "human"` is the
person — typed, queued, or pasted; `isMeta`, `isCompactSummary`, and any other
`origin.kind` (`peer` for a subagent's hand-back, `task-notification`) are the host, and
are `injected` — kept in capture, out of pacing. The new text markers (anchored at the
start of the block) decide only for a USER-role entry that carries no metadata; the
assistant's text is never reclassified by a marker, and `classifyBlock` — the rule both
roles share — is unchanged. The two refusals (`foreign`, `ritual`) come before the
metadata, so hook feedback on an `isMeta` entry is still refused, not merely unpaced. An
assistant line the host synthesised (`isApiErrorMessage`, `model: "<synthetic>"`) is
`injected` as well; the assistant's real replies pace, as they always have. **Known gap**
(`INTERFACE-GAPS.md` §14): a prompt the person types while the model is working is
written as an `attachment` (`queued_command`), which this reader does not read.
**Outputs** — an injected context block or the empty string; appended spans; the
end-of-session ask; a detached worker spawn; capability reports (injection ceiling,
execution ceiling, socket lifetime); delivery and stand-down telemetry. (A `credential`
row, saying which source answered, existed until the keys were removed — §1a.)

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
    nothing happened. The ask's durable record is `adapter.ask`, not the transcript
    copy. This **supersedes** the earlier reading that excluding the wrapper
    would blind the reader to its own voice: what the transcript copy actually bought was
    the ask's wording becoming a memory of having thought it.
12. **[M] A peer session's words are kept, but never as the owner's.** A
    `<cross-session-message>` block is rewritten in place to name its speaker before it can
    reach a span, and a block that is only a peer message does not pace a ritual. Without
    this the fallback sweep mints another instance's findings as things the owner said in
    conversation — the failure this guarantee is named after.
13. **[M] The live session is recorded where this host's TOOLS can find it, and that
    record is also WHERE THE SESSION IS FILED.** SessionStart writes
    `<dataDir>/sessions/<id>.json` (id, scope, started, last boundary, and the marks a
    later hook process needs: which configuration was read, whether the first-launch
    question went out, the wake's sentinel and whether its arrival has been checked), Stop
    refreshes the clock — creating the record when it is missing — and SessionEnd closes
    it. The writes
    are atomic (temp + rename), tiny, and silent on failure, because a hook may not fail
    the host (G2) and SessionEnd's hooks share 1.5 s between them. It exists because this
    host launches its MCP servers from a static configuration and cannot tell them which
    session they serve: without this note `session_end` refuses every dump — measured for
    the whole of the first run — and the authored front door is shut.

    **ONE SCOPE PER SESSION, FOR THE SESSION'S WHOLE LIFE.** Spans, boundaries, coverage,
    the ask's coverage read, the registry record and the worker's session state all use
    the directory the session STARTED in, whatever directory the agent's shell has since
    moved to. `bin/hook.ts#sessionScope` takes it from this record first — the recorded
    fact of where the session began, and the same string `mcp/server.ts` matches a deposit
    against — then from `CLAUDE_PROJECT_DIR`, which the host documents as the project root
    where the session started, exports to hooks and to stdio MCP servers alike, and keeps
    put when the agent enters a worktree. `recordSession` sets the scope only at a start,
    and only a SessionStart whose `source` says it is OPENING a session counts as one: a
    compaction fires SessionStart mid-session, and re-anchoring there would split a long
    session at every compaction.

    The measurement that set the rule (2026-09-17): the payload's `cwd` follows the agent
    into a git worktree, so one session's spans landed in FOUR scope directories and its
    boundaries in all four, while its authored deposits and their coverage marks landed in
    ONE — the server's scope is fixed at launch, and a deposit covers only spans in its own
    scope. Everything in the other three stayed uncovered and was rewritten twelve hours
    later by the crash fallback as though the session had died. Two worktree scopes on that
    store hold 298 fallback memories and zero authored ones. An observer records nothing.
14. **[M] The Stop ask names the session id and BOTH tools that take it**, says
    `updates` is a FIELD rather than prose, and says salience is the author's to set. The
    wording is advisory; every fact it carries is mechanized elsewhere — the id is what
    the MCP server binds itself with (`mcp/server.ts#requireBoundSession`), the field is
    what `remember/updates.ts` resolves, the unclaimed default is `physics/`'s. The old
    wording ("say `updates: <id>`") produced four notes whose declaration landed as the
    first words of their own prose, unlinked; and on the Stops where only the episode
    half fired, the model got neither an id nor a tool name. The ask's text is the same
    text G11 refuses when the host hands it back — delivered by the hook, recorded by
    `adapter.ask`, never by its transcript copy.
    **Amended 2026-09-23 (B1, owner's decision):** the ask still names the session id and
    both tools, now in TWO lines, with two clauses about whether to write (`handoff` only
    if work here is unfinished; nothing worth keeping is a real answer, `memories: []`).
    `updates`-is-a-field and salience-is-a-floor moved to the `session_end` tool
    description, where the model reads them while filling the fields
    (`test/stop-ask-quiet.test.ts` asserts they are there). The PERSON reads one line of
    their own, `hooks.ts#STOP_HUMAN_LINE`; both texts are pinned word for word.
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
    **It runs on EVERY boundary, outside the sweep gate and regardless of its verdict**,
    and `stop()`/`sessionEnd()` spawn the worker unconditionally. The crash gate (open
    question 3, answered) decides whether a *SWEEP* selects anything — its ordinary
    answer is "nothing crashed", recorded as a durable `sweep.gate` row — and
    the cue expires after one turn, so a step that fired only when the gate opened would
    leave the semantic channel dark on every ordinary turn. The two are separately
    ordered on purpose: the cue reads the LIVE span buffer and must precede the sweep's
    claim, which would move those spans out of it.
16. **[M] The worker gives vectors to memories that have none, at a bounded rate.** Up
    to `BACKFILL_LIMIT` (64) per run, first-person material first — what the experiencer
    authored and its own episodes, then everything else oldest-first — with
    `{embedded, remaining, failed}` written durably (`adapter.embed.backfill`) so the
    coverage watch reads a number out of the store rather than out of a dead process's
    stderr. The authored door still warms its own vector when a `vectors` socket is
    wired; this is the GUARANTEED path, because a memory that predates the embedder, or
    arrived by migration, has nothing and no future deposit comes back for it.
17. **[M] The deliberate ask MAY embed in line, and says which channel answered.** The
    MCP entry point reads the same configuration the hook entry point does and hands the
    server an opened embedder (the local table) or null. None degrades the ask to
    lexical-only and the result carries `semantic:
    "embedder-off" | "embed-failed"` rather than a quietly narrower answer.

18. **[M] ONE ask, on ONE pacer, capped per SESSION PER DAY, and the re-fire advances
    nothing.** The pacer is `self/`'s and nothing else: first ask on the first real
    substance (`FIRST_ASK_*`, or `SOLO_ASK_BYTES` alone so a one-prompt agentic session
    still journals), re-ask on `REASK_TURNS` **and** `REASK_BYTES` since the last ask —
    a conjunction, the way v1 re-asked, where v2 shipped a disjunction whose byte half
    was a third of v1's. The cap is `MAX_ASKS_PER_SESSION` and each session spends only
    its own, and only for the day it is spending: this host opens a session per
    invocation, and a cap of four shared across every session a calendar day held refused
    196 of 264 Stops while the crash-fallback sweep wrote 888 memories to the author's 193
    (2026-09-17) — while spent over a session's whole life the same six starved a session
    that worked through a day and into the evening, whose handoff was never offered the
    pen (2026-09-18, the day the allowance started resetting with the store's calendar
    date). The conjunction holds the cadence — six asks in one day is roughly 46 real
    turns — so the count is a backstop, and a session that has done no real work is still
    refused, on substance.
    The coverage read stays, as a RECORD of the unaskable tail and never as a second
    condition. Exactly ONE durable row per Stop (`adapter.ask`) carries the outcome —
    `asked` | `paced` | `capped` — and its date, so "how often was it asked today" is a
    number in the store rather than a guess. The host's re-fire (`stop_hook_active`)
    reaches the adapter as `reFired` and is refused there as well as at delivery: it
    spends no pacing slot, no ask slot, and leaves no row.
    **THE ASK GAINED A THIRD LINE on 2026-09-20 (E1) and is still ONE ask.** `handoff` is a
    FIELD on the `session_end` call item 1 already names — no third tool, no second moment,
    no second pacer — and it is numbered apart from item 1 because item 1 asks for what will
    still be true next week and a handoff is the opposite claim: what is true only for the
    next fortnight, in this directory. Reading them as one sentence is what would produce
    handoffs filed as memories. The text's length bound moved 1,050 -> 1,300 with it; the
    properties the bound defends — one screen, at most four numbered items, the session id
    exactly twice — are asserted on their own.
    **B1 (2026-09-23) shortened it without adding a pacer:** two numbered lines, bound 450,
    the handoff a clause on line 1. Emission is a switch, `stopAskShape` in
    `claude-code.json` (`bin/hook.ts#hostDelivery`): `json` (default) prints
    `{"decision":"block","reason":<ask>,"systemMessage":<the person's line>}` and exits 0;
    `stderr` is the day-0 channel, the ask on stderr and exit 2. Both block, both refuse
    the re-fire. The owner picks one after looking at one Stop (recipe in `NOTES.md`); the
    other goes. Pacing is unchanged — thresholds, cap, the one pacer — except that what it
    counts is now what the person typed and the assistant's replies, and no longer what
    the host wrote on the user side (§5 Inputs, above). A `session_end` with
    `memories: []` is an answer whatever happened to a handoff sent with it: accepted,
    minting nothing, recorded as `nothingNewAt` on the session's registry record, the
    handoff's own outcome beside it; it cannot cause a re-ask, because the pacer advanced
    when the ask went out.

    **AND THE WAKE GAINED A THIRD DELIVERY-TIME FACT.** `sessionStart` passes the session's
    directory and id to `counterpart.wake(budget, delivery, here)`, beside the date it
    already passed, because the published bundle is one per store and read in every
    directory. With no live handoff nothing is passed through and nothing is spliced.

19. **[M] A directory set `off` gets NO OUTPUT AND NO WRITE — because nothing is
    constructed.** The scope registry (`adapters/scopes.ts`,
    `<config dir>/scopes.json`, longest-prefix, added 2026-09-10 for owner asks
    G41–G43) is read at the ENTRY POINT, from the file `config-path.ts` resolved,
    before a store is opened: an `off` or `paused` directory returns from
    `bin/hook.ts#main` with byte-for-byte empty stdout, empty stderr, no session
    record, no capture, no spawn and no store. `guard()` carries the same predicate
    at the seam so a caller who builds an adapter directly inherits it, but the
    guarantee itself is the absence of construction, and the install loop proves it
    on a real process against a real clean-room install.

    **TWO DIRECTORIES ARE CONSULTED, AND THE MOST RESTRICTIVE WINS**
    (`scopes.ts#mostRestrictiveVerdict`) — because filing follows the session and
    privacy has to follow the shell as well. The EVENT's own directory, the payload's
    `cwd`, is looked up first and alone, before the configuration is read, so an
    opted-out directory's silence stays exactly what it was. The SESSION's directory
    (G13) is folded in after, because its first source is a record under the store the
    configuration names; a session whose own directory is `off` stands down wherever
    its shell has got to, and a session that walks INTO an `off` or `observer`
    directory goes at least as quiet as that directory for as long as it is standing
    there. Nothing is written before either verdict; the extra reading is a
    configuration file and one small session record. The session's verdict wins a tie,
    so the `unset` that raises the first-launch question (G41) is asked about the
    directory the session is filed under.

    It is SILENT on purpose, and that is a deliberate exception to "every stand-down
    is observable" (`docs/observer-mode.md` G6): there is no ring to log to without
    opening a store, and `UserPromptSubmit` fires every turn, so one line per event
    would be a permanent noise floor in the host's log for a directory that asked to
    be left alone. The record is the registry itself, and `counterparts scope <path>`
    prints it. An `off` is not an instrument standing down; it is the owner saying
    this directory is not part of the memory.

    **The guarantee is the HOOKS', and only the hooks'.** The MCP server still opens
    a store when the host launches it in an `off` directory (`mcp/bin/serve.ts`): it
    refuses every tool but `scope` with `scope-off`, per call, before any session bind
    — but the file handle exists and the store is created if it was absent. A server
    that refused to launch is reported by this host as "MCP server failed", and the
    `scope` tool is the door that turns the directory back on, so it has to answer.
    "No store is opened" is therefore true of a hook process and not of a server
    process; the owner's ruling on whether that gap should close is open (#92 review).

    A REGISTRY THAT COULD NOT BE READ is a different exception, and not a silent one
    (G23).

20. **[M] Effective stance is the MOST RESTRICTIVE of the configuration's and the
    registry's, and the registry only ever adds restriction.** `on < observer < off`
    (`scopes.ts#effectiveStance`). A registry entry of `observer` folds into the
    configuration the adapter opens on, so it IS the existing observer stance rather
    than a second implementation of it; a configuration that already stood a session
    down is never relaxed by a registry. The three private directories running on an
    observer configuration and `COUNTERPARTS_OBSERVER` have no entry at all, and
    behave exactly as they did before any of this existed.

21. **[A] An UNSET directory raises the first-launch question once per session, and
    never inside the wake.** `SCOPE_ASK` travels on `HookResult.ask`, which the host
    delivery appends AFTER the injection — never inside it, because the wake's
    sentinel states its own byte count and must remain its last line (G2, scar §2.3).
    It is delivered only when it FITS the ceiling the host reported, wake bytes
    included; with no room it is deferred with an event and the session record is left
    unmarked, so the next session asks rather than the question being truncated or
    smuggled past the limit. `SessionRecord.askedScope` is what makes "once" true
    across a resume or a compaction. The WORDING is advisory; that an unset directory
    raises the question exactly once and that any recorded mode ends it are the
    mechanized parts.

22. **[M] TURNING A DIRECTORY BACK ON NEVER REACHES BACK.** A session that lived
    under `off` or `paused` left no session record and no span cursor, because the
    hook process returned before anything was constructed (G19). Flip the registry
    to `on` mid-session — `counterparts scope . --resume`, or the `scope` tool, which
    is deliberately the one tool that answers in an off directory — and the next
    boundary would otherwise slice the transcript from cursor 0 and deposit the whole
    off conversation. It does not: a boundary that finds NO session record and a
    cursor still at 0 (`hooks.ts#sealJoinedLate`) moves the cursor to the end of what
    it can see, captures nothing at all, writes the session record so the tools can
    bind, and leaves `adapter.scope.joined-late` in the ring with `joinedLate: true`
    on its durable boundary row. What is said after the switch is captured normally.

    The cost is stated rather than hidden: a session whose SessionStart never ran
    inside this memory — hooks installed mid-session, a store moved or restored
    without its `sessions/` directory, a SessionStart that failed — loses the
    conversation so far at its first boundary. The privacy direction is the one the
    owner asked for; the completeness direction is the one it costs.

23. **[M] A REGISTRY IN TROUBLE IS NEVER SILENT, and that is a different exception
    from G19's.** `off` is silent because the owner said leave this alone. A
    registry file that could not be read has said nothing at all, and its fail
    direction is `unset` — which is ON: the review measured one typo'd mode turning
    every correctly typed `off` in the file back on, with no evidence anywhere but
    a ring event in a process that lives for one turn. So a bad ENTRY is refused by
    name and the rest of the file stands (`scopes.ts#parseRegistry`); a file that is
    not a registry at all is still a whole-file failure; and either way
    `describeScopeTrouble` puts one line on the hook's stderr at **SessionStart
    only** — after the `off` return, so an off directory's silence stays
    byte-for-byte — with `scopeRegistry: "unreadable" | "partial" | null` on the
    session-start row for the day after. **Since I40 (2026-09-23) the same line also rides
    the SessionStart `systemMessage`**, because stderr at exit 0 reaches only the host's
    debug log — AFTER the doctor notice and only if it still fits the envelope, since the
    doctor notice has no other route and this line keeps its stderr copy. Both writers refuse rather than dropping
    an entry they could not read: the console unless `--force`, the MCP tool always.
24. **[M] A stand-down that is a FAULT reaches the owner's terminal; one that is
    DELIBERATE stays as quiet as it was.** G2 is why every failure is swallowed;
    it is not a reason for the owner never to learn of one. Until now a hook that
    could not open its store wrote one line to stderr — which on this host goes
    nowhere anybody looks — so a store with one missing prose file meant no wake,
    no recall and no capture in every session, silently, while every visible
    surface read green. *(That was the FILE floor. The same shape survives the
    move to rows as a row whose words went missing — `MEMORY_BODY_MISSING` — and
    since 2026-09-20 doctor, `verify` and `status` all name the row.)* So `bin/hook.ts` classifies its stand-downs
    (`standdown.ts`): a directory scoped `off`, an observer with no store to read
    (`STORE_UNINITIALIZED`), and the explicit-dir guard's two refusals are
    DELIBERATE and unchanged; anything else is a FAULT and prints one
    `systemMessage` — the channel I32's close measured and `bin/hook.ts#hostDelivery`
    already uses for the red notice — on **SessionStart and
    UserPromptSubmit**, the two events this host displays one on. Exit 0 as
    always, nothing else in the object, no wake and no `additionalContext`, and
    the stderr line is kept. What is said, and whether, is marked in a file under
    `<dataDir>/sessions/` — because the thing that failed is the store, the mark
    cannot live in it — and a mark that cannot be written means it is said again
    rather than not at all.

    **A FAULT IS PERSISTENT OR TRANSIENT, and they are not said the same way.**
    A store that will not open is exactly as broken next turn: "memory is OFF for
    this session", once, with a code and one clause of plain words capped at
    `STANDDOWN_REASON_MAX_CHARS` — SessionStart always, UserPromptSubmit while the
    session has not been told. A database that was merely BUSY (`db.ts#isLocked`,
    one predicate for this and for F1's WAL conversion) is not that, and saying
    it were would be both untrue and, at the rate a rollback-mode store produced,
    a line people learn to scroll past. So: at a prompt it is recorded and stays
    on stderr the FIRST time and is said from the second, at most once a session
    ("skipped this turn"); at SessionStart it is said the first time, in its own
    words, because a lock there means no wake was injected at all and that event
    does not come round again; and at `TRANSIENT_ESCALATE_AFTER` skipped turns it
    is said ONCE more, in the only transient wording allowed to use the word OFF,
    because no test on an error can tell a contended database from a wedged one
    and the soft line's promise that it will clear has by then become a lie. The
    two counters are kept apart, so a session that met a busy database still
    hears about a store that will not open.

    **AND A FAILURE AFTER THE TURN'S WORK IS NOT A FAILURE OF THE TURN.** Once
    `adapter.hook` has returned, this event's job is done — recall composed, the
    turn captured, the session record written — and anything that throws after
    that is the tidying-up, not the work. It stays on stderr, exactly as on
    master. Without that gate a throw from the `close()` in the `finally` (I38's
    own shape) told the owner "skipped this turn" about a turn that had just
    succeeded, and a warning that is sometimes false is the one outcome this
    guarantee cannot afford. The mark is never written into a directory the store
    layer refuses to open, and never through a symlink: `writeMark` asks
    `assertSafeDataDir` and writes tmp-then-rename, `sessions.ts`'s own rule for
    the same directory.
    `counterparts doctor` reads the same open with the same predicates
    (`doctor.ts#readCounterpartOpen`) — RED for a store that will not open, AMBER
    for one that was busy or that only an owner may initialize — so the terminal
    and the console cannot disagree about what happened.

25. **[M] THE WORKER TAKES ONE COPY OF THE STORE A DAY, AND THE COPY IS THE ONLY
    THING HERE THAT DELETES.** A fourth step in `bin/runner.ts`, after the sleep
    cycle and inside the `finally` so a failed boundary still gets its copy —
    deliberately NOT a `core/sleep/` phase, because sleep must not learn that the
    floor is changing. What it copies is `cli/snapshot.ts#snapshot` unchanged
    (`Store.backupSet()`, so it is right on both floors); WHERE is a `snapshots/`
    directory beside the store, never inside it; HOW MANY is `keep`, default 14,
    one copy per calendar day UTC. It never throws, so a snapshot problem cannot
    cost a consolidation cycle, and it writes `snapshot.taken` / `snapshot.failed`
    / `snapshot.rotated` where tomorrow can read them.

    The two consequential rules live in `adapters/snapshots.ts` and are tested one
    by one: **rotation deletes only what it can prove is a snapshot** (a directory
    directly inside the resolved directory, matching the one name pattern this
    package writes, never through a symlink, never the copy just taken, never
    after a copy that FAILED, and a broken `keep` reads as the default rather than
    as "delete them all"); and **a half-copy is never a snapshot** — the copy is
    written under a `.partial-…` name and renamed into place, so a worker killed
    mid-copy leaves something that is not counted toward `keep`, does not satisfy
    "today's exists", and is swept once it is too old to be a live run's.

    *For now:* the default directory applies only inside the layout this package
    creates (the store is the `store/` subdirectory of a base directory). A store
    somebody pointed elsewhere takes no copy until `snapshots.dir` names one, and
    doctor's Snapshot line says so in words rather than leaving a row per boundary.

    **HOW TO RESTORE ONE, because a backup nobody knows how to open is not a
    backup.** A snapshot is a whole store directory, so restoring is a copy:

    1. Stop every session using the memory (the MCP server and any hooks).
    2. Move the damaged store aside — never delete it — and copy the snapshot
       directory into its place: `cp -R ~/.counterparts/snapshots/<iso>
       ~/.counterparts/store`.
    3. `counterparts verify --dir ~/.counterparts/store --rebuild`, with the
       embed key exported if the embedder is on.

    What comes back with the copy: every memory, its archived versions, the
    journal, the spans, the event log — the canonical halves. Since the floor
    (schema v6, 2026-09-20) the memories' words are COLUMNS, so all of that is
    inside `counterparts.sqlite` and there is no prose to come back separately. What does NOT, and why step 3
    exists: `cache/` is classified out of the backup set on purpose (it is
    rebuildable and unbounded), and it holds the lexical search index and every
    vector. **Until the rebuild, `search()` returns nothing** — the memories are
    all there and none of them can be found, which is exactly the shape that makes
    somebody conclude the backup is empty. A rebuild without an embedder drops
    every vector rather than keeping them, so semantic recall is thin until the
    worker's backfill refills it over the following days; the lexical channel is
    back immediately. Doctor prints these steps as the remedy on any Snapshot
    finding that is not green.

### The nightly page writer, in two modes (S2, 2026-09-20 — true for now)

**[M] Session mode is the default, and it costs the wake nothing.** When the writer is owed
the day just gone, the SessionStart hook puts the core's instruction in `HookResult.ask` —
the same field, beside the wake and never inside it, that the first-launch scope question
uses and for the same reason: the bundle's byte count and its tail sentinel are load-bearing.
The wake's `injection`, `bytes` and `sentinel` are byte-identical with the writer off and
with it on, and that is asserted rather than argued. **The first-launch question wins the
field** when both want it; the writer's is deferred with a ring event and the night stays
owed. **No room under the reported ceiling defers rather than truncating**, and claims
nothing. One session is asked once — a compaction re-firing SessionStart asks nothing — and
the mark is a DATE on the session's registry record, which is also the only evidence the
MCP server accepts for writing `by: "writer"` on the revision that comes back.

**[M] Host mode starts a windowless session of the self, and reads the outcome from the
store.** `claude -p`, so the ordinary SessionStart hook fires inside the child and the
writer wakes with the wake; exactly one pre-approved tool, the page's. The plan is pure and
decides everything; the starter is six lines. The package's own values go onto the child's
environment LAST (§2.13), and `COUNTERPARTS_SESSION` / `COUNTERPARTS_SCOPE` are REMOVED
rather than inherited — a whole new host session that inherited the parent's session id
would bind its MCP server to a session that has already ended. The night it is writing rides
as a pinned DATE (`COUNTERPARTS_PAGE_WRITER`), because a windowless child's session id is
minted by the host after the launcher is gone. **The child's stdout is never parsed into a
verdict**: what the run did is read from the page's version chain and from the row the tool
left, and the exit code decides only between "nothing to say" and "could not run". The
child's own SessionStart raises no writer ask — session mode only — or a session started to
do the writing would be asked to do it.

**[M] The ask is measured, not predicted, and a deferral is not a silence.** The composed
block is checked against the host's reported ceiling AFTER composing (the estimate is its
shortest shape; the delivered one is longer), and re-composed once against the room the
first attempt proved was really there. A block that will not fit, or that can carry none of
the day, is DEFERRED — and the deferral leaves a durable `skipped` row, deduped one per
night per reason, which claims nothing and can never close a night. The first-launch scope
question still wins the field, but only once per night: on a blank store it is exactly what
is pending on nights 1–3, and an unanswered one used to starve the writer for ever.

**[M] It never costs anything else.** The writer runs last in the detached worker, inside
the same `finally` as the snapshot, so a day whose sweep broke is still a day that gets
written about; it never throws; and a failure never fails a wake, a boundary or a session.
Doctor's `Page writer` line is GREEN when it has never run on a store with no yesterday and
GREEN on a night that had nothing to say, AMBER only on a failure or a refusal or on the
writer being off while a page stands, and never RED.

**[M] The child gets the day on STDIN and a stance this package chose.** The instruction is
not in `argv`, where `ps` shows it to every process on the machine, and
`COUNTERPARTS_OBSERVER` is deleted from the child's environment beside the two session
variables: a shell that exported it would hand the child an observer store whose
`self_page` refuses, and the night would then read `nothing-to-say` — fail-closed, but a
silently wrong answer. A child that ignores SIGTERM is escalated to SIGKILL on its process
group and then given up on, so the worker cannot be held past its own watchdog.

**UNVERIFIED, and named rather than claimed:** no build has started a real `claude -p`.
Everything above about host mode is proved against a stub executable. What a real machine
has to answer is keychain access from a background process (`claude setup-token` is the
documented route, spec §16), which is why `session` is the default.

### The next-session write-up (C2, 2026-09-23 — true for now)

**[M] A session that ended owing a write-up is written up by the next session that starts
in its project.** "Owes" is B3's predicate (`remember/owes.ts#owesWriteUp`, read across
every scope through `adapters/sessions.ts#writeUpPlan`, the retention pass's own sources),
narrowed by one shared eligibility (`sessions.ts#waitingForWriteUp`) that the pointer, the
door and doctor all read:
- **ended** means a registry end, or silence past `WRITE_UP_SILENCE_MS` — the sweep's
  12-hour `CRASH_STALE_MS`, never the bind's 4-hour window (PR #192 review, MAJOR 3) — or no
  record at all (the registry forgets one a week after its last write; a debt outlives
  that);
- a session the registry still holds OPEN that ANSWERED its last ask is never pointed at:
  B3 counts it as owing (no normal end), but while its record stands it is most likely a
  terminal nobody has closed (MAJOR 3). **Known, and accepted as the default:** words it
  captured AFTER that answer, at a later Stop that asked nothing, wait with it — invisible
  to the pointer and to doctor's count — until the registry forgets the record, up to a
  week after its last write; then it is pointed at and the fetch carries them
  (INTERFACE-GAPS §17);
- with the API sweep on, a crashed session whose words the sweep will still read is the
  sweep's (`sweepOwns`); one whose only words left are in quarantine is not (MAJOR 5);
- **in its project** means the session holds words filed under this project's scope. A
  session that left words under two projects is written up in each by a session there,
  and neither is served the other's (MAJOR 6).

Sessions never pointed at go first, then the least recently pointed at or fetched, oldest
first among equals, so one session nobody writes up cannot stand in front of the rest.

**[M] SessionStart carries a POINTER, not the words** (owner's choice of 2026-09-23,
INTERFACE-GAPS §15 option (b)). In `HookResult.ask`, after whichever other ask took the
field, it says how many sessions here are waiting, the oldest one's date, size and "part k
of N", and the call that fetches it, naming the ended session once and this session once:
**411–428 bytes with the host's 36-character ids** (measured). The words come back from the
MCP door (`mcp/CONTRACT` guarantee 16), at most `WRITE_UP_PART_BYTES` (~24 KB) per
session, because an MCP result is not under the host's 10,000-character cap on a hook's
output and the wake is. The pointer is measured against that cap as PLAIN stdout
(`WRITE_UP_HOST_OUTPUT_CHARS` = 10,000; bytes ≥ characters): with no owner notice
`bin/hook.ts#hostDelivery` prints plain text, and with one it drops the notice before it
lets the JSON envelope pass `ENVELOPE_MAX_CHARS`. It is NOT held to the reported budget,
which is what the wake is composed to; a 9,038-byte wake leaves room (tested with host
ids). Past the cap it DEFERS, claims nothing, and records the deferral DURABLY
(`sessions.ts#WRITE_UP_POINTER_KEY`, one meta row: outcome, need, room), which doctor
reads.

**[M] Once per session, and the day's allowance.** A compaction re-firing SessionStart
points at nothing (`writeUpPointer` on the session's registry record, which is also the
door's evidence that this session may fetch that session's words at all). At most
`WRITE_UP_ASKS_PER_DAY` (2, the page writer's number) pointers per calendar day in local
time. Before the pointer is handed over, the part size, count and hand-over time go into
one meta key (`adapter.writeup.progress`, per ended session and project, removed when the
session is marked), then the registry mark, then the day's count and the outcome row; a
mark that will not land hands nothing over. Never under observer; never in a directory set
`off` (the entry point returns before anything opens). The whole body is fail-open: a
throw costs the pointer and never the wake or the other ask (asserted byte for byte).

**[M] No sweep interprets (2026-09-24).** The opt-in API sweep (`crashWriteUp: "api"` and
the key) was removed with its key (§1a), and with it the pointer's deference to it
(`sessions.ts#sweepOwns`) and the worker's `sweepAware` mark `by: "api"`. The worker hands
the sweep no interpreter; its gate row says `not-opted-in` and `runner.done` says `sweep:
next-session`. A crashed session is pointed at like any other. An old `crashWriteUp` value
is ignored and named in `retired`.

**[M] Doctor: `Crash write-up`, and the `Sweep` line.** `Crash write-up`: `next session`
green; amber when a session is finished in one project and waiting on words it left in
another, naming that project (re-review m-C); amber when the newest pointer outcome is a
DEFERRAL and sessions are waiting — saying the wake was too full, by how many bytes, and to lower
`injectionBudgetBytes` by that much (never "open a session", which would defer again);
amber when a session has waited past `WRITE_UP_WAIT_DAYS` (3). Counted with the pointer's
own eligibility. Never red; not in the session-start reading. `Sweep`: `not-opted-in` —
and an older build's `no-credential` — is green `next session`.

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
