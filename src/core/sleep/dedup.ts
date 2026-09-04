/**
 * The dedup pass — physics' verdicts over cache-provided candidates.
 *
 * The rule that matters most is a REFUSAL: **a memory that declares `updates:`
 * is never merged into its target** (`physics/` §5.7, CONTRACT §5 G9). A
 * refutation is topically as close to the belief it refutes as anything in the
 * store; merging it would credit a use to that belief and reinforce it. That is
 * scar §2.10's one-way ratchet, rebuilt by accident. Physics checks the
 * declaration FIRST, before hash and before cosine, and this phase never
 * second-guesses it.
 *
 * **Candidates are the cache's job, not physics'.** The shipped default is
 * lexical and free: identical content hashes, read from box 2. An
 * embedding-backed source (cosine over box 3) is INJECTED, is permitted
 * arithmetic rather than a generative call (§4), and is isolated per call — if
 * it throws, the pass degrades to hash-only and says so, rather than failing the
 * cycle (scar E1). Ambiguous near-duplicates are left alone (§5.7, owner
 * decision): accepted rent, paid for zero substrate confabulation.
 *
 * The same refusal has a second half, found 2026-09-04 on the first store that
 * ever crossed the pressure bar: **a revision's successor and the challenger it
 * was minted from are never merged into each other, in either direction**
 * (`revisionSuccessorPair` below). The declaration guard cannot reach it —
 * that declaration names the PREDECESSOR — and the two bodies are identical by
 * construction, so the merge fired on the revision's own evening and the
 * revised belief stopped being a belief.
 *
 * **A merge is `uses(original) += 1` and the duplicate ARCHIVES.** Both halves
 * are load-bearing. Without the credit the merge is a deletion; without the
 * exit the same pair is found again tomorrow and credited again — a uses ratchet
 * and a direct breach of the replay-idempotence guarantee (§5 G3). Archive, not
 * delete: the duplicate keeps its prose and its id.
 */

import { dedupVerdict } from "../physics/index.js";
import type { DedupReason } from "../physics/index.js";
import { rowToPhysics } from "../store/operational.js";
import { hashText } from "../store/prose.js";
import { ACCOMMODATION_SOURCE, MERGE_ARCHIVE_REASON, MERGE_RECORD_PREFIX } from "./tunables.js";
import type { MergeRecord, PhaseCtx, PhaseOutcome, SleepStore } from "./types.js";
import { countSkip, emptyOutcome, isJournal } from "./types.js";

export interface DedupPair {
  readonly candidateId: string;
  readonly originalId: string;
  readonly sameContentHash?: boolean;
  /** cos(v(candidate), v(original)); null when no vector exists. */
  readonly cosine?: number | null;
}

export interface DedupCandidateInput {
  readonly store: SleepStore;
  readonly day: number;
  /** Live (non-archived, non-removed) ids, in store order. */
  readonly liveIds: readonly string[];
}

export type DedupCandidateSource = (input: DedupCandidateInput) => readonly DedupPair[];

export interface DedupResult extends PhaseOutcome {
  readonly merged: readonly MergeRecord[];
  readonly leftAlone: Readonly<Record<string, number>>;
  /** True when the injected candidate source failed and the pass fell back. */
  readonly degradedToLexical: boolean;
}

export function mergeRecordKey(id: string): string {
  return `${MERGE_RECORD_PREFIX}${id}`;
}

/**
 * The shipped candidate source: identical INTERPRETATIONS, hashed here.
 *
 * Note what is deliberately not used: `memories.content_hash` addresses the whole
 * serialized prose document, id and frontmatter included, so two distinct
 * memories can never share one — it is a change detector, not a duplicate
 * detector. The duplicate question is about the body, which is the memory
 * (`store/prose.ts`: "The interpretation. This *is* the memory").
 *
 * The hash is computed in memory and never recorded: prune records are
 * content-by-reference and carry no hash at all (scar §2.20).
 *
 * The ORIGINAL is the earliest-born member of a group (ties broken by id, so the
 * choice is deterministic and a replay picks the same original).
 */
export function contentHashCandidates(input: DedupCandidateInput): DedupPair[] {
  const groups = new Map<string, { id: string; birthDay: number }[]>();
  for (const id of input.liveIds) {
    const row = input.store.row(id);
    if (row === undefined) continue;
    let bodyHash: string;
    try {
      bodyHash = hashText(input.store.read(id).doc.body);
    } catch {
      continue;
    }
    const list = groups.get(bodyHash) ?? [];
    list.push({ id, birthDay: row.birth_day });
    groups.set(bodyHash, list);
  }
  const pairs: DedupPair[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.birthDay - b.birthDay || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const original = members[0];
    if (original === undefined) continue;
    for (const dup of members.slice(1)) {
      pairs.push({ candidateId: dup.id, originalId: original.id, sameContentHash: true });
    }
  }
  return pairs;
}

/**
 * The author's `updates:` declaration, read from canonical prose meta. There is
 * no inferred-revision path: if the writer did not declare it, it is not one
 * (`physics/` guarantee 7). See INTERFACE-GAPS.md §4 — the minting seam must
 * actually persist this field for the refusal to have anything to read.
 */
