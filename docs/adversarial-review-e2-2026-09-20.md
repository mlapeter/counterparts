# Adversarial review — PR #153, "E2: the 'what was prevented' rows + the day-1 new-user findings"

Reviewer: an adversarial session, 2026-09-20. Head under review `1f82759`, diffed against
`origin/master` (32 files, +2728/−157). Everything below was done in a throwaway worktree
against temp stores and an injected fake home; no live store, config or checkout was
opened by me.

---

## Verdict

**MERGE AFTER FIXES.**

Two MAJOR, nine MINOR, three NIT. The first MAJOR is the PR's own stated failure mode reappearing one namespace over: on a
**perfectly healthy store** `counterparts fired` now reports `promotion` and `prune` as
**BLOCKED, every week, forever**. The builder caught `prune → journal ×14` and fixed it by
reading only each phase's own refusal namespace — but physics' refusal vocabulary is itself
mostly *"not yet"* rather than *"a gate said no"*. I reproduced it end to end on a store
with forty ordinary memories and seven clean nights.

Nothing else I ran is a blocker. The privacy of the new rows holds up under every probe I
could build; the observer stance is clean including the WAL; `readHost` never threw, never
wrote and never went red; the LINEAR test genuinely fails against the old quadratic
`sight()`; `doctor --dir` names the store it graded and refuses to grade a configuration
nobody asked for.

Suite and typecheck, as printed on `1f82759`:

```
 2489 pass
 0 fail
 30880 expect() calls
Ran 2489 tests across 42 files. [62.80s]
```

`~/.bun/bin/bunx tsc --noEmit` → no output, exit 0.
`$TMPDIR` `counterparts-*` directories: **80 before the full suite, 80 after**. No new
leftovers from the suite's prefixes. (Later in the session, after a second full suite run
concurrent with twenty single-test runs, two dirs appeared — `counterparts-deploy-*` and
`counterparts-test-home-*`. I could not attribute them: other sessions share this machine's
`$TMPDIR`, and the clean single run leaked nothing. Worth one look by someone who can watch
the machine alone.)

---

## MAJOR 1 — `blocked` cries wolf on a healthy store: the `journal ×14` bug, one namespace over

**RAN.** A real `Counterpart` on a fresh temp store: forty ordinary `fact` memories, seven
real `sessionEnd()` boundaries (dates 2026-09-13 … 2026-09-19), then `firedReport(store,
"2026-09-20")`. Nothing is wrong with this store. Nothing is misconfigured. No worker died.

The durable `sleep.cycle` rows the PR now writes:

```
  PHASE decay        {"at-floor":40,"unchanged":40}
  PHASE consolidate  {"below-semantic-floor":40,"promotion:base-below-identity-threshold":40,"promotion:insufficient-distinct-days":40}
  PHASE prune        {"blocked:dwell-too-short":40}
```

and what `counterparts fired` then says:

```
--- counterparts fired, on a store where NOTHING IS WRONG ---
BLOCKED  promotion    it did not fire this week; 160 refusals landed instead, most often base-below-identity-threshold ×80 (sleep.cycle)
BLOCKED  prune        it did not fire this week; 240 refusals landed instead, most often dwell-too-short ×240 (sleep.cycle)
counts: {"quiet":0,"blocked":2,"never":25,"blind":11,"firing":1,"new":8,"disabled":1,"retired":2}
```

`promotion:base-below-identity-threshold`, `promotion:insufficient-distinct-days` and
`blocked:dwell-too-short` are **the normal condition of essentially every memory on every
healthy night**. `physics/index.ts` pushes them into `blockedBy` for each memory examined:

- `if (b < TUNABLES.THETA_ID) blockedBy.push("base-below-identity-threshold")` (line 499)
- `if (days < TUNABLES.N_PROMOTION_DAYS) blockedBy.push("insufficient-distinct-days")` (500)
- `if (dwellDays < TUNABLES.D_FLOOR_DAYS) blockedBy.push("dwell-too-short")` (1029)
- `if (s >= TUNABLES.PHI_PRUNE) blockedBy.push("above-floor")` (1028)

They are candidate *filters* wearing a refusal namespace. They scale with **store size ×
nights**, so the count in the sentence will be enormous on any store with real content.

