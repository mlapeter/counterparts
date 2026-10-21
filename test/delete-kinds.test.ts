/**
 * DELETE ONE KIND OF DATA, AND NOTHING ELSE — and the backups that never hold
 * conversation text (Mike, 2026-10-13).
 *
 *   1. `counterparts delete conversation-text | backups | activity-log`: the
 *      plan in counts first and "Nothing has changed" without `--yes`; with it,
 *      that kind goes and nothing else does, and one `owner.deleted` row holds
 *      the kind and counts — never a session id, a word or a path. Under
 *      observer it refuses.
 *   2. Backups: a copy taken now holds the database and no `spans/`, and is
 *      still recognised as ours; deleting backups takes every copy of ours
 *      apart by name and leaves what is not ours.
 *   3. The configuration's `retention` block is read leniently.
 *   4. The dashboard's `delete` builds the console's own argv.
 *
 * Hermetic: a fresh temp base per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { SpanBuffer } from "../src/core/remember/index.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { OWNER_DELETED_EVENT } from "../src/adapters/cli/commands-delete.js";
import { loadConfig, retentionClocks } from "../src/adapters/config.js";
import { logDates, logFile } from "../src/adapters/log/index.js";
import { deleteAllCopies, readSnapshotsDir, runSnapshot } from "../src/adapters/snapshots.js";
import { buildArgv } from "../src/adapters/dashboard/web/actions.js";

const DAY = 86_400_000;
const MIN = 60_000;
const SCOPE = "/scope/delete-kinds";

let base: string;
let dir: string;
let snaps: string;
let mirror: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "counterparts-delete-kinds-"));
  dir = join(base, "store");
  snaps = join(base, "snaps");
  mirror = join(base, "mirror");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(base, "claude-code.json"), JSON.stringify({ dataDir: dir, snapshots: { dir: snaps, mirror } }), "utf8");
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(base, { recursive: true, force: true });
});

function consoleWith(answers: readonly string[] = []): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const queue = [...answers];
  const io: Io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...(answers.length > 0
      ? { prompt: async (): Promise<string> => queue.shift() ?? "", tty: { stdin: true, stdout: true } }
      : {}),
  };
  return { io, out, err };
}

/** Two sessions that talked, both ended; "owes" left a stretch unwritten. */
function seed(): void {
  let at = Date.now() - 1 * DAY;
  const c = Counterpart.open({ dir, now: () => at });
  for (const session of ["owes", "written"]) {
    const turns: { role: "user" | "assistant"; text: string }[] = [];
    for (let i = 0; i < 3; i++) {
      turns.push({ role: "user", text: `ZQWORD turn ${String(i)} of ${session}` }, { role: "assistant", text: `reply ${String(i)}` });
      at += 10 * MIN;
      c.captureSpans({ session, scope: SCOPE, turns: [...turns] });
      c.boundary({ session, scope: SCOPE, kind: "stop" });
    }
    if (session === "written") c.appendEpisode(session, "We talked it through.", { scope: SCOPE });
    c.boundary({ session, scope: SCOPE, kind: "session-end" });
  }
  c.close();
}

function heldLines(): number {
  const b = new SpanBuffer({ dir, observer: true });
  return b
    .scopes()
    .reduce((n, s) => n + b.spans(s).length + b.assistantSpans(s).length + b.quarantined(s).length, 0);
}

function deletedRows(): Record<string, unknown>[] {
  const c = Counterpart.open({ dir, observer: true });
  try {
    return c.store.eventLog({ name: OWNER_DELETED_EVENT }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
  } finally {
    c.close();
  }
}

/** A finished copy of ours, old-style (with `spans/`) or new (database only). */
function copy(where: string, name: string, withSpans: boolean): string {
  const path = join(where, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "counterparts.sqlite"), "a database");
  if (withSpans) {
    mkdirSync(join(path, "spans", "abc"), { recursive: true });
    writeFileSync(join(path, "spans", "abc", "buffer.jsonl"), "{}\n");
  }
  return path;
}

