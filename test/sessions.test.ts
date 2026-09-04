/**
 * `adapters/sessions.ts` — the live-session registry, on its own.
 *
 * It is the corroboration the MCP server's lazy bind rests on, so what is tested
 * here is exactly what the bind trusts: that a record says who, where and when;
 * that liveness is a function of the last boundary and nothing else; that an id
 * from a model cannot become a path; and that nothing in the file ever throws at
 * a caller, because both of its callers are forbidden to fail their host.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp dir per test, removed after.
 * No store is opened at all — the registry is plain files under the data dir.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SESSIONS_DIR,
  SESSION_PRUNE_MS,
  SESSION_TTL_MS,
  canonicalScope,
  isLive,
  isSessionId,
  pruneSessions,
  readSession,
  recordSession,
  sameScope,
  sessionPath,
  sessionsDir,
} from "../src/adapters/sessions.js";
import type { SessionRecord } from "../src/adapters/sessions.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-sessions-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const T0 = 1_800_000_000_000;

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: "s1",
    scope: "/proj/alpha",
    startedAt: T0,
    lastBoundaryAt: T0,
    endedAt: null,
    ...over,
  };
}

describe("write and read", () => {
  test("a start writes the whole record, scope resolved, under <dataDir>/sessions", () => {
    const written = recordSession(dir, { sessionId: "s1", scope: "/proj/alpha", phase: "start", at: T0 });
    expect(written).toEqual(record());
    expect(readSession(dir, "s1")).toEqual(record());
    expect(readdirSync(sessionsDir(dir))).toEqual(["s1.json"]);
    // One directory name, one spelling, and it is the one `store/paths.ts`
    // classifies — an unclassified top-level path fails the store at open.
    expect(sessionsDir(dir)).toBe(join(dir, SESSIONS_DIR));
  });

  test("a boundary refreshes the clock and NOTHING else — not the scope, not the start", () => {
    recordSession(dir, { sessionId: "s1", scope: "/proj/alpha", phase: "start", at: T0 });
    // A hook firing from a git worktree must not move the project out from
    // under a server that already matched against it.
    recordSession(dir, { sessionId: "s1", scope: "/proj/alpha/.worktrees/wt", phase: "boundary", at: T0 + 60_000 });
    expect(readSession(dir, "s1")).toEqual(record({ lastBoundaryAt: T0 + 60_000 }));
  });

  test("a boundary CREATES when there is no record — sessions already running are bindable", () => {
    // The deployment case: this ships mid-session, so the only hook that will
    // ever fire for those sessions is Stop.
    const written = recordSession(dir, { sessionId: "s_running", scope: "/proj/alpha", phase: "boundary", at: T0 });
    expect(written).toEqual(record({ sessionId: "s_running" }));
    expect(isLive(written as SessionRecord, T0)).toBe(true);
  });

  test("an end is one-way: a later boundary refreshes the clock but never revives the session", () => {
    recordSession(dir, { sessionId: "s1", scope: "/proj/alpha", phase: "start", at: T0 });
    recordSession(dir, { sessionId: "s1", scope: "/proj/alpha", phase: "end", at: T0 + 1_000 });
    expect(readSession(dir, "s1")?.endedAt).toBe(T0 + 1_000);
    recordSession(dir, { sessionId: "s1", scope: "/proj/alpha", phase: "boundary", at: T0 + 2_000 });
    const after = readSession(dir, "s1") as SessionRecord;
    expect(after.endedAt).toBe(T0 + 1_000);
    expect(isLive(after, T0 + 2_000)).toBe(false);
  });

  test("a start after an end resumes the session — the host reuses the id on a resume", () => {
    recordSession(dir, { sessionId: "s1", scope: "/proj/alpha", phase: "end", at: T0 });
    const resumed = recordSession(dir, { sessionId: "s1", scope: "/proj/alpha", phase: "start", at: T0 + 5_000 });
    expect(resumed?.endedAt).toBeNull();
    expect(resumed?.startedAt).toBe(T0);
  });

  test("the write is atomic: no temp file survives, and the record is whole or absent", () => {
    recordSession(dir, { sessionId: "s1", scope: "/proj/alpha", phase: "start", at: T0 });
    expect(readdirSync(sessionsDir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const raw = readFileSync(join(sessionsDir(dir), "s1.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(record());
  });

  test("a half-written or corrupt file reads as ABSENT, never as a live session", () => {
    mkdirSync(sessionsDir(dir), { recursive: true });
    writeFileSync(join(sessionsDir(dir), "s_broken.json"), '{"sessionId":"s_broken","sco', "utf8");
    expect(readSession(dir, "s_broken")).toBeNull();
    // A structurally valid file missing a required field is absent too.
    writeFileSync(join(sessionsDir(dir), "s_thin.json"), '{"sessionId":"s_thin"}', "utf8");
    expect(readSession(dir, "s_thin")).toBeNull();
  });

  test("nothing here throws at a caller — a hook may not fail the host (§5 G2)", () => {
    // The data dir is a FILE: every write below fails at the filesystem.
    const blocked = join(dir, "not-a-dir");
    writeFileSync(blocked, "", "utf8");
    expect(recordSession(blocked, { sessionId: "s1", scope: "/p", phase: "start" })).toBeNull();
    expect(readSession(blocked, "s1")).toBeNull();
    expect(pruneSessions(blocked)).toBe(0);
    // And an unreadable registry directory is silent in both directions.
    const locked = mkdtempSync(join(tmpdir(), "counterparts-locked-"));
    try {
      mkdirSync(sessionsDir(locked));
      chmodSync(sessionsDir(locked), 0o000);
      expect(readSession(locked, "s1")).toBeNull();
      expect(pruneSessions(locked)).toBe(0);
    } finally {
      chmodSync(sessionsDir(locked), 0o700);
      rmSync(locked, { recursive: true, force: true });
    }
  });
});

describe("liveness", () => {
  test("a session is live until the TTL runs out from its LAST BOUNDARY, not its start", () => {
    const old = record({ startedAt: T0 - 10 * SESSION_TTL_MS, lastBoundaryAt: T0 });
    expect(isLive(old, T0)).toBe(true);
    expect(isLive(old, T0 + SESSION_TTL_MS)).toBe(true);
    expect(isLive(old, T0 + SESSION_TTL_MS + 1)).toBe(false);
  });

  test("an ended session is never live, however recent its last boundary", () => {
    expect(isLive(record({ endedAt: T0 }), T0)).toBe(false);
  });

  test("the TTL is four hours — long enough for any think-time, shorter than a day", () => {
    expect(SESSION_TTL_MS).toBe(4 * 60 * 60 * 1000);
    // The property that matters: a session that died last night cannot be
    // claimed into today's memory by a server that outlived it.
    expect(SESSION_TTL_MS).toBeLessThan(24 * 60 * 60 * 1000);
  });
});

describe("scope", () => {
  test("comparison is PHYSICAL: a symlink and its target are one project", () => {
    const target = mkdtempSync(join(tmpdir(), "counterparts-target-"));
    const link = join(dir, "link");
    try {
      symlinkSync(target, link);
      expect(sameScope(link, target)).toBe(true);
      expect(canonicalScope(link)).toBe(canonicalScope(target));
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("a path that does not exist still compares — resolved, not realpathed", () => {
    expect(sameScope("/proj/alpha", "/proj/beta/../alpha")).toBe(true);
    expect(sameScope("/proj/alpha", "/proj/beta")).toBe(false);
  });
});

describe("a session id is a filename, and the MCP path takes it from a model", () => {
  test("traversal, separators and empties are refused before any lookup", () => {
    for (const bad of ["", ".", "..", "../x", "a/b", "a\\b", "a b", "x".repeat(129), "sess$1"]) {
      expect({ id: bad, ok: isSessionId(bad) }).toEqual({ id: bad, ok: false });
      expect(sessionPath(dir, bad)).toBeNull();
      expect(readSession(dir, bad)).toBeNull();
      expect(recordSession(dir, { sessionId: bad, scope: "/p", phase: "start" })).toBeNull();
    }
  });

  test("this host's ids — UUIDs — are accepted", () => {
    expect(isSessionId("7c973b1c-d40a-47e5-92bb-8cdb1823a06d")).toBe(true);
    expect(isSessionId("sess_mcp_1")).toBe(true);
  });

  test("a traversal claim cannot read a file outside the registry", () => {
    writeFileSync(join(dir, "secret.json"), JSON.stringify(record()), "utf8");
    expect(readSession(dir, "../secret")).toBeNull();
  });
});

describe("pruning", () => {
  test("records older than the window are dropped; fresh ones are not", () => {
    recordSession(dir, { sessionId: "s_old", scope: "/p", phase: "end", at: T0 });
    recordSession(dir, { sessionId: "s_new", scope: "/p", phase: "start", at: T0 });
    const stale = new Date(Date.now() - SESSION_PRUNE_MS - 60_000);
    utimesSync(join(sessionsDir(dir), "s_old.json"), stale, stale);
    expect(pruneSessions(dir)).toBe(1);
    expect(readdirSync(sessionsDir(dir))).toEqual(["s_new.json"]);
  });

  test("an absent registry prunes nothing and says nothing", () => {
    expect(pruneSessions(dir)).toBe(0);
  });
});
