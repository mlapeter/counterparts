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
 *   **CONTRACT §5 G11 — this system's own asks never enter.** (Not the
 *   behavioral spec's §2 G11 three paragraphs up: that one is about injected
 *   context, this one is about our own voice.) The host returns a blocking
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
 *   **B1 — on the user side, pacing counts what the PERSON typed, decided from
 *   the entry's own metadata first** (2026-09-23; the assistant's replies pace
 *   as they always did). A subagent's hand-back and a task notification arrive
 *   user-role and read like conversation; both paced the Stop ask as if the
 *   owner had spoken. The host marks who wrote a line —
 *   `origin.kind`, `isMeta`, `isCompactSummary` — so `entryAuthor` reads that,
 *   and the text markers above only decide for an entry that carries none. The
 *   refusals (`foreign`, `ritual`) still come first, whatever the metadata says.
 *
 * Nothing here throws. A transcript we cannot read yields no turns, which costs
 * a boundary's capture; a transcript that throws would cost the session.
 *
 * The file also holds the WAKE-ARRIVAL READER (bottom of this file), which reads
 * the same transcript for a different question and keeps its own, bounded, pass:
 * capture wants conversation and skips attachments, delivery wants exactly the
 * attachment and skips conversation.
 */
import {
  closeSync,
  constants as FS,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";

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
 * HOST FRAMES, for a USER-ROLE entry that carries no metadata to say who wrote
 * it (2026-09-23, B1). Every one is ANCHORED at the start of the block, like
 * `STOP_HOOK_FEEDBACK`: a line that merely mentions `<agent-message>` or a
 * hook mid-sentence is somebody talking about the mechanism, and a person's
 * words are the thing this reader may least afford to misfile (review m1). They
 * are never applied to the assistant's text (review m2) — `classifyBlock`, the
 * rule both roles share, is master's and unchanged. Every one is host-written:
 *
 *   - `<task-notification>`, `<agent-message …>`, `<bash-stdout>`,
 *     `<bash-stderr>`, `<local-command-caveat>` — wrappers the host puts at the
 *     very start of the line;
 *   - `Another Claude session sent a message:` — how 2.1.28x delivers a
 *     subagent's hand-back (the `<agent-message …>` wrapper follows it);
 *   - `[Subagent hand-back]` — the same hand-back's own opening line;
 *   - `[Request interrupted by user…]` — the host's marker for an interrupt;
 *   - `<Event> hook success:` / `… hook additional context:` / `… hook system
 *     message:` — how the host RENDERS hook output to the model. In the file
 *     these are `attachment` entries, which carry no role and never reach this
 *     reader; the anchor is here in case a build ever writes one as user text.
 *     `hook error` is deliberately NOT here: it is what a person types when
 *     their own hook breaks.
 *
 * `Stop hook feedback:` is not in this list on purpose: `classifyBlock` checks
 * it earlier, as `ritual`, because what it carries is this adapter's own ask.
 */
const HOST_FRAMES: readonly RegExp[] = [
  /^<(?:task-notification|agent-message|bash-stdout|bash-stderr|local-command-caveat)\b/i,
  /^Another Claude session sent a message:/,
  /^\[Subagent hand-back\]/,
  /^\[Request interrupted by user/,
  /^[A-Z][A-Za-z]+ hook (?:success|additional context|system message):/,
];

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
 * thing a human would recognize), then `from-session` — and "unnamed" when the
 * host gave neither, since an unattributed peer message must still not read as
 * the owner. The `from` attribute is DELIBERATELY NOT a fallback: it is a local
 * socket path (`uds:/tmp/cc-socks/30478.sock`), and a machine-local path has no
 * business in memory prose that outlives the socket by years.
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
    const who = attr(attrs, "from-name") ?? attr(attrs, "from-session") ?? "unnamed";
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

/** True when a user-role block with no metadata opens with a host frame. */
function hostFramed(text: string): boolean {
  const probe = text.trimStart();
  return HOST_FRAMES.some((frame) => frame.test(probe));
}

/**
 * WHO WROTE A LINE, AS THE TRANSCRIPT ENTRY ITSELF SAYS (2026-09-23, B1).
 *
 * Measured on Claude Code 2.1.28x, across every transcript on the owner's
 * machine (shapes only; `NOTES.md` §"What the host writes user-role"):
 *
 *   - **typed by the person** — `origin: { kind: "human" }`, with `promptSource`
 *     `typed`, `queued`, `suggestion_accepted` (and `sdk` with no origin for a
 *     headless prompt, which is also the person). Pasted text is part of the
 *     typed entry and IS the person;
 *   - **a subagent's hand-back** — `isMeta: true`, `origin: { kind: "peer" }`,
 *     text `Another Claude session sent a message:\n<agent-message …>`;
 *   - **a task notification** — `origin: { kind: "task-notification" }` and NO
 *     `isMeta`, so only the origin catches it;
 *   - **hook feedback, `/context` output, image captions, skill bodies, the
 *     local-command caveat, the idle notice** — `isMeta: true`;
 *   - **the compaction summary** — `isCompactSummary: true`;
 *   - **an API error the host wrote as the assistant** — `isApiErrorMessage`,
 *     `model: "<synthetic>"`.
 *
 * `human` and `host` are the two answers metadata can give; `unknown` is an
 * entry that carries none of it (an older build, a slash-command echo, a
 * `!`-command's output), and there the text markers decide, as they always did.
 */
export type EntryAuthor = "human" | "host" | "unknown";

export function entryAuthor(entry: Record<string, unknown>, role: "user" | "assistant"): EntryAuthor {
  if (role === "assistant") {
    const message = entry["message"] as Record<string, unknown> | undefined;
    if (entry["isApiErrorMessage"] === true || message?.["model"] === "<synthetic>") return "host";
    return "unknown";
  }
  if (entry["isMeta"] === true || entry["isCompactSummary"] === true) return "host";
  const origin = entry["origin"];
  if (origin !== null && typeof origin === "object" && !Array.isArray(origin)) {
    const kind = (origin as Record<string, unknown>)["kind"];
    if (typeof kind === "string") return kind === "human" ? "human" : "host";
  }
  return "unknown";
}

/**
 * THIS ADAPTER'S OWN STOP ASK, recognised by its first words (2026-09-23, B1).
 *
 * Since 2026-09-24 the ask leaves as `hookSpecificOutput.additionalContext` on
 * Stop (`bin/hook.ts#hostDelivery`). Read off the host's 2.1.281 bundle, NOT
 * measured live: the host files that as an `attachment` entry
 * (`attachment.type: "hook_additional_context"`, `hookEvent: "Stop"`), which
 * carries no role and never reaches this reader — and hands it to the model as
 * an `isMeta` user message `Stop hook additional context: <ask>` inside a
 * system reminder. Older transcripts still carry the two earlier shapes:
 * `Stop hook feedback:\n["<command>"]: <ask>` on an `isMeta` entry (stderr,
 * measured) and whatever the JSON `reason` came back as (never measured).
 *
 * Should any of those ever be written as user TEXT, the metadata rule would
 * call the block `injected` and our own wording would enter capture (CONTRACT
 * §5 G11). So a block the HOST wrote (`entryAuthor` ⇒ `host`) that opens with
 * the ask's own first words — bare, or behind a hook frame, or inside a system
 * reminder (`OWN_ASK`) — is `ritual` too. An entry with no metadata may be the
 * person, and the person quoting the ask back is conversation (review m1) — so
 * there only a FRAMED opener is ritual (`OWN_ASK_FRAMED`): nobody types a
 * `<system-reminder>` or a `Stop hook additional context:` in front of their
 * own words. The assistant's own text is never tested (m2).
 */
export const STOP_ASK_OPENER = "Counterparts, before this session closes:";

/** `<Event> hook <word(s)>:`, an optional bullet, an optional `["<command>"]: `. */
const HOOK_FRAME = "[A-Z][A-Za-z]+ hook [A-Za-z ]+:\\s*(?:-\\s*)?(?:\\[[^\\n]*?\\]:\\s*)?";
const REMINDER_FRAME = "<system-reminder>\\s*";
const OPENER = STOP_ASK_OPENER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The opener, bare or behind whatever frame the host puts in front of a hook's
 * message: a system reminder, then `<Event> hook <word>:` (the feedback, error,
 * and additional-context frames alike — the word is left open rather than
 * guessed), an optional bullet, an optional `["<command>"]: `. Anchored at the
 * start, so a hand-back that merely QUOTES the ask stays `injected`.
 */
const OWN_ASK = new RegExp(`^(?:${REMINDER_FRAME})?(?:${HOOK_FRAME})?${OPENER}`);

/** The same, with at least one frame REQUIRED — for an entry with no metadata. */
const OWN_ASK_FRAMED = new RegExp(`^(?:${REMINDER_FRAME}(?:${HOOK_FRAME})?|${HOOK_FRAME})${OPENER}`);

/**
 * One deliberate-recall tool call, as evidence for reference resolution
 * (recall CONTRACT §9.2). `atTurn` is the index of the NEXT conversational
 * turn — the call sits between `turns[atTurn - 1]` and `turns[atTurn]` — so the
 * boundary can slice expansions by the same cursor it slices turns with, and
 * the turn list itself does not grow: a live session's cursor indexes into
 * that list, and a tool call inserted as a turn would re-slice its uncaptured
 * tail. `ids` are the raw `ids` / `handle` values from the call's input, not
 * anything the assistant wrote in prose.
 */
export interface Expansion {
  readonly atTurn: number;
  readonly ids: readonly string[];
}

export interface TranscriptRead {
  readonly turns: Turn[];
  readonly ok: boolean;
  readonly reason: "read" | "absent" | "unreadable";
  /** Lines that were not a JSON object. Counted, never silently swallowed (scar §2.4). */
  readonly corrupt: number;
  /** Deliberate-recall calls, in order, positioned against `turns`. */
  readonly expansions: Expansion[];
}

/**
 * The recall tool as this host names it: the MCP prefix and server name are
 * the host's, the tool name is ours. Anchored on the suffix so a renamed
 * server still matches and `recall_bench` or `recall.decision` never do.
 */
export const RECALL_TOOL_NAME = /(^|__)recall$/;

/** The `ids` and `handle` fields of a recall call, as strings, in order. */
export function expansionIdsOf(input: unknown): string[] {
  if (input === null || typeof input !== "object") return [];
  const i = input as Record<string, unknown>;
  const out: string[] = [];
  if (typeof i["handle"] === "string") out.push(i["handle"]);
  if (Array.isArray(i["ids"])) {
    for (const id of i["ids"]) if (typeof id === "string") out.push(id);
  }
  return out;
}

export function readTranscript(path: string | undefined): TranscriptRead {
  if (path === undefined || path.trim().length === 0) {
    return { turns: [], ok: false, reason: "absent", corrupt: 0, expansions: [] };
  }
  if (!existsSync(path)) return { turns: [], ok: false, reason: "absent", corrupt: 0, expansions: [] };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { turns: [], ok: false, reason: "unreadable", corrupt: 0, expansions: [] };
  }
  return parseTranscript(raw);
}

