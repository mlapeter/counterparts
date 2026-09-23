/**
 * THE WRITE-UP DOOR — how a live session writes up a session that ended before
 * it was written up (roadmap C2, owner 2026-09-23).
 *
 * The SessionStart hook (`claude-code/hooks.ts#deliverWriteUpAsk`) hands the
 * next session in a project one part of an ended session's captured words.
 * This is where the memories come back: a `writeUp` FIELD on `session_end`,
 * naming the ended session, beside the ordinary `session` (the live one, bound
 * exactly as every `session_end` is) and `memories`.
 *
 * **A field, not a sibling tool,** and the field can be made safe: the call is
 * diverted HERE before `session_end` reads anything else, so a write-up never
 * reaches the nothing-new mark, never writes a handoff, and shares only two
 * things with an ordinary `session_end` — the bind (the WRITING session is the
 * live one, checked by `requireBoundSession` before this runs) and the road
 * each entry takes (the same per-entry deposit loop, gate battery and all). A
 * sibling tool would have cost every person who allowlisted the server's tools
 * one by one a new approval, and the test suite pins the tool list exactly.
 *
 * **It is the ONE importer of the write-up mark** outside `remember/`
 * (`test/cli.test.ts` pins it), because the mark is a deletion on a seven-day
 * fuse: once a session is marked written up, B3's retention deletes its words
 * a week later. So everything below exists to make sure the mark is only ever
 * set on a session that owed it, by a session that was handed its words.
 *
 * **What it refuses, each by name** (and what a refusal leaves: nothing — no
 * memory, no progress, no mark):
 *
 *   - `handoff-not-accepted` — a `handoff` beside `writeUp`: the pointer is
 *     THIS directory's, written by the live session for itself, never on
 *     behalf of another;
 *   - `unknown-session` — not an id, or an id the hooks never recorded and the
 *     buffer holds no words for;
 *   - `live-session` — the live session's own id, or one the registry holds
 *     running (no end, and a boundary inside the bind's own window);
 *   - `other-project` — ended in another directory;
 *   - `already-written-up` — so a second write-up of the same id is refused;
 *   - `owes-nothing` — B3's predicate says it owes nothing: below the pacer's
 *     threshold, answered and ended normally, or no words left;
 *   - `not-asked` — this session was not handed that session's words (the
 *     registry mark only the SessionStart hook writes, `writeUpFor`);
 *   - `wrong-part` — a `part` other than the one this session was handed;
 *   - `part-already-written` — that part already came back;
 *   - `memories-required` / `empty-batch` — an EMPTY BATCH IS NOT A WRITE-UP.
 *     `memories: []` answers "nothing new" on an ordinary `session_end`; here
 *     it would mark a session written up from nothing, which is exactly the
 *     deletion this door exists to guard;
 *   - `nothing-landed` — every entry was refused by the gate battery.
 *
 * The first four are `writeUpStanding` (`adapters/sessions.ts`), the SAME
 * function the hook's ask filters with, so the ask never offers what the door
 * would refuse.
 */
import type { Counterpart } from "../../core/counterpart.js";
// THE MARK, by path and from this file alone — `remember/index.ts` does not
// re-export it (PR #189 re-review, R1), and `test/cli.test.ts` pins this path.
import { WRITE_UP_BY, recordWriteUp } from "../../core/remember/write-up-seam.js";
import type { WriteUpReason } from "../../core/remember/write-up-seam.js";
import {
  isSessionId,
  readSession,
  readWriteUpProgress,
  saveWriteUpProgress,
  writeUpPlan,
  writeUpStanding,
} from "../sessions.js";
import type { WriteUpProgress } from "../sessions.js";

/** Every way the door answers. The refusals first. */
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
  "empty-batch",
  "nothing-landed",
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
  readonly reason: WriteUpRefusal | "part-written" | "written-up";
  readonly isError: boolean;
  /** The tool result's body. Ids, counts and reasons — never the words. */
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

  // HANDED THIS SESSION, by the hook — the one piece of evidence the model
  // cannot write. Without it, any live session could close any owed session
  // in its project from words it never read.
  const handed = readSession(input.registryDir, input.session)?.writeUpFor;
  if (handed === undefined || handed.session !== ended) return refused("not-asked", { writeUp: ended });
  const part = handed.part;
  // A number, or its digits: `"2"` is the part a model meant by `2`.
  const said = args["part"];
  const claimed = typeof said === "string" && /^\d+$/.test(said) ? Number(said) : said;
  if (claimed !== undefined && claimed !== part) {
    return refused("wrong-part", { writeUp: ended, part, detail: `This session was handed part ${String(part)}.` });
  }
  const progress = readWriteUpProgress(counterpart.store)[ended];
  if (progress === undefined) return refused("not-asked", { writeUp: ended, detail: "no record of the parts handed out" });
  const final = part >= progress.parts;

  // THE ONE RETRY THAT WRITES NO MEMORIES: every part came back, and the mark
  // did not land last time (an IO failure). The hook hands the last part over
  // again so this can finish; its memories already landed, and depositing them
  // twice would be the duplication the progress record exists to prevent.
  if (progress.done >= part) {
    if (!final) return refused("part-already-written", { writeUp: ended, part, of: progress.parts });
    return finish(input, held.scopes, ended, part, progress, { outcomes: [], deposited: 0, duplicates: 0 }, true);
  }

  const raw = args["memories"];
  if (!Array.isArray(raw)) return refused("memories-required", { writeUp: ended, part });
  if (raw.length === 0) {
    return refused("empty-batch", {
      writeUp: ended,
      part,
      detail: "An empty batch is not a write-up: nothing was marked, and that session still owes one.",
    });
  }
  const deposits = await input.deposit(raw);
  if (deposits.deposited === 0 && deposits.duplicates === 0) {
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
  if (!final) {
    const advanced = saveWriteUpProgress(counterpart.store, ended, { ...progress, done: part });
    return {
      reason: "part-written",
      isError: false,
      body: {
        writeUp: true,
        reason: "part-written",
        session: input.session,
        ended,
        part,
        of: progress.parts,
        entries: raw.length,
        deposited: deposits.deposited,
        refused: raw.length - deposits.deposited,
        outcomes: deposits.outcomes,
        // `false`: the memories landed and the store would not take the note
        // that this part is done, so a later start may hand it over again.
        recorded: advanced,
      },
    };
  }
  return finish(input, held.scopes, ended, part, progress, deposits, false);
}

/**
 * THE LAST PART CAME BACK: mark the ended session written up, in every scope
 * that holds its words, through the seam — `by: "next-session"`, so B3's
 * seven-day clock starts. A mark that did not land leaves the session owed; the
 * next start in the project hands the last part over again and this retries.
 */
function finish(
  input: WriteUpDoorInput,
  scopes: readonly string[],
  ended: string,
  part: number,
  progress: WriteUpProgress,
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
      session: input.session,
      ended,
      part,
      of: progress.parts,
      entries,
      deposited: deposits.deposited,
      refused: entries - deposits.deposited,
      outcomes: deposits.outcomes,
      // Whether the ended session is now marked written up. `false` is an IO
      // failure: the memories stand, the session still owes, and the next
      // session start here hands the last part over again to finish it.
      marked,
      ...(marked ? {} : { markReasons: [...new Set(reasons)] }),
      ...(retry ? { detail: "The memories for this part landed on an earlier call; this one only recorded the write-up." } : {}),
    },
  };
}
