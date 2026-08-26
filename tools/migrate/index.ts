/**
 * `tools/migrate/` — the v1 -> v2 cutover.
 *
 * Read a bansai (v1) data directory, gate everything in it, and build a fresh
 * Counterparts (v2) store from it. Contract: `CONTRACT.md`. Shape:
 *
 *     read.ts    the READ-ONLY v1 reader, and the byte-identity proof
 *     gate.ts    the chokepoint — every body crosses the encode battery
 *     plan.ts    every decision, as a pure in-memory plan
 *     apply.ts   the writer, which decides nothing
 *     report.ts  the account: counts, gate fires, approximations, skips
 *
 * The order of the last three is the design. Planning is where the gate runs and
 * where every approximation is counted, so a DRY RUN — the default — is a real
 * dry run rather than a guess about one: it reports exactly what `--apply` would
 * do, and it never constructs a `Store` (which writes at open) or touches the
 * target path at all.
 */
import { assertSafeDataDir, isWithin } from "../../src/core/store/paths.js";
import { applyPlan } from "./apply.js";
import { manifest, manifestDiff, readV1 } from "./read.js";
import { planMigration } from "./plan.js";
import { renderReport } from "./report.js";
import type { MigrateTunables } from "./tunables.js";
import type { MigrationReport } from "./types.js";

export { readV1, manifest, manifestDiff, parseFrontmatter, parseItemLine } from "./read.js";
export { gateBody, scanName } from "./gate.js";
export { planMigration, docId, salienceOf, bandOf, precisionOf, Tally } from "./plan.js";
export type { MigrationPlan, PlannedDoc, PlannedElement, PlannedEntity } from "./plan.js";
export { applyPlan } from "./apply.js";
export { renderReport } from "./report.js";
export { TUNABLES, withTunables } from "./tunables.js";
export type { MigrateTunables } from "./tunables.js";
export * from "./types.js";

export class MigrateError extends Error {
  readonly code: string;
  constructor(code: string, detail: Record<string, unknown> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "MigrateError";
    this.code = code;
  }
}

export interface MigrateOptions {
  /** The v1 data directory. Read-only, and proved so (§5 G11). */
  source: string;
  /** The v2 data directory. Created only under `apply`. */
  target: string;
  /** FALSE by default: dry-run is the default and `--apply` is explicit (§5 G12). */
  apply?: boolean;
  tunables?: Partial<MigrateTunables>;
}

export function migrate(opts: MigrateOptions): MigrationReport {
  const source = opts.source;
  // The target is checked HERE as well as inside `Store`, because a dry run never
  // opens a store and must still refuse to aim at v1's live memory (scar §2.13).
  const target = assertSafeDataDir(opts.target);
  if (isWithin(source, target) || isWithin(target, source)) {
    throw new MigrateError("SOURCE_TARGET_OVERLAP", { source, target });
  }

  // Checked HERE rather than only in the writer, so a dry run refuses an unwired
  // tunable exactly as an apply does — otherwise "the dry run reports what apply
  // would do" would be false in the one case where apply throws.
  if (opts.tunables?.LEDGER_TO_PRESSURE === true) {
    throw new MigrateError("LEDGER_TO_PRESSURE_NOT_WIRED", {
      why: "the pressure mapping waits on the parallel run (CONTRACT §6)",
    });
  }

  const before = manifest(source);
  const v1 = readV1(source);
  const plan = planMigration(v1, opts.tunables === undefined ? {} : { tunables: opts.tunables });

  if (opts.apply === true) applyPlan(plan, target);

  const after = manifest(source);
  const changed = manifestDiff(before, after);
  const tally = plan.tally;

  return {
    mode: opts.apply === true ? "apply" : "dry-run",
    source,
    target,
    livedDay: plan.livedDay,
    counts: tally.counts,
    writes: opts.apply === true ? tally.writes : null,
    gate: tally.gate,
    approximations: tally.approximations(),
    skipped: tally.skipped,
    dropped: tally.dropped,
    edgeTypes: tally.edgeTypes,
    source_readonly: {
      files: Object.keys(before).length,
      before,
      after,
      identical: changed.length === 0,
      changed,
    },
    malformed: v1.malformed,
    declared: [
      "embeddings: not computed (no embedder is wired at import) — repair with Store.open({ embed }) then rebuildCache()",
      ...(v1.configPresent ? ["v1 config.json: read but NOT applied — v2 config is the owner's to set (CONTRACT §7)"] : []),
    ],
  };
}

export { renderReport as render };
export function migrateAndRender(opts: MigrateOptions): { report: MigrationReport; text: string } {
  const report = migrate(opts);
  return { report, text: renderReport(report) };
}
