/**
 * The sidebar (v1, the directory trim) through the engine: its hooks, the
 * trees it draws on the terminal and the desktop, and what it asks of the
 * engine beneath (all of it answered by ./world.ts). Each UI test runs its
 * body on both surfaces where both draw it.
 */
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { decodeCells } from '../hooks/cells'
import { halfCells, textHex } from '../hooks/fox'
import { hex, stageOf } from '../hooks/mechanisms'
import { cells } from '../hooks/width'
import {
  BAND_PROPS,
  DECISION_T3,
  EVENTS,
  FIRED_TODAY,
  HERE,
  HOME,
  PANE,
  PANE_PROPS,
  PLUGIN,
  PLUGIN_TOOLS,
  PULSE,
  RECALL_BLOCK,
  SCOPES_FILE,
  SESSION,
  STATUS_FILE,
  T0,
  VIEWPORT,
  ev,
  settle,
  start,
  world,
} from './world'
import type { World, WorldOptions } from './world'

const SURFACES = ['terminal', 'desktop'] as const
/**
 * The desktop sets text in its own font and colours by Claude Code's theme
 * keys (theme.ts, `desk`, 2026-10-13): a heading's `─` rule is space there,
 * and the accent is the theme's `suggestion`.
 */
const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const headRe = (surface: string, label: string, right: string): RegExp =>
  new RegExp(surface === 'terminal' ? `^${esc(label)} ─+ ${esc(right)}$` : `^${esc(label)}${esc(right)}$`)
const ACCENT = (surface: string): string => (surface === 'terminal' ? '#00e5ff' : 'suggestion')
const HINT_PROPS = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

async function mount($: Engine, w: World, surface: (typeof SURFACES)[number], props = PANE_PROPS) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props, viewport: VIEWPORT })
  await settle(w)
  return ui
}
type Ui = Awaited<ReturnType<typeof mount>>

async function texts(ui: Ui): Promise<string> {
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

/** The body's lines as drawn by its Client, one string a line. */
async function bodyLines(ui: Ui): Promise<string[]> {
  const root = (await ui.drawn({ in: 'body' })) as unknown as Drawn
  const kids = (root.children ?? (root.props?.['children'] as unknown[] | undefined) ?? []) as unknown[]
  return kids.map(flat)
}

/** The title: a Box around a Link on the terminal, around plain text elsewhere. */
async function titleOf(ui: Ui) {
  return ui.find({ type: 'Box', key: 'title' })
}

/** The colour of the first Text drawn holding exactly `text` (a Text in a Link too, which `find` passes over). */
async function colorOf(ui: Ui, text: string): Promise<unknown> {
  let found: unknown
  const walk = (n: unknown): void => {
    if (found !== undefined || n === null || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    const d = n as Drawn & { type?: unknown }
    const kids = d.children ?? (d.props?.['children'] as unknown[] | undefined) ?? []
    if (d.type === 'Text' && Array.isArray(kids) && kids.length === 1 && kids[0] === text) {
      found = d.props?.['color'] ?? null
      return
    }
    walk(kids)
  }
  walk(await ui.drawn())
  return found
}

/** Every `Link` the body's Client drew, by its address. */
async function bodyLinks(ui: Ui): Promise<string[]> {
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n === null || typeof n !== 'object') return
    const d = n as Drawn & { type?: unknown }
    if (d.type === 'Link' && typeof d.props?.['href'] === 'string') out.push(d.props['href'] as string)
    walk(d.children ?? d.props?.['children'] ?? [])
  }
  walk(await ui.drawn({ in: 'body' }))
  return out
}

/** A plain click on the first line of the body that holds `match`. */
async function click(ui: Ui, match: string): Promise<void> {
  const lines = await bodyLines(ui)
  const y = lines.findIndex(l => l.includes(match))
  if (y < 0) throw new Error(`no line holding ${match} in: ${lines.join(' | ')}`)
  await ui.pointer({ type: 'down', x: 2, y, button: 'left', in: 'body' })
}

/** A plain click on `word` in the first line of the body that holds `match` (its column: these lines are ASCII there). */
async function clickWord(ui: Ui, match: string, word: string): Promise<void> {
  const lines = await bodyLines(ui)
  const y = lines.findIndex(l => l.includes(match))
  if (y < 0) throw new Error(`no line holding ${match} in: ${lines.join(' | ')}`)
  await ui.pointer({ type: 'down', x: (lines[y] ?? '').lastIndexOf(word) + 1, y, button: 'left', in: 'body' })
}

/** The band above the prompt drawing once, on a surface that docks panes or doesn't. */
async function band($: Engine, w: World, docks: boolean): Promise<void> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: { ...VIEWPORT, isFullscreen: docks } })
  await settle(w)
  await ui.unmount()
}

/** The hint line under the prompt, drawn: what `tail` the sidebar handed the engine. */
async function tail($: Engine, w: World): Promise<string | undefined> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: HINT_PROPS as never, viewport: VIEWPORT })
  await settle(w)
  await ui.unmount()
  return w.tails.at(-1)
}

async function block($: Engine, w: World, text = RECALL_BLOCK): Promise<void> {
  await $.session.append({
    door: 'hook-context',
    origin: { kind: 'hook', event: 'UserPromptSubmit' },
    uuid: `row-${String(w.events.length)}`,
    message: {
      type: 'attachment',
      name: 'hook_additional_context',
      content: [{ type: 'text', text: `<system-reminder>\nUserPromptSubmit hook additional context: ${text}\n</system-reminder>` }],
    },
  } as never)
  await settle(w)
}

const cmd = async ($: Engine, args: string): Promise<string> => (await $.command.run({ command: 'counterparts', args } as never)).text ?? ''

// ── opening, and where it opens ─────────────────────────────────────────────

test('at session start nothing is opened or drawn and the status file is not read, but this folder’s registry entry is; a docking surface opens it at 34 columns (a dock 35 wide)', async ($, on) => {
  const w = world(on)
  await start($, w)
  expect(w.opens).toHaveLength(0)
  expect(w.fetches).toHaveLength(0)
  expect(w.submits).toHaveLength(0)
  expect(w.mcp).toHaveLength(0) // no tool: the registry file, read-only
  expect(w.fsReads).toContain(SCOPES_FILE)
  expect(w.lastStatus()).toBe('') // no status line in the normal case
  await band($, w, true)
  expect(w.opens).toEqual([{ id: PANE, title: 'Counterparts', columns: 34 }])
  expect(w.fetches).toHaveLength(0)
  expect(w.statusReads()).toBe(0) // still nothing read: the pane has not drawn
})

test('on the main screen (no docking) nothing is opened unasked and nothing is said; /counterparts opens it', async ($, on) => {
  const w = world(on)
  await start($, w)
  await band($, w, false)
  expect(w.opens).toHaveLength(0)
  expect(w.statuses.every(s => s === undefined)).toBe(true)
  expect(await cmd($, '')).toBe('Counterparts sidebar opened.')
  expect(w.opens).toHaveLength(1)
  expect(await cmd($, 'nonsense')).toContain('Usage: /counterparts [quiet | avatar animal|off | avatar detail auto|images|fine|basic | theme tron|cozy | resume]')
})

test('a docking terminal too narrow for an unasked pane: the dim tail under the prompt says to widen the window until the pane draws (shorter on a short row); no status line', async ($, on) => {
  const w = world(on, { placed: false })
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_narrow01"}' }))
  await start($, w)
  await band($, w, true)
  expect(await tail($, w)).toBe('widen this window to see the memory sidebar')
  const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: HINT_PROPS as never, viewport: { ...VIEWPORT, columns: 80 } })
  await settle(w)
  await narrow.unmount()
  expect(w.tails.at(-1)).toBe('widen to see the sidebar')
  // something new while the window is still too narrow: the hint after it still says to widen, not /counterparts
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Narrow', text: 'x' } as never)
  await settle(w)
  expect(await tail($, w)).toMatch(/^Stored “Narrow”.* · widen this window to see the memory sidebar$/)
  expect(w.lastStatus()).toBe('')
  const ui = await mount($, w, 'terminal')
  await ui.unmount()
  expect(await tail($, w)).toBeUndefined()
})

test('drawn: the status file is read, and nothing is fetched; the header is COUNTERPARTS with the count and the day on its row, no brain, no search box; no status line', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(w.fsReads).toContain(STATUS_FILE)
    expect(w.fetches).toEqual([])
    expect((await titleOf(ui))?.text).toContain('COUNTERPARTS')
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    // the avatar off: no Raster on either surface, the count and the day on the title row
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '776 · day 18' })).toBeDefined()
    // plain words on every surface: no link, no arrow
    expect((await titleOf(ui))?.text).toContain('◉ COUNTERPARTS')
    expect((await titleOf(ui))?.text).not.toContain('↗')
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  }
  expect(w.statuses.every(s => s === undefined)).toBe(true)
})

