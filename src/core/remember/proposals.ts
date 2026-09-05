/**
 * Proposal intake — the authorship contract's front door.
 *
 * Two deposits, one shape: the experiencer's end-of-session dump and its
 * in-the-moment jots both arrive as a `ProposalDraft` and leave as a `Proposal`
 * MINTED BY THE ENGINE (§3, §4.1 G2 — routing an author's own words through an
 * interpreter would return them as someone else's paraphrase).
 *
 * The four mechanized properties that live here:
 *
 *   G5  the ENGINE claims coverage, never the author — the author cannot see the
 *       buffer, so `covers` is filled in on this side of the seam;
 *   G6  a rejected proposal claims NO coverage — its spans stay in the sweep's input;
 *   G7  coverage marks never enter gated text — the mark rides in a separate field
 *       and `renderForSweep()` is the only thing that ever joins the two;
 *   G9 (§4.1) deliberate deposits are idempotent by CONTENT, not by span text.
 *
 * Privilege caps are structural (§4.1 G7): a `Proposal` has no operation fields to
 * carry. `protect`, `promote`, `schema.create` and friends are not "rejected" — the
 * minting function has nowhere to put them, and it counts what it dropped.
 */
import type { Kind, Salience } from "../types.js";
import { hashText } from "../store/prose.js";
import { randomBytes } from "node:crypto";

// TYPE-ONLY, and the only edge this module has to `encode/`. The gate itself
// stays INJECTED (INTERFACE-GAPS #2) — nothing here calls the battery. What
// crosses is the SHAPE of the battery's own per-gate records, so a verdict can
// relay them to a caller that writes telemetry instead of flattening them to a
// first reason and a gate name (replay INTERFACE-GAPS §2a). The import is erased
// at runtime, so the module graph is unchanged; restating the shape here instead
// would be a second copy that drifts, which is the failure the `satisfies`
// discipline in this repo exists to stop.
import type { ChannelRecord, GateRecord } from "../encode/index.js";

import type { CoverageMark, Span, SpanBuffer } from "./spans.js";
import type { UpdatesResolution } from "./updates.js";

// ── the shape the author writes ──────────────────────────────────────────────

export interface Feeling {
  /** The typed feeling. Absent means null — never "neutral" (encode §3). */
  feeling: string;
  /** A quote the span must contain; the gate strips it before anything is durable. */
  quote: string;
  /** Who felt it. The emotion exemption applies only when this is the author. */
  subject: string;
}

export interface ProposalDraft {
  content: string;
  kind?: Kind;
  title?: string;
  /** The author's claimed aggregate salience: a FLOOR, clamped in `physics/`. */
  claimed?: number | null;
  /** Optional per-dimension hints. Passed through untouched — scoring is encode's. */
  salience?: Partial<Salience>;
  feeling?: Feeling;
  aliases?: string[];
  /** The declared address of the memory this one revises. Validated, never trusted. */
  updates?: string;
  /** An open loop is an ordinary memory with a flag, not a special structure (§4). */
  unresolved?: boolean;
}

export type ProposalSource = "session-end" | "jot";

/** What the engine mints. Memory objects only — no operations, by construction. */
export interface Proposal {
  id: string;
  source: ProposalSource;
  session: string;
  scope: string;
  content: string;
  kind: Kind;
  title: string | null;
  salience: Partial<Salience> & { claimed: number | null };
  feeling: Feeling | null;
  aliases: string[];
  updates: UpdatesResolution | null;
  unresolved: boolean;
  at: number;
  day: number;
  /** Identity for idempotency: CONTENT, not span text (§4.1 G9). */
  contentHash: string;
  /** Span hashes this proposal covers. Engine-set, always (§5 G5). */
  covers: string[];
  /** The proposal's own span, withheld from the sweep outright. */
  ownSpanHash: string | null;
}

// ── intake ───────────────────────────────────────────────────────────────────

