/**
 * GROUP 1c — ENCODING AND THE FEELING GATES (2026-10-10, the mechanisms
 * review's 01 C1/C2/C4/C5, 02 C3 and 08 C3).
 *
 *   1. `note` is `remember`; the old name still answers, and is never listed.
 *   2. An unclaimed memory's default floor is by what it is about — and a
 *      default sets height, not the band: a strong feeling on a silent memory
 *      stops just under the semantic floor.
 *   3. The per-session ask cap yields when an unwritten stretch is due.
 *   4. "Strongly felt" is read against the word's own default, so the core's
 *      fast lane can open again — counted on a fixture.
 *
 * (The Stop ask's text is pinned in `stop-ask-quiet.test.ts`, the description
 * lengths in `description-cut.test.ts`, the mood weights in `emotion.test.ts`,
 * the lapse in `coverage.test.ts`.)
 *
 * Hermetic: every test makes its own temp directory and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import {
  TUNABLES,
  band,
  defaultClaimFor,
  promotionEligibility,
  salArm,
  strength,
} from "../src/core/physics/index.js";
import type { MemoryPhysics } from "../src/core/physics/index.js";
import { askDue, freshEpisodeState } from "../src/core/self/episodes.js";
import { SELF_TUNABLES } from "../src/core/self/tunables.js";
import { coreContextFor, feelingIsStrong } from "../src/core/sleep/consolidate.js";
import { Store } from "../src/core/store/index.js";
import {
  TOOL_ALIASES,
  TOOL_NAMES,
  canonicalToolName,
  openServer,
  toolDefinitions,
  toolSpec,
} from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";
let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-g1c-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function server(): McpServer {
  const s = openServer({ dir, session: "sess_g1c", scope: "/scope/g1c", owner: true });
  open.push(s.counterpart);
  return s;
}

const payload = (r: ToolResult): Record<string, unknown> => r.structuredContent;

// ═══════════════════════════════════════════════════════════════════════════
describe("`note` is `remember`, and the old name still answers", () => {
  test("the registry lists `remember`, never `note`; the alias resolves to the same spec", () => {
    expect(TOOL_NAMES).toContain("remember");
    expect(TOOL_NAMES as readonly string[]).not.toContain("note");
    expect(TOOL_ALIASES).toEqual({ note: "remember" });
    expect(canonicalToolName("note")).toBe("remember");
    expect(canonicalToolName("recall")).toBe("recall");
    expect(toolSpec("note")).toBe(toolSpec("remember"));
    expect(toolSpec("note", true)?.name).toBe("remember");
    for (const desktop of [false, true]) {
      const names = toolDefinitions(desktop).map((t) => t["name"]);
      expect(names).toContain("remember");
      expect(names).not.toContain("note");
    }
  });

  test("a cached client's `note` over the wire lands a memory, served as `remember`, and the alias is counted", async () => {
    const s = server();
    const response = (await s.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "note", arguments: { text: "The ferry to the island leaves at seven on weekdays." } },
    })) as unknown as { result?: ToolResult; error?: unknown } | null;
    expect(response?.error).toBeUndefined();
    const out = response?.result?.structuredContent ?? {};
    expect(out["stored"]).toBe(true);
    expect(s.counterpart.store.read(String(out["id"])).doc.body).toContain("ferry to the island");
    expect(s.events("mcp.tool.alias")[0]?.data).toEqual({ asked: "note", served: "remember" });
    expect(s.events("mcp.remember")).toHaveLength(1);
    // A refusal through the old name names the new one.
    const refused = payload(await s.call("note", {}));
    expect(refused["reason"]).toBe("text-required");
    expect(refused["tool"]).toBe("remember");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the default floor by what a memory is about (01 C2)", () => {
  test("the table: a done work event lowest, other work and unmarked as before, the world higher, the owner, us and me highest — all under the semantic floor", () => {
    expect(defaultClaimFor({ about: "work", status: "done" })).toEqual({ claim: 0.2, class: "work-event" });
    expect(defaultClaimFor({ about: "work", status: "planned" })).toEqual({ claim: 0.25, class: "work" });
    expect(defaultClaimFor({ about: "work" })).toEqual({ claim: 0.25, class: "work" });
    expect(defaultClaimFor({})).toEqual({ claim: 0.25, class: "unmarked" });
    // Unmarked and done is not called a routine work event.
    expect(defaultClaimFor({ status: "done" })).toEqual({ claim: 0.25, class: "unmarked" });
    expect(defaultClaimFor({ about: "world" })).toEqual({ claim: 0.35, class: "world" });
    for (const about of ["owner", "us", "me"]) expect(defaultClaimFor({ about }).claim).toBe(0.4);
    // The owner's ruling about work stays high (f8).
    expect(defaultClaimFor({ about: "work", status: "done", saidBy: "owner" })).toEqual({ claim: 0.4, class: "personal" });
    expect(defaultClaimFor({ kind: "person" }).class).toBe("personal");
    expect(defaultClaimFor({ kind: "self", about: "world" }).class).toBe("personal");
    for (const k of ["DEFAULT_CLAIM_WORK_EVENT", "AUTHORED_DEFAULT_CLAIM", "DEFAULT_CLAIM_WORLD", "DEFAULT_CLAIM_PERSONAL"] as const) {
      expect(TUNABLES[k]).toBeLessThan(TUNABLES.THETA_SEM);
    }
  });

  test("through `remember`: the about mark, status and speaker set an unclaimed memory's floor; a claim, however low, is kept", async () => {
    const s = server();
    const claimed = async (args: Record<string, unknown>): Promise<number | null> => {
      const out = payload(await s.call("remember", args));
      expect(out["stored"]).toBe(true);
      return s.counterpart.store.physicsOf(String(out["id"])).salience.claimed ?? null;
    };
    expect(await claimed({ text: "Merged the parser split as pull request 412 into master.", about: "work", status: "done" })).toBe(0.2);
    expect(await claimed({ text: "The parser module should own its own error type next.", about: "work" })).toBe(0.25);
    expect(await claimed({ text: "Read that the city is closing the old pier for a year of repairs.", about: "world" })).toBe(0.35);
    expect(await claimed({ text: "They said they grew up two streets from the harbour.", about: "owner" })).toBe(0.4);
    expect(await claimed({ text: "A plain fact with no mark on it about the kettle.", salience: 0.05, about: "us" })).toBe(0.05);
  });

  test("through a `session_end` entry too", async () => {
    const seen: { name: string; data?: Record<string, unknown> }[] = [];
    const c = Counterpart.open({ dir, owner: true, onEvent: (e) => seen.push(e as unknown as { name: string; data?: Record<string, unknown> }) });
    open.push(c);
    const r = await c.submitSessionEnd({ content: "We decided the two of us read one chapter a night." }, { session: "sess_g1c", scope: "/scope/g1c", about: "us" });
    expect(r.deposited).toBe(true);
    expect(c.store.physicsOf(r.memoryId as string).salience.claimed).toBe(0.4);
    // The default's row says which row of the table it took.
    expect(seen.find((e) => e.name === "salience.defaulted")?.data).toMatchObject({ class: "personal", floor: 0.4 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("a default sets height, not the band (§8, f8)", () => {
  const silent = (claimed: number, feelingPeak: number | null): MemoryPhysics => ({
    kind: "fact",
    salience: { novelty: null, relevance: 0, emotional: 0, predictive: 0, claimed },
    birthDay: 0,
    uses: 0,
    lastUsedDay: 0,
    feelingPeak,
    consolidated: false,
    promotedIdentity: false,
    protected: false,
    pressure: 0,
    lastChallengedDay: null,
  });

  test("a silent owner memory with a strong feeling is lifted, but stops just under the semantic floor", () => {
    const plain = silent(TUNABLES.DEFAULT_CLAIM_PERSONAL, null);
    const felt = silent(TUNABLES.DEFAULT_CLAIM_PERSONAL, 0.9);
    // Without the cap: 0.40 + 0.15 x 0.9 = 0.535, semantic at birth.
    expect(TUNABLES.DEFAULT_CLAIM_PERSONAL + TUNABLES.EMO_LIFT * 0.9).toBeGreaterThan(TUNABLES.THETA_SEM);
    expect(salArm(felt)).toBe(TUNABLES.FELT_HEIGHT_CAP);
    expect(salArm(felt)).toBeGreaterThan(salArm(plain));
    expect(strength(felt, 0)).toBeLessThan(TUNABLES.THETA_SEM);
    expect(band(felt, 0)).toBe("episodic");
    // A feeling recorded later (a reflection's) cannot carry it across either.
    expect(band(silent(TUNABLES.DEFAULT_CLAIM_PERSONAL, 1), 0)).toBe("episodic");
  });

  test("the lift below the cap is untouched, and a claim at the floor keeps the whole lift", () => {
    const low = silent(0.25, 0.6);
    expect(salArm(low)).toBeCloseTo(0.25 + TUNABLES.EMO_LIFT * 0.6, 10);
    const claimedHigh = silent(0.5, 0.9);
    expect(salArm(claimedHigh)).toBeCloseTo(0.5 + TUNABLES.EMO_LIFT * 0.9, 10);
    expect(band(claimedHigh, 0)).toBe("semantic");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the per-session ask cap yields to a due stretch (01 C5)", () => {
  const atCap = () => ({
    ...freshEpisodeState("s-cap", 0),
    asks: SELF_TUNABLES.MAX_ASKS_PER_SESSION,
    asksToday: SELF_TUNABLES.MAX_ASKS_PER_SESSION,
    asksDay: "2026-10-10",
    lastAskAt: 0,
  });
  const quiet = { turns: 0, bytes: 0 };

  test("at the cap, an unwritten stretch that is due still asks; nothing else does", () => {
    const due = askDue(atCap(), quiet, SELF_TUNABLES, {
      observer: false,
      today: "2026-10-10",
      unwritten: { pieces: 5, minutes: 40, due: () => true },
    });
    expect(due).toMatchObject({ due: true, reason: "due-unwritten" });
    const notDue = askDue(atCap(), { turns: 999, bytes: 999_999 }, SELF_TUNABLES, {
      observer: false,
      today: "2026-10-10",
      unwritten: { pieces: 5, minutes: 40, due: () => false },
    });
    expect(notDue).toMatchObject({ due: false, reason: "session-ask-cap" });
    // A new day's allowance is untouched.
    expect(askDue(atCap(), quiet, SELF_TUNABLES, { observer: false, today: "2026-10-11" }).reason).toBe("not-enough-substance");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("\"strongly felt\" is read against the word's own default (08 C3)", () => {
  test("a word at its default is not strongly felt; raised by 0.1, or at 0.6, it is", () => {
    expect(feelingIsStrong({ strength: 0.5, core: "happy", emotion: "hopeful" })).toBe(false);
    expect(feelingIsStrong({ strength: 0.6, core: "happy", emotion: "hopeful" })).toBe(true);
    expect(feelingIsStrong({ strength: 0.55, core: "curious", emotion: "recognized" })).toBe(true);
    expect(feelingIsStrong({ strength: 0.54, core: "curious", emotion: "recognized" })).toBe(false);
    // Above its default but under the 0.5 floor (review of #369): not strong.
    expect(feelingIsStrong({ strength: 0.45, core: "calm", emotion: "relieved" })).toBe(false);
    expect(feelingIsStrong({ strength: 0.5, core: "calm", emotion: "relieved" })).toBe(true);
    expect(feelingIsStrong({ strength: 0.6, core: "curious", emotion: "amazed" })).toBe(true);
    // A word whose own intensity is past the cap is STORED at 0.55 when nobody
    // weighed it (#301 m2): that is not strongly felt; weighed at 0.6 it is.
    expect(feelingIsStrong({ strength: 0.55, core: "curious", emotion: "amazed" })).toBe(false);
  });

  /**
   * THE FIXTURE: eleven memories about us, each with one feeling and a return
   * three lived days after birth (so the return gate is met and only the
   * feeling decides). Old rule: intensity ≥ 0.6. New rule: that, or a
   * feeling 0.1 above its word's default.
   */
  test("on a fixture of eleven, the fast lane opens for 4, up from 2", () => {
    const s = Store.open({ dir });
    open.push(s);
    const fixture: readonly { word: string; core: string; strength?: number }[] = [
      { core: "happy", word: "hopeful" }, // default 0.5: neither
      { core: "warm", word: "grateful" }, // default 0.5: neither
      { core: "curious", word: "interested" }, // default 0.45: neither
      { core: "sad", word: "wistful" }, // default: neither
      { core: "warm", word: "grateful", strength: 0.55 }, // +0.05: neither
      { core: "curious", word: "amazed" }, // intensity 0.6, stored unweighed at the 0.55 cap: neither
      { core: "happy", word: "hopeful", strength: 0.6 }, // 0.6: both
      { core: "curious", word: "amazed", strength: 0.7 }, // weighed: both
      { core: "curious", word: "recognized", strength: 0.55 }, // +0.1: new only
      { core: "calm", word: "relieved", strength: 0.45 }, // +0.1 but under the 0.5 floor: neither
      { core: "sad", word: "wistful", strength: 0.58 }, // well above its default: new only
    ];
    let before = 0;
    let after = 0;
    for (const [i, f] of fixture.entries()) {
      const id = s.put({ type: "memory", kind: "self", body: `A moment the two of us shared, number ${String(i)}.`, about: "us" });
      s.addFeelings(id, [{ whose: "self", core: f.core, emotion: f.word, ...(f.strength === undefined ? {} : { strength: f.strength }) }]);
      const p: MemoryPhysics = { ...s.physicsOf(id), birthDay: 0, returnDays: 1, firstReturnDay: 3, lastReturnDay: 3 };
      const ctx = coreContextFor(s, { id, kind: "self", about: "us" }, 3);
      const old = promotionEligibility(p, { ...ctx, stronglyFelt: false });
      const now = promotionEligibility(p, ctx);
      if (old.fast.met) before += 1;
      if (now.fast.met) after += 1;
      expect(now.fast.met || !old.fast.met).toBe(true);
    }
    expect(before).toBe(2);
    expect(after).toBe(4);
  });
});
