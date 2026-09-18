# Adversarial review, second pass — PR #135 (`607e516`) and PR #139 (`28f0f68`)

Reviewed 2026-09-18 in a scratch worktree. Nothing pushed, nothing commented, nothing
merged, nothing deployed. The live store, `~/.counterparts`, `~/.bansai` and
`~/.claude-engram` were never opened. All probes hermetic (`mkdtempSync` + `rmSync`).

## Verdicts

| PR | verdict | counts |
| --- | --- | --- |
| **#135** `floor/f3-consumers-off-files` @ `607e516` | **safe to merge as is** | 0 BLOCKER / 0 MAJOR / 2 MINOR / 2 NIT |
| **#139** `fix/schemas-skip-removed-rows` @ `28f0f68` | **safe to merge as is** | 0 BLOCKER / 1 MAJOR / 3 MINOR / 3 NIT |

**The MAJOR below does not block either the merge or the deploy.** It is a documentation
claim that is false and a behaviour the owner will find surprising; the code is correct
and is strictly better than what is on master today.

**Is #139 safe to DEPLOY to the live store ahead of the rest? Yes.** It converts a silent
total outage into working memory, it was proved end to end through the real removal
command, and the one behaviour it newly exposes (orphaned beliefs of a removed person) is
visible rather than dangerous. Two things are cheap enough that I would take them first —
a four-line performance fix and the documentation correction — but neither is a reason to
wait, and the risk of waiting is higher than the risk of shipping.

## Numbers I ran myself

- **Trial merge** — `scratch/trial-merge` off `origin/master`, then
  `git merge origin/floor/f3-consumers-off-files` then
  `git merge origin/fix/schemas-skip-removed-rows`. **Both merged clean, no conflicts**
  ("Auto-merging src/core/schemas/index.ts", ort strategy). Suite on the merge:
  **2230 pass / 0 fail**, 28520 assertions, 38 files, 54.2 s. `tsc --noEmit` clean.
- **#135 alone** (`607e516`): **2227 pass / 0 fail**, 28478 assertions, 53.8 s.
  `tsc --noEmit` clean.

---

# PR #135 — the fix pass

## What is genuinely closed

**My first-pass MAJOR 1 is closed as stated.** MINOR A below is not "the fix did not
work" — it is a pre-existing residual (`export * from "./prose.js"`) that has been true
since long before F3 and is unchanged by this PR. Verified by reading the whole
`cbb72c4..607e516` diff:

- `Store.readProseQuiet` is deleted from `src/core/store/index.ts`; nothing is left on
  `Store.prototype`.
- `src/core/store/walk-seam.ts#readProseWalking(store, id, row?)` is the only door, and it
  carries the `row.id !== id` guard I asked for (line 54), so the protection outlives
  `readProseFile`'s `expectId`.
- The lint (`test/cli.test.ts`, "the WALKING read is imported by two files…") walks all of
  `src/`, greps for `walk-seam.js`, allows exactly `core/schemas/index.ts` and
  `adapters/cli/commands.ts`, asserts **both** allowed files really do import it
  (non-vacuous — it cannot pass because the seam vanished), and asserts
  `src/core/store/index.ts` contains neither `walk-seam` nor `readProseWalking`. I
  confirmed that last one by hand: the index's export blocks (lines 80–125) do not
  mention it, and importing the store index at runtime shows `readProseWalking:
  undefined` (probe P5).
- MINOR 2 taken: `memoryDetail` now blanks `contentHash` when the body is withheld, with a
  test that also asserts it differs from the row's real hash and that `revision` survives.
- NIT 1 taken, and taken correctly: the web test now scans by KEY (`/path|dir|file/i`)
  instead of over every string, so a body beginning with `/` no longer fails it.
- NIT 2 taken, and taken *better* than I asked: the browse test now recomputes
  `hashText(serializeProse(doc))` and compares it to the column, which proves the printed
  hash addresses the shown text — a stronger assertion than the old "open the file" one.

**No behaviour change from the fix pass itself**, other than the intended `contentHash`
blanking. The new `r.id !== id` throw is unreachable from any of the five call sites
(each passes its own row or none). Everything else in the diff is comments and renames.

## MINOR A — the fence is around the seam's *name*, not around the capability. PROVED.

