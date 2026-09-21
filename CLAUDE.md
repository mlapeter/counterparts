# Counterparts — session orientation

Counterparts is a memory layer for AI: interpretation over transcription, forgetting on
purpose, a governed self — memory that turns a stateless tool into an ongoing
counterpart. It is the clean-room successor to bansai (v1), built to be embedded:
host-agnostic core, adapters, npm package.

**`CONSTITUTION.md` is the only document with standing authority.** Everything else —
including owner answers given during the build — is a working default, revisable when it
fights that page. Decisions are defaults, not commandments.

**This file stays one page, forever.** v1's CLAUDE.md grew into scripture and laminated
working defaults into law; that is the mechanism this rule breaks. Details live in code,
tests, module CONTRACTs, and `docs/harvest/`.

## The two safety rules that transfer regardless of design

- **Tests are hermetic.** Every test runs against a fresh temp data dir it creates and
  removes. No test touches a real store.
- **Never touch the live stores.** `~/.bansai` (v1's running memory — the owner's and
  the assistant's) and `~/.claude-engram` are off-limits to all code and sessions here,
  except explicitly-designed read-only replay tooling. Sessions export
  `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`, so a store or config nobody named refuses
  instead of opening the owner's `~/.counterparts`.

## Reference lineage (read-only donors — never import, never modify)

- `~/bansai` — v1: the behavioral spec, scars, and test spine in `docs/harvest/` were
  distilled from it. Its hooks were switched off on 2026-09-21; the store stays where it
  is and stays off-limits.
- v0 (claude-engram jsx) and engram — earlier ancestors; their contributions are cited
  inside the module CONTRACTs.

## Toolchain

- TypeScript strict, ESM. Runtime: **bun** — the TypeScript sources run directly, no
  build step. **Node is untested at launch**: the store binds `bun:sqlite` under bun and
  `node:sqlite` under Node (22.5+ flagged, 23.4+ default), but nobody has run it there.
  bun at `~/.bun/bin/bun` for tests (`bun test`).
- Runtime deps: dependency hygiene is judgment, not a vow (Amendment 15 spirit) — but
  the default is zero.

## Status

Launched. Feature-complete 2026-08-25; the author's live memory since 2026-09-03;
`counterparts@0.1.0` published on npm 2026-09-21. He now runs it **from the npm install**,
on a store he started fresh that day, and bansai's hooks are off — so `~/counterparts` is
the development repo and nothing more. `docs/new-user-findings.md` is what that first
install was like; `docs/LAUNCH-STATUS.md` and `docs/PARALLEL-RUN-STATUS.md` are the
records of the weeks before it, useful as history rather than as current state. Module map:
`docs/module-map.md`. Each `src/**/CONTRACT.md` states what the module keeps (with
lineage), what it drops, and its guarantees; `NOTES.md` beside it records what the build
learned, and `INTERFACE-GAPS.md` — in every module but `physics/` and `store/`, which have
none of their own (the open asks against `store/` sit in `recall/` §1 and `cli/` §4) —
what it still owes.
