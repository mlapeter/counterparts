/**
 * `fired` — the what-fired view, against real temp stores.
 *
 * The property this file exists to keep is constitution 11's last sentence: the
 * system itself shows what fired and what did not. So the assertions are about
 * the difference between a silence and a fault — every state reachable from a
 * fixture, the seven-day windows exact at a UTC boundary, a refusal read out of
 * each of the five payload shapes that carry one, and a registry that cannot go
 * stale behind the durable event names.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp dir per test, removed in
 * `afterEach`, and the store's provenance clock INJECTED so a row's wall clock
 * is the test's and never the machine's.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import { DURABLE_EVENT_NAMES } from "../src/adapters/dashboard/registries.js";
import {
  FIRED_DAYS,
  MECHANISMS,
  STATE_ORDER,
  daysBefore,
  firedReport,
} from "../src/adapters/fired.js";
import type { FiredReport, FiredRow } from "../src/adapters/fired.js";
import { run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";

const TODAY = "2026-09-17";

let root: string;
let dir: string;
const stores: Store[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-fired-"));
  dir = join(root, "store");
  const c = Counterpart.open({ dir });
  c.close();
});

afterEach(() => {
  for (const s of stores.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** Midday UTC on that calendar date — well clear of both boundaries. */
function at(date: string, clock = "T12:00:00Z"): number {
  return Date.parse(`${date}${clock}`);
}

/** A store whose PROVENANCE clock is the one this test names. */
function store(now: number = at(TODAY)): Store {
  const s = Store.open({ dir, now: () => now });
  stores.push(s);
  return s;
}

/** One durable row of `name`, stamped with a calendar date in its payload. */
function row(
  s: Store,
  name: string,
  date: string,
  payload: Record<string, unknown> = {},
): void {
  s.appendEvent({ name, day: s.livedDay(), payload: { date, ...payload } });
}

function report(s: Store, today = TODAY): FiredReport {
  return firedReport(s, today);
}

function pick(r: FiredReport, id: string): FiredRow {
  const found = r.rows.find((x) => x.id === id);
  if (found === undefined) throw new Error(`no row '${id}' in ${r.rows.map((x) => x.id).join(", ")}`);
  return found;
}

// ── the registry itself ─────────────────────────────────────────────────────

describe("the registry cannot go stale", () => {
  /**
   * TOTALITY, applied to the mechanisms. `registries.ts` already makes a new
   * durable name fail `tsc` before it can go missing from the dashboard; this is
   * the same rule one level up — a name that reaches the log and that no
   * mechanism accounts for is a mechanism nobody named, which is exactly how a
   * merged-and-silent one stayed invisible in September.
   */
  test("every durable event name is accounted for by some mechanism", () => {
    const accounted = new Set<string>();
    for (const m of MECHANISMS) {
      if (m.evidence.kind === "event") for (const n of m.evidence.names) accounted.add(n);
      for (const n of m.covers ?? []) accounted.add(n);
    }
    const orphans = DURABLE_EVENT_NAMES.filter((n) => !accounted.has(n));
    expect(
      orphans,
      `these durable event names have no mechanism in src/adapters/fired.ts: ${orphans.join(
        ", ",
      )}. Add a row to MECHANISMS — label it in plain words, name its evidence — or list the name under an existing row's 'covers'. A name nobody accounts for is a mechanism the owner cannot see.`,
    ).toEqual([]);
  });

  test("no mechanism claims an event name the core does not write", () => {
    const known = new Set<string>(DURABLE_EVENT_NAMES);
    const invented: string[] = [];
    for (const m of MECHANISMS) {
      if (m.evidence.kind === "event") {
        for (const n of m.evidence.names) if (!known.has(n)) invented.push(`${m.id}: ${n}`);
      }
      for (const n of m.covers ?? []) if (!known.has(n)) invented.push(`${m.id}: ${n}`);
    }
    expect(invented).toEqual([]);
  });

  test("ids are unique, and every label is plain English rather than a dotted name", () => {
    const ids = MECHANISMS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MECHANISMS) {
      expect(m.label.length, m.id).toBeGreaterThan(12);
      // The dotted name is EVIDENCE and is printed as such; it is never the
      // sentence a non-engineer is asked to read.
      expect(m.label, m.id).not.toMatch(/^[a-z]+\.[a-z]/);
      expect(m.label, m.id).toBe(m.label.toLowerCase().slice(0, 1) + m.label.slice(1));
    }
  });

  test("a mechanism with no durable evidence always says what would fix it", () => {
    for (const m of MECHANISMS) {
      if (m.evidence.kind !== "none") continue;
      expect(m.evidence.reason.length, m.id).toBeGreaterThan(40);
    }
  });
});

