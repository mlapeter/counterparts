/**
 * The sidebar through the engine: its hooks, the trees it draws on the
 * terminal and the desktop, and what it asks of the engine beneath (all of it
 * answered by ./world.ts). Each UI test runs its body on both surfaces.
 */
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { decodeCells } from '../hooks/cells'
import { BAND_PROPS, HERE, HOME, PANE, PANE_PROPS, PLUGIN, PLUGIN_TOOLS, RECALL_BLOCK, SCOPES_FILE, SESSION, VIEWPORT, settle, start, world } from './world'
import type { World } from './world'

const SURFACES = ['terminal', 'desktop'] as const

async function mount($: Engine, w: World, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS, viewport: VIEWPORT })
  await settle(w)
  return ui
}

async function texts(ui: Awaited<ReturnType<typeof mount>>): Promise<string> {
  const all = await ui.findAll({})
  return all.map(el => el.text).join('\n')
}

type Drawn = { children?: unknown[]; props?: Record<string, unknown> }
function flat(n: unknown): string {
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n.map(flat).join('')
  if (n !== null && typeof n === 'object') {
    const d = n as Drawn
    return flat(d.children ?? d.props?.['children'] ?? [])
  }
  return ''
}

/** A list Client's drawing, one string a line (its column's children). */
async function listLines(ui: Awaited<ReturnType<typeof mount>>, key: string): Promise<string[]> {
  const root = (await ui.drawn({ in: key })) as unknown as Drawn
  const kids = (root.children ?? (root.props?.['children'] as unknown[] | undefined) ?? []) as unknown[]
  return kids.map(flat)
}

/** A plain click on the first line of a list that holds `match`. */
async function click(ui: Awaited<ReturnType<typeof mount>>, key: string, match: string): Promise<void> {
  const lines = await listLines(ui, key)
  const y = lines.findIndex(l => l.includes(match))
  if (y < 0) throw new Error(`no line holding ${match} in: ${lines.join(' | ')}`)
  await ui.pointer({ type: 'down', x: 2, y, button: 'left', in: key })
}

/** The band above the prompt drawing once, on a surface that docks panes or doesn't. */
async function band($: Engine, w: World, docks: boolean): Promise<void> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: { ...VIEWPORT, isFullscreen: docks } })
  await settle(w)
  await ui.unmount()
}

test('at session start nothing is opened or drawn and the dashboard is not read, but this folder’s registry entry is; a docking surface opens it, 44 columns', async ($, on) => {
  const w = world(on)
  await start($, w)
  expect(w.opens).toHaveLength(0)
  expect(w.fetches).toHaveLength(0)
  expect(w.mcp).toHaveLength(0) // no tool: the registry file, read-only
  expect(w.fsReads).toContain(SCOPES_FILE)
  await band($, w, true)
  expect(w.opens).toEqual([{ id: PANE, title: 'Counterparts', columns: 44 }])
  expect(w.fetches).toHaveLength(0) // still nothing read: the pane has not drawn
})

test('on the main screen (no docking) nothing is opened unasked and nothing is said; /counterparts opens it', async ($, on) => {
  const w = world(on)
  await start($, w)
  await band($, w, false)
  expect(w.opens).toHaveLength(0)
  expect(w.lastStatus()).toBe('')
  const out = await $.command.run({ command: 'counterparts', args: '' } as never)
  expect(out.text).toBe('Counterparts sidebar opened.')
  expect(w.opens).toHaveLength(1)
  const usage = await $.command.run({ command: 'counterparts', args: 'nonsense' } as never)
  expect(usage.text).toContain('Usage: /counterparts')
})

test('a docking terminal too narrow for an unasked pane: the status line names /counterparts until the pane draws', async ($, on) => {
  const w = world(on, { placed: false })
  await start($, w)
  await band($, w, true)
  expect(w.lastStatus()).toContain('/counterparts opens the sidebar')
  const ui = await mount($, w, 'terminal')
  expect(w.lastStatus()).not.toContain('/counterparts')
  await ui.unmount()
})

test('drawn, it reads the dashboard and heads itself with the day and the count', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(w.fetches.some(u => u.endsWith('/api/pulse'))).toBe(true)
    expect(w.lastStatus()).toBe('◉ day 18 · 776 memories')
    expect((await ui.find({ type: 'Text', text: 'day 18 · 776' }))?.text).toBe('day 18 · 776')
    expect(await ui.find({ type: 'Text', text: '◉ COUNTERPARTS' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'fold' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'toggle-cp' }))?.text).toContain('Counterparts memory · this folder')
    expect((await ui.find({ type: 'Button', key: 'toggle-mem' }))?.text).toContain("Claude Code's own memory")
    if (surface === 'terminal') {
      const r = await ui.find({ type: 'Raster', key: 'brain' })
      expect(r?.props['columns']).toBe(42)
      expect(r?.props['rows']).toBe(14)
    } else {
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'the brain draws in the terminal' })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('the dashboard is read while the pane shows: cheap reads every 15 s, every 30 s once quiet, none when it is not shown', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  const pulses = () => w.fetches.filter(u => u.endsWith('/api/pulse')).length
  const since = () => w.fetches.filter(u => u.includes('sinceSeq=')).length
  expect(pulses()).toBe(1)
  await w.clock.advance(15000)
  expect(since()).toBe(1) // a cheap read, not the pulse
  expect(pulses()).toBe(1)
  await w.clock.advance(15000 * 3)
  expect(since()).toBe(4)
  await w.clock.advance(15000)
  expect(since()).toBe(4) // four quiet reads in a row: now every 30 s
  await w.clock.advance(15000)
  expect(since()).toBe(5)
  w.shown = false // the person showed another pane
  const before = w.fetches.length
  await w.clock.advance(120000)
  expect(w.fetches.length).toBe(before)
  await ui.unmount()
})

