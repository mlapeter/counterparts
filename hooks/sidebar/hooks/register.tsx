/**
 * The Counterparts sidebar (v0.1): a live memory pane beside the transcript.
 *
 * Header, two switches (Counterparts in this folder; Claude Code's own
 * memory), the brain turning in braille, the twelve mechanisms in their stage
 * colours, a search box, and ACTIVITY — what was kept, what came to mind,
 * what the night did — from the dashboard's feed and from this session live.
 * `‹` slides it to a rail of dots; the rail slides it back.
 *
 * Where things come from:
 *   - the dashboard (`counterparts dashboard`, http://localhost:4747): day,
 *     memory count, the event feed. Never started from here;
 *   - the memory server over MCP, whichever this session connected (the npm
 *     install's `counterparts`, or this plugin's own): `scope` for the
 *     switch, `recall` (facts) for search;
 *   - this session: `tool.call` on note / session_end / chapter (kept), and
 *     the recall block the classic UserPromptSubmit hook injects (came to mind).
 *
 * The engine lets `$` pass only to functions declared at the top of this
 * file, so everything that touches the engine lives here; the brain, the
 * cells, the feed parsing and the mechanism table are pure modules beside it.
 *
 * Not in v0.1 (../NOTES.md has the rest):
 * TODO(v0.2): the desktop's brain as an Svg (a Raster is the terminal's alone).
 * TODO(v0.2): the install-bun card, for a plugin user with no runtime yet.
 * TODO(v0.2): open one memory by id on the dashboard (links land on #memories).
 * TODO(v0.2): fork write-ups.
 */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SidebarRow, SidebarScope, SidebarSearch } from '../types'
import { Brain } from './brain'
import type { FrameOptions } from './brain'
import { encodeCells } from './cells'
import {
  RULE_NAMES,
  cameRow,
  classify,
  clock,
  ellipsize,
  keptRow,
  mergeRows,
  ourTool,
  parseFacts,
  parseRecallBlock,
  payloadOf,
  resolveServer,
  wrap,
} from './feed'
import type { DashEvent } from './feed'
import { DASHBOARD, MECHS, MEMORIES_URL, hex, mechById, stageOf } from './mechanisms'
import type { MechId } from './mechanisms'
import type { ListNote, ListProps, ListRow } from './list'
import type { SidebarHit } from '../types'

// ── constants ───────────────────────────────────────────────────────────────

const PANE = 'counterparts'
const TITLE = 'Counterparts'
/** Body columns the full sidebar asks for: 46 with the engine's frame. */
const OPEN_COLUMNS = 44
/** Body columns the quiet view asks for: the dock's floor (24 with the frame) is what it gets. */
const QUIET_COLUMNS = 22
/** The dashboard is read only while the pane is drawn: this often while things happen… */
const POLL_MS = 15000
/** …and this often after four quiet reads in a row. */
const POLL_IDLE_MS = 30000
/** A gap longer than this since the last read starts over from a cold read. */
const STALE_MS = 10 * 60000
const AUTO_CLOSE_MS = 30000
const FIRING_MS = 2600
const FEED_LIMIT = 30
/** The brain turns 0.175 rad a second; six frames a second keep that smooth at a third of the CPU of ten. */
const DEFAULT_FPS = 6
/** Events that change the memory count, worth one read of `/api/pulse` (the dear one). */
const COUNT_EVENTS = new Set(['gate.deposit', 'gate.chunk', 'memory.pruned', 'memory.merged', 'dream.changed', 'contradiction.settled'])

/**
 * The sidebar paints its own background, the mockup's near-black: the dock's
 * own fill is the theme's (a grey in the dark theme, light in a light one), and
 * the hologram's glow and this palette are drawn for black.
 */
const BG: readonly [number, number, number] = [5, 8, 12]

const C = {
  bg: '#05080c',
  text: '#d7dde4',
  body: '#b7bcc2',
  dim: '#6b7682',
  faint: '#3a434d',
  cyan: '#00e5ff',
  cyanDim: '#0b6f7c',
  white: '#ffffff',
  trackOn: '#00e5ff',
  trackRead: '#0b6f7c',
  knobOn: '#f4fcff',
  trackOff: '#2c333c',
  knobOff: '#b2bac4',
}
/**
 * The switch's ends: half blocks by default (every font has them), or
 * Powerline's round caps (U+E0B6, U+E0B4) for a terminal that draws them
 * (`/counterparts caps`). iTerm2 without a Powerline font drew the caps as `?`.
 */
const CAPS = {
  round: { l: '', r: '' },
  block: { l: '▐', r: '▌' },
}

// ── state (the contract: ../types/index.d.ts) ──────────────────────────────

const IDLE_SEARCH: SidebarSearch = { query: '', status: 'idle', header: '', total: 0, hits: [], error: null }
const UNKNOWN_SCOPE: SidebarScope = { mode: 'unknown', own: false, setBy: null, dir: null, error: null, busy: false }
const pulseA = atom({ plugin: 'counterparts', key: 'pulse' } as const, null)
const dashA = atom({ plugin: 'counterparts', key: 'dash' } as const, 'unknown')
const feedA = atom({ plugin: 'counterparts', key: 'feed' } as const, [])
const countsA = atom({ plugin: 'counterparts', key: 'counts' } as const, { came: 0, kept: 0 })
const firingA = atom({ plugin: 'counterparts', key: 'firing' } as const, null)
const selA = atom({ plugin: 'counterparts', key: 'sel' } as const, null)
const searchA = atom({ plugin: 'counterparts', key: 'search' } as const, IDLE_SEARCH)
const scopeA = atom({ plugin: 'counterparts', key: 'scope' } as const, UNKNOWN_SCOPE)
const memoryA = atom({ plugin: 'counterparts', key: 'claudeMemory' } as const, true)
const viewA = atom({ plugin: 'counterparts', key: 'view' } as const, 'full')
const capsA = atom({ plugin: 'counterparts', key: 'caps' } as const, 'block')
const noteA = atom({ plugin: 'counterparts', key: 'switchNote' } as const, null)
const flashA = atom({ plugin: 'counterparts', key: 'flash' } as const, null)

// ── the module's own (a reload starts these over; the host keeps the state) ──

const brain = new Brain()
/** The Raster the terminal last mounted: a blit must match its size. */
const raster = { cols: 0, rows: 0, live: false, cells: '', look: '' }
/** Mirrors of state the brain reads every frame, refreshed by each drawing. */
const look = { mono: false, sel: null as MechId | null, firing: null as MechId | null }
const fps = {
  target: DEFAULT_FPS,
  shown: false,
  inFlight: false,
  lastTick: 0,
  /** `performance.now()` of each blit the surface took: the measurement. */
  blits: [] as number[],
  frameMs: [] as number[],
  statusAt: 0,
}
const run = {
  session: '',
  interactive: false,
  /** The pane has drawn at least once in this module's life. */
  drawn: false,
  /** The first drawing's one-time work (the quiet scope read) is done. */
  woke: false,
  /** Whether to open the pane unasked has been decided (from the first band drawing). */
  placementDecided: false,
  cold: false,
  polling: false,
  /** A dashboard read is scheduled or running. */
  pollArmed: false,
  quietPolls: 0,
  lastPollAt: 0,
  lastSeq: -1,
  server: null as string | null,
  liveSeq: 0,
  /** The status line says `/counterparts opens the sidebar` until the pane draws. */
  hint: false,
  statusBase: '',
  draft: '',
  brainTimer: null as { cancel: () => void } | null,
  /** Which timer is the brain's now: a tick or a blit answer of an older one changes nothing. */
  brainGen: 0,
  /** When this session began: an event naming no session, from after it, is taken as this session's. */
  startedAt: 0,
  /** The command that opens a URL here, once found. */
  opener: null as readonly string[] | null,
  /** Fresh drawings asked for after refused blits since the last blit that was taken. */
  redraws: 0,
}

