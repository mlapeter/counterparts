# Counterparts

**Memory that turns AI tools into counterparts.**

A local-first memory layer for AI, modeled on human memory: interpretation over
transcription, forgetting on purpose, and a governed, persistent self. The core is
host-agnostic; hosts plug in as adapters (Claude Code first); ships as a simple npm
package.

**Status: pre-build.** The constitution is ratified (`CONSTITUTION.md`), the design
inputs are harvested from the previous generation (`docs/harvest/`), and the module
skeleton is laid out (`docs/module-map.md` + `src/**/CONTRACT.md`). Implementation
starts after the owner's skeleton review.

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

Deliberately undecided until packaging (owner decision 2026-08-25); `UNLICENSED` while
the repo is private.

## Note on Node

The core targets built-in `node:sqlite` (and Bun's `bun:sqlite`); verify the exact Node
version floor at packaging time.
