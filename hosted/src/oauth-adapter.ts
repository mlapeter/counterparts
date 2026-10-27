/**
 * oidc-provider's STORAGE, ON SQLITE, WITH EVERY BEARER VALUE HASHED
 * (OL2 step 4; design §4.5).
 *
 * oidc-provider hands its adapter an opaque token's VALUE as the row id, and
 * repeats it in the payload as `jti`. Stored as given, a copy of this file
 * would hold every live access token, refresh token and authorization code.
 * So:
 *
 *   - the row key is `sha256(id)`, and every lookup (`find`, `consume`,
 *     `destroy`) hashes the id it is handed;
 *   - for the BEARER models (access and refresh tokens, authorization codes),
 *     `jti` — which IS the token — is removed from the stored payload and put
 *     back from the id on `find`: only a caller who already holds the value
 *     can rebuild the row;
 *   - a Session's `uid` is stored hashed, and `findByUid` hashes. A Session
 *     keeps its `jti` in the payload (oidc-provider needs it back from
 *     `findByUid`); that session only carries an authorization flow, and the
 *     Allow page also requires our own web session, which is hashed in
 *     `accounts.sqlite`.
 *
 * Two kinds of row are not credentials and keep their ids readable, because
 * the account page has to list and disconnect them: `Grant` (an id that grants
 * nothing by itself — tokens are checked against it) and `Client` (a
 * `client_id` is public by definition). Grants also keep their account id in a
 * column, so "this person's connected AIs" is one indexed query.
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { openDb } from "../../src/core/store/db.js";
import type { Db } from "../../src/core/store/db.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS oidc (
  model TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  grant_id TEXT,
  uid_hash TEXT,
  account_id TEXT,
  expires_at INTEGER,
  consumed_at INTEGER,
  PRIMARY KEY (model, key)
);
CREATE INDEX IF NOT EXISTS oidc_grant ON oidc(grant_id);
CREATE INDEX IF NOT EXISTS oidc_uid ON oidc(model, uid_hash);
CREATE INDEX IF NOT EXISTS oidc_account ON oidc(model, account_id);
CREATE TABLE IF NOT EXISTS grant_use (
  grant_id TEXT PRIMARY KEY,
  last_used_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS client_use (
  client_id TEXT PRIMARY KEY,
  first_grant_at INTEGER NOT NULL
);
`;

/** OL2b: a registered client that no one ever allowed is dropped this long after it registered (the old INTERFACE-GAPS item "unused DCR clients pile up"). */
export const UNUSED_CLIENT_DAYS = 30;

/** Rows whose ids are not bearer credentials (see the header). */
const READABLE = new Set(["Grant", "Client"]);

/** Rows whose id IS a bearer credential: its `jti` is never stored. */
const BEARER = new Set(["AccessToken", "RefreshToken", "AuthorizationCode", "RegistrationAccessToken", "InitialAccessToken", "ClientCredentials", "DeviceCode", "BackchannelAuthenticationRequest", "PreAuthorizedCode"]);

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface StoredPayload {
  [key: string]: unknown;
  jti?: string;
  uid?: string;
  grantId?: string;
  accountId?: string;
  consumed?: number;
}

/** One SQLite file for every model. `adapterFor(model)` is what oidc-provider's `adapter` option takes. */
export class OidcStore {
  readonly db: Db;
  private readonly now: () => number;

