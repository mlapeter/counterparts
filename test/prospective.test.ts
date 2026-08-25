/**
 * prospective/ — remembering to act: derivation, windows, the four brakes, and
 * the property the whole module exists to protect — **arrival is a cue, not a
 * command, and there is no bypass lane.**
 *
 * Hermetic by construction (CLAUDE.md): every test makes a fresh temp data dir in
 * beforeEach and removes ONLY that path in afterEach. Nothing here can reach a
 * real store.
 *
 * Assertions name the REASON — `DeriveReason`, `FireReason`, `SuppressReason`,
 * `RescheduleReason`, `ExitKind` — never just "it was absent". A window that did
 * not fire because the assistant already used the memory and one that did not
 * fire because it has not opened yet are different systems, and a test that
 * cannot tell them apart is the test v1 shipped (scar §2.4).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Store, StoreError } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import type { Salience } from "../src/core/types.js";
import * as prospective from "../src/core/prospective/index.js";
import {
  EVENT_DATE_META,
  EXCLUDED_KINDS,
  Prospective,
  TEMPORAL_MAX_TIER,
  TUNABLES,
  addDays,
  contentDates,
  daysBetween,
  derive,
  monthBounds,
  parseWindowKey,
  phaseOf,
  precisionOf,
  rampAt,
  windowFor,
  windowKey,
  windowStateOf,
} from "../src/core/prospective/index.js";
import type {
  Arrival,
  DerivableMemory,
  DeriveReason,
  ExitKind,
  FireReason,
  SuppressReason,
} from "../src/core/prospective/index.js";

const SRC = fileURLToPath(new URL("../src/core/prospective/", import.meta.url));

let dir: string;
let priorEnv: string | undefined;
const opened: Store[] = [];

beforeEach(() => {
  priorEnv = process.env["COUNTERPARTS_DATA_DIR"];
  dir = mkdtempSync(join(tmpdir(), "counterparts-prospective-"));
  process.env["COUNTERPARTS_DATA_DIR"] = dir;
});

afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env["COUNTERPARTS_DATA_DIR"];
  else process.env["COUNTERPARTS_DATA_DIR"] = priorEnv;
});

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  opened.push(s);
  return s;
}

const T = TUNABLES;

/** Above the salience floor: sal = mean(0.7, 0.7, 0.7) = 0.7 >= 0.6. */
const SALIENT: Partial<Salience> = { relevance: 0.7, emotional: 0.7, predictive: 0.7 };
/** Below it: mean(0.2, 0.2, 0.2) = 0.2. */
const DULL: Partial<Salience> = { relevance: 0.2, emotional: 0.2, predictive: 0.2 };

const BODY = "The Portland move lands on the fourth and the truck is booked.";

function put(s: Store, input: Partial<PutInput> = {}): string {
  return s.put({
    type: "memory",
    kind: "fact",
    body: BODY,
    learnedOn: "2026-08-25",
    salience: SALIENT,
    ...input,
  });
}

/** A memory dated `date`, at whatever precision the string states. */
function dated(s: Store, date: string, input: Partial<PutInput> = {}): string {
  return put(s, { meta: { [EVENT_DATE_META]: date }, ...input });
}

function mem(over: Partial<DerivableMemory> = {}): DerivableMemory {
  return {
    id: "mem_test",
    kind: "fact",
    salience: { novelty: null, relevance: 0.7, emotional: 0.7, predictive: 0.7, claimed: null },
    archived: false,
    learnedOn: "2026-08-25",
    ...over,
  };
}

function reasonOf(m: DerivableMemory, dates: string[], at: string): DeriveReason {
  return derive(m, dates.map((date) => ({ date })), at, T).reason;
}

function engine(s: Store): Prospective {
  return new Prospective({ store: s });
}

// ═══════════════════════════════════════════════════════════════════════════
// Windows: precision is carried by the date's own shape, never rounded (§12 G4)
// ═══════════════════════════════════════════════════════════════════════════

