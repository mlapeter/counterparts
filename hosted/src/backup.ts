/**
 * BACKUPS, AND DELETE AT ONCE (OL2 step 5; design §5.3, §5.4 as Mike changed
 * it on 2026-10-26).
 *
 * WHAT LEAVES THE HOST, and under what key:
 *
 *   - **Each store's `counterparts.sqlite`**, streamed by the Litestream
 *     sidecar to `r2://<bucket>/tenants/<storeId>/` under an SSE-C key derived
 *     from that store's DEK (`keys.ts#litestreamKey`), written 0600 beside the
 *     store as `litestream.key`. Only box 2: `cache/` is rebuildable, and
 *     `journal/` and `spans/` are never backed up (`store/paths.ts#LAYOUT`).
 *   - **The control databases** (`control/accounts.sqlite`, `control/oauth.sqlite`),
 *     to `r2://<bucket>/control/<name>/`, under the SSE-C key of a DEK kept for
 *     the pseudo-store `control`.
 *   - **Each wrapped DEK, ONCE**, as its own object `keys/<storeId>.wrapped`,
 *     written at sign-up and re-written only by a rewrap (KEK rotation). No
 *     keys.sqlite backup, no daily copies: R2 versioning and object lock stay
 *     OFF for `keys/` (the runbook's bucket setting), so a delete is a delete.
 *
 * DELETE (`removeStore`), all of it at once: the store leaves the sidecar's
 * configuration (and the sidecar restarts), its key file goes, its wrapped-key
 * object goes, and its whole replica prefix goes. Even a copy someone kept of
 * the bucket is ciphertext under a key that no longer exists anywhere.
 *
 * The sidecar's R2 credentials come from its environment (Litestream reads
 * `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`); the
 * configuration file holds no secret, only paths.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATABASE_FILE } from "../../src/core/store/paths.js";
import type { ObjectStore } from "./egress.js";
import type { KeyStore } from "./keys.js";
import { litestreamKey } from "./keys.js";
import { STORE_ID, tenantDir } from "./tenants.js";

/** The pseudo-store whose DEK keys the control databases' backups. */
export const CONTROL_KEY_ID = "control";
export const CONTROL_DATABASES = ["accounts.sqlite", "oauth.sqlite"] as const;

export const keyObject = (storeId: string): string => `keys/${storeId}.wrapped`;
export const replicaPrefix = (storeId: string): string => `tenants/${storeId}/`;

export interface Sidecar {
  /** Start, or restart with the configuration as it now is. */
  reload(): void;
  stop(): Promise<void>;
}

export interface BackupsOptions {
  readonly dataRoot: string;
  readonly keys: KeyStore;
  readonly objects: ObjectStore;
  /** For the Litestream configuration. */
  readonly bucket: string;
  readonly endpoint: string;
  /** Null: no sidecar (tests, local runs). */
  readonly sidecar?: Sidecar | null;
  /** The store ids that are live now (from accounts), for `ensureAll`. */
  readonly liveStores: () => string[];
}

function yamlString(s: string): string {
  return JSON.stringify(s); // a JSON string is a valid YAML double-quoted scalar
}

export class Backups {
  readonly configPath: string;
  private readonly opts: BackupsOptions;

  constructor(opts: BackupsOptions) {
    this.opts = opts;
    this.configPath = join(opts.dataRoot, "litestream.yml");
  }

  private tenantsRoot(): string {
    return join(this.opts.dataRoot, "tenants");
  }

  private keyFile(storeId: string): string {
    return storeId === CONTROL_KEY_ID ? join(this.opts.dataRoot, "control", "litestream.key") : join(tenantDir(this.tenantsRoot(), storeId), "litestream.key");
  }

