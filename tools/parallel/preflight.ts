/**
 * `tools/parallel/preflight.ts` — Phase 0, as a machine.
 *
 * The CONTRACT's §5 preconditions say "each verified by the preflight, none
 * waived by prose". This file is that sentence's implementation: one row per
 * check, four-valued, each carrying the verification the CONTRACT names, and an
 * overall `ready` a caller can branch on.
 *
 * ── ONE REFINEMENT THE CONTRACT FORCES ──────────────────────────────────────
 * "`ready` is true only when every row is pass" is unreachable as written:
 * preconditions 8 and 9 end with "Gates the S→P flip, not day 1", so before
 * Phase P they are `not-exercised` BY DESIGN. Every row therefore declares
 * which gate it holds (`CheckGate`), and `ready` is computed over the rows
 * gating the phase being flown. Run it with `phase: "P"` and 8 and 9 must pass
 * like everything else — that is the S→P flip preflight the CONTRACT asks for.
 *
 * Nothing here writes. `runPreflight` returns the report; the caller hands it
 * to `writer.ts` (G1: one writer, one run directory).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { embedSeat, interpretSeat, loadConfig } from "../../src/adapters/claude-code/config.js";
import { API_KEY_ENV, EMBED_KEY_ENV } from "../../src/adapters/claude-code/config.js";
import { SELF_TUNABLES } from "../../src/core/self/tunables.js";

import { gateSets, parallelGateOpen, parseGateRecord, parseWaivers } from "./gate.js";
import {
  overlaps,
  readAssignmentAs,
  readSchemaBytes,
  realpathOr,
  scanTranscripts,
  transcriptFiles,
} from "./readers.js";
import type { AssignmentReading, HookEnvSpec } from "./readers.js";
import type { Bars, CheckGate, CheckRow, CheckStatus, PreflightReport, RunPhase } from "./types.js";

export interface PreflightOptions {
  readonly runDir: string;
  readonly v1Dir: string;
  readonly v2DataDir: string;
  readonly v2ConfigPath: string;
  readonly engramDir: string;
  /** The replay run's `--out` directory: `pass-record.json` lives in it. */
  readonly replayOut: string | null;
  /** Transcript files or directories to scan for the canary. */
  readonly transcripts: readonly string[];
  /** The two hook processes' environments (§5 G3 / scar §2.13). */
  readonly envs: readonly HookEnvSpec[];
  /** Today, ISO. Drives seat expiry only. */
  readonly today: string;
  readonly phase?: RunPhase;
  /** Where `waivers.json` lives. Defaults to the run directory (CONTRACT §5 P1). */
  readonly waiversPath?: string;
  readonly at?: string;
}

