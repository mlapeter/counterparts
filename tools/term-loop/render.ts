/**
 * A cell grid drawn as HTML the way a terminal draws it: a fixed cell box per
 * character (never the font's advance), each cell its own colours, bold, dim,
 * italic, underline and inverse, a wide character across two cells. Box
 * drawing and block elements are drawn as shapes, edge to edge, as iTerm2
 * draws them; braille comes from the font, as iTerm2 takes it. Pure: returns
 * a string.
 *
 * The default theme is the owner's iTerm2 profile (2026-10-10, read from its
 * preferences): Menlo Regular 13, spacing 1 x 1, which iTerm2 lays out in an
 * 8 x 16 point cell; foreground #dcdcdc on #000000, bold in #ffffff with
 * bright bold, faint text at 67% alpha, and its ANSI 0–15.
 */

import type { Cell, Colour, Grid } from './grid.js';

export type Theme = {
  readonly font: string;
  readonly fontSize: number;
  /** One cell, in CSS pixels (the PNG is shot at 2x). */
  readonly cellW: number;
  readonly cellH: number;
  readonly fg: string;
  readonly bg: string;
  /** Bold text in the default foreground takes this colour (iTerm2's "Bold Color"); null keeps fg. */
  readonly boldFg: string | null;
  /** Bold text in ANSI 0–7 is drawn in 8–15 (iTerm2's "Use Bright Bold"). */
  readonly brightBold: boolean;
  /** Faint (SGR 2) text is drawn at this alpha over its background. */
  readonly faint: number;
  readonly cursor: string;
  readonly cursorText: string;
  /** ANSI 0–15. */
  readonly ansi: readonly string[];
  /** Glyphs sit this many CSS pixels below where Chrome puts the baseline (measured against iTerm2). */
  readonly glyphDy: number;
  /** CSS -webkit-font-smoothing: 'antialiased' draws Menlo thinner, nearer iTerm2's strokes. */
  readonly smoothing: 'antialiased' | 'auto';
};

export const ITERM_MENLO_13: Theme = {
  font: "Menlo, 'DejaVu Sans Mono', monospace",
  fontSize: 13,
  cellW: 8,
  cellH: 16,
  fg: '#dcdcdc',
  bg: '#000000',
  boldFg: '#ffffff',
  brightBold: true,
  faint: 0.674,
  cursor: '#ffffff',
  cursorText: '#000000',
  ansi: [
    '#14191e', '#b43c2a', '#00c200', '#c7c400', '#2744c7', '#c040be', '#00c5c7', '#c7c7c7',
    '#686868', '#dd7975', '#58e790', '#ece100', '#a7abf2', '#e17ee1', '#60fdff', '#ffffff',
  ],
  glyphDy: 0.5,
  smoothing: 'antialiased',
};

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

