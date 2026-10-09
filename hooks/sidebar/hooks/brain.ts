/**
 * The brain: a point cloud projected into braille cells, as the approved
 * mockup's engine draws it (`~/counterparts-notes/mockups/2026-10-09-mod/
 * engine.js`, class `Brain`, `opts.holo`), ported to write a Raster's cells
 * instead of a canvas screen.
 *
 * The cloud is the dashboard's (pages/home/brain.js): same generator, same
 * seed, same regions. The hologram palette is one cyan, brightest at the lobe
 * outlines, the inner structures faint as if behind glass, and a soft navy
 * glow behind it drawn as cell BACKGROUND colour. A region that fires (or a
 * mechanism the person picks) flares in that mechanism's stage colour.
 *
 * Pure: no `$`, no engine. `frame()` returns the cells as `Uint32Array`
 * triplets `[codePoint, fg, bg]` — exactly what `RasterProps.cells` packs.
 */

import type { RegionKey, Rgb } from './mechanisms';

export const DEFAULT_COLOR = 0x01000000;

type Region = { readonly key: RegionKey; readonly col: Rgb; readonly anchor: readonly [number, number, number] };

export const REGIONS: readonly Region[] = [
  { key: 'prefrontal', col: [0.16, 0.8, 1.0], anchor: [0.0, 0.35, 1.2] },
  { key: 'amygdala', col: [1.0, 0.42, 0.52], anchor: [0.42, -0.42, 0.42] },
  { key: 'hippocampus', col: [0.72, 0.53, 1.0], anchor: [0.38, -0.3, -0.2] },
  { key: 'thalamus', col: [1.0, 0.8, 0.32], anchor: [0.0, 0.05, 0.05] },
  { key: 'brainstem', col: [0.55, 0.66, 0.85], anchor: [0.0, -0.8, -0.35] },
  { key: 'cortex', col: [0.25, 1.0, 0.72], anchor: [-0.7, 0.55, -0.2] },
  { key: 'cerebellum', col: [0.3, 0.42, 0.5], anchor: [0.0, -0.6, -0.85] },
];
const RID: Readonly<Record<RegionKey, number>> = {
  prefrontal: 0, amygdala: 1, hippocampus: 2, thalamus: 3, brainstem: 4, cortex: 5, cerebellum: 6,
};

type Cloud = {
  P: Float32Array; R: Uint8Array; D: Float32Array; F: Float32Array; T: Uint8Array;
  byRegion: number[][];
  rand: () => number;
};

