/**
 * THE SENTENCE THAT NAMES A DATED MEMORY'S DATE (2026-11-17, the living
 * journal's Tomás memory): "Coming up" said a dated memory by its first
 * sentence. The journal's memory opened with the CR-V listing on 1 Oct and only
 * its last sentence held Marisol's visit, the day it was dated (2026-10-16), so
 * the visit read as the CR-V listing. Now a memory whose lead (its title, else
 * its first sentence) names ANOTHER day is said by the sentence that names its
 * own; a lead with no date, or with its own day, stands.
 *
 * The helper (`time.ts#datedSentence`, `#sentenceNamingDate`), then through the
 * real doors: `remember`, the session-start `wake` (the shape on, a new
 * install's and the journal's) and `recall` with the `coming up` handle, on a
 * fixed clock. Hermetic (CLAUDE.md): a fresh temp data dir per test, removed
 * afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { DESKTOP_HOST } from "../src/adapters/hosts.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart, datedSentence as fromEntry, sentenceNamingDate as namingFromEntry } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY, datedTitleOfRow, titleOfRow } from "../src/core/counterpart-wake-shape.js";
import { DATED_LINE_CHARS, datedSentence, firstSentence, sentenceNamingDate, sentencesOf } from "../src/core/time.js";

/** The journal's memory, word for word (living-journal sim month14-tomas, knows.json). */
const REAL =
  "On 1 Oct Tomás listed Elena's grey 2014 CR-V (88,000 miles) for $9,500; it took him a long time to press the button. He played dominoes on Ray Delgado's porch (Ray is his next-door neighbor of twenty-two years; Tomás won three games). His daughter Marisol is coming home from Denver Friday 16 to Sunday 18 October, and he wants to cook for her, which he hasn't really done since March.";
/** What Coming up says it by: the sentence to its first clause boundary after the date words. */
const MARISOL = "His daughter Marisol is coming home from Denver Friday 16 to Sunday 18 October,";
/** The journal's own test fixture (server/test/app.test.ts), titled by a clip of its first sentence. */
const FIXTURE = "On 1 Oct Tomás played dominoes on Ray Delgado's porch (Ray is his next-door neighbor of twenty-two years). That night he listed Elena's grey CR-V for $9,500. Marisol is coming home from Denver Fri 16 Oct to Sun 18 Oct; he wants to cook for her.";
const FIXTURE_TITLE = "On 1 Oct Tomás played dominoes on Ray Delgado's porch";
const DAY = "2026-10-16";
const RANGE = "2026-10-16..2026-10-18";

