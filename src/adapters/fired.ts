/**
 * `fired` — which mechanisms have actually fired, and which have gone quiet.
 *
 * **Why it exists.** Constitution 11: every mechanism is verified in real use
 * after it lands, done means seen firing rather than merged, a silent one is
 * diagnosed before anyone considers removing it — and "the system itself shows
 * what fired and what did not". In September 2026 several mechanisms were
 * merged, tested and then never fired once on the live store, and no surface
 * said so. The read-only inventory of 2026-09-17
 * (`docs/mechanism-inventory-2026-09-17.md`) counted forty mechanisms:
 * twenty-four seen firing, ten never, six that cannot be told either way. This
 * module is the first version of the view its §5 proposed, built ONLY from rows
 * the store already holds.
 *
 * **It reads and never writes.** Every call below is a read; the caller hands in
 * a store it already opened, and every caller in this tree opens it in observer
 * stance. Nothing here appends an event, mints a directory or touches box 3.
 *
 * **Where it sits.** Beside `sessions.ts` and `scopes.ts`, for the reason those
 * two are there: three adapters need it — the console's `fired` command,
 * `claude-code/doctor.ts`'s finding and the dashboard's health panel — and
 * `mcp/INTERFACE-GAPS.md` §7 keeps adapters as leaves that never import each
 * other. It DOES import `dashboard/registries.ts`, which is a registry rather
 * than a view: that file exists precisely so the list of durable event names
 * cannot be copied without going stale, and a second copy here would be the
 * staleness it exists to prevent.
 *
 * **Three things shape the reading.**
 *
 *   1. **One pass over the log, not one query per mechanism.** `Store` offers no
 *      GROUP BY, so the events are read once — ascending, as `eventLog` returns
 *      them — and grouped here. A read that hits its ceiling says so and reports
 *      its totals as a floor rather than as a number.
 *   2. **Windows are CALENDAR days, in the person's zone** (UTC until
 *      2026-09-25; docs/time.md moved every person's day to local, and this
 *      is a read-only view over moments, so it follows — `Store#zone`). A row
 *      that carries its own `date` (a hook's) is read as written; hooks stamp
 *      that local too since the same day. The lived clock is advanced by the
 *      worker and has run seven lived days across fifteen calendar ones on the
 *      owner's own store, so a lived-day window would silently drop rows. The
 *      `sinceDay` bound is used only to keep the SQL cheap; a lived day is never
 *      longer than a calendar day, so it cannot cut a row inside the window.
 *   3. **Absence is a fact, never a formatting hint.** A mechanism with no
 *      durable evidence is `blind` and says which row would fix it; a stood-down
 *      one is `disabled` and names the decision; one retired with a phase of the
 *      run is `retired`. None of the three is silence, and none is a fault.
 *   4. **What was PREVENTED is read, not only what happened** (2026-09-20, E2).
 *      Until now a mechanism that was stopped at every attempt read exactly like
 *      one that had nothing to do: both said `never`. A mechanism whose refusals
 *      are durable — in its own row, or in another row that names them — and
 *      which did not fire inside the window is `blocked`, and the line says by
 *      what. `REFUSAL_READERS` is still the only place a refusal column comes
 *      from, and it still reads only fields a writer already fills.
 */
import { TUNABLES as ENCODE } from "../core/encode/tunables.js";
import { addDays, daysBetween as calendarDaysBetween, localDate } from "../core/time.js";
import type { EventRow, ReadOnlyStore } from "../core/store/index.js";
import type { DurableEventName } from "./dashboard/registries.js";

/** The window every count on this page is measured over. Seven CALENDAR days,
 *  inclusive of today — today and the six before it. */
export const FIRED_DAYS = 7;

/**
 * The ceiling on the one event read. The owner's store held roughly twenty
 * thousand rows on day 191 of the parallel run, so this is an order of magnitude
 * of headroom; a read that reaches it is reported as a floor rather than as a
 * number, because a confident wrong count is the one thing a diagnostic may
 * never produce.
 */
export const EVENT_CEILING = 200_000;

/**
 * The ceiling on the table probes' id scan. The probes cost a few queries per
 * memory — `Store` has no aggregate over `edges`, `prospective` or `versions` —
 * so the scan is bounded, and one that reaches this says so.
 */
export const PROBE_CEILING = 50_000;

// ── the vocabulary ──────────────────────────────────────────────────────────

/**
 * What one mechanism's row says about it.
 *
 *   - `firing` — a row landed inside the last seven days.
 *   - `quiet` — it has fired before, and not in the last seven days. The state
 *     worth reading first, because it is the one that says something changed.
 *   - `blocked` — it did not fire inside the window, and something durably said
 *     why: a refusal landed instead. The difference between "never needed" and
 *     "stopped every time", which nothing could tell before 2026-09-20.
 *   - `never` — durable evidence exists and has never carried a single row.
 *   - `new` — never fired, but its evidence is younger than the window, so there
 *     has not yet been time for it to be a worry.
 *   - `blind` — no durable evidence exists at all. The row says which row would
 *     fix it. NOT a synonym for silent: a blind mechanism may be running fine.
 *   - `disabled` — stood down by a named decision (Amendment 15), not a fault.
 *   - `retired` — a phase of the run ended and took the mechanism with it.
 */
export const FIRED_STATES = [
  "quiet",
  "blocked",
  "never",
  "blind",
  "firing",
  "new",
  "disabled",
  "retired",
] as const;
export type FiredState = (typeof FIRED_STATES)[number];

/** The order the report and every renderer print the groups in: SILENT FIRST.
 *  A view whose first screen is everything that worked is one nobody scrolls. */
export const STATE_ORDER: readonly FiredState[] = [
  "quiet",
  "blocked",
  "never",
  "blind",
  "firing",
  "new",
  "disabled",
  "retired",
];

/** The one-line gloss each state carries wherever it is printed. */
export const STATE_MEANING: Record<FiredState, string> = {
  firing: "a row landed in the last 7 days",
  quiet: "it has fired before, but not in the last 7 days",
  blocked: "it did not fire this week, and a durable row says what stopped it",
  never: "the evidence exists and has never carried a row",
  new: "never fired, and its evidence is younger than the window — not yet a worry",
  blind: "nothing durable records it, so firing and silence read alike",
  disabled: "stood down by a named decision, not a fault",
  retired: "a phase of the run ended and took it with it",
};

/**
 * The table reads that stand in for a mechanism with no event of its own — the
 * five the inventory's §5(b) named, split where one table answers two questions.
 * `versions:<reason>` is a template because the reason is the axis.
 */
export type ProbeId =
  | "edges"
  | "prospective.armed"
  | "prospective.fired"
  | "protected"
  | "removals"
  | `versions:${string}`;

export type Evidence =
  | {
      readonly kind: "event";
      readonly names: readonly DurableEventName[];
      /**
       * A NUMERIC PAYLOAD FIELD THAT MUST BE ABOVE ZERO for a row to count
       * (2026-09-25, the entity-card fade). Some mechanisms have no row of their
       * own and ride a row that lands whether they did anything or not: the fade
       * is a count on the nightly `sleep.cycle` row, and reading that row plain
       * would grade every night as a fade. With this set, a row counts toward
       * `total`, the two windows and `lastFired` only when `payload[positive]`
       * is a number greater than zero — a `null` (a cycle that died before it
       * could count, scar §2.4) is not a zero and is not a firing either.
       *
       * The unit is still ROWS, like every other line on this page: a night that
       * faded three cards is one firing. And a filtered reading carries NO
       * refusals of its own — the row's refusal reader answers for every phase
       * on it, and none of that is this mechanism's to claim. A mechanism that
       * wants a refusal column names one with `Mechanism.refusals`.
       */
      readonly positive?: string;
    }
  /** `undated`: the one line to print when the probe yields a count and no date
   *  at all — a column with no history is blind however many rows it holds. */
  | { readonly kind: "probe"; readonly probe: ProbeId; readonly undated?: string }
  | { readonly kind: "none"; readonly reason: string };

/**
 * WHERE A MECHANISM'S REFUSALS LIVE, when they are not in its own row (E2).
 *
 * Four of the night's mechanisms succeed under one name and are prevented under
 * another: promotion's successes are `band.promoted` and its refusals ride the
 * cycle row, the spawn seam's start and its refusals are three separate names.
 * Naming the refusal rows here lets a row read "blocked, by X" without the
 * refusal rows being mistaken for firings — `total` and `inWindow` still count
 * only the EVIDENCE names.
 */
