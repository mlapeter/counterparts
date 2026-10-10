/**
 * What the sidebar reads, turned into rows: the dashboard's event feed, the
 * recall block the classic UserPromptSubmit hook injects, a `recall` facts
 * answer, and the memory tools' calls this session. Pure: no `$`.
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

import type { SidebarHit, SidebarRow } from '../types';
import { MEMORIES_URL, mechById, mechUrl } from './mechanisms';
import type { MechId } from './mechanisms';
import { cells, ellipsizeCells, headCells } from './width';

/** One row of the ACTIVITY list (the contract's SidebarRow). */
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
export function titled(value: string | undefined): { title: string | null; id: string | null } {
  if (value === undefined) return { title: null, id: null };
  const m = /^"([\s\S]*)"\s*\[([A-Za-z]+_[A-Za-z0-9]+)\]$/.exec(value.trim());
  if (m !== null) return { title: m[1] ?? null, id: m[2] ?? null };
  const bare = /\[([A-Za-z]+_[A-Za-z0-9]+)\]/.exec(value);
  return { title: null, id: bare?.[1] ?? null };
}

type Rule = { name: string; mech: MechId; word: string; when?: (e: DashEvent) => boolean };

/**
 * The event names that prove a mechanism fired, in the dashboard's words. An
 * event is a row when any rule for its name holds. The FIRST that holds gives
 * the row its word and colour (`mech`); EVERY one that holds lights (`mechs`).
 * So a name's own mechanism comes first, and what the same event also proves
 * follows it, with the same word.
 */
export const RULES: readonly Rule[] = [
  { name: 'gate.deposit', mech: 'salience', word: 'kept', when: e => num(e, 'accepted') > 0 },
  { name: 'gate.chunk', mech: 'salience', word: 'kept', when: e => num(e, 'accepted') > 0 },
  { name: 'recall.decision', mech: 'retrieval', word: 'recalled', when: e => num(e, 'surfacedCount') + num(e, 'footnoteCount') > 0 },
  { name: 'recall.decision', mech: 'emotional', word: 'recalled', when: e => num(e, 'moodMatched') > 0 },
  { name: 'mcp.recall', mech: 'retrieval', word: 'looked up' },
  { name: 'recall.credit', mech: 'retrieval', word: 'stronger', when: e => num(e, 'credited') > 0 },
  { name: 'associate.flush', mech: 'association', word: 'linked', when: e => num(e, 'rows') > 0 },
  { name: 'prospective.plain', mech: 'prospective', word: 'reminded' },
  { name: 'prospective.fire', mech: 'prospective', word: 'reminded' },
  { name: 'band.transition', mech: 'decay', word: 'faded', when: e => detail(e, 'site') === 'decay' && detail(e, 'direction') !== 'up' },
  { name: 'band.transition', mech: 'consolidation', word: 'rose', when: e => detail(e, 'site') === 'consolidate' },
  { name: 'memory.pruned', mech: 'decay', word: 'let go' },
  { name: 'sleep.cycle', mech: 'decay', word: 'faded', when: e => num(e, 'faded') > 0 },
  { name: 'band.promoted', mech: 'consolidation', word: 'core' },
  { name: 'memory.merged', mech: 'consolidation', word: 'merged' },
  { name: 'dream.journaled', mech: 'dreaming', word: 'dreamed' },
  // A change the dream made, or a core suggestion (`applied` counts both).
  { name: 'dream.changed', mech: 'dreaming', word: 'dreamed', when: e => num(e, 'applied') > 0 || num(e, 'nominate-core') > 0 },
  { name: 'dream.changed', mech: 'episodic-semantic', word: 'dreamed', when: e => num(e, 'gist') > 0 },
  { name: 'dream.changed', mech: 'interference', word: 'dreamed', when: e => num(e, 'merge') > 0 },
  { name: 'dream.changed', mech: 'consolidation', word: 'dreamed', when: e => num(e, 'merge') > 0 },
  { name: 'contradiction.flagged', mech: 'interference', word: 'flagged' },
  { name: 'contradiction.settled', mech: 'reconsolidation', word: 'settled' },
  // Settled `changed`: the earlier memory fades under the one that holds.
  { name: 'contradiction.settled', mech: 'interference', word: 'settled', when: e => detail(e, 'how') === 'changed' },
  { name: 'revision.pressure', mech: 'reconsolidation', word: 'weighed' },
];

