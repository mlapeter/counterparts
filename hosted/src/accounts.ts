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
 *   - **A login link works once, for 15 minutes, in any browser, and only by a
 *     press** (11-25; the asking browser only, before it). Its email also
 *     carries a 6-digit code (11-25, PR B) that works only in the browser that
 *     asked, at most `CODE_TRIES` wrong tries (`useCode`); one use covers both. Opening it spends
 *     nothing (`peekLink`); the page's CSRF-checked POST spends it (`useLink`).
 *     "Used" is written in one statement that only an unused, unexpired row
 *     satisfies, so two presses cannot both win.
 *   - **Sign-up takes a spot or an invite** (SU1, 2026-11-10; Q10 before it).
 *     An unknown address signs up with just its email while a spot is left
 *     (`spots set N`: N accounts in all, every person counted, invited or
 *     not); a live invite code signs up past the cap. With neither, no email —
 *     and the same answer on the page as everyone else, so the form never says
 *     who has an account. The spot, like the invite, is taken at the click, in
 *     the transaction that makes the person: a link asked for and never
 *     clicked takes nothing.
 *     (A product on hosted with its own way in, `signUpWithIdentity`, gates
 *     its own sign-up and reads no spots; JS1.)
 *   - **While spots are open, sign-up emails have an hourly cap** (EC1,
 *     2026-11-10): `spots emails M`, 100 by default, counted in control so a
 *     deploy doesn't reset it. Every ask counts alike, member or not; past M a
 *     new address with no live invite code gets no email, while a member or a
 *     live code still gets its link, and the page says the same to all.
 *   - **A store id is 128 random bits**, made here at sign-up and never derived
 *     from an address or a name.
 *   - **Nothing in `audit` is content**: action codes and ids only.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { openDb } from "../../src/core/store/db.js";
import type { Db } from "../../src/core/store/db.js";

export const LINK_MS = 15 * 60 * 1000;
/** Wrong tries a login code takes before it is dead (the link still works): 5 of 10^6 values per email asked for. */
export const CODE_TRIES = 5;
/** A code is checked only against the browser's ask of the last hour (it dies with its link, at 15 minutes, before that). */
export const CODE_LOOKBACK_MS = 60 * 60 * 1000;
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
/** How long an invite code lives by default (G1 L4). The `invite` command takes `--expires <days>`. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A reviewer's code lives at most this many days (DIR1): long enough for a review whose length isn't fixed, never forever. */
export const REVIEWER_MAX_DAYS = 365;
/** How long a reviewer's code lives unless `reviewer --days` says otherwise. */
export const REVIEWER_DEFAULT_DAYS = 90;
export const MAX_EMAIL = 254;
/** A delete's grace (Mike, 2026-10-27): the account is locked at once and erased this long after, unless it is kept. */
export const DELETE_GRACE_MS = 24 * 60 * 60 * 1000;
/** AR1 (Mike, 2026-11-10): an audit row, and a deleted account's tombstone, are kept this long (from the row's time; from the erase), then erased. */
export const RETENTION_DAYS = 365;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

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
-- G3 (2026-11-04): one row, the time of the last write the upload watch made
-- (backup.ts#UploadWatch). A write Litestream must ship, so a rise in the
-- bucket's TXID proves uploads work even on a quiet day. No person in it.
CREATE TABLE IF NOT EXISTS heartbeat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  at INTEGER NOT NULL
);
-- SU1 (2026-11-10): the operator's settings, one row each: 'spots' (how
-- many accounts hosted takes in all; absent ⇒ 0, closed) and, EC1,
-- 'emails_per_hour' (the sign-in asks counted an hour while spots are open;
-- absent ⇒ DEFAULT_EMAILS_PER_HOUR).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  set_at INTEGER NOT NULL
);
-- EC1 (2026-11-10): one row per clock hour (floor(ms / 3 600 000)), the
-- sign-in asks counted in it while spots were open. A count, no address.
-- Kept a day, pruned in the commit that counts.
CREATE TABLE IF NOT EXISTS email_hours (
  hour INTEGER PRIMARY KEY,
  asks INTEGER NOT NULL
);
-- DIR1 (2026-11-10): a reviewer's sign-in code, for an account the operator's
-- \`reviewer\` command made (the directory's "test account credentials" field):
-- typed beside that account's email on /login, it signs in without an email.
-- Stored as its SHA-256, expiring, revocable; one person each, never a member's.
CREATE TABLE IF NOT EXISTS reviewer_codes (
  code_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
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

/** The UTC calendar day of `ms`, as `YYYY-MM-DD` (the shape of `people.last_wake_on`). From the epoch time alone, so the process's TZ can't move it. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
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

// ── where a sign-up came from (SA1, Mike 2026-11-17) ───────────────────────

/** The columns, on `people` and on `login_links` alike. */
const ATTRIBUTION_COLUMNS = ["signup_source", "signup_referrer", "signup_landing"] as const;
export const MAX_SOURCE = 40;
export const MAX_REFERRER = 100;
export const MAX_LANDING = 100;

/** Where a sign-up came from, each field cleaned (`cleanAttribution`) or null. */
export interface Attribution {
  /** A short tag (`?r=` or `?utm_source=`): lowercase letters, digits, `.`, `_`, `-`; at most 40. */
  readonly source: string | null;
  /** The first referrer's ORIGIN only (`https://www.reddit.com`): no path, no query; an http(s) URL; at most 100. */
  readonly referrer: string | null;
  /** The site's landing PATH only (`/claude-ai/`): no query, no fragment; at most 100. */
  readonly landing: string | null;
}

export const NO_ATTRIBUTION: Attribution = { source: null, referrer: null, landing: null };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A source tag, or null: lowercased; anything but `[a-z0-9._-]`, or longer than 40, is refused whole (never cut), so it can't carry an address. */
export function cleanSource(raw: unknown): string | null {
  const v = str(raw).toLowerCase();
  return v.length > 0 && v.length <= MAX_SOURCE && /^[a-z0-9][a-z0-9._-]*$/.test(v) ? v : null;
}

/** An origin, or null: what `new URL(raw).origin` gives for an http(s) URL, nothing longer than 100. Anything without `http://` or `https://` is not one (no scheme is invented). */
export function cleanReferrer(raw: unknown): string | null {
  const v = str(raw);
  if (v.length === 0 || v.length > 2048 || !/^https?:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username !== "" || u.password !== "") return null;
    const origin = u.origin.toLowerCase();
    return origin.length <= MAX_REFERRER && origin !== "null" ? origin : null;
  } catch {
    return null;
  }
}

