/**
 * THE COMPOSITION (OL2 step 4): accounts, the account pages, OAuth, the
 * tenants and the door, wired into one unlistened HTTP server.
 *
 * The data root is NAMED, always (`dataRoot`), and refused when it sits in a
 * live store (`remote/bin/serve-http.ts#livePathRefusal`). Under it:
 *
 *   control/accounts.sqlite   people, identities, stores, invites, sessions, audit
 *   control/oauth.sqlite      the OAuth library's rows, bearer values hashed
 *   tenants/<storeId>/        one per person (tenants.ts)
 *
 * Mike's hosted store is new and separate: nothing here reads a local store.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { isAbsolute, join } from "node:path";

import { exportStore as exportCoreStore } from "../../src/adapters/cli/export.js";

import { livePathRefusal } from "../../src/adapters/remote/bin/serve-http.js";
import { Accounts } from "./accounts.js";
import type { Mailer } from "./egress.js";
import type { CimdFetch } from "./egress.js";
import { createOAuth } from "./oauth.js";
import type { OAuth } from "./oauth.js";
import { accountPages } from "./pages.js";
import type { ConnectionView, Pages } from "./pages.js";
import { createHostedServer } from "./server.js";
import type { HostedCallRecord } from "./server.js";
import { Tenants, tenantDir } from "./tenants.js";
import { Backups } from "./backup.js";
import type { Sidecar } from "./backup.js";
import type { ObjectStore } from "./egress.js";
import { KeyStore } from "./keys.js";
import type { KeyWrapper } from "./keys.js";
import type { SharedEmbedder } from "./tenants.js";
import type { Spawner } from "../../src/adapters/spawn.js";

/** Step 5's pieces. Absent in tests of steps 2–4 and in a local run with no bucket. */
export interface AppBackupOptions {
  readonly wrapper: KeyWrapper;
  readonly objects: ObjectStore;
  readonly bucket: string;
  readonly endpoint: string;
  readonly sidecar?: Sidecar | null;
}

export interface AppOptions {
  /** HOSTED_DATA_ROOT: absolute, named, never a live store. */
  readonly dataRoot: string;
  /** `https://app.counterparts.ai` in production. */
  readonly publicOrigin: string;
  readonly mailer: Mailer;
  readonly trustProxy?: boolean;
  readonly embedder?: SharedEmbedder;
  readonly spawner?: Spawner;
  readonly cookieKeys?: readonly string[];
  readonly cimdFetch?: CimdFetch;
  readonly allowedOrigins?: readonly string[];
  readonly onCall?: (record: HostedCallRecord) => void;
  readonly maxOpenStores?: number;
  readonly backup?: AppBackupOptions;
}

export interface App {
  readonly server: Server;
  readonly accounts: Accounts;
  readonly pages: Pages;
  readonly oauth: OAuth;
  readonly tenants: Tenants;
  readonly keys: KeyStore | null;
  readonly backups: Backups | null;
  /** Start-up work that may touch the network: finish any delete a crash cut short, then backups' `ensureAll`. */
  start(): Promise<void>;
  /** Delete one person's account and memory, at once, everywhere. Idempotent: running it again finishes a delete that failed part-way. */
  deleteAccount(personId: string): Promise<void>;
  /** Finish every delete that began and didn't end (start-up, and a timer while serving). Returns how many finished. */
  finishPendingDeletes(): Promise<number>;
  close(): Promise<void>;
}

