/**
 * A tmux capture (`capture-pane -e -p -N`) read back into the cell grid a
 * terminal holds: every cell its character, its colours and its attributes, a
 * wide character in two cells (the second a continuation), a combining mark
 * folded into the cell before it. Pure: no tmux, no files, no browser.
 *
 * tmux writes a wide character once and leaves its padding cell out, carries
 * the SGR state from one line to the next, and writes colours the way the
 * application gave them (truecolor stays `38;2;r;g;b`, a palette index stays
 * `38;5;n` or `30`–`37`/`90`–`97`). The parser keeps each as it came; the
 * renderer resolves them against a terminal theme.
 */

/** A colour as the application asked for it: the default, a palette index (0–255), or 24-bit. */
export type Colour = { readonly kind: 'default' } | { readonly kind: 'index'; readonly n: number } | { readonly kind: 'rgb'; readonly r: number; readonly g: number; readonly b: number };

export type Attrs = {
  fg: Colour;
  bg: Colour;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  hidden: boolean;
  strike: boolean;
};

export type Cell = Attrs & {
  /** The text drawn in this cell (a base character plus any combining marks); '' for a continuation. */
  ch: string;
  /** 1 for a normal cell, 2 for the first cell of a wide character, 0 for its continuation. */
  width: 0 | 1 | 2;
};

export type Grid = { readonly cols: number; readonly rows: number; readonly cells: Cell[][] };

export const DEFAULT: Colour = { kind: 'default' };

export function plainAttrs(): Attrs {
  return { fg: DEFAULT, bg: DEFAULT, bold: false, dim: false, italic: false, underline: false, inverse: false, hidden: false, strike: false };
}

function blank(a: Attrs): Cell {
  return { ...a, ch: ' ', width: 1 };
}

/**
 * The cells one code point takes, as tmux counts them. Lineage: the ranges are
 * the sidebar mod's (`hooks/sidebar/hooks/width.ts#charCells`), copied because
 * a tool can't import a hooks module's extensionless sources under `tsc`.
 */
