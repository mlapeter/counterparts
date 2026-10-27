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
INTERFACE-GAPS §4–§16.

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
- **Under bun, an aborted mid-body POST never ends its request** (INTERFACE-GAPS §21). The door now also settles on
  the socket's `close`, which frees both the store's ref and the in-flight slot.

### The review (high effort, after the first build)

It found two data-loss paths and several smaller holes, all fixed on the branch with a test each:

- **The guard checked `store/`, not the database file.** A restore that failed or found nothing left the dir
  behind, and the store was then made empty.
- **`prepareVolume` checked only `accounts.sqlite`.** An `invite` or a `BACKUPS=off` run on a lost volume made one,
  and the next `serve` replicated the empty control databases over the real ones. A control restore cut short
  likewise lost `oauth.sqlite`. Now the control key on this volume is what says "this volume is the bucket's", and
  each control database is restored alone.
- **The other fixes:**
  - `opened_at` is back-filled at every start;
  - one failing store no longer stops a RESTORE_ON_BOOT start;
  - `--force` moves the old file aside;
  - the cache is rebuilt before the server listens;
  - a store that lived and has no key anywhere is never given a new one;
  - the sweep keeps a client that any grant or token names;
  - an abort under bun gives its slot back.

### The independent review of #653 (high), and its fixes

Each fix has a test in `test/ops.test.ts` or `test/main.test.ts` that builds the awkward state through the same rig.

- **H1.** `restore control` (and `--all`) kept an `invite`-made `accounts.sqlite`, restored `oauth.sqlite` beside it,
  and adopted the control key. That made the fake database "the bucket's" for the next serve. The three-way rule
  (`app.ts#controlVolume`/`foreignControlRefusal`) now stands in front of every control restore.
- **M1.** A delete made while the sidecar was down came back with the restored accounts database (active, with its
  email). Deletes now write `deleted/<id>`, and every start finishes the delete of a live store that has one.
- **M2.** A delete made with `BACKUPS=off` on a volume that was backed up left the store's key object and replica in
  R2 forever. Such a start is refused now, and a start with backups removes what a `deleted` store left.
- **M3.** `/data` is made in the image and owned by `node`. A plain Docker volume there was root-owned (EACCES in the
  RUNBOOK drill); checked with a named volume.
- **M4.** The sidecar's configuration listed a lived store with no database. It now leaves it out, except during
  its own restore.
- **The LOW findings:**
  - L1: the marker comes before the move;
  - L2: no sidecar mid-boot;
  - L3: `self_page` `summary` counts as a write;
  - L5: tags, not ids, in the restore CLI's output;
  - L6: `invite` needs the backups named;
  - L7: RUNBOOK fixes (the start-command override, the drain time, the healthcheck timeout, the unverified one-off
    command, `--all --force`);
  - L8: `start-over`.
- **L4 (no global or cost-weighted budget) is flagged, not built** (INTERFACE-GAPS §14).

### The re-review of #653 (at a84f6893)

All five original findings were confirmed fixed. Its own findings were fixed, each with a test in the "#653
re-review" block:

- **N1.** A store started over on a running server wasn't in `litestream.yml` until some other reload. Its first
  open now runs `ensureStore` (key, key file, configuration, reload) when `Backups.inConfig` says it's missing.
- **N2.** One stuck deleted store in the leftovers loop crash-looped every start. The loop now catches per store and
  audits.
- **N3.** `start-over` refuses a tombstoned store.
- **N4.** The leftovers check skips deletes the audit says already cleaned the bucket.
- **N5.** Copies set aside are deleted after a day: by the stamp in the name for `pre-restore`, by ctime for
  `control.aside-*`. The RUNBOOK's override moved `control/` aside only once, so a crash-restart doesn't move the
  restored one too. (Its guard was `control.aside-1` itself, which this sweep deletes: R3 below.)

### R3: the final check's two LOWs (10-27)

- **The control override is one-shot for real.** It was a Railway start command (`sh -c 'test -e
  /data/control.aside-1 || mv …'`) whose guard was the aside copy itself, and the day-old sweep (N5) deletes that
  copy: an override left set re-armed a day later and moved the restored `control/` aside at the next restart. It
  is now `CONTROL_ASIDE=<label>` in `serve` (`main.ts#controlAside`), with the guard in `overrides/`, a dir the sweep
  never lists. The guard is an exclusive create before the move, so a crash between the two leaves `control/` in
  place (the start refuses as before) and never moves it twice. A new label re-arms it. Moved into `serve` so it is
  testable through the entry point; a shell line in the RUNBOOK wasn't. Refused with `BACKUPS=off`: the aside copy
  would be the only one, and it is swept a day later.
