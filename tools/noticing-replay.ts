#!/usr/bin/env bun
/**
 * NOTICING REPLAY: what noticing v1 (`src/adapters/claude-code/noticing.ts`)
 * would have done on real Claude Code transcripts, in COUNTS ONLY.
 *
 * It reads `~/.claude/projects/<folder>/<session>.jsonl` READ-ONLY, runs the
 * adapter's own parse (`transcript.ts#parseTranscript`, its `toolCalls` side
 * list) and the adapter's own Stop decision (`noticing.ts#scanAtStop`) at each
 * Stop the file records, and prints numbers. It never prints a line of a
 * transcript, a tool's input or output, a path, or a name: only a session id
 * (first 8 characters), the folder name, and counts. It never opens a
 * Counterparts store (nor `~/.bansai` or `~/.claude-engram`).
 *
 * WHERE THE STOPS ARE. The host writes one `system` line, subtype
 * `stop_hook_summary`, after each Stop's hooks ran (measured 2026-11-26 on
 * 2.1.3xx files: one per Stop, beside one `hook_success` attachment per Stop
 * hook). Each is a simulated Stop, placed after the last tool call before it.
 * A file with none (an older host, or no Stop hook) falls back to a Stop
 * before each typed prompt and one at the end. A re-fire cannot be told from a
 * Stop in the record, and no nudge was ever sent in these files, so every
 * simulated Stop is a first pass and `would` equals what `nudged` would have
 * been, before any cap. Whether a session was attended is not in the file
 * either: every session is counted.
 *
 * SESSION-HOURS are ACTIVE time: the gaps between consecutive timestamps,
 * each capped at 10 minutes, so a session left open overnight is not an hour
 * of anything.
 *
 * Usage:
 *   bun tools/noticing-replay.ts --session <id-prefix> [--session …]
 *   bun tools/noticing-replay.ts --folders <folder,folder> [--days 7]
 *   extra Bash patterns, as `noticing.bashPatterns` / `noticing.bashOutgoing`:
 *     --bash-pattern <regex> (repeatable)   --bash-outgoing <regex> (repeatable)
 *   --projects <dir> to read another projects root (tests); default ~/.claude/projects
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { EMPTY_STATE, classifyCall, compilePatterns, scanAtStop } from "../src/adapters/claude-code/noticing.js";
import type { NoticeKind, NoticingState } from "../src/adapters/claude-code/noticing.js";
import { parseTranscript } from "../src/adapters/claude-code/transcript.js";

const GAP_CAP_MS = 10 * 60_000;

export interface SessionReplay {
  readonly session: string;
  readonly folder: string;
  readonly stops: number;
  readonly would: number;
  readonly quiet: number;
  readonly activeHours: number;
  readonly lastAt: number;
  readonly byKind: Partial<Record<NoticeKind, number>>;
  readonly remembers: number;
}

interface Settings {
  readonly bashPatterns: RegExp[];
  readonly bashOutgoing: RegExp[];
}

/** One file's replay. Pure over the text; exported for the test. */
export function replaySession(raw: string, session: string, folder: string, settings: Settings): SessionReplay {
  const read = parseTranscript(raw);
  const calls = read.toolCalls;
  const index = new Map(calls.map((c, i) => [c.id, i]));
  // The Stops, each as "how many calls had happened".
  const stops: number[] = [];
  const typedBefore: number[] = [];
  let seen = 0;
  let stamps: number[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let e: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(line);
      if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
      e = v as Record<string, unknown>;
    } catch {
      continue;
    }
    const t = typeof e["timestamp"] === "string" ? Date.parse(e["timestamp"]) : Number.NaN;
    if (Number.isFinite(t)) stamps.push(t);
    const content = (e["message"] as Record<string, unknown> | undefined)?.["content"];
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b !== null && typeof b === "object" && (b as Record<string, unknown>)["type"] === "tool_use") {
          const at = index.get(String((b as Record<string, unknown>)["id"]));
          if (at !== undefined) seen = Math.max(seen, at + 1);
        }
      }
    }
    if (e["type"] === "system" && e["subtype"] === "stop_hook_summary" && e["isSidechain"] !== true) stops.push(seen);
    const origin = e["origin"] as Record<string, unknown> | undefined;
    if (e["type"] === "user" && origin?.["kind"] === "human" && e["isMeta"] !== true) typedBefore.push(seen);
  }
  const points = stops.length > 0 ? stops : [...typedBefore.slice(1), calls.length];
  let state: NoticingState = EMPTY_STATE;
  const byKind: Partial<Record<NoticeKind, number>> = {};
  for (const n of points) {
    const scan = scanAtStop(calls.slice(0, n), state, settings, { reFired: false, now: 1 });
    if (scan.say !== null) {
      for (const [k, v] of Object.entries(scan.say) as [NoticeKind, number][]) byKind[k] = (byKind[k] ?? 0) + v;
    }
    if (scan.next !== null) state = scan.next;
  }
  stamps = stamps.sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < stamps.length; i += 1) active += Math.min(GAP_CAP_MS, (stamps[i] ?? 0) - (stamps[i - 1] ?? 0));
  const remembers = calls.filter((c) => classifyCall(c, settings) === "remember").length;
  return {
    session,
    folder,
    stops: points.length,
    would: state.would,
    quiet: state.quiet,
    activeHours: active / 3_600_000,
    lastAt: stamps.length === 0 ? 0 : (stamps[stamps.length - 1] ?? 0),
    byKind,
    remembers,
  };
}