export interface RefusalSource {
  readonly names: readonly DurableEventName[];
  /**
   * Take only the reasons under this prefix, and strip it for display. The
   * cycle row carries four phases' refusals in one map, keyed `<phase>/<reason>`
   * (`sleep/cycle.ts`), so one row answers for four mechanisms without any of
   * them claiming another's.
   */
  readonly under?: string;
  /**
   * THE ALLOW-LIST OF REAL GATES, and the most important field here.
   *
   * A namespace is not a refusal channel. Physics' `blockedBy` vocabularies are
   * mostly **"not yet"** — `base-below-identity-threshold`, `dwell-too-short`,
   * `above-floor`, `below-tau` — which describe the ordinary condition of
   * nearly every memory on every healthy night and scale with store size ×
   * nights. Reading a namespace wholesale made a store where NOTHING is wrong
   * report `BLOCKED prune … dwell-too-short ×240`, permanently, in the first
   * section printed. That is the `journal ×14` false alarm this field exists to
   * stop, one namespace over, and it was found by running seven real boundaries
   * over forty ordinary memories rather than by reading.
   *
   * So a reason counts as a refusal only if it is named here. The test is
   * whether a NAMED RULE turned away a candidate that otherwise qualified —
   * `protected` is the owner saying no; `dwell-too-short` is arithmetic saying
   * not yet. A mechanism with no such reason in its vocabulary gets no refusal
   * column at all, which is the honest answer rather than an empty one.
   */
  readonly only?: readonly string[];
  /**
   * The date this refusal CHANNEL began carrying data, when it is recent.
   *
   * `wentBlocked` compares two windows, and a channel that did not exist in the
   * older one makes a schema change look like a regression — "your prune phase
   * stopped working on deploy day" when all that happened is that the rows
   * started carrying a field. The state still reads `blocked`, which is true;
   * only the WEEK-OVER-WEEK claim is withheld until both windows can answer.
   */
  readonly since?: string;
}

export interface Mechanism {
  /** Stable machine name — the `--json` key, and what a test pins. */
  readonly id: string;
  /**
   * WHAT IT DOES, in words a non-engineer reads once: "the session is asked to
   * write its own memories", never "adapter.ask". The dotted name is evidence,
   * printed beside it; it is not the label.
   */
  readonly label: string;
  /** Where the code lives, for the reader who wants to go and look. */
  readonly module: string;
  readonly evidence: Evidence;
  /** Rows that say this mechanism was PREVENTED, when they are not its own. */
  readonly refusals?: RefusalSource;
  /**
   * The calendar date the EVIDENCE was added, when it is recent. A mechanism
   * that has never fired but whose row is three days old is `new`, not `never`:
   * there has not been time yet, and grading it as a fault is how a view teaches
   * its reader to ignore it.
   */
  readonly since?: string;
  /** A named stand-down, with its reason. Amendment 15 working, not a fault. */
  readonly disabled?: string;
  /** Retired with a phase of the run, with the phase named. */
  readonly retired?: string;
  /**
   * Durable event names this row ACCOUNTS FOR in the coverage test, when they
   * are not simply its own evidence. A blind mechanism can still be the row that
   * speaks for a name — the spawn seam's three prove a failure and cannot prove
   * a start — and a name nobody accounts for is the gap the test catches.
   */
  readonly covers?: readonly DurableEventName[];
}

// ── the registry ────────────────────────────────────────────────────────────

/**
 * THE MECHANISMS, from the inventory's §2 table. Each row is something the
 * design claims happens, and its evidence is whatever the store durably holds
 * about it TODAY. Nothing here is aspirational: a mechanism whose evidence does
 * not exist yet says so and names the row that would fix it, which is the blind
 * list of §4 rendered rather than filed.
 *
 * Two rows of that table are deliberately absent: novelty (#9) and footnotes
 * (#16) are sub-readings of the gate and of the surfacing decision, counted
 * inside the same rows, and listing them again would double-count the log.
 */
