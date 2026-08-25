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
 * Nothing here throws. A transcript we cannot read yields no turns, which costs
 * a boundary's capture; a transcript that throws would cost the session.
 */
import { existsSync, readFileSync } from "node:fs";

import type { Turn, TurnSource } from "../../core/remember/index.js";

/** The marker the host wraps around context it injected itself. */
const INJECTED = /<(system-reminder|command-name|command-message|local-command-stdout)\b/i;

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
    for (const piece of blocksOf(content)) {
      if (piece.text.trim().length === 0) continue;
      turns.push({ role, text: piece.text, source: piece.source });
    }
  }
  return { turns, ok: true, reason: "read", corrupt };
}

/** One transcript entry's content, flattened into typed pieces. */
function blocksOf(content: unknown): { text: string; source: TurnSource }[] {
  if (typeof content === "string") {
    return [{ text: content, source: INJECTED.test(content) ? "injected" : "conversation" }];
  }
  if (!Array.isArray(content)) return [];
  const out: { text: string; source: TurnSource }[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const type = b["type"];
    if (type === "text" && typeof b["text"] === "string") {
      const text = b["text"];
      out.push({ text, source: INJECTED.test(text) ? "injected" : "conversation" });
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
