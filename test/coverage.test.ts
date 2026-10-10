/**
 * COVERAGE — what is not written up yet (`core/coverage/`, 2026-09-30).
 *
 * One describe per piece of the brief:
 *   1. the pacer's third arm — the reference case (one claim, then 14 pieces
 *      over 159 minutes, 6 typed turns, ~16 KB) is asked at about 30 minutes,
 *      and is not without the arm; a single huge piece is not an ask;
 *   2. what a session owes — a closing-turn tail is not owed; a session left
 *      open overnight owes the next date and an active one does not;
 *   3. what writes a stretch up — nothing new and a chapter do, a handoff
 *      alone does not;
 *   4. the in-session write-up path, end to end on a temp store;
 *   5. lapse at the fourteenth day of use (the third until 2026-10-10), with its row and nothing deleted, and
 *      the old-backlog pass;
 *   6. retention's seven days, unchanged;
 *   7. the handoff pointer in its three states;
 *   8. `counterparts coverage` and the doctor line.
 *
 * Hermetic: every test makes its own temp directory and removes it. Clocks are
 * pinned where a date matters, and the zone is UTC there.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import {
  COVERAGE_LAPSED_EVENT,
  COVERAGE_OWED_EVENT,
  COVERAGE_TUNABLES,
  COVERAGE_WRITTEN_EVENT,
  askFromStretch,
  ledger,
  recordCoverage,
} from "../src/core/coverage/index.js";
import type { LedgerEntry } from "../src/core/coverage/index.js";
import { SpanBuffer, planRetention, retentionSources } from "../src/core/remember/index.js";
import { HANDOFF_EXCERPT_BYTES, excerpt } from "../src/core/handoff/index.js";
import type { Store } from "../src/core/store/index.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/server.js";
import { readSession, recordSession, writeUpPlan } from "../src/adapters/sessions.js";
import { run as cliRun } from "../src/adapters/cli/index.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Noon UTC on 2026-09-29 — every pinned test counts from here. */
const T0 = Date.UTC(2026, 8, 29, 12, 0);
const ZONE = "UTC";

let root: string;
let storeDir: string;
let PROJ: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-coverage-")));
  storeDir = join(root, "store");
  PROJ = join(root, "proj");
  mkdirSync(PROJ, { recursive: true });
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

/** A counterpart on a clock the test turns, in UTC. */
function clocked(start = T0): { c: Counterpart; at(): number; set(t: number): void } {
  let at = start;
  const c = Counterpart.open({ dir: storeDir, owner: true, now: () => at, timeZone: ZONE });
  open.push(c);
  return {
    c,
    at: () => at,
    set(t: number): void {
      at = t;
    },
  };
}

