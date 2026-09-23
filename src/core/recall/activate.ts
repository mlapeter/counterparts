/**
 * Activation — from cues to a scored candidate set.
 *
 * Three channels, and the difference between them is the whole design:
 *
 *   **cue** (lexical, plus TEMPORAL) and **semantic** (embedding) are the
 *   CONVERSATION. Either one makes a memory a candidate at all.
 *
 *   A **temporal cue** — the calendar reached a window a memory remembers — is
 *   folded into the cue channel and into nothing else (SEAMS item D,
 *   `prospective/INTERFACE-GAPS.md` §1). It is "one more cue, like the user typing
 *   'Portland'": same map, same activation number, same background bar, and it
 *   COUNTS AS CUE in `cueFraction`, or hard gate (c) would silently change
 *   meaning. It is emphatically NOT the `arrival` channel below, which shares its
 *   English name and nothing else — wiring a temporal arrival into
 *   `ARRIVAL_WEIGHT` would turn a recency MULTIPLIER into an ADMISSION channel and
 *   break hard gate (a) for every dated memory.
 *   **arrival** (base-level strength) is RECENCY. It modulates a candidate that
 *   the conversation already reached, and it can never create one — which is how
 *   hard gate (a), *an uncued memory is dark whatever its salience*, is enforced
 *   structurally rather than checked: an uncued memory is not fetched, so its
 *   salience arithmetic is never evaluated (§9 G7a).
 *   **hops** (spreading activation, SEAMS item L) MODULATE ONLY, exactly like
 *   arrival. `associate/INTERFACE-GAPS.md` §1 names three defensible answers and
 *   SEAMS L records the one chosen: the conservative default, which is the only
 *   one that keeps hard gate (a) STRUCTURAL — a hop reaches "a memory no cue and
 *   no embedding touched", and in this contract's vocabulary that memory is
 *   uncued and therefore dark. So a hop is added to a candidate that already
 *   exists, never mints one, and is excluded from `cueFraction`'s NUMERATOR —
 *   which is what makes "spreading never creates a loud-tier candidate without a
 *   cue" arithmetic rather than a promise: hop weight sits in the denominator and
 *   pushes the candidate AWAY from the loud tier, never toward it.
 *
 * The candidate set is exactly the union of the token index's hits and the vector
 * index's hits. NO MODEL CALL: the turn's vector is an INPUT. Its absence degrades
 * to lexical-only, which is guarantee 1's precise v2 form — the ambient path may
 * consult an embedding, never a generative model, and must degrade rather than
 * fail.
 */
import type { Kind, MemoryPhysics } from "../types.js";
import { sal, strength } from "../physics/index.js";
import type { Hit, ProseDoc, Store } from "../store/index.js";
import { confidentialByMeta, rowToPhysics, tokenize } from "../store/index.js";
import { buildCues, informativeness } from "./cues.js";
import type { Cue } from "./cues.js";
import type { RecallTunables, SemanticPath, SemanticTuning } from "./tunables.js";
import { semanticTuning } from "./tunables.js";

export interface Candidate {
  readonly id: string;
  readonly kind: Kind;
  readonly doc: ProseDoc;
  readonly physics: MemoryPhysics;
  readonly strength: number;
  /** Salience as the GATE sees it: emotional dimension included only when the
   *  turn itself carries first-person feeling (§9 G10/G11 — emotion is
   *  turn-gated, and that gate is the safety property). */
  readonly sal: number;
  readonly cue: number;
  /** The portion of `cue` that came from a temporal window (already included in
   *  `cue`; carried separately only so the ceiling below can be decided). */
  readonly temporal: number;
  readonly semantic: number;
  readonly arrival: number;
  /** Spreading activation from `associate/`. In `activation`, never in
   *  `cueFraction`'s numerator, and never able to mint a candidate. */
  readonly hops: number;
  readonly activation: number;
  /** (cue + semantic) / activation — hard gate (c)'s input. */
  readonly cueFraction: number;
  readonly matched: number;
  /** Every matching cue was an ambiguous handle and nothing corroborated it:
   *  it fires at reduced weight (already applied) and TRAINS NOTHING. */
  readonly trains: boolean;
  /** A per-candidate tier CEILING. `"footnoted"` for a candidate whose only cue
   *  is temporal: a remembered date may make a memory quietly available and must
   *  never make it loud (prospective §12 G5). Absent from the gate's other rules
   *  by design — it caps, it never admits. */
  readonly maxTier: "surfaced" | "footnoted";
  readonly confidential: boolean;
}

