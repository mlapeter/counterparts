/**
 * `core/time.ts` — the one conversion module (docs/time.md, 2026-09-25).
 *
 * The scenarios are the plan's own test cases: travel, a reminder while
 * travelling, a month, across midnight, daylight saving, a server on UTC. Every
 * zone is pinned by name, so the suite passes on any machine in any `TZ`.
 *
 * The last block is rule 1 mechanized: nothing outside `time.ts` builds a date
 * by hand.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { openCounterpart, zoneBeside } from "../src/adapters/cli/commands.js";

import {
  addDays,
  calendarCovers,
  calendarOverlaps,
  compareCalendarDates,
  daysBetween,
  isCalendarDate,
  isZone,
  localClock,
  localDate,
  machineZone,
  monthBounds,
  parseCalendarDate,
  readableDate,
  resolveZone,
  todayIn,
  utcDate,
} from "../src/core/time.js";
import { loadConfig } from "../src/adapters/claude-code/config.js";

/** 2026-09-26 05:50 UTC = 2026-09-25 23:50 in Denver (MDT, UTC−6). */
const LATE_EVENING_DENVER = Date.UTC(2026, 8, 26, 5, 50);

describe("a moment, in a zone", () => {
  test("across midnight: 11:50 pm local belongs to that local day, not the UTC one", () => {
    expect(localDate(LATE_EVENING_DENVER, "America/Denver")).toBe("2026-09-25");
    expect(utcDate(LATE_EVENING_DENVER)).toBe("2026-09-26");
  });

  test("travel: the same moment reads in whatever zone it is viewed from", () => {
    const at = Date.UTC(2026, 8, 25, 19, 40); // 1:40 pm MDT
    expect(localClock(at, "America/Denver")).toBe("Fri 25 Sep 2026, 1:40 pm MDT");
    expect(localClock(at, "America/New_York")).toBe("Fri 25 Sep 2026, 3:40 pm EDT");
    expect(localClock(at, "Pacific/Honolulu")).toBe("Fri 25 Sep 2026, 9:40 am HST");
  });

  test("daylight saving is the zone's rules, not an offset", () => {
    // 2026-11-01 is the fall-back day in the US.
    const before = Date.UTC(2026, 9, 31, 18, 0);
    const after = Date.UTC(2026, 10, 2, 18, 0);
    expect(localClock(before, "America/Denver")).toContain("MDT");
    expect(localClock(after, "America/Denver")).toContain("MST");
    expect(localClock(after, "America/Denver")).toBe("Mon 2 Nov 2026, 11:00 am MST");
  });

  test("a server on UTC: a configured zone overrides the machine's", () => {
    expect(resolveZone("America/Denver")).toBe("America/Denver");
    expect(resolveZone("UTC")).toBe("UTC");
    expect(todayIn("America/Denver", LATE_EVENING_DENVER)).toBe("2026-09-25");
    expect(todayIn("UTC", LATE_EVENING_DENVER)).toBe("2026-09-26");
  });

  test("an unknown zone name falls back to the machine's zone, never throws", () => {
    expect(isZone("Mars/Olympus")).toBe(false);
    // An offset is not a zone: it has no daylight-saving rules (review N5).
    expect(isZone("+05:30")).toBe(false);
    expect(isZone("-07:00")).toBe(false);
    expect(isCalendarDate("0000")).toBe(false);
    expect(isCalendarDate("0000-01-01")).toBe(false);
    expect(isZone("")).toBe(false);
    expect(isZone(42)).toBe(false);
    expect(resolveZone("Mars/Olympus")).toBe(machineZone());
    expect(resolveZone(undefined)).toBe(machineZone());
    expect(localDate(LATE_EVENING_DENVER, "Mars/Olympus")).toBe(localDate(LATE_EVENING_DENVER));
  });

  test("a moment that is not a number reads as empty", () => {
    expect(localDate(Number.NaN, "UTC")).toBe("");
    expect(localClock(Number.NaN, "UTC")).toBe("");
    expect(utcDate(Number.NaN)).toBe("");
  });
});

