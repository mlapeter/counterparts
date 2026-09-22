# `adapters/cli/` — CONTRACT

## 1. Purpose

The `counterparts` command: status, install, and the owner-only operations — removal,
export, backup and restore — that no model-reachable path may perform.

## 2. Brain analog

None, and deliberately so. **Named deviation** (constitution line 12): humans have no
console on their own memory — no inspection of every unfalsifiable anchor, no deliberate
erasure, no export. This module is the improvement over the biological original that
constitution lines 4 and 6 promise: the self is **governed and owner-visible**, and the
owner owns the data.

## 3. Keeps

- **Destruction lives in exactly one place, and a caller-universality test pins who may
  reach it.** [v1] behavioral-spec §16 G1–G2, earned-mechanism #14 — *no model-reachable
  path may import it, and that test failing is the point.*
- **Removal is recorded, and the record is canonical, append-only, and carries no body and
  no content hash.** [v1] §16 G7–G9, scar §2.20 — a hash of low-entropy content is
  brute-forceable, which would make the record of removal a leak of the thing removed.
- **Removal is ordered so every crash point is safe** — at each moment the memory is fully
  alive, or dark *and recorded* — and a failed record append means nothing moves. [v1] §16
  G10–G11.
- **Everything that must READ the doomed content happens before anything is chased.** [v1]
  §16 G13 — v1 named this bug: chasing copies first made every span unidentifiable.
- **Chase every surface, including the derived association graph.** [v1] §16 G14 — an
  erased id left in the learned graph keeps *conducting* activation between its former
  neighbors. **The surfaces on the rows floor are: the row and its versions (blanked in one
  transaction), the edges, the prospective windows, the gate rows, box 3, both databases'
  write-ahead logs and freed pages, `remember/`'s span buffer, and — since 2026-09-20 —
  `journal/`, the episode journal's derived markdown copy.** Each is named in the report at
  its count, **including at zero**: a surface that is silent when it is empty is the silent
  partial success below. A copy the chase cannot reach is named under `unchased` with a
  sentence saying what is still where; a chapter of the counterpart's own journal that
  merely QUOTES the removed words is named under `leftAlone`, by episode id, the way a spans
  echo is — nothing failed to be reached, and removing an account of a day is its own
  decision with its own id.
- **No silent partial success**, and a contamination scan returns **ids only** — printing
  the matches would re-leak exactly what is being erased. [v1] §16 G15.
- **Removal targets are restricted to memory-bearing roots.** [v1] §16 G16 — the archive,
  backups, the graph, and the removal record itself are never nameable targets, so a typo
  cannot point removal at the record of removal.
- **A removed memory cannot be silently resurrected**, via a deny-list consulted at load
  and rebuild; a stray copy is skipped and logged, never deleted. [v1] §16 G12.
- **Catastrophe is covered separately, cheaply, and non-fatally**: rotated local snapshots,
  an **allowlist not a denylist**, never leaving the machine, never throwing. [v1] §16 G18.
- **Dry run is the default for anything destructive**, with an interactive confirmation, and
  the writer's lock taken only *after* the confirmation, then reload and re-plan under it.
  [v1] scar §2.13.
- **Wall-clock, not active days, for any cooling-off.** [v1] §16's note on the released
  ceremony — *a week of not using the machine must still be a week of second thoughts*, and
  an immediate-destroy setting was rejected in v1 because it would delete the only property
  that made the operation safe to have.
- **A machine-readable pass record that a runtime switch actually reads.** [v1] §17.2 — the
  ambient path refuses to turn on until a passing run is recorded. *The gate is not a
  document; it is a precondition.*
- **Everything permanent is enumerable and inspectable on demand — a list, not a cadence.**
  [v1] §14.1 G9, earned 2026-08-24.

## 4. Drops / simplifies

- **The staged quarantine → cooling-off → chase-every-copy erase ceremony is released**
  (owner rescope 3, settled): 871 lines, never production-fired, no designated target since
  2026-07-29. What replaces it is **plain owner-initiated removal plus a record** — loud,
  recorded, unreachable from any model path. Every guarantee in §3 survives the release;
  the staging does not.