test('the switches are text cells a press reaches: a cyan track and white knob when on', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    const sw = await ui.find({ type: 'Button', key: 'toggle-mem' })
    const cells = (sw?.children ?? []).filter((c): c is { props: Record<string, unknown> } => typeof c === 'object' && c !== null)
    expect(cells.some(c => c.props['backgroundColor'] === '#00e5ff')).toBe(true)
    expect(cells.some(c => c.props['color'] === '#f4fcff')).toBe(true)
    expect(sw?.text).toContain('▐') // half-block ends by default: iTerm2 drew the Powerline caps as `?`
    expect(sw?.text).not.toContain('\uE0B6')
    await ui.unmount()
  }
  const out = await $.command.run({ command: 'counterparts', args: 'caps' } as never)
  expect(out.text).toContain('round caps')
  const ui = await mount($, w, 'terminal')
  expect((await ui.find({ type: 'Button', key: 'toggle-mem' }))?.text).toContain('\uE0B6')
  await ui.unmount()
})

test('the brain is a Raster the terminal can hold, repainted by blits; /counterparts fps reports the rate', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  const r = await ui.find({ type: 'Raster', key: 'brain' })
  const cells = decodeCells(String(r?.props['cells']))
  expect(cells.length).toBe(42 * 14 * 3)
  await w.clock.advance(1000)
  expect(w.blits.length).toBeGreaterThanOrEqual(4) // swaying draws every other tick of twelve: six a second
  expect(w.blits.length).toBeLessThanOrEqual(7)
  expect(w.blits.every(b => b.requestId === PANE && b.key === 'brain' && b.columns === 42 && b.rows === 14)).toBe(true)
  const out = await $.command.run({ command: 'counterparts', args: 'fps' } as never)
  expect(out.text).toMatch(/Brain: [\d.]+ fps achieved/)
  expect(out.text).toContain('(target 12)')
  expect(out.text).toContain('The status line now shows it.')
  await w.clock.advance(1200)
  expect(w.lastStatus()).toMatch(/ · [\d.]+ fps$/)
  const set = await $.command.run({ command: 'counterparts', args: 'fps 15' } as never)
  expect(set.text).toContain('Brain target set to 15 fps.')
  await ui.unmount()
})

test('the timer keeps the brain’s pace: calm while it sways, burst only while an arc flies, none at rest until a pick, a pulse or an open wakes it', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_p0000001"}' }))
  await start($, w)
  const ui = await mount($, w, 'terminal')
  const report = async () => (await $.command.run({ command: 'counterparts', args: 'fps' } as never)).text ?? ''
  await w.clock.advance(2000)
  expect(await report()).toContain('now swaying (6 fps)')
  // a quiet minute and a little: it eases to rest, and the timer stops
  await w.clock.advance(90000)
  expect(await report()).toContain('now at rest (no timer)')
  let n = w.blits.length
  await w.clock.advance(10000)
  expect(w.blits.length).toBe(n)
  // a picked mechanism wakes it
  await ui.press({ key: 'm:decay' })
  await w.clock.advance(1000)
  expect(w.blits.length - n).toBeGreaterThanOrEqual(3)
  expect(await report()).toContain('now swaying')
  await ui.press({ key: 'm:decay' })
  await w.clock.advance(120000)
  expect(await report()).toContain('now at rest (no timer)')
  // a pulse (a kept note) wakes it at the burst rate while its arc flies
  n = w.blits.length
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Wake up', text: 'x' } as never)
  await settle(w)
  await w.clock.advance(1000)
  expect(await report()).toContain('now in a burst (12 fps)')
  expect(w.blits.length - n).toBeGreaterThanOrEqual(8)
  await w.clock.advance(3000)
  expect(await report()).toContain('now swaying')
  // opening it full wakes it too: at rest, quiet, then full again
  await w.clock.advance(120000)
  expect(await report()).toContain('now at rest (no timer)')
  await ui.press({ key: 'fold' })
  await ui.press({ key: 'unfold' })
  await w.clock.advance(1000)
  expect(await report()).toContain('now swaying')
  await ui.unmount()
})

test('the brain stops when its Raster is gone: refused blits stop the timer after a few fresh drawings', async ($, on) => {
  const w = world(on, { blitDeny: true })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  for (let i = 0; i < 6; i++) {
    await w.clock.advance(1000)
    await ui.drawn() // a fresh drawing the module asked for is drawn before a read
  }
  expect(w.blits).toHaveLength(0)
  expect(w.denied).toBeLessThanOrEqual(4) // the first refusal and three redraws, then it stays stopped
  const n = w.denied
  await w.clock.advance(3000)
  await ui.drawn()
  expect(w.denied).toBe(n)
  await ui.unmount()
})

test('a blit refused because the Raster is not mounted yet: a fresh drawing starts the brain again', async ($, on) => {
  const w = world(on, { blitDenyFirst: 1 })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await w.clock.advance(500)
  await ui.drawn()
  await w.clock.advance(2000)
  expect(w.denied).toBe(1)
  expect(w.blits.length).toBeGreaterThanOrEqual(8)
  await ui.unmount()
})

test('closed and opened again (here: quiet and back), a late refusal of an old blit does not freeze the brain', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await w.clock.advance(500)
  w.slowDeny = 1 // the next blit is answered 600 ms late, refused: the pane it was for is gone
  await w.clock.advance(200)
  await ui.press({ key: 'fold' })
  await ui.press({ key: 'unfold' })
  const before = w.blits.length
  await w.clock.advance(1000) // the stale refusal lands in here
  await ui.drawn()
  await w.clock.advance(2000)
  expect(w.denied).toBe(1)
  expect(w.blits.length - before).toBeGreaterThanOrEqual(10)
  await ui.unmount()
})

test('/counterparts asks for a fresh drawing: a pane reopened after a hand-close is not left on its settled drawing', async ($, on) => {
  const w = world(on)
  on('ui.invalidate', (_$, e) => {
    w.invalidations.push(e.event)
    return { value: undefined }
  })
  await start($, w)
  const out = await $.command.run({ command: 'counterparts', args: '' } as never)
  expect(out.text).toBe('Counterparts sidebar opened.')
  expect(w.invalidations).toContain('ui.render')
})

