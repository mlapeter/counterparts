/**
 * The brain: a hologram in braille line art, as a side or three-quarter view
 * that sways slowly, the way the reference icon shows it
 * (dev/brain-lab/refs/PRIMARY-i2-side-view.png).
 *
 * The shape is a handful of ellipsoids proportioned from Gray's lateral view
 * (Gray728, public domain; dev/brain-lab/refs/): per hemisphere a frontal,
 * a parietal and an occipital piece, and the temporal lobe hanging below the
 * lateral (Sylvian) fissure; the two halves of the cerebellum tucked under the
 * back; the brainstem dropping below. Each frame casts one ray per braille dot
 * (closed form, no point cloud), so every edge is exact and one dot wide:
 *
 * - the silhouette, brightest; the fissures where two parts meet;
 * - a few named sulci and the cerebellum's folia, each the zero line of a
 *   function on the surface, so they stay glued to the brain as it turns;
 * - a sparse stipple of fixed surface points, cyan at the front shading to
 *   teal at the top and back (fixed in the brain, so it never shimmers);
 * - the inner structures behind glass in their region colours: the thalamus
 *   amber at the centre, the hippocampus violet curving back, the amygdala pink
 *   in front of it.
 *
 * No background colour: a cell has one background, so any glow steps. A region
 * that fires (or a mechanism the person picks) takes its stage colour.
 *
 * Lineage: the API, the regions and the pulse arcs are the mockup's engine
 * (`~/counterparts-notes/mockups/2026-10-09-mod/engine.js`, class `Brain`) as
 * the first port drew it; the point cloud is gone (it read as a blob).
 *
 * Pure: no `$`, no engine. `frame()` returns the cells as `Uint32Array`
 * triplets `[codePoint, fg, bg]`, exactly what `RasterProps.cells` packs.
 */

import type { RegionKey, Rgb } from './mechanisms';

export const DEFAULT_COLOR = 0x01000000;

type V3 = readonly [number, number, number];
type Region = { readonly key: RegionKey; readonly col: Rgb; readonly anchor: V3 };

/** The regions, their resting colours, and where a tag pins to (the left side faces the default view). */
export const REGIONS: readonly Region[] = [
  { key: 'prefrontal', col: [0.16, 0.8, 1.0], anchor: [-0.38, 0.2, 0.78] },
  { key: 'amygdala', col: [1.0, 0.42, 0.52], anchor: [-0.33, -0.38, 0.33] },
  { key: 'hippocampus', col: [0.72, 0.53, 1.0], anchor: [-0.31, -0.28, 0.0] },
  { key: 'thalamus', col: [1.0, 0.8, 0.32], anchor: [-0.1, -0.02, -0.08] },
  { key: 'brainstem', col: [0.5, 0.52, 0.95], anchor: [0, -0.66, -0.22] },
  { key: 'cortex', col: [0.25, 1.0, 0.72], anchor: [-0.55, 0.38, -0.35] },
  { key: 'cerebellum', col: [0.82, 0.6, 1.0], anchor: [-0.26, -0.52, -0.55] },
];
const RID: Readonly<Record<RegionKey, number>> = {
  prefrontal: 0, amygdala: 1, hippocampus: 2, thalamus: 3, brainstem: 4, cortex: 5, cerebellum: 6,
};

// ── the shape ────────────────────────────────────────────────────────────────
// Model units: the cerebrum runs z = -1 (occipital pole) to +1 (frontal pole);
// y is up; x is the person's right. The left hemisphere is x < 0.

/** Parts: each hemisphere's cerebrum and temporal lobe, the cerebellum's halves, the stem. */
const CER_L = 0, CER_R = 1, TMP_L = 2, TMP_R = 3, CBL_L = 4, CBL_R = 5, STEM = 6;
/** Inner parts. */
const THAL_L = 0, THAL_R = 1, HIP_L = 2, HIP_R = 3, AMY_L = 4, AMY_R = 5;
const INNER_REG = [RID.thalamus, RID.thalamus, RID.hippocampus, RID.hippocampus, RID.amygdala, RID.amygdala];

type Ell = {
  readonly cx: number; readonly cy: number; readonly cz: number;
  readonly ix: number; readonly iy: number; readonly iz: number; // 1 / radii
  readonly ct: number; readonly st: number; // the tilt about x: positive raises the back end
  readonly rmax: number;
  readonly g: number;
};

function ell(c: V3, r: V3, tilt: number, g: number): Ell {
  return {
    cx: c[0], cy: c[1], cz: c[2], ix: 1 / r[0], iy: 1 / r[1], iz: 1 / r[2],
    ct: Math.cos(tilt), st: Math.sin(tilt), rmax: Math.max(r[0], r[1], r[2]), g,
  };
}

/** The temporal lobe's frame, shared by its ellipsoid and its sulcus. */
const TMP_C: V3 = [0.5, -0.3, -0.02], TMP_R3: V3 = [0.31, 0.26, 0.56], TMP_TILT = 0.35;

