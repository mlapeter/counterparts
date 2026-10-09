/**
 * The sidebar through the engine: its hooks, the trees it draws on the
 * terminal and the desktop, and what it asks of the engine beneath (all of it
 * answered by ./world.ts). Each UI test runs its body on both surfaces.
 */
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { decodeCells } from '../hooks/cells'
import { PANE, PANE_PROPS, PLUGIN, PLUGIN_TOOLS, RECALL_BLOCK, SESSION, T0, VIEWPORT, start, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const

function mount($: Engine, surface: (typeof SURFACES)[number]) {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS, viewport: VIEWPORT })
}

async function texts(ui: Awaited<ReturnType<typeof mount>>): Promise<string> {
  const all = await ui.findAll({})
  return all.map(el => el.text).join('\n')
}

test('opens the sidebar at session start, 44 columns, and heads it with the day and the count', async ($, on) => {
  const w = world(on)
  await start($, w)
  expect(w.opens[0]).toEqual({ id: PANE, title: 'Counterparts', columns: 44 })
  expect(w.fetches.some(u => u.endsWith('/api/pulse'))).toBe(true)
  expect(w.lastStatus()).toBe('◉ day 18 · 776 memories')
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect((await ui.find({ type: 'Text', text: 'day 18 · 776' }))?.text).toBe('day 18 · 776')
    expect((await ui.find({ type: 'Text', text: '◉ COUNTERPARTS' }))).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'fold' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'toggle-cp' }))?.text).toContain('Counterparts')
    expect((await ui.find({ type: 'Button', key: 'toggle-mem' }))?.text).toContain('Claude memory')
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

test('the switches are text cells a press reaches: a cyan track and white knob when on', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const sw = await ui.find({ type: 'Button', key: 'toggle-mem' })
    const cells = (sw?.children ?? []).filter((c): c is { props: Record<string, unknown> } => typeof c === 'object' && c !== null)
    expect(cells.some(c => c.props['backgroundColor'] === '#00e5ff')).toBe(true)
    expect(cells.some(c => c.props['color'] === '#f4fcff')).toBe(true)
    expect(sw?.text).toContain('\uE0B6') // Powerline's round cap: the Raster rules let it through
    await ui.unmount()
  }
})

test('the brain is a Raster the terminal can hold, repainted by blits; /counterparts fps reports the rate', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await mount($, 'terminal')
  const r = await ui.find({ type: 'Raster', key: 'brain' })
  const cells = decodeCells(String(r?.props['cells']))
  expect(cells.length).toBe(42 * 14 * 3)
  await w.clock.advance(1000)
  expect(w.blits.length).toBeGreaterThanOrEqual(5)
  expect(w.blits.every(b => b.requestId === PANE && b.key === 'brain' && b.columns === 42 && b.rows === 14)).toBe(true)
  const out = await $.command.run({ command: 'counterparts', args: 'fps' } as never)
  expect(out.text).toMatch(/Brain: [\d.]+ fps achieved/)
  expect(out.text).toContain('The status line now shows it.')
  await w.clock.advance(1200)
  expect(w.lastStatus()).toMatch(/ · [\d.]+ fps$/)
  const set = await $.command.run({ command: 'counterparts', args: 'fps 15' } as never)
  expect(set.text).toContain('Brain target set to 15 fps.')
  await ui.unmount()
})

test('the twelve mechanisms: a press opens its stage and line and lights the brain; again, or 30 s, closes it', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
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

test('ACTIVITY: the dashboard’s rows, word over time; a press opens one with its link, 30 s closes it', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: 'ACTIVITY' })).toBeDefined()
    const kept0 = await ui.find({ type: 'Button', key: 'row:seq:490:0' })
    const kept1 = await ui.find({ type: 'Button', key: 'row:seq:490:1' })
    expect(kept0?.text).toMatch(/^● kept\s+“The sidebar draws the brain/)
    expect(kept1?.text).toMatch(/^\s+1:25pm\s/)
    expect(await ui.find({ type: 'Button', key: 'row:seq:480:0' })).toBeDefined() // a footnote recalled
    expect(await ui.find({ type: 'Button', key: 'row:seq:470:0' })).toBeUndefined() // a quiet turn is left out
    expect(await ui.find({ type: 'Button', key: 'row:seq:390:0' })).toBeUndefined() // so is a sleep check
    expect((await ui.find({ type: 'Button', key: 'row:seq:400:1' }))?.text).toMatch(/^\s+3:35am\s/)
    await ui.press({ key: 'row:seq:490:0' })
    const link = await ui.find({ type: 'Link' })
    expect(link?.props['href']).toBe('http://localhost:4747/#memories')
    expect(link?.props['label']).toBe('↗ the memory on the dashboard')
    expect(await texts(ui)).toContain('kept as a fact')
    await w.clock.advance(30001)
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  }
})

