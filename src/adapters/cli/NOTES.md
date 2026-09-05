# `adapters/cli/` — NOTES

*Decisions taken while building, and the ones deliberately left open. Working
defaults, revisable without ceremony (constitution 13).*

## Built — six commands

`status` · `init` · `export` · `backup` · `remove <id>` · `verify`

`commands.ts` holds the dispatcher and the three simple commands; `snapshot.ts`
owns the copy rules; `export.ts` owns egress and its crypto; `removal.ts` is the
destruction path and is deliberately not re-exported from `index.ts` (a module
that is easy to import is a module somebody imports).

`run(argv, { io })` returns an exit code and never calls `process.exit`, so every
command is tested against a temp dir with a faked console rather than a
subprocess. `bin/counterparts.ts` binds the real stdio and a `node:readline`
prompt.

## Not built, and named so it is not mistaken for missing-by-accident

The contract's input list also names `install`, `on`/`off`, `protected` (list)
and `restore`. This build was scoped to the six above.

- **`install`** — `init` PRINTS the steps instead. An installer that edits a
  host's settings unasked is the same class of surprise as a memory layer that
  writes unasked.
- **`on`/`off`** and the machine-readable pass record (§5 G10) — the gated
  ambient channel they switch does not exist yet. A switch with nothing behind it
  is machinery in anticipation of a failure (Amendment 15).
- **`protected` (list)** — `status` already enumerates everything permanent
  (§14.1 G9), which is the guarantee. A dedicated subcommand is formatting.
- **`restore`** — CONTRACT §7 OQ3 asks whether it is a command or a documented
  procedure, and it is unanswered. What shipped is the minimum the contract
  demands: a test that OPENS a backup and reads a row written inside the pre-copy
  write window. v1 never once logged a read-back of a backup; this one is read
  back in CI on every run.

## `package.json` needs a `bin` entry, and this build did not write one

Scope was `src/adapters/cli/`, `src/adapters/mcp/` and the two test files. The
line the package needs:

```json
"bin": { "counterparts": "src/adapters/cli/bin/counterparts.ts" }
```

Until then: `bun run src/adapters/cli/bin/counterparts.ts <command>`.

## Export: the owner supplies the key, and nothing is minted

CONTRACT §7 OQ1 — "does export encrypt to a key the owner already has, or does it
mint one?" — is answered PROVISIONALLY as: the owner supplies a passphrase.
Minting is friendlier and is also how an owner ends up with a backup they cannot
open. There is **no default mode**: `--passphrase` encrypts, `--plaintext` is the
loud opt-out, and neither flag is a refusal rather than a guess. Format
(scrypt + AES-256-GCM + gzip'd manifest) is documented in the README written
beside every export, because an encrypted archive whose format is undocumented is
a different way of losing the data.

Still open for the owner: whether a local copy to another directory on the same
disk should count as egress at all. Today it does, which is why `--plaintext`
must be typed.

## Removal has still never fired in anger

CONTRACT §7 OQ2 stands: v1's erase machinery was built, tested, and never run in
production, which by scar §2.17's own criterion makes it unproven rather than
sound. v2's version is smaller (no quarantine, no cooling-off staging — released
by rescope 3) and is exercised end-to-end in `test/cli.test.ts`, including the
read-back that proves the prose is gone and the deny-list holds. That is a test,
not a production fire. **The owner still has to say which this is: exercised
deliberately in bake-in, or carried as declared-dormant-by-design.**

## Owner-in-the-loop is one item long

§5 G12: currently `remove`. `export --plaintext` requires an explicit flag but no
prompt; `backup`, `verify --rebuild` and `init` are autonomous — though
`--rebuild` now has a refusal of its own (below), which is a flag rather than a
human.

## 2026-09-04 — removal names the span buffer: the seventh surface

