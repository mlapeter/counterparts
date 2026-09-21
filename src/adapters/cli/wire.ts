/**
 * `counterparts wire` / `counterparts unwire` — the host's two files, edited.
 *
 * **This is the riskiest code in the package, and the reason is one sentence:
 * every other command in this console writes files that belong to us, and this
 * one writes a file that belongs to somebody else.** `~/.claude/settings.json`
 * is a stranger's editor configuration. It may hold six other tools' hooks, a
 * permissions block, a model choice and an environment they spent an afternoon
 * on. Nothing here is allowed to cost them any of it.
 *
 * So the rules below are not style. Each one is a way this could destroy
 * something that is not ours:
 *
 *   1. **BACK UP FIRST, and say the path.** Before a byte changes, the file is
 *      copied to `settings.json.counterparts-backup-<UTC stamp>` beside itself,
 *      at the same mode. The path is printed. A person who does not like what
 *      happened has a file to put back, and knows its name without looking.
 *   2. **EVERY OTHER KEY, AND EVERY OTHER HOOK, SURVIVES.** The merge works on
 *      the INNER hook entry — `hooks[event][i].hooks[j]` — never on the event's
 *      array and never on the `hooks` object. Another tool's entry on
 *      `SessionStart` keeps its position, its `matcher`, its `timeout` and every
 *      key we have never heard of. Hooks on one event run in parallel; ours
 *      goes BESIDE theirs.
 *   3. **IDEMPOTENT, AND REPAIRING.** An entry whose command is already exactly
 *      ours is left alone and no backup is taken — running this twice is not an
 *      event. An entry that is RECOGNISABLY ours but names a different path (an
 *      old checkout, a `counterparts-hook` shim that is no longer on PATH) is
 *      REPLACED IN PLACE rather than duplicated, and the old command is printed.
 *      The recogniser is `install.ts#HOOK_COMMAND_MARK` — the same one `doctor`
 *      reads the host with, so the two surfaces cannot disagree about what
 *      counts as ours.
 *   4. **A FILE THIS CANNOT PARSE IS A REFUSAL.** Not a rewrite, not a rescue, not
 *      "start a fresh one". It prints the block to merge by hand and changes
 *      nothing. The same for a `hooks` key that is not an object and an event
 *      whose value is not an array: a shape we do not understand is a shape we
 *      do not edit.
 *   5. **THE WRITE IS ATOMIC, AND THROUGH A SYMLINK ONLY INTO THE HOME.** Temp
 *      file in the same directory, `rename(2)` onto the target — a kill in the
 *      middle leaves the old file whole, never a truncated one. A symlinked
 *      `settings.json` (a dotfiles repository, an ordinary arrangement) is
 *      written THROUGH to its target, so the link survives; a link pointing
 *      outside the home directory is refused rather than followed, because at
 *      that point this is editing a file in a place nobody said it could.
 *   6. **`~/.claude.json` IS NEVER WRITTEN BY US.** Claude Code owns that file's
 *      shape. The MCP registration goes through `claude mcp add`, which is the
 *      host's own door. We READ the file to decide whether to call it — reading
 *      is what `doctor` already does — and we shell out to change it.
 *
 * The one thing this file cannot do anything about is said out loud instead:
 * a Claude Code session that is already open. Measured 2026-09-21 — after
 * `settings.json` changes, an open session's hooks fire on its NEXT TURN, and
 * its MCP tools appear only after Claude Code is restarted. So the output says
 * exactly that, and counts the memory servers still running when it cheaply can.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

import { DATA_DIR_ENV, isWithin } from "../../core/store/index.js";
import { CONFIG_ENV } from "../config-path.js";
import type { Io } from "./commands.js";
import {
  BIN,
  HOOK_COMMAND_MARK,
  HOST_EVENTS,
  MCP_SCRIPT,
  MCP_SERVER_NAME,
  hookCommand,
  hostConfigBase,
  hostMcpFile,
  mcpCommand,
  settingsBlock,
} from "./install.js";
import { realpathDeep } from "./start-fresh.js";
import { confirm, ui } from "./ui.js";
import type { Ui, UiEnv } from "./ui.js";

// ── where the host keeps it ─────────────────────────────────────────────────

/** The user-scope settings file: the ONE this command writes. Project files
 *  (`.claude/settings.json` in a working directory) are read by `doctor` and
 *  never written here — wiring one project is not what anybody asked for. */
export function userSettingsPath(home: string, env: UiEnv): string {
  return join(hostConfigBase(home, env), ".claude", "settings.json");
}

/** The infix a backup wears. Named, because the test and the output share it. */
export const BACKUP_INFIX = "counterparts-backup";

/** `settings.json.counterparts-backup-2026-09-21T14-03-05Z`, beside the file.
 *  Colons are stripped: a filename with them is a filename some tools cannot
 *  handle, and this one exists to be copied back by hand. */
export function backupPath(path: string, now: number): string {
  const stamp = new Date(now).toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  return `${path}.${BACKUP_INFIX}-${stamp}`;
}

/** `~/…` for a path under the home directory — for the SHORT preview only.
 *  Everything this command actually does is reported in full. */