describe("calendar dates, as a person says them", () => {
  test("day, month, year and range each read at their own precision", () => {
    expect(parseCalendarDate("2026-10-15")).toEqual({
      text: "2026-10-15",
      precision: "day",
      first: "2026-10-15",
      last: "2026-10-15",
    });
    expect(parseCalendarDate("2026-02")).toEqual({
      text: "2026-02",
      precision: "month",
      first: "2026-02-01",
      last: "2026-02-28",
    });
    expect(parseCalendarDate("2028-02")?.last).toBe("2028-02-29");
    expect(parseCalendarDate("2026")?.precision).toBe("year");
    expect(parseCalendarDate("2026-10-20..2026-10-31")).toEqual({
      text: "2026-10-20..2026-10-31",
      precision: "range",
      first: "2026-10-20",
      last: "2026-10-31",
    });
  });

  test("what is not a date is refused, never guessed", () => {
    for (const bad of ["2026-02-30", "2026-13", "2026-10-31..2026-10-20", "Oct 15", "2026-10-1", "", "a..b..c"]) {
      expect(parseCalendarDate(bad)).toBeNull();
      expect(isCalendarDate(bad)).toBe(false);
    }
  });

  test("a month is a month: it never becomes a day", () => {
    const m = parseCalendarDate("2026-10");
    expect(m?.text).toBe("2026-10");
    expect(calendarCovers("2026-10", "2026-10-01")).toBe(true);
    expect(calendarCovers("2026-10", "2026-10-31")).toBe(true);
    expect(calendarCovers("2026-10", "2026-11-01")).toBe(false);
  });

  test("a reminder while travelling: Oct 15 is Oct 15 in every zone", () => {
    // Saved in Montana, the date is text; asked on the 15th in New York or
    // Hawaii, "today" is each zone's own 15th and the date covers it.
    const inNewYork = Date.UTC(2026, 9, 15, 4, 30); // 00:30 EDT on the 15th
    const inHawaii = Date.UTC(2026, 9, 16, 9, 0); // 23:00 HST on the 15th
    expect(calendarCovers("2026-10-15", todayIn("America/New_York", inNewYork))).toBe(true);
    expect(calendarCovers("2026-10-15", todayIn("Pacific/Honolulu", inHawaii))).toBe(true);
  });

  test("overlap and order across precisions", () => {
    expect(calendarOverlaps("2026-10-20..2026-10-31", "2026-10-30", "2026-11-05")).toBe(true);
    expect(calendarOverlaps("2026-10-20..2026-10-31", "2026-11-01", "2026-11-05")).toBe(false);
    const sorted = ["2026-11", "2026-10-15", "2026-10", "2026-10-20..2026-10-31", "2026"].sort(compareCalendarDates);
    expect(sorted).toEqual(["2026", "2026-10", "2026-10-15", "2026-10-20..2026-10-31", "2026-11"]);
  });

  test("arithmetic on labels, exact across months, leap years and centuries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2000-02-28", "2000-03-01")).toBe(2);
    expect(daysBetween("2100-02-28", "2100-03-01")).toBe(1);
    expect(monthBounds("2026-09")).toEqual({ first: "2026-09-01", last: "2026-09-30" });
    expect(monthBounds("2026-09-01")).toBeNull();
    expect(() => addDays("2026-02-30", 1)).toThrow();
  });

  test("readableDate names the weekday of the label, in no zone at all", () => {
    expect(readableDate("2026-09-23")).toBe("Wed 23 Sep 2026");
    expect(readableDate("2026-09-25")).toBe("Fri 25 Sep 2026");
    expect(readableDate("1970-01-01")).toBe("Thu 1 Jan 1970");
    expect(readableDate("1969-12-31")).toBe("Wed 31 Dec 1969");
    expect(readableDate("2026-09")).toBe("");
    expect(readableDate("2026-02-30")).toBe("");
  });
});

describe("the config's timeZone (rule 2)", () => {
  test("a real zone is kept; anything else is ignored and named, never a stand-down", () => {
    expect(loadConfig({ timeZone: "America/Denver" }).config.timeZone).toBe("America/Denver");
    const bad = loadConfig({ timeZone: "Mars/Olympus" });
    expect(bad.ok).toBe(true);
    expect(bad.config.observer).toBeUndefined();
    expect(bad.config.timeZone).toBeUndefined();
    expect(bad.config.timeZoneUnknown).toBe("Mars/Olympus");
    expect(loadConfig({}).config.timeZone).toBeUndefined();
  });
});

// ── rule 1, mechanized ───────────────────────────────────────────────────────

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src");

/**
 * Files that may build dates by hand, each with its reason. Keep it short: a
 * new entry is a conversion that should probably have gone into `time.ts`.
 */
const ALLOWED: Record<string, string> = {
  "src/core/time.ts": "the one module that converts",
  "src/core/physics/clock.ts":
    "the LIVED-day clock (dayKey shifts by the boundary hour, a physics idea); physics.test.ts holds it to being the only Date reader in physics/",
};

/**
 * Single LINES that may call the UTC helpers (`dateOf`, the module `today()`),
 * each with its reason — file names and parked-directory suffixes stay UTC on
 * purpose (store NOTES 2026-09-25). Matched by file and by a substring of the
 * line, so a NEW call in the same file is still caught (review N8).
 */
