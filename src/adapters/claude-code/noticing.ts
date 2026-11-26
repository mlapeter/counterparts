/**
 * NOTICING v1 (2026-11-26; design: the noticing-and-wake note, "v2 — after the
 * Fable review", part A). An experiment, lightly held.
 *
 * **What it is for.** Three readings were lost in one week: a book read page by
 * page through `pdftotext`, a run of letters read through a phone's MCP tools,
 * and a social feed read and answered through a script. Each time the session
 * read (or sent) something that mattered and never called `remember`, and the
 * Stop ask, paced on what the PERSON typed, did not come round in time. What a
 * session did toward someone, a letter sent or a post answered, is lost the
 * same way.
 *
 * **What it does.** At an attended Stop in this adapter, if perception calls
 * (reads, and sends) happened since this session's watermark and no `remember`
 * call came after them, ONE line is added, counts only, pointing at
 * `remember`. Per turn, not per session: reading a book together nudges each
 * sitting. Core, the night and codex are untouched (constitution 5): this
 * module and its call in `hooks.ts#stop` are the whole mechanism.
 *
 * **What counts** (`classifyCall`), by kind:
 *  - letters read: MCP tools named `…read_inbox`, `…read_thread`,
 *    `…read_message`, `…open_message` (by name SUFFIX, as `RECALL_TOOL_NAME`,
 *    because the server prefix is the host's);
 *  - pages: `WebFetch`, any tool named `…web_fetch`/`…webfetch`, and the
 *    host's `web-fetch` subagent;
 *  - documents: `Bash` whose command matches `pdftotext`, `.pdf` or `.epub`,
 *    and `Read` of a `.pdf` or `.epub`; nothing under `tool-results/` (the
 *    host's own spill files);
 *  - letters sent: MCP tools named `…send_message` (case-sensitive: the
 *    host's own agent tool `SendMessage` is not a letter);
 *  - the owner's own Bash patterns (`noticing.bashPatterns`, reads, counted as
 *    pages; `noticing.bashOutgoing`, sends, counted as posts). No defaults for
 *    any one service beyond the generic letter suffixes.
 *  - `remember` (and its old name `note` on a counterparts server) is the
 *    write that answers them. `session_end` is not: it answers the full ask.
 *
 * **What it says** (`noticeLine`): numbers and kind words only, built from a
 * record of counts. Nothing from a tool's input or output can reach the line,
 * by construction: an injection in a file name has no path into context.
 *
 * **State** (`NoticingState`): one store meta row per session,
 * `adapter.noticing.<session>`: the watermark (the last tool_use id scanned),
 * the last nudge's time, whether a nudge awaits its answer, and the counters.
 * The turn cursor cannot serve: `claim()` advances it before the ask.
 *
 * **Counters** (constitution 11/16), summed by `counterparts mechanisms`:
 *  - `would`: a scanned Stop found unwritten perception (re-fire included);
 *  - `nudged`: the line went out;
 *  - `taken`: a `remember` came in the continuation after a nudge;
 *  - `quiet`: perception, and a `remember` already followed it.
 */
import type { AdapterConfig } from "../config.js";
import { TUNABLES } from "../config.js";
import type { ToolCall } from "./transcript.js";

/** What a call was, for the line. */
export type NoticeKind = "letter" | "page" | "document" | "sentLetter" | "post";
export type CallKind = NoticeKind | "remember";

const READS: readonly NoticeKind[] = ["letter", "page", "document"];
const SENDS: readonly NoticeKind[] = ["sentLetter", "post"];

/** The compiled settings: the switch, and the owner's extra Bash patterns. */
export interface NoticingSettings {
  readonly on: boolean;
  readonly bashPatterns: readonly RegExp[];
  readonly bashOutgoing: readonly RegExp[];
}

const LETTER_READ = /(^|__)(read_inbox|read_thread|read_message|open_message)$/;
const LETTER_SENT = /(^|__)send_message$/;
const WEB_FETCH = /^WebFetch$|(^|__)web_?fetch$/i;
const REMEMBER = /(^|__)remember$/;
/** The old name still answers on our own server (`mcp/tools.ts#TOOL_ALIASES`). */
const REMEMBER_OLD = /counterparts[^_]*__note$/;
const DOCUMENT = /\bpdftotext\b|\.pdf\b|\.epub\b/i;
const DOCUMENT_PATH = /\.(pdf|epub)$/i;
/** The host's own spill files: a large result saved for the model, not a document. */
const TOOL_RESULTS = /tool-results\//;

/**
 * ONE CALL'S KIND, or null for a call that is neither perception nor a
 * `remember`. Pure: the tool's name and one input field (`ToolCall.arg`).
 */