export const MECHANISMS: readonly Mechanism[] = [
  // ── what comes in ────────────────────────────────────────────────────────
  {
    id: "capture",
    label: "the conversation is captured when a session pauses or ends",
    module: "remember/spans",
    evidence: { kind: "event", names: ["adapter.boundary"] },
  },
  {
    id: "ask",
    label: "the session is asked to write its own memories before it stops",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.ask"] },
  },
  {
    id: "ask-two-part",
    label: "the older two-part version of that ask — one for the chapter, one for the memories",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.authorship.ask", "adapter.episode.ask"] },
    retired:
      "replaced by a single ask on 2026-09-04; the days recorded under these names stay readable",
  },
  {
    id: "deposit",
    label: "a memory the session wrote for itself passed the gates and landed",
    module: "mcp/ → encode/battery.ts",
    evidence: { kind: "event", names: ["gate.deposit"] },
  },
  {
    id: "journal-chapter",
    label: "the session wrote a chapter of its own journal",
    module: "mcp/chapter → self/",
    evidence: { kind: "probe", probe: "versions:episode-chapter" },
  },
  {
    id: "sweep-gate",
    label: "the crash fallback checked whether a session died with something unsaid",
    module: "remember/fallback.ts",
    evidence: { kind: "event", names: ["sweep.gate"] },
  },
  {
    id: "sweep-wake",
    label: "that fallback was woken as me before it read a transcript",
    module: "core/counterpart.ts",
    evidence: { kind: "event", names: ["sweep.wake"] },
    since: "2026-09-17",
  },
  {
    id: "chunk-gate",
    label: "a swept fragment met the gate battery and was scored at the door",
    module: "encode/battery.ts",
    evidence: { kind: "event", names: ["gate.chunk"] },
  },
  {
    id: "gate-refusal",
    label: "the gate battery turned a proposal away",
    module: "encode/battery.ts",
    evidence: {
      kind: "none",
      reason:
        "refusals are counted inside the gate rows, and that count has been empty in every row ever written — so a gate that has never had to say no and a gate nothing reaches read exactly alike. Only a deliberate probe deposit separates them.",
    },
  },
  {
    id: "emotion",
    label: "how something felt is read at the door and used to weight what comes back",
    module: "encode/, recall/",
    evidence: {
      kind: "none",
      reason:
        "the gate records the channel as off in every row; nothing measures a classifier that does not run.",
    },
    // READ, not retyped: the stand-down is a tunable, and a view that hard-coded
    // it would go on saying `disabled` the day the owner turns the classifier on.
    ...(ENCODE.EMOTION_CLASSIFIER_ENABLED
      ? {}
      : {
          disabled: `the classifier ships off until it clears its precision bar of ${String(
            ENCODE.EMOTION_CLASSIFIER_PRECISION_BAR,
          )} (encode/tunables.ts) — a named decision, not a fault`,
        }),
  },
  {
    id: "salience",
    label: "every memory is scored for novelty, relevance, feeling and usefulness as it is written",
    module: "encode/",
    evidence: {
      kind: "none",
      reason:
        "the scores are columns on each memory, not rows in the log, so the store can say what every memory scored and never when one was scored.",
    },
  },
  {
    id: "entity-birth",
    label: "a name mentioned in passing becomes someone the system knows about",
    module: "schemas/",
    evidence: {
      kind: "none",
      reason:
        "a birth shows only as another entity in the store, and a refusal shows nowhere at all — the reasons live in an in-process ring that dies with the hook.",
    },
  },
  {
    id: "accommodation",
    label: "something the owner declared outright replaced what had been inferred",
    module: "schemas/",
    evidence: { kind: "probe", probe: "versions:replaced-by-declaration" },
  },

  // ── what comes back ──────────────────────────────────────────────────────
  {
    id: "recall-decision",
    label: "each turn decides what comes to mind and what stays quiet",
    module: "recall/",
    evidence: { kind: "event", names: ["recall.decision"] },
  },
  {
    id: "recall-injected",
    label: "what came to mind was handed to the host for the model to read",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.recall"] },
  },
  {
    id: "credit",
    label: "memories the reply actually used are credited, so using one strengthens it",
    module: "recall/, physics/",
    evidence: { kind: "event", names: ["recall.credit"] },
  },
  {
    id: "gate-session",
    label: "what a session has already been shown, so it is not shown the same thing twice",
    module: "recall/session.ts",
    evidence: {
      kind: "none",
      reason:
        "the table is written every turn and read by no surface at all — not this view, not the dashboard, not the daily. Nothing new is needed; the rows that exist simply have to be rendered.",
    },
  },
  {
    // Durable since 2026-09-20 (E2). The row carries what was asked as shapes
    // and sizes — never the question — how much came back, and every verdict
    // that kept something out, which is the refusal column below.
    id: "deliberate-recall",
    label: "the session went looking for a memory on purpose and opened it in full",
    module: "mcp/deliberate.ts",
    evidence: { kind: "event", names: ["mcp.recall"] },
    since: "2026-09-20",
  },
  {
    id: "association",
    label: "two memories that came to mind together got wired to each other",
    module: "associate/",
    evidence: {
      kind: "probe",
      probe: "edges",
      undated: "the links carry no date at all, so nothing says when one was last made.",
    },
  },
  {
    // The links table above says links EXIST; it could not say one was made this
    // week, which is how this mechanism wrote nothing for two weeks unseen. Since
    // 2026-09-17 the boundary's worker leaves a row each time it saves what the
    // session's hooks noticed and left on disk for it.
    id: "association-saved",
    label: "the links noticed during a session were written down by the boundary's worker",
    module: "associate/",
    evidence: { kind: "event", names: ["associate.flush"] },
    since: "2026-09-17",
  },
  {
    id: "spreading",
    label: "remembering one thing pulls its neighbours with it",
    module: "associate/spread.ts",
    evidence: {
      kind: "none",
      reason:
        "the turn's record counts what surfaced but never which channel found it; a `channelCounts` field on the decision row that already exists would fix it without a new name.",
    },
  },
  {
    id: "temporal-channel",
    label: "what happened around the same time is treated as a cue",
    module: "core/retrieval.ts",
    evidence: {
      kind: "none",
      reason:
        "the same gap as spreading activation: folded into the turn's totals with no breakdown.",
    },
  },
  {
    id: "confidentiality",
    label: "something confidential is held back rather than surfaced",
    module: "recall/gate.ts",
    evidence: {
      kind: "none",
      reason:
        "the gate reports itself clear inside the deposit and turn records and is never broken out, so a withholding that happened and one that never had to are the same absence.",
    },
  },

  // ── what the night does ──────────────────────────────────────────────────
  {
    id: "sleep-cycle",
    label: "the consolidation cycle ran, with every phase by name",
    module: "sleep/, bin/runner.ts",
    evidence: { kind: "event", names: ["sleep.cycle"] },
  },
  {
    id: "decay",
    label: "memories weaken with time and drop to a lower band",
    module: "physics/, sleep/decay.ts",
    evidence: { kind: "event", names: ["band.transition"] },
    // NO REFUSAL COLUMN, deliberately. Every entry in `DECAY_SKIPS` is a
    // candidate filter — archived, removed, journal, identity-band,
    // reinforced-today, at-floor, under-audit, unchanged — and not one of them
    // is a gate saying no to a row it considered. Decay is arithmetic; there is
    // nothing here for it to be blocked BY.
  },
  // The phases whose SUCCESS has always been durable and whose REFUSALS were an
  // in-process ring until 2026-09-20 (E2).
  //
  // **A NAMESPACE IS NOT A REFUSAL CHANNEL, AND THAT COST TWO ROUNDS TO LEARN.**
  // The first attempt read each phase's whole `skipped` map, which mixes
  // candidate filters (`journal`, `archived`, `schema`) with refusals, and
  // would have reported `blocked, most often journal ×14` every week. The
  // second read only each phase's own refusal NAMESPACE (`promotion:`,
  // `blocked:`, `left-alone:`) — and an adversarial review ran seven real
  // boundaries over forty ordinary memories and found the same false alarm
  // waiting there: `BLOCKED prune … dwell-too-short ×240` on a store where
  // nothing whatever is wrong, because physics' refusal vocabulary is itself
  // mostly "not yet".
  //
  // So every reason is classified by hand below, and only the GATES are read.
  // The test: did a NAMED RULE turn away a candidate that otherwise qualified?
  {
    // NO REFUSAL COLUMN. `PromotionReason` is `already-identity` (it is already
    // there — nothing to do), `base-below-identity-threshold` and
    // `insufficient-distinct-days` (not yet). Not one of the three is a gate:
    // promotion is a threshold, and a memory under a threshold has not been
    // refused, it has not arrived. `docs/promotion-diagnosis-2026-09-17.md`'s
    // real question — "did the phase even REACH these rows" — is answered by
    // `budgetExhausted` and `skippedForBudget` on the same cycle row, which is
    // where it belongs.
    id: "promotion",
    label: "a memory reinforced over several days is promoted into identity",
    module: "sleep/consolidate.ts",
    evidence: { kind: "event", names: ["band.promoted"] },
  },
  {
    // TWO GATES out of six. `declared-revision-never-merged` and
    // `revision-successor-never-merged` are rules refusing a merge that the
    // similarity would otherwise have made — the owner declared a revision, and
    // a revision is not a duplicate. The rest are not: `below-tau` and
    // `identical-content-hash`/`cosine-at-or-above-tau` are measurements, and
    // `no-similarity-supplied` is the embedder being off, which fires for EVERY
    // pair on the default configuration and already has its own amber on
    // doctor's Embedder line.
    id: "dedup",
    label: "a duplicate is merged into the memory it duplicates",
    module: "sleep/dedup.ts",
    evidence: { kind: "event", names: ["memory.merged"] },
    refusals: {
      names: ["sleep.cycle"],
      under: "dedup/left-alone:",
      only: ["declared-revision-never-merged", "revision-successor-never-merged"],
      since: "2026-09-20",
    },
  },
  {
    // TWO GATES out of five. `protected` is the owner saying this may never be
    // forgotten; `in-live-revision-chain` is a live chain holding a row that
    // the floor would otherwise have let go. Both are a rule refusing a memory
    // that qualified. `above-floor`, `dwell-too-short` and `band-not-episodic`
    // are the ordinary condition of almost every memory on almost every night —
    // the reviewer measured `dwell-too-short ×240` on a healthy forty-memory
    // store after seven boundaries.
    id: "prune",
    label: "a memory that has sat at the floor long enough is let go",
    module: "sleep/prune.ts",
    evidence: { kind: "event", names: ["memory.pruned"] },
    refusals: {
      names: ["sleep.cycle"],
      under: "prune/blocked:",
      only: ["protected", "in-live-revision-chain"],
      since: "2026-09-20",
    },
  },
  {
    // The entity-card fade (#215, 2026-09-24): its own sleep phase right after
    // the prune, which now leaves cards alone (sleep NOTES §17). Its per-card
    // events — `schema.faded`, `sleep.faded` — are in-process ring events, and
    // the card itself is archived `faded-by-decay` with no date, so the one
    // DURABLE trace is the `faded` count on the cycle row. Read plain, that row
    // would make every night a fade; `positive` takes only the nights that
    // faded something.
    //
    // **NO REFUSAL COLUMN, deliberately.** The phase's `fade/blocked:<reason>`
    // skips count EVERY blocker of every card that stayed — `blockedBy` lists
    // all the reasons a card may not fade, not the one that decided it — so
    // even the rule-like ones (`has-live-attached-elements`, `identity-core`)
    // land on cards nowhere near qualifying: the self card is blocked by
    // `identity-core` at every sweep. Declaring them would reproduce the
    // `dwell-too-short ×240` false alarm the prune row above describes. What
    // would fix it: a per-card DECIDING reason, recorded only for cards whose
    // physics verdict (the months of quiet) had already passed.
    id: "fade",
    label:
      "a card nobody has mentioned in months fades out of the vocabulary (gently: months of quiet, longer for people)",
    module: "sleep/fade.ts, schemas/index.ts",
    evidence: { kind: "event", names: ["sleep.cycle"], positive: "faded" },
    since: "2026-09-24",
  },
  {
    id: "revision",
    label: "a belief took a credited challenge and was revised under the pressure",
    module: "schemas/index.ts",
    evidence: { kind: "event", names: ["revision.pressure"] },
  },
  {
    // NARROWED 2026-09-20 (E2). This used to name all four. Promotion, prune
    // and dedup now carry their refusals on the rows above, read out of the
    // cycle row's per-phase skip map under each phase's own reason namespace.
    // Revision is the one left: its refusals never reach the cycle, because the
    // pressure arm runs in `schemas/` off a credited challenge and not in a
    // sleep phase at all.
    id: "night-refusals",
    label: "why a belief was NOT revised under a challenge it took",
    module: "schemas/index.ts",
    evidence: {
      kind: "none",
      reason:
        "the credit is durable and the refusal is an in-process ring (`schemas/index.ts:682`), so a belief that refused a challenge and one that was never challenged read alike. A `refused` map on the `revision.pressure` row that already exists would fix it.",
    },
  },
  {
    id: "gist",
    label: "the gist of many episodes is distilled into one lasting memory",
    module: "—",
    evidence: { kind: "none", reason: "not built yet; the storage spec marks it thin." },
  },

  // ── the self ─────────────────────────────────────────────────────────────
  {
    id: "briefing",
    label: "the waking briefing was composed — who I am, what is live, what is owed",
    module: "self/briefing.ts",
    evidence: { kind: "event", names: ["self.briefing"] },
  },
  // The self page (2026-09-18, S1). ONE row: the accepted writes are the
  // evidence, and the refusals are accounted for here rather than as a
  // mechanism of their own — a cap turning a page away is this mechanism
  // working, not a second one.
  {
    id: "self-page",
    label: "the written page of who I am was amended — by me, by the owner, or by the nightly writer",
    module: "self/page.ts",
    evidence: { kind: "event", names: ["self.page.revised"] },
    covers: ["self.page.refused"],
    since: "2026-09-18",
  },
  // The nightly writer (2026-09-20, S2) is its own row and not a `covers` on the
  // one above, because the two answer different questions. `self-page` asks "has
  // the page ever been amended", and a page the owner typed makes it green
  // forever; this asks "did last night happen", which is the question a page
  // that has stopped growing is the symptom of. A night that read the day and
  // had nothing to say still fires this row — that is the mechanism working.
  //
  // **NO `refusals` CHANNEL, on purpose** (checked against E2, 2026-09-20).
  // This mechanism has plenty of named skips — `no-previous-day`,
  // `already-claimed`, `asks-spent`, `no-memories`, `off`, and the two durable
  // deferrals `no-room` and `scope-question` — and almost none of them is a
  // GATE by the test `RefusalSource.only` sets. They are the ordinary condition
  // of most of every day: after the first ask, `already-claimed` is what a
  // healthy store says at every session start until midnight. Declaring them
  // would reproduce the `dwell-too-short ×240` false alarm one namespace over.
  // The one that is arguably a real gate — `no-room`, the host's ceiling
  // turning away a block that qualified — already has a louder and better-aimed
  // surface: doctor's Page writer line goes amber after two owed days and names
  // `injectionBudgetBytes` in its fix. A second surface saying `blocked` for
  // ever on a store with a tight ceiling would be the duplication E2's own
  // review warned about.
  {
    id: "page-writer",
    label: "the day just lived was read back and my page was offered a revision",
    module: "self/writer.ts",
    evidence: { kind: "event", names: ["self.page.writer.ran"] },
    since: "2026-09-20",
  },
  // The per-directory handoff (2026-09-20, E1). TWO rows, for the reason the
  // snapshot pair has two: "a session left one" and "a session was handed one"
  // answer different questions, and the second is the one that goes quiet first
  // — a pointer that stops being delivered (an expiry nobody meant, a budget
  // with no room) leaves the writing row firing and the owner none the wiser.
  // The refusals ride with the writing, because a cap turning a handoff away is
  // that mechanism working rather than a third one.
  {
    id: "handoff-written",
    label: "a session left a handoff for the next one in that directory",
    module: "handoff/index.ts",
    evidence: { kind: "event", names: ["handoff.written"] },
    covers: ["handoff.refused", "handoff.cleared"],
    since: "2026-09-20",
  },
  {
    id: "handoff-shown",
    label: "a session waking in that directory was handed the pointer to its handoff",
    module: "handoff/index.ts",
    evidence: { kind: "event", names: ["handoff.shown"] },
    since: "2026-09-20",
  },
  {
    id: "wake-injected",
    label: "that briefing was handed to the host at the start of a session",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.wake.injected"] },
  },
  {
    id: "wake-delivered",
    label: "whether the briefing actually arrived was checked on the next turn",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.wake.delivered"] },
  },
  {
    id: "primacy",
    label: "the A/B hand-off that let the older system speak first during the parallel run",
    module: "claude-code/hooks.ts",
    evidence: { kind: "event", names: ["adapter.primacy.deliver", "adapter.primacy.standdown"] },
    retired: "the parallel run left its primacy phase on 2026-09-04",
  },
  {
    id: "protection",
    label: "the owner marked a memory permanent, so nothing may revise or forget it",
    module: "physics/, store/",
    evidence: {
      kind: "probe",
      probe: "protected",
      undated:
        "protection is a flag on the row with no history behind it — the store can say which memories carry it and never when one was given it. A `versions` row with reason `protected` would fix it.",
    },
  },
  {
    id: "removal",
    label: "the owner erased a memory, and the erasure left a record",
    module: "store/owner-op-seam.ts",
    evidence: { kind: "probe", probe: "removals" },
  },
  {
    id: "unmerge",
    label: "the owner put back a memory a merge had archived",
    module: "store/owner-op-seam.ts",
    evidence: { kind: "event", names: ["memory.unmerged"] },
  },
  {
    id: "prospective-armed",
    label: "something to remember at a future date was set",
    module: "prospective/",
    evidence: {
      kind: "probe",
      probe: "prospective.armed",
      undated:
        "the row records the date it is FOR and never the day it was set, so nothing says when one was armed.",
    },
  },
  {
    // STILL BLIND, and the rows are built and waiting (2026-09-20, E2).
    //
    // `prospective.fire` and `prospective.fire.refused` exist now and are
    // written by `Prospective.fire()`. What does NOT exist is a caller: the
    // only one in the tree is `tools/demo/seed.ts` (mechanism inventory §3 S4).
    // So pointing this row's evidence at the new name would make it read `new`
    // for two days and then `never` for ever — durable evidence asserted for a
    // mechanism nothing can make fire, which is the blind case wearing a never
    // label, and exactly the confusion this view exists to break.
    //
    // It goes back to event evidence the day the surfacing path spends a fire.
    id: "prospective-fired",
    label: "that future date arrived and the reminder came back",
    module: "prospective/",
    evidence: {
      kind: "none",
      reason:
        "the two rows that would record it now exist (`prospective.fire`, `prospective.fire.refused`) and nothing calls `fire()` outside the demo seeder, so no row can land: `arrivals()` is read every turn but the fire budget is never spent. Wiring the surfacing path to spend it is what closes this, not another row.",
    },
    covers: ["prospective.fire", "prospective.fire.refused"],
  },

  // ── the machinery underneath ─────────────────────────────────────────────
  {
    id: "embed",
    label: "memories without a vector were given one by the background worker",
    module: "bin/runner.ts, store/cache.ts",
    evidence: { kind: "event", names: ["adapter.embed.backfill"] },
    // The identity check (#190) is a state TRANSITION of the same vectors — a
    // reset, a hold, a release — not a mechanism that fires on a schedule, so
    // this row speaks for it rather than grading it on its own.
    covers: ["store.embedder.reconciled"],
  },
  {
    id: "semantic-lag",
    label: "the worker left the next turn's semantic cue ready",
    module: "store/cache.ts",
    evidence: { kind: "event", names: ["adapter.semantic.lag"] },
  },
  {
    // The row the note below asked for, written since 2026-09-20 (E2) — one per
    // calendar date, latched, because a boundary is a hot path. Its refusals
    // come from the three rows of `worker-trouble`, which is what turns a week
    // of silence from `never` into `blocked, by NO_CREDENTIAL`.
    id: "worker-start",
    label: "the background worker started when a session reached a boundary",
    module: "claude-code/hooks.ts, bin/runner.ts",
    evidence: { kind: "event", names: ["adapter.spawn.started"] },
    refusals: {
      names: ["adapter.spawn.refused", "adapter.spawn.failed", "adapter.runner.failed"],
    },
    since: "2026-09-20",
  },
  {
    id: "worker-trouble",
    label: "the worker was refused, could not be started, or failed after starting",
    module: "claude-code/hooks.ts, bin/runner.ts",
    evidence: {
      kind: "event",
      names: ["adapter.spawn.refused", "adapter.spawn.failed", "adapter.runner.failed"],
    },
  },
  {
    id: "checkout",
    label: "which copy of the code the hooks were actually running",
    module: "claude-code/doctor.ts",
    evidence: { kind: "event", names: ["adapter.checkout"] },
  },
  {
    id: "scope-verdict",
    label: "a directory's own setting decided whether to remember there at all",
    module: "adapters/scopes.ts",
    evidence: {
      kind: "none",
      reason:
        "off and paused are decided BEFORE the store is opened, so no store row is possible at that instant. A counter file beside the scope registry, read by doctor, is the only shape that fits.",
    },
  },
  {
    id: "snapshot",
    label: "a whole copy of the store was set aside, and old copies were let go",
    module: "adapters/snapshots.ts",
    evidence: { kind: "event", names: ["snapshot.taken"] },
    // The rotation row is the same mechanism saying what it discarded, and the
    // failure row is the same mechanism saying it could not. Neither is evidence
    // that a copy EXISTS, which is what this row's state is about — so they are
    // accounted for here rather than given states of their own.
    covers: ["snapshot.rotated"],
    since: "2026-09-18",
  },
  {
    // Split from the row above for the reason `worker-start` and
    // `worker-trouble` are split: "a copy exists" and "a copy was attempted and
    // could not be made" are different questions, and a failure counted as a
    // firing would make a store with no backup at all read as covered. Its
    // refusal column names the step and the reason (`REFUSAL_READERS`).
    id: "snapshot-trouble",
    label: "a copy of the store could not be made (the store itself is unharmed)",
    module: "adapters/snapshots.ts",
    evidence: { kind: "event", names: ["snapshot.failed"] },
    since: "2026-09-18",
  },
  {
    // Raw-transcript retention (B3). One row per date, whatever the pass came
    // to — `PRUNED`, `NOTHING`, `IO_FAILED`, or `STARTED` / `LATCH_HELD` for a
    // pass that has not written its result — so a row is evidence the pass RAN;
    // what it found is doctor's `Raw transcripts` line.
    id: "retention",
    label: "the raw transcript of a session that owes nothing was let go a week after it ended",
    module: "remember/retention.ts (run by the worker)",
    evidence: { kind: "event", names: ["remember.prune"] },
    since: "2026-09-23",
  },
  {
    id: "backup",
    label: "the store was backed up BY HAND, from the console",
    module: "cli/commands.ts",
    evidence: {
      kind: "none",
      reason:
        "the `backup` command leaves no row at all, so one that ran and one that never has are the same silence. The AUTOMATIC daily copy has had its own rows since 2026-09-18 (the `snapshot` row above); the console command is the other half. One `store.backup` event would fix it.",
    },
  },
  {
    // F6, 2026-09-20. The plan called this row `journal-file`; the id here is
    // what the owner's brief calls it — "the journal copy" — and both names are
    // in the PR so neither gets lost. `covers` the failure row rather than
    // splitting it the way `snapshot`/`snapshot-trouble` are: a copy that could
    // not be written is a file missing beside a chapter that is safe, which is a
    // doctor line (amber, and only while it stands), not a second mechanism.
    id: "journal-copy",
    label: "the journal was written out as markdown files you can open in any editor",
    module: "core/self/journal-file.ts",
    evidence: { kind: "event", names: ["journal.copy.written"] },
    covers: ["journal.copy.failed"],
    since: "2026-09-20",
  },
  {
    // F7, 2026-09-20, and deliberately NOT the `backup` row above: that one is
    // still blind and still says what would fix it. This is the other door —
    // the one that answers "did anything leave this machine, and when".
    id: "export",
    label: "the owner took a readable copy of the memories off this machine, by hand",
    module: "cli/export.ts",
    evidence: { kind: "event", names: ["store.export"] },
    since: "2026-09-20",
  },
];

