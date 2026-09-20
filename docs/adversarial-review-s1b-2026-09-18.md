# Adversarial review, second pass — PR #138, `self/s1-page`

Head `a69b856` (first pass reviewed `7682a30`). Base still the old master `039cd5d`, as
intended; every identity proof below compares against that. Diff reviewed:
`git diff 7682a30..a69b856` — 25 files, +1,644 / −132.

Read-only on the branch: nothing pushed, no comment on the PR, nothing deployed. All
probes hermetic in fresh temp stores under `$TMPDIR`; page bodies are neutral placeholder
prose.

**Suite on the new head:** `bun test` → **2296 pass / 0 fail** (29,350 expects, 40 files),
exit 0. `bun run typecheck` (`tsc --noEmit`) → **clean**. Both match the builder's claim.

---

## Verdict

**Not safe to merge as is — safe after the two MAJORs below are fixed or ruled on.**

Both first-pass BLOCKERS are closed, and closed properly: I re-ran my own probes at the
real caps rather than taking the fixes on inspection. Of the four first-pass MAJORs, three
are closed and M3 is mostly closed. What is new is in the code this round added: the
clear/restore machinery has a hole that destroys access to the very history it was built
to protect, and the promotion guard changes retention physics for three row classes it did
not need to touch.

| rank | count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 2 |
| MINOR | 5 |
| NIT | 4 |

---

## 0. The byte-identity proof — RE-RUN, still holds

The builder said this held "by inspection" and did not re-run it. I re-ran it in full
against `a69b856`.

Method as before: `origin/master` (`039cd5d`) extracted with `git archive` into a separate
directory; two fixture stores built fresh, each copied byte-for-byte; composed from both
checkouts over the identical copies; every bundle's full text diffed.

- Fixture A: 20 identity-band memories + 6 skill + 6 fact rows.
- Fixture B: an identity **core** minted, no identity elements — the day-0-line path.
- Each at budgets **{400, 900, 1500, 3000, 6000, 9000, 20000}** × days
  **{0, 1, 13, 14, 15, 30, 365}** = 49 compositions, plus two `omit` compositions with
  `PAGE_ON_EGRESS` at its default.

**Result: `diff` reports no difference on either fixture. 100 compositions, byte-identical
to master.** Coverage inside that: the day-0 line rendered 49 times, the trim path 21
times, the over-budget path 7 times. With no page written and the default switch, the
owner's wake does not change by a byte.

The `omit` compositions with no page are also byte-identical — with no page there is
nothing for `PAGE_ON_EGRESS` to add, so the healthy path is unchanged whichever way the
switch is set.

---

## 1. First-pass findings: what is closed

| # | finding | status |
|---|---|---|
| **B1** | the cut throwing away the window | **CLOSED** — §1.1 |
| **B2** | page cap clamped to the whole budget | **CLOSED** — §1.2 |
| **M1** | page on the egress composition | **CLOSED as a decision** — §1.3 |
| **M2** | `remove <page id>` bricks the store | **CLOSED** — §1.4 |
| **M3** | version mislabelling / no restore / no session | **mostly closed** — §1.5, and see MAJOR-A |
| **M4** | concurrent writes silently revert | **CLOSED** — §1.6, and see MINOR-C |
| m1 | redaction not signalled | CLOSED: `PageRevision.redacted`, a console `NOTE:` line, `redacted`/`redactedBy` on the event row, and `redacted`/`bytesBeforeRedaction` in the tool result |
| m2 | page promotable into the identity band | CLOSED for the page — but see MAJOR-B for the cost |
| m3 | forged wake markers | CLOSED for the real markers; NIT-A on near-misses |
| m4 | MCP empty body left no durable row | CLOSED: only a non-string short-circuits; `" "` goes through the seam |
| m5 | `renderPage` exceeding its own cap | CLOSED: `capBytes < reserve` returns `""` |
| m6 | unreadable date read as fresh and printed nothing | CLOSED: `pageStale` reads stale, `pageDateline` says "the page carries no readable date", doctor agrees |
| m7 | future-dated page reads fresh | **not fixed** — NIT-B |
| m8 | `--versions` in chars | CLOSED: bytes |
| m9 | counting versions read every body | CLOSED: `pageVersionCount()` |
| n1 | `--from` in the flag help | CLOSED |
| n2 | `preamble` leaking into the dashboard JSON | CLOSED (verified: `"preamble" in page === false`) |
| n3 | backticked literal | CLOSED |
| n4 | unused `_day` | CLOSED |
| n5 | EACCES exiting `usage` | CLOSED: ENOENT → `usage`, anything else → `failed` |
| n6 | doctor green on absence | unchanged by choice; see MINOR-E for a new wrinkle |

