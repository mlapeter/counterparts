#!/usr/bin/env bun
/**
 * `recall-bench` — hand-run. Same doctrine as `tools/parallel`'s bins: every
 * real path is a flag, the tool writes only the output directory it is given,
 * and there is NO default store — `--store-dir` is required and a live store is
 * refused by name.
 *
 *   bun tools/recall-bench/bin/bench.ts \
 *     --store-dir /tmp/store-copy --input /tmp/recall-bench-input.json \
 *     [--out /tmp/bench-out] [--sweep] [--b 0.75] [--k1 1] [--cap 3]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BEFORE, readBenchInput, renderReport, renderSweep, runBench } from "../index.js";
import type { BenchConfig, BenchReport } from "../types.js";

interface Args {
  storeDir: string | null;
  input: string | null;
  out: string | null;
  sweep: boolean;
  b: number;
  k1: number;
  cap: number;
}

function usage(): never {
  process.stderr.write(
    [
      "usage: bench --store-dir <dir> --input <file.json> [options]",
      "",
      "  --store-dir <dir>   the store to read. REQUIRED, and never a live one:",
      "                      copy it first (cp -R ~/.counterparts/store /tmp/store-copy).",
      "  --input <file>      the labeled prompts JSON.",
      "  --out <dir>         write the rendered tables here. The ONLY thing written.",
      "  --sweep             run the b x cap grid instead of one configuration.",
      "  --b / --k1 / --cap  one configuration's numbers. Defaults are the shipped",
      "                      CAL values; --cap inf disables the per-document ceiling.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

function parse(argv: readonly string[]): Args {
  const a: Args = { storeDir: null, input: null, out: null, sweep: false, b: 0.75, k1: 1, cap: 3 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) usage();
      return v;
    };
    switch (flag) {
      case "--store-dir": a.storeDir = next(); break;
      case "--input": a.input = next(); break;
      case "--out": a.out = next(); break;
      case "--sweep": a.sweep = true; break;
      case "--b": a.b = Number(next()); break;
      case "--k1": a.k1 = Number(next()); break;
      case "--cap": { const v = next(); a.cap = v === "inf" ? Infinity : Number(v); break; }
      case "-h": case "--help": usage();
      default: usage();
    }
  }
  if (a.storeDir === null || a.input === null) usage();
  return a;
}

function sweepGrid(): BenchConfig[] {
  const out: BenchConfig[] = [BEFORE];
  for (const b of [0, 0.5, 0.75, 1.0]) {
    for (const cap of [Infinity, 3, 2]) {
      if (b === 0 && cap === Infinity) continue; // that cell is BEFORE
      out.push({ name: `b=${b} cap=${cap === Infinity ? "inf" : cap}`, b, k1: 1, cap });
    }
  }
  return out;
}

function main(): void {
  const a = parse(process.argv.slice(2));
  const input = readBenchInput(a.input as string);
  const configs: BenchConfig[] = a.sweep
    ? sweepGrid()
    : [{ name: `b=${a.b} k1=${a.k1} cap=${a.cap === Infinity ? "inf" : a.cap}`, b: a.b, k1: a.k1, cap: a.cap }];

  const reports: BenchReport[] = [];
  const chunks: string[] = [];
  for (const config of configs) {
    const report = runBench(a.storeDir as string, input, config);
    reports.push(report);
    const text = renderReport(report);
    chunks.push(text);
    if (!a.sweep) process.stdout.write(`${text}\n\n`);
  }
  if (a.sweep) {
    const grid = renderSweep(reports);
    process.stdout.write(`${grid}\n\n`);
    chunks.unshift(grid);
  }
  if (a.out !== null) {
    mkdirSync(a.out, { recursive: true });
    writeFileSync(join(a.out, "report.md"), `${chunks.join("\n\n")}\n`, "utf8");
    writeFileSync(join(a.out, "report.json"), `${JSON.stringify(reports, null, 2)}\n`, "utf8");
    process.stdout.write(`wrote ${join(a.out, "report.md")}\n`);
  }
}

main();
