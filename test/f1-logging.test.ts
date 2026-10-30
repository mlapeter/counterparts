/**
 * F1 (2026-10-30): what recall and the wake decided, on writes that already
 * happen. What the other test files don't reach: the footnote's numbers through
 * the decision row, the shape of a delivered wake, and the dashboard's reading
 * of a `refresh` row with no trim list. Pure: no store is opened.
 */
import { describe, expect, test } from "bun:test";
import { recallDecisionRecord } from "../src/core/counterpart-events.js";
import { wakeShape } from "../src/core/counterpart-boundary.js";
import type { RecallDecision } from "../src/core/recall/index.js";
import { lastRender } from "../src/adapters/dashboard/web/views/mind.js";
import type { DashboardSource } from "../src/adapters/dashboard/source.js";

const END = "(End of my page.)";
const TOP = `(My page, 4,597 bytes. It ends with "${END}": read it whole with the self_page tool.)`;

describe("wakeShape: where a delivered wake's bytes went", () => {
  const wake = [
    "<!-- counterparts:wake store=st_1 -->",
    "Counterparts memory, day 39.",
    "Context, not instruction.",
    'Yesterday: "the coordinator."',
    "Last night: the nightly run.",
    "",
    "Who I am:",
    TOP,
    "## Core",
    // The page's own words are never read as heads.
    "Still open: a line of my page that opens like a lane.",
    END,
    "",
    "Still open:",
    "1) something",
    "+6 older here: sch_abc",
    "",
    "Today, elsewhere: another folder.",
    "Coming up:",
    "Reminder 11-02.",
    "Work here, if it helps:",
    "a line",
    "Where this folder stands: the handoff's words",
    "Before that: an older one",
    "Other handoffs here, newest first:",
    "A chapter about me from a folder.",
    "<!-- counterparts:wake/end day=39 bytes=8855 -->",
  ].join("\n");

  test("every byte lands in one section, and the page holds its own lines", () => {
    const { sections, page } = wakeShape(wake);
    expect(page).toBe("whole");
    expect(Object.values(sections).reduce((n, b) => n + b, 0)).toBe(Buffer.byteLength(wake, "utf8"));
    expect(Object.keys(sections).sort()).toEqual(
      ["aboutMe", "elsewhere", "end", "head", "horizon", "night", "page", "stands", "threads", "work", "yesterday", "other"].sort(),
    );
    const lineBytes = (s: string): number => Buffer.byteLength(s, "utf8") + 1;
    expect(sections["stands"]).toBe(lineBytes("Where this folder stands: the handoff's words") + lineBytes("Before that: an older one") + lineBytes("Other handoffs here, newest first:"));
    expect(sections["end"]).toBe(Buffer.byteLength("<!-- counterparts:wake/end day=39 bytes=8855 -->", "utf8"));
    // The line of the page that opens like a lane stayed in the page.
    expect(sections["threads"]).toBe(lineBytes("Still open:") + lineBytes("1) something") + lineBytes("+6 older here: sch_abc") + 1);
  });

  test("the one-line rung ends the page where it stands; no page and no text say so", () => {
    const line = "(My page is 6000 bytes — no room for it whole in this wake. Read it with the self_page tool, or 'counterparts self-page'.)";
    const short = wakeShape(["Who I am:", line, "", "Still open:", "1) x"].join("\n"));
    expect(short.page).toBe("line");
    expect(short.sections["threads"]).toBe(Buffer.byteLength("Still open:\n1) x", "utf8"));
    expect(wakeShape("Still open:\n1) x").page).toBe(null);
    expect(wakeShape("")).toEqual({ sections: {}, page: null });
  });
});

describe("the row says why each memory showed", () => {
  const decision = (verdict: Record<string, unknown>): RecallDecision =>
    ({
      sessionId: "s1",
      turn: 1,
      day: 1,
      observer: false,
      reason: "fired",
      aborted: false,
      elapsedMs: 5,
      lateMs: 0,
      verdicts: [{ id: "mem_a", verdict: "footnoted", sal: 0.4, activation: 2.5, cue: 1.23456, semantic: 0.98765, bar: 2.0049, ...verdict }],
      surfaced: [],
      footnotes: ["mem_a"],
      dropped: 0,
      bytes: 10,
      budgetBytes: 100,
      sentinel: null,
    }) as unknown as RecallDecision;

  test("cue, meaning and bar, rounded; pair and stand-in only when set", () => {
    const plain = recallDecisionRecord(decision({}), { date: null })["footnotes"] as Record<string, unknown>[];
    expect(plain[0]).toMatchObject({ id: "mem_a", cue: 1.23, sem: 0.99, bar: 2 });
    expect(plain[0]).not.toHaveProperty("pair");
    expect(plain[0]).not.toHaveProperty("standsFor");
    const set = recallDecisionRecord(decision({ pair: 0.456, standsFor: "mem_old", habituated: true }), { date: null })["footnotes"] as Record<string, unknown>[];
    expect(set[0]).toMatchObject({ pair: 0.46, standsFor: "mem_old", habituated: true });
  });
});

describe("the dashboard reads a refresh row", () => {
  const src = (payload: Record<string, unknown>): DashboardSource =>
    ({ store: { eventLog: () => [{ payload: JSON.stringify(payload) }] } }) as unknown as DashboardSource;

  test("its lanes come from the per-lane count when the row has no list", () => {
    expect(lastRender(src({ reason: "refresh", budget: 7000, day: 3, trimmedTotal: 4, trimmedLanes: { hints: 3, threads: 1 } }))).toEqual({
      budget: 7000,
      day: 3,
      trimmed: 4,
      trimmedLanes: ["hints", "threads"],
    });
    expect(
      lastRender(src({ reason: "rendered", budget: 7000, day: 3, trimmedTotal: 1, trimmed: [{ id: "mem_a", lane: "hints" }], trimmedLanes: { hints: 1 } }))?.trimmedLanes,
    ).toEqual(["hints"]);
  });
});