export function tilde(path: string, home: string): string {
  const h = resolve(home);
  return path === h ? "~" : isWithin(h, path) ? `~${path.slice(h.length)}` : path;
}

// ── reading the file, and every way it can be one we will not touch ─────────

export interface SettingsSight {
  /** The path as named — what the owner sees in their own dotfiles. */
  readonly named: string;
  /** Where a write actually lands: the link's target, or `named`. */
  readonly target: string;
  readonly symlink: boolean;
  readonly exists: boolean;
  /** The permission bits to give the file back, or null when there is none yet. */
  readonly mode: number | null;
  /** The parsed object. `{}` for a file that is not there. */
  readonly value: Record<string, unknown>;
  /** Why this file will not be edited, or null. */
  readonly refusal: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read `~/.claude/settings.json` and decide, before anything is planned,
 * whether this is a file we are willing to write.
 *
 * Five refusals, and each one is a shape whose meaning we would be guessing at:
 * a symlink out of the home, something that is not a regular file, bytes that
 * are not JSON, a top-level value that is not an object, and a `hooks` key that
 * is not an object. Guessing about any of them means rewriting somebody's
 * configuration into a shape they did not choose.
 */
export function sightSettings(named: string, home: string): SettingsSight {
  const absent: SettingsSight = {
    named,
    target: named,
    symlink: false,
    exists: false,
    mode: null,
    value: {},
    refusal: null,
  };
  let stat;
  try {
    stat = lstatSync(named);
  } catch {
    // Not there at all. `~/.claude/` may not exist either; wiring creates both.
    return absent;
  }

  let target = named;
  let symlink = false;
  if (stat.isSymbolicLink()) {
    symlink = true;
    target = realpathDeep(named);
    const realHome = realpathDeep(home);
    if (!isWithin(realHome, target) || target === realHome) {
      return {
        ...absent,
        target,
        symlink: true,
        exists: existsSync(target),
        refusal:
          `refused: ${named} is a symbolic link to ${target}, which is outside your home ` +
          `directory (${realHome}). Writing through it would edit a file somewhere nobody ` +
          "named, and replacing the link with a regular file would quietly detach whatever " +
          "manages it. Edit the target by hand, or point the link somewhere inside your home.",
      };
    }
    if (!existsSync(target)) {
      // A dangling link: the target is where the file WOULD live, and creating
      // it there is what the person who made the link asked for.
      return { ...absent, target, symlink: true };
    }
  }

  let real;
  try {
    real = statSync(target);
  } catch {
    return { ...absent, target, symlink, exists: false };
  }
  if (!real.isFile()) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      refusal:
        `refused: ${target} is not a regular file. This command edits the host's settings ` +
        "file; it will not guess at what else that name might be.",
    };
  }

  const mode = real.mode & 0o777;
  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      mode,
      refusal:
        `refused: ${target} exists and could not be read (${String((err as Error).message ?? err)}). ` +
        "Nothing was changed.",
    };
  }
  // AN EMPTY FILE IS NOT A BROKEN ONE. A `touch`ed settings.json parses as
  // nothing, and refusing it would send a reader to hand-merge a block into a
  // file with no content to merge it with.
  if (raw.trim().length === 0) {
    return { ...absent, target, symlink, exists: true, mode };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      mode,
      refusal:
        `refused: ${target} does not parse as JSON (${String((err as Error).message ?? err)}). ` +
        "This command will not rewrite a file it cannot read — the one there may hold every " +
        "other tool's configuration, and a fresh one written over it would lose all of it. " +
        "Fix the file, or merge the block below by hand.",
    };
  }
  if (!isRecord(parsed)) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      mode,
      refusal:
        `refused: ${target} parses, but its top level is ${Array.isArray(parsed) ? "an array" : `a ${typeof parsed}`} ` +
        "rather than an object. A settings file this command does not recognise is one it " +
        "does not edit.",
    };
  }
  const hooks = parsed["hooks"];
  if (hooks !== undefined && !isRecord(hooks)) {
    return {
      ...absent,
      target,
      symlink,
      exists: true,
      mode,
      value: parsed,
      refusal:
        `refused: the "hooks" key in ${target} is ${Array.isArray(hooks) ? "an array" : `a ${typeof hooks}`}, ` +
        "not an object of event names. Merging into a shape this command does not understand " +
        "is how a working configuration stops working.",
    };
  }
  if (isRecord(hooks)) {
    for (const event of HOST_EVENTS) {
      const entries = hooks[event];
      if (entries !== undefined && !Array.isArray(entries)) {
        return {
          ...absent,
          target,
          symlink,
          exists: true,
          mode,
          value: parsed,
          refusal:
            `refused: "hooks"."${event}" in ${target} is not an array. The host reads that key ` +
            "as a list of hook groups, and this command will not overwrite a value whose " +
            "meaning it cannot tell.",
        };
      }
    }
  }
  return { named, target, symlink, exists: true, mode, value: parsed, refusal: null };
}

// ── the merge ───────────────────────────────────────────────────────────────

export type HookChange = "added" | "replaced" | "kept" | "removed";

