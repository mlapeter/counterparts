/**
 * The pure parts, without the engine: the brain's cells, the cell encoding,
 * the feed's reading of the dashboard, the recall block and a facts answer.
 */
import { describe, expect, test } from 'claude-code/testing'

import { Brain, DEFAULT_COLOR } from '../hooks/brain'
import { decodeCells, encodeCells, isRasterSafe } from '../hooks/cells'
import { classify, clock, keptRow, mergeRows, parseFacts, parseRecallBlock, resolveServer, wrap } from '../hooks/feed'
import { MECHS, STAGES } from '../hooks/mechanisms'
import { EVENTS, FACTS_ANSWER, RECALL_BLOCK, SESSION, T0 } from './world'

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

  test('the hologram glows by cell background; paused, it is grey and has none', () => {
    const brain = new Brain()
    const live = brain.frame(42, 14, T0)
    let glow = 0
    for (let i = 2; i < live.length; i += 3) if (live[i] !== DEFAULT_COLOR) glow += 1
    expect(glow).toBeGreaterThan(50)
    const grey = new Brain().frame(42, 14, T0, { mono: true })
    for (let i = 0; i < grey.length; i += 3) {
      expect(grey[i + 2]).toBe(DEFAULT_COLOR)
      const fg = grey[i + 1] ?? 0
      if ((grey[i] ?? 0) === 0x20) continue
      const r = (fg >> 16) & 255, g = (fg >> 8) & 255, b = fg & 255
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40)
    }
  })

  test('it turns: two frames apart in time differ', () => {
    const brain = new Brain()
    const a = encodeCells(brain.frame(42, 14, T0))
    brain.step(T0 + 2000, 2000)
    const b = encodeCells(brain.frame(42, 14, T0 + 2000))
    expect(a === b).toBe(false)
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
    expect(rows[0]).toMatchObject({ mech: 'salience', word: 'kept', text: 'The sidebar draws the brain in braille', who: 'here', line: 'kept · The sidebar draws the brain in braille', keys: ['mem:mem_aaaa1111'] })
    expect(rows[1]).toMatchObject({ mech: 'retrieval', word: 'recalled', text: '2 came to mind', who: 'here', more: ['· Release notes go out on Fridays', '· Publishing waits for a review'] })
    expect(rows[2]).toMatchObject({ mech: 'retrieval', who: 'other', keys: ['turn:sess-older:7'] })
    expect(rows[3]).toBeNull() // a quiet turn
    expect(rows[4]).toMatchObject({ mech: 'dreaming', word: 'dreamed', who: 'night' })
    expect(rows[5]).toBeNull() // a sleep check that faded nothing
    expect(classify(EVENTS[0]!, 'another-session')?.who).toBe('other')
    // a contradiction a session settled is that session's, not the night's
    const settled = (actorId: string) => ({ seq: 1, at: T0, name: 'contradiction.settled', text: 'A session settled a contradiction.', detail: [{ key: 'actor', value: 'session' }, { key: 'actorId', value: actorId }] })
    expect(classify(settled(SESSION), SESSION)?.who).toBe('here')
    expect(classify(settled('sess-else'), SESSION)?.who).toBe('other')
    expect(classify({ ...settled('x'), detail: [{ key: 'actor', value: 'dream' }] }, SESSION)?.who).toBe('night')
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
      surfaced: ['The sidebar slides to a rail of dots'],
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

  test('kept: note, chapter and session_end under either server name; a refused note is not kept', () => {
    const note = keptRow('mcp__counterparts__note', { title: 'Sidebar shipped', text: 'long' }, '{"stored":true,"id":"mem_new00001"}', T0, 1)
    expect(note).toMatchObject({ word: 'kept', text: 'Sidebar shipped', line: 'kept · Sidebar shipped', who: 'here', keys: ['mem:mem_new00001'], live: true })
    expect(keptRow('mcp__plugin_counterparts_counterparts__chapter', { title: 'Day 18' }, '{}', T0, 2)?.text).toBe('a chapter: Day 18')
    expect(keptRow('mcp__counterparts__session_end', { memories: [{ text: 'a' }, { text: 'b' }] }, '{"deposited":2}', T0, 3)?.text).toBe('2 memories from this session')
    expect(keptRow('mcp__counterparts__note', { text: 'x' }, '{"stored":false,"reason":"duplicate"}', T0, 4)).toBeNull()
    expect(keptRow('mcp__counterparts__recall', { question: 'x' }, '{}', T0, 5)).toBeNull()
    expect(keptRow('mcp__other__note', { text: 'x' }, '{}', T0, 6)).toBeNull()
  })

  test('a live row hides its dashboard twin; newest first', () => {
    const dash = classify(EVENTS[0]!, SESSION)!
    const live = keptRow('mcp__counterparts__note', { title: 'Same memory' }, '{"stored":true,"id":"mem_aaaa1111"}', T0 - 9 * 60000, 1)!
    const merged = mergeRows([dash, live, classify(EVENTS[4]!, SESSION)!], 10)
    expect(merged.map(r => r.id)).toEqual([live.id, 'seq:400'])
  })

  test('the memory server: the npm install’s first, then the plugin’s', () => {
    expect(resolveServer(['mcp__plugin_counterparts_counterparts__recall', 'mcp__counterparts__recall'])).toBe('counterparts')
    expect(resolveServer(['mcp__plugin_counterparts_counterparts__recall'])).toBe('plugin_counterparts_counterparts')
    expect(resolveServer(['mcp__other__recall'])).toBeNull()
  })

  test('local time like 1:35pm today, a date before today', () => {
    expect(clock(T0, T0)).toBe('1:35pm')
    expect(clock(new Date(2026, 9, 9, 0, 5).getTime(), T0)).toBe('12:05am')
    expect(clock(new Date(2026, 9, 8, 22, 0).getTime(), T0)).toBe('Oct 8')
  })

  test('wrap keeps words whole and cuts only a word longer than the line', () => {
    expect(wrap('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps'])
    expect(wrap('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
  })
})
