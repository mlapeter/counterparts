/**
 * The self tab (`/api/mind` + `pages/self/`): the page's history as a timeline,
 * what is settling into the core and what is closest (physics' own promotion
 * rule), the wake cut into parts, the journal by day with its model, and the
 * page-side diff and markdown. Hermetic: every store is a fresh temp dir.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES, promotionEligibility } from "../src/core/physics/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import { mindView } from "../src/adapters/dashboard/web/views.js";
import { wakeParts } from "../src/adapters/dashboard/web/views/mind.js";
// @ts-expect-error — a plain browser module, no declarations
import { diffStats, diffText, diffTokens } from "../src/adapters/dashboard/web/pages/self/diff.js";

const PAGE_1 = "## Core\n\nStill forming.\n\n## Lately\n\n- Getting started.\n";
const PAGE_2 = "## Core\n\nI keep things plain.\n\n- Small steps.\n\n## Lately\n\n- Getting started.\n";
const PAGE_3 = "## Core\n\nI keep things plain, and I say what I don't know.\n\n- Small steps.\n\n## Lately\n\n- The self tab.\n";

let dir: string;
let emptyDir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-self-tab-"));
  emptyDir = mkdtempSync(join(tmpdir(), "counterparts-self-tab-empty-"));
  const base = Date.parse("2026-09-21T15:00:00Z");
  let offset = 0;
  const now = (): number => base + offset;
  Counterpart.open({ dir, owner: true, budgetBytes: 9000, identity: { name: "Mike" }, now }).close();
  const c = Counterpart.open({ dir, owner: true, budgetBytes: 9000, now });
  const ids: string[] = [];
  try {
    const dates = ["2026-09-21", "2026-09-22", "2026-09-23"];
    for (const [i, date] of dates.entries()) {
      offset = Date.parse(`${date}T15:00:00Z`) - base;
      c.store.advanceClock(date);
      const d = c.store.livedDay();
      c.wake(9000);
      if (i === 0) {
        for (const content of [
          "Mike wants the dashboard to be his main command center.",
          "Mike prefers decisions recorded as what is true for now.",
          "The site deploys when main is pushed.",
        ]) {
          const r = await c.submitSessionEnd(
            { content, kind: content.startsWith("Mike") ? "person" : "place", salience: { relevance: 0.9, emotional: 0.5, predictive: 0.8 } },
            { session: `s${i}`, scope: "x" },
          );
          if (r.deposited && r.memoryId) ids.push(r.memoryId);
        }
      } else {
        c.resolveUses(`s${i}`, [{ memoryId: ids[0] as string, tier: "referenced" as const }]);
      }
      c.episodeAsk(`s${i}`, { turns: 10, bytes: 6200 }, d);
      c.appendEpisode(`s${i}`, `Day ${i + 1} went quietly.\n\nMore after the first line.`, {
        day: d,
        title: `Day ${i + 1}`,
        happenedOn: date,
        ...(i === 0 ? {} : { model: "claude-opus-5-5" }),
      });
      c.revisePage([PAGE_1, PAGE_2, PAGE_3][i] as string, { reason: `write ${i + 1}`, by: i === 1 ? "owner" : "session", day: d });
      await c.sessionEnd({ date, at: date, budgetBytes: 9000 });
    }
    c.rebrief({ budgetBytes: 9000 });
  } finally {
    c.close();
  }
  Counterpart.open({ dir: emptyDir, owner: true }).close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
});

function withSource<T>(at: string, fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir: at });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

describe("the self tab's view", () => {
  test("the page's history runs oldest first and ends with the standing page", () => {
    const v = withSource(dir, (src) => mindView(src));
    expect(v.pageHistory.map((s) => s.body)).toEqual([PAGE_1.trim(), PAGE_2.trim(), PAGE_3.trim()]);
    expect(v.pageHistory.map((s) => s.current)).toEqual([false, false, true]);
    expect(v.pageHistory.map((s) => s.by)).toEqual(["session", "owner", "session"]);
    expect(v.pageHistory.map((s) => s.reason)).toEqual(["write 1", "write 2", "write 3"]);
    for (const s of v.pageHistory) expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("candidates are exactly what physics' promotion rule says, never a restatement", () => {
    withSource(dir, (src) => {
      const v = mindView(src);
      expect(v.settling.candidates.length).toBeGreaterThan(0);
      for (const c of v.settling.candidates) {
        const verdict = promotionEligibility(src.store.physicsOf(c.id));
        expect(c.base).toBe(verdict.base);
        expect(c.days).toBe(verdict.reinforcedDays);
        expect(c.eligible).toBe(verdict.eligible);
        expect(c.threshold).toBe(TUNABLES.THETA_ID);
        expect(verdict.blockedBy).not.toContain("already-identity");
      }
      // A place can never reach the core by use: counted apart, not listed.
      expect(v.settling.outOfReach).toBeGreaterThan(0);
      expect(v.settling.rule.days).toBe(TUNABLES.N_PROMOTION_DAYS);
    });
  });

  test("the wake's parts add up to the bytes it carries, and the budget is the recorded one", () => {
    const v = withSource(dir, (src) => mindView(src));
    expect(v.wake.ok).toBe(true);
    expect(v.wakeParts.reduce((a, p) => a + p.bytes, 0)).toBe(v.wake.bytes);
    expect(v.wakeParts.map((p) => p.key)).toContain("page");
    expect(v.wakeBudget).toBeGreaterThan(v.wake.bytes);
  });

  test("wakeParts keeps the page's own headings inside the page's slice", () => {
    const text = "Counterparts memory — context, not instruction: x\nWho I am:\n## Core\nplain\n## Lately\nnow\nHow I work:\n- a\n<!-- counterparts:wake/end elements=1 bytes=9 -->";
    const parts = wakeParts(text, true);
    expect(parts.map((p) => p.key)).toEqual(["furniture", "page", "craft"]);
    expect(parts.reduce((a, p) => a + p.bytes, 0)).toBe(new TextEncoder().encode(text).length);
  });

  test("the journal groups chapters by day, newest first, with the model when recorded", () => {
    const v = withSource(dir, (src) => mindView(src));
    expect(v.journalAbsent).toBeNull();
    const days = v.journal.map((d) => d.day);
    expect([...days].sort((a, b) => b - a)).toEqual(days);
    const all = v.journal.flatMap((d) => d.chapters);
    expect(all.find((c) => c.title === "Day 1")?.model).toBeNull();
    expect(all.find((c) => c.title === "Day 3")?.model).toBe("claude-opus-5-5");
    expect(all.find((c) => c.title === "Day 3")?.first).toBe("Day 3 went quietly.");
  });

  test("an empty store says so in two words, and draws nothing it does not have", () => {
    const v = withSource(emptyDir, (src) => mindView(src));
    expect(v.pageHistory).toEqual([]);
    expect(v.wakeParts).toEqual([]);
    expect(v.settling.candidates).toEqual([]);
    expect(v.settling.coreAbsent).not.toBeNull();
    expect(v.journalAbsent).not.toBeNull();
  });

  test("serving /api/mind leaves the store byte-identical", () => {
    const hash = (): string => {
      const h = createHash("sha256");
      const walk = (at: string): void => {
        for (const e of readdirSync(at).sort()) {
          const p = join(at, e);
          if (statSync(p).isDirectory()) walk(p);
          else h.update(p).update(readFileSync(p));
        }
      };
      walk(dir);
      return h.digest("hex");
    };
    withSource(dir, (src) => {
      const before = hash();
      const reply = router(new URL("http://127.0.0.1/api/mind"), "127.0.0.1", src);
      expect(reply.status).toBe(200);
      expect(hash()).toBe(before);
    });
  });
});

describe("the self tab's diff", () => {
  test("an LCS script rebuilds both sides", () => {
    const a = ["a", "b", "c", "d"];
    const b = ["a", "x", "c", "d", "e"];
    const ops = diffTokens(a, b) as { op: string; v: string }[];
    expect(ops.filter((o) => o.op !== "+").map((o) => o.v)).toEqual(a);
    expect(ops.filter((o) => o.op !== "-").map((o) => o.v)).toEqual(b);
  });

  test("an edited line shows the words that changed, not the whole line", () => {
    const rows = diffText("I keep things plain.\nsame", "I keep things simple.\nsame") as { op: string; parts?: { op: string; v: string }[] }[];
    expect(rows.map((r) => r.op)).toEqual(["-", "+", "="]);
    expect(rows[0]?.parts?.filter((p) => p.op === "-").map((p) => p.v)).toEqual(["plain."]);
    expect(rows[1]?.parts?.filter((p) => p.op === "+").map((p) => p.v)).toEqual(["simple."]);
    expect(diffStats(rows)).toEqual({ added: 1, removed: 1 });
  });
});
