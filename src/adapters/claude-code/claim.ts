/**
 * ONE DELIVERY PER EVENT, HOWEVER MANY WIRINGS FIRE IT (2026-10-09).
 *
 * Claude Code runs every hook registered for an event — from settings and from
 * plugins alike — at the same moment, each handed the same input. When two
 * wirings of Counterparts are live (the npm install's hooks in settings and
 * the plugin's, or two settings files naming two builds), every event runs our
 * hook twice: two wakes at session start, two recall blocks per prompt, two
 * Stop asks, two boundaries, two background workers rewriting the wake bundle
 * at each other. The plugin is meant to stand down when it sees the npm wiring
 * (`adapters/plugin.ts#hookGate`), and on 2026-10-09 a plugin from an older
 * build did not recognise the newer `connect`'s hook line and didn't. That
 * reading is tolerant now (`host-wiring.ts#readOurHook`), and this is the
 * backstop for the next way it fails: the FIRST hook process to claim the
 * event does the event's whole job, and its twin exits with no output.
 *
 * THE CLAIM is one row of the store's `meta` table, changed in one `BEGIN
 * IMMEDIATE` transaction (`Store#updateMeta`): the second process waits on the
 * busy timeout and then reads what the first wrote. No schema change. The row
 * holds only the claims of the last `CLAIM_WINDOW_MS` (at most `CLAIM_KEEP` of
 * them), so it never grows. Both of its writes wait `CLAIM_WAIT_MS` on another
 * writer, not the store's five seconds (review of #355): on a store somebody
 * holds, the claim gives up and the hook delivers, instead of adding five
 * seconds to a turn the rest of the hook already waits on.
 *
 * WHAT MAKES TWO PROCESSES TWINS — the same KEY, and running AT THE SAME TIME.
 *
 *   - THE KEY is what Claude Code hands every hook of one event identically: the
 *     session id, the event, and `prompt_id` (2.1.296: "UUID correlating a user
 *     prompt with all subsequent events until the next prompt"), with the prompt
 *     text (UserPromptSubmit), `source` (SessionStart), `stop_hook_active` and
 *     the last assistant message (Stop), `reason` (SessionEnd) and `trigger`
 *     (PreCompact) folded in. Text is hashed; the key is a hash, and nothing of
 *     the prompt is stored. The transcript's size is NOT in it: the host may
 *     write between the twins starting, and a key that differs between twins is
 *     no claim at all.
 *   - AT THE SAME TIME: the host starts the twins together, so each began before
 *     the other could have finished. The winner records when its process started
 *     and, as it exits, when it finished; a process with the same key that
 *     STARTED BEFORE THE HOLDER FINISHED (or while it is still running) is its
 *     twin. A process that started after the holder finished is a separate event
 *     that happens to look the same — a host with no `prompt_id` sending the same
 *     words twice, a session resumed twice in a row — and it delivers. So the
 *     time a hook takes, the store's busy timeout or a slow start-up cannot turn
 *     a twin into a second delivery, and no repeat is ever swallowed by a clock.
 *   - A holder that never says it finished (killed, crashed) holds for
 *     `CLAIM_WINDOW_MS` and no longer.
 *
 * FAIL-OPEN, ALWAYS. No session id, an observer, a store that will not take
 * the write: this process delivers. Two deliveries are a nuisance; none is a
 * session that woke up with no memory. A single wiring therefore behaves
 * exactly as before, at the cost of two small writes per event.
 */
import { createHash } from "node:crypto";

import { HOOK_CLAIM_LOST_EVENT } from "../../core/counterpart.js";
import type { HookName } from "./hooks.js";

/** The `meta` row holding the recent claims. */
export const CLAIMS_META_KEY = "adapter.hook.claims";
/** How long a claim is kept, and the longest an unfinished one holds. */
export const CLAIM_WINDOW_MS = 15_000;
/** The most claims the row keeps, newest first — a bound on its size if a
 *  clock jumps or a burst of sessions fires at once. */
export const CLAIM_KEEP = 64;
/** How long each of the claim's two writes waits on another writer's lock
 *  before it gives up (and the hook delivers). A twin outwaits its holder's
 *  claim — well under a millisecond — many times over; a store held for
 *  longer costs the turn this much, not `BUSY_TIMEOUT_MS` (review of #355:
 *  a held lock took a prompt from 11 s on master to 16 s). */
export const CLAIM_WAIT_MS = 500;

/** Which side of the doubled wiring a hook process is, for the record. */
export type ClaimSide = "plugin" | "settings";

/** The outcome: `won` delivers, `lost` exits quietly, `unclaimed` delivers
 *  because no claim could be made (no session, an observer, a failed write). */
export type ClaimOutcome = "won" | "lost" | "unclaimed";

function text(payload: Record<string, unknown>, field: string): string {
  const v = payload[field];
  return typeof v === "string" ? v : "";
}