export interface EventChange {
  readonly event: string;
  readonly change: HookChange;
  /** The command that was there before a `replaced` or a `removed`. */
  readonly was?: string;
  /** Further entries of OURS on the same event, dropped rather than left as
   *  duplicates. A block pasted twice by hand is the ordinary cause. */
  readonly duplicatesRemoved: number;
}

export interface MergeResult {
  readonly value: Record<string, unknown>;
  readonly events: readonly EventChange[];
  /** True when the object differs from the one handed in. */
  readonly changed: boolean;
  /** How many hook entries belonging to ANYBODY ELSE were carried through
   *  untouched. Reported, because "your other hooks are still there" is the
   *  sentence a reader most wants evidence for. */
  readonly foreignKept: number;
}

/** Is this inner entry one of ours? The SAME test `doctor`'s `readHost` makes. */
function isOurs(entry: unknown): entry is Record<string, unknown> {
  if (!isRecord(entry)) return false;
  const command = entry["command"];
  return typeof command === "string" && HOOK_COMMAND_MARK.test(command);
}

/**
 * Merge (or remove) our hook on the five events, PURE over the settings object.
 *
 * Nothing here reads or writes a file, so the whole merge is provable against
 * literals — which is what the adversarial cases need: a foreign hook on the
 * same event, a stale path, a duplicate, an event we do not use, a `hooks` key
 * with other tools' events in it.
 *
 * `command` is the string a `wire` installs; `unwire` ignores it.
 */
export function mergeHooks(
  settings: Record<string, unknown>,
  command: string,
  direction: "wire" | "unwire",
): MergeResult {
  const next = structuredClone(settings) as Record<string, unknown>;
  const existing = next["hooks"];
  const hooks: Record<string, unknown> = isRecord(existing) ? existing : {};
  const events: EventChange[] = [];
  let foreignKept = 0;
  let changed = false;

  for (const event of HOST_EVENTS) {
    const raw = hooks[event];
    const groups: unknown[] = Array.isArray(raw) ? raw : [];
    const outGroups: unknown[] = [];
    let seen = 0;
    let was: string | undefined;
    let duplicates = 0;
    let touchedGroup = false;

    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) {
        // A group shaped in a way we do not read is carried through WHOLE. It
        // is not ours to interpret and not ours to drop.
        outGroups.push(group);
        continue;
      }
      const inner = group["hooks"] as unknown[];
      const kept: unknown[] = [];
      let innerTouched = false;
      for (const entry of inner) {
        if (!isOurs(entry)) {
          kept.push(entry);
          if (isRecord(entry) && typeof entry["command"] === "string") foreignKept += 1;
          continue;
        }
        seen += 1;
        if (direction === "unwire") {
          if (was === undefined) was = String(entry["command"]);
          innerTouched = true;
          continue;
        }
        if (seen === 1) {
          was = String(entry["command"]);
          if (was === command) {
            kept.push(entry);
          } else {
            // REPLACED IN PLACE: every other key on the entry — a `timeout`,
            // anything the host adds later — is carried with it.
            kept.push({ ...entry, command });
            innerTouched = true;
          }
          continue;
        }
        // A SECOND entry of ours on one event is a duplicate, not a second
        // wiring. Dropped, and counted, rather than rewritten to the same
        // string twice.
        duplicates += 1;
        innerTouched = true;
      }
      if (kept.length === 0) {
        // The group held nothing but ours; it goes with it rather than staying
        // as an empty `{ "hooks": [] }` the host would step over every session.
        touchedGroup = true;
        continue;
      }
      outGroups.push(innerTouched ? { ...group, hooks: kept } : group);
      if (innerTouched) touchedGroup = true;
    }

    if (direction === "wire") {
      if (seen === 0) {
        outGroups.push({ hooks: [{ type: "command", command }] });
        events.push({ event, change: "added", duplicatesRemoved: 0 });
        changed = true;
      } else if (was === command && duplicates === 0) {
        events.push({ event, change: "kept", duplicatesRemoved: 0 });
      } else {
        events.push({
          event,
          change: was === command ? "kept" : "replaced",
          ...(was === undefined ? {} : { was }),
          duplicatesRemoved: duplicates,
        });
        changed = true;
      }
      hooks[event] = outGroups;
      continue;
    }

    // ── unwire ──────────────────────────────────────────────────────────────
    if (seen > 0) {
      events.push({
        event,
        change: "removed",
        ...(was === undefined ? {} : { was }),
        duplicatesRemoved: Math.max(0, seen - 1),
      });
      changed = true;
    }
    if (outGroups.length === 0) {
      // The EVENT KEY goes when nothing is left on it — an empty array left
      // behind is our litter in somebody else's file.
      if (event in hooks) {
        delete hooks[event];
        if (seen === 0 && touchedGroup) changed = true;
      }
    } else if (seen > 0 || touchedGroup) {
      hooks[event] = outGroups;
    }
  }

  if (Object.keys(hooks).length === 0) {
    // And the `hooks` key itself goes when it holds nothing. On `wire` this is
    // unreachable — five events were just written into it.
    if ("hooks" in next) delete next["hooks"];
  } else {
    next["hooks"] = hooks;
  }
  return { value: next, events, changed, foreignKept };
}

