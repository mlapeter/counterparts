/**
 * `tools/migrate/report.ts` — the account of what happened (CONTRACT §5 G10).
 *
 * A migration report is the only thing standing between "everything came across"
 * and "everything I noticed came across". So it renders four things a summary
 * usually leaves out: what was SKIPPED and why, which APPROXIMATIONS were applied
 * and how often, which FIELDS were dropped, and whether the source is
 * byte-identical to how it was found.
 *
 * CONTENT-BY-REFERENCE THROUGHOUT: ids, source paths, counts, families, reasons.
 * No body text, no statement, no alias, no credential and no hash of one — a
 * low-entropy credential's hash is the leak wearing a disguise (store §16 G9).
 */
import type { MigrationReport } from "./types.js";

function line(label: string, value: string | number): string {
  return `${label.padEnd(26)} ${value}`;
}

function countsBlock(report: MigrationReport): string[] {
  const rows: string[] = ["", "COUNTS                     read  imported  skipped"];
  for (const [name, c] of Object.entries(report.counts)) {
    rows.push(
      `  ${name.padEnd(24)} ${String(c.read).padStart(4)}  ${String(c.imported).padStart(8)}  ${String(c.skipped).padStart(7)}`,
    );
  }
  return rows;
}

export function renderReport(report: MigrationReport): string {
  const out: string[] = [];
  out.push(`counterparts migrate — ${report.mode.toUpperCase()}`);
  out.push(line("source", report.source));
  out.push(line("target", report.target));
  out.push(line("lived day (v1 clock)", report.livedDay));
  out.push(...countsBlock(report));

  out.push("", "GATE (families and counts only — never content)");
  out.push(line("  bodies scanned", report.gate.bodiesScanned));
  out.push(line("  bodies redacted", report.gate.bodiesRedacted));
  out.push(line("  bodies refused", report.gate.bodiesRefused));
  out.push(line("  names dropped", report.gate.namesDropped));
  const families = Object.entries(report.gate.firesByFamily).sort();
  out.push(
    families.length === 0
      ? "  fires by family:         none"
      : `  fires by family:         ${families.map(([f, n]) => `${f}=${n}`).join(", ")}`,
  );
  const refusals = Object.entries(report.gate.refusalsByReason).sort();
  if (refusals.length > 0) {
    out.push(`  refusals by reason:      ${refusals.map(([r, n]) => `${r}=${n}`).join(", ")}`);
  }

  if (report.writes !== null) {
    out.push("", "WRITES");
    for (const [name, n] of Object.entries(report.writes)) out.push(line(`  ${name}`, n));
  } else {
    out.push("", "WRITES                     none — dry run (pass --apply to write)");
  }

  out.push("", "APPROXIMATIONS APPLIED");
  if (report.approximations.length === 0) out.push("  none");
  for (const a of report.approximations) {
    out.push(`  ${a.name} x${a.applied}`);
    out.push(`      ${a.note}`);
  }

  const dropped = Object.entries(report.dropped).sort();
  out.push("", "FIELDS DROPPED (no v2 home)");
  out.push(dropped.length === 0 ? "  none" : `  ${dropped.map(([f, n]) => `${f}=${n}`).join(", ")}`);
  const types = Object.entries(report.edgeTypes).sort();
  if (types.length > 0) {
    out.push(`  edge types seen:         ${types.map(([t, n]) => `${t}=${n}`).join(", ")}`);
  }

  out.push("", `SKIPPED (${report.skipped.length}) — nothing is dropped silently`);
  for (const s of report.skipped) out.push(`  [${s.what}] ${s.ref}: ${s.reason}`);

  if (report.malformed.length > 0) {
    out.push("", `MALFORMED SOURCE FILES (${report.malformed.length}) — reported, never guessed at`);
    for (const m of report.malformed) out.push(`  ${m.relPath}: ${m.reason}`);
  }

  out.push("", "SOURCE (read-only, proved by content hash)");
  out.push(line("  files hashed", report.source_readonly.files));
  out.push(line("  byte-identical after", String(report.source_readonly.identical)));
  for (const path of report.source_readonly.changed) out.push(`  CHANGED: ${path}`);

  if (report.declared.length > 0) {
    out.push("", "DECLARED — what the target cannot recompute on its own");
    for (const d of report.declared) out.push(`  ${d}`);
  }
  return out.join("\n");
}
