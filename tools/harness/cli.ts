#!/usr/bin/env bun
/**
 * bun tools/harness/cli.ts replay [--source <snapshot copy>] [--returns derived|recorded]
 *                                 [--through-day N] [--early-days N] [--keep] [--json <out>]
 *
 * Prints the run record as numbers; `--json` also writes it whole. Ids, counts
 * and days only, never memory text. See tools/harness/README.md.
 */
import { writeFileSync } from "node:fs";

import { runPhysicsReplay } from "./replay.js";
import type { RunRecord } from "./replay.js";
import { DEFAULT_CORPUS } from "./source.js";

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function render(r: RunRecord): string {
  const out: string[] = [];
  const s = r.source;
  out.push(`physics-only replay · source v${String(s.schemaVersion)}, day ${String(s.livedDay)}, ${String(s.memories)} memories (${String(s.chapterCopiesSkipped)} chapter copies left out) · returns ${r.mode.returns} · through day ${String(r.mode.throughDay)} · ${(r.elapsedMs / 1000).toFixed(1)}s`);
  if (s.eventsFrom > 0) out.push(`  ! the source's event log starts at day ${String(s.eventsFrom)}: uses before it are not in the record`);
  const g = r.gaps;
  out.push(`gaps: credit ids cut ${String(g.creditIdsCut)} · acts on unknown ids ${String(g.actsOnUnknownIds)} · uses before birth ${String(g.usesBeforeBirth)} · bodies from current row ${String(g.bodiesFromCurrentRow)} · merges undated ${String(g.mergesUndated)} · clock mismatches ${String(g.clockMismatches)}`);
  const refused = Object.entries(g.refused);
  if (refused.length > 0) out.push(`refused: ${refused.map(([k, n]) => `${k} ${String(n)}`).join(" · ")}`);
  out.push("");
  out.push("day  date        alive  core  born  uses fed/cred/ret  night fed/cnt  settles  promoted");
  for (const d of r.days) {
    out.push(
      [
        String(d.day).padStart(3),
        d.date,
        String(d.alive).padStart(6),
        String(d.identity).padStart(5),
        String(d.births).padStart(5),
        `${String(d.uses.fed)}/${String(d.uses.credited)}/${String(d.uses.returns)}`.padStart(17),
        `${String(d.nightReturns.fed)}/${String(d.nightReturns.counted)}`.padStart(14),
        `${String(d.settles.ok)}/${String(d.settles.fed)}`.padStart(8),
        String(d.promoted).padStart(9),
      ].join("  ") + (d.budgetExhausted.length > 0 ? `  budget: ${d.budgetExhausted.join(",")}` : ""),
    );
  }
  out.push("");
  out.push(`early core (promotions through day ${String((r.days[0]?.day ?? 0) + 10)}):`);
  out.push("id                 day  lane  born  rank  returns/days/sessions  pool  recorded");
  for (const e of r.early) {
    out.push(
      [
        e.id.padEnd(17),
        String(e.day).padStart(4),
        (e.lane ?? "-").padStart(5),
        String(e.birthDay).padStart(5),
        String(e.birthRank).padStart(5),
        `${String(e.returns)}/${String(e.returnDays)}/${String(e.returnSessions)}`.padStart(22),
        String(e.pool).padStart(5),
        (e.recordedDay === null ? "no" : `day ${String(e.recordedDay)}`).padStart(9),
      ].join("  "),
    );
  }
  if (r.early.length === 0) out.push("  (none)");
  const f = r.fidelity;
  if (f !== null) {
    out.push("");
    out.push("fidelity against the record:");
    out.push(`  uses: recorded ${String(f.uses.recorded)}, replayed ${String(f.uses.replayed)}; per memory exact ${String(f.uses.exact)}, short ${String(f.uses.short)}, over ${String(f.uses.over)} of ${String(f.uses.memories)}`);
    out.push(`  awake returns (id@day): recorded ${String(f.awakeReturns.recorded)}, replayed ${String(f.awakeReturns.replayed)}, matched ${String(f.awakeReturns.matched)}`);
    out.push(`  promotions: recorded ${String(f.promotions.recorded)}, replayed ${String(f.promotions.replayed)}, matched ${String(f.promotions.matched)} (same day ${String(f.promotions.sameDay)})`);
    out.push(`  archived: recorded ${String(f.archived.recorded)}, replayed ${String(f.archived.replayed)}, both ${String(f.archived.both)}`);
    for (const [from, to] of Object.entries(f.bands)) {
      out.push(`  band ${from} → ${Object.entries(to).map(([b, n]) => `${b} ${String(n)}`).join(", ")}`);
    }
  }
  if (r.keptAt !== null) out.push(`\nkept: ${r.keptAt}`);
  return out.join("\n");
}

async function main(argv: readonly string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd !== "replay") {
    process.stderr.write("usage: bun tools/harness/cli.ts replay [--source <copy>] [--returns derived|recorded] [--through-day N] [--early-days N] [--keep] [--json <out>]\n");
    return 2;
  }
  const returns = flag(args, "--returns") ?? "derived";
  if (returns !== "derived" && returns !== "recorded") throw new Error(`--returns must be derived or recorded, not ${returns}`);
  const through = flag(args, "--through-day");
  const early = flag(args, "--early-days");
  const record = await runPhysicsReplay({
    source: flag(args, "--source") ?? DEFAULT_CORPUS,
    returns,
    ...(through === undefined ? {} : { throughDay: Number(through) }),
    ...(early === undefined ? {} : { earlyDays: Number(early) }),
    keep: args.includes("--keep"),
    onDay: (d, total) => process.stderr.write(`\rday ${String(d)}/${String(total)}`),
  });
  process.stderr.write("\n");
  process.stdout.write(render(record) + "\n");
  const json = flag(args, "--json");
  if (json !== undefined) writeFileSync(json, JSON.stringify(record, null, 2));
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
