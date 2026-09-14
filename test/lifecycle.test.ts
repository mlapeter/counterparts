/**
 * THE LIFECYCLE — one memory, born in a session, used on later days, promoted
 * to identity, and rendered in a wake — proved THROUGH THE ADAPTER, not through
 * `Counterpart.resolveUse` called by hand.
 *
 * Why this file exists (IMPROVEMENTS U10, 2026-09-14): the core-level arc in
 * `counterpart.test.ts` credited by calling `resolveUse` directly, and passed
 * for ten days while no adapter ever made that call. On the owner's live store
 * every memory minted since launch sat at `uses = 0`, `reinforced_days = 0`,
 * so nothing new could reach the semantic or identity bands. A test of the
 * wiring has to drive the hooks a host drives, with the turns a host sees.
 *
 * The credit rule under test (recall CONTRACT §9.2, owner ruling 2026-09-14):
 * credited when EXPANDED through recall or QUOTED at content level; never for
 * being named in prose, surfaced, footnoted, or rendered in a wake. The two
 * fixtures the rule was written against are here: five ids cited and none
 * read (zero credit), and a memory expanded and then argued with (credited —
 * contradiction is engagement).
 *
 * Hermetic: a fresh temp data dir per test, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, RECALL_CREDIT_EVENT } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import {
  MEMORY_ID,
  QUOTE_WINDOW_WORDS,
  quotesWindow,
  resolveReferences,
} from "../src/core/recall/reference.js";
import { RENDERED_PREFIX } from "../src/core/self/index.js";
import { ClaudeCodeAdapter, openAdapter, parseTranscript } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/index.js";
import type { SpawnPlan } from "../src/adapters/claude-code/spawn.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const BUDGET_BYTES = 9000;

let dir: string;
let priorEnv: string | undefined;
const open: Counterpart[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-lifecycle-"));
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

function adapter(): ClaudeCodeAdapter {
  const a = openAdapter(
    { dataDir: dir, injectionBudgetBytes: BUDGET_BYTES, owner: true },
    { command: "/bin/true", args: ["runner"], spawner: (_p: SpawnPlan) => ({ pid: 4242 }) },
  );
  open.push(a.counterpart);
  return a;
}

/** A store with a life in it, so rarity-weighted recall has something to weigh. */
function seed(c: Counterpart): void {
  for (const body of [
    "The garage door opener needs a new battery soon.",
    "Rebasing keeps the history readable for reviewers.",
    "The library closes early on Sundays now.",
    "The kitchen tap drips when the pressure is high.",
    "The bus route changed and adds ten minutes.",
    "Planted three tomato seedlings in the planter.",
  ]) {
    c.store.put({
      type: "memory",
      kind: "fact",
      body,
      salience: { novelty: null, relevance: 0.6, emotional: 0.5, predictive: 0.5 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
  }
}

const BODY =
  "The storage split keeps canonical prose in markdown files, operational state in one small database, and a rebuildable cache that nobody backs up.";

const TURNS = [
  { role: "user" as const, text: "We settled the storage split today: canonical prose on disk, one small operational database, and a cache nobody backs up." },
  { role: "assistant" as const, text: "Recorded. The cache being rebuildable is what makes the backup set small enough to be honest about." },
  { role: "user" as const, text: "Right — a backup you cannot verify is a backup you do not have, and that is the whole reason for the split." },
];

function input(over: Partial<HookInput> = {}): HookInput {
  return { sessionId: "s1", scope: "proj", turns: TURNS, at: "2026-01-01", ...over };
}

async function mint(a: ClaudeCodeAdapter, session = "s0"): Promise<string> {
  const c = a.counterpart;
  a.stop(input({ sessionId: session, at: "2026-01-01" }));
  const deposit = await c.submitSessionEnd(
    {
      content: BODY,
      kind: "self",
      title: "storage split",
      claimed: 0.9,
      salience: { relevance: 0.9, emotional: 0.6, predictive: 0.8 },
    },
    { session, scope: "proj" },
  );
  expect(deposit.deposited).toBe(true);
  return deposit.memoryId as string;
}

function creditRows(c: Counterpart): { reason: string; credited: number; expanded: number; quoted: number; ids: string[] }[] {
  return c.store.eventLog({ name: RECALL_CREDIT_EVENT }).map((r) => {
    const p = JSON.parse(r.payload ?? "{}") as Record<string, unknown>;
    return {
      reason: String(p["reason"]),
      credited: Number(p["credited"] ?? 0),
      expanded: Number(p["expanded"] ?? 0),
      quoted: Number(p["quoted"] ?? 0),
      ids: Array.isArray(p["ids"]) ? (p["ids"] as string[]) : [],
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// The lifecycle, through the hooks
// ═══════════════════════════════════════════════════════════════════════════

describe("the lifecycle, through the adapter", () => {
  test("born day N, expanded by recall on later days, identity on the first consolidate after three, and the wake carries it", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    expect(c.store.physicsOf(id).uses).toBe(0);
    expect(c.store.physicsOf(id).reinforcedDays).toBe(0);

    // Later days. Each: the lived day turns, a session's Stop carries an
    // assistant turn that EXPANDED the memory by id and then argued with it,
    // and the cycle runs. Nothing here calls `resolveUse`. The consolidate
    // phase (where the identity crossing is decided) runs on its own cadence
    // (`sleep/tunables.ts#CONSOLIDATION_EVERY_DAYS`), so the crossing lands on
    // the first consolidate AFTER the third distinct reinforced day.
    expect(PHYSICS.N_PROMOTION_DAYS).toBe(3);
    let promotedOn: number | null = null;
    let day = 1;
    for (; day <= 7 && promotedOn === null; day++) {
      const date = `2026-01-0${day + 1}`;
      c.store.advanceClock(date);
      a.stop(
        input({
          sessionId: `s${day}`,
          at: date,
          turns: [
            ...TURNS,
            {
              role: "assistant",
              text: "I looked that memory up and I think it is wrong: the cache should be in the backup set too, because a rebuild is not free.",
            },
          ],
          // The recall call sat between turns[2] and turns[3]: atTurn is the
          // index of the NEXT conversational turn.
          expansions: [{ atTurn: 3, ids: [id] }],
        }),
      );
      expect(c.store.physicsOf(id).reinforcedDays).toBe(day);
      const report = await c.sessionEnd({ date, at: date });
      const consolidate = report.cycle.phases.find((p) => p.phase === "consolidate");
      if (c.store.physicsOf(id).promotedIdentity) {
        promotedOn = day;
        expect(consolidate?.status).toBe("ran");
      }
    }

    // Promoted on the first consolidate after three distinct reinforced days,
    // and never before them.
    expect(promotedOn).not.toBe(null);
    expect(promotedOn as number).toBeGreaterThanOrEqual(PHYSICS.N_PROMOTION_DAYS);
    const physics = c.store.physicsOf(id);
    expect(physics.reinforcedDays).toBe(promotedOn as number);
    expect(physics.uses).toBe(promotedOn as number);
    expect(physics.promotedIdentity).toBe(true);
    expect(c.store.row(id)?.band).toBe("identity");

    // The rows a later reader looks at: one per boundary, reason `credited`.
    const rows = creditRows(c).filter((r) => r.reason === "credited");
    expect(rows.length).toBe(promotedOn as number);
    for (const r of rows) {
      expect(r.expanded).toBe(1);
      expect(r.credited).toBe(1);
      expect(r.ids).toEqual([id]);
    }

    // And the next wake carries it, in "Who I am".
    const next = `2026-01-0${day + 1}`;
    c.store.advanceClock(next);
    await c.sessionEnd({ date: next, at: next });
    const woke = c.wake(BUDGET_BYTES);
    expect(woke.ok).toBe(true);
    expect(woke.text).toContain("Who I am:");
    expect(woke.text).toContain("rebuildable cache that nobody backs up");
  });

  test("FIXTURE: five ids cited in prose and none read credit nothing (2026-09-14)", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    c.store.advanceClock("2026-01-02");
    const named = `Recall footnoted five earlier instances of you asking this: [${id}], [mem_4fdb822e20330371], [mem_1ff581741dc2ecdf], [mem_97edc704ab9bfa42], [mem_12cf33cdfc7dc3b6].`;
    a.stop(
      input({
        sessionId: "s1",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: named }],
        // No recall call. The ids are prose, and prose is not evidence.
      }),
    );
    expect(c.store.physicsOf(id).uses).toBe(0);
    expect(c.store.physicsOf(id).reinforcedDays).toBe(0);
    const rows = creditRows(c);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.at(-1)?.credited).toBe(0);
    expect(rows.at(-1)?.reason).toBe("no-candidates");
  });

  test("FIXTURE: expanded and then contradicted still credits — contradiction is engagement", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    c.store.advanceClock("2026-01-02");
    a.stop(
      input({
        sessionId: "s1",
        at: "2026-01-02",
        turns: [
          ...TURNS,
          {
            role: "assistant",
            text: "No. That memory is mistaken and I am not going to act on it; the cache must be backed up.",
          },
        ],
        expansions: [{ atTurn: 3, ids: [id] }],
      }),
    );
    expect(c.store.physicsOf(id).uses).toBe(1);
    expect(c.store.physicsOf(id).reinforcedDays).toBe(1);
    expect(creditRows(c).at(-1)?.reason).toBe("credited");
  });

  test("a well-shaped id that names nothing is a refusal, not a failed boundary", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    c.store.advanceClock("2026-01-02");
    a.stop(
      input({
        sessionId: "s1",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "Looked both up; one of them no longer exists." }],
        // A typo'd id beside a real one, in the same call.
        expansions: [{ atTurn: 3, ids: ["mem_000000000000", id] }],
      }),
    );
    const row = creditRows(c).at(-1);
    expect(row?.reason).toBe("credited");
    expect(row?.ids).toEqual([id]);
    expect(c.store.physicsOf(id).uses).toBe(1);
    const payload = JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as {
      refused?: Record<string, number>;
    };
    expect(payload.refused?.["unknown-id"]).toBe(1);
  });

  test("a wake does not reinforce what it renders", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    c.store.advanceClock("2026-01-02");
    await c.sessionEnd({ date: "2026-01-02", at: "2026-01-02" });
    const woke = a.sessionStart(input({ sessionId: "s9", at: "2026-01-03" }));
    expect(woke.ok).toBe(true);
    expect(woke.injection).toContain("storage split");
    a.userPromptSubmit(input({ sessionId: "s9", at: "2026-01-03", prompt: "hello", sentinelSeen: woke.sentinel }));
    expect(c.store.physicsOf(id).uses).toBe(0);
    expect(c.store.physicsOf(id).reinforcedDays).toBe(0);
  });

  test("credit reads the NEW slice only: an expansion the previous Stop already judged is not judged twice", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const first = await mint(a, "s0");
    const second = await c.submitSessionEnd(
      {
        content: "Backups cover canonical prose and the operational database, and deliberately skip the cache because it rebuilds.",
        kind: "fact",
        claimed: 0.8,
      },
      { session: "s0", scope: "proj" },
    );
    const other = second.memoryId as string;
    c.store.advanceClock("2026-01-02");

    const head = [...TURNS, { role: "assistant" as const, text: "Looked it up; noted." }];
    a.stop(input({ sessionId: "s1", at: "2026-01-02", turns: head, expansions: [{ atTurn: 3, ids: [first] }] }));
    const after1 = creditRows(c).at(-1);
    expect(after1?.expanded).toBe(1);
    expect(after1?.ids).toEqual([first]);

    // The transcript grew; the host hands the WHOLE thing back, expansions
    // included. Only the new call counts.
    const tail = [
      ...head,
      { role: "user" as const, text: "And the other one?" },
      { role: "assistant" as const, text: "Also looked up. Different memory, same session." },
    ];
    a.stop(
      input({
        sessionId: "s1",
        at: "2026-01-02",
        turns: tail,
        expansions: [
          { atTurn: 3, ids: [first] },
          { atTurn: 5, ids: [other] },
        ],
      }),
    );
    const after2 = creditRows(c).at(-1);
    expect(after2?.expanded).toBe(1);
    expect(after2?.ids).toEqual([other]);
    expect(c.store.physicsOf(first).uses).toBe(1);
    expect(c.store.physicsOf(other).uses).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The quoted door, against what the session actually SAW
// ═══════════════════════════════════════════════════════════════════════════

describe("the quoted door", () => {
  test("a loud-surfaced memory quoted at content level credits; a footnoted one quoted by title does not", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const loud = await mint(a, "s0");
    const foot = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Rebasing before review keeps the history readable, and reviewers thank you for it every single time.",
      title: "Rebasing before review keeps the history readable",
      salience: { novelty: null, relevance: 0.7, emotional: 0.3, predictive: 0.5 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    c.store.advanceClock("2026-01-02");
    const day = c.store.livedDay();
    // A real turn opens the session's gate state; then what the session was
    // SHOWN is written directly — one loud, one footnoted — so the fixture
    // does not depend on ranking.
    a.userPromptSubmit(input({ sessionId: "s1", at: "2026-01-02", prompt: "how does the storage split work" }));
    c.store.setGateRecords([
      { sessionId: "s1", kind: "surfaced", ref: loud, turn: 1, lastDay: day, tier: "surfaced", trains: true },
      { sessionId: "s1", kind: "surfaced", ref: foot, turn: 1, lastDay: day, tier: "footnoted", trains: false },
    ]);

    const summary = c.creditReferences("s1", {
      assistantTurns: [
        // Eight-plus consecutive words of the loud body, verbatim.
        "As I said before, the storage split keeps canonical prose in markdown files, operational state in one small database — that is the whole design.",
        // The footnoted one's TITLE, which is all the session ever saw of it.
        "Also: rebasing before review keeps the history readable, as the footnote says.",
      ],
      expansions: [],
    });
    expect(summary.reason).toBe("credited");
    expect(summary.quoted).toBe(1);
    expect(summary.expanded).toBe(0);
    expect(summary.ids).toEqual([loud]);
    expect(c.store.physicsOf(loud).uses).toBeGreaterThan(0);
    expect(c.store.physicsOf(foot).uses).toBe(0);
  });

  test("a paraphrase is a miss, by design (precision over recall)", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const loud = await mint(a, "s0");
    c.store.advanceClock("2026-01-02");
    a.userPromptSubmit(input({ sessionId: "s1", at: "2026-01-02", prompt: "how does the storage split work" }));
    c.store.setGateRecords([
      { sessionId: "s1", kind: "surfaced", ref: loud, turn: 1, lastDay: c.store.livedDay(), tier: "surfaced", trains: true },
    ]);
    const summary = c.creditReferences("s1", {
      assistantTurns: ["Prose lives in markdown, state in a small db, and the cache is disposable."],
      expansions: [],
    });
    expect(summary.reason).toBe("nothing-to-credit");
    expect(summary.considered).toBe(1);
    expect(summary.credited).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The resolver itself
// ═══════════════════════════════════════════════════════════════════════════

describe("reference resolution (pure)", () => {
  test("expansions are exact addresses: ids credit once each, a non-id handle is counted and credits nothing", () => {
    const r = resolveReferences({
      assistantTurns: [],
      expansions: ["mem_aaaaaaaaaaaa", "mem_aaaaaaaaaaaa", "the storage split", "mem_bbbbbbbbbbbbbbbb", "MEM_CCCCCCCCCCCC"],
      candidates: [],
    });
    expect(r.uses.map((u) => u.memoryId)).toEqual(["mem_aaaaaaaaaaaa", "mem_bbbbbbbbbbbbbbbb"]);
    expect(r.expanded).toBe(2);
    expect(r.unresolvedHandles).toBe(2);
    expect(MEMORY_ID.test("mem_ffffffffffff")).toBe(true);
    expect(MEMORY_ID.test("mem_ffff")).toBe(false);
  });

  test("the quote window is exactly N normalized words, punctuation and case aside", () => {
    const body = "one two three four five six seven eight nine ten";
    expect(QUOTE_WINDOW_WORDS).toBe(8);
    expect(quotesWindow(body, "ONE, two; three four — five six seven EIGHT!")).toBe(true);
    expect(quotesWindow(body, "two three four five six seven eight")).toBe(false);
    expect(quotesWindow(body, "eight nine ten one two three four five")).toBe(false);
    expect(quotesWindow("short body", "short body")).toBe(false);
  });

  test("only what surfaced LOUD is quotable; a footnoted body quoted verbatim still credits nothing", () => {
    const body = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const r = resolveReferences({
      assistantTurns: [body],
      expansions: [],
      candidates: [
        { id: "mem_111111111111", tier: "footnoted", body },
        { id: "mem_222222222222", tier: "surfaced", body },
      ],
    });
    expect(r.uses).toEqual([{ memoryId: "mem_222222222222", how: "quoted" }]);
    expect(r.considered).toBe(2);
  });

  test("an expanded memory is not credited a second time by quoting it", () => {
    const body = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const r = resolveReferences({
      assistantTurns: [body],
      expansions: ["mem_222222222222"],
      candidates: [{ id: "mem_222222222222", tier: "surfaced", body }],
    });
    expect(r.uses.length).toBe(1);
    expect(r.expanded).toBe(1);
    expect(r.quoted).toBe(0);
  });

  test("a quote split across two assistant turns is not a quote", () => {
    const body = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const r = resolveReferences({
      assistantTurns: ["alpha beta gamma delta", "epsilon zeta eta theta"],
      expansions: [],
      candidates: [{ id: "mem_222222222222", tier: "surfaced", body }],
    });
    expect(r.uses).toEqual([]);
  });

  test("past the deadline the resolver stops between candidates and SAYS so; what it decided stands", () => {
    const body = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    let t = 0;
    const r = resolveReferences({
      assistantTurns: [body],
      expansions: ["mem_000000000000"],
      candidates: [
        { id: "mem_111111111111", tier: "surfaced", body },
        { id: "mem_222222222222", tier: "surfaced", body },
        { id: "mem_333333333333", tier: "footnoted", body },
      ],
      deadline: 1,
      now: () => (t += 1),
    });
    expect(r.budgetExceeded).toBe(true);
    expect(r.expanded).toBe(1);
    expect(r.considered).toBe(1);
    expect(r.quoted).toBe(1);
    // Only LOUD candidates count as skipped: a footnoted one was never quotable.
    expect(r.skippedForBudget).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The host's transcript: a recall call is evidence, and never a turn
// ═══════════════════════════════════════════════════════════════════════════

describe("expansions in the transcript", () => {
  const line = (role: "user" | "assistant", content: unknown): string =>
    JSON.stringify({ type: role, message: { role, content } });

  test("recall tool calls become expansions positioned against the turn list, which does not grow", () => {
    const raw = [
      line("user", "How does the storage split work?"),
      line("assistant", [
        { type: "text", text: "Let me look." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "mcp__counterparts__recall",
          input: { ids: ["mem_aaaaaaaaaaaa", "mem_bbbbbbbbbbbb"] },
        },
      ]),
      line("user", [{ type: "tool_result", tool_use_id: "toolu_1", content: "…bodies…" }]),
      line("assistant", [
        { type: "tool_use", id: "toolu_2", name: "mcp__counterparts__recall", input: { handle: "mem_cccccccccccc" } },
        { type: "tool_use", id: "toolu_3", name: "mcp__counterparts__recall", input: { question: "what did we decide?" } },
        { type: "tool_use", id: "toolu_4", name: "ToolSearch", input: { query: "select:recall" } },
        { type: "text", text: "Here is what I found." },
      ]),
    ].join("\n");
    const read = parseTranscript(raw);
    expect(read.turns.map((t) => t.text)).toEqual(["How does the storage split work?", "Let me look.", "Here is what I found."]);
    expect(read.expansions).toEqual([
      { atTurn: 2, ids: ["mem_aaaaaaaaaaaa", "mem_bbbbbbbbbbbb"] },
      { atTurn: 2, ids: ["mem_cccccccccccc"] },
    ]);
  });

  test("a user-role block never carries an expansion, and a transcript with none reads as empty", () => {
    const raw = [
      line("user", [{ type: "tool_use", id: "x", name: "mcp__counterparts__recall", input: { ids: ["mem_aaaaaaaaaaaa"] } }]),
      line("assistant", "Plain reply."),
    ].join("\n");
    const read = parseTranscript(raw);
    expect(read.expansions).toEqual([]);
    expect(read.turns.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Identity rotates; it does not rank
// ═══════════════════════════════════════════════════════════════════════════

describe("the identity lane rotates", () => {
  const IDENTITY_BODIES = Array.from({ length: 8 }, (_, i) =>
    `Identity belief number ${i + 1}: ${"I hold this about myself and it has been true across every session I can remember, said at length so that it costs real bytes. ".repeat(3)}`,
  );

  test("over successive boundaries every identity element renders before any renders twice", async () => {
    const c = Counterpart.open({ dir, owner: true });
    open.push(c);
    const ids = IDENTITY_BODIES.map((body, i) =>
      c.store.put({
        type: "memory",
        kind: "self",
        body,
        band: "identity",
        // The tie the live store had: identical claimed salience, so strength
        // clamps to the same value for all eight.
        salience: { novelty: null, relevance: 0.95, emotional: 0.5, predictive: 0.5, claimed: 0.95 },
        physics: { birthDay: i, lastUsedDay: i, promotedIdentity: true, consolidated: true },
        learnedOn: "2026-01-01",
      }),
    );
    // A budget that fits roughly three of the eight.
    const budget = 2400;
    const seen = new Set<string>();
    const stamped = (): Map<string, number> =>
      new Map([...c.store.metaWithPrefix(RENDERED_PREFIX)].map(([k, v]) => [k.slice(RENDERED_PREFIX.length), Number(v)]));

    for (const [i, date] of ["2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"].entries()) {
      c.store.advanceClock(date);
      await c.sessionEnd({ date, at: date, budgetBytes: budget });
      const day = c.store.livedDay();
      const today = [...stamped()].filter(([, d]) => d === day).map(([id]) => id);
      expect(today.length).toBeGreaterThan(0);
      expect(today.length).toBeLessThan(ids.length);
      for (const id of today) {
        // Nobody renders a second time until everybody has rendered once.
        if (seen.size < ids.length) expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      const woke = c.wake(budget);
      expect(woke.ok).toBe(true);
      if (i === 3) expect(seen.size).toBe(ids.length);
    }
  });

  test("an element the budget trimmed is not stamped as rendered", async () => {
    const c = Counterpart.open({ dir, owner: true });
    open.push(c);
    for (const body of IDENTITY_BODIES) {
      c.store.put({
        type: "memory",
        kind: "self",
        body,
        band: "identity",
        salience: { novelty: null, relevance: 0.9, emotional: 0.5, predictive: 0.5, claimed: 0.9 },
        physics: { promotedIdentity: true },
        learnedOn: "2026-01-01",
      });
    }
    c.store.advanceClock("2026-01-02");
    await c.sessionEnd({ date: "2026-01-02", at: "2026-01-02", budgetBytes: 1200 });
    const stamped = c.store.metaWithPrefix(RENDERED_PREFIX).size;
    const rendered = (c.wake(1200).text.match(/^- /gm) ?? []).length;
    expect(stamped).toBe(rendered);
    expect(stamped).toBeGreaterThan(0);
    expect(stamped).toBeLessThan(IDENTITY_BODIES.length);
  });
});
