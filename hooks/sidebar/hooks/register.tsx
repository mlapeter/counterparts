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

// ── constants ───────────────────────────────────────────────────────────────

const PANE = 'counterparts'
const TITLE = 'Counterparts'
/** Body columns the full sidebar asks for: 46 with the engine's frame. */
const OPEN_COLUMNS = 44
/** Body columns the rail asks for: about 7 with the frame. */
const RAIL_COLUMNS = 5
const POLL_MS = 5000
const AUTO_CLOSE_MS = 30000
const FIRING_MS = 2600
const FEED_LIMIT = 30
const DEFAULT_FPS = 10
/** Past this many new events, a refetch by name beats reading them all. */
const CATCH_UP_LIMIT = 400

const C = {
  text: '#d7dde4',
  body: '#b7bcc2',
  dim: '#6b7682',
  faint: '#3a434d',
  cyan: '#00e5ff',
  cyanDim: '#0b6f7c',
  white: '#ffffff',
  trackOn: '#00e5ff',
  knobOn: '#f4fcff',
  trackOff: '#2c333c',
  knobOff: '#b2bac4',
}
/** Powerline's round caps (U+E0B6 left, U+E0B4 right), or half blocks for a font without them. */
const CAPS = {
  round: { l: '', r: '' },
  block: { l: '▐', r: '▌' },
}

// ── state (the contract: ../types/index.d.ts) ──────────────────────────────

const IDLE_SEARCH: SidebarSearch = { query: '', status: 'idle', header: '', hits: [], error: null }
const UNKNOWN_SCOPE: SidebarScope = { mode: 'unknown', error: null, busy: false }
const pulseA = atom({ plugin: 'counterparts', key: 'pulse' } as const, null)
const dashA = atom({ plugin: 'counterparts', key: 'dash' } as const, 'unknown')
const feedA = atom({ plugin: 'counterparts', key: 'feed' } as const, [])
const countsA = atom({ plugin: 'counterparts', key: 'counts' } as const, { came: 0, kept: 0 })
const firingA = atom({ plugin: 'counterparts', key: 'firing' } as const, null)
const selA = atom({ plugin: 'counterparts', key: 'sel' } as const, null)
const openRowA = atom({ plugin: 'counterparts', key: 'openRow' } as const, null)
const searchA = atom({ plugin: 'counterparts', key: 'search' } as const, IDLE_SEARCH)
const scopeA = atom({ plugin: 'counterparts', key: 'scope' } as const, UNKNOWN_SCOPE)
const memoryA = atom({ plugin: 'counterparts', key: 'claudeMemory' } as const, true)
const railA = atom({ plugin: 'counterparts', key: 'rail' } as const, false)
const capsA = atom({ plugin: 'counterparts', key: 'caps' } as const, 'round')

// ── the module's own (a reload starts these over; the host keeps the state) ──

const brain = new Brain()
/** The Raster the terminal last mounted: a blit must match its size. */
const raster = { cols: 0, rows: 0, live: false }
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
  drawn: false,
  cold: false,
  polling: false,
  lastSeq: -1,
  server: null as string | null,
  liveSeq: 0,
  notPlaced: false,
  statusBase: '',
  draft: '',
  brainTimer: null as { cancel: () => void } | null,
}

// ── pure helpers ────────────────────────────────────────────────────────────

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

