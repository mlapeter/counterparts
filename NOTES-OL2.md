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

- **2026-10-26, checkpoint answered** (roadmap seat, on Mike's word): build steps 1–4. Step 5 (keys + backups) waits on
  Mike: the Q4 wording, who holds the key, the §5.2 privacy paragraph, and whether to allow the native-driver spike. Don't
  run that spike. Accepted: Q1, Q5–Q11. Q2/Q3 lean accept.
- **Step 1, done (PR #639, this branch):** `remote/http.ts` exports `handleMcpPost(req, res, target)` and `serialQueue()`;
  `serveHttp` is the local listener over them, unchanged. `mcp/protocol.ts` echoes 2025-11-25, and
  `LATEST_PROTOCOL_VERSION` is named as 2025-06-18. Tests: `test/remote-http.test.ts` covers the mounted handler (two real
  stores behind one router, one queue per target) and 2025-11-25 through the door; `test/mcp.test.ts` covers echoing each
  listed version. Full `bun test` green (7714 pass) and `test:node` green on Node 24.

- **Step 2, done (PR #643, `feat/hosted-tenants`):** `hosted/` package, `tenants.ts`, `server.ts`, the CI job "hosted".
  16 tests.
- **Step 3, done (PR #644, `feat/hosted-accounts`):** `accounts.ts`, `pages.ts`, `web.ts`, `egress.ts`. 11 tests.
- **Step 4, done (PR on `feat/hosted-oauth`):** `oauth.ts`, `oauth-adapter.ts`, `app.ts` (the composition), `main.ts`
  (the entry point plus `invite`). hosted/ now has its own `package.json` dependencies (oidc-provider 9.13.0;
  devDeps oauth4webapi, @types/oidc-provider, the MCP SDK as a test client), its own `bun.lock` and its own
  `tsconfig.json`. CI installs them with `bun install --cwd hosted --frozen-lockfile`. 47 hosted tests, green under
  bun 1.3.10 and Node 24.22.

## Next (after the coordinator's answer on step 5)

- Step 5: keys + backups + export + delete (waits on Mike).
- Step 6: ops (Dockerfile, Litestream sidecar, /readyz, alerts, RUNBOOK, Fly fallback).
- Step 7: the security review.
- Before the last PR is marked ready: fold this file into `hosted/NOTES.md`.

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
- **`spawn.ts#planSpawn` copies the parent's whole environment into the worker.** The hosted pool allow-lists the
  child's environment (`tenants.ts#workerEnv`).
- **oidc-provider details found while building step 4:**
  - It defaults ID tokens to RS256 and refuses DCR (`invalid_client_metadata`) unless its key set matches. Our
    per-process key is EC P-256, so we set `enabledJWA.idTokenSigningAlgValues` and the client default to ES256.
  - It issues a `registration_access_token` on DCR. That token is a bearer, so it is hashed too.
  - `memory` counts as a plain scope as well as a resource scope. The Allow grant adds both, or the authorization loops
    back to the Allow page.
  - Its CIMD fetch already carries an SSRF guard (special-use IPs refused on Node, no redirects, 2.5 s, body limit),
    which is most of DESIGN §4.4's list. We add https-on-443 only.
  - A loopback `native` client registered without a port comes back on any port (RFC 8252), which is what Claude Code
    needs.
- **Login email timing.** Not awaiting the login email keeps a known and an unknown address equally fast.
- **Blocked in this session:** the native build of `better-sqlite3-multiple-ciphers` (it fetches external code). Mike can
  allow it if he wants file-level encryption measured.