test('the status file is looked at while the pane shows: every 15 s, every 30 s once quiet, read again only when it changed, never when the pane is not shown', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  const looks = () => w.fsReads.filter(f => f === STATUS_FILE).length
  expect(looks()).toBe(1)
  await w.clock.advance(15000)
  expect(looks()).toBe(1) // looked at, unchanged: not read again
  w.events.push(ev(501, 'gate.deposit', 'I wrote down one memory.', 0, { accepted: '1', session: SESSION }))
  await w.clock.advance(15000)
  await settle(w)
  expect(looks()).toBe(2) // changed: read
  const stats = (): number => w.fsReads.length
  await w.clock.advance(15000 * 4) // four quiet looks in a row
  const before = looks()
  w.events.push(ev(502, 'gate.deposit', 'I wrote down one more.', 0, { accepted: '1', session: SESSION }))
  await w.clock.advance(15000)
  await settle(w)
  expect(looks()).toBe(before) // now every 30 s: not yet
  await w.clock.advance(15000)
  await settle(w)
  expect(looks()).toBe(before + 1)
  w.shown = false // the person showed another pane
  const n = stats()
  await w.clock.advance(120000)
  expect(w.fsReads.filter(f => f === STATUS_FILE).length).toBe(looks())
  expect(stats()).toBeGreaterThanOrEqual(n)
  expect(w.fetches).toEqual([])
  await ui.unmount()
})

// ── the sections ────────────────────────────────────────────────────────────

test('Memories and Subconscious: what the recall block put in front of Claude, titles from the status file (a read that counts nothing), the message’s time on the heading', async ($, on) => {
  const w = world(on)
  await start($, w)
  w.events.push(DECISION_T3)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    await block($, w)
    const lines = await bodyLines(ui)
    expect(lines[0]).toMatch(headRe(surface, 'Memories', '1:35'))
    expect(lines[1]).toBe('The sidebar is 35 columns wide') // the title, not the gist Claude read
    expect(lines).toContain(surface === 'terminal' ? 'Subconscious ' + '─'.repeat(32 - 'Subconscious '.length) : 'Subconscious')
    expect(lines).toContain('Release notes go out on Fridays')
    expect(lines.join('\n')).not.toMatch(/[·•●]\s*Release/) // no dots or bullets on these
    await ui.unmount()
  }
  expect(w.fetches).toEqual([])
  expect(w.mcp.filter(c => c.tool === 'recall')).toHaveLength(0) // never the recall tool, which counts and credits
  expect(await tail($, w)).toBeUndefined() // the pane is open: no tail
})

test('a turn’s row not in the status file yet when the block arrives: the gist stands, and the title comes at the next look', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await block($, w)
  expect((await bodyLines(ui))[1]).toBe('Mike chose 35 columns on Oct 10:') // an ISO date shown short
  w.events.push(DECISION_T3) // written now
  await w.clock.advance(15000)
  await settle(w)
  expect((await bodyLines(ui))[1]).toBe('The sidebar is 35 columns wide')
  await ui.unmount()
})

test('a message with nothing said in full: no Memories section, and the time moves to Subconscious; no status file leaves the words Claude read', async ($, on) => {
  const w = world(on, { down: true })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await block($, w, ['<!-- counterparts:recall t=4 -->', '', 'Quietly available (ignorable; expand an id with recall before citing one):', '- Release notes go out on Fridays [mem_rel00001]', '<!-- counterparts:recall/end -->'].join('\n'))
  let lines = await bodyLines(ui)
  expect(lines.some(l => l.startsWith('Memories'))).toBe(false)
  expect(lines[0]).toMatch(/^Subconscious ─+ 1:35$/)
  await block($, w)
  lines = await bodyLines(ui)
  expect(lines[1]).toBe('Mike chose 35 columns on Oct 10:') // the gist wraps; no title without the status file
  await ui.unmount()
})

test('a footnote Claude opened by its id gets “↗ opened”', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: 'ok', text: '{"memories":[]}' }))
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await block($, w)
  expect((await bodyLines(ui)).join('\n')).not.toContain('↗ opened')
  await $.tool.call({ tool: 'mcp__counterparts__recall', ids: ['mem_rel00001'] } as never)
  await settle(w)
  // its title whole; the mark on the line after it when the title's last line has no room
  const lines = await bodyLines(ui)
  expect(lines[lines.indexOf('Release notes go out on Fridays') + 1]).toBe('↗ opened')
  await ui.unmount()
})

test('Saved this session: each memory a note or session_end saved, newest first, its stage dot on the first line only, up to three lines in one colour; no chapter; what an update replaces only opened; nothing for a refused one', async ($, on) => {
  const w = world(on)
  on('tool.call', (_$, e) => {
    const args = e as unknown as { text?: string; title?: string }
    if (args.text === 'refuse me') return { result: 'refused', text: '{"stored":false,"reason":"duplicate"}' }
    if (String(e.tool).endsWith('__session_end')) return { result: 'ok', text: '{"deposited":2}' }
    return { result: 'ok', text: `{"stored":true,"id":"${args.title === 'Long one' ? 'mem_long0001' : 'mem_new00001'}"}` }
  })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  // a resumed session: what it saved before, from the dashboard
  expect((await bodyLines(ui)).join('\n')).toContain('● The sidebar draws the brain in\nbraille')
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'The pane is thirty-five columns wide and every column of it is spent on words', text: 'x' } as never)
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Narrower now', text: 'x', updates: 'mem_old00001' } as never)
  await $.tool.call({ tool: 'mcp__counterparts__note', text: 'refuse me' } as never)
  await $.tool.call({ tool: 'mcp__counterparts__session_end', memories: [{ title: 'First of two', text: 'a' }, { title: 'Second of two', text: 'b' }] } as never)
  await $.tool.call({ tool: 'mcp__counterparts__chapter', title: 'Day 18', text: 'a journal entry' } as never)
  await settle(w)
  const lines = await bodyLines(ui)
  const at = lines.findIndex(l => l.startsWith('Saved this session'))
  expect(lines[at]).toMatch(/^Saved this session ─+ 5$/)
  expect(lines.slice(at + 1, at + 10)).toEqual([
    '● Second of two',
    '● First of two',
    '● Narrower now',
    '● The pane is thirty-five',
    'columns wide and every column of', // a wrapped line goes back to the left edge
    'it is spent on words',
    '● The sidebar draws the brain in',
    'braille',
    ' ',
  ])
  expect(lines.join('\n')).not.toMatch(/replaces|Chapter|Day 18/)
  // the dot is the stage's: Salience's cyan for a new memory, Reconsolidation's lilac for an update
  const root = (await ui.drawn({ in: 'body' })) as unknown as Drawn
  const row = (root.children ?? [])[at + 3] as Drawn
  expect(((row.children ?? [])[0] as Drawn).props?.['color']).toBe(hex(stageOf('reconsolidation').col))
  // every line of an item one colour
  const colour = (i: number): unknown => (((root.children ?? [])[i] as Drawn).children ?? []).map(c => (c as Drawn).props?.['color']).at(-1)
  expect(colour(at + 4)).toBe(colour(at + 5))
  expect(colour(at + 5)).toBe(colour(at + 6))
  // opened, an update says what it replaces (the title read from the dashboard)
  await click(ui, '● Narrower now')
  await settle(w)
  expect((await bodyLines(ui)).join(' ')).toContain('replaces The sidebar was 46 col')
  await click(ui, '● Narrower now')
  expect(lines.join('\n')).not.toContain('refuse me')
  expect(w.toasts).toHaveLength(0) // the pane and the tail say it; no toast
  await ui.unmount()
  await cmd($, 'quiet')
  expect(await tail($, w)).toBe('Stored 2 memories, the first “First of two” — a · /counterparts opens it')
  // a /clear starts this session's list over
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never)
  await settle(w)
  await cmd($, '')
  const after = await mount($, w, 'terminal')
  expect((await bodyLines(after)).some(l => l.startsWith('Saved this session'))).toBe(false)
  await after.unmount()
})

test('saved under the plugin’s own server name too', async ($, on) => {
  const w = world(on, { tools: PLUGIN_TOOLS })
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_new00002"}' }))
  await start($, w)
  await $.tool.call({ tool: 'mcp__plugin_counterparts_counterparts__note', title: 'From the plugin server', text: 'x' } as never)
  await settle(w)
  await cmd($, 'quiet')
  expect(await tail($, w)).toBe('Stored “From the plugin server” — x · /counterparts opens it')
})

test('Mechanisms today: times each fired today, from the status file; a zero dim with no bar, Schemas not built; a click lists its firings, grouped, and lights its region', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    let lines = await bodyLines(ui)
    const at = lines.findIndex(l => l.startsWith('Mechanisms today'))
    expect(lines[at]).toMatch(headRe(surface, 'Mechanisms today', 'times fired'))
    if (surface === 'terminal') {
      expect(lines[at + 1]).toMatch(/^Salience {8}▄+▖?\s+3$/)
      expect(lines[at + 2]).toMatch(/^Emotion {9}\s+0$/) // no bar
      expect(lines[at + 5]).toMatch(/^Retrieval {7}▄{12}\s*12$/) // the longest bar
    } else {
      // the desktop's rows are columns, not padding: name, bar (a share of its column) and count, the bar's text the
      // full column's half blocks, clipped by its box
      expect(lines[at + 1]).toMatch(/^Salience▄+3$/)
      expect(lines[at + 2]).toBe('Emotion0') // no bar
      expect(lines[at + 5]).toMatch(/^Retrieval▄+12$/)
    }
    expect(lines.some(l => l.startsWith('Schemas'))).toBe(false) // not built: not drawn
    await click(ui, 'Forgetting')
    lines = await bodyLines(ui)
    const f = lines.findIndex(l => l.startsWith('Forgetting'))
    expect(lines[f + 1]).toBe('faded at 3:34:')
    expect(lines[f + 2]).toBe('An old plan that faded')
    expect(w.fetches).toEqual([])
    // an event opens in place: it is short
    await click(ui, 'An old plan that faded')
    lines = await bodyLines(ui)
    expect(lines.join('\n')).toContain('It faded at the night.')
    expect(lines.join('\n')).toContain('fact · learned Sep 1')
    await click(ui, 'Forgetting') // again: closed
    expect((await bodyLines(ui)).join('\n')).not.toContain('faded at 3:34:')
    await ui.unmount()
  }
})