function fpsSuffix(): string {
  return fps.shown ? ` · ${achievedFps().toFixed(1)} fps` : ''
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
  const cells = encodeCells(brain.frame(cols, rows, now, { mono: look.mono, tag: tagFor() }))
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
function switchCells(on: boolean, caps: 'round' | 'block', dim: boolean): Cell[] {
  const { l, r } = CAPS[caps]
  const track = on ? C.trackOn : C.trackOff
  const knob = dim ? C.dim : on ? C.knobOn : C.knobOff
  return on
    ? [{ t: l, fg: track }, { t: ' ', bg: track }, { t: l, fg: knob, bg: track }, { t: r, fg: knob }]
    : [{ t: l, fg: knob }, { t: r, fg: knob, bg: track }, { t: ' ', bg: track }, { t: r, fg: track }]
}

function statusFor(mode: string, dash: string, pulse: { day: number; memories: number } | null, counts: { came: number; kept: number }): string {
  if (isPaused(mode)) return '◌ counterparts paused in this folder'
  const parts = ['◉ counterparts']
  if (pulse !== null) parts.push(`day ${String(pulse.day)}`, `${String(pulse.memories)} memories`)
  else if (dash === 'down') parts.push('dashboard not running')
  if (counts.came > 0) parts.push(`${String(counts.came)} came to mind`)
  if (counts.kept > 0) parts.push(`${String(counts.kept)} kept`)
  if (run.notPlaced) parts.push('/counterparts opens the sidebar')
  return parts.join(' · ')
}

// ── the engine, through `$` ────────────────────────────────────────────────

async function fetchJson($: EngineInterface, path: string): Promise<unknown> {
  const r = await $.http.fetch(`${DASHBOARD}${path}`)
  if (!r.ok) throw new Error(`the dashboard answered ${String(r.status)}`)
  return JSON.parse(r.text) as unknown
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const [scope, dash, pulse, counts] = await Promise.all([read($, scopeA), read($, dashA), read($, pulseA), read($, countsA)])
  run.statusBase = statusFor(scope.mode, dash, pulse, counts)
  $.ui.status(run.statusBase + fpsSuffix())
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
  const newest = [...rows].sort((a, b) => b.at - a.at)[0]
  if (newest === undefined) return
  const now = await $.clock.now()
  for (const r of rows) fireBrain(r.mech, Date.now())
  await update($, firingA, () => ({ id: newest.mech, at: now }))
  $.clock.after(FIRING_MS + 100, () => $.ui.invalidate('ui.render'))
}

/** Day, count and the newest seq; any new events since the last look. */
async function poll($: EngineInterface): Promise<void> {
  if (!run.interactive && !run.drawn) return
  if (run.polling) return
  run.polling = true
  try {
    let pulse: { day: number; memories: number; lastSeq: number }
    try {
      pulse = (await fetchJson($, '/api/pulse')) as { day: number; memories: number; lastSeq: number }
    } catch {
      if ((await read($, dashA)) !== 'down') {
        await update($, dashA, () => 'down')
        await refreshStatus($)
      }
      return
    }
    const before = await read($, pulseA)
    const wasDown = (await read($, dashA)) !== 'up'
    if (wasDown) await update($, dashA, () => 'up')
    if (before === null || before.day !== pulse.day || before.memories !== pulse.memories || before.lastSeq !== pulse.lastSeq) {
      await update($, pulseA, () => ({ day: pulse.day, memories: pulse.memories, lastSeq: pulse.lastSeq }))
    }
    if (!run.cold || run.lastSeq < 0 || pulse.lastSeq - run.lastSeq > CATCH_UP_LIMIT) {
      await coldFeed($)
      run.cold = true
      run.lastSeq = pulse.lastSeq
    } else if (pulse.lastSeq > run.lastSeq) {
      const view = (await fetchJson($, `/api/activity?sinceSeq=${String(run.lastSeq)}`)) as { events?: DashEvent[] }
      run.lastSeq = pulse.lastSeq
      const rows = (view.events ?? []).map(classify).filter((r): r is SidebarRow => r !== null)
      await addRows($, rows, true)
    }
    if (wasDown || before === null || before.day !== pulse.day || before.memories !== pulse.memories) await refreshStatus($)
  } catch {
    // a bad answer this time; the next poll asks again
  } finally {
    run.polling = false
  }
}

/** A cold start: the newest few of each event that proves a mechanism. */
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
      const r = classify(e)
      if (r !== null) rows.push(r)
    }
  }
  await addRows($, rows, false)
}

async function readScope($: EngineInterface): Promise<void> {
  try {
    const { payload, isError } = await callMemory($, 'scope', {})
    const mode = typeof payload?.['mode'] === 'string' ? (payload['mode'] as string) : 'unknown'
    await update($, scopeA, () => ({ mode, error: isError ? String(payload?.['detail'] ?? payload?.['reason'] ?? 'refused') : null, busy: false }))
  } catch (err) {
    await update($, scopeA, () => ({ mode: 'unknown', error: err instanceof Error ? err.message : String(err), busy: false }))
  }
  const scope = await read($, scopeA)
  look.mono = isPaused(scope.mode)
  await refreshStatus($)
}