/** A parsed line that can be read as an entry: a plain object, nothing else. */
function isEntry(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Exported so the parse is testable without a file (and it is the whole rule). */
export function parseTranscript(raw: string): TranscriptRead {
  const turns: Turn[] = [];
  const expansions: Expansion[] = [];
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
    // A line that parses to something that is not an object (`null`, a number,
    // an array) is not an entry, and reading a field off it would THROW — the
    // one thing this file promises not to do (review m5; master had the same
    // hole). Counted with the unparseable lines, never silently swallowed.
    if (!isEntry(entry)) {
      corrupt += 1;
      continue;
    }
    const message = entry["message"] as Record<string, unknown> | undefined;
    const role = (message?.["role"] ?? entry["role"]) as unknown;
    if (role !== "user" && role !== "assistant") continue;
    const content = message?.["content"] ?? entry["content"];
    const author = entryAuthor(entry, role);
    for (const piece of blocksOf(content, role, author)) {
      // A recall call is the assistant's turn, kept as EVIDENCE beside the
      // turn list rather than in it (see `Expansion`). Only the assistant
      // calls tools; a user-role block never carries one.
      if (piece.expansion !== undefined && role === "assistant" && piece.expansion.length > 0) {
        expansions.push({ atTurn: turns.length, ids: piece.expansion });
      }
      if (piece.text.trim().length === 0) continue;
      turns.push({ role, text: piece.text, source: piece.source });
    }
  }
  return { turns, ok: true, reason: "read", corrupt, expansions };
}

