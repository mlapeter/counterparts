# `adapters/mcp/` — INTERFACE-GAPS

*What this adapter needed from a module it may not edit, and what building it
found. Filed rather than hacked around; each entry says what exists today, what
the honest fix is, and where the proof lives. Written 2026-08-25 alongside
`test/mcp.test.ts`.*

---

## 1. `recall/` has no deliberate mode — the tiering lives here

**What exists.** `Recall.build()` is the pure half of the ambient path and is
public precisely so it can be reused ("a private half is a promise, not a seam",
`recall/index.ts`). It returns every candidate's verdict, so the information a
deeper look needs is all there.

**What is missing.** There is no `Recall.deliberate()`, and no per-call tunable
override — `RecallTunables` is fixed per instance. So "deliberate recall is a
deeper effort with different thresholds" (CONTRACT §3, [v1] §9.1 G2) is
implemented in `deliberate.ts` by RE-TIERING build's verdicts rather than by
running the gate at a different bar: soft verdicts (`below-bar`,
`below-strong-floor`, `capped`, `dedup-suppressed`, `cue-only-temporal`,
`cold-start-undiscriminating`) are
admitted at a labeled `dim` tier; hard gates (`dark-uncued`, `below-floor`,
`cue-fraction`) are not.

**Why that is defensible, not just convenient.** The hard/soft split is already
`recall/`'s own vocabulary, and re-tiering cannot admit anything the activation
pass did not score — which is the property that keeps expansion from degrading
into search. What it CANNOT do is change the candidate SET: a lower bar with the
same `MAX_CANDIDATES` is a lower bar over the same shortlist.

**The honest fix.** `Recall.build(turn, { tunables })` — a per-call override so a
deliberate ask can raise `MAX_CANDIDATES` and lower `FLOOR_GLOBAL_UNITS` on its own
terms. One optional argument, no new module.

## 2. Confidentiality is a prose-`meta` convention with one reader

`isConfidential(doc)` reads `meta.confidential` / `meta.confidentiality` and is
exported from `recall/activate.ts`. Nothing WRITES those fields: no tool, no
gate, no boundary sets them, so today a memory becomes confidential only if
something outside this package puts the key in the prose. The withholding
machinery is real and tested on both paths (stated for a lookup, silent in a
list) — the classifier is missing. Owner call: is confidentiality declared by
the experiencer at deposit, inferred by a gate, or set only by the owner from
the console? Until it is decided, the guarantee is enforceable but unreachable.

## 3. The entrance table (claude-code/INTERFACE-GAPS §4), extended

`claude-code/INTERFACE-GAPS.md` §4 asks the next adapter to extend the
gate-coverage enumeration. Both new entrances go through `Counterpart`, so they
inherit the wiring rather than adding to it:

| entrance | gate | wired at |
|---|---|---|
| `note` tool | `bridge.batteryGate()` (per proposal) | `Counterpart.submitJot` → `deposit()` |
| `session_end` tool | `bridge.batteryGate()` (per proposal) | `Counterpart.submitSessionEnd` → `deposit()` |
| `session_end`'s `handoff` field | `episodeGate()` at the seam (2026-09-20, E1) | `Counterpart.writeHandoff` → `Handoffs.write` |
| `chapter` tool | `episodeGate()` at the seam, then `self/`'s own on the same text | `Counterpart.appendEpisode` → `Self.appendChapter` |
| `recall` tool | n/a — reads only, asserted byte-identical | `test/mcp.test.ts` |
| `status` tool | n/a — reads only, asserted byte-identical | `test/mcp.test.ts` |

**Nothing new is unguarded.** The proof is the same shape as the claude-code
totality test: a credential submitted through `note` is redacted, and one that is
nothing but a credential is refused as `empty-after-redaction`. The journal is on
the table for the reason the caller-universality test found it in the first place:
a chapter is canonical prose, so it is an ingestion entrance, and a credential
written into one landed durably before that gate existed.

## 4. `note`'s span linkage depends on a hash the buffer returns positionally

`Counterpart.captureJot` returns a `CaptureResult`, and the jot's own span is
`result.spans[0]`. `submitJot({ ownSpanHash })` then withholds it from the sweep.
That linkage is load-bearing — without it a deliberate note costs two memories,
one from the tool and one from the crash fallback re-reading the jot — and it is
expressed as "index zero of an array". `SpanBuffer.jot` could return the span (or
its hash) as a named field instead. Proof it works today:
`test/mcp.test.ts` — "the note's own words ride the buffer as a span the deposit
claims".

## 5. `status` reports a census, and CONTRACT §7 OQ2 wanted counters

OQ2: "what does `status` show? The useful minimum is probably the symmetry
counters — created versus exited per kind — not a store census." Shipped: BOTH.
The census is small and the counters ride inside it as `symmetry`. If the census
half turns out to be noise in real use, deleting it is a two-line change and the
counters stay. Recorded so the choice is visible rather than assumed settled.

