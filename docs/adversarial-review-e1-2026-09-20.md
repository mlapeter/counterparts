# Adversarial review — E1, the per-directory handoff pointer (PR #151)

**Reviewer:** adversarial reviewer session, 2026-09-20.
**Target:** `origin/everyday/e1-handoff-pointer` @ `c908398`, against `origin/master` @ `40f92ae`.
**Brief:** break it. Review and prove; do not fix, commit, push, merge or deploy.

---

## Verdict

**MERGE AFTER FIXES.**

No BLOCKER. The load-bearing claims hold under attack: byte-identity with no handoff is real
and I widened the builder's proof from 35 compositions to 2,824 with the same `diff` exit 0;
the row never becomes memory or identity on any path I could find; the pointer cannot put the
bundle over the host's ceiling at any budget; expiry is correct at the boundary, across a
calendar gap and after a supersede; the write door refuses what it says it refuses; session
binding is enforced before the handoff is written; `off` and `paused` refuse the whole call.

Three MAJORs, all of them mismatches between what the module's CONTRACT asserts and what the
code does. Two are one-sentence documentation fixes plus a small behavioural correction; the
third belongs to `schemas/`, not to this PR, but E1 is what makes it reachable by accident.

- **MAJOR-1** — `handoff/CONTRACT.md` §6 states the *opposite* of the mechanism. The reserve is
  exactly what causes a trim, it is store-wide, and it is paid by directories that will never
  see a pointer.
- **MAJOR-2** — Guarantee 3 ("every refusal is named and durable") is false on the only live
  door for two refusal shapes: the MCP `no-scope` short-circuit, and an empty / non-string
  `handoff` field, which is total silence.
- **MAJOR-3** — A handoff row whose prose file is missing or blanked stands the whole session
  down at `Counterpart.open`. That is a **confirmation of review s1c's MAJOR-1 with a new row
  class, not a new finding against E1** — the fix belongs to `schemas/` — but E1 is what
  multiplies the rows it can happen to.

9 MINOR, 5 NIT below.

---

## BLOCKER

None.

---

## MAJOR

### MAJOR-1 — `CONTRACT.md` §6 says the reserve "never causes a trim". It is the only thing that does, and other directories pay for it

**What is wrong.** `handoff/CONTRACT.md` §6 reads:

> **the pointer gives up its bytes before any lane element does.** Its room is reserved before
> the lanes compose, so it never causes a trim; and if the ceiling at delivery cannot hold it,
> the pointer is dropped whole while every lane element stays. A fortnight of working context
> is worth less than a memory.

There is a charitable reading of "never causes a trim" — that the *splice* does not re-enter the
trim loop — and on that reading it is true. But the sentence sits inside a paragraph about *who
gives up bytes*, and on that question it is the reverse of the mechanism.
`Counterpart.wakeReserveBytes()` subtracts
`HANDOFF_RESERVE_BYTES` (448) from the compose budget, so the trim loop runs against a smaller
ceiling and pops lane elements *to make room for the pointer*. A memory is dropped so that a
handoff can be shown — which is the priority §6 says is impossible. Two further facts §6 and
the PR body do not state:

1. **The reserve is store-wide, the pointer is per-directory.** `anyLive()` asks whether *any*
   directory holds a live handoff. A handoff written in project A shrinks the wake composed for
   *every* session in *every* directory of that store. A session in project B pays 448 bytes of
   its identity lane and is handed nothing in return.
2. **The reserve over-reserves.** 448 is sized for the widest possible block; a real pointer is
   ~250–300 bytes, so when a pointer *is* shown the delivered bundle sits well under the
   ceiling it just spent memories to clear.

**What I ran.**

