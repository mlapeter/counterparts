/**
 * A THREAD THE NIGHT CLOSED IS OWED BY NOBODY (2026-11-20, follow-up of
 * #848/#855). The night's close (`open-close.ts`) clears a quiet dated
 * `planned` item's thread flag in place and leaves its status, and `owedOf`
 * read `planned` before the flag, so the closed item stayed "overdue" in the
 * wake's Coming up and the `coming up` door while Still open had let it go.
 * Now a flag a close wrote (`unresolved: false`, which nothing but a close
 * writes) owes nothing from a plan status: the item reads "Was <date>", and
 * a reopen makes it owed again.
 *
 * The real path: the item written through the MCP `remember` tool, the night
 * run by the boundary (`Counterpart#sessionEnd`), then `Counterpart#comingUp`,
 * the `coming up` and `still open` handles, and the next shaped wake.
 *
 * Hermetic: a fresh temp dir per test, removed in `afterEach`; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { nightClosedOf } from "../src/core/open-close.js";
import { WAKE_SHAPE_KEY } from "../src/core/self/tunables.js";

const DAY = 24 * 3_600_000;
const ZONE = "UTC";
const BUDGET = 9_000;
const S = "1f0e0000-0000-4000-8000-0000000000e1";

let root: string;
let HERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-night-close-owed-")));
  HERE = join(root, "shop");
  mkdirSync(HERE, { recursive: true });
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function world() {
  let now = Date.parse("2026-11-01T09:00:00Z");
  const c = Counterpart.open({ dir: join(root, "store"), budgetBytes: BUDGET, now: () => now, timeZone: ZONE });
  open.push(c);
  const today = (): string => new Date(now).toISOString().slice(0, 10);
  c.store.advanceClock(today());
  c.store.setMeta(WAKE_SHAPE_KEY, "on");
  return {
    c,
    tools: () => new McpServer({ counterpart: c, session: S, scope: HERE, now: () => now }),
    toDay(n: number) {
      while (c.store.livedDay() < n) {
        now += DAY;
        c.store.advanceClock(today());
      }
    },
    night: () => c.sessionEnd({ date: today(), budgetBytes: BUDGET, session: S }),
    lane(session: string): string {
      const w = c.wake(BUDGET, { date: today() }, { scope: HERE, session });
      expect(w.ok).toBe(true);
      const lines = w.text.split("\n");
      const at = lines.indexOf("Coming up:");
      const out: string[] = [];
      if (at >= 0) for (let i = at + 1; i < lines.length && lines[i] !== ""; i++) out.push(lines[i] ?? "");
      return out.join("\n");
    },
  };
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<string> {
  const r = await s.call("remember", { about: "work", ...args });
  expect(r.isError ?? false).toBe(false);
  return r.structuredContent["id"] as string;
}

async function door(s: McpServer, handle: string): Promise<Record<string, unknown>> {
  const r = await s.call("recall", { handle });
  expect(r.isError ?? false).toBe(false);
  return r.structuredContent;
}
const idsOf = (xs: unknown): string[] => ((xs ?? []) as { id: string }[]).map((x) => x.id);

describe("a quiet dated plan the night closed", () => {
  test("is owed by nobody: Was in the wake, passed in the doors, out of Still open, and owed again once reopened", async () => {
    const w = world();
    const s = w.tools();
    w.toDay(1);
    const plan = await remember(s, {
      text: "0.3.48 ready to publish from the release branch; waiting on the owner.",
      unresolved: true,
      settlesWhen: "the owner publishes 0.3.48",
      status: "planned",
      eventDate: "2026-11-02",
    });
    expect(w.c.store.row(plan)?.status).toBe("planned");
    w.toDay(3);
    await remember(s, { text: "0.3.50 released to npm; the shop install updated cleanly.", status: "done" });
    const report = await w.night();
    expect(report.cycle.closed.map((x) => x.id)).toContain(plan);
    expect(nightClosedOf(w.c.store.readProse(plan).meta)).not.toBeNull();
    w.toDay(4);

    // Still open let it go.
    expect(idsOf((await door(s, "still open"))["items"])).not.toContain(plan);
    // Coming up agrees: past, but passed, not overdue (not vacuous: it is listed).
    const up = w.c.comingUp({ scope: HERE });
    expect(up.overdue.map((x) => x.id)).not.toContain(plan);
    expect(up.passed.map((x) => x.id)).toContain(plan);
    const d = await door(s, "coming up");
    expect(idsOf(d["overdue"])).not.toContain(plan);
    expect(idsOf(d["passed"])).toContain(plan);
    const dated = ((await door(s, "still open"))["comingUp"] ?? []) as { id: string; overdue?: boolean; passed?: boolean }[];
    const row = dated.find((x) => x.id === plan);
    if (row !== undefined) {
      expect(row.overdue).toBeUndefined();
      expect(row.passed).toBe(true);
    }
    const lane = w.lane("1f0e0000-0000-4000-8000-0000000000e2");
    expect(lane).toContain(`[${plan}]`);
    expect(lane).toContain("Was 11-02");
    expect(lane).not.toMatch(/overdue/);

    // Reopened, the thread is open again, and the plan is owed again.
    expect((await s.call("reflect", { phase: "reopen", reopen: [plan] })).isError ?? false).toBe(false);
    expect(w.c.store.readProse(plan).meta["unresolved"]).toBe(true);
    expect(w.c.comingUp({ scope: HERE }).overdue.map((x) => x.id)).toContain(plan);
    expect(idsOf((await door(s, "coming up"))["overdue"])).toContain(plan);
  });
});