/** The names worth asking the dashboard for one by one on a cold start. */
export const RULE_NAMES: readonly string[] = [...new Set(RULES.map(r => r.name))];

/** The rules `e` proves, one a mechanism, the row's own first; none when it proves nothing. */
export function provedBy(e: DashEvent): Rule[] {
  const out: Rule[] = [];
  for (const r of RULES) {
    if (r.name !== e.name || (r.when !== undefined && !r.when(e))) continue;
    if (!out.some(o => o.mech === r.mech)) out.push(r);
  }
  return out;
}

/** A row's mechanisms, its own first (a row kept from before rows carried `mechs`: its own alone). */
export function mechsOf(r: SidebarRow): MechId[] {
  return Array.isArray(r.mechs) && r.mechs.length > 0 ? r.mechs : [r.mech];
}

/**
 * The line an opened row adds when it proves more than its own mechanism, in
 * the legend's names: `also Emotion`, `also Gist · Interference · Consolidation`.
 */
export function alsoLine(r: SidebarRow): string | null {
  const rest = mechsOf(r).filter(m => m !== r.mech);
  return rest.length === 0 ? null : `also ${rest.map(m => mechById(m)?.short ?? m).join(' · ')}`;
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
 * A dashboard event as an ACTIVITY row, or null when it proves no mechanism.
 * `session` is this session's id: its own events are said in the sidebar's
 * plain words, the night's keep the narrator's, other sessions' are marked
 * `other` (the list folds them into one line).
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
  };
  if (rule.name === 'gate.deposit' || rule.name === 'gate.chunk') {
    const { title, id } = titled(detail(e, 'memoryId'));
    const kind = detail(e, 'kind');
    const accepted = num(e, 'accepted');
    const text = title ?? (accepted > 1 ? `${String(accepted)} memories written down` : 'a memory');
    return {
      ...base,
      text,
      more: kind ? [`kept as a ${kind}`] : [],
      url: MEMORIES_URL,
      label: 'open on the dashboard',
      line: `kept · ${text}`,
      ...(id === null ? {} : { keys: [`mem:${id}`] }),
    };
  }
  if (rule.name === 'recall.decision') {
    const turn = detail(e, 'turn');
    const n = num(e, 'surfacedCount') + num(e, 'footnoteCount');
    // A mood match with nothing shown (the render trimmed it): a row of Emotion's, said as such.
    const said = n > 0 ? `${String(n)} came to mind` : `${String(num(e, 'moodMatched'))} brought closer by a matching mood`;
    return {
      ...base,
      word: 'recalled',
      text: said,
      more: quotedTitles(e.text).map(t => `· ${t}`),
      line: said,
      ...(from !== undefined && turn !== undefined ? { keys: [`turn:${from}:${turn}`] } : {}),
    };
  }
  return base;
}

// ── the recall block ────────────────────────────────────────────────────────

export type RecallBlock = { turn: number; surfaced: string[]; footnotes: { title: string; id: string | null }[] };

/**
 * The block `core/recall/render.ts` composes, found in any text that carries
 * it (the engine wraps hook context in a system reminder). Null when absent
 * or when it is the quiet turn's empty string.
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

export function cameRow(block: RecallBlock, session: string, at: number): FeedRow | null {
  const n = block.surfaced.length + block.footnotes.length;
  if (n === 0) return null;
  const all = [...block.surfaced, ...block.footnotes.map(f => f.title)];
  return {
    id: `live:turn:${session}:${String(block.turn)}`,
    mech: 'retrieval',
    mechs: ['retrieval'],
    word: 'recalled',
    at,
    text: `${String(n)} came to mind`,
    more: all.map(t => `· ${t}`),
    url: mechUrl('retrieval'),
    label: 'Retrieval on the dashboard',
    live: true,
    who: 'here',
    line: `${String(n)} came to mind`,
    keys: [`turn:${session}:${String(block.turn)}`],
  };
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

const KEEPERS = new Set(['note', 'session_end', 'chapter']);

function firstLine(s: unknown, max = 90): string | null {
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

/**
 * A memory tool call that answered without error, as a `kept` row; null for
 * any other tool, and for a call that stored nothing.
 */
