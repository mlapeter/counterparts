/**
 * HOST MODE — the nightly page writer as a windowless session of the self.
 *
 * The owner's pick for S2 (spec §15 item 10, plan §3): once a night the
 * boundary's worker starts a real host session with no window, `claude -p`, so
 * the ordinary SessionStart hook fires inside it and the writer wakes with the
 * wake — the same bundle a live session gets, page first. It is handed the day
 * just gone as its prompt and exactly ONE pre-approved tool: the page's. No
 * API key of its own, no second model seat, the same subscription and the same
 * model as the owner's sessions. "What makes a model call me is the memory it
 * wakes with", and this is that sentence taken literally.
 *
 * **What is unverified until a real machine runs it**, and it is written down
 * rather than claimed: whether a background process can reach the keychain for
 * the subscription login. `claude setup-token` is the documented route for
 * unattended runs (spec §16). Everything in this file is proved against a STUB
 * executable; the PR says what the owner must do by hand to try the real thing.
 *
 * **The shape is `spawn.ts`'s, deliberately.** A pure planner that decides
 * everything and starts nothing, and a starter small enough to read — because
 * everything worth testing is in the pure half. The package's own values are
 * written onto the child's environment LAST, so nothing a caller exported can
 * redirect the run (§2.13), and the two variables that would make the child's
 * MCP server bind to the PARENT's session are removed rather than inherited.
 *
 * **The outcome is read from the STORE, never from the child's stdout.** A
 * windowless session's output is prose we did not write and must not parse into
 * a verdict; what the run actually did is in the page's own version chain and
 * in the row the tool left. Exit code and the watchdog decide only between
 * "the writer had nothing to say" and "the writer could not run".
 */
import { spawn } from "node:child_process";

import type { Counterpart } from "../../core/counterpart.js";
import { writerInstruction } from "../../core/self/index.js";
import type { PageWriterOutcome } from "../../core/self/index.js";
import { CONFIG_ENV as CONFIG_PATH_ENV } from "../config-path.js";
import { PAGE_WRITER_ENV } from "../sessions.js";

import { TUNABLES, pageWriterMode } from "./config.js";
import type { AdapterConfig } from "./config.js";
import { DATA_DIR_ENV, SCOPE_ENV, SESSION_ENV } from "./spawn.js";

/**
 * THE ONE TOOL THE WRITER MAY CALL, spelled the way the host names an MCP tool.
 *
 * One, and the page's, because a writer that could call anything else would be
 * an unattended session with a shell — and the thing it is unattended FOR is
 * one paragraph of prose. Everything else it might want (the page as it stands,
 * the day just gone) is already in the prompt or in its own wake.
 */
export const MCP_SELF_PAGE_TOOL = "mcp__counterparts__self_page";

/**
 * WHICH NIGHT THIS CHILD IS WRITING, pinned onto its environment as a DATE.
 *
 * It is how the MCP server inside the child knows to record `by: "writer"`
 * rather than `by: "session"`. `by` is the door's and is not claimable from
 * outside (`self/page.ts`), and in session mode the door's evidence is a mark
 * on the session registry record; a windowless child has no such mark, because
 * its session id is minted by the host after this process is gone. The
 * variable is the same evidence by the only channel that reaches it — and it is
 * honoured only while that night's claim is still open, so an inherited or
 * stale value cannot relabel anything.
 */
export { PAGE_WRITER_ENV } from "../sessions.js";

/**
 * The permission mode the child runs under. `default` and one allowed tool: the
 * page's tool needs no approval and everything else stops — in a session with
 * no window, a prompt nobody can answer is a refusal, which is the direction
 * this should fail in.
 */
export const PERMISSION_MODE = "default";

/** The host CLI, when the configuration names none. Resolved on the child's PATH. */
export const DEFAULT_HOST_COMMAND = "claude";

export type PageWriterRefusal =
  | "NOT_HOST_MODE"
  | "OBSERVER"
  | "NO_DATA_DIR"
  | "NO_COMMAND"
  | "TIMEOUT_NOT_FINITE";

export interface PageWriterPlan {
  readonly ok: boolean;
  readonly reason: PageWriterRefusal | "ready";
  readonly command: string;
  readonly args: readonly string[];
  /** The child's complete environment. This package's values are written LAST. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface PageWriterPlanInput {
  readonly config: AdapterConfig;
  /** The calendar date the run is about. */
  readonly about: string;
  /** The instruction the child is started with (`self/writer.ts`). */
  readonly prompt: string;
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  /** The configuration file the parent read, pinned so parent and child agree. */
  readonly configPath?: string;
}

/**
 * EVERYTHING DECIDED, NOTHING STARTED. Pure.
 *
 * The order is load-bearing, the same way `planSpawn`'s is: the stances refuse
 * first, then the things that make a command impossible, and only then is the
 * environment written.
 */
