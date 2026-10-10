/**
 * THE SELF PAGE IS NEVER CUT IN THE WAKE (2026-10-09), AND NEVER REFUSED FOR
 * LENGTH UNDER ITS CEILING (2026-10-10).
 *
 * #350's second reviewer measured the gap: at the 9,000-byte default, under
 * the widest delivery reserves (the preface's, and an eighth of the ceiling
 * each for the handoff pointer and "Work here"), the wake's page cap came to
 * 6,078 bytes — while the writer accepted pages up to 16,384. A page between
 * them printed cut. #358 then refused every page past that room, and the
 * page's history showed the stopgap losing by a few hundred bytes each time.
 *
 * Now one number serves both ends as a TARGET: `PAGE_ROOM_BYTES`, the room the
 * wake guarantees at 9,000 under the widest reserves, top and end lines
 * counted (`pageRoomBytes`). A page within it prints whole there; a page past
 * it is KEPT and, on a day the wake cannot hold it, steps down a ladder of
 * whole texts — its short version, its outline, its headings, one line.
 * Proved here through the real paths: the reserves ENGINEERED to their widest
 * — a handoff block and a work block of exactly ⌊9,000/8⌋ − 48 bytes, so each
 * reserves exactly 1,125, and the boundary's own row shows the composition —
 * then a page of exactly the room, in ASCII and in multi-byte prose, delivered
 * whole, byte for byte, by Claude Code's SessionStart hook and by Claude
 * Desktop's `wake` tool. The owner's own page sizes from the history (5,904,
 * 6,085, 6,767) borrow "Work here" and print whole; 7,012 steps down to its
 * short version or its outline.
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
import { selfPageFindings } from "../src/adapters/claude-code/doctor.js";
import { SELF_BRIEFING_EVENT } from "../src/core/counterpart.js";
import { HANDOFF_RESERVE_MARGIN_BYTES, HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE } from "../src/core/handoff/index.js";
import {
  BRIEFING_KEY,
  FRAMING,
  PAGE_END_LINES,
  PAGE_HOST_BUDGET_BYTES,
  PAGE_ROOM_BYTES,
  PAGE_WRITING_RULE,
  PREFACE_RESERVE_BYTES,
  SELF_TUNABLES,
  WORK_HERE_HEADING,
  deliveryReserveBound,
  pageTopLine,
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
/** The composition at 9,000 under the widest reserves. */
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

/** The page whole as "Who I am" prints it: its top line, then the page. */
function whole(page: string): string {
  return `${FRAMING.identity}\n${pageTopLine("whole", bytes(page)) ?? ""}\n${page}\n`;
}

/**
 * A page of EXACTLY `size` bytes (the room, by default), in paragraphs, as a
 * page is written. `multibyte`: accented letters, em dashes, CJK and an emoji
 * (two, three, three and four bytes), so its characters and its bytes differ
 * by a lot.
 */
