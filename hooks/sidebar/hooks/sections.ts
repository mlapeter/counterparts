/**
 * The pane's body, laid out as lines: Memories, Subconscious, Saved this
 * session, Mechanisms today and Last Dream (or a search's results), at the
 * pane's width, folded to its height. Pure: no `$`, no engine. The hooks
 * module hands the result to the `Client` surface module (`./body.tsx`),
 * which draws the lines and reads clicks by row.
 *
 * Lineage: the round-3 mockups Mike chose on 2026-10-10
 * (`~/counterparts-notes/mockups/2026-10-10-mod-round3/compose/compose3.ts`):
 * its palette, its heading (`Label ──── right`), its wrap and clip, its
 * half-height bars and its fold ladder, with the round-3 decisions that
 * override its PNGs (FEEDBACK-all.md): "Memories ──── 10:25" and
 * "Subconscious ────" are two headings; each saved item starts with its stage
 * dot on its first line only, wrapped lines back at the left edge.
 *
 * Mike's rules, everywhere: width is scarce, so no decoration that takes a
 * column across many lines (no quote rules, gutters, hanging indents or
 * bullets on list items); space goes to information, never to saying what
 * isn't shown (no "+N more" line); an item opens in place when it is short.
 */

import type {
  SidebarDream,
  SidebarMechOpen,
  SidebarMemoryRef,
  SidebarMind,
  SidebarOpen,
  SidebarSaved,
  SidebarSearch,
  SidebarToday,
} from '../types'
import { dateOf, hm } from './feed'
import { MECHS, STAGES, hex, stageOf } from './mechanisms'
import type { MechId } from './mechanisms'
import { cells, headCells } from './width'

/** The mockups' palette: neutral text, stage colours only on dots and bars. */
export const P = {
  panel: '#05080c',
  hi: '#dde3e9',
  text: '#b3bcc5',
  mid: '#8e98a2',
  dim: '#66717c',
  faint: '#1d262e',
  head: '#c9d1d8',
  cyan: '#00e5ff',
  amber: '#ffb347',
} as const

/** Bars a shade under the site's full stage colour. */
const BAR_K = 0.84

/**
 * THE EXPAND THRESHOLD: an item opens in place when its text takes at most
 * this many lines at the pane's width (under it, one more line says what it
 * is); longer, a click opens it on the dashboard instead. Twelve lines of 32
 * columns is about 350 characters. Measured on
 * 77 of the live store's newest memories (2026-10-10): the median text is
 * 626 characters, so about one in nine opens in place and the rest open the
 * dashboard. A working default for Mike to judge.
 */
export const EXPAND_MAX_LINES = 12

export type Seg = { t: string; c: string; b?: true; i?: true }
/** One row of the body: its pieces, and what a click on it names. */
export type Line = { segs: Seg[]; key?: string }

const seg = (t: string, c: string, o: { b?: boolean; i?: boolean } = {}): Seg => ({ t, c, ...(o.b ? { b: true as const } : {}), ...(o.i ? { i: true as const } : {}) })
const line = (segs: Seg[], key?: string): Line => (key === undefined ? { segs } : { segs, key })
const BLANK: Line = { segs: [] }

// ── text ───────────────────────────────────────────────────────────────────

const TRAIL = /[\s,;:·—–-]+$/

/**
 * Word wrap to `width` cells (the first line to `first`); past `maxLines`
 * the last line ends at a word with `…`. A word longer than a line is cut.
 */
export function wrapN(text: string, width: number, maxLines = 99, first = width): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  const room = (): number => Math.max(1, lines.length === 0 ? first : width)
  let i = 0
  while (i < words.length) {
    const w = room()
    if (lines.length === maxLines - 1) {
      const rest = words.slice(i).join(' ')
      if (cells(rest) <= w) {
        lines.push(rest)
        return lines
      }
      let s = ''
      for (let j = i; j < words.length; j++) {
        const t = s === '' ? (words[j] ?? '') : `${s} ${words[j] ?? ''}`
        if (cells(`${t.replace(TRAIL, '')}…`) > w) break
        s = t
      }
      if (s === '') s = headCells(words[i] ?? '', w - 1)
      lines.push(`${s.replace(TRAIL, '')}…`)
      return lines
    }
    let cur = words[i] ?? ''
    if (cells(cur) > w) {
      const head = headCells(cur, w)
      lines.push(head)
      words[i] = cur.slice(head.length)
      continue
    }
    i += 1
    while (i < words.length && cells(cur) + 1 + cells(words[i] ?? '') <= w) {
      cur += ` ${words[i] ?? ''}`
      i += 1
    }
    lines.push(cur)
  }
  return lines
}

