/**
 * THE NEXT-SESSION WRITE-UP — roadmap C2, owner's decisions of 2026-09-23.
 *
 * A session that ended before it was written up (B3's `owesWriteUp`) is handed
 * to the NEXT session that starts in its project: its captured words ride
 * beside the wake, the assistant writes memories back through a `writeUp`
 * field on `session_end`, and the old session is marked written up through
 * B3's seam — so its seven-day retention clock starts. The key-based sweep
 * becomes an opt-in (`crashWriteUp: "api"`).
 *
 * The acceptance, one describe each:
 *   1. the ask — one owing session, exactly one ask with its words; a
 *      below-threshold session, none; two, oldest first; a 60 KB session in
 *      parts, "part 1 of N";
 *   2. the door — every refusal by name, a success that mints authored
 *      memories under the WRITING session and marks the old one, and B3's
 *      retention reading that mark;
 *   3. the sweep — off without the knob, on with the knob and a key.
 *
 * Hermetic: a fresh temp directory per test, removed after. The only key any
 * test holds is a fake string, set and restored around the one test that
 * needs the sweep to run.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, SWEEP_GATE_EVENT } from "../src/core/counterpart.js";
import { SpanBuffer, planRetention } from "../src/core/remember/index.js";
import type { ProposalRecord } from "../src/core/remember/proposals.js";
import { SELF_TUNABLES } from "../src/core/self/index.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { ClaudeCodeAdapter, HookInput } from "../src/adapters/claude-code/hooks.js";
import {
  WRITE_UP_ASK_COUNT_KEY,
  WRITE_UP_ASK_DATE_KEY,
  WRITE_UP_OPEN,
  writeUpParts,
} from "../src/adapters/claude-code/hooks.js";
import { API_KEY_ENV, TUNABLES, loadConfig } from "../src/adapters/claude-code/config.js";
import type { AdapterConfig } from "../src/adapters/claude-code/config.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/server.js";
import {
  readSession,
  readWriteUpProgress,
  recordSession,
  writeUpSources,
} from "../src/adapters/sessions.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIRST_ASK = {
  turns: SELF_TUNABLES.FIRST_ASK_TURNS,
  bytes: SELF_TUNABLES.FIRST_ASK_BYTES,
  soloBytes: SELF_TUNABLES.SOLO_ASK_BYTES,
};

let root: string;
let storeDir: string;
let PROJ: string;
let OTHER: string;
let priorKey: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-writeup-")));
  storeDir = join(root, "store");
  PROJ = join(root, "proj");
  OTHER = join(root, "other");
  mkdirSync(PROJ, { recursive: true });
  mkdirSync(OTHER, { recursive: true });
  // No test here may see a developer's own key: the API sweep and the
  // next-session ask both read its PRESENCE.
  priorKey = process.env[API_KEY_ENV];
  delete process.env[API_KEY_ENV];
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorKey === undefined) delete process.env[API_KEY_ENV];
  else process.env[API_KEY_ENV] = priorKey;
  rmSync(root, { recursive: true, force: true });
});

// ── seeding ─────────────────────────────────────────────────────────────────

/** A counterpart on a clock the test turns, for seeding the past. */
function seeder(): { c: Counterpart; set(at: number): void; done(): void } {
  let at = Date.now();
  const c = Counterpart.open({ dir: storeDir, owner: true, now: () => at });
  return {
    c,
    set(next: number): void {
      at = next;
    },
    done(): void {
      c.close();
    },
  };
}