test('while the pane holds the keyboard (typing a search) the brain holds still; given back, it turns again', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE,
    props: { ...PANE_PROPS, isFocused: true } as typeof PANE_PROPS, viewport: VIEWPORT,
  })
  await settle(w)
  await w.clock.advance(2000)
  expect(w.blits).toHaveLength(0)
  await ui.redraw({ ...PANE_PROPS, isFocused: false } as typeof PANE_PROPS)
  await w.clock.advance(2000)
  expect(w.blits.length).toBeGreaterThanOrEqual(8)
  await ui.unmount()
})

test('inline above the prompt the brain stays small', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE,
    props: { ...PANE_PROPS, bodyColumns: 120, placement: 'inline' } as typeof PANE_PROPS,
    viewport: { columns: 120, rows: 40, isFullscreen: false },
  })
  await settle(w)
  const r = await ui.find({ type: 'Raster', key: 'brain' })
  expect(r?.props['columns']).toBe(30)
  expect(r?.props['rows']).toBe(10)
  await ui.unmount()
})

// Closing by hand (`ui.close`, origin `person`) can't be raised from the test kit (its `ui` noun has
// render, scroll and focus); it is checked live in NOTES.md.

test('the twelve mechanisms: a press opens its stage and line and lights the brain; again, or 30 s, closes it', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect((await ui.find({ type: 'Button', key: 'm:schema' }))?.text).toContain('○')
    expect((await ui.find({ type: 'Button', key: 'm:salience' }))?.text).toContain('●')
    await ui.press({ key: 'm:decay' })
    let shown = await texts(ui)
    expect(shown).toContain('STORAGE')
    expect(shown).toContain("Forgetting isn't a failure of memory.")
    if (surface === 'terminal') {
      const r = await ui.find({ type: 'Raster', key: 'brain' })
      const cells = decodeCells(String(r?.props['cells']))
      let text = ''
      for (let i = 0; i < cells.length; i += 3) text += String.fromCharCode(cells[i] ?? 32)
      expect(text).toContain(' Forgetting ')
    }
    await ui.press({ key: 'm:decay' })
    expect(await texts(ui)).not.toContain('STORAGE')
    await ui.press({ key: 'm:prospective' })
    expect(await texts(ui)).toContain('RETRIEVAL')
    await w.clock.advance(30001)
    shown = await texts(ui)
    expect(shown).not.toContain('RETRIEVAL')
    await ui.unmount()
  }
})

test('ACTIVITY: this session’s and the night’s rows in plain words, word over time; other sessions fold into one line', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(await ui.find({ type: 'Text', text: 'ACTIVITY' })).toBeDefined()
    const lines = await listLines(ui, 'activity')
    expect(lines[0]).toMatch(/^● kept\s+The sidebar draws the brain/) // this session's, the mod's words
    expect(lines[1]).toMatch(/^\s+1:25pm\s/)
    expect(lines.some(l => /^● recalled\s+2 came to mind/.test(l))).toBe(true) // not the narrator's sentence
    expect(lines.join('\n')).not.toContain('On turn')
    expect(lines.some(l => /^● dreamed\s+I dreamed/.test(l))).toBe(true) // the night's
    expect(lines.some(l => /^\s+3:35am\s/.test(l))).toBe(true)
    expect(lines).toContain('+1 from other sessions') // another session's recall, folded
    expect(lines.join('\n')).not.toContain('sleep') // a sleep check that faded nothing is left out
    await ui.unmount()
  }
})

test('a click opens a row with its detail and link; a click on the link opens it in the browser; 30 s closes the row', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    await click(ui, 'activity', 'came to mind')
    let lines = await listLines(ui, 'activity')
    expect(lines.join('\n')).toContain('· Release notes go out on')
    expect(lines.some(l => l.includes('↗ Retrieval on the dashboard'))).toBe(true)
    await click(ui, 'activity', '↗ Retrieval on the dashboard')
    expect(w.runs.at(-1)).toEqual(['open', 'http://localhost:4747/#health/mechanisms?id=retrieval'])
    await ui.advance(30000)
    lines = await listLines(ui, 'activity')
    expect(lines.some(l => l.includes('↗'))).toBe(false)
    await click(ui, 'activity', 'The sidebar draws')
    expect((await listLines(ui, 'activity')).join('\n')).toContain('kept as a fact')
    await click(ui, 'activity', 'The sidebar draws') // a second click closes it
    expect((await listLines(ui, 'activity')).join('\n')).not.toContain('kept as a fact')
    await ui.unmount()
  }
  expect(w.runs[0]).toEqual(['uname', '-s']) // how this machine opens a URL, asked once
  expect(w.runs.filter(r => r[0] === 'uname')).toHaveLength(1)
})

test('with the dashboard down it says how to start it inside the pane, and the status line says nothing of it', async ($, on) => {
  const w = world(on, { down: true })
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(await ui.find({ type: 'Text', text: 'counterparts dashboard' })).toBeDefined()
    await ui.unmount()
  }
  expect(w.statuses.some(s => (s ?? '').includes('dashboard'))).toBe(false)
})

test('kept: a note the model writes shows as a kept row, a toast, and a count', async ($, on) => {
  const w = world(on)
  on('tool.call', (_$, e) =>
    String(e.tool).endsWith('__note') && (e as unknown as { text?: string }).text === 'refuse me'
      ? { result: 'refused', text: '{"stored":false,"reason":"duplicate"}' }
      : { result: 'ok', text: '{"stored":true,"id":"mem_new00001"}' },
  )
  await start($, w)
  const first = await mount($, w, 'terminal')
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Sidebar v0.1 is a PR', text: 'The sidebar mod is up for review.' } as never)
  await $.tool.call({ tool: 'mcp__counterparts__note', text: 'refuse me' } as never)
  await $.tool.call({ tool: 'mcp__counterparts__recall', question: 'x', mode: 'facts' } as never)
  await settle(w)
  await first.unmount()
  expect(w.toasts).toEqual(['◆ kept  Sidebar v0.1 is a PR'])
  expect(w.lastStatus()).toBe('◉ day 18 · 776 memories · 1 kept')
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    const lines = await listLines(ui, 'activity')
    expect(lines[0]).toMatch(/^● kept\s+Sidebar v0.1 is a PR/)
    expect(lines.join('\n')).not.toContain('refuse me')
    await ui.unmount()
  }
})