function digest(value: string): string {
  return value.length === 0 ? "" : createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * The claim key for this event, from the input Claude Code gave the hook; null
 * when there is no session id to claim under. Pure.
 */
export function deliveryClaimKey(name: HookName, payload: Record<string, unknown>): string | null {
  const session = text(payload, "session_id");
  if (session.length === 0) return null;
  const parts = [
    session,
    name,
    text(payload, "prompt_id"),
    text(payload, "agent_id"),
    text(payload, "source"),
    payload["stop_hook_active"] === true ? "re-fired" : "",
    digest(text(payload, "prompt")),
    digest(text(payload, "last_assistant_message")),
    text(payload, "reason"),
    text(payload, "trigger"),
    digest(text(payload, "custom_instructions")),
  ];
  return digest(JSON.stringify(parts));
}

/** One held claim: when it was made, by which side, when its process started,
 *  and when it finished (absent while it runs). */
interface Held {
  readonly at: number;
  readonly side: string;
  readonly started: number;
  readonly ended?: number;
}

function readClaims(raw: string | undefined): Record<string, Held> {
  if (raw === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, Held> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v) || typeof v[0] !== "number" || !Number.isFinite(v[0])) continue;
      const at = v[0];
      const started = typeof v[2] === "number" && Number.isFinite(v[2]) ? v[2] : at;
      const ended = typeof v[3] === "number" && Number.isFinite(v[3]) ? v[3] : undefined;
      out[k] = { at, side: typeof v[1] === "string" ? v[1] : "", started, ...(ended === undefined ? {} : { ended }) };
    }
    return out;
  } catch {
    return {};
  }
}

function writeClaims(claims: Record<string, Held>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(claims).map(([k, h]) => [k, h.ended === undefined ? [h.at, h.side, h.started] : [h.at, h.side, h.started, h.ended]]),
    ),
  );
}

/** What a claim needs of the counterpart: the store's one-row transaction, and
 *  the durable event log. Structural, so a test can hand it a store that throws. */
export interface ClaimDoors {
  readonly store: {
    updateMeta(
      key: string,
      fn: (current: string | undefined) => string | null | undefined,
      opts?: { readonly waitMs?: number },
    ): unknown;
  };
  noteAdapterEvent(name: typeof HOOK_CLAIM_LOST_EVENT, data: Record<string, unknown>): boolean;
}

export interface ClaimInput {
  readonly hook: HookName;
  readonly key: string | null;
  readonly sessionId: string;
  readonly side: ClaimSide;
  /** Under observer nothing is written, so nothing is claimed. */
  readonly observer: boolean;
  /** When this process started (epoch ms); `performance.timeOrigin` by default. */
  readonly started?: number;
  readonly now?: number;
}

export interface Claim {
  readonly outcome: ClaimOutcome;
  /** The winner's claim time, which `finishClaim` names. */
  readonly at?: number;
  /** The side that holds the claim, when this process lost it. */
  readonly heldBy?: string;
  /** Why nothing was claimed, for stderr. */
  readonly detail?: string;
}

/**
 * Claim this event for this process, or learn that its twin already has. A
 * loss is recorded (`adapter.hook.claim.lost`, prunable telemetry). Never
 * throws.
 */
export function claimDelivery(doors: ClaimDoors, input: ClaimInput): Claim {
  if (input.key === null) return { outcome: "unclaimed", detail: "no session id" };
  if (input.observer) return { outcome: "unclaimed", detail: "observer" };
  const key = input.key;
  const now = input.now ?? Date.now();
  const started = input.started ?? performance.timeOrigin;
  const fresh = (h: Held): boolean => Math.abs(now - Math.max(h.at, h.ended ?? h.at)) < CLAIM_WINDOW_MS;
  // Written inside the transaction's callback, read after it.
  const seen: { heldBy: string | null } = { heldBy: null };
  try {
    doors.store.updateMeta(CLAIMS_META_KEY, (current) => {
      const claims = readClaims(current);
      const held = claims[key];
      // A TWIN: the same event, and this process began before the holder ended.
      if (held !== undefined && fresh(held) && (held.ended === undefined || started < held.ended)) {
        seen.heldBy = held.side;
        return undefined;
      }
      const kept = Object.entries(claims)
        .filter(([k, h]) => k !== key && fresh(h))
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, CLAIM_KEEP - 1);
      return writeClaims(Object.fromEntries([[key, { at: now, side: input.side, started }], ...kept]));
    }, { waitMs: CLAIM_WAIT_MS });
  } catch (err) {
    return { outcome: "unclaimed", detail: err instanceof Error ? err.message : String(err) };
  }
  const winner = seen.heldBy;
  if (winner === null) return { outcome: "won", at: now };
  try {
    doors.noteAdapterEvent(HOOK_CLAIM_LOST_EVENT, {
      hook: input.hook,
      session: input.sessionId,
      lost: input.side,
      won: winner.length === 0 ? null : winner,
    });
  } catch {
    // The row is the record, not the decision: the twin still stands down.
  }
  return { outcome: "lost", heldBy: winner };
}

/**
 * THE WINNER IS DONE: stamp its claim with the time it finished, so a later
 * process with the same key — one that started after this — is read as the
 * separate event it is. Only this process's own claim (same key, same `at`) is
 * touched. Never throws: a stamp that does not land leaves the claim to expire.
 */
export function finishClaim(doors: Pick<ClaimDoors, "store">, key: string, at: number, now: number = Date.now()): boolean {
  let stamped = false;
  try {
    doors.store.updateMeta(CLAIMS_META_KEY, (current) => {
      const claims = readClaims(current);
      const held = claims[key];
      if (held === undefined || held.at !== at) return undefined;
      claims[key] = { ...held, ended: now };
      stamped = true;
      return writeClaims(claims);
    }, { waitMs: CLAIM_WAIT_MS });
  } catch {
    return false;
  }
  return stamped;
}