function pageOfSize(kind: "ascii" | "multibyte", size = PAGE_ROOM_BYTES): string {
  const para =
    kind === "ascii"
      ? "I keep a careful account of the studio and the people in it, and I say what I do not know before I guess."
      : "Je garde un compte précis de l'atelier — 工房の記録を丁寧に残す — et je dis ce que j'ignore avant de deviner 🌿.";
  let page = "## Core\n\n";
  while (bytes(page) + bytes(para) + 2 <= size - 40) page += `${para}\n\n`;
  page += "## Lately\n\n";
  page += "x".repeat(size - bytes(page) - 1) + ".";
  expect(bytes(page)).toBe(size);
  if (kind === "multibyte") expect(page.length).toBeLessThan(size - 1_000);
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

/** A store at the owner's 9,000, a page at the room, the reserves at their widest, and the boundary run. */
async function evening(zone: string, kind: "ascii" | "multibyte"): Promise<{ a: ReturnType<typeof openAdapter>; page: string }> {
  clock(zone, "2026-10-08", 21);
  const a = adapter(zone);
  const page = pageOfSize(kind);
  const written = a.counterpart.revisePage(page, { by: "session", reason: "a page at the room" });
  expect(written.written).toBe(true);
  expect(written.bytes).toBe(PAGE_ROOM_BYTES);
  expect(written.overRoom).toBeNull();
  widestReserves(a);
  await worker(zone);
  // THE PROOF THE RESERVES LANDED AT THEIR WIDEST: the boundary composed at
  // 9,000 − (preface + 1,125 + 1,125) — with nothing lent, there being nothing
  // open for "Still open" to keep.
  expect(COMPOSE).toBe(9_000 - PREFACE_RESERVE_BYTES - 2 * SHARE);
  expect(lastBriefing(a)["budget"]).toBe(COMPOSE);
  return { a, page };
}

describe("the page at its room prints whole at 9,000 under the widest reserves (2026-10-09; a target since 2026-10-10)", () => {
  for (const zone of ZONES) {
    for (const kind of ["ascii", "multibyte"] as const) {
      test(`${zone}: a ${kind} page of exactly ${String(PAGE_ROOM_BYTES)} bytes — Claude Code's SessionStart delivers it whole, byte for byte, between its top and end lines`, async () => {
        const { a, page } = await evening(zone, kind);
        const stored = a.counterpart.store.getMeta(BRIEFING_KEY) ?? "";
        expect(stored).toContain(whole(page));
        expect(bytes(stored)).toBeLessThanOrEqual(COMPOSE);
        expect((lastBriefing(a)["page"] as Record<string, unknown>)["rung"]).toBe("whole");

        clock(zone, "2026-10-09", 8);
        const text = sessionStart(a, zone, "s-morning");
        expect(text).toContain(whole(page));
        expect(text).toContain(`\n${PAGE_END_LINES.whole}\n`);
        expect(text).not.toContain("My page is");
        expect(text).not.toContain("the wake shows the first");
        expect(readSentinel(text).intact).toBe(true);
        expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
        // The room the delivery held was used: this directory's handoffs and work.
        expect(text).toContain("Where the work in this directory was left off");
        expect(text).toContain(WORK_HERE_HEADING);
        // Doctor: green, and it says the last wake showed it whole.
        const f = selfPageFindings(a.counterpart.store)[0];
        expect(f?.severity).toBe("green");
        expect(f?.detail).toContain("the last wake showed it whole");
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
      expect(wake).toContain(whole(page));
      expect(wake).not.toContain("My page is");
      const block = wake.slice(wake.indexOf("<!-- counterparts:wake "));
      expect(readSentinel(block.slice(0, block.lastIndexOf("-->") + 3)).intact).toBe(true);
      // What the stored bundle carries is what Desktop was handed.
      expect(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "").toContain(page);
    });

    test(`${zone}: a ceiling configured too small for the page steps down to its outline — whole sentences, both doors named, none of the rest`, async () => {
      const small = 6_000;
      clock(zone, "2026-10-08", 21);
      const a = adapter(zone, small);
      const page = pageOfSize("multibyte");
      expect(a.counterpart.revisePage(page, { by: "session", reason: "a page at the room" }).written).toBe(true);
      await worker(zone, small);
      clock(zone, "2026-10-09", 8);
      const text = sessionStart(a, zone, "s-small");
      const top = pageTopLine("outline", PAGE_ROOM_BYTES) ?? "";
      expect(text).toContain(`${FRAMING.identity}\n${top}\n## Core\nJe garde un compte précis de l'atelier — 工房の記録を丁寧に残す — et je dis ce que j'ignore avant de deviner 🌿.\n## Lately\n`);
      expect(top).toContain("the self_page tool");
      expect(top).toContain("'counterparts self-page'");
      expect(text).toContain(`\n${PAGE_END_LINES.outline}\n`);
      expect(text).not.toContain(page.slice(0, 400));
      expect(text).not.toContain("the wake shows the first");
      expect(readSentinel(text).intact).toBe(true);
      expect(bytes(text)).toBeLessThanOrEqual(small);
      // The page is within its room: the ceiling is what is too small, and doctor says so.
      const f = selfPageFindings(a.counterpart.store)[0];
      expect(f?.severity).toBe("amber");
      expect(f?.detail).toContain("only each section's heading and first sentence");
      expect(f?.fix).toContain("injectionBudgetBytes");
    });
  }

  /**
   * A page PAST the room under the widest reserves: it borrows the room held
   * for "Work here" and prints whole whenever page, frame and furniture fit
   * the composition plus that room (review of #358). The sizes are the page's
   * own history: 5,904 (version 17), 6,085 (this morning's reflection) and
   * 6,767 (a nightly writer), each of which #358 would have refused.
   */
  function pastRoom(bytesWanted: number): string {
    const para = "I keep a careful account of the studio and the people in it, and I say what I do not know before I guess.";
    let page = "## Core\n\n";
    while (bytes(page) + bytes(para) + 2 <= bytesWanted - 40) page += `${para}\n\n`;
    page += `## Lately\n\n${"x".repeat(bytesWanted - bytes(page) - bytes("## Lately\n\n") - 1)}.`;
    expect(bytes(page)).toBe(bytesWanted);
    return page;
  }
  async function widestWith(zone: string, page: string, short?: string): Promise<ReturnType<typeof openAdapter>> {
    clock(zone, "2026-10-08", 21);
    const a = adapter(zone);
    const written = a.counterpart.revisePage(page, { by: "owner", reason: "past its room", ...(short === undefined ? {} : { short }) });
    expect(written.written).toBe(true);
    expect(written.overRoom).toBe(PAGE_ROOM_BYTES);
    widestReserves(a);
    await worker(zone);
    return a;
  }
  for (const zone of ZONES) {
    for (const size of [5_904, 6_085, 6_767]) {
      test(`${zone}: a ${String(size)}-byte page, past the room, is kept, borrows "Work here" under the widest reserves and prints whole — doctor green`, async () => {
        const page = pastRoom(size);
        const a = await widestWith(zone, page);
        const stored = a.counterpart.store.getMeta(BRIEFING_KEY) ?? "";
        expect(stored).toContain(whole(page));
        // Composed past the widest composition by what it borrowed, and by no more than the room held for "Work here".
        const composed = Number(lastBriefing(a)["budget"]);
        expect(composed).toBeGreaterThan(COMPOSE);
        expect(composed).toBeLessThanOrEqual(COMPOSE + SHARE);
        expect(bytes(stored)).toBeLessThanOrEqual(composed);

        clock(zone, "2026-10-09", 8);
        const text = sessionStart(a, zone, "s-morning");
        expect(text).toContain(whole(page));
        expect(text).not.toContain("My page is");
        expect(readSentinel(text).intact).toBe(true);
        expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
        // The handoff is chosen before "Work here" and never gives way to it.
        expect(text).toContain("Where the work in this directory was left off");
        // Whole is green, past its room or not; the detail says the room.
        const f = selfPageFindings(a.counterpart.store)[0];
        expect(f?.severity).toBe("green");
        expect(f?.detail).toContain(`past its ${String(PAGE_ROOM_BYTES)}-byte room`);
        expect(f?.detail).toContain("the last wake showed it whole");
      });
    }

    test(`${zone}: a 7,012-byte page with a short version shows the short version under the widest reserves — marked, with the way to the whole`, async () => {
      const page = pastRoom(7_012);
      const short = "## Core\n\nI keep a careful account of the studio, and I say what I do not know before I guess.";
      const a = await widestWith(zone, page, short);
      clock(zone, "2026-10-09", 8);
      const text = sessionStart(a, zone, "s-morning");
      const top = pageTopLine("short", 7_012) ?? "";
      expect(top).toContain("short version of my 7,012-byte page");
      expect(text).toContain(`${FRAMING.identity}\n${top}\n${short}\n`);
      expect(text).toContain(`\n${PAGE_END_LINES.short}\n`);
      expect(text).not.toContain(page.slice(0, 200));
      expect(readSentinel(text).intact).toBe(true);
      expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
      expect(text).toContain(WORK_HERE_HEADING);
      const f = selfPageFindings(a.counterpart.store)[0];
      expect(f?.severity).toBe("green");
      expect(f?.detail).toContain("the last wake showed its short version");
    });

    test(`${zone}: a 7,012-byte page with no short version shows its outline under the widest reserves — doctor amber, and says what to do`, async () => {
      const page = pastRoom(7_012);
      const a = await widestWith(zone, page);
      clock(zone, "2026-10-09", 8);
      const text = sessionStart(a, zone, "s-morning");
      expect(text).toContain(`${FRAMING.identity}\n${pageTopLine("outline", 7_012) ?? ""}\n## Core\nI keep a careful account of the studio and the people in it, and I say what I do not know before I guess.\n## Lately\n`);
      expect(text).not.toContain(page.slice(0, 300));
      expect(readSentinel(text).intact).toBe(true);
      expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
      const f = selfPageFindings(a.counterpart.store)[0];
      expect(f?.severity).toBe("amber");
      expect(f?.detail).toContain("only each section's heading and first sentence");
      expect(f?.fix).toContain("short version");
      expect(f?.fix).toContain(`under ${String(PAGE_ROOM_BYTES)} bytes`);
    });
  }

  test("the root never holds back more than the bound the room is sized under — and holds exactly it at 9,000", async () => {
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

describe("the writer is told the room as a target, and never refused under the ceiling (2026-10-10)", () => {
  test("the self_page tool: at the room it is stored whole; one byte past it is KEPT, and the answer asks for a short version", async () => {
    const s = openServer({ dir, owner: true });
    closers.push(s.counterpart);
    const page = pageOfSize("multibyte");
    const at = await s.call("self_page", { body: page });
    expect(at.structuredContent["stored"]).toBe(true);
    expect(at.structuredContent["overRoom"]).toBeUndefined();
    expect(at.structuredContent["roomNote"]).toBeUndefined();

    const past = await s.call("self_page", { body: `${page}!`, ifVersion: 0 });
    const kept = past.structuredContent;
    expect(kept["stored"]).toBe(true);
    expect(kept["bytes"]).toBe(PAGE_ROOM_BYTES + 1);
    expect(kept["room"]).toBe(PAGE_ROOM_BYTES);
    expect(kept["overRoom"]).toBe(true);
    expect(String(kept["roomNote"])).toContain(`past its ${String(PAGE_ROOM_BYTES)}-byte room`);
    expect(String(kept["roomNote"])).toContain("call self_page again with `short` alone and `ifVersion: 1`");
    expect(s.counterpart.selfPage()?.body).toBe(`${page}!`);

    // …and a short version added on its own is kept beside that version.
    const added = await s.call("self_page", { short: "## Core\n\nI keep a careful account.", ifVersion: 1 });
    expect(added.structuredContent["stored"]).toBe(true);
    expect((added.structuredContent["short"] as Record<string, unknown>)["kept"]).toBe(true);
    expect(s.counterpart.selfPage()?.short?.body).toBe("## Core\n\nI keep a careful account.");
    expect(s.counterpart.selfPage()?.body).toBe(`${page}!`);

    // Past the 16 KB ceiling, and only there, it is refused.
    const over = await s.call("self_page", { body: "x".repeat(16_385) });
    expect(over.structuredContent["stored"]).toBe(false);
    expect(over.structuredContent["reason"]).toBe("too-large");
    expect(over.structuredContent["limit"]).toBe(16_384);
  });

  test("the room is said BEFORE the page is written, as a target with the short version beside it: the writing rule, the tool's fields and the writer's block", () => {
    expect(PAGE_WRITING_RULE).toContain(`Aim to keep the whole page under ${String(PAGE_ROOM_BYTES)} bytes`);
    expect(PAGE_WRITING_RULE).toContain("also write a short version");
    expect(PAGE_WRITING_RULE).not.toContain("refused");
    const spec = toolDefinitions().find((t) => t["name"] === "self_page") as
      | { description: string; inputSchema: { properties: Record<string, { description: string }> } }
      | undefined;
    expect(spec?.inputSchema.properties["body"]?.description ?? "").toContain(`Aim under ${String(PAGE_ROOM_BYTES)} bytes`);
    expect(spec?.inputSchema.properties["short"]?.description ?? "").toContain(`under ${String(PAGE_ROOM_BYTES)} bytes`);
    // The essentials sit inside the host's 2,048-character cut of the description.
    const description = spec?.description ?? "";
    expect(description.indexOf("send `short` too")).toBeGreaterThan(0);
    expect(description.indexOf("send `short` too")).toBeLessThan(2_048);
    const page = { id: "sch_x", body: "## Core\n\nShort.", bytes: 15, revisedOn: "2026-10-08", revisedDay: 3, by: "session" as const, reason: null, version: 4, short: null };
    const block = writerInstruction(
      { about: "2026-10-08", today: "2026-10-09", page, memories: [], dropped: 0, omitted: 0, bytes: 0 },
      { tool: "self_page", pageInline: true },
    );
    expect(block).toContain(`15 bytes (aim under ${String(PAGE_ROOM_BYTES)})`);
    expect(block).toContain(PAGE_WRITING_RULE);
  });
});
