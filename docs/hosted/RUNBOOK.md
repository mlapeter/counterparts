# The hosted server: runbook

For `app.counterparts.ai`: the first deploy, the checks after it, restores, key rotation and rollback. The design is
in `DESIGN.md`, the guarantees in `hosted/CONTRACT.md`, what is still owed in `hosted/INTERFACE-GAPS.md`.

Written 2026-10-26 (OL2b). The first deploy to Railway and R2 was 2026-10-29: sections 2 to 5 are corrected from
it, and the steps it checked say VERIFIED. A step that hasn't been run yet says so.

Never paste a secret into a chat, a commit or an issue. Every value below goes into Railway's variables page, a
password manager, or (the KEK only) its paper copy, and nowhere else.

---

## 1. Before you start (about 10 minutes, any time)

1. **Generate the KEK** on your Mac:

   ```sh
   openssl rand -base64 32
   ```

   **Keep it offline in two places before you use it**: a password manager, as "Counterparts hosted KEK v1", and
   a paper copy somewhere safe. **Without it, every backup is unreadable.** Railway's variable is the only copy
   online, and it isn't a backup: losing the Railway account loses it. Do the same for every later version (v2, …)
   before it goes into `HOSTED_KEKS`. Once it is in Railway, write its fingerprint beside both copies ("The drill",
   steps 2-4).
