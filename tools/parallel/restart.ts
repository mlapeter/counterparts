/**
 * `tools/parallel/restart.ts` — the phase clock, restarted deliberately.
 *
 * CONTRACT §5 G12: the carry-forward rule prices mid-run change BY CLASS,
 * declared before the change lands. An identical surface-set hash is
 * telemetry-only and the day count carries; a red-line fix restarts the clock
 * for the criteria whose surface set moved; **anything else restarts the
 * phase**. The owner ruled (2026-09-04) that the behavior-changing fixes
 * landing during this run take that last branch — so the seven-day count starts
 * again — and a rule with no command behind it is a rule nobody applies.
 *
 * This is that command's engine. It is not a flip and it touches no store: it
 * reads the run record, clears the current phase's active-day count from the
 * day the restart names, and writes the annotation the next daily run reads.
 *
 * WHY THE ANNOTATION IS LOAD-BEARING RATHER THAN DECORATIVE: `dailyRecord`
 * recomputes `activeDays` from `days[]` on every write. A restart that only set
 * the number would be undone by the next daily run — the clock resurrecting the
 * days it was told to stop counting. So the restart is recorded as a FACT on
 * the run record (`phaseRestart`), `countActiveDays` in `record.ts` honors it,
 * and both sides read the one filter rather than two copies of it.
 *
 * `days/` is left exactly as it is. A restarted clock is not a deleted history:
 * the days stay, stamped with their class, and stop counting toward the phase
 * minimum. `restarts.jsonl` accumulates every restart ever declared, so "how
 * many times did this run restart, and why" is answerable off the run directory
 * (§5 G10: red-lines halt and PRESERVE — this is the preserving half).
 *
 * Nothing here writes; it returns the artifacts and the caller hands them to
 * `writer.ts` (G1), exactly as `record.ts` does.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { countActiveDays, readRunRecord } from "./record.js";
import { surfaceSetHash } from "./surface.js";
import type { PhaseRestart, RunPhase, RunRecord } from "./types.js";

export class RestartError extends Error {
  readonly code: string;
  readonly detail: Readonly<Record<string, string>>;
  constructor(code: string, detail: Record<string, string> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "RestartError";
    this.code = code;
    this.detail = detail;
  }
}

/** The run-relative history of every restart ever declared on this run. */
export const RESTARTS_LOG = "restarts.jsonl";

export interface RestartOptions {
  readonly runDir: string;
  /** The FIRST day of the restarted clock, `YYYY-MM-DD`. */
  readonly date: string;
  readonly reason: string;
  /** The phase whose clock restarts. Absent, the run record's own phase. */
  readonly phase?: RunPhase;
  readonly at?: string;
}

export interface RestartArtifacts {
  readonly run: RunRecord;
  readonly entry: PhaseRestart;
  readonly json: Readonly<Record<string, unknown>>;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * The restarted run record and its history line.
 *
 * Every refusal is NAMED, because the operator typing this command is changing
 * the run's central number by hand and a silent no-op would be the worst
 * outcome available: no run record (nothing to restart), an empty reason (§5
 * G12 wants the class recorded, and "" is not a class), a date before the run
 * began (a typo that would clear a phase to zero on a day that never existed).
 * A corrupt `run.json` throws out of `readRunRecord` and is left as evidence.
 */
export function restartArtifacts(opts: RestartOptions): RestartArtifacts {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new RestartError("RESTART_DATE_MALFORMED", { date: opts.date });
  }
  const reason = opts.reason.trim();
  if (reason.length === 0) {
    throw new RestartError("RESTART_REASON_REQUIRED", {
      remedy:
        "say what landed, in one line: the carry-forward class is recorded BEFORE the change, never argued after (§5 G12)",
    });
  }
  const prior = readRunRecord(opts.runDir);
  if (prior === null) {
    throw new RestartError("NO_RUN_RECORD", {
      runDir: opts.runDir,
      remedy:
        "there is no run.json in this run directory, so there is no phase clock to restart — run the daily first",
    });
  }
  if (opts.date < prior.startDate) {
    throw new RestartError("RESTART_DATE_BEFORE_RUN_START", {
      date: opts.date,
      startDate: prior.startDate,
      remedy:
        "the restart date is the FIRST day of the restarted clock; a date before the run began would clear a phase on a day that never existed",
    });
  }
  const phase = opts.phase ?? prior.phase;

  const entry: PhaseRestart = {
    restartedAt: opts.at ?? new Date().toISOString(),
    date: opts.date,
    phase,
    reason,
    // G12's hash AS OF THE RESTART: the change being priced is the one that
    // just landed, so the surface set recorded here is the post-change one, and
    // the pre-change hash is still on the previous `run.json` in git / in the
    // history line below.
    surfaceSet: surfaceSetHash(),
    clearedActiveDays: prior.activeDays,
  };

  const run: RunRecord = {
    ...prior,
    // The count is recomputed through the SAME filter the daily uses, so the
    // number the operator sees now is the number tomorrow's run will agree
    // with. Days before the restart date, in this phase, stop counting.
    activeDays: countActiveDays(prior.days, entry),
    surfaceSet: entry.surfaceSet,
    phaseRestart: entry,
    updatedAt: entry.restartedAt,
  };

  // The history is APPENDED by rewriting the whole file: the run directory's
  // one writer is atomic (temp + rename) and takes whole texts, and a restart
  // log is a handful of lines a year. Read what is there, add one line.
  const path = join(opts.runDir, RESTARTS_LOG);
  let existing = "";
  if (existsSync(path)) {
    try {
      existing = readFileSync(path, "utf8");
    } catch (err) {
      throw new RestartError("RESTARTS_LOG_UNREADABLE", {
        path,
        detail: err instanceof Error ? err.message : String(err),
        remedy: "the history is evidence; it is never overwritten blind",
      });
    }
    if (existing.length > 0 && !existing.endsWith("\n")) existing += "\n";
  }
  const line = JSON.stringify({
    ...entry,
    priorSurfaceSet: prior.surfaceSet,
    priorPhaseRestart: prior.phaseRestart?.date ?? null,
  });

  return {
    run,
    entry,
    json: { "run.json": run },
    files: { [RESTARTS_LOG]: `${existing}${line}\n` },
  };
}
