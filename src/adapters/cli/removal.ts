/**
 * THE DESTRUCTION PATH. It lives here, in the owner's console, and nowhere else.
 *
 * `src/core/store/owner-op-seam.ts` declares `OwnerRemovalPort` as TYPES ONLY —
 * the store exports no delete, no unlink, no rm, and that absence is the
 * enforcement (§5 G2, §16 G1). This file is the one implementation. A test in
 * `test/cli.test.ts` walks the import graph and fails if any core module, any
 * other adapter, or anything a model can reach imports it. **That test failing
 * is the point**: it is the caller-universality check the contract asks for
 * (§16 G2, earned-mechanism #14).
 *
 * The order below is not style. Every step is a crash point, and at every one of
 * them the memory is either fully alive, or dark AND RECORDED (§16 G10–G11):
 *
 *   1. **Validate the target.** Memory-bearing roots only (§16 G16). The
 *      archive, the backups, the graph and the removal record itself are never
 *      nameable, so a typo cannot point removal at the record of removal.
 *   2. **Read everything that must be read, BEFORE anything is chased** (§16
 *      G13). v1 named this bug by making it: chasing copies first left every
 *      span unidentifiable, so the contamination scan had nothing to match on.
 *      The scan returns **ids only** — printing the matches would re-leak
 *      exactly what is being erased (§16 G15).
 *   3. **`requested`.** If the record cannot be written, NOTHING MOVES. A
 *      removal that happened without a record is the one outcome worse than a
 *      removal that did not happen.
 *   4. **`dark`.** From this moment `Store.deniedIds()` contains the id, and
 *      every consumer that consults it — recall, sleep, associate, prospective,
 *      the cache rebuild — skips it. A restored backup or a stray copy cannot
 *      quietly resurrect it; the stray is skipped and LOGGED, never deleted
 *      (§16 G12).
 *   5. **Chase**, then `chased`, then `complete`. Whatever could not be chased
 *      is REPORTED, never silently dropped (§16 G15: no silent partial success).
 *      Box 1 (the prose file and every archived version file) is chased here;
 *      box 2 (the row, its edges, its prospective windows, the gate rows that
 *      name it, and every content pointer it had) by `chaseRemoved` on the
 *      store's owner-op seam, which appends the `chased` stage inside its own
 *      transaction; box 3 by a rebuild that skips and logs the denied id.
 *
 * The record carries no body and no content hash (§16 G9, scar §2.20): a hash of
 * low-entropy content is brute-forceable, which would make the record of a
 * removal a leak of the thing removed.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The span buffer's OWN scope-directory function, imported rather than
// re-derived: `spans/<keyFor(scope)>/` is `remember/`'s layout, and a second
// copy of that arithmetic living in the destruction path is how a report starts
// naming a file that does not exist.
import { SpanBuffer, keyFor } from "../../core/remember/index.js";
// The buffer's own destruction seam — the second VALUE import this file makes
// from core, and pinned by the same caller-universality test as the first. The
// strike is `remember/`'s because `spans/` is `remember/`'s state machine: an
// `rmSync` from here would race a claim renaming the file aside, which is the
// one state spec §2 G6 forbids (cli/INTERFACE-GAPS §9, closed 2026-09-05).
import { strikeSpans } from "../../core/remember/owner-strike-seam.js";
import { paths } from "../../core/store/index.js";
import type {
  OwnerRemovalOutcome,
  OwnerRemovalRequest,
  RemovalNote,
  Store,
} from "../../core/store/index.js";
// The one VALUE imported from the seam, and the reason the caller-universality
// test pins this file AND that one: `chaseRemoved` is the box-2 half of the
// destruction path. It is reachable by importing the seam on purpose, never by
// holding a `Store` (INTERFACE-GAPS §1, closed 2026-08-25).
import { chaseRemoved } from "../../core/store/owner-op-seam.js";

export interface RemovalPlan {
  readonly targetId: string;
  readonly valid: boolean;
  readonly reason: "ok" | "unknown-id" | "not-memory-bearing" | "already-removed";
  /** IDS ONLY. Other memories whose text overlaps the doomed content (§16 G15). */
  readonly contamination: readonly string[];
  /** What the chase will visit, by surface name. Counts, never contents. */
  readonly surfaces: { readonly surface: string; readonly count: number }[];
  /**
   * The SEVENTH surface: `remember/`'s raw capture buffer. Always present, in
   * all three states — a surface that is silent when it is empty is exactly the
   * silent partial success §16 G15 forbids. Since 2026-09-05 `held` is CHASED,
   * through `remember/`'s own strike seam, and `unknown` is the one state that
   * still lands in `unchasable`.
   */
  readonly spans: SpanSurface;
  /**
   * The chase key, carried from the plan to the run so the strike does not have
   * to re-derive it after the prose is gone. Hashes and a scope — never the
   * body, which stays a local in `planRemoval` and reaches the seam only as a
   * predicate the caller closes over.
   */
  readonly spanChase: SpanChase;
  /** Surfaces this implementation cannot reach — named, never implied. */
  readonly unchasable: readonly string[];
}

