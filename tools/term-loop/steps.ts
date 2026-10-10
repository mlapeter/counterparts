/**
 * The steps a run takes, read from the command line, and the one guard that
 * matters on the owner's machine: no keystroke may submit a prompt to the
 * model. Pure: no tmux, no files.
 *
 * Where the keyboard is comes from the terminal cursor. Inside the docked
 * pane, the pane holds it (a click on the search field gives it there, and
 * Escape hands it back). On the prompt row (`❯ `), the prompt holds it, and
 * what sits between `❯ ` and the cursor is what an Enter would send.
 */

import { findText, rowText, type Grid, type Rect } from './grid.js';

export type Target = { readonly text: string } | { readonly x: number; readonly y: number };

export type Step =
  | { readonly kind: 'shot'; readonly name: string }
  | { readonly kind: 'wait'; readonly ms: number }
  | { readonly kind: 'cmd'; readonly text: string }
  | { readonly kind: 'keys'; readonly keys: readonly string[] }
  | { readonly kind: 'type'; readonly text: string }
  | { readonly kind: 'click'; readonly target: Target }
  | { readonly kind: 'hover'; readonly target: Target }
  | { readonly kind: 'until'; readonly text: string };

export const STEP_HELP = `steps, run in order (default: shot:full):
  shot:<name>        capture the screen; writes <name>.png and <name>-sidebar.png
  wait:<ms>          pause
  cmd:/counterparts [args]
                     type the mod's command into the empty prompt and press Enter
                     (only /counterparts, or --allow-cmd: nothing goes to the model)
  keys:<k> [<k>...]  tmux key names: Escape, Tab, Up, Down, C-x, BSpace, Enter...
                     (Enter only in the pane, or on an empty or allowed-command
                     prompt; Enter in the search field is a real recall)
  type:<text>        literal text: into the pane once it holds the keyboard
                     (click:search memories), or a slash command's words
  click:<text>       a mouse click on the first cell of <text> (the sidebar's first)
  click:<col>,<row>  a click on a cell, 1-based
  hover:<text>       the pointer moved over <text> (or <col>,<row>), no click
  until:<text>       wait (up to the timeout) until <text> is on screen`;

const NAME = /^[A-Za-z0-9._-]+$/;

function target(arg: string): Target {
  const m = /^(\d+),(\d+)$/.exec(arg);
  if (m !== null) return { x: Number(m[1]), y: Number(m[2]) };
  if (arg === '') throw new Error('a click or hover needs text or <col>,<row>');
  return { text: arg };
}

/** Reads one step; throws with the reason on anything it can't run. */
export function parseStep(raw: string, index: number): Step {
  const colon = raw.indexOf(':');
  const kind = colon < 0 ? raw : raw.slice(0, colon);
  const arg = colon < 0 ? '' : raw.slice(colon + 1);
  switch (kind) {
    case 'shot': {
      const name = arg === '' ? `shot-${String(index + 1)}` : arg;
      if (!NAME.test(name)) throw new Error(`shot name "${name}": letters, digits, . _ - only`);
      return { kind, name };
    }
    case 'wait': {
      const ms = Number(arg);
      if (!Number.isFinite(ms) || ms < 0 || ms > 600_000) throw new Error(`wait:${arg}: give milliseconds, 0 to 600000`);
      return { kind, ms };
    }
    case 'cmd': {
      const text = arg.trim();
      if (!text.startsWith('/') || text.length < 2) throw new Error(`cmd:${arg}: only a slash command (it starts with /); a prompt never goes to the model`);
      if (/[\r\n]/.test(text)) throw new Error('cmd: one line only');
      return { kind, text };
    }
    case 'keys': {
      const keys = arg.split(/\s+/).filter(k => k !== '');
      if (keys.length === 0) throw new Error('keys: name at least one key');
      return { kind, keys };
    }
    case 'type': {
      if (arg === '') throw new Error('type: give the text');
      if (/[\r\n]/.test(arg)) throw new Error('type: no newlines (an Enter is keys:Enter, guarded)');
      return { kind, text: arg };
    }
    case 'click':
    case 'hover':
      return { kind, target: target(arg) };
    case 'until':
      if (arg === '') throw new Error('until: give the text to wait for');
      return { kind, text: arg };
    default:
      throw new Error(`unknown step "${raw}"\n${STEP_HELP}`);
  }
}

export function parseSteps(raw: readonly string[]): Step[] {
  const steps = raw.map((r, i) => parseStep(r, i));
  return steps.length === 0 ? [{ kind: 'shot', name: 'full' }] : steps;
}

// ── where the keyboard is ────────────────────────────────────────────────────

/**
 * `pane`: the cursor is inside the docked pane, which holds the keyboard.
 * `empty`: the prompt holds it and is empty. `slash`: it holds a slash command.
 * `text`: it holds words an Enter would send to the model. `unknown`: neither
 * (a dialog, a menu, a hidden cursor, a prompt over several lines).
 */
export type Focus = 'pane' | 'empty' | 'slash' | 'text' | 'unknown';

type Cursor = { readonly x: number; readonly y: number; readonly visible: boolean };

