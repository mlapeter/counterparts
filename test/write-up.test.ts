/**
 * THE NEXT-SESSION WRITE-UP — roadmap C2, owner's decisions of 2026-09-23.
 *
 * A session that ended before it was written up (B3's `owesWriteUp`) is
 * written up by the NEXT session that starts in its project: the SessionStart
 * hook puts a short POINTER beside the wake, the assistant FETCHES the words
 * through a `writeUp` field on `session_end` (no memories), ANSWERS with
 * memories — or `[]`, nothing worth keeping — and the last part marks the old
 * session written up through B3's seam, so its seven-day retention clock
 * starts. The key-based sweep becomes an opt-in (`crashWriteUp: "api"`), and it
 * and the write-up know each other's marks.
 *
 * The acceptance, one describe each:
 *   1. the pointer — one owing session, exactly one pointer; a below-threshold
 *      session, none; two, oldest first; a 60 KB session, "part 1 of N"; and it
 *      fits beside a 9 KB wake;
 *   2. the door — every refusal by name; a fetch that returns the words; an
 *      answer that mints authored memories under the WRITING session and marks
 *      the old one; an empty answer that closes it too; B3's retention reading
 *      both marks;
 *   3. the sweep — off without the knob, on with it and a key; it skips what
 *      the next session wrote up and marks what it swept, quarantine included;
 *   4. doctor — the `Crash write-up` line.
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
import { WRITE_UP_ASK_COUNT_KEY, WRITE_UP_ASK_DATE_KEY, WRITE_UP_OPEN } from "../src/adapters/claude-code/hooks.js";
import { API_KEY_ENV, TUNABLES, loadConfig } from "../src/adapters/claude-code/config.js";
import type { AdapterConfig } from "../src/adapters/claude-code/config.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/server.js";
import {
  WRITE_UP_PART_BYTES,
  readSession,
  readWriteUpProgress,
  recordSession,
  writeUpParts,
  writeUpSources,
} from "../src/adapters/sessions.js";
import { ALREADY_AUTHORED_MARK } from "../src/core/remember/index.js";

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

/** Point `live` at the oldest owed session, then fetch it through the door. */
async function pointAndFetch(live: string): Promise<{ s: McpServer; fetched: Record<string, unknown> }> {
  const pointer = start(live).ask ?? "";
  const ended = /writeUp: ([A-Za-z0-9._-]+)/.exec(pointer)?.[1] as string;
  expect(ended).toBeDefined();
  const s = server();
  const fetched = payload(await s.call("session_end", { session: live, writeUp: ended }));
  return { s, fetched };
}

const MEMORY = { content: "The reservoir loop holds pressure only when the relief valve is seated first.", kind: "fact" };