/** One line: the whole text if it fits, else cut mid-word with `…`, so the line is used to its last cell. */
export function clip(s: string, w: number): string {
  if (cells(s) <= w) return s
  let cut = headCells(s, Math.max(0, w - 1))
  const next = s.slice(cut.length, cut.length + 1)
  // a stub of one or two letters reads worse than nothing: end at the word before it
  const sp = cut.lastIndexOf(' ')
  if (next !== ' ' && sp > 0 && cells(cut) - sp - 1 <= 2) cut = cut.slice(0, sp)
  return `${cut.replace(TRAIL, '')}…`
}

/** `Label ──── right`: the label bold, a faint rule, the right dim (folded: `right ›`, a little brighter). */
export function heading(label: string, right: string, w: number, o: { folded?: boolean; key?: string } = {}): Line {
  const r = o.folded === true ? `${right} ›`.trim() : right
  const segs: Seg[] = [seg(label, P.head, { b: true })]
  const ruleN = w - cells(label) - 1 - (r === '' ? 0 : cells(r) + 1)
  if (ruleN >= 1) segs.push(seg(` ${'─'.repeat(ruleN)}`, P.faint))
  if (r !== '') segs.push(seg(ruleN >= 1 ? ` ${r}` : ` ${r}`, o.folded === true ? P.mid : P.dim))
  return line(segs, o.key)
}

/** Lines of plain text in one colour, each carrying the key. */
function plain(texts: readonly string[], c: string, key?: string, o: { b?: boolean; i?: boolean } = {}): Line[] {
  return texts.map(t => line([seg(t, c, o)], key))
}

// ── what the body is drawn from ──────────────────────────────────────────────

export type BodyState = {
  /** Text columns (the pane's body less its padding). */
  w: number
  /** Rows the body may take before the footer. */
  rows: number
  now: number
  mind: SidebarMind | null
  saved: readonly SidebarSaved[]
  today: SidebarToday | null
  dream: SidebarDream | null
  open: SidebarOpen | null
  mech: SidebarMechOpen | null
  focus: string | null
  dash: 'unknown' | 'up' | 'down'
  search: SidebarSearch
}

/** How far each section is folded: the ladder's knobs. */
type Fold = {
  memLines: number
  /** An opened item's text, in lines. */
  text: number
  /** Subconscious items shown; 0 folds it to its heading. */
  sub: number
  savedShow: number
  savedLines: number
  savedFolded: boolean
  chartFolded: boolean
  events: number
  dreamLines: number
  excerpt: number
  dreamFolded: boolean
  mindFolded: boolean
}

const FULL: Fold = {
  memLines: 3, text: 99, sub: 4, savedShow: 99, savedLines: 2, savedFolded: false, chartFolded: false,
  events: 6, dreamLines: 3, excerpt: 9, dreamFolded: false, mindFolded: false,
}

/** One fold of the ladder; `fold` when it folds a section to its heading. */
type Step = { label: string; section: string; apply: (f: Fold) => Fold; fold: boolean }
const step = (label: string, section: string, apply: (f: Fold) => Fold): Step => ({ label, section, apply, fold: label.endsWith('folded') })
const savedLines1 = step('saved 1 line each', 'saved', f => ({ ...f, savedLines: 1 }))
const savedTo = (n: number) => step(`saved shows ${String(n)}`, 'saved', f => ({ ...f, savedShow: Math.min(f.savedShow, n), savedLines: 1 }))
const savedFold = step('saved folded', 'saved', f => ({ ...f, savedFolded: true }))
const subTo = (n: number) => step(`subconscious ${String(n)}`, 'sub', f => ({ ...f, sub: Math.min(f.sub, n) }))
const dreamTo = (n: number) => step(`dream ${String(n)} lines`, 'dream', f => ({ ...f, dreamLines: Math.min(f.dreamLines, n) }))
const excerptTo = (n: number) => step(`dream excerpt ${String(n)} lines`, 'dream', f => ({ ...f, excerpt: Math.min(f.excerpt, n) }))
const textTo = (n: number) => step(`opened text ${String(n)} lines`, 'open', f => ({ ...f, text: Math.min(f.text, n) }))
const eventsTo = (n: number) => step(`events ${String(n)}`, 'chart', f => ({ ...f, events: Math.min(f.events, n) }))
const memTo = (n: number) => step(`memory titles ${String(n)} lines`, 'mind', f => ({ ...f, memLines: Math.min(f.memLines, n) }))
const chartFold = step('chart folded', 'chart', f => ({ ...f, chartFolded: true }))
const mindFold = step('memories folded', 'mind', f => ({ ...f, mindFolded: true, sub: 0 }))
const dreamFold = step('dream folded', 'dream', f => ({ ...f, dreamFolded: true }))
const SAVED_DOWN = [savedLines1, savedTo(3), savedTo(2), savedTo(1), savedFold]

