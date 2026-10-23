/**
 * THE NIGHTLY WRITERS ARE HELD TO THE PAGE'S ROOM (2026-10-20, Mike's go,
 * lightly held, an experiment).
 *
 * The page's room is 4,600 bytes (the wake trims, 2026-10-16). It overshot on
 * three of four nights: 4,928 on 10-17; on 10-20 the page writer made 4,756
 * and the reflection rewrote it to 4,956. A page past the room printed whole
 * whenever it fit at all, so the short version its writer was asked for was
 * never read at the default ceiling, and the lanes beside it paid.
 *
 * These tests pin:
 *   - the nightly page writer and the reflection are refused the night's first
 *     page past the room, with how far over and "cut, don't add a short
 *     version"; a cut resend is written; a second send still past it is kept;
 *   - a session's page and the owner's are not held, and the switch turns it off;
 *   - the night still completes: the reflection's entry stands beside a held
 *     page, and a held page never sent again is kept at the run's end
 *     (`Self#keepHeldPage`, called by `runNight`) — never when anything was
 *     written after it — and a writer's night then reads `revised`;
 *   - the wake shows a page within its room whole without borrowing, and a
 *     page past it with a short version shows the short version even where
 *     the whole page would fit.
 *
 * Hermetic: a fresh temp data dir per test, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openNightCounterpart, runNight } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { episodeGate } from "../src/core/bridge.js";
import {
  PAGE_FLOOR_RESERVE_BYTES,
  PAGE_HOST_BUDGET_BYTES,
  PAGE_ROOM_BYTES,
  PAGE_ROOM_RULE,
  PAGE_WRITING_RULE,
  SELF_PAGE_REFUSED_EVENT,
  SELF_TUNABLES,
  Self,
  byteLength,
  deliveryReserveBound,
} from "../src/core/self/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { Store } from "../src/core/store/index.js";

let dir: string;
let dateN = 0;
const open: { close(): void }[] = [];
const SESSION = "s-held-1020";
const ROOM = PAGE_ROOM_BYTES;

// THE WHOLE-PAGE DOORS (2026-10-23): these pin the hold on writes of the
// whole page, so the page split by section is off here (`self.PAGE_SPLIT`);
// the hold under the split is in `test/page-split.test.ts`.
const SPLIT = SELF_TUNABLES as { PAGE_SPLIT: boolean };
const SPLIT_WAS = SPLIT.PAGE_SPLIT;

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-page-held-"));
  SPLIT.PAGE_SPLIT = false;
});

afterEach(() => {
  SPLIT.PAGE_SPLIT = SPLIT_WAS;
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function date(n: number): string {
  return new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10);
}

function brain(): Counterpart {
  const c = Counterpart.open({
    dir,
    identity: { name: "Mike" },
    now: () => Date.now() + dateN * 86_400_000,
  });
  open.push(c);
  return c;
}

function nextDay(c: Counterpart): void {
  dateN += 1;
  c.store.advanceClock(date(dateN));
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

/** A headed page of exactly `n` bytes, plain placeholder prose. */
function pageOf(n: number): string {
  const head = "## Core\n\nI keep a careful account of the studio and say what I do not know.\n\n## Lately\n\n";
  const para = "The kilns ran all week and the glaze tests came back even. ";
  let body = head;
  while (byteLength(body) + byteLength(para) <= n) body += para;
  body += "x".repeat(n - byteLength(body));
  expect(byteLength(body)).toBe(n);
  return body;
}

const SHORT = "## Core\n\nI keep a careful account of the studio and say what I do not know.";

function selfOn(s: Store, over: Partial<typeof SELF_TUNABLES> = {}): Self {
  return new Self({ store: s, gate: episodeGate(), tunables: over });
}

function store(): Store {
  const s = Store.open({ dir });
  open.push(s);
  return s;
}

