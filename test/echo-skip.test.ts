/**
 * FEEDBACK LOOP, PART C (2026-10-19): no footnotes from this session — the
 * echo skip. Ambient recall (footnotes, "came to mind", quiet pointers) does
 * not hand a session back what it wrote itself (since its last compaction,
 * when the host says it compacted); the deliberate ask still finds it; the
 * decision row counts what was skipped.
 *
 * Hermetic: every test opens a fresh temp data dir and removes it; nothing
 * here can reach a live store.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { parseTranscript } from "../src/adapters/claude-code/transcript.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { RECALL_DECISION_EVENT } from "../src/core/counterpart-events.js";
import { findable } from "./store-fixture.js";

const SCOPE = "/work/bakery";
const ZONE = "America/Denver";

/** Ordinary background, so rarity can discriminate (recall §9 G4). */
const FILLER = [
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Set up a standing desk in the spare bedroom.",
  "Wrote a short letter to an old teacher.",
  "Bought hiking boots that finally fit properly.",
  "The neighbour's cat sits on the fence every evening.",
  "Replaced the smoke alarm batteries in the hall.",
  "Booked the dentist for a routine cleaning.",
  "The bread flour is kept in the second cupboard.",
];

const WRITTEN = "The sourdough starter died after two weeks of neglect in the cold pantry.";
const LATER = "The rye levain doubled overnight once it moved beside the warm oven.";
const PROMPT = "my sourdough starter died in the pantry, what went wrong?";
const RYE = "how is the rye levain beside the oven doing?";

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-echo-skip-"));
  setSystemTime(new Date("2026-10-19T15:00:00.000Z"));
});

afterEach(() => {
  setSystemTime();
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function config(): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: 9_000, owner: true, timeZone: ZONE };
}

type Adapter = ReturnType<typeof openAdapter>;

function adapter(): Adapter {
  const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  findable(a.counterpart.store);
  for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
  return a;
}

function server(a: Adapter, session: string): McpServer {
  return new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, owner: true, registryDir: dir });
}

async function remember(a: Adapter, session: string, text: string): Promise<string> {
  const r = await server(a, session).call("remember", { session, text });
  expect(r.isError).not.toBe(true);
  const ids = a.counterpart.store.sessionMemoryIds(session);
  const id = ids.find((m) => a.counterpart.store.readProse(m).body.includes(text.slice(0, 30)));
  if (id === undefined) throw new Error("remembered memory not found");
  return id;
}

function prompt(a: Adapter, session: string, text: string, transcript?: string) {
  const input = toHookInput(
    { session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text, ...(transcript === undefined ? {} : { transcript_path: transcript }) },
    { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: dir },
  );
  return a.userPromptSubmit(input);
}

function shown(turn: { surfaced: readonly string[]; footnotes: readonly string[] }): string[] {
  return [...turn.surfaced, ...turn.footnotes];
}

function lastDecision(a: Adapter, session: string): Record<string, unknown> {
  const rows = a.counterpart.store.eventLog({ name: RECALL_DECISION_EVENT, ref: session, order: "desc", limit: 1 });
  expect(rows.length).toBe(1);
  return JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
}

/** A transcript with one compaction mark at `at`, and a sidechain's later one that is not this conversation's. */
function transcript(at: number, sidechainAt?: number): string {
  const path = join(dir, "transcript.jsonl");
  const lines = [
    { type: "user", message: { role: "user", content: "earlier talk" }, timestamp: new Date(at - 60_000).toISOString() },
    { type: "system", subtype: "compact_boundary", isSidechain: false, timestamp: new Date(at).toISOString(), compactMetadata: { trigger: "auto" } },
    { type: "user", isCompactSummary: true, message: { role: "user", content: "This session is being continued…" }, timestamp: new Date(at).toISOString() },
    ...(sidechainAt === undefined
      ? []
      : [{ type: "system", subtype: "compact_boundary", isSidechain: true, timestamp: new Date(sidechainAt).toISOString() }]),
  ];
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
  return path;
}

