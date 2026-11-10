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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import type { Server } from "node:http";
import { isAbsolute, join } from "node:path";

import { exportStore as exportCoreStore } from "../../src/adapters/cli/export.js";
// THE ERASE AFTER A CHAT'S HOLD (HD1, 2026-11-04): the console's own removal,
// run by this file's timer — never by anything a model talks to. This is the
// one file under hosted/src that may import it (`test/cli.test.ts` pins it).
import { sweepHeldRemovals } from "../../src/adapters/cli/removal.js";
import { overdueHolds } from "../../src/core/removal-hold.js";

import { livePathRefusal } from "../../src/adapters/remote/bin/serve-http.js";
import { Accounts } from "./accounts.js";
import type { Mailer } from "./egress.js";
import type { CimdFetch } from "./egress.js";
import { createOAuth } from "./oauth.js";
import type { OAuth } from "./oauth.js";
import { accountPages } from "./pages.js";
import { dashboardRoute } from "./dashboard.js";
import type { ConnectionView, Pages } from "./pages.js";
import { createHostedServer } from "./server.js";
import { Csrf } from "./web.js";
import type { ErrorWhere, HostedCallRecord } from "./server.js";
import { Tenants, storeTag, tenantDir } from "./tenants.js";
import { DATABASE_FILE } from "../../src/core/store/paths.js";
import { Backups, CONTROL_DATABASES, CONTROL_KEY_ID, UPLOADS_EVERY_MS, UploadWatch, keyObject, legacyKeyObject, tombstoneObject } from "./backup.js";
import type { KeylessReason, LitestreamRun, Sidecar, UploadsEvent } from "./backup.js";
import { McpLimits, dirBytes } from "./limits.js";
import type { LimitReason } from "./limits.js";
import type { Readiness } from "./server.js";
import type { ObjectStore } from "./egress.js";
import { KeyStore, csrfKey } from "./keys.js";
import type { KeyWrapper, RecoverySealer } from "./keys.js";
import type { SharedEmbedder } from "./tenants.js";
import type { Spawner } from "../../src/adapters/spawn.js";

/** Step 5's pieces. Absent in tests of steps 2–4 and in a local run with no bucket. */
export interface AppBackupOptions {
  /** The volume KEK (WB1; `keys.ts#VolumeKeyWrapper`), or a test's ring. */
  readonly wrapper: KeyWrapper;
  /** What every key object put in the bucket is sealed to (WB1): the recovery key's public half. */
  readonly sealer: RecoverySealer;
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
  /** How many proxy hops in front to trust (TRUST_PROXY; web.ts#clientIp). 0 or absent: none. */
  readonly trustProxy?: number;
  readonly embedder?: SharedEmbedder;
  readonly spawner?: Spawner;
  /** The OAuth library's cookie keys, newest first; the first also seeds the forms' CSRF key (`keys.ts#csrfKey`). */
  readonly cookieKeys?: readonly string[];
  readonly cimdFetch?: CimdFetch;
  readonly allowedOrigins?: readonly string[];
  readonly onCall?: (record: HostedCallRecord) => void;
  /** Each error that became a 500 or an "internal error" (`server.ts#HostedServerOptions.onError`). */
  readonly onError?: (where: ErrorWhere, store: string | null, err: unknown) => void;
  readonly maxOpenStores?: number;
  readonly backup?: AppBackupOptions;
  /** `/mcp`'s per-account limits (`limits.ts`); each absent number is that file's default. */
  readonly mcpLimits?: { readonly perMinute?: number; readonly perHour?: number; readonly inFlight?: number; readonly quotaBytes?: number };
  /**
   * Limit refusals and stores waiting for a restore, by hashed store tag (the
   * entry point logs them); and a new store whose backup set-up failed
   * (`backup.ensure.failed`, tagged by `storeTag`, the restore CLI's tag);
   * and, at start-up, a store that lived with no key anywhere: given one
   * (`backup.key.minted`) or not, and why (`backup.keyless.<reason>`), by
   * `storeTag` too (R5); and a delete's email that didn't send
   * (`delete.mail.failed`, by `storeTag`; R9).
   */
  readonly onEvent?: (name: `limit.${LimitReason}` | "store.needs-restore" | "backup.ensure.failed" | "backup.key.minted" | `backup.keyless.${KeylessReason}` | "delete.mail.failed" | "removal.overdue", store: string) => void;
  /** The clock for accounts (a pending delete's deadline, sessions, links), the pages, the limits and the sweeps. */
  readonly now?: () => number;
  /** How often the server finishes deletes while it runs: erases that were cut short, pending deletes now due, and a chat's deletes whose 24-hour hold has passed (HD1). Ten minutes by default. */
  readonly finishEveryMs?: number;
  /** `server.ts#HostedServerOptions.logForwardedFor` (the entry point's `LOG_FORWARDED_FOR=1`). */
  readonly logForwardedFor?: (raw: string) => void;
  /**
   * The upload watch (G3; `backup.ts#UploadWatch`), with a sidecar only: told
   * each look while uploads are stale, and once when they land again. Codes
   * and minutes only. A throw is swallowed.
   */
  readonly onUploads?: (e: UploadsEvent) => void;
  /** How often the upload watch looks (`backup.ts#UPLOADS_EVERY_MS` by default), and how long without a rise is `stale` (`UPLOADS_STALE_MS`). */
  readonly uploadsEveryMs?: number;
  readonly uploadsStaleMs?: number;
}