export function charCells(cp: number): 0 | 1 | 2 {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x0300 && cp <= 0x036f) || // combining marks
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0x200b && cp <= 0x200f) || // zero-width spaces and marks
    cp === 0x2060 ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) // skin-tone modifiers
  ) {
    return 0;
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // kana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff) || // emoji and pictographs
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Applies one SGR parameter list to `a` (in place). Unknown codes are ignored, as a terminal does. */
export function applySgr(a: Attrs, params: string): void {
  const p = params === '' ? [0] : params.split(/[;:]/).map(s => (s === '' ? 0 : Number(s)));
  for (let i = 0; i < p.length; i++) {
    const n = p[i] ?? 0;
    if (n === 0) Object.assign(a, plainAttrs());
    else if (n === 1) a.bold = true;
    else if (n === 2) a.dim = true;
    else if (n === 3) a.italic = true;
    else if (n === 4) a.underline = true;
    else if (n === 7) a.inverse = true;
    else if (n === 8) a.hidden = true;
    else if (n === 9) a.strike = true;
    else if (n === 21) a.underline = true; // doubly underlined, drawn single
    else if (n === 22) {
      a.bold = false;
      a.dim = false;
    } else if (n === 23) a.italic = false;
    else if (n === 24) a.underline = false;
    else if (n === 27) a.inverse = false;
    else if (n === 28) a.hidden = false;
    else if (n === 29) a.strike = false;
    else if (n >= 30 && n <= 37) a.fg = { kind: 'index', n: n - 30 };
    else if (n === 39) a.fg = DEFAULT;
    else if (n >= 40 && n <= 47) a.bg = { kind: 'index', n: n - 40 };
    else if (n === 49) a.bg = DEFAULT;
    else if (n >= 90 && n <= 97) a.fg = { kind: 'index', n: n - 90 + 8 };
    else if (n >= 100 && n <= 107) a.bg = { kind: 'index', n: n - 100 + 8 };
    else if (n === 38 || n === 48 || n === 58) {
      const mode = p[i + 1];
      let c: Colour | null = null;
      if (mode === 5 && i + 2 < p.length) {
        c = { kind: 'index', n: Math.max(0, Math.min(255, p[i + 2] ?? 0)) };
        i += 2;
      } else if (mode === 2 && i + 4 < p.length) {
        const ch = (v: number | undefined): number => Math.max(0, Math.min(255, v ?? 0));
        c = { kind: 'rgb', r: ch(p[i + 2]), g: ch(p[i + 3]), b: ch(p[i + 4]) };
        i += 4;
      } else {
        i = p.length; // malformed: drop the rest, as xterm does
      }
      if (c !== null && n === 38) a.fg = c;
      if (c !== null && n === 48) a.bg = c;
    }
  }
}

/**
 * Reads a capture into a `cols` x `rows` grid. Lines past `rows` are dropped,
 * cells past `cols` are dropped, and short lines are padded with blanks in
 * the default attributes (what `-N` would have kept is spaces anyway).
 */
export function parseCapture(text: string, cols: number, rows: number): Grid {
  const a = plainAttrs();
  const lines = text.split('\n');
  const cells: Cell[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: Cell[] = [];
    const line = lines[y] ?? '';
    let i = 0;
    while (i < line.length) {
      const c = line.charCodeAt(i);
      if (c === 0x1b) {
        const next = line[i + 1];
        if (next === '[') {
          // CSI: parameters, intermediates, one final byte
          let j = i + 2;
          while (j < line.length && !/[@-~]/.test(line[j] ?? '')) j++;
          if (line[j] === 'm') applySgr(a, line.slice(i + 2, j));
          i = j + 1;
        } else if (next === ']' || next === 'P' || next === '_' || next === '^') {
          // OSC / DCS / APC / PM (tmux 3.4 writes OSC 8 hyperlinks): skip to BEL or ST
          let j = i + 2;
          while (j < line.length && line[j] !== '\x07' && !(line[j] === '\x1b' && line[j + 1] === '\\')) j++;
          i = line[j] === '\x07' ? j + 1 : j + 2;
        } else {
          i += 2;
        }
        continue;
      }
      const cp = line.codePointAt(i) ?? 0;
      const ch = String.fromCodePoint(cp);
      i += ch.length;
      if (cp === 0x0d) continue;
      const w = charCells(cp);
      if (w === 0) {
        // a combining mark or joiner rides on the cell before it
        const prev = lastBase(row);
        if (prev !== null && cp >= 0x20) prev.ch += ch;
        continue;
      }
      if (row.length + w > cols) continue;
      row.push({ ...a, ch, width: w });
      if (w === 2) row.push({ ...a, ch: '', width: 0 });
    }
    while (row.length < cols) row.push(blank(plainAttrs()));
    cells.push(row);
  }
  return { cols, rows, cells };
}

function lastBase(row: Cell[]): Cell | null {
  for (let k = row.length - 1; k >= 0; k--) {
    const c = row[k];
    if (c !== undefined && c.width !== 0) return c;
  }
  return null;
}

/** The text of one row, wide characters once (a continuation adds nothing). */
export function rowText(g: Grid, y: number): string {
  return (g.cells[y] ?? []).map(c => c.ch).join('');
}

/** The first cell (0-based column, row) where `needle` starts, searching rows top-down; columns from `fromCol`. */
export function findText(g: Grid, needle: string, fromCol = 0): { x: number; y: number } | null {
  for (let y = 0; y < g.rows; y++) {
    const row = g.cells[y] ?? [];
    // column of each character of the row's text
    let text = '';
    const colOf: number[] = [];
    for (let x = fromCol; x < row.length; x++) {
      const c = row[x];
      if (c === undefined || c.width === 0) continue;
      for (let k = 0; k < c.ch.length; k++) colOf.push(x);
      text += c.ch;
    }
    const i = text.indexOf(needle);
    if (i >= 0) return { x: colOf[i] ?? fromCol, y };
  }
  return null;
}

/** A rectangle of cells, in grid coordinates (0-based, inclusive start, exclusive end). */
export type Rect = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

/**
 * Where the docked pane sits: the column of the dock's divider (the `│` that
 * runs down most rows) and the run of rows it spans. The rect starts at the
 * divider, so a crop shows the edge as the person sees it. Null when nothing
 * is docked (the main screen, or the sidebar hidden).
 */
export function findDock(g: Grid): Rect | null {
  let best = -1;
  let bestCount = 0;
  for (let x = 0; x < g.cols; x++) {
    let n = 0;
    for (let y = 0; y < g.rows; y++) if (g.cells[y]?.[x]?.ch === '│') n++;
    if (n > bestCount) {
      bestCount = n;
      best = x;
    }
  }
  if (best < 0 || bestCount < Math.max(3, Math.floor(g.rows / 3)) || best >= g.cols - 1) return null;
  // the longest unbroken run of the divider down that column
  let runStart = 0;
  let runLen = 0;
  for (let y = 0; y < g.rows; ) {
    if (g.cells[y]?.[best]?.ch !== '│') {
      y++;
      continue;
    }
    let e = y;
    while (e < g.rows && g.cells[e]?.[best]?.ch === '│') e++;
    if (e - y > runLen) {
      runLen = e - y;
      runStart = y;
    }
    y = e;
  }
  return { x0: best, y0: runStart, x1: g.cols, y1: runStart + runLen };
}

/** A sub-grid: the cells inside `r`. A wide character cut in half at the left edge becomes a blank. */
export function sliceGrid(g: Grid, r: Rect): Grid {
  const cells: Cell[][] = [];
  for (let y = r.y0; y < r.y1; y++) {
    const row = (g.cells[y] ?? []).slice(r.x0, r.x1).map(c => ({ ...c }));
    const first = row[0];
    if (first !== undefined && first.width === 0) Object.assign(first, { ch: ' ', width: 1 });
    const last = row[row.length - 1];
    if (last !== undefined && last.width === 2) Object.assign(last, { ch: ' ', width: 1 });
    cells.push(row);
  }
  return { cols: r.x1 - r.x0, rows: r.y1 - r.y0, cells };
}