/**
 * WHAT FOLDS FIRST, per what is open (compose3.ts's ladder, Mike approved
 * its 160x48 result): saved items go to one line, then fewer, then the
 * section folds to its heading; then the dream shortens, the subconscious
 * shows fewer; the chart and the memories fold last. An opened item keeps
 * its room longest: the rest folds around it.
 */
const LADDERS: Readonly<Record<'default' | 'open' | 'mech' | 'dream', readonly Step[]>> = {
  default: [...SAVED_DOWN, dreamTo(2), subTo(3), subTo(2), dreamTo(1), subTo(1), memTo(2), subTo(0), chartFold, mindFold, dreamFold],
  // An item opens in place only when its text is short (EXPAND_MAX_LINES), so its text is the last to give way;
  // the dream (two rows) folds before the chart (twelve).
  open: [...SAVED_DOWN, dreamTo(1), subTo(1), subTo(0), dreamFold, chartFold, textTo(8), textTo(5)],
  mech: [...SAVED_DOWN, dreamTo(1), mindFold, eventsTo(4), eventsTo(2), dreamFold, eventsTo(1)],
  dream: [chartFold, excerptTo(7), excerptTo(5), excerptTo(3), ...SAVED_DOWN, subTo(1), subTo(0), mindFold],
}

// ── the sections ─────────────────────────────────────────────────────────────

/** An opened memory in place: its title in full (bold, after `dot` on its first line when given), its text, and what it is. */
function opened(s: BodyState, key: string, fallbackTitle: string, f: Fold, dot?: Seg): Line[] {
  const o = s.open
  const title = o?.title ?? fallbackTitle
  const out = wrapN(title, s.w, 4, dot === undefined ? s.w : s.w - cells(dot.t)).map((t, i) =>
    line([...(i === 0 && dot !== undefined ? [dot] : []), seg(t, P.hi, { b: true })], key),
  )
  if (o === null || o.key !== key) return out
  if (o.status === 'loading') return [...out, line([seg('opening…', P.dim)], key)]
  if (o.status === 'error') return [...out, ...plain(wrapN(o.text || "couldn't read it: the dashboard isn't answering", s.w, 2), P.dim, key)]
  if (o.text !== '') out.push(...plain(wrapN(o.text, s.w, f.text), P.text, key))
  if (o.meta !== null) out.push(line([seg(o.meta, P.dim)], key))
  return out
}

function memories(s: BodyState, f: Fold): Line[] {
  const m = s.mind
  if (m === null || m.surfaced.length === 0) return []
  const time = hm(m.at, s.now)
  if (f.mindFolded && s.open?.key.startsWith('mem:') !== true) return [heading('Memories', time, s.w, { folded: true, key: 'head:mind' })]
  const out: Line[] = [heading('Memories', time, s.w, { key: 'head:mind' })]
  m.surfaced.forEach((r, i) => {
    const key = `mem:${String(i)}`
    if (s.open?.key === key) out.push(...opened(s, key, r.title, f))
    else out.push(...plain(wrapN(r.title, s.w, f.memLines), P.hi, key))
  })
  return out
}

