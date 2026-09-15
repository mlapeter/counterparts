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
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { recordSession } from "../src/adapters/sessions.js";
import { expansionsPath, handleKey, readHandleResolutions } from "../src/adapters/expansions.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import type { SpawnPlan } from "../src/adapters/claude-code/spawn.js";
import { chmodSync, writeFileSync } from "node:fs";

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
  const hook: HookInput = { sessionId: "s1", scope: "proj", turns: TURNS, at: "2026-01-01", ...over };
  // EVERY session in this file is one that started INSIDE the memory, so it has
  // the record `SessionStart` writes. Since the retroactive-capture guard (#92
  // review, F1) a boundary whose session has no record and a cursor still at 0
  // seals the stretch instead of capturing it — that is what a session which
  // lived under `off` looks like from the boundary's side, and it is not what
  // any arc here is about.
  recordSession(dir, { sessionId: hook.sessionId, scope: hook.scope, phase: "start" });
  return hook;
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
    const consolidateRanOn: number[] = [];
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
      if (consolidate?.status === "ran") consolidateRanOn.push(day);
      if (c.store.physicsOf(id).promotedIdentity) {
        promotedOn = day;
        expect(consolidate?.status).toBe("ran");
      }
    }

    // Promoted on EXACTLY the first consolidate at or after the third distinct
    // reinforced day — not a day earlier (insufficient days), not a day later
    // (the crossing is decided the first time the phase looks).
    expect(promotedOn).not.toBe(null);
    const firstEligibleConsolidate = consolidateRanOn.find((d) => d >= PHYSICS.N_PROMOTION_DAYS);
    expect(promotedOn).toBe(firstEligibleConsolidate as number);
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

  test("THE WHOLE WIRE: a host Stop payload whose transcript holds a recall tool_use credits, through toHookInput", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    c.store.advanceClock("2026-01-02");
    // The transcript as this host writes it: JSONL, one entry per message,
    // the assistant's recall call as a `tool_use` block in its content.
    const line = (role: "user" | "assistant", content: unknown): string =>
      JSON.stringify({ type: role, message: { role, content } });
    const transcript = join(dir, "transcript.jsonl");
    writeFileSync(
      transcript,
      [
        ...TURNS.map((t) => line(t.role, t.text)),
        line("assistant", [
          { type: "tool_use", id: "toolu_1", name: "mcp__counterparts__recall", input: { ids: [id] } },
        ]),
        line("user", [{ type: "tool_result", tool_use_id: "toolu_1", content: "…the body…" }]),
        line("assistant", "Read it. I still think the cache belongs in the backup set."),
      ].join("\n"),
    );
    const input = toHookInput({
      hook_event_name: "Stop",
      session_id: "s1",
      cwd: dir,
      transcript_path: transcript,
      stop_hook_active: false,
    });
    expect(input.turns?.length).toBe(4);
    expect(input.expansions).toEqual([{ atTurn: 3, ids: [id] }]);
    // This payload comes from the HOST rather than from the helper above, so
    // the record its SessionStart would have written is made here.
    recordSession(dir, { sessionId: input.sessionId, scope: input.scope, phase: "start" });
    a.stop({ ...input, at: "2026-01-02" });
    const row = creditRows(c).at(-1);
    expect(row?.reason).toBe("credited");
    expect(row?.credited).toBe(1);
    expect(c.store.physicsOf(id).uses).toBe(1);
    // The OQ4 probe's input rides on the same row: what was EXPANDED, whether
    // or not it was credited.
    const payload = JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as {
      expandedIds?: string[];
      expandedTotal?: number;
    };
    expect(payload.expandedIds).toEqual([id]);
    expect(payload.expandedTotal).toBe(1);
  });

  test("an archived memory expanded by a stale id is refused, not revived", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    c.store.archive(id, "test: merged away");
    c.store.advanceClock("2026-01-02");
    a.stop(
      input({
        sessionId: "s1",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "Looked it up." }],
        expansions: [{ atTurn: 3, ids: [id] }],
      }),
    );
    const payload = JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as {
      reason?: string;
      refused?: Record<string, number>;
    };
    expect(payload.reason).toBe("nothing-to-credit");
    expect(payload.refused?.["archived"]).toBe(1);
    expect(c.store.physicsOf(id).uses).toBe(0);
  });

  test("one use throwing mid-batch does not fail the boundary or drop the rest", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const first = await mint(a, "s0");
    const second = await c.submitSessionEnd(
      { content: "Backups cover canonical prose and the operational database, and deliberately skip the cache.", kind: "fact", claimed: 0.8 },
      { session: "s0", scope: "proj" },
    );
    const other = second.memoryId as string;
    const third = await c.submitSessionEnd(
      { content: "The span buffer holds lived experience until judgment can happen later, without the host waiting.", kind: "fact", claimed: 0.8 },
      { session: "s0", scope: "proj" },
    );
    const last = third.memoryId as string;
    c.store.advanceClock("2026-01-02");
    // The middle id passes the row filter and throws at physics: `reinforce`
    // faulted for exactly that id.
    const real = c.store.reinforce.bind(c.store);
    c.store.reinforce = ((mid: string, day: number, tier: "referenced" | "surfaced" | "footnoted") => {
      if (mid === other) throw new Error("REMOVED");
      return real(mid, day, tier);
    }) as typeof c.store.reinforce;
    a.stop(
      input({
        sessionId: "s1",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "Looked all three up." }],
        expansions: [{ atTurn: 3, ids: [first, other, last] }],
      }),
    );
    const payload = JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as {
      reason?: string;
      credited?: number;
      ids?: string[];
      refused?: Record<string, number>;
    };
    expect(payload.reason).toBe("credited");
    expect(payload.credited).toBe(2);
    expect(payload.ids).toEqual([first, last]);
    expect(Object.values(payload.refused ?? {}).reduce((n, v) => n + v, 0)).toBe(1);
    expect(c.store.physicsOf(last).uses).toBe(1);
  });

  test("RULING R2: one session spanning three lived days, expanding the same memory each day, credits each day", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    // ONE session id across three days — how the owner actually works. Before
    // the ruling the gate's never-downgrade check was keyed to the session
    // alone, so this credited once ever.
    let turns = [...TURNS];
    for (const [i, date] of ["2026-01-02", "2026-01-03", "2026-01-04"].entries()) {
      c.store.advanceClock(date);
      turns = [
        ...turns,
        { role: "user" as const, text: `Day ${i + 1}: remind me how the storage split works.` },
        { role: "assistant" as const, text: `Day ${i + 1}: looked it up again; still the split, still no cache in the backups.` },
      ];
      a.stop(input({ sessionId: "s-long", at: date, turns, expansions: [{ atTurn: turns.length - 1, ids: [id] }] }));
      expect(c.store.physicsOf(id).uses).toBe(i + 1);
      expect(c.store.physicsOf(id).reinforcedDays).toBe(i + 1);
      await c.sessionEnd({ date, at: date });
    }
    // And within ONE day the same memory still credits once.
    turns = [...turns, { role: "user" as const, text: "Once more?" }, { role: "assistant" as const, text: "Once more, same day." }];
    a.stop(input({ sessionId: "s-long", at: "2026-01-04", turns, expansions: [{ atTurn: turns.length - 1, ids: [id] }] }));
    expect(c.store.physicsOf(id).uses).toBe(3);
    const payload = JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as {
      refused?: Record<string, number>;
    };
    expect(payload.refused?.["already-credited-at-or-above"]).toBe(1);
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
// The handle door (LAUNCH-STATUS G50) — an expansion BY TITLE earns credit
//
// The gap: `reference.ts` credits literal `mem_…` addresses out of the recall
// tool call's input and resolves nothing, but the tool accepts an exact TITLE
// and answers it with the whole body. So the most deliberate act available to a
// session — name a memory and read it — credited nothing and left the boundary
// row saying `expanded: 0, unresolvedHandles: 1`.
//
// The fix is on the TOOL side: the server records what the handle resolved to
// (`adapters/expansions.ts`), and the hook translates the transcript's own
// handle with it. The transcript still decides WHICH handle and WHEN, so these
// tests are as much about what must NOT be credited — a handle nobody resolved,
// and a handle the tool refused to choose between — as about what must.
//
// What the transcript CANNOT decide is whose answer resolved the handle, and
// that is not covered here: see "the handle door, across projects (G50 review)"
// below for the three askings that get no answer at all and would otherwise read
// somebody else's.
// ═══════════════════════════════════════════════════════════════════════════

describe("the handle door (G50)", () => {
  /** The MCP tool over the SAME counterpart the hooks drive — one store, two
   *  adapters, which is the shape the live host runs. */
  function tool(a: ClaudeCodeAdapter): McpServer {
    return new McpServer({ counterpart: a.counterpart, scope: "proj", owner: true, registryDir: dir });
  }

  function creditPayload(c: Counterpart): Record<string, unknown> {
    return JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as Record<
      string,
      unknown
    >;
  }

  test("a recall BY TITLE, then a boundary: the resolved id is credited and named in expandedIds", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    c.store.advanceClock("2026-01-02");

    // The session expands by title. The tool answers with the body — and, now,
    // records what the title reached.
    const answered = (await tool(a).call("recall", { handle: "storage split" })).structuredContent;
    expect(answered["reason"]).toBe("expanded");
    expect(readHandleResolutions(dir).get(handleKey("storage split"))).toBe(id);

    // The transcript carries the TITLE, exactly as the host wrote it.
    a.stop(
      input({
        sessionId: "s1",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "Read it in full before answering." }],
        expansions: [{ atTurn: 3, ids: ["storage split"] }],
      }),
    );

    const row = creditRows(c).at(-1);
    expect(row?.reason).toBe("credited");
    expect(row?.expanded).toBe(1);
    expect(row?.credited).toBe(1);
    expect(row?.ids).toEqual([id]);
    const p = creditPayload(c);
    expect(p["expandedIds"]).toEqual([id]);
    expect(p["unresolvedHandles"]).toBe(0);
    expect(p["resolvedHandles"]).toBe(1);
    expect(c.store.physicsOf(id).uses).toBe(1);
    expect(c.store.physicsOf(id).reinforcedDays).toBe(1);
  });

  test("a handle nobody resolved credits nothing and still counts unresolvedHandles", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    const id = await mint(a);
    c.store.advanceClock("2026-01-02");

    const refused = (await tool(a).call("recall", { handle: "a title no memory has" })).structuredContent;
    expect(refused["reason"]).toBe("handle-unknown");
    // A refusal resolved nothing, so what it leaves behind is a SHADOW: an
    // entry that translates nothing and overrides any earlier resolution.
    expect(readHandleResolutions(dir).get(handleKey("a title no memory has"))).toBeNull();

    a.stop(
      input({
        sessionId: "s1",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "Nothing came back under that name." }],
        expansions: [{ atTurn: 3, ids: ["a title no memory has"] }],
      }),
    );

    // The row is still written — silence never masquerades as health. Nothing
    // surfaced loud in this slice and the handle credited nothing, so the
    // boundary has no candidates at all to report on.
    const row = creditRows(c).at(-1);
    expect(row?.reason).toBe("no-candidates");
    expect(row?.credited).toBe(0);
    expect(row?.expanded).toBe(0);
    const p = creditPayload(c);
    expect(p["unresolvedHandles"]).toBe(1);
    expect(p["resolvedHandles"]).toBe(0);
    expect(p["expandedIds"]).toEqual([]);
    expect(c.store.physicsOf(id).uses).toBe(0);
  });

  test("a REFUSAL shadows an earlier resolution: a session shown nothing credits nothing", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    // Confidential, so a session that is not the owner's is told it exists and
    // shown nothing (`handle-confidential-withheld`).
    const id = c.store.put({
      type: "memory",
      kind: "person",
      title: "the clinic note",
      body: "The clinic appointment about the recurring migraines is on the fourteenth.",
      salience: { novelty: null, relevance: 0.7, emotional: 0.5, predictive: 0.5 },
      physics: { birthDay: 0, lastUsedDay: 0 },
      meta: { confidential: true },
    });
    c.store.advanceClock("2026-01-02");

    // The owner's own session resolves the title — and leaves a translation.
    expect(
      ((await tool(a).call("recall", { handle: "the clinic note" })).structuredContent)["reason"],
    ).toBe("expanded");
    expect(readHandleResolutions(dir).get(handleKey("the clinic note"))).toBe(id);

    // A DIFFERENT session, not the owner's, asks the same title an hour later.
    const stranger = new McpServer({
      counterpart: c,
      scope: "proj",
      owner: false,
      registryDir: dir,
    });
    const withheld = (await stranger.call("recall", { handle: "the clinic note" })).structuredContent;
    expect(withheld["reason"]).toBe("handle-confidential-withheld");

    // Its boundary must not inherit the owner's resolution. It read nothing.
    a.stop(
      input({
        sessionId: "s-stranger",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "That one is not mine to read." }],
        expansions: [{ atTurn: 3, ids: ["the clinic note"] }],
      }),
    );
    const p = creditPayload(c);
    expect(p["credited"]).toBe(0);
    expect(p["resolvedHandles"]).toBe(0);
    expect(p["unresolvedHandles"]).toBe(1);
    expect(c.store.physicsOf(id).uses).toBe(0);
  });

  test("an AMBIGUOUS handle chose nothing, so it translates nothing", async () => {
    const a = adapter();
    const c = a.counterpart;
    seed(c);
    // Two memories, one title. `expandHandle` names the choice without making
    // it — and a choice nobody made may not become a credit.
    for (const body of [
      "The first note about the twins, which says one thing.",
      "The second note about the twins, which says another.",
    ]) {
      c.store.put({
        type: "memory",
        kind: "fact",
        title: "the twins",
        body,
        salience: { novelty: null, relevance: 0.6, emotional: 0.5, predictive: 0.5 },
        physics: { birthDay: 0, lastUsedDay: 0 },
      });
    }
    c.store.advanceClock("2026-01-02");

    const answered = (await tool(a).call("recall", { handle: "the twins" })).structuredContent;
    expect(answered["reason"]).toBe("handle-ambiguous");
    expect(readHandleResolutions(dir).get(handleKey("the twins"))).toBeNull();

    a.stop(
      input({
        sessionId: "s1",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "Two memories answer to that name." }],
        expansions: [{ atTurn: 3, ids: ["the twins"] }],
      }),
    );
    const p = creditPayload(c);
    expect(p["credited"]).toBe(0);
    expect(p["unresolvedHandles"]).toBe(1);
    expect(p["resolvedHandles"]).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The handle door, ACROSS PROJECTS (review of #112, 2026-09-15)
//
// The shadow alone is not the confidentiality boundary the first two commits
// claimed it was. The log is keyed by the handle and records the LAST answer
// anyone got, so a session that never received an answer at all still reads
// someone else's. Three routes to that, and none of them leaves a shadow:
//
//   A1  the call never reached `expandHandle` — the server was down, or threw
//       before the resolver ran. Nothing is refused, so nothing is recorded.
//   A2  the call was `recall { handle, question }` — `both-arguments`, path
//       `none`, refused by the dispatcher before the handle path exists.
//   A3  the call WAS refused `handle-confidential-withheld`, and the shadow
//       could not be written (a read-only log, a full disk).
//
// In all three the transcript still carries the title, so the boundary still
// translates it — through the only line in the log, which is the owner's.
//
// The fix that covers all three at once is the scope filter: a resolution
// recorded by a server serving ANOTHER project cannot translate this project's
// handle. It also removes the opposite race the builder accepted — a stranger's
// refusal costing the owner the credit — because the stranger's shadow now
// carries the stranger's scope (the fourth test).
// ═══════════════════════════════════════════════════════════════════════════

describe("the handle door, across projects (G50 review)", () => {
  /** Another project entirely. `canonicalScope` resolves both against this
   *  process's cwd, so the two are different absolute directories. */
  const OTHER = "other-proj";

  function tool(a: ClaudeCodeAdapter, scope = "proj", owner = true): McpServer {
    return new McpServer({ counterpart: a.counterpart, scope, owner, registryDir: dir });
  }

  function creditPayload(c: Counterpart): Record<string, unknown> {
    return JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as Record<
      string,
      unknown
    >;
  }

  /** The fixture: a confidential memory with an exact title, and the owner's
   *  own resolution of it sitting in the log. */
  async function ownerResolved(a: ClaudeCodeAdapter): Promise<string> {
    const c = a.counterpart;
    seed(c);
    const id = c.store.put({
      type: "memory",
      kind: "person",
      title: "the clinic note",
      body: "The clinic appointment about the recurring migraines is on the fourteenth.",
      salience: { novelty: null, relevance: 0.7, emotional: 0.5, predictive: 0.5 },
      physics: { birthDay: 0, lastUsedDay: 0 },
      meta: { confidential: true },
    });
    c.store.advanceClock("2026-01-02");
    const answered = (await tool(a).call("recall", { handle: "the clinic note" })).structuredContent;
    expect(answered["reason"]).toBe("expanded");
    expect(readHandleResolutions(dir).get(handleKey("the clinic note"))).toBe(id);
    return id;
  }

  /** The other project's Stop, carrying the title the model typed. */
  function strangerStop(a: ClaudeCodeAdapter): void {
    a.stop(
      input({
        sessionId: "s-elsewhere",
        scope: OTHER,
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "That one did not come back to me." }],
        expansions: [{ atTurn: 3, ids: ["the clinic note"] }],
      }),
    );
  }

  test("A1: a call that never reached the resolver credits nothing across projects", async () => {
    const a = adapter();
    const id = await ownerResolved(a);
    // The other project's session types the title; its tool call dies before
    // `expandHandle`. NOTHING is written — not even a shadow.
    expect(readHandleResolutions(dir).size).toBe(1);

    strangerStop(a);

    const p = creditPayload(a.counterpart);
    expect(p["credited"]).toBe(0);
    expect(p["resolvedHandles"]).toBe(0);
    expect(p["unresolvedHandles"]).toBe(1);
    expect(a.counterpart.store.physicsOf(id).uses).toBe(0);
  });

  test("A2: `handle` and `question` together never reach the handle path, and credit nothing", async () => {
    const a = adapter();
    const id = await ownerResolved(a);

    const confused = (
      await tool(a, OTHER, false).call("recall", {
        handle: "the clinic note",
        question: "when is that appointment",
      })
    ).structuredContent;
    expect(confused["path"]).toBe("none");
    expect(confused["reason"]).toBe("both-arguments");
    // A refusal by the DISPATCHER leaves no shadow: the handle path never ran.
    expect(readHandleResolutions(dir).get(handleKey("the clinic note"))).toBe(id);

    strangerStop(a);

    const p = creditPayload(a.counterpart);
    expect(p["credited"]).toBe(0);
    expect(p["resolvedHandles"]).toBe(0);
    expect(a.counterpart.store.physicsOf(id).uses).toBe(0);
  });

  test("A3: a refusal whose shadow could not be written credits nothing across projects", async () => {
    const a = adapter();
    const id = await ownerResolved(a);

    // The log is read-only when the refusal lands, so the shadow is lost —
    // `recordHandleResolution` returns false rather than throwing, exactly as
    // its contract says, and the tool answers as it always would.
    chmodSync(expansionsPath(dir), 0o400);
    const withheld = (await tool(a, OTHER, false).call("recall", { handle: "the clinic note" }))
      .structuredContent;
    expect(withheld["reason"]).toBe("handle-confidential-withheld");
    // Restored BEFORE the boundary: an unreadable log would credit nothing for
    // the wrong reason, and prove nothing about the filter.
    chmodSync(expansionsPath(dir), 0o600);
    // This is the line that would leak — the owner's, still standing alone.
    expect(readHandleResolutions(dir).get(handleKey("the clinic note"))).toBe(id);

    strangerStop(a);

    const p = creditPayload(a.counterpart);
    expect(p["credited"]).toBe(0);
    expect(p["resolvedHandles"]).toBe(0);
    expect(a.counterpart.store.physicsOf(id).uses).toBe(0);
  });

  test("a refusal in ANOTHER project no longer costs the owner the credit", async () => {
    const a = adapter();
    const c = a.counterpart;
    const id = await ownerResolved(a);

    // The stranger IS refused, and its shadow IS written — under ITS scope.
    const withheld = (await tool(a, OTHER, false).call("recall", { handle: "the clinic note" }))
      .structuredContent;
    expect(withheld["reason"]).toBe("handle-confidential-withheld");
    // Read unfiltered, the shadow is the newest answer and hides the owner's id.
    expect(readHandleResolutions(dir).get(handleKey("the clinic note"))).toBeNull();

    // The owner's own boundary, in the owner's own project, still credits: the
    // shadow belongs to a project this session is not in.
    a.stop(
      input({
        sessionId: "s-owner",
        scope: "proj",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "Read it in full before answering." }],
        expansions: [{ atTurn: 3, ids: ["the clinic note"] }],
      }),
    );

    const p = creditPayload(c);
    expect(p["credited"]).toBe(1);
    expect(p["resolvedHandles"]).toBe(1);
    expect(p["unresolvedHandles"]).toBe(0);
    expect(c.store.physicsOf(id).uses).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The handle door, BEFORE THIS SESSION STARTED (review of #112, 2026-09-15)
//
// The scope filter leaves one table per project directory, and a project is a
// place, not a conversation: the owner works in it on Monday and again on
// Tuesday, and two sessions can run in it at once. So the second half of the
// same repair is temporal — a resolution recorded before this session existed
// cannot be an answer to anything this session asked, and must not translate
// its handle.
//
// The floor is the session's own `startedAt` out of the live-session registry
// (`adapters/sessions.ts`), which the SessionStart hook writes. A session whose
// first hook event is the Stop itself has no record yet when the credit pass
// runs — `claim()` precedes `noteSession("boundary")` — so it gets no floor at
// all, which is the shape the tests above run in and why they are unaffected.
// ═══════════════════════════════════════════════════════════════════════════

describe("the handle door, before this session started (G50 review)", () => {
  function creditPayload(c: Counterpart): Record<string, unknown> {
    return JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as Record<
      string,
      unknown
    >;
  }

  /** The same memory, the same title, the same project — only the clock moves. */
  async function fixture(): Promise<{ a: ClaudeCodeAdapter; id: string }> {
    const a = adapter();
    seed(a.counterpart);
    const id = await mint(a);
    a.counterpart.store.advanceClock("2026-01-02");
    // The session announces itself, exactly as the host's SessionStart does.
    a.sessionStart(input({ sessionId: "s-today", at: "2026-01-02" }));
    return { a, id };
  }

  function stopWithHandle(a: ClaudeCodeAdapter): void {
    a.stop(
      input({
        sessionId: "s-today",
        at: "2026-01-02",
        turns: [...TURNS, { role: "assistant", text: "Read it in full before answering." }],
        expansions: [{ atTurn: 3, ids: ["storage split"] }],
      }),
    );
  }

  test("a resolution from BEFORE this session started translates nothing", async () => {
    const { a, id } = await fixture();
    // A minute before this session began — another session in this same project
    // resolved the title, and this session's model merely typed it.
    const earlier = new McpServer({
      counterpart: a.counterpart,
      scope: "proj",
      owner: true,
      registryDir: dir,
      now: () => Date.now() - 60_000,
    });
    expect(((await earlier.call("recall", { handle: "storage split" })).structuredContent)["reason"]).toBe(
      "expanded",
    );
    // It is on disk, in this very project: only the floor keeps it out.
    expect(readHandleResolutions(dir, { scope: "proj" }).get(handleKey("storage split"))).toBe(id);

    stopWithHandle(a);

    const p = creditPayload(a.counterpart);
    expect(p["credited"]).toBe(0);
    expect(p["resolvedHandles"]).toBe(0);
    expect(p["unresolvedHandles"]).toBe(1);
    expect(a.counterpart.store.physicsOf(id).uses).toBe(0);
  });

  test("a resolution made DURING the session still credits", async () => {
    const { a, id } = await fixture();
    const now = new McpServer({
      counterpart: a.counterpart,
      scope: "proj",
      owner: true,
      registryDir: dir,
    });
    expect(((await now.call("recall", { handle: "storage split" })).structuredContent)["reason"]).toBe(
      "expanded",
    );

    stopWithHandle(a);

    const p = creditPayload(a.counterpart);
    expect(p["credited"]).toBe(1);
    expect(p["resolvedHandles"]).toBe(1);
    expect(a.counterpart.store.physicsOf(id).uses).toBe(1);
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

  test("RULING R3: eight shared function words are boilerplate, not a quote; eight words with content are", () => {
    const boiler = "I think it would be a good idea to keep the cache out of the backup set entirely.";
    expect(quotesWindow(boiler, "I think it would be a good idea to move on to the next thing.")).toBe(false);
    expect(quotesWindow(boiler, "As you said: a good idea to keep the cache out of the backup set.")).toBe(true);
    // Reference resolution end to end, same fixture.
    const r = resolveReferences({
      assistantTurns: ["I think it would be a good idea to move on to the next thing."],
      expansions: [],
      candidates: [{ id: "mem_222222222222", tier: "surfaced", body: boiler }],
    });
    expect(r.uses).toEqual([]);
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