test('a mechanism that fired today but names fewer than three in the panel (its lookback, its merged repeats): the status file’s other rows of it are read too', async ($, on) => {
  const was = FIRED_TODAY.emotional ?? null
  FIRED_TODAY.emotional = 1
  try {
    const w = world(on, { panelActivity: id => (id === 'emotional' ? [] : EVENTS) })
    w.events.push(ev(460, 'recall.decision', 'On turn 4 a matching mood brought one memory closer.', 30, {
      session: 'sess-older', turn: '4', surfacedCount: '1', footnoteCount: '0', moodMatched: '1',
      surfaced: JSON.stringify([{ id: 'mem_sur00001', sal: 0.6 }]),
    }))
    await start($, w)
    const ui = await mount($, w, 'terminal')
    await click(ui, 'Emotion')
    await settle(w)
    const shown = (await bodyLines(ui)).join('\n')
    expect(shown).toContain('brought closer at')
    expect(shown).toContain('The sidebar is 35 columns wide')
    expect(shown).not.toContain('nothing lately')
    expect(w.fetches).toEqual([])
    await ui.unmount()
  } finally {
    FIRED_TODAY.emotional = was
  }
})

test('Emotion: a memory saved with a feeling and one carrying a feeling that came to mind, each named with its feeling words; the plain ones left out', async ($, on) => {
  const was = FIRED_TODAY.emotional ?? null
  FIRED_TODAY.emotional = 2
  try {
    // The Emotion panel's rows as the status file carries them (`narrateForPanel`, with `felt`).
    const saved = ev(491, 'gate.deposit', 'I wrote down “The sidebar draws the brain in braille”, carrying proud and curious.', 9, {
      session: SESSION, accepted: '1', kind: 'fact', memoryId: '"The sidebar draws the brain in braille" [mem_aaaa1111]',
      felt: JSON.stringify([{ id: 'mem_aaaa1111', words: ['proud', 'curious'] }]),
    })
    const came = ev(492, 'recall.decision', 'On turn 4 “The sidebar is 35 columns wide” came to mind carrying a feeling.', 5, {
      session: SESSION, turn: '4', surfacedCount: '1', footnoteCount: '1', moodMatched: '0',
      surfaced: JSON.stringify([{ id: 'mem_sur00001', sal: 0.6 }]), footnotes: JSON.stringify([{ id: 'mem_rel00001', sal: 0.5 }]),
      felt: JSON.stringify([{ id: 'mem_sur00001', words: ['relieved'] }]),
    })
    const w = world(on, { panelActivity: id => (id === 'emotional' ? [came, saved] : EVENTS) })
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, w, surface)
      let lines = await bodyLines(ui)
      const at = lines.findIndex(l => l.startsWith('Mechanisms today'))
      if (surface === 'terminal') expect(lines[at + 2]).toMatch(/^Emotion {9}▄+▖?\s+2$/)
      else expect(lines[at + 2]).toMatch(/^Emotion▄+2$/)
      await click(ui, 'Emotion')
      await settle(w)
      lines = await bodyLines(ui)
      const e = lines.findIndex(l => l.startsWith('Emotion'))
      // what a person reads, wrapped at the pane's width: each title, then its feeling words
      const opened = lines.slice(e + 1, e + 7)
      expect(opened[0]).toMatch(/^came to mind at \d+:\d\d:$/)
      expect(opened[1]).toBe('The sidebar is 35 columns wide')
      expect(opened[2]).toBe('(relieved)')
      expect(opened[3]).toMatch(/^saved with a feeling at \d+:\d\d:$/)
      expect(`${opened[4] ?? ''} ${opened[5] ?? ''}`).toBe('The sidebar draws the brain in braille (proud, curious)')
      // the footnote that carried no feeling is Retrieval's, not Emotion's
      expect(lines.slice(e + 1, e + 8).join('\n')).not.toContain('Release notes')
      // a memory opens in place, as under every mechanism
      await click(ui, '(relieved)') // the Emotion firing's own line (its title also shows under what came to mind)
      expect((await bodyLines(ui)).join('\n')).toContain('Mike chose 35 columns')
      await click(ui, 'Emotion') // closed again
      await ui.unmount()
    }
    expect(w.fetches).toEqual([])
  } finally {
    FIRED_TODAY.emotional = was
  }
})

test('past midnight with nothing new, a file written yesterday counts nothing today: yesterday’s bars do not stand as today’s', async ($, on) => {
  // the file stays as it was written at 23:59 (its store's day named outright, so nothing in it changes)
  const w = world(on, { now: new Date(2026, 9, 9, 23, 59, 0).getTime(), dashToday: '2026-10-09' })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await settle(w)
  const salience = async (): Promise<string> => {
    const lines = await bodyLines(ui)
    const at = lines.findIndex(l => l.startsWith('Mechanisms today'))
    return (lines.slice(at + 1, at + 13).find(l => l.startsWith('Salience')) ?? '').trim().split(/\s+/).at(-1) ?? ''
  }
  expect(await salience()).toBe('3')
  // a minute past midnight: the file still says yesterday's counts, written yesterday
  await w.clock.advance(120000)
  await settle(w)
  expect(await salience()).toBe('0')
  await ui.unmount()
})

test('a store that keeps another zone: its `today` differs from this clock’s all day, and its counts still show', async ($, on) => {
  const w = world(on, { dashToday: '2026-10-10' })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await settle(w)
  for (let i = 0; i < 3; i++) await w.clock.advance(15000)
  await settle(w)
  const lines = await bodyLines(ui)
  const at = lines.findIndex(l => l.startsWith('Mechanisms today'))
  expect(lines[at + 1]).toMatch(/^Salience {8}▄+▖?\s+3$/)
  expect(w.fsReads.filter(f => f === STATUS_FILE)).toHaveLength(1) // unchanged: read once
  await ui.unmount()
})

test('Last Dream: its first sentence, in its own voice; a click opens the dream itself, no counts', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    let lines = await bodyLines(ui)
    const at = lines.findIndex(l => l.startsWith('Last Dream'))
    expect(lines[at]).toMatch(headRe(surface, 'Last Dream', '3:35'))
    // the desktop wraps a fifth wider (its font fits more in a cell's width)
    expect(lines.slice(at + 1, at + 3)).toEqual(surface === 'terminal' ? ['I dreamed the plugin and the', 'brain were one thing.'] : ['I dreamed the plugin and the brain', 'were one thing.'])
    await click(ui, 'I dreamed the plugin')
    lines = await bodyLines(ui)
    expect(lines.join(' ')).toContain('Then the rail became a river, and the river carried the titles.')
    expect(lines.join(' ')).not.toMatch(/what changed|near-copies|pairs of memories|faded|became core/)
    await click(ui, 'I dreamed the plugin')
    expect((await bodyLines(ui)).join(' ')).not.toContain('Then the rail')
    await ui.unmount()
  }
})

test('a click opens a memory in place whatever its length, and never the dashboard by itself: past 20 lines, the last ends with `more`, the one link to it; never through the recall tool', async ($, on) => {
  const w = world(on)
  on('tool.call', (_$, e) => ({ result: 'ok', text: `{"stored":true,"id":"${(e as unknown as { title?: string }).title === 'Long one' ? 'mem_long0001' : 'mem_sur00001'}"}` }))
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Long one', text: 'x' } as never)
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Short one', text: 'x' } as never)
  await settle(w)
  await click(ui, 'Short one')
  let shown = (await bodyLines(ui)).join('\n')
  expect(shown).toContain('The sidebar is 35 columns wide') // its title, in full
  expect(shown).toContain('nothing decorates.')
  expect(shown).toContain('fact · learned Oct 9')
  expect(shown).not.toMatch(/ more$/m)
  await click(ui, '● The sidebar is 35 columns wide') // opened, its own title in full: a click on it closes
  shown = (await bodyLines(ui)).join('\n')
  expect(shown).not.toContain('nothing decorates.')
  await click(ui, 'Long one')
  await settle(w)
  const lines = await bodyLines(ui)
  expect(lines.join(' ')).toContain('sentence 3 of a long')
  const more = lines.filter(l => / more$/.test(l))
  expect(more).toHaveLength(1)
  expect(more[0]).toMatch(/… more$/)
  // `more` is words, not a link (the rest is on the dashboard, `/counterparts:dashboard`): a click on it is the item's
  expect(await bodyLinks(ui)).toEqual([])
  await w.clock.advance(5 * 60000) // a long read: nothing closes it but a click
  await settle(w)
  expect((await bodyLines(ui)).join(' ')).toContain('sentence 3 of a long')
  await clickWord(ui, '… more', 'more')
  expect((await bodyLines(ui)).join(' ')).not.toContain('sentence 3 of a long')
  expect(await bodyLinks(ui)).toEqual([])
  expect(w.mcp.filter(c => c.tool === 'recall')).toHaveLength(0)
  await ui.unmount()
})