export interface StartOptions {
  /**
   * RESTORE_ON_BOOT: before the sidecar starts, every live store that was
   * opened before and has no database file here is restored from the bucket
   * with this runner (the control databases come back earlier, in the entry
   * point, before anything opens them: `restoreControl`).
   */
  readonly restore?: LitestreamRun;
  /**
   * NEW_BUCKET on a volume that ran with BACKUPS=off (R7;
   * `main.ts#prepareVolume`): `keys.sqlite` records `backups-turned-on` before
   * anything else at this start, and every store opened before it has R5's (f)
   * and (f2) waived, now and at every later start (`Backups#mintRefusal`).
   */
  readonly firstBackup?: boolean;
}

export interface StartReport {
  /** Stores restored now (RESTORE_ON_BOOT). */
  readonly restored: number;
  /** Stores whose restore failed now (RESTORE_ON_BOOT); they wait, the rest start. */
  readonly restoreFailed: number;
  /** Stores that lived and have no key anywhere, and that a new key could bury something of: left out of the backups. */
  readonly keyless: number;
  /** Stores that lived and served with no key anywhere, given one now (every condition of the mint held; R5). */
  readonly minted: number;
  /** Stores opened before whose files are missing, left waiting (no RESTORE_ON_BOOT, or a restore that found nothing). */
  readonly needsRestore: number;
  /** Registered OAuth clients never used, dropped. */
  readonly clientsSwept: number;
  /** Live stores the bucket's tombstone said were deleted: their deletes were finished. */
  readonly tombstoned: number;
  /** Deleted stores whose key object or replica was still in the bucket (a delete with backups off): removed. */
  readonly leftovers: number;
  /** Copies set aside by a restore or by hand (`control.aside-*`, `*.pre-restore-*`) older than a day: deleted. */
  readonly asideSwept: number;
  /** Keys in keys.sqlite still under HOSTED_KEKS, not the volume KEK (WB1): `migrate-keys` moves them. */
  readonly legacyKeys: number;
}

export interface App {
  readonly server: Server;
  readonly accounts: Accounts;
  readonly pages: Pages;
  readonly oauth: OAuth;
  readonly tenants: Tenants;
  readonly keys: KeyStore | null;
  readonly backups: Backups | null;
  /** Start-up work that may touch the network: finish any delete a crash cut short, then backups' `ensureAll`, then (RESTORE_ON_BOOT) restores, then the sidecar. */
  start(opts?: StartOptions): Promise<StartReport>;
  /** `/readyz`'s report. */
  readiness(): Promise<Readiness>;
  /** One look of the upload watch now (its timer does this every `uploadsEveryMs`); a no-op without a sidecar. */
  lookAtUploads(): Promise<void>;
  /** Delete one person's account and memory, at once, everywhere ("delete everything now"). Idempotent: running it again finishes a delete that failed part-way. */
  deleteAccount(personId: string): Promise<void>;
  /**
   * Delete, the default (R6): the account and store are LOCKED at once (every
   * session and connection stops, nothing opens the store), and erased by
   * `deleteAccount`'s sequence once `DELETE_GRACE_MS` has passed, unless kept.
   * Returns the deadline; null when the person wasn't active.
   */
  scheduleDelete(personId: string): Promise<number | null>;
  /** The undo: a pending delete, before its deadline, back to active (connections stay revoked). */
  keepAccount(personId: string): boolean;
  /** Finish every delete that is due: erases that began and didn't end, and pending deletes whose deadline passed (start-up, and a timer while serving). Returns how many finished. */
  finishPendingDeletes(): Promise<number>;
  /** Erase every chat's delete whose 24-hour hold has passed (HD1): the timer while serving, and tests. Returns how many were erased. */
  finishDueHolds(): Promise<number>;
  /** AR1: account events, and deleted accounts' tombstones, past `RETENTION_MS` erased (the timer once a day, and tests). */
  pruneRetention(): Promise<RetentionReport>;
  close(): Promise<void>;
}

/** What one retention pass did (AR1). Counts only. */
export interface RetentionReport {
  /** Audit rows older than `RETENTION_MS`, deleted. */
  readonly audit: number;
  /** Deleted accounts erased more than `RETENTION_MS` ago, forgotten: tombstone rows, audit rows and `deleted/<id>` markers. */
  readonly forgotten: number;
  /** Expired tombstones left for a later pass: uploads not proven landing yet, the bucket not clean or unreachable. Backups off: every one waits. */
  readonly waiting: number;
}

