#!/usr/bin/env bun
/**
 * WAKE DUMP — every wake this tree composes, for a fixed set of stores and
 * budgets, on a frozen clock, to stdout.
 *
 * It exists for one proof (E1, 2026-09-20): **with no handoff written, the wake
 * is byte-identical to master.** The handoff pointer is spliced at DELIVERY and
 * its room is reserved out of the compose budget at the BOUNDARY, so the claim
 * is about two seams at once, and the only honest way to check it is to compose
 * the same wakes in both trees and `diff` the bytes. Run:
 *
 *     git archive origin/master | tar -x -C <tmp>/master
 *     cp tools/wake-dump.ts <tmp>/master/tools/
 *     bun tools/wake-dump.ts > <tmp>/here.txt
 *     (cd <tmp>/master && bun tools/wake-dump.ts) > <tmp>/master.txt
 *     diff <tmp>/master.txt <tmp>/here.txt   # exit 0
 *
 * `--wide` sweeps the budget instead of sampling it: 6 shapes x 376 budgets =
 * 2,256 compositions, about 3 MB, ~20 s per tree. Run that before believing the
 * claim; the narrow default is for checking it has not broken.
 *
 * It is deterministic by construction: the clock is frozen, the delivery date is
 * stated, every store is built from the same fixed prose, and the wake bundle
 * carries no ids or paths. It writes nothing outside the temp dir it makes and
 * removes, and it runs against a store nobody else owns (CLAUDE.md).
 *
 * It is a TOOL and not a test on purpose: half of what it compares lives in
 * another checkout, which a hermetic test may not reach.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";

/** Frozen: the preface states the date and the store's size, and a wall clock
 *  would make every run differ from every other. */
const AT = "2026-09-20";
const NOW = Date.parse(`${AT}T12:00:00Z`);
/**
 * `--wide` sweeps the budget rather than sampling it, which is what the
 * adversarial reviewer did to widen this proof from 35 compositions to 2,824.
 * The narrow set is the default because it runs in a second and catches the
 * shapes that matter; the wide one is what to run before believing the claim.
 */
const WIDE = process.argv.includes("--wide");
const BUDGETS = WIDE
  ? [
      ...Array.from({ length: 256 }, (_, i) => 380 + i * 4),
      ...Array.from({ length: 120 }, (_, i) => 1_600 + i * 500),
    ]
  : [400, 900, 2_000, 4_096, 6_000, 9_000, 20_000];

/** Neutral placeholder prose — a fixture that reads like a real identity is one
 *  somebody later mistakes for one. */
const ELEMENTS = [
  "Placeholder: prefers the shortest rule that could work.",
  "Placeholder: reads the code before the plan.",
  "Placeholder: says what it refused, where it will be seen.",
  "Placeholder: one brain function per module, and no more.",
  "Placeholder: forgetting is a feature and is never apologized for.",
  "Placeholder: a cap that cuts something off is reconsidered, not worked around.",
];
const PAGE = [
  "## Core",
  "",
  "Placeholder core paragraph, written in the first person and left deliberately dull.",
  "",
  "## Lately",
  "",
  "Placeholder lately paragraph, one sentence of it, and then another sentence of it.",
].join("\n");

type Shape = "empty" | "identity" | "page" | "page-and-lanes" | "long-page" | "folder";

/** The folder a "folder" shape's session opens in, with a handoff, a chapter and other folders' work. */
const HERE = "/fixture/here";
const THERE = "/fixture/there";
const HERE_FACTS = { scope: HERE, session: "cccc3333-0000-4000-8000-000000000003", exportsFrom: (s: string): boolean => s === HERE || s === THERE, installed: "9.9.9" };

