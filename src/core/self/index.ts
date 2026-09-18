/**
 * `self/` — the autobiographical self: identity elements, the first-person
 * episode journal, and the wake briefing that restores a continuous self at
 * session start.
 *
 * The module's spine, and where each piece lives:
 *
 *   `identity.ts`  ranking by strength, the identity/protected enumeration, the
 *                  standing self-schema byte counter
 *   `briefing.ts`  the composed budget, the declared trim order, the header and
 *                  tail sentinel — no model, no network, no prompt
 *   `freeze.ts`    freeze-but-keep-counting: the lived-salience doctrine as a
 *                  pure verdict both arms compute
 *   `episodes.ts`  substance-paced chapters, live append, add-first ingestion
 *   `tunables.ts`  every knob, in one visible place — and NOT the byte budget
 *
 * Three properties are structural here and worth stating at the top.
 *
 * **RENDER and WAKE are different halves of different sessions.** `boundary()`
 * composes and publishes; `wake()` reads what was published and verifies it. The
 * briefing is the previous boundary's last content write, and wake performs no
 * computation, no model call, and no network access — nor any WRITE, which is the
 * part v1's own design left implicit and then leaned on.
 *
 * **The budget is the caller's.** `budgetBytes` is required on the request
 * because the injection ceiling is a host capability the adapter reports (scar
 * §2.18). v1's 9,000 was 90% of one host's cliff and there is deliberately no
 * such constant in this module.
 *
 * **The freeze withholds movement, never measurement.** `noteSelfConfirmation`
 * runs one walk with one set of guards and emits one event name; `frozen` is a
 * field on that event, not a different code path, so the frozen rate and the live
 * rate share a denominator (§14.2 G4).
 *
 * There is **no tool surface in this module**. v1's self-store tool is superseded
 * by experiencer authorship (contract §4): the doctrine that identity strength
 * comes from lived salience is kept whole, and the end-of-session write *is* the
 * front door it names. Authorship arrives through `remember/`; `self/` is where
 * it lands. *If a doctrine names the only legitimate inputs, those inputs must be
 * reachable by construction, not by a tool description nobody reads.*
 */
import type { Band, Kind } from "../types.js";
import { strength } from "../physics/index.js";
import type { CreditOutcome, UseTier } from "../physics/index.js";
import type { ProseDoc, Store } from "../store/index.js";
import { hashText } from "../store/index.js";
import {
  IDENTITY_CORE_ROLE,
  byteLength,
  RENDERED_PREFIX,
  enumerate,
  findIdentityCore,
  identityCoreName,
  rankLanes,
  scanActive,
  schemaBytes,
} from "./identity.js";
import type {
  Enumeration,
  IdentityCoreSpec,
  LaneName,
  Lanes,
  Ranked,
  Scanned,
  SchemaBytesReport,
} from "./identity.js";
import {
  BRIEFING_TRIM_LOG_CAP,
  FRAMING,
  LANE_ORDER,
  TRIM_ORDER,
  WAKE_SYSTEM,
  applyPreface,
  flatten,
  pageDateline,
  prefaceLine,
  readSentinel,
  render,
} from "./briefing.js";
import type {
  BriefingRequest,
  BriefingResult,
  PageBlock,
  Resolve,
  Resolved,
  SentinelReading,
} from "./briefing.js";
import {
  PAGE_META_BY,
  PAGE_META_REASON,
  PAGE_META_REVISED_DAY,
  PAGE_META_REVISED_ON,
  PAGE_TITLE,
  SELF_PAGE_REFUSED_EVENT,
  SELF_PAGE_REVISED_EVENT,
  SELF_PAGE_ROLE,
  findSelfPage,
  readSelfPage,
  renderPage,
} from "./page.js";
import type { SelfPage, SelfPageAuthor } from "./page.js";
import { COUNTER_PREFIX, FROZEN_KINDS, counterKey, decide } from "./freeze.js";
import type { ClaimDirection, ClaimSource, FreezeReason, FreezeVerdict } from "./freeze.js";
import {
  NO_GATE,
  appendChapter,
  askDue,
  askText,
  asksSpentOn,
  findIngested,
  freshEpisodeState,
  ingestKey,
  intakeEpisode,
  loadEpisodeState,
  memoriesForEpisode,
  stateKey,
} from "./episodes.js";
import type {
  AskVerdict,
  EpisodeGate,
  EpisodeIntakeReason,
  EpisodeProposal,
  EpisodeState,
  IngestResult,
  Substance,
} from "./episodes.js";
import { withTunables } from "./tunables.js";
import type { SelfTunables } from "./tunables.js";

export * from "./briefing.js";
export * from "./page.js";
export * from "./episodes.js";
export * from "./freeze.js";
export * from "./identity.js";
export * from "./tunables.js";

/** Telemetry: ids, counts, bytes, reasons, flags. NEVER statement text. */
export interface SelfEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

/**
 * The published briefing lives in box 2, under one key, written by one
 * transactional `setMeta` — so a concurrent read sees the old bundle or the new
 * one and never an empty string. v1's `wake.md` was the one live-read file still
 * written non-atomically, and because an empty string is falsy, an empty
 * concurrent read printed "your persistent memory is initializing" over a full
 * store: identity amnesia disguised as a fresh install (scar §2.3).
 * INTERFACE-GAPS #4 records the store-owned render file this should become.
 */
export const BRIEFING_KEY = "self.briefing";

/**
 * The honest bootstrap line, and the ONLY case that may be shown in place of a
 * bundle: no bundle has ever been published. A present-but-damaged bundle is an
 * error with its own reason — never this line.
 */
export const BOOTSTRAP = "No briefing has been composed yet — this store has not lived a boundary.";

export interface SelfOptions {
  store: Store;
  tunables?: Partial<SelfTunables>;
  /** Episode ingestion runs the ordinary gate battery. Absent means REFUSE. */
  gate?: EpisodeGate;
  onEvent?: (e: SelfEvent) => void;
  now?: () => number;
}

/** An arriving occasion. `prospective/` owns the ordering (INTERFACE-GAPS #3). */
export interface HorizonItem {
  readonly id: string;
}

export interface BoundaryRequest extends BriefingRequest {
  readonly horizon?: readonly HorizonItem[];
  /** When supplied, the boundary ensures the identity core's home row exists in
   *  the shape `schemas/` indexes. Idempotent (schemas/INTERFACE-GAPS #5). */
  readonly identityCore?: IdentityCoreSpec;
  /** Override the id → statement seam (tests, replay, the dashboard). */
  readonly resolve?: Resolve;
  /**
   * Stand an active memory OUT of this composition, before any lane sees it.
   *
   * The owner's own wake never passes one — it is the owner-facing surface and
   * shows everything the store holds (`identity.ts#rankLanes`). It exists for a
   * composition that will LEAVE THE MACHINE: `Counterpart.sweepFallback` wakes
   * the crash-fallback interpreter with the self before it reads a transcript,
   * and that prompt is an egress surface, so confidential and protected rows are
   * omitted there (constitution 6; the same stand-aside `schemas/` makes for the
   * interpreter's cards, §14.1 G2). The predicate lives with the CALLER because
   * the confidentiality class is `recall/`'s to read, not this module's.
   *
   * Filtering here rather than after ranking is deliberate: an omitted row must
   * not occupy a lane slot or a byte of the budget it will never render into.
   *
   * PASSING ONE ALSO SUPPRESSES THE DAY-0 LINE (see `build`): an empty identity
   * lane means "nothing survived the filter" here, not "this store has no self",
   * and the two must not render the same sentence.
   */
  readonly omit?: (s: Scanned) => boolean;
}

