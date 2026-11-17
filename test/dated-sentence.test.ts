/**
 * THE SENTENCE THAT NAMES A DATED MEMORY'S DATE (2026-11-17, the living
 * journal's finding): "Coming up" said a dated memory by its first sentence, so
 * a memory led by "The CR-V listing runs through Friday the 16th…" that also
 * held "Marisol visits Friday 16 to Sunday 18 October", dated 16–18 Oct, read as
 * the CR-V listing. Now the line is the sentence that names the date.
 *
 * The helper alone, then through the real doors: `remember` with a range
 * `eventDate`, the session-start `wake`, and `recall` with the `coming up`
 * handle, the shape on (a new install's and the journal's). Hermetic
 * (CLAUDE.md): a fresh temp data dir per test, removed afterwards. Every name
 * is invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { DESKTOP_HOST } from "../src/adapters/hosts.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart, datedSentence as fromEntry } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY, datedTitleOfRow } from "../src/core/counterpart-wake-shape.js";
import { datedSentence, namesDate, sentenceNamingDate, sentencesOf } from "../src/core/dated-sentence.js";
import { addDays } from "../src/core/time.js";

const CRV = "The CR-V listing runs through Friday the 16th…";
const VISIT = "Marisol visits Friday 16 to Sunday 18 October.";
const BODY = `${CRV} ${VISIT}`;
const RANGE = "2026-10-16..2026-10-18";

describe("datedSentence", () => {
  test("the CR-V/Marisol memory: the visit's sentence, not the listing's, though both name the 16th", () => {
    expect(datedSentence(BODY, RANGE)).toBe(VISIT);
    expect(sentenceNamingDate(BODY, RANGE)).toEqual({ sentence: VISIT, index: 1, named: 2, score: 4 });
    // The package entry exports the same function, for the journal's own frame.
    expect(fromEntry(BODY, RANGE)).toBe(VISIT);
  });

  test("ranges said every common way", () => {
    const lead = "Bought new sheets for the spare room.";
    for (const said of ["Ines stays 16–18 Oct.", "Ines stays Oct 16-18.", "Ines stays October 16 to 18.", "Ines stays from the 16th to the 18th.", "Ines stays 2026-10-16 to 2026-10-18.", "Ines stays 10/16–10/18."]) {
      expect(datedSentence(`${lead} ${said}`, RANGE)).toBe(said);
    }
  });

  test("a day: by number and month, ISO, weekday and ordinal, the strongest winning", () => {
    const day = "2026-10-16";
    expect(datedSentence("Groceries on Friday. The dentist is on 16 October.", day)).toBe("The dentist is on 16 October.");
    expect(datedSentence("Water the ferns. Pay the rent by 2026-10-16.", day)).toBe("Pay the rent by 2026-10-16.");
    // A weekday alone names the day, but never displaces the lead.
    expect(sentenceNamingDate("Water the ferns. The kiln opens Friday.", day)?.sentence).toBe("The kiln opens Friday.");
    expect(datedSentence("Water the ferns. The kiln opens Friday.", day)).toBe("Water the ferns.");
    expect(datedSentence("Water the ferns. The kiln opens on the 16th.", day)).toBe("The kiln opens on the 16th.");
    // A weekday that is not the date's day names nothing.
    expect(sentenceNamingDate("The kiln opens Thursday.", day)).toBeNull();
  });

  test("a bare number names nothing: a time, money, a decimal, a year", () => {
    const day = "2026-10-16";
    expect(sentenceNamingDate("Lunch at 9:16 with Ana. It cost $16. The pot holds 1.16 litres. Built in 2016.", day)).toBeNull();
    expect(sentenceNamingDate("Sixteen 16 bulbs in the bed.", day)).toBeNull();
  });

  test("an abbreviation stays inside its sentence", () => {
    const body = "Feed the cat. Tomás sees Dr. Okafor on Friday 16 October at 9 a.m. sharp. Then lunch.";
    expect(datedSentence(body, "2026-10-16")).toBe("Tomás sees Dr. Okafor on Friday 16 October at 9 a.m. sharp.");
    expect(sentencesOf("Bring tools, e.g. the saw. Mr. Patel has the rest.")).toEqual(["Bring tools, e.g. the saw.", "Mr. Patel has the rest."]);
  });

  test("nothing names the date: the fallback, else the first sentence; a month or nothing readable names nothing", () => {
    const body = "Clear the gutters. Ask Wren for the ladder.";
    expect(datedSentence(body, "2026-10-16", "Gutters")).toBe("Gutters");
    expect(datedSentence(body, "2026-10-16")).toBe("Clear the gutters.");
    expect(datedSentence(BODY, "2026-10", "Fallback")).toBe("Fallback");
    expect(datedSentence(BODY, null)).toBe(CRV);
    expect(datedSentence(BODY, "soon")).toBe(CRV);
  });

  test("a single day both sentences name keeps the lead: the swap needs more of the date's days", () => {
    expect(sentenceNamingDate(BODY, "2026-10-16")?.sentence).toBe(VISIT);
    expect(datedSentence(BODY, "2026-10-16")).toBe(CRV);
  });

  test("with a title: kept when it names the date, the date is in the lead, or a later sentence names it only by weekday", () => {
    expect(datedSentence(BODY, RANGE, "CR-V listing")).toBe(VISIT);
    expect(datedSentence(BODY, RANGE, "Marisol 16–18 Oct")).toBe("Marisol 16–18 Oct");
    expect(datedSentence("The coast trip runs 16–18 Oct. The cabin is booked.", RANGE, "Coast trip")).toBe("Coast trip");
    expect(datedSentence("Cleaning at 9:30. Ana works Friday so I'll take the bus.", "2026-10-16", "Dentist")).toBe("Dentist");
  });

  test("an ellipsis ends a sentence before a new one, not mid-thought", () => {
    expect(sentencesOf("Wait… The gate is open.")).toEqual(["Wait…", "The gate is open."]);
    expect(sentencesOf("Mike asked twice… then stopped. Done.")).toEqual(["Mike asked twice… then stopped.", "Done."]);
  });

  test("namesDate reads a title", () => {
    expect(namesDate("Marisol, 16–18 Oct", RANGE)).toBe(true);
    expect(namesDate("Marisol's visit", RANGE)).toBe(false);
  });
});

describe("datedTitleOfRow: the line Coming up says a dated row by", () => {
  test("untitled: the dated sentence when it is not the first; the first sentence when it is", () => {
    expect(datedTitleOfRow({ title: null, body: BODY }, RANGE)).toBe(VISIT);
    expect(datedTitleOfRow({ title: null, body: `${VISIT} ${CRV}` }, RANGE)).toBe(VISIT);
    expect(datedTitleOfRow({ title: null, body: "Clear the gutters. Ask Wren." }, RANGE)).toBe("Clear the gutters.");
  });

  test("titled: the title stays when it names the date or the date is in the lead; else the dated sentence", () => {
    expect(datedTitleOfRow({ title: "CR-V listing", body: BODY }, RANGE)).toBe(VISIT);
    expect(datedTitleOfRow({ title: "Marisol 16–18 Oct", body: BODY }, RANGE)).toBe("Marisol 16–18 Oct");
    expect(datedTitleOfRow({ title: "Coast trip", body: "The coast trip runs 16–18 Oct. The cabin is booked." }, RANGE)).toBe("Coast trip");
    expect(datedTitleOfRow({ title: "Coast trip", body: "The coast trip runs over the long weekend." }, RANGE)).toBe("Coast trip");
    expect(datedTitleOfRow({ title: "Dentist", body: "Cleaning at 9:30. Ana works Friday so I'll take the bus." }, "2026-10-16")).toBe("Dentist");
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

// The wake and `remember` read the wall clock, so the real-path memory is the
// CR-V/Marisol one with its days moved to this week: the same words around them.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayOf = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);
const ordinal = (n: number): string => `${String(n)}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
function memoryFor(first: string, last: string): { body: string; visit: string; range: string } {
  const a = dayOf(first);
  const b = dayOf(last);
  const crv = `The CR-V listing runs through ${WEEKDAYS[a.getUTCDay()] ?? ""} the ${ordinal(a.getUTCDate())}…`;
  const visit = `Marisol visits ${WEEKDAYS[a.getUTCDay()] ?? ""} ${String(a.getUTCDate())} to ${WEEKDAYS[b.getUTCDay()] ?? ""} ${String(b.getUTCDate())} ${MONTHS[b.getUTCMonth()] ?? ""}.`;
  return { body: `${crv} ${visit}`, visit, range: `${first}..${last}` };
}

test("memoryFor says the journal's memory word for word on its own dates", () => {
  expect(memoryFor("2026-10-16", "2026-10-18")).toEqual({ body: BODY, visit: VISIT, range: RANGE });
});

describe("through the real doors: remember, the session-start wake, recall `coming up`", () => {
  const run = async (from: number, to: number, title?: string, text?: (m: { body: string }) => string): Promise<{ id: string; visit: string; range: string; coming: string; door: Record<string, unknown> }> => {
    const dir = join(root, `store-${String(open.length)}`);
    const scope = join(root, "home");
    const c = Counterpart.open({ dir, timeZone: "UTC", budgetBytes: CLAUDE_CODE_BUDGET_BYTES });
    open.push(c);
    c.store.setMeta(WAKE_SHAPE_KEY, "on");
    const today = c.store.today();
    const m = memoryFor(addDays(today, from), addDays(today, to));
    const server = new McpServer({ counterpart: c, host: DESKTOP_HOST, scope, registryDir: dir, env: {}, lifecycle: { spawner: () => ({ pid: 1 }), config: { injectionBudgetBytes: CLAUDE_CODE_BUDGET_BYTES } }, manifestVersion: () => null } as never);
    const said = (await server.call("remember", { ...(title === undefined ? {} : { title }), text: text === undefined ? m.body : text(m), eventDate: m.range })).structuredContent;
    expect(said["stored"]).toBe(true);
    const id = String(said["id"]);
    const wake = String((await server.call("wake", {})).structuredContent["wake"]);
    const coming = wake.split("\n\n").find((p) => p.startsWith("Coming up:")) ?? "";
    const door = (await server.call("recall", { handle: "coming up" })).structuredContent;
    return { id, ...m, coming, door };
  };
  const inDoor = (door: Record<string, unknown>, bucket: string, id: string): { id: string; title: string; due?: string } | undefined => (door[bucket] as { id: string; title: string; due?: string }[]).find((x) => x.id === id);

  test("untitled, two days ahead: Coming up and the door say the visit, not the listing", async () => {
    const r = await run(2, 4);
    expect(r.coming).toContain(`${r.visit} [${r.id}]`);
    expect(r.coming).not.toContain("CR-V");
    expect(inDoor(r.door, "later", r.id)).toMatchObject({ title: r.visit, due: r.range });
    expect(JSON.stringify(r.door)).not.toContain("CR-V");
  });

  test("untitled, on its middle day: due today, said by the visit", async () => {
    const r = await run(-1, 1);
    expect(r.coming).toContain(`- Due today (`);
    expect(r.coming).toContain(`${r.visit} [${r.id}]`);
    expect(r.coming).not.toContain("CR-V");
    expect(inDoor(r.door, "today", r.id)).toMatchObject({ title: r.visit, due: r.range });
  });

  test("titled by the other topic: the dated sentence wins over the title", async () => {
    const r = await run(2, 4, "CR-V listing");
    expect(r.coming).toContain(`${r.visit} [${r.id}]`);
    expect(inDoor(r.door, "later", r.id)?.title).toBe(r.visit);
  });

  test("titled, a later sentence names the date only by its weekday: the title stays", async () => {
    let weekday = "";
    const r = await run(2, 2, "Dentist", (m) => {
      weekday = (/through (\w+) the/.exec(m.body) ?? [])[1] ?? "";
      return `Cleaning at 9:30. Ana works ${weekday} so I'll take the bus.`;
    });
    expect(weekday.length).toBeGreaterThan(0);
    expect(r.coming).toContain(`Dentist [${r.id}]`);
    expect(r.coming).not.toContain("Ana works");
    expect(inDoor(r.door, "later", r.id)?.title).toBe("Dentist");
  });
});
