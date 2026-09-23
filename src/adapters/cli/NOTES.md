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
their store, which is what QUICKSTART §3a teaches. The distinction is blast
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

## 2026-09-20 — the day-1 surfaces (new-user findings 2, 3, 4, 6)

The owner's next act is to follow the QUICKSTART on a blank store as a stranger, so what
these commands SAY on day 1 is the product. N2's hermetic dry run measured it and the news
was not good: `fired` opened with twenty-eight `never` lines, `status` buried its four
numbers under a ten-line block naming `assertLayout()` and "Box 3", and `doctor` printed a
red about a key both pages say is optional.

**`fired` on a young store.** The report now carries `young`, `livedDay` and
`calendarDays`, so the console, doctor and the dashboard share ONE definition instead of
each deciding. Only the TEXT renderer narrows; the report itself is whole, `--all` prints
it, and the bounds line still counts every state. **Both clocks have to agree** — a lived
day is advanced by the worker, so a store whose worker has been dead a fortnight also
reads lived day 0, and that store must get the full list, because the full list is its
diagnosis.

**`status`.** The census leads, the prose follows, `Layout:` is behind `--layout`. The
day's facts are two new lines. `Today` is counted INSIDE the census walk and not with
`countMemories({ learnedOnFrom })`, which counts removed and superseded rows: the first
draft printed `2 new` beside `Memories: 1`, which is the kind of disagreement between two
numbers on one page that makes a reader stop trusting both.

**`readHost` lives in `install.ts`, not in `doctor.ts`.** It is the other half of what that
file prints — `settingsBlock` and `mcpCommand` — and it uses that file's own names
(`HOST_EVENTS`, `MCP_SERVER_NAME`). `doctor.ts` takes the reading and grades it, exactly
as it already takes `checkout` and `open`, so the adapters stay leaves that do not import
each other and the host's vocabulary lives in one place.

Everything it reads belongs to the host. `~/.claude.json` is documented as a file the host
writes for itself, so every answer names the files it looked at and the finding is amber,
never red: when one of these paths moves, the line must read "I looked here and did not
find it", not "you did not install it". Paths verified against the host's documentation on
2026-09-20 — true for now, and worth re-checking rather than trusting.

**`doctor --dir` under the explicit-dir guard.** `--dir` is a name, so the refusal was
never really about the store: it was about the DEFAULT CONFIGURATION beside it, whose
`credentialsFile` points at the owner's live keys. That file is now simply not opened, the
store is graded on its own, and one amber says which questions therefore went unasked. On
cut-over day this is the difference between pointing `doctor` at the parked store and a
refusal with nothing to do.

**Precisely, because the first version of this note overstated it** (adversarial review,
2026-09-20): what is not read is OUR configuration — `claude-code.json`, the credentials
file it names, the embedder setting, the snapshot policy, the stance. `readHost` still
runs, so `doctor --dir <anything>` opens the four host settings files and `~/.claude.json`
on the real home. Those are the HOST's, they are read-only, and the Host line names every
one of them — but "reads no configuration at all" was not true of them and should not have
been written.

---

---

## `start-fresh` — starting over as one command (2026-09-20, N1)

**What it is.** One command that parks the store beside itself under a dated
name, parks the snapshots folder the same way, and creates a blank store back at
the same path. It exists because the trial loop the owner wants — use it as a
stranger, collect every rough edge, fix, start over, repeat — otherwise runs
through the floor plan's §2 step 5 by hand, five commands with seventeen
thousand private memories on the other side of a typo.

**The rule, and why the module is arranged around it.** It never deletes and
never opens the old store, *including read-only*: under WAL a commit lives in the
`-wal` until somebody checkpoints it, and an opener is somebody. `start-fresh.ts`
makes exactly one mutating call, `rename`, and imports nothing that can open a
database.

**Decisions taken, each a working default:**

- **The store comes from the CONFIGURATION, and `--dir` is refused.** The store
  that matters is the one the hooks and the MCP server open. `--dir` is a common
  flag, so it parses on every command; ignoring it silently here would be the
  `--dirr` scar pointed at the most dangerous verb in the package.