type Piece = { text: string; source: TurnSource; expansion?: string[] };

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
function pieceOf(text: string, role: "user" | "assistant", author: EntryAuthor): Piece {
  // Master's rule, shared by both roles and unchanged: foreign → ritual →
  // injected → conversation, from the text alone.
  const source = classifyBlock(text);
  // THE ORDER IS THE RULE (B1). The two refusals come first whatever the
  // metadata says: an `isMeta` Stop-hook block read as `injected` would ENTER
  // capture, which is G11 broken by a step meant only to keep it out of pacing.
  if (source === "foreign" || source === "ritual") return { text, source };
  // THE ASSISTANT'S TEXT IS NEVER RECLASSIFIED BY A MARKER (review m2): its own
  // replies pace and earn recall credit exactly as on master. The one change is
  // an entry the host SYNTHESISED as the assistant (an API error), which the
  // metadata names.
  if (role !== "user") return { text, source: author === "host" ? "injected" : source };
  if (author === "host") {
    if (OWN_ASK.test(text.trimStart())) return { text, source: "ritual" };
    // Kept in capture — a hand-back or a notification is real experience — and
    // out of pacing, because nobody in this session typed it. The peer rewrite
    // still applies, so a wrapper is labelled rather than read as the owner.
    const attributed = attributePeers(text);
    return { text: attributed.peers > 0 ? attributed.text : text, source: "injected" };
  }
  // The person typed it. Metadata answers, and the text markers — which exist
  // for entries that carry none — do not get a second vote: a pasted
  // `<system-reminder>` is still something the person pasted. A block that is
  // NOTHING but a peer wrapper is still `injected` whatever the entry claims —
  // the peer rule predates the metadata and is kept whole.
  if (author === "human") {
    const attributed = attributePeers(text);
    const peerOnly = attributed.peers > 0 && !attributed.ownerText;
    return { text: attributed.text, source: peerOnly ? "injected" : "conversation" };
  }
  // No metadata: our own ask behind a host frame is still ours (only FRAMED —
  // a bare opener may be the person quoting it), then master's rule, plus the
  // anchored host frames.
  if (OWN_ASK_FRAMED.test(text.trimStart())) return { text, source: "ritual" };
  if (source === "conversation" && hostFramed(text)) return { text, source: "injected" };
  const attributed = attributePeers(text);
  if (attributed.peers === 0) return { text, source };
  return { text: attributed.text, source: attributed.ownerText ? "conversation" : "injected" };
}

