/**
 * Reading this host's transcript file — pure host trivia (CONTRACT §5 G9), and
 * the one place that knows what a Claude Code transcript line looks like.
 *
 * Two rules from the spec govern what comes out of here, and both are decided at
 * THIS line rather than downstream:
 *
 *   **§2 G10 — conversational text only.** Tool output, file contents and images
 *   never enter capture. That is a DECLARED blind spot, not an oversight, so a
 *   block this reader cannot classify as conversation is tagged with what it
 *   actually is (`tool`, `file`, `image`) and `remember/`'s `enters()` drops it.
 *   **§2 G11 — injected context is kept in capture and excluded from pacing.**
 *   Host-injected material is user-role but is not the user speaking, so it is
 *   tagged `injected` rather than discarded: `enters()` keeps it, `substanceOf`
 *   does not count it.
 *
 * And three more this host's shapes force:
 *
 *   **G8 — foreign injection never enters.** While v2 runs beside v1, v1's own
 *   hooks put text into this same transcript: a wake bundle, a recall block, a
 *   Stop-hook ask. It arrives user-role and reads like conversation, and if it
 *   entered capture v2 would encode v1's briefing as a memory of having thought
 *   it — a feedback loop between two memory systems, which is worse than either
 *   system's ordinary failure. So it is tagged `foreign` and `enters()` refuses
 *   it outright. The recognizers are ONE constant, `FOREIGN_MARKERS`, so the
 *   parallel-run preflight's transcript canary scans for exactly what the
 *   reader excludes rather than for its own copy of the list.
 *
 *   **PEER MESSAGES ARE KEPT, BUT NEVER AS THE OWNER'S WORDS.** This host
 *   delivers messages from the owner's OTHER Claude Code sessions into this
 *   transcript as user-role text wrapped in `<cross-session-message …>`
 *   (documented at code.claude.com/docs/en/cross-session-messaging; attributes
 *   read off the v2.1.260 bundle: `from`, `from-name`, `from-session`,
 *   `from-mode`, `hop-chain`). Measured 2026-09-04: capture read those as the
 *   owner speaking and the fallback sweep minted another instance's findings —
 *   "v2 challenge effect has no live consumer" — as things the owner said. The
 *   content IS real experience and is kept; the WRAPPER is replaced in place
 *   with a short structural label the interpreter can read, and a block that is
 *   nothing but a peer message is tagged `injected` so it never paces a ritual.
 *   The rewrite is in place, one block still one turn, because the per-session
 *   cursor indexes into this turn list: splitting a block into several turns
 *   would re-slice a live session's uncaptured tail.
 *
 *   **G11 — this system's own asks never enter.** The host returns a blocking
 *   Stop hook's stderr to the model as user-role `Stop hook feedback:` text, so
 *   v2's authorship and episode asks arrive back in its own transcript looking
 *   like something the owner said. Earlier this reader left that block
 *   `conversation`, reasoning that excluding the wrapper would "blind this
 *   reader to its own voice." That reasoning is SUPERSEDED: the ask's durable
 *   record is `adapter.authorship.ask`, not the transcript copy, and what the
 *   transcript copy actually buys is v2 encoding its own ritual wording as
 *   lived experience. It is tagged `ritual`, `enters()` refuses it, and the
 *   refusal lands in the boundary record's `excluded` count so the silence is
 *   visible. A `Stop hook feedback:` block carrying a v1 marker is still
 *   `foreign` — foreign is checked first, so the canary's agreement holds.
 *
 * Nothing here throws. A transcript we cannot read yields no turns, which costs
 * a boundary's capture; a transcript that throws would cost the session.
 */
import { existsSync, readFileSync } from "node:fs";

import type { Turn, TurnSource } from "../../core/remember/index.js";

/**
 * The marker the host wraps around context it injected itself.
 *
 * `cross-session-*` is the conservative catch-all: `<cross-session-message>` is
 * the ONE peer shape evidenced (docs + bundle), and it gets the attribution
 * rewrite below, but any other wrapper the host may add under that prefix is at
 * minimum host-delivered rather than owner-spoken, and `injected` is the honest
 * reading of a shape we have not measured — kept in capture, out of pacing.
 */
