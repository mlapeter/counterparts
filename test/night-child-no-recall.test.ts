/**
 * FEEDBACK LOOP, PART F (2026-10-19): the nightly run's own sessions get no
 * ambient recall. Its children (`claude -p`, `night-run.ts#planNightChild`)
 * carry `COUNTERPARTS_NIGHT_RUN`, which `toHookInput` reads as `nightRun`;
 * until today only their temporal cues stood down (#453), and the launch
 * prompt was handed footnotes nobody reads, filed in the child's gate state
 * as shown. Now: no footnote, no "came to mind", no decision row — the clock
 * line only. A person's session with the same words is unaffected.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { planNightChild } from "../src/adapters/claude-code/night-run.js";
import { RECALL_CREDIT_EVENT, RECALL_DECISION_EVENT } from "../src/core/counterpart-events.js";
import { findable } from "./store-fixture.js";

const SCOPE = "/work/studio";
const ZONE = "America/Denver";
const BODY = "The kiln element cracked during the glaze firing and the supplier is sending a new one.";
const PROMPT = "Run tonight's dream. The kiln element cracked during the glaze firing.";
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
];

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-night-no-recall-"));
  setSystemTime(new Date("2026-10-19T06:19:00.000Z"));
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
  return { dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE };
}

function childEnv(): Record<string, string> {
  const plan = planNightChild({
    config: config(),
    run: "nrn_test1019",
    prompt: "dream",
    scope: SCOPE,
    session: "s-launcher",
    child: "dream",
    baseEnv: { PATH: "/usr/bin", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" },
  });
  expect(plan.ok).toBe(true);
  // What the host adds for `claude -p` (measured on 2.1.296).
  return { ...plan.env, CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CODE_SESSION_ATTENDED: "0" };
}

describe("part F: a night child's prompt gets no ambient recall", () => {
  test("the dream child is shown nothing and leaves no decision row; a person's session with the same words is shown the memory", () => {
    const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
    closers.push(a.counterpart);
    findable(a.counterpart.store);
    for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
    const id = a.counterpart.store.put({ type: "memory", kind: "fact", body: BODY });

    const nightIn = toHookInput(
      { session_id: "s-night-dream", hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: PROMPT },
      { scope: SCOPE, timeZone: ZONE, env: childEnv(), dataDir: dir },
    );
    expect(nightIn.nightRun).toBe(true);
    const night = a.userPromptSubmit(nightIn);
    expect(night.reason).toBe("night-run");
    expect(night.surfaced).toEqual([]);
    expect(night.footnotes).toEqual([]);
    expect(night.injection).not.toContain("kiln");
    expect(night.injection.length).toBeGreaterThan(0); // the clock line stays
    expect(a.counterpart.store.eventLog({ name: RECALL_DECISION_EVENT, ref: "s-night-dream" })).toEqual([]);

    const person = a.userPromptSubmit(
      toHookInput(
        { session_id: "s-person", hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: PROMPT },
        { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: dir },
      ),
    );
    expect([...person.surfaced, ...person.footnotes]).toContain(id);
  });

  test("its boundary credits nothing it read: the child's cursor never moves, so its recall calls are never in a judged slice", () => {
    const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
    closers.push(a.counterpart);
    findable(a.counterpart.store);
    for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
    const id = a.counterpart.store.put({ type: "memory", kind: "fact", body: BODY });
    // The dream child's transcript: its prompt, then a whole-read of the memory by id, then its reply.
    const path = join(dir, "night.jsonl");
    const lines = [
      { type: "user", message: { role: "user", content: PROMPT } },
      { type: "assistant", message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t1", name: "mcp__counterparts__recall", input: { ids: [id] } }] } },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "the memory, whole" }] } },
      { type: "assistant", message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: `I read ${id} whole: ${BODY}` }] } },
    ];
    writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
    const env = childEnv();
    const input = (event: string, extra: Record<string, unknown> = {}) =>
      toHookInput({ session_id: "s-night-dream", hook_event_name: event, cwd: SCOPE, transcript_path: path, ...extra }, { scope: SCOPE, timeZone: ZONE, env, dataDir: dir });
    expect(input("Stop").expansions?.length).toBe(1);
    a.userPromptSubmit(input("UserPromptSubmit", { prompt: PROMPT }));
    a.stop(input("Stop"));
    const rows = a.counterpart.store.eventLog({ name: RECALL_CREDIT_EVENT });
    expect(rows.length).toBe(1);
    const p = JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(p["session"]).toBe("s-night-dream");
    expect(p["expanded"]).toBe(0);
    expect(p["quoted"]).toBe(0);
    expect(p["credited"]).toBe(0);
    expect(p["ids"]).toEqual([]);
    // And after F it was shown nothing to judge.
    expect(p["shownFootnotes"]).toBe(0);
    expect(p["shownLoud"]).toBe(0);
  });
});