describe("datedSentence", () => {
  test("the journal's memory, dated the single day 16 Oct: the Marisol sentence to its clause boundary", () => {
    expect(datedSentence(REAL, DAY)).toBe(MARISOL);
    expect(datedSentence(REAL, RANGE)).toBe(MARISOL);
    expect(sentenceNamingDate(REAL, DAY)).toBe(`${MARISOL} and he wants to cook for her, which he hasn't really done since March.`);
    // The package entry exports the same functions, for the journal's own frame.
    expect(fromEntry(REAL, DAY)).toBe(MARISOL);
    expect(namingFromEntry(REAL, DAY)).toBe(sentenceNamingDate(REAL, DAY));
  });

  test("the journal's fixture, titled by a clip of its first sentence (which names 1 Oct): the clause that names the day", () => {
    expect(datedSentence(FIXTURE, DAY, FIXTURE_TITLE)).toBe("Marisol is coming home from Denver Fri 16 Oct to Sun 18 Oct");
    expect(datedTitleOfRow({ title: FIXTURE_TITLE, body: FIXTURE }, DAY)).toBe("Marisol is coming home from Denver Fri 16 Oct to Sun 18 Oct");
  });

  test("a lead with no date is the subject and stands, titled or not", () => {
    const cases: [string | null, string, string][] = [
      [null, "Tomás has a stress test with Dr. Okafor. It is on Friday 16 October at 9:30.", DAY],
      [null, "Marisol is visiting with the kids. She arrives Friday 16 October.", DAY],
      ["Ana's birthday", "She likes lemon cake and hates surprises. Born 12 March 2026.", "2026-03-12"],
      ["Rent", "Pay Simone by bank transfer. It is due on 5 October.", "2026-10-05"],
      ["Marisol's visit", "She's bringing the kids and the dog. Arrives Friday 16 October around noon.", DAY],
      ["Dentist: cleaning with Dr. Okafor", "Six-month cleaning. It's on Friday 16 October at 9:30.", DAY],
      ["Marisol is coming home from Denver", "Marisol is coming home from Denver with the kids. She lands Friday 16 October at noon.", DAY],
      [null, "Bought new sheets for the spare room. Ines stays 16–18 Oct.", RANGE],
    ];
    for (const [title, body, due] of cases) {
      expect(datedSentence(body, due, title)).toBeNull();
      expect(datedTitleOfRow({ title, body }, due)).toBe(titleOfRow({ title, body }));
    }
  });

  test("a lead that names the memory's own day stands; one that names another day gives way", () => {
    expect(datedSentence("Marisol is home Friday 16 October. The CR-V sold on 1 Oct.", DAY)).toBeNull();
    expect(datedSentence("Ines arrives Friday the 16th. She stays until 18 October.", RANGE)).toBeNull();
    expect(datedSentence("Ana's recital is 14 October. Marisol comes 16 October.", DAY)).toBe("Marisol comes 16 October.");
    expect(datedSentence("The dentist moved from 9 Oct. Now it is Friday 16 October at 9:30.", DAY)).toBe("Now it is Friday 16 October at 9:30.");
    // A title dated otherwise gives way too.
    expect(datedSentence("Cleaning with Dr. Okafor. Now Friday 16 October.", DAY, "Dentist on 9 Oct")).toBe("Now Friday 16 October.");
  });

  test("a line break ends the lead, and a list's or heading's marker is not words", () => {
    expect(datedSentence("CR-V listed for $9,500 on 1 Oct\nMarisol home Fri 16 Oct to Sun 18 Oct", DAY)).toBe("Marisol home Fri 16 Oct to Sun 18 Oct");
    expect(datedSentence("- CR-V listed on 1 Oct\n- Marisol home 16–18 Oct", RANGE)).toBe("Marisol home 16–18 Oct");
    expect(sentencesOf("## Week of 12 Oct\n1. Marisol visits 16–18 Oct.")).toEqual(["Week of 12 Oct", "Marisol visits 16–18 Oct."]);
  });

  test("a repeat keeps its lead: its date moves each time", () => {
    const body = "Standup moved from Monday 12 October. This week it is on Friday 16 October.";
    expect(datedSentence(body, DAY)).toBe("This week it is on Friday 16 October.");
    expect(datedSentence(body, DAY, null, { recurring: "weekly" })).toBeNull();
    expect(datedSentence(body, DAY, null, { recurring: true })).toBeNull();
    expect(datedTitleOfRow({ title: null, body }, DAY, "every Friday")).toBe("Standup moved from Monday 12 October.");
  });

  test("days and ranges said the common ways, lowercase and dotted abbreviations included", () => {
    for (const said of [
      "Ines stays 16–18 Oct.",
      "Ines stays Oct 16-18.",
      "Ines stays October 16 to 18.",
      "Ines stays from the 16th to the 18th of October.",
      "Ines stays 2026-10-16 to 2026-10-18.",
      "Ines stays 10/16/2026 to 10/18/2026.",
      "Ines stays Oct. 16 to 18.",
      "ines stays 16 to 18 oct.",
      "Ines arrives Fri. the 16th with the kids.",
      "marisol arrives friday 16 october.",
    ]) {
      expect(sentenceNamingDate(`Bought new sheets on 9 Oct. ${said}`, RANGE)).toBe(said);
      expect(datedSentence(`Bought new sheets on 9 Oct. ${said}`, RANGE)).toBe(said);
    }
    // The dated pick keeps "Oct." and "Fri." before a day's number in their sentence; an ordinary line splits as before.
    expect(sentencesOf("Ines stays Oct. 16 to 18. Then home.")).toEqual(["Ines stays Oct. 16 to 18.", "Then home."]);
    expect(sentencesOf("Fri. the 16th, Dr. Okafor; then lunch.", true)).toEqual(["Fri. the 16th, Dr. Okafor", "then lunch."]);
    expect(firstSentence("The cat sat. 3 dogs barked.")).toBe("The cat sat.");
    expect(firstSentence("We left Oct. 16 was the day.")).toBe("We left Oct.");
    expect(sentencesOf("The cat sat. 3 dogs barked.")).toEqual(["The cat sat.", "3 dogs barked."]);
  });

  test("chance matches name nothing: a bare number or ordinal, an ordinary lowercase word, another year, a fraction", () => {
    const none: [string, string][] = [
      ["The meeting is on the 3rd floor.", "2026-10-03"],
      ["The 1st draft is done.", "2026-10-01"],
      ["The 2nd time it broke.", "2026-10-02"],
      ["A 16th century chest.", DAY],
      ["The 16GB model ships in October only.", DAY],
      ["The 16-inch model ships in October.", DAY],
      ["Review PR #16 by Friday.", DAY],
      ["May I bring 16 friends?", "2026-05-16"],
      ["we may 16 times over.", "2026-05-16"],
      ["Sat with 17 people at dinner.", "2026-10-17"],
      ["they sat 17 in a row.", "2026-10-17"],
      ["Lena turns 16 in October.", DAY],
      ["Add 3/4 cup of flour.", "2026-03-04"],
      ["Use 1/2 the butter.", "2026-01-02"],
      ["Born 12 March 1990.", "2026-03-12"],
      ["In 2025, on 16 October, it rained.", DAY],
      ["See ticket 2026-10-160 for it.", DAY],
      ["It cost $16. Lunch at 16:30. Version v0.3.16. 1.16 litres.", DAY],
      ["Water the ferns. The kiln opens Friday.", DAY],
    ];
    for (const [text, due] of none) expect(sentenceNamingDate(text, due)).toBeNull();
    expect(sentenceNamingDate("It was on 16 October 2026.", DAY)).toBe("It was on 16 October 2026.");
    expect(sentenceNamingDate("May 16 is the day.", "2026-05-16")).toBe("May 16 is the day.");
  });

  test("the cut: from the sentence's start to a clause boundary after the date words; mid-sentence only when they come late", () => {
    const early = "Bought sheets on 9 Oct. From Friday 16 to Sunday 18 October Marisol, who has not been here since the spring when the garden was still mostly mud, brings the kids.";
    expect(datedSentence(early, RANGE)).toBe("From Friday 16 to Sunday 18 October Marisol,");
    const late = "Bought sheets on 9 Oct. Marisol, who has not been here since the spring when the garden was still mostly mud and the fence was down, and who is bringing both kids and the dog, visits from Friday 16 to Sunday 18 October and stays in the spare room.";
    const line = datedSentence(late, RANGE) ?? "";
    expect(line.startsWith("…")).toBe(true);
    expect(line.endsWith("Friday 16 to Sunday 18 October")).toBe(true);
    expect([...line].length).toBeLessThanOrEqual(DATED_LINE_CHARS);
  });

  test("the host gets what the wake shows: Names: line off, whitespace flat, null-safe", () => {
    const body = "Bought   sheets on 9 Oct.\n\nInes   stays\t16–18 Oct.\n\nNames: mem_a, mem_b for 17 October";
    expect(datedSentence(body, RANGE)).toBe("Ines stays 16–18 Oct.");
    expect(datedTitleOfRow({ title: null, body }, RANGE)).toBe("Ines stays 16–18 Oct.");
    expect(datedSentence(null, DAY)).toBeNull();
    expect(datedSentence(REAL, 20261016)).toBeNull();
    expect(datedSentence(REAL, "2026-10")).toBeNull();
    expect(datedSentence(REAL, "2026-13-05")).toBeNull();
    expect(datedSentence(REAL, null)).toBeNull();
    expect(sentenceNamingDate(undefined, DAY)).toBeNull();
    expect(datedSentence(REAL, " 2026-10-16 .. 2026-10-18 ")).toBe(MARISOL);
  });
});