- **Forever-archive becomes bounded versioning** (owner rescope 3, settled). Superseded
  rows retain ~90 lived days.
- **Local-only absolutism is released; the property is no silent egress** (owner rescope 2,
  settled). `export` is therefore a first-class owner operation: **explicit owner action,
  encrypted, owner-keyed**, in portable formats readable in any editor. Nothing leaves the
  machine any other way, and the core has no egress path at all.
- **Zero runtime dependencies as a vow is released.** **PROPOSED** — owner call at
  check-in. It was a proxy for constitution line 10 that already needed an exemption in v1,
  and v2 ships as a distributable package where dependency hygiene is judgment. The default
  stays zero.

## 5. Contract

**Inputs** — owner commands: `status`, `install`, `on`/`off`, `protected` (list),
`remove <id>`, `export`, `backup`, `restore`, `self-page` (2026-09-18), `start-fresh`
(2026-09-20), `wire` / `unwire` / `uninstall` (2026-09-21); interactive confirmation; the
data directory.
*`wire`, `unwire` and `uninstall` are the first commands here that write a file belonging
to another program, and `install` at a terminal now calls the first of them. Guarantees
21–35 are what that costs. Like `start-fresh` they refuse `--dir` in words: what they act
on is decided by the CONFIGURATION, because that is the file the hooks, the worker and the
MCP server read.*
*`start-fresh` is the second command in this module that asks a human before it acts, and
the first whose danger is not deletion but MOVEMENT. It resolves its store from the host
CONFIGURATION rather than from `--dir`, which it refuses in words: the store that matters
is the one the hooks and the MCP server open, and a second answer on the command line is
how the wrong one would get moved.*
*`self-page` is deliberately NOT on `OWNER_OPS`, and it is the second command with a
reason of its own for that (`scope` is the first). It both READS and writes: reading the
page must work from an instrument, because "what does my page actually say" is the first
question anyone asks when the wake looks wrong, and a stood-down console is what is running
while they ask it. The refusal therefore lives at the WRITE, inside `self/#revisePage`, in
the same sentence every other write refuses in.*
*It is also the ONLY door that unwrites a page (`--clear`) or puts an earlier one back
(`--restore <seq>`); no MCP tool reaches either. `remove` refuses the page row by name and
points here — removal tombstones a row, and the schema index reads every schema row's
prose at open, so removing the page (or the identity core, which has had the same exposure
since it shipped) leaves a store that will not open, with the wake hook swallowing the
error so the symptom is silence.*
**Outputs** — human-readable output; durable state changes for owner operations only;
snapshots and exports; the removal record; telemetry by reference.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] The destruction path is importable only from this directory**, asserted by a
   caller-universality test over the import graph. No core module, no adapter, no model
   path reaches it.
2. **[M] Destructive commands default to dry run and require interactive confirmation**,
   and take the writer's lock only after confirmation, then reload and re-plan under it.
3. **[M] Every path comparison resolves and realpaths both sides before comparing**, and no
   tool honors a pre-set data-directory environment variable when it claims a throwaway
   directory (scar §2.13 — v1's migration guard was a raw string comparison, and
   `--out ~/.bansai/` with a trailing slash pointed it at the live store and mass-wrote
   ~11K files).
4. **[M] A canonical database is backed up through the database's own backup API or
   `VACUUM INTO`, never a file copy.** A restore test opens the copy and reads a row written
   inside the pre-copy write window. **This is the sharpest scar in the list** (§2.11):
   v1 copied its SQLite file without a WAL checkpoint and it was harmless *because the
   database was a declared rebuildable cache* — and rescope 1 is precisely the removal of
   that mitigation, which promotes the same flaw to canonical-data loss.
5. **[M] Every top-level path in the data directory is either in the backup set or on an
   explicit documented exclusion list**, and adding a directory breaks the build until it is
   classified. Documentation that says "whole store" is checked against the copy list by
   that same test (scar §2.11 — v1's allowlist landed hours before the episode directory
   existed and silently omitted the canonical journal for three weeks).