// ── the report ──────────────────────────────────────────────────────────────

export interface FiredRow {
  readonly id: string;
  readonly label: string;
  readonly module: string;
  readonly state: FiredState;
  /** The calendar date of the newest row, or `lived day N` for a table that
   *  counts in lived days, or null when nothing has ever been recorded. */
  readonly lastFired: string | null;
  /** True when `lastFired` is a `YYYY-MM-DD` calendar date rather than a lived day. */
  readonly lastFiredIsDate: boolean;
  readonly firedInWindow: number;
  readonly firedInPreviousWindow: number;
  /** Everything the store still holds. A floor when the report is `truncated`. */
  readonly total: number;
  readonly refusedInWindow: number;
  readonly topRefusal: string | null;
  /** The dotted names or the table this row was read from, for the reader who greps. */
  readonly evidence: string;
  /** Present on `blind`, `disabled`, `retired` and `new` — the line that says why. */
  readonly note: string | null;
}

export interface FiredReport {
  readonly today: string;
  /** The first day of the window — today and the six before it. */
  readonly from: string;
  /** The seven days before that — the window a `quiet` verdict is measured against. */
  readonly previousFrom: string;
  readonly previousTo: string;
  readonly rows: readonly FiredRow[];
  /** Mechanism ids whose evidence is a table this pass did not read. */
  readonly notRead: readonly string[];
  /** The event read reached its ceiling, so every `total` is a floor. */
  readonly truncated: boolean;
  readonly probesRead: boolean;
  /** The id scan reached its ceiling, so every probe count is a floor. */
  readonly probesTruncated: boolean;
  readonly counts: Record<FiredState, number>;
  /**
   * Mechanisms that fired in the PREVIOUS seven days and not once in this one,
   * by label. The one list on this page that says something CHANGED.
   */
  readonly wentQuiet: readonly string[];
  /**
   * Mechanisms that fired in the PREVIOUS seven days, not once in this one, and
   * were REFUSED instead — `wentQuiet`'s sibling, and the more alarming of the
   * two.
   *
   * It exists because `blocked` outranks `quiet` in the state machine, so a
   * mechanism that fired last week and was turned away every day this week
   * leaves `wentQuiet` and would have left no list at all. Doctor's Fired line
   * grades on both, or adding a state that says MORE would have made the
   * finding read greener.
   */
  readonly wentBlocked: readonly string[];
  /** The store's own clock — the number of days it has actually LIVED. */
  readonly livedDay: number;
  /** Calendar days between the oldest row this pass read and today, or null
   *  when the store holds no durable row at all. */
  readonly calendarDays: number | null;
  /**
   * TOO NEW TO GRADE (2026-09-20, finding 2).
   *
   * A store minutes old opened this view with twenty-eight `never` lines, which
   * is what a broken install looks like. Nothing had fired because nothing had
   * happened yet, and no surface said so. `young` is that sentence as a fact the
   * three renderers share rather than each deciding for itself.
   *
   * BOTH clocks have to agree. A lived day is advanced by the worker, so a store
   * whose worker has been dead for a fortnight also reads lived day 0 — and that
   * store must get the full list, because the full list is the diagnosis. So:
   * fewer than `YOUNG_LIVED_DAYS` lived days AND no durable row older than
   * `YOUNG_LIVED_DAYS` calendar days.
   */
  readonly young: boolean;
}

