/**
 * The sidebar mod as a real terminal shows it, as PNGs: starts `claude
 * --plugin-dir <dir>` in a detached tmux session on its own socket, in the
 * fullscreen layout (where the pane docks beside the transcript), runs the
 * steps, captures each state with its 24-bit colours, draws each capture as an
 * exact cell grid in HTML, and shoots that with headless Chrome at 2x.
 *
 *   bun tools/term-loop/shoot.ts [options] [steps...]
 *   bun tools/term-loop/shoot.ts --render <capture.ansi> [--out <dir>]
 *
 * See tools/term-loop/README.md (steps, footprint, fidelity).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { DEFAULT_DATA_DIR_NAME, FORBIDDEN_ROOT_NAMES } from '../../src/core/store/paths.js';
import { findDock, parseCapture, sliceGrid, type Grid, type Rect } from './grid.js';
import { ITERM_MENLO_13, gridPixels, renderHtml } from './render.js';
import { ALLOWED_COMMANDS, STEP_HELP, keyboardOf, locate, mouseBytes, parseSteps, refuseAllowCmd, refuseClick, refuseEnter, refuseKey, refuseType, screenText, type Keyboard, type Step } from './steps.js';

const HERE = import.meta.dir;
const REPO = resolve(HERE, '..', '..');
const SOCKET = 'term-loop';
const SCRATCH = join(tmpdir(), 'counterparts-term-loop');

const USAGE = `usage: bun tools/term-loop/shoot.ts [options] [steps...]
       bun tools/term-loop/shoot.ts --render <capture.ansi> [--out <dir>] [--crop ...]

options:
  --plugin-dir <dir>  the mod's plugin root: a frozen copy or a worktree (default: this checkout)
  --out <dir>         where the PNGs go (default: tools/term-loop/out/<time>)
  --size <C>x<R>      terminal size in cells (default 200x60)
  --cwd <dir>         the scratch folder the session starts in (default: ${join(SCRATCH, 'cwd')})
  --crop auto|none|<N>  the sidebar crop: the docked pane (auto), none, or the rightmost N columns
  --settle <ms>       wait after the pane first draws, for the dashboard's first read (default 2500)
  --timeout <ms>      how long to wait for the pane, a command, or until: (default 45000)
  --no-cursor         don't draw the terminal cursor
  --allow-cmd </name> let cmd: run another mod command besides /counterparts (never a skill)
  --claude <bin>      the Claude Code executable (default: claude on PATH)

${STEP_HELP}`;

// ── options ─────────────────────────────────────────────────────────────────

type Opts = {
  pluginDir: string;
  out: string;
  cols: number;
  rows: number;
  cwd: string;
  crop: 'auto' | 'none' | number;
  settleMs: number;
  timeoutMs: number;
  cursor: boolean;
  claude: string;
  render: string | null;
  /** The slash commands a step may run (Enter on anything else is refused). */
  allowed: string[];
  steps: Step[];
};

