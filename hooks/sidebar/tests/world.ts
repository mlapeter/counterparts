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
export const SESSION = 'sess-0001'
/** The folder the test session runs in. */
export const HERE = '/work/project'
export const PANE = 'counterparts'
/** The test's home folder: the registry is read beside `<HOME>/.counterparts/claude-code.json` unless a settings hook names another. */
export const HOME = '/home/test'
export const SCOPES_FILE = `${HOME}/.counterparts/scopes.json`
/** 2026-10-09, 1:35pm in whatever zone the test runs in. */
export const T0 = new Date(2026, 9, 9, 13, 35, 0).getTime()

export const PANE_PROPS = {
  title: 'Counterparts',
  isFocused: false,
  bodyColumns: 34,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 80 },
  view: {},
} as unknown as RenderPropsOf['Pane']

export const VIEWPORT = { columns: 180, rows: 60, isFullscreen: true }

export const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 130,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as unknown as RenderPropsOf['AbovePrompt']

export const PULSE = { day: 18, memories: 776, events: 22136, lastSeq: 500 }

export type Ev = { seq: number; at: number; day: number; name: string; text: string; tone: string; subject: string | null; detail: { key: string; value: string }[] }

export function ev(seq: number, name: string, text: string, minutesAgo: number, detail: Record<string, string> = {}, subject: string | null = null): Ev {
  return {
    seq,
    at: T0 - minutesAgo * 60000,
    day: 18,
    name,
    text,
    tone: 'calm',
    subject,
    detail: Object.entries(detail).map(([key, value]) => ({ key, value })),
  }
}

/** The memories `/api/memory?id=` knows (the words invented). */
export const MEMORIES: Record<string, { title: string; text: string; kind: string; learnedOn: string }> = {
  mem_aaaa1111: { title: 'The sidebar draws the brain in braille', text: 'Braille dots, two by four a cell.', kind: 'fact', learnedOn: '2026-10-09' },
  mem_sur00001: { title: 'The sidebar is 35 columns wide', text: 'Mike chose 35 columns on 2026-10-10: width is scarce, so nothing decorates.', kind: 'fact', learnedOn: '2026-10-09' },
  mem_rel00001: { title: 'Release notes go out on Fridays', text: 'Every Friday, after the review.', kind: 'event', learnedOn: '2026-10-08' },
  mem_long0001: { title: 'A long write-up of the week', text: Array.from({ length: 60 }, (_, i) => `sentence ${String(i)} of a long write-up.`).join(' '), kind: 'fact', learnedOn: '2026-10-09' },
  mem_old00001: { title: 'The sidebar was 46 columns wide', text: 'v0.1 was wider.', kind: 'fact', learnedOn: '2026-10-01' },
  mem_fade0001: { title: 'An old plan that faded', text: 'It faded at the night.', kind: 'fact', learnedOn: '2026-09-01' },
}

/** Times each fired today, as a v0.2 dashboard's `/api/mechanisms` says them. */
export const FIRED_TODAY: Record<string, number | null> = {
  salience: 3, emotional: 0, decay: 4, interference: 1, retrieval: 12, association: 2, prospective: 0,
  consolidation: 1, dreaming: 1, reconsolidation: 2, 'episodic-semantic': 1, schema: null,
}

export const DREAM = {
  id: 'drm_test0001',
  date: '2026-10-09',
  day: 18,
  state: 'journaled',
  journal: 'I dreamed the plugin and the brain were one thing. Then the rail became a river, and the river carried the titles.',
  counts: { merge: 1, gist: 2, link: 3 },
  changes: [{ action: 'merge', said: 'merged 2 near-copies into one', undone: false }],
}