/** How often the timer runs the retention pass (AR1): once a day is plenty for a 365-day limit. */
export const RETENTION_EVERY_MS = 24 * 60 * 60 * 1000;

export function createApp(opts: AppOptions): App {
  if (!isAbsolute(opts.dataRoot)) throw new Error("the hosted data root must be an absolute path");
  const refused = livePathRefusal(opts.dataRoot, "the hosted data root");
  if (refused !== null) throw new Error(refused);
  const publicOrigin = opts.publicOrigin.replace(/\/+$/, "");
  const accounts = new Accounts({ path: join(opts.dataRoot, "control", "accounts.sqlite"), ...(opts.now === undefined ? {} : { now: opts.now }) });
  const keys = opts.backup === undefined ? null : new KeyStore({ path: join(opts.dataRoot, "keys", "keys.sqlite"), wrapper: opts.backup.wrapper });
  const backups =
    opts.backup === undefined || keys === null
      ? null
      : new Backups({
          dataRoot: opts.dataRoot,
          keys,
          objects: opts.backup.objects,
          sealer: opts.backup.sealer,
          bucket: opts.backup.bucket,
          endpoint: opts.backup.endpoint,
          sidecar: opts.backup.sidecar ?? null,
          liveStores: () => accounts.liveStoreIds(),
          openedBefore: (storeId) => accounts.wasOpened(storeId),
          locked: (storeId) => accounts.storeLocked(storeId),
          openedAt: (storeId) => accounts.openedAt(storeId),
          // Audited, and logged by tag (never the id): what start-up did with a store that had no key anywhere.
          onKeyless: (storeId, outcome) => {
            accounts.audit(accounts.personOfStore(storeId), storeId, outcome === "minted" ? "backup.key.minted" : "backup.keyless", outcome === "minted" ? null : outcome);
            try {
              opts.onEvent?.(outcome === "minted" ? "backup.key.minted" : `backup.keyless.${outcome}`, storeTag(storeId));
            } catch {
              /* a log, not a gate */
            }
          },
        });
  // Pages and OAuth need each other (the account page lists connections; the
  // Allow page needs the signed-in person), and pages need the delete that
  // needs OAuth and the tenants. Bound late, through these holders.
  let oauth: OAuth | null = null;
  let tenantsRef: Tenants | null = null;
  let deleteRef: ((personId: string) => Promise<void>) | null = null;
  let scheduleRef: ((personId: string) => Promise<number | null>) | null = null;
  let keepRef: ((personId: string) => boolean) | null = null;

  // Export's plaintext copy is made on the data volume (swept at start-up after
  // a crash), never in the container's /tmp.
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
    // The forms' key from the current cookie key, so a restart keeps them (H1); none named: random per process.
    csrf: opts.cookieKeys?.[0] === undefined ? new Csrf() : new Csrf(csrfKey(opts.cookieKeys[0])),
    ...(opts.trustProxy === undefined ? {} : { trustProxy: opts.trustProxy }),
    connections: {
      list: (personId: string): Promise<ConnectionView[]> => oauth?.connections.list(personId) ?? Promise.resolve([]),
      disconnect: (personId: string, id: string): Promise<void> => oauth?.connections.disconnect(personId, id) ?? Promise.resolve(),
    },
    ...(backups === null ? {} : { onSignup: (_personId: string, storeId: string) => backups.ensureStore(storeId) }),
    exportStore,
    deleteAccount: (personId: string) => (deleteRef === null ? Promise.reject(new Error("not ready")) : deleteRef(personId)),
    scheduleDelete: (personId: string) => (scheduleRef === null ? Promise.reject(new Error("not ready")) : scheduleRef(personId)),
    keepAccount: (personId: string) => (keepRef === null ? false : keepRef(personId)),
    // The operator's log line for a delete's email that didn't send (R9): the store's tag, never the address.
    onDeleteMailFailed: (storeId: string | null) => opts.onEvent?.("delete.mail.failed", storeId === null ? "none" : storeTag(storeId)),
    ...(opts.now === undefined ? {} : { now: opts.now }),
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
    // A store that lived and lost its files waits for a restore rather than
    // starting over (and being replicated over its own backup).
    openedBefore: (storeId) => accounts.wasOpened(storeId),
    // A store whose account is set to be deleted is kept and never opened (R6).
    locked: (storeId) => accounts.storeLocked(storeId),
    // A chat's delete (HD1): when its erase falls due, for the timer below.
    onRemovalHeld: (storeId, at) => {
      accounts.noteRemovalDue(storeId, at);
      accounts.audit(accounts.personOfStore(storeId), storeId, "removal.held", null);
    },
    onCreated: (storeId) => {
      // A store's dir made while the server runs is a sign-up's (already in the
      // sidecar's configuration) or a store started over (`main.ts start-over`,
      // left out while it waited): that one gets its key and a place in the
      // configuration now, or nothing replicates it until some other reload
      // (the #653 re-review, N1). Marked after, so a store with no key anywhere
      // gets a new one: it starts over as new.
      if (backups === null || backups.inConfig(storeId)) {
        accounts.markOpened(storeId);
        return;
      }
      void backups
        .ensureStore(storeId)
        .catch(() => {
          accounts.audit(accounts.personOfStore(storeId), storeId, "backup.ensure.failed", null);
          // An operator reading the logs sees it too (R3): the event and the tag, never the id, an address or the error.
          try {
            opts.onEvent?.("backup.ensure.failed", storeTag(storeId));
          } catch {
            /* a log, not a gate */
          }
        })
        .finally(() => accounts.markOpened(storeId));
    },
  });
  tenantsRef = tenants;
  tenants.startSweeping();
  const o = oauth;

  /**
   * DELETE, THE DEFAULT: LOCKED AT ONCE, ERASED IN 24 HOURS (R6, Mike
   * 2026-10-27; it replaces 10-26's "at once, everywhere" as the default, which
   * stays as "delete everything now"). In order:
   *   1. the person and store turn `pending-delete` with a durable deadline,
   *      and every web session ends (one transaction);
   *   2. every grant is revoked, so every connection stops on its next call;
   *   3. the store's handle drains and closes and its worker is dropped. It
   *      isn't retired: the lock is the accounts row (`Tenants.locked`), so it
   *      holds across a restart and lifts with a keep.
   * The files, the key and the backups are untouched (the sidecar keeps the
   * store in its configuration), so a keep loses nothing. The erase is the
   * sequence below, begun by `finishPendingDeletes` once the deadline passes.
   */
  const scheduleDelete = async (personId: string): Promise<number | null> => {
    const deadline = accounts.markPendingDelete(personId);
    if (deadline === null) return null;
    // From here the delete has taken effect (durably). What follows can fail or
    // be cut short by a crash; each failure is audited, the person still gets
    // the done page, and `lockPending` (every tick, and a keep) heals it (#659 review).
    lockPending(personId, true);
    return deadline;
  };
  scheduleRef = scheduleDelete;

  /**
   * A pending delete's lock, made whole: every grant revoked, the store's handle
   * closed and its worker dropped. Idempotent and cheap; run at the delete,
   * before a keep, and for every pending person on each finish tick, so a revoke
   * that failed (or a process that died between the commit and the revoke)
   * never leaves a pending person's connections alive. The close isn't awaited:
   * a call holding the store while a slow body arrives is refused when it lands
   * (the door's gate and the queue's check), and the delete page doesn't wait for it.
   */
  const lockPending = (personId: string, closeAll = false): void => {
    try {
      o.revokeAll(personId);
    } catch {
      accounts.audit(personId, null, "delete.lock.revoke.failed", null);
    }
    for (const storeId of accounts.storesToDelete(personId)) {
      if (!closeAll && !tenants.isOpen(storeId)) continue; // the delete itself always closes (it drops the worker too)
      void tenants.close(storeId).catch(() => accounts.audit(personId, storeId, "delete.lock.close.failed", null));
    }
  };

  /**
   * Keep: the grants are revoked FIRST (again: a revoke that failed at the delete
   * must not come back to life with the account), then the account is kept. A
   * revoke that throws keeps nothing (the page says try again).
   */
  const keepAccount = (personId: string): boolean => {
    if (accounts.person(personId)?.state !== "pending-delete") return false;
    o.revokeAll(personId);
    return accounts.keep(personId);
  };
  keepRef = keepAccount;

  /**
   * DELETE EVERYTHING NOW, AND THE ERASE AT A DEADLINE (design §5.4). In order,
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
    // Pending deletes whose deadline has passed begin their erase here: `due`
    // turns them `deleting` only if the deadline is still passed and nobody
    // kept the account, in one statement. A deadline still ahead is left alone,
    // whatever restarted or failed meanwhile: never early.
    for (const personId of accounts.dueDeletes()) accounts.markDeleting(personId, { due: true });
    // Every delete still pending: its lock made whole again (a revoke that failed, a crash between the two writes).
    for (const personId of accounts.pendingDeletePeople()) lockPending(personId);
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
  /**
   * A CHAT'S DELETES, ERASED AFTER THEIR HOLD (HD1, 2026-11-04). `remember`'s
   * `remove` only hides a memory (a `held` row); this erases each one whose
   * 24 hours have passed, with the console's own removal, in the store's
   * serial queue — the same door export takes. Only stores the control
   * database says have one due (`stores.removal_due_at`, set at the hold),
   * so an idle store is opened only when it must be: a worker-only sweep
   * would wait for a wake that a quiet person never brings. A locked store
   * (a pending account delete) is left: the account erase takes everything,
   * holds included, and a keep brings the deadline back to this timer.
   * Audited by counts, never an id of a memory. Returns how many were erased.
   */
  /**
   * Holds already said to be overdue, by store and memory, so the log line
   * comes once per hold, not every tick (ROADMAP 11:55). In memory: a restart
   * says each still-overdue one once more. Never logged itself.
   */
  const overdueSaid = new Set<string>();
  const finishDueHolds = async (): Promise<number> => {
    let erased = 0;
    for (const storeId of accounts.removalsDue()) {
      const personId = accounts.personOfStore(storeId);
      // A store waiting for a restore can't open; it is left due, unaudited, until it is back.
      if (accounts.wasOpened(storeId) && !existsSync(join(tenantDir(tenants.root, storeId), "store", DATABASE_FILE))) continue;
      try {
        const report = await tenants.withTenant(storeId, {}, (t, server) =>
          t.serial(async () => {
            const now = (opts.now ?? Date.now)();
            const swept = sweepHeldRemovals(server.counterpart.store, { now });
            // A HOLD WHOSE ERASE KEEPS FAILING IS SEEN (ROADMAP 11:55): once
            // it is 48 h past its erase time, or claimed by an erase that
            // didn't finish (`overdueHolds`, R1-a), one codes-only log line
            // per hold — the store's tag and the event, never the memory.
            for (const h of overdueHolds(server.counterpart.store, now)) {
              const key = `${storeId}\u0000${h.id}`;
              if (overdueSaid.has(key)) continue;
              overdueSaid.add(key);
              opts.onEvent?.("removal.overdue", storeTag(storeId));
            }
            // INSIDE the store's queue, beside the sweep: a hold written by a
            // call queued behind it sets its own due time after this, never
            // before it — so this can't wipe a new hold's time and leave it
            // waiting for a wake.
            accounts.setRemovalDue(storeId, swept.nextAt);
            return swept;
          }),
        );
        erased += report.erased.length;
        if (report.erased.length > 0) {
          const unchased = report.erased.reduce((n, e) => n + e.unchased, 0);
          accounts.audit(personId, storeId, "removal.erased", `${String(report.erased.length)} erased, ${String(unchased)} surfaces unchased`);
        }
        // A failed erase keeps its claim and is tried again after a backoff
        // (an hour, doubling, at most a day: `claimRetryAfter`), so this store
        // isn't reopened every tick; audited at its FIRST failure only (R8).
        const firsts = report.failed.filter((f) => f.attempt === 1);
        // Codes only (G1 L6): `why` is already a short constant (`failureCode`),
        // and anything else is written as "error", never its words.
        if (firsts.length > 0) accounts.audit(personId, storeId, "removal.failed", `${String(firsts.length)} failed: ${firsts.map((f) => (/^[A-Za-z0-9_.-]{1,40}$/.test(f.why) ? f.why : "error")).join(", ")}`);
      } catch {
        // Locked meanwhile, waiting for a restore, or a store that would not
        // open: left due, so the next tick tries again.
        accounts.audit(personId, storeId, "removal.sweep.failed", null);
      }
    }
    return erased;
  };
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let uploadsTimer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  // Uploads landing, not only the sidecar running (G3; INTERFACE-GAPS §7).
  const uploads =
    opts.backup?.sidecar === undefined || opts.backup.sidecar === null
      ? null
      : new UploadWatch({
          objects: opts.backup.objects,
          heartbeat: () => accounts.heartbeat(),
          ...(backups === null ? {} : { prefix: () => backups.controlPrefix("accounts.sqlite") }),
          now: opts.now ?? Date.now,
          ...(opts.uploadsStaleMs === undefined ? {} : { staleAfterMs: opts.uploadsStaleMs }),
          ...(opts.onUploads === undefined ? {} : { onEvent: opts.onUploads }),
        });
  /**
   * AR1 (Mike, 2026-11-10): THE 12-MONTH LIMIT. Audit rows older than
   * `RETENTION_MS` go, live accounts' and deleted ones' alike. A deleted
   * account erased more than `RETENTION_MS` ago is forgotten: its stores'
   * `deleted/<id>` markers in the bucket first, then its audit rows and its
   * tombstone rows in one transaction (a marker that fails to go leaves the
   * rows that name it, for the next pass). Only when the marker is no longer
   * needed (CONTRACT §31c):
   *   - uploads are proven landing (`UploadWatch#rose`): the bucket's accounts
   *     database is then this one, with the delete in it, so no restore can
   *     bring the account back;
   *   - the bucket holds nothing of the store (a leftover is erased first, with
   *     the delete's own `removeStore`, and checked again).
   * Backups off: no bucket to prove anything against, so tombstones wait.
   */
  let pruning: Promise<RetentionReport> | null = null;
  const runRetention = async (): Promise<RetentionReport> => {
    const audit = accounts.pruneAudit();
    let forgotten = 0;
    let waiting = 0;
    for (const t of accounts.expiredTombstones()) {
      if (backups === null || opts.backup === undefined || uploads === null || !uploads.rose()) {
        waiting += 1;
        continue;
      }
      try {
        for (const id of t.storeIds) {
          if ((await backups.objectsLeft(id)) > 0) await backups.removeStore(id);
          if ((await backups.objectsLeft(id)) > 0) throw new Error("the bucket still holds some of it");
          await opts.backup.objects.delete(tombstoneObject(id));
        }
        if (accounts.forget(t.personId)) forgotten += 1;
        else waiting += 1;
      } catch {
        // R2 down, or a leftover that wouldn't go: tried again at the next pass. No audit row: it would name the person again.
        waiting += 1;
      }
    }
    return { audit, forgotten, waiting };
  };
  const pruneRetention = (): Promise<RetentionReport> => {
    pruning ??= runRetention().finally(() => {
      pruning = null;
    });
    return pruning;
  };
  let retentionAt: number | null = null;
  /** The timer's daily pass. One with tombstones waiting is tried again at the next tick. */
  const retentionTick = (): void => {
    const now = (opts.now ?? Date.now)();
    if (pruning !== null || (retentionAt !== null && now - retentionAt < RETENTION_EVERY_MS)) return;
    retentionAt = now;
    void pruneRetention().then(
      (r) => {
        if (r.waiting > 0 && backups !== null) retentionAt = null;
      },
      () => {
        retentionAt = null;
      },
    );
  };
  const limits = new McpLimits({
    ...opts.mcpLimits,
    sizeOf: (storeId) => dirBytes(tenantDir(tenants.root, storeId)),
    quotaOf: (storeId) => accounts.quotaOf(storeId),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });

  const readiness = async (): Promise<Readiness> => {
    const checks: Record<string, string> = { started: started ? "ok" : "starting" };
    try {
      accounts.ping();
      o.store.ping();
      checks["control"] = "ok";
    } catch {
      checks["control"] = "down";
    }
    if (keys === null) checks["keys"] = "off";
    else {
      try {
        keys.storeIds();
        // The ring opened every key at start-up (`ensureAll` refuses otherwise), so started ⇒ loaded.
        checks["keys"] = started ? "ok" : "starting";
      } catch {
        checks["keys"] = "down";
      }
    }
    const sidecar = opts.backup?.sidecar ?? null;
    // "stale": the sidecar runs, and no upload has been seen landing in R2 for `uploadsStaleMs` (`UploadWatch`; cached, no R2 call here).
    checks["backups"] = sidecar === null ? "off" : sidecar.up?.() === false ? "down" : uploads?.state() === "stale" ? "stale" : "ok";
    return { ready: Object.values(checks).every((v) => v === "ok" || v === "off"), checks };
  };

  const server = createHostedServer({
    tenants,
    publicOrigin,
    authenticate: o.authenticate,
    // THE DASHBOARD (HD2): the local dashboard's page and views, read-only, for the signed-in owner.
    routes: [o.route, pages.route, dashboardRoute({ pages, accounts, tenants, onError: (storeId, err) => opts.onError?.("route", storeId === null ? null : storeTag(storeId), err) })],
    limits,
    readiness,
    ...(opts.allowedOrigins === undefined ? {} : { allowedOrigins: opts.allowedOrigins }),
    ...(opts.onCall === undefined ? {} : { onCall: opts.onCall }),
    // The day of each person's last wake (LW1): a read, and a write once a day at most.
    onWake: (personId) => void accounts.noteWake(personId),
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
    ...(opts.onEvent === undefined ? {} : { onEvent: opts.onEvent }),
    ...(opts.logForwardedFor === undefined ? {} : { logForwardedFor: opts.logForwardedFor }),
  });
  return {
    server,
    accounts,
    pages,
    oauth: o,
    tenants,
    keys,
    backups,
    async start(startOpts: StartOptions = {}): Promise<StartReport> {
      rmSync(scratchRoot, { recursive: true, force: true });
      const asideSwept = sweepAside(opts.dataRoot, tenants.root, (opts.now ?? Date.now)());
      // No sidecar until the restores are done (`Backups.hold`; the #653 review, L2).
      backups?.hold();
      // Every live store whose database is here has lived: mark it (a database
      // from before `opened_at`, or a mark whose write failed, heals here).
      // BEFORE the turn-on fact below (the #661 re-check, P7): a store marked
      // after it would never count as opened before backups were turned on.
      // Local, the accounts database only.
      const dbOf = (id: string): string => join(tenantDir(tenants.root, id), "store", DATABASE_FILE);
      for (const id of accounts.liveStoreIds()) if (existsSync(dbOf(id))) accounts.markOpened(id);
      // Turning backups on (R7): recorded before anything is made or put, so a
      // start cut short anywhere after it is still known as one.
      if (startOpts.firstBackup === true) keys?.recordFact("backups-turned-on");
      let tombstoned = 0;
      let leftovers = 0;
      if (backups !== null) {
        // A store the bucket says was deleted is deleted, whatever a restored
        // accounts database says (the #653 review, M1): its delete is finished.
        for (const id of await backups.tombstoned()) {
          const personId = accounts.personOfStore(id);
          if (personId === null) continue;
          accounts.markDeleting(personId);
          accounts.audit(personId, id, "delete.tombstone", null);
          tombstoned += 1;
        }
      }
      // Deletes first: a half-deleted store must be gone before backups look for live ones.
      await finishPendingDeletes();
      if (backups !== null) {
        // A delete that ran with backups off left its key object and replica in
        // the bucket (the #653 review, M2): removed now.
        // Only deletes that never cleaned the bucket (no `delete.backups`, no
        // earlier leftovers pass): the check doesn't grow with every delete (N4).
        // One that fails is audited and left for the next start, never a crash
        // loop for everyone (N2).
        for (const id of accounts.deletedStoreIds()) {
          if (accounts.storeAudited(id, ["delete.backups", "delete.leftovers"])) continue;
          try {
            if ((await backups.objectsLeft(id)) > 0) {
              await backups.removeStore(id);
              leftovers += 1;
            }
            accounts.audit(accounts.personOfStore(id), id, "delete.leftovers", null);
          } catch {
            accounts.audit(accounts.personOfStore(id), id, "delete.leftovers.failed", null);
          }
        }
      }
      let restored = 0;
      let restoreFailed = 0;
      let keyless = 0;
      let minted = 0;
      if (backups !== null) {
        // Keys first (this volume's, or brought back by recover-keys; minted for a store
        // that served with none, when nothing can be buried), then restores
        // while no sidecar runs, then the sidecar on the whole configuration.
        ({ keyless, minted } = await backups.ensureAll({ reload: false }));
        if (startOpts.restore !== undefined) {
          // Every missing live store, marked or not: `-if-replica-exists` makes a
          // store with no replica a no-op. One that fails is counted and left
          // waiting; it never stops the others' start.
          for (const id of backups.missingStores()) {
            try {
              const r = await backups.restore(id, startOpts.restore);
              accounts.audit(null, id, "store.restored", String(r.restored));
              if (r.restored > 0) {
                accounts.markOpened(id);
                // The cache rebuild (a re-embed of every row) runs now, before
                // the server listens, not on some person's first call. Not for a
                // store locked by a pending delete: nothing opens it, and its
                // marker rebuilds the cache at its first open after a keep.
                if (!accounts.storeLocked(id)) await tenants.withTenant(id, {}, async () => undefined);
              }
              restored += r.restored;
            } catch {
              accounts.audit(null, id, "store.restore.failed", null);
              restoreFailed += 1;
            }
          }
        }
        await backups.release();
      }
      // The sidecar runs from here: the upload watch's grace starts now. Its first look (the baseline) isn't
      // awaited: a slow R2 must not add to the boot, and the grace clock doesn't need the baseline.
      if (uploads !== null) {
        uploads.begin();
        void uploads.look();
        if (uploadsTimer === null) {
          uploadsTimer = setInterval(() => void uploads.look(), opts.uploadsEveryMs ?? UPLOADS_EVERY_MS);
          uploadsTimer.unref?.();
        }
      }
      const needsRestore = accounts.liveStoreIds().filter((id) => accounts.wasOpened(id) && !existsSync(dbOf(id))).length;
      const clientsSwept = o.store.sweepClients();
      if (retryTimer === null) {
        retryTimer = setInterval(() => {
          void finishPendingDeletes();
          void finishDueHolds();
          retentionTick();
          try {
            o.store.sweepClients();
          } catch {
            /* the next tick */
          }
        }, opts.finishEveryMs ?? 10 * 60 * 1000);
        retryTimer.unref?.();
      }
      started = true;
      const legacyKeys = keys?.notOnCurrent() ?? 0;
      return { restored, restoreFailed, keyless, minted, needsRestore, clientsSwept, tombstoned, leftovers, asideSwept, legacyKeys };
    },
    readiness,
    lookAtUploads: async () => {
      await uploads?.look();
    },
    deleteAccount,
    scheduleDelete,
    keepAccount,
    finishPendingDeletes,
    finishDueHolds,
    pruneRetention,
    async close(): Promise<void> {
      started = false;
      uploads?.stop();
      if (retryTimer !== null) clearInterval(retryTimer);
      retryTimer = null;
      await pruning?.catch(() => undefined);
      if (uploadsTimer !== null) clearInterval(uploadsTimer);
      uploadsTimer = null;
      await tenants.closeAll();
      await opts.backup?.sidecar?.stop();
      o.close();
      keys?.close();
      accounts.close();
    },
  };
}

