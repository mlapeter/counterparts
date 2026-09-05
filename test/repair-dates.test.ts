/**
 * `counterparts repair-dates` — the migrated rows' real dates, from evidence.
 *
 * The fixture below is a store shaped like the live one after the v1 import:
 * migrated rows all carrying one import day, with the four kinds of evidence the
 * tool knows how to read and the three kinds it must refuse to read. Nothing here
 * touches a real store — a fresh `mkdtemp` per test, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/commands.js";
import {
  PLAUSIBLE_FLOOR,
  measureImportDay,
  meetsConfidence,
  planRepair,
  proposeDate,
  repairDates,
} from "../src/adapters/cli/repair-dates.js";
import { Store } from "../src/core/store/index.js";

/** The import ran on 2026-09-03, as it did live. */
const IMPORT_AT = Date.UTC(2026, 8, 3, 12, 0, 0);
const IMPORT_DAY = "2026-09-03";

/** An engram-era id that IS an epoch-ms instant: 2024-07-26. */
const ID_MS = Date.UTC(2024, 6, 26, 9, 0, 0);
/** A session ref carrying an instant: 2025-02-11. */
const SESSION_MS = Date.UTC(2025, 1, 11, 15, 30, 0);
/** A parseable instant that lands AFTER the import — evidence, but impossible. */
const FUTURE_MS = Date.UTC(2033, 4, 18, 0, 0, 0);

let dir: string;

function lines(): { io: { out(l: string): void; err(l: string): void }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

function seed(): void {
  const s = Store.open({ dir, now: () => IMPORT_AT });
  try {
    s.put({
      type: "memory",
      kind: "fact",
      body: "An engram-era trace whose id is a millisecond timestamp.",
      source: "migrated",
      meta: { migratedFrom: `traces/global/tr_${ID_MS}.md#tr_${ID_MS}`, sessionRef: "s-001" },
    });
    s.put({
      type: "memory",
      kind: "fact",
      body: "A trace whose only dated thing is the session it came from.",
      source: "migrated",
      meta: { migratedFrom: "traces/global/tr_plain.md#tr_plain", sessionRef: `session-${SESSION_MS}` },
    });
    s.put({
      type: "memory",
      kind: "fact",
      body: "A trace v1 filed under a month folder and nothing else.",
      source: "migrated",
      meta: { migratedFrom: "traces/2025-11/tr_month.md#tr_month", sessionRef: "s-002" },
    });
    s.put({
      type: "memory",
      kind: "fact",
      body: "A trace whose v1 frontmatter carried a created date.",
      source: "migrated",
      meta: {
        migratedFrom: "traces/global/tr_dated.md#tr_dated",
        v1Extra: { created: "2023-04-19T08:00:00Z" },
      },
    });
    s.put({
      type: "memory",
      kind: "fact",
      body: "A trace with nothing anywhere on it that says a date.",
      source: "migrated",
      meta: { migratedFrom: "traces/global/tr_bare.md#tr_bare", sessionRef: "s-003" },
    });
    s.put({
      type: "memory",
      kind: "fact",
      body: "A trace whose id parses to an instant seven years after the import.",
      source: "migrated",
      meta: { migratedFrom: `traces/global/tr_${FUTURE_MS}.md#tr_${FUTURE_MS}`, sessionRef: "s-004" },
    });
    s.put({
      type: "memory",
      kind: "fact",
      body: "A migrated row that kept a real v1 date and is already right.",
      source: "migrated",
      learnedOn: "2025-05-05",
      meta: { migratedFrom: "traces/global/tr_ok.md#tr_ok" },
    });
    s.put({
      type: "memory",
      kind: "fact",
      body: "An authored memory, which is none of this tool's business.",
      source: "authored",
    });
  } finally {
    s.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-repair-dates-"));
  seed();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the evidence rules", () => {
  test("an engram-era id that is a timestamp is HIGH confidence", () => {
    const out = proposeDate({ migratedFrom: `traces/x/tr_${ID_MS}.md#tr_${ID_MS}` }, IMPORT_DAY);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.proposal.date).toBe("2024-07-26");
    expect(out.proposal.confidence).toBe("high");
    expect(out.proposal.how).toBe("id-timestamp");
  });

  test("a v1 `created` field beats the id — the document's own claim comes first", () => {
    const out = proposeDate(
      {
        migratedFrom: `traces/x/tr_${ID_MS}.md#tr_${ID_MS}`,
        v1Extra: { created: "2023-04-19T08:00:00Z" },
      },
      IMPORT_DAY,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.proposal.date).toBe("2023-04-19");
    expect(out.proposal.how).toBe("v1-date-field");
  });

  test("a session reference is MEDIUM — it dates the conversation, not the row", () => {
    const out = proposeDate(
      { migratedFrom: "traces/x/tr_plain.md#tr_plain", sessionRef: `session-${SESSION_MS}` },
      IMPORT_DAY,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.proposal.confidence).toBe("medium");
    expect(out.proposal.date).toBe("2025-02-11");
  });

  test("a month in the source path is LOW, and resolves to the first of that month", () => {
    const out = proposeDate({ migratedFrom: "traces/2025-11/tr.md#tr" }, IMPORT_DAY);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.proposal.confidence).toBe("low");
    expect(out.proposal.date).toBe("2025-11-01");
    expect(out.proposal.how).toBe("path-month");
  });

  test("a row with nothing dated on it proposes NOTHING — the tool invents no dates", () => {
    const out = proposeDate({ migratedFrom: "traces/x/tr_bare.md#tr_bare", sessionRef: "s-003" }, IMPORT_DAY);
    expect(out).toEqual({ ok: false, reason: "no-evidence" });
  });

  test("a date after the import day is refused: a memory cannot be learned after it was imported", () => {
    const out = proposeDate({ migratedFrom: `traces/x/tr_${FUTURE_MS}.md#tr_${FUTURE_MS}` }, IMPORT_DAY);
    expect(out).toEqual({ ok: false, reason: "out-of-window" });
  });

  test("a date before the floor is refused: a number that parses is not evidence", () => {
    const ancient = Date.UTC(2001, 10, 1, 0, 0, 0);
    const out = proposeDate({ migratedFrom: `traces/x/tr_${ancient}.md#tr_${ancient}` }, IMPORT_DAY);
    expect(out).toEqual({ ok: false, reason: "out-of-window" });
    expect(PLAUSIBLE_FLOOR).toBe("2015-01-01");
  });

  test("a calendar date that does not exist is refused rather than rolled over", () => {
    const out = proposeDate({ migratedFrom: "traces/x/tr.md#tr", v1Extra: { created: "2025-02-31" } }, IMPORT_DAY);
    expect(out.ok).toBe(false);
  });

  test("the confidence floor is an ORDER, not a set", () => {
    expect(meetsConfidence("high", "low")).toBe(true);
    expect(meetsConfidence("low", "high")).toBe(false);
    expect(meetsConfidence("medium", "medium")).toBe(true);
  });
});