/** Under this many lived days — and calendar days — a store is too new to grade. */
export const YOUNG_LIVED_DAYS = 2;

export interface FiredOptions {
  /**
   * Read the tables that stand in for a mechanism with no event — edges,
   * prospective, protected, removals, versions. ON by default. The probes cost a
   * few queries per memory, because `Store` offers no aggregate over tables
   * keyed by memory id, so the one caller on a hook's hot path turns them off
   * and the report NAMES what it did not read rather than guessing at it.
   */
  readonly probes?: boolean;
}

/** `YYYY-MM-DD`, `back` days before `today` — label arithmetic (`time.ts`). */
export function daysBefore(today: string, back: number): string {
  try {
    return addDays(today, -back);
  } catch {
    return today;
  }
}

/** True when this mechanism's refusal channel is younger than the window the
 *  `wentBlocked` comparison measures against, so the two weeks are not
 *  comparable and the claim is withheld rather than made wrongly. */
function comparisonIsTooYoung(id: string, w: Window): boolean {
  const since = MECHANISMS.find((m) => m.id === id)?.refusals?.since;
  return since !== undefined && since > w.previousFrom;
}

/** Whole calendar days from `from` to `to`, 0 when either date does not parse. */
export function daysBetween(from: string, to: string): number {
  try {
    return calendarDaysBetween(from, to);
  } catch {
    return 0;
  }
}

/** The lived clock, or 0. A diagnostic may not become the thing that throws. */
function safeLivedDay(store: ReadOnlyStore): number {
  try {
    return store.livedDay();
  } catch {
    return 0;
  }
}

/**
 * THE READING. One pass over the log, one optional pass over the ids, and a row
 * per mechanism. Pure over the store, and never a write.
 */
