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

## 7. `openServer` has no embedder socket — a memory noted through the tool gets no vector

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
writes `<hashed handle> → <resolved id>` to `adapters/expansions.ts`'s log, and
`claude-code/hooks.ts#creditAtBoundary` translates the transcript's own handle with it
before `creditReferences` sees the slice. `reference.ts` is unchanged and still resolves
nothing; it is simply handed the address the tool reached.

**Why a log and not a per-session field.** There is no "expanded ids" state the credit
pass reads — expansions come from the TRANSCRIPT, sliced by the same turn cursor capture
uses. Keeping that is what keeps the fix narrow: the transcript decides which handles and
when, the log only says what each resolved to, so nothing the session did not expand is
credited. A per-session list would fail twice over — this server is usually unbound (§6,
§8) and has no session id to key by, and a flat list cannot be positioned against the turn
cursor, so one expansion would be re-credited at every later boundary.

**What is recorded, and what deliberately is not.** Only `path: "handle"` with
`reason: "expanded"` and exactly one memory, and only when the handle was not already the
live address. `handle-unknown` resolved nothing, `handle-ambiguous` named the choice
without making it, and `handle-confidential-withheld` showed the asker nothing — all three
leave no translation, so all three go on crediting nothing. Proof:
`test/lifecycle.test.ts` "the handle door (G50)" (the positive plus both negatives) and
`test/sessions.test.ts` "the handle-resolution log".

**What it still owes.** The `ids` path is untouched: a literal id that has been SUPERSEDED
still credits nothing, because `Store.resolve` follows the forwarding address inside
`expandHandle` while `reference.ts` sees only the id the model typed, and the boundary
then refuses the archived row. It is the same gap one level down and out of G50's scope;
`expandIds` already pairs `perId` with `memories`, so recording per-id resolutions there is
a small, separate change when someone wants it.
