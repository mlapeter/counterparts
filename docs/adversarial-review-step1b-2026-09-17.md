# Adversarial re-review — the step-1 batch's redesign and fixes

Reviewer: third adversarial pass, 2026-09-17. Read-only on the repo. Code:
`~/counterparts/.claude/worktrees/step1-trial`, branch `batch/step1-2026-09-17`,
HEAD `2bb904b`. All probes hermetic (fresh temp data dirs, `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`),
under
`<scratchpad>/adversarial3/`.
I re-ran the whole suite myself: **2211 pass / 0 fail**.

---

## 1. Verdict

**Deploy after fixing one thing.**

The redesign is the right shape and it closes all three of the first review's MAJORs — the
hook takes no database lock at all now, the deltas are durable before anything touches
SQLite, and `truncated` no longer fires on a host that does not record `content`. The
old-code question is settled with real `origin/master` code, not by argument: a store
carrying `sessions/association/pending.jsonl` and a claim opens cleanly, and old
`pruneSessions` leaves the subdirectory alone even when it is thirty days old.

The one thing to fix: **a claim held by a live worker becomes stealable after two minutes,
and the second worker applies the same deltas again.** I reproduced it — an edge weight of
0.1 became 0.2 — and nothing anywhere counts it. `associate/CONTRACT.md` §5 G4 says in so
many words that "doubling is what the contract rules out". It is a two-line fix.

Four MINORs follow it. None of them is a reason to hold the deploy.

---

## 2. Findings

### MAJOR 1 — a LIVE worker's claim is stolen after two minutes, and the deltas are applied twice

**The mechanism.** `claimPending` ages an orphan claim by its **mtime**:

```ts
if (now - statSync(from).mtimeMs < staleMs) continue;      // pending.ts:331
```

and a claim is made by `renameSync`, which **preserves mtime**. So a claim's "age" is the
time since the last *append to the pending file*, not the time since the claim was made.
A worker that claims a pending file which has been sitting for more than
`PENDING_STALE_CLAIM_MS` (2 minutes, `pending.ts:113`) is holding a claim that is *already
stale the moment it takes it*.

**How a pending file gets to be older than two minutes when it is claimed.** Not routinely
— an ordinary run's sweep selects nothing and its two embedder batches are bounded, so the
apply is reached in seconds. But the worker does not reach it first. In order:

- `runner.ts` awaits `laggedSemantic(...)` and `backfillVectors(...)` — embedder HTTP calls
  (`runner.ts:199-216`);
- `counterpart.sessionEnd` then awaits `this.sweepFallback(...)` — model interpretation
  calls (`counterpart.ts:2021`);
- only then `this.applyPendingAssociations()` (`counterpart.ts:2034`).

The watchdog allows the whole run five minutes (`claude-code/config.ts:131`,
`WATCHDOG_MS: 5 * 60_000`), which is the build's own statement of how long this is allowed
to take. A real crash sweep with model calls, a slow embedder, or a laptop that slept
mid-run all get there. The doubling then additionally needs worker B's scan to land inside
A's claim-to-release window — 35 ms uncontended (A6), up to ~5 s when the flush waits out
the busy timeout. **So: plausible, not routine.** The severity does not rest on frequency;
it rests on the invariant being inverted, the result being reproducible, the doubling being
uncounted, and the fix being one line.

**And nothing stops two workers running at once**: `planSpawn`
refuses only for `OBSERVER`, `NO_DATA_DIR` and the watchdog checks (`spawn.ts:146-168`);
every Stop spawns one (`hooks.ts:1440`). There is no single-worker guard, no lease, no pid
file.

**This repository already has this invariant, and states it.** `remember/tunables.ts:17`,
on `STALE_CLAIM_MS: 10 * 60_000`:

> *"Any detached worker's watchdog must fire well INSIDE this window — see
> `validateWatchdog()` (scars E4, E5)."*

The new window is 2 minutes against a 5-minute watchdog — the inequality inverted. The
repo's own checker says so:

```
WATCHDOG_MS 300000  PENDING_STALE_CLAIM_MS 120000
validateWatchdog(...) -> {"ok":false,"reason":"TIMEOUT_EXCEEDS_STALENESS"}
```

**PROOF** (`adversarial3/pending-attack.test.ts` A1 + A2, both pass):

```
A claimed apc_7e42a042a65c.jsonl  pairs 1  mtime age ms 180000
B report: {"reason":"flushed","claims":1,"passes":1,"pairs":1,"rows":2,...,"stuck":0}
A flush: flushed rows 2  release {"released":true,"stuck":false,"code":null}
weight after B = 0.1 ; after A applied it too = 0.2
```

A credits, the pending file is backdated three minutes (standing in for the pre-claim
awaits), worker A claims it and is still holding it; worker B — the next boundary's —
calls `applyPendingAssociations()`, steals A's claim as an orphan and applies it; A then
finishes its own apply of the same deltas. **The weight doubles.**