export function planPageWriter(input: PageWriterPlanInput): PageWriterPlan {
  const timeoutMs = input.config.pageWriter?.timeoutMs ?? TUNABLES.PAGE_WRITER_MS;
  const command = input.config.pageWriter?.command ?? DEFAULT_HOST_COMMAND;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.baseEnv ?? process.env)) {
    if (v !== undefined) env[k] = v;
  }
  const args = [
    "-p",
    input.prompt,
    "--allowedTools",
    MCP_SELF_PAGE_TOOL,
    "--permission-mode",
    PERMISSION_MODE,
  ];
  const no = (reason: PageWriterRefusal): PageWriterPlan => ({
    ok: false,
    reason,
    command,
    args,
    env,
    timeoutMs,
  });
  // An instrument starts no writer against a store it may not write, and a
  // configuration that is not in host mode is not a refusal to report — it is
  // simply a different mechanism.
  if (pageWriterMode(input.config) !== "host") {
    return no(input.config.observer === true ? "OBSERVER" : "NOT_HOST_MODE");
  }
  if (input.config.dataDir === undefined || input.config.dataDir.trim().length === 0) {
    return no("NO_DATA_DIR");
  }
  if (command.trim().length === 0) return no("NO_COMMAND");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return no("TIMEOUT_NOT_FINITE");

  // THE PARENT'S SESSION IS NOT THE CHILD'S. These two pin the detached
  // worker's run to the session that spawned it; inherited by a whole new host
  // session they would make its MCP server bind to a session that has already
  // ended, and every tool call refuse. Removed rather than overwritten, because
  // "no session" is the truth: the host mints the child's id itself.
  delete env[SESSION_ENV];
  delete env[SCOPE_ENV];
  // ...and this package's own values last, so nothing exported anywhere can
  // point the child at another store.
  env[DATA_DIR_ENV] = input.config.dataDir;
  env[PAGE_WRITER_ENV] = input.about;
  if (input.configPath !== undefined && input.configPath.length > 0) {
    env[CONFIG_PATH_ENV] = input.configPath;
  }
  return { ok: true, reason: "ready", command, args, env, timeoutMs };
}

/** What one child did, as the OS reported it. Injected so a test can prove the
 *  whole path without starting a process. */
export interface ChildResult {
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly error: string | null;
}
export type PageWriterStarter = (
  plan: PageWriterPlan,
  signal?: AbortSignal,
) => Promise<ChildResult>;

export interface PageWriterRunResult {
  readonly ran: boolean;
  readonly about: string;
  readonly outcome: PageWriterOutcome;
  readonly detail: string;
}

/**
 * RUN THE NIGHT, in host mode.
 *
 * Called from the boundary's worker, after everything else it does. The order
 * is: decide, compose, claim, start, wait, then READ THE STORE for what
 * happened. The claim goes in before the child starts, so a crash between the
 * two costs one night rather than leaving a writer that can be started twice.
 *
 * It never throws: a nightly writer that could fail a worker would take the
 * sweep, the flush, the cycle and the snapshot down with it.
 */