/** What decides whether this volume's control databases are the bucket's (`controlVolume`). */
export interface ControlVolume {
  /** The bucket has the control key object (`keys/control.sealed`, or `.wrapped` from before WB1): something has backed up control databases there. */
  readonly bucketKey: boolean;
  /** This volume's `keys.sqlite` holds the control key: it is the volume that wrote them. */
  readonly localKey: boolean;
  /** The control databases present here. */
  readonly present: readonly string[];
}

export async function controlVolume(dataRoot: string, backup: AppBackupOptions): Promise<ControlVolume> {
  const bucketKey = (await backup.objects.get(keyObject(CONTROL_KEY_ID))) !== null || (await backup.objects.get(legacyKeyObject(CONTROL_KEY_ID))) !== null;
  const keysPath = join(dataRoot, "keys", "keys.sqlite");
  let localKey = false;
  if (existsSync(keysPath)) {
    const keys = new KeyStore({ path: keysPath, wrapper: backup.wrapper });
    localKey = keys.wrapped(CONTROL_KEY_ID) !== null;
    keys.close();
  }
  return { bucketKey, localKey, present: CONTROL_DATABASES.filter((db) => existsSync(join(dataRoot, "control", db))) };
}

/** The refusal for a volume with control databases that aren't the bucket's, or null. */
export function foreignControlRefusal(dataRoot: string, v: ControlVolume): string | null {
  if (!v.bucketKey || v.localKey || v.present.length === 0) return null;
  return `refused: this volume has ${v.present.join(" and ")} but not the key that wrote the bucket's backups, so they aren't the bucket's. With the server stopped, run recover-keys --control-aside <new label> with the recovery private key (it moves control/ aside first), then deploy once with RESTORE_ON_BOOT=1 (docs/hosted/RUNBOOK.md, If a start refuses).`;
}

