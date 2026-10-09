/**
 * The world beneath the sidebar in a test: the engine's answers to every `$`
 * call it makes, from fixtures, and a record of what it asked for. Nothing
 * here reaches a network, a store or a real dashboard: `http.fetch` answers
 * from the fixtures below (shapes read off `/api/pulse`, `/api/activity` and a
 * `recall` facts answer; the words are invented).
 */
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On, RenderPropsOf, UiBlitArgs } from 'claude-code'

export const PLUGIN = 'counterparts'
export const PANE = 'counterparts'
/** 2026-10-09, 1:35pm in whatever zone the test runs in. */
export const T0 = new Date(2026, 9, 9, 13, 35, 0).getTime()
export const SESSION = 'sess-0001'

export const PANE_PROPS = {
  title: 'Counterparts',
  isFocused: false,
  bodyColumns: 44,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 80 },
  view: {},
} as unknown as RenderPropsOf['Pane']

export const VIEWPORT = { columns: 180, rows: 60, isFullscreen: true }

export const PULSE = { day: 18, memories: 776, events: 22136, lastSeq: 500 }

export type Ev = { seq: number; at: number; day: number; name: string; text: string; tone: string; subject: string | null; detail: { key: string; value: string }[] }

export function ev(seq: number, name: string, text: string, minutesAgo: number, detail: Record<string, string> = {}): Ev {
  return {
    seq,
    at: T0 - minutesAgo * 60000,
    day: 18,
    name,
    text,
    tone: 'calm',
    subject: null,
    detail: Object.entries(detail).map(([key, value]) => ({ key, value })),
  }
}

/** One event of each kind the sidebar shows, and two it must leave out. */
export const EVENTS: Ev[] = [
  ev(490, 'gate.deposit', 'I wrote something down and every gate was clear.', 10, {
    accepted: '1', kind: 'fact', memoryId: '"The sidebar draws the brain in braille" [mem_aaaa1111]',
  }),
  ev(480, 'recall.decision', 'On turn 7 I kept “Release notes go out on Fridays” as a footnote — near enough to mention, not near enough to say out loud.', 20, {
    session: 'sess-older', turn: '7', surfacedCount: '0', footnoteCount: '1',
  }),
  ev(470, 'recall.decision', 'On turn 6 nothing rose above the turn’s own background, so I said nothing.', 21, {
    session: 'sess-older', turn: '6', surfacedCount: '0', footnoteCount: '0',
  }),
  ev(400, 'dream.journaled', 'I dreamed: the plugin and the brain were one thing.', 600, {}),
  ev(390, 'sleep.cycle', 'I checked whether it was time to sleep: nothing was due.', 601, { faded: '0' }),
]

export const FACTS_ANSWER = [
  '2 match · showing 2',
  '',
  '1. Publishing waits for a test and a review · mem_pub00001 · words, subject',
  '   you said · done · happened 10-09',
  '   learned 10-09 in ~/counterparts · session a1b2c3d4 · CURRENT',
  '   Publishing is mine once it is tested and reviewed.',
  '',
  '2. npm publish needs a one-time password · mem_pub00002 · words',
  '   I said · done · happened 09-24',
  '   learned 09-24 in ~/counterparts · session b2c3d4e5 · CURRENT',
  '   The publish step asks for a one-time password.',
].join('\n')

export const RECALL_BLOCK = [
  '<!-- counterparts:recall t=3 -->',
  '',
  'Came to mind:',
  '- The sidebar slides to a rail of dots',
  '',
  'Quietly available (ignorable; expand an id with recall before citing one):',
  '- Release notes go out on Fridays [mem_rel00001]',
  '<!-- counterparts:recall/end surfaced=1 footnotes=1 affect=0 bytes=260 -->',
].join('\n')

export const NPM_TOOLS = ['note', 'recall', 'scope', 'session_end', 'chapter'].map(t => ({ name: `mcp__counterparts__${t}`, description: t, mcp: true }))
export const PLUGIN_TOOLS = ['note', 'recall', 'scope', 'session_end', 'chapter'].map(t => ({ name: `mcp__plugin_counterparts_counterparts__${t}`, description: t, mcp: true }))