/** One transcript entry's content, flattened into typed pieces. */
function blocksOf(content: unknown, role: "user" | "assistant", author: EntryAuthor): Piece[] {
  if (typeof content === "string") {
    return [pieceOf(content, role, author)];
  }
  if (!Array.isArray(content)) return [];
  const out: Piece[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const type = b["type"];
    if (type === "text" && typeof b["text"] === "string") {
      out.push(pieceOf(b["text"], role, author));
      continue;
    }
    // Everything below is the DECLARED blind spot, tagged rather than dropped
    // here so the drop happens at `remember/`'s one rule (`enters`).
    if (type === "tool_use") {
      const name = b["name"];
      const expansion =
        typeof name === "string" && RECALL_TOOL_NAME.test(name) ? expansionIdsOf(b["input"]) : undefined;
      out.push({ text: "", source: "tool", ...(expansion === undefined ? {} : { expansion }) });
    } else if (type === "tool_result") {
      out.push({ text: "", source: "tool" });
    } else if (type === "image") {
      out.push({ text: "", source: "image" });
    } else if (type === "document") {
      out.push({ text: "", source: "file" });
    }
  }
  return out;
}

// ── the wake's arrival ──────────────────────────────────────────────────────
//
// A SECOND, DELIBERATELY SEPARATE PASS over the same file, for the one question
// `parseTranscript` refuses to answer: did the wake this system printed at
// SessionStart actually reach the session's context?
//
// `parseTranscript` skips attachment entries because injected context is not
// conversation, and that stays exactly as it is. The check below wants the
// opposite half of the file: the host records a SessionStart hook's output as an
// entry of its own (`type: "attachment"`, `attachment.type: "hook_success"`),
// carrying what the hook PRINTED (`stdout`) beside what the host says it
// INJECTED (`content`). Measured 2026-09-17 on Claude Code 2.1.274: that entry
// is line 3 of a fresh session's file, before the first user message, and both
// wake sentinels stand inside it.
//
// Several hooks run on the same event and each leaves its own attachment, so the
// match is on the command line, not on the event name alone.