// ── writing it ──────────────────────────────────────────────────────────────

/** Exactly the bytes a settings file is written with: two-space indentation and
 *  ONE trailing newline, which is what the host's own file carries and what
 *  every `git diff` of a dotfiles repository expects. */
export function settingsBytes(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface WriteOutcome {
  readonly backup: string | null;
  readonly error: string | null;
}

/**
 * Back up, then write atomically, keeping the file's mode.
 *
 * The temp file is minted in the SAME DIRECTORY, because `rename(2)` is atomic
 * within one filesystem and `EXDEV` across two — a temp file in `$TMPDIR` would
 * make this a copy, and a copy interrupted halfway is a truncated
 * `settings.json` on somebody's machine.
 */
export function writeSettings(
  sight: SettingsSight,
  value: Record<string, unknown>,
  now: number,
): WriteOutcome {
  const target = sight.target;
  const dir = dirname(target);
  let backup: string | null = null;
  let temp: string | null = null;
  try {
    mkdirSync(dir, { recursive: true });
    if (sight.exists) {
      backup = backupPath(target, now);
      copyFileSync(target, backup);
      // A backup of a 0600 file must not be world-readable because `copyFile`
      // took the umask's word for it.
      if (sight.mode !== null) chmodSync(backup, sight.mode);
    }
    temp = join(dir, `.counterparts-wire-${String(process.pid)}-${String(now)}.tmp`);
    const mode = sight.mode ?? 0o644;
    writeFileSync(temp, settingsBytes(value), { mode });
    chmodSync(temp, mode);
    renameSync(temp, target);
    return { backup, error: null };
  } catch (err) {
    if (temp !== null) {
      try {
        rmSync(temp, { force: true });
      } catch {
        /* a temp file we could not remove is litter, not a second failure */
      }
    }
    return { backup, error: String((err as Error).message ?? err) };
  }
}

// ── the MCP registration (the host's own door) ──────────────────────────────

export interface SpawnResult {
  /** The binary is not on PATH at all. */
  readonly missing: boolean;
  readonly code: number | null;
  readonly out: string;
  readonly err: string;
}

/** `claude <args>`, run and waited for. Injected everywhere, so no test ever
 *  runs the real binary (and no test needs one installed). */
export type Spawner = (args: readonly string[]) => SpawnResult;

export const CLAUDE_BIN = "claude";
/** Long enough for a cold `claude mcp add`, short enough that a wedged binary
 *  does not hold an install open forever. */
export const CLAUDE_TIMEOUT_MS = 30_000;

export function realSpawner(env: Record<string, string | undefined>): Spawner {
  return (args) => {
    // ARGUMENTS, NEVER A SHELL STRING. The store path and the config path come
    // from a file on disk and can hold anything at all; a shell would interpret
    // it. `spawnSync` with an array passes each one through whole.
    const res = spawnSync(CLAUDE_BIN, [...args], {
      encoding: "utf8",
      timeout: CLAUDE_TIMEOUT_MS,
      windowsHide: true,
      // Passed rather than inherited for the reason `doctor.ts` gives: under bun
      // a `spawnSync` with no `env` resolves the binary against the REAL
      // environment, so a caller's PATH would be ignored.
      env: env as NodeJS.ProcessEnv,
    });
    if (res.error !== undefined && res.error !== null) {
      const code = (res.error as NodeJS.ErrnoException).code ?? "";
      return {
        missing: code === "ENOENT",
        code: null,
        out: String(res.stdout ?? ""),
        err: code === "ENOENT" ? "" : String((res.error as Error).message),
      };
    }
    return {
      missing: false,
      code: res.status,
      out: String(res.stdout ?? ""),
      err: String(res.stderr ?? ""),
    };
  };
}

/** The `claude mcp add` argument vector — the array form of `install.ts`'s
 *  printed line, so the two cannot name different stores or scripts. */
export function mcpAddArgs(
  store: string,
  custom: string | undefined,
  exe: string,
  serve: string = MCP_SCRIPT,
): string[] {
  return [
    "mcp",
    "add",
    MCP_SERVER_NAME,
    "-s",
    "user",
    "-e",
    `${DATA_DIR_ENV}=${store}`,
    ...(custom === undefined || custom.length === 0 ? [] : ["-e", `${CONFIG_ENV}=${custom}`]),
    "--",
    exe,
    "run",
    serve,
  ];
}

export function mcpRemoveArgs(): string[] {
  return ["mcp", "remove", MCP_SERVER_NAME, "-s", "user"];
}

export interface McpReading {
  readonly file: string;
  readonly present: boolean;
  /** Present AND pointing at this store with this runtime and this script. */
  readonly matches: boolean;
  /** True when the file exists and could not be read — a different fact from
   *  "no registration", and the one that must not read as "not installed". */
  readonly unreadable: boolean;
}

/**
 * What `~/.claude.json` says about our server. READ-ONLY, always: this file is
 * the host's own state and only `claude mcp` writes it.
 */
export function readMcp(
  home: string,
  env: UiEnv,
  store: string,
  custom: string | undefined,
  exe: string,
  serve: string = MCP_SCRIPT,
): McpReading {
  const file = hostMcpFile(hostConfigBase(home, env));
  if (!existsSync(file)) return { file, present: false, matches: false, unreadable: false };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { file, present: false, matches: false, unreadable: true };
  }
  if (!isRecord(raw)) return { file, present: false, matches: false, unreadable: true };
  const servers = raw["mcpServers"];
  if (!isRecord(servers)) return { file, present: false, matches: false, unreadable: false };
  const entry = servers[MCP_SERVER_NAME];
  if (!isRecord(entry)) return { file, present: false, matches: false, unreadable: false };
  const args = entry["args"];
  const serverEnv = entry["env"];
  const matches =
    entry["command"] === exe &&
    Array.isArray(args) &&
    args.length === 2 &&
    args[0] === "run" &&
    args[1] === serve &&
    isRecord(serverEnv) &&
    serverEnv[DATA_DIR_ENV] === store &&
    (custom === undefined || custom.length === 0
      ? serverEnv[CONFIG_ENV] === undefined
      : serverEnv[CONFIG_ENV] === custom);
  return { file, present: true, matches, unreadable: false };
}

