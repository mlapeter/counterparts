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
