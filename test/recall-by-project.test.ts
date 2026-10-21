/**
 * WORK STAYS IN ITS PROJECT, IN AMBIENT RECALL TOO — behind a switch, OFF
 * (2026-10-21, wave 2 lane G, item 4; `recall/tunables.ts#RECALL_BY_PROJECT`).
 *
 * On: a turn in a folder does not show another project's work; the gate turns
 * it away as `project-skipped` and the decision row counts it. Craft, personal
 * memories, memories with no folder and a joined folder's work still show.
 * Off (the default): nothing changes, and the count is 0.
 *
 * Hermetic: a fresh temp data dir per test, removed after; invented prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as RECALL } from "../src/core/recall/index.js";
import type { AboutMark } from "../src/core/store/index.js";
import type { Kind } from "../src/core/types.js";
import { parseSetting } from "../tools/harness/settings.js";
import { findable } from "./store-fixture.js";

const FILLER = [
  "The garage door opener needs a new battery soon.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Set up a standing desk in the spare bedroom.",
  "Wrote a short letter to an old teacher.",
  "Bought hiking boots that finally fit properly.",
  "Replaced the smoke alarm batteries in the hall.",
];
const PROMPT = "why does the sourdough starter keep dying in the pantry?";

let root: string;
let BAKERY: string;
let GARAGE: string;
let c: Counterpart;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-recall-project-")));
  BAKERY = join(root, "bakery");
  GARAGE = join(root, "garage");
  for (const d of [BAKERY, GARAGE]) mkdirSync(d, { recursive: true });
  c = Counterpart.open({ dir: join(root, "store") });
  findable(c.store);
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
});

afterEach(() => {
  c.close();
  rmSync(root, { recursive: true, force: true });
});

function put(body: string, opts: { kind?: Kind; about?: AboutMark; scope?: string } = {}): string {
  return c.store.put({
    type: "memory",
    kind: opts.kind ?? "fact",
    body,
    ...(opts.about === undefined ? {} : { about: opts.about, aboutBy: "writer" as const }),
    ...(opts.scope === undefined ? {} : { origin: { scope: opts.scope } }),
  });
}

function on(value: boolean): void {
  (c.recall.tunables as { RECALL_BY_PROJECT: boolean }).RECALL_BY_PROJECT = value;
}

function shownIn(scope: string | undefined, session: string): { shown: string[]; skipped: number } {
  const out = c.recallForTurn({ sessionId: session, text: PROMPT }, scope === undefined ? {} : { scope });
  return { shown: [...out.decision.surfaced, ...out.decision.footnotes], skipped: out.decision.projectSkipped };
}

describe("RECALL_BY_PROJECT", () => {
  test("off by default, compare-settable, and off changes nothing", () => {
    expect(RECALL.RECALL_BY_PROJECT).toBe(false);
    expect(parseSetting("recall.RECALL_BY_PROJECT=true").value).toBe(true);
    const work = put("The sourdough starter died in the pantry because it was too cold.", { about: "work", scope: BAKERY });
    const r = shownIn(GARAGE, "s-off");
    expect(r.shown).toContain(work);
    expect(r.skipped).toBe(0);
  });

  test("on: another project's work is skipped and counted; this project's, craft and personal still show", () => {
    on(true);
    const work = put("The sourdough starter died in the pantry because it was too cold.", { about: "work", scope: BAKERY });
    expect(shownIn(BAKERY, "s-here").shown).toContain(work);
    const there = shownIn(GARAGE, "s-there");
    expect(there.shown).not.toContain(work);
    expect(there.skipped).toBeGreaterThanOrEqual(1);
    // No folder to read: nothing is skipped.
    expect(shownIn(undefined, "s-nowhere").shown).toContain(work);
  });

  test("on: craft and a personal memory from another folder are not another project's work", () => {
    on(true);
    const craft = put("I keep the sourdough starter out of the cold pantry so it does not die.", { kind: "skill", scope: BAKERY });
    const owner = put("The owner's sourdough starter died in the pantry last winter.", { about: "owner", scope: BAKERY });
    const r = shownIn(GARAGE, "s-craft");
    expect(r.shown).toContain(craft);
    expect(r.shown).toContain(owner);
  });

  test("on: a joined folder's work is this project's", () => {
    on(true);
    const work = put("The sourdough starter died in the pantry because it was too cold.", { about: "work", scope: BAKERY });
    c.joinProject({ folder: GARAGE, project: BAKERY, by: "owner" });
    expect(shownIn(GARAGE, "s-joined").shown).toContain(work);
  });
});
