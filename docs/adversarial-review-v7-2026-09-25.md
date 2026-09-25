# Adversarial review — PR #231 (store v7 + core/time.ts), head 2da3907

2026-09-25. Scratch worktrees only; no live store opened. **R** = reproduced, **r** = reasoned from the code only.

**Verdict: no blocker. The migration held under every test I ran. Three SHOULD-FIXes, all small.**

## What held (R)
- **Suite:** 3764 pass / 5 skip / 0 fail.
- **0.3.1→v7 migration:** the store was seeded by b66a736 in the `<base>/store` layout.
  - Doctor showed amber. One SessionStart produced one `pre-migration-v6-to-v7` copy. That copy is byte-identical in content to the untouched original, so it was taken before any write.
  - After migration: v7, integrity ok, WAL. Ids, hashes, bodies, edges and versions are identical to before.
- **Concurrent upgrade (×3 runs):** 4 SessionStart + 2 UserPromptSubmit + 1 CLI started at once on a v6 store. Each run gave exactly one snapshot, one `store.migrated` row, v7, integrity ok, and every hook exited 0.
- **Crash mid-migration:** `BEGIN IMMEDIATE`, then `ALTER`×2 and `CREATE TABLE feelings`, then SIGKILL. The store was still v6 with no new columns. The next hook migrated it, and a second open made no new snapshot.
- **v7 opened by 0.3.1:** the hook stands down `SCHEMA_AHEAD` ("memory is OFF"), doctor refuses, and nothing is written.
- **0.3.1 MCP server already running** (a real stdio process): `note` stored on v6. The PR hook then migrated the store. The next `note` and `status` both answer `schema-ahead` / "Run /mcp and Reconnect", and nothing was written.
- **Deletes and removal:**
  - No code path runs `DELETE FROM memories`, so the new foreign keys can't break a delete.
  - `chaseRemoved` clears a memory's feelings and leaves no dangling `beneath_id`.
  - Nothing reads `feelings` yet, so there is no leak path.
- **Secrets:** an `sk-ant-…` and a `ghp_…` in `carried_by` are stored as `[REDACTED:…]`.
- **Now line:** 35 bytes, outside the recall block, on every turn including quiet and empty ones. Nothing is printed in a scope set `--off` or `--pause`.
- **Zones:** a bad config zone and `TZ=Garbage/Zone` both fall back cleanly. DST fall-back shows `1:30 am MDT`, then `1:30 am MST`. 11:50 pm MDT is dated to the local day.
- **Model string:** `isModelId` is tight, so an injection can't get through.

## SHOULD-FIX

**S1. Doctor goes RED on upgrade night west of UTC (R).** `src/core/store/index.ts:1691` (`advanceClock`), `src/adapters/claude-code/bin/hook.ts:403`.
- Cause: the last 0.3.1 boundary after 6 pm MDT stored the UTC date (`lastActiveDate=2026-09-26`). After the upgrade, the local `at=2026-09-25` is refused `CLOCK_BACKWARDS`.
- Reproduced: `sleep.cycle reason=clock-failed` and doctor `RED Sleep`.
  - It stays red until local midnight.
  - The SessionStart notice is gated on `anyRed` over the same findings. My run's notice was masked by the dev Checkout red, so the terminal part is reasoned.
- No data is lost: the other phases skip `already-done-today`.
- The owner is in MDT. Flying west does the same for up to a day.
- The same cause makes every `store.today()` stamp written in that pre-upgrade UTC evening read as "tomorrow" for one local day: `learned_on`, page `revisedOn`, `statedOn`, handoff `writtenOn`. That is harmless under rule 6.
- **Fix (cleanest):** clamp `lastActiveDate` to `min(last, localToday)` inside the v7 migration. Or treat a one-day step back as the same lived day. Or grade `CLOCK_BACKWARDS` amber.