// ── pure helpers ────────────────────────────────────────────────────────────

/** Work left running on its own: a reload or the session's end may cut it off, and that is fine. */
function quiet(p: Promise<unknown>): void {
  p.catch(() => undefined)
}

/** Nothing is remembered and nothing comes to mind: paused for now, or set off. */
function isPaused(mode: string): boolean {
  return mode === 'paused' || mode === 'off'
}

function achievedFps(): number {
  const now = performance.now()
  const recent = fps.blits.filter(t => now - t < 10000)
  if (recent.length < 2) return 0
  const span = (recent[recent.length - 1] ?? 0) - (recent[0] ?? 0)
  return span <= 0 ? 0 : ((recent.length - 1) * 1000) / span
}

function meanFrameMs(): number {
  if (fps.frameMs.length === 0) return 0
  return fps.frameMs.reduce((a, b) => a + b, 0) / fps.frameMs.length
}

function fpsReport(): string {
  if (fps.blits.length < 2) {
    return `Brain: no frames measured yet (target ${String(fps.target)} fps). It draws only while the sidebar shows in a terminal; ask again in a few seconds.`
  }
  return `Brain: ${achievedFps().toFixed(1)} fps achieved over the last 10 s (target ${String(fps.target)}); a frame takes ${meanFrameMs().toFixed(1)} ms to compute.`
}

/** The whole status line, or undefined to clear it. */
function statusText(): string | undefined {
  const rate = fps.shown ? `${achievedFps().toFixed(1)} fps` : ''
  if (run.statusBase === '' && rate === '') return undefined
  if (run.statusBase === '') return `◉ ${rate}`
  return rate === '' ? run.statusBase : `${run.statusBase} · ${rate}`
}

/** What the brain shows besides its turning: a frame drawn under another look is not reused. */
function lookKey(): string {
  return `${String(look.mono)}|${look.sel ?? ''}|${look.firing ?? ''}`
}

function tagFor(): FrameOptions['tag'] {
  const m = mechById(look.sel ?? look.firing ?? '')
  if (m === undefined) return null
  return { region: m.region, label: m.short, col: stageOf(m.id).col }
}

function frameCells(cols: number, rows: number, now: number): string {
  if (look.sel !== null) {
    const m = mechById(look.sel)
    if (m !== undefined) brain.light(m.region, stageOf(m.id).col)
  }
  const t0 = performance.now()
  const cells = encodeCells(brain.frame(cols, rows, now, { mono: look.mono, tag: tagFor(), bg: BG }))
  fps.frameMs.push(performance.now() - t0)
  if (fps.frameMs.length > 120) fps.frameMs.shift()
  return cells
}

function fireBrain(mech: MechId, now: number): void {
  const m = mechById(mech)
  if (m === undefined || look.mono) return
  brain.pulse(m.region, stageOf(m.id).col, now, mech === 'retrieval' ? 'prefrontal' : 'thalamus')
}

type Cell = { t: string; fg?: string; bg?: string }

/** A phone's switch in four cells: a round-ended track, the knob at the end it is set to. */
function switchCells(on: boolean, caps: 'round' | 'block', dim: boolean, track: string = on ? C.trackOn : C.trackOff): Cell[] {
  const { l, r } = CAPS[caps]
  const knob = dim ? C.dim : on ? C.knobOn : C.knobOff
  return on
    ? [{ t: l, fg: track }, { t: ' ', bg: track }, { t: l, fg: knob, bg: track }, { t: r, fg: knob }]
    : [{ t: l, fg: knob }, { t: r, fg: knob, bg: track }, { t: ' ', bg: track }, { t: r, fg: track }]
}

/** The status line's words; the engine heads a plugin's line with the plugin's name already. */
function statusFor(
  scope: SidebarScope,
  pulse: { day: number; memories: number } | null,
  counts: { came: number; kept: number },
  memoryOff: boolean,
  view: 'full' | 'quiet' | 'hidden',
): string {
  const parts: string[] = []
  let lead = '◉'
  if (view === 'hidden' && !isPaused(scope.mode)) {
    // One quiet line while the pane is closed: this session's counts and the way back.
    if (counts.came > 0) parts.push(`${String(counts.came)} came to mind`)
    if (counts.kept > 0) parts.push(`${String(counts.kept)} kept`)
    if (memoryOff) parts.push('Claude memory off')
    parts.push('/counterparts to open')
    return `${lead} ${parts.join(' · ')}`
  }
  if (scope.mode === 'paused') {
    lead = '◌'
    parts.push('paused in this folder')
  } else if (scope.mode === 'off') {
    lead = '◌'
    parts.push('off in this folder')
  } else {
    if (scope.mode === 'observer') parts.push('reads only here')
    if (pulse !== null) parts.push(`day ${String(pulse.day)}`, `${String(pulse.memories)} memories`)
    if (counts.came > 0) parts.push(`${String(counts.came)} came to mind`)
    if (counts.kept > 0) parts.push(`${String(counts.kept)} kept`)
  }
  if (memoryOff) parts.push('Claude memory off')
  if (run.hint) parts.push('/counterparts opens the sidebar')
  return parts.length === 0 ? '' : `${lead} ${parts.join(' · ')}`
}

function trimSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

/**
 * What the switch says instead of acting, by where the folder stands. It acts
 * only on a folder whose OWN entry holds the mode: pausing anything else would
 * leave an entry of its own behind when resumed (the `scope` tool can set
 * on, observer, off, pause and resume, not "unset"), and it never turns an
 * `off` folder on.
 */
function switchExplains(scope: SidebarScope): string | null {
  const here = scope.dir ?? 'this folder'
  if (scope.mode === 'off') {
    return scope.own || scope.setBy === null
      ? `This folder is set off: nothing is remembered here and nothing comes to mind. The switch won't turn it back on; \`counterparts scope ${here} --on\` does.`
      : `This folder is off because ${scope.setBy} is set off. The switch won't turn it back on; \`counterparts scope ${scope.setBy} --on\` does.`
  }
  if (scope.mode === 'paused' && !scope.own) {
    return `Paused because ${scope.setBy ?? 'a folder above this one'} is paused. Resume it there: \`counterparts scope ${scope.setBy ?? '<that folder>'} --resume\`.`
  }
  if (scope.mode === 'unset') {
    return `Nothing is set for this folder, so Counterparts is on by default. The switch pauses only a folder with a setting of its own: a pause here would come back as an explicit “on”, and nothing can put a folder back to unset yet. \`counterparts scope ${here} --on\` gives it one.`
  }
  if ((scope.mode === 'on' || scope.mode === 'observer') && !scope.own) {
    return `This folder follows ${scope.setBy ?? 'a folder above it'} (${scope.mode}). The switch pauses only a folder with a setting of its own; \`counterparts scope ${here} --${scope.mode}\` gives it one.`
  }
  return null
}