/**
 * `held` — a line under `spans/` carries this memory's words, right now, checked.
 * `unknown` — this console cannot rule it out, and says which way it is blind.
 * `not-applicable` — checked, and there is nothing of this memory there.
 */
export type SpanState = "held" | "unknown" | "not-applicable";

export interface SpanSurface {
  readonly surface: "spans";
  readonly state: SpanState;
  /** Store-RELATIVE, and only when one can be named. Never an absolute path. */
  readonly path: string | null;
  /** Lines the strike will take, counted at plan time. Zero unless `held`. */
  readonly count: number;
  /**
   * OTHER lines under `spans/` that quote these words without being this
   * memory's own capture — the conversation turn in which they were said,
   * still waiting to be interpreted. They are LEFT, on purpose: a conversation
   * span is many turns joined, belongs to no single memory, and striking it
   * because one memory quoted it would destroy material nobody named. Counted
   * and disclosed rather than passed over in silence (§16 G15).
   */
  readonly echoes: number;
  /** The whole sentence the console prints, and the `unchasable` entry when it is one. */
  readonly line: string;
}

/**
 * How the buffer is addressed. `hashes` is the chase BY IDENTITY — the span
 * hash the mint recorded in the memory's prose meta (`origin.spanHash`), plus
 * every `own: true` coverage mark for its `origin_ref`, which is what makes the
 * chase work on rows minted before that meta key existed. `byContent` says the
 * console had no hash and will match on the doomed body instead.
 */
export interface SpanChase {
  readonly scope: string | null;
  readonly hashes: readonly string[];
  readonly byContent: boolean;
}

export interface RemovalOptions {
  /** Wall-clock, not lived days: a week away must still be a week of second
   *  thoughts (§16's note on the released ceremony). */
  now?: () => number;
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}

/** Prose families a removal may target. Everything else is chased, never named. */
const MEMORY_BEARING = new Set(["memory", "episode", "schema"]);

/**
 * The one state still unreachable, in the same words wherever it is reported.
 * Kept as a constant for the reason it was written as one: a blind spot
 * described two different ways in two places is a blind spot nobody can grep.
 */
const SPANS_BLIND =
  "this removal did not reach it, and a later backup would copy it (export would not).";

/** Every `*.jsonl` under a directory — the live streams and the claims beside them. */
function jsonlUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Does this file hold a line of this memory? BY HASH first — the identity the
 * mint recorded — and by the doomed TEXT only as the fallback for a row minted
 * before the provenance existed. Reads the file; never returns a word of it.
 *
 * Only lines that are SPANS count. `coverage.jsonl`, `consumed.jsonl` and
 * `failures.jsonl` carry span hashes too, and matching a hash there would report
 * a file that holds nothing but bookkeeping as one that holds the owner's words.
 */