**And nothing counts it.** A's `releasePending` uses `rmSync(path, { force: true })`
(`pending.ts:355`), which does not fail on a file that is no longer there, so A reports
`released: true, stuck: false` and writes an `associate.flush` row saying it did honest
work. Both rows read as normal.

**Suggested fix** (either half closes it; both is better):

1. `utimesSync(claimPath, now, now)` immediately after each rename in `claimPending`. The
   design note says mtime is preserved so "a passed-along orphan still reads its true
   age" — but age is never read from mtime: `oldestAt` comes from the lines' own `at`
   field (`pending.ts:278`) and that is what `oldestMs` and the row report. Preserving
   mtime buys nothing and costs the exclusion.
2. Set `PENDING_STALE_CLAIM_MS` above `WATCHDOG_MS` and assert it with the existing
   `validateWatchdog`, the way `spawn.ts` already does for `remember/`'s window.

---

### MINOR 1 — a claim whose READ fails is deleted, with its deltas, silently

`readClaim` swallows the read error and returns an empty claim (`pending.ts:256-260`):

```ts
try { text = readFileSync(path, "utf8"); }
catch { return { path, passes: 0, deltas: [], day: null, oldestAt: null, droppedPairs: 0, corrupt: 0 }; }
```

The apply then sees `pairs === 0` → `flush` returns `nothing-buffered` → that is not
`failed` and not `busy`, so `applied` is true (`counterpart.ts:1758-1759`) and
`releasePending` **removes the file**. `corrupt` stays 0, so nothing says a line was ever
missed.

**PROOF** (`adversarial3/pending-attack2.test.ts` B3 — my assertion that the claim is kept
FAILS):

```
apply of an unreadable claim: {"reason":"nothing-buffered","claims":1,"passes":0,"pairs":0,
  "rows":0,"corrupt":0,"stuck":0,...}   claims left: []   edges: 0
```

Reproduced with `chmod 000`; the realistic triggers are transient (`EIO`, `EMFILE` under fd
pressure, `ENOMEM` on a capped file). The row does carry `claims: 1, passes: 0`, and the
narrator says *"A boundary carried in what the sessions had wired and nothing new came of
it"* — **calm**, for a loss. The design's own standard is "counted rather than hidden".
Fix: give `PendingClaim` a `readFailed` flag and treat it as not-applied.

---

### MINOR 2 — `applyPendingAssociations` can throw from outside every `try`, and then the row is lost

One store read sits outside every guard: `counterpart.ts:1782` — `day: this.store.livedDay()`
inside the `data` object literal, which is built *after* the claims loop and *before* the
`try` that wraps `appendEvent` (`:1804-1812`). (`this.store.now()` at `:1713` is `nowFn()`,
a clock, not a database read — it is not a throw site.)

**PROOF** (`adversarial3/roundtrip.test.ts` R3 — my "does not throw" assertion FAILS):

```
apply against a CLOSED store: THREW RangeError: Cannot use a closed database
```

The worker survives — `sessionEnd` wraps the call (`counterpart.ts:2033-2037`) and
`runner.ts` records `carried: "threw"` — so **failure containment holds**. The cost is
narrower: in `journal_mode = DELETE` a reader can meet `SQLITE_BUSY` after the 5 s timeout,
and that is exactly the contended case the `associate.flush` row exists to report. A throw
there means **no row at all**, for a run that either wrote edges or failed to. Fix: move
the `livedDay()` read inside the existing `try`, or resolve it once at the top beside `now`.

---

### MINOR 3 — the residual of MAJOR 3: no `content` AND no `stdout` still says `truncated`

`wakeOutcome` falls back to the printed side only when `stdout` carries a sentinel
(`hooks.ts:1801-1807`). A host build that stops recording `content` is the same class of
change as one that stops recording `stdout`, and then every session reports the alarm word
again.

**PROOF** (`adversarial3/wake-attack.test.ts` W2, passes):

```
{ neitherRecorded: "truncated", printedSomethingElse: "mismatch" }
```

Cheap to fence: when neither field is a string, the honest answer is `printed-unverified`
(or a sixth-and-a-half `not-recorded`), not `truncated`.

---

### MINOR 4 — a pending line's `day` crosses into physics unclamped

`parseLine` accepts any finite `number` for `day` (`pending.ts:237`), and the apply stamps
the edges with it: `this.associate.flush(claim.day ?? this.store.livedDay())`
(`counterpart.ts:1745`).

**PROOF** (`adversarial3/roundtrip.test.ts` R4):

```
store livedDay 1 -> edge.last_day 999999
```

An edge stamped with a lived day in the future never decays. The file is host state inside
the store at mode 0600 and is written only by this package, so this needs local tampering
or a corrupted write — low. A `Math.min(day, this.store.livedDay())` closes it.