function subTitle(r: SidebarMemoryRef, key: string, w: number): Line {
  const mark = r.opened === true ? ' ↗ opened' : ''
  const t = clip(r.title, w - cells(mark))
  const segs = [seg(t, r.opened === true ? P.text : P.mid)]
  if (r.opened === true) segs.push(seg(' ', P.dim), seg('↗', P.cyan), seg(' opened', P.dim))
  return line(segs, key)
}

function subconscious(s: BodyState, f: Fold): Line[] {
  const m = s.mind
  if (m === null || m.footnotes.length === 0) return []
  // The time goes here only when Memories, which carries it, is not drawn.
  const time = m.surfaced.length === 0 ? hm(m.at, s.now) : ''
  const openIdx = s.open?.key.startsWith('sub:') === true ? Number(s.open.key.slice(4)) : -1
  const n = Math.min(m.footnotes.length, Math.max(f.sub, openIdx + 1))
  if (n === 0) {
    const right = time === '' ? String(m.footnotes.length) : `${String(m.footnotes.length)} · ${time}`
    return [heading('Subconscious', right, s.w, { folded: true, key: 'head:mind' })]
  }
  const out: Line[] = [heading('Subconscious', time, s.w, { key: 'head:mind' })]
  m.footnotes.slice(0, n).forEach((r, i) => {
    const key = `sub:${String(i)}`
    out.push(...(s.open?.key === key ? opened(s, key, r.title, f) : [subTitle(r, key, s.w)]))
  })
  return out
}

function stageDot(kind: SidebarSaved['kind']): string {
  return hex(kind === 'new' ? STAGES.encoding.col : STAGES.transformation.col)
}

function saved(s: BodyState, f: Fold): Line[] {
  const n = s.saved.length
  if (n === 0) return []
  if (f.savedFolded && s.open?.key.startsWith('saved:') !== true) return [heading('Saved this session', String(n), s.w, { folded: true, key: 'head:saved' })]
  const out: Line[] = [heading('Saved this session', String(n), s.w, { key: 'head:saved' })]
  // An opened item is never folded away: the list shows at least down to it.
  const openIdx = s.saved.findIndex(it => s.open?.key === `saved:${it.key}`)
  for (const it of s.saved.slice(0, Math.min(Math.max(f.savedShow, openIdx + 1), n))) {
    const key = `saved:${it.key}`
    if (s.open?.key === key) out.push(...opened(s, key, it.title, f, seg('● ', stageDot(it.kind))))
    else {
      // The stage dot on the first line only; wrapped lines go back to the left edge.
      const ls = f.savedLines > 1 ? wrapN(it.title, s.w, f.savedLines, s.w - 2) : [clip(it.title, s.w - 2)]
      ls.forEach((t, i) => {
        out.push(i === 0 ? line([seg('● ', stageDot(it.kind)), seg(t, P.hi)], key) : line([seg(t, P.text)], key))
      })
    }
    if (it.kind === 'update') {
      const what = it.replaces ?? 'an earlier memory'
      out.push(line([seg('replaces', P.mid), seg(clip(` ${what}`, s.w - 8), P.dim)], key))
    }
  }
  return out
}

/** `▄▄▄▖`: a half-height bar in half-cell steps, at least one half. */
export function bar(v: number, max: number, width: number): string {
  const halves = Math.max(1, Math.round((v / Math.max(1, max)) * width * 2))
  return '▄'.repeat(Math.floor(halves / 2)) + (halves % 2 === 1 ? '▖' : '')
}