/** An ACTIVITY row as the list module draws it: worded, coloured, wrapped. */
function activityRow(r: SidebarRow, now: number, tw: number): ListRow {
  const col = hex(stageOf(r.mech).col)
  return {
    kind: 'row',
    id: r.id,
    dot: col,
    word: r.word,
    wordColor: r.who === 'night' ? hex(stageOf(r.mech).col, 0.7) : col,
    time: clock(r.at, now),
    lines: wrap(r.text, tw),
    more: r.more.flatMap(x => wrap(x, tw).map(t => ({ text: t, dim: true }))),
    link: { url: r.url, label: r.label },
    textColor: r.who === 'night' ? C.dim : C.body,
    barColor: hex(stageOf(r.mech).col, 0.45),
  }
}

/** A search result as the list module draws it: its kind over its date, its title; opened, who said it and the excerpt. */
function hitRow(h: SidebarHit, tw: number): ListRow {
  return {
    kind: 'row',
    id: `hit:${h.id}`,
    dot: C.cyan,
    word: h.kind,
    wordColor: C.cyan,
    time: h.date,
    lines: wrap(h.title, tw),
    more: [...(h.who === null ? [] : [{ text: h.who, dim: true }]), ...wrap(h.excerpt, tw).map(t => ({ text: t, dim: false }))],
    // TODO(v0.2): open one memory by id; the Memories page until then.
    link: { url: MEMORIES_URL, label: 'open on the dashboard' },
    textColor: C.text,
    barColor: C.cyanDim,
  }
}

// ── the engine, through `$` ────────────────────────────────────────────────

async function fetchJson($: EngineInterface, path: string): Promise<unknown> {
  const r = await $.http.fetch(`${DASHBOARD}${path}`)
  if (!r.ok) throw new Error(`the dashboard answered ${String(r.status)}`)
  return JSON.parse(r.text) as unknown
}

/** Claude Code's own memory, as stored: one preference across sessions, on unless turned off. */
async function claudeMemoryOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get('claudeMemory')) !== false
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const [scope, pulse, counts, memoryOn, view] = await Promise.all([read($, scopeA), read($, pulseA), read($, countsA), claudeMemoryOn($), read($, viewA)])
  run.statusBase = statusFor(scope, pulse, counts, !memoryOn, view)
  $.ui.status(statusText())
}

/** The memory server this session connected: the npm install's first, then the plugin's. */
async function memoryServer($: EngineInterface): Promise<string | null> {
  if (run.server !== null) return run.server
  try {
    const tools = await $.tool.list()
    run.server = resolveServer(tools.filter(t => t.mcp).map(t => t.name))
  } catch {
    run.server = null
  }
  return run.server
}

