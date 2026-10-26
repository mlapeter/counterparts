# The hosted server: design (OL2, step 1)

2026-10-26. The design checkpoint for the online plan's OL2 lane (`~/counterparts-notes/2026-10-26-online-plan.md`).
Nothing here is built yet. Like everything outside `CONSTITUTION.md`, this page is a working default, held loosely: if
building teaches something better, the build stops and says so.

**Where it runs.** `https://app.counterparts.ai`. The connector is at `/mcp`. Sign-in, OAuth and the account pages are on
the same host (decision 2).

**Who it's for.** Mike first, then Katie, then 5 to 20 invited people (decision 3). Then a high security review, before
anyone outside the family.

**Evidence marks.** **M** = measured in this step's spikes (§11). **V** = vendor or spec docs. **F** = forum or bot
answers only. **I** = inference.

---

## 0. Open questions, each with a recommendation

Each question is flagged, not quietly decided. These are what the coordinator relays.

| # | Question | Recommendation | The main tradeoff |
|---|---|---|---|
| Q1 | OAuth library | **`oidc-provider` 9.x** (panva), pinned exactly, in the hosted package only. Fallback: a hand-written authorization server rewritten in `hosted/` on the phone project's pattern, about 400 lines there (that repo is reference only, never imported) (§4.6) | A certified, maintained protocol core, against roughly 33 transitive packages and a big configuration surface we must set correctly |
| Q2 | Encrypt the SQLite file itself, or rely on an encrypted volume plus per-user-key backups | **Volume at rest plus per-user-key-encrypted backups** for the beta (§5) | A copy of the live disk is readable plaintext if Railway's disk encryption doesn't hold. File-level encryption would close that, but neither built-in driver can do it (**M**) |
| Q3 | How backups leave the host | **Litestream v0.5.13+, one `path:` entry per store, each with its own SSE-C key file**, to R2 (§5.3) | Point-in-time restore, but the config is static (regenerated and reloaded per signup or delete), and R2 sees the key on each request. The alternative: our own snapshot shipping, encrypted on our side (the provider never holds a key; loses up to one interval of writes) |
| Q4 | When a delete becomes unreadable everywhere | **Answered by Mike (2026-10-26): at once, everywhere.** Each wrapped DEK is one write-once R2 object, deleted with everything else (§5.4) | The control databases' backup history keeps a deleted address for Litestream's snapshot retention (24 h); flagged in §5.4 |
| Q5 | Where the code lives | **`hosted/` at the repo root**: a private package with its own `package.json` and its own dependencies, left out of npm `files`. It imports the core by relative path (§8) | The core stays zero-dependency and its network guard stays honest, at the cost of a second package in one repo |
| Q6 | Which runtime runs the hosted server | **Node 24 LTS in the container** (the package already runs on Node through `node-hooks.mjs`). Tests run under bun too (§8.2) | `oidc-provider` supports Node only and prints "Unsupported runtime" on bun, even though the spike passed there (**M**) |
| Q7 | The background worker (`wake` spawns `runner.ts` per boundary) | **Keep the child process, through the existing `Spawner` seam, behind a global cap and one pending run per store.** In-process comes later (§2.5) | It reuses the proven runner and isolates CPU, at the cost of one short-lived process per run |
| Q8 | MCP protocol versions | **2025-06-18 and 2025-11-25 first** (what claude.ai documents). Then 2026-07-28 behind a version switch (§3) | Shipping what clients send today, against spec-first |
| Q9 | Which host the hosted door serves | **Always `claude-ai`**, one surface. It never switches on the client's name, even when Claude Code connects (remote CONTRACT) | Claude Code reaching the hosted URL is served as a chat host. That is honest, and its hooks aren't there anyway |
| Q10 | Invite-only beta | **Invite codes** (one table). Sign-up is open to anyone holding a code | A little friction for a hard cap on who is in |
| Q11 | Connection lifetime | **Refresh tokens last 30 days, sliding, with no absolute cap in the beta.** The phone capped at 90 days | Fewer silent "reconnect" breaks in a memory people rely on, against an older grant living longer. Disconnect is always one click |

Lanes others own, where this lane takes the plan's defaults:

- **readOnly honesty** (OL1b): `recall` and `wake` record use credit, so they are not marked readOnly.
- **One surface or a night URL** (OL1b): one surface, `/mcp`.

---

## 1. What carries over from `src/adapters/remote/`, and what the hosted door revises

`remote/` serves the same `McpServer` as the stdio server, over plain-JSON Streamable HTTP. It does this through one secret
path on 127.0.0.1, for a tunnel the owner starts. The hosted door keeps the transport and the server. It replaces the
gate.

**Kept as is.** These are the transport's own rules, and they hold for both doors:

- The memory is the unchanged `McpServer`. No memory rule lives in the transport.
- Plain JSON answers. GET and DELETE get `405`, and no SSE stream is offered.
- One message at a time reaches a given `McpServer`. It keeps per-call state on the instance: the binding and the write
  guard.
- Bodies over 1 MB get `413`. A body that isn't JSON gets `400` with JSON-RPC's parse error.
- A throw answers "internal error" and never its message.
- The call log holds ids and codes only.
- The host is fixed by the entry point, never by the client's name.

**Revised for the hosted door.** The local trial door keeps all of these; they are proposed edits to `remote/CONTRACT.md`,
made in the build PR that adds the hosted door, not now.