export interface ActivationInput {
  readonly text: string;
  readonly vector?: readonly number[] | undefined;
  /** A ranking somebody else already computed — the lagged semantic cue the
   *  worker resolved one turn ago (`session.ts`). Supplied hits REPLACE the
   *  `nearestTo` scan; an empty array is "nothing was near", which degrades. */
  readonly hits?: readonly Hit[] | undefined;
  readonly carried?: readonly string[] | undefined;
  readonly aliases?: ReadonlyMap<string, readonly string[]> | undefined;
  /** Temporal cues from `prospective.arrivals()`: memory id and cue weight.
   *  Folded into `cueScore`, never into `arrival` (see the header). */
  readonly temporal?: readonly { id: string; weight: number }[] | undefined;
  /** INJECTED traversal (`Associate.spreadFrom`), because `recall/` must not
   *  import `associate/`. Seeded with the CUED candidates and their own
   *  activation; contributions to anything that is not already a candidate are
   *  DROPPED here, which is where "hops modulate only" is enforced. */
  readonly spread?:
    | ((seeds: readonly { id: string; activation: number }[], day: number) => {
        contributions: readonly { id: string; activation: number }[];
      })
    | undefined;
  readonly day: number;
  /** Whether the turn stated a FIRST-PERSON feeling. Gates emotional salience. */
  readonly selfFelt: boolean;
  readonly maxCandidates: number;
  /** Live memory count, for informativeness and the cold-start regime. */
  readonly storeSize: number;
}

export interface ActivationResult {
  readonly cues: Cue[];
  readonly candidates: Candidate[];
  readonly storeSize: number;
  /** Candidates dropped before scoring because they are not live memory. */
  readonly skipped: number;
  /** True when a vector was supplied but the index answered nothing — the
   *  lexical-only degradation, recorded rather than silent. */
  readonly semanticDegraded: boolean;
  /** Documents whose cue sum hit the per-document ceiling (`CUE_DOC_CAP`).
   *  Reported, not recorded: it is the number `tools/recall-bench` reads to
   *  tell "the cap did the work" from "normalization did the work". It is
   *  deliberately NOT a `RecallDecision` field — that record's field list is a
   *  hashed surface set the parallel run carries ratings across, and a new
   *  column there would invalidate a live instrument mid-run. */
  readonly capped: number;
  /**
   * Which semantic calibration this pass used — the recorded identity, the path,
   * and the floor/weight `semanticTuning` chose — or null when no semantic input
   * came at all. Reported, not recorded (the same reason as `capped`).
   */
  readonly semantic: { identity: string | null; path: SemanticPath; floor: number; weight: number } | null;
}

/**
 * THE SELF PAGE IS NOT A RECALL CANDIDATE (2026-09-18, S1).
 *
 * The page is `self/`'s one row of standing prose about the self, and it is
 * already delivered — whole, first, at every wake. Leaving it in the candidate
 * pool means it can be quoted back to the model on a turn it is ALSO carrying in
 * its own wake, can accrue use credit and association edges for being what it
 * always is, and — since a schema row has no project scope — can surface under a
 * project the owner never wrote it in. It is up to 16 KB against a bounded
 * result, and it is the one row whose surfacing tells the reader nothing they
 * were not already told.
 *
 * The role string is read STRUCTURALLY rather than imported: `recall/` does not
 * depend on `self/`, and a shape check that fails reads as "not the page", which
 * is the direction that only ever costs a candidate slot. The owner of the
 * constant is `self/page.ts#SELF_PAGE_ROLE`.
 *
 * One line to reverse, if the page should come back to mind.
 */
export function isSelfPage(doc: ProseDoc): boolean {
  return doc.type === "schema" && doc.meta["role"] === "page";
}

/** `isSelfPage` by id, for the scan, which holds rows rather than documents. A
 *  page whose prose will not read is not the page for this purpose: the safe
 *  direction is to let it compete, not to drop a row nobody could identify. */
function isPageRow(store: Store, id: string): boolean {
  try {
    return isSelfPage(store.readProse(id));
  } catch {
    return false;
  }
}

