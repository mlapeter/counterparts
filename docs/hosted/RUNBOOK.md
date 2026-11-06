# The hosted server: runbook

For `app.counterparts.ai`: the first deploy, the checks after it, restores, key rotation and rollback. The design is
in `DESIGN.md`, the guarantees in `hosted/CONTRACT.md`, what is still owed in `hosted/INTERFACE-GAPS.md`.

Written 2026-10-26 (OL2b). The first deploy to Railway and R2 was 2026-10-29: sections 2 to 5 are corrected from
it, and the steps it checked say VERIFIED. A step that hasn't been run yet says so.

Never paste a secret into a chat, a commit or an issue. Every value below goes into Railway's variables page, a
password manager, or (the recovery private key only) its paper copy, and nowhere else. **The recovery private key
never goes into Railway** at all: not a variable, not a file, not a log.

Since WB1 (2026-11-06, "Write-only backups" below) there is no KEK to make or keep: the server makes its own key on
the volume, and what leaves for R2 is sealed to a recovery key whose private half only you hold.

---

## 1. Before you start (about 10 minutes, any time)

1. **Make the recovery keypair** on your Mac, from `~/counterparts` (bun, or Node 24 with
   `--import ./src/adapters/node-hooks.mjs`):

   ```sh
   bun hosted/src/main.ts recovery-keygen
   ```

   It prints `HOSTED_RECOVERY_PUBKEY=…` (the public half, for Railway: public, fine in env), its `fingerprint`, and
   the PRIVATE key (one line, `cp-recovery:…`) to the terminal, once. It writes no file (a file on a synced or
   backed-up Desktop would be a third copy, and `rm -P` does nothing on macOS's disks).
   **Keep the private key offline in two places before you use it**: a password manager, as "Counterparts hosted
   recovery key", and a paper copy somewhere safe. **Without it, a lost volume can't be restored.** Then clear the
   terminal: Cmd-K clears Terminal.app's and iTerm2's scrollback, but not tmux's or screen's history (run it outside
   them), Warp maps Cmd-K to something else (use its "Clear blocks"), and iTerm2's session restore or a clipboard-history
   app may keep a copy (turn them off for this, or clear them after). Clear before quitting Terminal.app, which can
   restore a window's text. Check each copy (it reads the key from the prompt and doesn't show it; it must print the same
   fingerprint), and write the fingerprint beside both:

   ```sh
   bun hosted/src/main.ts recovery-fingerprint
   ```
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
   - Railway turns on **auto-deploy on every push to master**. Since 2026-11-04 (Mike) the service deploys from a
     branch of its own instead: Settings → Source, the branch is `hosted-live`, which the release process moves
     forward (`docs/RELEASING.md` §5, step 6). A merge to master no longer redeploys; a release, or an urgent fix
     moved to `hosted-live` on purpose, does. Before the switch, `hosted-live` is created once, by hand, at the live
     sha (the newest `success` deployment of `fabulous-recreation / production` on GitHub; the `content-beauty /
     production` rows there are another project), so the switch deploys nothing new. Railway's **"Wait for CI" stays
     off** for this service: it waits for a workflow run on a push to the deploy branch, `tests.yml` runs only on
     `master` and `release/**`, so with it on a `hosted-live` deploy waits forever (2026-11-04). The CI gate is step
     6's check that every run on the commit passed before `hosted-live` moves.
     A GitHub ruleset, "hosted-live: no force-push, no deletion" (id 26567959, active since 2026-11-04), blocks
     force-pushing and deleting `hosted-live`. The release's fast-forward push (`docs/RELEASING.md` §5, step 6) is
     unaffected: the ruleset sets no update rule.
     Railway stages a settings change (the branch, a disconnect) until **Deploy Changes** at the top of the project
     canvas is pressed; until then the old source stays live. On 2026-11-04 the switch sat staged and the next
     master merge still deployed, so press it, then check that a docs-only merge to master makes no new
     `fabulous-recreation / production` deployment.
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
   | `HOSTED_RECOVERY_PUBKEY` | the public key 1.1 printed (public: it can seal, never open) |
   | `R2_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` (no bucket, no path) |
   | `R2_BUCKET` | the bucket's name |
   | `R2_ACCESS_KEY_ID` | the R2 token's access key id |
   | `R2_SECRET_ACCESS_KEY` | the R2 token's secret |
   | `LOG_FORWARDED_FOR` | `1`, **for the first deploy only** (section 5, step 3) |
   | `RAILWAY_RUN_UID` | `0` (step 2) |
   | `RAILWAY_DOCKERFILE_PATH` | `hosted/Dockerfile` (step 1) |
   | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `60`, so Litestream's last sync finishes before a redeploy kills the old container (unverified; check Railway's current name for it) |

   Don't set `PORT`: Railway sets it. Don't set `MAIL`, `BACKUPS`, `RESTORE_ON_BOOT` or `NEW_BUCKET`. Don't set
   `HOSTED_KEKS` (before WB1 the KEK lived here; a new server never needs it).