async function toggleScope($: EngineInterface): Promise<void> {
  const scope = await read($, scopeA)
  if (scope.busy) return
  const to = isPaused(scope.mode) ? 'resume' : 'pause'
  await update($, scopeA, () => ({ ...scope, busy: true }))
  try {
    const { payload, isError } = await callMemory($, 'scope', { mode: to })
    if (isError) $.ui.toast(`counterparts: ${String(payload?.['detail'] ?? payload?.['reason'] ?? 'the switch was refused')}`)
  } catch (err) {
    $.ui.toast(`counterparts: ${err instanceof Error ? err.message : String(err)}`)
  }
  await readScope($)
}

async function toggleClaudeMemory($: EngineInterface): Promise<void> {
  const on = !(await read($, memoryA))
  await $.store.set('claudeMemory', on)
  await update($, memoryA, () => on)
  // The memory section and the first message's context are cached answers:
  // asking again rebuilds them from the next message (and the prompt cache once).
  $.ui.invalidate('prompt.section')
  $.ui.invalidate('prompt.context')
  $.ui.toast(on ? "Claude Code's own memory is back from your next message." : "Claude Code's own memory is off from your next message (Counterparts stays).")
}

async function runSearch($: EngineInterface, raw: string): Promise<void> {
  const query = raw.trim()
  run.draft = query
  if (query.length === 0) {
    await update($, searchA, () => IDLE_SEARCH)
    return
  }
  await update($, searchA, () => ({ query, status: 'running' as const, header: '', hits: [], error: null }))
  try {
    const { payload, isError } = await callMemory($, 'recall', { question: query, mode: 'facts' })
    const answer = payload?.['answer']
    if (isError || typeof answer !== 'string') {
      const why = String(payload?.['detail'] ?? payload?.['reason'] ?? 'the search was refused')
      await update($, searchA, () => ({ query, status: 'error' as const, header: '', hits: [], error: why }))
      return
    }
    const { header, hits } = parseFacts(answer)
    await update($, searchA, () => ({ query, status: 'done' as const, header, hits: hits.slice(0, 12), error: null }))
  } catch (err) {
    await update($, searchA, () => ({ query, status: 'error' as const, header: '', hits: [], error: err instanceof Error ? err.message : String(err) }))
  }
}

async function openPane($: EngineInterface): Promise<{ isPlaced: boolean }> {
  const railed = await read($, railA)
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: railed ? RAIL_COLUMNS : OPEN_COLUMNS })
  return { isPlaced: opened.isPlaced }
}

async function setRail($: EngineInterface, on: boolean): Promise<void> {
  await update($, railA, () => on)
  await $.store.set('rail', on)
  await $.ui.open({ id: PANE, title: TITLE, columns: on ? RAIL_COLUMNS : OPEN_COLUMNS })
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
    void update($, selA, s => (s !== null && s.id === mark.id && s.at === mark.at ? null : s))
  })
}

async function openRow($: EngineInterface, id: string): Promise<void> {
  const now = await $.clock.now()
  const cur = await read($, openRowA)
  if (cur !== null && cur.id === id) {
    await update($, openRowA, () => null)
    return
  }
  const mark = { id, at: now }
  await update($, openRowA, () => mark)
  $.clock.after(AUTO_CLOSE_MS, () => {
    void update($, openRowA, s => (s !== null && s.id === mark.id && s.at === mark.at ? null : s))
  })
}

/** One frame of the brain onto the mounted Raster; the blit's time is the measurement. */
function tick($: EngineInterface): void {
  const now = Date.now()
  const dt = fps.lastTick === 0 ? 0 : Math.min(250, now - fps.lastTick)
  fps.lastTick = now
  brain.step(now, dt)
  if (!raster.live || fps.inFlight) return
  const cells = frameCells(raster.cols, raster.rows, now)
  fps.inFlight = true
  void $.ui.blit({ requestId: PANE, key: 'brain', cells, columns: raster.cols, rows: raster.rows }).then(
    r => {
      fps.inFlight = false
      if (r.deny !== undefined) {
        raster.live = false
        return
      }
      fps.blits.push(performance.now())
      if (fps.blits.length > 240) fps.blits.shift()
      if (fps.shown && now - fps.statusAt > 1000) {
        fps.statusAt = now
        $.ui.status(run.statusBase + fpsSuffix())
      }
    },
    () => {
      fps.inFlight = false
      raster.live = false
    },
  )
}

function startBrain($: EngineInterface): void {
  run.brainTimer?.cancel()
  run.brainTimer = $.clock.every(Math.max(16, Math.round(1000 / fps.target)), () => tick($))
}