export function firedReport(store: ReadOnlyStore, today: string, opts: FiredOptions = {}): FiredReport {
  const window: Window = {
    from: daysBefore(today, FIRED_DAYS - 1),
    to: today,
    previousFrom: daysBefore(today, FIRED_DAYS * 2 - 1),
    previousTo: daysBefore(today, FIRED_DAYS),
    zone: store.zone(),
  };
  const log = readLog(store, window);
  const probed = opts.probes === false ? null : readProbes(store, window);

  const rows: FiredRow[] = [];
  const notRead: string[] = [];
  for (const m of MECHANISMS) {
    if (m.evidence.kind === "probe" && probed === null) {
      notRead.push(m.id);
      continue;
    }
    rows.push(rowFor(m, log, probed, window));
  }

  const counts = Object.fromEntries(FIRED_STATES.map((s) => [s, 0])) as Record<FiredState, number>;
  for (const row of rows) counts[row.state] += 1;

  const livedDay = safeLivedDay(store);
  const calendarDays =
    log.oldestDate === null ? null : Math.max(0, daysBetween(log.oldestDate, today));

  return {
    today,
    from: window.from,
    previousFrom: window.previousFrom,
    previousTo: window.previousTo,
    rows: sortRows(rows),
    notRead,
    truncated: log.truncated,
    probesRead: probed !== null,
    probesTruncated: probed?.truncated ?? false,
    counts,
    livedDay,
    calendarDays,
    young: livedDay < YOUNG_LIVED_DAYS && (calendarDays === null || calendarDays < YOUNG_LIVED_DAYS),
    // WEEK OVER WEEK, and only where BOTH weeks could answer. A refusal channel
    // younger than the older window makes a schema change read as a regression
    // — "your prune phase stopped working on deploy day" when all that happened
    // is that the rows started carrying a field. The row still says `blocked`,
    // which is true of this week; the comparison is what is withheld.
    wentBlocked: rows
      .filter(
        (r) =>
          r.state === "blocked" &&
          r.firedInPreviousWindow > 0 &&
          !comparisonIsTooYoung(r.id, window),
      )
      .map((r) => `${r.label} (${r.topRefusal ?? UNNAMED_REFUSAL})`),
    wentQuiet: rows
      .filter((r) => r.state === "quiet" && r.firedInPreviousWindow > 0)
      // A row whose table keeps only LIVED days was compared on the lived clock,
      // which has run seven days across fifteen calendar ones — so the sentence
      // says which clock answered rather than claiming a calendar week it did
      // not measure.
      .map((r) => (r.lastFiredIsDate ? r.label : `${r.label} (measured in lived days)`)),
  };
}

/** Silent first, then by state, then most-recently-fired first inside a state —
 *  with the rows a lived clock answered after the dated ones, because the two
 *  spellings do not compare and an order that pretended they did would shuffle. */
export function sortRows(rows: readonly FiredRow[]): FiredRow[] {
  return [...rows].sort((a, b) => {
    const byState = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
    if (byState !== 0) return byState;
    if (a.lastFiredIsDate !== b.lastFiredIsDate) return a.lastFiredIsDate ? -1 : 1;
    if (a.lastFired !== b.lastFired) {
      if (a.lastFired === null) return 1;
      if (b.lastFired === null) return -1;
      return a.lastFired < b.lastFired ? 1 : -1;
    }
    return a.id < b.id ? -1 : 1;
  });
}

// ── one row per mechanism ───────────────────────────────────────────────────

interface Window {
  readonly from: string;
  readonly to: string;
  readonly previousFrom: string;
  readonly previousTo: string;
  /** The zone a moment's calendar date is read in (`Store#zone`). */
  readonly zone: string;
}

/** A reading of one piece of evidence, before the state is decided. */
interface Reading {
  readonly total: number;
  readonly lastFired: string | null;
  readonly lastFiredIsDate: boolean;
  readonly inWindow: number;
  readonly inPreviousWindow: number;
  readonly refused: number;
  readonly topRefusal: string | null;
  /** Every refusal reason and its count, so a source read from another row can
   *  be merged in without re-reading the log. */
  readonly refusals: ReadonlyMap<string, number>;
  readonly evidence: string;
  /** The rows the refusal column came from — the same as `evidence` unless the
   *  refusals live somewhere else (`Mechanism.refusals`). */
  readonly refusalEvidence: string;
  /** Set when this evidence cannot answer the question at all. */
  readonly blind: string | null;
}

const EMPTY_READING: Reading = {
  total: 0,
  lastFired: null,
  lastFiredIsDate: false,
  inWindow: 0,
  inPreviousWindow: 0,
  refused: 0,
  topRefusal: null,
  refusals: new Map(),
  evidence: "",
  refusalEvidence: "",
  blind: null,
};

function rowFor(m: Mechanism, log: LogRead, probed: Probed | null, w: Window): FiredRow {
  const read = readEvidence(m, log, probed);
  const state = stateOf(m, read, w);
  return {
    id: m.id,
    label: m.label,
    module: m.module,
    state,
    lastFired: read.lastFired,
    lastFiredIsDate: read.lastFiredIsDate,
    firedInWindow: read.inWindow,
    firedInPreviousWindow: read.inPreviousWindow,
    total: read.total,
    refusedInWindow: read.refused,
    topRefusal: read.topRefusal,
    evidence: read.evidence,
    note: noteFor(m, read, state),
  };
}

/**
 * THE STATE MACHINE, in the order the answers override each other: a named
 * stand-down and a retired phase are facts about the DESIGN and outrank every
 * count; blindness is a fact about the EVIDENCE and outranks the rest; only then
 * do the counts speak.
 */
function stateOf(m: Mechanism, read: Reading, w: Window): FiredState {
  if (m.disabled !== undefined) return "disabled";
  if (m.retired !== undefined) return "retired";
  if (read.blind !== null) return "blind";
  if (read.inWindow > 0) return "firing";
  // DID NOT FIRE, AND SOMETHING SAID WHY (E2). This outranks both `quiet` and
  // `never` because it answers the question they leave open: a mechanism that
  // was turned away every time it was reached is not one that had nothing to do.
  if (read.refused > 0) return "blocked";
  if (read.total > 0) return "quiet";
  // Never fired. A mechanism whose EVIDENCE is younger than the window has not
  // had time to be a worry yet, and grading it as one is how a view teaches its
  // reader to ignore it.
  if (m.since !== undefined && m.since >= w.from) return "new";
  return "never";
}

function noteFor(m: Mechanism, read: Reading, state: FiredState): string | null {
  if (state === "disabled") return m.disabled ?? null;
  if (state === "retired") return m.retired ?? null;
  if (state === "blind") return read.blind;
  if (state === "new" && m.since !== undefined) return `its evidence was added ${m.since}`;
  if (state === "blocked") {
    // The whole point of the state, in one sentence: not "quiet", not "never" —
    // reached, and stopped, this many times, by this.
    const by = read.topRefusal === null ? "" : `, most often ${read.topRefusal}`;
    return `it did not fire this week; ${String(read.refused)} refusal${
      read.refused === 1 ? "" : "s"
    } landed instead${by} (${read.refusalEvidence})`;
  }
  return null;
}

function readEvidence(m: Mechanism, log: LogRead, probed: Probed | null): Reading {
  const base =
    m.evidence.kind === "none"
      ? { ...EMPTY_READING, evidence: "no durable row", blind: m.evidence.reason }
      : m.evidence.kind === "probe"
        ? probeReading(m.evidence.probe, m.evidence.undated ?? null, probed)
        : eventReading(m.evidence.names, log, m.evidence.positive);
  if (m.refusals === undefined) return base;
  // Refusals from ANOTHER row, folded in without touching the counts that say
  // whether this mechanism fired.
  const extra = refusalReading(m.refusals, log);
  if (extra.refused === 0) return { ...base, refusalEvidence: base.evidence };
  const merged = new Map<string, number>(extra.refusals);
  for (const [reason, n] of base.refusals) merged.set(reason, (merged.get(reason) ?? 0) + n);
  return {
    ...base,
    refused: base.refused + extra.refused,
    refusals: merged,
    topRefusal: topOf(merged),
    refusalEvidence: m.refusals.names.join(", "),
  };
}

/** The refusal half of a reading, from rows that are NOT this mechanism's
 *  evidence. It contributes no `total`, no `lastFired` and no `inWindow`: a
 *  refusal is the opposite of a firing, and counting it as one is the bug. */
function refusalReading(src: RefusalSource, log: LogRead): { refused: number; refusals: Map<string, number> } {
  const refusals = new Map<string, number>();
  let refused = 0;
  for (const name of src.names) {
    const t = log.byName.get(name);
    if (t === undefined) continue;
    for (const [reason, n] of t.refusals) {
      if (src.under !== undefined && !reason.startsWith(src.under)) continue;
      const key = src.under === undefined ? reason : reason.slice(src.under.length);
      // THE ALLOW-LIST. Everything a phase counted that is not named here is a
      // candidate filter, not a refusal, and counting it is how this view
      // teaches its reader to ignore it.
      if (src.only !== undefined && !src.only.includes(key)) continue;
      refusals.set(key, (refusals.get(key) ?? 0) + n);
      refused += n;
    }
  }
  return { refused, refusals };
}

