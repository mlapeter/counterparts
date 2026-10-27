/**
 * MANY STORES IN ONE PROCESS (OL2 step 2; design: docs/hosted/DESIGN.md §2).
 *
 * A tenant is one person's store: `<root>/<storeId>/store/`, a normal
 * Counterparts store dir, with the tenant's own files beside it (never inside
 * it — the store's layout check refuses names it did not classify):
 *
 *   <root>/<storeId>/store/        the store
 *   <root>/<storeId>/config.json   synthesized here, 0600; the worker child reads it
 *   <root>/<storeId>/scopes.json   the scope registry the server writes beside its config
 *
 * THE RULES THIS FILE KEEPS:
 *
 *   - **A store id is 128 random bits, as 32 lowercase hex characters**, and
 *     nothing else is ever turned into a path. The id comes from the accounts
 *     table, never from a request; it is still checked here, shape and
 *     containment both (`isWithin`), on every open.
 *   - **One `McpServer` per store, never shared, never reused for another.**
 *     Each has its own queue (`serialQueue`), so one store's calls run one at a
 *     time and different stores' calls run side by side.
 *   - **An LRU of open handles**, with an idle timeout. A handle in use (a call
 *     inside `withTenant`) is never closed; eviction waits for its queue to
 *     drain. A request arriving while its store is closing waits for the close
 *     and reopens it.
 *   - **One embedder for the process** (the static table is ~30 MB), passed to
 *     every store.
 *   - **The worker child gets an allow-listed environment.** `spawn.ts#planSpawn`
 *     starts from the parent's whole environment — on the hosted server that
 *     would hand every child the server's secrets — so the pool here passes on
 *     only `PATH`, the locale and time zone, and the `COUNTERPARTS_*` values the
 *     plan pinned (the data dir, watchdog, session, scope, configuration).
 *   - **At most one worker per store at a time, at most `maxWorkers` in all.** A
 *     boundary that arrives while its store's worker runs is coalesced into one
 *     more run after it, never a second concurrent one.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CLAUDE_AI_HOST } from "../../src/adapters/hosts.js";
import { openServer } from "../../src/adapters/mcp/index.js";
import type { McpServer } from "../../src/adapters/mcp/index.js";
import { serialQueue } from "../../src/adapters/remote/http.js";
import type { McpTarget, Serial } from "../../src/adapters/remote/http.js";
import { scopesPath } from "../../src/adapters/scopes.js";
import { CONFIG_ENV, DATA_DIR_ENV, SCOPE_ENV, SESSION_ENV, WATCHDOG_ENV, WORKER_RUNNER_PATH } from "../../src/adapters/spawn.js";
import type { SpawnPlan, Spawner } from "../../src/adapters/spawn.js";
import { scriptArgs } from "../../src/adapters/runtime.js";
import type { AdapterConfig } from "../../src/adapters/config.js";
import { DATABASE_FILE, isWithin } from "../../src/core/store/paths.js";
import { beginNewInstall } from "../../src/core/onboarding.js";
import { STATIC_WEIGHTS_ENV } from "../../src/core/embed/static.js";

/** 128 bits as lowercase hex: the only shape a store id may have. */
export const STORE_ID = /^[0-9a-f]{32}$/;

export const DEFAULT_MAX_OPEN = 64;
export const DEFAULT_IDLE_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_WORKERS = 2;

/** What the embedder seam needs; `null` runs the stores without vectors (tests). */
export type SharedEmbedder = NonNullable<Parameters<typeof openServer>[0]>["embedder"];

export interface TenantOptions {
  /** IANA zone the person's day turns over in (`people.time_zone`). */
  readonly timeZone?: string;
}

