/**
 * The pure parts, without the engine: the brain's cells, the cell encoding,
 * the feed's reading of the dashboard, the recall block and a facts answer.
 */
import { describe, expect, test } from 'claude-code/testing'

import { Brain, DEFAULT_COLOR } from '../hooks/brain'
import { decodeCells, encodeCells, isRasterSafe } from '../hooks/cells'
import { alsoLine, cameRow, classify, clock, keptRow, mergeRows, parseFacts, parseRecallBlock, resolveServer, shortDir, wrap } from '../hooks/feed'
import { cells, ellipsizeCells, padCells } from '../hooks/width'
import { hookConfig, lookup, parentOf, parseRegistry, settingsHookConfig, under } from '../hooks/scopes'
import { MECHS, STAGES } from '../hooks/mechanisms'
import { EVENTS, FACTS_ANSWER, RECALL_BLOCK, SESSION, T0, ev } from './world'

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
    expect(rows[0]).toMatchObject({ mech: 'salience', word: 'kept', text: 'The sidebar draws the brain in braille', who: 'here', line: 'kept · The sidebar draws the brain in braille', keys: ['mem:mem_aaaa1111'] })
    expect(rows[1]).toMatchObject({ mech: 'retrieval', word: 'recalled', text: '2 came to mind', who: 'here', more: ['· Release notes go out on Fridays', '· Publishing waits for a review'] })
    expect(rows[2]).toMatchObject({ mech: 'retrieval', who: 'other', keys: ['turn:sess-older:7'] })
    expect(rows[3]).toBeNull() // a quiet turn
    expect(rows[4]).toMatchObject({ mech: 'dreaming', mechs: ['dreaming'], word: 'dreamed', who: 'night' })
    expect(rows[5]).toBeNull() // a sleep check that faded nothing
    expect(rows[0]?.mechs).toEqual(['salience'])
    expect(rows[1]?.mechs).toEqual(['retrieval'])
    expect(classify(EVENTS[0]!, 'another-session')?.who).toBe('other')
    // a contradiction a session settled is that session's, not the night's
    const settled = (actorId: string) => ({ seq: 1, at: T0, name: 'contradiction.settled', text: 'A session settled a contradiction.', detail: [{ key: 'actor', value: 'session' }, { key: 'actorId', value: actorId }] })
    expect(classify(settled(SESSION), SESSION)?.who).toBe('here')
    expect(classify(settled('sess-else'), SESSION)?.who).toBe('other')
    expect(classify({ ...settled('x'), detail: [{ key: 'actor', value: 'dream' }] }, SESSION)?.who).toBe('night')
  })

  test('one event, every mechanism it proves: one row, its own word and colour, the rest in `mechs` and in an opened row’s “also” line', () => {
    // a mood-matched recall (2026-10-10 live: 7 of the last 40 turns): Retrieval's row, Emotion lit too
    const mood = ev(501, 'recall.decision', 'On turn 4 I kept “Choosing the cores” as a footnote.', 1, {
      session: SESSION, turn: '4', surfacedCount: '0', footnoteCount: '2', moodMatched: '1',
    })
    const recalled = classify(mood, SESSION)!
    expect(recalled).toMatchObject({ mech: 'retrieval', mechs: ['retrieval', 'emotional'], word: 'recalled', text: '2 came to mind', who: 'here' })
    expect(alsoLine(recalled)).toBe('also Emotion')
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
    expect(alsoLine(dreamed)).toBe('also Gist · Interference · Consolidation')
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

  test('a live came-to-mind row takes on the mechanisms its dashboard twin proves (the block says nothing of mood)', () => {
    const live = cameRow({ turn: 4, surfaced: ['The cores'], footnotes: [] }, SESSION, T0)!
    expect(live.mechs).toEqual(['retrieval'])
    const twin = classify(ev(511, 'recall.decision', 'On turn 4 I said “The cores” out loud.', 0, {
      session: SESSION, turn: '4', surfacedCount: '1', footnoteCount: '0', moodMatched: '1',
    }), SESSION)!
    const merged = mergeRows([twin, live], 10)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: live.id, mech: 'retrieval', mechs: ['retrieval', 'emotional'], text: '1 came to mind' })
    // without a twin, a live row is left as it was
    expect(mergeRows([live], 10)[0]).toBe(live)
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
