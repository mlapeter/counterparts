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

**Why not chase it, that day.** Striking a span needs a door in `remember/` that
did not exist, and the buffer is a state machine whose spec (§2 G6) forbids a
span being in neither claim nor buffer — a `rmSync` from the destruction path
would race a concurrent claim. Filed as INTERFACE-GAPS §9 with the proposed seam
(`SpanBuffer.strike`), including the detail that `Proposal.ownSpanHash` is minted
but never persisted, which is why the adapter detected by content rather than by
hash.

**Still true after this change:** the words are still on disk. This makes the
report honest; it does not make the removal complete. Closed the next day — see
below.

## 2026-09-05 — the seventh surface is CHASED (option B; INTERFACE-GAPS §9 closed)

The chase landed as `src/core/remember/owner-strike-seam.ts`, called from
`ownerRemoval` between `dark` and the box-2 chase. What the console owns:

- **The chase key, and why it is not a column.** §9 said `Proposal.ownSpanHash`
  is minted and never persisted, so either it joins `memories` or `strike` takes
  a content predicate. It joins the PROSE META instead — `origin.spanHash`,
  beside the session/scope/ref the mint already mirrors there. A column would
  have needed `SCHEMA_VERSION` 4 → 5 (`openOperational` returns early on a
  version match, so `ADDED_COLUMNS` never runs without a bump), which makes a
  revert a store the previous build refuses to open (`SCHEMA_AHEAD`) — a one-way
  door on the owner's live memory, bought for a field the prose can hold. And
  §16 G9 argues the same way: a hash of low-entropy content is brute-forceable,
  and `chaseRemoved` blanks `content_hash`/`prose_path` on the skeleton
  precisely so no pointer to removed content outlives the removal. In the prose
  meta the pointer dies with the document. In a column it would not.
- **The half that works retroactively.** Every accepted proposal has always
  written `{spanHash, proposalId, own}` into the scope's `coverage.jsonl`, and
  the mint has always stored the proposal id in `origin_ref`. So a memory minted
  months before this branch is addressable by its `own: true` coverage marks,
  with no migration. `chaseHashes()` reads both sources. ONLY `own` marks: the
  other spans a proposal covered are the conversation around it, and striking
  those because one memory cited them would be a destruction nobody asked for.
- **The order.** The strike runs BEFORE the box-2 chase and before the prose is
  unlinked, because those are what carry the addressing. Read-everything-first
  (§16 G13) is now doing work rather than being a rule about the contamination
  scan.
- **The body never enters a struct.** `spanChase` on the plan carries a scope
  and hashes. The content fallback reaches the seam as a CLOSURE the console
  builds over a local, so no printed surface, no plan object and no record ever
  holds a word of what is being erased (§16 G15).
- **The report says what happened to the other two places.** A struck hash is
  KEPT in `consumed.jsonl` — that is what stops a re-capture, a restore or an
  orphan merge re-admitting the words — and a claim file rewritten under a
  worker mid-arc is called out by name. Both are printed lines, not stored
  counts; the durable `removal_record` is still four stages.
- **One state is still `NOT chased`, and it is the honest one.** Prose already
  gone AND no span hash recorded: nothing left to address the buffer with. It
  stays in `unchasable`, counts as `unchased: 1`, and says which way it is
  blind. `held` moved out of `unchasable` and into `surfaces`.
- **The echo, found by the adversarial read of the first draft.** On the live
  store a note is taken MID-CONVERSATION, so the Stop hook has already captured
  the turn in which the words were said into `buffer.jsonl`. The first draft
  counted that line in the plan (`spanLinesIn` matched by hash OR by text) and
  the strike then took only the jot — plan said 2, report said 1, and `grep`
  still answered. Two fixes, both about honesty rather than reach: the plan now
  counts exactly what the strike will take (`needle` is passed only when there
  is no hash), and the leftover is counted SEPARATELY as `spans echo` and
  printed on the `unchased` line. It is left on purpose — a conversation span is
  many turns joined, belongs to no single memory, and striking it because one
  memory quoted it would destroy material nobody named. `test/cli.test.ts` has
  the fixture: `captureSpans` a turn holding the marker, then `note`, then
  remove, and assert the plan's count equals the strike's.

