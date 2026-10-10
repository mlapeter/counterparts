/**
 * `tools/term-loop/` — the pure half: a tmux capture read into a cell grid,
 * the grid drawn as HTML, and the steps' guard on what a keystroke may send.
 *
 * Hermetic by construction: these modules take strings and return strings.
 * No tmux, no Chrome, no files, no Claude Code; every capture here is written
 * by hand.
 */
import { describe, expect, test } from 'bun:test';

import { charCells, findDock, findText, parseCapture, rowText, sliceGrid, type Grid } from '../tools/term-loop/grid.js';
import { ITERM_MENLO_13, cellColours, paletteColour, renderHtml, renderRow } from '../tools/term-loop/render.js';
import {
  MEMORY_SWITCH,
  focusOf,
  keyboardOf,
  locate,
  mouseBytes,
  parseStep,
  parseSteps,
  planWords,
  restorePlan,
  viewOf,
  refuseAllowCmd,
  refuseClick,
  refuseEnter,
  refuseKey,
  refuseType,
  typeaheadPick,
} from '../tools/term-loop/steps.js';

const E = '\x1b';
const ALLOWED = ['/counterparts'];

function cell(g: Grid, x: number, y: number) {
  const c = g.cells[y]?.[x];
  if (c === undefined) throw new Error(`no cell ${String(x)},${String(y)}`);
  return c;
}

describe('ANSI → cell grid', () => {
  test('truecolor foreground and background stay 24-bit', () => {
    const g = parseCapture(`${E}[38;2;0;229;255mA${E}[48;2;5;8;12mB`, 4, 1);
    expect(cell(g, 0, 0).fg).toEqual({ kind: 'rgb', r: 0, g: 229, b: 255 });
    expect(cell(g, 0, 0).bg).toEqual({ kind: 'default' });
    expect(cell(g, 1, 0).bg).toEqual({ kind: 'rgb', r: 5, g: 8, b: 12 });
    expect(cell(g, 1, 0).fg).toEqual({ kind: 'rgb', r: 0, g: 229, b: 255 });
  });

  test('256-colour and the sixteen, foreground and background', () => {
    const g = parseCapture(`${E}[38;5;45mX${E}[31mY${E}[91mZ${E}[41;102mW`, 4, 1);
    expect(cell(g, 0, 0).fg).toEqual({ kind: 'index', n: 45 });
    expect(cell(g, 1, 0).fg).toEqual({ kind: 'index', n: 1 });
    expect(cell(g, 2, 0).fg).toEqual({ kind: 'index', n: 9 });
    expect(cell(g, 3, 0).bg).toEqual({ kind: 'index', n: 10 });
  });

  test('reset: 0, an empty SGR, and 39/49 put colours back to the default', () => {
    const g = parseCapture(`${E}[1;38;2;1;2;3mA${E}[0mB${E}[48;5;9mC${E}[mD${E}[31;41mE${E}[39;49mF`, 6, 1);
    expect(cell(g, 1, 0).bold).toBe(false);
    expect(cell(g, 1, 0).fg).toEqual({ kind: 'default' });
    expect(cell(g, 3, 0).bg).toEqual({ kind: 'default' });
    expect(cell(g, 5, 0).fg).toEqual({ kind: 'default' });
    expect(cell(g, 5, 0).bg).toEqual({ kind: 'default' });
  });

  test('bold, dim, italic, underline, inverse on and off', () => {
    const g = parseCapture(`${E}[1;2;3;4;7mA${E}[22mB${E}[23;24;27mC`, 3, 1);
    expect(cell(g, 0, 0)).toMatchObject({ bold: true, dim: true, italic: true, underline: true, inverse: true });
    expect(cell(g, 1, 0)).toMatchObject({ bold: false, dim: false, italic: true });
    expect(cell(g, 2, 0)).toMatchObject({ italic: false, underline: false, inverse: false });
  });

  test("the SGR state carries from one line to the next, as tmux's capture expects", () => {
    const g = parseCapture(`${E}[48;2;5;8;12mA\nB`, 2, 2);
    expect(cell(g, 0, 1).bg).toEqual({ kind: 'rgb', r: 5, g: 8, b: 12 });
  });

  test('a wide character takes two cells; the next character lands after both', () => {
    const g = parseCapture('一a', 4, 1);
    expect(cell(g, 0, 0)).toMatchObject({ ch: '一', width: 2 });
    expect(cell(g, 1, 0)).toMatchObject({ ch: '', width: 0 });
    expect(cell(g, 2, 0)).toMatchObject({ ch: 'a', width: 1 });
    expect(charCells(0x1f600)).toBe(2);
  });

  test('a combining mark rides on the cell before it', () => {
    const g = parseCapture('éx', 3, 1);
    expect(cell(g, 0, 0).ch).toBe('é');
    expect(cell(g, 1, 0).ch).toBe('x');
  });

  test('braille is one cell a character', () => {
    const g = parseCapture('⣿⠁⢀x', 4, 1);
    expect(rowText(g, 0)).toBe('⣿⠁⢀x');
    expect(g.cells[0]?.map(c => c.width)).toEqual([1, 1, 1, 1]);
  });

  test('OSC 8 hyperlinks and other CSI sequences draw nothing', () => {
    const g = parseCapture(`${E}]8;;https://x.test${E}\\ab${E}]8;;${E}\\${E}[2Kc`, 4, 1);
    expect(rowText(g, 0)).toBe('abc ');
  });

  test('short lines pad to the width, long ones are cut, missing rows are blank', () => {
    const g = parseCapture('abcdef', 4, 2);
    expect(rowText(g, 0)).toBe('abcd');
    expect(rowText(g, 1)).toBe('    ');
  });

  test('the dock is found by its divider column, and sliced from it', () => {
    const lines = ['xx│abc', 'yy│de一', 'zz│fgh', '──────'];
    const g = parseCapture(lines.join('\n'), 7, 4);
    const r = findDock(g);
    expect(r).toEqual({ x0: 2, y0: 0, x1: 7, y1: 3 });
    const s = sliceGrid(g, { x0: 6, y0: 1, x1: 7, y1: 2 });
    // the wide character's second half alone becomes a blank
    expect(cell(s, 0, 0)).toMatchObject({ ch: ' ', width: 1 });
    expect(findText(g, 'fgh')).toEqual({ x: 3, y: 2 });
  });

  test('no divider, no dock', () => {
    expect(findDock(parseCapture('hello\nworld', 10, 2))).toBeNull();
  });
});

