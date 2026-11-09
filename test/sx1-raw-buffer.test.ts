/**
 * SX1 — a password said in a sentence survives NOWHERE on disk: not in the
 * memory, and not in the raw buffer.
 *
 * Driven the way it happens: `remember` through the real MCP door (the memory
 * and the note's own raw line), and a turn through the Stop hook's path — a
 * Claude Code transcript file, read by `toHookInput` as the hook binary reads
 * it, handed to the adapter's `stop` — which is what fills `buffer.jsonl` and
 * `assistant.jsonl`. Then every byte of the store directory is searched for the
 * password: the SQLite file, its WAL, the indexes, the span files.
 *
 * The hosted tenant's shape of the same is in `hosted/test/sx1-prose-passwords.test.ts`.
 *
 * Hermetic: a fresh temp dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { recordSession } from "../src/adapters/sessions.js";
import { SpanBuffer } from "../src/core/remember/index.js";

const SCOPE = "/scope/sx1";
const PASSWORD = "sunflower42";
const PIN = "4471";

let root: string;
let dir: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-sx1-")));
  dir = join(root, "store");
});

afterEach(() => {
  for (const c of closers.splice(0).reverse()) {
    try {
      c();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** Every file under `at` that holds `needle`, as bytes. */
function filesHolding(at: string, needle: string): string[] {
  const out: string[] = [];
  const bytes = Buffer.from(needle, "utf8");
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (readFileSync(p).includes(bytes)) out.push(p);
    }
  };
  if (existsSync(at)) walk(at);
  return out;
}

/** Every line of one span stream, in every folder this store files under. */
function streamTexts(stream: string): string[] {
  const spans = join(dir, "spans");
  const out: string[] = [];
  if (!existsSync(spans)) return out;
  for (const key of readdirSync(spans)) {
    const file = join(spans, key, stream);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.length > 0) out.push((JSON.parse(line) as { text: string }).text);
    }
  }
  return out;
}

function server(): McpServer {
  const s = openServer({
    dir,
    scope: SCOPE,
    env: {},
    manifestVersion: () => null,
    lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
  });
  closers.push(() => s.counterpart.close());
  return s;
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "remember", arguments: args } });
  const result = (res as { result?: { structuredContent?: Record<string, unknown> } } | null)?.result;
  return result?.structuredContent ?? {};
}

describe("SX1: a password named in a sentence, through every door that writes", () => {
  test("remember: the memory and the note's raw line keep the sentence, never the password", async () => {
    const s = server();
    const out = await remember(s, {
      text: `Mike set up the cabin router today. The wifi password is ${PASSWORD} and the door's PIN is ${PIN}; he wants the guests to have both.`,
    });
    expect(out["stored"]).toBe(true);
    s.counterpart.close();
    closers.length = 0;

    const notes = streamTexts("jots.jsonl");
    expect(notes.length).toBe(1);
    expect(notes[0]).toContain("The wifi password is [REDACTED:password]");
    expect(notes[0]).toContain("PIN is [REDACTED:password]");
    expect(filesHolding(dir, PASSWORD)).toEqual([]);
    // In context: four digits alone could turn up inside an id or a timestamp.
    expect(filesHolding(dir, `PIN is ${PIN}`)).toEqual([]);
  });

  test("capture at Stop: the transcript's turns land in raw with the password stripped, both streams", () => {
    const transcript = join(root, "transcript.jsonl");
    const entries = [
      { type: "user", message: { role: "user", content: `The office wifi password's ${PASSWORD}, can you add it to the setup notes for the new laptop?` } },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: `Done: the notes say the wifi password is ${PASSWORD}, under "Network".` }] },
      },
      { type: "user", message: { role: "user", content: "Thanks. I forgot my password for the VPN, so that part waits until Monday." } },
    ];
    writeFileSync(transcript, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");

    const a = openAdapter(
      { dataDir: dir },
      { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }), scope: { mode: "on", matched: SCOPE, entry: null } },
    );
    closers.push(() => a.counterpart.close());
    // A live session, as SessionStart leaves one (the boundary seals a stretch with no record).
    recordSession(a.counterpart.store.dir, { sessionId: "s-sx1", scope: SCOPE, phase: "start" });
    const input = toHookInput({ session_id: "s-sx1", hook_event_name: "Stop", transcript_path: transcript }, { scope: SCOPE });
    expect(input.turns?.length).toBe(3);
    const result = a.hook("stop", input);
    expect(result.ok).toBe(true);
    expect(result.spansAppended).toBeGreaterThan(0);
    const counted = a.counterpart.events("remember.span.redacted");
    a.counterpart.close();
    closers.length = 0;

    const said = streamTexts("buffer.jsonl").join("\n");
    const replied = streamTexts("assistant.jsonl").join("\n");
    expect(said).toContain("The office wifi password's [REDACTED:password]");
    // The ordinary sentence stays word for word.
    expect(said).toContain("I forgot my password for the VPN");
    expect(replied).toContain("the wifi password is [REDACTED:password]");
    expect(filesHolding(dir, PASSWORD)).toEqual([]);
    // Counted by family, never the value.
    expect(counted.length).toBe(2);
    expect(JSON.stringify(counted)).not.toContain(PASSWORD);
    expect(counted.every((e) => e.data?.["password"] === 1)).toBe(true);
  });

  test("a buffer with no gate handed in appends as before (the gate is the Counterpart's to inject)", () => {
    const b = new SpanBuffer({ dir });
    const out = b.jot({ session: "s", scope: SCOPE, text: `the password is ${PASSWORD}` });
    expect(out.captured).toBe(true);
    const gated = new SpanBuffer({ dir: join(root, "gated"), redact: (t) => ({ redacted: t.replace(PASSWORD, "[REDACTED:password]"), findings: [{ family: "password", count: 1 }] }) });
    const g = gated.jot({ session: "s", scope: SCOPE, text: `the password is ${PASSWORD}` });
    expect(g.spans[0]?.text).toBe("the password is [REDACTED:password]");
    expect(filesHolding(join(root, "gated"), PASSWORD)).toEqual([]);
  });
});