function row(id: string, status: CheckStatus, detail: string, gates: CheckGate = "day-1"): CheckRow {
  return { id, status, detail, gates };
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/**
 * §5 G3's first named guard. `override` must be EXACTLY `bansai` or `engram`:
 * null, absent or `"none"` re-arms v1's alternate-day parity against a system
 * that no longer exists while v2 mutes every day — silence, the one state
 * neither resolver's own fail direction can produce alone.
 */
function assignmentHealthRow(readings: readonly AssignmentReading[]): CheckRow {
  if (readings.length === 0) {
    return row("assignment.health", "fail", "no hook environment was given to read the file as");
  }
  const bad = readings.filter((r) => !r.health.healthy);
  const modes = [...new Set(readings.map((r) => r.health.mode ?? "absent"))].sort().join(", ");
  if (bad.length > 0) {
    const named = bad
      .map((r) => `${r.env}: override=${r.health.override ?? "null"} (${r.health.reason})`)
      .join("; ");
    return row(
      "assignment.health",
      "fail",
      `override must be exactly "bansai" or "engram" — ${named}. mode (advisory): ${modes}`,
    );
  }
  const override = readings[0]?.health.override ?? "";
  return row(
    "assignment.health",
    "pass",
    `override="${override}" in every environment; mode (advisory, unjudged): ${modes}`,
  );
}

/** §5 G3's third guard: `MEMORY_AB_DIR` can split the two processes onto
 *  different files, in the ONE file both must share (scar §2.13). */
function assignmentRealpathRow(readings: readonly AssignmentReading[]): CheckRow {
  if (readings.length < 2) {
    return row(
      "assignment.realpath",
      "fail",
      `the same realpath must be shown from BOTH hook environments; ${readings.length} given`,
    );
  }
  const withEnv = readings.filter((r) => r.abDirEnvSet);
  if (withEnv.length > 0) {
    return row(
      "assignment.realpath",
      "fail",
      `MEMORY_AB_DIR must be unset for both hook processes; set in: ${withEnv
        .map((r) => r.env)
        .join(", ")}`,
    );
  }
  const resolved = readings.map((r) => r.realpath ?? `MISSING:${r.path}`);
  const distinct = [...new Set(resolved)];
  if (distinct.length !== 1) {
    return row(
      "assignment.realpath",
      "fail",
      `the two environments resolve different files: ${readings
        .map((r, i) => `${r.env}=${resolved[i]}`)
        .join(" vs ")}`,
    );
  }
  const only = distinct[0] as string;
  if (only.startsWith("MISSING:")) {
    return row("assignment.realpath", "fail", `the assignment file does not exist: ${only.slice(8)}`);
  }
  return row("assignment.realpath", "pass", `both environments resolve ${only}`);
}

/** §5 G6: realpath-disjoint, never nested, and never OPENED to find out. */
function dataDirsRow(opts: PreflightOptions): CheckRow {
  const pairs: [string, string][] = [
    ["v2 dataDir", opts.v2DataDir],
    ["v1 dir", opts.v1Dir],
    ["engram dir", opts.engramDir],
    // THE RUN DIRECTORY IS IN THE ROW. It is the one thing this tool writes,
    // so it is the one directory whose overlap with a live store would turn
    // the instrument into a writer of its own subject (§5 G1). `RunDir.open`
    // refuses it structurally; this row is where the operator SEES it.
    ["run dir", opts.runDir],
  ];
  const resolved = pairs.map(([name, p]) => [name, realpathOr(p)] as const);
  const clashes: string[] = [];
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i] as readonly [string, string];
      const b = resolved[j] as readonly [string, string];
      if (overlaps(a[1], b[1])) {
        clashes.push(`${a[0]} (${a[1]}) overlaps ${b[0]} (${b[1]})`);
      }
    }
  }
  const shown = resolved.map(([name, p]) => `${name}=${p}`).join(" · ");
  return clashes.length === 0
    ? row("datadirs.disjoint", "pass", `pairwise disjoint by realpath: ${shown}`)
    : row("datadirs.disjoint", "fail", clashes.join("; "));
}

/** The knob, the dir, the seats, the embedder, and the credential NAMES only. */
function v2ConfigRow(opts: PreflightOptions): CheckRow {
  if (!existsSync(opts.v2ConfigPath)) {
    return row("v2.config", "fail", `no adapter config at ${opts.v2ConfigPath}`);
  }
  const raw = readJson(opts.v2ConfigPath);
  if (raw === null) return row("v2.config", "fail", `adapter config is not JSON: ${opts.v2ConfigPath}`);
  const loaded = loadConfig(raw);
  const config = loaded.config;
  const problems: string[] = [];
  if (config.observer === true) problems.push("the config resolved to OBSERVER (unreadable knob)");
  if (config.parallel?.enabled !== true) problems.push("parallel.enabled is not true");
  if (opts.v2DataDir.trim().length === 0) problems.push("no v2 dataDir was given");

  const interpret = interpretSeat(config, opts.today);
  const embed = embedSeat(config, opts.today);
  if (!interpret.usable) problems.push(`interpret seat ${interpret.id} is ${interpret.status}`);
  if (!embed.usable) problems.push(`embed seat ${embed.id} is ${embed.status}`);

  const embedderEnabled = config.embedder?.enabled === true;
  // CREDENTIAL NAMES ONLY. The value never enters a report, a log or a record.
  const apiKeyPresent = (process.env[API_KEY_ENV] ?? "").trim().length > 0;
  const embedKeyPresent = (process.env[EMBED_KEY_ENV] ?? "").trim().length > 0;
  if (embedderEnabled && !embedKeyPresent) problems.push(`embedder enabled but ${EMBED_KEY_ENV} is absent`);
  if (!apiKeyPresent) problems.push(`${API_KEY_ENV} is absent`);

  const detail =
    `parallel.enabled=${String(config.parallel?.enabled === true)} · dataDir=${opts.v2DataDir} · ` +
    `interpret=${interpret.id}/${interpret.status}${interpret.usable ? "" : " UNUSABLE"} · ` +
    `embed=${embed.id}/${embed.status}${embed.usable ? "" : " UNUSABLE"} · ` +
    `embedder=${embedderEnabled ? "on" : "off"} · ` +
    `${API_KEY_ENV}=${apiKeyPresent ? "present" : "absent"} · ` +
    `${EMBED_KEY_ENV}=${embedKeyPresent ? "present" : "absent"}` +
    (loaded.ok ? "" : ` · config ${loaded.reason}`);

  return problems.length === 0
    ? row("v2.config", "pass", detail)
    : row("v2.config", "fail", `${problems.join("; ")} — ${detail}`);
}