export interface TenantsOptions {
  /** `HOSTED_DATA_ROOT/tenants`. Must already be an absolute, named directory. */
  readonly root: string;
  readonly embedder?: SharedEmbedder;
  readonly maxOpen?: number;
  readonly idleMs?: number;
  /** The worker pool; `workerPool()` when absent. Tests pass a stub. */
  readonly spawner?: Spawner;
  /** What starts the worker child; this runtime and `runner.ts` by default. */
  readonly worker?: { readonly command: string; readonly args: readonly string[] };
  readonly now?: () => number;
  /** Told when a handle opens or closes. Ids only. A throw is swallowed. */
  readonly onEvent?: (name: "tenant.open" | "tenant.close", storeId: string) => void;
  /**
   * Has this store been opened before, anywhere (accounts' `stores.opened_at`,
   * which is in the replicated control database)? A store that has, and whose
   * dir is missing, is refused (`StoreNeedsRestore`) instead of starting over
   * as a new install. Absent ⇒ never (tests of the earlier steps).
   */
  readonly openedBefore?: (storeId: string) => boolean;
  /** Told at every open that CREATED the store's dir (its first life). */
  readonly onCreated?: (storeId: string) => void;
  /**
   * Is this store locked (R6: its account's delete is pending, or erasing)?
   * Asked on every acquire, from the accounts database, so the lock holds
   * across a restart and lifts with a keep, with no call to make here. A
   * locked store is never opened (`StoreLocked`). Absent ⇒ never.
   */
  readonly locked?: (storeId: string) => boolean;
}

/** A store whose account is set to be deleted: kept as it was, and never opened (`TenantsOptions.locked`). */
export class StoreLocked extends Error {
  constructor() {
    super("this store is locked: its account is set to be deleted");
    this.name = "StoreLocked";
  }
}

/** Beside a store just restored (`backup.ts#restore`): its next open rebuilds the cache, which no backup holds. */
export const RESTORED_MARKER = "restored.marker";

/**
 * A store that was opened before and whose files are gone from this volume.
 * Opening it as new would make an empty store, which the sidecar would then
 * replicate over the store's own backup: the thing that could bring it back.
 * So it waits for a restore (`main.ts restore`, or `RESTORE_ON_BOOT=1`).
 */
export class StoreNeedsRestore extends Error {
  constructor() {
    super("this store's files are missing from the volume; it needs a restore");
    this.name = "StoreNeedsRestore";
  }
}

interface Handle {
  readonly storeId: string;
  readonly server: McpServer;
  readonly serial: Serial;
  refs: number;
  lastUsed: number;
  closing: Promise<void> | null;
  /** Told once when `refs` falls to 0: what `close()` waits on (a promise, never a poll). */
  idle: (() => void)[];
}

/** A store's tag for an operator's terminal and logs: the first 16 hex of its SHA-256, never the id itself. */
export function storeTag(storeId: string): string {
  return createHash("sha256").update(storeId).digest("hex").slice(0, 16);
}

/** The tenant dir, after both checks. Throws on anything else. */
export function tenantDir(root: string, storeId: string): string {
  if (!STORE_ID.test(storeId)) throw new Error("not a store id");
  const absRoot = resolve(root);
  const dir = join(absRoot, storeId);
  if (!isWithin(absRoot, dir) || dir === absRoot) throw new Error("store id escapes the tenants root");
  return dir;
}