/** Words said to a session, `bytes` of them, in `captures` boundaries. */
function wordsOf(tag: string, bytes: number): string {
  const unit = `${tag}: the reservoir loop keeps its pressure only when the relief valve is seated first. `;
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

/**
 * A session that talked in `scope`, then ENDED — normally, or by going silent
 * past the registry's window (a crash has no end on this host). `asked` is the
 * pacer finding substance; without it the session is below the threshold.
 */
function ended(
  s: { c: Counterpart; set(at: number): void },
  id: string,
  opts: {
    at: number;
    scope?: string;
    asked?: boolean;
    end?: "normal" | "crash";
    bytes?: number;
    captures?: number;
    answered?: boolean;
  },
): void {
  const scope = opts.scope ?? PROJ;
  const captures = opts.captures ?? 1;
  const per = Math.ceil((opts.bytes ?? 600) / captures);
  recordSession(storeDir, { sessionId: id, scope, phase: "start", at: opts.at });
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (let i = 0; i < captures; i++) {
    s.set(opts.at + i * 1000);
    turns.push({ role: "user", text: wordsOf(`${id} #${String(i)}`, per) });
    turns.push({ role: "assistant", text: `(${id} #${String(i)}) understood.` });
    s.c.captureSpans({ session: id, scope, turns: [...turns] });
  }
  if (opts.asked !== false) expect(s.c.episodeAsk(id, { turns: 9, bytes: 6_000 }).asked).toBe(true);
  s.c.boundary({ session: id, scope, kind: "stop" });
  recordSession(storeDir, { sessionId: id, scope, phase: "boundary", at: opts.at + captures * 1000 });
  if (opts.answered === true) {
    expect(s.c.appendEpisode(id, `A chapter from ${id}.`).appended).toBe(true);
  }
  if ((opts.end ?? "normal") === "normal") {
    s.c.boundary({ session: id, scope, kind: "session-end" });
    recordSession(storeDir, { sessionId: id, scope, phase: "end", at: opts.at + captures * 1000 + 1 });
  }
}

function config(over: Partial<AdapterConfig> = {}): AdapterConfig {
  return { dataDir: storeDir, owner: true, ...over };
}

/** One SessionStart in `scope` — the adapter a hook process builds, then closed. */
function start(
  sessionId: string,
  opts: { scope?: string; config?: Partial<AdapterConfig>; mode?: "on" | "unset"; tamper?: (a: ClaudeCodeAdapter) => void } = {},
): { ask: string | null; injection: string; events: string[] } {
  const a = openAdapter(config(opts.config), {
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 4242 }),
    ...(opts.mode === "unset" ? {} : { scope: { mode: "on", matched: opts.scope ?? PROJ, entry: null } }),
  });
  try {
    opts.tamper?.(a);
    const input: HookInput = { sessionId, scope: opts.scope ?? PROJ, at: new Date().toISOString().slice(0, 10) };
    const out = a.sessionStart(input);
    return { ask: out.ask, injection: out.injection, events: a.events().map((e) => e.name) };
  } finally {
    a.counterpart.close();
  }
}

/** Another calendar day, as far as the day's allowance is concerned. */
function newDay(): void {
  const c = Counterpart.open({ dir: storeDir, owner: true });
  c.store.setMeta(WRITE_UP_ASK_DATE_KEY, "1999-01-01");
  c.store.setMeta(WRITE_UP_ASK_COUNT_KEY, "0");
  c.close();
}