let root: string;
const open: { close(): void }[] = [];
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-dated-sentence-")));
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

interface Door {
  readonly id: string;
  readonly title: string;
  readonly due?: string;
}

/** Remember on 14 Oct 2026 (a Wednesday), then wake and open the `coming up` door at `readAt`. */
async function through(args: Record<string, unknown>, readAt = "2026-10-14T12:00:00Z"): Promise<{ id: string; coming: string; door: Record<string, Door[]> }> {
  const dir = join(root, `store-${String(open.length)}`);
  let now = Date.parse("2026-10-14T12:00:00Z");
  const c = Counterpart.open({ dir, timeZone: "UTC", budgetBytes: CLAUDE_CODE_BUDGET_BYTES, now: () => now });
  open.push(c);
  c.store.setMeta(WAKE_SHAPE_KEY, "on");
  const server = new McpServer({ counterpart: c, host: DESKTOP_HOST, scope: join(root, "home"), registryDir: dir, env: {}, now: () => now, lifecycle: { spawner: () => ({ pid: 1 }), config: { injectionBudgetBytes: CLAUDE_CODE_BUDGET_BYTES } }, manifestVersion: () => null } as never);
  const said = (await server.call("remember", args)).structuredContent;
  expect(said["stored"]).toBe(true);
  now = Date.parse(readAt);
  const wake = String((await server.call("wake", {})).structuredContent["wake"]);
  const coming = wake.split("\n\n").find((p) => p.startsWith("Coming up:")) ?? "";
  const door = (await server.call("recall", { handle: "coming up" })).structuredContent as unknown as Record<string, Door[]>;
  return { id: String(said["id"]), coming, door };
}