function chart(s: BodyState, f: Fold): Line[] {
  const t = s.today
  if (t === null) {
    if (s.dash === 'down') {
      return [
        heading('Mechanisms today', '', s.w),
        ...plain(wrapN("The dashboard isn't running, so these can't be counted. Start it with", s.w), P.dim),
        line([seg('counterparts dashboard', P.cyan)]),
      ]
    }
    return [heading('Mechanisms today', '', s.w), line([seg('reading the dashboard…', P.dim)])]
  }
  const fired = MECHS.filter(m => (t.counts[m.id] ?? 0) > 0).length
  if (f.chartFolded) return [heading('Mechanisms today', `${String(fired)} fired`, s.w, { folded: true, key: 'head:chart' })]
  const NAME = 16
  const CNT = 4
  const barW = Math.max(4, s.w - NAME - CNT)
  const max = Math.max(1, ...MECHS.map(m => t.counts[m.id] ?? 0))
  const out: Line[] = [heading('Mechanisms today', 'times fired', s.w, { key: 'head:chart' })]
  for (const m of MECHS) {
    const v = t.counts[m.id]
    const key = `mech:${m.id}`
    const picked = s.mech?.id === m.id
    if (v === null || m.notBuilt === true) {
      out.push(line([seg(m.short.padEnd(NAME), P.dim), seg(clip('○ not built yet', s.w - NAME), P.dim)], key))
      continue
    }
    const n = v ?? 0
    const name = seg(clip(m.short, NAME - 1).padEnd(NAME), n === 0 ? P.dim : picked ? P.hi : P.text, { b: picked })
    const b = n > 0 ? bar(n, max, barW) : ''
    const cs = String(n)
    const pad = Math.max(1, s.w - NAME - cells(b) - cs.length)
    out.push(line([name, seg(b, hex(stageOf(m.id).col, BAR_K)), seg(' '.repeat(pad), P.dim), seg(cs, n === 0 ? P.dim : picked ? P.hi : P.mid)], key))
    if (picked) out.push(...mechEvents(s, f))
  }
  return out
}

/** The opened mechanism's recent firings, grouped under what happened and when (`faded at 8:07:`), each title a line. */
function mechEvents(s: BodyState, f: Fold): Line[] {
  const m = s.mech
  if (m === null) return []
  if (m.status === 'loading') return [line([seg('reading…', P.dim)], `mech:${m.id}`)]
  if (m.status === 'error') return plain(wrapN("couldn't read it: the dashboard isn't answering", s.w), P.dim, `mech:${m.id}`)
  if (m.events.length === 0) return [line([seg('nothing lately', P.dim)], `mech:${m.id}`)]
  const out: Line[] = []
  let last = ''
  for (const e of m.events.slice(0, f.events)) {
    const when = hm(e.at, s.now)
    const head = `${e.word} ${when.includes(':') ? 'at ' : ''}${when}:`
    if (head !== last) {
      out.push(line([seg(clip(head, s.w), P.mid)], `mech:${m.id}`))
      last = head
    }
    const key = `ev:${String(e.seq)}`
    if (s.open?.key === key) {
      if (e.memoryId === null && s.open.title === null) out.push(...plain(wrapN(e.text, s.w, f.text), P.hi, key, { b: true }))
      else out.push(...opened(s, key, e.title, f))
    } else out.push(line([seg(clip(e.title, s.w), P.text)], key))
  }
  return out
}

function dream(s: BodyState, f: Fold): Line[] {
  const d = s.dream
  if (d === null) return []
  // its journal row's time; failing that its date before today, and nothing for today (no made-up time)
  const when = d.at !== null ? hm(d.at, s.now) : d.date !== null && d.date !== dateOf(s.now) ? hm(new Date(`${d.date}T12:00:00`).getTime(), s.now) : ''
  if (f.dreamFolded) return [heading('Last Dream', when, s.w, { folded: true, key: 'head:dream' })]
  const out: Line[] = [heading('Last Dream', when, s.w, { key: 'dream' })]
  if (s.open?.key !== 'dream') return [...out, ...plain(wrapN(d.first, s.w, f.dreamLines), P.text, 'dream', { i: true })]
  const body = f.excerpt <= 3 || d.rest === '' ? d.first : `${d.first} ${d.rest}`
  out.push(...plain(wrapN(body, s.w, f.excerpt), P.text, 'dream', { i: true }))
  if (d.changed.length > 0) {
    const lastNight = d.date === null || d.at === null || hm(d.at, s.now).includes(':')
    out.push(line([seg(lastNight ? 'what changed last night:' : 'what changed that night:', P.mid)], 'dream'))
    out.push(...d.changed.map(t => line([seg(clip(t, s.w), P.text)], 'dream')))
  }
  return out
}