/** A reflection begun with one plain memory it may cite. */
function reflecting(): { c: Counterpart; cite: string; reflection: string } {
  const c = brain();
  nextDay(c);
  nextDay(c);
  const cite = mem(c, "Mike and I finished the release together and he said thank you.", { kind: "person", about: "us" });
  const begun = c.reflections.begin({ session: SESSION });
  if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
  return { c, cite, reflection: begun.bundle.reflection };
}

function refusals(s: Store): Record<string, unknown>[] {
  return s.eventLog({ name: SELF_PAGE_REFUSED_EVENT, order: "asc", limit: 100 }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The doors the hold reaches, and the ones it does not
// ═══════════════════════════════════════════════════════════════════════════

describe("1. the nightly doors are held to the room, once a night", () => {
  test("the switches default on, and the rule says the room in bytes, plainly, and that the page stays thin", () => {
    expect(SELF_TUNABLES.PAGE_HELD_TO_ROOM).toBe(true);
    expect(SELF_TUNABLES.PAGE_SHORT_PAST_ROOM).toBe(true);
    expect(PAGE_WRITING_RULE).toContain(PAGE_ROOM_RULE);
    expect(PAGE_ROOM_RULE).toContain(`The whole page has ${String(ROOM)} bytes of room`);
    expect(PAGE_ROOM_RULE).toContain("most of a core is still unearned");
    expect(PAGE_ROOM_RULE).toContain("cut, don't add a short version");
  });

  for (const by of ["writer", "reflection"] as const) {
    test(`${by}: the night's first page past the room is refused with the numbers and the page it held; a cut resend is written`, () => {
      const s = store();
      const me = selfOn(s);
      expect(me.revisePage(pageOf(3_000), { by: "owner", reason: "before" }).written).toBe(true);
      const held = me.revisePage(pageOf(4_956), { by, reason: "the night", session: SESSION, short: SHORT });
      expect(held).toMatchObject({ written: false, reason: "past-room", bytes: 4_956, overRoom: ROOM });
      expect(me.page()?.bytes).toBe(3_000);
      const row = refusals(s).at(-1);
      expect(row).toMatchObject({ reason: "past-room", by, session: SESSION, bytes: 4_956, room: ROOM, over: 4_956 - ROOM, at: 0 });
      expect((row?.["held"] as { body: string; short: string }).body).toBe(pageOf(4_956));
      expect((row?.["held"] as { body: string; short: string }).short).toBe(SHORT);
      // Cut, and sent again: written, whole, within the room.
      const cut = me.revisePage(pageOf(4_500), { by, reason: "the night, cut", session: SESSION });
      expect(cut).toMatchObject({ written: true, overRoom: null });
      expect(me.page()?.bytes).toBe(4_500);
      expect(me.page()?.by).toBe(by);
    });
  }

  test("each door is held once a night: 10-20's pattern (the writer over, cut; then the reflection over) holds the reflection too", () => {
    const s = store();
    const me = selfOn(s);
    expect(me.revisePage(pageOf(4_756), { by: "writer", reason: "the writer", session: SESSION }).reason).toBe("past-room");
    expect(me.revisePage(pageOf(4_500), { by: "writer", reason: "the writer, cut", session: SESSION }).written).toBe(true);
    // The reflection, later in the same run: its own first page past the room is held.
    expect(me.revisePage(pageOf(4_956), { by: "reflection", reason: "the reflection", session: SESSION }).reason).toBe("past-room");
    expect(me.page()?.bytes).toBe(4_500);
    // Its second send past it is kept, with its short version.
    const kept = me.revisePage(pageOf(4_956), { by: "reflection", reason: "the reflection again", session: SESSION, short: SHORT });
    expect(kept).toMatchObject({ written: true, overRoom: ROOM });
    expect(kept.short).toMatchObject({ kept: true });
    // The writer's second send that night is kept too; another session's night is its own.
    expect(me.revisePage(pageOf(4_700), { by: "writer", reason: "again", session: SESSION }).written).toBe(true);
    expect(me.revisePage(pageOf(4_800), { by: "writer", reason: "another run", session: "s-other" }).reason).toBe("past-room");
  });

  test("both doors held, neither sent again: the run's end keeps the reflection's, the night's last", () => {
    const s = store();
    const me = selfOn(s);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    expect(me.revisePage(pageOf(4_756), { by: "writer", reason: "the writer", session: SESSION }).reason).toBe("past-room");
    expect(me.revisePage(pageOf(4_956), { by: "reflection", reason: "the reflection", session: SESSION }).reason).toBe("past-room");
    expect(me.keepHeldPage()?.written).toBe(true);
    expect(me.page()?.bytes).toBe(4_956);
    expect(me.page()?.by).toBe("reflection");
  });

  test("a session's page and the owner's are not held: the room stays their target", () => {
    const me = selfOn(store());
    expect(me.revisePage(pageOf(5_000), { by: "session", reason: "a session", session: SESSION })).toMatchObject({ written: true, overRoom: ROOM });
    expect(me.revisePage(pageOf(5_100), { by: "owner", reason: "the owner" })).toMatchObject({ written: true, overRoom: ROOM });
  });

  test("the switch off: a nightly page past the room is kept, as from 2026-10-10", () => {
    const me = selfOn(store(), { PAGE_HELD_TO_ROOM: false });
    expect(me.revisePage(pageOf(4_956), { by: "reflection", reason: "the night", session: SESSION })).toMatchObject({ written: true, overRoom: ROOM });
  });

  test("the ceiling still refuses first, as too-large, and a stale write is still version-moved", () => {
    const me = selfOn(store());
    expect(me.revisePage("x".repeat(16_385), { by: "writer", reason: "huge", session: SESSION }).reason).toBe("too-large");
    me.revisePage(pageOf(1_000), { by: "owner", reason: "first" });
    expect(me.revisePage(pageOf(4_956), { by: "writer", reason: "stale", session: SESSION, ifVersion: 7 }).reason).toBe("version-moved");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The reflection's finish: the night completes
// ═══════════════════════════════════════════════════════════════════════════

describe("2. the reflection, held: the entry stands, the retry says what to cut, a cut page is written", () => {
  test("a page past the room is sent back inside the finish's own retry; the cut page on a second finish is written", () => {
    const { c, cite, reflection } = reflecting();
    const first = c.reflections.finish({
      reflection,
      session: SESSION,
      entry: "Looking back over the last few days, the release stands out.",
      cites: [cite],
      page: { text: pageOf(4_956), cites: [cite], short: SHORT },
    });
    if (!first.ok) throw new Error(String(first.reason));
    // The night is not lost: the entry was kept, and only the page is sent back.
    expect(first.outcome.entryId).not.toBeNull();
    expect(first.outcome.page).toMatchObject({ written: false, reason: "past-room" });
    const detail = first.outcome.page.detail ?? "";
    expect(detail).toContain(`4956 bytes, ${String(4_956 - ROOM)} over its ${String(ROOM)}-byte room`);
    expect(detail).toContain("cut, don't add a short version");
    expect(detail).toContain("Call finish again with this reflection and just page");
    expect(first.outcome.retry ?? "").toContain("page — past-room");
    expect(c.selfPage()).toBeNull();
    // Cut, sent again.
    const again = c.reflections.finish({ reflection, session: SESSION, page: { text: pageOf(4_400), cites: [cite] } });
    if (!again.ok) throw new Error(String(again.reason));
    expect(again.outcome.page).toMatchObject({ written: true, reason: "rewritten" });
    expect(again.outcome.retry).toBeNull();
    expect(c.selfPage()?.bytes).toBe(4_400);
    expect(c.selfPage()?.by).toBe("reflection");
  });

  test("the reflection is told the page's size and its room before it writes", () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    mem(c, "Mike and I finished the release together and he said thank you.", { kind: "person", about: "us" });
    c.revisePage(pageOf(4_300), { by: "owner", reason: "before" });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const text = JSON.stringify(begun);
    expect(text).toContain("It is 4300 bytes now.");
    expect(text).toContain(`The whole page has ${String(ROOM)} bytes of room`);
    expect(text).toContain("send finish again with page.text cut");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The run's end keeps a held page never sent again
// ═══════════════════════════════════════════════════════════════════════════

describe("3. no night loses its rewrite to the hold", () => {
  test("held and never sent again: the run's end keeps it, by its own door, with its short version", () => {
    const s = store();
    const me = selfOn(s);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    expect(me.revisePage(pageOf(4_956), { by: "reflection", reason: "reflection r1", session: SESSION, short: SHORT }).reason).toBe("past-room");
    const kept = me.keepHeldPage();
    expect(kept).toMatchObject({ written: true, overRoom: ROOM });
    expect(me.page()?.body).toBe(pageOf(4_956));
    expect(me.page()?.by).toBe("reflection");
    expect(me.page()?.short?.body).toBe(SHORT);
    // Once: the version moved, so a second call keeps nothing.
    expect(me.keepHeldPage()).toBeNull();
  });

  test("anything written after the hold — the cut resend, the other door's page, the owner — and the run's end keeps nothing", () => {
    const s = store();
    const me = selfOn(s);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    me.revisePage(pageOf(4_956), { by: "writer", reason: "the writer", session: SESSION });
    me.revisePage(pageOf(4_400), { by: "reflection", reason: "the reflection", session: SESSION });
    expect(me.keepHeldPage()).toBeNull();
    expect(me.page()?.bytes).toBe(4_400);
  });

  test("a writer's held night closes `failed` when the run moves on, and reads `revised` once the run's end keeps the page", () => {
    const c = brain();
    const about = "2026-09-01";
    c.self.recordPageWriterRun({ about, mode: "session", outcome: "asked", session: SESSION, run: "drm_x" });
    const held = c.revisePage(pageOf(4_956), { by: "writer", reason: "the night", session: SESSION });
    expect(held.reason).toBe("past-room");
    c.self.recordPageWriterRun({ about, mode: "session", outcome: "refused", detail: "past-room: 4956 bytes, 356 over the 4600-byte room", session: SESSION, run: "drm_x" });
    expect(c.closeNightWriter({ session: SESSION, phase: "the dream" })).toBe(true);
    expect(c.pageWriterStatus(about).outcome).toBe("failed");
    expect(c.self.keepHeldPage()?.written).toBe(true);
    expect(c.selfPage()?.by).toBe("writer");
    const status = c.pageWriterStatus(about);
    expect(status.outcome).toBe("revised");
    expect(status.run?.detail).toContain("past-room: kept at the run's end");
  });

  test("through the real nightly process: a page held in the child and never sent again is in the store and the wake when the run ends", async () => {
    const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: PAGE_HOST_BUDGET_BYTES };
    const seed = Counterpart.open({ dir, budgetBytes: PAGE_HOST_BUDGET_BYTES });
    seed.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    seed.close();
    const run = await runNight({
      open: () => openNightCounterpart(config),
      config,
      run: "nrn_held",
      session: SESSION,
      scope: dir,
      kind: { kind: "night" },
      date: "2026-10-20",
      baseEnv: { PATH: "/usr/bin:/bin" },
      start: async (plan) => {
        if (plan.stdin.includes("reflection launch⟧")) return { code: 0, timedOut: false, error: null };
        // The child's reflection sends a page past the room and stops there.
        const child = Counterpart.open({ dir });
        try {
          expect(child.revisePage(pageOf(4_956), { by: "reflection", reason: "reflection r1", session: SESSION, short: SHORT }).reason).toBe("past-room");
        } finally {
          child.close();
        }
        return { code: 0, timedOut: false, error: null };
      },
    });
    expect(run.endedAt).not.toBe(null);
    const after = Counterpart.open({ dir, budgetBytes: PAGE_HOST_BUDGET_BYTES });
    open.push(after);
    expect(after.selfPage()?.bytes).toBe(4_956);
    expect(after.selfPage()?.by).toBe("reflection");
    // The wake caught up after the keep, and shows the short version.
    expect(after.self.wake().text).toContain(SHORT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The wake: a page that fits, whole, without borrowing
// ═══════════════════════════════════════════════════════════════════════════

describe("4. the wake shows a fitting page whole without borrowing, and a short version past the room", () => {
  // The session-start composition at the default ceiling under the widest delivery reserves.
  const COMPOSE = PAGE_HOST_BUDGET_BYTES - deliveryReserveBound(PAGE_HOST_BUDGET_BYTES);
  const LEND = 1_125;

  test("a page within its room prints whole and borrows nothing", () => {
    const me = selfOn(store());
    me.revisePage(pageOf(ROOM), { by: "reflection", reason: "fits", session: SESSION });
    const out = me.build({ budgetBytes: COMPOSE, day: 1, lendBytes: LEND });
    expect(out.page?.rung).toBe("whole");
    expect(out.budgetBytes).toBe(COMPOSE);
  });

  test("past the room with a short version: the short version, even where the whole page would fit (10-20: 4,956 bytes)", () => {
    const me = selfOn(store());
    me.revisePage(pageOf(4_956), { by: "session", reason: "long", session: SESSION, short: SHORT });
    expect(me.page()?.short?.body).toBe(SHORT);
    // The whole page would fit this composition...
    expect(4_956 + 300).toBeLessThan(COMPOSE - PAGE_FLOOR_RESERVE_BYTES);
    const out = me.build({ budgetBytes: COMPOSE, day: 1, lendBytes: LEND });
    // ...and the short version is what is shown, borrowing nothing.
    expect(out.page?.rung).toBe("short");
    expect(out.text).toContain(SHORT);
    expect(out.text).not.toContain("The kilns ran all week");
    expect(out.budgetBytes).toBe(COMPOSE);
    // The switch off: the whole page, as from 2026-10-10.
    const was = selfOn(me.store, { PAGE_SHORT_PAST_ROOM: false }).build({ budgetBytes: COMPOSE, day: 1, lendBytes: LEND });
    expect(was.page?.rung).toBe("whole");
  });

  test("past the room with no short version: the page whole when it fits, as before — the ladder is unchanged", () => {
    const me = selfOn(store());
    me.revisePage(pageOf(4_956), { by: "owner", reason: "long" });
    expect(me.build({ budgetBytes: COMPOSE, day: 1, lendBytes: LEND }).page?.rung).toBe("whole");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The awkward states (review of #541)
// ═══════════════════════════════════════════════════════════════════════════

describe("5. the awkward states: midnight, a credential, a crowded log, no run end", () => {
  const MIN = 60_000;
  /** A store on a clock the test moves, in UTC so midnight is where it says. */
  function clocked(start: number): { s: Store; me: Self; at: (t: number) => void } {
    let t = start;
    const s = Store.open({ dir, now: () => t, timeZone: "UTC" });
    open.push(s);
    return { s, me: selfOn(s), at: (n) => (t = n) };
  }

  test("a run that crosses midnight: the writer's resend after midnight is its second send, and the run's end still finds the reflection's hold", () => {
    const { me, at } = clocked(Date.UTC(2026, 9, 20, 23, 50));
    const startedAt = Date.UTC(2026, 9, 20, 23, 50);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    at(Date.UTC(2026, 9, 20, 23, 55));
    expect(me.revisePage(pageOf(4_756), { by: "writer", reason: "the writer", session: SESSION }).reason).toBe("past-room");
    at(Date.UTC(2026, 9, 21, 0, 5));
    // The same writer, the same night, five minutes after midnight: kept, not held again.
    expect(me.revisePage(pageOf(4_756), { by: "writer", reason: "the writer again", session: SESSION, ifVersion: 0 })).toMatchObject({ written: true });
    at(Date.UTC(2026, 9, 21, 0, 20));
    expect(me.revisePage(pageOf(4_956), { by: "reflection", reason: "the reflection", session: SESSION }).reason).toBe("past-room");
    // A second reflection hold the same night, after midnight? No: one was used tonight.
    at(Date.UTC(2026, 9, 21, 0, 30));
    expect(me.keepHeldPage({ sinceAt: startedAt })?.written).toBe(true);
    expect(me.page()?.bytes).toBe(4_956);
  });

  test("held before midnight, the run's end after it: kept (the run's own start bounds it, not the calendar date)", () => {
    const { me, at } = clocked(Date.UTC(2026, 9, 20, 23, 40));
    const startedAt = Date.UTC(2026, 9, 20, 23, 40);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    at(Date.UTC(2026, 9, 20, 23, 58));
    expect(me.revisePage(pageOf(4_956), { by: "reflection", reason: "the reflection", session: SESSION }).reason).toBe("past-room");
    at(Date.UTC(2026, 9, 21, 0, 10));
    expect(me.keepHeldPage({ sinceAt: startedAt })?.written).toBe(true);
    expect(me.page()?.bytes).toBe(4_956);
  });

  test("a credential in a held page or its short version never lands on the refusal row, and the kept page is scanned", () => {
    const key = "sk-ant-api03-" + "A".repeat(90) + "AA";
    const s = store();
    const me = selfOn(s);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    const body = pageOf(4_900).replace("The kilns ran all week", `The key is ${key} and the kilns ran`);
    const held = me.revisePage(body, { by: "writer", reason: "the night", session: SESSION, short: `${SHORT} The key is ${key}.` });
    expect(held.reason).toBe("past-room");
    const raw = s.eventLog({ name: SELF_PAGE_REFUSED_EVENT, order: "desc", limit: 1 })[0]?.payload ?? "";
    expect(raw).not.toContain(key);
    expect(me.keepHeldPage()?.written).toBe(true);
    expect(me.page()?.body).not.toContain(key);
    expect(me.page()?.short?.body ?? "").not.toContain(key);
  });

  test("a crowded refusal log (60 other refusals after the hold): the resend is still the second send, and the hold is still found", () => {
    const s = store();
    const me = selfOn(s);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    expect(me.revisePage(pageOf(4_956), { by: "writer", reason: "the writer", session: SESSION }).reason).toBe("past-room");
    for (let i = 0; i < 60; i++) expect(me.revisePage(pageOf(1_000), { by: "session", reason: "stale", ifVersion: 9 }).reason).toBe("version-moved");
    expect(me.keepHeldPage()?.written).toBe(true);
    expect(me.page()?.bytes).toBe(4_956);
    // And the other door: held, crowded out, sent again — kept, not held twice.
    expect(me.revisePage(pageOf(4_800), { by: "reflection", reason: "r", session: SESSION }).reason).toBe("past-room");
    for (let i = 0; i < 60; i++) me.revisePage(pageOf(1_000), { by: "session", reason: "stale", ifVersion: 99 });
    expect(me.revisePage(pageOf(4_800), { by: "reflection", reason: "r again", session: SESSION }).written).toBe(true);
  });

  test("no run end (the session-launched night, or a run killed after the hold): a later boundary keeps the held page once it has settled", () => {
    const t0 = Date.UTC(2026, 9, 20, 9, 0);
    const { me, at } = clocked(t0);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    expect(me.revisePage(pageOf(4_956), { by: "writer", reason: "the writer", session: SESSION }).reason).toBe("past-room");
    // A boundary minutes later: the writer may still be cutting — nothing yet.
    at(t0 + 5 * MIN);
    expect(me.keepHeldPage({ settledMs: 30 * MIN })).toBeNull();
    expect(me.page()?.bytes).toBe(3_000);
    // Settled: kept, once.
    at(t0 + 31 * MIN);
    expect(me.keepHeldPage({ settledMs: 30 * MIN })?.written).toBe(true);
    expect(me.page()?.bytes).toBe(4_956);
    expect(me.keepHeldPage({ settledMs: 30 * MIN })).toBeNull();
  });

  test("an evening hold whose session closed before it settled: the next morning's first boundary keeps it", () => {
    const t0 = Date.UTC(2026, 9, 20, 21, 0);
    const { me, at } = clocked(t0);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    expect(me.revisePage(pageOf(4_956), { by: "reflection", reason: "the reflection", session: SESSION }).reason).toBe("past-room");
    at(t0 + 5 * MIN);
    expect(me.keepHeldPage({ settledMs: 30 * MIN })).toBeNull();
    at(t0 + 20 * 60 * MIN);
    expect(me.keepHeldPage({ settledMs: 30 * MIN })?.written).toBe(true);
    expect(me.page()?.bytes).toBe(4_956);
  });

  test("a held page from a night long gone is not kept by a later boundary", () => {
    const t0 = Date.UTC(2026, 9, 20, 3, 0);
    const { me, at } = clocked(t0);
    me.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    expect(me.revisePage(pageOf(4_956), { by: "writer", reason: "the writer", session: SESSION }).reason).toBe("past-room");
    at(t0 + 3 * 24 * 60 * MIN);
    expect(me.keepHeldPage({ settledMs: 30 * MIN })).toBeNull();
    expect(me.page()?.bytes).toBe(3_000);
  });

  test("through the real worker: a boundary after a night with no run end keeps the settled held page and the wake shows it", async () => {
    const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: PAGE_HOST_BUDGET_BYTES };
    const seed = Counterpart.open({ dir, budgetBytes: PAGE_HOST_BUDGET_BYTES });
    seed.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    seed.close();
    // Held forty minutes ago by a session-launched night's reflection, never sent again.
    const then = Store.open({ dir, now: () => Date.now() - 40 * MIN });
    expect(selfOn(then).revisePage(pageOf(4_956), { by: "reflection", reason: "reflection r1", session: SESSION, short: SHORT }).reason).toBe("past-room");
    then.close();
    const report = await runOnce({ config, embedder: null });
    expect(report.ran).toBe(true);
    const after = Counterpart.open({ dir, budgetBytes: PAGE_HOST_BUDGET_BYTES });
    open.push(after);
    expect(after.selfPage()?.bytes).toBe(4_956);
    expect(after.selfPage()?.by).toBe("reflection");
    expect(after.self.wake().text).toContain(SHORT);
  });

  test("through the real nightly process, across midnight: held at 23:58, the run ending at 00:10 still keeps it", async () => {
    let t = Date.UTC(2026, 9, 20, 23, 50);
    const clock = (): number => t;
    const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: PAGE_HOST_BUDGET_BYTES, timeZone: "UTC" };
    const openAt = (): Counterpart => Counterpart.open({ dir, budgetBytes: PAGE_HOST_BUDGET_BYTES, now: clock, timeZone: "UTC" });
    const seed = openAt();
    seed.revisePage(pageOf(3_000), { by: "owner", reason: "before" });
    seed.close();
    await runNight({
      open: openAt,
      config,
      run: "nrn_midnight",
      session: SESSION,
      scope: dir,
      kind: { kind: "night" },
      date: "2026-10-20",
      now: clock,
      baseEnv: { PATH: "/usr/bin:/bin" },
      start: async (plan) => {
        if (plan.stdin.includes("reflection launch⟧")) {
          t = Date.UTC(2026, 9, 21, 0, 10);
          return { code: 0, timedOut: false, error: null };
        }
        t = Date.UTC(2026, 9, 20, 23, 58);
        const child = openAt();
        try {
          expect(child.revisePage(pageOf(4_956), { by: "reflection", reason: "reflection r1", session: SESSION }).reason).toBe("past-room");
        } finally {
          child.close();
        }
        return { code: 0, timedOut: false, error: null };
      },
    });
    const after = openAt();
    open.push(after);
    expect(after.selfPage()?.bytes).toBe(4_956);
  });
});
