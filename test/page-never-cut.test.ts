/**
 * THE SELF PAGE IS NEVER CUT IN THE WAKE (2026-10-09).
 *
 * #350's second reviewer measured the gap: at the 9,000-byte default, under
 * the widest delivery reserves (the preface's 160, and an eighth of the ceiling
 * each for the handoff pointer and "Work here"), the wake's page cap came to
 * 6,078 bytes — while the writer accepted pages up to 16,384, and the cap
 * formula itself allowed 6,144. A page between them printed cut.
 *
 * Now one number serves both ends: `PAGE_LIMIT_BYTES`, the room the wake
 * guarantees at 9,000 under the widest reserves (`pageRoomBytes`), and the
 * default write limit (`PAGE_MAX_BYTES`). Proved here through the real paths:
 * the reserves ENGINEERED to their widest — a handoff block and a work block of
 * exactly ⌊9,000/8⌋ − 48 bytes, so each reserves exactly 1,125, and the
 * boundary's own row shows the composition at 6,590 — then a page of exactly
 * the limit, in ASCII and in multi-byte prose, delivered whole, byte for byte,
 * by Claude Code's SessionStart hook and by Claude Desktop's `wake` tool (the
 * same bundle: Desktop reads the same configuration's ceiling). A ceiling
 * configured below what the page needs gets one line naming both doors, never
 * a part of the page. The writer is told the limit and refused past it.
 *
 * In Denver (UTC−6) and Kiritimati (UTC+14), on a frozen clock. Hermetic: a
 * fresh temp data dir per test, removed afterwards; every word is invented.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { DESKTOP_HOST } from "../src/adapters/hosts.js";
import { openServer, toolDefinitions } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { SELF_BRIEFING_EVENT } from "../src/core/counterpart.js";
import { HANDOFF_RESERVE_MARGIN_BYTES, HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE } from "../src/core/handoff/index.js";
import {
  BRIEFING_KEY,
  FRAMING,
  PAGE_HOST_BUDGET_BYTES,
  PAGE_LIMIT_BYTES,
  PAGE_WRITING_RULE,
  SELF_TUNABLES,
  WORK_HERE_HEADING,
  deliveryReserveBound,
  pageTooLargeLine,
  readSentinel,
  rotateWork,
  settledOver,
  workHere,
  workHereBytes,
  writerInstruction,
} from "../src/core/self/index.js";
import { startOfLocalDay } from "../src/core/time.js";

const BUDGET = PAGE_HOST_BUDGET_BYTES;
const SCOPE = "/work/studio";
const ZONES = ["America/Denver", "Pacific/Kiritimati"] as const;
/** What each share-ruled reserve takes at its widest at 9,000: ⌊9,000/8⌋. */
const SHARE = Math.floor(BUDGET / HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE);
/** The block that reserves exactly that: the share less the reserve's margin. */
const WIDEST_BLOCK = SHARE - HANDOFF_RESERVE_MARGIN_BYTES;
/** The composition at 9,000 under the widest reserves: 6,590. */
const COMPOSE = BUDGET - deliveryReserveBound(BUDGET);

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-page-never-cut-"));
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

function config(zone: string, budget = BUDGET): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: budget, owner: true, timeZone: zone };
}

function clock(zone: string, ymd: string, hour: number): void {
  setSystemTime(new Date(startOfLocalDay(ymd, zone) + hour * 3_600_000));
}