| `remote/CONTRACT.md` today | Hosted door |
|---|---|
| G1: binds `127.0.0.1` only | Binds `0.0.0.0:$PORT` inside the container. Railway's proxy terminates TLS. The loopback guarantee is restated as **the local door's**, and the hosted entry point is the only one that may bind wider |
| G2: answers only under `/<secret>`; every other path gets the same `404` | Answers at the fixed path `/mcp` (and `/mcp/`, without a redirect). Calls are gated by an **OAuth bearer token** (§4). With no valid token: `401` plus `WWW-Authenticate: Bearer resource_metadata="https://app.counterparts.ai/.well-known/oauth-protected-resource/mcp"`. The secret path stays the local door's |
| G3: the secret appears only in the `url` line | No secret path. Tokens are never logged; only token ids, hashed, appear in audit rows |
| G4: one queue in front of `handle` | **One queue per store** (§2.3). Two people never wait on each other's queue |
| G6: inbound only | Not true of the hosted process. It sends email (Resend), fetches CIMD documents (§4.4), and its Litestream sidecar talks to R2. The egress list is enumerated in `hosted/` and pinned by its own test. `src/`'s guard (`test/claude-code.test.ts:357`) stays as it is, because `src/` doesn't change |
| "Drops: Origin/Host checks, CORS, Content-Type" | **Added back.** An `Origin` header that is present and not on the allow-list gets `403` (the 2026-07-28 spec requires this). `Content-Type: application/json` is required on POST, which closes the `text/plain` simple-request hole the #634 review named. CORS goes only on the metadata, token, register and revoke endpoints, never on `/mcp` or the account pages |
| INTERFACE-GAPS §2: bind a conversation by connection | Dropped. 2026-07-28 removes `Mcp-Session-Id`, and claude.ai reuses one connection across chats anyway (trial). A conversation is the session id `wake` returns, passed on each call. This is already the instruction block's rule 1 |

**The refactor this needs** (build step 1). `http.ts` today is one function that does both the listening and the request
handling. It splits into:

- a pure request handler: body limits, JSON-RPC framing, batch handling, the call-log record;
- the local listener: loopback plus the secret path, unchanged in behaviour, so the existing tests pass untouched.

The hosted server mounts the same handler behind its own router and auth.

---

## 2. Many stores in one process

### 2.1 Layout on the volume

```
/data/                          HOSTED_DATA_ROOT; named explicitly, refused when unset
  control/accounts.sqlite       people, identities, sessions, OAuth, invites, audit (§6)
  control/oauth.sqlite          oidc-provider's adapter rows (hashed ids, §4.5)
  keys/keys.sqlite              wrapped per-store keys. NOT replicated by Litestream (§5.4)
  tenants/<store_id>/           store_id: 128-bit random, never derived from an email or a name
    store/                      a normal Counterparts store dir (counterparts.sqlite, cache/, journal/, sessions/, spans/)
    config.json                 this store's configuration, synthesized (§2.4), mode 0600
    scopes.json                 the scope registry the server writes beside its config
    litestream.key              this store's SSE-C backup key, mode 0600 (§5.3)
```

- The store dir sits one level down, inside the tenant dir. The store's layout check (`assertLayout`) refuses unclassified
  top-level names, so the tenant's own files must sit beside the store dir, never inside it.
- The path to a store is resolved from the `stores` row and never from anything in a request. It is re-checked with
  `isWithin(HOSTED_DATA_ROOT/tenants, dir)` (`store/paths.ts:92`) on every open.
- `liveStoreRefusal` runs too. It is cheap: in the container `homedir()` is not Mike's, but the check still documents the
  rule.
- The container sets `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`.
- **Mike's hosted store is new.** No code path in `hosted/` takes a local path, a `~` path, or a CLI-style `--dir`. A store
  is created empty at sign-up. Stage 3 (sync) is a later design.

### 2.2 From a request to a store

1. `POST /mcp`, with a `Bearer` token.
2. oidc-provider's `AccessToken.find` looks the token up. It is opaque, and the adapter hashes it (§4.5).
3. The token is checked: not expired, audience is exactly `https://app.counterparts.ai/mcp`, scope is `memory`, the grant
   isn't revoked, the person is live.
4. The grant's account id gives the person. The person's `stores` row gives the store.
5. `tenants.get(store_id)`: the open handle, or one opened now.
6. The handle's queue, then `McpServer.handle(request)`.

Nothing in the request names a store. **The token is the only key, and a token names exactly one person.** A person has
one store in the beta. The table allows more, for later.

### 2.3 Tenant handles (the per-store queue)

- **One `McpServer` per store**, opened with `openServer({ dir, host: CLAUDE_AI_HOST, env: {}, … })`, the same call
  `serve-http.ts` makes.
- **One serial queue per handle.** This is today's `serial` lifted out of `http.ts` and made per-store. Different stores
  run concurrently; one store's calls run one at a time.
- **An LRU of open handles.** Default cap 64, plus an idle timeout of 10 minutes.
  - Eviction waits for the handle's queue to drain, then calls `forgetLaunch()` and `counterpart.close()`.
  - A request that arrives during eviction waits for the close, then reopens.
  - **A handle is never shared or reused across stores.** Isolation tests pin this (§9).
- **One embedder for the whole process.** The static potion table is about 30 MB, so it is loaded once and passed to every
  `openServer` as `embedder`.
  - To confirm while building: the embedder keeps no per-store state.
- **The process log** (`openLog`) is per store and lives in that store's own `sessions/log/`. That is already how it
  works.
- **The service-level call log** is one file for the whole process, outside every tenant dir. It holds ids and codes, plus
  the store id hashed with a server salt, so a log line can be matched to a store without naming one.

### 2.4 A store's configuration

`serve-http.ts` reads a named configuration file. The hosted server builds one per store from its `stores` and `people`
rows:

```
{ dataDir: <tenant>/store, timeZone: people.time_zone, snapshots: { dir: <none> }, pageWriter: default, embedder: default }
```

- The server uses it in memory.
- It is also written to `<tenant>/config.json`, because the worker child (§2.5) reads its configuration from a path.
  `livePathRefusal` already refuses a config inside a live store.