function buildCloud(): Cloud {
  let s = 20260904;
  const rand = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const P: number[] = [], R: number[] = [], D: number[] = [], F: number[] = [], T: number[] = [];
  let fold = 0.5, part = 255;
  const push = (x: number, y: number, z: number, region: number, dim = 1): void => {
    P.push(x, y, z); R.push(region); D.push(dim); F.push(fold); T.push(part);
  };
  const dir = (): [number, number, number] => {
    const u = rand() * 2 - 1, ph = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    return [r * Math.cos(ph), u, r * Math.sin(ph)];
  };
  const smooth = (a: number, b: number, t: number): number => {
    const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  for (let i = 0; i < 11000; i++) {
    const d = dir();
    const th = Math.atan2(d[2], d[0]), ph = Math.asin(d[1]);
    const wr = 0.05 * Math.sin(th * 7 + 3 * Math.sin(ph * 4)) + 0.03 * Math.sin(th * 13 + ph * 9) + 0.018 * Math.sin(th * 23) * Math.sin(ph * 17);
    let r = 1 + wr;
    fold = (wr + 0.098) / 0.196; // 0 in a groove, 1 on a ridge
    r *= 0.985 + 0.05 * rand();
    const [dx, dy, dz] = d;
    const z = dz * r * (dz < 0 ? 1.34 : 1.24);
    let x = dx * r * (1.0 - 0.1 * dz - 0.06 * dz * dz);
    let y: number;
    if (dy >= 0) {
      y = dy * r * 0.84 * (1 - 0.16 * Math.max(0, -dz) ** 2) * (1 - 0.06 * Math.max(0, dz) ** 2);
    } else {
      y = dy * r * 0.5 * (1 - 0.35 * smooth(0.45, 0.85, dz));
      const band = smooth(-0.55, -0.15, dz) * (1 - smooth(0.35, 0.7, dz));
      const hang = smooth(0.35, 0.75, Math.abs(dx)) * band * Math.min(1, -dy * 1.6);
      y -= 0.34 * hang;
      x *= 1 - 0.14 * hang;
    }
    const fissureY = -0.2 + (0.62 - z) * 0.3;
    if (Math.abs(x) > 0.55 && z < 0.62 && z > -0.45 && Math.abs(y - fissureY) < 0.028) continue;
    if (Math.abs(x) < 0.035 && y > -0.1) continue;
    x += Math.sign(x) * 0.03;
    if (y < -0.24 && z < -0.5) continue;
    // lobes, per hemisphere: frontal 0/1, parietal-occipital 2/3, temporal 4/5
    const side = x < 0 ? 0 : 1;
    if (y < fissureY && z > -0.55 && z < 0.72 && Math.abs(x) > 0.4) part = 4 + side;
    else if (z > 0.2 - 0.38 * y) part = side;
    else part = 2 + side;
    push(x, y, z, z > 0.78 ? RID.prefrontal : RID.cortex, 0.75 + 0.25 * rand());
  }
  for (let i = 0; i < 2300; i++) {
    const d = dir();
    const folia = Math.sin(Math.asin(d[1]) * 22);
    fold = 0.5 + 0.5 * folia; // the cerebellum's fine stripes
    part = 6;
    let r = 1 + 0.06 * folia;
    r *= 0.97 + 0.06 * rand();
    push(d[0] * r * 0.5, -0.58 + d[1] * r * 0.3, -0.82 + d[2] * r * 0.42, RID.cerebellum, 0.7 + 0.3 * rand());
  }
  fold = 0.6; part = 7;
  for (let i = 0; i < 700; i++) {
    const t = rand(), a = rand() * Math.PI * 2, rr = (0.17 - 0.06 * t) * Math.sqrt(rand());
    push(Math.cos(a) * rr, -0.4 - 0.75 * t, -0.2 - 0.3 * t + Math.sin(a) * rr, RID.brainstem, 0.6 + 0.3 * rand());
  }
  part = 8;
  for (const sg of [-1, 1]) for (let i = 0; i < 430; i++) {
    const d = dir();
    push(sg * 0.15 + d[0] * 0.13, -0.02 + d[1] * 0.11, 0.02 + d[2] * 0.16, RID.thalamus, 0.45 + 0.25 * rand());
  }
  for (const sg of [-1, 1]) for (let i = 0; i < 540; i++) {
    part = sg < 0 ? 9 : 10;
    const t = rand(), a = rand() * Math.PI * 2, rr = 0.055 * Math.sqrt(rand());
    const cx = sg * (0.3 + 0.12 * Math.sin(Math.PI * t)), cy = -0.2 - 0.26 * t * (1 - 0.35 * t), cz = -0.38 + 0.78 * t;
    push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8, cz + Math.sin(a + 1) * rr, RID.hippocampus, 0.75 + 0.25 * rand());
  }
  part = 11;
  for (const sg of [-1, 1]) for (let i = 0; i < 240; i++) {
    const d = dir();
    push(sg * 0.42 + d[0] * 0.085, -0.42 + d[1] * 0.075, 0.42 + d[2] * 0.085, RID.amygdala, 0.75 + 0.25 * rand());
  }
  const byRegion: number[][] = REGIONS.map(() => []);
  for (let i = 0; i < R.length; i++) byRegion[R[i] as number]?.push(i);
  return { P: Float32Array.from(P), R: Uint8Array.from(R), D: Float32Array.from(D), F: Float32Array.from(F), T: Uint8Array.from(T), byRegion, rand };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const BRAILLE = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]; // [row][col]
const NP = 12;
const PART_REG = [RID.cortex, RID.cortex, RID.cortex, RID.cortex, RID.cortex, RID.cortex, RID.cerebellum, RID.brainstem, RID.thalamus, RID.hippocampus, RID.hippocampus, RID.amygdala];
// The hologram: our cyan (#00e5ff), brighter at the outline, deeper for the inside.
const HOLO_RIM: Rgb = [0.42, 1.05, 1.15], HOLO_SURF: Rgb = [0.0, 0.9, 1.0], HOLO_IN: Rgb = [0.0, 0.62, 0.85];
const MONO: Rgb = [0.34, 0.38, 0.43];

