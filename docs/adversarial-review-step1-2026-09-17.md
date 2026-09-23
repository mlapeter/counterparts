# Adversarial review — step 1 batch (`batch/step1-2026-09-17` = master + #125 + #126 + #127)

Reviewer: second adversarial pass, 2026-09-17. Read-only on the repo; all probes hermetic
(temp dirs, `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`). Scratch tests under
`<scratchpad>/adversarial2/`.

---

## 1. Verdict

**Deploy after fixing 3 things.** Nothing here leaks text, loses memory, or breaks a live
session outright. But #125 puts two new SQLite writes inside the Stop hook and I measured
them costing **10.6 seconds** when the write lock is held — which is I38's exact scenario —
and in that case the links it drops are recorded **nowhere durable**, which is the one
promise the PR is built on. And #126's verdict reads `truncated` — the scar's alarm word —
for any host build that records no `content` on its hook attachment. Fix those three, and
#127 is safe as it stands.

---

## 2. Findings

### MAJOR 1 — #125 adds up to **10.6 s** of blocking to the Stop hook under a held write lock

**Scenario.** Every Stop spawns a detached worker; the worker holds the operational
database's write lock while it consolidates. The next Stop's credit pass now calls
`associate.flush()` → `store.linkMany()` and then `store.appendEvent()`. Both are new
writes on a path that previously only buffered in memory
(`src/core/counterpart.ts:1541` — `if (coactivated.length > 0) this.publishCoactivation(coactivated, day);`,
replacing the old `this.associate.coactivate(coactivated)`), and each waits out
`BUSY_TIMEOUT_MS = 5000` (`src/core/store/db.ts:104`, set at `db.ts:174`) before throwing.

This is `docs/LAUNCH-STATUS.md:1643` (I38) verbatim: "the hook that follows a Stop stood
down with `database is locked` in **3 of 8 runs**".

**Proof** (`adversarial2/flush-lock.test.ts`, a second `bun:sqlite` handle holding
`BEGIN IMMEDIATE` on `operational.sqlite`):

```
flush()      -> 5284 ms   reason=failed rows=0 dropped=1 code=SQLITE_BUSY
appendEvent  -> 5290 ms   err=SQLiteError: database is locked
MARGINAL TOTAL added by #125 under a held lock: 10574 ms
```

`appendEvent` alone (+5.3 s) fires on **every boundary that credits at least one memory**,
not only the rare multi-memory ones: `publishCoactivation` appends its row whenever
`coactivated.length > 0`, even when `flush()` returns `nothing-buffered`
(`counterpart.ts:1603-1690`). The rare pair case pays both, 10.6 s.

**The baseline, so nobody reverts the wrong thing.** The Stop hook already blocks under the
same lock: my second probe (`flush-cost.test.ts`) drove a real `creditReferences` with the
lock held throughout and measured **10592 ms**, `credited=0`, `reason=nothing-to-credit` —
the pre-existing `resolveUse` writes. So #125 does **not** introduce lock stalling; it adds
lock-acquisition points to a path that already had N+1 of them (N × `resolveUse`, plus
`recall.credit`): **+1 on every credited boundary** (`appendEvent`) and **+2 on a
multi-memory one** (`linkMany` too). And the 10.6 s is only realized in the middle case —
the lock is free while `resolveUse` runs and taken before `flush()`. If it is held
throughout, credit fails first, `coactivated` is empty, `publishCoactivation` never runs and
#125 costs nothing. The right response is a shorter timeout on this path (and I39's pragma
reorder, already ruled for the next core batch), not reverting the fix.

For scale, the same batch's own Stop-path measurement is fine uncontended
(`adversarial2/flush-cost.test.ts`): N=10 credited → 11.9 ms; N=40 → 81.6 ms;
N=64 → 2016 pairs / 4032 edge rows / 1984 evictions → **128.7 ms**. Cost is not the
problem; the lock is.

Note also that `CREDIT_BUDGET_MS = 150` (`claude-code/config.ts:138`) does **not** cover
this: the deadline is consulted only in the candidate-prose loop and inside
`resolveReferences` (`counterpart.ts:1474`, `:1489`); neither the `resolveUse` loop nor
`publishCoactivation` checks it.