- **`time_zone` is a column in `people`.** The night and "yesterday" turn on it. It is set at sign-up from the browser's
  `Intl` zone, and can be changed on the account page.
- **Snapshots are off for hosted stores.** Litestream is the backup (§5.3). A pre-migration copy (`pre-migration.ts`)
  still goes to `<tenant>/premigration/`, outside the store dir, and is deleted after a successful migration plus 7 days.

### 2.5 The background worker (Q7)

`wake` calls `lc.spawnWorker` (`mcp/server.ts:2891`). That starts a detached `runner.ts` child: the lagged cue, embedding
backfill, the Hebbian flush, sleep and decay. The hosted server passes `lifecycle.spawner` (`server-options.ts:136`), a
`Spawner`, which:

- **coalesces**: at most one pending or running worker per store;
- **caps** the process at N concurrent workers (default 2) and queues the rest;
- pins the child's environment exactly as `spawn.ts` does today: the data dir last, the watchdog, the tenant's config
  path. **No credential, no other tenant, and no host environment** are passed.

Why children and not in-process for the beta:

- the runner is proven code with its own watchdog;
- a sleep cycle is synchronous SQLite work that would block every other store's calls on the event loop;
- process isolation is a second wall between stores.

The in-process queue becomes worth it if the process count or the model reload (each child loads the static table) starts
to cost too much. Open question Q7.

**Nights.** The plan's decision 6 is the user's own routine, through the tools (`remote/NOTES.md`, "a night through the
tools alone"). No server-run night in the beta. The tagging child's `tags` phase stays skipped on this host, as on the
trial door.

---

## 3. The MCP transport: today's clients, then 2026-07-28 (Q8)

Claude's connector docs list the 2025-03-26, 2025-06-18 and 2025-11-25 auth specs. 2026-07-28 isn't mentioned (**V**,
phone research §2). The trial saw claude.ai offer 2025-11-25 (`remote/INTERFACE-GAPS.md` §4).

**Build first.**

- Negotiate 2025-11-25 as well as 2025-06-18. This is `mcp/protocol.ts#PROTOCOL_VERSIONS`, which the mcp module owns; it
  changes in one coordinated PR.
- `initialize` stays optional: `McpServer.handle` already serves `tools/call` without one.
- `Mcp-Session-Id` is still issued at `initialize` for 2025-era clients and logged, but **never used for routing or
  binding**. Any instance could serve any request; there is one instance anyway.

**Then, behind a version switch** (spec changelog, **V**):

- `server/discover`;
- per-request `_meta`: `io.modelcontextprotocol/protocolVersion`, `clientCapabilities`, `clientInfo`;
- `resultType: "complete"` on every result;
- `ttlMs` and `cacheScope` on list results;
- the `Mcp-Method` / `Mcp-Name` request headers, with `HeaderMismatch` (`-32020`) when they disagree with the body;
- `UnsupportedProtocolVersion` (`-32022`).

None of this changes a memory rule. It is `mcp/protocol.ts` and `remote/http.ts`.

**Calls that run long.** Every call takes milliseconds except `recall` by meaning, which takes about 100 ms. claude.ai
allows 240 s per tool call (**V**), so plain JSON is fine.

---

## 4. Accounts, sign-in and OAuth 2.1

### 4.1 Our own accounts (decision 2)

- The **person** is the hub, and a person has **identities**: email now; phone numbers, passkeys and later other ways in.
- A person owns a **store**, and **connections** (connected AIs) are OAuth grants to that person.
- Tables are in §6.
- **One login across phone and memory** is a later decision. This design doesn't block it: identities are separate rows
  keyed by kind and value, so a phone number or a shared login provider attaches as another identity.

### 4.2 Logging in: an email link first

1. On `/login` you enter your email. We send a link through **Resend's HTTP API** (the phone project's provider), from
   `memory@counterparts.ai` or similar. That needs a verified sending domain, which is Mike's step.
2. The link's token is 32 random bytes, stored hashed (SHA-256). It lasts 15 minutes, works once, and is bound to the
   browser that asked by a cookie: the phone pattern, `oauth.ts#startedHere`.
   - Opening the link in another browser shows "open it in the browser where you started", with a re-send button. No
     cross-browser login in the beta.
3. A web session cookie follows: `__Host-cp_session`, random, stored hashed, HttpOnly, Secure, SameSite=Lax. It lasts 30
   days, sliding.
4. Rate limits: per email (5 an hour) and per IP (20 an hour).
   - Messages are identical whether or not the address is known, so the form doesn't reveal who has an account.
   - Sign-up needs an invite code (Q10).
5. Passkeys come later (WebAuthn: a new identity kind, no table change). SMS codes come when texting arrives.

### 4.3 OAuth endpoints and paths

On a subdomain the root `/.well-known/` paths belong to us. That avoids the phone's two pitfalls: the trailing-slash `308`
before a rewrite, and well-knowns placed under a path.

| What | Where |
|---|---|
| Resource (exactly what people paste) | `https://app.counterparts.ai/mcp` |
| Protected Resource Metadata (RFC 9728) | `/.well-known/oauth-protected-resource/mcp` (path-inserted, which the 401 header names) **and** `/.well-known/oauth-protected-resource` (root fallback). Same document: `resource`, `authorization_servers: ["https://app.counterparts.ai"]`, `scopes_supported: ["memory"]`, `bearer_methods_supported: ["header"]` |
| Issuer | `https://app.counterparts.ai`. No path, no trailing slash |
| AS metadata | `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration` (clients must try both) |
| Endpoints | `/oauth/authorize`, `/oauth/token`, `/oauth/register` (DCR), `/oauth/revoke`, set by the library's `routes` config |
| The Allow page | `/oauth/allow/<uid>`: our page, the library's "interaction" |
| Callbacks we expect | `https://claude.ai/api/mcp/auth_callback` (also `https://claude.com/...`, unconfirmed), and loopback on any port for Claude Code (RFC 8252 §7.3) |