function server(): McpServer {
  const s = openServer({ dir: storeDir, scope: PROJ, owner: true });
  open.push(s.counterpart);
  return s;
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

const occurrences = (hay: string, needle: string): number => hay.split(needle).length - 1;

// ═══════════════════════════════════════════════════════════════════════════
describe("the ask: the next session start in that project is handed the words", () => {
  test("one ended-unwritten session (asked, never answered) → exactly one ask, carrying its words", () => {
    const s = seeder();
    ended(s, "old-1", { at: Date.now() - 2 * DAY, bytes: 900 });
    s.done();

    const out = start("new-1");
    expect(out.ask).not.toBeNull();
    const ask = out.ask as string;
    expect(occurrences(ask, WRITE_UP_OPEN)).toBe(1);
    expect(ask).toContain("session old-1");
    expect(ask).toContain("part 1 of 1");
    expect(ask).toContain(wordsOf("old-1 #0", 60));
    // The door and its fields are named, with THIS session as `session`.
    expect(ask).toContain("session: new-1, writeUp: old-1, part: 1");
    // The assistant's own replies are never part of what is handed over.
    expect(ask).not.toContain("understood.");
    // The wake is untouched: the block rides beside it, never inside.
    expect(out.injection).not.toContain(WRITE_UP_OPEN);
    // And the marks the door reads are down.
    expect(readSession(storeDir, "new-1")?.writeUpFor).toEqual({ session: "old-1", part: 1 });
    const c = Counterpart.open({ dir: storeDir, owner: true });
    expect(readWriteUpProgress(c.store)["old-1"]).toMatchObject({ parts: 1, done: 0 });
    c.close();

    // A compaction re-firing SessionStart in the same session asks nothing.
    expect(start("new-1").ask).toBeNull();
  });

  test("a session BELOW the pacer's threshold owes nothing and is never asked about", () => {
    const s = seeder();
    ended(s, "short-1", { at: Date.now() - 2 * DAY, bytes: 200, asked: false });
    s.done();
    expect(start("new-1").ask).toBeNull();
  });

  test("a session that ended normally AND answered owes nothing either", () => {
    const s = seeder();
    ended(s, "done-1", { at: Date.now() - 2 * DAY, answered: true });
    s.done();
    expect(start("new-1").ask).toBeNull();
  });

  test("a CRASHED session is handed over once it is silent past the registry's window — never while it may still be running", () => {
    const s = seeder();
    ended(s, "crash-now", { at: Date.now() - 60_000, end: "crash" });
    s.done();
    expect(start("new-1").ask).toBeNull();

    const t = seeder();
    ended(t, "crash-old", { at: Date.now() - 6 * HOUR, end: "crash" });
    t.done();
    const ask = start("new-2").ask ?? "";
    expect(ask).toContain("session crash-old");
    expect(ask).not.toContain("crash-now");
  });

  test("a session from ANOTHER project is not this project's to write up", () => {
    const s = seeder();
    ended(s, "far-1", { at: Date.now() - 2 * DAY, scope: OTHER });
    s.done();
    expect(start("new-1").ask).toBeNull();
    expect(start("new-2", { scope: OTHER })?.ask ?? "").toContain("session far-1");
  });

  test("two owing sessions: the OLDEST first, the second at the next start — even when the first was ignored", () => {
    const s = seeder();
    ended(s, "younger", { at: Date.now() - 1 * DAY });
    ended(s, "older", { at: Date.now() - 3 * DAY });
    s.done();

    const first = start("new-1").ask ?? "";
    expect(first).toContain("session older");
    expect(first).not.toContain("session younger");
    const second = start("new-2").ask ?? "";
    expect(second).toContain("session younger");
    expect(second).not.toContain("session older");
    // Both handed over, neither written: the one handed over longest ago again.
    newDay();
    expect(start("new-3").ask ?? "").toContain("session older");
  });

  test("a 60 KB session is handed over in parts across starts — 'part 1 of N', the same N every time", () => {
    const s = seeder();
    ended(s, "long-1", { at: Date.now() - 2 * DAY, bytes: 60 * 1024, captures: 12 });
    s.done();

    const one = start("new-1").ask ?? "";
    const m = /part 1 of (\d+)/.exec(one);
    expect(m).not.toBeNull();
    const n = Number(m?.[1]);
    expect(n).toBeGreaterThan(1);
    // THE HOST'S CAP, not the owner's 24 KB, is what bounds a part here.
    expect(Buffer.byteLength(one, "utf8")).toBeLessThanOrEqual(TUNABLES.WRITE_UP_HOST_OUTPUT_CHARS);
    expect(one).toContain(`The rest (parts 2–${String(n)}) comes at later session starts here.`);

    // The next start, unanswered: the SAME part again (it was never written),
    // under the same N.
    const again = start("new-2").ask ?? "";
    expect(again).toContain(`part 1 of ${String(n)}`);
    // The day's allowance is two: the third start that day is not asked.
    const spent = start("new-3");
    expect(spent.ask).toBeNull();
    expect(spent.events).toContain("adapter.writeup.skipped");
  });

  test("never under observer", () => {
    const s = seeder();
    ended(s, "old-1", { at: Date.now() - 2 * DAY });
    s.done();
    expect(start("new-1", { config: { observer: true } }).ask).toBeNull();
  });

  test("it COINCIDES with the first-launch question — carried after it, never instead of it", () => {
    const s = seeder();
    ended(s, "old-1", { at: Date.now() - 2 * DAY });
    s.done();
    const ask = start("new-1", { mode: "unset" }).ask ?? "";
    expect(ask.indexOf("<counterparts-scope>")).toBe(0);
    expect(ask.indexOf(WRITE_UP_OPEN)).toBeGreaterThan(ask.indexOf("</counterparts-scope>"));
  });

  test("with the API sweep ON, a crashed session is the sweep's — a normally ended one is still asked about", () => {
    const s = seeder();
    ended(s, "crashed", { at: Date.now() - 3 * DAY, end: "crash" });
    ended(s, "unanswered", { at: Date.now() - 1 * DAY, end: "normal" });
    s.done();
    process.env[API_KEY_ENV] = "sk-ant-test-not-a-real-key";
    const ask = start("new-1", { config: { crashWriteUp: "api" } }).ask ?? "";
    expect(ask).toContain("session unanswered");
    expect(ask).not.toContain("session crashed");
  });

  test("a throw anywhere inside the write-up costs the write-up and nothing else", () => {
    const s = seeder();
    ended(s, "old-1", { at: Date.now() - 2 * DAY });
    s.done();
    const plain = start("new-0", { tamper: (a) => void a });
    const broken = start("new-1", {
      tamper: (a) => {
        (a.counterpart.spans as unknown as { scopes: () => string[] }).scopes = () => {
          throw new Error("forced");
        };
      },
    });
    expect(broken.ask).toBeNull();
    expect(broken.injection).toBe(plain.injection);
    expect(broken.events).toContain("adapter.writeup.failed");
  });

  test("the parts are cut on entry boundaries, and an entry longer than a part is cut at a character", () => {
    const entries = [
      { text: "a".repeat(40), kept: false, jot: false },
      { text: "b".repeat(40), kept: true, jot: false },
      { text: "é".repeat(100), kept: false, jot: true },
    ];
    const parts = writeUpParts(entries, 90);
    for (const p of parts) expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(90);
    // Nothing is lost and nothing is split inside a character.
    expect(parts.join("")).toContain("a".repeat(40));
    expect(parts.join("").split("é").length - 1).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the door: `session_end` with `writeUp`", () => {
  const MEMORY = { content: "The reservoir loop holds pressure only when the relief valve is seated first.", kind: "fact" };

  function handed(): McpServer {
    const s = seeder();
    ended(s, "old-1", { at: Date.now() - 2 * DAY });
    ended(s, "old-2", { at: Date.now() - 1 * DAY });
    ended(s, "short-1", { at: Date.now() - 1 * DAY, asked: false });
    ended(s, "far-1", { at: Date.now() - 1 * DAY, scope: OTHER });
    s.done();
    // A second session running in this project, right now.
    recordSession(storeDir, { sessionId: "live-2", scope: PROJ, phase: "start" });
    expect(start("new-1").ask ?? "").toContain("session old-1");
    return server();
  }

  test("each refusal by name — and a refusal writes nothing", async () => {
    const s = handed();
    const call = async (args: Record<string, unknown>): Promise<Record<string, unknown>> =>
      payload(await s.call("session_end", { session: "new-1", memories: [MEMORY], ...args }));

    expect((await call({ writeUp: "live-2" }))["reason"]).toBe("live-session");
    expect((await call({ writeUp: "new-1" }))["reason"]).toBe("live-session");
    expect((await call({ writeUp: "nobody-at-all" }))["reason"]).toBe("unknown-session");
    expect((await call({ writeUp: "../../etc" }))["reason"]).toBe("unknown-session");
    expect((await call({ writeUp: "far-1" }))["reason"]).toBe("other-project");
    expect(await call({ writeUp: "short-1" })).toMatchObject({ reason: "owes-nothing", why: "below-threshold" });
    // Owed, in this project — and not the one THIS session was handed.
    expect((await call({ writeUp: "old-2" }))["reason"]).toBe("not-asked");
    expect((await call({ writeUp: "old-1", part: 2 }))["reason"]).toBe("wrong-part");
    expect((await call({ writeUp: "old-1", handoff: "where it stands" }))["reason"]).toBe("handoff-not-accepted");
    // AN EMPTY BATCH IS NOT A WRITE-UP.
    const empty = await call({ writeUp: "old-1", memories: [] });
    expect(empty["reason"]).toBe("empty-batch");
    expect(String(empty["detail"])).toContain("not a write-up");

    // Nothing landed from any of it: no memory under the writing session, and
    // old-1 still owes.
    const records = s.counterpart.spans.proposalRecords<ProposalRecord>(PROJ).filter((p) => p.session === "new-1");
    expect(records).toEqual([]);
    const plan = planRetention(s.counterpart.spans, writeUpSources(s.counterpart.store, FIRST_ASK));
    expect(plan.find((h) => h.session === "old-1")?.owes).toBe(true);
    // And a session_end without `writeUp` is untouched by any of this: the
    // nothing-new mark was never set on the writing session.
    expect(readSession(storeDir, "new-1")?.nothingNewAt).toBeUndefined();
  });

  test("a write-up mints authored memories under the WRITING session, marks the old one, and a second is refused", async () => {
    const s = handed();
    const out = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", part: 1, memories: [MEMORY] }));
    expect(out).toMatchObject({ reason: "written-up", ended: "old-1", part: 1, of: 1, deposited: 1, marked: true });

    // The same road as any `session_end` entry: an accepted, AUTHORED
    // session-end proposal — under new-1, never under old-1.
    const records = s.counterpart.spans.proposalRecords<ProposalRecord>(PROJ).filter((p) => p.accepted === true);
    const mine = records.filter((p) => p.session === "new-1");
    expect(mine.length).toBe(1);
    expect(mine[0]?.source).toBe("session-end");
    expect(records.some((p) => p.session === "old-1")).toBe(false);
    const id = (out["outcomes"] as { id?: string }[])[0]?.id as string;
    expect(s.counterpart.store.read(id).doc.body).toContain("relief valve");
    // AUTHORED, and the WRITING session named on the record.
    expect(s.counterpart.store.row(id)).toMatchObject({ source: "authored", origin_session: "new-1" });

    // Marked through B3's seam, by the next session.
    const marks = s.counterpart.spans.writeUps(PROJ);
    expect(marks.map((w) => [w.session, w.by])).toEqual([["old-1", "next-session"]]);
    expect(readWriteUpProgress(s.counterpart.store)["old-1"]).toBeUndefined();

    // IDEMPOTENT: a second write-up of the same id is refused by name.
    const again = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", memories: [MEMORY] }));
    expect(again["reason"]).toBe("already-written-up");

    // And B3's retention reads the mark: kept while young, deletable after 7 days.
    const sources = writeUpSources(s.counterpart.store, FIRST_ASK);
    const now = planRetention(new SpanBuffer({ dir: storeDir, now: () => Date.now() }), sources);
    expect(now.find((h) => h.session === "old-1")).toMatchObject({ owes: false, verdict: "kept-young" });
    const later = planRetention(new SpanBuffer({ dir: storeDir, now: () => Date.now() + 8 * DAY }), sources);
    expect(later.find((h) => h.session === "old-1")?.verdict).toBe("deleted");
    // The one that was never written up is still kept, however old.
    expect(later.find((h) => h.session === "old-2")?.verdict).toBe("kept-owed");
  });

  test("a batch the gate refuses entirely lands nothing and marks nothing", async () => {
    const s = handed();
    const out = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", memories: [{ content: "" }] }));
    expect(out["reason"]).toBe("nothing-landed");
    expect(s.counterpart.spans.writeUps(PROJ)).toEqual([]);
  });

  test("a 60 KB session: part by part across starts, and only the LAST part marks it", async () => {
    const seed = seeder();
    ended(seed, "long-1", { at: Date.now() - 2 * DAY, bytes: 60 * 1024, captures: 12 });
    seed.done();

    let of = 0;
    for (let part = 1; ; part++) {
      newDay();
      const ask = start(`writer-${String(part)}`).ask ?? "";
      const m = /part (\d+) of (\d+)/.exec(ask);
      expect(Number(m?.[1])).toBe(part);
      if (of === 0) of = Number(m?.[2]);
      expect(Number(m?.[2])).toBe(of);
      const s = server();
      const out = payload(
        await s.call("session_end", {
          session: `writer-${String(part)}`,
          writeUp: "long-1",
          part,
          memories: [{ content: `Part ${String(part)} of the long session: the valve is seated first.`, kind: "fact" }],
        }),
      );
      // A second write of the same part is refused.
      const twice = payload(
        await s.call("session_end", { session: `writer-${String(part)}`, writeUp: "long-1", memories: [MEMORY] }),
      );
      if (part < of) {
        expect(out).toMatchObject({ reason: "part-written", part, of, recorded: true });
        expect(twice["reason"]).toBe("part-already-written");
        expect(s.counterpart.spans.writeUps(PROJ)).toEqual([]);
        s.counterpart.close();
        open.splice(open.indexOf(s.counterpart), 1);
        continue;
      }
      expect(out).toMatchObject({ reason: "written-up", part: of, of, marked: true });
      expect(twice["reason"]).toBe("already-written-up");
      expect(s.counterpart.spans.writeUps(PROJ).map((w) => w.session)).toEqual(["long-1"]);
      break;
    }
    expect(of).toBeGreaterThan(1);
    // Nothing is left to hand over.
    newDay();
    expect(start("after").ask).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the sweep is an opt-in upgrade", () => {
  function crashed(): void {
    const s = seeder();
    ended(s, "crashed", { at: Date.now() - 2 * DAY, end: "crash" });
    s.done();
  }
  const reply = (): Response =>
    new Response(
      [
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1 } } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '[{"content":"The relief valve is seated before the loop is pressurised.","kind":"fact"}]' } })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
      ].join(""),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );

  test("WITHOUT the knob, a key alone does not run it — the gate row lands and no socket opens", async () => {
    crashed();
    let calls = 0;
    const events: Record<string, unknown>[] = [];
    const report = await runOnce({
      config: config(),
      date: "2026-09-23",
      env: { [API_KEY_ENV]: "sk-ant-test-not-a-real-key" },
      fetch: async () => {
        calls += 1;
        throw new Error("the sweep made a model call without the opt-in");
      },
      onEvent: (name, data) => {
        if (name === "runner.done") events.push(data);
      },
    });
    expect(report.ran).toBe(true);
    expect(calls).toBe(0);
    expect(events[0]?.["sweep"]).toBe("next-session");
    const c = Counterpart.open({ dir: storeDir, owner: true });
    const rows = c.store.eventLog({ name: SWEEP_GATE_EVENT, limit: 5 });
    expect(JSON.parse(rows[0]?.payload ?? "{}")["reason"]).toBe("no-credential");
    c.close();
  });

  test("WITH the knob and a key, it runs", async () => {
    crashed();
    process.env[API_KEY_ENV] = "sk-ant-test-not-a-real-key";
    let calls = 0;
    const report = await runOnce({
      config: config({ crashWriteUp: "api" }),
      date: "2026-09-23",
      env: { [API_KEY_ENV]: "sk-ant-test-not-a-real-key" },
      fetch: async () => {
        calls += 1;
        return reply();
      },
    });
    expect(calls).toBeGreaterThan(0);
    expect(report.swept).toBeGreaterThan(0);
  });

  test("the knob with NO key is the next session's job, and says so", async () => {
    crashed();
    const events: Record<string, unknown>[] = [];
    await runOnce({
      config: config({ crashWriteUp: "api" }),
      date: "2026-09-23",
      env: {},
      fetch: async () => {
        throw new Error("no key, no call");
      },
      onEvent: (name, data) => {
        if (name === "runner.done") events.push(data);
      },
    });
    expect(events[0]?.["sweep"]).toBe("no-key");
  });

  test("the knob is STRICT: anything but the two words stands the configuration down", () => {
    expect(loadConfig({ dataDir: "/x", crashWriteUp: "api" }).config.crashWriteUp).toBe("api");
    expect(loadConfig({ dataDir: "/x", crashWriteUp: "next-session" }).config.crashWriteUp).toBe("next-session");
    for (const bad of ["API", "api ", true, 1, null, "sweep"]) {
      expect(loadConfig({ dataDir: "/x", crashWriteUp: bad }).config).toEqual({ observer: true });
    }
    expect(loadConfig({ dataDir: "/x" }).config.crashWriteUp).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("doctor: one line, `Crash write-up`", () => {
  function line(over: Partial<AdapterConfig> = {}, keys: string[] = []): { severity: string; detail: string } {
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    const findings = doctorFindings({
      configPath: join(root, "claude-code.json"),
      configReason: "loaded",
      config: config(over),
      dir: storeDir,
      credentials: { loaded: keys, skippedPresent: [], ignored: 0, file: null } as never,
      credentialsPath: undefined,
      store: c.store,
      today: "2026-09-23",
      refusals: {},
    });
    const f = findings.find((x) => x.key === "crash-write-up");
    c.close();
    open.pop();
    return { severity: f?.severity ?? "missing", detail: f?.detail ?? "" };
  }

  test("green `next session` by default; `on (API)` with the knob and the key; amber with the knob and no key", () => {
    expect(line()).toEqual({ severity: "green", detail: "next session" });
    expect(line({ crashWriteUp: "api" }, [API_KEY_ENV])).toEqual({ severity: "green", detail: "on (API)" });
    expect(line({ crashWriteUp: "api" }).severity).toBe("amber");
  });

  test("counts the sessions awaiting a write-up, and turns amber once one has waited past 3 days", () => {
    const s = seeder();
    ended(s, "fresh", { at: Date.now() - 1 * DAY });
    s.done();
    expect(line()).toEqual({ severity: "green", detail: "next session — 1 session awaiting a write-up" });
    const t = seeder();
    ended(t, "stale", { at: Date.now() - 5 * DAY, scope: OTHER });
    t.done();
    expect(line()).toEqual({
      severity: "amber",
      detail: "next session — 2 sessions awaiting a write-up, 1 older than 3 days",
    });
  });
});