function eventReading(
  names: readonly DurableEventName[],
  log: LogRead,
  positive?: string,
): Reading {
  let total = 0;
  let inWindow = 0;
  let inPreviousWindow = 0;
  let refused = 0;
  let lastFired: string | null = null;
  const refusals = new Map<string, number>();
  for (const name of names) {
    const t = log.byName.get(positive === undefined ? name : filteredKey(name, positive));
    if (t === undefined) continue;
    total += t.total;
    inWindow += t.inWindow;
    inPreviousWindow += t.inPreviousWindow;
    refused += t.refused;
    if (t.lastDate !== null && (lastFired === null || t.lastDate > lastFired)) {
      lastFired = t.lastDate;
    }
    for (const [reason, n] of t.refusals) refusals.set(reason, (refusals.get(reason) ?? 0) + n);
  }
  return {
    total,
    lastFired,
    lastFiredIsDate: lastFired !== null,
    inWindow,
    inPreviousWindow,
    refused,
    topRefusal: topOf(refusals),
    refusals,
    // The filter is part of the evidence: `sleep.cycle` alone would read as the
    // same row the `sleep-cycle` line is, to the reader who greps.
    evidence: positive === undefined ? names.join(", ") : `${names.join(", ")} (${positive} > 0)`,
    refusalEvidence: names.join(", "),
    blind: null,
  };
}

/** The reason with the most against it; ties broken by name, so a line a test
 *  pins does not depend on map order. */
function topOf(refusals: ReadonlyMap<string, number>): string | null {
  let top: [string, number] | null = null;
  for (const [reason, n] of refusals) {
    if (top === null || n > top[1] || (n === top[1] && reason < top[0])) top = [reason, n];
  }
  return top === null ? null : `${top[0]} ×${String(top[1])}`;
}

// ── the one pass over the log ───────────────────────────────────────────────

interface NameTally {
  total: number;
  lastDate: string | null;
  inWindow: number;
  inPreviousWindow: number;
  refused: number;
  refusals: Map<string, number>;
}

interface LogRead {
  readonly byName: ReadonlyMap<string, NameTally>;
  readonly truncated: boolean;
  /** The calendar date of the OLDEST row this pass saw, for the store's age.
   *  A truncated read is the oldest rows, so this stays right when it happens. */
  readonly oldestDate: string | null;
}

/**
 * The tally key for a name read through a `positive` filter. A character no
 * durable event name carries, so it cannot collide with a real one.
 */
function filteredKey(name: string, field: string): string {
  return `${name}#${field}`;
}

/**
 * Every payload filter the registry declares, by event name — derived from
 * `MECHANISMS` rather than listed, so a row that adds a filter is tallied
 * without a second list to keep in step.
 */
const POSITIVE_FIELDS: ReadonlyMap<string, readonly string[]> = (() => {
  const out = new Map<string, string[]>();
  for (const m of MECHANISMS) {
    if (m.evidence.kind !== "event" || m.evidence.positive === undefined) continue;
    for (const name of m.evidence.names) {
      const fields = out.get(name) ?? [];
      if (!fields.includes(m.evidence.positive)) fields.push(m.evidence.positive);
      out.set(name, fields);
    }
  }
  return out;
})();

function emptyTally(): NameTally {
  return {
    total: 0,
    lastDate: null,
    inWindow: 0,
    inPreviousWindow: 0,
    refused: 0,
    refusals: new Map(),
  };
}

/**
 * The events, read once and grouped here — `Store` offers no GROUP BY, and a
 * query per mechanism per day would make this the slowest thing doctor does.
 *
 * `eventLog` orders ASCENDING and takes a LIMIT, so a read that comes back FULL
 * is the OLDEST rows and the newest days are exactly the ones missing — which is
 * the window this report is about. In that case a SECOND, day-bounded read
 * covers both windows, the two are joined on `seq` so nothing is counted twice,
 * and every total is declared a floor.
 */
function readLog(store: ReadOnlyStore, w: Window): LogRead {
  const byName = new Map<string, NameTally>();
  const age = { oldest: null as string | null };
  const first = store.eventLog({ limit: EVENT_CEILING });
  for (const row of first) tallyRow(byName, row, w, age);
  if (first.length < EVENT_CEILING) {
    return { byName, truncated: false, oldestDate: age.oldest };
  }
  const lastSeq = first[first.length - 1]?.seq ?? 0;
  // A lived day is never longer than a calendar day, so `livedDay - 14` cannot
  // cut a row inside the fourteen calendar days the two windows cover.
  const recent = store.eventLog({
    sinceDay: Math.max(0, store.livedDay() - FIRED_DAYS * 2),
    limit: EVENT_CEILING,
  });
  for (const row of recent) {
    if (row.seq <= lastSeq) continue;
    tallyRow(byName, row, w, age);
  }
  return { byName, truncated: true, oldestDate: age.oldest };
}

function tallyRow(
  byName: Map<string, NameTally>,
  row: EventRow,
  w: Window,
  age: { oldest: string | null },
): void {
  const payload = payloadOf(row);
  const date = rowDate(row, payload, w.zone);
  if (age.oldest === null || date < age.oldest) age.oldest = date;
  const t = countInto(byName, row.name, date, w);
  // THE FILTERED TALLIES, in the same pass (`Evidence.positive`). They count
  // the row and NOTHING ELSE: the refusal reader below answers for every phase
  // on a cycle row, and a filtered tally that copied it would hand the fade
  // row `prune/blocked:dwell-too-short ×240` on its own line.
  for (const field of POSITIVE_FIELDS.get(row.name) ?? []) {
    const v = payload[field];
    if (typeof v === "number" && v > 0) countInto(byName, filteredKey(row.name, field), date, w);
  }
  const inWindow = date >= w.from && date <= w.to;
  if (!inWindow) return;
  const reader = REFUSAL_READERS[row.name];
  if (reader === undefined) return;
  for (const [reason, n] of reader(payload)) {
    if (n <= 0) continue;
    t.refused += n;
    t.refusals.set(reason, (t.refusals.get(reason) ?? 0) + n);
  }
}

/** One row counted under `key`: its total, its date, and which window it fell in. */
function countInto(
  byName: Map<string, NameTally>,
  key: string,
  date: string,
  w: Window,
): NameTally {
  let t = byName.get(key);
  if (t === undefined) {
    t = emptyTally();
    byName.set(key, t);
  }
  t.total += 1;
  if (t.lastDate === null || date > t.lastDate) t.lastDate = date;
  if (date >= w.from && date <= w.to) t.inWindow += 1;
  else if (date >= w.previousFrom && date <= w.previousTo) t.inPreviousWindow += 1;
  return t;
}

/** The CALENDAR date a row is about: its own field, else the wall clock it was
 *  written at. `day` is the lived-day column and answers a different question. */
function rowDate(row: EventRow, payload: Record<string, unknown>, zone: string): string {
  const date = payload["date"];
  if (typeof date === "string" && date.length === 10) return date;
  return localDate(row.at, zone);
}