- `/mcp` and `/mcp/` both serve, with no redirect. `resource` matching accepts both spellings and nothing else.
- The resource must equal what the user typed, path included (**V**). We publish the slashless form everywhere.

**What claude.ai needs** (**V**, hosting research), and where each comes from:

| Requirement | Where it's met |
|---|---|
| PKCE S256 only | the library |
| A 401 with `resource_metadata` | ours |
| CIMD advertised as `client_id_metadata_document_supported: true` together with `"none"` in `token_endpoint_auth_methods_supported` | the library, configured with `clientAuthMethods: ["none"]` so no secret methods are listed; the spike's default listed five (**M**) |
| DCR as the fallback | the library |
| Refresh tokens rotate; an expired one gets `invalid_grant` | the library; spike: rotated, the old one refused (**M**) |
| `/token` accepts form-urlencoded bodies | the library |
| 10 s timeouts on discovery and token | ours: nothing slow on those paths |
| `iss` on the authorization response (RFC 9207) | the library; spike: present (**M**) |

### 4.4 CIMD and DCR

- **CIMD.** The `client_id` is an https URL. The server fetches the client's metadata document from it, which makes this
  an **SSRF surface**. oidc-provider has an `allowFetch(ctx, clientId)` hook and bounded caching (30 s to 1 day). We add:
  - https only, port 443, no credentials in the URL;
  - DNS resolved and checked against private, loopback and link-local ranges before connecting;
  - no redirects, a 3 s timeout, and a 16 KB cap;
  - an allow-list mode, off by default but one config flag away, for if abuse shows up.
  - **The Allow page names the client by its URL's host** (`claude.ai`), never by the document's self-declared
    `client_name` alone.
- **DCR** is open: public clients only, `token_endpoint_auth_method: none`. The phone project's redirect rules apply:
  - https, or loopback http only;
  - no fragments, at most 10 URIs;
  - rate-limited per IP.

  Claude registers a new client on every fresh connection (**V**), so unused DCR clients older than 30 days with no grant
  are swept.

### 4.5 Tokens, the Allow page, revoking and disconnecting

- **Opaque tokens, stored hashed.** oidc-provider gives its adapter the opaque token value as the row id. **Our SQLite
  adapter stores `sha256(id)` and hashes on `find`/`destroy`/`consume`**, so a copy of `oauth.sqlite` holds no usable
  token. Grants, sessions and interactions are hashed the same way.
  - Access tokens last 1 hour; refresh tokens rotate (Q11).
  - A reused authorization code revokes the whole grant; spike: the rotated refresh token was dead afterwards (**M**).
- **Audience.** A token is issued only for `https://app.counterparts.ai/mcp`, and only for the `memory` scope.
  `getResourceServerInfo` refuses any other resource. `/mcp` re-checks `aud` on every call; spike: `aud` was the resource
  (**M**). No token is accepted from anywhere else, and none is passed on.
- **The Allow page.** It shows:
  - who is asking (the client host for CIMD; "an app on this computer" for loopback);
  - what it gets: "read and add to your Counterparts memory";
  - which account is signed in, with "not you?".

  The page also:
  - starts the email-link login inline when nobody is signed in, and the pending request survives that round trip;
  - binds to the browser that started it (a cookie per request, the phone pattern);
  - takes CSRF tokens on the Allow and Deny POSTs, and sends `frame-ancestors 'none'` (clickjacking).
- **Revoke** (RFC 7009): unknown tokens get `200`. Spike: `200` (**M**).
- **Disconnect.** The account page lists the person's grants: client host, created, last used. Disconnect deletes the
  grant, and every token of it stops working on its next use (no JWT cache). Deleting the account removes every grant
  first.

### 4.6 The library choice (Q1)

| Candidate | Server-side CIMD | Dependencies | Verdict |
|---|---|---|---|
| **oidc-provider 9.13** (panva, MIT, OpenID-certified, last modified 2026-10-22) | Yes, as an **experiment**: `clientIdMetadataDocument`, draft-02, needs an `ack` (**M**, source read) | koa, jose, debug: 33 packages installed (**M**) | **Recommended** |
| `@modelcontextprotocol/sdk` 1.32 `server/auth` (mcpAuthRouter) | **No.** CIMD appears only in its client code (**M**, grep) | express plus 16 others | No CIMD; Express |
| `@modelcontextprotocol/server` 2.4 (SDK v2) | It has **no authorization server at all** (**M**, grep) | n/a | Not a candidate |
| better-auth plus `@better-auth/oauth-provider` 1.7 | CIMD types present | kysely, its own schema and its own accounts | It would own the person table, which runs against decision 2 |
| `@cloudflare/workers-oauth-provider` | Yes | Workers runtime only | Wrong platform |
| Hand-written, rewritten in `hosted/` on the phone's pattern (`~/counterparts-phone/lib/oauth.ts`, reference only, never imported) | Not built (DCR only) | Zero (node:crypto) | **Fallback.** The phone's version works with claude.ai today. CIMD would be ours to write |

**Why oidc-provider.** The spike ran it end to end under bun 1.3.10 and Node 24.22, driven by `oauth4webapi` as a strict
client (**M**):

- the discovery doc carried `client_id_metadata_document_supported: true`, `"none"` among the auth methods, S256 only, and
  `authorization_response_iss_parameter_supported: true`;
- an open DCR registration of a public client with claude.ai's callback succeeded;
- an authorize request without PKCE was refused (`invalid_request`);
- the code, PKCE S256 and `resource` flow completed through our own interaction seam (where the login and Allow pages go),
  with `iss` returned;