```
$ TREE=<worktree> bun probe.ts      # P2: two identical 40-element stores; B has a handoff
                                    # for a THIRD directory; both wake in a fourth directory
budget=1200  no-handoff:        elements=6  bytes=963  composeBudget=1040 wake=1069
budget=1200  handoff-elsewhere: elements=2  bytes=527  composeBudget=592  wake=631  pointerShown=false
budget=1200  DELTA elements=-4
budget=2000  no-handoff:        elements=13 bytes=1734 composeBudget=1840 wake=1838
budget=2000  handoff-elsewhere: elements=9  bytes=1292 composeBudget=1392 wake=1396 pointerShown=false
budget=2000  DELTA elements=-4
budget=3000  no-handoff:        elements=23 bytes=2834 composeBudget=2840 wake=2938
budget=3000  handoff-elsewhere: elements=18 bytes=2284 composeBudget=2392 wake=2388 pointerShown=false
budget=3000  DELTA elements=-5
```

And the over-reservation, in the directory that *does* get the pointer (P10, budget 2,000,
40 identity elements):

```
boundary with no handoff:      elements=16 bytes=1792
after the next boundary:       elements=11 bytes=1337 wake=1705 pointer=true over=false
```

Eleven elements instead of sixteen, and the delivered wake finishes 295 bytes under the
ceiling. Five memories bought two lines and 295 bytes of unused headroom.

**Blast radius today, stated honestly.** At the budget the parallel run actually uses
(`injectionBudgetBytes: 9000`, `docs/PARALLEL-RUN-STATUS.md:559`) the lane caps bind before the
byte ceiling does, so the reserve currently costs nothing:

```
$ bun probe4.ts     # 400-memory store, identical but for a handoff in another directory
budget=4096 … 20000: this session loses 0 memories and gains nothing
```

The cost appears once the ceiling is the binding constraint — measured from budget ~3,000 down.
So this is a correctness-of-the-record problem now and a real cost the day anyone lowers the
budget or the store grows past the lane caps.

**Smallest fix.** Rewrite §6 to say what happens: *the pointer's room is reserved out of the
compose budget whenever any directory in the store holds a live handoff, so lane elements are
trimmed to make room for it — store-wide, including for sessions in directories that will not
be shown a pointer. At delivery a bundle that would still exceed the ceiling drops the pointer
whole.* Then decide whether that priority is the one the owner wants; if it is not, the
mechanism (not the sentence) has to change. Consider also sizing the reserve to the block that
actually exists (`pointerBlock(...).length`, per store, at the boundary) rather than to the
widest one that could — the boundary already knows which handoffs are live.

---

### MAJOR-2 — two refusal shapes leave no durable row, against guarantee 3

**What is wrong.** `handoff/CONTRACT.md` §5 guarantee 3 says every refusal is "named and durable
— except under observer". Two shapes are neither, and both are on the *only* live write door.

1. **`no-scope` through the MCP server.** `server.ts#writeHandoffField` short-circuits before
   `Handoffs.write` is ever called (`server.ts:1078`), emitting the ring-only
   `mcp.handoff.refused`. `Handoffs.write`'s own durable `no-scope` refusal is unreachable from
   this door.
2. **An empty / whitespace / non-string `handoff` field.** `writeHandoffField` returns `null`
   for anything that is not a non-blank string, so the result object carries no `handoff` key
   at all and nothing is written. The declared `HandoffRefusal` value `"empty"` cannot be
   produced by any live caller. A session that sets `handoff: "   "` — the shape a model reaches
   for when it means "retire the stale pointer", which open question 3 says is the one thing it
   must not do — gets complete silence, and the stale pointer stands.

**What I ran.**

```
$ bun probe2.ts    # A3: a server whose scope IS the store's own directory
scopeSource=flag scope=(the store's own dir)
result={"session":"…","entries":1,"deposited":1,"refused":0,
        "outcomes":[…],"handoff":{"written":false,"reason":"no-scope"}}
durable rows named handoff.*: []
handoff rows: []
```

```
$ bun probe3.ts    # the field's odd values, through the real MCP door
good memories, empty handoff:      {"session":"…","deposited":1,…}      # no `handoff` key at all
   handoff rows=0 durable=[]
good memories, non-string handoff: {"session":"…","deposited":1,…}
   handoff rows=0 durable=[]
good memories, over-size handoff:  {…,"handoff":{"written":false,"reason":"too-large","bytes":3000}}
   handoff rows=1… durable=["handoff.refused"]                          # this one is correct
```

