/**
 * DOCTOR'S CODEX LINES (2026-11-09, CX2; CX1 §5). Reads Codex's files only —
 * never runs `codex` (doctor does not run somebody's program to grade them),
 * so two things are said, not measured: the installed version, and whether the
 * login is alive (`codex login status` said "logged in" over a dead token on
 * 11-09). Quiet — no lines at all — on a machine where nothing of ours is in
 * Codex's files.
 *
 * The finding's shape is structural (the `doctor` report's own `Finding`), so
 * this library file imports no other adapter.
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import {
  CODEX_EVENTS,
  codexMcpEntry,
  codexMemoriesOn,
  hookStates,
  ourPositions,
  trustOf,
} from "./wire.js";
import { readCodexTranscript } from "./transcript.js";

export interface CodexFinding {
  readonly key: string;
  readonly severity: "red" | "amber" | "green";
  readonly title: string;
  readonly detail: string;
  readonly fix: string;
  readonly data: Record<string, string | number | boolean | null>;
}

export interface CodexDoctorInput {
  /** `$CODEX_HOME`, or `~/.codex`. */
  readonly codexHome: string;
  /** Is a `codex` executable on PATH (a directory walk)? Null when there is no PATH. */
  readonly codexOnPath: boolean | null;
  /** How the person's console names `connect` (`counterparts`). */
  readonly cli: string;
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The newest rollout under `sessions/YYYY/MM/DD/`, or null. A bounded walk: newest year, month, day first. */
export function newestRollout(codexHome: string): string | null {
  const desc = (dir: string): string[] => {
    try {
      return readdirSync(dir).sort().reverse();
    } catch {
      return [];
    }
  };
  const root = join(codexHome, "sessions");
  for (const y of desc(root)) {
    for (const m of desc(join(root, y))) {
      for (const d of desc(join(root, y, m))) {
        const file = desc(join(root, y, m, d)).find((f) => /^rollout-.*\.jsonl$/.test(f));
        if (file !== undefined) return join(root, y, m, d, file);
      }
    }
  }
  return null;
}

export function codexFindings(input: CodexDoctorInput): CodexFinding[] {
  const hooksPath = join(input.codexHome, "hooks.json");
  const tomlPath = join(input.codexHome, "config.toml");
  let hooksDoc: unknown = {};
  const hooksRaw = read(hooksPath);
  try {
    hooksDoc = hooksRaw === null ? {} : JSON.parse(hooksRaw);
  } catch {
    hooksDoc = {};
  }
  const toml = read(tomlPath) ?? "";
  const positions = ourPositions(hooksDoc);
  const mcp = codexMcpEntry(toml);
  if (positions.length === 0 && mcp === null) return [];
  const connect = `${input.cli} connect --host codex`;
  const out: CodexFinding[] = [];

  out.push(
    input.codexOnPath === false
      ? { key: "codex.cli", severity: "amber", title: "Codex", detail: "Counterparts is wired into Codex's files, but there is no `codex` on PATH.", fix: "Install Codex (npm i -g @openai/codex), or disconnect it: counterparts disconnect --host codex", data: { onPath: false } }
      : {
          key: "codex.cli",
          severity: "green",
          title: "Codex",
          detail: `codex ${input.codexOnPath === null ? "(PATH not searched)" : "on PATH"}; home ${input.codexHome}. Its login is not checked here — \`codex login status\` can say logged in over an expired token; a 401 in a session means \`codex login\`.`,
          fix: "",
          data: { onPath: input.codexOnPath },
        },
  );

  // THE FOUR HOOKS, AND WHETHER THE PERSON APPROVED THEM (route i).
  const missing = CODEX_EVENTS.filter((e) => !positions.some((p) => p.event === e.event)).map((e) => e.event);
  let realHooks = hooksPath;
  try {
    realHooks = realpathSync(hooksPath);
  } catch {
    /* the path as named */
  }
  const trust = trustOf(positions, hookStates(toml), [...new Set([hooksPath, realHooks])]);
  const unapproved = trust.filter((t) => t.state === "unapproved").map((t) => t.event);
  const disabled = trust.filter((t) => t.state === "disabled").map((t) => t.event);
  if (missing.length > 0) {
    out.push({ key: "codex.hooks", severity: "amber", title: "Codex hooks", detail: `Missing from ${hooksPath}: ${missing.join(", ")}.`, fix: connect, data: { missing: missing.length } });
  } else if (unapproved.length > 0 || disabled.length > 0) {
    out.push({
      key: "codex.hooks",
      severity: "amber",
      title: "Codex hooks",
      detail: `${unapproved.length > 0 ? `Not approved yet: ${unapproved.join(", ")}` : ""}${unapproved.length > 0 && disabled.length > 0 ? "; " : ""}${disabled.length > 0 ? `switched off in Codex: ${disabled.join(", ")}` : ""}. Codex skips a hook until it is approved, so there is no wake, recall or capture there yet.`,
      fix: "Start Codex, type /hooks, approve the Counterparts hooks, then restart Codex",
      data: { unapproved: unapproved.length, disabled: disabled.length },
    });
  } else {
    out.push({
      key: "codex.hooks",
      severity: "green",
      title: "Codex hooks",
      detail: "All four approved in Codex (SessionStart, UserPromptSubmit, Stop, SessionEnd). Codex asks again if an update changes their command.",
      fix: "",
      data: { approved: positions.length },
    });
  }

  // THE MCP SERVER, told it serves Codex.
  if (mcp === null) {
    out.push({ key: "codex.mcp", severity: "amber", title: "Codex MCP", detail: `No [mcp_servers.counterparts] in ${tomlPath}: the hooks run, the memory tools don't.`, fix: connect, data: { present: false } });
  } else {
    const args = mcp["args"] ?? "";
    const host = /"--host"\s*,\s*"codex"/.test(args);
    out.push(
      host
        ? { key: "codex.mcp", severity: "green", title: "Codex MCP", detail: `counterparts in ${tomlPath}, serving Codex.`, fix: "", data: { present: true } }
        : { key: "codex.mcp", severity: "amber", title: "Codex MCP", detail: `counterparts in ${tomlPath} is not launched with --host codex, so it serves as if Codex's model were the counterpart.`, fix: connect, data: { present: true, host: false } },
    );
  }

  // CODEX'S OWN MEMORY, which would disagree with this one.
  if (codexMemoriesOn(toml)) {
    out.push({
      key: "codex.memories",
      severity: "amber",
      title: "Codex memories",
      detail: "Codex's own memories feature is on: two memories of the same conversations would disagree.",
      fix: `Turn it off: set memories = false under [features] in ${tomlPath}`,
      data: { on: true },
    });
  }

  // THE NEWEST TRANSCRIPT, READ AS THE STOP HOOK READS IT.
  const newest = newestRollout(input.codexHome);
  if (newest !== null) {
    const t = readCodexTranscript(newest);
    out.push(
      t.ok
        ? { key: "codex.transcript", severity: "green", title: "Codex transcript", detail: `The newest session's transcript reads: ${String(t.turns.length)} turns${t.corrupt > 0 ? `, ${String(t.corrupt)} unreadable lines` : ""}.`, fix: "", data: { turns: t.turns.length, corrupt: t.corrupt } }
        : { key: "codex.transcript", severity: "amber", title: "Codex transcript", detail: `The newest session's transcript would not read (${newest}): capture at Stop reads it.`, fix: "Check its permissions; if Codex has moved transcripts elsewhere, this build cannot capture them", data: { ok: false } },
    );
  }
  return out;
}
