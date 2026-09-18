# Adversarial review — PR #135, "F3: consumers off the file layout"

Branch `floor/f3-consumers-off-files` @ `cbb72c4`, base `master` @ `039cd5d`.
Reviewed 2026-09-18 in a scratch worktree. Nothing was pushed, commented, merged or
deployed; the live store and `~/.counterparts` were never opened.

**Verdict up front: safe to merge as is.** The "no behaviour change" claim holds — I
tried to break it at every changed call site and could not. Two one-line hardening fixes
are cheap enough to take now if the builder is touching the branch anyway (MINOR 1,
MINOR 2), but neither gates the merge. There is one thing the owner must hear before the
next `counterparts remove`: a pre-existing bug that this PR correctly did not introduce
and correctly did not fix, but which will silently switch his memory off if he ever
removes a person or a belief.

Suite on the branch: **2226 pass / 0 fail**, 28479 assertions, 38 files, 52.7 s.
`tsc --noEmit`: **clean**. Both match the builder's claim exactly.

---

## What I verified about the "no behaviour change" claim

| claim | verdict |
| --- | --- |
| `Schemas.load`, `Schemas.element`, `mergedBeliefs` pass the row master already looked up | true by inspection — the expression is `readProseFile(absolutePath(row.prose_path), id)` either way |
| `entityNameOf` / `previewOf`'s dropped `store.row(id)` check is redundant | **PROVED** (probe 7) — same answer for live, dark-denied, chased, and unknown ids |
| `store.read(id)` in `activate.ts` == the old `store.readProse(id)` | true by definition: `readProse(id) { return this.read(id).doc; }` on both master (`index.ts:1716`) and the branch (`index.ts:1737`). Same events, same refusals, same errors. Zero behavioural delta. |
| `confidentialByMeta` == master's `isConfidential` | **PROVED** (probe 3) — 625 input pairs over 25 values in each of the two keys, including `"OPEN"`, `" open"`, `"open "`, NBSP-prefixed, `1`, `"true"`, `null`, `[]`, `{}`, `NaN`. No input separates them. There is no 19th row. |
| `readProseQuiet`'s `row?` is guarded by `expectId` | **PROVED** (probe 1a) — a row for another id throws `PROSE_PAYLOAD_MISMATCH`, not the wrong body |
| observer stance unchanged | **PROVED** (probe 5) — `Schemas.open` on an observer store emits no `store.observer.standdown` and no `store.archived.read` |
| the F5 leftover list is exactly what remains | true — the PR's grep reproduces verbatim: `cli/removal.ts` 673/765/775/833/839, `cli/export.ts:67`, `cli/commands.ts` 1999/2200–2241, `tools/parallel/readers.ts` 1283/1432. Nothing else. |
| no performance regression at any call site | true — the three walking sites pass the row; `entityNameOf`/`previewOf` are in the `mergedBeliefs` loop but did their own `store.row` on master too, so the lookup count per id is unchanged (1). Nothing regressed; the +3% measurement is about the walks. |

---

## Findings

### BLOCKER — none.

---

### MAJOR 1 — `Store.readProseQuiet` is a public deny-list bypass, and the store's contract now contradicts itself

**File:** `src/core/store/index.ts:1769–1772`, `src/core/store/CONTRACT.md:170–179`.

**Not a behaviour regression.** I traced all five callers. Every one of them read the file
behind the store's back on master, with both exemptions. The claim "same exemptions as
before, now in one named place" is true call site by call site. Nothing that renders to
the model, the wake, recall, the MCP tools, the dashboard or the CLI can show denied
content today that it could not show on `039cd5d`.

**It is a widening of the API, and it sits badly with the module's own words.**
`src/core/store/CONTRACT.md:92` — in §4, describing the kernel that survived the released
removal ceremony, not a numbered §5 guarantee — says owner-initiated removal is "loud,
recorded, **unreachable from any model path**." This PR amends §5 G13 to say a `Store`
method "fires no event and **asks the deny-list nothing**." The two sentences are now in
the same document and pull against each other. Before, the bypass was three hand-rolled file
reads in consumer modules — ugly, but nothing in `store/`'s own surface advertised it. Now
`readProseQuiet` sits on `Store.prototype` next to `read`, `readProse` and `physicsOf`,
and `Counterpart.store` is public, so every adapter and every future contributor (human or
model) reaching for "read the prose without the telemetry noise" gets a removal bypass
they did not ask for and will not notice.

**Proved** (probe 1b): on a `dark`-staged id, `store.read(id)` throws `REMOVED` and
`store.readProseQuiet(id).body` returns the owner's removed text. On master the method
does not exist.