function buildOuter(): Ell[] {
  const out: Ell[] = [];
  for (const s of [-1, 1]) {
    const L = s < 0 ? 0 : 1;
    out.push(ell([0.3 * s, 0.07, 0.4], [0.42, 0.47, 0.6], 0, CER_L + L)); // frontal
    out.push(ell([0.32 * s, 0.17, -0.15], [0.5, 0.47, 0.68], 0, CER_L + L)); // parietal dome
    out.push(ell([0.25 * s, -0.08, -0.68], [0.36, 0.27, 0.32], 0, CER_L + L)); // occipital
    out.push(ell([TMP_C[0] * s, TMP_C[1], TMP_C[2]], TMP_R3, TMP_TILT, TMP_L + L)); // temporal
    out.push(ell([0.25 * s, -0.55, -0.56], [0.33, 0.28, 0.35], 0, CBL_L + L)); // cerebellum
  }
  out.push(ell([0, -0.18, -0.12], [0.13, 0.15, 0.12], 0, STEM)); // midbrain
  out.push(ell([0, -0.42, -0.1], [0.16, 0.16, 0.15], 0, STEM)); // pons
  out.push(ell([0, -0.7, -0.2], [0.115, 0.3, 0.115], 0.3, STEM)); // medulla
  return out;
}

function buildInner(): Ell[] {
  const out: Ell[] = [];
  for (const s of [-1, 1]) {
    const L = s < 0 ? 0 : 1;
    out.push(ell([0.1 * s, -0.02, -0.08], [0.09, 0.085, 0.15], 0, THAL_L + L));
    out.push(ell([0.32 * s, -0.35, 0.16], [0.06, 0.055, 0.1], 0.25, HIP_L + L));
    out.push(ell([0.32 * s, -0.3, 0.0], [0.06, 0.055, 0.1], 0.45, HIP_L + L));
    out.push(ell([0.29 * s, -0.22, -0.14], [0.055, 0.05, 0.09], 0.7, HIP_L + L));
    out.push(ell([0.25 * s, -0.12, -0.24], [0.05, 0.05, 0.08], 1.0, HIP_L + L));
    out.push(ell([0.33 * s, -0.38, 0.33], [0.065, 0.065, 0.065], 0, AMY_L + L));
  }
  return out;
}

const OUTER = buildOuter();
const INNER = buildInner();

/** Inside ellipsoid `e`, by the implicit function. */
function inside(e: Ell, x: number, y: number, z: number, slack = 0): boolean {
  const dx = x - e.cx, dy = y - e.cy, dz = z - e.cz;
  const lx = dx * e.ix, ly = (dy * e.ct + dz * e.st) * e.iy, lz = (-dy * e.st + dz * e.ct) * e.iz;
  return lx * lx + ly * ly + lz * lz < 1 - slack;
}

/** Fixed points on the outer surface: the stipple, each with a rank that says how soon it shows. */
type Stipple = { P: Float32Array; G: Uint8Array; rank: Float32Array; n: number };

function buildStipple(): Stipple {
  let s = 20261009;
  const rand = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const P: number[] = [], G: number[] = [], rank: number[] = [];
  for (const e of OUTER) {
    const a = 1 / e.ix, b = 1 / e.iy, c = 1 / e.iz;
    const area = 4 * Math.PI * Math.pow((Math.pow(a * b, 1.6) + Math.pow(a * c, 1.6) + Math.pow(b * c, 1.6)) / 3, 1 / 1.6);
    const n = Math.round(area * 2600);
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1, ph = rand() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      const lx = rr * Math.cos(ph) * a, ly = u * b, lz = rr * Math.sin(ph) * c;
      const x = e.cx + lx, y = e.cy + ly * e.ct - lz * e.st, z = e.cz + ly * e.st + lz * e.ct;
      let covered = false;
      for (const o of OUTER) if (o !== e && inside(o, x, y, z, 0.002)) { covered = true; break; }
      if (covered) continue;
      P.push(x, y, z); G.push(e.g); rank.push(rand());
    }
  }
  // lowest rank first, so a frame stops reading at the density it wants
  const order = rank.map((_, i) => i).sort((a, b) => (rank[a] as number) - (rank[b] as number));
  const Ps = new Float32Array(P.length), Gs = new Uint8Array(G.length), Rs = new Float32Array(rank.length);
  order.forEach((o, k) => {
    Ps[k * 3] = P[o * 3] as number; Ps[k * 3 + 1] = P[o * 3 + 1] as number; Ps[k * 3 + 2] = P[o * 3 + 2] as number;
    Gs[k] = G[o] as number; Rs[k] = rank[o] as number;
  });
  return { P: Ps, G: Gs, rank: Rs, n: G.length };
}

const STIPPLE = buildStipple();

