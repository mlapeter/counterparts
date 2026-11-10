# hosted/ — what it still owes

## Before any non-family user

1. **Gates** (DESIGN §5.4; item 2 was one more, deferred since):
   - Railway's disk encryption confirmed in writing. Met 2026-11-04: SOC 3 (period ending 2026-04-22, unqualified) says
     AES-256 at rest, volume-level, backups too. Open from the same report: Railway snapshots volumes several times a
     day, retention unknown; Mike is asking Railway (DESIGN §5.1);
   - ~~the Cloudflare Worker key service~~ **replaced by WB1 (write-only backups, 2026-11-06; Hobby has no static
     egress)**: the KEK is on the volume, every key object in R2 is sealed to an offline recovery key, so one leak of
     Railway's environment (the R2 token included) opens no backup. **Owed to finish it, Mike's step** (RUNBOOK,
     "Write-only backups", step 8): the old KEK copies retired once no `keys/*.wrapped` is left. Steps 1-7 are done
     (1-6 on 2026-11-06, the R2 token rotated 2026-11-07, before the first stranger invite; DESIGN §5.4).
     The R2 drill (item 5) again on the deployed image after that;
   - lockout: the recovery private key held offline in two places before use, both copies proven by
     `recovery-fingerprint` against the fingerprint every start logs, and the throwaway-keypair drill (item 5)
     passing on the real binary. (Met for the KEK 11-02; for the recovery key, the real-R2 drill passed 2026-11-06
     13:52 on 0.3.50.)
   - **Not closed by WB1** (it was never the goal): a leak of the volume is a leak of everything (the live stores are
     plaintext there; with the bucket, the backups' history too). And the memory stores that exist at the migration
     keep their DEKs (control is re-keyed): an old `HOSTED_KEKS` plus a copy of their old `keys/<id>.wrapped` still
     opens their backups. Accepted for Mike's and the test accounts' stores; re-keying them is not built.
2. **Deferred, not a gate for the beta (Mike, 2026-11-04, and kept deferred 2026-11-10): the account email, encrypted
   under the person's DEK, with a keyed hash for lookup.** It was a gate from 2026-10-26, 16:21. The hash key would sit
   next to the KEK, behind `KeyWrapper`. Not built.
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

**Deferred, not gates and not built (2026-11-04, ROADMAP, on Mike's "reasonably secure, not overkill" for a free beta of
0-10 users).** They stay owed; the lists above and item 8 say what each would take.
- ~~The Cloudflare key service (the second gate above)~~: replaced by WB1 (2026-11-06), above.
- The account email under the DEK (item 2): it comes with the encrypted live store, which is pending Mike's final word.
  Mike kept it deferred on 2026-11-10: not a gate for the beta.
- The four custom alerts (item 8): Railway's crash and deploy emails cover the start.
- An outside uptime service (item 8): it needs Mike's account, and Railway's notices cover a crash.
- A formal data-request process: a request to the feedback address is handled by hand at this size.

## The first Railway deploy (`docs/hosted/RUNBOOK.md` walks each)

4. **Check `X-Forwarded-For`.** `LOG_FORWARDED_FOR=1` logs the raw header of each `/readyz` request. Checked
   2026-10-29: a direct request carries two entries, the client's address and then a Railway edge hop. So
   `TRUST_PROXY` is now a hop count, set to `2` on Railway, and `web.ts#clientIp` takes the entry that many from the
   end (the socket address when the header is shorter). The RUNBOOK keeps the check (§5.3): Railway could change it.
5. **The real-binary restore drill: passed 2026-11-02** on the deployed image (3fe0aa75, Litestream 0.5.17, arm64),
   against a drill bucket on R2, with a throwaway KEK (`hosted/drill/`, RUNBOOK "The drill"). It proved replication
   to R2 by TXID, SSE-C on every replica object, the shutdown sync, both refusals (an empty volume, a wrong KEK) with
   the bucket unchanged, the restore with the old token and the refresh, replication after it, and a second cycle.
   The hermetic drill (`test/ops.test.ts`) still covers our side on every run; this one is run again after each new
   recovery key or a Litestream bump. Not proven: the production bucket at its real size and age (a read-only
   `restore --all` on Railway's side would be; never `serve` a drill container against the production bucket).
   **WB1 (2026-11-06): passed in the new shape with `--local`** (a local S3 with SSE-C, the branch's image): the
   sealed key objects, both refusals (no private key, the wrong one), and `hold` + `recover-keys` + `RESTORE_ON_BOOT`
   twice. **Passed on R2 2026-11-06 13:52, on 0.3.50.** Still unverified: on Railway, that `hold` passes the
   healthcheck and `railway ssh` reaches it.
6. **Volume ownership.** The image runs as `node`, and Railway mounts volumes owned by root. The RUNBOOK's answer is
   Railway's `RAILWAY_RUN_UID=0` (unverified), which runs it as root. An entrypoint that chowns and drops privileges
   would keep `node`.

## Operations still owed

7. **`/readyz` with replication lag: control's uploads, built 2026-11-04 (G3); per store, still owed.** Every 10
   minutes the server LISTs `control/accounts.sqlite/` for its highest LTX TXID (the names the drill read on the real
   binary), then writes one `heartbeat` row to `accounts.sqlite` so the next look has something Litestream must have
   shipped, even on a quiet day. No rise for 30 minutes reads `backups: stale` (a `503`), and logs
   `[hosted] backup.uploads.stale minutes=<n> reason=<no-rise|list-failed|heartbeat-failed>` at each look while it
   lasts; `[hosted] backup.uploads.ok after=<n>` once it lands again. The clock starts with the sidecar, so a fresh
   boot is never `stale` before 30 minutes (Railway's healthcheck runs at deploy time only, so a `503` later doesn't
   restart anything: docs.railway.com/reference/healthchecks). Cost: one LIST and one tiny write each 10 minutes,
   none per `/readyz` hit. What it doesn't see:
   - **one store's replica failing while control's land** (its own SSE-C key file, a path problem). Same process,
     credentials, bucket and endpoint as control, so the common failures show; this one shows only in Litestream's
     own `level=ERROR` lines. Per-store would need a write to every store or Litestream's `addr:` metrics (not
     configured; their 0.5 names unverified without the binary);
   - **whether the real binary's TXID rises within one look** after a heartbeat: the drill saw rises within 60 s, so
     ten minutes is wide, but the first deploy should show `backups: ok` past the 30-minute mark (RUNBOOK §5.6).
8. **Alerts** (DESIGN §7.1: lag, volume full, 5xx rate, sidecar restarts), and the Fly fallback. Railway's built-in
   notifications (crash, failed deploy, usage, monitors) are the first layer (RUNBOOK, "Railway's notifications"); no
   sender of our own. The `backup.uploads.stale` line is there for a log alert when one exists; nothing reads it yet.
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
    event loop). Acceptable for a beta capped at a few tens of accounts (spots, SU1); a shared budget or a cost weight per tool comes
    with real load.
15. **Litestream's own log lines name database paths**, and so store ids. The server's lines carry hashed tags
    only, but the sidecar child's stderr goes to the same log unfiltered (the #653 review, L5). Since the build with
    `logging.stderr` in the generated configuration, that is all of Litestream's lines (before, they went to stdout
    and were dropped). They carry paths, the bucket and the endpoint at the default level, never a key:
    `LOG_LEVEL` and `LITESTREAM_S3_DEBUG`, which would log requests, never reach the child. `restore`'s failure
    message drops Litestream's log lines; the id is replaced by its tag in the message, so the restore CLI still
    names a store by its tag only.
    - **Accepted (coordinator, 2026-11-02; open to Mike reversing it):** Litestream's start lines put every store's
      raw id (its database path and its replica path) into Railway's log at each reload (every sign-up and delete).
      Ids are random, not personal data, and the log is the operator's own. The hashing rule (DESIGN §2.3) is about
      the call log.