async function callMemory($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<{ payload: Record<string, unknown> | null; isError: boolean }> {
  const server = await memoryServer($)
  if (server === null) throw new Error('no Counterparts memory server is connected in this session')
  const r = await $.mcp.call(server, tool, args)
  const text = r.content.find(b => b.type === 'text')?.text
  return { payload: payloadOf(text), isError: r.isError === true }
}

/** New rows into the feed; the mechanisms of the fresh ones fire. */
async function addRows($: EngineInterface, rows: readonly SidebarRow[], fresh: boolean): Promise<void> {
  if (rows.length === 0) return
  await update($, feedA, list => mergeRows([...rows, ...list], FEED_LIMIT))
  if (!fresh) return
  const newest = rows.filter(r => r.who !== 'other').sort((a, b) => b.at - a.at)[0]
  if (newest === undefined) return
  const now = await $.clock.now()
  for (const r of rows) if (r.who !== 'other') fireBrain(r.mech, Date.now())
  await update($, firingA, () => ({ id: newest.mech, at: now }))
  $.clock.after(FIRING_MS + 100, () => $.ui.invalidate('ui.render'))
}

/** Day and count from `/api/pulse`: about 130 ms of the dashboard's time, so read only when they may have moved. */
async function readPulse($: EngineInterface): Promise<{ lastSeq: number }> {
  const pulse = (await fetchJson($, '/api/pulse')) as { day: number; memories: number; lastSeq: number }
  const before = await read($, pulseA)
  if (before === null || before.day !== pulse.day || before.memories !== pulse.memories || before.lastSeq !== pulse.lastSeq) {
    await update($, pulseA, () => ({ day: pulse.day, memories: pulse.memories, lastSeq: pulse.lastSeq }))
  }
  return { lastSeq: pulse.lastSeq }
}

/**
 * One look at the dashboard. Cold (first, or after a long gap): the pulse and
 * the newest few of each event that proves a mechanism. Warm: only what is
 * new since the last seq (`/api/activity?sinceSeq=`, about 20 ms), and the
 * pulse again only when one of those events changed the count or the day.
 * Says whether anything new arrived.
 */
async function poll($: EngineInterface): Promise<boolean> {
  if (run.polling) return false
  run.polling = true
  try {
    const now = Date.now()
    const stale = run.lastPollAt > 0 && now - run.lastPollAt > STALE_MS
    run.lastPollAt = now
    if (!run.cold || run.lastSeq < 0 || stale) {
      const { lastSeq } = await readPulse($)
      if ((await read($, dashA)) !== 'up') await update($, dashA, () => 'up')
      await coldFeed($)
      run.cold = true
      run.lastSeq = lastSeq
      await refreshStatus($)
      return true
    }
    const view = (await fetchJson($, `/api/activity?sinceSeq=${String(run.lastSeq)}`)) as { events?: DashEvent[]; lastSeq?: number }
    if ((await read($, dashA)) !== 'up') await update($, dashA, () => 'up')
    const events = (view.events ?? []).filter(e => e.seq > run.lastSeq)
    if (typeof view.lastSeq === 'number' && view.lastSeq > run.lastSeq) run.lastSeq = view.lastSeq
    const rows = events.map(e => classify(e, run.session, run.startedAt)).filter((r): r is SidebarRow => r !== null)
    await addRows($, rows, true)
    const pulse = await read($, pulseA)
    const newDay = events.some(e => typeof e.day === 'number' && pulse !== null && e.day > pulse.day)
    if (newDay || events.some(e => COUNT_EVENTS.has(e.name))) {
      await readPulse($)
      await refreshStatus($)
    }
    // The Claude memory switch is one preference for every session: follow a change made in another.
    const stored = await claudeMemoryOn($)
    if (stored !== (await read($, memoryA))) {
      await update($, memoryA, () => stored)
      $.ui.invalidate('prompt.section')
      $.ui.invalidate('prompt.context')
      await refreshStatus($)
    }
    return events.length > 0
  } catch {
    if ((await read($, dashA)) !== 'down') await update($, dashA, () => 'down')
    return false
  } finally {
    run.polling = false
  }
}

/** The pane is placed and the one shown: the only time the dashboard is read and the brain drawn. */
async function paneShown($: EngineInterface): Promise<boolean> {
  try {
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    return pane !== undefined && pane.isShown && pane.isPlaced
  } catch {
    return false
  }
}

/** Reads the dashboard while the pane shows, faster while things happen; stops when it doesn't (a drawing starts it again). */
async function pollLoop($: EngineInterface): Promise<void> {
  if ((await read($, viewA)) !== 'full' || !(await paneShown($))) {
    run.pollArmed = false
    return
  }
  const moved = await poll($)
  run.quietPolls = moved ? 0 : run.quietPolls + 1
  $.clock.after(run.quietPolls >= 4 ? POLL_IDLE_MS : POLL_MS, () => quiet(pollLoop($)))
}

function armPolling($: EngineInterface, delayMs: number): void {
  if (run.pollArmed) return
  run.pollArmed = true
  $.clock.after(delayMs, () => quiet(pollLoop($)))
}

/** A cold read: the newest few of each event that proves a mechanism. */
async function coldFeed($: EngineInterface): Promise<void> {
  const answers = await Promise.all(
    RULE_NAMES.map(name =>
      fetchJson($, `/api/activity?name=${encodeURIComponent(name)}&limit=${name === 'recall.decision' ? '24' : '6'}`).catch(() => null),
    ),
  )
  const rows: SidebarRow[] = []
  for (const a of answers) {
    const events = (a as { events?: DashEvent[] } | null)?.events ?? []
    for (const e of events) {
      const r = classify(e, run.session, run.startedAt)
      if (r !== null) rows.push(r)
    }
  }
  await addRows($, rows, false)
}

function scopeOf(payload: Record<string, unknown> | null, isError: boolean, before: SidebarScope): SidebarScope {
  if (isError || payload === null) {
    return { ...before, busy: false, error: String(payload?.['detail'] ?? payload?.['reason'] ?? 'refused') }
  }
  const mode = typeof payload['mode'] === 'string' ? (payload['mode'] as string) : before.mode
  const dir = typeof payload['scope'] === 'string' ? (payload['scope'] as string) : before.dir
  // A read names the entry that governs (`setBy`); a set wrote this folder's own.
  const setBy = payload['set'] === true ? dir : typeof payload['setBy'] === 'string' ? (payload['setBy'] as string) : null
  const own = setBy !== null && dir !== null && trimSlash(setBy) === trimSlash(dir)
  return { mode, own, setBy, dir, error: null, busy: false }
}

/**
 * Whether the person's permission settings let this call run with no dialog.
 * A plugin's `$.mcp.call` goes through the same check as the model's call
 * (measured on 2.1.296), so a read nobody asked for is made only when nothing
 * would be asked; a press may ask, since the person just asked for it.
 */
async function quietlyAllowed($: EngineInterface, tool: string, input: Record<string, unknown>): Promise<boolean> {
  const server = await memoryServer($)
  if (server === null) return false
  try {
    const verdict = await $.tool.check({ tool: `mcp__${server}__${tool}`, input })
    return verdict.decision === 'allow'
  } catch {
    return false
  }
}

async function readScope($: EngineInterface): Promise<void> {
  const before = await read($, scopeA)
  try {
    const { payload, isError } = await callMemory($, 'scope', {})
    await update($, scopeA, () => scopeOf(payload, isError, before))
  } catch (err) {
    await update($, scopeA, () => ({ ...before, busy: false, error: err instanceof Error ? err.message : String(err) }))
  }
  look.mono = isPaused((await read($, scopeA)).mode)
  await refreshStatus($)
}

/** On the pane's first drawing: where this folder stands, if asking needs no dialog. (Each read is one `mcp.scope.read` line in the event log.) */
async function readScopeQuietly($: EngineInterface): Promise<void> {
  if (await quietlyAllowed($, 'scope', {})) await readScope($)
}

async function noteSwitch($: EngineInterface, text: string | null): Promise<void> {
  const now = await $.clock.now()
  const mark = text === null ? null : { text, at: now }
  await update($, noteA, () => mark)
  if (mark !== null) {
    $.clock.after(AUTO_CLOSE_MS, () => {
      quiet(update($, noteA, n => (n !== null && n.at === mark.at ? null : n)))
    })
  }
}

/**
 * The switch. The first press learns where the folder stands. After that it
 * pauses a folder whose own entry is on or observer (the pause remembers which)
 * and resumes its own pause; for every other state it says why it won't, and
 * what will (`switchExplains`). One call per press.
 */
async function toggleScope($: EngineInterface): Promise<void> {
  const scope = await read($, scopeA)
  if (scope.busy) return
  await update($, scopeA, () => ({ ...scope, busy: true }))
  try {
    if (scope.mode === 'unknown') {
      const { payload, isError } = await callMemory($, 'scope', {})
      const now = scopeOf(payload, isError, scope)
      await update($, scopeA, () => now)
      if (now.error !== null) await noteSwitch($, `The memory server said: ${now.error}`)
      else {
        const why = switchExplains(now)
        await noteSwitch(
          $,
          why ??
            (now.mode === 'paused'
              ? 'Counterparts is paused in this folder. Press again to turn it back on.'
              : now.mode === 'observer'
                ? 'Counterparts reads only in this folder: memories come to mind, nothing new is kept. Press again to pause it.'
                : 'Counterparts is on in this folder. Press again to pause it.'),
        )
      }
    } else {
      const why = switchExplains(scope)
      if (why !== null) {
        await update($, scopeA, () => ({ ...scope, busy: false }))
        await noteSwitch($, why)
      } else {
        // Here the folder's own entry is on, observer or paused.
        const to = scope.mode === 'paused' ? 'resume' : 'pause'
        const { payload, isError } = await callMemory($, 'scope', { mode: to })
        const now = scopeOf(payload, isError, scope)
        await update($, scopeA, () => now)
        await noteSwitch($, now.error === null ? null : `The memory server said: ${now.error}`)
      }
    }
  } catch (err) {
    await update($, scopeA, () => ({ ...scope, busy: false }))
    await noteSwitch($, err instanceof Error ? err.message : String(err))
  }
  look.mono = isPaused((await read($, scopeA)).mode)
  await refreshStatus($)
}

async function toggleClaudeMemory($: EngineInterface): Promise<void> {
  const on = !(await claudeMemoryOn($))
  await $.store.set('claudeMemory', on)
  await update($, memoryA, () => on)
  // The memory section and the first message's context are cached answers:
  // asking again rebuilds them from the next message (and the prompt cache once).
  $.ui.invalidate('prompt.section')
  $.ui.invalidate('prompt.context')
  $.ui.toast(
    on
      ? "Claude Code's own memory is back from your next message."
      : "Claude Code's own memory is off from your next message, in every session until you turn it back on (Counterparts stays).",
  )
  await refreshStatus($)
}

async function runSearch($: EngineInterface, raw: string): Promise<void> {
  const query = raw.trim()
  run.draft = query
  if (query.length === 0) {
    await update($, searchA, () => IDLE_SEARCH)
    return
  }
  await update($, searchA, () => ({ ...IDLE_SEARCH, query, status: 'running' as const }))
  try {
    const { payload, isError } = await callMemory($, 'recall', { question: query, mode: 'facts' })
    const answer = payload?.['answer']
    if (isError || typeof answer !== 'string') {
      const why = String(payload?.['detail'] ?? payload?.['reason'] ?? 'the search was refused')
      await update($, searchA, () => ({ ...IDLE_SEARCH, query, status: 'error' as const, error: why }))
      return
    }
    const { header, total, hits } = parseFacts(answer)
    await update($, searchA, () => ({ query, status: 'done' as const, header, total, hits: hits.slice(0, 12), error: null }))
  } catch (err) {
    await update($, searchA, () => ({ ...IDLE_SEARCH, query, status: 'error' as const, error: err instanceof Error ? err.message : String(err) }))
  }
}

/**
 * Opens (or re-opens) the pane as the given view and asks for a fresh drawing
 * of it. Measured live: a pane closed by hand and opened again is drawn from
 * the terminal's settled evaluation ("reuses its settled evaluation"), so this
 * module's render hook never runs and the brain, stopped at the close, would
 * stay frozen.
 */
async function openPane($: EngineInterface, view: 'full' | 'quiet'): Promise<{ isPlaced: boolean }> {
  await setView($, view)
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: view === 'quiet' ? QUIET_COLUMNS : OPEN_COLUMNS })
  $.ui.invalidate('ui.render')
  return { isPlaced: opened.isPlaced }
}

