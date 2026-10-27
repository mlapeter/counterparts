# hosted/ — the hosted server (app.counterparts.ai)

**Added 2026-10-26** (online plan OL2). A working default for a private beta of up to about 20 people. The design and
its open questions are in `docs/hosted/DESIGN.md`; this page states what the built code keeps.

## Purpose

claude.ai's chat reaches a memory only as a remote connector. This package serves many people's stores from one
process, behind our own accounts and OAuth: one person, one store, one door at `/mcp`.

## What it is, and is not

- **A private package, never published** (`"private": true`). It ships as a container. It is not in the npm
  tarball: the root `package.json` `files` lists `src/` and named docs, and `hosted/test/boundary.test.ts` pins that.
- **It imports the core by relative path** (`../../src/...`), at the same commit. **Nothing in `src/` imports it**,
  and the boundary test pins that too. The core stays zero-dependency, and its inbound-only network guard
  (`test/claude-code.test.ts`) keeps describing `src/` truthfully.
- **Its outbound connections are listed in one file**, `src/egress.ts`, and pinned by a test. A new destination is a
  review event.
- **It runs on Node 24 in production** (DESIGN Q6). Its tests are written with `node:test`, so the same files run
  under Node and under `bun test`. CI runs both.

## Guarantees (built so far)

1. **The store comes from the token and nothing else** (`src/server.ts`). No path segment, header or argument names a
   store. A request with no valid bearer token gets `401` with the `resource_metadata` pointer, and no store opens.
2. **A store id is 128 random bits in lowercase hex**, and no other string ever becomes a path. The id is checked for
   shape and for containment (`isWithin`) on every open (`src/tenants.ts#tenantDir`).
3. **One `McpServer` per store, each with its own queue.** Handles are never shared or reused across stores. An LRU
   plus an idle sweep closes unused stores. A store in use is never closed. A request arriving while its store closes
   waits, then reopens it. `close(storeId)` (account delete) waits on a promise until no call holds the store, never
   a poll of the queue (the 10-26 review: a poll froze the process when it raced an in-flight request), and drops
   the store's worker: its owed run is forgotten and a running child is stopped.
4. **The worker child's environment is allow-listed** (`workerEnv`). `spawn.ts#planSpawn` starts from the parent's
   whole environment; the pool passes on only `PATH`, the locale, `TZ`, `TMPDIR` and, by name, the `COUNTERPARTS_*`
   values the plan pins plus the static weights dir (`WORKER_COUNTERPARTS_ALLOW`), never a prefix match. The child's
   `HOME` is its tenant dir.
5. **At most one worker per store, and at most `max` in all.** Extra boundaries coalesce into one more run.
6. **The call log holds ids and codes only**, plus the store as an HMAC under a per-process salt: matchable, not
   nameable. It never holds a token.
7. **`/mcp` refuses** anything but POST (`405`), a foreign `Origin` (`403`), and a body that is not
   `application/json` (`415`). The last closes the local door's `text/plain` simple-request hole.
   - A token that can't be *checked* (`authenticate` threw, e.g. the accounts database is down) gets `503` with
     `Retry-After`, never `401`, so the client retries instead of asking the person to sign in again.
   - Only origin-form request targets reach a route. `//host/x` and absolute-form targets get `400`, so no route ever
     sees a host the client chose. Every published URL is built from `publicOrigin`.
   - Headers time out at 30 s and requests at 300 s, the same bounds as the local door.

### Accounts and sign-in (step 3: `src/accounts.ts`, `src/pages.ts`, `src/web.ts`, `src/egress.ts`)

8. **The person is the hub.** A person has identities: kind and value, unique, so phone numbers, passkeys and other
   AIs attach later as more rows. A person also has one store.
9. **Every secret is stored as its SHA-256**: login-link tokens, session tokens, invite codes, the browser binding.
   A copy of `accounts.sqlite` signs nobody in. The test greps the file for raw secrets.