// ── the states ──────────────────────────────────────────────────────────────

describe("every state is reachable from a fixture", () => {
  test("firing, quiet and never, from three names on one store", () => {
    const s = store();
    row(s, "adapter.boundary", TODAY);
    row(s, "sweep.gate", daysBefore(TODAY, 20), { refusals: {} });
    const r = report(s);

    const capture = pick(r, "capture");
    expect(capture.state).toBe("firing");
    expect(capture.lastFired).toBe(TODAY);
    expect(capture.firedInWindow).toBe(1);
    expect(capture.total).toBe(1);

    const sweep = pick(r, "sweep-gate");
    expect(sweep.state).toBe("quiet");
    expect(sweep.firedInWindow).toBe(0);
    expect(sweep.total).toBe(1);

    // A name with a row waiting for it and nothing in it.
    expect(pick(r, "briefing").state).toBe("never");
    expect(pick(r, "briefing").lastFired).toBe(null);
  });

  test("new — never fired, and its evidence is younger than the window", () => {
    const s = store();
    // `sweep.wake` landed 2026-09-17 and has never fired.
    expect(pick(report(s, "2026-09-17"), "sweep-wake").state).toBe("new");
    expect(pick(report(s, "2026-09-17"), "sweep-wake").note).toContain("2026-09-17");
    // A week later the grace is gone and the same silence is a worry.
    expect(pick(report(s, "2026-09-30"), "sweep-wake").state).toBe("never");
  });

  test("blind — no durable evidence, and the row says which row would fix it", () => {
    const s = store();
    const backup = pick(report(s), "backup");
    expect(backup.state).toBe("blind");
    expect(backup.note).toContain("store.backup");
    expect(backup.evidence).toBe("no durable row");
  });

  test("disabled and retired are stated as themselves, never as silence", () => {
    const s = store();
    const r = report(s);
    const emotion = pick(r, "emotion");
    expect(emotion.state).toBe("disabled");
    expect(emotion.note).toContain("precision bar");
    const primacy = pick(r, "primacy");
    expect(primacy.state).toBe("retired");
    expect(primacy.note).toContain("2026-09-04");
  });

  /** A stand-down outranks the counts: a retired mechanism with rows in the
   *  window is still retired, or the view cries wolf every morning. */
  test("a retired mechanism with rows in the window stays retired", () => {
    const s = store();
    row(s, "adapter.primacy.deliver", TODAY);
    const primacy = pick(report(s), "primacy");
    expect(primacy.state).toBe("retired");
    expect(primacy.firedInWindow).toBe(1);
  });

  test("the report counts the states and lists what went quiet, by label", () => {
    const s = store();
    row(s, "adapter.boundary", daysBefore(TODAY, 8));
    row(s, "sweep.gate", TODAY, { refusals: {} });
    const r = report(s);
    expect(r.counts.quiet).toBeGreaterThan(0);
    expect(r.counts.firing).toBeGreaterThan(0);
    // Quiet AND it fired in the previous window: something changed.
    expect(r.wentQuiet).toContain(pick(r, "capture").label);
    // Quiet with nothing in the previous window either is not news.
    expect(r.wentQuiet).not.toContain(pick(r, "briefing").label);
  });

  test("the rows come back silent first", () => {
    const s = store();
    row(s, "adapter.boundary", TODAY);
    row(s, "sweep.gate", daysBefore(TODAY, 20), { refusals: {} });
    const order = report(s).rows.map((x) => STATE_ORDER.indexOf(x.state));
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i] ?? 0).toBeGreaterThanOrEqual(order[i - 1] ?? 0);
    }
    expect(report(s).rows[0]?.state).toBe("quiet");
  });
});

// ── the windows ─────────────────────────────────────────────────────────────