export type MalformedReason =
  | "NOT_AN_OBJECT"
  | "CONTENT_MISSING"
  | "CONTENT_EMPTY"
  | "CLAIMED_NOT_NUMERIC"
  | "CLAIMED_OUT_OF_RANGE"
  | "DIMENSION_OUT_OF_RANGE"
  | "KIND_UNKNOWN"
  | "TITLE_NOT_STRING"
  | "UPDATES_NOT_STRING"
  | "ALIASES_NOT_STRINGS"
  | "FEELING_MALFORMED";

const KIND_SET: Record<Kind, true> = {
  self: true,
  person: true,
  entity: true,
  skill: true,
  place: true,
  fact: true,
};

/** The three dimensions an author may claim. `novelty` is absent by design:
 *  prediction error is computed at encoding, never claimed (§2.9). */
export const AUTHOR_DIMENSIONS = ["relevance", "emotional", "predictive"] as const;

/** Fields a draft may carry. Anything else is dropped and counted — the privilege
 *  cap is "there is nowhere to put it", not a rule someone must remember. */
export const DRAFT_FIELDS = [
  "content",
  "kind",
  "title",
  "claimed",
  "salience",
  "feeling",
  "aliases",
  "updates",
  "unresolved",
] as const;

export type IntakeResult =
  | { ok: true; draft: Required<Pick<ProposalDraft, "content">> & ProposalDraft; dropped: string[] }
  | { ok: false; reason: MalformedReason; text: string | null; dropped: string[] };

/**
 * Validate a raw deposit. A malformed proposal is NOT an error — it degrades to an
 * ordinary span, read by the fallback (§3, §4.1 G8), so this returns the salvaged
 * text alongside the reason.
 */
export function intake(raw: unknown): IntakeResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "NOT_AN_OBJECT", text: typeof raw === "string" ? raw : null, dropped: [] };
  }
  const rec = raw as Record<string, unknown>;
  const dropped = Object.keys(rec).filter(
    (k) => !(DRAFT_FIELDS as readonly string[]).includes(k),
  );
  const text = typeof rec["content"] === "string" ? (rec["content"] as string) : null;
  const bad = (reason: MalformedReason): IntakeResult => ({ ok: false, reason, text, dropped });

  if (rec["content"] === undefined) return bad("CONTENT_MISSING");
  if (typeof rec["content"] !== "string") return bad("CONTENT_MISSING");
  if (rec["content"].trim().length === 0) return bad("CONTENT_EMPTY");

  if (rec["kind"] !== undefined) {
    if (typeof rec["kind"] !== "string" || !(rec["kind"] in KIND_SET)) return bad("KIND_UNKNOWN");
  }
  if (rec["title"] !== undefined && typeof rec["title"] !== "string") return bad("TITLE_NOT_STRING");
  if (rec["claimed"] !== undefined && rec["claimed"] !== null) {
    if (typeof rec["claimed"] !== "number" || !Number.isFinite(rec["claimed"])) {
      return bad("CLAIMED_NOT_NUMERIC");
    }
    if (rec["claimed"] < 0 || rec["claimed"] > 1) return bad("CLAIMED_OUT_OF_RANGE");
  }
  if (rec["updates"] !== undefined && typeof rec["updates"] !== "string") {
    return bad("UPDATES_NOT_STRING");
  }
  // The author's three dimensions are validated HERE, at the one front door,
  // rather than at each adapter: `sal()` clamps at read time, but `store.put`
  // writes whatever number arrives into the row, so an unvalidated 7 or a NaN
  // would sit in box 2 forever, honest-looking and wrong. `novelty` is not in
  // this list on purpose — it is stripped below, computed and never claimed.
  if (rec["salience"] !== undefined && rec["salience"] !== null) {
    const s = rec["salience"];
    if (typeof s !== "object" || Array.isArray(s)) return bad("DIMENSION_OUT_OF_RANGE");
    for (const dim of AUTHOR_DIMENSIONS) {
      const v = (s as Record<string, unknown>)[dim];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
        return bad("DIMENSION_OUT_OF_RANGE");
      }
    }
  }
  if (rec["aliases"] !== undefined) {
    const a = rec["aliases"];
    if (!Array.isArray(a) || a.some((x) => typeof x !== "string" || x.trim().length === 0)) {
      return bad("ALIASES_NOT_STRINGS");
    }
  }
  if (rec["feeling"] !== undefined) {
    const f = rec["feeling"];
    if (f === null || typeof f !== "object") return bad("FEELING_MALFORMED");
    const g = f as Record<string, unknown>;
    if (
      typeof g["feeling"] !== "string" ||
      typeof g["quote"] !== "string" ||
      typeof g["subject"] !== "string" ||
      g["feeling"].trim().length === 0
    ) {
      return bad("FEELING_MALFORMED");
    }
  }

  const draft: ProposalDraft = { content: rec["content"] as string };
  if (rec["kind"] !== undefined) draft.kind = rec["kind"] as Kind;
  if (typeof rec["title"] === "string") draft.title = rec["title"];
  if (rec["claimed"] !== undefined) draft.claimed = rec["claimed"] as number | null;
  if (rec["salience"] !== undefined && typeof rec["salience"] === "object" && rec["salience"] !== null) {
    draft.salience = rec["salience"] as Partial<Salience>;
  }
  if (rec["feeling"] !== undefined) draft.feeling = rec["feeling"] as Feeling;
  if (rec["aliases"] !== undefined) draft.aliases = rec["aliases"] as string[];
  if (typeof rec["updates"] === "string") draft.updates = rec["updates"];
  draft.unresolved = rec["unresolved"] === true;
  return { ok: true, draft: draft as Required<Pick<ProposalDraft, "content">> & ProposalDraft, dropped };
}