function parseArgs(argv: readonly string[]): Opts {
  const o: Opts = {
    pluginDir: REPO,
    out: '',
    cols: 200,
    rows: 60,
    cwd: join(SCRATCH, 'cwd'),
    crop: 'auto',
    settleMs: 2500,
    timeoutMs: 45_000,
    cursor: true,
    claude: process.env['CLAUDE_BIN'] ?? 'claude',
    render: null,
    allowed: [...ALLOWED_COMMANDS],
    steps: [],
  };
  const raw: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const val = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--plugin-dir') o.pluginDir = resolve(val());
    else if (a === '--out') o.out = resolve(val());
    else if (a === '--size') {
      const m = /^(\d+)x(\d+)$/.exec(val());
      if (m === null) throw new Error('--size: <cols>x<rows>, e.g. 200x60');
      o.cols = Number(m[1]);
      o.rows = Number(m[2]);
      if (o.cols < 40 || o.rows < 10 || o.cols > 500 || o.rows > 200) throw new Error('--size: 40x10 to 500x200');
    } else if (a === '--cwd') o.cwd = resolve(val());
    else if (a === '--crop') {
      const v = val();
      if (v === 'auto' || v === 'none') o.crop = v;
      else if (/^\d+$/.test(v)) o.crop = Number(v);
      else throw new Error('--crop: auto, none, or a number of columns');
    } else if (a === '--settle') o.settleMs = Number(val());
    else if (a === '--timeout') o.timeoutMs = Number(val());
    else if (a === '--no-cursor') o.cursor = false;
    else if (a === '--claude') o.claude = val();
    else if (a === '--render') o.render = resolve(val());
    else if (a === '--allow-cmd') {
      const c = val();
      const why = refuseAllowCmd(c);
      if (why !== null) throw new Error(why);
      o.allowed.push(c);
    }
    else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}\n\n${USAGE}`);
    else raw.push(a);
  }
  o.steps = parseSteps(raw);
  for (const st of o.steps) {
    if (st.kind === 'cmd' && !o.allowed.includes(st.text.split(/\s+/)[0] ?? '')) {
      throw new Error(`cmd:${st.text}: only ${o.allowed.join(', ')} (--allow-cmd adds a mod's own command); a skill or custom command would prompt the model`);
    }
  }
  if (o.out === '') o.out = join(HERE, 'out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  return o;
}

// ── guards: what this tool may not touch ────────────────────────────────────

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** The session starts in a scratch folder: never the home folder, a live store, or this repository. */
function guardCwd(cwd: string): void {
  const c = real(cwd);
  const home = real(homedir());
  if (c === home || c === '/') throw new Error(`--cwd ${cwd}: not the home folder or /; give a scratch folder`);
  // the live stores by the core's own names (store/paths.ts), and the development repository
  for (const p of [DEFAULT_DATA_DIR_NAME, ...FORBIDDEN_ROOT_NAMES, 'counterparts']) {
    if (inside(c, join(home, p))) throw new Error(`--cwd ${cwd}: inside ~/${p}; give a scratch folder`);
  }
  if (inside(c, real(REPO))) throw new Error(`--cwd ${cwd}: inside this checkout; give a scratch folder`);
}

// ── processes ───────────────────────────────────────────────────────────────