/**
 * THE CONTROL DATABASES, BACK FROM THE BUCKET (OL2b), before anything opens
 * them: `accounts.sqlite` and `oauth.sqlite`, under the `control` key, which
 * this volume holds (since WB1 `recover-keys` brings it back from its sealed copy
 * after a volume is lost; a `.wrapped` one from before WB1 is still adopted while
 * HOSTED_KEKS opens it). The entry point runs it for `restore control`,
 * `restore --all`, and at a RESTORE_ON_BOOT start.
 *
 * THE KEY IS ADOPTED ONLY WHEN NO CONTROL FILE HERE IS KEPT (the #653 review,
 * H1). A volume without the control key that holds a control database (made
 * by an `invite` on a lost volume) is refused, unless `force` replaces every
 * file: keeping that file and adopting the key would make it "the bucket's",
 * and the next serve would replicate it over the real one.
 */
export async function restoreControl(dataRoot: string, backup: AppBackupOptions, run: LitestreamRun, opts: { force?: boolean; missingOnly?: boolean } = {}): Promise<{ restored: number; empty: number; kept: number }> {
  if (opts.force !== true) {
    const refusal = foreignControlRefusal(dataRoot, await controlVolume(dataRoot, backup));
    if (refusal !== null) throw new Error(refusal.replace(/^refused: /, ""));
  }
  const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: backup.wrapper });
  try {
    const b = new Backups({ dataRoot, keys, objects: backup.objects, sealer: backup.sealer, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => [] });
    return await b.restore(CONTROL_KEY_ID, run, opts);
  } finally {
    keys.close();
  }
}

