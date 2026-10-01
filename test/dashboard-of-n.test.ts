/**
 * Say "of N" where a list stops (2026-09-28, brain-principle audit #7).
 *
 * When there is more than a panel shows, it ranks by what the panel is named
 * for, and says how many there were:
 *
 *   1. search returns how many memories matched, not only the first 25;
 *   2. the salience picture is this week's memories, most salient first, with
 *      how many were written (it was the newest five, whatever their score);
 *   3. the prospective picture counts what came back and what is waiting;
 *   4. the dream journal and `dream --list` say how many dreams there are, and
 *      `--list --all` reaches every one;
 *   5. health's archive lists are newest first, and say which slice they are.
 *
 * Hermetic: every store lives in a fresh temp dir removed afterwards.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { PRUNE_ARCHIVE_REASON } from "../src/core/sleep/index.js";
import { Store } from "../src/core/store/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { DREAM_LIST_LIMIT, dreamListLines } from "../src/adapters/cli/dream-core.js";
import { unknownFlag } from "../src/adapters/cli/commands.js";
import { mechanismPanel } from "../src/adapters/dashboard/web/views/mechanism-panel.js";
import { PICTURE_ROWS } from "../src/adapters/dashboard/web/views/mechanism-panel.js";
import { DREAM_LIMIT, dreamsView } from "../src/adapters/dashboard/web/views/dreams.js";
import { healthView } from "../src/adapters/dashboard/web/views/health.js";
import { searchView } from "../src/adapters/dashboard/web/views/search.js";
import { MECHANISM_DAYS } from "../src/adapters/dashboard/web/views/mechanisms.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const read = (p: string): string => readFileSync(join(WEB, p), "utf8");

const temps: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function withSource<T>(dir: string, fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

function memory(s: Store, body: string, day: number, extra: { relevance?: number; eventDate?: string } = {}): string {
  return s.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { novelty: null, relevance: extra.relevance ?? 0.5, emotional: 0.1, predictive: 0.3 },
    physics: { birthDay: day, lastUsedDay: day },
    ...(extra.eventDate === undefined ? {} : { eventDate: extra.eventDate }),
  });
}

describe("1. search says how many matched", () => {
  test("30 memories match, 25 are sent, and the total is 30", () => {
    const dir = tempDir("counterparts-of-n-search-");
    const s = Store.open({ dir });
    try {
      for (let i = 0; i < 30; i++) memory(s, `The harbour ledger, page ${i}.`, 0);
      memory(s, "Nothing about boats at all.", 0);
    } finally {
      s.close();
    }
    withSource(dir, (src) => {
      const v = searchView(src, "harbour", 25);
      expect(v.hits.length).toBe(25);
      expect(v.total).toBe(30);
      expect(searchView(src, "boats", 25).total).toBe(1);
    });
    const page = read("pages/memories/sections/search.js");
    expect(page).toContain("findHead(d.hits.length, d.total, close.length)");
    expect(page).toContain("matchCount(shown, total)");
    expect(page).toContain('"the closest " + shown + " of " + all + " matches"');
  });
});

describe("2–3. the salience and prospective pictures", () => {
  let dir = "";
  let old = "";
  let today = 0;
  const weekIds: string[] = [];

  test("salience: this week's memories, most salient first, with how many were written", async () => {
    dir = tempDir("counterparts-of-n-pictures-");
    const s = Store.open({ dir });
    try {
      for (let d = 1; d <= MECHANISM_DAYS + 3; d++) s.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
      today = s.livedDay();
      // An old memory with the highest score of all: outside the week, so not in the picture.
      old = memory(s, "An old and very important thing.", 0, { relevance: 1 });
      // Seven this week, their scores out of order with their birth.
      const scores = [0.2, 0.9, 0.4, 0.7, 0.1, 0.8, 0.3];
      scores.forEach((r, i) => weekIds.push(memory(s, `This week, number ${i}.`, today - (i % 3), { relevance: r })));
      // Eight dated memories still waiting for their day.
      for (let i = 1; i <= 8; i++) memory(s, `On the calendar, number ${i}.`, 0, { eventDate: `2027-0${Math.min(9, i)}-01` });
    } finally {
      s.close();
    }
    const panel = (await import(join(WEB, "mechanisms/salience/panel.js"))) as { picture(p: unknown): string; caption(p: unknown): string };
    withSource(dir, (src) => {
      const p = mechanismPanel(src, "salience").picture as unknown as { memories: { id: string; salience: number; bornDay: number }[]; written: number; days: number };
      expect(p.days).toBe(MECHANISM_DAYS);
      expect(p.written).toBe(weekIds.length);
      expect(p.memories.length).toBe(PICTURE_ROWS);
      expect(p.memories.map((m) => m.id)).not.toContain(old);
      const scores = p.memories.map((m) => m.salience);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      for (const m of p.memories) expect(m.bornDay).toBeGreaterThan(today - MECHANISM_DAYS);
      expect(panel.caption(p)).toBe(`The ${PICTURE_ROWS} most salient of the ${weekIds.length} memories written in the last ${MECHANISM_DAYS} lived days.`);
      expect(panel.picture(p)).toContain('class="pic-cap"');
    });
  });

  test("prospective: how many came back and how many are waiting, beside the rows listed", async () => {
    const panel = (await import(join(WEB, "mechanisms/prospective/panel.js"))) as { caption(p: unknown): string };
    withSource(dir, (src) => {
      const p = mechanismPanel(src, "prospective").picture as unknown as {
        came: unknown[];
        waiting: unknown[];
        counts: { came: number; waiting: number };
      };
      expect(p.counts).toEqual({ came: 0, waiting: 8 });
      expect(p.came.length + p.waiting.length).toBe(PICTURE_ROWS);
      expect(panel.caption(p)).toBe(`0 came back this week · 8 waiting for their day (${PICTURE_ROWS} listed)`);
    });
  });
});

describe("4. dreams: how many, and a way to every one", () => {
  const TOTAL = DREAM_LIST_LIMIT + 5;
  let dir = "";

  test("the journal carries the newest and counts them all", () => {
    dir = tempDir("counterparts-of-n-dreams-");
    let t = 1_000;
    const s = Store.open({ dir, now: () => (t += 1_000) });
    try {
      for (let i = 0; i < TOTAL; i++) s.openDream({ id: `drm_${String(i).padStart(3, "0")}`, day: i });
      expect(s.dreamCount()).toBe(TOTAL);
    } finally {
      s.close();
    }
    withSource(dir, (src) => {
      const v = dreamsView(src);
      expect(v.dreams.length).toBe(DREAM_LIMIT);
      expect(v.total).toBe(TOTAL);
      expect(v.more).toBe(TOTAL - DREAM_LIMIT);
      expect(v.dreams[0]?.id).toBe(`drm_${String(TOTAL - 1).padStart(3, "0")}`);
    });
    expect(read("pages/self/sections/dreams.js")).toContain("counterparts dream --list --all");
  });

  test("`dream --list` says N of total; `--all` lists every one", () => {
    const c = Counterpart.open({ dir, owner: true });
    try {
      const some = dreamListLines(c);
      // The dreaming setting leads the list (2026-09-28, #271); the count line follows it.
      expect(some[0]).toStartWith("Dreaming: ask.");
      expect(some[2]).toBe(`Dreams — newest first (${DREAM_LIST_LIMIT} of ${TOTAL} shown; every one: counterparts dream --list --all)`);
      expect(some.filter((l) => l.startsWith("drm_")).length).toBe(DREAM_LIST_LIMIT);
      const all = dreamListLines(c, "all");
      expect(all[2]).toBe(`Dreams — newest first (all ${TOTAL})`);
      expect(all.filter((l) => l.startsWith("drm_")).length).toBe(TOTAL);
    } finally {
      c.close();
    }
    expect(unknownFlag("dream", ["--list", "--all"])).toBeNull();
  });
});

describe("5. health's archive lists are newest first", () => {
  test("the most recently archived comes first, and the page says which slice it shows", () => {
    const dir = tempDir("counterparts-of-n-archive-");
    let t = 1_000;
    const s = Store.open({ dir, now: () => (t += 1_000) });
    const order: string[] = [];
    try {
      const ids = Array.from({ length: 6 }, (_, i) => memory(s, `Let go, number ${i}.`, 0));
      // Archive in an order unrelated to the ids' own order.
      for (const i of [3, 0, 5, 1, 4, 2]) {
        s.archive(ids[i]!, PRUNE_ARCHIVE_REASON);
        order.push(ids[i]!);
      }
    } finally {
      s.close();
    }
    withSource(dir, (src) => {
      const pruned = healthView(src).archive.reasons.find((r) => r.reason === PRUNE_ARCHIVE_REASON);
      expect(pruned?.count).toBe(6);
      expect(pruned?.items.map((i) => i.id)).toEqual([...order].reverse());
    });
    const page = read("pages/health/sections/archive.js");
    // In ROWS, as the count is (2026-10-01: rows with the same words are one item).
    expect(page).toContain('"the newest " + listed + " of " + r.count');
    expect(page).toContain("older, not listed");
  });
});