### 1.1 B1 — the cut. Closed, and it holds on multibyte.

`cutAtBoundary` now takes a boundary only if it keeps more than `BOUNDARY_KEEP_SHARE`
(0.25) of the decoded prefix. Re-measured at the real `PAGE_WAKE_BYTES = 6144`:

| page shape | whole | rendered | share of cap | over cap | U+FFFD |
|---|---|---|---|---|---|
| `## Core` + 200-item bullet list | 9,698 | 6,129 | **98 %** (was 0 %) | no | no |
| `## Core` + one long paragraph | 9,009 | 6,144 | **98 %** (was 0 %) | no | no |
| no newline anywhere | 9,000 | 6,144 | 98 % | no | no |
| `## Core` + 150 short paragraphs | 9,347 | 6,117 | 98 % | no | no |
| medium paragraph then one very long one | 11,451 | 2,755 | 43 % | no | no |
| multibyte (Japanese), no blank lines | 19,209 | 6,143 | 98 % | no | no |
| multibyte, paragraphed | 6,947 | 6,113 | 98 % | no | no |
| emoji (surrogate pairs) run | 16,009 | 6,140 | 98 % | no | no |

The 43 % row is the intended behaviour, not a regression: it takes the clean 2.6 KB
paragraph break rather than falling to a mid-sentence byte cut, which is exactly the case
that made me warn against a `room / 2` floor. The builder chose 0.25 for that reason and
the choice is right.

**The char-vs-byte arithmetic the coordinator flagged is sound.** `floor` is
`clean.length * 0.25` in UTF-16 code units and `paragraph`/`line` are UTF-16 indices from
`lastIndexOf`, so the comparison is unit-consistent; `clean` is the decode of the first
`room` **bytes**, so every prefix of it is ≤ `room` bytes by construction. I swept it
rather than argued it: **1,742 renders** of a Japanese body and an emoji body at every cap
from 100 to 6,200 in steps of 7 —

```
multibyte cap sweep 100..6200: worst overshoot = 0 bytes, any U+FFFD = false
emoji     cap sweep 100..6200: worst overshoot = 0 bytes, lone surrogate = false
```

No overshoot, no replacement characters, no split surrogate pair. The cut indices are
always at a `\n`, which is BMP, so a slice cannot land inside a pair; the byte fallback
returns a whole decoded string.

### 1.2 B2 — the budget. Closed, proved against master.

`pageBlock` now caps at `budgetBytes - PAGE_FLOOR_RESERVE_BYTES` (512, against a measured
widest furniture of 444). With an 8,657–9,387-byte page:

| host budget | composed | over budget |
|---|---|---|
| 400 | 300 | no |
| 900 | 664 | no |
| 2,000 | 1,812 | no |
| 6,000 | 5,772 | no |
| 9,000 | 6,420 | no |
| 20,000 | 6,420 | no |

Fine ladder, every integer budget from 100 to 1,200 and every 13th to 20,000, with that
page present: the only budgets that publish `overBudget` are **100–299**. I then ran the
same ladder on **master with an empty store**: over budget at **100–299**, floor 300 bytes.
Identical set. **The page never causes an over-budget wake** — the residual is master's own
bare floor exceeding an absurd ceiling, which is pre-existing and unrelated.

