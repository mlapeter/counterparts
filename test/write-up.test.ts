/**
 * THE NEXT-SESSION WRITE-UP — roadmap C2, owner's decisions of 2026-09-23.
 *
 * A session that ended before it was written up (it owes, by
 * `core/coverage/`'s rule since 2026-09-30) is written up by the NEXT session
 * that starts in its project: the SessionStart
 * hook puts a short POINTER beside the wake, the assistant FETCHES the words
 * through a `writeUp` field on `session_end` (no memories), ANSWERS with
 * memories — or `[]`, nothing worth keeping — and the last part marks the old
 * session written up through B3's seam, so its seven-day retention clock
 * starts. The key-based sweep becomes an opt-in (`crashWriteUp: "api"`), and it
 * and the write-up know each other's marks.
 *
 * The acceptance, one describe each:
 *   1. the pointer — one owing session, exactly one pointer; a small stretch,
 *      the same and one sentence more; two, oldest first; a 60 KB session, "part 1 of N"; and it
 *      fits beside a 9 KB wake;
 *   2. the door — every refusal by name; a fetch that returns the words; an
 *      answer that mints authored memories under the WRITING session and marks
 *      the old one; an empty answer that closes it too; B3's retention reading
 *      both marks;
 *   3. the sweep — off without the knob, on with it and a key; it skips what
 *      the next session wrote up, and marks what it swept only when every word
 *      in every project was read — never a quarantined session;
 *   4. doctor — the `Write-ups` line (#192's `Crash write-up`).
 *
 * Hermetic: a fresh temp directory per test, removed after. The only key any
 * test holds is a fake string, set and restored around the one test that
 * needs the sweep to run.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, SWEEP_GATE_EVENT } from "../src/core/counterpart.js";
import { SpanBuffer, planRetention } from "../src/core/remember/index.js";
import type { ProposalRecord } from "../src/core/remember/proposals.js";
import { SELF_TUNABLES } from "../src/core/self/index.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { ClaudeCodeAdapter, HookInput } from "../src/adapters/claude-code/hooks.js";
import { WRITE_UP_ASK_COUNT_KEY, WRITE_UP_ASK_DATE_KEY, WRITE_UP_OPEN, WRITE_UP_SHORT_LINE } from "../src/adapters/claude-code/hooks.js";
import { TUNABLES, loadConfig } from "../src/adapters/config.js";
import type { AdapterConfig } from "../src/adapters/config.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";

/** How old a debt the old line turned amber on — now the stretch is from
 *  yesterday or earlier (`Write-ups`, 2026-09-30); kept as a length of time. */
const WRITE_UP_WAIT_DAYS = 3;
import { openServer, toolSpec } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/server.js";
import {
  WRITE_UP_PART_BYTES,
  markNothingNew,
  progressKey,
  saveWriteUpProgress,
  writeUpEntries,
  readSession,
  readWriteUpPointer,
  readWriteUpProgress,
  recordSession,
  writeUpParts,
  writeUpSources,
} from "../src/adapters/sessions.js";
import { keyFor } from "../src/core/remember/index.js";
import { CLAIM_NOTHING_NEW, claimUnwritten } from "../src/core/coverage/index.js";
import { localDate } from "../src/core/time.js";
import { ALREADY_AUTHORED_MARK } from "../src/core/remember/index.js";
import { CONTRADICTION_HELD_EVENT, CONTRADICTION_SETTLED_EVENT } from "../src/core/contradictions.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Eight minutes between one piece of a seeded session and the next: three
 *  pieces span sixteen minutes, past the floor's fifteen. */
const PIECE_GAP = 8 * 60_000;
/** Local midnight today — the date `core/coverage/` keys "at work" on. */
function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** A moment today, late enough before now that a seeded session's pieces sit today. */
function earlierToday(): number {
  return Math.max(todayStart() + 60_000, Date.now() - 45 * 60_000);
}
/** The person's today, as doctor is handed it. */
const TODAY = (): string => localDate(Date.now());
const FIRST_ASK = {
  turns: SELF_TUNABLES.FIRST_ASK_TURNS,
  textBytes: SELF_TUNABLES.FIRST_ASK_TEXT_BYTES,
};