// ── the gate seam (INJECTED — see INTERFACE-GAPS.md #2) ──────────────────────

export interface GateInput {
  content: string;
  kind: Kind;
  aliases: readonly string[];
  feeling: Feeling | null;
  /** The author's title, when given. The bridge treats it as a handle (the ops
   *  rule: a secret in a name rejects the operation). SEAMS item 3. */
  title: string | null;
  /** The author's claimed AGGREGATE salience — carried, never re-judged here. */
  claimed: number | null;
  /** The author's claimed dimensions (novelty always absent: computed, never
   *  claimed). SEAMS item 3 — without these the physics floor is unreachable. */
  salience: Partial<Salience>;
  /** The proposal's OWN span, when it has one. The emotion exemption is evaluated
   *  against this span by the engine that minted the proposal (encode §5 G5). */
  span: { hash: string; text: string } | null;
  source: ProposalSource;
  day: number;
}

export type GateVerdict =
  | {
      ok: true;
      /** Possibly redacted / hedged. This — never the draft — becomes the memory. */
      content: string;
      aliases?: readonly string[];
      feeling?: Feeling | null;
      /**
       * The COMPUTED salience dimension, from the gate that computed it.
       *
       * The other three dimensions are the author's and arrive on the draft;
       * novelty is prediction error, which no author may claim (`encode/`'s §3).
       * It travels back on the verdict because the gate is the only place that
       * holds a vector — and without this field the number was computed, used
       * for the gate decision, and then DROPPED before mint, which is how the
       * store came to record `novelty: null` on every memory it holds.
       *
       * Optional and null-able, both on purpose: a gate with no vector source
       * omits it, and a gate that tried and could not measure sends `null` —
       * "never asked" and "asked, no answer" stay different records (scar §2.4).
       */
      novelty?: number | null;
      /**
       * THE BATTERY'S OWN PER-GATE RECORDS, relayed rather than summarized.
       *
       * On BOTH arms on purpose. Until this field existed a refusal crossed this
       * seam as `{gate, reason}` — one blocking reason and a joined name — and
       * everything the battery had actually measured (per-gate statuses, hedge
       * counts, alias verdicts, secret FAMILIES) died here. That is why the
       * authored door had no durable gate record to write at all, and why
       * `gate.refusalMix` could be computed over the sweep path only
       * (`tools/replay/INTERFACE-GAPS.md` §2a).
       *
       * `remember/` reads nothing out of them: they are carried to
       * `SubmitResult` and handed to whoever writes telemetry. OPTIONAL because
       * a gate that is not the battery — the `NO_GATE` default, a test double —
       * has none, and "no battery ran" must stay distinguishable from "a battery
       * ran and found nothing" (scar §2.4).
       */
      records?: readonly GateRecord[];
      /** The battery's channel records, same relay, same reason. */
      channels?: readonly ChannelRecord[];
    }
  | {
      ok: false;
      gate: string;
      reason: string;
      /** True when the refusal is the battery working as designed (a gate
       *  fired), false/absent when the gate itself failed. SEAMS item 3. */
      refusedByDesign?: boolean;
      /** The refusal arm's half of the relay above — the `records` field replay
       *  INTERFACE-GAPS §2a names as what would close it. */
      records?: readonly GateRecord[];
      channels?: readonly ChannelRecord[];
      /**
       * EVERY blocking reason, as a list. `reason` above is the same list joined
       * with `+` for a human line; a telemetry reader that has to split a string
       * back apart is a reader one delimiter away from a wrong count.
       */
      blockedBy?: readonly string[];
    };

