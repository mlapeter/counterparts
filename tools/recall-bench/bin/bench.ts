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
import { TUNABLES } from "../../../src/core/recall/index.js";
import { REQUIRE_EXPLICIT_DIR_ENV } from "../../../src/core/store/index.js";
import type { BenchConfig, BenchReport } from "../types.js";

interface Args {
  storeDir: string | null;
  input: string | null;
  out: string | null;
  sweep: boolean;
  gateSweep: boolean;
  b: number;
  k1: number;
  cap: number;
  oneSided: boolean;
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
      "  --gate-sweep        run the SNR_GLOBAL x SNR_STRONG x loud-floor grid, at",
      "                      the shipped length normalization. The volume knobs.",
      "  --b / --k1 / --cap  one configuration's numbers. Defaults are the shipped",
      "                      CAL values; --cap inf disables the per-document ceiling.",
      "  --one-sided         clamp the length factor at 1 (penalize long, never",
      "  --two-sided         reward short). Default follows the shipped CAL value.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

function parse(argv: readonly string[]): Args {
  const a: Args = {
    storeDir: null,
    input: null,
    out: null,
    sweep: false,
    gateSweep: false,
    b: TUNABLES.CUE_LENGTH_NORM,
    k1: TUNABLES.CUE_TF_SATURATION,
    cap: TUNABLES.CUE_DOC_CAP,
    oneSided: TUNABLES.CUE_LENGTH_ONE_SIDED,
  };
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
      case "--gate-sweep": a.gateSweep = true; break;
      case "--b": a.b = Number(next()); break;
      case "--k1": a.k1 = Number(next()); break;
      case "--cap": { const v = next(); a.cap = v === "inf" ? Infinity : Number(v); break; }
      case "--one-sided": a.oneSided = true; break;
      case "--two-sided": a.oneSided = false; break;
      case "-h": case "--help": usage();
      default: usage();
    }
  }
  if (a.storeDir === null || a.input === null) usage();
  return a;
}

function sweepGrid(): BenchConfig[] {
  const out: BenchConfig[] = [BEFORE];
  for (const oneSided of [false, true]) {
    for (const b of [0, 0.5, 0.75, 1.0]) {
      for (const cap of [Infinity, 3, 2]) {
        if (b === 0 && cap === Infinity) continue; // that cell is BEFORE
        out.push({
          name: `${oneSided ? "1-sided" : "2-sided"} b=${b} cap=${cap === Infinity ? "inf" : cap}`,
          b,
          k1: 1,
          cap,
          oneSided,
        });
      }
    }
  }
  return out;
}

/**
 * The GATE grid. Length normalization fixed at the shipped values, because this
 * sweep answers a different question: once the nine outliers stop setting the
 * turn's variance, what does the relative bar admit?
 *
 * `SNR_GLOBAL` is admission (how many sd above the turn's OTHER activations a
 * candidate must stand), `SNR_STRONG` is the loud tier, and the floor scale
 * moves every per-kind loud floor together, keeping §9 G12's measured shape.
 */
function gateGrid(): BenchConfig[] {
  const out: BenchConfig[] = [
    { name: "shipped", b: TUNABLES.CUE_LENGTH_NORM, k1: TUNABLES.CUE_TF_SATURATION, cap: TUNABLES.CUE_DOC_CAP, oneSided: TUNABLES.CUE_LENGTH_ONE_SIDED },
  ];
  // SNR_STRONG is fixed: the first grid measured it and it cannot do this job.
  // Turn 3's top candidate stands 3.5 sd above its own background where a
  // busy turn's stands 2.6, so raising `k` silences the busy turn FIRST. What
  // separates turn 3 is ABSOLUTE, and an absolute floor is what this grid moves.
  //
  // The floors are now in CUE UNITS (`recall/gate.ts#floorUnit`), so a cell here
  // means the same thing on a seventeen-memory store as on a fifteen-thousand
  // one. Measured 2026-09-04, each turn's best candidate lands between 0.88
  // units (the near-contentless turn 3) and 5.17 units (the busiest), so the
  // loud floor's interesting band is 3.5-5.0 and the admission floor's is 0-1.
  for (const floorGlobalUnits of [0, 0.5, 1.0]) {
    for (const floorStrongUnits of [3.0, 3.5, 4.0, 4.5, 5.0]) {
      out.push({
        name: `floorG ${floorGlobalUnits}u, floorS ${floorStrongUnits}u`,
        b: TUNABLES.CUE_LENGTH_NORM,
        k1: TUNABLES.CUE_TF_SATURATION,
        cap: TUNABLES.CUE_DOC_CAP,
        oneSided: TUNABLES.CUE_LENGTH_ONE_SIDED,
        floorGlobalUnits,
        floorStrongUnits,
      });
    }
  }
  return out;
}

function main(): void {
  // "There is NO default store", enforced by the store too: with the explicit-dir
  // guard armed, an open under here that lost its `--store-dir` is refused rather
  // than pointed at `~/.counterparts/store` (I21). `refuseLiveStore` still runs
  // first for the dir that WAS named.
  process.env[REQUIRE_EXPLICIT_DIR_ENV] = "1";
  const a = parse(process.argv.slice(2));
  const input = readBenchInput(a.input as string);
  const configs: BenchConfig[] = a.gateSweep
    ? gateGrid()
    : a.sweep
    ? sweepGrid()
    : [
        {
          name: `${a.oneSided ? "1-sided" : "2-sided"} b=${a.b} k1=${a.k1} cap=${a.cap === Infinity ? "inf" : a.cap}`,
          b: a.b,
          k1: a.k1,
          cap: a.cap,
          oneSided: a.oneSided,
        },
      ];

  const reports: BenchReport[] = [];
  const chunks: string[] = [];
  for (const config of configs) {
    const report = runBench(a.storeDir as string, input, config);
    reports.push(report);
    const text = renderReport(report);
    chunks.push(text);
    if (!a.sweep && !a.gateSweep) process.stdout.write(`${text}\n\n`);
  }
  if (a.sweep || a.gateSweep) {
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