**Who actually sees it**, stated precisely: `blocked` is only reached when the mechanism did
not fire inside the window (`if (read.inWindow > 0) return "firing"` comes first). So on a
store where prune and promotion fire most weeks the line stays `firing` and the false alarm
is invisible. The certain victims are (a) every new user from lived day 2 onward — the
roll-call comes back and immediately shows two BLOCKED mechanisms on a store nothing is
wrong with — and (b) any store in a week where a phase had nothing to do, which for prune
and promotion is most weeks on a small store. That is exactly the population the day-1 half
of this PR exists to serve. The PR's own words, about the bug it thought it had fixed: *"a false alarm every
single week, which is how a view teaches its reader to ignore it."* The namespace prefix
moved the false alarm; it did not remove it.

It escalates past `fired` into `doctor`:

- The Fired roll-call line now appends `, 2 were stopped by something that said so`.
- `blocked` **outranks** `quiet` and `never` in `stateOf()`, so these two mechanisms will
  sit in the BLOCKED section — the first section printed — permanently.
- As soon as a week goes by where promotion or prune *did* fire in the previous window and
  not in this one (normal: pruning happens in bursts), `wentBlocked` fires and doctor goes
  **AMBER**: I reproduced that too —

```
### B: promoted last week, below-theta this week
  promotion  blocked  it did not fire this week; 246 refusals landed instead, most often below-theta ×246 (sleep.cycle)
  wentBlocked: ["a memory reinforced over several days is promoted into identity (below-theta ×246)"]
```

  and the doctor fix line then reads *"the reason on the row names what to fix"* — for a
  phase where there is nothing to fix.

**Smallest fix.** Do not take a namespace wholesale; name the reasons that are genuine
gates. The honest gates in the three vocabularies are the ones that say *someone said no*,
not *not yet*: `promotion:already-identity` is arguable, `blocked:protected` and
`blocked:in-live-revision-chain` are real, `left-alone:*` needs the same audit. Give
`RefusalSource` an `only?: readonly string[]` beside `under`, or invert to a deny-list of
the four "not yet" reasons above. Failing that, drop `refusals` from `promotion`, `prune`
and `dedup` for this PR and land them once physics separates "filtered" from "refused" —
the rows are still written either way, so nothing is lost but the reading.

A second, cheaper guard worth having regardless: `blocked` should not outrank `never` for a
mechanism whose evidence has **never** carried a row — "it has never fired and something
said why" is a different and much weaker claim than "it used to fire and now it is stopped",
and the current ordering gives them the same headline.

---

## MAJOR 2 — `prospective.fire` has no production caller, so the new evidence can never carry a row

**RAN / READ.** `Prospective.fire()` is invoked from exactly two places in the tree:

```
$ grep -rn "\.fire(\|fire({" src/ bin/ tools/ --include=*.ts
tools/demo/seed.ts:561:        const out = c.prospective.fire({
```

— the demo seeder — and `test/prospective.test.ts`. No hook, no boundary, no recall path
calls it. **This is pre-existing and known**: `docs/mechanism-inventory-2026-09-17.md` §S4
says so in as many words — *"Prospective set and fire (14 rows, all migrated) — NO PRODUCER.
`arm()` and `fire()` have exactly two callers, both in `tools/demo/seed.ts`"* — and rows 29
and 30 of its table record `last_fired_day` NULL on all fourteen. The PR did not kill the
path; it took the inventory's recommendation (*"one `prospective.fire` event"*) and added
the rows. The finding is what it did **next**. `counterpart.ts` constructs `Prospective` and hands it to the renderer and the
recall context, but the fire budget is never spent.

This PR nevertheless changes the mechanism's evidence from a table probe to the new event:

```ts
id: "prospective-fired",
evidence: { kind: "event", names: ["prospective.fire"] },
refusals: { names: ["prospective.fire.refused"] },
since: "2026-09-20",
```

So on any real store the line reads `new` for two days and then **`never` forever** — "the
evidence exists and has never carried a row" — which is the `blind` case wearing a `never`
label. That is precisely the confusion `fired` exists to break, and this PR moves the
mechanism *into* it: before the change it was a probe over `last_fired_day` (also empty, but
honestly described as a probe); after it, the page asserts durable evidence exists.

Confirmed empirically in probe `p2.ts` scenario F: a store with a single unrelated row
reports `prospective-fired  new  its evidence was added 2026-09-20`, and in the end-to-end
run (seven real boundaries) it never leaves that state.