6. **[M] The archive tree is deliberately excluded from snapshots** — archive-on-overwrite
   history is itself the redundancy layer, and snapshotting it copies an unbounded,
   already-redundant tree into every snapshot.
   *Correction (2026-08-25, closing the filed contradiction): as v2 shipped it, there is
   no unbounded archive tree — rescope 3 replaced it with the `versions/` directory under
   BOUNDED retention (H lived days). Bounded canonical-until-expiry state belongs IN the
   backup set, and LAYOUT says so; this guarantee's premise applied to v1's shape. The
   implementation followed LAYOUT, which guarantee 5 makes the single source of truth.*
   *Second correction (2026-09-20, the floor): there is no `versions/` directory
   either. An archived version is a ROW in `counterparts.sqlite`, so it is inside
   the database the snapshot copies through `VACUUM INTO` and there is nothing
   left for this guarantee to exclude. Still bounded, still 90 lived days — and
   the prune now deletes the WORDS rather than a note about a file (owner ruling
   1, 2026-09-18; `store/NOTES.md` 2026-09-20).*
7. **[M] `export` is the only egress**, and it is explicit, encrypted, and owner-keyed. A
   test asserts no other module opens a network socket to a non-model, non-embedding
   endpoint.
   *Extended 2026-09-20 (F7, owner ruling 4 of 2026-09-18).* It takes two shapes and the
   report names which ran: the whole store as one SQLite file through `VACUUM INTO`, or
   `--markdown`, a readable tree — one file per memory grouped by kind, the journal as is,
   the self page as its own file, `--with-versions` for every earlier wording. **Filenames
   are ids, never titles.** The markdown tree **omits confidential rows unless
   `--include-confidential`, and says how many it omitted** — in the terminal and in a
   manifest inside the tree, at zero as well, because a directory that does not say what
   is missing from it reads as complete. Removed rows are never exported; a row that will
   not render is named by its id rather than silently absent. **`--markdown --passphrase`
   is supported properly** — the tree is rendered into memory, sealed, and only then
   written, so that path has no scratch anywhere. It refuses a non-empty target unless
   told, refuses a target inside the store or a live v1 store, and refuses a store this
   build cannot open in the floor's own sentence, touching nothing on either side. One
   durable `store.export` row carries counts and flags and **not the target path**.
   *`export` is NOT on `OWNER_OPS` (2026-09-20): an export reads the store and writes
   outside it, so under `--observer` the copy is made, the durable row is not, and the
   report says which.*
8. **[M] Backups never leave the machine and never throw** — a backup problem must not
   block a consolidation cycle.
9. **[M] Reads are pure.** Inspecting the protected list or the census writes nothing and
   logs nothing; loudness about corruption belongs at mutation time (§14.1 G8).
10. **[M] The runtime switch reads a machine-readable pass record** and refuses to enable a
    gated channel without one.
11. **[A] Command names, flag shapes, and output formatting are surface** and may change
    without touching a core contract.
12. **[M] Owner-in-the-loop is a short, named list — currently two items: removal, and
    `start-fresh`.** Candidates for the list get discussed, never assumed (§14.3).
    Everything else that can be safely autonomous is. *`start-fresh` joined it on
    2026-09-20 for a reason removal does not share: what it moves cannot be checked by
    this process. A session holding the store open by a file handle goes on writing into
    the parked directory after the rename, and no cheap read can see an idle one — so the
    human is not a formality here, he is the only instrument that can answer.*
13. **[M] `start-fresh` never deletes and never opens the store it parks** — not for
    writing, not read-only. The only mutating call in `cli/start-fresh.ts` is `rename`,
    and the parked directory is proved byte-identical afterwards by a fingerprint over
    every file including the `-wal` and the `-shm` and over every directory's entry list.
    *Read-only is not exempt: under WAL, committed pages live in the `-wal` until somebody
    checkpoints them, and an opener is somebody.*
14. **[M] `start-fresh` asks the FILESYSTEM whether a store is there, never the floor.**
    "The directory exists and holds something", never `storeExists()`. *Since F5 that
    function answers true for a pre-rows store too, so the two readings now agree on an
    old-floor store — and still differ on a half-made one holding only a `cache/`, where
    `storeExists` says "no store" and would let `install` mint one beside a stale box 3.
    Proved against four directories: absent, empty, old floor, new floor, and one wearing
    both database names.* The command's only reading OF the floor is `preRowsMarkersIn`
    — filenames, never an open — and it is used to SAY which floor the parked store is
    on, never to decide anything.