## 6. Deliberate recall has no session of its own — NARROWED, not closed

`build()` needs a `sessionId` and uses it to load per-session gate state (for
dedup). A server launched without a session uses the literal `"mcp"`, which means
two unbound servers share one gate-state row. It affects the `dedup-suppressed`
verdict only — and deliberate recall admits that verdict anyway — so the blast
radius is nil today. It would stop being nil the moment anything else keys off
that row.

**What the lazy bind changed (2026-09-04).** `this.session` is now a getter over
launch state *plus* the bind, so the moment a `session_end` claim is corroborated
against `adapters/sessions.ts`'s registry, `recall` and `note` on that server stop
using `"mcp"` and use the real session id. On this host that happens at the first
end-of-session dump — so the shared row is now the state of a server *before* its
first dump, rather than for its whole life.

**What is still open, and it is the same gap.** A server that never receives a
dump never binds, so its recalls still share `"mcp"`. Nothing keys off that row
but dedup, so the blast radius is unchanged; the honest fix is also unchanged —
`recall` has no session of its own and is borrowing one, and a per-call gate-state
key (or an explicitly session-free deliberate mode) is what would end the
borrowing rather than narrowing it.

## 7. `openServer` has no embedder socket — a memory noted through the tool gets no vector — CLOSED 2026-09-23 (#190)

**Closed by #190 (roadmap C1), option 1 below.** `OpenServerOptions` carries `embed?:
Embedder` (a CORE type — no cross-adapter import), taken from the live embedder the entry
point opened when not passed separately (`index.ts#embedOf`), and `bin/serve.ts` opens that
embedder from the configuration it reads (`questionEmbedder` → `openEmbedder`). A memory
noted through `note` or `session_end` gets its vector at write time in the server's own
process — for the static tier with no key and no network, so the semantic channel is never
dark waiting for the worker, which still backfills anything missing. The paid seat is wired
the same way and is frozen (ROADMAP §"Amendments"). The text below is the gap as filed.

The launch adapter now builds a Voyage client (`adapters/claude-code/embed-client.ts`)
and passes both halves — the sync `Embedder` the store indexes with, and the live
one the novelty seam uses — into `Counterpart.open`. `openServer` does not, and
deliberately: it takes `OpenServerOptions`, not an `AdapterConfig`, so it has no
egress knob and no seat to read, and importing the claude-code client here would
point one adapter at another (CONTRACT §5 G1 in spirit — adapters are leaves).

**What it costs today.** A memory deposited through `note` is stored, indexed
lexically, and left without a vector: `novelty` is null with reason
`no-chunk-vector`, and box 3 holds no row for it until something rebuilds the
cache with an embedder wired. The recall gate's semantic channel cannot see it.

**The honest fix,** whichever the owner prefers:

1. `OpenServerOptions` gains `embed?: Embedder` and `vectors?: LiveVectors` —
   both CORE types, no cross-adapter import — and whoever launches the server
   (`bin/serve.ts`, or a host that already built one) passes them in. Two lines
   here, and the decision about egress stays with the caller who holds the
   configuration.
2. Or the embedder moves out of `adapters/claude-code/` into a place both
   adapters may import, at which point the egress knob needs a home that is not
   one host's config file.

Filed rather than built: a socket wired to nothing that ever fills it is the
"starved front door" shape this repo keeps finding, and the choice between (1)
and (2) is the owner's, not this build's.

## 8. The session id has to travel through the MODEL, and that is the host's shape

**What exists.** `session_end` and `chapter` are bound to one session — the same bind,
one code path — and `bin/serve.ts` accepts `--session` / `COUNTERPARTS_SESSION` so a
host can say which at launch.

**What is missing.** This host cannot. Claude Code registers MCP servers from a
static configuration — command, args, env — with no per-session substitution, and
`lsof` on four running servers (2026-09-04) shows the only per-session fact the
process carries is its working directory, which identifies the PROJECT and not the
session. So the id can only reach the server through the one channel that is
per-session by construction: the model, carrying what the hook's ask told it.

**Why that is a real seam and not a hole.** The model supplies the id; it does not
supply the AUTHORITY. `adapters/sessions.ts`'s registry is written only by hooks,
under the data dir, and a claim is honored only if the registry already holds that
id, live, in this server's scope. The model can therefore name a session it was
told about and nothing else — and on this host it is told about exactly one.

**The honest fix, if the host ever offers one.** A per-session environment
variable, or an MCP launch the host parameterizes per session, would restore the
`--session` path and make the registry unnecessary for binding. The registry would
still earn its place as the liveness fact (`session-not-live`), which no launch
argument can carry.

