/**
 * A PLAIN REMINDER IS TOLD BY THE SENTENCE THAT NAMES ITS DAY (2026-11-17,
 * after #840). The turn-time line ("Plain reminder (they asked to be told) —
 * Today: <what>") said a dated memory by its title, else its first line. The
 * living journal's month-14 memory, untitled and dated 2026-10-16, opened "On 1
 * Oct Tomás listed Elena's grey 2014 CR-V…", so on the 16th the person was told
 * about the CR-V, not Marisol's visit. `what` now takes the rule "Coming up"
 * uses (`time.ts#datedSentence`): a lead that names another day gives way to the
 * sentence that names the reminder's own; a title, a repeat, and a lead with no
 * date keep their lead.
 *
 * Through the real path: `remember` over MCP with remind: plain on a pinned
 * clock, then the Claude Code hooks reading the same store on the day.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { openAdapter, plainContextLine } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, HookInput } from "../src/adapters/claude-code/index.js";
import { deliverTurn } from "../src/adapters/claude-code/bin/hook.js";
import { Counterpart } from "../src/core/counterpart.js";
import { CUE_MODE_META } from "../src/core/prospective/index.js";

/** The journal's month-14 memory, as `test/dated-sentence.test.ts` has it. */
const TOMAS =
  "On 1 Oct Tomás listed Elena's grey 2014 CR-V (88,000 miles) for $9,500; it took him a long time to press the button. He played dominoes on Ray Delgado's porch (Ray is his next-door neighbor of twenty-two years; Tomás won three games). His daughter Marisol is coming home from Denver Friday 16 to Sunday 18 October, and he wants to cook for her, which he hasn't really done since March.";
const MARISOL = "His daughter Marisol is coming home from Denver Friday 16 to Sunday 18 October,";
const DAY = "2026-10-16";
const SCOPE = "/scope/one";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-plain-dated-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

/** `remember` over MCP, the clock pinned before the day. */
async function remember(args: Record<string, unknown>): Promise<string> {
  const s = openServer({ dir, session: "sess_plain_dated", scope: SCOPE, now: () => Date.parse("2026-10-10T12:00:00Z"), timeZone: "UTC" });
  try {
    const body = (await s.call("remember", { remind: "plain", ...args })).structuredContent;
    expect(body["stored"]).toBe(true);
    return body["id"] as string;
  } finally {
    s.counterpart.close();
  }
}

function hooks(): ReturnType<typeof openAdapter> {
  const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: 20_000 };
  const a = openAdapter(config, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
  open.push(a.counterpart);
  return a;
}

function input(over: Partial<HookInput> = {}): HookInput {
  return { sessionId: "s1", scope: SCOPE, turns: [], at: DAY, ...over };
}

/** A session opened the day before, then a prompt on the day: the turn-time line, both copies. */
function turnOnTheDay(): { model: string; person: string; notices: readonly string[] } {
  const a = hooks();
  a.sessionStart(input({ at: "2026-10-15" }));
  const turn = a.userPromptSubmit(input({ prompt: "morning" }));
  const delivered = deliverTurn(
    "user-prompt-submit",
    turn,
    {},
    null,
    { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: (i, due) => a.claimPlain(i, due) },
    input(),
  );
  const person = (JSON.parse(delivered.stdout) as Record<string, unknown>)["systemMessage"];
  return { model: turn.injection, person: typeof person === "string" ? person : "", notices: turn.notices ?? [] };
}

describe("the turn-time plain reminder says the sentence that names its day", () => {
  test("the journal's Tomás memory, untitled: on the 16th the line names Marisol's visit, not the CR-V", async () => {
    const id = await remember({ text: TOMAS, eventDate: DAY });
    const t = turnOnTheDay();
    expect(t.notices).toEqual([`Today: ${MARISOL}`]);
    expect(t.person).toBe(`Today: ${MARISOL}`);
    expect(t.model).toContain(`Plain reminder (they asked to be told) — Today: ${MARISOL} [${id}]`);
    expect(t.model).not.toContain("Today: On 1 Oct");
    expect(t.person).not.toContain("CR-V");
  });

  test("a titled reminder keeps its title", async () => {
    await remember({ text: TOMAS, title: "Marisol's visit", eventDate: DAY });
    const t = turnOnTheDay();
    expect(t.notices).toEqual(["Today: Marisol's visit"]);
    expect(t.person).toBe("Today: Marisol's visit");
  });

  test("a lead with no date of its own stays", async () => {
    const text = "Tomás has a stress test with Dr. Okafor at the clinic. It is on Friday 16 October, first thing.";
    await remember({ text, eventDate: DAY });
    expect(turnOnTheDay().notices).toEqual([`Today: ${text}`]);
  });

  test("a repeat (the weekly backup) keeps its lead, even one that names another day", async () => {
    const text = "Since 2 Oct the photo drive gets its weekly backup. Friday 16 October is the first run on the new disk.";
    // Anchored on Friday 2 October, weekly: the 16th is an occurrence.
    await remember({ text, eventDate: "2026-10-02", recurring: "weekly" });
    expect(turnOnTheDay().notices).toEqual([`Today: ${text}`]);
  });
});

describe("every copy of `what` takes the rule: the late beat and a crossing", () => {
  test("told late, the day after, it is still Marisol's visit", () => {
    const c = Counterpart.open({ dir });
    open.push(c);
    // Written before its day (a late beat is owed only then): `remember` stamps the wall clock, so put it directly.
    const id = c.store.put({
      type: "memory",
      kind: "person",
      body: TOMAS,
      learnedOn: "2026-10-10",
      eventDate: DAY,
      meta: { [CUE_MODE_META]: "plain" },
      salience: { relevance: 0.7, emotional: 0.7, predictive: 0.7 },
    });
    const late = c.plainReminders({ at: "2026-10-17" });
    expect(late.map((r) => [r.memoryId, r.late, r.what])).toEqual([[id, true, MARISOL]]);
    expect(plainContextLine(late[0]!)).toContain(MARISOL);
  });

  test("another folder's reminder crossing over says the dated sentence too", () => {
    const c = Counterpart.open({ dir, timeZone: "UTC" });
    open.push(c);
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      body: "On 1 Oct the garden committee approved the new beds. The Htool form for the beds is due Friday 16 October, before the board meets.",
      learnedOn: "2026-10-01",
      eventDate: DAY,
      meta: { [CUE_MODE_META]: "plain" },
      about: "work",
      salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
      origin: { session: "sess_garden", scope: "/x/garden" },
    });
    const out = c.plainCrossing({ at: "2026-10-20", lived: () => new Set(["2026-10-17", "2026-10-18", "2026-10-19"]) });
    const r = out.find((x) => x.memoryId === id);
    expect(r?.crossFrom).toBe("garden");
    expect(r?.what).toBe("The Htool form for the beds is due Friday 16 October, before the board meets.");
  });
});