**File:** `src/core/store/index.ts:83` (`export * from "./prose.js"`) and `:82`
(`export * from "./paths.js"`); `src/core/store/CONTRACT.md:177–180`.

**Scenario.** Any module in `src/`, any adapter, any npm consumer importing
`counterparts/store` writes three lines and gets exactly the deny-list-skipping,
telemetry-free read the seam was built to fence:

```ts
import { readProseFile, Store } from "counterparts/store";
const row = store.row(id);
readProseFile(store.absolutePath(row.prose_path), id).body;   // the removed body
```

**Proved** (probe P5, run on the trial merge, whose `src/core/store/index.ts` is
`607e516`'s file unchanged — #139 does not touch `store/`):

```
P5 store index exports readProseFile: function | readProseWalking: undefined | resolveStoredPath: function
P5 denied body via public exports = "a private thing"
```

— an id with a `dark` removal record, `store.read(id)` throwing, and the body returned
anyway. The lint does not see it: it only greps for `walk-seam.js`.

This is **pre-existing and unchanged by this PR** — it is exactly the technique the five
old call sites used — so it is not a regression and does not block the merge. I am
raising it because the new CONTRACT sentence now says the seam exists so that "§4's
'unreachable from any model path' has to stay true of the store's own surface", and it
still isn't true of the store's own surface. A lint plus a contract sentence that together
imply closure are worse than no claim at all.

**Smallest fix, and it is now cheap:** after F3, **nothing outside `src/core/store/`
imports `readProseFile` any more** (I grepped `src/`, `test/`, `tools/` — the only hit is
a comment in `test/schemas.test.ts:1494`). So replace `export * from "./prose.js"` with an
explicit list that omits `readProseFile` and keeps what consumers use (`ProseDoc`,
`ProseType`, `PROSE_TYPES`, `ID_PREFIX`, `hashText`, `serializeProse`, `parseProse`,
`Staged`). That is a one-line change plus a list, and it makes the contract sentence true.
Alternatively: soften the contract sentence to say what it actually guarantees.

## MINOR B — the seam has a lint, but no runtime gate; `chaseRemoved` has both

**File:** `src/core/store/walk-seam.ts` vs `src/core/store/owner-op-seam.ts:156–162`.

The PR models the new seam on `chaseRemoved`, but copies only half of it. `chaseRemoved`
is defended at runtime — `GRANTS.get(store)`, and `OWNER_OP_UNGRANTED` if the caller never
called `grantOwnerOps`. `readProseWalking` is a plain exported function over a public
`Store`: the only defence is a test that reads source text.

That test can be satisfied while the seam is reached anyway, by any of:
- a concatenated dynamic specifier — `await import("./walk-" + "seam.js")` — which the
  `/walk-seam\.js/` regex does not match (suspected, not probed; it is how the regex works);
- `createRequire(...)("./walk-seam.js")` — that one *would* match the regex, so it is caught;
- anything in `tools/` or `test/`, which the walk does not cover (it roots at `src/`).

Not a merge blocker — this is the same class of protection `test/cli.test.ts` already
relies on elsewhere, and the seam's whole point is that it is one named hole. Worth
knowing that the contract's "two files may import it and `test/cli.test.ts` pins which" is
a convention enforced by grep, not by the runtime.

## NIT A — the ALLOWED list matches by path suffix

`ALLOWED` uses `full.endsWith(join("core", "schemas", "index.ts"))`, so a future file at
any path ending in those three segments is silently permitted. Contrived today (there is
one such file); one line to tighten to a full relative path if anyone cares.

## NIT B — the lint walks `src/` only

`tools/` is unpinned, which is consistent with `tools/parallel/readers.ts` already reading
prose by path against the old store, but the contract sentence reads as though the list is
absolute. One clause would fix the wording.

---

# PR #139 — a removed schema row is skipped, not read

## What I proved works

All against the trial merge, using the **real** `ownerRemoval` ceremony (requested → dark
→ chase → complete), not the raw seam.

**P1 — a removed BELIEF.** The chased row survives with `prose_path === ""` (the shape
that used to throw). Then:

```
P1 wake bytes = 188 | secret present: false
P1 recall | secret present: false
P1 schema context = "## Ada (named in this span)\n- belief [sch_…]: Ada reads faster when someone talks her through it"
P1 boundary ok, keys = session,scope,kind,at,day,askRaised
```

`Counterpart.open` succeeds; `wake()`, `recallForTurn()`, `slices()`,
`preselectSchemas` + `renderSchemaContext`, `aliasIndex().lookup("ada")`, `element(id)`
and a full `boundary()` (the sleep cycle) all run without throwing, and the removed
statement appears in none of them. The surviving belief is untouched.

**The control (P1b), because two of those negatives would otherwise be hollow.** Same
fixture, nothing removed:

```
P1b wake bytes = 188 | secret present: false        ← VACUOUS: this wake never carries schema text
P1b recall bytes = 1795 | secret present: TRUE      ← non-vacuous: removal is what takes it away
P1b recall#2 | surviving belief present: true       ← and recall still works afterwards
P1b schema context | secret present: TRUE           ← non-vacuous
P1b schema context = "## Ada (named in this span)\n- belief […]: Ada is paid two hundred
  and fifty thousand\n- belief […]: Ada reads faster when someone talks her through it"
```

So the load-bearing evidence is **recall and the rendered schema context**: with the
belief present they carry its words, and after `counterparts remove` they do not. The
**wake** negative is vacuous in this fixture and I am not claiming it — wake carries no
schema text here either way; what the wake proves is only that it runs. Note also that I
drove `Counterpart.wake()` directly, not `bin/hook.ts` → `openAdapter` →
`adapter.hook("session-start")`; what I proved about the hook path is that
`Counterpart.open` — the call that used to throw inside it — now succeeds.

**P2 — a removed ENTITY with beliefs attached.** `entities()`, `slices()` and
`aliasIndex().lookup("ada")` are all empty; wake and recall contain neither "Ada" nor the
statement; the boundary runs.

**P3 — a full sleep cycle over a store with a chased belief AND a chased entity**, with a
second person surviving. The cycle runs, the output contains no removed text, the
surviving person renders, and a second `Counterpart.open` after the cycle is clean.

**The recall legs were already safe, on both branches.** `recall/activate.ts:314` builds
`new Set(store.deniedIds())` and filters before candidates are formed, so neither the
lexical nor the vector/semantic leg can surface a denied id even while its FTS row or
vector is still in the cache. The same pattern is already in
`sleep/{consolidate,decay,dedup,prune}.ts`, `self/identity.ts`, `mcp/server.ts`,
`cli/repair-dates.ts` and four places in `cli/commands.ts`. `schemas/` was the one module
in the codebase that did not ask — which is precisely the bug, and precisely what #139
fixes. The cache rebuild also skips and logs denied rows (`store/index.ts:1400–1411`).

**Question (c), answered: nothing that used to be swallowed now propagates.** Before
#139, `element` had **no** try/catch — `salience: this.store.physicsOf(id).salience` threw
whatever came. The new `try`/`isAbsence` only *adds* catching for `REMOVED`/`ID_UNKNOWN`
and rethrows everything else. The change is strictly additive and strictly safer; there is
no new way for a malformed row to take a session down through `element`.

**Question (d), answered: no orphan path throws.** `element(orphan).entityId` names the
removed entity and `entity(thatId)` returns `undefined`; nothing throws and nothing
renders a blank name. `cli/commands.ts#entityNameOf` returns `null` for a chased id
(proved in my first review). The builder's own test pins this.

**Question (e), rated: LOW.** Proved (P4) in a long-lived process, after another process
dark-marks the entity:

```
P4 alias lookup after dark = ["sch_b10484226588"]     ← stale, as the builder says
P4 entity()  = undefined                               ← live gate holds
P4 slices    = []                                      ← live gate holds
P4 element(other) after a full remove from elsewhere = undefined
P4 slices after full remove: did not throw
```

The stale alias cannot leak text: the only consumer of `aliasMap()` is
`retrieval.ts:75` → `Turn.aliases` → recall, and `activate.ts:314` filters denied ids, so
the entity can be *matched* but never *surfaced*. Nothing enumerates alias handles for
rendering. A restart clears it. **Not worth closing before something else needs
cross-process invalidation** — the builder's judgement is right.

## MAJOR — "absent from every rendering" is false, and the counter-example is the owner's dashboard. PROVED.

**Files:** `src/core/schemas/CONTRACT.md` §7b; `src/core/schemas/NOTES.md` §13;
the rendering path is `src/adapters/dashboard/identity.ts` over
`src/core/self/identity.ts#enumerate`.

**Scenario.** The owner runs `counterparts remove <ada's entity id>`. A belief about Ada
sits in the identity band (earned, or promoted). He then runs the dashboard:

```
P11 identity view | secret present: true

Identity band — what strength earned (1)
  0.00  ░░░░░░  entity  identity  Ada is paid two hundred and fifty thous…  sch_484c8b00af61  42b
```

**Proved**, probe P11, on the trial merge. The person is gone — `entities()`, `slices()`
and the alias lookup are all empty, and `browse --id <entity>` correctly prints
`[removed by the owner]` — and her salary is still printed, in words, on the identity
view.

**Why it happens.** The identity and protected enumeration starts at
`store.list({ band: "identity", archived: false })` and `store.list({ archived: false })`,
not at an entity, and `dashboard/identity.ts:109` reads the prose itself. The orphaned
belief was never removed, so it is not denied and its prose reads fine. CONTRACT §7b says
"absent from every rendering: no slice, no alias, no match" and NOTES §13 says "invisible
in every rendering — every path starts at an entity and hers is gone." Both sentences are
wrong for this path, and they are the sentences an owner would rely on.

**It is not a regression** — before #139 the store could not be opened at all after such a
removal, so nothing rendered because nothing ran. #139 correctly converts a crash into a
working session, and this is what the working session then shows. That is the right trade;
the documentation just has to say so. It matters because the model can run the dashboard,
so this is a model-reachable surface, and because "I removed her and her salary is still
on the screen" is the worst possible way for the owner to learn about the cascade
question.

**Smallest fix (documentation, and it should land with the deploy):** correct §7b and
NOTES §13 to say that a removed entity's own row is absent everywhere, and that elements
hanging off it are orphaned — invisible wherever a rendering starts at the entity (slices,
aliases, preselection, recall), and still visible wherever a rendering starts at the row:
the dashboard's identity band (**proved**, P11) and its protected list (the same
`enumerate` loop over `store.list({archived:false})` filtered on `row.protected === 1` —
**by inspection**; my probe's attempt to set the protected flag was a no-op, so I did not
exercise it), plus `Schemas.element` by id and `Store.read` by id. Then put the cascade
question to the owner, as the builder already proposes. A code fix — cascading the
removal, or teaching the enumeration to skip elements whose entity is denied — is a
behaviour change and should not block this deploy.

