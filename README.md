# Counterparts

**Memory that turns AI tools into counterparts.**

A local-first memory layer for AI, modeled on human memory: interpretation over
transcription, forgetting on purpose, and a governed, persistent self. The core is
host-agnostic; hosts plug in as adapters (Claude Code first); ships as a simple npm
package.

**Status: built, and running in a parallel run.** The constitution is ratified
(`CONSTITUTION.md`), the modules are implemented against their contracts
(`docs/module-map.md` + `src/**/CONTRACT.md`), and since 2026-09-03 Counterparts has
been the owner's primary memory under Claude Code, beside the previous generation.
The living record of what is true right now is `docs/PARALLEL-RUN-STATUS.md`;
`docs/ELI5.md` is the map in plain words.

## Install

**[`docs/QUICKSTART.md`](docs/QUICKSTART.md) is the one canonical install path** —
prerequisites, the four executables, the configuration, the Claude Code hooks and MCP
registration, what happens with no API keys, and what is verified versus assumed. Ten
minutes, no key required.

`tools/install-loop/run.sh` runs every command on that page, verbatim, in a throwaway
HOME with no repo on its PATH, and fails if the page and the machine drift apart.

## Lineage

Counterparts is the third generation of one continuous project:

- **v0 — claude-engram** (a single React artifact): had the authorship shape right —
  the model that lived the conversation wrote the memory dump; a one-line strength
  formula did the filing.
- **engram**: the production ancestor; contributed the eight original scars
  (`docs/harvest/scar-list-v2.md` §1).
- **v1 — bansai**: the full system this design distills — its behavioral spec, earned
  mechanisms, test spine, and twenty more scars live in `docs/harvest/`. It keeps
  running as the live instance until Counterparts passes replay and a parallel run
  beside it.

## License

MIT (owner decision, 2026-09-03). See `LICENSE`.

## Note on Node

**The runtime is bun.** Counterparts ships as TypeScript sources and runs them
directly — there is no build step and no `dist/`. Everything that has been verified was
verified under bun (1.3.10 at the time of writing).

Node is **untested**: the core targets built-in `node:sqlite`, which needs Node 22.5+
behind a flag and 23.4+ by default, and no Node with either has run this package. A Node
target would need a build step that does not exist yet. `package.json#engines` therefore
names bun and does not claim Node.