/**
 * THE PER-DIRECTORY HANDOFF IS NOT A RECALL CANDIDATE (2026-09-20, E1).
 *
 * A handoff is working context for one directory — "what I was doing here" —
 * delivered as a pointer at the wake of that directory and expandable by id
 * from there. It is not an interpretation of what was learned, it carries no
 * project scope a search could honour, and it expires. Surfacing one inside a
 * turn would put another directory's unfinished business in front of this one.
 *
 * Read STRUCTURALLY for `isSelfPage`'s reason: `recall/` depends on no other
 * core module, and a shape check that fails reads as "not a handoff", which only
 * ever costs a candidate slot. The constant's owner is
 * `handoff/index.ts#HANDOFF_ROLE`.
 */
export function isHandoff(doc: ProseDoc): boolean {
  return doc.type === "schema" && doc.meta["role"] === "handoff";
}

/** `isHandoff` by id, for the scan. */
function isHandoffRow(store: Store, id: string): boolean {
  try {
    return isHandoff(store.readProse(id));
  } catch {
    return false;
  }
}

/**
 * A memory's confidentiality class, as the surfacing gate asks it.
 *
 * The truth table itself is `store/index.ts#confidentialByMeta`, which is also
 * what `StoredMemory.confidential` carries — one answer, so a caller holding a
 * `StoredMemory` and a caller holding a bare `ProseDoc` can never disagree. This
 * wrapper is the door for the second kind (`dashboard/web/reveal.ts`,
 * `mcp/deliberate.ts`); prefer the flag where a read already produced one.
 */
export function isConfidential(doc: ProseDoc): boolean {
  return confidentialByMeta(doc.meta);
}

/** Salience with the emotional dimension gated on the turn (§9 G10). */
export function gatedSal(p: MemoryPhysics, selfFelt: boolean): number {
  if (selfFelt) return sal(p.salience);
  return sal({ ...p.salience, emotional: 0 });
}