function spanLinesIn(
  path: string,
  hashes: ReadonlySet<string>,
  needle: string | null,
): { byHash: number; byTextJot: number; byTextOther: number } {
  const none = { byHash: 0, byTextJot: 0, byTextOther: 0 };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return none;
  }
  let byHash = 0;
  let byTextJot = 0;
  let byTextOther = 0;
  let parsedAny = false;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const record = JSON.parse(line) as { text?: unknown; hash?: unknown; kind?: unknown };
      if (typeof record.text !== "string") continue;
      parsedAny = true;
      if (typeof record.hash === "string" && hashes.has(record.hash)) byHash += 1;
      else if (needle !== null && record.text.includes(needle)) {
        // A text match is only ever this MEMORY's own line when the span is a
        // jot — the words deposited as themselves. Anything else is the
        // conversation they were said in, which belongs to no single memory
        // (`SpanSurface.echoes`). A record with no `kind` counts as an echo:
        // the conservative direction is the one that destroys nothing.
        if (record.kind === "jot") byTextJot += 1;
        else byTextOther += 1;
      }
    } catch {
      /* a half-written line: covered by the raw check below */
    }
  }
  // The raw substring is what catches a file this console does not understand —
  // a format change, a half-written line. It counts as an ECHO, never as a line
  // to strike: this console did not manage to identify it.
  if (byHash === 0 && byTextJot === 0 && byTextOther === 0 && !parsedAny && needle !== null && text.includes(needle)) {
    return { byHash: 0, byTextJot: 0, byTextOther: 1 };
  }
  return { byHash, byTextJot, byTextOther };
}

/**
 * THE CHASE KEY. Two sources, both already durable, neither of them the body:
 *
 *   1. `origin.spanHash` in the memory's PROSE META. The mint records it for
 *      every jot (`core/mint.ts`), and it lives in the prose rather than in a
 *      box-2 column on purpose — a hash of low-entropy content is
 *      brute-forceable (§16 G9), so the pointer must die with the document it
 *      points at instead of outliving the removal in the row skeleton.
 *   2. The `own: true` COVERAGE MARKS for this memory's `origin_ref`. Every
 *      accepted proposal writes `{spanHash, proposalId, own}` into the scope's
 *      `coverage.jsonl`, and the mint stores the proposal id in `origin_ref` —
 *      so the link from a memory to the span it WAS has been on disk since long
 *      before this feature, and the chase works on rows minted before it.
 *
 * `own` is the whole filter. The other spans a proposal covered are the
 * conversation AROUND it, which belong to no single memory; striking those
 * because one memory cited them would be a destruction nobody asked for.
 */
function chaseHashes(store: Store, doc: { meta?: Record<string, unknown> } | null, row: {
  origin_scope?: unknown;
  origin_ref?: unknown;
} | undefined): { scope: string | null; hashes: string[] } {
  const scope =
    typeof row?.origin_scope === "string" && row.origin_scope.length > 0 ? row.origin_scope : null;
  const hashes = new Set<string>();

  const origin = doc?.meta?.["origin"];
  if (origin !== null && typeof origin === "object") {
    const spanHash = (origin as { spanHash?: unknown }).spanHash;
    if (typeof spanHash === "string" && spanHash.length > 0) hashes.add(spanHash);
  }

  const ref = typeof row?.origin_ref === "string" && row.origin_ref.length > 0 ? row.origin_ref : null;
  if (ref !== null && scope !== null) {
    const coverage = join(store.dir, "spans", keyFor(scope), "coverage.jsonl");
    if (existsSync(coverage)) {
      let text = "";
      try {
        text = readFileSync(coverage, "utf8");
      } catch {
        text = "";
      }
      for (const line of text.split("\n")) {
        if (line.trim().length === 0) continue;
        try {
          const mark = JSON.parse(line) as { spanHash?: unknown; proposalId?: unknown; own?: unknown };
          if (mark.own !== true) continue;
          if (mark.proposalId !== ref) continue;
          if (typeof mark.spanHash === "string") hashes.add(mark.spanHash);
        } catch {
          /* an unreadable mark is not a hash */
        }
      }
    }
  }

  return { scope, hashes: [...hashes] };
}

/**
 * THE SEVENTH SURFACE (LAUNCH-STATUS §I2; option A shipped 2026-09-04, option B
 * — the chase — on 2026-09-05).
 *
 * A note taken through the MCP `note` tool or `counterparts note` is CAPTURED
 * first — `captureJot` appends the verbatim text to `spans/<keyFor(scope)>/jots.jsonl` —
 * and minted second. The chase never reached that file, `unchasable` was a
 * hardcoded `[]`, and `remove` reported `unchased: nothing` while the words were
 * still on disk. It reaches it now, through `remember/`'s own strike seam.
 *
 * **Identity first, evidence second, provenance third.** The state is decided by
 * looking: the memory's own span hash (from the mint) and then its words are
 * searched for in the buffer files, and a hit is a fact rather than an
 * inference. The hash is what lets the chase work when the prose is already
 * gone, which is the case the content search could never answer. Provenance only
 * breaks the tie when both come back empty — because `source = 'authored'` means
 * this memory came through the jot door, and "I did not find it" is not "it was
 * never there". The remaining blind spot (prose gone AND no hash recorded) is
 * reported as `unknown` rather than resolved in the comfortable direction.
 */