15. **[M] `start-fresh` never creates a store at a path nobody named.** The cold arm's
    landing place is computed from the CONFIGURATION'S own directory and an empty
    environment, printed before it is used, pinned onto `install`, and refused if
    anything is there. *A mistyped `--config` used to fall through to
    `$COUNTERPARTS_DATA_DIR`, else `~/.counterparts/store` — the live one — and stamp it
    "began today" (N1 review B1). The `Store:` line is never blank, because a blank one
    is what let "there is no store at that path" and "Store already present at …" share a
    screen.*
16. **[M] The blank store is built before anything is parked, and arrives with one
    rename.** An `install` that refuses therefore costs a temporary directory rather than
    leaving the configuration pointing at nothing, and the window in which another
    process can mint a store at `dataDir` is two renames wide. A destination that is not
    empty at the second rename is a REFUSAL naming all three directories, never a merge.
17. **[M] The way back is printed from the plan that RAN, and every line refuses rather
    than nesting.** The date is frozen for the run; a re-read that finds the ground moved
    refuses instead of executing a plan nobody read; the block is re-printed after the
    renames and in every failure branch. *A bare `mv a b` onto an existing directory
    moves `a` inside `b` and reports success — measured — so each printed line is
    guarded, and `start-fresh --undo` does the same three moves without a shell.*
18. **[M] Both directions run ONE guard ring, and a test asserts they answer identically.**
    `start-fresh.ts#pathGuard` is present / absolute / not a forbidden root by either
    spelling / not a root / not the home directory / not holding the configuration / not a
    symlink, and every path either direction would rename goes through it. *`--undo`
    shipped as new code that ran none of the forward refusals and renamed inside a
    `~/.bansai` with no tampering at all (confirmation review BLOCKER-1). Two
    implementations of "what may I rename" is how they drifted; one function plus a test
    comparing their sentences is what stops it.*
19. **[M] A value read back out of a store is DATA, never an instruction.**
    `store.previous.parked` is a `meta` row anything with the store open can write, so
    `--undo` pins its shape (`parkedSiblingRefusal`: a sibling of the store, wearing a name
    this package writes) rather than trusting it. *Proved against the four crafted values
    the review used: a forbidden root, the store's own parent, a symlink, and a name
    nothing writes.*
20. **[M] Cut-over day is proved against a store the PINNED BUILD wrote, not a hand-made
    one.** `test/old-floor-fixture.ts` extracts `floor/v5-last` and runs that build's own
    `Store` API to produce a v5 store whose `-wal` holds the database its file does not.
    `start-fresh` parks it byte-identical, its output never mentions `STORE_PRE_ROWS`
    because nothing opened it, and the rollback lines *as printed* restore it — still
    refused by name, still readable by the build that wrote it.

### `wire` / `unwire` / `uninstall` — the host's own files (2026-09-21, A)

*Until this change, guarantee 1 of `install.ts` was "the host's files are only PRINTED".
That sentence is retired, and the thing replacing it is narrower: the host's files are
edited **after being asked**, and only ever in the two ways below. `install` at a
terminal now asks and then wires; through a pipe, in CI, in every test and in
`tools/install-loop/run.sh`'s scripted steps it prints exactly what it printed before,
byte for byte, and `--no-wire` gets a terminal the same thing.*

21. **[M] Nothing is written to `~/.claude/settings.json` without a BACKUP first, and its
    path is printed.** `settings.json.counterparts-backup-<UTC stamp>` beside the file, at
    the file's own mode. No change, no backup: a second `wire` is not an event.
22. **[M] Every other key and every other tool's hooks survive, and the merge works on
    the INNER hook entry.** Another tool's entry keeps its position, its `matcher`, its
    `timeout` and every key this package has never heard of; an event we do not use is not
    read; a group shaped in a way this does not understand is carried through whole. A
    wire followed by an unwire returns the document deep-equal to what it was.
23. **[M] A settings file this cannot read is a REFUSAL that changes nothing.** Bytes that
    are not JSON, a top level that is not an object, a `hooks` key that is not an object,
    an event whose value is not an array, something that is not a regular file, or a
    symlink pointing outside the home directory. Each prints the block for hand-merging
    and leaves the file hashed-identical.
