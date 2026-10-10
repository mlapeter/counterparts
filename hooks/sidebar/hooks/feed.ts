/**
 * What the sidebar reads, turned into its own terms: the dashboard's event
 * feed (which mechanisms each event proves, and whose it is), the recall block
 * the classic UserPromptSubmit hook injects, a `recall` facts answer, the
 * memory tools' calls this session, a dream, and a mechanism's recent firings.
 * Pure: no `$`.
 *
 * WHICH EVENTS ARE A MECHANISM FIRING is the dashboard's table
 * (`src/adapters/mechanism-evidence.ts`, MECHANISM_EVIDENCE): an event name,
 * sometimes a condition on its payload, and the mechanism it proves. One event
 * can prove several: a dream that merged near-copies and wrote a gist proves
 * Dreaming, Interference, Consolidation and Gist. This file keeps a copy of
 * the names and conditions, not an import — a hooks module reaches nothing
 * outside its plugin folder but through `$`. The repository's bun test
 * `test/sidebar-mechanism-drift.test.ts` fails when the copy and the table
 * disagree.
 */

import type { SidebarHit, SidebarMechEvent, SidebarRow, SidebarSaved } from '../types';
import { MECHS, MEMORIES_URL, mechById, mechUrl } from './mechanisms';
import type { MechId } from './mechanisms';
import { cells, ellipsizeCells, headCells } from './width';

/** One event the sidebar read (the contract's SidebarRow). */
export type FeedRow = SidebarRow;

/** One event as `/api/activity` narrates it. */
export type DashEvent = {
  seq: number;
  at: number;
  day?: number;
  name: string;
  text: string;
  subject?: string | null;
  detail?: readonly { key: string; value: string }[];
};

function detail(e: DashEvent, key: string): string | undefined {
  return e.detail?.find(d => d.key === key)?.value;
}
function num(e: DashEvent, key: string): number {
  const v = Number(detail(e, key));
  return Number.isFinite(v) ? v : 0;
}
/** `"Title…" [mem_abc]` → the title and the id. */
export function titled(value: string | null | undefined): { title: string | null; id: string | null } {
  if (value === undefined || value === null) return { title: null, id: null };
  const m = /^"([\s\S]*)"\s*\[([A-Za-z]+_[A-Za-z0-9]+)\]$/.exec(value.trim());
  if (m !== null) return { title: m[1] ?? null, id: m[2] ?? null };
  const bare = /\[([A-Za-z]+_[A-Za-z0-9]+)\]/.exec(value);
  return { title: null, id: bare?.[1] ?? null };
}

type Rule = { name: string; mech: MechId; word: string; when?: (e: DashEvent) => boolean };

/**
 * The event names that prove a mechanism fired, in the dashboard's words. An
 * event counts when any rule for its name holds. The FIRST that holds gives
 * it its word and colour (`mech`); EVERY one that holds lights (`mechs`).
 */