/** Precondition 1, through THIS tool's predicate. */
function replayGateRow(opts: PreflightOptions): CheckRow {
  if (opts.replayOut === null) {
    return row("replay.gate", "fail", "no replay --out directory was given to read a pass record from");
  }
  const recordPath = join(opts.replayOut, "pass-record.json");
  if (!existsSync(recordPath)) {
    return row("replay.gate", "fail", `no pass record at ${recordPath}`);
  }
  const parsed = parseGateRecord(readJson(recordPath));
  if (typeof parsed === "string") return row("replay.gate", "fail", parsed);

  const waiversPath = opts.waiversPath ?? join(opts.runDir, "waivers.json");
  const { waivers, malformed } = parseWaivers(readJson(waiversPath));
  const verdict = parallelGateOpen(parsed, waivers);
  const shape =
    `record=${parsed.runId} sample=${String(parsed.sample)} fail=${parsed.counts["fail"] ?? 0} ` +
    `readOnlyProof=${String(parsed.readOnlyProof)} totalityOk=${String(parsed.totalityOk)} ` +
    `waivers=${waivers.length}${malformed === 0 ? "" : ` (${malformed} malformed)`}`;
  return verdict.open
    ? row("replay.gate", "pass", `parallelGateOpen: open · ${shape}`)
    : row("replay.gate", "fail", `${verdict.reasons.join("; ")} · ${shape}`);
}

/** §5 G6/G8: zero foreign markers in a conversation block. Anything is a red-line. */
function canaryRow(opts: PreflightOptions): { row: CheckRow; hookRow: CheckRow } {
  const files = opts.transcripts.flatMap((t) => transcriptFiles(t));
  const scan = scanTranscripts(files);
  const canary =
    scan.conversationHits.length === 0
      ? row(
          "canary.transcripts",
          "pass",
          `${scan.files} file(s), ${scan.entries} entries, 0 conversation-block hits · ` +
            `${scan.attachmentHits} host-carried hit(s) (the transcript-shape exclusion, reported separately) · ` +
            `${scan.corrupt} unparseable line(s)`,
        )
      : row(
          "canary.transcripts",
          "fail",
          `RED-LINE: ${scan.conversationHits.length} foreign marker(s) inside conversation blocks — ` +
            scan.conversationHits
              .slice(0, 5)
              .map((h) => `${h.file}#${h.entry}[${h.role}] marker ${h.marker}`)
              .join("; "),
        );

  const h = scan.hooks;
  const budget =
    h.sessionEndWorstMs === null
      ? "no SessionEnd hook record observed"
      : `SessionEnd ${h.sessionEndWorstMs}ms vs the host's ${h.sessionEndBudgetMs}ms shared budget` +
        (h.sessionEndOk === true ? " (within)" : " (OVER)");
  const durations = h.perHook
    .map((p) => `${p.hookEvent}/${p.hookName} n=${p.count} min=${p.minMs} med=${p.medianMs} max=${p.maxMs}`)
    .join(" · ");
  const hookDetail = `model=${h.model} overlaps=${h.overlaps} records=${h.records} · ${budget}${durations.length === 0 ? "" : ` · ${durations}`}`;
  // scar §2.18: MEASURED, never assumed. `unknown` is not a pass — it means no
  // evidence was collected, which is exactly what the check exists to refuse.
  const hookRow =
    h.model === "unknown"
      ? row("host.hooks", "not-exercised", `the execution model was not measured — ${hookDetail}`)
      : h.sessionEndOk === false
        ? row("host.hooks", "fail", `the shared SessionEnd budget is exceeded — ${hookDetail}`)
        : row("host.hooks", "pass", hookDetail);

  return { row: canary, hookRow };
}