  /** Write the store's SSE-C key file (0600) from its DEK. */
  private async writeKeyFile(storeId: string): Promise<void> {
    const dek = await this.opts.keys.dek(storeId);
    const file = this.keyFile(storeId);
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${litestreamKey(dek)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    dek.fill(0);
  }

  /**
   * Make sure a store is backed up: it has a DEK (made now if not), its key
   * file, its one wrapped-key object, and a place in the sidecar's
   * configuration. Idempotent — sign-up calls it, and so does start-up for
   * every live store, so a step that failed once is finished later.
   */
  async ensureStore(storeId: string, opts: { reload?: boolean } = {}): Promise<void> {
    if (storeId !== CONTROL_KEY_ID && !STORE_ID.test(storeId)) throw new Error("not a store id");
    const wrapped = this.opts.keys.wrapped(storeId) ?? (await this.opts.keys.create(storeId));
    if (!existsSync(this.keyFile(storeId))) await this.writeKeyFile(storeId);
    if ((await this.opts.objects.get(keyObject(storeId))) !== wrapped) await this.opts.objects.put(keyObject(storeId), wrapped);
    if (opts.reload !== false) this.reload();
  }

  /** Start-up: the control key and every live store, then one reload. */
  async ensureAll(): Promise<void> {
    await this.ensureStore(CONTROL_KEY_ID, { reload: false });
    for (const id of this.opts.liveStores()) await this.ensureStore(id, { reload: false });
    this.reload();
  }

  /** After a rewrap: the moved stores' objects carry the new wrapping (an overwrite; versioning is off). */
  async reuploadKeys(storeIds: readonly string[]): Promise<void> {
    for (const id of storeIds) {
      const wrapped = this.opts.keys.wrapped(id);
      if (wrapped !== null) await this.opts.objects.put(keyObject(id), wrapped);
    }
  }

  /**
   * DELETE AT ONCE: out of the sidecar first (so it stops writing), then the
   * key file, the local wrapped DEK, the wrapped-key object and the replica
   * prefix. The tenant dir itself is the caller's to remove (after its handle
   * is closed). Returns how many replica objects went.
   */
  async removeStore(storeId: string): Promise<number> {
    if (!STORE_ID.test(storeId)) throw new Error("not a store id");
    this.opts.keys.delete(storeId);
    this.reload(); // the configuration is written from the key store: this store is no longer in it
    rmSync(this.keyFile(storeId), { force: true });
    await this.opts.objects.delete(keyObject(storeId));
    return this.opts.objects.deletePrefix(replicaPrefix(storeId));
  }

  /** The Litestream configuration for every store that has a key, and the control databases. No secret in it. */
  config(): string {
    const replica = (path: string, keyFile: string): string[] => [
      `    replica:`,
      `      type: s3`,
      `      bucket: ${yamlString(this.opts.bucket)}`,
      `      path: ${yamlString(path)}`,
      `      endpoint: ${yamlString(this.opts.endpoint)}`,
      `      region: auto`,
      `      sse-customer-key-path: ${yamlString(keyFile)}`,
    ];
    const lines = ["# Generated by hosted/src/backup.ts. Do not edit: it is rewritten at every sign-up and delete.", "dbs:"];
    const ids = this.opts.keys.storeIds();
    if (ids.includes(CONTROL_KEY_ID)) {
      for (const db of CONTROL_DATABASES) {
        lines.push(`  - path: ${yamlString(join(this.opts.dataRoot, "control", db))}`, ...replica(`control/${db}`, this.keyFile(CONTROL_KEY_ID)));
      }
    }
    for (const id of ids) {
      if (id === CONTROL_KEY_ID || !STORE_ID.test(id)) continue;
      const dir = tenantDir(this.tenantsRoot(), id);
      lines.push(`  - path: ${yamlString(join(dir, "store", DATABASE_FILE))}`, ...replica(replicaPrefix(id).slice(0, -1), this.keyFile(id)));
    }
    return `${lines.join("\n")}\n`;
  }

  /** Write the configuration and restart the sidecar on it. */
  reload(): void {
    writeFileSync(this.configPath, this.config(), { mode: 0o600 });
    this.opts.sidecar?.reload();
  }
}

/**
 * THE LITESTREAM SIDECAR: one `litestream replicate -config <file>` child,
 * restarted when the configuration changes and (with a back-off) when it dies.
 * Its environment carries the R2 credentials and nothing else of the server's.
 */
export class LitestreamSidecar implements Sidecar {
  private child: ChildProcess | null = null;
  private stopping = false;
  private restarts: number[] = [];
  private readonly opts: {
    binary: string;
    configPath: string;
    env: Record<string, string>;
    spawnFn?: (cmd: string, args: string[], env: Record<string, string>) => ChildProcess;
    onEvent?: (name: "sidecar.start" | "sidecar.exit" | "sidecar.backoff") => void;
  };

  constructor(opts: LitestreamSidecar["opts"]) {
    this.opts = opts;
  }

  reload(): void {
    this.stopping = false;
    const old = this.child;
    this.child = null;
    if (old !== null) {
      old.removeAllListeners("exit");
      old.once("exit", () => this.start());
      old.kill("SIGTERM");
    } else {
      this.start();
    }
  }

  private start(): void {
    if (this.stopping || this.child !== null) return;
    const run = this.opts.spawnFn ?? ((cmd: string, args: string[], env: Record<string, string>) => spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"], env }));
    const child = run(this.opts.binary, ["replicate", "-config", this.opts.configPath], this.opts.env);
    this.child = child;
    this.opts.onEvent?.("sidecar.start");
    child.once("exit", () => {
      if (this.child === child) this.child = null;
      this.opts.onEvent?.("sidecar.exit");
      if (this.stopping) return;
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => t > now - 60 * 60 * 1000);
      this.restarts.push(now);
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(6, this.restarts.length - 1));
      this.opts.onEvent?.("sidecar.backoff");
      setTimeout(() => this.start(), delay).unref?.();
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const c = this.child;
    this.child = null;
    if (c === null) return;
    await new Promise<void>((r) => {
      c.once("exit", () => r());
      c.kill("SIGTERM");
    });
  }
}
