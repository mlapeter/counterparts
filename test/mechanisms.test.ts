/**
 * `mechanisms` — the short view over the what-fired reading, against real temp
 * stores.
 *
 * What it keeps: one line per memory mechanism with the light its evidence
 * earns, a plumbing line that names only what is genuinely failing, `fired` as
 * the same command under its older name, and `--all` as the full `fired`
 * report, unchanged.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp dir per test, removed in
 * `afterEach`, and the store's provenance clock injected.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import { MECHANISMS, daysBefore, firedReport } from "../src/adapters/fired.js";
import { MEMORY_MECHANISMS } from "../src/adapters/cli/mechanisms.js";
import { firedLines } from "../src/adapters/cli/commands.js";
import { run } from "../src/adapters/cli/index.js";

const TODAY = "2026-09-17";

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-mechanisms-"));
  dir = join(root, "store");
  Counterpart.open({ dir }).close();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function at(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

/** Append durable rows, each stamped with a calendar date, and close. */
function seed(rows: readonly [name: string, date: string, payload?: Record<string, unknown>][]): void {
  const s = Store.open({ dir, now: () => at(TODAY) });
  try {
    for (const [name, date, payload] of rows) {
      s.appendEvent({ name, day: s.livedDay(), payload: { date, ...(payload ?? {}) } });
    }
  } finally {
    s.close();
  }
}

async function console_(argv: readonly string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await run([...argv, "--dir", dir], {
    io: { out: (l) => out.push(l), err: (l) => out.push(l) },
    now: () => at(TODAY),
  });
  return { code, out };
}

/** The mechanism lines, by name → the light that opens them. */
function lights(out: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of out) {
    const m = /^([●◐○]) (\S+)/u.exec(line);
    if (m === null || !MEMORY_MECHANISMS.some((x) => x.name === m[2])) continue;
    found.set(m[2] ?? "", m[1] ?? "");
  }
  return found;
}

function lineFor(out: readonly string[], name: string): string {
  return out.find((l) => /^[●◐○] /u.test(l) && l.slice(2).startsWith(name)) ?? "";
}

describe("the table", () => {
  test("every id it names is a row of MECHANISMS", () => {
    const known = new Set(MECHANISMS.map((m) => m.id));
    for (const id of MEMORY_MECHANISMS.flatMap((m) => m.evidence)) expect(known.has(id), id).toBe(true);
  });

  test("eleven mechanisms, in the site's four groups and order", () => {
    expect(MEMORY_MECHANISMS.map((m) => `${m.group}:${m.name}`)).toEqual([
      "Encoding:Salience",
      "Encoding:Emotion",
      "Storage:Forgetting",
      "Storage:Interference",
      "Retrieval:Retrieval",
      "Retrieval:Association",
      "Retrieval:Prospective",
      "Transformation:Consolidation",
      "Transformation:Reconsolidation",
      "Transformation:Schemas",
      "Transformation:Gist",
    ]);
  });
});

describe("counterparts mechanisms", () => {
  test("one line per mechanism, each with the light its evidence earns", async () => {
    seed([
      ["gate.deposit", TODAY],
      ["gate.deposit", daysBefore(TODAY, 2)],
      ["recall.decision", TODAY],
      ["recall.credit", TODAY, { reason: "credited" }],
      ["sleep.cycle", TODAY],
    ]);
    const { code, out } = await console_(["mechanisms"]);
    expect(code).toBe(0);
    expect(out[0]).toContain("Memory mechanisms — last 7 days");
    expect(Object.fromEntries(lights(out))).toEqual({
      Salience: "●",
      Emotion: "◐",
      Forgetting: "●",
      Interference: "○",
      Retrieval: "●",
      Association: "◐",
      Prospective: "○",
      Consolidation: "●",
      Reconsolidation: "◐",
      Schemas: "○",
      Gist: "○",
    });
    expect(lineFor(out, "Salience")).toContain("2 memories written and scored");
    expect(lineFor(out, "Retrieval")).toContain("1 turn checked; memories used were strengthened");
    expect(lineFor(out, "Association")).toContain("no links formed");
    expect(lineFor(out, "Forgetting")).toContain("nothing at the floor yet");
    // Short: about fifteen lines, not a wall.
    expect(out.length).toBeLessThanOrEqual(20);
  });

  test("evidence older than the window reads as built, not firing", async () => {
    seed([["gate.deposit", daysBefore(TODAY, 10)]]);
    const { out } = await console_(["mechanisms"]);
    expect(lights(out).get("Salience")).toBe("◐");
    expect(lineFor(out, "Salience")).toContain("built, not firing yet");
  });

  test("the plumbing is one line, and good-news silence never reads as failing", async () => {
    // A copy that could not be made — but ten days ago, outside the window.
    seed([
      ["adapter.boundary", TODAY],
      ["snapshot.taken", TODAY],
      ["snapshot.failed", daysBefore(TODAY, 10), { step: "copy", reason: "ENOSPC" }],
    ]);
    const { out } = await console_(["mechanisms"]);
    const plumbing = out.filter((l) => l.startsWith("Plumbing:"));
    expect(plumbing).toEqual(["Plumbing: 2 parts running, none failing."]);
    const text = out.join("\n");
    expect(text).not.toContain("NEVER");
    expect(text).not.toContain("could not be made");
    expect(text).toContain("counterparts mechanisms --all");
  });

  test("a failure inside the window is named on the plumbing line", async () => {
    seed([
      ["snapshot.failed", TODAY, { step: "copy", reason: "ENOSPC" }],
      ["adapter.spawn.failed", TODAY, { reason: "SPAWN_FAILED" }],
    ]);
    const { out } = await console_(["mechanisms"]);
    const plumbing = out.find((l) => l.startsWith("Plumbing:")) ?? "";
    expect(plumbing).toContain("failing:");
    expect(plumbing).toContain("a copy of the store could not be made (1 time)");
    expect(plumbing).toContain("the background worker failed or was refused (1 time)");
  });

  test("`fired` is the same command under its older name", async () => {
    seed([["gate.deposit", TODAY], ["recall.decision", TODAY]]);
    const a = await console_(["mechanisms"]);
    const b = await console_(["fired"]);
    expect(b.code).toBe(0);
    expect(b.out).toEqual(a.out);
  });

  test("--all is the full fired report, unchanged, under either name", async () => {
    seed([
      ["adapter.boundary", TODAY],
      ["sweep.gate", daysBefore(TODAY, 8), { refusals: { NO_CRASHED_SESSION: 3 } }],
    ]);
    const s = Store.open({ dir, observer: true, now: () => at(TODAY) });
    let expected: string[];
    try {
      expected = firedLines(firedReport(s, TODAY), true);
    } finally {
      s.close();
    }
    const a = await console_(["mechanisms", "--all"]);
    const b = await console_(["fired", "--all"]);
    expect(a.out).toEqual(expected);
    expect(b.out).toEqual(expected);
    expect(a.out.join("\n")).toContain("what has fired —");
  });
});
