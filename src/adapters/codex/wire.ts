/**
 * CODEX'S TWO FILES, AS THIS PACKAGE EDITS THEM (2026-11-09, CX2) — pure
 * functions over their text; `cli/codex.ts` reads, backs up and writes.
 *
 *   - `$CODEX_HOME/hooks.json` (default `~/.codex`): our four hooks, ONE GROUP
 *     PER EVENT, APPENDED LAST. Codex keys a hook's trust by its POSITION —
 *     `[hooks.state."<file>:<event>:<group>:<handler>"] trusted_hash = …` in
 *     config.toml (measured 11-09) — so a group inserted before another tool's
 *     would shift that tool's key and quietly untrust it. Ours go after
 *     everything, are updated in place, and are the only ones ever removed.
 *   - `$CODEX_HOME/config.toml`: one `[mcp_servers.counterparts]` table, ours by
 *     its name, rewritten whole; and on disconnect the `hooks.state` rows that
 *     point at our hooks' positions. Nothing else in the file is touched: it is
 *     edited as lines, never parsed and re-serialized (no dependency, and every
 *     comment and every other table stays byte for byte).
 *
 * Trust is the PERSON's (Mike, 11-09, CX1 §5 route i): this file never writes a
 * `trusted_hash`. `connect` says to approve the hooks in Codex's `/hooks`, and
 * `doctor` reads whether they were (`trustOf`).
 */
import { TUNABLES } from "../config.js";

/** Codex's event names, the order we write them, and the snake form `hooks.state` keys use. */
export const CODEX_EVENTS = [
  { event: "SessionStart", key: "session_start", context: true },
  { event: "UserPromptSubmit", key: "user_prompt_submit", context: true },
  { event: "Stop", key: "stop", context: false },
  { event: "SessionEnd", key: "session_end", context: false },
] as const;

/** The MCP server's name in Codex's config, the same as in Claude Code's. */
export const CODEX_MCP_NAME = "counterparts";

/**
 * A hook command of ours: it runs `adapters/codex/bin/hook.(ts|js)` — never
 * Claude Code's hook, so neither host's `connect` reads the other's line as its own.
 */