describe("part C: a session is not handed back what it wrote", () => {
  test("a session that writes a memory then asks about it: no echo footnote; another session is shown it; the ask still finds it", async () => {
    const a = adapter();
    recordSession(dir, { sessionId: "s-writer", scope: SCOPE, phase: "start" });
    const id = await remember(a, "s-writer", WRITTEN);

    const own = prompt(a, "s-writer", PROMPT);
    expect(shown(own)).not.toContain(id);
    expect(own.injection).not.toContain("cold pantry");
    const row = lastDecision(a, "s-writer");
    expect(row["echoSkipped"]).toBeGreaterThanOrEqual(1);

    // The same words from a session that did not write it: it comes to mind.
    const other = prompt(a, "s-reader", PROMPT);
    expect(shown(other)).toContain(id);
    expect(lastDecision(a, "s-reader")["echoSkipped"]).toBe(0);

    // Deliberate recall is unaffected: the writer can still ask for it.
    const asked = await server(a, "s-writer").call("recall", { session: "s-writer", question: "the sourdough starter in the pantry", mode: "facts" });
    expect(asked.isError).not.toBe(true);
    expect(String((asked.structuredContent as Record<string, unknown>)["answer"] ?? "")).toContain(id);
    // And by id.
    const opened = await server(a, "s-writer").call("recall", { session: "s-writer", ids: [id] });
    expect(JSON.stringify(opened.structuredContent)).toContain("cold pantry");
  });

  test("a compacted session: what it wrote before the compaction can come to mind again; what it wrote since cannot", async () => {
    const a = adapter();
    recordSession(dir, { sessionId: "s-long", scope: SCOPE, phase: "start" });
    const before = await remember(a, "s-long", WRITTEN);
    setSystemTime(new Date("2026-10-19T17:00:00.000Z"));
    const compactAt = Date.now();
    setSystemTime(new Date("2026-10-19T17:30:00.000Z"));
    const since = await remember(a, "s-long", LATER);
    // A subagent's compaction (a sidechain line) after both is not this conversation's.
    const path = transcript(compactAt, Date.now() + 60_000);

    const early = prompt(a, "s-long", PROMPT, path);
    expect(shown(early)).toContain(before);
    const fresh = prompt(a, "s-long", RYE, path);
    expect(shown(fresh)).not.toContain(since);
    expect(lastDecision(a, "s-long")["echoSkipped"]).toBeGreaterThanOrEqual(1);

    // Without the transcript the whole session is the window.
    const whole = prompt(a, "s-other-turn", PROMPT);
    expect(shown(whole)).toContain(before);
  });

  test("the transcript reader keeps the newest compaction mark, and not a sidechain's", () => {
    const lines = [
      { type: "system", subtype: "compact_boundary", timestamp: "2026-10-16T19:58:37.522Z" },
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "system", subtype: "compact_boundary", timestamp: "2026-10-16T21:00:00.000Z" },
      { type: "system", subtype: "compact_boundary", isSidechain: true, timestamp: "2026-10-16T23:00:00.000Z" },
      { type: "system", subtype: "compact_boundary", timestamp: "not a time" },
    ];
    const read = parseTranscript(lines.map((l) => JSON.stringify(l)).join("\n"));
    expect(read.compactedAt).toBe(Date.parse("2026-10-16T21:00:00.000Z"));
    expect(read.turns.map((t) => t.text)).toEqual(["hello"]);
    expect(parseTranscript(JSON.stringify(lines[1])).compactedAt).toBeUndefined();
  });
});

describe("part C, in the core: the echo set is ambient only", () => {
  test("recallForTurn skips what the session wrote, counts it, and a session that wrote nothing is unaffected", () => {
    const c = Counterpart.open({ dir, owner: true });
    closers.push(c);
    findable(c.store);
    for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
    const mine = c.store.put({ type: "memory", kind: "fact", body: WRITTEN, origin: { session: "s-core" } });

    const own = c.recallForTurn({ sessionId: "s-core", text: PROMPT });
    expect([...own.decision.surfaced, ...own.decision.footnotes]).not.toContain(mine);
    expect(own.decision.verdicts.find((v) => v.id === mine)?.verdict).toBe("echo-skipped");
    expect(own.decision.echoSkipped).toBe(1);

    const other = c.recallForTurn({ sessionId: "s-elsewhere", text: PROMPT });
    expect([...other.decision.surfaced, ...other.decision.footnotes]).toContain(mine);
    expect(other.decision.echoSkipped).toBe(0);
  });
});