// ── who is still running ────────────────────────────────────────────────────

export interface RunningProcess {
  readonly pid: number;
  /** In the words the output uses: "an MCP server", "the worker", "a dashboard". */
  readonly what: string;
  readonly command: string;
}

export type ProcessLister = () => readonly RunningProcess[];

/**
 * The command lines that mean one of OURS is running, and NOTHING that merely
 * mentions the name.
 *
 * `pgrep -f counterparts` matches an editor with this repository open, a `tail`
 * on a log, a dev server in a directory with the word in its path — the very
 * warning `start-fresh` prints. So the needles here are the SCRIPTS, path
 * segment included, plus the two installed shims anchored at a boundary.
 */
const PROCESS_MARKS: readonly { readonly re: RegExp; readonly what: string }[] = [
  { re: /mcp[/\\]bin[/\\]serve\.ts/, what: "an MCP server" },
  { re: /(^|[\s"'/\\])counterparts-mcp(\s|$|")/, what: "an MCP server" },
  { re: /claude-code[/\\]bin[/\\]runner\.ts/, what: "the worker" },
  { re: /dashboard[/\\]bin[/\\]dashboard\.ts/, what: "a dashboard" },
  { re: /(^|[\s"'/\\])counterparts-dashboard(\s|$|")/, what: "a dashboard" },
];

/** Which of ours, if any, this command line is. Exported for the test, which
 *  proves the false positives stay false. */
export function processMark(command: string): string | null {
  for (const mark of PROCESS_MARKS) {
    if (mark.re.test(command)) return mark.what;
  }
  return null;
}

/**
 * `ps -axo pid=,command=`, filtered here rather than by `pgrep -f`.
 *
 * **It never throws and it never fails the caller.** A machine with no `ps`, a
 * `ps` that times out, a sandbox that refuses process listing — every one of
 * them answers "I could not see any", and every caller treats that as no
 * evidence rather than as evidence of absence. This is a courtesy, not a guard.
 */
export function realProcessLister(env: Record<string, string | undefined>): ProcessLister {
  return () => {
    try {
      const res = spawnSync("ps", ["-axo", "pid=,command="], {
        encoding: "utf8",
        timeout: 4000,
        windowsHide: true,
        env: env as NodeJS.ProcessEnv,
      });
      if (res.error !== undefined && res.error !== null) return [];
      const out: RunningProcess[] = [];
      for (const line of String(res.stdout ?? "").split("\n")) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (m === null) continue;
        const pid = Number(m[1]);
        const command = m[2] ?? "";
        if (pid === process.pid) continue;
        const what = processMark(command);
        if (what === null) continue;
        out.push({ pid, what, command });
      }
      return out;
    } catch {
      return [];
    }
  };
}

/** Only the MCP servers, which is what "restart your sessions" is about. */
export function runningServers(lister: ProcessLister): readonly RunningProcess[] {
  try {
    return lister().filter((p) => p.what === "an MCP server");
  } catch {
    return [];
  }
}

// ── the command ─────────────────────────────────────────────────────────────

export type Outcome = "ok" | "refused" | "failed";

export interface WireInput {
  readonly io: Io;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  /** The host configuration this install uses — its path decides `--config`. */
  readonly configPath: string;
  /** That path again, but only when it is NOT the default one: the hooks and
   *  the server then have to carry it (`install.ts#hookCommand`). */
  readonly custom: string | undefined;
  /** `dataDir` — the store the MCP server is told to open. */
  readonly store: string;
  readonly now: number;
  readonly yes: boolean;
  readonly dryRun: boolean;
  /** `process.execPath` in a real run; a fixed string in a test. */
  readonly exe: string;
  readonly spawner: Spawner;
  readonly lister: ProcessLister;
  /** `install` prints its own step heading; a bare `wire` prints one here. */
  readonly heading?: boolean;
}

export interface WireResult {
  readonly outcome: Outcome;
  /** What happened to the five hooks, in one word for the caller's summary. */
  readonly hooks: "wired" | "repaired" | "already" | "declined" | "refused" | "removed" | "none";
  readonly mcp: "added" | "re-added" | "already" | "printed" | "removed" | "absent" | "skipped";
  readonly backup: string | null;
}

/** The SHORT preview — two lines, never the JSON. The block is what `install`
 *  prints when it is not allowed to apply it; a person about to say yes wants
 *  the shape of the change, not sixty lines of it. */
function preview(u: Ui, sight: SettingsSight, home: string, mcpWord: string): void {
  u.hint(
    `${String(HOST_EVENTS.length)} hooks -> ${tilde(sight.target, home)}` +
      (sight.exists ? " (backup first)" : " (new file)"),
  );
  u.hint(`1 MCP server -> ${mcpWord}`);
}

/**
 * `counterparts wire` — put the five hooks in the host's settings and register
 * the MCP server.
 *
 * The order is deliberate: the hooks FIRST, because they are the half this
 * package can do by itself and the half that works without a restart; the MCP
 * registration second, because it goes through another program that may not be
 * there. A missing `claude` is not a failure — it is one printed line and a
 * zero exit.
 */
export async function wire(input: WireInput): Promise<WireResult> {
  const { io, env, home, now } = input;
  const u = ui(io, env);
  const named = userSettingsPath(home, env);
  const sight = sightSettings(named, home);
  const command = hookCommand(input.custom, input.exe);

  if (input.heading !== false) {
    u.heading("Wiring Claude Code");
  }

  if (sight.refusal !== null) {
    io.err(sight.refusal);
    io.err("");
    io.err("Nothing was changed. The block to merge by hand, under a top-level \"hooks\" key:");
    for (const line of settingsBlock(command).split("\n")) io.err(`  ${line}`);
    return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null };
  }

  const merged = mergeHooks(sight.value, command, "wire");
  const mcp = readMcp(home, env, input.store, input.custom, input.exe);
  const mcpNeeded = !mcp.matches;

  // ── nothing to do ─────────────────────────────────────────────────────────
  if (!merged.changed && !mcpNeeded) {
    u.ok(`already wired — all ${String(HOST_EVENTS.length)} hooks and the MCP server are in place.`);
    u.hint(`hooks: ${sight.target}`);
    u.hint(`MCP:   ${mcp.file} (registered as "${MCP_SERVER_NAME}")`);
    u.hint("Nothing was changed and no backup was taken.");
    return { outcome: "ok", hooks: "already", mcp: "already", backup: null };
  }

  // ── say what would change ─────────────────────────────────────────────────
  const replacing = merged.events.filter((e) => e.change === "replaced");
  if (input.dryRun) {
    u.hint("dry run — nothing below has been written.");
  }
  preview(
    u,
    sight,
    home,
    mcp.present
      ? mcp.matches
        ? "already registered"
        : "re-registered via `claude mcp add`"
      : "via `claude mcp add`",
  );
  for (const e of replacing) {
    u.hint(`${e.event}: replacing a Counterparts hook that names ${e.was ?? "another path"}`);
  }
  for (const e of merged.events) {
    if (e.duplicatesRemoved > 0) {
      u.hint(`${e.event}: dropping ${String(e.duplicatesRemoved)} duplicate entr${e.duplicatesRemoved === 1 ? "y" : "ies"} of ours`);
    }
  }
  if (merged.foreignKept > 0) {
    u.hint(
      `${String(merged.foreignKept)} hook${merged.foreignKept === 1 ? "" : "s"} belonging to something else stay exactly where they are.`,
    );
  }

  if (input.dryRun) {
    u.hint("Dry run: nothing was written and nothing was registered.");
    return { outcome: "ok", hooks: "declined", mcp: "skipped", backup: null };
  }

  // ── ask ───────────────────────────────────────────────────────────────────
  //
  // A console with NO prompt at all is a pipe, a CI job or a test. It is not
  // asked and it is not wired: `install` prints the blocks there, exactly as it
  // has since day one, and `wire` says which flag means yes.
  if (!input.yes) {
    if (io.prompt === undefined) {
      io.err(
        "refused: this is not an interactive console, so nothing was asked and nothing was " +
          "wired. Pass --yes to wire without being asked, or run `counterparts install` at a " +
          "terminal, where it asks first.",
      );
      return { outcome: "refused", hooks: "declined", mcp: "skipped", backup: null };
    }
    const go = await confirm(io, "Wire Claude Code now?", { default: true });
    if (!go) {
      u.hint("Not wired. Nothing was changed.");
      u.hint(`You can do it later with: ${BIN.cli} wire`);
      return { outcome: "ok", hooks: "declined", mcp: "skipped", backup: null };
    }
  }

  // ── the hooks ─────────────────────────────────────────────────────────────
  let backup: string | null = null;
  let hooksWord: WireResult["hooks"] = "already";
  if (merged.changed) {
    // RE-READ BEFORE WRITING (commands.ts rule 2): between the preview and the
    // answer the file may have changed — another tool's installer, an editor
    // saving. The plan is re-made against what is there NOW, and a file that
    // has become unreadable in the meantime refuses rather than gets rewritten.
    const fresh = sightSettings(named, home);
    if (fresh.refusal !== null) {
      io.err(`refused after re-reading the file: ${fresh.refusal}`);
      return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null };
    }
    const again = mergeHooks(fresh.value, command, "wire");
    const wrote = writeSettings(fresh, again.value, now);
    backup = wrote.backup;
    if (wrote.error !== null) {
      io.err(`failed to write ${fresh.target}: ${wrote.error}`);
      io.err(
        wrote.backup === null
          ? "Nothing was changed."
          : `Nothing was changed; the backup taken first is at ${wrote.backup}.`,
      );
      return { outcome: "failed", hooks: "refused", mcp: "skipped", backup };
    }
    hooksWord = again.events.some((e) => e.change === "replaced") ? "repaired" : "wired";
    if (backup !== null) u.hint(`backed up: ${backup}`);
    u.ok(
      `${String(HOST_EVENTS.length)} hooks ${hooksWord === "repaired" ? "repaired in" : "written to"} ${fresh.target}`,
    );
  } else {
    u.ok(`the ${String(HOST_EVENTS.length)} hooks were already in ${sight.target}; nothing changed.`);
  }

  // ── the MCP server ────────────────────────────────────────────────────────
  const mcpWord = registerMcp(input, u, mcp);

  // ── the sentence about sessions that are open right now ───────────────────
  sessionsNote(u, input.lister);
  return { outcome: "ok", hooks: hooksWord, mcp: mcpWord, backup };
}