export const CODEX_HOOK_MARK = /(^|[/\\])adapters[/\\]codex[/\\]bin[/\\]hook\.(ts|js|mjs)(?=$|["'\s])/;

export function isOurCodexCommand(command: unknown): boolean {
  return typeof command === "string" && CODEX_HOOK_MARK.test(command);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Our handler for one event, exactly as connect writes it. */
export function codexHandler(command: string, context: boolean, event = ""): Record<string, unknown> {
  return {
    type: "command",
    command,
    timeout: event === "SessionEnd" ? TUNABLES.CODEX_SESSION_END_TIMEOUT_S : TUNABLES.CODEX_HOOK_TIMEOUT_S,
    ...(context ? { additionalContextLimit: TUNABLES.CODEX_CONTEXT_LIMIT_TOKENS } : {}),
  };
}

/** Where one of our handlers sits: the event, its group and handler index. */
export interface OurPosition {
  readonly event: string;
  readonly key: string;
  readonly group: number;
  readonly handler: number;
  readonly command: string;
}

/** Every handler of ours in a hooks.json document, by position. */
export function ourPositions(doc: unknown): OurPosition[] {
  const out: OurPosition[] = [];
  const hooks = isRecord(doc) && isRecord(doc["hooks"]) ? doc["hooks"] : {};
  for (const e of CODEX_EVENTS) {
    const groups = hooks[e.event];
    if (!Array.isArray(groups)) continue;
    groups.forEach((g, gi) => {
      if (!isRecord(g) || !Array.isArray(g["hooks"])) return;
      (g["hooks"] as unknown[]).forEach((h, hi) => {
        if (isRecord(h) && isOurCodexCommand(h["command"])) out.push({ event: e.event, key: e.key, group: gi, handler: hi, command: h["command"] as string });
      });
    });
  }
  return out;
}

export type EventOutcome = "added" | "updated" | "already" | "removed" | "absent";

export interface HooksMerge {
  readonly doc: Record<string, unknown>;
  readonly changed: boolean;
  readonly events: readonly { readonly event: string; readonly outcome: EventOutcome }[];
  /** Another tool's hook commands left exactly where they were. */
  readonly foreignKept: number;
  /** Events where another tool's group sat AFTER ours when ours was removed: its trust key moved. */
  readonly shifted: readonly string[];
}

/**
 * Put our four hooks in (`wire`) or take them out (`unwire`). Another tool's
 * groups and handlers are carried through untouched, in their order; a shape
 * this function does not read is carried through whole.
 */
export function mergeCodexHooks(doc: unknown, command: string, direction: "wire" | "unwire"): HooksMerge {
  const next: Record<string, unknown> = isRecord(doc) ? (structuredClone(doc) as Record<string, unknown>) : {};
  const hooks: Record<string, unknown> = isRecord(next["hooks"]) ? (next["hooks"] as Record<string, unknown>) : {};
  const events: { event: string; outcome: EventOutcome }[] = [];
  const shifted: string[] = [];
  let foreignKept = 0;
  let changed = false;
  for (const e of CODEX_EVENTS) {
    const raw = hooks[e.event];
    const groups: unknown[] = Array.isArray(raw) ? [...raw] : [];
    const want = codexHandler(command, e.context, e.event);
    let seen = false;
    let outcome: EventOutcome = direction === "wire" ? "added" : "absent";
    let lastOurs = -1;
    const outGroups: unknown[] = [];
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) {
        outGroups.push(group);
        continue;
      }
      const kept: unknown[] = [];
      let touched = false;
      for (const h of group["hooks"] as unknown[]) {
        if (!(isRecord(h) && isOurCodexCommand(h["command"]))) {
          kept.push(h);
          if (isRecord(h) && typeof h["command"] === "string") foreignKept += 1;
          continue;
        }
        touched = true;
        if (direction === "unwire" || seen) {
          // Removed: on unwire every one of ours; on wire, a duplicate of ours.
          if (direction === "unwire") outcome = "removed";
          changed = true;
          continue;
        }
        seen = true;
        const same = JSON.stringify(h) === JSON.stringify(want);
        outcome = same ? "already" : "updated";
        if (!same) changed = true;
        kept.push(want);
      }
      if (touched) lastOurs = outGroups.length;
      if (touched && kept.length === 0) continue;
      outGroups.push(touched ? { ...group, hooks: kept } : group);
    }
    if (direction === "unwire" && outcome === "removed" && lastOurs >= 0 && lastOurs < outGroups.length) shifted.push(e.event);
    if (direction === "wire" && !seen) {
      outGroups.push({ hooks: [want] });
      changed = true;
    }
    if (outGroups.length > 0) hooks[e.event] = outGroups;
    else delete hooks[e.event];
    events.push({ event: e.event, outcome });
  }
  if (Object.keys(hooks).length > 0 || isRecord(next["hooks"])) next["hooks"] = hooks;
  return { doc: next, changed, events, foreignKept, shifted };
}

// ── config.toml, as lines ────────────────────────────────────────────────────

/** A TOML basic string: JSON's escaping is a subset TOML reads the same. */
export function tomlString(s: string): string {
  return JSON.stringify(s);
}

/** Our MCP table, whole. `env` carries the store and the configuration explicitly. */
export function codexMcpBlock(command: string, args: readonly string[], env: Readonly<Record<string, string>>): string {
  const envPairs = Object.entries(env).map(([k, v]) => `${k} = ${tomlString(v)}`);
  return [
    "# Written by `counterparts connect --host codex`; `counterparts disconnect --host codex` removes it.",
    `[mcp_servers.${CODEX_MCP_NAME}]`,
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
    `env = { ${envPairs.join(", ")} }`,
  ].join("\n");
}

const HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;
const OUR_TABLE = new RegExp(`^mcp_servers\\s*\\.\\s*(?:"${CODEX_MCP_NAME}"|${CODEX_MCP_NAME})(\\s*\\..*)?$`);
const BLOCK_COMMENT = /^#\s*Written by `counterparts connect --host codex`/;

/** The header line's table name, or null for a line that is not a header. */
function headerOf(line: string): string | null {
  const m = HEADER.exec(line);
  return m === null ? null : (m[1] as string);
}

/**
 * Drop the tables `drop` names (each with its body, up to the next header),
 * and our block's own comment line above our MCP table.
 */
function dropTables(text: string, drop: (name: string) => boolean): { text: string; dropped: number } {
  const lines = text.split("\n");
  const out: string[] = [];
  let skipping = false;
  let dropped = 0;
  for (const line of lines) {
    const name = headerOf(line);
    if (name !== null) {
      skipping = drop(name);
      if (skipping) {
        dropped += 1;
        if (out.length > 0 && BLOCK_COMMENT.test(out[out.length - 1] ?? "")) out.pop();
        continue;
      }
    }
    if (!skipping) out.push(line);
  }
  return { text: out.join("\n"), dropped };
}

/** Is there an MCP entry named ours in a form this file does not edit (an inline or dotted one)? */
export function foreignShapedMcp(text: string): boolean {
  let inServers = false;
  for (const line of text.split("\n")) {
    const name = headerOf(line);
    if (name !== null) {
      inServers = name === "mcp_servers";
      continue;
    }
    if (/^\s*mcp_servers\s*\.\s*"?counterparts"?\s*[.=]/.test(line)) return true;
    if (inServers && /^\s*"?counterparts"?\s*[.=]/.test(line)) return true;
  }
  return false;
}

/** Does config.toml hold our MCP table? */
export function hasCodexMcp(text: string): boolean {
  return text.split("\n").some((l) => {
    const n = headerOf(l);
    return n !== null && OUR_TABLE.test(n);
  });
}

/** The `[mcp_servers.counterparts]` table's body, as key → raw value text (for doctor). */
export function codexMcpEntry(text: string): Record<string, string> | null {
  const lines = text.split("\n");
  let inOurs = false;
  let found = false;
  const out: Record<string, string> = {};
  for (const line of lines) {
    const n = headerOf(line);
    if (n !== null) {
      inOurs = n.replace(/\s+/g, "") === `mcp_servers.${CODEX_MCP_NAME}` || n.replace(/\s+/g, "") === `mcp_servers."${CODEX_MCP_NAME}"`;
      found = found || inOurs;
      continue;
    }
    if (!inOurs) continue;
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (m !== null) out[m[1] as string] = (m[2] as string).trim();
  }
  return found ? out : null;
}

/** Put our MCP table in (replacing one of ours), or take it out. */
export function mergeCodexMcp(text: string, block: string | null): { text: string; changed: boolean; had: boolean } {
  const had = hasCodexMcp(text);
  const { text: without } = dropTables(text, (n) => OUR_TABLE.test(n));
  if (block === null) return { text: without, changed: had, had };
  const base = without.replace(/\n+$/, "");
  const next = `${base.length === 0 ? "" : `${base}\n\n`}${block}\n`;
  return { text: next, changed: next !== text, had };
}

/** A `hooks.state` key: `<hooks.json path>:<event>:<group>:<handler>` (measured 11-09). */
export function stateKey(hooksPath: string, p: Pick<OurPosition, "key" | "group" | "handler">): string {
  return `${hooksPath}:${p.key}:${String(p.group)}:${String(p.handler)}`;
}

/** Every `[hooks.state."<key>"]` row: its key, and whether it carries a trusted hash or is disabled. */
export function hookStates(text: string): Map<string, { trusted: boolean; enabled: boolean }> {
  const out = new Map<string, { trusted: boolean; enabled: boolean }>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const n = headerOf(line);
    if (n !== null) {
      const m = /^hooks\s*\.\s*state\s*\.\s*"((?:[^"\\]|\\.)*)"$/.exec(n);
      current = m === null ? null : JSON.parse(`"${m[1] as string}"`) as string;
      if (current !== null) out.set(current, { trusted: false, enabled: true });
      continue;
    }
    if (current === null) continue;
    const row = out.get(current);
    if (row === undefined) continue;
    if (/^\s*trusted_hash\s*=\s*"sha256:[0-9a-f]+"/.test(line)) out.set(current, { ...row, trusted: true });
    if (/^\s*enabled\s*=\s*false\b/.test(line)) out.set(current, { ...row, enabled: false });
  }
  return out;
}