async function liveRow($: EngineInterface, row: SidebarRow, count: 'came' | 'kept', n: number): Promise<void> {
  await update($, countsA, c => ({ ...c, [count]: c[count] + n }))
  await addRows($, [row], true)
  await refreshStatus($)
}

// ── hooks ───────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    run.interactive = e.isInteractive
    run.session = await $.session.id()
    await $.command.register({
      name: 'counterparts',
      description: 'Counterparts sidebar: open it, slide it to the rail, or measure the brain',
      argumentHint: '[rail | fps [n] | caps]',
    })
    const [mem, railed, capsPref, fpsPref, fpsShown] = await Promise.all([
      $.store.get('claudeMemory'),
      $.store.get('rail'),
      $.store.get('caps'),
      $.store.get('fps'),
      $.store.get('fpsShown'),
    ])
    await update($, memoryA, () => mem !== false)
    await update($, railA, () => railed === true)
    await update($, capsA, () => capsPref === 'block' ? 'block' : 'round')
    if (typeof fpsPref === 'number' && fpsPref >= 1 && fpsPref <= 30) fps.target = fpsPref
    fps.shown = fpsShown === true
    const opened = await openPane($)
    run.notPlaced = run.interactive && !opened.isPlaced
    if (run.interactive) startBrain($)
    $.clock.every(POLL_MS, () => void poll($))
    if (run.interactive) {
      void poll($)
      void readScope($)
    } else {
      void refreshStatus($)
    }
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
        startBrain($)
        return { text: `Brain target set to ${String(n)} fps. ${fpsReport()}` }
      }
      fps.shown = !fps.shown
      await $.store.set('fpsShown', fps.shown)
      $.ui.status(run.statusBase + fpsSuffix())
      return { text: `${fpsReport()} The status line ${fps.shown ? 'now shows' : 'no longer shows'} it.` }
    }
    if (verb === 'rail') {
      const railed = !(await read($, railA))
      await setRail($, railed)
      return { text: railed ? 'Sidebar slid to the rail.' : 'Sidebar slid open.' }
    }
    if (verb === 'caps') {
      const nextCaps = (await read($, capsA)) === 'round' ? 'block' : 'round'
      await update($, capsA, () => nextCaps)
      await $.store.set('caps', nextCaps)
      return { text: nextCaps === 'block' ? 'Switch ends drawn with half blocks.' : 'Switch ends drawn with Powerline half-discs.' }
    }
    if (verb !== '' && verb !== 'open') {
      return { text: 'Usage: /counterparts [rail | fps [n] | caps]. With nothing after it, opens the sidebar.' }
    }
    const opened = await openPane($)
    run.notPlaced = false
    if (!run.interactive) run.drawn = true
    void poll($)
    void readScope($)
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
        const row = cameRow(block, run.session, await $.clock.now())
        if (row !== null) await liveRow($, row, 'came', block.surfaced.length + block.footnotes.length)
      }
    } catch {
      // the row is stored whatever the sidebar made of it
    }
    return stored
  }).catch(($, e, next) => next(e))

  // Claude Code's own memory: its MEMORY.md files and its section of the system prompt
  on('prompt.context', async ($, e, next) => {
    const isOn = (await $.store.get('claudeMemory')) !== false
    if (isOn || e.instructionFiles === undefined) return next(e)
    return next({ ...e, instructionFiles: e.instructionFiles.filter(f => f.kind !== 'memory') })
  }).catch(($, e, next) => next(e))

  on('prompt.section', { name: 'memory' }, async ($, e, next) => {
    const isOn = (await $.store.get('claudeMemory')) !== false
    return isOn ? next(e) : { text: null }
  }).catch(($, e, next) => next(e))

  // ── the pane ──────────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    const Input = 'Input' in els ? els.Input : null
    const now = await $.clock.now()
    run.drawn = true
    const [pulse, dash, feed, counts, firing, sel, opened, search, scope, memoryOn, railed, caps] = await Promise.all([
      read($, pulseA), read($, dashA), read($, feedA), read($, countsA), read($, firingA), read($, selA),
      read($, openRowA), read($, searchA), read($, scopeA), read($, memoryA), read($, railA), read($, capsA),
    ])
    const paused = isPaused(scope.mode)
    look.mono = paused
    look.sel = sel === null ? null : (sel.id as MechId)
    const firingNow = !paused && firing !== null && now - firing.at < FIRING_MS ? (firing.id as MechId) : null
    look.firing = firingNow
    const W = Math.max(e.props.bodyColumns, 1)

    // ── the rail ──
    if (railed) {
      if (e.surface === 'terminal') raster.live = false
      const pulseCol = firingNow !== null ? hex(stageOf(firingNow as MechId).col) : paused ? C.dim : C.cyan
      return (
        <Box flexDirection="column" paddingX={1}>
          <Button key="unfold" plain onPress={() => setRail($, false)}>
            <Text color={C.cyan} bold>›</Text>
          </Button>
          <Text> </Text>
          <Text color={pulseCol}>◉</Text>
          <Text> </Text>
          {MECHS.map(m => {
            const lit = firingNow === m.id
            const col = paused ? C.faint : lit ? C.white : hex(stageOf(m.id).col, m.notBuilt ? 0.3 : 0.6)
            return (
              <Button key={`rail:${m.id}`} plain onPress={() => setRail($, false)}>
                <Text color={col}>{m.notBuilt ? '○' : '●'}</Text>
              </Button>
            )
          })}
          <Text> </Text>
          {!paused && counts.kept > 0 ? <Text color={C.cyan}>{`◆${String(counts.kept)}`}</Text> : null}
          {!paused && counts.came > 0 ? <Text color={hex(stageOf('retrieval').col)}>{`↑${String(counts.came)}`}</Text> : null}
        </Box>
      )
    }

    const w = Math.max(20, W - 2)
    const rows: JSX.Element[] = []

    // ── header ──
    rows.push(
      <Box key="head" flexDirection="row" justifyContent="space-between" width={w}>
        <Box flexDirection="row">
          <Button key="fold" plain onPress={() => setRail($, true)}>
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
    const cpOn = !paused
    const cpDim = scope.mode === 'unknown' || scope.busy
    const sw = (isOn: boolean, dim: boolean) =>
      switchCells(isOn, caps, dim).map((c, i) => (
        <Text key={`c${String(i)}`} {...(c.fg === undefined ? {} : { color: c.fg })} {...(c.bg === undefined ? {} : { backgroundColor: c.bg })}>
          {c.t}
        </Text>
      ))
    rows.push(
      <Box key="switches" flexDirection="row" justifyContent="space-between" width={w}>
        <Button key="toggle-cp" plain onPress={() => toggleScope($)}>
          <Text color={cpOn ? C.text : C.dim}>Counterparts </Text>
          {sw(cpOn, cpDim)}
        </Button>
        <Button key="toggle-mem" plain onPress={() => toggleClaudeMemory($)}>
          <Text color={memoryOn ? C.text : C.dim}>Claude memory </Text>
          {sw(memoryOn, false)}
        </Button>
      </Box>,
    )
    rows.push(<Text key="gap2"> </Text>)

    // ── the brain ──
    const bw = Math.min(w, 80)
    const bh = Math.max(6, Math.round(bw / 3))
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      raster.cols = bw
      raster.rows = bh
      raster.live = true
      rows.push(<Raster key="brain" columns={bw} rows={bh} cells={frameCells(bw, bh, Date.now())} />)
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
    rows.push(<Text key="gap5"> </Text>)
    rows.push(
      <Box key="search" flexDirection="row" width={w} borderStyle="round" borderColor={search.status === 'idle' ? C.faint : C.cyanDim} paddingX={1}>
        <Box flexGrow={1}>
          {Input === null ? (
            <Text color={C.faint}>⌕ search from the terminal or the desktop app</Text>
          ) : (
            <Input
              key="q"
              label="⌕ "
              placeholder="search memories"
              value={run.draft}
              submitLabel="search"
              onInput={(value: string) => {
                run.draft = value
              }}
              onSubmit={(value: string) => runSearch($, value)}
            />
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
    const rule = (label: string, col: string) => (
      <Box key={`rule-${label}`} flexDirection="row" width={w}>
        <Text color={col} bold>{label}</Text>
        <Text color={C.faint}>{` ${'─'.repeat(Math.max(0, w - label.length - 1))}`}</Text>
      </Box>
    )
    if (paused) {
      rows.push(rule('PAUSED', C.dim))
      rows.push(<Text key="gap7"> </Text>)
      for (const [i, l] of wrap("Nothing new is remembered here and nothing comes to mind until you turn it back on. What's kept stays kept.", w).entries()) {
        rows.push(<Text key={`paused${String(i)}`} color={C.dim}>{l}</Text>)
      }
    } else if (search.status !== 'idle') {
      const head = search.status === 'running' ? 'SEARCHING' : search.status === 'error' ? 'NOT SEARCHED' : `${String(search.hits.length)} FOUND`
      rows.push(rule(head, C.cyan))
      rows.push(<Text key="for" color={C.dim}>{ellipsize(`for “${search.query}” · a search strengthens nothing`, w)}</Text>)
      rows.push(<Text key="gap8"> </Text>)
      if (search.status === 'error') {
        for (const [i, l] of wrap(search.error ?? 'the search was refused', w).entries()) rows.push(<Text key={`err${String(i)}`} color={C.dim}>{l}</Text>)
      } else if (search.status === 'done' && search.hits.length === 0) {
        rows.push(<Text key="none" color={C.faint}>nothing matches yet</Text>)
      }
      search.hits.forEach((h, i) => {
        rows.push(
          <Box key={`hit${String(i)}`} flexDirection="row">
            <Text color={C.cyan}>● </Text>
            <Text color={C.text}>{ellipsize(h.title, w - 2)}</Text>
          </Box>,
        )
        rows.push(<Text key={`hitm${String(i)}`} color={C.dim}>{`  ${ellipsize(h.meta, w - 2)}`}</Text>)
        rows.push(<Text key={`hitg${String(i)}`}> </Text>)
      })
      if (search.status === 'done' && search.hits.length > 0) {
        // TODO(v0.2): open one memory by id; the Memories page until then.
        rows.push(<Link key="hits-link" href={MEMORIES_URL} label="↗ your memories on the dashboard" />)
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
      if (feed.length === 0 && dash !== 'down') {
        rows.push(<Text key="empty" color={C.faint}>{dash === 'unknown' ? 'reading the dashboard…' : 'nothing yet'}</Text>)
      }
      const lw = 12
      const tw = Math.max(8, w - lw)
      const room = Math.max(4, (e.props.scroll?.bodyRows ?? 60) - rows.length - 2)
      let spent = 0
      for (const r of feed) {
        if (spent + 2 > room) break
        const m = mechById(r.mech)
        const col = hex(m === undefined ? [0, 0.9, 1] : stageOf(m.id).col)
        const isOpen = opened?.id === r.id
        const fresh = r.live === true && now - r.at < 1500
        const all = wrap(r.text, tw)
        const first = all[0] ?? ''
        const second = isOpen ? (all[1] ?? '') : all.length > 2 ? ellipsize(`${all[1] ?? ''} ${all.slice(2).join(' ')}`, tw) : (all[1] ?? '')
        const word = ellipsize(r.word, lw - 3).padEnd(lw - 2)
        const time = clock(r.at, now).padEnd(lw - 2)
        rows.push(
          <Button key={`row:${r.id}:0`} plain onPress={() => openRow($, r.id)}>
            <Text color={col}>● </Text>
            <Text color={isOpen || fresh ? C.white : col} bold>{word}</Text>
            <Text color={isOpen || fresh ? C.white : C.body}>{first}</Text>
          </Button>,
        )
        rows.push(
          <Button key={`row:${r.id}:1`} plain onPress={() => openRow($, r.id)}>
            <Text color={C.faint}>{`  ${time}`}</Text>
            <Text color={isOpen ? C.white : C.body}>{second}</Text>
          </Button>,
        )
        spent += 2
        if (isOpen) {
          const extra = [
            ...all.slice(2).map(l => ({ l, main: true })),
            ...r.more.flatMap(x => wrap(x, tw).map(l => ({ l, main: false }))),
          ]
          extra.forEach((x, i) => {
            rows.push(
              <Box key={`row:${r.id}:x${String(i)}`} flexDirection="row">
                <Text color={hex(m === undefined ? [0, 0.9, 1] : stageOf(m.id).col, 0.45)}>{'  │'.padEnd(lw)}</Text>
                <Text color={x.main ? C.white : C.dim}>{x.l}</Text>
              </Box>,
            )
          })
          rows.push(
            <Box key={`row:${r.id}:link`} flexDirection="row">
              <Text>{' '.repeat(lw)}</Text>
              <Link href={r.url} label={`↗ ${r.label}`} />
            </Box>,
          )
          spent += extra.length + 1
        }
        rows.push(<Text key={`row:${r.id}:gap`}> </Text>)
        spent += 1
      }
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {rows}
      </Box>
    )
  })
}