export function declaredUpdates(store: SleepStore, id: string): string | null {
  try {
    const value = store.read(id).doc.meta["updates"];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * The declaration's OTHER half, read off the row instead of the prose.
 *
 * A revision mints its successor with the challenger's own words — the winning
 * statement IS the new belief (`schemas/` §5.6) — so the successor and the
 * challenger share a body BY CONSTRUCTION, exactly the way an ingested memory
 * shares one with its episode. `declaredUpdates` cannot see it: that
 * declaration names the PREDECESSOR, and the successor has a fresh id. Left
 * alone, the tie-break (birth day, then id — and `mem_` sorts before `sch_`)
 * archived the successor into the challenger on the revision's own evening, and
 * the revised belief stopped being a belief. Found 2026-09-04, the first store
 * that ever crossed the pressure bar.
 *
 * Two columns say it, and no prose read is needed: `source` is
 * `"accommodation"` — written at exactly two sites, both of them supersedes
 * under pressure (`schemas/index.ts`, `revision.ts`'s identity arm) — and
 * `origin_ref` is the challenger the successor was made from. The relation is
 * checked BOTH WAYS, because which row the tie-break calls the original is an
 * accident of ids.
 */
export function revisionSuccessorPair(store: SleepStore, a: string, b: string): boolean {
  const successorOf = (id: string): string | null => {
    const row = store.row(id);
    if (row === undefined || row.source !== ACCOMMODATION_SOURCE) return null;
    return row.origin_ref;
  };
  return successorOf(a) === b || successorOf(b) === a;
}

export function runDedup(ctx: PhaseCtx, source?: DedupCandidateSource): DedupResult {
  const out = emptyOutcome();
  out.skipped["already-archived"] = 0;
  out.skipped["self-pair"] = 0;
  const leftAlone: Record<string, number> = {};
  const merged: MergeRecord[] = [];
  let degradedToLexical = false;

  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const live = new Set<string>();
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || row.archived === 1 || denied.has(id)) continue;
    // NOT THE JOURNAL (`types.ts#isJournal`). The memory ingested from an
    // episode carries the episode's own prose, so the two share a content hash
    // BY CONSTRUCTION. Found 2026-09-04, the first time anything actually
    // ingested an episode: dedup merged the fresh memory into the journal at
    // the very boundary that minted it, leaving the episode with no live memory
    // and its idempotency key pointing at an archived row. A journal is not a
    // duplicate of the memory made from it, in either direction.
    if (isJournal(row)) continue;
    live.add(id);
  }
  const liveIds = [...live];
  const input: DedupCandidateInput = { store, day, liveIds };

  const pairs: DedupPair[] = contentHashCandidates(input);
  if (source !== undefined) {
    try {
      pairs.push(...source(input));
    } catch (err) {
      // Scar E1: an embedding lookup degrades to empty-and-logged, never throws
      // into the cycle. Lexical candidates already found still stand.
      degradedToLexical = true;
      ctx.event("sleep.dedup.degraded", undefined, { error: errorName(err) });
    }
  }

  let index = 0;
  for (const pair of pairs) {
    if (out.examined >= ctx.budget) {
      out.budgetExhausted = true;
      out.skippedForBudget = pairs.length - index;
      break;
    }
    index += 1;
    if (pair.candidateId === pair.originalId) {
      countSkip(out, "self-pair");
      continue;
    }
    if (!live.has(pair.candidateId) || !live.has(pair.originalId)) {
      countSkip(out, "already-archived");
      continue;
    }
    out.examined += 1;

    const verdict = dedupVerdict({
      originalId: pair.originalId,
      declaredUpdates: declaredUpdates(store, pair.candidateId),
      revisionSuccessorPair: revisionSuccessorPair(store, pair.candidateId, pair.originalId),
      ...(pair.sameContentHash !== undefined ? { sameContentHash: pair.sameContentHash } : {}),
      ...(pair.cosine !== undefined ? { cosine: pair.cosine } : {}),
    });
    if (verdict.verdict !== "merge" || verdict.effect === null) {
      leftAlone[verdict.reason] = (leftAlone[verdict.reason] ?? 0) + 1;
      // Mirrored into the phase report's skip map, prefixed, so every named
      // physics reason reaches the cycle report a reader actually looks at.
      countSkip(out, `left-alone:${verdict.reason}`);
      continue;
    }

    const record: MergeRecord = {
      event: "memory.merged",
      day,
      candidateId: pair.candidateId,
      originalId: pair.originalId,
      reason: verdict.reason,
      usesDelta: verdict.effect.usesDelta,
    };
    if (ctx.apply) {
      const originalRow = store.row(pair.originalId);
      if (originalRow === undefined) {
        countSkip(out, "already-archived");
        continue;
      }
      // Record first, exactly as the prune does: a merge nobody could account
      // for afterwards is a silent loss of a memory's separate existence.
      store.setMeta(mergeRecordKey(pair.candidateId), JSON.stringify(record));
      store.appendEvent?.({
        name: record.event,
        day,
        ref: pair.candidateId,
        dedupKey: mergeRecordKey(pair.candidateId),
        payload: { ...record },
      });
      const p = rowToPhysics(originalRow);
      // The WHOLE effect of a merge. Never a rewrite, never a blend (§5.7).
      store.updatePhysics(pair.originalId, { uses: p.uses + verdict.effect.usesDelta });
      store.archive(pair.candidateId, MERGE_ARCHIVE_REASON);
    }
    live.delete(pair.candidateId);
    merged.push(record);
    out.changed += 1;
    ctx.event("sleep.merged", pair.candidateId, {
      original: pair.originalId,
      reason: verdict.reason,
      usesDelta: verdict.effect.usesDelta,
      day,
    });
    ctx.step("item", { index, id: pair.candidateId });
  }

  return { ...out, merged, leftAlone, degradedToLexical };
}

function errorName(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return err instanceof Error ? err.name : "UNKNOWN";
}

export type { DedupReason };
