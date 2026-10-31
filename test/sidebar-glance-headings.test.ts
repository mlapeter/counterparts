/**
 * THE SIDEBAR'S FIRST GLANCE AGAINST THE WAKE CORE WRITES (2026-10-30). The sidebar
 * reads the wake's lines by their words (`hooks/sidebar/hooks/feed.ts`), and it can't
 * import core. #687 renamed the block they lead with and nothing failed: the glance
 * quietly fell through to the first Coming up item. Its own tests run under
 * `hooks/sidebar/check.sh`, not in CI, so this holds the two together here.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { STANDS_HEAD, standsLadder } from "../src/core/handoff/index.js";
import type { Handoff } from "../src/core/handoff/index.js";
import { yesterdaySummaryForms } from "../src/core/handoff/last-here.js";
import type { LastHere } from "../src/core/handoff/last-here.js";
import { FRAMING } from "../src/core/self/briefing.js";

// The sidebar mod's own module, outside this project's type-check (extensionless imports; `tsc -p hooks/sidebar` checks it).
const FEED_TS: string = "../hooks/sidebar/hooks/feed.ts";
const { GLANCE_STANDS, parseGlance } = (await import(FEED_TS)) as {
  GLANCE_STANDS: string;
  parseGlance: (text: string) => { head: string; text: string } | null;
};

const HERE = "/proj/here";
const BUDGET = 9_000;

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-glance-"));
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

function adapter(): ReturnType<typeof openAdapter> {
  const a = openAdapter({ dataDir: dir, injectionBudgetBytes: BUDGET }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  open.push(a.counterpart);
  return a;
}

/** The session start, through the real hook's adapter, on a store with a page. */
function wake(a: ReturnType<typeof openAdapter>): string {
  const c = a.counterpart;
  expect(c.rebrief({ budgetBytes: BUDGET, at: c.store.today() }).published).toBe(true);
  const out = a.sessionStart(toHookInput({ session_id: "s-new", hook_event_name: "SessionStart", cwd: HERE }, { scope: HERE, timeZone: c.store.zone(), env: {} }));
  return out.injection ?? "";
}

function withPage(a: ReturnType<typeof openAdapter>): void {
  expect(a.counterpart.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first page", by: "owner" }).written).toBe(true);
}

function handoff(body: string): Handoff {
  return { id: "sch_000000000001", scope: HERE, body, bytes: Buffer.byteLength(body), writtenOn: "2026-10-28", writtenDay: 9, session: "aaaa0001-0000-4000-8000-000000000000", model: null, version: 1 };
}

function chapter(session: string): LastHere {
  return {
    chapter: { id: "epi_000000000001", session, model: null, title: "The kiln day", excerpt: "We fired the second batch.", chapters: 1, writtenAt: 0, createdAt: 0, writtenDay: 9, scope: null },
    when: "Oct 29 09:00–10:00",
    date: "Oct 29",
  };
}

describe("the sidebar's glance reads the headings core writes", () => {
  test("the block's heading is core's", () => {
    expect(GLANCE_STANDS).toBe(STANDS_HEAD);
  });

  test("through the real session start: the newest handoff's first line, not Coming up", () => {
    const a = adapter();
    withPage(a);
    const c = a.counterpart;
    const today = c.store.today();
    const before = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    c.store.put({ type: "memory", kind: "person", body: "Return the borrowed tiller.", learnedOn: before, eventDate: today, salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 } });
    recordSession(dir, { sessionId: "sess_1", scope: HERE, phase: "start" });
    c.handoffs.write({ body: "The glaze tiles dry on rack two.\nNext, check the kiln.", scope: HERE, session: "sess_1" });
    const text = wake(a);
    expect(text).toContain(STANDS_HEAD);
    expect(text).toContain(FRAMING.horizon);
    expect(parseGlance(text)).toEqual({ head: "Last here", text: "The glaze tiles dry on rack two." });
  });

  test("through the real session start: a handoff of one line, on the header's own line", () => {
    const a = adapter();
    withPage(a);
    recordSession(dir, { sessionId: "sess_1", scope: HERE, phase: "start" });
    a.counterpart.handoffs.write({ body: "The glaze tiles dry on rack two.", scope: HERE, session: "sess_1" });
    expect(parseGlance(wake(a))).toEqual({ head: "Last here", text: "The glaze tiles dry on rack two." });
  });

  test("every rung the composer can write, down to the chapter alone, says where things were left", () => {
    const session = "aaaa0001-0000-4000-8000-000000000000";
    const body = "One thing that is long enough.\nTwo things.\nNext: three things.";
    const facts = { chapter: { entry: chapter(session), at: 100 } };

    const both = standsLadder({ handoffs: [{ handoff: handoff(body), at: 100, since: null }], day: 10, ...facts });
    expect(both.length).toBeGreaterThan(1);
    for (const rung of both) {
      const g = parseGlance(rung.block);
      expect(g?.head).toBe("Last here");
      // The handoff's first line while any of it fits; the chapter when none does.
      expect(g?.text).toBe(rung.shown.length > 0 ? "One thing that is long enough." : '"The kiln day"');
    }

    const alone = standsLadder({ handoffs: [{ handoff: handoff(body), at: 100, since: null }], day: 10 });
    for (const rung of alone) expect(parseGlance(rung.block)?.text).toBe("One thing that is long enough.");

    const noHandoff = standsLadder({ handoffs: [], day: 10, ...facts });
    expect(parseGlance(noHandoff[0]?.block ?? "")).toEqual({ head: "Last here", text: '"The kiln day". We fired the second batch.' });
    expect(parseGlance(noHandoff.at(-1)?.block ?? "")).toEqual({ head: "Last here", text: '"The kiln day"' });
  });

  test("Coming up and Yesterday, the next two it looks for, are core's words too", () => {
    expect(parseGlance(`${FRAMING.horizon}\n- due 2026-10-15 · Vote`)).toEqual({ head: "Coming up", text: "2026-10-15 · Vote" });
    const [dated] = yesterdaySummaryForms("The kiln was fired.", [], "2026-10-29");
    expect(parseGlance(dated ?? "")?.head).toStartWith("Yesterday, ");
    expect(parseGlance(dated ?? "")?.text).toContain("The kiln was fired.");
    const [undated] = yesterdaySummaryForms("The kiln was fired.", [], "2026-10-29", [], false);
    expect(parseGlance(undated ?? "")?.head).toStartWith("Yesterday");
    expect(parseGlance(undated ?? "")?.text).toContain("The kiln was fired.");
  });
});