describe("through the real doors: remember, the session-start wake, recall `coming up`", () => {
  test("the journal's memory, untitled, two days ahead: Coming up and the door say the Marisol sentence", async () => {
    const r = await through({ text: REAL, eventDate: DAY });
    expect(r.coming).toContain(`- 10-16 · ${MARISOL} [${r.id}]`);
    expect(r.coming).not.toContain("CR-V");
    expect(r.door["later"]?.find((x) => x.id === r.id)).toMatchObject({ title: MARISOL, due: DAY });
  });

  test("past its day: the line says the Marisol sentence too (a fact nobody owes reads Was, not overdue)", async () => {
    const r = await through({ text: REAL, eventDate: DAY }, "2026-10-19T12:00:00Z");
    expect(r.coming).toContain(`- Was 10-16 · ${MARISOL} [${r.id}]`);
    expect(r.coming).not.toContain("overdue");
    expect(r.door["passed"]?.find((x) => x.id === r.id)?.title).toBe(MARISOL);
    expect(r.door["overdue"]?.find((x) => x.id === r.id)).toBeUndefined();
  });

  test("a real title stands", async () => {
    const r = await through({ title: "Marisol's visit", text: "She's bringing the kids and the dog. Arrives Friday 16 October around noon.", eventDate: DAY });
    expect(r.coming).toContain(`- 10-16 · Marisol's visit [${r.id}]`);
    expect(r.door["later"]?.find((x) => x.id === r.id)?.title).toBe("Marisol's visit");
  });

  test("an untitled lead with no date is the subject and stands", async () => {
    const r = await through({ text: "Tomás has a stress test with Dr. Okafor. It is on Friday 16 October at 9:30.", eventDate: DAY });
    expect(r.coming).toContain(`- 10-16 · Tomás has a stress test with Dr. Okafor. [${r.id}]`);
    expect(r.door["later"]?.find((x) => x.id === r.id)?.title).toBe("Tomás has a stress test with Dr. Okafor.");
  });

  test("lines with no full stops: the line that names the day", async () => {
    const r = await through({ text: "CR-V listed for $9,500 on 1 Oct\nMarisol home Fri 16 Oct to Sun 18 Oct", eventDate: DAY });
    expect(r.coming).toContain(`- 10-16 · Marisol home Fri 16 Oct to Sun 18 Oct [${r.id}]`);
    expect(r.door["later"]?.find((x) => x.id === r.id)?.title).toBe("Marisol home Fri 16 Oct to Sun 18 Oct");
  });

  test("a repeat keeps its lead, even one that names another day", async () => {
    const r = await through({ text: "Standup moved from Monday 12 October. This week it is on Friday 16 October.", eventDate: DAY, recurring: "weekly" });
    expect(r.coming).toContain("Standup moved from Monday 12 October.");
    expect(r.coming).not.toContain("This week it is");
    expect(JSON.stringify(r.door)).not.toContain("This week it is");
  });
});
