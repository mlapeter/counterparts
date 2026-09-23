# Why recall surfaces almost nothing — 2026-09-18

Read-only diagnosis. No code changed, no store written. Live store read only through
`sqlite3 -readonly "file:…/operational.sqlite?immutable=1"`; counts and aggregates only.

> **2026-09-18 — do not reuse this recipe once the store is in WAL mode (F1, PR #137).** `?immutable=1` makes SQLite ignore the `-wal`, so every query reads the database as of the last checkpoint — silently short, no error (proved in `docs/adversarial-review-f1-2026-09-18.md`). Use plain `sqlite3 -readonly <path>`. What is written here is what was run at the time, under DELETE mode, where it was right.


---

## The answer, plainly

**One number is doing all of it.** To be read aloud ("came to mind"), a memory needs an
activation score of at least `FLOOR_STRONG_DEFAULT_UNITS × one-maximally-rare-cue` =
`4.5 × 8.96` ≈ **40.3** on today's store. Over the 396 recalls since 2026-09-10, the
best candidate of the turn reached that number **3 times**. And all three times, it
surfaced. Nothing else ever got the chance to refuse: **no candidate anywhere in the
window scored 40.3 and was then held back** by the relative bar, the cue-fraction gate,
lateral inhibition, the byte budget or the cap. The best footnote ever seen in the window
was 37.7.

So: it is not a threshold *and* a budget *and* a semantic problem. It is one bar, and the
turns are landing just under it. Median best-candidate = 13.7 (1.5 cue units). p90 = 22.0
(2.5 units). p99 = 37.7 (4.2 units). The bar is 4.5 units.

**Is that a fault?** Mostly no — it is a bar set in September on a different kind of
turn, now facing a different kind of turn. The bar was calibrated on 2026-09-04 against
13 prompts from a real *conversation*, where the best candidate ran 0.88–5.17 cue units
and 4.5 gave "loud on 3 of 13 turns", the stated design target of "at most about one in
four". The parallel run since 09-10 is almost entirely *Claude Code work sessions* — short
operational prompts about files and PRs — and that corpus's best candidates sit roughly
half as high. The same 4.5 that meant "one turn in four" on conversation means "one turn
in 130" here. The design is working exactly as written; the calibration corpus no longer
resembles the live corpus.

**Three things that are *not* the cause**, despite looking like candidates:
- The byte budget. 9,000 bytes granted, ~600 used. It has never bound.
- Latency aborts. Zero aborted turns in the window.
- The footnote cap. Footnotes average 2–4.5 per turn against a cap of 6.

**One thing that looks like a wiring bug**, separate from the tuning question:
`SEMANTIC_WEIGHT` is still 1.0 on v1's 0–1 cosine scale, while the cue channel now sums
to 10–40. A perfect embedding match contributes at most **1.0** against a 40.3 bar — 2.5%
of it, or 0.11 of one cue unit. The semantic leg fires on 63% of turns (248 `lagged` of
396) and **cannot change any outcome**. This is the identical scar the floors and
`prospective.CUE_STRENGTH` were both rescued from on 09-04 (a v1 number carried into a
v2 scale); `SEMANTIC_WEIGHT` was not in that sweep.

**And "a footnote counts zero" is only half true.** Credit has two doors. The *quote*
door only looks at memories that surfaced loud, so it is starved — 0 quotes in 256
passes. The *expansion* door — the model calling the MCP `recall` tool with an id — has
no tier restriction at all, and it is where **28 of 28 credits came from**, and **all 28
of those ids had been footnoted first**. The OQ4 step-1 probe wording ("expand an id with
recall before citing one") is the only thing currently feeding reinforcement, and it is
working.

---

## 1. Why recall surfaces almost nothing

### The path

`src/adapters/claude-code/hooks.ts` (UserPromptSubmit) → `Counterpart.recall` →
`src/core/recall/index.ts:343 activate()` → `:379 gate()` → `render()`.

Scoring, `src/core/recall/activate.ts:389`:

```
activation = cue + semantic + arrival + hops
```

- `cue` — Σ over cue tokens of `informativeness(df, N) × BM25-normalized evidence`
  (`activate.ts:228`), capped per document at `CUE_DOC_CAP × strongest single cue`
  (`:249`). Grows with store size: `informativeness(1, N) = log((N+1)/2)`.
- `semantic` — `SEMANTIC_WEIGHT × scaled cosine`, `activate.ts:304`. Bounded by 1.0.
- `arrival` — `ARRIVAL_WEIGHT (0.15) × strength`, `activate.ts:378`. Strength is O(1).
- `hops` — spreading, denominator-only for `cueFraction`.

### The gates, in the order `gate.ts` applies them

| order | gate | file:line | binding here? |
|---|---|---|---|
| 1 | confidentiality | `gate.ts:321` | no |
| 2 | uncued is dark | `gate.ts:327` | structural |
| 3 | session dedup | `gate.ts:337` | **see §1.4** |
| 4 | absolute floor `FLOOR_GLOBAL_UNITS × unit` = 0.2 × 8.96 = **1.79** | `gate.ts:342` | admission only |
| 5 | relative admission bar, leave-one-out, salience-modulated | `gate.ts:348` | admission only |
| 6a | `maxTier === "footnoted"` (temporal-only cue) | `gate.ts:358` | rare |
| 6b | cold-start undiscriminating | `gate.ts:361` | no (N=15,597) |
| 6c | `cueFraction < MIN_CUE_FRACTION (0.5)` | `gate.ts:376` | **never reached** |
| 6d | **`activation < strongFloor` = 4.5 × 8.96 = 40.33** | `gate.ts:379` | **THIS ONE** |
| 6e | relative loud bar `mean + 2.5·sd` (LOO) | `gate.ts:382` | **never reached** |
| 7 | lateral inhibition (`NEAR_DUPLICATE` 0.85) | `gate.ts:395` | no |
| 8 | `MAX_SURFACED = 1` cap | `gate.ts:410` | no |

The knob: `src/core/recall/tunables.ts:269 FLOOR_STRONG_DEFAULT_UNITS: 4.5`, converted to
activation by `tunables.ts:327 strongFloor()` against `gate.ts:175 floorUnit()`.

### 1.1 The store's own numbers

```sql
-- live memories (the storeSize recall passes; index.ts:337 store.list({archived:false}))
select count(*) from memories where archived=0 and superseded_by is null;   -- 15597
```

`floorUnit = log((15597+1)/2) = log(7799) = 8.9617`.
Admission floor `0.2 × 8.9617 = 1.79`. Loud floor `4.5 × 8.9617 = **40.33**`.

Top-of-turn activation, all 396 recalls 09-10 → 09-18:

```sql
with d as (select json_extract(payload,'$.date') dt, payload from events
           where name='recall.decision' and json_extract(payload,'$.date')>='2026-09-10'),
 top as (select coalesce(
   (select max(json_extract(v.value,'$.activation')) from json_each(json_extract(d.payload,'$.surfaced')) v),
   (select max(json_extract(v.value,'$.activation')) from json_each(json_extract(d.payload,'$.footnotes')) v),
   0) t from d)
select ... ;
```

| statistic | activation | cue units |
|---|---|---|
| p50 | 13.66 | 1.52 |
| p75 | 17.62 | 1.97 |
| p90 | 22.03 | 2.46 |
| p99 | 37.71 | 4.21 |
| max | 52.42 | 5.85 |
| **loud floor** | **40.33** | **4.50** |

### 1.2 The three surfacings are the floor, exactly

```sql
select datetime(at/1000,'unixepoch'), json_extract(payload,'$.date'),
       json_extract(payload,'$.turn'), json_extract(payload,'$.surfaced')
from events where name='recall.decision'
  and json_extract(payload,'$.surfacedCount')>0
  and json_extract(payload,'$.date')>='2026-09-10';
```

| when | turn | id | activation | vs floor 40.33 |
|---|---|---|---|---|
| 2026-09-13 18:09 | 9 | `mem_271035ca7e73` | 52.42 | +12.1 |
| 2026-09-14 15:36 | 7 | `mem_8c449faac3dd` | 40.99 | +0.66 |
| 2026-09-16 16:57 | 1 | `mem_aba72c7a862e` | 40.39 | **+0.06** |

Two of the three cleared the bar by less than 2%. Nothing about those turns was special —
they are not first turns, not a particular date, not a particular session. They simply
had one unusually rare, unusually well-matched cue.

And the converse, which is the clinching count:

```sql
-- any footnote (i.e. admitted but kept quiet) that scored at or above the loud floor?
select count(*) from events e, json_each(json_extract(e.payload,'$.footnotes')) v
where e.name='recall.decision' and json_extract(e.payload,'$.date')>='2026-09-10'
  and json_extract(v.value,'$.activation')>=40.33;                 -- 0

select round(max(json_extract(v.value,'$.activation')),2) from ... ;  -- 37.72
```

Zero. **Every candidate that reached the loud floor went loud; nothing that reached it was
stopped by anything else.** The cue-fraction gate, the relative loud bar, inhibition and
the cap have not refused a single loud candidate in the window. (Blind spot: the durable
record lists only surfaced + footnoted items, so a candidate stopped at gate 3, 4 or 5 is
invisible. §1.4 addresses the one of those that matters.)

### 1.3 The semantic leg: "none"/"lagged"/"stale", and why it cannot matter

`semantic` in the `adapter.recall` payload is `SemanticSource` (`session.ts:304`):
- `none` — no lag row and nothing offered (first turn of a session, or a core caller).
- `lagged` — a fresh ranking the detached worker computed *after the previous turn* was
  used. This is the intended live path (CONTRACT §5 G17: never embed on the hot path).
- `stale` — a lag row exists but is older than one turn (the worker did not finish, or
  two turns arrived back to back).

```sql
select json_extract(payload,'$.semantic'), count(*) from events
where name='adapter.recall' and json_extract(payload,'$.date')>='2026-09-10' group by 1;
```

| source | count | share |
|---|---|---|
| lagged | 248 | 63% |
| stale | 75 | 19% |
| none | 73 | 18% |

So the semantic channel *is* wired and firing on nearly two turns in three. It is simply
numerically invisible: `activate.ts:304` writes `SEMANTIC_WEIGHT × scaled` with
`SEMANTIC_WEIGHT = 1.0` (`tunables.ts:200`), so the whole channel's ceiling is **1.0
activation against a 40.33 bar**. In the unit the floors now use, a perfect embedding
match is worth **0.11 of one maximally-rare cue**.

This is precisely the failure mode CONTRACT §4 describes and §7 OQ5 closed for the
floors, and that `activate.ts:265-272` fixed a second time for `prospective.CUE_STRENGTH`
("a temporal cue would be worth 0.23 of a maximally-rare word on a seventeen-memory store
and 0.056 of one on a fifteen-thousand-memory store"). `SEMANTIC_WEIGHT` is the third
instance and was never converted — it is still flagged `CAL` / v1-inherited in
`tunables.ts:58-59`. See §4, option D.

### 1.4 Footnotes eat the loud tier's candidates (a design question, not a bug)

`index.ts:489-492` writes **both** tiers into `state.surfaced`. `gate.ts:337` then
dedup-suppresses anything in that map **before** the floor is even checked. So a memory
footnoted on turn 1 can never go loud on turn 9 of the same session, however sharply the
conversation later converges on it.

The shape shows in the data. Top activation and footnote volume both decay within a
session:

| turn bucket | turns | avg top activation | avg footnotes | turns with nothing |
|---|---|---|---|---|
| 1 | 24 | 16.8 | 4.42 | 0 |
| 2–3 | 39 | 16.3 | 4.51 | 0 |
| 4–6 | 54 | 15.4 | 3.98 | 0 |
| 7–12 | 93 | 15.9 | 3.41 | 5 |
| 13+ | 186 | 10.2 | 2.02 | 56 |

One session (`4ebf5615…`) burned 154 distinct memories into its dedup map. `gate_session`
holds 1,193 `surfaced`-kind rows of which **1 is tier `surfaced`**; the rest are
footnotes occupying the dedup slot.

Whether that is right is an owner call, not a fault: the contract's own framing is
"tiers are disjoint" and "a memory is 'came to mind' *or* 'quietly available', never
both" (CONTRACT §3 G16). But it does mean the footnote tier is spending the loud tier's
ammunition, and the effect is not measurable from the durable record because a
dedup-suppressed candidate is not written down.

---

## 2. Design, or fault?

**Design, with a stale calibration.** The loud tier is explicitly "rarely a surfaced
gist" (CONTRACT §3, first bullet). `MAX_SURFACED` was cut 2 → 1 on 09-04 precisely to
halve what the owner reads uninvited (`tunables.ts:287-294`). The bar was *meant* to be
high.

The calibration that set it (`tunables.ts:250-256`, commit `9991dec` 2026-09-04, "Recall:
count rarity, and put the absolute floors in the model's own unit"):

> Sorted, the thirteen best candidates leave their widest upper gap between 4.20 and
> 4.68, and 4.5 sits in it: loud on 3 of 13 turns (23%, against a target of "at most about
> one in four").

Git history confirms nothing has moved since: `git log -- src/core/recall/gate.ts` ends at
`de28e3d` (09-04); `tunables.ts`'s last touch is `89c8cae` (09-14) and changed only
footnote byte width and the OQ4 probe string. `git log -S'FLOOR_STRONG_DEFAULT_UNITS'`
returns only `9991dec` and `cc025ff` (both 09-04) and yesterday's docs commit. So the
09-11 → 09-18 starvation is **not a regression**; the knob is where it was left.

### What actually changed: the corpus, and the 09-04 numbers were inflated

Per-day, over the whole event log:

| date | recalls | surfaced | footnotes | avg top activation | turns with top ≥ 40.3 |
|---|---|---|---|---|---|
| 09-03 | 4 | 0 | 8 | 25.5 | 1 |
| 09-04 | 70 | **4** | 114 | 26.9 | 11 |
| 09-10 | 29 | 0 | 98 | 14.8 | 0 |
| 09-11 | 40 | 0 | 153 | 14.4 | 0 |
| 09-13 | 13 | 1 | 50 | 17.8 | 1 |
| 09-14 | 95 | 1 | 161 | 11.3 | 1 |
| 09-15 | 17 | 0 | 48 | 16.1 | 0 |
| 09-16 | 84 | 1 | 297 | 14.8 | 1 |
| 09-17 | 114 | 0 | 370 | 12.0 | 0 |
| 09-18 | 4 | 0 | 13 | 17.8 | 0 |

Note the `turns with top ≥ 40.3` column equals the `surfaced` column exactly from 09-10
on. That is §1.2 again: the floor is the whole story.

09-04 looks like a golden age and was not. Splitting it by hour (UTC):

| hour | recalls | avg top | max top | surfaced |
|---|---|---|---|---|
| 02 | 5 | 67.5 | 154.5 | 0 |
| 04 | 10 | 41.0 | 211.8 | 2 |
| 14 | 5 | 86.9 | 227.5 | 0 |
| 15 | 18 | 10.6 | 97.1 | 0 |
| 17 | 5 | 37.9 | 64.7 | 2 |
| 18 | 9 | 15.6 | 24.7 | 0 |
| 20 | 11 | 15.0 | 24.9 | 0 |
| 21 | 2 | 8.8 | 17.5 | 0 |

The df-counting fix (`9991dec`) deployed between the 17:00 and 18:00 turns. Before it,
every common word measured as rare and activations were inflated 3–10×; all four of
09-04's surfacings are on the pre-fix side. **After the fix, the live path has behaved
identically on every day measured: avg top 10–18, surfacings 0–1.** There was never a
post-fix period when surfacing was common.

So the honest reading: the 4.5 bar was picked on a 13-prompt *conversation* bench whose
best candidates ran 0.88–5.17 units, and the live corpus since 09-10 is coding work whose
best candidates run ~1.5 units at the median and ~2.5 at p90. Both are true measurements
of different things.

---

## 3. What credit actually credits

`counterpart.ts:1491 creditReferences()` → `recall/reference.ts:153 resolveReferences()`.

**Door one — expanded** (`reference.ts:160-169`). Every `mem_…`-shaped string the
assistant passed as `ids` or `handle` to the MCP `recall` tool during the slice. Read
from the transcript by `adapters/expansions.ts` / `transcript.ts#expansionIdsOf` — never
parsed out of prose (`reference.ts:22-26`). **This door has no tier check whatsoever.**
An id the model expands is credited whether it was surfaced loud, footnoted, or never
delivered at all.

**Door two — quoted** (`reference.ts:178-190`). An 8-consecutive-word verbatim run of a
memory's body in one assistant turn, requiring ≥3 content words. Candidates come from
`counterpart.ts:1502-1503`:

```ts
for (const [id, rec] of Object.entries(state.surfaced)) {
  if (rec.tier !== "surfaced" || !rec.trains) continue;
```

— **loud only**. With ~0 loud surfacings, `candidates` is empty on nearly every pass, and
`counterpart.ts:1576` then writes `reason: "no-candidates"`.

### The counts

```sql
select json_extract(payload,'$.reason'), count(*),
       sum(json_extract(payload,'$.credited')), sum(json_extract(payload,'$.expanded')),
       sum(json_extract(payload,'$.quoted')), sum(json_extract(payload,'$.considered'))
from events where name='recall.credit' group by 1;
```

| reason | passes | credited | expanded | quoted | considered |
|---|---|---|---|---|---|
| `credited` | 12 | 28 | 33 | 0 | 0 |
| `no-candidates` | 199 | 0 | 0 | 0 | 0 |
| `nothing-to-credit` | 45 | 0 | 11 | 0 | 40 |

- **All 28 credits came through the expansion door. Zero through quoting, ever.**
- The 199 `no-candidates` passes are exactly "no loud surfacing this session *and* the
  model expanded nothing".
- The 45 `nothing-to-credit` passes had 40 `considered` (a session that *did* hold a loud
  candidate, re-examined at each of its boundaries) and 11 expansions that credited
  nothing. Their refusal reasons: `{}` ×40 (a loud candidate present, no verbatim quote
  found — the quote door firing correctly and finding nothing),
  `already-credited-at-or-above` ×4, `birth-day` ×1.

### "A footnote counts zero" — correcting it

```sql
with exp as (select distinct value id from events, json_each(json_extract(payload,'$.expandedIds'))
             where name='recall.credit'),
     fn  as (select distinct json_extract(v.value,'$.id') id from events e,
             json_each(json_extract(e.payload,'$.footnotes')) v where e.name='recall.decision'),
     su  as (select distinct json_extract(v.value,'$.id') id from events e,
             json_each(json_extract(e.payload,'$.surfaced')) v where e.name='recall.decision')
select (select count(*) from exp),
       (select count(*) from exp where id in (select id from fn)),
       (select count(*) from exp where id in (select id from su));
```

→ **28 expanded ids, 28 of them previously footnoted, 0 previously surfaced.**

So the correct statement is:

- A footnote earns **zero** from being *shown*. (Right, and intended:
  `physics W_FOOTNOTED = 0.0`; CONTRACT §3, "never for being named, surfaced, footnoted,
  or rendered in a wake".)
- A footnote the model **expands via the MCP `recall` tool earns full `referenced`
  credit**, and this is the only credit path that has ever fired on this store. It is the
  OQ4 step-1 probe working exactly as designed: the wording
  `render.ts#FOOTNOTE_HEADER` ("expand an id with recall before citing one") went live
  2026-09-14, and every credited pass is dated 09-16 or 09-17.
- A **loud** surfacing is worth credit only if the model then quotes it verbatim
  (8 words, ≥3 content words) — which has happened **0 times in 256 passes**.

### Does the MCP adapter record anything durable?

**No.** `src/adapters/mcp/server.ts:658` emits `mcp.recall`, but that emit goes to the
in-process event ring, not the durable log:

```sql
select name, count(*) from events where name like '%mcp%' group by name;   -- (no rows)
```

Zero `mcp.*` rows in the store. The only durable trace of an MCP `recall` call is the
downstream `recall.credit.expanded` / `expandedIds` at the session boundary — which is
why `counterparts probe-oq4` reads that field. An expansion whose boundary hook never ran
leaves no record at all.

---

## 4. Options, with estimates from the store's own decision data

All estimates from the 396 recalls and 24 sessions of 09-10 → 09-18. They are **upper
bounds**: the record does not carry `cueFraction` or the per-candidate relative loud bar,
so a lowered floor could still be refused by gate 6c or 6e. Evidence that this is a small
correction: at the current floor, 3 turns cleared it and 3 surfaced — those gates refused
nothing.

```sql
with d as (select json_extract(payload,'$.session') sess, payload from events
           where name='recall.decision' and json_extract(payload,'$.date')>='2026-09-10'),
 t as (select sess, coalesce((...surfaced max...),(...footnotes max...),0) a from d)
select sum(a>=40.33), sum(a>=35.85), sum(a>=31.37), sum(a>=26.89), sum(a>=22.40), sum(a>=17.92) from t;
```

| `FLOOR_STRONG_DEFAULT_UNITS` | activation bar | turns that would surface | share of 396 | sessions reaching ≥2 loud candidates (of 24) |
|---|---|---|---|---|
| **4.5 (today)** | 40.33 | **3** | 0.8% | 0 |
| 4.0 | 35.85 | 6 | 1.5% | 0 |
| 3.5 | 31.37 | 12 | 3.0% | 2 |
| 3.0 | 26.89 | 18 | 4.5% | 4 |
| 2.5 | 22.40 | 40 | 10.1% | 12 |
| 2.0 | 17.92 | 92 | 23.2% | 16 |

Note the last column is *candidates for the quote door*, not credits. Crediting still
requires the model to quote verbatim, which it has never done. Lowering the floor alone
does not obviously produce credit; it produces something for the quote door to look at.

### Option A — leave it

The loud tier is doing what CONTRACT §3 says: rarely. The reinforcement loop is not in
fact dead — it is running entirely on the expansion door, 28 credits in two days, and
9 of the 12 credited passes had ≥2 memories credited (the learned-association threshold).
**Cost:** the quote door stays dead, and "came to mind" is a tier the owner has read
three times in a fortnight. **What it concedes:** the measured 09-04 calibration no longer
describes the corpus it runs on, and nobody has decided whether that matters.

### Option B — re-earn the floor against the corpus it actually runs on (recommended)

`FLOOR_STRONG_DEFAULT_UNITS` 4.5 → **3.0**, which is where this corpus's own upper gap
sits the way 4.5 sat in the 13-prompt bench's. Estimate: **18 of 396 turns (4.5%)**
surface something, 4 of 24 sessions accumulate ≥2 loud candidates. That is ~2 loud lines
a day at the owner's current volume, not a flood.
**Trade-off:** it is a *second* calibration against a *second* corpus, and the two
disagree. The honest framing is that the knob is corpus-dependent and the bench that set
it should be re-run on work-session prompts before the number moves — `tools/recall-bench`
exists for exactly this. **Do not** move it to 2.0: 92 of 396 turns (23%) is the flood the
09-04 change was made to stop.
**If the owner wants one number changed today and nothing else**, 3.5 is the cautious
version: 12 turns (3.0%), 4× today, still well inside "rarely".

### Option C — let a footnote be promoted to loud later in the same session

Move the dedup check (`gate.ts:337`) so it suppresses re-delivery *at the same or a lower
tier* rather than outright, letting a memory footnoted on turn 1 go loud on turn 9 when
the conversation converges on it. **Estimate: not computable from the store** — a
dedup-suppressed candidate is never written to `recall.decision`, so there is no evidence
either way. It would need an instrument first (a count of suppressed candidates and their
activations, which is a new field on a record whose field list the parallel run's ratings
are carried across — see CONTRACT §5 G15/G16, so not free).
**Trade-off:** it is a real change to "tiers are disjoint" (CONTRACT §3 G16) and would
make the same memory appear twice in one session in two costumes. Probably the wrong
first move; worth naming so it is not rediscovered.

### Option D — re-denominate `SEMANTIC_WEIGHT` in cue units ⚠️ flag as a wiring issue, not tuning

`activate.ts:304` writes `SEMANTIC_WEIGHT (1.0) × scaled cosine` into a sum whose other
terms run 10–40. The channel's entire dynamic range is 2.5% of the loud floor. Every
other v1-scale number in this file has already been converted — the three floors and
`prospective.CUE_STRENGTH`, both on 09-04, both with the same reasoning written out in
the comments — and this one was missed.
**Estimate: not computable from the store.** `RECALL_DECISION_FIELDS` carries only
`{id, sal, activation}` per item, so per-candidate semantic contribution is not recorded.
What *is* arithmetic: multiplying by `floorUnit` (8.96) would let a perfect match add
~9 activation, i.e. one full cue's worth, which is the size `prospective.CUE_STRENGTH`
was given. The top footnote of the window (37.72) would clear 40.33 with such a hit.
**Trade-off:** this is not a small knob turn — it wakes a channel that has been asleep on
every live turn since it was built, and it should be measured on `tools/recall-bench`
with turn vectors before it ships, not reasoned into. But leaving it means the embedding
worker, the backfill and the lag row are all paying for something that cannot move an
outcome. **This is the one item here I would call a fault rather than a tuning question.**

### Also worth separating out

- **`stale` semantic on 75 of 396 turns (19%)** — the worker did not land a fresh lag row
  before the next turn arrived. CONTRACT §5 G17 anticipates the race ("cheap to detect,
  not worth a lock"), so this is expected behaviour; it is only worth noting because it
  makes the semantic channel dark on nearly a fifth of turns on top of §1.3.
- **Coactivation buffer dies at hook exit** — already diagnosed
  (`counterpart.ts:1604-1618`, mechanism inventory §3 S3). Not re-litigated here, but it
  is the reason 9 credit passes with ≥2 credited memories produced no learned edges.

---

## Queries run (all read-only, counts and aggregates only)

```
sqlite3 -readonly "file:$HOME/.counterparts/store/operational.sqlite?immutable=1" "<q>"
```

1. `select count(*) from memories where archived=0 and superseded_by is null;` → 15597
2. `select name,count(*) from events where day>=185 group by name;` → event inventory
3. per-date `recall.decision` counts with `surfacedCount` / `footnoteCount` / `aborted`
4. per-date and per-hour top-candidate activation via `json_each` over `$.surfaced` /
   `$.footnotes`
5. percentiles of top activation, 09-10 → 09-18
6. `count(*)` of any footnote ≥ 40.33 → 0; `max` footnote activation → 37.72
7. the three `surfacedCount>0` rows with their activations
8. `recall.credit` grouped by `$.reason` with `credited` / `expanded` / `quoted` /
   `considered` / `unresolvedHandles` sums
9. `refused` maps for `nothing-to-credit` passes
10. set intersection of `$.expandedIds` with all footnoted and all surfaced ids
11. `adapter.recall` grouped by `$.semantic`, per date and overall
12. top activation bucketed by `$.turn` within session
13. `gate_session` rows per session by kind and tier
14. `select name,count(*) from events where name like '%mcp%'` → no rows
15. the floor sweep in §4

Code read: `src/core/recall/{CONTRACT.md,tunables.ts,gate.ts,activate.ts,cues.ts,session.ts,reference.ts,INTERFACE-GAPS.md}`,
`src/core/counterpart.ts:1455-1620`, `src/adapters/mcp/server.ts:658`,
`src/adapters/claude-code/hooks.ts:625,640`.
Git: `git log` on `gate.ts`, `activate.ts`, `tunables.ts`; `git log -S'FLOOR_STRONG_DEFAULT_UNITS'`.
Prior art not redone: `docs/promotion-diagnosis-2026-09-17.md`,
`docs/mechanism-inventory-2026-09-17.md` (#15, #17, #25).
