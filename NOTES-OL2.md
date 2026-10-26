# NOTES-OL2: the hosted server lane (progress file; fold into hosted/NOTES.md before the PR is marked ready)

Branch `feat/hosted-server`, from origin/master eacdafda. The brief is
`~/counterparts-notes/2026-10-26-briefs/OL2-hosted-server.md`, with the shared rules in `_COMMON-online.md`.

## Done

- **2026-10-26, step 1 (design checkpoint).** Wrote `docs/hosted/DESIGN.md`. Its §0 lists the open questions Q1–Q11,
  each with a recommendation.
- Spikes ran in the scratchpad, outside the repo; results are in DESIGN §11:
  - stock bun:sqlite and node:sqlite ignore `PRAGMA key`;
  - oidc-provider 9.13 runs a full DCR + PKCE + resource + refresh-rotation flow under bun and Node 24;
  - MCP SDK v2 has no authorization server, and SDK v1's has no server-side CIMD.

## Next

- **STOP.** Wait for the coordinator / roadmap seat / Mike to answer Q1–Q11.
- Then build in DESIGN §9's order. First PR: split `remote/http.ts` into a request handler and the local listener, and add
  2025-11-25 to negotiation (`mcp/protocol.ts` belongs to the mcp module, so coordinate).

## Learned

- **Litestream v0.5 has no built-in encryption; it was removed.** SSE-C works per replica, but in `dir` mode one key
  covers every database. So a per-user key means one `path:` entry per store.
- **Replicating the key store breaks crypto-shredding.** A Litestream-replicated keys DB keeps deleted wrapped DEKs for
  the whole retention window. That's why `keys.sqlite` stays out of Litestream and its backup copies are kept 7 days.
- **bun on Linux links SQLite statically.** `setCustomSQLite` is macOS-only, so bun can never run SQLCipher on Railway.
- **oidc-provider's adapter receives the opaque token value as the row id.** Hashed-at-rest is our adapter's job.
- **oidc-provider complains on bun.** It prints "Unsupported runtime" there, so production runs Node 24.
- **`wake` spawns a `runner.ts` child per boundary** (`mcp/server.ts:2891`). Multi-tenant needs the `Spawner` seam: a cap
  and per-store coalescing.
- **Blocked in this session:** the native build of `better-sqlite3-multiple-ciphers` (it fetches external code). Mike can
  allow it if he wants file-level encryption measured.
