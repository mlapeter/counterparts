/**
 * THE CHAIN HEAD WINS AMBIENT RECALL (2026-10-11, Group 2; review 04 change 1,
 * MOD #3). A memory a later one settled over is not shown above, beside or
 * instead of the one that holds now: reached together, the earlier is
 * inhibited; reached alone, the head stands in for it, its label naming the
 * earlier one. Hermetic: a fresh temp data dir per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Recall } from "../src/core/recall/index.js";
import { settle } from "../src/core/reconsolidation.js";
import { Store } from "../src/core/store/index.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-head-wins-"));
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

const FILLER = [
  "Ran the morning loop around the reservoir before breakfast.",
  "The tax filing deadline moved to October this year.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The neighbour's cat sits on the fence every evening.",
  "Bought hiking boots that finally fit properly.",
  "The library closes early on Sundays now.",
  "Wrote a short letter to an old teacher.",
  "The kitchen tap drips when the pressure is high.",
  "Set up a standing desk in the spare bedroom.",
  "The bus route changed and adds ten minutes.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
];

function setup(): Store {
  const store = Store.open({ dir });
  open.push(store);
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) store.advanceClock(d);
  for (const body of FILLER) put(store, body);
  return store;
}

function put(store: Store, body: string): string {
  const day = store.livedDay();
  return store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
}

function shown(store: Store, session: string, text: string): { ids: string[]; injection: string } {
  const r = new Recall({ store }).build({ sessionId: session, text });
  return { ids: [...r.decision.surfaced, ...r.decision.footnotes], injection: r.injection };
}

describe("the chain head wins", () => {
  test("reached together, the earlier is inhibited and the head shows", () => {
    const store = setup();
    const older = put(store, "The zygomorphic orchid needs watering twice a week in the greenhouse.");
    const newer = put(store, "The zygomorphic orchid needs watering once a week in the greenhouse now.");
    const before = shown(store, "s0", "how often does the zygomorphic orchid need watering in the greenhouse");
    expect(before.ids).toContain(older);
    expect(before.ids).toContain(newer);
    expect(settle(store, { holds: newer, over: older, how: "changed", actor: "owner" }).ok).toBe(true);
    const after = shown(store, "s1", "how often does the zygomorphic orchid need watering in the greenhouse");
    expect(after.ids).toContain(newer);
    expect(after.ids).not.toContain(older);
    expect(after.injection).toContain(`(earlier: [${older}])`);
  });

  test("reached alone, the earlier is shown as its head, which names it", () => {
    const store = setup();
    const older = put(store, "The quokka build uses the vermilion cache layer for assets.");
    const newer = put(store, "Assets moved off it entirely; a plain CDN serves them now.");
    const before = shown(store, "s0", "does the quokka build still use the vermilion cache layer");
    expect(before.ids).toContain(older);
    expect(before.ids).not.toContain(newer);
    expect(settle(store, { holds: newer, over: older, how: "changed", actor: "owner" }).ok).toBe(true);
    const r = shown(store, "s1", "does the quokka build still use the vermilion cache layer");
    expect(r.ids).not.toContain(older);
    expect(r.ids).toContain(newer);
    expect(r.injection).toContain(`(earlier: [${older}])`);
  });

  test("a head already in this session's context keeps the earlier out too", () => {
    const store = setup();
    const older = put(store, "The pelican crossing on Elm street has a long red phase.");
    const newer = put(store, "The pelican crossing on Elm street was retimed: a short red phase now.");
    expect(settle(store, { holds: newer, over: older, how: "changed", actor: "owner" }).ok).toBe(true);
    const rec = new Recall({ store });
    const first = rec.build({ sessionId: "s1", text: "pelican crossing on Elm street red phase" });
    expect([...first.decision.surfaced, ...first.decision.footnotes]).toContain(newer);
    const second = rec.build({ sessionId: "s1", text: "the Elm street pelican crossing red phase again" });
    expect([...second.decision.surfaced, ...second.decision.footnotes]).not.toContain(older);
  });

  test("a pair that is only open (both stand) hides nothing", () => {
    const store = setup();
    const a = put(store, "The marmot festival is held in the north valley.");
    const b = put(store, "The marmot festival is held in the south valley.");
    expect(settle(store, { holds: b, over: a, how: "open", actor: "owner" }).ok).toBe(true);
    const r = shown(store, "s1", "where is the marmot festival held, which valley");
    expect(r.ids).toContain(a);
    expect(r.ids).toContain(b);
  });
});