export function spanResidue(
  store: Store,
  targetId: string,
  body: string,
  hashes: readonly string[] = [],
): SpanSurface {
  const row = store.row(targetId);
  const source = typeof row?.source === "string" && row.source.length > 0 ? row.source : null;
  const scope = typeof row?.origin_scope === "string" && row.origin_scope.length > 0 ? row.origin_scope : null;
  const spansRoot = join(store.dir, "spans");
  const scopeDir = scope === null ? spansRoot : join(spansRoot, keyFor(scope));
  const files = jsonlUnder(scopeDir);
  const rel = (path: string): string => relative(store.dir, path);
  const named = scope === null ? "spans/" : `${rel(scopeDir)}/`;

  if (files.length === 0) {
    return {
      surface: "spans",
      state: "not-applicable",
      path: null,
      count: 0,
      echoes: 0,
      line: `spans: not applicable — there is no capture buffer at ${named} for this memory, so nothing of it rode one.`,
    };
  }

  const needle = body.trim().length > 0 ? body.trim() : null;
  const keys = new Set(hashes);

  // ONE pass over the buffer, and TWO numbers out of it.
  //
  //   `count`  — lines the strike will take. By hash when the mint recorded
  //              one; by content only when it did not, and then only for a
  //              JOT, because a content match on a conversation span is the
  //              memory's words quoted inside somebody's turn.
  //   `echoes` — every other line that carries these words. LEFT, because a
  //              conversation span is many turns joined and belongs to no
  //              single memory — and SAID, because a grep will find it and a
  //              report that did not mention it would be the silent partial
  //              success §16 G15 forbids.
  //
  // Both clauses mirror `matches()` in the strike seam exactly, so the plan's
  // number is the number the report prints.
  let count = 0;
  let echoes = 0;
  let first: string | null = null;
  for (const file of files) {
    const hits = spanLinesIn(file, keys, needle);
    const mine = keys.size > 0 ? hits.byHash : hits.byTextJot;
    echoes += keys.size > 0 ? hits.byTextJot + hits.byTextOther : hits.byTextOther;
    if (mine === 0) continue;
    count += mine;
    if (first === null) first = rel(file);
  }

  /** The disclosure sentence, appended to whatever verdict the state reaches. */
  const echoNote =
    echoes === 0
      ? ""
      : ` ${echoes} line${echoes === 1 ? "" : "s"} of conversation under ${named} quote${echoes === 1 ? "s" : ""} these words — transcript, not this memory's own capture, and left alone.`;

  if (first !== null) {
    const where = count === 1 ? first : `${first} (and ${count - 1} more line${count === 2 ? "" : "s"})`;
    return {
      surface: "spans",
      state: "held",
      path: first,
      count,
      echoes,
      line: `${where} — the raw capture buffer holds this memory's words; the removal strikes them out of it.${echoNote}`,
    };
  }

  if (needle === null && keys.size === 0) {
    return {
      surface: "spans",
      state: "unknown",
      path: named,
      count: 0,
      echoes,
      line: `${named} — the prose is already gone and no span hash was recorded, so this console cannot tell whether the words rode the buffer; if they did, ${SPANS_BLIND}${echoNote}`,
    };
  }

  // Searched — by hash where there was one, by content where there was not —
  // and this memory's own line is not there. Whether that settles it depends on
  // how the memory was minted.
  if (keys.size > 0) {
    return {
      surface: "spans",
      state: "not-applicable",
      path: null,
      count: 0,
      echoes,
      line:
        echoes === 0
          ? `spans: not applicable — this memory's own span is named in its provenance, and no line under ${named} still carries it.`
          : `spans: not applicable — this memory's own capture is already gone from ${named}.${echoNote}`,
    };
  }
  if (source === "authored") {
    return {
      surface: "spans",
      state: "unknown",
      path: named,
      count: 0,
      echoes,
      line: `${named} — this memory came through the jot door, so its words rode the buffer; no jot there matches them now, and this console cannot prove the capture is gone; if one survives, ${SPANS_BLIND}${echoNote}`,
    };
  }
  if (source === null) {
    return {
      surface: "spans",
      state: "unknown",
      path: named,
      count: 0,
      echoes,
      line: `${named} — unknown whether the words rode the buffer: this memory's provenance was never recorded, and a buffer exists; if a jot is there, ${SPANS_BLIND}${echoNote}`,
    };
  }
  return {
    surface: "spans",
    state: "not-applicable",
    path: null,
    count: 0,
    echoes,
    line: `spans: not applicable — a '${source}' memory is not captured as a jot, and no jot under ${named} holds its words.${echoNote}`,
  };
}