let root: string;
let storeDir: string;
let PROJ: string;
let OTHER: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-writeup-")));
  storeDir = join(root, "store");
  PROJ = join(root, "proj");
  OTHER = join(root, "other");
  mkdirSync(PROJ, { recursive: true });
  mkdirSync(OTHER, { recursive: true });
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
 * (a crash has no end on this host). Its pieces are five minutes apart, and
 * six of them by default, so what it left unwritten is past the floor and not
 * small (`core/coverage/`, 2026-09-30); `asked: false` leaves three — a small
 * stretch, which the pointer says one line is enough for. `answered` writes a
 * chapter, which writes the stretch up.
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
    /** False: no replies captured (a test about part sizes). */
    replies?: boolean;
  },
): void {
  const scope = opts.scope ?? PROJ;
  const captures = opts.captures ?? (opts.asked === false ? 3 : 6);
  const per = Math.ceil((opts.bytes ?? 600) / captures);
  recordSession(storeDir, { sessionId: id, scope, phase: "start", at: opts.at });
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (let i = 0; i < captures; i++) {
    s.set(opts.at + i * PIECE_GAP);
    turns.push({ role: "user", text: wordsOf(`${id} #${String(i)}`, per) });
    if (opts.replies !== false) turns.push({ role: "assistant", text: `(${id} #${String(i)}) understood.` });
    s.c.captureSpans({ session: id, scope, turns: [...turns] });
  }
  if (opts.asked !== false) expect(s.c.episodeAsk(id, { turns: 9, bytes: 6_000 }).asked).toBe(true);
  s.c.boundary({ session: id, scope, kind: "stop" });
  recordSession(storeDir, { sessionId: id, scope, phase: "boundary", at: opts.at + captures * PIECE_GAP });
  if (opts.answered === true) {
    expect(s.c.appendEpisode(id, `A chapter from ${id}.`, { scope }).appended).toBe(true);
  }
  if ((opts.end ?? "normal") === "normal") {
    s.c.boundary({ session: id, scope, kind: "session-end" });
    recordSession(storeDir, { sessionId: id, scope, phase: "end", at: opts.at + captures * PIECE_GAP + 1 });
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

/**
 * One session that talked in TWO projects: three pieces in each, eight minutes
 * apart and interleaved, so the share left in either after the other is
 * written up is still past the floor on its own.
 */
function multiIn(seed: { c: Counterpart; set(at: number): void }, at: number, here: string, there: string): void {
  const inHere: { role: "user"; text: string }[] = [];
  const inThere: { role: "user"; text: string }[] = [];
  for (let i = 0; i < 3; i++) {
    seed.set(at + 2 * i * PIECE_GAP);
    inHere.push({ role: "user", text: wordsOf(`${here}-${String(i)}`, 300) });
    seed.c.captureSpans({ session: "multi", scope: PROJ, turns: [...inHere] });
    seed.set(at + (2 * i + 1) * PIECE_GAP);
    inThere.push({ role: "user", text: wordsOf(`${there}-${String(i)}`, 300) });
    seed.c.captureSpans({ session: "multi", scope: OTHER, turns: [...inThere] });
  }
}

/** B3's retention, read now and after the seven days. */
function verdicts(c: Counterpart): { now: Map<string, string>; later: Map<string, string> } {
  const sources = writeUpSources(c.store);
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
    expect(ask).toContain("An earlier session here ended before it was written up");
    // The call that fetches it, with THIS session as `session` — and the ended
    // session named ONCE (PR #192 review, MAJOR 1).
    expect(ask).toContain("session: new-1, writeUp: old-1 and no memories");
    expect(occurrences(ask, "old-1")).toBe(1);
    expect(ask).toContain("(or memories: [])");
    // A POINTER: none of the words ride beside the wake.
    expect(ask).not.toContain(wordsOf("old-1 #0", 40));
    expect(Buffer.byteLength(ask, "utf8")).toBeLessThan(600);
    expect(out.injection).not.toContain(WRITE_UP_OPEN);
    // The marks the door reads.
    expect(readSession(storeDir, "new-1")?.writeUpPointer).toBe("old-1");
    const c = Counterpart.open({ dir: storeDir, owner: true });
    expect(readWriteUpProgress(c.store)[progressKey("old-1", PROJ)]).toMatchObject({ parts: 1, done: 0, chunk: WRITE_UP_PART_BYTES });
    expect(readWriteUpPointer(c.store)).toMatchObject({ outcome: "pointed" });
    c.close();

    // A compaction re-firing SessionStart in the same session points at nothing.
    expect(start("new-1").ask).toBeNull();
  });

  test("a SMALL owed stretch — under six pieces — gets the same pointer and one plain sentence more (2026-09-29; small since 2026-09-30)", () => {
    const s = seeder();
    ended(s, "short-1", { at: Date.now() - 2 * DAY, bytes: 200, asked: false });
    s.done();
    const ask = start("new-1").ask ?? "";
    expect(ask).toContain("session: new-1, writeUp: short-1 and no memories");
    expect(ask).toContain(WRITE_UP_SHORT_LINE);
    // A debt like any other since 2026-09-30 (`core/coverage/`): it owes, and it is small.
    const c = Counterpart.open({ dir: storeDir, owner: true });
    const held = planRetention(c.spans, writeUpSources(c.store)).find((h) => h.session === "short-1");
    c.close();
    expect(held).toMatchObject({ owes: true, small: true });
  });

  test("a session below the threshold that ANSWERED — a chapter — owes nothing, short or full", () => {
    const s = seeder();
    ended(s, "short-done", { at: Date.now() - 2 * DAY, bytes: 200, asked: false, answered: true });
    s.done();
    expect(start("new-1").ask).toBeNull();
  });

  test("a session that ended normally AND answered owes nothing either", () => {
    const s = seeder();
    ended(s, "done-1", { at: Date.now() - 2 * DAY, answered: true });
    s.done();
    expect(start("new-1").ask).toBeNull();
  });

  test("a session with NO END is pointed at once it has captured nothing since the date changed — no silence window (2026-09-30)", () => {
    const s = seeder();
    // Talking today and not ended: at work, whatever the silence.
    ended(s, "open-today", { at: earlierToday(), end: "crash" });
    s.done();
    expect(start("new-1").ask).toBeNull();

    // Left open last night: quiet since the date changed, and it owes.
    const t = seeder();
    ended(t, "open-overnight", { at: todayStart() - 3 * HOUR, end: "crash" });
    t.done();
    const ask = start("new-2").ask ?? "";
    expect(ask).toContain("writeUp: open-overnight");
    expect(ask).not.toContain("open-today");
  });

  test("the review's idle repro: a session open a day that WROTE ITS STRETCH UP — a chapter, or \"nothing new\" — is never offered (MAJOR 3)", async () => {
    // Opened yesterday morning, not "now minus a day": its pieces run forty
    // minutes past `at`, and in the last forty minutes of a day that put the
    // last one in today, where the session reads as still at work.
    const opened = todayStart() - DAY + 3 * HOUR;
    const s = seeder();
    // Answered with a chapter, still open in the registry (no end).
    ended(s, "idle-1d", { at: opened, end: "crash", answered: true });
    s.done();
    // Answered with "nothing new" instead of a chapter reads the same: since
    // 2026-09-30 that answer claims the session's pieces.
    const t = seeder();
    ended(t, "idle-nn", { at: opened, end: "crash" });
    expect(markNothingNew(storeDir, "idle-nn", opened + 60_000)).not.toBeNull();
    claimUnwritten(t.c.spans, { session: "idle-nn", scope: PROJ, by: CLAIM_NOTHING_NEW, ref: "idle-nn" });
    t.done();
    const c = Counterpart.open({ dir: storeDir, owner: true });
    const plan = planRetention(c.spans, writeUpSources(c.store));
    c.close();
    expect(plan.filter((h) => h.owes)).toEqual([]);
    expect(start("new-1").ask).toBeNull();
    // And the door agrees: both owe nothing to another session.
    recordSession(storeDir, { sessionId: "new-9", scope: PROJ, phase: "start" });
    const s2 = server();
    for (const id of ["idle-1d", "idle-nn"]) {
      expect(payload(await s2.call("session_end", { session: "new-9", writeUp: id }))).toMatchObject({
        reason: "owes-nothing",
        why: "answered",
      });
    }
  });

  test("a session from ANOTHER project is not this project's to write up", () => {
    const s = seeder();
    ended(s, "far-1", { at: Date.now() - 2 * DAY, scope: OTHER });
    s.done();
    expect(start("new-1").ask).toBeNull();
    expect(start("new-2", { scope: OTHER }).ask ?? "").toContain("writeUp: far-1");
  });

  test("two owing sessions: the OLDEST first, the other at the next start — and round again when neither is written", () => {
    const s = seeder();
    ended(s, "younger", { at: Date.now() - 1 * DAY });
    ended(s, "older", { at: Date.now() - 3 * DAY });
    s.done();

    const first = start("new-1").ask ?? "";
    expect(first).toContain("2 earlier sessions here ended before they were written up");
    expect(first).toContain("writeUp: older");
    expect(start("new-2").ask ?? "").toContain("writeUp: younger");
    newDay();
    expect(start("new-3").ask ?? "").toContain("writeUp: older");
  });

  test("a 60 KB session is 'part 1 of N' — the same N at every start, N from the ~24 KB part", () => {
    const s = seeder();
    ended(s, "long-1", { at: Date.now() - 2 * DAY, bytes: 60 * 1024, captures: 12 });
    s.done();
    const one = start("new-1").ask ?? "";
    const m = /, part 1 of (\d+)\./.exec(one);
    const n = Number(m?.[1]);
    expect(n).toBe(3);
    // ~60 KB said to it, and its twelve short replies (2026-10-01).
    expect(one).toContain("~61 KB");
    expect(start("new-2").ask ?? "").toContain(`part 1 of ${String(n)}`);
    // The day's allowance is two: the third start that day is not pointed.
    const spent = start("new-3");
    expect(spent.ask).toBeNull();
    expect(spent.events).toContain("adapter.writeup.skipped");
  });

  test("with host-length ids it fits beside the owner's 9,038-byte wake, and a deferral is durable and read by doctor (MAJOR 1)", () => {
    const OLD = "0d3f7a52-9c1e-4b8e-9a51-2f7c1f0e9b11";
    const LIVE = "7e1c2b90-44aa-4f0b-8c3d-5a6b7c8d9e0f";
    const FULL = "c0ffee00-1111-4222-8333-944455556666";
    const s = seeder();
    ended(s, OLD, { at: Date.now() - 2 * DAY, bytes: 30 * 1024, captures: 6 });
    s.done();
    const a = openAdapter(config({ injectionBudgetBytes: 9000 }), {
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
      scope: { mode: "on", matched: PROJ, entry: null },
    });
    try {
      const deliver = (a as unknown as { deliverWriteUpAsk(i: HookInput, spent: number): string }).deliverWriteUpAsk.bind(a);
      const text = deliver({ sessionId: LIVE, scope: PROJ }, 9_038);
      expect(text).toContain(`writeUp: ${OLD}`);
      const bytes = Buffer.byteLength(`\n\n${text}`, "utf8");
      // The measured size with host ids, and the plain-stdout cap it answers to.
      expect(bytes).toBeLessThan(480);
      expect(9_038 + bytes).toBeLessThanOrEqual(TUNABLES.HOST_OUTPUT_CHARS);
      expect(readWriteUpPointer(a.counterpart.store)).toMatchObject({ outcome: "pointed", need: bytes, room: 10_000 - 9_038 });

      // Past the host's cap: deferred, nothing claimed, and the outcome is DURABLE.
      expect(deliver({ sessionId: FULL, scope: PROJ }, 9_800)).toBe("");
      expect(readSession(storeDir, FULL)).toBeNull();
      expect(readWriteUpPointer(a.counterpart.store)).toMatchObject({ outcome: "deferred", reason: "host-cap", room: 200 });
    } finally {
      a.counterpart.close();
    }
    // Doctor reads it and says the wake is too full, and by how much — never "open a session".
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    const f = doctorFindings({
      configPath: join(root, "claude-code.json"),
      configReason: "loaded",
      config: config(),
      dir: storeDir,
      store: c.store,
      today: TODAY(),
      refusals: {},
    }).find((x) => x.key === "crash-write-up");
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain("the pointer did not fit");
    expect(f?.detail).toMatch(/\d+ short\)/);
    expect(f?.fix).toContain("The wake is too full");
    expect(f?.fix).not.toContain("Open a session");
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

  test("a CRASHED session is pointed at like any other — there is no sweep to leave it to (keyless, 2026-09-24)", () => {
    const s = seeder();
    ended(s, "crashed", { at: Date.now() - 3 * DAY, end: "crash" });
    ended(s, "unanswered", { at: Date.now() - 1 * DAY, end: "normal" });
    s.done();
    // Oldest first: the crashed one.
    const ask = start("new-1").ask ?? "";
    expect(ask).toContain("writeUp: crashed");
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
      { text: "a".repeat(40), kept: false, jot: false, at: 1 },
      { text: "b".repeat(40), kept: true, jot: false, at: 2 },
      { text: "é".repeat(100), kept: false, jot: true, at: 3 },
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
    // A second session at work in this project, right now: it has said something today.
    recordSession(storeDir, { sessionId: "live-2", scope: PROJ, phase: "start" });
    const w = Counterpart.open({ dir: storeDir, owner: true });
    w.captureSpans({ session: "live-2", scope: PROJ, turns: [{ role: "user", text: "The live session's own first turn about the pump." }] });
    w.close();
  }

  test("each refusal by name — and a refusal writes nothing", async () => {
    seeded();
    expect(start("new-1").ask ?? "").toContain("writeUp: old-1");
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
    // Below the threshold it owes a SHORT write-up since 2026-09-29 — and it is
    // not the one this session was pointed at.
    expect((await fetch({ writeUp: "short-1" }))["reason"]).toBe("not-asked");
    // Owed, in this project — and not the one THIS session was pointed at.
    expect((await fetch({ writeUp: "old-2" }))["reason"]).toBe("not-asked");
    // Memories before any fetch.
    expect((await call({ writeUp: "old-1" }))["reason"]).toBe("not-asked");
    expect((await call({ writeUp: "old-1", handoff: "where it stands" }))["reason"]).toBe("handoff-not-accepted");
    // `memories: []` with no fetch on record IS the fetch (m2): a host that
    // honours `required` sends it.
    expect((await call({ writeUp: "old-1", memories: [] }))["reason"]).toBe("part");
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

  test("a fetch returns the words AND its replies, labelled (2026-10-01) — and fetching again hands back the same part", async () => {
    seeded();
    const { s, fetched } = await pointAndFetch("new-1");
    expect(fetched).toMatchObject({ reason: "part", ended: "old-1", part: 1, of: 1 });
    expect(String(fetched["text"])).toContain(wordsOf("old-1 #0", 60));
    expect(String(fetched["text"])).toContain("[its reply] (old-1 #0) understood.");
    expect(String(fetched["next"])).toContain("second-hand");
    expect(String(fetched["next"])).toContain("writeUp: old-1, part: 1");
    expect(readSession(storeDir, "new-1")?.writeUpFor).toEqual({ session: "old-1", part: 1 });
    const again = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1" }));
    expect(again).toMatchObject({ reason: "part", part: 1 });
  });

  test("an empty or null `writeUp` is no write-up: the ordinary answer lands (m1)", async () => {
    seeded();
    recordSession(storeDir, { sessionId: "plain-1", scope: PROJ, phase: "start" });
    const s = server();
    for (const writeUp of [null, ""]) {
      const out = payload(
        await s.call("session_end", {
          session: "plain-1",
          writeUp,
          memories: [{ content: `An ordinary answer (${String(writeUp)}): the valve is seated first.`, kind: "fact" }],
        }),
      );
      expect(out["deposited"]).toBe(1);
      expect(out["writeUp"]).toBeUndefined();
    }
  });

  test("the published schema does not require `memories` (m2)", () => {
    const schema = toolSpec("session_end")?.inputSchema as { required?: string[] };
    expect(schema.required ?? []).not.toContain("memories");
  });

  test("a write-up's memories claim NO coverage of the writer's own words; the ended session's words read as kept (MAJOR 4)", async () => {
    seeded();
    expect(start("new-1").ask ?? "").toContain("writeUp: old-1");
    // The writer speaks first — the natural order: the user's task, then the write-up.
    const w = Counterpart.open({ dir: storeDir, owner: true });
    w.captureSpans({
      session: "new-1",
      scope: PROJ,
      turns: [
        { role: "user", text: "Before anything else, the writer's own first turn about the pump schedule." },
        { role: "assistant", text: "Noted." },
      ],
    });
    w.close();
    const s = server();
    expect(payload(await s.call("session_end", { session: "new-1", writeUp: "old-1" }))["reason"]).toBe("part");
    expect(payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", memories: [MEMORY] }))["marked"]).toBe(true);
    const spans = s.counterpart.spans;
    const covered = spans.coveredHashes(PROJ);
    const writers = spans.spans(PROJ).filter((x) => x.session === "new-1");
    expect(writers.length).toBe(1);
    expect(writers.every((x) => !covered.has(x.hash))).toBe(true);
    const olds = spans.spans(PROJ).filter((x) => x.session === "old-1");
    expect(olds.length).toBeGreaterThan(0);
    expect(olds.every((x) => covered.has(x.hash))).toBe(true);
    // Claimed by the memory's OWN proposal, through core's `cover` seam — not
    // by a patch of the buffer — while the memory stays the writer's.
    const proposal = spans
      .proposalRecords<ProposalRecord>(PROJ)
      .find((p) => p.accepted === true && p.session === "new-1");
    expect(proposal).toBeDefined();
    const marks = spans.coverage(PROJ).filter((m) => m.session === "old-1");
    expect(marks.every((m) => m.proposalId === proposal?.id)).toBe(true);
    expect(proposal?.covers.sort()).toEqual(olds.map((x) => x.hash).sort());
    expect(Object.prototype.hasOwnProperty.call(spans, "claimCoverage")).toBe(false);
  });

  test("the `cover` seam: absent covers the depositor's own words, `{ session }` another's, `false` none", async () => {
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    const talk = (session: string, text: string): string => {
      c.captureSpans({ session, scope: PROJ, turns: [{ role: "user", text }] });
      return c.spans.spans(PROJ).find((x) => x.session === session)?.hash as string;
    };
    const mine = talk("depositor", "The depositor's own first turn, about the pump schedule.");
    const theirs = talk("other", "Another session's words about the relief valve.");
    const covered = (): Set<string> => c.spans.coveredHashes(PROJ);

    const none = await c.submitSessionEnd({ content: "A memory that covers nothing.", kind: "fact" }, { session: "depositor", scope: PROJ, cover: false });
    expect(none.deposited).toBe(true);
    expect(none.covers).toEqual([]);
    expect(covered().size).toBe(0);

    const other = await c.submitSessionEnd({ content: "A memory about the other session's words.", kind: "fact" }, { session: "depositor", scope: PROJ, cover: { session: "other" } });
    expect(other.covers).toEqual([theirs]);
    expect(covered().has(mine)).toBe(false);
    // The memory is still the depositor's.
    expect(c.store.row(other.memoryId as string)).toMatchObject({ origin_session: "depositor" });

    const own = await c.submitSessionEnd({ content: "An ordinary answer to its own ask.", kind: "fact" }, { session: "depositor", scope: PROJ });
    expect(own.covers).toEqual([mine]);
  });

  test("`submitJot` never takes `cover`: a jot always covers its own words", async () => {
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    c.captureSpans({ session: "jotter", scope: PROJ, turns: [{ role: "user", text: "The jotter's own words about the pump." }] });
    c.captureSpans({ session: "other", scope: PROJ, turns: [{ role: "user", text: "Another session's words about the valve." }] });
    const mine = c.spans.spans(PROJ).find((x) => x.session === "jotter")?.hash as string;
    const out = await c.submitJot({ content: "A jot about the pump.", kind: "fact" }, {
      session: "jotter",
      scope: PROJ,
      cover: { session: "other" },
    } as unknown as Parameters<Counterpart["submitJot"]>[1]);
    expect(out.covers).toEqual([mine]);
  });

  test("progress entries of a session that stopped owing another way are pruned at the next pointer", () => {
    const seed = seeder();
    ended(seed, "old-1", { at: Date.now() - 2 * DAY });
    ended(seed, "answered", { at: Date.now() - 2 * DAY, answered: true });
    seed.done();
    const c = Counterpart.open({ dir: storeDir, owner: true });
    saveWriteUpProgress(c.store, progressKey("answered", PROJ), { chunk: WRITE_UP_PART_BYTES, parts: 1, done: 0, handedAt: 1 });
    saveWriteUpProgress(c.store, progressKey("nobody", PROJ), { chunk: WRITE_UP_PART_BYTES, parts: 2, done: 1, handedAt: 1 });
    c.close();
    expect(start("new-1").ask ?? "").toContain("writeUp: old-1");
    const d = Counterpart.open({ dir: storeDir, owner: true });
    expect(Object.keys(readWriteUpProgress(d.store)).sort()).toEqual([progressKey("old-1", PROJ)]);
    d.close();
  });

  test("a failed final mark still leaves the session written up: its words were claimed, so nobody is pointed at it again (MAJOR 2, since 2026-09-30)", async () => {
    const seed = seeder();
    ended(seed, "old-1", { at: Date.now() - 2 * DAY });
    seed.done();
    const { s } = await pointAndFetch("new-1");
    // The review's repro: the mark's file cannot be written.
    const marks = join(storeDir, "spans", keyFor(PROJ), "writeups.jsonl");
    mkdirSync(marks, { recursive: true });
    const first = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", memories: [MEMORY] }));
    expect(first).toMatchObject({ reason: "written-up", marked: false });
    rmSync(marks, { recursive: true, force: true });
    s.counterpart.close();
    open.splice(open.indexOf(s.counterpart), 1);

    // The memories claimed its words (`cover`), so by `core/coverage/`'s rule
    // it owes nothing: no later session is pointed at it, nothing is minted twice.
    const c = Counterpart.open({ dir: storeDir, owner: true });
    expect(planRetention(c.spans, writeUpSources(c.store)).find((h) => h.session === "old-1")?.owes).toBe(false);
    const minted = c.spans.proposalRecords<ProposalRecord>(PROJ).filter((p) => p.accepted === true);
    expect(minted.map((p) => p.session)).toEqual(["new-1"]);
    c.close();
    for (const id of ["new-2", "new-3"]) expect(start(id).ask ?? "").not.toContain("writeUp: old-1");
  });

  test("the RETRY PATH: when the door's own claim AND its mark hit an IO failure, the next session's fetch finishes both, depositing nothing (MAJOR 2)", async () => {
    const seed = seeder();
    ended(seed, "old-1", { at: Date.now() - 2 * DAY });
    seed.done();
    const { s } = await pointAndFetch("new-1");
    // Neither `coverage.jsonl` nor `writeups.jsonl` can be written.
    const scopeDir = join(storeDir, "spans", keyFor(PROJ));
    const blocked = [join(scopeDir, "coverage.jsonl"), join(scopeDir, "writeups.jsonl")];
    for (const f of blocked) mkdirSync(f, { recursive: true });
    const first = payload(await s.call("session_end", { session: "new-1", writeUp: "old-1", memories: [] }));
    expect(first).toMatchObject({ reason: "written-up", marked: false });
    for (const f of blocked) rmSync(f, { recursive: true, force: true });
    s.counterpart.close();
    open.splice(open.indexOf(s.counterpart), 1);
    // Nothing claimed it, so it still owes: the next start is pointed at it,
    // and its fetch finishes the claim and the mark (`p.answer` in `handOver`).
    const later = await pointAndFetch("new-2");
    expect(later.fetched).toMatchObject({ reason: "written-up", marked: true, deposited: 0 });
    const covered = later.s.counterpart.spans.coveredHashes(PROJ);
    expect(later.s.counterpart.spans.spans(PROJ).filter((x) => x.session === "old-1").every((x) => covered.has(x.hash))).toBe(true);
    expect(later.s.counterpart.spans.writeUps(PROJ).map((w) => w.session)).toEqual(["old-1"]);
  });

  test("near the 24 KB boundary, a failed final mark is still finished by the next fetch — the kept marks do not add a part (m-B)", async () => {
    const seed = seeder();
    ended(seed, "near", { at: Date.now() - 2 * DAY, bytes: 23_200, captures: 60, replies: false });
    seed.done();
    const first = start("new-1").ask ?? "";
    expect(first).toContain("writeUp: near");
    expect(first).not.toContain(", part ");
    const s = server();
    expect(payload(await s.call("session_end", { session: "new-1", writeUp: "near" }))).toMatchObject({ reason: "part", part: 1, of: 1 });
    const marksFile = join(storeDir, "spans", keyFor(PROJ), "writeups.jsonl");
    mkdirSync(marksFile, { recursive: true });
    expect(payload(await s.call("session_end", { session: "new-1", writeUp: "near", memories: [MEMORY] }))).toMatchObject({
      reason: "written-up",
      marked: false,
    });
    rmSync(marksFile, { recursive: true, force: true });
    // THE REVIEW'S CONDITION HOLDS: every word now reads as kept, and the marks
    // push a recount over the part size.
    const recount = writeUpParts(writeUpEntries(s.counterpart.spans, { session: "near", scopes: [PROJ] }), WRITE_UP_PART_BYTES);
    expect(recount.length).toBe(2);
    s.counterpart.close();
    open.splice(open.indexOf(s.counterpart), 1);

    // The next session is not handed "part 2 of 2": since 2026-09-30 the words
    // the memories claimed are written up, and it is not pointed at it at all.
    newDay();
    const again = start("new-2").ask ?? "";
    expect(again).not.toContain("writeUp: near");
    expect(again).not.toContain("part 2");
  });

  test("a session with words in TWO projects: each project's writer is served only its own, and the mark waits for both (MAJOR 6)", async () => {
    const seed = seeder();
    const at = Date.now() - 2 * DAY;
    recordSession(storeDir, { sessionId: "multi", scope: PROJ, phase: "start", at });
    multiIn(seed, at, "PROJ-WORDS", "SECRET-OTHER-PROJECT");
    seed.c.boundary({ session: "multi", scope: PROJ, kind: "stop" });
    seed.c.boundary({ session: "multi", scope: PROJ, kind: "session-end" });
    recordSession(storeDir, { sessionId: "multi", scope: PROJ, phase: "end", at: at + HOUR });
    seed.done();

    const { s, fetched } = await pointAndFetch("proj-writer");
    expect(String(fetched["text"])).toContain("PROJ-WORDS-0");
    expect(String(fetched["text"])).not.toContain("SECRET-OTHER-PROJECT");
    const here = payload(await s.call("session_end", { session: "proj-writer", writeUp: "multi", memories: [MEMORY] }));
    expect(here).toMatchObject({ reason: "written-up-here", marked: false, elsewhere: 1 });
    expect(s.counterpart.spans.writeUps(PROJ)).toEqual([]);
    expect(s.counterpart.spans.writeUps(OTHER)).toEqual([]);
    // OTHER's copy keeps its clock: the session still owes, kept however old.
    expect(verdicts(s.counterpart).later.get("multi")).toBe("kept-owed");
    s.counterpart.close();
    open.splice(open.indexOf(s.counterpart), 1);
    // PROJ is done: its next session is not pointed at it again.
    newDay();
    expect(start("proj-2").ask ?? "").not.toContain("writeUp: multi");

    // OTHER's writer is served OTHER's words, and its answer marks the session.
    newDay();
    expect(start("other-writer", { scope: OTHER }).ask ?? "").toContain("writeUp: multi");
    const o = openServer({ dir: storeDir, scope: OTHER, owner: true });
    open.push(o.counterpart);
    const got = payload(await o.call("session_end", { session: "other-writer", writeUp: "multi" }));
    expect(String(got["text"])).toContain("SECRET-OTHER-PROJECT");
    expect(String(got["text"])).not.toContain("PROJ-WORDS");
    const done = payload(await o.call("session_end", { session: "other-writer", writeUp: "multi", memories: [] }));
    expect(done).toMatchObject({ reason: "written-up", marked: true });
    expect(o.counterpart.spans.writeUps(OTHER).map((w) => w.session)).toEqual(["multi"]);
    expect(o.counterpart.spans.writeUps(PROJ)).toEqual([]);
  });

  test("an answer mints authored memories through the WRITING session, filed as the OLD one's, second-hand and dated the day it was lived; marks it; a second is refused", async () => {
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
    // THE OLD SESSION'S MEMORY (2026-10-01): its origin, the day it was lived
    // as the happened date, the learned date the day it was written, and
    // marked second-hand with its writer.
    const row = s.counterpart.store.row(id);
    expect(row).toMatchObject({ source: "authored", origin_session: "old-1", happened_on: localDate(Date.now() - 2 * DAY + 5 * PIECE_GAP), learned_on: TODAY() });
    expect(JSON.parse(row?.meta ?? "{}")).toMatchObject({ secondHand: true, writtenUpBy: "new-1" });

    expect(s.counterpart.spans.writeUps(PROJ).map((w) => [w.session, w.by])).toEqual([["old-1", "next-session"]]);
    expect(Object.keys(readWriteUpProgress(s.counterpart.store)).filter((k) => k.startsWith("old-1|"))).toEqual([]);
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

  test("a batch writer HOLDS (the update guard, 2026-10-09): an unrelated corrected stays held — nobody reads the reply, and that is the safe side", async () => {
    seeded();
    const w = Counterpart.open({ dir: storeDir, owner: true });
    const passport = w.store.put({
      type: "memory",
      kind: "fact",
      body: "The owner changed her last name on her passport after the wedding; the new passport arrived in May.",
      salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 },
    });
    w.close();
    const { s } = await pointAndFetch("new-1");
    const out = payload(
      await s.call("session_end", {
        session: "new-1",
        writeUp: "old-1",
        part: 1,
        memories: [{ ...MEMORY, updates: passport, how: "corrected" }],
      }),
    );
    expect(out).toMatchObject({ reason: "written-up", deposited: 1, marked: true });
    const outcome = (out["outcomes"] as Record<string, unknown>[])[0] ?? {};
    expect(outcome["settled"]).toMatchObject({ held: true, over: passport, how: "corrected" });
    const store = s.counterpart.store;
    // The old memory is as it was: live, unfaded, unlinked, in no pair.
    expect(store.row(passport)?.archived).toBe(0);
    expect(store.physicsOf(passport).fade ?? 1).toBe(1);
    expect(store.contradictionsOf([passport]).get(passport) ?? []).toEqual([]);
    expect(store.read(String(outcome["id"])).doc.meta["updates"]).toBeUndefined();
    // One hold, marked as a write-up's; nothing settled.
    const held = store.eventLog({ name: CONTRADICTION_HELD_EVENT });
    expect(held).toHaveLength(1);
    expect(JSON.parse(held[0]?.payload ?? "{}")).toMatchObject({ holds: outcome["id"], over: passport, source: "session-end", writeUp: true, actorId: "new-1" });
    expect(store.eventLog({ name: CONTRADICTION_SETTLED_EVENT })).toHaveLength(0);
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
        // An earlier part covers nothing: the parts not yet served must not read as kept.
        expect(s.counterpart.spans.coverage(PROJ).filter((m) => m.session === "long-1")).toEqual([]);
        s.counterpart.close();
        open.splice(open.indexOf(s.counterpart), 1);
        continue;
      }
      expect(out).toMatchObject({ reason: "written-up", part: of, of, marked: true });
      expect(more["reason"]).toBe("already-written-up");
      expect(s.counterpart.spans.writeUps(PROJ).map((w) => w.session)).toEqual(["long-1"]);
      // The last part: every one of its words here now reads as kept.
      const covered = s.counterpart.spans.coveredHashes(PROJ);
      expect(s.counterpart.spans.spans(PROJ).filter((x) => x.session === "long-1").every((x) => covered.has(x.hash))).toBe(true);
      break;
    }
    expect(of).toBe(3);
    newDay();
    expect(start("after").ask).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the worker never sweeps — a crashed session waits for the next session (keyless, 2026-09-24)", () => {
  function gateReason(): unknown {
    const c = Counterpart.open({ dir: storeDir, owner: true });
    try {
      const rows = c.store.eventLog({ name: SWEEP_GATE_EVENT, limit: 5 });
      return JSON.parse(rows[rows.length - 1]?.payload ?? "{}")["reason"];
    } finally {
      c.close();
    }
  }

  test("the gate row says `not-opted-in`, nothing is marked, and the next session is pointed at it", async () => {
    const s = seeder();
    ended(s, "crashed", { at: Date.now() - 2 * DAY, end: "crash" });
    s.done();
    const events: Record<string, unknown>[] = [];
    const report = await runOnce({
      config: config(),
      date: "2026-09-23",
      onEvent: (name, data) => {
        if (name === "runner.done") events.push(data);
      },
    });
    expect(report.ran).toBe(true);
    expect(report.swept).toBe(0);
    expect(events[0]?.["sweep"]).toBe("next-session");
    expect(gateReason()).toBe("not-opted-in");
    const c = Counterpart.open({ dir: storeDir, owner: true });
    try {
      expect(c.spans.writeUps(PROJ)).toEqual([]);
    } finally {
      c.close();
    }
    expect(start("new-1").ask ?? "").toContain("writeUp: crashed");
  });

  test("an old `crashWriteUp` in the configuration is ignored and named — memory stays on", () => {
    for (const value of ["api", "API", true, null, "sweep"]) {
      const loaded = loadConfig({ dataDir: "/x", crashWriteUp: value });
      expect(loaded.ok).toBe(true);
      expect(loaded.config.observer).toBeUndefined();
      expect(loaded.config.dataDir).toBe("/x");
      expect((loaded.config.retired ?? []).join(" ")).toContain('"crashWriteUp" is no longer used');
    }
    // The one value that was always the behaviour is not worth a note.
    expect(loadConfig({ dataDir: "/x", crashWriteUp: "next-session" }).config.retired).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("doctor: one line, `Write-ups` (#192's `Crash write-up`, re-read off the coverage ledger 2026-09-30)", () => {
  function line(over: Partial<AdapterConfig> = {}): { severity: string; detail: string } {
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    const findings = doctorFindings({
      configPath: join(root, "claude-code.json"),
      configReason: "loaded",
      config: config(over),
      dir: storeDir,
      store: c.store,
      today: TODAY(),
      refusals: {},
    });
    const f = findings.find((x) => x.key === "crash-write-up");
    c.close();
    open.pop();
    return { severity: f?.severity ?? "missing", detail: f?.detail ?? "" };
  }

  test("green on an empty store: nothing captured yesterday, nothing owed", () => {
    expect(line()).toEqual({
      severity: "green",
      detail: `yesterday (${localDate(todayStart() - HOUR)}): nothing captured; nothing owed`,
    });
  });

  test("a session with no end counts as owing like any other", () => {
    const s = seeder();
    ended(s, "crashed", { at: Date.now() - 5 * DAY, end: "crash" });
    ended(s, "unanswered", { at: Date.now() - 2 * DAY, end: "normal" });
    s.done();
    const got = line();
    expect(got.severity).toBe("amber");
    expect(got.detail).toContain("2 sessions owe a write-up, 2 from yesterday or earlier");
  });

  test("a session finished here and waiting on another project names that project (m-C)", async () => {
    const seed = seeder();
    const at = Date.now() - 5 * DAY;
    recordSession(storeDir, { sessionId: "multi", scope: PROJ, phase: "start", at });
    multiIn(seed, at, "PROJ-WORDS", "OTHER-WORDS");
    seed.c.boundary({ session: "multi", scope: PROJ, kind: "stop" });
    seed.c.boundary({ session: "multi", scope: PROJ, kind: "session-end" });
    recordSession(storeDir, { sessionId: "multi", scope: PROJ, phase: "end", at: at + HOUR });
    seed.done();
    const { s } = await pointAndFetch("proj-writer");
    expect(payload(await s.call("session_end", { session: "proj-writer", writeUp: "multi", memories: [] }))["reason"]).toBe("written-up-here");
    s.counterpart.close();
    open.splice(open.indexOf(s.counterpart), 1);
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    const f = doctorFindings({
      configPath: join(root, "claude-code.json"),
      configReason: "loaded",
      config: config(),
      dir: storeDir,
      store: c.store,
      today: TODAY(),
      refusals: {},
    }).find((x) => x.key === "crash-write-up");
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain(`session multi is finished in ${PROJ} and waiting on words it left in ${OTHER}`);
    expect(f?.fix).toContain(`Open a session in ${OTHER}`);
    expect(f?.fix).toContain("no command yet to close a session by hand");
  });

  test("counts the sessions that owe, and turns amber once one is from yesterday or earlier", () => {
    const s = seeder();
    ended(s, "fresh", { at: earlierToday() });
    s.done();
    const green = line();
    expect(green.severity).toBe("green");
    expect(green.detail).toContain("; 1 session owes a write-up");
    expect(green.detail).not.toContain("from yesterday");
    const t = seeder();
    ended(t, "stale", { at: Date.now() - 5 * DAY, scope: OTHER });
    t.done();
    const amber = line();
    expect(amber.severity).toBe("amber");
    expect(amber.detail).toContain("; 2 sessions owe a write-up, 1 from yesterday or earlier");
  });

  test("Authorship carries the owed count as detail and stays green — the loss is Write-ups' one amber", () => {
    const lines = (): { authorship: { severity: string; detail: string; stale: unknown }; crash: string } => {
      const c = Counterpart.open({ dir: storeDir, owner: true });
      open.push(c);
      const findings = doctorFindings({
        configPath: join(root, "claude-code.json"),
        configReason: "loaded",
        config: config(),
        dir: storeDir,
        store: c.store,
        today: TODAY(),
        refusals: {},
      });
      c.close();
      open.pop();
      const f = findings.find((x) => x.key === "authorship");
      return {
        authorship: { severity: f?.severity ?? "missing", detail: f?.detail ?? "", stale: f?.data["owedStale"] },
        crash: findings.find((x) => x.key === "crash-write-up")?.severity ?? "missing",
      };
    };
    const t = seeder();
    ended(t, "stale", { at: Date.now() - (WRITE_UP_WAIT_DAYS + 2) * DAY, scope: OTHER });
    t.done();
    const late = lines();
    expect(late.crash).toBe("amber");
    expect(late.authorship.severity).toBe("green");
    expect(late.authorship.stale).toBe(1);
    expect(late.authorship.detail).toContain("1 session awaiting a write-up, 1 from yesterday or earlier");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the short write-up: a small owed stretch (2026-09-29; since 2026-09-30, under six pieces)", () => {
  test("FULL WRITE-UPS FIRST: a short one takes only what is left of the day's two pointers", () => {
    const s = seeder();
    // The short one is OLDER, so only the full-first key can put the full one ahead.
    ended(s, "short-old", { at: Date.now() - 3 * DAY, bytes: 200, asked: false });
    ended(s, "full-new", { at: Date.now() - 1 * DAY, bytes: 900 });
    s.done();
    const first = start("new-1").ask ?? "";
    expect(first).toContain("writeUp: full-new");
    expect(first).not.toContain(WRITE_UP_SHORT_LINE);
    const second = start("new-2").ask ?? "";
    expect(second).toContain("writeUp: short-old");
    expect(second).toContain(WRITE_UP_SHORT_LINE);
    // The day's allowance is spent.
    expect(start("new-3").ask).toBeNull();
  });

  test("one line back closes it; so does [] — and either way it owes nothing after", async () => {
    const s = seeder();
    ended(s, "short-a", { at: Date.now() - 2 * DAY, bytes: 200, asked: false });
    ended(s, "short-b", { at: Date.now() - 3 * DAY, bytes: 200, asked: false });
    s.done();
    // The older first: short-b.
    const one = await pointAndFetch("new-1");
    expect(one.fetched).toMatchObject({ reason: "part", ended: "short-b" });
    const answered = payload(await one.s.call("session_end", { session: "new-1", writeUp: "short-b", memories: [MEMORY] }));
    expect(answered).toMatchObject({ reason: "written-up", marked: true });
    one.s.counterpart.close();
    open.length = 0;
    const two = await pointAndFetch("new-2");
    expect(two.fetched).toMatchObject({ reason: "part", ended: "short-a" });
    const empty = payload(await two.s.call("session_end", { session: "new-2", writeUp: "short-a", memories: [] }));
    expect(empty).toMatchObject({ reason: "written-up", marked: true });
    two.s.counterpart.close();
    open.length = 0;
    const c = Counterpart.open({ dir: storeDir, owner: true });
    const plan = planRetention(c.spans, writeUpSources(c.store));
    c.close();
    for (const id of ["short-a", "short-b"]) {
      expect(plan.find((h) => h.session === id), id).toMatchObject({ small: false, owes: false });
    }
    newDay();
    expect(start("new-3").ask).toBeNull();
  });

  test("RETENTION, since 2026-09-30: a small owed stretch is a debt like a full one; a tail under the floor goes after its week", () => {
    const s = seeder();
    ended(s, "short-kept", { at: Date.now() - 2 * DAY, bytes: 200, asked: false });
    ended(s, "full-kept", { at: Date.now() - 2 * DAY, bytes: 900 });
    ended(s, "tail", { at: Date.now() - 2 * DAY, bytes: 200, captures: 1 });
    s.done();
    const c = Counterpart.open({ dir: storeDir, owner: true });
    const v = verdicts(c);
    c.close();
    expect(v.later.get("short-kept")).toBe("kept-owed");
    expect(v.later.get("full-kept")).toBe("kept-owed");
    expect(v.now.get("tail")).toBe("kept-young");
    expect(v.later.get("tail")).toBe("deleted");
  });

  test("NOT A PERSON'S CONVERSATION: the headless nightly run's child captures nothing, so it owes nothing", () => {
    const a = openAdapter(config(), {
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
      scope: { mode: "on", matched: PROJ, entry: null },
    });
    try {
      const at = new Date().toISOString().slice(0, 10);
      const out = a.sessionEnd({
        sessionId: "night-child",
        scope: PROJ,
        at,
        nightRun: true,
        turns: [
          { role: "user", text: "Run the nightly page writer, the dream and the reflection." },
          { role: "assistant", text: "Done." },
        ],
      });
      expect(out.spansAppended ?? 0).toBe(0);
    } finally {
      a.counterpart.close();
    }
    const c = Counterpart.open({ dir: storeDir, owner: true });
    const plan = planRetention(c.spans, writeUpSources(c.store));
    c.close();
    expect(plan.find((h) => h.session === "night-child")).toBeUndefined();
  });

  test("a short debt with NO registry record — the unbound MCP server's shared `mcp` id — is never pointed at", () => {
    const s = seeder();
    for (let i = 0; i < 3; i++) {
      s.set(Date.now() - 2 * DAY + i * PIECE_GAP);
      s.c.captureJot({ session: "mcp", scope: PROJ, text: `A note that would not parse, kept as a jot (${String(i)}).` });
    }
    s.done();
    const c = Counterpart.open({ dir: storeDir, owner: true });
    const held = planRetention(c.spans, writeUpSources(c.store)).find((h) => h.session === "mcp");
    c.close();
    expect(held).toMatchObject({ owes: true, small: true });
    expect(start("new-1").ask).toBeNull();
  });

  test("STORE-WIDE, NOT PER PROJECT (review of #285, S1 / probe P1): a full debt in another project is pointed at before any short one here", () => {
    const s = seeder();
    ended(s, "full-other", { at: Date.now() - 2 * DAY, scope: OTHER, bytes: 900 });
    ended(s, "short-a", { at: Date.now() - 2 * DAY + 10_000, bytes: 200, asked: false });
    ended(s, "short-b", { at: Date.now() - 2 * DAY + 20_000, bytes: 200, asked: false });
    s.done();
    // Two quick starts here: no pointer, so the day's allowance is kept.
    expect(start("s1").ask).toBeNull();
    expect(start("s2").ask).toBeNull();
    // The start in OTHER gets the full debt.
    expect(start("s3", { scope: OTHER }).ask ?? "").toContain("writeUp: full-other");
    // Now the full one has had today's pointer: the short ones may have what is left.
    expect(start("s4").ask ?? "").toContain(WRITE_UP_SHORT_LINE);
  });

  test("A WRITTEN-UP short session keeps its text up to 7 days after the write-up (review of #285, M1 / probe P2)", async () => {
    const s = seeder();
    ended(s, "short-x", { at: Date.now() - 6 * DAY, bytes: 200, asked: false });
    s.done();
    const { s: srv, fetched } = await pointAndFetch("live-x");
    expect(fetched).toMatchObject({ reason: "part", ended: "short-x" });
    expect(payload(await srv.call("session_end", { session: "live-x", writeUp: "short-x", memories: [] }))).toMatchObject({
      reason: "written-up",
    });
    srv.counterpart.close();
    open.length = 0;
    const c = Counterpart.open({ dir: storeDir, owner: true });
    const sources = writeUpSources(c.store);
    const v = (t: number): string | undefined =>
      planRetention(new SpanBuffer({ dir: storeDir, now: () => t }), sources).find((h) => h.session === "short-x")?.verdict;
    const at5 = v(Date.now() + 5 * DAY);
    const at8 = v(Date.now() + 8 * DAY);
    c.close();
    // The write-up restarts the week, as it does for a full debt: kept at +5
    // days (11 after it ended), gone at +8 — bounded, about 14 days at most.
    expect(at5).toBe("kept-young");
    expect(at8).toBe("deleted");
  });

  test("NOT A PERSON'S INTERACTIVE CONVERSATION (review of #285, N2): `claude -p` / the Agent SDK owe no one-line write-up", () => {
    // The hook reads the host's entrypoint from its environment.
    expect(toHookInput({ session_id: "p1" }, { scope: PROJ, env: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" } }).entrypoint).toBe("sdk-cli");
    expect(toHookInput({ session_id: "p1" }, { scope: PROJ, env: {} }).entrypoint).toBeUndefined();
    const s = seeder();
    for (const [id, entrypoint] of [["print-1", "sdk-cli"], ["sdk-1", "sdk-ts"], ["person-1", "cli"]] as const) {
      ended(s, id, { at: Date.now() - 2 * DAY, bytes: 200, asked: false });
      recordSession(storeDir, { sessionId: id, scope: PROJ, phase: "boundary", entrypoint });
      expect(readSession(storeDir, id)?.entrypoint).toBe(entrypoint);
    }
    s.done();
    const ask = start("new-1").ask ?? "";
    expect(ask).toContain("writeUp: person-1");
    newDay();
    // ...and nothing else is ever offered: the other two are not a person's.
    expect(start("new-2").ask ?? "").not.toMatch(/writeUp: (print-1|sdk-1)/);
  });

  test("DOCTOR NAMES WHAT TOOK THE ROOM (review of #285, M3 / probe P4): a pointer deferred beside the first-launch question is not told to lower the wake", () => {
    const s = seeder();
    ended(s, "old-full", { at: Date.now() - 2 * DAY, bytes: 900 });
    s.done();
    const a = openAdapter(config({ injectionBudgetBytes: 9000 }), {
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
    });
    try {
      // A full wake in an unset directory: the question fits, the pointer does not.
      const text = "w".repeat(9_200);
      (a.counterpart as unknown as { wake: () => unknown }).wake = () => ({
        text,
        ok: true,
        reason: "loaded",
        bytes: text.length,
        sentinel: null,
        reading: null,
        preface: null,
        budgetBytes: 9_000,
      });
      const out = a.sessionStart({ sessionId: "0d3f7a52-9c1e-4b8e-9a51-2f7c1f0e9b11", scope: PROJ, at: new Date().toISOString().slice(0, 10) });
      expect(out.ask ?? "").toContain("<counterparts-scope>");
      expect(out.ask ?? "").not.toContain(WRITE_UP_OPEN);
      expect(readWriteUpPointer(a.counterpart.store)).toMatchObject({ outcome: "deferred", reason: "host-cap", beside: "the first-launch question" });
    } finally {
      a.counterpart.close();
    }
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    const f = doctorFindings({
      configPath: join(root, "claude-code.json"),
      configReason: "loaded",
      config: config(),
      dir: storeDir,
      store: c.store,
      today: TODAY(),
      refusals: {},
    }).find((x) => x.key === "crash-write-up");
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain("the wake and the first-launch question left");
    expect(f?.fix).toContain("It was the first-launch question beside the wake that took the room");
    expect(f?.fix).not.toContain("The wake is too full");
  });

  test("doctor counts a small owed stretch like any debt: amber from the day after (2026-09-30)", () => {
    const s = seeder();
    ended(s, "short-old", { at: Date.now() - (WRITE_UP_WAIT_DAYS + 2) * DAY, bytes: 200, asked: false });
    s.done();
    const c = Counterpart.open({ dir: storeDir, owner: true });
    try {
      const f = doctorFindings({
        configPath: join(root, "claude-code.json"),
        configReason: "loaded",
        config: config(),
        dir: storeDir,
        store: c.store,
        today: TODAY(),
        refusals: {},
      }).find((x) => x.key === "crash-write-up");
      expect(f?.severity).toBe("amber");
      expect(f?.detail).toContain("1 session owes a write-up, 1 from yesterday or earlier");
    } finally {
      c.close();
    }
  });
});
