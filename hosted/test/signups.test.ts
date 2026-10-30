/**
 * `main.ts signups`, as a process, on a throwaway data root: the counts, what they
 * count, that nothing about a person comes out, and that it makes and changes
 * nothing, on a stopped volume and beside a connection that is writing.
 *
 * Fixture dates are placed relative to the real clock, because the child reads it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { scriptArgs } from "../../src/adapters/runtime.js";
import { foldWal, openDb } from "../../src/core/store/db.js";
import { Accounts } from "../src/accounts.js";
import { renderSignups, weekLabel, weekStart } from "../src/signups.js";
import { MAIN, tempRoot } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

/** Mid-week, so a Monday arriving during the test can't move a sign-up across a line. */
const midWeekAgo = (weeks: number): number => weekStart(Date.now()) - weeks * WEEK + 2.5 * DAY;

let tmp: { root: string; remove: () => void };
let data: string;
let dbPath: string;
beforeEach(() => {
  tmp = tempRoot("signups");
  // The volume, apart from the child's HOME (bun writes its transpiler cache there).
  data = join(tmp.root, "data");
  mkdirSync(data);
  dbPath = join(data, "control", "accounts.sqlite");
});
afterEach(() => tmp.remove());

function signups(extra: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  // No key, no bucket, no mail: it needs none of them.
  const env = { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: tmp.root, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", HOSTED_DATA_ROOT: data, PUBLIC_ORIGIN: "https://app.counterparts.ai", ...extra };
  return spawnSync(process.execPath, [...scriptArgs(MAIN), "signups"], { env, encoding: "utf8", timeout: 60_000 });
}

/** A person, made the way a person is made: a live invite, a link, the click. */
function signUp(accounts: Accounts, email: string, invite: string): string {
  const browser = "the-browser-binding";
  const link = accounts.requestLink({ email, inviteCode: invite, timeZone: "America/Denver", browser });
  assert.ok(link.send);
  const used = accounts.useLink({ token: link.token, browser });
  assert.ok(used.ok && used.created);
  return used.personId;
}

/** Folded and closed with no `-wal` or `-shm` beside it: a volume with no server (macOS's SQLite keeps them on a close). */
function settle(): void {
  const db = openDb(dbPath);
  foldWal(db);
  db.close();
  for (const f of [`${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
}

/** Every file under the root: name, size, hash, modified time. */
function everything(root: string = data): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) {
        out[`${relative(root, p)}/`] = "dir";
        walk(p);
      } else out[relative(root, p)] = `${String(s.size)} ${createHash("sha256").update(readFileSync(p)).digest("hex")} ${String(s.mtimeMs)}`;
    }
  };
  walk(root);
  return out;
}

const hashOf = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

const weekLine = (weeksAgo: number, count: number): string => `  ${weekLabel(weekStart(Date.now()) - weeksAgo * WEEK)}  ${String(count)}`;

describe("signups: the report", () => {
  test("the words, and a week that starts on Monday in UTC", () => {
    const now = Date.UTC(2026, 9, 30, 12); // a Friday; its Monday is 10-26
    assert.equal(weekLabel(weekStart(now)), "2026-10-26");
    assert.equal(weekLabel(weekStart(Date.UTC(2026, 9, 26))), "2026-10-26", "Monday 00:00 is its own week");
    assert.equal(weekLabel(weekStart(Date.UTC(2026, 9, 25, 23, 59, 59, 999))), "2026-10-19", "Sunday's last millisecond is the week before");
    assert.equal(
      renderSignups(
        [
          { created_at: Date.UTC(2026, 9, 7), state: "active" },
          { created_at: Date.UTC(2026, 9, 28), state: "active" },
          { created_at: Date.UTC(2026, 9, 29), state: "deleted" },
        ],
        now,
      ),
      [
        "people: 2 (accounts that exist now)",
        "sign-ups per week (each week starts Monday 00:00 UTC; every sign-up counts, including accounts deleted since):",
        "  2026-10-05  1",
        "  2026-10-12  0",
        "  2026-10-19  0",
        "  2026-10-26  2 (so far)",
      ].join("\n"),
    );
    assert.match(renderSignups([], now), /^people: 0 .*\nsign-ups per week .*: none yet$/);
  });
});

describe("signups: the command", () => {
  test("counts people and sign-ups as the code makes them, and no address, note, code or id comes out", () => {
    let clock = midWeekAgo(3);
    const accounts = new Accounts({ path: dbPath, now: () => clock });
    const email = "rosalind.known@example.test";
    const note = "for aunt rosalind, from the lake";
    const invite = accounts.createInvite({ maxUses: 5, note });
    const leaver = signUp(accounts, "leaver@example.test", invite.code);
    accounts.markDeleted(leaver);
    clock = midWeekAgo(1);
    const person = signUp(accounts, email, invite.code);
    const pending = signUp(accounts, "pending@example.test", invite.code);
    assert.notEqual(accounts.markPendingDelete(pending), null);
    // None of these is a sign-up: signing in again, a link never clicked, an invite never used.
    const again = accounts.requestLink({ email, browser: "b" });
    assert.ok(again.send);
    assert.ok(accounts.useLink({ token: again.token, browser: "b" }).ok);
    assert.ok(accounts.requestLink({ email: "never.clicked@example.test", inviteCode: invite.code, browser: "c" }).send);
    const unused = accounts.createInvite({ note: "nobody came" });
    const storeId = accounts.person(person)?.storeId;
    accounts.close();
    settle();

    const run = signups();
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stdout.trimEnd().split("\n");
    assert.equal(lines[0], "people: 2 (accounts that exist now)", "the deleted one is gone; the pending one still exists");
    assert.match(lines[1]!, /^sign-ups per week \(each week starts Monday 00:00 UTC; /);
    assert.deepEqual(lines.slice(2, 5), [weekLine(3, 1), weekLine(2, 0), weekLine(1, 2)], "the deleted one still signed up; a quiet week is 0");
    assert.equal(lines.length, 6);
    assert.match(lines[5]!, /^ {2}\d{4}-\d{2}-\d{2} {2}0 \(so far\)$/);

    const printed = run.stdout + run.stderr;
    for (const secret of [email, "rosalind", note, "lake", "nobody came", "never.clicked", invite.code, invite.id, unused.code, unused.id, person, leaver, pending, storeId!, "America/Denver", data]) {
      assert.ok(!printed.includes(secret), `the output holds "${secret}"`);
    }
    assert.ok(!printed.includes("@"));
    assert.ok(!/[0-9a-f]{32}/.test(printed), "an id");
    // And the database did hold them, so the check above checks something.
    const held = readFileSync(dbPath, "latin1");
    assert.ok(held.includes(email) && held.includes(note));
  });

  test("a week is the same week whatever zone the process is in, cut at Monday 00:00 UTC", () => {
    let clock = weekStart(Date.now()) - WEEK - 1; // the last millisecond of the Sunday a week and a bit ago
    const accounts = new Accounts({ path: dbPath, now: () => clock });
    const invite = accounts.createInvite({ maxUses: 2 });
    signUp(accounts, "sunday@example.test", invite.code);
    clock = weekStart(Date.now()) - WEEK;
    signUp(accounts, "monday@example.test", invite.code);
    accounts.close();
    const east = signups({ TZ: "Pacific/Kiritimati" });
    const west = signups({ TZ: "Pacific/Pago_Pago" });
    assert.equal(east.status, 0, east.stderr);
    assert.equal(east.stdout, west.stdout);
    const lines = east.stdout.split("\n");
    assert.ok(lines.includes(weekLine(2, 1)), east.stdout);
    assert.ok(lines.includes(weekLine(1, 1)), east.stdout);
  });

  test("no database: it fails plainly, and makes neither the database nor its folder", () => {
    const before = everything();
    const run = signups();
    assert.equal(run.status, 1);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /no accounts database on this volume.*Nothing was made/);
    assert.ok(!run.stderr.includes(data), "no path of the volume's in the words");
    assert.deepEqual(everything(), before);

    const nowhere = join(data, "not-a-volume");
    const lost = signups({ HOSTED_DATA_ROOT: nowhere });
    assert.equal(lost.status, 1);
    assert.ok(!existsSync(nowhere));
  });

  test("a file that isn't an accounts database: fails in fixed words, and the file is as it was", () => {
    mkdirSync(join(data, "control"));
    for (const content of ["", "this is not a database, and never was. ".repeat(50)]) {
      writeFileSync(dbPath, content);
      const before = everything();
      const run = signups();
      assert.equal(run.status, 1);
      assert.equal(run.stdout, "");
      assert.match(run.stderr, /couldn't be read just now .*Nothing was changed/);
      assert.ok(!/no such table|not a database/.test(run.stderr), "the driver's words stay out");
      assert.deepEqual(everything(), before);
    }
  });

  test("a stopped volume: every file under the root is exactly as it was, and nothing new is there", () => {
    const accounts = new Accounts({ path: dbPath, now: () => midWeekAgo(1) });
    signUp(accounts, "one@example.test", accounts.createInvite().code);
    accounts.close();
    settle();
    const before = everything();
    assert.deepEqual(Object.keys(before).sort(), ["control/", "control/accounts.sqlite"]);
    const run = signups();
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^people: 1 /);
    assert.deepEqual(everything(), before);
  });

  test("a -wal with no -shm: a reader would make the -shm, so it refuses and makes nothing", () => {
    const accounts = new Accounts({ path: dbPath });
    accounts.close();
    settle();
    writeFileSync(`${dbPath}-wal`, "");
    const before = everything();
    const run = signups();
    assert.equal(run.status, 1);
    assert.match(run.stderr, /couldn't be read just now/);
    assert.deepEqual(everything(), before);
  });

  test("beside a live connection: it reads what is only in the WAL, changes neither file, and the writer never notices", () => {
    const accounts = new Accounts({ path: dbPath, now: () => midWeekAgo(1) });
    const invite = accounts.createInvite({ maxUses: 2 });
    signUp(accounts, "first@example.test", invite.code);
    const wal = `${dbPath}-wal`;
    assert.ok(statSync(wal).size > 0, "the sign-up is in the WAL, not yet folded");

    // The -shm is left out: it is the shared index every reader's marks go in, not data.
    const held = { db: hashOf(dbPath), wal: hashOf(wal) };
    const run = signups();
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^people: 1 /, "a sign-up only the WAL holds is counted");
    assert.deepEqual({ db: hashOf(dbPath), wal: hashOf(wal) }, held, "no write, and no checkpoint on its close");

    // The writer goes on, on the same handle, and the next count sees it.
    signUp(accounts, "second@example.test", invite.code);
    assert.match(signups().stdout, /^people: 2 /);

    // A write transaction left open: the read doesn't wait for it, and doesn't see it.
    const writer = openDb(dbPath);
    writer.exec("BEGIN IMMEDIATE");
    writer.run("INSERT INTO people (id, created_at, state) VALUES ('uncommitted', ?, 'active')", Date.now());
    const during = signups();
    assert.equal(during.status, 0, during.stderr);
    assert.match(during.stdout, /^people: 2 /);
    writer.exec("ROLLBACK");

    // It left nothing holding the log: a checkpoint runs to the end, with no reader in its way.
    const fold = foldWal(writer);
    assert.equal(fold.busy, false, fold.error ?? "busy");
    writer.close();
    accounts.ping();
    accounts.close();
  });
});
