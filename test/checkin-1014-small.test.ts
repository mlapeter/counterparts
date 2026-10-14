/**
 * The 2026-10-14 Group 1 check-in's small fixes (A–F), lightly held. Each
 * test that opens a store runs on a fresh temp dir it removes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer, toolSpec } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { findable } from "./store-fixture.js";

const ENV = "COUNTERPARTS_DATA_DIR";
let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-checkin-1014-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function server(): McpServer {
  const s = openServer({ dir, session: "sess_checkin", scope: "/scope/one", owner: true });
  findable(s.counterpart.store);
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

const fieldDescription = (tool: string, ...path: string[]): string => {
  let node = toolSpec(tool)?.inputSchema as Record<string, unknown> | undefined;
  for (const key of path) node = (node?.[key] as Record<string, unknown> | undefined) ?? undefined;
  return String(node?.["description"] ?? "");
};

// ── A. salience guidance ─────────────────────────────────────────────────────

describe("A. salience: routine work and ordinary work facts are left unset", () => {
  const item = ["properties", "memories", "items", "properties"];
  const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["remember", ["properties", "salience"]],
    ["session_end", [...item, "salience"]],
  ];
  for (const [tool, path] of cases) {
    test(`${tool}: the salience field says to leave routine work unset, 0.4+ only for what struck you`, () => {
      const d = fieldDescription(tool, ...path);
      expect(d).toContain("Leave it UNSET for a routine work event");
      expect(d).toContain("ordinary work fact or step unless it changed something");
      expect(d).toContain("0.4 or more only for what struck you");
      expect(d).toContain("Their rulings, preferences and corrections stay high even about work");
      // No numeric anchor invites a claim for routine work any more.
      expect(d).not.toContain("About 0.2 a routine work event");
    });
  }
});

// ── E. recall: `query` is `question` ────────────────────────────────────────

describe("E. recall accepts `query` as another name for `question`", () => {
  test("the schema names it", () => {
    expect(fieldDescription("recall", "properties", "query")).toContain("question");
  });

  test("`query` with a mode is answered as a question; without a mode it still needs one", async () => {
    const s = server();
    const id = s.counterpart.store.put({ type: "memory", kind: "fact", body: "The zqharbour ferry runs twice a day in winter." });
    const got = payload(await s.call("recall", { query: "zqharbour ferry", mode: "facts" }));
    expect(got["reason"]).not.toBe("no-argument");
    expect(got["ids"] as string[]).toContain(id);
    const bare = payload(await s.call("recall", { query: "zqharbour ferry" }));
    expect(bare["reason"]).toBe("mode-required");
  });

  test("`question` wins when both are sent", async () => {
    const s = server();
    const id = s.counterpart.store.put({ type: "memory", kind: "fact", body: "The zqharbour ferry runs twice a day in winter." });
    const got = payload(await s.call("recall", { question: "zqharbour ferry", query: "nothing like it", mode: "facts" }));
    expect(got["ids"] as string[]).toContain(id);
  });
});
