/**
 * `tools/parallel/surface.ts` — G12's carry-forward hash, in one place.
 *
 * CONTRACT §5 G12: "the machine-scored surface set is the hash of the per-turn
 * surfacing decision records' FIELDS (tier counts, affect flags, ids with
 * salience, budget, reason — precondition 9)". `surfaceSetFields()` in
 * `src/core/counterpart.ts` is that field list, exported for exactly this use
 * (replay INTERFACE-GAPS §3 records the export as G12's answer), and hashing it
 * is the only way a mid-run change can be classed as telemetry-only rather than
 * argued about afterwards.
 *
 * WHY IMPORTING IT IS NOT A BREACH OF THE INDEPENDENT-SCORER RULE. [v1] §17.2 /
 * replay G5 forbid the scorer implementing its arithmetic by calling the system
 * under test — a shared bug must not grade itself. This imports a list of FIELD
 * NAMES, not a computation: there is no arithmetic here to share a bug with, and
 * the alternative — a second copy of the field list in this tool — is strictly
 * worse, because the hash's whole job is to notice when THAT list moves.
 *
 * The hash is recorded into `run.json` on every daily write and re-derived by
 * the preflight, so a build whose surface set has moved shows up as a mismatch
 * rather than as a number nobody compared.
 */
import { createHash } from "node:crypto";

import { GATE_CHUNK_FIELDS, surfaceSetFields } from "../../src/core/counterpart.js";
import { BAND_TRANSITION_FIELDS } from "../../src/core/sleep/index.js";

/** The three components, in a fixed order, each named so a mismatch says which moved. */
export function surfaceSetComponents(): readonly { name: string; fields: readonly string[] }[] {
  return [
    { name: "recall.decision", fields: surfaceSetFields() },
    { name: "gate.chunk", fields: GATE_CHUNK_FIELDS },
    { name: "band.transition", fields: BAND_TRANSITION_FIELDS },
  ];
}

/**
 * A short, stable digest of the surface set's field list.
 *
 * The fields are hashed IN THE ORDER `surfaceSetFields()` returns them, because
 * that order is itself the record's shape: a reordering changes what a
 * positional reader sees, and G12 wants "provably identical", not "same set".
 */
export function surfaceSetHash(): string {
  // G12 names THREE components — the surfacing decision's fields PLUS the
  // gate-record and band-transition fields (PR-8 delta N6: hashing only the
  // first would class a change to either of the others as telemetry-only).
  const h = createHash("sha256");
  for (const c of surfaceSetComponents()) h.update(`${c.name}\n${c.fields.join("\n")}\n\n`);
  return h.digest("hex").slice(0, 16);
}
