# The hosted server: runbook

For `app.counterparts.ai`: the first deploy, the checks after it, restores, key rotation and rollback. The design is
in `DESIGN.md`, the guarantees in `hosted/CONTRACT.md`, what is still owed in `hosted/INTERFACE-GAPS.md`.

Written 2026-10-26 (OL2b). Nothing here has been run against Railway or R2 yet. Each step that hasn't been verified
says so, and the first deploy is where it gets checked.

Never paste a secret into a chat, a commit or an issue. Every value below goes into Railway's variables page or a
password manager, and nowhere else.

---

## 1. Before you start (about 10 minutes, any time)

1. **Generate the KEK** on your Mac:

   ```sh
   openssl rand -base64 32
   ```

   Save it in your password manager as "Counterparts hosted KEK v1". **Without it, every backup is unreadable.**
   No copy of it exists anywhere else.
2. **Generate the cookie keys** (these sign the OAuth library's cookies):

   ```sh
   openssl rand -base64 48
   ```

   Save it too. It is less precious: losing it only ends sign-ins that are in progress.
3. **Resend.** The sending domain (`counterparts.ai`) must be verified. You'll need an API key that can send only.

## 2. Railway (about 15 minutes)

1. Create a new project with one service, built **from this GitHub repo**.
   - Settings → Build: the builder is **Dockerfile**, the Dockerfile path is `hosted/Dockerfile`, and the root
     directory stays the repo root. (`RAILWAY_DOCKERFILE_PATH=hosted/Dockerfile` as a variable does the same.)
   - Settings → Deploy:
     - healthcheck path `/readyz`;
     - **one replica**: the rate limits live in memory, and the stores must have one writer.
2. Add a **volume** to the service, mounted at `/data`.
   - Railway mounts volumes owned by root, and the image runs as the `node` user. If the first boot logs
     `EACCES` under `/data`, add the variable `RAILWAY_RUN_UID=0`. That's Railway's documented switch for this
     (unverified here).
3. Add the **variables**. These are names only; the values come from step 1 and step 3 of this runbook.

   | name | value |
   |---|---|
   | `HOSTED_DATA_ROOT` | `/data` |
   | `PUBLIC_ORIGIN` | `https://app.counterparts.ai` |
   | `TRUST_PROXY` | `1` |
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

   Don't set `PORT`: Railway sets it. Don't set `MAIL`, `BACKUPS` or `RESTORE_ON_BOOT`.

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

1. In Railway: service → Settings → Networking → Custom domain → `app.counterparts.ai`. It shows a CNAME target.
2. In Cloudflare DNS for `counterparts.ai`: a `CNAME` record `app` → that target, **proxy off (DNS only, grey
   cloud)**.
   - With the proxy on, Cloudflare adds a hop in front of Railway's, and every person would share one rate-limit
     bucket (section 5, step 3).
   - Railway issues the TLS certificate itself once the record resolves.

## 5. First boot checks

1. **The deploy log** shows `[hosted] serving https://app.counterparts.ai on port …` and no `refused:` line. Every
   refusal names the variable it wants.
2. **Ready:**

   ```sh
   curl -s https://app.counterparts.ai/readyz
   ```

   Expect `{"ready":true,"checks":{"started":"ok","control":"ok","keys":"ok","backups":"ok"}}`.
   - `backups: "down"` means the Litestream child isn't running. Look in the log for its own lines.
   - The body never holds an id or a key. If it ever does, that's a bug.
3. **The proxy's hops** (INTERFACE-GAPS §4). Find your own IP (`curl -s https://ifconfig.me`), then run the
   `/readyz` curl again. The log shows `[hosted] /readyz X-Forwarded-For: …`.
   - **Exactly your IP**, alone: good. The server takes the last hop, which is the one Railway appended.
   - **Your IP, then another address**: Railway put a second hop in. Every person would then share the last
     address's rate-limit bucket. Tell the coordinator before inviting anyone; it's a one-line change in
     `web.ts#clientIp`.
   - Then **delete `LOG_FORWARDED_FOR`** and redeploy.
4. **The bucket**: after a minute, R2's object browser shows `keys/control.wrapped` and `control/accounts.sqlite/…`.
5. **Litestream's own words**: the log has Litestream's start lines, and no repeated `sidecar.backoff`.

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

## 7. BEFORE you add the connector: Claude Code

Claude Code loads claude.ai's connectors. Once the hosted connector is in your claude.ai account, every Claude Code
session would get a second memory server over a different store. So, first, in your `~/.claude/settings.json`,
extend `deniedMcpServers`. Today it lists `*.trycloudflare.com` and `claude.ai counterparts-trial`; add the hosted URL
and the name you'll give the connector:

```json
{ "serverUrl": "https://app.counterparts.ai/*" },
{ "serverName": "claude.ai Counterparts" }
```

- The name is `claude.ai ` followed by exactly what you type as the connector's name in step 8.2.
- Restart Claude Code. Then, once step 8 is done, `/mcp` in a new session must NOT list it.

## 8. The connector

1. claude.ai → Settings → Connectors → Add custom connector.
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

**You need the KEK ring that wrapped the keys.** A restore with a ring that can't open a key object refuses, and it
writes nothing.

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
bucket starts normally.)

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

A crash-looping service can't be reached with `railway ssh`. Use a **start-command override** instead: Settings →
Deploy → Custom Start Command, deploy once, read the log, then **clear it**. The image's entry point is
`node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts`, so an override names the whole line.