/**
 * **CAL.** How much of the file's head this reader will look at, and why the
 * numbers are 256 KiB and 40 lines.
 *
 * The attachment arrives before the first user message — line 3 in the measured
 * case — so the answer is always in the first handful of entries, while the file
 * itself grows to megabytes over a long session. Both bounds are belt and
 * braces: the byte bound caps what is read off disk and parsed no matter how
 * long one line is, the line bound caps the work when the lines are short. A
 * wake is ~9 KB and appears twice in the attachment (printed and injected), so
 * 256 KiB leaves room for that entry plus every other hook's on the same event.
 *
 * A file bigger than the bound is READ SHORT, never wholly; the last line of a
 * short read is dropped, because it is cut mid-JSON by construction.
 */
export const WAKE_HEAD_MAX_BYTES = 256 * 1024;
export const WAKE_HEAD_MAX_LINES = 40;

/**
 * THIS PACKAGE'S HOOK, as it appears in the host's record of the command it ran.
 * Other hooks on the same event leave their own attachments; without this every
 * SessionStart hook on the machine would answer for the wake.
 *
 * Two spellings, because there are two ways this package is wired: the source
 * path (what the owner's host runs, and what the 2026-09-17 measurement read off
 * a live transcript) and the `counterparts-hook` bin `package.json` installs. A
 * THIRD is possible and unmeasured — a compiled binary under some other name —
 * and the cost of missing it is a session that reads `not-found`, which is
 * INTERFACE-GAPS §11's residual.
 */
export const COUNTERPARTS_HOOK_COMMAND = /claude-code[/\\]bin[/\\]hook\.ts|counterparts-hook/;

/**
 * The wake's two sentinels, recognised INSIDE a larger string rather than as a
 * whole line: what the host recorded may be the injected block (the wake plus
 * the first-launch question) or, on a day that carried a notice, the JSON
 * envelope the hook printed. The sentinel survives JSON escaping unchanged — it
 * holds no quote, backslash or newline — so one substring search answers both
 * forms. `[^>]*` cannot run past the comment's own close.
 *
 * They are a SECOND spelling of `self/briefing.ts`'s `OPEN_RE`/`SENTINEL_RE`,
 * which are not exported and live in the core this adapter may not reach into. A
 * core that exported them is the ask INTERFACE-GAPS §11 records; until then the anchors
 * are written so that a match is the sentinel string byte for byte.
 */
const WAKE_HEAD_PREFIX = "<!-- counterparts:wake ";
const WAKE_TAIL_PREFIX = "<!-- counterparts:wake/end ";
const WAKE_HEAD_SENTINEL = /^<!-- counterparts:wake [^>\n]*elements=(\d+) bytes=(\d+) -->/;
const WAKE_TAIL_SENTINEL = /^<!-- counterparts:wake\/end [^>\n]*elements=(\d+) bytes=(\d+) -->/;

/**
 * **CAL.** The longest a sentinel may be. It is one line of `day=`, one `lane=`
 * per lane, `elements=` and `bytes=` — about 120 bytes on this store's widest
 * day, and the cap is what keeps the search LINEAR: the anchored regex above
 * only ever runs against a slice this long, so no amount of poisoned memory text
 * can make it backtrack across the transcript.
 */
const SENTINEL_MAX_BYTES = 400;

/** What one sentinel said, or that it was not there. Numbers and flags only. */
export interface SentinelSighting {
  readonly present: boolean;
  readonly elements: number | null;
  readonly bytes: number | null;
  /**
   * True when the sentinel is the one the session was told to expect, byte for
   * byte. The comparison happens HERE so the matched text never leaves this
   * function: a sentinel is found inside a bundle of memories, and the text
   * around it is the owner's.
   */
  readonly matchesExpected: boolean;
}

const ABSENT: SentinelSighting = {
  present: false,
  elements: null,
  bytes: null,
  matchesExpected: false,
};

