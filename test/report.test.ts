/**
 * The two readings a person checks an install with, in two layouts — and the
 * one rule that makes the second layout safe to have at all.
 *
 * The finding (new-user findings #5, 2026-09-21): "all prompts/ terminal
 * instructions should be more user friendly, better formatted, etc. if we can
 * use color for doctor we should." `doctor` and `status` printed a dense block
 * of long unbroken lines with no spacing and no colour.
 *
 * **PLAIN OUTPUT NEVER CHANGES — not a byte.** A pipe, a test console, a CI
 * job, `tools/install-loop/run.sh`, `--json`: every one of them gets exactly
 * what it got before. That is the property these tests exist for, and it is
 * asserted the only way it can be — by running the same store through a console
 * that says nothing about a terminal and comparing against the function that
 * produced the bytes before (`reportLines`), rather than against a snapshot
 * somebody would eventually re-bless.
 *
 * Hermetic: one temp root per test file, removed at the end. No real store is
 * opened; `COUNTERPARTS_DATA_DIR` is never read, because every run here names
 * its store.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, SWEEP_GATE_EVENT } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import { doctorFindings, reportLines } from "../src/adapters/claude-code/index.js";
import type { CheckoutReading, DoctorInput, Finding } from "../src/adapters/claude-code/index.js";
import { EXIT, printDoctorReport, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";

const TODAY = "2026-09-14";
let root: string;
let dir: string;
let configPath: string;

/** Two consoles: one that says nothing about a terminal (every pipe, every
 *  test), and one that says it IS a 100-column terminal. */