## MINOR C — `entity()` asks the deny-list per call: O(entities × deny-list). PROVED.

**File:** `src/core/schemas/index.ts:1119` (`removed()`'s `this.store.deniedIds().includes(id)`
when no set is passed), reached from `entity()` at `:1126`, from `entities()` at `:1138`
and therefore from `slices()` at `:1236`.

The builder's measurement — "2.4 → 4.6 ms at 120 entities" — was taken against an
essentially empty deny-list, and the cost is not a constant. Each `entity()` call runs the
whole `removal_record` query and then a linear `Array.includes`. Measured (probe P9), 300
entities, mean of 5 runs:

```
P9    0 denied: entities() =  10.4 ms
P9  200 denied: entities() =  28.2 ms
P9 1000 denied: entities() = 111.2 ms
```

and `slices()` 40.1 ms → 57.0 ms at 300 entities / 200 denials (P7). The deny-list only
ever grows.

**Not an outage:** `slices()` has exactly one production caller,
`counterpart.ts#sweepSlices` (the background worker), and `entities()` one more,
`dashboard/web/views.ts:1377`. Neither is the synchronous hook path, and
`Schemas.open` — which *is* on the hook path — already fetches `deniedIds()` **once** per
load, which is the right shape (measured 24.1 ms for 600 schema rows).