const INJECTED =
  /<(system-reminder|command-name|command-message|local-command-stdout|cross-session-[a-z-]+)\b/i;

/**
 * The host's blocking-Stop channel, which returns a hook's own stderr to the
 * model as user-role text. Anchored: a block that merely MENTIONS the phrase
 * mid-sentence is conversation about the mechanism, not the mechanism.
 */
const STOP_HOOK_FEEDBACK = /^Stop hook feedback:/;

/**
 * The peer-message wrapper this host uses for messages from the owner's other
 * Claude Code sessions. Non-greedy body, `[\s\S]` so a multi-line message is one
 * match, and the closing tag is required — a truncated wrapper is left alone and
 * classified like any other text rather than swallowing the rest of the block.
 */
const CROSS_SESSION_MESSAGE = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/gi;

/** The host's idle/exit notice, which is plain text rather than a wrapper
 *  (evidenced in the v2.1.260 bundle: `[Cross-session idle notice] "x" is idle
 *  now` / `… has exited`). Host bookkeeping about a peer, never the owner. */
const CROSS_SESSION_NOTICE = /^\[Cross-session idle notice\]/;

/** What a peer-attribution pass did to one block. */
export interface PeerAttribution {
  /** The block with every wrapper replaced by a labelled, unwrapped quotation. */
  readonly text: string;
  /** How many wrappers were rewritten. Zero means the text is untouched. */
  readonly peers: number;
  /** True when the block also carried text of the owner's own outside a wrapper. */
  readonly ownerText: boolean;
}

/** The attribute value, or undefined. Attributes are single- or double-quoted. */
function attr(attrs: string, name: string): string | undefined {
  const found = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
  const value = found?.[2] ?? found?.[3];
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Replace every peer wrapper with a structural label naming the speaker, IN
 * PLACE. The label is prose the interpreter reads, not a field, because a span
 * is text: several turns are joined into one span, so anything that must survive
 * to interpretation has to be in the words.
 *
 * The name preferred is the host's `from-name` (a session's display name, the
 * thing a human would recognize), then `from-session`, then the socket address
 * in `from` — and "unnamed" when the host gave none, since an unattributed peer
 * message must still not read as the owner.
 */
export function attributePeers(text: string): PeerAttribution {
  CROSS_SESSION_MESSAGE.lastIndex = 0;
  if (!CROSS_SESSION_MESSAGE.test(text)) {
    return { text, peers: 0, ownerText: text.trim().length > 0 };
  }
  let peers = 0;
  let cursor = 0;
  const outside: string[] = [];
  const parts: string[] = [];
  CROSS_SESSION_MESSAGE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CROSS_SESSION_MESSAGE.exec(text)) !== null) {
    peers += 1;
    const before = text.slice(cursor, match.index);
    outside.push(before);
    parts.push(before);
    const attrs = match[1] ?? "";
    const who =
      attr(attrs, "from-name") ?? attr(attrs, "from-session") ?? attr(attrs, "from") ?? "unnamed";
    parts.push(`[message from another Claude session, ${who}]: ${(match[2] ?? "").trim()}`);
    cursor = match.index + match[0].length;
  }
  const tail = text.slice(cursor);
  outside.push(tail);
  parts.push(tail);
  return { text: parts.join("").trim(), peers, ownerText: outside.join("").trim().length > 0 };
}

/**
 * Every shape v1 (bansai) puts into this host's transcript. ONE list, exported,
 * because the preflight canary and this reader must not be able to disagree
 * about what foreign material looks like.
 *
 * The first entry is the host's blocking-Stop-hook wrapper, which arrives as
 * `Stop hook feedback:` followed by the hook's own line (the host may bullet
 * it). A `Stop hook feedback:` block that does NOT carry a foreign marker is
 * v2's OWN ask coming home through the same channel, and is `ritual` — refused
 * for its own reason rather than being counted against v1. The two must stay
 * distinct: `FOREIGN_MARKERS` is what the preflight canary scans for, and a list
 * that swallowed v2's own asks would report v1 injection that never happened.
 */
export const FOREIGN_MARKERS: readonly RegExp[] = [
  /^Stop hook feedback:\s*(?:[-*]\s*)?\[bansai\]/,
  /^\[bansai\] /,
  /<bansai-memory>/,
  /^The following is your standing self-model \(bansai\)/,
  /^bansai: your persistent memory is initializing/,
];