export type WorldOptions = {
  /** The dashboard refuses every request (not running). */
  down?: boolean;
  tools?: { name: string; description: string; mcp: boolean }[];
  placed?: boolean;
  scopeMode?: string;
  store?: Record<string, unknown>;
  /** What the person's permission settings say about the memory tools (`allow` unless given). */
  permission?: 'allow' | 'ask' | 'deny';
}

export type World = {
  clock: MockClock;
  opens: { id: string; columns?: number; title?: string }[];
  statuses: (string | undefined)[];
  toasts: string[];
  blits: UiBlitArgs[];
  fetches: string[];
  mcp: { server: string; tool: string; args: Record<string, unknown> }[];
  invalidations: string[];
  scope: { mode: string };
  lastStatus: () => string;
}

/** Registers the test's answers beneath the plugin; call before the first `$` call. */
export function world(on: On, opts: WorldOptions = {}): World {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on, opts.store ?? {})
  const w: World = {
    clock,
    opens: [],
    statuses: [],
    toasts: [],
    blits: [],
    fetches: [],
    mcp: [],
    invalidations: [],
    scope: { mode: opts.scopeMode ?? 'on' },
    lastStatus: () => w.statuses.filter((s): s is string => typeof s === 'string').at(-1) ?? '',
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    w.opens.push({ id: e.id, ...(e.columns === undefined ? {} : { columns: e.columns }), ...(e.title === undefined ? {} : { title: e.title }) })
    return opts.placed === false && w.opens.length === 1
      ? { value: { isPlaced: false as const, reason: 'opened unasked below 144 columns' } }
      : { value: { isPlaced: true as const } }
  })
  on('ui.status', (_$, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.blit', (_$, e) => {
    w.blits.push(e)
    return { value: {} }
  })
  on('tool.list', () => ({ value: opts.tools ?? NPM_TOOLS }))
  on('tool.check', () => ({ decision: opts.permission ?? 'allow' }))
  on('http.fetch', (_$, e) => {
    w.fetches.push(e.url)
    if (opts.down === true) return { deny: 'ECONNREFUSED: Unable to connect.' }
    const url = new URL(e.url)
    const ok = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (url.pathname === '/api/pulse') return ok(PULSE)
    if (url.pathname === '/api/activity') {
      const name = url.searchParams.get('name')
      const since = url.searchParams.get('sinceSeq')
      const events = EVENTS.filter(x => (name === null || x.name === name) && (since === null || x.seq > Number(since)))
      return ok({ events, total: events.length, lastSeq: PULSE.lastSeq })
    }
    return { value: { status: 404, ok: false, headers: {}, text: '{"error":"not found"}' } }
  })
  on('mcp.call', (_$, e) => {
    w.mcp.push({ server: e.server, tool: e.tool, args: e.args })
    const text = (p: unknown, isError = false) => ({ value: { content: [{ type: 'text', text: JSON.stringify(p) }], isError } })
    if (e.tool === 'scope') {
      if (e.args['mode'] === 'pause') w.scope.mode = 'paused'
      if (e.args['mode'] === 'resume') w.scope.mode = 'on'
      return text({ scope: '/work/project', mode: w.scope.mode, stance: w.scope.mode === 'on' ? 'on' : 'off' })
    }
    if (e.tool === 'recall') return text({ path: 'question', mode: 'facts', answer: FACTS_ANSWER, ids: ['mem_pub00001', 'mem_pub00002'] })
    return text({ reason: 'unknown-tool' }, true)
  })
  return w
}

/** Starts the session the way a terminal REPL does, and lets the first reads land. */
export async function start($: { session: { start: (e: { cwd: string; surface: 'terminal' | 'desktop' | 'mobile' | 'vscode' | null; isInteractive: boolean }) => Promise<unknown> } }, w: World, interactive = true): Promise<void> {
  await $.session.start({ cwd: '/work/project', surface: interactive ? 'terminal' : null, isInteractive: interactive })
  await w.clock.settle()
  await w.clock.settle()
}
