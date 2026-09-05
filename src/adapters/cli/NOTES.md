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

## Verified live? No

Every test runs against a temp store. Per CLAUDE.md's definition of done this is
**merged, not verified**: the outstanding proof is one real snapshot of a real
store, restored and read.