export const RULES: readonly Rule[] = [
  { name: 'gate.deposit', mech: 'salience', word: 'kept', when: e => num(e, 'accepted') > 0 },
  { name: 'gate.chunk', mech: 'salience', word: 'kept', when: e => num(e, 'accepted') > 0 },
  { name: 'recall.decision', mech: 'retrieval', word: 'recalled', when: e => num(e, 'surfacedCount') + num(e, 'footnoteCount') > 0 },
  { name: 'recall.decision', mech: 'emotional', word: 'brought closer', when: e => num(e, 'moodMatched') > 0 },
  { name: 'mcp.recall', mech: 'retrieval', word: 'looked up' },
  { name: 'recall.credit', mech: 'retrieval', word: 'strengthened', when: e => num(e, 'credited') > 0 },
  { name: 'associate.flush', mech: 'association', word: 'linked', when: e => num(e, 'rows') > 0 },
  { name: 'prospective.plain', mech: 'prospective', word: 'reminded' },
  { name: 'prospective.fire', mech: 'prospective', word: 'reminded' },
  { name: 'band.transition', mech: 'decay', word: 'faded', when: e => detail(e, 'site') === 'decay' && detail(e, 'direction') !== 'up' },
  { name: 'band.transition', mech: 'consolidation', word: 'rose', when: e => detail(e, 'site') === 'consolidate' },
  { name: 'memory.pruned', mech: 'decay', word: 'let go' },
  { name: 'sleep.cycle', mech: 'decay', word: 'faded', when: e => num(e, 'faded') > 0 },
  { name: 'band.promoted', mech: 'consolidation', word: 'became core' },
  { name: 'memory.merged', mech: 'consolidation', word: 'merged' },
  { name: 'dream.journaled', mech: 'dreaming', word: 'dreamed' },
  // A change the dream made, or a core suggestion (`applied` counts both).
  { name: 'dream.changed', mech: 'dreaming', word: 'dreamed', when: e => num(e, 'applied') > 0 || num(e, 'nominate-core') > 0 },
  { name: 'dream.changed', mech: 'episodic-semantic', word: 'dreamed a pattern', when: e => num(e, 'gist') > 0 },
  { name: 'dream.changed', mech: 'interference', word: 'merged in a dream', when: e => num(e, 'merge') > 0 },
  { name: 'dream.changed', mech: 'consolidation', word: 'merged in a dream', when: e => num(e, 'merge') > 0 },
  { name: 'contradiction.flagged', mech: 'interference', word: 'flagged' },
  { name: 'contradiction.settled', mech: 'reconsolidation', word: 'settled' },
  // Settled `changed`: the earlier memory fades under the one that holds.
  { name: 'contradiction.settled', mech: 'interference', word: 'replaced', when: e => detail(e, 'how') === 'changed' },
  { name: 'revision.pressure', mech: 'reconsolidation', word: 'weighed' },
];

/** The names worth asking the dashboard for one by one. */
export const RULE_NAMES: readonly string[] = [...new Set(RULES.map(r => r.name))];

/** The rules `e` proves, one a mechanism, the event's own first; none when it proves nothing. */
export function provedBy(e: DashEvent): Rule[] {
  const out: Rule[] = [];
  for (const r of RULES) {
    if (r.name !== e.name || (r.when !== undefined && !r.when(e))) continue;
    if (!out.some(o => o.mech === r.mech)) out.push(r);
  }
  return out;
}

/** A row's mechanisms, its own first (a row from before rows carried `mechs`: its own alone). */
export function mechsOf(r: SidebarRow): MechId[] {
  return Array.isArray(r.mechs) && r.mechs.length > 0 ? r.mechs : [r.mech];
}

/**
 * The events that belong to no session: the night's sleep and dreams, and
 * what they settle (fading, merging, promoting). Everything else carries the
 * session it happened in (`detail.session`), or is a session's boundary work.
 */
const NIGHT = new Set([
  'dream.journaled', 'dream.changed', 'band.transition', 'memory.pruned', 'memory.merged',
  'band.promoted', 'sleep.cycle', 'contradiction.flagged', 'contradiction.settled', 'revision.pressure',
]);

/** The titles a recall narration quotes (“…”). */
export function quotedTitles(text: string): string[] {
  return [...text.matchAll(/“([^”]+)”/g)].map(m => m[1] ?? '').filter(t => t.length > 0);
}

/**
 * A dashboard event in the sidebar's terms, or null when it proves no
 * mechanism. `session` is this session's id: its own events are `here`, the
 * night's `night`, other sessions' `other` (they never light this brain).
 *
 * WHOSE IT IS. An event's `session` (or, for a settle a session made, its
 * `actorId`) names it. A look-up (`mcp.recall`), a reminder
 * (`prospective.*`) and a link flush (`associate.flush`) name none yet (a
 * core follow-up: add `session` to those payloads, and the read below takes
 * it): one of those from after this session began (`since`) is taken as this
 * session's, one from before as another's.
 */