**Smallest fix.** In `writeHandoffField`, append the `handoff.refused` row on the `no-scope`
branch (or route it through `Handoffs.write` with the empty scope, which already does it), and
return `{ written: false, reason: "empty" }` — with its durable row — for a present-but-blank
field instead of `null`. An absent field stays silent; that is the ordinary case and is right.

---

### MAJOR-3 — a handoff row whose prose is gone stands the session down

**What is wrong.** `Schemas.load` (`src/core/schemas/index.ts:207–228`) walks
`store.list({ type: "schema" })` and calls `readProseWalking` **without a try**. It handles a
blanked `prose_path` column but not a prose file that is missing or corrupt on disk, so the
throw escapes `Schemas.open` and `Counterpart.open` fails. This is exactly review s1c's MAJOR-1
shape. Before E1 the schema shelf held rows a human or a sweep created deliberately; E1 makes a
schema row per directory, written automatically at every session end, whose whole design is to
be transient and let go by the prune — which is the row class most likely to be the one missing
after a crash, a partial sync or a hand-tidied `prose/schemas/`.

`handoff/`'s own readers are careful about this (`readHandoff`, `handoffRows`, `findHandoffRow`
and `anyLive` all swallow the read and report absence, per §5 G7). `Schemas.load` is not, and it
runs first.

**What I ran.**

```
$ bun probe.ts     # P6
prose_path=prose/schemas/sch_1ab1a80e5865.md
prose file exists: true
(a) blanked prose: STOOD DOWN -> PROSE_FRONTMATTER_MISSING {"reason":"no-open-fence"}
(b) missing prose: STOOD DOWN -> PROSE_FILE_MISSING {"path":"…/prose/schemas/sch_1ab1a80e5865.md"}
```

`Counterpart.open` throws; no wake is composed; the session does not start.

**Not E1's code, and worth saying so.** The prune does *not* remove the prose — I ran 124 lived
days of cycles and the file was still there after the row was archived (probe2 A1:
`archived=1 prose file still there=true`), so E1 does not create this state by itself. The fix
belongs in `schemas/load` (wrap `readProseWalking` and count the failure into `loadSkips()`
beside `unaccounted`, the way the blank-path case already is). I am raising it here because E1
is what multiplies the number of rows this can happen to, and because the brief asked.

---

## MINOR

### MINOR-1 — `counterpart.handoff.noroom` is ring-only, so the documented lag leaves nothing durable

The PR calls `noroom` "a tripwire if it ever stops being temporary". `Counterpart.emit` pushes
to a 500-entry in-process ring; hooks are one process each (`hooks.ts:513`, the adapter's own
comment). The event does not survive the process.

```
$ bun probe.ts     # P10: first wake after the first handoff, budget 2,000
first wake after the first handoff: bytes=1896 pointer=false sentinelOK=true
noroom events: 1  durable rows: 0
```

The precedent exists (`adapter.injection.overbudget` and `adapter.scope.unreadable` are also
ring-only, and the adapter says why), so this is consistent rather than wrong — but it means the
exact shape the brief asked me to find ("the pointer stops being delivered and nothing says so")
is real for the whole lag window. The durable half that exists elsewhere is a *field on a row
that is already written*; the same trick is available here — a `noroom: true` field on the
adapter's `wake.injected` row.

### MINOR-2 — `handoff.shown` writes one row per wake, for ever, undeduped

```
$ bun probe.ts     # P9
handoff.shown rows after 40 wakes: 40
```

Consistent with `wake.injected`, so not wrong in itself. It matters because CONTRACT §8 open
question 2 names `handoff.shown`'s `ageDays` as *the* measurement that will settle
`HANDOFF_LIFE_DAYS` — and that distribution will be dominated by repeated wakes of the same
session in the same directory rather than by distinct pickups. Whoever reads it later needs to
dedupe by `(ref, session)`; say so where the question is asked.

### MINOR-3 — an AWS secret access key survives the battery

```
$ bun probe.ts     # P3
aws-looking: written=true reason=revised redacted=yes gate=null
   stored = "[REDACTED:aws-access-key-id] and the secret wJalr…EXAMPLEKEY (AWS's documented example secret, shortened here)"
```

