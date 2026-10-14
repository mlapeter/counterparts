/**
 * THE SIDEBAR'S STATUS FILE (2026-10-14) — what the Claude Code sidebar mod
 * (`hooks/sidebar/`) shows, written where it can read it without a network.
 *
 * The plugin directory's review holds a mod that can both fetch and run a
 * command, so the sidebar stopped asking the dashboard on 127.0.0.1:4747 and
 * reads this file with `$.fs.read` instead, on the timer it already had. The
 * dashboard keeps every endpoint (its own page uses them); only the sidebar
 * stopped calling them.
 *
 * **Where.** `<config dir>/sidebar.json`, beside `scopes.json` — the sidebar
 * already finds that directory the way the hooks find their configuration
 * (`hooks/sidebar/hooks/register.tsx#scopesFile`). NOT inside the store: every
 * top-level name there is classified (`core/store/paths.ts#LAYOUT`) and an
 * unclassified one refuses the store at open, an older build's included.
 *
 * **What.** The answers the sidebar used to ask for, computed by the same view
 * functions the dashboard serves them from: which store (`storeId`, the
 * `/api/whoami` id, so a sidebar never shows another memory's numbers), the
 * pulse, today's counts per mechanism, the newest dreams, the newest rows of
 * the activity log (and of the few names the sidebar reads deeper), each
 * mechanism's panel, and the memories those rows name — title, kind, the date
 * it was learned, and the first {@link TEXT_CAP} characters of its text (none
 * for a confidential one). Capped throughout; measured on the demo store it is
 * well under 256 KiB.
 *
 * **When.** Never on a hook's path. The detached worker writes it after every
 * boundary (Stop, SessionEnd: `claude-code/bin/runner.ts`), and the MCP server
 * a moment after it starts, after each tool call that wrote, and whenever the
 * activity log moved under it (`mcp/bin/serve.ts`). Each write opens its own
 * observer handle — the view functions refuse a writable one — and closes it.
 *
 * **How.** A temp file of this process's own, then a rename: a reader sees the
 * old file or the new one, never half of either, and two writers racing each
 * land whole. It never throws: the result says what happened.
 */
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Dashboard } from "./dashboard/index.js";
import type { DashboardSource } from "./dashboard/source.js";
import { dreamsView } from "./dashboard/web/views/dreams.js";
import { mechanismPanel } from "./dashboard/web/views/mechanism-panel.js";
import { mechanismsView } from "./dashboard/web/views/mechanisms.js";
import { activityView, memoryDetail, pulse } from "./dashboard/web/views.js";
import { installedVersion } from "./sessions.js";
import { storeId } from "./store-id.js";

export const SIDEBAR_FILE_NAME = "sidebar.json";
/** The file's shape. A reader that does not know a version shows nothing from it. */
export const SIDEBAR_STATUS_VERSION = 1;

/** Newest rows of the whole log: what lights the sidebar's dot and moves its counts between two files. */
export const RECENT_ROWS = 100;
/** Newest rows of the names the sidebar reads deeper (a resumed session's surfaced and saved, a mechanism's firings). */
export const NAMED_ROWS: Readonly<Record<string, number>> = {
  "recall.decision": 40,
  "gate.deposit": 40,
  "contradiction.settled": 20,
  "dream.journaled": 5,
};
/** Dreams carried (the newest is shown; a dream's firings read the changes of the few newest). */
export const DREAMS = 3;
/** Memories carried, and how much of each one's text. */
export const MEMORY_CAP = 60;
export const TEXT_CAP = 1500;
/** The memory server writes the file at least this often while it runs, moved or not. */
export const REFRESH_MS = 30 * 60_000;

/** `<config dir>/sidebar.json` — beside the configuration, like `scopes.json`. */
export function sidebarStatusPath(configPath: string): string {
  return join(dirname(configPath), SIDEBAR_FILE_NAME);
}

type Row = { seq: number } & Record<string, unknown>;

export interface SidebarMemory {
  readonly title: string;
  readonly text: string;
  /** The text was cut at {@link TEXT_CAP}: the rest is on the dashboard. */
  readonly cut: boolean;
  readonly kind: string | null;
  readonly learnedOn: string | null;
  readonly journal: boolean;
}

