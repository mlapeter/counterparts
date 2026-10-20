/**
 * THE WAKE ON RESUME (2026-10-11, the context-trims lane; lightly held).
 *
 * Claude Code fires `SessionStart` again on `--resume`, `--continue` and
 * `/resume`, and replays the transcript with the first wake still in it
 * (measured 2026-10-10), so a second full wake was ~9 KB the model read twice.
 * A resume of a session handed its wake TODAY is now handed one line saying
 * the wake above still holds, and the "Since you started" line when another
 * directory changed since it last heard. Pinned here, through the real hooks:
 *   - a startup is handed the full wake; a resume the same day the short one —
 *     no wake block, no new expectation for the delivery check, the row saying
 *     `resumed`;
 *   - a resume says what changed elsewhere, whatever the since-line's hour;
 *   - a resume on a LATER day, a compaction (which summarizes the first wake
 *     away), and a resume with no record are each handed the full wake.
 *
 * Hermetic: every test opens a fresh temp dir and removes it; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { ClaudeCodeAdapter, RESUME_WAKE_LINE } from "../src/adapters/claude-code/hooks.js";
import type { HookInput, HookResult } from "../src/adapters/claude-code/hooks.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import { markSinceSeen, readSession, recordSession } from "../src/adapters/sessions.js";
import { MEET_LINE_OPEN, beginNewInstall } from "../src/core/onboarding.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ZONE = "UTC";
const D = "2026-10-11";
const NEXT = "2026-10-12";
const at = (h: number, m = 0, day = D): number => Date.parse(`${day}T00:00:00Z`) + h * HOUR + m * MIN;

/** This session, in HERE; another, in THERE. */
const S = "5e550000-0000-4000-8000-000000000001";
const A = "a1b2c3d4-0000-4000-8000-00000000000a";
const WAKE_BLOCK = "<!-- counterparts:wake";