export function classifyCall(call: Pick<ToolCall, "name" | "arg">, settings: Pick<NoticingSettings, "bashPatterns" | "bashOutgoing">): CallKind | null {
  const { name, arg } = call;
  if (REMEMBER.test(name) || REMEMBER_OLD.test(name)) return "remember";
  if (LETTER_READ.test(name)) return "letter";
  if (LETTER_SENT.test(name)) return "sentLetter";
  if (WEB_FETCH.test(name)) return "page";
  if ((name === "Agent" || name === "Task") && arg === "web-fetch") return "page";
  if (name === "Read" && arg !== undefined && DOCUMENT_PATH.test(arg) && !TOOL_RESULTS.test(arg)) return "document";
  if (name === "Bash" && arg !== undefined && !TOOL_RESULTS.test(arg)) {
    if (settings.bashOutgoing.some((p) => p.test(arg))) return "post";
    if (settings.bashPatterns.some((p) => p.test(arg))) return "page";
    if (DOCUMENT.test(arg)) return "document";
  }
  return null;
}

/** Counts by kind; zero kinds are absent. */
export type NoticeCounts = Partial<Record<NoticeKind, number>>;

/** One session's row. Numbers and one tool_use id; never text. */
export interface NoticingState {
  /** The last tool_use id scanned; absent before the first scan. */
  readonly mark?: string;
  /** When the last line went out (epoch ms). */
  readonly nudgedAt?: number;
  /** A line went out and its continuation has not been scanned yet. */
  readonly pending?: boolean;
  readonly would: number;
  readonly nudged: number;
  readonly taken: number;
  readonly quiet: number;
  /** When this row last changed (epoch ms): the window `mechanisms` reads. */
  readonly at: number;
}

export const EMPTY_STATE: NoticingState = { would: 0, nudged: 0, taken: 0, quiet: 0, at: 0 };

export interface StopScan {
  /** The row to write, or null when nothing changed (no write). */
  readonly next: NoticingState | null;
  /** The counts to say, or null: no line at this Stop. */
  readonly say: NoticeCounts | null;
  /** What the scan found, for the ring: never text. */
  readonly outcome: "none" | "lost-mark" | "quiet" | "would" | "nudged";
}

/**
 * THE STOP'S DECISION. `calls` is the whole transcript's call list (file
 * order), `state` the session's row. The re-fire (`reFired`) scans, advances
 * the watermark and records `taken`, and never says anything.
 *
 * A stored watermark the file no longer holds (a rewritten or foreign file) is
 * not a reason to speak: the scan moves the mark to the end and says nothing.
 */