/** Remove the `hooks.state` rows with these keys (disconnect: ours only). */
export function dropHookStates(text: string, keys: ReadonlySet<string>): { text: string; dropped: number } {
  return dropTables(text, (n) => {
    const m = /^hooks\s*\.\s*state\s*\.\s*"((?:[^"\\]|\\.)*)"$/.exec(n);
    if (m === null) return false;
    try {
      return keys.has(JSON.parse(`"${m[1] as string}"`) as string);
    } catch {
      return false;
    }
  });
}

/** What Codex's trust says about each of our hooks, by the paths Codex may have keyed them under. */
export function trustOf(
  positions: readonly OurPosition[],
  states: ReadonlyMap<string, { trusted: boolean; enabled: boolean }>,
  hooksPaths: readonly string[],
): { event: string; state: "trusted" | "disabled" | "unapproved" }[] {
  return positions.map((p) => {
    for (const path of hooksPaths) {
      const s = states.get(stateKey(path, p));
      if (s === undefined) continue;
      if (!s.enabled) return { event: p.event, state: "disabled" as const };
      if (s.trusted) return { event: p.event, state: "trusted" as const };
    }
    return { event: p.event, state: "unapproved" as const };
  });
}

/** Is Codex's own `memories` feature switched on in config.toml (`[features] memories = true`)? */
export function codexMemoriesOn(text: string): boolean {
  let inFeatures = false;
  for (const line of text.split("\n")) {
    const n = headerOf(line);
    if (n !== null) {
      inFeatures = n === "features";
      continue;
    }
    if (inFeatures && /^\s*memories\s*=\s*true\b/.test(line)) return true;
    if (/^\s*features\s*\.\s*memories\s*=\s*true\b/.test(line)) return true;
  }
  return false;
}
