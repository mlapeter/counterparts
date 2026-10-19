/**
 * THE HEAD STANDS IN AT THE EARLIER ONE'S BAR (2026-10-19, an experiment; the
 * head-wins gap from the 10-19 overdue checks: since 10-12 a settled-over
 * memory showed 36 times while its head did not). Two paths gave that symptom:
 *
 *   A. the head was brought in for the earlier one (`standsFor`) with its
 *      numbers, but faced the stricter whole-sample bar while the earlier one
 *      faced its own leave-one-out bar — a marginal earlier one passed alone;
 *   B. the words reached the head too, but more weakly, so it was not brought
 *      in, failed its own bar, and the earlier one was never inhibited.
 *
 * Both now: the head shows in the earlier one's place, or (written this
 * session, an echo) neither shows. Hermetic: path A builds candidates by hand;
 * path B uses a fresh temp data dir, removed after it.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Candidate } from "../src/core/recall/activate.js";
import { gate } from "../src/core/recall/gate.js";
import { Recall } from "../src/core/recall/index.js";
import { freshGateState } from "../src/core/recall/session.js";
import { TUNABLES } from "../src/core/recall/tunables.js";
import { settle } from "../src/core/reconsolidation.js";
import { Store } from "../src/core/store/index.js";
import type { MemoryPhysics } from "../src/core/types.js";

function cand(id: string, body: string, activation: number, extra: Partial<Candidate> = {}): Candidate {
  return {
    id,
    kind: "fact",
    doc: { id, type: "memory", body } as Candidate["doc"],
    physics: { salience: { relevance: 0.5, emotional: 0, predictive: 0.5 } } as unknown as MemoryPhysics,
    strength: 1,
    sal: 0.5, // modulates the bar by exactly 1, so the numbers below are the bars
    mood: 0,
    cue: activation,
    temporal: 0,
    semantic: 0,
    arrival: 0,
    hops: 0,
    activation,
    cueFraction: 1,
    matched: 1,
    trains: true,
    maxTier: "surfaced",
    confidential: false,
    ...extra,
  };
}

/** Ten background memories (mean 10, sd ~2.83) and an earlier one at 15: its
 *  leave-one-out bar is ~14.5, the whole sample's (itself included) ~15.3. */
function turn(echo?: ReadonlySet<string>) {
  const words = ["alpha", "bravo", "charlie", "delta", "echo"];
  const bg = [6, 8, 10, 12, 14, 6, 8, 10, 12, 14].map((a, i) => cand(`bg${i}`, `${words[i % 5]} note number ${i} kiwi${i}`, a));
  const earlier = cand("earlier", "The quokka build uses the vermilion cache layer.", 15, { head: "head" });
  const head = cand("head", "Assets moved to a plain CDN; no cache layer now.", 15, { standsFor: "earlier" });
  return gate(
    { candidates: [...bg, earlier, head], state: freshGateState("s"), storeSize: 200, owner: true, affectStated: false, turn: 1, ...(echo ? { echo } : {}) },
    TUNABLES,
  );
}

const shownIds = (r: ReturnType<typeof gate>): string[] => [...r.surfaced, ...r.footnotes].map((c) => c.id);
const verdictOf = (r: ReturnType<typeof gate>, id: string): string | undefined => r.verdicts.find((v) => v.id === id)?.verdict;

describe("path A: a brought-in head faces the earlier one's bar", () => {
  test("a marginal earlier one does not show alone: its head shows in its place", () => {
    const r = turn();
    expect(r.background.regime).toBe("relative");
    expect(shownIds(r)).toContain("head");
    expect(shownIds(r)).not.toContain("earlier");
    expect(verdictOf(r, "earlier")).toBe("inhibited");
    const bars = r.verdicts.filter((v) => v.id === "head" || v.id === "earlier").map((v) => v.bar);
    expect(bars[0]).toBeCloseTo(bars[1]!, 9);
  });

  test("a head this session wrote is an echo: neither shows", () => {
    const r = turn(new Set(["head"]));
    expect(shownIds(r)).not.toContain("head");
    expect(shownIds(r)).not.toContain("earlier");
    expect(verdictOf(r, "head")).toBe("echo-skipped");
    expect(verdictOf(r, "earlier")).toBe("inhibited");
  });
});

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
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

describe("path B: a head the words reached more weakly stands in too", () => {
  test("the earlier one does not show without it; the head shows, naming it", () => {
    dir = mkdtempSync(join(tmpdir(), "counterparts-head-stands-in-"));
    const store = Store.open({ dir });
    try {
      for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) store.advanceClock(d);
      const put = (body: string): string => {
        const day = store.livedDay();
        return store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
      };
      for (const body of FILLER) put(body);
      const older = put("The quokka build uses the vermilion cache layer for assets.");
      const newer = put("Assets moved off it entirely; a plain CDN serves them now.");
      expect(settle(store, { holds: newer, over: older, how: "changed", actor: "owner" }).ok).toBe(true);
      // "assets" reaches both; "layer" only the earlier one, so the head is
      // reached, but well below it (measured: 1.6 against the earlier's 4.0).
      const r = new Recall({ store, owner: true }).build({ sessionId: "s1", text: "garage battery and the assets and the layer" });
      const ids = [...r.decision.surfaced, ...r.decision.footnotes];
      expect(ids).not.toContain(older);
      expect(ids).toContain(newer);
      expect(r.injection).toContain(`(earlier: [${older}])`);
    } finally {
      store.close();
    }
  });
});