export type PublishReason = "published" | "observer";

export interface BoundaryResult {
  readonly briefing: BriefingResult;
  readonly schema: SchemaBytesReport;
  readonly published: boolean;
  readonly reason: PublishReason;
  /** Content hash of the published text — telemetry that is not the text. */
  readonly hash: string;
}

export type WakeReason =
  | "delivered"
  | "absent"
  | "empty-read"
  | "sentinel-missing"
  | "sentinel-mismatch";

export interface WakeResult {
  /** What to inject. The bootstrap line ONLY when nothing was ever published. */
  readonly text: string;
  /** True when a bundle was read and its sentinel verified against its bytes. */
  readonly ok: boolean;
  readonly reason: WakeReason;
  /** Bytes of what is INJECTED — the preface included, when one was composed. */
  readonly bytes: number;
  /** The sentinel of the injected text: with a preface, the rewritten one. */
  readonly sentinel: string | null;
  /** The integrity reading of the STORED bundle, before any preface. */
  readonly reading: SentinelReading | null;
  /** The delivery-time line, or null when none was asked for or it could not
   *  be applied (a damaged bundle is never rewritten). */
  readonly preface: string | null;
}

/**
 * What the DELIVERING host knows and the stored bundle cannot: today's date.
 * Passing this object at all is the request for a delivery preface; passing
 * nothing returns the published bundle byte for byte, which is what every
 * non-delivering reader (the dashboard, a test, replay) wants.
 */
export interface WakeDelivery {
  /** Today's calendar date as the host reports it. Absent ⇒ no date is stated. */
  readonly date?: string;
}

export interface ClaimOccasion {
  /** The address the confirmation names. It may be stale; it is resolved. */
  readonly elementId: string;
  readonly source: ClaimSource;
  readonly direction: ClaimDirection;
  readonly tier?: UseTier;
  readonly day?: number;
}

export type ClaimReason = FreezeReason | "unresolved" | "observer";

export interface ClaimOutcome {
  readonly frozen: boolean;
  readonly reason: ClaimReason;
  readonly resolvedId: string | null;
  readonly kind: Kind | null;
  readonly band: Band | null;
  /** Whether physics was asked to move anything. */
  readonly reinforced: boolean;
  readonly credit: CreditOutcome | null;
  /** Strength before and after the walk. Equal is the guarantee, not an aside. */
  readonly strengthBefore: number | null;
  readonly strengthAfter: number | null;
  /** The occasion's counter after this occasion — the measurement that survives
   *  the withheld movement (§14.2 G4). */
  readonly count: number;
}

export interface ChapterAsk {
  readonly asked: boolean;
  readonly verdict: AskVerdict;
  /** The ask text, or null when no ask is due. */
  readonly ask: string | null;
  readonly chapter: number;
}

export interface ChapterAppend {
  readonly episodeId: string | null;
  readonly chapter: number;
  readonly created: boolean;
  /** True when this append OPENED the chapter (and wrote its heading). A second
   *  append inside one chapter continues it — the live-append case (§13 G2). */
  readonly heading: boolean;
  readonly reason: "appended" | "observer" | "anonymous-session" | "gate-refused";
}

/** Why a page write did not land. Every one of them is named to the caller. */
export type PageRefusal = "empty" | "too-large" | "gate-refused";

export interface PageRevision {
  readonly written: boolean;
  /** `created` / `revised` when it landed; the refusal's own name when it did
   *  not, with `observer` for a stood-down instrument. */
  readonly reason: "created" | "revised" | PageRefusal | "observer";
  readonly id: string | null;
  /** The version this write produced — 0 for a page written for the first time. */
  readonly version: number | null;
  readonly bytes: number;
  /** Which gate refused, when one did. Null on every other outcome. */
  readonly gate: { readonly gate: string; readonly reason: string } | null;
  /** Accepted, and larger than the wake will show: the page is kept whole and
   *  the wake renders a cut of it. Not a refusal — a warning the caller prints. */
  readonly warning: "over-wake-cap" | null;
}

/** Whole days between two `YYYY-MM-DD` dates, or null when either is unreadable. */
function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

const EVENT_RING = 500;

export class Self {
  readonly store: Store;
  readonly tunables: SelfTunables;
  /** One predicate, one definition: the store's. Never re-derived here. */
  readonly observer: boolean;

  private readonly gate: EpisodeGate;
  private readonly onEvent: ((e: SelfEvent) => void) | undefined;
  private readonly now: () => number;
  private readonly ring: SelfEvent[] = [];
  /** Observer-only state that may never be deposited (observer-mode G3/G6). */
  private readonly volatileState = new Map<string, EpisodeState>();
  private readonly volatileCounts = new Map<string, number>();