The access key *id* is redacted; the secret beside it is stored verbatim. This is the shared
`episodeGate` battery, so it is a pre-existing gap that the journal and the self page have too —
not E1's making. It belongs here only because the PR argues the handoff is "the prose most
likely to carry a token" and the brief asked me to put a fake key in it. Everything else I threw
at it behaved: a body that is *only* a key is refused (`empty-after-redaction`), a model-provider
key inside prose is redacted and the writer is told, a GitHub token and a PEM block are refused.

### MINOR-4 — control characters and bidi overrides survive `flatten` into the injected wake

`flatten` collapses `\s+`, which is `\n \r \t` and friends — not NUL, not ESC, not U+202E.

```
$ bun probe2.ts    # A5
NUL:          containsNUL=true
ANSI escape:  containsESC=true
RTL override: "…Placeholder ‮ reversed the work is half done…"
```

Line injection *is* blocked (the CR case folds correctly and only the first non-blank line is
excerpted), which is the scar `identityCoreLine` carries. But a U+202E in the pointer reverses
the display of everything after it in the wake for any reader that honours bidi, and an ESC
sequence lands in a prompt that is sometimes rendered in a terminal. Smallest fix: strip
`\p{Cc}` and `\p{Cf}` in `flatten`, or in `excerpt` before the cut.

### MINOR-5 — an archived handoff row is walked by `Schemas.load` for ever

```
$ bun probe2.ts    # A1, after 124 lived days of cycles
archived=1 …
list() sees it: true  list({type:schema}) sees it: true
reopened OK; handoffRows=[] anyLive=false
```

`handoffRows` filters `archived: false`, so the module itself is clean. `Schemas.load` does not
filter archived, so one permanent schema row per directory ever worked in is read from disk at
every `Counterpart.open`, for the life of the store. That is the cost side of CONTRACT §8 open
question 4, and it is larger than the question states (it is for ever, not for 90 days).

### MINOR-6 — the excerpt is the first line only, which is where a model will put a title

`excerpt` takes the first non-blank line. A handoff written as a titled note —
`"Handoff for the parser work\n\nThe empty-input case still fails…"` — produces a pointer that
says nothing at all. Guarantee 10 marks the wording [A], but the pointer's *whole value* is that
first line, and the tool description does not tell the writer to lead with the substance.

```
$ bun probe.ts     # P8
newline injection: "First line.\n- Placeholder forged lane bullet.\nThird."
   pointer: "Where I left off in this directory (2026-09-20): First line."
```

Smallest fix: one clause in the `handoff` field description — *lead with the sentence you want
the next session to read first* — or excerpt across the first paragraph rather than the first
line.

### MINOR-7 — the redaction fallback can store the unredacted draft

`handoff/index.ts:465`:

```ts
const text = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : draft;
```