function searchResults(s: BodyState): Line[] {
  const q = s.search
  const right = q.status === 'running' ? 'searching' : q.status === 'done' ? `${String(q.total)} found ✕` : '✕'
  const out: Line[] = [heading(clip(`“${q.query}”`, Math.max(6, s.w - cells(right) - 4)), right, s.w, { key: 'search:clear' })]
  if (q.status === 'error') return [...out, ...plain(wrapN(q.error ?? 'the search was refused', s.w), P.dim)]
  if (q.status === 'done' && q.hits.length === 0) return [...out, line([seg('nothing matches', P.dim)])]
  for (const h of q.hits) {
    const key = `hit:${h.id}`
    if (s.open?.key === key) {
      out.push(...plain(wrapN(h.title, s.w, 4), P.hi, key, { b: true }))
      if (h.excerpt !== '') out.push(...plain(wrapN(h.excerpt, s.w, EXPAND_MAX_LINES - 2), P.text, key))
      out.push(line([seg(clip(h.meta, s.w), P.dim)], key))
    } else {
      out.push(...plain(wrapN(h.title, s.w, 2), P.hi, key))
      out.push(line([seg(clip(h.meta, s.w), P.dim)], key))
    }
  }
  return out
}

// ── the ladder ───────────────────────────────────────────────────────────────

function sectionsOf(s: BodyState, f: Fold): Line[][] {
  return [memories(s, f), subconscious(s, f), saved(s, f), chart(s, f), dream(s, f)].filter(x => x.length > 0)
}

function total(secs: readonly Line[][], gaps: boolean): number {
  return secs.reduce((a, r) => a + r.length, 0) + (gaps ? Math.max(0, secs.length - 1) : 0)
}

function joined(secs: readonly Line[][], gaps: boolean): Line[] {
  const out: Line[] = []
  secs.forEach((sec, i) => {
    if (gaps && i > 0) out.push(BLANK)
    out.push(...sec)
  })
  return out
}

/** Which ladder: what is open decides what keeps its room. */
function ladderFor(s: BodyState): readonly Step[] {
  if (s.mech !== null) return LADDERS.mech
  if (s.open?.key === 'dream') return LADDERS.dream
  if (s.open !== null) return LADDERS.open
  return LADDERS.default
}

/**
 * The body: the least folding that fits with a blank row between sections;
 * failing that, without the blank rows; then any fold the last one made
 * unnecessary is opened again, the most important first. A section the
 * person opened from its folded heading (`focus`) is never folded to its
 * heading again (it may still shorten). Past the ladder's end the body is as
 * it stands and the pane scrolls.
 */
export function layoutBody(s: BodyState): { lines: Line[]; folds: string[] } {
  if (s.search.status !== 'idle') return { lines: searchResults(s), folds: [] }
  // The focused section never folds to its heading, and shortens only after every other section has folded.
  const mine = (st: Step): boolean => st.section === s.focus || (s.focus === 'mind' && st.section === 'sub')
  const ladder = ladderFor(s).filter(st => !(mine(st) && (st.fold || st.label === 'subconscious 0')))
  const steps = [...ladder.filter(st => !mine(st)), ...ladder.filter(mine)]
  const build = (on: ReadonlySet<number>): Line[][] => sectionsOf(s, steps.reduce((f, st, i) => (on.has(i) ? st.apply(f) : f), FULL))
  const fit = (gaps: boolean): { on: Set<number>; secs: Line[][] } | null => {
    for (let k = 0; k <= steps.length; k++) {
      let on = new Set(Array.from({ length: k }, (_, i) => i))
      let secs = build(on)
      if (total(secs, gaps) > s.rows) continue
      for (let i = k - 2; i >= 0; i--) {
        const less = new Set(on)
        less.delete(i)
        const b = build(less)
        if (total(b, gaps) <= s.rows) {
          on = less
          secs = b
        }
      }
      return { on, secs }
    }
    return null
  }
  for (const gaps of [true, false]) {
    const got = fit(gaps)
    if (got !== null) return { lines: joined(got.secs, gaps), folds: [...got.on].sort((a, b) => a - b).map(i => steps[i]?.label ?? '') }
  }
  const all = new Set(steps.map((_, i) => i))
  return { lines: joined(build(all), false), folds: steps.map(st => st.label) }
}

/** The lines an item's text takes at width `w`: what the expand threshold is measured on. */
export function openedLines(text: string, w: number): number {
  return text === '' ? 0 : wrapN(text, w).length
}

/** For tests: the body's text, a line a string. */
export function textOf(lines: readonly Line[]): string[] {
  return lines.map(l => l.segs.map(x => x.t).join(''))
}

export type { MechId }
