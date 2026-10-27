# R1 progress (PR #657), for whoever resumes

## Done (head 480f55d1)
- Part A: `connect` writes the deniedMcpServers entry; `disconnect` removes it; doctor has an Online row.
- Part B: the private store. Core: `src/core/store/private.ts`. Umask: `adapters/private-umask.ts`. Install base: `adapters/private-base.ts`.
- Every #657 review item is fixed: items 1–8, 2b, and the name-list re-check.
- The name-list fix is DONE:
  - `uninstall`'s `ownedKind`/`ownedNames` moved to `src/adapters/owned-names.ts`, a leaf (no console or dashboard imports). `uninstall.ts` re-exports them and `rollback.ts` takes `ASIDE_*` from it.
  - `rollback-aside-v*` was added to the list, so uninstall's delete arm now takes those too.
  - `private-base.ts` reads the same list, plus a legacy `credentials.env` (uninstall leaves that file; privacy closes it).
  - The base dir is closed only if it holds nothing but ours and is not the home or above it, not other-writable, not sticky, and owned by this uid.
- Tests: `test/private-store.test.ts` has "what uninstall calls ours is what is made private" (one fixture read by both callers, the loose default base with a parked store/debug/backup closed, a sticky base not closed).
- Local checks at 480f55d1: full `bun test` 7841 pass / 0 fail, node smoke 11/11 on Node 22, typecheck clean.

## Left
- CI at 480f55d1 was still running when the session stopped. windows-x64 is allowed to fail (it ends cancelled on every run).
- Report the head and CI to the coordinator.
- Before marking ready again: fold this file into `src/core/store/NOTES.md` (already has the details) and delete it.
