# Adversarial review — PR #131 (`fix/ask-cap-per-day-and-consolidate-cursor`)

Reviewed `8f9f7d7` + `20bd6ca` over `5c7431e`. Probes in a throwaway worktree
(`test/probe131.test.ts`, 5 tests, all passed; worktree removed).

**Gate checks.** `bun test`: 2222 pass / 0 fail. `bun x tsc --noEmit`: clean (the
`tools/visual-loop` errors I first saw were a half-finished `bun install`, not the
branch). Commit messages carry no Claude attribution — the only hit for "claude" is
the path `claude-code/CONTRACT §18`. Docs are hedged correctly ("accepted **for
now**", "if it is ever wanted", REOPENED rather than settled); I found no new
NEVER/ALWAYS rule.

## BLOCKER

None found.

## MAJOR

None found. The four things I most expected to break did not:

- **`resumeIndex` ordering vs SQLite** (`markers.ts:150`). `store.list()` is
  `SELECT id FROM memories ... ORDER BY id` (`store/index.ts:1754`), BINARY
  collation; ids are `mem_` + hex, ASCII only (`newId`, `store/index.ts:2114`).
  PROVED: with both live shapes interleaved (12-hex and 16-hex), `list()` equals a
  JS sort and `resumeIndex(listed, listed[i])` is `i+1` for every i, `0` at the end.
- **"never written" vs "start"** (`markers.ts:129`). `readCursor` maps `undefined`
  and `""` to `null`; `writeCursor` only ever writes a non-empty id. No zero/empty
  ambiguity; both mean "head", which is legal.
- **Cursor advanced on a throw.** PROVED: a `row()` that throws at item 10 leaves
  `sleep.cursor.consolidate` unset — the stretch is re-walked, never skipped.
  Same for the budget break and for observer (`consolidate.ts:190` gates on
  `ctx.apply`).
- **"the original bug in a new coat" / watchdog.** PROVED: 15,000 rows, budget
  5,000 → **105 ms**. `WATCHDOG_MS` is 5 min (`config.ts:131`) and is an
  `AbortSignal` that only reaches the interpret HTTP client (`runner.ts:243`); the
  sleep cycle is synchronous and un-abortable. The kill window inside consolidate
  is ~0.03% of the watchdog. The cursor will advance.
- **Coverage/double-visit/negative counts.** PROVED: 30 rows, budget 7, every 5th
  archived (visited, never `examined`) — every row reached, none visited more than
  twice across the pass. `skippedForBudget = ids.length - visited` is taken before
  the increment, so it cannot go negative.
- **New payload field vs existing readers.** `sleep.cycle` consumers match on
  `phase`/`status` (`tools/replay/driver.ts:499-511`, `dashboard/web/narrate.ts:124`,
  `fired.ts:386` reads the event name only). Additive booleans are invisible to
  them; doctor reads `=== true`, so older rows without the field read as silence
  (covered by `doctor.test.ts:351`). Size: one boolean per phase.

## MINOR

1. **Mixed-code window over-spends the day's allowance**
   (`self/index.ts:767`, `episodes.ts:276`). REASONED + partly PROVED. Old code
   advances only `asks` but carries `asksToday`/`asksDay` through untouched
   (`{...fresh, ...parsed}` → `JSON.stringify`), so new+old interleaved on one
   session in one day can exceed six. State → outcome: new stamps
   `asksToday=1/asksDay=today`; an in-flight old Stop raises four more (`asks` 1→5,
   `asksToday` still 1); new then grants five more → ten asks that day. Bounded to
   the deploy window, and only the Stop hook calls `episodeAsk`
   (`hooks.ts:1140`) in a per-invocation process, so exposure is one in-flight
   hook. PROVED the weaker half: legacy state with `asks = cap` and no `asksDay`
   yields `asksSpentOn = 0` and `askDue().due === true` — a second full allowance
   on deploy day. That half is deliberate and documented (`episodes.ts:264-274`).
2. **`appendChapter` can roll the day counter back** (`self/index.ts:834-845`).
   REASONED, pre-existing shape. `persistState({...state, ...})` writes from its
   own earlier read of the same meta row, so an MCP `chapter`/`note` write racing a
   Stop can clobber `asksToday`/`asksDay` back — exactly as it could already clobber
   `asks`. Not a regression, but the new fields inherit it and nothing guards the
   read-modify-write.
3. **`budgetExhausted: false` is written for phases that never ran**
   (`cycle.ts:182,218,402,426,444` → `counterpart.ts:2449`). REASONED. The comment
   beside it claims the boolean rides every phase so that "it had room" and "this
   row cannot tell you" stay distinct — but a `did-not-run` or `failed` phase gets
   `false`, i.e. "it had room", which is the conflation §5 G6 / scar §2.4 exists to
   stop, and the opposite convention from `reconciled` two lines up. Harmless today
   (`status` is in the same entry and doctor keys on `=== true`); it is the comment
   that is wrong, not the reader.
4. **New memories now wait longer for their first look** (`consolidate.ts:90`).
   REASONED. Ids are random hex, so a row written today lands uniformly in the
   rotation: before, ~1/3 of new rows were examined the next night and every night
   after; now a new row waits up to `ceil(N/budget)` ≈ 3 nights for its first
   consolidation/promotion check. Strictly better in aggregate, bounded, and
   self-correcting — but it is a real behaviour change and NOTES §8 does not name it.

## NIT

1. `docs`/`CONTRACT.md` §3 now states the resume cursor inside a guarantee bullet
   ("A budget is not a debt"). It is phrased as fact plus measurement, but it puts a
   two-day-old mechanism at contract altitude; NOTES would hold it as well.
2. Doctor's Sleep line will now print "consolidate ran out of budget (10,292 rows
   not reached this run)" every night for months with no severity. Intended and
   argued (`doctor.ts:799-805`), but it reads alarming on a green report.

## Not findings (checked, clean)

Refusal path still write-free (`self/index.ts:755-763` emits to the ring only).
`openChapter` reads `store.today()` once, so verdict and advance cannot straddle
midnight. Only one caller increments `asks`. `ctx.step("item", {index})` is
documented as "item index within the phase" (`types.ts:217`), so `visited + 1`
matches its contract. No code enumerates meta keys by prefix, so
`sleep.cursor.*` breaks no scan; `tools/parallel/readers.ts:1019` reads the whole
meta table but looks up by exact key. Clock-backwards / seeded `today()`: a
backwards day just re-grants an allowance once, never locks the session out,
because the comparison is equality against a stored stamp rather than an ordering.