const ALLOWED_LINES: readonly { file: string; contains: string; why: string }[] = [
  { file: "src/core/store/index.ts", contains: "export function dateOf(", why: "the UTC helper itself" },
  { file: "src/core/store/index.ts", contains: "export function today()", why: "the UTC helper itself" },
  { file: "src/adapters/snapshots.ts", contains: ": dateOf(now);", why: "a snapshot folder is named by its UTC day" },
  { file: "src/adapters/snapshots.ts", contains: "dateOf(now - PRE_MIGRATION_KEEP_DAYS", why: "retention compared against UTC-named folders" },
  { file: "src/adapters/snapshots.ts", contains: "dateOf(now + 86_400_000)", why: "retention compared against UTC-named folders" },
  { file: "src/adapters/cli/commands.ts", contains: "date: dateOf(at),", why: "the parked-store plan's date, a folder suffix" },
  { file: "src/adapters/cli/commands.ts", contains: "${PARKED_INFIX}-${dateOf(at)}", why: "a parked-store folder suffix" },
  { file: "src/adapters/cli/start-fresh.ts", contains: "const date = dateOf(input.now);", why: "a parked-store folder suffix" },
  { file: "src/adapters/cli/uninstall.ts", contains: "dateOf(input.now)", why: "a paired-folder suffix" },
];

/** Not scanned: nothing today. The dashboard is scanned, with no exceptions. */
const SKIPPED_DIRS: readonly string[] = [];

const HAND_BUILT: readonly { name: string; re: RegExp }[] = [
  { name: "toISOString().slice(0, 10)", re: /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/ },
  { name: "getUTC*", re: /\.getUTC(?:FullYear|Month|Date|Day|Hours|Minutes)\s*\(/ },
  { name: "local Date getters", re: /\.get(?:FullYear|Month|Date|Day|Hours)\s*\(\s*\)/ },
  { name: "Date setters", re: /\.set(?:UTC\w+|Hours|Date|Month|FullYear)\s*\(/ },
  { name: "Date.UTC", re: /\bDate\.UTC\s*\(/ },
  { name: "toLocaleDateString / toLocaleTimeString", re: /\.toLocale(?:Date|Time)String\s*\(/ },
  // The UTC helpers under their old names (review N8): a person's day is
  // `localDate` / `store.today()`, so a new call here is a UTC day by accident.
  { name: "dateOf(", re: /\bdateOf\(/ },
  { name: "module today()", re: /(?:^|[^.\w])today(?:Utc)?\(\)(?!\s*:)/ },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full);
    if (SKIPPED_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) continue;
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Code lines only: block-comment and line-comment text is prose about dates, not dates. */
function codeLines(text: string): { n: number; line: string }[] {
  const out: { n: number; line: string }[] = [];
  let inBlock = false;
  text.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      line = line.slice(0, open);
      inBlock = true;
    }
    const slash = /(^|[^:"'`])\/\//.exec(line);
    if (slash !== null) line = line.slice(0, slash.index + (slash[1]?.length ?? 0));
    if (line.trim().length > 0) out.push({ n: i + 1, line });
  });
  return out;
}

describe("rule 1: nothing outside time.ts builds a date by hand", () => {
  test("the scan finds no hand-built date in src/", () => {
    const found: string[] = [];
    for (const file of tsFiles(SRC)) {
      const rel = relative(ROOT, file);
      if (rel in ALLOWED) continue;
      for (const { n, line } of codeLines(readFileSync(file, "utf8"))) {
        for (const { name, re } of HAND_BUILT) {
          if (!re.test(line)) continue;
          if (ALLOWED_LINES.some((a) => a.file === rel && line.includes(a.contains))) continue;
          found.push(`${rel}:${n} (${name}): ${line.trim()}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  test("the scan would catch one (it is not vacuous)", () => {
    const lines = codeLines("const d = new Date(at).toISOString().slice(0, 10);\n// toISOString().slice(0, 10) in prose\n");
    expect(lines.length).toBe(1);
    expect(HAND_BUILT[0]?.re.test(lines[0]?.line ?? "")).toBe(true);
  });

  test("every allow-listed LINE is still there", () => {
    for (const a of ALLOWED_LINES) {
      const text = readFileSync(join(ROOT, a.file), "utf8");
      expect({ file: a.file, contains: a.contains, present: text.includes(a.contains) }).toEqual({
        file: a.file,
        contains: a.contains,
        present: true,
      });
    }
  });

  test("every allow-listed file still exists and still needs its entry", () => {
    for (const rel of Object.keys(ALLOWED)) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      const hits = codeLines(text).some(({ line }) => HAND_BUILT.some(({ re }) => re.test(line)));
      expect({ rel, hits }).toEqual({ rel, hits: true });
    }
  });
});

describe("the console reads the zone the config beside the store names", () => {
  test("zoneBeside and openCounterpart honour <base>/claude-code.json's timeZone", () => {
    const base = mkdtempSync(join(tmpdir(), "counterparts-cli-zone-"));
    try {
      const storeDir = join(base, "store");
      expect(zoneBeside(storeDir)).toBeUndefined();
      writeFileSync(join(base, "claude-code.json"), JSON.stringify({ dataDir: storeDir, timeZone: "Pacific/Honolulu" }));
      expect(zoneBeside(storeDir)).toBe("Pacific/Honolulu");
      const c = openCounterpart(storeDir);
      try {
        expect(c.store.zone()).toBe("Pacific/Honolulu");
      } finally {
        c.close();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
