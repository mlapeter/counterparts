/**
 * `prospective/` — remembering to act. Know that the remembered future has
 * arrived, and be *inclined* rather than *reminded*.
 *
 * The module's spine:
 *
 *   `windows.ts`   precision, window bounds, the ramp, the firing KEY
 *   `derive.ts`    the eligibility predicate — derived, never stored
 *   `tunables.ts`  every knob, in one visible place
 *   `index.ts`     arrivals (read) + the firing-state transitions (write)
 *
 * Three properties are structural here and worth stating at the top:
 *
 * **ARRIVAL IS A CUE, NOT A COMMAND. THERE IS NO BYPASS LANE.** The calendar
 * turning to June is treated exactly like the user saying "Portland": one more
 * cue offered into `recall/`'s ordinary activation → gate → tier competition,
 * under the same floors, refractory, dedup and footnote-first tiering as
 * everything else. This module therefore has **no export that produces text** —
 * no render, no injection, no wording, not even a template. It hands out
 * candidates and weights; whether anything is ever said is entirely `recall/`'s
 * decision, made against the same bars as every other memory. A test enumerates
 * this module's exports and asserts the absence (contract §5 G1).
 *
 * **The tact principle IS the spec.** A system that surfaces every stored
 * commitment at first retrievability is a task queue wearing memory's clothes.
 * Hold debts, lose deadlines. Every brake here answers one question: *is this the
 * moment it MEANS something, or merely the first moment it's retrievable?*
 *
 * **Firing state is not canonical memory** (§12 G12). Losing a row risks one
 * extra polite mention, never a memory — so the write budget is small and loud:
 * transitions never stall a host-facing path, and every refusal has a name.
 */
import type { Kind } from "../types.js";
import { strength } from "../physics/index.js";
import type { UseTier } from "../physics/index.js";
import type { ProseDoc, ProspectiveInput, ProspectiveRow, Store } from "../store/index.js";
import { derive } from "./derive.js";
import type { DerivableMemory, DeriveReason, ExtractedDate, Prospectivity } from "./derive.js";
import { TEMPORAL_MAX_TIER, withTunables } from "./tunables.js";
import type { ProspectiveTunables } from "./tunables.js";
import { parseWindowKey, phaseOf, precisionOf, rampAt, windowFor } from "./windows.js";
import type { DatePrecision, Phase, Window, WindowPrecision } from "./windows.js";

export * from "./derive.js";
export * from "./tunables.js";
export * from "./windows.js";

/**
 * The durable lifecycle, in the store's own four-value vocabulary:
 *
 *   `armed`      a derived window with no fires spent
 *   `fired`      at least one ambient fire spent this window; budget may remain
 *   `suppressed` TERMINAL by referenced-stop — the decisive brake (§12 G6)
 *   `expired`    TERMINAL because the window closed, or a reschedule replaced it
 *
 * `expired` is also the DERIVED reading of a row nobody stamped: a passed window
 * needs no cleanup pass to stop mattering (§12 G2). Nothing here sweeps.
 */
export type WindowState = ProspectiveInput["state"];

const WINDOW_STATES: readonly WindowState[] = ["armed", "fired", "suppressed", "expired"];

/** Box 2 hands back `state` as TEXT. An unrecognized value reads as `armed` — the
 *  direction that costs at most one polite mention, never a silent terminal. */
export function windowStateOf(row: ProspectiveRow | undefined): WindowState {
  const s = row?.state;
  return WINDOW_STATES.find((x) => x === s) ?? "armed";
}

/** Distinct reasons, because a suppressed fire and a fire that never became
 *  eligible are different records (scar §2.4). */
export type SuppressReason =
  /** Crisis deference (§12 G7). A friend doesn't pivot from the ashes to "so, June!". */
  | "refractory"
  /** The window has not opened yet. */
  | "window-not-open"
  /** The window closed, or was terminally retired. The "stale" case. */
  | "stale-window"
  /** Brake 4, the decisive one: the assistant was observed to have USED the
   *  memory, so zero further fires this window. Remembering completes by being
   *  lived, not by acknowledgment UI. */
  | "already-referenced"
  /** Brake 2: the per-window cap is spent. */
  | "over-fired"
  /** Brake 1: at most one ambient fire per occasion per LIVED day. */
  | "already-fired-today"
  /** Brake 3: already offered in this session. */
  | "session-dedup";

