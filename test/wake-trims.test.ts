/**
 * THE WAKE TRIMS (2026-10-16; Mike, lightly held, review 2026-10-18 —
 * docs/decisions.d/wake-trims-1016.md): one tag line, the date once, a
 * shorter header, the page's target at 4,600, the craft lane out of the wake,
 * and "Coming up" = today. One test group per change, each against the
 * switch or constant that reverts it.
 *
 * Hermetic: every store is a temp dir made and removed here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { wakeArrivalFindings } from "../src/adapters/claude-code/doctor.js";
import { readWakeArrival } from "../src/adapters/claude-code/transcript.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { ONE_TAG, ONE_TAG_LINE, wakeTagLead } from "../src/adapters/store-id.js";
import { episodeGate } from "../src/core/bridge.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_MARKER as HANDOFF_WAKE_MARKER } from "../src/core/handoff/index.js";
import { YESTERDAY_UNDATED_AT_START, yesterdayLine } from "../src/core/handoff/last-here.js";
import {
  COLLAPSED_WORDS,
  FRAMING,
  HEAD_STATES_DAY,
  HOW_I_WORK_RULE,
  LEGACY_CONTEXT,
  NONE_TODAY_WORDS,
  PAGE_DATELINE_TODAY,
  PAGE_HOST_BUDGET_BYTES,
  PAGE_ROOM_BYTES,
  PAGE_WRITING_RULE,
  PREFACE_RESERVE_BYTES,
  PUBLISHED_WORDS,
  SELF_TUNABLES,
  SHORT_DATES,
  SHORT_PREFACE,
  Self,
  WAKE_SYSTEM,
  WAKE_WHOLE_SENTENCE,
  applyPreface,
  arrivingTense,
  collapsedLane,
  collapsedLine,
  moreLine,
  countedLanes,
  datePrefix,
  deliveryReserveBound,
  pageDateline,
  pageRoomBytes,
  prefaceLine,
  readSentinel,
} from "../src/core/self/index.js";
import type { Lanes } from "../src/core/self/index.js";
import { rankLanes, scanActive } from "../src/core/self/identity.js";
import { CUE_MODE_META } from "../src/core/prospective/index.js";
import { Store } from "../src/core/store/index.js";
import { dayOfShort, localDate, shortDay, yearOf } from "../src/core/time.js";

// The sidebar mod's own module, outside this project's type-check (extensionless imports; `tsc -p hooks/sidebar` checks it).
const FEED_TS: string = "../hooks/sidebar/hooks/feed.ts";
const { ONBOARDING_MARKER, STORE_MARKER, parseOnboardingMarker, parseStoreMarker } = (await import(FEED_TS)) as {
  ONBOARDING_MARKER: RegExp;
  STORE_MARKER: RegExp;
  parseOnboardingMarker: (text: string) => string | null;
  parseStoreMarker: (text: string) => string | null;
};

const ZONE = "UTC";
const BUDGET = 9_000;
const T0 = Date.parse("2026-10-16T15:37:00Z");
const TODAY = "2026-10-16";

let root: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-trims-")));
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

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
const SALIENT = { relevance: 0.9, emotional: 0.8, predictive: 0.8 } as const;

function freshStore(now: number = T0): Store {
  const s = Store.open({ dir: mkdtempSync(join(root, "s-")), now: () => now, timeZone: ZONE });
  open.push(s);
  return s;
}

/** A counterpart on a pinned clock, with a page, open questions, a skill, and three dated items. */
function world(opts: { page?: boolean } = {}): { c: Counterpart; ids: Record<string, string>; now: { t: number } } {
  const now = { t: T0 };
  const c = Counterpart.open({ dir: join(root, "store"), owner: true, budgetBytes: BUDGET, now: () => now.t, timeZone: ZONE });
  open.push(c);
  if (opts.page !== false) {
    expect(c.revisePage("## Core\n\nI keep the garden's ledger.\n\n## Lately\n\nThe beans are in.", { by: "owner", reason: "a page" }).written).toBe(true);
  }
  const ids: Record<string, string> = {
    open: c.store.put({ type: "memory", kind: "fact", body: "Whether the north bed wants lime this autumn.", meta: { unresolved: true }, salience: SALIENT }),
    skill: c.store.put({ type: "memory", kind: "skill", body: "Drain the irrigation hose before a hard frost, or the coupling splits.", salience: { relevance: 1, emotional: 1, predictive: 1 } }),
    today: c.store.put({ type: "memory", kind: "person", body: "The seed order closes at noon; the list is in the green folder.", learnedOn: "2026-10-11", eventDate: TODAY, salience: SALIENT }),
    past: c.store.put({ type: "memory", kind: "person", body: "Return the borrowed tiller to the neighbour.", learnedOn: "2026-10-10", eventDate: "2026-10-15", salience: SALIENT }),
    later: c.store.put({ type: "memory", kind: "person", body: "Check how the compost heap is holding its heat.", learnedOn: "2026-10-15", eventDate: "2026-10-18", salience: SALIENT }),
  };
  return { c, ids, now };
}