**LAUNCH-STATUS §I2, owner ruling: option A.** `remove` reported `unchased:
nothing` while a removed note's verbatim words were still on disk. A note is
CAPTURED first — `captureJot` appends the raw text to
`spans/<keyFor(scope)>/jots.jsonl` — and minted second; the chase never reached
that file, `unchasable` was a hardcoded `[]`, and a `backup` taken afterwards
copied the words into the snapshot (`export` does not; spans are outside its
set). Against §16 G15, quoted in the comment sitting on that very `[]`, this was
a silent partial success.

What shipped, adapter-side:

- **`RemovalPlan.spans`** — a seventh surface, reported rather than chased, and
  present in ALL THREE states. `not applicable` is printed too: a surface that
  goes quiet when it is empty is what made the residue invisible.
- **`unchasable` carries it**, so `ownerRemoval` seeds `unchased` from it and the
  `cli.removal.complete` EVENT counts it — an event the console binds to `io.out`,
  so the count is a printed line and nothing else. The durable `removal_record`
  is `(seq, memory_id, stage, at, actor, reason)`: four stage rows, no count.
  Said here because three documents inherited the opposite claim from this
  paragraph (claims audit, round 3). The dry run prints it ABOVE
  `Dry run. Nothing has changed.` — a disclosure under the closing line is one
  the reader has already stopped reading (cold-stranger round 3, C3).
- **Evidence first, provenance second.** `spanResidue()` searches the scope's
  buffer files for the doomed words (during the plan, before anything is chased,
  §16 G13) and reports `held` with the file named. Provenance only breaks a tie
  when the search misses: `source = 'authored'` means the memory came through the
  jot door, so a miss is `unknown`, never an all-clear. The two blind spots — the
  prose already gone, provenance never recorded — are reported as `unknown`
  rather than resolved in the comfortable direction. Paths are store-RELATIVE and
  no line of what was read is ever printed (§16 G15).

**Why not chase it.** Striking a span needs a door in `remember/` that does not
exist, and the buffer is a state machine whose spec (§2 G6) forbids a span being
in neither claim nor buffer — a `rmSync` from the destruction path would race a
concurrent claim. Filed as INTERFACE-GAPS §9 with the proposed seam
(`SpanBuffer.strike`), including the detail that `Proposal.ownSpanHash` is minted
but never persisted, which is why the adapter detects by content rather than by
hash.

**Still true after this change:** the words are still on disk. This makes the
report honest; it does not make the removal complete. README rough edge 4 and
QUICKSTART §10.6 say so in the same words the command does.

## 2026-09-04 — `verify` is a census by default; the rebuild is opt-in