/**
 * Find one sentinel and report what it said. Linear in the length of `text`.
 *
 * **The search is `indexOf`, not the regex.** The regexes above used to be run
 * against the whole attachment with a leading `[^>]*`, which backtracks
 * quadratically: an adversarial body holding thousands of "<!-- counterparts:wake"
 * prefixes with no `>` between them measured 680 ms at 200 KB, four times per
 * attachment, inside `UserPromptSubmit`. So the literal prefix is located with
 * `indexOf`, a single line of at most `SENTINEL_MAX_BYTES` is cut from there,
 * and the anchored regex runs on that slice alone. Every prefix is tried, in
 * order — capping the attempts would let a poisoned body hide the real sentinel
 * behind a few hundred fakes.
 *
 * **A match that IS the expectation wins over an earlier one that is not**, for
 * the same reason: a memory whose body opens a sentinel it never closes would
 * otherwise stand in front of the real one and turn a delivered wake into a
 * `mismatch`. The first match is the answer only when nothing matches exactly.
 *
 * **The line is not sought, only the window** (2026-09-20, finding 7). This
 * loop used to cut its slice at `text.indexOf("\n", from)`, and `indexOf` costs
 * the distance it travels: a body of unterminated prefixes puts the next
 * newline at the far end for every one of them, so the search was quadratic
 * after all — 1.4 ms at 1,000 prefixes, 109 ms at 16,000, nearly four times the
 * cost for twice the input. The anchored regexes exclude `\n` themselves, so
 * cutting at `SENTINEL_MAX_BYTES` alone yields the identical match and makes
 * every iteration cost the same bounded amount. The test that claimed this
 * property was asserting a wall clock and never measured the growth.
 */
function sight(prefix: string, re: RegExp, text: string, expected: string | null): SentinelSighting {
  let first: SentinelSighting | null = null;
  let from = text.indexOf(prefix);
  while (from !== -1) {
    const end = Math.min(text.length, from + SENTINEL_MAX_BYTES);
    const m = re.exec(text.slice(from, end));
    if (m !== null) {
      const matchesExpected = expected !== null && m[0] === expected;
      const seen: SentinelSighting = {
        present: true,
        elements: Number(m[1]),
        bytes: Number(m[2]),
        matchesExpected,
      };
      if (matchesExpected) return seen;
      if (first === null) first = seen;
    }
    from = text.indexOf(prefix, from + 1);
  }
  return first ?? ABSENT;
}

/**
 * What the head of one transcript says about the wake's arrival. Counts, flags
 * and the sentinel lines — never a byte of the bundle itself.
 */
export interface WakeArrival {
  /** `not-read` when nobody asked for a read (no expectation to test). */
  readonly reason: "read" | "absent" | "unreadable" | "not-read";
  /** True when THIS package's SessionStart attachment was found in the head. */
  readonly found: boolean;
  /** The sentinels as they stand in what the host says it INJECTED. */
  readonly head: SentinelSighting;
  readonly tail: SentinelSighting;
  /** The same two in what the hook PRINTED — the truncation test needs both. */
  readonly headPrinted: SentinelSighting;
  readonly tailPrinted: SentinelSighting;
  /**
   * TRUE when the attachment carried a `content` string at all.
   *
   * `content` is a field of the host's private transcript format, measured once
   * on Claude Code 2.1.274; it is not a contract. A build that renames it, drops
   * it or sets it null leaves nothing to judge delivery from, and reading that
   * absence as an empty injection would make every session report the one word
   * that means v1's eleven-day silent-loss bug is back. An empty string that is
   * PRESENT is a different fact, and this flag keeps them apart.
   */
  readonly contentRecorded: boolean;
  /** Measured lengths of the two strings, in bytes, for the declared numbers. */
  readonly contentBytes: number;
  readonly stdoutBytes: number;
  readonly linesRead: number;
  readonly bytesRead: number;
  /** Lines in the head that were not JSON. Counted, never silently swallowed. */
  readonly corrupt: number;
}

export const NO_ARRIVAL: WakeArrival = {
  reason: "not-read",
  found: false,
  head: ABSENT,
  tail: ABSENT,
  headPrinted: ABSENT,
  tailPrinted: ABSENT,
  contentRecorded: false,
  contentBytes: 0,
  stdoutBytes: 0,
  linesRead: 0,
  bytesRead: 0,
  corrupt: 0,
};

/**
 * Read at most `WAKE_HEAD_MAX_BYTES` from the front of a file. One open, one
 * read, one close, and null on any failure at all — this runs on the prompt
 * path, where a throw would cost the turn its recall.
 *
 * **Regular files only, checked three ways.** The path arrives in the host's
 * payload, and `openSync` on a FIFO BLOCKS until somebody opens the other end —
 * which would hang `UserPromptSubmit` until the host's own hook timeout. So the
 * path is `stat`ed first (following symlinks, so a link to a FIFO is caught),
 * opened with `O_NONBLOCK` so even a FIFO that appeared in between returns
 * immediately, and `fstat`ed on the descriptor actually opened, which is the one
 * check no rename can race.
 */