## 9. An expansion BY TITLE earned no credit — CLOSED 2026-09-15 (LAUNCH-STATUS G50)

**The gap.** `recall/reference.ts` decides which memories a session actually USED, and
its expansion door reads the recall tool call's own input — where it credits literal
`mem_…` addresses and *resolves nothing*, on purpose: "this module resolves nothing
fuzzily, and the tool's own answer was already exact or not-found." But `tools.ts`
documents `handle` as "a memory id or exact handle" and `deliberate.ts#expandHandle`
answers an exact TITLE with the whole body. So a session that named a memory and read it
— the most deliberate thing this surface offers — left a boundary row reading
`expanded: 0, unresolvedHandles: 1` and credited nothing. Under-credit, and silent.

**Closed on the tool side, where the resolution happened.** `server.ts#noteHandleResolution`
writes `<salted hash of the handle> → <resolved id>` to `adapters/expansions.ts`'s log, and
`claude-code/hooks.ts#creditAtBoundary` translates the transcript's own handle with it
before `creditReferences` sees the slice. `reference.ts` is unchanged and still resolves
nothing; it is simply handed the address the tool reached.

**Why a log and not a per-session field.** There is no "expanded ids" state the credit
pass reads — expansions come from the TRANSCRIPT, sliced by the same turn cursor capture
uses. Keeping that is what keeps the fix narrow: the transcript decides which handles and
when, the log only says what each resolved to. A per-session list would fail twice over —
this server is usually unbound (§6, §8) and has no session id to key by, and a flat list
cannot be positioned against the turn cursor, so one expansion would be re-credited at
every later boundary.

**What is recorded, and why the refusals are recorded too.** Every handle-path outcome
leaves a line: an expansion leaves the id it reached, and `handle-unknown`,
`handle-ambiguous` and `handle-confidential-withheld` each leave `null` — a SHADOW, which
translates nothing and, being the newest answer, overrides an earlier resolution of the
same handle in the same project.

The shadow is §5 G6, not tidiness. The log is keyed by the HANDLE, because resolution is
deterministic — one store, one exact-title match. A REFUSAL is not: the owner's own
session resolves a confidential title and a stranger's session asking the same title is
told nothing. Recording only the expansions leaves the stranger's boundary translating its
handle through the owner's entry and crediting a memory it was never shown — and the first
draft of this fix did exactly that, until a test was written against it. Same shape for a
title that has since gone ambiguous or been renamed away.

**"Credit is not widened" was the claim after that fix, and it was still wrong** (review,
2026-09-15). A shadow only exists where an ANSWER was given, and three askings get no
answer at all:

1. the tool call never reached `expandHandle` — the server was down, or threw before the
   resolver ran. Nothing is refused, so nothing is recorded;
2. the call was `recall { handle, question }`, refused by the dispatcher as
   `both-arguments` on path `none`, before the handle path exists;
3. the call WAS refused `handle-confidential-withheld`, and the shadow could not be
   written — a read-only log, a full disk. `recordHandleResolution` returns false, because
   it may not throw at a tool.

Each still leaves the title in the transcript, so each still reaches a boundary looking for
a translation, and finds the only line in the log — the owner's. Recording the session id
instead would not help: `recallTool` runs under `this.session ?? "mcp"` and the bind only
happens on `note` / `chapter` / `session_end`, so the usual recall call has no session to
record.

**Two filters, and what is left after them.** Every line already carried the `scope` the
resolving server was serving, so `readHandleResolutions` now DROPS any record whose
canonical scope is not the asking boundary's (`sessions.ts#canonicalScope`, the same
comparison `requireBoundSession` already trusts; a line with no scope is dropped too). That
covers all three routes at once, and it retires the opposite race the previous draft
accepted — the stranger's shadow carries the stranger's scope and never reaches the owner's
boundary.

The second filter is temporal, because a project is a PLACE and not a conversation: one
directory's table holds Monday's session and Tuesday's. `creditAtBoundary` reads the asking
session's `startedAt` from the live-session registry and translates only records stamped at
or after it, so last week's resolution of a title cannot answer today's typed guess.

The RESIDUAL, stated rather than hidden: two sessions running CONCURRENTLY in the same
project directory share one table, so within the overlap a call that never reached
`expandHandle` can still be translated through a resolution the other one made. And a
session whose first hook event is the Stop itself has no registry record when the credit
pass runs (`claim()` precedes `noteSession("boundary")`), so it gets no floor at all.

**The row says why, not just how many.** `readHandleResolutions` returns
`{ map, ok, reason }` the way `claude-code/transcript.ts#readTranscript` does, and the
`recall.credit` row carries the reason as `expansionsRead` — `ok`, `absent`, `unreadable`,
`corrupt`, or `not-read` when the slice had nothing to translate and the file was never
opened. `resolvedHandles: 0` on its own could not tell a dead table from an idle one, which
is the failure shape I32 is named for.