test('clicks are the same every time: open A, open B (A closes), close B, open A again; nothing closes them but a click', async ($, on) => {
  const w = world(on)
  on('tool.call', (_$, e) => ({ result: 'ok', text: `{"stored":true,"id":"${(e as unknown as { title?: string }).title === 'Long one' ? 'mem_long0001' : 'mem_sur00001'}"}` }))
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Long one', text: 'x' } as never)
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Short one', text: 'x' } as never)
  await settle(w)
  const has = async (t: string) => (await bodyLines(ui)).join(' ').includes(t)
  await click(ui, 'Short one')
  await settle(w)
  expect(await has('nothing decorates.')).toBe(true)
  await click(ui, 'Long one')
  await settle(w)
  expect(await has('nothing decorates.')).toBe(false)
  expect(await has('sentence 3 of a long')).toBe(true)
  await click(ui, 'sentence 3 of a long') // a click on its text closes it
  await settle(w)
  expect(await has('sentence 3 of a long')).toBe(false)
  await click(ui, 'Short one')
  await settle(w)
  expect(await has('nothing decorates.')).toBe(true)
  await w.clock.advance(5 * 60000)
  await settle(w)
  expect(await has('nothing decorates.')).toBe(true)
  await ui.unmount()
})

test('a Subconscious item opens in place from the status file, not the recall tool, and stays open', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await block($, w)
  await settle(w)
  await click(ui, 'Release notes go out on Fridays')
  await settle(w)
  await w.clock.advance(5000)
  await settle(w)
  expect((await bodyLines(ui)).join(' ')).toContain('Every Friday, after the review.')
  expect(w.fetches).toEqual([])
  expect(w.mcp.filter(c => c.tool === 'recall')).toHaveLength(0)
  await ui.unmount()
})

test('at a laptop’s height the sections fold to fit, a folded one keeping its heading; a click on it unfolds it', async ($, on) => {
  const w = world(on)
  let n = 0
  on('tool.call', () => ({ result: 'ok', text: `{"stored":true,"id":"mem_n${String((n += 1)).padStart(7, '0')}"}` }))
  await start($, w)
  const small = { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 26 } } as typeof PANE_PROPS
  const ui = await mount($, w, 'terminal', small)
  for (let i = 0; i < 8; i++) await $.tool.call({ tool: 'mcp__counterparts__note', title: `Saved item number ${String(i)} with a title that wraps`, text: 'x' } as never)
  await settle(w)
  let lines = await bodyLines(ui)
  expect(lines.length).toBeLessThanOrEqual(26 - 2 - 5) // the header two rows, the footer a rule and four
  expect(lines.some(l => /^Mechanisms today ─+ times fired$/.test(l))).toBe(true)
  const folded = lines.find(l => l.startsWith('Saved this session'))
  expect(folded).toMatch(/─ 9 ›$/)
  await click(ui, 'Saved this session')
  lines = await bodyLines(ui)
  expect(lines.some(l => l.startsWith('● Saved item number 7'))).toBe(true)
  expect(lines.some(l => /^Mechanisms today ─+ \d+ fired ›$/.test(l))).toBe(true) // folded instead
  await click(ui, 'Saved this session') // again: back as it was
  expect((await bodyLines(ui)).find(l => l.startsWith('Saved this session'))).toMatch(/─ 9 ›$/)
  await ui.unmount()
})

// ── views ──────────────────────────────────────────────────────────────────

test('views: two, the sidebar and quiet; quiet is only the dim tail, ending with how to open it; the band above the prompt draws nothing', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_new00001"}' }))
  await start($, w)
  await band($, w, true)
  const ui = await mount($, w, 'terminal')
  // no switch in the pane (v1): the footer says how, and /counterparts quiet does it
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await texts(ui)).toContain('/counterparts quiet')
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Quiet me (2026-10-09)', text: 'x' } as never)
  await settle(w)
  expect(await tail($, w)).toBeUndefined() // the pane shows: no tail
  await cmd($, 'quiet')
  expect(w.closes).toContain(PANE)
  expect(w.store['view']).toBe('quiet')
  expect(await tail($, w)).toBe('Stored “Quiet me” — x · /counterparts opens it') // today's date dropped; the note's own words follow
  const none = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: VIEWPORT })
  await settle(w)
  expect((await none.findAll({})).map(x => x.text).join('')).not.toContain('Quiet me')
  await none.unmount()
  // a long title gives way to the hint, never the other way round
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'A title long enough that a narrow row could not hold it and the hint after it', text: 'x' } as never)
  await settle(w)
  const hint = '? for shortcuts'
  const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: { ...HINT_PROPS, hint } as never, viewport: { ...VIEWPORT, columns: 100 } })
  await settle(w)
  await narrow.unmount()
  const cut = w.tails.at(-1) ?? ''
  expect(cut).toMatch(/^Stored “A title long enough.*… · \/counterparts opens it$/)
  // the engine draws more than its `hint` prop holds and keeps cells clear: 32 spare (measured, NOTES)
  expect(hint.length + cut.length).toBeLessThanOrEqual(100 - 32)
  // quiet reads nothing and draws nothing
  const fetches = w.fetches.length
  const blits = w.blits.length
  await w.clock.advance(120000)
  expect(w.fetches.length).toBe(fetches)
  expect(w.blits.length).toBe(blits)
  expect(await cmd($, '')).toBe('Counterparts sidebar opened.')
  expect(w.opens.at(-1)?.columns).toBe(34)
  expect(w.store['view']).toBe('sidebar')
  await ui.unmount()
})

test('on the classic screen the tail suggests /tui fullscreen; on fullscreen it says /counterparts opens it', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_new00001"}' }))
  await start($, w)
  await cmd($, 'quiet')
  const classic = async (): Promise<string | undefined> => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: HINT_PROPS as never, viewport: { ...VIEWPORT, isFullscreen: false } })
    await settle(w)
    await ui.unmount()
    return w.tails.at(-1)
  }
  expect(await classic()).toBe('Watching quietly · nothing new yet · /tui fullscreen shows the memory sidebar')
  expect(await tail($, w)).toBe('Watching quietly · nothing new yet · /counterparts opens it')
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Answered: what Mike does off the keyboard', text: 'Mike plays pickup basketball on Tuesday nights and hikes most weekends.' } as never)
  await settle(w)
  expect(await classic()).toBe('Stored “Answered: what Mike does off the keyboard” — Mike plays pickup basketball on… · /tui fullscreen shows the memory sidebar')
})

for (const [stored, opens] of [['full', true], ['quiet', false], ['rail', false], ['hidden', false], ['strip', false], [undefined, true]] as const) {
  test(`a stored view from v0.1 or v0.2 carries over: ${String(stored)} ${opens ? 'opens the sidebar' : 'opens no pane'}`, async ($, on) => {
    const w = world(on, { store: stored === undefined ? {} : { view: stored } })
    await start($, w)
    await band($, w, true)
    expect(w.opens.length > 0).toBe(opens)
    if (opens) expect(w.opens[0]?.columns).toBe(34)
    // nothing is rewritten but by opening it (v0.2 writes `sidebar` for the pane)
    expect(w.store['view']).toBe(opens ? 'sidebar' : stored)
    // nothing has happened yet: the tail says only how to open it (a stored `strip`, dropped, reads as quiet)
    if (!opens) expect(await tail($, w)).toBe('Watching quietly · nothing new yet · /counterparts opens it')
  })
}

test('the band can draw before session.start has read the stored view: quiet stays quiet, and is not overwritten', async ($, on) => {
  const w = world(on, { store: { view: 'quiet' } })
  await band($, w, true) // before session.start, as measured live in v0.1
  expect(w.opens).toHaveLength(0)
  await start($, w)
  expect(w.store['view']).toBe('quiet')
})

test('a pane drawn before session.start has named the session still finds what this session saved (a resumed session’s first read)', async ($, on) => {
  const w = world(on)
  const ui = await mount($, w, 'terminal') // no session.start yet: the first read asks for the session's id itself
  await settle(w)
  const lines = await bodyLines(ui)
  const s = lines.findIndex(l => l.startsWith('Saved this session'))
  expect(s).toBeGreaterThanOrEqual(0)
  expect(lines.slice(s + 1, s + 3).join(' ')).toContain('The sidebar draws the brain in braille')
  await ui.unmount()
})

test('/counterparts quiet, hide, rail and strip all mean quiet; the commands say what they did', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const verb of ['quiet', 'hide', 'rail']) {
    expect(await cmd($, verb)).toContain('Counterparts quiet')
    expect(w.store['view']).toBe('quiet')
  }
  // the strip is gone: an older put-back that types it gets quiet
  expect(await cmd($, 'strip')).toContain('Counterparts quiet')
  expect(w.store['view']).toBe('quiet')
})

// ── drawing again, and the header's dot ──────────────────────────────────────

test('/counterparts asks for a fresh drawing: a pane reopened after a hand-close is not left on its settled drawing', async ($, on) => {
  const w = world(on)
  on('ui.invalidate', (_$, e) => {
    w.invalidations.push(e.event)
    return { value: undefined }
  })
  await start($, w)
  expect(await cmd($, '')).toBe('Counterparts sidebar opened.')
  expect(w.invalidations).toContain('ui.render')
})

test('one event lights every mechanism it proves: a dream with a merge and a gist lights Dreaming’s region first, its arcs a little apart', async ($, on) => {
  const w = world(on)
  await start($, w)
  await cmd($, 'avatar off') // the header's ◉ takes the lit mechanism's stage colour
  const ui = await mount($, w, 'terminal')
  const dot = async () => colorOf(ui, '◉ ')
  const resting = await dot()
  w.events.push(ev(502, 'dream.changed', 'In a dream I changed 47 things (1 merge, 2 gist).', 0, { applied: '49', merge: '1', gist: '2', link: '20' }, 'drm_test0002'))
  await w.clock.advance(15000)
  await settle(w)
  expect(await dot()).toBe(hex(stageOf('dreaming').col, 0.95))
  await w.clock.advance(3000)
  await settle(w)
  expect(await dot()).toBe(resting)
  await ui.unmount()
})

