/**
 * The lab's terminal metrics and panel layout, shared by the page (lab.ts,
 * bundled for the browser) and the shooter (shoot.ts, run by bun), so both
 * agree on every panel's size in CSS pixels.
 *
 * The metrics are Mike's iTerm2 default profile: Menlo-Regular 13, spacing
 * 1.0 both ways. Menlo's advance is 0.602 em (7.83 px); iTerm rounds the cell
 * up to 8 x 16, which his Retina screenshot confirms (dot columns repeat every
 * 16 device px, rows every 32). Braille falls back to a system font that draws
 * only the set dots, in iTerm and in Chrome alike, so the dots cluster 2 x 4
 * per cell with wider gaps between cells, as they do in the terminal.
 */

export const CW = 8;
export const CH = 16;
export const FONT_PX = 13;
export const PAD = 14;
export const LABEL_H = 20;
export const GAP = 18;
export const BG = '#05080c';

export type Flare = { region: string; hex: string };

export type Panel = {
  name: string;
  label: string;
  cols: number;
  rows: number;
  /** Degrees: 0 is the left side (front at screen left), 90 the front, -45 three-quarter back. */
  yaw: number;
  /** Degrees: the camera above, looking down. */
  pitch?: number;
  flare?: Flare | null;
  tag?: string | null;
  mono?: boolean;
  /** Milliseconds since the brain's epoch, for time-varying effects. */
  t?: number;
};

export function panelSize(p: Panel): { w: number; h: number } {
  return { w: Math.ceil(p.cols * CW) + 2 * PAD, h: p.rows * CH + 2 * PAD + LABEL_H };
}

/** Rows of panels, left to right; returns each panel's origin and the sheet's size. */
export function sheetLayout(rows: Panel[][]): { at: { p: Panel; x: number; y: number }[]; w: number; h: number } {
  const at: { p: Panel; x: number; y: number }[] = [];
  let y = GAP, w = 0;
  for (const row of rows) {
    let x = GAP, rh = 0;
    for (const p of row) {
      const s = panelSize(p);
      at.push({ p, x, y });
      x += s.w + GAP;
      rh = Math.max(rh, s.h);
    }
    w = Math.max(w, x);
    y += rh + GAP;
  }
  return { at, w, h: y + 24 };
}

/** Real pairings: Prospective lights the prefrontal cortex in Retrieval's amber; Salience the amygdala in Encoding's cyan. */
const AMBER = { region: 'prefrontal', hex: '#ffc94d' };
const CYAN = { region: 'amygdala', hex: '#00e5ff' };

/** The round's frames: the brief's list, in the contact sheet's rows. */
export const ROUND: Panel[][] = [
  [
    { name: 'side', label: '42x14 side (front left)', cols: 42, rows: 14, yaw: 0 },
    { name: 'tq-front', label: '42x14 three-quarter front-left', cols: 42, rows: 14, yaw: 40 },
    { name: 'front', label: '42x14 front', cols: 42, rows: 14, yaw: 90 },
    { name: 'tq-back', label: '42x14 three-quarter back', cols: 42, rows: 14, yaw: -45 },
  ],
  [
    { name: 'flare-amber', label: '42x14 flare: prefrontal amber #ffc94d', cols: 42, rows: 14, yaw: 20, flare: AMBER, tag: 'Prospective' },
    { name: 'flare-cyan', label: '42x14 flare: amygdala cyan #00e5ff', cols: 42, rows: 14, yaw: 20, flare: CYAN, tag: 'Salience' },
    { name: 'inline', label: '30x10 inline, three-quarter', cols: 30, rows: 10, yaw: 30 },
    { name: 'mono', label: '42x14 paused (grey)', cols: 42, rows: 14, yaw: 20, mono: true },
  ],
  [
    { name: 'hero', label: '90x32 hero, three-quarter', cols: 90, rows: 32, yaw: 30 },
  ],
];

export function findPanel(name: string): Panel | undefined {
  for (const row of ROUND) for (const p of row) if (p.name === name) return p;
  return undefined;
}