describe('cell grid → HTML', () => {
  const T = ITERM_MENLO_13;

  test('the palette: the profile’s sixteen, the cube, the grey ramp', () => {
    expect(paletteColour(1, T)).toBe('#b43c2a');
    expect(paletteColour(16, T)).toBe('#000000');
    expect(paletteColour(45, T)).toBe('#00d7ff');
    expect(paletteColour(231, T)).toBe('#ffffff');
    expect(paletteColour(232, T)).toBe('#080808');
    expect(paletteColour(255, T)).toBe('#eeeeee');
  });

  test('truecolor reaches the page as written; one background run for adjacent cells', () => {
    const g = parseCapture(`${E}[48;2;5;8;12;38;2;0;229;255mAB${E}[0m`, 4, 1);
    const html = renderRow(g.cells[0] ?? [], 0, T, null);
    expect(html).toContain('left:0px;width:16px;background:#05080c');
    expect(html.match(/background:#05080c/g)?.length).toBe(1);
    expect(html).toContain('color:#00e5ff');
    expect(html).toContain('left:8px;width:8px;color:#00e5ff">B</b>');
  });

  test('the default background is left to the page', () => {
    const html = renderRow(parseCapture('a', 2, 1).cells[0] ?? [], 0, T, null);
    expect(html).not.toContain('background');
    expect(html).toContain(`color:${T.fg}`);
  });

  test('bold is bright: default foreground takes the bold colour, ANSI 0–7 their bright twins; RGB keeps its colour', () => {
    const g = parseCapture(`${E}[1mA${E}[31mB${E}[38;2;1;2;3mC`, 3, 1);
    expect(cellColours(cell(g, 0, 0), T).fg).toBe('#ffffff');
    expect(cellColours(cell(g, 1, 0), T).fg).toBe(T.ansi[9] ?? '');
    expect(cellColours(cell(g, 2, 0), T).fg).toBe('#010203');
    expect(renderRow(g.cells[0] ?? [], 0, T, null)).toContain('font-weight:bold');
  });

  test('dim draws at the profile’s faint alpha; inverse swaps the colours', () => {
    const g = parseCapture(`${E}[2mA${E}[22;7;38;2;1;2;3;48;2;9;9;9mB`, 2, 1);
    expect(renderRow(g.cells[0] ?? [], 0, T, null)).toContain('opacity:0.674');
    expect(cellColours(cell(g, 1, 0), T)).toEqual({ fg: '#090909', bg: '#010203' });
  });

  test('a wide character is drawn two cells wide, and what follows sits after it', () => {
    const html = renderRow(parseCapture('一a', 4, 1).cells[0] ?? [], 0, T, null);
    expect(html).toContain('left:0px;width:16px;color:#dcdcdc">一</b>');
    expect(html).toContain('left:16px;width:8px;color:#dcdcdc">a</b>');
  });

  test('braille comes from the font, one glyph per cell', () => {
    const html = renderRow(parseCapture('⣿⠁', 2, 1).cells[0] ?? [], 0, T, null);
    expect(html).toContain('>⣿</b>');
    expect(html).toContain('left:8px;width:8px;color:#dcdcdc">⠁</b>');
  });

  test('block elements and box drawing are drawn as shapes, edge to edge', () => {
    const html = renderRow(parseCapture('▐─╭', 3, 1).cells[0] ?? [], 0, T, null);
    expect(html).toContain('<i style="left:4px;top:0px;width:4px;height:16px;background:#dcdcdc"></i>');
    expect(html).toContain('<path d="M4 8H8"');
    expect(html).toContain('<path d="M0 8H4"');
    expect(html).toMatch(/<path d="M4 16V12A4 4 0 0 1 8 8H8"/);
  });

  test('the cursor is a filled box with the text in the cursor-text colour', () => {
    const html = renderRow(parseCapture('ab', 2, 1).cells[0] ?? [], 0, T, 1);
    expect(html).toContain(`left:8px;width:8px;background:${T.cursor}`);
    expect(html).toContain(`color:${T.cursorText}">b</b>`);
  });

  test('a whole page: sized to the grid, text escaped', () => {
    const html = renderHtml(parseCapture('<&>', 3, 2), T, { title: 'x<y' });
    expect(html).toContain('width:24px;height:32px');
    expect(html).toContain('>&lt;</b>');
    expect(html).toContain('>&amp;</b>');
    expect(html).toContain('>&gt;</b>');
    expect(html).toContain('<title>x&lt;y</title>');
  });
});

describe('steps and the keyboard guard', () => {
  test('steps are read up front; a prompt is never a command', () => {
    expect(parseStep('shot:full', 0)).toEqual({ kind: 'shot', name: 'full' });
    expect(parseStep('cmd:/counterparts quiet', 0)).toEqual({ kind: 'cmd', text: '/counterparts quiet' });
    expect(parseStep('click:12,3', 0)).toEqual({ kind: 'click', target: { x: 12, y: 3 } });
    expect(parseStep('keys:C-x Tab', 0)).toEqual({ kind: 'keys', keys: ['C-x', 'Tab'] });
    expect(() => parseStep('cmd:hello there', 0)).toThrow(/slash command/);
    expect(() => parseStep('shot:../x', 0)).toThrow();
    expect(() => parseStep('wait:-1', 0)).toThrow();
    expect(() => parseStep('type:a\nb', 0)).toThrow();
    expect(() => parseStep(`type:/counterparts:doctor${E}[13u`, 0)).toThrow(/control/);
    expect(() => parseStep(`type:x${E}OM`, 0)).toThrow(/control/);
    expect(() => parseStep('type:a\x7fb', 0)).toThrow(/control/);
    expect(parseStep('type:publish é ⣿', 0)).toEqual({ kind: 'type', text: 'publish é ⣿' });
    expect(() => parseStep('nope', 0)).toThrow(/unknown step/);
    expect(parseSteps([])).toEqual([{ kind: 'shot', name: 'full' }]);
  });

  // a transcript, the docked pane on the right (divider at column 10), a typeahead row, the rule, the prompt at row 5
  const screen = (prompt: string, menu = ''): Grid =>
    parseCapture(['hello     │ pane', '          │ ⌕ search', '          │', menu, '──────────────────', `❯ ${prompt}`].join('\n'), 24, 6);

  test('where the keyboard is, from the cursor', () => {
    const g = screen('');
    const dock = findDock(g);
    expect(focusOf(g, { x: 14, y: 1, visible: true }, dock)).toBe('pane');
    expect(focusOf(g, { x: 2, y: 5, visible: true }, dock)).toBe('empty');
    expect(focusOf(g, { x: 2, y: 5, visible: false }, dock)).toBe('unknown');
    const s = screen('/counterparts');
    expect(focusOf(s, { x: 15, y: 5, visible: true }, findDock(s))).toBe('slash');
    const t = screen('hi there');
    expect(focusOf(t, { x: 10, y: 5, visible: true }, findDock(t))).toBe('text');
  });

  test('Enter: never on words for the model, never on a command not allowed, never on another typeahead pick', () => {
    expect(refuseEnter({ focus: 'pane', typed: '', pick: null }, ALLOWED)).toBeNull();
    expect(refuseEnter({ focus: 'empty', typed: '', pick: null }, ALLOWED)).toBeNull();
    expect(refuseEnter({ focus: 'slash', typed: '/counterparts quiet', pick: null }, ALLOWED)).toBeNull();
    expect(refuseEnter({ focus: 'slash', typed: '/counterparts', pick: '/counterparts' }, ALLOWED)).toBeNull();
    expect(refuseEnter({ focus: 'text', typed: 'hi', pick: null }, ALLOWED)).toMatch(/model/);
    expect(refuseEnter({ focus: 'unknown', typed: '', pick: null }, ALLOWED)).toMatch(/refused/);
    expect(refuseEnter({ focus: 'slash', typed: '/counterparts:doctor', pick: null }, ALLOWED)).toMatch(/not an allowed command/);
    expect(refuseEnter({ focus: 'slash', typed: '/counterparts', pick: '/counterparts:doctor' }, ALLOWED)).toMatch(/typeahead/);
    expect(refuseKey('C-m', { focus: 'text', typed: 'x', pick: null }, ALLOWED)).not.toBeNull();
    expect(refuseKey('Escape', { focus: 'text', typed: 'x', pick: null }, ALLOWED)).toBeNull();
    expect(refuseKey('q', { focus: 'empty', typed: '', pick: null }, ALLOWED)).not.toBeNull();
  });

  test('keys: tmux key names only; an Enter in any spelling meets the guard', () => {
    // tmux types a name it doesn't know as text, and reads 0xd and ^M as a carriage return
    for (const k of ['hello', '0xd', '0xa', '^M', '^J', 'M-', `${E}[13u`]) {
      expect(() => parseStep(`keys:${k}`, 0)).toThrow(/not a key name/);
      expect(refuseKey(k, { focus: 'pane', typed: '', pick: null }, ALLOWED)).toMatch(/not a key name/);
    }
    expect(parseStep('keys:Escape S-Tab C-u M-b F5 PageUp q', 0)).toMatchObject({ kind: 'keys' });
    const words = { focus: 'text', typed: 'hi', pick: null } as const;
    for (const k of ['Enter', 'enter', 'KPEnter', 'S-Enter', 'M-Enter', 'C-m', 'c-M', 'C-j', 'C-M-m', 'M-C-j']) {
      expect(refuseKey(k, words, ALLOWED)).toMatch(/model/);
    }
    for (const k of ['Escape', 'Tab', 'BSpace', 'Up', 'C-u', 'C-x', 'M-m', 'M-j']) expect(refuseKey(k, words, ALLOWED)).toBeNull();
    // a character with no C- or M- is typing, and typing on the prompt is refused
    expect(refuseKey('S-a', { focus: 'empty', typed: '', pick: null }, ALLOWED)).toMatch(/refused/);
    expect(refuseKey('Space', { focus: 'empty', typed: '', pick: null }, ALLOWED)).toMatch(/refused/);
    expect(refuseKey('q', { focus: 'pane', typed: '', pick: null }, ALLOWED)).toBeNull();
  });

  test('--allow-cmd: a mod’s own bare command, never a plugin’s namespaced skill or command', () => {
    expect(refuseAllowCmd('/mymod')).toBeNull();
    expect(refuseAllowCmd('/my-mod_2')).toBeNull();
    expect(refuseAllowCmd('/counterparts:doctor')).toMatch(/skill/);
    expect(refuseAllowCmd('mymod')).not.toBeNull();
    expect(refuseAllowCmd('/a b')).not.toBeNull();
  });

  test('typing: into the pane, or a slash command’s words; never a prompt', () => {
    expect(refuseType('publish', 'pane')).toBeNull();
    expect(refuseType('/counterparts', 'empty')).toBeNull();
    expect(refuseType(' quiet', 'slash')).toBeNull();
    expect(refuseType('hello', 'empty')).toMatch(/refused/);
    expect(refuseType('hello', 'text')).toMatch(/refused/);
  });

  test('the typeahead’s pick is read from the row its ❯ marks', () => {
    const g = screen('/counterparts', '  ❯ /counterparts');
    expect(typeaheadPick(g, 5)).toBe('/counterparts');
    const kb = keyboardOf(g, { x: 15, y: 5, visible: true }, findDock(g));
    expect(kb).toEqual({ focus: 'slash', typed: '/counterparts', pick: '/counterparts' });
    expect(typeaheadPick(screen(''), 5)).toBeNull();
  });

  test('a click outside the pane waits for an empty prompt (the typeahead sits above it)', () => {
    const g = screen('/counterparts', '  ❯ /counterparts:doctor');
    const dock = findDock(g);
    const slash = { focus: 'slash', typed: '/counterparts', pick: '/counterparts:doctor' } as const;
    expect(refuseClick({ x: 4, y: 3 }, dock, slash)).toMatch(/refused/);
    expect(refuseClick({ x: 14, y: 1 }, dock, slash)).toBeNull();
    expect(refuseClick({ x: 4, y: 3 }, dock, { focus: 'empty', typed: '', pick: null })).toBeNull();
    expect(refuseClick({ x: 4, y: 3 }, null, { focus: 'unknown', typed: '', pick: null })).toMatch(/refused/);
  });

  test('putting the stored preferences back: the mod’s commands, and a click for the memory switch', () => {
    const owner = { view: 'full', fpsShown: true, claudeMemory: true };
    expect(restorePlan(owner, owner)).toEqual({ cmds: [], memory: false });
    expect(restorePlan(owner, { ...owner, view: 'quiet' }).cmds).toEqual(['/counterparts']);
    expect(restorePlan({ view: 'hidden' }, { view: 'full' }).cmds).toEqual(['/counterparts hide']);
    expect(restorePlan({ view: 'quiet' }, { view: 'hidden' }).cmds).toEqual(['/counterparts quiet']);
    // unset keys are the mod's defaults: full, block caps, fps not shown, 12 fps, memory on
    expect(restorePlan(null, { view: 'full', caps: 'block', fpsShown: false, fps: 12, claudeMemory: true })).toEqual({ cmds: [], memory: false });
    expect(restorePlan(owner, { ...owner, caps: 'round', fpsShown: false, fps: 6 }).cmds).toEqual(['/counterparts caps', '/counterparts fps', '/counterparts fps 12']);
    const off = restorePlan(owner, { ...owner, claudeMemory: false, view: 'hidden' });
    expect(off).toEqual({ cmds: ['/counterparts'], memory: true });
    expect(planWords(off)).toEqual(['type /counterparts', `click the "${MEMORY_SWITCH}" switch`]);
    // a file that can't be read says nothing
    expect(restorePlan(owner, null)).toEqual({ cmds: [], memory: false });
    expect(viewOf({ view: 'rail' })).toBe('full');
  });

  test('targets: text in the pane first, cells 1-based; mouse reports are SGR 1006', () => {
    const g = screen('');
    expect(locate(g, { text: 'search' }, findDock(g))).toEqual({ x: 14, y: 1 });
    expect(locate(g, { x: 1, y: 1 }, null)).toEqual({ x: 0, y: 0 });
    expect(locate(g, { x: 99, y: 1 }, null)).toBeNull();
    expect(locate(g, { text: 'absent' }, null)).toBeNull();
    expect(mouseBytes('click', 161, 29)).toEqual([`${E}[<0;162;30M`, `${E}[<0;162;30m`]);
    expect(mouseBytes('hover', 0, 0)).toEqual([`${E}[<35;1;1M`]);
  });
});
