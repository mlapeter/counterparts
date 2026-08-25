/**
 * `recall/` — retrieval and priming. Cues → activation → the surfacing gate → a
 * bounded injection, plus the footnote tier, plus noticing afterwards whether a
 * surfaced memory was actually used.
 *
 * The module's spine, and where each piece lives:
 *
 *   `cues.ts`      strip host boilerplate, then rarity-weighted, word-bounded cues
 *   `activate.ts`  three channels — cue, semantic, arrival — against the cache box
 *   `gate.ts`      the hard gates, this turn's own background bar, the tiers
 *   `session.ts`   per-session gate state, PERSISTED (the ruling this module exists to honor)
 *   `render.ts`    composed budget, explicit trim order, tail sentinel
 *   `tunables.ts`  every knob, in one visible place
 *
 * Two properties are structural here and worth stating at the top:
 *
 * **BUILD and RECORD are separate steps** (contract §5 G3). `build()` is pure with
 * respect to durable state: it reads, scores, gates and composes, and writes
 * nothing — not gate state, not telemetry. `recall()` calls it and then records.
 * That split is what makes guarantee 2 achievable: **a latency-budget abort has
 * zero side effects** — nothing injected, nothing buffered, no telemetry, no fire
 * budget spent. *A slow subconscious is worse than a quiet one.*
 *
 * **NO GENERATIVE MODEL CALL, EVER, on this path.** There is no client, no fetch,
 * no URL in this directory, and a test enumerates that. An embedding may be
 * consulted — but only as an INPUT the caller supplies, and its absence degrades
 * to lexical-only rather than failing (contract §5 G1).
 */
import type { Kind } from "../types.js";
import { USE_TIER_WEIGHT } from "../physics/index.js";
import type { CreditOutcome, UseTier } from "../physics/index.js";
import type { ProseDoc, Store } from "../store/index.js";
import { activate } from "./activate.js";
import type { Candidate } from "./activate.js";
import { detectAffect, stripBoilerplate } from "./cues.js";
import { gate } from "./gate.js";
import type { Background, CandidateVerdict, Verdict } from "./gate.js";
import { loadGateState, saveGateState } from "./session.js";
import type { GateState } from "./session.js";
import { render } from "./render.js";
import type { RenderResult, Resolve } from "./render.js";
import { withTunables } from "./tunables.js";
import type { RecallTunables } from "./tunables.js";

export * from "./cues.js";
export * from "./gate.js";
export * from "./render.js";
export * from "./session.js";
export * from "./tunables.js";
export { activate, isConfidential, gatedSal } from "./activate.js";
export type { Candidate, ActivationResult } from "./activate.js";

/** Telemetry: ids, counts, scores, tiers, reasons. NEVER body text or turn text. */
export interface RecallEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface RecallOptions {
  store: Store;
  /** Overrides on the CAL table. Every one is a calibration claim (scar §2.8). */
  tunables?: Partial<RecallTunables>;
  /** The host's injection ceiling (scar §2.18 — the ceiling is a host capability). */
  budgetBytes?: number;
  /** Latency budget for the build pass, ms. */
  budgetMs?: number;
  /**
   * Is this the owner's own session? Defaults to FALSE: withholding is the safe
   * direction, and an observer is a non-owner regardless (observer-mode.md G7).
   */
  owner?: boolean;
  onEvent?: (e: RecallEvent) => void;
  /** Injectable clock, so the latency budget is testable without sleeping. */
  now?: () => number;
}

export interface Turn {
  sessionId: string;
  text: string;
  /** The turn's embedding, supplied by the caller. NEVER fetched here. */
  vector?: readonly number[];
  /** handle -> memory ids; >= 2 ids makes the handle ambiguous (INTERFACE-GAPS #2). */
  aliases?: ReadonlyMap<string, readonly string[]>;
  /** Lived day. Defaults to the store's clock (scar E8 — lived, not calendar). */
  day?: number;
  /** Per-turn override of the session's owner stance. */
  owner?: boolean;
  budgetBytes?: number;
}

export type DecisionReason =
  | "rendered"
  | "empty-turn"
  | "no-candidates"
  | "all-gated"
  | "budget-quiet"
  | "latency-abort";