### 1.3 M1 — egress. Closed as a decision, with both values proved.

`PAGE_ON_EGRESS`, default `true`. Measured on a store with a page and four identity
elements, composing with `omit: s => s.physics.protected`:

- **true** — page in the egress bundle, `elements: 0` (the identity rows are filtered, as
  before).
- **false** — page absent, `elements: 4`, and the bundle's "Who I am" carries the identity
  list the predicate left standing. This is the required fallback and it works.
- The **owner's** wake (no `omit`) is byte-identical under both switch values.

The false comment at `counterpart.ts:2691` is corrected and now states plainly that the
page is the one protected thing that goes out, with the owner's ruling cited. That was the
substance of the finding.

### 1.4 M2 — removal. Closed at the door, and the underlying crash is #139's.

`planRemoval` now refuses `is-the-self-page`, and `removeCommand` prints a sentence
pointing at `self-page --clear`. I looked for ways around it:

| attempt | result |
|---|---|
| the live page's raw id | refused `is-the-self-page` |
| the **cleared** (archived) page's id | refused `is-the-self-page` |
| by title `"Who I am"` | `unknown-id` |
| by slug `"who-i-am"` | `unknown-id` |
| the id upper-cased | `unknown-id` |
| the id with surrounding spaces | `unknown-id` |
| via the dashboard | no removal door exists; the dashboard is read-only and `sourceOf` refuses a non-observer |

No bypass. Removal takes raw ids only, so there is no handle/alias surface to slip through.