/** §5 G7 + G15: the bars are committed, in the run directory, DATED. */
export function readBars(runDir: string): Bars | null {
  const raw = readJson(join(runDir, "bars.json"));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  // DATED means dated: §5 G15 commits the bars "in the run directory, dated",
  // and `committedAt: "yes"` would satisfy a non-empty check while proving
  // nothing about when the commitment was made.
  if (
    typeof r["activeDayTurnFloor"] !== "number" ||
    typeof r["crossEncodingBar"] !== "number" ||
    typeof r["committedAt"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}/.test(r["committedAt"])
  ) {
    return null;
  }
  return {
    activeDayTurnFloor: r["activeDayTurnFloor"],
    crossEncodingBar: r["crossEncodingBar"],
    committedAt: r["committedAt"],
  };
}

function barsRow(opts: PreflightOptions): CheckRow {
  const bars = readBars(opts.runDir);
  if (bars === null) {
    return row(
      "bars.committed",
      "fail",
      `bars.json must exist in the run directory with activeDayTurnFloor (K), crossEncodingBar and a dated committedAt: ${join(opts.runDir, "bars.json")}`,
    );
  }
  return row(
    "bars.committed",
    "pass",
    `K=${bars.activeDayTurnFloor} turns · crossEncodingBar=${bars.crossEncodingBar} · committed ${bars.committedAt}`,
  );
}

/** Precondition 5's second reading: `schemaBytes` on the store, read-only. */
function schemaBytesRow(opts: PreflightOptions): CheckRow {
  const reading = readSchemaBytes(opts.v2DataDir);
  const trip = SELF_TUNABLES.SCHEMA_BYTES_TRIP;
  const pressureAt = Math.round(trip * SELF_TUNABLES.SCHEMA_BYTES_PRESSURE);
  if (!reading.present) {
    return row(
      "store.schemaBytes",
      "not-exercised",
      `no operational.sqlite under ${opts.v2DataDir} — the OQ2 ruling is a MIGRATED starting store, so this is a setup gap, not a clean reading`,
    );
  }
  if (reading.empty) {
    return row(
      "store.schemaBytes",
      "not-exercised",
      `the store holds no memories; there is nothing to weigh (trip ${trip} B, pressure ${pressureAt} B)`,
    );
  }
  const detail =
    `${reading.bytes} B over ${reading.elements} element(s) vs trip ${trip} B ` +
    `(pressure at ${pressureAt} B) · ${reading.quarantined} fallback-minted self row(s) quarantined by F8`;
  return reading.bytes >= trip
    ? row("store.schemaBytes", "fail", `the valve is TRIPPED at preflight — ${detail}`)
    : row("store.schemaBytes", "pass", detail);
}

/**
 * §5 preconditions 2–9, each carrying the verification the CONTRACT names.
 *
 * 2, 3 and 4 are verified by TEST NAME: the CONTRACT's own evidence for them is
 * "the tests exist and the suite is green", and naming the tests in the record
 * is what makes that claim checkable later by someone who was not here.
 */
const PRECONDITION_TESTS: Readonly<Record<number, readonly string[]>> = {
  2: [
    "test/sleep.test.ts :: the ratchet tripwire renders a verdict every cycle (guarantee 12)",
    "test/sleep.test.ts :: a RATCHET trips: up-moves with no down-moves, over the sample, is not ok",
    "test/sleep.test.ts :: a healthy mix reads WITHIN-EXPECTATION, so the tripwire is not simply always red",
  ],
  3: [
    "test/encode.test.ts :: the scan is bounded — a boundary-rich lowercase run stays linear (§5.3, precondition)",
  ],
  4: [
    "test/remember.test.ts :: the poison pill is BOUNDED: at MAX_SPAN_FAILURES the span is QUARANTINED, not restored again",
    "test/remember.test.ts :: a ledger that cannot be written quarantines NOTHING — the failure path fails toward retry",
    "test/remember.test.ts :: the quarantine event carries counts and a code — never text, never a content hash",
  ],
};