function payloadOf(row: EventRow): Record<string, unknown> {
  if (row.payload === null) return {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// ── refusals, read only from fields that exist today ────────────────────────

/**
 * WHAT WAS TURNED AWAY, per event name — and ONLY from a payload field the
 * writer already fills. The inventory's §5(c) named five; this is that list as
 * code. Nothing here invents a refusal channel, and a name absent from this
 * table simply has no refusal column on the page, which is the honest answer.
 */
const REFUSAL_READERS: Record<string, (p: Record<string, unknown>) => [string, number][]> = {
  // `outcome` says what happened; `reason` says why, and is the one worth
  // reading — the old shared day cap and the per-session allowance are two
  // different verdicts that both spell themselves `capped`.
  "adapter.ask": (p) => {
    const outcome = str(p, "outcome");
    if (outcome === null || outcome === "asked") return [];
    return [[str(p, "reason") ?? outcome, 1]];
  },
  // TOTAL by reason since 2026-09-14, `SWEPT` included — and `SWEPT` is the one
  // entry that is not a refusal at all, so it is excluded rather than counted.
  "sweep.gate": (p) => countsIn(p, "refusals").filter(([reason]) => reason !== "SWEPT"),
  "gate.chunk": (p) => countsIn(p, "refusalsByReason"),
  "gate.deposit": (p) => countsIn(p, "refusalsByReason"),
  "recall.credit": (p) => countsIn(p, "refused"),
  // Every `snapshot.failed` row IS a refusal — a copy that should have happened
  // and did not — so the reason it carries is the whole column.
  "snapshot.failed": (p) => {
    const reason = str(p, "reason");
    return reason === null ? [] : [[reason, 1]];
  },
  // THE SPAWN SEAM'S THREE (E2). Each row IS a refusal; the reason it carries is
  // the whole column, exactly like `snapshot.failed` above.
  //
  // **Counted as ONE per row on purpose.** These three are the one durable
  // family that carries a `dedupKey` — one row per reason per calendar date
  // (I32) — so the honest unit here is DAYS the worker was stopped, not
  // attempts. The row's own `count` field is a running counter that a single
  // successful start resets, so summing it across days would invent a number
  // nothing measured.
  "adapter.spawn.refused": (p) => reasonOnce(p),
  "adapter.spawn.failed": (p) => reasonOnce(p),
  "adapter.runner.failed": (p) => reasonOnce(p),
  // THE NIGHT'S REFUSALS (E2). Every phase counts what it turned away by reason
  // and the cycle row has carried them since 2026-09-20, so "why did this not
  // promote" is answerable from the store. Keyed `<phase>/<reason>` because one
  // row answers for four mechanisms and none of them may claim another's — the
  // `under` prefix on `Mechanism.refusals` is how each takes only its own.
  "sleep.cycle": (p) => {
    const out: [string, number][] = [];
    const phases = p["phases"];
    if (!Array.isArray(phases)) return out;
    for (const entry of phases) {
      if (entry === null || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const phase = typeof e["phase"] === "string" ? e["phase"] : null;
      if (phase === null) continue;
      for (const [reason, n] of countsIn(e, "skipped")) out.push([`${phase}/${reason}`, n]);
    }
    return out;
  },
  // Every refused write to the page IS a refusal, and the reason is the column.
  "self.page.refused": (p) => reasonOnce(p),
  // Same shape: the row IS the brake that held, named.
  "prospective.fire.refused": (p) => reasonOnce(p),
  /**
   * THE DELIBERATE LOOK'S CAPS, AND ONLY ITS CAPS.
   *
   * The row's `blockedBy` holds every verdict that kept something out, which is
   * what makes it a diagnostic. Most of those verdicts are not refusals:
   * `dark-uncued`, `below-floor` and `cue-fraction` mean "this memory was not
   * relevant", and `inhibited` means "a stronger twin already came back". One
   * ordinary question on a seventeen-memory store produced
   * `{"below-floor": 12}` — twelve memories that simply had nothing to do with
   * what was asked.
   *
   * `dim-cap:*` IS a refusal: those memories were reachable by effort and the
   * cap is what stopped them.
   *
   * `confidential-withheld` is deliberately NOT read, though the row keeps it.
   * It is the one verdict this package holds silent to the asker (§9.1 G5), and
   * every reader of this table renders to a screen — a console, a dashboard
   * panel — which is a third audience that gets screenshotted and screen-shared.
   * The row is for the owner reading their own store; a rendered line is not the
   * same thing, and the difference is the whole of the confidentiality rule.
   */
  "mcp.recall": (p) =>
    countsIn(p, "blockedBy").filter(([reason]) => reason.startsWith("dim-cap:")),
  // `rendered` is the turn that surfaced something; every other reason is a turn
  // that decided to stay quiet, which is what a refusal is here.
  "recall.decision": (p) => {
    const reason = str(p, "reason");
    return reason === null || reason === "rendered" ? [] : [[reason, 1]];
  },
};

/**
 * A row that IS a refusal: its `reason`, counted once.
 *
 * A row with no readable `reason` still counts (2026-09-20). It used to return
 * nothing at all, so a store holding an `adapter.spawn.refused` row with a
 * malformed payload reported the worker as never refused — the store knew and
 * the view said otherwise, which is the exact failure this whole page is about.
 * `UNNAMED` is what a reader sees instead, and it is the truth: something was
 * turned away and the row does not say what by.
 */
export const UNNAMED_REFUSAL = "(no reason recorded)";

function reasonOnce(p: Record<string, unknown>): [string, number][] {
  return [[str(p, "reason") ?? UNNAMED_REFUSAL, 1]];
}

function countsIn(p: Record<string, unknown>, key: string): [string, number][] {
  const raw = p[key];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: [string, number][] = [];
  for (const [reason, n] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof n === "number" && n > 0) out.push([reason, n]);
  }
  return out;
}

function str(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ── the table probes ────────────────────────────────────────────────────────

interface ProbeTally {
  total: number;
  /** The newest LIVED day this table records, or null when it records none. */
  lastLivedDay: number | null;
  /** The newest wall-clock instant, where the table keeps one. */
  lastAt: number | null;
  /** Counted PER ROW, like the log's: a table whose newest row is inside the
   *  window has not put every row it holds inside the window. */
  inWindow: number;
  inPreviousWindow: number;
}

interface Probed {
  readonly byId: ReadonlyMap<string, ProbeTally>;
  readonly livedDay: number;
  readonly truncated: boolean;
  readonly zone: string;
}

/**
 * The five tables the inventory's §5(b) named, read in ONE pass over the ids.
 *
 * `Store` offers no aggregate over `edges`, `prospective` or `versions` and no
 * `protected` field on `MemoryFilter` — every one of those is keyed by a memory
 * id — so this costs a few queries per memory and is bounded by `PROBE_CEILING`.
 * It is the read the console and the dashboard pay and the session-start reading
 * does not.
 */
function readProbes(store: ReadOnlyStore, w: Window): Probed {
  const byId = new Map<string, ProbeTally>();
  const livedDay = store.livedDay();
  const bump = (id: string, at: { livedDay?: number | null; at?: number | null } = {}): void => {
    let t = byId.get(id);
    if (t === undefined) {
      t = { total: 0, lastLivedDay: null, lastAt: null, inWindow: 0, inPreviousWindow: 0 };
      byId.set(id, t);
    }
    t.total += 1;
    const day = at.livedDay ?? null;
    if (day !== null && (t.lastLivedDay === null || day > t.lastLivedDay)) t.lastLivedDay = day;
    const when = at.at ?? null;
    if (when !== null && (t.lastAt === null || when > t.lastAt)) t.lastAt = when;
    // A wall clock answers in calendar days, which is the window this page uses.
    // A lived day is all some of these tables keep, and a lived day spans one
    // calendar day or more, so that window is a superset of the calendar one —
    // the row prints `lived day N` rather than a date so the reader can see
    // which clock answered.
    if (when !== null) {
      const date = localDate(when, w.zone);
      if (date >= w.from && date <= w.to) t.inWindow += 1;
      else if (date >= w.previousFrom && date <= w.previousTo) t.inPreviousWindow += 1;
      return;
    }
    if (day === null) return;
    const ago = livedDay - day;
    if (ago < FIRED_DAYS) t.inWindow += 1;
    else if (ago < FIRED_DAYS * 2) t.inPreviousWindow += 1;
  };

  for (const record of store.removalRecord()) bump("removals", { at: record.at });

  const ids = store.list();
  const scanned = ids.length > PROBE_CEILING ? ids.slice(0, PROBE_CEILING) : ids;
  for (const id of scanned) {
    const row = store.row(id);
    if (row !== undefined && row.archived === 0 && row.protected === 1) bump("protected");
    for (const edge of store.edgesFrom(id)) bump("edges", { livedDay: edge.last_day });
    for (const p of store.prospectiveFor(id)) {
      bump("prospective.armed");
      if (p.last_fired_day !== null) bump("prospective.fired", { livedDay: p.last_fired_day });
    }
    for (const v of store.versions(id)) {
      bump(`versions:${v.reason}`, { livedDay: v.version_day, at: v.archived_at });
    }
  }
  return { byId, livedDay, truncated: scanned.length < ids.length, zone: w.zone };
}

function probeReading(probe: ProbeId, undated: string | null, probed: Probed | null): Reading {
  const base: Reading = {
    ...EMPTY_READING,
    evidence: probeLabel(probe),
    refusalEvidence: probeLabel(probe),
  };
  if (probed === null) return { ...base, blind: "the tables were not read on this pass" };
  const t = probed.byId.get(probe);
  if (t === undefined || t.total === 0) return base;
  const counted = {
    ...base,
    total: t.total,
    inWindow: t.inWindow,
    inPreviousWindow: t.inPreviousWindow,
  };
  if (t.lastAt !== null) {
    return { ...counted, lastFired: localDate(t.lastAt, probed.zone), lastFiredIsDate: true };
  }
  if (t.lastLivedDay !== null) {
    return {
      ...counted,
      lastFired: `lived day ${String(t.lastLivedDay)}`,
      lastFiredIsDate: false,
    };
  }
  // Rows, and no date of any kind behind them: a count that cannot answer the
  // question this page asks. `undated` is the line that says so.
  return {
    ...base,
    total: t.total,
    blind: undated ?? "this table records no date, so nothing says when it last happened",
  };
}

function probeLabel(probe: ProbeId): string {
  if (probe.startsWith("versions:")) return `versions (${probe.slice("versions:".length)})`;
  if (probe === "protected") return "memories marked permanent";
  if (probe === "removals") return "the removal record";
  if (probe === "edges") return "the links table";
  return `the ${probe.replace(".", " ")} table`;
}