- the access token was opaque, with `aud` equal to the resource;
- a reused code got `invalid_grant`, and its grant was revoked;
- the refresh token rotated, and the old one got `invalid_grant`;
- revoking an unknown token returned `200`.

What we'd otherwise get wrong by hand is the subtle part: redirect matching, single-use codes, grant revocation on reuse,
refresh rotation, mix-up protection, the error redirect rules. The library has years of review on exactly those.

**Conditions that come with it:**

1. Pin the exact version. CIMD is an experiment, so a minor version can change it, and every upgrade gets a test run plus
   a reading of its changelog.
2. Run on Node in production (Q6).
3. Set `clientAuthMethods: ["none"]`, `pkce.required: () => true`, opaque access tokens via `getResourceServerInfo`,
   `rotateRefreshToken: true`, `issueRefreshToken: async () => true`, and explicit TTLs for every artifact (the spike
   printed "default ttl" notices). Without `issueRefreshToken`, no refresh token is issued unless the client asks for
   `offline_access`, and the spec says servers SHOULD NOT advertise that scope.
4. Disable `devInteractions`. Configure the signing keys (`jwks`) even though we issue no JWTs: the library wants keys for
   any ID tokens, and we leave `openid` out of `scopes`.
5. Write the adapter over `node:sqlite` with hashed ids (§4.5).
6. The library lives only in `hosted/package.json`.

**Zero dependencies.** The npm core (`counterparts` on npm) keeps zero runtime dependencies beyond the model package:
nothing in `src/` imports `hosted/`. The hosted package is private, never published, and ships as a container. The core's
"judgment, not a vow" rule (CLAUDE.md, Amendment 15 spirit) is applied there on its own terms: one well-reviewed protocol
library, plus the test-only clients `oauth4webapi` and the MCP SDK client as devDependencies.

---

## 5. Encryption at rest, per-user keys, crypto-shredding (Q2, Q3, Q4)

### 5.1 What the spikes found

- **Stock `bun:sqlite` and `node:sqlite` can't encrypt a file.** `PRAGMA key` is silently ignored, `PRAGMA cipher_version`
  returns nothing, and the file starts `SQLite format 3` with the row text readable (**M**: bun 1.3.10, and Node 24.22 with
  SQLite 3.53.4). `compile_options` shows no codec (**M**).
- **bun on Linux links its own SQLite statically.** `Database.setCustomSQLite` returns `false` and does nothing off macOS
  (**V**, bun docs). So bun can't be pointed at SQLCipher on Railway.
- **node:sqlite can load extensions** (`allowExtension: true` gives `loadExtension`, **M**). An encryption build loaded as
  an extension would be a VFS shim, such as SQLite3 Multiple Ciphers. Whether that works as a loadable extension is
  **untested**.
- **A native SQLCipher-class driver** (`better-sqlite3-multiple-ciphers` 12.11, which bundles sqlite3mc) installed, but
  building its native binary was **blocked** in this session (the install script fetches external code). It stays
  unmeasured. Mike can allow it if he wants that path measured.
- **Litestream v0.5 removed its own (age) encryption.** It is "not available in v0.5.0+", to be re-implemented in LTX
  later, with no timeline (**V**, migration guide).
  - It supports **SSE-C per replica** (`sse-customer-key-path`) and directory replication (`dir`/`pattern`/`watch`).
    **In `dir` mode one key covers every database** (**V**, config reference).
  - It opens databases through its own SQLite driver and checks each file's header (**V**). An encrypted file would
    almost certainly not replicate (**I**).
- **Railway's volume encryption is unverified.** Forum and bot answers from 2026 say AES-256 covers volumes and backups
  automatically. Two-year-old answers say volumes weren't encrypted (**F**). There is nothing in Railway's docs. **Before
  any non-family user, Mike gets this in writing (trust.railway.com, SOC 2 report or support).**
- **R2 supports SSE-C** and can't recover objects whose key is lost (**V**, Cloudflare docs).

### 5.2 Recommendation (Q2): volume at rest plus per-user-key backups, not file encryption, for the beta

File encryption would need, all at once:

- a native driver neither runtime ships, which makes a third binding at `store/db.ts`;
- the cache database (box 3, which holds FTS text and vectors) encrypted too;
- `journal/` markdown and `spans/` text kept off disk or encrypted;
- the key in every worker child's environment;
- and it would break Litestream, so we'd ship backups ourselves anyway.

It would protect against exactly one thing more: a copy of the live disk read outside our running server. That matters,
but it isn't the realistic threat. A compromised server holds the keys either way.