/**
 * The per-turn surfacing decision record — content-by-reference from day one
 * (contract §5 G14, scar §2.20). Ids, counts, scores, reasons. No bodies, and no
 * cue TOKENS either: a cue token is a word the user typed, and turn text is
 * exactly what telemetry may not carry.
 */
export interface RecallDecision {
  readonly sessionId: string;
  readonly turn: number;
  readonly day: number;
  readonly observer: boolean;
  readonly owner: boolean;
  readonly reason: DecisionReason;
  readonly aborted: boolean;
  readonly storeSize: number;
  readonly background: Background;
  /** Which boilerplate strippers fired, by NAME (§9 G3). */
  readonly stripped: string[];
  readonly cueCount: number;
  readonly ambiguousCueCount: number;
  readonly carriedCueCount: number;
  readonly semanticUsed: boolean;
  readonly semanticDegraded: boolean;
  readonly candidates: number;
  readonly verdicts: CandidateVerdict[];
  readonly surfaced: string[];
  readonly footnotes: string[];
  readonly affectFlag: boolean;
  readonly affectReason: string;
  readonly bytes: number;
  readonly budgetBytes: number;
  readonly sentinel: string | null;
  readonly trimmed: { lane: string; id: string | null }[];
  readonly elapsedMs: number;
}

export interface RecallResult {
  /** The empty string on a quiet turn — never an empty block. */
  readonly injection: string;
  readonly decision: RecallDecision;
}

export type CreditReason =
  | "credited"
  | "observer"
  | "ambiguous-handle-trains-nothing"
  | "already-credited-at-or-above"
  | "physics-refused";

export interface CreditResult {
  readonly credited: boolean;
  readonly reason: CreditReason;
  readonly tier: UseTier;
  readonly w: number;
  /** Physics' own verdict, when it was consulted. */
  readonly outcome: CreditOutcome | null;
}

interface BuildOutput {
  decision: RecallDecision;
  injection: string;
  state: GateState;
  /** Cue tokens to carry into the next turn. State, not telemetry (see NOTES.md). */
  carry: string[];
  render: RenderResult | null;
  gateStatus: "loaded" | "absent" | "unreadable";
}

export class Recall {
  readonly store: Store;
  readonly tunables: RecallTunables;
  /** One predicate, one definition: the store's. Never re-derived here. */
  readonly observer: boolean;

  private readonly defaultOwner: boolean;
  private readonly budgetBytes: number;
  private readonly budgetMs: number;
  private readonly onEvent: ((e: RecallEvent) => void) | undefined;
  private readonly now: () => number;
  /** Observer-only: gate state that may never be deposited, so it lives here. */
  private readonly volatile = new Map<string, GateState>();