export function scanAtStop(
  calls: readonly Pick<ToolCall, "id" | "name" | "arg">[],
  state: NoticingState,
  settings: Pick<NoticingSettings, "bashPatterns" | "bashOutgoing">,
  opts: { readonly reFired: boolean; readonly now: number },
): StopScan {
  const last = calls.length === 0 ? undefined : calls[calls.length - 1]?.id;
  let start = 0;
  if (state.mark !== undefined) {
    const at = calls.findIndex((c) => c.id === state.mark);
    if (at === -1) {
      if (last === undefined || last === state.mark) return { next: null, say: null, outcome: "none" };
      return { next: { ...state, mark: last, pending: false, at: opts.now }, say: null, outcome: "lost-mark" };
    }
    start = at + 1;
  }
  const fresh = calls.slice(start).map((c) => classifyCall(c, settings));
  if (fresh.length === 0) return { next: null, say: null, outcome: "none" };
  let { would, nudged, taken, quiet } = state;
  let pending = state.pending === true;
  let nudgedAt = state.nudgedAt;
  const wrote = fresh.lastIndexOf("remember");
  // The nudge's continuation: a `remember` anywhere in it is the line taken.
  if (pending) {
    if (wrote !== -1) taken += 1;
    pending = false;
  }
  const seen = fresh.some((k) => k !== null && k !== "remember");
  const unwritten = fresh.slice(wrote + 1).filter((k): k is NoticeKind => k !== null && k !== "remember");
  let say: NoticeCounts | null = null;
  let outcome: StopScan["outcome"] = "none";
  if (unwritten.length > 0) {
    would += 1;
    outcome = "would";
    if (!opts.reFired) {
      const counts: NoticeCounts = {};
      for (const k of unwritten) counts[k] = (counts[k] ?? 0) + 1;
      say = counts;
      nudged += 1;
      pending = true;
      nudgedAt = opts.now;
      outcome = "nudged";
    }
  } else if (seen) {
    quiet += 1;
    outcome = "quiet";
  }
  const next: NoticingState = {
    ...(last === undefined ? {} : { mark: last }),
    ...(nudgedAt === undefined ? {} : { nudgedAt }),
    ...(pending ? { pending: true } : {}),
    would,
    nudged,
    taken,
    quiet,
    at: opts.now,
  };
  return { next, say, outcome };
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

const WORDS: Record<NoticeKind, readonly [string, string]> = {
  letter: ["letter", "letters"],
  page: ["page", "pages"],
  document: ["document", "documents"],
  sentLetter: ["letter", "letters"],
  post: ["post", "posts"],
};

function listed(counts: NoticeCounts, kinds: readonly NoticeKind[]): string[] {
  return kinds.flatMap((k) => {
    const n = counts[k] ?? 0;
    return n > 0 ? [plural(n, WORDS[k][0], WORDS[k][1])] : [];
  });
}

/**
 * THE LINE, from numbers alone. It opens with `NOTICE_OPENER`
 * (`transcript.ts`), the second own-ask opener the reader refuses as `ritual`.
 */
export function noticeLine(opener: string, counts: NoticeCounts): string {
  const reads = listed(counts, READS);
  const sends = listed(counts, SENDS);
  const readTotal = READS.reduce((n, k) => n + (counts[k] ?? 0), 0);
  const readPart =
    reads.length === 0 ? "" : reads.length === 1 ? `read ${reads[0] ?? ""}` : `read ${plural(readTotal, "thing", "things")} (${reads.join(", ")})`;
  const sendPart = sends.length === 0 ? "" : `sent ${sends.join(", ")}`;
  const did = [readPart, sendPart].filter((s) => s.length > 0).join(" and ");
  const keep =
    sends.length === 0
      ? "Keep what struck you with remember: the lines word for word, who wrote them, and your reaction, one memory each."
      : reads.length === 0
        ? "Keep what you did toward whom with remember, one memory each."
        : "Keep what struck you, and what you did toward whom, with remember: the lines word for word, who wrote them, and your reaction, one memory each.";
  return `${opener} you ${did}. ${keep}`;
}

/** The person's line on a Stop that carries the noticing line alone (`envelope.ts#hostDelivery`). */
export const NOTICE_HUMAN_LINE = "Counterparts: reminding the assistant to keep what it just read or sent.";

// ── the row ─────────────────────────────────────────────────────────────────

export const NOTICING_META_PREFIX = "adapter.noticing.";

export function noticingKey(sessionId: string): string {
  return `${NOTICING_META_PREFIX}${sessionId}`;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** A row as stored, read leniently: an unreadable one is a fresh start. */
export function readNoticingState(raw: string | undefined): NoticingState {
  if (raw === undefined) return EMPTY_STATE;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return EMPTY_STATE;
  const r = v as Record<string, unknown>;
  return {
    ...(typeof r["mark"] === "string" ? { mark: r["mark"] } : {}),
    ...(typeof r["nudgedAt"] === "number" ? { nudgedAt: r["nudgedAt"] } : {}),
    ...(r["pending"] === true ? { pending: true } : {}),
    would: count(r["would"]),
    nudged: count(r["nudged"]),
    taken: count(r["taken"]),
    quiet: count(r["quiet"]),
    at: count(r["at"]),
  };
}

/** The four counters, summed over the rows that changed since `sinceMs`. */
export interface NoticingTotals {
  readonly sessions: number;
  readonly would: number;
  readonly nudged: number;
  readonly taken: number;
  readonly quiet: number;
}

export function noticingTotals(store: { metaWithPrefix(prefix: string): Map<string, string> }, sinceMs: number): NoticingTotals {
  let sessions = 0;
  let would = 0;
  let nudged = 0;
  let taken = 0;
  let quiet = 0;
  for (const raw of store.metaWithPrefix(NOTICING_META_PREFIX).values()) {
    const s = readNoticingState(raw);
    if (s.at < sinceMs || s.would + s.nudged + s.taken + s.quiet === 0) continue;
    sessions += 1;
    would += s.would;
    nudged += s.nudged;
    taken += s.taken;
    quiet += s.quiet;
  }
  return { sessions, would, nudged, taken, quiet };
}

/** The console's line (`counterparts mechanisms`). Pure. */
export function noticingConsoleLine(t: NoticingTotals): string {
  if (t.sessions === 0) return "Noticing at Stops (Claude Code): nothing read or sent this week.";
  return `Noticing at Stops (Claude Code), this week over ${plural(t.sessions, "session", "sessions")}: would ${String(t.would)}, nudged ${String(t.nudged)}, taken ${String(t.taken)}, quiet ${String(t.quiet)}`;
}

// ── the settings ────────────────────────────────────────────────────────────

/** Compile the owner's patterns; one that will not compile is left out (the config reader names it). */
export function compilePatterns(sources: readonly string[] | undefined): RegExp[] {
  const out: RegExp[] = [];
  for (const s of sources ?? []) {
    try {
      out.push(new RegExp(s));
    } catch {
      /* named by `config.ts#readNoticing` */
    }
  }
  return out;
}

/** The configuration's switch and patterns, compiled (`AdapterConfig.noticing`; absent: `TUNABLES.NOTICING_ON`, no patterns). */
export function noticingSettings(config: Pick<AdapterConfig, "noticing">): NoticingSettings {
  const n = config.noticing;
  return {
    on: n?.enabled ?? TUNABLES.NOTICING_ON,
    bashPatterns: compilePatterns(n?.bashPatterns),
    bashOutgoing: compilePatterns(n?.bashOutgoing),
  };
}