test('kept under the plugin’s own server name too', async ($, on) => {
  const w = world(on, { tools: PLUGIN_TOOLS })
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_new00002"}' }))
  await start($, w)
  await $.tool.call({ tool: 'mcp__plugin_counterparts_counterparts__note', title: 'From the plugin server', text: 'x' } as never)
  await w.clock.settle()
  expect(w.toasts).toEqual(['◆ kept  From the plugin server'])
})

test('came to mind: the recall block the classic hook injects shows as a recalled row and a count; /clear starts the counts over', async ($, on) => {
  const w = world(on)
  await start($, w)
  const first = await mount($, w, 'terminal')
  await $.session.append({
    door: 'hook-context',
    origin: { kind: 'hook', event: 'UserPromptSubmit' },
    uuid: 'row-0001',
    message: {
      type: 'attachment',
      name: 'hook_additional_context',
      content: [{ type: 'text', text: `<system-reminder>\nUserPromptSubmit hook additional context: ${RECALL_BLOCK}\n</system-reminder>` }],
    },
  } as never)
  await settle(w)
  await first.unmount()
  expect(w.lastStatus()).toBe('◉ day 18 · 776 memories · 2 came to mind')
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    const lines = await listLines(ui, 'activity')
    expect(lines[0]).toMatch(/^● recalled\s+2 came to mind$/)
    await ui.pointer({ type: 'down', x: 20, y: 1, button: 'left', in: 'activity' }) // either line of the row opens it
    const open = (await listLines(ui, 'activity')).join('\n')
    expect(open).toContain('· The sidebar slides to a')
    expect(open).toContain('· Release notes go out on')
    await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'activity' })
    expect((await listLines(ui, 'activity')).join('\n')).not.toContain('· The sidebar slides')
    await ui.unmount()
  }
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never)
  await settle(w)
  expect(w.lastStatus()).toBe('◉ day 18 · 776 memories')
})

test('search: Enter asks recall in facts mode; results read “memory · Oct 9”; a click opens one; ← activity is back at once', async ($, on) => {
  const w = world(on, { tools: PLUGIN_TOOLS })
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    await ui.input({ key: 'q', text: 'publish', kind: 'change' })
    expect(w.mcp.filter(c => c.tool === 'recall')).toHaveLength(surface === 'terminal' ? 0 : 1) // typing asks nothing
    await ui.input({ key: 'q', text: 'publish' })
    const call = w.mcp.filter(c => c.tool === 'recall').at(-1)
    expect(call).toEqual({ server: 'plugin_counterparts_counterparts', tool: 'recall', args: { question: 'publish', mode: 'facts' } })
    const shown = await texts(ui)
    expect(shown).toContain('2 FOUND')
    expect(shown).toContain('a search strengthens nothing')
    expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'ACTIVITY' })).toBeUndefined()
    let lines = await listLines(ui, 'results')
    expect(lines[0]).toMatch(/^● memory\s+Publishing waits for a test/)
    expect(lines[1]).toMatch(/^\s+Oct 9\s/)
    expect(lines.join('\n')).not.toContain('unknown')
    await click(ui, 'results', 'Publishing waits')
    lines = await listLines(ui, 'results')
    expect(lines.join('\n')).toContain('you said it')
    expect(lines.join('\n')).toContain('Publishing is mine once it is')
    await click(ui, 'results', '↗ open on the dashboard')
    expect(w.runs.at(-1)).toEqual(['open', 'http://localhost:4747/#memories'])
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: 'ACTIVITY' })).toBeDefined()
    await ui.unmount()
  }
})

test('search counts what matched in all, from the answer’s header, and says when it shows only the first page', async ($, on) => {
  const answer = [
    '14 match · showing 1 · 13 more → page 2',
    '',
    '1. Sidebar · npm_install · notes · mem_side00001 · words',
    '   you said · done · happened 10-09',
    '   An excerpt.',
  ].join('\n')
  const w = world(on, { factsAnswer: answer })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await ui.input({ key: 'q', text: 'sidebar' })
  const shown = await texts(ui)
  expect(shown).toContain('14 FOUND')
  expect(shown).toContain('for “sidebar” · the first 1')
  expect((await listLines(ui, 'results'))[0]).toContain('Sidebar · npm_install · notes')
  await ui.unmount()
})

test('the Counterparts switch asks before it pauses a folder set on, and resumes it at once; paused, the brain is grey and the list says so', async ($, on) => {
  const w = world(on)
  await start($, w)
  expect(w.mcp).toHaveLength(0) // read from the registry file, not the tool
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    const before = w.mcp.length
    await ui.press({ key: 'toggle-cp' })
    expect(w.mcp).toHaveLength(before) // the press asked first, and called nothing
    expect(await ui.find({ type: 'Button', key: 'confirm-pause' })).toBeDefined()
    await ui.press({ key: 'confirm-pause' })
    expect(w.mcp.at(-1)).toEqual({ server: 'counterparts', tool: 'scope', args: { mode: 'pause' } })
    expect(await ui.find({ type: 'Button', key: 'confirm-pause' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'PAUSED' })).toBeDefined()
    expect(w.lastStatus()).toBe('⏸ Counterparts memory paused in this folder · /counterparts resume')
    if (surface === 'terminal') {
      const cells = decodeCells(String((await ui.find({ type: 'Raster', key: 'brain' }))?.props['cells']))
      for (let i = 0; i < cells.length; i += 3) {
        expect(cells[i + 2]).toBe(0x05080c) // the sidebar's own black, no glow
        const fg = cells[i + 1] ?? 0
        if ((cells[i] ?? 0) === 0x20) continue
        const r = (fg >> 16) & 255, g = (fg >> 8) & 255, b = fg & 255
        expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40)
      }
    }
    await ui.press({ key: 'toggle-cp' }) // resuming asks nothing
    expect(w.mcp.at(-1)).toEqual({ server: 'counterparts', tool: 'scope', args: { mode: 'resume' } })
    expect(w.scope.mode).toBe('on')
    expect(await ui.find({ type: 'Text', text: 'ACTIVITY' })).toBeDefined()
    await ui.unmount()
  }
  expect(w.mcp.filter(c => c.tool === 'scope' && c.args['mode'] === undefined)).toHaveLength(0)
})