test('a reload keeps the state: a `firing` v0.1 wrote ({ id, at }, no list) draws the pane with nothing lit', async ($, on) => {
  const w = world(on)
  let reads = 0
  on('state.get', { plugin: PLUGIN, key: 'firing' } as never, (() => {
    reads += 1
    return { value: { value: { id: 'retrieval', at: T0 }, version: 1 } }
  }) as never)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  expect(reads).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Box', key: 'head1' })).toBeDefined()
  expect(await colorOf(ui, '◉ ')).not.toBe(hex(stageOf('retrieval').col, 0.95))
  await ui.unmount()
})

// ── no status file yet, links ───────────────────────────────────────────

/** The words the chart says before any session has written the status file. */
const WAITING_SAYS = 'Waiting for the first session: memory writes what it did here after a turn.'

test('no status file yet: the chart says, calmly, it is waiting for the first session, inside the pane; a click runs nothing; the status line says nothing of it', async ($, on) => {
  const w = world(on, { down: true })
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect((await bodyLines(ui)).join(' ').replace(/ +/g, ' ')).toContain(WAITING_SAYS)
    await ui.unmount()
  }
  const ui = await mount($, w, 'terminal')
  await click(ui, 'Waiting for the first')
  await settle(w)
  expect(w.commands).toEqual([])
  expect(w.fetches).toEqual([])
  // the first session writes it: the next look shows it
  w.noStatus = false
  await w.clock.advance(15000)
  await settle(w)
  expect((await bodyLines(ui)).join(' ')).toContain('Salience')
  await ui.unmount()
  expect(w.statuses.some(s => (s ?? '').includes('dashboard'))).toBe(false)
})

test('a memory the status file does not carry opens to its title, where its card is, and `more`, words not a link', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_notcar01"}' }))
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'Not carried', text: 'x' } as never)
  await settle(w)
  await click(ui, 'Not carried')
  await settle(w)
  const lines = await bodyLines(ui)
  expect(lines.join(' ')).toContain('Its full card is on the dashboard: /counterparts:dashboard')
  expect(await bodyLinks(ui)).toEqual([])
  await ui.unmount()
})

test('nothing in the pane is a link, on any surface, and the sidebar runs no process', async ($, on) => {
  const w = world(on)
  let ran = 0
  on('process.run', () => {
    ran += 1
    return { deny: 'the sidebar runs no process' }
  })
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    expect(await bodyLinks(ui)).toEqual([])
    await ui.unmount()
  }
  expect(ran).toBe(0)
  expect(w.commands).toHaveLength(0)
})

// ── Claude Code's own memory: the mod only observes it (2026-10-12) ──────────

test("the mod never filters or modifies Claude Code's own memory: MEMORY.md and the memory section pass whole, whatever an older version stored", async ($, on) => {
  // An older version's switch, left off in the store, and its opt-in in the environment: both ignored.
  const w = world(on, { env: { HOME, COUNTERPARTS_SIDEBAR_CC_MEMORY: '1' }, store: { claudeMemory: false, claudeMemorySwitch: true } })
  const seen: unknown[] = []
  on('prompt.context', (_$, e) => {
    seen.push(e.instructionFiles)
    return { blocks: e.blocks, ...(e.instructionFiles === undefined ? {} : { instructionFiles: e.instructionFiles }) }
  })
  on('prompt.section', (_$, e) => ({ text: e.text }))
  await start($, w)
  const files = [
    { path: '/work/project/CLAUDE.md', kind: 'project' as const, content: 'project rules' },
    { path: '/home/.claude/projects/x/memory/MEMORY.md', kind: 'memory' as const, content: 'auto memory' },
  ]
  const blocks = [{ name: 'claudeMd', text: 'project rules\nauto memory' }]
  const context = await $.prompt.context({ blocks, instructionFiles: files })
  expect(seen.at(-1)).toEqual(files)
  expect(context.blocks).toEqual(blocks)
  expect((await $.prompt.section({ name: 'memory', text: '# Memory\nYou have a persistent memory.' })).text).toBe('# Memory\nYou have a persistent memory.')
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(await ui.find({ type: 'Button', key: 'toggle-mem' })).toBeUndefined()
    expect(await texts(ui)).not.toContain('Claude memory')
    await ui.unmount()
  }
  expect(w.lastStatus()).toBe('')
  // Nothing written over the stale values, nothing added.
  expect(w.store['claudeMemory']).toBe(false)
  expect(w.store['claudeMemorySwitch']).toBe(true)
})

test('headless (-p): nothing opens, ticks or reads', async ($, on) => {
  const w = world(on)
  await start($, w, false)
  await w.clock.advance(120000)
  expect(w.opens).toHaveLength(0)
  expect(w.blits).toHaveLength(0)
  expect(w.fetches).toHaveLength(0)
  expect(w.mcp).toHaveLength(0)
  expect(w.fsReads).toHaveLength(0)
})

// ── the folder's pause: shown, never changed from here (v1) ─────────────────

type Node = { type?: string; props: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

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

test('a paused folder says so in every view: the banner in the pane, the amber status line in the strip and quiet, no tail; /counterparts resume says how, and changes nothing', async ($, on) => {
  const w = world(on, { scopeMode: 'paused' })
  await start($, w)
  const paused = '⏸ Counterparts memory paused in this folder · say “resume memory here”'
  expect(w.lastStatus()).toBe(paused) // before any pane is drawn
  const ui = await mount($, w, 'terminal')
  expect((await ui.find({ type: 'Text', text: '⏸ Counterparts paused here' }))?.props['color']).toBe('#ffb347')
  expect(await texts(ui)).toContain('\nsay “resume memory here”\n')
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
  for (const view of ['strip', 'quiet']) {
    await cmd($, view)
    expect(w.lastStatus()).toBe(paused)
    expect(await tail($, w)).toBeUndefined()
  }
  expect(await cmd($, 'resume')).toBe(`Counterparts memory is paused in ${HERE}. To resume it, say “resume memory here” to Claude.`)
  expect(w.mcp).toHaveLength(0)
  expect(w.lastStatus()).toBe(paused)
})

test('paused by a parent folder: the banner names it and explains, and resumes nothing here', async ($, on) => {
  const w = world(on, { scopeMode: 'paused', scopeSetBy: '/work' })
  await start($, w)
  expect(w.lastStatus()).toBe('⏸ Counterparts memory paused in this folder · resume it in /work')
  const ui = await mount($, w, 'terminal')
  expect(await texts(ui)).toContain('paused by /work')
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await cmd($, 'resume')).toContain('run `counterparts scope /work --resume`')
  expect(w.mcp).toHaveLength(0)
  await ui.unmount()
})

test('repro 2026-10-09: another session pauses this folder; a session started there shows paused at once, and never draws on', async ($, on) => {
  const w = world(on, { permission: 'ask' })
  Object.assign(w.scope, { mode: 'paused', setBy: HERE, resumeTo: 'on' })
  await start($, w)
  expect(w.mcp).toHaveLength(0)
  expect(w.lastStatus()).toBe('⏸ Counterparts memory paused in this folder · say “resume memory here”')
  await band($, w, true)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(await ui.find({ type: 'Text', text: '⏸ Counterparts paused here' })).toBeDefined()
    await ui.unmount()
  }
})

test('stale no longer: a pause made in another session shows within one poll while the pane is drawn, and within a minute while closed', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  expect(await ui.find({ type: 'Text', text: '⏸ Counterparts paused here' })).toBeUndefined()
  Object.assign(w.scope, { mode: 'paused', setBy: HERE, resumeTo: 'on' })
  await w.clock.advance(16000)
  await settle(w)
  expect(await ui.find({ type: 'Text', text: '⏸ Counterparts paused here' })).toBeDefined()
  expect(w.lastStatus()).toBe('⏸ Counterparts memory paused in this folder · say “resume memory here”')
  await cmd($, 'quiet')
  await ui.unmount()
  Object.assign(w.scope, { mode: 'on' })
  await w.clock.advance(61000)
  await settle(w)
  expect(w.lastStatus()).toBe('')
  Object.assign(w.scope, { mode: 'paused' })
  await cmd($, 'theme') // any /counterparts reads it at once
  expect(w.lastStatus()).toContain('⏸ Counterparts memory paused in this folder')
})

test('the registry is the one the wired hooks read: a settings hook’s own --config moves it (and a Bun --config= before the script is Bun’s)', async ($, on) => {
  const hook = '"bun" --no-env-file "--config=/opt/cp/src/adapters/empty-bunfig.toml" run "/opt/cp/src/adapters/claude-code/bin/hook.ts" --config "/cfg/alt/claude-code.json"'
  const settings = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hook }] }] } })
  const w = world(on, { scopeMode: 'paused', registryAt: '/cfg/alt/scopes.json', files: { [`${HOME}/.claude/settings.json`]: settings } })
  await start($, w)
  expect(w.fsReads).toContain('/cfg/alt/scopes.json')
  expect(w.fsReads).not.toContain(SCOPES_FILE)
  expect(w.lastStatus()).toBe('⏸ Counterparts memory paused in this folder · say “resume memory here”')
})

// ── the first meeting: speak first, once (speak-first.tsx); the footer says /counterparts:meet ──

const MEET = 'Meet your new counterpart.'
const onbFetches = (w: World) => w.fetches.filter(u => u.endsWith('/api/onboarding'))

