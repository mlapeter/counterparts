/**
 * The owner's Claude Code transcripts, read-only: every user-role entry a
 * prompt hook could have seen, with its time, origin and text.
 *
 * Reads `<root>/<project>/<session>.jsonl` one level down only, so subagent
 * sidechains (`<session>/subagents/*.jsonl`) are never read; an entry marked
 * `isSidechain` is skipped as well. Nothing here writes anything. The text it
 * returns is PRIVATE: callers keep it in memory or in a work directory outside
 * the repo, and print ids, counts and positions only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Who started the entry, as the entry itself says (`origin.kind`, `isMeta`). */
export type OriginKind = "human" | "task-notification" | "peer" | "meta" | "none";

export interface PromptEntry {
  readonly session: string;
  /** Position among this session's prompt-like entries, 0-based. */
  readonly index: number;
  /** Epoch ms of the entry's `timestamp`. */
  readonly at: number;
  readonly origin: OriginKind;
  readonly isMeta: boolean;
  readonly cwd: string | null;
  readonly text: string;
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const blocks = content as Array<{ type?: string; text?: unknown }>;
  // A tool result is the model's own loop, never a prompt.
  if (blocks.length > 0 && blocks.every((b) => b.type === "tool_result")) return null;
  const parts = blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string);
  return parts.length === 0 ? null : parts.join("\n");
}

function originOf(e: Record<string, unknown>): OriginKind {
  const o = e["origin"] as { kind?: unknown } | undefined;
  const kind = typeof o?.kind === "string" ? o.kind : null;
  if (kind === "human") return "human";
  if (kind === "task-notification") return "task-notification";
  if (kind === "peer") return "peer";
  if (e["isMeta"] === true) return "meta";
  return "none";
}

/** One transcript file's prompt-like entries, in file order. */
export function readTranscript(path: string, session: string): PromptEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: PromptEntry[] = [];
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (e["type"] !== "user" || e["isSidechain"] === true || e["isCompactSummary"] === true) continue;
    const msg = e["message"] as { content?: unknown } | undefined;
    const text = textOf(msg?.content);
    if (text === null) continue;
    const ts = typeof e["timestamp"] === "string" ? Date.parse(e["timestamp"]) : NaN;
    if (!Number.isFinite(ts)) continue;
    out.push({
      session,
      index: out.length,
      at: ts,
      origin: originOf(e),
      isMeta: e["isMeta"] === true,
      cwd: typeof e["cwd"] === "string" ? e["cwd"] : null,
      text,
    });
  }
  return out;
}

/** session id -> transcript path, for the sessions asked about (top level only). */
export function locateTranscripts(root: string, sessions: ReadonlySet<string>): Map<string, string> {
  const found = new Map<string, string>();
  for (const project of readdirSync(root)) {
    const dir = join(root, project);
    let names: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const session = name.slice(0, -".jsonl".length);
      if (!sessions.has(session)) continue;
      // Newest wins if a session somehow appears in two project folders.
      const path = join(dir, name);
      const prev = found.get(session);
      if (prev === undefined || statSync(path).mtimeMs > statSync(prev).mtimeMs) found.set(session, path);
    }
  }
  return found;
}