/** How long a copy set aside by a restore is kept: past the "purged within 24 hours" promise it would break. */
export const ASIDE_KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * COPIES SET ASIDE, SWEPT AFTER A DAY (the #653 re-review, N5): `control.aside-*`
 * (the RUNBOOK's override moves `control/` there) and every `*.pre-restore-*`
 * (`--force` moves a file there). They hold addresses and memories outside the
 * 24 h purge, so they go a day after they were set aside: by the time in the
 * name for a `pre-restore` copy, by the change time (a rename sets it) for an
 * `aside` dir. Returns how many went. `overrides/` (CONTROL_ASIDE's used
 * labels, `main.ts#controlAside`) is never listed: a guard swept with its copy
 * would re-arm a forgotten override (R3).
 */
export function sweepAside(dataRoot: string, tenantsRoot: string, now: number): number {
  let swept = 0;
  const gone = (path: string, at: number): void => {
    if (!Number.isFinite(at) || now - at < ASIDE_KEEP_MS) return;
    rmSync(path, { recursive: true, force: true });
    swept += 1;
  };
  const stampOf = (name: string): number => {
    const m = /\.pre-restore-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
    return m === null ? Number.NaN : Date.parse(`${m[1]!}T${m[2]!}:${m[3]!}:${m[4]!}.${m[5]!}Z`);
  };
  const list = (dir: string): string[] => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  for (const name of list(dataRoot)) {
    if (!name.startsWith("control.aside")) continue;
    try {
      gone(join(dataRoot, name), statSync(join(dataRoot, name)).ctimeMs);
    } catch {
      /* gone already */
    }
  }
  const dirs = [join(dataRoot, "control"), ...list(tenantsRoot).map((id) => join(tenantsRoot, id, "store"))];
  for (const dir of dirs) for (const name of list(dir)) if (name.includes(".pre-restore-")) gone(join(dir, name), stampOf(name));
  return swept;
}
