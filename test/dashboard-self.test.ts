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
import { healthView, mindView } from "../src/adapters/dashboard/web/views.js";
import {
  PAGE_BEHIND_LIVED_DAYS,
  headingIso,
  oneReturnAway,
  pageBehindWords,
  wakeParts,
  writerReason,
  writerWords,
} from "../src/adapters/dashboard/web/views/mind.js";
// @ts-expect-error — a plain browser module, no declarations
import { chapterCount, dayLabel } from "../src/adapters/dashboard/web/pages/self/sections/journal.js";
import { SELF_TUNABLES } from "../src/core/self/index.js";
// @ts-expect-error — a plain browser module, no declarations
import { PLAIN } from "../src/adapters/dashboard/web/pages/health/sections/checks.js";
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
          // v9: the writer marks what it learned about the owner.
          if (r.deposited && r.memoryId && content.startsWith("Mike")) c.store.setAbout(r.memoryId, "owner", { by: "writer" });
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
      // The candidates are memories about the owner (person memories naming
      // Mike), measured by the core lanes (2026-09-26).
      expect(v.settling.candidates.length).toBeGreaterThan(0);
      for (const c of v.settling.candidates) {
        // The engine's own context, the same one every tab passes (round 3).
        const verdict = promotionEligibility(src.store.physicsOf(c.id), { aboutMe: true, day: src.store.livedDay() });
        expect(c.oneReturnAway).toBe(oneReturnAway(verdict));
        expect(c.feeling).toBe(verdict.fast.intensity);
        expect(c.days).toBe(verdict.slow.days);
        expect(c.span).toBe(verdict.slow.span);
        expect(c.lane).toBe(verdict.lane);
        expect(c.eligible).toBe(verdict.eligible);
        expect(c.needFeeling).toBe(TUNABLES.CORE_FAST_FEELING);
        expect(c.requiredDays).toBe(TUNABLES.CORE_SLOW_DAYS);
        expect(c.needSpan).toBe(TUNABLES.CORE_SLOW_SPAN_DAYS);
        expect(verdict.blockedBy).not.toContain("already-identity");
      }
      // A place is not about me or about us: the core is not for it, and it is
      // counted apart, not listed.
      expect(v.settling.outOfReach).toBeGreaterThan(0);
      expect(v.settling.rule.days).toBe(TUNABLES.CORE_SLOW_DAYS);
      expect(v.settling.rule.span).toBe(TUNABLES.CORE_SLOW_SPAN_DAYS);
      // The history lists are always there, empty on a store nothing crossed in.
      expect(v.settling.history).toEqual({ promoted: [], demoted: [], nominated: [] });
    });
  });

  test("the wake's parts add up to the bytes it carries, and the budget is the recorded one (on the health tab since 3b)", () => {
    const v = withSource(dir, (src) => mindView(src));
    const w = withSource(dir, (src) => healthView(src)).wake;
    expect(v.wake.ok).toBe(true);
    expect(w.ok).toBe(true);
    expect(w.bytes).toBe(v.wake.bytes);
    expect(w.parts.reduce((a, p) => a + p.bytes, 0)).toBe(v.wake.bytes);
    expect(w.parts.map((p) => p.key)).toContain("page");
    expect(w.budget).toBeGreaterThan(v.wake.bytes);
    expect(w.trimmed).toBe(0);
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
    expect(v.pageDays).toEqual([]);
    expect(withSource(emptyDir, (src) => healthView(src)).wake.parts).toEqual([]);
    expect(v.wakeList.nearby).toEqual([]);
    expect(v.map).toEqual({ nodes: [], links: [], total: 0, more: 0 });
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

describe("the self tab's side column (round 2, an experiment)", () => {
  test("the opening is one short line", () => {
    const v = withSource(dir, (src) => mindView(src));
    expect(v.opening).toMatch(/^Day \d+ · Who I am$/);
  });

  test("the page carries the limit its staleness is measured against", () => {
    const v = withSource(dir, (src) => mindView(src));
    expect(v.page?.staleAfter).toBe(SELF_TUNABLES.PAGE_STALE_DAYS);
  });

  test("a store the page writer never ran on says so, as never run", () => {
    const v = withSource(dir, (src) => mindView(src));
    expect(v.writer.ran).toBe(false);
    expect(v.writer.line).toBe("No run recorded yet");
    expect(v.writer.absent).toBe("(never run)");
  });

  test("every outcome reads in plain words, and last night is named as such", () => {
    const y = "2026-09-25";
    const w = (outcome: string, detail = "", derived = false, about = y) =>
      writerWords({ about, outcome: outcome as never, derived, run: { detail } }, y);
    expect(w("revised").line).toBe("Last night: rewrote it.");
    expect(w("revised").next).toBeNull();
    expect(w("nothing-to-say").line).toBe("Last night: read the day and kept it as is.");
    // Derived: nobody reported it, so it is not worded as a report.
    expect(w("nothing-to-say", "", true).line).toBe("Last night: was handed the day and left it as is.");
    expect(w("failed", "watchdog").line).toBe("Last night: couldn't rewrite it — it ran out of time. Tonight's run tries again.");
    expect(w("failed", "exit 2").what).toBe("couldn't rewrite it — it stopped with an error (exit 2)");
    expect(w("failed", "", true).what).toBe("started and never finished");
    expect(w("refused", "too-large").what).toBe("tried, but the rewrite was turned away — too large");
    expect(w("refused", "too-large").next).toBeNull();
    expect(w("asked").what).toBe("was handed the day in today's nightly run; no answer yet");
    expect(w("started").what).toBe("is running now");
    const older = w("revised", "", false, "2026-07-09");
    expect(older.lastNight).toBe(false);
    expect(older.line).toMatch(/^The night of Jul 9th(, 2026)?: rewrote it\.$/);
    // Every line has a longer story behind its `?`.
    for (const o of ["revised", "nothing-to-say", "failed", "refused", "skipped", "asked", "started"]) {
      expect(w(o, "no-room").more.length).toBeGreaterThan(0);
    }
    // A night with no row at all behind its skip says nothing it does not know.
    expect(writerWords({ about: y, outcome: "skipped", derived: true, run: null }, y).what).toBe("nothing ran, and nothing says why");
    expect(writerReason("some-new-code")).toBe("some new code");
    expect(writerReason("")).toBe("no reason was recorded");
  });

  test("a night that did not happen says what did not happen and what would make it happen (round 3, S2)", () => {
    const y = "2026-09-26";
    const read = (detail: string, about = y, on?: string) =>
      writerWords({ about, outcome: "skipped", derived: false, run: { detail, ...(on === undefined ? {} : { on }) } }, y);
    // A night the RETIRED session-start ask deferred for want of room (2026-09-28:
    // the writer runs inside the nightly run now). Old rows still read, in words
    // that say it was the old way and what happens now.
    const room = read("no-room", y, "2026-09-27");
    expect(room.line).toBe("Last night: not rewritten — the session start had no room left to ask (the old way). It runs inside the nightly run now, where there is room.");
    expect(room.next).toBe("It runs inside the nightly run now, where there is room.");
    expect(room.more).toContain("held back rather than cut short");
    expect(room.more).not.toContain("injectionBudgetBytes");
    expect(room.more).toMatch(/Recorded Sep 27th(, 2026)?\./);
    expect(read("scope-question").line).toBe(
      "Last night: not rewritten — the first-launch question took its turn (the old way). It runs inside the nightly run now, and waits for no question.",
    );
    // A code nobody mapped keeps its own words and no remedy is invented for it.
    const unknown = read("some-new-code");
    expect(unknown.what).toBe("not rewritten — some new code");
    expect(unknown.next).toBeNull();
    expect(unknown.line).toBe("Last night: not rewritten — some new code.");
    // No date on the row, no date in the words.
    expect(read("no-room").more).not.toContain("Recorded");
  });

  test("the newest run is read through self/'s own status: an asked night that is over reads as derived", () => {
    const at = mkdtempSync(join(tmpdir(), "counterparts-self-writer-"));
    try {
      const then = Date.parse("2026-09-02T15:00:00Z");
      const c = Counterpart.open({ dir: at, owner: true, now: () => then });
      try {
        c.revisePage(PAGE_1, { reason: "first", by: "writer" });
        c.recordPageWriterRun({ about: "2026-09-01", mode: "session", outcome: "asked" });
      } finally {
        c.close();
      }
      // Read on the real clock, which is weeks past the claim.
      const v = withSource(at, (src) => mindView(src));
      expect(v.writer.ran).toBe(true);
      expect(v.writer.outcome).toBe("nothing-to-say");
      expect(v.writer.derived).toBe(true);
      expect(v.writer.line).toMatch(/^The night of Sep 1st(, 2026)?: was handed the day and left it as is\.$/);
      expect(v.page?.stale).toBe(true);
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });

  test("the health row says the self page's age in words, and says when it is past the limit", () => {
    const line = PLAIN["self-page"] as (d: unknown) => string | null;
    expect(line({ present: true, daysSince: 0, version: 3, stale: false, staleAfter: 14 })).toBe("rewritten today · version 3");
    expect(line({ present: true, daysSince: 5, version: 3, stale: false, staleAfter: 14 })).toBe("rewritten 5 days ago · version 3");
    expect(line({ present: true, daysSince: 16, version: 3, stale: true, staleAfter: 14 })).toBe("not rewritten in 16 days; this turns amber after 14");
    // Nothing to count from (absent, cleared, or an older doctor): doctor's own detail stands.
    expect(line({ present: false })).toBeNull();
    expect(line({ present: true, stale: true })).toBeNull();
  });

  test("the health row's memory count says what it leaves out (home counts the people and project cards in)", () => {
    const line = PLAIN["store"] as (d: unknown, detail?: string) => string | null;
    expect(line({ exists: true, memories: 295 }, "~/.counterparts — 295 memories, opens fine")).toBe(
      "~/.counterparts — 295 memories, not counting the cards for people and projects · opens fine",
    );
    expect(line({ exists: true, memories: 1 }, "~/x — 1 memory")).toBe("~/x — 1 memory, not counting the cards for people and projects");
    // A detail with no path in front keeps the count alone.
    expect(line({ exists: true, memories: 2 }, "2 memories")).toBe("2 memories, not counting the cards for people and projects");
    // No count (a store not read, or one behind its migration): doctor's own detail stands.
    expect(line({ exists: true, named: "~/y" }, "read ~/x, but …")).toBeNull();
    expect(line(undefined)).toBeNull();
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

describe("the self tab, round 3", () => {
  let at: string;
  const ids: Record<string, string> = {};
  const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];

  beforeAll(() => {
    at = mkdtempSync(join(tmpdir(), "counterparts-self-r3-"));
    // Noon in the MACHINE's zone, the one this store dates in, so each moment
    // falls on the date the fixture says it is in every zone. 15:00Z was the
    // next day already in Asia/Tokyo, and noon UTC still was at UTC+14, where
    // S4's dates read a day late (2026-10-09).
    const noonHere = (date: string): number => {
      const [y, m, d] = date.split("-").map(Number) as [number, number, number];
      return new Date(y, m - 1, d, 12).getTime();
    };
    const base = noonHere("2026-09-01");
    let offset = 0;
    const now = (): number => base + offset;
    Counterpart.open({ dir: at, owner: true, identity: { name: "Mike" }, now }).close();
    const c = Counterpart.open({ dir: at, owner: true, now });
    try {
      for (const [i, date] of dates.entries()) {
        offset = noonHere(date) - base;
        c.store.advanceClock(date);
        const d = c.store.livedDay();
        if (i === 0) {
          const put = (body: string, kind: "self" | "fact", emotional: number): string =>
            c.store.put({
              type: "memory",
              kind,
              body,
              salience: { relevance: 0.6, emotional, predictive: 0.6 },
              physics: { birthDay: d, lastUsedDay: d },
              // v9: the core reads what a memory is about, marked by meaning.
              ...(kind === "self" ? { about: "me" as const } : {}),
            });
          ids["felt"] = put("I say what I don't know before I guess.", "self", 0.95);
          ids["mild"] = put("I like short sentences.", "self", 0.1);
          ids["fact"] = put("The deploy runs on push.", "fact", 0.95);
          // Felt just as strongly, but the owner sent it back: the engine refuses it.
          ids["sentBack"] = put("I always know best.", "self", 0.95);
          c.store.appendCoreEvent({ memoryId: ids["sentBack"], action: "demoted", day: d, actor: "owner", reason: "not who I am" });
          c.revisePage(PAGE_1, { reason: "first", by: "writer", day: d });
        }
        if (i >= 2) {
          c.episodeAsk(`r3-${i}`, { turns: 10, bytes: 6200 }, d);
          const out = c.appendEpisode(`r3-${i}`, `Day ${i + 1} went quietly.\n\nMore after the first line, on day ${i + 1}.`, { day: d, title: `Day ${i + 1}`, happenedOn: date });
          if (!out.appended) throw new Error(`chapter refused: ${String(out.reason)}`);
        }
        if (i === 3) {
          const begun = c.dreams.begin({ session: "r3-dream", scope: "/p" });
          if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
          c.dreams.journal({ dream: begun.bundle.dream, session: "r3-dream", title: "A dream", text: "Dreamed." });
        }
      }
    } finally {
      c.close();
    }
  });

  afterAll(() => rmSync(at, { recursive: true, force: true }));

  test("S1: a page some lived days behind says when it was written and what was lived since", () => {
    const v = withSource(at, (src) => mindView(src));
    const b = v.pageBehind;
    if (b === null) throw new Error("expected the page to read as behind");
    expect(b.livedDays).toBe(3);
    expect(b.livedDays).toBeGreaterThanOrEqual(PAGE_BEHIND_LIVED_DAYS);
    expect(b.chapters).toBe(2);
    expect(b.dreams).toBe(1);
    expect(b.line).toBe(pageBehindWords(b));
    expect(b.line).toMatch(/^Written [A-Z][a-z]{2} \d{1,2}(st|nd|rd|th)(, \d{4})? — 3 lived days, 2 chapters and a dream since\.$/);
  });

  test("S1: the words read naturally for one of a thing, many, and none", () => {
    const w = (livedDays: number, chapters: number, dreams: number, date = "2026-09-24"): string =>
      pageBehindWords({ date, writtenDay: 3, livedDays, chapters, dreams });
    // The date is the dashboard's one style ("Sep 24th", the year when it is not this one).
    expect(w(3, 14, 1)).toMatch(/^Written Sep 24th(, 2026)? — 3 lived days, 14 chapters and a dream since\.$/);
    expect(w(2, 1, 0)).toMatch(/^Written Sep 24th(, 2026)? — 2 lived days and a chapter since\.$/);
    expect(w(4, 0, 2)).toMatch(/^Written Sep 24th(, 2026)? — 4 lived days and 2 dreams since\.$/);
    expect(w(2, 0, 0)).toMatch(/^Written Sep 24th(, 2026)? — 2 lived days since\.$/);
    expect(w(2, 0, 0, "")).toBe("Written on lived day 3 — 2 lived days since.");
  });

  test("S1: a page one lived day behind says nothing", () => {
    const fresh = mkdtempSync(join(tmpdir(), "counterparts-self-r3-fresh-"));
    try {
      Counterpart.open({ dir: fresh, owner: true, identity: { name: "Mike" } }).close();
      const c = Counterpart.open({ dir: fresh, owner: true });
      try {
        c.store.advanceClock("2026-09-01");
        const d = c.store.livedDay();
        c.revisePage(PAGE_1, { reason: "first", by: "writer", day: d });
        c.store.advanceClock("2026-09-02");
      } finally {
        c.close();
      }
      // One lived day behind is an ordinary night, not worth a line.
      expect(withSource(fresh, (src) => mindView(src)).pageBehind).toBeNull();
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("S3: a strongly felt memory shows the fast lane's one return, from the engine's verdict", () => {
    withSource(at, (src) => {
      const v = mindView(src);
      const day = src.store.livedDay();
      const felt = v.settling.candidates.find((c) => c.id === ids["felt"]);
      const mild = v.settling.candidates.find((c) => c.id === ids["mild"]);
      expect(felt?.oneReturnAway).toBe(true);
      expect(mild?.oneReturnAway).toBe(false);
      // The owner's demotion is part of the engine's context, as sleep passes it:
      // a memory he sent back is out of the core and not on its way, so it is
      // counted apart, never drawn as "one return away".
      expect(src.store.coreDemoted(ids["sentBack"] as string)).toBe(true);
      expect(v.settling.candidates.some((c) => c.id === ids["sentBack"])).toBe(false);
      expect(v.settling.sentBack).toBe(1);
      for (const c of v.settling.candidates) {
        const verdict = promotionEligibility(src.store.physicsOf(c.id), { aboutMe: true, day, demoted: src.store.coreDemoted(c.id) });
        expect(c.oneReturnAway).toBe(oneReturnAway(verdict));
      }
      // A fact is never a candidate, however strongly felt.
      expect(v.settling.candidates.some((c) => c.id === ids["fact"])).toBe(false);
    });
  });

  test("S3: one return away is read only off the verdict", () => {
    const verdict = (intensity: number, met: boolean, blockedBy: string[]): Parameters<typeof oneReturnAway>[0] =>
      ({ fast: { met, intensity, needIntensity: 0.6, gap: null, needGap: 1 }, blockedBy }) as never;
    expect(oneReturnAway(verdict(0.9, false, ["no-lane-yet"]))).toBe(true);
    expect(oneReturnAway(verdict(0.3, false, ["no-lane-yet"]))).toBe(false);
    expect(oneReturnAway(verdict(0.9, true, []))).toBe(false);
    // Blocked for any other reason (sent back by the owner, not about me): not one return away.
    expect(oneReturnAway(verdict(0.9, false, ["demoted-by-owner", "no-lane-yet"]))).toBe(false);
    expect(oneReturnAway(verdict(0.9, false, ["not-about-me", "no-lane-yet"]))).toBe(false);
  });

  test("S4: every journal day carries its calendar date, and the strip shows one format and a labelled count", () => {
    const v = withSource(at, (src) => mindView(src));
    expect(v.journal.map((d) => d.iso)).toEqual(["2026-09-04", "2026-09-03"]);
    expect(headingIso("Thu 16 Jul 2026")).toBe("2026-07-16");
    expect(headingIso("Wed, 3 Jun 2026")).toBe("2026-06-03");
    expect(headingIso("lived day 3")).toBeNull();
    expect(headingIso(null)).toBeNull();
    // A dated day shows its date the side column's way; a lived day is never passed off as a date.
    expect(dayLabel({ day: 3, iso: "2026-09-04" })).toMatch(/^Sep 4th(, 2026)?$/);
    expect(dayLabel({ day: 3, iso: null })).toBe("lived day 3");
    expect(chapterCount(1)).toBe("1 chapter");
    expect(chapterCount(11)).toBe("11 chapters");
  });

  test("S4: a chapter whose heading named no date falls back to its entry's own date", () => {
    const x = mkdtempSync(join(tmpdir(), "counterparts-self-r3-undated-"));
    try {
      Counterpart.open({ dir: x, owner: true }).close();
      const c = Counterpart.open({ dir: x, owner: true });
      try {
        c.store.advanceClock("2026-09-01");
        c.store.put({
          type: "episode",
          kind: "self",
          title: "An old entry",
          body: "## chapter 1 — lived day 1\n\nWritten before headings carried a date.",
          salience: { relevance: 0.5, emotional: 0.2, predictive: 0.2 },
          happenedOn: "2026-08-30",
          physics: { birthDay: 1, lastUsedDay: 1 },
        });
      } finally {
        c.close();
      }
      const v = withSource(x, (src) => mindView(src));
      expect(v.journal.length).toBe(1);
      expect(v.journal[0]?.date).toBeNull();
      expect(v.journal[0]?.iso).toBe("2026-08-30");
    } finally {
      rmSync(x, { recursive: true, force: true });
    }
  });
});