---

## 3. Confirmed closed — the first review's items

| item | how it was proved closed |
|---|---|
| **MAJOR 1** — 10.6 s of blocking in the Stop hook | The hook takes no **write** lock for association at all: `publishCoactivation` now does `coactivate` (reads) + `drain` + `appendPendingDeltas` (`counterpart.ts:1638-1670`) and never calls `flush`/`appendEvent`. Their own test holds `BEGIN IMMEDIATE` across the pass and asserts < 50 ms. My A6: a 40-memory pass (780 pairs) costs **24.5 ms** in the hook and **34.4 ms** in the worker. One clause of precision: `coactivate`'s reads (`deniedIds`, `row`) were already on this path before #125 and, in `journal_mode = DELETE`, can still wait on a writer's EXCLUSIVE **commit**; `BEGIN IMMEDIATE` holds only RESERVED, which does not block readers, so "0.15 ms with the lock held" measures the reserved phase, not the commit. Not a regression — the reads were always there. |
| **MAJOR 2** — a lost flush recorded nowhere durable | The deltas are on disk *before* the database is touched. A failed apply keeps the claim (their test; the one exception is MINOR 1 above). My A2 output shows the file surviving a failed run. |
| **MAJOR 3** — `truncated` for a host that records no `content` | W1: `content` absent → `printed-unverified`; `content: null` → `printed-unverified`; `content: ""` → `truncated`; intact → `delivered`. Residual in MINOR 3. |
| **MINOR 1** — quadratic sentinel regexes | Replaced by `indexOf` + a ≤ 400-byte anchored slice (`transcript.ts:433-489`). W3b, both fields poisoned: 2,000 prefixes (46 KB/field) → **3.9 ms**; 4,000 (92 KB/field) → **9.8 ms**. Linear. The reviewer's full 200 KB payload never reaches the search at all — the attachment exceeds `WAKE_HEAD_MAX_BYTES` and the line is dropped. |
| **MINOR 2** — `SentinelSighting.line` could carry memory text | The field is gone; `matchesExpected: boolean` replaces it, and the comparison happens inside `sight()`. W4, with the owner's "secret" inside a fake unterminated sentinel standing in front of the real one: the serialized `WakeArrival` contains neither the secret nor the substring `counterparts:wake`, and the outcome is still `delivered` (the exact-match preference works). `hooks.ts:1328-1331` hands core the expectation or `""`, never the file's text. |
| **MINOR 7** — a FIFO at `transcript_path` would hang the hook | `statSync().isFile()` + `O_NONBLOCK` + `fstatSync().isFile()` (`transcript.ts:553-560`). W5: FIFO → `unreadable` in **0.02 ms**. W6: symlink → FIFO → `unreadable` in 0.02 ms. W7: directory → `unreadable`, symlink loop → `absent`, `/dev/zero` → `unreadable`. |
| MINOR 3–6 | Deliberately out of scope, still open, correctly listed in the PR body. |

---

## 4. Attacked and found sound

