/**
 * THE TAIL AFTER A COMPACTION (CT1, 2026-11-04).
 *
 * The developer week's d2s1: a session wrote its own chapter at a Stop ask,
 * then compacted, then said three things in six minutes and ended. Its record
 * came before the cut, so the floor's span held the tail back
 * (`under-floor:span`) and it was never written up. Now what follows a
 * session's newest compaction counts as unrecorded unless a record of its own
 * reaches past it. Through the real night: `runNight`, its catch-up child
 * driving the real MCP server as the runner.
 *
 * Negatives: the same short tail said BEFORE a compaction (nothing after the
 * cut), and the same session with no compaction at all, stay not owed; a tail
 * after a record written after the cut stays on the floor.
 *
 * Hermetic (CLAUDE.md): a fresh temp store per test, removed after. No model
 * and no `claude`: the child is an injected starter.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AdapterConfig } from "../src/adapters/config.js";
import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { openNightCounterpart, runNight } from "../src/adapters/claude-code/night-run.js";
import { coverageReading } from "../src/adapters/cli/coverage.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { SCOPE_ENV, SESSION_ENV } from "../src/adapters/spawn.js";
import { CLAIM_CHAPTER, claimUnwritten } from "../src/core/coverage/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { localDate } from "../src/core/time.js";
import { whyNotOwed } from "../tools/harness/week.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

let root: string;
let dir: string;
let proj: string;
let launch: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-compaction-tail-")));
  dir = join(root, "store");
  proj = join(root, "proj");
  launch = join(root, "launch");
  for (const d of [dir, proj, launch]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const config = (): AdapterConfig => ({ dataDir: dir, injectionBudgetBytes: 9000 });
const TODAY = (): string => localDate(Date.now());

function yesterday10(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - 14 * HOUR;
}

type Shape = "tail-after-compaction" | "tail-before-compaction" | "no-compaction" | "record-after-compaction";

/**
 * d2s1's day, as the hooks leave it in the store: six turns over 48 minutes,
 * then its own chapter (the Stop ask answered), then — by shape — a compaction
 * (the PreCompact capture and its `pre-compaction` boundary), and three short
 * prompts three minutes apart, each captured at its Stop; then its end.
 */
function lived(id: string, shape: Shape): void {
  let at = yesterday10();
  const c = Counterpart.open({ dir, now: () => at });
  try {
    recordSession(dir, { sessionId: id, scope: proj, phase: "start", at, entrypoint: "cli" });
    const turns: { role: "user" | "assistant"; text: string }[] = [];
    const say = (text: string): void => {
      turns.push({ role: "user", text });
      turns.push({ role: "assistant", text: `(${id}) Noted: ${text}` });
      c.captureSpans({ session: id, scope: proj, turns: [...turns] });
      c.boundary({ session: id, scope: proj, kind: "stop" });
      recordSession(dir, { sessionId: id, scope: proj, phase: "boundary", at });
    };
    const compact = (): void => {
      at += 10 * MIN;
      c.captureSpans({ session: id, scope: proj, turns: [...turns] });
      c.boundary({ session: id, scope: proj, kind: "pre-compaction" });
    };
    for (let i = 0; i < 6; i++) {
      at += 8 * MIN;
      say(`${id} #${String(i)}: the migration renames the orders column before the backfill runs.`);
    }
    // ITS OWN RECORD, at the Stop ask: a chapter claims everything unclaimed.
    at += MIN;
    expect(claimUnwritten(c.spans, { session: id, scope: proj, by: CLAIM_CHAPTER, ref: `ep-${id}` }).pieces).toBe(6);
    if (shape === "tail-after-compaction" || shape === "record-after-compaction") compact();
    if (shape === "record-after-compaction") {
      at += MIN;
      say(`${id}: after the summary, the backfill batch size is 500.`);
      at += MIN;
      claimUnwritten(c.spans, { session: id, scope: proj, by: CLAIM_CHAPTER, ref: `ep2-${id}` });
    }
    // THE TAIL: three prompts in six minutes (11:22, 11:25, 11:28), each Stop skipped.
    at += 2 * MIN;
    say(`${id}: rename the flag to orders_v2.`);
    at += 3 * MIN;
    say(`${id}: keep the old index until Friday.`);
    at += 3 * MIN;
    say(`${id}: Ines starts her first shift at the bakery tomorrow, she is nervous.`);
    if (shape === "tail-before-compaction") compact();
    at += MIN;
    c.boundary({ session: id, scope: proj, kind: "session-end" });
    recordSession(dir, { sessionId: id, scope: proj, phase: "end", at });
  } finally {
    c.close();
  }
}

