/**
 * What the sidebar reads, turned into rows: the dashboard's event feed, the
 * recall block the classic UserPromptSubmit hook injects, a `recall` facts
 * answer, and the memory tools' calls this session. Pure: no `$`.
 *
 * WHICH EVENTS ARE A MECHANISM FIRING is the dashboard's table
 * (`src/adapters/mechanism-evidence.ts`, MECHANISM_EVIDENCE): an event name,
 * sometimes a condition on its payload, and the mechanism it proves. This file
 * keeps a copy of the names and conditions, not an import — a hooks module
 * reaches nothing outside its plugin folder but through `$`. A mechanism the
 * table learns later is simply not shown here until this copy learns it.
 */

import type { SidebarHit, SidebarRow } from '../types';
import { MEMORIES_URL, mechById, mechUrl } from './mechanisms';
import type { MechId } from './mechanisms';

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
 * The event names that prove a mechanism fired, in the dashboard's words.
 * Order matters only where one name proves two mechanisms: the first wins.
 */
export const RULES: readonly Rule[] = [
  { name: 'gate.deposit', mech: 'salience', word: 'kept', when: e => num(e, 'accepted') > 0 },
  { name: 'gate.chunk', mech: 'salience', word: 'kept', when: e => num(e, 'accepted') > 0 },
  { name: 'recall.decision', mech: 'retrieval', word: 'recalled', when: e => num(e, 'surfacedCount') + num(e, 'footnoteCount') > 0 },
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
  { name: 'dream.changed', mech: 'dreaming', word: 'dreamed' },
  { name: 'contradiction.flagged', mech: 'interference', word: 'flagged' },
  { name: 'contradiction.settled', mech: 'reconsolidation', word: 'settled' },
  { name: 'revision.pressure', mech: 'reconsolidation', word: 'weighed' },
];

/** The names worth asking the dashboard for one by one on a cold start. */
export const RULE_NAMES: readonly string[] = [...new Set(RULES.map(r => r.name))];

/** A dashboard event as an ACTIVITY row, or null when it proves no mechanism. */
export function classify(e: DashEvent): FeedRow | null {
  const rule = RULES.find(r => r.name === e.name && (r.when === undefined || r.when(e)));
  if (rule === undefined) return null;
  const m = mechById(rule.mech);
  const short = m?.short ?? rule.mech;
  const base: FeedRow = {
    id: `seq:${String(e.seq)}`,
    mech: rule.mech,
    word: rule.word,
    at: e.at,
    text: e.text,
    more: [],
    url: mechUrl(rule.mech),
    label: `${short} on the dashboard`,
  };
  if (rule.name === 'gate.deposit' || rule.name === 'gate.chunk') {
    const { title, id } = titled(detail(e, 'memoryId'));
    const kind = detail(e, 'kind');
    const accepted = num(e, 'accepted');
    return {
      ...base,
      text: title !== null ? `“${title}”` : accepted > 1 ? `${String(accepted)} memories written down` : e.text,
      more: [e.text, ...(kind ? [`kept as a ${kind}`] : [])],
      url: MEMORIES_URL,
      label: 'the memory on the dashboard',
      ...(id === null ? {} : { keys: [`mem:${id}`] }),
    };
  }
  if (rule.name === 'recall.decision') {
    const session = detail(e, 'session');
    const turn = detail(e, 'turn');
    const n = num(e, 'surfacedCount') + num(e, 'footnoteCount');
    return {
      ...base,
      word: `${String(n)} recalled`,
      ...(session !== undefined && turn !== undefined ? { keys: [`turn:${session}:${turn}`] } : {}),
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
    word: `${String(n)} recalled`,
    at,
    text: `${n === 1 ? '1 memory came' : `${String(n)} memories came`} to mind for this prompt`,
    more: all.map(t => `· ${t}`),
    url: mechUrl('retrieval'),
    label: 'Retrieval on the dashboard',
    live: true,
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
    text = `“${firstLine(args['title']) ?? firstLine(args['text']) ?? 'a note'}”`;
    if (typeof args['kind'] === 'string') more = [`kept as a ${args['kind'] as string}`];
  } else if (ours.tool === 'chapter') {
    text = `a chapter: “${firstLine(args['title']) ?? firstLine(args['text']) ?? 'untitled'}”`;
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
    word: 'kept',
    at,
    text,
    more,
    url: MEMORIES_URL,
    label: 'the memory on the dashboard',
    live: true,
    ...(id === null ? {} : { keys: [`mem:${id}`] }),
  };
}

/** Newest first, live rows win over their dashboard twins, at most `limit`. */
export function mergeRows(rows: readonly FeedRow[], limit: number): FeedRow[] {
  const byId = new Map<string, FeedRow>();
  for (const r of rows) byId.set(r.id, r);
  const all = [...byId.values()].sort((a, b) => b.at - a.at);
  const liveKeys = new Set(all.filter(r => r.live).flatMap(r => r.keys ?? []));
  return all.filter(r => r.live || !(r.keys ?? []).some(k => liveKeys.has(k))).slice(0, limit);
}

// ── a facts answer ─────────────────────────────────────────────────────────

export type SearchHit = SidebarHit;

/**
 * The labeled lines `adapters/mcp/facts.ts#renderFacts` writes: a header,
 * then per result `N. <title> · <id>[ (chapter …)] · <ways>` and indented
 * lines under it, the last of which is the excerpt.
 */
export function parseFacts(answer: string): { header: string; hits: SearchHit[] } {
  const lines = answer.split('\n');
  const header = lines[0] ?? '';
  const hits: SearchHit[] = [];
  let cur: { id: string; title: string; under: string[] } | null = null;
  const flush = (): void => {
    if (cur === null) return;
    const meta = (cur.under[0] ?? '').replace(/\s+·\s+/g, ' · ');
    const excerpt = cur.under.length > 1 ? (cur.under[cur.under.length - 1] ?? '') : '';
    hits.push({ id: cur.id, title: cur.title, meta, excerpt });
    cur = null;
  };
  for (const line of lines.slice(1)) {
    const item = /^(\d+)\.\s+(?:\[journal\]\s+)?(.*?)\s+·\s+([A-Za-z]+_[A-Za-z0-9]+)(?:\s+\(chapter[^)]*\))?(?:\s+·\s+.*)?$/.exec(line);
    if (item !== null) {
      flush();
      cur = { id: item[3] ?? '', title: item[2] ?? '', under: [] };
      continue;
    }
    if (cur !== null && /^\s{2,}\S/.test(line)) cur.under.push(line.trim());
    else if (cur !== null && line.trim() === '') flush();
    else if (/^faded \(\d+\):/.test(line)) flush();
  }
  flush();
  return { header, hits };
}

// ── words and times ────────────────────────────────────────────────────────

/** Word-wrap `text` into lines of at most `w` columns (a long word is cut). */
export function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word0 of text.split(/\s+/).filter(Boolean)) {
    let word = word0;
    while (word.length > w) {
      if (line) { out.push(line); line = ''; }
      out.push(word.slice(0, w));
      word = word.slice(w);
    }
    if (!word) continue;
    if ((line ? line.length + 1 : 0) + word.length > w) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

export function ellipsize(s: string, w: number): string {
  return s.length <= w ? s : `${s.slice(0, Math.max(0, w - 1))}…`;
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
