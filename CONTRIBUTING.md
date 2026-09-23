# Contributing

Contributions are welcome. This page is what you need to know before you send one.

## How the project is governed

- [`CONSTITUTION.md`](CONSTITUTION.md) is the only document with standing authority.
  Everything else in the repository is a working default: the README, the docs, the module
  contracts, and this page. A working default changes when it conflicts with the
  constitution or when there is a better reason.
- Each module under `src/` has a `CONTRACT.md`. It says what the module keeps, what it drops,
  and what it guarantees. Most modules also have an `INTERFACE-GAPS.md`, which lists what the
  module still owes. Read the contract of any module you change.
- [`docs/README.md`](docs/README.md) says what the other documents are.

## Open an issue first for stores and config

Open an issue before you write a change that touches a memory store or someone's
configuration. That includes the SQLite store, snapshots, export, the files
`counterparts install` writes, and `~/.claude/settings.json`. A mistake there can lose
someone's memories or break their setup, so the approach is agreed first.

Other changes can go straight to a pull request.

## Running the suite

You need [bun](https://bun.sh) 1.3 or later. The TypeScript sources run directly; there is
no build step.

```sh
bun install
bun test
bun run typecheck
```

`bun run typecheck` runs `tsc --noEmit`. Both should pass before you open a pull request. If
you change install, connect, disconnect or uninstall, also run `tools/install-loop/run.sh`,
which installs the package into a throwaway home directory and checks it end to end.

## Two safety rules

1. **Tests are hermetic.** Every test runs against a fresh temporary data directory that it
   creates and removes. No test touches a real store. `test/preload.ts` enforces this by
   pointing the home directory at a temporary one for the whole run.
2. **Never touch a live store.** Code, tests and tools must not open a memory store that
   nobody named. While you work here, set `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` in your
   shell. With it set, a store or config that was not named explicitly refuses to open,
   instead of opening your own `~/.counterparts`.

## Pull requests

- Keep each pull request small: one change.
- Include tests. A bug fix comes with a test that fails without the fix.
- Say what changed and how you checked it.
- The package has no runtime dependencies. If a change adds one, say why.

## License

Counterparts is MIT licensed. See [`LICENSE`](LICENSE). By contributing, you agree that your
contribution is licensed under the same terms.
