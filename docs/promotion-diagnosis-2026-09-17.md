# Why nothing reaches the identity band — diagnosis, 2026-09-17

Read-only. Code read at `/Users/mlapeter/counterparts/.claude/worktrees/step1-trial`; store read only as
`sqlite3 -readonly "file:~/.counterparts/store/operational.sqlite?immutable=1"`. Computation:
`scratchpad/promotion/eval.ts` (imports the pure physics functions; opens no store). Lived day today = 191.

> **2026-09-18 — do not reuse this recipe once the store is in WAL mode (F1, PR #137).** `?immutable=1` makes SQLite ignore the `-wal`, so every query reads the database as of the last checkpoint — silently short, no error (proved in `docs/adversarial-review-f1-2026-09-18.md`). Use plain `sqlite3 -readonly <path>`. What is written here is what was run at the time, under DELETE mode, where it was right.


## 1. The answer, plainly

Three doors have to open on the same night, and one of them has never opened for two thirds of the store.

1. **The nightly pass that asks the promotion question stops after 5,000 memories and starts from the same
   place every time.** The store has 15,292 rows it would examine; the pass has never looked past about the
   5,300th of them, and nothing carries over. **10,000+ memories have never once been asked whether they belong
   to who you are, and under today's settings never will be.**
2. **For the rows it does reach, the bar is 0.85** on a score that is mostly "how much did the author say this
   matters", **plus 0.2 once a memory has been consolidated** — and consolidation happens in that same capped
   pass. Nine of your ten most-reinforced memories sit outside the cap and so never get the +0.2; eight would
   clear the bar the moment they did. The tenth is inside the cap and is the only one of the ten consolidated —
   which is how we know the cap is the mechanism and not a coincidence.
3. **A transcript-sweep memory can never promote on its claim**: that channel's claim is capped at 0.6, and
   0.6 + 0.2 = 0.80, below 0.85, forever.

For anything born here there is a fourth door: use on **3 distinct days**, where a footnote counts **zero** and
only ~28 memory-uses have been credited in the whole 14-day run — nothing born here has reached 2. The 20
identity memories came from v1 at import; **19 of them would fail today's own test.**

## 2. The evidence

### The predicate as the code has it

```
promotionEligibility(m)                     physics/index.ts:494-510
  base(m) >= THETA_ID (0.85)                :499, :43     <- BASE, not decayed strength
  AND reinforcedDays(m) >= N (3)            :500, :46
base(m) = max(wSal*sal(m), wRep*rep(m)) + cons(m)          :403-406
  sal(m) = max( mean(novelty?,relevance,emotional,predictive), claimed )   :254-261
  rep(m) = min(0.12*uses, 0.5)  :387        cons(m) = 0.2 if consolidated  :391
```

Called **only** from `sleep/consolidate.ts:119`, inside `runConsolidate` (the other door is revision
inheritance, `revision.ts:310`). `store.list()` (`consolidate.ts:73`) returns **all** rows `ORDER BY id`
(`store/index.ts:1752-1756`); the loop breaks at `out.examined >= ctx.budget` (`consolidate.ts:77`) with
`BUDGETS.consolidate = 5_000` (`sleep/tunables.ts:30`), and there is **no cursor** — grep for cursor/offset in
`src/core/sleep/*.ts` returns nothing, and `cycle.ts:248` states "a budget is not a debt".

Structural ceilings (script output): rep arm alone 0.5+0.2 = **0.70** < 0.85 (intended, `index.ts:33-35`);
sweep claim 0.6+0.2 = **0.80** (`:59`); authored default claim 0.25+0.2 = 0.45 < THETA_SEM (`:87`). At
`wSal = 0.4` — **skill and place** (`:163-164`) — max possible base is 0.70, so **those two kinds can never
enter identity by any path**.

### The budget wall, measured

- Rows `store.list()` examines: **15,292** (`archived=0 AND type<>'episode'`; schema rows consume budget —
  `isJournal` is episode-only, `sleep/types.ts:498`). Budget 5,000/night, no carry.
- Highest examinable-index among the 517 rows with `consolidated=1`: **5,300** (window function over
  `ORDER BY id`). It exceeds 5,000 only because the window sat further along the id space when the store was
  smaller; the reachable fraction is 5,000/N and only shrinks.
- Migration never writes `consolidated` (`grep -n consolidated tools/migrate/{plan,apply}.ts` → no hits), so
  that clustering is the sleep phase's own footprint, not an import artifact.
- Of 822 semantic rows still unconsolidated, **783 are unreachable** (`ex > 5000`).
- High-claim (≥0.85) authored rows inside the window: **2 of 11** — and exactly those 2 are consolidated.

### (a) the ten live semantic rows with `reinforced_days` ≥ 3 — all `source=migrated`

Every one is refused today by the same clause, `base-below-identity-threshold`; `sal = claimed` for all ten
(their dimension means are lower). Columns: base now → base if consolidated → verdict then.

| id | kind | claim | base now | +cons | then | examinable index |
|---|---|---|---|---|---|---|
| mem_3ba7 | self | 0.55 | **0.750** (already cons) | 0.75 | still refused | **3,509 — inside** |
| mem_82f6 | self | 0.80 | 0.800 | 1.00 | **ELIGIBLE** | 7,654 |
| mem_9c4e | self | 0.80 | 0.800 | 1.00 | **ELIGIBLE** | 9,143 |
| mem_5cfe | self | 0.80 | 0.800 | 1.00 | **ELIGIBLE** | 5,491 |
| mem_e150 | self | 0.80 | 0.800 | 1.00 | **ELIGIBLE** | 13,035 |
| mem_6c68 | self | 0.80 | 0.800 | 1.00 | **ELIGIBLE** | 6,398 |
| mem_ba8c | self | 0.75 | 0.750 | 0.95 | **ELIGIBLE** | 10,823 |
| mem_f195 | person | 0.72 | 0.720 | 0.92 | **ELIGIBLE** | 13,966 |
| mem_d722 | fact | 0.70 | 0.700 | 0.90 | **ELIGIBLE** | 12,464 |
| mem_9d42 | fact | 0.55 | 0.550 | 0.75 | still refused | 9,206 |

`consolidationEligibility(m, 191)` returns **eligible** for all nine unconsolidated ones: nothing refuses them
but the budget. The last column is the diagnosis — the only row inside the window is the only one consolidated.

### (b) the twenty identity rows (all `source=migrated`)

`base` 0.85 – 1.15; **20/20 clear THETA_ID**, **1/20 clears `reinforced_days` ≥ 3** → **19/20 would be refused
by today's door**. They did not use it: `tools/migrate/plan.ts:221,414` sets `promotedIdentity` when the v1
gradient ≥ `IDENTITY_GRADIENT_CUT` (0.85) and maps that gradient into `claimed` — hence every identity row's
claim of 0.85–0.95. The one `band.promoted` event is dated 2026-09-03, the import day. **What v1 did
differently is exactly this:** there, high salience *was* the identity band
(`docs/harvest/replay-baselines.md:377`), repetition was capped below it and only revision crossed
(`docs/harvest/behavioral-spec.md:970-976`). Counterparts closed that birth door on purpose
(`physics/CONTRACT.md:131-137`, review finding 2) and replaced it with promotion-at-consolidation — and the
replacement has never fired.

### (c) best-case authored memory, today's rules

claim 0.80 with all three dims 0.9 → sal 0.900, base **0.900 → eligible on base alone, no consolidation
needed**; claim 1.0 → base 1.0 (1.2 consolidated). With the silent default (0.25, dims 0): base 0.45, refused.
So for born-here memories the binding gate is **not** THETA_ID — it is `reinforced_days` plus the budget wall.
**Minimum lived days to identity: 3** (credit never on the birth day, at most one per day,
`physics/index.ts:685-700`), rounded to the next consolidate night (cadence 3, `sleep/tunables.ts:16,53`) →
**3–5 lived days in theory**, and only if the id lands in the first 5,000. In practice nothing has: the credit
site books `"referenced"` for everything (`counterpart.ts:1527`) but almost nothing is credited —
`W_FOOTNOTED = 0.0` (`:112`), and `recall.decision` sums to **1,280 footnotes against 7 surfaced** while
`recall.credit` sums to **28 credited memories in 12 events** (a floor: unlatched event rows are swept). Live
`reinforced_days` ≥ 1 by source: migrated 139, authored **1**, fallback **2**; no born-here row exceeds 1.

### (d) best-case swept (fallback) memory

Claim-driven: capped at 0.6 → base 0.80 consolidated → **refused, permanently**. Dimension-driven is the
loophole: `sal` takes the *max* of claim and computed mean, and the best live fallback 4-dim mean is **0.714**
→ base 0.914 consolidated → eligible. Swept memories are *rare*, not impossible (14 fallback rows have a mean
≥ 0.65). The `emotional` dimension is a quarter of that mean and near-dark (ruling C1,
`docs/contracts-sweep-trial-physics-2026-09-17.md:114-121`; live means migrated 0.011, authored 0.068, fallback
0.217), which is what keeps computed means low: **the highest computed mean in the store is 0.833 — nothing has
ever reached 0.85 on dimensions alone.**

### Cadence and telemetry

`consolidate` cadence 3 lived days (`sleep/tunables.ts:16,53`). Of 239 `sleep.cycle` rows the phase reads `ran`
**once** (09-16, day 190, reason `completed`, so it changed ≥1 row); the rest `did-not-run`. The durable row
copies only `phase/status/reason` (`counterpart.ts:2243-2254`) although the report carries `examined`,
`changed`, `budgetExhausted`, `skippedForBudget` (`cycle.ts:225-233`) — **the store cannot say that a phase
stopped at its budget.** That is the scar §2.4 gap that hid this.

## 3. Options, smallest first

**Option 1 — raise `BUDGETS.consolidate` to cover the store (RECOMMENDED).** One number,
`sleep/tunables.ts:30` (decay already runs at 20,000, `:29`). *Changes:* no physics, no threshold, no
semantics — only "every row gets asked". *Blast radius, computed:* 822 semantic rows consolidate on the first
full night (+0.2 base each, which also makes them stickier in the semantic band; plus the 12 unconsolidated
identity rows, which are decay-exempt already, so no effect) and **exactly 8 promote** — the eight
above, all migrated, all graded 0.70–0.80 by v1; identity 20 → 28. No born-here row promotes: only 15 rows
store-wide have `reinforced_days` ≥ 3, and the 4 outside this set are episodic with claims ≤ 0.55. *Risk to
respect:* it is a one-time catch-up, not a new rate — afterwards promotion is rate-limited again by 3-distinct-
day reinforcement (~2 credits/day store-wide). The real question is whether those eight belong in "who I am",
which is a judgment about eight memories, not about a constant. *Seen working:* `band.promoted` rows (durable,
latched, `consolidate.ts:136-142`); `COUNT(*) WHERE promoted_identity=1` → 28; `sleep.cycle.promoted` = 8 on
the first full night; `consolidated=1` 517 → ~1,339. *Cheaper variant, not silently:*
`store.list({band:"semantic",archived:false})` scans less but drops the "episodic row whose base already clears
0.85" case — a semantics change, not a budget change.

**Option 2 — persist the budget numbers on the `sleep.cycle` row** (`counterpart.ts:2243-2254`: copy
`examined`, `changed`, `budgetExhausted`, `skippedForBudget`, which already exist at `cycle.ts:230-231`).
*Changes:* telemetry only. *Risk:* payload size. *Seen working:* tomorrow's row reads
`consolidate {examined: 5000, skippedForBudget: 10292, budgetExhausted: true}`, and `false` after option 1.
Independent of option 1 and worth doing with it: without it, the next silent truncation is invisible again.

**Option 3 — credit at the tier actually used.** The credit site books `"referenced"` for everything
(`counterpart.ts:1527`) while `W_SURFACED = 0.25` has never fired and footnotes train nothing; this is the gate
that keeps *born-here* memories from ever reaching 3 distinct days. *Risk:* crediting footnotes would train on
everything the ranker shows — the v1 ratchet these weights exist to prevent. A calibration question, not a flag
flip. *Seen working:* `reinforced_days` ≥ 2 on an authored row at all (max today: 1). **Name it; do not bundle
it with option 1.**

**Option 4 — lower `THETA_ID` or admit a 0.8 claim. NOT recommended.** 400 live episodic rows already carry
`claimed` ≥ 0.85; the bar is the only thing keeping identity slow, and it is also what makes "repetition alone
never promotes" arithmetic rather than a check (`index.ts:33-35`). Fix the pass that never runs before touching
the number it would have run against.

Nothing here removes a mechanism. It is not silent because it is wrong; it is silent because it is never asked.

## 4. What I could not determine

- **Whether the 09-16 `consolidate` run touched 1 row or 400** — the durable row carries no counts (option 2),
  and `sleep.consolidated` is a ring-only event (`cycle.ts:106-120`) absent from the events table, so its
  absence proves nothing. Likewise **why 517 rows are consolidated when only one phase shows `ran`**:
  `sleep.cycle` rows only start 09-14. INFERENCE: pre-09-14 nights did the bulk, against a smaller store.
- **Whether `list()` order stays uniform for future ids** — `ORDER BY id` on hex ids implies new rows land
  uniformly (reachable fraction 5,000/N), but I did not read the id generator. Archived rows are out of scope:
  every query except the identity census was scoped `archived=0`.
- **Whether the eight rows option 1 would promote deserve to be part of the self.** I read no titles or bodies,
  by instruction.