function readHead(path: string, maxBytes: number): { text: string; bytes: number } | null {
  let fd: number | undefined;
  try {
    if (!statSync(path).isFile()) return null;
    fd = openSync(path, FS.O_RDONLY | FS.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) return null;
    const buf = Buffer.allocUnsafe(maxBytes);
    const read = readSync(fd, buf, 0, maxBytes, 0);
    // `bytes` is what came off the disk; `text.length` is characters, and the
    // two differ on any file with a multi-byte character in its head.
    return { text: buf.toString("utf8", 0, read), bytes: read };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* a descriptor we cannot close is not a reason to fail a hook */
      }
    }
  }
}

/**
 * Find this package's SessionStart attachment in the head of a transcript and
 * report what its two sentinels say.
 *
 * Nothing here throws, for the same reason nothing else in this file does: the
 * caller is a hook, and a hook may not fail the host (CONTRACT §5 G2).
 */
export function readWakeArrival(
  path: string | undefined,
  opts: {
    readonly maxBytes?: number;
    readonly maxLines?: number;
    /** Overridable so a test can name a different hook's command. */
    readonly command?: RegExp;
    /**
     * The tail sentinel this session was told to expect. It is compared inside
     * `sight()` and the comparison's ANSWER comes back; the matched text does
     * not, so no byte of the bundle can reach a caller (review MINOR 2).
     */
    readonly expect?: string | null;
  } = {},
): WakeArrival {
  if (path === undefined || path.trim().length === 0) return { ...NO_ARRIVAL, reason: "absent" };
  if (!existsSync(path)) return { ...NO_ARRIVAL, reason: "absent" };
  const maxBytes = opts.maxBytes ?? WAKE_HEAD_MAX_BYTES;
  const maxLines = opts.maxLines ?? WAKE_HEAD_MAX_LINES;
  const command = opts.command ?? COUNTERPARTS_HOOK_COMMAND;
  const head = readHead(path, maxBytes);
  if (head === null) return { ...NO_ARRIVAL, reason: "unreadable" };
  // A read that filled the buffer was almost certainly cut mid-line, and half a
  // line is not JSON. Dropping the last one costs nothing: the answer sits in
  // the first few entries or it is not in the head at all.
  const lines = head.text.split("\n");
  if (head.bytes >= maxBytes && lines.length > 1) lines.pop();
  let corrupt = 0;
  let linesRead = 0;
  for (const line of lines) {
    if (linesRead >= maxLines) break;
    if (line.trim().length === 0) continue;
    linesRead += 1;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      corrupt += 1;
      continue;
    }
    if (!isEntry(entry)) {
      corrupt += 1;
      continue;
    }
    if (entry["type"] !== "attachment") continue;
    const att = entry["attachment"];
    if (att === null || typeof att !== "object" || Array.isArray(att)) continue;
    const a = att as Record<string, unknown>;
    if (a["type"] !== "hook_success" || a["hookEvent"] !== "SessionStart") continue;
    if (typeof a["command"] !== "string" || !command.test(a["command"])) continue;
    const contentRecorded = typeof a["content"] === "string";
    const content = contentRecorded ? (a["content"] as string) : "";
    const stdout = typeof a["stdout"] === "string" ? a["stdout"] : "";
    const expect = opts.expect ?? null;
    return {
      reason: "read",
      found: true,
      head: sight(WAKE_HEAD_PREFIX, WAKE_HEAD_SENTINEL, content, null),
      tail: sight(WAKE_TAIL_PREFIX, WAKE_TAIL_SENTINEL, content, expect),
      headPrinted: sight(WAKE_HEAD_PREFIX, WAKE_HEAD_SENTINEL, stdout, null),
      tailPrinted: sight(WAKE_TAIL_PREFIX, WAKE_TAIL_SENTINEL, stdout, expect),
      contentRecorded,
      contentBytes: Buffer.byteLength(content, "utf8"),
      stdoutBytes: Buffer.byteLength(stdout, "utf8"),
      linesRead,
      bytesRead: head.bytes,
      corrupt,
    };
  }
  return { ...NO_ARRIVAL, reason: "read", linesRead, bytesRead: head.bytes, corrupt };
}
