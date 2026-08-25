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
  except explicitly-designed read-only replay tooling.

## Reference lineage (read-only donors — never import, never modify)

- `~/bansai` — v1: the behavioral spec, scars, and test spine in `docs/harvest/` were
  distilled from it. It keeps running as the live instance until Counterparts passes
  replay + a parallel run.
- v0 (claude-engram jsx) and engram — earlier ancestors; their contributions are cited
  inside the module CONTRACTs.

## Toolchain

- TypeScript strict, ESM. Target: Node (built-in `node:sqlite`; verify exact version
  floor at packaging) and Bun. bun at `~/.bun/bin/bun` for tests (`bun test`).
- Runtime deps: dependency hygiene is judgment, not a vow (Amendment 15 spirit) — but
  the default is zero.

## Status

Pre-build skeleton. Module map: `docs/module-map.md`. Each `src/**/CONTRACT.md` states
what the module keeps (with lineage), what it drops, and its guarantees — contracts
first, implementation only after the owner's skeleton check-in.