**The honest privacy claim this supports** (for OL3's privacy page, plain words):

> Your memory is stored encrypted on our host's disks, and every backup is encrypted with a key that belongs to your
> account alone. When you delete your account, your memory, its backups and your key are erased at once, so no copy
> anywhere can be read again by anyone, us included. We hold the keys, so this protects your memory
> from lost disks, leaked backups and our backup provider, not from us: "we don't read it" is our promise, kept by access
> controls and an audit log, not by math. And when Claude reads your memory, Anthropic sees what Claude reads.

**What file encryption would add,** if Mike wants it later: "even a copy of our server's disk is unreadable without our
key service". It is a contained follow-up, because of the key hierarchy below. Measure the native driver first.

### 5.3 Backups (Q3): Litestream with a key per store

- One Litestream sidecar in the same container (the volume belongs to one service).
- It replicates **only each store's `counterparts.sqlite`**. That matches `LAYOUT`'s `backup` flags: `cache/` is
  rebuildable, and `journal/` and `spans/` are never backed up.
- `litestream.yml` is **generated** with one `path:` entry per store, each with `sse-customer-key-path:
  /data/tenants/<id>/litestream.key`, to `r2://<bucket>/tenants/<id>/`.
- The **backup key is derived** from the store's key (§5.4) with HKDF, info `"litestream-sse-c"`. It is written 0600 on
  the volume, because the sidecar must read it.
- Adding or deleting a store regenerates the YAML and restarts the sidecar. It resumes from its `meta-dir`.
  - To verify in the build: whether v0.5 reloads its config on a signal. At 20 stores a restart costs seconds either way.

The alternative, if Mike wants the backup provider never to see a key:

- our own shipper: the existing `VACUUM INTO` snapshot path, then AES-256-GCM (node:crypto) with the derived key, then a
  PUT to R2 (Bun's built-in S3 client, or a signed `fetch`);
- **cost:** no point-in-time restore, and up to one interval of writes lost on a total volume failure. With "15 minutes
  after the last write" as the interval, that is 15 minutes at most.

Railway's own volume backups stay **off**. Their retention is Railway's, not ours, and they would hold the key files.

### 5.4 Keys and crypto-shredding (Q4; as Mike changed it, 2026-10-26, and as built in step 5)

**Mike's answers:**
- Q2 and Q3 accepted.
- The §5.2 paragraph is accepted, now saying "at once".
- The native-driver spike is not run now.
- Two changes to this section:
  1. Delete is **at once, everywhere**.
  2. The KEK sits behind a swappable seam.

- **KEK, behind one seam.** All wrapping and unwrapping goes through one `KeyWrapper` interface (`hosted/src/keys.ts`).
  - Each wrapped key records the KEK version it was wrapped under. Nothing else in `hosted/` touches the raw KEK, and a
    test pins that.
  - **The beta holds the KEK in a Railway secret**: `HOSTED_KEKS` holds the ring of versions and `HOSTED_KEK_CURRENT`
    names the one in use (`EnvKeyWrapper`). Mike also keeps a copy offline; losing the KEK means losing every backup.
  - **Later**, Mike moves it to our own small Cloudflare Worker key service, called only from Railway's fixed egress IP.
    That is a second `KeyWrapper` and nothing else changes.
- **Rewrap** (`main.ts rewrap`, `KeyStore.rewrap`) moves every wrapped DEK from KEK version N to N+1 and re-writes each
  store's key object. One operation covers rotation and the move to Cloudflare.
- **DEK.** 32 random bytes per store, made at sign-up and stored wrapped in `keys/keys.sqlite`: AES-256-GCM under the KEK,
  with the store id as associated data.
  - It keys the store's Litestream SSE-C key, through HKDF with a purpose label.
  - The control databases' backups use the DEK of a pseudo-store, `control`.
- **The key backups: one write-once object per store.** A store's wrapped DEK never changes after sign-up, except by a
  rewrap.
  - It is backed up once, at sign-up, as its own R2 object `keys/<storeId>.wrapped`. A rewrap overwrites it.
  - There is no `keys.sqlite` backup and there are no daily copies.
  - R2 versioning and object lock stay **off** for `keys/` (a bucket setting, in §7.3).
- **Delete, at once** (`app.ts#deleteAccount`, one audit row per step, no content):
  1. the person is marked deleting and the store turns `deleting` (durably: start-up never gives it a new key), so every
     session stops, and every grant is revoked;
  2. the store is retired in the process (nothing re-opens it), and its handle drains and closes;
  3. the store leaves `litestream.yml` and the sidecar restarts; the delete waits for the old child to exit, so its last
     upload can't land after step 4;
  4. the key file, the local wrapped DEK, the `keys/<storeId>.wrapped` object and the whole `tenants/<storeId>/` replica
     prefix are deleted;
  5. the tenant dir is removed;
  6. identities, sessions and pending links are deleted, leaving the person and store as tombstones (id, dates, state).

  A test checks R2 right after the delete: no wrapped key and no replica object. Every step is idempotent; a delete cut
  short (a crash, R2 down) is finished at start-up and on a ten-minute timer. `keys.sqlite` and `accounts.sqlite` run
  with `secure_delete = ON` (node:sqlite's default is off, bun's FAST), so a deleted wrapped DEK or address doesn't stay
  in a free cell of the file, or in every later Litestream snapshot of it.
- **R2 credentials.** R2 gets its own narrowly scoped token: one bucket, objects only. It is used by the object client
  (`egress.ts#r2ObjectStore`, SigV4 via `aws4fetch` 1.0.20, pinned, zero dependencies) and by the Litestream child (its
  own environment). The worker child never sees it (`tenants.ts#workerEnv`).
- **Still open (flagged): the control databases' backup history.** After a delete, `accounts.sqlite`'s Litestream history
  (the snapshot taken before the delete, and the LTX files after it) still holds the deleted address until that history
  ages out. With the defaults (`snapshot.interval` 24 h, `snapshot.retention` 24 h) that is at most about 24 h after the
  delete, plus Litestream's retention-check lag (not measured: no binary in the build). It's SSE-C ciphertext under the
  `control` key, which isn't shredded. The audit rows (person id, action codes, invite id, no address) stay as
  tombstones by design. Store content is gone at once; this is the account row.
  - To make it "at once" too: keep the address encrypted under the person's DEK, plus a keyed hash (HMAC) of it for
    lookup. Then shredding the DEK leaves only the hash in old copies.
  - Recommended: do that before any non-family user.

**Gates before any non-family user** (next to the security review):
1. Railway's disk encryption confirmed in writing.
2. **The Cloudflare key service in place.** The reason: Railway's environment variables were reportedly breached
   recently (Mike's report, not verified). A single leak of them would expose both the KEK and the R2 credentials, which
   means every backup.

---

## 6. Tables (control plane, `control/accounts.sqlite`)

Plain SQLite through the same `node:sqlite` binding (`store/db.ts`'s `openDb`, WAL). It is Litestream-replicated like a
store, under its own SSE-C key derived from the KEK.

```
people        (id TEXT PK, created_at, deleted_at NULL, state TEXT -- active|suspended|deleted,
               display_name NULL, time_zone TEXT, invite_id NULL)
identities    (id PK, person_id FK, kind TEXT -- email|phone|passkey|…, value TEXT -- normalized,
               verified_at NULL, created_at, UNIQUE(kind, value))
login_links   (id PK, identity_id FK, token_hash UNIQUE, browser_hash, expires_at, used_at NULL, ip_hash)
web_sessions  (id PK, person_id FK, token_hash UNIQUE, created_at, expires_at, last_seen_at, ua_hint)
stores        (id TEXT PK -- 128-bit random, also the tenant dir name, person_id FK, created_at,
               state TEXT -- active|deleting|deleted, quota_bytes, size_bytes, size_checked_at)
invites       (id PK, code_hash UNIQUE, created_by FK NULL, max_uses, uses, expires_at, note)
audit         (at, person_id NULL, store_id NULL, action TEXT, detail TEXT -- codes only, never content)
rate_buckets  (in memory in the beta; a table only if we ever run two instances)
```

- **Connected AIs are oidc-provider grants**, in `control/oauth.sqlite` (the library's adapter: one table of
  `(model, id_hash, payload, grant_id, uid, expires_at, consumed_at)`). The account page reads them through the library's
  `Grant` model. They aren't duplicated into `accounts.sqlite`.
- Phone numbers, passkeys and other ways in are `identities` rows. Nothing else changes.

---

## 7. Operations

### 7.1 Railway

- One service and one volume at `/data`, from a `hosted/Dockerfile`. Node 24 slim, Litestream pinned, and a small
  supervisor: the Node server plus the sidecar. If either dies, the container exits and Railway restarts it.
- A service with a volume runs as **one replica** (**I**, to confirm in Railway's docs). That suits a single-instance
  design.
- **Health checks.**
  - `GET /healthz` (unauthenticated, no detail): the process is up, `accounts.sqlite` opens, the volume is writable.
  - `GET /readyz` adds: the sidecar is alive, and the oldest store's replication lag is under 5 minutes.
  - Railway's health check points at `/healthz`.
- **Alerts.** One email to Mike through Resend when any of these hold:
  - replication lag over 15 minutes;
  - the volume over 80% full;
  - the 5xx rate over 2% for 5 minutes;
  - the sidecar restarting more than 3 times in an hour.
  - Plus Railway's own deploy and crash notifications, and an outside uptime check of `/healthz` (BetterStack or
    UptimeRobot free tier; an account, so Mike's word).
- **Rate limits.**
  - Per person on `/mcp`: 120 calls a minute (a night run makes about 40).
  - Per IP on login, register and token.
  - Per client and IP on token, so nobody can drain another person's refreshes (the phone pattern).
- **Size quotas.**
  - 1 GB per store in the beta; measured stores run about 50 MB.
  - `size_bytes` is re-measured at most every 10 minutes, on a write.
  - Over quota, `remember`, `chapter` and `dream` writes get a plain refusal with a reason code. Reads always work.
- **Export.** `GET /account/export` (signed in, with a fresh re-authentication inside 10 minutes) streams a zip:
  - the core's own export, `cli/export.ts`: its `markdown` tree (readable), and its `database` copy (complete,
    openable by anything that speaks SQLite, and the shape a local install could import at stage 3).
- **Delete.** `POST /account/delete` (re-authentication plus typing your email) runs §5.4's sequence. A confirmation email
  goes out afterwards.

### 7.2 Fly.io fallback

The same Dockerfile and the same supervisor. A Fly volume replaces Railway's, with the same `litestream.yml` and the same
R2 bucket. A move is: restore from R2 into a Fly volume, change DNS. A runbook goes in `hosted/RUNBOOK.md` with the ops PR.

### 7.3 What Mike must do (prepared by the build, done by him)

1. Railway: the project, the service, the volume, and the `HOSTED_KEKS` / `HOSTED_KEK_CURRENT` secrets (generate a
   32-byte key, base64). Keep a copy of the KEK offline.
2. Cloudflare R2: a bucket, and an API token scoped to that bucket's objects only. Versioning and object lock stay
   **off** (at least for `keys/`), so a delete is a delete.
3. Before any non-family user: the Cloudflare Worker key service, reachable only from Railway's fixed egress IP (§5.4).
4. Resend: verify the sending domain for the login emails.
5. DNS: `app.counterparts.ai` to Railway, and the TLS certificate there.
6. Written confirmation of Railway's volume encryption (before any non-family user).
7. Optional: an outside uptime monitor.
8. Before adding the connector to his claude.ai: extend `deniedMcpServers` in his `~/.claude/settings.json` to the hosted
   URL and name. The coordinator reminds him; it is his config.

---

## 8. Where the code lives, and how it stays out of the npm core (Q5, Q6)

### 8.1 Layout

```
hosted/                    private package "counterparts-hosted", never published
  package.json             deps: oidc-provider (pinned). devDeps: oauth4webapi, @modelcontextprotocol/sdk (test clients)
  CONTRACT.md NOTES.md INTERFACE-GAPS.md   the same module discipline as src/
  src/
    server.ts              entry: routes, TLS-agnostic HTTP, health
    tenants.ts             store registry, LRU of handles, per-store queue, worker Spawner
    accounts.ts            people, identities, invites, login links, web sessions
    oauth.ts               oidc-provider config, interaction seam (Allow), resource checks
    oauth-adapter.ts       SQLite adapter with hashed ids
    keys.ts                KEK/DEK envelope, HKDF derivations
    backup.ts              litestream.yml generation, sidecar supervision, the key-store backup
    egress.ts              THE outbound list: Resend, the CIMD fetch (SSRF guard). Pinned by a test
    pages/                 login, Allow, account (server-rendered HTML; no framework)
  test/                    hermetic: a temp data root per test
  Dockerfile  litestream.yml.tmpl  RUNBOOK.md
```

- **The core changes it needs stay in `src/`**:
  - the `remote/http.ts` handler split;
  - protocol versions in `mcp/protocol.ts`;
  - anything a tenant needs from `openServer`.
- `hosted/` imports `../src/...` by relative path: same repo, same commit, run as TypeScript like the rest.
- A test pins the direction: **nothing under `src/` imports `hosted/`**. `src/`'s own network guard stays unchanged and
  keeps passing, because the hosted egress lives outside `src/` by design.
- `package.json` `files` already lists only `src/` and named docs, so `hosted/` never reaches the npm tarball. A test
  asserts that too, with `npm pack --dry-run`.

### 8.2 The runtime (Q6)

- Production runs Node 24 LTS, through `src/adapters/node-hooks.mjs` (the package's own Node path, smoke-tested on 22.15
  to 24).
- Hosted tests run under bun (the spike passed there) **and** under Node in CI, with a hosted variant of
  `bun run test:node`.
- The core's own suite is unaffected.

---

## 9. Build order: small PRs, each with real-path tests

Each PR goes through the HTTP door with real requests: no function-only tests for anything a client touches. Isolation
tests try to cross tenants on purpose.

1. **The transport split.** `remote/http.ts` becomes a handler plus the local listener; 2025-11-25 is added to
   negotiation. The existing remote tests pass unchanged. A new test mounts the handler behind a fake router.
2. **Tenants.** `hosted/` skeleton: the store registry, the per-store queue, the LRU, the shared embedder, synthesized
   configs, and the worker `Spawner` with its cap. In tests, auth is a test-only bearer map (it compiles out of the
   production entry). Tests:
   - two stores served concurrently, with no cross-talk;
   - A's session id, memory ids and `drm_` handles used in B's calls are refused or not found;
   - an LRU eviction during a queued call;
   - a worker coalesced per store;
   - a path traversal through the store id.
3. **Accounts.** People, identities, invites, the email link (Resend behind an interface, with a fake in tests), web
   sessions and the account page. Tests: link reuse, expiry, the wrong browser, rate limits, sign-up without an invite,
   and response parity for unknown emails.
4. **OAuth.** oidc-provider, the hashed adapter, PRM and the well-knowns, the 401 header, the Allow page, disconnect, and
   the CIMD fetch guard. Tests, driven by `oauth4webapi` **and** the MCP SDK client as real clients:
   - DCR end to end, and CIMD end to end (the fetch hook pointed at a local fixture);
   - no PKCE, wrong verifier, code reuse, refresh rotation and reuse;
   - revoke, disconnect, the wrong `resource`, the wrong audience;
   - **A's token against B's store**;
   - a token after account delete;
   - trailing-slash variants;
   - a CSRF-less Allow POST, and an Allow page from another browser.
5. **Keys and backups.** The KEK/DEK envelope, the key-store backup, the Litestream config generator plus supervisor, the
   SSE-C key files, export, delete (the full shred sequence), and quotas. Tests:
   - delete during a call;
   - the files a deleted store leaves behind: none;
   - a key-store backup holds no deleted DEK after rotation;
   - a restore drill against a local S3 stand-in.
6. **Ops.** Dockerfile, health and readiness, alerts, rate limits, `RUNBOOK.md` (Railway, then the Fly fallback), and
   §7.3's list made concrete.
7. **Security review.** An adversarial review in the repo's existing format (`docs/adversarial-review-*.md`), building the
   awkward states on purpose:
   - an expired refresh token mid-night;
   - a disconnect between two calls;
   - a store deleted while the sidecar is mid-sync;
   - a CIMD document that changes;
   - a quota hit during a chapter.

   Then Mike becomes user #1, then Katie.
8. **Later.** The 2026-07-28 transport (§3) behind the version switch.

---

## 10. Explicitly not in this lane

- The claude.ai wake shape, tool descriptions and annotations, prompts, and the night prompt (OL1b).
- The share carry (OL1a).
- The setup page and the privacy page (OL3), though §5.2's claim is written for it.
- The held Claude Code plugin submission.
- Server-run nights (decision 6).
- Reading claude.ai chat history (decision 7).
- Sync with local stores (stage 3).
- Mike's `deniedMcpServers` (his config).

---

## 11. Spikes run for this checkpoint (throwaway, kept out of the repo)

All of these ran in the session's scratchpad and none of them touched `src/`.

1. **Stock SQLite with `PRAGMA key`.** Run under bun 1.3.10 and Node 24.22.1:
   - `cipher_version` returned `[]`, the header was `SQLite format 3`, and the inserted marker text was visible in the
     file;
   - Node's `allowExtension` gives `loadExtension`;
   - bun has `setCustomSQLite`, but its docs say it does nothing off macOS.
2. **`better-sqlite3-multiple-ciphers` 12.11.1.** The package installed, but the native build (prebuild-install) was
   blocked by this session's permission rules. Not measured.
3. **`oidc-provider` 9.13.0** (33 packages with `oauth4webapi` 3.8.8, installed with `--ignore-scripts`). An end-to-end
   flow under bun and Node 24, with identical results on both: see §4.6. Its warning on bun: "Unsupported runtime. Use
   Node.js v22.x LTS, or a later LTS release."
4. **Package source reads** (tarballs, grep):
   - `@modelcontextprotocol/server` 2.4.0 has no authorization-server code;
   - `@modelcontextprotocol/sdk` 1.32.2 has `server/auth` (authorize, token, register, revoke, metadata), with CIMD only
     on the client side;
   - `oidc-provider` lists `clientIdMetadataDocument` under `EXPERIMENTS` (draft-02), disabled by default.