**Suggested fix:** take these two writes on a short-timeout path (a `busy_timeout` of a few
hundred ms for the edge flush and its row), or move the flush behind a "skip if busy" probe.
A bounded loss is already the declared direction (`associate/CONTRACT.md` §5 G4); a 10 s
stall is not.

---

### MAJOR 2 — when both writes lose the lock, the loss is recorded **nowhere durable**

**Scenario.** Same as MAJOR 1. `flush()` drains the buffer *before* it publishes (by design,
`associate/index.ts:282-284`), so the pairs are gone. The failure is supposed to be caught by
the `associate.flush` row. But under a lock held long enough, that row's own `appendEvent`
fails too, and the only remaining record is the in-process ring — inside a hook process that
is about to exit.

**Proof** (same run as MAJOR 1):

```
durable associate.flush rows after: 0
pending deltas after: []
```

The buffer was drained, the edge rows never landed, and the store holds **zero** rows saying so.

The code names this (`counterpart.ts:1594-1596`: "Under a lock held long enough both writes
fail together, and then the in-process events are the only record") — but the PR body's
headline promise is "**one per boundary that credited something**", and
`associate/CONTRACT.md` §5 G4's "bounded loss, **counted rather than hidden**" is exactly
what does not hold in the failure mode most likely to occur. Constitution 16 ("silence is
evidenced") points the same way.

**Suggested fix:** one retry of the row alone after a short sleep, or fold the counts onto
the `recall.credit` row the boundary already writes (one write instead of two, and the
boundary's own row is the natural place for "and it wired N pairs").

---

### MAJOR 3 — #126 reports `truncated` for a host that records no `content`

**Scenario.** `readWakeArrival` reads the verdict from `attachment.content` alone:

```ts
const content = typeof a["content"] === "string" ? a["content"] : "";   // transcript.ts:544
```

and `wakeOutcome` (`hooks.ts:1781-1786`) returns `"truncated"` whenever the attachment was
found and the tail sentinel is not in `content`. A host build that names the field something
else, drops it, or sets it `null` therefore makes **every session** report `truncated` — the
one word in the vocabulary that means "v1's eleven-day silent-loss bug is happening again".
The dashboard narrates it amber: *"My briefing arrived cut short — the closing marker was
missing from what the session was given"* (`narrate.ts`, the new `adapter.wake.delivered`
arm). `content` is a field of the host's private transcript format measured once, on Claude
Code 2.1.274; it is not a contract. **This is robustness, not a deploy-day fault** — the
current host does record `content` (the batch's own fixture matches a live measurement), so
this fires only on a host change. It is cheap to fence now and expensive to notice later,
because the failure looks exactly like the bug the mechanism exists to catch.

**Proof** (`adversarial2/wake-arrival.test.ts`):

```
no-content: outcome=truncated found=true tailInStdout=true contentBytes=0 stdoutBytes=178
```
and `content: null` gives the same. Two tests, both pass.

The row *does* carry the disambiguating evidence — `tailInStdout: true`, `contentBytes: 0` —
but nothing reads it: not `wakeOutcome`, not the narrator, not doctor.

**Suggested fix:** a sixth outcome (`no-content` / `not-recorded`) when `a["content"]` is
absent or not a string while `stdout` is present. One condition, and it keeps `truncated`
meaning the thing it is for.

---

### MINOR 1 — the sentinel regexes are quadratic, and `[^>]*` crosses newlines

`WAKE_HEAD_SENTINEL` / `WAKE_TAIL_SENTINEL` (`transcript.ts:407-408`) are
`<!-- counterparts:wake[/end] [^>]*elements=(\d+) bytes=(\d+) -->`. `[^>]` matches newlines
in JS, and `sight()` is called four times per found attachment (head/tail × content/stdout).

**Proof** (`adversarial2/regex.ts`, plain `RegExp.exec`, no store):

```
A 8695 prefixes, no '>'  len=199985  680.2 ms
B 7407 tail prefixes, no '>'  len=199989  569.8 ms
C 5882 prefix+elements, no '>' len=199988  473.2 ms
D plain body + real sentinel   len=200051    0.1 ms
```

and end-to-end through the reader with a 60 KB poisoned attachment
(`wake-arrival.test.ts` F3): **123 ms**. Scaled to the 256 KiB read bound with both
`content` and `stdout` poisoned, that is a ~1–2 s stall inside `UserPromptSubmit`.

Reachability is the limiting factor: it needs many `<!-- counterparts:wake ` occurrences with
**no `>` between them** inside the injected wake, i.e. adversarial memory bodies. Ordinary
prose quoting the sentinel self-terminates on its own `-->`. MINOR, but the bound is one
`[^>]{0,200}` away from being unreachable.

---

### MINOR 2 — `SentinelSighting.line` can carry arbitrary memory text (no egress today)

`sight()` returns `m[0]`, and `[^>]*` will happily swallow anything without a `>` between a
fake prefix and the real sentinel.

**Proof** (`wake-arrival.test.ts` F10):

```
poison head.line = "<!-- counterparts:wake THE OWNER'S SECRET MEMORY TEXT LIVES HERE AND HAS NO ANGLE BRACKET <!-- counterparts:wake/end day=190 … -->"
```

**This does not leak today** and I checked every consumer: `checkWakeArrival`
(`hooks.ts:1284-1336`) records only `outcome`, booleans and numbers — never `.line`; the only
other use is `this.counterpart.noteWakeDelivered(arrival.tail.line, expected)` →
`self/index.ts:541-549`, which emits `{ok, sawSentinel, expected}` — three booleans; and the
error arm emits `codeOf(err)` (name/code, never `message`). Their test (g) pins it.
Flagged because the field is exported on a public interface (`index.ts` now exports
`SentinelSighting`) and is one log line away from being an egress.

---

### MINOR 3 — resumed and compacted sessions are never checked; `mismatch` is largely unreachable

`wakeChecked` is one-way (`sessions.ts:274-277`). A `source: compact` SessionStart mid-session
renders a **new** bundle and overwrites `wakeSentinel` (newest-wins, `sessions.ts:268-273`),
but the flag is already `true`, so that wake's arrival is never checked. Likewise a session
resumed under the same id leaves no row at all. The `wakeOutcome` docstring
(`hooks.ts:1770-1779`) says "`mismatch` is the case a resumed session produces"; that only
holds when the record was pruned (NOTES.md says so; the docstring does not). Prose, not a bug.

---

### MINOR 4 — "as many flushers as there are boundaries" is a real behaviour change

`associate/INTERFACE-GAPS.md` §3 is updated honestly, and the direction (lost update between
two absolute weights) is inside the declared tolerance. Worth the owner seeing it stated: two
concurrent sessions in one data dir now race on every credited boundary, where before nothing
raced because nothing was ever written.

Related, and not stated anywhere: the credit gate is **per session** per lived day
(`recall/index.ts:531-538`, `state = this.recall.gateState(sessionId)`). Four sessions in one
lived day that each credit the same pair each add a full `pairCredit`. #125 extends that from
physics to the graph for the first time. The owner's R2 ruling reads as "once per lived day";
the mechanism is "once per session per lived day".

---

### MINOR 5 — G57 goes from latent to live

`associate.memberReason` (`associate/index.ts:485-499`) checks denied / unknown / superseded /
archived / protected — **not** confidential; `creditReferences` filters the same four
(`counterpart.ts:1501-1514`). G57 (`docs/LAUNCH-STATUS.md:1581`, ruled "fix in core", not yet
built) is pre-existing, but until #125 no edge was ever written, so a confidential memory
could not acquire durable associations. It can now.

**No egress found.** `hubs()` (`views.ts:728-750`) passes every id through
`reveal()` (`reveal.ts:65-75`), which returns `text: null, label: WITHHELD` for a confidential
head; the non-owner MCP path is stopped at `recall/gate.ts:319-322`
(`confidential-withheld`, silent in a list); and the `associate.flush` payload is counts only
(their test asserts no id appears in it). Flagging it so the eventual G57 fix knows the graph
now has state to consider.

---

### MINOR 6 — `/api/fired` costs ~55 µs per memory, on every dashboard page load

**Proof** (`adversarial2/fired-cost.test.ts`, 3000 events throughout):

```
memories=500   probes ON  27 ms   probes OFF 1 ms
memories=2000  probes ON 121 ms   probes OFF 1 ms
memories=6000  probes ON 329 ms   probes OFF 1 ms
```

Linear; extrapolates to ~880 ms at 16k, matching the author's 921 ms. Where it is paid:

- **Dashboard: once per page load, not per poll.** `boot()` renders every tab up front
  (`app.html:1700`, `await Promise.all(TABS…)`), `renderHealth` ends with `await renderFired()`
  (`app.html:1349`), and the 4 s poll refreshes only overview and flow
  (`refreshCounters`, `app.html:1647-1670`) — health is never re-fetched. **No poll loop.**
- **Doctor's full run:** yes, and it is deliberately the last group (`doctor.ts:1305`).
- **Session start: no.** `firedFindings` returns a stub when `input.budgetMs !== undefined`
  (`doctor.ts:1063-1074`). Verified.
- **CLI `fired`:** yes, once.

**Read-only is proven.** A filesystem snapshot (every file's size + mtime) across a fresh
`Store.open` + `firedReport` + `close` on a seeded store: **zero deltas** — no migration, no
journal file, no meta write. `store.livedDay()` is a pure `getMeta` read
(`store/index.ts:1966-1968`); the clock advances only in `advanceClock`. The CLI opens with
`observer: true` (`commands.ts`, `firedCommand`). The route is behind the host allowlist,
checked before any path dispatch (`server.ts:150` precedes `server.ts:188`), on a 127.0.0.1
bind (`server.ts:264`).

Small consequence worth naming: at session start doctor prints a **GREEN** `Fired` line whose
text is "the roll-call … is not read at session start". A green finding for a reading that
did not happen.

---

### MINOR 7 — a `transcript_path` naming a FIFO would hang the hook (SUSPECTED, not tested)

`readHead` does `openSync(path, "r")` (`transcript.ts:478`). On a FIFO that blocks until a
writer opens the other end, so a hostile or accidental FIFO at that path would hang
`UserPromptSubmit` until the host's own hook timeout. The path comes from the host payload,
not from a model, so this is MINOR. `existsSync` does not distinguish it; an `fstat`
`isFile()` check after the open (or `O_NONBLOCK`) would close it.

---

## 3. What I attacked and found sound

- **#126 privacy.** No wake, memory or transcript text reaches any payload, log line, session
  record or error message. Traced every consumer of `WakeArrival` (above); `codeOf` in both
  `hooks.ts` and `associate/index.ts` returns `err.code ?? err.name`, never `message`; the
  `mismatch` path compares and discards.
- **#126 robustness.** Directory path → `unreadable` in 0.1 ms; symlink loop → `absent`;
  256 KiB with no newline → 1 line, 1 corrupt, no throw; invalid UTF-8 cut mid-codepoint +
  NUL bytes → `read` in 0.2 ms; 5000-deep nested JSON → no throw, 0.3 ms; a file 3× the bound
  → `not-found`, `bytesRead ≤ 256 KiB`. Nine probes, none threw, none over 0.3 ms
  (`wake-arrival.test.ts`).
- **#125 double counting.** Blocked three ways: `resolveUse`'s per-lived-day gate
  (`recall/index.ts:538`) means a re-fired Stop credits nothing, so nothing is coactivated;
  `creditReferences` only ever resolves at one tier (`"referenced"`, `counterpart.ts:1527`),
  so no tier-escalation re-credit; `coactivate`'s `seen` set kills self-pairs
  (`associate/index.ts:196-202`). The worker's `sessionEnd` flush finds an empty buffer in its
  own process.
- **#125 correctness.** `memberReason` re-checks denied / unknown / superseded / archived /
  protected at buffer time and `publish` re-checks conduction + `protected` at flush time
  (`associate/index.ts:295-301`) — a memory archived between turn and boundary is `blocked`,
  counted. Symmetric rows written both directions; `last_day` = the pass's day; eviction path
  exercised at N=64 (1984 evictions, 128 ms).
- **#125 observer.** `coactivate` stands down first, `flush` stands down, and
  `publishCoactivation` returns before `appendEvent` (`counterpart.ts:1644-1646`). Their test
  asserts zero edges and zero rows.
- **Deploy skew (old dashboard / MCP + new rows).** Every runtime index has a fallback:
  `NARRATORS` at `narrate.ts:733` (`Record<string, Teller | undefined>`, plus a try/catch and
  a "no sentence for this yet" line), `EVENT_NODE` at `flow.ts:402` (`?? null`), `REF_KIND` at
  `narrate.ts:682` (`Record<string,string>` + `switch` default). `satisfies` is compile-time
  only, and they knew it. Old `parseRecord` ignores `wakeSentinel`/`wakeChecked`.
  `tools/parallel` never split `adapter.wake.delivered` on `reason` (it is in
  `DURABLE_DETECTORS` and `SESSION_BEARING_EVENTS`, not `REASON_SPLITS`), and the new payload
  still carries `delivered` and `ok`, which `narrate.ts` and `readers.ts` read.
- **#126's F1 seal.** `checkWakeArrival` returns on `record === null` before any write, and
  `markWakeChecked` is only reached with a record in hand (`hooks.ts:1278-1282`, `:1336`).
  The off→on evidence is untouched; their test pins it.
- **Session-record races (task B3).** No test written — the host serializes hooks per session
  — but the surface is small: only hook processes of the same session write
  `sessions/<id>.json` (four `recordSession` sites, all in `hooks.ts`: 584 `deliverScopeAsk`,
  1196 `noteSession`, 1233 `noteWakeExpectation`, 1340 `markWakeChecked`; none in the worker,
  none in the MCP server). `recordSession` re-reads `prior` inside itself, so `endedAt`,
  `config` and `scope` come from the freshest file; `askedScope` and `wakeChecked` are
  one-way and `wakeSentinel` is newest-wins-else-carried (`sessions.ts:257-277`) — none of
  them can regress through a rewrite. **One SUSPECTED window:** `markWakeChecked` writes
  `at: prior.lastBoundaryAt` from a `prior` captured *before* the transcript read
  (`hooks.ts:1278` then `:1336`), so a Stop landing in that gap would have its
  `lastBoundaryAt` rolled back by milliseconds. Harmless — the TTL is four hours.
  **`scope` is untouched by this batch:** start-owns-scope is unchanged
  (`sessions.ts:247-248`), and I found no #120-era field in `sessions.ts` inside this diff.
- **#127 registry totality is not vacuous.** `covers` appears exactly once, on the spawn
  mechanism (`fired.ts:526`); everything else is accounted for by a real `evidence.names`.
  `associate.flush` has its own mechanism (`fired.ts:349`).
- **#127 windows.** `daysBefore` is exact at a year boundary: `today=2026-01-01` →
  `from=2025-12-26`, `previousTo=2025-12-25`, `previousFrom=2025-12-19`. The truncated-log
  second read uses `livedDay - 14`, and a lived day spans ≥ 1 calendar day, so the cover is a
  superset — the right direction. `wentQuiet` requires `firedInPreviousWindow > 0`, so a
  mechanism last seen a month ago is `quiet` but does not amber.
- **New NEVER/ALWAYS rules in contracts:** none added. The `claude-code/CONTRACT.md` §13 and
  delivery-telemetry edits are descriptive; the one imperative added to NOTES.md ("a value
  read in a later hook than the one that wrote it has to be on disk") is a safety property
  about process boundaries, which is the kind the owner asked to keep.

---

## 4. Probes written for this review

| file | what it proves |
|---|---|
| `adversarial2/regex.ts` | sentinel-regex backtracking, 680 / 570 / 473 ms at 200 KB |
| `adversarial2/flush-cost.test.ts` | credit-pass scaling N=10…64; the pre-existing path also blocks ~10.6 s under a lock |
| `adversarial2/flush-lock.test.ts` | **MAJOR 1 + 2**: 5284 + 5290 ms, 0 durable rows, buffer drained |
| `adversarial2/wake-arrival.test.ts` | **MAJOR 3** + 9 robustness probes + the `.line` poison case |
| `adversarial2/fired-cost.test.ts` | `firedReport` cost curve, zero filesystem writes, UTC windows |