/** Core's SessionStart wake, as the classic hook injects it: with its onboarding marker on a line of its own, or (null) none, as an older core. */
async function wake($: Engine, w: World, meet: string | null): Promise<void> {
  // As core #419 writes it: the marker on its own line right under the `Now:` clock line, above the wake block.
  const body = [
    'Now: Sunday, October 11, 2026, 1:35 PM',
    ...(meet === null ? [] : [`<!-- counterparts:onboarding meet=${meet} -->`]),
    '<!-- counterparts:wake -->',
    '# Waking up',
    '',
    'Yesterday we worked on the sidebar.',
    '<!-- counterparts:wake/end -->',
  ].join('\n')
  await $.session.append({
    door: 'hook-context',
    origin: { kind: 'hook', event: 'SessionStart' },
    uuid: `wake-${String(w.events.length)}`,
    message: {
      type: 'attachment',
      name: 'hook_additional_context',
      content: [{ type: 'text', text: `<system-reminder>\nSessionStart hook additional context: ${body}\n</system-reminder>` }],
    },
  } as never)
  await settle(w)
}

async function startWith($: Engine, w: World, meet: string | null, interactive = true): Promise<void> {
  await start($, w, interactive)
  await wake($, w, meet)
}

test('speak first: the wake’s marker says not_started, so the first interactive start submits the line once and stores that it did; the dashboard is not asked', async ($, on) => {
  const w = world(on)
  await startWith($, w, 'not_started')
  expect(w.submits).toEqual([MEET])
  expect(w.store['meetTriggered']).toEqual({ session: SESSION, at: T0 })
  expect(onbFetches(w)).toHaveLength(0)
  // session.start and the wake again (a reload, a /clear): nothing more.
  await startWith($, w, 'not_started')
  expect(w.submits).toEqual([MEET])
  // The triggering session draws no button while Claude introduces itself.
  const ui = await mount($, w, 'terminal')
  expect(await ui.find({ type: 'Button', key: 'meet' })).toBeUndefined()
  await ui.unmount()
})

test('speak first: the wake can land before the plugin’s session.start; the start’s look then decides', async ($, on) => {
  const w = world(on)
  await wake($, w, 'not_started')
  expect(w.submits).toHaveLength(0)
  await start($, w)
  await settle(w)
  expect(w.submits).toEqual([MEET])
})

test('a compaction’s wake carries the marker again (still not_started until core’s meet is called): nothing more is submitted', async ($, on) => {
  const w = world(on)
  await startWith($, w, 'not_started')
  expect(w.submits).toEqual([MEET])
  await wake($, w, 'not_started') // SessionStart after /compact
  await w.clock.advance(61000)
  await settle(w)
  expect(w.submits).toEqual([MEET])
})

test('the marker under the wake’s clock line leaves the rest alone: a recall block in the same context still fills Memories', async ($, on) => {
  const w = world(on, { store: { meetTriggered: { settled: 'done', at: T0 } } })
  await start($, w)
  await block($, w, `Now: Sunday, October 11, 2026, 1:35 PM\n<!-- counterparts:onboarding meet=done -->\n${RECALL_BLOCK}`)
  const ui = await mount($, w, 'terminal')
  expect((await bodyLines(ui)).join('\n')).toContain('Release notes go out on Fridays')
  expect(w.submits).toHaveLength(0)
  await ui.unmount()
})

/** A same-day resume's SHORT wake (core #415): one line pointing at the wake above, the since-line, and (core #419) the marker under the clock line. */
async function shortWake($: Engine, w: World, meet: string | null): Promise<void> {
  const body = [
    'Now: Sunday, October 11, 2026, 3:50 PM',
    ...(meet === null ? [] : [`<!-- counterparts:onboarding meet=${meet} -->`]),
    'Counterparts: this session was resumed; the wake it was handed when it started (above) still holds.',
    'Since you started: 2 memories kept in ~/random.',
  ].join('\n')
  await $.session.append({
    door: 'hook-context',
    origin: { kind: 'hook', event: 'SessionStart' },
    uuid: `short-wake-${String(w.events.length)}`,
    message: { type: 'attachment', name: 'hook_additional_context', content: [{ type: 'text', text: `<system-reminder>\nSessionStart hook additional context: ${body}\n</system-reminder>` }] },
  } as never)
  await settle(w)
}

test('a same-day resume’s short wake: a resumed session (turns replayed) never speaks first', async ($, on) => {
  const w = world(on, { turns: 3 })
  await start($, w)
  await shortWake($, w, 'not_started')
  expect(w.submits).toHaveLength(0)
  await shortWake($, w, 'later')
  const ui = await mount($, w, 'terminal')
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  // Day and count are the dashboard's, not the wake's: the header reads them as before.
  expect(await texts(ui)).toContain('776 · day 18')
  await ui.unmount()
})

test('a short wake with no marker (a core between #415 and #419): unknown, nothing happens, the pane draws as usual', async ($, on) => {
  const w = world(on, { turns: 3 })
  await start($, w)
  await shortWake($, w, null)
  const ui = await mount($, w, 'terminal')
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await texts(ui)).toContain('776 · day 18')
  expect(w.submits).toHaveLength(0)
  await ui.unmount()
})

test('speak first: a second session (or a restart) finds the mark and submits nothing', async ($, on) => {
  const w = world(on, { store: { meetTriggered: { session: 'sess-older', at: T0 - 60000 } } })
  await startWith($, w, 'not_started')
  expect(w.submits).toHaveLength(0)
})

test('keyed to the store: once core moved past not_started the mark is settled, and a not_started after it (start-fresh) gets its own first meeting', async ($, on) => {
  const w = world(on, { store: { meetTriggered: { settled: 'done', at: T0 - 86400000 } } })
  await startWith($, w, 'not_started')
  expect(w.submits).toEqual([MEET])
  expect(w.store['meetTriggered']).toEqual({ session: SESSION, at: T0 })
})

test('keyed to the store: a binding mark is settled when core says the meeting moved on', async ($, on) => {
  const w = world(on, { store: { meetTriggered: { session: 'sess-older', at: T0 - 60000 } } })
  await startWith($, w, 'done')
  expect(w.store['meetTriggered']).toEqual({ settled: 'done', at: T0 })
  expect(w.submits).toHaveLength(0)
})

const NEVER: [string, WorldOptions, string | null, boolean?][] = [
  ['the folder paused', { scopeMode: 'paused' }, 'not_started'],
  ['the folder off', { scopeMode: 'off' }, 'not_started'],
  ['the folder reads only (observer)', { scopeMode: 'observer' }, 'not_started'],
  ['paused by a parent', { scopeMode: 'paused', scopeSetBy: '/work' }, 'not_started'],
  ['the folder’s state unknown', { scopesUnreadable: true }, 'not_started'],
  ['a prompt already sent (a resumed session)', { turns: 1 }, 'not_started'],
  ['a prompt being typed', { draft: 'how do I' }, 'not_started'],
  ['no marker in the wake (an older core), even with the endpoint saying not_started', { onboarding: { meet: 'not_started' } }, null],
  ['no marker and no endpoint (today’s core)', {}, null],
  ['a marker naming a state it doesn’t know', {}, 'maybe'],
  ['the wake says later', {}, 'later'],
  ['the wake says offered', {}, 'offered'],
  ['the wake says done', {}, 'done'],
  ['the wake says skipped', {}, 'skipped'],
  ['headless (-p)', {}, 'not_started', false],
]
for (const [name, opts, meet, interactive] of NEVER) {
  test(`speak first never fires with ${name}, and leaves no mark of having fired`, async ($, on) => {
    const w = world(on, opts)
    await startWith($, w, meet, interactive ?? true)
    await w.clock.advance(120000)
    await settle(w)
    expect(w.submits).toHaveLength(0)
    const mark = w.store['meetTriggered'] as { session?: unknown } | undefined
    expect(mark?.session).toBeUndefined()
    if (interactive === false) expect(w.fetches).toHaveLength(0)
  })
}

test('the person spoke first: a prompt they sent before the start’s look stands the speak-first down', async ($, on) => {
  const w = world(on)
  await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false })
  await startWith($, w, 'not_started')
  expect(w.submits).toEqual(['hello'])
  expect(w.store['meetTriggered']).toBeUndefined()
})

test('a slash command the person ran first (/model: no turn) counts as having spoken: no speak-first', async ($, on) => {
  const w = world(on)
  on('command.run', { command: 'model' }, () => ({ text: 'Set model to opus' }))
  await $.command.run({ command: 'model', args: 'opus', origin: { kind: 'composer' } } as never)
  await startWith($, w, 'not_started')
  expect(w.submits).toHaveLength(0)
  expect(w.store['meetTriggered']).toBeUndefined()
})

test('/counterparts typed before the wake (the sidebar answers it, so no other hook sees it) stands the speak-first down too', async ($, on) => {
  const w = world(on)
  await start($, w)
  await $.command.run({ command: 'counterparts', args: 'theme cozy', origin: { kind: 'composer' } } as never)
  await wake($, w, 'not_started')
  await w.clock.advance(120000)
  await settle(w)
  expect(w.submits).toHaveLength(0)
  expect(w.store['meetTriggered']).toBeUndefined()
})

test('a speak-first still queued when the person’s own prompt goes first is dropped', async ($, on) => {
  const w = world(on)
  await startWith($, w, 'not_started')
  expect(w.submits).toEqual([MEET])
  await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false })
  const r = await $.prompt.submit({ text: MEET, origin: { kind: 'plugin', name: 'counterparts' }, wait: false })
  expect(r).toEqual({ drop: 'the person spoke first' })
  expect(w.submits).toEqual([MEET, 'hello'])
})