describe("the plan", () => {
  test("the import day is MEASURED, not assumed", () => {
    const s = Store.open({ dir, observer: true });
    try {
      const m = measureImportDay(s);
      expect(m.day).toBe(IMPORT_DAY);
      expect(m.migrated).toBe(7);
    } finally {
      s.close();
    }
  });

  test("only live migrated rows carrying the import day are targets", () => {
    const plan = planRepair(dir);
    // Seven migrated rows; one already carries a real v1 date and is left alone,
    // and the authored row was never in scope.
    expect(plan.counts.migrated).toBe(7);
    expect(plan.targets).toHaveLength(6);
    expect(plan.counts).toEqual({
      migrated: 7,
      high: 2,
      medium: 1,
      low: 1,
      noEvidence: 1,
      outOfWindow: 1,
    });
  });

  test("an explicit --import-day is honoured over the measured one", () => {
    const plan = planRepair(dir, "2020-01-01");
    expect(plan.importDayFrom).toBe("flag");
    // Nothing carries that date, so nothing is a target — and nothing is guessed.
    expect(plan.targets).toHaveLength(0);
  });

  test("planning opens the store in observer mode and writes nothing", () => {
    const before = new Map<string, string>();
    const s = Store.open({ dir, observer: true });
    for (const id of s.list()) before.set(id, s.row(id)?.content_hash ?? "");
    s.close();
    planRepair(dir);
    const after = new Map<string, string>();
    const s2 = Store.open({ dir, observer: true });
    for (const id of s2.list()) after.set(id, s2.row(id)?.content_hash ?? "");
    s2.close();
    expect(after).toEqual(before);
  });
});

