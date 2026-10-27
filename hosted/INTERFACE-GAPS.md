# hosted/ — what it still owes

## Before any non-family user

1. **Gates** (DESIGN §5.4; item 2 is one more):
   - Railway's disk encryption confirmed in writing;
   - the Cloudflare Worker key service (a second `KeyWrapper`), so that one leak of Railway's environment can't expose
     both the KEK and the R2 credentials. First verify the reported Railway environment breach (unverified); it
     changes the urgency, not the direction. Its key is exported to the two offline places. With it down, a restart
     can't open stores (accepted, like item 9);
   - lockout: every KEK version held offline in two places before use, and the drill (item 5) restored with the KEK
     typed from them, not from the Railway variable.
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
   - So the RUNBOOK's drill (a second bucket, the real KEK typed from its offline copies, Docker on the Mac) is the
     first run of the real binary.
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
12. **The restore CLI doesn't know whether the server runs.** "Server stopped" is a comment, as for `rewrap` (§28).
    On Railway the practical way to run a command is inside the running container, so the RUNBOOK uses
    `RESTORE_ON_BOOT` for every restore there. A lock file held by `serve` would close it (OL2b review L4).
13. **What a restore can bring back of a deleted person** (OL2b review L3). Restores go to the latest state, and
    `restore <id>` needs a live store, so our tooling never brings back a deleted store. Two narrow windows remain:
    - control writes Litestream hadn't synced when the volume was lost: an account deleted in the last seconds comes
      back `active`, with its email, and no memory (its key and prefix are gone, and no new key is made);
    - the 12 h snapshot history, reachable only with a manual `-timestamp`.

14. **No global or cost-weighted budget** (the #653 review, L4). The limits are per account and count calls, not
    their cost: a few accounts each inside their own limits, all running heavy calls, still slow everyone (one
    event loop). Acceptable for an invite-only beta of about 20; a shared budget or a cost weight per tool comes
    with real load.
15. **Litestream's own log lines name database paths**, and so store ids. The server's lines carry hashed tags
    only, but the sidecar child's stderr goes to the same log unfiltered (the #653 review, L5).
16. **What the real binary does with a configured database that doesn't exist yet** (a store signed up and not yet
    opened) is unverified. It's the RUNBOOK drill's first check (the #653 review, M4).

## Low, named so they are decisions

17. **Duplicate grants.** Each Allow press for the same client mints a new grant, so the account page can list
   duplicates, and Disconnect removes only one (#646 review).
18. **Suspension doesn't revoke grants.** Restoring a person restores their connections. `authenticate` checks
    `isLive`, so a suspended person's token is refused anyway (#646 review).
19. **Custom-scheme redirects.** The Allow page's `form-action` lists only http(s) return origins, so a custom-scheme
    native client may be blocked by CSP after Allow. That's functional, not security (#646 review).
20. **The batch, interrupted.** If a client disconnects mid-batch, the rest of the batch can run after the store was
    evicted. Those calls fail with "internal error" to a client that has gone; nothing crosses tenants (#643 review).
    Batches are capped at 32 messages.
21. **Bun only, and closed at the door.** `node:http` under bun doesn't emit `close` on a mid-body abort. The door now
    also settles on the socket's `close`, so neither the store's ref nor the in-flight slot is held (OL2b review).
22. **`/login/link` has no rate limit.** The tokens are 256-bit, so there is nothing to brute-force (#644 review).
23. **A residual in the mail timing.** The mailer still builds its request before the response flushes. That costs well
    under a millisecond, below network jitter (#644 review).
24. **The link-validity oracle.** "Wrong browser" and "can't be used" tell a live token from a dead one. At 256 bits
    that isn't exploitable (#644 review).
25. **Sign-up while R2 is down.** If the key object's put fails, the store is in `litestream.yml` without
    `keys/<id>.wrapped`, and can't be restored from R2 alone until the next `ensureAll` (#648 review).
26. **Retire, tested only through `withTenant`.** A door-level test (authenticate, then delete, then the MCP POST) is a
    follow-up (#648 review).
27. **A hung Litestream makes the delete POST wait** up to the 30 s SIGKILL timeout (#648 review).
28. **`rewrap` with the server up.** "Server stopped" is only a comment. Start-up's unreadable-key refusal catches the
    bad outcome (#648 review).
29. **Refresh sliding vs absolute.** Whether the rotated refresh token's 30-day expiry slides wasn't measured.
30. **Export as markdown.** Export is the database file. The readable markdown tree needs an archive format.
31. **The 2026-07-28 transport** (DESIGN §3), behind a version switch.

## The 24-hour delete (R6, 10-27)

32. **No confirmation email for a delete, a keep or an erase.** None was built for the delete before R6 (DESIGN §7.1
    said one goes out), so none was added (the brief: only if one existed). Recommended next: one email at the delete,
    naming the deadline and the way to keep it. It is the only notice a person gets if someone else's hand used their
    signed-in browser, and the 24 hours are what make it worth sending.
33. **No re-authentication for delete everything now** beyond the signed-in session and the typed address. From the
    pending page the session is always a fresh email link (the delete ended every other). From an active account it is
    whatever session the browser has (up to 30 days old).
34. **A volume lost inside the 24 hours, with control restored from before the delete**, brings the account back
    `active` AND connected: `oauth.sqlite` comes back with `accounts.sqlite`, so its grants return too, and the
    deadline is lost. The tombstone (`deleted/<id>`) is written only when the erase begins, so nothing in the bucket
    says a delete was pending. The reverse holds too: control restored from before a keep brings back a pending
    account, which may then be erased at its old deadline. A third narrow window beside §13's two (the #659 review).
    - **An option, not built:** a `pending/<storeId>` object in the bucket at the delete (holding the deadline),
      removed at a keep, and honoured at start like the tombstone. It would close the first case; the reverse would
      need the keep's own marker.
35. **The erase can run up to one timer tick (ten minutes) after the deadline.** The pending page says the time to keep
    it has passed from the deadline on, and keep refuses then.
36. **No operator undo or early erase.** The person does both from the pending page. An operator who had to could run
    the same calls (`app.keepAccount`, `app.deleteAccount`) from a one-off script; there is no CLI.
37. **R5 (keyless store mint):** a mint inside `ensureStore` must also skip a store whose account is pending delete
    (`Accounts.storeLocked`). Today `Backups.ensureAll` never hands such a store to `ensureStore` without a key, which
    covers a mint there; a mint anywhere else needs the same check.