**Mitigating fact worth knowing, and it is luck, not design:** `Schemas.element` still
refuses a denied id — but only because `physicsOf(id)` (which goes through `requireRow`
→ `refuseIfDenied`) is evaluated *after* `statement: readProseQuiet(...)` in the same
object literal (`schemas/index.ts:1124` then `:1129`). The removed prose is read off disk
into memory and then discarded by the throw. Reorder that literal and the gate is gone.

**Smallest fix, with precedent in this codebase:** move `readProseQuiet` off `Store` and
into `owner-op-seam.ts`-style seam — `chaseRemoved` is deliberately *not* a Store method
for exactly this reason (`store/index.ts:670`, and `test/cli.test.ts:2739` lints
value-imports of that seam). Export `readProseWalking(store, id, row?)` from a seam module
the four consumer files import by name. Same behaviour, same one hole, but you cannot
reach it by having a `Store`. Failing that, rename it so the name carries the second
exemption: `readProseQuiet` advertises "no event" and says nothing about the deny-list.
`readProseUngated` would.

**Rank rationale:** MAJOR, not BLOCKER, because no live path is worse off today and the
exemption is documented. It is the kind of thing that becomes a BLOCKER six weeks later.

---

### MAJOR 2 — pre-existing, proved end to end: removing a schema element silently switches memory off

**Not introduced by this PR.** The expression in `Schemas.load` is character-for-character
what master ran, and I reproduced the failure on `origin/master` as well as on the branch.
The builder called it out honestly in the PR body. I am ranking it MAJOR anyway because
this commit is going onto a live store with real content about real people, and the owner
should know the shape of the landmine before he next types `counterparts remove`.

**Proved end to end (probe 8), through the real removal command, not the raw seam:**

```
REMOVAL stages = ["requested","dark","chased","complete"]
row after = ""
REOPEN = THREW PROSE_FILE_MISSING {"path":""}
```

**Mechanism.** `MEMORY_BEARING` (`cli/removal.ts:181`) permits `schema` targets, so an
entity or a belief is a legal removal. `ownerRemoval` runs dark → chase in one command.
The chase keeps the row and blanks `prose_path` (`store/owner-op-seam.ts:204`).
`store.list({ type: "schema" })` still returns that row. `Schemas.load`
(`schemas/index.ts:188–193`) has no `try`, so `readProseFile("")` throws
`PROSE_FILE_MISSING` out of `Schemas.open`, which is inside `Counterpart.open`.

**What the owner would actually see.** Not a crash. `bin/hook.ts:602–619` catches
everything out of `main()`, writes one stderr line — `[counterparts] hook stood down:
PROSE_FILE_MISSING {"path":""}` — and **exits 0**. `openAdapter` is *outside* the inner
`try`, so this is the path it takes. So: every session from then on has no wake, no
recall, no capture, and one stderr line the host may or may not surface. The other two
entry points do fail loudly — I read both: the CLI (`cli/bin/counterparts.ts:66–73`)
prints the message and exits 3; the MCP server (`mcp/bin/serve.ts:329–347`) prints
"server did not start" and exits 1, which the host shows as "MCP server failed". Silent
memory absence is the worse of the two failure modes and it is the one the hook lives in.

**How likely is he to hit it?** He has not hit it yet — if any `sch_` row in the live
store had been chased, `Counterpart.open` would already be failing every session and the
parallel run would not be healthy. (Inferred; I did not look at the store.) So the trigger
is a *future* removal of an entity or a belief — a person, or a fact about a person —
which is exactly the kind of thing a memory system holding real private content gets asked
to forget. Removing an ordinary `memory` or `episode` row is safe: `Schemas.load` only
lists `type = "schema"`.

**Second face of the same root cause, also pre-existing (probe 6):** in the dark-only
state (a chase that failed partway, or a removal record appended without a chase),
`Schemas.slices()` throws `REMOVED` — `beliefs()` → `element()` → `physicsOf()` →
`requireRow`. `slices()` is a model path. I ran this probe on the branch only; the chain
is untouched by the diff (`element`'s `physicsOf` call and `requireRow` are identical on
master), so it is pre-existing by inspection rather than by a second run.

**Smallest fix (a deliberate behaviour change — belongs in F5 or its own PR, not here):**
`Schemas.load` and `Schemas.element` skip rows that are denied or whose `prose_path` is
blank. That closes the chase crash, the `slices()` crash and the `readProseQuiet`
deny-list hole in the one place where the hole actually matters, and it is what F5's
`body === ''` tombstone needs to decide anyway.

---

### MINOR 1 — `readProseQuiet` should assert `row.id === id` now, not in F5