/**
 * STEP 1 + 2: validate, then read everything the removal will need. Pure — it
 * writes nothing and takes no lock, so it is safe to run before a confirmation
 * prompt and safe to run again after one (scar §2.13's re-plan-under-the-lock
 * rule; E5's never-hold-a-lock-across-a-human-prompt rule).
 */
export function planRemoval(store: Store, targetId: string): RemovalPlan {
  const none = (reason: RemovalPlan["reason"]): RemovalPlan => ({
    targetId,
    valid: false,
    reason,
    contamination: [],
    surfaces: [],
    // An invalid target is not a memory to have residue: nothing was read and
    // nothing is claimed about the buffer.
    spans: {
      surface: "spans",
      state: "not-applicable",
      path: null,
      count: 0,
      echoes: 0,
      line: "spans: not applicable — there is nothing here to have ridden the buffer.",
    },
    spanChase: { scope: null, hashes: [], byContent: false },
    unchasable: [],
  });

  const row = store.row(targetId);
  if (row === undefined) return none("unknown-id");
  if (!MEMORY_BEARING.has(row.type)) return none("not-memory-bearing");
  if (store.deniedIds().includes(targetId)) return none("already-removed");

  // EVERYTHING THAT READS THE DOOMED CONTENT HAPPENS HERE (§16 G13).
  let body = "";
  let doc: { meta?: Record<string, unknown> } | null = null;
  try {
    const read = store.readProse(targetId);
    body = read.body;
    doc = read;
  } catch {
    // The prose is already gone. The removal still proceeds — the row, the
    // graph and the deny-list entry are the rest of the surface, and the span
    // hash is still reachable through `origin_ref` and the coverage marks.
  }
  const chase = chaseHashes(store, doc, row);
  const contamination: string[] = [];
  if (body.trim().length > 0) {
    for (const hit of store.search(body, 20)) {
      if (hit.id !== targetId) contamination.push(hit.id);
    }
  }

  const versions = store.versions(targetId);
  const edges = store.edgesFrom(targetId);
  const prospective = store.prospectiveFor(targetId);
  // Read WITH the rest (§16 G13): the buffer is searched for this memory's span
  // before anything is chased, because after the chase there is nothing left to
  // search for. Counts and states come out; not one line of what it read.
  const spans = spanResidue(store, targetId, body, chase.hashes);

  return {
    targetId,
    valid: true,
    reason: "ok",
    contamination,
    surfaces: [
      { surface: "prose", count: 1 },
      { surface: "versions", count: versions.length },
      { surface: "edges", count: edges.length },
      { surface: "prospective", count: prospective.length },
      { surface: "operational rows", count: 1 },
      { surface: "cache", count: 1 },
      // The seventh, and it is in this list rather than beside it now: a surface
      // that is chased belongs with the chased ones. It is stated at 0 too — the
      // silence about an empty buffer is what made the residue undiscoverable
      // (LAUNCH-STATUS §I2). Not for `unknown`, where a `0` beside a "NOT
      // chased" line would read as a contradiction rather than a disclosure;
      // that state says its whole piece in its own sentence.
      ...(spans.state === "unknown" ? [] : [{ surface: "spans", count: spans.count }]),
    ],
    spans,
    spanChase: {
      scope: chase.scope,
      hashes: chase.hashes,
      // A content match is what the strike falls back to when the mint recorded
      // no hash. It is only offered when there IS a body to match on.
      byContent: chase.hashes.length === 0 && body.trim().length > 0,
    },
    // Empty of CHASE failures until run time (the box-2 chase landed 2026-08-25,
    // INTERFACE-GAPS §1; the span chase 2026-09-05) — and no longer holding the
    // `held` case, which is chased. `unknown` stays: a surface this console
    // cannot rule out is exactly what §16 G15's "no silent partial success"
    // says a plan must name here rather than let the report say `nothing`.
    // Two different things can be true at once, and both are named: the buffer
    // could not be ruled out (`unknown`), and conversation lines quote these
    // words and are being left (`echoes`). Neither is allowed to hide the other.
    unchasable: [
      ...(spans.state === "unknown" ? [spans.line] : []),
      ...(spans.echoes > 0
        ? [
            `spans echo (${spans.echoes} line${spans.echoes === 1 ? "" : "s"} of conversation quoting these words — transcript, not this memory's capture; left on purpose, and the sweep drains it)`,
          ]
        : []),
    ],
  };
}