test('a folder set off shows off, and the switch explains rather than turning it on', async ($, on) => {
  const w = world(on, { scopeMode: 'off' })
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(await ui.find({ type: 'Text', text: 'OFF' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '◌ Counterparts memory off in this folder' })).toBeDefined()
    expect(w.lastStatus()).toBe('◌ Counterparts memory off in this folder')
    await ui.press({ key: 'toggle-cp' })
    expect(w.mcp.some(c => c.args['mode'] !== undefined)).toBe(false) // no resume sent, ever
    const said = (await texts(ui)).replace(/▎/g, '').replace(/\s+/g, ' ')
    expect(said).toContain('This folder is set off')
    expect(said).toContain(`counterparts scope ${HERE}`)
    expect(said).toContain('--on` does.')
    await ui.unmount()
  }
})

test('an unset folder is on by default; the switch explains instead of writing a pause that would end as an explicit on', async ($, on) => {
  const w = world(on, { scopeMode: 'unset', scopeSetBy: null })
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    await ui.press({ key: 'toggle-cp' })
    expect(w.mcp.some(c => c.args['mode'] !== undefined)).toBe(false)
    const shown = (await texts(ui)).replace(/▎/g, '').replace(/\s+/g, ' ')
    expect(shown).toContain('Nothing is set for this folder')
    expect(shown).toContain(`counterparts scope ${HERE}`)
    expect(shown).toContain('--on` gives it one.')
    await ui.unmount()
  }
  expect(w.scope.mode).toBe('unset')
})

test('a folder that follows its parent: the switch explains; paused by a parent, it says where to resume', async ($, on) => {
  const w = world(on, { scopeMode: 'paused', scopeSetBy: '/work' })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await ui.press({ key: 'toggle-cp' })
  expect(w.mcp.some(c => c.args['mode'] !== undefined)).toBe(false)
  expect((await texts(ui)).replace(/▎/g, '').replace(/\s+/g, ' ')).toContain('Resume it there: `counterparts scope /work')
  await ui.unmount()
})

test('observer shows as reads-only, not on; a pause of it resumes to observer', async ($, on) => {
  const w = world(on, { scopeMode: 'observer' })
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    const sw = await ui.find({ type: 'Button', key: 'toggle-cp' })
    expect(sw?.text).toContain('Counterparts reads only · this folder')
    const cells = (sw?.children ?? []).filter((c): c is { props: Record<string, unknown> } => typeof c === 'object' && c !== null)
    expect(cells.some(c => c.props['backgroundColor'] === '#0b6f7c')).toBe(true) // the darker, read-only track
    expect(w.lastStatus()).toContain('reads only here')
    await ui.press({ key: 'toggle-cp' })
    expect(w.scope.mode).toBe('observer') // asked first
    await ui.press({ key: 'confirm-pause' })
    expect(w.scope.mode).toBe('paused')
    await ui.press({ key: 'toggle-cp' })
    expect(w.scope.mode).toBe('observer')
    await ui.unmount()
  }
})

test('where the folder stands is read from the registry file, with no permission check: the tool is called only for a confirmed pause or a resume', async ($, on) => {
  const w = world(on, { permission: 'ask' }) // auto mode with no allow rule, as on Mike's machine
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    if (surface === 'terminal') {
      expect(w.mcp).toHaveLength(0) // nothing asked, at start or at the drawing
      expect(drawnOn(await switchCellsOf(ui, 'toggle-cp'))).toBe(true) // and yet known: on
      await ui.press({ key: 'toggle-cp' })
      expect(w.mcp).toHaveLength(0)
      await ui.press({ key: 'confirm-pause' })
    } else await ui.press({ key: 'toggle-cp' }) // a resume asks nothing
    expect(w.mcp.at(-1)).toEqual({ server: 'counterparts', tool: 'scope', args: { mode: surface === 'terminal' ? 'pause' : 'resume' } })
    await ui.unmount()
  }
  expect(w.mcp).toHaveLength(2)
})

test('‹ makes it quiet: narrow, no brain, no reads, a compact list and a still ◉ that lights for an event; › opens it full', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_q0000001"}' }))
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    await ui.press({ key: 'fold' })
    expect(w.opens.at(-1)).toEqual({ id: PANE, title: 'Counterparts', columns: 22 })
    expect(await ui.find({ type: 'Button', key: 'unfold' })).toBeDefined()
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    const shown = await texts(ui)
    expect(shown).toContain('kept · The sidebar draws the brain')
    expect(shown).toContain('2 came to mind')
    expect(shown).toContain('+1 from other sessions')
    const fetches = w.fetches.length
    const blits = w.blits.length
    await w.clock.advance(120000)
    expect(w.fetches.length).toBe(fetches) // nothing read
    expect(w.blits.length).toBe(blits) // nothing drawn
    await $.tool.call({ tool: 'mcp__counterparts__note', title: `Quiet on ${surface}`, text: 'x' } as never)
    await settle(w)
    const lit = await ui.findAll({ type: 'Text', text: '◉' })
    expect(lit.some(t => t.props['color'] === '#00e5ff')).toBe(true) // Salience's stage colour
    await w.clock.advance(3000)
    expect((await ui.findAll({ type: 'Text', text: '◉' })).some(t => t.props['color'] === '#00e5ff')).toBe(false)
    await ui.press({ key: 'unfold' })
    expect(w.opens.at(-1)).toEqual({ id: PANE, title: 'Counterparts', columns: 44 })
    expect(await ui.find({ type: 'Button', key: 'fold' })).toBeDefined()
    await ui.unmount()
  }
})