**File:** `src/core/store/index.ts:1769–1772`.

The `row?` parameter is safe *today* — proved (probe 1a), `readProseFile`'s `expectId`
catches a mismatched row with `PROSE_PAYLOAD_MISMATCH`. The PR names the hazard and defers
it: F5 deletes `readProseFile` and with it the guard, after which a caller passing the
wrong row silently gets the wrong memory's body. That is a privacy-shaped footgun parked
in a file that will be edited under time pressure.

**Fix (one line, no behaviour change):**

```ts
if (r.id !== id) throw new StoreError("PROSE_PAYLOAD_MISMATCH", { expected: id, found: r.id });
```

Costs nothing, survives F5, and means the reviewer of F5 does not have to remember.

---

### MINOR 2 — the web modal now serves a content hash of a body it is withholding

**File:** `src/adapters/dashboard/web/views.ts:888`, rendered at
`src/adapters/dashboard/web/app.html:1404`.

**Proved** (probe 4): a memory with `meta.confidentiality = "sensitive"` comes back from
`memoryDetail` as

```
text = [confidential — withheld here as it is withheld everywhere]   contentHash = 6d096d5dd5d2cdbe
```

`contentHash` is `row.content_hash` unconditionally. On master the modal showed the file
path, which encodes only the id. Now it shows 64 bits of sha256 over the serialized file.

Do not over-rank this: the hash covers the whole file (id, type, dates, meta, title, body),
so it is a confirmation oracle for an *exactly* guessed secret, not a way to recover one.
But it is a new derivative of withheld text on the one surface whose job is withholding it.

**Fix (one line, owner's call):**
`contentHash: g.confidential ? "" : (row?.content_hash ?? "")` — the modal already renders
`""` as `—`.

Out of scope but worth one sentence: the CLI `browse` view does not withhold confidential
bodies at all (no confidentiality handling anywhere in `browse.ts`), so the new `record`
line adds nothing there. If that is intentional, fine; if it is a gap, it is a different PR.

---

### MINOR 3 — the quiet read's name advertises one exemption and has two

`readProseQuiet` reads as "the read that doesn't make noise". The deny-list exemption is
the dangerous half and the name does not carry it. Covered by the rename suggestion in
MAJOR 1; listed separately because the rename is worth doing even if the seam move is not.

---

### NIT 1 — a fixture-dependent assertion in the new web test

`test/dashboard-web.test.ts:964–967` loops every string on the `/api/memory` payload and
asserts none starts with `/`. `detail.text` is the memory body and `detail.title` is its
title; a memory whose body begins with a slash (a path, a quoted command, `/recall …`)
would fail this test for a reason that has nothing to do with what it is testing. Narrow
it to the fields that used to be paths, or to keys matching `/path/i`.

### NIT 2 — the on-disk check is gone and nothing replaced it

The old `test/dashboard.test.ts` case opened the printed path, stat'd it and asserted the
file's text matched the rendered body — the one test that proved the rendering and the
store agreed. The new version asserts the printed hash equals `row.content_hash`, which is
a column-to-string check; nothing verifies the hash describes the text shown below it. The
PR says F4 is headed away from the filesystem in tests, so this is intentional, but it is
a real assertion lost and the replacement is weaker than the comment beside it implies
("the hash printed here addresses the same text the view shows below it" is not what the
test checks).

### NIT 3 — `entityNameOf` / `previewOf` now swallow a store error they used to propagate

`store.row(id)` moved inside the `try`. A genuine SQLite failure is now reported as "the
name is unavailable" rather than raised. Behaviourally invisible in practice (both call
sites are in a repair report), and the PR's own "named gap" — the `null` branches are
untested before and after. Worth a test in `cli.test.ts` when the other tracks land, as
the PR proposes.

### NIT 4 — no XSS regression, checked

`esc` (`app.html:467`) escapes `& < > " '`. `data-id="…"` is double-quoted and escaped;
`revision` goes through `String()` then `esc`. Both new fields are store-generated
(`row.revision` is an integer column, `row.content_hash` is 16 hex from `hashText`). The
not-found modal takes its own branch (`app.html:1392`) so the `revision: 0 / contentHash:
""` defaults on the empty detail are never rendered. Nothing else in `src/` or the web app
references `prosePath`, `prosePathShort`, `copyPath` or `data-path`.

---

## Answers to the specific questions asked

1. **Can any path show denied content it could not show on master?** No. Five callers,
   all five had both exemptions already, all five verified. The concern is the public
   method, not today's reachability (MAJOR 1).
2. **Does the optional `row?` let a caller read the wrong memory?** Not today — proved.
   It will the moment `readProseFile` goes (MINOR 1).