export async function runPageWriter(opts: {
  counterpart: Counterpart;
  config: AdapterConfig;
  configPath?: string;
  baseEnv?: Readonly<Record<string, string | undefined>>;
  start?: PageWriterStarter;
  /**
   * THE WORKER'S OWN WATCHDOG, and it outranks this one.
   *
   * The two numbers can disagree — the worker's is five minutes by default and
   * this child's is ten — and without this the worker would sit in its `finally`
   * for twice the life its own contract states, holding the store open past the
   * moment everything else in the run had given up. So the child is killed when
   * the worker's watchdog fires, and the run is recorded as `failed(watchdog)`
   * exactly as its own timeout would be. Whichever alarm rings first wins.
   */
  signal?: AbortSignal;
}): Promise<PageWriterRunResult> {
  const { counterpart, config } = opts;
  const mode = pageWriterMode(config);
  const today = counterpart.store.today();
  if (mode !== "host") {
    return { ran: false, about: "", outcome: "skipped", detail: "not-host-mode" };
  }
  const due = counterpart.pageWriterDue({ mode, today });
  if (!due.due) {
    // NO ROW for an ordinary refusal. "It already ran" and "this store has no
    // yesterday" are the answer at most boundaries of most days, and a row for
    // each would bury the nights that did happen.
    return { ran: false, about: due.about, outcome: "skipped", detail: due.reason };
  }
  const about = due.about;
  let prompt: string;
  let considered = 0;
  let omitted = 0;
  let bytesBefore = 0;
  try {
    const built = counterpart.pageWriterInput({ about });
    prompt = writerInstruction(built, { tool: MCP_SELF_PAGE_TOOL });
    considered = built.memories.length;
    omitted = built.omitted;
    bytesBefore = built.page?.bytes ?? 0;
  } catch (err) {
    record(counterpart, { about, outcome: "failed", detail: code(err) });
    return { ran: false, about, outcome: "failed", detail: code(err) };
  }
  const plan = planPageWriter({
    config,
    about,
    prompt,
    ...(opts.baseEnv === undefined ? {} : { baseEnv: opts.baseEnv }),
    ...(opts.configPath === undefined ? {} : { configPath: opts.configPath }),
  });
  if (!plan.ok) {
    record(counterpart, { about, outcome: "failed", detail: plan.reason, considered, omitted });
    return { ran: false, about, outcome: "failed", detail: plan.reason };
  }
  // THE CLAIM, before anything is started.
  record(counterpart, { about, outcome: "started", considered, omitted, bytesBefore });
  const before = counterpart.selfPage();
  let result: ChildResult;
  try {
    result = await (opts.start ?? startChild)(plan, opts.signal);
  } catch (err) {
    record(counterpart, { about, outcome: "failed", detail: code(err), considered, omitted });
    return { ran: true, about, outcome: "failed", detail: code(err) };
  }
  // WHAT HAPPENED, read from the store. The child's own tool call already left
  // a terminal row if it wrote through the MCP server; the page's version chain
  // is the second reading, for a child that reached the seam some other way.
  const closed = counterpart
    .pageWriterRuns({ about })
    .find((r) => r.outcome !== "asked" && r.outcome !== "started");
  if (closed !== undefined) {
    return { ran: true, about, outcome: closed.outcome, detail: closed.detail };
  }
  const after = counterpart.selfPage();
  const moved = after !== null && (before === null || after.version !== before.version);
  if (moved) {
    record(counterpart, {
      about,
      outcome: "revised",
      considered,
      omitted,
      bytesBefore,
      bytesAfter: after.bytes,
    });
    return { ran: true, about, outcome: "revised", detail: "" };
  }
  if (result.timedOut || result.code !== 0) {
    const detail = result.timedOut
      ? "watchdog"
      : (result.error ?? `exit ${String(result.code ?? "null")}`);
    record(counterpart, { about, outcome: "failed", detail, considered, omitted, bytesBefore });
    return { ran: true, about, outcome: "failed", detail };
  }
  // A clean exit with the page untouched IS an answer: a session handed one day
  // and one tool that chose not to use it has said there was nothing to say.
  record(counterpart, {
    about,
    outcome: "nothing-to-say",
    considered,
    omitted,
    bytesBefore,
    bytesAfter: bytesBefore,
  });
  return { ran: true, about, outcome: "nothing-to-say", detail: "" };
}

function record(
  counterpart: Counterpart,
  run: {
    about: string;
    outcome: PageWriterOutcome;
    detail?: string;
    considered?: number;
    omitted?: number;
    bytesBefore?: number;
    bytesAfter?: number;
  },
): void {
  try {
    counterpart.recordPageWriterRun({ ...run, mode: "host" });
  } catch {
    /* a run that cannot be recorded still ran (§5 G7) */
  }
}

function code(err: unknown): string {
  return err instanceof Error ? err.name : "UNKNOWN";
}

/** The real starter: one child, two watchdogs, nothing inherited on stdio. */
async function startChild(plan: PageWriterPlan, abort?: AbortSignal): Promise<ChildResult> {
  return await new Promise<ChildResult>((resolve) => {
    let settled = false;
    let killed = false;
    let off: (() => void) | null = null;
    const done = (r: ChildResult): void => {
      if (settled) return;
      settled = true;
      off?.();
      resolve(r);
    };
    const child = spawn(plan.command, [...plan.args], {
      // NOT detached: the worker waits for this one. A writer nobody waits for
      // is a writer whose outcome nobody can record — and the outcome is the
      // whole point of the row.
      stdio: "ignore",
      env: { ...plan.env },
      timeout: plan.timeoutMs,
    });
    // THE WORKER'S WATCHDOG, which may be shorter than this child's. Fired, it
    // takes the child with it rather than leaving the worker holding the store
    // open past the life its own contract states.
    if (abort !== undefined) {
      const onAbort = (): void => {
        killed = true;
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      };
      if (abort.aborted) onAbort();
      else {
        abort.addEventListener("abort", onAbort, { once: true });
        off = (): void => {
          abort.removeEventListener("abort", onAbort);
        };
      }
    }
    child.on("error", (err) => {
      done({ code: null, timedOut: false, error: err.name });
    });
    child.on("close", (exit, signal) => {
      done({ code: exit, timedOut: killed || signal === "SIGTERM", error: null });
    });
  });
}