**Old-code compatibility, proved against real `origin/master`** (`adversarial3/oldcode.test.ts`,
master's `src/` extracted with `git archive` and imported directly — 5/5 pass):

```
top level: cache, versions, sessions, operational.sqlite, prose, tmp
old store opened; livedDay = 1
pruneSessions removed: 0 | sessions dir now: association | association still has: pending.jsonl, claims
old worker ran: 2  edges: nothing-buffered
```

- O1: master's `assertLayoutClassified` does not throw on the top level — unchanged.
- O2: master's `Store.open` succeeds on a store holding `sessions/association/pending.jsonl`
  and `claims/apc_deadrun.jsonl`.
- O3: master's `pruneSessions`, with the directory *and* the file backdated 30 days and a
  60 s TTL: removes **0**, and both survive. (Precisely: `rmSync` without `recursive`
  *throws* `ERR_FS_EISDIR` on the directory and the existing inner `catch { continue; }`
  eats it — the PR body's "leaves a directory alone" is the right outcome by a slightly
  different route.)
- O4: master's `readSession` cannot be pointed at it (`association` is not a session id).
- O5: a full master `sessionEnd` runs against the new layout and leaves the pending file
  intact — old code ignores it rather than choking on it.

**Concurrency and durability.**

- Four real child processes writing **~64 KB lines** at once: 0 corrupt, 192/192 pairs (B1).
  With real ids a line is under a kilobyte, so the over-pipe-buffer case is unreachable in
  production anyway.
- Three processes appending 1,200 passes while the parent ran **22 concurrent claim
  sweeps**: **1200 of 1200 recovered** (X1). The append-lands-in-a-renamed-file window did
  not bite in this run; it is a microseconds-wide window between `openSync` and `write`,
  and I could not force it.
- A torn last line (crash mid-append): `corrupt 1`, the earlier pass survives (A3).
- Re-claiming is exclusive between *two workers racing for the same orphan* — the rename is
  atomic and the loser meets `ENOENT` (`pending.ts:334-338`). The hole is only the
  live-holder case, MAJOR 1.
- `.applied` residuals cannot be re-claimed: the orphan scan takes `.jsonl` only
  (`pending.ts:328`).
- The cap's counted eviction reaches the durable row (B2): `appendPendingDeltas` past 1 MiB
  returns `{"ok":true,"lines":1,"pairs":0,"droppedPairs":1,"code":"PENDING_FULL"}` and the
  row carries `"pendingDropped":1`.

**Privacy.** The pending line, verbatim from A5:

```
{"at":1789688376609,"day":1,"p":[["mem_afbda257bef3","mem_e12d12b3b989",0.1]]}
```

Ids, a lived day, a timestamp, a weight — inside `sessions/`, which is host state,
`backup: false`. The `associate.flush` row is counts only and contains none of the pass's
ids (A6, B2, and their own test). Every error path uses `codeOf`/`errCode`, which return
`err.code ?? err.name` and never `err.message` (`pending.ts:163-171`,
`associate/index.ts:137-146`, `remember/spans.ts:1302-1310`); the row's `error` is one of
those codes.

**I22 — a claim carries nothing tying it to its store, and does not need to.** A pending
file copied into a *different* store (A5) applies to nothing: `conductor()` returns false
for an id with no row (`associate/index.ts:539-550`) and `publish` re-checks both endpoints
(`:322-332`).

```
foreign apply: {"reason":"flushed","claims":1,"passes":1,"pairs":1,"rows":0,"blocked":1,...}
```

**Correctness through the file.**

- `last_day` is the **credit's** lived day, not the apply's: credited on day 1, applied on
  day 4, `edge.last_day = 1` (R1).
- No self-pairs reach the file (R2: 780 pairs for 40 memories, 0 self-pairs) — `coactivate`'s
  `seen` set, and `absorb` re-checks `d.a === d.b` and `d.delta <= 0`
  (`associate/index.ts:264-270`).
- Symmetry: every row has its mirror (R2).
- The per-node cap survives the round trip (X2): `rows 39, LIVE 32, cap 32, evicted 280` —
  32 live edges plus 7 archived, which is G3's "evicted, never dropped".

**Failure containment and lock behaviour.** A throw in `absorb`/`flush` is caught per claim
(`counterpart.ts:1743-1748`); `claimPending` is wrapped (`:1715-1723`); `appendEvent` is
wrapped (`:1804-1812`); and `sessionEnd` wraps the whole call, so no arm can abort the
sleep cycle (R3 confirms the only escape is contained there). The apply's own lock hold is
short: 34 ms for 780 pairs / 1,560 rows (A6), and it runs in the process that already owns
the lock.

**Observer.** Writes not even the directory (A7):
`{"reason":"observer",...}` and `associationDir` does not exist.

**The wake row and the narrator.** `ok: outcome === "delivered"` (`hooks.ts:1295`), so the
narrator's "arrived intact" arm cannot fire on `printed-unverified`. All six outcomes have
a sentence (`narrate.ts`), amber only for `truncated`, `mismatch` and the fallback
(`not-found`); `printed-unverified` and `no-wake-expected` are calm. `SentinelSighting.line`
appears nowhere in `transcript.ts` or `hooks.ts`.

**`SENTINEL_MAX_BYTES = 400` is comfortable.** The real tail sentinel is `day=` plus the
five fixed lanes of `LANE_ORDER` plus `elements=`/`bytes=` (`self/briefing.ts:222-230`,
`briefing.ts:52-58`) — about 100 bytes at any plausible counts. W8 shows a 612-byte sentinel
would be missed, but the lane list is fixed, so it cannot get there.

---

## 5. Probes written for this review

| file | what it proves |
|---|---|
| `adversarial3/pending-attack.test.ts` | **MAJOR 1** (A1 the invariant, A2 the doubling), torn line, I22, cost, observer |
| `adversarial3/pending-attack2.test.ts` | big-line atomicity, the cap's counted drop, **MINOR 1** (B3) |
| `adversarial3/oldcode.test.ts` | deploy skew, against `origin/master`'s real `src/` |
| `adversarial3/wake-attack.test.ts` | the content trio, **MINOR 3**, the poison body, FIFO / symlink-FIFO / directory / device |
| `adversarial3/w3.test.ts` | the linear sentinel search, timed at two sizes |
| `adversarial3/roundtrip.test.ts` | `last_day`, self-pairs, symmetry, **MINOR 2** (R3), **MINOR 4** (R4) |
| `adversarial3/race.test.ts` | 1200/1200 appends recovered across 22 concurrent claims; the per-node cap |