test('hidden: the pane closes, the status line keeps one quiet line, nothing ticks or reads; the next session starts hidden', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_h0000001"}' }))
  await start($, w)
  const ui = await mount($, w, 'terminal')
  const out = await $.command.run({ command: 'counterparts', args: 'hide' } as never)
  expect(out.text).toContain('hidden')
  await ui.unmount()
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'While hidden', text: 'x' } as never)
  await settle(w)
  expect(w.lastStatus()).toBe('◉ 1 kept · /counterparts to open')
  const fetches = w.fetches.length
  const blits = w.blits.length
  await w.clock.advance(120000)
  expect(w.fetches.length).toBe(fetches)
  expect(w.blits.length).toBe(blits)
  const back = await $.command.run({ command: 'counterparts', args: '' } as never)
  expect(back.text).toBe('Counterparts sidebar opened.')
  expect(w.opens.at(-1)?.columns).toBe(44)
})

test('the band can draw before session.start has read the stored view: quiet stays quiet, hidden stays hidden, neither is overwritten', async ($, on) => {
  const w = world(on, { store: { view: 'quiet' } })
  await band($, w, true) // before session.start, as measured live
  expect(w.opens).toEqual([{ id: PANE, title: 'Counterparts', columns: 22 }])
  await start($, w)
  expect(w.store['view']).toBe('quiet')
  const ui = await mount($, w, 'terminal')
  expect(await ui.find({ type: 'Button', key: 'unfold' })).toBeDefined() // drawn quiet
  await ui.unmount()
  expect(w.store['view']).toBe('quiet')
})

test('hidden, and the band draws before session.start: nothing opens and the choice stands', async ($, on) => {
  const w = world(on, { store: { view: 'hidden' } })
  await band($, w, true)
  await start($, w)
  expect(w.opens).toHaveLength(0)
  expect(w.store['view']).toBe('hidden')
  expect(w.lastStatus()).toBe('◉ /counterparts to open')
})

test('a link opens only if it is the dashboard’s, in a strict character set; on Windows through rundll32, never cmd', async ($, on) => {
  const w = world(on, { windows: true })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await ui.post({ open: 'http://localhost:4747/#memories' }, { in: 'activity' })
  expect(w.runs.at(-1)).toEqual(['rundll32', 'url.dll,FileProtocolHandler', 'http://localhost:4747/#memories'])
  const n = w.runs.length
  await ui.post({ open: 'http://localhost:4747/#x&calc.exe' }, { in: 'activity' })
  await ui.post({ open: 'https://example.com/' }, { in: 'activity' })
  await ui.post({ open: 'http://localhost:4747/%20' }, { in: 'activity' })
  expect(w.runs.length).toBe(n)
  await ui.unmount()
})

test('left hidden in an earlier session: a docking surface does not open it unasked', async ($, on) => {
  const w = world(on, { store: { view: 'hidden' } })
  await start($, w)
  await band($, w, true)
  expect(w.opens).toHaveLength(0)
  expect(w.lastStatus()).toBe('◉ /counterparts to open')
})

test('left quiet in an earlier session: it opens quiet', async ($, on) => {
  const w = world(on, { store: { view: 'quiet' } })
  await start($, w)
  await band($, w, true)
  expect(w.opens).toEqual([{ id: PANE, title: 'Counterparts', columns: 22 }])
})

test('the Claude memory switch: on by default; off drops MEMORY.md and the memory section, and the status line says so', async ($, on) => {
  const w = world(on)
  const seen: string[][] = []
  on('prompt.context', (_$, e) => {
    seen.push((e.instructionFiles ?? []).map(f => f.kind))
    return { blocks: e.blocks, ...(e.instructionFiles === undefined ? {} : { instructionFiles: e.instructionFiles }) }
  })
  on('prompt.section', (_$, e) => ({ text: e.text }))
  on('ui.invalidate', (_$, e) => {
    w.invalidations.push(e.event)
    return { value: undefined }
  })
  await start($, w)
  const files = [
    { path: '/work/project/CLAUDE.md', kind: 'project' as const, content: 'project rules' },
    { path: '/home/.claude/projects/x/memory/MEMORY.md', kind: 'memory' as const, content: 'auto memory' },
  ]
  const ask = async () => {
    await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'project rules\nauto memory' }], instructionFiles: files })
    return (await $.prompt.section({ name: 'memory', text: '# Memory\nYou have a persistent memory.' })).text
  }
  expect(await ask()).toBe('# Memory\nYou have a persistent memory.')
  expect(seen.at(-1)).toEqual(['project', 'memory'])
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    await ui.press({ key: 'toggle-mem' })
    expect(w.invalidations).toEqual(expect.arrayContaining(['prompt.section', 'prompt.context']))
    expect(w.toasts.at(-1)).toContain('off from your next message, in every session')
    expect(w.lastStatus()).toContain('Claude memory off')
    expect(await ask()).toBeNull()
    expect(seen.at(-1)).toEqual(['project'])
    await ui.press({ key: 'toggle-mem' })
    expect(w.lastStatus()).not.toContain('Claude memory off')
    expect(await ask()).toBe('# Memory\nYou have a persistent memory.')
    expect(seen.at(-1)).toEqual(['project', 'memory'])
    await ui.unmount()
  }
})

test('turned off in an earlier session: every session’s status line says so, pane or not, and the switch draws off', async ($, on) => {
  const w = world(on, { store: { claudeMemory: false } })
  const seen: string[][] = []
  on('prompt.context', (_$, e) => {
    seen.push((e.instructionFiles ?? []).map(f => f.kind))
    return { blocks: e.blocks }
  })
  await start($, w)
  expect(w.lastStatus()).toBe('◉ Claude memory off')
  await $.prompt.context({ blocks: [], instructionFiles: [{ path: '/m/MEMORY.md', kind: 'memory', content: 'x' }] })
  expect(seen.at(-1)).toEqual([])
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    const sw = await ui.find({ type: 'Button', key: 'toggle-mem' })
    const cells = (sw?.children ?? []).filter((c): c is { props: Record<string, unknown> } => typeof c === 'object' && c !== null)
    expect(cells.some(c => c.props['backgroundColor'] === '#2c333c')).toBe(true) // the off track
    await ui.unmount()
  }
})

