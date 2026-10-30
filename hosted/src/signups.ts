/**
 * `main.ts signups`: HOW MANY PEOPLE, AND SIGN-UPS PER WEEK, safe to paste anywhere.
 *
 * WHAT IT COUNTS. A sign-up is a `people` row: `Accounts#useLink` writes it when
 * a sign-up link is clicked, in the one transaction that also spends the invite,
 * so a redeemed invite and a sign-up are the same event. An invite made and not
 * used, or a link asked for and not clicked, is not one. "people" is the accounts
 * that exist now (every state but `deleted`, a pending delete included); the weeks
 * count every sign-up that happened, and a deleted account's tombstone keeps its
 * date, so an old week's number never drops when someone leaves.
 *
 * A WEEK starts Monday 00:00 UTC and is named by that Monday's date. No week is
 * left out between the first sign-up and now, so a quiet week reads as 0.
 *
 * SMALL WEEKS are printed as they are. A beta of about 20 is all small weeks:
 * hiding the ones under some threshold would hide nearly everything this is for,
 * and the total gives a lone hidden week back by subtraction. A count of 1 with a
 * week's date names nobody.
 *
 * NOTHING HERE CAN PRINT A PERSON: the one query reads `created_at` and `state`
 * of `people`, and a failure prints fixed words, never the driver's.
 *
 * WHY NOT `Accounts` OR `openDb`: their open makes the directory, runs the schema
 * and may `ALTER TABLE`. This takes the driver read-only itself.
 *
 * THE RUNNING SERVER isn't disturbed (hosted/test/signups.test.ts): a read-only
 * connection reads the WAL, can't checkpoint it (Litestream's position depends on
 * who does) and takes no write lock. Its only mark is on the `-shm`, the shared
 * index every reader of a WAL database updates.
 *
 * A VOLUME WITH NO SERVER has no `-wal` or `-shm`, and a read-only open would
 * make both and leave them behind (measured, Node 24), so there it reads with
 * `immutable=1`, which creates nothing. That is only for a database nobody has
 * open: any live connection to this WAL database has both files. A server starting
 * in that instant costs this read a stale count or a plain failure, and costs the
 * server nothing, because an immutable reader takes no lock.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { runtimeIsBun } from "../../src/core/store/db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** How long the read waits on a moment's contention (a recovery, a checkpoint's reset) before saying so. */
const BUSY_WAIT_MS = 2000;

/** 00:00 UTC on the Monday of the week holding `ms`. From the epoch time alone, so the process's TZ can't move it. */
export function weekStart(ms: number): number {
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return Math.floor(ms / DAY_MS) * DAY_MS - sinceMonday * DAY_MS;
}

export const weekLabel = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The whole output. `rows` are `people`'s dates and states; nothing else reaches this. */
export function renderSignups(rows: readonly { readonly created_at: number; readonly state: string }[], now: number): string {
  const people = rows.filter((r) => r.state !== "deleted").length;
  const heading = "sign-ups per week (each week starts Monday 00:00 UTC; every sign-up counts, including accounts deleted since):";
  const lines = [`people: ${String(people)} (accounts that exist now)`];
  if (rows.length === 0) return [...lines, `${heading} none yet`].join("\n");
  const counts = new Map<number, number>();
  for (const r of rows) {
    const week = weekStart(r.created_at);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  const current = weekStart(now);
  const weeks = [...counts.keys()];
  lines.push(heading);
  for (let w = Math.min(...weeks); w <= Math.max(current, ...weeks); w += WEEK_MS) {
    lines.push(`  ${weekLabel(w)}  ${String(counts.get(w) ?? 0)}${w === current ? " (so far)" : ""}`);
  }
  return lines.join("\n");
}

interface ReadOnlyDb {
  exec(sql: string): unknown;
  prepare(sql: string): { all(): unknown };
  close(): unknown;
}

/** The driver, read-only; the same split as `db.ts#openRaw`, whose open always takes a write-capable handle. */
function openReadOnly(path: string, nobodyHasIt: boolean): ReadOnlyDb {
  const uri = pathToFileURL(path);
  uri.search = "immutable=1";
  if (runtimeIsBun()) {
    const { Database } = createRequire(import.meta.url)("bun:sqlite") as { Database: new (p: string, o: { readonly: true }) => ReadOnlyDb };
    return new Database(nobodyHasIt ? uri.href : path, { readonly: true });
  }
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as unknown as { DatabaseSync: new (p: string | URL, o: { readOnly: true }) => ReadOnlyDb };
  return new DatabaseSync(nobodyHasIt ? uri : path, { readOnly: true });
}

const MISSING = "signups: there is no accounts database on this volume (control/accounts.sqlite under HOSTED_DATA_ROOT). Nothing was made.";
const UNREADABLE = "signups: control/accounts.sqlite couldn't be read just now (busy, damaged, or not an accounts database). Nothing was changed. Try again in a minute; if it keeps failing, tell the coordinator.";

/** Read and render, or a refusal in fixed words. Never makes, changes or migrates anything. */
export function signupsCommand(path: string, now: number = Date.now()): { text: string } | { refusal: string } {
  if (!existsSync(path)) return { refusal: MISSING };
  const wal = existsSync(`${path}-wal`);
  const shm = existsSync(`${path}-shm`);
  // One without the other: a reader would make the missing one, and no settled volume looks like this.
  if (wal !== shm) return { refusal: UNREADABLE };
  try {
    const db = openReadOnly(path, !wal);
    try {
      db.exec(`PRAGMA busy_timeout = ${String(BUSY_WAIT_MS)}`);
      const rows = db.prepare("SELECT created_at, state FROM people").all() as { created_at: number; state: string }[];
      return { text: renderSignups(rows, now) };
    } finally {
      db.close();
    }
  } catch {
    return { refusal: UNREADABLE };
  }
}