// ═══════════════════════════════════════════════════════════════════════════
describe("delete conversation-text", () => {
  test("without --yes: the counts, the owed sessions named as lost, and nothing changes", async () => {
    seed();
    const before = heldLines();
    expect(before).toBeGreaterThan(0);
    const c = consoleWith();
    expect(await run(["delete", "--dir", dir, "conversation-text"], { io: c.io })).toBe(EXIT.ok);
    const said = c.out.join("\n");
    expect(said).toContain("2 sessions");
    expect(said).toContain("1 session is still owed a write-up");
    expect(said).toContain("Nothing has changed");
    expect(heldLines()).toBe(before);
    expect(deletedRows()).toEqual([]);
  });

  test("with --yes: every line of text goes, memories stay, and the row holds counts only", async () => {
    seed();
    const memories = (() => {
      const c = Counterpart.open({ dir, observer: true });
      try {
        return c.store.list().length;
      } finally {
        c.close();
      }
    })();
    const c = consoleWith();
    expect(await run(["delete", "--dir", dir, "--yes", "conversation-text"], { io: c.io })).toBe(EXIT.ok);
    expect(heldLines()).toBe(0);
    const after = Counterpart.open({ dir, observer: true });
    open.push(after);
    expect(after.store.list().length).toBe(memories);
    const rows = deletedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "conversation-text", ok: true, sessions: 2, owed: 1 });
    const raw = JSON.stringify(rows[0]);
    expect(raw).not.toContain("ZQWORD");
    expect(raw).not.toContain("owes");
  });

  test("at a terminal it asks once; a No changes nothing", async () => {
    seed();
    const before = heldLines();
    const no = consoleWith(["n"]);
    expect(await run(["delete", "--dir", dir, "conversation-text"], { io: no.io, env: {} })).toBe(EXIT.refused);
    expect(heldLines()).toBe(before);
    const yes = consoleWith(["y"]);
    expect(await run(["delete", "--dir", dir, "conversation-text"], { io: yes.io, env: {} })).toBe(EXIT.ok);
    expect(heldLines()).toBe(0);
  });

  test("an unknown kind is a usage error; under observer it refuses", async () => {
    seed();
    const c = consoleWith();
    expect(await run(["delete", "--dir", dir, "memories"], { io: c.io })).toBe(EXIT.usage);
    const obs = consoleWith();
    expect(
      await run(["delete", "--dir", dir, "--yes", "conversation-text"], { io: obs.io, env: { COUNTERPARTS_OBSERVER: "yes" } }),
    ).toBe(EXIT.refused);
    expect(heldLines()).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("backups never hold conversation text, and delete backups", () => {
  test("a copy taken now holds the database and no spans/, and is recognised as ours", () => {
    seed();
    const c = Counterpart.open({ dir });
    open.push(c);
    const report = runSnapshot({ counterpart: c, dataDir: dir, config: { dir: snaps } });
    expect(report.reason).toBe("taken");
    const name = report.name as string;
    expect(readdirSync(join(snaps, name)).sort()).toEqual(["counterparts.sqlite"]);
    // An older copy that still holds spans/ is ours too, and both rotate.
    copy(snaps, "2026-01-01T00-00-00-000Z", true);
    expect(readSnapshotsDir(snaps).names).toEqual(["2026-01-01T00-00-00-000Z", name]);
  });

  test("delete backups: every copy of ours goes — daily, pre-migration, mirror — and what is not ours stays", async () => {
    seed();
    copy(snaps, "2026-10-01T00-00-00-000Z", true);
    copy(snaps, "2026-10-02T00-00-00-000Z", false);
    copy(snaps, "2026-09-24T10-00-00-000Z-pre-migration-v12-to-v13", false);
    copy(mirror, "2026-10-02T00-00-00-000Z", false);
    // Not ours: a pre-rows copy, and a folder that only wears the name.
    const preRows = join(snaps, "2026-08-01T00-00-00-000Z");
    mkdirSync(preRows, { recursive: true });
    writeFileSync(join(preRows, "operational.sqlite"), "a v5 database");
    const foreign = join(snaps, "2026-08-02T00-00-00-000Z");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "holiday.jpg"), "not ours");

    const dry = consoleWith();
    expect(await run(["delete", "--dir", dir, "backups"], { io: dry.io })).toBe(EXIT.ok);
    expect(dry.out.join("\n")).toContain("3 daily copies and 1 copy taken before an upgrade");
    expect(dry.out.join("\n")).toContain("rollback has nothing to go back to");
    expect(readdirSync(snaps)).toHaveLength(5);

    const c = consoleWith();
    expect(await run(["delete", "--dir", dir, "--yes", "backups"], { io: c.io })).toBe(EXIT.ok);
    expect(readdirSync(snaps).sort()).toEqual(["2026-08-01T00-00-00-000Z", "2026-08-02T00-00-00-000Z"]);
    expect(readdirSync(mirror)).toEqual([]);
    expect(deletedRows()[0]).toMatchObject({ kind: "backups", ok: true, copies: 4, left: 2 });
  });

  test("deleteAllCopies never follows a symlink: not a copy-named link, not a link inside a copy", () => {
    // Somewhere outside the snapshots directory that must survive whole.
    const outside = join(base, "outside");
    mkdirSync(join(outside, "nested"), { recursive: true });
    writeFileSync(join(outside, "counterparts.sqlite"), "looks like ours");
    writeFileSync(join(outside, "nested", "keep.txt"), "keep");
    // A copy-named SYMLINK to it at the top level, and a real copy of ours that
    // holds a symlinked directory and a symlinked file pointing at it.
    mkdirSync(snaps, { recursive: true });
    symlinkSync(outside, join(snaps, "2026-10-03T00-00-00-000Z"));
    copy(snaps, "2026-10-04T00-00-00-000Z", true);
    symlinkSync(outside, join(snaps, "2026-10-04T00-00-00-000Z", "linked-dir"));
    symlinkSync(join(outside, "nested", "keep.txt"), join(snaps, "2026-10-04T00-00-00-000Z", "linked-file"));

    const r = deleteAllCopies(dir, snaps);
    expect(r.deleted).toEqual(["2026-10-04T00-00-00-000Z"]);
    expect(r.errors).toEqual([]);
    expect(readdirSync(snaps)).toEqual(["2026-10-03T00-00-00-000Z"]);
    expect(readdirSync(outside).sort()).toEqual(["counterparts.sqlite", "nested"]);
    expect(readFileSync(join(outside, "nested", "keep.txt"), "utf8")).toBe("keep");
  });

  test("deleteAllCopies refuses a directory that holds the store", () => {
    expect(() => deleteAllCopies(dir, base)).toThrow();
    expect(existsSync(dir)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("delete activity-log", () => {
  test("every dated file goes; a file that is not a date is left", async () => {
    seed();
    for (const date of ["2026-10-01", "2026-10-02"]) {
      mkdirSync(join(dir, "sessions", "log"), { recursive: true });
      writeFileSync(logFile(dir, date), '{"name":"x"}\n');
    }
    writeFileSync(join(dir, "sessions", "log", "notes.txt"), "mine");
    const c = consoleWith();
    expect(await run(["delete", "--dir", dir, "--yes", "activity-log"], { io: c.io })).toBe(EXIT.ok);
    expect(logDates(dir)).toEqual([]);
    expect(existsSync(join(dir, "sessions", "log", "notes.txt"))).toBe(true);
    expect(deletedRows()[0]).toMatchObject({ kind: "activity-log", files: 2, failed: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the retention block and the dashboard's door", () => {
  test("read leniently: a bad field is named and its default used, never 0 or forever", () => {
    expect(retentionClocks(loadConfig({}).config)).toMatchObject({ afterWriteUpDays: 3, maxDays: 14 });
    const set = loadConfig({ retention: { afterWriteUpDays: 14, maxDays: 30 } });
    expect(set.ok).toBe(true);
    expect(retentionClocks(set.config)).toEqual({ afterWriteUpDays: 14, maxDays: 30, retentionMs: 14 * DAY, maxMs: 30 * DAY });
    const bad = loadConfig({ retention: { afterWriteUpDays: 0, maxDays: "30", forever: true } });
    expect(bad.ok).toBe(true);
    expect(bad.config.observer).toBeUndefined();
    expect(retentionClocks(bad.config)).toMatchObject({ afterWriteUpDays: 3, maxDays: 14 });
    expect(bad.config.retention?.ignored).toHaveLength(3);
  });

  test("the dashboard builds the console's own argv: a dry run, or --yes when confirmed", () => {
    const ctx = { dir, config: join(base, "claude-code.json") } as Parameters<typeof buildArgv>[2];
    expect(buildArgv("delete", { kind: "backups" }, ctx).argv).toEqual(["delete", "--dir", dir, "--", "backups"]);
    expect(buildArgv("delete", { kind: "activity-log", confirm: true }, ctx).argv).toEqual([
      "delete",
      "--dir",
      dir,
      "--yes",
      "--",
      "activity-log",
    ]);
    expect(() => buildArgv("delete", { kind: "memories" }, ctx)).toThrow();
  });
});
