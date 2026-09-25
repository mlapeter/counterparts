/**
 * THE WRITE-UP DOOR — how a live session writes up a session that ended before
 * it was written up (roadmap C2, owner 2026-09-23).
 *
 * The SessionStart hook (`claude-code/hooks.ts#deliverWriteUpAsk`) points the
 * next session in a project at the oldest session there that owes a write-up.
 * Everything else happens here, through a `writeUp` FIELD on `session_end`
 * naming the ended session, beside the ordinary `session` (the live one, bound
 * exactly as every `session_end` is):
 *
 *   - **FETCH** — `writeUp` and NO `memories` (or `memories: []` before any
 *     fetch is on record — a host that honours a schema's `required` sends
 *     that, PR #192 review m2): the next unwritten part of that session's
 *     captured words IN THIS PROJECT, up to `WRITE_UP_PART_BYTES` (~24 KB), and
 *     the part is recorded as handed to THIS session (`writeUpFor`).
 *     The words travel here rather than beside the wake because an MCP result
 *     is not under the host's 10,000-character cap on a hook's output
 *     (`claude-code/INTERFACE-GAPS` §15). One part per session: a session that
 *     has answered its part is not handed the next — that comes at a later
 *     start. Fetching again before answering hands the same part back.
 *   - **ANSWER** — `writeUp` WITH `memories`, for the part last fetched. Each
 *     entry takes `session_end`'s own road (gate battery, redaction, authored
 *     channel, per-entry isolation) under the WRITING session's name. An EMPTY
 *     batch is a real answer here too — "nothing worth keeping", the rule the
 *     ordinary `session_end` follows — and closes the part without minting. The
 *     LAST part's answer marks the ended session written up through B3's seam,
 *     `by: "next-session"`, which starts its seven-day retention clock; how it
 *     was answered (`memories` / `nothing-new`) is recorded on the writing
 *     session's record. A write-up's memories claim NO coverage of the
 *     writer's own words (MAJOR 4): through core's `SessionEndDepositContext.cover` seam
 *     they claim nothing on an earlier part, and the ENDED session's words here
 *     on the last one.
 *
 * **One project's words at a time** (MAJOR 6). A session that left words under
 * two projects is written up in each by a session there: a writer here is
 * served, and closes, only the words filed here. The session is marked written
 * up — which B3 reads for the whole session — only when the last project's
 * share comes back; until then the finished shares wait (`waiting`).
 *
 * **A field, not a sibling tool,** and the field can be made safe: the call is
 * diverted HERE before `session_end` reads anything else, so a write-up never
 * writes a handoff and never marks the writing session "nothing new". A sibling
 * tool would have cost every person who allowlisted the server's tools one by
 * one a new approval, and the test suite pins the tool list exactly.
 *
 * **It is one of the two importers of the write-up mark** outside `remember/`
 * (`test/cli.test.ts` pins it; the other is the worker's API sweep), because
 * the mark is a deletion on a seven-day fuse. So everything below exists to
 * make sure the mark is only set on a session that owed it, by a session that
 * was handed its words.
 *
 * **What it refuses, each by name** (a refusal writes nothing — no memory, no
 * progress, no mark):
 *
 *   - `handoff-not-accepted` — a `handoff` beside `writeUp`: the pointer is
 *     THIS directory's, written by the live session for itself;
 *   - `unknown-session` — not an id, or one the hooks never recorded and the
 *     buffer holds no words for;
 *   - `live-session` — this session's own id, or one the registry holds running;
 *   - `other-project` — ended in another directory;
 *   - `already-written-up` — so a second write-up of the same id is refused;
 *   - `owes-nothing` — B3's predicate says it owes nothing (`why`:
 *     below-threshold, answered, no-text);
 *   - `not-asked` — a fetch for a session the hook did not point this one at,
 *     or memories from a session that fetched nothing of it;
 *   - `wrong-part` — an answer naming a part other than the one fetched;
 *   - `part-already-written` — the part this session fetched already came back
 *     (the next one comes at a later start);
 *   - `memories-required` — `memories` present and not a list;
 *   - `nothing-landed` — every entry of a non-empty batch was refused by the
 *     gate battery (a duplicate counts as landed: the store already holds it);
 *   - `io-failed` — the fetch could not record that it handed the part over,
 *     so it hands nothing (an answer would be refused `not-asked`).
 *
 * The first six are `sessions.ts#writeUpStanding` — the same function the
 * hook's pointer filters with, so the pointer never names a session the door
 * would refuse.
 */