// ── the sulci: zero lines of functions on the surface ───────────────────────
// Each is drawn where its function changes sign between neighbouring dots of
// one part, and only where `ok` holds. `ax` is |x|: both hemispheres alike.

/** The central sulcus: from the top just behind the middle, down and forward to the fissure. */
const Zc = (y: number): number => -0.1 + (0.62 - y) * 0.5;
const S_TMP = (ax: number, y: number, z: number): [number, number] => {
  const dy = y - TMP_C[1], dz = z - TMP_C[2];
  return [dy * Math.cos(TMP_TILT) + dz * Math.sin(TMP_TILT), -dy * Math.sin(TMP_TILT) + dz * Math.cos(TMP_TILT)];
};

type Sulcus = { readonly tmp: boolean; readonly major?: true; readonly f: (ax: number, y: number, z: number) => number };
const NaN_ = Number.NaN;
const SULCI: readonly Sulcus[] = [
  // central
  { tmp: false, major: true, f: (ax, y, z) => (y > 0.08 ? z - Zc(y) - 0.022 * Math.sin(y * 20 + 0.5) - 0.012 * Math.sin(ax * 18) : NaN_) },
  // precentral
  { tmp: false, f: (ax, y, z) => (y > 0.12 && y < 0.56 ? z - Zc(y) - 0.17 - 0.018 * Math.sin(y * 17 + 2) : NaN_) },
  // postcentral
  { tmp: false, f: (ax, y, z) => (y > 0.16 && y < 0.58 ? z - Zc(y) + 0.17 - 0.018 * Math.sin(y * 15 + 4) : NaN_) },
  // superior frontal
  { tmp: false, f: (ax, y, z) => (y > 0.15 && z > Zc(y) + 0.24 && z < 0.86 ? ax - 0.24 - 0.016 * Math.sin(z * 16) : NaN_) },
  // inferior frontal
  { tmp: false, f: (ax, y, z) => (ax > 0.3 && y > -0.25 && z > Zc(y) + 0.24 && z < 0.82 ? y - 0.1 - 0.12 * (z - 0.4) - 0.016 * Math.sin(z * 18 + 1) : NaN_) },
  // intraparietal
  { tmp: false, f: (ax, y, z) => (ax > 0.28 && z < Zc(y) - 0.24 && z > -0.8 ? y - 0.3 - 0.15 * (z + 0.45) - 0.018 * Math.sin(z * 13) : NaN_) },
  // superior temporal
  { tmp: true, major: true, f: (ax, y, z) => { const [qy, qz] = S_TMP(ax, y, z); return Math.abs(qz) < 0.42 ? qy - 0.04 - 0.012 * Math.sin(qz * 20) : NaN_; } },
];

// ── drawing ──────────────────────────────────────────────────────────────────

const P_STIPPLE = 1, P_FOLD = 2, P_INNER = 3, P_FISSURE = 4, P_OUTLINE = 5, P_LIT = 6, P_SIGNAL = 7;
const BRAILLE = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]; // [row][col]
/** Braille dots are about square in the terminal (iTerm2, Menlo 13.5: a cell 8.1 x 16 px). */
const DOT_ASPECT = 1.0;
const FAR = 4;

export function pack(r: number, g: number, b: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, v | 0));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

function dim(c: number, k: number): number {
  return pack(((c >> 16) & 255) * k, ((c >> 8) & 255) * k, (c & 255) * k);
}

const CYAN: Rgb = [0, 205, 255], TEAL: Rgb = [40, 232, 182];
const CBL_COL = { outline: pack(228, 182, 255), crease: pack(205, 150, 255), fold: pack(176, 120, 246), stipple: pack(118, 80, 182) };
const STEM_COL = { outline: pack(150, 150, 250), crease: pack(130, 130, 235), stipple: pack(78, 80, 170) };
const CORTEX_OUTLINE = pack(120, 238, 255);
const INNER_COL = [pack(255, 198, 78), pack(255, 198, 78), pack(178, 128, 255), pack(178, 128, 255), pack(255, 104, 134), pack(255, 104, 134)];
const MONO_GREY = [0, 78, 112, 118, 148, 178, 178, 200];

type Signal = { p0: V3; mid: V3; p2: V3; reg: number; col: Rgb; born: number; dur: number };

export type FrameOptions = {
  /** Paused: one grey, nothing flares. */
  mono?: boolean;
  /** A small tag beside a region's anchor: a picked or firing mechanism's name. */
  tag?: { region: RegionKey; label: string; col: Rgb } | null;
  /** The background every cell takes, 0..255 a channel; absent, the terminal's default. */
  bg?: Rgb | null;
};

/** Scratch buffers for one frame size, reused frame to frame. */
type Scratch = {
  cols: number; rows: number; DW: number; DH: number;
  dep: Float32Array; grp: Int8Array; eid: Int8Array;
  idep: Float32Array; igrp: Int8Array;
  hx: Float32Array; hy: Float32Array; hz: Float32Array; val: Float32Array;
  pri: Uint8Array; col: Uint32Array;
  out: Uint32Array;
};