export type GateFn = (input: GateInput) => GateVerdict | Promise<GateVerdict>;

/** The default when no gate is injected: refuse. `encode/` owns the battery, and a
 *  missing battery must not read as "everything passes" (fail toward not-authoring). */
export const NO_GATE: GateFn = () => ({ ok: false, gate: "none", reason: "NO_GATE_INJECTED" });

// ── submit ───────────────────────────────────────────────────────────────────

export type SubmitReason =
  | "ACCEPTED"
  | "OBSERVER"
  | "MALFORMED"
  | "DUPLICATE_CONTENT"
  | "GATE_REJECTED"
  | "GATE_FAILED"
  | "IO_FAILED";

export interface SubmitResult {
  accepted: boolean;
  reason: SubmitReason;
  proposal: Proposal | null;
  /** Empty whenever `accepted` is false — a rejected proposal claims no coverage. */
  coverage: CoverageMark[];
  gate: string | null;
  malformed: MalformedReason | null;
  degradedToSpan: boolean;
  droppedFields: string[];
  /**
   * The battery's per-gate records, when a battery ran.
   *
   * EMPTY IS A FACT, not a default. An observer stand-down, a malformed draft
   * and a content duplicate are all decided BEFORE the gate is called (NOTES
   * §7's rejection ordering), so those three outcomes genuinely have no gate
   * record — and the caller must not write a durable one claiming they do.
   */
  records: readonly GateRecord[];
  /** The battery's channel records, on the same terms. */
  channels: readonly ChannelRecord[];
  /**
   * The kind that was PROPOSED, which survives a refusal where `proposal` does
   * not. Null before intake has parsed one — a malformed draft has no kind, and
   * defaulting it to `fact` would put a made-up axis into telemetry.
   */
  kind: Kind | null;
  /** Every reason the gate blocked on, unjoined. Empty on every other outcome. */
  blockedBy: readonly string[];
}

export interface SubmitContext {
  session: string;
  scope: string;
  source: ProposalSource;
  gate?: GateFn;
  /** The span this deposit IS (a jot's own span), withheld from the sweep outright. */
  ownSpanHash?: string | null;
  /** Injected `updates:` resolver — see `updates.ts`. Absent means no resolution
   *  is attempted and the declaration rides unresolved. */
  resolveUpdates?: (declared: string, content: string) => Promise<UpdatesResolution> | UpdatesResolution;
}

/** A proposal record as persisted (the content-idempotency ledger). */
export interface ProposalRecord {
  id: string;
  contentHash: string;
  session: string;
  source: ProposalSource;
  at: number;
  day: number;
  covers: string[];
  accepted: boolean;
}