/** The catch-up child, as its one tool drives it: fetch, answer, until done. */
function drivingChild(seen: ChildPlan[]): (plan: ChildPlan) => Promise<ChildResult> {
  return async (plan) => {
    seen.push(plan);
    const runner = plan.env[SESSION_ENV] as string;
    const ids = [...plan.stdin.matchAll(/^- ([A-Za-z0-9._-]+):/gm)].map((m) => m[1] as string);
    const s = openServer({ dir, session: runner, scope: plan.env[SCOPE_ENV] as string });
    try {
      for (const id of ids) {
        for (let guard = 0; guard < 10; guard++) {
          const f = (await s.call("session_end", { session: runner, writeUp: id })).structuredContent;
          if (f["reason"] !== "part") break;
          const part = f["part"] as number;
          const memories = [{ content: `Written up from ${id}, part ${String(part)}: the flag is renamed to orders_v2.`, kind: "fact" }];
          const a = (await s.call("session_end", { session: runner, writeUp: id, part, memories })).structuredContent;
          if (a["reason"] !== "part-written") break;
        }
      }
    } finally {
      s.counterpart.close();
    }
    return { code: 0, timedOut: false, error: null };
  };
}

async function night(runId: string, seen: ChildPlan[]): Promise<void> {
  await runNight({
    open: () => openNightCounterpart(config()),
    config: config(),
    run: runId,
    session: "s-launch",
    scope: launch,
    kind: { kind: "night" },
    date: TODAY(),
    baseEnv: { PATH: "/usr/bin:/bin" },
    startCatchUp: drivingChild(seen),
    start: async () => ({ code: 0, timedOut: false, error: null }),
  });
}

function rowOf(id: string): ReturnType<typeof coverageReading>[number] | undefined {
  const c = openNightCounterpart(config());
  try {
    return coverageReading(c.store).find((e) => e.session === id);
  } finally {
    c.close();
  }
}

function writtenFrom(): string[] {
  const c = openNightCounterpart(config());
  try {
    return [...new Set(c.store.list({ type: "memory", archived: false }).map((id) => c.store.row(id)?.origin_session ?? ""))].filter((s) => s.length > 0).sort();
  } finally {
    c.close();
  }
}

describe("CT1: what follows a session's newest compaction counts as unrecorded", () => {
  test("a recorded session's three-prompt tail after a compaction is owed, and the night writes it up", async () => {
    lived("s-tail", "tail-after-compaction");
    const before = rowOf("s-tail")!;
    expect(before).toMatchObject({ owed: true, person: true, recorded: true, overFloor: false, compactionTail: 3, small: true });
    expect(before.stretch).toMatchObject({ pieces: 3, minutes: 6 });
    expect(whyNotOwed(before)).toBeNull();

    const seen: ChildPlan[] = [];
    await night("nrn_tail", seen);
    expect(seen.length).toBe(1);
    expect(seen[0]!.stdin).toContain("- s-tail:");
    expect(writtenFrom()).toEqual(["s-tail"]);
    // Written up: nothing left, so nothing owed and nothing to carry.
    const after = rowOf("s-tail")!;
    expect(after).toMatchObject({ owed: false, stretch: null, compactionTail: 0 });
    expect(whyNotOwed(after)).toBe("written");
  });

  test("the same tail said BEFORE a compaction (nothing after the cut) stays held to the floor: not owed", async () => {
    lived("s-before", "tail-before-compaction");
    const row = rowOf("s-before")!;
    expect(row).toMatchObject({ owed: false, recorded: true, overFloor: false, compactionTail: 0 });
    expect(row.compactedAt).not.toBeNull();
    expect(whyNotOwed(row)).toBe("under-floor:span:before-compaction");
    const seen: ChildPlan[] = [];
    await night("nrn_before", seen);
    expect(seen.length).toBe(0);
    expect(writtenFrom()).toEqual([]);
  });

  test("a session with no compaction is unchanged: its short tail after its record owes nothing", async () => {
    lived("s-plain", "no-compaction");
    const row = rowOf("s-plain")!;
    expect(row).toMatchObject({ owed: false, recorded: true, overFloor: false, compactedAt: null, compactionTail: 0 });
    expect(whyNotOwed(row)).toBe("under-floor:span");
    const seen: ChildPlan[] = [];
    await night("nrn_plain", seen);
    expect(seen.length).toBe(0);
    expect(writtenFrom()).toEqual([]);
  });

  test("a record of its own written AFTER the cut holds the tail after it to the floor again", () => {
    lived("s-again", "record-after-compaction");
    const row = rowOf("s-again")!;
    expect(row).toMatchObject({ owed: false, recorded: true, compactionTail: 0 });
    expect(row.stretch).toMatchObject({ pieces: 3 });
    expect(whyNotOwed(row)).toBe("under-floor:span:recorded-after-compaction");
  });
});