  constructor(opts: SelfOptions) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables ?? {});
    this.observer = opts.store.observer;
    this.gate = opts.gate ?? NO_GATE;
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? (() => Date.now());
  }

  // ── the briefing ─────────────────────────────────────────────────────────

  /**
   * Compose without publishing. Pure with respect to durable state: it reads,
   * ranks and composes, and writes nothing. Exposed because "render and publish
   * are separate steps" is only a real property if the render is separately
   * callable — a private half is a promise, not a seam.
   */
  build(req: BoundaryRequest): BriefingResult {
    const all = scanActive(this.store, req.day);
    // `omit` (see the field): the owner's wake passes none and this is a no-op;
    // a composition bound for a model call outside this machine passes one.
    const scanned = req.omit === undefined ? all : all.filter((s) => !req.omit?.(s));
    const horizon: Ranked[] = (req.horizon ?? []).map((h) => this.horizonRank(h, req.day));
    const lanes: Lanes = rankLanes(scanned, horizon, this.tunables);
    const docs = new Map<string, ProseDoc>();
    // Provenance rides along from the SAME scan the docs came from: the render
    // dates a migrated element as an upper bound, and a second row read per
    // element to learn that would be a scan the boundary already paid for.
    const sources = new Map<string, string | null>();
    for (const s of scanned) {
      docs.set(s.id, s.doc);
      sources.set(s.id, s.source);
    }
    const resolve: Resolve = req.resolve ?? ((id) => this.resolveStatement(id, docs, sources));
    // THE DAY-0 LANE (NOTES §11). The lookup is guarded by the empty lane and by
    // nothing else: it reads prose, and a store with even one identity element
    // must not pay for it — nor render the line. On a store that has lived
    // boundaries this branch is unreachable, which is also why the change cannot
    // move a byte of the owner's wake.
    //
    // AND BY `omit` (2026-09-17 review). A composition that passes `omit` is by
    // definition not owner-facing, and the identity lane it sees is the
    // POST-OMIT one: a store whose identity band is entirely protected or
    // confidential would otherwise unlock this line and tell a model call — one
    // being asked to write in the first person AS this self — that no identity
    // has formed here. It would also render the core's NAME, which `omit` never
    // saw: the core is a `type: "schema"` row and `scanActive` lists
    // `type: "memory"`. Both by one clause: no day-0 line on a composition that
    // filters.
    const coreName =
      req.omit === undefined && lanes.identity.length === 0 ? identityCoreName(this.store) : null;
    // THE PAGE, cut here rather than in the renderer: the cap is a byte decision
    // that needs the caller's budget AND the page's own prose, and `briefing.ts`
    // composes rather than reads. Clamped to the budget so a page can never on
    // its own be larger than the whole wake; when page plus furniture still will
    // not fit, the floor publishes with `overBudget: true`, which is the
    // tripwire that already exists for an under-floor ceiling.
    //
    // It renders on an `omit` composition TOO — the fallback woken as the self
    // (spec §15 item 3) is the one composition that most needs to know who it is
    // writing as. `omit` stands aside protected and confidential MEMORIES; the
    // page's own `protected` flag is the prune's vocabulary, not a
    // confidentiality class, and the page is the self's own standing account of
    // itself.
    const page = this.pageBlock(req.budgetBytes, req.day);
    return render(
      lanes,
      {
        budgetBytes: req.budgetBytes,
        day: req.day,
        ...(coreName === null ? {} : { coreName }),
        ...(page === null ? {} : { page }),
      },
      resolve,
      this.tunables,
    );
  }

  // ── the self page ────────────────────────────────────────────────────────

  /**
   * THE PAGE, READ. Null when none has been written — never a fabricated one:
   * a store with nothing to say says so (contract §3, and the day-0 lane's own
   * reasoning). Pure: no write, no event.
   */
  page(): SelfPage | null {
    return readSelfPage(this.store);
  }

  /**
   * Has the page gone unrevised longer than the tunable allows? CALENDAR days,
   * against the store's own clock — the lived clock has run seven days across
   * fifteen calendar ones on the owner's store, so a lived window would report a
   * fortnight of silence as three days.
   */
  pageStale(page: SelfPage | null = this.page()): boolean {
    if (page === null) return false;
    const on = page.revisedOn.trim();
    if (on === "") return true;
    const days = daysBetween(on, this.store.today());
    return days === null ? false : days > this.tunables.PAGE_STALE_DAYS;
  }

  /** Every earlier state of the page, newest first. Empty when there is none. */
  pageVersions(): { seq: number; reason: string; day: number; body: string | null }[] {
    const id = findSelfPage(this.store);
    if (id === null) return [];
    return this.store
      .versions(id)
      .slice()
      .sort((a, b) => b.seq - a.seq)
      .map((v) => {
        let body: string | null = null;
        try {
          body = this.store.readVersion(id, v.seq).body;
        } catch {
          body = null;
        }
        return { seq: v.seq, reason: v.reason, day: v.version_day, body };
      });
  }

  /**
   * THE ONE SEAM that writes the page — the MCP tool, the owner's console and
   * (later) the nightly writer all arrive here, so there is one place the row
   * shape, the caps and the durable row are decided.
   *
   * Refusals are NAMED and DURABLE (owner ruling 2's corollary, 2026-09-18: a
   * cap reports what it refused where the owner will see it). There is no silent
   * no-op on this path: every call returns a reason and, unless the store itself
   * is refusing writes, leaves a row saying which it was.
   *
   * `by` is the caller's and is not claimable from the outside by anything but
   * the adapter that opened this seam — the MCP tool writes `session`, the
   * console writes `owner`, and `writer` is S2's.
   */
  revisePage(body: string, opts: { reason: string; by: SelfPageAuthor; day?: number }): PageRevision {
    const day = opts.day ?? this.store.livedDay();
    const draft = body.replace(/\r\n/g, "\n").trim();
    let bytes = byteLength(draft);
    const refuse = (
      reason: PageRefusal,
      detail: Record<string, string | number | boolean>,
      gate: { gate: string; reason: string } | null = null,
    ): PageRevision => {
      this.emit("self.page.refused", undefined, { reason, by: opts.by, ...detail });
      try {
        this.store.appendEvent({
          name: SELF_PAGE_REFUSED_EVENT,
          day,
          payload: { reason, by: opts.by, ...detail },
        });
      } catch {
        /* a refusal that cannot be recorded is still a refusal (§5 G7) */
      }
      return { written: false, reason, id: null, version: null, bytes, warning: null, gate };
    };

    if (this.observer) {
      // The stand-down comes FIRST and writes nothing at all, the durable row
      // included: an instrument that logged its own refusal would be changing
      // the store it is reading (observer-mode G3).
      this.emit("self.observer.standdown", undefined, { site: "revisePage" });
      return { written: false, reason: "observer", id: null, version: null, bytes, warning: null, gate: null };
    }
    if (draft.length === 0) return refuse("empty", { bytes: 0 });
    if (bytes > this.tunables.PAGE_MAX_BYTES) {
      // Refused, never cut: what gets cut at write time is the only copy.
      return refuse("too-large", { bytes, limit: this.tunables.PAGE_MAX_BYTES });
    }
    // THE BATTERY, on the page as on the journal (SEAMS H). The page is prose
    // that will be injected into every session from here on, so a credential
    // written into it would be the most durable place on the machine to leave
    // one. `NO_GATE`'s refusal is the behaviour of a door nobody wired a battery
    // into, and it is loud rather than open.
    const verdict = this.gate({ text: draft, handles: [], sessionId: `page:${opts.by}` });
    if (!verdict.ok) {
      return refuse(
        "gate-refused",
        { bytes, gate: verdict.gate, gateReason: verdict.reason },
        { gate: verdict.gate, reason: verdict.reason },
      );
    }
    // The GATE's text, never the draft: the battery may have redacted it.
    const text = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : draft;
    bytes = byteLength(text);

    const existing = findSelfPage(this.store);
    const meta: Record<string, unknown> = {
      role: SELF_PAGE_ROLE,
      [PAGE_META_BY]: opts.by,
      [PAGE_META_REASON]: opts.reason,
      [PAGE_META_REVISED_ON]: this.store.today(),
      [PAGE_META_REVISED_DAY]: day,
    };
    let id: string;
    let version: number;
    if (existing === null) {
      id = this.store.put({
        type: "schema",
        kind: "self",
        title: PAGE_TITLE,
        body: text,
        meta,
        learnedOn: this.store.today(),
        // PROTECTED AT BIRTH — the one flag that keeps the floor prune off it
        // (`physics#pruneVerdict` blocks on it by name). It is not a
        // confidentiality class and it buys no exemption anywhere else.
        physics: { protected: true },
      });
      version = 0;
    } else {
      id = existing;
      version = this.store.revise(id, { body: text, title: PAGE_TITLE, meta, reason: opts.reason });
      // A page written before this flag existed — or one whose row was minted by
      // hand — is put beyond the prune here rather than at some later repair.
      if (this.store.row(id)?.protected !== 1) this.store.updatePhysics(id, { protected: true });
    }
    const warning =
      bytes > this.tunables.PAGE_WAKE_BYTES
        ? (`over-wake-cap` as const)
        : null;
    this.store.appendEvent({
      name: SELF_PAGE_REVISED_EVENT,
      day,
      ref: id,
      payload: {
        by: opts.by,
        reason: opts.reason,
        bytes,
        version,
        created: existing === null,
        wakeCap: this.tunables.PAGE_WAKE_BYTES,
        ...(warning === null ? {} : { warning }),
      },
    });
    this.emit("self.page.revised", id, {
      by: opts.by,
      bytes,
      version,
      created: existing === null,
      ...(warning === null ? {} : { warning }),
    });
    return {
      written: true,
      reason: existing === null ? "created" : "revised",
      id,
      version,
      bytes,
      warning,
      gate: null,
    };
  }

  /** The page as the wake will print it, or null. Pure. */
  private pageBlock(budgetBytes: number, _day: number): PageBlock | null {
    const page = this.page();
    if (page === null) return null;
    const cap = Math.min(this.tunables.PAGE_WAKE_BYTES, Math.max(0, budgetBytes));
    const rendered = renderPage(page.body, cap);
    return {
      text: rendered.text,
      dateline: pageDateline(page.revisedOn, this.pageStale(page), this.tunables.PAGE_STALE_DAYS),
      truncated: rendered.truncated,
      wholeBytes: rendered.wholeBytes,
    };
  }

  /**
   * THE SCHEDULED RECONCILER (contract §5 G12). Every derived surface owes one,
   * and "a script the owner runs occasionally" is not one: v1's identity index
   * was seeded once and the routine that would have added newly-formed elements
   * was never called at a boundary, so elements formed after seed day were
   * invisible at cold start until a human remembered to run something.
   *
   * This is that call. It re-ranks from the live store, re-composes, and
   * republishes — so a briefing cannot be stale by more than one boundary, by
   * construction rather than by diligence.
   */
  boundary(req: BoundaryRequest): BoundaryResult {
    if (req.identityCore !== undefined) this.ensureIdentityCore(req.identityCore);
    const briefing = this.build(req);
    const schema = schemaBytes(this.store, req.day, this.tunables);
    const hash = hashText(briefing.text);

    for (const t of briefing.trimmed) {
      this.emit("self.briefing.trim", t.id, { lane: t.lane, strength: round(t.strength) });
    }
    this.emit("self.briefing.rendered", undefined, {
      day: req.day,
      bytes: briefing.bytes,
      budget: briefing.budgetBytes,
      elements: briefing.elements,
      identity: briefing.counts.identity,
      craft: briefing.counts.craft,
      threads: briefing.counts.threads,
      hints: briefing.counts.hints,
      horizon: briefing.counts.horizon,
      trimmed: briefing.trimmed.length,
      hash,
    });
    // A budget gets an event when APPROACHED and an event when crossed; a number
    // in a log is not a monitor (scar §2.4).
    if (briefing.pressure) {
      this.emit("self.briefing.pressure", undefined, {
        bytes: briefing.bytes,
        budget: briefing.budgetBytes,
      });
    }
    if (briefing.overBudget) {
      this.emit("self.briefing.overbudget", undefined, {
        bytes: briefing.bytes,
        budget: briefing.budgetBytes,
        floor: true,
      });
    }
    if (schema.quarantined > 0) {
      // The F8 quarantine, observable: a stood-aside row is counted, never
      // silently absent (scar §2.4).
      this.emit("self.schema.quarantined", undefined, {
        count: schema.quarantined,
        bytes: schema.quarantinedBytes,
      });
    }
    if (schema.pressure) {
      this.emit("self.schema.pressure", undefined, {
        bytes: schema.bytes,
        at: schema.pressureAt,
        elements: schema.elements,
      });
    }
    if (schema.tripped) {
      this.emit("self.schema.tripped", undefined, {
        bytes: schema.bytes,
        trip: schema.trip,
        elements: schema.elements,
      });
    }

    if (this.observer) {
      // An instrument composes and reports; it deposits nothing (scar E7).
      this.emit("self.observer.standdown", undefined, { site: "boundary:publish" });
      return { briefing, schema, published: false, reason: "observer", hash };
    }

    this.store.setMeta(BRIEFING_KEY, briefing.text);
    // The rotation's memory: the identity ids this bundle KEPT, stamped with
    // the day. Kept, not ranked — an element the budget trimmed did not render
    // and keeps its place at the front of the next rotation.
    if (briefing.kept.identity.length > 0) {
      this.store.setMetaMany(
        briefing.kept.identity.map((id) => [`${RENDERED_PREFIX}${id}`, String(req.day)] as const),
      );
    }
    this.emit("self.briefing.published", undefined, { bytes: briefing.bytes, hash });
    return { briefing, schema, published: true, reason: "published", hash };
  }

  /**
   * WAKE: read what the previous boundary published, and verify it. No model, no
   * network, no ranking, no write — and observers receive it unchanged (§1 G8).
   *
   * Failure is never silence and never a lie: a store that has published nothing
   * gets the honest bootstrap line, and a store whose bundle is present but
   * damaged gets the bundle it has, flagged, because printing "initializing" over
   * a full store is the identity-amnesia failure this guarantee exists for.
   *
   * **The one cost, named:** a caller asking for a delivery preface also buys two
   * meta reads and one `COUNT(*)` — the store's size is a delivery-time fact and
   * a bundle rendered yesterday cannot state it. Still no ranking, no prose read,
   * no model and no write; the cost is a single aggregate, not O(store) prose,
   * and a caller that passes nothing pays exactly the old one meta row
   * (INTERFACE-GAPS #2).
   */
  wake(delivery?: WakeDelivery): WakeResult {
    const raw = this.store.getMeta(BRIEFING_KEY);
    if (raw === undefined) {
      this.emit("self.wake", undefined, { ok: false, reason: "absent", bytes: 0 });
      return {
        text: BOOTSTRAP,
        ok: false,
        reason: "absent",
        bytes: byteLength(BOOTSTRAP),
        sentinel: null,
        reading: null,
        preface: null,
      };
    }
    if (raw.length === 0) {
      // An empty read is an ERROR, never a silently-valid state (§1 G5).
      this.emit("self.wake", undefined, { ok: false, reason: "empty-read", bytes: 0 });
      return {
        text: BOOTSTRAP,
        ok: false,
        reason: "empty-read",
        bytes: 0,
        sentinel: null,
        reading: null,
        preface: null,
      };
    }
    const reading = readSentinel(raw);
    const reason: WakeReason = !reading.present
      ? "sentinel-missing"
      : reading.intact
        ? "delivered"
        : "sentinel-mismatch";
    // THE DELIVERY PREFACE, composed here and never at the boundary: which
    // system this is, which lived day, today's date, how big the store is now.
    // A damaged bundle is delivered exactly as found — `applyPreface` refuses to
    // rewrite a byte count that is already telling the truth about damage.
    const preface =
      delivery === undefined || reason !== "delivered"
        ? null
        : prefaceLine({
            system: WAKE_SYSTEM,
            day: this.store.livedDay(),
            ...(delivery.date === undefined ? {} : { date: delivery.date }),
            memories: this.store.countMemories({ type: "memory", archived: false }),
            // THE SECOND NUMBER, and it is recall's own denominator (U4): the
            // same filter minus the type clause, so "live rows" here and
            // `storeSize` there cannot mean two things.
            liveRows: this.store.countMemories({ archived: false }),
          });
    const delivered = preface === null ? null : applyPreface(raw, preface);
    this.emit("self.wake", undefined, {
      ok: reason === "delivered",
      reason,
      bytes: delivered?.bytes ?? reading.actualBytes,
      stated: reading.statedBytes,
      elements: reading.statedElements,
      preface: delivered?.applied ?? false,
    });
    return {
      text: delivered?.text ?? raw,
      ok: reason === "delivered",
      reason,
      bytes: delivered?.bytes ?? reading.actualBytes,
      sentinel: delivered?.sentinel ?? reading.line,
      reading,
      preface: delivered?.applied === true ? preface : null,
    };
  }

  /**
   * The DELIVERY-side event, distinct from the render-side one (scar §2.3: "we
   * rendered it" is not "they received it"). v1 shipped eleven days of truncated
   * wakes because only the render was instrumented.
   *
   * The host calls this with what it saw where the wake's last line should be:
   * the expectation when that is what stood there, `null` when nothing did, and
   * some other string when something else did. The adapter that reads a
   * transcript passes `""` for that third case on purpose — the text around a
   * sentinel found inside a bundle is the owner's memories, and this seam needs
   * the verdict, not the line.
   */
  noteDelivered(sentinelSeen: string | null, expected: string | null): boolean {
    const ok = expected !== null && sentinelSeen === expected;
    this.emit("self.wake.delivered", undefined, {
      ok,
      sawSentinel: sentinelSeen !== null,
      expected: expected !== null,
    });
    return ok;
  }

  // ── identity, enumerated ─────────────────────────────────────────────────

  /**
   * The identity band and the protected set, side by side (constitution 16, scar
   * §2.19: everything permanent is enumerable on demand — a list, not a cadence).
   * Reads are pure: this writes nothing and logs nothing (§14.1 G8).
   */
  enumerate(day?: number): Enumeration {
    return enumerate(this.store, day ?? this.store.livedDay());
  }

  /**
   * Mint the identity core's home row, once, in the shape `schemas/` indexes:
   * `type: "schema"`, `kind: "self"`, `meta: { role: "entity", name, aliases }`
   * (schemas/INTERFACE-GAPS #5). Idempotent — a second call returns the existing
   * row and mints nothing, because a second identity core is a category error no
   * evidence could justify.
   *
   * The NAME is the caller's: this module will not invent one, and there is no
   * default. `boundary({ identityCore })` is the door that reaches this, so it is
   * not a method waiting for someone to remember it (scar §2.17).
   */
  ensureIdentityCore(spec: IdentityCoreSpec): { id: string | null; created: boolean; reason: "created" | "exists" | "observer" | "no-name" } {
    const existing = findIdentityCore(this.store);
    if (existing !== null) return { id: existing, created: false, reason: "exists" };
    if (spec.name.trim().length === 0) {
      this.emit("self.core.skipped", undefined, { reason: "no-name" });
      return { id: null, created: false, reason: "no-name" };
    }
    if (this.observer) {
      this.emit("self.observer.standdown", undefined, { site: "ensureIdentityCore" });
      return { id: null, created: false, reason: "observer" };
    }
    // Empty except its names: birth creates a PLACE for memories to attach,
    // never a claim about what is true of the thing.
    const id = this.store.put({
      type: "schema",
      kind: "self",
      title: spec.name,
      body: spec.name,
      meta: {
        role: IDENTITY_CORE_ROLE,
        name: spec.name,
        aliases: [...(spec.aliases ?? [])],
      },
    });
    this.emit("self.core.minted", id, { aliases: (spec.aliases ?? []).length });
    return { id, created: true, reason: "created" };
  }

  /** The standing self-schema counter (contract §5 G4). Pure; `boundary()` emits. */
  schemaBytes(day?: number): SchemaBytesReport {
    return schemaBytes(this.store, day ?? this.store.livedDay(), this.tunables);
  }

  // ── freeze, but keep counting ────────────────────────────────────────────

  /**
   * One walk, one event, one withheld movement.
   *
   * Everything before the single `if` is identical in both arms — resolution,
   * kind lookup, the strength reading, the counter, the event — because a frozen
   * rate measured on a different denominator would not be comparable to the live
   * one, and comparability is the whole reason the freeze keeps counting.
   */
  noteSelfConfirmation(occasion: ClaimOccasion): ClaimOutcome {
    const day = occasion.day ?? this.store.livedDay();
    const tier: UseTier = occasion.tier ?? "referenced";

    // G8: the freeze is decided on the RESOLVED element, so a confirmation
    // addressed to a superseded id still freezes.
    let resolvedId: string;
    try {
      resolvedId = this.store.resolve(occasion.elementId);
    } catch {
      this.emit("self.claim.unresolved", occasion.elementId, {
        source: occasion.source,
        direction: occasion.direction,
      });
      return {
        frozen: false,
        reason: "unresolved",
        resolvedId: null,
        kind: null,
        band: null,
        reinforced: false,
        credit: null,
        strengthBefore: null,
        strengthAfter: null,
        count: 0,
      };
    }

    const before = this.store.physicsOf(resolvedId);
    const row = this.store.row(resolvedId);
    const band: Band = row?.band ?? "episodic";
    const kind = before.kind;
    const verdict: FreezeVerdict = decide(kind, occasion.source, occasion.direction);
    const strengthBefore = strength(before, day);

    // Softening is untouched on every kind (§14.2 G3, contract §5 G6) — and it
    // is not reinforcement, so it never moves through here: the verdict says
    // `live-softening` and the revision path (physics' pressure accumulator) is
    // the caller's next stop, unimpeded. Freezing both directions would make the
    // identity model unrevisable in both.
    const wouldMove = occasion.direction === "confirm";
    const credit =
      !verdict.frozen && wouldMove && !this.observer
        ? this.store.reinforce(resolvedId, day, tier)
        : null;

    const after = this.store.physicsOf(resolvedId);
    const count = this.bumpCount(kind, verdict.frozen);

    // The SAME event, from both arms, with a frozen marker: the event IS the
    // measurement; the movement is what is withheld (§14.2 G4, scar §2.4).
    this.emit("self.claim.repeat", resolvedId, {
      frozen: verdict.frozen,
      reason: this.observer ? "observer" : verdict.reason,
      kind,
      band,
      source: occasion.source,
      direction: occasion.direction,
      tier,
      day,
      addressed: occasion.elementId === resolvedId ? "direct" : "forwarded",
      reinforced: credit?.credited === true,
      count,
    });
    if (this.observer) {
      this.emit("self.observer.standdown", resolvedId, { site: "noteSelfConfirmation" });
    }

    return {
      frozen: verdict.frozen,
      reason: this.observer ? "observer" : verdict.reason,
      resolvedId,
      kind,
      band,
      reinforced: credit?.credited === true,
      credit,
      strengthBefore,
      strengthAfter: strength(after, day),
      count,
    };
  }

  /** Every claim counter, frozen and live, by kind. A read: writes nothing. */
  claimCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const kind of ["self", "skill", "person", "entity", "place", "fact"] as const) {
      for (const frozen of [true, false]) {
        const key = counterKey(kind, frozen);
        const value = this.observer
          ? (this.volatileCounts.get(key) ?? 0)
          : Number(this.store.getMeta(key) ?? "0");
        if (value > 0) out[key] = value;
      }
    }
    return out;
  }

  // ── episodes ─────────────────────────────────────────────────────────────

  episodeState(sessionId: string, day?: number): EpisodeState {
    const d = day ?? this.store.livedDay();
    if (this.observer) {
      return this.volatileState.get(sessionId) ?? freshEpisodeState(sessionId, d);
    }
    return loadEpisodeState(this.store, sessionId, d).state;
  }

  /** Pure: is a chapter due? No state advances, nothing is written. */
  askDue(sessionId: string, substance: Substance, day?: number): AskVerdict {
    const d = day ?? this.store.livedDay();
    return askDue(this.episodeState(sessionId, d), substance, this.tunables, {
      observer: this.observer,
      today: this.store.today(),
    });
  }

  /**
   * Ask for a chapter — ONE ask, and **the advance is committed before the ask
   * blocks** (§13 G3–G4), so a crash cannot re-ask in a loop. The state write
   * happens here, before the caller ever hands the text to a model.
   */
  openChapter(sessionId: string, substance: Substance, day?: number): ChapterAsk {
    const d = day ?? this.store.livedDay();
    // The CALENDAR day the allowance is charged to, read once so the verdict and
    // the advance cannot straddle midnight (`episodes.ts#asksSpentOn` carries
    // why it is the calendar date and not the lived one).
    const today = this.store.today();
    const state = this.episodeState(sessionId, d);
    const verdict = askDue(state, substance, this.tunables, {
      observer: this.observer,
      today,
    });
    if (!verdict.due) {
      this.emit("self.episode.ask.skipped", sessionId, {
        reason: verdict.reason,
        chapter: verdict.chapter,
        sinceTurns: verdict.sinceTurns,
        sinceBytes: verdict.sinceBytes,
      });
      return { asked: false, verdict, ask: null, chapter: verdict.chapter };
    }
    // The ask count advances; the CHAPTER count does not. What the model wrote
    // is the only thing that may claim to be a chapter (2026-09-04: the hook's
    // count ran to 7 while the episode held none).
    const advanced: EpisodeState = {
      ...state,
      asks: state.asks + 1,
      asksToday: asksSpentOn(state, today) + 1,
      asksDay: today,
      askedAtTurns: substance.turns,
      askedAtBytes: substance.bytes,
      lastDay: d,
    };
    this.persistState(advanced, "openChapter");
    this.emit("self.episode.ask", sessionId, {
      chapter: verdict.chapter,
      reason: verdict.reason,
      turns: substance.turns,
      bytes: substance.bytes,
      // Asks THIS SESSION has raised in its whole life, and the ones it has
      // spent TODAY — the second is the one `MAX_ASKS_PER_SESSION` refuses on,
      // so the distance to the cap is readable in the ring. How many asks a
      // calendar DATE held ACROSS sessions is a question the durable
      // `adapter.ask` rows answer, each stamped with its date and outcome; no
      // second counter is kept for it.
      asks: advanced.asks,
      asksToday: advanced.asksToday,
      asksDay: today,
    });
    return { asked: true, verdict, ask: askText(verdict.chapter), chapter: verdict.chapter };
  }

  /**
   * Append a chapter in the moment. The episode is created on the first one and
   * revised thereafter — `store.revise` archives the prior version first, so the
   * open journal keeps every state it passed through.
   */
  appendChapter(
    sessionId: string,
    text: string,
    opts: { day?: number; title?: string; happenedOn?: string } = {},
  ): ChapterAppend {
    const d = opts.day ?? this.store.livedDay();
    if (sessionId.trim().length === 0) {
      // Identity-safe join (§13 G7): every anonymous session collapses to the
      // same marker, so one session's account would pool into another's.
      this.emit("self.episode.skipped", undefined, { reason: "anonymous-session" });
      return { episodeId: null, chapter: 0, created: false, heading: false, reason: "anonymous-session" };
    }
    if (this.observer) {
      this.emit("self.observer.standdown", sessionId, { site: "appendChapter" });
      return { episodeId: null, chapter: 0, created: false, heading: false, reason: "observer" };
    }
    // Every ingestion entrance runs the battery — a chapter is canonical prose,
    // and a credential in one landed durably before this gate existed (found by
    // the composition root's caller-universality test, fixed the same day). The
    // gate's text — possibly redacted — is what gets written, never the draft.
    const verdict = this.gate({ text, handles: [], sessionId });
    if (!verdict.ok) {
      this.emit("self.episode.chapter.refused", sessionId, {
        gate: verdict.gate,
        reason: verdict.reason,
      });
      return { episodeId: null, chapter: 0, created: false, heading: false, reason: "gate-refused" };
    }
    const gatedText = verdict.text ?? text;
    const state = this.episodeState(sessionId, d);
    const append: Parameters<typeof appendChapter>[3] = { day: d };
    if (opts.title !== undefined) append.title = opts.title;
    if (opts.happenedOn !== undefined) append.happenedOn = opts.happenedOn;
    const written = appendChapter(this.store, state, gatedText, append);
    this.persistState(
      {
        ...state,
        episodeId: written.episodeId,
        chapters: Math.max(state.chapters, written.chapter),
        // This append ANSWERS the open ask: the next one continues this chapter
        // rather than opening another (§13 G2's headline case).
        appendedAtAsk: state.asks,
        lastDay: d,
      },
      "appendChapter",
    );
    this.emit("self.episode.chapter", written.episodeId, {
      session: sessionId,
      chapter: written.chapter,
      created: written.created,
      bytes: byteLength(gatedText),
    });
    return { ...written, reason: "appended" };
  }

  /**
   * Ingest the session's episode as an ordinary self-kind memory — context and
   * source, in that order, ingested ONCE. Idempotent by identity against active
   * and archived memories; add-first on regrowth; the window closes.
   */
  ingestEpisode(
    input: EpisodeProposal | { sessionId: string; day?: number; handles?: readonly string[] },
  ): IngestResult {
    const intake = intakeEpisode({ content: "-", ...input });
    const none = (
      reason: IngestResult["reason"],
      intakeReason: EpisodeIntakeReason | null = null,
    ): IngestResult => ({
      ingested: false,
      reason,
      memoryId: null,
      episodeId: null,
      key: null,
      archived: [],
      gate: null,
      intake: intakeReason,
    });
    if (!intake.ok) {
      // The intake's own reason is carried through: an anonymous session and a
      // malformed handle list are different refusals and must read differently.
      const reason = intake.reason === "SESSION_MISSING" ? "anonymous-session" : "malformed-input";
      this.emit("self.episode.skipped", undefined, { reason, intake: intake.reason });
      return none(reason, intake.reason);
    }
    const sessionId = input.sessionId;
    const d = input.day ?? this.store.livedDay();
    if (this.observer) {
      this.emit("self.observer.standdown", sessionId, { site: "ingestEpisode" });
      return none("observer");
    }

    const state = this.episodeState(sessionId, d);
    if (state.episodeId === null) {
      this.emit("self.episode.ingest.skipped", sessionId, { reason: "no-episode" });
      return none("no-episode");
    }
    const doc = this.store.readProse(state.episodeId);
    const key = ingestKey(state.episodeId, doc.body);
    const existing = findIngested(this.store, key);
    if (existing !== null) {
      // Idempotent against active AND archived, so consolidation's archival
      // decisions are not resurrected by a stray touch (§5 G10).
      this.emit("self.episode.ingest.skipped", state.episodeId, {
        reason: "already-ingested",
        memory: existing.id,
      });
      return {
        ingested: false,
        reason: "already-ingested",
        memoryId: existing.id,
        episodeId: state.episodeId,
        key,
        archived: [],
        gate: null,
        intake: null,
      };
    }
    const regrow = state.firstIngestDay !== null;
    if (regrow && d - (state.firstIngestDay ?? d) > this.tunables.REGROW_WINDOW_DAYS) {
      // The window CLOSES — the deliberate deviation from human
      // reconsolidation, which reopens on every retrieval (§13 G12).
      this.emit("self.episode.ingest.skipped", state.episodeId, {
        reason: "window-closed",
        openedOn: state.firstIngestDay,
        day: d,
        window: this.tunables.REGROW_WINDOW_DAYS,
      });
      return {
        ingested: false,
        reason: "window-closed",
        memoryId: state.ingestedMemoryId,
        episodeId: state.episodeId,
        key,
        archived: [],
        gate: null,
        intake: null,
      };
    }

    const handles = [...(input.handles ?? [])];
    const verdict = this.gate({ text: doc.body, handles, sessionId });
    if (!verdict.ok) {
      // A first-person reflection is not exempt from never durably encoding a
      // credential (§13 G8, scar §2.7).
      this.emit("self.episode.ingest.refused", state.episodeId, {
        gate: verdict.gate,
        reason: verdict.reason,
      });
      return {
        ingested: false,
        reason: "gate-refused",
        memoryId: null,
        episodeId: state.episodeId,
        key,
        archived: [],
        gate: { gate: verdict.gate, reason: verdict.reason },
        intake: null,
      };
    }

    // ADD FIRST, then archive the stale one: a failed add can never leave an
    // episode with no live memory (§13 G11).
    const proposal = input as EpisodeProposal;
    // The GATE's text, never the draft, is what becomes the memory: an episode
    // is an ordinary ingestion and the battery may have redacted it (SEAMS H).
    const body = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : doc.body;
    const put: Parameters<Store["put"]>[0] = {
      type: "memory",
      kind: "self",
      body,
      meta: { episodeId: state.episodeId, episodeKey: key, sessionId, handles },
      // The experiencer's own episode is lived testimony — the "episode"
      // channel, recorded as provenance like every other mint (F9-light).
      source: "episode",
      origin: { session: sessionId, ref: state.episodeId },
    };
    if (proposal.title !== undefined) put.title = proposal.title;
    if (proposal.happenedOn !== undefined) put.happenedOn = proposal.happenedOn;
    else if (doc.happenedOn !== undefined) put.happenedOn = doc.happenedOn;
    if (proposal.salience !== undefined || proposal.claimed !== undefined) {
      put.salience = { ...(proposal.salience ?? {}), claimed: proposal.claimed ?? null };
    }
    const memoryId = this.store.put(put);

    const archived: string[] = [];
    for (const stale of memoriesForEpisode(this.store, state.episodeId)) {
      if (stale === memoryId) continue;
      this.store.archive(stale, "episode-regrown");
      archived.push(stale);
    }

    this.persistState(
      {
        ...state,
        ingestedKey: key,
        ingestedMemoryId: memoryId,
        firstIngestDay: state.firstIngestDay ?? d,
        lastDay: d,
      },
      "ingestEpisode",
    );
    this.emit("self.episode.ingested", state.episodeId, {
      memory: memoryId,
      regrown: regrow,
      archived: archived.length,
      handles: handles.length,
      bytes: byteLength(doc.body),
    });
    return {
      ingested: true,
      reason: regrow ? "regrown" : "ingested",
      memoryId,
      episodeId: state.episodeId,
      key,
      archived,
      gate: null,
      intake: null,
    };
  }

  /**
   * THE DOOR THAT REACHES INGESTION (contract §3: "every identity surface owes
   * an answer to *which door reaches this?*", §5 G12: every derived surface owes
   * a SCHEDULED reconciler, asserted to run at a boundary).
   *
   * Measured 2026-09-04: `ingestEpisode` had no caller outside this module and
   * its own tests. An episode that nobody ingests is a file, not a memory — the
   * "context and source, in that order" half of §13 G6 was unreachable in
   * production for the whole run. This is that scheduled pass: every live
   * episode whose CURRENT text has not been ingested is ingested here, at the
   * boundary, before the cycle that decays and re-renders around it.
   *
   * Cheap by construction: the skip is a state read plus a hash, so an episode
   * already ingested at its current text costs no scan of the memory table.
   */
  reconcileEpisodes(day?: number): {
    considered: number;
    ingested: number;
    regrown: number;
    skipped: number;
  } {
    const d = day ?? this.store.livedDay();
    let considered = 0;
    let ingested = 0;
    let regrown = 0;
    let skipped = 0;
    for (const id of this.store.list({ type: "episode", archived: false })) {
      let doc: ProseDoc;
      try {
        doc = this.store.readProse(id);
      } catch {
        continue;
      }
      const sessionId = doc.meta["sessionId"];
      // The identity-safe join again: an episode with no session is skipped
      // outright rather than pooled into anyone's day (§13 G7).
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) continue;
      considered += 1;
      const state = this.episodeState(sessionId, d);
      if (state.ingestedKey === ingestKey(id, doc.body)) {
        skipped += 1;
        continue;
      }
      const out = this.ingestEpisode({ sessionId, day: d });
      if (out.reason === "ingested") ingested += 1;
      else if (out.reason === "regrown") regrown += 1;
      else skipped += 1;
    }
    this.emit("self.episode.reconciled", undefined, {
      considered,
      ingested,
      regrown,
      skipped,
      day: d,
    });
    return { considered, ingested, regrown, skipped };
  }

  /**
   * The orphanable tail: substance accumulated after the last ask, which no ask
   * can cover because only a blocked stop hands the model a pen and nobody knows
   * which stop is last. It is bounded by the re-ask thresholds and LOGGED, so the
   * miss is measurable before anyone debates a reconstruction fallback — the
   * right shape for an unfixable gap: bound it, measure it, don't pretend.
   */
  noteOrphanTail(sessionId: string, substance: Substance, day?: number): AskVerdict {
    // The SAME verdict the ask would get, from the session's own state: the tail
    // telemetry and the ask must never disagree about why nothing was asked.
    const verdict = this.askDue(sessionId, substance, day);
    this.emit("self.episode.tail", sessionId, {
      sinceTurns: verdict.sinceTurns,
      sinceBytes: verdict.sinceBytes,
      boundTurns: this.tunables.REASK_TURNS,
      boundBytes: this.tunables.REASK_BYTES,
      chapters: this.episodeState(sessionId, day).chapters,
    });
    return verdict;
  }

  events(name?: string): SelfEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private horizonRank(item: HorizonItem, day: number): Ranked {
    let kind: Kind = "fact";
    let bornDay = day;
    let s = 0;
    try {
      const physics = this.store.physicsOf(item.id);
      kind = physics.kind;
      bornDay = physics.birthDay;
      s = strength(physics, day);
    } catch {
      /* an occasion whose memory has gone is still an occasion; it renders by id */
    }
    return {
      id: item.id,
      lane: "horizon",
      kind,
      band: "episodic",
      strength: s,
      protected: false,
      bornDay,
      personScoped: false,
      lastRendered: -1,
    };
  }

  /**
   * Id → statement AND its dates, at render time only. A missing doc renders as
   * its own id, undated: there is nothing left to date it by, and inventing
   * today's date for a memory whose prose has gone is the exact lie the dates
   * exist to prevent. The dates come from the SAME read as the text, so an
   * element's age can never be one boundary older than its words.
   */
  private resolveStatement(
    id: string,
    docs: Map<string, ProseDoc>,
    sources: Map<string, string | null>,
  ): Resolved {
    let doc = docs.get(id);
    if (doc === undefined) {
      try {
        doc = this.store.readProse(id);
      } catch {
        return { statement: id };
      }
    }
    // The horizon lane's ids never went through `scanActive`, so their
    // provenance is read here — the one row read the scan did not already make.
    const source = sources.has(id) ? sources.get(id) ?? null : this.store.row(id)?.source ?? null;
    const paragraph = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? doc.body;
    const statement = flatten(paragraph);
    const out: {
      statement: string;
      learnedOn?: string;
      happenedOn?: string;
      boundedDate?: boolean;
    } = { statement: statement.length > 0 ? statement : id };
    // Blank is how a chased row reads (`owner-op-seam`), and blank is not a date.
    if (doc.learnedOn.trim() !== "") out.learnedOn = doc.learnedOn;
    if (doc.happenedOn !== undefined && doc.happenedOn.trim() !== "") {
      out.happenedOn = doc.happenedOn;
    }
    // A MIGRATED element's encode date is an upper bound, not a claim: the
    // importer wrote the import date wherever v1 carried none, and the row does
    // not say which it did (measured live 2026-09-05 — all eleven elements read
    // the import day, a July incident among them).
    //
    // UNLESS THE ROW NOW SAYS WHICH. `counterparts repair-dates --apply` writes
    // `meta.dateRepaired` when it re-dates a migrated row from the row's own
    // evidence, and a date recovered at HIGH confidence — the v1 document's own
    // `created` field, or an engram-era id that is a millisecond timestamp — is a
    // claim again, not a bound. Only `high`: `medium` and `low` came from the
    // session, the element's statement or the source path, which are all still
    // "no later than", and hedging them is the honest render.
    if (source === "migrated" && !repairedAtHighConfidence(doc)) out.boundedDate = true;
    return out;
  }

  /**
   * The counter. One row per (kind, arm), so the frozen rate and the live rate
   * share a denominator. It is telemetry, not physics: it moves on every
   * occasion, frozen or live, and moving it is not moving the memory.
   */
  private bumpCount(kind: Kind, frozen: boolean): number {
    const key = counterKey(kind, frozen);
    if (this.observer) {
      const next = (this.volatileCounts.get(key) ?? 0) + 1;
      this.volatileCounts.set(key, next);
      return next;
    }
    const next = Number(this.store.getMeta(key) ?? "0") + 1;
    this.store.setMeta(key, String(next));
    return next;
  }

  private persistState(state: EpisodeState, site: string): void {
    if (this.observer) {
      this.volatileState.set(state.sessionId, state);
      this.emit("self.observer.standdown", state.sessionId, { site: `persist:${site}` });
      return;
    }
    this.store.setMeta(stateKey(state.sessionId), JSON.stringify(state));
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const e: SelfEvent = { at: this.now(), name };
    if (ref !== undefined) e.ref = ref;
    if (data !== undefined) e.data = data;
    this.ring.push(e);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(e);
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Did `counterparts repair-dates` recover this row's date from the row's OWN
 * strongest evidence?
 *
 * The marker is prose meta, written by the repair beside the corrected date
 * (`adapters/cli/repair-dates.ts`, `DATE_REPAIRED_META`), so the document stays
 * self-describing: the claim and the reason to believe it travel together and
 * survive a copy of the store. Read STRUCTURALLY rather than by importing the
 * adapter's constant — `self/` may not import an adapter — and a shape check that
 * fails renders the bound, which is the safe direction.
 */
function repairedAtHighConfidence(doc: ProseDoc): boolean {
  const marker = doc.meta["dateRepaired"];
  if (typeof marker !== "object" || marker === null || Array.isArray(marker)) return false;
  return (marker as Record<string, unknown>)["confidence"] === "high";
}

export type {
  AskVerdict,
  Band,
  BriefingRequest,
  BriefingResult,
  ClaimDirection,
  ClaimSource,
  Enumeration,
  EpisodeGate,
  EpisodeProposal,
  EpisodeState,
  FreezeReason,
  IngestResult,
  Kind,
  LaneName,
  Lanes,
  Ranked,
  Resolve,
  Resolved,
  SchemaBytesReport,
  SentinelReading,
  Substance,
  UseTier,
};
export { BRIEFING_TRIM_LOG_CAP, COUNTER_PREFIX, FRAMING, FROZEN_KINDS, LANE_ORDER, TRIM_ORDER };
