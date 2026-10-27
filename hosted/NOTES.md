# hosted/ — what the build learned

The OL2 lane's progress notes, folded in here when the stack was marked ready (2026-10-26). The design and its answered
questions are in `docs/hosted/DESIGN.md`, the guarantees in `CONTRACT.md`, and what is still owed in
`INTERFACE-GAPS.md`.

## Stack status (for a successor; `NOTES-OL2.md` was folded in here)

Status on 2026-10-26, late:

- **Propagation is done.** Every branch contains everything below it: master 21504d86 → `feat/hosted-server` (#639) →
  `feat/hosted-tenants` (#643) → `feat/hosted-accounts` (#644) → `feat/hosted-oauth` (#646) → `feat/hosted-keys` (#648).
  All five are marked ready, and the coordinator merges them in that order on green.
- **The review hardening list is done:**
  - the batch cap (#639);
  - 503 when a token can't be checked, origin-form targets only, door timeouts, and a real worker-child smoke test
    (#643);
  - the MAIL=log refusal with an https origin (#646);
  - the reviewers' LOW/INFO items listed in `INTERFACE-GAPS.md` (#648);
  - CONTRIBUTING's CI list (#643).
- **Folded in after that:**
  - dreaming `auto` for new stores (#644, merged up);
  - Mike's "account email purged from backups within 24 hours", with snapshots at 12 h / 12 h, and email-under-DEK as a
    gate before any non-family user (#648).
- **Left:** if master moves again, merge it up the stack in order (hosted tests on every branch under bun and Node 24,
  plus the full root suite on #639). Nothing else is open in this pass.

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

## OL2b: the ops pieces (feat/hosted-ops, 2026-10-26; `NOTES-OL2b.md` folded in here)

Built on master 6699b892 (the merged OL2 stack). What it covers: restore and the drill, `/readyz`, `/mcp` limits, the
DCR sweep, the Dockerfile, and `docs/hosted/RUNBOOK.md`. The guarantees are CONTRACT §29–§36; what is left is
INTERFACE-GAPS §4–§11.

### Found while building

- **`ensureStore` would have minted a new key over the bucket's key object.** That happens on any volume that lost
  `keys.sqlite`, and `keys.sqlite` is deliberately not replicated. The new key was then put over
  `keys/<id>.wrapped`, and the whole backup became unreadable. It runs at every start, for every live store. Now it
  adopts the bucket's key, and refuses a different DEK.
- **A restored store answers recall with nothing.** The word index and the vectors live in `cache/` (box 3), which is
  never backed up. The core doesn't rebuild a missing cache on open. So restore drops `cache/` and leaves
  `restored.marker`, and the next open runs `rebuildCache()` with the shared embedder.
- **A store whose dir is missing used to be treated as a new install** (`tenants.ts`'s `fresh`). It was given a new
  empty store, and the sidecar then replicated that store over the real backup. Now `stores.opened_at` marks a
  store that lived, and such a store waits for a restore (`503`).
- **An empty volume beside a full bucket** would have started with empty control databases and replicated them over
  the real ones. Start-up refuses that unless `RESTORE_ON_BOOT=1`.

### Learned

- **Litestream 0.5.17, read from its source** (the classifier refused running the binary on the Mac):
  - `restore` takes `-config` or a replica URL, never both, so an SSE-C restore needs the store in a configuration;
  - `sse-customer-key-path` takes the base64 of 32 bytes (what `keys.ts#litestreamKey` writes);
  - there's a shutdown sync on SIGTERM;
  - path-style is the default when an endpoint is set;
  - `addr:` serves metrics, the way to replication lag later.
- **A Litestream child killed before it has loaded has no SIGTERM handler**, so it makes no final sync. The drill
  waits for the first upload before it stops the server. In production a child lives for hours, so this doesn't
  bite.
- **`minio/minio` is gone from Docker Hub.** A real-S3 drill needs R2 itself (a second bucket), or another image.
- **The image builds and serves.** `docker build -f hosted/Dockerfile .` verified the Litestream sha256 and ran
  `litestream version` (0.5.17, arm64). A `BACKUPS=off` run answered `/readyz` 200, `/mcp` 401 with the resource
  metadata, made an invite, and was `healthy`. A run against an unreachable bucket refused to start, now naming
  `R2_ENDPOINT`.
- **Test rigs:** under bun, an aborted mid-body POST keeps its ref (§16). The in-flight test finishes its held body
  instead of aborting it.