24. **[M] The write is atomic and keeps the file's mode**: a temp file in the same
    directory and one `rename(2)`. A symlinked settings file is written THROUGH to its
    target (only when the target is inside the home), so the link survives.
25. **[M] An entry that is recognisably OURS but names another path is REPAIRED, not
    duplicated**, and the old command is printed. The recogniser is
    `install.ts#HOOK_COMMAND_MARK` — the same one `doctor`'s `readHost` uses, so a wired
    install can never read as unwired on the surface a person checks. `unwire` removes by
    the same recogniser and by nothing else.
26. **[M] `~/.claude.json` is never written by this package.** The registration goes
    through `claude mcp add` / `claude mcp remove` as an argument vector, never a shell
    string. That file is READ to decide whether to call them, and a read that sees nothing
    does not stop the removal being attempted — the host owns that file and may move it,
    so our read is evidence, not authority. `claude` missing is a printed line and exit 0,
    never a failed install. *`unwire` is also the one of the three that runs with NO
    configuration at all: it needs nothing out of the file, and the person most likely to
    be running it is somebody who deleted `~/.counterparts` by hand and now has five hooks
    firing at a store that is gone.*
27. **[M] `uninstall` acts on an EXPLICIT LIST of what this package writes, never on
    "the directory the configuration sits in".** The list is the configuration file and our
    own temp and backup siblings of it, `credentials.env` (or whatever the configuration
    NAMES, when that sits beside it), `scopes.json` and its siblings, the `snapshots/` this
    layout owns, and the STORE at `dataDir` **wherever that is**. The configuration
    directory itself moves or goes only when it holds nothing else — which keeps the
    ordinary `~/.counterparts` a single atomic rename; when it holds anything foreign the
    directory is never touched, our entries go one by one, and the foreign ones are NAMED.
    `~/.claude`, the home directory, any parent of it and any directory holding a `.git`
    are refused outright. *This is the 2026-09-21 blocker: `install --config` puts a
    configuration anywhere, and the first version renamed Claude Code's own settings,
    project transcripts and todos away under a heading that said "Your memory, parked",
    then destroyed a `~/Documents` holding `taxes/` and `photos/` after warning about ONE
    memory.*