/**
 * The whole classification rule for one text block, as one pure function.
 *
 * The ORDER is the rule. Foreign first: a v1 wake bundle wrapped in a host
 * reminder is foreign, not injected, and v1's `Stop hook feedback: [bansai] …`
 * is foreign rather than ritual — which is what keeps the preflight canary and
 * this reader agreeing about `FOREIGN_MARKERS`. Ritual second: what is left in
 * that wrapper is v2's own ask coming home. Injected third, conversation last.
 */
export function classifyBlock(text: string): TurnSource {
  const probe = text.trimStart();
  for (const marker of FOREIGN_MARKERS) {
    if (marker.test(probe)) return "foreign";
  }
  if (STOP_HOOK_FEEDBACK.test(probe)) return "ritual";
  if (CROSS_SESSION_NOTICE.test(probe)) return "injected";
  return INJECTED.test(text) ? "injected" : "conversation";
}

export interface TranscriptRead {
  readonly turns: Turn[];
  readonly ok: boolean;
  readonly reason: "read" | "absent" | "unreadable";
  /** Lines that were not JSON. Counted, never silently swallowed (scar §2.4). */
  readonly corrupt: number;
}

export function readTranscript(path: string | undefined): TranscriptRead {
  if (path === undefined || path.trim().length === 0) {
    return { turns: [], ok: false, reason: "absent", corrupt: 0 };
  }
  if (!existsSync(path)) return { turns: [], ok: false, reason: "absent", corrupt: 0 };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { turns: [], ok: false, reason: "unreadable", corrupt: 0 };
  }
  return parseTranscript(raw);
}

/** Exported so the parse is testable without a file (and it is the whole rule). */
export function parseTranscript(raw: string): TranscriptRead {
  const turns: Turn[] = [];
  let corrupt = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      corrupt += 1;
      continue;
    }
    const message = entry["message"] as Record<string, unknown> | undefined;
    const role = (message?.["role"] ?? entry["role"]) as unknown;
    if (role !== "user" && role !== "assistant") continue;
    const content = message?.["content"] ?? entry["content"];
    for (const piece of blocksOf(content, role)) {
      if (piece.text.trim().length === 0) continue;
      turns.push({ role, text: piece.text, source: piece.source });
    }
  }
  return { turns, ok: true, reason: "read", corrupt };
}

type Piece = { text: string; source: TurnSource };

/**
 * One text block, classified and — where it carries peer messages — attributed.
 *
 * Peer rewriting applies to user-role text only, because that is the only role
 * the host delivers a peer message in, and it never overrides `foreign` or
 * `ritual`: those two are refusals, and a refused block is not made keepable by
 * containing a quotation. A block that is ONLY a peer message becomes
 * `injected` — kept in capture (it is real experience), out of pacing (nobody
 * in this session spoke). A MIXED block stays `conversation`: the owner did
 * speak in that turn, and the label separates the two voices inside it.
 */
function pieceOf(text: string, role: "user" | "assistant"): Piece {
  const source = classifyBlock(text);
  if (role !== "user" || source === "foreign" || source === "ritual") return { text, source };
  const attributed = attributePeers(text);
  if (attributed.peers === 0) return { text, source };
  return { text: attributed.text, source: attributed.ownerText ? "conversation" : "injected" };
}

/** One transcript entry's content, flattened into typed pieces. */
function blocksOf(content: unknown, role: "user" | "assistant"): Piece[] {
  if (typeof content === "string") {
    return [pieceOf(content, role)];
  }
  if (!Array.isArray(content)) return [];
  const out: Piece[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const type = b["type"];
    if (type === "text" && typeof b["text"] === "string") {
      out.push(pieceOf(b["text"], role));
      continue;
    }
    // Everything below is the DECLARED blind spot, tagged rather than dropped
    // here so the drop happens at `remember/`'s one rule (`enters`).
    if (type === "tool_result" || type === "tool_use") {
      out.push({ text: "", source: "tool" });
    } else if (type === "image") {
      out.push({ text: "", source: "image" });
    } else if (type === "document") {
      out.push({ text: "", source: "file" });
    }
  }
  return out;
}
