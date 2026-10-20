/**
 * The pure parts, without the engine: the cell encoding, the feed's reading
 * of the dashboard, the recall block, the footer's words, and the fox.
 */
import { describe, expect, test } from 'claude-code/testing'

import { decodeCells, encodeCells, isRasterSafe } from '../hooks/cells'
import {
  UNKNOWN_ONBOARDING,
  classify,
  countToday,
  dateOf,
  decisionFor,
  firstSentence,
  hm,
  firingIds,
  firingTitle,
  humanDates,
  mechFirings,
  openedIds,
  parseOnboarding,
  parseOnboardingMarker,
  parseRecallBlock,
  savedItems,
  savedSince,
  shortDir,
  surfacedIds,
  wrap,
  otherStore,
  parseStoreMarker,
} from '../hooks/feed'
import { foxSvg } from '../hooks/fox-svg'
import { cells, ellipsizeCells, padCells } from '../hooks/width'
import { headRight } from '../hooks/desktop'
import { parseGlance } from '../hooks/feed'
import { leadDate } from '../hooks/sections'
import { FOOTER_ITEMS, footerLines, normAvatar, resumeWords, statusFor } from '../hooks/words'
import {
  BUSY_MAX_MS,
  NOTE_SPAN_MS,
  STAGE_COLS,
  TEXT_256,
  WORK,
  advance,
  fineCell,
  fineCells,
  halfCells,
  momentSteps,
  newDirector,
  normDetail,
  pickTier,
  PNG_FRAMES,
  pngName,
  runs,
  sextantBits,
  sextantGlyph,
  stageRows,
  stepKey,
  textHex,
  trigger,
} from '../hooks/fox'
import { FOX_FINAL } from '../hooks/fox-art'
import { hookConfig, lookup, parentOf, parseRegistry, settingsHookConfig, under } from '../hooks/scopes'
import { MECHS } from '../hooks/mechanisms'
import { MORE, OPEN_MAX_LINES, bar, clip, heading, layoutBody, openedLines, textOf, wrapN } from '../hooks/sections'
import { CLASSIC_HINT, CLASSIC_HINT_SHORT, TAIL_HINT, quietTail } from '../hooks/tail'
import { P, applyTheme, cozy, normTheme, tron } from '../hooks/theme'
import type { BodyState } from '../hooks/sections'
import { DECISION_T3, EVENTS, RECALL_BLOCK, SESSION, T0, ev } from './world'

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
    expect(rows[0]).toMatchObject({ mech: 'salience', word: 'kept', text: 'The sidebar draws the brain in braille', who: 'here', twinIds: ['mem:mem_aaaa1111'], memory: { id: 'mem_aaaa1111', title: 'The sidebar draws the brain in braille' } })
    expect(rows[1]).toMatchObject({ mech: 'retrieval', word: 'recalled', text: '2 came to mind', who: 'here', more: ['Release notes go out on Fridays', 'Publishing waits for a review'] })
    expect(rows[2]).toMatchObject({ mech: 'retrieval', who: 'other', twinIds: ['turn:sess-older:7'] })
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
    // a DECLARED settle is Reconsolidation's alone; a confirmed slot (a detected door) is Interference's
    // alone; a dream merge's rows count as the merge (Group 2b, review 10 C6): never under both
    const changed = ev(506, 'contradiction.settled', 'The dream settled a contradiction as changed.', 1, { how: 'changed', actor: 'dream' })
    expect(classify(changed)).toMatchObject({ mech: 'reconsolidation', mechs: ['reconsolidation'], word: 'settled' })
    expect(classify(ev(507, 'contradiction.settled', 'Settled as open.', 1, { how: 'open', actor: 'dream' }))?.mechs).toEqual(['reconsolidation'])
    expect(classify(ev(511, 'contradiction.settled', 'A newer state confirmed.', 1, { how: 'changed', actor: 'dream', source: 'slot' }))).toMatchObject({ mech: 'interference', mechs: ['interference'], word: 'replaced' })
    expect(classify(ev(512, 'contradiction.settled', 'Merged.', 1, { how: 'changed', actor: 'dream', source: 'dream-merge' }))).toBeNull()
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

  test("footnotes with a standing: the lead becomes a word, the id is the memory's own (the last before any trailing pointers), the pointers are dropped", () => {
    const block = (...items: string[]): string =>
      ['<!-- counterparts:recall t=4 -->', '', 'Quietly available (ignorable; expand an id with recall before citing one):', ...items.map(i => `- ${i}`), '<!-- counterparts:recall/end surfaced=0 footnotes=3 affect=0 bytes=1 -->'].join('\n')
    expect(
      parseRecallBlock(
        block(
          'Earlier (now [mem_new00001]): The pane was 40 columns [mem_old00001]',
          'Unsettled \u2014 may be out of date, see [mem_other001]: Releases go out on Fridays [mem_rel00001]',
          'The pane is 35 columns [mem_cur00001] (earlier: [mem_old00002])',
          'The rail is gone [mem_rail0001] (corrects [mem_rail0000])',
          'A title with no id at all',
          'Linked: Earlier (now [mem_new00002]): The fox sat left [mem_fox00001]',
          'Corrected by [mem_fix00001]: Bars were cells [mem_bar00001] (disagrees with [mem_bar00002])',
          'Earlier (now [mem_new00003]); Unsettled \u2014 may be out of date, see [mem_oth00002]: Two leads [mem_two00001]',
          'Journal: A plain chapter [epi_chap0001]',
        ),
      )?.footnotes,
    ).toEqual([
      { title: 'Earlier: The pane was 40 columns', id: 'mem_old00001' },
      { title: 'Unsettled: Releases go out on Fridays', id: 'mem_rel00001' },
      { title: 'The pane is 35 columns', id: 'mem_cur00001' },
      { title: 'The rail is gone', id: 'mem_rail0001' },
      { title: 'A title with no id at all', id: null },
      // the memory's own id is the last one before any trailing pointers, whatever the lead or frame word holds
      { title: 'Linked: Earlier: The fox sat left', id: 'mem_fox00001' },
      { title: 'Corrected: Bars were cells', id: 'mem_bar00001' },
      { title: 'Earlier: Two leads', id: 'mem_two00001' },
      { title: 'Journal: A plain chapter', id: 'epi_chap0001' },
    ])
  })

  test('saved: note, chapter and session_end under either server name; an update names what it replaces; a refused one saves nothing', () => {
    const note = savedItems('mcp__counterparts__note', { title: 'Sidebar shipped', text: 'long' }, '{"stored":true,"id":"mem_new00001"}', T0, 1)
    expect(note).toEqual([{ key: 'live:1:0', id: 'mem_new00001', title: 'Sidebar shipped', at: T0, replaces: null, replacesId: null, kind: 'new', text: 'long' }])
    expect(savedItems('mcp__counterparts__note', { title: 'Newer', updates: 'mem_old00001' }, '{"stored":true,"id":"mem_n2"}', T0, 2)[0]).toMatchObject({ kind: 'update', replacesId: 'mem_old00001' })
    // `how: open` keeps both: no replacement; a held update (looked unrelated) settled nothing
    expect(savedItems('mcp__counterparts__note', { title: 'Beside', updates: 'mem_old00001', how: 'open' }, '{"stored":true}', T0, 3)[0]?.kind).toBe('new')
    expect(savedItems('mcp__counterparts__note', { title: 'Held', updates: 'mem_old00001' }, '{"stored":true,"settled":{"ok":false,"held":true}}', T0, 4)[0]?.kind).toBe('new')
    // a chapter is a journal entry, not a saved memory
    expect(savedItems('mcp__plugin_counterparts_counterparts__chapter', { title: 'Day 18' }, '{}', T0, 5)).toEqual([])
    const end = savedItems('mcp__counterparts__session_end', { memories: [{ title: 'One', text: 'a' }, { text: 'Two, from its text\nsecond line' }, { title: 'Three', updates: 'mem_old00001' }] }, '{"deposited":3}', T0, 6)
    expect(end.map(s => [s.title, s.kind])).toEqual([['One', 'new'], ['Two, from its text', 'new'], ['Three', 'update']])
    expect(savedItems('mcp__counterparts__session_end', { memories: [{ title: 'x' }] }, '{"deposited":0}', T0, 7)).toEqual([])
    expect(savedItems('mcp__counterparts__note', { text: 'x' }, '{"stored":false,"reason":"duplicate"}', T0, 8)).toEqual([])
    // `remember` is the new name (2026-10-10); `note` still answers
    expect(savedItems('mcp__counterparts__remember', { title: 'Renamed door' }, '{"stored":true,"id":"mem_new00002"}', T0, 11)).toEqual([{ key: 'live:11:0', id: 'mem_new00002', title: 'Renamed door', at: T0, replaces: null, replacesId: null, kind: 'new' }])
    expect(savedItems('mcp__counterparts__remember', { title: 'Held', updates: 'mem_old00001' }, '{"stored":true,"settled":{"ok":false,"held":true}}', T0, 12)[0]?.kind).toBe('new')
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

  test('a mechanism’s firings: what each was about, the memories it names, never its counts; a firing that names nothing is left out', () => {
    // a recall: each memory that came to mind or sat in the footnotes, by id, read whole later
    const retrieval = mechFirings([...EVENTS, DECISION_T3], 'retrieval')
    expect(retrieval.map(f => [f.word, firingIds(f), f.memoryId])).toEqual([
      ['came to mind', ['mem_sur00001'], 'mem_sur00001'],
      ['came to mind', ['mem_rel00001'], 'mem_rel00001'],
    ])
    expect(retrieval.map(f => f.key)).toEqual(['497.0', '497.1'])
    // the row's quoted titles stand until the full ones are read
    expect(firingTitle(retrieval[0]!, {})).toBe('The sidebar is 35 columns wide')
    expect(firingTitle(retrieval[0]!, { mem_sur00001: 'The sidebar is 35 columns wide, measured' })).toBe('The sidebar is 35 columns wide, measured')
    // a fade names its memory; a sleep cycle's counts name none
    expect(mechFirings(EVENTS, 'decay').map(f => [f.word, firingTitle(f, {})])).toEqual([['faded', 'An old plan that faded']])
    // a settle: which holds over which; revision pressure: which argued with which
    const settle = ev(500, 'contradiction.settled', 'settled', 1, { how: 'changed', source: 'slot', holds: '"The new rule" [mem_new00001]', over: '"The old rule" [mem_old00001]' }, 'ctr_x')
    expect(mechFirings([settle], 'interference').map(f => [f.word, firingTitle(f, {})])).toEqual([['replaced', 'The new rule holds over The old rule']])
    const pressure = ev(501, 'revision.pressure', 'argued', 1, { targetId: '"Han\'s promise" [mem_tgt00001]', challengerId: '"Han replied" [mem_chl00001]' }, null)
    expect(firingTitle(mechFirings([pressure], 'reconsolidation')[0]!, {})).toBe("Han replied argued with Han's promise")
    // counts only: a look-up, a link flush, a flagged pair
    const counted = [
      ev(502, 'mcp.recall', '4 memories were opened in full, by name.', 1),
      ev(503, 'associate.flush', '2 pairs of memories that were used together got more connected.', 1, { rows: '4', deposited: '2' }),
      ev(504, 'contradiction.flagged', 'A dream flagged two memories that disagree.', 1, {}, 'ctr_y'),
    ]
    expect(mechFirings(counted, 'retrieval')).toEqual([])
    expect(mechFirings(counted, 'association')).toEqual([])
    expect(mechFirings(counted, 'interference')).toEqual([])
    // a dream: its first sentence (Dreaming); its merges and patterns from the dream's own changes
    const dream = {
      id: 'drm_test0001', date: '2026-10-09', day: 18, journal: 'I dreamed the rail became a river. It carried titles.',
      changes: [
        { action: 'merge', said: 'merged 3 near-copies into one', memories: [{ id: 'mem_mrg00001', text: 'Merging needs his go' }, { id: 'mem_mrg00002', text: 'a copy' }] },
        { action: 'gist', said: 'wrote down a pattern', memories: [{ id: 'mem_gst00001', text: 'Dreamed: a pattern' }] },
        { action: 'merge', said: 'merged', undone: true, memories: [{ id: 'mem_und00001', text: 'undone' }] },
      ],
    }
    const changed = ev(402, 'dream.changed', 'In a dream I changed 5 things.', 599, { applied: '5', merge: '1', gist: '1' }, 'drm_test0001')
    expect(mechFirings([...EVENTS, changed], 'dreaming', [dream]).map(f => [f.word, firingTitle(f, {}), f.memoryId, f.text])).toEqual([
      ['dreamed', 'I dreamed the rail became a river.', null, 'I dreamed the rail became a river. It carried titles.'],
    ])
    expect(mechFirings([changed], 'consolidation', [dream]).map(f => firingTitle(f, {}))).toEqual(['Merging needs his go'])
    expect(mechFirings([changed], 'episodic-semantic', [dream]).map(f => firingTitle(f, {}))).toEqual(['Dreamed: a pattern'])
    // a dream not read: nothing to name
    expect(mechFirings([changed], 'consolidation', [])).toEqual([])
    // a memory with no title at all is left out, never shown as an id
    expect(firingTitle({ key: '1.0', seq: 1, at: 0, word: 'kept', parts: [{ id: 'mem_x', title: null }], memoryId: 'mem_x', text: '' }, {})).toBeNull()
  })

  test('dates in titles, at display time: today’s dropped, any other short and human', () => {
    const now = new Date(2026, 9, 10, 15, 0).getTime()
    expect(humanDates('Sidebar shipped (2026-10-10)', now)).toBe('Sidebar shipped')
    expect(humanDates('2026-10-10: the call', now)).toBe('the call')
    expect(humanDates('Writer and reflection (Mike, 2026-10-10)', now)).toBe('Writer and reflection (Mike)')
    expect(humanDates('A second prod read on 2026-10-10 morning', now)).toBe('A second prod read this morning')
    expect(humanDates('Telling a dream (agreed 2026-09-27, held lightly)', now)).toBe('Telling a dream (agreed Sep 27, held lightly)')
    expect(humanDates('An old thing 2025-01-05', now)).toBe('An old thing Jan 5 2025')
    expect(hm(new Date(2025, 0, 5, 9, 0).getTime(), now)).toBe('Jan 5 2025')
  })

  test('short dates in titles (10-09) read the same way, as this year’s; numbers that are not dates are left alone', () => {
    const now = new Date(2026, 9, 10, 15, 0).getTime()
    // dates: each spelling the live titles use
    expect(humanDates('Han (10-09)', now)).toBe('Han (Oct 9)')
    expect(humanDates('10-09: the wake review', now)).toBe('Oct 9: the wake review')
    expect(humanDates('Wake fix landed 10-09', now)).toBe('Wake fix landed Oct 9')
    expect(humanDates('Coordinator day 10-09, wave 1', now)).toBe('Coordinator day Oct 9, wave 1')
    expect(humanDates('Mike parked it (Mike, 09-30)', now)).toBe('Mike parked it (Mike, Sep 30)')
    expect(humanDates('Release day 12-31.', now)).toBe('Release day Dec 31.')
    // today's, dropped as an ISO today is
    expect(humanDates('Sidebar shipped (10-10)', now)).toBe('Sidebar shipped')
    expect(humanDates('10-10: the call', now)).toBe('the call')
    expect(humanDates('Writer and reflection (Mike, 10-10)', now)).toBe('Writer and reflection (Mike)')
    // not dates: left as written
    for (const t of [
      'Era PR (#377) gap',
      'PR #10-09 merged',
      'counterparts 0.3.16 published',
      'v0.10-12 notes',
      'v10-09 build',
      'met at 10:09',
      'checked 10:09-10:30',
      'a span 10-09:30 long',
      'ISO 2026-10-09 stays ISO-shaped only once',
      '10-09-2026 written the other way',
      'a 10-20 lines cap',
      '10-12 cells wide',
      'about 10-20% faster',
      'impossible 13-09 and 02-30',
      'rows 10-099 and 100-09',
      'id mem_10-09a',
      'see ~/notes/10-09.md',
    ]) {
      expect(humanDates(t, now)).toBe(t.startsWith('ISO') ? 'ISO Oct 9 stays ISO-shaped only once' : t)
    }
  })

  test('the quiet tail always ends with how to open the sidebar; the newest thing is shortened to keep it whole', () => {
    const tail = quietTail('stored: Mike likes ponies (2026-10-09)', 80, T0)
    expect(tail).toBe('stored: Mike likes ponies · /counterparts opens it')
    const long = quietTail(`remembered: ${'a long title '.repeat(10)}`, 60, T0)
    expect(long.endsWith(' · /counterparts opens it')).toBe(true)
    expect(cells(long)).toBeLessThanOrEqual(60)
    expect(quietTail('stored: x', 20, T0)).toBe('/counterparts opens it')
    expect(quietTail(null, 80, T0)).toBe('Watching quietly · nothing new yet · /counterparts opens it')
    expect(quietTail('stored: x', null, T0)).toBe('stored: x · /counterparts opens it')
  })

  test('the tail: a title, then as much of its words as fit, cut at a word; the classic screen points at /tui fullscreen', () => {
    const body = 'Mike plays pickup basketball on Tuesday nights and hikes most weekends'
    const end = ' · /counterparts opens it'
    expect(quietTail('Stored “Pets”', 100, T0, 'Mike likes ponies', undefined)).toBe(`Stored “Pets” — Mike likes ponies${end}`)
    const cut = quietTail('Stored “Pets”', 60, T0, body)
    expect(cut).toBe(`Stored “Pets” — Mike plays pickup…${end}`)
    expect(cells(cut)).toBeLessThanOrEqual(60)
    // no room for a few words: the title alone; a clipped title takes no body
    expect(quietTail('Stored “Pets”', 44, T0, body)).toBe(`Stored “Pets”${end}`)
    expect(quietTail(`Stored “${'long title '.repeat(10)}”`, 60, T0, body).includes(' — ')).toBe(false)
    expect(quietTail('Stored “Pets”', 100, T0, 'Mike likes ponies', CLASSIC_HINT)).toBe('Stored “Pets” — Mike likes ponies · /tui fullscreen shows the memory sidebar')
    expect(quietTail(null, 80, T0, undefined, CLASSIC_HINT)).toBe('Watching quietly · nothing new yet · /tui fullscreen shows the memory sidebar')
    // never wider than the room the engine leaves (cols less its hint prop less 32), at 80, 100 and 120 columns, either hint, any body
    const bodies = [undefined, 'x', 'a'.repeat(200), 'supercalifragilistic '.repeat(20), '日本語のテキストです。'.repeat(20), '😀 emoji 🎉 party '.repeat(15)]
    for (const cols of [80, 100, 120]) for (const hint of [TAIL_HINT, CLASSIC_HINT]) for (const l of ['Stored “Pets”', 'Stored “日本語のタイトル”', `Stored “${'long title '.repeat(10)}”`, null]) for (const b of bodies) {
      const room = cols - 15 - 32
      expect(cells(quietTail(l, room, T0, b, hint))).toBeLessThanOrEqual(room)
    }
    expect(quietTail(null, 33, T0, undefined, CLASSIC_HINT)).toBe(CLASSIC_HINT_SHORT)
  })

  test('a dream: its first sentence and the rest', () => {
    expect(firstSentence('I dreamed the friday evening over again, and the pieces kept lining up. The paper had a model.')).toEqual({
      first: 'I dreamed the friday evening over again, and the pieces kept lining up.',
      rest: 'The paper had a model.',
    })
    expect(firstSentence('No full stop at all')).toEqual({ first: 'No full stop at all', rest: '' })
    expect(firstSentence('“Who said it?” I asked. Then.')).toEqual({ first: '“Who said it?”', rest: 'I asked. Then.' })
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
    // rows, blocked, evicted, swept, dropped, pendingDropped, corrupt, stuck, oldestMs, a
    // `contiguity` object whose `sessions` is a count, and since 2026-10-11 `deposited`, the
    // links laid), so it is placed by time like the others.
    const flush = (minutesAgo: number) => ({
      seq: 11, at: at(minutesAgo), name: 'associate.flush', text: '2 pairs got more connected.',
      detail: [{ key: 'reason', value: 'flushed' }, { key: 'rows', value: '4' }, { key: 'deposited', value: '2' }, { key: 'contiguity', value: '{"reason":"buffered","sessions":1}' }],
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
  dream: { id: 'drm_x', at: new Date(2026, 9, 9, 8, 15).getTime(), date: '2026-10-09', first: 'I dreamed the friday evening over again, and the pieces kept lining up.', rest: 'The interpretability paper had a model.' },
  open: null,
  mech: null,
  focus: null,
  dash: 'up',
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

  test('half-height bars in half-cell steps, at least one half, on a log scale: 1, 10 and 100 are even steps', () => {
    expect(bar(92, 92, 12)).toBe('▄'.repeat(12))
    expect(bar(1, 92, 12)).toBe('▄▄')
    expect(bar(46, 92, 12)).toBe('▄'.repeat(10))
    expect(bar(0, 92, 12)).toBe('▖')
    const len = (v: number) => [...bar(v, 999, 30)].length
    expect(len(10) - len(1)).toBeGreaterThan(5)
    expect(Math.abs(len(100) - len(10) - (len(10) - len(1)))).toBeLessThanOrEqual(3)
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
    // the time is on Memories; each footnote on up to three lines, today's date dropped from its title
    const sub = lines.indexOf('Subconscious ' + '─'.repeat(19))
    expect(lines.slice(sub + 1, sub + 5)).toEqual(['Builder + visual-verifier loop', 'worked on the100 restyle', 'the100 wave 2 PRs in fix rounds', 'overnight today ↗ opened'])
    const s = lines.findIndex(l => l.startsWith('Saved this session'))
    expect(lines.slice(s + 1, s + 7)).toEqual([
      '● Mike: use default auto-memory',
      "the way a regular user's Claude",
      'would, for later on/off…', // three lines at most
      '● Classifier refused a second',
      'prod read on Oct 10 morning;', // another day's date, short
      'waiting on Mike',
    ])
    expect(lines.join(' ')).not.toContain('replaces') // only when opened
    expect(lines.some(l => l.startsWith('Schemas'))).toBe(false) // not built: not drawn
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

  test('folding to fit: saved items fewer, one at a time, each keeping its lines, then their heading; the dream shortens; a folded section keeps its heading and count', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...BASE.saved[1]!, key: `k${String(i)}`, title: `Saved item ${String(i)} with a title long enough to wrap twice over` }))
    expect(layoutBody({ ...BASE, saved: many, rows: 64 }).folds).toEqual([])
    const tall = layoutBody({ ...BASE, saved: many, rows: 41 })
    expect(tall.folds).toEqual(['saved shows 5'])
    // never one line each, cut: every item shown keeps its words (two lines here), its dot on the first only
    const t = textOf(tall.lines)
    const s0 = t.findIndex(l => l.startsWith('Saved this session'))
    expect(t.slice(s0 + 1, s0 + 11)).toEqual(Array.from({ length: 5 }, (_, i) => [`● Saved item ${String(i)} with a title long`, 'enough to wrap twice over']).flat())
    expect(t.some(l => l.startsWith('● ') && l.endsWith('…'))).toBe(false)
    // two rows fewer take one item away, its two lines, rather than a line from each
    expect(layoutBody({ ...BASE, saved: many, rows: 39 }).folds).toEqual(['saved shows 4'])
    // a long session's list draws twelve at most, its heading the whole count
    const dozens = Array.from({ length: 40 }, (_, i) => ({ ...BASE.saved[1]!, key: `d${String(i)}`, title: `Item ${String(i)}` }))
    const all = textOf(layoutBody({ ...BASE, saved: dozens, rows: 200 }).lines)
    expect(all.filter(l => l.startsWith('● Item')).length).toBe(12)
    expect(all).toContain('Saved this session ' + '─'.repeat(10) + ' 40')
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
    const open = textOf(layoutBody({ ...BASE, saved: many, rows: 40, open: { key: 'saved:k8', id: 'mem_s2', status: 'ready', title: 'The ninth, opened', text: 'Its own words.', meta: 'fact · learned Oct 9', at: T0 } }).lines)
    expect(open).toContain('● The ninth, opened')
    expect(open).toContain('fact · learned Oct 9')
  })

  test('an opened dream keeps its words while the saved list goes down to two; then its excerpt shortens', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...BASE.saved[1]!, key: `k${String(i)}`, title: `Saved item ${String(i)} with a title long enough to wrap twice over` }))
    const dream = { ...BASE.dream!, rest: 'The interpretability paper had a model that writes its reasoning toward whatever answer the hint gives it. Mike said he weighs his words because I lean toward agreeing, and more after that.' }
    const open = { key: 'dream', id: null, status: 'ready' as const, title: null, text: '', meta: null, at: T0 }
    const roomy = layoutBody({ ...BASE, saved: many, dream, open, rows: 36 })
    expect(roomy.folds).toEqual(['chart folded', 'saved shows 5'])
    expect(textOf(roomy.lines).join(' ')).toContain('more after that.')
    const tight = layoutBody({ ...BASE, saved: many, dream, open, rows: 28 })
    expect(tight.folds).toEqual(['chart folded', 'saved shows 2', 'dream excerpt 7 lines'])
  })

  test('an opened mechanism lists what its firings were about, grouped under what and when; an opened dream is the dream itself', () => {
    const mech = { id: 'decay' as const, status: 'ready' as const, at: T0, events: [
      { key: '3.0', seq: 3, at: new Date(2026, 9, 9, 8, 7).getTime(), word: 'faded', title: 'Writer and reflection are different jobs; both write the page for now, and the rest', memoryId: 'mem_1', text: '' },
      { key: '2.0', seq: 2, at: new Date(2026, 9, 9, 8, 7).getTime(), word: 'faded', title: 'Tiny Castles run 4 counterpart playtest: top findings', memoryId: 'mem_2', text: '' },
    ] }
    const lines = textOf(layoutBody({ ...BASE, mech }).lines)
    const f = lines.findIndex(l => l.startsWith('Forgetting'))
    // each firing's title on up to three lines, back at the left edge
    expect(lines.slice(f + 1, f + 7)).toEqual(['faded at 8:07:', 'Writer and reflection are', 'different jobs; both write the', 'page for now, and the rest', 'Tiny Castles run 4 counterpart', 'playtest: top findings'])
    // a wrapped line a shade softer than a firing's first: no bullet says where one ends
    const ev = layoutBody({ ...BASE, mech }).lines
    const first = ev.findIndex(l => l.segs[0]?.t === 'Writer and reflection are')
    expect(ev[first]?.segs[0]?.c).not.toBe(ev[first + 1]?.segs[0]?.c)
    expect(ev[first]?.key).toBe('ev:3.0')
    // nothing it can name: a plain line, never a count; Association (whose flushes count pairs) says what it does
    expect(textOf(layoutBody({ ...BASE, mech: { ...mech, id: 'decay' as const, events: [] } }).lines)).toContain('nothing lately names a memory')
    const assoc = textOf(layoutBody({ ...BASE, mech: { ...mech, id: 'association' as const, events: [] } }).lines).join(' ')
    expect(assoc).toContain("links memories used together; it doesn't record which yet")
    expect(assoc).not.toContain('nothing lately')
    const dream = textOf(layoutBody({ ...BASE, open: { key: 'dream', id: null, status: 'ready', title: null, text: '', meta: null, at: T0 } }).lines)
    expect(dream.join(' ')).toContain('The interpretability paper')
    expect(dream.join(' ')).not.toMatch(/what changed|merged|faded/)
  })

  test('a click opens in place, whatever the length: up to 20 lines whole; longer, 20 lines, the last ending with a cyan `more` that links to the memory', () => {
    expect(OPEN_MAX_LINES).toBe(20)
    const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${String(i)}`).join(' ')
    const short = { key: 'saved:s2', id: 'mem_s2', status: 'ready' as const, title: 'A short one', text: words(20), meta: 'fact', at: T0 }
    const whole = layoutBody({ ...BASE, rows: 200, open: short }).lines
    expect(textOf(whole).join(' ')).toContain('word19')
    expect(whole.some(l => l.link !== undefined)).toBe(false)
    const long = { ...short, text: words(200) }
    const cut = layoutBody({ ...BASE, rows: 200, open: long }).lines
    const body = cut.filter(l => l.key === 'saved:s2' && l.segs[0]?.c === '#b3bcc5')
    expect(body).toHaveLength(20)
    const last = body[19]!
    expect(last.segs.map(x => x.t).join('')).toMatch(/… more$/)
    expect(last.segs[last.segs.length - 1]).toEqual({ t: MORE, c: '#00e5ff' })
    expect(last.link?.key).toBe('more:mem_s2')
    expect(last.link?.from).toBe(cells(last.segs[0]!.t) + 1)
    expect(cells(last.segs.map(x => x.t).join(''))).toBeLessThanOrEqual(W)
    // folded shorter by a short pane, it still ends with `more`
    const tight = layoutBody({ ...BASE, rows: 30, open: long })
    const tl = tight.lines.filter(l => l.key === 'saved:s2' && l.segs[0]?.c === '#b3bcc5')
    expect(tl.length).toBeLessThan(20)
    expect(tl[tl.length - 1]?.link?.key).toBe('more:mem_s2')
    // a saved update says what it replaces only when opened
    expect(textOf(layoutBody({ ...BASE }).lines).join(' ')).not.toContain('replaces')
    const upd = textOf(layoutBody({ ...BASE, open: { ...short, key: 'saved:s1', id: 'mem_s1' } }).lines)
    expect(upd.join(' ')).toContain("replaces Auto-memory MEMORY.md for pwntastic: how it's been used")
  })

  test('a dream whose journal row was not found: no made-up time today, its date before today', () => {
    const today = textOf(layoutBody({ ...BASE, dream: { ...BASE.dream!, at: null, date: '2026-10-09' } }).lines)
    expect(today.find(l => l.startsWith('Last Dream'))).toBe('Last Dream ' + '─'.repeat(21))
    const before = textOf(layoutBody({ ...BASE, dream: { ...BASE.dream!, at: null, date: '2026-10-07' } }).lines)
    expect(before.find(l => l.startsWith('Last Dream'))).toBe('Last Dream ' + '─'.repeat(15) + ' Oct 7')
  })

  test('no status file yet: the chart says, dim, it is waiting for the first session; no line is a click', () => {
    for (const w of [26, 32, 48, 64]) {
      const laid = layoutBody({ ...BASE, w, today: null, dash: 'down' }).lines
      const lines = textOf(laid)
      const at = lines.findIndex(l => l.startsWith('Mechanisms today'))
      const to = lines.findIndex((l, i) => i > at && l.trim() === '')
      expect(lines.slice(at + 1, to).join(' ')).toBe('Waiting for the first session: memory writes what it did here after a turn.')
      for (const l of laid.slice(at + 1, to)) expect(l.key).toBeUndefined()
      expect(lines.join(' ')).not.toMatch(/dashboard/)
    }
  })

  test('another store’s status file: no numbers, one dim line saying so', () => {
    const laid = layoutBody({ ...BASE, today: null, dream: null, dash: 'other' }).lines
    const lines = textOf(laid)
    const at = lines.findIndex(l => l.startsWith('Mechanisms today'))
    expect(lines.slice(at + 1, at + 3).join(' ')).toBe('The status file is another memory’s.')
    expect(laid[at + 1]?.key).toBeUndefined()
  })

  test('a status file over an hour old says its age where the chart says “times fired”; a fresh one does not', () => {
    const fresh = textOf(layoutBody({ ...BASE, statusAt: BASE.now - 5 * 60000 }).lines)
    expect(fresh.some(l => /^Mechanisms today ─+ times fired$/.test(l))).toBe(true)
    const old = textOf(layoutBody({ ...BASE, statusAt: BASE.now - 3 * 3600000 }).lines)
    expect(old.some(l => /^Mechanisms today ─+ 3 h ago$/.test(l))).toBe(true)
  })
})

describe('the footer and the pause, said (v1)', () => {
  test('at the docked pane’s 32 cells each item is one line, label · command; wider, the long labels', () => {
    const at = (w: number) => footerLines(w).map(l => l.label + l.how)
    // `Dashboard · /counterparts:dashboard` is 35 cells: at 32 its command goes under it, whole
    expect(at(32)).toEqual(['Intro · /counterparts:meet', 'Dash · /counterparts:dashboard', 'Pause · say “pause memory here”', 'Hide · /counterparts quiet'])
    expect(at(40)).toEqual(['5-minute intro · /counterparts:meet', 'Dashboard · /counterparts:dashboard', 'Pause here · say “pause memory here”', 'Hide this · /counterparts quiet'])
    for (const w of [16, 20, 26, 28, 32, 38, 48]) {
      const lines = footerLines(w)
      // never over the width while the longest command fits it; narrower, a command is never cut
      if (w >= 23) for (const l of lines) expect(cells(l.label + l.how)).toBeLessThanOrEqual(w)
      // every command is said whole, on some line
      for (const it of FOOTER_ITEMS) expect(lines.some(l => l.how === it.how)).toBe(true)
    }
    // narrower than an item: its short label, then the command under it, indented
    expect(footerLines(26).map(l => l.label + l.how)).toEqual([
      'Intro · /counterparts:meet', 'Dash', '  /counterparts:dashboard', 'Pause', '  say “pause memory here”', 'Hide · /counterparts quiet',
    ])
  })

  test('paused or off, the footer’s pause line says how to resume instead', () => {
    expect(footerLines(40, true).map(l => l.label + l.how)).toContain('Resume here · say “resume memory here”')
    expect(footerLines(32, true).map(l => l.label + l.how)).toEqual([
      'Intro · /counterparts:meet', 'Dash · /counterparts:dashboard', 'Resume', '  say “resume memory here”', 'Hide · /counterparts quiet',
    ])
    expect(footerLines(32, true).some(l => l.how.includes('pause memory'))).toBe(false)
  })

  test('/counterparts resume says how, and changes nothing; the status line says the same', () => {
    const scope = { mode: 'paused', own: true, setBy: '/w/p', dir: '/w/p', error: null, busy: false, unread: null }
    expect(resumeWords(scope)).toBe('Counterparts memory is paused in /w/p. To resume it, say “resume memory here” to Claude.')
    expect(statusFor(scope)).toBe('⏸ Counterparts memory paused in this folder · say “resume memory here”')
    expect(resumeWords({ ...scope, mode: 'on' })).toBe('Counterparts memory isn\'t paused in /w/p.')
    expect(resumeWords({ ...scope, own: false, setBy: '/w' })).toContain('counterparts scope /w --resume')
    expect(resumeWords({ ...scope, own: false, setBy: "/w/it's here" })).toContain("counterparts scope '/w/it'\\''s here' --resume")
    expect(resumeWords({ ...scope, own: false, setBy: '/w' })).toContain('say “resume memory here” to Claude in a session there')
    expect(resumeWords({ ...scope, mode: 'off' })).toContain("counterparts scope /w/p --on")
    expect(resumeWords({ ...scope, mode: 'unknown' })).toContain('say “resume memory here” to Claude')
  })

  test('the avatar as stored: off stays; the brain an older version stored is the fox', () => {
    expect(normAvatar('off')).toBe('off')
    for (const v of ['fox', 'turning', 'still', undefined, null, 'nope']) expect(normAvatar(v)).toBe('fox')
  })
})

describe('the first meeting', () => {
  test('core’s /api/onboarding is read strictly: anything but one of the five states is unknown', () => {
    expect(parseOnboarding('{"meet":"not_started","where":null,"style":null}')).toEqual({ meet: 'not_started', where: null, style: null })
    expect(parseOnboarding('{"meet":"done","where":"everywhere","style":"straight"}')).toEqual({ meet: 'done', where: 'everywhere', style: 'straight' })
    for (const bad of ['', 'not json', '{"error":"not found"}', '{"meet":"maybe"}', '{"meet":1}', '["done"]', 'null', '"done"']) {
      expect(parseOnboarding(bad)).toEqual(UNKNOWN_ONBOARDING)
    }
  })
  test('the wake’s marker names the state on a line of its own; none, or a state not known, is null', () => {
    expect(parseOnboardingMarker('# Waking up\n<!-- counterparts:onboarding meet=not_started -->\nmore')).toBe('not_started')
    for (const s of ['offered', 'later', 'done', 'skipped'] as const) expect(parseOnboardingMarker(`<!-- counterparts:onboarding meet=${s} -->`)).toBe(s)
    for (const bad of ['', '# Waking up', '<!-- counterparts:onboarding meet=maybe -->', '<!-- counterparts:recall t=3 -->', 'counterparts:onboarding meet=done']) {
      expect(parseOnboardingMarker(bad)).toBeNull()
    }
  })
  test('the wake’s one tag line (2026-10-16): the marker, the store’s and the wake’s head on one line, each read as before', () => {
    const line = 'Now: Fri 16 Oct 2026, 9:37 am MDT\n<!-- counterparts:onboarding meet=done --> <!-- counterparts:store id=st_0123456789abcdef --> <!-- counterparts:wake elements=3 bytes=8885 -->\nCounterparts memory, day 25 · 1,808 memories.'
    expect(parseOnboardingMarker(line)).toBe('done')
    expect(parseStoreMarker(line)).toBe('st_0123456789abcdef')
    // Before a bootstrap line, the two markers alone on the line.
    expect(parseOnboardingMarker('<!-- counterparts:onboarding meet=offered --> <!-- counterparts:store id=st_0123456789abcdef -->\nNo briefing has been composed yet')).toBe('offered')
    // And the three lines of before it, as an older core writes them.
    const old = '<!-- counterparts:onboarding meet=later -->\n<!-- counterparts:store id=st_fedcba9876543210 -->\n<!-- counterparts:wake day=25 elements=3 bytes=8885 -->'
    expect(parseOnboardingMarker(old)).toBe('later')
    expect(parseStoreMarker(old)).toBe('st_fedcba9876543210')
  })
  test('one tag (2026-10-20): meet= and store= inside the wake’s head tag, or the session tag in front of a wake with none', () => {
    const head = 'Now: Tue 20 Oct 2026, 7:40 am MDT\n<!-- counterparts:wake meet=done store=st_0123456789abcdef elements=4 bytes=9030 -->\nCounterparts memory, day 29 · 2,138 memories.'
    expect(parseOnboardingMarker(head)).toBe('done')
    expect(parseStoreMarker(head)).toBe('st_0123456789abcdef')
    const session = '<!-- counterparts:session meet=not_started store=st_fedcba9876543210 -->\nCounterparts: this session was resumed; the wake it was handed when it started (above) still holds.'
    expect(parseOnboardingMarker(session)).toBe('not_started')
    expect(parseStoreMarker(session)).toBe('st_fedcba9876543210')
    // Claude Desktop's wake carries no store field.
    expect(parseOnboardingMarker('<!-- counterparts:wake meet=later elements=1 bytes=99 -->')).toBe('later')
    expect(parseStoreMarker('<!-- counterparts:wake meet=later elements=1 bytes=99 -->')).toBeNull()
    for (const bad of ['<!-- counterparts:wake elements=4 bytes=9030 -->', '<!-- counterparts:wake meet=maybe elements=1 bytes=2 -->', '<!-- counterparts:recall meet=done -->', 'counterparts:wake meet=done']) {
      expect(parseOnboardingMarker(bad)).toBeNull()
    }
    expect(parseStoreMarker('<!-- counterparts:wake store=st_xyz elements=1 bytes=2 -->')).toBeNull()
  })
})

describe('the themes', () => {
  test('tron is the mockups’ palette, exactly; cozy has every key, each a colour; a stored name this version does not know is tron', () => {
    expect(tron).toEqual({
      panel: '#05080c', hi: '#dde3e9', text: '#b3bcc5', mid: '#8e98a2', dim: '#66717c', faint: '#1d262e', head: '#c9d1d8',
      accent: '#00e5ff', accent2: '#ffb347', accentDim: '#0b6f7c',
    })
    expect(Object.keys(cozy).sort()).toEqual(Object.keys(tron).sort())
    for (const v of Object.values(cozy)) expect(v).toMatch(/^#[0-9a-f]{6}$/)
    expect(normTheme('cozy')).toBe('cozy')
    for (const v of ['tron', 'neon', undefined, null, 3]) expect(normTheme(v)).toBe('tron')
  })
  test('applyTheme changes the palette in use, and the body’s lines are drawn in it', () => {
    try {
      applyTheme('cozy')
      expect(P.panel).toBe(cozy.panel)
      const used = new Set(layoutBody(BASE).lines.flatMap(l => l.segs.map(s => s.c)))
      // the neutrals (stage colours on dots and bars are the mechanisms', not the theme's)
      for (const k of ['hi', 'text', 'mid', 'dim', 'faint', 'head'] as const) expect(used.has(tron[k])).toBe(false)
      expect(used.has(cozy.head) && used.has(cozy.dim)).toBe(true)
    } finally {
      applyTheme('tron')
    }
    expect(P).toEqual(tron)
  })
})

// ── the fox ────────────────────────────────────────────────────────────────

/** A seeded random: the schedule's moments and holds the same every run. */
function seeded(seed = 7): () => number {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

describe('the fox', () => {
  test('which way a surface draws it: a picture first; where the engine says it drew its alt, sextants where the font has them, else half-blocks', () => {
    expect(pickTier('terminal', 'auto', {})).toBe('image')
    expect(pickTier('terminal', 'auto', { TERM_PROGRAM: 'Apple_Terminal' })).toBe('image')
    // an Image that drew its alt here: auto stops trying, and draws the next best
    for (const p of ['iTerm.app', 'WezTerm', 'vscode', 'ghostty']) expect(pickTier('terminal', 'auto', { TERM_PROGRAM: p }, true)).toBe('fine')
    expect(pickTier('terminal', 'auto', { TERM: 'xterm-kitty' }, true)).toBe('fine')
    expect(pickTier('terminal', 'auto', { TERM_PROGRAM: 'Apple_Terminal' }, true)).toBe('basic')
    expect(pickTier('terminal', 'auto', {}, true)).toBe('basic')
    // no PNG folder found: never a picture, not even when asked for one
    expect(pickTier('terminal', 'auto', { TERM_PROGRAM: 'iTerm.app' }, false, false)).toBe('fine')
    expect(pickTier('terminal', 'images', {}, false, false)).toBe('basic')
    // an explicit choice stands
    expect(pickTier('terminal', 'images', {}, true)).toBe('image')
    expect(pickTier('terminal', 'fine', {})).toBe('fine')
    expect(pickTier('terminal', 'basic', { TERM_PROGRAM: 'iTerm.app' })).toBe('basic')
    for (const s of ['desktop', 'vscode', 'mobile']) expect(pickTier(s, 'basic', {})).toBe('svg')
    expect(normDetail('images')).toBe('images')
    expect(normDetail('sharp')).toBe('auto')
  })

  test('sextant colours land on their xterm-256 colour whether the terminal rounds (chalk) or takes the nearest; the drawing uses them', () => {
    const LV = [0, 95, 135, 175, 215, 255]
    const rgb = (h: string): number[] => {
      const n = parseInt(h.slice(1), 16)
      return [n >> 16, (n >> 8) & 255, n & 255]
    }
    const chalk = (c: number[]): number[] => c.map(v => LV[Math.round((v / 255) * 5)] ?? -1)
    const nearest = (c: number[]): number[] => c.map(v => LV.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)))
    for (const target of Object.values(TEXT_256)) {
      const want = rgb(target)
      if (want[0] === want[1] && want[1] === want[2]) continue // a grey: the grey ramp, itself
      for (const v of want) expect(LV.includes(v)).toBe(true)
      const [art] = Object.entries(TEXT_256).find(([, t]) => t === target) ?? ['']
      const spelt = rgb(textHex(art) ?? '')
      expect(chalk(spelt)).toEqual(want)
      expect(nearest(spelt)).toEqual(want)
    }
    // Every coloured sextant palette entry and effect has its colour (black, the outline and white pass as they are).
    const six = (c: string): string => '#' + [...c.slice(1)].map(x => x + x).join('')
    const pass = new Set(['#000000', '#110000', '#ffffff'])
    for (const c of [...FOX_FINAL.sextant.palette, ...Object.values(FOX_FINAL.fxPalette)]) {
      const h = c.length === 4 ? six(c) : c
      if (!pass.has(h)) expect(TEXT_256[h]).toBeDefined()
    }
    const used = new Set(fineCells({ frame: 'idle', fx: [] }).flat().flatMap(c => [c.fg, c.bg]))
    expect(used.has('#a42')).toBe(false)
    expect(used.has(textHex('#a42'))).toBe(true) // the fur: the palette is read from 1 ('1' the outline)
    // every cell's colour is in the palette (the notepad's 'j' is its last colour, not past its end)
    const P = FOX_FINAL.sextant.palette.length
    for (const f of Object.values(FOX_FINAL.sextant.frames) as unknown as { fg: readonly string[]; bg: readonly string[] }[]) {
      for (const ch of [...f.fg, ...f.bg].join('')) if (ch !== '.') expect(parseInt(ch, 36)).toBeLessThanOrEqual(P)
    }
    const pad = new Set(fineCells({ frame: 'note0', fx: [] }).flat().flatMap(c => [c.fg, c.bg]))
    expect(pad.has(textHex('#753'))).toBe(true)
  })

  test('sextants: every pattern has its glyph and back; the four that are not sextants are the space and the block glyphs', () => {
    for (let v = 0; v < 64; v++) expect(sextantBits(sextantGlyph(v))).toBe(v)
    expect([sextantGlyph(0), sextantGlyph(21), sextantGlyph(42), sextantGlyph(63)]).toEqual([' ', '▌', '▐', '█'])
    expect(sextantGlyph(1)).toBe('\u{1FB00}')
    expect(sextantGlyph(62)).toBe('\u{1FB3B}')
    // two colours a cell: the two most frequent; a third goes to the nearer of them
    const c = fineCell(['#ff0000', '#ff0000', '#0000ff', '#0000ff', '#ee0000', null])
    expect([c.fg, c.bg].sort()).toEqual(['#0000ff', '#ff0000'])
    expect(fineCell([null, null, null, null, null, null])).toEqual({ ch: ' ', fg: null, bg: null })
    expect(fineCell(['#abc', null, '#abc', null, '#abc', null])).toEqual({ ch: '▌', fg: '#abc', bg: null })
  })

  test('each tier draws the same frame in its footprint: half-blocks 34 x 15 on a Raster, sextants 34 x 16 in Text runs, the picture a PNG, the desktop an Svg under its size cap', () => {
    const idle = { frame: 'idle', fx: [] }
    expect(decodeCells(halfCells(idle)).length).toBe(STAGE_COLS * 15 * 3)
    expect(stageRows('basic')).toBe(15)
    const fine = fineCells(idle)
    expect(fine.length).toBe(16)
    expect(fine.every(l => l.length === STAGE_COLS)).toBe(true)
    expect(fine.flat().some(c => (c.ch.codePointAt(0) ?? 0) >= 0x1fb00)).toBe(true)
    // runs keep every cell
    for (const l of fine) expect([...runs(l).map(r => r.ch).join('')].length).toBe(STAGE_COLS)
    // a nap's z sits beside the head, inside the stage, in the effect's colour
    const zs = [['zSmall', 'zSmall'], ['z', 'z']] as const
    expect(fineCells({ frame: 'nap1', fx: zs }).flat().some(c => c.fg === textHex('#9be') || c.bg === textHex('#9be'))).toBe(true)
    expect([...decodeCells(halfCells({ frame: 'nap1', fx: zs }))].some((v, i) => i % 3 !== 0 && v === 0x99bbee)).toBe(true)
    // the picture tier's files (art/fox/<key>.png): a frame with its effects, else the frame, else idle
    expect(pngName(idle)).toBe('idle.png')
    expect(pngName({ frame: 'perk', fx: [['spark0', 'spark']] })).toBe('perk+spark0.png')
    expect(pngName({ frame: 'perk', fx: [['nothing', 'spark']] })).toBe('perk.png')
    expect(pngName({ frame: 'no-such', fx: [] })).toBe('idle.png')
    expect(PNG_FRAMES.size).toBe(36)
    const svg = foxSvg(idle, 'iVBORw0KGgo')
    expect(svg.source.length).toBeLessThan(131072)
    // the picture alone: the half-blocks under it showed as a ghost edge on the desktop's light page
    expect(svg.source).not.toContain('<rect')
    expect(svg.source).toContain('data:image/png;base64,')
  })

  test('the schedule: a short first hold, then the tail tip flicks; then still holds of 4–9 s, each ending in one small moment; one wake per change of what is on screen', () => {
    const d = newDirector(0)
    const rand = seeded()
    const first = advance(d, 0, rand)
    expect(first.step.frame).toBe('idle')
    expect(first.next).toBeGreaterThanOrEqual(2000)
    expect(first.next).toBeLessThanOrEqual(4000)
    // the early flick: the tip leans, further, back
    const flick: string[] = []
    let u = first.next
    for (let i = 0; i < 3; i++) {
      const a = advance(d, u, rand)
      flick.push(a.step.frame)
      u = a.next
    }
    expect(flick).toEqual(['tailSmall0', 'tailSmall1', 'tailSmall0'])
    const second = advance(d, u, rand)
    expect(second.step.frame).toBe('idle')
    expect(second.next - u).toBeGreaterThanOrEqual(4000)
    expect(second.next - u).toBeLessThanOrEqual(9000)
    let t = second.next
    let shown = stepKey(second.step)
    const seen: string[] = []
    for (let i = 0; i < 40; i++) {
      const a = advance(d, t, rand)
      // each wake shows something new
      expect(stepKey(a.step)).not.toBe(shown)
      shown = stepKey(a.step)
      seen.push(shown)
      expect(a.next).toBeGreaterThan(t)
      t = a.next
    }
    expect(seen.filter(k => k === 'idle').length).toBeGreaterThan(3)
    expect(new Set(seen).size).toBeGreaterThan(2)
  })

  test('the moments: one ear twitch, the tail tip unhurried, the whole tail rare; no lick', () => {
    expect(momentSteps('ear').map(s => s.frame)).toEqual(['ear'])
    expect(momentSteps('tailSmall').reduce((a, s) => a + s.ms, 0)).toBeGreaterThan(1000)
    const w = FOX_FINAL.schedule.weights as Readonly<Record<string, number>>
    expect(w['tail']).toBeLessThan((w['tailSmall'] ?? 0) / 4)
    expect('lick' in FOX_FINAL.moments).toBe(false)
    // every frame a moment names is drawn in every tier
    for (const steps of Object.values(FOX_FINAL.moments) as unknown as (readonly [string, number])[][]) {
      for (const [f] of steps) {
        expect(f in FOX_FINAL.png.frames && f in FOX_FINAL.sextant.frames && f in FOX_FINAL.half.frames).toBe(true)
        expect(pngName({ frame: f, fx: [] })).toBe(`${f}.png`)
      }
    }
  })

  test('after 45 s with nothing happening he lies down, behind a blink; small moments lying; at 2 min he naps from there; a prompt gets him up', () => {
    const d = newDirector(0)
    const rand = seeded(5)
    let t = 0
    const frames: string[] = []
    while (t < 44000) {
      const a = advance(d, t, rand)
      frames.push(a.step.frame)
      t = a.next
    }
    expect(frames.some(f => f.startsWith('lie'))).toBe(false)
    while (t < 60000) {
      const a = advance(d, t, rand)
      frames.push(a.step.frame)
      t = a.next
    }
    expect(d.mode).toBe('lie')
    // sitting to lying happens behind shut eyes: a blink, then the lying blink
    const i = frames.indexOf('lieBlink')
    expect(frames.slice(i - 1, i + 2)).toEqual(['blink', 'lieBlink', 'lie0'])
    const lying: string[] = []
    while (t < 110000) {
      const a = advance(d, t, rand)
      lying.push(a.step.frame)
      t = a.next
    }
    expect(lying.every(f => f.startsWith('lie'))).toBe(true)
    expect(new Set(lying).size).toBeGreaterThan(2)
    trigger(d, 'prompt', t)
    expect(d.mode).toBe('work') // a prompt puts him to work (2026-10-20); with no turn after it, that ends by itself
    const up: string[] = []
    for (let k = 0; k < 3; k++) {
      const a = advance(d, t, rand)
      up.push(a.step.frame)
      t = a.next
    }
    expect(up).toEqual(['lieBlink', 'blink', 'perk']) // up behind a blink, straight to the alert face
    // the turn answered at once: he rests
    trigger(d, 'turnEnd', t)
    // left alone again: lying from 45 s, the nap at 2 min, asleep from lying behind the lying blink
    const start = t
    const later: string[] = []
    while (t < start + 125000) {
      const a = advance(d, t, rand)
      later.push(a.step.frame)
      t = a.next
    }
    expect(d.mode).toBe('nap')
    const n = later.indexOf('nap0')
    expect(later[n - 1]).toBe('lieBlink')
  })

  test('something comes to mind while he lies: he perks up lying down (a spark beside the lying head), then sits up', () => {
    const d = newDirector(0)
    const rand = seeded(5)
    let t = 0
    while (d.mode !== 'lie' || advance(d, t, rand).step.frame !== 'lie0') t = advance(d, t, rand).next
    trigger(d, 'came', t)
    const a = advance(d, t, rand)
    expect(a.step.frame).toBe('liePerk')
    expect(a.step.fx).toEqual([['spark0', 'sparkLie']])
    const seq: string[] = []
    for (let k = 0; k < 8; k++) {
      const s = advance(d, t, rand)
      seq.push(s.step.frame)
      t = s.next
    }
    expect(seq.slice(-4)).toContain('idle')
    expect(d.mode).toBe('idle')
    // a save mid-glance (sitting) goes through a blink first, so the notepad never jumps from a sideways look
    const e = newDirector(0)
    e.cur = { frame: 'lookL', ms: 1400, fx: [], moment: 'glance' }
    e.until = 10
    trigger(e, 'note', 5)
    expect(advance(e, 5, rand).step.frame).toBe('blink')
  })

  test('after two minutes with nothing happening the fox naps, and a prompt wakes it with a stretch', () => {
    const d = newDirector(0)
    const rand = seeded(3)
    let t = 0
    while (t < 140000) t = advance(d, t, rand).next
    expect(d.mode).toBe('nap')
    trigger(d, 'prompt', t)
    expect(d.mode).toBe('work')
    const frames: string[] = []
    for (let i = 0; i < 4; i++) {
      const a = advance(d, t, rand)
      frames.push(a.step.frame)
      t = a.next
    }
    expect(frames).toContain('stretch')
    // a prompt while awake changes nothing on screen
    const before = stepKey(advance(d, t, rand).step)
    trigger(d, 'prompt', t)
    expect(stepKey(advance(d, t, rand).step)).toBe(before)
  })

  test('real state: something came to mind (a spark beside the head), a save (the notepad, twice), the first meeting (hello), a dream (asleep, until it ends)', () => {
    const d = newDirector(0)
    const rand = seeded()
    trigger(d, 'came', 1000)
    const came = advance(d, 1000, rand).step
    expect(came.frame).toBe('perk')
    expect(came.fx.map(f => f[0])).toContain('spark0')
    trigger(d, 'note', 2000)
    const notes: string[] = []
    let t = 2000
    for (let i = 0; i < 8; i++) {
      const a = advance(d, t, rand)
      notes.push(a.step.frame)
      t = a.next
    }
    expect(notes.filter(f => f === 'note0').length).toBe(2)
    // from the notepad pose, through a blink back to the sitting face, then hello
    trigger(d, 'hello', t)
    expect(advance(d, t, rand).step.frame).toBe('blink')
    t = advance(d, t, rand).next
    expect(advance(d, t, rand).step.frame).toBe('hello0')
    trigger(d, 'dream', t)
    for (let i = 0; i < 10; i++) t = advance(d, t, rand).next
    expect(d.mode).toBe('dream')
    expect(advance(d, t, rand).step.fx.map(f => f[0]).some(n => n.startsWith('dream'))).toBe(true)
    // a save while dreaming: the dream is what it does
    trigger(d, 'note', t)
    expect(d.mode).toBe('dream')
    trigger(d, 'dreamEnd', t)
    expect(d.mode).toBe('idle')
  })

  test('a tool call is activity (2026-10-20): the idle clock starts over and nothing plays; lying, it gets him up; while a call runs he never lies down', () => {
    // calls every 40 s: two and a half minutes on, still sitting, never a lie-down or a nap
    const d = newDirector(0)
    const rand = seeded(5)
    let t = 0
    const frames: string[] = []
    for (let call = 40000; call <= 160000; call += 40000) {
      while (t < call) {
        const a = advance(d, t, rand)
        frames.push(a.step.frame)
        t = a.next
      }
      // sitting, nothing plays (a lie-down already planned ahead is called off)
      trigger(d, 'busy', t)
      expect(trigger(d, 'busyEnd', t)).toBe(false) // the waiting timer stands
    }
    expect(d.mode).toBe('idle')
    expect(frames.some(f => f.startsWith('lie') || f.startsWith('nap'))).toBe(false)
    // lying, a call gets him up, as a prompt does
    while (d.mode !== 'lie' || advance(d, t, rand).step.frame !== 'lie0') t = advance(d, t, rand).next
    expect(trigger(d, 'busy', t)).toBe(true)
    expect(d.mode).toBe('idle')
    const up: string[] = []
    for (let k = 0; k < 3; k++) {
      const a = advance(d, t, rand)
      up.push(a.step.frame)
      t = a.next
    }
    expect(up).toEqual(['lieBlink', 'blink', 'idle'])
    // that call runs five minutes (a long command): awake all through it; after it ends, lying 45 s on
    const start = t
    const during: string[] = []
    while (t < start + 300000) {
      const a = advance(d, t, rand)
      during.push(a.step.frame)
      t = a.next
    }
    expect(during.some(f => f.startsWith('lie') || f.startsWith('nap'))).toBe(false)
    trigger(d, 'busyEnd', t)
    expect(d.busy).toBe(0)
    const ended = t
    while ((d.mode as string) === 'idle') t = advance(d, t, rand).next
    expect(d.mode).toBe('lie')
    expect(t - ended).toBeGreaterThanOrEqual(FOX_FINAL.schedule.lieAfterMs - 10000)
    // a count left up past BUSY_MAX_MS (an end never heard) stops holding him
    const e = newDirector(0)
    trigger(e, 'busy', 0)
    let u = 0
    while (u < BUSY_MAX_MS + 60000) u = advance(e, u, rand).next
    expect(e.mode).not.toBe('idle')
  })

  test('once he is up, calls only restart the clock (review of #545): a burst of calls lets the stretch and the notepad play out', () => {
    const rand = seeded(3)
    // napping, then a call every 150 ms: the stretch plays through to sitting, not nap0 over and over
    const d = newDirector(0)
    let t = 0
    while (d.mode !== 'nap' || !advance(d, t, rand).step.frame.startsWith('nap')) t = advance(d, t, rand).next
    const seen: string[] = []
    for (let k = 0; k < 20; k++, t += 150) {
      trigger(d, k % 2 === 0 ? 'busy' : 'busyEnd', t)
      seen.push(advance(d, t, rand).step.frame)
    }
    expect(seen).toContain('stretch')
    expect(seen.at(-1)).toBe('idle')
    // lying, a save, then a call ending 100 ms later: the notepad still plays
    const e = newDirector(0)
    let u = 0
    while (e.mode !== 'lie' || advance(e, u, rand).step.frame !== 'lie0') u = advance(e, u, rand).next
    trigger(e, 'note', u)
    expect(trigger(e, 'busyEnd', u + 100)).toBe(false)
    const after: string[] = []
    for (let k = 0; k < 10; k++) {
      const a = advance(e, u, rand)
      after.push(a.step.frame)
      u = a.next
    }
    expect(after).toContain('note0')
    // lying, something comes to mind, then a call begins: he still perks up where he lies
    const f = newDirector(0)
    let v = 0
    while (f.mode !== 'lie' || advance(f, v, rand).step.frame !== 'lie0') v = advance(f, v, rand).next
    trigger(f, 'came', v)
    trigger(f, 'busy', v + 100)
    expect(advance(f, v + 100, rand).step.frame).toBe('liePerk')
  })

  test('tool calls counted (review of #545): parallel calls, an extra end never below none, a leaked count dropped 30 min after it rose', () => {
    const rand = seeded(5)
    const d = newDirector(0)
    trigger(d, 'busy', 0)
    trigger(d, 'busy', 10)
    trigger(d, 'busyEnd', 20)
    expect(d.busy).toBe(1)
    let t = 20
    while (t < 120000) t = advance(d, t, rand).next
    expect(d.mode).toBe('idle') // one call still runs: up all through
    trigger(d, 'busyEnd', t)
    trigger(d, 'busyEnd', t)
    expect(d.busy).toBe(0)
    // one call whose end is never heard, then a call every 20 min: from 30 min on the leak is gone, and he lies down after the last
    const e = newDirector(0)
    trigger(e, 'busy', 0)
    let u = 0
    for (let k = 1; k <= 4; k++) {
      while (u < k * 20 * 60000) u = advance(e, u, rand).next
      trigger(e, 'busy', u)
      trigger(e, 'busyEnd', u + 1000)
    }
    expect(e.busy).toBe(0)
    const last = u
    while (u < last + 60000) u = advance(e, u, rand).next
    expect(e.mode).toBe('lie')
  })

  test('a dream and the calls around it (review of #545): calls do not cut the dream; its end stretches once, not again at the call’s end', () => {
    const rand = seeded()
    const d = newDirector(0)
    trigger(d, 'busy', 0)
    trigger(d, 'dream', 0)
    let t = 0
    for (let k = 0; k < 20; k++) {
      t = advance(d, t, rand).next
      trigger(d, 'busy', t)
      trigger(d, 'busyEnd', t + 50)
    }
    expect(d.mode).toBe('dream')
    trigger(d, 'dreamEnd', t)
    expect(trigger(d, 'busyEnd', t + 10)).toBe(false)
    const frames: string[] = []
    for (let k = 0; k < 8; k++) {
      const a = advance(d, t, rand)
      frames.push(a.step.frame)
      t = a.next
    }
    expect(frames.filter(f => f === 'stretch').length).toBe(1)
    expect(frames.slice(0, 4)).toEqual(['nap0', 'stretch', 'blink', 'idle'])
    expect(d.busy).toBe(0)
  })

  test('a burst of saves writes on the notepad once (2026-10-20): a second save inside NOTE_SPAN_MS plays nothing more; one after it writes again', () => {
    const d = newDirector(0)
    const rand = seeded()
    expect(trigger(d, 'note', 1000)).toBe(true)
    expect(trigger(d, 'note', 1200)).toBe(false)
    const notes: string[] = []
    let t = 1000
    while (t < 1000 + NOTE_SPAN_MS + 500) {
      const a = advance(d, t, rand)
      notes.push(a.step.frame)
      t = a.next
    }
    expect(notes.filter(f => f === 'note0').length).toBe(2) // one save's two writes, not four
    expect(trigger(d, 'note', 1000 + NOTE_SPAN_MS + 1)).toBe(true)
  })

  // ── the working pose (2026-10-20, an experiment) ──

  /** Frames shown from `t` until `until`, each wake one entry; returns the frames and their holds. */
  const run = (d: ReturnType<typeof newDirector>, from: number, until: number, rand: () => number) => {
    const shown: { frame: string; key: string; at: number; ms: number }[] = []
    let t = from
    while (t < until) {
      const a = advance(d, t, rand)
      shown.push({ frame: a.step.frame, key: stepKey(a.step), at: t, ms: a.next - t })
      t = a.next
    }
    return { shown, t }
  }
  const WORK_FRAMES = new Set(['perk', 'tail1', 'tail2', 'tailSmall0', 'tailSmall1', 'ear', 'lookL', 'lookR'])

  test('working: a prompt puts him to work at once, the alert face with the tail going, short holds; never a yawn, a drowsy blink, a lie-down or a nap; more prompts, the start and calls change nothing', () => {
    const rand = seeded(11)
    const d = newDirector(0)
    let t = run(d, 0, 20000, rand).t
    expect(trigger(d, 'prompt', t)).toBe(true)
    expect(d.mode).toBe('work')
    const first = advance(d, t, rand).step.frame
    // from a still hold straight to the alert face; from mid-moment, a blink first
    expect(first === 'perk' || first === 'blink').toBe(true)
    // the turn starts, calls run, he is told again: nothing new to draw
    expect(trigger(d, 'turn', t + 10)).toBe(false)
    expect(trigger(d, 'busy', t + 20)).toBe(false)
    expect(trigger(d, 'busyEnd', t + 30)).toBe(false)
    expect(trigger(d, 'prompt', t + 40)).toBe(false)
    // five minutes of a turn, a call a minute
    const shown: { frame: string; key: string; at: number; ms: number }[] = []
    for (let k = 1; k <= 5; k++) {
      const r = run(d, t, t + 60000, rand)
      shown.push(...r.shown)
      t = r.t
      trigger(d, 'busy', t)
      trigger(d, 'busyEnd', t + 500)
    }
    expect(d.mode).toBe('work')
    const frames = shown.map(s => s.frame).filter((f, i) => i > 0 || f !== 'blink')
    expect(frames.every(f => WORK_FRAMES.has(f))).toBe(true)
    // the alert face holds for 1.5–3.5 s at most, never idle's 4–9 s
    const holds = shown.filter(s => s.key === 'perk').map(s => s.ms)
    expect(Math.max(...holds)).toBeLessThanOrEqual(4000)
    // the tail is what moves most: a wag of the whole tail several times a minute
    const wags = shown.filter(s => s.frame === 'tail2').length / 5
    expect(wags).toBeGreaterThanOrEqual(4)
    // and at most a few changes a second: never a running loop
    expect(shown.length / 300).toBeLessThan(3)
    // every working frame is drawn differently from the idle face in every tier
    const idle = { frame: 'idle', fx: [] }
    for (const f of WORK_FRAMES) {
      const step = { frame: f, fx: [] }
      expect(halfCells(step)).not.toBe(halfCells(idle))
      expect(JSON.stringify(fineCells(step))).not.toBe(JSON.stringify(fineCells(idle)))
      expect(pngName(step)).toBe(`${f}.png`)
    }
  })

  test('the turn ends (any main-loop end, its start heard or not): he relaxes behind a blink, the idle clock starts there, lying at 45 s, the nap at 2 min', () => {
    const rand = seeded(4)
    const d = newDirector(0)
    trigger(d, 'turn', 1000)
    let t = run(d, 1000, 200000, rand).t
    expect(d.mode).toBe('work')
    expect(trigger(d, 'turnEnd', t)).toBe(true)
    expect(d.mode).toBe('idle')
    const ended = t
    const back = run(d, t, t + 1000, rand).shown.map(s => s.frame)
    // mid-moment (the tail, a glance) a blink brings back the sitting face; from the alert face, the same blink
    expect(back[0]).toBe('blink')
    expect(back).toContain('idle')
    const r = run(d, ended, ended + 130000, rand)
    const lieAt = r.shown.find(s => s.frame === 'lieBlink')?.at ?? 0
    expect(lieAt - ended).toBeGreaterThanOrEqual(FOX_FINAL.schedule.lieAfterMs - 1000)
    expect(lieAt - ended).toBeLessThan(FOX_FINAL.schedule.lieAfterMs + 1000)
    expect(d.mode).toBe('nap')
    // a reload mid-turn: a fresh fox hears an end it never saw start, and nothing changes
    const e = newDirector(0)
    expect(trigger(e, 'turnEnd', 500)).toBe(false)
    expect(e.mode).toBe('idle')
  })

  test('moments still play while he works and go back to work: something came to mind, a save, hello; a save as the turn ends finishes its notepad first', () => {
    const rand = seeded(2)
    const d = newDirector(0)
    trigger(d, 'turn', 0)
    let t = run(d, 0, 10000, rand).t
    expect(trigger(d, 'came', t)).toBe(true)
    let r = run(d, t, t + 8000, rand)
    expect(r.shown.some(s => s.key === 'perk+spark0')).toBe(true)
    expect(d.mode).toBe('work')
    expect(r.shown.at(-1)?.frame).not.toBe('idle')
    t = r.t
    trigger(d, 'note', t)
    r = run(d, t, t + 12000, rand)
    expect(r.shown.filter(s => s.frame === 'note0').length).toBe(2)
    const afterNote = r.shown.slice(r.shown.findLastIndex(s => s.frame.startsWith('note')) + 1).map(s => s.frame)
    expect(afterNote.length).toBeGreaterThan(0)
    // back to work, not to idle: from the notepad face a blink first (review of #549), then the alert face
    expect(afterNote[0]).toBe('blink')
    expect(afterNote[1]).toBe('perk')
    expect(afterNote.slice(1).every(f => WORK_FRAMES.has(f))).toBe(true)
    t = r.t
    trigger(d, 'hello', t)
    r = run(d, t, t + 8000, rand)
    expect(r.shown.some(s => s.frame === 'hello0')).toBe(true)
    expect(d.mode).toBe('work')
    t = r.t
    // the write-up at a turn's end: the save, then the turn ends 100 ms later; the notepad plays through, then he rests
    t = run(d, t, t + 5000, rand).t
    trigger(d, 'note', t + NOTE_SPAN_MS)
    t += NOTE_SPAN_MS
    advance(d, t, rand)
    trigger(d, 'turnEnd', t + 100)
    r = run(d, t, t + 8000, rand)
    expect(r.shown.filter(s => s.frame === 'note0').length).toBe(2)
    const rest = r.shown.slice(r.shown.findLastIndex(s => s.frame.startsWith('note')) + 1).map(s => s.frame)
    expect(rest).toContain('idle')
    expect(rest).not.toContain('perk')
    expect(d.mode).toBe('idle')
  })

  test('a dream holds the stage over work: calls and the turn do not cut it; its end goes back to work while the turn runs, to sitting once it ended', () => {
    const rand = seeded(9)
    const d = newDirector(0)
    trigger(d, 'turn', 0)
    let t = run(d, 0, 5000, rand).t
    trigger(d, 'dream', t)
    for (let k = 0; k < 10; k++) {
      t = advance(d, t, rand).next
      expect(trigger(d, 'turn', t)).toBe(false)
      trigger(d, 'busy', t)
      trigger(d, 'busyEnd', t + 50)
    }
    expect(d.mode).toBe('dream')
    trigger(d, 'dreamEnd', t)
    expect(d.mode).toBe('work')
    const out = run(d, t, t + 6000, rand).shown.map(s => s.frame)
    expect(out).toContain('stretch')
    expect(out.at(-1) !== undefined && WORK_FRAMES.has(out.at(-1) ?? '')).toBe(true)
    // the turn ends while he dreams: the dream goes on; its end leaves him sitting
    t += 6000
    trigger(d, 'dream', t)
    trigger(d, 'turnEnd', t + 100)
    expect(d.mode).toBe('dream')
    trigger(d, 'dreamEnd', t + 10000)
    expect(d.mode).toBe('idle')
  })

  test('the turn ends during the write-up: a notepad asked for in the same instant, or already on screen, plays through before he rests', () => {
    const rand = seeded(3)
    // the save and the end together, nothing drawn in between
    const d = newDirector(0)
    trigger(d, 'turn', 0)
    const t = run(d, 0, 6000, rand).t
    trigger(d, 'note', t)
    trigger(d, 'turnEnd', t + 1)
    const a = run(d, t + 1, t + 6000, rand).shown.map(s => s.frame)
    expect(a.filter(f => f === 'note0').length).toBe(2)
    expect(d.mode).toBe('idle')
    // the notepad on screen: the end leaves its frame up until it is due
    const e = newDirector(0)
    trigger(e, 'turn', 0)
    let u = run(e, 0, 6000, rand).t
    trigger(e, 'note', u)
    while (advance(e, u, rand).step.frame !== 'note0') u = advance(e, u, rand).next
    const due = advance(e, u, rand).next
    expect(trigger(e, 'turnEnd', u + 10)).toBe(false)
    const b = advance(e, u + 10, rand)
    expect(b.step.frame).toBe('note0')
    expect(b.next).toBe(due)
  })

  test('review of #549: a turn writing for 25 min without a tool call stays at work while its model requests go on; one gone quiet stops at 10 min, and then he sits, lies down at 45 s and naps at 2 min, never straight to a nap', () => {
    const rand = seeded(6)
    const d = newDirector(0)
    trigger(d, 'turn', 0)
    let t = 0
    for (let k = 1; k <= 5; k++) {
      t = run(d, t, k * 5 * 60000, rand).t
      expect(trigger(d, 'step', t)).toBe(false) // nothing on screen changes for it
    }
    expect(d.mode).toBe('work')
    // quiet from here: at work till 10 min after the last request, then resting
    const last = t
    t = run(d, t, last + WORK.quietMs - 5000, rand).t
    expect(d.mode).toBe('work')
    const r = run(d, t, last + WORK.quietMs + 200000, rand)
    const after = r.shown.filter(s => s.at >= last + WORK.quietMs - 5000)
    const firstIdle = after.find(s => s.frame === 'idle')?.at ?? Infinity
    const firstLie = after.find(s => s.frame === 'lieBlink')?.at ?? Infinity
    const firstNap = after.find(s => s.frame === 'nap0')?.at ?? Infinity
    expect(firstIdle).toBeLessThan(firstLie)
    expect(firstLie - firstIdle).toBeGreaterThanOrEqual(FOX_FINAL.schedule.lieAfterMs - 5000)
    expect(firstLie).toBeLessThan(firstNap)
    expect(d.mode).toBe('nap')
  })

  test('review of #549: a main-loop call landing after the turn’s end (an Esc during its dispatch) does not reopen work; before any end was heard (a reload mid-turn), or after a prompt, a call opens the turn', () => {
    const rand = seeded(8)
    const d = newDirector(0)
    trigger(d, 'turn', 0)
    let t = run(d, 0, 20000, rand).t
    trigger(d, 'turnEnd', t)
    trigger(d, 'busy', t + 50)
    expect(trigger(d, 'turnCall', t + 50)).toBe(false)
    trigger(d, 'busyEnd', t + 300)
    expect(d.mode).toBe('idle')
    expect(d.turn).toBe('none')
    // even long after: a call's turn is opened by its start, which is heard
    expect(trigger(d, 'turnCall', t + 600000)).toBe(false)
    expect(d.mode).toBe('idle')
    // a prompt, then a call before the start: at work, and the turn is open
    trigger(d, 'prompt', t + 700000)
    trigger(d, 'turnCall', t + 700100)
    expect(d.turn).toBe('open')
    // a fresh module (a reload mid-turn): its first main-loop call opens the turn
    const e = newDirector(0)
    expect(trigger(e, 'turnCall', 1000)).toBe(true)
    expect(e.mode).toBe('work')
  })

  test('review of #549: from the sitting face to the alert one there is always a blink: a moment ending on it during work, work starting from a still hold, the stretch after a dream', () => {
    const rand = seeded(12)
    const NOT_ALERT = new Set(['idle', 'note0', 'note1', 'note2', 'hello0', 'hello1'])
    const pairs = (frames: string[]) => frames.slice(1).filter((f, i) => NOT_ALERT.has(frames[i] ?? '') && f === 'perk').length
    const d = newDirector(0)
    let t = run(d, 0, 6000, rand).t
    trigger(d, 'prompt', t)
    trigger(d, 'turn', t)
    const frames: string[] = []
    frames.push(...run(d, t, t + 10000, rand).shown.map(s => s.frame))
    t += 10000
    for (const ev of ['came', 'hello', 'note', 'came'] as const) {
      trigger(d, ev, t)
      frames.push(...run(d, t, t + 8000, rand).shown.map(s => s.frame))
      t += 8000
    }
    trigger(d, 'dream', t)
    t = run(d, t, t + 20000, rand).t
    trigger(d, 'dreamEnd', t)
    frames.push(...run(d, t, t + 6000, rand).shown.map(s => s.frame))
    expect(frames).toContain('perk')
    expect(frames).toContain('hello0')
    expect(frames).toContain('note1')
    expect(frames).toContain('stretch')
    expect(pairs(frames)).toBe(0)
  })

  test('review of #549: a slash command (look) gets him up from lying or a nap and starts the idle clock over, but it is not work', () => {
    const rand = seeded(5)
    const d = newDirector(0)
    let t = 0
    while (d.mode !== 'lie' || advance(d, t, rand).step.frame !== 'lie0') t = advance(d, t, rand).next
    expect(trigger(d, 'look', t)).toBe(true)
    expect(d.mode).toBe('idle')
    expect(d.turn).toBe('none')
    expect(run(d, t, t + 800, rand).shown.map(s => s.frame).slice(0, 3)).toEqual(['lieBlink', 'blink', 'idle'])
    // left alone after it: lying 45 s on, never at work
    const looked = t
    const r = run(d, t, t + 60000, rand)
    expect(r.shown.some(s => s.frame === 'perk')).toBe(false)
    const lieAt = r.shown.find(s => s.frame === 'lieBlink' && s.at > looked + 1000)?.at ?? 0
    expect(lieAt - looked).toBeGreaterThanOrEqual(FOX_FINAL.schedule.lieAfterMs - 1000)
    // asleep: a stretch up; sitting, nothing changes
    const e = newDirector(0)
    let u = 0
    while (u < 140000) u = advance(e, u, rand).next
    expect(e.mode).toBe('nap')
    trigger(e, 'look', u)
    expect(run(e, u, u + 3000, rand).shown.map(s => s.frame)).toContain('stretch')
    expect(trigger(e, 'look', u + 3000)).toBe(false)
  })

  test('lying or asleep, a turn gets him up and to work; a turn whose end is never heard, and a prompt that starts none, end by themselves; a call still running (a permission prompt) holds him at work', () => {
    const rand = seeded(5)
    const d = newDirector(0)
    let t = 0
    while (d.mode !== 'lie' || advance(d, t, rand).step.frame !== 'lie0') t = advance(d, t, rand).next
    expect(trigger(d, 'turn', t)).toBe(true)
    expect(run(d, t, t + 2500, rand).shown.map(s => s.frame).slice(0, 3)).toEqual(['lieBlink', 'blink', 'perk'])
    // the turn's end is never heard (no calls, nothing): at work for WORK.quietMs, then he rests
    t += 2500
    let r = run(d, t, t + WORK.quietMs - 10000, rand)
    expect(d.mode).toBe('work')
    r = run(d, r.t, r.t + 30000, rand)
    expect(d.mode).not.toBe('work')
    // a call waiting on the person (a permission prompt) for 20 minutes: still at work all through
    const e = newDirector(0)
    trigger(e, 'turn', 0)
    trigger(e, 'busy', 1000)
    r = run(e, 0, 20 * 60000, rand)
    expect(e.mode).toBe('work')
    expect(r.shown.every((s, i) => (i === 0 && s.frame === 'blink') || WORK_FRAMES.has(s.frame))).toBe(true)
    trigger(e, 'busyEnd', r.t)
    r = run(e, r.t, r.t + WORK.quietMs + 30000, rand)
    expect(e.mode).not.toBe('work')
    // a prompt that started no turn (nothing after it): back to sitting after WORK.askMs
    const f = newDirector(0)
    trigger(f, 'prompt', 1000)
    run(f, 1000, 1000 + WORK.askMs - 2000, rand)
    expect(f.mode).toBe('work')
    run(f, 1000 + WORK.askMs - 2000, 1000 + WORK.askMs + 5000, rand)
    expect(f.mode).toBe('idle')
  })

  test('savedSince: a new deposit for this session, accepted, newer than the last notepad and fresh; not another session’s, a refused one, an old one, or one already written', () => {
    const now = T0
    const mine = (at: number, accepted = '1', session = SESSION) => ({ ...ev(9001, 'gate.deposit', 'I wrote something down.', 0, { accepted, session }), at })
    expect(savedSince([mine(now - 5000)], SESSION, -Infinity, now)).toBe(true)
    expect(savedSince([mine(now - 5000, '1', 'sess-other')], SESSION, -Infinity, now)).toBe(false)
    expect(savedSince([mine(now - 5000, '0')], SESSION, -Infinity, now)).toBe(false)
    expect(savedSince([mine(now - 5 * 60000)], SESSION, -Infinity, now)).toBe(false)
    // the memory tool's own hook wrote on the notepad as its call returned, after the rows: written already
    expect(savedSince([mine(now - 5000)], SESSION, now - 4000, now)).toBe(false)
    expect(savedSince([mine(now - 5000)], '', -Infinity, now)).toBe(false)
    expect(savedSince([{ ...mine(now - 5000), name: 'gate.chunk' }], SESSION, -Infinity, now)).toBe(false)
  })

  test('which store: the wake’s marker and a dashboard’s answer; another store only when both are known and differ', () => {
    expect(parseStoreMarker('<!-- counterparts:onboarding meet=done -->\n<!-- counterparts:store id=st_0123456789abcdef -->')).toBe('st_0123456789abcdef')
    expect(parseStoreMarker('<!-- counterparts:store id=st_xyz -->')).toBeNull()
    expect(otherStore('st_0123456789abcdef', 'st_fedcba9876543210')).toBe(true)
    expect(otherStore('st_0123456789abcdef', 'st_0123456789abcdef')).toBe(false)
    expect(otherStore(null, 'st_fedcba9876543210')).toBe(false)
    expect(otherStore('st_0123456789abcdef', null)).toBe(false)
  })
})

describe('the desktop layout', () => {
  test('headRight: the count and the day on the title row, shortened to the room beside the title', () => {
    applyTheme('tron', 'terminal')
    // the terminal: the room is the width less the title's 16 cells and a space
    expect(headRight(22, '1511 memories', 40)).toBe('1511 memories \u00b7 day 22')
    expect(headRight(22, '1511 memories', 30)).toBe('1511 \u00b7 day 22')
    expect(headRight(22, '1511 memories', 24)).toBe('day 22')
    expect(headRight(null, '1511 memories', 40)).toBe('1511 memories')
    // the desktop's font fits a fifth more: the long form at a width where the terminal gives the short one
    applyTheme('tron', 'desktop')
    expect(headRight(22, '1511 memories', 37)).toBe('1511 memories \u00b7 day 22')
    applyTheme('tron', 'terminal')
    expect(headRight(22, '1511 memories', 37)).toBe('1511 \u00b7 day 22')
  })

  test('the desktop chart row: a name column, a bar as a share of its column, a spacer, the count', () => {
    const state = (prose: boolean): BodyState => ({ ...BASE, prose, w: 40, cellsW: 34 })
    const rows = layoutBody(state(true)).lines.filter(l => l.key?.startsWith('mech:'))
    expect(rows.length).toBeGreaterThan(0)
    for (const l of rows) {
      const [name, bar, grow, count] = l.segs
      expect(name?.cw).toBe(16)
      expect(name?.t).not.toMatch(/\s$/)
      expect(bar?.of).toBe(34 - 16 - 4)
      expect(bar?.fill).toBeLessThanOrEqual(bar?.of ?? 0)
      expect(grow?.grow).toBe(true)
      expect(count?.t).toMatch(/^\d+$/)
    }
    // the terminal pads with spaces instead and carries none of it
    const term = layoutBody(state(false)).lines.filter(l => l.key?.startsWith('mech:'))
    for (const l of term) expect(l.segs.some(sg => sg.cw !== undefined || sg.fill !== undefined || sg.grow === true)).toBe(false)
  })
})

describe('the glance: the wake\'s first line that has something', () => {
  const LEFT = 'Where I left off in this directory (written 10-14 19:37 by session 7c992a20 on Opus 5.5): Shipping the onboarding fixes; next is the site deploy.\n(The whole of it is sch_226878f5b865 — expand it with the counterparts recall tool.)'
  const COMING = 'Coming up:\n- 2026-10-11 (due 2026-10-15) · Second check of the lists trial. (earlier: [mem_9d3ce7633f97])\n- 2026-10-20 · Other'
  const YESTERDAY = 'Yesterday, Oct 14: epi_8c87c42ae316; epi_a042be2d13d7; and 2 more.'
  test('Last here first, then where it was left off, then Coming up, then Yesterday; ids and pointers left out', () => {
    expect(parseGlance(`Last here: I, Oct 14 evening, "Fox polish". We tried half-blocks.\n${LEFT}`)).toEqual({ head: 'Last here', text: 'I, Oct 14 evening, "Fox polish". We tried half-blocks.' })
    expect(parseGlance(`${LEFT}\n${COMING}`)).toEqual({ head: 'Last here', text: 'Shipping the onboarding fixes; next is the site deploy.' })
    expect(parseGlance(`${COMING}\n${YESTERDAY}`)).toEqual({ head: 'Coming up', text: '2026-10-15 · Second check of the lists trial.' })
    expect(parseGlance('Yesterday, Oct 14: the fox shipped; the directory submitted.')).toEqual({ head: 'Yesterday, Oct 14', text: 'the fox shipped; the directory submitted.' })
    // At a session start since 2026-10-16 the line carries no date (the `Now:` line does).
    expect(parseGlance('Yesterday: the fox shipped; the directory submitted.')).toEqual({ head: 'Yesterday', text: 'the fox shipped; the directory submitted.' })
  })
  test('short dates (2026-10-16): a Coming up item written `Oct 11 (due Oct 15)` comes out as the one date too', () => {
    const c = (prefix: string) => parseGlance(`Coming up:\n- ${prefix}Vote`)?.text
    expect(c('Oct 11 (due Oct 15) · ')).toBe('Oct 15 · Vote')
    expect(c('due Oct 15 · ')).toBe('Oct 15 · Vote')
    expect(c('was due yesterday, Oct 14 · ')).toBe('Oct 14 · Vote')
    expect(c('Oct 1 (was due yesterday, Oct 14) · ')).toBe('Oct 14 · Vote')
    expect(c('by Sep 3 · ')).toBe('Sep 3 · Vote')
    expect(c('Oct 1 (of Sep 30) · ')).toBe('Oct 1 · Vote')
    const now = new Date('2026-10-15T09:00:00').getTime()
    expect(leadDate('Oct 15 · Vote', now)).toBe('Today · Vote')
    expect(leadDate('Oct 16 · Vote', now)).toBe('Tomorrow · Vote')
    expect(leadDate('Oct 20 · Vote', now)).toBe('Oct 20 · Vote')
  })
  test('every date form core writes before a Coming up item comes out as the one date it is about', () => {
    const c = (prefix: string) => parseGlance(`Coming up:\n- ${prefix}Vote`)?.text
    expect(c('due 2026-10-15 · ')).toBe('2026-10-15 · Vote')
    expect(c('was due 2026-10-14 · ')).toBe('2026-10-14 · Vote')
    expect(c('due 2026-10-15, every Oct 15 · ')).toBe('2026-10-15 · Vote')
    expect(c('2026-05-14 (due 2027-05-14, every May 14) · ')).toBe('2027-05-14 · Vote')
    expect(c('by 2026-10-01 (was due 2026-10-14) · ')).toBe('2026-10-14 · Vote')
    expect(c('2026-10-01 (of 2026-09-30) · ')).toBe('2026-10-01 · Vote')
    expect(c('by 2026-10-20 · ')).toBe('2026-10-20 · Vote')
  })
  test('Yesterday with some titles and some ids: the ids go, and their separators with them', () => {
    expect(parseGlance('Yesterday, Oct 14: "Fox polish" (epi_8c87c42ae316); epi_a042be2d13d7; epi_10ae407be15a; and 3 more.')?.text).toBe('"Fox polish"; and 3 more.')
  })
  test('a Coming up date reads as words', () => {
    const now = new Date('2026-10-15T09:00:00').getTime()
    expect(leadDate('2026-10-15 · Vote', now)).toBe('Today · Vote')
    expect(leadDate('2026-10-16 · Vote', now)).toBe('Tomorrow · Vote')
    expect(leadDate('2026-10-20 · Vote', now)).toBe('Oct 20 · Vote')
    expect(leadDate('no date here', now)).toBe('no date here')
  })
  test('a line of ids only, or nothing at all, is no glance', () => {
    expect(parseGlance(YESTERDAY)).toBeNull()
    expect(parseGlance('Who I am:\nnothing here')).toBeNull()
  })
})
