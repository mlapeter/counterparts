# `adapters/mcp/` — CONTRACT

## 1. Purpose

The deliberate tools — note, recall, status — plus the two return channels the Stop ask
needs (`session_end` for memories, `chapter` for the episode), exposed over MCP to any host
that speaks it. Nine tools today: those five, and `scope` (this directory's setting,
2026-09-15), `self_page` (the page the wake opens with, 2026-09-18), `dream` (the
dreamer's phases, 2026-09-26) and `reflect` (the waking self's, 2026-09-27) — each added
on purpose (`tools.ts#TOOL_NAMES`).

**Which host (2026-09-30).** A result's words ABOUT the host — how to reconnect after an
update, what switching the scope does — come from the host this server serves
(`McpServerOptions.host`, looked up in `adapters/hosts.ts`). Claude Code's are unchanged.

**Claude Desktop's chat (2026-09-30, PR B).** Desktop has no hooks, so for a client that
says it is Desktop (§5 G18) this server is its own hook: a tenth tool, `wake` — offered to
Desktop only, never in `TOOL_NAMES` — mints the session and returns the briefing
SessionStart composes (G20); calls bind per call (G19); and the write-up ask rides on a tool
result. Every Desktop chat shares one place, the pseudo-scope `claude-desktop:`. Desktop's
Code tab calls this same server, and a call naming its Claude Code session is served as
that session (G21).

## 2. Brain analog

Effortful, voluntary retrieval and rehearsal, as distinct from the ambient reminding that
`recall/` provides. **Named deviation** (constitution line 8): deliberate remembering is
**the exception, not the interface**. A tool the model must remember to call cannot be
load-bearing, and this adapter is designed on the assumption that it will be used rarely.

## 3. Keeps

- **An explicit "remember this" channel exists, and is never the interface.** [v1]
  decisions-triage 07-23, constitution line 8.
