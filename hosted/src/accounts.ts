/**
 * PEOPLE, THEIR WAYS IN, AND THEIR ONE STORE (OL2 step 3; design:
 * docs/hosted/DESIGN.md §4.1, §4.2, §6).
 *
 * The person is the hub (decision 2): a person has identities (email now;
 * phone numbers, passkeys and other AIs attach later as more rows of the same
 * table), one store, and the AIs they connect (OAuth grants, step 4).
 *
 * THE RULES THIS FILE KEEPS:
 *
 *   - **Every secret is stored as its SHA-256 and compared by lookup of the
 *     hash**: login-link tokens, web-session tokens, invite codes, the browser
 *     binding. A copy of this database signs nobody in.
 *   - **A login link works once, for 15 minutes, in the browser that asked for
 *     it.** "Used" and the person's session are written in one statement that
 *     only an unused, unexpired row satisfies, so two clicks cannot both win.
 *   - **Sign-up needs an invite** (Q10). An unknown address with no valid
 *     invite gets no email — and the same answer on the page as everyone else,
 *     so the form never says who has an account.
 *   - **A store id is 128 random bits**, made here at sign-up and never derived
 *     from an address or a name.
 *   - **Nothing in `audit` is content**: action codes and ids only.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { openDb } from "../../src/core/store/db.js";
import type { Db } from "../../src/core/store/db.js";

export const LINK_MS = 15 * 60 * 1000;
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
export const MAX_EMAIL = 254;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  state TEXT NOT NULL DEFAULT 'active',
  display_name TEXT,
  time_zone TEXT,
  invite_id TEXT
);
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, value)
);
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  quota_bytes INTEGER,
  size_bytes INTEGER,
  size_checked_at INTEGER
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  note TEXT
);
CREATE TABLE IF NOT EXISTS login_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  identity_id TEXT,
  invite_id TEXT,
  time_zone TEXT,
  browser_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  person_id TEXT NOT NULL REFERENCES people(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  at INTEGER NOT NULL,
  person_id TEXT,
  store_id TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS identities_person ON identities(person_id);
CREATE INDEX IF NOT EXISTS stores_person ON stores(person_id);
CREATE INDEX IF NOT EXISTS sessions_person ON web_sessions(person_id);
`;

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** A random secret: 32 bytes, base64url, with a short prefix naming its kind. */
export function secret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

/** 128 random bits as lowercase hex (the store id shape, `tenants.ts#STORE_ID`). */
export function id128(): string {
  return randomBytes(16).toString("hex");
}