describe("the seven-day windows are right at a UTC date boundary", () => {
  test("today and the six before it are in; the seventh day back is not", () => {
    const s = store();
    for (let back = 0; back <= 7; back += 1) row(s, "adapter.boundary", daysBefore(TODAY, back));
    const capture = pick(report(s), "capture");
    expect(capture.firedInWindow).toBe(FIRED_DAYS);
    expect(capture.firedInPreviousWindow).toBe(1);
    expect(capture.total).toBe(8);
    expect(report(s).from).toBe("2026-09-11");
    expect(report(s).previousTo).toBe("2026-09-10");
    expect(report(s).previousFrom).toBe("2026-09-04");
  });

  test("the last instant of the first day is in, and the one before it is out", () => {
    const s = store();
    row(s, "adapter.boundary", "2026-09-11");
    row(s, "adapter.boundary", "2026-09-10");
    const capture = pick(report(s), "capture");
    expect(capture.firedInWindow).toBe(1);
    expect(capture.firedInPreviousWindow).toBe(1);
  });

  /**
   * A row with no `date` in its payload falls back to its WALL CLOCK, and the
   * wall clock is read in UTC — the same spelling every date in this store uses.
   * The two rows below straddle one UTC midnight by a second.
   */
  test("a row with no date of its own is placed by its wall clock, in UTC", () => {
    const inside = store(at("2026-09-11", "T00:00:00Z"));
    inside.appendEvent({ name: "adapter.boundary", day: inside.livedDay() });
    expect(pick(report(inside), "capture").firedInWindow).toBe(1);
    inside.close();

    const outside = store(at("2026-09-10", "T23:59:59Z"));
    outside.appendEvent({ name: "self.briefing", day: outside.livedDay() });
    const briefing = pick(report(outside), "briefing");
    expect(briefing.firedInWindow).toBe(0);
    expect(briefing.firedInPreviousWindow).toBe(1);
    expect(briefing.lastFired).toBe("2026-09-10");
  });

  test("the payload's own date wins over the wall clock", () => {
    const s = store(at("2026-09-17"));
    row(s, "adapter.boundary", "2026-08-01");
    expect(pick(report(s), "capture").state).toBe("quiet");
    expect(pick(report(s), "capture").lastFired).toBe("2026-08-01");
  });
});

// ── refusals ────────────────────────────────────────────────────────────────

