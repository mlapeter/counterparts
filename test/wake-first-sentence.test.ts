/**
 * THE SHAPED WAKE'S FIRST SENTENCE (2026-11-16, journal finding 17): an untitled
 * dated memory's line in "Coming up" is a short date and its first sentence, and
 * the splitter ended that sentence at "Dr.", so "with Dr. Okafor at 9:30" lost
 * the name and the time. Now a "." after a common abbreviation or a lone
 * initial is not a sentence's end. Everything else splits exactly as before:
 * the regression test checks a corpus against the old rule, inline.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards.
 * Every word is invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { DESKTOP_HOST } from "../src/adapters/hosts.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY, firstSentence, titleOfRow } from "../src/core/counterpart-wake-shape.js";
import { addDays } from "../src/core/time.js";

let root: string;
const open: { close(): void }[] = [];
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-first-sentence-")));
});
afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** The rule before 2026-11-16, kept here as the oracle. */
function before(s: string): string {
  const m = /[.!?](?=\s|$)/.exec(s);
  return m === null ? s : s.slice(0, m.index + 1);
}

describe("firstSentence", () => {
  test("ordinary sentences split exactly as before", () => {
    const corpus = [
      "The cold frame lid sticks in the morning damp. Wren will fix it.",
      "Is the kiln hot yet? Ask before noon.",
      "Stop! The ladder is loose.",
      "One sentence with no end",
      "",
      "Ends at the very end.",
      "He said no. Then he left.",
      "So did I. Then we went home.",
      "The FBI. Nobody else.",
      "Plan it for the 3rd of May. Bring the ledger.",
      "The figure was 3.5 in the end. Nobody minded.",
      "Meet at 9.30 by the gate. Bring tea.",
      "Version 0.3.55 shipped. It went fine.",
      "A line\nwith a break. And more.",
      "Wren's dog. The one with the limp.",
      "Mike asked twice... then stopped.",
      "The answer is 42. Done.",
      "Use the Nordic setting. It's quieter.",
    ];
    for (const s of corpus) expect(firstSentence(s)).toBe(before(s));
  });

  test("a common abbreviation or a lone initial doesn't end a sentence", () => {
    const cases: [string, string][] = [
      ["Tomás has a stress test with Dr. Okafor at 9:30. Then lunch.", "Tomás has a stress test with Dr. Okafor at 9:30."],
      ["Mr. and Mrs. Patel come Friday. Bake bread.", "Mr. and Mrs. Patel come Friday."],
      ["Ms. Reyes calls at noon. Be in.", "Ms. Reyes calls at noon."],
      ["Lunch on Elm St. near the bakery. Bring cash.", "Lunch on Elm St. near the bakery."],
      ["Ravi Jr. and Ravi Sr. both play. Seats for four.", "Ravi Jr. and Ravi Sr. both play."],
      ["Prof. Aldana marks the essays. Due Monday.", "Prof. Aldana marks the essays."],
      ["The hike up Mt. Tam is Sunday. Boots.", "The hike up Mt. Tam is Sunday."],
      ["Gate vs. path, still undecided. Ask Wren.", "Gate vs. path, still undecided."],
      ["Seeds, twine, etc. go in the shed. Then lock it.", "Seeds, twine, etc. go in the shed."],
      ["Bring tools, e.g. the saw. Wren has the rest.", "Bring tools, e.g. the saw."],
      ["The long one, i.e. the ladder. Not the stool.", "The long one, i.e. the ladder."],
      ["Platform No. 5 at the station. Arrive early.", "Platform No. 5 at the station."],
      ["Pickup at 7 a.m. sharp by the gate. Then drive.", "Pickup at 7 a.m. sharp by the gate."],
      ["Supper at 6 p.m. with the neighbours. Bring wine.", "Supper at 6 p.m. with the neighbours."],
      ["Call J. Smith about the fence. Today.", "Call J. Smith about the fence."],
      ["The race is at 9.30 on Saturday. Bring water.", "The race is at 9.30 on Saturday."],
    ];
    for (const [s, first] of cases) expect(firstSentence(s)).toBe(first);
  });

  test("titleOfRow: a titled row keeps its title; an untitled one its whole first sentence past the abbreviation", () => {
    expect(titleOfRow({ title: "Stress test", body: "Tomás has a stress test with Dr. Okafor at 9:30." })).toBe("Stress test");
    expect(titleOfRow({ title: null, body: "Tomás has a stress test with Dr. Okafor at 9:30. He's nervous." })).toBe("Tomás has a stress test with Dr. Okafor at 9:30.");
  });
});

describe("Coming up, through the wake tool", () => {
  test('an untitled dated memory keeps "Dr. Okafor at 9:30"', async () => {
    const dir = join(root, "store");
    const scope = join(root, "garden");
    const c = Counterpart.open({ dir, timeZone: "UTC", budgetBytes: CLAUDE_CODE_BUDGET_BYTES });
    open.push(c);
    c.store.setMeta(WAKE_SHAPE_KEY, "on");
    const today = c.store.today();
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Tomás has a stress test with Dr. Okafor at 9:30. He wants a lift there.",
      eventDate: addDays(today, 2),
      about: "owner",
      salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
      origin: { session: "aaaa1111-0000-4000-8000-000000000001", scope },
    });
    const server = new McpServer({ counterpart: c, host: DESKTOP_HOST, scope, registryDir: dir, env: {}, lifecycle: { spawner: () => ({ pid: 1 }), config: { injectionBudgetBytes: CLAUDE_CODE_BUDGET_BYTES } }, manifestVersion: () => null } as never);
    const wake = String((await server.call("wake", {})).structuredContent["wake"]);
    const coming = wake.split("\n\n").find((p) => p.startsWith("Coming up:")) ?? "";
    expect(coming).toContain(`Tomás has a stress test with Dr. Okafor at 9:30. [${id}]`);
    expect(coming).not.toContain("He wants a lift");
  });
});