/**
 * Register the server through `claude mcp add`, or print the line.
 *
 * Three ways this can go, and none of them is a failure of the install:
 * registered; already registered at the same store and script; or `claude` is
 * not on this PATH, in which case the line is printed for the person and the
 * command still exits 0 — the hooks are in, and they are the half that works.
 */
function registerMcp(input: WireInput, u: Ui, mcp: McpReading): WireResult["mcp"] {
  const line = mcpCommand(input.store, undefined, input.custom);
  if (mcp.matches) {
    u.ok(`the MCP server is already registered as "${MCP_SERVER_NAME}" at this store.`);
    return "already";
  }
  const add = (): SpawnResult => input.spawner(mcpAddArgs(input.store, input.custom, input.exe));
  let res = add();
  if (res.missing) {
    u.warn("`claude` is not on this PATH, so the MCP server was not registered.");
    u.hint("The hooks are in. Run this one line yourself, then restart Claude Code:");
    u.hint(`  ${line}`);
    return "printed";
  }
  let word: WireResult["mcp"] = "added";
  // ALREADY THERE, IN ONE FORM OR ANOTHER. Either our own read saw a
  // registration that does not match, or `claude` says the name is taken — the
  // two are the same situation seen from two sides, and the answer is the same:
  // remove the old one and add this one, out loud.
  const taken = /already exist|already configured|already added/i.test(`${res.out}\n${res.err}`);
  if (res.code !== 0 && (mcp.present || taken)) {
    u.hint(`a server named "${MCP_SERVER_NAME}" was already registered; replacing it.`);
    input.spawner(mcpRemoveArgs());
    res = add();
    word = "re-added";
  } else if (res.code === 0 && mcp.present) {
    word = "re-added";
  }
  if (res.code !== 0) {
    u.warn(`\`claude mcp add\` exited ${String(res.code ?? -1)}; the server may not be registered.`);
    const detail = `${res.err}${res.out}`.trim();
    if (detail.length > 0) for (const l of detail.split("\n").slice(0, 4)) u.hint(l);
    u.hint("Run this yourself, then restart Claude Code:");
    u.hint(`  ${line}`);
    return "printed";
  }
  u.ok(
    word === "re-added"
      ? `the MCP server was re-registered as "${MCP_SERVER_NAME}" at ${input.store}`
      : `the MCP server is registered as "${MCP_SERVER_NAME}" at ${input.store}`,
  );
  return word;
}

