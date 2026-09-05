/**
 * `counterparts repair-dates` — giving the migrated rows back their real dates.
 *
 * THE FINDING (PARALLEL-RUN-STATUS 2026-09-04, LAUNCH-STATUS §I7). 12,334 of the
 * 14,529 migrated memories on the live store carry the IMPORT DAY as `learned_on`:
 * v1's traces mostly had no `created` field, and `store.put` defaulted the date to
 * whatever day the importer ran. `bornDay` kept the real age, so the physics is
 * unaffected and nothing decayed wrongly — but every one of those rows now tells
 * the owner it was learned on a day it was not, and #29/#30 had to render them as
 * an upper bound ("by 2026-09-03 ·") because the row does not say which it is.
 *
 * THE REPAIR IS EVIDENCE, NOT ARITHMETIC. This tool invents no dates. It reads
 * what the migration already carried into each row's prose meta and proposes a
 * date only where something in the row actually says one:
 *
 *   HIGH    the v1 document said so — a `created` (or `created_at` / `date`) field
 *           carried through as `meta.v1Extra`, or an engram-era id that IS a
 *           millisecond timestamp (`…_1721984400000`), which is a fact about when
 *           the row was minted rather than an inference about it.
 *   MEDIUM  the SESSION says so — `meta.sessionRef` carries a timestamp or a date.
 *           A session id dates the conversation, and a trace from that session was
 *           learned during it; the step from one to the other is small but real,
 *           which is what separates this tier from the one above.
 *   LOW     the PATH says so — the source path the trace was read from carries a
 *           `YYYY-MM` or a `YYYY-MM-DD` (v1 filed some traces by month). A month
 *           resolves to its first day and says so; that is a bound presented as a
 *           date, so it is the tier nothing applies by default.
 *
 * Every proposal is checked against a window — no earlier than `PLAUSIBLE_FLOOR`,
 * no later than the import day — because a fourteen-digit number that happens to
 * parse is not evidence, and a "learned" date after the day of the import is a
 * contradiction on its face. Rejections are COUNTED, with their reason, so the
 * report's denominator is the whole target set rather than the part that worked.
 *
 * DRY RUN IS THE DEFAULT and `--apply` is the only way past it, exactly as
 * `backfill-claims` works. `--apply` writes through `store.revise`, so the prior
 * document — with its wrong date — is archived into `versions/` first and stays
 * readable: correcting a date is a revision, and constitution 7 says a revision
 * keeps its history. The owner runs `--apply`; nothing here runs it for him.
 */
import { Store, storeExists } from "../../core/store/index.js";

/** No memory in either lineage predates this. A parse below it is a coincidence. */
export const PLAUSIBLE_FLOOR = "2015-01-01";

export type Confidence = "high" | "medium" | "low";

export interface DateProposal {
  readonly date: string;
  readonly confidence: Confidence;
  /** Which field the date was read out of — printed, so a sample row is checkable. */
  readonly from: string;
  /** How it was read: the shape of the evidence, not its content. */
  readonly how: "v1-date-field" | "id-timestamp" | "session-timestamp" | "session-date" | "path-date" | "path-month";
}

export type ProposalOutcome =
  | { readonly ok: true; readonly proposal: DateProposal }
  | { readonly ok: false; readonly reason: "no-evidence" | "out-of-window" };

/** v1 frontmatter keys that carried a real encode date. Read in this order. */
const V1_DATE_KEYS = ["created", "created_at", "createdAt", "date", "encoded"] as const;

/** 13 digits starting with 1: epoch ms from 2001-09-09 to 2286. Bounded further below. */
const MS_RUN = /(?<!\d)(1\d{12})(?!\d)/;
const ISO_DAY = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const ISO_MONTH = /(?<!\d)(\d{4})-(\d{2})(?![\d-])/;

function dateOfMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A real calendar day inside the window the store could plausibly have lived. */
function withinWindow(date: string, importDay: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const at = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at)) return false;
  // A round-trip catches 2026-02-31 and friends, which `Date.parse` rolls over.
  if (dateOfMs(at) !== date) return false;
  return date >= PLAUSIBLE_FLOOR && date <= importDay;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * What a migrated row says about its own date, at the strongest tier that says
 * anything. FIRST HIT WINS, tiers in order — a row with both an id timestamp and
 * a session ref is dated by the id, and the report says so.
 */
