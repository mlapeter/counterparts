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
/** A line that is only a comment, or blank. */
const COMMENT_OR_BLANK = /^\s*(#.*)?$/;

/** The header line's table name, or null for a line that is not a header. */
function headerOf(line: string): string | null {
  const m = HEADER.exec(line);
  return m === null ? null : (m[1] as string);
}

/**
 * ONE LINE OF config.toml, AS THESE EDITS READ IT (CX2 fix round): its text;
 * its table name when it is a header OUTSIDE a multi-line string (a
 * `[mcp_servers.counterparts]` inside `"""…"""` is words, not a table); whether
 * it began inside such a string; and its CODE — the line with every string
 * replaced by `""` and its comment cut, for the validity check.
 */
interface TomlLine {
  readonly text: string;
  readonly header: string | null;
  readonly inString: boolean;
  readonly code: string;
  /** Still inside a multi-line string at its end. */
  readonly openAfter: boolean;
}

/** Read config.toml's lines with multi-line strings (`"""`, `'''`) tracked. Never throws. */
export function scanToml(text: string): TomlLine[] {
  const out: TomlLine[] = [];
  let open: '"""' | "'''" | null = null;
  for (const line of text.split("\n")) {
    const startedIn = open !== null;
    let code = "";
    let i = 0;
    while (i < line.length) {
      if (open !== null) {
        const j = line.indexOf(open, i);
        if (j < 0) {
          i = line.length;
          break;
        }
        open = null;
        i = j + 3;
        continue;
      }
      const c = line[i] as string;
      if (c === "#") break;
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        open = line.startsWith('"""', i) ? '"""' : "'''";
        code += '""';
        i += 3;
        continue;
      }
      if (c === '"') {
        i += 1;
        while (i < line.length && line[i] !== '"') i += line[i] === "\\" ? 2 : 1;
        i += 1;
        code += '""';
        continue;
      }
      if (c === "'") {
        const j = line.indexOf("'", i + 1);
        i = j < 0 ? line.length : j + 1;
        code += '""';
        continue;
      }
      code += c;
      i += 1;
    }
    out.push({ text: line, header: startedIn ? null : headerOf(line), inString: startedIn, code, openAfter: open !== null });
  }
  return out;
}

/**
 * WHY config.toml CANNOT BE EDITED, or null (CX2 fix round). Not a TOML
 * parser: a line-level check that each line outside a string is blank, a
 * comment, a table header, a `key = value`, or the inside of a value an
 * earlier line opened (an array, an inline table, a multi-line string). It
 * names the LINE NUMBER only: a config line may hold a token.
 */
export function tomlProblem(text: string): string | null {
  let depth = 0;
  const lines = scanToml(text);
  for (const [n, l] of lines.entries()) {
    if (l.inString) continue;
    const code = l.code.trim();
    const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
    if (depth > 0) {
      depth += count(code, /[[{]/g) - count(code, /[\]}]/g);
      if (depth < 0) return `line ${String(n + 1)} closes a bracket nothing opened`;
      continue;
    }
    if (code.length === 0) continue;
    if (/^\[\[?[^[\]]+\]\]?$/.test(code)) continue;
    const kv = /^([A-Za-z0-9_\-"]+(?:\s*\.\s*[A-Za-z0-9_\-"]+)*)\s*=\s*(\S.*)$/.exec(code);
    if (kv === null) return `line ${String(n + 1)} is not a table, a key = value, or a comment`;
    const value = kv[2] as string;
    depth += count(value, /[[{]/g) - count(value, /[\]}]/g);
    if (depth < 0) return `line ${String(n + 1)} closes a bracket nothing opened`;
  }
  if (lines.length > 0 && (lines[lines.length - 1] as TomlLine).openAfter) return "a multi-line string is never closed";
  if (depth > 0) return "an array or inline table is never closed";
  return null;
}

/**
 * Drop the tables `drop` names (each with its body, up to the next header),
 * and our block's own comment line above our MCP table. The comments and
 * blank lines at the END of a dropped table stay: they sit above the next
 * header and are that table's (CX2 fix round: a `# note` above a later table
 * was lost on reconnect).
 */