export function pack(r: number, g: number, b: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, v | 0));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

type Signal = { p0: number[]; mid: number[]; p2: number[]; reg: number; col: Rgb; born: number; dur: number };

export type FrameOptions = {
  /** Paused: one grey, no glow, nothing flares. */
  mono?: boolean;
  /** A small tag beside a region's anchor: a picked or firing mechanism's name. */
  tag?: { region: RegionKey; label: string; col: Rgb } | null;
  /**
   * The background the brain sits on, 0..255 a channel: empty cells take it and
   * the glow is added to it. Absent, empty cells are the terminal's default and
   * the glow is added to black, as the mockup drew it.
   */
  bg?: Rgb | null;
};

/** Scratch buffers for one frame size, reused frame to frame. */
type Scratch = {
  cols: number; rows: number; DW: number; DH: number;
  acc: Float32Array; cr: Float32Array; cg: Float32Array; cb: Float32Array; cwt: Float32Array;
  masks: Uint8Array[]; tmpA: Uint8Array; tmpB: Uint8Array;
  out: Uint32Array;
};

export class Brain {
  private readonly m: Cloud = buildCloud();
  rotY = -1.05;
  rotX = 0.24;
  /** Radians a millisecond: half the mockup's first spin. */
  spin = 0.000175;
  private readonly glow = new Float32Array(REGIONS.length);
  private readonly glowTarget = new Float32Array(REGIONS.length);
  private readonly glowCol: (Rgb | null)[] = REGIONS.map(() => null);
  private readonly level = new Float32Array(REGIONS.length).fill(0.25);
  private signals: Signal[] = [];
  private scratch: Scratch | null = null;
  /** Where each region's anchor fell in the last frame, in cells. */
  readonly anchors: { x: number; y: number; depth: number }[] = REGIONS.map(() => ({ x: 0, y: 0, depth: 0 }));

  /** A region fires: it flares in `col`, and a signal arcs to it from `from`. */
  pulse(region: RegionKey, col: Rgb, now: number, from: RegionKey = 'thalamus'): void {
    const r = RID[region];
    this.glowTarget[r] = 1;
    this.glowCol[r] = col;
    const m = this.m;
    const vtx = (reg: number): number[] => {
      const list = m.byRegion[reg] ?? [];
      const i = list[Math.floor(m.rand() * list.length)] ?? 0;
      return [m.P[i * 3] ?? 0, m.P[i * 3 + 1] ?? 0, m.P[i * 3 + 2] ?? 0];
    };
    const p0 = vtx(RID[from]), p2 = vtx(r);
    const k = 1.55 + 0.35 * m.rand();
    const mid = [((p0[0] ?? 0) + (p2[0] ?? 0)) / 2 * k, ((p0[1] ?? 0) + (p2[1] ?? 0)) / 2 * k + 0.25, ((p0[2] ?? 0) + (p2[2] ?? 0)) / 2 * k];
    this.signals.push({ p0, mid, p2, reg: r, col, born: now, dur: 1400 });
  }

  /** Holds a region lit while a mechanism is picked (called every frame it is). */
  light(region: RegionKey, col: Rgb, amount = 0.9): void {
    const r = RID[region];
    this.glowCol[r] = col;
    this.glowTarget[r] = Math.max(this.glowTarget[r] ?? 0, amount);
  }

  /** Turns the brain and lets glows ease and fade; `dt` in milliseconds. */
  step(now: number, dt: number): void {
    this.rotY += this.spin * dt;
    for (let i = 0; i < REGIONS.length; i++) {
      const g = this.glow[i] ?? 0, tg = this.glowTarget[i] ?? 0;
      this.glow[i] = g + (tg - g) * Math.min(1, 0.012 * dt);
      this.glowTarget[i] = tg * Math.pow(0.9993, dt);
    }
    this.signals = this.signals.filter(s => now - s.born < s.dur * 1.25);
  }