**Smallest fix.** Either keep `evidence: { kind: "none", reason: "…`fire()` has no
production caller; `arrivals()` is read but the budget is never spent, so no row can land
until the surfacing path calls it…" }` and leave the two new rows in place for when it is
wired, or wire it. The rows themselves are well built (two names, latched refusal, no dates
and no words of the memory) — the problem is only the claim the `MECHANISMS` entry now makes
about them.

---

## MINOR

### MINOR 1 — a hook command that points at a path that does not exist reads as installed

**RAN**, `readHost` fixture (c):

```
c) hook points at a path that does NOT exist   {"events":["SessionStart"],"settingsRead":["~/.claude/settings.json"],"mcp":false,"mcpUnreadable":false}
```

`HOOK_COMMAND_MARK` is a substring match on the command string. A settings file left over
from a deleted checkout — the exact thing `readCheckout` exists to catch one line down —
makes the Host line say the event is installed while every session start fails silently.
With all five events stale and the MCP registered, `hostFindings` returns **GREEN**.

Smallest fix: when the command's first token is an absolute path, `existsSync` it, and
report the event as installed-but-missing rather than installed. (Deliberately *not* a
blocker: the check's stated job is "did the paste take", and resolving an arbitrary shell
command is out of scope — but "GREEN while nothing fires" is the one outcome this finding
was added to prevent.)

### MINOR 2 — an unreadable settings file is indistinguishable from an absent one