If a gate ever returns `ok: true` with `text: ""` — a body that redacts down to nothing — the
**original**, unredacted draft is what gets stored. Not reachable today: the
`empty-after-redaction` gate refuses that case first, which I confirmed (MINOR-3's first line).
It is a latent trapdoor pointing the wrong way; `?? draft` on `undefined` only, with `""` treated
as a refusal, costs nothing.

### MINOR-8 — two rows for one scope are possible, and one of them becomes invisible while still holding the reserve

`findHandoffRow` → `put` is not atomic, and the deployment is hook-per-process / server-per-
session. Two same-process writers serialise correctly (P5: `w1=created … w2=revised`, one row,
last writer wins, loser kept as the version — the PR body's claim is true for that case). A true
cross-process race is narrow but not impossible. When two rows do exist:

```
$ bun probe.ts     # P5b, rows minted directly
two rows: sch_e1ce19551cb8 sch_e1a4a7f59fa0
findHandoffRow -> sch_e1a4a7f59fa0        # list order decides, silently
rows now: ["sch_e1a4a7f59fa0","sch_e1ce19551cb8"]
anyLive=true
```

The loser is invisible to `read`/`readAny`/`write` but still counted by `anyLive()`, so it holds
the 448-byte reserve open until it expires. Smallest fix: have `findHandoffRow` prefer the row
with the highest `writtenDay` and note the duplicate, rather than taking whichever `list()`
yields first.

### MINOR-9 — the handoff body is queued for embedding like any other row

`Store#unembeddedIds` (`store/index.ts:1624`) selects `FROM memories WHERE archived = 0 AND
superseded_by IS NULL` with **no `type` filter**, so a `type: "schema"` row is an embed candidate.

```
$ bun -e '…'
handoff id sch_507192ad013c
missingVectors includes it? true
unembeddedCount 1
```

Consequences, none of them fatal but none of them stated anywhere: (a) the prose the PR itself
calls "the most likely to carry a token" gets a vector, i.e. a second representation of it
outside the prose file; (b) every handoff written adds to the embed backlog `doctor` and the
parallel run watch, so `unembeddedCount` acquires a floor that has nothing to do with memories;
(c) a vector hit on it is filtered out by `activate()`'s new skip, so **recall is still clean** —
the filter is the only thing standing between the vector index and a turn. Smallest fix: exclude
the handoff role from `unembeddedIds` (or from the embed worker's candidate list) and say in
`handoff/CONTRACT.md` §5 whether a handoff is meant to have a vector at all. Worth checking
whether the self page — also a schema row — is in the same position; if it is, this is a shared
gap rather than E1's.

---

## NIT

1. **`pointerDoor` prints "It stops showing after 0 more days of use." on the last day it shows.**
   Measured (P7, day 14). Reads as a bug to anyone who sees it.
2. **The life is fifteen lived days, not fourteen.** `expired` is `day - writtenDay > lifeDays`,
   so days 0…14 inclusive show. Everything in the prose says "14" / "about two weeks". Measured:
   `day 14: live=true … day 15: live=false`.
3. **`refuse("empty", { bytes: 0 })`** writes `bytes: 0` into the durable row while the returned
   `HandoffWrite.bytes` carries the untrimmed count. Harmless, but the row and the result
   disagree.
4. **The reserve is ~1.6× the block.** 448 reserved against a real pointer of ~250–300 bytes
   (measured: 295 bytes of ceiling left unused at budget 2,000). See MAJOR-1's second half.
5. **`narrate.ts#REF_KIND` maps `handoff.written` and `handoff.shown` to `"memory"`.** Cosmetic —
   it is the ref *resolver*, not a claim — but it is the one surface where a reader could see a
   handoff row resolved through the memory door, in a feature whose thesis is "never a memory".

---

## Checked and clean

### I ran this

- **Byte-identity, the builder's harness.** `tools/wake-dump.ts` at `c908398` and the same file
  against a clean `git archive` of `origin/master`: 35 compositions, 47,196 bytes each,
  `diff` exit 0.
- **Byte-identity, widened.** My own `xdump.ts` — 8 store shapes (empty, identity-only, page,
  page + lanes, long page, a 60-element identity flood, page + flood, a page sized to land on the
  ceiling) × 353 budgets (every 3 bytes from 380 to 1,400, then 1,600 → 60,000) = **2,824
  compositions, 2,228,050 bytes, `diff` exit 0** between the two trees. Day 0, stores with a self
  page, over-budget identity lanes and budgets at the exact ceiling are all inside that sweep.
- **The over-ceiling scar.** 59 of the 2,824 compositions deliver a wake larger than the budget.
  Every one of them is at a budget of 380–401 — the eight tightest in the sweep, across all eight
  shapes (7 or 8 of the 8 budgets each) — and every one is **byte-identical on master**, so this
  is the pre-existing floor below which no bundle fits at all, and E1 adds none. At every budget where a
  pointer is delivered the bundle stays inside the ceiling (P10, and the builder's own test at
  `handoff.test.ts:553`); when it would not, the pointer is dropped whole and the tail sentinel
  survives (`sentinelOK=true`).
- **The lag, in both directions.** First wake after the first handoff: pointer dropped, bundle
  1,896 bytes under a 2,000 ceiling, sentinel intact. After the next boundary: pointer delivered,
  1,705 bytes. After expiry but **before** the next boundary: the 448-byte reserve lingers, the
  session gets 11 elements instead of 16 and no pointer — and the sentinel's `elements=11` is
  still **true of what was delivered**, so nothing lies. After the next boundary the element count
  returns to 16.
- **Per-directory isolation.** Two directories with handoffs and a third without: each session
  sees only its own (builder's tests, re-run). Child directory of a scoped directory: **nothing**
  (exact string match). Symlinked path, trailing slash and a lowercased path on this
  case-insensitive Mac: **all resolve to the same pointer**, because both ends go through
  `canonicalScope` (`realpathSync(resolve(...))`), which on this host normalises case, symlinks
  and `/var` → `/private/var`. An *un*canonicalised path finds nothing — but both live callers
  canonicalise: `bin/hook.ts#sessionScope`/`startDirectory` for the wake side and
  `server.ts#resolveScope` for the write side, both preferring `CLAUDE_PROJECT_DIR`. **Git
  worktrees:** `CLAUDE_PROJECT_DIR` is documented as staying put when the agent enters a worktree
  or runs `cd`, so a session launched at the repo root and working in `.claude/worktrees/x`
  shares the repo's pointer; a session *launched* inside the worktree gets its own. That is a
  defensible answer and it is nowhere written down — worth a line in the CONTRACT.
- **`off` / `paused`.** Through a real MCP server with a hand-written `scopes.json`: the whole
  `session_end` call is refused `scope-off` before the handoff is read; zero handoff rows, zero
  durable rows, nothing leaked. Both modes.
- **Session binding.** A foreign session id is refused `session-mismatch` before
  `writeHandoffField` runs (`server.ts:975` precedes the handoff); zero rows written.
- **The two halves are not one fate.** `memories: "not an array"` + a good handoff → the call is
  refused `memories-required` and the handoff is **still written**, with its durable row, and the
  outcome rides out on the refusal. The reverse: a good `memories` array + an over-size handoff →
  the memory is deposited and the handoff is refused `too-large` with its own row.
- **The write door.** Whitespace-only → `empty`, no row. `HANDOFF_MAX_BYTES + 1` → `too-large`,
  no row, store otherwise untouched. 5 MB → `too-large`, no row (the size check runs before the
  gate, so the battery never sees it). `WAKE_MARKER` and the end-sentinel → `forged-markers`.
  A lone surrogate, a NUL, an ANSI escape, a CR, leading blank lines and a U+202E all round-trip
  the store without throwing (see MINOR-4 for what that costs). Every refusal leaves exactly one
  `handoff.refused` row and nothing else — I counted `store.list()` before and after each.
- **Never memory, never identity.** Over 124 lived days of `runCycle` (consolidation, dedup,
  promotion, prune, version prune): `archived=1` at the end — the ordinary prune **does** let it
  go, which is guarantee 1's "let go by the ordinary means" and had no test behind it — and along
  the way `uses=0 reinforced_days=0 promoted_identity=0 band=episodic superseded_by=null`
  throughout, so `promotionEligibility` is structurally unsatisfiable. `self.enumerate()` reports
  `identity: [] protected: [] both: []`. `updatePhysics(id, { lastUsedDay })` on every write
  moves only the dwell clock; it touches neither `uses` nor `reinforced_days`, so the side door
  renews the row's life without making it eligible for anything.
- **`Schemas.load` and a `kind: "place"` row.** `toMetaRecord` returns null for `role: "handoff"`,
  so the row is remembered by nothing, indexed by nothing and registered as no entity. (What it
  does on an *unreadable* row is MAJOR-3.)
- **Expiry.** Days 0/12/13/14 live, 15 and 16 expired; `anyLive` agrees with `read` at every one.
  A supersede on day 3 moves the whole window (expires day 18). The lived clock is the store's,
  so a long calendar gap with few lived days does not age it. After expiry the row is left live
  and unread until the prune archives it; `readAny` then returns null and nothing resurrects it.
  The version chain is as claimed: one version, `successor_id = NULL`, so
  `inLiveRevisionChain` does not pin it.
- **The `updates:` resolver cannot swallow it.** `counterpart.ts:3567` feeds `store.search` hits
  straight into `resolveUpdates` as revision candidates — the one `store.search` caller that is
  neither owner-facing nor filtered by `activate()`, and the obvious way a memory could end up
  overwriting a handoff row or reading its body back. It does not happen. Through a real MCP
  server, with the handoff body and the note text deliberately near-identical:

  ```
  handoff row = sch_1b873a4cdacf
  note updates:<handoff id>            -> {"stored":true,"reason":"minted","id":"mem_9dd87a…"}
  note (content match, no id)          -> {"stored":true,"reason":"minted","id":"mem_75b5e5…"}
  session_end entry updates:<handoff>  -> {…,"outcomes":[{"stored":true,"reason":"minted",…}]}
  handoff row after: archived=0 superseded_by=null revision=0 uses=0   (body unchanged)
  ```

  Every attempt minted a fresh memory; the handoff row was never resolved as the target, even
  when its id was declared outright.
- **`recall({handle: <handoff id>})` expands it, by design, and credits nothing** —
  `reason: "expanded"`, one memory returned, `uses` still 0 afterwards. It also confirms
  `mcp/INTERFACE-GAPS §2`'s filed residual exactly as filed: `expandHandle` has no scope filter,
  so a session told another directory's handoff id can read that body (and its `title`, which is
  the other directory's absolute path). Filed, not fixed — correctly, since the fix is `mcp/`'s.
- **Credit.** `creditReferences` refuses it by name (`handoff`) and `uses`/`reinforced_days` stay
  at 0 after an expansion (builder's test, re-read and re-run as part of the suite).
- **Durable rows carry no body and no path.** `handoff.written` =
  `{session, bytes, version, created, lifeDays}`; `handoff.shown` =
  `{session, bytes, ageDays, version}`; `handoff.refused` =
  `{reason, session, bytes, limit|gate|gateReason}` where `gateReason` is a `+`-joined list of
  **gate names**, never matched text. I read every payload my probes produced. Guarantee 9 holds.
  The directory path is on the row's `title` only, as §5 G10 intends.
- **Registries.** All three names in `DURABLE_EVENT_NAMES`, no duplicate keys, both mechanisms in
  `MECHANISMS`, `fired` reads both rows, `flow.ts` and `narrate.ts` cover all three. Additive only.
- **The ask.** Exactly one call site (`hooks.ts:1198`) on exactly one pacer (`episodeAsk`,
  `hooks.ts:1166`); no second pacer is introduced anywhere in the diff. `stopAsk(...)` measures
  **1,237 characters / 1,243 bytes / 5 lines / 3 numbered items**. The raise to 1,300 did not
  weaken anything: the ≤ 6 lines, ≤ 4 numbered items, session-id-exactly-twice and
  honest-no assertions are unchanged and still asserted, and the length bound was never the thing
  defending them. Note that the new bound leaves **63 characters** of headroom — barely more than
  the 46 the old one had, which the test's own comment calls the reason it had to move.
- **Suite and typecheck, as printed, on `c908398`:**

  ```
  bun test v1.3.10 (30e609e0)
   2509 pass
   0 fail
   30530 expect() calls
  Ran 2509 tests across 43 files. [61.67s]

  $ bun x tsc --noEmit
  (clean, exit 0)
  ```

  `counterparts-*` directories under `$TMPDIR` from this suite's prefixes: **80 before, 80 after**.
  No flakes; `test/claude-code.test.ts`'s LINEAR-sentinel test and `test/cli.test.ts`'s
  CONVERTED-BUT-NOT-COMPACTED both passed on the first full run.
- **Regression sweep.** `git diff origin/master...HEAD` touches 24 files, +2,391/−17. The only
  test change outside the new file is `test/claude-code.test.ts`: one bound raised 1,050 → 1,300
  with its reasoning at the assertion, and one test **added**. **No test is skipped, deleted or
  weakened** — I diffed the test file hunk by hunk. Nothing in the diff is unexplained by the PR
  body. `src/core/store/` is untouched, so F5 (#148) should merge over it.

### I read this

- `src/core/handoff/{CONTRACT,NOTES,INTERFACE-GAPS}.md`, `index.ts`; `src/core/self/CONTRACT.md`
  (the ask and pacing scars, the wake's budget, `TRIM_ORDER`, the sentinel); `briefing.ts#spliceBeforeSentinel`
  and `applyPreface`; `counterpart.ts`'s new `wake`/`addHandoffPointer`/`wakeReserveBytes`/
  `writeHandoff`/`creditReferences` clause; `recall/activate.ts`'s skip; `mcp/server.ts#writeHandoffField`
  and the scope gate; `mcp/tools.ts`'s schema and claims; `claude-code/hooks.ts#stopAsk` and
  `sessionStart`; `bin/hook.ts#sessionScope`/`startDirectory`; `adapters/sessions.ts#canonicalScope`;
  `adapters/scopes.ts#effectiveStance`; `sleep/prune.ts#runPrune`; `schemas/index.ts#load`.
- **Observer.** `mcp/bin/serve.ts:288,307` derives the server's observer flag from
  `effectiveStance(configObserver, scopeVerdict.mode)` and passes it to `openServer`, and
  `Handoffs.write`/`noteShown` both stand down on `Counterpart.observer` without writing the
  refusal (observer G3). My first probe appeared to show an `observer`-mode directory writing a
  handoff **and** depositing memories — that was my harness passing a `scopes.json` without the
  flag, not the product; I traced the real wiring rather than report a false positive.
- **`spliceBeforeSentinel` on a damaged bundle** returns it untouched (`applied: false`) and
  `addHandoffPointer` then returns the bundle as `self/` produced it — so a clipped bundle, a
  bootstrap line or a hand-edited one is delivered as found, with its damage intact. I read the
  guard rather than manufacturing each damaged shape.

### What I could not determine

- **Whether the Stop hook's ask has a host-side byte ceiling.** The ask rides out in the hook's
  JSON `reason`; nothing in this tree bounds it and I would not call the host to find out. At
  1,243 bytes it is far below anything plausible, but "the new sentence pushes no host-side
  limit" is an assumption, not something I proved.
- **Whether a genuine cross-process write race can mint two rows for one scope.** I proved the
  consequences if it happens (MINOR-8) and that same-process writers serialise correctly; I did
  not build a two-process race, and SQLite's locking may or may not close the window between
  `findHandoffRow` and `put`.
- **Whether an embedding, once made, is ever removed.** The row *is* queued for embedding
  (MINOR-9). I did not run a real embedder, so I could not check what happens to the
  `embeddings` row once the prune archives the handoff 90+ lived days later, nor whether a
  vector for a revised handoff is refreshed or left stale against the superseded body.
- **The keyword-search callers, for completeness.** `store.search` has four call sites:
  `recall/activate.ts` (filtered — the new skip), `counterpart.ts:3567` (the `updates:` resolver
  — probed above, clean), and `cli/removal.ts` + `dashboard/web/views.ts`, which are owner-facing
  surfaces rather than prompt-time recall. A search in the dashboard or in `counterparts remove`
  *will* show the handoff row; I read those two rather than ran them, and on their face that is
  correct behaviour (the owner should be able to find it).

---

## Process notes

- Every probe ran on a fresh `mkdtemp` data dir it created and removed, with
  `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` exported. No live store, checkout or backup was read,
  written or entered; no `counterparts` command and no repo script was run against anything but
  a temp dir I made.
- `timeout(1)` does not exist on this macOS host, so the suite ran under `caffeinate -i` with no
  external bound. It finished in 61.67 s.
- The master tree for the byte-identity diff was `git archive origin/master` unpacked into this
  session's scratchpad, with `tools/wake-dump.ts` copied in; the worktree's HEAD was never moved
  off `c908398`.
- Working files left in the session scratchpad (not in the repo): `master.tar`, `mastertree/`,
  `wake-dump.ts`, `xdump.ts`, `probe.ts`, `probe2.ts`, `probe3.ts`, `probe4.ts`, and the four
  dump outputs. The only file added to the worktree is this one.
