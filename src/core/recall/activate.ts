/**
 * Activation — from cues to a scored candidate set.
 *
 * Three channels, and the difference between them is the whole design:
 *
 *   **cue** (lexical) and **semantic** (embedding) are the CONVERSATION. Either
 *   one makes a memory a candidate at all.
 *   **arrival** (base-level strength) is RECENCY. It modulates a candidate that
 *   the conversation already reached, and it can never create one — which is how
 *   hard gate (a), *an uncued memory is dark whatever its salience*, is enforced
 *   structurally rather than checked: an uncued memory is not fetched, so its
 *   salience arithmetic is never evaluated (§9 G7a).
 *
 * The candidate set is exactly the union of the token index's hits and the vector
 * index's hits. NO MODEL CALL: the turn's vector is an INPUT. Its absence degrades
 * to lexical-only, which is guarantee 1's precise v2 form — the ambient path may
 * consult an embedding, never a generative model, and must degrade rather than
 * fail.
 */
import type { Kind, MemoryPhysics } from "../types.js";
import { sal, strength } from "../physics/index.js";
import type { ProseDoc, Store } from "../store/index.js";
import { tokenize } from "../store/index.js";
import { buildCues, tfFactor } from "./cues.js";
import type { Cue } from "./cues.js";
import type { RecallTunables } from "./tunables.js";

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
  readonly semantic: number;
  readonly arrival: number;
  readonly activation: number;
  /** (cue + semantic) / activation — hard gate (c)'s input. */
  readonly cueFraction: number;
  readonly matched: number;
  /** Every matching cue was an ambiguous handle and nothing corroborated it:
   *  it fires at reduced weight (already applied) and TRAINS NOTHING. */
  readonly trains: boolean;
  readonly confidential: boolean;
}

export interface ActivationInput {
  readonly text: string;
  readonly vector?: readonly number[] | undefined;
  readonly carried?: readonly string[] | undefined;
  readonly aliases?: ReadonlyMap<string, readonly string[]> | undefined;
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
}

/** A memory's confidentiality class, read from the prose payload's `meta`. */
export function isConfidential(doc: ProseDoc): boolean {
  const m = doc.meta as Record<string, unknown>;
  if (m["confidential"] === true) return true;
  const klass = m["confidentiality"];
  return typeof klass === "string" && klass !== "" && klass !== "open" && klass !== "normal";
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

  const df = new Map<string, number>();
  /** token -> (memoryId -> term frequency in that document). */
  const postings = new Map<string, Map<string, number>>();
  for (const tok of searchTokens) {
    const hits = store.search(tok, t.PER_CUE_FETCH);
    df.set(tok, hits.length);
    const byDoc = new Map<string, number>();
    for (const h of hits) byDoc.set(h.id, h.score);
    postings.set(tok, byDoc);
  }

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

  const cueScore = new Map<string, number>();
  const matchCount = new Map<string, number>();
  const unambiguousMatch = new Set<string>();
  for (const cue of cues) {
    const byDoc = postings.get(cue.token);
    if (byDoc === undefined) continue;
    for (const [id, tf] of byDoc) {
      const add = cue.weight * tfFactor(tf);
      if (add <= 0) continue;
      cueScore.set(id, (cueScore.get(id) ?? 0) + add);
      matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
      if (!cue.ambiguous) unambiguousMatch.add(id);
    }
  }

  // ── the embedding channel: an INPUT vector, never a fetched one ──────────
  const semScore = new Map<string, number>();
  let semanticDegraded = false;
  if (input.vector !== undefined && input.vector.length > 0) {
    const hits = store.nearestTo(input.vector, t.SEMANTIC_TOP_M);
    if (hits.length === 0) semanticDegraded = true;
    const floor = t.SEMANTIC_SEED_FLOOR;
    for (const h of hits) {
      if (h.score < floor) continue;
      const scaled = floor >= 1 ? h.score : (h.score - floor) / (1 - floor);
      semScore.set(h.id, t.SEMANTIC_WEIGHT * scaled);
    }
  }

  // ── assemble: only live, resolvable, non-removed memory ─────────────────
  const denied = new Set(store.deniedIds());
  const ids = new Set<string>([...cueScore.keys(), ...semScore.keys()]);
  const candidates: Candidate[] = [];
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
    const read = store.read(id);
    const cue = cueScore.get(id) ?? 0;
    const semantic = semScore.get(id) ?? 0;
    const s = strength(read.physics, input.day);
    const arrival = cue + semantic > 0 ? t.ARRIVAL_WEIGHT * s : 0;
    const activation = cue + semantic + arrival;
    candidates.push({
      id,
      kind: read.physics.kind,
      doc: read.doc,
      physics: read.physics,
      strength: s,
      sal: gatedSal(read.physics, input.selfFelt),
      cue,
      semantic,
      arrival,
      activation,
      cueFraction: activation > 0 ? (cue + semantic) / activation : 0,
      matched: matchCount.get(id) ?? 0,
      trains: unambiguousMatch.has(id) || semantic > 0,
      confidential: isConfidential(read.doc),
    });
  }

  candidates.sort((a, b) => b.activation - a.activation || (a.id < b.id ? -1 : 1));
  return {
    cues,
    candidates: candidates.slice(0, input.maxCandidates),
    storeSize,
    skipped,
    semanticDegraded,
  };
}
