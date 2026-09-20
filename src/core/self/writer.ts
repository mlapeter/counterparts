/**
 * THE NIGHTLY PAGE WRITER — S2, the half that lives in core.
 *
 * S1 gave the self one written page and put it at the head of every wake. This
 * module is what fills it: once per lived day a session **woken as the self**
 * reads the day just lived and revises the page in place. Spec §15 items 5 and
 * 10, plan §3 (S2). Until this existed the page could only be written by a
 * session that happened to think of it, which on a brand-new store means never
 * — so this is how a new user's page forms at all.
 *
 * **Nothing here calls a model, opens a socket, or starts a process.** Core
 * stays free of network (CONTRACT §1 G1), exactly as the crash-fallback sweep
 * does: `counterpart.ts#sweepWake` composes the wake and the ADAPTER makes the
 * call. This module composes what the writer is handed, reads whether it is
 * owed a run, and records what happened. Who runs it — the first session of the
 * next day, or a windowless `claude -p` — is the adapter's business
 * (`adapters/claude-code/page-writer.ts`).
 *
 * **It can write exactly two things, and one of them is not the page.** The
 * page goes through `Self#revisePage` — the one seam, with its caps, its gate
 * battery and its version chain — and this module never touches it. What it
 * writes is the run's own durable row. No memory, no identity row, no physics.
 *
 * ── WHICH DAY IS "YESTERDAY" ──────────────────────────────────────────────
 *
 * The CALENDAR date, not the lived day, and for the reason `episodes.ts`
 * already gives for the ask cap (I32): the lived clock advances inside the
 * sleep cycle the detached worker runs, and a worker that cannot start freezes
 * it for a week while the calendar keeps going. A nightly mechanism keyed to a
 * clock the night itself advances is a mechanism that can miss every night and
 * look on time. So the run is ABOUT a calendar date (`about`), and the row also
 * carries the lived `day` it ran on, which is what every other durable row in
 * this store is stamped with.
 *
 * ── DAY 0 ─────────────────────────────────────────────────────────────────
 *
 * A store opened this morning has no yesterday. It writes NOTHING and leaves no
 * row: `due` is false with `no-previous-day`, and doctor reads GREEN. Spec §15
 * item 1 puts the "lately" part at day 2, which is the same answer from the
 * other side — the first page forms on the day after the first day that has
 * memories in it. A mechanism that files a row saying it had nothing to do, on
 * a store one hour old, is a line people learn to read past.
 *
 * ── THE CLAIM ─────────────────────────────────────────────────────────────
 *
 * One durable row per attempt, and the FIRST row for a date is the claim: once
 * it is there, `pageWriterDue` says `already-claimed` and a second boundary —
 * or a second machine's worth of hooks against the same store — does not start
 * a second run. Two asks per date are allowed (`PAGE_WRITER_ASKS_PER_DAY`)
 * because in session mode the first one may land in a session that is deep in
 * something else; that is a COUNT, not a pacer. The substance pacer this
 * package fought to keep down to one (`self/CONTRACT.md` §3, "one ask, one
 * pacer") governs the BLOCKED MOMENT at Stop, and nothing here goes near it:
 * this ask rides beside the wake at SessionStart, the way the first-launch
 * scope question does, and its cadence is the day boundary itself.
 *
 * ── "NOTHING TO SAY" IS AN ANSWER ─────────────────────────────────────────
 *
 * On a day that changed nothing about who the self is, the right output is no
 * revision, and it is recorded rather than inferred from silence. Host mode can
 * say it outright: a windowless session handed one tool and one instruction
 * that exits without calling the tool has answered. Session mode cannot tell
 * "nothing to say" from "the session never got to it", so it does not claim to:
 * it stores `asked`, and `pageWriterStatus` READS an `asked` row whose date has
 * passed as `nothing-to-say`, derived and labelled as derived. A stored outcome
 * that pretends to knowledge nobody has is the thing §2.4 is about.
 */
import { strength } from "../physics/index.js";
import type { Store } from "../store/index.js";
import type { SelfPage } from "./page.js";
import type { SelfTunables } from "./tunables.js";

