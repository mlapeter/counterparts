/**
 * The 2026-10-14 Group 1 check-in's small fixes (A–F), lightly held. Each
 * test that opens a store runs on a fresh temp dir it removes.
 */
import { describe, expect, test } from "bun:test";

import { toolSpec } from "../src/adapters/mcp/index.js";

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