28. **[M] The whole plan — every path that will move or go, with its size — is PRINTED
    before the confirm and before the typed phrase.** `--park` is `rename(2)` once per
    thing and names each destination BEFORE it asks; `--delete-memories` has no `--yes`,
    counts first, and takes `DELETE MEMORIES` typed exactly. The closing sentence names
    what actually went, path by path, and never says the memory is gone unless the store
    itself went. *Home paths are written `~/…` on screen and in full in every refusal
    (2026-09-22, item 13). The guarded `mv` that undoes a park is no longer on the screen
    — the way back is `counterparts install`, which finds a parked folder beside a missing
    one and asks; the shell line moved to `counterparts help uninstall` (finding #22).
    `start-fresh` still prints its own, and is still where the guard is proved.*
29. **[M] The store is in that plan under its own ring** — absolute, not a forbidden root
    by either spelling, not a filesystem root, not the home, inside the home, not a
    symlink, and recognisable as a store by its own files — and a store that fails it is a
    REFUSAL rather than something left behind. *The first version counted the store at
    `dataDir`, deleted the configuration directory without it, and said the memory was
    gone.*
30. **[M] Both destructive arms refuse unless the MCP deregistration is CONFIRMED** —
    `claude mcp remove` exited 0, or a read of the host's own file shows nothing registered.
    A registration on disk plus a `claude` that is missing refuses BEFORE anything is
    touched. *A server pointed at a store that is gone fails at every session start with
    nothing on screen, which is the argument this module already made for the hooks.*
31. **[M] The process check FAILS CLOSED on those two arms, and the lister says whether it
    LOOKED.** No `ps`, a timeout, a sandbox that refuses process listing — each is "I could
    not check" and refuses, naming `--nothing-is-open` as the explicit override
    (`start-fresh`'s own flag and meaning). The override never excuses a check that FOUND
    something. The plain uninstall and `wire` keep failing open: they move nothing.
32. **[M] A hook entry is ours to rewrite only when the command IS our invocation** — our
    runtime and our hook script, or the installed shim, optionally with `--config <path>`,
    and never anything carrying a shell operator. Somebody's WRAPPER (`… && counterparts-hook`)
    is left exactly where it is by both directions and named in one line. `doctor`'s
    `readHost` keeps the looser mark for REPORTING, and a test holds the two to each other
    in the direction that matters: everything `wire` writes is matched by both.
33. **[M] The count is the number `status` calls Memories** — not archived, not
    superseded, not a journal episode, not a schema row — with the journal reported beside
    it. Taking it opens the store **under observer**, read-only, and `--park` never opens
    it at all. *Since 2026-09-22 it is printed on the STORE's own line of the plan rather
    than on a `WARNING:` line of its own, which leaves the warning to say the one thing
    the list cannot — that nothing brings these back. Still on the screen before anything
    is asked, which is what guarantee 28 claims. A warning is not a `fail` (finding #25):
    nothing has failed at the moment somebody is deciding.*

### What the merge with C and D added (2026-09-21)

34. **[M] The install conversation's fourth step is `keys.ts#promptForKeys`**, called
    AFTER the configuration and the 0600 credentials file exist — `enableEmbedder` edits a
    configuration and never creates one. `PromptAborted` propagates out of it by that
    module's own argument and is caught HERE: the install says nothing else was changed,
    summarises what is on disk from the FILE rather than from the result it just lost, and
    exits non-zero.
35. **[A] `doctor`'s Host fix lines name `counterparts wire`**, not `counterparts install`.
    Until the three verbs above existed, the only thing this package could do about a
    missing or stale hook was print a block for the reader to paste; the fix line now names
    the command that does the paste — including for the STALE case, which `wire` repairs in
    place.

### Esc, and the screens the trial asked for (2026-09-22)

36. **[M] Every prompt this package asks can be CANCELLED, and the ones whose Esc is not
    already their Enter say so in their own text** (owner, item 8; finding #21 — a
    typed-phrase prompt with no visible way out is one people answer by closing the
    terminal). On a real terminal `Io.prompt` is a raw-mode reader (`ui.ts#echoPrompt`,
    the hidden reader's own loop, echoing), and a bare ESC — nothing following it within
    ~50 ms, because an arrow key starts with the same byte — comes back as one sentinel
    through the ordinary string. `confirm` reads it as no, `typed` as `"cancelled"`, `ask`
    as an abort, `askHidden` as the empty answer it already calls a skip. **Cancelling is
    not a refusal**: it prints "Cancelled. Nothing was …" and exits 0, while the wrong
    phrase still exits non-zero. *Nothing binds that reader off a terminal, so a pipe, a
    test console and CI keep the prompt they had and the bytes they had.*

## 6. Scars honored

**E5** (the CLI is one side of the seam between locking domains — the owner console versus
the background worker — which is exactly where v1's surviving races clustered; a lock is
never held across a human prompt) · **§2.4** (every path that deletes or discards logs what
and how much) · **§2.11** (backup scope asserted against the layout; the canonical database
checkpointed, never copied) · **§2.13** (path guards resolve before they compare; no tool
silently accepts a pointer at real data) · **§2.17** (the removal path is a curation path,
and a curation path that has never fired is unproven — see open question 2) · **§2.19**
(permanence and write bar scale together — everything permanent is enumerable here) ·
**§2.20** (the removal record carries no body and no content hash).

## 7. Open questions

1. **Does `export` encrypt to a key the owner already has, or does it mint one?** Minting
   is friendlier and is also how an owner ends up with a backup they cannot open.
2. **Removal has never fired in production, in any generation.** v1's erase machinery was
   built, tested, and never once run in anger — which by scar §2.17's own criterion makes
   it unproven rather than sound. v2 should either exercise it deliberately in bake-in or
   carry it as declared-dormant-by-design, and say which.
3. **Is `restore` a supported operation or a documented manual procedure?** v1 had no
   logged read-back of a backup ever, so there is no evidence its snapshots were usable.
   Guarantee 4's restore test is the minimum; a real restore command is more.