export function activate(
  store: Store,
  input: ActivationInput,
  t: RecallTunables,
): ActivationResult {
  const storeSize = input.storeSize;

  // ── the token channel: one index probe per distinct cue token ────────────
  const searchTokens: string[] = [];
  const seenTok = new Set<string>();
  for (const tok of tokenize(input.text)) {
    if (tok.length < t.MIN_CUE_LENGTH || seenTok.has(tok)) continue;
    seenTok.add(tok);
    searchTokens.push(tok);
    if (searchTokens.length >= t.MAX_CUES * 3) break;
  }
  for (const tok of input.carried ?? []) {
    if (tok.length < t.MIN_CUE_LENGTH || seenTok.has(tok)) continue;
    seenTok.add(tok);
    searchTokens.push(tok);
  }

  // ── rarity FIRST, postings second ───────────────────────────────────────
  //
  // The order is the fix. This pass used to probe the index for every search
  // token and take `df = hits.length` — but `hits` is a top-`PER_CUE_FETCH`,
  // and a bounded top-K's length is `min(trueDf, K)`, never a document
  // frequency. On a 15,421-document index that made every word occurring in 24
  // or more memories measure as equally rare: `the` and `conversation` drew
  // `informativeness` 5.7 against a ceiling of 8.95 where their true
  // frequencies put them at 0-3. §9 G4's "informativeness weighting replaces
  // stop-lists" was therefore true on a fixture (where `trueDf` cannot reach K)
  // and false on the live store — the rule silently switched off as the store
  // grew. `store.docFrequency` counts instead of measuring a limit.
  //
  // Asking for rarity first also means the index is probed only for the tokens
  // that BECAME cues (at most `MAX_CUES`), rather than for every candidate
  // token (up to `MAX_CUES * 3`). Nothing downstream reads a non-cue's
  // postings, so that is an equivalence and strictly less work — it pays for
  // the df query several times over.
  const df = store.docFrequency(searchTokens);

  const cues = buildCues(
    {
      text: input.text,
      carried: input.carried ?? [],
      ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
      storeSize,
      df,
    },
    t,
  );

  /**
   * token -> (memoryId -> the token's LENGTH-NORMALIZED evidence in that
   * document). The store applies the normalization before its own
   * `ORDER BY … LIMIT`, so what arrives here is both scored and SELECTED
   * length-fairly; re-ranking a raw-tf top-24 in this file would have left the
   * long documents holding every slot (see `store/cache.ts#searchIndex`).
   */
  const postings = new Map<string, Map<string, number>>();
  const norm = {
    k1: t.CUE_TF_SATURATION,
    b: t.CUE_LENGTH_NORM,
    oneSided: t.CUE_LENGTH_ONE_SIDED,
  };
  for (const cue of cues) {
    if (postings.has(cue.token)) continue;
    const byDoc = new Map<string, number>();
    for (const h of store.search(cue.token, t.PER_CUE_FETCH, norm)) byDoc.set(h.id, h.score);
    postings.set(cue.token, byDoc);
  }

  const cueScore = new Map<string, number>();
  const matchCount = new Map<string, number>();
  const unambiguousMatch = new Set<string>();
  /** The single strongest cue each document received — the cap's yardstick. */
  const bestCue = new Map<string, number>();
  for (const cue of cues) {
    const byDoc = postings.get(cue.token);
    if (byDoc === undefined) continue;
    for (const [id, evidence] of byDoc) {
      // `evidence` already carries the tf saturation AND the length
      // normalization, applied by the index (`store/cache.ts#searchIndex`).
      // Applying `tfFactor` again here would saturate a saturated number.
      const add = cue.weight * evidence;
      if (add <= 0) continue;
      cueScore.set(id, (cueScore.get(id) ?? 0) + add);
      bestCue.set(id, Math.max(bestCue.get(id) ?? 0, add));
      matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
      if (!cue.ambiguous) unambiguousMatch.add(id);
    }
  }

  // ── the per-document ceiling ────────────────────────────────────────────
  // Length normalization damps how loudly ONE cue speaks for a long memory; it
  // does not stop a memory that mentions everything from being touched by
  // twenty cues at once. This is the second half of the same rule: a document's
  // cue evidence may reach `CUE_DOC_CAP` times its own strongest single cue and
  // no further. Three converging cues is corroboration; twenty is coverage, and
  // coverage is a property of the document rather than of the turn.
  //
  // It is applied HERE, to the lexical sum only — before the temporal channel
  // adds to the same map. A temporal cue is id-addressed and has no length, so
  // capping it would be capping the calendar.
  let capped = 0;
  if (t.CUE_DOC_CAP > 0 && Number.isFinite(t.CUE_DOC_CAP)) {
    for (const [id, sum] of cueScore) {
      const ceiling = (bestCue.get(id) ?? 0) * t.CUE_DOC_CAP;
      if (sum > ceiling) {
        cueScore.set(id, ceiling);
        capped += 1;
      }
    }
  }

  // ── the temporal channel: the same map, so one activation number ────────
  // A temporal cue can CREATE a candidate (that is what a cue is) and is counted
  // as cue by `cueFraction` below. Its ceiling is applied when the candidate is
  // assembled, not here — this stage scores, it does not decide tiers.
  //
  // The weight arrives in CUE UNITS and is converted here, for the same reason
  // the gate's floors are: `prospective.CUE_STRENGTH` is 0.5 on v1's normalized
  // scale, and v2's cue channel is a sum of idf x evidence whose size grows with
  // the store. Left absolute, a temporal cue would be worth 0.23 of a
  // maximally-rare word on a seventeen-memory store and 0.056 of one on a
  // fifteen-thousand-memory store — the calendar going quiet as the owner
  // remembers more, which is the exact shape of scar §2.8 in the other
  // direction. Converted, `CUE_STRENGTH` finally means what its comment says:
  // *one more cue, like the user typing "Portland"* — half of one, at full ramp.
  const temporalScore = new Map<string, number>();
  const cueUnit = informativeness(1, storeSize);
  for (const t0 of input.temporal ?? []) {
    if (!(t0.weight > 0)) continue;
    const w = t0.weight * cueUnit;
    temporalScore.set(t0.id, (temporalScore.get(t0.id) ?? 0) + w);
    cueScore.set(t0.id, (cueScore.get(t0.id) ?? 0) + w);
  }

  // ── the embedding channel: an INPUT, never a fetched one ────────────────
  //
  // TWO ways in, one scoring rule. `vector` is the caller's own embedding and
  // this pass ranks it (the deliberate ask, which has no latency budget);
  // `hits` is a ranking somebody else already did — the detached worker, one
  // turn ago (`session.ts`, the lagged semantic cue), because the RANK is what
  // costs 600-1000 ms on a live-sized index, not the arithmetic below. Supplied
  // hits win: a caller that has both meant the resolved one.
  const semScore = new Map<string, number>();
  let semanticDegraded = false;
  const ranked: readonly Hit[] | null =
    input.hits !== undefined
      ? input.hits
      : input.vector !== undefined && input.vector.length > 0
        ? store.nearestTo(input.vector, t.SEMANTIC_TOP_M)
        : null;
  // PER-EMBEDDER, PER-PATH (2026-09-23): the floor and weight are chosen for
  // the model box 3 RECORDS — read fresh from the file at every activation
  // (`Store.rankingIdentity`) — on the path this ranking came by: a static
  // table's cosines sit lower and closer together than Voyage's, and a lagged
  // cue can be about the previous subject (`tunables.ts`). A lagged row ranked
  // under another model never reaches here: `loadSessionSemantic` answers
  // `other-model` for it.
  const path: SemanticPath = input.hits !== undefined ? "lagged" : "inline";
  const identity = recordedIdentity(store);
  const tuning: SemanticTuning = semanticTuning(t, identity, path);
  if (ranked !== null) {
    if (ranked.length === 0) semanticDegraded = true;
    const floor = tuning.floor;
    for (const h of ranked.slice(0, t.SEMANTIC_TOP_M)) {
      if (h.score < floor) continue;
      const scaled = floor >= 1 ? h.score : (h.score - floor) / (1 - floor);
      semScore.set(h.id, tuning.weight * scaled);
    }
  }

  // ── assemble: only live, resolvable, non-removed memory ─────────────────
  const denied = new Set(store.deniedIds());
  const ids = new Set<string>([...cueScore.keys(), ...semScore.keys()]);

  // ── the hop channel: modulate only (SEAMS item L) ───────────────────────
  // The seeds are the candidates the CONVERSATION reached; a contribution to
  // anything outside that set is dropped right here, so a hop can never be the
  // reason a memory is fetched at all.
  // The SEEDS are the CUED candidates (`associate/INTERFACE-GAPS.md` §1's own
  // wording). A seed receives no contribution of its own — a round trip a→b→a
  // would hand a memory its own activation back as new evidence — so what the
  // graph can actually raise is a candidate the OTHER channels reached: a
  // semantic hit, or a temporal one, that the conversation's own words did not.
  const hopScore = new Map<string, number>();
  if (input.spread !== undefined && cueScore.size > 0) {
    const seeds = [...cueScore.entries()].map(([id, activation]) => ({ id, activation }));
    for (const c of input.spread(seeds, input.day).contributions) {
      // Dropped unless it is ALREADY a candidate. This line is hard gate (a):
      // a hop is not a cue, and an uncued memory is dark whatever reached it.
      if (!ids.has(c.id) || !(c.activation > 0)) continue;
      hopScore.set(c.id, (hopScore.get(c.id) ?? 0) + c.activation);
    }
  }

  // Two passes: SCORE from box 2, then READ the survivors' prose.
  //
  // Every number in the sort key — cue, semantic, arrival, hops — is available
  // from the operational row alone. The prose body is not in that row, and is
  // needed only for the confidentiality class and for whatever the renderer
  // prints. So the ranking happens first and the FILE READS happen only for the
  // candidates that survive `maxCandidates`.
  //
  // This is an equivalence, not a heuristic: same candidates, same order, same
  // `skipped` count. It is here because length normalization widened the union
  // of the token index's hits by an order of magnitude — the old scorer's nine
  // hubs occupied most of every cue's top-`PER_CUE_FETCH`, so the union was
  // small by ACCIDENT, and the accident was the bug. Reading a prose file for
  // each of ~1,000 ids and discarding all but 24 measured ~600 ms of a 1200 ms
  // budget on the live store; it is now 24 reads whatever the union's width.
  interface Scored {
    readonly id: string;
    readonly physics: MemoryPhysics;
    readonly strength: number;
    readonly cue: number;
    readonly temporal: number;
    readonly semantic: number;
    readonly arrival: number;
    readonly hops: number;
    readonly activation: number;
  }
  const scored: Scored[] = [];
  let skipped = 0;
  for (const id of ids) {
    if (denied.has(id)) {
      skipped += 1;
      continue;
    }
    const row = store.row(id);
    // Archive is a state, not a deletion: it keeps its id and simply never
    // surfaces (§4.2 G3). A superseded head forwards; the successor is reached
    // on its own merits, never by dragging the old id along.
    if (row === undefined || row.archived === 1 || row.superseded_by !== null) {
      skipped += 1;
      continue;
    }
    // The self page, which is delivered at wake and never here (`isSelfPage`).
    // The prose read is gated on the row's own columns, so only a SCHEMA row of
    // the self kind pays for it — the page, the identity core, and the handful
    // of beliefs held about the self.
    if (row.type === "schema" && row.kind === "self" && isPageRow(store, id)) {
      skipped += 1;
      continue;
    }
    // The per-directory handoff (E1), for the page's reason and one of its own:
    // it is already delivered as a pointer at the wake of the directory it
    // belongs to, and it has no project scope of its own that a search could
    // honour — so left in the pool it would surface one directory's working
    // context inside another's turn. Gated on the row's own columns, as above,
    // so only a SCHEMA row of the place kind pays for the prose read.
    if (row.type === "schema" && row.kind === "place" && isHandoffRow(store, id)) {
      skipped += 1;
      continue;
    }
    const physics = rowToPhysics(row);
    const cue = cueScore.get(id) ?? 0;
    const temporal = temporalScore.get(id) ?? 0;
    const semantic = semScore.get(id) ?? 0;
    const s = strength(physics, input.day);
    const arrival = cue + semantic > 0 ? t.ARRIVAL_WEIGHT * s : 0;
    const hops = cue + semantic > 0 ? hopScore.get(id) ?? 0 : 0;
    scored.push({
      id,
      physics,
      strength: s,
      cue,
      temporal,
      semantic,
      arrival,
      hops,
      activation: cue + semantic + arrival + hops,
    });
  }
  scored.sort((a, b) => b.activation - a.activation || (a.id < b.id ? -1 : 1));

  const candidates: Candidate[] = [];
  for (const c of scored.slice(0, input.maxCandidates)) {
    const { id, physics, cue, temporal, semantic, arrival, hops, activation } = c;
    // `readProse` is `read().doc`, so taking the whole read costs nothing and
    // brings the confidentiality flag with it instead of re-deriving it.
    const stored = store.read(id);
    const doc = stored.doc;
    candidates.push({
      id,
      kind: physics.kind,
      doc,
      physics,
      strength: c.strength,
      sal: gatedSal(physics, input.selfFelt),
      cue,
      temporal,
      semantic,
      arrival,
      hops,
      activation,
      // Hops are in the DENOMINATOR only: they can raise a candidate's standing
      // and can never buy it the loud tier.
      cueFraction: activation > 0 ? (cue + semantic) / activation : 0,
      matched: matchCount.get(id) ?? 0,
      // A temporal cue is id-addressed: no handle is involved, so nothing about
      // it is ambiguous, and an unambiguous cue trains. Without this clause a
      // temporal-only surface would be refused as "ambiguous-handle-trains-
      // nothing" — a true refusal under a false name (scar §2.4).
      trains: unambiguousMatch.has(id) || semantic > 0 || temporal > 0,
      // §12 G5: temporal ALONE reaches the footnote tier at most.
      maxTier: temporal > 0 && cue - temporal <= 0 && semantic <= 0 ? "footnoted" : "surfaced",
      confidential: stored.confidential,
    });
  }

  return {
    cues,
    candidates,
    storeSize,
    skipped,
    semanticDegraded,
    capped,
    semantic: ranked === null ? null : { identity, path, floor: tuning.floor, weight: tuning.weight },
  };
}

/**
 * The identity box 3 records for its vectors, read FRESH from the file at every
 * activation (`Store.rankingIdentity`: one primary-key read) — the tag, when
 * this handle may rank against it; null when it may not (a hold, a newer
 * build's cache, a file now another identity's) or when nothing is recorded.
 * Null means the defaults, and in the refused cases the ranking is empty anyway.
 *
 * Fresh, not the handle's open-time verdict (keyless/recall-tune review MINOR 2):
 * a handle whose open was `deferred` by a lost lock, or one with no identity of
 * its own, still ranks real vectors — and gets the calibration of the model
 * that wrote them.
 */
export function recordedIdentity(store: Store): string | null {
  return store.rankingIdentity();
}