I also confirmed PR **#139** (`fix/schemas-skip-removed-rows`, open) is the `Schemas.load`
skip — `prose_path === ""` plus the deny-list, shared by `load` and `entity`. That closes
the underlying crash for the identity core and every other schema row, which S1's guard
does not. Merge order as the coordinator has it (#139 before S1) is right.

### 1.5 M3 — version attribution. The off-by-one is genuinely gone.

Each version now carries the reason and author of the write that **produced** it, read off
the `self.page.revised` row whose `version` is `seq - 1`. I traced a
create → revise → revise → restore sequence with three different authors:

| seq | body | who wrote it and why | replaced by |
|---|---|---|---|
| 3 | v2 | `writer: second amendment` | `restored version 1` |
| 2 | v1 | `session: first amendment` | `second amendment` |
| 1 | v0 | `owner: created it` | `first amendment` |

Correct at every row, across all four write kinds, with no off-by-one. `session` ids are on
the event rows (`sess-A`, `sess-B`, `null` for the writer). The console prints the producing
write and names `← replaced by:` separately, in bytes. `--version <seq>` now puts its header
on **stderr**, so `self-page --version 1 > file` writes the page and nothing else — verified.

**When the event row is missing the answer is a blank, not a wrong one**: `reason` and `by`
come back `null` and the console prints `(unrecorded)`. That is the right failure direction.

### 1.6 M4 — `ifVersion`. Works, with one gap (MINOR-C).

Raced with two live handles: A reads at version 0, B writes (page → version 1), A writes
with `ifVersion: 0` →

```
{"written":false,"reason":"version-moved","bytes":74,
 "current":{"version":1,"body":"…b-wins…"}}
```

Page unchanged, a durable `self.page.refused` row with `expected: 0, at: 1, session: "sess-A"`,
and `currentVersion` / `currentBody` handed to the MCP caller so it can merge. A write with
the matching version then lands. The console equivalent (`--if-version`) refuses with a
readable sentence and exit `refused`; `--if-version` without `--write` and `--if-version=abc`
both refuse as usage errors.

`currentBody` is **not** returned under observer — the observer stand-down happens before any
of this and returns `stoodDown`. For a cleared page `current` is `null`. Both correct.

---

## MAJORS

### MAJOR-A — `--restore` after `--clear` orphans the entire version history, in one command the console itself recommends.

**Files:** `src/core/self/index.ts#restorePage` → `#revisePage` (`const existing = findSelfPage(this.store)`),
`#pageRowId`, and the `--clear` message in `src/adapters/cli/self-page.ts#writeLines`.

`clearPage` archives the row. `revisePage` looks for an existing page with `findSelfPage`,
which lists **live rows only**, so any write after a clear — including a restore — **mints a
fresh row**. `pageRowId` then returns the new live row, and the new row has no versions.
The cleared row's versions are still on disk but no surface can reach them.

**PROVED end to end through the real console:**

```
$ counterparts self-page --clear
Cleared the page — the 68 bytes that were there are kept as version 4.
The wake goes back to what it showed before a page existed. Put it back with:
counterparts self-page --restore 4 — …

$ counterparts self-page --versions
4 earlier versions, newest first.
     4  lived day 0   68 bytes   owner: restored version 1  ← replaced by: owner cleared the page
     3  lived day 0   68 bytes   owner: owner edit          ← replaced by: restored version 1
     2  lived day 0   68 bytes   owner: second              ← replaced by: owner edit
     1  lived day 0   68 bytes   owner: first               ← replaced by: second

$ counterparts self-page --restore 4
Wrote the page — 68 bytes, version 0.

$ counterparts self-page --versions
No earlier versions: the page has been written once, or not at all.
```

Four versions with full attribution, gone from every surface — the console, the dashboard,
`pageVersionCount()` — after running the one command the clear message told the owner to
run. A second `--restore` then answers `no-such-version`.

At the seam the same thing: `restorePage(2)` after a clear returns `reason: "created", version: 0`
and `selfPageVersions()` drops from `[2, 1]` to `[]`.

**Nothing is destroyed.** The archived row's prose still reads and `store.versions(oldId)`
still returns 2. But there is no door: recovery is sqlite and filesystem archaeology.

This is the undo mechanism built to answer M3, and it closes behind the owner as he walks
through it. The builder names a narrower version of this as a known limit ("an older
cleared page's versions become unreachable once a new page is written") — but a **restore
is itself a new page write**, so the limit is not a corner case, it is the main path, and
the clear message advertises it.

**Smallest fixes, in order of size:**

1. *Best, needs one new store verb.* Add `Store.unarchive(id)` — the exact inverse of
   `archive`, re-indexing the doc — and have `revisePage` revive the most recently cleared
   page row instead of minting a fresh one. One row, one continuous version chain, forever;
   `--clear` / `--write` / `--restore` all then behave as the messages promise. Cost: it
   breaks the PR's "nothing under `src/core/store/` changed" property.
2. *Contained to `self/`.* On the mint-after-clear path, write
   `meta.previousPage = <cleared row id>` on the new row, and have `pageVersions()` walk
   that chain, prefixing each entry with which row it came from. Nothing new in `store/`,
   but seq numbers are per-row so the display key has to become compound and `--restore`
   has to take it.
3. *Minimum honest change if neither is wanted.* Make `--restore` refuse while the page is
   cleared, telling the owner to write the body back by hand first, and change the `--clear`
   message so it stops recommending the action that orphans the history. That keeps the
   data reachable at the cost of the feature.

### MAJOR-B — the promotion guard changes retention physics store-wide: beliefs, current-states and entities that would have become decay-exempt now keep fading. The comment saying otherwise is wrong.

**File:** `src/core/sleep/consolidate.ts` — `if (isSchemaRow(row)) { countSkip(out, "promotion:schema"); continue; }`.

The guard's own comment is honest about scope ("A SCHEMA ROW DOES NOT CROSS"), so the
finding is not that the scope is hidden. The finding is the sentence after it: *"only the
CROSSING is withheld — a belief goes on being consolidated exactly as it always has, so no
strength trajectory on a live store changes."* **That is false.**
`src/core/physics/index.ts:443` —

```ts
export function decay(m: MemoryPhysics, d: number, shape = TUNABLES.DECAY_SHAPE): number {
  if (m.promotedIdentity) return 1;
  return decayCurve(d - m.lastUsedDay, stability(m), shape);
}
```

A promoted row is **decay-exempt**. On master a belief that crossed stopped fading forever;
on the branch it keeps riding the Ebbinghaus curve. Withholding the crossing *is* a strength
change, for every schema row class, across the whole store — and the consolidation marking
being untouched (which is true) does not soften it. The supporting point is that this lands
inside a PR about the self page, where one row class needed guarding and four got it.

**PROVED by a direct master-vs-branch physics diff.** One fixture store containing five
promotion-ready rows — a plain memory, a belief, a current-state, an entity, and a
hand-minted page row — copied byte-for-byte, 40 cycles run from each checkout, every row's
columns dumped and diffed:

| row | master after 40 cycles | branch after 40 cycles |
|---|---|---|
| plain memory | `band identity`, `promoted_identity 1` | **identical** |
| belief (`role: belief`) | `band identity`, `promoted_identity 1` | `band semantic`, `promoted_identity 0` |
| current-state | `band identity`, `promoted_identity 1` | `band semantic`, `promoted_identity 0` |
| entity (`role: entity`) | `band identity`, `promoted_identity 1` | `band semantic`, `promoted_identity 0` |
| the page | `band identity`, `promoted_identity 1` | `band semantic`, `promoted_identity 0` |
| `band.promoted` events | **5** | **1** |

`consolidated` is `1` on both for every row, so the marking really is untouched — that half
of the claim holds. `band` moving from `identity` to `semantic` is the decay exemption
turning off: it is derived from `promotedIdentity` at `physics/index.ts:466`.

It also changes what `enumerate()` reports: it selects `store.list({ band: "identity", archived: false })`
with **no type filter**, so beliefs and entities that crossed appeared in `counterparts status`'s
identity list, in the dashboard, and in `schemaBytes`'s identity-band weighing. After this
they will not.

Master's behaviour may well be the bug — a belief crossing into the identity band is odd —
but that is a ruling about the identity band, not a side effect S1 gets to take. The page
needed one row class guarded and the guard covers four.

**Smallest fix:** make the guard column-only and page-shaped —
`if (row.type === "schema" && row.kind === "self") { countSkip(out, "promotion:schema"); continue; }`
— which covers the page and the identity core (the two rows the review actually found) and
leaves beliefs about people, current-states and entities exactly as they are. If the owner
wants the wider rule, it should land as its own change with its own measurement against the
live store: "how many rows on the real store are currently identity-band by promotion and
are not `type: memory`" is a one-query answer and nobody has it.

Also, smaller, in the same hunk: every other promotion refusal increments **both**
`promotionBlocked[reason]` and `countSkip`; this one only does `countSkip`, so
`promotionBlocked` will never carry `schema` and the promotion diagnostics will not be able
to account for the difference.

---

## MINORS

### MINOR-C — `ifVersion` cannot express "there is no page yet", and the refusal it gives is untrue.

**File:** `src/core/self/index.ts#revisePage` (`const at = before?.version ?? null; if (at !== opts.ifVersion) …`),
`src/adapters/mcp/tools.ts` (`ifVersion: { type: "integer", minimum: 0 }`).

With no page, `at` is `null`, so **any** integer mismatches. PROVED:

```
read before any page            → null            (the MCP read returns present:false, with no `version`)
write with ifVersion: 0         → refused "version-moved", at: -1, current: null
write with no ifVersion         → written, version 0
after a --clear, ifVersion: 0   → refused "version-moved"
```

The refusal detail the model is handed says *"Somebody else wrote the page after the version
you read"* — which is false; nobody wrote anything. `currentVersion`/`currentBody` are absent,
so there is nothing to merge against, and the schema's `minimum: 0` leaves no sentinel for
"none". The tool's negative example tells the model to always pass the version back, so a
model that reads `present: false` and passes the natural `0` gets a dead end on the very
first write.

Omitting the flag works, and the flag is opt-in, which is why this is MINOR. **Fix:** when
`before === null`, refuse with a distinct reason (`no-page`) and a detail that says so — or
accept `ifVersion: 0` as meaning "expects no page" and document it.

### MINOR-D — with the empty-page switch off and a tiny host budget, a store that HAS a page says it has none.

**File:** `src/core/self/index.ts#pageBlock` returns `null` when `budgetBytes - 512 <= 0`;
`briefing.ts#render` then reads `req.page` as absent and, with `PAGE_EMPTY_SHOWS_LIST: false`,
prints `PAGE_FORMING_LINE`.

PROVED, budget 400, a 10 KB page present, switch off:

```
Who I am:
Still forming — no page has been written here yet. It is written at a boundary, from what recurs, and can be amended by hand.
```

That is the class of error PR #71's rule forbids — a store that has the thing saying it does
not — transposed from identity to the page. Under the **default** switch the same budget
falls back to the identity list, which is correct and was the coordinator's question: **no,
a small-budget host does not end up with no identity**; it silently gets the list instead.

Reachable only on the non-default switch value at budgets ≤ 512, which is why it is MINOR
rather than MAJOR — but the switch is the one the owner may flip. **Fix:** have `pageBlock`
distinguish "no page" from "no room" and pass that down, so `render` suppresses the forming
line when a page exists.

### MINOR-E — the cleared-page lookup depends on event rows that sleep prunes, and the fallback picks the wrong page.

**File:** `src/core/self/index.ts#pageRowId`.

With no live page it finds the most recently cleared row by scanning `self.page.revised` for
`cleared: true`, "and falls through to the scan, which is still better than nothing". It is
not better than nothing — it is confidently wrong. PROVED: a store with two cleared pages
(`FIRST` then `SECOND`), then the `self.page.revised` rows deleted the way a prune would —

```
with events intact : --versions reads SECOND   (correct)
events deleted     : --versions reads FIRST    (wrong page)
                     reasons and authors all null
```

The scan is `store.list({type:"schema", kind:"self"})`, which is `ORDER BY id` over hashed
ids, so which page it picks is arbitrary. `--restore <seq>` against that listing would then
write **the wrong page's body** as the live page.

This is dated, not hypothetical: sleep's `log` phase calls `Store.pruneEvents` every cycle
(90 lived days, rows without a `dedupKey` — which these are). The narrow precondition is two
or more cleared pages with no live page for 90 lived days. The **certain** half — old
versions losing their reason and author to `(unrecorded)` — is benign and anticipated.

**Fix, one line each side:** in `clearPage`, `store.setMeta("self.page.cleared", page.id)`;
in `pageRowId`, read that first. `meta` is not pruned, and `setMeta` is already how
`consolidate` persists promotion records.

### MINOR-F — the doctor says "no page written yet" for a page that was written and cleared.

`selfPageFindings` on a cleared store returns green with
`detail: "no page written yet — the wake says it is still forming"` and `data: {present: false}`.
The wake half is true; "no page written yet" is not. The console gets this right (its
no-page text explains that a cleared page's versions are still listed). **Fix:** one branch
on whether `pageVersionCount() > 0`, and a detail that says "cleared" with the version to
restore.

### MINOR-G — the wake tells the reader the page did not fit at budgets 513–752 and says nothing at all at ≤ 512.

Measured: budget 513–752 prints
`(My page is 9387 bytes — no room for it in this wake. Read it with 'counterparts self-page'.)`;
budget ≤ 512 prints nothing about the page and falls back to the identity list. The
threshold is invisible and the two behaviours are opposite. This is a deliberate trade
(§`pageBlock`: "a ceiling with no room for the wake's OWN furniture has none for a line
about the page either") and the reasoning is defensible; recorded because the silent arm is
the one a misconfigured host will land on.

---

## NITS

- **NIT-A** — the `forged-markers` check is an exact, case-sensitive substring. It refuses
  both real markers and has **no false positives** — an ordinary `<!-- a private note -->`,
  prose mentioning `counterparts:wake`, and a sentence about the marker all write fine
  (verified, 8 cases). It does not catch `<!-- COUNTERPARTS:WAKE/END …>`, `<!--  counterparts:wake…`
  or `<!--counterparts:wake…`. None of those fool `readSentinel`, `applyPreface` or
  `transcript.ts#sight`, which all anchor on the exact byte string — so the check is exactly
  as strict as the parsers it protects. The residual is the model's reading, which is the
  stated reason for the check. A `\s*` in the needle would close it.
- **NIT-B** — a future-dated page (clock skew) still reads as fresh and prints the future
  date: `daysBetween` goes negative and `> PAGE_STALE_DAYS` is false. Carried from the first
  pass; unfixed, still harmless.
- **NIT-C** — `DURABLE_EVENTS["self.page.refused"]` still describes the refusal as "empty,
  past the hard limit, or stopped by the gate battery". There are now three more:
  `version-moved`, `forged-markers`, `no-such-version`.
- **NIT-D** — the `--clear` message ends *"Put it back with: counterparts self-page --restore 4"*.
  Until MAJOR-A is fixed, that sentence recommends the command that orphans the history it
  just promised to keep.

---

## Checked and clean this round

- **Sleep over an ARCHIVED protected page row.** 120 cycles after a clear: the row is
  **byte-for-byte unchanged**, prose still readable, versions intact, and `Counterpart.open`
  works over it. Prune, dedup, decay and consolidate all skip archived rows before anything
  else.
- **`enumerate().protected` does not list a cleared page** — it selects `archived: false`.
  So archived page rows do not accumulate in `status` or the dashboard's protected card.
- **Two live page rows are not reachable.** clear → restore → clear → restore leaves three
  page-role rows, exactly one of them live at every step. `revisePage` mints only when
  `findSelfPage` is null, and only `clearPage` archives.
- **Recall exclusion is complete, including the path the builder left unmeasured.** I
  measured `recall/reference.ts`: `resolveReferences`'s expansion door gates on
  `MEMORY_ID = /^mem_[0-9a-f]{12,16}$/`, and the page's id is `sch_…`. Passing the page's id
  to `creditReferences` returns `unresolvedHandles: 1`, credits nothing, and leaves
  `uses`/`lastUsedDay`/`reinforcedDays` at zero — verified. The quote door only considers
  rows in `state.surfaced`, which activation now excludes. So the page cannot be credited or
  gain association edges through that path either. Combined with MAJOR-B's guard, nothing
  can move the page's physics.
- **The console, end to end.** `--versions` with producing-write attribution and bytes;
  `--version <seq>` header on stderr and body on stdout; `--if-version` stale / current /
  alone / junk; five-modes-at-once refused; `--restore 0` / `99` / valid; `--clear` on a
  cleared store; observer `--clear` refused at the seam. Exit codes `ok 0 / usage 1 /
  refused 2` used consistently.
- **The dashboard.** `pageVersions` is no longer guarded on a live page, so a cleared page's
  history shows — and it does (1 version on a cleared store, page `null`,
  `pageAbsent: "(none yet)"`). `preamble` no longer leaks.
- **`store.revise` merges meta** (`store/index.ts:794`), so `clearPage`'s
  `meta: { reason }` patch does not wipe `role`, `by` or the dates — verified by the row
  still being found as a page afterwards.

---

## Merge-order notes (#135, #139, #136 land first, then master merges in)

1. **#139 (`fix/schemas-skip-removed-rows`) is the right dependency and it really is the
   fix** — I read the diff: `load` and `entity` share a `removed()` predicate on
   `prose_path === ""` plus the deny-list. Once it lands, the first pass's M2 crash is gone
   for every schema row, not just the page. S1's own `is-the-self-page` refusal is then
   belt-and-braces, which is fine.
2. **#135 (`F3: consumers off the file layout`)** moves `Schemas.load` and friends onto
   `readProseWalking` and adds a test that no file outside an allow-list imports
   `walk-seam.js`. **S1 adds five new prose-read sites** —
   `self/page.ts#findSelfPage`, `#isSelfPageRow`, `#readSelfPage`,
   `self/index.ts#pageRowId`'s fallback scan, and `recall/activate.ts#isPageRow` — all of
   which use the public `store.readProse`, not the seam, so the lint will not fire. But all
   five are exactly the shape #135 is converting, so the builder should expect a review ask
   to move them, and each is inside a `try/catch` that must survive the move.
3. **`src/adapters/cli/removal.ts` will conflict.** S1 adds `is-the-self-page` to
   `RemovalPlan["reason"]` and a guard in `planRemoval`; #135 rewrites three `prose_path === ""`
   display expressions in the same file. Mechanical, but `tsc` must be re-run — the reason
   union is exhaustive at the print site.
4. **`removal.ts` now imports from `core/self/page.js`.** That is a new adapter→core edge
   into a module `cli/` did not previously depend on. Worth a look at the merge in case
   #135 or #139 has opinions about `removal.ts`'s imports.
5. **#136 (snapshots)** collides as before in `dashboard/registries.ts`, `web/flow.ts`,
   `web/narrate.ts`, `core/counterpart.ts`, `fired.ts`, `doctor.ts`. S1 added **no new event
   names** this round, so the conflict surface is unchanged from the first pass.
6. **`consolidate.ts` is new conflict surface this round.** If #136's snapshots capture
   phase skip maps or promotion counters, `promotion:schema` is a new key they will see —
   and if MAJOR-B is fixed the key's meaning changes again. Land the MAJOR-B decision before
   the snapshot work reads it.
7. **`test/mcp.test.ts`** and the eight registries in `cli/commands.ts` conflict with any
   other PR adding a tool or a command, as before. `self-page` now carries nine flags.

---

## Design opinions (not defects, not ranked)

- **`clearPage` archiving rather than blanking** is the right call and the reasoning in the
  docstring is good. MAJOR-A is not an argument against archiving; it is an argument that
  the *next write* should revive the archived row rather than start a new one.
- **`clearPage` being owner-only, unreachable from MCP** is right, and the sentence giving
  the reason ("a session that could unwrite the page could erase the self between two
  turns") is the kind of line that should survive into the CONTRACT.
- **`ifVersion` as a courtesy rather than a lock** is the correct shape for the owner's "no
  safeguards up front" ruling. MINOR-C is about the empty case, not the design.
- **`PAGE_ON_EGRESS` as a switch rather than an inference** is the right resolution of my
  first-pass M1: it makes the owner's decision explicit and reversible instead of reading it
  off a flag that means something else. I still think `false` is the better default, but the
  ruling is his and it is now written down where it can be found.
- **The prose in this diff is again unusually good** — the refusal sentences, the tool
  description's `ifVersion` paragraph, and the `--clear` output all say the true thing in the
  reader's terms. NIT-D is the one place a sentence outruns the mechanism.

---

## What to do

1. Fix **MAJOR-A**. Option 1 (a `Store.unarchive` and revive-on-write) is the one that makes
   all the messages true; option 3 is the honest minimum if the store must not change.
2. Rule on **MAJOR-B**. My recommendation: narrow the guard to
   `row.type === "schema" && row.kind === "self"` now, and take the wider rule — beliefs and
   entities no longer crossing, and no longer being decay-exempt — as its own change with a
   count from the live store behind it.
3. MINOR-C, E and F are each a few lines and each removes a wrong answer; MINOR-D matters
   only if the owner ever flips `PAGE_EMPTY_SHOWS_LIST`.
4. Land after #139. Re-run the byte-identity sweep once more after master is merged in — it
   is cheap, it is the deploy claim, and this round it was nearly shipped on inspection.