/**
 * STEPS 3–5. The one implementation of `OwnerRemovalPort`.
 *
 * It throws only when the RECORD cannot be written, because that is the single
 * failure where doing nothing is correct. Every later failure is caught, counted
 * and reported in `unchased` — a chase that half-worked must say so.
 */
export function ownerRemoval(
  store: Store,
  request: OwnerRemovalRequest,
  opts: RemovalOptions = {},
): OwnerRemovalOutcome {
  const emit = opts.onEvent ?? ((): void => {});
  const notes: RemovalNote[] = [];
  const append = (stage: RemovalNote["stage"]): void => {
    const note: RemovalNote = {
      memoryId: request.targetId,
      stage,
      actor: request.actor,
      reason: request.reason,
    };
    store.appendRemovalRecord(note);
    notes.push(note);
    emit("cli.removal.stage", { stage, target: request.targetId });
  };

  const plan = planRemoval(store, request.targetId);
  if (!plan.valid) {
    // Nothing is recorded for a target that was never removable: a record here
    // would put an id on the deny-list on the strength of a typo.
    throw new Error(`removal refused: ${plan.reason}`);
  }

  // 3. REQUESTED — if this throws, nothing has moved and nothing will (§16 G10).
  append("requested");

  const row = store.row(request.targetId);
  const prosePath = row?.prose_path ?? null;
  const versions = store.versions(request.targetId);

  // Read the body BEFORE `dark`, and keep it local: it is the strike's fallback
  // predicate for a memory whose mint recorded no span hash, and after the chase
  // there is nothing left to match on. It never enters the plan, the report or
  // any record — the seam receives a FUNCTION, not a string (§16 G15).
  let doomedBody = "";
  try {
    doomedBody = store.readProse(request.targetId).body.trim();
  } catch {
    /* already gone; the hashes are the chase then, or nothing is */
  }

  // 4. DARK — the deny-list is live from this line onward (§16 G12).
  append("dark");

  const chased: string[] = [];
  const unchased: string[] = [...plan.unchasable];

  // 5. CHASE. THE SPAN BUFFER FIRST, because it is the only surface whose key
  //    the later steps destroy: `chaseRemoved` blanks the row's `origin_ref`
  //    pointers' usefulness and the prose file carries the hash. Strike while
  //    the addressing still exists.
  //
  //    It is `remember/`'s own seam, not an `rmSync` from here: `spans/` is that
  //    module's state machine, and a claim renaming the buffer aside underneath
  //    a naive rewrite is the "in neither claim nor buffer" state spec §2 G6
  //    exists to forbid (cli/INTERFACE-GAPS §9).
  if (plan.spans.state === "held") {
    try {
      const buffer = new SpanBuffer({ dir: store.dir, day: () => store.livedDay() });
      const report = strikeSpans(buffer, {
        scope: plan.spanChase.scope,
        hashes: plan.spanChase.hashes,
        ...(plan.spanChase.byContent && doomedBody.length > 0
          ? { predicate: (text: string): boolean => text.includes(doomedBody) }
          : {}),
      });
      if (report.reason === "STRUCK") {
        chased.push(`spans(${report.struck} line${report.struck === 1 ? "" : "s"} in ${report.files.length} file${report.files.length === 1 ? "" : "s"})`);
        // What happened to the OTHER two places a span hash lives, said out
        // loud: the terminal ledger keeps the hash so nothing re-admits the
        // words, and a claim file mid-arc was rewritten under its worker.
        if (report.ledgered > 0) {
          chased.push(`spans ledger(${report.ledgered} hash${report.ledgered === 1 ? "" : "es"} kept in consumed.jsonl so nothing re-captures the words)`);
        }
        if (report.touchedClaim) chased.push("spans claim file(rewritten; a restore cannot put it back)");
        emit("cli.removal.spans", {
          struck: report.struck,
          files: report.files.length,
          ledgered: report.ledgered,
          byHash: plan.spanChase.hashes.length > 0,
        });
      } else {
        unchased.push(`spans (${report.reason}) — ${plan.spans.line}`);
      }
    } catch {
      unchased.push(`spans (threw) — ${plan.spans.line}`);
    }
  }

  //    Box 1 next: the prose and every archived version of it.
  if (prosePath !== null && existsSync(prosePath)) {
    try {
      rmSync(prosePath, { force: true });
      chased.push("prose");
    } catch {
      unchased.push("prose");
    }
  } else {
    chased.push("prose");
  }
  let versionsGone = 0;
  for (const version of versions) {
    try {
      if (existsSync(version.path)) rmSync(version.path, { force: true });
      versionsGone += 1;
    } catch {
      /* counted below */
    }
  }
  if (versionsGone === versions.length) chased.push("versions");
  else unchased.push("versions");
  try {
    rmSync(paths.versionsFor(store.dir, request.targetId), { recursive: true, force: true });
  } catch {
    /* an empty directory left behind is not a leak */
  }

  // Box 2, and the `chased` stage with it: the seam appends the record INSIDE
  // its own transaction, so the rows and the record land together or not at all.
  // What survives is named in the report, never implied (§16 G15).
  try {
    const report = chaseRemoved(store, request.targetId);
    for (const surface of report.removed) chased.push(`${surface.surface}(${surface.count})`);
    for (const surface of report.neutralized) {
      chased.push(`${surface.surface}(${surface.count}, tombstoned)`);
    }
    notes.push({ memoryId: request.targetId, stage: "chased", actor: request.actor });
    emit("cli.removal.stage", { stage: "chased", target: request.targetId });
  } catch {
    unchased.push("operational rows");
    append("chased");
  }

  // Box 3: the rebuild skips every denied id and LOGS the skip, so the cache
  // comes back without the memory and with a record that it was left out.
  try {
    store.rebuildCache();
    chased.push("cache");
  } catch {
    unchased.push("cache");
  }

  append("complete");
  emit("cli.removal.complete", {
    target: request.targetId,
    chased: chased.length,
    unchased: unchased.length,
    contamination: plan.contamination.length,
  });

  return { chased, unchased, notes };
}

/**
 * The read-back a removal is only trustworthy with: is the id dark, is its prose
 * gone, and does any canonical file still hold its text? Ids only in, verdict
 * out — no body ever crosses this boundary.
 */
export function verifyRemoval(store: Store, targetId: string): {
  denied: boolean;
  proseGone: boolean;
  /** True while a row exists at all — after the chase it is a stripped skeleton. */
  rowSurvives: boolean;
  /** True when that row has been stripped of every content pointer. */
  rowTombstoned: boolean;
  /** Box-2 state that should be gone: edges, prospective windows, gate rows. */
  darkState: number;
} {
  const row = store.row(targetId);
  const prosePath = row === undefined || row.prose_path === "" ? null : row.prose_path;
  const tombstone = store.tombstones().find((e) => e.id === targetId);
  return {
    denied: store.deniedIds().includes(targetId),
    proseGone: prosePath === null || !existsSync(prosePath),
    rowSurvives: row !== undefined,
    rowTombstoned: tombstone !== undefined && row?.content_hash === "" && row?.prose_path === "",
    darkState:
      store.edgesFrom(targetId).length + store.prospectiveFor(targetId).length,
  };
}