- **"…but not the key that wrote the bucket's backups"**: this volume has a control database, but not the control
  key. Either something else made that database (an `invite` or a `BACKUPS=off` run on a lost volume), or only
  `keys/keys.sqlite` was lost and the control databases are fine. The server can't tell which, so both take the safe
  path, which loses at most the last seconds not yet replicated. Set `RESTORE_ON_BOOT=1` and this override for one
  deploy, then clear the override:

  ```sh
  sh -c 'test -e /data/control.aside-1 || mv /data/control /data/control.aside-1; exec node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts serve'
  ```

  The `test -e` makes it move `control/` aside **once**. A crash-restart of the same deploy runs the override again
  and must not move the freshly restored `control/` aside too. (If `control.aside-1` is still there from an earlier
  incident, use `-2`.)
- **"N of the control databases are missing"**: a control restore was cut short. `RESTORE_ON_BOOT=1` restores the
  missing one alone.
- **Copies set aside hold addresses and memories**, outside the 24-hour purge: `/data/control.aside-*` from the
  override above, and every `*.pre-restore-*` file that a `--force` restore moved aside. Every start deletes any
  that are more than a day old, and logs `deleted N copies set aside…`. Check one within the day if you need to,
  then let it go, or delete it by hand sooner (`rm -rf /data/control.aside-1`).
- **"N stores that lived have no key here or in the bucket"**: those stores serve, but aren't backed up. Tell the
  coordinator; no new key is made on purpose.

### The drill with the real binary (do it once, soon after the first deploy)

The hermetic test (`hosted/test/ops.test.ts`) drives the restore through a stand-in Litestream. It proves our side:
the key objects, the configuration, the arguments, the layout, the cache rebuild, and the words coming back
through `/mcp`. It doesn't prove Litestream itself. This does. It runs on your Mac, with Docker, against a **second
bucket** (e.g. `counterparts-drill`, with its own token scoped to it), and a throwaway KEK:

```sh
docker build -f hosted/Dockerfile -t counterparts-hosted .
export DRILL_KEK="v1:$(openssl rand -base64 32)"        # throwaway; never the real one
run() { docker run --rm -p 127.0.0.1:8080:8080 -v cp-drill:/data \
  -e HOSTED_DATA_ROOT=/data -e PUBLIC_ORIGIN=http://127.0.0.1:8080 -e MAIL=log \
  -e HOSTED_KEKS="$DRILL_KEK" \
  -e R2_ENDPOINT -e R2_BUCKET=counterparts-drill -e R2_ACCESS_KEY_ID -e R2_SECRET_ACCESS_KEY "$@" counterparts-hosted; }
run --name drill -d                                          # 1. serve (the drill bucket's token in R2_* of this shell)
docker exec drill node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts invite
#    sign up at http://127.0.0.1:8080/login (the link is in `docker logs drill`), connect any MCP client, remember a line
docker stop -t 60 drill                                      # 2. Litestream's last sync on SIGTERM (give it time)
docker volume rm cp-drill                                    # 3. the volume is gone
run --name drill -d                                          # 4. must REFUSE: the volume is empty, the bucket isn't
run --name drill -d -e RESTORE_ON_BOOT=1                     # 5. restores; recall the line through the client
```

Afterwards, empty the drill bucket. Things to note for the coordinator:

- **first: whether step 1's Litestream accepted the configuration.** It lists a store that signed up but was never
  opened, whose database file doesn't exist yet. The log should show Litestream waiting on it, not exiting;
- the time step 2 took (that's the final sync). On Railway, the old container gets a drain time before it is
  killed. Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60` so that sync can finish (unverified; check Railway's
  current name for it);
- whether step 5's recall found the line;
- whether R2's object browser shows the store's objects under `tenants/<id>/` and none readable without the key.

## Rotating the KEK

1. Generate v2 as in 1.1, then set `HOSTED_KEKS=v1:<old>,v2:<new>` and `HOSTED_KEK_CURRENT=v2`.
2. Stop the service, then run `… main.ts rewrap` once. It prints
   `rewrapped N keys onto v2; M key objects re-written`.
   - **Unverified on Railway:** a one-off command with the service stopped. If there's no such thing, use the
     start-command override above (`… main.ts rewrap`), deploy once, read the line, then clear the override.
3. Start the service, and check `/readyz`.
4. Only then drop `v1:` from `HOSTED_KEKS`, and redeploy. A ring that can't open a key refuses to start.

## Rollback

Stop the service: Railway → service → remove the active deployment, or scale it to zero. claude.ai's connector then
fails to reach it. **Nothing on your Mac is touched**: your local Counterparts, its store and its hooks don't know
the hosted server exists. The volume and the bucket stay as they are, so starting the service again resumes.

## Watch for in the first week

- **Retention lag** (INTERFACE-GAPS §2). Snapshots run every 12 h and are kept for 12 h. A day after the first
  deploy, R2's `control/accounts.sqlite/` should hold no snapshot older than about 24 h. If it does, the "account
  email purged from backups within 24 hours" promise needs a different number.
- **The final sync on SIGTERM.** Litestream 0.5.17's source has a shutdown sync (`shutdown-sync-timeout`). At each
  redeploy, the old container's log should end with Litestream's shutdown lines, before `sidecar.exit`.
- **Limits.** `[hosted] limit.rate-limited` / `limit.store-full` / `limit.in-flight` lines. Each line is a hashed
  store tag and nothing else. (Litestream's own lines, from the sidecar child, do name database paths, and so store
  ids. Railway's log is the operator's, not a place anyone else reads.) The numbers are loose on purpose: 120 calls a minute, 1,500 an hour, 8 at once,
  1 GiB a store.
- **An R2 outage stops a restart.** Start-up reads the bucket (`keys/`), so a deploy during an R2 outage refuses to
  start. It says `the object store (R2_ENDPOINT) didn't answer`. A server that is already running keeps serving.