export type FireReason =
  | "fired"
  | "observer"
  | "unknown-memory"
  /** The memory no longer derives as prospective at all; `derivation` says why. */
  | "not-eligible"
  /** Eligible, but this key is not one of the memory's derived windows — the
   *  shape a stale caller takes after a reschedule. */
  | "window-not-derived"
  | SuppressReason;

export type TransitionReason =
  | "recorded"
  | "observer"
  | "unknown-memory"
  | "malformed-window-key";

export type RescheduleReason =
  | "rescheduled"
  | "observer"
  | "unknown-memory"
  /** The proposal named a current value that is not the current value. A stale
   *  proposal must never clobber a fresher date (§12 G8). */
  | "stale-proposal"
  | "malformed-date"
  | "unchanged";

/** Telemetry: ids, window keys, counts, states, reasons. NEVER body text. */
export interface ProspectiveEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface ProspectiveOptions {
  store: Store;
  /** Overrides on the CAL table. Every one is a calibration claim (scar §2.8). */
  tunables?: Partial<ProspectiveTunables>;
  onEvent?: (e: ProspectiveEvent) => void;
  /** Injectable wall clock, for telemetry stamps only. Never a lived day. */
  now?: () => number;
}

/**
 * One arrived window, offered as a CUE. Note what is absent: no text, no
 * phrasing, no "should surface" boolean. `cueWeight` and `maxTier` are inputs to
 * somebody else's competition.
 */
export interface Arrival {
  readonly memoryId: string;
  readonly windowKey: string;
  /** As stated. A month stays a month (§12 G4). */
  readonly eventDate: string;
  readonly precision: WindowPrecision;
  readonly opensOn: string;
  readonly peakOn: string;
  readonly closesOn: string;
  /** 0..1 — how loudly the window is arriving today. */
  readonly ramp: number;
  /** The weight this arrival offers `recall/`'s CUE stage: CUE_STRENGTH x ramp.
   *  It is one more cue token's worth of activation, not a channel of its own
   *  (INTERFACE-GAPS #1 — do NOT confuse it with recall's `ARRIVAL_WEIGHT`,
   *  which is base-level recency and something else entirely). */
  readonly cueWeight: number;
  /** §12 G5: a temporal cue alone reaches the footnote tier AT MOST. */
  readonly maxTier: UseTier;
  readonly state: WindowState;
  readonly fires: number;
  readonly lastFiredDay: number | null;
  /** Decayed strength on `day`, for ORDERING only. No decay exemption before
   *  arrival (§12 G10): a future-dated memory that faded before its window was
   *  an occasion that didn't matter. */
  readonly strength: number;
}

export interface SuppressionRecord {
  readonly memoryId: string;
  readonly windowKey: string;
  readonly reason: SuppressReason;
}

export interface ArrivalInput {
  /** The calendar day being asked about, `YYYY-MM-DD`. An ARGUMENT, never a
   *  clock read — "was this arriving on July 5th?" is the same code path. */
  readonly at: string;
  /** The LIVED day, for the once-per-day brake. Defaults to the store's clock. */
  readonly day?: number;
  readonly sessionId?: string;
  /** Crisis deference (§12 G7): suppress arrival cues wholesale. */
  readonly refractory?: boolean;
  /** Extra caller-extracted dates by memory id, merged with the memory's own
   *  content dates. This module does NO NLP; whoever read the sentence owns it. */
  readonly extraDates?: ReadonlyMap<string, readonly ExtractedDate[]>;
}

export interface ArrivalResult {
  readonly at: string;
  readonly day: number;
  readonly observer: boolean;
  /** Sorted by ramp x strength, descending. Candidates, not decisions. */
  readonly arrivals: Arrival[];
  /** Windows that would have arrived and did not, each with its own reason. */
  readonly suppressed: SuppressionRecord[];
  /** Live memories examined. */
  readonly considered: number;
  /** Memories whose derivation refused, by name. This is where "a row exists but
   *  the memory is no longer prospective" shows up — the row is firing state, it
   *  is never evidence of prospectivity (§12 G2). */
  readonly refused: { memoryId: string; reason: DeriveReason }[];
}