/** B3's retention, read now and after the seven days. */
function verdicts(c: Counterpart): { now: Map<string, string>; later: Map<string, string> } {
  const sources = writeUpSources(c.store, FIRST_ASK);
  const at = (t: number): Map<string, string> =>
    new Map(planRetention(new SpanBuffer({ dir: storeDir, now: () => t }), sources).map((h) => [h.session, h.verdict]));
  return { now: at(Date.now()), later: at(Date.now() + 8 * DAY) };
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the pointer: the next session start in that project is pointed at it", () => {
  test("one ended-unwritten session (asked, never answered) → exactly one pointer, and no words in it", () => {
    const s = seeder();
    ended(s, "old-1", { at: Date.now() - 2 * DAY, bytes: 900 });
    s.done();

    const out = start("new-1");
    const ask = out.ask ?? "";
    expect(occurrences(ask, WRITE_UP_OPEN)).toBe(1);
    expect(ask).toContain("1 earlier session in this project ended before it was written up");
    expect(ask).toContain("The oldest is old-1");
    // The call that fetches it, with THIS session as `session`.
    expect(ask).toContain("session: new-1, writeUp: old-1 and no memories");
    expect(ask).toContain("memories: [] if nothing is");
    // A POINTER: none of the words ride beside the wake.
    expect(ask).not.toContain(wordsOf("old-1 #0", 40));
    expect(Buffer.byteLength(ask, "utf8")).toBeLessThan(600);
    expect(out.injection).not.toContain(WRITE_UP_OPEN);
    // The marks the door reads.
    expect(readSession(storeDir, "new-1")?.writeUpPointer).toBe("old-1");
    const c = Counterpart.open({ dir: storeDir, owner: true });
    expect(readWriteUpProgress(c.store)["old-1"]).toMatchObject({ parts: 1, done: 0, chunk: WRITE_UP_PART_BYTES });
    c.close();

    // A compaction re-firing SessionStart in the same session points at nothing.
    expect(start("new-1").ask).toBeNull();
  });

  test("a session BELOW the pacer's threshold owes nothing and is never pointed at", () => {
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

  test("a CRASHED session is pointed at once it is silent past the registry's window — never while it may still be running", () => {
    const s = seeder();
    ended(s, "crash-now", { at: Date.now() - 60_000, end: "crash" });
    s.done();
    expect(start("new-1").ask).toBeNull();

    const t = seeder();
    ended(t, "crash-old", { at: Date.now() - 6 * HOUR, end: "crash" });
    t.done();
    const ask = start("new-2").ask ?? "";
    expect(ask).toContain("The oldest is crash-old");
    expect(ask).not.toContain("crash-now");
  });

  test("a session from ANOTHER project is not this project's to write up", () => {
    const s = seeder();
    ended(s, "far-1", { at: Date.now() - 2 * DAY, scope: OTHER });
    s.done();
    expect(start("new-1").ask).toBeNull();
    expect(start("new-2", { scope: OTHER }).ask ?? "").toContain("The oldest is far-1");
  });

  test("two owing sessions: the OLDEST first, the other at the next start — and round again when neither is written", () => {
    const s = seeder();
    ended(s, "younger", { at: Date.now() - 1 * DAY });
    ended(s, "older", { at: Date.now() - 3 * DAY });
    s.done();

    const first = start("new-1").ask ?? "";
    expect(first).toContain("2 earlier sessions in this project ended before they were written up");
    expect(first).toContain("The oldest is older");
    expect(start("new-2").ask ?? "").toContain("The oldest is younger");
    newDay();
    expect(start("new-3").ask ?? "").toContain("The oldest is older");
  });

  test("a 60 KB session is 'part 1 of N' — the same N at every start, N from the ~24 KB part", () => {
    const s = seeder();
    ended(s, "long-1", { at: Date.now() - 2 * DAY, bytes: 60 * 1024, captures: 12 });
    s.done();
    const one = start("new-1").ask ?? "";
    const m = /part 1 of (\d+) of its words/.exec(one);
    const n = Number(m?.[1]);
    expect(n).toBe(3);
    expect(one).toContain("~60 KB");
    expect(start("new-2").ask ?? "").toContain(`part 1 of ${String(n)}`);
    // The day's allowance is two: the third start that day is not pointed.
    const spent = start("new-3");
    expect(spent.ask).toBeNull();
    expect(spent.events).toContain("adapter.writeup.skipped");
  });

  test("it fits beside a 9 KB wake — the owner's — and defers only past the host's own cap", () => {
    const s = seeder();
    ended(s, "old-1", { at: Date.now() - 2 * DAY });
    s.done();
    const a = openAdapter(config({ injectionBudgetBytes: 9000 }), {
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
      scope: { mode: "on", matched: PROJ, entry: null },
    });
    try {
      const deliver = (a as unknown as { deliverWriteUpAsk(i: HookInput, spent: number): string }).deliverWriteUpAsk.bind(a);
      // Past the host's cap (9,500 of its 10,000): deferred, nothing claimed.
      expect(deliver({ sessionId: "full", scope: PROJ }, 9_300)).toBe("");
      expect(a.events("adapter.writeup.deferred").length).toBe(1);
      expect(readSession(storeDir, "full")).toBeNull();
      // A 9,038-byte wake — the one the owner measured — is pointed.
      const text = deliver({ sessionId: "nine-k", scope: PROJ }, 9_038);
      expect(text).toContain("The oldest is old-1");
      expect(9_038 + Buffer.byteLength(`\n\n${text}`, "utf8")).toBeLessThanOrEqual(TUNABLES.WRITE_UP_HOST_OUTPUT_CHARS);
    } finally {
      a.counterpart.close();
    }
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

  test("with the API sweep ON, a crashed session is the sweep's — a normally ended one is still pointed at", () => {
    const s = seeder();
    ended(s, "crashed", { at: Date.now() - 3 * DAY, end: "crash" });
    ended(s, "unanswered", { at: Date.now() - 1 * DAY, end: "normal" });
    s.done();
    process.env[API_KEY_ENV] = "sk-ant-test-not-a-real-key";
    const ask = start("new-1", { config: { crashWriteUp: "api" } }).ask ?? "";
    expect(ask).toContain("The oldest is unanswered");
    expect(ask).not.toContain("crashed");
  });

  test("a throw anywhere inside the pointer costs the pointer and nothing else", () => {
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
    expect(parts.join("")).toContain("a".repeat(40));
    expect(parts.join("").split("é").length - 1).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the door: `session_end` with `writeUp`", () => {
  function seeded(): void {
    const s = seeder();
    ended(s, "old-1", { at: Date.now() - 2 * DAY });
    ended(s, "old-2", { at: Date.now() - 1 * DAY });
    ended(s, "short-1", { at: Date.now() - 1 * DAY, asked: false });
    ended(s, "far-1", { at: Date.now() - 1 * DAY, scope: OTHER });
    s.done();
    // A second session running in this project, right now.
    recordSession(storeDir, { sessionId: "live-2", scope: PROJ, phase: "start" });
  }

  test("each refusal by name — and a refusal writes nothing", async () => {
    seeded();
    expect(start("new-1").ask ?? "").toContain("The oldest is old-1");
    const s = server();
    const call = async (args: Record<string, unknown>): Promise<Record<string, unknown>> =>
      payload(await s.call("session_end", { session: "new-1", memories: [MEMORY], ...args }));
    const fetch = async (args: Record<string, unknown>): Promise<Record<string, unknown>> =>
      payload(await s.call("session_end", { session: "new-1", ...args }));

    expect((await fetch({ writeUp: "live-2" }))["reason"]).toBe("live-session");
    expect((await fetch({ writeUp: "new-1" }))["reason"]).toBe("live-session");
    expect((await fetch({ writeUp: "nobody-at-all" }))["reason"]).toBe("unknown-session");
    expect((await fetch({ writeUp: "../../etc" }))["reason"]).toBe("unknown-session");
    expect((await fetch({ writeUp: "far-1" }))["reason"]).toBe("other-project");
    expect(await fetch({ writeUp: "short-1" })).toMatchObject({ reason: "owes-nothing", why: "below-threshold" });
    // Owed, in this project — and not the one THIS session was pointed at.
    expect((await fetch({ writeUp: "old-2" }))["reason"]).toBe("not-asked");
    // An answer before any fetch.
    expect((await call({ writeUp: "old-1" }))["reason"]).toBe("not-asked");
    expect((await call({ writeUp: "old-1", memories: [] }))["reason"]).toBe("not-asked");
    expect((await call({ writeUp: "old-1", handoff: "where it stands" }))["reason"]).toBe("handoff-not-accepted");
    // Now fetched: the wrong part and a malformed batch.
    expect((await fetch({ writeUp: "old-1" }))["reason"]).toBe("part");
    expect((await call({ writeUp: "old-1", part: 2 }))["reason"]).toBe("wrong-part");
    expect((await call({ writeUp: "old-1", memories: "the valve" }))["reason"]).toBe("memories-required");

    // Nothing landed from any of it.
    const records = s.counterpart.spans.proposalRecords<ProposalRecord>(PROJ).filter((p) => p.session === "new-1");
    expect(records).toEqual([]);
    expect(s.counterpart.spans.writeUps(PROJ)).toEqual([]);
    expect(readSession(storeDir, "new-1")?.nothingNewAt).toBeUndefined();
  });

  test("a fetch returns the words — never the replies — and fetching again hands back the same part", async () => {
    seeded();
    const { s, fetched } = await pointAndFetch("new-1");
    expect(fetched).toMatchObject({ reason: "part", ended: "old-1", part: 1, of: 1 });
    expect(String(fetched["text"])).toContain(wordsOf("old-1 #0", 60));
    expect(String(fetched["text"])).not.toContain("understood.");
    expect(String(fetched["next"])).toContain("writeUp: old-1, part: 1");
    expect(readSession(storeDir, "new-1")?.writeUpFor).toEqual({ session: "old-1", part: 1 });
    const again = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1" }));
    expect(again).toMatchObject({ reason: "part", part: 1 });
  });

  test("an answer mints authored memories under the WRITING session, marks the old one, and a second is refused", async () => {
    seeded();
    const { s } = await pointAndFetch("new-1");
    const out = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", part: 1, memories: [MEMORY] }));
    expect(out).toMatchObject({ reason: "written-up", answer: "memories", ended: "old-1", part: 1, of: 1, deposited: 1, marked: true });

    const records = s.counterpart.spans.proposalRecords<ProposalRecord>(PROJ).filter((p) => p.accepted === true);
    const mine = records.filter((p) => p.session === "new-1");
    expect(mine.length).toBe(1);
    expect(mine[0]?.source).toBe("session-end");
    expect(records.some((p) => p.session === "old-1")).toBe(false);
    const id = (out["outcomes"] as { id?: string }[])[0]?.id as string;
    expect(s.counterpart.store.read(id).doc.body).toContain("relief valve");
    expect(s.counterpart.store.row(id)).toMatchObject({ source: "authored", origin_session: "new-1" });

    expect(s.counterpart.spans.writeUps(PROJ).map((w) => [w.session, w.by])).toEqual([["old-1", "next-session"]]);
    expect(readWriteUpProgress(s.counterpart.store)["old-1"]).toBeUndefined();
    expect(readSession(storeDir, "new-1")?.writeUpFor).toEqual({ session: "old-1", part: 1, answer: "memories" });

    // IDEMPOTENT: a second write-up of the same id is refused, fetch or answer.
    expect(payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", memories: [MEMORY] }))["reason"]).toBe("already-written-up");
    expect(payload(await s.call("session_end", { session: "new-1", writeUp: "old-1" }))["reason"]).toBe("already-written-up");

    // B3's retention reads the mark: kept while young, deletable after 7 days —
    // and the one never written up is still kept, however old.
    const v = verdicts(s.counterpart);
    expect(v.now.get("old-1")).toBe("kept-young");
    expect(v.later.get("old-1")).toBe("deleted");
    expect(v.later.get("old-2")).toBe("kept-owed");
  });

  test("an EMPTY batch after the fetch is a real answer: nothing minted, the session marked, and retention reads it", async () => {
    seeded();
    const { s } = await pointAndFetch("new-1");
    const out = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", memories: [] }));
    expect(out).toMatchObject({ reason: "written-up", answer: "nothing-new", deposited: 0, marked: true });
    expect(s.counterpart.spans.proposalRecords<ProposalRecord>(PROJ).filter((p) => p.session === "new-1")).toEqual([]);
    expect(s.counterpart.spans.writeUps(PROJ).map((w) => [w.session, w.by])).toEqual([["old-1", "next-session"]]);
    // The reason is recorded where the writing session's answer is kept.
    expect(readSession(storeDir, "new-1")?.writeUpFor).toEqual({ session: "old-1", part: 1, answer: "nothing-new" });
    // And the ordinary session_end's "nothing new" mark is NOT set on the writer.
    expect(readSession(storeDir, "new-1")?.nothingNewAt).toBeUndefined();
    const v = verdicts(s.counterpart);
    expect(v.now.get("old-1")).toBe("kept-young");
    expect(v.later.get("old-1")).toBe("deleted");
  });

  test("a batch the gate refuses entirely lands nothing and marks nothing", async () => {
    seeded();
    const { s } = await pointAndFetch("new-1");
    const out = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", memories: [{ content: "" }] }));
    expect(out["reason"]).toBe("nothing-landed");
    expect(s.counterpart.spans.writeUps(PROJ)).toEqual([]);
  });

  test("a 60 KB session: one part per session start, fetched and answered, and only the LAST part marks it", async () => {
    const seed = seeder();
    ended(seed, "long-1", { at: Date.now() - 2 * DAY, bytes: 60 * 1024, captures: 12 });
    seed.done();

    let of = 0;
    for (let part = 1; ; part++) {
      newDay();
      const live = `writer-${String(part)}`;
      const { s, fetched } = await pointAndFetch(live);
      expect(fetched).toMatchObject({ reason: "part", part });
      if (of === 0) of = Number(fetched["of"]);
      expect(fetched["of"]).toBe(of);
      expect(Buffer.byteLength(String(fetched["text"]), "utf8")).toBeLessThanOrEqual(WRITE_UP_PART_BYTES);
      // Alternate the two answers: memories on odd parts, nothing-new on even.
      const memories = part % 2 === 1 ? [{ content: `Part ${String(part)}: the valve is seated first.`, kind: "fact" }] : [];
      const out = payload(await s.call("session_end", { session: live, writeUp: "long-1", part, memories }));
      // The same session is not handed the next part: that is a later start's.
      const more = payload(await s.call("session_end", { session: live, writeUp: "long-1" }));
      if (part < of) {
        expect(out).toMatchObject({ reason: "part-written", part, of, recorded: true });
        expect(more["reason"]).toBe("part-already-written");
        expect(s.counterpart.spans.writeUps(PROJ)).toEqual([]);
        s.counterpart.close();
        open.splice(open.indexOf(s.counterpart), 1);
        continue;
      }
      expect(out).toMatchObject({ reason: "written-up", part: of, of, marked: true });
      expect(more["reason"]).toBe("already-written-up");
      expect(s.counterpart.spans.writeUps(PROJ).map((w) => w.session)).toEqual(["long-1"]);
      break;
    }
    expect(of).toBe(3);
    newDay();
    expect(start("after").ask).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the sweep is an opt-in upgrade, and it and the write-up know each other", () => {
  function crashed(id = "crashed", daysAgo = 2): void {
    const s = seeder();
    ended(s, id, { at: Date.now() - daysAgo * DAY, end: "crash" });
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
  const KEY = { [API_KEY_ENV]: "sk-ant-test-not-a-real-key" };
  function gateReason(): unknown {
    const c = Counterpart.open({ dir: storeDir, owner: true });
    try {
      const rows = c.store.eventLog({ name: SWEEP_GATE_EVENT, limit: 5 });
      return JSON.parse(rows[rows.length - 1]?.payload ?? "{}")["reason"];
    } finally {
      c.close();
    }
  }
  function marks(): [string, string][] {
    const c = Counterpart.open({ dir: storeDir, owner: true });
    try {
      return c.spans.writeUps(PROJ).map((w) => [w.session, w.by]);
    } finally {
      c.close();
    }
  }

  test("WITHOUT the knob, a key alone does not run it — the gate row says `not-opted-in` and no socket opens", async () => {
    crashed();
    let calls = 0;
    const events: Record<string, unknown>[] = [];
    const report = await runOnce({
      config: config(),
      date: "2026-09-23",
      env: KEY,
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
    expect(gateReason()).toBe("not-opted-in");
  });

  test("the knob with NO key: `no-credential` on the row, the next session's job", async () => {
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
    expect(gateReason()).toBe("no-credential");
  });

  test("WITH the knob and a key it runs — and marks the session it swept, `by: \"api\"`", async () => {
    crashed();
    process.env[API_KEY_ENV] = KEY[API_KEY_ENV];
    let calls = 0;
    const report = await runOnce({
      config: config({ crashWriteUp: "api" }),
      date: "2026-09-23",
      env: KEY,
      fetch: async () => {
        calls += 1;
        return reply();
      },
    });
    expect(calls).toBeGreaterThan(0);
    expect(report.swept).toBeGreaterThan(0);
    expect(marks()).toEqual([["crashed", "api"]]);
  });

  test("a session the next session already wrote up is NOT read again: alone, no model call; beside another, marked as authored", async () => {
    crashed("written", 3);
    // Written up by the next session, the keyless way.
    const { s } = await pointAndFetch("writer");
    expect(payload(await s.call("session_end", { session: "writer", writeUp: "written", memories: [MEMORY] }))["marked"]).toBe(true);
    s.counterpart.close();
    open.splice(open.indexOf(s.counterpart), 1);

    // Alone: the owner turns the API sweep on, and it makes no call for it.
    process.env[API_KEY_ENV] = KEY[API_KEY_ENV];
    let calls = 0;
    await runOnce({
      config: config({ crashWriteUp: "api" }),
      date: "2026-09-24",
      env: KEY,
      fetch: async () => {
        calls += 1;
        throw new Error("the sweep re-read a session that was written up");
      },
    });
    expect(calls).toBe(0);
  });

  test("beside a session it has not seen, the written-up one's words reach the model marked as already authored", async () => {
    crashed("written", 3);
    const { s } = await pointAndFetch("writer");
    expect(payload(await s.call("session_end", { session: "writer", writeUp: "written", memories: [] }))["marked"]).toBe(true);
    s.counterpart.close();
    open.splice(open.indexOf(s.counterpart), 1);
    crashed("unseen", 2);

    process.env[API_KEY_ENV] = KEY[API_KEY_ENV];
    const prompts: string[] = [];
    await runOnce({
      config: config({ crashWriteUp: "api" }),
      date: "2026-09-24",
      env: KEY,
      fetch: async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
        prompts.push(body.messages[0]?.content ?? "");
        return reply();
      },
    });
    expect(prompts.length).toBe(1);
    const prompt = prompts[0] as string;
    const before = (tag: string): string => {
      const at = prompt.indexOf(wordsOf(tag, 30));
      return prompt.slice(Math.max(0, at - ALREADY_AUTHORED_MARK.length - 2), at);
    };
    expect(before("written #0")).toContain(ALREADY_AUTHORED_MARK);
    expect(before("unseen #0")).not.toContain(ALREADY_AUTHORED_MARK);
    // The unseen one is marked by the sweep; the written one keeps its own mark.
    expect(marks()).toEqual([
      ["written", "next-session"],
      ["unseen", "api"],
    ]);
  });

  test("a crashed session the sweep QUARANTINES is marked `api` too — it no longer stays owed; a retry is not marked", async () => {
    crashed();
    process.env[API_KEY_ENV] = KEY[API_KEY_ENV];
    const failing = async (): Promise<Response> => new Response("upstream is down", { status: 500 });
    const owes = (): boolean | undefined => {
      const c = Counterpart.open({ dir: storeDir, owner: true });
      try {
        return planRetention(c.spans, writeUpSources(c.store, FIRST_ASK)).find((h) => h.session === "crashed")?.owes;
      } finally {
        c.close();
      }
    };
    let quarantined = 0;
    for (const date of ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]) {
      const report = await runOnce({ config: config({ crashWriteUp: "api" }), date, env: KEY, fetch: failing });
      expect(report.ran).toBe(true);
      const c = Counterpart.open({ dir: storeDir, owner: true });
      quarantined = c.spans.quarantined(PROJ).length;
      c.close();
      if (quarantined > 0) break;
      // Put back for a retry: not finished, not marked, still owed.
      expect(marks()).toEqual([]);
      expect(owes()).toBe(true);
    }
    expect(quarantined).toBeGreaterThan(0);
    expect(marks()).toEqual([["crashed", "api"]]);
    expect(owes()).toBe(false);
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