/** A path, or null: starts with one `/`, its query and fragment dropped, only URL path characters, at most 100. */
export function cleanLanding(raw: unknown): string | null {
  const v = str(raw).split(/[?#]/)[0] ?? "";
  return v.length > 0 && v.length <= MAX_LANDING && v.startsWith("/") && !v.startsWith("//") && /^[A-Za-z0-9/._~%-]+$/.test(v) ? v : null;
}

/**
 * The three fields from what the sign-in form (or the site's link to it) carried:
 * `r` (or, without it, `utm_source`), `ref`, `land`. Each cleaned alone; a bad
 * one is null and never refuses the sign-up. A `ref` that isn't a URL
 * (`?ref=producthunt`) is a tag, not a site: it becomes the source when no `r` or
 * `utm_source` gave one, and is never stored as a referrer.
 */
export function cleanAttribution(raw: { r?: unknown; utm_source?: unknown; ref?: unknown; land?: unknown }): Attribution {
  const referrer = cleanReferrer(raw.ref);
  const source = cleanSource(raw.r) ?? cleanSource(raw.utm_source) ?? (referrer === null ? cleanSource(raw.ref) : null);
  return { source, referrer, landing: cleanLanding(raw.land) };
}

/** What the operator's counts endpoint answers (`counts.ts`): counts only. */
export interface Counts {
  /** People with an account, as the spots count them (not deleted, not a reviewer's). */
  readonly accounts: number;
  /**
   * Of them, those with a tool call on record (`last_seen_on` set): any MCP tool call since this
   * build, or a wake since about 2026-11-10 (the back-fill from `last_wake_on`). A floor for older accounts.
   */
  readonly used: number;
  /** Of them, those whose last tool call was in the last 7 UTC days, today included. */
  readonly active7d: number;
  readonly spots: { readonly total: number; readonly left: number };
  /** Accounts per source tag; `(none)` for those that came with none. Sums to `accounts`. */
  readonly sources: Readonly<Record<string, number>>;
  /** Accounts per first referrer's origin; `(none)` likewise. Sums to `accounts`. */
  readonly referrers: Readonly<Record<string, number>>;
  /**
   * Sign-in links finished in a browser other than the one that asked, in the last 7 days (11-25): the
   * `login.link.other-browser` audit rows, sign-ups and sign-ins alike, of the people the spots count.
   */
  readonly otherBrowser7d: number;
}

export interface Person {
  readonly id: string;
  /**
   * `active`; `suspended` (by an operator, or while a delete erases);
   * `pending-delete` (locked, erased at `deleteAfter` unless kept); `deleted`
   * (a tombstone).
   */
  readonly state: "active" | "suspended" | "pending-delete" | "deleted";
  readonly email: string | null;
  readonly timeZone: string | null;
  /** The person's ACTIVE store, or null (none, or locked by a pending delete). */
  readonly storeId: string | null;
  readonly createdAt: number;
  /** When a pending delete becomes due; null otherwise. */
  readonly deleteAfter: number | null;
}

export type LinkRequest =
  | { readonly send: true; readonly to: string; readonly token: string; readonly code: string; readonly signUp: boolean }
  | { readonly send: false; readonly reason: "bad-email" | "full" | "suspended" | "busy" };

export type LinkUse =
  | { readonly ok: true; readonly personId: string; readonly created: boolean }
  | { readonly ok: false; readonly reason: "unknown" | "used" | "expired" | "suspended" | "invite-spent" | "full" };

/** The columns `finishLink` reads from a login link's row. */
interface LinkRow {
  readonly id: string;
  readonly email: string;
  readonly identity_id: string | null;
  readonly invite_id: string | null;
  readonly time_zone: string | null;
  readonly browser_hash: string;
  readonly expires_at: number;
  readonly used_at: number | null;
  readonly signup_source: string | null;
  readonly signup_referrer: string | null;
  readonly signup_landing: string | null;
}
const LINK_ROW = "id, email, identity_id, invite_id, time_zone, browser_hash, expires_at, used_at, signup_source, signup_referrer, signup_landing";

/** A code typed on the "check your email" page (`useCode`): the link's own outcome, or `wrong` (wrong, dead, or none). */
export type CodeUse = LinkUse | { readonly ok: false; readonly reason: "wrong" };

/** A login code: six digits, uniform. */
export function loginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** How a code is kept: SHA-256 under its row's id, so a copy of the table is no lookup table of a million codes. */
function codeHash(rowId: string, code: string): string {
  return sha256(`code:${rowId}:${code}`);
}

/**
 * What opening a link shows (`peekLink`): never spends it. `email` is the WHOLE
 * address (review of #860): whoever holds the link sees it one press later anyway,
 * so masking it protects nothing and only weakens the confirm's warning against a
 * link forwarded to sign someone into another person's account.
 */
export type LinkPeek =
  | { readonly ok: true; readonly email: string; readonly sameBrowser: boolean }
  | { readonly ok: false; readonly reason: "unknown" | "used" | "expired" };

/** What `signUpWithIdentity` answers (JS1). `storeId` is the active store, null unless `state` is `active`. */
export interface IdentitySignUp {
  readonly personId: string;
  readonly storeId: string | null;
  /** True when this call made the person. */
  readonly created: boolean;
  readonly state: Person["state"];
}

/** The spots (SU1): how many accounts hosted takes in all, how many there are, and how many more may sign up without a code. */
export interface Spots {
  /** The operator's number (`spots set N`); 0 when never set. */
  readonly total: number;
  /** People with an account: every state but `deleted` (a pending delete still holds its spot; an erased account frees it). */
  readonly people: number;
  /** max(0, total − people). Invite sign-ups count as people, so they can take it below zero; it reads 0 then. */
  readonly left: number;
}

/**
 * THE PUBLIC WINDOW (Mike, 2026-11-17): what `GET /spots` shows is not the hard
 * total but a window of this many, the next whole hundred above the people
 * there are, never past the hard total. Display only: sign-up is gated by the
 * hard total alone, and the alerts track it too.
 */
export const PUBLIC_SPOTS_WINDOW = 100;

/**
 * The public face of the spots: `total` is min(hard total, (floor(people / 100) + 1) * 100),
 * `left` is max(0, that − people), and `open` is the HARD left > 0, so the site never says
 * closed while sign-up is open, or open while it's closed. From the spots alone, per read.
 */
export function publicSpots(s: Spots): { total: number; left: number; open: boolean } {
  const total = Math.min(s.total, (Math.floor(s.people / PUBLIC_SPOTS_WINDOW) + 1) * PUBLIC_SPOTS_WINDOW);
  return { total, left: Math.max(0, total - s.people), open: s.left > 0 };
}

/** The most `spots set` takes: a typo of a few extra digits is refused, not obeyed. */
export const MAX_SPOTS = 100_000;

/** EC1: the sign-in asks counted an hour while spots are open, when the operator never set it (`spots emails M`). */
export const DEFAULT_EMAILS_PER_HOUR = 100;
/** The most `spots emails` takes. */
export const MAX_EMAILS_PER_HOUR = 100_000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The hourly email cap (EC1): how many sign-in asks this clock hour may count
 * while spots are open, and how many it has. Past it, an address with no
 * account gets no email; a member still gets their sign-in link.
 */
export interface EmailCap {
  /** The operator's M (`spots emails M`); DEFAULT_EMAILS_PER_HOUR when never set. */
  readonly perHour: number;
  /** Asks counted in this clock hour. */
  readonly thisHour: number;
  /** thisHour ≥ perHour: sign-up emails wait for the next hour. */
  readonly reached: boolean;
}

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
    // A deleted person's address must not stay in a free cell of this file:
    // Litestream's every later snapshot copies the whole page. node:sqlite's
    // default is OFF (bun's is FAST).
    this.db.get("PRAGMA secure_delete = ON");
    this.db.exec(SCHEMA);
    // OL2b: when a store's dir was first made (the restore guard's "had a
    // life"). Added by ALTER so a database made before it gains the column.
    if (!this.db.all<{ name: string }>("PRAGMA table_info(stores)").some((c) => c.name === "opened_at")) {
      this.db.exec("ALTER TABLE stores ADD COLUMN opened_at INTEGER");
    }
    // R6 (2026-10-27): when a delete set for later becomes due. NULL unless the
    // person is `pending-delete`. Added the same way, so a fresh volume and an
    // existing beta volume both take it.
    if (!this.db.all<{ name: string }>("PRAGMA table_info(people)").some((c) => c.name === "delete_after")) {
      this.db.exec("ALTER TABLE people ADD COLUMN delete_after INTEGER");
    }
    // HD1 (2026-11-04): when a chat's delete in this store may first be erased
    // (its 24-hour hold ends). NULL when none waits. Set at a hold through the
    // store's server (`tenants.ts`, the `removal.onHeld` callback), so the
    // ten-minute timer opens only a store with an erase due — a quiet person's
    // "deleted" memory must not wait for their next wake. Added by ALTER like
    // the two above, so it is safe to run twice and on the beta volume.
    if (!this.db.all<{ name: string }>("PRAGMA table_info(stores)").some((c) => c.name === "removal_due_at")) {
      this.db.exec("ALTER TABLE stores ADD COLUMN removal_due_at INTEGER");
    }
    // LW1 (Mike, 2026-11-09): the DAY of the person's last wake, `YYYY-MM-DD`
    // in UTC; this column holds only the date, no time, client or address. NULL until
    // their first wake. It tells a quiet account from a live one. Added by
    // ALTER like the three above, so it is safe to run twice and on the beta volume.
    if (!this.db.all<{ name: string }>("PRAGMA table_info(people)").some((c) => c.name === "last_wake_on")) {
      this.db.exec("ALTER TABLE people ADD COLUMN last_wake_on TEXT");
    }
    // DIR1 (2026-11-10): what a store is seeded with at its first open: 'sample'
    // for a reviewer's account (`createReviewer`), NULL for everyone else. Cleared
    // once the seed has run. Added by ALTER like the four above.
    if (!this.db.all<{ name: string }>("PRAGMA table_info(stores)").some((c) => c.name === "seed")) {
      this.db.exec("ALTER TABLE stores ADD COLUMN seed TEXT");
    }
    // DIR1 review (2026-11-10): what kind of account this is: 'reviewer' for one the
    // `reviewer` command made (it never takes a public spot), NULL for everyone else.
    if (!this.db.all<{ name: string }>("PRAGMA table_info(people)").some((c) => c.name === "kind")) {
      this.db.exec("ALTER TABLE people ADD COLUMN kind TEXT");
    }
    // SA1 (Mike, 2026-11-17): WHERE A SIGN-UP CAME FROM, set once at the account's
    // creation from what the sign-in form carried (`cleanAttribution`): a source tag,
    // the first referrer's origin, the site's landing path. NULL when none came, and
    // for every account made before. Carried from the ask to the click on the login
    // link's row, as the time zone is. And the DAY of the person's last MCP tool call
    // (`last_seen_on`, UTC `YYYY-MM-DD`, like `last_wake_on`), for the counts'
    // "used" and "active": back-filled from the last wake when it is added, so an
    // account that already woke counts as used. All added by ALTER like the
    // ones above: purely additive, safe twice and on the beta volume.
    const peopleCols = new Set(this.db.all<{ name: string }>("PRAGMA table_info(people)").map((c) => c.name));
    for (const col of ATTRIBUTION_COLUMNS) if (!peopleCols.has(col)) this.db.exec(`ALTER TABLE people ADD COLUMN ${col} TEXT`);
    if (!peopleCols.has("last_seen_on")) {
      this.db.transaction(() => {
        this.db.exec("ALTER TABLE people ADD COLUMN last_seen_on TEXT");
        this.db.exec("UPDATE people SET last_seen_on = last_wake_on WHERE last_wake_on IS NOT NULL");
      });
    }
    const linkCols = new Set(this.db.all<{ name: string }>("PRAGMA table_info(login_links)").map((c) => c.name));
    for (const col of ATTRIBUTION_COLUMNS) if (!linkCols.has(col)) this.db.exec(`ALTER TABLE login_links ADD COLUMN ${col} TEXT`);
    // THE LOGIN CODE (11-25, PR B): the emailed code's hash (`codeHash`, under the row's id) and the
    // tries it has taken. On every ask's row, refused ones too (their code is never sent), so a try
    // costs one write whatever the ask was. Added by ALTER like the ones above: purely additive.
    if (!linkCols.has("code_hash")) this.db.exec("ALTER TABLE login_links ADD COLUMN code_hash TEXT");
    if (!linkCols.has("code_tries")) this.db.exec("ALTER TABLE login_links ADD COLUMN code_tries INTEGER NOT NULL DEFAULT 0");
    // A tombstone never keeps them (the #843 review): an account erased by a build from before these columns
    // (a deploy, a rollback, a delete, a roll-forward) kept what the newer build wrote. Cleared at every open;
    // a no-op write when there is nothing to clear.
    this.db.run(
      "UPDATE people SET signup_source = NULL, signup_referrer = NULL, signup_landing = NULL, last_seen_on = NULL WHERE state = 'deleted' AND (signup_source IS NOT NULL OR signup_referrer IS NOT NULL OR signup_landing IS NOT NULL OR last_seen_on IS NOT NULL)",
    );
    this.now = opts.now ?? ((): number => Date.now());
  }

  close(): void {
    this.db.close();
  }

  /** Readiness: the database answers. Throws when it doesn't. */
  ping(): void {
    this.db.get("SELECT 1 AS one");
  }

  /** The upload watch's write (`backup.ts#UploadWatch`): one row, its time replaced (always a new value, so the page always changes), so Litestream has a transaction to ship. */
  heartbeat(): void {
    this.db.run("INSERT INTO heartbeat (id, at) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET at = max(excluded.at, heartbeat.at + 1)", this.now());
  }

  // ── the day of the last wake (LW1) ──────────────────────────────────────

  /**
   * A wake (`server.ts#HostedServerOptions.onWake`): today's date, UTC, as
   * `YYYY-MM-DD`, once a day. A read first, and a write only when the day
   * changed, so every other wake that day writes nothing (and gives Litestream
   * nothing to ship). Never audited: an audit row carries the time. True when
   * it wrote.
   */
  noteWake(personId: string): boolean {
    const today = utcDay(this.now());
    const row = this.db.get<{ last_wake_on: string | null }>("SELECT last_wake_on FROM people WHERE id = ? AND state = 'active'", personId);
    if (row === undefined || row.last_wake_on === today) return false;
    this.db.run("UPDATE people SET last_wake_on = ? WHERE id = ? AND state = 'active'", today, personId);
    return true;
  }

  /** The day (UTC, `YYYY-MM-DD`) of this person's last wake, or null when none was seen. */
  lastWakeOn(personId: string): string | null {
    return this.db.get<{ last_wake_on: string | null }>("SELECT last_wake_on FROM people WHERE id = ?", personId)?.last_wake_on ?? null;
  }

  /**
   * A tool call (`server.ts#HostedServerOptions.onToolCall`), any tool, answered
   * or refused: today's UTC day in `last_seen_on`, written only when the day
   * changed (as `noteWake`), so one write a day at most and never an audit row.
   */
  noteSeen(personId: string): boolean {
    const today = utcDay(this.now());
    const row = this.db.get<{ last_seen_on: string | null }>("SELECT last_seen_on FROM people WHERE id = ? AND state = 'active'", personId);
    if (row === undefined || row.last_seen_on === today) return false;
    this.db.run("UPDATE people SET last_seen_on = ? WHERE id = ? AND state = 'active'", today, personId);
    return true;
  }

  /** The day (UTC) of this person's last tool call, or null. */
  lastSeenOn(personId: string): string | null {
    return this.db.get<{ last_seen_on: string | null }>("SELECT last_seen_on FROM people WHERE id = ?", personId)?.last_seen_on ?? null;
  }

  /** Where this person's sign-up came from (SA1), each field null when none came. */
  attributionOf(personId: string): Attribution {
    const r = this.db.get<{ signup_source: string | null; signup_referrer: string | null; signup_landing: string | null }>(
      "SELECT signup_source, signup_referrer, signup_landing FROM people WHERE id = ?",
      personId,
    );
    return r === undefined ? NO_ATTRIBUTION : { source: r.signup_source, referrer: r.signup_referrer, landing: r.signup_landing };
  }

  /**
   * THE OPERATOR'S COUNTS (`counts.ts`): over the people the spots count, so
   * every number here adds up with the spots. Aggregates only, never a row.
   */
  counts(): Counts {
    const who = "FROM people WHERE state != 'deleted' AND kind IS NOT 'reviewer'";
    const spots = this.spots();
    const since = utcDay(this.now() - 6 * 24 * 60 * 60 * 1000);
    const by = (col: "signup_source" | "signup_referrer"): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const r of this.db.all<{ k: string | null; n: number }>(`SELECT ${col} AS k, count(*) AS n ${who} GROUP BY ${col} ORDER BY n DESC, k`)) out[r.k ?? "(none)"] = r.n;
      return out;
    };
    return {
      accounts: spots.people,
      used: this.db.get<{ n: number }>(`SELECT count(*) AS n ${who} AND last_seen_on IS NOT NULL`)?.n ?? 0,
      active7d: this.db.get<{ n: number }>(`SELECT count(*) AS n ${who} AND last_seen_on >= ?`, since)?.n ?? 0,
      spots: { total: spots.total, left: spots.left },
      sources: by("signup_source"),
      referrers: by("signup_referrer"),
      // Over the same people as the rest (the spots' people: no tombstone, no reviewer).
      otherBrowser7d:
        this.db.get<{ n: number }>(
          "SELECT count(*) AS n FROM audit JOIN people ON people.id = audit.person_id WHERE audit.action = 'login.link.other-browser' AND audit.at > ? AND people.state != 'deleted' AND people.kind IS NOT 'reviewer'",
          this.now() - 7 * 24 * 60 * 60 * 1000,
        )?.n ?? 0,
    };
  }

  // ── the operator's alerts (AL1, Mike 2026-11-17) ──────────────────────────

  /** An alert's state (`alerts.ts`), kept in `settings` under `alert.<name>` so a deploy never re-sends one; null when never set. */
  alertState(name: string): string | null {
    return this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", `alert.${name}`)?.value ?? null;
  }

  /** Compare and set: the state goes from `from` (null: absent) to `to` (null: removed) only if it is still `from`. True when it did, so two checks never both send. */
  swapAlertState(name: string, from: string | null, to: string | null): boolean {
    return this.db.transaction((): boolean => {
      if (this.alertState(name) !== from) return false;
      if (to === null) this.db.run("DELETE FROM settings WHERE key = ?", `alert.${name}`);
      else this.db.run("INSERT INTO settings (key, value, set_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, set_at = excluded.set_at", `alert.${name}`, to, this.now());
      return true;
    });
  }

  // ── stores (OL2b) ──────────────────────────────────────────────────────────

  /** Record the store's first open (its dir was made). Once; later calls keep the first time. */
  markOpened(storeId: string): void {
    this.db.run("UPDATE stores SET opened_at = ? WHERE id = ? AND opened_at IS NULL", this.now(), storeId);
  }

  /** Was this store ever opened? A store that was, and has no files here, needs a restore. */
  wasOpened(storeId: string): boolean {
    return this.db.get<{ opened_at: number | null }>("SELECT opened_at FROM stores WHERE id = ?", storeId)?.opened_at != null;
  }

  /** When this store was first opened (ms), or null: the keyless-store mint compares it with the volume's keys (R5). */
  openedAt(storeId: string): number | null {
    return this.db.get<{ opened_at: number | null }>("SELECT opened_at FROM stores WHERE id = ?", storeId)?.opened_at ?? null;
  }

  // ── a chat's deletes, erased after their hold (HD1) ──────────────────────

  /** A hold was written: this store has an erase due at `at` (ms). Keeps the EARLIER of the two when one is set already. */
  noteRemovalDue(storeId: string, at: number): void {
    this.db.run("UPDATE stores SET removal_due_at = ? WHERE id = ? AND (removal_due_at IS NULL OR removal_due_at > ?)", at, storeId, at);
  }

  /** After a sweep: the next hold's time, or null when none waits. */
  setRemovalDue(storeId: string, at: number | null): void {
    this.db.run("UPDATE stores SET removal_due_at = ? WHERE id = ?", at, storeId);
  }

  /** Live, unlocked stores with an erase due now. A time still ahead never appears. */
  removalsDue(): string[] {
    return this.db
      .all<{ id: string }>("SELECT id FROM stores WHERE state = 'active' AND removal_due_at IS NOT NULL AND removal_due_at <= ? ORDER BY removal_due_at", this.now())
      .map((r) => r.id);
  }

  /** When this store's next erase is due (ms), or null. */
  removalDueAt(storeId: string): number | null {
    return this.db.get<{ removal_due_at: number | null }>("SELECT removal_due_at FROM stores WHERE id = ?", storeId)?.removal_due_at ?? null;
  }

  /** Whose store this is (any state), or null. */
  personOfStore(storeId: string): string | null {
    return this.db.get<{ person_id: string }>("SELECT person_id FROM stores WHERE id = ?", storeId)?.person_id ?? null;
  }

  /** The stores whose delete finished (tombstones here): start-up checks the bucket holds nothing of them. */
  deletedStoreIds(): string[] {
    return this.db.all<{ id: string }>("SELECT id FROM stores WHERE state = 'deleted'").map((r) => r.id);
  }

  /**
   * THE WAY OUT FOR A STORE THAT NEVER REACHED THE BUCKET (the #653 review, L8):
   * forget that it was opened, so its next open starts it as a new install
   * instead of waiting for a restore that has nothing to bring back. The caller
   * checks the bucket holds nothing of it first (`main.ts start-over`).
   */
  clearOpened(storeId: string): void {
    this.db.run("UPDATE stores SET opened_at = NULL WHERE id = ?", storeId);
    this.audit(this.personOfStore(storeId), storeId, "store.start-over", null);
  }

  /** The store's own quota in bytes, when one was set by hand; null ⇒ the server's default. */
  quotaOf(storeId: string): number | null {
    return this.db.get<{ quota_bytes: number | null }>("SELECT quota_bytes FROM stores WHERE id = ?", storeId)?.quota_bytes ?? null;
  }

  /** Set (or, with null, clear) one store's own quota in bytes. Never touches the store's files: a store over it keeps everything. */
  setQuota(storeId: string, bytes: number | null): void {
    if (bytes !== null && (!Number.isInteger(bytes) || bytes < 0)) throw new Error("quota: a whole number of bytes, or null");
    this.db.run("UPDATE stores SET quota_bytes = ? WHERE id = ?", bytes, storeId);
    this.audit(this.personOfStore(storeId), storeId, "store.quota", bytes === null ? "default" : String(bytes));
  }

  // ── spots (SU1) ────────────────────────────────────────────────────────────

  /** The spots now. Read from the database every time: `spots set` writes from another process. */
  spots(): Spots {
    const raw = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'spots'")?.value;
    const n = raw === undefined ? 0 : Number(raw);
    const total = Number.isInteger(n) && n >= 0 ? n : 0;
    // A reviewer's account (DIR1) is the operator's, never a public spot's.
    const people = this.db.get<{ n: number }>("SELECT count(*) AS n FROM people WHERE state != 'deleted' AND kind IS NOT 'reviewer'")?.n ?? 0;
    return { total, people, left: Math.max(0, total - people) };
  }

  /** The operator sets N (`main.ts spots set N`): accounts in all. Lowering it below the people there are closes sign-up and removes nobody. */
  setSpots(total: number): Spots {
    if (!Number.isInteger(total) || total < 0 || total > MAX_SPOTS) throw new Error(`spots: a whole number from 0 to ${String(MAX_SPOTS)}`);
    // A new total re-arms the spots alerts (AL1, `alerts.ts`): each threshold fires once per total.
    if (total !== this.spots().total) this.db.run("DELETE FROM settings WHERE key = 'alert.spots'");
    this.db.run("INSERT INTO settings (key, value, set_at) VALUES ('spots', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, set_at = excluded.set_at", String(total), this.now());
    this.audit(null, null, "spots.set", String(total));
    return this.spots();
  }

  /** The email cap now (EC1). Read from the database every time, like the spots. */
  emailCap(): EmailCap {
    const raw = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'emails_per_hour'")?.value;
    const n = raw === undefined ? NaN : Number(raw);
    const perHour = Number.isInteger(n) && n >= 0 && n <= MAX_EMAILS_PER_HOUR ? n : DEFAULT_EMAILS_PER_HOUR;
    const thisHour = this.db.get<{ asks: number }>("SELECT asks FROM email_hours WHERE hour = ?", Math.floor(this.now() / HOUR_MS))?.asks ?? 0;
    return { perHour, thisHour, reached: thisHour >= perHour };
  }

  /** The operator sets M (`main.ts spots emails M`): takes effect at the next ask, no restart. */
  setEmailsPerHour(perHour: number): EmailCap {
    if (!Number.isInteger(perHour) || perHour < 0 || perHour > MAX_EMAILS_PER_HOUR) throw new Error(`spots emails: a whole number from 0 to ${String(MAX_EMAILS_PER_HOUR)}`);
    this.db.run(
      "INSERT INTO settings (key, value, set_at) VALUES ('emails_per_hour', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, set_at = excluded.set_at",
      String(perHour),
      this.now(),
    );
    this.audit(null, null, "spots.emails", String(perHour));
    return this.emailCap();
  }

  // ── invites ────────────────────────────────────────────────────────────────

  /**
   * A new invite. The code is returned once and stored hashed. It expires
   * `INVITE_TTL_MS` (7 days) after it is made unless `expiresAt` says otherwise
   * (G1 L4); codes made before that default have no expiry and stay valid.
   */
  createInvite(opts: { maxUses?: number; expiresAt?: number; note?: string } = {}): { id: string; code: string; expiresAt: number } {
    const code = secret("cpi_");
    const id = id128();
    const expiresAt = opts.expiresAt ?? this.now() + INVITE_TTL_MS;
    this.db.run(
      "INSERT INTO invites (id, code_hash, created_at, max_uses, expires_at, note) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      sha256(code),
      this.now(),
      opts.maxUses ?? 1,
      expiresAt,
      opts.note ?? null,
    );
    this.audit(null, null, "invite.created", id);
    return { id, code, expiresAt };
  }

  private liveInvite(code: string): string | null {
    // No code still costs one lookup, so "no invite" and "a bad invite" take the same time.
    if (code.length === 0) code = "\u0000";
    const row = this.db.get<{ id: string }>(
      "SELECT id FROM invites WHERE code_hash = ? AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)",
      sha256(code),
      this.now(),
    );
    return row?.id ?? null;
  }

  // ── a reviewer's account (DIR1, 2026-11-10) ────────────────────────────────

  /**
   * A REVIEWER'S ACCOUNT: a person, the email the operator named (verified by
   * the operator's say-so: nobody clicks a link), a store seeded with sample
   * data at its first open (`stores.seed`), and a sign-in code typed beside the
   * email on /login. Made past the spots, as an invite is. Refused for an email
   * that already has an account, so it never opens a real person's. The code
   * is returned once and kept as its SHA-256; it expires after `days`.
   */
  createReviewer(input: { email: unknown; days: number; timeZone?: unknown }): { personId: string; storeId: string; code: string; expiresAt: number } | { refusal: string } {
    const email = normalizeEmail(input.email);
    if (email === null) return { refusal: "that isn't an email address" };
    if (!Number.isInteger(input.days) || input.days < 1 || input.days > REVIEWER_MAX_DAYS) return { refusal: `days is a whole number from 1 to ${String(REVIEWER_MAX_DAYS)}` };
    const code = secret("cpr_");
    const at = this.now();
    const expiresAt = at + input.days * 24 * 60 * 60 * 1000;
    return this.db.transaction(() => {
      if (this.db.get("SELECT 1 AS x FROM identities WHERE kind = 'email' AND value = ?", email) !== undefined) {
        return { refusal: "that email already has an account: a reviewer's account is always a new one" };
      }
      const personId = id128();
      const storeId = id128();
      this.db.run("INSERT INTO people (id, created_at, state, time_zone, invite_id, kind) VALUES (?, ?, 'active', ?, NULL, 'reviewer')", personId, at, validTimeZone(input.timeZone));
      this.db.run("INSERT INTO identities (id, person_id, kind, value, verified_at, created_at) VALUES (?, ?, 'email', ?, ?, ?)", id128(), personId, email, at, at);
      this.db.run("INSERT INTO stores (id, person_id, created_at, state, seed) VALUES (?, ?, ?, 'active', 'sample')", storeId, personId, at);
      this.db.run("INSERT INTO reviewer_codes (code_hash, person_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(code), personId, at, expiresAt);
      this.audit(personId, storeId, "reviewer.created", null);
      return { personId, storeId, code, expiresAt };
    });
  }

  /**
   * The person a reviewer's code signs in, when `email` is that person's and
   * the code is live; else null. One lookup by the code's hash for every ask,
   * code or none, so a code that isn't one costs what no code costs.
   */
  reviewerSignIn(emailRaw: unknown, codeRaw: unknown): string | null {
    const code = typeof codeRaw === "string" && codeRaw.trim().length > 0 ? codeRaw.trim() : "\u0000";
    const row = this.db.get<{ person_id: string }>("SELECT person_id FROM reviewer_codes WHERE code_hash = ? AND expires_at > ?", sha256(code), this.now());
    if (row === undefined) return null;
    const email = normalizeEmail(emailRaw);
    const own = email === null ? undefined : this.db.get("SELECT 1 AS x FROM identities WHERE kind = 'email' AND value = ? AND person_id = ?", email, row.person_id);
    if (own === undefined || !this.canSignIn(row.person_id)) return null;
    this.audit(row.person_id, null, "login.reviewer-code", null);
    return row.person_id;
  }

  /**
   * Revoke every reviewer code of the reviewer account at `email`, and end its web sessions. How many
   * codes went, and whose: the caller ends that person's OAuth grants too (`OidcStore#revokeAccount`),
   * so a connection made with the code stops at its next call. Only a reviewer's account: never a member's.
   */
  revokeReviewer(emailRaw: unknown): { revoked: number; personId: string | null } {
    const email = normalizeEmail(emailRaw);
    if (email === null) return { revoked: 0, personId: null };
    const person = this.db.get<{ id: string }>("SELECT p.id FROM identities i JOIN people p ON p.id = i.person_id WHERE i.kind = 'email' AND i.value = ? AND p.kind = 'reviewer'", email)?.id;
    if (person === undefined) return { revoked: 0, personId: null };
    this.db.run("DELETE FROM reviewer_codes WHERE person_id = ?", person);
    const n = this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
    this.db.run("DELETE FROM web_sessions WHERE person_id = ?", person);
    this.audit(person, null, "reviewer.revoked", String(n));
    return { revoked: n, personId: person };
  }

  /**
   * A reviewer whose codes have all expired is ended as a revoke ends one (the app's timer, and start-up,
   * call this and then revoke the returned people's grants): the code rows and web sessions go. Each
   * person is returned once, because its rows go with it.
   */
  endExpiredReviewers(): string[] {
    const due = this.db
      .all<{ person_id: string }>("SELECT person_id FROM reviewer_codes GROUP BY person_id HAVING max(expires_at) <= ?", this.now())
      .map((r) => r.person_id);
    for (const person of due) {
      this.db.run("DELETE FROM reviewer_codes WHERE person_id = ?", person);
      this.db.run("DELETE FROM web_sessions WHERE person_id = ?", person);
      this.audit(person, null, "reviewer.expired", null);
    }
    return due;
  }

  /** What this store is seeded with at its first open ('sample'), or null. */
  seedOf(storeId: string): string | null {
    return this.db.get<{ seed: string | null }>("SELECT seed FROM stores WHERE id = ?", storeId)?.seed ?? null;
  }

  /** The seed ran: it never runs again. */
  clearSeed(storeId: string): void {
    this.db.run("UPDATE stores SET seed = NULL WHERE id = ?", storeId);
  }

  // ── login links ────────────────────────────────────────────────────────────

  /**
   * Someone asked for a link. Returns what to send, or why not — and the page
   * shows the same words either way. `browser` is the raw value of the
   * browser-binding cookie; only its hash is kept.
   */
  requestLink(input: { email: unknown; inviteCode?: unknown; timeZone?: unknown; browser: string; spotsLeft?: number; attribution?: Attribution }): LinkRequest {
    const email = normalizeEmail(input.email);
    if (email === null) return { send: false, reason: "bad-email" };
    // The spots, read once for every ask (or handed in by the page, which read
    // them for its words), so a known and an unknown address cost the same reads.
    const spotsLeft = input.spotsLeft ?? this.spots().left;
    // The email cap (EC1), only while spots are open; read for every ask alike.
    const perHour = spotsLeft > 0 ? this.emailCap().perHour : null;
    const identity = this.db.get<{ id: string; person_id: string }>("SELECT id, person_id FROM identities WHERE kind = 'email' AND value = ?", email);
    let inviteId: string | null = null;
    let refused: "full" | "suspended" | "busy" | null = null;
    if (identity !== undefined) {
      if (!this.canSignIn(identity.person_id)) refused = "suspended";
    } else {
      // A live code signs up past the cap. No code, or one that isn't good
      // (mistyped, expired, used up), takes a spot while one is left (SU1).
      // The spot isn't held here: the click takes it (`useLink`).
      inviteId = this.liveInvite(typeof input.inviteCode === "string" ? input.inviteCode.trim() : "");
      if (inviteId === null && spotsLeft === 0) refused = "full";
    }
    const token = secret("cpl_");
    const code = loginCode();
    const rowId = id128();
    const at = this.now();
    // Cleaned again here, whatever the caller did: nothing unclean is ever written.
    const a = input.attribution ?? NO_ATTRIBUTION;
    const attribution: Attribution = { source: cleanSource(a.source), referrer: cleanReferrer(a.referrer), landing: cleanLanding(a.landing) };
    // EVERY ask writes one row in one commit, refused or not. A refused ask's
    // row is dead on arrival (used, no address, no identity) and only pays the
    // same disk write, so the response time doesn't say who has an account: the
    // commit is the slow part (~75 µs on a laptop, milliseconds on a network
    // volume; review of #644). The same commit drops links a day past their
    // expiry, so addresses don't pile up here.
    this.db.transaction((): void => {
      // THE EMAIL CAP (EC1), while spots are open: every well-formed ask takes
      // a count, member or not, in this same commit, so neither the time nor
      // the next stranger's outcome says whether this address has an account.
      // Over the cap only a code-less sign-up is refused: a member still gets
      // their link, and a live invite code passes this cap as it passes the
      // spots (#804 review), so a stranger's flood can't block the invited. A
      // code that isn't good (inviteId null) is a code-less ask here.
      if (perHour !== null) {
        const hour = Math.floor(at / HOUR_MS);
        this.db.run("DELETE FROM email_hours WHERE hour < ?", hour - 24);
        this.db.run("INSERT INTO email_hours (hour, asks) VALUES (?, 0) ON CONFLICT (hour) DO NOTHING", hour);
        this.db.run("UPDATE email_hours SET asks = asks + 1 WHERE hour = ? AND asks < ?", hour, perHour);
        const counted = (this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) === 1;
        if (!counted && refused === null && identity === undefined && inviteId === null) refused = "busy";
      }
      this.db.run("DELETE FROM login_links WHERE expires_at < ?", at - 24 * 60 * 60 * 1000);
      const signUpLink = refused === null && identity === undefined;
      this.db.run(
        "INSERT INTO login_links (id, token_hash, email, identity_id, invite_id, time_zone, browser_hash, created_at, expires_at, used_at, signup_source, signup_referrer, signup_landing, code_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rowId,
        sha256(token),
        refused === null ? email : "",
        refused === null ? (identity?.id ?? null) : null,
        refused === null ? inviteId : null,
        validTimeZone(input.timeZone),
        sha256(input.browser),
        at,
        at + LINK_MS,
        refused === null ? null : at,
        // SA1: only a sign-up's link carries where it came from; a member's, or a refused ask's, carries nothing.
        signUpLink ? attribution.source : null,
        signUpLink ? attribution.referrer : null,
        signUpLink ? attribution.landing : null,
        codeHash(rowId, code),
      );
    });
    if (refused !== null) return { send: false, reason: refused };
    return { send: true, to: email, token, code, signUp: identity === undefined };
  }

  /**
   * THE LINK WAS OPENED (a GET, 11-25): what its page should say, and NOTHING
   * is written. Unknown, used and expired read as they will at the press. A
   * refused ask's row is dead on arrival (used), so it reads `used` like any.
   * `sameBrowser` is whether this browser's binding is the one that asked.
   */
  peekLink(input: { token: string; browser: string | null }): LinkPeek {
    const row = this.db.get<{ email: string; browser_hash: string; expires_at: number; used_at: number | null }>(
      "SELECT email, browser_hash, expires_at, used_at FROM login_links WHERE token_hash = ?",
      sha256(input.token),
    );
    if (row === undefined) return { ok: false, reason: "unknown" };
    if (row.used_at !== null) return { ok: false, reason: "used" };
    if (row.expires_at <= this.now()) return { ok: false, reason: "expired" };
    return { ok: true, email: row.email, sameBrowser: input.browser !== null && sha256(input.browser) === row.browser_hash };
  }

  /**
   * The link was PRESSED (the confirm page's POST). One use, in time, in any
   * browser (11-25: the asking browser only, before it). A link finished in a
   * browser other than the one that asked is audited `login.link.other-browser`
   * beside the sign-in's own row, for the counts (`counts().otherBrowser7d`). A sign-up
   * creates the person, the email identity (verified by this very click) and the
   * store, and spends one use of the invite — or, with no invite (or one used up
   * since), takes a spot: the count and the insert in this one transaction
   * (BEGIN IMMEDIATE, so a second connection waits for it), so two people racing
   * for the last spot can't both get in (SU1).
   */
  useLink(input: { token: string; browser: string | null }): LinkUse {
    const row = this.db.get<LinkRow>(`SELECT ${LINK_ROW} FROM login_links WHERE token_hash = ?`, sha256(input.token));
    if (row === undefined) return { ok: false, reason: "unknown" };
    if (row.used_at !== null) return { ok: false, reason: "used" };
    if (row.expires_at <= this.now()) return { ok: false, reason: "expired" };
    // Any browser may finish it (11-25); one that didn't ask is only counted.
    return this.finishLink(row, input.browser === null || sha256(input.browser) !== row.browser_hash);
  }

  /**
   * A CODE TYPED ON THE "CHECK YOUR EMAIL" PAGE (11-25, PR B). Only in the
   * browser that asked: the row looked at is THIS browser's latest ask of the
   * last hour, and the code is good only when that ask was for `email` (the
   * address the page sent it to), is unused and unexpired, has tries left, and
   * the code's hash matches. Every try takes one of the row's `CODE_TRIES` in
   * ONE guarded UPDATE before the compare, so parallel guesses can't pass the
   * count; a row with none left is dead (its link still works). The same one
   * write happens for every try that finds a row, refused asks' rows included
   * (they carry a code nobody was sent), so neither the answer nor its time says
   * whether the address has an account. Success spends the row as the link's
   * press does (`finishLink`), so one use covers the link and the code.
   */
  useCode(input: { browser: string | null; email: unknown; code: unknown }): CodeUse {
    if (input.browser === null) return { ok: false, reason: "wrong" };
    const at = this.now();
    const row = this.db.get<LinkRow & { code_hash: string | null; code_tries: number }>(
      `SELECT ${LINK_ROW}, code_hash, code_tries FROM login_links WHERE browser_hash = ? AND created_at > ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      sha256(input.browser),
      at - CODE_LOOKBACK_MS,
    );
    if (row === undefined) return { ok: false, reason: "wrong" };
    this.db.run("UPDATE login_links SET code_tries = code_tries + 1 WHERE id = ? AND code_tries < ?", row.id, CODE_TRIES);
    const counted = (this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) === 1;
    const email = normalizeEmail(input.email);
    const code = typeof input.code === "string" ? input.code.replace(/\s+/g, "") : "";
    const good =
      counted && email !== null && row.email === email && row.used_at === null && row.expires_at > at && row.code_hash !== null && /^\d{6}$/.test(code) && codeHash(row.id, code) === row.code_hash;
    if (!good) return { ok: false, reason: "wrong" };
    return this.finishLink(row, false);
  }

  /** The press or the code: spend the row once, and sign in or sign up (the SU1 transaction). */
  private finishLink(row: LinkRow, otherBrowser: boolean): LinkUse {
    return this.db.transaction((): LinkUse => {
      const at = this.now();
      const noteOther = (personId: string): void => {
        if (otherBrowser) this.audit(personId, null, "login.link.other-browser", null);
      };
      // The single-use claim: only an unused row is updated.
      this.db.run("UPDATE login_links SET used_at = ? WHERE id = ? AND used_at IS NULL", at, row.id);
      const claimed = this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
      if (claimed !== 1) return { ok: false, reason: "used" };
      if (row.identity_id !== null) {
        const ident = this.db.get<{ person_id: string }>("SELECT person_id FROM identities WHERE id = ?", row.identity_id);
        if (ident === undefined || !this.canSignIn(ident.person_id)) return { ok: false, reason: "suspended" };
        this.audit(ident.person_id, null, "login.link", null);
        noteOther(ident.person_id);
        return { ok: true, personId: ident.person_id, created: false };
      }
      // An address that signed up through another link meanwhile: sign in as that person.
      const existing = this.db.get<{ person_id: string }>("SELECT person_id FROM identities WHERE kind = 'email' AND value = ?", row.email);
      if (existing !== undefined) {
        if (!this.canSignIn(existing.person_id)) return { ok: false, reason: "suspended" };
        this.audit(existing.person_id, null, "login.link", null);
        noteOther(existing.person_id);
        return { ok: true, personId: existing.person_id, created: false };
      }
      let inviteId: string | null = null;
      if (row.invite_id !== null) {
        this.db.run("UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)", row.invite_id, at);
        if ((this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) === 1) inviteId = row.invite_id;
      }
      // No invite spent: a spot, counted inside this transaction.
      if (inviteId === null && this.spots().left === 0) return { ok: false, reason: row.invite_id === null ? "full" : "invite-spent" };
      const personId = id128();
      const storeId = id128();
      this.db.run(
        "INSERT INTO people (id, created_at, state, time_zone, invite_id, signup_source, signup_referrer, signup_landing) VALUES (?, ?, 'active', ?, ?, ?, ?, ?)",
        personId,
        at,
        row.time_zone,
        inviteId,
        row.signup_source,
        row.signup_referrer,
        row.signup_landing,
      );
      this.db.run("INSERT INTO identities (id, person_id, kind, value, verified_at, created_at) VALUES (?, ?, 'email', ?, ?, ?)", id128(), personId, row.email, at, at);
      this.db.run("INSERT INTO stores (id, person_id, created_at, state) VALUES (?, ?, ?, 'active')", storeId, personId, at);
      this.audit(personId, storeId, "signup", inviteId ?? "spot");
      noteOther(personId);
      return { ok: true, personId, created: true };
    });
  }

  // ── other ways in (JS1, 2026-11-13) ───────────────────────────────────────

  /** The person who owns this identity (`kind`, `value`), or null. Any state: a deleted person has no identities left (`markDeleted`). */
  personByIdentity(kind: string, value: string): string | null {
    return this.db.get<{ person_id: string }>("SELECT person_id FROM identities WHERE kind = ? AND value = ?", kind, value)?.person_id ?? null;
  }

  /**
   * SIGN UP (OR IN) BY AN IDENTITY THE CALLER HAS ALREADY VERIFIED: a product
   * on hosted with its own way in (an app's Sign in with Apple, say). In ONE
   * transaction: an identity that exists answers its person, `created: false`;
   * else a new person, the identity (verified now) and a store are made, as
   * `useLink` makes them, and audited `signup` with the kind as its detail.
   * The SPOTS are not read: the caller gates sign-up. Every person still
   * counts in `spots().people`, as everyone does.
   *
   * By the person's state, when the identity exists: `active` → `storeId` is
   * their active store. `pending-delete` → the SAME person comes back (never
   * a second account), `storeId` null (the store is locked), so the caller can
   * offer keep or erase (`keep`, `sessionPendingDelete`). `suspended` (an
   * operator's, or an erase under way) → the same person, `storeId` null; the
   * caller refuses. A DELETED person's identities are gone (`markDeleted`), so
   * a sign-up after an erase makes a new person. `state` says which.
   *
   * `email` is refused (thrown): that kind is the email link's, normalized and
   * verified there. So is a kind that isn't a short lowercase name (so no
   * `Email`), and an empty value or one over 512 characters.
   * The value is the caller's to choose: a hash of a provider's id works the
   * same and keeps the raw id out of this database. The value is never
   * audited; a sign-in by it is (`login.identity`, the kind as detail).
   */
  signUpWithIdentity(input: { kind: string; value: string; timeZone?: unknown }): IdentitySignUp {
    const { kind, value } = input;
    if (typeof kind !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(kind) || kind === "email") throw new Error("signUpWithIdentity: kind is a short lowercase name (letters, digits, hyphens) other than 'email'");
    if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new Error("signUpWithIdentity: value is 1 to 512 characters");
    return this.db.transaction((): IdentitySignUp => {
      const at = this.now();
      const existing = this.personByIdentity(kind, value);
      if (existing !== null) {
        const p = this.person(existing);
        const state = p?.state ?? "suspended";
        if (state === "active" || state === "pending-delete") this.audit(existing, null, "login.identity", kind);
        return { personId: existing, storeId: state === "active" ? (p?.storeId ?? null) : null, created: false, state };
      }
      const personId = id128();
      const storeId = id128();
      this.db.run("INSERT INTO people (id, created_at, state, time_zone, invite_id) VALUES (?, ?, 'active', ?, NULL)", personId, at, validTimeZone(input.timeZone));
      this.db.run("INSERT INTO identities (id, person_id, kind, value, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)", id128(), personId, kind, value, at, at);
      this.db.run("INSERT INTO stores (id, person_id, created_at, state) VALUES (?, ?, ?, 'active')", storeId, personId, at);
      this.audit(personId, storeId, "signup", kind);
      return { personId, storeId, created: true, state: "active" };
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

  /** Who this session cookie belongs to, if it is current and the person is live (`active`). Slides the expiry. */
  sessionPerson(token: string | null): string | null {
    const s = this.sessionOf(token);
    return s !== null && s.state === "active" ? s.personId : null;
  }

  /**
   * THE ONE OTHER WAY A SESSION COUNTS (R6): a person whose delete is pending,
   * for the pages that serve them — keep the account, or delete everything now.
   * Every other page, and the OAuth side, use `sessionPerson`, which refuses them.
   */
  sessionPendingDelete(token: string | null): string | null {
    const s = this.sessionOf(token);
    return s !== null && s.state === "pending-delete" ? s.personId : null;
  }

  private sessionOf(token: string | null): { personId: string; state: string } | null {
    if (token === null || token.length < 16 || token.length > 128) return null;
    const hash = sha256(token);
    const at = this.now();
    const row = this.db.get<{ id: string; person_id: string; expires_at: number; last_seen_at: number }>(
      "SELECT id, person_id, expires_at, last_seen_at FROM web_sessions WHERE token_hash = ?",
      hash,
    );
    if (row === undefined || row.expires_at <= at) return null;
    const state = this.stateOf(row.person_id);
    if (state !== "active" && state !== "pending-delete") return null;
    if (at - row.last_seen_at > SESSION_TOUCH_MS) {
      this.db.run("UPDATE web_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", at, at + SESSION_MS, row.id);
    }
    return { personId: row.person_id, state };
  }

  endSession(token: string | null): void {
    if (token === null) return;
    this.db.run("DELETE FROM web_sessions WHERE token_hash = ?", sha256(token));
  }

  // ── people ─────────────────────────────────────────────────────────────────

  private stateOf(personId: string): string | null {
    return this.db.get<{ state: string }>("SELECT state FROM people WHERE id = ?", personId)?.state ?? null;
  }

  /** Active: every door is open to them (OAuth, `/mcp`, the account pages). */
  isLive(personId: string): boolean {
    return this.stateOf(personId) === "active";
  }

  /**
   * May sign in on the web: active, or a delete pending (R6: so they can keep
   * the account, or delete everything now). That is all it allows: no AI can
   * connect (`isLive`), and the pages show them only the pending page.
   */
  canSignIn(personId: string): boolean {
    const state = this.stateOf(personId);
    return state === "active" || state === "pending-delete";
  }

  person(personId: string): Person | null {
    const p = this.db.get<{ id: string; state: Person["state"]; time_zone: string | null; created_at: number; delete_after: number | null }>(
      "SELECT id, state, time_zone, created_at, delete_after FROM people WHERE id = ?",
      personId,
    );
    if (p === undefined) return null;
    const email = this.db.get<{ value: string }>("SELECT value FROM identities WHERE person_id = ? AND kind = 'email' ORDER BY created_at LIMIT 1", personId)?.value ?? null;
    const store = this.db.get<{ id: string }>("SELECT id FROM stores WHERE person_id = ? AND state = 'active' ORDER BY created_at LIMIT 1", personId)?.id ?? null;
    return { id: p.id, state: p.state, email, timeZone: p.time_zone, storeId: store, createdAt: p.created_at, deleteAfter: p.delete_after };
  }

  setTimeZone(personId: string, raw: unknown): boolean {
    const tz = validTimeZone(raw);
    if (tz === null) return false;
    this.db.run("UPDATE people SET time_zone = ? WHERE id = ?", tz, personId);
    this.audit(personId, null, "timezone.set", null);
    return true;
  }

  /**
   * Suspend (or restore) a person: every session and connection stops at its
   * next use. True when the state changed. The audit row is written only then:
   * a refused change (a deleted person, an unknown id) must not read as done.
   * Suspending clears sessions either way — nobody refused is let back in.
   */
  setState(personId: string, state: "active" | "suspended"): boolean {
    // A person whose delete has begun stays out until it finishes (`markDeleting`);
    // one whose delete is pending is theirs to keep or not (`keep`), not an operator's.
    this.db.run(
      "UPDATE people SET state = ? WHERE id = ? AND state NOT IN ('deleted', 'pending-delete') AND NOT EXISTS (SELECT 1 FROM stores WHERE person_id = people.id AND state = 'deleting')",
      state,
      personId,
    );
    const changed = (this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) === 1;
    if (state !== "active") this.db.run("DELETE FROM web_sessions WHERE person_id = ?", personId);
    if (changed) this.audit(personId, null, `person.${state}`, null);
    return changed;
  }

  /**
   * The store ids of every live store: active, or locked by a pending delete
   * (R6). A pending store is KEPT as it was, so it stays in everything that
   * keeps a store: start-up's backup check (its key adopted on a new volume,
   * never a new one made: `Backups.ensureAll`'s `locked`), a restore, a
   * rewrap's key objects, the tombstone check. Nothing serves it (`storeLocked`).
   */
  liveStoreIds(): string[] {
    return this.db
      .all<{ id: string }>("SELECT s.id FROM stores s JOIN people p ON p.id = s.person_id WHERE s.state IN ('active', 'pending-delete') AND p.state != 'deleted'")
      .map((r) => r.id);
  }

  /** Is this store locked: a pending delete, or past it (erasing, erased)? Nothing opens it then. An unknown id: false. */
  storeLocked(storeId: string): boolean {
    const state = this.db.get<{ state: string }>("SELECT state FROM stores WHERE id = ?", storeId)?.state;
    return state !== undefined && state !== "active";
  }

  // ── a delete set for later (R6, Mike 2026-10-27) ──────────────────────────

  /**
   * DELETE: LOCKED AT ONCE, ERASED LATER. The person and their stores turn
   * `pending-delete` and every web session ends, in one transaction, and
   * `delete_after` (durable, in the replicated control database) says when the
   * erase is due. The store's files, key and backups are untouched. Returns the
   * deadline, or null when the person wasn't active (already pending: the first
   * deadline stands).
   */
  markPendingDelete(personId: string): number | null {
    const deadline = this.now() + DELETE_GRACE_MS;
    const changed = this.db.transaction((): boolean => {
      this.db.run("UPDATE people SET state = 'pending-delete', delete_after = ? WHERE id = ? AND state = 'active'", deadline, personId);
      if ((this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) !== 1) return false;
      this.db.run("UPDATE stores SET state = 'pending-delete' WHERE person_id = ? AND state = 'active'", personId);
      this.db.run("DELETE FROM web_sessions WHERE person_id = ?", personId);
      return true;
    });
    if (!changed) return null;
    this.audit(personId, null, "account.pending-delete", null);
    return deadline;
  }

  /**
   * KEEP IT (the undo): a pending delete, before it is due, back to active, the
   * store as it was. Connections are not restored (they were revoked; the person
   * connects again). False when there is nothing to keep: not pending, or the
   * deadline has passed — the erase is due, and a keep never races it
   * (`markDeleting`'s `due` is the other half of one condition).
   */
  keep(personId: string): boolean {
    const kept = this.db.transaction((): boolean => {
      this.db.run("UPDATE people SET state = 'active', delete_after = NULL WHERE id = ? AND state = 'pending-delete' AND delete_after > ?", personId, this.now());
      if ((this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) !== 1) return false;
      this.db.run("UPDATE stores SET state = 'active' WHERE person_id = ? AND state = 'pending-delete'", personId);
      return true;
    });
    if (kept) this.audit(personId, null, "account.kept", null);
    return kept;
  }

  /** Every person whose delete is pending (due or not): the finish tick re-makes their lock whole. */
  pendingDeletePeople(): string[] {
    return this.db.all<{ id: string }>("SELECT id FROM people WHERE state = 'pending-delete'").map((r) => r.id);
  }

  /** People whose pending delete is due now (`delete_after` passed). A deadline still ahead never appears. */
  dueDeletes(): string[] {
    return this.db.all<{ id: string }>("SELECT id FROM people WHERE state = 'pending-delete' AND delete_after IS NOT NULL AND delete_after <= ?", this.now()).map((r) => r.id);
  }

  /**
   * THE ACCOUNT'S LAST STEP (after its store is gone): every way in, every
   * session and pending link is deleted; the person and the store are left as
   * tombstones (id, dates, state) for `RETENTION_MS`, then `forget` erases them
   * (AR1; what they guard is in CONTRACT §31c). The address can
   * sign up again later as a new person, with a spot or a new invite (SU1:
   * this person stops counting against the spots here).
   */
  markDeleted(personId: string): void {
    const at = this.now();
    this.db.transaction(() => {
      const emails = this.db.all<{ value: string }>("SELECT value FROM identities WHERE person_id = ? AND kind = 'email'", personId).map((r) => r.value);
      for (const e of emails) this.db.run("DELETE FROM login_links WHERE email = ?", e);
      this.db.run("DELETE FROM identities WHERE person_id = ?", personId);
      this.db.run("DELETE FROM reviewer_codes WHERE person_id = ?", personId);
      this.db.run("DELETE FROM web_sessions WHERE person_id = ?", personId);
      this.db.run("UPDATE stores SET state = 'deleted' WHERE person_id = ?", personId);
      this.db.run("UPDATE people SET state = 'deleted', deleted_at = ?, delete_after = NULL, display_name = NULL, time_zone = NULL, last_wake_on = NULL, last_seen_on = NULL, signup_source = NULL, signup_referrer = NULL, signup_landing = NULL WHERE id = ?", at, personId);
    });
    this.audit(personId, null, "account.deleted", null);
  }

  /**
   * Mark a person as being deleted (the ERASE begins): every session and link
   * stops now, before the slow part, and their stores turn `deleting` —
   * durably, so start-up's backup check (`liveStoreIds`) never gives a
   * half-deleted store a new key, and `pendingDeletes` finds the delete to
   * finish after a crash. From active (delete everything now) or from a
   * pending delete (delete now from the pending page, or its deadline).
   *
   * `due`: only a pending delete whose deadline has passed, in one statement,
   * so a keep (`keep`, which needs the deadline ahead) and the timer can never
   * both win. Returns false when `due` found nothing to begin.
   */
  markDeleting(personId: string, opts: { due?: boolean } = {}): boolean {
    const began = this.db.transaction((): boolean => {
      if (opts.due === true) {
        this.db.run("UPDATE people SET state = 'suspended' WHERE id = ? AND state = 'pending-delete' AND delete_after IS NOT NULL AND delete_after <= ?", personId, this.now());
        if ((this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0) !== 1) return false;
      } else {
        this.db.run("UPDATE people SET state = 'suspended' WHERE id = ? AND state IN ('active', 'pending-delete')", personId);
      }
      this.db.run("UPDATE stores SET state = 'deleting' WHERE person_id = ? AND state IN ('active', 'pending-delete')", personId);
      this.db.run("DELETE FROM web_sessions WHERE person_id = ?", personId);
      return true;
    });
    if (began) this.audit(personId, null, opts.due === true ? "account.deleting.due" : "account.deleting", null);
    return began;
  }

  /** The stores a delete has to remove: every one not yet a tombstone (active or deleting). */
  storesToDelete(personId: string): string[] {
    return this.db.all<{ id: string }>("SELECT id FROM stores WHERE person_id = ? AND state != 'deleted' ORDER BY created_at", personId).map((r) => r.id);
  }

  /** People whose ERASE began and didn't finish (a crash, or R2 down): start-up and a timer finish them. Never a delete still pending (`dueDeletes`). */
  pendingDeletes(): string[] {
    return this.db.all<{ person_id: string }>("SELECT DISTINCT person_id FROM stores WHERE state = 'deleting'").map((r) => r.person_id);
  }

  audit(personId: string | null, storeId: string | null, action: string, detail: string | null): void {
    this.db.run("INSERT INTO audit (at, person_id, store_id, action, detail) VALUES (?, ?, ?, ?, ?)", this.now(), personId, storeId, action, detail);
  }

  /** Did this store's audit ever record `action`? (The leftovers check skips deletes that cleaned the bucket.) */
  storeAudited(storeId: string, actions: readonly string[]): boolean {
    return this.db.get(`SELECT 1 AS one FROM audit WHERE store_id = ? AND action IN (${actions.map(() => "?").join(", ")}) LIMIT 1`, storeId, ...actions) !== undefined;
  }

  /** For tests and the account page: the audit rows of one person, oldest first. */
  auditOf(personId: string): { action: string; detail: string | null }[] {
    return this.db.all<{ action: string; detail: string | null }>("SELECT action, detail FROM audit WHERE person_id = ? ORDER BY rowid", personId);
  }

  /**
   * AR1: AUDIT ROWS OLDER THAN `RETENTION_MS` ARE DELETED, live accounts' and
   * deleted ones' alike. Kept past it only while their store's tombstone is: a
   * deleted store's `delete.backups` / `delete.leftovers`, which start-up's
   * leftovers pass reads (they are written a moment before `deleted_at`, so the
   * age alone would take them a moment early); `forget` takes them with it.
   * Returns how many went.
   */
  pruneAudit(): number {
    this.db.run(
      "DELETE FROM audit WHERE at < ? AND NOT (action IN ('delete.backups', 'delete.leftovers') AND store_id IS NOT NULL AND store_id IN (SELECT id FROM stores WHERE state = 'deleted'))",
      this.now() - RETENTION_MS,
    );
    return this.db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
  }

  /** AR1: the deleted accounts erased more than `RETENTION_MS` ago and with no store that isn't `deleted`, each with its stores' ids (all tombstones). */
  expiredTombstones(): { personId: string; storeIds: string[] }[] {
    return this.db
      .all<{ id: string }>(
        "SELECT id FROM people p WHERE state = 'deleted' AND deleted_at IS NOT NULL AND deleted_at < ? AND NOT EXISTS (SELECT 1 FROM stores s WHERE s.person_id = p.id AND s.state != 'deleted') ORDER BY deleted_at",
        this.now() - RETENTION_MS,
      )
      .map((p) => ({ personId: p.id, storeIds: this.db.all<{ id: string }>("SELECT id FROM stores WHERE person_id = ?", p.id).map((r) => r.id) }));
  }

  /**
   * AR1: may this person be forgotten now? `deleted`, erased more than
   * `RETENTION_MS` ago, and no store that isn't `deleted`. The retention pass
   * asks it BEFORE any bucket call for the person (a wrong selection must never
   * reach `removeStore`), and `forget` asks it again inside its transaction.
   */
  forgettable(personId: string): boolean {
    const p = this.db.get<{ state: string; deleted_at: number | null }>("SELECT state, deleted_at FROM people WHERE id = ?", personId);
    if (p?.state !== "deleted" || p.deleted_at === null || p.deleted_at >= this.now() - RETENTION_MS) return false;
    return this.db.get("SELECT 1 AS one FROM stores WHERE person_id = ? AND state != 'deleted' LIMIT 1", personId) === undefined;
  }

  /**
   * AR1: A DELETED ACCOUNT, FORGOTTEN: its remaining audit rows (by person, or by
   * any of its stores), its stores' tombstones and its person tombstone, in one
   * transaction. Only a person whose every store is `deleted`; the caller has
   * proven the bucket holds nothing of them and removed their `deleted/<id>`
   * markers first (`app.ts#pruneRetention`). Writes no audit row: a row naming
   * the person would be a new trace of them. True when the person went.
   */
  forget(personId: string): boolean {
    return this.db.transaction((): boolean => {
      if (!this.forgettable(personId)) return false;
      this.db.run("DELETE FROM audit WHERE person_id = ? OR store_id IN (SELECT id FROM stores WHERE person_id = ?)", personId, personId);
      // Every table that references people goes before it (foreign keys are on); markDeleted already emptied all but stores.
      this.db.run("DELETE FROM identities WHERE person_id = ?", personId);
      this.db.run("DELETE FROM web_sessions WHERE person_id = ?", personId);
      this.db.run("DELETE FROM reviewer_codes WHERE person_id = ?", personId);
      this.db.run("DELETE FROM stores WHERE person_id = ?", personId);
      this.db.run("DELETE FROM people WHERE id = ?", personId);
      return true;
    });
  }
}