/** The view, for this session and (in `$.store`) the next. */
async function setView($: EngineInterface, view: 'full' | 'quiet' | 'hidden'): Promise<void> {
  if ((await read($, viewA)) !== view) await update($, viewA, () => view)
  await $.store.set('view', view)
  if (view !== 'full') stopBrain()
  await refreshStatus($)
}

/**
 * Opened without being asked: only where it docks as a sidebar, and not when
 * the person left it hidden. Measured live: the band draws BEFORE
 * `session.start` has read the stored view, so the view is read from the
 * store here; reading this session's copy then got its default (`full`),
 * opened full, and wrote `full` back over the person's choice.
 */
async function openUnasked($: EngineInterface): Promise<void> {
  const stored = await $.store.get('view')
  const view = stored === 'quiet' || stored === 'hidden' ? stored : 'full'
  if ((await read($, viewA)) !== view) await update($, viewA, () => view)
  if (view === 'hidden') {
    await refreshStatus($)
    return
  }
  const opened = await openPane($, view)
  if (!opened.isPlaced && run.interactive) {
    run.hint = true
    await refreshStatus($)
  }
}

/** The quiet view's `◉` lights in the event's stage colour, and goes out by itself. */
async function flash($: EngineInterface, mech: MechId): Promise<void> {
  if ((await read($, viewA)) !== 'quiet') return
  const now = await $.clock.now()
  const mark = { id: mech, at: now }
  await update($, flashA, () => mark)
  $.clock.after(FIRING_MS, () => {
    quiet(update($, flashA, f => (f !== null && f.at === mark.at ? null : f)))
  })
}

async function pick($: EngineInterface, id: MechId): Promise<void> {
  const now = await $.clock.now()
  const cur = await read($, selA)
  if (cur !== null && cur.id === id) {
    await update($, selA, () => null)
    return
  }
  const mark = { id, at: now }
  await update($, selA, () => mark)
  $.clock.after(AUTO_CLOSE_MS, () => {
    quiet(update($, selA, s => (s !== null && s.id === mark.id && s.at === mark.at ? null : s)))
  })
}

function stopBrain(): void {
  run.brainGen += 1
  run.brainTimer?.cancel()
  run.brainTimer = null
  raster.live = false
  fps.inFlight = false
}

/**
 * A refused blit is a Raster gone (rail, hidden, closed) or one not mounted
 * yet (a pane just reopened). Ask for a fresh drawing, a few times at most
 * until a blit is taken again: a drawing that mounts the Raster starts the
 * brain again (`wake`), one that doesn't leaves it stopped.
 */
function redrawAfterRefusal($: EngineInterface): void {
  if (run.redraws >= 3) return
  run.redraws += 1
  $.ui.invalidate('ui.render')
}

/** One frame of the brain onto the mounted Raster; the blit's time is the measurement. */
function tick($: EngineInterface, gen: number): void {
  if (gen !== run.brainGen) return
  const now = Date.now()
  const dt = fps.lastTick === 0 ? 0 : Math.min(250, now - fps.lastTick)
  fps.lastTick = now
  brain.step(now, dt)
  if (!raster.live) {
    stopBrain()
    return
  }
  if (fps.inFlight) return
  const cells = frameCells(raster.cols, raster.rows, now)
  raster.cells = cells
  raster.look = lookKey()
  fps.inFlight = true
  void $.ui.blit({ requestId: PANE, key: 'brain', cells, columns: raster.cols, rows: raster.rows }).then(
    r => {
      // An answer to a blit of a timer since stopped or replaced (a close, the
      // rail, a reopen) must not stop the brain that runs now.
      if (gen !== run.brainGen) return
      fps.inFlight = false
      if (r.deny !== undefined) {
        stopBrain()
        redrawAfterRefusal($)
        return
      }
      run.redraws = 0
      fps.blits.push(performance.now())
      if (fps.blits.length > 240) fps.blits.shift()
      if (fps.shown && now - fps.statusAt > 1000) {
        fps.statusAt = now
        $.ui.status(statusText())
      }
    },
    () => {
      if (gen !== run.brainGen) return
      stopBrain()
      redrawAfterRefusal($)
    },
  )
}

function startBrain($: EngineInterface): void {
  run.brainTimer?.cancel()
  run.brainGen += 1
  const gen = run.brainGen
  fps.inFlight = false
  fps.lastTick = 0
  run.brainTimer = $.clock.every(Math.max(16, Math.round(1000 / fps.target)), () => tick($, gen))
}

/**
 * A drawing of the pane. In the full view the brain turns and the dashboard is
 * read from here on, until the pane stops showing; the quiet view starts
 * neither (its list moves only with this session's own events).
 */
function wake($: EngineInterface, hasRaster: boolean, full: boolean): void {
  if (run.hint) {
    run.hint = false
    quiet(refreshStatus($))
  }
  if (!full) return
  if (hasRaster && run.brainTimer === null) startBrain($)
  armPolling($, run.cold ? POLL_MS : 0)
  if (!run.woke) {
    run.woke = true
    quiet(readScopeQuietly($))
  }
}

async function liveRow($: EngineInterface, row: SidebarRow, count: 'came' | 'kept', n: number): Promise<void> {
  await update($, countsA, c => ({ ...c, [count]: c[count] + n }))
  await addRows($, [row], true)
  await flash($, row.mech)
  await refreshStatus($)
}

/** How this machine opens a URL, found once: `open` (macOS), `xdg-open` (Linux), `start` (Windows). */
async function opener($: EngineInterface): Promise<readonly string[]> {
  if (run.opener !== null) return run.opener
  let os = ''
  try {
    os = (await $.process.run(['uname', '-s'], { timeoutMs: 3000 })).stdout.trim()
  } catch {
    os = 'Windows'
  }
  // Never `cmd /c start`: cmd would read & | ^ % in a URL as its own.
  run.opener = os === 'Darwin' ? ['open'] : os === 'Windows' ? ['rundll32', 'url.dll,FileProtocolHandler'] : ['xdg-open']
  return run.opener
}

