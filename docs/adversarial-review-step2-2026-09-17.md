# Adversarial review — step 2 batch (PRs #119 / #120 / #121 / #122)

Checkout: `~/counterparts/.claude/worktrees/step2-trial` @ `755c5b6`
(merge of the three branches + the end-to-end test). Baseline `f34f8c6`.
Full suite at this head: **2136 pass / 0 fail** (`bun test`, 30.5 s).
All my own tests are hermetic (temp dirs, fake interpreter, no socket, no real store).

---

## 1. Verdict

**No blockers. This batch introduces no new privacy or egress hole — deploy after fixing
one thing.**

- **Fix M1 first.** When every identity-band row is protected or confidential, the wake
  tells the crash fallback *"No identity has formed here yet"*, names the identity core,
  and then tells it to write in the first person as that self. Proven; one-clause fix.
- **M2** next (the new doctor section explains its counts with the day cap #119 deleted in
  the same batch). **M4** is a real `off`-directory leak via `--resume` but is
  **pre-existing** — I ran the same test against `f34f8c6` and got the identical result;
  it is here because the batch's prose now over-promises. **M5** is one verification to do
  at the restart, not a fix. **M3, m1–m6** are minor.

---

## 2. Findings

### M1 — MAJOR (egress + false self). The wake asserts identity amnesia over a store that has identity, and names the identity core, which never passed `omit`

**Scenario.** A store with an identity core and identity-band beliefs that are
`protected` (permanent ink) and/or confidential, plus any ordinary non-identity element
(a thread, a craft line). `sweepWake` omits the identity rows correctly — and the empty
identity lane then unlocks the day-0 lane, which reads the identity core straight out of
the store and renders *"This memory is for &lt;NAME&gt;. No identity has formed here yet
…"*. The prompt continues: *"Write what YOU learned, in the first person and in your own
voice."*

**Evidence.**
- `src/core/self/index.ts:331` — `const coreName = lanes.identity.length === 0 ? identityCoreName(this.store) : null;` — gated on the **post-omit** lane (`:311-313` does the filtering).
- `src/core/self/briefing.ts:360` + `:367-368` — `dayZero` renders when `kept.identity.length === 0`.
- `src/core/self/briefing.ts:146-148` — `identityCoreLine()` = `This memory is for X. No identity has formed here yet …`.
- `src/core/self/identity.ts:81` — `scanActive` lists `{ type: "memory" }`; the identity core is `type: "schema"` (`self/index.ts:571-573`), so **`omit` never sees it** and the name is rendered on a surface the PR says holds protected/confidential material back.
- `src/core/self/briefing.ts:496-506` — the module's own comment calls exactly this state *"identity amnesia printed over a store that has identity, which is this module's own worst failure (scar §2.3)"*. It guards the **budget** path and not the **omit** path, which #121 added.
- `src/core/counterpart.ts:2372` — the `cold-start` guard is `composed.elements === 0`, and `compose()` deliberately does **not** count the day-0 line as an element (`briefing.ts:357-360`), so this state is reported as `reason: "composed"` with `elements: 1`.

**PROOF** — `scratchpad/adversarial/wake-dayzero.test.ts`, run at this head, **1 pass**:

```
----- WAKE BLOCK -----
── WAKE 06e9c060 — WHO YOU ARE (context, not material) ──
…
You are reading a transcript of a session you LIVED but never got to
write up. Write what YOU learned, in the first person and in your own
voice, as you would have written it at the time.
…
<!-- counterparts:wake day=0 elements=1 bytes=569 -->

Who I am:
This memory is for <OWNER NAME>. No identity has formed here yet — identity is earned at the boundary that ends a session, from what recurs across distinct days.

Still open:
- 2026-09-02 · ZQTHREAD The export gating question is still open with the vendor.
```
(The protected row's marker `ZQPROT` is correctly absent. The lie and the name are not.)

**Why it matters on the live store.** The firing condition is precise: **every**
identity-band row is `protected` or confidential, and at least one other lane still
renders. I could not check the live store (off-limits), so whether it fires today is
**UNVERIFIED** — but the identity band is exactly where "permanent ink" is expected to
live, and when it does fire, every fallback memory from then on is written by a model
that was just told, in the first person, that it has no identity. That is worse than the
cold read #121 replaced. One read the owner *can* do before the restart:

```sql
SELECT COUNT(*) AS identity_rows,
       SUM(CASE WHEN protected = 1 THEN 1 ELSE 0 END) AS protected_rows
  FROM memories WHERE band = 'identity' AND archived = 0;
```
If the two numbers are equal, the bug fires on the first sweep after deploy. (Sufficient,
not necessary: `confidential` lives in the prose `meta`, not in a column, so a store where
the rest of the identity band is confidential fires too.)

**Fix (one clause).** A composition that passes `omit` is by definition not owner-facing,
so it should never render the day-0 line at all:

```ts
// self/index.ts:331
const coreName = req.omit === undefined && lanes.identity.length === 0
  ? identityCoreName(this.store) : null;
```

No new state, and it closes the name leak and the false sentence together. (The
alternative — gate on the pre-omit `all` — leaves the core's name rendering.) The existing
test `(d)`'s "all-confidential store degrades to cold start" case passes today only because
that fixture has no identity core.

---

### M2 — MAJOR (a diagnostic that lies). The new `Authorship` section explains its numbers with the cap #119 deleted in the same batch

**Scenario.** Post-deploy `counterparts doctor` prints, for a real number of `capped`
rows, *"refused N by **the day's cap**"* and, when amber, *"The day's chapter cap refuses
the pen more often than it offers it — that cap is **shared across every session of the
day**."* After #119 there is no day cap and nothing is shared; `capped` now means one
session spent six asks. The reader is sent after a mechanism that no longer exists.

**Evidence (code walk).**
- `src/adapters/claude-code/doctor.ts:956` — ``` `refused ${String(capped)} by the day's cap and ${String(paced)} for pacing` ```
- `src/adapters/claude-code/doctor.ts:964` — `"The day's chapter cap … shared across every session of the day."`
- `src/core/self/tunables.ts` — `MAX_CHAPTERS_PER_DAY` → `MAX_ASKS_PER_SESSION` in the same batch; `src/core/self/episodes.ts:227,271` — the reason is `session-ask-cap`.
- The wrong wording is **pinned by tests**, so a fix must change them too:
  `test/doctor.test.ts:443`, `:462` (`"refused 9 by the day's cap"`), `:463`
  (`"shared across every session of the day"`).

This is a merge-order artefact: #120 wrote the section against the world #119 was
simultaneously removing. The counts themselves are correct (they read `outcome`, not
`reason`).

---

### M3 — **MINOR** (downgraded after checking the counter's provenance; mechanism proven, likelihood low). A pre-deploy session already at `asks >= 6` is capped for the rest of its life

**Scenario.** `EpisodeState.asks` is per **session**, persisted in meta, and **never
resets** — not on a new lived day, not on a new calendar date. Under the old rule a
session could take up to 4 asks a calendar day; a session alive across two days is at 8.
At the first Stop after deploy `askDue` returns `session-ask-cap` and keeps returning it,
so the sessions that survive the restart are precisely the ones #119 cannot help.

**Evidence.**
- `src/core/self/episodes.ts:271` — `if (state.asks >= t.MAX_ASKS_PER_SESSION) return no("session-ask-cap");`
- `src/core/self/episodes.ts:196-219` — `loadEpisodeState` merges the persisted JSON as-is; the only migration is `chapters → asks`. No ceiling, no reset.
- `src/core/self/index.ts:739-746` — `openChapter` persists `asks: state.asks + 1`; nothing anywhere decrements or resets it.
- Old cap: `docs/finding-12-diagnosis-2026-09-17.md:37-38` shows `self.episode.day.*` at 4 on six separate days — i.e. 4 asks/day were routinely spent.

**PROOF** — `scratchpad/adversarial/ask-cap-and-cost.test.ts`, **3 pass**:

```
C1: due=false reason=session-ask-cap (MAX_ASKS_PER_SESSION=6)
```
(C1 plants exactly the JSON the old code persisted, `asks: 6`, then asks with
`turns: 400, bytes: 900_000` — far past both pacers. C2 shows `asks: 4` gets two more and
then never again.)

**Pre-deploy check (seconds, read-only):**
```sql
SELECT key, json_extract(value,'$.asks') AS asks
  FROM meta WHERE key LIKE 'self.episode.%'
   AND json_extract(value,'$.asks') >= 6;
```
**Mitigation:** delete those meta rows at deploy (they are per-session scratch state), or
floor `asks` in `loadEpisodeState` on the first load under the new tunable.

**Why I downgraded it.** I first assumed the PR's "on the last two weeks of real use that
would never have bitten" measured a *different* number from the persisted counter. It does
not: `asks` increments in exactly one place (`self/index.ts:741`), inside `openChapter`,
whose only caller is `Counterpart.episodeAsk` (`counterpart.ts:1589`), whose only caller is
`askAtStop` (`hooks.ts:1116`) — and every successful pass there writes exactly one
`adapter.ask outcome=asked` row. So the counter and the rows are 1:1 and the PR's
measurement covers the persisted value. The residual exposure is only a session that was
already live *before* the measured window (e.g. the 2026-09-04 evening that reached 6 under
the old OR-pacer, cited in `self/tunables.ts`'s own comment) and is *still* live at the
restart. Low, but it costs ten seconds to rule out, and the failure is silent.

---

### M4 — MAJOR, **pre-existing, NOT introduced by this batch**. `--resume` in an `on` directory captures the transcript lived in an `off` one

**Scenario.** Session starts in an `off` directory (hook silent, **no record written**),
talks there, is later resumed with `--resume` from an `on` directory. The host fires
`SessionStart` with `source: "resume"`, which is in `FRESH_SESSION_SOURCES`, so the
session re-anchors to the `on` directory and a record is written. At the next Stop,
`sealJoinedLate` sees a record and returns `"none"`, so capture runs from cursor 0 over
the **whole** transcript — including everything said in the `off` directory.

**Evidence.**
- `src/adapters/claude-code/bin/hook.ts` — `FRESH_SESSION_SOURCES = ["startup","resume","clear","fork"]`, and `opensASession` makes `sessionScope` ignore any record for those.
- `src/adapters/claude-code/hooks.ts:899` — `if (readSession(...) !== null) return "none";` — the joined-late seal is disarmed the moment a record exists.
- `src/adapters/claude-code/hooks.ts:819-823` — capture then runs over the full cursor slice.

**PROOF** — `scratchpad/adversarial/resume-off.test.ts` (real hook processes):

```
B1: SECRETMARKER occurrences under the store after the resume = 2   (at 755c5b6)
B1: SECRETMARKER occurrences under the store after the resume = 2   (at f34f8c6, same test)
```
I exported `f34f8c6` with `git archive` into a temp tree and ran the identical test
against the old hook: **identical result**, so this is **not a regression** — it is a hole
#120 does not close.

**Why it is in this report anyway.** #120 ships the sentence *"The privacy guarantee is
kept, and it is checked twice now"* and a test named *"a session that STARTED in an off
directory is off wherever it goes"* (`test/scopes.test.ts:1735`). Both are true only
until a fresh-source `SessionStart` lands in an `on` directory. The owner should not
upgrade his trust in `off` on the strength of this batch.

---

### M5 — MAJOR, **SUSPECTED** (not reproducible here; environment-dependent). The batch's filing agreement rests entirely on `CLAUDE_PROJECT_DIR` reaching **both** the hooks and the MCP server, and a disagreement is a hard refusal

**Scenario.** After the restart, a session's hooks file under `sessionScope` (record →
`CLAUDE_PROJECT_DIR`) while its MCP server resolves `hostScope` (`--scope` →
`CLAUDE_PROJECT_DIR` → `process.cwd()`). If the variable reaches one side and not the
other, and the server's cwd is not the same directory, `requireBoundSession` refuses
**scope-mismatch** and every `chapter` / `session_end` deposit for that session's whole
life is refused — the authored door shut, the sweep writing everything. That is the
2026-09-04 failure and the 888:193 ratio, amplified.

**Evidence.**
- `src/adapters/mcp/server.ts:194-215` (`hostScope`) — the new order; `source: "project"` is new.
- `src/adapters/mcp/server.ts:1136-1142` — `if (!sameScope(record.scope, this.scope))` → `refuse("scope-mismatch")`. No tolerance, no fallback, no re-resolution.
- `src/adapters/claude-code/NOTES.md:505-509` — the claim is *"documented … and exported to hooks and stdio servers alike"*, with the server's **spawn cwd** *"documented nowhere; measured once with `lsof`"*. The new rule now depends on the documented variable rather than the measured cwd, which is the better bet — but the failure mode on a bad bet is total, not partial.

**Verification before trusting the batch** (the PR already built the instrument):
after the restart, check the first session's `mcp.scope` startup line says
`source: project`, and that `gate.deposit` rows appear for that session. If it says
`source: cwd`, compare that string with the session's record scope before working a full
day on it.

---

### m1 — MINOR (cost). The wake is composed on every quiet worker run, before the sweep decides anything crashed

**Evidence.** `src/core/counterpart.ts:1969` composes the wake; `:1985` is where
`sweep()`/`sweepAll()` first decides whether any session is crashed. `sweepWake` →
`Self.build` → `scanActive` (`src/core/self/identity.ts:78-108`) reads `row` + `readProse`
+ `physicsOf` for **every** live memory.

**PROOF** — same test file:
```
D1: N=2000 quiet sweep WITH wake = 189.5 ms; WITHOUT (no budget) = 0.8 ms; delta = 188.7 ms
```

Not a lock hazard: the scan is N auto-commit SELECTs plus file reads with **no wrapping
transaction** — `Store.read()` is `requireRow()` (one SELECT) + `readProseFile()` (the
filesystem) at `src/core/store/index.ts:1695-1697`, and `this.ops.transaction(...)` appears
only on write paths (`:599`, `:647`, `:1062`) and on the cache (`:1281`, `:1432`). So I38
(`database is locked` after a Stop, `journal_mode=DELETE`) is not made worse — a writer can
still slip between statements. But it doubles the cycle's own prose
scan on every boundary for a value used only when something crashed. **Compose lazily on
the first chunk** and the ordinary day pays nothing; the row would then say
`not-reached` with `bytes: 0`, which is arguably more honest than today's "ready but
unused".

### m2 — MINOR (untested privacy combinator). `mostRestrictiveVerdict` has no direct test anywhere in `test/`

`grep -rn mostRestrictiveVerdict test/` → nothing. It is exercised only indirectly by
three hook-process tests (session-on/event-off, session-on/event-observer,
session-off/event-on). I built the full 25-pair table
(`scratchpad/adversarial/verdict-table.test.ts`, **1 pass, 34 assertions**) and
**every pair is correct**, including `unset` (ranks with `on`), `paused` (ranks with
`off`), and the tie going to the session's verdict so its entry is the one named. It
should be landed as a real test rather than left to inference.

### m3 — MINOR (comment claims a property the code does not enforce)

`sessionScope` returns the session record's `scope` **verbatim** — `return recorded;` —
while its own doc block says *"Canonical (`canonicalScope`) at every step"*. It is safe
today only because `recordSession` canonicalises on write
(`src/adapters/sessions.ts:214-215`). A hand-edited or externally written record would be
filed uncanonicalised, and span directories are keyed by a hash of the exact string.
One `canonicalScope()` call makes the comment true.

### m4 — MINOR. `learnedOnFrom` is a string `>=`

`src/core/store/index.ts:516-520`. A month-precision `learned_on` (`"2026-09"`) sorts
below any `"2026-09-DD"` and is silently excluded from the Authorship counts, as are
`''` rows (intended). Undercount only, and consistent with the stated rule; worth knowing
if migrated v1 rows carry imprecise dates.

### m5 — MINOR (prose the code does not honour). It is **not** "the same composed wake a live session gets"

#121's headline claim, in three places the code disagrees with:

1. **No horizon.** `sweepWake` calls `build()` with `budgetBytes`, `day` and `omit` only
   (`src/core/counterpart.ts:2357-2365`) — no `horizon`, so the prospective lane a live
   wake carries is simply absent. Harmless (it is also why no prospective item can leak),
   but it is a different bundle.
2. **No protected identity**, by design — so on the owner's store the sweep's "self" is a
   strict subset of the live one, and the `identity=N` count in the sentinel differs.
3. **A different budget.** The live wake composes against
   `budgetBytes − PREFACE_RESERVE_BYTES` (160 B) at `counterpart.ts:1741-1742`; the sweep
   composes against the full `reportedBudget` (`:2352`). The PR's "capped at the same byte
   budget your live wake uses (9,000)" is 160 bytes off.

None of this is a defect; the claim is.

### m6 — MINOR. Last live reference to the deleted vocabulary

`test/doctor.test.ts:495` still feeds `reason: "day-chapter-cap"` into a fixture. Harmless
(the doctor counts `outcome`, deliberately — `doctor.ts:923-937`), but it is the only
remaining mention of a reason string this batch removed.

---

## 3. What I attacked and found sound

**Egress (#121)** — the strongest part of the batch.
- `omit` is applied **before** ranking, so an omitted row cannot take a lane slot or a
  byte (`self/index.ts:311-313`).
- The `resolve` escape hatch is **not** reachable for omitted rows: `resolveStatement`
  does fall back to `store.readProse(id)` when `docs` lacks the id
  (`self/index.ts:1109-1113`), but `elementLine` resolves only `item.id`
  (`briefing.ts:316-318`), lanes are built only from the filtered `scanned`, and
  `sweepWake` passes no `horizon` — the one lane whose ids bypass `scanActive`.
- `isConfidential` (`recall/activate.ts:130-135`) is the **only** confidentiality class in
  `src/` (grepped: `recall/`, `encode/`, `schemas/`, `mcp/`, dashboard `reveal.ts` all use
  it). There is no second owner-only / audience / visibility predicate the omit misses.
  The sweep is strictly stricter than the recall gate, which withholds confidential only
  from a non-owner (`mcp/deliberate.ts:408`).
- `redactSecrets` runs over the **whole composed text** — headers, dates, prefaces,
  sentinel included (`counterpart.ts:2373`).
- Fence breakout: the nonce is a fresh `randomUUID()` slice per sweep
  (`counterpart.ts:1962-1963`), so no stored text can know it; `defangFences` is redundant
  belt-and-braces. I did not spend a test on it.
- Side effects: `build()` only reads. The published bundle, rotation marks, counters and
  meta are untouched — test `(c)` in `test/sweep-wake.test.ts` already snapshots them.
  A throw inside `build()` is caught and costs the wake, never the sweep
  (`counterpart.ts:2386-2388`).
- The feature will actually fire rather than silently reading `no-budget`: the worker
  passes `budgetBytes: config.injectionBudgetBytes` at open
  (`src/adapters/claude-code/bin/runner.ts:159-164`) and `sessionEnd` updates
  `reportedBudget` *before* the sweep (`counterpart.ts:1739-1753`).
- Prompt size: the wake adds ≤ cap + 683 B once per chunk; nothing truncates the chunk
  silently — `interpret-client.ts:219` sends `chunk.prompt` whole, so an over-long prompt
  is an API error that fails the chunk and restores its claim, not a quiet clip.

**Scopes (#120).**
- The `off` check on the **event** directory still runs first and alone, before any config
  read (`hook.ts` — `eventDirectory` → `hookScopeVerdict` → return, ahead of `hostConfig`).
- The new **second** `off` return is reached only after reads: `hostConfig` parses two
  files and writes nothing (`hook.ts` `hostConfig`, `config.ts`/`credentials.ts` contain no
  `mkdirSync`/`writeFileSync`), `readSession` reads one file. `test/scopes.test.ts:1760`
  already asserts `existsSync(store) === false` on that path.
- The unreadable-named-config stand-down was moved **ahead** of the session-registry read,
  which is the right order (it no longer touches the default store's host state on its way
  out) and does not move the `off` return.
- `mostRestrictiveVerdict`: all 25 pairs correct (see m2).
- The joined-late seal still protects the ordinary walk-in: a session that started in an
  `off` directory, walked into an `on` one, with **no** `CLAUDE_PROJECT_DIR` in the
  environment, is **sealed, not captured** — `B2: NOENVMARKER occurrences = 0`, at this
  head and at `f34f8c6`.
- Deploy skew (E): `requireBoundSession` compares with `sameScope`
  (`server.ts:1136`, `sessions.ts:150-152`), which canonicalises both sides, so an
  old server holding a raw scope string still binds against a canonical record. On this
  host the owner's paths are already their own realpaths, so the coverage keys agree too.

**#119.** No live reader of the removed keys remains: `dayKey`, `Self.dayAsks`,
`bumpDayAsks`, `askCountKey` and `self.episode.day.*` are gone from `src/` and `tools/`
(grepped; the only hits are docs, NOTES, and `src/core/physics/clock.ts#dayKey`, an
unrelated function). `tools/parallel/` reads none of them. `test/claude-code.test.ts:849-857`
pins that the old meta rows are left untouched rather than migrated.

---

## 4. Artefacts

All under `<scratchpad>/adversarial/`:

| file | what it proves |
|---|---|
| `wake-dayzero.test.ts` | M1 (1 pass) |
| `resume-off.test.ts` | M4 at this head; B2 sound (1 pass / 1 expected fail) |
| `resume-off-BASE.test.ts` | M4 identical at `f34f8c6` ⇒ pre-existing |
| `ask-cap-and-cost.test.ts` | M3 and m1 (3 pass) |
| `verdict-table.test.ts` | m2 — full 25-pair table, all correct (1 pass) |
| `base-f34f8c6/` | `git archive` of the baseline tree, for the regression comparison |

Nothing in the repository was modified; no real store, config, or hook was run against
`~/.counterparts`, `~/.bansai` or `~/.claude-engram`. `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`
was exported for every run.