## 3. Cloudflare R2 (about 10 minutes)

1. Create a bucket, e.g. `counterparts-hosted`. Use automatic location.
2. **No bucket lock rules and no object lifecycle rules.** Above all, nothing on `keys/`. A delete has to be a
   delete: a locked or retained `keys/<store>.sealed` would keep a deleted person's key alive. (R2 keeps no object
   versions of its own, as of 2026-11-06, unverified on R2's current docs: check there is no versioning setting on
   the bucket, and leave it off if there is.)
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
   - `backups: "stale"` means the child runs, but nothing it sent has been seen landing in R2 for 30 minutes (G3:
     every 10 minutes the server LISTs `control/accounts.sqlite/` for a TXID above the last look's, then writes a
     heartbeat row for the next look to find). The log has `[hosted] backup.uploads.stale minutes=<n>
     reason=<code>` at each look while it lasts: `no-rise` (the LIST answers, nothing new: R2 refusing PUTs, a
     wrong token, a refused SSE-C key), `list-failed` (R2 didn't answer the LIST either), `heartbeat-failed` (the
     accounts database refused the write). Litestream's own `level=ERROR` lines say why. A restart doesn't fix it;
     the token or R2 does. `[hosted] backup.uploads.ok after=<n>` says it landed again.
   - A fresh boot can't read `stale` before 30 minutes (the clock starts with the sidecar), so a deploy passes the
     healthcheck. Railway calls `/readyz` at deploy time only, so a later `503` restarts nothing.
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
4. **The bucket**: after a minute, R2's object browser shows `keys/control.sealed` (`keys/control.wrapped` before
   WB1) and `control/accounts.sqlite/…`. The deploy log has `backups: keys on this volume (keys/volume.kek); key
   objects sealed to recovery key <fingerprint>`: the fingerprint is the one beside your offline copies.
   VERIFIED 2026-10-29: the bucket showed `control/` and `keys/`.
5. **Litestream's own words**: the log has Litestream's start lines (`level=INFO msg=litestream version=…`, then
   `msg="initialized db"` and `msg="replicating to" … bucket=… endpoint=…` for each database), and no repeated
   `sidecar.backoff`. A sync that fails says so in its own `level=ERROR` or `level=WARN` lines (an R2 `403`, a refused
   SSE-C key). These lines reach the log since the build with `logging.stderr`: before it, Litestream wrote them to
   stdout, which the sidecar drops, so `/readyz` showed only that the process ran.

6. **Uploads land** (G3): 35 minutes or more after the deploy, the `/readyz` curl still says `backups: "ok"`, and the
   log has no `backup.uploads.stale` line. That is the real binary's TXID seen rising after a heartbeat; until this
   check passes once, the signal is proven only against the test stand-in (INTERFACE-GAPS §7).

## 6. Your invite, and you

1. Make an invite code, in the running container:

   ```sh
   railway ssh
   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts invite --note mike
   ```

   It prints one `cpi_…` code, once, and the time it expires. A code lasts 7 days; `--expires 30` gives it 30 (whole
   days, 1 to 365). A code made before this change was deployed has no expiry and stays valid until used. It needs the backup
   variables set, as `serve` does.
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
- each store's key (and the `control` key), once, at `keys/<storeId>.sealed`, **sealed to the recovery key**: the
  server can write these and never read them back. (Before WB1: `keys/<storeId>.wrapped`, under `HOSTED_KEKS`.)

What it never holds:

- `keys/keys.sqlite` and `keys/volume.kek`: a new volume gets a new volume key, and the keys come back from the
  `keys/` objects with the recovery private key (`recover-keys`);
- a store's `cache/` (its word index and vectors), which is rebuilt from the rows at the store's first open after
  a restore;
- `journal/` and `spans/`, which are derived or conversation text, never backed up.

**A restart never needs the private key**: the volume has every key. **Only a lost volume (or a lost `keys/`) does**,
and only for one step, `recover-keys`, with the server stopped. Without it, a restore refuses (`… sealed to the
recovery key, which the server never holds: run recover-keys …`), writes nothing to the bucket, and leaves only an
empty `keys/keys.sqlite` on the volume, which `recover-keys` doesn't mind.

