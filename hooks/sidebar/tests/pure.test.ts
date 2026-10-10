/**
 * The pure parts, without the engine: the brain's cells, the cell encoding,
 * the feed's reading of the dashboard, the recall block and a facts answer.
 */
import { describe, expect, test } from 'claude-code/testing'

import { Brain, DEFAULT_COLOR } from '../hooks/brain'
import { decodeCells, encodeCells, isRasterSafe } from '../hooks/cells'
import {
  classify,
  countToday,
  dateOf,
  decisionFor,
  dreamChanges,
  firstSentence,
  hm,
  mechEvents,
  openedIds,
  parseFacts,
  parseRecallBlock,
  resolveServer,
  savedItems,
  shortDir,
  surfacedIds,
  wrap,
} from '../hooks/feed'
import { cells, ellipsizeCells, padCells } from '../hooks/width'
import { hookConfig, lookup, parentOf, parseRegistry, settingsHookConfig, under } from '../hooks/scopes'
import { MECHS, STAGES } from '../hooks/mechanisms'
import { EXPAND_MAX_LINES, bar, clip, heading, layoutBody, openedLines, textOf, wrapN } from '../hooks/sections'
import type { BodyState } from '../hooks/sections'
import { DECISION_T3, EVENTS, FACTS_ANSWER, RECALL_BLOCK, SESSION, T0, ev } from './world'

describe('the brain', () => {
  test('a frame is cols x rows cells of braille or blank, every one a Raster may hold', () => {
    const brain = new Brain()
    const cells = brain.frame(42, 14, T0)
    expect(cells.length).toBe(42 * 14 * 3)
    let braille = 0
    for (let i = 0; i < cells.length; i += 3) {
      const cp = cells[i] ?? 0
      expect(isRasterSafe(cp)).toBe(true)
      expect(cp === 0x20 || (cp >= 0x2800 && cp <= 0x28ff)).toBe(true)
      if (cp > 0x2800) braille += 1
    }
    expect(braille).toBeGreaterThan(80) // a brain, not an empty box
  })

  test('no glow by cell background (it steps): every cell takes the one background given; paused, it is grey', () => {
    const live = new Brain().frame(42, 14, T0)
    for (let i = 2; i < live.length; i += 3) expect(live[i]).toBe(DEFAULT_COLOR)
    const onBlack = new Brain().frame(42, 14, T0, { bg: [5, 8, 12] })
    for (let i = 2; i < onBlack.length; i += 3) expect(onBlack[i]).toBe(0x05080c)
    const grey = new Brain().frame(42, 14, T0, { mono: true })
    for (let i = 0; i < grey.length; i += 3) {
      expect(grey[i + 2]).toBe(DEFAULT_COLOR)
      const fg = grey[i + 1] ?? 0
      if ((grey[i] ?? 0) === 0x20) continue
      const r = (fg >> 16) & 255, g = (fg >> 8) & 255, b = fg & 255
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40)
    }
  })

  test('it sways: two frames apart in time differ; with nothing firing it comes to rest and asks for no frames', () => {
    const brain = new Brain()
    const a = encodeCells(brain.frame(42, 14, T0))
    brain.step(T0 + 2000, 2000)
    const b = encodeCells(brain.frame(42, 14, T0 + 2000))
    expect(a === b).toBe(false)
    expect(brain.mode()).toBe('calm')
    for (let t = 2500; t <= 80000; t += 500) brain.step(T0 + t, 500) // a minute quiet, then it eases to a stop
    expect(brain.mode()).toBe('rest')
    brain.pulse('amygdala', STAGES.encoding.col, T0 + 80000)
    brain.step(T0 + 80100, 100)
    expect(brain.mode()).toBe('burst')
  })

  test('a picked mechanism tags its region with its name on its stage colour', () => {
    const brain = new Brain()
    brain.light('brainstem', STAGES.storage.col)
    const cells = brain.frame(42, 14, T0, { tag: { region: 'brainstem', label: 'Forgetting', col: STAGES.storage.col } })
    let text = ''
    for (let i = 0; i < cells.length; i += 3) text += String.fromCharCode(cells[i] ?? 32)
    expect(text).toContain(' Forgetting ')
    expect(text).toContain('◆')
  })
})

describe('cells', () => {
  test('encode and decode round-trip; the alphabet is standard padded base64', () => {
    const words = Uint32Array.of(0x2588, 0xff8800, 0x01000000, 0x2847, 0x00e5ff, 0x001e2c)
    const b64 = encodeCells(words)
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(b64.length % 4).toBe(0)
    expect([...decodeCells(b64)]).toEqual([...words])
    // one orange cell, as the engine's own example writes it
    expect(encodeCells(Uint32Array.of(0x2588, 0xff8800, 0x01000000))).toBe('iCUAAACI/wAAAAAB')
  })

  test('a wide character is not Raster-safe; braille, blocks and the switch caps are', () => {
    expect(isRasterSafe(0x4e00)).toBe(false)
    for (const cp of [0x2800, 0x28ff, 0x2590, 0x258c, 0xe0b6, 0xe0b4, 0x25c6, 0x20]) expect(isRasterSafe(cp)).toBe(true)
  })
})