**S2. A malformed `other_word` breaks a whole `session_end` (R).** `src/core/store/feelings.ts:121`, `src/adapters/mcp/server.ts` (`readFeelings`).
- `{emotion:"other", other_word:{}}` (or a number) throws `TypeError: .trim is not a function`. `readFeelings` rethrows anything that isn't `FEELING_INVALID`.
- `note` becomes a JSON-RPC INTERNAL_ERROR, and every entry in that `session_end` call is lost, the valid siblings included. Nothing is half-written, and a retry works.
- Two contributing mismatches:
  - `tools.ts`'s `FEELINGS_PROPERTY` has no `other_word` and sets `additionalProperties:false`, yet the reader accepts `other_word`/`otherWord`. So only a non-validating client can reach this.
  - `resolveEmotion`/`closestKeys` (edit distance, linear in word length) run before `OTHER_WORD_MAX_CHARS` is checked. A huge `emotion` string is scored before it is refused.
- **Fix:**
  - Type-check `otherWord`, `whose` and `core` as strings.
  - Check the lengths first.
  - Map any throw in `readFeelings` to `{refused}`.
  - Drop `other_word` from the reader, or add it to the schema.

**S3. Feelings are not all-or-nothing (R).** `readFeelings` casts `beneath as number` but lets a string through. `checkFeelings` accepts it, and the same-memory test only runs later in `addFeelings`, in a separate `mutate` after the memory has minted.
- Result: `stored:true, feelings:{stored:0, reason:"threw", …beneath-not-on-this-memory}`.
- **Fix:** refuse a non-integer `beneath` at the door. The schema already says integer.

## NIT
- **N1 (R).** After the upgrade, `counterparts status` (or any observer) on a store still at v6 prints `Could not open the store: STORE_UNINITIALIZED … found:"6"`. That reads as an empty store. Say what doctor says: the next session upgrades it.
- **N2 (R).** A store outside `<base>/store` (a bare `dataDir`, `COUNTERPARTS_DATA_DIR`) gets "memory is OFF" via `MIGRATION_SNAPSHOT_FAILED` until `snapshots.dir` is set. This is #214's intended fail-safe, biting for the first time. Put it in the 0.3.2 CHANGELOG.
- **N3 (r).** The PR body says the relay fills `model` for `note`. On the live host `serve.ts` gets no `--session`, so `sessionModel()` returns undefined until a `session_end` or `chapter` binds the server.
  - Most notes will therefore record NULL. The owner should confirm that's intended.
  - After `/model`, the first write is attributed to the previous model.
  - It is never another session's model: the bind is frozen per process.
  - The `sessionModel` docblock sits inside `corroborate`'s (`server.ts:~1948`).
- **N4 (r).** A long-running MCP server keeps the machine zone from process start. `learned_on` from `note` after travel stays in the old zone until Reconnect.
- **N5 (R).** Loose date and zone checks:
  - `isZone("+05:30")` is true, so an offset is accepted as `timeZone`.
  - `isCalendarDate("0000")` is true.
  - `" 2026-10-15 "` is validated after trimming but stored untrimmed.
- **N6 (R).** A `duplicate-content` note drops its feelings without saying so.
- **N7 (r).** `export` (`src/adapters/cli/export.ts`) carries no feelings, and its "Not included" line doesn't say so.
- **N8 (r).** The guard test misses `dateOf(` and `today()` (`src/core/store/index.ts:3273/3278`, UTC).
  - Legitimate users: snapshot and parking names.
  - Not legitimate: `dashboard/web/server.ts:268` still passes `todayUtc()` to `firedPanel`, which now grades by local dates, so the dashboard's week is one day off every evening.
  - Add `\bdateOf\(` to `HAND_BUILT` with explicit allow entries.
- **N9 (r).** A 0.3.1 worker already mid-run during the upgrade keeps writing v6-shaped SQL. Its `INSERT OR REPLACE` on edges nulls `created_at`. Harmless, and bounded by the watchdog.