/** A Claude Code session start on `w`, as the hook builds its injection. */
function sessionStart(w: { c: Counterpart; now: { t: number } }, session = "a1b2c3d4-0000-4000-8000-000000000001"): string {
  const HERE = join(root, "garden");
  mkdirSync(HERE, { recursive: true });
  const hooks = new ClaudeCodeAdapter({
    counterpart: w.c,
    config: { dataDir: w.c.store.dir, owner: true, injectionBudgetBytes: BUDGET, timeZone: ZONE },
    configPath: join(root, "claude-code.json"),
    now: () => w.now.t,
    scope: { mode: "on", matched: HERE, entry: null } as ScopeVerdict,
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 4242 }),
  });
  return hooks.sessionStart({ sessionId: session, scope: HERE, at: TODAY, transcriptPath: join(root, `${session}.jsonl`) } as HookInput).injection ?? "";
}

/** The lines under a heading, to the blank line that ends the lane. */
function lane(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const at = lines.indexOf(heading);
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() === "") break;
    out.push(l);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. One tag line
// ═══════════════════════════════════════════════════════════════════════════

describe("1. the three top tags are one line", () => {
  test("the 10-16 switch is on (one tag, 2026-10-20, rides on it); its markers go before the wake's head on its line, or on their own before any other text", () => {
    expect(ONE_TAG_LINE).toBe(true);
    expect(ONE_TAG).toBe(true);
    expect(HEAD_STATES_DAY).toBe(false);
    const meet = "<!-- counterparts:onboarding meet=done -->";
    const store = "<!-- counterparts:store id=st_0123456789abcdef -->";
    expect(wakeTagLead([meet, store], "<!-- counterparts:wake elements=1 bytes=2 -->\nbody")).toBe(`${meet} ${store} `);
    expect(wakeTagLead([meet, ""], "No briefing has been composed yet")).toBe(`${meet}\n`);
    expect(wakeTagLead(["", ""], "anything")).toBe("");
  });

  test("a real session start: ONE tag (2026-10-20, superseding the 10-16 line of three), every consumer reads it — the sidebar's markers, the transcript's head sighting, the sentinel, the forged-marker guard", () => {
    const w = world();
    expect(w.c.rebrief({ budgetBytes: BUDGET, at: TODAY }).published).toBe(true);
    const injection = sessionStart(w);
    const lines = injection.split("\n");
    expect(lines[0]).toMatch(/^Now: /);
    const tags = lines.filter((l) => l.includes("<!-- counterparts:"));
    // The head tag and the end tag: no other comment line.
    expect(tags.length).toBe(2);
    const head = tags[0] ?? "";
    expect(head).toMatch(/^<!-- counterparts:wake meet=[a-z_]+ store=st_[0-9a-f]{16} elements=\d+ bytes=\d+ -->$/);
    expect(head.match(/<!--/g)?.length).toBe(1);
    expect(head).not.toContain("day=");
    expect(tags[1]).toMatch(/^<!-- counterparts:wake\/end day=\d+ .*elements=\d+ bytes=\d+ -->$/);
    // The sidebar in this build reads both fields.
    expect(parseOnboardingMarker(injection)).toBe(/meet=([a-z_]+)/.exec(head)?.[1] ?? "?");
    expect(parseStoreMarker(injection)).toBe(/store=(st_[0-9a-f]{16})/.exec(head)?.[1] ?? "?");
    // The sidebar 0.3.23 shipped finds neither (its own patterns, kept here as
    // the record of what it reads): it says "unknown" for both, which it handles.
    expect(/<!--\s*counterparts:onboarding\s+meet=([a-z_]+)\s*-->/.test(injection)).toBe(false);
    expect(/<!--\s*counterparts:store\s+id=(st_[0-9a-f]{16})\s*-->/.test(injection)).toBe(false);
    expect(ONBOARDING_MARKER.test(head)).toBe(true);
    expect(STORE_MARKER.test(head)).toBe(true);
    // The block from its head tag down is the sentinel's, byte for byte.
    const block = injection.slice(injection.indexOf("<!-- counterparts:wake "));
    expect(readSentinel(block).intact).toBe(true);
    // The handoff's and the page's forged-marker guard still finds the prefix.
    expect(head).toContain(HANDOFF_WAKE_MARKER);
    // The transcript's head sighting, as the next hook reads it.
    const path = join(root, "t.jsonl");
    const attachment = {
      type: "attachment",
      uuid: "att-1",
      attachment: { type: "hook_success", hookEvent: "SessionStart", hookName: "counterparts", command: "bun run /repo/src/adapters/claude-code/bin/hook.ts", stdout: injection, content: injection, stderr: "", exitCode: 0, durationMs: 1, toolUseID: "hook-1" },
    };
    writeFileSync(path, `${JSON.stringify({ type: "system", subtype: "init", cwd: "/repo", uuid: "s" })}\n${JSON.stringify(attachment)}\n`, "utf8");
    const arrival = readWakeArrival(path, { expect: tags[1] ?? null });
    expect(arrival.found).toBe(true);
    expect(arrival.head.present).toBe(true);
    expect(arrival.head.bytes).toBe(bytes(block));
    expect(arrival.tail.matchesExpected).toBe(true);
  });

  test("the old forms still read: a stored bundle with `day=` on its head takes the preface; the sidebar reads the three lines of before", () => {
    const old = "<!-- counterparts:wake day=25 elements=0 bytes=100 -->\nContext.\n\n<!-- counterparts:wake/end day=25 identity=0 craft=0 threads=0 hints=0 horizon=0 elements=0 bytes=100 -->";
    const spliced = applyPreface(old, "Counterparts memory, day 25 · 3 memories.");
    expect(spliced.applied).toBe(true);
    expect(readSentinel(spliced.text).intact).toBe(true);
    const three = "<!-- counterparts:onboarding meet=done -->\n<!-- counterparts:store id=st_0123456789abcdef -->\n<!-- counterparts:wake day=25 elements=3 bytes=8885 -->";
    expect(parseOnboardingMarker(three)).toBe("done");
    expect(parseStoreMarker(three)).toBe("st_0123456789abcdef");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The date once
// ═══════════════════════════════════════════════════════════════════════════

describe("2. today's date is said once, on the Now: line", () => {
  test("the switches are on", () => {
    expect(SHORT_PREFACE).toBe(true);
    expect(SHORT_DATES).toBe(true);
    expect(YESTERDAY_UNDATED_AT_START).toBe(true);
    expect(PAGE_DATELINE_TODAY).toBe(false);
  });

  test("a real session start: the date on the Now: line and nowhere else — not the header, not Yesterday, not the page's dateline", async () => {
    const w = world();
    // Yesterday's chapter, so there is a Yesterday line.
    w.now.t = Date.parse("2026-10-15T15:00:00Z");
    w.c.store.advanceClock("2026-10-15");
    w.c.store.put({ type: "episode", kind: "self", title: "Beans in", body: "## 2026-10-15 — Beans in\n\nWe put the beans in the north bed.", meta: { episodeId: "epi_000000000001" } });
    w.now.t = T0;
    w.c.store.advanceClock(TODAY);
    expect(w.c.rebrief({ budgetBytes: BUDGET, at: TODAY }).published).toBe(true);
    const injection = sessionStart(w);
    expect(injection.split("\n")[0]).toBe("Now: Fri 16 Oct 2026, 3:37 pm UTC");
    const wake = injection.slice(injection.indexOf("<!-- counterparts:wake "));
    // An item's own date may be today's ("due Oct 16"); the furniture never says it.
    const furniture = wake.split("\n").filter((l) => !l.startsWith("- ")).join("\n");
    for (const said of ["2026-10-16", "Oct 16", "16 Oct"]) expect(furniture).not.toContain(said);
    expect(wake).not.toContain("Last revised");
    expect(wake).toContain("Counterparts memory, day ");
    const yesterday = wake.split("\n").find((l) => l.startsWith("Yesterday"));
    if (yesterday !== undefined) expect(yesterday).toStartWith("Yesterday: ");
  });

  test("the page's dateline: not on the day it was revised, any other day as before, and the stale notice always", () => {
    expect(pageDateline(TODAY, false, 14, TODAY)).toBeNull();
    expect(pageDateline("2026-10-15", false, 14, TODAY)).toBe("(Last revised 2026-10-15.)");
    expect(pageDateline("2026-09-01", true, 14, TODAY)).toBe("(Last revised 2026-09-01 — more than 14 days before this wake was composed.)");
    expect(pageDateline(TODAY, false, 14)).toBe(`(Last revised ${TODAY}.)`);
  });

  test("Yesterday: dated in the published bundle, undated at a session start", () => {
    const day = [{ id: "epi_000000000001", title: "Beans in", chapters: 1, createdAt: 1 }];
    expect(yesterdayLine(day, "2026-10-15")).toBe('Yesterday, Oct 15: "Beans in" (epi_000000000001).');
    expect(yesterdayLine(day, "2026-10-15", undefined, [], false)).toBe('Yesterday: "Beans in" (epi_000000000001).');
  });

  test("item dates: `Oct 15`, `Oct 15 (due Oct 18)`, no year in the wake's own year — and whole in any other, so a date never reads as the wrong year", () => {
    expect(shortDay("2026-10-15", "2026")).toBe("Oct 15");
    expect(shortDay("2026-01-05", "2026")).toBe("Jan 5");
    expect(shortDay("2025-12-31", "2026")).toBe("2025-12-31");
    expect(shortDay("2026-10", "2026")).toBe("2026-10");
    expect(shortDay("2026-10-15", undefined)).toBe("2026-10-15");
    expect(yearOf("2026-10-16")).toBe("2026");
    const y = "2026";
    expect(datePrefix({ statement: "x", learnedOn: "2026-10-15", year: y })).toBe("Oct 15 · ");
    expect(datePrefix({ statement: "x", learnedOn: "2026-10-15", due: "2026-10-18", year: y })).toBe("Oct 15 (due Oct 18) · ");
    expect(datePrefix({ statement: "x", learnedOn: "2026-10-15", due: "2026-10-14", duePast: true, year: y })).toBe("Oct 15 (was due Oct 14) · ");
    expect(datePrefix({ statement: "x", learnedOn: "2026-10-15", due: "2026-10-15", year: y })).toBe("due Oct 15 · ");
    expect(datePrefix({ statement: "x", learnedOn: "2025-12-30", due: "2026-01-02", year: y })).toBe("2025-12-30 (due Jan 2) · ");
    expect(datePrefix({ statement: "x", learnedOn: "2026-09-03", boundedDate: true, year: y })).toBe("by Sep 3 · ");
    expect(datePrefix({ statement: "x", learnedOn: "2026-09-01", happenedOn: "2026-10-14", year: y })).toBe("Sep 1 (of Oct 14) · ");
    // No year handed: whole, as before.
    expect(datePrefix({ statement: "x", learnedOn: "2026-10-15" })).toBe("2026-10-15 · ");
  });

  test("the tense reads a short date as the day nearest today, and keeps its form", () => {
    expect(dayOfShort("Oct 15", TODAY)).toBe("2026-10-15");
    expect(dayOfShort("Dec 31", "2027-01-01")).toBe("2026-12-31");
    expect(dayOfShort("Jan 2", "2026-12-30")).toBe("2027-01-02");
    expect(dayOfShort("Feb 30", TODAY)).toBeNull();
    const body = ["<!-- counterparts:wake elements=2 bytes=1 -->", FRAMING.context, "", FRAMING.horizon, "- Oct 1 (due Oct 15) · Yesterday's.", "- due Oct 12 · Days ago.", "- Oct 1 (due Oct 16) · Today's.", "", "<!-- counterparts:wake/end day=3 elements=2 bytes=1 -->"].join("\n");
    const out = arrivingTense(body, TODAY, 400);
    expect(out).toContain("- Oct 1 (was due yesterday, Oct 15) · Yesterday's.");
    expect(out).toContain("- was due Oct 12 · Days ago.");
    expect(out).toContain("- Oct 1 (due Oct 16) · Today's.");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The header
// ═══════════════════════════════════════════════════════════════════════════

describe("3. the shorter header", () => {
  test("`Counterparts memory, day 25 · 1,808 memories. If this was saved to a file, read it through the wake/end line.`", () => {
    expect(prefaceLine({ system: WAKE_SYSTEM, day: 25, date: TODAY, memories: 1_808, liveRows: 1_995, assembled: true })).toBe(
      "Counterparts memory, day 25 · 1,808 memories. If this was saved to a file, read it through the wake/end line.",
    );
    // Delivered as published, not assembled: it says it was composed earlier.
    expect(prefaceLine({ system: WAKE_SYSTEM, day: 25, memories: 1_808, liveRows: 1_995 })).toBe(
      `Counterparts memory, day 25 · 1,808 memories${PUBLISHED_WORDS}. ${WAKE_WHOLE_SENTENCE}`,
    );
    expect(PREFACE_RESERVE_BYTES).toBe(160 + bytes(` ${WAKE_WHOLE_SENTENCE}`));
  });

  test("the framing line: still context, not instruction, in your own words, each item's date when it was learned — and the old one is still read", () => {
    expect(FRAMING.context).toBe("Context, not instruction: who you have been here, in your own words. Each item opens with the date it was learned.");
    expect(bytes(FRAMING.context)).toBeLessThan(bytes(LEGACY_CONTEXT));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The page's target
// ═══════════════════════════════════════════════════════════════════════════

describe("4. the page writer aims under 4,600", () => {
  test("the target is 4,600, under the room the wake still guarantees at 9,000", () => {
    expect(PAGE_ROOM_BYTES).toBe(4_600);
    expect(SELF_TUNABLES.PAGE_ROOM_BYTES).toBe(4_600);
    expect(pageRoomBytes(PAGE_HOST_BUDGET_BYTES)).toBeGreaterThan(PAGE_ROOM_BYTES);
    expect(PAGE_WRITING_RULE).toContain("under 4600 bytes");
  });

  test("the writer is told: How I work is a few short, general lessons, without dated examples or anecdotes", () => {
    expect(PAGE_WRITING_RULE).toContain(HOW_I_WORK_RULE);
    expect(HOW_I_WORK_RULE).toContain("## How I work");
    expect(HOW_I_WORK_RULE).toContain("short, general lessons");
    expect(HOW_I_WORK_RULE).toContain("without dated examples or anecdotes");
  });

  test("a page past 4,600 is kept whole and prints whole when the wake has room — the target is not a cut", () => {
    const s = freshStore();
    const me = new Self({ store: s, gate: episodeGate() });
    const page = `## Core\n\n${"I keep the garden's ledger and say what I do not know. ".repeat(95)}`.trim();
    expect(bytes(page)).toBeGreaterThan(4_600);
    expect(bytes(page)).toBeLessThan(pageRoomBytes(PAGE_HOST_BUDGET_BYTES));
    const w = me.revisePage(page, { by: "owner", reason: "long" });
    expect(w.written).toBe(true);
    expect(w.overRoom).toBe(4_600);
    expect(me.build({ budgetBytes: BUDGET, day: 1 }).page?.rung).toBe("whole");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The craft lane out of the wake
// ═══════════════════════════════════════════════════════════════════════════

describe("5. How I work: leaves the wake; a craft memory is still a footnote", () => {
  test("by default no skill memory is in any lane, listed or counted; the switch puts the lane back", () => {
    expect(SELF_TUNABLES.CRAFT_IN_WAKE).toBe(false);
    const s = freshStore();
    for (let i = 0; i < 3; i += 1) s.put({ type: "memory", kind: "skill", body: `Craft ${String(i)}: label the seed trays the day they are sown.`, salience: { relevance: 1, emotional: 1, predictive: 1 } });
    s.put({ type: "memory", kind: "fact", body: "The bus route changed and adds ten minutes.", salience: SALIENT });
    const off = new Self({ store: s }).build({ budgetBytes: 40_000, day: 0 });
    expect(off.text).not.toContain(FRAMING.craft);
    expect(off.text).not.toContain("Craft 0");
    expect(off.counts.craft).toBe(0);
    expect(countedLanes(off.text).craft).toBeUndefined();
    const lanes: Lanes = rankLanes(scanActive(s, 0), [], SELF_TUNABLES);
    expect([...lanes.craft, ...lanes.hints].map((r) => r.kind)).not.toContain("skill");
    // Back on: the lane as before.
    const on = new Self({ store: s, tunables: { CRAFT_IN_WAKE: true, CRAFT_AT_DELIVERY: false } }).build({ budgetBytes: 40_000, day: 0 });
    expect(on.counts.craft).toBe(3);
    expect(on.text).toContain(FRAMING.craft);
  });

  test("a craft memory still comes up per turn when the turn reaches it — recall's gate has no kind it leaves out", () => {
    const now = { t: T0 };
    const c = Counterpart.open({ dir: join(root, "recall"), owner: true, budgetBytes: BUDGET, now: () => now.t, timeZone: ZONE });
    open.push(c);
    for (const body of ["The library closes early on Sundays now.", "Ran the morning loop around the reservoir."]) c.store.put({ type: "memory", kind: "fact", body, salience: SALIENT });
    const skill = c.store.put({ type: "memory", kind: "skill", body: "Drain the irrigation hose before a hard frost, or the coupling splits.", salience: { relevance: 1, emotional: 1, predictive: 1 } });
    const out = c.recallForTurn({ sessionId: "s1", text: "should I drain the irrigation hose before the frost tonight" });
    expect([...out.decision.surfaced, ...out.decision.footnotes]).toContain(skill);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Coming up = today
// ═══════════════════════════════════════════════════════════════════════════

describe("6. Coming up lists what is due today, and counts the rest — overdue and later — in one line", () => {
  test("a real session start: today's listed; the overdue and the later one counted by id, the overdue said so, and in no other lane", () => {
    expect(SELF_TUNABLES.COMING_UP_TODAY_ONLY).toBe(true);
    const w = world();
    expect(w.c.rebrief({ budgetBytes: BUDGET, at: TODAY }).published).toBe(true);
    const wake = sessionStart(w);
    const coming = lane(wake, FRAMING.horizon);
    const listed = coming.filter((l) => l.startsWith("- "));
    expect(listed.length).toBe(1);
    expect(listed.some((l) => l.includes("The seed order closes at noon; the list is in the green folder. [mem_"))).toBe(true);
    expect(coming[coming.length - 1]).toBe(`(1 overdue, 1 more coming up; recall ids: ${w.ids["past"] ?? ""}, ${w.ids["later"] ?? ""})`);
    expect(wake).not.toContain("compost heap");
    expect(wake).not.toContain("borrowed tiller");
    expect(countedLanes(wake).horizon).toBe(2);
    // A later date counted is the lane doing its job, not a dated item left
    // out for want of room: doctor's Wake line says nothing about it.
    const f = wakeArrivalFindings(w.c.store).find((x) => x.key === "wake");
    expect(f?.detail ?? "").not.toContain("Coming up:");
    expect(f?.data["datedUnlisted"] ?? 0).toBe(0);
  });

  test("nothing due today: one line says so, with the ids — read back by the dashboard's lane reader", () => {
    const s = freshStore();
    const me = new Self({ store: s });
    const a = s.put({ type: "memory", kind: "person", body: "Check the compost heat.", learnedOn: "2026-10-15", eventDate: "2026-10-18", salience: SALIENT });
    const b = s.put({ type: "memory", kind: "person", body: "Order the garlic.", learnedOn: "2026-10-15", eventDate: "2026-10-19", salience: SALIENT });
    const out = me.build({ budgetBytes: 40_000, day: 1, at: TODAY, horizon: [{ id: a, due: "2026-10-18" }, { id: b, due: "2026-10-19" }] });
    const line = `${FRAMING.horizon} 2 — ${NONE_TODAY_WORDS}; recall ids: ${a}, ${b}`;
    expect(out.text.split("\n")).toContain(line);
    expect(out.counts.horizon).toBe(0);
    expect(out.trimmed).toEqual([]);
    expect(collapsedLane(line)).toBe("horizon");
    expect(countedLanes(out.text).horizon).toBe(2);
    // A due item the room left out still says "no room".
    expect(collapsedLine("horizon", [a, b], { horizonLater: [b] })).toContain(COLLAPSED_WORDS);
    // Nothing due today, one of them overdue: said so, and still read back.
    const late = collapsedLine("horizon", [a, b], { horizonLater: [a, b], horizonOverdue: [a] });
    expect(late).toBe(`${FRAMING.horizon} 2 — ${NONE_TODAY_WORDS}, 1 overdue; recall ids: ${a}, ${b}`);
    expect(collapsedLane(late)).toBe("horizon");
    expect(countedLanes(late).horizon).toBe(2);
    // Only overdue, under a listed item: `(2 overdue; …)`, counted as 2.
    const only = moreLine("horizon", [a, b], [a, b]);
    expect(only).toBe(`(2 overdue; recall ids: ${a}, ${b})`);
    expect(countedLanes(only).horizon).toBe(2);
    // Another lane never says overdue.
    expect(moreLine("threads", [a], [a])).toBe(`(1 more still open; recall ids: ${a})`);
    // The switch off: the lane as before, both listed.
    const before = new Self({ store: s, tunables: { COMING_UP_TODAY_ONLY: false } }).build({ budgetBytes: 40_000, day: 1, at: TODAY, horizon: [{ id: a, due: "2026-10-18" }, { id: b, due: "2026-10-19" }] });
    expect(before.counts.horizon).toBe(2);
  });

  test("an item due today that prospective's count left out is listed all the same", () => {
    const s = freshStore();
    const me = new Self({ store: s });
    const later = s.put({ type: "memory", kind: "person", body: "Plant the bulbs.", learnedOn: "2026-10-15", eventDate: "2026-10-17", salience: SALIENT });
    const due = s.put({ type: "memory", kind: "person", body: "Pay the water bill.", learnedOn: "2026-10-15", eventDate: TODAY, salience: SALIENT });
    const out = me.build({ budgetBytes: 40_000, day: 1, at: TODAY, horizon: [{ id: later, due: "2026-10-17" }], horizonMore: [due], horizonMoreItems: [{ id: due, due: TODAY, today: true }] });
    expect(out.kept.horizon).toEqual([due]);
    expect(out.text).toContain(`(1 more coming up; recall ids: ${later})`);
  });

  test("what returns on its own: a plain reminder is said outright on its day, and a date cues recall around it", () => {
    const w = world({ page: false });
    // A plain reminder due today: said under the clock, outside the wake.
    const plain = w.c.store.put({ type: "memory", kind: "person", title: "pay the water bill", body: "Pay the water bill before the office closes.", learnedOn: "2026-10-15", eventDate: TODAY, salience: SALIENT, meta: { [CUE_MODE_META]: "plain" } });
    expect(w.c.plainDueToday({ at: TODAY }).map((r) => r.memoryId)).toContain(plain);
    // A later date is an arrival around it: the cue recall's temporal channel takes.
    expect(w.c.prospective.arrivals({ at: "2026-10-17", day: 2 }).arrivals.map((a) => a.memoryId)).toContain(w.ids["later"] ?? "");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Production scale
// ═══════════════════════════════════════════════════════════════════════════

describe("at production scale, 9,000 bytes", () => {
  const COMPOSE = BUDGET - deliveryReserveBound(BUDGET);
  test("the trimmed wake lists more items than the same store composed the way it was before (page 5,525, craft in, Coming up by date)", () => {
    const build = (page: number, tunables: Partial<typeof SELF_TUNABLES>) => {
      const s = freshStore();
      const me = new Self({ store: s, gate: episodeGate(), tunables });
      const para = "I keep the garden's ledger, I name what I do not know before I guess, and I write down what held.";
      let body = "## Core\n\n";
      while (bytes(body) < page - bytes(para) - 2) body += `${para}\n\n`;
      expect(me.revisePage(body.trim(), { by: "owner", reason: "a long page" }).written).toBe(true);
      const long = (head: string): string => {
        let b = head;
        while (bytes(b) < 550) b += " The detail goes on, as a real memory's first paragraph does, with the steps and the reasons.";
        return b;
      };
      for (let i = 0; i < 3; i += 1) s.put({ type: "memory", kind: "skill", title: `How bed ${String(i)} is turned`, body: long(`Craft ${String(i)}: how the beds are turned.`), salience: { relevance: 1, emotional: 1, predictive: 1 } });
      for (let i = 0; i < 57; i += 1) s.put({ type: "memory", kind: "fact", title: `Does bed ${String(i)} want lime?`, body: long(`Open ${String(i)}: whether bed ${String(i)} wants lime.`), meta: { unresolved: true }, salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 } });
      for (let i = 0; i < 8; i += 1) s.put({ type: "memory", kind: "fact", title: `Compost heap ${String(i)} runs warm`, body: long(`Warm ${String(i)}: the compost heap ${String(i)} runs warm.`), salience: SALIENT });
      const due = ["2026-10-16", "2026-10-18", "2026-10-19", "2026-10-19", "2026-10-21", "2026-10-22", "2026-10-23"];
      const horizon = due.map((d, i) => ({ id: s.put({ type: "memory", kind: "person", title: `Dated ${String(i)}`, body: long(`Dated ${String(i)}: the clay order.`), learnedOn: "2026-10-11", eventDate: d, salience: SALIENT }), due: d, ...(d === TODAY ? { today: true } : {}) }));
      // The composition's own budget at 9,000 under the widest delivery
      // reserves — what "Work here", the handoffs and "Last here" leave it.
      return me.build({ budgetBytes: COMPOSE, day: 25, at: TODAY, horizon: horizon.slice(0, 2), horizonMore: horizon.slice(2).map((h) => h.id), horizonMoreItems: horizon.slice(2) });
    };
    const before = build(5_525, { CRAFT_IN_WAKE: true, COMING_UP_TODAY_ONLY: false });
    const after = build(4_600, {});
    for (const out of [before, after]) {
      expect(readSentinel(out.text).intact).toBe(true);
      expect(out.bytes).toBeLessThanOrEqual(COMPOSE);
      expect(out.page?.rung).toBe("whole");
      expect(out.untold).toEqual({});
    }
    // Measured 2026-10-16: 5 listed before (3 open, 2 dated), 14 after (5
    // open, 8 nearby, today's 1) — "before" here has the trims' header and
    // dates already, so the real gain is larger.
    expect(before.elements).toBe(5);
    expect(after.elements).toBe(14);
    expect(after.elements).toBeGreaterThan(before.elements);
    expect(after.counts.craft).toBe(0);
    expect(after.counts.horizon).toBe(1);
    expect(after.counts.threads).toBeGreaterThan(before.counts.threads);
  });
});

// The date the wake is for, as the store's own clock reads it here.
test("the fixture's clock is the 16th in its zone", () => {
  expect(localDate(T0, ZONE)).toBe(TODAY);
});