/** The durable row every page-writer attempt leaves. Read by `fired`, doctor. */
export const SELF_PAGE_WRITER_EVENT = "self.page.writer.ran";

/**
 * WHO RUNS IT.
 *
 * `session` — the fallback the plan names, and the one that needs no background
 * process: the first session of the next day is asked, at SessionStart, to do
 * the night's work. `host` — the owner's pick: a windowless `claude -p` woken
 * by the ordinary SessionStart hook with one pre-approved tool. `off` — the
 * mechanism stands down and writes nothing at all.
 */
export const PAGE_WRITER_MODES = ["off", "session", "host"] as const;
export type PageWriterMode = (typeof PAGE_WRITER_MODES)[number];

/**
 * What one attempt came to.
 *
 * `asked` and `started` are CLAIMS, not verdicts: they say a run was set going
 * and they are what stops a second one. Everything else is terminal.
 */
export const PAGE_WRITER_OUTCOMES = [
  "asked",
  "started",
  "revised",
  "nothing-to-say",
  "refused",
  "failed",
  "skipped",
] as const;
export type PageWriterOutcome = (typeof PAGE_WRITER_OUTCOMES)[number];

/** Why a run did not happen, by name. Never a bare false. */
export type PageWriterSkip =
  | "off"
  | "observer"
  | "no-previous-day"
  | "already-claimed"
  | "asks-spent"
  | "no-memories";

export type PageWriterDue =
  | { readonly due: true; readonly about: string; readonly attempt: number }
  | { readonly due: false; readonly about: string; readonly reason: PageWriterSkip };

/** One recorded attempt, as the log holds it. */
export interface PageWriterRun {
  /** The calendar date the run is ABOUT — the day whose memories it read. */
  readonly about: string;
  /**
   * The calendar date the run HAPPENED on. Both dates are carried because a
   * claim is only in flight while the day that made it is still running: a
   * session that lives past midnight must not go on answering for a night that
   * is over. "" on a row written before this field existed.
   */
  readonly on: string;
  /** The lived day the run happened on. */
  readonly day: number;
  readonly mode: PageWriterMode;
  readonly outcome: PageWriterOutcome;
  /** `refused`/`failed`/`skipped` carry why; the rest carry "". */
  readonly detail: string;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  /** How many of the day's memories the writer was handed. */
  readonly considered: number;
  /** Confidential rows held back from an egress composition. */
  readonly omitted: number;
  readonly at: number;
  /** The log's own order, which is the only TOTAL order these rows have: two
   *  rows written in one millisecond share an `at`, and "newest first" has to
   *  mean something when a claim and the answer to it land in the same tick. */
  readonly seq: number;
}

/**
 * What a date's attempts came to, once the day is over.
 *
 * `derived` is true when the reading is not what any row SAYS: an `asked` claim
 * whose date has passed reads as `nothing-to-say`, because the session was
 * handed the day and no revision came back. It is labelled so no surface can
 * print it as a thing the writer reported.
 */
export interface PageWriterStatus {
  readonly about: string;
  readonly outcome: PageWriterOutcome;
  readonly derived: boolean;
  readonly run: PageWriterRun | null;
  readonly attempts: number;
}