  constructor(path: string, now: () => number = () => Date.now()) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = openDb(path, { wal: true });
    // A revoked grant's rows (account id, client id, token payloads) must not
    // stay in a free cell of this file: Litestream's every later snapshot copies
    // the whole page. node:sqlite's default is OFF (bun's is FAST).
    this.db.get("PRAGMA secure_delete = ON");
    this.db.exec(SCHEMA);
    // A database from before `client_use`: every client a grant names was allowed once.
    this.db.run("INSERT OR IGNORE INTO client_use (client_id, first_grant_at) SELECT json_extract(payload, '$.clientId'), ? FROM oidc WHERE model = 'Grant' AND json_extract(payload, '$.clientId') IS NOT NULL", now());
    this.now = now;
  }

  close(): void {
    this.db.close();
  }

  keyOf(model: string, id: string): string {
    return READABLE.has(model) ? id : hash(id);
  }

  /** Expired rows go; called lazily. */
  sweep(): void {
    this.db.run("DELETE FROM oidc WHERE expires_at IS NOT NULL AND expires_at <= ?", this.now());
  }

  /** The live grants of one person: id, client id, issued-at (ms). */
  grantsOf(accountId: string): { id: string; clientId: string; createdAt: number }[] {
    const rows = this.db.all<{ key: string; payload: string }>(
      "SELECT key, payload FROM oidc WHERE model = 'Grant' AND account_id = ? AND (expires_at IS NULL OR expires_at > ?)",
      accountId,
      this.now(),
    );
    return rows.map((r) => {
      const p = JSON.parse(r.payload) as { clientId: string; iat?: number };
      return { id: r.key, clientId: p.clientId, createdAt: (p.iat ?? 0) * 1000 };
    });
  }

  grantAccount(grantId: string): string | null {
    return this.db.get<{ account_id: string | null }>("SELECT account_id FROM oidc WHERE model = 'Grant' AND key = ?", grantId)?.account_id ?? null;
  }

  /** Delete a grant and everything issued under it (disconnect). */
  revokeGrant(grantId: string): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM oidc WHERE grant_id = ?", grantId);
      this.db.run("DELETE FROM oidc WHERE model = 'Grant' AND key = ?", grantId);
      this.db.run("DELETE FROM grant_use WHERE grant_id = ?", grantId);
    });
  }

  /** Every grant of one person (account delete, suspension). */
  revokeAccount(accountId: string): void {
    for (const g of this.grantsOf(accountId)) this.revokeGrant(g.id);
  }

  /** Readiness: the database answers. Throws when it doesn't. */
  ping(): void {
    this.db.get("SELECT 1 AS one");
  }

  /**
   * THE DCR SWEEP (OL2b). Registration is open, and Claude registers a client
   * per fresh connection, so `Client` rows pile up. Dropped: a REGISTERED
   * client (not an https client id: a CIMD document is the client's own, and
   * the library caches it) that registered more than `maxAgeMs` ago and was
   * NEVER allowed by anyone (`client_use`, written at its first grant). With
   * it go its registration tokens. A client someone allowed once is kept, even
   * after a disconnect. Returns how many went.
   */
  sweepClients(maxAgeMs: number = UNUSED_CLIENT_DAYS * 24 * 60 * 60 * 1000): number {
    const cutoffSeconds = Math.floor((this.now() - maxAgeMs) / 1000);
    const due = this.db
      .all<{ key: string; payload: string }>("SELECT key, payload FROM oidc WHERE model = 'Client' AND key NOT LIKE 'https://%'")
      .filter((r) => {
        const issued = (JSON.parse(r.payload) as { client_id_issued_at?: number }).client_id_issued_at;
        return typeof issued === "number" && issued < cutoffSeconds;
      })
      .map((r) => r.key)
      .filter((id) => this.db.get("SELECT 1 AS one FROM client_use WHERE client_id = ?", id) === undefined)
      // Belt and braces for a database older than `client_use`: anything still issued to the client keeps it.
      .filter((id) => this.db.get("SELECT 1 AS one FROM oidc WHERE model IN ('Grant', 'RefreshToken', 'AccessToken') AND json_extract(payload, '$.clientId') = ?", id) === undefined);
    for (const id of due) {
      this.db.transaction(() => {
        this.db.run("DELETE FROM oidc WHERE model = 'RegistrationAccessToken' AND json_extract(payload, '$.clientId') = ?", id);
        this.db.run("DELETE FROM oidc WHERE model = 'Client' AND key = ?", id);
      });
    }
    return due.length;
  }

  touchGrant(grantId: string, minGapMs = 10 * 60 * 1000): void {
    const at = this.now();
    const prev = this.db.get<{ last_used_at: number }>("SELECT last_used_at FROM grant_use WHERE grant_id = ?", grantId)?.last_used_at;
    if (prev !== undefined && at - prev < minGapMs) return;
    this.db.run("INSERT INTO grant_use (grant_id, last_used_at) VALUES (?, ?) ON CONFLICT(grant_id) DO UPDATE SET last_used_at = excluded.last_used_at", grantId, at);
  }

  lastUsed(grantId: string): number | null {
    return this.db.get<{ last_used_at: number }>("SELECT last_used_at FROM grant_use WHERE grant_id = ?", grantId)?.last_used_at ?? null;
  }

  adapterFor(model: string): OidcAdapter {
    return new OidcAdapter(this, model);
  }
}