export function classify(e: DashEvent, session = '', since = 0): FeedRow | null {
  const proved = provedBy(e);
  const rule = proved[0];
  if (rule === undefined) return null;
  const m = mechById(rule.mech);
  const short = m?.short ?? rule.mech;
  // A settle or a revision a session made names it as its actor, not as `session`.
  const bySession = detail(e, 'actor') === 'session';
  const from = detail(e, 'session') ?? (bySession ? detail(e, 'actorId') : undefined);
  const mine = session !== '';
  const who: FeedRow['who'] =
    NIGHT.has(e.name) && !bySession
      ? 'night'
      : from !== undefined
        ? mine && from === session ? 'here' : 'other'
        : e.at >= since ? 'here' : 'other';
  // The memory it is about: a deposit's `memoryId`, a fade's or a promotion's subject, a settle's `over`.
  const named = [detail(e, 'memoryId'), e.subject ?? undefined, detail(e, 'over'), detail(e, 'id'), detail(e, 'targetId')]
    .map(titled)
    .find(t => t.id !== null && t.id.startsWith('mem_'));
  const dream = e.name.startsWith('dream.') && typeof e.subject === 'string' && /^drm_[A-Za-z0-9]+$/.test(e.subject) ? e.subject : undefined;
  const base: FeedRow = {
    id: `seq:${String(e.seq)}`,
    mech: rule.mech,
    mechs: proved.map(r => r.mech),
    word: rule.word,
    at: e.at,
    text: e.text,
    more: [],
    url: mechUrl(rule.mech),
    label: `${short} on the dashboard`,
    who,
    line: `${rule.word} · ${e.text}`,
    ...(named === undefined || named.id === null ? {} : { memory: { id: named.id, title: named.title } }),
    ...(dream === undefined ? {} : { dream }),
  };
  if (rule.name === 'gate.deposit' || rule.name === 'gate.chunk') {
    const accepted = num(e, 'accepted');
    const text = named?.title ?? (accepted > 1 ? `${String(accepted)} memories written down` : 'a memory');
    return { ...base, text, url: MEMORIES_URL, label: 'open on the dashboard', line: `kept · ${text}`, ...(named?.id ? { keys: [`mem:${named.id}`] } : {}) };
  }
  if (rule.name === 'recall.decision') {
    const turn = detail(e, 'turn');
    const n = num(e, 'surfacedCount') + num(e, 'footnoteCount');
    const said = n > 0 ? `${String(n)} came to mind` : `${String(num(e, 'moodMatched'))} brought closer by a matching mood`;
    return {
      ...base,
      text: said,
      more: quotedTitles(e.text),
      line: said,
      ...(from !== undefined && turn !== undefined ? { keys: [`turn:${from}:${turn}`] } : {}),
    };
  }
  return base;
}

