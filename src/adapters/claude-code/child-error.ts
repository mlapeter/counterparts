/**
 * WHY A NIGHT CHILD FAILED, IN ONE SHORT LINE (2026-10-27, R4).
 *
 * Night run nrn_8f332b7d176d (10-27) failed: every child exited 1 in a few
 * seconds with no tokens, and the row said only "claude exited with an error
 * (exit 1)". The children run with `--no-session-persistence`, so there is no
 * transcript, and nothing of what the host said was kept: the cause was
 * unrecoverable. (It was a sign-in lost mid-run — the owner switched Claude
 * Code accounts.)
 *
 * What a failed child said is read from what is ALREADY read of it, no new
 * flag: its own `stream-json` `result` line when its output is kept (the
 * night's named children), else the last line of its STDERR (every child).
 * Measured on 2.1.311 with no sign-in: `claude -p` writes
 * `Not logged in · Please run /login` to STDOUT (a `result` line with
 * `is_error: true`, `subtype: "success"`, `terminal_reason: "api_error"`
 * under `stream-json`; the bare line in text mode) and nothing to STDERR; an
 * unknown flag goes to STDERR (`error: unknown option '--x'`).
 *
 * The line is bounded (`CHILD_ERROR_MAX`), one line, and SCRUBBED by shape,
 * not by known names: any long run of key-ish characters with a digit in it,
 * and whatever follows a `token`/`key`/`secret`/`bearer`… label, becomes
 * `[redacted]`. Only the `result` text of a result that IS an error is read —
 * never a successful result's prose, never a message, never the prompt.
 */
import type { ChildResult } from "./child.js";

/** **CAL.** The most of a failure's line kept, characters. */
export const CHILD_ERROR_MAX = 300;

const REDACTED = "[redacted]";

/**
 * SCRUB A LINE OF ANYTHING TOKEN- OR KEY-SHAPED, by pattern:
 *   - the value after a label that names a credential (`…token`, `…key`,
 *     `secret`, `password`, `authorization`, `cookie`) with `:` or `=`
 *     between, and the word after `Bearer`;
 *   - any run of 20+ characters from `[A-Za-z0-9_\-.+/=]` with a digit in it
 *     (API keys, OAuth and JWT tokens, request ids, long hashes);
 *   - anything `sk-…`-prefixed of 8+ characters.
 * Ordinary words, short numbers (`401`, `exit 1`) and punctuation stay.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(/\b(bearer)(\s+)[^\s"',;]{6,}/gi, (_m, label: string, sep: string) => `${label}${sep}${REDACTED}`)
    .replace(/\b([a-z_-]*(?:token|key|secret|password|passwd|authorization|cookie))(\s*[:=]\s*)("?)[^\s"',;]{4,}\3/gi, (_m, label: string, sep: string) => `${label}${sep}${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(/[A-Za-z0-9_\-.+/=]{20,}/g, (run) => (/\d/.test(run) ? REDACTED : run));
}

/** One line: control characters and ANSI codes out, whitespace collapsed, scrubbed, bounded. */
export function oneLine(text: string): string {
  const flat = text
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clean = scrubSecrets(flat);
  return clean.length <= CHILD_ERROR_MAX ? clean : `${clean.slice(0, CHILD_ERROR_MAX - 1).trimEnd()}…`;
}

/** The child's last `result` line, when it says it is an error: its reason and its text. */
function resultError(output: string | undefined): string | null {
  const lines = (output ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] as string;
    if (!line.includes('"result"')) continue;
    let o: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      o = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o["type"] !== "result") continue;
    // The LAST result decides: a successful one says nothing of a failure
    // (its text is the model's prose), and the STDERR line is read instead.
    const failed = o["is_error"] === true || (typeof o["subtype"] === "string" && o["subtype"] !== "success");
    if (!failed) return null;
    // `subtype` says `success` on an error result (2.1.311, signed out): no label then.
    const subtype = typeof o["subtype"] === "string" && o["subtype"].length > 0 && o["subtype"] !== "success" ? o["subtype"] : null;
    const why = typeof o["terminal_reason"] === "string" && o["terminal_reason"].length > 0 ? o["terminal_reason"] : (subtype ?? "error");
    const status = typeof o["api_error_status"] === "number" || (typeof o["api_error_status"] === "string" && o["api_error_status"].length > 0) ? ` ${String(o["api_error_status"])}` : "";
    const text = typeof o["result"] === "string" && o["result"].trim().length > 0 ? `: ${o["result"]}` : "";
    return `${String(why)}${status}${text}`;
  }
  return null;
}

/** The last non-empty line of the child's STDERR tail. */
function lastStderrLine(stderr: string | undefined): string | null {
  const lines = (stderr ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length === 0 ? null : (lines[lines.length - 1] as string);
}

/**
 * WHY THE CHILD FAILED, in one scrubbed line, or null: its `stream-json`
 * error result when its output was kept and ends in one, else the last line
 * of its STDERR. Null for a child that exited 0, was stopped by a watchdog,
 * or said nothing. Never throws.
 */
export function childErrorText(result: Pick<ChildResult, "code" | "timedOut" | "output" | "stderr">): string | null {
  try {
    if (result.timedOut || result.code === null || result.code === 0) return null;
    const raw = resultError(result.output) ?? lastStderrLine(result.stderr);
    if (raw === null) return null;
    const line = oneLine(raw);
    return line.length === 0 ? null : line;
  } catch {
    return null;
  }
}

/**
 * DOES A FAILURE READ AS A LOST SIGN-IN (2026-10-27, R4 addendum)? Loosely:
 * a 401, "not logged in", "/login", "authenticat…", "unauthorized", an
 * invalid API key, an OAuth token expired or revoked. An account switched in
 * the middle of a night run is the case that taught it (10-27).
 */
export function signedOutShaped(text: string | null | undefined): boolean {
  if (text === null || text === undefined || text.length === 0) return false;
  return /\b401\b|not logged in|logged out|\/login\b|authenticat|unauthori[sz]ed|invalid[ _-]?(x-)?api[ _-]?key|oauth|token[^.]{0,40}\b(expired|invalid|revoked)\b|(expired|invalid|revoked)\b[^.]{0,20}token/i.test(text);
}