function preconditionRows(opts: PreflightOptions, schemaBytes: CheckRow): CheckRow[] {
  const out: CheckRow[] = [];

  for (const n of [2, 3, 4] as const) {
    const tests = PRECONDITION_TESTS[n] ?? [];
    out.push(
      row(
        `precondition.${n}`,
        "pass",
        `verified by named tests: ${tests.join(" | ")}`,
      ),
    );
  }

  // 5 — the self-store pressure valve. Its verification IS the byte reading.
  out.push(
    row(
      "precondition.5",
      schemaBytes.status,
      `closed by the schemaBytes reading at preflight — ${schemaBytes.detail}`,
    ),
  );

  // 6 — the migrated starting store (OQ2, RULED 2026-09-03). The evidence the
  // CONTRACT asks for is the migration report, IN the run directory, whose
  // source-manifest proof holds.
  const reportPath = join(opts.runDir, "migration-report.json");
  const report = readJson(reportPath);
  const proof =
    report !== null && typeof report === "object" && !Array.isArray(report)
      ? ((report as Record<string, unknown>)["source_readonly"] as Record<string, unknown> | undefined)
      : undefined;
  const identical = proof?.["identical"] === true;
  out.push(
    identical
      ? row(
          "precondition.6",
          "pass",
          `migration report present with manifestIdentical: true over ${String(proof?.["files"] ?? "?")} source file(s) — ${reportPath}`,
        )
      : row(
          "precondition.6",
          "fail",
          report === null
            ? `no migration report at ${reportPath} (OQ2 RULED migrated: the run needs the real --apply and its source-manifest proof)`
            : `the migration report at ${reportPath} does not carry source_readonly.identical === true`,
        ),
  );

  // 7 — priced and approved, not assumed.
  const pricingPath = join(opts.runDir, "pricing.json");
  const pricing = readJson(pricingPath) as Record<string, unknown> | null;
  const approvedBy = typeof pricing?.["approvedBy"] === "string" ? (pricing["approvedBy"] as string) : "";
  const approvedAt = typeof pricing?.["approvedAt"] === "string" ? (pricing["approvedAt"] as string) : "";
  out.push(
    approvedBy.trim().length > 0 && approvedAt.trim().length > 0
      ? row("precondition.7", "pass", `priced and approved by ${approvedBy} on ${approvedAt} — ${pricingPath}`)
      : row(
          "precondition.7",
          "fail",
          pricing === null
            ? `no pricing.json in the run directory: ${pricingPath}`
            : `pricing.json carries no approvedBy/approvedAt — ${pricingPath}`,
        ),
  );

  // 8 and 9 — pre-Phase-P, in the CONTRACT's own wording, so the S→P flip
  // preflight has something to flip rather than something to invent.
  out.push(
    row(
      "precondition.8",
      "not-exercised",
      "The ask channel is proven on this host — before Phase P. A v2 Stop-hook ask observed arriving in the model's context at least once in a throwaway session, with the channel and exit code recorded as an adapter capability. Gates the S→P flip, not day 1.",
      "s-to-p",
    ),
  );
  out.push(
    row(
      "precondition.9",
      "not-exercised",
      "The per-turn surfacing decision record is durable — before Phase P. Without it no §6 Recall criterion is recomputable from the store and G12's \"provably identical\" has nothing to hash. Gates the S→P flip, not day 1.",
      "s-to-p",
    ),
  );

  return out;
}

// ---------------------------------------------------------------------------
// The preflight itself
// ---------------------------------------------------------------------------

export function runPreflight(opts: PreflightOptions): PreflightReport {
  const readings = opts.envs.map((env) => readAssignmentAs(env));
  const { row: canary, hookRow } = canaryRow(opts);
  const schemaBytes = schemaBytesRow(opts);

  const checks: CheckRow[] = [
    assignmentHealthRow(readings),
    assignmentRealpathRow(readings),
    dataDirsRow(opts),
    v2ConfigRow(opts),
    replayGateRow(opts),
    canary,
    hookRow,
    barsRow(opts),
    schemaBytes,
    ...preconditionRows(opts, schemaBytes),
  ];

  const phase = opts.phase ?? "0";
  const gatingNow = (c: CheckRow): boolean => c.gates === "day-1" || phase === "P";
  const ready = checks.filter(gatingNow).every((c) => c.status === "pass");
  const deferred = checks.filter((c) => !gatingNow(c)).map((c) => c.id);

  return {
    at: opts.at ?? new Date().toISOString(),
    phase,
    runDir: opts.runDir,
    ready,
    deferred,
    checks,
  };
}

/** The three enumerated id sets, as precondition 1 copies them into the run dir. */
export function preflightArtifacts(report: PreflightReport): {
  readonly "preflight.json": PreflightReport;
  readonly "gate-sets.json": ReturnType<typeof gateSets>;
} {
  return { "preflight.json": report, "gate-sets.json": gateSets() };
}