**What the adversarial review (2026-09-05) changed, because none of it was
caught by the suite:**

- **F4, the one that would have reached the live store.** The content fallback
  was `text.includes(body)` with `scope: null` visiting every scope. Measured by
  the reviewer: removing "buy milk" destroyed two unrelated jots in two
  unrelated projects and ledgered both hashes. Live-reachable because
  `tools/migrate/apply.ts` writes `origin: { ref }` and nothing else, so all
  ~12,000 imported rows have no scope and no span hash — the exact shape that
  falls through to the fallback. Now: **full-text equality on a jot after trim,
  never a substring**, and **only inside the memory's recorded `origin_scope`**.
  With no scope the console REFUSES, prints the candidate files and line counts
  (no text), and points at `--strike-by-content-across-scopes`, which is the
  owner saying it in so many words. The dry run also states which evidence it is
  acting on — `matched by the span hash its mint recorded` vs `matched by
  content` — because the two are not equally strong and the reader is about to
  type an id back.
- **F1, the invisible aside.** `jsonlUnder()` collected `*.jsonl` only, so a
  crashed strike's `jots.jsonl.striking` was invisible to the residue walk and a
  later `remove` printed "not applicable" over words that were on disk and that
  `backup` would copy. The walk names `*.jsonl.striking` now, and the strike's
  own recovery pass folds any aside home before it runs, so naming it is not a
  promise the chase cannot keep.
- **F6, the third category.** The echo was filed under `unchased (dark via the
  deny-list…)`, which describes a conversation turn as though it had an id and a
  tombstone. It has its own `leftAlone` list and its own line now, in the plan
  and in the completion report, in the same words: *left on purpose — not a
  failure, this removal was never entitled to it.*
- **F5, a claim that was simply false.** The printed line said the sweep drains
  the echo. It does not: `crashedSessions()` excludes any session that ended
  normally and nothing else prunes `buffer.jsonl`, so the echo is permanent.
  Said as such, everywhere, and filed as `remember/INTERFACE-GAPS.md` §9.
- **The failure arm** reused the plan's success sentence, so a strike that threw
  printed "the removal strikes them out of it" underneath a strike that had not.
  It has its own wording.

**Verified:** `test/cli.test.ts` runs §I2's own repro end to end — note through
the jot door, remove, `grep -r` the whole data dir (nothing), `backup` and grep
that (nothing) — plus the two-notes case proving the strike is a rewrite and not
a truncation. `test/remember.test.ts` covers the seam itself, including that the
sweep is never shown a struck span. The install loop gained two steps (35/35):
the §7 plan's `spans` lines are checked against QUICKSTART verbatim, and a
non-interactive `--confirm` still refuses.

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

## 2026-09-05 — `migrate-cache`, and the two follow-ups above are closed

`counterparts migrate-cache` converts box 3's vectors from JSON text to float32 BLOBs in
place — dry run by default, `--apply` to convert, one transaction per `--batch` (500),
`VACUUM` at the end. The design and the measurements live in `src/core/store/NOTES.md`
(2026-09-05); what belongs here is why it is a COMMAND and not a flag on `verify`.

**A rebuild recomputes; this recovers.** The entry above ends with "preserving the vectors
across a rebuild is a CORE change" and files two follow-ups. Both now exist, so the
console has three doors instead of two:

- `verify --rebuild` — unchanged, and still refuses while box 3 holds vectors it cannot
  recompute. The refusals now NAME the safe option; they did not get quieter.
