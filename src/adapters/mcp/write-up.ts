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
 *   - **FETCH** — `writeUp` and NO `memories`: the next unwritten part of that
 *     session's captured words, up to `WRITE_UP_PART_BYTES` (~24 KB), and the
 *     part is recorded as handed to THIS session (`writeUpFor` on its record).
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
 *     session's record.
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
 *     or an answer from a session that fetched nothing of it;
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
import {
  WRITE_UP_KEPT_MARK,
  WRITE_UP_PART_BYTES,
  isSessionId,
  markWriteUpFetched,
  readSession,
  readWriteUpProgress,
  saveWriteUpProgress,
  writeUpEntries,
  writeUpParts,
  writeUpPlan,
  writeUpStanding,
} from "../sessions.js";
import type { WriteUpAnswer, WriteUpProgress } from "../sessions.js";
import { calendarDate } from "../../core/self/index.js";

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
  /** `session_end`'s own per-entry loop, under the WRITING session's name. */
  readonly deposit: (raw: readonly unknown[]) => Promise<WriteUpDeposits>;
}

export interface WriteUpOutcome {
  /** A refusal's name, or what the call did. */
  readonly reason: WriteUpRefusal | "part" | "part-written" | "written-up";
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
    firstAsk: { turns: t.FIRST_ASK_TURNS, bytes: t.FIRST_ASK_BYTES, soloBytes: t.SOLO_ASK_BYTES },
  });
  const standing = writeUpStanding(plan, input.registryDir, ended, input.scope, input.now);
  if (standing.status === "owes-nothing") return refused("owes-nothing", { writeUp: ended, why: standing.why });
  if (standing.status !== "owed") return refused(standing.status, { writeUp: ended });
  const held = standing.held;
  const record = readSession(input.registryDir, input.session);
  const progress = readWriteUpProgress(counterpart.store)[ended];

  // ── FETCH ────────────────────────────────────────────────────────────────
  if (args["memories"] === undefined) {
    // POINTED AT THIS SESSION, by the hook — evidence the model cannot write.
    // Without it, any live session could read any owed session's words.
    if (record?.writeUpPointer !== ended) return refused("not-asked", { writeUp: ended });
    const mine = record.writeUpFor?.session === ended ? record.writeUpFor : undefined;
    if (mine?.answer !== undefined) {
      return refused("part-already-written", {
        writeUp: ended,
        part: mine.part,
        detail: "This session has written up its part. The next part is handed over at a later session start here.",
      });
    }
    const chunk = progress?.chunk ?? WRITE_UP_PART_BYTES;
    const parts = writeUpParts(writeUpEntries(counterpart.spans, held), chunk);
    if (parts.length === 0) return refused("owes-nothing", { writeUp: ended, why: "no-text" });
    // The same part again when this session fetched and has not answered;
    // otherwise the next one not yet written.
    const part = mine?.part ?? Math.min((progress?.done ?? 0) + 1, parts.length);
    const next: WriteUpProgress = {
      chunk,
      parts: parts.length,
      done: Math.min(progress?.done ?? 0, parts.length),
      handedAt: input.now,
    };
    if (!saveWriteUpProgress(counterpart.store, ended, next)) return refused("io-failed", { writeUp: ended });
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
        endedOn: calendarDate(held.clockFrom),
        part,
        of: parts.length,
        next:
          `Hand back what is worth keeping from this part with session_end: session: ${input.session}, ` +
          `writeUp: ${ended}, part: ${String(part)}, memories: [...] — in your own words, as this session's. ` +
          `memories: [] if nothing in it is worth keeping. Anything marked ${WRITE_UP_KEPT_MARK} it handed back itself.` +
          (part < parts.length ? " The rest comes at later session starts here." : ""),
        // What was said to that session, and what it jotted. Never its replies.
        text: parts[part - 1] as string,
      },
    };
  }

  // ── ANSWER ───────────────────────────────────────────────────────────────
  const mine = record?.writeUpFor?.session === ended ? record.writeUpFor : undefined;
  if (mine === undefined || progress === undefined) {
    return refused("not-asked", { writeUp: ended, detail: "Fetch it first: the same call with no memories returns its words." });
  }
  const part = mine.part;
  // A number, or its digits: `"2"` is the part a model meant by `2`.
  const said = args["part"];
  const claimed = typeof said === "string" && /^\d+$/.test(said) ? Number(said) : said;
  if (claimed !== undefined && claimed !== part) {
    return refused("wrong-part", { writeUp: ended, part, detail: `This session was handed part ${String(part)}.` });
  }
  const final = part >= progress.parts;

  // THE ONE RETRY THAT WRITES NO MEMORIES: every part came back, and the mark
  // did not land last time (an IO failure). This session's answer already
  // landed; depositing it twice is what the progress record exists to prevent.
  if (progress.done >= part) {
    if (!final || mine.answer === undefined) {
      return refused("part-already-written", { writeUp: ended, part, of: progress.parts });
    }
    return finish(input, held.scopes, ended, part, progress, mine.answer, { outcomes: [], deposited: 0, duplicates: 0 }, true);
  }

  const raw = args["memories"];
  if (!Array.isArray(raw)) return refused("memories-required", { writeUp: ended, part });
  // NOTHING WORTH KEEPING IS A REAL ANSWER HERE TOO (owner, 2026-09-23): the
  // part is closed without minting, and on the last part the session is marked.
  const answer: WriteUpAnswer = raw.length === 0 ? "nothing-new" : "memories";
  const deposits = raw.length === 0 ? { outcomes: [], deposited: 0, duplicates: 0 } : await input.deposit(raw);
  if (answer === "memories" && deposits.deposited === 0 && deposits.duplicates === 0) {
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
  const answered = markWriteUpFetched(input.registryDir, input.session, { session: ended, part, answer });
  if (!final) {
    const advanced = saveWriteUpProgress(counterpart.store, ended, { ...progress, done: part });
    return {
      reason: "part-written",
      isError: false,
      body: {
        writeUp: true,
        reason: "part-written",
        answer,
        session: input.session,
        ended,
        part,
        of: progress.parts,
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
  return finish(input, held.scopes, ended, part, progress, answer, deposits, false);
}

/**
 * THE LAST PART CAME BACK: mark the ended session written up, in every scope
 * that holds its words, through the seam — `by: "next-session"`, so B3's
 * seven-day clock starts. A mark that did not land leaves the session owed; the
 * next start here points at it again, the fetch hands the last part over, and
 * the answer retries the mark without depositing twice.
 */
function finish(
  input: WriteUpDoorInput,
  scopes: readonly string[],
  ended: string,
  part: number,
  progress: WriteUpProgress,
  answer: WriteUpAnswer,
  deposits: WriteUpDeposits,
  retry: boolean,
): WriteUpOutcome {
  const reasons: WriteUpReason[] = [];
  for (const scope of scopes) {
    reasons.push(recordWriteUp(input.counterpart.spans, { scope, session: ended, by: BY }));
  }
  const marked = reasons.includes("RECORDED");
  if (marked) saveWriteUpProgress(input.counterpart.store, ended, null);
  else saveWriteUpProgress(input.counterpart.store, ended, { ...progress, done: part });
  const entries = deposits.outcomes.length;
  return {
    reason: "written-up",
    isError: !marked,
    body: {
      writeUp: true,
      reason: "written-up",
      // `memories`, or `nothing-new`: why the session is marked written up,
      // also on the writing session's registry record (`writeUpFor.answer`).
      answer,
      session: input.session,
      ended,
      part,
      of: progress.parts,
      entries,
      deposited: deposits.deposited,
      refused: entries - deposits.deposited,
      outcomes: deposits.outcomes,
      // Whether the ended session is now marked written up. `false` is an IO
      // failure: what landed stands, the session still owes, and the next
      // start here points at it again so this can finish.
      marked,
      ...(marked ? {} : { markReasons: [...new Set(reasons)] }),
      ...(retry ? { detail: "This part's answer landed on an earlier call; this one only recorded the write-up." } : {}),
    },
  };
}
