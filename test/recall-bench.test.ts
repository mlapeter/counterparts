/**
 * `tools/recall-bench` — the hand-run scoring bench.
 *
 * Two things are worth a test here and the rest is a report. First, the refusal:
 * this tool exists to be pointed at a copy of the REAL store, so the one way it
 * could do harm is being pointed at the real one. Second, that the `BEFORE`
 * configuration really is the old scorer — the whole before/after table in the
 * PR body rests on that claim, and a claim like that has to be arithmetic.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../src/core/store/index.js";
import { BEFORE, benchOverStore, forbiddenStoreRoots, refuseLiveStore, renderReport, runBench } from "../tools/recall-bench/index.js";
import type { BenchInput } from "../tools/recall-bench/index.js";

let dir: string;
let priorEnv: string | undefined;
const open: Store[] = [];

beforeEach(() => {
  priorEnv = process.env["COUNTERPARTS_DATA_DIR"];
  dir = mkdtempSync(join(tmpdir(), "counterparts-bench-"));
  process.env["COUNTERPARTS_DATA_DIR"] = dir;
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env["COUNTERPARTS_DATA_DIR"];
  else process.env["COUNTERPARTS_DATA_DIR"] = priorEnv;
});

function store(): Store {
  const s = Store.open({ dir });
  open.push(s);
  return s;
}

const PADDING =
  "Assorted unrelated filler about tooling, calendars, invoices, plumbing, " +
  "commuting, gardening, printers, receipts, upholstery and stationery. ";

describe("recall-bench", () => {
  test("it refuses a live store by name, and the roots come from the store's own list", () => {
    const roots = forbiddenStoreRoots();
    // Three: v2's own data dir, and the two v1 lineage stores `store/paths.ts`
    // already forbids. The list is not retyped here — a second copy is the drift.
    expect(roots.length).toBe(3);
    expect(roots[0]).toBe(join(homedir(), ".counterparts"));
    for (const root of roots) {
      expect(refuseLiveStore(root)).toBe(root);
      expect(refuseLiveStore(join(root, "store"))).toBe(root);
    }
    // The traversal is resolved on both sides, so ".." does not walk in.
    expect(refuseLiveStore(join(homedir(), ".counterparts", "..", ".counterparts", "store"))).toBe(
      roots[0] as string,
    );
    expect(refuseLiveStore(dir)).toBe(null);
    expect(() => runBench(join(homedir(), ".counterparts"), { queries: [] }, BEFORE)).toThrow(
      /refuses to open a live store/,
    );
  });

  test("BEFORE is the old scorer, and the bench shows the hub it used to deliver", () => {
    const s = store();
    for (const body of [
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
    ]) {
      s.put({ type: "memory", kind: "fact", body });
    }
    const hub = s.put({
      type: "memory",
      kind: "fact",
      body: `${"Digest entry: the zygomorphic orchid, again. ".repeat(3)}${PADDING.repeat(30)}`,
    });
    const onPoint = s.put({
      type: "memory",
      kind: "fact",
      body: "The zygomorphic orchid bloomed after the second frost.",
    });

    const input: BenchInput = {
      queries: [
        {
          turn: 1,
          text: "why did the zygomorphic orchid bloom",
          labels: { should_surface: [onPoint, "mem_neverexisted"] },
        },
      ],
      known_hubs: [hub],
    };

    const before = benchOverStore(s, input, BEFORE);
    const after = benchOverStore(s, input, { name: "after", b: 0.75, k1: 1, cap: 3 });

    // BEFORE delivers the hub; AFTER does not deliver it at all. Both deliver
    // the on-point memory here — the bench's job is the hub column, not a claim
    // that the old scorer found nothing.
    expect(before.totals.hubHits).toBe(1);
    expect(after.totals.hubHits).toBe(0);
    expect(after.totals.wanted).toBe(1);
    expect(before.rows[0]?.delivered.map((d) => d.id)).toContain(hub);
    expect(after.rows[0]?.delivered.map((d) => d.id)).not.toContain(hub);
    // A label for a memory that is not in this store is a GAP, never a miss:
    // several of the real labels were minted after the session they label.
    expect(before.totals.absent).toBe(1);
    expect(after.totals.absent).toBe(1);
    expect(after.totals.missed).toBe(0);

    // The report is a markdown table, because its destination is a PR body.
    const rendered = renderReport(after);
    expect(rendered).toContain("| turn 1 |");
    expect(rendered).toContain("hub hits 0");
  });
});
