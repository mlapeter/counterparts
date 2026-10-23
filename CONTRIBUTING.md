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

## Continuous integration

Every pull request and every push to master runs
[`.github/workflows/tests.yml`](.github/workflows/tests.yml): the typecheck, the changelog
fragment check, the whole suite on Linux in two time zones (`America/Denver` and
`Pacific/Kiritimati`) and on macOS in Denver, and the Node smoke test on Node 22.15 and 24.
To run the same checks locally (the Node one needs `node` 22.15 or later on your `PATH`):

```sh
bun run typecheck && bun tools/changelog/stitch.ts --check && TZ=America/Denver bun test --timeout 30000 && TZ=Pacific/Kiritimati bun test --timeout 30000 && bun run test:node
```

## Two safety rules

1. **Tests are hermetic.** Every test runs against a fresh temporary data directory that it
   creates and removes. No test touches a real store. `test/preload.ts` enforces this by
   pointing the home directory at a temporary one for the whole run.
2. **Never touch a live store.** Code, tests and tools must not open a memory store that
   nobody named. While you work here, set `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` in your
   shell. With it set, a store or config that was not named explicitly refuses to open,
   instead of opening your own `~/.counterparts`.

## Developer switches

Developer tools live in `tools/`, which does not ship. Only a switch that has to sit in
shipped code goes under `debug` in `claude-code.json`; it is off by default, and it is
documented here, not in the README or the user docs. Unknown `debug` keys are ignored.

- `"debug": { "nightTranscripts": true }` keeps each night child's raw `stream-json` output
  (the page writer, the dream, the reflection, the tagging) at
  `<base>/debug/<date>/<child>-<run>.jsonl`, beside the store, only in the layout `install`
  creates (`<base>/store` with `claude-code.json` in the same `<base>`; any other layout gets
  none). Files are mode 0600 in 0700 folders.
  Date folders older than 7 days are pruned at the start of every night run, switch on or
  off, and only the files this switch names. They hold the night's words (the memories it
  read and what it wrote), so they stay out of backups: snapshots copy the store only, and
  `uninstall` takes the folder with the rest while it holds only those files (anything else
  in it makes it yours, and it is left). What a night cost needs no switch: it is on
  the `dream.night` event (`usage`) and in `counterparts night`.

## Pull requests

- Keep each pull request small: one change.
- Include tests. A bug fix comes with a test that fails without the fix.
- Say what changed and how you checked it.
- If someone using Counterparts would notice the change, write its changelog entry as
  `changelog.d/<branch>.md` rather than editing `CHANGELOG.md`
  ([`changelog.d/README.md`](changelog.d/README.md) says how).
- A new decision for the "Decisions to review" list goes in `docs/decisions.d/<branch>.md`
  rather than in `docs/IMPROVEMENTS.md` ([`docs/decisions.d/README.md`](docs/decisions.d/README.md)).
- The package has one runtime dependency, and it is data only: `counterparts-model-potion`,
  the local embedding table recall by meaning runs on (no code, no install scripts). If a
  change adds another, say why.

## License

Counterparts is MIT licensed. See [`LICENSE`](LICENSE). By contributing, you agree that your
contribution is licensed under the same terms.