test('with the dashboard down it says how to start it, and the status line says so', async ($, on) => {
  const w = world(on, { down: true })
  await start($, w)
  expect(w.lastStatus()).toBe('◉ dashboard not running')
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: 'counterparts dashboard' })).toBeDefined()
    await ui.unmount()
  }
})

test('kept: a note the model writes shows as a kept row, a toast, and a count', async ($, on) => {
  const w = world(on)
  on('tool.call', (_$, e) =>
    String(e.tool).endsWith('__note') && (e as unknown as { text?: string }).text === 'refuse me'
      ? { result: 'refused', text: '{"stored":false,"reason":"duplicate"}' }
      : { result: 'ok', text: '{"stored":true,"id":"mem_new00001"}' },
  )
  await start($, w)
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Sidebar v0.1 is a PR', text: 'The sidebar mod is up for review.' } as never)
  await $.tool.call({ tool: 'mcp__counterparts__note', text: 'refuse me' } as never)
  await $.tool.call({ tool: 'mcp__counterparts__recall', question: 'x', mode: 'facts' } as never)
  await w.clock.settle()
  expect(w.toasts).toEqual(['◆ kept  “Sidebar v0.1 is a PR”'])
  expect(w.lastStatus()).toBe('◉ day 18 · 776 memories · 1 kept')
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const rows = (await ui.findAll({ type: 'Button' })).filter(b => /^row:.*:0$/.test(b.key ?? ''))
    expect(rows[0]?.text).toMatch(/^● kept\s+“Sidebar v0.1 is a PR”/)
    expect(rows.filter(b => (b.text ?? '').includes('refuse me'))).toHaveLength(0)
    await ui.unmount()
  }
})

test('kept under the plugin’s own server name too', async ($, on) => {
  const w = world(on, { tools: PLUGIN_TOOLS })
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_new00002"}' }))
  await start($, w)
  await $.tool.call({ tool: 'mcp__plugin_counterparts_counterparts__note', title: 'From the plugin server', text: 'x' } as never)
  await w.clock.settle()
  expect(w.toasts).toEqual(['◆ kept  “From the plugin server”'])
})

test('came to mind: the recall block the classic hook injects shows as a recalled row and a count', async ($, on) => {
  const w = world(on)
  await start($, w)
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
  await w.clock.settle()
  expect(w.lastStatus()).toBe('◉ day 18 · 776 memories · 2 came to mind')
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const row = await ui.find({ type: 'Button', key: `row:live:turn:${SESSION}:3:0` })
    expect(row?.text).toMatch(/^● 2 recalled\s+2 memories came to mind/)
    await ui.press({ key: `row:live:turn:${SESSION}:3:0` })
    const shown = await texts(ui)
    expect(shown).toContain('· The sidebar slides to a')
    expect(shown).toContain('· Release notes go out on')
    expect(await ui.find({ type: 'Link' })).toMatchObject({ props: { href: 'http://localhost:4747/#health/mechanisms?id=retrieval' } })
    await ui.press({ key: `row:live:turn:${SESSION}:3:1` }) // either line of the row closes it
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  }
})

test('search: Enter asks recall in facts mode; the results replace ACTIVITY; ✕ brings it back', async ($, on) => {
  const w = world(on, { tools: PLUGIN_TOOLS })
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.input({ key: 'q', text: 'publish', kind: 'change' })
    expect(w.mcp.filter(c => c.tool === 'recall')).toHaveLength(surface === 'terminal' ? 0 : 1) // typing asks nothing
    await ui.input({ key: 'q', text: 'publish' })
    const call = w.mcp.filter(c => c.tool === 'recall').at(-1)
    expect(call).toEqual({ server: 'plugin_counterparts_counterparts', tool: 'recall', args: { question: 'publish', mode: 'facts' } })
    const shown = await texts(ui)
    expect(shown).toContain('2 FOUND')
    expect(shown).toContain('a search strengthens nothing')
    expect(shown).toContain('Publishing waits for a test and a review')
    expect(shown).toContain('you said · done · happened 10-09')
    expect(await ui.find({ type: 'Text', text: 'ACTIVITY' })).toBeUndefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: 'ACTIVITY' })).toBeDefined()
    await ui.unmount()
  }
})

