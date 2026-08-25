# `sleep/` — interface gaps for the coordinator

*What this module needed from a neighbour and could not have, what it worked
around instead of cross-editing, and what the real fix looks like. Nothing here
is implemented in `sleep/`, on purpose.*

## 0. What was NOT stubbed

`physics/` supplied every verdict the cycle applies — `strength`, `band`,
`promotionEligibility` / `promote`, `pruneVerdict`, `dedupVerdict`, `pressureAt`,
`supersededResolvable` — and `store/` supplied every write. **Sleep invents no
arithmetic.** The one criterion it states itself is §5 below, and it is built
only from physics' own exports.

Two seams are genuinely stubbed and both are declared: the briefing renderer
(§2) and the ranking-cache writer (§1).

---

## 1. `store/` — box 3 has no strength column and no box-3 writer (WORKED AROUND)

**Owner:** `store/`.
**Needed:** the decay tick materializes `strength(m, d)` and `band(m, d)` into
the CACHE box for ranking speed. That is a box-3 write.
**Have:** `Store` owns the box-3 connection privately. `cache.ts` has
`doc_tokens`, `embeddings`, `cache_meta` — no ranking table — and no `Store`
method reaches any of them except `rebuildCache()`.
**Workaround:** `sleep/strength-cache.ts` — a `StrengthCache` port with a default
implementation over its own SQLite file at `<dataDir>/cache/strength.sqlite`,
opened LAZILY and closed with the cycle. It deep-imports `openDb` from
`store/db.js` (house precedent: `encode/` deep-imports `store/prose.js`).

Three consequences, recorded rather than hidden:

- **`rebuildCache()` does not clear it.** `resetCache` drops only its own three
  tables. This is acceptable — every row is re-materialized by the next decay
  tick from canonical state, because strength is a pure function — but it means
  box 3 currently has two owners and only one rebuild story.
- A **separate file** is deliberate, not laziness: the store holds an open
  connection to `cache.sqlite` and takes `BEGIN IMMEDIATE` on it, so a second
  connection would contend for write locks on a file the store thinks it owns.
- `paths.LAYOUT` classifies `cache/` as a directory and never inspects its
  contents, so nothing breaks — but `LAYOUT`'s `why` line for `cache` no longer
  describes everything in there.