function run(cmd: readonly string[]): { code: number; out: string; err: string } {
  const r = Bun.spawnSync([...cmd], { stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

/** tmux on this tool's own socket, with no user config. Never `kill-server`. */
function tmux(...args: string[]): { code: number; out: string; err: string } {
  return run(['tmux', '-L', SOCKET, '-f', '/dev/null', ...args]);
}

const sleep = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

// ── the plugin's stored preferences (read-only) ─────────────────────────────

const STORE_KEYS = ['view', 'caps', 'fpsShown', 'fps', 'claudeMemory'] as const;
type Prefs = Partial<Record<(typeof STORE_KEYS)[number], unknown>>;

/**
 * Where Claude Code keeps a `--plugin-dir` plugin's `$.store`: shared by every
 * folder copy of the plugin with that name, so it is the owner's own sidebar
 * preference. Measured 2026-10-10: `<config>/plugins/store/<name>_inline-<first
 * 12 hex of sha256("<name>@inline")>.json`. Read only; never written here.
 */
function storePath(pluginDir: string): { name: string; path: string } {
  let name = 'counterparts';
  try {
    const m = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')) as { name?: unknown };
    if (typeof m.name === 'string') name = m.name;
  } catch {
    /* the default name */
  }
  const config = process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
  const hash = createHash('sha256').update(`${name}@inline`).digest('hex').slice(0, 12);
  return { name, path: join(config, 'plugins', 'store', `${name}_inline-${hash}.json`) };
}

function readPrefs(path: string): Prefs | null {
  try {
    const all = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const p: Prefs = {};
    for (const k of STORE_KEYS) if (k in all) p[k] = all[k];
    return p;
  } catch {
    return null;
  }
}

/** The slash commands that put the stored preferences back the way they were (the mod's own way of writing them). */
function restoreCommands(before: Prefs | null, after: Prefs | null): { cmds: string[]; cannot: string[] } {
  const cmds: string[] = [];
  const cannot: string[] = [];
  if (after === null) return { cmds, cannot };
  const b = before ?? {};
  const viewOf = (p: Prefs): string => (p.view === 'quiet' || p.view === 'hidden' ? p.view : 'full');
  if (viewOf(b) !== viewOf(after)) cmds.push(viewOf(b) === 'quiet' ? '/counterparts quiet' : viewOf(b) === 'hidden' ? '/counterparts hide' : '/counterparts');
  if ((b.caps === 'round') !== (after.caps === 'round')) cmds.push('/counterparts caps');
  if ((b.fpsShown === true) !== (after.fpsShown === true)) cmds.push('/counterparts fps');
  const fpsOf = (p: Prefs): number => (typeof p.fps === 'number' ? p.fps : 12);
  if (fpsOf(b) !== fpsOf(after)) cmds.push(`/counterparts fps ${String(fpsOf(b))}`);
  if ((b.claudeMemory !== false) !== (after.claudeMemory !== false)) cannot.push(`claudeMemory is now ${String(after.claudeMemory)} (was ${String(b.claudeMemory ?? true)}): turn the "Claude Code's own memory" switch back by hand`);
  return { cmds, cannot };
}

// ── one live session ────────────────────────────────────────────────────────

type Look = { grid: Grid; dock: Rect | null; kb: Keyboard; cap: Capture };

type Capture = { name: string; ansi: string; cols: number; rows: number; cursor: { x: number; y: number; visible: boolean } };

class Session {
  readonly name = `term-loop-${String(process.pid)}-${Date.now().toString(36)}`;
  alive = false;

  private readonly o: Opts;

  constructor(o: Opts) {
    this.o = o;
  }

  start(): void {
    mkdirSync(this.o.cwd, { recursive: true });
    const r = tmux(
      'start-server', ';',
      'set-option', '-g', 'status', 'off', ';',
      'new-session', '-d', '-s', this.name, '-x', String(this.o.cols), '-y', String(this.o.rows), '-c', this.o.cwd,
      '-e', 'COLORTERM=truecolor', '-e', 'CLAUDE_CODE_TMUX_TRUECOLOR=1',
      '--', this.o.claude, '--plugin-dir', this.o.pluginDir, '--settings', '{"tui":"fullscreen"}',
    );
    if (r.code !== 0) throw new Error(`tmux new-session failed: ${r.err.trim()}`);
    this.alive = true;
  }

  exists(): boolean {
    return tmux('has-session', '-t', `=${this.name}`).code === 0;
  }

  capture(name: string): Capture {
    const d = tmux('display-message', '-p', '-t', this.name, '#{cursor_x} #{cursor_y} #{cursor_flag} #{pane_width} #{pane_height}');
    if (d.code !== 0) throw new Error(`the session is gone (${d.err.trim()})`);
    const [cx, cy, cf, w, h] = d.out.trim().split(' ').map(Number);
    const c = tmux('capture-pane', '-p', '-e', '-N', '-t', this.name);
    if (c.code !== 0) throw new Error(`capture-pane failed: ${c.err.trim()}`);
    return { name, ansi: c.out, cols: w ?? this.o.cols, rows: h ?? this.o.rows, cursor: { x: cx ?? 0, y: cy ?? 0, visible: cf === 1 } };
  }

  /** The screen right now, with where the pane and the keyboard are. */
  look(): Look {
    const cap = this.capture("look");
    const grid = parseCapture(cap.ansi, cap.cols, cap.rows);
    const dock = findDock(grid);
    return { grid, dock, kb: keyboardOf(grid, cap.cursor, dock), cap };
  }

  /**
   * The screen once the keyboard reads the same twice, 150 ms apart: a key
   * just sent (Escape out of the pane) can leave the cursor where it was for
   * a frame, and a guard that read that frame would judge the wrong place.
   * Never steady within 2 s reads as `unknown`, which the guards refuse.
   */
  async steady(): Promise<Look> {
    let a = this.look();
    for (let i = 0; i < 13; i++) {
      await sleep(150);
      const b = this.look();
      if (a.kb.focus === b.kb.focus && a.kb.typed === b.kb.typed && a.kb.pick === b.kb.pick) return b;
      a = b;
    }
    return { ...a, kb: { focus: 'unknown', typed: '', pick: null } };
  }

  keys(...keys: string[]): void {
    const r = tmux('send-keys', '-t', this.name, ...keys);
    if (r.code !== 0) throw new Error(`send-keys failed: ${r.err.trim()}`);
  }

  literal(text: string): void {
    const r = tmux('send-keys', '-t', this.name, '-l', text);
    if (r.code !== 0) throw new Error(`send-keys failed: ${r.err.trim()}`);
  }

  /** Raw bytes into the pane, as the terminal would write them (mouse reports). */
  bytes(s: string): void {
    const hex = [...Buffer.from(s, 'utf8')].map(b => b.toString(16).padStart(2, '0'));
    const r = tmux('send-keys', '-t', this.name, '-H', ...hex);
    if (r.code !== 0) throw new Error(`send-keys -H failed: ${r.err.trim()}`);
  }

  /** Polls until `ok` holds, or throws with the screen as it last was. */
  async waitFor(what: string, ok: (l: Look) => boolean, timeoutMs: number): Promise<Look> {
    const until = Date.now() + timeoutMs;
    let last: Look | null = null;
    while (Date.now() < until) {
      if (!this.exists()) throw new Error(`waiting for ${what}: the claude session ended`);
      last = this.look();
      if (ok(last)) return last;
      await sleep(250);
    }
    const screen = last === null ? '(no capture)' : screenText(last.grid);
    throw new Error(`timed out after ${String(timeoutMs)} ms waiting for ${what}. The screen was:\n${screen}`);
  }

  /**
   * A slash command, typed into the empty prompt and sent once the guard
   * allows it (an allowed command, and the typeahead picking that same
   * command); returns once the prompt is empty again.
   */
  async command(text: string, allowed: readonly string[]): Promise<void> {
    let l = await this.steady();
    if (l.kb.focus === "pane") {
      this.keys("Escape");
      await sleep(300);
      l = await this.steady();
    }
    if (l.kb.focus !== "empty") throw new Error(`cmd:${text}: the prompt isn't empty and holding the keyboard (it is "${l.kb.focus}")`);
    this.literal(text);
    await this.waitFor(`"${text}" in the prompt`, s => s.kb.focus === "slash" && s.kb.typed === text, 5000);
    await sleep(100);
    const why = refuseEnter((await this.steady()).kb, allowed);
    if (why !== null) {
      this.keys("C-u");
      throw new Error(`cmd:${text}: ${why}; nothing sent`);
    }
    this.keys("Enter");
    await this.waitFor(`"${text}" to be taken`, s => s.kb.focus === "empty" || s.kb.focus === "pane", this.o.timeoutMs);
  }

  /** `/exit`, and the session's own kill if that doesn't end it within 8 s. */
  async close(): Promise<void> {
    if (!this.alive) return;
    try {
      if (this.exists()) {
        await this.command("/exit", ["/exit"]).catch((e: unknown) => {
          // the session ending while we wait for the prompt to clear is the point
          if (this.exists()) throw e;
        });
        const until = Date.now() + 8000;
        while (this.exists() && Date.now() < until) await sleep(200);
        if (this.exists()) throw new Error("still running 8 s after /exit");
      }
    } catch (e) {
      console.error(`term-loop: /exit didn't close the session (${(e as Error).message.split("\n")[0] ?? ""}); killing it`);
    }
    this.kill();
  }

  /** Kills this run's tmux session only (never the server: other work runs in tmux too). */
  kill(): void {
    if (this.exists()) tmux('kill-session', '-t', `=${this.name}`);
    this.alive = false;
  }
}

// ── Chrome ──────────────────────────────────────────────────────────────────

function chromePath(): string {
  const env = process.env['TERM_LOOP_CHROME'];
  if (env !== undefined && env !== '') return env;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const w = run(['which', c]);
    if (w.code === 0) return w.out.trim();
  }
  throw new Error('no Chrome found: set TERM_LOOP_CHROME to a Chrome or Chromium binary');
}

/** brain-lab's pattern: headless Chrome on a profile of its own, killed by pid and by that profile once the file is written. */
async function chromeShot(chrome: string, profile: string, html: string, w: number, h: number, png: string): Promise<void> {
  mkdirSync(profile, { recursive: true });
  if (existsSync(png)) rmSync(png);
  const proc = Bun.spawn(
    [chrome, '--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=2',
      `--window-size=${String(w)},${String(h)}`, '--virtual-time-budget=1000', `--screenshot=${png}`, `file://${html}`],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  let last = -1;
  for (let i = 0; i < 300; i++) {
    await sleep(100);
    if (!existsSync(png)) continue;
    const size = statSync(png).size;
    if (size > 0 && size === last) break;
    last = size;
  }
  proc.kill();
  run(['pkill', '-f', `user-data-dir=${profile}`]);
  if (!existsSync(png)) throw new Error(`Chrome wrote no screenshot: ${png}`);
}

// ── capture → files ─────────────────────────────────────────────────────────

type Meta = { name: string; cols: number; rows: number; cursor: { x: number; y: number; visible: boolean }; at: string; pluginDir: string };

function saveCapture(out: string, cap: Capture, pluginDir: string): string {
  const ansi = join(out, `${cap.name}.ansi`);
  writeFileSync(ansi, cap.ansi);
  const meta: Meta = { name: cap.name, cols: cap.cols, rows: cap.rows, cursor: cap.cursor, at: new Date().toISOString(), pluginDir };
  writeFileSync(join(out, `${cap.name}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  return ansi;
}

/** Draws one saved capture: <name>.html/.png, and the sidebar's crop beside it. Returns the PNGs written. */
async function renderCapture(ansiPath: string, out: string, o: Opts, chrome: string, profile: string): Promise<string[]> {
  const base = basename(ansiPath).replace(/\.ansi$/, '');
  let meta: Partial<Meta> = {};
  try {
    meta = JSON.parse(readFileSync(join(dirname(ansiPath), `${base}.json`), 'utf8')) as Meta;
  } catch {
    /* sized by --size */
  }
  const cols = meta.cols ?? o.cols;
  const rows = meta.rows ?? o.rows;
  const grid = parseCapture(readFileSync(ansiPath, 'utf8'), cols, rows);
  const cursor = o.cursor && meta.cursor?.visible === true ? { x: meta.cursor.x, y: meta.cursor.y } : null;
  const theme = ITERM_MENLO_13;
  const pngs: string[] = [];

  const html = join(out, `${base}.html`);
  writeFileSync(html, renderHtml(grid, theme, { cursor, title: base }));
  const { w, h } = gridPixels(grid, theme);
  const png = join(out, `${base}.png`);
  await chromeShot(chrome, profile, html, w, h, png);
  pngs.push(png);

  const rect: Rect | null = o.crop === 'none' ? null : o.crop === 'auto' ? findDock(grid) : { x0: Math.max(0, cols - o.crop), y0: 0, x1: cols, y1: rows };
  if (rect === null) {
    if (o.crop === 'auto') console.log(`  ${base}: no docked pane on screen, so no sidebar crop`);
    return pngs;
  }
  const sub = sliceGrid(grid, rect);
  const subCursor = cursor !== null && cursor.x >= rect.x0 && cursor.x < rect.x1 && cursor.y >= rect.y0 && cursor.y < rect.y1 ? { x: cursor.x - rect.x0, y: cursor.y - rect.y0 } : null;
  const subHtml = join(out, `${base}-sidebar.html`);
  writeFileSync(subHtml, renderHtml(sub, theme, { cursor: subCursor, title: `${base} (sidebar)` }));
  const s = gridPixels(sub, theme);
  const subPng = join(out, `${base}-sidebar.png`);
  await chromeShot(chrome, profile, subHtml, s.w, s.h, subPng);
  pngs.push(subPng);
  return pngs;
}

// ── the run ─────────────────────────────────────────────────────────────────

async function runSteps(s: Session, o: Opts, captures: Capture[]): Promise<void> {
  for (const step of o.steps) {
    const t0 = Date.now();
    switch (step.kind) {
      case 'shot':
        captures.push(s.capture(step.name));
        saveCapture(o.out, captures[captures.length - 1]!, o.pluginDir);
        break;
      case 'wait':
        await sleep(step.ms);
        break;
      case 'cmd':
        await s.command(step.text, o.allowed);
        await sleep(1200);
        break;
      case 'keys':
        for (const k of step.keys) {
          const why = refuseKey(k, (await s.steady()).kb, o.allowed);
          if (why !== null) throw new Error(`keys:${k}: ${why}`);
          s.keys(k);
          await sleep(150);
        }
        await sleep(400);
        break;
      case 'type': {
        const why = refuseType(step.text, (await s.steady()).kb.focus);
        if (why !== null) throw new Error(why);
        s.literal(step.text);
        await sleep(400);
        break;
      }
      case 'click':
      case 'hover': {
        const l = step.kind === 'click' ? await s.steady() : s.look();
        const at = locate(l.grid, step.target, l.dock);
        if (at === null) throw new Error(`${step.kind}: ${'text' in step.target ? `"${step.target.text}" is not on screen` : 'that cell is off the screen'}\n${screenText(l.grid)}`);
        const refused = step.kind === 'click' ? refuseClick(at, l.dock, l.kb) : null;
        if (refused !== null) throw new Error(`click:${'text' in step.target ? step.target.text : `${String(step.target.x)},${String(step.target.y)}`}: ${refused}`);
        const [first, ...rest] = mouseBytes(step.kind, at.x, at.y);
        if (first !== undefined) s.bytes(first);
        for (const b of rest) {
          await sleep(60);
          s.bytes(b);
        }
        await sleep(step.kind === 'click' ? 800 : 500);
        break;
      }
      case 'until':
        await s.waitFor(`"${step.text}"`, l => screenText(l.grid).includes(step.text), o.timeoutMs);
        break;
    }
    console.log(`  ${describe(step)} (${String(Date.now() - t0)} ms)`);
  }
}

function describe(st: Step): string {
  switch (st.kind) {
    case 'shot':
      return `shot:${st.name}`;
    case 'wait':
      return `wait:${String(st.ms)}`;
    case 'cmd':
      return `cmd:${st.text}`;
    case 'keys':
      return `keys:${st.keys.join(' ')}`;
    case 'type':
      return `type:${st.text}`;
    case 'until':
      return `until:${st.text}`;
    default:
      return `${st.kind}:${'text' in st.target ? st.target.text : `${String(st.target.x)},${String(st.target.y)}`}`;
  }
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  const chrome = chromePath();
  const profile = join(SCRATCH, `chrome-${String(process.pid)}`);
  const cleanChrome = (): void => {
    run(['pkill', '-f', `user-data-dir=${profile}`]);
    rmSync(profile, { recursive: true, force: true });
  };

  if (o.render !== null) {
    mkdirSync(o.out, { recursive: true });
    try {
      const pngs = await renderCapture(o.render, o.out, o, chrome, profile);
      for (const p of pngs) console.log(p);
    } finally {
      cleanChrome();
    }
    return;
  }

  if (!existsSync(join(o.pluginDir, '.claude-plugin', 'plugin.json'))) throw new Error(`--plugin-dir ${o.pluginDir}: no .claude-plugin/plugin.json there`);
  if (run(['tmux', '-V']).code !== 0) throw new Error('tmux is not on PATH');
  guardCwd(o.cwd);
  mkdirSync(o.out, { recursive: true });
  // the trust dialog is answered only for a folder that is this tool's own, or empty
  mkdirSync(o.cwd, { recursive: true });
  const mayTrust = inside(real(o.cwd), real(SCRATCH)) || readdirSync(o.cwd).length === 0;

  const t0 = Date.now();
  const store = storePath(o.pluginDir);
  const before = readPrefs(store.path);
  const s = new Session(o);
  // a crash or ^C still kills this run's own session and Chrome
  const emergency = (): void => {
    if (s.alive) {
      s.kill();
      console.error(`term-loop: killed ${s.name}. If a step changed the sidebar's view, open the sidebar in a session to check it (stored in ${store.path}).`);
    }
    cleanChrome();
  };
  process.on('exit', emergency);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      emergency();
      process.exit(130);
    });
  }

  console.log(`term-loop: ${s.name} on socket ${SOCKET}, ${String(o.cols)}x${String(o.rows)}, plugin ${o.pluginDir}, in ${o.cwd}`);
  const captures: Capture[] = [];
  let failure: Error | null = null;
  try {
    s.start();
    // the first start in the scratch folder asks to trust it: that folder only, answered yes
    let trusted = false;
    await s.waitFor('the prompt', l => {
      const text = screenText(l.grid);
      if (!trusted && text.includes('Yes, I trust this folder')) {
        if (!mayTrust) throw new Error(`Claude Code asks to trust ${o.cwd}, which is not empty and not this tool's scratch folder: trust it once by hand, or leave --cwd out`);
        trusted = true;
        s.keys('Down');
        Bun.sleepSync(200);
        s.keys('Enter');
        return false;
      }
      return l.kb.focus === 'empty' || l.kb.focus === 'pane';
    }, o.timeoutMs);
    // the pane opens by itself unless the person left it hidden
    if (before?.view === 'hidden') {
      console.log('  the sidebar is stored hidden: opening it with /counterparts (put back at the end)');
      await s.command('/counterparts', ALLOWED_COMMANDS);
    }
    await s.waitFor('the docked pane', l => l.dock !== null, o.timeoutMs);
    await sleep(o.settleMs);
    console.log(`  ready (${String(Date.now() - t0)} ms)`);
    await runSteps(s, o, captures);
  } catch (e) {
    failure = e as Error;
  }

  // put the owner's stored sidebar preferences back, through the mod's own commands
  try {
    if (s.alive && s.exists()) {
      const { cmds, cannot } = restoreCommands(before, readPrefs(store.path));
      for (const c of cmds) {
        console.log(`  restoring the stored preference: ${c}`);
        await s.command(c, ALLOWED_COMMANDS);
        await sleep(800);
      }
      for (const c of cannot) console.error(`term-loop: ${c}`);
    }
  } catch (e) {
    console.error(`term-loop: couldn't restore the sidebar's stored view: ${(e as Error).message.split('\n')[0] ?? ''}`);
  }
  await s.close();
  const sessionMs = Date.now() - t0;

  const pngs: string[] = [];
  try {
    for (const c of captures) pngs.push(...(await renderCapture(join(o.out, `${c.name}.ansi`), o.out, o, chrome, profile)));
  } finally {
    cleanChrome();
  }
  process.off('exit', emergency);
  console.log(`term-loop: session ${String(Math.round(sessionMs / 100) / 10)} s, total ${String(Math.round((Date.now() - t0) / 100) / 10)} s`);
  for (const p of pngs) console.log(p);
  if (failure !== null) throw failure;
}

try {
  await main();
} catch (e) {
  console.error(`term-loop: ${(e as Error).message}`);
  process.exit(1);
}