export class OidcAdapter {
  private readonly store: OidcStore;
  private readonly model: string;

  constructor(store: OidcStore, model: string) {
    this.store = store;
    this.model = model;
  }

  async upsert(id: string, payload: StoredPayload, expiresIn?: number): Promise<void> {
    const rest: StoredPayload = { ...payload };
    if (BEARER.has(this.model)) delete rest.jti;
    const expiresAt = typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : null;
    this.store.db.run(
      `INSERT INTO oidc (model, key, payload, grant_id, uid_hash, account_id, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(model, key) DO UPDATE SET payload = excluded.payload, grant_id = excluded.grant_id, uid_hash = excluded.uid_hash,
         account_id = excluded.account_id, expires_at = excluded.expires_at`,
      this.model,
      this.store.keyOf(this.model, id),
      JSON.stringify(rest),
      typeof payload.grantId === "string" ? payload.grantId : null,
      typeof payload.uid === "string" ? hash(payload.uid) : null,
      this.model === "Grant" && typeof payload.accountId === "string" ? payload.accountId : null,
      expiresAt,
    );
    if (this.model === "Grant" && typeof payload.clientId === "string") {
      this.store.db.run("INSERT OR IGNORE INTO client_use (client_id, first_grant_at) VALUES (?, ?)", payload.clientId, Date.now());
    }
    if (Math.random() < 0.02) this.store.sweep();
  }

  private row(where: string, ...params: string[]): { key: string; payload: string; consumed_at: number | null; expires_at: number | null } | undefined {
    return this.store.db.get(`SELECT key, payload, consumed_at, expires_at FROM oidc WHERE model = ? AND ${where}`, this.model, ...params);
  }

  private build(row: { payload: string; consumed_at: number | null; expires_at: number | null } | undefined, id: string | null): StoredPayload | undefined {
    if (row === undefined) return undefined;
    if (row.expires_at !== null && row.expires_at <= Date.now()) return undefined;
    const payload = JSON.parse(row.payload) as StoredPayload;
    if (id !== null && BEARER.has(this.model)) payload.jti = id;
    if (row.consumed_at !== null) payload.consumed = row.consumed_at;
    return payload;
  }

  async find(id: string): Promise<StoredPayload | undefined> {
    return this.build(this.row("key = ?", this.store.keyOf(this.model, id)), id);
  }

  async findByUid(uid: string): Promise<StoredPayload | undefined> {
    const row = this.store.db.get<{ key: string; payload: string; consumed_at: number | null; expires_at: number | null }>(
      "SELECT key, payload, consumed_at, expires_at FROM oidc WHERE model = ? AND uid_hash = ?",
      this.model,
      hash(uid),
    );
    // A session's id is not recoverable from its hash; oidc-provider reads it from the payload's own fields.
    return this.build(row, null);
  }

  async findByUserCode(): Promise<undefined> {
    return undefined; // the device flow is not enabled
  }

  async consume(id: string): Promise<void> {
    this.store.db.run("UPDATE oidc SET consumed_at = ? WHERE model = ? AND key = ?", Math.floor(Date.now() / 1000), this.model, this.store.keyOf(this.model, id));
  }

  async destroy(id: string): Promise<void> {
    this.store.db.run("DELETE FROM oidc WHERE model = ? AND key = ?", this.model, this.store.keyOf(this.model, id));
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    this.store.db.run("DELETE FROM oidc WHERE model = ? AND grant_id = ?", this.model, grantId);
  }
}