**The sharp edge, found by the adversarial review of PR #37 (the default-data-dir
fix).** `verify` opened the store WRITABLE and called `store.rebuildCache()`,
which begins with `resetCache` — and `resetCache` drops every box-3 table
INCLUDING `embeddings`. This console wires no embedder, so every vector came back
`unrecomputed` and gone: on the owner's live store, ~13,700 vectors that each
cost a paid network call. `store/cache.ts` says the same thing in its own voice
about why `backfillLengths` is not a rebuild. Before #37 a bare `counterparts
verify` was saved only by ACCIDENT — it failed the layout check on the old
default before it ever reached a store — and after #37 the default resolves to
the live store. An accident is not a guard.

What shipped:

- **Bare `verify` is a read-only census.** Observer stance, one box at a time
  (store opened, read, closed; then box 3 on its own connection), and it
  rebuilds nothing. It prints canonical rows, the deny-list count, box 3's
  index/length/ranking/embedding counts, live memories with no vector, and one
  line saying whether the cache covers every canonical row. That last line is a
  **set diff**, not arithmetic: `indexed + denied == canonical` can agree by
  coincidence and cannot say which way it is wrong, so both directions are named
  (canonical rows not indexed, indexed ids that are not canonical rows).
- **`verify --rebuild` is the old behavior**, and it REFUSES while box 3 holds
  embeddings this console cannot recompute, unless `--drop-vectors` says out loud
  that losing them is the intent. The count is read BEFORE a writable store is
  opened, so the refusal path never constructs one.
- **The guard fails CLOSED.** A count that could not be taken is not a count of
  zero: box 3 is the file the Stop-hook worker writes vectors into, so a locked
  read there is ordinary, and a guard whose failure mode is "could not count the
  vectors, so dropped them" is not a guard. An unreadable-but-present cache
  refuses the same way a populated one does. An ABSENT cache still proceeds —
  there is nothing to lose.

**Why refuse-unless-flag rather than preserve the vectors.** Preserving them
across a rebuild is a CORE change and this was an adapter-only fix. The core
follow-ups, named so they are not lost: `Store.rebuildCache({ keepVectors })`
(re-index the token side without dropping `embeddings`), and
`Store.embeddingCount()` — because there is no read API for "how many vectors
does box 3 hold". `unembeddedCount()` is the coverage denominator (live rows with
no vector), which is a different number. Until that exists, the census opens
`cache.sqlite` directly with `openDb`, the same deep import `snapshot.ts` and
`export.ts` already make (INTERFACE-GAPS §5), gated on the file existing so the
census cannot mint the box it is inspecting.

**`verify` stays on `OWNER_OPS`,** so `--observer verify` still refuses even
though the census writes nothing. That is a false refusal in the safe direction,
and taking it off the list is stance semantics — threading the stance into the
command so `--rebuild` alone refuses — which is a separate decision, not a
safety fix. Left open deliberately.

## 2026-09-05 — `repair-merged-beliefs`, and the first un-archive the store has

The console gained its tenth owner operation. It exists because a core fix landed
the same night (`sleep/NOTES.md` §13: a `type: "schema"` row is no longer a
dedup candidate) and **stopping a bug does not undo it**. On a store that ran a
cycle before that fix, a belief whose statement matched an ordinary memory's
body was archived `merged` and stopped being a belief. Migration settles the
DIRECTION of that loss and not its frequency: migrated elements were minted at
the import day while migrated memories kept their v1 birth day, so the memory is
never younger and the element always loses — but a pair needs two distinct v1
items whose gated text is byte-identical, and nothing in the code says how often
that happened. **This command is the measurement**, which is why its dry run is
the answer to G17 rather than an adjective in a document.

**Two sources, unioned, because either can be the surviving evidence.** The
`memory.merged` events whose `candidateId` is a `sch_` id — the owner's own
read-only check, filed as G17 — and the archived schema rows whose
`archived_reason` is the merge, which still reads true after the event log has
rolled. Removed ids are skipped: the deny-list answers before this tool does.

**It prints statements AND entity names, and `backfill-claims` says not to.**
That command's header says "IDS AND NUMBERS ONLY — a repair report is not a
place to print bodies", and this one prints two things that are not ids: the
first 60 characters of each statement, and **the entity's name** — the line
reads `sch_0dc7784034fc  Ada  lived day 0`. A person's name is author content as
squarely as a statement is, and it is named here so a later reader finds a
choice made twice rather than an unnamed second deviation.

Both are the same decision, and it is the one the command exists to enable: a
claim restored to the store is a claim the system will state in a briefing, and
"restore `sch_198628843ffb`?" is not a question a person can answer. Without the
entity the owner cannot tell which Ada, or whether the belief belongs to a
person still in their life. This runs on the owner's own terminal, at the
owner's own keystroke, against the owner's own store — the same reader who could
open the prose file beside it. Ids-only would have been safer and useless.

**The durable record stays ids and numbers only**, and that is the line that
actually matters: `memory.unmerged` carries `{event, day, candidateId,
originalId, mergedOnDay, usesDelta}` and no text of any kind (§5 G10). The
deviation is console-only — one printed line, at the moment of a decision, and
nothing written down.

**The core door it needed did not exist, and is the smallest one that works.**
`Store` has no `unarchive` and must not grow one: the prune, the revision and
the removal all archive, and each is archived for a reason a repair tool has no
business reversing. `store/owner-op-seam.ts#unarchiveMerged` accepts
`archived_reason: "merged"` and refuses everything else by its own error code —
`UNMERGE_NOT_A_MERGE`, `UNMERGE_SUPERSEDED`, `REMOVED`, `ID_UNKNOWN` — crosses
the same observer stance check every write crosses, and appends a latched
`memory.unmerged` record inside the same transaction, so a second `--apply`
writes nothing at all. The seam's export list grew from three names to six and
`test/store.test.ts` pins the new list, which is the point of pinning it.