**Real fix (store's call):** a `ranking` table in `cache.sqlite` plus
`Store.setRanking(rows)` / `Store.ranking(id)`, and `resetCache` dropping it with
the rest. Then `sleep/` injects `store` as the cache and this file goes away.

---

## 2. `self/` — the briefing render seam (INJECTED, and deliberately not imported)

**Owner:** `self/`.
**Needed:** the wake briefing re-render, as the cycle's LAST content write
(CONTRACT §3 G5).
**Have:** `self/` landed while this module was being built. `sleep/` still does
not import it — a test asserts the absence, and the two modules must be
composable in either order.
**Workaround:** `RenderFn`, injected through `SleepOptions.render`. Absent, the
phase reports `did-not-run / no-render-fn` — not a failure, and not "ran and
found nothing".

**The wiring, as of `self/`'s current surface** (one line at the coordinator):

```ts
const self = new Self({ store, gate, onEvent });
const render: RenderFn = ({ day }) => {
  const result = self.boundary({ day, budgetBytes: host.injectionCeiling, horizon });
  return { bytes: result.briefing.bytes, elements: result.briefing.elements };
};
runCycle({ store, render, /* ... */ });
```

Notes for whoever wires it:

- `budgetBytes` is **required** by `self/` and is the HOST's reported injection
  ceiling (scar §2.18). `sleep/` has no business inventing it and does not carry
  one; it must reach `runCycle`'s caller from the adapter.
- `horizon` comes from `prospective/`, not from `sleep/`.
- `self.boundary()` publishes. `sleep/` guarantees only ORDER: that the call
  happens after revision, prune, and dedup, and that nothing writes content after
  it. Atomic publish, the trim order, and the sentinel counts stay `self/`'s.
- The renderer is **never invoked under observer** — publishing is a content
  write. `BriefingContext.observer` is therefore always `false` at the call site;
  it exists so a future renderer cannot be handed an ambiguous stance.

---

## 3. `store/` — prune, promotion and merge records live in meta rows (WORKED AROUND)

**Owner:** `store/`.
**Needed:** an append-only, canonical, transactional record per prune, per
identity crossing, and per merge. CONTRACT §5 G8 makes the prune record
load-bearing: *a failed record append means nothing moves.*
**Have:** `appendRemovalRecord` is the OWNER-REMOVAL seam — its `dark` / `chased`
/ `complete` stages populate `deniedIds()` and make the memory unreadable. Using
it for a floor prune would take the memory dark, which is precisely wrong: a
pruned memory stays readable. The only other durable seam is `setMeta`.
**Workaround:** one meta row per record, keyed by memory id —
`sleep.pruned.<id>`, `sleep.promoted.<id>`, `sleep.merged.<id>`. Keying by id
(never by day or sequence) makes the write idempotent under replay, which is what
§5 G3 needs. `setMeta` is transactional, which is the load-bearing part.
**Cost:** the keyspace is unbounded and unenumerable — the same shape
`recall/INTERFACE-GAPS.md` §1 filed for gate state, and SEAMS.md #5's
`gate_session` proposal.
**Real fix:** one `sleep_record` table in box 2 (`memory_id`, `kind`, `day`,
`payload`), pruned alongside `pruneSupersededVersions`. One table serves all
three record types and all three become queryable, which is what the dashboard
(constitution line 16) will want anyway.

---

## 4. The minting seam — `updates:` must actually reach canonical state

**Owner:** whoever mints memories from `remember/`'s proposals.
**Needed:** CONTRACT §5 G9 — *a memory that declares `updates:` is never merged
into its target.* Physics checks the declaration FIRST, before hash and before
cosine, so the refusal is only as good as the field.
**Have:** `remember/` produces `Proposal.updates: UpdatesResolution | null`.
Nothing yet writes it anywhere `sleep/` can read.
**Workaround:** `dedup.declaredUpdates()` reads `doc.meta["updates"]` (a resolved
memory id, as a string) from canonical prose, which round-trips untouched
(`store/prose.ts` G6). A memory with no such key reads as "declared nothing".
**Real fix:** the minting seam persists the RESOLVED id there (or in a column),
and states which it is. Until then the guarantee is live in this module and
starved at the source — the exact shape of scar §2.6, so this is the gap to close
first.

---

## 5. `physics/` — there is no `consolidationEligibility()`

**Owner:** `physics/`.
**Needed:** "memories crossing the physics consolidation criteria get the flag".
**Have:** `consolidated` is an input to `base` (`cons(m)`, §5.2) and nothing in
physics decides when it turns on.
**Workaround:** stated in `consolidate.ts` and built ONLY from physics' exports —
*not already consolidated, not archived, at least one lived day past birth, and
`band(m, d) === "semantic"`.* Deliberately no reinforcement requirement: "a
formative one-shot consolidates without repetition" is a property physics
protects with a `max`, and a repetition gate here would quietly repeal it.
**Real fix:** `physics.consolidationEligibility(m, d): { eligible, reason,
blockedBy }`, mirroring `promotionEligibility`. Then this module executes a
crossing it does not define, exactly as it does for promotion — which is the
shape the whole contract is built on.

---

## 6. The adapter — the lock, the watchdog, and detachment (OUT OF SCOPE, DECLARED)

CONTRACT §3 and scars E4/E5 require: detached execution, a single writer with an
ATOMIC stale-lease reclaim, two watchdog levels, and the spawner pinning the
environment LAST. **None of it is in this module, deliberately** — `sleep/` is
pure math over an injected store, and a lock is neither.

What IS here, because it is arithmetic:

- `validateWatchdog(softMs, hardMs, leaseMs)` — the cross-key invariant of §5 G2.
  It REFUSES any setting where the hard kill could land at or after the lease
  becomes reclaimable, because the single-writer lease depends on a wedged runner
  dying before its lock can be taken. The adapter must call it at configuration
  load and refuse to start on a bad answer.
- `shouldSpawn(store)` — §5 G10's answer for the spawner: an observer session
  spawns no cycle.
- `CycleKilled` — the error class `runCycle` does NOT degrade. The adapter's hard
  kill is a process death, not an exception, but a watchdog that wants to abort
  cooperatively should throw this so markers stay honest.

**Also unimplemented and owned by the adapter:** §5 G11's *escalate on the nth
identical failure* and its backlog-depth metric. `runCycle` records each phase
failure with its code and moves on; nothing here remembers yesterday's failures,
so nothing here can escalate. The supervisor that spawns the cycle is the only
component that sees the sequence.

---

## 7. `store/` — there is no "under audit" concept

CONTRACT §3's decay skip list names *anything under audit*, with the audit subset
counted separately so "pin bloat from stuck ledgers" stays distinguishable from
"a change is under audit". v2 dropped the ledger subsystem
(`schemas/CONTRACT.md` §4), and no audit or forensics-hold flag exists in box 2.

`DECAY_SKIPS` therefore enumerates `under-audit` and reports it as **structurally
zero** — an enumerated-but-never-fired category, which is a different record from
an absent one (scar §2.4). If an audit hold is ever added, it belongs on the
memory row and this category starts counting without a code change here.

---

## 8. Minor — `store.list()` has no strength or dwell filter

Every phase walks all ids and reads each row. At personal scale (v1: ~12.4K
memories) that is a few SQLite scans per boundary and the budgets bound it. It is
noted because the first time this module is slow, `WHERE last_used_day < ?` in
box 2 is the answer, not a cache in this module.

**The heaviest scan is `contentHashCandidates`**, and it is the one the phase
budget does NOT bound: the dedup budget caps PAIRS examined, but candidate
generation reads every live memory's prose body off disk to hash it, before the
first pair exists. `Store.bodyDigest(id)` (or a body-hash column maintained at
write time, which is where a content address belongs) would make the pass a
single query.