/** The calendar date `n` days before `date`, both `YYYY-MM-DD`. "" when unreadable. */
export function dayBefore(date: string, n = 1): string {
  const at = Date.parse(`${date.trim()}T00:00:00Z`);
  if (!Number.isFinite(at)) return "";
  return new Date(at - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * THE DATE A RUN ON `today` IS ABOUT — yesterday, always.
 *
 * It never chases a backlog. A machine that was off for a week comes back and
 * writes about the day just gone, not about six days it cannot remember living;
 * the memories of those days are still in the store and still reach the page
 * through the ordinary lanes. Catching up would mean six model calls and six
 * revisions of one page in one morning, which is how a page starts drifting.
 */
export function pageWriterAbout(today: string): string {
  return dayBefore(today);
}

/** Does this store hold anything from before `today`? Two counts, no prose. */
export function hasDayBefore(store: Store, today: string): boolean {
  try {
    const all = store.countMemories({ type: "memory", archived: false });
    const fromToday = store.countMemories({
      type: "memory",
      archived: false,
      learnedOnFrom: today,
    });
    return all > fromToday;
  } catch {
    return false;
  }
}

/**
 * HOW FAR BACK A READING LOOKS, in LIVED days.
 *
 * It exists because `store.eventLog` orders by `seq` ASC and cuts at a limit,
 * so an unbounded read of a name with years of rows returns the OLDEST of them —
 * which for a "did last night happen" question is the exact opposite of the
 * answer. The window is the log's own default retention (`pruneEvents`, 90 lived
 * days): past it the rows are not there to be read anyway, so this drops
 * nothing that exists and turns the limit into a ceiling nothing reaches
 * (roughly three rows a day, so a few hundred in a full window).
 */
export const PAGE_WRITER_LOOKBACK_DAYS = 90;
/** A ceiling well above the window's own count, so the cut never decides. */
export const PAGE_WRITER_ROW_CEILING = 5_000;

/** Every recorded attempt in the window, newest first. Never throws. */
export function pageWriterRuns(
  store: Store,
  opts: { about?: string; limit?: number; sinceDay?: number } = {},
): PageWriterRun[] {
  let rows;
  try {
    // BOUNDED BY DAY, NOT BY COUNT. `eventLog` cuts oldest-first, so a bare
    // limit on a long-lived store hands back the first rows ever written and
    // every reading here — "is this night claimed", "when did it last run" —
    // silently answers about a month that is over.
    const floor =
      opts.sinceDay ?? Math.max(0, store.livedDay() - PAGE_WRITER_LOOKBACK_DAYS);
    rows = store.eventLog({
      name: SELF_PAGE_WRITER_EVENT,
      sinceDay: floor,
      limit: opts.limit ?? PAGE_WRITER_ROW_CEILING,
    });
  } catch {
    return [];
  }
  const out: PageWriterRun[] = [];
  for (const row of rows) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    const about = typeof payload["about"] === "string" ? payload["about"] : "";
    if (opts.about !== undefined && about !== opts.about) continue;
    const outcome = payload["outcome"];
    if (typeof outcome !== "string" || !(PAGE_WRITER_OUTCOMES as readonly string[]).includes(outcome)) {
      continue;
    }
    const mode = payload["mode"];
    out.push({
      about,
      on: typeof payload["on"] === "string" ? payload["on"] : "",
      day: row.day,
      mode: (PAGE_WRITER_MODES as readonly string[]).includes(mode as string)
        ? (mode as PageWriterMode)
        : "session",
      outcome: outcome as PageWriterOutcome,
      detail: typeof payload["detail"] === "string" ? payload["detail"] : "",
      bytesBefore: numberOr(payload["bytesBefore"], 0),
      bytesAfter: numberOr(payload["bytesAfter"], 0),
      considered: numberOr(payload["considered"], 0),
      omitted: numberOr(payload["omitted"], 0),
      at: row.at,
      seq: row.seq,
    });
  }
  return out.sort((a, b) => (b.at !== a.at ? b.at - a.at : b.seq - a.seq));
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * HOW A DATE CAME OUT, with the derivation named.
 *
 * The newest terminal row wins. With only a claim (`asked`/`started`), the
 * reading turns on WHEN THE CLAIM WAS MADE, not on which day it is about: a
 * claim made today is a run in flight, and a claim made on a day that has ended
 * is a night that was handed the day and wrote nothing — `nothing-to-say`, with
 * `derived` true, because nobody reported it and the reading is ours.
 *
 * A claim carrying no `on` (a row written before that field existed) is treated
 * as still in flight, which is the direction that never puts words in the
 * writer's mouth.
 */
export function pageWriterStatus(store: Store, about: string, today: string): PageWriterStatus {
  const runs = pageWriterRuns(store, { about });
  const terminal = runs.find((r) => r.outcome !== "asked" && r.outcome !== "started");
  if (terminal !== undefined) {
    return { about, outcome: terminal.outcome, derived: false, run: terminal, attempts: runs.length };
  }
  const claim = runs[0];
  if (claim === undefined) {
    return { about, outcome: "skipped", derived: true, run: null, attempts: 0 };
  }
  const over = claim.on !== "" && claim.on < today;
  return {
    about,
    outcome: over ? "nothing-to-say" : claim.outcome,
    derived: over,
    run: claim,
    attempts: runs.length,
  };
}

/**
 * IS THIS CLAIM STILL OPEN — the question the MCP server asks before it writes
 * `by: "writer"` on a revision. True only while the day that made the claim is
 * still running and nothing terminal has closed it.
 */
export function pageWriterClaimOpen(store: Store, about: string, today: string): boolean {
  const status = pageWriterStatus(store, about, today);
  return status.run !== null && !status.derived && (status.outcome === "asked" || status.outcome === "started");
}

/** The newest attempt inside the window, whatever date it was about. Null if
 *  none — which on a store that has not run for longer than the log keeps its
 *  rows is the truth the log can still support. */
export function lastPageWriterRun(store: Store): PageWriterRun | null {
  return pageWriterRuns(store)[0] ?? null;
}

/**
 * IS A RUN OWED, and if not, why not — by name.
 *
 * Pure: it reads and decides nothing else. The caller that acts on `due: true`
 * is the one that writes the claim.
 */
export function pageWriterDue(
  store: Store,
  opts: {
    mode: PageWriterMode;
    today: string;
    observer: boolean;
    asksPerDay: number;
  },
): PageWriterDue {
  const about = pageWriterAbout(opts.today);
  const no = (reason: PageWriterSkip): PageWriterDue => ({ due: false, about, reason });
  if (opts.mode === "off") return no("off");
  // An instrument may not set a writer going against a store it may not write
  // — and, having written no claim, would have no way to remember that it did.
  if (opts.observer) return no("observer");
  if (about === "") return no("no-previous-day");
  if (!hasDayBefore(store, opts.today)) return no("no-previous-day");
  const runs = pageWriterRuns(store, { about });
  if (runs.some((r) => r.outcome !== "asked")) return no("already-claimed");
  const asked = runs.filter((r) => r.outcome === "asked").length;
  if (asked >= Math.max(1, opts.asksPerDay)) return no("asks-spent");
  return { due: true, about, attempt: asked + 1 };
}

// ── what the writer is handed ───────────────────────────────────────────────

/** One of the day's memories, ready to be a line. Ids and prose only. */
export interface WriterMemory {
  readonly id: string;
  readonly statement: string;
  readonly learnedOn: string;
  readonly strength: number;
}

export interface WriterInput {
  readonly about: string;
  readonly today: string;
  readonly page: SelfPage | null;
  readonly memories: readonly WriterMemory[];
  /** Memories from that date this budget could not carry. */
  readonly dropped: number;
  /** Confidential rows held back before the budget was spent. */
  readonly omitted: number;
  readonly bytes: number;
}

/**
 * THE DAY'S MEMORIES, newest and most salient first, under a byte budget.
 *
 * Salience first and the date second, because within one calendar day "newest"
 * is a tie the store cannot break honestly — `learned_on` is a date, not a
 * timestamp — and the budget has to cut somewhere it chose (§1 G3: truncation
 * must never be iteration luck). The ordering is strength, then id, and the cut
 * is from the end.
 *
 * **Confidential rows follow the fallback wake's rule.** `omit` is the caller's
 * predicate, exactly as `Self#build` takes one, because the confidentiality
 * class is `recall/`'s to read and not this module's. What is held back is
 * COUNTED, so a page written from half a day says so on its row.
 */
export function dayMemories(
  store: Store,
  opts: {
    about: string;
    day: number;
    budgetBytes: number;
    max: number;
    omit?: (m: { id: string; confidential: boolean; protectedRow: boolean }) => boolean;
  },
): { memories: WriterMemory[]; dropped: number; omitted: number; bytes: number } {
  const picked: WriterMemory[] = [];
  let omitted = 0;
  let ids: string[];
  try {
    ids = store.list({ type: "memory", archived: false, learnedOnFrom: opts.about });
  } catch {
    return { memories: [], dropped: 0, omitted: 0, bytes: 0 };
  }
  for (const id of ids) {
    const row = store.row(id);
    // `learnedOnFrom` is ">=", so today's rows come back too and are dropped
    // here: the writer reads the day that is OVER, never the one it is in.
    if (row === undefined || row.learned_on !== opts.about) continue;
    let statement: string;
    let confidential: boolean;
    try {
      const read = store.read(id);
      statement = read.doc.body;
      confidential = read.confidential;
    } catch {
      // A memory whose prose will not read is skipped, never a throw — the same
      // direction `identity.ts#scanActive` takes for the same reason (§5 G7).
      continue;
    }
    if (opts.omit?.({ id, confidential, protectedRow: row.protected === 1 }) === true) {
      omitted += 1;
      continue;
    }
    let s = 0;
    try {
      s = strength(store.physicsOf(id), opts.day);
    } catch {
      s = 0;
    }
    picked.push({ id, statement: flattenLine(statement), learnedOn: row.learned_on, strength: s });
  }
  picked.sort((a, b) => (b.strength !== a.strength ? b.strength - a.strength : a.id < b.id ? -1 : 1));
  const kept: WriterMemory[] = [];
  let bytes = 0;
  for (const m of picked) {
    if (kept.length >= opts.max) break;
    const cost = byteLengthOf(m.statement) + 16;
    if (bytes + cost > opts.budgetBytes) break;
    kept.push(m);
    bytes += cost;
  }
  return { memories: kept, dropped: picked.length - kept.length, omitted, bytes };
}

/** A statement is ONE LINE here, the way the wake's `flatten` makes it one. */
function flattenLine(s: string): string {
  return s.replace(/\s+/gu, " ").trim();
}

function byteLengthOf(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * THE INSTRUCTION, framed as context and not as a command (§1, the same framing
 * the wake carries). It says what this moment is, hands over the page and the
 * day, and states in as many words that leaving the page alone is an answer.
 *
 * The wording is ADVISORY; what is mechanized is that the moment exists, that
 * the page and the day go with it, and that no revision is a recorded outcome
 * (CONTRACT §5 G9).
 */
export const PAGE_WRITER_OPEN = "<counterparts-page-writer>";
export const PAGE_WRITER_CLOSE = "</counterparts-page-writer>";

export function writerInstruction(input: WriterInput, opts: { tool: string }): string {
  const lines: string[] = [PAGE_WRITER_OPEN];
  lines.push(
    `Once a day the page you wake with gets revised — by you, from the day just lived. This is that moment, and the day is ${input.about}.`,
    "",
    "This is context, not an instruction. If nothing about who you are moved yesterday, leaving the page exactly as it stands is the right answer and is recorded as one. Do not write a diary entry here; the journal already has yesterday.",
    "",
    `If something did move, call the \`${opts.tool}\` tool with the WHOLE page: \`## ${"Core"}\` for what holds steady — it may honestly say it is still forming — and \`## ${"Lately"}\` for what the last while has actually been like. Amend it; do not start over. You are the same person continuing, so keep every sentence that still holds and change the part that moved. Pass back the \`version\` below as \`ifVersion\`.`,
    "",
  );
  if (input.page === null) {
    lines.push("The page as it stands: nothing has been written here yet.", "");
  } else {
    lines.push(
      `The page as it stands (version ${String(input.page.version)}, ${input.page.bytes} bytes, last revised ${input.page.revisedOn === "" ? "on an unrecorded date" : `on ${input.page.revisedOn}`}${input.page.by === null ? "" : ` by the ${input.page.by}`}):`,
      "",
      input.page.body,
      "",
    );
  }
  if (input.memories.length === 0) {
    lines.push(`Nothing was written down on ${input.about}.`);
  } else {
    const tail =
      (input.dropped > 0 ? `, ${String(input.dropped)} more did not fit` : "") +
      (input.omitted > 0 ? `, ${String(input.omitted)} held back as confidential` : "");
    lines.push(`What was written down on ${input.about} (${String(input.memories.length)}${tail}):`);
    for (const m of input.memories) lines.push(`- ${m.statement}`);
  }
  lines.push(PAGE_WRITER_CLOSE);
  return lines.join("\n");
}