  private scratchFor(cols: number, rows: number): Scratch {
    const s = this.scratch;
    if (s !== null && s.cols === cols && s.rows === rows) return s;
    const DW = cols * 2, DH = rows * 4, n = DW * DH;
    const made: Scratch = {
      cols, rows, DW, DH,
      acc: new Float32Array(n), cr: new Float32Array(n), cg: new Float32Array(n), cb: new Float32Array(n), cwt: new Float32Array(n),
      masks: Array.from({ length: NP }, () => new Uint8Array(n)), tmpA: new Uint8Array(n), tmpB: new Uint8Array(n),
      out: new Uint32Array(cols * rows * 3),
    };
    this.scratch = made;
    return made;
  }

  /**
   * One frame of `cols` x `rows` cells. The returned array is reused by the
   * next call of the same size: encode it before asking for another.
   */
  frame(cols: number, rows: number, now: number, opts: FrameOptions = {}): Uint32Array {
    const S = this.scratchFor(cols, rows);
    const { DW, DH, acc, cr, cg, cb, cwt, masks, out } = S;
    acc.fill(0); cr.fill(0); cg.fill(0); cb.fill(0); cwt.fill(0);
    for (const mk of masks) mk.fill(0);
    const mono = opts.mono === true;
    const { P, R, D, F, T: PART } = this.m;
    const cy = Math.cos(this.rotY), sy = Math.sin(this.rotY), cx = Math.cos(this.rotX), sx = Math.sin(this.rotX);
    const camZ = 3.0, camY = 0.18, f = 1 / Math.tan((45 * Math.PI) / 360);
    const SC = Math.min(DW / 2 / 1.22, DH / 2 / 1.04);
    const midX = DW / 2, midY = DH / 2 + DH * 0.02;
    const t = now / 1000;
    const thr = 0.9;
    let px = 0, py = 0, pz = 0;
    const project = (x: number, y: number, z: number): void => {
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
      const Y = y2 + 0.08 - camY, Z = z2 - camZ;
      px = midX + (x1 * f) / -Z * SC; py = midY - (Y * f) / -Z * SC; pz = -Z;
    };
    const deposit = (x: number, y: number, w: number, c0: number, c1: number, c2: number, colorWeight = w): void => {
      const ix = x | 0, iy = y | 0;
      if (x < 0 || y < 0 || ix >= DW || iy >= DH) return;
      const i = iy * DW + ix;
      acc[i] = (acc[i] ?? 0) + w; cwt[i] = (cwt[i] ?? 0) + colorWeight;
      cr[i] = (cr[i] ?? 0) + c0 * colorWeight; cg[i] = (cg[i] ?? 0) + c1 * colorWeight; cb[i] = (cb[i] ?? 0) + c2 * colorWeight;
    };
    const partDepth = new Float32Array(NP), partN = new Float32Array(NP);
    const glow = mono ? new Float32Array(REGIONS.length) : this.glow;
    for (let i = 0, n = R.length; i < n; i++) {
      const reg = R[i] ?? 0;
      const x = P[i * 3] ?? 0, y = P[i * 3 + 1] ?? 0, z = P[i * 3 + 2] ?? 0;
      project(x, y, z);
      const depth = pz;
      const tw = 0.8 + 0.2 * Math.sin(t * 2.1 + x * 37 + y * 53 + z * 41);
      const g = glow[reg] ?? 0, lv = this.level[reg] ?? 0;
      const part = PART[i] ?? 255;
      if (part < NP) {
        partDepth[part] = (partDepth[part] ?? 0) + depth; partN[part] = (partN[part] ?? 0) + 1;
        const mx = Math.floor(px), my = Math.floor(py);
        if (mx >= 0 && my >= 0 && mx < DW && my < DH) (masks[part] as Uint8Array)[my * DW + mx] = 1;
      }
      // the outline comes from every shell point; the surface only from the half
      // facing us, so the lateral fissure shows as a gap; the inside only when firing
      const shell = reg === RID.cortex || reg === RID.prefrontal || reg === RID.cerebellum || reg === RID.brainstem;
      const facing = depth < camZ - 0.02;
      const Di = D[i] ?? 1;
      let w: number;
      if (shell) w = facing && (F[i] ?? 0) > 0.62 ? 0.55 * tw * Di * (1 + 1.6 * g) : 0; // a sprinkle of ridges
      else w = g > 0.04 ? (0.6 + 2.2 * g) * tw * Di : 0.05 * tw;
      if (w <= 0) continue;
      const innerReg = reg === RID.thalamus || reg === RID.hippocampus || reg === RID.amygdala;
      const base = mono ? MONO : innerReg ? HOLO_IN : HOLO_SURF;
      const k = 0.7 + 0.45 * lv + 1.1 * g;
      let c0 = base[0] * k, c1 = base[1] * k, c2 = base[2] * k;
      const gc = this.glowCol[reg];
      if (gc && g > 0 && !mono) {
        const mx = Math.min(1, g * 1.3);
        c0 += (gc[0] * k - c0) * mx; c1 += (gc[1] * k - c1) * mx; c2 += (gc[2] * k - c2) * mx;
      }
      deposit(px, py, w, c0, c1, c2, w * (1 + 6 * g)); // a flaring region wins the colour of the cells it shares
    }
    if (!mono) {
      for (const s of this.signals) {
        const tt = Math.min(1, (now - s.born) / s.dur);
        const fade = now - s.born < s.dur ? 1 : 1 - (now - s.born - s.dur) / (s.dur * 0.25);
        const col = s.col;
        for (let k = 0; k <= 20; k++) {
          const u = tt - k * 0.018;
          if (u < 0) break;
          const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
          project(
            a * (s.p0[0] ?? 0) + b * (s.mid[0] ?? 0) + c * (s.p2[0] ?? 0),
            a * (s.p0[1] ?? 0) + b * (s.mid[1] ?? 0) + c * (s.p2[1] ?? 0),
            a * (s.p0[2] ?? 0) + b * (s.mid[2] ?? 0) + c * (s.p2[2] ?? 0),
          );
          const w = (k === 0 ? 30 : 6 * (1 - k / 20)) * fade;
          if (k === 0) deposit(px, py, w, 1.6, 1.6, 1.6);
          else deposit(px, py, w, col[0] * 1.4, col[1] * 1.4, col[2] * 1.4);
        }
      }
    }
    // each lobe's own outline: where two lobes meet, the two edges make the groove
    const CLOSE = Math.max(1, Math.round(DW / 70));
    const { tmpA, tmpB } = S;
    const at = (m: Uint8Array, x: number, y: number): number => (x < 0 || y < 0 || x >= DW || y >= DH ? 0 : (m[y * DW + x] ?? 0));
    const grow = (src: Uint8Array, dst: Uint8Array, keep: boolean): void => {
      for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
        const c = at(src, x, y), l = at(src, x - 1, y), r = at(src, x + 1, y), u = at(src, x, y - 1), d = at(src, x, y + 1);
        dst[y * DW + x] = (keep ? c && l && r && u && d : c || l || r || u || d) ? 1 : 0;
      }
    };
    for (let pt = 0; pt < NP; pt++) {
      if (!partN[pt]) continue;
      // closing: grow CLOSE times, then shrink CLOSE times
      let src = masks[pt] as Uint8Array, dst = tmpA;
      for (let k = 0; k < CLOSE; k++) { grow(src, dst, false); src = dst; dst = dst === tmpA ? tmpB : tmpA; }
      for (let k = 0; k < CLOSE; k++) { grow(src, dst, true); src = dst; dst = dst === tmpA ? tmpB : tmpA; }
      const clo = src;
      const meanDepth = (partDepth[pt] ?? 0) / (partN[pt] ?? 1);
      const inner = pt >= 8;
      const near = inner ? 0.45 : pt >= 6 || meanDepth < camZ + 0.02 ? 1 : 0.4; // far lobes faint; the midline always
      const reg = PART_REG[pt] ?? RID.cortex, g = glow[reg] ?? 0;
      const c = inner ? HOLO_IN : HOLO_RIM;
      const k = (mono ? 0.7 : inner ? 0.85 : 1.0) + 0.6 * g;
      let c0 = mono ? MONO[0] * k : c[0] * k, c1 = mono ? MONO[1] * k : c[1] * k, c2 = mono ? MONO[2] * k : c[2] * k;
      const gc = this.glowCol[reg];
      if (gc && g > 0.05 && !mono) {
        const mx = Math.min(1, g * 1.3);
        c0 += (gc[0] * 1.2 - c0) * mx; c1 += (gc[1] * 1.2 - c1) * mx; c2 += (gc[2] * 1.2 - c2) * mx;
      }
      for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
        if (!clo[y * DW + x]) continue;
        if (at(clo, x - 1, y) && at(clo, x + 1, y) && at(clo, x, y - 1) && at(clo, x, y + 1)) continue;
        deposit(x + 0.5, y + 0.5, 6 * near, c0, c1, c2);
      }
    }
    // where each region's anchor sits, in cells
    for (let r = 0; r < REGIONS.length; r++) {
      const a = (REGIONS[r] as Region).anchor;
      project(a[0], a[1], a[2]);
      const slot = this.anchors[r];
      if (slot !== undefined) { slot.x = px / 2; slot.y = py / 4; slot.depth = pz; }
    }
    // cells
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        let bits = 0, sw = 0, swc = 0, r = 0, g = 0, b = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
          const X = rx * 2 + dx, Y = ry * 4 + dy, i = Y * DW + X;
          const a = acc[i] ?? 0;
          if (a <= 0) continue;
          const th = thr * (0.55 + 0.9 * (BAYER4[(Y & 3) * 4 + (X & 3)] ?? 0.5));
          if (a > th) bits |= (BRAILLE[dy] as number[])[dx] ?? 0;
          sw += a; swc += cwt[i] ?? 0; r += cr[i] ?? 0; g += cg[i] ?? 0; b += cb[i] ?? 0;
        }
        const base = opts.bg ?? null;
        let bg = base === null ? DEFAULT_COLOR : pack(base[0], base[1], base[2]);
        if (!mono) {
          const ddx = (rx + 0.5) / cols - 0.5, ddy = ((ry + 0.5) / rows - 0.5) * 0.9;
          const rad = Math.max(0, 1 - Math.sqrt(ddx * ddx + ddy * ddy) / 0.62);
          const k = 0.75 * rad * rad; // one smooth round glow; a per-cell bloom reads blocky
          if (k > 0.02) bg = base === null ? pack(0, 30 * k, 44 * k) : pack(base[0], base[1] + 30 * k, base[2] + 44 * k);
        }
        const o = (ry * cols + rx) * 3;
        if (!bits) { out[o] = 0x20; out[o + 1] = DEFAULT_COLOR; out[o + 2] = bg; continue; }
        const bright = Math.min(1.15, 0.55 + sw / (8 * thr * 1.4));
        let c0 = (r / swc) * 255 * bright, c1 = (g / swc) * 255 * bright, c2 = (b / swc) * 255 * bright;
        const top = Math.max(c0, c1, c2);
        if (top > 255) { const s = 255 / top; c0 *= s; c1 *= s; c2 *= s; } // keep the hue: a flare stays its colour
        out[o] = 0x2800 + bits; out[o + 1] = pack(c0, c1, c2); out[o + 2] = bg;
      }
    }
    if (opts.tag && !mono) this.drawTag(out, cols, rows, opts.tag);
    return out;
  }

  /** `◆` on the region's anchor and ` Name ` on its stage colour beside it. */
  private drawTag(out: Uint32Array, cols: number, rows: number, tag: { region: RegionKey; label: string; col: Rgb }): void {
    const a = this.anchors[RID[tag.region]];
    if (a === undefined) return;
    const ax = Math.round(a.x), ay = Math.round(a.y);
    const set = (x: number, y: number, cp: number, fg: number, bg: number): void => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const o = (y * cols + x) * 3;
      out[o] = cp; out[o + 1] = fg; out[o + 2] = bg;
    };
    set(ax, ay, 0x25c6, 0xffffff, out[(Math.max(0, Math.min(rows - 1, ay)) * cols + Math.max(0, Math.min(cols - 1, ax))) * 3 + 2] ?? DEFAULT_COLOR);
    const label = ` ${tag.label} `;
    let lx = ax + 2;
    const ly = Math.max(0, Math.min(rows - 1, ay - 2));
    if (lx + label.length + 1 > cols) lx = ax - label.length - 2;
    const bg = pack(tag.col[0] * 255, tag.col[1] * 255, tag.col[2] * 255);
    for (let i = 0; i < label.length; i++) set(lx + i, ly, label.charCodeAt(i), 0x000000, bg);
  }
}
