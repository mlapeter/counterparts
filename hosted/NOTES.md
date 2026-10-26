# hosted/ — what the build learned

The OL2 lane's progress notes, folded in here when the stack was marked ready (2026-10-26). The design and its answered
questions are in `docs/hosted/DESIGN.md`, the guarantees in `CONTRACT.md`, and what is still owed in
`INTERFACE-GAPS.md`.

## How it was built

- **One design checkpoint, then the steps as stacked PRs:**
  - #639: design + transport split;
  - #643: tenants;
  - #644: accounts;
  - #646: OAuth;
  - #648: keys, backups, export, delete.

  They merge in that order. Three high-effort security reviews approved the stack, with their fixes pushed onto the
  branches.
- **Spikes ran outside the repo** (DESIGN §11):
  - stock `bun:sqlite` and `node:sqlite` ignore `PRAGMA key`;
  - oidc-provider 9.13 ran a full DCR, PKCE, resource and refresh-rotation flow under bun and Node 24;
  - the MCP SDK v2 has no authorization server, and v1's has no server-side CIMD;
  - the native `better-sqlite3-multiple-ciphers` build was blocked, and Mike chose not to run it for now.
- **The tests are `node:test` files**, so the same files run under `bun test ./hosted/test` and under Node 24
  (`node --import ./src/adapters/node-hooks.mjs --test hosted/test/*.test.ts`). CI runs both.

## Learned

- **bun on Linux links SQLite statically.** `Database.setCustomSQLite` works on macOS only, so bun can never open a
  SQLCipher file on Railway.
- **oidc-provider prints "Unsupported runtime" on bun.** Its SSRF guard for the CIMD fetch doesn't arm there either (the
  #646 review). Production runs Node 24, and a Node-only test guards it.
- **`wake` spawns a `runner.ts` child per boundary** (`mcp/server.ts`). Multi-tenant needs the `Spawner` seam: a cap and
  per-store coalescing. On delete the store's worker must also be dropped (the #643 review), or an owed run reopens a
  removed store.
- **`spawn.ts#planSpawn` copies the parent's whole environment into the worker.** The hosted pool passes the child an
  allow-list, by name, not by prefix (the #643 review).
- **`Tenants.close()` must wait on an idle promise, never loop over a queue** (the #643 review). A call holds its ref
  while its body arrives and its answer flushes, and a loop of already-settled promises never yields the event loop:
  the whole process froze.
- **Under bun, `node:http` doesn't emit `close` when a client aborts mid-body.** That request keeps its ref, so under bun
  the handle is never evicted. Node 24 behaves; this only affects the bun test runtime.

### Accounts, OAuth, keys (steps 3–5)

- **Every login ask, refused or not, writes one row in one commit** (the #644 review). Otherwise the disk write alone (a
  WAL fsync on a network volume) tells an attacker whether an address has an account. The login email is also not
  awaited.
- **`safeNext` checks the path after dot-segments resolve** (the #644 review). `/oauth/..//evil` resolved to `//evil`.
- **Behind a proxy, the client IP is the last `X-Forwarded-For` hop** (the #644 review). The first hop is whatever the
  client wrote.
- **oidc-provider keeps its own 24 h login session**, and our `/logout` doesn't end it. Silent re-authorization must
  also check our own web session (`loadExistingGrant`, the #646 review).
- **More oidc-provider details:**
  - It defaults ID tokens to RS256 and refuses DCR unless its keys match, so we configure ES256.
  - DCR issues a `registration_access_token`. That is a bearer, so it is hashed.
  - `memory` is both a plain scope and a resource scope, so the grant covers both.
  - Its endpoint URLs follow the `Host` header, so requests reach it with `Host` pinned to `PUBLIC_ORIGIN`.
  - Remote client metadata (`sector_identifier_uri`, `jwks_uri`, …) is refused.
- **node:sqlite's `secure_delete` defaults to 0** (bun's is FAST). Deleted rows stay in free cells, and so in every
  Litestream snapshot. `oauth.sqlite`, `accounts.sqlite` and `keys.sqlite` all set it on (the #648 review).
- **A half-finished delete must stay a delete** (the #648 review). The store turns `deleting` durably, start-up finishes
  pending deletes before `ensureAll`, and `Tenants.retire` refuses any later open.
- **Litestream v0.5 dropped its own encryption.** SSE-C is per replica, and `dir` mode shares one key. So each store
  gets its own `path:` entry, and each wrapped DEK is one write-once R2 object rather than a replicated keys database.