export interface SidebarStatus {
  readonly version: number;
  /** `adapters/store-id.ts`: which store this is (an id, never the path). */
  readonly storeId: string | null;
  /** Epoch ms. */
  readonly writtenAt: number;
  /** The package version that wrote it. */
  readonly build: string | null;
  readonly pulse: { readonly day: number; readonly memories: number; readonly lastSeq: number };
  /** Times each mechanism fired on the person's calendar day (`mechanismsView`). */
  readonly today: { readonly date: string; readonly counts: Readonly<Record<string, number>> } | null;
  readonly dreams: readonly unknown[];
  /** Narrated rows (`activityView`'s), newest first, each seq once. */
  readonly events: readonly Row[];
  /** Each mechanism's panel rows (`mechanismPanel`). */
  readonly panels: Readonly<Record<string, readonly Row[]>>;
  /** The memories the rows above name. */
  readonly memories: Readonly<Record<string, SidebarMemory | null>>;
}

/**
 * The detail keys the sidebar reads (`hooks/sidebar/hooks/feed.ts`: its
 * rules, `classify`, `mechFirings`, `surfacedIds`, the session seed). The rest
 * of a row's detail — a deposit's gate scores, a sleep cycle's phases — is the
 * dashboard page's, and most of a row's bytes.
 */
export const DETAIL_KEYS: ReadonlySet<string> = new Set([
  "accepted", "actor", "actorId", "applied", "challengerId", "credited", "deposited", "direction", "faded",
  "footnoteCount", "footnotes", "gist", "holds", "how", "id", "ids", "linksReached", "memoryId", "merge",
  "moodMatched", "over", "replayLinks", "session", "site", "source", "surfaced", "surfacedCount", "targetId", "turn",
]);

/** A row as the sidebar reads it: the narrated row less what only the dashboard's page draws. */
function slim(r: Row): Row {
  const out: Row = { seq: r.seq };
  for (const k of ["at", "day", "name", "text", "subject", "repeats"]) if (r[k] !== undefined) out[k] = r[k];
  if (Array.isArray(r["detail"])) {
    out["detail"] = (r["detail"] as { key?: unknown }[]).filter((d) => typeof d.key === "string" && DETAIL_KEYS.has(d.key));
  }
  return out;
}

/** Every `mem_…` id a row names, in its subject or its detail. */
const MEMORY_ID = /\bmem_[A-Za-z0-9]+\b/g;