describe('the feed', () => {
  test('an event proves a mechanism or is left out; this session’s in plain words, the night’s, and other sessions’ marked', () => {
    const rows = EVENTS.map(e => classify(e, SESSION))
    expect(rows[0]).toMatchObject({ mech: 'salience', word: 'kept', text: 'The sidebar draws the brain in braille', who: 'here', keys: ['mem:mem_aaaa1111'], memory: { id: 'mem_aaaa1111', title: 'The sidebar draws the brain in braille' } })
    expect(rows[1]).toMatchObject({ mech: 'retrieval', word: 'recalled', text: '2 came to mind', who: 'here', more: ['Release notes go out on Fridays', 'Publishing waits for a review'] })
    expect(rows[2]).toMatchObject({ mech: 'retrieval', who: 'other', keys: ['turn:sess-older:7'] })
    expect(rows[3]).toBeNull() // a quiet turn
    expect(rows[4]).toMatchObject({ mech: 'dreaming', mechs: ['dreaming'], word: 'dreamed', who: 'night', dream: 'drm_test0001' })
    expect(rows[5]).toMatchObject({ mech: 'decay', word: 'faded', memory: { id: 'mem_fade0001', title: 'An old plan that faded' } })
    expect(rows[6]).toMatchObject({ mech: 'consolidation', word: 'became core' })
    expect(rows[7]).toBeNull() // a sleep check that faded nothing
    expect(rows[0]?.mechs).toEqual(['salience'])
    expect(rows[1]?.mechs).toEqual(['retrieval'])
    expect(classify(EVENTS[0]!, 'another-session')?.who).toBe('other')
    // a contradiction a session settled is that session's, not the night's
    const settled = (actorId: string) => ({ seq: 1, at: T0, name: 'contradiction.settled', text: 'A session settled a contradiction.', detail: [{ key: 'actor', value: 'session' }, { key: 'actorId', value: actorId }] })
    expect(classify(settled(SESSION), SESSION)?.who).toBe('here')
    expect(classify(settled('sess-else'), SESSION)?.who).toBe('other')
    expect(classify({ ...settled('x'), detail: [{ key: 'actor', value: 'dream' }] }, SESSION)?.who).toBe('night')
  })

  test('one event, every mechanism it proves: its own mechanism first, the rest in `mechs`', () => {
    // a mood-matched recall (2026-10-10 live: 7 of the last 40 turns): Retrieval's row, Emotion lit too
    const mood = ev(501, 'recall.decision', 'On turn 4 I kept “Choosing the cores” as a footnote.', 1, {
      session: SESSION, turn: '4', surfacedCount: '0', footnoteCount: '2', moodMatched: '1',
    })
    const recalled = classify(mood, SESSION)!
    expect(recalled).toMatchObject({ mech: 'retrieval', mechs: ['retrieval', 'emotional'], word: 'recalled', text: '2 came to mind', who: 'here' })
    // a mood match the render trimmed to nothing shown is still Emotion's, said as such
    const trimmed = classify({ ...mood, detail: mood.detail.map(d => (d.key === 'footnoteCount' ? { ...d, value: '0' } : d)) }, SESSION)!
    expect(trimmed).toMatchObject({ mech: 'emotional', mechs: ['emotional'], text: '1 brought closer by a matching mood' })
    // a dream that merged near-copies and wrote a gist (live: 10 of the last 21 dreams wrote one)
    const dream = ev(502, 'dream.changed', 'In a dream I changed 47 things (1 merge, 20 link, 20 replayed, 2 gist, 3 feeling-now).', 1, {
      applied: '49', merge: '1', gist: '2', link: '20', 'nominate-core': '2',
    })
    const dreamed = classify(dream, SESSION)!
    expect(dreamed).toMatchObject({ id: 'seq:502', mech: 'dreaming', word: 'dreamed', who: 'night' })
    expect(dreamed.mechs).toEqual(['dreaming', 'episodic-semantic', 'interference', 'consolidation'])
    // a gist alone is Gist's and Dreaming's; a dream that changed nothing and suggested nothing proves none
    expect(classify(ev(503, 'dream.changed', 'In a dream I changed 1 thing (1 gist).', 1, { applied: '1', gist: '1' }))?.mechs).toEqual(['dreaming', 'episodic-semantic'])
    expect(classify(ev(504, 'dream.changed', 'In a dream I changed nothing; 8 were refused.', 1, { applied: '0', refused: '8' }))).toBeNull()
    expect(classify(ev(505, 'dream.changed', 'It suggested 1 memory for the core.', 1, { applied: '0', 'nominate-core': '1' }))?.mechs).toEqual(['dreaming'])
    // a contradiction settled `changed`: Reconsolidation's row, Interference too (the earlier memory fades)
    const changed = ev(506, 'contradiction.settled', 'The dream settled a contradiction as changed.', 1, { how: 'changed', actor: 'dream' })
    expect(classify(changed)).toMatchObject({ mech: 'reconsolidation', mechs: ['reconsolidation', 'interference'], word: 'settled' })
    expect(classify(ev(507, 'contradiction.settled', 'Settled as open.', 1, { how: 'open', actor: 'dream' }))?.mechs).toEqual(['reconsolidation'])
    // a band move is one or the other, never both
    expect(classify(ev(508, 'band.transition', 'Faded.', 1, { site: 'decay', direction: 'down' }))?.mechs).toEqual(['decay'])
    expect(classify(ev(509, 'band.transition', 'Rose.', 1, { site: 'consolidate', direction: 'up' }))?.mechs).toEqual(['consolidation'])
    expect(classify(ev(510, 'band.transition', 'Crossed into identity.', 1, { site: 'decay', direction: 'up' }))).toBeNull()
  })

  test('a turn’s decision row: which memories were said in full, found by this session and the turn', () => {
    expect(surfacedIds(DECISION_T3)).toEqual(['mem_sur00001'])
    expect(decisionFor([EVENTS[1]!, DECISION_T3], SESSION, 3)).toBe(DECISION_T3)
    expect(decisionFor([DECISION_T3], 'sess-else', 3)).toBeUndefined()
    expect(decisionFor([DECISION_T3], SESSION, 4)).toBeUndefined()
    expect(surfacedIds(ev(1, 'recall.decision', '', 0, { surfaced: 'not json' }))).toEqual([])
  })

  test('the twelve mechanisms, by the website’s names, schemas not built', () => {
    expect(MECHS.map(m => m.short)).toEqual([
      'Salience', 'Emotion', 'Forgetting', 'Interference', 'Retrieval', 'Association',
      'Prospective', 'Consolidation', 'Dreaming', 'Reconsolidation', 'Gist', 'Schemas',
    ])
    expect(MECHS.filter(m => m.notBuilt).map(m => m.id)).toEqual(['schema'])
  })

  test('the recall block: what came to mind and what was quietly available', () => {
    const wrapped = `<system-reminder>\nUserPromptSubmit hook additional context: ${RECALL_BLOCK}\n</system-reminder>`
    expect(parseRecallBlock(wrapped)).toEqual({
      turn: 3,
      surfaced: ['Mike chose 35 columns on 2026-10-10: width is scarce'],
      footnotes: [{ title: 'Release notes go out on Fridays', id: 'mem_rel00001' }],
    })
    expect(parseRecallBlock('<system-reminder>a wake, no recall</system-reminder>')).toBeNull()
  })

  test('a facts answer: titles, ids, the who-and-when line, the excerpt', () => {
    const { header, hits } = parseFacts(FACTS_ANSWER)
    expect(header).toBe('2 match · showing 2')
    expect(hits).toEqual([
      { id: 'mem_pub00001', title: 'Publishing waits for a test and a review', kind: 'memory', date: 'Oct 9', who: 'you said it', meta: 'memory · Oct 9 · you said it', excerpt: 'Publishing is mine once it is tested and reviewed.' },
      { id: 'mem_pub00002', title: 'npm publish needs a one-time password', kind: 'memory', date: 'Sep 24', who: 'I said it', meta: 'memory · Sep 24 · I said it', excerpt: 'The publish step asks for a one-time password.' },
    ])
  })

  test('a facts answer read from the right: a title holding “ · word_word · ”, a chapter, no ways at all', () => {
    const answer = [
      '14 match · showing 3 · 11 more → page 2',
      '',
      '1. Sidebar · npm_install · trial notes · mem_bbbbbbbbbbbb · words',
      '   you said · decided · no event date',
      '   Body one.',
      '',
      '2. [journal] The lighthouse conversation · ep_aaaaaaaaaaaa (chapter 2 of 5) · meaning',
      '   my journal · written 10-08..10-09',
      '   Body two.',
      '',
      '3. No ways at all · mem_cccccccccccc · ',
      '   you said · decided · no event date',
      '   Body three.',
    ].join('\n')
    const { total, hits } = parseFacts(answer)
    expect(total).toBe(14)
    expect(hits.map(h => h.meta)).toEqual(['memory · you said it', 'journal · Oct 8', 'memory · you said it'])
    expect(hits.map(h => [h.id, h.title])).toEqual([
      ['mem_bbbbbbbbbbbb', 'Sidebar · npm_install · trial notes'],
      ['ep_aaaaaaaaaaaa', 'The lighthouse conversation'],
      ['mem_cccccccccccc', 'No ways at all'],
    ])
  })

  test('saved: note, chapter and session_end under either server name; an update names what it replaces; a refused one saves nothing', () => {
    const note = savedItems('mcp__counterparts__note', { title: 'Sidebar shipped', text: 'long' }, '{"stored":true,"id":"mem_new00001"}', T0, 1)
    expect(note).toEqual([{ key: 'live:1:0', id: 'mem_new00001', title: 'Sidebar shipped', at: T0, replaces: null, replacesId: null, kind: 'new' }])
    expect(savedItems('mcp__counterparts__note', { title: 'Newer', updates: 'mem_old00001' }, '{"stored":true,"id":"mem_n2"}', T0, 2)[0]).toMatchObject({ kind: 'update', replacesId: 'mem_old00001' })
    // `how: open` keeps both: no replacement; a held update (looked unrelated) settled nothing
    expect(savedItems('mcp__counterparts__note', { title: 'Beside', updates: 'mem_old00001', how: 'open' }, '{"stored":true}', T0, 3)[0]?.kind).toBe('new')
    expect(savedItems('mcp__counterparts__note', { title: 'Held', updates: 'mem_old00001' }, '{"stored":true,"settled":{"ok":false,"held":true}}', T0, 4)[0]?.kind).toBe('new')
    expect(savedItems('mcp__plugin_counterparts_counterparts__chapter', { title: 'Day 18' }, '{}', T0, 5)[0]).toMatchObject({ title: 'Chapter: Day 18', kind: 'chapter' })
    const end = savedItems('mcp__counterparts__session_end', { memories: [{ title: 'One', text: 'a' }, { text: 'Two, from its text\nsecond line' }, { title: 'Three', updates: 'mem_old00001' }] }, '{"deposited":3}', T0, 6)
    expect(end.map(s => [s.title, s.kind])).toEqual([['One', 'new'], ['Two, from its text', 'new'], ['Three', 'update']])
    expect(savedItems('mcp__counterparts__session_end', { memories: [{ title: 'x' }] }, '{"deposited":0}', T0, 7)).toEqual([])
    expect(savedItems('mcp__counterparts__note', { text: 'x' }, '{"stored":false,"reason":"duplicate"}', T0, 8)).toEqual([])
    expect(savedItems('mcp__counterparts__recall', { question: 'x' }, '{}', T0, 9)).toEqual([])
    expect(savedItems('mcp__other__note', { text: 'x' }, '{}', T0, 10)).toEqual([])
  })

  test('a recall that opens memories by address: its ids, or a handle that is an id', () => {
    expect(openedIds('mcp__counterparts__recall', { ids: ['mem_a1', 'nonsense', 'mem_b2'] })).toEqual({ ids: ['mem_a1', 'mem_b2'], handle: null })
    expect(openedIds('mcp__counterparts__recall', { handle: 'mem_c3' })).toEqual({ ids: ['mem_c3'], handle: null })
    expect(openedIds('mcp__counterparts__recall', { handle: 'Release notes go out on Fridays' })).toEqual({ ids: [], handle: 'Release notes go out on Fridays' })
    expect(openedIds('mcp__counterparts__recall', { question: 'x', mode: 'facts' })).toEqual({ ids: [], handle: null })
    expect(openedIds('mcp__counterparts__note', { ids: ['mem_a1'] })).toEqual({ ids: [], handle: null })
  })

  test('times fired today from the feed (an older dashboard): rows on the day, a dream’s rows once, counts that a poll adds to', () => {
    const rows = [...EVENTS, ev(402, 'dream.changed', 'Changed 5.', 599, { applied: '5', merge: '1' }, 'drm_test0001')]
      .map(e => classify(e, SESSION))
      .filter((r): r is NonNullable<typeof r> => r !== null)
    const day = dateOf(T0)
    const first = countToday(rows, day, dateOf)
    expect(first.counts).toMatchObject({ salience: 1, retrieval: 2, decay: 1, consolidation: 2, dreaming: 1, interference: 1, schema: null, prospective: 0 })
    // the same dream again (a poll's new row of it) is not a second firing
    const again = countToday([classify(ev(403, 'dream.journaled', 'x', 1, {}, 'drm_test0001'))!], day, dateOf, first.counts, first.dreams)
    expect(again.counts['dreaming']).toBe(1)
    expect(countToday(rows, '2026-10-08', dateOf).counts['salience']).toBe(0)
  })

  test('a mechanism’s firings, newest first, each with the word that proves it and what it was about', () => {
    const list = mechEvents([...EVENTS, ev(402, 'dream.changed', 'In a dream I changed 5 things.', 599, { applied: '5', merge: '1' }, 'drm_test0001')], 'interference')
    expect(list).toEqual([{ seq: 402, at: T0 - 599 * 60000, word: 'merged in a dream', title: 'In a dream I changed 5 things.', memoryId: null, text: 'In a dream I changed 5 things.' }])
    const faded = mechEvents(EVENTS, 'decay')
    expect(faded.map(e => [e.word, e.title, e.memoryId])).toEqual([['faded', 'An old plan that faded', 'mem_fade0001']])
    expect(mechEvents(EVENTS, 'retrieval').map(e => e.title)).toEqual(['2 came to mind', '1 came to mind'])
  })

  test('a dream: its first sentence and the rest; what changed that night, in plain words, only what happened', () => {
    expect(firstSentence('I dreamed the friday evening over again, and the pieces kept lining up. The paper had a model.')).toEqual({
      first: 'I dreamed the friday evening over again, and the pieces kept lining up.',
      rest: 'The paper had a model.',
    })
    expect(firstSentence('No full stop at all')).toEqual({ first: 'No full stop at all', rest: '' })
    expect(firstSentence('“Who said it?” I asked. Then.')).toEqual({ first: '“Who said it?”', rest: 'I asked. Then.' })
    const d = { id: 'drm_x', date: '2026-10-10', day: 19, journal: 'x', counts: { merge: 1, gist: 2, link: 20, settle: 1, 'feeling-now': 3 }, changes: [{ action: 'merge', said: 'merged 3 near-copies into one' }] }
    expect(dreamChanges(d, { faded: 4, core: 3 })).toEqual([
      'merged 3 near-copies into one',
      'wrote down 2 patterns it saw',
      'linked 20 pairs of memories',
      'replaced 1 outdated memory',
      '4 memories faded',
      '3 became core memories',
    ])
    expect(dreamChanges({ ...d, counts: { merge: 2 }, changes: [] }, { faded: 0, core: 0 })).toEqual(['merged near-copies 2 times'])
    expect(dreamChanges({ ...d, counts: {}, changes: [] }, { faded: 1, core: 1 })).toEqual(['1 memory faded', '1 became core memory'])
  })

  test('the memory server: the npm install’s first, then the plugin’s', () => {
    expect(resolveServer(['mcp__plugin_counterparts_counterparts__recall', 'mcp__counterparts__recall'])).toBe('counterparts')
    expect(resolveServer(['mcp__plugin_counterparts_counterparts__recall'])).toBe('plugin_counterparts_counterparts')
    expect(resolveServer(['mcp__other__recall'])).toBeNull()
  })

  test('a heading’s time: 1:35 today (the mockups’ clock, no am or pm), a date before today', () => {
    expect(hm(T0, T0)).toBe('1:35')
    expect(hm(new Date(2026, 9, 9, 0, 5).getTime(), T0)).toBe('12:05')
    expect(hm(new Date(2026, 9, 9, 8, 7).getTime(), T0)).toBe('8:07')
    expect(hm(new Date(2026, 9, 8, 22, 0).getTime(), T0)).toBe('Oct 8')
  })

  test('events naming no session (a look-up, a reminder, a link flush): from after this session began, this session’s', () => {
    const at = (minutesAgo: number) => T0 - minutesAgo * 60000
    const lookup = (minutesAgo: number) => ({ seq: 9, at: at(minutesAgo), name: 'mcp.recall', text: 'A deliberate look-up.', detail: [] })
    expect(classify(lookup(5), SESSION, at(30))?.who).toBe('here')
    expect(classify(lookup(60), SESSION, at(30))?.who).toBe('other')
    const reminder = { seq: 10, at: at(1), name: 'prospective.plain', text: 'A reminder was said.', detail: [] }
    expect(classify(reminder, SESSION, at(30))?.who).toBe('here')
    // A flush names no session (live keys, 2026-10-10: reason, day, dayFrom, claims, passes, pairs,
    // rows, blocked, evicted, swept, dropped, pendingDropped, corrupt, stuck, oldestMs, and a
    // `contiguity` object whose `sessions` is a count), so it is placed by time like the others.
    const flush = (minutesAgo: number) => ({
      seq: 11, at: at(minutesAgo), name: 'associate.flush', text: '2 pairs got more connected.',
      detail: [{ key: 'reason', value: 'flushed' }, { key: 'rows', value: '4' }, { key: 'contiguity', value: '{"reason":"buffered","sessions":1}' }],
    })
    expect(classify(flush(1), SESSION, at(30))?.who).toBe('here')
    expect(classify(flush(60), SESSION, at(30))?.who).toBe('other')
  })

  test('widths are terminal cells: a wide character takes two, so wrapping and padding never overrun', () => {
    expect(cells('abc')).toBe(3)
    expect(cells('記憶')).toBe(4)
    expect(cells('🧠 brain')).toBe(8)
    expect(cells('e\u0301')).toBe(1) // e and a combining accent: one cell
    for (const line of wrap('記憶の窓 memory window 記憶記憶記憶記憶記憶', 10)) expect(cells(line)).toBeLessThanOrEqual(10)
    expect(cells(ellipsizeCells('記憶記憶記憶', 7))).toBeLessThanOrEqual(7)
    expect(cells(padCells('記憶', 6))).toBe(6)
  })

  test('wrap keeps words whole and cuts only a word longer than the line', () => {
    expect(wrap('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps'])
    expect(wrap('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
  })
})

test('a folder as a person says it: a home folder as ~', () => {
  expect(shortDir('/Users/mike/random')).toBe('~/random')
  expect(shortDir('/home/mike')).toBe('~')
  expect(shortDir('/Users/mikeother')).toBe('~')
  expect(shortDir('/work/project')).toBe('/work/project')
  expect(shortDir('/Users')).toBe('/Users')
  expect(shortDir(null)).toBe('this folder')
})

describe('the scope registry, read as the hooks read it', () => {
  test('entries: a bad one is skipped by itself; a file that is not a registry holds none', () => {
    const text = JSON.stringify({
      version: 1,
      scopes: {
        '/a': { mode: 'paused', since: '2026-10-09', resumeTo: 'on' },
        '/b': { mode: 'sleepy', since: '2026-10-09' },
        '/c': { mode: 'off' },
        'claude-desktop:': { mode: 'off', since: '2026-10-09' },
        '/d': { mode: 'observer', since: '2026-10-09', note: 'reads only' },
      },
    })
    expect(parseRegistry(text)).toEqual({ '/a': 'paused', '/d': 'observer' })
    expect(parseRegistry('{"version":2,"scopes":{"/a":{"mode":"off","since":"x"}}}')).toEqual({})
    expect(parseRegistry('not json')).toEqual({})
    expect(parseRegistry('{"version":1}')).toEqual({})
  })

  test('the longest ancestor governs, segment-aware; two keys for one folder go to the more restrictive', () => {
    const e = (key: string, mode: 'on' | 'observer' | 'off' | 'paused') => ({ key, canonical: key, mode })
    const list = [e('/work', 'paused'), e('/work/project', 'on'), e('/work/pro', 'off')]
    expect(lookup(list, '/work/project/sub')).toEqual({ mode: 'on', matched: '/work/project', canonical: '/work/project' })
    expect(lookup(list, '/work/projects')).toEqual({ mode: 'paused', matched: '/work', canonical: '/work' })
    expect(lookup(list, '/elsewhere')).toEqual({ mode: 'unset', matched: null, canonical: null })
    expect(lookup([e('/x', 'on'), { key: '/x/.', canonical: '/x', mode: 'paused' }], '/x').mode).toBe('paused')
    expect(under('/a/b', '/a/bc')).toBe(false)
  })

  test('which configuration a wired hook names: its own --config after the hook, in every shape an install writes', () => {
    expect(hookConfig('"bun" run "/p/src/adapters/claude-code/bin/hook.ts"')).toBeNull()
    expect(hookConfig('"bun" run "/p/src/adapters/claude-code/bin/hook.ts" --config "/c/claude-code.json"')).toBe('/c/claude-code.json')
    expect(hookConfig('"bun" --no-env-file "--config=/p/src/adapters/empty-bunfig.toml" run "/p/src/adapters/claude-code/bin/hook.ts"')).toBeNull()
    expect(
      hookConfig('"bun" --no-env-file "--config=/p/empty-bunfig.toml" run "/p/src/adapters/claude-code/bin/hook.ts" --config=/c/x.json'),
    ).toBe('/c/x.json')
    expect(hookConfig('"/opt/bin/counterparts" hook --config "/c/y.json"')).toBe('/c/y.json')
    expect(hookConfig('"/opt/bin/counterparts" hook')).toBeNull()
    expect(hookConfig('"/opt/bin/counterparts" dashboard')).toBeUndefined()
    expect(hookConfig('node --import /p/node-hooks.mjs /p/src/adapters/claude-code/bin/hook.ts')).toBeNull()
    expect(hookConfig('"bun" run "/p/other.ts" --config /c/z.json')).toBeUndefined()
    expect(hookConfig('bun run /p/src/adapters/claude-code/bin/hook.ts && echo hi')).toBeUndefined()
    const settings = (command: string) => JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }], SessionStart: [{ hooks: [{ command }] }] } })
    expect(settingsHookConfig(settings('"bun" run "/p/src/adapters/claude-code/bin/hook.ts" --config "/c/w.json"'))).toBe('/c/w.json')
    expect(settingsHookConfig(settings('"bun" run "/p/src/adapters/claude-code/bin/hook.ts"'))).toBeNull()
    expect(settingsHookConfig(settings('echo nothing of ours'))).toBeUndefined()
    expect(settingsHookConfig('{')).toBeUndefined()
    expect(parentOf('/c/claude-code.json')).toBe('/c')
    expect(parentOf('/claude-code.json')).toBe('/')
  })
})