import type { Counterpart } from "../../core/counterpart.js";
// THE MARK, by path — `remember/index.ts` does not re-export it (PR #189
// re-review, R1), and `test/cli.test.ts` pins who may import it.
import { WRITE_UP_BY, recordWriteUp } from "../../core/remember/write-up-seam.js";
import type { WriteUpReason } from "../../core/remember/write-up-seam.js";
import { calendarDate } from "../../core/self/index.js";
import {
  WRITE_UP_KEPT_MARK,
  WRITE_UP_PART_BYTES,
  isSessionId,
  markWriteUpFetched,
  progressKey,
  readSession,
  readWriteUpProgress,
  sameScope,
  saveWriteUpProgress,
  writeUpEntries,
  writeUpParts,
  writeUpPlan,
  writeUpStanding,
} from "../sessions.js";
import type { WriteUpAnswer, WriteUpProgress } from "../sessions.js";
import type { HeldSession } from "../../core/remember/index.js";

/** Every way the door refuses. */
export const WRITE_UP_REFUSALS = [
  "handoff-not-accepted",
  "unknown-session",
  "live-session",
  "other-project",
  "already-written-up",
  "owes-nothing",
  "not-asked",
  "wrong-part",
  "part-already-written",
  "memories-required",
  "nothing-landed",
  "io-failed",
] as const;
export type WriteUpRefusal = (typeof WRITE_UP_REFUSALS)[number];

/** Who the mark says wrote it up. Fixed: the next session, never free text. */
const BY: (typeof WRITE_UP_BY)[number] = "next-session";

/** What the per-entry deposit loop reports back. The loop is `session_end`'s own. */
export interface WriteUpDeposits {
  readonly outcomes: readonly Record<string, unknown>[];
  readonly deposited: number;
  /** Entries refused only because the store already holds the same content —
   *  what they say is kept, so they count as landed. */
  readonly duplicates: number;
}

export interface WriteUpDoorInput {
  readonly counterpart: Counterpart;
  /** Where the hooks' registry lives — the store's directory in production. */
  readonly registryDir: string;
  /** This server's project directory. */
  readonly scope: string;
  /** The WRITING session — the live one, already bound. */
  readonly session: string;
  readonly now: number;
  readonly args: Record<string, unknown>;
  /** `session_end`'s own per-entry loop, under the WRITING session's name,
   *  covering whose words `cover` says (`SessionEndDepositContext.cover`). */
  readonly deposit: (raw: readonly unknown[], cover: false | { readonly session: string }) => Promise<WriteUpDeposits>;
}

export interface WriteUpOutcome {
  /** A refusal's name, or what the call did. */
  readonly reason: WriteUpRefusal | "part" | "part-written" | "written-up" | "written-up-here";
  readonly isError: boolean;
  /** The tool result's body. On a fetch it carries the part's words; every
   *  other body is ids, counts and reasons. */
  readonly body: Record<string, unknown>;
}

const refused = (reason: WriteUpRefusal, detail: Record<string, unknown> = {}): WriteUpOutcome => ({
  reason,
  isError: true,
  body: { stored: false, writeUp: true, reason, ...detail },
});

const NO_DEPOSITS: WriteUpDeposits = { outcomes: [], deposited: 0, duplicates: 0 };

/** Everything one call works from, read once. */
interface Standing {
  readonly held: HeldSession;
  /** The buffer's own spelling of this project's scope. */
  readonly here: string;
  readonly key: string;
  readonly progress: WriteUpProgress | undefined;
  readonly all: Readonly<Record<string, WriteUpProgress>>;
}

