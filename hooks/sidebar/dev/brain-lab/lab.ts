/**
 * The lab page: renders `Brain` frames and paints them the way iTerm2 would.
 * One foreground and one background per cell; braille drawn as font glyphs
 * (Menlo, falling back for U+2800 to the system cascade as the terminal does: only
 * the set dots are drawn); block elements
 * drawn flush. Bundled for the browser by shoot.ts.
 *
 * Query: `?only=<panel>` one panel of the round (see layout.ts), otherwise the
 * whole contact sheet; `&title=` a heading on the sheet; `&baseline=1` leaves
 * the brain's own angles alone (for shooting the brain as it was).
 */

import { Brain, DEFAULT_COLOR } from '../../hooks/brain';
import type { RegionKey, Rgb } from '../../hooks/mechanisms';
import { BG, CH, CW, FONT_PX, LABEL_H, PAD, ROUND, findPanel, panelSize, sheetLayout, type Panel } from './layout';

const T0 = 1_760_000_000_000;
const params = new URLSearchParams(location.search);
const baseline = params.has('baseline');

function rgb01(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function css(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function renderCells(p: Panel): Uint32Array {
  const b = new Brain() as Brain & { spin: number; rotY: number; rotX: number };
  b.spin = 0;
  const gy = params.get('gyri');
  if (gy !== null) (b as unknown as { gyri: string }).gyri = gy;
  const sd = params.get('stipple');
  if (sd !== null) (b as unknown as { stippleDensity: number }).stippleDensity = Number(sd);
  const gk = params.get('gyriK');
  if (gk !== null) (b as unknown as { gyriK: number }).gyriK = Number(gk);
  if (!baseline) {
    b.rotY = (p.yaw * Math.PI) / 180;
    if (p.pitch !== undefined) b.rotX = (p.pitch * Math.PI) / 180;
  }
  const t = T0 + (p.t ?? 0);
  let tag: { region: RegionKey; label: string; col: Rgb } | null = null;
  if (p.flare) {
    const col = rgb01(p.flare.hex);
    const region = p.flare.region as RegionKey;
    for (let i = 0; i < 40; i++) {
      b.light(region, col, 1);
      b.step(t - 2000 + i * 50, 50);
    }
    if (p.tag) tag = { region, label: p.tag, col };
  } else {
    b.step(t, 0);
  }
  return b.frame(p.cols, p.rows, t, { mono: p.mono === true, tag, bg: [5, 8, 12] });
}

function paint(ctx: CanvasRenderingContext2D, cells: Uint32Array, cols: number, rows: number, ox: number, oy: number): void {
  ctx.font = `${FONT_PX}px Menlo, monospace`;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText('M');
  const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
  const base = (CH - (asc + desc)) / 2 + asc;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const o = (r * cols + c) * 3;
      const cp = cells[o] ?? 0x20, fg = cells[o + 1] ?? DEFAULT_COLOR, bg = cells[o + 2] ?? DEFAULT_COLOR;
      const x0 = Math.round(ox + c * CW), x1 = Math.round(ox + (c + 1) * CW);
      const y0 = oy + r * CH;
      if (bg !== DEFAULT_COLOR) {
        ctx.fillStyle = css(bg);
        ctx.fillRect(x0, y0, x1 - x0, CH);
      }
      if (cp === 0x20) continue;
      ctx.fillStyle = fg === DEFAULT_COLOR ? '#d7dde4' : css(fg);
      const w = x1 - x0;
      if (cp === 0x2588) { ctx.fillRect(x0, y0, w, CH); continue; }
      if (cp === 0x258c) { ctx.fillRect(x0, y0, Math.round(w / 2), CH); continue; }
      if (cp === 0x2590) { ctx.fillRect(x0 + Math.round(w / 2), y0, w - Math.round(w / 2), CH); continue; }
      if (cp === 0x2580) { ctx.fillRect(x0, y0, w, CH / 2); continue; }
      if (cp === 0x2584) { ctx.fillRect(x0, y0 + CH / 2, w, CH / 2); continue; }
      ctx.fillText(String.fromCharCode(cp), ox + c * CW, y0 + base);
    }
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, p: Panel, x: number, y: number): void {
  const s = panelSize(p);
  ctx.fillStyle = BG;
  ctx.fillRect(x, y, s.w, s.h);
  ctx.strokeStyle = '#1a222b';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + LABEL_H + 0.5, s.w - 1, s.h - LABEL_H - 1);
  ctx.font = '12px Menlo, monospace';
  ctx.fillStyle = '#8a96a3';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(p.label, x + 2, y + 14);
  const t0 = performance.now();
  const cells = renderCells(p);
  const ms = performance.now() - t0;
  paint(ctx, cells, p.cols, p.rows, x + PAD, y + LABEL_H + PAD);
  (window as unknown as { labTimes: Record<string, number> }).labTimes ??= {};
  (window as unknown as { labTimes: Record<string, number> }).labTimes[p.name] = ms;
}

function main(): void {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const dpr = window.devicePixelRatio || 1;
  const only = params.get('only');
  const title = params.get('title');
  let w: number, h: number;
  let jobs: { p: Panel; x: number; y: number }[];
  let top = 0;
  if (only !== null) {
    const p = findPanel(only);
    if (p === undefined) throw new Error(`no panel ${only}`);
    const s = panelSize(p);
    w = s.w; h = s.h; jobs = [{ p, x: 0, y: 0 }];
  } else {
    const L = sheetLayout(ROUND);
    top = title === null ? 0 : 30;
    w = L.w; h = L.h + top; jobs = L.at.map(j => ({ ...j, y: j.y + top }));
  }
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#020407';
  ctx.fillRect(0, 0, w, h);
  if (title !== null) {
    ctx.font = 'bold 14px Menlo, monospace';
    ctx.fillStyle = '#c9d3dd';
    ctx.fillText(title, 18, 22);
  }
  for (const j of jobs) drawPanel(ctx, j.p, j.x, j.y);
  document.title = 'done';
}

main();
