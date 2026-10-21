/**
 * THE HOST SEAM (2026-09-30) — the one on-disk shape change it makes, and the
 * seam itself.
 *
 *   - **`host` on registry records.** Written by the lifecycle; a record with no
 *     `host` (every record before this) reads as Claude Code's.
 *   - **Per-host wording**, and the lifecycle being a thing a second host can
 *     construct without Claude Code's adapter.
 *
 * Every test runs in a fresh temp dir it creates and removes; no real home, no
 * real store.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { DEFAULT_HOST, HOST_WORDING, isHostName, wordingFor } from "../src/adapters/hosts.js";
import { Lifecycle } from "../src/adapters/lifecycle.js";
import type { HostLifecycle } from "../src/adapters/lifecycle.js";
import { RECONNECT_REMEDY, hostOf, readSession, recordSession, sessionPath } from "../src/adapters/sessions.js";
import {
  SCHEMA_UNREADABLE_REFUSAL,
  STALE_SERVER_REFUSAL,
  schemaUnreadableRefusal,
  staleServerRefusal,
} from "../src/adapters/mcp/server.js";
import { ClaudeCodeAdapter, openAdapter } from "../src/adapters/claude-code/index.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-host-seam-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const T0 = 1_800_000_000_000;

describe("host on registry records — absent reads as claude-code", () => {
  test("a record written with no host has no host key on disk, and reads as claude-code", () => {
    const dir = join(root, "store");
    const written = recordSession(dir, { sessionId: "s1", scope: "/proj/a", phase: "start", at: T0 });
    expect(written).not.toBeNull();
    const raw = JSON.parse(readFileSync(sessionPath(dir, "s1") as string, "utf8")) as Record<string, unknown>;
    expect("host" in raw).toBe(false);
    const read = readSession(dir, "s1");
    expect(read?.host).toBeUndefined();
    expect(hostOf(read as NonNullable<typeof read>)).toBe("claude-code");
    expect(DEFAULT_HOST).toBe("claude-code");
  });

  test("a hand-written record from before the field reads as claude-code", () => {
    const dir = join(root, "store");
    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(
      sessionPath(dir, "old") as string,
      JSON.stringify({ sessionId: "old", scope: "/proj/a", startedAt: T0, lastBoundaryAt: T0, endedAt: null }),
    );
    const read = readSession(dir, "old");
    expect(read).not.toBeNull();
    expect(hostOf(read as NonNullable<typeof read>)).toBe("claude-code");
  });

  test("a named host is kept, carried through a phase that names none, and a malformed one is no mark", () => {
    const dir = join(root, "store");
    recordSession(dir, { sessionId: "d1", scope: "/proj/a", phase: "start", at: T0, host: "claude-desktop" });
    recordSession(dir, { sessionId: "d1", scope: "/proj/a", phase: "boundary", at: T0 + 1 });
    expect(readSession(dir, "d1")?.host).toBe("claude-desktop");
    recordSession(dir, { sessionId: "bad", scope: "/proj/a", phase: "start", at: T0, host: "Not A Host!" });
    expect(readSession(dir, "bad")?.host).toBeUndefined();
    expect(isHostName("claude-desktop")).toBe(true);
    expect(isHostName("../etc")).toBe(false);
  });

  test("the Claude Code adapter writes host: claude-code on the records it writes", () => {
    const store = join(root, "store");
    const proj = join(root, "proj");
    mkdirSync(proj, { recursive: true });
    const a = openAdapter(
      { dataDir: store },
      { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }), scope: { mode: "on", matched: proj, entry: null } },
    );
    try {
      expect(a).toBeInstanceOf(Lifecycle);
      expect(a.host).toBe("claude-code");
      a.sessionStart({ sessionId: "cc-1", scope: proj });
      expect(readSession(store, "cc-1")?.host).toBe("claude-code");
    } finally {
      a.counterpart.close();
    }
  });
});

describe("the lifecycle, without Claude Code's adapter", () => {
  test("a second host constructs it directly, and its registry writes carry that host", () => {
    const store = join(root, "store");
    const proj = join(root, "proj");
    mkdirSync(proj, { recursive: true });
    const c = Counterpart.open({ dir: store });
    try {
      const life: HostLifecycle = new Lifecycle({ counterpart: c, config: { dataDir: store }, host: "claude-desktop" });
      expect(life).not.toBeInstanceOf(ClaudeCodeAdapter);
      life.noteSession("start", { sessionId: "desk-1", scope: proj });
      const rec = readSession(store, "desk-1");
      expect(rec?.host).toBe("claude-desktop");
      expect(hostOf(rec as NonNullable<typeof rec>)).toBe("claude-desktop");
      // A boundary with nothing said captures nothing and fails nothing.
      const b = life.captureBoundary("desk-boundary", "stop", { sessionId: "desk-1", scope: proj, turns: [] });
      expect(b.spansAppended).toBe(0);
      expect(life.events("adapter.session.registry").length).toBeGreaterThan(0);
    } finally {
      c.close();
    }
  });
});

describe("per-host wording", () => {
  test("Claude Code's words are exactly the words it had", () => {
    expect(RECONNECT_REMEDY).toBe("Run /mcp and Reconnect to load it.");
    expect(staleServerRefusal()).toBe(STALE_SERVER_REFUSAL);
    expect(staleServerRefusal("claude-code")).toBe(STALE_SERVER_REFUSAL);
    expect(schemaUnreadableRefusal("claude-code")).toBe(SCHEMA_UNREADABLE_REFUSAL);
    expect(SCHEMA_UNREADABLE_REFUSAL).toBe(
      "This server could not read which version the memory store is at, so this tool did nothing. Run /mcp and Reconnect; if that does not help, run `counterparts doctor`.",
    );
  });

  test("a host with no entry of its own speaks with the default host's words", () => {
    expect(HOST_WORDING["no-such-host"]).toBeUndefined();
    expect(wordingFor("no-such-host")).toEqual(wordingFor(DEFAULT_HOST));
  });
});