let root: string;
let storeDir: string;
let HERE: string;
let THERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-resume-")));
  storeDir = join(root, "store");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  for (const d of [HERE, THERE]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

interface World {
  c: Counterpart;
  hooks(): ClaudeCodeAdapter;
  set(t: number): void;
}

/** A store with a published wake, on the test's clock, and hooks over it. */
async function world(start: number): Promise<World> {
  let now = start;
  const c = Counterpart.open({ dir: storeDir, owner: true, now: () => now, timeZone: ZONE });
  open.push(c);
  c.store.put({
    type: "memory",
    kind: "fact",
    body: "The north bed takes the morning sun; the beans go there next spring.",
    salience: { novelty: null, relevance: 0.9, emotional: 0.6, predictive: 0.8 },
    physics: { birthDay: 0, lastUsedDay: 0 },
  });
  await c.sessionEnd({ date: D, budgetBytes: 9_000 });
  // A scope setting beside the configuration, so another directory may be named.
  writeScopes(join(root, "scopes.json"), setScope(null, join(root, "nothing-here"), "off", { at: D }));
  const verdict = { mode: "on", matched: HERE, entry: null } as ScopeVerdict;
  return {
    c,
    hooks: () =>
      new ClaudeCodeAdapter({
        counterpart: c,
        config: { dataDir: storeDir, owner: true, injectionBudgetBytes: 9_000 },
        configPath: join(root, "claude-code.json"),
        now: () => now,
        scope: verdict,
        command: "/bin/true",
        args: ["runner"],
        spawner: () => ({ pid: 4242 }),
      }),
    set(t: number) {
      now = t;
    },
  };
}

function start(w: World, t: number, source: string, day = D): { result: HookResult; hooks: ClaudeCodeAdapter } {
  w.set(t);
  const hooks = w.hooks();
  return { result: hooks.sessionStart({ sessionId: S, scope: HERE, at: day, source } as HookInput), hooks };
}

describe("the wake on resume", () => {
  test("a startup is handed the full wake; a resume the same day, one line — no block, no new expectation, the row says so", async () => {
    const w = await world(at(9));
    const first = start(w, at(9), "startup").result;
    expect(first.injection).toContain(WAKE_BLOCK);
    expect(first.sentinel).not.toBe(null);
    const expected = readSession(storeDir, S)?.wakeSentinel;
    expect(expected).toBe(first.sentinel as string);

    const { result, hooks } = start(w, at(11), "resume");
    expect(result.reason).toBe("resumed");
    expect(result.injection).toContain(RESUME_WAKE_LINE);
    expect(result.injection).not.toContain(WAKE_BLOCK);
    expect(result.injection.startsWith("Now: ")).toBe(true);
    expect(result.sentinel).toBe(null);
    // What the trim is for: the full wake against what a resume is handed.
    expect(Buffer.byteLength(result.injection, "utf8")).toBeLessThan(250);
    expect(Buffer.byteLength(first.injection, "utf8")).toBeGreaterThan(Buffer.byteLength(result.injection, "utf8"));
    // The delivery check still tests the wake that WAS printed.
    expect(readSession(storeDir, S)?.wakeSentinel).toBe(expected as string);
    const rows = hooks.events("adapter.wake.injected");
    expect(rows.at(-1)?.data["resumed"]).toBe(true);
    expect(rows.at(-1)?.data["reason"]).toBe("resumed");
  });

  test("a resume says what changed in another directory since this session last heard, whatever the hour", async () => {
    const w = await world(at(9));
    start(w, at(9), "startup");
    // A since-line went out at 10:00: a prompt before 11:00 would say nothing.
    markSinceSeen(storeDir, S, { at: at(10), state: "shown" });
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(10, 10) });
    w.set(at(10, 12));
    w.c.store.put({ type: "memory", kind: "fact", body: "The starter wants feeding twice a day in the warm months.", about: "work", origin: { session: A, scope: THERE } });
    const { result } = start(w, at(10, 30), "resume");
    const lines = result.injection.split("\n");
    const line = lines.indexOf(RESUME_WAKE_LINE);
    expect(line).toBeGreaterThan(0);
    expect(lines[line + 1]).toMatch(/^Since 10:00: .*bakery open since 10:10, 1 memory\.$/);
    // And the line's own state moved, so the next prompt counts from here.
    expect(readSession(storeDir, S)?.sinceSeen).toEqual({ at: at(10, 30), state: "shown" });
  });

  test("a resume on a later day, a compaction, and a resume with no record are each handed the full wake", async () => {
    const w = await world(at(9));
    start(w, at(9), "startup");
    expect(start(w, at(12), "compact").result.injection).toContain(WAKE_BLOCK);
    const nextDay = start(w, at(8, 0, NEXT), "resume", NEXT).result;
    expect(nextDay.injection).toContain(WAKE_BLOCK);
    expect(nextDay.injection).not.toContain(RESUME_WAKE_LINE);

    // A session this store has no record of (pruned, or another store's).
    w.set(at(9, 30, NEXT));
    const stranger = w.hooks().sessionStart({ sessionId: "c9cacbcc-0000-4000-8000-00000000000c", scope: HERE, at: NEXT, source: "resume" } as HookInput);
    expect(stranger.injection).toContain(WAKE_BLOCK);
  });

  // Review of #415: only the host's own `resume` earns the short line. A host
  // that sends no `source` (an older Claude Code), an empty or unknown one, a
  // `startup`, `clear` or `fork` re-firing for the same session the same day
  // is each handed the full wake.
  test("a same-day start whose source is missing, unknown, startup, clear or fork is handed the full wake", async () => {
    const w = await world(at(9));
    start(w, at(9), "startup");
    let t = at(9, 30);
    for (const source of [undefined, "", "Resume", "later", "startup", "clear", "fork"]) {
      w.set((t += 10 * MIN));
      const input = { sessionId: S, scope: HERE, at: D, ...(source === undefined ? {} : { source }) } as HookInput;
      const result = w.hooks().sessionStart(input);
      expect(result.injection).toContain(WAKE_BLOCK);
      expect(result.injection).not.toContain(RESUME_WAKE_LINE);
      expect(result.reason).not.toBe("resumed");
    }
    // And the hook carries nothing for a payload with no source.
    expect(toHookInput({ session_id: S, hook_event_name: "SessionStart", cwd: HERE }, { scope: HERE }).source).toBeUndefined();
  });

  // Review of #419: the sidebar mod reads the first meeting's marker on EVERY
  // SessionStart, so the short wake carries it too; the offer line keeps its
  // once-a-session rule across a resume.
  test("a resume's short wake carries the onboarding marker, and not the offer a second time", async () => {
    const w = await world(at(9));
    beginNewInstall(w.c.store);
    const first = start(w, at(9), "startup").result;
    expect(first.injection).toMatch(/^<!-- counterparts:(?:wake|session) meet=not_started /m);
    expect(first.ask ?? "").toContain(MEET_LINE_OPEN);
    const resumed = start(w, at(11), "resume").result;
    expect(resumed.reason).toBe("resumed");
    const lines = resumed.injection.split("\n");
    expect(lines.some((l) => l.startsWith("<!-- counterparts:session meet=not_started "))).toBe(true);
    expect(lines.findIndex((l) => l.startsWith("<!-- counterparts:session meet=not_started "))).toBe(1);
    expect(resumed.ask ?? "").not.toContain(MEET_LINE_OPEN);
    // An upgraded store's resume says done.
    w.c.store.setMeta("onboarding.meet", "done");
    expect(start(w, at(12), "resume").result.injection).toMatch(/^<!-- counterparts:(?:wake|session) meet=done /m);
  });

  test("the hook carries the host's source into the input, and nothing on an event without one", () => {
    const base = { session_id: S, hook_event_name: "SessionStart", cwd: HERE };
    expect(toHookInput({ ...base, source: "resume" }, { scope: HERE }).source).toBe("resume");
    expect(toHookInput({ ...base, hook_event_name: "UserPromptSubmit", prompt: "hi" }, { scope: HERE }).source).toBeUndefined();
  });
});