### The whole volume is gone (or it's a new volume, or a move to Fly)

The private key reaches the server one way: typed (pasted) into `recover-keys` through `railway ssh`, which reads it
with the echo off and drops it when it is done. Never a variable, never a file on the volume.

1. Attach the new, empty volume at `/data`, with the same variables and the same bucket.
2. **Hold the server**: Settings → Deploy → Custom Start Command
   `node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts hold`, and deploy. `hold` answers `/readyz` and
   nothing else (everyone else gets "Down for maintenance"), opens nothing on the volume, and keeps the container up
   so `railway ssh` reaches it. The log says `holding on port 8080 …`. (Unverified on Railway: that the deploy
   passes its healthcheck on hold's `/readyz` and `railway ssh` reaches it. The local drill proves the commands.)
3. `railway ssh`, then:

   ```sh
   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts recover-keys --dry-run
   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts recover-keys
   ```

   Each asks for the recovery private key (paste the `cp-recovery:…` line, Enter; it isn't shown). The dry run opens
   every key and writes nothing (on a new volume; on a volume with keys it records the proof); the run prints
   `recovery key <fingerprint>` (the one beside your copies), `N keys brought back from the bucket (each proven
   against its replica)`, and `next: deploy with RESTORE_ON_BOOT=1`. A key is adopted only when every object of its
   store's replica opens under it: one that doesn't is refused as `may be FORGED` (rotate the R2 token, tell the
   coordinator). A store with no replica at all (signed up, never used) is left (`not adopted: no replica`) and gets
   a new key at its first open; `--adopt-unproven` adopts such keys anyway, with a WARNING. **`more than one place in
   the bucket holds control replicas (control/, control/<id>/)`** has an honest cause too: the volume was lost while
   a control re-key (`migrate-keys`) was pending, or before a start dropped the old control replicas. A person then
   decides which place is current: the one whose id is the key id in `keys/control.sealed` (the third `.`-separated
   part of the object), and whose newest `.ltx` files are the latest. Delete the other prefix in R2's object browser
   (only after the R2 token was rotated, if a leak is possible), and run `recover-keys` again. When unsure, tell the
   coordinator before deleting anything. A wrong key refuses before anything is
   written (`this private key (fingerprint …) isn't the recovery key the bucket's keys are sealed to (…)`). It is
   safe to run again. Then `exit`.
4. **Clear the start command**, add `RESTORE_ON_BOOT=1`, raise the healthcheck timeout for this one deploy
   (Settings → Deploy → Healthcheck Timeout, or `RAILWAY_HEALTHCHECK_TIMEOUT_SEC=1800`), because every restored
   store's cache is rebuilt before the server listens. Then deploy.
5. The log shows:
   - `restored the control databases: 2 restored, 0 already here`;
   - each restored store's cache being rebuilt before `serving` (a large store takes a while);
   - `RESTORE_ON_BOOT: N store databases restored. Unset RESTORE_ON_BOOT now.`;
   - and, only if any failed, `N store restores FAILED`. Those stores wait, and everyone else is served.
6. **Remove `RESTORE_ON_BOOT`** and the raised timeout, then redeploy.

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
  path, which loses at most the last seconds not yet replicated. Since WB1 the keys come back with the private key:
  hold the server (Restore, step 2), `railway ssh`, run `… main.ts recover-keys --control-aside 1` (it moves
  `control/` to `/data/control.aside-1` first, says `--control-aside 1: moved control/ …`, then asks for the private
  key), clear the start command and deploy once with `RESTORE_ON_BOOT=1`, then unset it. Without `--control-aside`,
  `recover-keys` refuses beside those databases: the control key is never adopted beside control databases that
  may not be the bucket's.

  (`CONTROL_ASIDE=<label>` as a variable still moves `control/` at a `serve`, but a `serve` can't bring the keys
  back, so on its own it only turns this refusal into "… sealed to the recovery key … run recover-keys".)

  It moves `control/` only on a volume that refuses for this reason (the bucket has the control key, this volume
  doesn't). On any other volume it logs `…isn't refusing for the control key…: nothing moved`, so it can never set
  aside the only copy of the accounts. A bucket it can't read stops it (`did not start`), with nothing moved.

  It moves `control/` aside **once per label**, ever: it writes `/data/overrides/control-aside-1.used` (`claimed`,
  then `moved` after the move), and nothing deletes that file. A re-run logs `…was used once already: nothing
  moved`. `…claimed but the move didn't finish` means it stopped between the two; `control/` is where it was. **To
  do it again on purpose, use a new label** (`2`, then `3`, …). The used labels are in `/data/overrides/`.
- **"… sealed to the recovery key, which the server never holds: run recover-keys with the recovery private key
  first"**, on a restore (`RESTORE_ON_BOOT=1`, a new or empty volume): the keys aren't on this volume yet. Nothing
  was restored, and the bucket wasn't touched; the start leaves an empty `keys/keys.sqlite`, which is no obstacle.
  Follow "The whole volume is gone" from step 2. The per-store **`backup.keyless … reason=sealed`** at a start is
  the same thing for one store (its key lost from `keys.sqlite` while the bucket has it): `hold`, `recover-keys`,
  serve again.
- **"N wrapped store keys in keys/keys.sqlite don't open"**, at a start: `keys/volume.kek` is missing or isn't this
  volume's, or (before `migrate-keys` finished) they are under `HOSTED_KEKS` and that variable was removed or
  changed. Put `HOSTED_KEKS` back as it was and run `migrate-keys` ("Write-only backups"). A lost `volume.kek` beside
  keys under it is never replaced by a new one: remove `keys/` (`rm -rf /data/keys`, in `hold`) and bring the keys
  back with `recover-keys`.
- **"this private key (fingerprint …) isn't the recovery key the bucket's keys are sealed to (…)"**, from
  `recover-keys`: a mistyped or other copy. **Compare fingerprints first** (`recovery-fingerprint` on each copy,
  against the one written beside them and the one serve logs). Nothing was written.
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
    bucket's backups" (the first entry above): `recover-keys --control-aside <new label>` in `hold`, then one deploy
    with `RESTORE_ON_BOOT=1` (or "…no accounts database…": `recover-keys`, then `RESTORE_ON_BOOT=1`). No
    `rm -rf /data/keys` is needed.
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
  `NEW_BUCKET=…: …on purpose…`, and R2 then shows `keys/control.sealed`. Unset it once it is serving. Left set, each
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
  the upload). Nothing to do. Within a minute, R2's object browser shows `keys/<id>.sealed` and objects under `tenants/<id>/`.
- **`backup.keyless storeTag=<tag> reason=<reason>`**, with **"N stores that lived have no key here or in the
  bucket"** below it: the store serves, but isn't backed up, and no key was made, on purpose. By reason:
  - `no-database`: its database isn't on this volume. It also waits for a restore (`RESTORE_ON_BOOT=1`), or for
    `start-over` if it never reached the bucket.
  - `bucket-unproven`: the bucket had no control key before this start, which `NEW_BUCKET` said is on purpose (since
    R7 that is the only way a volume that lived gets here). **Check `R2_BUCKET` anyway.** If it's wrong after all,
    fix it and redeploy. If it's right, the next start makes the key, because this start put the control key there.

    A start refused with **"the bucket's control key is a different key from this volume's"** has a control key here
    that some start against another bucket made (one before R7, or one on a volume with no one on it yet, after
    `keys/keys.sqlite` was lost). The way back: hold the server (Restore, step 2), `railway ssh`, remove `keys/`
    (`rm -rf /data/keys`), run `recover-keys --control-aside <new label>` with the private key, then clear the start
    command and deploy once with `RESTORE_ON_BOOT=1`, then unset it.
  - `sealed` (WB1): its key isn't on this volume, and the bucket has it sealed to the recovery key. Never minted
    over. `hold`, `recover-keys`, serve again ("… sealed to the recovery key …" above).
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

### The drill with the real binary (again after a new recovery key, or a Litestream bump)

The hermetic tests (`hosted/test/ops.test.ts`, `hosted/test/wb1.test.ts`) drive the restore through a stand-in
Litestream. They prove our side: the key objects, the configuration, the arguments, the layout, the cache rebuild,
and the words coming back through `/mcp`. They don't prove Litestream itself, R2 or SSE-C, and they don't prove that
the offline copies of the recovery key are production's. The drill proves those, in two halves.

**Why two halves.** The real private key never goes anywhere near a drill. So:

- **The copies are proven by fingerprints.** `recovery-fingerprint` on each offline copy must print the fingerprint
  that production's own log prints at every start (`key objects sealed to recovery key <fingerprint>`), which is
  `HOSTED_RECOVERY_PUBKEY`'s. A copy whose fingerprint matches is the private half of the key every key object is
  sealed to (the fingerprint is SHA-256 over the public key, which the private key derives).
- **The restore is proven with a throwaway recovery keypair.** The script runs the image, the real Litestream and a
  drill bucket (on R2, or `--local`: a local S3 with SSE-C). The keypairs are made for the drill and thrown away
  after it.

**Your steps for the copies** (once per recovery key): `bun hosted/src/main.ts recovery-fingerprint` for each
offline copy (the password manager's, then the paper's), pasting the key at the prompt (it isn't shown). Each must
print the fingerprint written beside the copies and the one in Railway's deploy log. If one differs, fix that copy
now, while the volume still holds every key.

Before WB1 (until the migration below) the copies were KEK copies, proven the same way against `HOSTED_KEKS`; that
history is in git (this file, 2026-11-02).

**Your steps for the script with R2** (the bucket once per drill; `--local` needs none of this):

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

**The script** runs the other half. It needs Docker and bun (and `gh` signed in, for production's deployed commit),
from a checkout with hosted's dependencies. Run it as one background process (about five minutes):

```sh
bun install --cwd hosted --frozen-lockfile
hosted/drill/drill.sh --rehearse     # optional first: steps 0-3 with BACKUPS=off, no bucket and no credentials
hosted/drill/drill.sh                # the drill on R2, production's deployed image; after a failure, --from <step>
hosted/drill/drill.sh --local        # the drill on a local S3 (SeaweedFS, SSE-C over TLS), this checkout's HEAD
hosted/drill/drill.sh --sha <commit> # the drill on R2, the image built from that commit (a change before it deploys)
hosted/drill/drill.sh --migration   # local too: the image from before WB1 under HOSTED_KEKS, then Mike's migration steps on the new one
```

`--local` needs no Cloudflare account and no credentials: it starts `chrislusf/seaweedfs:4.50` on a Docker network of
its own, with a throwaway CA, certificate and access key made for the run, and removes all of it at step 13. It
proves everything the R2 drill does except R2 itself (the local S3 enforces SSE-C the same way: a plain GET of an
SSE-C object answers 400).

Everything it writes goes to `$COUNTERPARTS_DRILL_DIR` (default `$TMPDIR/counterparts-drill`), outside the
repository: `RESULTS.md` (`RESULTS-local.md` for `--local`; one line per step, pass or FAIL, and what it saw), the
container logs, a 0600 state file, and the throwaway private keys (0600), deleted at the end. It never prints a
key, a token or the R2 secret. Docker gets them by name (`-e NAME`); a private key reaches a container on stdin
only. The steps, and what each proves:

| Step | What it does | What it proves |
| --- | --- | --- |
| 0 | Reads production's deployed commit from GitHub's deployments (or `--sha`, or HEAD with `--local`), builds the image from a worktree at it, checks Litestream's version, empties the drill bucket, makes throwaway recovery keypairs P1 and P2 (`recovery-keygen`) | the drill runs what production runs |
| 1-2 | Serves sealing to P1, two invites, two sign-ups through the emailed link; user 2 never connects | a store signed up and never opened doesn't upset Litestream (INTERFACE-GAPS §16) |
| 3 | OAuth as claude.ai does it (DCR, PKCE, Allow), `wake`, `remember` A | the real door |
| 4 | Waits for the store and both control databases to replicate, by TXID | Litestream replicates to R2 |
| 5 | A plain GET of every replica object; the store's own object with its key; every key object | SSE-C: nothing readable without the key; every key object `keys/<id>.sealed`, sealed to P1, holding no SSE-C key |
| 6 | `remember` B, then `docker stop` at once | the shutdown sync (step 10 tells whether B survived) |
| 7-8 | Removes the volume; starts without `RESTORE_ON_BOOT` | an empty volume beside a bucket with backups refuses, the bucket unchanged |
| 9 | `RESTORE_ON_BOOT=1` with no private key; then `hold` and `recover-keys` with P2 (the wrong one) | without the private key nothing restores, with the wrong one nothing opens; no volume key made, the bucket unchanged |
| 10 | `hold`, `recover-keys --dry-run` and `recover-keys` with P1 on stdin (as through `railway ssh`), then `RESTORE_ON_BOOT=1`; recall A and B with the token from before; refresh | the Railway restore works; everything comes back, the person stays connected, the never-opened store doesn't fail |
| 11 | `remember` C, waits for it to replicate | replication goes on after a restore |
| 12 | A second cycle: stop, volume gone, `hold` + `recover-keys`, restore, recall A, B and C | a restored server restores again |
| 13 | Cleanup: container, volume, bucket emptied, image, worktree, state, the throwaway private keys (and the local S3) | nothing of the drill is left but its logs |

**Cleanup.** A rehearsal that passes removes its container, volume and state; one that fails leaves them for
`--from`, and holds port 8080 until you clean it up:
`docker rm -f drill-rehearsal; docker volume rm cp-drill-rehearsal; rm "$COUNTERPARTS_DRILL_DIR"/rehearsal-state.*`.
Step 13 empties the bucket and removes everything local except the logs. Then you delete the drill
token and the empty bucket in Cloudflare, and the logs directory when you're done reading it.

**Run it again after a new recovery key, or a Litestream bump.** A new recovery key needs the fingerprints again; a
Litestream bump needs the script.

**2026-11-02 (before WB1, with KEK copies): both halves passed.** The fingerprints: at about 10:19, KEK v1 from the password manager, from the paper
copy and from Railway's `HOSTED_KEKS` (a single `v1` entry) all matched, and the fingerprint is written beside both
offline copies. The script: steps 0-13 passed (one resume at step 4 after a script bug), on the deployed image (3fe0aa75, Litestream 0.5.17, arm64). Both refusals left the
bucket unchanged. B, written just before the stop, came back. The old token and the refresh both worked after
the restore. Plain GETs answered `400 InvalidRequest` (×32).

**2026-11-06 (WB1, `--local`): the script passed steps 0-13 in one run**, on the WB1 branch's image (19e5af6a,
Litestream 0.5.17, arm64) against SeaweedFS 4.50 with SSE-C: every key object `keys/<id>.sealed` to P1, none holding
an SSE-C key; `RESTORE_ON_BOOT=1` with no private key and `recover-keys` with P2 both refused, no volume key made, the
bucket unchanged; `hold` + `recover-keys` with P1 brought back 3 keys (control and both stores), then
`RESTORE_ON_BOOT=1` restored everything, B survived the stop, the old token and the refresh worked, and a second
cycle restored A, B and C. Plain GETs answered `400 InvalidArgument` (×29). Not yet on R2 or Railway.

Still open from the first deploy: Railway's drain time. On Railway, the old container gets a drain time before it
is killed. Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60` so the final sync can finish (unverified; check Railway's
current name for it). The drill's `docker stop` took 0.6 s on the Mac, which says nothing about Railway.

## Write-only backups (WB1, 2026-11-06)

**What changed.** Before WB1 the KEK sat in Railway's environment (`HOSTED_KEKS`) beside the R2 token, so a leak of
the environment opened every backup. Now:

- the KEK is on the volume (`/data/keys/volume.kek`, 0600), made by the server at its first key, never backed up;
- every key object in the bucket (`keys/<id>.sealed`, each store's and the `control` key) is sealed to the recovery
  key's PUBLIC half (`HOSTED_RECOVERY_PUBKEY`). The server can write them and never open them;
- the private half is only in your two offline places. Only `recover-keys` uses it, after a volume is lost.

What each leak gets now: **the environment** (the R2 token, the public key, everything else) and a copy of the
bucket: no key, so no backup opens. **The bucket alone**: the same. **The volume**: everything (the live stores are
plaintext on it, as before; with it, the bucket's history opens too). The memory backups are each under their
store's own key; the control databases' backup (accounts, email, OAuth) is under the one `control` key, sealed the
same way.

### The migration (once, at the release that brings WB1, BEFORE THE FIRST STRANGER INVITE)

These steps are written so the release sheet can copy them. **Run all of them before inviting anyone from outside
the family**: the stores that exist at the migration keep their keys (below), and that is accepted only for those.

1. **Make the recovery keypair** on your Mac, from `~/counterparts`: `bun hosted/src/main.ts recovery-keygen`. It
   prints the public key, the fingerprint and the private key once, and writes no file. Put the `cp-recovery:…` line
   in the password manager and on paper, then clear the terminal (section 1, step 1: Cmd-K, and what it doesn't clear). Check EACH copy with
   `bun hosted/src/main.ts recovery-fingerprint` (paste it; it isn't shown): both must print the fingerprint keygen
   printed. Write that fingerprint beside both copies. This is the proof the migration relies on: the private key
   never goes near the server for it.
2. **Set `HOSTED_RECOVERY_PUBKEY`** on Railway to the `HOSTED_RECOVERY_PUBKEY=` value it printed. Leave `HOSTED_KEKS`
   as it is.
3. **Deploy the release.** It serves as before, and seals every key object. The log says `N keys are still under
   HOSTED_KEKS: stop the server and run migrate-keys` and `key objects sealed to recovery key <fingerprint>`: it must
   be the fingerprint beside your copies.
4. **Dry-run the migration** beside the running server: `railway ssh`, then
   `node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts migrate-keys --dry-run --recovery-fingerprint <fingerprint>`
   (the one beside your copies). It must say `recovery key …: the one named`, `control would be re-keyed` and `a run
   would finish the migration`. Anything else: stop, tell the coordinator. (`migrate-keys` refuses to run without
   `--recovery-fingerprint` naming the key every object is sealed to: a key whose copies weren't checked would
   otherwise leave no working copy of any key in the bucket. It also refuses beside a running server.)
5. **Run it with the server stopped**: Settings → Deploy → Custom Start Command
   `node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts migrate-keys --recovery-fingerprint <fingerprint>`,
   deploy once, read the log, then clear the start command. It prints the counts, `control re-keyed: …`, and ends
   `done: nothing here or in the bucket needs HOSTED_KEKS now`. Railway restarting the command is harmless: a second
   run does nothing and says `done` again. `NOT done` lists what needs a look (by store tag): keep `HOSTED_KEKS` and
   tell the coordinator. A start after a run cut short refuses (`a control re-key (migrate-keys) was cut short`): run
   step 5 again. **If it keeps failing with `the control re-key's new snapshot didn't prove`** (Litestream can't reach
   the bucket, say), back out so the server serves again:
   `node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts migrate-keys --abort-control-rekey` as the start
   command, deploy once, clear it (it keeps the old control key, deletes the new one and its replicas; nothing else
   changes), and tell the coordinator; step 5 can be run again later. (Unverified on Railway: a start command that
   exits, as `rewrap` was; `hold` + `railway ssh` + the same line is the other way. Litestream runs inside it for the
   re-key, on the image's own binary.)
6. **Remove `HOSTED_KEKS` and `HOSTED_KEK_CURRENT`** from Railway's variables, and redeploy. It serves, with no
   `still under HOSTED_KEKS` line. A start that says `don't open … set HOSTED_KEKS back` means step 5 didn't finish:
   put the variable back and run step 5 again.
7. **Rotate the R2 token.** In Cloudflare, make a new token as in section 3, step 3 (Object Read & Write, this bucket
   only), set `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` on Railway to it, redeploy, check `/readyz` and the
   `backup.uploads` lines, then delete the old token. The old one sat in the same environment as `HOSTED_KEKS`.
8. **Keep the old KEK's two offline copies until no R2 object needs them**: after step 5 says `done`, R2's object
   browser shows no `keys/*.wrapped` (only `keys/*.sealed`) and no `control/accounts.sqlite/` or
   `control/oauth.sqlite/` (control's replicas are under `control/<key id>/` now). Then retire them (destroy the
   paper copy, delete the password-manager entry).

**What stays exposed, exactly.** The control key is re-keyed by step 5: a new control DEK, the accounts and OAuth
databases replicated under it to `control/<key id>/` and proven by a restore, the old control replicas deleted. So an
old `HOSTED_KEKS` (from Railway's variable history, or any leak before step 6) opens no control backup in any copy of
the bucket taken after step 5, and nothing written after it. A copy of the bucket taken BEFORE step 5, with that old
`HOSTED_KEKS`, still opens the control history up to then (accounts and OAuth rows as they were). The memory stores that exist at the migration (yours and the test accounts) keep their
DEKs, so their backups, past and future, stay openable by an old `HOSTED_KEKS` together with a copy of their old
`keys/<id>.wrapped` taken before step 5. That is accepted (DESIGN §5.4). Every store made after the release deploys
has a key no environment ever held.

**Before any recovery after a suspected leak, rotate the R2 token first** (step 7's way). That is the real defence.
Anyone holding the token can write the bucket, so could put a sealed key of their own there. `recover-keys` adopts
no key unless every object of the store's own replica opens under it (it says `may be FORGED` when one doesn't), and
refuses control when more than one place under `control/` holds replicas (naming them). That catches a lone forged
key object, a mixed replica and an accident. It does NOT catch someone who sealed a key of their own AND replaced a
store's whole replica with one under it: they could have deleted the bucket too. A `403` from the bucket is said as
such (`check the R2 token`), never as a forgery.

### A new recovery key

Make it as in section 1, step 1, record it offline first, set `HOSTED_RECOVERY_PUBKEY` to the new public key and
redeploy: the start seals every key object to it again (`sealedState` "stale"), and the old private key opens none of
them from then on. Keep the old one until that start says `key objects sealed to recovery key <the new fingerprint>`.

### The volume key

`keys/volume.kek` never leaves the volume and needs no copy: a lost volume brings its keys back from the bucket with
the recovery key, under a new volume key. There is no command to rotate it (a leak of the volume is a leak of the
stores themselves). A `volume.kek` lost while `keys/keys.sqlite` stays is never replaced over keys under it ("If a
start refuses").

### The Cloudflare key service (replaced by WB1)

The plan was a key service on Cloudflare reachable only from Railway's fixed egress IP, before any non-family
user. Railway's Hobby plan has no static outbound IP (checked 2026-11-06), so the key service, and an IP-locked R2
token, would need Pro. WB1 meets the same goal (an environment leak opens no backup) without it.

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
  before a keep it comes back pending: INTERFACE-GAPS §36), and a new recovery key re-seals
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

## Railway's notifications (built in; nothing of ours sends anything)

Checked against Railway's docs 2026-11-04. Each line says whether the docs confirm it. For the beta, items 1 and 2
are the ones in use (crash and deploy-failure emails on; a usage email alert). Items 3 (monitors) and 4 (webhooks)
are not set up for now; they're here for when they are.

As of 2026-11-04 (checked in Mike's dashboard): crash, deploy-failed, OOM and usage notifications are already Email &
In-App; the usage email alert is $25, with a hard limit of $150 (left as is); the workspace has one member, Mike.

1. **Crash and failed deploy, by email.** Railway restarts a crashed deployment up to 10 times, then marks it
   `Crashed` and emails the project's members (CONFIRMED, docs.railway.com/deployments/deployment-actions). Where to
   set it: your Account Settings, notifications: "Enable email and in-app notifications in your Account Settings"
   (CONFIRMED, docs.railway.com/overview/production-readiness-checklist). The exact page name inside Account Settings
   is NOT CONFIRMED by the docs. Railway's changelog (2025-11-21, not a docs page) says build failures, deploy
   crashes and usage alerts are on by default, each settable to Email & In-App, Email Only, In-App Only or None,
   with per-project overrides. Check that "build/deploy failures" (failed builds, crashed deployments, OOM kills) and
   "usage" are set to Email & In-App. Whether a deploy that fails its healthcheck counts as a failed deploy for this
   email is NOT CONFIRMED.
2. **Usage: a soft email alert, and a hard limit.** The workspace's Usage page → Set Usage Limits (CONFIRMED,
   docs.railway.com/pricing/cost-control). "Custom email alert" is a soft threshold: an email, nothing stops. "Hard
   limit" takes workloads offline when reached, so set it well above the alert, or leave it off. Both are per
   "Compute Usage". Only workspace admins can set them; every plan has them.
3. **Not set up for now. Monitors (Pro plan only): CPU, RAM, disk.** The project's Observability dashboard → a widget's three-dot menu
   → Add monitor (CONFIRMED, docs.railway.com/guides/monitoring). Above or below a threshold, by email and in-app,
   per environment. Worth one on disk usage (say 80%). Whether that disk widget is the volume is NOT CONFIRMED; the
   volume has its own "volume usage" alerts (a webhook event, and a notification type in the changelog), whose
   threshold setting the docs don't show.
4. **Not set up for now. The same into Discord or Slack.** Paste a Discord channel webhook URL or a Slack incoming-webhook URL.
   Railway reformats for Discord and Slack itself, so nothing of ours receives it. Events: deployment status
   (`Failed`, `Crashed`), volume usage alerts, monitor alerts. Delivery pauses for 24 h after 100 failures in 6 h.
   - Where: the docs give two places, and don't say how they differ (docs.railway.com/observability/webhooks):
     project → Settings (top right) → Webhooks tab → Save Webhook; and, in the Discord guide on the same page, the
     input under "Build and Deploy Webhooks" in the project's deployment settings. Which one a Discord paste belongs
     in is NOT CONFIRMED: try the Webhooks tab first.
   - "Test Webhook" is a real test: Railway's servers send it (not your browser), with the custom headers from the
     form, a 10 s timeout, and it shows the status code your endpoint answered (CONFIRMED, same page).
   - Plan requirement NOT CONFIRMED.

What none of this sees: a container that runs and answers wrongly. Railway's healthcheck runs at deploy time only
("Railway does not monitor the healthcheck endpoint after the deployment has gone live",
docs.railway.com/reference/healthchecks), so `backups: "stale"` and its log line reach no one until someone curls
`/readyz` or reads the log. An outside uptime checker would close that; it is not set up, on purpose.

### Daily check during the beta

Nothing outside watches `backups: "stale"`, so the coordinator's morning read (which already reads the night's log)
does it:

1. `curl -s https://app.counterparts.ai/readyz`: every check `"ok"`.
2. In the night's hosted log, look for `backup.uploads.stale` and for Litestream's own `level=ERROR` lines. The second
   is the only signal for one store's replica failing while control's uploads land (INTERFACE-GAPS §7).
3. A real alert (something that pages without anyone reading) comes once there are more than 10 users.

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