- `verify --rebuild --keep-vectors` — `Store.rebuildCache({ keepVectors })`. Re-indexes
  the text side, keeps every vector whose memory is still canonical, drops the ones that
  are not. Passing it together with `--drop-vectors` is refused rather than guessed at.
- `migrate-cache` — the format conversion, which is neither of those: it neither drops nor
  recomputes, it re-writes the same numbers in the shape they should have been in.

The census learned the shape too (`vector format: N float32 BLOB (v4), M JSON text (v3)`),
because a partly-converted cache is a real state — every reader tolerates it — and one
that nothing named would sit there unfinished. `Store.embeddingCount()` exists now as
well; the census still opens `cache.sqlite` directly, because that read is gated on the
FILE existing and a `Store` constructor cannot promise not to mint the box being
inspected.

`migrate-cache` is on `OWNER_OPS`: box 3 is rebuildable, and rewriting it is still a
write.

**Three things the adversarial review changed, and each is a rule this console already
had.**

1. **The dry run is READ-ONLY, not merely honest.** It opened box 3 with `openCache`, which
   stamps `cache_meta.schemaVersion` — so on the v3 store this will actually be run against,
   one row changed and the file's hash moved under a line saying nothing had. The first fix
   made the command SAY so, which was the right instinct and the wrong repair: every
   question the dry run asks is a `SELECT`, so it opens with `openDb` and `openCache` is
   reserved for `--apply`. "Reads are pure" (§5 G9) means the bytes, not the disclosure.
2. **`--apply` names its store and asks.** `resolveDir` falls through to `dataDir()`, which
   on a real machine is the owner's live memory, and this command is the one operation here
   whose result a `git revert` cannot undo. So `--apply` refuses a data dir that came from
   the default — **before it looks at a single path**, because a guard that reads the
   default directory before refusing it has already been pointed at the store it meant to
   refuse — and then asks, `remove`-style, unless `--yes`.
3. **Converted-but-not-compacted is a state with a door.** `VACUUM` is the step most likely
   to fail: it takes an exclusive lock and the Stop worker holds box 3. The first version
   ran it only after a conversion, and the already-converted arm refused BEFORE it — so one
   lost lock left the entire 177 MiB behind an "already converted" refusal, unreachable
   through the tool that exists to reclaim it. Now the dry run reports the reclaimable
   bytes and `--apply` compacts, converting nothing. The probe is a real `VACUUM INTO` a
   throwaway copy in the OS temp dir: `PRAGMA freelist_count` reads **0** in that state,
   because the pages are fragmented rather than free, and a probe that reads zero where the
   answer is 59% is worse than no probe.

## 2026-09-05 — `repair-merged-beliefs`, and the first un-archive the store has