function adapter(zone: string, budget = BUDGET): ReturnType<typeof openAdapter> {
  const a = openAdapter(config(zone, budget), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  return a;
}

/** The turn-end worker, on the frozen clock: the boundary, in its own process's shape. */
async function worker(zone: string, budget = BUDGET): Promise<void> {
  const out = await runOnce({ config: config(zone, budget), embedder: null });
  expect(out.ran).toBe(true);
}

/** SessionStart, as the hook builds its input; the wake block alone. */
function sessionStart(a: ReturnType<typeof openAdapter>, zone: string, session: string): string {
  const input = toHookInput({ session_id: session, hook_event_name: "SessionStart", cwd: SCOPE }, { scope: SCOPE, timeZone: zone, env: {} });
  const text = a.sessionStart(input).injection ?? "";
  const open = text.indexOf("<!-- counterparts:wake ");
  return open < 0 ? text : text.slice(open);
}

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/**
 * A page of EXACTLY `PAGE_LIMIT_BYTES`, in paragraphs, as a page is written.
 * `multibyte`: accented letters, em dashes, CJK and an emoji (two, three,
 * three and four bytes), so its characters and its bytes differ by a lot.
 */
function pageAtLimit(kind: "ascii" | "multibyte"): string {
  const para =
    kind === "ascii"
      ? "I keep a careful account of the studio and the people in it, and I say what I do not know before I guess."
      : "Je garde un compte précis de l'atelier — 工房の記録を丁寧に残す — et je dis ce que j'ignore avant de deviner 🌿.";
  let page = "## Core\n\n";
  while (bytes(page) + bytes(para) + 2 <= PAGE_LIMIT_BYTES - 40) page += `${para}\n\n`;
  page += "## Lately\n\n";
  page += "x".repeat(PAGE_LIMIT_BYTES - bytes(page) - 1) + ".";
  expect(bytes(page)).toBe(PAGE_LIMIT_BYTES);
  if (kind === "multibyte") expect(page.length).toBeLessThan(PAGE_LIMIT_BYTES - 1_000);
  return page;
}

/** The widest rung of this directory's handoff ladder, as the boundary sizes it. */
function widestHandoff(a: ReturnType<typeof openAdapter>): number {
  return Math.max(0, ...(a.counterpart.handoffs.liveBlockBytesByScope().get(SCOPE) ?? []));
}

/** This directory's "Work here" block, as the boundary sizes it. */
function workBlock(a: ReturnType<typeof openAdapter>): number {
  const store = a.counterpart.store;
  const t = SELF_TUNABLES;
  const day = store.livedDay();
  const lines = workHere(store, SCOPE, { day, max: t.WORK_HERE_MAX, pool: t.WORK_HERE_POOL, excerpt: t.WORK_HERE_EXCERPT, skip: settledOver(store) });
  return workHereBytes(rotateWork(lines, t.WORK_HERE_MAX, day));
}

/**
 * THE WIDEST RESERVES, ENGINEERED. A share-ruled reserve is the widest block
 * that PASSES (`want × 8 ≤ budget`) — a block too wide reserves nothing — so
 * each block is tuned to exactly `WIDEST_BLOCK` bytes: three handoffs whose
 * first sentences grow together (the three-shown rung is the widest), and one
 * work memory whose title grows. Both widths are asserted, so a change in
 * either block's shape fails here rather than passing on smaller reserves.
 */
function widestReserves(a: ReturnType<typeof openAdapter>): void {
  const c = a.counterpart;
  const sentence = (i: number, extra: number): string =>
    `Handoff ${String(i)}: the glaze tiles dry on rack two${"x".repeat(extra)}. Then the kiln log needs the cone readings.`;
  for (let i = 0; i < 3; i += 1) c.writeHandoff(sentence(i, 0), { scope: SCOPE, session: `h${String(i)}` });
  const short = WIDEST_BLOCK - widestHandoff(a);
  expect(short).toBeGreaterThan(0);
  const q = Math.floor(short / 3);
  // Rewritten in the same order, so the newest is the same handoff and the
  // ladder keeps its shape; each sentence stays under the excerpt's cap.
  [q, q, short - 2 * q].forEach((extra, i) => c.writeHandoff(sentence(i, extra), { scope: SCOPE, session: `h${String(i)}` }));
  expect(widestHandoff(a)).toBe(WIDEST_BLOCK);

  c.captureSpans({
    session: "h9",
    scope: SCOPE,
    turns: [
      { role: "user", text: "We fired the test kiln and logged the cones for the record today." },
      { role: "assistant", text: "Logged; the cone readings are in the kiln book." },
    ],
  });
  const id = c.store.put({
    type: "memory",
    kind: "skill",
    title: "Kiln ramp",
    body: "The kiln controller wants the ramp entered in degrees per hour, not per minute, and the offset separately.",
    salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
    origin: { scope: SCOPE },
  });
  const grow = WIDEST_BLOCK - workBlock(a);
  expect(grow).toBeGreaterThan(0);
  c.store.revise(id, { title: `Kiln ramp${"r".repeat(grow)}`, reason: "a longer title" });
  expect(workBlock(a)).toBe(WIDEST_BLOCK);
}

/** The newest durable `self.briefing` row's payload. */
function lastBriefing(a: ReturnType<typeof openAdapter>): Record<string, unknown> {
  const row = a.counterpart.store.eventLog({ name: SELF_BRIEFING_EVENT, order: "desc", limit: 1 })[0];
  return JSON.parse(row?.payload ?? "{}") as Record<string, unknown>;
}

/** A store at the owner's 9,000, a page at the limit, the reserves at their widest, and the boundary run. */
async function evening(zone: string, kind: "ascii" | "multibyte"): Promise<{ a: ReturnType<typeof openAdapter>; page: string }> {
  clock(zone, "2026-10-08", 21);
  const a = adapter(zone);
  const page = pageAtLimit(kind);
  const written = a.counterpart.revisePage(page, { by: "session", reason: "a page at the limit" });
  expect(written.written).toBe(true);
  expect(written.bytes).toBe(PAGE_LIMIT_BYTES);
  widestReserves(a);
  await worker(zone);
  // THE PROOF THE RESERVES LANDED AT THEIR WIDEST: the boundary composed at
  // 9,000 − (160 + 1,125 + 1,125) — with nothing lent, there being nothing
  // open for "Still open" to keep.
  expect(COMPOSE).toBe(6_590);
  expect(lastBriefing(a)["budget"]).toBe(COMPOSE);
  return { a, page };
}

describe("the page at its limit prints whole at 9,000 under the widest reserves (2026-10-09)", () => {
  for (const zone of ZONES) {
    for (const kind of ["ascii", "multibyte"] as const) {
      test(`${zone}: a ${kind} page of exactly ${String(PAGE_LIMIT_BYTES)} bytes — Claude Code's SessionStart delivers it whole, byte for byte`, async () => {
        const { a, page } = await evening(zone, kind);
        const stored = a.counterpart.store.getMeta(BRIEFING_KEY) ?? "";
        expect(stored).toContain(`${FRAMING.identity}\n${page}\n`);
        expect(bytes(stored)).toBeLessThanOrEqual(COMPOSE);

        clock(zone, "2026-10-09", 8);
        const text = sessionStart(a, zone, "s-morning");
        expect(text).toContain(`${FRAMING.identity}\n${page}\n`);
        expect(text).not.toContain("My page is");
        expect(text).not.toContain("the wake shows the first");
        expect(readSentinel(text).intact).toBe(true);
        expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
        // The room the delivery held was used: this directory's handoffs and work.
        expect(text).toContain("Where the work in this directory was left off");
        expect(text).toContain(WORK_HERE_HEADING);
      });
    }

    test(`${zone}: Claude Desktop's wake tool delivers the same page whole — the same bundle, at the same configured ceiling`, async () => {
      const { a, page } = await evening(zone, "multibyte");
      clock(zone, "2026-10-09", 8);
      const s: McpServer = openServer({
        dir,
        owner: true,
        timeZone: zone,
        host: DESKTOP_HOST,
        lifecycle: { config: config(zone), spawner: () => ({ pid: 4242 }) },
        manifestVersion: () => null,
      });
      closers.push(s.counterpart);
      const woke = await s.call("wake", {});
      const wake = String(woke.structuredContent["wake"] ?? "");
      expect(wake).toContain(`${FRAMING.identity}\n${page}\n`);
      expect(wake).not.toContain("My page is");
      const block = wake.slice(wake.indexOf("<!-- counterparts:wake "));
      expect(readSentinel(block.slice(0, block.lastIndexOf("-->") + 3)).intact).toBe(true);
      // What the stored bundle carries is what Desktop was handed.
      expect(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "").toContain(page);
    });

    test(`${zone}: a ceiling configured too small for the page says so in one line, names both doors, and prints none of it`, async () => {
      const small = 6_000;
      clock(zone, "2026-10-08", 21);
      const a = adapter(zone, small);
      const page = pageAtLimit("multibyte");
      expect(a.counterpart.revisePage(page, { by: "session", reason: "a page at the limit" }).written).toBe(true);
      await worker(zone, small);
      clock(zone, "2026-10-09", 8);
      const text = sessionStart(a, zone, "s-small");
      expect(text).toContain(pageTooLargeLine(PAGE_LIMIT_BYTES));
      expect(pageTooLargeLine(PAGE_LIMIT_BYTES)).toContain("the self_page tool");
      expect(pageTooLargeLine(PAGE_LIMIT_BYTES)).toContain("'counterparts self-page'");
      expect(text).not.toContain(page.slice(0, 200));
      expect(text).not.toContain("the wake shows the first");
      expect(readSentinel(text).intact).toBe(true);
      expect(bytes(text)).toBeLessThanOrEqual(small);
    });
  }

  test("the root never holds back more than the bound the limit is sized under — and holds exactly it at 9,000", async () => {
    const zone = ZONES[0];
    clock(zone, "2026-10-08", 21);
    const a = adapter(zone);
    widestReserves(a);
    for (const budget of [4_000, 6_000, 9_000, 12_000, 20_000, 40_000]) {
      const out = a.counterpart.rebrief({ budgetBytes: budget });
      expect({ budget, ok: (out.composeBudget ?? 0) >= budget - deliveryReserveBound(budget) }).toEqual({ budget, ok: true });
    }
    expect(a.counterpart.rebrief({ budgetBytes: BUDGET }).composeBudget).toBe(COMPOSE);
  });
});

describe("the writer is told the limit, and refused past it — never cut (2026-10-09)", () => {
  test("the self_page tool: at the limit it is stored whole; one byte over it is refused with the limit and how much to take out", async () => {
    const s = openServer({ dir, owner: true });
    closers.push(s.counterpart);
    const page = pageAtLimit("multibyte");
    const over = await s.call("self_page", { body: `${page}!` });
    const refused = over.structuredContent;
    expect(refused["stored"]).toBe(false);
    expect(refused["reason"]).toBe("too-large");
    expect(refused["bytes"]).toBe(PAGE_LIMIT_BYTES + 1);
    expect(refused["limit"]).toBe(PAGE_LIMIT_BYTES);
    expect(refused["over"]).toBe(1);
    expect(String(refused["detail"])).toContain("Say the same thing shorter");
    expect(s.counterpart.selfPage()).toBeNull();

    const ok = await s.call("self_page", { body: page });
    expect(ok.structuredContent["stored"]).toBe(true);
    expect(s.counterpart.selfPage()?.body).toBe(page);
  });

  test("the limit is said BEFORE the page is written: the writing rule, the tool's body field and the writer's block", () => {
    expect(PAGE_WRITING_RULE).toContain(`within ${String(PAGE_LIMIT_BYTES)} bytes`);
    expect(PAGE_WRITING_RULE).toContain("refused, never cut");
    const spec = toolDefinitions().find((t) => t["name"] === "self_page") as { inputSchema: { properties: Record<string, { description: string }> } } | undefined;
    expect(spec?.inputSchema.properties["body"]?.description ?? "").toContain(`At most ${String(PAGE_LIMIT_BYTES)} bytes`);
    const page = { id: "sch_x", body: "## Core\n\nShort.", bytes: 15, revisedOn: "2026-10-08", revisedDay: 3, by: "session" as const, reason: null, version: 4 };
    const block = writerInstruction(
      { about: "2026-10-08", today: "2026-10-09", page, memories: [], dropped: 0, omitted: 0, bytes: 0 },
      { tool: "self_page", pageInline: true },
    );
    expect(block).toContain(`15 bytes of at most ${String(PAGE_LIMIT_BYTES)}`);
    expect(block).toContain(PAGE_WRITING_RULE);
  });
});