test('headless (-p): nothing opens, ticks or reads', async ($, on) => {
  const w = world(on)
  await start($, w, false)
  await w.clock.advance(120000)
  expect(w.opens).toHaveLength(0)
  expect(w.blits).toHaveLength(0)
  expect(w.fetches).toHaveLength(0)
  expect(w.mcp).toHaveLength(0)
  expect(w.fsReads).toHaveLength(0) // not even the folder's registry
})

// ── 2026-10-09: a press meant for Claude Code's memory paused ~/random, and
// the sidebar drew the unread state as on while three sessions there ran
// with no wake, no recall and no log lines. ──

/** The four cells of a switch, as drawn. */
async function switchCellsOf(ui: Awaited<ReturnType<typeof mount>>, key: string): Promise<{ text: string; props: Record<string, unknown> }[]> {
  const sw = await ui.find({ type: 'Button', key })
  return (sw?.children ?? []).filter((c): c is { text: string; props: Record<string, unknown> } => typeof c === 'object' && c !== null)
}

function drawnOn(cells: { props: Record<string, unknown> }[]): boolean {
  return cells.some(c => c.props['backgroundColor'] === '#00e5ff' || c.props['backgroundColor'] === '#0b6f7c' || c.props['color'] === '#f4fcff')
}

test('an unknown state is never drawn as on: a registry it cannot read says “state unknown · click to check”; a press asks the server, “checking…” meanwhile', async ($, on) => {
  const w = world(on, { scopesUnreadable: true, scopeReadMs: 800 })
  await start($, w)
  expect(w.mcp).toHaveLength(0)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    if (surface === 'terminal') {
      const cells = await switchCellsOf(ui, 'toggle-cp')
      expect(drawnOn(cells)).toBe(false)
      expect((await ui.find({ type: 'Button', key: 'toggle-cp' }))?.text).toContain('?')
      expect(await ui.find({ type: 'Text', text: /state unknown · click to check/ })).toBeDefined()
      expect(w.lastStatus()).not.toContain('paused')
      const pressing = ui.press({ key: 'toggle-cp' }) // the read takes 800 ms
      await settle(w)
      expect(await ui.find({ type: 'Text', text: /checking…/ })).toBeDefined()
      expect(drawnOn(await switchCellsOf(ui, 'toggle-cp'))).toBe(false)
      await w.clock.advance(1000)
      await pressing
      await settle(w)
      expect(drawnOn(await switchCellsOf(ui, 'toggle-cp'))).toBe(true) // read: on, so drawn on
      expect(await ui.find({ type: 'Text', text: /state unknown/ })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('each switch says what it governs; hovered, what a click does, in two lines kept for it so nothing moves', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    const shown = (await texts(ui)).replace(/\s+/g, ' ')
    expect(shown).toContain('Counterparts memory · this folder')
    expect(shown).toContain("Claude Code's own memory")
    // The hover lines are drawn hidden (display none) and revealed by the surface while a switch's row is hovered.
    expect(shown).toContain('Pauses this for every session here: no wake, recall or saving. Asks first.')
    expect(shown).toContain("Turns off Claude Code's own MEMORY.md in every session, from your next message.")
    // Nothing hidden sits in a switch's own row, so a reveal can't push a control; the room for it is fixed.
    for (const key of ['row-cp', 'row-mem']) {
      const row = drawnNode(await ui.drawn(), key)
      expect(row).toBeDefined()
      expect(hiddenBoxes(row)).toHaveLength(0)
      expect(row?.hover?.['scope']).toMatch(/^counterparts-switch-/)
    }
    const room = drawnNode(await ui.drawn(), 'switch-why')
    expect(room?.props['height']).toBe(2)
    expect(room?.props['overflow']).toBe('hidden')
    const reveals = hiddenBoxes(room).map(b => b.hover)
    expect(reveals).toEqual([
      { display: 'flex', scope: 'counterparts-switch-cp' },
      { display: 'flex', scope: 'counterparts-switch-mem' },
    ])
    await ui.unmount()
  }
})

type Node = { type?: string; props: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

/** The element keyed `key` in a drawn tree (where a Box's `hover` sits beside its props). */
function drawnNode(tree: unknown, key: string): Node | undefined {
  if (tree === null || typeof tree !== 'object') return undefined
  const node = tree as Node
  if (node.props?.['key'] === key) return node
  for (const c of node.children ?? []) {
    const hit = drawnNode(c, key)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** The Boxes drawn hidden beneath an element. */
function hiddenBoxes(el: unknown): Node[] {
  const out: Node[] = []
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== 'object') return
    const node = n as Node
    if (node.props?.['display'] === 'none') out.push(node)
    for (const c of node.children ?? []) walk(c)
  }
  for (const c of (el as Node | undefined)?.children ?? []) walk(c)
  return out
}

test('pausing asks first: Cancel calls nothing, and an unanswered ask closes by itself', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    const calls = () => w.mcp.filter(c => c.args['mode'] !== undefined)
    await ui.press({ key: 'toggle-cp' })
    expect(calls()).toHaveLength(0)
    expect((await texts(ui)).replace(/▎/g, '').replace(/\s+/g, ' ')).toContain(`Pause Counterparts memory in ${HERE} for every session here?`)
    await ui.press({ key: 'cancel-pause' })
    expect(await ui.find({ type: 'Button', key: 'confirm-pause' })).toBeUndefined()
    expect(calls()).toHaveLength(0)
    await ui.press({ key: 'toggle-cp' })
    expect(await ui.find({ type: 'Button', key: 'confirm-pause' })).toBeDefined()
    await w.clock.advance(31000)
    expect(await ui.find({ type: 'Button', key: 'confirm-pause' })).toBeUndefined()
    expect(calls()).toHaveLength(0)
    expect(w.scope.mode).toBe('on')
    await ui.unmount()
  }
})

test('a paused folder says so in every view: amber in the pane, the quiet view and the status line, hidden or not; /counterparts resume', async ($, on) => {
  const w = world(on, { scopeMode: 'paused' })
  await start($, w)
  const paused = '⏸ Counterparts memory paused in this folder · /counterparts resume'
  expect(w.lastStatus()).toBe(paused) // before any pane is drawn
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    const banner = await ui.find({ type: 'Text', text: '⏸ Counterparts paused in this folder' })
    expect(banner?.props['color']).toBe('#ffb347')
    expect((await ui.find({ type: 'Button', key: 'resume-banner' }))?.text).toContain('click to resume')
    expect(drawnOn(await switchCellsOf(ui, 'toggle-cp'))).toBe(false)
    await ui.press({ key: 'fold' })
    expect((await ui.find({ type: 'Text', text: '⏸ Counterparts paused' }))?.props['color']).toBe('#ffb347')
    expect(await ui.find({ type: 'Button', key: 'resume-banner' })).toBeDefined()
    expect(w.lastStatus()).toBe(paused)
    await ui.press({ key: 'unfold' })
    await ui.unmount()
  }
  await $.command.run({ command: 'counterparts', args: 'hide' } as never)
  expect(w.lastStatus()).toBe(paused)
  const out = await $.command.run({ command: 'counterparts', args: 'resume' } as never)
  expect(out.text).toBe(`Counterparts memory is back on in ${HERE}.`)
  expect(w.mcp.at(-1)?.args).toEqual({ mode: 'resume' })
  expect(w.lastStatus()).toBe('◉ /counterparts to open')
})

