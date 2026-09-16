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
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXPANSIONS_FILE,
  EXPANSIONS_KEEP,
  EXPANSIONS_MAX_BYTES,
  EXPANSION_TTL_MS,
  compactExpansions,
  countTranslated,
  expansionsPath,
  expansionSalt,
  expansionsSaltPath,
  handleKey,
  readHandleResolutions,
  recordHandleResolution,
  translateExpansions,
} from "../src/adapters/expansions.js";
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

/** The store's own handle key (G58): the key is salted per store, so a test
 *  that wants to look a record up has to ask the same store for the same salt. */
function saltedKey(handle: string): string {
  return handleKey(handle, expansionSalt(dir) ?? "");
}


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

// ═══════════════════════════════════════════════════════════════════════════
// The handle-resolution log (`adapters/expansions.ts`) — the OTHER note the two
// adapters leave each other, on the same rules: no content on disk, no throw at
// a caller, and a loss that can only cost credit.
// ═══════════════════════════════════════════════════════════════════════════

describe("the handle key is salted, per store (G58)", () => {
  test("the salt is minted once, owner-only, and does not move under a live log", () => {
    const first = expansionSalt(dir);
    expect(first).not.toBeNull();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    // Asking again reads what is there rather than minting a second one: a salt
    // that moved would orphan every key already in the log.
    expect(expansionSalt(dir)).toBe(first);
    expect(statSync(expansionsSaltPath(dir)).mode & 0o777).toBe(0o600);
  });

  test("the same handle keys differently in two stores — the oracle is gone", () => {
    const other = mkdtempSync(join(tmpdir(), "counterparts-sessions-other-"));
    try {
      const here = handleKey("the clinic note", expansionSalt(dir) ?? "");
      const there = handleKey("the clinic note", expansionSalt(other) ?? "");
      expect(here).not.toBe(there);
      // And the unsalted key — the one a guesser could compute — is neither.
      expect(here).not.toBe(handleKey("the clinic note", ""));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("a salt this process cannot have fails CLOSED, on both sides", () => {
    // Mint it, then take it away. An unsalted key written into a salted log
    // would be both a leak and a line nothing could ever match.
    expect(expansionSalt(dir)).not.toBeNull();
    chmodSync(expansionsSaltPath(dir), 0o000);
    try {
      expect(expansionSalt(dir)).toBeNull();
      expect(recordHandleResolution(dir, { handle: "the clinic note", id: "mem_aaaaaaaaaaaa" })).toBe(
        false,
      );
      const read = readHandleResolutions(dir);
      expect(read.ok).toBe(false);
      expect(read.reason).toBe("unreadable");
      expect(read.map.size).toBe(0);
      expect(read.salt).toBe("");
    } finally {
      chmodSync(expansionsSaltPath(dir), 0o600);
    }
  });
});

describe("the handle-resolution log", () => {
  test("a resolution round-trips, and the file holds a HASH rather than the handle", () => {
    expect(recordHandleResolution(dir, { handle: "storage split", id: "mem_abc123abc123", at: T0 })).toBe(true);
    expect(readHandleResolutions(dir, { now: T0 }).map.get(saltedKey("storage split"))).toBe("mem_abc123abc123");
    const raw = readFileSync(expansionsPath(dir), "utf8");
    expect(raw).not.toContain("storage split");
    expect(raw).toContain(saltedKey("storage split"));
    // Inside the registry's own directory, which `store/paths.ts` already
    // classifies — this adds no new top-level name under the data dir.
    expect(expansionsPath(dir)).toBe(join(sessionsDir(dir), EXPANSIONS_FILE));
  });

  test("a handle is matched the way the resolver matches a title: trimmed and case-folded", () => {
    recordHandleResolution(dir, { handle: "Storage Split", id: "mem_abc123abc123", at: T0 });
    expect(readHandleResolutions(dir, { now: T0 }).map.get(saltedKey("  storage split "))).toBe("mem_abc123abc123");
  });

  test("the newest answer wins — a title that moved is not credited to the memory it left", () => {
    recordHandleResolution(dir, { handle: "the split", id: "mem_aaaaaaaaaaaa", at: T0 });
    recordHandleResolution(dir, { handle: "the split", id: "mem_bbbbbbbbbbbb", at: T0 + 1000 });
    expect(readHandleResolutions(dir, { now: T0 + 1000 }).map.get(saltedKey("the split"))).toBe("mem_bbbbbbbbbbbb");
  });

  test("a resolution past the window translates nothing", () => {
    recordHandleResolution(dir, { handle: "the split", id: "mem_aaaaaaaaaaaa", at: T0 });
    expect(readHandleResolutions(dir, { now: T0 + EXPANSION_TTL_MS + 1 }).map.size).toBe(0);
  });

  test("a half-written line is skipped, never thrown over", () => {
    recordHandleResolution(dir, { handle: "the split", id: "mem_aaaaaaaaaaaa", at: T0 });
    appendFileSync(expansionsPath(dir), '{"key":"deadbeef","id":"mem_c\n', "utf8");
    appendFileSync(expansionsPath(dir), '{"key":"","id":"mem_dddddddddddd","at":1}\n', "utf8");
    const live = readHandleResolutions(dir, { now: T0 }).map;
    expect(live.size).toBe(1);
    expect(live.get(saltedKey("the split"))).toBe("mem_aaaaaaaaaaaa");
  });

  test("the log is bounded: it compacts rather than growing without end", () => {
    for (let i = 0; i < 2000; i++) {
      recordHandleResolution(dir, {
        handle: `handle number ${String(i)}`,
        id: `mem_${String(i).padStart(12, "0")}`,
        at: T0,
      });
    }
    expect(statSync(expansionsPath(dir)).size).toBeLessThanOrEqual(EXPANSIONS_MAX_BYTES);
    // The newest resolution survives every compaction — it is the one the next
    // boundary is about to ask for.
    expect(readHandleResolutions(dir, { now: T0 }).map.get(saltedKey("handle number 1999"))).toBe(
      `mem_${"1999".padStart(12, "0")}`,
    );
  });

  test("a refusal is recorded as a SHADOW, and the newest shadow overrides an earlier resolution", () => {
    recordHandleResolution(dir, { handle: "the clinic note", id: "mem_aaaaaaaaaaaa", at: T0 });
    // A later asking was answered with nothing — withheld, unknown, ambiguous.
    expect(recordHandleResolution(dir, { handle: "the clinic note", id: null, at: T0 + 1000 })).toBe(true);
    const live = readHandleResolutions(dir, { now: T0 + 1000 }).map;
    expect(live.get(saltedKey("the clinic note"))).toBeNull();
    // A shadow translates nothing: the handle reaches `reference.ts` as itself.
    expect(translateExpansions(["the clinic note"], live, expansionSalt(dir) ?? "")).toEqual(["the clinic note"]);
    expect(countTranslated(["the clinic note"], live, expansionSalt(dir) ?? "")).toBe(0);
    // A compaction can drop an old key, but never the SHADOW alone: the shadow
    // and the resolution it overrides share one key, so they leave TOGETHER.
    // Asserted as `has`, not as `get(...) ?? null` — that spelling cannot tell
    // "the shadow survived" from "the key was dropped", which is the one
    // distinction this test exists to make.
    for (let i = 0; i < 2000; i++) {
      recordHandleResolution(dir, { handle: `filler ${String(i)}`, id: null, at: T0 + 2000 });
    }
    const after = readHandleResolutions(dir, { now: T0 + 2000 }).map;
    expect(after.has(saltedKey("the clinic note"))).toBe(false);
    // And the resolution is not left standing in its place, which is the
    // failure that would actually leak.
    expect(after.get(saltedKey("the clinic note"))).toBeUndefined();
  });

  test("a shadow newer than the fillers SURVIVES compaction, as a shadow", () => {
    for (let i = 0; i < 2000; i++) {
      recordHandleResolution(dir, { handle: `filler ${String(i)}`, id: null, at: T0 });
    }
    // Written after the last compaction, so these two are the youngest keys in
    // the file rather than its oldest.
    recordHandleResolution(dir, { handle: "the clinic note", id: "mem_aaaaaaaaaaaa", at: T0 + 1000 });
    recordHandleResolution(dir, { handle: "the clinic note", id: null, at: T0 + 2000 });
    const live = readHandleResolutions(dir, { now: T0 + 2000 }).map;
    expect(live.has(saltedKey("the clinic note"))).toBe(true);
    expect(live.get(saltedKey("the clinic note"))).toBeNull();
  });

  test("compaction keeps the newest by `at`, not by where the key first appeared", () => {
    const path = expansionsPath(dir);
    mkdirSync(sessionsDir(dir), { recursive: true });
    const key = saltedKey("the split");
    // A handle resolved long ago — the FIRST line in the file...
    const lines = [JSON.stringify({ key, id: "mem_aaaaaaaaaaaa", at: T0, scope: "/p" })];
    for (let i = 0; i < 900; i++) {
      lines.push(
        JSON.stringify({
          key: saltedKey(`filler ${String(i)}`),
          id: `mem_${String(i).padStart(12, "0")}`,
          at: T0 + 1 + i,
          scope: "/p",
        }),
      );
    }
    // ...and re-resolved a moment ago. It is the NEWEST answer in the file and
    // the one the next boundary is about to ask for, but a Map is keyed by
    // FIRST appearance, so an unsorted `slice(-KEEP)` drops it and keeps 256
    // fillers that are staler than it is.
    lines.push(JSON.stringify({ key, id: "mem_bbbbbbbbbbbb", at: T0 + 9999, scope: "/p" }));
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");

    compactExpansions(path, T0 + 10_000);

    const live = readHandleResolutions(dir, { now: T0 + 10_000 }).map;
    expect(live.get(key)).toBe("mem_bbbbbbbbbbbb");
    expect(live.size).toBe(EXPANSIONS_KEEP);
    // The bound is paid for out of the STALEST keys, which is what "newest
    // wins" was supposed to mean all along.
    expect(live.has(saltedKey("filler 0"))).toBe(false);
  });

  test("compaction carries a line another process appended while it was running", () => {
    const path = expansionsPath(dir);
    mkdirSync(sessionsDir(dir), { recursive: true });
    // A file with real work in it: 900 fillers, and the resolution of the
    // confidential title as the newest line.
    const lines = [];
    for (let i = 0; i < 900; i++) {
      lines.push(
        JSON.stringify({
          key: saltedKey(`filler ${String(i)}`),
          id: `mem_${String(i).padStart(12, "0")}`,
          at: T0 + i,
          scope: "/p",
        }),
      );
    }
    const key = saltedKey("the clinic note");
    lines.push(JSON.stringify({ key, id: "mem_aaaaaaaaaaaa", at: T0 + 5000, scope: "/p" }));
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");

    // THE RACE: another server refuses that same title while this compaction is
    // between its read and its rename. Losing this line does not cost credit —
    // it puts the resolution back where a refusal had overridden it.
    compactExpansions(path, T0 + 6000, () => {
      appendFileSync(
        path,
        `${JSON.stringify({ key, id: null, at: T0 + 5500, scope: "/p" })}\n`,
        "utf8",
      );
    });

    const live = readHandleResolutions(dir, { now: T0 + 6000 }).map;
    expect(live.has(key)).toBe(true);
    expect(live.get(key)).toBeNull();
  });

  test("translation reaches only what the log knows; everything else passes through unchanged", () => {
    recordHandleResolution(dir, { handle: "storage split", id: "mem_abc123abc123", at: T0 });
    const live = readHandleResolutions(dir, { now: T0 }).map;
    const raw = ["storage split", "a title nobody resolved", "mem_ffffffffffff"];
    expect(translateExpansions(raw, live, expansionSalt(dir) ?? "")).toEqual([
      "mem_abc123abc123",
      "a title nobody resolved",
      "mem_ffffffffffff",
    ]);
    expect(countTranslated(raw, live, expansionSalt(dir) ?? "")).toBe(1);
  });

  test("a read SAYS why it came back empty: ok, absent, unreadable, corrupt", () => {
    // Absent is the ordinary state of a store nobody has expanded a handle in,
    // and it must not look like the other two.
    expect(readHandleResolutions(dir)).toMatchObject({ ok: false, reason: "absent" });

    recordHandleResolution(dir, { handle: "the split", id: "mem_aaaaaaaaaaaa", at: T0 });
    expect(readHandleResolutions(dir, { now: T0 })).toMatchObject({ ok: true, reason: "ok" });
    // A live table filtered down to nothing is still `ok` — the emptiness is an
    // answer, not a failure.
    const stale = readHandleResolutions(dir, { now: T0 + EXPANSION_TTL_MS + 1 });
    expect(stale.map.size).toBe(0);
    expect(stale.reason).toBe("ok");

    // Lines, and not one of them a record: a writer on the other side of this
    // seam producing something this side cannot read.
    writeFileSync(expansionsPath(dir), "not json at all\n{ also not\n", "utf8");
    const corrupt = readHandleResolutions(dir, { now: T0 });
    expect(corrupt.map.size).toBe(0);
    expect(corrupt).toMatchObject({ ok: false, reason: "corrupt" });

    // There and unopenable. `resolvedHandles: 0` alone could not tell this from
    // any of the above, which is the shape I32's failure had.
    chmodSync(expansionsPath(dir), 0o000);
    try {
      expect(readHandleResolutions(dir, { now: T0 })).toMatchObject({
        ok: false,
        reason: "unreadable",
      });
    } finally {
      chmodSync(expansionsPath(dir), 0o600);
    }
  });

  test("an empty handle, an empty id, an absent log and an unwritable dir are refusals, never throws", () => {
    expect(recordHandleResolution(dir, { handle: "   ", id: "mem_abc123abc123" })).toBe(false);
    expect(recordHandleResolution(dir, { handle: "a handle", id: "" })).toBe(false);
    expect(readHandleResolutions(join(dir, "nothing-here")).map.size).toBe(0);
    const locked = mkdtempSync(join(tmpdir(), "counterparts-expansions-locked-"));
    try {
      chmodSync(locked, 0o000);
      expect(recordHandleResolution(locked, { handle: "a handle", id: "mem_abc123abc123" })).toBe(false);
    } finally {
      chmodSync(locked, 0o700);
      rmSync(locked, { recursive: true, force: true });
    }
  });
});