describe("windows — precision, keys, bounds, ramp", () => {
  test("precision comes from the date's own shape", () => {
    expect(precisionOf("2026-09-04")).toBe("day");
    expect(precisionOf("2026-09")).toBe("month");
    expect(precisionOf("2026")).toBe("year");
  });

  test("a date this module cannot read is refused, never guessed", () => {
    for (const bad of ["", "next June", "26-09-04", "2026-13", "2026-13-01", "2026-02-30", "2026-9-4"]) {
      expect(precisionOf(bad)).toBeNull();
    }
    // A real leap day is a real date; the non-leap one is not.
    expect(precisionOf("2028-02-29")).toBe("day");
    expect(precisionOf("2026-02-29")).toBeNull();
  });

  test("day and month keys are distinct, and the date is IN the key (§12 G9)", () => {
    expect(windowKey("2026-09-04", "day")).toBe("d:2026-09-04");
    expect(windowKey("2026-09", "month")).toBe("m:2026-09");
    expect(windowKey("2026-09-04", "day")).not.toBe(windowKey("2026-09", "month"));
  });

  test("window keys round-trip, and a key this module did not mint is refused", () => {
    expect(parseWindowKey("d:2026-09-04")).toEqual({ eventDate: "2026-09-04", precision: "day" });
    expect(parseWindowKey("m:2026-09")).toEqual({ eventDate: "2026-09", precision: "month" });
    for (const bad of ["2026-09-04", "d:2026-09", "m:2026-09-04", "x:2026-09", "d:whenever"]) {
      expect(parseWindowKey(bad)).toBeNull();
    }
  });

  test("a day window is lead days before and grace days after", () => {
    const w = windowFor("2026-09-04", "day", T);
    expect(w).not.toBeNull();
    expect(w?.opensOn).toBe("2026-09-01");
    expect(w?.peakOn).toBe("2026-09-04");
    expect(w?.closesOn).toBe("2026-09-11");
    expect(daysBetween(w!.opensOn, w!.peakOn)).toBe(T.LEAD_DAYS);
    expect(daysBetween(w!.peakOn, w!.closesOn)).toBe(T.GRACE_DAYS);
  });

  test("a month window is NEVER rounded to a day, and peaks on the first", () => {
    const w = windowFor("2026-09", "month", T);
    expect(w?.eventDate).toBe("2026-09");
    expect(w?.precision).toBe("month");
    expect(w?.peakOn).toBe("2026-09-01");
    expect(w?.opensOn).toBe("2026-08-29");
    expect(w?.closesOn).toBe("2026-10-07");
  });

  test("year precision has no window at all (§12 G3)", () => {
    expect(windowFor("2026", "year", T)).toBeNull();
  });

  test("phase is pending, then arrived, then passed", () => {
    const w = windowFor("2026-09-04", "day", T)!;
    expect(phaseOf(w, "2026-08-31")).toBe("pending");
    expect(phaseOf(w, "2026-09-01")).toBe("arrived");
    expect(phaseOf(w, "2026-09-04")).toBe("arrived");
    expect(phaseOf(w, "2026-09-11")).toBe("arrived");
    expect(phaseOf(w, "2026-09-12")).toBe("passed");
  });

  test("the ramp rises to the peak and tails through grace", () => {
    const w = windowFor("2026-09-04", "day", T)!;
    expect(rampAt(w, "2026-08-31", T)).toBe(0);
    expect(rampAt(w, "2026-09-01", T)).toBeCloseTo(T.RAMP_OPEN, 10);
    expect(rampAt(w, "2026-09-04", T)).toBeCloseTo(1, 10);
    expect(rampAt(w, "2026-09-11", T)).toBeCloseTo(T.RAMP_CLOSE, 10);
    expect(rampAt(w, "2026-09-12", T)).toBe(0);
    expect(rampAt(w, "2026-09-02", T)).toBeGreaterThan(rampAt(w, "2026-09-01", T));
    expect(rampAt(w, "2026-09-06", T)).toBeLessThan(rampAt(w, "2026-09-04", T));
  });

  test("a stated month MEANS early month more than the 29th (§12 G4)", () => {
    const w = windowFor("2026-09", "month", T)!;
    expect(rampAt(w, "2026-09-01", T)).toBeGreaterThan(rampAt(w, "2026-09-29", T));
    expect(rampAt(w, "2026-09-10", T)).toBeGreaterThan(rampAt(w, "2026-09-20", T));
  });

  test("calendar arithmetic crosses months, years and a leap day", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2027-01-02", -3)).toBe("2026-12-30");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-09-01", "2026-09-11")).toBe(10);
    expect(daysBetween("2026-09-11", "2026-09-01")).toBe(-10);
    expect(monthBounds("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    expect(monthBounds("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
    expect(monthBounds("2026-13")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Derivation: prospectivity is DERIVED, never stored (§12 G2)
// ═══════════════════════════════════════════════════════════════════════════

describe("derivation — the predicate, and every refusal by name", () => {
  test("a dated, salient, encoded memory is eligible", () => {
    const p = derive(mem(), [{ date: "2026-09-04" }], "2026-09-01", T);
    expect(p.reason).toBe("eligible");
    expect(p.eligible).toBe(true);
    expect(p.blockedBy).toEqual([]);
    expect(p.windows.map((w) => w.key)).toEqual(["d:2026-09-04"]);
    expect(p.windows[0]?.phase).toBe("arrived");
    expect(p.salience).toBeCloseTo(0.7, 10);
  });

  test("an undated 'someday' reference is refused: no-event-date", () => {
    expect(reasonOf(mem(), [], "2026-09-01")).toBe("no-event-date");
  });

  test("year-only precision can never tactfully arrive", () => {
    const p = derive(mem(), [{ date: "2026" }], "2026-09-01", T);
    expect(p.reason).toBe("year-only-precision");
    expect(p.rejectedDates).toEqual([{ date: "2026", reason: "year-only-precision" }]);
  });

  test("a malformed date is refused, not guessed", () => {
    const p = derive(mem(), [{ date: "sometime in the fall" }], "2026-09-01", T);
    expect(p.reason).toBe("malformed-date");
    expect(p.rejectedDates[0]?.reason).toBe("malformed-date");
  });

  test("a missing or coarse encode date FAILS CONSERVATIVELY (§12 G3)", () => {
    expect(reasonOf(mem({ learnedOn: null }), ["2026-09-04"], "2026-09-01")).toBe(
      "missing-encode-date",
    );
    expect(reasonOf(mem({ learnedOn: "2026" }), ["2026-09-04"], "2026-09-01")).toBe(
      "missing-encode-date",
    );
    expect(reasonOf(mem({ learnedOn: "not a date" }), ["2026-09-04"], "2026-09-01")).toBe(
      "missing-encode-date",
    );
  });

  test("archived memories and skill memories are excluded (§12 G3)", () => {
    expect(reasonOf(mem({ archived: true }), ["2026-09-04"], "2026-09-01")).toBe("archived");
    expect(reasonOf(mem({ kind: "skill" }), ["2026-09-04"], "2026-09-01")).toBe("excluded-kind");
    expect(EXCLUDED_KINDS).toEqual(["skill"]);
  });

  test("salience below the floor never becomes prospective", () => {
    const dull = mem({
      salience: { novelty: null, relevance: 0.2, emotional: 0.2, predictive: 0.2, claimed: null },
    });
    expect(reasonOf(dull, ["2026-09-04"], "2026-09-01")).toBe("below-salience-floor");
  });

  test("EVERY blocking reason is reported, not just the first", () => {
    const bad = mem({
      archived: true,
      kind: "skill",
      learnedOn: null,
      salience: { novelty: null, relevance: 0, emotional: 0, predictive: 0, claimed: null },
    });
    const p = derive(bad, [{ date: "2026" }], "2026-09-01", T);
    expect(p.blockedBy).toEqual([
      "archived",
      "excluded-kind",
      "missing-encode-date",
      "below-salience-floor",
      "year-only-precision",
    ]);
    expect(p.reason).toBe("archived");
  });

  test("the property EXPIRES BY ITSELF when the window passes — no cleanup pass", () => {
    const m = mem();
    const dates = [{ date: "2026-09-04" }];
    expect(derive(m, dates, "2026-08-31", T).reason).toBe("eligible");
    expect(derive(m, dates, "2026-09-04", T).reason).toBe("eligible");
    expect(derive(m, dates, "2026-09-11", T).reason).toBe("eligible");
    // One day later, nothing anywhere changed except the question's `at`.
    expect(derive(m, dates, "2026-09-12", T).reason).toBe("window-passed");
    // ...and the window is still a derived FACT, for the exit accounting.
    expect(derive(m, dates, "2026-09-12", T).windows[0]?.phase).toBe("passed");
  });

  test("a pending window is eligible — prospective is not the same as arrived", () => {
    const p = derive(mem(), [{ date: "2026-12-25" }], "2026-09-01", T);
    expect(p.eligible).toBe(true);
    expect(p.windows[0]?.phase).toBe("pending");
  });

  test("several dates give several windows, oldest first, deduped by key", () => {
    const p = derive(
      mem(),
      [{ date: "2026-11" }, { date: "2026-09-04" }, { date: "2026-09-04" }, { date: "2026" }],
      "2026-09-01",
      T,
    );
    expect(p.windows.map((w) => w.key)).toEqual(["d:2026-09-04", "m:2026-11"]);
    expect(p.rejectedDates).toEqual([{ date: "2026", reason: "year-only-precision" }]);
  });

  test("content-dates read `happenedOn` and the declared meta convention, shape only", () => {
    expect(
      contentDates({
        id: "mem_x",
        type: "memory",
        happenedOn: "2026-09-04",
        learnedOn: "2026-08-25",
        bornDay: 0,
        meta: { eventDate: "2026-10", eventDates: ["2026-11-02", "2026-09-04"] },
        body: BODY,
      }).map((d) => d.date),
    ).toEqual(["2026-09-04", "2026-10", "2026-11-02"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The load-bearing one: a row is firing state, NEVER evidence of prospectivity
// ═══════════════════════════════════════════════════════════════════════════

describe("prospectivity is derived, never stored", () => {
  test("no author can set a prospective flag — a meta flag buys nothing", () => {
    const s = store();
    const id = put(s, { meta: { prospective: true, isProspective: true } });
    const p = engine(s);
    expect(p.arrivals({ at: "2026-09-04", day: 0 }).arrivals).toEqual([]);
    expect(p.deriveFor(id, "2026-09-04")?.reason).toBe("no-event-date");
  });

  test("a hand-written firing row does NOT make a memory prospective", () => {
    const s = store();
    // Year-only precision: the memory can never tactfully arrive.
    const id = dated(s, "2026");
    s.setProspective({
      memoryId: id,
      windowKey: "d:2026-09-04",
      eventDate: "2026-09-04",
      precision: "day",
      state: "armed",
    });
    expect(s.prospectiveFor(id)).toHaveLength(1);

    const result = engine(s).arrivals({ at: "2026-09-04", day: 0 });
    expect(result.arrivals).toEqual([]);
    expect(result.refused).toEqual([{ memoryId: id, reason: "year-only-precision" }]);
  });

  test("a row cannot outlive its memory's eligibility — firing re-derives every time", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    expect(p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 1 }).fired).toBe(
      true,
    );
    s.archive(id, "moved on");
    const out = p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 2 });
    expect(out.fired).toBe(false);
    expect(out.reason).toBe<FireReason>("not-eligible");
    expect(out.derivation).toBe<DeriveReason>("archived");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Lifecycle: armed → fired → referenced / suppressed, at most once per window
// ═══════════════════════════════════════════════════════════════════════════

describe("window lifecycle — armed, fired, and the four once-ness brakes", () => {
  test("arm records a real `armed` row, keyed by the window", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const out = engine(s).arm(id, "d:2026-09-04");
    expect(out.recorded).toBe(true);
    expect(out.reason).toBe("recorded");
    expect(out.state).toBe("armed");
    const row = s.prospectiveFor(id)[0];
    expect(row?.window_key).toBe("d:2026-09-04");
    expect(row?.event_date).toBe("2026-09-04");
    expect(row?.precision).toBe("day");
    expect(windowStateOf(row)).toBe("armed");
    expect(row?.fires).toBe(0);
    expect(row?.last_fired_day).toBeNull();
  });

  test("arm refuses a malformed key and an unknown memory, by name", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    expect(engine(s).arm(id, "whenever").reason).toBe("malformed-window-key");
    expect(engine(s).arm("mem_nope", "d:2026-09-04").reason).toBe("unknown-memory");
  });

  test("one fire per occasion per LIVED day (brake 1), then the window cap (brake 2)", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    const at = "2026-09-04";

    const first = p.fire({ memoryId: id, windowKey: "d:2026-09-04", at, day: 5 });
    expect(first.fired).toBe(true);
    expect(first.fires).toBe(1);
    expect(first.state).toBe("fired");

    const same = p.fire({ memoryId: id, windowKey: "d:2026-09-04", at, day: 5 });
    expect(same.fired).toBe(false);
    expect(same.reason).toBe<FireReason>("already-fired-today");
    expect(same.fires).toBe(1);

    const next = p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-05", day: 6 });
    expect(next.fired).toBe(true);
    expect(next.fires).toBe(T.FIRES_PER_WINDOW);

    const over = p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-06", day: 7 });
    expect(over.fired).toBe(false);
    expect(over.reason).toBe<FireReason>("over-fired");
    expect(over.fires).toBe(T.FIRES_PER_WINDOW);
  });

  test("session dedup is brake 3, and it is per session", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    expect(
      p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5, sessionId: "s1" })
        .fired,
    ).toBe(true);
    const again = p.fire({
      memoryId: id,
      windowKey: "d:2026-09-04",
      at: "2026-09-05",
      day: 6,
      sessionId: "s1",
    });
    expect(again.reason).toBe<FireReason>("session-dedup");
    const other = p.fire({
      memoryId: id,
      windowKey: "d:2026-09-04",
      at: "2026-09-05",
      day: 6,
      sessionId: "s2",
    });
    expect(other.fired).toBe(true);
  });

  test("referenced-stop is brake 4, and it is DECISIVE — budget left or not", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    expect(p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5 }).fires).toBe(
      1,
    );
    // One fire of two spent: the budget is NOT what stops it.
    const ref = p.reference(id, "d:2026-09-04", 5);
    expect(ref.recorded).toBe(true);
    expect(ref.state).toBe("suppressed");

    const after = p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-05", day: 6 });
    expect(after.fired).toBe(false);
    expect(after.reason).toBe<FireReason>("already-referenced");
    expect(s.prospectiveFor(id)[0]?.fires).toBe(1);
  });

  test("a memory can be referenced without ever having fired — the user raised it", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    expect(p.reference(id, "d:2026-09-04").recorded).toBe(true);
    expect(windowStateOf(s.prospectiveFor(id)[0])).toBe("suppressed");
    expect(p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5 }).reason).toBe(
      "already-referenced",
    );
  });

  test("the firing key IS the window: a spent window can never be re-armed (§12 G9)", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5 });
    p.reference(id, "d:2026-09-04", 5);
    // A clock repair, a replayed hook, a stale caller: all of them arrive here.
    const rearm = p.arm(id, "d:2026-09-04");
    expect(rearm.state).toBe("suppressed");
    expect(s.prospectiveFor(id)[0]?.fires).toBe(1);
  });

  test("a window outside its bounds cannot fire, and says which side", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    expect(
      p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-08-20", day: 1 }).reason,
    ).toBe<FireReason>("window-not-open");
    const late = p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-12", day: 9 });
    // Past the grace days the memory is not prospective AT ALL any more.
    expect(late.reason).toBe<FireReason>("not-eligible");
    expect(late.derivation).toBe<DeriveReason>("window-passed");
  });

  test("firing an unknown memory, and a key the memory does not derive", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    expect(
      p.fire({ memoryId: "mem_nope", windowKey: "d:2026-09-04", at: "2026-09-04" }).reason,
    ).toBe<FireReason>("unknown-memory");
    const wrong = p.fire({ memoryId: id, windowKey: "m:2026-09", at: "2026-09-04", day: 5 });
    expect(wrong.reason).toBe<FireReason>("window-not-derived");
    expect(s.prospectiveFor(id)).toEqual([]);
  });

  test("a month window and a day window on one memory are separate budgets", () => {
    const s = store();
    const id = put(s, { meta: { eventDates: ["2026-09-04", "2026-09"] } });
    const p = engine(s);
    expect(p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5 }).fired).toBe(
      true,
    );
    expect(p.fire({ memoryId: id, windowKey: "m:2026-09", at: "2026-09-04", day: 5 }).fired).toBe(
      true,
    );
    expect(s.prospectiveFor(id).map((r) => r.window_key)).toEqual(["d:2026-09-04", "m:2026-09"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Arrival is a cue, not a command. There is no bypass lane. (§12 G1, §5 G1)
// ═══════════════════════════════════════════════════════════════════════════

describe("arrival is a cue, not a command — no bypass lane", () => {
  /** Anything that could put words in front of a user. */
  const FORBIDDEN =
    /(render|inject|format|compose|prompt|wording|phrase|template|briefing|sentence|speak|announce|remind)/i;

  function sources(): { name: string; code: string }[] {
    return readdirSync(SRC)
      .filter((f) => f.endsWith(".ts"))
      .map((name) => ({ name, code: readFileSync(join(SRC, name), "utf8") }));
  }

  /** Comments say the words on purpose; only CODE is scanned. */
  function stripComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  }

  test("the module exports NO function that could produce text", () => {
    const runtime = Object.entries(prospective)
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k);
    expect(runtime.length).toBeGreaterThan(5);
    for (const name of runtime) expect(name).not.toMatch(FORBIDDEN);

    const methods = Object.getOwnPropertyNames(Prospective.prototype).filter(
      (n) => n !== "constructor",
    );
    expect(methods).toContain("arrivals");
    for (const name of methods) expect(name).not.toMatch(FORBIDDEN);
  });

  test("no source file in the module declares or calls a renderer", () => {
    for (const { name, code } of sources()) {
      const bare = stripComments(code);
      const declared = [...bare.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)]
        .map((m) => m[1] ?? "")
        .filter((n) => FORBIDDEN.test(n));
      expect({ file: name, declared }).toEqual({ file: name, declared: [] });
      expect({ file: name, calls: /\b(render|inject)\w*\s*\(/.test(bare) }).toEqual({
        file: name,
        calls: false,
      });
    }
  });

  test("an arrived window produces a CANDIDATE with a weight and a tier ceiling", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const result = engine(s).arrivals({ at: "2026-09-04", day: 5 });
    expect(result.arrivals).toHaveLength(1);
    const a = result.arrivals[0] as Arrival;
    expect(a.memoryId).toBe(id);
    expect(a.windowKey).toBe("d:2026-09-04");
    expect(a.ramp).toBeCloseTo(1, 10);
    expect(a.cueWeight).toBeCloseTo(T.CUE_STRENGTH, 10);
    // §12 G5: a temporal cue alone reaches the footnote tier AT MOST.
    expect(a.maxTier).toBe(TEMPORAL_MAX_TIER);
    expect(TEMPORAL_MAX_TIER).toBe("footnoted");
    expect(a.state).toBe("armed");
    expect(a.fires).toBe(0);
  });

  test("the cue weight is never more than CUE_STRENGTH, anywhere in the window", () => {
    const s = store();
    dated(s, "2026-09-04");
    const p = engine(s);
    for (const at of ["2026-09-01", "2026-09-02", "2026-09-04", "2026-09-08", "2026-09-11"]) {
      const a = p.arrivals({ at, day: 5 }).arrivals[0] as Arrival;
      expect(a.cueWeight).toBeLessThanOrEqual(T.CUE_STRENGTH + 1e-12);
      expect(a.cueWeight).toBeGreaterThan(0);
    }
  });

  test("an arrival carries no prose — the words are not this module's to hold", () => {
    const s = store();
    dated(s, "2026-09-04", { title: "Portland move" });
    const p = engine(s);
    const shown = JSON.stringify(p.arrivals({ at: "2026-09-04", day: 5 }));
    expect(shown).not.toContain("Portland");
    expect(shown).not.toContain(BODY);
    const horizon = JSON.stringify(p.horizon({ at: "2026-09-04", day: 5 }));
    expect(horizon).not.toContain("Portland");
    expect(horizon).not.toContain(BODY);
  });

  test("computing arrivals spends NOTHING — no row, no fire, no state", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    const before = JSON.stringify(s.prospectiveFor(id));
    for (let i = 0; i < 5; i++) p.arrivals({ at: "2026-09-04", day: 5, sessionId: "s1" });
    p.horizon({ at: "2026-09-04", day: 5, sessionId: "s1" });
    expect(JSON.stringify(s.prospectiveFor(id))).toBe(before);
    expect(s.prospectiveFor(id)).toEqual([]);
    expect(s.events("store.prospective")).toEqual([]);
  });

  test("the horizon returns records, capped, ordered — never lines", () => {
    const s = store();
    for (let i = 0; i < 5; i++) dated(s, "2026-09-04", { body: `${BODY} #${i}` });
    const h = engine(s).horizon({ at: "2026-09-04", day: 5 });
    expect(h.reason).toBe("selected");
    expect(h.items).toHaveLength(T.HORIZON_ITEMS);
    expect(h.considered.arrivals.length).toBe(5);
    for (const item of h.items) expect(Object.keys(item)).not.toContain("text");
  });

  test("nothing arriving is its own reason, not an empty line", () => {
    const s = store();
    dated(s, "2026-12-25");
    const h = engine(s).horizon({ at: "2026-09-04", day: 5 });
    expect(h.reason).toBe("nothing-arrived");
    expect(h.items).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suppression: distinct reasons, and crisis deference outranks everything
// ═══════════════════════════════════════════════════════════════════════════

describe("suppression reasons are distinct", () => {
  test("a pending window and a passed window are different records", () => {
    const s = store();
    const early = dated(s, "2026-12-25");
    const late = dated(s, "2026-08-01");
    const result = engine(s).arrivals({ at: "2026-09-04", day: 5 });
    expect(result.arrivals).toEqual([]);
    expect(result.suppressed).toEqual([
      { memoryId: early, windowKey: "d:2026-12-25", reason: "window-not-open" },
    ]);
    // The passed one is not "suppressed": it stopped being prospective at all.
    expect(result.refused).toEqual([{ memoryId: late, reason: "window-passed" }]);
  });

  test("every brake has its own reason, and no two collide", () => {
    const s = store();
    const p = engine(s);
    const seen = new Map<SuppressReason, string>();

    const pending = dated(s, "2026-12-25", { body: `${BODY} pending` });
    const referenced = dated(s, "2026-09-04", { body: `${BODY} referenced` });
    const overFired = dated(s, "2026-09-04", { body: `${BODY} overfired` });
    const firedToday = dated(s, "2026-09-04", { body: `${BODY} today` });
    const deduped = dated(s, "2026-09-04", { body: `${BODY} dedup` });
    const retired = dated(s, "2026-09-04", { body: `${BODY} retired` });

    p.reference(referenced, "d:2026-09-04", 5);
    p.fire({ memoryId: overFired, windowKey: "d:2026-09-04", at: "2026-09-04", day: 4 });
    p.fire({ memoryId: overFired, windowKey: "d:2026-09-04", at: "2026-09-05", day: 5 });
    p.fire({ memoryId: firedToday, windowKey: "d:2026-09-04", at: "2026-09-04", day: 6 });
    p.fire({
      memoryId: deduped,
      windowKey: "d:2026-09-04",
      at: "2026-09-04",
      day: 5,
      sessionId: "s1",
    });
    p.expire(retired, "d:2026-09-04", "retired by hand");

    const result = p.arrivals({ at: "2026-09-05", day: 6, sessionId: "s1" });
    for (const r of result.suppressed) seen.set(r.reason, r.memoryId);
    expect(seen.get("window-not-open")).toBe(pending);
    expect(seen.get("already-referenced")).toBe(referenced);
    expect(seen.get("over-fired")).toBe(overFired);
    expect(seen.get("already-fired-today")).toBe(firedToday);
    expect(seen.get("session-dedup")).toBe(deduped);
    expect(seen.get("stale-window")).toBe(retired);
    expect(seen.size).toBe(6);
    expect(new Set(result.suppressed.map((r) => r.memoryId)).size).toBe(6);
  });

  test("crisis deference suppresses arrival cues wholesale, and outranks every brake", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    const result = p.arrivals({ at: "2026-09-04", day: 5, refractory: true });
    expect(result.arrivals).toEqual([]);
    expect(result.suppressed).toEqual([
      { memoryId: id, windowKey: "d:2026-09-04", reason: "refractory" },
    ]);
    const out = p.fire({
      memoryId: id,
      windowKey: "d:2026-09-04",
      at: "2026-09-04",
      day: 5,
      refractory: true,
    });
    expect(out.reason).toBe<FireReason>("refractory");
    expect(s.prospectiveFor(id)).toEqual([]);
  });

  test("the horizon beat is suppressed WHOLESALE after a high-affect session (§12 G7)", () => {
    const s = store();
    dated(s, "2026-09-04");
    const h = engine(s).horizon({ at: "2026-09-04", day: 5, previousSessionHighAffect: true });
    expect(h.reason).toBe("high-affect-previous-session");
    expect(h.suppressedWholesale).toBe(true);
    expect(h.items).toEqual([]);
    // The arrival itself still exists — the beat is deferred, not the memory.
    expect(h.considered.arrivals).toHaveLength(1);
  });

  test("a never-asked window stays out of telemetry, a refused fire does not (scar §2.4)", () => {
    const s = store();
    const pending = dated(s, "2026-12-25");
    const arrived = dated(s, "2026-09-04");
    const p = engine(s);
    p.reference(arrived, "d:2026-09-04", 5);
    p.arrivals({ at: "2026-09-04", day: 5 });
    const names = p.events("prospective.suppressed");
    expect(names).toHaveLength(1);
    expect(names[0]?.ref).toBe(arrived);
    expect(names[0]?.data?.["reason"]).toBe("already-referenced");
    expect(names.some((e) => e.ref === pending)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Reschedule: a gated compare-and-swap, and a fresh budget (§12 G8, G9)
// ═══════════════════════════════════════════════════════════════════════════

describe("reschedule — the gated compare-and-swap", () => {
  test("a stale proposal cannot clobber a fresher date", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const out = engine(s).reschedule({
      memoryId: id,
      expectCurrentDate: "2026-08-20",
      nextDate: "2026-10-02",
      at: "2026-09-01",
    });
    expect(out.rescheduled).toBe(false);
    expect(out.reason).toBe("stale-proposal");
    expect(s.prospectiveFor(id)).toEqual([]);
  });

  test("an unchanged or unreadable proposal is refused by name", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    expect(
      p.reschedule({
        memoryId: id,
        expectCurrentDate: "2026-09-04",
        nextDate: "2026-09-04",
        at: "2026-09-01",
      }).reason,
    ).toBe("unchanged");
    expect(
      p.reschedule({
        memoryId: id,
        expectCurrentDate: "2026-09-04",
        nextDate: "next autumn",
        at: "2026-09-01",
      }).reason,
    ).toBe("malformed-date");
    expect(
      p.reschedule({
        memoryId: "mem_nope",
        expectCurrentDate: "2026-09-04",
        nextDate: "2026-10-02",
        at: "2026-09-01",
      }).reason,
    ).toBe("unknown-memory");
  });

  test("the old window is retired and KEPT; the fresh one owes it nothing (§12 G9)", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    // Spend the old window's whole budget first.
    p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 4 });
    p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-05", day: 5 });
    expect(
      p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-06", day: 6 }).reason,
    ).toBe<FireReason>("over-fired");

    const out = p.reschedule({
      memoryId: id,
      expectCurrentDate: "2026-09-04",
      nextDate: "2026-10-02",
      at: "2026-09-06",
      reason: "truck rebooked",
    });
    expect(out.rescheduled).toBe(true);
    expect(out.retiredKey).toBe("d:2026-09-04");
    expect(out.armedKey).toBe("d:2026-10-02");

    const rows = s.prospectiveFor(id);
    const old = rows.find((r) => r.window_key === "d:2026-09-04");
    const fresh = rows.find((r) => r.window_key === "d:2026-10-02");
    // Nothing is destroyed: the spent window is kept, with its spent count.
    expect(windowStateOf(old)).toBe("expired");
    expect(old?.fires).toBe(T.FIRES_PER_WINDOW);
    expect(windowStateOf(fresh)).toBe("armed");
    expect(fresh?.fires).toBe(0);

    // The caller's half: the memory's own stated date moves (INTERFACE-GAPS #4).
    s.revise(id, { meta: { [EVENT_DATE_META]: "2026-10-02" }, reason: "truck rebooked" });
    const fired = p.fire({ memoryId: id, windowKey: "d:2026-10-02", at: "2026-10-02", day: 20 });
    expect(fired.fired).toBe(true);
    expect(fired.fires).toBe(1);
  });

  test("until the memory's own date moves, the fresh window stays quiet — fail-safe", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    p.reschedule({
      memoryId: id,
      expectCurrentDate: "2026-09-04",
      nextDate: "2026-10-02",
      at: "2026-09-01",
    });
    const out = p.fire({ memoryId: id, windowKey: "d:2026-10-02", at: "2026-10-02", day: 20 });
    expect(out.reason).toBe<FireReason>("not-eligible");
    expect(out.derivation).toBe<DeriveReason>("window-passed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Observer: arrivals may be read; state transitions refuse (scar E7, §5 G9)
// ═══════════════════════════════════════════════════════════════════════════

describe("observer — reads are welcome, firing state never advances", () => {
  test("an observer may compute arrivals, the horizon, derivation and exits", () => {
    const live = store();
    const id = dated(live, "2026-09-04");
    live.close();
    opened.splice(opened.indexOf(live), 1);

    const s = store({ observer: true });
    const p = engine(s);
    expect(p.observer).toBe(true);
    const result = p.arrivals({ at: "2026-09-04", day: 5 });
    expect(result.observer).toBe(true);
    expect(result.arrivals.map((a) => a.memoryId)).toEqual([id]);
    expect(p.horizon({ at: "2026-09-04", day: 5 }).items).toHaveLength(1);
    expect(p.deriveFor(id, "2026-09-04")?.reason).toBe("eligible");
    expect(p.exitReport("2026-09-04", 5).counts.open).toBe(1);
  });

  test("every transition refuses under observer, and every stand-down is observable", () => {
    const live = store();
    const id = dated(live, "2026-09-04");
    live.close();
    opened.splice(opened.indexOf(live), 1);

    const s = store({ observer: true });
    const p = engine(s);
    expect(p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5 })).toEqual({
      fired: false,
      reason: "observer",
      derivation: null,
      fires: 0,
      state: "armed",
    });
    expect(p.arm(id, "d:2026-09-04").reason).toBe("observer");
    expect(p.reference(id, "d:2026-09-04").reason).toBe("observer");
    expect(p.expire(id, "d:2026-09-04").reason).toBe("observer");
    expect(
      p.reschedule({
        memoryId: id,
        expectCurrentDate: "2026-09-04",
        nextDate: "2026-10-02",
        at: "2026-09-04",
      }).reason,
    ).toBe("observer");

    const sites = p.events("prospective.observer.standdown").map((e) => e.data?.["site"]);
    expect(sites).toEqual(["fire", "arm", "reference", "expire", "reschedule"]);
    expect(s.prospectiveFor(id)).toEqual([]);
  });

  test("an instrument leaves the firing state byte-identical", () => {
    const live = store();
    const id = dated(live, "2026-09-04");
    engine(live).fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5 });
    const before = JSON.stringify(live.prospectiveFor(id));
    live.close();
    opened.splice(opened.indexOf(live), 1);

    const s = store({ observer: true });
    const p = engine(s);
    for (let i = 0; i < 3; i++) {
      p.arrivals({ at: "2026-09-05", day: 6 });
      p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-05", day: 6 });
      p.reference(id, "d:2026-09-04", 6);
    }
    expect(JSON.stringify(s.prospectiveFor(id))).toBe(before);
  });

  test("the store seam refuses too — the module's check is a courtesy, not the wall", () => {
    const live = store();
    const id = dated(live, "2026-09-04");
    live.close();
    opened.splice(opened.indexOf(live), 1);

    const s = store({ observer: true });
    let code = "";
    try {
      s.setProspective({
        memoryId: id,
        windowKey: "d:2026-09-04",
        eventDate: "2026-09-04",
        precision: "day",
        state: "armed",
      });
    } catch (err) {
      code = err instanceof StoreError ? err.code : "UNKNOWN";
    }
    expect(code).toBe("OBSERVER_REFUSED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Exits: every dated memory names its exit (§5 G12, scar §2.17)
// ═══════════════════════════════════════════════════════════════════════════

describe("exits — every dated memory names its exit", () => {
  test("open, fired and referenced are counted apart", () => {
    const s = store();
    const open = dated(s, "2026-12-25", { body: `${BODY} open` });
    const fired = dated(s, "2026-09-04", { body: `${BODY} fired` });
    const referenced = dated(s, "2026-09-04", { body: `${BODY} referenced` });
    const p = engine(s);
    p.fire({ memoryId: fired, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5 });
    p.reference(referenced, "d:2026-09-04", 5);

    const report = p.exitReport("2026-09-04", 5);
    const kindOf = (id: string): ExitKind | undefined =>
      report.exits.find((e) => e.memoryId === id)?.kind;
    expect(kindOf(open)).toBe("open");
    expect(kindOf(fired)).toBe("fired");
    expect(kindOf(referenced)).toBe("referenced");
    expect(report.counts.open).toBe(1);
    expect(report.counts.fired).toBe(1);
    expect(report.counts.referenced).toBe(1);
  });

  test("a window that closed unremarked EXPIRES; one whose memory faded first FADES", () => {
    const s = store();
    const expired = dated(s, "2026-09-04", { body: `${BODY} expired` });
    const report = engine(s).exitReport("2026-09-20", 5);
    expect(report.exits.find((e) => e.memoryId === expired)?.kind).toBe("expired");

    // Same window, same store, same clock — only the LIVED DAY being asked about
    // moves, and the memory has decayed into insignificance by then (§12 G10 —
    // forgetting it is memory working, not a miss). The store's own clock stays
    // at 0, so this fails if strength is read from the clock instead of `day`.
    expect(s.livedDay()).toBe(0);
    const faded = engine(s).exitReport("2026-09-20", 900);
    expect(faded.exits.find((e) => e.memoryId === expired)?.kind).toBe("faded");
  });

  test("a rescheduled window exits as superseded, not as expired", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    p.reschedule({
      memoryId: id,
      expectCurrentDate: "2026-09-04",
      nextDate: "2026-10-02",
      at: "2026-09-01",
    });
    s.revise(id, { meta: { [EVENT_DATE_META]: "2026-10-02" }, reason: "rescheduled" });

    const report = p.exitReport("2026-09-30", 8);
    const byKey = new Map(report.exits.map((e) => [e.windowKey, e.kind]));
    expect(byKey.get("d:2026-09-04")).toBe("superseded-by-reschedule");
    expect(byKey.get("d:2026-10-02")).toBe("open");
    expect(report.counts["superseded-by-reschedule"]).toBe(1);
  });

  test("nothing is swept: the exit report is a question, not a pass", () => {
    const s = store();
    const id = dated(s, "2026-09-04");
    const p = engine(s);
    p.arm(id, "d:2026-09-04");
    const before = JSON.stringify(s.prospectiveFor(id));
    p.exitReport("2027-01-01", 200);
    p.exitReport("2027-01-01", 200);
    expect(JSON.stringify(s.prospectiveFor(id))).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Telemetry: ids, keys, counts, reasons — never body text
// ═══════════════════════════════════════════════════════════════════════════

describe("telemetry is content-by-reference", () => {
  test("fire, suppress and reference are all logged by id, with reasons", () => {
    const s = store();
    const id = dated(s, "2026-09-04", { title: "Portland move" });
    const p = engine(s);
    p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5 });
    p.reference(id, "d:2026-09-04", 5);
    p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-05", day: 6 });

    const fired = p.events("prospective.fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]?.ref).toBe(id);
    expect(fired[0]?.data?.["window"]).toBe("d:2026-09-04");
    expect(fired[0]?.data?.["fires"]).toBe(1);

    expect(p.events("prospective.referenced")).toHaveLength(1);
    const refused = p.events("prospective.fire.refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.data?.["reason"]).toBe("already-referenced");
  });

  test("no event ever carries body text or a title", () => {
    const s = store();
    const id = dated(s, "2026-09-04", { title: "Portland move" });
    const p = engine(s);
    p.arrivals({ at: "2026-09-04", day: 5 });
    p.fire({ memoryId: id, windowKey: "d:2026-09-04", at: "2026-09-04", day: 5 });
    p.horizon({ at: "2026-09-04", day: 5 });
    p.exitReport("2026-09-04", 5);
    const dump = JSON.stringify(p.events());
    expect(dump).not.toContain("Portland");
    expect(dump).not.toContain("truck");
    expect(dump.length).toBeGreaterThan(50);
  });
});