export function proposeDate(
  meta: Record<string, unknown>,
  importDay: string,
): ProposalOutcome {
  const candidates: DateProposal[] = [];
  const migratedFrom = str(meta["migratedFrom"]);
  const hash = migratedFrom.lastIndexOf("#");
  const v1Id = hash >= 0 ? migratedFrom.slice(hash + 1) : str(meta["v1Id"]);
  const sourcePath = hash >= 0 ? migratedFrom.slice(0, hash) : migratedFrom;
  const extra = { ...record(meta["v1Extra"]), ...meta };

  // HIGH — the v1 document carried a date field.
  for (const key of V1_DATE_KEYS) {
    const raw = str(extra[key]);
    const day = ISO_DAY.exec(raw);
    if (day !== null && day[0] !== undefined) {
      candidates.push({ date: day[0], confidence: "high", from: `v1Extra.${key}`, how: "v1-date-field" });
      break;
    }
    const ms = MS_RUN.exec(raw);
    if (ms !== null && ms[1] !== undefined) {
      candidates.push({
        date: dateOfMs(Number(ms[1])),
        confidence: "high",
        from: `v1Extra.${key}`,
        how: "v1-date-field",
      });
      break;
    }
  }

  // HIGH — the engram-era id IS a millisecond timestamp.
  const idMs = MS_RUN.exec(v1Id);
  if (idMs !== null && idMs[1] !== undefined) {
    candidates.push({
      date: dateOfMs(Number(idMs[1])),
      confidence: "high",
      from: "migratedFrom#id",
      how: "id-timestamp",
    });
  }

  // MEDIUM — the session the trace came from.
  const sessionRef = str(meta["sessionRef"]) || str(meta["session"]);
  const sessionMs = MS_RUN.exec(sessionRef);
  if (sessionMs !== null && sessionMs[1] !== undefined) {
    candidates.push({
      date: dateOfMs(Number(sessionMs[1])),
      confidence: "medium",
      from: "sessionRef",
      how: "session-timestamp",
    });
  } else {
    const sessionDay = ISO_DAY.exec(sessionRef);
    if (sessionDay !== null && sessionDay[0] !== undefined) {
      candidates.push({
        date: sessionDay[0],
        confidence: "medium",
        from: "sessionRef",
        how: "session-date",
      });
    }
  }

  // LOW — the path v1 filed it under.
  const pathDay = ISO_DAY.exec(sourcePath);
  if (pathDay !== null && pathDay[0] !== undefined) {
    candidates.push({ date: pathDay[0], confidence: "low", from: "migratedFrom#path", how: "path-date" });
  } else {
    const pathMonth = ISO_MONTH.exec(sourcePath);
    if (pathMonth !== null && pathMonth[1] !== undefined && pathMonth[2] !== undefined) {
      candidates.push({
        date: `${pathMonth[1]}-${pathMonth[2]}-01`,
        confidence: "low",
        from: "migratedFrom#path",
        how: "path-month",
      });
    }
  }

  if (candidates.length === 0) return { ok: false, reason: "no-evidence" };
  const usable = candidates.find((c) => withinWindow(c.date, importDay));
  if (usable === undefined) return { ok: false, reason: "out-of-window" };
  return { ok: true, proposal: usable };
}

export interface RepairTarget {
  readonly id: string;
  readonly kind: string;
  readonly learnedOn: string;
  readonly outcome: ProposalOutcome;
}

export interface RepairPlan {
  /** The date the importer stamped. Every target carries it as `learned_on`. */
  readonly importDay: string;
  /** How the import day was decided — measured or given. */
  readonly importDayFrom: "measured" | "flag";
  /** Live migrated rows whose date is the import day. */
  readonly targets: readonly RepairTarget[];
  readonly counts: {
    readonly migrated: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly noEvidence: number;
    readonly outOfWindow: number;
  };
}

const MIN_CONFIDENCE_ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function meetsConfidence(c: Confidence, floor: Confidence): boolean {
  return MIN_CONFIDENCE_ORDER[c] >= MIN_CONFIDENCE_ORDER[floor];
}

/**
 * The import day, MEASURED rather than assumed: the date the largest number of
 * migrated rows share. The importer wrote one date onto everything it could not
 * date otherwise, so that date is the mode by construction — and measuring it
 * means the tool works on any store, not only on the one it was written against.
 */
export function measureImportDay(store: Store): { day: string; migrated: number } {
  const tally = new Map<string, number>();
  let migrated = 0;
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || row.source !== "migrated") continue;
    migrated += 1;
    tally.set(row.learned_on, (tally.get(row.learned_on) ?? 0) + 1);
  }
  let day = "";
  let best = 0;
  for (const [d, n] of [...tally].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (n > best) {
      best = n;
      day = d;
    }
  }
  return { day, migrated };
}

/** Read-only, always: the plan is made against an observer store (scar E5). */
export function planRepair(dir: string, importDayFlag?: string): RepairPlan {
  const store = Store.open({ dir, observer: true });
  try {
    const measured = measureImportDay(store);
    const importDay = importDayFlag ?? measured.day;
    const targets: RepairTarget[] = [];
    const counts = { migrated: measured.migrated, high: 0, medium: 0, low: 0, noEvidence: 0, outOfWindow: 0 };
    if (importDay === "") return { importDay, importDayFrom: importDayFlag === undefined ? "measured" : "flag", targets, counts };
    const denied = new Set(store.deniedIds());
    for (const id of store.list()) {
      const row = store.row(id);
      if (row === undefined || denied.has(id)) continue;
      if (row.source !== "migrated") continue;
      // The repair is for what the store is still holding, and only for the rows
      // that carry the import day — a migrated row that kept a real v1 date is
      // already right and is never rewritten.
      if (row.archived === 1 || row.superseded_by !== null) continue;
      if (row.learned_on !== importDay) continue;
      let meta: Record<string, unknown> = {};
      try {
        meta = store.readProse(id).meta;
      } catch {
        meta = {};
      }
      const outcome = proposeDate(meta, importDay);
      if (outcome.ok) counts[outcome.proposal.confidence] += 1;
      else if (outcome.reason === "no-evidence") counts.noEvidence += 1;
      else counts.outOfWindow += 1;
      targets.push({ id, kind: row.kind, learnedOn: row.learned_on, outcome });
    }
    return {
      importDay,
      importDayFrom: importDayFlag === undefined ? "measured" : "flag",
      targets,
      counts,
    };
  } finally {
    store.close();
  }
}

