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
    DEK, or the start already threw. **(f) alone does not prove the bucket is this volume's** (the #658 review): a
    wrong bucket passes it at its second start. It only keeps the FIRST start against a new bucket from minting;
  - (f2, added here) this volume's control key is strictly older than the store's first open
    (`keys.store_keys.created_at` < `stores.opened_at`; equal refuses, the #658 review). Without it, a volume that lost `keys.sqlite` and was pointed at an empty bucket passes (f) on
    its SECOND start (the first put the control key there), and every lived store would be minted at once, while the
    real keys sit in the right bucket. Every key a store can have is made or adopted in `keys.sqlite`, so a
    `keys.sqlite` older than the store's opening that has no key of it means it never had one on this volume.
  - **What makes the mint safe** is (c), (f2), and `config()` listing only stores with a key: a store this
    `keys.sqlite` never held a key for was never replicated by this volume to any bucket, and the bucket we can see
    holds nothing of it.
- **Only at start-up**: no sidecar runs yet (`hold`), so no replica can appear between the checks and the mint. Sign-up,
  a first open and a restore still throw `StoreKeyMissing` and never mint.
- **The key file is rewritten at the mint**, whatever is there. `ensureStore` writes it only when missing, so a key file
  left from a key that is gone (no normal path leaves one with (f2) holding; a tenant dir copied by hand could) would
  have put the new replica under an SSE-C key nobody holds. The heal test leaves one there on purpose.
- **A 404 NoSuchBucket now throws** in `r2ObjectStore.get` and `.delete`, so a wrong `R2_BUCKET` is never read as "no
  such object" or "already deleted". Before, a typo'd bucket read as empty until the first PUT failed.
- **The control key's mismatch says so** (the #658 review). A volume that lost `keys.sqlite` and started against a
  wrong, empty bucket made itself a new control key (#653's behaviour). Back on the right bucket, the start
  used to refuse with "a different key for that store is already here"; it now names the control key and the way
  back (remove `keys/`, one deploy with `CONTROL_ASIDE` and `RESTORE_ON_BOOT`), and a test runs that way back
  through serve. Since R7 (below) that wrong-bucket start is refused, so this path is reached only when
  `NEW_BUCKET` was set on a wrong bucket.
- **The lines are fixed words by tag** (`main.ts#eventLine`): `backup.key.minted storeTag=…`, or `backup.keyless
  storeTag=… reason=…` with one of six reasons (`backup.ts#KEYLESS_REASONS`), above the count lines. Each is audited
  (`backup.key.minted`, or `backup.keyless` with the reason in the detail). The mint is audited and logged once the key
  exists, BEFORE its key object's upload, so the line says "backed up once this start is serving", not "from this
  start": if that PUT fails, the start stops (`did not start: object store PUT answered …`), and the next start,
  finding the key here, puts it without a second `minted` line.
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

## R6: delete locked at once, erased after 24 hours (10-27)

Mike's change of 10-26's "at once, everywhere" (DESIGN Q4, §5.4): delete is a soft delete with 24 hours to keep the
account, and "delete everything now" beside it. Built on master 087c3b85; the guarantees are CONTRACT §27.

- **The state is the accounts row, not the process.** `pending-delete` on the person and the store, and
  `people.delete_after`, are in the replicated control database. The lock on the store is `Tenants.locked`, asked on
  every acquire, so it holds across a restart and lifts with a keep, with no in-memory set to rebuild. `retire` stays
  for the erase, which is final.
- **A pending store is still a live store** (`liveStoreIds`). Leaving it out would have dropped it from a rewrap's
  key-object re-upload (`syncKeyObjects`): the old KEK version dropped afterwards, a keep, and its backup could no
  longer be opened. It would also have dropped it from a restore and from start-up's key adoption on a new volume. So
  it stays in, and `Backups.ensureAll` alone learns `locked`: never a NEW key for it.
- **Keep and the deadline are one condition from two sides.** `keep` needs `delete_after > now`; the timer's
  `markDeleting(…, { due: true })` needs `delete_after <= now` and `state = 'pending-delete'`. Each is one statement,
  so the timer can never erase an account a keep just brought back, and a keep never lands after the erase began.
- **Sign-in had to learn a second state.** `requestLink`, `useLink` and the session lookup gated on `isLive`, so a
  pending person got no email at all. They now use `canSignIn` (active or pending); `sessionPerson` stays active-only,
  and `sessionPendingDelete` is the one other way a session counts, used by the pending page, keep, delete now and
  sign out. `isLive` stays active-only for `authenticate` and the OAuth library's `findAccount`.
- **The OAuth library's login session outlived the grants, and crashed the next authorize.** A library `Session` row
  naming an account `findAccount` no longer finds made its consent check throw (`oidc.grant` undefined): a 500 on
  `/oauth/authorize` in that browser. `revokeAccount` now deletes the person's library sessions too, so that browser is
  asked to sign in and lands on the pending page. The same 500 would have hit a suspended person's browser before
  (suspension revokes nothing, INTERFACE-GAPS §18); it isn't fixed for suspension here. The delete is a scan of the
  `Session` rows with `json_extract` (no index on a session's account): fine for a beta of twenty.
- **The tests drive the real timer.** `AppOptions.finishEveryMs` (ten minutes by default) runs it every few
  milliseconds, and `AppOptions.now` now reaches `Accounts` and the pages too, so an injected clock stands in for the
  24 hours (`test/delete.test.ts`).

### The #659 review (high), and its fixes

Each fix has a test in `test/delete.test.ts` ("the #659 review") or `test/ops.test.ts`.

- **BLOCKING: the pending state committed, then the revoke failed, and a keep brought the old connection back.** The
  reviewer made `revokeAccount` throw once: the delete page answered 500 although the delete had taken effect, and
  after Keep the OLD access token answered 200. Now the revoke and close after the commit are audited, not thrown
  (the done page renders); every finish tick revokes again for every pending person (which also heals a crash
  between the two writes); and a keep revokes first, refusing (503) if it can't.
- **Medium: a call authenticated before the delete, its body sent slowly, ran after the lock** and returned memory
  text with 200 on Node 24 (bun hides it, as it hides other mid-body behaviour, §21). The door now asks a `gate` once
  the body has arrived (`remote/http.ts`, `McpPostOptions.gate`) and answers 401; the store's queue checks the lock
  again at each call's turn. With only the queue check the same probe answers 200 with "internal error" and no
  memory; with neither it returned the memory. The delete page no longer waits for that body (the close isn't awaited).
- **The restore CLI opened a pending store** (its cache rebuild consumed the marker). It now restores it and leaves
  it closed, like start-up.
- **INTERFACE-GAPS §36 (was §34) was wrong:** `oauth.sqlite` restores with `accounts.sqlite`, so an early restore brings the
  account back connected, not only active. Corrected, with the `pending/<storeId>` marker as an option.
- **Wording:** "after <time>", not "at" (the timer's tick); "isn't read by us or any AI, shown or used" (the sidecar
  still reads the file to back it up).

### The #659 re-check

- **HIGH: a held call ran on its old token after a Keep.** A request authenticated before the delete, its body sent
  slowly, then delete, a fresh email sign-in and Keep, all before the body ended: the call ran and returned memory
  (200, Node 24; bun answered 401 and hid it). The gate and the queue's check both asked `isLocked`, a property of
  the store, and Keep clears it; what changed was the grant. The same hole was there before R6 for `/account/disconnect`.
  Now the door re-runs `authenticate` on the same token inside the store's queue, just before each call, and refuses
  unless it is still the same person and store. That also covers a whole body queued behind another call while a
  delete and a Keep land (a test the review didn't write: it tells a token check from a lock check). `touchGrant`
  writes at most once in ten minutes, so the extra check is two reads per call.
- **LOW: a queued call refused by the lock answered 200 with JSON-RPC "internal error".** `one()` in
  `remote/http.ts` caught `StoreLocked`. `McpPostOptions.refusal` now lets the door turn a call's error into an HTTP
  answer for the whole request (`401` for a locked store or a revoked token, `503` when the re-check throws). In a
  batch, answers already made were dropped with it (changed by R7's rider, below).
- All four cases (slow body + Keep, slow body + disconnect, queued + lock, queued + delete and Keep) fail on Node 24
  without the change and pass with it, on both runtimes.
- **start-over refuses a store set to be deleted** (operator only; it read `liveStoreIds`, which includes pending).

## R7: a lived volume beside a bucket with no control key (10-27)

From the #658 review (its T2/T3). `prepareVolume` let any volume start beside a bucket with no control key, and the
start then made the volume a control key in that bucket and replicated the control databases there. On a volume that
had lived, that is a wrong `R2_BUCKET` (or a lost `keys.sqlite` beside one): the control writes made in that window
went to the wrong bucket, and fixing `R2_BUCKET` then refused "a different key" with a manual way back (`rm -rf
/data/keys`, `CONTROL_ASIDE`, `RESTORE_ON_BOOT`) that lost those writes. #658's (f)/(f2) kept it from minting STORE
keys there, but the control key itself was made. The guarantee is CONTRACT §31.

- **Refused now, unless `NEW_BUCKET` names the bucket.** Lived = a person or a store (the #661 review's HIGH 2,
  below; the brief's `localKey || present.length > 0` gave false refusals). A volume with nothing to lose starts with
  no variable.
- **The refusal names its case from what the volume holds** (`main.ts#emptyBucket`): a turn-on cut short; the control
  key here (T2: the bucket is most likely wrong); a key file without it (T3: `keys.sqlite` lost, and the bucket most
  likely wrong); none (a `BACKUPS=off` volume). A key file (`control/litestream.key` or a store's) tells T3 from off
  because a `BACKUPS=off` run never writes one (the M2 refusal leans on the same files).
- **T3 fixed now needs no `rm -rf /data/keys`.** No control key is made at the refused start, so the right bucket
  refuses for the control key as #653 designed, and `CONTROL_ASIDE` + `RESTORE_ON_BOOT` bring the control databases
  back. A test runs it through serve.
- **Chosen: `NEW_BUCKET=<R2_ENDPOINT's host>/<R2_BUCKET>`, not `=1`.** Bound to both, so one left set never vouches for
  a different bucket or account (the dangerous later mistake is exactly a changed `R2_BUCKET`), and the refusal prints
  the line to paste. No guard file like `CONTROL_ASIDE`'s: once used, the bucket has the control key and the variable
  changes nothing (each start says so until it is unset).
- **Found: `BACKUPS=off` → on left every store unbacked for good, before R7 too.** The stores lived (`opened_at`) with
  no key anywhere, so R5's mint refused them: `bucket-unproven` at the first start, then `keys-newer` at every start
  after (the control key is newer than every store by construction). Now the turn-on is a fact in `keys.sqlite`
  (below), and every store opened before it has (f) and (f2) waived; (c), (d) and (e) still check the bucket. Such a
  store never had a key to lose, and both checks exist to doubt exactly what the operator said.

### The #661 review (high), and its fixes

Each has a test in `test/ops.test.ts`'s R7 block, through a spawned serve with `s3.fault`.

- **HIGH 1: the waiver lasted one start, and "never backed up" was read from files a start makes before anything
  reaches the bucket.** An off → on start cut short by the control key's PUT (P1) was then refused as "has been backed
  up … most likely wrong", and with `NEW_BUCKET` again its store went `bucket-unproven`, then `keys-newer` for good;
  likewise a replica LIST that failed at that start (P1b), and a store whose delete was pending then and kept later
  (P5). Now `app.start` records `backups-turned-on` in `keys.sqlite` before anything else, the waiver is read from it
  at every start for the stores opened before it, and `ensureAll` records `control-key-in-bucket`; a turn-on fact
  without that one is "a turn-on cut short", which `NEW_BUCKET` finishes. In `keys.sqlite`, so a volume that lost it
  loses the waiver too (T3 stays safe). Sabotage-checked: without the waiver the four off → on tests fail.
- **HIGH 2: a first deploy could be refused with false text.** A first start whose second GET failed (P6) or whose
  token was read-only (P2) left `keys.sqlite` (and a control key) and control databases, and the next start was
  refused as T3 or T2. Now a volume with no person and no store starts as a new server whatever it holds; that also
  ends the invite-before-the-first-start refusal. `keys.sqlite` existing no longer counts as a backup trace in R7.
- **LOW 3:** `NEW_BUCKET` binds `R2_ENDPOINT`'s host too (a move between Cloudflare accounts keeps the bucket's name).
- **LOW 4:** T3 never takes `NEW_BUCKET`, and its refusal doesn't print one.
- **LOW 5:** a store's `litestream.key` counts as a backup trace (T3, and M2's `BACKUPS=off` refusal), and M2 now
  also stands in front of `invite`, `rewrap` and `start-over`.
- **LOW 6:** `restore` stands behind the R7 check (`emptyBucketGate`): `restore --all --force` beside a wrong, empty
  bucket put the control key there.
- **LOW 7 (the rider):** `REFUSED_ERROR` is -32050; -32001 is the TS SDK's `RequestTimeout`.

### The #661 re-check (approved), and three small items

- **P7:** a store with no `opened_at` at the turn-on (an image upgrade and `NEW_BUCKET` in one deploy) was marked by
  the start's heal AFTER `backups-turned-on`, so it was never "opened before" and stayed `keys-newer`. The heal now
  runs first, and the waiver compares `<=` (the two writes can share a millisecond; nothing opens a store before the
  server listens).
- **A3:** an `accounts.sqlite` that isn't a database got the BACKUPS=off text, and `NEW_BUCKET` there would only have
  crashed in `Accounts`. It has its own refusal now, without `NEW_BUCKET`.
- **The hosted-bun flake** ("restore by hand", `ops.test.ts`): it waited for any object under the store's prefix, which
  `wake` had already put. It now waits for the remembered words in the replica's bytes (`replicatedText`).

### R7's rider: a refusal inside a batch keeps the answers made (the #659 re-check, LOW)

- **A batch's refusal replaced the whole answer, including messages that had run.** `[remember, recall]` with a
  disconnect landing between them answered `401`, but the remember was written: a client sending the batch again
  writes twice (worse with `503` and `Retry-After`, which says "send again").
- **Now** (`remote/http.ts#handleMcpPost`): until a message of the request has reached the server, a refusal still
  answers the whole request (`401`/`503`, with its headers). Once one has, the answers made are kept, HTTP is `200`,
  and the refused message and each one refused after it carries `REFUSED_ERROR` (-32050, "refused (HTTP 401): this
  message did not run", `data: { status, retryAfter? }`). A message that threw anything else counts as run (it may
  have written). Single messages, all claude.ai sends (MCP 2025-06-18 has no batches), are unchanged.
- **The test builds the window for real** (`test/delete.test.ts`, the rider block): the store's queue is held, the
  batch queued, a second hold queued behind its first message, the disconnect made once the remember ran, then the
  recall re-checks its token. It fails on Node 24 without the change.