test('a speak-first still queued when the person only ran a slash command (/model: no turn, no reply) goes through', async ($, on) => {
  const w = world(on)
  on('command.run', { command: 'model' }, () => ({ text: 'Set model to opus' }))
  await startWith($, w, 'not_started')
  expect(w.submits).toEqual([MEET])
  await $.command.run({ command: 'model', args: 'opus', origin: { kind: 'composer' } } as never)
  const r = await $.prompt.submit({ text: MEET, origin: { kind: 'plugin', name: 'counterparts' }, wait: false })
  expect(r).not.toEqual({ drop: 'the person spoke first' })
  expect(w.submits).toEqual([MEET, MEET])
})

test('a queued speak-first is still dropped when the person’s reply called core’s meet meanwhile (the state offered, read from the dashboard)', async ($, on) => {
  const w = world(on, { onboarding: { meet: 'not_started' } })
  on('tool.call', () => ({ result: 'ok', text: '{"script":"..."}' }))
  await startWith($, w, 'not_started')
  expect(w.submits).toEqual([MEET])
  await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false })
  w.onboarding = { meet: 'offered' }
  await $.tool.call({ tool: 'mcp__counterparts__meet' } as never)
  await settle(w)
  const r = await $.prompt.submit({ text: MEET, origin: { kind: 'plugin', name: 'counterparts' }, wait: false })
  expect(r).toEqual({ drop: 'the person spoke first' })
})

test('a queued speak-first is still dropped when a warm poll read the state offered meanwhile', async ($, on) => {
  const w = world(on, { onboarding: { meet: 'not_started' } })
  await startWith($, w, 'not_started')
  const ui = await mount($, w, 'terminal')
  await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false })
  w.onboarding = { meet: 'offered' }
  await w.clock.advance(16000)
  await settle(w)
  const r = await $.prompt.submit({ text: MEET, origin: { kind: 'plugin', name: 'counterparts' }, wait: false })
  expect(r).toEqual({ drop: 'the person spoke first' })
  await ui.unmount()
})

for (const surface of ['terminal'] as const) {
  test(`the theme: tron by default; /counterparts theme cozy stores it and the pane draws warm: ${surface}`, async ($, on) => {
    const w = world(on)
    await start($, w)
    const ui = await mount($, w, surface)
    expect((await colorOf(ui, 'COUNTERPARTS'))).toBe('#00e5ff')
    expect(await cmd($, 'theme sepia')).toContain('tron or cozy (now tron)')
    expect(await cmd($, 'theme cozy')).toContain('Theme cozy')
    expect(w.store['theme']).toBe('cozy')
    await settle(w)
    expect((await colorOf(ui, 'COUNTERPARTS'))).toBe('#9cc65f')
    expect(await cmd($, 'theme tron')).toContain('Theme tron')
    expect(w.store['theme']).toBe('tron')
    await settle(w)
    expect((await colorOf(ui, 'COUNTERPARTS'))).toBe('#00e5ff')
    await ui.unmount()
  })
}

test('two surfaces drawing in turn: the desktop drawn last leaves the terminal its rules and its palette (SURFACE is set per drawing)', async ($, on) => {
  const w = world(on)
  await start($, w)
  const desk = await mount($, w, 'desktop')
  const term = await mount($, w, 'terminal')
  const check = async (): Promise<void> => {
    const tl = await bodyLines(term)
    expect(tl.some(l => /^Mechanisms today ─+ times fired$/.test(l))).toBe(true)
    expect((await colorOf(term, 'COUNTERPARTS'))).toBe('#00e5ff')
    expect((await texts(term)).includes('───')).toBe(true)
    expect((await bodyLines(desk)).some(l => l.includes('─'))).toBe(false)
    expect((await colorOf(desk, 'COUNTERPARTS'))).toBe('suggestion')
  }
  await check()
  // a click on the desktop writes state both read: both draw again, in whatever order
  await click(desk, 'Retrieval')
  await settle(w)
  await check()
  await desk.unmount()
  await term.unmount()
})

test('the desktop draws in the app theme, whatever the stored theme: no panel, the accent its suggestion colour, no rule of dashes', async ($, on) => {
  const w = world(on, { store: { theme: 'cozy' } })
  await start($, w)
  const ui = await mount($, w, 'desktop')
  expect((await colorOf(ui, 'COUNTERPARTS'))).toBe('suggestion')
  expect((await texts(ui)).includes('───')).toBe(false)
  await ui.unmount()
})

for (const [stored, color] of [
  ['cozy', '#9cc65f'],
  ['neon', '#00e5ff'],
] as const) {
  test(`the theme is read from the store at the start: stored ${stored} draws ${color} from the first drawing`, async ($, on) => {
    const w = world(on, { store: { theme: stored } })
    await start($, w)
    const ui = await mount($, w, 'terminal')
    expect((await colorOf(ui, 'COUNTERPARTS'))).toBe(color)
    await ui.unmount()
  })
}

// ── the fox at the top ─────────────────────────────────────────────────────

const FOX: WorldOptions = { store: { brain: 'fox' } }
const foxDetail = (avatarDetail: string): WorldOptions => ({ store: { ...FOX.store, avatarDetail } })
/** A terminal that draws no pictures, once the engine has said so: two refused picture blits. */
const noPictures = async (w: World): Promise<void> => {
  await w.clock.advance(2000)
  await settle(w)
}
const stageBlits = (w: World) => w.blits.filter(b => b.key === 'stage')

test('the fox is the avatar when none was chosen: under the title with the count and the day on its right, edge to edge, a thin rule under it; a short pane draws the header alone', async ($, on) => {
  const w = world(on, { store: { brain: undefined }, noPictures: true })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await noPictures(w)
  const r = await ui.find({ type: 'Raster', key: 'stage' })
  expect(r?.props['columns']).toBe(34)
  expect(r?.props['rows']).toBe(15)
  expect(await ui.find({ type: 'Raster', key: 'brain' })).toBeUndefined()
  expect((await titleOf(ui))?.text).toContain('COUNTERPARTS')
  expect(await ui.find({ type: 'Text', text: '776 · day 18' })).toBeDefined() // on the title row
  expect(await ui.find({ type: 'Text', text: '776 memories' })).toBeUndefined() // no row of its own
  await ui.unmount()
  const short = await mount($, w, 'terminal', { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 24 } } as typeof PANE_PROPS)
  expect(await short.find({ type: 'Raster' })).toBeUndefined()
  expect(await short.find({ type: 'Text', text: '776 · day 18' })).toBeDefined()
  await short.unmount()
  // the brain is gone: asked for, the command names what there is
  expect(await cmd($, 'avatar brain')).toBe('counterparts avatar: animal or off; or detail auto, images, fine or basic.')
  expect(await cmd($, 'avatar off')).toBe('No avatar: the header is two lines.')
  expect(w.store['brain']).toBe('off')
  expect(await cmd($, 'avatar animal')).toContain('The avatar is the fox')
  expect(w.store['brain']).toBe('fox')
})

test('a terminal draws a picture first, whatever it is: nothing about it is read', async ($, on) => {
  const ghostty = world(on, FOX)
  await start($, ghostty)
  const ui = await mount($, ghostty, 'terminal')
  const img = await ui.find({ type: 'Image', key: 'stage' })
  expect(img?.props['columns']).toBe(30)
  expect(img?.props['rows']).toBe(16)
  // the PNG as a file under the plugin's folder, which the terminal reads itself: no bytes cross `$`
  const src = img?.props['source'] as { file?: string; format?: string } | undefined
  expect(src?.format).toBe('png')
  expect(String(src?.file)).toMatch(/^\/.*\/art\/fox\/[A-Za-z0-9+]+\.png$/)
  expect(img?.props['alt']).toBe('a small fox')
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeUndefined()
  await ui.unmount()
})

test('sextants when the person chose them: rows of Text, no Raster (a Raster takes no sextant), the count still on the title row', async ($, on) => {
  const w = world(on, foxDetail('fine'))
  await start($, w)
  const ui = await mount($, w, 'terminal')
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  const all = await texts(ui)
  expect([...all].some(ch => (ch.codePointAt(0) ?? 0) >= 0x1fb00 && (ch.codePointAt(0) ?? 0) <= 0x1fb3b)).toBe(true)
  expect(await ui.find({ type: 'Text', text: '776 · day 18' })).toBeDefined()
  await ui.unmount()
})

test('half-blocks where pictures are not drawn, and the desktop draws an Svg of the same fox', async ($, on) => {
  const w = world(on, { ...FOX, noPictures: true })
  await start($, w)
  let ui = await mount($, w, 'terminal')
  await noPictures(w)
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeDefined()
  await ui.unmount()
  ui = await mount($, w, 'desktop')
  const svg = await ui.find({ type: 'Svg' })
  // the PNG's bytes, read from the plugin's folder (art/fox/) once, as the picture's data URI
  expect(String(svg?.props['source'])).toContain('data:image/png;base64,iVBORw0KGgoidle.png')
  expect(w.fsReads.filter(p => p.endsWith('/art/fox/idle.png'))).toHaveLength(1)
  expect(svg?.props['alt']).toBe('a small fox')
  await ui.unmount()
})