test('the Counterparts switch pauses this folder through scope; paused, the brain is grey and the list says so', async ($, on) => {
  const w = world(on)
  await start($, w)
  expect(w.mcp[0]).toEqual({ server: 'counterparts', tool: 'scope', args: {} })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'toggle-cp' })
    expect(w.mcp.some(c => c.tool === 'scope' && c.args['mode'] === 'pause')).toBe(true)
    expect(await ui.find({ type: 'Text', text: 'PAUSED' })).toBeDefined()
    expect(w.lastStatus()).toBe('◌ paused in this folder')
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
    await ui.press({ key: 'toggle-cp' })
    expect(w.mcp.some(c => c.tool === 'scope' && c.args['mode'] === 'resume')).toBe(true)
    expect(await ui.find({ type: 'Text', text: 'ACTIVITY' })).toBeDefined()
    await ui.unmount()
  }
})

test('unasked, the switch reads this folder only when no permission dialog would open; a press asks', async ($, on) => {
  const w = world(on, { permission: 'ask' })
  await start($, w)
  expect(w.mcp).toHaveLength(0) // nothing asked behind the person's back
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    if (surface === 'terminal') {
      expect((await ui.find({ type: 'Button', key: 'toggle-cp' }))?.text).toContain('Counterparts')
      await ui.press({ key: 'toggle-cp' }) // the first press learns where the folder stands
      expect(w.mcp).toEqual([{ server: 'counterparts', tool: 'scope', args: {} }])
      expect(w.toasts.at(-1)).toBe('Counterparts is on in this folder. Press again to pause it.')
    }
    await ui.press({ key: 'toggle-cp' }) // each press after that is one call
    expect(w.mcp.at(-1)).toEqual({ server: 'counterparts', tool: 'scope', args: { mode: surface === 'terminal' ? 'pause' : 'resume' } })
    await ui.unmount()
  }
  expect(w.mcp).toHaveLength(3)
})

test('‹ slides it to a rail of about 7 columns; a press on the rail slides it back', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'fold' })
    expect(w.opens.at(-1)).toEqual({ id: PANE, title: 'Counterparts', columns: 5 })
    expect(await ui.find({ type: 'Button', key: 'unfold' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(13) // › and twelve dots
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.press({ key: 'rail:dreaming' })
    expect(w.opens.at(-1)).toEqual({ id: PANE, title: 'Counterparts', columns: 44 })
    expect(await ui.find({ type: 'Button', key: 'fold' })).toBeDefined()
    await ui.unmount()
  }
})

test('the Claude memory switch: on by default; off drops MEMORY.md and the memory section from the next message', async ($, on) => {
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
    const ui = await mount($, surface)
    await ui.press({ key: 'toggle-mem' })
    expect(w.invalidations).toEqual(expect.arrayContaining(['prompt.section', 'prompt.context']))
    expect(w.toasts.at(-1)).toContain('off from your next message')
    expect(await ask()).toBeNull()
    expect(seen.at(-1)).toEqual(['project'])
    await ui.press({ key: 'toggle-mem' })
    expect(await ask()).toBe('# Memory\nYou have a persistent memory.')
    expect(seen.at(-1)).toEqual(['project', 'memory'])
    await ui.unmount()
  }
})

test('the Claude memory switch is kept across sessions', async ($, on) => {
  const w = world(on, { store: { claudeMemory: false } })
  const seen: string[][] = []
  on('prompt.context', (_$, e) => {
    seen.push((e.instructionFiles ?? []).map(f => f.kind))
    return { blocks: e.blocks }
  })
  await start($, w)
  await $.prompt.context({ blocks: [], instructionFiles: [{ path: '/m/MEMORY.md', kind: 'memory', content: 'x' }] })
  expect(seen.at(-1)).toEqual([])
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const sw = await ui.find({ type: 'Button', key: 'toggle-mem' })
    const cells = (sw?.children ?? []).filter((c): c is { props: Record<string, unknown> } => typeof c === 'object' && c !== null)
    expect(cells.some(c => c.props['backgroundColor'] === '#2c333c')).toBe(true) // the off track
    await ui.unmount()
  }
})

test('a narrow terminal leaves an unasked pane undrawn: the status line names /counterparts, which opens it', async ($, on) => {
  const w = world(on, { placed: false })
  await start($, w)
  expect(w.lastStatus()).toContain('/counterparts opens the sidebar')
  const out = await $.command.run({ command: 'counterparts', args: '' } as never)
  expect(out.text).toBe('Counterparts sidebar opened.')
  expect(w.opens).toHaveLength(2)
  const usage = await $.command.run({ command: 'counterparts', args: 'nonsense' } as never)
  expect(usage.text).toContain('Usage: /counterparts')
})

test('headless (-p): no brain timer, no polling until something draws the pane', async ($, on) => {
  const w = world(on)
  await start($, w, false)
  await w.clock.advance(20000)
  expect(w.blits).toHaveLength(0)
  expect(w.fetches).toHaveLength(0)
  expect(T0).toBeGreaterThan(0)
})