test('the paused banner resumes with one click', async ($, on) => {
  const w = world(on, { scopeMode: 'paused' })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await ui.press({ key: 'resume-banner' })
  expect(w.mcp.at(-1)?.args).toEqual({ mode: 'resume' })
  expect(await ui.find({ type: 'Button', key: 'resume-banner' })).toBeUndefined()
  await ui.unmount()
})

test('paused by a parent folder: the banner names it and explains, and resumes nothing here', async ($, on) => {
  const w = world(on, { scopeMode: 'paused', scopeSetBy: '/work' })
  await start($, w)
  expect(w.lastStatus()).toBe('⏸ Counterparts memory paused in this folder · resume it in /work')
  const ui = await mount($, w, 'terminal')
  expect((await ui.find({ type: 'Button', key: 'resume-banner' }))?.text).toContain('paused by /work')
  await ui.press({ key: 'resume-banner' })
  expect(w.mcp.some(c => c.args['mode'] !== undefined)).toBe(false)
  expect((await texts(ui)).replace(/▎/g, '').replace(/\s+/g, ' ')).toContain('Resume it there: `counterparts scope /work')
  await ui.unmount()
})

test('repro 2026-10-09: another session pauses this folder; a session started there shows paused at once, and never draws on', async ($, on) => {
  const w = world(on, { permission: 'ask' }) // auto mode, no allow rule for the scope tool
  // The other session's press, as the server kept it: this folder's own entry, paused.
  Object.assign(w.scope, { mode: 'paused', setBy: HERE, resumeTo: 'on' })
  await start($, w)
  expect(w.opens).toHaveLength(0)
  expect(w.mcp).toHaveLength(0) // read from the registry file: no tool, no dialog
  expect(w.lastStatus()).toBe('⏸ Counterparts memory paused in this folder · /counterparts resume')
  await band($, w, true)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(await ui.find({ type: 'Text', text: '⏸ Counterparts paused in this folder' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'PAUSED' })).toBeDefined()
    expect(drawnOn(await switchCellsOf(ui, 'toggle-cp'))).toBe(false)
    await ui.unmount()
  }
})

test('stale no longer: a pause made in another session shows within one poll while the pane is drawn, and within a minute while hidden', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  expect(await ui.find({ type: 'Text', text: '⏸ Counterparts paused in this folder' })).toBeUndefined()
  Object.assign(w.scope, { mode: 'paused', setBy: HERE, resumeTo: 'on' }) // the other session's pause
  await w.clock.advance(16000) // one dashboard poll
  await settle(w)
  expect(await ui.find({ type: 'Text', text: '⏸ Counterparts paused in this folder' })).toBeDefined()
  expect(w.lastStatus()).toBe('⏸ Counterparts memory paused in this folder · /counterparts resume')
  const out = await $.command.run({ command: 'counterparts', args: 'hide' } as never)
  expect(out.text).toContain('hidden')
  await ui.unmount()
  Object.assign(w.scope, { mode: 'on' }) // resumed elsewhere
  await w.clock.advance(61000)
  await settle(w)
  expect(w.lastStatus()).toBe('◉ /counterparts to open')
  Object.assign(w.scope, { mode: 'paused' })
  await $.command.run({ command: 'counterparts', args: 'fps' } as never) // any /counterparts reads it at once
  expect(w.lastStatus()).toContain('⏸ Counterparts memory paused in this folder')
})

test('the registry is the one the wired hooks read: a settings hook’s own --config moves it (and a Bun --config= before the script is Bun’s)', async ($, on) => {
  const hook = '"bun" --no-env-file "--config=/opt/cp/src/adapters/empty-bunfig.toml" run "/opt/cp/src/adapters/claude-code/bin/hook.ts" --config "/cfg/alt/claude-code.json"'
  const settings = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hook }] }] } })
  const w = world(on, { scopeMode: 'paused', registryAt: '/cfg/alt/scopes.json', files: { [`${HOME}/.claude/settings.json`]: settings } })
  await start($, w)
  expect(w.fsReads).toContain('/cfg/alt/scopes.json')
  expect(w.fsReads).not.toContain(SCOPES_FILE)
  expect(w.lastStatus()).toBe('⏸ Counterparts memory paused in this folder · /counterparts resume')
})