test('/counterparts avatar detail overrides the choice, stored for every session', async ($, on) => {
  const w = world(on, { ...FOX, noPictures: true })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  expect(await cmd($, 'avatar detail fine')).toContain('sextants')
  expect(w.store['avatarDetail']).toBe('fine')
  await settle(w)
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeUndefined()
  expect(await cmd($, 'avatar detail images')).toContain('picture')
  await settle(w)
  expect(await ui.find({ type: 'Image', key: 'stage' })).toBeDefined()
  expect(await cmd($, 'avatar detail basic')).toContain('half-blocks')
  await settle(w)
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeDefined()
  expect(await cmd($, 'avatar detail sharp')).toContain('auto, images, fine or basic')
  await ui.unmount()
})

test('a terminal that turns out to draw an Image’s alt: two refused picture blits, and auto draws half-blocks instead', async ($, on) => {
  const w = world(on, { ...FOX, noPictures: true })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await noPictures(w)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeDefined()
  expect([...(await texts(ui))].some(ch => (ch.codePointAt(0) ?? 0) >= 0x1fb00)).toBe(false)
  await ui.unmount()
})

test('iTerm2, where pictures draw their alt: the sextant fox, not half-blocks', async ($, on) => {
  const w = world(on, { ...FOX, env: { HOME, TERM_PROGRAM: 'iTerm.app' }, noPictures: true })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await noPictures(w)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect([...(await texts(ui))].some(ch => (ch.codePointAt(0) ?? 0) >= 0x1fb00 && (ch.codePointAt(0) ?? 0) <= 0x1fb3b)).toBe(true)
  await ui.unmount()
})

test('a picture refused for another reason (not mounted yet) is not counted: auto keeps trying pictures', async ($, on) => {
  const w = world(on, { ...FOX, blitDeny: true })
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await noPictures(w)
  expect(await ui.find({ type: 'Image', key: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeUndefined()
  await ui.unmount()
})

test('the fox is still for long holds: the tail tip flicks within seconds, then one blit per change of what is on screen, none between; a save writes on the notepad at once', async ($, on) => {
  const w = world(on, foxDetail('basic'))
  on('tool.call', () => ({ result: 'ok', text: '{"stored":true,"id":"mem_f0000001"}' }))
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await w.clock.advance(1500)
  expect(stageBlits(w)).toHaveLength(0) // the first hold is at least 2 s
  await w.clock.advance(3000)
  const flick = ['tailSmall0', 'tailSmall1'].map(frame => halfCells({ frame, fx: [] }))
  expect(stageBlits(w).some(b => 'cells' in b && flick.includes(b.cells))).toBe(true)
  await w.clock.advance(40000)
  const n = stageBlits(w).length
  expect(n).toBeGreaterThan(0)
  expect(n).toBeLessThan(40) // a few moments a minute, never a running loop
  // every blit changes the picture
  const cellsOf = stageBlits(w).map(b => ('cells' in b ? b.cells : ''))
  for (let i = 1; i < cellsOf.length; i++) expect(cellsOf[i]).not.toBe(cellsOf[i - 1])
  const notes = ['note0', 'note1', 'note2'].map(frame => halfCells({ frame, fx: [] }))
  const shown = new Set<string>()
  const look = async () => {
    shown.add(String((await ui.find({ type: 'Raster', key: 'stage' }))?.props['cells']))
    for (const b of stageBlits(w)) if ('cells' in b) shown.add(b.cells)
  }
  await look()
  expect(notes.some(c => shown.has(c))).toBe(false)
  await $.tool.call({ tool: 'mcp__counterparts__note', title: 'A fox', text: 'x' } as never)
  await settle(w)
  for (let i = 0; i < 6; i++) {
    await w.clock.advance(250)
    await look()
  }
  expect(notes.filter(c => shown.has(c)).length).toBeGreaterThanOrEqual(2)
  await ui.unmount()
})

test('no timer while the pane is hidden or holds the keyboard: nothing is drawn, and a drawing starts it again', async ($, on) => {
  const w = world(on, FOX)
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await ui.redraw({ ...PANE_PROPS, isFocused: true } as typeof PANE_PROPS)
  await settle(w)
  const n = stageBlits(w).length
  await w.clock.advance(120000)
  expect(stageBlits(w).length).toBe(n)
  await ui.redraw(PANE_PROPS)
  await settle(w)
  await w.clock.advance(60000)
  expect(stageBlits(w).length).toBeGreaterThan(n)
  // hidden: the next change finds it so and stops
  w.shown = false
  await w.clock.advance(30000)
  const m = stageBlits(w).length
  await w.clock.advance(120000)
  expect(stageBlits(w).length).toBe(m)
  await ui.unmount()
})

test('after two minutes with nothing happening it naps, and the person’s prompt wakes it', async ($, on) => {
  const w = world(on, foxDetail('fine'))
  await start($, w)
  const ui = await mount($, w, 'terminal')
  await w.clock.advance(200000)
  await settle(w)
  const z = await ui.findAll({ type: 'Text' })
  expect(z.some(t => t.props['color'] === textHex('#9be') || t.props['backgroundColor'] === textHex('#9be'))).toBe(true) // a z beside the head
  await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false })
  await settle(w)
  await w.clock.advance(5000)
  await settle(w)
  const after = await ui.findAll({ type: 'Text' })
  expect(after.some(t => t.props['color'] === textHex('#9be') || t.props['backgroundColor'] === textHex('#9be'))).toBe(false)
  await ui.unmount()
})

// ── which store wrote the status file ──────────────────────────────────────

async function wakeWithStore($: Engine, w: World, id: string): Promise<void> {
  await $.session.append({
    door: 'hook-context',
    origin: { kind: 'hook', event: 'SessionStart' },
    uuid: `wake-store-${id}`,
    message: {
      type: 'attachment',
      name: 'hook_additional_context',
      content: [{ type: 'text', text: `<system-reminder>\nSessionStart hook additional context: <!-- counterparts:onboarding meet=done -->\n<!-- counterparts:store id=${id} -->\n</system-reminder>` }],
    },
  } as never)
  await settle(w)
}

const MINE = 'st_0123456789abcdef'
const THEIRS = 'st_fedcba9876543210'

test('a status file another store wrote: none of its numbers, one dim line instead; when it matches again they come back', async ($, on) => {
  const w = world(on)
  await start($, w)
  await wakeWithStore($, w, MINE)
  w.dashStore = THEIRS
  const ui = await mount($, w, 'terminal')
  const body = (await bodyLines(ui)).join(' ')
  expect(body).toContain('The status file is another memory’s.')
  expect(body).not.toContain('Salience')
  expect(body).not.toContain('Last Dream')
  expect(await ui.find({ type: 'Text', text: '776 · day 18' })).toBeUndefined()
  expect(w.fetches).toEqual([])
  // the right store writes it again
  w.dashStore = MINE
  await w.clock.advance(31000)
  await settle(w)
  expect(await ui.find({ type: 'Text', text: '776 · day 18' })).toBeDefined()
  expect((await bodyLines(ui)).join(' ')).toContain('Salience')
  await ui.unmount()
})

for (const [marker, dash, said] of [[null, THEIRS, 'no marker'], [MINE, null, 'a store not minted yet'], [MINE, undefined, 'an older core']] as const) {
  test(`which store, unknown on one side (${said}): it carries on`, async ($, on) => {
    const w = world(on)
    await start($, w)
    if (marker !== null) await wakeWithStore($, w, marker)
    w.dashStore = dash
    const ui = await mount($, w, 'terminal')
    expect(await ui.find({ type: 'Text', text: '776 · day 18' })).toBeDefined()
    await ui.unmount()
  })
}

test('there is no search box, whatever the environment says (COUNTERPARTS_SIDEBAR_SEARCH is read no more)', async ($, on) => {
  const w = world(on, { env: { HOME, COUNTERPARTS_SIDEBAR_SEARCH: '1' } })
  await start($, w)
  for (const surface of SURFACES) {
    const ui = await mount($, w, surface)
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    // no search row: the count and the day share the title row
    expect(await ui.find({ type: 'Text', text: '776 · day 18' })).toBeDefined()
    expect(await ui.find({ key: 'head2' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the glance: the wake\'s Last here under the dream, three lines; a click opens all of it, another closes it; the intro leaves the footer once met', async ($, on) => {
  const w = world(on, FOX)
  await start($, w)
  const long = 'We moved the fox to pictures first. Then the footer lost its intro line. Then the bars went to a log scale. Then the glance came, and it read the wake. Then it learned to open on a click, like the dream does.'
  await $.session.append({
    door: 'hook-context',
    origin: { kind: 'hook', event: 'SessionStart' },
    uuid: 'wake-glance',
    message: { type: 'attachment', name: 'hook_additional_context', content: [{ type: 'text', text: `<system-reminder>\nSessionStart hook additional context: <!-- counterparts:onboarding meet=done -->\nLast here: ${long}\n</system-reminder>` }] },
  } as never)
  await settle(w)
  const ui = await mount($, w, 'terminal')
  let lines = await bodyLines(ui)
  const at = lines.findIndex(l => l.startsWith('Last here'))
  expect(at).toBeGreaterThan(lines.findIndex(l => l.startsWith('Last Dream')))
  expect(lines.join(' ')).not.toContain('like the dream does')
  await click(ui, 'We moved the fox')
  lines = await bodyLines(ui)
  expect(lines.join(' ')).toContain('like the dream does.')
  await click(ui, 'We moved the fox')
  expect((await bodyLines(ui)).join(' ')).not.toContain('like the dream does')
  expect((await texts(ui)).includes('/counterparts:meet')).toBe(false)
  expect((await texts(ui)).includes('/counterparts avatar off')).toBe(true)
  await ui.unmount()
})