**Smallest fix, four lines, and half of it is already written:** `removed()` already takes
an optional `ReadonlySet<string>`. Have `entities()` fetch `deniedIds()` once and pass the
set down; leave `entity(id)` asking per call for direct callers. I would take this before
deploying, purely because it is free.

## MINOR D — the fix closes the removal *cause*, not the outage *class*. PROVED.

**Scenario.** A schema row that was never removed loses or corrupts its prose file — a
botched migration, a half-written file, a disk event, one of several builds that wrote
this 16,000-row store. Probe P6, on the trial merge:

```
P6 open = THREW PROSE_FILE_MISSING {"path":".../prose/schemas/sch_….md"}
```

`Counterpart.open` still dies, the hook (`bin/hook.ts:602–619`) still catches it and exits
0, and the owner still gets a silent session with no wake, no recall and no capture. #139
fixes the cause we found; the failure mode survives.

**Two mitigations, neither in scope for #139, and I would do both:**
1. **Before deploying**, run `counterparts verify` on the live store and confirm the prose
   path census reports `missing 0` (`cli/commands.ts:2240`). That answers "does this store
   already contain the other version of the bug" without anyone reading the store.
2. **Make the stand-down visible.** The real fix for this whole family is that a hook which
   cannot open the memory should say so where the owner sees it — the session memory
   records that a SessionStart hook's `systemMessage` reaches the terminal — instead of one
   line on stderr and exit 0. "Memory is off" must never be a silent state.

