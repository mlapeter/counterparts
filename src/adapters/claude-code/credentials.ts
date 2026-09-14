/**
 * The credential file — the ONE file the package's own configuration names.
 *
 * MEASURED, day 0 of the parallel run: this host's hook processes carry neither
 * `ANTHROPIC_API_KEY` nor `VOYAGE_API_KEY`, even with both exported in the
 * owner's `~/.zshrc`. The host's process environment is not the login shell's.
 * A v2 that reads `process.env` and nothing else therefore never opens the
 * embedder, and its worker skips the crash-fallback sweep at every boundary:
 * the run is blind, and blind on day 0 is a run that measured nothing.
 *
 * Until 2026-09-11 the consequence was worse than blind — `planSpawn` refused
 * the whole spawn on the missing key, so an EMPTY file stopped the clock, the
 * sleep cycle and the day's ask cap as well (I32). The worker degrades one step
 * at a time now; this file is still the thing that keeps it from having to.
 *
 * §2.18 is also the FIX, not just the diagnosis. The scar says a guarantee
 * carried by something you don't own is not a guarantee, and the CONTRACT's
 * rule is "credentials come from one configured source the package owns". A
 * file whose PATH IS NAMED IN THIS PACKAGE'S OWN CONFIG is that source. v1's
 * `.env`-found-by-convention is not, and stays forbidden: convention means the
 * process's working directory decides which credential a run uses, which is the
 * same class of mistake as inheriting one from whatever shell launched it.
 *
 * The rules this file mechanizes:
 *
 *   - **The environment stays the FIRST source; the file fills the gap.** A
 *     name already answered in `env` is never overwritten — so an owner who
 *     does have the variable exported keeps exactly the behaviour they had, and
 *     the file cannot silently redirect a live session to another account.
 *   - **Only the two documented names are honored** (`API_KEY_ENV`,
 *     `EMBED_KEY_ENV`). Anything else in the file is ignored and COUNTED, so a
 *     file the owner filled with a third name reads as "1 ignored" rather than
 *     as a general-purpose env loader nobody bounded.
 *   - **Values are never logged, never emitted, never hashed.** Everything that
 *     leaves this module is a NAME or a COUNT. The only place a value goes is
 *     `env[name]`.
 *   - **It never throws.** An absent file is ordinary; an unreadable one is a
 *     named reason. Neither may fail a hook (CONTRACT §5 G2).
 */
import { readFileSync, statSync } from "node:fs";

import { API_KEY_ENV, EMBED_KEY_ENV } from "./config.js";

/**
 * The ONLY names this file honors. Two, because the package documents two — a
 * loader that honored whatever it found would be an inherited environment with
 * extra steps.
 */
export const CREDENTIAL_NAMES: readonly string[] = [API_KEY_ENV, EMBED_KEY_ENV];

/** The event the entry points emit when the file actually answered. */
export const CREDENTIAL_FILE_EVENT = "adapter.credentials.file";

export interface CredentialLoad {
  /** Names this load filled FROM THE FILE. Names only — never values. */
  readonly loaded: string[];
  /** Names the file offered and `env` had already answered. The env wins. */
  readonly skippedPresent: string[];
  /** Lines that produced no credential: foreign names, malformed lines, empty
   *  values, and repeats of a name already taken. Blank and `#` lines are not
   *  counted — they are not attempts at anything. */
  readonly ignoredLines: number;
  readonly reason: "absent" | "unreadable" | "loaded" | "not-configured";
  /** The file's permission bits, octal (e.g. `"600"`). Null when unread. */
  readonly mode: string | null;
  /** True when group or other may READ this file. Reported, never refused: it
   *  is the owner's machine and their call (§4 warn, do not refuse). */
  readonly permissive: boolean;
}

const nothing = (reason: CredentialLoad["reason"]): CredentialLoad => ({
  loaded: [],
  skippedPresent: [],
  ignoredLines: 0,
  reason,
  mode: null,
  permissive: false,
});

/** Present means NON-EMPTY, the same test every reader of these two names makes
 *  (`interpret-client`, `embed-client`, `planSpawn` all `.trim()`). An exported
 *  but empty variable is a gap the file may fill, not an answer. */
function answered(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/**
 * Strip one layer of matching quotes, tolerating the shapes a human actually
 * writes: `KEY=v`, `KEY="v"`, `KEY='v'`, `export KEY=v`, and any of them with a
 * CR still attached from a CRLF file.
 */
function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && last === first) return value.slice(1, -1);
  return value;
}

/**
 * Read the configured credential file and fill the gaps in `env`.
 *
 * Pure over the injected environment: it mutates `env` for the two documented
 * names and touches nothing else, so a test hands it `{}` and reads the result
 * rather than the process.
 */
export function loadCredentials(
  path: string | undefined,
  env: NodeJS.ProcessEnv,
): CredentialLoad {
  if (path === undefined || path.trim().length === 0) return nothing("not-configured");

  let text: string;
  let mode: string | null = null;
  let permissive = false;
  try {
    const stat = statSync(path);
    mode = (stat.mode & 0o777).toString(8).padStart(3, "0");
    permissive = (stat.mode & 0o077) !== 0;
    text = readFileSync(path, "utf8");
  } catch (err) {
    // ENOENT is ORDINARY — an owner who exports the variables configures no
    // file and never sees this. Anything else (a directory, a permission
    // error, a device) is a different record: "we looked and could not read".
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "";
    return { ...nothing(code === "ENOENT" ? "absent" : "unreadable"), mode, permissive };
  }

  const loaded: string[] = [];
  const skippedPresent: string[] = [];
  let ignoredLines = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) {
      ignoredLines += 1;
      continue;
    }
    const name = body.slice(0, eq).trim();
    const value = unquote(body.slice(eq + 1));
    if (!CREDENTIAL_NAMES.includes(name)) {
      // The bound, made countable: a third name in the file is not honored, and
      // the count is how the owner sees that it was not.
      ignoredLines += 1;
      continue;
    }
    if (value.length === 0 || loaded.includes(name) || skippedPresent.includes(name)) {
      // An empty value is not a credential (writing `""` would make the
      // capability row say "reported" of nothing), and the FIRST occurrence of
      // a name wins — a second line for the same name is ignored and counted.
      ignoredLines += 1;
      continue;
    }
    if (answered(env[name])) {
      // THE ENVIRONMENT WINS. The file fills gaps; it never redirects a session
      // whose credential was already answered.
      skippedPresent.push(name);
      continue;
    }
    env[name] = value;
    loaded.push(name);
  }

  return { loaded, skippedPresent, ignoredLines, reason: "loaded", mode, permissive };
}

/**
 * The one line a process says about a credential file, for the ring and for
 * stderr. NAMES AND COUNTS ONLY — this string is emitted, so nothing that could
 * carry a value may enter it.
 */
export function credentialRow(load: CredentialLoad): Record<string, string | number | boolean> {
  return {
    reason: load.reason,
    loaded: load.loaded.join(","),
    skipped: load.skippedPresent.join(","),
    ignoredLines: load.ignoredLines,
    mode: load.mode ?? "",
    permissive: load.permissive,
  };
}

/**
 * The permission warning, or null. A file the group or the world can read is
 * WARNED about by name and mode and never refused: it is the owner's machine,
 * and a refusal here would be this package deciding a security policy for them
 * (CONTRACT §5 G2 — and a throw would fail the host besides).
 */
export function permissionWarning(path: string | undefined, load: CredentialLoad): string | null {
  if (!load.permissive || load.mode === null || path === undefined) return null;
  return `[counterparts] credentials file is group/other-readable (mode ${load.mode}): ${path}`;
}