/**
 * THE DOOR. Never throws on a refusal; a throw from the store is the caller's
 * to report, exactly as it is for an ordinary `session_end` entry.
 */
export async function writeUpDoor(input: WriteUpDoorInput): Promise<WriteUpOutcome> {
  const { args, counterpart } = input;
  const ended = args["writeUp"];
  if (args["handoff"] !== undefined && args["handoff"] !== null) {
    return refused("handoff-not-accepted", {
      detail: "A handoff is this directory's pointer, written by this session for itself. Send it on its own `session_end`, without `writeUp`.",
    });
  }
  if (!isSessionId(ended)) return refused("unknown-session", { writeUp: typeof ended === "string" ? ended : null });
  if (ended === input.session) {
    return refused("live-session", { writeUp: ended, detail: "That is this session. Its own memories go on an ordinary `session_end`." });
  }

  const t = counterpart.self.tunables;
  const plan = writeUpPlan({
    store: counterpart.store,
    spans: counterpart.spans,
    firstAsk: { turns: t.FIRST_ASK_TURNS, textBytes: t.FIRST_ASK_TEXT_BYTES },
  });
  const all = readWriteUpProgress(counterpart.store);
  const standing = writeUpStanding(plan, input.registryDir, ended, input.scope, input.now, { progress: all });
  if (standing.status === "owes-nothing") return refused("owes-nothing", { writeUp: ended, why: standing.why });
  if (standing.status !== "owed") return refused(standing.status, { writeUp: ended });
  const key = progressKey(ended, standing.here);
  const st: Standing = { held: standing.held, here: standing.here, key, progress: all[key], all };

  const record = readSession(input.registryDir, input.session);
  const mine = record?.writeUpFor?.session === ended ? record.writeUpFor : undefined;
  const raw = args["memories"];
  // A FETCH is no `memories` — or an empty list before any fetch is on record
  // (m2): a host that honours `required` sends `[]`, and with nothing fetched
  // there is nothing yet that `[]` could be the answer to.
  const fetching = raw === undefined || (Array.isArray(raw) && raw.length === 0 && mine === undefined);
  if (fetching) return handOver(input, ended, st, record?.writeUpPointer, mine);
  return takeBack(input, ended, st, mine, raw);
}

// ── FETCH ───────────────────────────────────────────────────────────────────

async function handOver(
  input: WriteUpDoorInput,
  ended: string,
  st: Standing,
  pointer: string | undefined,
  mine: { part: number; answer?: WriteUpAnswer } | undefined,
): Promise<WriteUpOutcome> {
  const { counterpart } = input;
  // POINTED AT THIS SESSION, by the hook — evidence the model cannot write.
  // Without it, any live session could read any owed session's words.
  if (pointer !== ended) return refused("not-asked", { writeUp: ended });
  // THE LAST PART HERE CAME BACK AND THE MARK DID NOT LAND (an IO failure):
  // this fetch finishes it, whoever answered — nothing deposited twice (MAJOR
  // 2). Keyed on `answer`, which only the last part's answer sets, and never on
  // a part count: once the words here read as kept, their marks lengthen the
  // text and a recount can find a part more than was served (re-review, m-B).
  const p = st.progress;
  if (p !== undefined && p.answer !== undefined && p.waiting !== true) {
    return finish(input, ended, st, p.parts, p.answer, NO_DEPOSITS, true);
  }
  if (mine?.answer !== undefined) {
    return refused("part-already-written", {
      writeUp: ended,
      part: mine.part,
      detail: "This session has written up its part. The next part is handed over at a later session start here.",
    });
  }
  const chunk = p?.chunk ?? WRITE_UP_PART_BYTES;
  const parts = writeUpParts(writeUpEntries(counterpart.spans, { session: ended, scopes: [st.here] }), chunk);
  if (parts.length === 0) return refused("owes-nothing", { writeUp: ended, why: "no-text" });
  // The same part again when this session fetched and has not answered;
  // otherwise the next one not yet written.
  const part = mine?.part ?? Math.min((p?.done ?? 0) + 1, parts.length);
  const next: WriteUpProgress = {
    ...(p ?? {}),
    chunk,
    parts: parts.length,
    done: Math.min(p?.done ?? 0, parts.length),
    handedAt: input.now,
  };
  if (!saveWriteUpProgress(counterpart.store, st.key, next)) return refused("io-failed", { writeUp: ended });
  if (!markWriteUpFetched(input.registryDir, input.session, { session: ended, part })) {
    return refused("io-failed", { writeUp: ended, detail: "The part could not be recorded as handed to this session." });
  }
  return {
    reason: "part",
    isError: false,
    body: {
      writeUp: true,
      reason: "part",
      session: input.session,
      ended,
      endedOn: calendarDate(st.held.clockFrom, counterpart.store.zone()),
      part,
      of: parts.length,
      next:
        `Hand back what is worth keeping from this part with session_end: session: ${input.session}, ` +
        `writeUp: ${ended}, part: ${String(part)}, memories: [...] — in your own words, as this session's. ` +
        `memories: [] if nothing in it is worth keeping. Anything marked ${WRITE_UP_KEPT_MARK} was written up before — by that session or an earlier write-up.` +
        (part < parts.length ? " The rest comes at later session starts here." : ""),
      // What was said to that session here, and what it jotted. Never its replies.
      text: parts[part - 1] as string,
    },
  };
}