describe("refusals are read from each payload shape that carries one", () => {
  test("the ask's own reason, not its outcome — the day cap and the session cap differ", () => {
    const s = store();
    row(s, "adapter.ask", TODAY, { outcome: "asked", reason: "due" });
    row(s, "adapter.ask", TODAY, { outcome: "capped", reason: "session-ask-cap" });
    row(s, "adapter.ask", TODAY, { outcome: "capped", reason: "session-ask-cap" });
    row(s, "adapter.ask", TODAY, { outcome: "capped", reason: "day-chapter-cap" });
    const ask = pick(report(s), "ask");
    expect(ask.firedInWindow).toBe(4);
    expect(ask.refusedInWindow).toBe(3);
    expect(ask.topRefusal).toBe("session-ask-cap ×2");
  });

  test("the sweep's per-reason map, with SWEPT excluded because it is not a refusal", () => {
    const s = store();
    row(s, "sweep.gate", TODAY, {
      refusals: { NO_CRASHED_SESSION: 5, NOTHING_TO_SWEEP: 2, SWEPT: 9 },
    });
    const sweep = pick(report(s), "sweep-gate");
    expect(sweep.refusedInWindow).toBe(7);
    expect(sweep.topRefusal).toBe("NO_CRASHED_SESSION ×5");
  });

  test("the gate battery's refusalsByReason, on both of its doors", () => {
    const s = store();
    row(s, "gate.deposit", TODAY, { refusalsByReason: { "below-floor": 3 } });
    row(s, "gate.chunk", TODAY, { refusalsByReason: { "duplicate": 1, "below-floor": 1 } });
    expect(pick(report(s), "deposit").topRefusal).toBe("below-floor ×3");
    expect(pick(report(s), "chunk-gate").refusedInWindow).toBe(2);
    expect(pick(report(s), "chunk-gate").topRefusal).toBe("below-floor ×1");
  });

  test("credit's refused map", () => {
    const s = store();
    row(s, "recall.credit", TODAY, {
      reason: "credited",
      refused: { "already-credited-today": 4, "birth-day": 1 },
    });
    const credit = pick(report(s), "credit");
    expect(credit.refusedInWindow).toBe(5);
    expect(credit.topRefusal).toBe("already-credited-today ×4");
  });

  test("the turn's decision reason — rendered is not a refusal, all-gated is", () => {
    const s = store();
    row(s, "recall.decision", TODAY, { reason: "rendered" });
    row(s, "recall.decision", TODAY, { reason: "all-gated" });
    row(s, "recall.decision", TODAY, { reason: "all-gated" });
    const d = pick(report(s), "recall-decision");
    expect(d.firedInWindow).toBe(3);
    expect(d.refusedInWindow).toBe(2);
    expect(d.topRefusal).toBe("all-gated ×2");
  });

  /**
   * THE BACKUP ROW, which until 2026-09-18 did not exist at all: a store that
   * had been copied every night and one that had never been copied once were the
   * same silence, on the one mechanism whose absence costs everything.
   */
  test("the snapshot row fires on a copy, and the failure row is a separate question", () => {
    const s = store();
    row(s, "snapshot.taken", TODAY, { name: "2026-09-17T03-00-00-000Z", kept: 14 });
    const r = report(s);
    const snap = pick(r, "snapshot");
    expect(snap.state).toBe("firing");
    expect(snap.lastFired).toBe(TODAY);
    expect(snap.evidence).toBe("snapshot.taken");
    // A copy that could not be made is NOT a copy: it is its own row, so a store
    // with no backup at all cannot read as covered.
    expect(pick(r, "snapshot-trouble").state).toBe("new");
  });

  test("a snapshot failure names its reason in the refusal column", () => {
    const s = store();
    row(s, "snapshot.failed", TODAY, { step: "copy", reason: "ENOSPC: no space left on device" });
    row(s, "snapshot.failed", TODAY, { step: "copy", reason: "ENOSPC: no space left on device" });
    row(s, "snapshot.failed", TODAY, { step: "resolve", reason: "refusing a filesystem root" });
    const trouble = pick(report(s), "snapshot-trouble");
    expect(trouble.state).toBe("firing");
    expect(trouble.refusedInWindow).toBe(3);
    expect(trouble.topRefusal).toBe("ENOSPC: no space left on device ×2");
    // And the copy itself is still the thing that has never happened.
    expect(pick(report(s), "snapshot").state).toBe("new");
  });

  test("the rotation row is accounted for by the snapshot row rather than given its own state", () => {
    const s = store();
    row(s, "snapshot.rotated", TODAY, { deleted: 1, kept: 14 });
    // A discard is the same mechanism saying what it let go — not evidence that
    // a copy exists, which is what the snapshot row's state is about.
    expect(pick(report(s), "snapshot").state).toBe("new");
    expect(MECHANISMS.find((m) => m.id === "snapshot")?.covers).toContain("snapshot.rotated");
  });

  test("a refusal outside the window is not counted in it", () => {
    const s = store();
    row(s, "adapter.ask", daysBefore(TODAY, 9), { outcome: "capped", reason: "session-ask-cap" });
    const ask = pick(report(s), "ask");
    expect(ask.refusedInWindow).toBe(0);
    expect(ask.topRefusal).toBe(null);
  });

  test("a name with no refusal reader has no refusal column, rather than a zero that means nothing", () => {
    const s = store();
    row(s, "self.briefing", TODAY, { trimmed: 3 });
    expect(pick(report(s), "briefing").topRefusal).toBe(null);
    expect(pick(report(s), "briefing").refusedInWindow).toBe(0);
  });
});

// ── the table probes ────────────────────────────────────────────────────────

describe("the tables that stand in for a mechanism with no event", () => {
  test("the links table answers in LIVED days, and says so", () => {
    const s = store();
    const a = s.put({ type: "memory", kind: "fact", body: "one thing worth keeping" });
    const b = s.put({ type: "memory", kind: "fact", body: "another thing worth keeping" });
    s.link({ src: a, dst: b, weight: 0.4, day: s.livedDay() });
    const edges = pick(report(s), "association");
    expect(edges.state).toBe("firing");
    expect(edges.lastFiredIsDate).toBe(false);
    expect(edges.lastFired).toContain("lived day");
  });

  /**
   * A table whose NEWEST row is inside the window has not put every row it holds
   * inside the window. The first cut of this reported `7d` as the table's whole
   * count, which on the owner's store would have printed "7d 430" for a set of
   * links every one of which was stamped at the import.
   */
  test("a dated table counts PER ROW, not 'the newest one is recent, so all of them are'", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "a memory that gets revised twice" });
    const old = Store.open({ dir, now: () => at(daysBefore(TODAY, 20)) });
    old.revise(id, {
      body: "the first revision of that memory, written weeks ago",
      reason: "episode-chapter",
    });
    old.close();
    s.revise(id, {
      body: "the second revision of that memory, written today",
      reason: "episode-chapter",
    });
    const chapter = pick(report(s), "journal-chapter");
    expect(chapter.total).toBe(2);
    expect(chapter.firedInWindow).toBe(1);
    expect(chapter.state).toBe("firing");
    expect(chapter.lastFired).toBe(TODAY);
  });

  test("a table with rows and no date of any kind is BLIND, not firing", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "a memory worth protecting" });
    s.updatePhysics(id, { protected: true });
    const protection = pick(report(s), "protection");
    expect(protection.state).toBe("blind");
    expect(protection.total).toBe(1);
    expect(protection.note).toContain("no history");
  });

  test("an empty table is `never`, and says nothing more than that", () => {
    const s = store();
    expect(pick(report(s), "removal").state).toBe("never");
    expect(pick(report(s), "removal").total).toBe(0);
    expect(pick(report(s), "prospective-fired").state).toBe("never");
  });

  test("with the probes off, the probe-backed mechanisms are NAMED as unread rather than guessed at", () => {
    const s = store();
    const r = firedReport(s, TODAY, { probes: false });
    expect(r.probesRead).toBe(false);
    expect(r.notRead).toContain("protection");
    expect(r.notRead).toContain("association");
    expect(r.rows.some((x) => x.id === "protection")).toBe(false);
    // Everything with an event of its own is still read.
    expect(r.rows.some((x) => x.id === "capture")).toBe(true);
  });
});