/** A plausible email, lowercased and trimmed; null otherwise. Not a validator of deliverability. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 3 || e.length > MAX_EMAIL) return null;
  if (!/^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[a-z0-9-]{2,}$/i.test(e)) return null;
  return e;
}

/** An IANA zone this runtime knows, or null. */
export function validTimeZone(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

export interface Person {
  readonly id: string;
  readonly state: "active" | "suspended" | "deleted";
  readonly email: string | null;
  readonly timeZone: string | null;
  readonly storeId: string | null;
  readonly createdAt: number;
}

export type LinkRequest =
  | { readonly send: true; readonly to: string; readonly token: string; readonly signUp: boolean }
  | { readonly send: false; readonly reason: "bad-email" | "invite-required" | "suspended" };

export type LinkUse =
  | { readonly ok: true; readonly personId: string; readonly created: boolean }
  | { readonly ok: false; readonly reason: "unknown" | "used" | "expired" | "wrong-browser" | "suspended" | "invite-spent" };

export interface AccountsOptions {
  /** `HOSTED_DATA_ROOT/control/accounts.sqlite`. */
  readonly path: string;
  readonly now?: () => number;
}

export class Accounts {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(opts: AccountsOptions) {
    mkdirSync(dirname(opts.path), { recursive: true, mode: 0o700 });
    this.db = openDb(opts.path, { wal: true });
    this.db.exec(SCHEMA);
    this.now = opts.now ?? ((): number => Date.now());
  }

  close(): void {
    this.db.close();
  }

  // ── invites ────────────────────────────────────────────────────────────────

  /** A new invite. The code is returned once and stored hashed. */
  createInvite(opts: { maxUses?: number; expiresAt?: number; note?: string } = {}): { id: string; code: string } {
    const code = secret("cpi_");
    const id = id128();
    this.db.run(
      "INSERT INTO invites (id, code_hash, created_at, max_uses, expires_at, note) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      sha256(code),
      this.now(),
      opts.maxUses ?? 1,
      opts.expiresAt ?? null,
      opts.note ?? null,
    );
    this.audit(null, null, "invite.created", id);
    return { id, code };
  }

  private liveInvite(code: string): string | null {
    const row = this.db.get<{ id: string }>(
      "SELECT id FROM invites WHERE code_hash = ? AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)",
      sha256(code),
      this.now(),
    );
    return row?.id ?? null;
  }

  // ── login links ────────────────────────────────────────────────────────────

  /**
   * Someone asked for a link. Returns what to send, or why not — and the page
   * shows the same words either way. `browser` is the raw value of the
   * browser-binding cookie; only its hash is kept.
   */
  requestLink(input: { email: unknown; inviteCode?: unknown; timeZone?: unknown; browser: string }): LinkRequest {
    const email = normalizeEmail(input.email);
    if (email === null) return { send: false, reason: "bad-email" };
    const identity = this.db.get<{ id: string; person_id: string }>("SELECT id, person_id FROM identities WHERE kind = 'email' AND value = ?", email);
    let inviteId: string | null = null;
    if (identity !== undefined) {
      if (!this.isLive(identity.person_id)) return { send: false, reason: "suspended" };
    } else {
      inviteId = typeof input.inviteCode === "string" && input.inviteCode.trim().length > 0 ? this.liveInvite(input.inviteCode.trim()) : null;
      if (inviteId === null) return { send: false, reason: "invite-required" };
    }
    const token = secret("cpl_");
    const at = this.now();
    this.db.run(
      "INSERT INTO login_links (id, token_hash, email, identity_id, invite_id, time_zone, browser_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id128(),
      sha256(token),
      email,
      identity?.id ?? null,
      inviteId,
      validTimeZone(input.timeZone),
      sha256(input.browser),
      at,
      at + LINK_MS,
    );
    return { send: true, to: email, token, signUp: identity === undefined };
  }

  /**
   * The link was opened. One use, in time, in the browser that asked. A sign-up
   * creates the person, the email identity (verified by this very click) and the
   * store, and spends one use of the invite.
   */
  useLink(input: { token: string; browser: string | null }): LinkUse {
    const hash = sha256(input.token);
    const row = this.db.get<{ id: string; email: string; identity_id: string | null; invite_id: string | null; time_zone: string | null; browser_hash: string; expires_at: number; used_at: number | null }>(
      "SELECT id, email, identity_id, invite_id, time_zone, browser_hash, expires_at, used_at FROM login_links WHERE token_hash = ?",
      hash,
    );
    if (row === undefined) return { ok: false, reason: "unknown" };
    if (row.used_at !== null) return { ok: false, reason: "used" };
    if (row.expires_at <= this.now()) return { ok: false, reason: "expired" };
    // Wrong browser: refused WITHOUT spending the link, so the right browser can still use it.
    if (input.browser === null || sha256(input.browser) !== row.browser_hash) return { ok: false, reason: "wrong-browser" };
    return this.db.transaction((): LinkUse => {
      const at = this.now();
      // The single-use claim: only an unused row is updated.
      this.db.run("UPDATE login_links SET used_at = ? WHERE id = ? AND used_at IS NULL", at, row.id);
      const claimed = this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
      if (claimed !== 1) return { ok: false, reason: "used" };
      if (row.identity_id !== null) {
        const ident = this.db.get<{ person_id: string }>("SELECT person_id FROM identities WHERE id = ?", row.identity_id);
        if (ident === undefined || !this.isLive(ident.person_id)) return { ok: false, reason: "suspended" };
        this.audit(ident.person_id, null, "login.link", null);
        return { ok: true, personId: ident.person_id, created: false };
      }
      // An address that signed up through another link meanwhile: sign in as that person.
      const existing = this.db.get<{ person_id: string }>("SELECT person_id FROM identities WHERE kind = 'email' AND value = ?", row.email);
      if (existing !== undefined) {
        if (!this.isLive(existing.person_id)) return { ok: false, reason: "suspended" };
        return { ok: true, personId: existing.person_id, created: false };
      }
      if (row.invite_id === null) return { ok: false, reason: "invite-spent" };
      this.db.run("UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)", row.invite_id, at);
      if ((this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) !== 1) return { ok: false, reason: "invite-spent" };
      const personId = id128();
      const storeId = id128();
      this.db.run("INSERT INTO people (id, created_at, state, time_zone, invite_id) VALUES (?, ?, 'active', ?, ?)", personId, at, row.time_zone, row.invite_id);
      this.db.run("INSERT INTO identities (id, person_id, kind, value, verified_at, created_at) VALUES (?, ?, 'email', ?, ?, ?)", id128(), personId, row.email, at, at);
      this.db.run("INSERT INTO stores (id, person_id, created_at, state) VALUES (?, ?, ?, 'active')", storeId, personId, at);
      this.audit(personId, storeId, "signup", row.invite_id);
      return { ok: true, personId, created: true };
    });
  }

  // ── web sessions ───────────────────────────────────────────────────────────

  /** A new web session for this person; the token is the cookie's value. */
  startSession(personId: string): string {
    const token = secret("cps_");
    const at = this.now();
    this.db.run(
      "INSERT INTO web_sessions (id, token_hash, person_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      id128(),
      sha256(token),
      personId,
      at,
      at + SESSION_MS,
      at,
    );
    return token;
  }

  /** Who this session cookie belongs to, if it is current and the person is live. Slides the expiry. */
  sessionPerson(token: string | null): string | null {
    if (token === null || token.length < 16 || token.length > 128) return null;
    const hash = sha256(token);
    const at = this.now();
    const row = this.db.get<{ id: string; person_id: string; expires_at: number; last_seen_at: number }>(
      "SELECT id, person_id, expires_at, last_seen_at FROM web_sessions WHERE token_hash = ?",
      hash,
    );
    if (row === undefined || row.expires_at <= at || !this.isLive(row.person_id)) return null;
    if (at - row.last_seen_at > SESSION_TOUCH_MS) {
      this.db.run("UPDATE web_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", at, at + SESSION_MS, row.id);
    }
    return row.person_id;
  }

  endSession(token: string | null): void {
    if (token === null) return;
    this.db.run("DELETE FROM web_sessions WHERE token_hash = ?", sha256(token));
  }

  // ── people ─────────────────────────────────────────────────────────────────

  isLive(personId: string): boolean {
    return this.db.get<{ state: string }>("SELECT state FROM people WHERE id = ?", personId)?.state === "active";
  }

  person(personId: string): Person | null {
    const p = this.db.get<{ id: string; state: Person["state"]; time_zone: string | null; created_at: number }>(
      "SELECT id, state, time_zone, created_at FROM people WHERE id = ?",
      personId,
    );
    if (p === undefined) return null;
    const email = this.db.get<{ value: string }>("SELECT value FROM identities WHERE person_id = ? AND kind = 'email' ORDER BY created_at LIMIT 1", personId)?.value ?? null;
    const store = this.db.get<{ id: string }>("SELECT id FROM stores WHERE person_id = ? AND state = 'active' ORDER BY created_at LIMIT 1", personId)?.id ?? null;
    return { id: p.id, state: p.state, email, timeZone: p.time_zone, storeId: store, createdAt: p.created_at };
  }

  setTimeZone(personId: string, raw: unknown): boolean {
    const tz = validTimeZone(raw);
    if (tz === null) return false;
    this.db.run("UPDATE people SET time_zone = ? WHERE id = ?", tz, personId);
    this.audit(personId, null, "timezone.set", null);
    return true;
  }

  /** Suspend (or restore) a person: every session and connection stops at its next use. */
  setState(personId: string, state: "active" | "suspended"): void {
    this.db.run("UPDATE people SET state = ? WHERE id = ? AND state != 'deleted'", state, personId);
    if (state !== "active") this.db.run("DELETE FROM web_sessions WHERE person_id = ?", personId);
    this.audit(personId, null, `person.${state}`, null);
  }

  /** The store ids of every live store (start-up's backup check). */
  liveStoreIds(): string[] {
    return this.db.all<{ id: string }>("SELECT s.id FROM stores s JOIN people p ON p.id = s.person_id WHERE s.state = 'active' AND p.state != 'deleted'").map((r) => r.id);
  }

  /**
   * THE ACCOUNT'S LAST STEP (after its store is gone): every way in, every
   * session and pending link is deleted; the person and the store are left as
   * tombstones (id, dates, state) so nothing reuses their ids. The address can
   * sign up again later as a new person, with a new invite.
   */
  markDeleted(personId: string): void {
    const at = this.now();
    this.db.transaction(() => {
      const emails = this.db.all<{ value: string }>("SELECT value FROM identities WHERE person_id = ? AND kind = 'email'", personId).map((r) => r.value);
      for (const e of emails) this.db.run("DELETE FROM login_links WHERE email = ?", e);
      this.db.run("DELETE FROM identities WHERE person_id = ?", personId);
      this.db.run("DELETE FROM web_sessions WHERE person_id = ?", personId);
      this.db.run("UPDATE stores SET state = 'deleted' WHERE person_id = ?", personId);
      this.db.run("UPDATE people SET state = 'deleted', deleted_at = ?, display_name = NULL, time_zone = NULL WHERE id = ?", at, personId);
    });
    this.audit(personId, null, "account.deleted", null);
  }

  /** Mark a person as being deleted: every session and link stops now, before the slow part. */
  markDeleting(personId: string): void {
    this.db.run("UPDATE people SET state = 'suspended' WHERE id = ? AND state = 'active'", personId);
    this.db.run("DELETE FROM web_sessions WHERE person_id = ?", personId);
    this.audit(personId, null, "account.deleting", null);
  }

  audit(personId: string | null, storeId: string | null, action: string, detail: string | null): void {
    this.db.run("INSERT INTO audit (at, person_id, store_id, action, detail) VALUES (?, ?, ?, ?, ?)", this.now(), personId, storeId, action, detail);
  }

  /** For tests and the account page: the audit rows of one person, oldest first. */
  auditOf(personId: string): { action: string; detail: string | null }[] {
    return this.db.all<{ action: string; detail: string | null }>("SELECT action, detail FROM audit WHERE person_id = ? ORDER BY rowid", personId);
  }
}
