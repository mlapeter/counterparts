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
   waits, then reopens it.
4. **The worker child's environment is allow-listed** (`workerEnv`). `spawn.ts#planSpawn` starts from the parent's
   whole environment; the pool passes on only `PATH`, the locale, `TZ`, `TMPDIR` and the `COUNTERPARTS_*` values the
   plan pinned. The child's `HOME` is its tenant dir.
5. **At most one worker per store, and at most `max` in all.** Extra boundaries coalesce into one more run.
6. **The call log holds ids and codes only**, plus the store as an HMAC under a per-process salt: matchable, not
   nameable. It never holds a token.
7. **`/mcp` refuses** anything but POST (`405`), a foreign `Origin` (`403`), and a body that is not
   `application/json` (`415`). The last closes the local door's `text/plain` simple-request hole.

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
    the email is sent without being awaited, so the response time doesn't say it either.
13. **Every form is CSRF-bound** (an HMAC of the browser cookie) and Origin-checked. After login, only our own paths
    (`/account`, `/oauth/…`) are followed: `//evil`, `/\evil` and schemes all fall back to `/account`.
14. **Rate limits on the login form**: 20 an hour per IP and 5 an hour per address. They live in memory, which suits
    one instance.
15. **Pages carry a strict CSP** (nonce'd inline style and script only), `frame-ancestors 'none'` and `no-store`.
    Cookies are `HttpOnly; SameSite=Lax`, and `__Host-` + `Secure` on https.

### A new person's store (OL1b's finding)

- **A store the server creates starts like a new install** (`tenants.ts#startNewStore`). Onboarding is set to
  `not_started`, so the first wake offers the first meeting. Dreaming is set `off` explicitly, because `auto` is Claude
  Code's headless run and `ask` would make the wake ask, and claude.ai has neither. The person's own routine runs the
  night through the `dream` tool, which the setting does not gate; a test pins that.
- **A store that already exists is never re-initialized.**
- **Still owed:** the meeting's "where it lives" answer waits for OL3's hosted privacy copy.

## What it drops, for now

- Keys, backups, export and delete: step 5, which waits on Mike (DESIGN §5).
- Rate limits on `/mcp` and size quotas: the ops step.
- The 2026-07-28 stateless revision: later, behind a version switch (DESIGN §3).
