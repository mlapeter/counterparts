/**
 * `tools/install-loop/run.sh` and the two numbers `docs/QUICKSTART.md` quotes
 * about it: how many checks the loop runs (the preamble) and which step is the
 * lazy `session_end` bind (§9). Both are prose, and both drifted twice — the
 * index said 23 while the step was 25, and nothing noticed until a reader did
 * (LAUNCH-STATUS G33). The loop's own `doc_check` cannot see them: it greps the
 * doc for COMMANDS a reader would run, never for sentences about itself. So the
 * lockstep lives here, where `bun test` runs on every change, and it reads both
 * files as text — the loop is not run.
 *
 * Read-only on two repo files. Opens no store.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const RUN_SH = readFileSync(join(ROOT, "tools/install-loop/run.sh"), "utf8");
const QUICKSTART = readFileSync(join(ROOT, "docs/QUICKSTART.md"), "utf8");

/** Every `step "..."` line in file order — the loop numbers them the same way. */
const STEPS = RUN_SH.split("\n").filter((line) => /^step "/.test(line));

/** The doc's number, or a failure that says which sentence went missing. */
function quoted(pattern: RegExp, sentence: string): number {
  const m = pattern.exec(QUICKSTART);
  if (m === null) throw new Error(`docs/QUICKSTART.md no longer says "${sentence}" — reword the pattern here with it`);
  return Number(m[1]);
}

describe("QUICKSTART's numbers about the install loop are the loop's own", () => {
  test("the preamble's check count is the number of steps in run.sh", () => {
    expect(STEPS.length).toBeGreaterThan(0);
    expect(quoted(/^(\d+) checks and runs end to end/m, "<n> checks and runs end to end")).toBe(STEPS.length);
  });

  test("§9's session_end step index is that step's position in run.sh", () => {
    const named = STEPS.filter((line) => line.includes("session_end"));
    expect(named).toHaveLength(1);
    const index = STEPS.indexOf(named[0]!) + 1;
    expect(quoted(/\(loop step (\d+);/, "(loop step <n>;")).toBe(index);
  });
});