// ── ANSWER ──────────────────────────────────────────────────────────────────

async function takeBack(
  input: WriteUpDoorInput,
  ended: string,
  st: Standing,
  mine: { part: number; answer?: WriteUpAnswer } | undefined,
  raw: unknown,
): Promise<WriteUpOutcome> {
  const { counterpart, args } = input;
  const p = st.progress;
  if (mine === undefined || p === undefined) {
    return refused("not-asked", { writeUp: ended, detail: "Fetch it first: the same call with no memories returns its words." });
  }
  const part = mine.part;
  // A number, or its digits: `"2"` is the part a model meant by `2`.
  const said = args["part"];
  const claimed = typeof said === "string" && /^\d+$/.test(said) ? Number(said) : said;
  if (claimed !== undefined && claimed !== part) {
    return refused("wrong-part", { writeUp: ended, part, detail: `This session was handed part ${String(part)}.` });
  }
  const final = part >= p.parts;

  // THE LAST PART CAME BACK AND ITS MARK DID NOT LAND: any session holding a
  // fetch of it finishes it, depositing nothing (MAJOR 2, m-B).
  if (p.answer !== undefined && p.waiting !== true) {
    return finish(input, ended, st, p.parts, p.answer, NO_DEPOSITS, true);
  }
  if (p.done >= part) return refused("part-already-written", { writeUp: ended, part, of: p.parts });

  if (!Array.isArray(raw)) return refused("memories-required", { writeUp: ended, part });
  // NOTHING WORTH KEEPING IS A REAL ANSWER HERE TOO (owner, 2026-09-23): the
  // part is closed without minting, and on the last part the session is marked.
  const said2: WriteUpAnswer = raw.length === 0 ? "nothing-new" : "memories";
  // WHOSE WORDS THE MEMORIES COVER (MAJOR 4, through core's `cover` seam):
  // never the writer's own. On the LAST part here, the ended session's words in
  // this project — every part has now been served, so all of them were read;
  // on an earlier part, none, or parts not yet served would read as kept.
  const deposits = raw.length === 0 ? NO_DEPOSITS : await input.deposit(raw, final ? { session: ended } : false);
  if (said2 === "memories" && deposits.deposited === 0 && deposits.duplicates === 0) {
    return {
      reason: "nothing-landed",
      isError: true,
      body: {
        stored: false,
        writeUp: true,
        reason: "nothing-landed",
        ended,
        part,
        entries: raw.length,
        deposited: 0,
        refused: raw.length,
        outcomes: deposits.outcomes,
      },
    };
  }
  const answered = markWriteUpFetched(input.registryDir, input.session, { session: ended, part, answer: said2 });
  if (!final) {
    const advanced = saveWriteUpProgress(counterpart.store, st.key, { ...p, done: part });
    return {
      reason: "part-written",
      isError: false,
      body: {
        writeUp: true,
        reason: "part-written",
        answer: said2,
        session: input.session,
        ended,
        part,
        of: p.parts,
        entries: raw.length,
        deposited: deposits.deposited,
        refused: raw.length - deposits.deposited,
        outcomes: deposits.outcomes,
        // `false`: what landed stands, and the store would not take the note
        // that this part is done, so a later start may hand it over again.
        recorded: advanced && answered,
      },
    };
  }
  return finish(input, ended, st, part, said2, deposits, false);
}