export function keptRow(tool: string, args: Record<string, unknown>, resultText: string | undefined, at: number, seq: number): FeedRow | null {
  const ours = ourTool(tool);
  if (ours === null || !KEEPERS.has(ours.tool)) return null;
  const p = payloadOf(resultText);
  if (p !== null && p['stored'] === false) return null;
  const id = typeof p?.['id'] === 'string' ? (p['id'] as string) : null;
  let text: string;
  let more: string[] = [];
  if (ours.tool === 'note') {
    text = firstLine(args['title']) ?? firstLine(args['text']) ?? 'a note';
    if (typeof args['kind'] === 'string') more = [`kept as a ${args['kind'] as string}`];
  } else if (ours.tool === 'chapter') {
    text = `a chapter: ${firstLine(args['title']) ?? firstLine(args['text']) ?? 'untitled'}`;
  } else {
    const list = Array.isArray(args['memories']) ? (args['memories'] as unknown[]) : [];
    const n = typeof p?.['deposited'] === 'number' ? (p['deposited'] as number) : list.length;
    if (n === 0 && list.length === 0) return null;
    text = `${String(n)} ${n === 1 ? 'memory' : 'memories'} from this session`;
    more = list.slice(0, 6).map(m => `· ${firstLine((m as Record<string, unknown>)?.['title']) ?? firstLine((m as Record<string, unknown>)?.['text']) ?? '…'}`);
  }
  return {
    id: `live:kept:${String(seq)}`,
    mech: 'salience',
    mechs: ['salience'],
    word: 'kept',
    at,
    text,
    more,
    url: MEMORIES_URL,
    label: 'open on the dashboard',
    live: true,
    who: 'here',
    line: `kept · ${text}`,
    ...(id === null ? {} : { keys: [`mem:${id}`] }),
  };
}

/**
 * Newest first, live rows win over their dashboard twins, at most `limit`. A
 * live row takes on what its twin proves besides its own (the recall block
 * says nothing of mood; the turn's row on the dashboard does).
 */
export function mergeRows(rows: readonly FeedRow[], limit: number): FeedRow[] {
  const byId = new Map<string, FeedRow>();
  for (const r of rows) byId.set(r.id, r);
  const all = [...byId.values()].sort((a, b) => b.at - a.at);
  const twins = new Map<string, MechId[]>();
  for (const r of all) if (!r.live) for (const k of r.keys ?? []) twins.set(k, [...(twins.get(k) ?? []), ...mechsOf(r)]);
  const liveKeys = new Set(all.filter(r => r.live).flatMap(r => r.keys ?? []));
  return all
    .filter(r => r.live || !(r.keys ?? []).some(k => liveKeys.has(k)))
    .slice(0, limit)
    .map(r => {
      if (!r.live) return r;
      const own = mechsOf(r);
      const more = (r.keys ?? []).flatMap(k => twins.get(k) ?? []).filter(m => !own.includes(m));
      return more.length === 0 ? r : { ...r, mechs: [...own, ...new Set(more)] };
    });
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

/** Word-wrap `text` into lines of at most `w` columns (a long word is cut). */
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

/** `1:35pm` today (local), `Oct 8` before today. */
export function clock(at: number, now: number): string {
  const d = new Date(at), n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (!sameDay) return `${MONTHS[d.getMonth()] ?? ''} ${String(d.getDate())}`;
  const h = d.getHours(), m = d.getMinutes();
  return `${String(h % 12 === 0 ? 12 : h % 12)}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}
