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
prompt; `backup`, `verify` and `init` are autonomous. Adding to the list is a
discussion, never an assumption.

## Verified live? No

Every test runs against a temp store. Per CLAUDE.md's definition of done this is
**merged, not verified**: the outstanding proof is one real snapshot of a real
store, restored and read.