/** One event of each kind the sidebar shows, and two it must leave out. */
export const EVENTS: Ev[] = [
  // this session's
  ev(490, 'gate.deposit', 'I wrote something down and every gate was clear.', 10, {
    session: SESSION, accepted: '1', kind: 'fact', memoryId: '"The sidebar draws the brain in braille" [mem_aaaa1111]',
  }),
  ev(485, 'recall.decision', 'On turn 2 I kept “Release notes go out on Fridays” and “Publishing waits for a review” as footnotes — near enough to mention, not near enough to say out loud.', 15, {
    session: SESSION, turn: '2', surfacedCount: '0', footnoteCount: '2',
  }),
  // another session's
  ev(480, 'recall.decision', 'On turn 7 I kept “Release notes go out on Fridays” as a footnote — near enough to mention, not near enough to say out loud.', 20, {
    session: 'sess-older', turn: '7', surfacedCount: '0', footnoteCount: '1',
  }),
  ev(470, 'recall.decision', 'On turn 6 nothing rose above the turn’s own background, so I said nothing.', 21, {
    session: 'sess-older', turn: '6', surfacedCount: '0', footnoteCount: '0',
  }),
  ev(400, 'dream.journaled', 'I woke from a dream and wrote it in the dream journal.', 600, {}, 'drm_test0001'),
  ev(399, 'band.transition', '“An old plan that faded” settled back from semantic to episodic.', 601, { site: 'decay', direction: 'down' }, '"An old plan that faded" [mem_fade0001]'),
  ev(398, 'band.promoted', '“The sidebar draws the brain in braille” became core.', 601, {}, '"The sidebar draws the brain in braille" [mem_aaaa1111]'),
  ev(390, 'sleep.cycle', 'I checked whether it was time to sleep: nothing was due.', 601, { faded: '0' }),
]

/** The dashboard's row for this session's turn 3, whose recall block is RECALL_BLOCK: which memory was said in full. */
export const DECISION_T3 = ev(497, 'recall.decision', 'On turn 3 I said “The sidebar is 35 columns wide” and kept “Release notes go out on Fridays” as a footnote.', 0, {
  session: SESSION, turn: '3', surfacedCount: '1', footnoteCount: '1',
  surfaced: JSON.stringify([{ id: 'mem_sur00001', sal: 0.6 }]), footnotes: JSON.stringify([{ id: 'mem_rel00001', sal: 0.5 }]),
})

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
  '- Mike chose 35 columns on 2026-10-10: width is scarce',
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
  /** This folder's scope: its mode, and which folder's entry set it (this one's, by default; null for none). */
  scopeMode?: string;
  scopeSetBy?: string | null;
  /** The pane is drawn and the one shown (`$.ui.panes()`): true unless given. */
  shown?: boolean;
  /** Every blit is refused (the Raster is no longer mounted). */
  blitDeny?: boolean;
  /** The first N blits are refused (a Raster not mounted yet), the rest taken. */
  blitDenyFirst?: number;
  /** The answer a `recall` gets. */
  factsAnswer?: string;
  store?: Record<string, unknown>;
  /** `uname -s` fails, as it does on Windows. */
  windows?: boolean;
  /** What the person's permission settings say about the memory tools (`allow` unless given): the test's `tool.check` answer only; the sidebar reads the folder's state from the registry file, so nothing it does turns on this. */
  permission?: 'allow' | 'ask' | 'deny';
  /** A read of the folder's scope takes this long on the mocked clock (none unless given). */
  scopeReadMs?: number;
  /** The scope registry file is there but `$.fs` refuses to read it. */
  scopesUnreadable?: boolean;
  /** Where the registry is (`SCOPES_FILE` unless given): beside the configuration a settings hook names. */
  registryAt?: string;
  /** Other files the sidebar may read (a settings file), by absolute path. */
  files?: Record<string, string>;
  /** The environment the module reads (`HOME` only, unless given). */
  env?: Record<string, string>;
  /** A dashboard older than v0.2: `/api/mechanisms` says no `firedToday`. */
  oldDashboard?: boolean;
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
  /** Commands the module ran (`$.process.run`): the URL opener. */
  runs: string[][];
  /** Files the module read (`$.fs.read`), in order. */
  fsReads: string[];
  /** The plugin's store as it stands. */
  store: Record<string, unknown>;
  scope: { mode: string; setBy: string | null; resumeTo: string };
  shown: boolean;
  /** Blits still to be answered late (600 ms on the mocked clock) with a refusal. */
  slowDeny: number;
  denied: number;
  /** The status line as it stands: the last text set, or '' when the last call cleared it (or none was made). */
  lastStatus: () => string;
  /** The dashboard's event log (EVENTS to begin with): push to it, and the next poll reads the new ones. */
  events: Ev[];
  /** Each `tail` the hint line under the prompt was handed, in order (undefined: none). */
  tails: (string | undefined)[];
  /** Panes the module closed (`$.ui.close`). */
  closes: string[];
}

