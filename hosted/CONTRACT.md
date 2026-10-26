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

## What it drops, for now

- Keys, backups, export and delete: step 5, which waits on Mike (DESIGN §5).
- Rate limits on `/mcp` and size quotas: the ops step.
- The 2026-07-28 stateless revision: later, behind a version switch (DESIGN §3).