export function createApp(opts: AppOptions): App {
  if (!isAbsolute(opts.dataRoot)) throw new Error("the hosted data root must be an absolute path");
  const refused = livePathRefusal(opts.dataRoot, "the hosted data root");
  if (refused !== null) throw new Error(refused);
  const publicOrigin = opts.publicOrigin.replace(/\/+$/, "");
  const accounts = new Accounts({ path: join(opts.dataRoot, "control", "accounts.sqlite") });
  const keys = opts.backup === undefined ? null : new KeyStore({ path: join(opts.dataRoot, "keys", "keys.sqlite"), wrapper: opts.backup.wrapper });
  const backups =
    opts.backup === undefined || keys === null
      ? null
      : new Backups({
          dataRoot: opts.dataRoot,
          keys,
          objects: opts.backup.objects,
          bucket: opts.backup.bucket,
          endpoint: opts.backup.endpoint,
          sidecar: opts.backup.sidecar ?? null,
          liveStores: () => accounts.liveStoreIds(),
        });
  // Pages and OAuth need each other (the account page lists connections; the
  // Allow page needs the signed-in person), and pages need the delete that
  // needs OAuth and the tenants. Bound late, through these holders.
  let oauth: OAuth | null = null;
  let tenantsRef: Tenants | null = null;
  let deleteRef: ((personId: string) => Promise<void>) | null = null;

  // Export's plaintext copy is made on the data volume (encrypted at rest, and
  // swept at start-up after a crash), never in the container's /tmp.
  const scratchRoot = join(opts.dataRoot, "scratch");
  const exportStore = async (personId: string): Promise<{ path: string; filename: string; cleanup: () => void }> => {
    const storeId = accounts.person(personId)?.storeId;
    if (storeId === null || storeId === undefined || tenantsRef === null) throw new Error("no store");
    mkdirSync(scratchRoot, { recursive: true, mode: 0o700 });
    const scratch = mkdtempSync(join(scratchRoot, "export-"));
    const target = join(scratch, "out");
    const report = await tenantsRef.withTenant(storeId, {}, (t, server) => t.serial(async () => exportCoreStore(server.counterpart.store, { target, plaintext: true })));
    const file = report.ok ? readdirSync(target).find((n) => n.endsWith(".sqlite")) : undefined;
    if (file === undefined) {
      rmSync(scratch, { recursive: true, force: true });
      throw new Error("export failed");
    }
    const day = new Date().toISOString().slice(0, 10);
    return { path: join(target, file), filename: `counterparts-${day}.sqlite`, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
  };

  const pages = accountPages({
    accounts,
    mailer: opts.mailer,
    publicOrigin,
    ...(opts.trustProxy === undefined ? {} : { trustProxy: opts.trustProxy }),
    connections: {
      list: (personId: string): Promise<ConnectionView[]> => oauth?.connections.list(personId) ?? Promise.resolve([]),
      disconnect: (personId: string, id: string): Promise<void> => oauth?.connections.disconnect(personId, id) ?? Promise.resolve(),
    },
    ...(backups === null ? {} : { onSignup: (_personId: string, storeId: string) => backups.ensureStore(storeId) }),
    exportStore,
    deleteAccount: (personId: string) => (deleteRef === null ? Promise.reject(new Error("not ready")) : deleteRef(personId)),
  });
  oauth = createOAuth({
    publicOrigin,
    accounts,
    pages,
    storePath: join(opts.dataRoot, "control", "oauth.sqlite"),
    ...(opts.trustProxy === undefined ? {} : { trustProxy: opts.trustProxy }),
    ...(opts.cookieKeys === undefined ? {} : { cookieKeys: opts.cookieKeys }),
    ...(opts.cimdFetch === undefined ? {} : { fetch: opts.cimdFetch }),
  });
  const tenants = new Tenants({
    root: join(opts.dataRoot, "tenants"),
    ...(opts.embedder === undefined ? {} : { embedder: opts.embedder }),
    ...(opts.spawner === undefined ? {} : { spawner: opts.spawner }),
    ...(opts.maxOpenStores === undefined ? {} : { maxOpen: opts.maxOpenStores }),
  });
  tenantsRef = tenants;
  tenants.startSweeping();
  const o = oauth;

  /**
   * DELETE, AT ONCE, EVERYWHERE (design §5.4 as Mike changed it). In order,
   * each step audited by code:
   *   1. every session and connection stops (the person is marked deleting —
   *      durably, the store turns `deleting` — and every grant is revoked);
   *   2. the store is retired (never re-opened in this process) and its handle
   *      drains and closes;
   *   3. backups: out of the sidecar, the key file, the local wrapped DEK, the
   *      wrapped-key object in R2, the whole replica prefix in R2;
   *   4. the tenant dir is removed;
   *   5. the account: identities, sessions and links deleted, tombstones left.
   * Every step is idempotent. If one throws (a crash, R2 down), the store stays
   * `deleting`: it is never given a new key, and `finishPendingDeletes` runs the
   * whole sequence again at start-up and on a timer until it ends.
   */
  const inFlight = new Map<string, Promise<void>>();
  const runDelete = async (personId: string): Promise<void> => {
    accounts.markDeleting(personId);
    o.revokeAll(personId);
    for (const storeId of accounts.storesToDelete(personId)) {
      tenants.retire(storeId);
      await tenants.close(storeId);
      if (backups !== null) {
        const gone = await backups.removeStore(storeId);
        accounts.audit(personId, storeId, "delete.backups", String(gone));
      }
      rmSync(tenantDir(tenants.root, storeId), { recursive: true, force: true });
      accounts.audit(personId, storeId, "delete.store", null);
    }
    accounts.markDeleted(personId);
  };
  const deleteAccount = (personId: string): Promise<void> => {
    const running = inFlight.get(personId);
    if (running !== undefined) return running;
    const p = runDelete(personId).finally(() => inFlight.delete(personId));
    inFlight.set(personId, p);
    return p;
  };
  deleteRef = deleteAccount;
  const finishPendingDeletes = async (): Promise<number> => {
    let done = 0;
    for (const personId of accounts.pendingDeletes()) {
      try {
        await deleteAccount(personId);
        done += 1;
      } catch {
        accounts.audit(personId, null, "delete.retry.failed", null);
      }
    }
    return done;
  };
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  const server = createHostedServer({
    tenants,
    publicOrigin,
    authenticate: o.authenticate,
    routes: [o.route, pages.route],
    ...(opts.allowedOrigins === undefined ? {} : { allowedOrigins: opts.allowedOrigins }),
    ...(opts.onCall === undefined ? {} : { onCall: opts.onCall }),
  });
  return {
    server,
    accounts,
    pages,
    oauth: o,
    tenants,
    keys,
    backups,
    async start(): Promise<void> {
      rmSync(scratchRoot, { recursive: true, force: true });
      // Deletes first: a half-deleted store must be gone before backups look for live ones.
      await finishPendingDeletes();
      if (backups !== null) await backups.ensureAll();
      if (retryTimer === null) {
        retryTimer = setInterval(() => void finishPendingDeletes(), 10 * 60 * 1000);
        retryTimer.unref?.();
      }
    },
    deleteAccount,
    finishPendingDeletes,
    async close(): Promise<void> {
      if (retryTimer !== null) clearInterval(retryTimer);
      retryTimer = null;
      await tenants.closeAll();
      await opts.backup?.sidecar?.stop();
      o.close();
      keys?.close();
      accounts.close();
    },
  };
}