- **The #655 review (BLOCKING): the move checks the volume first.** As first built, `CONTROL_ASIDE` moved `control/`
  on any volume. On one with good control databases, no `keys/`, and a bucket with no control key, the only copy of
  every account went aside, `prepareVolume` let the start go on with empty control databases, they replicated, and
  the sweep deleted the aside a day later. `controlAsideAtStart` now reads `controlVolume` and moves only when
  `foreignControlRefusal` refuses; otherwise nothing moves and no guard is written. An unreachable bucket stops the
  start before anything moves. The guard reads `claimed <time>` before the move and `moved <time>` after, so a crash
  in between says so. The refusal names `CONTROL_ASIDE=<new label>` and `RESTORE_ON_BOOT=1`, not a manual `mv`.
- **`backup.ensure.failed` has a stderr line**, not only the audit: `[hosted] backup.ensure.failed storeTag=<tag>: this
  store is NOT backed up yet …` (`storeTag=`, not `store=`, which is server.ts's per-process HMAC tag elsewhere), through the app's `onEvent` and `main.ts#eventLine`. The tag is `storeTag` (SHA-256,
  the restore CLI's tag, now in `tenants.ts`), not the server's per-process HMAC, so an operator can match it to
  `restore`/`start-over` output. Never the id, an address or the error's text (a sidecar error can carry a path).
- **Found, then built as R5 (below):** when `ensureStore` failed before any key existed (the bucket unreachable at the
  first open of a started-over store), the store was still marked opened, and it served, unbacked, for good.

### R5: a store that served with no key anywhere gets one at start-up (10-27)

The rule was "no key is ever minted for a store that lived". It exists because a lived store with no key here and none
in the bucket MIGHT have lost its key: a new key would hide that, and its replica, if any, would be buried for good. But
a started-over store whose first open's `ensureStore` threw (the R3 finding) is in that state with nothing anywhere to
bury, and nothing healed it: later starts counted it `keyless`, `start-over` refused ("its database is here"), no
command minted, and the RUNBOOK's "tell the coordinator" led nowhere.

- **Now `ensureAll`, at start-up only, mints when every condition holds** (`backup.ts#mintRefusal`, the #655 review's
  list plus one):
  - (a) no key in `keys.sqlite`, and (b) the bucket's GET of its key object said "no such key" (both are what
    `StoreKeyMissing` means; a GET that throws stops the start, as before);
  - (e) its database file is here;
  - (c) the LIST of its replica prefix answered, and empty;
  - (d) no tombstone;
  - (f) the bucket held the control key BEFORE this start. It is read before `ensureStore(control)`, which puts the
    local control key into a bucket that has none. Past that call, the bucket's key was adopted or proven the same
    DEK, or the start already threw;
  - (f2, added here) this volume's control key is older than the store's first open (`keys.store_keys.created_at` ≤
    `stores.opened_at`). Without it, a volume that lost `keys.sqlite` and was pointed at an empty bucket passes (f) on
    its SECOND start (the first put the control key there), and every lived store would be minted at once, while the
    real keys sit in the right bucket. Every key a store can have is made or adopted in `keys.sqlite`, so a
    `keys.sqlite` older than the store's opening that has no key of it means it never had one on this volume.
- **Only at start-up**: no sidecar runs yet (`hold`), so no replica can appear between the checks and the mint. Sign-up,
  a first open and a restore still throw `StoreKeyMissing` and never mint.
- **The key file is rewritten at the mint**, whatever is there. `ensureStore` writes it only when missing, so a key file
  left from a key that is gone (no normal path leaves one with (f2) holding; a tenant dir copied by hand could) would
  have put the new replica under an SSE-C key nobody holds. The heal test leaves one there on purpose.
- **A 404 NoSuchBucket now throws** in `r2ObjectStore.get`, so a wrong `R2_BUCKET` is never read as "no such object".
  Before, a typo'd bucket read as empty until the first PUT failed.
- **The lines are fixed words by tag** (`main.ts#eventLine`): `backup.key.minted storeTag=…`, or `backup.keyless
  storeTag=… reason=…` with one of six reasons (`backup.ts#KEYLESS_REASONS`), above the count lines. Each is audited
  (`backup.key.minted`, or `backup.keyless` with the reason in the detail).
- **Tests run through `main.ts serve` as a process** on bun and Node 24, against the S3 stand-in over https: a
  self-signed certificate from `openssl` at test time, trusted by `NODE_EXTRA_CA_CERTS`; the Litestream stand-in gets
  it from its wrapper script, since the sidecar's environment is PATH and the R2 credentials only. The stand-in moved
  to `test/helpers.ts`, with a fault hook and `spawnServe`. The heal test reaches the keyless state for real (start-over
  on a running server, then a first open whose key GET fails) before the spawned serve heals it.
- **Chosen: the automatic mint, not an operator command** (`start-over --rekey`, the brief's alternative). The gap is
  that nobody acts. On Railway a command means `railway ssh` into a running container, and the conditions are the
  same either way. Not built: the command, and a retry on the running server's 10-minute timer (a store heals at the
  next start, which the RUNBOOK says to force with a restart).
- **Left keyless on purpose:** `keys-newer` with nothing in any bucket (a gap store whose volume then lost and rebuilt
  `keys.sqlite`) can't be told from the mass-mint case above, and nothing heals it. Rare: two failures in a row.