16. **What the real binary does with a configured database that doesn't exist yet** (a store signed up and not yet
    opened; the #653 review, M4): **closed 2026-11-02** by the drill. Each sign-up's reload was a plain
    `sidecar.exit` then `sidecar.start`, with no back-off, and the control database replicated while no store database
    existed. The never-opened store then caused no failure on restore.

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
    `keys/<id>.sealed`, and can't be restored from R2 alone until the next `ensureAll` (#648 review).
26. **Retire, tested only through `withTenant`.** A door-level test (authenticate, then delete, then the MCP POST) is a
    follow-up (#648 review).
27. **A hung Litestream makes the delete POST wait** up to the 30 s SIGKILL timeout (#648 review).
28. **`migrate-keys` and `recover-keys` with the server up** (`rewrap` before WB1). "Server stopped" is only a comment. Start-up's unreadable-key refusal catches the
    bad outcome (#648 review).
29. **Refresh sliding vs absolute.** Whether the rotated refresh token's 30-day expiry slides wasn't measured.
30. **Export as markdown.** Export is the database file. The readable markdown tree needs an archive format.
31. **The 2026-07-28 transport** (DESIGN §3), behind a version switch.
32. **A keyless store heals at the next start, not while serving** (R5). A started-over store whose first open's
    backup set-up fails serves unbacked until a restart (the RUNBOOK says to force one). A retry on the 10-minute
    timer, with the same checks and the bucket proven at this process's start, would close it.
33. **`keys-newer` has no way out** (R5). A store left keyless because `keys.sqlite` was rebuilt after it was opened
    stays unbacked: nothing mints for it, and `start-over` refuses while its database is here. An operator command
    (`start-over --rekey`, with the same checks minus that one, after a human has looked) would be the path.

## A quiet tenant's raw copies wait (11-01)

Retention runs in the worker, and a hosted worker starts only after a `wake`. A person who
stops coming keeps the raw copies of their notes (`spans/`) past the clocks until their next
wake, or until the account is deleted. No sweep was built. There is no doctor, console or
mechanisms page here, and the claude.ai line (`onboarding.ts#WEB_RETENTION_LINE`) names no
number. /privacy/ does name one, and says what it hangs on (live 11-01, site 93aa053): raw
copies are "due to go within about two weeks of [their] conversation going quiet", at the next
wake, and wait if chats stop or are far apart. So a number on a hosted page stays tied to the
next wake unless a sweep is built; whether to build one is Mike's, open.

Since LW1 (11-09) the control database keeps the UTC day of each person's last wake
(`people.last_wake_on`, CONTRACT §37), so such a sweep has its input without opening a store:
`SELECT s.id FROM stores s JOIN people p ON p.id = s.person_id WHERE s.state = 'active' AND
p.last_wake_on < <today minus N days, UTC>` (a NULL — never woken since LW1 shipped — falls back
to `people.created_at`). The same column could give `main.ts signups` a "woke in the last 7 days /
quiet for 14+" count for monitoring; that command reads on a read-only connection with no migration,
so it would need a `PRAGMA table_info` guard for a volume from before the column. Neither is built:
the threshold, and whether a quiet account's raw copies go early, are Mike's.

## The 24-hour delete (R6, 10-27)

34. **Closed 2026-10-27 (R9, on Mike's "yes send email"): a confirmation email at a delete.** One at the delete,
    naming the deadline in the person's zone and the way to keep it, and one at delete everything now (CONTRACT §27).
    A keep and the timer's erase still send none, by design. The send isn't retried: a provider that is down at the
    delete means no email (audited and logged as `delete.mail.failed`), and the delete stands.
35. **No re-authentication for delete everything now** beyond the signed-in session and the typed address. From the
    pending page the session is always a fresh email link (the delete ended every other). From an active account it is
    whatever session the browser has (up to 30 days old).
36. **A volume lost inside the 24 hours, with control restored from before the delete**, brings the account back
    `active` AND connected: `oauth.sqlite` comes back with `accounts.sqlite`, so its grants return too, and the
    deadline is lost. The tombstone (`deleted/<id>`) is written only when the erase begins, so nothing in the bucket
    says a delete was pending. The reverse holds too: control restored from before a keep brings back a pending
    account, which may then be erased at its old deadline. A third narrow window beside §13's two (the #659 review).
    - **An option, not built:** a `pending/<storeId>` object in the bucket at the delete (holding the deadline),
      removed at a keep, and honoured at start like the tombstone. It would close the first case; the reverse would
      need the keep's own marker.
37. **The erase can run up to one timer tick (ten minutes) after the deadline.** The pending page says the time to keep
    it has passed from the deadline on, and keep refuses then.
38. **No operator undo or early erase.** The person does both from the pending page. An operator who had to could run
    the same calls (`app.keepAccount`, `app.deleteAccount`) from a one-off script; there is no CLI.
39. **R5's mint and a pending delete (closed when #658 merged).** `Backups.ensureAll` checks `locked` BEFORE
    `ensureStore`: a store set to be deleted with no key here and none in the bucket is counted keyless with the
    reason `locked` (audited and logged through `onKeyless`, like R5's other reasons) and never reaches
    `mintRefusal` or the mint. A mint added anywhere else needs the same check.

## A lived volume beside a bucket with no control key (R7, 10-27)

40. **`BACKUPS=off` → on, and `keys.sqlite` lost before every store has its key.** The turn-on fact
    (`backups-turned-on`) lives in `keys.sqlite`, so a turn-on cut short, or a store left keyless at it (a failed
    check, a pending delete), heals at a later start (the #661 review). If `keys.sqlite` is then lost before those
    stores have their keys, the fact goes with it and they are `keys-newer` for good, like R5's own two-failures case
    (§33). A way out would be the same operator `--rekey`.
41. **A lost `keys/keys.sqlite` moved to a new bucket on purpose** is refused (`NEW_BUCKET` doesn't count once a key
    file says the volume was backed up): its stores' keys are in the old bucket only. Today's answer is "go back to
    the old bucket"; with the old bucket gone too there is none, as in §33.

## Raw copies of notes with no live session (found 2026-11-01)

42. **Fixed by #710 (11-01): a note filed under the shared `"mcp"` session could keep its raw copy past 14 days.** A
    `remember` with no live session lands under `"mcp"`, and each new note used to restart the clock for all of them (a
    day-0 raw copy on disk at day 40). Now each line goes on its own age, 3 days if it owes nothing and 14 regardless
    (`remember/owes.ts#planUnboundLines`). Live on hosted; local installs get it in the release after 0.3.44. It still
    needs a worker to run, so on hosted it waits for the next wake (above).

## The G1 security review's low findings (2026-11-04)

43. **Closed by the G1F pull request: HSTS on every answer, DPoP and RP-initiated logout off, invites that expire,
    and `removal.failed` holding codes only** (L1, L2, L3, L4, L6; CONTRACT §11, §15, §20). Codes made before invites
    expired stay valid until used, rather than expiring at the deploy.
44. **Still open (G1 L5, not taken up in G1F): a 30-day sliding web session can export the whole memory** (and delete it
    now, §35) with no fresh sign-in (G1 L5). Someone at an unlocked, signed-in browser can download it. A fix would
    ask for a session younger than about 15 minutes for export and delete-now.

## The dashboard on hosted (HD2, 2026-11-10)

45. **First release: home, memories and self, read-only** (`src/dashboard.ts`, the shared half
    `src/adapters/dashboard/web/respond.ts`). Owed, each on Mike's word:
    - **The other tabs** (subjects, flow, health) say "not on hosted yet" and their views 404 (`HOSTED_VIEWS`). Health's
      machine parts (doctor, hooks, worker, install) stay local; its store parts (the last cycle, the wake's size, the
      archive) and the mechanisms panel could come over as they are.
    - **The 3-D brain** is off (`HOSTED_HOST.brain`): a 600 KB module per visit, and its lights read `/api/mechanisms`.
    - **Managing** (ask by facts / by meaning, add a memory, remove one, mark what it is about) is hidden by
      `HOST.canAct`; it would need a hosted action door with CSRF and the tenant's queue, not `actions.ts`.
    - **An empty store** (signed up, never connected) answers each view 409 with one sentence, so the page shows that
      sentence in its error box; a calmer empty page would be nicer.
46. **Every `/api` view opens an observer Counterpart inside the tenant's queue and closes it** (no cache). It also
    opens the tenant's own handle when it is closed (as export does), which then idles out on the usual 10 minutes; the
    page polls every 60 s, and not while hidden, so a tab left open keeps that handle warm. A memory store's open was
    a few milliseconds in tests; measure on a large store if pages feel slow.
46b. **No process-wide budget for dashboard views** (#801 review fixed the one-session case: two in flight per person,
    a yield before each). Many people each inside their two still share one event loop, as §14 says for `/mcp`.
47. **The page's inline `style=` attributes are allowed** (`style-src-attr 'unsafe-inline'`, nothing else inline): the
    drawn markup uses about fifty for widths and colours. Moving them to classes would let the CSP drop it.

## The hourly email cap while spots are open (EC1, 2026-11-10)

48. **What stays open around the cap** (`spots emails M`, CONTRACT §11).
    - **A live invite code can ask for links to any address**, open or closed: the code is spent at the click, not the
      ask, so one code mails as many addresses as the per-IP and per-address limits let through. A live code passes
      the email cap as it passes the spots (#804 review: the invited aren't blocked by a stranger's flood), so M
      doesn't bound it, open or closed; its asks still count toward M. Older than EC1; spending a use at the ask, or a
      cap per code, would close it.
    - **The lockout trade-off.** The cap is global, so anyone can hold it: about 5 IPs at the per-IP 20 an hour fill
      the default 100 every hour, and newcomers without a code see "try again in an hour" for as long as that lasts.
      Members and live codes still get through. With no alarm (below), the operator sees it only as `reached` in
      `spots`; the answer then is invite codes, or a higher M with a tighter per-IP limit.
    - **Clock hours, not a sliding hour.** Up to 2M can go out across one hour's end (M at 12:59, M more at 13:00).
      Loose on purpose; a sliding window is a table of timestamps, as Counterparts Phone's `rate_hits` keeps.
    - **It counts asks, not deliveries.** A refused ask (suspended account), a member's sign-in and a live code's ask
      count too, so the count can't say who has an account; a mail that fails still counted. Over M, a member's or a
      live code's ask is counted no further and still sent, bounded only by the per-address and per-IP limits.
    - **No alarm when it trips.** Phone mails its operator once an hour when its sign-up cap trips (`signup_alarm`);
      here the operator sees it only in `spots` (`… this hour: reached`).