export class Tenants {
  readonly root: string;
  private readonly open = new Map<string, Handle>();
  /** Stores deleted in this process: never opened again (`retire`). */
  private readonly retired = new Set<string>();
  private readonly opts: TenantsOptions;
  private readonly spawner: Spawner;
  private readonly now: () => number;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(opts: TenantsOptions) {
    this.root = resolve(opts.root);
    this.opts = opts;
    this.spawner = opts.spawner ?? workerPool({ max: DEFAULT_MAX_WORKERS });
    this.now = opts.now ?? ((): number => Date.now());
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  /** How many stores are open now. */
  get size(): number {
    return this.open.size;
  }

  /** Is this store's handle open (and not closing)? */
  isOpen(storeId: string): boolean {
    const h = this.open.get(storeId);
    return h !== undefined && h.closing === null;
  }

  /**
   * Run `fn` with the store's target (server + its queue). The handle cannot
   * be evicted while `fn` runs; it is opened first if it is not open.
   */
  async withTenant<T>(storeId: string, tenant: TenantOptions, fn: (target: McpTarget, server: McpServer) => Promise<T>): Promise<T> {
    const h = await this.acquire(storeId, tenant);
    try {
      return await fn({ server: h.server, serial: h.serial }, h.server);
    } finally {
      h.refs -= 1;
      h.lastUsed = this.now();
      if (h.refs === 0) for (const wake of h.idle.splice(0)) wake();
    }
  }

  /** Close every store idle longer than `idleMs`. Returns how many closed. */
  async sweepIdle(): Promise<number> {
    const idle = this.opts.idleMs ?? DEFAULT_IDLE_MS;
    const cutoff = this.now() - idle;
    const due = [...this.open.values()].filter((h) => h.refs === 0 && h.closing === null && h.lastUsed <= cutoff);
    await Promise.all(due.map((h) => this.evict(h)));
    return due.length;
  }

  /** Sweep on a timer (unref'd). */
  startSweeping(everyMs = 60_000): void {
    if (this.sweeper !== null) return;
    this.sweeper = setInterval(() => void this.sweepIdle(), everyMs);
    this.sweeper.unref?.();
  }

  /**
   * Account delete: this store never opens again in this process. A call that
   * was authenticated just before its grants were revoked would otherwise
   * re-open it — and re-create an empty tenant dir after the delete removed it.
   */
  retire(storeId: string): void {
    this.retired.add(storeId);
  }

  /**
   * Close one store now, for account delete: waits for its calls, closes the
   * handle, and drops its worker (an owed run is forgotten and a running child
   * is stopped), so nothing reopens the store after its directory is removed.
   */
  async close(storeId: string): Promise<void> {
    await this.release(storeId);
    const pool = this.spawner as Partial<WorkerPool>;
    if (typeof pool.drop === "function" && STORE_ID.test(storeId)) await pool.drop(join(tenantDir(this.root, storeId), "store"));
  }

  /** Close everything (shutdown). Workers already running are left to finish. */
  async closeAll(): Promise<void> {
    if (this.sweeper !== null) clearInterval(this.sweeper);
    this.sweeper = null;
    await Promise.all([...this.open.keys()].map((id) => this.release(id)));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Wait until no call holds the store, then close it. The wait is on the
   * handle's `idle` promise, NEVER a loop over its queue: a call holds its ref
   * while its body is still arriving and until its answer has flushed, both of
   * which need the event loop, and a loop of already-settled promises never
   * yields to it (review 10-26: `close()` racing one in-flight request froze
   * the whole process, every tenant).
   */
  private async release(storeId: string): Promise<void> {
    const h = this.open.get(storeId);
    if (h === undefined) return;
    while (h.refs > 0 && h.closing === null) await new Promise<void>((r) => h.idle.push(r));
    await this.evict(h);
  }

  private async acquire(storeId: string, tenant: TenantOptions): Promise<Handle> {
    for (;;) {
      if (this.retired.has(storeId)) throw new Error("that store was deleted");
      if (this.opts.locked?.(storeId) === true) throw new StoreLocked();
      const h = this.open.get(storeId);
      if (h === undefined) break;
      if (h.closing !== null) {
        await h.closing;
        continue;
      }
      h.refs += 1;
      h.lastUsed = this.now();
      // LRU: most recently used last.
      this.open.delete(storeId);
      this.open.set(storeId, h);
      return h;
    }
    const h = this.openHandle(storeId, tenant);
    h.refs += 1;
    this.open.set(storeId, h);
    // Not awaited: one person's first call never waits on other stores closing.
    // `evict` marks each handle closing synchronously, so the cap holds at once.
    this.trim();
    return h;
  }

  private openHandle(storeId: string, tenant: TenantOptions): Handle {
    const dir = tenantDir(this.root, storeId);
    const storeDir = join(dir, "store");
    // A store this open CREATES is a new person's: it starts like a new install (below).
    // The DATABASE FILE, not the directory: a restore that failed or found no
    // replica leaves `store/` behind empty, and that store must still wait for a
    // restore, never be made empty and replicated over its own backup (#OL2b review H1).
    const fresh = !existsSync(join(storeDir, DATABASE_FILE));
    if (fresh && this.opts.openedBefore?.(storeId) === true) throw new StoreNeedsRestore();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const configPath = join(dir, "config.json");
    const config: AdapterConfig = {
      dataDir: storeDir,
      ...(tenant.timeZone === undefined ? {} : { timeZone: tenant.timeZone }),
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    chmodSync(configPath, 0o600);
    const worker = this.opts.worker ?? { command: process.execPath, args: scriptArgs(WORKER_RUNNER_PATH) };
    const server = openServer({
      dir: storeDir,
      host: CLAUDE_AI_HOST,
      // Nothing of this process's environment reaches a store's server.
      env: {},
      scopesFile: scopesPath(configPath),
      ...(this.opts.embedder === undefined ? {} : { embedder: this.opts.embedder }),
      ...(tenant.timeZone === undefined ? {} : { timeZone: tenant.timeZone }),
      manifestVersion: () => null,
      lifecycle: {
        config,
        configPath,
        command: worker.command,
        args: worker.args,
        spawner: this.spawner,
      },
    });
    // Restored from the bucket: the word index and vectors (box 3) were never in
    // the backup, so they are rebuilt from the rows before the first call.
    const marker = join(dir, RESTORED_MARKER);
    if (!fresh && existsSync(marker)) {
      try {
        server.counterpart.store.rebuildCache();
      } catch (err) {
        server.counterpart.close();
        throw err;
      }
      rmSync(marker, { force: true });
    }
    if (fresh) {
      startNewStore(server);
      try {
        this.opts.onCreated?.(storeId);
      } catch {
        /* a marker, not a gate */
      }
    }
    this.tell("tenant.open", storeId);
    return { storeId, server, serial: serialQueue(), refs: 0, lastUsed: this.now(), closing: null, idle: [] };
  }

  /** Over the cap: close the least recently used idle handles. A soft cap — in-use handles are never closed. */
  private trim(): void {
    const max = this.opts.maxOpen ?? DEFAULT_MAX_OPEN;
    const over = this.open.size - max;
    if (over <= 0) return;
    const idle = [...this.open.values()].filter((h) => h.refs === 0 && h.closing === null).slice(0, over);
    for (const h of idle) void this.evict(h);
  }

  /** Close one handle after its queue drains. Never rejects: a close that throws still leaves the map. */
  private evict(h: Handle): Promise<void> {
    if (h.closing !== null) return h.closing;
    h.closing = (async (): Promise<void> => {
      // Drain: anything already queued finishes first.
      await h.serial(async () => undefined);
      try {
        h.server.forgetLaunch();
        h.server.counterpart.close();
      } catch {
        /* the handle is gone either way; the next open starts clean */
      } finally {
        if (this.open.get(h.storeId) === h) this.open.delete(h.storeId);
        this.tell("tenant.close", h.storeId);
      }
    })();
    return h.closing;
  }

  private tell(name: "tenant.open" | "tenant.close", storeId: string): void {
    try {
      this.opts.onEvent?.(name, storeId);
    } catch {
      /* a listener never fails a call */
    }
  }
}

/**
 * A NEW PERSON'S STORE STARTS LIKE A NEW INSTALL (OL1b's finding, 2026-10-26):
 * only `counterparts install` writes onboarding `not_started`, so a store this
 * server creates would otherwise never offer the first meeting. Dreaming starts
 * `auto`, as every new install does (Mike, 2026-10-11; the roadmap's ruling of
 * 2026-10-26): the setting is the PERSON'S wish, and the HOST decides who starts
 * the night. On this host nothing starts on its own — the wake makes no dream
 * offer on claude.ai (`mcp/server.ts`), and no path from the server or its
 * worker spawns a night run (that is Claude Code's hooks alone) — so the
 * person's own routine runs the night through the `dream` tool. The tests pin
 * both halves (`hosted/test/tenants.test.ts`).
 */
export function startNewStore(server: McpServer): void {
  const store = server.counterpart.store;
  beginNewInstall(store);
}

/** The environment keys a worker child may inherit, beyond the `COUNTERPARTS_*` the plan pinned. */
export const WORKER_ENV_ALLOW = ["PATH", "LANG", "LC_ALL", "TZ", "TMPDIR"] as const;

/**
 * The `COUNTERPARTS_*` values a worker may carry, BY NAME (review 10-26): the
 * ones `planSpawn` pins, plus where the static weights live. A prefix match
 * would hand on whatever the server's environment exported under the prefix:
 * `COUNTERPARTS_OBSERVER` or `COUNTERPARTS_NIGHT_CHILD` would change what the
 * worker does, and a future secret named that way would leak.
 */
export const WORKER_COUNTERPARTS_ALLOW = [DATA_DIR_ENV, WATCHDOG_ENV, SESSION_ENV, SCOPE_ENV, CONFIG_ENV, STATIC_WEIGHTS_ENV] as const;

/** The plan's environment, cut down to what a worker needs and nothing of the server's. */
export function workerEnv(plan: SpawnPlan): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of WORKER_ENV_ALLOW) {
    const v = plan.env[key];
    if (v !== undefined) env[key] = v;
  }
  for (const key of WORKER_COUNTERPARTS_ALLOW) {
    const v = plan.env[key];
    if (v !== undefined) env[key] = v;
  }
  // The child's home is its tenant dir: nothing under a real home.
  const dataDir = plan.env[DATA_DIR_ENV];
  if (dataDir !== undefined) env["HOME"] = join(dataDir, "..");
  env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";
  return env;
}

export interface WorkerPool extends Spawner {
  /** Workers running now, by data dir. */
  running(): string[];
  /** Data dirs with one more run owed. */
  pending(): string[];
  /**
   * Forget this store (account delete): its owed run is dropped and a running
   * child is stopped. Resolves once no child for it is running.
   */
  drop(dir: string): Promise<void>;
}

/**
 * The hosted worker pool: a `Spawner` that coalesces per store and caps the
 * process. `run` starts one child and returns it (tests pass a fake).
 */
export function workerPool(opts: {
  max: number;
  run?: (plan: SpawnPlan, env: Record<string, string>) => Pick<ChildProcess, "pid" | "once" | "kill">;
}): WorkerPool {
  const run =
    opts.run ??
    ((plan: SpawnPlan, env: Record<string, string>) =>
      spawn(plan.command, [...plan.args], { stdio: "ignore", env, timeout: plan.timeoutMs }));
  const running = new Set<string>();
  const children = new Map<string, { child: Pick<ChildProcess, "pid" | "once" | "kill">; exited: Promise<void> }>();
  const owed = new Map<string, SpawnPlan>();
  const start = (dir: string, plan: SpawnPlan): number | undefined => {
    running.add(dir);
    let child: Pick<ChildProcess, "pid" | "once" | "kill">;
    try {
      child = run(plan, workerEnv(plan));
    } catch (err) {
      running.delete(dir);
      throw err;
    }
    let done = false;
    let exited!: () => void;
    const entry = { child, exited: new Promise<void>((r) => (exited = r)) };
    children.set(dir, entry);
    const finish = (): void => {
      if (done) return;
      done = true;
      running.delete(dir);
      if (children.get(dir) === entry) children.delete(dir);
      exited();
      drain();
    };
    child.once("exit", finish);
    child.once("error", finish);
    return child.pid;
  };
  const drain = (): void => {
    for (const [dir, plan] of owed) {
      if (running.size >= opts.max) return;
      if (running.has(dir)) continue;
      owed.delete(dir);
      try {
        start(dir, plan);
      } catch {
        /* a child that cannot start is the next boundary's to retry */
      }
    }
  };
  const spawner = ((plan: SpawnPlan) => {
    const dir = plan.env[DATA_DIR_ENV] ?? "";
    if (running.has(dir) || running.size >= opts.max) {
      owed.delete(dir);
      owed.set(dir, plan);
      return { pid: undefined };
    }
    return { pid: start(dir, plan) };
  }) as WorkerPool;
  spawner.running = () => [...running];
  spawner.pending = () => [...owed.keys()];
  spawner.drop = async (dir: string): Promise<void> => {
    owed.delete(dir);
    const entry = children.get(dir);
    if (entry === undefined) return;
    try {
      entry.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    await entry.exited;
  };
  return spawner;
}