export type HorizonReason =
  | "selected"
  | "nothing-arrived"
  /** The horizon beat is suppressed WHOLESALE after a high-affect previous
   *  session (§12 G7). A window is days wide; deferring costs nothing. */
  | "high-affect-previous-session";

export interface HorizonInput extends ArrivalInput {
  readonly previousSessionHighAffect?: boolean;
}

export interface HorizonResult {
  readonly items: Arrival[];
  readonly reason: HorizonReason;
  readonly suppressedWholesale: boolean;
  readonly considered: ArrivalResult;
}

export interface FireInput {
  readonly memoryId: string;
  readonly windowKey: string;
  readonly at: string;
  readonly day?: number;
  readonly sessionId?: string;
  readonly refractory?: boolean;
  readonly dates?: readonly ExtractedDate[];
}

export interface FireOutcome {
  readonly fired: boolean;
  readonly reason: FireReason;
  /** Why derivation refused, when it did. Null otherwise. */
  readonly derivation: DeriveReason | null;
  readonly fires: number;
  readonly state: WindowState;
}

export interface TransitionOutcome {
  readonly recorded: boolean;
  readonly reason: TransitionReason;
  readonly state: WindowState;
}

export interface RescheduleInput {
  readonly memoryId: string;
  /** The compare half of the compare-and-swap: the exact current event date. */
  readonly expectCurrentDate: string;
  readonly nextDate: string;
  readonly at: string;
  readonly reason?: string;
  readonly dates?: readonly ExtractedDate[];
}

export interface RescheduleOutcome {
  readonly rescheduled: boolean;
  readonly reason: RescheduleReason;
  /** The retired window's key — kept, in state `expired`, never deleted. */
  readonly retiredKey: string | null;
  /** The fresh key, which owes nothing to the old one's spent budget (§12 G9). */
  readonly armedKey: string | null;
}

/** Every dated memory names its exit (§5 G12, scar §2.17). */
export type ExitKind =
  | "open"
  | "fired"
  | "referenced"
  | "superseded-by-reschedule"
  | "faded"
  | "expired";

export interface Exit {
  readonly memoryId: string;
  readonly windowKey: string;
  readonly kind: ExitKind;
  readonly fires: number;
}

export interface ExitReport {
  readonly at: string;
  readonly day: number;
  readonly counts: Record<ExitKind, number>;
  readonly exits: Exit[];
}

/** Where a memory's own content-dates live on the prose payload. */
export const EVENT_DATE_META = "eventDate";
export const EVENT_DATES_META = "eventDates";

/**
 * A memory's content-dates: `happenedOn` (stated precision, never rounded) plus
 * the `eventDate` / `eventDates` meta convention this module declares. SHAPE
 * ONLY — nothing here reads prose for dates. That is the caller's job, and its
 * output arrives through `extraDates` (INTERFACE-GAPS #2).
 */
export function contentDates(doc: ProseDoc): ExtractedDate[] {
  const out: ExtractedDate[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "string" && v !== "") out.push({ date: v });
  };
  push(doc.happenedOn);
  push(doc.meta[EVENT_DATE_META]);
  const many = doc.meta[EVENT_DATES_META];
  if (Array.isArray(many)) for (const v of many) push(v);
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true)));
}

interface Loaded {
  memory: DerivableMemory;
  doc: ProseDoc;
  dates: ExtractedDate[];
  strength: number;
}

const EXIT_KINDS: readonly ExitKind[] = [
  "open",
  "fired",
  "referenced",
  "superseded-by-reschedule",
  "faded",
  "expired",
];

export class Prospective {
  readonly store: Store;
  readonly tunables: ProspectiveTunables;
  /** One predicate, one definition: the store's. Never re-derived here
   *  (observer-mode.md G7, recall INTERFACE-GAPS #4). */
  readonly observer: boolean;

  private readonly onEvent: ((e: ProspectiveEvent) => void) | undefined;
  private readonly now: () => number;
  private readonly ring: ProspectiveEvent[] = [];
  /** Brake 3. In-process on purpose — see INTERFACE-GAPS #3. */
  private readonly sessionFired = new Map<string, Set<string>>();