function kinds(k: Partial<Record<NoticeKind, number>>): string {
  const parts = Object.entries(k).map(([name, n]) => `${name} ${String(n)}`);
  return parts.length === 0 ? "-" : parts.join(", ");
}

function main(argv: readonly string[]): number {
  const sessions: string[] = [];
  let folders: string[] = [];
  let days = 7;
  let root = join(homedir(), ".claude", "projects");
  const bashPatterns: string[] = [];
  const bashOutgoing: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1] ?? "";
    if (a === "--session") (sessions.push(v), (i += 1));
    else if (a === "--folders") ((folders = v.split(",").filter((s) => s.length > 0)), (i += 1));
    else if (a === "--days") ((days = Number(v)), (i += 1));
    else if (a === "--projects") ((root = v), (i += 1));
    else if (a === "--bash-pattern") (bashPatterns.push(v), (i += 1));
    else if (a === "--bash-outgoing") (bashOutgoing.push(v), (i += 1));
    else {
      process.stderr.write(`unknown argument ${String(a)}\n`);
      return 2;
    }
  }
  const settings: Settings = { bashPatterns: compilePatterns(bashPatterns), bashOutgoing: compilePatterns(bashOutgoing) };
  if (!existsSync(root)) {
    process.stderr.write("no projects root\n");
    return 1;
  }
  const out = (s: string): void => {
    process.stdout.write(`${s}\n`);
  };
  const files: { folder: string; path: string; id: string }[] = [];
  for (const folder of readdirSync(root)) {
    if (folders.length > 0 && !folders.includes(folder) && sessions.length === 0) continue;
    const dir = join(root, folder);
    let names: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      names = readdirSync(dir).filter((n) => n.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const n of names) {
      const id = basename(n, ".jsonl");
      if (sessions.length > 0 && !sessions.some((s) => id.startsWith(s))) continue;
      files.push({ folder, path: join(dir, n), id });
    }
  }
  const results: SessionReplay[] = [];
  for (const f of files) {
    let raw: string;
    try {
      raw = readFileSync(f.path, "utf8");
    } catch {
      continue;
    }
    results.push(replaySession(raw, f.id.slice(0, 8), f.folder, settings));
  }
  if (sessions.length > 0) {
    out("session   stops  would  quiet  remembers  active-h  unwritten-by-kind");
    for (const r of results) {
      out(`${r.session}  ${String(r.stops).padStart(5)}  ${String(r.would).padStart(5)}  ${String(r.quiet).padStart(5)}  ${String(r.remembers).padStart(9)}  ${r.activeHours.toFixed(2).padStart(8)}  ${kinds(r.byKind)}`);
    }
    return 0;
  }
  const since = Date.now() - days * 86_400_000;
  const recent = results.filter((r) => r.lastAt >= since);
  out(`last ${String(days)} days, by folder (sessions with any timestamp in the window)`);
  out("folder | sessions | stops | active-h | would | quiet | would/h | sessions-with-would | unwritten-by-kind");
  const byFolder = new Map<string, SessionReplay[]>();
  for (const r of recent) byFolder.set(r.folder, [...(byFolder.get(r.folder) ?? []), r]);
  let allH = 0;
  let allW = 0;
  for (const [folder, rs] of [...byFolder.entries()].sort()) {
    const h = rs.reduce((n, r) => n + r.activeHours, 0);
    const w = rs.reduce((n, r) => n + r.would, 0);
    const q = rs.reduce((n, r) => n + r.quiet, 0);
    const s = rs.reduce((n, r) => n + r.stops, 0);
    const k: Partial<Record<NoticeKind, number>> = {};
    for (const r of rs) for (const [name, n] of Object.entries(r.byKind) as [NoticeKind, number][]) k[name] = (k[name] ?? 0) + n;
    allH += h;
    allW += w;
    out(`${folder} | ${String(rs.length)} | ${String(s)} | ${h.toFixed(1)} | ${String(w)} | ${String(q)} | ${(h > 0 ? w / h : 0).toFixed(2)} | ${String(rs.filter((r) => r.would > 0).length)} | ${kinds(k)}`);
  }
  out(`all | ${String(recent.length)} | - | ${allH.toFixed(1)} | ${String(allW)} | - | ${(allH > 0 ? allW / allH : 0).toFixed(2)} | - | -`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
