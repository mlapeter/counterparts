# `tools/demo` — the synthetic store the screenshots come from

Every dashboard render in the README, on the marketing site and in a launch post
comes from a store this seeder builds. Nothing in it is real: no line is drawn
from the owner's life, from any live store, or from any real person or company.

## Run it

```sh
~/.bun/bin/bun install                                    # once, in the worktree
~/.bun/bin/bun run tools/demo/seed.ts --dir /tmp/demo     # a rich, thirty-day store
~/.bun/bin/bun run tools/demo/seed.ts --temp              # ...into a fresh temp dir, printed
~/.bun/bin/bun run tools/demo/seed.ts --temp --empty      # an initialized, empty store
```

It prints a JSON report of what it built and exits non-zero if any deposit was
refused. Then render the views against it — set the data dir **explicitly**,
every time:

```sh
COUNTERPARTS_DATA_DIR=/tmp/demo ~/.bun/bin/bun run \
  src/adapters/dashboard/bin/dashboard.ts status --no-colour --width 100
# ...and browse / stories / identity / activity
```

`bun test test/demo-seed.test.ts` is the hermetic suite: it seeds into temp dirs
and asserts the counts below, the guard's refusals, and that each of the five
views renders the sections the seed fills without their absence markers.

## The never-a-real-store guard

`store/paths.ts` refuses `~/.bansai` and `~/.claude-engram` and **nothing else** —
`~/.counterparts` is deliberately not on that list, because it is where the real
store lives. A seeder that inherited only that guard could be pointed straight at
the owner's memory, so this tool carries its own, in `assertDemoTarget`:

- **There is no default directory.** `--dir` or `--temp`, or it refuses to run.
  The seeder never reads `COUNTERPARTS_DATA_DIR` and never calls `dataDir()`.
- **Refused by name**, resolved on both sides so `..` cannot walk in:
  `~/.counterparts`, `~/.bansai`, `~/.claude-engram`, `~/.memory-ab`,
  `~/counterparts-parallel-run`, `~/counterparts-backups`.
- **Relative paths are refused** — an absolute path is the only way to say which
  directory you mean.
- **A directory that already holds a store is refused**, on the presence of
  `operational.sqlite`, `prose/`, `cache/` or `versions/`. The seeder only ever
  writes into a directory it created or found empty.
- It throws (`DemoTargetRefused`) rather than returning a flag, because a caller
  who forgets to check a boolean is how a guard fails.

`test/demo-seed.test.ts` proves each of those, and proves the `~/.counterparts`
one specifically against the core's own guard, so the extra refusal cannot go
missing silently.

## Zero model calls

No embedder, no live vectors, no `InterpretFn`, no transcript sweep. The brain is
composed exactly as the hermetic tests compose it, and every word of content is
authored in `script.ts`.

## What it builds

Thirty **lived days** (weekdays, 2026-06-01 → 2026-07-10), each one a session
that deposits memories, sometimes writes a journal chapter, sometimes argues with
a belief, runs recall on a cue or two, credits what the reply used, and ends with
a real `sessionEnd` sleep cycle. Typical figures from one run:

| | |
|---|---|
| lived days | 30 |
| memories | 130, across all six kinds, in all three bands |
| entities | 13 (5 people incl. the identity core, 4 things, 2 places, 2 skills) |
| beliefs / current-state | 9 / 4 |
| contested beliefs | 2 — one held under two challenges, one revised on the third |
| current-state replaced | 1 (the fast half of revision) |
| identity band / protected | 15 promoted at consolidation / 2 permanent |
| journal chapters | 16 |
| pruned / merged | 8 / 1 |
| associative edges | 252 directed rows |
| recall decisions | 14 |
| intentions fired / pending | 6 / 2 |
| wake briefing | ~5.1 KB, composed and published |

**Determinism.** Fixed RNG seed, fixed epoch clock, and the script is data — two
runs produce stores with identical *content*. They are not byte-identical: ids
are `randomBytes` at the store seam and `learnedOn` defaults to the wall clock,
neither of which a caller can pin. The test asserts the content-level form.

## Which doors it uses

Almost everything goes through a door an assistant actually writes through:

| what | door |
|---|---|
| memories | `submitSessionEnd` / `submitJot` |
| people, things, places | born by mention from a titled deposit |
| skills | `schemas.mention({ kind: "skill" })` — the authored door births only person/entity/place |
| beliefs, current state | `schemas.addBelief` / `addCurrentState` (no authored door mints one) |
| challenges | an ordinary memory with `updates: <id>`, dispatched by `revision.ts` |
| journal | `episodeAsk` then `appendEpisode` |
| days, decay, prune, dedup, promotion, briefing | `sessionEnd({ date, at, budgetBytes })` |
| co-activation | `resolveUses`, flushed at the boundary |
| intention fired | `prospective.fire` / `arm` |

Three writes go straight to `store.put`, each for a reason named at its call site:

1. **Prehistory** (8 rows, `source: "migrated"`). Pruning needs
   `D_FLOOR_DAYS = 90` lived days of dwell below the floor; a thirty-day store
   cannot reach that from birth by any amount of authoring. These are backdated
   memories from the studio's previous project, and they are what the first sleep
   lets go of — which is what makes "what faded" a real line in `status` rather
   than a panel that never fired.
2. **Prospective intentions** (6 rows). Prospectivity is *derived* from a
   memory's date; there is no "create intention" call, and `ProposalDraft` has no
   field for `happenedOn`.
3. **One duplicated body**, written twice a fortnight apart, so sleep's
   content-hash dedup has a real merge. The authored door refuses a repeat by
   content, so a duplicate cannot be authored.

## The fictional cast

Invented for this store and used nowhere else. No name is a token-subset of
another, because near-collision in `schemas/` is token containment and the second
birth would be refused.

**Fernbrook** — a four-person software studio shipping **Halfmoon**, a
shift-scheduling app, on a six-week pilot at one hospital ward.

| | |
|---|---|
| **Rosalind Achebe** | founder and product lead; also the store's owner, so she is the identity core rather than an ordinary person entity |
| **Teodoro Whitlock** | backend engineer, wrote and owns **Driftwood** |
| **Marguerite Solberg** | designer, owns **Tessellate** |
| **Ilya Broadbent** | mobile engineer |
| **Nkechi Abernathy** | charge nurse running the pilot ward |
| **Halfmoon** | the shift-scheduling app |
| **Driftwood** | the rota solver underneath it |
| **Tessellate** | the studio's design system |
| **Fernbrook** | the studio itself |
| **Larkspur Wharf** | the studio's two-room office |
| **Cotter Street Clinic** | the pilot site |
| **constraint modelling**, **clinic shadowing** | the two skill entities |
| **Saltmarsh** | the studio's abandoned previous project — it exists only in the prehistory rows, which is the point |

## Known rough edges in what it renders

These are findings about the system, not about the seeder, and none is fixed here
(`src/core/` is owner territory):

- **`browse` counts episodes and schema rows as memories.** `browse.ts` calls
  `store.list()` with no `type` filter under the heading "The memories I hold",
  so a seeded store reports 159 in `browse` and 143 in `status`, which excludes
  the journal explicitly.
- ~~**A revised belief's successor is byte-identical to the memory that argued
  for it**, so the next cycle's content-hash dedup merges one into the other and
  the `stories` view ends "REVISED, becoming … [archived: merged]". Happens on
  both the belief path and the current-state replacement path.~~ **Fixed
  2026-09-04** (`sleep/` CONTRACT §5 G9b, NOTES §12): dedup now refuses the pair
  by name. This is what took the seeded `merged` count from 3 to 1 — two of
  those three "duplicates" were the two revisions' successors.
- **`recall.decision`'s durable `ref` is a session id**, and `activity` resolves
  every ref as a memory id, so each recall row reads
  `[no longer at this address] fern-030`.
- **Durable event timestamps and `learnedOn` come from the wall clock**, not from
  the injected `now`, so the feed's clock column and every memory's "learned on"
  say the day the seeder ran rather than the demo's own calendar.
- **Band symmetry stays `never-asked`.** The tripwire needs
  `SYMMETRY_MIN_SAMPLE = 20` transitions per kind; thirty days produces single
  digits. That reading is correct, not a gap.
