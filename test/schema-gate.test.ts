/**
 * The unrestarted MCP server, and what keeps it from touching a store a newer
 * build has migrated underneath it (roadmap E, owner decisions 2026-09-23).
 *
 * A host starts the MCP server once per session and keeps it; the hooks are
 * fresh processes at every event. After an upgrade the hooks run the new build
 * and the server keeps the one it loaded (LAUNCH-STATUS I36), and `SCHEMA_AHEAD`
 * is decided at OPEN — which this server did before the migration. So:
 *
 *   1. THE RULE. The server re-reads both schema stamps on every tool call and,
 *      if either is ahead of its code, EVERY tool refuses with one sentence and
 *      touches nothing. Proved the way the hazard happens: the bump is made from
 *      a SEPARATE connection after the server has opened the store, and "nothing
 *      was written" is read from that outside connection — row counts in every
 *      table of both files, the `events` table, and `PRAGMA data_version`, which
 *      moves when any OTHER connection commits.
 *   2. THE NOTICE. The server leaves its build in the session registry at
 *      launch; the hook, on the installed build, compares every turn and says
 *      "Counterparts was updated" once per session.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CACHE_SCHEMA_VERSION,
  SCHEMA_VERSION,
  Store,
  paths,
} from "../src/core/store/index.js";
import { openDb } from "../src/core/store/db.js";
import type { Db } from "../src/core/store/db.js";
import { TOOL_NAMES, openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import {
  SCHEMA_UNREADABLE_REFUSAL,
  STALE_SERVER_REFUSAL,
  STORE_BUSY_REFUSAL,
  schemaAhead,
} from "../src/adapters/mcp/server.js";
import {
  CHANGED_NOTICE,
  RECONNECT_REMEDY,
  SERVER_STALE_MS,
  UPDATE_NOTICE,
  canonicalScope,
  decideUpdateNotice,
  forgetServerLaunch,
  installedBuild,
  installedVersion,
  markNothingNew,
  markUpdateNoticeShown,
  pidAlive,
  pruneSessions,
  readServerRecords,
  readSession,
  recordServerLaunch,
  recordSession,
  refreshServerLaunch,
  sameBuild,
  serverIsNewer,
  serverRecordPath,
  sessionPath,
  sessionsDir,
  stampSessionOpened,
} from "../src/adapters/sessions.js";
import type { BuildStamp } from "../src/adapters/sessions.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { ClaudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import { ENVELOPE_MAX_CHARS, hostDelivery } from "../src/adapters/claude-code/bin/hook.js";

const SESSION = "sess_gate_1";

let dir: string;
let projectDir: string;
let scopesDir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-gate-"));
  projectDir = canonicalScope(mkdtempSync(join(tmpdir(), "counterparts-gate-project-")));
  scopesDir = mkdtempSync(join(tmpdir(), "counterparts-gate-scopes-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(scopesDir, { recursive: true, force: true });
});

function server(over: Parameters<typeof openServer>[0] = {}): McpServer {
  const s = openServer({
    dir,
    session: SESSION,
    scope: projectDir,
    owner: true,
    scopesFile: join(scopesDir, "scopes.json"),
    ...over,
  });
  open.push(s.counterpart);
  return s;
}

/** A second connection, the way another process would hold the file. */
function outside(path: string): Db {
  const db = openDb(path);
  open.push(db);
  return db;
}