The console gained its tenth owner operation. It exists because a core fix landed
the same night (`sleep/NOTES.md` §14: a `type: "schema"` row is no longer a
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

## 2026-09-05 — `--yes` means one thing (G31)

**The disagreement.** Two commands merged the same night each took `--yes`, and
meant different things by it. `migrate-cache --apply` asks `remove`-style for a
typed `yes`, and `--yes` skips the asking; the store must be named (`--dir` or
`COUNTERPARTS_DATA_DIR`) either way. `repair-dates --apply` asks nothing, and
its `--yes` was the second way to aim the rewrite at a store nobody named — the
default store, which on a real machine is the owner's live memory. The one
`FLAG_HELP` sentence that had to describe both meanings described both, which
is how the review saw it (LAUNCH-STATUS G31).

**The ruling.** `--yes` ONLY ever skips an interactive confirmation. A command
that writes always requires the store named by `--dir`, and `--yes` never
stands in for it. `repair-dates` has no confirmation to skip, so `yes` left its
flag list rather than staying as a no-op: a flag the help page lists is a flag a
reader tries, and a no-op that used to mean "aim here" is the worst kind.

**Where it is enforced.** `repairDatesCommand` refuses `--apply` whenever
`--dir` was not passed — `defaultedDir` is `flags.dir === undefined`, so an
exported `COUNTERPARTS_DATA_DIR` does not count as naming it, which was already
this command's rule — in the shape `migrate-cache` uses: `refused:` on stderr,
`EXIT.refused`, the remedy naming `--dir <path>` and nothing else. `--yes` on
`repair-dates` now falls to `unknownFlag` before the store is looked at. The
test is `test/repair-dates.test.ts`, "the console door": refused without
`--dir`, refused as unknown with `--yes`, through with `--dir`, and the dry run
still unguarded. `FLAG_HELP.yes` carries the one meaning, so
`migrate-cache --help` says it too. `migrate-cache`'s own door is unchanged: it
already refused the default regardless of `--yes`.

**What still says `--yes` and means something else.** `counterparts-dashboard
serve --yes` means "open the DEFAULT store" (QUICKSTART §11.1, README). It is
read-only and it is not this console, so it was left alone under a ruling about
commands that write; but it is the last `--yes` with a second meaning, and a
rename (`--default-store`, say) is the obvious follow-up once the owner rules.
(It landed as `--default-store` in #78, the same day.)

## 2026-09-05 — one definition of "named", and one door in front of every bulk write

**What the review found (#77).** The entry above closed the `--yes` half and
left the other half open, in the same sentence. `repair-dates --apply` refused a
store named only by `COUNTERPARTS_DATA_DIR`; `migrate-cache --apply` counted the
variable as having named it. So
`COUNTERPARTS_DATA_DIR=<store> counterparts migrate-cache --apply --yes` walked
through, printed the plan and reached the conversion, while the identical line
one command over refused — under one `FLAG_HELP.yes` sentence asserting the two
agreed ("it never stands in for `--dir`, which a command that writes still
requires"). Two definitions of "named" in one console, and a help page that
named the stricter one. The reviewer also found that `backfill-claims --apply`
(salience across every authored memory) and `repair-merged-beliefs --apply`
(un-archives rows) had **no door at all** — `grep` found the guard at exactly
two sites.

**The ruling (owner, 2026-09-05).** `--yes` only ever skips an interactive
confirmation. A command that performs a BULK WRITE always requires the `--dir`
FLAG; neither `--yes` nor `COUNTERPARTS_DATA_DIR` stands in for it. Ordinary
per-memory commands — `note`, `recall`, `remove`, `init`, `install`, `status`,
and `verify` without a writing flag — keep today's behaviour: the variable names
their store, which is what QUICKSTART §3 teaches. The distinction is blast
radius, not "writes": an exported variable is a shell's memory of where a store
lives, and a rewrite of the whole store asks for a sentence typed about THIS
rewrite.

**The helper.** `requireDirFlagForBulkWrite(dir, io, flags, label, what)` in
`commands.ts`, beside `unknownFlag` — one test (`typeof flags["dir"] ===
"string"`, the dispatcher's own), one refusal shape (`refused:` on stderr,
`EXIT.refused`, `it would have been <dir>`, `Name the store: --dir <path>.`,
`Nothing has changed.`), returning the exit code or `null`. It is the FIRST
statement in each writing body, before `storeExists` and before any planning
read: a guard that opened the directory before refusing it has already pointed
the command at the store it meant to refuse.

**The doors, all seven invocations of them.** `repair-dates --apply`,
`migrate-cache --apply`, `backfill-claims --apply`,
`repair-merged-beliefs --apply`, and `verify --rebuild` / `--prune-index` /
`--drop-vectors`. `--drop-vectors` is guarded although it is inert without
`--rebuild`: it is a standing consent to lose embeddings, and consent typed at a
store nobody named is the thing the door is for. The dry runs — each of these
without its writing flag, and `verify`'s census — still read the variable, and
`test/cli.test.ts` asserts that they do.

**What moved with it.** The `dirWasNamed` computation left the dispatcher, so
`migrate-cache` no longer has an answer of its own; its doc-comment rule 2 and
the usage block's paragraph both said "`--dir` or `COUNTERPARTS_DATA_DIR`" and
now say `--dir`. `FLAG_HELP.yes` is true of every command that prints it, which
today is `migrate-cache` alone: "skip the typed confirmation, and nothing else —
it never stands in for `--dir`, which `--apply` requires". Each bulk command's
`COMMAND_BLURB` ends with `--apply requires --dir.` (verify names its three
flags). QUICKSTART §10's recap and §11.1 carry the exception — §11.1 now lists
two, this one and `serve`'s.

**The tests.** `test/cli.test.ts`, "a bulk write names its store with `--dir`,
and nothing else names it": each of the seven refused on the variable alone with
the store proven byte-identical by a sha256 fingerprint of the whole tree, each
through with `--dir`, and the dry runs unguarded. The reviewer's exact case
(`migrate-cache --apply --yes` on the variable) is asserted in the
`migrate-cache` block, including that stdout carries no `Store:` line — proof it
stopped AT the door rather than one step in at box 3's "nothing to convert"
refusal, since both are exit 2. `test/repair-dates.test.ts`'s "console door"
stays as it was.

## 2026-09-20 — `export --markdown`, and the five choices inside it (F7)

Ruling 4 said "`export --markdown` omits confidential rows unless
`--include-confidential`, and says how many it omitted". Five things that ruling
does not decide, decided here, each true for now.

1. **The tree is rendered from ROWS, not from a walk of `<store>/journal/`.**
   The copy on disk is derived; a stale one — an episode removed while its copy
   could not be written — would be exported as though it were live. Rendering
   from rows cannot do that, and it uses the copy's OWN path function and the
   same `renderMarkdown`, so the bytes are identical either way. "Included as
   is" is kept by using its code, not by copying its files.
2. **Grouped by kind** (`memories/fact/`, `memories/person/`, …), not by month.
   Kind is the axis `status` and the dashboard already show, it is a closed set
   of six, and it does not move when a memory is revised — by month splits one
   belief's life across directories.
3. **Filenames are ids.** A title can be as sensitive as a body, and a directory
   listing is the part of an export that gets read over somebody's shoulder.
4. **`--markdown --passphrase` is supported rather than refused**, and it is the
   safest path of the three: the tree is built in memory, sealed, and written as
   one blob, so it never makes a scratch file at all. (The database export keeps
   F5's 0700 `mkdtemp` and its bounded sweep, which is what review B's MAJOR-4
   and review C's NEW-MINOR-6 bought.) A test counts `counterparts-export-*`
   directories in `$TMPDIR` across a markdown export and asserts the number does
   not move.
5. **`--with-versions`, not `--versions`.** `self-page` already takes both
   `--versions` and `--version`, and the help-page totality test reads flags as
   substrings — an `export --versions` puts the string `--version` on export's
   help page, naming a flag export does not take. A real constraint from a real
   test, not a preference.

**TWO FACTS ABOUT `export` THAT ARE THE OWNER'S TO RULE ON, AND ARE UNRULED.**
Both landed with F7 and neither has been decided by anybody but the builder; the
f6f7 review measured what they actually do (MINOR-5) and they are written here
so the ruling can be made from facts rather than from a diff.

1. **The ordinary `export` now opens the canonical database FOR WRITING.** It
   opened `observer: true` before. The reason is the `store.export` row and
   nothing else; the review fingerprinted every file under the store and found
   the effect confined to exactly that — the owner's export moves
   `counterparts.sqlite-wal` and the two `-shm` files, and nothing else; no
   file, no `journal/` write, no scratch. An export against a store another
   process was holding with `BEGIN IMMEDIATE` still returned 0, so there is no
   lock regression of the I38 shape. The row's `catch {}` means a row lost to
   contention is silent, which is one more way "did anything leave" can answer
   "no" when the answer was "yes".
2. **An instrument can now perform a full egress.** `export` came off
   `OWNER_OPS`, so `--observer export` — which refused outright before — makes a
   complete readable or sealed copy of every memory, confidential ones included
   with one flag, and writes no trace in the store (the durable row is what
   stands down, and the report says so). That is the egress question stated
   plainly: the stance that means "read, do not change" now permits the one
   operation by which memory leaves the machine.

**The line to revert, if the owner wants it back:** `"export"` in `OWNER_OPS`
(`commands.ts`), and `Store.open({ dir, observer })` back to `observer: true` in
`exportCommand`. The durable row goes with it, and `fired.ts`'s `export` row
becomes blind the way `backup` is. Nothing else depends on either.

**Two refusals that are new, and one removal.** A non-empty target is refused
unless `--into-non-empty`: an export is a whole copy, and one written over
another is a mixture nothing can tell apart. `--include-confidential` and
`--with-versions` without `--markdown` are refused BY NAME rather than ignored —
they decide what goes into the tree, and a database export carries every row
there is, so honouring either there would be a lie in one direction and silence
in the other. And `export` came off `OWNER_OPS`, the only removal that list has
had: an export READS the store and writes outside it, so standing the command
down under `--observer` refused a read. The one write it now makes to the store
is the durable row, and that is what stands down instead — the copy is still
made and the report says the row was not written. `backup` is the same shape and
deliberately stays on the list: it could follow, but nobody has ruled on it.

## 2026-09-20 — the f6f7 review's five, and what each one cost

Read the review for the measurements; this is what changed and why, in one place.

- **The journal module never follows a symlink** (MAJOR-1). `journalFiles` walked
  with `statSync`, so a link anywhere under `journal/` made a core module a
  writer and a deleter outside the store — the reviewer put a chapter's whole
  body in an external directory and watched a removal ceremony delete a file out
  there and report it as chased. One rule now: a link anywhere at or under
  `journal/` and the module stands down by name (`journal-symlink`), removal arm
  included, because an absence it cannot vouch for must not read as "nothing
  beside the row".
- **A broken `journal/` is one row a day** (MAJOR-2), through the store's own
  `dedupKey` latch, and a directory-level failure ends the backfill pass instead
  of re-discovering itself 25 times. Measured before: 80 rows across five
  chapters and three worker cycles. The starvation half was only reasoned in the
  review and is measured here.
- **The journal-echo disclosure is exact** (MAJOR-3). It rode on a ranked top-20
  search and went silent on exactly the store that needs it: a real chapter plus
  twenty-five near-identical memories, and the episode fell off the list while
  the report said `journal(0, nothing beside the row)` and `unchased: nothing`.
  Now `meta.episodeId` first and a bounded containment scan second, with the
  bound REPORTED.
- **`assertSafeTarget` resolves symlinks** (MAJOR-4), on both sides and on the
  v1 roots, and refuses a dangling link by name instead of by `mkdirSync`'s
  `EEXIST`. It fixes `backup` at the same time. The macOS trap is why both
  sides: `$TMPDIR` is itself reached through `/var` → `/private/var`, so
  resolving one side would have stopped every inside-the-store case from being
  detected.
- **`journal/` leaves the backup set** (MAJOR-5), because copying a derived
  directory put removed episodes' words into every rotating snapshot as plain
  markdown, and the rows are in the snapshot anyway. Paired with a cold-start
  bound so a restore is readable after one pass rather than forty, and with a
  sentence in the removal report about the copies already on disk.

**What the durable row carries, and what it does not.** `store.export`: the
kind, whether it was encrypted, files, bytes, rows, how many confidential rows
were omitted, whether versions went, how many rows would not render. **Not the
target path.** Where the owner sent his memories is more than the row needs to
prove the door works (§5 G10), and the terminal has already told him. F2's blind
`backup` row and its "one `store.backup` event would fix it" are untouched:
that is a different door and still an open gap.