/** The xterm 256-colour palette above the 16 the theme names. */
export function paletteColour(n: number, theme: Theme): string {
  if (n < 16) return theme.ansi[n] ?? theme.fg;
  if (n < 232) {
    const levels = [0, 95, 135, 175, 215, 255];
    const k = n - 16;
    const r = levels[Math.floor(k / 36)] ?? 0;
    const g = levels[Math.floor(k / 6) % 6] ?? 0;
    const b = levels[k % 6] ?? 0;
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  const v = 8 + 10 * (n - 232);
  return `#${hex2(v)}${hex2(v)}${hex2(v)}`;
}

/** What a cell's foreground and background resolve to, after bold-is-bright and inverse. */
export function cellColours(c: Cell, theme: Theme): { fg: string; bg: string } {
  let fg = resolve(c.fg, theme, 'fg', c.bold);
  let bg = resolve(c.bg, theme, 'bg', false);
  if (c.inverse) [fg, bg] = [bg, fg];
  return { fg, bg };
}

function resolve(col: Colour, theme: Theme, role: 'fg' | 'bg', bold: boolean): string {
  if (col.kind === 'rgb') return `#${hex2(col.r)}${hex2(col.g)}${hex2(col.b)}`;
  if (col.kind === 'index') return paletteColour(bold && theme.brightBold && col.n < 8 ? col.n + 8 : col.n, theme);
  if (role === 'bg') return theme.bg;
  return bold && theme.boldFg !== null ? theme.boldFg : theme.fg;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const px = (n: number): string => `${String(Math.round(n * 1000) / 1000)}px`;

// ── shapes iTerm2 draws itself ──────────────────────────────────────────────

/** Block elements U+2580–U+259F as rectangles in cell fractions [x, y, w, h], plus a shade alpha. */
const BLOCKS: Record<string, { rects: readonly (readonly [number, number, number, number])[]; alpha?: number }> = {
  '▀': { rects: [[0, 0, 1, 1 / 2]] },
  '▁': { rects: [[0, 7 / 8, 1, 1 / 8]] },
  '▂': { rects: [[0, 6 / 8, 1, 2 / 8]] },
  '▃': { rects: [[0, 5 / 8, 1, 3 / 8]] },
  '▄': { rects: [[0, 4 / 8, 1, 4 / 8]] },
  '▅': { rects: [[0, 3 / 8, 1, 5 / 8]] },
  '▆': { rects: [[0, 2 / 8, 1, 6 / 8]] },
  '▇': { rects: [[0, 1 / 8, 1, 7 / 8]] },
  '█': { rects: [[0, 0, 1, 1]] },
  '▉': { rects: [[0, 0, 7 / 8, 1]] },
  '▊': { rects: [[0, 0, 6 / 8, 1]] },
  '▋': { rects: [[0, 0, 5 / 8, 1]] },
  '▌': { rects: [[0, 0, 4 / 8, 1]] },
  '▍': { rects: [[0, 0, 3 / 8, 1]] },
  '▎': { rects: [[0, 0, 2 / 8, 1]] },
  '▏': { rects: [[0, 0, 1 / 8, 1]] },
  '▐': { rects: [[1 / 2, 0, 1 / 2, 1]] },
  '░': { rects: [[0, 0, 1, 1]], alpha: 0.25 },
  '▒': { rects: [[0, 0, 1, 1]], alpha: 0.5 },
  '▓': { rects: [[0, 0, 1, 1]], alpha: 0.75 },
  '▔': { rects: [[0, 0, 1, 1 / 8]] },
  '▕': { rects: [[7 / 8, 0, 1 / 8, 1]] },
  '▖': { rects: [[0, 1 / 2, 1 / 2, 1 / 2]] },
  '▗': { rects: [[1 / 2, 1 / 2, 1 / 2, 1 / 2]] },
  '▘': { rects: [[0, 0, 1 / 2, 1 / 2]] },
  '▙': { rects: [[0, 0, 1 / 2, 1], [1 / 2, 1 / 2, 1 / 2, 1 / 2]] },
  '▚': { rects: [[0, 0, 1 / 2, 1 / 2], [1 / 2, 1 / 2, 1 / 2, 1 / 2]] },
  '▛': { rects: [[0, 0, 1, 1 / 2], [0, 1 / 2, 1 / 2, 1 / 2]] },
  '▜': { rects: [[0, 0, 1, 1 / 2], [1 / 2, 1 / 2, 1 / 2, 1 / 2]] },
  '▝': { rects: [[1 / 2, 0, 1 / 2, 1 / 2]] },
  '▞': { rects: [[1 / 2, 0, 1 / 2, 1 / 2], [0, 1 / 2, 1 / 2, 1 / 2]] },
  '▟': { rects: [[1 / 2, 0, 1 / 2, 1], [0, 1 / 2, 1 / 2, 1 / 2]] },
};

/** Box drawing: which arms leave the centre (up, right, down, left), how heavy, and whether the corner is round. */
type Arms = { readonly u: number; readonly r: number; readonly d: number; readonly l: number; readonly round?: true };

const BOX: Record<string, Arms> = {
  '─': { u: 0, r: 1, d: 0, l: 1 },
  '━': { u: 0, r: 2, d: 0, l: 2 },
  '│': { u: 1, r: 0, d: 1, l: 0 },
  '┃': { u: 2, r: 0, d: 2, l: 0 },
  '┌': { u: 0, r: 1, d: 1, l: 0 },
  '┐': { u: 0, r: 0, d: 1, l: 1 },
  '└': { u: 1, r: 1, d: 0, l: 0 },
  '┘': { u: 1, r: 0, d: 0, l: 1 },
  '├': { u: 1, r: 1, d: 1, l: 0 },
  '┤': { u: 1, r: 0, d: 1, l: 1 },
  '┬': { u: 0, r: 1, d: 1, l: 1 },
  '┴': { u: 1, r: 1, d: 0, l: 1 },
  '┼': { u: 1, r: 1, d: 1, l: 1 },
  '┏': { u: 0, r: 2, d: 2, l: 0 },
  '┓': { u: 0, r: 0, d: 2, l: 2 },
  '┗': { u: 2, r: 2, d: 0, l: 0 },
  '┛': { u: 2, r: 0, d: 0, l: 2 },
  '╭': { u: 0, r: 1, d: 1, l: 0, round: true },
  '╮': { u: 0, r: 0, d: 1, l: 1, round: true },
  '╯': { u: 1, r: 0, d: 0, l: 1, round: true },
  '╰': { u: 1, r: 1, d: 0, l: 0, round: true },
  '╴': { u: 0, r: 0, d: 0, l: 1 },
  '╵': { u: 1, r: 0, d: 0, l: 0 },
  '╶': { u: 0, r: 1, d: 0, l: 0 },
  '╷': { u: 0, r: 0, d: 1, l: 0 },
};

/** An inline SVG for one box-drawing cell: straight arms from the centre, or a quarter arc for a round corner. */
function boxSvg(a: Arms, w: number, h: number, colour: string): string {
  const cx = w / 2;
  const cy = h / 2;
  const sw = (n: number): number => (n === 2 ? 2 : 1);
  const parts: string[] = [];
  if (a.round === true) {
    const r = Math.min(cx, cy);
    const vx = cx;
    const vy = a.d > 0 ? h : 0; // the vertical arm's far end
    const hx = a.r > 0 ? w : 0; // the horizontal arm's far end
    const sy = a.d > 0 ? cy + r : cy - r;
    const sx = a.r > 0 ? cx + r : cx - r;
    const sweep = (a.d > 0 && a.r > 0) || (a.u > 0 && a.l > 0) ? 1 : 0;
    parts.push(`<path d="M${vx} ${vy}V${sy}A${r} ${r} 0 0 ${sweep} ${sx} ${cy}H${hx}" stroke-width="1"/>`);
  } else {
    if (a.u > 0) parts.push(`<path d="M${cx} 0V${cy}" stroke-width="${sw(a.u)}"/>`);
    if (a.d > 0) parts.push(`<path d="M${cx} ${cy}V${h}" stroke-width="${sw(a.d)}"/>`);
    if (a.l > 0) parts.push(`<path d="M0 ${cy}H${cx}" stroke-width="${sw(a.l)}"/>`);
    if (a.r > 0) parts.push(`<path d="M${cx} ${cy}H${w}" stroke-width="${sw(a.r)}"/>`);
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" stroke="${colour}" stroke-linecap="square">${parts.join('')}</svg>`;
}

export function isBraille(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x2800 && cp <= 0x28ff;
}

// ── the page ────────────────────────────────────────────────────────────────

export type RenderOpts = {
  /** The terminal cursor (0-based cell), drawn as iTerm2's filled box; null or absent draws none. */
  readonly cursor?: { readonly x: number; readonly y: number } | null;
  readonly title?: string;
};

export function gridPixels(g: Grid, theme: Theme = ITERM_MENLO_13): { w: number; h: number } {
  return { w: g.cols * theme.cellW, h: g.rows * theme.cellH };
}

/** One row's HTML: background runs, then shapes and glyphs, each placed at its own cell. */
export function renderRow(row: readonly Cell[], y: number, theme: Theme, cursorX: number | null): string {
  const W = theme.cellW;
  const H = theme.cellH;
  const out: string[] = [];
  // backgrounds, merged into runs of one colour (the page's own bg is left unpainted)
  let runStart = 0;
  let runBg: string | null = null;
  const flush = (end: number): void => {
    if (runBg !== null && runBg !== theme.bg) out.push(`<i style="left:${px(runStart * W)};width:${px((end - runStart) * W)};background:${runBg}"></i>`);
  };
  for (let x = 0; x <= row.length; x++) {
    const c = row[x];
    const bg = c === undefined ? null : x === cursorX ? theme.cursor : cellColours(c, theme).bg;
    if (bg !== runBg) {
      flush(x);
      runStart = x;
      runBg = bg;
    }
  }
  for (let x = 0; x < row.length; x++) {
    const c = row[x];
    if (c === undefined || c.width === 0) continue;
    const { fg: fg0 } = cellColours(c, theme);
    const fg = x === cursorX ? theme.cursorText : fg0;
    const left = x * W;
    const cw = c.width * W;
    const op = c.dim ? `;opacity:${String(theme.faint)}` : '';
    if (c.underline || c.strike) {
      const ty = c.underline ? H - 2 : Math.round(H / 2);
      out.push(`<i style="left:${px(left)};top:${px(ty)};width:${px(cw)};height:1px;background:${fg}${op}"></i>`);
    }
    if (c.hidden || c.ch === ' ' || c.ch === '') continue;
    const block = BLOCKS[c.ch];
    if (block !== undefined) {
      for (const [bx, by, bw, bh] of block.rects) {
        const alpha = (block.alpha ?? 1) * (c.dim ? theme.faint : 1);
        out.push(`<i style="left:${px(left + bx * W)};top:${px(by * H)};width:${px(bw * W)};height:${px(bh * H)};background:${fg}${alpha < 1 ? `;opacity:${String(alpha)}` : ''}"></i>`);
      }
      continue;
    }
    const box = BOX[c.ch];
    if (box !== undefined) {
      out.push(`<s style="left:${px(left)}${op}">${boxSvg(box, W, H, fg)}</s>`);
      continue;
    }
    const style = [`left:${px(left)}`, `width:${px(cw)}`, `color:${fg}`];
    if (c.bold) style.push('font-weight:bold');
    if (c.italic) style.push('font-style:italic');
    if (c.dim) style.push(`opacity:${String(theme.faint)}`);
    out.push(`<b style="${style.join(';')}">${esc(c.ch)}</b>`);
  }
  return `<div style="top:${px(y * H)}">${out.join('')}</div>`;
}

/** The whole grid as one self-contained HTML page sized to the grid. */
export function renderHtml(g: Grid, theme: Theme = ITERM_MENLO_13, opts: RenderOpts = {}): string {
  const { w, h } = gridPixels(g, theme);
  const rows = g.cells.map((row, y) => renderRow(row, y, theme, opts.cursor !== undefined && opts.cursor !== null && opts.cursor.y === y ? opts.cursor.x : null));
  const H = px(theme.cellH);
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${esc(opts.title ?? 'term-loop')}</title>`,
    '<style>',
    `html,body{margin:0;padding:0;background:${theme.bg}}`,
    `#t{position:relative;width:${px(w)};height:${px(h)};overflow:hidden;font-family:${theme.font};font-size:${px(theme.fontSize)};line-height:${H};font-variant-ligatures:none;font-kerning:none;font-synthesis:none;-webkit-font-smoothing:${theme.smoothing}}`,
    `#t>div{position:absolute;left:0;width:100%;height:${H}}`,
    `#t i,#t b,#t s{position:absolute;top:0;display:block;height:${H}}`,
    `#t b{top:${px(theme.glyphDy)};font-weight:normal;font-style:normal;white-space:pre;overflow:visible}`,
    '#t s{text-decoration:none;line-height:0}',
    '#t svg{display:block}',
    '</style></head><body>',
    `<div id="t" data-cols="${String(g.cols)}" data-rows="${String(g.rows)}">`,
    ...rows,
    '</div></body></html>',
  ].join('\n');
}