**RAN**, fixtures (f) and (g): a mode-`000` `settings.local.json` and a *directory* named
`settings.local.json` both drop out of `settingsRead` with no trace. `readJsonFile` collapses
"does not exist", "cannot be opened" and "is not JSON" into one `{ ok: false }`. The MCP file
gets an `mcpUnreadable` flag for exactly this reason; the settings files do not. On a machine
where the user's `~/.claude/settings.json` is unreadable the line reads *"no host settings
file was readable"*, which is true, but where two of four are readable it reads `read <the
two>` and says nothing about the two it could not open.

Smallest fix: a `settingsUnreadable: readonly string[]` beside `settingsRead`, printed in
the same parenthesis.

### MINOR 3 — `~/.claude.json` is followed through a symlink out of HOME

**RAN**, fixture (k): `~/.claude.json → /tmp/…/foreign.json` is read and reported as a
registration. Read-only and it is the user's own symlink, so the blast radius is nil — but
the docstring's promise is "every answer names the files it read", and the name it prints is
the link, not the target. Worth one sentence in `NOTES.md` rather than code.

### MINOR 4 — a refusal row with no `reason` is silently dropped

**RAN**, probe `p2.ts` scenario D: an `adapter.spawn.refused` row whose payload carries no
`reason` contributes nothing at all — `reasonOnce()` returns `[]`, `refused` stays 0, and the
mechanism reads `new`/`never`. The row exists, the store knows the worker was refused, and
the view says it was not. `countsIn`-backed readers have the same hole for an empty
`blockedBy`. Smallest fix: `[["(no reason recorded)", 1]]` instead of `[]` — the `noteFor`
sentence already has a `?? "no reason recorded"` branch that nothing can currently reach.

### MINOR 5 — pre-PR `sleep.cycle` rows have no `skipped`, so the first week after deploy is a schema artefact

**RAN**, probe `p2.ts` scenario E: old-style cycle rows (no `skipped`) in the previous window
and new-style rows in this one produce `wentBlocked: ["…promotion (below-theta ×246)"]` and an
amber doctor line. Nothing changed but the schema. This is a one-week effect and it is
subsumed by MAJOR 1 (fix that and this mostly evaporates), but it is worth a line in the
merge notes so the owner is not told his promotion phase regressed on deploy day.

### MINOR 6 — `doctor --dir` still reads four host settings files and `~/.claude.json`

**RAN.** Judgment call 5 says `--dir` alone "reads no configuration at all". True for *our*
configuration — I confirmed `AMBER Config  not read — you named a store with --dir and no
configuration …`, and `credentialFindings` and `snapshotFindings` are both skipped. But
`readHost(home ?? homedir(), process.cwd(), env)` runs unconditionally in the console path,
so `doctor --dir /tmp/scratch` opens `~/.claude/settings.json`, `~/.claude/settings.local.json`,
`$PWD/.claude/*` and `~/.claude.json` on the real home. Read-only and not ours to grade, but
the judgment call as written overstates the isolation. One clause in the note.

### MINOR 7 — `confidential-withheld` DOES reach a screen, via the dashboard's narration

**RAN** (grep) and **READ**. Correcting my own first pass: `web/narrate.ts` gained a
`topBlocked()` helper (line 80) that sorts `blockedBy` worst-first, and the new `mcp.recall`
narrator (line 641) renders the top entry into prose:

```ts
const stopped = worst === undefined ? "" : ` ${String(worst[1])} more were kept out (${worst[0]}).`;
…
`I went looking on purpose and nothing came back, out of ${considered} considered.${stopped}`
```

With one confidential hit and nothing else gated, `worst[0]` is `confidential-withheld`, so
the dashboard prints — in plain English, on a page — *"I went looking on purpose and nothing
came back, out of 13 considered. 1 more was kept out (confidential-withheld)."*

No id, no title, no body; `reveal.ts`'s blanking is untouched and the memory itself is never
named. And the dashboard is the owner's own local surface, which is the same audience
judgment call 1 argues for. But judgment call 1 is written as *"the durable row"* versus
*"the wire"*, and this is a third audience the PR body does not mention: a screen, which gets
screenshotted, screen-shared and demoed. The gap §9.1 G5 refuses to announce to a caller is
announced here in a sentence.

Smallest fix: drop `confidential-withheld` (and any future silent verdict) from
`topBlocked()`'s output, or fold it into a generic "kept out by a gate" word on the narration
line only. The durable row keeps it either way, which is what judgment call 1 is actually
arguing for.

`registries.ts:176` and `web/flow.ts:409` also register the new name; both carry only the
event's description and a node label, no payload keys. `narrate.ts:773` sets `mcp.recall`'s
subject to `"none"`, so no memory is resolved for it — correct.

### MINOR 8 — `authorshipFindings`' one-clock `young` never expires on a store whose worker died

**READ.** `authorshipFindings` uses `const young = livedDay < YOUNG_LIVED_DAYS`, justified as
*"these two ambers are about how a session behaved, which cannot have happened at all before
the clock moved."* But the lived clock is advanced **only** by the worker:
`store.advanceClock()` has exactly one caller in `src/`, `sleep/cycle.ts:411`. Sessions ask
and deposit at every boundary whether or not the cycle ever runs.

So a store whose worker has been dead since day 1 — the spawn refused, no credential, a
broken checkout — accumulates a fortnight of `adapter.ask` and `gate.deposit` rows with a
perfectly meaningful cap/sweep ratio, and `Authorship` reads **GREEN, "too new to grade: this
store is on lived day 1"**, forever. That is precisely the store `FiredReport.young`'s
two-clock rule was written to protect, one finding over. The asymmetry is argued for in the
comment, but the premise ("cannot have happened before the clock moved") is false.

Smallest fix: use the same two-clock predicate here, or gate on the *number of ask/deposit
rows read* rather than on the clock — a ratio over 40 rows is a reading whatever day it is.

### MINOR 9 — the `mcp.recall` refusal column mixes filters with gates (latent)

**RAN**, probe `p1.ts`. A single ordinary question on a 17-memory store produced
`"blockedBy":{"below-floor":12}`. The PR body's own example is
`{"dark-uncued":31,"below-floor":4,…}`. `below-floor` and `dark-uncued` are "this memory was
not relevant", not "a gate said no" — the same category error as MAJOR 1. It is **latent**
rather than live because `mcp.recall` is `deliberate-recall`'s own evidence: any week with a
recall row is `firing`, and `blocked` is unreachable for it. It becomes live the moment
another mechanism points a `RefusalSource` at `mcp.recall`, and it is already visible in
`--json`.

---

## NIT

1. `fired`'s day-1 sentence degrades oddly once anything lands: *"This store is on lived day
   0 — **0 calendar days of records**."* (RAN, after three `note`s). "0 calendar days of
   records" is a strange thing to print beside a FIRING section that shows three deposits.
2. The LINEAR test's threshold (`ratio >= 8`) sits only 14 % below what the old
   implementation actually measured (11.3 on my run, 9.1 on the builder's). It is the right
   shape, but the margin against the *regression* it guards is thin; `>= 6` would still clear
   the linear implementation's 3.5 by a wide margin. (See "I ran this" below — 20 runs under
   load, no flake, so this is a nit and not a finding.)
3. `readHost`'s `HOOK_COMMAND_MARK` will not match a hook installed as
   `npx counterparts-hook` … it will, by substring — but it also matches any command
   *mentioning* the string, e.g. `echo counterparts-hook`. Harmless; noted for completeness.

---

## Checked and clean

Everything in this section I **ran**, unless marked READ.

### Privacy of the new rows (attack 1) — clean

A real MCP server over a real temp store, 16 filler memories plus one `meta: {confidential:
true}` memory, one question containing a sentinel word:

```
ROW: {"path":"question","reason":"answered","queryChars":44,"askedIds":0,"handleResolved":false,
      "semantic":"embedder-off","surfaced":1,"dim":0,"expanded":0,"considered":13,"storeSize":17,
      "owner":true,"chars":74,"truncated":false,"droppedForBudget":0,"blockedBy":{"below-floor":12}}
```

- **No query text.** `queryChars` is the trimmed length and nothing else. A length is not
  invertible in the sense scar §2.20 warns about (that scar is about a *short hash* of a
  low-entropy string; a scalar length carries ~7 bits and cannot be brute-forced back into
  words). The PR did **not** hash the query — which is the right call, and better than the
  scar's own example.
- **No memory ids**, on any path — confirmed by the branch's own test
  (`expect(JSON.stringify(rows)).not.toContain(id)`) and by inspection of `noteRecall`:
  every field is a count, a boolean, an enum or a reason string.
- **No id of a withheld confidential row.** `blockedBy` is keyed by *verdict name*; the
  count is the only quantity. One confidential hit writes
  `"confidential-withheld": 1` and nothing that distinguishes *which*.
- **The wire is still silent.** READ: `answerQuestion` still `continue`s past
  `confidential-withheld` and every `HARD_GATES` verdict before building `memories`, and
  `recallPayload` never reads `blockedBy` (the field is added to `DeliberateResult`, and
  `server.ts` is its only reader). A client sees `considered` and `returned` and can infer
  *a* gap — but that gap exists on `origin/master` too and is not what this PR added.
- **Leaving the machine**: the row is an ordinary `events` row, so it is inside
  `operational.sqlite` and therefore inside any `backup`/snapshot (they copy the database —
  state it plainly in `NOTES.md`; the PR does not). **The dashboard DOES render it — see
  MINOR 7**, which corrects my first pass on this line. No `export` surface serialises the
  event log. **Could not determine (see below):** whether the sweep's model call or the
  parallel-run tooling reads the event log wholesale — I ran out of time to trace those two.

### New writes on hot paths (attack 2) — clean

- **Observer stance writes nothing, proven over the WHOLE directory including `-wal`.** My
  fingerprint walks every file under the data dir (not the four names `test/mcp.test.ts`
  walks), so `operational.sqlite-wal` and `-shm` are hashed:

  ```
  OBSERVER whole-dir (incl -wal) identical: true
  ```

  after `recall{question}`, `recall{handle}` and `status` on an observer server.
  `noteAdapterEvent` checks `this.observer` before touching the store; `noteSpawnStart`
  checks `this.observer` before `bumpStart`; `Prospective.note` checks `this.observer`.
  **The builder's WAL point is correct and I confirmed the branch's own new observer test
  does *not* use a fingerprint at all** — it asserts `eventLog(…).length === 0`, which is a
  stronger and WAL-proof assertion. Good.
- **500 recalls**: `500 recalls in 240 ms; mcp.recall rows = 501`. One row per call, ~0.5 ms
  each including the write. Payloads are ~300 bytes, so a heavy day is well under a megabyte.
  READ: the 90-day retention window in `sleep/log.ts` sweeps them like any other row; nothing
  latches `mcp.recall`.
- **A failed row write never fails the recall**: `noteRecall` wraps in `try {} catch {}` with
  no rethrow, and `noteAdapterEvent` itself catches and returns `false`. `bumpStart` catches
  and returns 1. `Prospective.note` catches. Verified by reading all four.
- **Two concurrent MCP servers + a hook**: not run — see "could not determine".

### `fired`'s `blocked` state, the cases that are *not* lies — clean

RAN, probe `p2.ts`:

- A mechanism with 500 successes and one refusal in the same window reads **`firing`**, not
  blocked (`if (read.inWindow > 0) return "firing"` precedes the refusal check). Correct.
- Refusals are window-scoped: `tallyRow` returns before the `REFUSAL_READERS` lookup when the
  row is outside the window, so an old refusal cannot pin a mechanism to `blocked` forever.
- A mechanism that fired only last week and was refused once this week reads `blocked` and
  lands in `wentBlocked` — which is the intended behaviour and the reason `wentBlocked`
  exists. Doctor grades on both lists, so the "would have gone green" regression the builder
  caught is genuinely closed.
- `worker-start`'s refusal sources count **one per row**, not the row's running `count` field.
  Verified against the three `reasonOnce` readers.

### Day-1 honesty (attack 4) — clean, with the `--dir` caveat above

RAN through the real CLI (`run()` from `cli/commands.ts`) with `home` injected to a temp dir,
a fresh `counterparts init`, then three `note`s. Full output in my transcript; the shape:

```
AMBER Embedder    off — recall matches on words, not on meaning. That channel works; …
AMBER Credentials <home>/.counterparts/credentials.env holds no key — no key has ever been used here,
                  which is a supported way to run: everything you and the assistant write by hand still
                  lands — note, session_end, the journal, recall, the wake. …
AMBER Host        no hook of ours is installed on any of the 5 events …
AMBER Snapshot    no daily snapshot is being taken: this store is not inside a base directory …
GREEN Fired       this store is on lived day 0 — too new to grade; nothing has fired because nothing
                  has happened yet
```

- **No RED that a stranger cannot act on.** The only red in my run was `Checkout` (the
  unmerged-branch artefact the PR body already declares) and, in the guard-less variant,
  `Config … no such file` — which is correct for a store created with `init` and never
  `install`ed, and whose fix line names the command.
- **Keyless = AMBER with a sentence saying what works** — yes, verbatim above.
- **A key that WAS there and is gone = RED**: READ rather than run. `keyHistory.interpreted`
  is `any(GATE_CHUNK_EVENT, 1, () => true)` — one indexed row ever, over the whole log, so
  retention sweeping the window cannot undo it. The logic is right. I did not build the case
  because seeding a `gate.chunk` row and then removing the key is three lines and the code
  path is a single ternary; I flag it as READ-not-RAN honestly.
- **The false negative the builder admits** (key present, never exercised → amber): I judge
  this **acceptable**. The failure it avoids — every new keyless user told their install is
  broken — is certain and universal; the failure it accepts is a user who set a key, never
  crashed a session, then lost the key, and is told "optional" instead of "broken". They are
  still told the key is missing and what it does. Errs the right way.
- **`fired` prints one day-1 line**, and the full list returns at `YOUNG_LIVED_DAYS = 2` —
  i.e. on lived day 2, *and* only once a durable row is ≥ 2 calendar days old. The two-clock
  rule is the right one and I confirmed the boundary: probe `p2.ts` scenario A (livedDay 0,
  calendarDays 7) reads `young: false`, so a store whose worker died still gets its roll-call.
- **`status` numbers agree**: `Memories: 3` / `by kind: … fact 3` / `by band: episodic 3` /
  `Today (2026-09-20): 3 new` all consistent after three notes, and `0/0/0/0` before them.
  The `countMemories({learnedOnFrom})` vs census gap the builder logged does not show up on a
  day-1 store; I could not construct the divergent case in the time left.
- **The owner-like store got nothing quieter**: partially checked. The seven-night store
  printed *more*, not less (the two spurious BLOCKED lines of MAJOR 1). The only surface that
  goes *quieter* is `SessionStart`, and only for a store that never had a key — which is the
  intended change and is pinned in `hook-standdown.test.ts`.

### The Host check (attack 5) — clean

RAN, twelve fixtures under a temp home. Never threw, never wrote, never red, and every answer
names its files. Summary:

```
a) nothing at all                              events [] settingsRead [] mcp false
b) malformed settings JSON                     events [] settingsRead [] mcp false
c) hook points at a path that does NOT exist   events ["SessionStart"]  ← MINOR 1
d) OLDER install, different command path       events ["SessionStart"]  (bin/hook.ts form matched)
e) project-level settings only                 events ["Stop"] settingsRead [~/.claude/settings.json, ~/proj/.claude/settings.json]
f) mode-000 settings.local.json                (silently skipped)       ← MINOR 2
g) a DIRECTORY named settings.local.json       (silently skipped)       ← MINOR 2
h) MCP registered under another name           mcp false
i) malformed .claude.json                      mcp false, mcpUnreadable true
j) CLAUDE_CONFIG_DIR                           base moves; project settings still read
k) ~/.claude.json is a symlink OUT of HOME     followed                 ← MINOR 3
l) hostile hook shapes (string/null/number)    no throw, no match
```

Fixture (l) covers `hooks: "not-an-array"`, `[{hooks:[{command: 12}]}]`, `[null]` and
`[{hooks: null}]` — every one guarded. The fix strings name the exact command
(`counterparts install`) in both branches.

### `doctor --dir` and the wrong store (attack 6) — clean

RAN. `--dir <A> --config <cfg naming B>`:

```
AMBER Store  read <A>, but …/cfg.json names …e2rev-other-MyaJDB — the hooks read the second one
             fix: Drop --dir (and COUNTERPARTS_DATA_DIR) to read the store the hooks use.
GREEN Config …/cfg.json — read; dataDir …e2rev-other-MyaJDB
```

It cannot be tricked into grading the wrong store green, and it says which one it graded, by
absolute path, twice. With `--dir` and no config: `AMBER Config not read …`, and
`credentialFindings` and `snapshotFindings` are both skipped (confirmed by their absence from
the printed report). See MINOR 6 for the part of the isolation claim that overstates.

### `sight()` made linear (attack 7) — clean

- **Equivalence, by construction**: `WAKE_HEAD_SENTINEL` / `WAKE_TAIL_SENTINEL` are
  `/^<!-- counterparts:wake(\/end)? [^>\n]*elements=(\d+) bytes=(\d+) -->/` — anchored at the
  slice start, no `m` flag, no `s` flag, and the only variable-width atom explicitly excludes
  `\n`. Every other atom is a literal with no `\n` in it. A match therefore cannot cross a
  newline, so widening the slice from "up to the next newline" to "up to
  `SENTINEL_MAX_BYTES`" cannot change which matches are found, CRLF included (`\r` was
  already admitted by `[^>\n]*` on both sides). Multi-byte characters at the cut behave
  identically because both implementations use the same `from + SENTINEL_MAX_BYTES` ceiling
  in UTF-16 code units.
- **Equivalence, empirically**: I reverted `sight()`'s cut to the old
  `text.indexOf("\n", from)` line and ran `test/claude-code.test.ts` +
  `test/hook-standdown.test.ts` — **238 pass, 1 fail**, and the one failure is the LINEAR test
  itself. Every existing fixture, including the code-block and quoted-memory sentinel cases
  and the `mismatch`/`matchesExpected` precedence tests, produces identical results under both
  implementations.
- **The LINEAR test really does catch the regression**:

  ```
  error: expect(received).toMatchObject(expected)
    { "quadratic": false }  vs  { "quadratic": true, "ratio": 11.3 }
  (fail) the sentinel search is LINEAR: a body of unterminated prefixes cannot stall a turn
  ```

  I restored the file immediately afterwards; `git status` is clean but for this review file.
- **Not flaky under load**: 20 consecutive runs of the LINEAR test with a full `bun test`
  running beside it on the same machine — **20 × `1 pass  0 fail`**, no flake.

### install-loop (attack 8) — partially checked

READ. The `npm pack` fix is correct and minimal: stderr goes to `$WORK/npm-pack.stderr`
instead of into the command substitution, so `tail -1` can only ever see stdout, and the
failure message now prints both streams. That is exactly the right shape for the reported
one-in-five flake. **Not run** — see "could not determine". Steps 27–28 are **not** touched by
this PR's `run.sh` diff (the only hunk is the pack step); what *does* move under them is the
`SessionStart` `systemMessage`, which this PR removes for a never-keyed store — so if those
two steps assert on a `systemMessage` for the stand-down warning they will behave differently
after this merge. Flagging for the N1 builder rather than as a finding here.

### Regression sweep (attack 9) — clean

- **The narrowed `test/mcp.test.ts` assertion is still a real guarantee**, and a better one.
  The old `fingerprint(dir)` over `operational.sqlite` proved nothing in WAL mode; what
  replaces it asserts box 1 + spans byte-identical, the id list unchanged, every memory's
  `uses` unchanged, `recall.decision` row count unchanged, and `mcp.recall` **exactly 2**.
  That last clause is the strongest part: it pins the *number* of new rows, so a future write
  on this path cannot slip in silently. §9.1 G4 ("ranking is not recording") is directly
  asserted rather than implied.
- **`hook-standdown.test.ts`'s pinned string**: the change is real and deliberate, the
  docstring explains it, and it is the intended consequence of moving keyless from red to
  amber. I agree with the reasoning.
- **Registries**: `dashboard/registries.ts` +26 lines add the new names; no duplicate keys
  (the suite's own registry-completeness tests pass).
- **`FIRED_STATES` / `STATE_ORDER` / `STATE_MEANING`** all gained `blocked` consistently.
- **Nothing unexplained in the diff.** Every hunk I read carries a comment tying it to a
  finding number or to E2. `reportLines`' `padEnd` fix (`GREEN Journal modewal`) is a genuine
  one-line bug fix and is correct.
- **No test deleted or skipped.** `grep`-checked: no new `test.skip`, `describe.skip` or
  `.todo` in the diff.
- **Leftovers**: 80 `counterparts-*` dirs in `$TMPDIR` before and after the full suite.

---

## I ran this / I read this

**Ran** (all under `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`, temp stores made with `mktemp -d`,
fake home injected via `run()`'s `home` option, `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` on
spawned bun processes, `caffeinate -i` on every long run):

1. `bun test` — 2489 pass / 0 fail / 42 files / 62.80 s. `bunx tsc --noEmit` — clean, exit 0.
2. `p1.ts` — MCP recall privacy, the confidential case, 500 recalls, observer whole-directory
   fingerprint including `-wal`/`-shm`.
3. `p2.ts` — six synthetic `fired` scenarios (healthy nights, went-blocked, 500-successes,
   no-`reason` row, pre-PR schema, empty store).
4. `p3.ts` — a real `runCycle` over 40 memories × 7 nights, to read the *real* skip
   vocabulary rather than one I invented.
5. `p4.ts` — the end-to-end proof of MAJOR 1: real `Counterpart`, real `sessionEnd`
   boundaries, real `sleep.cycle` rows, real `firedReport`.
6. `p5.ts` — twelve `readHost` fixtures under a temp home.
7. `p7.ts` — day 1 through the real CLI (`init`, `doctor`, `fired`, `status`, three `note`s,
   `status`, `fired`), plus the `--dir`/`--config`-disagree case.
8. The LINEAR test against a temporarily-reverted quadratic `sight()` (fails, ratio 11.3),
   and the two transcript suites against it (238 pass / 1 fail).
9. 20 consecutive runs of the LINEAR test with a full `bun test` running beside it — 20 ×
   `1 pass  0 fail`, no flake.

**Read, not run**: `deliberate.ts`'s wire-silence path, `recallPayload`, `NOTES.md` §9.1
G4/G5, `docs/mechanism-inventory-2026-09-17.md`, `docs/recall-surfacing-diagnosis-2026-09-18.md`,
`docs/new-user-findings.md`, `tools/install-loop/run.sh`, `physics/index.ts`'s three
`blockedBy` vocabularies, `sleep/{consolidate,prune,dedup,decay}.ts`'s `countSkip` call sites,
the whole `doctor.ts` and `fired.ts` diffs, `keyHistory`'s red/amber discriminator.

**Could not determine**

- Whether the crash sweep's model call or the parallel-run tooling reads the event log
  wholesale and could carry an `mcp.recall` payload off the machine. I found no such path but
  did not trace either one to the end.
- `tools/install-loop/run.sh` × 10 under a fake home, and install-loop steps 27–28 — not run.
  The harness wants a real `HOME` redirect at the shell level, which this worktree's guard
  refuses; it needs a session that can grant it.
- Two concurrent MCP servers plus a hook against one store ("database is locked"). Not run.
- The `countMemories({learnedOnFrom})` vs census divergence: I could not construct a store
  where the two disagree in the time available, so I can neither confirm nor clear the
  builder's own NIT.
- Whether `readHost`'s four paths and `~/.claude.json` are current for the host version the
  owner runs. I took the builder's "verified 2026-09-20" on trust; I did not open the host's
  own files (hard rule).