- **One tool, not two.** [v1] test-triage `mcp.test.ts` — a real design decision, kept.
- **Deliberate recall is its own path, not the ambient one with lower thresholds.** [v1]
  behavioral-spec §9.1 G2 kept the ambient ranking and added a labeled lower-confidence
  tier; **dropped 2026-10-03 (Release B, Mike's design of 10-02/10-03):** a question asked
  on purpose gets every memory it matches, in one of two modes with their own ranking
  (§6f), and the vivid / quiet / dim tiers and the hard gates effort could not overturn are
  gone.
- **One kind of ask per call**: a handle (or `ids`) reads *that* memory exactly; a question
  runs a search in the mode it names. Expansion must never degrade into fuzzy search. [v1]
  §9.1 G1.
- **Exposure is not recording; retrieval is.** A SEARCH strengthens nothing — `build()` is
  pure, and nothing on that path calls `resolveUse` or `coactivate`, so a memory that was
  merely ranked and listed is no stronger for it. EXPANDING one in full, by id or by title
  handle, is USING it, and the owner's credit ruling of 2026-09-14 credits it at the
  session boundary, once per lived day, in the other adapter. So the handle path leaves one
  HOST-STATE line (`adapters/expansions.ts`: a salted hash of the handle, the id it reached
  or `null`, a timestamp, the project) so that boundary can tell which memory a TITLE
  reached. No tool here writes a memory and none touches physics.
  **Named deviation** (2026-09-15/16, G50 + G58): the rule this replaces was "[v1] §9.1 G4 —
  ranking is not recording, deliberate recall trains nothing", an ABSOLUTE written against
  the wake/footnote rich-get-richer problem. That is an EXPOSURE problem, and the absolute
  over-reached past it: the brain's rule — the testing effect, spacing — is that RETRIEVAL
  strengthens, and a memory read in full was retrieved. Corrected by owner ruling
  2026-09-16: "Exposure never strengthens. Retrieval always does." `core/recall/CONTRACT.md`
  still carries the absolute in §3 and §5 guarantee 8; correcting it is the open half.
- **A candidate count must not become an undercount** — a top-K tuned for surfacing is
  wrong for an aggregation question. [v1] §9.1 G3.
- **Confidentiality is enforced at the boundary of the ask**; withholding is *stated* for a
  direct lookup and silent in a list. [v1] §9.1 G5.
- **A census surface exists and includes what was removed** — counts and dates, never
  bodies or hashes. [v1] §9.1 G6, scar §2.20.
- **Observer stands down over the wire.** [v1] test-triage `mcp.test.ts`, scar E7.

## 4. Drops / simplifies

- **The v1 self-store tool is superseded by experiencer authorship** — self-writing became
  the primary path (owner decision, settled). This adapter therefore exposes **no tool that
  writes an identity element**: what enters the identity band is decided by promotion and
  reinforcement at the boundary, by construction, not through a tool description. The plain
  note survives as the named exception it always was.
  *Amended 2026-09-18 (owner rulings 8 and 9, `docs/plan-parallel-rebuild-2026-09-18.md`
  §2), and the amendment is narrower than it looks: `self_page` writes the PAGE — the prose
  the wake now opens with, one row with versions — and touches the identity band not at all.
  It cannot promote a memory, protect one, or move a strength. The doctrine the drop
  protected is "identity strength comes from lived salience", and that is exactly what still
  decides what the page has to work with. Written down is not the same as earned.
  Nor can it UNWRITE the page: clearing and restoring are the owner's console alone, because
  a session that could erase the self between two turns would be a different kind of tool.*
- **`protected.add` as a callable operation is dropped** with the second-signature queue.
  **PROPOSED** — owner call at check-in; see `schemas/CONTRACT.md` §4 for the evidence and
  counter-argument.
- **No tool writes an entity, a belief, or a revision.** Entities are born by mention and
  die by decay; revision is `updates:` plus arithmetic (owner decisions, settled). The
  vocabulary this adapter exposes was deliberately three verbs wide, plus the return
  channels — a return channel is not a fourth verb, it is the other end of an ask the
  system already makes. It is nine tools now (§1); none of the four added since writes an
  entity, a belief or a revision either.
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
`recall(handle | ids[, part] | question, mode[, page])`, `status()`, `session_end(session, memories[], handoff?,
writeUp?, part?)` whose
entries take the same optional dimensions — `handoff` (2026-09-20, E1) is a FIELD on the
call and never one of the entries: it is this directory's working context, filed by
`core/handoff/`, never a memory, and it is written before the `memories` check so a dump
with a malformed array does not also lose it. Three answers, and only the first is silence:
ABSENT leaves what stands; PRESENT AND BLANK retires this directory's pointer; anything
that is not text is a named, durable refusal. A handoff that LANDED with an empty
`memories` array is a success and not `memories-required` (2026-09-21, new-user finding
12): nothing worth keeping is a real answer, and only a call that lands neither is
refused. The no-scope rule (an empty scope, or one
that is the store's own directory) is asked here because this side has the canonicaliser,
and the durable row is written by `core/handoff/`, which owns that guarantee —
`chapter(session, text[, title][, about])`; `scope(mode)` for this directory; `self_page` (read,
or write with `ifVersion`); `dream(session, phase, …)` and `reflect(session, phase, …)`,
each bound to one session as `session_end` is (their fields are `tools.ts`'s); for a
Claude Desktop client only, `wake()` (§5 G20) and the `prompts/list` / `prompts/get` pair; the
session's observer role; the launch's session, scope, data dir and host when the host can
supply them.
**Outputs** — a stored memory (note), a mode's answer as labeled lines or memories read
whole (recall), a
census (status), an appended chapter with the episode's id and the chapter number the store
actually wrote (chapter), the written self page or the version a write to it produced
(`self_page`, 2026-09-18); telemetry by reference.

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
4. **[M] `recall` and `status` write no memory and train nothing in the call**, asserted by
   a test that runs both against a populated store and checks every body, version and use
   count is unchanged. What `recall` writes is bookkeeping: its durable count row, the
   handle-resolution line, and (2026-10-03) the `asked` gate records that let a QUOTE of
   an answer's words be credited at the boundary — the credit itself is the boundary's.
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
    either. (Claude Desktop is the one exception, and binds per call: guarantee 19.)
11. **[M] The scope is the one the HOST names, never silently the store — and it is the
    same string the hooks file that session under.** In order: `--scope` /
    `COUNTERPARTS_SCOPE`, then `CLAUDE_PROJECT_DIR`, then `process.cwd()`. The middle one
    is what makes the two adapters agree without either telling the other: this host
    documents it as the project root where the session started, exports it to stdio MCP
    servers and to hook processes alike, and keeps it put when the agent enters a
    worktree — while the server's own working directory is documented nowhere and was
    only ever measured (`lsof` on four running servers, 2026-09-04). The store's dir
    survives as the answer when the host names no directory at all, and which default won
    is stated in a startup event (`mcp.scope`).

    The scope is CANONICAL (`sessions.ts#canonicalScope`), because it is not only
    compared — it is the KEY. Span streams, cursors and coverage files are named from a
    hash of this exact string (`remember/spans.ts#keyFor`), so a deposit whose scope says
    `/tmp/x` would claim coverage in a different directory from spans captured under
    `/private/tmp/x`. The bind already canonicalised; the filing does now too.
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
    lands. **`about`** (2026-10-01) is checked before anything is written (a mark outside
    the five is refused `about-malformed`), set on the episode's meta and on its live
    memory copy at once, and carried to every regrown copy (`self/index.ts#copyAbout`):
    only me, us and owner let the chapter reach a wake in another directory.

14. **[M] A store a newer build has migrated is never touched by this older one**
    (2026-09-23, roadmap E). `SCHEMA_AHEAD` is decided at open, and this process opens
    once per session while the hooks, on the installed build, may migrate the store under
    it (LAUNCH-STATUS I36). So EVERY tool call first re-reads both schema stamps on the
    handles it holds (`Store.schemaVersions()`), and either one ahead of the code this
    process loaded refuses every tool — `scope` and `status` included — with one sentence,
    naming the tool, before any tool body reads or writes. `recall`, `note` and
    `session_end` can WAIT between that check and their writes (an embedding: in line
    for `recall`, at write time and once per entry for the other two, whenever the
    counterpart has a live embedder), so the store re-reads the stamps before EVERY write
    it makes for this server (`Store.guardWrites`), and `recall` asks again after its
    await; a refused write makes the whole answer the same refusal. A stamp that cannot be
    read refuses under its own reason, and a store locked past the busy timeout under
    another, with a retry rather than a reconnect. Behind is not refused: an older store is
    the hooks' to migrate. The window left is between a write's check and its transaction
    — microseconds (NOTES, 2026-09-23). It protects the upgrade AFTER the one that
    installs it — the release constraint is in NOTES.
15. **[M] The server leaves its build where the hooks can compare it** — once, at launch,
    as `sessions/mcp-server@<pid>.json` in the live-session registry (package version,
    store and cache schema versions, its pid, its host's pid, its scope), kept believed by
    a heartbeat and removed at a clean exit. Not by an observer, and not while its
    directory is set `off` or `paused` — the heartbeat re-reads the setting each tick,
    takes the record away when it goes off and writes it back when it comes on. Not in the SESSION's record, which is
    where the ruling put it: at launch this process does not know its session (guarantee
    10); every session record a hook on this build CREATES carries this build instead
    (`opened`), refreshed when the session opens, so a record without one is a pre-E
    record and nothing else. The UserPromptSubmit hook
    compares it with the installed build and says "Counterparts was updated" once per
    session, as a `systemMessage` (`sessions.ts#decideUpdateNotice`, `claude-code/bin/hook.ts`).
16. **[M] `session_end` with `writeUp` is the next-session write-up's door** (roadmap C2,
    2026-09-23; `write-up.ts#writeUpDoor`). A FIELD, not a sibling tool, diverted only on
    a non-empty string (`null` and `""` are an ordinary answer, PR #192 review m1) after
    the bind and before anything else reads the call, so it never writes a handoff and
    never marks the writing session "nothing new". It shares with an ordinary
    `session_end` only the bind (the WRITING session is this one, guarantee 10) and the
    road each entry takes (`server.ts#depositEntries`, extracted rather than copied: gate
    battery, redaction, authored channel, per-entry isolation) — so the proposals ride
    under the writing session; each MEMORY, though, is the ended session's (2026-10-01):
    its origin names that session, its `happened_on` is the day the part was lived (its
    latest piece's date; the learned date stays the day it was written), and its meta
    marks it `secondHand` with the writer's id (`writtenUpBy`) — except WHOSE words they
    cover, which the door says through core's `SessionEndDepositContext.cover`: none on an earlier
    part, the ENDED session's on the last, and never the writer's own (MAJOR 4). Two calls:
    **FETCH** (`writeUp`, no `memories` — or `memories: []` with no fetch on record, m2;
    `memories` is not in the schema's `required`) returns the next unwritten part of the
    ended session's captured words IN THIS PROJECT — what was said to it and what it
    jotted, and (2026-10-01) its own replies, labelled `[its reply]` and each cut to
    `WRITE_UP_REPLY_BYTES` — up to `WRITE_UP_PART_BYTES` (~24 KB), and records it as
    handed to this session (`writeUpFor`, merged into the registry record's raw JSON);
    fetching again before answering hands back the same part, and a session that has
    answered its part is not handed the next (that is a later start's; a GRANTED runner,
    guarantee 17, goes on to the next). **CLAIM-FIRST** (2026-10-01): a fetch claims the
    stretch for the fetching session (`WriteUpProgress.claim`, young for
    `WRITE_UP_CLAIM_MS`); while another session's claim is young, a fetch or an answer
    from here is refused `claimed`, and the SessionStart pointer passes the subject over.
    An ordinary writer lets its claim go when its part comes back. **ANSWER**
    (`writeUp` with `memories`) deposits for the part last fetched; an EMPTY batch is a
    real answer — nothing worth keeping — and closes the part without minting. The last
    part's answer marks the ended session's words here as kept (coverage), then marks it
    written up through B3's seam (`remember/write-up-seam.ts#recordWriteUp`, `by:
    "next-session"`, in this project's scope), which starts its seven-day retention clock
    — unless it still holds unwritten words in ANOTHER project, when this project's share
    waits (`written-up-here`) for that project's writer (MAJOR 6). How it was answered
    (`memories` / `nothing-new`) is recorded on the writing session's record and in the
    progress. It accepts an ended id only when `sessions.ts#writeUpStanding` — the same
    function the SessionStart pointer filters with — says it is no longer at work and
    owes in this project by `core/coverage/`'s rule (2026-09-30), and only for the
    session the hook POINTED this one at (`writeUpPointer`, evidence the model cannot
    write) — or, on the GRANTED path (guarantee 17), one the writing session's own record
    lists.
    Refused, each by name, writing nothing: `handoff-not-accepted`, `unknown-session`,
    `live-session` (this session's own id included), `other-project`,
    `already-written-up`, `owes-nothing` (with `why`: below-threshold, answered, no-text),
    `not-asked` (a fetch it was not pointed at, memories before a fetch), `wrong-part`,
    `part-already-written`, `memories-required` (present and not a list),
    `nothing-landed` (every entry of a non-empty batch refused; a duplicate counts as
    landed), `io-failed` (the fetch could not record the hand-over, so hands nothing),
    `claimed` (another writer holds it now), `allowance-spent` (a granted runner past
    the part its launcher allowed tonight) and `grant-expired` (a nightly runner whose
    record ended, or is older than `WRITE_UP_CLAIM_MS` because its process was killed).
    The claim and the save are one transaction (`sessions.ts#claimWriteUpProgress`, over
    `Store#updateMeta`, `BEGIN IMMEDIATE`), and every write to the progress map re-reads it
    inside its own write (`updateWriteUpProgress`), so two processes writing at once lose
    neither's claim nor `done` (review of #308).
    A mark that did not land is `marked: false`: the session still owes, and the next
    fetch of it — by any session — finishes the mark without depositing (MAJOR 2). This
    file is one of the seam's two importers outside `remember/` (`test/cli.test.ts` pins
    it; the other is the worker's API sweep, which marks `by: "api"`).
17. **[M] Who may write up whose session: `mayWriteUp` on the runner's OWN record**
    (2026-09-30, the binding shape agreed with build 3; desktop-chat design §2). A
    session launched to write up OTHER sessions — build 3's headless catch-up, or a later
    Desktop session writing up a chat that went quiet — carries on its registry record
    the ended sessions it may write up (`sessions.ts#SessionRecord.mayWriteUp`). Only a
    LAUNCHER writes it (`sessions.ts#grantWriteUps`); no tool does, so no model can list
    an id (a `mayWriteUp` argument is ignored). The door's rule, exactly (2026-10-01): the
    subject is listed in the WRITING session's own record, AND it is not at work — the
    ledger's word (#289's evidence: ended, or quiet since the calendar date changed), so
    a crash with no `endedAt` is served — AND `sessions.ts#writeUpStanding` says it is
    owed in a directory it was lived in (the first such, in its own order; no registry
    record needed, and no full-first gate: the launcher chose). Every refusal says why
    (`owes-nothing` with `why`, `live-session` with a detail). On that path `sameScope`
    against this server's scope is skipped, the grant stands in for the SessionStart
    pointer, the memories are filed under the subject's scope (the project where it was
    lived), and the runner is handed the next part once its last came back, up to the
    claim's `upTo` (the launcher's allowance). Everything else is guarantee 16's. Named
    `mayWriteUp` because `writeUpFor` was already the door's per-part mark. The first
    launcher is the nightly run's catch-up (`claude-code/night-catch-up.ts`), whose runner
    is a session id of its own (`writeup-<run>`). **A runner writes up and nothing else**
    (review of #308): a bound session whose record carries a grant, or whose id has the
    runner's prefix (a `session` argument is read the same way), is refused
    `write-up-runner` on every tool but `session_end` WITH `writeUp`, `recall` and
    `status` — no ordinary `session_end`, no handoff, no `note`, no `chapter` — so it can
    never mint first-hand memories in the launcher's directory. Nor is a runner ever served through Desktop's Code-tab path (guarantee 21's `claudeCodeSessionNamed`): an id with the prefix, or a record carrying a grant, is not a Code-tab session there. (A later Desktop session
    given a grant would meet the same gate; that is for the Desktop build to decide.)
18. **[M] Claude Desktop is decided by the CLIENT, and a Claude Code client sees nothing
    new** (2026-09-30). A client whose `clientInfo.name` at `initialize` is `claude-ai`
    or `local-agent-mode-*` (`hosts.ts#hostOfClient`) makes this Desktop's server: its
    place becomes `claude-desktop:` (unless the launch declared `--scope`), its launch
    record is re-filed there, `initialize` adds an `instructions` line and a `prompts`
    capability ("Start with Counterparts"), `tools/list` adds `wake`, and results speak
    Desktop's words (`hosts.ts`). A process whose environment carries Claude Code's
    markers (`CLAUDE_PROJECT_DIR`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` —
    `hosts.ts#claudeCodeEnvMarker`) was started by Claude Code and stays Claude Code's
    whatever its client says (event `mcp.host.kept`): the Code tab's client name was never
    measured, and this makes that not matter. Any other client — Claude Code, Desktop's Code tab off
    the same config entry, an unnamed one — gets the handshake, tools and refusals it
    always got; `wake` is an unknown tool there, and `prompts/*` method-not-found.
    (Measured 2026-10-01: that holds for the Code tab's OWN server, but the counterparts
    tools its model calls are Desktop's server's — guarantee 21.)
19. **[M] Desktop binds PER CALL, and says when it guessed** (2026-09-30). Guarantee 10's
    once-for-the-process bind would file every Desktop chat under the first; one server
    serves them all and the wire carries no conversation id. So each Desktop call binds
    afresh: the `session` it names, when that is a live Desktop session in the registry
    (a live Claude Code session is served as itself instead — guarantee 21; anything else
    is refused by name — `session-unknown`, `session-not-live` — never substituted),
    or, when it names none, the most recent live Desktop session, and the result carries
    `boundTo` / `boundBy: "most-recent"` and a line saying so. With none live, a tool that
    needs a session refuses `session-required` and names `wake`. Every Desktop tool schema
    carries an optional `session` (`tools.ts#DESKTOP_TOOLS`; Claude Code's are untouched),
    so a chat can always name its own. Only a call that NAMED its session refreshes that
    session's record (its liveness — with no hooks, a call is the only sign of life) and
    moves its write-up pacer: after `DESKTOP_ASK_CALLS` such calls AND
    `DESKTOP_ASK_AFTER_MS` since the later of its wake, last `session_end`/`chapter` and
    last ask, the next NAMED result (never a write-up's own) carries `writeUpAsk`. A call
    bound by the fallback touches nothing and never carries an ask — it may be another
    chat's, and the ask would tell chat A to write up chat B (review of #294, finding 1).
    **Observer is read per call** from `claude-desktop:`'s entry, as `off`/`paused` are,
    so the `scope` tool's `observer` takes effect at once (and that tool can still set it
    back); Desktop never inherits the launch directory's `observer` — `bin/serve.ts` bakes
    a registry `observer` into the store only when Claude Code's markers show it started
    the process, and otherwise hands it to the server (`launchObserver`), which applies it
    to every client but Desktop's (review of #294, finding 2).
20. **[M] `wake` is Desktop's session start** (2026-09-30). It mints a fresh session id
    per call and writes that session's record through the shared lifecycle
    (`lifecycle.ts`, host `claude-desktop`), and returns the wake SessionStart composes,
    the clock, today's plain reminders (claimed), the day's dream line only when it is an
    ask (a headless `auto` offer is left unclaimed for Claude Code), the update and doctor
    notices as plain lines, and the write-up pointer measured against
    `TOOL_RESULT_CHARS`; it starts the worker. It never asks the first-launch question,
    never touches primacy, and never starts the headless nightly run. It sits under the
    schema gate like every tool.
21. **[M] Desktop's server serves a Code-tab session that names itself** (2026-10-01).
    Measured: in Desktop's Code tab the `counterparts` tools the model calls are Desktop's
    server (same name, shadowing the session's own). So a Desktop call whose `session`
    names a registry record the HOOKS wrote — host `claude-code`, entrypoint
    `claude-desktop` (the Code tab's only: a terminal session has its own server, and is
    refused `session-not-code-tab`), live by the evidence `requireBoundSession` asks
    (known, not ended, not silent past the TTL; the prompt hook refreshes it) — is served as
    that Claude Code session, for that call only (`server.ts#claudeCodeSessionNamed`,
    `callAs`): its directory is the call's `scope` (its `off`/`paused`/`observer`, and
    the `scope` tool sets it), its id is the call's `session`, and `session_end` /
    `chapter` / `dream` / `reflect` / handoffs take it exactly as Claude Code's own server
    would — its `observer` included: the `scope` tool stands down there, as in Claude Code. It is not a Desktop call: no bind note, no pacer, no `writeUpAsk`, no
    `mcp.desktop.call` (event `mcp.session.served` instead), and words about the place are
    Claude Code's (the reconnect sentence stays Desktop's — the process is Desktop's).
    Only the hooks write such a record, so a model cannot invent one; an ended or stale
    one is `session-not-live`. Cleared in `call`'s `finally` — never sticky, so no other
    chat's call inherits it — and the heartbeat reads the server's own place, never the
    call's. The Code tab's wake states the id (`claude-code/hooks.ts#codeTabSessionLine`,
    entrypoint `claude-desktop`); an unnamed call still falls back to the most recent
    Desktop chat, and its `bindNote` names that chat and tells a Claude Code session to
    pass its own id. A NAMED id that did not bind, on a tool that runs unbound anyway
    (`note`, `recall`, `status`, …), says so on the result: `sessionRefused` (the reason)
    and `sessionNote` (review of #309).

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

- **A session started from a linked checkout — CLOSED 2026-09-17.** If SessionStart
  fired from a linked working copy while the MCP server's cwd was the parent project, the
  two scopes differed and the bind was refused. Both sides now resolve the directory the
  host names for the session — `CLAUDE_PROJECT_DIR`, which the host exports to hooks and
  to stdio MCP servers alike and does not move when the agent enters a worktree
  (`server.ts#hostScope`, `claude-code/bin/hook.ts#sessionScope`) — so they agree by
  construction rather than by both happening to read the same working directory. What
  remains is the honest residual: a host that exports no such variable leaves the two
  sides back on their own working directories, where they agreed by measurement and not
  by rule.
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

## 6b. Settling contradictions at the doors (2026-09-29)

**[M]** `note` and each `session_end` entry take `how` beside `updates` (`changed` by
default, `corrected`, `open`) and answer with what the settle did, or that the target's
own path ran instead. A stored memory comes back with its nearest few live memories
(`neighbours`) and one line inviting a settle — in the payload, so in
`structuredContent`. `note` with `settle` settles two memories that already exist without
writing one; `reflect` phase `settle` is the reflection's door; the dream's `propose`
takes a `settle` action. Every settle is `core/contradictions.ts#settle`'s, recorded with
who, how, why and when; an observer writes nothing and says so.

**[M] A held `updates` answers in the same field** (2026-10-09, the update guard,
`schemas/CONTRACT.md` §5 1b). A `changed` or `corrected` at a memory that looks unrelated
comes back as `settled: {ok: false, held: true, reason: "looks-unrelated", how, holds,
over, title, text, detail}` — the old memory's own title and text (none for a
confidential one outside the owner's session), the two ids to settle with, and
`HELD_HINT`, the neighbours' ask said for this case. The held memory is not listed again
among the neighbours. Nothing else about the reply changes: the memory is stored.

## 6c. Re-feeling while awake (2026-10-02, lane B)

**[M]** `note` takes `feelingsNow`: how memories this session was shown feel now, recorded
beside the first feeling (which is never rewritten), with or without `text`. One not shown
here — not delivered by `recall`, not a write's neighbour, not surfaced (a footnote is not)
by ambient recall for the session; kept per session — is refused with the way in (recall it by id). At most once a calendar day per
memory, five a call; source `awake`, `recorded_later` today. The path and the rest of its
guarantees are the reflection's (`dream/reflect.ts#Reflections.feelAgain`).

## 6d. The writer's three fields (2026-10-03, schema v12)

**[M]** `note` and each `session_end` entry (write-ups included) take `occurredOn` (when
it happened: a day, month, range or year, read by `time.ts`), `saidBy` (owner, self,
inferred) and `status` (done, planned, proposed, asked), all optional. **[M]** None of them
refuses a memory: one that cannot be read is dropped and said in the answer's `facts`, with
what to send instead (`server.ts#readWriteFacts`). **[M]** A revision by `updates` carries
each over from the memory it revises unless one is sent (null: none); nothing moves off the
old memory (`counterpart.ts#carryFacts`). **[A]** The descriptions ask the writer to
resolve "last week" to a date at write time and keep `occurredOn` (when it happened) apart
from `eventDate` (a future date to be reminded on). Facts mode reads them (§6f).

## 6e. Meaning mode (2026-10-03, Release B of deliberate recall)

`recall` with `mode: "meaning"` arranges what memory holds about a subject over time;
the reader interprets (`meaning.ts`). Working defaults, held lightly; the revisit checks
them.

- **[M]** The subject is read from the question: the cards its names reach
  (`Schemas#subjectsIn` → `memory_subjects`), the one it is about the arc and the rest
  one-liners (`meaning.ts#subjectOf`, 2026-10-09). A name the words before it ask about
  ("what has X been", "how has X changed", "about X", "my arc with X") ranks over a plain
  mention, and that over an aside ("been to Y", "since Y", "after Y"); a name joined to the one
  before it ("X and Y") shares its place; a name typed in lower case that its card
  capitalises ("will" for Will) is a step under the same place typed as written; the
  owner's own card leaves a place it shares; then the first named wins, memory counts
  only break a tie, and the answer says when more than one were asked about alike. The
  owner's "I" ("you" in the counterpart's voice) asked about is his card, except in a
  question about feeling or about "us" — and under any card named outside an aside:
  "what have I done on Driftwood" is Driftwood's, "how have I been since Driftwood" his.
  "us" (the words *us*, *ourselves*, *together*) is the memories marked
  `about: us`; a ranked question about feeling (`feeling-ask.ts`) with no card is the
  stamps that match it by word, core and whose — narrowed, when it names a topic no card
  holds, to the stamped moments the topic's words reach (none reached: all of them, and
  the answer says no card names the topic); with none of those, the question's rarer
  words and its meaning, and the answer says no card named it. A word the asker
  capitalised mid-sentence is a topic word whatever it is ("Will"), matched as typed.
- **[M]** The arc is the chapters (`epi_…#N`) that hold the subject — its memories
  written in a chapter's span, and the chapter's own words naming it — ranked by how much
  they hold and shown in time order, 8 to a page (`page`); moments a session wrote with no
  chapter, or under none of its chapters (their moments unknown, from before v12, or a
  later write-up), are an entry per session, labelled which. A long arc keeps its start, its end and
  its turns (the feelings' valence changing sign) on page 1; what is not on the page folds
  to one line per stretch.
- **[M]** Feelings are shown per entry with whose they are, the asker's and the other's
  side by side, never merged.
- **[M]** Faded moments (kept a fifth of their strength or less, `deliberate.ts#hasFaded`)
  are a few labelled lines after the arc, not in its slots. Readings (dream gists,
  reflection entries) that name the subject or cite its memories are listed dated; the
  dream journal stays outside. Open threads and reminders dated today or later are listed.
  Recurring subjects and feelings are laid side by side, unnamed.
- **[M]** A search writes nothing. `shown` is exactly the ids printed, for the seen set
  and quote credit. Confidential material is left out of a non-owner's answer silently.
  The rendered answer stays inside the 12,000-character list room (`fit`).
- **[A]** "us" is not triggered by *we* or *our*, which a question uses for joint work.
  A chapter address names a chapter, and `ids` / `handle` open it (§6f).

## 6f. Facts mode, and the recall tool's two modes (2026-10-03, Release B)

Working defaults, held lightly; the revisit (a few days of daily use) checks them.

- **[M]** A `question` needs `mode`: `facts` or `meaning`, no default (`mode-required`,
  `mode-unknown`, each naming both modes). `ids` and `handle` take none: a `mode` beside
  one is ignored and the result says so (`modeIgnored`). Each mode is its own path with
  its own ranking; the answer is its rendering, shipped as `answer`, with the `ids` it
  showed. Those ids feed the seen set (`note.feelingsNow`) and the `asked` records, so
  quoting their words credits at the boundary (`counterpart.ts#creditReferences`).
- **[M]** Facts mode (`facts.ts`) pools every memory the question's content words reach
  (each word's every hit, weighted by rarity), every memory linked to a card it names
  (`memory_subjects`), and the 100 nearest by meaning above this embedder's inline floor;
  a question that is only a time pools its window. Score is the sum over the ways matched;
  recency breaks ties only; the order is stable and pages by 10 (`page`).
- **[M]** A time in the question (`recall/time-ask.ts`) filters, by `occurred_on` or, with
  none, the learned date (the line says which); weeks and months stretch two days each
  side, "N days ago" one, dates stay exact; matches outside are counted as distinct facts,
  after the same folds and without the weak tail. "Around the X"
  resolves X to the date of its best word match, shown in the header; "the last session"
  is the session "Last here" names (else the newest here), whose rows lead.
- **[M]** Rebuilt here, not inherited from ambient: a chapter and its copy are one result
  (the chapter, labeled journal); near-duplicates (token overlap ≥ 0.85) are left out and
  counted; the self page and handoffs are never results; confidential rows are absent for
  a non-owner, silently (counted on the durable row only).
- **[M]** Each result: title and id; `you said / I said / inferred · status · happened <date>
  | no event date`; `learned <date> in <dir> · <who> · CURRENT`; earlier versions folded
  (in-place `versions`, and `changed` pairs — an earlier one that matched brings its
  current one in); corrected ones hidden and counted; `open` and unsettled pairs named —
  never naming a confidential or removed memory to a non-owner.
  Unknown fields say so. Short bodies whole, long ones a 300-character excerpt.
- **[M]** The header counts distinct facts; "may not be everything" only when the meaning
  cap cut or weak matches (below a fifth of the best score) were left out. Faded matches
  (kept a fifth of their strength or less — `deliberate.ts#hasFaded`, the rule meaning
  mode shares) are title lines after the results, never in the main slots. The whole
  answer stays under 12,000 characters.
- **[M]** `ids` / `handle` read a chapter address `epi_…#N` as that chapter
  (`self/chapter-address.ts#resolveChapter`): its words, `address`, and its `moments`.
- **Deleted promises (Mike, 10-03):** "effort lowers the bar but never removes the hard
  gates: a memory the conversation did not reach stays dark"; "the lower-confidence tier is
  labeled"; "a question about time is answered with the session it means first, marked
  `recent: true`" (replaced by the time filter and the session anchor); "a question about
  feeling is answered from the feelings recorded on memories" (meaning mode's now);
  "considered is reported beside `consideredCap`" (the count header replaces it).

## 7. Open questions

1. **Does `note` still need to exist** once the experiencer writes at every session end?
   Its job is the in-the-moment mark, which the jot channel also serves. Two doors to the
   same room is how v1 ended up with a self-store nobody called.
2. **What does `status` show?** v1's answer grew into a dashboard. The useful minimum is
   probably the symmetry counters (created versus exited per kind, up-moves versus
   down-moves) — the numbers that made v1's pathologies visible — not a store census.
3. ~~**Should `recall` expose the confidence label as a tier name or a number?**~~
   **Moot 2026-10-03:** the tiers are retired; a facts result says how it matched (its
   ways) and the header says when the tail was weak (§6f).
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
   **ANSWERED 2026-09-25/26:** a stated intensity. `note` and `session_end` take
   `feelings` (schema v7), each with its own `strength`; since emotion part A the
   strongest of those and `emotional` is the memory's intensity, which lifts its height
   and slows its decay (physics §5.10), and a recent one sets the mood recall matches
   (recall G18). A lone `emotional` score was already kept on the row by `mint.ts`; the
   battery now reads it the same way (`bridge.ts#dimensionsFrom` pads a missing
   dimension with 0 instead of dropping all three). The stated-emotion gate still
   supplies no number, and still must not.
   *Trait nudges (2026-09-27)* ride the same two doors and `reflect finish` as a
   separate field, `traits`, on a fixed seven-axis vocabulary. They are display only:
   nothing the doors write there changes salience, decay, recall or the core.
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