## MINOR E — a blank `prose_path` is treated as "removed" without asking the record

`removed()` returns `true` on `row.prose_path === ""` alone. The chase is the only thing
that writes that today, so it is correct today. But it means a row blanked by anything
else now **silently disappears** from the schema index instead of throwing — uptime bought
with data vanishing without a word.

**Smallest fix:** emit a counted event when `load` skips a row (id + which of the two
reasons), so `verify`/`doctor` can print "N schema rows skipped as removed" and the owner
can tell a removal from a corruption. Cheap, and it turns a silent skip into a fact.

## NIT C — the CONTRACT's "no match" claim

§7b says a removed element is absent from "no slice, no alias, no match". True after a
reopen. In a long-lived process, a dark-marked entity is still in the alias index and can
still *match* (P4), even though it can never surface. The NOTES section says this
correctly; the CONTRACT bullet overstates it by one word.

## NIT D — `PRIVATE_HELPERS` grew by `removed`

Correctly added, so the public-surface test does not treat it as API. Noted only because
it is the kind of list that silently legitimises anything added to it.

## NIT E — the removed-entity test asserts the orphan is readable

`test/schemas.test.ts` asserts `c.schemas.element(ids.first)?.statement` still contains the
removed person's belief. That is the documented decision and I agree it should be pinned —
but the assertion is now the only thing standing between "decided" and "regression", so it
deserves the word DECIDED in the assertion message rather than only in the comment above
it.

---

## Probes

Written to `test/zz-probe2.test.ts` in the scratch worktree, run against
`scratch/trial-merge` (and P5 against `607e516`), then deleted. Copy at
`scratchpad/probe2-backup.ts`; the first pass's probes are at `scratchpad/probe-backup.ts`.
Each makes and removes its own temp dir.

- **P1/P1b/P2/P3** — real `ownerRemoval` of a belief, of an entity, and of both plus a
  full sleep cycle, through `Counterpart` (`wake`, `recallForTurn`, `slices`, `preselect`,
  `renderSchemaContext`, `aliasIndex`, `boundary`); **P1b is the unremoved control** that
  makes the recall and schema-context negatives non-vacuous and shows the wake one is not.
- **P4** — a live `Schemas` against removals run from another `Store` handle.
- **P5** — `readProseFile` + `absolutePath` from the public store index on a denied id.
- **P6** — a non-removed schema row whose prose file was unlinked.
- **P7/P9** — `entities()` and `slices()` at 300 entities against a 0 / 200 / 1000-entry
  deny-list.
- **P8/P10/P11** — the orphan on the identity band, through `self/identity.ts#enumerate`
  and through `Dashboard.identity()`.

No permission prompt or classifier refusal was hit.

---

## What I would do, in order

Nothing in this list blocks either merge; it is the order I would work in.

1. Merge **#135** as is. (Optionally take MINOR A first — dropping `readProseFile` from
   the store index's `export *` is now a safe one-liner, and it makes the contract's new
   sentence true.)
2. Take the four-line `entities()` fix (MINOR C) and the CONTRACT/NOTES correction about
   orphans (MAJOR) onto **#139**.
3. Run `counterparts verify` on the live store; confirm the prose census says `missing 0`.
4. Deploy **#139**. It is the one change here that removes a way for the owner's memory to
   be silently switched off, and every surface I could reach survives a removed belief and
   a removed person.
5. Put two questions to the owner, neither urgent: should removal cascade to a removed
   entity's elements, and should a hook that cannot open the memory say so in the terminal.
