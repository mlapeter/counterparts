/**
 * The owner-removal seam — DECLARED HERE, IMPLEMENTED ELSEWHERE.
 *
 * This file is types only. It exports no function, because a module that exported
 * one would be exactly the thing the contract forbids: the store's public surface
 * carrying a way to destroy a memory (§5 G2, §16 G1 — "enforced by absence").
 *
 * How the pieces fit when `adapters/cli/` builds the other half:
 *
 *   1. The CLI (an owner-only, non-model-reachable path) implements
 *      `OwnerRemovalPort`. It is the ONLY implementor; a caller-universality test
 *      in `cli/` pins who may import it (§16 G2).
 *   2. Before anything moves, the CLI calls `Store.appendRemovalRecord({stage:
 *      "requested"})`. A failed append is never reported as success — if the record
 *      cannot be written, nothing moves (§16 G10).
 *   3. Everything that must READ the doomed content happens before any copy is
 *      chased (§16 G13): the contamination scan returns ids only.
 *   4. Then `stage: "dark"` is appended. From that moment the store's deny-list
 *      refuses to load the id, at read and at rebuild — a restored backup or a
 *      stray copy cannot quietly resurrect it, and the stray is skipped and
 *      logged, never deleted (§16 G12).
 *   5. Copies are chased — prose, versions, edges, prospective rows, box 3 — and
 *      `stage: "chased"` then `stage: "complete"` are appended. Every crash point
 *      leaves the memory either fully alive, or dark AND recorded (§16 G11).
 *
 * Note kept from inside v1's released ceremony (contract §4): the cooling-off
 * period was deliberately WALL-CLOCK, not active days — a week of not using the
 * machine must still be a week of second thoughts.
 */
import type { RemovalNote } from "./index.js";

export interface OwnerRemovalRequest {
  /** Memory-bearing roots only. The archive, backups, the graph, and the removal
   *  record itself are never nameable targets — they are chased as copies (§16 G16). */
  targetId: string;
  actor: "owner";
  reason: string;
  /** Wall-clock ms, not lived days. */
  requestedAt: number;
}

export interface OwnerRemovalOutcome {
  /** Ids only — printing matches would re-leak what is being erased (§16 G15). */
  chased: string[];
  unchased: string[];
  notes: RemovalNote[];
}

export interface OwnerRemovalPort {
  (request: OwnerRemovalRequest): OwnerRemovalOutcome;
}