/** Everything a write could move, read from OUTSIDE the server's handles. */
function census(ops: Db, cache: Db): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [label, db] of [["ops", ops], ["cache", cache]] as const) {
    const tables = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((r) => r.name);
    for (const t of tables) {
      out[`${label}.${t}`] = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`)?.n ?? -1;
    }
    // Moves whenever ANOTHER connection commits to this file — the one
    // measurement that catches a write that happened to leave counts alone.
    out[`${label}.data_version`] = db.get<{ data_version: number }>("PRAGMA data_version")?.data_version ?? -1;
  }
  out["ops.events.maxRowid"] = ops.get<{ m: number | null }>("SELECT MAX(rowid) AS m FROM events")?.m ?? 0;
  return out;
}

/** Every file under the data dir OUTSIDE the two databases: spans, the session
 *  registry, the handle log — the host state a tool could leave behind. */
function hostFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (path: string, rel: string): void => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name), rel === "" ? name : `${rel}/${name}`);
      return;
    }
    if (/(^|\/)(counterparts|cache)\.sqlite/.test(rel)) return;
    out[rel] = readFileSync(path, "utf8");
  };
  walk(root, "");
  return out;
}

/**
 * Valid-shaped arguments for every tool — each one of these, on a healthy
 * store, DOES something (the control below proves `note` writes). Keyed by
 * `TOOL_NAMES`, so a tool added without an entry fails the lookup, not silently.
 */
const ARGS: Record<string, Record<string, unknown>> = {
  note: { text: "The reservoir loop is four miles and takes forty minutes at an easy pace.", salience: 0.6 },
  recall: { question: "how long is the reservoir loop" },
  status: {},
  session_end: {
    session: SESSION,
    memories: [{ content: "Decided the notice shows once per session, never every turn." }],
    handoff: "Working on the schema gate.",
  },
  chapter: { session: SESSION, text: "Chapter one: the server learned to ask before it touched anything." },
  scope: { mode: "off", note: "should never be written" },
  self_page: { body: "## Core\n\nI check the store's version before I touch it.\n\n## Lately\n\nA gate." },
};

function seed(s: McpServer): void {
  for (const body of [
    "The garage door opener needs a new battery soon.",
    "Prefers dense espresso over filter coffee at home.",
    "The library closes early on Sundays now.",
  ]) {
    s.counterpart.store.put({ type: "memory", kind: "fact", body });
  }
}

async function assertEveryToolRefuses(s: McpServer, ops: Db, cache: Db, reason: string, detail: string): Promise<void> {
  const before = census(ops, cache);
  const filesBefore = hostFiles(dir);
  for (const name of TOOL_NAMES) {
    const args = ARGS[name];
    expect(args).toBeDefined();
    const result = await s.call(name, args ?? {});
    const p = result.structuredContent;
    expect({ name, isError: result.isError, reason: p["reason"], tool: p["tool"], detail: p["detail"] }).toEqual({
      name,
      isError: true,
      reason,
      tool: name,
      detail,
    });
  }
  expect(census(ops, cache)).toEqual(before);
  expect(hostFiles(dir)).toEqual(filesBefore);
  // `scope` refused before its body ran, so the registry it would have written
  // does not exist.
  expect(existsSync(join(scopesDir, "scopes.json"))).toBe(false);
}

// ── the rule ────────────────────────────────────────────────────────────────

describe("the schema gate: a store a newer build migrated refuses every tool", () => {
  test("a STORE stamp bumped from outside, after the server opened it, refuses all seven tools by name and writes nothing", async () => {
    const s = server();
    seed(s);
    const ops = outside(paths.operational(dir));
    const cache = outside(paths.cache(dir));
    ops.run("UPDATE meta SET value = ? WHERE key = 'schemaVersion'", String(SCHEMA_VERSION + 1));

    await assertEveryToolRefuses(s, ops, cache, "schema-ahead", STALE_SERVER_REFUSAL);
    const ahead = s.events("mcp.schema.ahead");
    expect(ahead.length).toBe(TOOL_NAMES.length);
    expect(ahead[0]?.data?.["store"]).toBe(String(SCHEMA_VERSION + 1));
    // The structured half names which box and by how much.
    const one = (await s.call("status", {})).structuredContent;
    expect(one["store"]).toEqual({ expected: SCHEMA_VERSION, found: String(SCHEMA_VERSION + 1), ahead: true });
    expect(one["cache"]).toEqual({ expected: CACHE_SCHEMA_VERSION, found: String(CACHE_SCHEMA_VERSION), ahead: false });
  });

  test("a CACHE stamp bumped from outside refuses the same way", async () => {
    const s = server();
    seed(s);
    const ops = outside(paths.operational(dir));
    const cache = outside(paths.cache(dir));
    cache.run("UPDATE cache_meta SET value = ? WHERE key = 'schemaVersion'", String(CACHE_SCHEMA_VERSION + 1));

    await assertEveryToolRefuses(s, ops, cache, "schema-ahead", STALE_SERVER_REFUSAL);
    const one = (await s.call("recall", ARGS["recall"] ?? {})).structuredContent;
    expect(one["cache"]).toEqual({ expected: CACHE_SCHEMA_VERSION, found: String(CACHE_SCHEMA_VERSION + 1), ahead: true });
  });

  test("the gate is read per call, not latched: put the stamp back and the same tool writes (the control)", async () => {
    const s = server();
    seed(s);
    const ops = outside(paths.operational(dir));
    const cache = outside(paths.cache(dir));
    ops.run("UPDATE meta SET value = ? WHERE key = 'schemaVersion'", String(SCHEMA_VERSION + 1));
    expect((await s.call("note", ARGS["note"] ?? {})).structuredContent["reason"]).toBe("schema-ahead");

    ops.run("UPDATE meta SET value = ? WHERE key = 'schemaVersion'", String(SCHEMA_VERSION));
    const before = census(ops, cache);
    const noted = await s.call("note", ARGS["note"] ?? {});
    expect(noted.structuredContent["stored"]).toBe(true);
    // The census is SENSITIVE: the same call on a current store moves it. A
    // census that could not see this write could not see a leak either.
    const after = census(ops, cache);
    expect(after["ops.memories"]).toBe((before["ops.memories"] as number) + 1);
    expect(after["ops.data_version"]).not.toBe(before["ops.data_version"]);
  });

  test("the control for all seven: on a current store the same calls each do their work", async () => {
    const s = server();
    seed(s);
    const ops = outside(paths.operational(dir));
    const cache = outside(paths.cache(dir));
    const before = census(ops, cache);
    const filesBefore = hostFiles(dir);
    // `scope` last: it switches the directory off, and every tool after it
    // would then refuse `scope-off` — a refusal, but not this gate's.
    const order = [...TOOL_NAMES.filter((n) => n !== "scope"), "scope"];
    for (const name of order) {
      const result = await s.call(name, ARGS[name] ?? {});
      expect({ name, isError: result.isError ?? false }).toEqual({ name, isError: false });
    }
    expect(census(ops, cache)).not.toEqual(before);
    expect(hostFiles(dir)).not.toEqual(filesBefore);
    expect(existsSync(join(scopesDir, "scopes.json"))).toBe(true);
  });

  test("BEHIND keeps today's behaviour: an older stamp is not refused", async () => {
    const s = server();
    seed(s);
    const ops = outside(paths.operational(dir));
    ops.run("UPDATE meta SET value = ? WHERE key = 'schemaVersion'", String(SCHEMA_VERSION - 1));
    const status = await s.call("status", {});
    expect(status.isError).toBeUndefined();
    expect(s.events("mcp.schema.ahead")).toHaveLength(0);
  });

  test("a stamp that cannot be read refuses under its own name and writes nothing", async () => {
    const s = server();
    seed(s);
    const ops = outside(paths.operational(dir));
    const cache = outside(paths.cache(dir));
    // A cache whose meta table another build dropped: the read throws.
    cache.exec("DROP TABLE cache_meta");
    await assertEveryToolRefuses(s, ops, cache, "schema-unreadable", SCHEMA_UNREADABLE_REFUSAL);
    expect(s.events("mcp.schema.unreadable").length).toBe(TOOL_NAMES.length);
  });

  test("the gate runs before the observer stand-down and before the scope gate", async () => {
    Store.open({ dir }).close(); // an instrument cannot open a store nobody made
    const s = server({ observer: true });
    const ops = outside(paths.operational(dir));
    ops.run("UPDATE meta SET value = ? WHERE key = 'schemaVersion'", String(SCHEMA_VERSION + 1));
    const r = await s.call("note", ARGS["note"] ?? {});
    expect(r.structuredContent["reason"]).toBe("schema-ahead");
    expect(s.events("mcp.observer.standdown")).toHaveLength(0);
  });

  test("each refusal is one line; only the stale one says 'to load it'", () => {
    for (const line of [STALE_SERVER_REFUSAL, SCHEMA_UNREADABLE_REFUSAL, STORE_BUSY_REFUSAL]) {
      expect(line.includes("\n")).toBe(false);
    }
    expect(STALE_SERVER_REFUSAL.endsWith(RECONNECT_REMEDY)).toBe(true);
    expect(SCHEMA_UNREADABLE_REFUSAL.includes("to load it")).toBe(false);
    expect(STORE_BUSY_REFUSAL.includes("Reconnect")).toBe(false);
  });

  test("a LOCKED store is a retry, not a reconnect — told apart from an unreadable stamp", async () => {
    const s = server();
    const store = s.counterpart.store as unknown as { schemaVersions: () => unknown };
    store.schemaVersions = () => {
      throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    };
    const busy = (await s.call("status", {})).structuredContent;
    expect({ reason: busy["reason"], detail: busy["detail"] }).toEqual({ reason: "store-busy", detail: STORE_BUSY_REFUSAL });
    store.schemaVersions = () => {
      throw new Error("no such table: cache_meta");
    };
    const broken = (await s.call("status", {})).structuredContent;
    expect(broken["reason"]).toBe("schema-unreadable");
  });

  test("recall asks again AFTER its embedding wait: a migration during the round-trip is not recalled past", async () => {
    const ops = outside(paths.operational(dir));
    let seen = "";
    const s = server({
      embedder: {
        vector: (): Promise<number[] | null> => {
          // The migration lands WHILE the question is being embedded.
          ops.run("UPDATE meta SET value = ? WHERE key = 'schemaVersion'", String(SCHEMA_VERSION + 1));
          seen = "embedded";
          return Promise.resolve([0.1, 0.2, 0.3]);
        },
      },
    });
    seed(s);
    const cache = outside(paths.cache(dir));
    const before = census(ops, cache);
    const r = await s.call("recall", ARGS["recall"] ?? {});
    expect(seen).toBe("embedded");
    expect({ reason: r.structuredContent["reason"], tool: r.structuredContent["tool"] }).toEqual({
      reason: "schema-ahead",
      tool: "recall",
    });
    const after = census(ops, cache);
    // The stamp is the one write, and it was ours; not one event row was added.
    expect(after["ops.events"]).toBe(before["ops.events"]);
    expect(after["ops.events.maxRowid"]).toBe(before["ops.events.maxRowid"]);
    expect(after["ops.memories"]).toBe(before["ops.memories"]);
  });

  test("schemaAhead: only a plain integer above the code is ahead", () => {
    expect(schemaAhead(String(SCHEMA_VERSION + 1), SCHEMA_VERSION)).toBe(true);
    expect(schemaAhead(String(SCHEMA_VERSION), SCHEMA_VERSION)).toBe(false);
    expect(schemaAhead(String(SCHEMA_VERSION - 1), SCHEMA_VERSION)).toBe(false);
    expect(schemaAhead(null, SCHEMA_VERSION)).toBe(false);
    expect(schemaAhead("7a", SCHEMA_VERSION)).toBe(false);
    expect(schemaAhead("", SCHEMA_VERSION)).toBe(false);
  });

  test("Store.schemaVersions reads both stamps and writes nothing, under observer too", () => {
    const writer = Store.open({ dir });
    open.push(writer);
    expect(writer.schemaVersions()).toEqual({ store: String(SCHEMA_VERSION), cache: String(CACHE_SCHEMA_VERSION) });
    const ops = outside(paths.operational(dir));
    const before = ops.get<{ data_version: number }>("PRAGMA data_version")?.data_version;
    const reader = Store.open({ dir, observer: true });
    open.push(reader);
    for (let i = 0; i < 50; i++) reader.schemaVersions();
    expect(ops.get<{ data_version: number }>("PRAGMA data_version")?.data_version).toBe(before);
  });

  test("the per-call read is sub-millisecond", () => {
    const s = Store.open({ dir });
    open.push(s);
    s.schemaVersions(); // prepare once
    const n = 5_000;
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < n; i++) s.schemaVersions();
    const meanMs = (Bun.nanoseconds() - t0) / n / 1e6;
    // Measured at a few microseconds (NOTES.md); the bound is the requirement,
    // generous on purpose so a loaded CI machine does not make it flaky.
    expect(meanMs).toBeLessThan(1);
  });
});

// ── the launch record ───────────────────────────────────────────────────────

describe("the server's launch record", () => {
  test("recordLaunch writes the build this process runs, under the registry, and forgetLaunch removes it", () => {
    const s = server();
    const rec = s.recordLaunch({ pid: 424242, hostPid: 777 });
    expect(rec).not.toBeNull();
    const path = serverRecordPath(dir, 424242) ?? "";
    expect(existsSync(path)).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(onDisk["pid"]).toBe(424242);
    expect(onDisk["hostPid"]).toBe(777);
    expect(onDisk["scope"]).toBe(projectDir);
    expect(onDisk["build"]).toEqual(installedBuild());
    expect(installedBuild()).toEqual({
      version: (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version,
      storeSchema: SCHEMA_VERSION,
      cacheSchema: CACHE_SCHEMA_VERSION,
    });
    s.forgetLaunch();
    expect(existsSync(path)).toBe(false);
  });

  test("an observer server records nothing", () => {
    Store.open({ dir }).close();
    const s = server({ observer: true });
    expect(s.recordLaunch({ pid: 424243 })).toBeNull();
    expect(existsSync(sessionsDir(dir))).toBe(false);
  });

  test("a server launched in a directory set off or paused leaves nothing under sessions/", async () => {
    for (const mode of ["off", "pause"] as const) {
      const first = server();
      expect((await first.call("scope", { mode })).isError).toBeUndefined();
      const s = server();
      expect(s.recordLaunch({ pid: 424244, heartbeatMs: 0 })).toBeNull();
      expect(existsSync(sessionsDir(dir))).toBe(false);
      expect(s.events("mcp.launch.recorded")[0]?.data?.["reason"]).toBe("scope-off");
      await first.call("scope", { mode: "on" });
    }
    // And switched back on, the next launch records as before.
    const on = server();
    expect(on.recordLaunch({ pid: 424245, heartbeatMs: 0 })).not.toBeNull();
    on.forgetLaunch();
  });

  test("the heartbeat touches the record, rewrites one a prune removed, and never makes a directory", async () => {
    const s = server();
    const rec = s.recordLaunch({ pid: 424246, heartbeatMs: 20 });
    open.push({ close: () => s.forgetLaunch() });
    expect(rec).not.toBeNull();
    const path = serverRecordPath(dir, 424246) ?? "";
    const old = new Date(Date.now() - 2 * SERVER_STALE_MS);
    utimesSync(path, old, old);
    await Bun.sleep(80);
    expect(Date.now() - statSync(path).mtimeMs).toBeLessThan(SERVER_STALE_MS);
    rmSync(path);
    await Bun.sleep(80);
    expect(existsSync(path)).toBe(true);
    s.forgetLaunch();
    expect(existsSync(path)).toBe(false);
    // With the data dir gone, a beat writes nothing and makes nothing.
    const gone = join(dir, "gone");
    expect(refreshServerLaunch(gone, { ...(rec as NonNullable<typeof rec>) })).toBe(false);
    expect(existsSync(gone)).toBe(false);
  });

  test("no session id can name a server record", () => {
    // `@` is outside the session-id alphabet, so `session_end` / `readSession`
    // can never reach this file whatever a model passes.
    recordServerLaunch(dir, { scope: projectDir, build: installedBuild(), pid: 5150 });
    expect(readSession(dir, "mcp-server@5150")).toBeNull();
    expect(readSession(dir, "mcp-server")).toBeNull();
  });
});

// ── the notice ──────────────────────────────────────────────────────────────

const STALE: BuildStamp = { version: "0.0.1", storeSchema: SCHEMA_VERSION, cacheSchema: CACHE_SCHEMA_VERSION };
const ALL_ALIVE = (): boolean => true;

/** A session as SessionStart leaves it on this build: recorded, and stamped
 *  (`opened`) — unless `stamped: false`, a session that opened before E. */
function liveSession(id = "s1", scope = projectDir, stamped = true): void {
  recordSession(dir, { sessionId: id, scope, phase: "start", at: Date.now() });
  if (stamped) stampSessionOpened(dir, id, { build: installedBuild(), hookPpid: 3 });
}

/** One turn of the hook's rule, as `bin/hook.ts` runs it: decide, then mark,
 *  then show only if the mark landed. */
function turnOf(sessionId: string, hostPid = 2, alive: (pid: number) => boolean = ALL_ALIVE): string | null {
  const d = decideUpdateNotice(dir, { sessionId, installed: installedBuild(), hostPid, alive });
  if (d.message === null) return null;
  return markUpdateNoticeShown(dir, sessionId) ? d.message : null;
}

describe("the update notice", () => {
  test("fires exactly once on a session whose server records a stale build", () => {
    liveSession();
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: 9001, hostPid: 1 });
    const first = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), hostPid: 2, alive: ALL_ALIVE });
    expect(first).toEqual({ message: UPDATE_NOTICE, reason: "due", matchedBy: "scope", servers: 1, hookPpid: 2 });
    // Deciding writes nothing: the same answer until somebody marks it.
    expect(readSession(dir, "s1")?.updateNoticeShown).toBeUndefined();
    expect(turnOf("s1")).toBe(UPDATE_NOTICE);
    expect(readSession(dir, "s1")?.updateNoticeShown).toBe(true);
    for (let turn = 0; turn < 5; turn++) {
      expect(turnOf("s1")).toBeNull();
      const again = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), hostPid: 2, alive: ALL_ALIVE });
      expect(again).toEqual({ message: null, reason: "already-shown", matchedBy: null, servers: 0, hookPpid: 2 });
    }
    expect(UPDATE_NOTICE).toBe("Counterparts was updated. Run /mcp and Reconnect to load it.");
  });

  test("never fires when the versions match", () => {
    liveSession();
    recordServerLaunch(dir, { scope: projectDir, build: installedBuild(), pid: 9002, hostPid: 1 });
    for (let turn = 0; turn < 3; turn++) {
      const d = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), alive: ALL_ALIVE });
      expect(d.message).toBeNull();
      expect(d.reason).toBe("current");
      expect(turnOf("s1")).toBeNull();
    }
    expect(readSession(dir, "s1")?.updateNoticeShown).toBeUndefined();
  });

  test("a schema move alone is a mismatch; an unreadable version alone is not", () => {
    const installed = installedBuild();
    expect(sameBuild(installed, { ...installed, storeSchema: installed.storeSchema - 1 })).toBe(false);
    expect(sameBuild(installed, { ...installed, cacheSchema: installed.cacheSchema - 1 })).toBe(false);
    expect(sameBuild(installed, { ...installed, version: null })).toBe(true);
    expect(sameBuild(installed, { ...installed, version: "9.9.9" })).toBe(false);
  });

  test("the server started by THIS hook's host decides; other servers in the scope are the fallback", () => {
    liveSession();
    recordServerLaunch(dir, { scope: projectDir, build: installedBuild(), pid: 9101, hostPid: 500 });
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: 9102, hostPid: 600 });
    // This hook's parent started the current server: nothing to say.
    const mine = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), hostPid: 500, alive: ALL_ALIVE });
    expect({ reason: mine.reason, matchedBy: mine.matchedBy }).toEqual({ reason: "current", matchedBy: "host" });
    // A hook whose parent started neither (a shell in between): any stale
    // server in the scope makes it due.
    const unknown = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), hostPid: 999, alive: ALL_ALIVE });
    expect({ reason: unknown.reason, matchedBy: unknown.matchedBy, servers: unknown.servers }).toEqual({
      reason: "due",
      matchedBy: "scope",
      servers: 2,
    });
  });

  test("a dead server, or one in another scope, is not this session's", () => {
    liveSession();
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: 9201, hostPid: 1 });
    const dead = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), alive: () => false });
    expect(dead.reason).toBe("no-server");
    const elsewhere = mkdtempSync(join(tmpdir(), "counterparts-gate-elsewhere-"));
    try {
      liveSession("s2", elsewhere);
      const other = decideUpdateNotice(dir, { sessionId: "s2", installed: installedBuild(), alive: ALL_ALIVE });
      expect(other.reason).toBe("no-server");
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("a broken or absent record never throws and never speaks", () => {
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: 9301, hostPid: 1 });
    // No session record at all: nowhere to mark "shown", so nothing is due.
    expect(decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), alive: ALL_ALIVE }).reason).toBe("no-record");
    expect(markUpdateNoticeShown(dir, "s1")).toBe(false);
    // A torn session record.
    writeFileSync(join(sessionsDir(dir), "s1.json"), "{ not json");
    expect(turnOf("s1")).toBeNull();
    // A torn server record beside a good session: ignored, not fatal.
    liveSession("s3");
    writeFileSync(join(sessionsDir(dir), "mcp-server@9302.json"), "[]");
    writeFileSync(join(sessionsDir(dir), "mcp-server@9303.json"), "{");
    expect(readServerRecords(dir).map((r) => r.pid)).toEqual([9301]);
    // A data dir whose `sessions` is a FILE: every read fails, nothing throws.
    const odd = mkdtempSync(join(tmpdir(), "counterparts-gate-odd-"));
    try {
      writeFileSync(join(odd, "sessions"), "not a directory");
      expect(decideUpdateNotice(odd, { sessionId: "s1", installed: installedBuild() }).message).toBeNull();
      expect(markUpdateNoticeShown(odd, "s1")).toBe(false);
    } finally {
      rmSync(odd, { recursive: true, force: true });
    }
  });

  test("a mark that will not write is silence, not a notice every turn", () => {
    liveSession();
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: 9401, hostPid: 1 });
    chmodSync(sessionsDir(dir), 0o500);
    try {
      expect(markUpdateNoticeShown(dir, "s1")).toBe(false);
      expect(turnOf("s1")).toBeNull();
    } finally {
      chmodSync(sessionsDir(dir), 0o700);
    }
  });

  test("the mark survives the hooks rewriting the record at later phases", () => {
    liveSession();
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: 9501, hostPid: 1 });
    expect(turnOf("s1")).toBe(UPDATE_NOTICE);
    recordSession(dir, { sessionId: "s1", scope: projectDir, phase: "boundary" });
    recordSession(dir, { sessionId: "s1", scope: projectDir, phase: "boundary", wakeChecked: true });
    expect(readSession(dir, "s1")?.updateNoticeShown).toBe(true);
    expect(decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), alive: ALL_ALIVE }).reason).toBe("already-shown");
  });

  test("a session that OPENED before any build stamped it: one notice, even with no server record at all", () => {
    liveSession("s1", projectDir, false);
    const d = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), alive: ALL_ALIVE });
    expect({ message: d.message, reason: d.reason, matchedBy: d.matchedBy }).toEqual({
      message: UPDATE_NOTICE,
      reason: "due",
      matchedBy: "unstamped",
    });
    expect(turnOf("s1")).toBe(UPDATE_NOTICE);
    expect(turnOf("s1")).toBeNull();
  });

  test("a stamped session with no server record: nothing", () => {
    liveSession("s1");
    const d = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), alive: ALL_ALIVE });
    expect({ message: d.message, reason: d.reason }).toEqual({ message: null, reason: "no-server" });
  });

  test("an unstamped session whose OWN host started a current server is not told (the host match comes first)", () => {
    liveSession("s1", projectDir, false);
    recordServerLaunch(dir, { scope: projectDir, build: installedBuild(), pid: 9701, hostPid: 700 });
    const d = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), hostPid: 700, alive: ALL_ALIVE });
    expect({ reason: d.reason, matchedBy: d.matchedBy }).toEqual({ reason: "current", matchedBy: "host" });
  });

  test("a DOWNGRADE says 'changed to an older version', not 'updated'", () => {
    liveSession();
    const installed = installedBuild();
    const newer: BuildStamp = { ...installed, storeSchema: installed.storeSchema + 1 };
    expect(serverIsNewer(newer, installed)).toBe(true);
    expect(serverIsNewer(STALE, installed)).toBe(false);
    expect(serverIsNewer({ ...installed, version: "99.0.0" }, installed)).toBe(true);
    recordServerLaunch(dir, { scope: projectDir, build: newer, pid: 9801, hostPid: 1 });
    expect(turnOf("s1")).toBe(CHANGED_NOTICE);
  });

  test("a record whose heartbeat went stale is not believed, whatever its pid says", () => {
    liveSession();
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: 9901, hostPid: 1 });
    const path = serverRecordPath(dir, 9901) ?? "";
    const old = new Date(Date.now() - SERVER_STALE_MS - 60_000);
    utimesSync(path, old, old);
    const d = decideUpdateNotice(dir, { sessionId: "s1", installed: installedBuild(), alive: ALL_ALIVE });
    expect(d.reason).toBe("no-server");
    // And the next SessionStart prunes it even though "its" pid (ours) runs.
    const ours = serverRecordPath(dir, process.pid) ?? "";
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: process.pid, hostPid: 1 });
    utimesSync(ours, old, old);
    pruneSessions(dir);
    expect(existsSync(ours)).toBe(false);
  });

  test("the marks merge into the record as it is on disk: a field this build does not know survives them", () => {
    liveSession("s1", projectDir, false);
    const path = sessionPath(dir, "s1") ?? "";
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...raw, fromANewerHook: { keep: true } }));
    expect(stampSessionOpened(dir, "s1", { build: installedBuild(), hookPpid: 5 })).toBe(true);
    expect(markUpdateNoticeShown(dir, "s1")).toBe(true);
    // And the MCP server's own mark (#186), the write most likely to come from
    // an older build than the record's.
    expect(markNothingNew(dir, "s1", 12_345)?.nothingNewAt).toBe(12_345);
    const after = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(after["fromANewerHook"]).toEqual({ keep: true });
    expect(after["nothingNewAt"]).toBe(12_345);
    expect(after["updateNoticeShown"]).toBe(true);
    expect(after["opened"]).toEqual({ build: installedBuild(), hookPpid: 5 });
    expect(after["lastBoundaryAt"]).toBe(raw["lastBoundaryAt"]);
    // A torn file is not "merged into": nothing written, nothing created.
    writeFileSync(path, "{ torn");
    expect(markUpdateNoticeShown(dir, "s1")).toBe(false);
    expect(markNothingNew(dir, "s1", 1)).toBeNull();
    expect(stampSessionOpened(dir, "nobody", { build: installedBuild(), hookPpid: 5 })).toBe(false);
    expect(existsSync(sessionPath(dir, "nobody") ?? "")).toBe(false);
  });

  test("the stamp is carried by every later phase the hooks write", () => {
    liveSession();
    recordSession(dir, { sessionId: "s1", scope: projectDir, phase: "boundary" });
    recordSession(dir, { sessionId: "s1", scope: projectDir, phase: "start" });
    expect(readSession(dir, "s1")?.opened).toEqual({ build: installedBuild(), hookPpid: 3 });
  });

  test("marking does not refresh the session's liveness clock", () => {
    recordSession(dir, { sessionId: "s1", scope: projectDir, phase: "start", at: 1_000 });
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: 9601, hostPid: 1 });
    expect(turnOf("s1")).toBe(UPDATE_NOTICE);
    expect(readSession(dir, "s1")?.lastBoundaryAt).toBe(1_000);
  });
});

describe("the hook's door to the notice (ClaudeCodeAdapter#updateNotice / #markUpdateNotice)", () => {
  function hookAdapter(observer = false): ClaudeCodeAdapter {
    if (observer) Store.open({ dir }).close();
    const a = openAdapter(
      { dataDir: dir, owner: true, ...(observer ? { observer: true } : {}) },
      { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }) },
    );
    open.push(a.counterpart);
    return a;
  }
  const turn = { sessionId: "s1", scope: projectDir, prompt: "hello", at: "2026-09-23" };

  test("due once on a stale server, then never again once marked, and the ring says so", () => {
    liveSession();
    // Alive (this test's own pid), in this scope, started by some OTHER host:
    // the scope fallback, which is what a hook behind a shell sees.
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: process.pid, hostPid: 1 });
    const a = hookAdapter();
    expect(a.updateNotice(turn)).toBe(UPDATE_NOTICE);
    expect(a.markUpdateNotice(turn)).toBe(true);
    for (let i = 0; i < 3; i++) expect(a.updateNotice(turn)).toBeNull();
    // A FRESH process — the next turn's hook — also stays quiet.
    expect(hookAdapter().updateNotice(turn)).toBeNull();
    expect(a.events("adapter.update.notice").map((e) => e.data)).toEqual([
      { reason: "due", matchedBy: "scope", servers: 1, hookPpid: process.ppid },
      { reason: "shown" },
    ]);
  });

  test("never when the server runs the installed build", () => {
    liveSession();
    recordServerLaunch(dir, { scope: projectDir, build: installedBuild(), pid: process.pid, hostPid: 1 });
    const a = hookAdapter();
    for (let i = 0; i < 3; i++) expect(a.updateNotice(turn)).toBeNull();
    expect(a.events("adapter.update.notice")).toHaveLength(0);
    expect(readSession(dir, "s1")?.updateNoticeShown).toBeUndefined();
  });

  test("a broken record never blocks the turn: null, and userPromptSubmit still answers", () => {
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: process.pid, hostPid: 1 });
    mkdirSync(sessionsDir(dir), { recursive: true });
    writeFileSync(join(sessionsDir(dir), "s1.json"), "{ torn");
    const a = hookAdapter();
    expect(a.updateNotice(turn)).toBeNull();
    expect(a.markUpdateNotice(turn)).toBe(false);
    expect(a.userPromptSubmit(turn).ok).toBe(true);
  });

  test("an observer is never told and marks nothing", () => {
    liveSession();
    recordServerLaunch(dir, { scope: projectDir, build: STALE, pid: process.pid, hostPid: 1 });
    const watcher = hookAdapter(true);
    expect(watcher.updateNotice(turn)).toBeNull();
    expect(watcher.markUpdateNotice(turn)).toBe(false);
    expect(readSession(dir, "s1")?.updateNoticeShown).toBeUndefined();
  });
});

describe("hostDelivery at a prompt — the update notice's channel", () => {
  test("no notice: exactly what a prompt printed before, plain text or nothing", () => {
    expect(hostDelivery("user-prompt-submit", { injection: "recall", ask: null }, {}).stdout).toBe("recall");
    expect(hostDelivery("user-prompt-submit", { injection: "recall", ask: null }, {}, null).stdout).toBe("recall");
    expect(hostDelivery("user-prompt-submit", { injection: "", ask: null }, {}).stdout).toBe("");
  });

  test("a notice with recall: one JSON object, the recall byte for byte in additionalContext", () => {
    const recall = "<counterparts-recall>\nthe reservoir loop is four miles\n</counterparts-recall>";
    const out = hostDelivery("user-prompt-submit", { injection: recall, ask: null }, {}, UPDATE_NOTICE);
    expect(out.dropped).toBeNull();
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({
      systemMessage: UPDATE_NOTICE,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: recall },
    });
  });

  test("a notice with no recall: the systemMessage alone", () => {
    const out = hostDelivery("user-prompt-submit", { injection: "", ask: null }, {}, UPDATE_NOTICE);
    expect(JSON.parse(out.stdout)).toEqual({ systemMessage: UPDATE_NOTICE });
  });

  test("recall that leaves no room keeps the recall whole and reports the notice dropped", () => {
    const recall = `${"r".repeat(79)}\n`.repeat(118);
    const out = hostDelivery("user-prompt-submit", { injection: recall, ask: null }, {}, UPDATE_NOTICE);
    expect(out.stdout).toBe(recall);
    expect(out.dropped?.noticeChars).toBe(UPDATE_NOTICE.length);
    expect(out.dropped?.envelopeChars).toBeGreaterThan(ENVELOPE_MAX_CHARS);
  });

  test("no other event carries it", () => {
    expect(hostDelivery("stop", { injection: null, ask: null }, {}, UPDATE_NOTICE).stdout).toBe("");
    expect(hostDelivery("session-end", { injection: "", ask: null }, {}, UPDATE_NOTICE).stdout).toBe("");
  });
});

describe("pruning server records", () => {
  test("a dead server's record goes whatever its age; a live one stays whatever its age", () => {
    mkdirSync(sessionsDir(dir), { recursive: true });
    recordServerLaunch(dir, { scope: projectDir, build: installedBuild(), pid: process.pid, hostPid: 1 });
    // A pid that is not running: well above any live pid on an idle test box,
    // and checked rather than assumed.
    let deadPid = 4_000_000;
    while (pidAlive(deadPid)) deadPid += 1;
    recordServerLaunch(dir, { scope: projectDir, build: installedBuild(), pid: deadPid, hostPid: 1 });
    // Far in the future, so the AGE rule alone would keep everything.
    const removed = pruneSessions(dir, 0);
    expect(removed).toBe(1);
    expect(readServerRecords(dir).map((r) => r.pid)).toEqual([process.pid]);
    // And in the far future the live one still stays.
    pruneSessions(dir, Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(readServerRecords(dir).map((r) => r.pid)).toEqual([process.pid]);
    forgetServerLaunch(dir, process.pid);
    expect(readServerRecords(dir)).toEqual([]);
  });

  test("the package version is read from the manifest beside the code", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(installedVersion()).toBe(pkg.version);
  });
});