/** A recall decision's surfaced ids, strongest first (`detail.surfaced`, a JSON list of `{ id }`). */
export function surfacedIds(e: DashEvent): string[] {
  try {
    const list: unknown = JSON.parse(detail(e, 'surfaced') ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.map(x => (x !== null && typeof x === 'object' ? (x as { id?: unknown }).id : undefined)).filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** The decision row for this session's turn `turn`, among a few of the newest. */
export function decisionFor(events: readonly DashEvent[], session: string, turn: number): DashEvent | undefined {
  return events.find(e => e.name === 'recall.decision' && detail(e, 'session') === session && Number(detail(e, 'turn')) === turn);
}

// ── times fired today, counted from the feed (a dashboard older than v0.2) ──

/**
 * Times each mechanism fired on the calendar day `date` among `rows`, as the
 * dashboard counts `firedToday`: rows, not amounts; a dream's rows once. Rows
 * already counted (`seen`) are skipped, so a poll's new rows add to a count.
 */
export function countToday(
  rows: readonly SidebarRow[],
  date: string,
  dateOf: (at: number) => string,
  start: Partial<Record<MechId, number | null>> = {},
  dreams: readonly string[] = [],
): { counts: Partial<Record<MechId, number | null>>; dreams: string[] } {
  const counts: Partial<Record<MechId, number | null>> = { ...start };
  for (const m of MECHS) if (counts[m.id] === undefined) counts[m.id] = m.notBuilt ? null : 0;
  const seenDreams = new Set(dreams);
  const fresh = new Map<string, Set<MechId>>();
  for (const r of rows) {
    if (dateOf(r.at) !== date) continue;
    for (const m of mechsOf(r)) {
      if (r.dream !== undefined) {
        // One dream, one firing of each mechanism it proves: its journal and its changes rows are one.
        const k = `${r.dream}:${m}`;
        if (seenDreams.has(k)) continue;
        const set = fresh.get(r.dream) ?? new Set<MechId>();
        if (set.has(m)) continue;
        set.add(m);
        fresh.set(r.dream, set);
      }
      const c = counts[m];
      if (typeof c === 'number') counts[m] = c + 1;
    }
  }
  for (const [d, ms] of fresh) for (const m of ms) seenDreams.add(`${d}:${m}`);
  return { counts, dreams: [...seenDreams] };
}

// ── a mechanism's recent firings (`/api/mechanism?id=`'s `activity`) ──────

/**
 * The firings of `mech` among `events`, newest first, each with the word of
 * the rule that proves THIS mechanism (`faded`, `merged in a dream`) and what
 * it was about: the memory's title when it names one, else the event in the
 * narrator's words.
 */
export function mechEvents(events: readonly DashEvent[], mech: MechId, limit = 8): SidebarMechEvent[] {
  const out: SidebarMechEvent[] = [];
  for (const e of [...events].sort((a, b) => b.seq - a.seq)) {
    const rule = provedBy(e).find(r => r.mech === mech);
    if (rule === undefined) continue;
    const row = classify(e);
    if (row === null) continue;
    const title = row.memory?.title ?? (rule.name === 'recall.decision' ? row.text : e.text);
    out.push({ seq: e.seq, at: e.at, word: rule.word, title: title.replace(/…$/, '…'), memoryId: row.memory?.id ?? null, text: e.text });
    if (out.length >= limit) break;
  }
  return out;
}

// ── the recall block ────────────────────────────────────────────────────────

export type RecallBlock = { turn: number; surfaced: string[]; footnotes: { title: string; id: string | null }[] };

/**
 * The block `core/recall/render.ts` composes, found in any text that carries
 * it (the engine wraps hook context in a system reminder). Null when absent
 * or when it is the quiet turn's empty string. A surfaced line is the
 * memory's gist, as Claude read it; a footnote line is its title and id.
 */
export function parseRecallBlock(text: string): RecallBlock | null {
  const open = /<!--\s*counterparts:recall t=(\d+)\s*-->/.exec(text);
  if (open === null) return null;
  const rest = text.slice(open.index + open[0].length);
  const end = rest.search(/<!--\s*counterparts:recall\/end/);
  const body = end >= 0 ? rest.slice(0, end) : rest;
  const surfaced: string[] = [];
  const footnotes: { title: string; id: string | null }[] = [];
  let lane: 'none' | 'surfaced' | 'footnote' = 'none';
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === 'Came to mind:') { lane = 'surfaced'; continue; }
    if (line.startsWith('Quietly available')) { lane = 'footnote'; continue; }
    if (!line.startsWith('- ')) continue;
    const item = line.slice(2).trim();
    if (lane === 'surfaced') surfaced.push(item);
    else if (lane === 'footnote') {
      const m = /^(.*?)\s*\[([A-Za-z]+_[A-Za-z0-9]+)\]\s*(.*)$/.exec(item);
      footnotes.push(m === null ? { title: item, id: null } : { title: `${m[1] ?? ''}${m[3] ? ` ${m[3]}` : ''}`.trim(), id: m[2] ?? null });
    }
  }
  const turn = Number(open[1]);
  return { turn: Number.isFinite(turn) ? turn : 0, surfaced, footnotes };
}

// ── the memory tools, as the model calls them ──────────────────────────────

/** The two names the memory server's tools go by: the npm install's, the plugin's. */
export const SERVER_SPELLINGS = ['counterparts', 'plugin_counterparts_counterparts'] as const;

/** `mcp__counterparts__note` → `{ server: 'counterparts', tool: 'note' }`, ours only. */
export function ourTool(name: string): { server: string; tool: string } | null {
  for (const server of SERVER_SPELLINGS) {
    const prefix = `mcp__${server}__`;
    if (name.startsWith(prefix)) return { server, tool: name.slice(prefix.length) };
  }
  return null;
}

/** The server a session's tool list connects, the npm one first. */
export function resolveServer(toolNames: readonly string[]): string | null {
  for (const server of SERVER_SPELLINGS) if (toolNames.includes(`mcp__${server}__recall`)) return server;
  return null;
}

function firstLine(s: unknown, max = 240): string | null {
  if (typeof s !== 'string') return null;
  const line = s.trim().split('\n')[0] ?? '';
  if (line.length === 0) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A tool result's JSON payload (the server sends it whole as text). */
export function payloadOf(text: string | undefined): Record<string, unknown> | null {
  if (typeof text !== 'string') return null;
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function memoryId(v: unknown): string | null {
  return typeof v === 'string' && /^mem_[A-Za-z0-9]+$/.test(v.trim()) ? v.trim() : null;
}

/**
 * What a memory tool call that answered without error saved, as "Saved this
 * session" items in the order written; none for any other tool, and for a
 * call that stored nothing. A `note` or a `session_end` entry with `updates`
 * replaces that memory (unless `how: open`, which keeps both); its title is
 * read later, from the dashboard.
 */
export function savedItems(tool: string, args: Record<string, unknown>, resultText: string | undefined, at: number, seq: number): SidebarSaved[] {
  const ours = ourTool(tool);
  if (ours === null) return [];
  const p = payloadOf(resultText);
  if (p !== null && p['stored'] === false) return [];
  const item = (i: number, title: string, id: string | null, src: Record<string, unknown>, kind?: SidebarSaved['kind']): SidebarSaved => {
    const settled = p?.['settled'] as { ok?: unknown; held?: unknown } | undefined;
    const refused = ours.tool === 'note' && settled !== undefined && (settled.ok === false || settled.held === true);
    const replacesId = src['how'] === 'open' || refused ? null : memoryId(src['updates']);
    return { key: `live:${String(seq)}:${String(i)}`, id, title, at, replaces: null, replacesId, kind: kind ?? (replacesId === null ? 'new' : 'update') };
  };
  if (ours.tool === 'note') {
    const title = firstLine(args['title']) ?? firstLine(args['text']) ?? 'a note';
    return [item(0, title, memoryId(p?.['id']), args)];
  }
  if (ours.tool === 'chapter') {
    const title = firstLine(args['title']) ?? firstLine(args['text']) ?? 'untitled';
    return [item(0, `Chapter: ${title}`, memoryId(p?.['id']), {}, 'chapter')];
  }
  if (ours.tool === 'session_end') {
    const list = Array.isArray(args['memories']) ? (args['memories'] as unknown[]) : [];
    if (typeof p?.['deposited'] === 'number' && p['deposited'] === 0) return [];
    return list.flatMap((m, i) => {
      const rec = m !== null && typeof m === 'object' ? (m as Record<string, unknown>) : {};
      const title = firstLine(rec['title']) ?? firstLine(rec['text']);
      return title === null ? [] : [item(i, title, null, rec)];
    });
  }
  return [];
}

/** The ids a `recall` call opened by address: its `ids`, or a `handle` that is an id. */
export function openedIds(tool: string, args: Record<string, unknown>): { ids: string[]; handle: string | null } {
  const ours = ourTool(tool);
  if (ours === null || ours.tool !== 'recall') return { ids: [], handle: null };
  const ids = Array.isArray(args['ids']) ? (args['ids'] as unknown[]).map(memoryId).filter((x): x is string => x !== null) : [];
  const handle = typeof args['handle'] === 'string' && args['handle'].trim().length > 0 ? args['handle'].trim() : null;
  const asId = memoryId(handle);
  return asId === null ? { ids, handle } : { ids: [...ids, asId], handle: null };
}

// ── a dream ────────────────────────────────────────────────────────────────

/** `/api/dreams`' newest dream, the part the sidebar reads. */
export type DashDream = {
  id: string;
  date: string | null;
  day: number;
  state?: string;
  journal: string | null;
  counts?: Record<string, number>;
  changes?: { action: string; said: string; undone?: boolean }[];
};

/** The journal's first sentence, and what follows it. */
export function firstSentence(journal: string): { first: string; rest: string } {
  const text = journal.replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(?:["”’)]*)(?=\s|$)/.exec(text);
  if (m === null) return { first: text, rest: '' };
  const first = text.slice(0, m[0].length).trim();
  return { first, rest: text.slice(m[0].length).trim() };
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/**
 * What changed that night, in plain words: the dream's own changes (merges,
 * patterns, links, replacements) and the night's sleep (memories that faded
 * a band, memories that became core), each only when it happened.
 */
export function dreamChanges(d: DashDream, night: { faded: number; core: number }): string[] {
  const c = d.counts ?? {};
  const out: string[] = [];
  const merges = (d.changes ?? []).filter(x => x.action === 'merge' && x.undone !== true);
  const merge = c['merge'] ?? merges.length;
  if (merge > 0) out.push(merge === 1 && merges[0] !== undefined && /^merged /.test(merges[0].said) ? merges[0].said : `merged near-copies ${plural(merge, 'time', 'times')}`);
  if ((c['gist'] ?? 0) > 0) out.push(`wrote down ${plural(c['gist'] ?? 0, 'pattern', 'patterns')} it saw`);
  if ((c['link'] ?? 0) > 0) out.push(`linked ${plural(c['link'] ?? 0, 'pair', 'pairs')} of memories`);
  if ((c['settle'] ?? 0) > 0) out.push(`replaced ${plural(c['settle'] ?? 0, 'outdated memory', 'outdated memories')}`);
  if (night.faded > 0) out.push(`${plural(night.faded, 'memory', 'memories')} faded`);
  if (night.core > 0) out.push(`${String(night.core)} became core ${night.core === 1 ? 'memory' : 'memories'}`);
  return out;
}

// ── a facts answer ─────────────────────────────────────────────────────────

export type SearchHit = SidebarHit;

/**
 * The labeled lines `adapters/mcp/facts.ts#renderFacts` writes: a header,
 * then per result `N. <title> · <id>[ (chapter …)] · <ways>` and indented
 * lines under it, the last of which is the excerpt. Read from the RIGHT: a
 * title may hold ` · ` and words shaped like an id (`Sidebar · npm_install ·
 * notes`), the ways (`words, meaning`, or nothing) never do.
 */
const ITEM = /^(\d+)\.\s+(?:\[journal\]\s+)?(.*)\s+·\s+([A-Za-z]+_[A-Za-z0-9]+)(?:\s+\(chapter \d+ of \d+\))?\s+·\s*([^·]*)$/

/** `14 match · showing 5 · …` → 14; 0 when the header says no count. */
export function factsTotal(header: string): number {
  const m = /^(\d+) match/.exec(header.trim())
  return m === null ? 0 : Number(m[1])
}

/** `10-09` or `2025-10-09` as `Oct 9` (with the year when one is given). */
export function shortDay(s: string): string {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(s.trim());
  if (m === null) return '';
  const month = MONTHS[Number(m[2]) - 1];
  if (month === undefined) return '';
  return `${month} ${String(Number(m[3]))}${m[1] === undefined ? '' : ` ${m[1]}`}`;
}

const SAID_BY: Readonly<Record<string, string>> = { 'you said': 'you said it', 'I said': 'I said it', inferred: 'inferred' };

/**
 * From a result's labeled lines: when (happened, else for, else learned or
 * written) and who said it, only when that is known.
 */
function whenAndWho(journal: boolean, under: readonly string[]): { date: string; who: string | null } {
  const first = under[0] ?? '';
  if (journal) {
    const w = /written (\d{4}-\d{2}-\d{2}|\d{2}-\d{2})/.exec(first);
    return { date: w === null ? '' : shortDay(w[1] ?? ''), who: null };
  }
  const parts = first.split(' · ').map(p => p.trim());
  const who = SAID_BY[parts[0] ?? ''] ?? null;
  const happened = /(?:happened|for) (\d{4}-\d{2}-\d{2}|\d{2}-\d{2})/.exec(first);
  const learned = /^learned (\d{4}-\d{2}-\d{2}|\d{2}-\d{2})/.exec(under[1] ?? '');
  const day = happened?.[1] ?? learned?.[1] ?? '';
  return { date: day === '' ? '' : shortDay(day), who };
}

export function parseFacts(answer: string): { header: string; total: number; hits: SearchHit[] } {
  const lines = answer.split('\n');
  const header = lines[0] ?? '';
  const hits: SearchHit[] = [];
  let cur: { id: string; title: string; journal: boolean; under: string[] } | null = null;
  const flush = (): void => {
    if (cur === null) return;
    const excerpt = cur.under.length > 1 ? (cur.under[cur.under.length - 1] ?? '') : '';
    const { date, who } = whenAndWho(cur.journal, cur.under);
    const kind = cur.journal ? 'journal' : 'memory';
    const meta = [kind, date, who].filter((x): x is string => x !== null && x !== '').join(' · ');
    hits.push({ id: cur.id, title: cur.title, kind, date, who, meta, excerpt });
    cur = null;
  };
  for (const line of lines.slice(1)) {
    const item = ITEM.exec(line);
    if (item !== null) {
      flush();
      cur = { id: item[3] ?? '', title: item[2] ?? '', journal: /^\d+\.\s+\[journal\]/.test(line), under: [] };
      continue;
    }
    if (cur !== null && /^\s{2,}\S/.test(line)) cur.under.push(line.trim());
    else if (cur !== null && line.trim() === '') flush();
    else if (/^faded \(\d+\):/.test(line)) flush();
  }
  flush();
  return { header, total: Math.max(factsTotal(header), hits.length), hits };
}

// ── words and times ────────────────────────────────────────────────────────

/** Word-wrap into lines of at most `w` terminal cells (a wide character counts two; a word longer than a line is cut). */
export function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word0 of text.split(/\s+/).filter(Boolean)) {
    let word = word0;
    while (cells(word) > w) {
      if (line) { out.push(line); line = ''; }
      const head = headCells(word, w) || (Array.from(word)[0] ?? '');
      out.push(head);
      word = word.slice(head.length);
    }
    if (!word) continue;
    if ((line ? cells(line) + 1 : 0) + cells(word) > w) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** A folder as a person says it: a home folder (`/Users/<name>`, `/home/<name>`) as `~`. */
export function shortDir(dir: string | null): string {
  if (dir === null) return 'this folder';
  return dir.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
}

/** `s` cut to `w` terminal cells, with an ellipsis. */
export function ellipsize(s: string, w: number): string {
  return ellipsizeCells(s, w);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The local calendar day of `at`, `YYYY-MM-DD`. */
export function dateOf(at: number): string {
  const d = new Date(at);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The time a section's heading carries: `10:25`, `8:07` (a 12-hour clock with
 * no am or pm, as the mockups have it: every time it shows is recent), or
 * `Oct 9` before today.
 */
export function hm(at: number, now: number): string {
  const d = new Date(at);
  if (dateOf(at) !== dateOf(now)) return `${MONTHS[d.getMonth()] ?? ''} ${String(d.getDate())}`;
  const h = d.getHours() % 12;
  return `${String(h === 0 ? 12 : h)}:${String(d.getMinutes()).padStart(2, '0')}`;
}