/** Registers the test's answers beneath the plugin; call before the first `$` call. */
export function world(on: On, opts: WorldOptions = {}): World {
  const clock = mock.clock(on, { now: T0 })
  // The plugin's own store, kept here so a test can read what was written.
  const store: Record<string, unknown> = { ...(opts.store ?? {}) }
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  const w: World = {
    clock,
    opens: [],
    statuses: [],
    toasts: [],
    blits: [],
    fetches: [],
    mcp: [],
    invalidations: [],
    runs: [],
    fsReads: [],
    store,
    scope: { mode: opts.scopeMode ?? 'on', setBy: opts.scopeSetBy === undefined ? HERE : opts.scopeSetBy, resumeTo: 'on' },
    shown: opts.shown ?? true,
    slowDeny: 0,
    denied: 0,
    lastStatus: () => w.statuses.at(-1) ?? '',
    events: [...EVENTS],
    tails: [],
    closes: [],
  }
  mock.env(on, opts.env ?? { HOME })
  // The scope registry as the server keeps it: `w.scope` is its one entry (none
  // when nothing is set), so a write through the tool shows in the next read.
  const registryAt = opts.registryAt ?? SCOPES_FILE
  const files = opts.files ?? {}
  const registry = () =>
    JSON.stringify({
      version: 1,
      scopes:
        w.scope.setBy === null
          ? {}
          : { [w.scope.setBy]: { mode: w.scope.mode, since: '2026-10-09T13:00:00.000Z', ...(w.scope.mode === 'paused' ? { resumeTo: w.scope.resumeTo } : {}) } },
    })
  on('fs.exists', (_$, e) => ({ value: e.path === registryAt || e.path in files }))
  on('fs.read', (_$, e) => {
    w.fsReads.push(e.path)
    if (e.path === registryAt) return opts.scopesUnreadable === true ? { deny: 'EACCES: permission denied' } : { value: registry() }
    const text = files[e.path]
    return text === undefined ? { deny: `ENOENT: no such file or directory, open '${e.path}'` } : { value: text }
  })
  // Every folder resolves to itself: no links in the test's tree.
  on('fs.stat', (_$, e) => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    w.opens.push({ id: e.id, ...(e.columns === undefined ? {} : { columns: e.columns }), ...(e.title === undefined ? {} : { title: e.title }) })
    if (opts.placed === false && w.opens.length === 1) return { value: { isPlaced: false as const, reason: 'opened unasked below 144 columns' } }
    w.shown = opts.shown ?? true
    return { value: { isPlaced: true as const } }
  })
  on('ui.status', (_$, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.blit', async (_$, e) => {
    if (w.slowDeny > 0) {
      w.slowDeny -= 1
      await clock.sleep(600)
      w.denied += 1
      return { value: { deny: 'not mounted' } }
    }
    if (opts.blitDeny === true || w.denied < (opts.blitDenyFirst ?? 0)) {
      w.denied += 1
      return { value: { deny: 'not mounted' } }
    }
    w.blits.push(e)
    return { value: {} }
  })
  on('ui.panes', () => ({ value: [{ id: PANE, title: 'Counterparts', isShown: w.shown, isFocused: false, isPlaced: w.shown }] }))
  on('ui.close', (_$, e) => {
    w.closes.push(e.id)
    w.shown = false
    return { value: undefined }
  })
  // The engine's own band above the prompt: an empty box, which the sidebar's hook passes through.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return Box({})
  })
  // The engine's hint line under the prompt: what it is handed (the sidebar may add a `tail`).
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    w.tails.push(e.props.tail)
    const { Box } = $.ui.resolve(e)
    return Box({})
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('tool.list', () => ({ value: opts.tools ?? NPM_TOOLS }))
  on('tool.check', () => ({ decision: opts.permission ?? 'allow' }))
  on('process.run', (_$, e) => {
    w.runs.push([...e.argv])
    if (opts.windows === true && e.argv[0] === 'uname') return { deny: 'not found: uname' }
    const out = e.argv[0] === 'uname' ? 'Darwin\n' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', (_$, e) => {
    w.fetches.push(e.url)
    if (opts.down === true) return { deny: 'ECONNREFUSED: Unable to connect.' }
    const url = new URL(e.url)
    const ok = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (url.pathname === '/api/pulse') return ok(PULSE)
    if (url.pathname === '/api/activity') {
      const name = url.searchParams.get('name')
      const since = url.searchParams.get('sinceSeq')
      const events = w.events.filter(x => (name === null || x.name === name) && (since === null || x.seq > Number(since))).sort((a, b) => b.seq - a.seq)
      return ok({ events, total: events.length, lastSeq: Math.max(PULSE.lastSeq, ...w.events.map(x => x.seq)) })
    }
    if (url.pathname === '/api/mechanisms') {
      const mechanisms = Object.entries(FIRED_TODAY).map(([id, v]) => (opts.oldDashboard === true ? { id, status: 'green' } : { id, status: 'green', firedToday: v }))
      return ok({ livedDay: 18, fromDay: 12, days: 7, ...(opts.oldDashboard === true ? {} : { today: '2026-10-09' }), mechanisms, truncated: false })
    }
    if (url.pathname === '/api/mechanism') return ok({ id: url.searchParams.get('id'), found: true, built: true, livedDay: 18, activity: w.events })
    if (url.pathname === '/api/memory') {
      const id = url.searchParams.get('id') ?? ''
      const m = MEMORIES[id]
      return ok(m === undefined ? { found: false, id, absence: 'no such memory' } : { found: true, id, journal: false, confidential: false, ...m })
    }
    if (url.pathname === '/api/dreams') return ok({ dreams: [DREAM] })
    return { value: { status: 404, ok: false, headers: {}, text: '{"error":"not found"}' } }
  })
  on('mcp.call', async (_$, e) => {
    w.mcp.push({ server: e.server, tool: e.tool, args: e.args })
    const text = (p: unknown, isError = false) => ({ value: { content: [{ type: 'text', text: JSON.stringify(p) }], isError } })
    if (e.tool === 'scope') {
      // The server's own rules (mcp/server.ts#scopeTool, scopes.ts): a pause
      // remembers an own on/observer, a resume needs an own entry.
      const mode = e.args['mode']
      if (mode === undefined) {
        if (opts.scopeReadMs !== undefined) await clock.sleep(opts.scopeReadMs)
        return text({ scope: HERE, mode: w.scope.mode, stance: w.scope.mode, ...(w.scope.setBy === null ? {} : { setBy: w.scope.setBy }) })
      }
      const own = w.scope.setBy === HERE
      if (mode === 'resume' && !own) return text({ refused: true, reason: 'nothing-to-resume', detail: 'Nothing is set for this directory.' }, true)
      if (mode === 'pause') {
        w.scope.resumeTo = own && (w.scope.mode === 'on' || w.scope.mode === 'observer') ? w.scope.mode : 'on'
        w.scope.mode = 'paused'
      } else if (mode === 'resume') w.scope.mode = w.scope.resumeTo
      else w.scope.mode = String(mode)
      w.scope.setBy = HERE
      return text({ set: true, scope: HERE, mode: w.scope.mode, stance: w.scope.mode })
    }
    if (e.tool === 'recall') return text({ path: 'question', mode: 'facts', answer: opts.factsAnswer ?? FACTS_ANSWER, ids: ['mem_pub00001', 'mem_pub00002'] })
    return text({ reason: 'unknown-tool' }, true)
  })
  return w
}

/** Starts the session the way a terminal REPL does. Nothing is opened or read yet. */
export async function start($: { session: { start: (e: { cwd: string; surface: 'terminal' | 'desktop' | 'mobile' | 'vscode' | null; isInteractive: boolean }) => Promise<unknown> } }, w: World, interactive = true): Promise<void> {
  await $.session.start({ cwd: HERE, surface: interactive ? 'terminal' : null, isInteractive: interactive })
  await w.clock.settle()
  await w.clock.settle()
}

/** Let what a drawing started (the first dashboard read, the quiet scope read) land. */
export async function settle(w: World): Promise<void> {
  for (let i = 0; i < 4; i++) await w.clock.settle()
}