  constructor(opts: RecallOptions) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables ?? {});
    this.observer = opts.store.observer;
    this.defaultOwner = opts.owner === true && !this.observer;
    this.budgetBytes = opts.budgetBytes ?? this.tunables.BUDGET_BYTES;
    this.budgetMs = opts.budgetMs ?? this.tunables.BUDGET_MS;
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? (() => Date.now());
  }

  // ── the hot path ─────────────────────────────────────────────────────────

  /**
   * BUILD: read, score, gate, compose. Writes nothing durable and emits nothing.
   * Exposed because "build and record are separate steps" is only a real property
   * if the build is separately callable — a private half is a promise, not a seam.
   */
  build(turn: Turn): BuildOutput {
    const started = this.now();
    const day = turn.day ?? this.store.livedDay();
    const owner = (turn.owner ?? this.defaultOwner) && !this.observer;
    const budgetBytes = turn.budgetBytes ?? this.budgetBytes;

    const loaded = this.observer
      ? { state: this.volatileState(turn.sessionId), status: "loaded" as const }
      : loadGateState(this.store, turn.sessionId);
    const state = loaded.state;
    const turnNo = state.turn + 1;

    const { text, stripped } = stripBoilerplate(turn.text);
    const affect = detectAffect(text);
    const carriedIn =
      state.carriedFromTurn === turnNo - 1 && state.carriedCues.length > 0
        ? state.carriedCues
        : [];

    const quiet = (
      reason: DecisionReason,
      partial: Partial<RecallDecision> = {},
    ): BuildOutput => ({
      decision: {
        sessionId: turn.sessionId,
        turn: turnNo,
        day,
        observer: this.observer,
        owner,
        reason,
        aborted: reason === "latency-abort",
        storeSize: 0,
        background: {
          regime: "absolute-thin-background",
          n: 0,
          mean: 0,
          sd: 0,
          bar: this.tunables.FLOOR_GLOBAL,
          strongBar: this.tunables.FLOOR_GLOBAL,
          floor: this.tunables.FLOOR_GLOBAL,
        },
        stripped,
        cueCount: 0,
        ambiguousCueCount: 0,
        carriedCueCount: carriedIn.length,
        semanticUsed: turn.vector !== undefined && turn.vector.length > 0,
        semanticDegraded: false,
        candidates: 0,
        verdicts: [],
        surfaced: [],
        footnotes: [],
        affectFlag: false,
        affectReason: "no-feeling-in-turn",
        bytes: 0,
        budgetBytes,
        sentinel: null,
        trimmed: [],
        elapsedMs: this.now() - started,
        ...partial,
      },
      injection: "",
      state,
      carry: [],
      render: null,
      gateStatus: loaded.status,
    });

    if (text.trim().length === 0) return quiet("empty-turn");

    // Cold start is STRICTER, not looser: below a minimum store size the variance
    // estimate is meaningless and small stores over-surface (§9 G13).
    const storeSize = this.store.list({ archived: false }).length;
    const maxCandidates =
      storeSize < this.tunables.COLD_START_MIN_STORE
        ? this.tunables.COLD_START_MAX_CANDIDATES
        : this.tunables.MAX_CANDIDATES;

    const act = activate(
      this.store,
      {
        text,
        vector: turn.vector,
        carried: carriedIn,
        aliases: turn.aliases,
        day,
        selfFelt: affect.selfFelt,
        maxCandidates,
        storeSize,
      },
      this.tunables,
    );

    if (this.now() - started > this.budgetMs) return quiet("latency-abort");

    const carry = act.cues
      .filter((c) => !c.carried)
      .slice(0, this.tunables.MAX_CUES)
      .map((c) => c.token);
    const cueStats = {
      cueCount: act.cues.length,
      ambiguousCueCount: act.cues.filter((c) => c.ambiguous).length,
      carriedCueCount: carriedIn.length,
      storeSize: act.storeSize,
      semanticDegraded: act.semanticDegraded,
    };

    if (act.candidates.length === 0) {
      return { ...quiet("no-candidates", cueStats), carry };
    }

    const gated = gate(
      {
        candidates: act.candidates,
        state,
        storeSize: act.storeSize,
        owner,
        affectStated: affect.stated,
        turn: turnNo,
      },
      this.tunables,
    );

    if (this.now() - started > this.budgetMs) return quiet("latency-abort");

    const docs = new Map<string, ProseDoc>();
    for (const c of act.candidates) docs.set(c.id, c.doc);
    const resolve: Resolve = (id) => resolveDoc(docs.get(id), id);

    const rendered = render(
      {
        turn: turnNo,
        affectFlag: gated.affectFlag,
        surfaced: gated.surfaced.map((c) => c.id),
        footnotes: gated.footnotes.map((c) => c.id),
        budgetBytes,
        gistBytes: this.tunables.GIST_BYTES,
        titleBytes: this.tunables.FOOTNOTE_TITLE_BYTES,
        pressureRatio: this.tunables.BUDGET_PRESSURE,
      },
      resolve,
    );

    const nothingAdmitted =
      gated.surfaced.length === 0 && gated.footnotes.length === 0 && !gated.affectFlag;
    const reason: DecisionReason = nothingAdmitted
      ? "all-gated"
      : rendered.text === ""
        ? "budget-quiet"
        : "rendered";

    const decision: RecallDecision = {
      sessionId: turn.sessionId,
      turn: turnNo,
      day,
      observer: this.observer,
      owner,
      reason,
      aborted: false,
      storeSize: act.storeSize,
      background: gated.background,
      stripped,
      cueCount: cueStats.cueCount,
      ambiguousCueCount: cueStats.ambiguousCueCount,
      carriedCueCount: cueStats.carriedCueCount,
      semanticUsed: turn.vector !== undefined && turn.vector.length > 0,
      semanticDegraded: act.semanticDegraded,
      candidates: act.candidates.length,
      verdicts: gated.verdicts,
      surfaced: rendered.surfaced,
      footnotes: rendered.footnotes,
      affectFlag: rendered.affectFlag,
      affectReason: gated.affectReason,
      bytes: rendered.bytes,
      budgetBytes,
      sentinel: rendered.sentinel,
      trimmed: rendered.trimmed.map((x) => ({ lane: x.lane, id: x.id })),
      elapsedMs: this.now() - started,
    };

    return {
      decision,
      injection: rendered.text,
      state,
      carry,
      render: rendered,
      gateStatus: loaded.status,
    };
  }

  /**
   * BUILD, then RECORD. The record step is where gate state is persisted and
   * telemetry is emitted — and it is skipped entirely on a latency abort, which
   * is what makes the abort side-effect-free.
   */
  recall(turn: Turn): RecallResult {
    const built = this.build(turn);
    const d = built.decision;

    if (d.aborted) {
      // Zero side effects on loss: nothing injected, nothing buffered, no
      // telemetry, no state advanced (contract §5 G2).
      return { injection: "", decision: d };
    }

    if (built.gateStatus === "unreadable") {
      this.emit("recall.gate.reset", turn.sessionId, { status: built.gateStatus });
    }

    const next: GateState = {
      ...built.state,
      turn: d.turn,
      lastDay: d.day,
      surfaced: { ...built.state.surfaced },
      affectFiredTurn: d.affectFlag ? d.turn : built.state.affectFiredTurn,
      carriedCues: built.carry,
      carriedFromTurn: d.turn,
    };
    for (const id of d.surfaced) {
      next.surfaced[id] = { turn: d.turn, tier: "surfaced", trains: trainsOf(d.verdicts, id) };
    }
    for (const id of d.footnotes) {
      next.surfaced[id] = { turn: d.turn, tier: "footnoted", trains: trainsOf(d.verdicts, id) };
    }
    this.persist(next, "recall");

    this.emitTelemetry(d, built.render);
    return { injection: built.injection, decision: d };
  }

  /**
   * Retrospective reinforcement. Which memories the reply actually USED is the
   * caller's judgment (§9.2 owns that rule and its precision bias); this method
   * routes a decided tier to physics through the store seam and applies the two
   * refusals that belong to the gate state it owns.
   *
   * The footnoted tier is deliberately NOT short-circuited: it goes through
   * `store.reinforce` and comes back `credited: false, reason: "ignorable-tier"`,
   * so "the ignorable tier trains nothing" is proved by the seam that would have
   * trained it, not by an early return that never asked.
   */
  resolveUse(sessionId: string, memoryId: string, tier: UseTier): CreditResult {
    const w = USE_TIER_WEIGHT[tier];
    // Checked FIRST, before any other work (contract §5 G11, scar E7).
    if (this.observer) {
      this.emit("recall.observer.standdown", memoryId, { site: "resolveUse", tier });
      return { credited: false, reason: "observer", tier, w, outcome: null };
    }

    const { state } = loadGateState(this.store, sessionId);
    const surfaced = state.surfaced[memoryId];
    if (surfaced !== undefined && !surfaced.trains) {
      // Both halves of §9 G5, and this is the consumer scar §2.6 demands: v1
      // documented "ambiguous handles train nothing" in three places, enforced it
      // in one, and a repo-wide grep found ZERO consumers of the flag.
      this.emit("recall.credit.refused", memoryId, {
        reason: "ambiguous-handle-trains-nothing",
        tier,
      });
      return { credited: false, reason: "ambiguous-handle-trains-nothing", tier, w, outcome: null };
    }
    const prior = state.credited[memoryId];
    if (prior !== undefined && USE_TIER_WEIGHT[prior.tier] >= w) {
      // Never downgrades an already-credited item (contract §5 G10).
      this.emit("recall.credit.refused", memoryId, {
        reason: "already-credited-at-or-above",
        tier,
        prior: prior.tier,
      });
      return { credited: false, reason: "already-credited-at-or-above", tier, w, outcome: null };
    }

    const outcome = this.store.reinforce(memoryId, this.store.livedDay(), tier);
    if (outcome.credited) {
      state.credited[memoryId] = { turn: state.turn, tier };
      this.persist(state, "resolveUse");
    }
    this.emit("recall.credit", memoryId, {
      tier,
      w,
      credited: outcome.credited,
      reason: outcome.reason,
    });
    return {
      credited: outcome.credited,
      reason: outcome.credited ? "credited" : "physics-refused",
      tier,
      w,
      outcome,
    };
  }

  /**
   * The DELIVERY-side event (scar §2.3: "we rendered it" is not "they received
   * it"). The host calls this with the last line it actually saw in context; a
   * mismatch is the only way to tell a delivered injection from a truncated one.
   */
  noteDelivered(sessionId: string, sentinelSeen: string | null, expected: string | null): boolean {
    const ok = expected !== null && sentinelSeen === expected;
    this.emit("recall.delivered", sessionId, {
      ok,
      sawSentinel: sentinelSeen !== null,
      expected: expected !== null,
    });
    return ok;
  }

  /** Read-only view of the persisted gate state — for tests, replay and the dashboard. */
  gateState(sessionId: string): GateState {
    return this.observer
      ? this.volatileState(sessionId)
      : loadGateState(this.store, sessionId).state;
  }

  events(): RecallEvent[] {
    return this.ring.map((e) => ({ ...e }));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private readonly ring: RecallEvent[] = [];

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const e: RecallEvent = { at: this.now(), name };
    if (ref !== undefined) e.ref = ref;
    if (data !== undefined) e.data = data;
    this.ring.push(e);
    if (this.ring.length > 500) this.ring.shift();
    this.onEvent?.(e);
  }

  private volatileState(sessionId: string): GateState {
    let s = this.volatile.get(sessionId);
    if (s === undefined) {
      s = loadGateState(this.store, sessionId).state;
      this.volatile.set(sessionId, s);
    }
    return s;
  }

  /**
   * The one write site for gate state. Under observer it stands down BEFORE the
   * store seam is touched and keeps the state in-process instead: an instrument
   * deposits nothing, and every stand-down is observable (observer-mode.md G6).
   */
  private persist(state: GateState, site: string): void {
    if (this.observer) {
      this.volatile.set(state.sessionId, state);
      this.emit("recall.observer.standdown", state.sessionId, { site: `persist:${site}` });
      return;
    }
    saveGateState(this.store, state, this.tunables.MAX_SESSION_RECORDS);
  }

  private emitTelemetry(d: RecallDecision, r: RenderResult | null): void {
    const counts = new Map<Verdict, number>();
    for (const v of d.verdicts) counts.set(v.verdict, (counts.get(v.verdict) ?? 0) + 1);
    for (const [verdict, count] of counts) {
      if (verdict === "surfaced" || verdict === "footnoted") continue;
      this.emit("recall.withheld", undefined, { reason: verdict, count });
    }
    for (const t of d.trimmed) this.emit("recall.trim", t.id ?? undefined, { lane: t.lane });

    if (d.reason === "rendered") {
      // §2.9: context assembly logs WHAT IT SHOWED, by id.
      this.emit("recall.rendered", d.sessionId, {
        turn: d.turn,
        regime: d.background.regime,
        candidates: d.candidates,
        surfaced: d.surfaced.length,
        footnotes: d.footnotes.length,
        affect: d.affectFlag,
        bytes: d.bytes,
        budget: d.budgetBytes,
        ids: [...d.surfaced, ...d.footnotes].join(","),
        elapsedMs: d.elapsedMs,
      });
      if (r?.pressure === true) {
        this.emit("recall.budget.pressure", d.sessionId, {
          bytes: d.bytes,
          budget: d.budgetBytes,
        });
      }
    } else {
      this.emit("recall.quiet", d.sessionId, {
        turn: d.turn,
        reason: d.reason,
        candidates: d.candidates,
        regime: d.background.regime,
      });
    }
  }
}

function trainsOf(verdicts: readonly CandidateVerdict[], id: string): boolean {
  return verdicts.find((v) => v.id === id)?.trains ?? true;
}

/** Id → text, at render time only. A missing doc renders as its own id. */
function resolveDoc(doc: ProseDoc | undefined, id: string): { title: string; gist: string } {
  if (doc === undefined) return { title: id, gist: id };
  const firstLine = doc.body.split("\n").find((l) => l.trim().length > 0) ?? "";
  const paragraph = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? doc.body;
  return { title: doc.title ?? firstLine, gist: paragraph };
}

export type { Kind, CandidateVerdict, Verdict, Background, GateState, UseTier, CreditOutcome };