  constructor(opts: ProspectiveOptions) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables ?? {});
    this.observer = opts.store.observer;
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? (() => Date.now());
  }

  // ── derivation (pure, read-time, observer-safe) ───────────────────────────

  /**
   * The predicate, against a memory the caller already has. Recomputed every
   * time: there is no stored answer to go stale (§12 G2).
   */
  derive(
    memory: DerivableMemory,
    dates: readonly ExtractedDate[],
    at: string,
  ): Prospectivity {
    return derive(memory, dates, at, this.tunables);
  }

  /** The same predicate, against a memory the STORE has. Reads only. */
  deriveFor(
    memoryId: string,
    at: string,
    extra: readonly ExtractedDate[] = [],
    day?: number,
  ): Prospectivity | null {
    const loaded = this.load(memoryId, extra, day ?? this.store.livedDay());
    if (loaded === null) return null;
    return derive(loaded.memory, loaded.dates, at, this.tunables);
  }

  // ── arrivals: candidates for recall's cue stage, never an injection ───────

  /**
   * Which windows have arrived, as CUES. This method writes nothing — not a row,
   * not a fire, not a byte — which is what makes it safe under observer and what
   * makes "arrival is a cue, not a command" a structural property rather than a
   * promise: the caller has to go back through `fire()` to spend anything, and
   * `recall/` gets to refuse in between.
   */
  arrivals(input: ArrivalInput): ArrivalResult {
    const day = input.day ?? this.store.livedDay();
    const arrivals: Arrival[] = [];
    const suppressed: SuppressionRecord[] = [];
    const refused: { memoryId: string; reason: DeriveReason }[] = [];
    const denied = new Set(this.store.deniedIds());
    const ids = this.store.list({ archived: false });
    let considered = 0;

    for (const id of ids) {
      if (denied.has(id)) continue;
      const row = this.store.row(id);
      // A superseded head forwards; the successor arrives on its own merits.
      if (row === undefined || row.superseded_by !== null) continue;
      const loaded = this.load(id, input.extraDates?.get(id) ?? [], day);
      if (loaded === null) continue;
      considered += 1;

      const p = derive(loaded.memory, loaded.dates, input.at, this.tunables);
      if (!p.eligible) {
        // Includes the load-bearing case: a firing-state row may well exist for
        // this memory, and it buys the memory nothing. The rows record what
        // fired; the predicate decides what is prospective.
        refused.push({ memoryId: id, reason: p.reason });
        continue;
      }

      const rows = this.rowsFor(id);
      for (const w of p.windows) {
        const stateRow = rows.get(w.key);
        const brake = this.brakeFor(w, stateRow, {
          at: input.at,
          day,
          refractory: input.refractory === true,
          sessionId: input.sessionId,
        });
        if (brake !== null) {
          suppressed.push({ memoryId: id, windowKey: w.key, reason: brake });
          continue;
        }
        const ramp = rampAt(w, input.at, this.tunables);
        arrivals.push({
          memoryId: id,
          windowKey: w.key,
          eventDate: w.eventDate,
          precision: w.precision,
          opensOn: w.opensOn,
          peakOn: w.peakOn,
          closesOn: w.closesOn,
          ramp,
          cueWeight: this.tunables.CUE_STRENGTH * ramp,
          maxTier: TEMPORAL_MAX_TIER,
          state: windowStateOf(stateRow),
          fires: stateRow?.fires ?? 0,
          lastFiredDay: stateRow?.last_fired_day ?? null,
          strength: loaded.strength,
        });
      }
    }

    arrivals.sort(
      (a, b) =>
        b.ramp * b.strength - a.ramp * a.strength || (a.windowKey < b.windowKey ? -1 : 1),
    );

    for (const s of suppressed) {
      // A window that has not opened yet was NEVER ASKED, which is a different
      // record from a fire that was refused (scar §2.4). It stays in the returned
      // list and out of the telemetry.
      if (s.reason === "window-not-open") continue;
      this.emit("prospective.suppressed", s.memoryId, {
        window: s.windowKey,
        reason: s.reason,
        day,
      });
    }
    this.emit("prospective.arrivals", undefined, {
      day,
      considered,
      arrived: arrivals.length,
      suppressed: suppressed.length,
      refused: refused.length,
      observer: this.observer,
    });
    return { at: input.at, day, observer: this.observer, arrivals, suppressed, considered, refused };
  }

  /**
   * The wake horizon: at most `HORIZON_ITEMS` arrivals, *remembered, not tasks*.
   * Returns the SAME `Arrival` records the cue path returns — ids and weights.
   * Whatever a host eventually says about them is the host's wording and the
   * host's decision; this module owns neither (open question 1: whether the
   * post-window grace beat is warm or creepy is deliberately unanswered).
   */
  horizon(input: HorizonInput): HorizonResult {
    const considered = this.arrivals(input);
    if (input.previousSessionHighAffect === true) {
      this.emit("prospective.horizon", undefined, {
        reason: "high-affect-previous-session",
        items: 0,
        arrived: considered.arrivals.length,
      });
      return {
        items: [],
        reason: "high-affect-previous-session",
        suppressedWholesale: true,
        considered,
      };
    }
    const items = considered.arrivals.slice(0, this.tunables.HORIZON_ITEMS);
    const reason: HorizonReason = items.length === 0 ? "nothing-arrived" : "selected";
    this.emit("prospective.horizon", undefined, {
      reason,
      items: items.length,
      arrived: considered.arrivals.length,
      ids: items.map((i) => i.memoryId).join(","),
    });
    return { items, reason, suppressedWholesale: false, considered };
  }

  // ── firing-state transitions (all refuse under observer) ──────────────────

  /**
   * Record a derived window as armed. Optional: `fire()` arms lazily, because
   * losing firing state costs one extra polite mention and never a memory
   * (§12 G12). It exists so `armed` is a real state a caller can assert on.
   *
   * It NEVER resurrects a terminal window: arming a spent key keeps the spent
   * state. The firing key is the window, so a clock repair — or a caller replaying
   * an old arm — cannot re-arm what is already done (§12 G9).
   */
  arm(memoryId: string, windowKey: string): TransitionOutcome {
    return this.write("arm", memoryId, windowKey, (parsed, row) => ({
      state: windowStateOf(row),
      fires: row?.fires ?? 0,
      lastFiredDay: row?.last_fired_day ?? null,
      eventDate: parsed.eventDate,
      precision: parsed.precision,
    }));
  }

  /**
   * Spend one ambient fire on one window, on one lived day.
   *
   * Eligibility is RE-DERIVED here, from the memory, every time — a row is never
   * permission. So a memory that was archived, faded below the floor, or
   * rescheduled since the row was written cannot fire, and the refusal says
   * which (§12 G2).
   *
   * A fire is a SURFACING THAT HAPPENED, not an offer that was made: the caller
   * records it after `recall/`'s gate admitted the memory. That split is the
   * whole of "arrival is a cue, not a command" — nothing in this module can
   * cause the surfacing whose budget it counts.
   */
  fire(input: FireInput): FireOutcome {
    const day = input.day ?? this.store.livedDay();
    if (this.observer) {
      // Checked FIRST, before any read or write: an evaluation must not consume
      // the real store's fire budget (scar E7, contract §5 G9).
      this.emit("prospective.observer.standdown", input.memoryId, {
        site: "fire",
        window: input.windowKey,
      });
      return { fired: false, reason: "observer", derivation: null, fires: 0, state: "armed" };
    }

    const loaded = this.load(input.memoryId, input.dates ?? [], day);
    if (loaded === null) {
      return { fired: false, reason: "unknown-memory", derivation: null, fires: 0, state: "armed" };
    }
    const p = derive(loaded.memory, loaded.dates, input.at, this.tunables);
    if (!p.eligible) {
      this.emit("prospective.fire.refused", input.memoryId, {
        window: input.windowKey,
        reason: "not-eligible",
        derivation: p.reason,
        day,
      });
      return { fired: false, reason: "not-eligible", derivation: p.reason, fires: 0, state: "armed" };
    }
    const w = p.windows.find((x) => x.key === input.windowKey);
    const rows = this.rowsFor(input.memoryId);
    const row = rows.get(input.windowKey);
    if (w === undefined) {
      this.emit("prospective.fire.refused", input.memoryId, {
        window: input.windowKey,
        reason: "window-not-derived",
        day,
      });
      return {
        fired: false,
        reason: "window-not-derived",
        derivation: null,
        fires: row?.fires ?? 0,
        state: windowStateOf(row),
      };
    }

    const brake = this.brakeFor(w, row, {
      at: input.at,
      day,
      refractory: input.refractory === true,
      sessionId: input.sessionId,
    });
    if (brake !== null) {
      this.emit("prospective.fire.refused", input.memoryId, {
        window: input.windowKey,
        reason: brake,
        day,
      });
      return {
        fired: false,
        reason: brake,
        derivation: null,
        fires: row?.fires ?? 0,
        state: windowStateOf(row),
      };
    }

    const fires = (row?.fires ?? 0) + 1;
    this.store.setProspective({
      memoryId: input.memoryId,
      windowKey: input.windowKey,
      eventDate: w.eventDate,
      precision: w.precision,
      state: "fired",
      fires,
      lastFiredDay: day,
    });
    if (input.sessionId !== undefined) this.markSession(input.sessionId, input.windowKey);
    this.emit("prospective.fired", input.memoryId, {
      window: input.windowKey,
      precision: w.precision,
      fires,
      cap: this.tunables.FIRES_PER_WINDOW,
      ramp: rampAt(w, input.at, this.tunables),
      day,
    });
    return { fired: true, reason: "fired", derivation: null, fires, state: "fired" };
  }

  /**
   * Brake 4, and the decisive one: the assistant was observed to have USED the
   * memory, so this window is done — zero further fires, whatever budget was
   * left. *Remembering completes by being lived, not by acknowledgment UI.*
   * Idempotent, and it does not care whether a fire ever happened: the user may
   * have raised the occasion themselves.
   */
  reference(memoryId: string, windowKey: string, day?: number): TransitionOutcome {
    const d = day ?? this.store.livedDay();
    return this.write("reference", memoryId, windowKey, (parsed, row) => ({
      state: "suppressed",
      fires: row?.fires ?? 0,
      lastFiredDay: row?.last_fired_day ?? null,
      eventDate: parsed.eventDate,
      precision: parsed.precision,
      extra: { day: d },
    }));
  }

  /**
   * Retire a window terminally. The row is KEPT in state `expired` — this module
   * destroys nothing, and the exit accounting needs it (§5 G12).
   */
  expire(memoryId: string, windowKey: string, reason = "window-closed"): TransitionOutcome {
    return this.write("expire", memoryId, windowKey, (parsed, row) => ({
      state: "expired",
      fires: row?.fires ?? 0,
      lastFiredDay: row?.last_fired_day ?? null,
      eventDate: parsed.eventDate,
      precision: parsed.precision,
      extra: { why: reason },
    }));
  }

  /**
   * A rescheduled plan, corrected through a GATED COMPARE-AND-SWAP (§12 G8): the
   * proposal names the exact current value, so a stale proposal cannot clobber a
   * fresher date. The old window is retired (kept, state `expired`) and a fresh
   * key is armed — and because **the firing key is the window**, the new window
   * owes nothing to the old one's spent budget (§12 G9).
   *
   * This half is the FIRING state only. Rewriting the memory's own stated date is
   * the caller's `store.revise` — see INTERFACE-GAPS #4.
   */
  reschedule(input: RescheduleInput): RescheduleOutcome {
    if (this.observer) {
      this.emit("prospective.observer.standdown", input.memoryId, { site: "reschedule" });
      return { rescheduled: false, reason: "observer", retiredKey: null, armedKey: null };
    }
    const loaded = this.load(input.memoryId, input.dates ?? [], this.store.livedDay());
    if (loaded === null) {
      return { rescheduled: false, reason: "unknown-memory", retiredKey: null, armedKey: null };
    }
    const nextPrecision = precisionOf(input.nextDate);
    const nextWindow =
      nextPrecision === null ? null : windowFor(input.nextDate, nextPrecision, this.tunables);
    if (nextWindow === null) {
      this.emit("prospective.reschedule.refused", input.memoryId, { reason: "malformed-date" });
      return { rescheduled: false, reason: "malformed-date", retiredKey: null, armedKey: null };
    }
    if (input.expectCurrentDate === input.nextDate) {
      this.emit("prospective.reschedule.refused", input.memoryId, { reason: "unchanged" });
      return { rescheduled: false, reason: "unchanged", retiredKey: null, armedKey: null };
    }

    const p = derive(loaded.memory, loaded.dates, input.at, this.tunables);
    const current = p.windows.find((w) => w.eventDate === input.expectCurrentDate);
    if (current === undefined) {
      // The compare half failing IS the guarantee working.
      this.emit("prospective.reschedule.refused", input.memoryId, {
        reason: "stale-proposal",
        expected: input.expectCurrentDate,
      });
      return { rescheduled: false, reason: "stale-proposal", retiredKey: null, armedKey: null };
    }

    const rows = this.rowsFor(input.memoryId);
    const old = rows.get(current.key);
    this.store.setProspective({
      memoryId: input.memoryId,
      windowKey: current.key,
      eventDate: current.eventDate,
      precision: current.precision,
      state: "expired",
      fires: old?.fires ?? 0,
      lastFiredDay: old?.last_fired_day ?? null,
    });
    this.store.setProspective({
      memoryId: input.memoryId,
      windowKey: nextWindow.key,
      eventDate: nextWindow.eventDate,
      precision: nextWindow.precision,
      state: "armed",
      fires: 0,
      lastFiredDay: null,
    });
    this.emit("prospective.rescheduled", input.memoryId, {
      from: current.key,
      to: nextWindow.key,
      spentFiresRetired: old?.fires ?? 0,
      why: input.reason ?? "reschedule",
    });
    return {
      rescheduled: true,
      reason: "rescheduled",
      retiredKey: current.key,
      armedKey: nextWindow.key,
    };
  }

  // ── exits (§5 G12: every dated memory names its exit) ─────────────────────

  /**
   * Every window this store knows about, classified by how it ended, with
   * counts. A pure read: nothing is stamped, nothing is swept. The property
   * expires by itself, so exit accounting is a QUESTION, never a pass (§12 G2).
   */
  exitReport(at: string, day?: number): ExitReport {
    const d = day ?? this.store.livedDay();
    const exits: Exit[] = [];
    const counts = Object.fromEntries(EXIT_KINDS.map((k) => [k, 0])) as Record<ExitKind, number>;

    for (const id of this.store.list({})) {
      const loaded = this.load(id, [], d);
      if (loaded === null) continue;
      const p = derive(loaded.memory, loaded.dates, at, this.tunables);
      const byKey = new Map<string, { window: Window | null; phase: Phase | null }>();
      for (const w of p.windows) byKey.set(w.key, { window: w, phase: w.phase });
      const rows = this.rowsFor(id);
      for (const key of rows.keys()) {
        if (byKey.has(key)) continue;
        const parsed = parseWindowKey(key);
        const w = parsed === null ? null : windowFor(parsed.eventDate, parsed.precision, this.tunables);
        byKey.set(key, { window: w, phase: w === null ? null : phaseOf(w, at) });
      }

      const laterExists = (key: string): boolean => {
        const self = byKey.get(key)?.window;
        if (self === undefined || self === null) return p.windows.length > 0;
        return p.windows.some((w) => w.key !== key && w.opensOn > self.opensOn);
      };

      for (const [key, info] of byKey) {
        const row = rows.get(key);
        const fires = row?.fires ?? 0;
        let kind: ExitKind;
        if (windowStateOf(row) === "suppressed") kind = "referenced";
        else if (windowStateOf(row) === "expired") {
          kind = laterExists(key) ? "superseded-by-reschedule" : "expired";
        } else if (fires > 0) kind = "fired";
        else if (info.phase === "passed") {
          kind =
            loaded.memory.archived || loaded.strength <= this.tunables.FADED_STRENGTH
              ? "faded"
              : "expired";
        } else kind = "open";
        exits.push({ memoryId: id, windowKey: key, kind, fires });
        counts[kind] += 1;
      }
    }

    this.emit("prospective.exits", undefined, { day: d, ...counts });
    return { at, day: d, counts, exits };
  }

  events(name?: string): ProspectiveEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * The four once-ness brakes plus crisis deference plus the window itself, in
   * ONE place, so the read path and the write path can never disagree about what
   * a spent window is. Order is deliberate: crisis deference outranks everything
   * (§12 G7), and referenced-stop outranks the counting brakes (§12 G6).
   */
  private brakeFor(
    w: Window,
    row: ProspectiveRow | undefined,
    ctx: { at: string; day: number; refractory: boolean; sessionId?: string | undefined },
  ): SuppressReason | null {
    if (ctx.refractory) return "refractory";
    const phase = phaseOf(w, ctx.at);
    if (phase === "pending") return "window-not-open";
    if (phase === "passed") return "stale-window";
    if (row !== undefined) {
      const state = windowStateOf(row);
      if (state === "suppressed") return "already-referenced";
      if (state === "expired") return "stale-window";
      if (row.fires >= this.tunables.FIRES_PER_WINDOW) return "over-fired";
      if (row.last_fired_day !== null && row.last_fired_day === ctx.day) {
        return "already-fired-today";
      }
    }
    if (ctx.sessionId !== undefined && this.sessionFired.get(ctx.sessionId)?.has(w.key) === true) {
      return "session-dedup";
    }
    return null;
  }

  /** `day` is the LIVED day the caller is asking about, never a clock read: the
   *  strength on the row is only as-of whatever day was asked (NOTES.md §2). */
  private load(memoryId: string, extra: readonly ExtractedDate[], day: number): Loaded | null {
    const row = this.store.row(memoryId);
    if (row === undefined) return null;
    let read;
    try {
      read = this.store.read(memoryId);
    } catch {
      // A removed memory is not an error here; it simply has no future.
      return null;
    }
    const dates = [...contentDates(read.doc), ...extra];
    const seen = new Set<string>();
    return {
      memory: {
        id: memoryId,
        kind: read.physics.kind as Kind,
        salience: read.physics.salience,
        archived: read.archived,
        learnedOn: read.doc.learnedOn === "" ? null : read.doc.learnedOn,
      },
      doc: read.doc,
      dates: dates.filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true))),
      strength: strength(read.physics, day),
    };
  }

  private rowsFor(memoryId: string): Map<string, ProspectiveRow> {
    const out = new Map<string, ProspectiveRow>();
    for (const r of this.store.prospectiveFor(memoryId)) out.set(r.window_key, r);
    return out;
  }

  private markSession(sessionId: string, key: string): void {
    let set = this.sessionFired.get(sessionId);
    if (set === undefined) {
      set = new Set<string>();
      this.sessionFired.set(sessionId, set);
    }
    if (set.size >= this.tunables.MAX_SESSION_WINDOWS) {
      const oldest = set.values().next();
      if (!oldest.done) set.delete(oldest.value);
    }
    set.add(key);
  }

  /** The one shape every non-fire transition shares: observer first, then write. */
  private write(
    site: string,
    memoryId: string,
    windowKey: string,
    next: (
      parsed: { eventDate: string; precision: WindowPrecision },
      row: ProspectiveRow | undefined,
    ) => {
      state: WindowState;
      fires: number;
      lastFiredDay: number | null;
      eventDate: string;
      precision: DatePrecision;
      extra?: Record<string, string | number | boolean | null>;
    },
  ): TransitionOutcome {
    if (this.observer) {
      this.emit("prospective.observer.standdown", memoryId, { site, window: windowKey });
      return { recorded: false, reason: "observer", state: "armed" };
    }
    const parsed = parseWindowKey(windowKey);
    if (parsed === null) {
      this.emit(`prospective.${site}.refused`, memoryId, {
        window: windowKey,
        reason: "malformed-window-key",
      });
      return { recorded: false, reason: "malformed-window-key", state: "armed" };
    }
    if (!this.store.has(memoryId)) {
      this.emit(`prospective.${site}.refused`, memoryId, {
        window: windowKey,
        reason: "unknown-memory",
      });
      return { recorded: false, reason: "unknown-memory", state: "armed" };
    }
    const row = this.rowsFor(memoryId).get(windowKey);
    const v = next(parsed, row);
    this.store.setProspective({
      memoryId,
      windowKey,
      eventDate: v.eventDate,
      precision: v.precision,
      state: v.state,
      fires: v.fires,
      lastFiredDay: v.lastFiredDay,
    });
    this.emit(`prospective.${site === "arm" ? "armed" : site === "reference" ? "referenced" : "expired"}`, memoryId, {
      window: windowKey,
      state: v.state,
      fires: v.fires,
      ...(v.extra ?? {}),
    });
    return { recorded: true, reason: "recorded", state: v.state };
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const e: ProspectiveEvent = { at: this.now(), name };
    if (ref !== undefined) e.ref = ref;
    if (data !== undefined) e.data = data;
    this.ring.push(e);
    if (this.ring.length > 500) this.ring.shift();
    this.onEvent?.(e);
  }
}

export type { DerivableMemory, DeriveReason, ExtractedDate, Prospectivity };
export type { DatePrecision, Phase, Window, WindowPrecision };
export type { UseTier };
