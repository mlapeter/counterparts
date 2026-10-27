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
3. **The `src/` store contract's `secure_delete` note.** `src/core/store/CONTRACT.md` says the default is FAST, which
   is bun only; Node's default is 0, and the hosted server runs Node. The core's forget and removal paths should be
   checked for what they rely on. That file is the coordinator's, not this lane's (#648 review).

## The first Railway deploy (`docs/hosted/RUNBOOK.md` walks each)

4. **Check `X-Forwarded-For`.** `LOG_FORWARDED_FOR=1` logs the raw header of each `/readyz` request. Confirm it
   carries exactly one appended hop. `web.ts#clientIp` takes the last hop. If Railway puts a second internal hop in
   front, every client shares one rate-limit bucket. That shows up as loud 429s, not a silent bypass (#644 review).
   Cloudflare's proxy must stay off for `app` (DNS only), or it adds a hop.
5. **The real-binary restore drill.** The hermetic drill (`test/ops.test.ts`) drives a stand-in Litestream. It proves
   our side: the key objects, the configuration, the arguments, the layout, the cache rebuild, and the words back
   through `/mcp` with the same token. It doesn't prove Litestream's replication or its SSE-C against R2.
   - The classifier refused downloading and running the binary on the build Mac. The image's build did fetch it,
     checked its sha256 and ran `litestream version`.
   - No MinIO image could be pulled: `minio/minio` is gone from Docker Hub. Our own S3 stand-in doesn't speak enough
     of S3 for the AWS SDK.
   - So the RUNBOOK's drill (a second bucket, a throwaway KEK, Docker on the Mac) is the first run of the real
     binary.
   - Read from Litestream 0.5.17's source, not run:
     - `sse-customer-key-path` is the key name, and the file holds the base64 of a 32-byte key, as generated;
     - `restore` takes `-config` or a replica URL, never both;
     - a shutdown sync on SIGTERM exists (`shutdown-sync-timeout`);
     - path-style is the default with an endpoint.
6. **Volume ownership.** The image runs as `node`, and Railway mounts volumes owned by root. The RUNBOOK's answer is
   Railway's `RAILWAY_RUN_UID=0` (unverified), which runs it as root. An entrypoint that chowns and drops privileges
   would keep `node`.

## Operations still owed

7. **`/readyz` with replication lag.** Litestream's `addr:` metrics endpoint would give it; not configured. Today
   `/readyz` sees the sidecar process, not whether its uploads succeed: a sidecar that runs but can't reach R2 reads
   `ok`.
8. **Alerts** (DESIGN §7.1: lag, volume full, 5xx rate, sidecar restarts), and the Fly fallback.
9. **An R2 outage blocks a start.** `prepareVolume` and `ensureAll` read `keys/` from the bucket, so a deploy during
   an outage refuses to start (it names `R2_ENDPOINT`). A running server keeps serving. Booting with backups
   "down" would need the empty-volume check to fail closed some other way.
10. **One store's restore runs at a start** (`RESTORE_ON_BOOT=1`), not live: a person whose store is missing gets
    `503` until the next such deploy. A live per-store restore (out of the sidecar, restore, back in) isn't built.
11. **The limits' numbers are guesses** (`limits.ts`): 120 calls a minute, 1,500 an hour, 8 in flight, 1 GiB.
    They're tuned from the `limit.*` log lines after the first weeks, and they live in memory (one replica). The
    size is a walk of the tenant dir, cached for 60 s. `stores.size_bytes` isn't written.

## Low, named so they are decisions

12. **Duplicate grants.** Each Allow press for the same client mints a new grant, so the account page can list
   duplicates, and Disconnect removes only one (#646 review).
13. **Suspension doesn't revoke grants.** Restoring a person restores their connections. `authenticate` checks
    `isLive`, so a suspended person's token is refused anyway (#646 review).
14. **Custom-scheme redirects.** The Allow page's `form-action` lists only http(s) return origins, so a custom-scheme
    native client may be blocked by CSP after Allow. That's functional, not security (#646 review).
15. **The batch, interrupted.** If a client disconnects mid-batch, the rest of the batch can run after the store was
    evicted. Those calls fail with "internal error" to a client that has gone; nothing crosses tenants (#643 review).
    Batches are capped at 32 messages.
16. **Bun only.** `node:http` doesn't emit `close` on a mid-body abort, so under bun the handle keeps its ref. Production
    Node 24 behaves (#643 review).
17. **`/login/link` has no rate limit.** The tokens are 256-bit, so there is nothing to brute-force (#644 review).
18. **A residual in the mail timing.** The mailer still builds its request before the response flushes. That costs well
    under a millisecond, below network jitter (#644 review).
19. **The link-validity oracle.** "Wrong browser" and "can't be used" tell a live token from a dead one. At 256 bits
    that isn't exploitable (#644 review).
20. **Sign-up while R2 is down.** If the key object's put fails, the store is in `litestream.yml` without
    `keys/<id>.wrapped`, and can't be restored from R2 alone until the next `ensureAll` (#648 review).
21. **Retire, tested only through `withTenant`.** A door-level test (authenticate, then delete, then the MCP POST) is a
    follow-up (#648 review).
22. **A hung Litestream makes the delete POST wait** up to the 30 s SIGKILL timeout (#648 review).
23. **`rewrap` with the server up.** "Server stopped" is only a comment. Start-up's unreadable-key refusal catches the
    bad outcome (#648 review).
24. **Refresh sliding vs absolute.** Whether the rotated refresh token's 30-day expiry slides wasn't measured.
25. **Export as markdown.** Export is the database file. The readable markdown tree needs an archive format.
26. **The 2026-07-28 transport** (DESIGN §3), behind a version switch.