/** What the prompt holds before the cursor, or null when the cursor isn't on the prompt row. */
export function promptTyped(g: Grid, cursor: Cursor): string | null {
  const row = g.cells[cursor.y];
  if (!cursor.visible || row === undefined) return null;
  // the prompt marker sits in the first columns of the cursor's row
  let marker = -1;
  for (let x = 0; x < Math.min(4, row.length); x++) if (row[x]?.ch === '❯') marker = x;
  if (marker < 0 || cursor.x < marker + 2) return null;
  return row
    .slice(marker + 2, cursor.x)
    .map(c => c.ch)
    .join('')
    .trim();
}

export function focusOf(g: Grid, cursor: Cursor, dock: Rect | null): Focus {
  if (!cursor.visible) return 'unknown';
  if (dock !== null && cursor.x > dock.x0 && cursor.x < dock.x1 && cursor.y >= dock.y0 && cursor.y < dock.y1) return 'pane';
  const typed = promptTyped(g, cursor);
  if (typed === null) return 'unknown';
  if (typed === '') return 'empty';
  return typed.startsWith('/') ? 'slash' : 'text';
}

/**
 * The slash command the typeahead has highlighted above the prompt (the row
 * whose `❯` marks the pick), which is what an Enter runs; null with no menu.
 */
export function typeaheadPick(g: Grid, promptRow: number): string | null {
  for (let y = promptRow - 1; y >= Math.max(0, promptRow - 16); y--) {
    const text = rowText(g, y);
    const m = /^\s{0,4}❯ (\/\S+)/.exec(text);
    if (m !== null) return m[1] ?? null;
  }
  return null;
}

const SUBMIT_KEYS = new Set(['enter', 'c-m', 'c-j', 'kpenter', 'm-enter', 's-enter', 'c-enter']);

export function isSubmitKey(k: string): boolean {
  return SUBMIT_KEYS.has(k.toLowerCase());
}

/** The slash commands an Enter may run: the mod's own. A skill's or a custom command's would prompt the model. */
export const ALLOWED_COMMANDS: readonly string[] = ['/counterparts'];

/** Where the keyboard is, what the prompt holds, and what the typeahead would run. */
export type Keyboard = { readonly focus: Focus; readonly typed: string; readonly pick: string | null };

export function keyboardOf(g: Grid, cursor: Cursor, dock: Rect | null): Keyboard {
  const focus = focusOf(g, cursor, dock);
  if (focus !== 'slash' && focus !== 'text') return { focus, typed: '', pick: null };
  return { focus, typed: promptTyped(g, cursor) ?? '', pick: typeaheadPick(g, cursor.y) };
}

/** Why an Enter may not be sent now, or null when it may. */
export function refuseEnter(k: Keyboard, allowed: readonly string[]): string | null {
  if (k.focus === 'pane' || k.focus === 'empty') return null;
  if (k.focus === 'slash') {
    const name = k.typed.split(/\s+/)[0] ?? '';
    if (!allowed.includes(name)) return `Enter refused: ${name} is not an allowed command (${allowed.join(', ')}); a skill or a custom command would prompt the model`;
    if (k.pick !== null && k.pick !== name) return `Enter refused: the typeahead has ${k.pick} picked, which Enter would run instead`;
    return null;
  }
  return k.focus === 'text'
    ? 'Enter refused: the prompt holds words that would go to the model'
    : 'Enter refused: the keyboard is neither in the pane nor on an empty or slash-command prompt';
}

/** Why a key may not be sent now, or null when it may. */
export function refuseKey(key: string, k: Keyboard, allowed: readonly string[]): string | null {
  if (isSubmitKey(key)) return refuseEnter(k, allowed);
  // a one-character key name types that character
  if ([...key].length === 1) return refuseType(key, k.focus);
  return null;
}

/** Why literal text may not be typed where the keyboard is now, or null when it may. */
export function refuseType(text: string, focus: Focus): string | null {
  if (focus === 'pane' || focus === 'slash') return null;
  if (focus === 'empty' && text.startsWith('/')) return null;
  return `typing "${text}" refused: the prompt holds the keyboard (give the pane focus first, e.g. click:search memories)`;
}

/** Where a target is, 0-based; text is looked for in the pane first, then anywhere. */
export function locate(g: Grid, t: Target, dock: Rect | null): { x: number; y: number } | null {
  if ('x' in t) return t.x >= 1 && t.y >= 1 && t.x <= g.cols && t.y <= g.rows ? { x: t.x - 1, y: t.y - 1 } : null;
  if (dock !== null) {
    const inPane = findText(g, t.text, dock.x0 + 1);
    if (inPane !== null && inPane.y >= dock.y0 && inPane.y < dock.y1) return inPane;
  }
  return findText(g, t.text);
}

/** The screen as plain text (for until:, and for the error a timeout prints). */
export function screenText(g: Grid): string {
  const lines: string[] = [];
  for (let y = 0; y < g.rows; y++) lines.push(rowText(g, y).replace(/\s+$/, ''));
  return lines.join('\n');
}

/** SGR (1006) mouse reports for a press and release of the left button, or a bare move, at a 0-based cell. */
export function mouseBytes(kind: 'click' | 'hover', x: number, y: number): string[] {
  const at = `${String(x + 1)};${String(y + 1)}`;
  return kind === 'click' ? [`\x1b[<0;${at}M`, `\x1b[<0;${at}m`] : [`\x1b[<35;${at}M`];
}
