/**
 * The brain's cost, measured in bun: milliseconds a frame (compute only, then
 * with the base64 encode the blit carries), and how many cells change from one
 * frame to the next while it sways at the calm rate (what the terminal must
 * repaint). With `dist/old-brain.ts` present (`git show 87c1ebb9:hooks/sidebar/
 * hooks/brain.ts > dist/old-brain.ts`), the brain before this work too.
 *
 *   bun hooks/sidebar/dev/brain-lab/bench.ts
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Brain } from '../../hooks/brain';
import { encodeCells } from '../../hooks/cells';

type AnyBrain = { frame: (c: number, r: number, now: number, o?: object) => Uint32Array; step: (now: number, dt: number) => void };

const T0 = 1_760_000_000_000;
const SIZES: [number, number][] = [[42, 14], [30, 10], [90, 32]];
const BG = [5, 8, 12] as const;

function bench(make: () => AnyBrain, cols: number, rows: number, fpsCalm: number): { ms: number; msEnc: number; changed: number; p95: number } {
  const b = make();
  const dt = 1000 / fpsCalm;
  let t = T0;
  for (let i = 0; i < 40; i++) { b.step(t, dt); b.frame(cols, rows, t, { bg: BG }); t += dt; }
  const N = 400, times: number[] = [];
  let prev = Uint32Array.from(b.frame(cols, rows, t, { bg: BG })), changed = 0, enc = 0;
  for (let i = 0; i < N; i++) {
    t += dt;
    b.step(t, dt);
    const t0 = performance.now();
    const cells = b.frame(cols, rows, t, { bg: BG });
    const t1 = performance.now();
    encodeCells(cells);
    enc += performance.now() - t1;
    times.push(t1 - t0);
    for (let k = 0; k < cells.length; k += 3) if (cells[k] !== prev[k] || cells[k + 1] !== prev[k + 1] || cells[k + 2] !== prev[k + 2]) changed++;
    prev = Uint32Array.from(cells);
  }
  times.sort((a, b2) => a - b2);
  const ms = times.reduce((a, b2) => a + b2, 0) / N;
  return { ms, msEnc: ms + enc / N, changed: changed / N, p95: times[Math.floor(N * 0.95)] ?? 0 };
}

const rows: string[] = [];
const fmt = (n: number): string => n.toFixed(2);
for (const [c, r] of SIZES) {
  const x = bench(() => new Brain() as unknown as AnyBrain, c, r, 6);
  rows.push(`| new | ${c}x${r} | ${fmt(x.ms)} | ${fmt(x.p95)} | ${fmt(x.msEnc)} | ${x.changed.toFixed(0)} of ${c * r} |`);
}
const old = join(import.meta.dir, 'dist', 'old-brain.ts');
if (existsSync(old)) {
  const { Brain: Old } = (await import(old)) as { Brain: new () => AnyBrain };
  for (const [c, r] of SIZES) {
    const x = bench(() => new Old(), c, r, 6);
    rows.push(`| before | ${c}x${r} | ${fmt(x.ms)} | ${fmt(x.p95)} | ${fmt(x.msEnc)} | ${x.changed.toFixed(0)} of ${c * r} |`);
  }
}
// motion A/B: 40 s of sway (one full period) at 42x14, drawn at the calm rate
type Knobs = { yawSwing: number; spin: number };
function sway(fps: number, swing: number): { fps: number; changedFrames: number; cellsPerS: number; msPerS: number; cv: number; meanGap: number } {
  const b = new Brain() as unknown as AnyBrain & Knobs;
  b.yawSwing = swing;
  const dt = 1000 / fps, frames = Math.round(40000 / dt);
  let t = T0, prev: Uint32Array | null = null, changedFrames = 0, cells = 0, ms = 0;
  const lastChange = new Float64Array(42 * 14).fill(-1);
  const gaps: number[] = [];
  for (let f = 0; f < frames; f++) {
    b.step(t, dt);
    const t0 = performance.now();
    const c = b.frame(42, 14, t, { bg: BG });
    ms += performance.now() - t0;
    if (prev !== null) {
      let any = false;
      for (let k = 0, cell = 0; k < c.length; k += 3, cell++) {
        if (c[k] !== prev[k] || c[k + 1] !== prev[k + 1]) {
          any = true; cells++;
          if ((lastChange[cell] as number) >= 0) gaps.push(t - (lastChange[cell] as number));
          lastChange[cell] = t;
        }
      }
      if (any) changedFrames++;
    }
    prev = Uint32Array.from(c);
    t += dt;
  }
  const mean = gaps.reduce((x, y) => x + y, 0) / Math.max(1, gaps.length);
  const sd = Math.sqrt(gaps.reduce((x, y) => x + (y - mean) * (y - mean), 0) / Math.max(1, gaps.length));
  return { fps, changedFrames: changedFrames / 40, cellsPerS: cells / 40, msPerS: ms / 40, cv: sd / mean, meanGap: mean };
}
console.log('\nmotion A/B, 42x14, one 40 s period of sway:\n');
console.log('| calm fps | swing | blits a second (frames that changed) | cells repainted a second | compute ms a second | a cell changes every (mean) |');
console.log('|---|---|---|---|---|---|');
for (const swing of [0.45, 0.28]) for (const fps of [6, 12]) {
  const m = sway(fps, swing);
  console.log(`| ${fps} | ±${(swing * 180 / Math.PI).toFixed(0)}° | ${m.changedFrames.toFixed(1)} | ${m.cellsPerS.toFixed(0)} | ${m.msPerS.toFixed(1)} | ${(m.meanGap / 1000).toFixed(2)} s |`);
}

const b = new Brain();
const sc = Math.min((42 * 2) / 2.1, (14 * 4) / 1.5);
const peak = b.yawSwing * b.spin * 1000; // rad/s at the sway's fastest
console.log('| brain | size | ms/frame (mean) | p95 | with encode | cells changed a frame (calm, 6 fps) |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) console.log(r);
console.log(`\nsway: ${(b.yawSwing * 180 / Math.PI).toFixed(0)}° either side of ${(b.yawCentre * 180 / Math.PI).toFixed(0)}°, period ${(2 * Math.PI / b.spin / 1000).toFixed(0)} s; fastest ${peak.toFixed(3)} rad/s = ${(peak * sc).toFixed(2)} dots/s at the 42x14 poles = ${(peak * sc / b.calmFps).toFixed(2)} dot a frame at ${b.calmFps} fps`);