/**
 * WHAT AN OPEN SESSION DOES NOW — the owner asked for this by name.
 *
 * Measured on 2026-09-21: after `settings.json` changes, an ALREADY OPEN
 * session's hooks fire from its next turn, but its MCP tools do not appear
 * until Claude Code is restarted (a server keeps the code and the registration
 * it was launched with). Both halves are said, because a person who reads only
 * the first will wonder why `note` is missing.
 */
export function sessionsNote(u: Ui, lister: ProcessLister): void {
  u.hint("Hooks start with your next turn in any open Claude Code session.");
  u.hint("The memory tools appear after you restart Claude Code.");
  const running = runningServers(lister);
  if (running.length > 0) {
    u.hint(
      `(${String(running.length)} session${running.length === 1 ? " is" : "s are"} running the ` +
        "previous version's memory server — restart them.)",
    );
  }
}

/**
 * `counterparts unwire` — take OUR hooks out and deregister the server.
 *
 * It removes only what the recogniser calls ours, and it is the same recogniser
 * `wire`'s repair uses, so a hook this command leaves behind is one `wire` would
 * also have left behind. Nothing belonging to another tool is read as a
 * candidate at any point.
 */
export async function unwire(input: WireInput): Promise<WireResult> {
  const { io, env, home, now } = input;
  const u = ui(io, env);
  const named = userSettingsPath(home, env);
  const sight = sightSettings(named, home);

  if (input.heading !== false) u.heading("Unwiring Claude Code");

  if (sight.refusal !== null) {
    io.err(sight.refusal);
    io.err("Nothing was changed. Remove the Counterparts hook entries by hand.");
    return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null };
  }

  const merged = mergeHooks(sight.value, "", "unwire");
  const mcp = readMcp(home, env, input.store, input.custom, input.exe);

  if (!merged.changed && !mcp.present) {
    u.ok("nothing to unwire: no Counterparts hooks and no MCP registration were found.");
    u.hint(`looked in: ${sight.target}`);
    u.hint(`and in:    ${mcp.file}`);
    return { outcome: "ok", hooks: "none", mcp: "absent", backup: null };
  }

  if (input.dryRun) {
    u.hint("dry run — nothing below has been written.");
    for (const e of merged.events) u.hint(`${e.event}: would remove ${e.was ?? "our hook"}`);
    u.hint(`would run: claude mcp remove ${MCP_SERVER_NAME} -s user`);
    if (merged.foreignKept > 0) {
      u.hint(`${String(merged.foreignKept)} hook${merged.foreignKept === 1 ? "" : "s"} belonging to something else would stay.`);
    }
    return { outcome: "ok", hooks: "none", mcp: "skipped", backup: null };
  }

  if (!input.yes) {
    if (io.prompt === undefined) {
      io.err(
        "refused: this is not an interactive console and nothing was confirmed. Pass --yes if " +
          "that is what you mean.",
      );
      return { outcome: "refused", hooks: "none", mcp: "skipped", backup: null };
    }
    preview(u, sight, home, `removed via \`claude mcp remove\``);
    const go = await confirm(io, "Remove the Counterparts hooks and the MCP server?", {
      default: true,
    });
    if (!go) {
      u.hint("Nothing was changed.");
      return { outcome: "ok", hooks: "declined", mcp: "skipped", backup: null };
    }
  }

  let backup: string | null = null;
  let hooksWord: WireResult["hooks"] = "none";
  if (merged.changed) {
    const fresh = sightSettings(named, home);
    if (fresh.refusal !== null) {
      io.err(`refused after re-reading the file: ${fresh.refusal}`);
      return { outcome: "refused", hooks: "refused", mcp: "skipped", backup: null };
    }
    const again = mergeHooks(fresh.value, "", "unwire");
    const wrote = writeSettings(fresh, again.value, now);
    backup = wrote.backup;
    if (wrote.error !== null) {
      io.err(`failed to write ${fresh.target}: ${wrote.error}`);
      io.err(backup === null ? "Nothing was changed." : `The backup taken first is at ${backup}.`);
      return { outcome: "failed", hooks: "refused", mcp: "skipped", backup };
    }
    hooksWord = "removed";
    if (backup !== null) u.hint(`backed up: ${backup}`);
    u.ok(
      `${String(again.events.length)} Counterparts hook${again.events.length === 1 ? "" : "s"} removed from ${fresh.target}`,
    );
    if (again.foreignKept > 0) {
      u.hint(
        `${String(again.foreignKept)} hook${again.foreignKept === 1 ? "" : "s"} belonging to something else were left exactly as they were.`,
      );
    }
  } else {
    u.ok(`no Counterparts hooks were in ${sight.target}.`);
  }

  // THE REMOVE IS ATTEMPTED WHETHER OR NOT OUR READ SAW A REGISTRATION.
  //
  // `~/.claude.json` is the host's own state file — its documentation says so,
  // and `install.ts#hostMcpFile` already warns that it may move. Our read is
  // therefore evidence, not authority: a registration we cannot see is still a
  // registration, and an unwire that skipped the removal because of where it
  // looked would leave a server pointed at a store nobody is wiring any more.
  // Removing what is not there costs one exit code, which is why the brief says
  // "tolerate not found".
  let mcpWord: WireResult["mcp"] = "absent";
  const res = input.spawner(mcpRemoveArgs());
  const notThere = /not found|no .*server|does not exist|not configured/i.test(`${res.out}\n${res.err}`);
  if (res.missing) {
    u.warn("`claude` is not on this PATH, so the MCP server was not deregistered.");
    u.hint(`Run it yourself: claude mcp remove ${MCP_SERVER_NAME} -s user`);
    mcpWord = "printed";
  } else if (res.code === 0) {
    u.ok(`the MCP server "${MCP_SERVER_NAME}" is no longer registered.`);
    mcpWord = "removed";
  } else if (notThere || !mcp.present) {
    u.hint(`no MCP registration named "${MCP_SERVER_NAME}" was there to remove.`);
    mcpWord = "absent";
  } else {
    u.warn(`\`claude mcp remove\` exited ${String(res.code ?? -1)}.`);
    u.hint(`Run it yourself: claude mcp remove ${MCP_SERVER_NAME} -s user`);
    mcpWord = "printed";
  }

  u.hint("An open Claude Code session keeps its hooks until its next turn, and keeps");
  u.hint("its memory server until you close it.");
  return { outcome: "ok", hooks: hooksWord, mcp: mcpWord, backup };
}