export class Brain {
  /** The view: yaw (0 the left side, front at screen left; pi/2 the front) and pitch (camera above). */
  rotY = 0.35;
  rotX = 0.1;
  /** The sway's centre and half-width, radians: it turns between the side view and three-quarters. */
  yawCentre = 0.35;
  yawSwing = 0.45;
  /**
   * The sway's phase speed, radians a millisecond: a 40 s period, so at its
   * fastest the 42 x 14 brain moves under half a braille dot a frame at the
   * calm rate. 0 holds the view where it is (the lab does).
   */
  spin = (2 * Math.PI) / 40000;
  /** Frames a second while it sways; a pulse's arc draws at the timer's full rate. */
  readonly calmFps = 6;
  /** With nothing firing for this long, the sway eases to a stop and nothing is drawn. */
  restAfter = 60000;
  private phase = 0;
  /** 1 swaying, 0 at rest; eases between them over a few seconds. */
  private motion = 1;
  private lastActive = -1;
  private poked = false;
  /** The folds: named sulci, a maze of gyri, or both. */
  gyri: 'anatomy' | 'maze' | 'both' = 'both';
  gyriK = 10;
  stippleDensity = 0.3;
  private readonly glow = new Float32Array(REGIONS.length);
  private readonly glowTarget = new Float32Array(REGIONS.length);
  private readonly glowCol: (Rgb | null)[] = REGIONS.map(() => null);
  private signals: Signal[] = [];
  private scratch: Scratch | null = null;
  private seed = 7;
  /** Where each region's anchor fell in the last frame, in cells. */
  readonly anchors: { x: number; y: number; depth: number }[] = REGIONS.map(() => ({ x: 0, y: 0, depth: 0 }));

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** A region fires: it flares in `col`, and a signal arcs to it from `from`. */
  pulse(region: RegionKey, col: Rgb, now: number, from: RegionKey = 'thalamus'): void {
    const r = RID[region];
    this.lastActive = now;
    this.glowTarget[r] = 1;
    this.glowCol[r] = col;
    const jit = (a: V3): V3 => [a[0] + (this.rand() - 0.5) * 0.12, a[1] + (this.rand() - 0.5) * 0.12, a[2] + (this.rand() - 0.5) * 0.12];
    const p0 = jit((REGIONS[RID[from]] as Region).anchor), p2 = jit((REGIONS[r] as Region).anchor);
    const k = 1.35 + 0.3 * this.rand();
    const mid: V3 = [((p0[0] + p2[0]) / 2) * k, ((p0[1] + p2[1]) / 2) * k + 0.3, ((p0[2] + p2[2]) / 2) * k];
    this.signals.push({ p0, mid, p2, reg: r, col, born: now, dur: 1400 });
  }

  /** Holds a region lit while a mechanism is picked (called every frame it is). */
  light(region: RegionKey, col: Rgb, amount = 0.9): void {
    this.poked = true;
    const r = RID[region];
    this.glowCol[r] = col;
    this.glowTarget[r] = Math.max(this.glowTarget[r] ?? 0, amount);
  }

  /** Sways the view and lets glows ease and fade; `dt` in milliseconds. */
  step(now: number, dt: number): void {
    if (this.lastActive < 0 || this.poked) { this.lastActive = now; this.poked = false; }
    const awake = now - this.lastActive < this.restAfter ? 1 : 0;
    this.motion += (awake - this.motion) * Math.min(1, dt / 2500);
    if (awake === 0 && this.motion < 0.004) this.motion = 0; // settled: rest exactly
    if (this.spin !== 0 && this.motion > 0) {
      this.phase += this.spin * dt * this.motion;
      this.rotY = this.yawCentre + this.yawSwing * Math.sin(this.phase);
    }
    for (let i = 0; i < REGIONS.length; i++) {
      const g = this.glow[i] ?? 0, tg = this.glowTarget[i] ?? 0;
      this.glow[i] = g + (tg - g) * Math.min(1, 0.012 * dt);
      this.glowTarget[i] = tg * Math.pow(0.9993, dt);
    }
    this.signals = this.signals.filter(s => now - s.born < s.dur * 1.25);
  }

  /**
   * What the next tick should draw: `burst` every tick (a signal is arcing),
   * `calm` at `calmFps` (swaying, or a glow fading), `rest` nothing at all
   * (the last frame stands until something fires).
   */
  mode(): 'burst' | 'calm' | 'rest' {
    if (this.signals.length > 0) return 'burst';
    if (this.motion > 0.004) return 'calm';
    for (let i = 0; i < REGIONS.length; i++) if ((this.glow[i] ?? 0) > 0.03 || (this.glowTarget[i] ?? 0) > 0.03) return 'calm';
    return 'rest';
  }