/** The only links the sidebar opens: the dashboard's, in a strict character set. */
const SAFE_URL = /^http:\/\/localhost:4747\/[A-Za-z0-9#?=/_.~-]*$/

/** A plain click on a link opens it: an OSC 8 link opens only on ⌘-click in iTerm2. */
async function openUrl($: EngineInterface, url: string): Promise<void> {
  if (!SAFE_URL.test(url)) return
  try {
    const argv = await opener($)
    const r = await $.process.run([...argv, url], { timeoutMs: 10000 })
    if (r.exitCode !== 0) $.ui.toast(`counterparts: couldn't open ${url}`)
  } catch {
    $.ui.toast(`counterparts: couldn't open ${url}`)
  }
}

// ── hooks ───────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    run.interactive = e.isInteractive
    run.session = await $.session.id()
    if (run.startedAt === 0) run.startedAt = await $.clock.now()
    await $.command.register({
      name: 'counterparts',
      description: 'Counterparts sidebar: open it, slide it to the rail, or measure the brain',
      argumentHint: '[quiet | hide | fps [n] | caps]',
    })
    const [mem, viewPref, capsPref, fpsPref, fpsShown] = await Promise.all([
      $.store.get('claudeMemory'),
      $.store.get('view'),
      $.store.get('caps'),
      $.store.get('fps'),
      $.store.get('fpsShown'),
    ])
    await update($, memoryA, () => mem !== false)
    await update($, viewA, () => (viewPref === 'quiet' || viewPref === 'hidden' ? viewPref : 'full'))
    await update($, capsA, () => (capsPref === 'round' ? 'round' : 'block'))
    if (typeof fpsPref === 'number' && fpsPref >= 1 && fpsPref <= 30) fps.target = fpsPref
    fps.shown = fpsShown === true
    // Nothing is opened, read or drawn here. The pane opens unasked from the
    // first drawing of the band above the prompt, which says whether this
    // surface docks a pane (`AbovePrompt` below); the brain and the dashboard
    // start with the pane's own first drawing. The status line still says,
    // in every session, when Claude Code's own memory is off.
    quiet(refreshStatus($))
    return next(e)
  })

  on('command.run', { command: 'counterparts' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'fps') {
      if (arg !== '') {
        const n = Math.round(Number(arg))
        if (!Number.isFinite(n) || n < 1 || n > 30) return { text: 'counterparts fps: give a whole number from 1 to 30.' }
        fps.target = n
        await $.store.set('fps', n)
        if (run.brainTimer !== null) startBrain($)
        return { text: `Brain target set to ${String(n)} fps. ${fpsReport()}` }
      }
      fps.shown = !fps.shown
      await $.store.set('fpsShown', fps.shown)
      $.ui.status(statusText())
      return { text: `${fpsReport()} The status line ${fps.shown ? 'now shows' : 'no longer shows'} it.` }
    }
    if (verb === 'quiet' || verb === 'rail') {
      await openPane($, 'quiet')
      return { text: 'Sidebar quiet: narrow, nothing moving. `›` (or /counterparts) opens it full.' }
    }
    if (verb === 'hide') {
      await setView($, 'hidden')
      await $.ui.close({ id: PANE })
      return { text: 'Sidebar hidden; the status line stays. /counterparts opens it.' }
    }
    if (verb === 'caps') {
      const nextCaps = (await read($, capsA)) === 'round' ? 'block' : 'round'
      await update($, capsA, () => nextCaps)
      await $.store.set('caps', nextCaps)
      return { text: nextCaps === 'block' ? 'Switch ends drawn with half blocks.' : 'Switch ends drawn with Powerline round caps.' }
    }
    if (verb !== '' && verb !== 'open') {
      return { text: 'Usage: /counterparts [quiet | hide | fps [n] | caps]. With nothing after it, opens the sidebar full.' }
    }
    // Asked for: placed at any width, whatever view it was left in.
    const opened = await openPane($, 'full')
    return { text: opened.isPlaced ? 'Counterparts sidebar opened.' : 'Counterparts sidebar is open but this surface does not place panes.' }
  })

  // kept: the memory tools, after a call that answered without error
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const name = String(e.tool)
    if (ourTool(name) === null) return ran
    try {
      run.liveSeq += 1
      const row = keptRow(name, e as unknown as Record<string, unknown>, ran.text, await $.clock.now(), run.liveSeq)
      if (row !== null) {
        $.ui.toast(`◆ kept  ${ellipsize(row.text, 60)}`)
        await liveRow($, row, 'kept', 1)
      }
    } catch {
      // the call stands whatever the sidebar made of it
    }
    return ran
  }).catch(($, e, next) => next(e))

  // came to mind: the recall block the classic UserPromptSubmit hook injects
  on('session.append', { door: 'hook-context' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined) return stored
    try {
      const text = e.message.content.map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n')
      const block = parseRecallBlock(text)
      if (block !== null) {
        if (run.session === '') run.session = await $.session.id()
        const row = cameRow(block, run.session, await $.clock.now())
        if (row !== null) await liveRow($, row, 'came', block.surfaced.length + block.footnotes.length)
      }
    } catch {
      // the row is stored whatever the sidebar made of it
    }
    return stored
  }).catch(($, e, next) => next(e))

  // a /clear (or a resume) goes on under another session id, and no session.start fires for it
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      run.session = ''
      run.startedAt = await $.clock.now()
      await update($, countsA, () => ({ came: 0, kept: 0 }))
      await refreshStatus($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // closed by hand: hidden, for this session and the next, until /counterparts opens it
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      stopBrain()
      await setView($, 'hidden')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // a click on a list's `↗` line: open the dashboard in the browser
  on('ui.message', async ($, e) => {
    const data = e.data as { open?: unknown } | null
    if (typeof data?.open === 'string' && SAFE_URL.test(data.open)) await openUrl($, data.open)
    return {}
  })

  // Claude Code's own memory: its MEMORY.md files and its section of the system prompt
  on('prompt.context', async ($, e, next) => {
    if ((await claudeMemoryOn($)) || e.instructionFiles === undefined) return next(e)
    return next({ ...e, instructionFiles: e.instructionFiles.filter(f => f.kind !== 'memory') })
  }).catch(($, e, next) => next(e))

  on('prompt.section', { name: 'memory' }, async ($, e, next) => ((await claudeMemoryOn($)) ? next(e) : { text: null })).catch(
    ($, e, next) => next(e),
  )

  // The band above the prompt draws nothing of ours; its first drawing says
  // whether this surface docks a pane beside the transcript. Only then is the
  // sidebar opened unasked: inline above the prompt it would take the room.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const docks = e.viewport?.isFullscreen
    if (docks !== undefined && !run.placementDecided) {
      run.placementDecided = true
      // On the main screen nothing is opened and nothing is said: the typeahead
      // lists /counterparts for whoever wants it.
      if (docks) $.clock.after(0, () => quiet(openUnasked($)))
    }
    return next(e)
  })

  // ── the pane ──────────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const Client = 'Client' in els ? els.Client : null
    const now = await $.clock.now()
    run.drawn = true
    const [pulse, dash, feed, counts, firing, sel, search, scope, view, caps, note, flashMark] = await Promise.all([
      read($, pulseA), read($, dashA), read($, feedA), read($, countsA), read($, firingA), read($, selA),
      read($, searchA), read($, scopeA), read($, viewA), read($, capsA), read($, noteA), read($, flashA),
    ])
    // The stored preference, not this session's copy: another session may have turned it.
    const memoryOn = await claudeMemoryOn($)
    const paused = isPaused(scope.mode)
    look.mono = paused
    look.sel = sel === null ? null : (sel.id as MechId)
    const firingNow = !paused && firing !== null && now - firing.at < FIRING_MS ? (firing.id as MechId) : null
    look.firing = firingNow
    const W = Math.max(e.props.bodyColumns, 1)
    const fill = Math.max(1, e.props.scroll?.bodyRows ?? 1)
    const quietView = view === 'quiet'
    const hasRaster = e.surface === 'terminal' && !quietView
    // While the pane holds the keyboard (typing a search) the brain holds still:
    // no frames to compute, no blits to paint between keystrokes.
    const holding = e.props.isFocused === true
    if (e.surface === 'terminal' && (quietView || holding)) stopBrain()
    wake($, hasRaster && !holding, !quietView)
    const w = Math.max(16, W - 2)
    // This session's and the night's; another session's rows fold into one line.
    const mine = feed.filter(r => r.who !== 'other')
    const others = feed.length - mine.length
    const otherLine = others === 0 ? null : `+${String(others)} from other sessions`

    // ── quiet: narrow, nothing moving ──
    if (quietView) {
      const lit = flashMark !== null && now - flashMark.at < FIRING_MS ? hex(stageOf(flashMark.id as MechId).col) : null
      const rows: JSX.Element[] = []
      rows.push(
        <Box key="qhead" flexDirection="row">
          <Button key="unfold" plain onPress={() => openPane($, 'full')}>
            <Text color={C.cyan} bold>›</Text>
          </Button>
          <Text> </Text>
          <Text color={lit ?? (paused ? C.dim : C.cyanDim)}>◉</Text>
          <Text color={C.dim}>{` ${[counts.came > 0 ? `${String(counts.came)} came` : '', counts.kept > 0 ? `${String(counts.kept)} kept` : ''].filter(Boolean).join(' · ')}`}</Text>
        </Box>,
      )
      rows.push(<Text key="qgap"> </Text>)
      if (paused) rows.push(<Text key="qpaused" color={C.dim}>{scope.mode === 'off' ? '◌ off here' : '◌ paused here'}</Text>)
      const room = Math.max(3, fill - 4)
      mine.slice(0, room).forEach(r => {
        rows.push(
          <Box key={`q:${r.id}`} flexDirection="row">
            <Text color={hex(stageOf(r.mech).col)}>● </Text>
            <Text color={r.who === 'night' ? C.dim : C.body}>{ellipsize(r.line, w - 2)}</Text>
          </Box>,
        )
      })
      if (mine.length === 0) rows.push(<Text key="qnone" color={C.faint}>nothing yet</Text>)
      if (otherLine !== null) rows.push(<Text key="qother" color={C.faint}>{ellipsize(otherLine, w)}</Text>)
      return (
        <Box flexDirection="column" paddingX={1} width={W} minHeight={fill} backgroundColor={C.bg}>
          {rows}
        </Box>
      )
    }

    const rows: JSX.Element[] = []

    // ── header ──
    rows.push(
      <Box key="head" flexDirection="row" justifyContent="space-between" width={w}>
        <Box flexDirection="row">
          <Button key="fold" plain onPress={() => openPane($, 'quiet')}>
            <Text color={C.cyan} bold>‹</Text>
          </Button>
          <Text> </Text>
          <Text color={paused ? C.dim : C.cyan} bold>◉ COUNTERPARTS</Text>
        </Box>
        <Text color={C.dim}>{pulse === null ? '' : `day ${String(pulse.day)} · ${String(pulse.memories)}`}</Text>
      </Box>,
    )
    rows.push(<Text key="gap1"> </Text>)

    // ── the two switches ──
    // on (its own, inherited, or unset: on by default), observer (reads only,
    // a darker track), paused or off (off); unknown until the first read.
    const cpOn = !paused
    const readsOnly = scope.mode === 'observer'
    const cpDim = scope.mode === 'unknown' || scope.busy
    const sw = (isOn: boolean, dim: boolean, track?: string) =>
      switchCells(isOn, caps, dim, track).map((c, i) => (
        <Text key={`c${String(i)}`} {...(c.fg === undefined ? {} : { color: c.fg })} {...(c.bg === undefined ? {} : { backgroundColor: c.bg })}>
          {c.t}
        </Text>
      ))
    rows.push(
      <Box key="switches" flexDirection="row" justifyContent="space-between" width={w}>
        <Button key="toggle-cp" plain onPress={() => toggleScope($)}>
          <Text color={cpOn ? C.text : C.dim}>{readsOnly ? 'Reads only ' : 'Counterparts '}</Text>
          {sw(cpOn, cpDim, readsOnly ? C.trackRead : undefined)}
        </Button>
        <Button key="toggle-mem" plain onPress={() => toggleClaudeMemory($)}>
          <Text color={memoryOn ? C.text : C.dim}>Claude memory </Text>
          {sw(memoryOn, false)}
        </Button>
      </Box>,
    )
    if (note !== null) {
      for (const [i, l] of wrap(note.text, w - 2).entries()) {
        rows.push(
          <Box key={`note${String(i)}`} flexDirection="row">
            <Text color={C.cyanDim}>▎ </Text>
            <Text color={C.text}>{l}</Text>
          </Box>,
        )
      }
    }
    rows.push(<Text key="gap2"> </Text>)

    // ── the brain ──
    // Docked, the brain takes the sidebar's width. Inline above the prompt (the
    // main screen, or a terminal under 110 columns) the body is the terminal's
    // whole width, so the brain stays small there.
    const inline = e.props.placement === 'inline'
    const bw = inline ? Math.min(w, 30) : Math.min(w, 80)
    const bh = inline ? Math.min(10, Math.max(6, Math.round(bw / 3))) : Math.max(6, Math.round(bw / 3))
    if (hasRaster) {
      const { Raster } = $.ui.resolve(e)
      // The last frame the timer drew, when it fits: a drawing (a press, a
      // poll, a keystroke's redraw) need not compute a brain of its own.
      const reuse = raster.cols === bw && raster.rows === bh && raster.cells !== '' && raster.look === lookKey()
      const cells = reuse ? raster.cells : frameCells(bw, bh, Date.now())
      raster.cols = bw
      raster.rows = bh
      raster.cells = cells
      raster.look = lookKey()
      raster.live = true
      rows.push(<Raster key="brain" columns={bw} rows={bh} cells={cells} />)
    } else {
      // TODO(v0.2): the desktop brain as an Svg; a Raster is the terminal's alone.
      rows.push(
        <Box key="brain-placeholder" flexDirection="column" height={bh} width={bw} justifyContent="center" alignItems="center" borderStyle="round" borderColor={C.faint}>
          <Text color={paused ? C.dim : C.cyanDim}>◉</Text>
          <Text color={C.dim}>the brain draws in the terminal</Text>
        </Box>,
      )
    }

    // ── the twelve mechanisms ──
    let line: JSX.Element[] = []
    let used = 0
    const legend: JSX.Element[][] = []
    for (const m of MECHS) {
      const width = m.short.length + 2 + (sel?.id === m.id ? 1 : 0)
      if (used > 0 && used + 2 + width > w) {
        legend.push(line)
        line = []
        used = 0
      }
      const base = stageOf(m.id).col
      const picked = sel?.id === m.id
      const lit = firingNow === m.id || picked
      const dot = paused ? C.faint : lit ? hex(base) : hex(base, m.notBuilt ? 0.35 : 0.8)
      const word = paused ? C.faint : lit ? C.white : hex(base, m.notBuilt ? 0.3 : 0.72)
      if (used > 0) line.push(<Text key={`sp-${m.id}`}>{'  '}</Text>)
      line.push(
        <Button key={`m:${m.id}`} plain onPress={() => pick($, m.id)}>
          <Text color={dot}>{m.notBuilt ? '○' : '●'}</Text>
          <Text color={word} bold={lit}>{` ${m.short}`}</Text>
          {picked ? <Text color={hex(base)}>▾</Text> : ''}
        </Button>,
      )
      used += (used > 0 ? 2 : 0) + width
    }
    if (line.length > 0) legend.push(line)
    rows.push(<Text key="gap3"> </Text>)
    legend.forEach((l, i) =>
      rows.push(
        <Box key={`legend${String(i)}`} flexDirection="row">
          {l}
        </Box>,
      ),
    )

    // ── what the picked one is ──
    const picked = sel === null ? undefined : mechById(sel.id)
    if (picked !== undefined) {
      const stage = stageOf(picked.id)
      const col = hex(stage.col)
      const lines = [stage.label.toUpperCase(), ...wrap(picked.site, w - 2)]
      rows.push(<Text key="gap4"> </Text>)
      lines.forEach((l, i) =>
        rows.push(
          <Box key={`why${String(i)}`} flexDirection="row">
            <Text color={col}>▎ </Text>
            <Text color={i === 0 ? hex(stage.col, 0.85) : C.text} bold={i === 0}>{l}</Text>
          </Box>,
        ),
      )
    }

    // ── search ──
    // The field keeps its own text while it is typed in: no handler runs per
    // keystroke (each `onInput` was a round trip to this module) and the hook
    // never draws a value back into it. Enter searches.
    rows.push(<Text key="gap5"> </Text>)
    rows.push(
      <Box key="search" flexDirection="row" width={w} borderStyle="round" borderColor={search.status === 'idle' ? C.faint : C.cyanDim} paddingX={1}>
        <Text color={search.status === 'idle' ? C.dim : C.cyan}>⌕ </Text>
        <Box flexGrow={1}>
          {Input === null ? (
            <Text color={C.faint}>search from the terminal or the desktop app</Text>
          ) : (
            <Input key="q" placeholder="search memories" value="" submitLabel="search" onSubmit={(value: string) => runSearch($, value)} />
          )}
        </Box>
        {search.query !== '' ? (
          <Button key="clear" plain onPress={() => runSearch($, '')}>
            <Text color={C.dim}>✕</Text>
          </Button>
        ) : null}
      </Box>,
    )
    rows.push(<Text key="gap6"> </Text>)

    // ── the list: paused, search results, or activity ──
    const rule = (label: string, col: string, back = false) => (
      <Box key={`rule-${label}`} flexDirection="row" width={w}>
        <Text color={col} bold>{label}</Text>
        <Text color={C.faint}>{` ${'─'.repeat(Math.max(0, w - label.length - 1 - (back ? 12 : 0)))}`}</Text>
        {back ? (
          <Button key="back" plain onPress={() => runSearch($, '')}>
            <Text color={C.cyan}>{' ← activity'}</Text>
          </Button>
        ) : null}
      </Box>
    )
    const lw = 13
    const tw = Math.max(8, w - lw)
    const room = Math.max(4, fill - rows.length - 4)
    const list = (key: string, items: (ListRow | ListNote)[]) =>
      Client !== null ? (
        <Client
          key={key}
          module="./list.tsx"
          width={w}
          props={{ items, lw, tw, linkColor: C.cyan, faintColor: C.faint } satisfies ListProps}
        />
      ) : (
        <Box key={key} flexDirection="column">
          {items.map(it =>
            it.kind === 'note' ? (
              <Text key={it.id} color={it.color}>{it.text}</Text>
            ) : (
              <Text key={it.id} color={it.textColor}>{`● ${it.word} · ${it.lines.join(' ')}`}</Text>
            ),
          )}
        </Box>
      )
    if (paused) {
      const off = scope.mode === 'off'
      rows.push(rule(off ? 'OFF' : 'PAUSED', C.dim))
      rows.push(<Text key="gap7"> </Text>)
      const says = off
        ? "This folder is set off: nothing is remembered here and nothing comes to mind. What's kept stays kept."
        : `Nothing new is remembered here and nothing comes to mind until it's turned back on${scope.own ? ' (the switch above)' : ''}. What's kept stays kept.`
      for (const [i, l] of wrap(says, w).entries()) {
        rows.push(<Text key={`paused${String(i)}`} color={C.dim}>{l}</Text>)
      }
    } else if (search.status !== 'idle') {
      const head = search.status === 'running' ? 'SEARCHING' : search.status === 'error' ? 'NOT SEARCHED' : `${String(search.total)} FOUND`
      rows.push(rule(head, C.cyan, true))
      const showing = search.status === 'done' && search.total > search.hits.length ? ` · the first ${String(search.hits.length)}` : ''
      rows.push(<Text key="for" color={C.dim}>{ellipsize(`for “${search.query}”${showing}`, w)}</Text>)
      rows.push(<Text key="weak" color={C.faint}>a search strengthens nothing</Text>)
      rows.push(<Text key="gap8"> </Text>)
      if (search.status === 'error') {
        for (const [i, l] of wrap(search.error ?? 'the search was refused', w).entries()) rows.push(<Text key={`err${String(i)}`} color={C.dim}>{l}</Text>)
      } else if (search.status === 'done' && search.hits.length === 0) {
        rows.push(<Text key="none" color={C.faint}>nothing matches yet</Text>)
      } else if (search.hits.length > 0) {
        // TODO(v0.2): open one memory by id; the Memories page until then.
        rows.push(list('results', search.hits.slice(0, Math.max(1, Math.floor(room / 3))).map(h => hitRow(h, tw))))
      }
    } else {
      rows.push(rule('ACTIVITY', C.cyan))
      rows.push(<Text key="gap9"> </Text>)
      if (dash === 'down') {
        rows.push(<Text key="down1" color={C.dim}>The dashboard isn't running, so only this</Text>)
        rows.push(<Text key="down2" color={C.dim}>session shows here. Start it with</Text>)
        rows.push(<Text key="down3" color={C.cyanDim}>counterparts dashboard</Text>)
        rows.push(<Text key="gap10"> </Text>)
      }
      const items: (ListRow | ListNote)[] = mine.slice(0, Math.max(1, Math.floor(room / 3))).map(r => activityRow(r, now, tw))
      if (mine.length === 0 && dash !== 'down') {
        items.push({ kind: 'note', id: 'empty', text: dash === 'unknown' ? 'reading the dashboard…' : 'nothing yet', color: C.faint })
      }
      if (otherLine !== null) items.push({ kind: 'note', id: 'others', text: otherLine, color: C.faint })
      if (items.length > 0) rows.push(list('activity', items))
    }

    return (
      <Box flexDirection="column" paddingX={1} width={W} minHeight={fill} backgroundColor={C.bg}>
        {rows}
      </Box>
    )
  })
}