- **The new store lands at the SAME path**, which is where this departs from the
  floor plan's step 5 (`store-v2` beside the old one, then re-run `claude mcp
  add`). Parking in place means `dataDir` does not move, so `claude-code.json`
  and `credentials.env` are kept byte for byte — `install` without `--force`
  keeps both — and there is no MCP re-registration to forget, which was named as
  failure mode (b) of the clean cut.
- **`install` does the creating**, called as itself rather than re-implemented.
  Its host-steps tail is skipped by the one caller it is false for: printing
  "register the MCP server" on this path would send the owner to run a command
  he does not need, on the day he is most likely to follow instructions
  literally. Its ceiling is handed back from the configuration for the same
  reason — otherwise the run ends on "NO injectionBudgetBytes was written",
  which is true of a cold start and false when the file was kept.
- **Snapshots first, store second**, so a kill between the two renames leaves the
  configuration pointing at a store that is still there. The window where it
  points at nothing is two syscalls wide, and the rollback lines are printed
  before the first rename, so even a kill inside it leaves the way back on the
  screen.
- **What counts as "a store is here" is a filesystem question** — the directory
  exists and holds something — never `storeExists()`, which looks for the
  canonical database by name. After F5 that name changes, so on cut-over day
  `storeExists()` would answer "no store here" about the store being protected.
- **A fresh `-shm` warns; it does not refuse.** Measured on this build:
  under `bun:sqlite` the `-wal` and the `-shm` survive a clean close, so that
  file is recent after any console command at all — including the `doctor`
  somebody ran a minute before typing this one. Refusing on it made the command
  refuse itself in testing. The refusal rests on the live-session registry
  instead, which is genuinely about a host that has not ended a session.
- **The confirmation is the real gate, and says so.** No cheap read can see an
  idle open session: it writes nothing. So the prompt states that in those words
  rather than implying the checks above it were sufficient.
- **The record of the beginning is a meta row, not a durable event.**
  `store.started`, `store.started.by`, `store.previous.parked` in box 2's
  general-purpose key space, beside `embed.failed.<id>` and `sleep.pruned.<id>`.
  A durable event name would have had to be added to `core/counterpart.ts` and
  accounted for in `fired`'s registry — where a mechanism that fires once in a
  store's lifetime would read "never" forever on every store that was simply
  installed. `status` reads the rows back; nothing else does.

**Known, and left alone for now.** A kill between the install and that record
leaves a blank store that `status` simply says nothing about. A state file to
close it would be a second source of truth about a directory, for a line of
output; the next run's printed plan says exactly what is on the ground instead.
A test asserts the silence, so nobody later turns it into a guess.

**Two duplicated strings, and the honest reason.** `start-fresh.ts` spells
`"store"` and `"snapshots"` rather than importing `DEFAULT_STORE_SUBDIR` and
`SNAPSHOTS_DIR_NAME`. Both are only *recognition* tests — "does this store sit in
the layout this package creates, so that a sibling `snapshots` is ours to park" —
and getting either wrong costs a folder not parked, never a byte moved.

The tempting justification is wrong and is written down here so nobody rests on
it: importing `adapters/snapshots.ts` would not "pull `openDb` into the import
graph" in any way that matters, because this file already imports
`core/store/index.js`, which reaches the whole store. **The module's promise is
about CALLS, not imports** — it opens no database, and the one store function it
calls, `preRowsMarkersIn`, reads filenames. If the layout names ever move, this
file is the second place to look.

**The merge-up over F5 (2026-09-20).** Four things changed underneath this
command, and none of them changed its design — which was the point of asking the
filesystem rather than the floor.

- **The fixture stopped being a stand-in.** `test/old-floor-fixture.ts` extracts
  the pinned tag with `git archive` (never a second worktree — that touches the
  shared repository) and runs THAT build's `Store` API in a child to write a real
  v5 store. It is worth the seconds: the hand-made version proved that the
  command tolerates three filenames, and the claim is about a store with bodies
  in files, archived versions, a journal, spans, a cache and a WAL. On the
  fixture as measured `operational.sqlite` is 4 KB and its `-wal` is ~600 KB, so
  "never opens it" is load-bearing rather than decorative: an open-and-close
  could checkpoint 600 KB out of the sidecar and into the file.
- **`storeExists()` now answers true for a pre-rows store** (F5, so that ~20
  console commands reach the named refusal instead of "run init"). This command
  still keeps `sight()`, and the difference is real rather than stylistic: a
  half-made store holding only a `cache/` is "no store" to `storeExists` and
  "something is here" to `sight`. The second answer parks it; the first would let
  `install` mint a store beside a stale box 3 belonging to another store's rows.
  Both readings are pinned by a test across four directories.
- **The plan says which floor it found**, through `preRowsMarkersIn` — filenames,
  never an open. A reader on cut-over day has just met F5's refusal somewhere
  else; being told it is the same fact, and that it is the reason parking is
  right, is cheaper than leaving them to connect it.
- **F5's rotation already refuses to delete or count a copy holding pre-rows
  markers**, so parking `snapshots/` is belt and braces — kept, because the
  bracing is free and the failure it prevents is not. What DID need correcting is
  the sentence about a `snapshots.dir` pointed elsewhere: "the new rotation will
  count the old copies" is now only true of copies this floor wrote. Old-floor
  copies are recognised and left alone; new-floor ones count toward `keep`. Both
  the printed line and QUICKSTART say that now.

---

## What the adversarial review changed (2026-09-20)

The rule held — the reviewer could not make it delete anything and could not make
it open the store it parks — and everything found was in the ring AROUND the
rename. Five of the fixes changed the design rather than a sentence.

**The order is the fix for two findings at once.** The blank store is now built
in a sibling (`store.new-<pid>`, same filesystem) BEFORE anything is parked, and
moved into place with one atomic rename. That closes M1 — `install` could refuse
*after* both renames, on a fractional `injectionBudgetBytes` that `loadConfig`
accepts and `installCommand` does not, leaving the configuration pointing at
nothing — because an install that refuses now costs a temporary directory. And it
shrinks M4: the window in which a real SessionStart hook could mint a store at
`dataDir` went from a whole `install` to two renames. The window cannot be closed
entirely — `rename` needs the old directory out of the way first — so the second
rename REFUSES on a non-empty destination and names all three directories rather
than burying one inside another.

**The cold arm had a store in it all along (B1).** An absent configuration meant
"a machine with nothing on it", so `storeDir` was `""`, the install pin was
skipped, and `installLayout` fell back to `$COUNTERPARTS_DATA_DIR` else
`~/.counterparts/store`. One mistyped character on `--config` was enough to open
and stamp the live store. It now computes the landing place up front from the
CONFIGURATION'S OWN directory and an EMPTY environment — so the variable cannot
redirect it — prints it (the `Store:` line is never blank again, which is what let
two contradictory sentences share a screen), pins it, and refuses if anything at
all is there.

**A plan that is read and a plan that runs must not differ (M2).** The date is
frozen for the whole run, so a UTC midnight cannot rename the plan out from under
the printed block. The re-read after the confirmation now refuses when the ground
moved instead of silently executing a different plan. And the way back is printed
again *after* the renames, from the plan that ran, listing only the steps that
actually moved.

**A bare `mv` is not a move (M3).** `mv a b` where `b` exists moves `a` INSIDE
`b`, exit 0 — measured. Every printed line is guarded, and the way back is a
command now (`--undo`) with the same discipline. The test parses the printed lines
out of real output and runs them through `/bin/sh`, against a free destination and
against one that exists; proving a guard any other way proves the intention
instead.

**Two of my own premises were wrong**, and the code moved rather than the test.
`--undo` could never hit its own destination check for the blank store, because it
picks a free name; the reachable collision is a snapshots folder the rotation puts
back, and it is LEFT and said rather than merged or refused-over. And the undo's
pre-check read the ground as it stands rather than as it will be at each step, so
it refused its own plan — step 1 is exactly what frees the path step 2 needs.

**`--yes` is not enough on a store with something in it.** The reviewer's own
machine had two dashboards holding the live store open while the review was being
written, and neither leaves a record this command can read. `--yes` exists for a
script and for the install loop, where the store is a throwaway; on a real one the
typed confirmation is the only instrument that catches an idle dashboard, so
skipping it needs a second sentence: `--nothing-is-open`.

**And a symlinked `snapshots` no longer refuses the whole command.** Symlinking a
backup folder onto an external disk is an ordinary thing to have done, and there
was no way through but editing the configuration. It is treated exactly as a
configured `snapshots.dir` is: left, and said out loud. The store still moves,
which is what the owner came for.

---

## The confirmation review, and the one thing it taught (2026-09-20)

The forward command came through closed — every earlier finding re-run and
fixed, a real v5 store byte-identical through a refusal, a dry run, a cut-over
and the full printed rollback. The BLOCKER was in `--undo`, and the lesson is
worth more than the fix.

**`--undo` was new code that ran none of the old code's refusals.** Not because
anyone decided it should not: because it was written as its own path, and the
refusals lived inside `planStartFresh`. So a configuration whose `dataDir` is
inside `~/.bansai` — which the forward command refuses BY NAME, in the words of
CLAUDE.md's second safety rule — was renamed twice by the command whose whole
job is being the safe way back. With no tampering at all.

The fix is parity, and the shape of it matters: **one function, called by both**.
`pathGuard()` is the whole battery — present, absolute, not a forbidden root by
either spelling, not a root, not the home directory, not a directory holding the
configuration, not a symlink — and there is now a structural test asserting that
the forward plan and the undo plan return the *identical sentence* for the same
bad path. Two implementations of "what may I rename" is how the two came to
disagree; one function and a test that compares their answers is what stops it
happening again.

**And a record is data.** `store.previous.parked` is a row in the new store's
`meta` table, so anything that can open the store can write it — the reviewer
pointed it at `~/.bansai/store` and watched v1's memory get renamed onto
`dataDir`, at the store's own parent to get a directory planned into its own
child, and at a symlink to make `dataDir` become one. `parkedSiblingRefusal`
pins the shape instead of trusting the value: same directory as the store, and a
name this package actually writes. The fallback already only produced those; the
recorded value now obeys the same rule.

The rest was parity too — the liveness check, the re-read after the
confirmation, the way back in the failure branch — plus two honest sentences:
the dry run says it reads the new store's record and may rewrite its `-shm`, and
the header comment no longer claims an undo of an undo, because there is not
one. The two guarded lines that do it by hand are printed instead.

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

---

## 2026-09-21 — `ui.ts`, the shared primitives the 0.2 install flow is built from

**What it is.** One file — `src/adapters/cli/ui.ts`, zero runtime dependencies — holding
the console's manners: whether there is a person to ask, whether to colour, how to ask,
how to read a secret without echoing it, and how to lay a short line out. Four builders
are about to add interactive commands (wiring, uninstall, the credential prompts, the
reshaped `--help` and `doctor`), and a person should meet ONE set of manners, not four.
This change adds the module and its tests and nothing else: no command's behaviour or
output moved.

**The rules it exists to hold.**

- **Not a terminal → exactly as today.** `isInteractive` needs four things at once: the
  caller did not pass its own opt-out flag, `io.prompt` exists, stdin AND stdout are
  terminals, and `CI` is unset. Every existing test console fails the third, so it is
  false everywhere it is false today. Nothing here wraps, colours or asks when it is
  false, and pipes keep one logical line per item — which is what the suite's greps and
  `tools/install-loop/run.sh` read.
- **`NO_COLOR` is obeyed** (https://no-color.org) and its value is never interpreted:
  `NO_COLOR=0` means no colour. Empty string reads as unset, which is the reading
  `dashboard/ansi.ts` already takes — one repo should not hold two definitions of one
  variable. `FORCE_COLOR` (non-empty, not `0`) turns colour on for a pipe; `TERM=dumb`
  turns it off for a terminal.
- **Colour and wrapping are decided separately.** Wrapping keys off `io.tty.stdout`
  alone, so `FORCE_COLOR` on a pipe gives escapes and still one logical line. A grep that
  works today cannot be broken by somebody's environment.
- **A hidden value is never written.** `askHidden` returns it and writes nothing but the
  question and one newline — not to `io.out`, not to `io.err`, not into an error message.
- **Nothing proceeds unconfirmed.** With no `io.prompt`, `confirm` is `false` and `typed`
  is `false` whatever their default says; `ask` alone falls back to its default, because a
  name is a value and not a consent.

**What `Io` gained** (`commands.ts`), both optional and both additive, so every existing
caller and test compiles and behaves unchanged:

- `promptHidden?: (question) => Promise<string>` — the same read without echo.
- `tty?: { stdin, stdout, columns? }` — what the host knows about its terminal. ABSENT
  means "not a terminal", which is the truth for every pipe and every test console.

**The trap in that seam, stated because somebody will hit it.** A test that drives the
interactive arm by setting `tty: { stdin: true, stdout: true }` must ALSO supply
`promptHidden`, or `askHidden` REFUSES (`PromptAborted`, reason `no-hidden-input`) instead
of falling back to the echoing reader. That refusal is the no-echo rule defending itself:
the fallback to `io.prompt` is offered only to a console that has told us it is not a
terminal, where there is no terminal to echo to.

**Ctrl-C throws rather than returning a null.** `PromptAborted` with reason `interrupt`,
after the terminal is restored. A nullable return would have turned a forgotten check into
"the person skipped it" — which, at a key prompt, is an install that quietly continues
without the key somebody was in the middle of cancelling. Uncaught, it still exits
non-zero through the `bin/` entry's own rejection handler.

**What the raw reader had to get right**, each one a way to lose a credential silently:
Enter in raw mode is `\r` and not `\n` (a reader waiting for `\n` hangs forever); a paste
arrives as ONE chunk, key and newline together; backspace (`\x7f` and `\b`) must work or a
typo in a 100-character key can only be fixed by starting again; an escape sequence is
swallowed WHOLE, because dropping only the ESC byte leaves `[A` inside a value nothing
echoes; `setEncoding` is never called, since it is sticky on the stream
`bin/counterparts.ts` also reads for `credentials set`; and the terminal is restored, the
listener detached and the stream paused on every exit path — Enter, Ctrl-C, Ctrl-D, `end`,
`error` — or the process does not exit.

**Two of those the first round got wrong, and the review caught**, both in the same class:

- **An `error` is not a submit.** It was bound to the same handler as `end`, so a stream
  that failed halfway through a key would have RESOLVED with the half, and
  `credentials set` would have written a truncated credential that reads as present and
  fails at every boundary. That is I32's shape, minted fresh. `end` resolves (an EOF is a
  submit); `error` aborts.
- **Ctrl-C is checked before the escape state machine**, from every state. Underneath it,
  the abort was swallowed as "the character after a bare ESC" — so a person who pressed an
  arrow key and then gave up could not give up.

**`statusLine` is held to `claude-code/doctor.ts`.** Its two columns are that file's
`SEVERITY_COLUMN` and `TITLE_COLUMN`, its fix line is the same 18 spaces, and it keeps the
2026-09-20 rule that a label as wide as its column still gets its space (without it,
`AMBER Journal modewal`). `test/ui.test.ts` renders five findings through both `reportLines`
and `statusLine` and asserts the plain arm is byte-identical, so the two renderings of one
doctor line cannot drift apart silently.

**Not wired.** `hiddenPrompt(input, output)` builds a real no-echo reader over
`process.stdin`/`process.stdout`, and `bin/counterparts.ts` does NOT use it yet — the entry
point binds it when the first command needs it. `ui.ts` is likewise not re-exported from
`index.ts`: commands import `./ui.js` directly, and there is no reason yet to make it part
of this package's public surface.

## 2026-09-21 — `keys.ts`: the terminal is where a key comes from (findings 2 and 3)

**What changed.** `credentials set <NAME>` reads the key from the person standing at the
terminal, without echo; `keys.ts#promptForKeys` is the install step that asks for both
keys; `bin/counterparts.ts` binds the two `Io` members `ui.ts` shipped and nobody had
wired yet (`promptHidden` and `tty`).

**Why the refusal was there, and why it goes.** `credentials set` refused a terminal
because a terminal with nothing piped into it BLOCKS, and a console that hangs waiting for
a secret is one people Ctrl-C before typing the key on the command line instead. That
reasoning was right and the fix was the wrong half of it: the answer to "it would block"
is to ASK, not to refuse. The refusal is still there, word for word, for every console
that is not a terminal — `isInteractive` wants `io.prompt`, both streams to be terminals
and `CI` unset, so a pipe, a CI job, `tools/install-loop/run.sh` and every test console
fall through to it. `--stdin` and `--from-env` fall through too: both name a source, and a
caller who named one gets it.

**The one place the two arms answer differently: an empty value.** A pipe that carried
nothing is a script that went wrong (`refused`, exit 2). A person who pressed Enter has
SKIPPED — "skipping is always offered and always fine" (the owner, 2026-09-21) — and that
exits 0 having written nothing. Same for both keys in `promptForKeys`.

**`writeCredential` moved here from `commands.ts`**, unchanged. Two doors now write a key
(the command and the install prompts) and there should be exactly one function in this
package that puts a secret on disk. It also keeps the import one-way: `keys.ts` imports
only a TYPE from `commands.ts`, the way `ui.ts` does, so `commands.ts` can import back
without minting an ESM cycle.

**A key is not consent to embed.** A Voyage key sets nothing but the key. The knob moves
only after `Turn on recall by meaning now?` is answered yes, and then into the exact shape
`loadConfig` reads and `doctor`'s fix line names — `"embedder": { "enabled": true }`.
The edit parses the existing config, sets that one field and renames a sibling over the
target: `writeOnce` writes straight over the file, and a crash mid-write leaves the config
every hook reads EMPTY, which is I32's shape aimed at a different file. It never CREATES a
config; a config invented there would name no store.

**Two judgement calls worth knowing.** A pasted value with a space in it is NOT written —
a credential that is present and broken fails at every boundary while reading as
configured, which is worse than absent, and the console says so without echoing what was
typed. A value whose prefix is not `sk-ant-` / `pa-` is WARNED about and saved anyway: a
prefix is a convention, nothing here calls the network, and a key this console rejected
for looking wrong is a key the person has to work around.

**Ctrl-C propagates out of `promptForKeys`** rather than coming back as "skipped", for the
reason `ui.ts` gives. A key written before the abort stays written — it is on disk, and
saying otherwise would be the lie.

## 2026-09-21 — the help split, and "plain output never changes"

**The two findings.** New-user #4: `counterparts --help` was 129 lines of dense
paragraphs, and it is the SECOND thing a stranger types — the "did that install work?"
check. New-user #5: `doctor` and `status`, the two commands that check an install, printed
a dense block of long unbroken lines with no spacing and no colour.

**The help split.** Two pages, each answering exactly one question.
`counterparts --help` / `counterparts help` / a bare invocation print `help.ts#shortHelp`:
one line of what this is, then every command grouped by what a person came to do
(Everyday / Setup / Your data / Advanced), ONE short line each, then where to go for more.
Thirty-nine lines. `counterparts help <command>` and `counterparts <command> --help` print
the same page they always did — `commandHelp` — now with the paragraphs the old `usage()`
carried, out of `help.ts#COMMAND_DETAIL`.

**Nothing was deleted to make the short page short.** Every sentence the old page held is
in `COMMAND_BLURB`, in `FLAG_HELP` (so it prints beside the flag it is about), or in
`COMMAND_DETAIL`. `test/help.test.ts` holds a list of phrases lifted out of the old page
and asserts each one still prints on the page of the command it was about — the guard on
the one real risk of the split, which is that "move it" quietly became "drop it".

**Totality, mechanized.** `test/help.test.ts` walks `COMMANDS` and fails on a command with
no short line or no page, and holds the descriptions to `SHORT_LIMIT`. A command cannot be
added to this console now without help for it, which is exactly how the old page drifted.
`help` itself is a command — it is dispatched, it has a page, and it is one of two commands
(`start-fresh` is the other) whose synopsis does not offer `--dir`, because it opens
nothing. It is handled in `run()` immediately after `unknownFlag` and before the stance and
the config are read, so a shell with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` armed can still
ask what the commands are.

**`help.ts` imports nothing but types from `commands.ts`**, which imports it. Its tables
are keyed by plain strings for that reason, and the check that ties them to `COMMANDS`
lives in the test, where both sides can be named at once.

**PLAIN OUTPUT NEVER CHANGES — not a byte.** This is the whole safety property of
`report.ts`, and it is what makes a second layout safe to have at all. A pipe, a test
console, a CI job, `tools/install-loop/run.sh`, `--json`: every one of them gets exactly
what it got before, from exactly the function that produced it before — `doctor` calls
`reportLines` from inside `printDoctorReport`, and `status` carries its old `io.out`
sequence as `StatusView.plain` rather than rebuilding it, because the only way to promise
byte-identity is to keep the bytes. The laid-out arm is reached only when `ui.ts` says this
console is a terminal (`io.tty`) or has asked for colour anyway (`FORCE_COLOR`).
`test/report.test.ts` asserts the equality both ways.

What the terminal arm adds to `doctor`: the same worst-first order (`worstFirst`, which
QUICKSTART §12 documents — unchanged), one BLANK LINE between the reds, the ambers and the
greens, the grade word in colour AND in words, the fix dim on its own line in the constant
gutter, and a message folded with a hanging indent instead of wrapping back to column zero
where it reads as a new finding. The summary is coloured by the worst thing in the report.
For `status`: four labelled blocks with one aligned column each — not one column for the
page, which would read as a table with a meaning it does not have — and `by kind` / `by
band` emitted VERBATIM, because their own double-space grouping is the layout and a greedy
fold rejoins on single spaces.

**One dependency, stated because the colour is inert without it.** `bin/counterparts.ts`
does not set `io.tty` yet; the builder who owns that file binds it with the hidden prompt.
Until then the laid-out arm is reachable from a test, from a library caller that supplies
`tty`, and from `FORCE_COLOR=1` (colour, no fold — `ui.ts` decides the two separately, so
every existing grep keeps working).

**Two doctor findings, both the same shape: a true sentence that reads as a fault.**
New-user #8 — the Authorship line reported a seven-day window on a store made that morning.
The window is not wrong about what it LOOKED at; it is wrong about what it could have seen,
and a reader cannot tell the two apart. The store now records the day it was made
(`core/store#STORE_CREATED_KEY`, written only by the open that CREATED the file, `OR
IGNORE` on top of that, so a store that was already there is never stamped with a day it
did not begin on), and `doctor` clamps the window it SAYS — never the window it reads, so
no count and no grade moves — to that day, or to `start-fresh`'s `store.started`, whichever
is earlier. A day at or before the window start changes nothing; a day after `today` is a
clock nobody should trust and changes nothing either, which is also what every synthetic
test store looks like. A store made before this key existed has no evidence, so the
sentence is the one it always was: a reading that guessed would be worse than one that
declines to. Deliberately NOT read as evidence: a memory's `learned_on` (an imported store
carries dates from long before it existed) and the oldest event row's date (`rowDate`
prefers the payload's own `date` field, which is the date the event is ABOUT).

New-user #9 — after a key was added the Sweep line went on saying AMBER `reason
no-credential` until the next boundary, with a fix line telling the reader to do the thing
they had just done. The gate row is the newest sweep, not the current state of the machine.
So: the newest row says it stood down for want of a key AND the credentials file holds one
now → GREEN, saying which two facts it is looking at, and no fix, because there is nothing
to do. A standing amber nobody can clear is how a person learns to read amber as
decoration. Every other stand-down reason is untouched, and the credential comes from the
FILE and never from the environment, which is the rule `credentialFindings` already keeps.

## 2026-09-21 — `wire`, `unwire`, `uninstall`, and an `install` that asks (A)

The owner installed 0.1.0 from npm as a stranger and stopped at the first screen:
`install` printed a sixty-line JSON block and said "merge this yourself"
(`docs/new-user-findings.md` #1, "the biggest barrier"). His answer was one line —
**wire by default, after asking first** — plus a ruling on leaving, quoted at the top of
`uninstall.ts`. This is those two sentences.

**`install.ts`'s first rule is now narrower, not gone.** It said the host's files are only
ever PRINTED, "an installer that edits somebody's editor configuration without being asked
is the same class of surprise as a memory layer that writes without being asked". The
operative clause turned out to be *without being asked*. So: a terminal is asked and then
wired; a pipe, CI, every test and the scripted half of `tools/install-loop/run.sh` get the
printed blocks byte for byte; `--no-wire` gets a terminal the same thing. Nothing that has
ever been measured changed behaviour.

**The merge is on the INNER hook entry, and that is the whole design.** Not on the `hooks`
object, not on the event's array — on `hooks[event][i].hooks[j]`. Another tool's entry
therefore keeps its index, its `matcher`, its `timeout` and every key we have never heard
of, because it is never rewritten at all; ours is appended beside it (hooks on one event
run in parallel) or, when it is already there under a path that has moved, has its
`command` replaced in place by an object spread. A second entry of ours on one event is a
block somebody pasted twice: it is DROPPED and counted, because rewriting both to the same
string would leave the duplicate forever.

**The recogniser is `HOOK_COMMAND_MARK`, taken from `install.ts` rather than written
again.** `doctor`'s `readHost` uses it to answer "is this wired?", so a hook `wire` writes
and a hook `doctor` counts are the same hook by construction. `test/wire.test.ts` wires a
temp home and then asserts `readHost` sees all five events with `stale: []` — if those two
ever disagreed, a correctly wired install would read as broken on the one surface a person
checks.

**Four refusals that are not caution, they are the file's own shapes.** Bytes that are not
JSON; a top level that is not an object; a `hooks` key that is not an object; an event
whose value is not an array. Each one is a settings file whose meaning we would be
guessing at, and a guess there rewrites somebody's configuration into a shape they did not
choose. The refusal prints the block for hand-merging — which is exactly what `install`
printed before this change, so the worst case is the old behaviour.

**A symlinked `settings.json` is written THROUGH.** A dotfiles repository is an ordinary
arrangement, and `rename(2)` onto the link path would replace the link with a regular file
and quietly detach whatever manages it. So the target is resolved, required to be inside
the home, and written; the backup lands beside the TARGET. A link pointing outside the home
is refused rather than followed — at that point this would be editing a file somewhere
nobody named.

**`~/.claude.json` is read and never written.** Claude Code owns its own state file; the
registration goes out as `claude mcp add` with an ARGUMENT VECTOR (a store path comes off
disk and can hold anything a shell would interpret). One consequence found by the install
loop: `unwire` must attempt `claude mcp remove` **even when our read saw no
registration**, because that file may move and our read is evidence rather than authority.
"Tolerate not found" is cheaper than a server left pointed at a store nobody is wiring.

**`--delete-memories` counts before it warns, and the fallback matters more than the
count.** A store that will not open on this build — the old-floor `STORE_PRE_ROWS` case,
which is precisely the state of somebody uninstalling after an upgrade went wrong — would
otherwise produce "WARNING: this will delete 0 memories." That is the most dangerous
sentence this command could print, so a store that refuses produces a SIZE and the name of
the refusal instead. `storeExists` is checked first for a second reason: `Store.open`
CREATES what it opens, and a count must never be the thing that mints a store.

**Both moving verbs refuse while anything of ours is running, and the lister is not
`pgrep -f counterparts`.** That pattern matches an editor with this repository open, a
`tail` on a log, a dev server in a directory with the word in its path — the false
positives `start-fresh` already warns about in prose. The marks here are the SCRIPTS
(`mcp/bin/serve.ts`, `claude-code/bin/runner.ts`, `dashboard/bin/dashboard.ts`) plus the
two installed shims anchored at a token boundary. It never throws, and a lister that fails
is treated as no evidence rather than as evidence of absence.

**Two things worth knowing about where this sits.**

- `isInteractive` needs `io.tty`, and `bin/counterparts.ts` does not set it yet (builder C
  owns that file this round). Until it does, the interactive install arm is unreachable in
  a real terminal and `install` behaves exactly as it does today — which is the safe
  direction for a change that edits a host. Every confirmation inside `wire`, `unwire` and
  `uninstall` gates on `io.prompt` instead, the rule `start-fresh` already uses, so those
  three work at a terminal now.
- **The interactive arm writes `injectionBudgetBytes: 9000` when no `--budget` was given,
  and says so.** Scar §2.18 says this package invents no host ceiling, and it still holds
  everywhere else: the scripted arm ends on its "NO injectionBudgetBytes was written"
  paragraph exactly as before. The difference is that there is a person to tell. This is
  the owner's plan line ("`--budget` gets a default of 9000") and it is a working default,
  not a new rule — if it fights §2.18 later, the interactive arm is the one place to take
  it back out.

### The merge with C and D, and what a real pty found (2026-09-21)

**Step 4 is `keys.ts#promptForKeys` now**, called after the configuration and the 0600
credentials file exist — `enableEmbedder` edits a config and never creates one, so the
order is not arbitrary. `PromptAborted` propagates out of it, as that module argues it
must, and is caught here: the install says nothing else was changed, summarises from the
FILE rather than from the result it just lost, and exits non-zero. A summary built from a
result that was thrown away would be a summary of what did not happen.

**`doctor`'s Host fix lines name `wire` now.** They said "Run: counterparts install — it
prints the hooks block; paste that into ~/.claude/settings.json". That was the only true
answer while printing was all this package could do. It is not any more, and the stale
case is the sharpest one: `wire` repairs an entry that names a path that has moved, in
place, which is exactly what that finding is about.

**Driven on a real pty** (`python3 pty.openpty`, a throwaway HOME, a stub `claude` on
PATH, nothing near the real `~/.claude` or `~/.counterparts`): install → re-run → wire →
doctor → uninstall → `--delete-memories` with the wrong phrase. It works. Three things
that only showed up there:

- **"1 memories are still at …".** A brand-new install holds exactly one memory — its
  identity core — so that is the sentence somebody leaving after five minutes actually
  read. `memories(n)` now says "1 memory".
- **The preview promised a backup it did not take.** On a re-run where the hooks were
  already right and only the registration was missing, it said "5 hooks ->
  ~/.claude/settings.json (backup first)" and then correctly took none. The clause comes
  from the plan now, not from the verb.
- **A terminal that reports ZERO columns is laid out at 30.** `ui.ts#terminalWidth` floors
  a finite number at `MIN_WIDTH`, and a fresh pty starts 0×0, so every line folded to
  thirty characters. A real terminal reports its real width, so this is not a bug anyone
  will meet — but `columns: 0` means "I do not know", which is what `FALLBACK_WIDTH` is
  for, and it is a one-line change in a file this piece does not own. **Left for D**, and
  written down here rather than fixed in passing.

### The adversarial review, and what it cost (2026-09-21)

One blocker, three majors, eight minors, against the branch at `5680022`. Every one of
B1, M1, M2 and M3 was reproduced again in a throwaway HOME before a line was changed;
`repro.sh` and `repro2.sh` in the session scratchpad are the two harnesses.

**B1 is the one worth remembering, and the lesson is not about uninstall.** The owner's
ruling says "`--park` moves `~/.counterparts` aside". The code read that as "the directory
the configuration sits in" — and `install --config <path>` is the supported way to put a
configuration anywhere at all. So the review pointed one at `~/.claude` and watched this
command rename Claude Code's settings, its project transcripts and its todos away under a
heading that said **"Your memory, parked"**; then pointed one at `~/Documents` and watched
`--delete-memories` destroy `taxes/` and `photos/` after warning about **one memory**.

The mistake was naming the subject by its LOCATION. A directory is whatever somebody put
in it; a list of filenames is a thing this package can actually be said to own. So the
subject is now `ownedNames` + `ownedKind`: the configuration and our own temp and backup
siblings, the credentials file the configuration names, `scopes.json`, the `snapshots/`
this layout owns, and the store at `dataDir`. The directory itself is acted on only when
`readdirSync` of it turns up nothing else — which is the ordinary `~/.counterparts` and
keeps it one atomic rename — and otherwise it is left, our entries go one by one, and the
foreign names are printed. Four directories are refused whatever they hold: `~/.claude`,
the home, any parent of it, and anything with a `.git` in it.

**The generalisation, for whoever writes the next destructive verb here:** name what you
own, then check that the ground holds nothing else. Do not name a place and assume it is
yours.

**M1 was the same error facing the other way.** `dataDir` can point anywhere, so the store
is not reliably "in there" either: the command counted the memories at `dataDir`, deleted
the configuration directory without them, and told the person their memory was gone while
it sat intact on disk. Both halves of that are sentences somebody acts on — one is a
privacy claim, the other is "nothing can bring it back" when everything can. The store is
now its own entry in the plan, under its own ring, and the closing lines name what actually
went rather than what the verb is called.

**M2 and M3 are the same shape as each other: a guard that could not tell "no" from "I
could not ask".** `unwire` reported `ok` when `claude` was missing, so the irreversible arm
ran and left a registration pointing at a store that no longer existed — the exact failure
this file already refuses to allow for the hooks. And `realProcessLister` answered `[]` for
a missing `ps`, a timeout and a sandbox that refuses process listing, so a box with no `ps`
parked a store and said nothing about not having looked. Both now carry the distinction in
the type: `WireResult.mcpConfirmed`, and `ProcessSighting.looked`. `--nothing-is-open` is
the way past the second — the same flag and the same meaning `start-fresh` gives it — and
it never excuses a check that found something.

**One correction the repro caught on the way.** The first cut of the MCP pre-flight asked
for `claude` unconditionally, which refused every `--park` on a box that had never wired
anything. It bites only when a registration is actually on disk now. A guard that fires on
the innocent case is one people learn to work around, which is the same sentence
`commands.ts` already makes about `COUNTERPARTS_CONFIG`.

**m1 is the only minor with a design in it.** `HOOK_COMMAND_MARK` answers the question
`doctor` asks — is a hook of ours installed on this event? — and it is right that it
matches `~/bin/log-start.sh && counterparts-hook`, because that line really does run our
hook. It is the wrong question for a WRITE: `wire` overwrote that wrapper with ours alone
and `unwire` deleted the other one outright. `isOurHookCommand` is the write-side question,
and it is exact: our runtime and our hook script, or the shim, optionally `--config <path>`,
and nothing carrying a shell operator. A wrapper is left alone in both directions and named
in one line. The two are held to each other by a test in the direction that matters —
everything `wire` writes matches both — so a hook we installed can never read as missing.

**Declined:** m7 (`terminalWidth` flooring a zero-column terminal at 30) stays with the
docs builder, as the coordinator directed. The five NITs are not addressed here; n3 and n4
are real and small, and n1's re-serialisation is the documented cost of editing JSON.

**Three more the second look caught, all inside M2's own guarantee.** They are worth
naming together, because they are one mistake in three costumes — *a check that answers
"fine" when it could not actually tell*:

- `unwire`'s re-read treated an UNREADABLE `~/.claude.json` as an absent registration
  (`readMcp` reports `present: false` for a file that will not parse), so a corrupt host
  file plus a missing `claude` confirmed a deregistration that never happened.
- The pre-flight tested only `missing`, so a `claude` that HUNG (a `spawnSync` timeout
  comes back `missing: false, code: null`) or exited non-zero passed it — the hooks came
  out and the refusal landed thirty seconds later on the removal instead.
- The cross-device check ran over `plan.entries` rather than `plan.targets`, so the
  directory that actually gets renamed when it moves whole was never checked at all.

**What is still open, and deliberately.** A store OUTSIDE the home refuses both moving
arms with no way through, because `uninstall` refuses `--dir` the way `start-fresh` does.
The coordinator's M1 wording allowed "an explicitly named `--dir`"; the shape that would
close it without reopening the `--dirr` scar is to accept `--dir` on `uninstall` only when
it is EQUAL to `resolve(config.dataDir)` — an assertion about the store the configuration
already names, rather than a second answer to which store. Not built here.

  written down here rather than fixed in passing. **Fixed 2026-09-21** (the docs piece,
  which was handed the one line): a floored `columns` at or below zero returns
  `FALLBACK_WIDTH`, and the floor is kept for a width a terminal really reported — 4 is an
  answer, 0 is the absence of one. `test/ui.test.ts` holds both halves.

## 2026-09-22 — Esc on every prompt, and the two `uninstall` screens (items 8 and 13)

From the owner's 0.2.0 trial, where the five rendered screens in
`docs/new-user-findings.md` are the acceptance criteria. Two findings drove this piece:
**#21**, "once the typed-phrase prompt is up there is no visible way out", and **#22/#25**,
the pasted `mv` one-liner and the `fail` tag in front of a warning.

**`node:readline` is gone from `bin/counterparts.ts`.** The ordinary line prompt is
`ui.ts#echoPrompt` — the hidden reader's own character loop, echoing. The reason is one
word long: `readline` hands back a LINE and nothing else, so a terminal it owns cannot
tell an Escape from an arrow key, and Esc is the way out of every prompt now. Everything
`readline` was doing the loop already did, review m4's two endings included — a Ctrl-C and
a stdin that closes under the question both reject rather than resolving as an answer
nobody gave. `hiddenPrompt` and `echoPrompt` are now two dresses on one `rawPrompt`, which
is what keeps "Esc cancels" from being implemented twice and drifting.

**A bare ESC cannot be recognised when it arrives** — an arrow key starts with the same
byte. So an ESC with something after it in the same chunk is the head of a sequence, as
before, and an ESC that ENDS a chunk starts a 50 ms timer that the next byte clears. The
timer is armed only for a stream that says it is a terminal, and cleared on every exit
path, so it can neither fire late nor hold the process open. A scripted console never
meets it: nothing binds this reader off a terminal.

**One sentinel, four meanings.** A cancelled read comes back as one raw ESC byte
(`PROMPT_CANCEL`) through `Io.prompt`'s ordinary string, rather than as a second channel or
a nullable return — so every console that knows nothing about cancelling is unchanged, and
each asking function decides what cancelling means for it: `confirm` is no (and not one of
its two attempts), `typed` is `"cancelled"`, `ask` throws `PromptAborted("cancelled")`,
`askHidden` is the empty answer that prompt already calls a skip. The hint on the tag is
OPT-IN (`ConfirmOptions.hint`): on `Add an Anthropic key? [y/N]` Esc, Enter and `n` are the
same answer and the hint would be noise on the busiest screen in the package.

**`typed` returns three things now**, and that is the whole point: somebody who stopped and
somebody who mistyped get different sentences and different exit codes — `Cancelled.
Nothing was deleted.` at exit 0, `That was not DELETE MEMORIES. Nothing was deleted.` at a
refusal. An empty Enter used to be a mismatch, which told a person who had decided against
it that they had typed the phrase wrong.

**The two screens.** `~/…` for home paths (`wire.ts#tilde`, on screen only — every refusal
still prints the absolute path, because a refusal is a thing somebody has to act on); the
count moved off its own `WARNING:` line and onto the line of the thing it counts (`your
memory — 32 memories, 2 journal entries`), leaving the warning to say the one thing the
list cannot; `ui.ts#warning`, a red word rather than a `fail` tag; and `--park` printing
the DESTINATION before it asks, which means working the dated suffix out twice — once for
the preview, once at the rename — and reporting the names that were actually used, so a
`-2` from a collision is visible rather than assumed.

**The guarded `mv` left the screen.** The way back is `counterparts install`, which finds a
parked folder beside a missing one and asks (item 11, another builder). The shell line is
not gone — `start-fresh.ts#guardedMove` still writes it and `test/start-fresh.test.ts`
still proves the guard by running it against a destination that exists — but it belongs in
`counterparts help uninstall`, where somebody looking for it can read it whole.
**`help.ts#COMMAND_DETAIL.uninstall` is not this piece's file, so that paragraph is an ask
rather than a change**; until it lands, the only documented undo is the `install` that
item 11 is building. `tools/install-loop/run.sh` looked for `REFUSING` on the park screen
and looks for `To bring it back later` now.

**Driven on a real pty** (`python3 pty.fork()`, a throwaway HOME, the reader alone —
nothing near a store): while the prompt is up the terminal reads `ECHO=off ICANON=off
ISIG=off`, a partial line arrives before Enter (so raw mode is really on), backspace writes
`\b \b` and erases, a paste arrives whole, an arrow key leaves nothing behind, a bare ESC
comes back as the sentinel after the wait, and Ctrl-C rejects with `cancelled.` — with
`ECHO`, `ICANON` and `ISIG` all restored afterwards in both endings.

**Still open, deliberately.** `start-fresh`, `start-fresh --undo`, `remove` and
`migrate-cache` roll their own `io.prompt` calls in `commands.ts` rather than calling
`typed()`, whose docstring claimed otherwise until today. They now receive the sentinel on
Esc, which does not match their expected word, so they refuse and change nothing — safe,
but "refused: the confirmation did not match" is not the sentence item 8 asks for. Those
prompts belong to the builders who own those commands.
## 2026-09-22 — `remove` gets a front door (owner's answer 7)

The 0.2.0 trial's complaint was not about what removal does; it is that the only way in was
an id, and a person who wants a thing gone does not have one. So `counterparts remove` at a
terminal now asks — "Memory id, or words to search for:" — searches the lexical index on
the words, numbers what it finds, takes `3` or `1,3` or `1 3`, lists the chosen memories
back by title, and asks ONCE: `Delete these N memories for good? [y/N]`.

**Nothing in `removal.ts` moved.** The plan/`requested`/`dark`/chase order, the seventh
surface, the journal echo, the two reclaims — untouched. What was added is one function,
`removalRefusal`: step 1 of a plan (the four ways an id is not removable) EXTRACTED from
`planRemoval`, which now calls it. The picker needs that question answered twice before
anything is planned — once to decide which search hits it may offer, once over the pick —
and both of those are over several ids at a time, where step 2 (reading the body, the
contamination scan, the bounded episode scan) is the expensive half answering a question
nobody has asked yet. An extraction, not a second rule: a candidate the picker offers is a
candidate the plan accepts, because they are the same four lines.

**Three decisions worth the ink.**

- **Which door, decided by `isInteractive` — and the first answer was wrong.** The door
  opened on `io.prompt === undefined`, reasoning that `bin/counterparts.ts` binds the prompt
  on `process.stdin.isTTY` and that this was therefore already the console's answer to "is
  anyone there". It is stdin's answer, not the console's, and the adversarial review took it
  apart on the one command that can least afford it (B1): with **stdout redirected** the
  question `readline` writes goes into the FILE, so `counterparts remove <id> > log` asked
  nothing the person could see and deleted the memory on the `y` they were typing for
  something else; a CI job with a pty got a live delete where it had always got a dry run;
  and `remove <id> | cat` took the interactive door, which left no way at all to see the dry
  run that `--strike-by-content-across-scopes`'s own help tells you to look at first. The
  test is `isInteractive(io, env)` now — the same one `install` and `credentials set`
  already split on: a prompt, BOTH streams a terminal, `CI` unset. The lesson is small and
  general: *the destructive command may not use a weaker test for "is anyone there" than
  the commands that are not.* `--confirm`, and anything that test turns down, runs byte for
  byte what it ran before — there is a golden test on the scripted door's whole output now,
  because three `toContain`s could not have caught a reword.
- **The listing prints titles, and that is not §16 G15.** The contamination scan returns
  ids only because it matches OTHER memories against the doomed body — printing those
  re-leaks the words being erased. This list runs the other way: it is the answer to words
  the person typed a moment ago, about memories they are deciding whether to keep, and a
  numbered list with no titles is a list nobody can choose from. The report after the yes
  still prints no body, and neither does the record.
- **A pick is refused whole.** `1,9` on a list of three is somebody who misread the list,
  not "remove 1" with a stray character; acting on the half that parsed would delete a
  memory on the strength of a typo. One re-ask, then stop — the rule `ui.ts#confirm`
  already uses, except that this one stops rather than taking a default, because there is
  no safe default for *which of these do I delete*.

Every way out that is not a removal says `Cancelled. Nothing was deleted.` on stdout and
exits non-zero, so a wrapper can never read a cancel as a removal. An Esc or a Ctrl-C mid
question arrives as `PromptAborted` and is caught into that same sentence. The cancel tests
all assert the same pair: nothing on the deny-list, and not one row in the removal record —
`requested` is written before anything moves (§16 G10), so an empty record is proof the
destruction path was never entered rather than entered and turned back.

**What the adversarial review changed besides the door.**

- **The sentence over a removal (M1).** The refusal after a re-plan chose its words from a
  COUNT of what had already gone: `removedSoFar === 0` printed the single-target door's
  *"Nothing has changed."* — which reads "none gone yet" as "none will be". On a refusal on
  the FIRST of two picks the console said nothing had changed and then removed the second.
  The door is passed as a fact now (`"scripted" | "picked"`), the picked form names the id
  and claims nothing about the rest, and a **tail line** — `1 of 2 removed. The 1 not
  removed is untouched, and named above.` — is the only sentence in a position to be true
  about the whole batch. A refusal does not stop the loop: the person confirmed those
  memories, and the ordinary cause (another session got there first) says nothing about the
  others. The race is testable without a second process — the console's own answer to the
  confirm runs a nested `remove --confirm`, which is exactly what another session is, since
  everything this door holds is closed before the question.
- **The plan before the yes (M3).** The interactive door showed titles and asked. The
  person at the terminal is the LESS expert caller and was getting strictly less than the
  scripted one — sharpest with `--strike-by-content-across-scopes`, which this door honours
  and which chases a body through every project's buffer on the machine. `printRemovalPlan`
  is shared now and prints above the question.
- **Confidential memories (m1).** The list fell back to 64 characters of BODY for an
  untitled memory. `export` omits confidential memories by default *even for the owner*;
  this list may not be the one owner-facing surface that prints one unmarked. They are
  `[confidential]` and `(untitled)` now, kind and date and nothing of the words.
- **Smaller:** refused and failed are different exit codes again (m2); several ids on the
  command line are several ids rather than a search string (m3); a trailing space is
  trimmed by both doors (m4); an uppercase id is not an id, because lowercasing before a
  lookup would let one typed string become a different row's id (n1); `1,` is refused, the
  way the "refused whole" docstring always claimed (n3); and the truncation notice is the
  search's own answer rather than a length compared to a constant (n4).

**Not fixed, deliberately:** the "that looked like an id" hint (n2). There is nothing to
point at — a string typed at the question is read the same way as one on the command line,
so the hint would have to name an escape hatch this door does not have.

## 2026-09-22 — the round, in one place (the coordinator's pass)

The two entries above are the first and the last of six pull requests that landed on one
day, from the owner's 0.2.0 trial: he took the tarball into a plain terminal with no help
and nothing broke, so what came back was eleven complaints about **words** (findings 17–27
in `docs/new-user-findings.md`), answered one at a time, with five rendered screens as the
acceptance criteria. What the six did:

- **#170, D — `remove` gets a front door.** Its own entry above.
- **#171, A — Esc on every prompt, and the two `uninstall` screens.** Its own entry above.
- **#172, C — `doctor`.** A fourth grade word, `OFF`, carried as a flag on amber rather
  than a fourth severity (CONTRACT 38); two OFF lines where there had been five findings,
  so one skipped optional key is one line and not three ambers; the internal greens folded
  into one `Background` line on a terminal, with `--all` to unfold; every fix line a
  command. `--json` gained `optional: true` and split counts, and stayed complete and
  unfolded.
- **#173, E — `install`.** No step numbers, the store step silent, Claude Code **connected
  by default** (this replaces ruling 1 of 09-21: preview-then-ask), keys one at a time with
  `[y/N]` first, and `install` as the undo of `uninstall --park` (CONTRACT 37). `credentials`
  bare lists the names it holds; `credentials set VOYAGE_API_KEY` offers the embedder the
  way install does, which is what makes doctor's fix line true.
- **#174, B — the help page, and the names.** Fourteen commands in three groups, the rest
  under `counterparts help advanced`, and `help.ts` now accounts for every dispatched
  command in exactly one of three tables — the third demands a reason in words, so a
  command cannot be hidden without a reviewer reading the sentence that hides it. `ask` is
  the listed spelling of `recall`; `wire`/`unwire` became `connect`/`disconnect` with no
  aliases (neither had shipped); `dashboard` and `--version` are new; a bare `counterparts`
  offers setup on a terminal and prints the help page everywhere else.
- **#175, F — the follow-ups** A and E could not make in each other's files: the three
  hand-rolled confirmations routed through `typed()` (which closes the "four prompts are
  not covered" paragraph in CONTRACT 36), and the help text for `install`, `credentials`
  and `uninstall` — including the two keys' egress sentences, which left the install screen
  with the rest of the long form. *A product that stops saying where text goes has stopped
  being able to say it*: they had to land somewhere, and `help` is where.

**Two adversarial reviews, two blockers, and they rhyme.** Both are the same shape: a new
door reached a destructive or destructive-adjacent path with a weaker guard than the old
door had.

- **#170's B1** — the interactive door opened on `io.prompt === undefined`, which is
  stdin's answer to "is anybody there", not the console's. With **stdout redirected** the
  question went into the file and `counterparts remove <id> > log` deleted on a `y` typed
  for something else; a CI job with a pty got a live delete where it had always got a dry
  run. The test is `isInteractive(io, env)` now — the same one `install` and
  `credentials set` already use. *The destructive command may not use a weaker test for
  "is anyone there" than the commands that are not.*
- **#173's B1** — `install --force` at a terminal silently replaced `claude-code.json`,
  dropping `identity`, `embedder` and a chosen budget: the interactive arm injected a
  budget whenever none was given, and the new `quiet` option had removed the `replaced …`
  receipt. Harmless enough as an old wart; a blocker because the **restore path is new**,
  so it could throw away a configuration the person had just been told came back
  untouched. The injection is conditional on the configuration not existing now.

Neither review is a file in this repository — they were posted as comments on PRs #170 and
#173, which is where the fixes are too.

**What did not change, and is not pretending to have.** #26 (the store measured 6.7 MB in
one plan and 1.4 MB in another a minute later) was not investigated; the most likely cause
is still a checkpoint or the worker finishing between two runs. #28, the Stop ask's
verbosity, is explicitly the next round. And `Everywhere` is still the label over the three
global flags on every command's help page — the rest of #27's list went, that one stayed.

## 2026-09-23 — the small fixes from the 0.2.0 trial (roadmap B2)

Six items the owner agreed on 2026-09-23, one PR. What each one does now:

- **The uninstall wait.** Both moving arms print `Checking Claude Code…` (and a blank
  line) immediately before the pre-flight spawns `claude mcp list` — on a terminal only,
  and only when there is a registration to check, so somebody who never connected is not
  told about a check that does not happen. `spawnSync` blocks, so it is one static line;
  a spinner was ruled out on 09-22. Driven on a real pty (an ad hoc `python3 pty.fork()`
  harness around `run()` with a stub `claude` that sleeps two seconds — the "pty helpers
  from the 09-22 round" were never committed, so there was nothing to reuse): the line is
  on screen at 0.05 s, the plan at 2.06 s.
- **Doctor's `no-credential` fix line** is the command:
  `Run: counterparts credentials set ANTHROPIC_API_KEY`. Every other sweep stand-down
  reason keeps "The sweep stood down; the reason names why." — what fixes those depends
  on the door the row names. *Left for the owner:* on a store that never had the key, this
  amber and the `OFF  Crash write-up` line are now two lines about one optional key —
  the #24 shape. Whether a keyless sweep should read OFF rather than amber is a grading
  decision, and the keyless round (C3) is the one about to redraw that screen.
- **#8 for stores 0.1.0 made.** With neither `store.created` nor `store.started`, the
  window doctor STATES falls back to the EARLIER of two readings: the smallest event
  `at` (`eventLogCensus().oldestAt` — the moment a row was written, which answers the
  old objection that `rowDate` prefers a payload's own date; and the smallest, not the
  first row by insertion order) and the database file's birth time (zero, or a birth no
  earlier than the change time, is "no answer"). **Corrected after the review of #188
  (M2): both readings can make a store look YOUNGER, not older.** Each is the latest day
  the store could have begun — `install` writes no event, so an installed-but-idle store
  has its first row days after it began, and a restored copy is born the day it was
  copied. Taking the earlier of the two answers the idle case; a store both restored
  from a copy AND idle before its first row still gets a label that starts late and
  hides those idle days. The reading is untouched either way (`windowShown` moves only
  the words); event pruning adds no case, because a row goes only at 90 lived days.
- **`help`'s Advanced group — already done.** The "collapse to a comma list, 39 → ~31
  lines" item was written 2026-09-21 (commit `ae1021d`) against the page before the 09-22
  split, which moved the whole Advanced group to `counterparts help advanced`. The short
  page has had no Advanced group since and is 26 lines, so there was nothing to collapse,
  and collapsing `help advanced` instead would have thrown away the one-liners finding
  #18 asked for. The test now asserts exactly 26 lines and that `shortHelp()` is
  byte-for-byte the "Help page" block in `docs/new-user-findings.md` §"The screens".
  (The brief said the screen was quoted verbatim in this CONTRACT and in QUICKSTART;
  it is quoted in neither, so there was nothing there to amend.)
- **NITs n1–n4** (`docs/adversarial-review-onboarding-ab-2026-09-21.md`): a settings file
  keeps its indent, line endings and final newline (CONTRACT 22); a BOM, comments and a
  trailing comma are refused BY NAME with what to do (CONTRACT 23 — still refusals, and
  nobody has checked what Claude Code itself accepts there); the re-read after the
  question decides whether to write, so work another process did meanwhile is not redone
  (CONTRACT 21); `writeCredential` and `enableEmbedder` write through `<path>.<pid>.tmp`
  — the one suffix `uninstall.ts#ownedKind` already counts as ours — and remove it when a
  write fails. **n5 was already gone**: the 09-22 screens replaced "Your memory, parked"
  with "Set aside" and took the census off the park arm; a test pins that the screen
  claims no memory when none moved.

**What the review of #188 changed** (no BLOCKER, no MAJOR; four MINORs, all taken):
M1 — the line ending is the majority's, not "is there a CRLF anywhere", so one pasted CRLF
line no longer converts an LF file (bare-CR files keep CR, and spaces after the last
newline still count as a final one). M2 — the #8 fallbacks take the earlier reading and
say which way they can be wrong (above). M3 — `wire.ts#jsonNoise` is one pass that knows a
string from a comment, so a single-quoted file is named as single quotes rather than as
comments. M4 — `keys.ts#writeTarget`: a symlinked `credentials.env` or configuration is
written THROUGH to the file it points at, atomically and at the right mode, and the link
survives; a dangling link is refused by name and nothing is created (unlike `wire.ts`, a
target outside the home is not refused — it is the person's own secret, linked where they
keep it). And from the NITs: the delete arm's count now comes after the sizes it prints
(`uninstall.ts#counted`, pinned by a test that makes the count's open fold the log);
`walBytes` counts only `<name>.sqlite-wal`; the help golden names
`docs/new-user-findings.md` in its title and failure message; CONTRACT 22 lists the
content the parser changes, not only the layout, and CONTRACT 28 says "never opens the
store" is true of this process only — the pre-flight's health check is a writer open.

**Two NITs left, named so they are not mistaken for missed:** `wire` on a settings file
that VANISHED while the question was up writes a new hooks-only file (no backup, outcome
`ok`) — pre-existing, and a refusal there is the likely right answer for whoever next
touches `wire`. And `test/cli.test.ts` › "NEW-MINOR-6: an abandoned scratch in the TEMP
dir is swept" is FLAKY under the full suite: it shares `$TMPDIR/counterparts-export-*`
with any export running at the same moment in another test file, and failed once in the
reviewer's full run (218/0 alone). Pre-existing, not touched here; the fix is a scratch
root of its own per test.

### #26, the two sizes — the cause, measured

The owner's trial: the store was 6.7 MB in the `--delete-memories` plan and 1.4 MB in the
`--park` plan a minute later. **Both arms always walked the same files with the same
`dirSize`.** What changed was the ground, and specifically the store's write-ahead log.
Measured on throwaway stores, bun 1.3.10, macOS (Apple's SQLite 3.39.5):

1. **Our processes leave the `-wal` behind at its high-water size.** `store/db.ts`
   prepares a fresh statement for every call and never finalizes one, so bun's `close()`
   cannot run SQLite's last-connection checkpoint-and-truncate. A `Store` that wrote 300
   rows and closed cleanly left a 2.19 MB log on disk, before and after the process
   exited; a writer killed mid-session (the way a host ends a server) left 3.8 MB.
2. **That log can hold data the database file does not have yet** — a store whose
   `counterparts.sqlite` was 4 KB carried everything in 3.4 MB of log. So leaving the log
   out of the number would be the dishonest fix; it stays in.
3. **Reading changes nothing.** The delete arm's count (an observer open), doctor on the
   main database, and both plans left the log exactly as it was.
4. **The first run's own pre-flight folded it.** `claude mcp list` starts our MCP server
   as a health check. A health-check-shaped session against a throwaway store —
   `initialize`, `tools/list`, stdin closed — took the log from 3.8 MB to 0 and the
   database from 2.9 to 3.3 MB. The delete plan had been sized BEFORE its pre-flight; the
   park plan a minute later was sized after that fold. (Whether `claude mcp list` ends the
   server exactly that way is not measured: a session never runs it, because it would
   start our server against the owner's live store. The shape and the numbers match.)
   Why the server's exit folds the log when a plain `Store.close()` (point 1) does not —
   it closes through the same `counterpart.close()` at end of input — is observed, not
   explained here. The fix does not depend on the why, only on the WHEN, and the when is
   pinned: between the first plan's sizing and the second's.

**The fix.** Both arms now take their sizes at the same point — after the pre-flight,
right before the plan is printed (`uninstall.ts#remeasured`, `lstat` and `readdir` only, so
this process still never opens a store it parks; the pre-flight's health check, in another
process, does) — and the delete arm counts (`counted`, an observer open) only after that. The number is every byte under the path, log included. When the log is a megabyte
or more and a tenth or more of the store, both plans say so in the same two lines:
`5.3 MB of that is a database log that shrinks on its own; / nothing is lost when it
does.` A fresh store's log is a couple of hundred kilobytes, so the owner's screens are
unchanged there, and `counterparts help uninstall` says what the sizes are.

**For whoever owns `store/` next** (not this module's to change): finalizing statements,
or caching them and finalizing at `close()`, would let every clean close fold its own log
and the stores would stop carrying megabytes of stale log between sessions. Nothing is
lost today — the next writer reuses the log — but the size a person sees depends on which
program happened to touch the store last.

## 2026-09-23 — keyless surfaces (roadmap C3)

The owner's decision of 2026-09-23: install asks about **neither** key, and the static
tier is primary while Voyage is frozen (ROADMAP §"Amendments"). What the build learned:

- **The kind has to be decided against the file being replaced, not against the flag.**
  `--embedder` used to write `{ enabled: true }`, which reads as Voyage because absent
  `kind` means voyage (`config.ts#embedderKind`). So `install --force --embedder` over a
  static configuration flipped it (review of #190, MINOR 4). *Revised after the review of
  #195 (MAJOR 1):* keeping a named or implied Voyage kind "on or off" meant `--embedder`
  over an OFF Voyage block switched the paid embedder ON under a doctor line that promised
  the local table. Now a Voyage kind survives turning it ON only when the replaced block
  was already ON (`{enabled:true, kind:"voyage"}`, or kind-less `{enabled:true}` beside a
  saved key); any OFF block comes back ON as `"static"`. Turning it OFF keeps the recorded
  kind, so ON again is an OFF block going ON — the table. Trapped-`fetch` tests follow the
  fix line from all three OFF shapes and count zero network calls. The Voyage-key test reads the credentials FILE
  (`credentialsHeld`), never the console's environment — the hooks' source, not the
  shell's.
- **The terminal default applies only to a configuration being CREATED**, for the same
  reason the ceiling default does (review B1 of 2026-09-22): an injected value on a forced
  re-install would count as "supplied" and beat the carry-forward. *Superseded for the
  0.2.0 case the same day:* an absent block now reads as the table ON at runtime unless a
  Voyage key is saved (CONTRACT 41, `config.ts#resolveEmbedder`), so the owner's config
  and every other 0.2.0 install need no step. `install --force --embedder` is the way
  back after `--no-embedder`, and the fix for a 0.2.0 setup beside a saved Voyage key.
  **A lighter `embedder on|off` command would be kinder than `--force`**; not built,
  because it adds a command to the owner's help page.
- **The default lives beside the reader, not in it.** `loadConfig(raw)` never sees the
  credentials file — it is named BY the configuration — so each process applies
  `withEmbedderDefault(config, voyageKeySaved)` after `loadCredentials`. Four seams
  (hook, worker, server, console), each one line; doctor re-resolves. Deciding inside
  `openEmbedder` from `process.env` was rejected: the owner's shell exports the key and
  the hooks inherit no shell, so an env rule could put the hooks on the table and the
  server off it.
- **The review of #195 (MINOR 3–5, NIT 7), in this file's terms.** `hostConfigFor`
  and `doctorCommand` read only the `credentialsFile` a configuration names; the
  Voyage-key line knows the one OFF case (`voyageKeyLine(config, source)`); the pin is
  written before the key; `setConfigKeys` keeps the file's layout through `wire.ts`'s
  `sniffSettingsFormat`/`settingsBytes`, except that a one-line configuration stays on
  one line (for `settings.json` a one-liner is the host's `{}`; for a config it is a
  person's choice).
- **Go-public Phase C walk (2026-09-23):** QUICKSTART's scripted install gains
  `counterparts connect` (the scripted arm prints the hooks block and applies nothing).
  `--budget 9000` STAYS on that line: the scripted arm invents no ceiling (scar §2.18)
  — only the conversation writes 9000 — so dropping the flag would leave the wake
  unbounded. `package.json#homepage` is `https://counterparts.ai`.
- **A first Voyage key would have switched the default off.** `credentials set
  VOYAGE_API_KEY` into a block-less configuration now writes the static block first
  (`pinLocalTable`) and says so, on both arms.
- **"Found" means the table FILE**, in install and in doctor's no-row path: a
  `COUNTERPARTS_STATIC_WEIGHTS_DIR` naming an empty folder resolves by name and holds
  nothing. Tests pin the answer with that variable (a folder with or without
  `model.safetensors`), because otherwise it depends on whether the weights package
  happens to be installed in the checkout's `node_modules`.
- **`keys.ts` shrank.** `promptForKeys`, `askForKey`, `offerEmbedder`, `enableEmbedder`,
  `embedderFixLine`, `KEY_QUESTIONS`/`KEY_LINKS`/`KEY_REASONS`/`KEY_PREFIX` had no caller
  left and asked about or switched on Voyage, so they went, with their tests. The atomic
  config edit is now `setConfigKeys(path, patch)`, used by the one upgrade a key still
  offers (`offerCrashWriteUp` → `"crashWriteUp": "api"`, C2's knob, confirmed on #192).
- **The weights package is the first runtime dependency, and it is not published yet.**
  Until `counterparts-model-potion` is on npm, `bun install` in this repo and `bun add -g`
  of a packed tarball both fail resolving it (measured: `GET
  https://registry.npmjs.org/counterparts-model-potion - 404`). `bun.lock` is deliberately
  NOT updated in this change — a lock entry for an unpublished tarball would pin an
  integrity the published one may not match; the first `bun install` after publishing
  writes it. The install loop was run against a one-package local registry serving the
  real 0.1.0 tarball (`NPM_CONFIG_REGISTRY`), which bun honours for global installs.
- **Doctor's green order** now puts `embedder` and the crash write-up right after
  `Claude Code` (`report.ts#GREEN_ORDER`): a fresh terminal install has recall by meaning
  on, and its line belongs beside what it depends on. `HEADLINE`/`GREEN_ORDER` list both
  `crash-writeup` (today's key) and `crash-write-up` (#192's), so the line stays on the
  screen whichever lands first.