/** Words said to a session. */
function words(tag: string, bytes: number): string {
  const unit = `${tag}: the reservoir loop keeps its pressure only when the relief valve is seated first. `;
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

/** One session's transcript, grown one piece at a time. */
function talker(k: { c: Counterpart; set(t: number): void }, session: string, scope = PROJ) {
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  return {
    piece(at: number, bytes = 600): void {
      k.set(at);
      turns.push({ role: "user", text: words(`${session} #${String(turns.length)}`, bytes) });
      turns.push({ role: "assistant", text: `(${session} #${String(turns.length)}) understood.` });
      k.c.captureSpans({ session, scope, turns: [...turns] });
      k.c.boundary({ session, scope, kind: "stop" });
    },
    end(at: number): void {
      k.set(at);
      k.c.boundary({ session, scope, kind: "session-end" });
    },
  };
}

function entryOf(c: Counterpart, session: string, now: number): LedgerEntry | undefined {
  return ledger(c.spans, { now, zone: ZONE }).find((e) => e.session === session);
}

const MEMORY = { content: "The reservoir loop holds pressure only when the relief valve is seated first.", kind: "fact" };

function rows(store: Store, name: string): Record<string, unknown>[] {
  return store
    .eventLog({ name, limit: 10_000 })
    .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the pacer's third arm: pieces and time", () => {
  test("THE REFERENCE CASE: one claim, then 14 pieces over 159 minutes with 6 typed turns and ~16 KB — asked at about 30 minutes, and never without the arm", async () => {
    for (const withArm of [true, false]) {
      rmSync(storeDir, { recursive: true, force: true });
      const k = clocked();
      const t = talker(k, "ref");
      t.piece(T0);
      // The first ask, answered with a memory: the one claim.
      expect(k.c.episodeAsk("ref", { turns: 6, bytes: 3_000 }, undefined, { scope: PROJ }).asked).toBe(true);
      const dep = await k.c.submitSessionEnd(MEMORY, { session: "ref", scope: PROJ });
      expect(dep.reason).toBe("minted");
      expect(entryOf(k.c, "ref", T0)?.stretch).toBeNull();

      // 14 pieces over 159 minutes. Six of them carry a typed turn; ~16 KB in all.
      const first = T0 + MIN;
      const asks: { at: number; reason: string }[] = [];
      let typed = 6;
      let bytes = 3_000;
      for (let i = 0; i < 14; i++) {
        const at = first + Math.round((i * 159 * MIN) / 13);
        t.piece(at, 1_150);
        if (i % 2 === 0 && typed < 12) typed += 1;
        bytes += 1_150;
        const verdict = k.c.episodeAsk("ref", { turns: typed, bytes }, undefined, withArm ? { scope: PROJ } : {});
        if (verdict.asked) asks.push({ at: at - first, reason: verdict.verdict.reason });
      }
      expect(typed - 6).toBe(6);
      expect(bytes - 3_000).toBeGreaterThan(15_000);
      if (withArm) {
        // The first Stop past half an hour with three pieces unwritten.
        expect(asks[0]?.reason).toBe("due-unwritten");
        expect(asks[0]?.at).toBeGreaterThanOrEqual(COVERAGE_TUNABLES.ASK_AFTER_MS);
        expect(asks[0]?.at).toBeLessThan(45 * MIN);
        // …and again every half hour while nothing is written up — the day's cap still stands.
        expect(asks.length).toBeGreaterThan(1);
        expect(asks.length).toBeLessThanOrEqual(Math.ceil(159 / 30));
      } else {
        expect(asks).toEqual([]);
      }
      k.c.close();
      open.splice(0);
    }
  });

  test("the arm applies to a FIRST ask with the same numbers", () => {
    const k = clocked();
    const t = talker(k, "first");
    for (let i = 0; i < 3; i++) t.piece(T0 + i * 16 * MIN);
    const v = k.c.episodeAsk("first", { turns: 1, bytes: 1_800 }, undefined, { scope: PROJ });
    expect(v.asked).toBe(true);
    expect(v.verdict.reason).toBe("due-unwritten");
    expect(v.verdict.unwritten).toEqual({ pieces: 3, minutes: 32 });
  });

  test("A SINGLE HUGE PIECE IS NOT AN ASK: the rule is pieces and time", () => {
    const k = clocked();
    const t = talker(k, "paste");
    t.piece(T0, 3_000);
    expect(k.c.episodeAsk("paste", { turns: 6, bytes: 3_000 }, undefined, { scope: PROJ }).asked).toBe(true);
    k.set(T0 + MIN);
    k.c.spans.claimCoverage({ scope: PROJ, session: "paste", proposalId: "prp_test" });
    // One 80 KB paste, then hours of nothing new (the substance handed in is
    // the pacer's own business; the arm reads pieces).
    t.piece(T0 + 2 * MIN, 80_000);
    k.set(T0 + 5 * HOUR);
    const v = k.c.episodeAsk("paste", { turns: 7, bytes: 3_100 }, undefined, { scope: PROJ });
    expect(v.asked).toBe(false);
    expect(v.verdict.unwritten?.pieces).toBe(1);
    const three = { pieces: 3, firstAt: T0, times: [T0, T0 + 11 * MIN, T0 + 12 * MIN] };
    expect(askFromStretch({ pieces: 1, firstAt: T0, times: [T0] }, null, T0 + DAY)).toBe(false);
    expect(askFromStretch(three, null, T0 + 29 * MIN)).toBe(false);
    expect(askFromStretch(three, null, T0 + 30 * MIN)).toBe(true);
    // Since an ask: three NEW pieces as well as the half hour.
    expect(askFromStretch(three, T0 - MIN, T0 + 31 * MIN)).toBe(true);
    expect(askFromStretch(three, T0 + 10 * MIN, T0 + 2 * HOUR)).toBe(false);
  });

  test("AN ASK NOBODY ANSWERS IS NOT ASKED AGAIN ON THE CLOCK ALONE: three new pieces since it, as well as the half hour (review of #289)", () => {
    const k = clocked();
    const t = talker(k, "quiet");
    for (let i = 0; i < 3; i++) t.piece(T0 + i * 16 * MIN);
    expect(k.c.episodeAsk("quiet", { turns: 1, bytes: 1_800 }, undefined, { scope: PROJ }).verdict.reason).toBe("due-unwritten");
    // Six hours, no new piece: never again.
    for (let h = 1; h <= 6; h++) {
      k.set(T0 + 32 * MIN + h * HOUR);
      expect(k.c.episodeAsk("quiet", { turns: 1, bytes: 1_800 }, undefined, { scope: PROJ }).asked).toBe(false);
    }
    // Two new pieces: still not. The third: asked.
    t.piece(T0 + 7 * HOUR);
    t.piece(T0 + 7 * HOUR + MIN);
    expect(k.c.episodeAsk("quiet", { turns: 1, bytes: 1_800 }, undefined, { scope: PROJ }).asked).toBe(false);
    t.piece(T0 + 7 * HOUR + 2 * MIN);
    expect(k.c.episodeAsk("quiet", { turns: 1, bytes: 1_800 }, undefined, { scope: PROJ }).asked).toBe(true);
  });

  test("the adapter.ask row says which rule fired", () => {
    const a = openAdapter(
      { dataDir: storeDir, owner: true, timeZone: ZONE },
      { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }), scope: { mode: "on", matched: PROJ, entry: null } },
    );
    open.push(a.counterpart);
    // Three pieces, half an hour apart, seeded on the adapter's own store.
    const s = new SpanBuffer({ dir: storeDir, now: () => Date.now() - 2 * HOUR });
    s.capture({ session: "hooked", scope: PROJ, turns: [{ role: "user", text: words("a", 400) }] });
    const s2 = new SpanBuffer({ dir: storeDir, now: () => Date.now() - HOUR });
    s2.capture({ session: "hooked", scope: PROJ, turns: [{ role: "user", text: words("a", 400) }, { role: "user", text: words("b", 400) }] });
    const input: HookInput = {
      sessionId: "hooked",
      scope: PROJ,
      at: "2026-09-30",
      turns: [
        { role: "user", text: words("a", 400) },
        { role: "user", text: words("b", 400) },
        { role: "user", text: words("c", 400) },
      ],
    };
    const out = a.stop(input);
    expect(out.ask).not.toBeNull();
    const row = rows(a.counterpart.store, "adapter.ask").pop();
    expect(row?.["reason"]).toBe("due-unwritten");
    expect(row?.["unwritten"]).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("what a session owes: three pieces over fifteen minutes, not at work", () => {
  test("a CLOSING-TURN TAIL — one piece after the last claim — is not owed, ended or not", () => {
    const k = clocked();
    const t = talker(k, "tail");
    for (let i = 0; i < 4; i++) t.piece(T0 + i * 10 * MIN);
    k.c.spans.claimCoverage({ scope: PROJ, session: "tail", proposalId: "prp_x" });
    t.piece(T0 + 45 * MIN);
    t.end(T0 + 46 * MIN);
    const e = entryOf(k.c, "tail", T0 + HOUR);
    expect(e?.state).toBe("ended");
    expect(e?.stretch?.pieces).toBe(1);
    expect(e?.owed).toBe(false);
    // Three pieces inside ten minutes are under the floor too.
    const u = talker(k, "quick");
    for (let i = 0; i < 3; i++) u.piece(T0 + 2 * HOUR + i * 4 * MIN);
    u.end(T0 + 2 * HOUR + 13 * MIN);
    expect(entryOf(k.c, "quick", T0 + 3 * HOUR)?.owed).toBe(false);
  });

  test("a session LEFT OPEN OVERNIGHT owes the next date; an active one does not", () => {
    const k = clocked();
    const night = talker(k, "night");
    // 20:00–21:00 on the 29th, no end.
    for (let i = 0; i < 4; i++) night.piece(T0 + 8 * HOUR + i * 20 * MIN);
    // Later that same evening it is still at work, whatever the silence.
    expect(entryOf(k.c, "night", T0 + 11 * HOUR)).toMatchObject({ state: "active", owed: false });
    // The date changed and it captured nothing since: quiet, and it owes.
    const morning = T0 + 21 * HOUR; // 09:00 on the 30th
    expect(entryOf(k.c, "night", morning)).toMatchObject({ state: "quiet", owed: true });
    // A session at work this morning, as long as it goes on, does not.
    const now = talker(k, "morning");
    for (let i = 0; i < 4; i++) now.piece(T0 + 19 * HOUR + i * 15 * MIN);
    expect(entryOf(k.c, "morning", morning)).toMatchObject({ state: "active", owed: false });
    // And once it ends it owes at once — no silence window.
    now.end(morning + MIN);
    expect(entryOf(k.c, "morning", morning + 2 * MIN)).toMatchObject({ state: "ended", owed: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("what writes a stretch up", () => {
  function server(): McpServer {
    const s = openServer({ dir: storeDir, scope: PROJ, owner: true });
    open.push(s.counterpart);
    return s;
  }
  const payload = (r: ToolResult): Record<string, unknown> => r.structuredContent;

  /** A session with four pieces over half an hour, bound and live. */
  function seeded(session: string): void {
    const k = clocked(Date.now() - 2 * HOUR);
    const t = talker(k, session);
    for (let i = 0; i < 4; i++) t.piece(Date.now() - 2 * HOUR + i * 10 * MIN);
    k.c.close();
    open.splice(0);
    recordSession(storeDir, { sessionId: session, scope: PROJ, phase: "start", at: Date.now() - 2 * HOUR });
    recordSession(storeDir, { sessionId: session, scope: PROJ, phase: "boundary", at: Date.now() });
  }

  function ended(session: string): LedgerEntry | undefined {
    recordSession(storeDir, { sessionId: session, scope: PROJ, phase: "end", at: Date.now() });
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    return ledger(c.spans, { now: Date.now(), zone: c.store.zone(), host: (s) => ({ endedAt: readSession(storeDir, s)?.endedAt ?? null }) }).find(
      (e) => e.session === session,
    );
  }

  test("\"NOTHING NEW\" claims the session's unwritten pieces, as a claim with no proposal", async () => {
    seeded("nn");
    const out = payload(await server().call("session_end", { session: "nn", memories: [] }));
    expect(out["reason"]).toBe("nothing-new");
    const e = ended("nn");
    expect(e?.stretch).toBeNull();
    expect(e?.owed).toBe(false);
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    const claims = [...new Set(c.spans.coverage(PROJ).map((m) => m.proposalId))];
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatch(/^nothing-new:nn:\d+$/);
  });

  test("\"nothing new\" in one project does not write up what the same session said in another", async () => {
    seeded("two");
    const OTHER = join(root, "other");
    mkdirSync(OTHER, { recursive: true });
    const k = clocked(Date.now() - HOUR);
    const t = talker(k, "two", OTHER);
    for (let i = 0; i < 3; i++) t.piece(Date.now() - HOUR + i * 10 * MIN);
    k.c.close();
    open.splice(0);
    expect(payload(await server().call("session_end", { session: "two", memories: [] }))["reason"]).toBe("nothing-new");
    const e = ended("two");
    expect(e?.stretch?.pieces).toBe(3);
    expect(e?.stretch?.scopes).toEqual([OTHER]);
  });

  test("A CHAPTER claims them, naming the episode", () => {
    seeded("ch");
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    const written = c.appendEpisode("ch", "A chapter from ch: the relief valve went in first, and the loop held.", { scope: PROJ });
    expect(written.appended).toBe(true);
    const claims = [...new Set(c.spans.coverage(PROJ).map((m) => m.proposalId))];
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatch(new RegExp(`^chapter:${written.episodeId ?? ""}#1:\\d+$`));
    expect(ended("ch")?.owed).toBe(false);
  });

  test("EVERY chapter's claim is its own written-up row, not just the first (review of #289)", () => {
    const k = clocked();
    const t = talker(k, "many");
    recordCoverage(k.c.spans, k.c.store, { now: T0, zone: ZONE });
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 3; i++) t.piece(T0 + round * HOUR + i * 10 * MIN);
      k.set(T0 + round * HOUR + 25 * MIN);
      expect(k.c.appendEpisode("many", `Chapter ${String(round)}: the loop held again.`, { scope: PROJ }).appended).toBe(true);
    }
    recordCoverage(k.c.spans, k.c.store, { now: T0 + 3 * HOUR, zone: ZONE });
    const written = rows(k.c.store, COVERAGE_WRITTEN_EVENT).filter((r) => r["session"] === "many");
    expect(written.map((r) => [r["by"], r["pieces"]])).toEqual([
      ["chapter", 3],
      ["chapter", 3],
      ["chapter", 3],
    ]);
    // No dedup key on them: the log's ordinary prune lets them go.
    expect(k.c.store.eventLog({ name: COVERAGE_WRITTEN_EVENT }).every((r) => r.dedup_key === null)).toBe(true);
    recordCoverage(k.c.spans, k.c.store, { now: T0 + 3 * HOUR + MIN, zone: ZONE });
    expect(rows(k.c.store, COVERAGE_WRITTEN_EVENT)).toHaveLength(3);
  });

  test("A HANDOFF ALONE claims nothing: the session still owes", async () => {
    seeded("ho");
    const out = payload(await server().call("session_end", { session: "ho", handoff: "The relief valve is seated; the loop test is next." }));
    expect(out["reason"]).toBe("handoff-only");
    const e = ended("ho");
    expect(e?.stretch?.pieces).toBe(4);
    expect(e?.owed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the in-session write-up path, end to end", () => {
  test("a session that owes → the next session's start is pointed → fetch → memories → finish → written up, and it owes nothing", async () => {
    // The ended session: four pieces over half an hour, two days ago, ended.
    const k = clocked(Date.now() - 2 * DAY);
    const old = talker(k, "old-e2e");
    recordSession(storeDir, { sessionId: "old-e2e", scope: PROJ, phase: "start", at: Date.now() - 2 * DAY });
    for (let i = 0; i < 4; i++) old.piece(Date.now() - 2 * DAY + i * 10 * MIN);
    old.end(Date.now() - 2 * DAY + 31 * MIN);
    recordSession(storeDir, { sessionId: "old-e2e", scope: PROJ, phase: "end", at: Date.now() - 2 * DAY + 31 * MIN });
    // The worker ran at that turn-end: the owed row, and the written-up watermark.
    k.set(Date.now() - 2 * DAY + 32 * MIN);
    recordCoverage(k.c.spans, k.c.store, { now: k.at(), zone: k.c.store.zone(), host: (s) => ({ endedAt: readSession(storeDir, s)?.endedAt ?? null }) });
    k.c.close();
    open.splice(0);

    // The next session's start is pointed at it.
    const a = openAdapter(
      { dataDir: storeDir, owner: true },
      { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }), scope: { mode: "on", matched: PROJ, entry: null } },
    );
    const started = a.sessionStart({ sessionId: "new-e2e", scope: PROJ, at: new Date().toISOString().slice(0, 10) });
    a.counterpart.close();
    expect(started.ask ?? "").toContain("writeUp: old-e2e");

    // Fetch, then answer with a memory.
    const s = openServer({ dir: storeDir, scope: PROJ, owner: true });
    open.push(s.counterpart);
    const fetched = s.call("session_end", { session: "new-e2e", writeUp: "old-e2e" });
    const f = (await fetched).structuredContent;
    expect(f["reason"]).toBe("part");
    expect(String(f["text"])).toContain("old-e2e #0");
    const answered = (await s.call("session_end", { session: "new-e2e", writeUp: "old-e2e", part: 1, memories: [MEMORY] })).structuredContent;
    expect(answered).toMatchObject({ reason: "written-up", marked: true });

    // Written up: nothing unwritten, nothing owed, and the pointer is quiet.
    const c = Counterpart.open({ dir: storeDir, owner: true });
    open.push(c);
    const e = ledger(c.spans, { now: Date.now(), zone: c.store.zone() }).find((x) => x.session === "old-e2e");
    expect(e?.stretch).toBeNull();
    expect(e?.owed).toBe(false);
    expect(writeUpPlan({ store: c.store, spans: c.spans }).find((h) => h.session === "old-e2e")?.owes).toBe(false);
    // The worker's next pass says who wrote it up.
    recordCoverage(c.spans, c.store, { now: Date.now(), zone: c.store.zone() });
    const written = rows(c.store, COVERAGE_WRITTEN_EVENT).filter((r) => r["session"] === "old-e2e");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ by: "next-session", pieces: 4 });
    expect(rows(c.store, COVERAGE_OWED_EVENT).filter((r) => r["session"] === "old-e2e")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("lapse: at the LAPSE_DAYS_OF_USE-th day of use after the day it was lived (14 since 2026-10-10)", () => {
  /** A turn-end on another session, on the date `at` falls on. */
  function use(k: { c: Counterpart; set(t: number): void }, at: number): void {
    k.set(at);
    k.c.boundary({ session: "other", scope: PROJ, kind: "stop" });
  }
  const L = COVERAGE_TUNABLES.LAPSE_DAYS_OF_USE;

  test("owed through every day of use before the bound, LAPSED at the first turn-end of the bound's day — with its row, and nothing deleted", () => {
    // 01 C4 (2026-10-10): an owed stretch stays owed for the nightly write-up;
    // three days of use was too short for it to get there.
    expect(L).toBe(14);
    const k = clocked();
    const t = talker(k, "lapser");
    for (let i = 0; i < 4; i++) t.piece(T0 + i * 10 * MIN);
    t.end(T0 + 31 * MIN);
    const read = (now: number): LedgerEntry | undefined => entryOf(k.c, "lapser", now);
    // A weekend away: no use on the 30th or the 1st. Nothing lapses.
    expect(read(T0 + 3 * DAY)).toMatchObject({ owed: true, lapsed: false, daysOfUseSince: 0 });
    use(k, T0 + 3 * DAY); // day of use 1 (10-02)
    use(k, T0 + 3 * DAY + HOUR);
    for (let i = 2; i < L; i++) use(k, T0 + (2 + i) * DAY); // days of use 2 … L−1
    expect(read(T0 + (1 + L) * DAY + HOUR)).toMatchObject({ owed: true, lapsed: false, daysOfUseSince: L - 1 });
    const last = T0 + (2 + L) * DAY - 11 * HOUR; // the first turn-end of day of use L, at 01:00
    use(k, last);
    const e = read(last);
    expect(e).toMatchObject({ owed: false, lapsed: true, daysOfUseSince: L });

    // The row: session, scope key, pieces, minutes — no text.
    const report = recordCoverage(k.c.spans, k.c.store, { now: last, zone: ZONE });
    expect(report).toMatchObject({ reason: "recorded", lapsed: 1, owed: 0 });
    const lapsed = rows(k.c.store, COVERAGE_LAPSED_EVENT);
    expect(lapsed).toHaveLength(1);
    expect(lapsed[0]).toMatchObject({ session: "lapser", pieces: 4, minutes: 30 });
    expect(JSON.stringify(lapsed[0])).not.toContain("reservoir");
    expect(JSON.stringify(lapsed[0])).not.toContain(PROJ);
    // Nothing deleted: every piece is still in the buffer.
    expect(k.c.spans.spans(PROJ).filter((s) => s.session === "lapser")).toHaveLength(4);
    // A second pass writes nothing more.
    recordCoverage(k.c.spans, k.c.store, { now: last + 11 * HOUR, zone: ZONE });
    expect(rows(k.c.store, COVERAGE_LAPSED_EVENT)).toHaveLength(1);
  });

  test("THE OLD-BACKLOG PASS: a store with many old unwritten stretches gets through in one pass, one row per stretch and no more", () => {
    const k = clocked(T0 - 60 * DAY);
    // Forty sessions over forty days of use, each leaving an owed stretch.
    for (let d = 0; d < 40; d++) {
      const t = talker(k, `old-${String(d)}`);
      const base = T0 - 60 * DAY + d * DAY;
      for (let i = 0; i < 4; i++) t.piece(base + i * 10 * MIN);
      t.end(base + 31 * MIN);
    }
    const now = T0 - 20 * DAY + HOUR;
    const first = recordCoverage(k.c.spans, k.c.store, { now, zone: ZONE });
    // The newest L are still owed (L − 1 days of use or fewer since each);
    // every other has had L days of use since (L = 14 since 2026-10-10).
    const L = COVERAGE_TUNABLES.LAPSE_DAYS_OF_USE;
    expect(first).toMatchObject({ reason: "recorded", owed: L, lapsed: 40 - L, written: 0 });
    expect(first.rows).toBe(40);
    expect(rows(k.c.store, COVERAGE_LAPSED_EVENT)).toHaveLength(40 - L);
    expect(rows(k.c.store, COVERAGE_OWED_EVENT)).toHaveLength(L);
    // No backfill of claims made before the first pass.
    expect(rows(k.c.store, COVERAGE_WRITTEN_EVENT)).toHaveLength(0);
    const again = recordCoverage(k.c.spans, k.c.store, { now: now + MIN, zone: ZONE });
    expect(again.rows).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("retention reads the same rule, and its seven days are unchanged", () => {
  test("written up, under the floor, or lapsed: struck at seven days; owed and not lapsed: kept", () => {
    const k = clocked();
    const make = (id: string, pieces: number, gap: number): void => {
      const t = talker(k, id);
      for (let i = 0; i < pieces; i++) t.piece(T0 + i * gap);
      t.end(T0 + pieces * gap);
    };
    make("written", 4, 10 * MIN);
    k.c.spans.claimCoverage({ scope: PROJ, session: "written", proposalId: "prp_w" });
    make("under", 2, 10 * MIN);
    make("owing", 4, 10 * MIN);
    make("lapsing", 4, 10 * MIN);
    const verdicts = (now: number, extraUse: boolean): Map<string, string> => {
      const b = new SpanBuffer({ dir: storeDir, now: () => now });
      if (extraUse) {
        for (let d = 1; d <= COVERAGE_TUNABLES.LAPSE_DAYS_OF_USE; d++) {
          new SpanBuffer({ dir: storeDir, now: () => T0 + d * DAY }).boundary({ session: "user", scope: PROJ, kind: "stop" });
        }
      }
      return new Map(planRetention(b, retentionSources({ zone: () => ZONE })).map((h) => [h.session, h.verdict]));
    };
    const week = verdicts(T0 + 6 * DAY, false);
    expect([week.get("written"), week.get("under"), week.get("owing"), week.get("lapsing")]).toEqual([
      "kept-young",
      "kept-young",
      "kept-owed",
      "kept-owed",
    ]);
    const later = verdicts(T0 + 8 * DAY, false);
    expect(later.get("written")).toBe("deleted");
    expect(later.get("under")).toBe("deleted");
    expect(later.get("owing")).toBe("kept-owed");
    // LAPSE_DAYS_OF_USE days of use later, the owed stretches lapse and go on the week.
    const lapsed = verdicts(T0 + 30 * DAY, true);
    expect(lapsed.get("owing")).toBe("deleted");
    expect(lapsed.get("lapsing")).toBe("deleted");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the handoff pointer says how current it is", () => {
  const LINE = /Where I left off in this directory \(([^)]*)\): /;

  function wake(c: Counterpart): string {
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-29" });
    const text = c.wake(9_000, { date: "2026-09-29" }, { scope: PROJ, session: "reader" }).text;
    return LINE.exec(text)?.[1] ?? "(no pointer)";
  }

  test("three states: written and nothing since; work since not yet written up; work since written up", () => {
    const k = clocked(T0 + 47 * MIN); // 12:47 UTC
    k.c.writeHandoff("The relief valve is seated. The loop test is next, then the gauges.", { scope: PROJ, session: "writer" });
    // 1. Nothing captured here since.
    expect(wake(k.c)).toBe("written 09-29 12:47 by session writer");
    // 2. Three hours of work here since, not written up.
    const t = talker(k, "later");
    for (let i = 0; i <= 6; i++) t.piece(T0 + 47 * MIN + MIN + i * 30 * MIN);
    k.set(T0 + 4 * HOUR);
    expect(wake(k.c)).toBe("written 09-29 12:47 by session writer; work here 12:48\u201315:48 since, not yet written up");
    // 3. The same work, written up.
    k.c.spans.claimCoverage({ scope: PROJ, session: "later", proposalId: "prp_later" });
    expect(wake(k.c)).toBe("written 09-29 12:47 by session writer; work here 12:48\u201315:48 since, written up since");
  });

  test("the WRITER'S OWN TURN is not work since, and work under the floor is not named (review of #289)", () => {
    const k = clocked(T0 + 47 * MIN);
    const w = talker(k, "writer");
    k.c.writeHandoff("The relief valve is seated. The loop test is next, then the gauges.", { scope: PROJ, session: "writer" });
    // The same turn's Stop captures the prompt that asked for the handoff.
    w.piece(T0 + 48 * MIN);
    k.set(T0 + HOUR);
    expect(wake(k.c)).toBe("written 09-29 12:47 by session writer");
    // Two more pieces of the writer's after that Stop: under the floor.
    w.piece(T0 + HOUR);
    w.piece(T0 + HOUR + 10 * MIN);
    expect(wake(k.c)).toBe("written 09-29 12:47 by session writer");
    // A third, past fifteen minutes: now it is work here since.
    w.piece(T0 + HOUR + 20 * MIN);
    expect(wake(k.c)).toBe("written 09-29 12:47 by session writer; work here 13:00\u201313:20 since, not yet written up");
  });

  test("the excerpt skips a list marker and will not stop at a short run — \"1.\", \"Step 2.\", \"e.g.\" (review of #289)", () => {
    expect(excerpt("1. Merge #289 after the review. Then rebase the log branch.")).toBe("Merge #289 after the review.");
    expect(excerpt("Step 2. Rebase onto master and run the suite again. Then push.")).toBe(
      "Step 2. Rebase onto master and run the suite again.",
    );
    expect(excerpt("e.g. the parser rewrite, which is half done. The loop test is next.")).toBe(
      "e.g. the parser rewrite, which is half done.",
    );
    expect(excerpt("- Rebase first. Then push.")).toBe("Rebase first. Then push.");
    const long = `Step 2. ${"word ".repeat(60)}`;
    expect(new TextEncoder().encode(excerpt(long)).length).toBeLessThanOrEqual(HANDOFF_EXCERPT_BYTES);
    expect(excerpt(long).endsWith("\u2026")).toBe(true);
  });

  test("the excerpt is the FIRST SENTENCE of the first substantive line, still capped", () => {
    const k = clocked();
    k.c.writeHandoff("# Handoff\n\nThe relief valve is seated. The loop test is next, then the gauges.", { scope: PROJ });
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-29" });
    const text = k.c.wake(9_000, { date: "2026-09-29" }, { scope: PROJ }).text;
    expect(text).toContain("): The relief valve is seated.\n");
    expect(text).not.toContain("The loop test is next");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("reading it: `counterparts coverage` and the doctor line", () => {
  /** Yesterday (UTC, by the real clock): one session written up, one owing. */
  function yesterdayStore(): { yesterday: string; today: string } {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const noonYesterday = Date.parse(`${today}T12:00:00Z`) - DAY;
    const k = clocked(noonYesterday);
    const done = talker(k, "done-one");
    for (let i = 0; i < 4; i++) done.piece(noonYesterday + i * 10 * MIN);
    k.c.spans.claimCoverage({ scope: PROJ, session: "done-one", proposalId: "prp_done" });
    done.end(noonYesterday + 31 * MIN);
    // A person's session, which the hooks saw start: the pointer can offer it.
    recordSession(storeDir, { sessionId: "owing-one", scope: PROJ, phase: "start", at: noonYesterday + HOUR });
    const owing = talker(k, "owing-one");
    for (let i = 0; i < 5; i++) owing.piece(noonYesterday + HOUR + i * 20 * MIN);
    owing.end(noonYesterday + 3 * HOUR);
    k.c.close();
    open.splice(0);
    return { yesterday: new Date(noonYesterday).toISOString().slice(0, 10), today };
  }

  test("`counterparts coverage --date` names each session, what is written up and what is owed, in plain words", async () => {
    const { yesterday } = yesterdayStore();
    // The console reads the zone from the configuration beside the store.
    writeFileSync(join(root, "claude-code.json"), JSON.stringify({ dataDir: storeDir, timeZone: ZONE }));
    const out: string[] = [];
    const err: string[] = [];
    const code = await cliRun(["coverage", "--dir", storeDir, "--date", yesterday], {
      io: { out: (l) => out.push(l), err: (l) => err.push(l) },
    });
    expect(err).toEqual([]);
    expect(code).toBe(0);
    const said = out.join("\n");
    expect(said).toContain("2 sessions captured something; 4 of 9 pieces that day are written up.");
    expect(said).toContain("done-one");
    expect(said).toContain("all written up");
    expect(said).toMatch(/owing-one[\s\S]*not yet written up: 5 pieces over 1 h 20 min, since \d\d-\d\d \d\d:\d\d — owed \(it ended\)/);
    expect(said).toContain("Owed now: 1 session — owing-one (5 pieces).");
    expect(said).not.toContain("covered");
    // A bad date is refused by name.
    const bad: string[] = [];
    expect(await cliRun(["coverage", "--dir", storeDir, "--date", "yesterday"], { io: { out: () => {}, err: (l) => bad.push(l) } })).toBe(1);
    expect(bad.join("\n")).toContain("--date takes a day as YYYY-MM-DD");
  });

  test("doctor's Write-ups line: yesterday's state, amber on a stretch owed from yesterday, and the week's lapses", () => {
    const { today } = yesterdayStore();
    const c = Counterpart.open({ dir: storeDir, owner: true, timeZone: ZONE });
    open.push(c);
    const read = (): ReturnType<typeof doctorFindings>[number] | undefined =>
      doctorFindings({
        configPath: join(root, "claude-code.json"),
        configReason: "loaded",
        config: { dataDir: storeDir, owner: true },
        dir: storeDir,
        store: c.store,
        today,
        refusals: {},
      }).find((x) => x.key === "crash-write-up");
    const f = read();
    expect(f?.title).toBe("Write-ups");
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toMatch(/^yesterday \(\d{4}-\d{2}-\d{2}\): 2 sessions, 4 of 9 pieces written up; 1 session owes a write-up, 1 from yesterday or earlier$/);
    expect(f?.fix).toContain("counterparts coverage");
    // Written up: green, and a lapse this week is counted.
    c.spans.claimCoverage({ scope: PROJ, session: "owing-one", proposalId: "prp_late" });
    c.store.appendEvent({ name: COVERAGE_LAPSED_EVENT, day: c.store.livedDay(), dedupKey: "t", payload: { session: "gone", pieces: 3, minutes: 20 } });
    const g = read();
    expect(g?.severity).toBe("green");
    expect(g?.detail).toContain("9 of 9 pieces written up; nothing owed; 1 lost unwritten this week");
    // A small debt the pointer never offers — `claude -p` — is named apart, not waited on.
    recordSession(storeDir, { sessionId: "print-1", scope: PROJ, phase: "start", entrypoint: "sdk-cli" });
    const k = clocked(Date.now() - 2 * DAY);
    const p = talker(k, "print-1");
    for (let i = 0; i < 3; i++) p.piece(Date.now() - 2 * DAY + i * 10 * MIN);
    p.end(Date.now() - 2 * DAY + 25 * MIN);
    const h = read();
    expect(h?.severity).toBe("green");
    expect(h?.detail).toContain("nothing owed; 1 small, not a person's session: left to lapse");
  });
});