/** The status, from an open observer source. Pure but for the reads. */
export function buildSidebarStatus(src: DashboardSource, now: number, build: string | null = installedVersion()): SidebarStatus {
  const p = pulse(src);
  let today: SidebarStatus["today"] = null;
  const panels: Record<string, Row[]> = {};
  try {
    const m = mechanismsView(src);
    const counts: Record<string, number> = {};
    for (const v of m.mechanisms as readonly { id: string; firedToday?: unknown }[]) {
      if (typeof v.firedToday === "number") counts[v.id] = v.firedToday;
      const panel = mechanismPanel(src, v.id);
      if (panel.found && panel.activity.length > 0) panels[v.id] = (panel.activity as unknown as Row[]).map(slim);
    }
    today = { date: m.today, counts };
  } catch {
    today = null;
  }
  const bySeq = new Map<number, Row>();
  const keep = (rows: readonly unknown[]): void => {
    for (const r of rows as readonly Row[]) if (typeof r.seq === "number" && !bySeq.has(r.seq)) bySeq.set(r.seq, slim(r));
  };
  keep(activityView(src, { limit: RECENT_ROWS }).events);
  for (const [name, limit] of Object.entries(NAMED_ROWS)) keep(activityView(src, { name, limit }).events);
  const events = [...bySeq.values()].sort((a, b) => b.seq - a.seq);
  const dreams = dreamsView(src, DREAMS).dreams;

  // The memories named, newest rows first, up to the cap.
  const ids: string[] = [];
  const seen = new Set<string>();
  const collect = (v: unknown): void => {
    for (const m of JSON.stringify(v).matchAll(MEMORY_ID)) {
      if (ids.length >= MEMORY_CAP) return;
      if (!seen.has(m[0])) {
        seen.add(m[0]);
        ids.push(m[0]);
      }
    }
  };
  for (const e of events) collect(e);
  for (const rows of Object.values(panels)) collect(rows);
  collect(dreams);
  const memories: Record<string, SidebarMemory | null> = {};
  for (const id of ids) {
    try {
      const d = memoryDetail(src, id);
      if (!d.found) {
        memories[id] = null;
        continue;
      }
      const text = d.confidential ? "" : d.text.trim();
      memories[id] = {
        title: d.title,
        text: text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP).trimEnd()}…` : text,
        cut: text.length > TEXT_CAP,
        kind: d.journal ? null : d.kind,
        learnedOn: d.learnedOn,
        journal: d.journal,
      };
    } catch {
      memories[id] = null;
    }
  }
  return {
    version: SIDEBAR_STATUS_VERSION,
    storeId: storeId(src.store.dir),
    writtenAt: now,
    build,
    pulse: { day: p.day, memories: p.memories, lastSeq: p.lastSeq },
    today,
    dreams,
    events,
    panels,
    memories,
  };
}

export interface SidebarWrite {
  readonly written: boolean;
  /** `written`, or why not: `no-config`, `same` (the file already says this seq), or the error's code. */
  readonly reason: string;
  readonly bytes: number;
  readonly ms: number;
  readonly lastSeq: number | null;
}

/** The `pulse.lastSeq` and `writtenAt` of the file as it stands, or null. */
export function readSidebarStamp(file: string): { lastSeq: number; writtenAt: number; storeId: string | null } | null {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<SidebarStatus>;
    if (v.version !== SIDEBAR_STATUS_VERSION || typeof v.pulse?.lastSeq !== "number" || typeof v.writtenAt !== "number") return null;
    return { lastSeq: v.pulse.lastSeq, writtenAt: v.writtenAt, storeId: typeof v.storeId === "string" ? v.storeId : null };
  } catch {
    return null;
  }
}

/**
 * Open the store as an observer, build the status, write it beside the
 * configuration. Never throws. `ifMoved`: skip when the file already stands at
 * the log's newest seq for this store (another session's server wrote it) —
 * unless it is older than `maxAgeMs`, so a calendar day's turn still lands.
 */
export function writeSidebarStatus(opts: {
  readonly configPath: string;
  readonly dataDir: string;
  readonly timeZone?: string;
  readonly ifMoved?: { readonly lastSeq: number; readonly maxAgeMs: number };
  readonly now?: () => number;
}): SidebarWrite {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const out = (written: boolean, reason: string, bytes = 0, lastSeq: number | null = null): SidebarWrite => ({
    written,
    reason,
    bytes,
    ms: clock() - started,
    lastSeq,
  });
  if (opts.configPath.length === 0 || opts.dataDir.length === 0) return out(false, "no-config");
  const file = sidebarStatusPath(opts.configPath);
  if (!existsSync(dirname(file))) return out(false, "no-config");
  if (opts.ifMoved !== undefined) {
    const stamp = readSidebarStamp(file);
    if (stamp !== null && stamp.lastSeq >= opts.ifMoved.lastSeq && started - stamp.writtenAt < opts.ifMoved.maxAgeMs) {
      return out(false, "same", 0, stamp.lastSeq);
    }
  }
  let dash: Dashboard | null = null;
  // One process writes one at a time (the write is synchronous), so its pid makes the name its own; `uninstall` knows the shape.
  const tmp = `${file}.${String(process.pid)}.tmp`;
  try {
    dash = Dashboard.open({ dir: opts.dataDir, ...(opts.timeZone === undefined ? {} : { timeZone: opts.timeZone }) });
    const status = buildSidebarStatus(dash.source, clock());
    const text = JSON.stringify(status);
    // Owner-only: it holds memories' words, as the store beside it does.
    writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // a filesystem without modes: the write stands
    }
    renameSync(tmp, file);
    return out(true, "written", Buffer.byteLength(text, "utf8"), status.pulse.lastSeq);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // nothing more to do
    }
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : err instanceof Error
          ? err.name
          : "UNKNOWN";
    return out(false, code);
  } finally {
    try {
      dash?.close();
    } catch {
      // closed or never opened
    }
  }
}

/**
 * A REMOVAL'S CHASE (the console's `remove`, which calls this): the status file holds a few memories'
 * words, so a memory removed must not stay readable in it until the next
 * write. The file beside the store's parent (the layout `install` writes:
 * `<config dir>/store`, `<config dir>/sidebar.json`) is deleted when it names
 * the id; the next writer writes it again without the memory. Never throws:
 * the answer is a surface line for the removal's report, or null when there
 * was nothing to chase.
 */
export function chaseSidebarStatus(storeDir: string, id: string): { chased: boolean; line: string } | null {
  const file = join(dirname(storeDir), SIDEBAR_FILE_NAME);
  try {
    if (!existsSync(file)) return null;
    if (!readFileSync(file, "utf8").includes(id)) return { chased: true, line: "sidebar status file (0, it did not name it)" };
    rmSync(file, { force: true });
    return { chased: true, line: "sidebar status file (deleted; written again without it)" };
  } catch {
    return { chased: false, line: `sidebar status file — ${file} may still name it until the next write` };
  }
}

/**
 * The MCP server's writer: one timer at a time, never on a tool call's path
 * (each write is scheduled after the answer went out), and a cheap look at the
 * log's newest seq on an interval, so a turn's recall row, another session's
 * deposit or a night's dream reaches the file within one interval; and once
 * every {@link REFRESH_MS} whatever moved, so today's counts turn over at
 * midnight and a file older than that says no writer is running (the sidebar
 * shows its age then). Every timer is unref'd: none keeps the process alive.
 */
export class SidebarStatusWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastSeq = -1;
  private lastLookAt = Date.now();
  private stopped = false;

  private readonly opts: {
    readonly configPath: string;
    readonly dataDir: string;
    readonly timeZone?: string;
    /** The log's newest seq, read cheaply on the server's own handle; null when it cannot say. */
    readonly newestSeq: () => number | null;
    readonly onWrite?: (w: SidebarWrite) => void;
  };

  constructor(opts: SidebarStatusWriter["opts"]) {
    this.opts = opts;
  }

  /** Write once, `delayMs` from now; a write already waiting keeps its time. */
  schedule(delayMs: number): void {
    if (this.stopped || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writeNow();
    }, delayMs);
    this.timer.unref?.();
  }

  /** Look at the log every `everyMs`; a moved one schedules a write. */
  watch(everyMs: number): void {
    if (this.stopped || this.interval !== null) return;
    this.interval = setInterval(() => {
      let seq: number | null = null;
      try {
        seq = this.opts.newestSeq();
      } catch {
        seq = null;
      }
      if ((seq !== null && seq > this.lastSeq) || Date.now() - this.lastLookAt > REFRESH_MS) this.schedule(0);
    }, everyMs);
    this.interval.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.interval !== null) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }

  private writeNow(): void {
    let seq: number | null = null;
    try {
      seq = this.opts.newestSeq();
    } catch {
      seq = null;
    }
    const w = writeSidebarStatus({
      configPath: this.opts.configPath,
      dataDir: this.opts.dataDir,
      ...(this.opts.timeZone === undefined ? {} : { timeZone: this.opts.timeZone }),
      // Another session's server may have written this very seq a moment ago.
      ...(seq === null ? {} : { ifMoved: { lastSeq: seq, maxAgeMs: 10 * 60_000 } }),
    });
    this.lastLookAt = Date.now();
    if (w.lastSeq !== null) this.lastSeq = Math.max(this.lastSeq, w.lastSeq);
    else if (seq !== null) this.lastSeq = Math.max(this.lastSeq, seq);
    try {
      this.opts.onWrite?.(w);
    } catch {
      // a log that will not take the line costs nothing here
    }
  }
}
