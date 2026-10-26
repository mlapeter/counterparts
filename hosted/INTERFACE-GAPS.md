# hosted/ — what it still owes

## Before any non-family user

1. **Two gates** (DESIGN §5.4):
   - Railway's disk encryption confirmed in writing;
   - the Cloudflare Worker key service (a second `KeyWrapper`), so that one leak of Railway's environment can't expose
     both the KEK and the R2 credentials.
2. **Gate (Mike, 2026-10-26, 16:21): the account email, encrypted under the person's DEK, with a keyed hash for
   lookup.** The hash key sits next to the KEK, behind `KeyWrapper`. It is built in the same hardening pass as the key
   service. Not built now.
   - Until then, the beta says "your account email is purged from backups within 24 hours", on the account, done and
     202 pages and in DESIGN §5.2.
   - Why that holds: with `secure_delete` on, snapshots taken after a delete are clean. The pre-delete snapshot and the
     LTX files after it are pruned within max(interval, retention) plus Litestream's retention lag. The generated config
     sets 12 h / 12 h (`backup.ts#SNAPSHOT_HOURS`), which leaves 12 h of room for that lag. The lag is unmeasured
     without the binary; measure it on the first deploy.
3. **Closed 2026-10-26: the `src/` store contract's `secure_delete` note.** Measured: node:sqlite's default is 0 on
   22.23 and 24.22, and a deleted row stayed in the file through a checkpoint and a close. `openDb` now sets FAST on
   every connection under both runtimes, so tenant memory stores match bun; the removal path's `VACUUM` then
   checkpoint measured clean under both Nodes. `keys`, `accounts` and `oauth` still raise it to ON after the open.

## The first Railway deploy

4. **Check `X-Forwarded-For`.** Log the raw header of one request from a known IP and confirm it carries exactly one
   appended hop. `web.ts#clientIp` takes the last hop. If Railway puts a second internal hop in front, every client
   shares one rate-limit bucket. That shows up as loud 429s, not a silent bypass (#644 review).

## Operations (build step 6)

5. **Restore.** R2's key objects, then the keys, then a Litestream restore, then a drill against a local S3 stand-in.
6. **The rest of ops:**
   - the Dockerfile (Node 24 plus a pinned Litestream binary);
   - `/readyz` with replication lag;
   - alerts;
   - the runbook (R2 versioning and object lock off for `keys/`);
   - the Fly fallback.
   - Not verified against the real binary: whether Litestream v0.5 reloads its config on a signal, and whether it does
     a final sync on SIGTERM. The sidecar restarts and waits for the exit either way.
7. **Rate limits and quotas on `/mcp`.** Per-tenant calls a minute, a connection cap and the per-store size quota are
   not built. Store calls run synchronous sqlite on one event loop, so one tenant's heavy calls slow every other
   tenant, even with a queue per store (#643 review).

## Low, named so they are decisions

8. **Duplicate grants.** Each Allow press for the same client mints a new grant, so the account page can list
   duplicates, and Disconnect removes only one (#646 review).
9. **Unused DCR clients pile up.** Client rows never expire. Growth is bounded by 30 registrations an hour per IP; a
   sweep of clients older than 30 days with no grant is not built.
10. **Suspension doesn't revoke grants.** Restoring a person restores their connections. `authenticate` checks
    `isLive`, so a suspended person's token is refused anyway (#646 review).
11. **Custom-scheme redirects.** The Allow page's `form-action` lists only http(s) return origins, so a custom-scheme
    native client may be blocked by CSP after Allow. That's functional, not security (#646 review).
12. **The batch, interrupted.** If a client disconnects mid-batch, the rest of the batch can run after the store was
    evicted. Those calls fail with "internal error" to a client that has gone; nothing crosses tenants (#643 review).
    Batches are capped at 32 messages.
13. **Bun only.** `node:http` doesn't emit `close` on a mid-body abort, so under bun the handle keeps its ref. Production
    Node 24 behaves (#643 review).
14. **`/login/link` has no rate limit.** The tokens are 256-bit, so there is nothing to brute-force (#644 review).
15. **A residual in the mail timing.** The mailer still builds its request before the response flushes. That costs well
    under a millisecond, below network jitter (#644 review).
16. **The link-validity oracle.** "Wrong browser" and "can't be used" tell a live token from a dead one. At 256 bits
    that isn't exploitable (#644 review).
17. **Sign-up while R2 is down.** If the key object's put fails, the store is in `litestream.yml` without
    `keys/<id>.wrapped`, and can't be restored from R2 alone until the next `ensureAll` (#648 review).
18. **Retire, tested only through `withTenant`.** A door-level test (authenticate, then delete, then the MCP POST) is a
    follow-up (#648 review).
19. **A hung Litestream makes the delete POST wait** up to the 30 s SIGKILL timeout (#648 review).
20. **`rewrap` with the server up.** "Server stopped" is only a comment. Start-up's unreadable-key refusal catches the
    bad outcome (#648 review).
21. **Refresh sliding vs absolute.** Whether the rotated refresh token's 30-day expiry slides wasn't measured.
22. **Export as markdown.** Export is the database file. The readable markdown tree needs an archive format.
23. **The 2026-07-28 transport** (DESIGN §3), behind a version switch.