3. **Should the method be narrower?** Yes — seam export rather than `Store` method
   (MAJOR 1), and schema-typed rows are already enforced by TypeScript (`MemoryRow`).
4. **Is `confidentialByMeta` the same function as `isConfidential` for every input?**
   Yes. 625 pairs, no divergence. The two are literally the same source text.
5. **Does `store.read` differ from `readProse` anywhere?** No — `readProse` *is*
   `read().doc` on both sides. No new events, no changed refusals.
6. **Is the dropped `store.row` check redundant?** Yes, proved for four states.
7. **Observer stance:** nothing new writes; the quiet read emits nothing at all.
8. **Dashboard:** no stale field references, no XSS regression.
9. **Performance:** no call site regressed; the two that do not pass a row did their own
   `store.row` on master.
10. **The pre-existing chase bug:** reproduced on `origin/master` (same
    `PROSE_FILE_MISSING`), and end to end through `ownerRemoval` (MAJOR 2).

---

## Probes

Written into `test/zz-probe.test.ts` in a scratch worktree, run against both
`origin/floor/f3-consumers-off-files` and `origin/master`, then deleted. Never pushed.
Each makes its own `mkdtempSync` dir and removes it. Copy kept at
`scratchpad/probe-backup.ts`.

```ts
// probe 1a — the row? guard holds today
const a = put(s, { body: "alpha body" });
const b = put(s, { body: "beta body" });
store.readProseQuiet(a, store.row(b));   // → StoreError PROSE_PAYLOAD_MISMATCH  ✔

// probe 1b — the deny-list exemption, on the branch only
s.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "probe" });
s.read(id);                    // throws REMOVED
s.readProseQuiet(id).body;     // "the thing the owner asked to be forgotten"     ✔
// on master: TypeError: s.readProseQuiet is not a function

// probe 3 — the truth table, 25 × 25 values, branch fn vs master's source text
for (const a of values) for (const b of values)
  expect(confidentialByMeta(meta)).toBe(masterIsConfidential({ meta }));   // 625 pairs, 0 divergences ✔

// probe 4 — the confidential body is withheld, its hash is not
// MODAL PROBE text = [confidential — withheld here…]  hash = 6d096d5dd5d2cdbe   ✔

// probe 6 — dark-only state, model path (run on the branch; chain identical on master)
sch.slices();   // THREW REMOVED {"id":"sch_…","by":"owner"}                      ✔

// probe 7 — the dropped row check
// NAME mem_c90b… old = Ada  new = Ada      (live)
// NAME mem_3e5d… old = Bea  new = Bea      (dark-denied — both leak, unchanged)
// NAME mem_1d80… old = null new = null     (chased, blank prose_path)
// NAME mem_dead… old = null new = null     (unknown id)                          ✔

// probe 8 — the real remove command, on a belief (run on the branch)
// REMOVAL stages = ["requested","dark","chased","complete"]
// row after = ""
// REOPEN = THREW PROSE_FILE_MISSING {"path":""}                                  ✔
// the seam-level version of the same probe (probe 2) WAS run on origin/master:
//   CHASE PROBE code = PROSE_FILE_MISSING                                        ✔
```

No permission prompt or classifier refusal was hit.

---

## Verdict

**Safe to merge as is.** The refactor does what it says: I could not find a single input
or state where a changed call site answers differently from `039cd5d`, and the
confidentiality gate is provably the same function on both sides of the split. Nothing
below gates the merge.

Optional hardening, both one-liners and neither behavioural — cheap enough to take now if
the branch is being touched anyway:

1. **MINOR 1** — add `if (r.id !== id) throw …PROSE_PAYLOAD_MISMATCH` inside
   `readProseQuiet`, so the guard outlives `readProseFile`.
2. **MINOR 2** — blank `contentHash` on a confidential memory in `memoryDetail`, or
   decide out loud that the owner wants it.

Recommended soon, not in this PR:

3. **MAJOR 1** — move the quiet read off `Store.prototype` into a named seam, the way
   `chaseRemoved` already is, and settle the tension between `CONTRACT.md:92` and the new
   §5 G13 text. Right now the store's contract describes removal as unreachable from any
   model path in §4 and grants a `Store` method the deny-list exemption in §5.
4. **MAJOR 2** — before the next `counterparts remove` on an entity or a belief, make
   `Schemas.load` / `element` skip denied and blank-`prose_path` rows. Until then, the
   practical advice is: do not remove a `sch_` id on the live store. It is pre-existing
   and F3 was right to leave it, but the consequence is a memory that silently stops
   working with one line on stderr, and that is worth the owner hearing in plain words.