  private scratchFor(cols: number, rows: number): Scratch {
    const s = this.scratch;
    if (s !== null && s.cols === cols && s.rows === rows) return s;
    const DW = cols * 2, DH = rows * 4, n = DW * DH;
    const made: Scratch = {
      cols, rows, DW, DH,
      dep: new Float32Array(n), grp: new Int8Array(n), eid: new Int8Array(n),
      idep: new Float32Array(n), igrp: new Int8Array(n),
      hx: new Float32Array(n), hy: new Float32Array(n), hz: new Float32Array(n), val: new Float32Array(n),
      pri: new Uint8Array(n), col: new Uint32Array(n),
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
    const { DW, DH, dep, grp, eid, idep, igrp, hx, hy, hz, val, pri, col, out } = S;
    const mono = opts.mono === true;
    const glow = this.glow;

    // the view: orthographic, yaw about y then pitch
    const th = this.rotY, ph = this.rotX;
    const fx = Math.cos(th) * Math.cos(ph), fy = -Math.sin(ph), fz = -Math.sin(th) * Math.cos(ph); // into the screen
    const rx = -Math.sin(th), ry = 0, rz = -Math.cos(th); // screen right
    const ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx; // screen up
    const SC = Math.min(DW / 2.1, DH / 1.62 / DOT_ASPECT), SV = SC * DOT_ASPECT;
    const midX = DW / 2, midY = DH / 2 - 0.15 * SV;

    // 1. rays: the nearest outer surface per dot, and the nearest inner one
    dep.fill(Infinity); grp.fill(-1); idep.fill(Infinity); igrp.fill(-1);
    const cast = (list: readonly Ell[], D: Float32Array, Gb: Int8Array, E: Int8Array | null): void => {
      for (let k = 0; k < list.length; k++) {
        const e = list[k] as Ell;
        const loc = (x: number, y: number, z: number): [number, number, number] =>
          [x * e.ix, (y * e.ct + z * e.st) * e.iy, (-y * e.st + z * e.ct) * e.iz];
        const [lrx, lry, lrz] = loc(rx, ry, rz), [lux, luy, luz] = loc(ux, uy, uz), [lfx, lfy, lfz] = loc(fx, fy, fz);
        const [lox, loy, loz] = loc(-FAR * fx - e.cx, -FAR * fy - e.cy, -FAR * fz - e.cz);
        const a = lfx * lfx + lfy * lfy + lfz * lfz;
        const su = e.cx * rx + e.cy * ry + e.cz * rz, sv = e.cx * ux + e.cy * uy + e.cz * uz, R = e.rmax * 1.02;
        const X0 = Math.max(0, Math.floor(midX + (su - R) * SC)), X1 = Math.min(DW - 1, Math.ceil(midX + (su + R) * SC));
        const Y0 = Math.max(0, Math.floor(midY - (sv + R) * SV)), Y1 = Math.min(DH - 1, Math.ceil(midY - (sv - R) * SV));
        for (let Y = Y0; Y <= Y1; Y++) {
          const v = (midY - (Y + 0.5)) / SV;
          const bx = lox + v * lux, by = loy + v * luy, bz = loz + v * luz;
          for (let X = X0; X <= X1; X++) {
            const u = (X + 0.5 - midX) / SC;
            const ox = bx + u * lrx, oy = by + u * lry, oz = bz + u * lrz;
            const hb = ox * lfx + oy * lfy + oz * lfz, c = ox * ox + oy * oy + oz * oz - 1;
            const disc = hb * hb - a * c;
            if (disc < 0) continue;
            const d = (-hb - Math.sqrt(disc)) / a - FAR;
            const i = Y * DW + X;
            if (d < (D[i] as number)) { D[i] = d; Gb[i] = e.g; if (E !== null) E[i] = k; }
          }
        }
      }
    };
    cast(OUTER, dep, grp, eid);
    cast(INNER, idep, igrp, null);

    // 2. hit points, and what each dot shows
    pri.fill(0); col.fill(0);
    const put = (i: number, p: number, c: number): void => {
      if (p > (pri[i] as number)) { pri[i] = p; col[i] = c; }
    };
    for (let Y = 0; Y < DH; Y++) {
      const v = (midY - (Y + 0.5)) / SV;
      for (let X = 0; X < DW; X++) {
        const i = Y * DW + X;
        if ((grp[i] as number) < 0) continue;
        const u = (X + 0.5 - midX) / SC, d = dep[i] as number;
        hx[i] = rx * u + ux * v + fx * d; hy[i] = ry * u + uy * v + fy * d; hz[i] = rz * u + uz * v + fz * d;
      }
    }
    const regionOf = (g: number, z: number): number =>
      g <= CER_R ? (z > 0.56 ? RID.prefrontal : RID.cortex) : g <= TMP_R ? RID.cortex : g <= CBL_R ? RID.cerebellum : RID.brainstem;
    const lit = (reg: number): number => (mono ? 0 : (glow[reg] ?? 0));
    const flare = (reg: number, base: number): number => {
      const g = lit(reg), gc = this.glowCol[reg];
      if (g < 0.05 || !gc) return base;
      const m = Math.min(1, g * 1.4);
      const br = (base >> 16) & 255, bgc = (base >> 8) & 255, bb = base & 255;
      return pack(br + (gc[0] * 255 - br) * m, bgc + (gc[1] * 255 - bgc) * m, bb + (gc[2] * 255 - bb) * m);
    };
    const cortexCol = (y: number, z: number, k: number, white = 0): number => {
      const w = Math.max(0, Math.min(1, 0.45 + 0.85 * y - 0.3 * z));
      const r = CYAN[0] + (TEAL[0] - CYAN[0]) * w, g = CYAN[1] + (TEAL[1] - CYAN[1]) * w, b = CYAN[2] + (TEAL[2] - CYAN[2]) * w;
      return pack((r + (255 - r) * white) * k, (g + (255 - g) * white) * k, (b + (255 - b) * white) * k);
    };
    type Kind = 'outline' | 'crease' | 'fold' | 'gyrus';
    const lineCol = (g: number, i: number, kind: Kind): number => {
      if (g === STEM) return kind === 'outline' ? STEM_COL.outline : STEM_COL.crease;
      if (g >= CBL_L) return kind === 'outline' ? CBL_COL.outline : kind === 'crease' ? CBL_COL.crease : CBL_COL.fold;
      if (kind === 'outline') return CORTEX_OUTLINE;
      if (kind === 'gyrus') return cortexCol(hy[i] as number, hz[i] as number, 0.9);
      return cortexCol(hy[i] as number, hz[i] as number, 1, kind === 'crease' ? 0.3 : 0.12);
    };
    const mark = (i: number, p: number, kind: Kind): void => {
      const g = grp[i] as number, reg = regionOf(g, hz[i] as number);
      if (lit(reg) >= 0.05) put(i, P_LIT, flare(reg, lineCol(g, i, kind)));
      else put(i, p, lineCol(g, i, kind));
    };
    const JUMP = 3.5 / SC;
    for (let Y = 0; Y < DH; Y++) {
      for (let X = 0; X < DW; X++) {
        const i = Y * DW + X, g = grp[i] as number;
        if (g < 0) continue;
        // the silhouette
        if (X === 0 || Y === 0 || X === DW - 1 || Y === DH - 1 || (grp[i - 1] as number) < 0 || (grp[i + 1] as number) < 0
          || (grp[i - DW] as number) < 0 || (grp[i + DW] as number) < 0) {
          mark(i, P_OUTLINE, 'outline');
          continue;
        }
        // occlusion edges and the creases between parts, against the right and lower neighbours
        for (let jj = 0; jj < 2; jj++) {
          const j = jj === 0 ? i + 1 : i + DW;
          const gj = grp[j] as number;
          const di = dep[i] as number, dj = dep[j] as number;
          if (Math.abs(di - dj) > JUMP) {
            // one hemisphere in front of the other is the midline cleft: a fold, not a second outline
            const near = di < dj ? i : j, far = near === i ? j : i;
            const gn = grp[near] as number, gf = grp[far] as number;
            if (gn <= TMP_R && gf <= TMP_R && (gn & 1) !== (gf & 1)) mark(near, P_FOLD, 'fold');
            else mark(near, P_OUTLINE, 'outline');
          }
          else if (gj !== g) {
            const lo = Math.min(g, gj), hi = Math.max(g, gj);
            if (lo === CBL_L && hi === CBL_R) mark(g === CBL_R ? i : j, P_FOLD, 'fold');
            else if (lo === CER_L && hi === CER_R) mark(g === CER_R ? i : j, P_FOLD, 'fold'); // the midline: quiet, or it reads as a second outline
            else {
              mark(g === hi ? i : j, P_FISSURE, 'crease');
            }
          }
        }
      }
    }
    // the sulci and the folia: sign changes between neighbours of one part
    const facing = (i: number): number => {
      const k = eid[i] as number, e = OUTER[k] as Ell;
      const dx = (hx[i] as number) - e.cx, dy = (hy[i] as number) - e.cy, dz = (hz[i] as number) - e.cz;
      const nx = dx * e.ix * e.ix, ly = (dy * e.ct + dz * e.st) * e.iy * e.iy, lz = (-dy * e.st + dz * e.ct) * e.iz * e.iz;
      const ny = ly * e.ct - lz * e.st, nz = ly * e.st + lz * e.ct;
      return Math.abs(nx * fx + ny * fy + nz * fz) / Math.sqrt(nx * nx + ny * ny + nz * nz);
    };
    const crossings = (on: 'cer' | 'tmp' | 'cortex' | 'cbl', f: (ax: number, y: number, z: number) => number, kind: Kind): void => {
      for (let i = 0; i < DW * DH; i++) {
        const g = grp[i] as number;
        const want = g < 0 ? false : on === 'cbl' ? g === CBL_L || g === CBL_R : on === 'cer' ? g <= CER_R : on === 'tmp' ? g === TMP_L || g === TMP_R : g <= TMP_R;
        val[i] = want ? f(Math.abs(hx[i] as number), hy[i] as number, hz[i] as number) : NaN_;
      }
      for (let Y = 0; Y < DH - 1; Y++) {
        for (let X = 0; X < DW - 1; X++) {
          const i = Y * DW + X, a = val[i] as number;
          if (Number.isNaN(a)) continue;
          for (let jj = 0; jj < 2; jj++) {
            const j = jj === 0 ? i + 1 : i + DW;
            const b = val[j] as number;
            if (Number.isNaN(b) || grp[j] !== grp[i] || (a >= 0) === (b >= 0)) continue;
            const m = a >= 0 ? i : j;
            if (facing(m) > 0.18) mark(m, P_FOLD, kind);
          }
        }
      }
    };
    if (this.gyri !== 'anatomy') {
      const k = this.gyriK * Math.sqrt(SC / 35); // finer folds as the brain grows
      crossings('cortex', (ax, y, z) => Math.sin(k * (0.8 * ax + 0.6 * y) + 1.3) + Math.sin(k * (-0.45 * y + 0.89 * z) + 2.1)
        + Math.sin(k * (0.55 * z - 0.83 * ax) + 0.4) + 0.8 * Math.sin(k * 1.6 * (0.36 * ax + 0.66 * y - 0.66 * z) + 2.7), 'gyrus');
    }
    if (this.gyri !== 'maze') for (const s of SULCI) if (this.gyri === 'anatomy' || s.major) crossings(s.tmp ? 'tmp' : 'cer', s.f, 'fold');
    crossings('cbl', (ax, y, z) => Math.sin(Math.atan2(y + 0.46, -(z + 0.12)) * 15 + ax * 2), 'fold');

    // 3. the stipple: fixed surface points, where they face us
    {
      const want = Math.min(1, (this.stippleDensity * 6 * SC * SC) / (STIPPLE.n * 0.5)); // measured: about this many show per dot of face
      const { P, G, rank } = STIPPLE;
      const eps = 1.6 / SC;
      let most = 0;
      for (let i = 0; i < REGIONS.length; i++) most = Math.max(most, lit(i));
      const stop = want * (1 + 1.6 * most);
      for (let k = 0; k < STIPPLE.n && (rank[k] as number) < stop; k++) {
        const g = G[k] as number;
        const x = P[k * 3] as number, y = P[k * 3 + 1] as number, z = P[k * 3 + 2] as number;
        const reg = regionOf(g, z), gl = lit(reg);
        const r = rank[k] as number;
        if (r >= want * (1 + 1.6 * gl)) continue;
        const X = Math.floor(midX + (x * rx + y * ry + z * rz) * SC), Y = Math.floor(midY - (x * ux + y * uy + z * uz) * SV);
        if (X < 0 || Y < 0 || X >= DW || Y >= DH) continue;
        const i = Y * DW + X;
        if (x * fx + y * fy + z * fz > (dep[i] as number) + eps) continue;
        const base = g === STEM ? STEM_COL.stipple : g >= CBL_L ? CBL_COL.stipple : cortexCol(y, z, 0.46);
        if (gl >= 0.05 && r >= want) put(i, P_LIT, flare(reg, base));
        else put(i, P_STIPPLE, gl >= 0.05 ? flare(reg, base) : base);
      }
    }

    // 4. the inner structures, behind glass: outlined and lightly filled in
    // their own colours (a checker inside once they are big enough to show
    // one); lit, filled solid in the stage colour with a halo a dot or two wide
    const halo = Math.max(2, Math.round(SC / 17));
    const checker = SC > 50;
    for (let Y = 0; Y < DH; Y++) {
      for (let X = 0; X < DW; X++) {
        const i = Y * DW + X, g = igrp[i] as number;
        if (g < 0) continue;
        const reg = INNER_REG[g] as number, gl = lit(reg);
        const edge = X === 0 || Y === 0 || X === DW - 1 || Y === DH - 1 || igrp[i - 1] !== g || igrp[i + 1] !== g || igrp[i - DW] !== g || igrp[i + DW] !== g;
        const base = INNER_COL[g] as number;
        if (gl >= 0.05) {
          const core = flare(reg, base), m = Math.min(1, gl);
          put(i, P_LIT, edge ? core : pack(((core >> 16) & 255) + (255 - ((core >> 16) & 255)) * 0.35 * m, ((core >> 8) & 255) + (255 - ((core >> 8) & 255)) * 0.35 * m, (core & 255) + (255 - (core & 255)) * 0.35 * m));
          if (edge) {
            for (let dy = -halo; dy <= halo; dy++) for (let dx = -halo; dx <= halo; dx++) {
              const x2 = X + dx, y2 = Y + dy;
              if (x2 < 0 || y2 < 0 || x2 >= DW || y2 >= DH || dx * dx + dy * dy > halo * halo + 1) continue;
              const j = y2 * DW + x2;
              if (igrp[j] !== g) put(j, P_LIT, dim(core, 0.8));
            }
          }
        } else if (edge) put(i, P_INNER, base);
        else if (!checker || ((X + Y) & 1) === 0) put(i, P_INNER, dim(base, 0.7));
      }
    }

    // 5. signals arcing between regions
    if (!mono) {
      for (const s of this.signals) {
        const tt = Math.min(1, (now - s.born) / s.dur);
        const fade = now - s.born < s.dur ? 1 : 1 - (now - s.born - s.dur) / (s.dur * 0.25);
        if (fade <= 0) continue;
        for (let k = 0; k <= 14; k++) {
          const t = tt - k * 0.022;
          if (t < 0) break;
          const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
          const x = a * s.p0[0] + b * s.mid[0] + c * s.p2[0], y = a * s.p0[1] + b * s.mid[1] + c * s.p2[1], z = a * s.p0[2] + b * s.mid[2] + c * s.p2[2];
          const X = Math.floor(midX + (x * rx + y * ry + z * rz) * SC), Y = Math.floor(midY - (x * ux + y * uy + z * uz) * SV);
          if (X < 0 || Y < 0 || X >= DW || Y >= DH) continue;
          const kk = (1 - k / 14) * fade;
          put(Y * DW + X, P_SIGNAL, k === 0 ? pack(255, 255, 255) : pack(s.col[0] * 255 * (0.5 + 0.5 * kk), s.col[1] * 255 * (0.5 + 0.5 * kk), s.col[2] * 255 * (0.5 + 0.5 * kk)));
        }
      }
    }

    // where each region's anchor sits, in cells
    for (let r = 0; r < REGIONS.length; r++) {
      const a = (REGIONS[r] as Region).anchor;
      const slot = this.anchors[r];
      if (slot === undefined) continue;
      slot.x = (midX + (a[0] * rx + a[1] * ry + a[2] * rz) * SC) / 2;
      slot.y = (midY - (a[0] * ux + a[1] * uy + a[2] * uz) * SV) / 4;
      slot.depth = a[0] * fx + a[1] * fy + a[2] * fz;
    }

    // 6. cells: the strongest kind in a cell sets its colour; lines always show, stipple only among lines as faint
    // a spotlight: while a region is lit the rest steps back, so even a cyan flare shows on the cyan brain
    let focus = 0;
    if (!mono) for (let i = 0; i < REGIONS.length; i++) focus = Math.max(focus, glow[i] ?? 0);
    const spot = 1 - 0.4 * Math.min(1, focus);
    const base = opts.bg ?? null;
    const bg = base === null ? DEFAULT_COLOR : pack(base[0], base[1], base[2]);
    for (let ry2 = 0; ry2 < rows; ry2++) {
      for (let rx2 = 0; rx2 < cols; rx2++) {
        let top = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
          const p = pri[(ry2 * 4 + dy) * DW + rx2 * 2 + dx] as number;
          if (p > top) top = p;
        }
        const o = (ry2 * cols + rx2) * 3;
        if (top === 0) { out[o] = 0x20; out[o + 1] = DEFAULT_COLOR; out[o + 2] = bg; continue; }
        let bits = 0, n = 0, r = 0, g = 0, b = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
          const i = (ry2 * 4 + dy) * DW + rx2 * 2 + dx, p = pri[i] as number;
          if (p === 0 || (p < P_FOLD && top > P_FOLD)) continue;
          bits |= (BRAILLE[dy] as number[])[dx] ?? 0;
          if (p === top) { const c = col[i] as number; r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; n++; }
        }
        out[o] = bits ? 0x2800 + bits : 0x20;
        if (mono) { const v = MONO_GREY[top] ?? 120; out[o + 1] = pack(v, v + 3, v + 7); }
        else { const k = top >= P_LIT ? 1 : spot; out[o + 1] = pack((r / n) * k, (g / n) * k, (b / n) * k); }
        out[o + 2] = bg;
      }
    }
    if (opts.tag && !mono) this.drawTag(out, cols, rows, opts.tag);
    return out;
  }

  /** `◆` on the region's anchor and ` Name ` on its stage colour beside it. */
  private drawTag(out: Uint32Array, cols: number, rows: number, tag: { region: RegionKey; label: string; col: Rgb }): void {
    const a = this.anchors[RID[tag.region]];
    if (a === undefined) return;
    const ax = Math.floor(a.x), ay = Math.floor(a.y);
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
