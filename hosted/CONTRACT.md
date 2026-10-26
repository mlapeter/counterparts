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
  `not_started`, so the first wake offers the first meeting. Dreaming is set `off` explicitly, because `auto` is Claude
  Code's headless run and `ask` would make the wake ask, and claude.ai has neither. The person's own routine runs the
  night through the `dream` tool, which the setting does not gate; a test pins that.
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

    A test reads R2 right after the delete: nothing of the store is left, including a final flush the sidecar makes on
    its way out. The store turns `deleting` first, durably: start-up never gives it a new key, and a delete cut short
    (a crash, R2 down) is finished at start-up and on a timer. The delete asks for the typed address and a CSRF token.
28. **Export** is the core's own database export (`cli/export.ts`): one SQLite file. It is made inside the store's
    queue, sent only to the signed-in person behind CSRF, and the scratch copy (on the data volume, under `scratch/`, swept at
    start-up) is removed after sending.

## What it drops, for now

- Restore, the Dockerfile and the rest of operations: the ops step (`INTERFACE-GAPS.md`).
- Rate limits on `/mcp` and size quotas: the ops step.
- The 2026-07-28 stateless revision: later, behind a version switch (DESIGN §3).