// ── the console ─────────────────────────────────────────────────────────────

describe("counterparts fired", () => {
  /** A console that collects both streams. */
  function consoleWith(): { io: Io; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
  }

  async function fired(): Promise<{ code: number; text: string; err: string }> {
    const c = consoleWith();
    const code = await run(["fired", "--dir", dir], { io: c.io, now: () => at(TODAY) });
    return { code, text: c.out.join("\n"), err: c.err.join("\n") };
  }

  test("prints the whole table, grouped by state, silent first", async () => {
    const s = store();
    row(s, "adapter.boundary", TODAY);
    row(s, "sweep.gate", daysBefore(TODAY, 8), { refusals: { NO_CRASHED_SESSION: 3 } });
    row(s, "adapter.ask", TODAY, { outcome: "capped", reason: "session-ask-cap" });
    s.close();
    stores.length = 0;

    const { code, text } = await fired();
    expect(code).toBe(0);
    expect(text).toContain("what has fired — 2026-09-11→2026-09-17 (UTC)");
    // The group that says something changed leads the page.
    expect(text).toContain("Fired last week and not once this week:");
    expect(text.indexOf("QUIET (")).toBeLessThan(text.indexOf("FIRING ("));
    expect(text.indexOf("QUIET (")).toBeLessThan(text.indexOf("BLIND ("));
    // Each group carries what its state means, so nobody has to know first.
    expect(text).toContain("it has fired before, but not in the last 7 days");
    // One mechanism per line, in words, with its evidence beside it.
    expect(text).toContain("the conversation is captured when a session pauses or ends");
    expect(text).toContain("adapter.boundary");
    expect(text).toContain("last 2026-09-17  ·  7d 1  ·  total 1");
    expect(text).toContain("refused 1 (session-ask-cap ×1)");
    // A blind row says which row would fix it.
    expect(text).toContain("One `store.backup` event would fix it.");
    // And the page states its own bounds.
    expect(text).toContain("what I still have rather than everything that ever happened");
  });

  test("a store that is not there is a usage error with a sentence, not a stack", async () => {
    const c = consoleWith();
    const code = await run(["fired", "--dir", join(root, "nope")], { io: c.io });
    expect(code).toBe(1);
    expect(c.err.join("\n")).toContain("No store at");
    expect(c.out).toEqual([]);
  });

  test("it is a READ: the store's own event count does not move", async () => {
    const s = store();
    row(s, "adapter.boundary", TODAY);
    const before = s.eventLogCensus().rows;
    s.close();
    stores.length = 0;
    await fired();
    const after = store();
    expect(after.eventLogCensus().rows).toBe(before);
  });
});

// ── the rule under all of it ────────────────────────────────────────────────

describe("the reading never writes", () => {
  test("an observer store is not written to by any part of this", () => {
    const writer = store();
    row(writer, "adapter.boundary", TODAY);
    const before = writer.eventLogCensus().rows;
    writer.close();
    stores.length = 0;

    const observer = Store.open({ dir, observer: true, now: () => at(TODAY) });
    stores.push(observer);
    const r = firedReport(observer, TODAY);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(observer.eventLogCensus().rows).toBe(before);
    // And the store still refuses a write, which is what proves the stance held.
    expect(() => observer.appendEvent({ name: "adapter.boundary", day: 0 })).toThrow();
  });
});