10. **A login link works once, for 15 minutes, in the browser that asked for it.**
    - The single-use claim is one `UPDATE … WHERE used_at IS NULL`.
    - The wrong browser is refused without spending the link, so a forwarded email or a mail scanner signs nobody in
      and doesn't burn the link either.
11. **Sign-up needs a live invite.** It is spent at the click, inside the same transaction that creates the person,
    the verified email identity and the store.
12. **The login page never says who has an account.** It shows the same words whether a link went out or not, and
    the email is sent without being awaited, so the response time doesn't say it either. Every ask, refused or not,
    writes one `login_links` row in one commit (a refused one is dead on arrival and keeps no address), so the disk
    write doesn't say it. Rows a day past expiry are swept by the next ask.
13. **Every form is CSRF-bound** (an HMAC of the browser cookie) and Origin-checked. After login, only our own paths
    (`/account`, `/oauth/…`) are followed, checked on the path AFTER dot-segments resolve: `//evil`, `/\evil`,
    `/oauth/..//evil` and schemes all fall back to `/account`.
14. **Rate limits on the login form**: 20 an hour per IP and 5 an hour per address. They live in memory, which suits
    one instance. Behind the proxy, the IP is the LAST `X-Forwarded-For` hop (the one the proxy appended), never the
    first (the client's own words). One proxy hop is assumed; check the header's shape on the first Railway deploy.
15. **Pages carry a strict CSP** (nonce'd inline style and script only), `frame-ancestors 'none'` and `no-store`.
    Cookies are `HttpOnly; SameSite=Lax`, and `__Host-` + `Secure` on https.

### OAuth 2.1 (step 4: `src/oauth.ts`, `src/oauth-adapter.ts`, `src/app.ts`, `src/main.ts`)

16. **oidc-provider 9.13.0, pinned exactly, does the protocol** (DESIGN Q1): DCR, CIMD, PKCE S256 only, resource
    indicators, opaque tokens, refresh rotation, revocation, and `iss` on the response.
    - CIMD is an experiment in this version (`ack: "draft-02"`), so every upgrade is a test run and a changelog read.
    - `token_endpoint_auth_methods_supported` is exactly `["none"]`. Together with
      `client_id_metadata_document_supported: true`, that is what makes claude.ai choose CIMD.
17. **A token is for `/mcp` and nothing else.** Another resource is `invalid_target` at authorize. `authenticate`
    checks:
    - expiry;
    - the audience (`/mcp` or `/mcp/`);
    - the `memory` scope;
    - that the **grant still exists**, so a disconnect or a reused code stops the token on its next call, with no
      cache;
    - that the person is live.
18. **No bearer value is stored.**
    - Access tokens, refresh tokens, authorization codes and registration tokens are kept under `sha256(id)`, with
      their `jti` stripped from the payload. A test greps the control files for the live tokens.
    - Grant and client ids stay readable: they grant nothing by themselves.
19. **The Allow page**:
    - requires our own signed-in person;
    - belongs to the browser that started the authorization (the library's interaction cookie);
    - is CSRF-bound, with `frame-ancestors 'none'`, and its `form-action` allows only us and the app's own return
      origin;
    - names the app by where it really is: a CIMD client by its URL's host, a registered one by its return host
      FIRST, with its self-declared name after as a quoted claim. Only a loopback http return is "an app on this
      computer".
    - A grant is reused without the page (the library's silent re-authorization) only while OUR web session is the
      same person as the library's own session. A sign-out of ours brings the page, and the login, back.
20. **Discovery.** Protected Resource Metadata is at `/.well-known/oauth-protected-resource/mcp` and the root form.
    The authorization-server document is at both `/.well-known/oauth-authorization-server` and
    `/.well-known/openid-configuration`. Every URL is built from `PUBLIC_ORIGIN`: requests reach the library with
    `Host` pinned to it and `X-Forwarded-Host` dropped, because the library builds endpoint URLs from the request.
21. **The CIMD fetch** goes through `egress.ts#cimdFetch`. On Node the library applies its own guard: https only, no
    redirects, a 2.5 s timeout, a body limit, and a refusal of special-use IPs (checked on the connected socket, so
    DNS rebinding doesn't pass). A Node-only test proves the guard reaches our fetch. We add https-on-443 only.
    - **The library fetches nothing else a client names.** `sector_identifier_uri`, `jwks_uri`, `jwks`,
      `backchannel_logout_uri` and `request_uris` are refused at registration and in CIMD documents, and every body
      limit is finite.
    - **Redirect URIs** are https, http on a loopback address only, or a native app's own scheme.
22. **The entry point** (`src/main.ts`) needs everything named, and nothing falls back to a default:
    - `HOSTED_DATA_ROOT`: absolute, and never inside a live store;
    - `PUBLIC_ORIGIN`: https, except in a local `MAIL=log` run;
    - the mail key.

    `invite` prints one code, once.
23. **Rate limits** on the open endpoints: 30 registrations an hour per IP, 600 token calls an hour per IP, and 300
    authorization starts an hour per IP (each can make the server fetch a CIMD document).

### A new person's store (OL1b's finding)

- **A store the server creates starts like a new install** (`tenants.ts#startNewStore`). Onboarding is set to
  `not_started`, so the first wake offers the first meeting.
- **Dreaming starts `auto`, as for every new install** (the roadmap's ruling of 2026-10-26, following Mike's 10-11
  "dreaming on by default"). The setting is the person's wish; the host decides who starts the night.
  - On this host nothing starts the night on its own. The wake makes no dream offer on claude.ai, and no path from the
    server or its worker spawns a night run (that is Claude Code's hooks alone).
  - So the person's own routine runs the night, through the `dream` tool. A test checks that a wake under `auto` plans
    only the worker (`runner.ts`) and no night run, and that `dream` launch works.
  - The src lane OL1d makes "auto on a hookless host spawns no night run" true in `src/` too, and makes launch refuse
    while dreaming is `off`.
- **A store that already exists is never re-initialized.**
- **Still owed:** the meeting's "where it lives" answer waits for OL3's hosted privacy copy.

### Keys, backups, export, delete (step 5: `src/keys.ts`, `src/backup.ts`, `src/egress.ts`, `src/app.ts`)

24. **One seam for the KEK.** All wrapping and unwrapping goes through `KeyWrapper`, and the KEK version rides on every
    wrapped value. In the beta the KEK is a Railway secret (`EnvKeyWrapper`); later it moves to our Cloudflare key
    service. A test pins that only `keys.ts` names the KEK variables or the cipher.
25. **A DEK per store**, made at sign-up and stored only wrapped (AES-256-GCM, the store id and the KEK version as
    associated data; a ring may not hold one key under two versions).
    - Only purpose-bound keys derived from it (HKDF) leave `keys.ts`: today, the store's Litestream SSE-C key.
    - **Rewrap** moves every DEK from KEK N to N+1 without changing it, then compares and re-writes every live store's
      key object, so running it again repairs one that died part-way. Start-up refuses a ring that can't open a key.
    - `keys.sqlite` and `accounts.sqlite` run with `secure_delete = ON` (node:sqlite's default is off): a deleted
      wrapped DEK or address leaves no free cell behind.
26. **What is backed up.**
    - Each store's `counterparts.sqlite`, by the Litestream sidecar, under its own SSE-C key (a 0600 key file beside the
      store).
    - The control databases, under the `control` pseudo-store's key.
    - Each wrapped DEK, once, as `keys/<storeId>.wrapped`.
    - The sidecar's configuration holds paths only. Its environment holds R2 credentials only.
27. **Delete is at once, everywhere.** In one sequence:
    - sessions and grants stop;
    - the handle closes;
    - the store is retired in this process (a call authenticated just before the revoke can't re-open it);
    - the store leaves the sidecar, and the delete waits for the old Litestream child to EXIT (its last upload done);
    - the key file, the wrapped DEK, its R2 object and the whole R2 replica prefix are deleted;
    - the tenant dir is removed;
    - identities, sessions and links are deleted, and tombstones stay.

    Before the key object goes, a tombstone `deleted/<storeId>` (the time, no PII) is written, and it is never removed
    (§31a). A test reads R2 right after the delete: nothing of the store is left, including a final flush the sidecar makes on
    its way out. The store turns `deleting` first, durably: start-up never gives it a new key, and a delete cut short
    (a crash, R2 down) is finished at start-up and on a timer. The delete asks for the typed address and a CSRF token.
28. **Export** is the core's own database export (`cli/export.ts`): one SQLite file. It is made inside the store's
    queue, sent only to the signed-in person behind CSRF, and the scratch copy (on the data volume, under `scratch/`, swept at
    start-up) is removed after sending.

### Operations (OL2b: `src/limits.ts`, `src/backup.ts#restore`, `src/main.ts`, `Dockerfile`, `docs/hosted/RUNBOOK.md`)

29. **The bucket's key is the store's key.** `keys.sqlite` is never replicated, so a new volume has no keys while its
    backups in R2 are encrypted under the keys in `keys/<id>.wrapped`.
    - `ensureStore` adopts a key object the bucket has (`KeyStore.adopt`: it must open under the ring for that store
      id). It makes a new DEK only when neither side has one.
    - When both sides have a key, the bucket's must be the same DEK (a rewrap's new wrapping) before the local one
      is put over it. A different DEK is refused at start-up and left alone.
    - So a volume that lost `keys.sqlite` can never mint a key over its own backup (OL2b found that path).
    - A store that lived (`opened_at`) with no key here and none in the bucket is never given a new one: it is left
      out of the backups and counted at start-up (`keyless`), and the start goes on.
30. **Restore** (`main.ts restore <storeId|control|--all>`, or `RESTORE_ON_BOOT=1` at a start):
    - the key object is adopted first;
    - then `litestream restore -config … -o <file>.restoring -if-replica-exists <file>`, because SSE-C needs the
      configuration and a replica URL can't carry it;
    - then the file is moved into place.

    It refuses:
    - a file already in place, without `--force`. With it, the file in place is moved aside
      (`*.pre-restore-<time>`), never deleted, and Litestream's position for it (`.<name>-litestream`) goes;
    - an id the bucket has no key object for (no key is made for it);
    - a ring that can't open the key object (nothing is written).

    The control databases come back before anything opens them, one file at a time (a file in place is kept). A
    restored store's `cache/` (box 3, never backed up) is dropped, and the marker that rebuilds it is written, BEFORE
    the file moves in. It is rebuilt (`rebuildCache()`) by an open made
    before the server listens (boot) or before the command ends (CLI), or recall would find nothing. One store's
    failing restore is counted and audited, and the others go on.
31. **A volume that isn't the bucket's never makes a control database** (`main.ts#prepareVolume`, before `serve`,
    `invite` and `rewrap`). Once the bucket has `keys/control.wrapped`:
    - a volume without the control key and without control databases restores them (`RESTORE_ON_BOOT=1`), or
      refuses, saying how;
    - a volume without the control key but WITH a control database (made by an `invite` or a `BACKUPS=off` run on a
      lost volume) always refuses: that database isn't the real one, and it would be replicated over it;
    - a volume with the key and a control database missing (a control restore cut short) restores that one alone,
      or refuses.

    Starting anyway would make empty control databases and replicate them over the real ones. A new server with an
    empty bucket starts as before. The same rule stands in front of every control restore (`restoreControl`: the CLI's
    `restore control` and `--all` too). The control key is adopted only when no control file here is kept.
    - `invite` needs the backups named or `BACKUPS=off` said, so it never skips this check by accident.
    - `BACKUPS=off` is refused on a volume that has been backed up (`keys/keys.sqlite` or `control/litestream.key`).
    - `CONTROL_ASIDE=<label>` (`main.ts#controlAsideAtStart`, `serve` only, never with `BACKUPS=off`) moves `control/`
      to `control.aside-<label>` before anything opens it, ONLY on a volume `foreignControlRefusal` refuses (on any
      other, nothing moves, no guard is written, and the start goes on), and AT MOST ONCE PER LABEL: the guard
      `overrides/control-aside-<label>.used` is created (`claimed`) before the move and rewritten (`moved`) after,
      and nothing deletes it (not the day-old sweep, not a restart). A new label re-arms it.
31a. **The bucket's tombstones win.** At every start with backups on:
    - a live store with `deleted/<id>` in the bucket has its delete finished (an accounts database restored from
      before the delete would otherwise bring the account back, with its email);
    - a store whose state is `deleted` and that still has a key object or replica objects (a delete made with
      backups off) has them removed. A delete that cleaned the bucket (`delete.backups`) or an earlier pass
      (`delete.leftovers`) isn't checked again, and one store that fails is audited and skipped.
    - copies set aside (`control.aside-*`, `*.pre-restore-*`) more than a day old are deleted. They hold addresses
      and memories outside the 24 h purge. `overrides/` is never touched.

    The restore CLI never restores a tombstoned store.
31b. **No sidecar until start-up's restores are done** (`Backups.hold`/`release`): a pending delete finished at
    start-up writes the configuration but starts nothing.
32. **A store that lived and lost its files waits for a restore.** `stores.opened_at` (in the replicated control
    database) records the first open, and every start marks each live store whose database is present (a database
    from before the column heals). A store opened before whose DATABASE FILE is missing (a dir left behind by a
    failed restore counts as missing) is refused (`StoreNeedsRestore` →
    `/mcp` `503`, `Retry-After: 300`), and is never re-created empty: an empty store would be replicated over its
    own backup. Such a store is also left out of the sidecar's configuration until it is restored. One that never
    reached the bucket has a way out: `main.ts start-over <storeId>`, refused while the bucket holds any replica of
    it or its tombstone. It's safe against the running server: the store's first open after it gets its key and a
    place in the sidecar's configuration then (`Backups.inConfig`), not at the next restart.
33. **`/readyz`** answers `200` only when start-up finished, the control databases answer, the key ring opened every
    key, and (with backups on) the sidecar is up or reloading. Otherwise it answers `503`. The body is the check
    names and their words (`ok`, `off`, `down`, `starting`): no id, no key, no message. `/healthz` stays liveness
    only.
34. **`/mcp` limits, per account, loose to start** (`limits.ts`):
    - `tools/call`: 120 a minute and 1,500 an hour;
    - 8 POSTs in flight at once;
    - 1 GiB per store (`stores.quota_bytes` wins when set).

    A refused call is a tool refusal the model can relay: `isError`, a `reason` (`rate-limited`, `store-full`),
    plain words, and `retryAfterSeconds` when it is a rate limit. Over the size quota, `recall`, `status`, `wake`,
    `scope` and reading the self page (no argument but `session` or `ifVersion`) keep working. The in-flight cap is a `429` with `Retry-After`. Each refusal
    is logged as its event and the hashed store tag, nothing else. The slot is given back at the answer or when the
    client's socket closes, so an aborted request (bun included) never holds it.
35. **The DCR sweep.** A registered (non-https) client that registered more than 30 days ago and that nobody ever
    allowed (`client_use`, written at its first grant and back-filled from existing grants) and that no grant or
    token names is dropped, along with its registration tokens. It runs at
    start-up and every 10 minutes. A client allowed once is kept, even after a disconnect. CIMD clients are the
    library's cache, and are not touched.
36. **The image** (`hosted/Dockerfile`):
    - Node 24.22.1 and bun 1.3.10 (for the two lockfiles' installs), pinned by tag and digest;
    - Litestream 0.5.17, pinned by version and by the release's own sha256 for amd64 and arm64, checked in the build;
    - it is built to run as `node`, with `/data` made and owned by `node`; the entry point is `main.ts serve`. On Railway, the RUNBOOK's
      `RAILWAY_RUN_UID=0` for a root-owned volume runs it as root (INTERFACE-GAPS §6).

## What it drops, for now

- Replication lag in `/readyz`, alerts, and the Fly fallback (`INTERFACE-GAPS.md`).
- The 2026-07-28 stateless revision: later, behind a version switch (DESIGN §3).