function build(dir: string, shape: Shape): Counterpart {
  const c = Counterpart.open({ dir, now: () => NOW });
  if (shape === "empty") return c;
  if (shape !== "page" && shape !== "long-page") {
    for (const [i, body] of ELEMENTS.entries()) {
      c.store.put({
        // EXPLICIT IDS. `newId` is random and the ranking breaks ties on the id,
        // so a generated fixture composes a different ORDER on every run and the
        // diff this tool exists for would be noise.
        id: `mem_fixture0000${i}`,
        type: "memory",
        kind: "self",
        body,
        band: "identity",
        learnedOn: AT,
        salience: { relevance: 0.8, emotional: 0.5, predictive: 0.5 },
        physics: { promotedIdentity: true },
      });
    }
  }
  if (shape === "page-and-lanes") {
    for (let i = 0; i < 8; i++) {
      c.store.put({
        id: `mem_craft00000${i}`,
        type: "memory",
        kind: "skill",
        body: `Placeholder craft ${i}: a sentence about how the work is done here.`,
        band: "semantic",
        learnedOn: AT,
        salience: { relevance: 0.7, emotional: 0.2, predictive: 0.4 },
      });
    }
  }
  if (shape === "page" || shape === "page-and-lanes") {
    c.revisePage(PAGE, { reason: "fixture", by: "owner" });
  }
  if (shape === "folder") {
    // THE SPLICE SEAM (WK2, 2026-10-30): a delivery that names a folder, so the
    // proof covers "where this folder stands", "Today, elsewhere", "Coming up"
    // and "Still open", not just the no-scope road.
    c.revisePage(PAGE, { reason: "fixture", by: "owner" });
    c.writeHandoff("next: fire the second batch (waiting on the clay)\nThe glaze tiles are drying on rack two.", { scope: HERE, session: "aaaa1111-0000-4000-8000-000000000001" });
    c.writeHandoff("An older handoff with enough plain words to be a sentence of its own.", { scope: HERE, session: "bbbb2222-0000-4000-8000-000000000002" });
    const put = (id: string, body: string, more: Record<string, unknown>, scope = HERE): void => {
      c.store.put({ id, type: "memory", kind: "fact", body, title: body.slice(0, 40), about: "work", learnedOn: AT, salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 }, origin: { session: "bbbb2222-0000-4000-8000-000000000002", scope }, ...more });
    };
    put("mem_fixture1000", "Placeholder open thread here, still waiting on an answer.", { meta: { unresolved: true } });
    put("mem_fixture1001", "Placeholder due today in this folder, a dated thing.", { eventDate: AT });
    put("mem_fixture1002", "Placeholder plain reminder due today, said plainly.", { eventDate: AT, meta: { remind: "plain" } });
    put("mem_fixture1003", "Placeholder later date in this folder, a dated thing.", { eventDate: "2026-09-25" });
    put("mem_fixture1004", "Placeholder work in the other folder, today.", {}, THERE);
  }
  if (shape === "long-page") {
    const long = Array.from(
      { length: 120 },
      (_, i) => `Placeholder paragraph ${i}, long enough to make the page compete for the budget.`,
    ).join("\n\n");
    c.revisePage(`## Core\n\n${long}`, { reason: "fixture", by: "owner" });
  }
  return c;
}

const shapes: Shape[] = ["empty", "identity", "page", "page-and-lanes", "long-page", "folder"];
const out: string[] = [];
for (const shape of shapes) {
  for (const budget of BUDGETS) {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-wakedump-"));
    try {
      const c = build(dir, shape);
      const report = c.rebrief({ budgetBytes: budget, at: AT });
      const woke = shape === "folder" ? c.wake(budget, { date: AT }, HERE_FACTS) : c.wake(budget, { date: AT });
      out.push(`===== shape=${shape} budget=${budget} =====`);
      out.push(
        `rendered=${report.rendered} published=${report.published} composeBudget=${String(report.composeBudget)} bytes=${report.bytes} elements=${report.elements}`,
      );
      out.push(`wake ok=${woke.ok} reason=${woke.reason} bytes=${woke.bytes}`);
      out.push(woke.text);
      out.push("");
      c.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
process.stdout.write(`${out.join("\n")}\n`);