// ── the body, laid out (the round-3 mockups, 32 text columns) ───────────────

const W = 32
const counts = { salience: 30, emotional: 18, decay: 4, interference: 11, retrieval: 92, association: 22, prospective: 0, consolidation: 4, dreaming: 1, reconsolidation: 10, 'episodic-semantic': 1, schema: null }
const BASE: BodyState = {
  w: W,
  rows: 80,
  now: T0,
  mind: {
    turn: 6,
    at: new Date(2026, 9, 9, 10, 25).getTime(),
    surfaced: [{ id: 'mem_a', title: 'the100 restyle PR #718 behind ?restyle=1, in visual + code review' }],
    footnotes: [
      { id: 'mem_b', title: 'Builder + visual-verifier loop worked on the100 restyle (2026-10-09)' },
      { id: 'mem_c', title: 'the100 wave 2 PRs in fix rounds overnight 2026-10-09', opened: true },
    ],
  },
  saved: [
    { key: 's1', id: 'mem_s1', title: "Mike: use default auto-memory the way a regular user's Claude would, for later on/off comparisons", at: T0, replaces: "Auto-memory MEMORY.md for pwntastic: how it's been used", replacesId: 'mem_r', kind: 'update' },
    { key: 's2', id: 'mem_s2', title: 'Classifier refused a second prod read on 2026-10-10 morning; waiting on Mike', at: T0 - 1, replaces: null, replacesId: null, kind: 'new' },
  ],
  today: { date: '2026-10-09', counts, source: 'dashboard' },
  dream: { id: 'drm_x', at: new Date(2026, 9, 9, 8, 15).getTime(), date: '2026-10-09', first: 'I dreamed the friday evening over again, and the pieces kept lining up.', rest: 'The interpretability paper had a model.', changed: ['merged 3 near-copies into one', '4 memories faded'] },
  open: null,
  mech: null,
  focus: null,
  dash: 'up',
  search: { query: '', status: 'idle', header: '', total: 0, hits: [], error: null },
}

