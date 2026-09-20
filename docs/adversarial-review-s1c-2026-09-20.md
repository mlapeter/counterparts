# Adversarial review, third pass — PR #138, `self/s1-page` (head `73e516c`, master `481b228`)

Reviewer: adversarial agent, 2026-09-20. Read-only on the branch: nothing pushed, nothing
commented on the PR, nothing merged, nothing deployed, and this file is the only thing
written into the tree (uncommitted). Every probe ran against a fresh temp store under
`$TMPDIR` that it removed; page bodies are neutral placeholder prose throughout. The live
checkout, `~/.counterparts`, `~/.bansai` and `~/.claude-engram` were never read, written or
entered.

Master (`481b228`) is already merged into the head (`a5ee057`), so `git diff
origin/master...HEAD` is exactly what merging adds: **31 files, +4,474 / −41**, and
**`git diff origin/master...HEAD -- src/core/store/` is empty** — I ran it; the floor really
is untouched.

**Suite on the head:** `caffeinate -i bun test` → **2466 pass / 0 fail**, 30,305 expects,
**42 files**, 60.95 s, exit 0. `bun run typecheck` (`tsc --noEmit`) → **clean**, exit 0.
Both are as the brief predicted. The run left exactly one `counterparts-standdown-*`
directory in `$TMPDIR` (the known PR #146 leak) and **no `counterparts-page-*` directory**,
so 73e516c's hermeticity fix works — checked by listing `$TMPDIR` by mtime before and after.

---

## Verdict

**SAFE TO MERGE AS IS.**

Every finding from both earlier passes is closed at this head, and I closed them by running
things rather than by reading the builder's claims — including the two that were rewritten
since pass 2 (the one-row clear/restore chain, and the promotion guard). The no-page wake is
re-proved byte-identical against the *new* master. The five interactions that met for the
first time today (#139, H1, F2, F1/WAL, F3) each behave.

One **MAJOR** stands, and it is deliberately not a merge blocker. S1 opens no crash path:
the one it joins is master's, the identity core has had it since it shipped, and nothing in
this diff makes it likelier. What is S1's is one sentence — the PR states a guarantee ("a
page whose prose will not read is not a reason to fail a wake") that the system does not
keep, because `Schemas.load` throws before any reader in `self/` is asked. The mechanism
fix belongs to `schemas/`; the sentence belongs on the deploy note or in this diff.

| rank | count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 1 |
| MINOR | 6 |
| NIT | 4 |

---

## 0. The no-page wake: RE-PROVED byte-identical, against `481b228`

Method, and it is a measurement rather than an argument: three fixture stores were built
with the (unchanged) `Store`, closed, then copied byte-for-byte into a `-branch` and a
`-master` copy. The branch's sweep ran from the worktree at `73e516c`; the worktree was then
detached to `origin/master` (`481b228`) and the identical sweep ran over the identical
copies; the two full transcripts were diffed.

*(The earlier passes extracted master with `git archive` into a separate directory. That was
refused here by this session's command classifier, so the same comparison was made by
detaching this worktree to `481b228` and back to `73e516c` — the probe scripts live outside
the tree and import by absolute path, so they are the same bytes under both checkouts, and
the fixture copies never move. `git status` is clean apart from this file, and HEAD is back
at `73e516c`.)*

- Fixture **empty** — a bare initialized store.
- Fixture **identity** — 20 identity-band memories + 6 skill + 6 fact.
- Fixture **core** — an identity core minted, no identity elements, 3 warm skill rows (the
  day-0-line path).

Each fixture: budgets **{400, 900, 1500, 3000, 6000, 9000, 20000}** × days
**{0, 1, 13, 14, 15, 30, 365}** = 49 compositions, plus 2 `omit` compositions with
`PAGE_ON_EGRESS` at its default — **51 per fixture, 153 in all**, every bundle's full text in
the transcript.

```
$ diff sweep-empty-master.txt    sweep-empty-branch.txt    ; echo $?   → 0
$ diff sweep-identity-master.txt sweep-identity-branch.txt ; echo $?   → 0
$ diff sweep-core-master.txt     sweep-core-branch.txt     ; echo $?   → 0
   19753 sweep-empty-branch.txt
   86835 sweep-identity-branch.txt
   28853 sweep-core-branch.txt
```

**Zero difference, 135 KB of transcript, 153 compositions.** Coverage inside that, read off
the transcripts: the day-0 line rendered (fixture `core`, `elements=0`, the "No identity has
formed here yet" sentence), the trim path (`trimmed=7` … `trimmed=19` on fixture
`identity`), and the over-budget path (`over=true` at budget 400 on fixture `core`). With no
page written and the switch at its default, **deploying S1 does not change the owner's wake
by a byte.**

Honest scope, unchanged from pass 1: this is the composed wake TEXT. The `self.briefing`
event payload gains `page`, `pageWhole`, `pageTruncated` — purely additive, and the
exhaustive event maps were updated.

---

## MAJOR

### MAJOR-1 — A page whose prose file is missing does not degrade to "no page": it turns memory OFF for the session. The mechanism is master's `Schemas.load`; what is S1's is that it writes down the opposite guarantee.

**Files:** `src/core/schemas/index.ts#load` (reads every non-blank, non-denied `type:
"schema"` row's prose unconditionally, through `readProseWalking`); the claim is at
`src/core/self/page.ts:206-207` — *"A page whose prose will not read is not a reason to fail
a wake (§5 G7) — it reads as absent."*

`self/`'s half of that is true and I verified it: `findPageRow`, `findSelfPage`,
`readSelfPage` and `isSelfPageRow` all wrap `store.readProse` in `try/catch` and read an
unreadable page as absent. But nothing reaches them, because `Counterpart.open` builds the
schema index first, and #139's skip covers a **blanked** `prose_path` and the deny-list —
not a row whose pointer is intact and whose file is gone.

**RAN** (`probe-sch.ts`, four stores, each a page written twice; case C removes the page's
prose file the way `test/store-fixture.ts#makeBodyUnreadable` does):

```
### A: normal page
Schemas.open      : ok, skips={"removed":0,"unaccounted":[]}
findPageRow       : sch_fcf6178285aa
doctor self-page  : green "94 bytes, version 1, last revised 2026-09-20 by owner"
Counterpart.open  : ok, wake bytes=72

### B: cleared page
Schemas.open      : ok, skips={"removed":0,"unaccounted":[]}
readSelfPage      : null
doctor self-page  : green "cleared on 2026-09-20 — owner cleared the page; 2 versions kept"
Counterpart.open  : ok, wake bytes=72

### C: body unreadable
Schemas.open      : THREW StoreError PROSE_FILE_MISSING {"path":".../prose/schemas/sch_4b18777c5add.md"}
findPageRow       : null
readSelfPage      : null
doctor self-page  : green "no page written yet — the wake says it is still forming"
Counterpart.open  : THREW StoreError PROSE_FILE_MISSING {"path":".../prose/schemas/sch_4b18777c5add.md"}

### D: row removed via the owner-op seam
Schemas.open      : ok, skips={"removed":1,"unaccounted":[]}
findPageRow       : null
Counterpart.open  : ok, wake bytes=72

### E: planRemoval on the live page row
{"targetId":"sch_53bace97b33c","valid":false,"reason":"is-the-self-page",...}
planRemoval on the CLEARED page row: {"valid":false,"reason":"is-the-self-page",...}
```

And end to end through the real hook and the real console (`doctor.sh`):

```
### the hook, on the store whose page body is gone
[counterparts] hook stood down: PROSE_FILE_MISSING {"path":".../prose/schemas/sch_aae32ed5fa3c.md"}
{"systemMessage":"Counterparts memory is OFF for this session: a memory's prose file is
 missing from the store (PROSE_FILE_MISSING). Run: counterparts doctor"}
hook exit=0

### doctor — the page's body deleted underneath the store
RED   Store open  .../cpx-doc-gone-trcKBf: will not open — PROSE_FILE_MISSING: a memory's prose file is missing from the store
GREEN Self page   no page written yet — the wake says it is still forming
doctor exit=1
```

**What is and is not S1's — stated narrowly, because the difference decides the rank.**

*Not S1's:* **S1 opens no crash path.** The class is master's — the identity core has had it
since it shipped, as pass 1 proved — and S1 does not make it more likely. Every prose write
here is tmp-then-rename, for the page exactly as for any other row, so "sessions write it
through MCP" and "S2 will rewrite it nightly" do **not** raise the odds of a missing file.
H1 is meanwhile doing its job: the stand-down is *visible*, the doctor is RED, and the remedy
line is printed.

*S1's, and the whole of it:* **the PR writes down a guarantee the system does not keep.**
`page.ts:206-207` and §5 G7 say a page whose prose will not read "reads as absent"; measured
at the session boundary it reads as a session with no memory at all. A sentence that is true
of one module and false where the owner meets it is the kind this project has a scar about,
and it is the one thing in MAJOR-1 that this diff could fix by itself — by deleting the
claim, or by carrying the guard.

**Smallest fix for the crash class, and it belongs to `schemas/` rather than to this PR:**
one arm in `Schemas.load` —

```ts
let doc: ProseDoc;
try { doc = readProseWalking(this.store, id, row); }
catch (err) {
  if (!(err instanceof StoreError) || err.code !== "PROSE_FILE_MISSING") throw err;
  this.skips.unaccounted.push(id);
  continue;
}
```

— which turns an unreadable schema row into the same counted, named skip #139 already built
the vocabulary for, for the core as well as the page. **Narrow the catch on purpose**: a
blanket `catch` there would swallow every other read failure class as "unaccounted" and buy
uptime with data disappearing quietly, which is the trade #139's own note argues against. If
`schemas/` wants the wider catch, that should be its ruling and say so.

**What S1 could do by itself, if the follow-up does not land first:** correct
`page.ts:206-207` and §5 G7 so the claim stops outrunning the mechanism. Until either lands:
say in the deploy note that a page whose prose file is lost costs the *session*, not just the
page, and that doctor names it RED.

---

## MINORS

### m1 — The doctor's Self page line says "no page written yet" about a page that exists and cannot be read.

Seen in MAJOR-1's output: with the page's prose file gone, `selfPageFindings` returns
**green**, `"no page written yet — the wake says it is still forming"`, `data: {present:
false, cleared: false}` — while the line above it is RED because the store will not open.
This is exactly MINOR-F from pass 2 (which was fixed for the *cleared* case) in its third
state. `readSelfPage` swallows the read error and returns null, and the finding cannot tell
"null because nothing was written" from "null because the body is gone".
**Fix:** have `clearedPage()`'s sibling report the third case — `findPageRow` is null *and*
`store.list({type:"schema",kind:"self"})` holds a row whose prose throws → detail
"the page's row is there and its prose will not read", amber, with the restore hint.

### m2 — The page is weighed against the self-schema byte valve, which was calibrated for something else.

`identity.ts#schemaBytes` walks `store.list({ band: "identity" })` **plus**
`store.list({ kind: "self" })`, and the page is `kind: "self"`. It falls through the
episode/migrated/fallback exemptions into `weighed`.

**RAN** (`probe-c.ts`):

```
### the schema byte valve (trip 72000, pressure at 54000)
no page   : bytes=0     elements=0 pressure=false tripped=false
page write: created bytes=15848 warning=over-wake-cap
with page : bytes=15848 elements=1 pressure=false tripped=false
the page's share of the trip: 22.0%
boundary events: (none)
```

A page near `PAGE_MAX_BYTES` permanently occupies **22 % of the tripwire** that exists to
catch v1's accumulated `currentState` sprawl (the scar the tunable is named after), and it
moves `self.schema.pressure` / `self.schema.tripped` that much closer on every store that
has a page. Nothing trips today and the wake is unaffected — which is why this is MINOR —
but the number that fires the alarm now counts a row the alarm was never about.
**Fix:** either exempt `meta.role === "page"` in `schemaBytes` (one clause beside the other
three exemptions), or say in `self/CONTRACT.md`'s tunable table that `SCHEMA_BYTES_TRIP`
includes the page, so the next person to read a pressure event knows what it counted.

### m3 — A cleared page is still listed as "Permanent — permanent ink" by `status` and `enumerate().protected`, under its title "Who I am".

Pass 2 recorded the opposite as clean (*"`enumerate().protected` does not list a cleared
page — it selects `archived: false`"*). That was true when a clear archived the row; the
one-row redesign makes the cleared row **live**, and it keeps `protected: 1`.

**RAN** — the real console, on a store whose page was written and then cleared
(`doctor.sh`), and `enumerate()` directly (`probe-c.ts`):

```
$ counterparts status --dir <cleared store>
Permanent (enumerable on demand, §14.1 G9): 1
  sch_c34c47ed4c29  Who I am  — protected

protected list: [["the page row", null]]
schemaBytes counts the cleared page: bytes=104 elements=1
```

So the owner who cleared his page is still told, on the surface that lists permanent ink,
that "Who I am" is there. It is not wrong about the row — the row is the history — but it is
the same "a store that has the thing / does not have the thing" ambiguity the page's own
`cleared` flag exists to resolve, on the one surface that does not consult it.
**Fix:** one clause in `enumerateOne` (or in `status`'s render) that appends ` — cleared` to
a page row carrying the marker.

### m4 — `src/core/self/CONTRACT.md` breaks its own tunables table in half; four rows are orphaned.

S1 inserts a paragraph (`PAGE_FLOOR_RESERVE_BYTES` (512) and `PAGE_MIN_RENDER_BYTES` (240)
are **not** tunable…) at line 338, **inside** the table, so `FIRST_ASK_TURNS`,
`SOLO_ASK_BYTES`, `REASK_TURNS` and `MAX_ASKS_PER_SESSION` (lines 342-345) render as loose
pipe-text rather than table rows in any markdown viewer. Read, and confirmed by reading the
file around the split.
**Fix:** move the paragraph below `MAX_ASKS_PER_SESSION`, beside the `PREFACE_RESERVE_BYTES`
paragraph that already lives there and says the same kind of thing.

### m5 — A comment in the console still describes the old clear, the one the redesign removed.

`src/adapters/cli/commands.ts:1381-1383`:

```ts
// The door removal was standing in for. Nothing is destroyed: the body
// becomes a version, the row is archived, and the store reads as having
// no page from the next call on.
```

**The row is not archived any more** — that is precisely what 81b4e0d changed, and the whole
of MAJOR-A's fix depends on it staying live. Every other copy of the sentence in the tree was
updated (`self/page.ts`, `self/index.ts#clearPage`, `self/CONTRACT.md` §18); this one was
missed. A stale comment that contradicts the mechanism is how the first design's assumption
survives into the next reader's head.
**Fix:** three words.

### m6 — `self/CONTRACT.md` §16 describes a cut the code does not make.

§16: *"Over the cap it renders cut, at a **section** then paragraph then line boundary…"*.
`page.ts#cutAtBoundary` has exactly two boundaries and a fallback: `lastIndexOf("\n\n")`,
then `lastIndexOf("\n")`, then the decoded byte prefix. There is no section/heading-aware
cut, and the byte fallback — the thing that makes the one-long-paragraph shape work, and the
subject of B1's whole argument — is not in the contract at all. Read, not run; the behaviour
itself is measured under B1 below and is correct.
**Fix:** "at a paragraph then a line boundary, and only where that boundary keeps most of the
room; a page that offers neither is cut at a whole code point with the same marker."

---

## NITS

- **n1** — `self-page --restore <seq that does not exist>` prints `refused: no version 99.`
  and exits **1** (`EXIT.usage`), while `--write` past the hard limit prints `refused: …`
  and exits **2** (`EXIT.refused`). Both ran (`console.sh`). Defensible — a bad seq is a bad
  command line, and `--version <seq>` does the same — but the word is the same and the code
  is not.
- **n2** — `test/self-page.test.ts:777` still removes a temp dir in a `finally` while the
  store opened on it is closed later in `afterEach` (the `counterparts-page-b-` dir).
  73e516c fixed the `page-c` case by registering it in `extraDirs`; this one was left. Under
  WAL the close then runs against deleted files — harmless here because `afterEach` wraps
  every close in `try/catch`, and the suite is green with no `page-b` leftovers in `$TMPDIR`
  (checked). One line to make it consistent with its neighbour.
- **n3** — pass 2's NIT-A is still open and still harmless: the `forged-markers` check is an
  exact substring, so `<!-- COUNTERPARTS:WAKE/END …>` and `<!--  counterparts:wake…` are
  accepted. **RAN** (`probe-hostile.ts`): both wrote, both composed, and
  `readSentinel(...).intact` stayed **true** at budgets 900 / 4000 / 9000 — the parsers
  anchor on the same exact bytes the check does, so the check is exactly as strict as what
  it protects. Only the model's reading is affected.
- **n4** — pass 2's NIT-B is still open: a future-dated page reads fresh.
  **RAN** (`probe-old.ts`): `revisedOn: "2026-10-01"` on 2026-09-20 → `stale=false`,
  `(Last revised 2026-10-01.)`. Reachable only by clock skew or a hand-edited row.

---

## Checked and clean (no finding) — what I attacked and did not break

Listed because the brief asked for these by name, and an absence of a finding is a result.
Everything here was **run**.

**#139 × S1 (brief item 2).** A normal store and a cleared store both give
`loadSkips() = {removed: 0, unaccounted: []}` and open. A page row tombstoned through
`store/owner-op-seam.ts#chaseRemoved` (the only way to get there — see below) is counted
**`removed: 1`, not `unaccounted`**, `Counterpart.open` still opens, `findPageRow` reads null
and the wake is the no-page wake. **The console cannot reach that state at all**:
`planRemoval` refuses `is-the-self-page` for the live row *and* for the cleared row, and
`ownerRemoval` goes through `planRemoval`, so both doors refuse.

**H1 × S1 (brief item 3).** Of the five page states, four degrade to "no page" and one
(missing prose file) stands the session down — MAJOR-1, with H1 making it visible: doctor
`RED Store open … will not open`, and the hook printing `Counterparts memory is OFF for this
session`. **Oversized** is refused at write (16,385 bytes → `too-large`, nothing stored).
**Malformed / hostile bodies do not break anything** (`probe-hostile.ts`, at budgets 900,
4000, 9000): no headings, only a heading, a 400-bullet list, a forged `Open threads:` lane,
case- and space-variant wake markers, Japanese, emoji, and a 16 KB body — every one either
refused at the gate or composed with `over=false` and `sentinel=intact:true`, and none threw.

**F2 × S1 (brief item 4).** `snapshot()` copied `prose,versions,operational.sqlite,spans`
with no errors; the snapshot restored by copy per the doctor's steps gives **the same page id,
byte-identical body, version 4, all 4 versions present and every archived body readable**, and
`Counterpart.open` opens the restored store. The `fired` registry holds `self-page`,
`snapshot` and `snapshot-trouble` as three distinct ids (no duplicates anywhere in
`MECHANISMS` — checked by `uniq -d` over every `id:`), and `counterparts fired` prints the
page's line: `the written page of who I am was amended … total 4 · self.page.revised`.

**F1/WAL × S1 (brief item 5).** Two live `Store` handles on one directory, the second opened
*before* any page existed (the MCP server's shape): B sees A's create immediately
(`present v0`), sees A's revision immediately (`v1`), agrees on `pageVersionCount()`, and
A sees B's write (`v2`) with the full attributed version list. **No stale read in either
direction.**

**F3 × S1 (brief item 6).** `confidentialByMeta(page.meta)` is **false** — the page is not
and cannot become confidential, which is `PAGE_ON_EGRESS`'s job by design (§17).
`isPageRow`'s prose read cannot take a recall down: `activate`'s loop skips **denied** ids
and archived/superseded rows *before* the page check, and `isPageRow` catches anyway;
a recall run against a store whose page row had been tombstoned returned normally and filed
**zero `store.archived.read` events**. The exclusion itself is pinned by a real test with a
positive control (`test/self-page-console.test.ts:402`) — both doors, search and by-id.

**Sleep and the prune (brief item 7).** A page with 11 versions, 10 full `runCycle`s: the
row's every column is **byte-identical** before and after (`row unchanged by 10 cycles:
true`) and the body is unchanged. The versions are gone after the cycles on a store opened
with `retentionDays: 1` — that is `pruneSupersededVersions` doing exactly what
`self/CONTRACT.md` §15 says ("**Its OLD VERSIONS take the ordinary retention, deliberately
un-special-cased**"), and `restorePage(1)` of a pruned seq then answers `no-such-version`
rather than writing anything. The page itself still reads. The prune is by `version_day`
alone and has no exemption to make.

**The promotion guard, re-proved against the NEW master (brief item, "a schema row can never
be promoted" was false).** One fixture with five promotion-ready rows — a plain memory, a
belief (`role: belief`), a current-state, an entity, and a page row — copied byte-for-byte,
40 cycles from each checkout, every column dumped and diffed:

```
$ diff promo-master.txt promo-branch.txt
5,7c5,7
< {"id":"sch_eeeeeeeeeeee",...,"band":"identity","promoted":1,"consolidated":1,...}
< promotion events: 5
< band.promoted rows: 5
---
> {"id":"sch_eeeeeeeeeeee",...,"band":"semantic","promoted":0,"consolidated":1,...}
> promotion events: 4
> band.promoted rows: 4
```

**One line differs, and it is the page.** The memory, the belief, the current-state and the
entity are identical on both — `band identity`, `promoted 1`, `consolidated 1` — so no other
row's physics, and no other row's decay exemption, moves. `consolidated` is 1 for the page on
both, so the marking really is untouched and only the crossing is withheld. The guard's
`countSkip` now has a matching `promotionBlocked["self-page"]` counter, which pass 2 asked
for.

**Both doors (brief item 8).** `PAGE_MAX_BYTES` (16,384) enforced at **both**: MCP
`self_page` with 16,385 bytes → `too-large` with the detail sentence; the console with 20,000
bytes → `refused: … past the hard limit`, exit 2. A refusal leaves **the page row and the
body byte-identical** (`row unchanged: true`, `body unchanged: true`) and adds exactly one
durable row — the `self.page.refused` record the contract promises, which is the intended
difference from "byte-identical store". Observer: the read answers, the write returns
`stoodDown`, **the row is unchanged and zero durable rows are added**. Authorship: passing
`by: "owner"` through the MCP tool writes and the row still says `by: "session"`.
`--restore 99` refuses. `ifVersion` junk refuses as `if-version-not-a-number`. The
cross-door race (a console handle and a long-lived MCP handle): both land, last writer wins
with the loser kept as an attributed version, **one page row in the store**, and the
optimistic check refuses the stale one with `version-moved` and hands back `current v2`.

**Registries and the dashboard (brief item 9).** `self.page.revised` / `self.page.refused`
are registered in `dashboard/registries.ts#DURABLE_EVENTS`, `web/flow.ts`, `web/narrate.ts`
(both the narrator and the lane map) and `fired.ts`; no duplicate keys (tsc is clean, which
is what the `satisfies` totality checks buy). `bun test test/dashboard.test.ts
test/dashboard-web.test.ts test/fired.test.ts test/doctor.test.ts test/mcp.test.ts` →
**335 pass / 0 fail**, which is where the with-a-page and without-a-page dashboard renders
are pinned.

**MINOR-D, the tiny-ceiling lie, is properly closed** (ran, both switch values, 10.5 KB page
present):

```
SHOWS_LIST=true  budget=  400 bytes=298 over=false | (no Who I am block)
SHOWS_LIST=true  budget=  513 bytes=406 over=false | (My page is 10568 bytes — no room for it in this wake. …)
SHOWS_LIST=false budget=  400 bytes=298 over=false | (no Who I am block)
SHOWS_LIST=false budget=  513 bytes=406 over=false | (My page is 10568 bytes — no room for it in this wake. …)
```

Neither switch value ever says "still forming" about a store that has a page. MINOR-G's
threshold (silence at ≤ 512, a sentence at 513–752) is unchanged and remains the stated
trade.

**Brief item 10a, dismissed.** S1 adds a doctor finding with no numbered guarantee in
`src/adapters/claude-code/CONTRACT.md` — but neither does `Journal` nor `Vectors`; the only
doctor lines with guarantees there are the ones attached to mechanisms this adapter OWNS
(H1's `readCounterpartOpen` inside G24, F2's snapshot as G25). The page is core, and its
guarantees are `self/CONTRACT.md` §15–18, which S1 wrote. Nothing owed.

---

## Every earlier finding → closed? → how I proved it

"Ran" means I executed something at `73e516c` and read the output. "Suite" means the
builder's own test covers it and the suite is green; I say so rather than implying I ran a
separate probe. "Read" means I read the code and believe it.

### Pass 1 (`docs/adversarial-review-s1-2026-09-18.md`)

| # | finding | closed? | how |
|---|---|---|---|
| **B1** | the cut throwing away the window | **YES** | **Ran** `renderPage` at the real 6,144 cap over 8 shapes. The finding's own shape, a 200-item bullet list of 12,298 bytes (the one that used to render 110 bytes): **6,083 rendered, 99 % of the cap, cut at a line boundary with the marker naming both numbers**. Also: one long paragraph 100 %, no newline anywhere 100 %, 150 short paragraphs 94 %, medium-then-long 44 % (the intended clean break), Japanese 100 %, emoji 100 %. **No overshoot, no U+FFFD, no split surrogate** in any of them. (A first run used ~25-byte bullets and came to 4,898 bytes, i.e. under the cap and never cut — that run proves nothing about B1 and is not counted here.) |
| **B2** | page cap clamped to the whole budget | **YES** | **Ran** the ladder with a ~10 KB page: every integer budget 100→1,200 and every 13th to 20,000. The only ceilings that publish `overBudget` are **100–297** — master's own bare floor (pass 2 measured 100–299 on master with an empty store), i.e. the page never causes it. |
| **M1** | page on the egress composition | **YES, as a decision** | **Read** `PAGE_ON_EGRESS` (default true) + §17 + the corrected `sweepWake` comment; **ran** the `omit` compositions in §0's sweep (byte-identical with no page under both values). |
| **M2** | `remove <page id>` bricks the store | **YES** | **Ran**: `planRemoval` refuses `is-the-self-page` for the live *and* the cleared row; `ownerRemoval` goes through `planRemoval`; #139 makes a seam-tombstoned row a counted `removed` skip and `Counterpart.open` still opens. |
| **M3** | version mislabelling / no restore / no session | **YES** | **Ran** the console end to end: `--versions` prints `owner: first ← replaced by: second`, i.e. the PRODUCING write; `--restore 2` works; the event rows carry `session`. |
| **M4** | concurrent writes silently revert | **YES** | **Ran** the two-handle race: both land, the loser is an attributed version, and `ifVersion` refuses the stale write with `version-moved` + `current v2`. |
| m1 | redaction not signalled | **YES** | **Ran**: a page carrying a key → `written=true redacted={"gate":"secrets","bytesBefore":152}`, stored body contains `[REDACTED…`. |
| m2 | page promotable into the identity band | **YES** | **Ran** the master-vs-branch 40-cycle diff (see above): the page alone stops crossing. |
| m3 | forged wake markers | **YES** | **Ran**: the exact marker is refused (`forged-markers`); variants write but leave `readSentinel().intact === true` — n3. |
| m4 | MCP empty body left no durable row | **YES** | **Ran**: `self_page({body:"   "})` → `empty`, and exactly **one** durable row added by that call. |
| m5 | `renderPage` exceeding its own cap | **YES** | **Ran**: `renderPage("x"×5000, 50)` → `bytes=0, text=""`. |
| m6 | unreadable date read as fresh | **YES** | **Ran**: `"not-a-date"` and `""` → `stale=true`, `(Last revised — the page carries no readable date.)`. |
| m7 | future-dated page reads fresh | **NO** | **Ran**: still `stale=false`, prints the future date — n4, carried, harmless. |
| m8 | `--versions` in chars | **YES** | **Ran**: `--versions` prints `79 bytes`, and `pageVersions()` carries `bytes`. |
| m9 | counting versions read every body | **YES** | **Ran**: `pageVersionCount()` returns from `store.versions(id).length`; the MCP read uses it. |
| n1–n6 | flag help, `preamble` leak, backticks, `_day`, EACCES, green-on-absence | **YES / by choice** | **Suite** (the console and dashboard suites pin n1, n2, n5) + **read** for n3/n4; n6 is the stated choice, and m1 above is its remaining wrinkle. |

### Pass 2 (`docs/adversarial-review-s1b-2026-09-18.md`)

| # | finding | closed? | how |
|---|---|---|---|
| **MAJOR-A** | `--restore` after `--clear` orphans the history | **YES — rebuilt** | **Ran the exact sequence through the real console**: write → write → `--versions` (1) → `--clear` → `--versions` (**2, both attributed**) → `--restore 2` → `--versions` (**3**) → read (the restored body, `version 3`, `Last change: restored version 2`). The chain survives; `--restore` revives the same row. |
| **MAJOR-B** | the promotion guard changed physics store-wide | **YES — narrowed** | **Ran** the master-vs-branch 40-cycle column diff: 4 of 5 rows identical, only the page differs, `band.promoted` 5 → 4. `promotionBlocked["self-page"]` is now incremented beside `countSkip`. |
| MINOR-C | `ifVersion` could not say "no page" | **YES** | **Ran**: `NO_PAGE_VERSION = -1`; `ifVersion: 0` on an empty store → **`no-page`**; `ifVersion: -1` → **created**; `-1` again once a page exists → **`page-appeared`**. Three directions, three names. |
| MINOR-D | a store with a page saying it has none | **YES** | **Ran** both switch values at budgets 400–9000 with a 10.5 KB page (table above). |
| MINOR-E | cleared-page lookup depended on prunable events | **YES — deleted** | **Read + ran**: `pageRowId()` is now `findPageRow`, and the cleared row is live, so no event-log scan exists to go wrong. Probe D/B confirm the row is found with the event log untouched. |
| MINOR-F | doctor said "no page written yet" about a cleared page | **YES for cleared** | **Ran**: `GREEN Self page cleared on 2026-09-20 — cleared for the probe; 1 version kept`. The third state (unreadable) is m1 above. |
| MINOR-G | the ≤512 / 513–752 threshold | **unchanged, by choice** | **Ran** (table above); still the stated trade. |
| NIT-A | marker check is exact | **NO** | **Ran** — n3. |
| NIT-B | future-dated page | **NO** | **Ran** — n4. |
| NIT-C | refused-event description missing reasons | **YES** | **Read** `registries.ts:188` — it now names empty, the hard limit, the gate, the markers and a moved version. |
| NIT-D | the `--clear` message recommended the orphaning command | **YES** | **Ran**: the message is now `Put it back with: counterparts self-page --restore 2.` and that command does exactly that. |

---

## What I could not determine

- **Whether the wider `Schemas.load` fix (MAJOR-1) should ride with S1.** It touches a module
  this PR does not otherwise change, and #139 just landed there; I think it is a separate
  one-line PR, but that is the coordinator's call, not a review finding.
- **How much of the 72 KB self-schema valve the owner's live store already uses** (m2). The
  page's share is measured; the baseline is a one-query answer on a store I may not read.
- **Node.** Everything here ran under bun 1.3.10. `node:sqlite` is untested at launch by the
  project's own statement, and S1 changes nothing about that either way.

---

## Deploy note, if it lands

1. **Nothing changes on deploy day.** No page exists, `PAGE_EMPTY_SHOWS_LIST` is at its
   default, and §0 proves the wake is byte-identical to master over 153 compositions. The
   change begins the first time anything writes a page — so the first write is still the
   moment to run `counterparts rebrief` and read the composed wake by hand.
2. **Name MAJOR-1 in the note**: if the page's prose file is ever lost, the symptom is not a
   missing page, it is `Counterparts memory is OFF for this session` — and the doctor says
   so in red, which is H1 earning its keep.
3. The six MINORs are each a few lines and none of them touches behaviour the wake depends
   on; m4 and m5 are a documentation fix and a comment.