/**
 * THE LAST PART HERE CAME BACK.
 *
 * The ended session's words HERE are marked kept, so a later reader — a next
 * session if it resumes and owes again, the API sweep — sees them as already
 * written up. The last part's memories claimed them already, under their own
 * proposal (`cover: { session: ended }`); this claims whatever is left — all of
 * it when the answer was an empty batch — under `writeup:<writer>`. Then:
 *
 *   - if it still holds unwritten words in ANOTHER project, this project's
 *     share WAITS (`written-up-here`): B3 reads a write-up mark for the whole
 *     session, so marking now would start the other project's clock on words
 *     nobody there has read (MAJOR 6);
 *   - otherwise it is marked written up through the seam, here only,
 *     `by: "next-session"`, and B3's seven-day clock starts. A mark that did not
 *     land leaves the session owed; the next start here points at it again and
 *     the FETCH finishes it — whoever it is — without depositing twice.
 */
function finish(
  input: WriteUpDoorInput,
  ended: string,
  st: Standing,
  part: number,
  said: WriteUpAnswer,
  deposits: WriteUpDeposits,
  retry: boolean,
): WriteUpOutcome {
  const spans = input.counterpart.spans;
  try {
    spans.claimCoverage({ scope: st.here, session: ended, proposalId: `writeup:${input.session}` });
  } catch {
    /* a kept mark that did not land costs a later reader a duplicate, never words */
  }
  const elsewhere = st.held.scopes.filter(
    (scope) =>
      !sameScope(scope, st.here) &&
      writeUpEntries(spans, { session: ended, scopes: [scope] }).length > 0 &&
      !(() => {
        const q = st.all[progressKey(ended, scope)];
        return q !== undefined && q.done >= q.parts && q.waiting === true;
      })(),
  );
  const base = st.progress ?? { chunk: WRITE_UP_PART_BYTES, parts: part, done: 0, handedAt: input.now };
  const entries = deposits.outcomes.length;
  const common = {
    writeUp: true,
    answer: said,
    session: input.session,
    ended,
    part,
    of: base.parts,
    entries,
    deposited: deposits.deposited,
    refused: entries - deposits.deposited,
    outcomes: deposits.outcomes,
  };
  if (elsewhere.length > 0) {
    saveWriteUpProgress(input.counterpart.store, st.key, { ...base, done: part, answer: said, waiting: true });
    return {
      reason: "written-up-here",
      isError: false,
      body: {
        ...common,
        reason: "written-up-here",
        marked: false,
        // Words it left in other projects wait for a session there.
        elsewhere: elsewhere.length,
      },
    };
  }
  const reasons: WriteUpReason[] = [recordWriteUp(spans, { scope: st.here, session: ended, by: BY })];
  const marked = reasons.includes("RECORDED");
  if (marked) saveWriteUpProgress(input.counterpart.store, st.key, null, { allOf: ended });
  else saveWriteUpProgress(input.counterpart.store, st.key, { ...base, done: part, answer: said });
  return {
    reason: "written-up",
    isError: !marked,
    body: {
      ...common,
      reason: "written-up",
      // Whether the ended session is now marked written up. `false` is an IO
      // failure: what landed stands, the session still owes, and the next
      // start here points at it again so the fetch can finish it.
      marked,
      ...(marked ? {} : { markReasons: [...new Set(reasons)] }),
      ...(retry ? { detail: "The last part's answer landed on an earlier call; this one only recorded the write-up." } : {}),
    },
  };
}