export async function submitProposal(
  buffer: SpanBuffer,
  raw: unknown,
  ctx: SubmitContext,
): Promise<SubmitResult> {
  const base: SubmitResult = {
    accepted: false,
    reason: "OBSERVER",
    proposal: null,
    coverage: [],
    gate: null,
    malformed: null,
    degradedToSpan: false,
    droppedFields: [],
    records: [],
    channels: [],
    kind: null,
    blockedBy: [],
  };

  if (buffer.observer) {
    buffer.emit("remember.observer.standdown", undefined, { site: "proposal" });
    return base;
  }

  const parsed = intake(raw);
  if (!parsed.ok) {
    // Degrade to an ordinary span rather than lose the material (§4.1 G8).
    let degraded = false;
    if (parsed.text !== null && parsed.text.trim().length > 0) {
      degraded = buffer.jot({ session: ctx.session, scope: ctx.scope, text: parsed.text }).captured;
    }
    buffer.emit("remember.proposal.malformed", undefined, {
      reason: parsed.reason,
      degraded,
      dropped: parsed.dropped.length,
    });
    return {
      ...base,
      reason: "MALFORMED",
      malformed: parsed.reason,
      degradedToSpan: degraded,
      droppedFields: parsed.dropped,
    };
  }

  const draft = parsed.draft;
  const contentHash = hashText(normalize(draft.content));
  const priors = buffer.proposalRecords<ProposalRecord>(ctx.scope);
  if (priors.some((p) => p.accepted && p.contentHash === contentHash)) {
    // Two identical deposits cover different spans, so their SPAN hashes differ and
    // span dedup would miss the repeat. Content is the identity (§4.1 G9).
    buffer.emit("remember.proposal.duplicate", contentHash, { session: ctx.session });
    return { ...base, reason: "DUPLICATE_CONTENT", droppedFields: parsed.dropped };
  }

  const kind: Kind = draft.kind ?? "fact";
  const own =
    ctx.ownSpanHash === undefined || ctx.ownSpanHash === null
      ? null
      : buffer.spans(ctx.scope).find((s) => s.hash === ctx.ownSpanHash) ?? null;

  const gate = ctx.gate ?? NO_GATE;
  let verdict: GateVerdict;
  try {
    verdict = await gate({
      content: draft.content,
      kind,
      aliases: draft.aliases ?? [],
      feeling: draft.feeling ?? null,
      title: draft.title ?? null,
      claimed: draft.claimed ?? null,
      salience: draft.salience ?? {},
      span: own === null ? null : { hash: own.hash, text: own.text },
      source: ctx.source,
      day: buffer.day(),
    });
  } catch (err) {
    buffer.emit("remember.proposal.gate.failed", undefined, { session: ctx.session });
    // `records` stays EMPTY here on purpose: the gate THREW, so it produced no
    // records, and a telemetry row claiming five clear gates would be a lie in
    // the one direction that matters (SEAMS item 3's failed-vs-refused split).
    return { ...base, reason: "GATE_FAILED", gate: "unknown", droppedFields: parsed.dropped, malformed: null, kind, blockedBy: [] };
  }

  if (!verdict.ok) {
    // Nothing was authored, so its spans stay in the sweep's input (§5 G6).
    buffer.emit("remember.proposal.rejected", contentHash, {
      gate: verdict.gate,
      reason: verdict.reason,
    });
    return {
      ...base,
      reason: "GATE_REJECTED",
      gate: verdict.gate,
      droppedFields: parsed.dropped,
      // The whole point of §2a: a refusal leaves with everything the battery
      // measured, not with the first reason it hit.
      records: verdict.records ?? [],
      channels: verdict.channels ?? [],
      kind,
      blockedBy: verdict.blockedBy ?? [],
    };
  }

  let updates: UpdatesResolution | null = null;
  if (draft.updates !== undefined && ctx.resolveUpdates !== undefined) {
    updates = await ctx.resolveUpdates(draft.updates, verdict.content);
  }

  // Novelty stripped from the author's dimensions BEFORE the gate's computed
  // value applies — see the salience comment below for why the strip must be
  // explicit rather than an override.
  const { novelty: _claimedNovelty, ...authoredDims } = draft.salience ?? {};

  const proposal: Proposal = {
    id: `prp_${randomBytes(6).toString("hex")}`,
    source: ctx.source,
    session: ctx.session,
    scope: ctx.scope,
    content: verdict.content,
    kind,
    title: draft.title ?? null,
    // The author's three dimensions, with novelty STRIPPED explicitly before
    // the gate's computed value is applied: novelty is prediction error at
    // encoding — computed, never claimed (§2.9) — and relying on the gate's
    // override alone let an author-supplied novelty survive whenever no vector
    // source was wired, which is the DEFAULT config (PR-3 review: a claimed
    // 0.99 reached the stored row and fed salience/banding — F5 through a new
    // door). Stripping first also preserves the omitted-vs-null distinction:
    // no vector source means novelty null ("never asked"), never the claim.
    salience: {
      ...authoredDims,
      ...(verdict.novelty === undefined ? {} : { novelty: verdict.novelty }),
      claimed: draft.claimed ?? null,
    },
    feeling: verdict.feeling !== undefined ? verdict.feeling : draft.feeling ?? null,
    aliases: [...(verdict.aliases ?? draft.aliases ?? [])],
    updates,
    unresolved: draft.unresolved === true,
    at: buffer.now(),
    day: buffer.day(),
    contentHash,
    covers: [],
    ownSpanHash: own?.hash ?? null,
  };

  const coverage = buffer.claimCoverage({
    scope: ctx.scope,
    session: ctx.session,
    proposalId: proposal.id,
    ownSpanHash: proposal.ownSpanHash,
  });
  proposal.covers = coverage.map((c) => c.spanHash);

  const record: ProposalRecord = {
    id: proposal.id,
    contentHash,
    session: proposal.session,
    source: proposal.source,
    at: proposal.at,
    day: proposal.day,
    covers: proposal.covers,
    accepted: true,
  };
  if (!buffer.recordProposal(ctx.scope, record)) {
    // The battery DID run before this failure, so its records travel: an IO loss
    // after a clean gate is a different story from a refusal, and the durable
    // row is how the difference survives the process.
    return {
      ...base,
      reason: "IO_FAILED",
      droppedFields: parsed.dropped,
      records: verdict.records ?? [],
      channels: verdict.channels ?? [],
      kind,
      blockedBy: [],
    };
  }
  buffer.emit("remember.proposal.accepted", proposal.id, {
    source: proposal.source,
    kind: proposal.kind,
    claimed: proposal.salience.claimed,
    covers: proposal.covers.length,
    updates: proposal.updates?.method ?? "none",
  });

  return {
    accepted: true,
    reason: "ACCEPTED",
    proposal,
    coverage,
    gate: null,
    malformed: null,
    degradedToSpan: false,
    droppedFields: parsed.dropped,
    records: verdict.records ?? [],
    channels: verdict.channels ?? [],
    kind,
    blockedBy: [],
  };
}

// ── prompt-side coverage marks (§5 G7) ───────────────────────────────────────

export interface MarkedSpan {
  /** The span's text, UNTOUCHED — this is what a gate sees. */
  span: Span;
  /** Prompt-side only. Nothing that reads `span.text` can ever see this. */
  mark: string | null;
}

export const ALREADY_AUTHORED_MARK = "[already authored by the experiencer]";

/**
 * Join spans with their coverage marks for a prompt. This function is the ONLY
 * place the two meet, and it returns a rendered string — so no gate can be loosened
 * by a mark the engine wrote (§5 G7). Covered spans still reach the sweep; only a
 * proposal's own span is withheld outright, upstream of here.
 */
export function markCovered(spans: readonly Span[], covered: ReadonlySet<string>): MarkedSpan[] {
  return spans.map((span) => ({ span, mark: covered.has(span.hash) ? ALREADY_AUTHORED_MARK : null }));
}

export function renderForSweep(marked: readonly MarkedSpan[]): string {
  return marked
    .map((m) => (m.mark === null ? m.span.text : `${m.mark}\n${m.span.text}`))
    .join("\n\n---\n\n");
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