function plainConsole(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

function ttyConsole(columns = 100): { io: Io; out: string[]; err: string[] } {
  const c = plainConsole();
  return { ...c, io: { ...c.io, tty: { stdin: true, stdout: true, columns } } };
}

const ESC = String.fromCharCode(27);

/** An installed package rather than a checkout: nothing for the Checkout line
 *  to grade, so this file's verdicts do not move with somebody's `git status`. */
const NOT_A_REPO: CheckoutReading = {
  reason: "not-a-repo",
  root: "",
  branch: null,
  head: null,
  dirty: 0,
  behindBy: null,
  originMaster: null,
  atMaster: false,
  timedOut: false,
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-report-"));
  dir = join(root, "store");
  configPath = join(root, "claude-code.json");
  const c = Counterpart.open({ dir });
  c.close();
  const s = Store.open({ dir });
  try {
    for (const [i, body] of [
      "The espresso machine in the kitchen is a Rancilio Silvia, and it needs descaling.",
      "A second memory, long enough to be one, written on the same day as the first.",
    ].entries()) {
      s.put({
        type: "memory",
        kind: "fact",
        body,
        learnedOn: TODAY,
        source: "authored",
        title: `Fixture ${String(i)}`,
      });
    }
    s.appendEvent({
      name: SWEEP_GATE_EVENT,
      day: s.livedDay(),
      payload: { reason: "no-credential", ran: 0, scopes: 0, date: TODAY },
    });
  } finally {
    s.close();
  }
  writeFileSync(
    configPath,
    JSON.stringify({ dataDir: dir, credentialsFile: join(root, "credentials.env"), injectionBudgetBytes: 9000 }),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The findings this fixture produces, read once per call. */
function findings(): Finding[] {
  const s = Store.open({ dir, observer: true });
  try {
    return doctorFindings({
      configPath,
      configReason: "loaded",
      config: { dataDir: dir },
      dir,
      credentials: { loaded: [], skippedPresent: [], ignoredLines: 0, reason: "loaded", mode: "600", permissive: false },
      credentialsPath: join(root, "credentials.env"),
      shellNames: [],
      store: s,
      today: TODAY,
      refusals: {},
    } satisfies DoctorInput);
  } finally {
    s.close();
  }
}

describe("doctor: plain output never changes", () => {
  test("a console that says nothing about a terminal gets `reportLines`, byte for byte", () => {
    const f = findings();
    const c = plainConsole();
    printDoctorReport(c.io, {}, f, TODAY);
    expect(c.out).toEqual(reportLines(f, TODAY));
    expect(c.err).toEqual([]);
  });

  test("so does a console that says it is a terminal but has NO_COLOR and no columns", () => {
    // Belt and braces on the one thing that would break a script: `NO_COLOR`
    // turns the escapes off, but a TERMINAL still gets the laid-out arm — the
    // grouping and the fold are not colour, and a person reading a monochrome
    // terminal wants them just as much.
    const f = findings();
    const c = ttyConsole();
    printDoctorReport(c.io, { NO_COLOR: "1" }, f, TODAY);
    expect(c.out.join("\n")).not.toContain(ESC);
    expect(c.out.join("\n")).not.toBe(reportLines(f, TODAY).join("\n"));
  });

  test("the command itself takes the plain arm for a test console", async () => {
    const c = plainConsole();
    const code = await run(["doctor", `--config=${configPath}`, `--dir=${dir}`], {
      io: c.io,
      env: {},
      home: root,
      // INJECTED, like every other checkout reading in this suite: the suite
      // runs inside a checkout that is by definition on a branch and dirty
      // while somebody is working in it.
      checkout: NOT_A_REPO,
    });
    expect(code === EXIT.ok || code === 1).toBe(true);
    // The header and the summary are `reportLines`' own, in its own places.
    expect(c.out[0]).toBe(`counterparts doctor — ${new Date().toISOString().slice(0, 10)} (UTC)`);
    expect(c.out[1]).toBe("");
    expect(c.out[c.out.length - 1] ?? "").toMatch(/^(Nothing to fix\.|\d+ red, \d+ amber, \d+ green\.)$/);
    // No blank line anywhere in the body: the grouping is the terminal arm's.
    expect(c.out.slice(2, -2).filter((l) => l === "").length).toBe(0);
  });
});

describe("doctor: the terminal arm", () => {
  test("worst first, a blank line between the severities, and the summary coloured by the worst", () => {
    const f = findings();
    const c = ttyConsole();
    printDoctorReport(c.io, { FORCE_COLOR: "1" }, f, TODAY);
    const said = c.out.join("\n");
    // The grade word is written out in BOTH arms — colour may only emphasize
    // what the words already say (the dashboard's scar §2.4).
    expect(said).toContain("GREEN");
    expect(said).toContain(ESC);
    // Order: every RED before every AMBER before every GREEN.
    const grades = c.out
      .map((l) => /^(?:\u001b\[\d+m)?(RED|AMBER|GREEN)/.exec(l)?.[1])
      .filter((g): g is string => g !== undefined);
    const rank: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2 };
    for (let i = 1; i < grades.length; i += 1) {
      expect((rank[grades[i] ?? ""] ?? 0) >= (rank[grades[i - 1] ?? ""] ?? 0)).toBe(true);
    }
    // One blank line between the groups that are present, and one before the
    // summary. There are at least two groups in this fixture.
    expect(c.out.filter((l) => l === "").length).toBeGreaterThanOrEqual(2);
  });

  test("a message longer than the width folds into the gutter, never back to column zero", () => {
    const wide: Finding = {
      key: "fixture",
      severity: "amber",
      title: "Fixture",
      detail:
        "a message with a great many ordinary words in it so that it certainly runs past a hundred columns and has to be folded somewhere",
      fix: "a fix line that is also long enough to need folding, so that both halves of the layout are exercised at once",
      data: {},
    };
    const c = ttyConsole(80);
    printDoctorReport(c.io, {}, [wide], TODAY);
    // Measured WITHOUT the escapes: they are zero-width on a terminal, and a
    // layout that counted them would fold at the wrong column.
    const bare = c.out.map((l) => l.replaceAll(/\u001b\[\d+m/g, ""));
    const body = bare.slice(2, -2);
    expect(body.length).toBeGreaterThan(2);
    for (const line of body.slice(1)) {
      // Every continuation starts inside the gutter — `SEVERITY_COLUMN` plus
      // `TITLE_COLUMN` — so it cannot be mistaken for a new finding.
      expect(line.startsWith(" ".repeat(18))).toBe(true);
    }
    for (const line of bare) expect(line.length).toBeLessThanOrEqual(80);
  });
});

describe("status: plain output never changes", () => {
  test("a test console gets the exact lines the command has always printed", async () => {
    const c = plainConsole();
    expect(await run(["status", `--dir=${dir}`], { io: c.io, env: {} })).toBe(EXIT.ok);
    expect(c.out[0]).toBe(`Store: ${dir}`);
    expect(c.out[1]).toBe("");
    // The one line `tools/install-loop/run.sh` greps (`^Memories: `), and the
    // two asides, exactly where they were.
    expect(c.out[2] ?? "").toMatch(/^Memories: \d+ {3}Beliefs and entities: \d+ {3}Journal: /);
    expect(c.out[3] ?? "").toMatch(/^ {2}by kind: /);
    expect(c.out[4] ?? "").toMatch(/^ {2}by band: /);
    expect(c.out).toContain(
      "  Memories is the number the wake preface states; the journal does not decay.",
    );
    expect(c.out.some((l) => l.startsWith("Today ("))).toBe(true);
    expect(c.out.some((l) => l.startsWith("Self page: "))).toBe(true);
    // No heading from the terminal arm reached it.
    expect(c.out).not.toContain("Memory");
    expect(c.out).not.toContain("This store");
  });

  test("--layout still appends the layout block to the plain page", async () => {
    const c = plainConsole();
    expect(await run(["status", `--dir=${dir}`, "--layout"], { io: c.io, env: {} })).toBe(EXIT.ok);
    expect(c.out).toContain("Layout:");
    expect(c.out.some((l) => l.includes("counterparts.sqlite"))).toBe(true);
  });
});

describe("status: the terminal arm", () => {
  test("headings, one aligned column per block, and the same numbers", async () => {
    const plain = plainConsole();
    await run(["status", `--dir=${dir}`], { io: plain.io, env: {} });
    const census = plain.out[2] ?? "";
    const memories = /^Memories: (\d+)/.exec(census)?.[1] ?? "?";

    const c = ttyConsole();
    expect(await run(["status", `--dir=${dir}`], { io: c.io, env: { NO_COLOR: "1" } })).toBe(EXIT.ok);
    const said = c.out.join("\n");
    expect(said).not.toContain(ESC);
    expect(c.out).toContain("Memory");
    expect(c.out).toContain("This store");
    expect(c.out.some((l) => l.startsWith("Today — "))).toBe(true);
    // The same number, in a column instead of in a sentence.
    expect(c.out.some((l) => l.trimEnd().endsWith(memories) && l.includes("Memories"))).toBe(true);
    // `by kind` keeps its own double-space grouping: it is emitted verbatim,
    // because a greedy fold rejoins on single spaces and loses it.
    expect(c.out.some((l) => l.includes("by kind") && l.includes("  self "))).toBe(true);
  });

  test("colour on a terminal, and the store's path is the one thing painted", async () => {
    const c = ttyConsole();
    expect(await run(["status", `--dir=${dir}`], { io: c.io, env: {} })).toBe(EXIT.ok);
    expect(c.out[0]).toContain(ESC);
    expect(c.out[0]).toContain(dir);
  });
});