2. **Generate the cookie keys** (these sign the OAuth library's cookies):

   ```sh
   openssl rand -base64 48
   ```

   Save it too. It is less precious: losing it only ends sign-ins that are in progress.
   The first key also derives the sign-in forms' CSRF key, so forms survive a redeploy. To rotate, put the new key
   first (comma-separated, newest first) and keep the old one after it for a while; each form open at that moment
   expires once ("This form expired"), which a reload fixes.
3. **Resend.** The sending domain (`counterparts.ai`) must be verified. You'll need an API key that can send only.

## 2. Railway (about 15 minutes)

1. Create a new project with one service, built **from this GitHub repo**.
   - Settings → Scale: a new service starts in **EU West**. Set the region to **US West**.
   - The builder: the easiest way is the variable `RAILWAY_DOCKERFILE_PATH=hosted/Dockerfile` (in step 3's table).
     Settings → Build then shows "Dockerfile, set via variable". The root directory stays the repo root.
     VERIFIED 2026-10-29.
   - Settings → Deploy:
     - healthcheck path `/readyz`;
     - **one replica**: the rate limits live in memory, and the stores must have one writer.
   - Railway turns on **auto-deploy on every push to master**. That's fine for family use. Before non-family users,
     it should wait for CI ("Wait for CI") or deploy from a branch of its own. Which one is the owner's call; not
     decided yet.
   - Leave Railway's **Edge** section (CDN caching, edge rules, Under Attack Mode) off. Caching in front of sign-in
     pages and `/mcp` isn't something this server expects, and any of it could change the hops in section 5, step 3.
2. Add a **volume** to the service, mounted at `/data`, and set the variable `RAILWAY_RUN_UID=0` from the start.
   - Railway mounts volumes owned by root, and the image runs as the `node` user. Without it the first boot
     restart-loops on `[hosted] did not start: EACCES: permission denied, mkdir '/data/control'`. VERIFIED
     2026-10-29: that was the first boot, and `RAILWAY_RUN_UID=0` fixed it.
3. Add the **variables**. These are names only; the values come from step 1 and step 3 of this runbook.

   | name | value |
   |---|---|
   | `HOSTED_DATA_ROOT` | `/data` |
   | `PUBLIC_ORIGIN` | `https://app.counterparts.ai` |
   | `TRUST_PROXY` | `2`: the number of proxy hops in front. Railway adds an edge hop (section 5, step 3) |
   | `RESEND_API_KEY` | Resend's key |
   | `MAIL_FROM` | `Counterparts <memory@counterparts.ai>` |
   | `COOKIE_KEYS` | the cookie key from 1.2 |
   | `HOSTED_KEKS` | `v1:` followed by the KEK from 1.1 (one line: `v1:AbC…=`) |
   | `HOSTED_KEK_CURRENT` | `v1` |
   | `R2_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` (no bucket, no path) |
   | `R2_BUCKET` | the bucket's name |
   | `R2_ACCESS_KEY_ID` | the R2 token's access key id |
   | `R2_SECRET_ACCESS_KEY` | the R2 token's secret |
   | `LOG_FORWARDED_FOR` | `1`, **for the first deploy only** (section 5, step 3) |
   | `RAILWAY_RUN_UID` | `0` (step 2) |
   | `RAILWAY_DOCKERFILE_PATH` | `hosted/Dockerfile` (step 1) |
   | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `60`, so Litestream's last sync finishes before a redeploy kills the old container (unverified; check Railway's current name for it) |

   Don't set `PORT`: Railway sets it. Don't set `MAIL`, `BACKUPS`, `RESTORE_ON_BOOT` or `NEW_BUCKET`.

## 3. Cloudflare R2 (about 10 minutes)

1. Create a bucket, e.g. `counterparts-hosted`. Use automatic location.
2. **No bucket lock rules and no object lifecycle rules.** Above all, nothing on `keys/`. A delete has to be a
   delete: a locked or retained `keys/<store>.wrapped` would keep a deleted person's key alive.
3. Create an **API token**:
   - permission "Object Read & Write";
   - **scoped to this one bucket**;
   - no TTL, or a long one you'll remember to renew.

   It gives you an access key id and a secret, which go into Railway (2.3). The account id in the endpoint is on the
   R2 overview page.

## 4. DNS (5 minutes, then a wait)

`counterparts.ai`'s DNS is at **Namecheap**, not Cloudflare. R2 lives in a Cloudflare account, but it doesn't need
the domain on Cloudflare.

1. In Railway: service → Settings → Networking → Custom domain → `app.counterparts.ai`. It asks for **two records**:
   a CNAME and a TXT.
2. In Namecheap: Domain List → `counterparts.ai` → Advanced DNS. Add both, typing only the host part, because
   Namecheap appends the domain:

   | type | host | value |
   |---|---|---|
   | `CNAME` | `app` | `<id>.up.railway.app` (the target Railway shows) |
   | `TXT` | `_railway-verify.app` | `railway-verify=…` (the value Railway shows) |

   - Namecheap has no proxy toggle, so nothing adds a hop here.
   - VERIFIED 2026-10-29: both resolved within a minute. Railway issued the TLS certificate itself a few minutes
     after that.
   - If the DNS ever moves to Cloudflare, keep `app`'s proxy off (DNS only, grey cloud). With it on, Cloudflare adds
     another hop in front of Railway's, and `TRUST_PROXY` would be wrong (section 5, step 3).

## 5. First boot checks

1. **The deploy log** shows `[hosted] serving https://app.counterparts.ai on port …` and no `refused:` line. Every
   refusal names the variable it wants.
2. **Ready:**

   ```sh
   curl -s https://app.counterparts.ai/readyz
   ```

   Expect `{"ready":true,"checks":{"started":"ok","control":"ok","keys":"ok","backups":"ok"}}`. VERIFIED 2026-10-29:
   exactly that body.
   - `backups: "down"` means the Litestream child isn't running. Look in the log for its own lines.
   - The body never holds an id or a key. If it ever does, that's a bug.
3. **The proxy's hops** (INTERFACE-GAPS §4). Find your own IP (`curl -s https://ifconfig.me`), then run the
   `/readyz` curl again. The log shows `[hosted] /readyz X-Forwarded-For: …`. `TRUST_PROXY` is the number of
   addresses in that line when you curl directly: the server takes that many from the end, so the entry it uses is
   yours, and nothing a client writes in front of it counts.
   - Found 2026-10-29: **your IP, then a Railway edge address** (`<your IP>, <Railway edge IP>`). That is two hops,
     so `TRUST_PROXY=2`. With `1`, every person would have shared the edge address's rate-limit bucket.
   - Keep doing this check after a change on Railway's side (or any proxy put in front): Railway could change its
     hops. Your IP alone would mean `1`; three addresses would mean `3`. If your IP isn't in the line at all, tell
     the coordinator before inviting anyone.
   - Then **delete `LOG_FORWARDED_FOR`** and redeploy.
4. **The bucket**: after a minute, R2's object browser shows `keys/control.wrapped` and `control/accounts.sqlite/…`.
   VERIFIED 2026-10-29: the bucket showed `control/` and `keys/`.
5. **Litestream's own words**: the log has Litestream's start lines (`level=INFO msg=litestream version=…`, then
   `msg="initialized db"` and `msg="replicating to" … bucket=… endpoint=…` for each database), and no repeated
   `sidecar.backoff`. A sync that fails says so in its own `level=ERROR` or `level=WARN` lines (an R2 `403`, a refused
   SSE-C key). These lines reach the log since the build with `logging.stderr`: before it, Litestream wrote them to
   stdout, which the sidecar drops, so `/readyz` showed only that the process ran.

## 6. Your invite, and you

1. Make an invite code, in the running container:

   ```sh
   railway ssh
   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts invite --note mike
   ```

   It prints one `cpi_…` code, once. It needs the backup variables set, as `serve` does.
2. Open `https://app.counterparts.ai/login`, then enter your email and the code. The link comes by email, so open it
   **in the same browser**.
3. Your account page shows no connected apps yet.

To count people, any time, beside the running server (counts only, safe to paste anywhere, your own account included): `railway ssh`, then `node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts signups`.

## 7. BEFORE you add the connector: Claude Code

Claude Code loads claude.ai's connectors. Once the hosted connector is in your claude.ai account, every Claude Code
session would get a second memory server over a different store. So, first, in your `~/.claude/settings.json`,
extend `deniedMcpServers`. It already lists `*.trycloudflare.com`, `claude.ai counterparts-trial` and
`https://app.counterparts.ai/*` (checked 2026-10-28); add the name you'll give the connector:

```json
{ "serverName": "claude.ai Counterparts" }
```

- The name is `claude.ai ` followed by exactly what you type as the connector's name in step 8.2.
- Restart Claude Code. Then, once step 8 is done, `/mcp` in a new session must NOT list it.

## 8. The connector

1. claude.ai → Customize > Connectors, + Add → Add custom connector.
2. The name is `Counterparts` (the same name as in step 7). The URL is `https://app.counterparts.ai/mcp`.
3. Connect, sign in, then Allow. Your account page now lists it.
4. In a new chat, ask it to wake. The first wake offers the first meeting.

---

## Restore

What the bucket holds:

- every store's database, under that store's own SSE-C key;
- the two control databases (`accounts.sqlite`, `oauth.sqlite`), under the `control` key;
- each store's wrapped key, once, at `keys/<storeId>.wrapped`.

What it never holds:

- `keys/keys.sqlite`, which is rebuilt from the `keys/` objects;
- a store's `cache/` (its word index and vectors), which is rebuilt from the rows at the store's first open after
  a restore;
- `journal/` and `spans/`, which are derived or conversation text, never backed up.

**You need the KEK ring that wrapped the keys.** A restore with a ring that can't open a key object refuses. It
writes nothing to the bucket, and leaves only an empty `keys/keys.sqlite` on the volume, which a retry with the right
ring doesn't mind ("If a start refuses").

### The whole volume is gone (or it's a new volume, or a move to Fly)

1. Attach the new, empty volume at `/data`, with the same variables, the same bucket and the same KEK.
2. Add `RESTORE_ON_BOOT=1`. Raise the healthcheck timeout for this one deploy (Settings → Deploy → Healthcheck
   Timeout, or `RAILWAY_HEALTHCHECK_TIMEOUT_SEC=1800`), because every restored store's cache is rebuilt before
   the server listens. Then deploy.
3. The log shows:
   - `restored the control databases: 2 restored, 0 already here`;
   - each restored store's cache being rebuilt before `serving` (a large store takes a while);
   - `RESTORE_ON_BOOT: N store databases restored. Unset RESTORE_ON_BOOT now.`;
   - and, only if any failed, `N store restores FAILED`. Those stores wait, and everyone else is served.
4. **Remove `RESTORE_ON_BOOT`** and the raised timeout, then redeploy.

Without the flag, a server on an empty volume beside a bucket that has backups **refuses to start**, and says so. If
it started, it would make empty databases and replicate them over the real ones. (A new server with a new, empty
bucket starts normally. A volume that has lived beside an empty bucket refuses too, unless `NEW_BUCKET` says the
bucket is new on purpose: "If a start refuses".)

### One store's files are gone

Its person's `/mcp` calls get `503` with `Retry-After`. The log shows `store.needs-restore store=<tag>`. The store is
**not** re-created as an empty one, because that empty store would be replicated over its own backup. The same
`RESTORE_ON_BOOT=1` deploy restores every store that is missing, and touches none that are present.

**A store that never reached the bucket** (its person signed up and the volume died within seconds) stays at `503`:
a restore finds nothing. Its way out is to start it over as a new, empty store. It is refused while the bucket holds
any replica of it, or its tombstone.

It is **safe against the running server** (`railway ssh`, then the line below). It only clears the store's
"opened" mark. At that person's next call the server makes the new store, gives it its key, and adds it to the
sidecar's configuration (a sidecar reload, logged as `sidecar.exit` / `sidecar.start`). No restart is needed.
It refuses a store whose account is set to be deleted: if its person keeps it, start it over then.

```sh
node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts start-over <storeId>
```

### By hand (a local copy, or the drill), with the server stopped

```sh
node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts restore --all          # control (when missing), then every missing store
node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts restore <storeId> [--force]
```

These use the same environment as `serve`, and `litestream` on PATH or `LITESTREAM_BIN`.
- A file already in place is refused, unless `--force`. With `--force` the old file is moved aside as
  `*.pre-restore-<time>` and never deleted.
- The control databases are restored one at a time, and one already in place is kept. A volume without the control
  key that holds a control database is refused (see below).
- **`--all --force` restores EVERY live store**, not only the missing ones, moving each file in place aside.
- A store the bucket has a tombstone for (`deleted/<id>`, written by every delete) is never restored. The next start
  finishes its delete.
- **Not on Railway while the service runs.** Nothing checks for the running server, so use `RESTORE_ON_BOOT` there.

### If a start refuses (the service crash-loops)

A crash-looping service can't be reached with `railway ssh`. Use a variable where one is named below, otherwise a
**start-command override**: Settings →
Deploy → Custom Start Command, deploy once, read the log, then **clear it**. The image's entry point is
`node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts`, so an override names the whole line.

- **"…but not the key that wrote the bucket's backups"**: this volume has a control database, but not the control
  key. Either something else made that database (an `invite` or a `BACKUPS=off` run on a lost volume), or only
  `keys/keys.sqlite` was lost and the control databases are fine. The server can't tell which, so both take the safe
  path, which loses at most the last seconds not yet replicated. Set `RESTORE_ON_BOOT=1` and `CONTROL_ASIDE=1`
  (variables, no start-command override) for one deploy, then unset both. `serve` moves `control/` to
  `/data/control.aside-1` before anything opens it, and logs `CONTROL_ASIDE=1: moved control/ …`.

  It moves `control/` only on a volume that refuses for this reason (the bucket has the control key, this volume
  doesn't). On any other volume it logs `…isn't refusing for the control key…: nothing moved` and the start goes on,
  so it can never set aside the only copy of the accounts. A bucket it can't read stops the start (`did not start`),
  with nothing moved.

  It moves `control/` aside **once per label**, ever: it writes `/data/overrides/control-aside-1.used` (`claimed`,
  then `moved` after the move), and nothing deletes that file. A crash-restart, or a `CONTROL_ASIDE=1` left set for
  weeks, logs `…was used once already: nothing moved`. `…claimed but the move didn't finish` means the server stopped
  between the two; `control/` is where it was. **To do it again on purpose, set a new label** (`CONTROL_ASIDE=2`,
  then `3`, …). The used labels are in `/data/overrides/`.
- **"did not start: a store's key object in the bucket doesn't open with the KEK ring: put the old version back in
  the ring and run rewrap again"**, on a restore (`RESTORE_ON_BOOT=1`, a new or empty volume): usually a mistyped
  KEK, not a rotation. **Compare fingerprints first**: fingerprint each version in `HOSTED_KEKS` and check it against
  the key-check value beside the offline copies ("The drill", steps 2-4), and check the label (`v1:`). Nothing was
  restored, and the bucket wasn't touched. The start leaves `keys/keys.sqlite` on the volume, with no key in it.
  Leave it: fix `HOSTED_KEKS` and deploy again with `RESTORE_ON_BOOT=1` still set, and the restore goes on as on an
  empty volume. No `rm -rf /data/keys` is needed (read from the code, and `ops.test.ts`'s drill does exactly that,
  under a wrong ring and then the right one). The plural **"N wrapped store keys don't open with the KEK ring"** is
  the other case: the keys in `keys/keys.sqlite`, at a start, after a version was dropped before its rewrap
  finished ("Rotating the KEK").
- **"N of the control databases are missing"**: a control restore was cut short. `RESTORE_ON_BOOT=1` restores the
  missing one alone.
- **"…the bucket R2_ENDPOINT and R2_BUCKET name ("<host>/<bucket>") has no control key"** (R7): this volume has
  lived (a person or a store is on it), and the bucket has never been this volume's. Nothing was made or put anywhere.
  (A volume with no one on it yet starts as a new server instead, also after a first start that stopped half-way.)
  The line says which case it thinks it is:
  - **"this volume has been backed up (its control key is in keys/keys.sqlite)"**: `R2_BUCKET` or `R2_ENDPOINT` is
    most likely wrong. Fix it and redeploy; it starts as before.
  - **"…has been backed up (a backup key file is here) but has lost keys/keys.sqlite"**: `keys/keys.sqlite` is gone
    AND the bucket is most likely wrong. Fix it; that start then refuses with "…but not the key that wrote the
    bucket's backups" (the first entry above): deploy once with `CONTROL_ASIDE=<new label>` and `RESTORE_ON_BOOT=1`,
    then unset both (or "…no accounts database…": `RESTORE_ON_BOOT=1` alone). No `rm -rf /data/keys` is needed.
    `NEW_BUCKET` doesn't count here: the stores' keys are only in the old bucket. If the old bucket is gone, tell the
    coordinator.
  - **"…has people or stores but has never been backed up: it ran with BACKUPS=off"**: you are turning backups on.
  - **"control/accounts.sqlite is on this volume but isn't a database this server can read"**: a damaged file, or
    one copied in by hand. `NEW_BUCKET` doesn't help. Point the bucket variables at the bucket that has this volume's
    backups and deploy once with `CONTROL_ASIDE=<new label>` and `RESTORE_ON_BOOT=1`, or tell the coordinator.
  - **"a start that turned backups on (NEW_BUCKET) was cut short…"**: the start that turned backups on stopped before
    the control key reached the bucket (the log of that start says why, e.g. `did not start: object store PUT
    answered …`). Fix that, and deploy again with the same `NEW_BUCKET`.

  **Only when the bucket is new on purpose** (a move to a new bucket, or turning backups on after `BACKUPS=off`), set
  `NEW_BUCKET` to what the line prints: `R2_ENDPOINT`'s host, a slash, `R2_BUCKET` (e.g.
  `NEW_BUCKET=<account id>.r2.cloudflarestorage.com/counterparts-hosted`), for one deploy. The log says
  `NEW_BUCKET=…: …on purpose…`, and R2 then shows `keys/control.wrapped`. Unset it once it is serving. Left set, each
  start logs `NEW_BUCKET is set, but … it changed nothing`; any other value doesn't count, so a later wrong
  `R2_BUCKET` or `R2_ENDPOINT` is refused again.
  - Turning backups on, the same start gives every store a key (`backup.key.minted storeTag=…`, one per store). A
    store it can't do then (`backup.keyless … reason=bucket-unreadable`, or `locked` for a pending delete) gets its
    key at a later start: the volume remembers it turned backups on (in `keys/keys.sqlite`).
  - Moving a volume that still has `keys/keys.sqlite`: every store's key goes into the new bucket as it is.
- **Copies set aside hold addresses and memories**, outside the 24-hour purge: `/data/control.aside-*` from the
  `CONTROL_ASIDE` above, and every `*.pre-restore-*` file that a `--force` restore moved aside. Every start deletes any
  that are more than a day old, and logs `deleted N copies set aside…`. Check one within the day if you need to,
  then let it go, or delete it by hand sooner (`rm -rf /data/control.aside-1`).
- **`backup.ensure.failed storeTag=<tag>: this store is NOT backed up yet`** (not a refusal; the server runs): a store
  started over on the running server couldn't get its key or its place in `litestream.yml`. It serves, unbacked,
  until the next start. That start gives it a key when the bucket holds nothing of it (the next entry). To heal it
  sooner, restart the service (Railway → the deployment → Restart; unverified here). `storeTag=` is the tag the `restore` and
  `start-over` commands print (SHA-256 of the id); `store=` in the limit and `store.needs-restore` lines is a
  different, per-process tag, which can't be matched across restarts.
- **`backup.key.minted storeTag=<tag>`** (not a refusal): a store served with no backup key, here or in the bucket,
  and the bucket held nothing of it. The start made it a key; it is backed up once that start is serving (the line
  comes before the key's upload, so a start that stops after it says `did not start: …`, and the next start finishes
  the upload). Nothing to do. Within a minute, R2's object browser shows `keys/<id>.wrapped` and objects under `tenants/<id>/`.
- **`backup.keyless storeTag=<tag> reason=<reason>`**, with **"N stores that lived have no key here or in the
  bucket"** below it: the store serves, but isn't backed up, and no key was made, on purpose. By reason:
  - `no-database`: its database isn't on this volume. It also waits for a restore (`RESTORE_ON_BOOT=1`), or for
    `start-over` if it never reached the bucket.
  - `bucket-unproven`: the bucket had no control key before this start, which `NEW_BUCKET` said is on purpose (since
    R7 that is the only way a volume that lived gets here). **Check `R2_BUCKET` anyway.** If it's wrong after all,
    fix it and redeploy. If it's right, the next start makes the key, because this start put the control key there.

    A start refused with **"the bucket's control key is a different key from this volume's"** has a control key here
    that some start against another bucket made (one before R7, or one on a volume with no one on it yet, after
    `keys/keys.sqlite` was lost). The way back: remove `keys/` from the volume (`rm -rf /data/keys`, with a start-command override
    if the service crash-loops), then deploy once with `CONTROL_ASIDE=<new label>` and `RESTORE_ON_BOOT=1`, then
    unset both.
  - `bucket-unreadable`: a check's request to the bucket failed. The next restart tries again.
  - `tombstone`: the bucket says it was deleted. A start finishes the delete.
  - `replica-in-bucket`: the bucket holds backup objects of it, under a key that is gone. A new key would bury them.
    Tell the coordinator.
  - `keys-newer`: this volume's `keys/keys.sqlite` was made no earlier than the store was first opened (it was rebuilt), so
    an older key of it may exist somewhere. Tell the coordinator.
  - `locked`: its account is set to be deleted (R6), and a store set to be erased is never given a new key. Nothing to
    do: it is erased at its deadline, and if its person keeps it, the next start checks it like any other.
- **`did not start: the object store says the bucket (R2_BUCKET) doesn't exist`**: `R2_BUCKET` names a bucket R2
  doesn't have. Fix the variable.
- **`delete.mail.failed storeTag=<tag>`** (not a refusal): a person deleted their account and its confirmation email
  (R9) didn't send. The delete stands and their page said so; nothing retries the email. If it repeats, check Resend
  (`RESEND_API_KEY`, `MAIL_FROM`'s domain); sign-in links would be failing too. `storeTag=none` is possible: the
  account had no store left to name.

### The drill with the real binary (again after each new KEK version, or a Litestream bump)

The hermetic test (`hosted/test/ops.test.ts`) drives the restore through a stand-in Litestream. It proves our side:
the key objects, the configuration, the arguments, the layout, the cache rebuild, and the words coming back
through `/mcp`. It doesn't prove Litestream itself, R2 or SSE-C, and it doesn't prove that the offline copies of
the KEK are production's. The drill proves those, in two halves.

**Why two halves.** Until 2026-11-02 the drill typed the real KEK from each offline copy into a container on your
Mac. That proved only that the two copies agree with each other, and it put the real KEK on the Mac. So now:

- **The copies are proven by fingerprints.** You fingerprint each offline copy and Railway's `HOSTED_KEKS`, and all
  three must match. A wrapped key opens only with the right key bytes and the right version label (`keys.ts`, the
  label is in the AAD). Railway's own start-ups prove that its ring opens the bucket's keys: the running deploy
  started after the last edit to `HOSTED_KEKS` and opens its stores. So copies whose bytes equal Railway's, under
  the same label (`v1`), open the bucket too. (With one version in the ring, `HOSTED_KEK_CURRENT` can only be unset
  or `v1`: any other value refuses at start-up, `keys.ts`.)
- **The restore is proven with a throwaway KEK.** The script runs production's deployed image, the real Litestream
  and a drill bucket on R2. The key material is made for the drill and thrown away after it.

**Your steps** (once per KEK version, and the bucket once per drill):

1. **A drill bucket and its own token.** In Cloudflare R2, make a fresh, empty bucket `counterparts-drill` in the same
   account (defaults), and a token with Object Read & Write on **that bucket only**. Save it as
   `~/.config/counterparts-drill.env` with `chmod 600`, never in `~/counterparts-notes` (it pushes to GitHub):

   ```
   R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com     # no /bucket on the end
   R2_BUCKET=counterparts-drill
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   ```

   The script refuses any other bucket name.
2. **Fingerprint each offline copy** (the password manager's, then the paper's). Run it twice for each. It prints
   8 hex characters, or `NOT 32 BYTES`. It strips a leading `v1:`, and the key never shows on screen:

   ```sh
   read -rs -p "KEK: " K; echo; K="$K" node -e 'const s=process.env.K.trim().replace(/^v1:/,"");const b=Buffer.from(s,"base64");if(b.length!==32){console.log("NOT 32 BYTES ("+b.length+")");process.exit(1)}console.log(require("crypto").createHash("sha256").update(b).digest("hex").slice(0,8))'; unset K
   ```

3. **Fingerprint Railway's copy**, the same computation on each version in `HOSTED_KEKS`. Run it on your Mac, from
   `~/counterparts`, where Railway is linked. The variables go straight into `node`, and only the fingerprints are
   printed:

   ```sh
   railway variables --kv | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const l=d.split("\n").find(x=>x.startsWith("HOSTED_KEKS="));if(!l){console.log("NO HOSTED_KEKS");return}for(const e of l.slice(12).split(",")){const i=e.indexOf(":");const b=Buffer.from(e.slice(i+1).trim(),"base64");console.log(e.slice(0,i).trim(),b.length===32?require("crypto").createHash("sha256").update(b).digest("hex").slice(0,8):"NOT 32 BYTES")}})'
   ```

   Expect one line per version (`v1 <8 hex>`), `v1` only today. Check that the running deploy started after the last
   edit to `HOSTED_KEKS`, so the ring it proved is this one. A service that is serving with one version has
   `HOSTED_KEK_CURRENT` unset or `v1`, since any other value refuses at start-up.
4. **All three equal?** Then write the 8 hex beside both offline copies, as their **key-check value**. On the day
   Railway is gone, it tells you a copy is the right one before anything is restored. If one differs, fix that copy
   now, while Railway's still works.

**The script** runs the other half. It needs Docker, `gh` signed in, and bun, from a checkout with hosted's
dependencies. Run it as one background process (about five minutes):

```sh
bun install --cwd hosted --frozen-lockfile
hosted/drill/drill.sh --rehearse     # optional first: steps 0-3 with BACKUPS=off, no bucket and no credentials
hosted/drill/drill.sh                # the drill; after a failure, hosted/drill/drill.sh --from <step>
```

Everything it writes goes to `$COUNTERPARTS_DRILL_DIR` (default `$TMPDIR/counterparts-drill`), outside the
repository: `RESULTS.md` (one line per step, pass or FAIL, and what it saw), the container logs, and a 0600 state
file with the throwaway KEKs, deleted at the end. It never prints a key, a token or the R2 secret. Docker gets
them by name (`-e NAME`). The steps, and what each proves:

| Step | What it does | What it proves |
| --- | --- | --- |
| 0 | Reads production's deployed commit from GitHub's deployments, builds the image from a worktree at it, checks Litestream's version, empties the drill bucket, makes throwaway K1 and K2 (same `v1` label, other bytes) | the drill runs what production runs |
| 1-2 | Serves under K1, two invites, two sign-ups through the emailed link; user 2 never connects | a store signed up and never opened doesn't upset Litestream (INTERFACE-GAPS §16) |
| 3 | OAuth as claude.ai does it (DCR, PKCE, Allow), `wake`, `remember` A | the real door |
| 4 | Waits for the store and both control databases to replicate, by TXID | Litestream replicates to R2 |
| 5 | A plain GET of every replica object; the store's own object with its key | SSE-C: nothing readable without the key |
| 6 | `remember` B, then `docker stop` at once | the shutdown sync (step 10 tells whether B survived) |
| 7-8 | Removes the volume; starts without `RESTORE_ON_BOOT` | an empty volume beside a bucket with backups refuses, the bucket unchanged |
| 9 | `RESTORE_ON_BOOT=1` under K2 | a mistyped KEK refuses, the bucket unchanged |
| 10 | `RESTORE_ON_BOOT=1` under K1; recall A and B with the token from before; refresh | everything comes back, the person stays connected, the never-opened store doesn't fail |
| 11 | `remember` C, waits for it to replicate | replication goes on after a restore |
| 12 | A second cycle: stop, volume gone, restore, recall A, B and C | a restored server restores again |
| 13 | Cleanup: container, volume, bucket emptied, image, worktree, state | nothing of the drill is left but its logs |

**Cleanup.** A rehearsal that passes removes its container, volume and state; one that fails leaves them for
`--from`, and holds port 8080 until you clean it up:
`docker rm -f drill-rehearsal; docker volume rm cp-drill-rehearsal; rm "$COUNTERPARTS_DRILL_DIR"/rehearsal-state.*`.
Step 13 empties the bucket and removes everything local except the logs. Then you delete the drill
token and the empty bucket in Cloudflare, and the logs directory when you're done reading it.

**Run it again after each new KEK version, or a Litestream bump.** A new KEK version needs steps 2-4 again, for the
new version: the offline-copy command strips only `v1:`, so a copy pasted with another label prints `NOT 32 BYTES`;
paste it without the label. A Litestream bump needs the script.

**2026-11-02: both halves passed.** The fingerprints: at about 10:19, KEK v1 from the password manager, from the paper
copy and from Railway's `HOSTED_KEKS` (a single `v1` entry) all matched, and the fingerprint is written beside both
offline copies. The script: steps 0-13 passed (one resume at step 4 after a script bug), on the deployed image (3fe0aa75, Litestream 0.5.17, arm64). Both refusals left the
bucket unchanged. B, written just before the stop, came back. The old token and the refresh both worked after
the restore. Plain GETs answered `400 InvalidRequest` (×32).

Still open from the first deploy: Railway's drain time. On Railway, the old container gets a drain time before it
is killed. Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60` so the final sync can finish (unverified; check Railway's
current name for it). The drill's `docker stop` took 0.6 s on the Mac, which says nothing about Railway.

## Rotating the KEK

1. Generate v2 as in 1.1, and record it in the two offline places first. Then set
   `HOSTED_KEKS=v1:<old>,v2:<new>` and `HOSTED_KEK_CURRENT=v2`.
2. Stop the service, then run `… main.ts rewrap` once. It prints
   `rewrapped N keys onto v2; M key objects re-written`.
   - **Unverified on Railway:** a one-off command with the service stopped. If there's no such thing, use the
     start-command override above (`… main.ts rewrap`), deploy once, read the line, then clear the override.
3. Start the service, and check `/readyz`.
4. Only then drop `v1:` from `HOSTED_KEKS`, and redeploy. A ring that can't open a key refuses to start.

## Moving the KEK to the Cloudflare key service (later; a gate before non-family users)

1. **Before building it:** verify the reported Railway environment-variable breach (Mike's report, not verified).
   If it's wrong, the key service is still better than an environment variable, but it is less urgent.
2. When the key service holds the KEK, **export its key to the same two offline places**, recorded before the
   rewrap onto it. Losing the Cloudflare account must not lose the memories.
3. Rewrap onto it as in "Rotating the KEK", then fingerprint the exported copies against the key service's ("The
   drill", steps 2-4).
4. **With the key service down, a restart can't open any store until it's back** (the same shape as an R2 outage
   blocking a start). A running server keeps serving. Accepted.

People who use the server hold no keys, so they can't lock themselves out. A key a person holds themselves would
stay opt-in only, if it's ever built.

## Deletes (24 hours to keep, or everything now)

Since 2026-10-27 (R6) a person's delete locks the account at once and erases it 24 hours later, unless they sign in
and keep it; "delete everything now" erases at once. Nothing here needs you:

- **The deadline survives anything.** It is in `accounts.sqlite` (`people.delete_after`). A redeploy, a crash or an R2
  outage during the 24 hours never erases early and never forgets. The server begins each erase within ten minutes
  of its deadline (or at the next start, if it was down then), and retries until R2 lets it finish.
- **A locked store is still backed up**, so a restore in the window brings it back locked (unless the control
  databases come back from before the delete: then it is `active` and connected again, its deadline lost, and from
  before a keep it comes back pending: INTERFACE-GAPS §36), and a rewrap re-writes
  its key object like any other.
- **There is no operator undo or early erase.** The person does both from their account page (they sign in by email
  link as usual and see only that page). If someone can't reach their email and asks you to keep or erase it, tell
  the coordinator: it is a one-off script around `app.keepAccount` / `app.deleteAccount`, not a command.
- **Audit codes** (`accounts.sqlite`'s `audit`, ids only): `account.pending-delete`, `account.kept`,
  `account.deleting.due` (the deadline's erase began), then the erase's own `delete.backups`, `delete.store`,
  `account.deleted`, or `delete.retry.failed` while R2 is down.

## Rollback

Stop the service: Railway → service → remove the active deployment, or scale it to zero. claude.ai's connector then
fails to reach it. **Nothing on your Mac is touched**: your local Counterparts, its store and its hooks don't know
the hosted server exists. The volume and the bucket stay as they are, so starting the service again resumes.

## Watch for in the first week

- **Retention lag** (INTERFACE-GAPS §2). Snapshots run every 12 h and are kept for 12 h. A day after the first
  deploy, R2's `control/accounts.sqlite/` should hold no snapshot older than about 24 h. If it does, the "account
  email purged from backups within 24 hours" promise needs a different number.
- **The final sync on SIGTERM.** Litestream 0.5.17's source has a shutdown sync (`shutdown-sync-timeout`). At each
  redeploy, the old container's log should end with Litestream's shutdown lines, `msg="signal received, litestream
  shutting down"` and then `msg="litestream shut down"`, before `[hosted] sidecar.exit`. A `level=ERROR` or
  `level=WARN` shutdown sync line between them (`shutdown sync …`: failed, retrying, interrupted or skipped) is a
  final sync that had trouble; `[hosted] sidecar.kill` is one cut short. The same shutdown lines appear at every
  sidecar reload too (each sign-up or delete), not only at a redeploy.
- **Limits.** `[hosted] limit.rate-limited` / `limit.store-full` / `limit.in-flight` lines. Each line is a hashed
  store tag and nothing else. (Litestream's own lines, from the sidecar child, do name database paths, and so store
  ids, and the bucket and endpoint; never a key. Railway's log is the operator's, not a place anyone else reads.) The numbers are loose on purpose: 120 calls a minute, 1,500 an hour, 8 at once,
  1 GiB a store.
- **An R2 outage stops a restart.** Start-up reads the bucket (`keys/`), so a deploy during an R2 outage refuses to
  start. It says `the object store (R2_ENDPOINT) didn't answer`. A server that is already running keeps serving.