describe('the body, laid out', () => {
  test('a heading: label, a faint rule, the time or count at the right edge; folded, `›`', () => {
    expect(textOf([heading('Memories', '10:25', W)])).toEqual(['Memories ' + '─'.repeat(32 - 9 - 6) + ' 10:25'])
    expect(textOf([heading('Subconscious', '', W)])).toEqual(['Subconscious ' + '─'.repeat(19)])
    expect(textOf([heading('Saved this session', '4', W, { folded: true })])).toEqual(['Saved this session ' + '─'.repeat(9) + ' 4 ›'])
    for (const l of textOf([heading('Mechanisms today', 'times fired', W)])) expect(cells(l)).toBe(W)
  })

  test('wrap past its last line ends at a word with `…`; the first line may be narrower; a clip uses the line to its last cell', () => {
    expect(wrapN('the100 restyle PR #718 behind ?restyle=1, in visual + code review', 32, 3)).toEqual(['the100 restyle PR #718 behind', '?restyle=1, in visual + code', 'review'])
    expect(wrapN("Mike: use default auto-memory the way a regular user's Claude would", 32, 2)).toEqual(['Mike: use default auto-memory', "the way a regular user's Claude…"])
    expect(wrapN('one two three four five six', 10, 99, 7)).toEqual(['one two', 'three four', 'five six'])
    expect(clip('Builder + visual-verifier loop worked on the100', 32)).toBe('Builder + visual-verifier loop…')
    expect(clip('short', 32)).toBe('short')
    expect(cells(clip('記憶記憶記憶記憶記憶記憶記憶記憶記憶', 12))).toBeLessThanOrEqual(12)
  })

  test('half-height bars in half-cell steps, at least one half', () => {
    expect(bar(92, 92, 12)).toBe('▄'.repeat(12))
    expect(bar(1, 92, 12)).toBe('▖')
    expect(bar(46, 92, 12)).toBe('▄▄▄▄▄▄')
  })

  test('the five sections in order, a blank row between; no line over the width, and no line starts with a bullet, a gutter or an indent but a saved item’s dot', () => {
    const lines = textOf(layoutBody(BASE).lines)
    const heads = lines.filter(l => /^[A-Z][A-Za-z ]+ ─/.test(l)).map(l => l.split(' ─')[0])
    expect(heads).toEqual(['Memories', 'Subconscious', 'Saved this session', 'Mechanisms today', 'Last Dream'])
    expect(lines.slice(0, 4)).toEqual([
      'Memories ' + '─'.repeat(17) + ' 10:25',
      'the100 restyle PR #718 behind',
      '?restyle=1, in visual + code',
      'review',
    ])
    expect(lines).toContain('Subconscious ' + '─'.repeat(19)) // the time is on Memories
    expect(lines).toContain('Builder + visual-verifier loop…')
    expect(lines).toContain('the100 wave 2 PRs in… ↗ opened')
    const s = lines.findIndex(l => l.startsWith('Saved this session'))
    expect(lines.slice(s + 1, s + 6)).toEqual([
      '● Mike: use default auto-memory',
      "the way a regular user's Claude…",
      'replaces Auto-memory MEMORY.md…', // a stub of a word is dropped, as the mockups do
      '● Classifier refused a second',
      'prod read on 2026-10-10 morning…',
    ])
    expect(lines).toContain('Schemas         ○ not built yet')
    expect(lines.find(l => l.startsWith('Prospective'))).toMatch(/^Prospective\s+0$/)
    const d = lines.findIndex(l => l.startsWith('Last Dream'))
    expect(lines[d]).toBe('Last Dream ' + '─'.repeat(16) + ' 8:15')
    expect(lines.slice(d + 1)).toEqual(['I dreamed the friday evening', 'over again, and the pieces kept', 'lining up.'])
    for (const l of lines) {
      expect(cells(l)).toBeLessThanOrEqual(W)
      expect(/^\s+\S/.test(l)).toBe(false)
      expect(/^[·•│▏◐▎]/.test(l)).toBe(false)
    }
    expect(lines.join('\n')).not.toMatch(/\+\d+ more|earlier:|nothing in full|reminded of|saw the titles|on the dashboard/)
  })

  test('nothing said in full: no Memories section, the time on Subconscious; nothing saved: no Saved section', () => {
    const lines = textOf(layoutBody({ ...BASE, mind: { ...BASE.mind!, surfaced: [] }, saved: [] }).lines)
    expect(lines[0]).toBe('Subconscious ' + '─'.repeat(13) + ' 10:25')
    expect(lines.some(l => l.startsWith('Memories') || l.startsWith('Saved'))).toBe(false)
  })

  test('folding to fit: saved items fewer, one at a time, each keeping its two lines, then their heading; the dream shortens; a folded section keeps its heading and count', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...BASE.saved[1]!, key: `k${String(i)}`, title: `Saved item ${String(i)} with a title long enough to wrap twice over` }))
    expect(layoutBody({ ...BASE, saved: many, rows: 60 }).folds).toEqual([])
    const tall = layoutBody({ ...BASE, saved: many, rows: 40 })
    expect(tall.folds).toEqual(['saved shows 5'])
    // never one line each, cut: every item shown keeps its words (two lines here), its dot on the first only
    const t = textOf(tall.lines)
    const s0 = t.findIndex(l => l.startsWith('Saved this session'))
    expect(t.slice(s0 + 1, s0 + 11)).toEqual(Array.from({ length: 5 }, (_, i) => [`● Saved item ${String(i)} with a title long`, 'enough to wrap twice over']).flat())
    expect(t.some(l => l.startsWith('● ') && l.endsWith('…'))).toBe(false)
    // two rows fewer take one item away, its two lines, rather than a line from each
    expect(layoutBody({ ...BASE, saved: many, rows: 38 }).folds).toEqual(['saved shows 4'])
    const short = layoutBody({ ...BASE, saved: many, rows: 29 })
    const lines = textOf(short.lines)
    expect(lines.length).toBeLessThanOrEqual(29)
    expect(lines.find(l => l.startsWith('Saved this session'))).toBe('Saved this session ' + '─'.repeat(9) + ' 9 ›')
    expect(short.folds).toContain('saved folded')
    // a section clicked open from its folded heading stays open; another folds instead
    const kept = textOf(layoutBody({ ...BASE, saved: many, rows: 29, focus: 'saved' }).lines)
    expect(kept.filter(l => l.startsWith('● Saved item')).length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThanOrEqual(29)
    // an opened saved item is never folded away
    const open = textOf(layoutBody({ ...BASE, saved: many, rows: 40, open: { key: 'saved:k8', status: 'ready', title: 'The ninth, opened', text: 'Its own words.', meta: 'fact · learned Oct 9', at: T0 } }).lines)
    expect(open).toContain('● The ninth, opened')
    expect(open).toContain('fact · learned Oct 9')
  })

  test('an opened dream keeps its words while the saved list goes down to two; then its excerpt shortens', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...BASE.saved[1]!, key: `k${String(i)}`, title: `Saved item ${String(i)} with a title long enough to wrap twice over` }))
    const dream = { ...BASE.dream!, rest: 'The interpretability paper had a model that writes its reasoning toward whatever answer the hint gives it. Mike said he weighs his words because I lean toward agreeing, and more after that.' }
    const open = { key: 'dream', status: 'ready' as const, title: null, text: '', meta: null, at: T0 }
    const roomy = layoutBody({ ...BASE, saved: many, dream, open, rows: 36 })
    expect(roomy.folds).toEqual(['chart folded', 'saved shows 5'])
    expect(textOf(roomy.lines).join(' ')).toContain('more after that.')
    const tight = layoutBody({ ...BASE, saved: many, dream, open, rows: 28 })
    expect(tight.folds).toEqual(['chart folded', 'saved shows 2', 'dream excerpt 7 lines'])
  })

  test('an opened mechanism lists its firings grouped under what and when; an opened dream adds what changed', () => {
    const mech = { id: 'decay' as const, status: 'ready' as const, at: T0, events: [
      { seq: 3, at: new Date(2026, 9, 9, 8, 7).getTime(), word: 'faded', title: 'Writer and reflection are different jobs; both write the page', memoryId: 'mem_1', text: '' },
      { seq: 2, at: new Date(2026, 9, 9, 8, 7).getTime(), word: 'faded', title: 'Tiny Castles run 4 counterpart playtest: top findings', memoryId: 'mem_2', text: '' },
    ] }
    const lines = textOf(layoutBody({ ...BASE, mech }).lines)
    const f = lines.findIndex(l => l.startsWith('Forgetting'))
    // each firing's title on up to two lines, back at the left edge
    expect(lines.slice(f + 1, f + 6)).toEqual(['faded at 8:07:', 'Writer and reflection are', 'different jobs; both write the…', 'Tiny Castles run 4 counterpart', 'playtest: top findings'])
    // a wrapped line a shade softer than a firing's first: no bullet says where one ends
    const ev = layoutBody({ ...BASE, mech }).lines
    const first = ev.findIndex(l => l.segs[0]?.t === 'Writer and reflection are')
    expect(ev[first]?.segs[0]?.c).not.toBe(ev[first + 1]?.segs[0]?.c)
    const dream = textOf(layoutBody({ ...BASE, open: { key: 'dream', status: 'ready', title: null, text: '', meta: null, at: T0 } }).lines)
    const w = dream.indexOf('what changed last night:')
    expect(dream.slice(w + 1, w + 3)).toEqual(['merged 3 near-copies into one', '4 memories faded'])
    expect(dream.join(' ')).toContain('The interpretability paper')
  })

  test('the expand threshold: a text of 12 lines or fewer opens in place', () => {
    expect(EXPAND_MAX_LINES).toBe(12)
    expect(openedLines('', W)).toBe(0)
    expect(openedLines('a short memory', W)).toBe(1)
    expect(openedLines(Array.from({ length: 80 }, () => 'word').join(' '), W)).toBeGreaterThan(12)
  })

  test('a dream whose journal row was not found: no made-up time today, its date before today', () => {
    const today = textOf(layoutBody({ ...BASE, dream: { ...BASE.dream!, at: null, date: '2026-10-09' } }).lines)
    expect(today.find(l => l.startsWith('Last Dream'))).toBe('Last Dream ' + '─'.repeat(21))
    const before = textOf(layoutBody({ ...BASE, dream: { ...BASE.dream!, at: null, date: '2026-10-07' } }).lines)
    expect(before.find(l => l.startsWith('Last Dream'))).toBe('Last Dream ' + '─'.repeat(15) + ' Oct 7')
  })

  test('the dashboard down: the chart says how to start it', () => {
    const lines = textOf(layoutBody({ ...BASE, today: null, dash: 'down' }).lines)
    expect(lines.join(' ')).toContain('counterparts dashboard')
  })

  test('search results take the sections’ place: the query, how many, each title and what it is', () => {
    const lines = textOf(layoutBody({ ...BASE, search: { query: 'publish', status: 'done', header: '', total: 2, hits: parseFacts(FACTS_ANSWER).hits, error: null } }).lines)
    expect(lines[0]).toBe('“publish” ' + '─'.repeat(12) + ' 2 found ✕')
    expect(lines.slice(1, 4)).toEqual(['Publishing waits for a test and', 'a review', 'memory · Oct 9 · you said it'])
  })
})

describe('the small brain', () => {
  test('dim at rest; a region flashed (the still brain) lights in its stage colour and goes dark again', () => {
    const brain = new Brain()
    brain.hold(true)
    const max = (c: Uint32Array): number => {
      let m = 0
      for (let i = 1; i < c.length; i += 3) {
        const v = c[i] ?? 0
        if (v === DEFAULT_COLOR) continue
        m = Math.max(m, (v >> 16) & 255, (v >> 8) & 255, v & 255)
      }
      return m
    }
    const full = max(new Brain().frame(18, 6, T0))
    const dim = encodeCells(brain.frame(18, 6, T0, { dimRest: 0.72 }))
    expect(max(decodeCells(dim))).toBeLessThan(full)
    brain.flash('brainstem', STAGES.storage.col)
    const lit = encodeCells(brain.frame(18, 6, T0, { dimRest: 0.72 }))
    expect(lit).not.toBe(dim)
    brain.dark()
    expect(encodeCells(brain.frame(18, 6, T0, { dimRest: 0.72 }))).toBe(dim)
  })
})