function dropTables(text: string, drop: (name: string) => boolean): { text: string; dropped: number } {
  const out: string[] = [];
  let skipping = false;
  let skipped: string[] = [];
  let dropped = 0;
  const release = (atEnd: boolean): void => {
    let k = skipped.length;
    while (k > 0 && COMMENT_OR_BLANK.test(skipped[k - 1] as string)) k -= 1;
    // At the end of the file, keep the comments (somebody's) and lose the blank lines.
    const tail = skipped.slice(k);
    out.push(...(atEnd ? tail.filter((s) => s.trim().length > 0) : tail));
    skipped = [];
  };
  for (const l of scanToml(text)) {
    if (l.header !== null) {
      if (skipping) release(false);
      skipping = drop(l.header);
      if (skipping) {
        dropped += 1;
        if (out.length > 0 && BLOCK_COMMENT.test(out[out.length - 1] ?? "")) out.pop();
        continue;
      }
    }
    if (skipping) skipped.push(l.text);
    else out.push(l.text);
  }
  if (skipping) release(true);
  return { text: out.join("\n"), dropped };
}

/** Is there an MCP entry named ours in a form this file does not edit (an inline or dotted one)? */
export function foreignShapedMcp(text: string): boolean {
  let inServers = false;
  for (const l of scanToml(text)) {
    if (l.inString) continue;
    if (l.header !== null) {
      inServers = l.header === "mcp_servers";
      continue;
    }
    if (/^\s*mcp_servers\s*\.\s*"?counterparts"?\s*[.=]/.test(l.code)) return true;
    if (inServers && /^\s*"*counterparts"*\s*[.=]/.test(l.code)) return true;
  }
  return false;
}

/** Does config.toml hold our MCP table? */
export function hasCodexMcp(text: string): boolean {
  return scanToml(text).some((l) => l.header !== null && OUR_TABLE.test(l.header));
}

/** The `[mcp_servers.counterparts]` table's body, as key → raw value text (for doctor). */
export function codexMcpEntry(text: string): Record<string, string> | null {
  let inOurs = false;
  let found = false;
  const out: Record<string, string> = {};
  for (const l of scanToml(text)) {
    if (l.header !== null) {
      const n = l.header.replace(/\s+/g, "");
      inOurs = n === `mcp_servers.${CODEX_MCP_NAME}` || n === `mcp_servers."${CODEX_MCP_NAME}"`;
      found = found || inOurs;
      continue;
    }
    if (!inOurs || l.inString) continue;
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(l.text);
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

/** The key a `[hooks.state."<key>"]` header names, or null. */
function stateKeyOf(header: string): string | null {
  const m = /^hooks\s*\.\s*state\s*\.\s*"((?:[^"\\]|\\.)*)"$/.exec(header);
  if (m === null) return null;
  try {
    return JSON.parse(`"${m[1] as string}"`) as string;
  } catch {
    return null;
  }
}

/** Every `[hooks.state."<key>"]` row: its key, and whether it carries a trusted hash or is disabled. */
export function hookStates(text: string): Map<string, { trusted: boolean; enabled: boolean }> {
  const out = new Map<string, { trusted: boolean; enabled: boolean }>();
  let current: string | null = null;
  for (const l of scanToml(text)) {
    if (l.header !== null) {
      current = stateKeyOf(l.header);
      if (current !== null) out.set(current, { trusted: false, enabled: true });
      continue;
    }
    if (current === null || l.inString) continue;
    const row = out.get(current);
    if (row === undefined) continue;
    if (/^\s*trusted_hash\s*=\s*"sha256:[0-9a-f]+"/.test(l.text)) out.set(current, { ...row, trusted: true });
    if (/^\s*enabled\s*=\s*false\b/.test(l.text)) out.set(current, { ...row, enabled: false });
  }
  return out;
}

/** Remove the `hooks.state` rows with these keys (disconnect: ours only). */
export function dropHookStates(text: string, keys: ReadonlySet<string>): { text: string; dropped: number } {
  return dropTables(text, (n) => {
    const key = stateKeyOf(n);
    return key !== null && keys.has(key);
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
  for (const l of scanToml(text)) {
    if (l.header !== null) {
      inFeatures = l.header === "features";
      continue;
    }
    if (l.inString) continue;
    if (inFeatures && /^\s*memories\s*=\s*true\b/.test(l.code)) return true;
    if (/^\s*features\s*\.\s*memories\s*=\s*true\b/.test(l.code)) return true;
  }
  return false;
}

/**
 * hooks.json written back in ITS OWN indentation and line ending (CX2 fix
 * round): the indent of its first indented line (two spaces when there is
 * none), and a final newline when it had one.
 */
export function formatLike(previous: string | null, doc: unknown): string {
  const indent = previous === null ? "  " : (/\n([ \t]+)\S/.exec(previous)?.[1] ?? "  ");
  const eol = previous !== null && previous.includes("\r\n") ? "\r\n" : "\n";
  const body = JSON.stringify(doc, null, indent).replace(/\n/g, eol);
  return previous === null || /\r?\n$/.test(previous) ? `${body}${eol}` : body;
}