**It re-indexes box 3, and the reason is a moving target.** `archive()` leaves
box 3 alone on master as this was written, so a restored row was findable with
no extra work. PR #64 (`overnight/df-live-rows`) adds `deindexDoc` to `archive()`
so document frequency is counted over live rows — and then whichever of the two
lands second would leave this command restoring a belief that is live, listed in
`beliefs(entity)`, and **invisible to lexical recall**, with no cheap way back
(a cache rebuild without an embedder drops every vector on the store). Measured
by the adversarial review at `doc_tokens` 7 → 0 on archive → 0 after `--apply`.
So the seam re-indexes on restore, through the narrowest grant member that could
do it (`OwnerOpAccess.reindexLexical`) — the LEXICAL half only, because a repair
that made a paid embedding call, or dropped a vector nothing here can recompute,
would be worse than the bug. The test simulates #64's deindex and would fail
without the call; it also asserts the embedding survives untouched.

**It prints which store it opened**, before the list. `--dir` is optional and the
default resolves to `~/.counterparts/store`, and this is the command the owner is
asked to type `--apply` at. `status`, `note` and `recall` print `Store: <dir>`;
`backfill-claims` does not, and should.

**The `uses` the merge credited is left standing.** Reversing it would rewrite a
physics count whose band may already have been materialized and whose crossing
may already be a durable `band.transition` row, in order to undo a single use on
a memory that really was looked at that evening. The delta goes into the
`memory.unmerged` record instead, so the credit is auditable rather than
silently reversed. The merge record and the `memory.merged` event are both left
exactly where they are — constitution 7: a repair that tidied away the evidence
of the bug would be the same class of mistake as the bug.

**`--dry-run` is a declared flag that does nothing.** Dry run is already the
default. It is declared because the owner's runbook line spells it out, and a
console that refuses `--dry-run` as an unknown flag on a command that IS a dry
run is the 2026-09-04 `--dirr` lesson pointed at the owner's own hands.

**Never run against the live store by this build's authors.** Every test uses a
temp store; the one demonstration of `--apply` was on a copy of a deliberately
poisoned scratch store. The owner runs the read-only
`counterparts repair-merged-beliefs --dry-run --dir ~/.counterparts/store`.

## Verified live? No

Every test runs against a temp store. Per CLAUDE.md's definition of done this is
**merged, not verified**: the outstanding proof is one real snapshot of a real
store, restored and read.

## 2026-09-05 — two refusals and a help page, from the cold stranger's list

**`status` on a missing store exits 1.** It printed the right sentence on
stdout and exited 0, so `set -e` around `counterparts status` sailed straight
past a typo'd `--dir` — and a typo in the one flag that says WHICH STORE is the
sharpest edge this console has (the same edge `unknownFlag` was built for one
round earlier). `usage`, not `failed`: nothing broke, the line named a place
with no store in it. The sentence moved to stderr with it, because a non-zero
exit whose only output is on stdout is half a refusal. It still does not create
the store by looking for it.

**And the remedy names the dir that was passed.** `Run 'counterparts init'`,
offered under a line that had just named `--dir /somewhere`, would create the
store in the DEFAULT place — advice that works, somewhere else. Both copies of
the sentence carry the dir now; the dashboard's is `bin/dashboard.ts`'s
`describeStoreError`, and it moved for the same reason on the same day.

**`counterparts <command> --help` answers the question it was asked.** It
printed the whole console's usage, so the flags a command actually takes were
listed nowhere a person could ask for them: the only surface that knew was the
refusal you got AFTER typing one wrong. `commandHelp` reads `COMMAND_FLAGS` and
`COMMON_FLAGS` — the same table `unknownFlag` reads — so the help page and the
parser cannot drift; `FLAG_HELP` gives each flag a sentence and the test fails
on a flag added without one. Bare `--help` still prints the console's usage,
and both still exit 0 and open nothing.