describe("the command", () => {
  test("a dry run prints the counts and the sample, and changes nothing", () => {
    const l = lines();
    const report = repairDates(dir, l.io);
    expect(report?.written).toBe(0);
    expect(report?.wouldWrite).toBe(2);
    const text = l.out.join("\n");
    expect(text).toContain(`Import day: ${IMPORT_DAY}`);
    expect(text).toContain("high    2");
    expect(text).toContain("medium  1");
    expect(text).toContain("low     1");
    expect(text).toContain("Dry run. Nothing has changed.");
    expect(text).toContain("2024-07-26");
    // Ids and dates only — a repair report never prints a body.
    expect(text).not.toContain("engram-era trace");
  });

  test("the sample is capped at twenty rows", () => {
    const l = lines();
    repairDates(dir, l.io, { minConfidence: "low", sample: 2 });
    const sampled = l.out.filter((x) => x.startsWith("  mem_"));
    expect(sampled).toHaveLength(2);
    const all = lines();
    repairDates(dir, all.io, { minConfidence: "low" });
    expect(all.out.filter((x) => x.startsWith("  mem_"))).toHaveLength(4);
  });

  test("--apply writes the dates, keeps the old document, and records each one", () => {
    const l = lines();
    const report = repairDates(dir, l.io, { apply: true, minConfidence: "low" });
    expect(report?.written).toBe(4);
    expect(report?.failures).toEqual([]);
    const s = Store.open({ dir, observer: true });
    try {
      const dated = new Map<string, string>();
      for (const id of s.list()) dated.set(id, s.readProse(id).learnedOn);
      const values = [...dated.values()].sort();
      expect(values).toContain("2023-04-19");
      expect(values).toContain("2024-07-26");
      expect(values).toContain("2025-02-11");
      expect(values).toContain("2025-11-01");
      // The row that had a real date, the row with no evidence, the row whose
      // evidence was impossible, and the authored row all still read what they read.
      expect(values.filter((v) => v === IMPORT_DAY)).toHaveLength(3);
      expect(values).toContain("2025-05-05");
      // The COLUMN moved with the document — a query surface that disagreed with
      // canonical prose about a date would be its own small lie.
      for (const [id, date] of dated) expect(`${id}=${s.row(id)?.learned_on}`).toBe(`${id}=${date}`);
      // The prior document, wrong date and all, is still readable.
      const repaired = [...dated].filter(([, d]) => d !== IMPORT_DAY && d !== "2025-05-05");
      expect(repaired).toHaveLength(4);
      for (const [id] of repaired) expect(s.versions(id)).toHaveLength(1);
      expect(s.eventLog({ name: "date.repaired" })).toHaveLength(4);
    } finally {
      s.close();
    }
  });

  test("a second --apply is a no-op: the repaired rows no longer carry the import day", () => {
    repairDates(dir, lines().io, { apply: true, minConfidence: "low" });
    const l = lines();
    const again = repairDates(dir, l.io, { apply: true, minConfidence: "low" });
    expect(again?.written).toBe(0);
    expect(l.out.join("\n")).toContain("Nothing to do.");
  });

  test("a store with no migrated rows says so instead of proposing anything", () => {
    const empty = mkdtempSync(join(tmpdir(), "cp-repair-empty-"));
    try {
      Store.open({ dir: empty }).close();
      const l = lines();
      const report = repairDates(empty, l.io);
      expect(report?.wouldWrite).toBe(0);
      expect(l.out.join("\n")).toContain("No migrated memories in this store.");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("a missing store fails rather than creating one", () => {
    const missing = join(tmpdir(), "cp-repair-nope-xyz");
    const l = lines();
    expect(repairDates(missing, l.io)).toBeNull();
    expect(l.err.join("\n")).toContain("no store at");
  });
});

describe("the console door", () => {
  test("`repair-dates` is a dry run by default and exits 0", async () => {
    const l = lines();
    const code = await run(["repair-dates", "--dir", dir], { io: l.io, env: {} });
    expect(code).toBe(EXIT.ok);
    expect(l.out.join("\n")).toContain("Dry run. Nothing has changed.");
  });

  test("`--confidence` reaches the floor, and a bad one is refused before any open", async () => {
    const l = lines();
    expect(await run(["repair-dates", "--dir", dir, "--confidence", "low"], { io: l.io, env: {} })).toBe(
      EXIT.ok,
    );
    expect(l.out.join("\n")).toContain("At or above confidence low: 4");
    const bad = lines();
    expect(
      await run(["repair-dates", "--dir", dir, "--confidence", "sometimes"], { io: bad.io, env: {} }),
    ).toBe(EXIT.usage);
    expect(bad.err.join("\n")).toContain("--confidence must be high, medium or low");
  });

  test("`--apply --dry-run` is a refusal, not a silent winner", async () => {
    const l = lines();
    const code = await run(["repair-dates", "--dir", dir, "--apply", "--dry-run"], { io: l.io, env: {} });
    expect(code).toBe(EXIT.usage);
    expect(l.err.join("\n")).toContain("contradict each other");
  });

  test("a malformed `--import-day` is refused by name", async () => {
    const l = lines();
    const code = await run(["repair-dates", "--dir", dir, "--import-day", "last-tuesday"], {
      io: l.io,
      env: {},
    });
    expect(code).toBe(EXIT.usage);
    expect(l.err.join("\n")).toContain("--import-day must be YYYY-MM-DD");
  });

  test("an undeclared flag is refused before the store opens", async () => {
    const l = lines();
    const code = await run(["repair-dates", "--dir", dir, "--force"], { io: l.io, env: {} });
    expect(code).toBe(EXIT.refused);
    expect(l.err.join("\n")).toContain("refused:");
  });

  test("under --observer the repair refuses: an instrument does not rewrite what it reads", async () => {
    const l = lines();
    const code = await run(["repair-dates", "--dir", dir, "--observer", "--apply"], {
      io: l.io,
      env: {},
    });
    expect(code).toBe(EXIT.refused);
  });
});
