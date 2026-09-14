/**
 * The OQ4 probe (recall CONTRACT §7, open question 4): footnotes delivered vs.
 * later expanded, from `recall.decision` and `recall.credit` rows. Pure
 * function, then the console command over a real store.
 *
 * Hermetic: a fresh temp data dir per test, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/commands.js";
import type { Io } from "../src/adapters/cli/index.js";
import { RECALL_CREDIT_EVENT, RECALL_DECISION_EVENT } from "../src/core/counterpart.js";
import { probeOQ4, renderProbe } from "../src/core/recall/probe.js";
import { FOOTNOTE_HEADER_STEP_0, FOOTNOTE_HEADER_STEP_1, FRAMING, clip } from "../src/core/recall/render.js";
import { TUNABLES as RECALL } from "../src/core/recall/tunables.js";
import { Store } from "../src/core/store/index.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-probe-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

const decision = (session: string, date: string, footnotes: string[], surfaced: string[] = []) => ({
  name: RECALL_DECISION_EVENT,
  day: 1,
  payload: JSON.stringify({
    session,
    date,
    footnotes: footnotes.map((id) => ({ id, sal: 0.5, activation: 1 })),
    surfaced: surfaced.map((id) => ({ id, sal: 0.9, activation: 9 })),
  }),
});
const credit = (session: string, date: string, expandedIds: string[]) => ({
  name: RECALL_CREDIT_EVENT,
  day: 1,
  payload: JSON.stringify({ session, date, reason: "credited", expandedIds }),
});

describe("probeOQ4 (pure)", () => {
  test("counts, per session and per day, the footnotes delivered and the ones later expanded", () => {
    const r = probeOQ4([
      decision("s1", "2026-09-14", ["mem_a", "mem_b", "mem_c"]),
      decision("s1", "2026-09-14", ["mem_b", "mem_d"], ["mem_z"]),
      credit("s1", "2026-09-14", ["mem_b", "mem_q"]),
      decision("s2", "2026-09-15", ["mem_e"]),
      credit("s2", "2026-09-15", []),
      // Not the probe's rows: ignored, not counted as unparseable.
      { name: "adapter.boundary", day: 1, payload: "{}" },
      // A row that will not parse is COUNTED.
      { name: RECALL_CREDIT_EVENT, day: 1, payload: "not json" },
    ]);
    expect(r.decisions).toBe(3);
    expect(r.credits).toBe(2);
    expect(r.unparseable).toBe(1);
    const s1 = r.sessions.find((s) => s.session === "s1");
    expect(s1).toEqual({
      session: "s1",
      date: "2026-09-14",
      turns: 2,
      footnotesDelivered: 4,
      loudDelivered: 1,
      expanded: 2,
      footnotesExpanded: 1,
    });
    expect(r.days.map((d) => [d.date, d.footnotesDelivered, d.footnotesExpanded, d.ratio])).toEqual([
      ["2026-09-14", 4, 1, 0.25],
      ["2026-09-15", 1, 0, 0],
    ]);
    expect(r.totals).toEqual({ footnotesDelivered: 5, footnotesExpanded: 1, ratio: 0.2 });
  });

  test("an id expanded that was never footnoted does not count as a footnote expanded", () => {
    const r = probeOQ4([decision("s1", "2026-09-14", ["mem_a"]), credit("s1", "2026-09-14", ["mem_b"])]);
    expect(r.totals.footnotesExpanded).toBe(0);
    expect(r.sessions[0]?.expanded).toBe(1);
  });

  test("a day with nothing delivered has no ratio, not a zero", () => {
    const r = probeOQ4([decision("s1", "2026-09-14", []), credit("s1", "2026-09-14", ["mem_b"])]);
    expect(r.days[0]?.ratio).toBe(null);
    expect(r.totals.ratio).toBe(null);
    expect(renderProbe(r).join("\n")).toContain("   -");
  });
});

describe("the probe's one string, and the title cap", () => {
  test("the footnote header is at step 1 and step 0 is kept beside it, so the step reverses by one line", () => {
    expect(FRAMING.footnoteHeader).toBe(FOOTNOTE_HEADER_STEP_1);
    expect(FOOTNOTE_HEADER_STEP_0).toBe("Quietly available (ignorable):");
    expect(FOOTNOTE_HEADER_STEP_1.startsWith("Quietly available (ignorable")).toBe(true);
    expect(FOOTNOTE_HEADER_STEP_1).toContain("expand an id with recall before citing one");
  });

  test("a footnote title renders whole up to 150 bytes, where 80 clipped it mid-clause", () => {
    expect(RECALL.FOOTNOTE_TITLE_BYTES).toBe(150);
    const title =
      "When Mike asks 'what do you remember?' or 'what context do you see at startup?', he is testing whether deferred tools feel primary";
    expect(title.length).toBeGreaterThan(80);
    expect(title.length).toBeLessThanOrEqual(150);
    expect(clip(title, RECALL.FOOTNOTE_TITLE_BYTES)).toBe(title);
    expect(clip(title, 80).endsWith("...")).toBe(true);
    // An 80-character title with one em-dash lost its tail at 80 BYTES.
    const dashed = "I asked Mike in return: 'Now that you know what arrived and how it landed — what";
    expect(dashed.length).toBe(80);
    expect(clip(dashed, 80).endsWith("...")).toBe(true);
    expect(clip(dashed, RECALL.FOOTNOTE_TITLE_BYTES)).toBe(dashed);
  });
});

describe("counterparts probe-oq4", () => {
  test("prints the table from a real store's rows, read-only", async () => {
    const s = Store.open({ dir });
    try {
      for (const row of [
        decision("s1", "2026-09-14", ["mem_a", "mem_b"]),
        credit("s1", "2026-09-14", ["mem_a"]),
      ]) {
        s.appendEvent({ name: row.name, day: row.day, payload: JSON.parse(row.payload) as Record<string, unknown> });
      }
    } finally {
      s.close();
    }
    const c = capture();
    expect(await run(["probe-oq4", "--dir", dir], { io: c.io, env: {} })).toBe(EXIT.ok);
    const text = c.out.join("\n");
    expect(text).toContain("OQ4 probe");
    expect(text).toContain("2026-09-14");
    expect(text).toContain("2 footnotes delivered, 1 later expanded (50.0%)");
    expect(c.err).toEqual([]);
  });

  test("no store: usage exit, sentence on stderr, like status", async () => {
    const c = capture();
    const empty = join(dir, "nothing-here");
    expect(await run(["probe-oq4", "--dir", empty], { io: c.io, env: {} })).toBe(EXIT.usage);
    expect(c.err.join("\n")).toContain("No store at");
    expect(c.out).toEqual([]);
  });
});