export interface RepairIo {
  out(line: string): void;
  err(line: string): void;
}

export const SAMPLE_ROWS = 20;

export interface RepairOptions {
  readonly apply?: boolean;
  readonly minConfidence?: Confidence;
  readonly importDay?: string;
  readonly sample?: number;
}

export interface RepairReport {
  readonly plan: RepairPlan;
  readonly wouldWrite: number;
  readonly written: number;
  readonly failures: readonly string[];
}

/**
 * The command's body. Returns the report so a test can assert on numbers rather
 * than on printed lines; `commands.ts` turns it into an exit code.
 */
export function repairDates(dir: string, io: RepairIo, opts: RepairOptions = {}): RepairReport | null {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return null;
  }
  const floor: Confidence = opts.minConfidence ?? "high";
  const plan = planRepair(dir, opts.importDay);
  const sampleSize = opts.sample ?? SAMPLE_ROWS;

  if (plan.importDay === "") {
    io.out("No migrated memories in this store. Nothing to repair.");
    return { plan, wouldWrite: 0, written: 0, failures: [] };
  }

  const proposable = plan.targets.filter(
    (t) => t.outcome.ok && meetsConfidence(t.outcome.proposal.confidence, floor),
  );

  io.out(
    `Import day: ${plan.importDay} (${plan.importDayFrom === "measured" ? "measured: the date most migrated rows share" : "given with --import-day"})`,
  );
  io.out(`Migrated memories: ${plan.counts.migrated}`);
  io.out(`Live migrated rows carrying the import day: ${plan.targets.length}`);
  io.out("");
  io.out("Proposals by confidence:");
  io.out(`  high    ${plan.counts.high}  — the v1 document's own date, or an id that is a timestamp`);
  io.out(`  medium  ${plan.counts.medium}  — the session the trace came from`);
  io.out(`  low     ${plan.counts.low}  — the path v1 filed it under (a month resolves to its 1st)`);
  io.out(`  none    ${plan.counts.noEvidence}  — nothing in the row says a date; left exactly as it is`);
  io.out(`  rejected ${plan.counts.outOfWindow} — a date parsed but fell outside ${PLAUSIBLE_FLOOR}..${plan.importDay}`);
  io.out("");
  io.out(`At or above confidence ${floor}: ${proposable.length} rows would be re-dated.`);

  const sample = proposable.slice(0, sampleSize);
  if (sample.length > 0) {
    io.out("");
    io.out(`Sample (${sample.length} of ${proposable.length}) — ids and dates only:`);
    io.out("  id                 kind      now         ->  proposed    confidence  read from");
    for (const t of sample) {
      if (!t.outcome.ok) continue;
      const p = t.outcome.proposal;
      io.out(
        `  ${t.id.padEnd(18)} ${t.kind.padEnd(9)} ${t.learnedOn}  ->  ${p.date}  ${p.confidence.padEnd(10)}  ${p.from} (${p.how})`,
      );
    }
  }

  if (opts.apply !== true) {
    io.out("");
    io.out("Dry run. Nothing has changed. Re-run with --apply to write the dates.");
    return { plan, wouldWrite: proposable.length, written: 0, failures: [] };
  }

  if (proposable.length === 0) {
    io.out("");
    io.out("Nothing to do.");
    return { plan, wouldWrite: 0, written: 0, failures: [] };
  }

  const store = Store.open({ dir });
  const failures: string[] = [];
  let written = 0;
  try {
    for (const t of proposable) {
      if (!t.outcome.ok) continue;
      const p = t.outcome.proposal;
      try {
        // `revise` archives the prior document first, so the wrong date stays
        // readable in `versions/` — a correction, with its history kept.
        store.revise(t.id, { learnedOn: p.date, reason: "date.repaired" });
        store.appendEvent({
          name: "date.repaired",
          day: store.livedDay(),
          ref: t.id,
          payload: { from: t.learnedOn, to: p.date, confidence: p.confidence, how: p.how },
        });
        written += 1;
      } catch (err) {
        failures.push(`${t.id}: ${String((err as Error).message ?? err)}`);
      }
    }
  } finally {
    store.close();
  }

  io.out("");
  io.out(`Re-dated ${written} memories.`);
  for (const f of failures) io.err(`  FAILED ${f}`);
  return { plan, wouldWrite: proposable.length, written, failures };
}