Proof: `test/lifecycle.test.ts` "the handle door (G50)" — the positive, the unknown handle,
the ambiguous handle, and the confidential shadow — "the handle door, across projects
(G50 review)" for the three shadowless routes and the retired race, and "the handle door,
before this session started (G50 review)" for the floor, plus `test/sessions.test.ts` "the
handle-resolution log" for the file's own rules.

**What the tool DESCRIPTION still owes, and it is an owner call.** `tools.ts`'s `recall`
privilege still reads "It writes nothing and trains nothing: ranking is not recording, so
nothing you look at here gets stronger for having been looked at." The first half stays
true — `build()` is pure, no `resolveUse`, no `coactivate`, and the one write is host
state. The last clause has been false since the credit seam landed (#99, 2026-09-14): a
memory the session EXPANDS is credited at the boundary, by id then and by handle now. It is
left alone here on purpose, because correcting it is not a wording change: telling the
model that expanding strengthens a memory hands it a lever on the reinforcement signal it
is being measured by, and whether the description says so is the owner's ruling, not this
branch's. `CONTRACT.md` §3 now carries the accurate sentence for readers of this repo.

**What it still owes.** The `ids` path is untouched: a literal id that has been SUPERSEDED
still credits nothing, because `Store.resolve` follows the forwarding address inside
`expandHandle` while `reference.ts` sees only the id the model typed, and the boundary
then refuses the archived row. It is the same gap one level down and out of G50's scope;
`expandIds` already pairs `perId` with `memories`, so recording per-id resolutions there is
a small, separate change when someone wants it.

## 10. The update notice needs `claude-code/bin/hook.ts` to print it — CLOSED 2026-09-23

**What was missing.** Roadmap E's notice is decided by
`adapters/sessions.ts#decideUpdateNotice` and marked by `#markUpdateNoticeShown`, reached
through `ClaudeCodeAdapter#updateNotice` / `#markUpdateNotice`. The one channel the owner's
terminal shows is a top-level `systemMessage` in the hook's JSON stdout, and `bin/hook.ts`
built that envelope for `session-start` only. That file was outside this build's first
ownership, so the notice was filed here rather than printed.

**Closed the same day, on the coordinator's word.** `bin/hook.ts#main` asks the adapter at
`user-prompt-submit` and marks only once the envelope is known to carry the line (shown only
if the mark landed); `hostDelivery` builds the envelope for `user-prompt-submit`
(`hookEventName: "UserPromptSubmit"`, the recall as `additionalContext`, the systemMessage
alone when there is no recall) under SessionStart's size rule. Proof:
`test/schema-gate.test.ts` "hostDelivery at a prompt" and `test/hook-standdown.test.ts` "a
stale MCP server in this directory". `test/doctor.test.ts`'s "user-prompt-submit NEVER emits
JSON" was narrowed to what stays true: never without a notice, and never the doctor's.

**Also filed from this build, for the modules that own them.**

- **Closed 2026-09-24** — `store/cache.ts#openCache` now leaves a cache from a newer build
  as found (`cacheAhead`, #190).

  **`store/cache.ts#openCache` stamps an AHEAD cache backwards.** It re-runs the DDL and
  rewrites `cache_meta.schemaVersion` whenever the stamp DIFFERS, so a build opening a cache
  a newer build wrote writes the older number over it instead of refusing, the way
  `operational.ts` refuses `SCHEMA_AHEAD`. Not this server's hole (it never reopens) — a
  downgrade's. The fix is the same `> CACHE_SCHEMA_VERSION` refusal box 2 has, or a
  deliberate "box 3 is rebuildable, reset it" if that is the ruling.
- **`cli/start-fresh.ts#readLiveness` cannot see an idle MCP server.** It counts a session
  record as a sign of an open session only while its `lastBoundaryAt` is recent, and it
  skips `sessions/mcp-server@*.json` (no `lastBoundaryAt`). A believed server record
  (`sessions.ts#serverBelieved`: pid running, heartbeat fresh) is the one sign of an open
  session that stays true while it is idle — and the one `start-fresh` most needs, because
  renaming the store leaves that server writing into the parked store with a gate that
  passes (NOTES, residuals). The record WILL be there to read: the server's heartbeat
  writes it again in the fresh store's `sessions/` within a minute. Reading those records
  there is the console's change.
- **No snapshot precedes a migration** (NOTES, 2026-09-23): the first open on a new build
  migrates, and that is a hook, while the automatic snapshot runs only in the worker, after
  its own open, once a day. If a pre-migration copy is wanted, the place is the writer path
  of `openOperational`, just before the migrate transaction — a store decision, not this
  adapter's.
