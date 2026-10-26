#!/usr/bin/env bun
/**
 * bun tools/harness/cli.ts replay [--source <snapshot copy>] [--returns derived|recorded]
 *                                 [--through-day N] [--early-days N] [--keep] [--json <out>]
 *
 * Prints the run record as numbers; `--json` also writes it whole. Ids, counts
 * and days only, never memory text. See tools/harness/README.md.
 */
import { writeFileSync } from "node:fs";

import { replayNight } from "./night.js";
import type { NightReplayRecord } from "./night.js";
import { runPhysicsReplay } from "./replay.js";
import { runWeek } from "./week.js";
import type { WeekRecord } from "./week.js";
import { OWNER_WEEK_MEANINGFUL } from "./owner-week.js";
import { CHECKINS_OWNER, OWNER_WEEK_CHECKINS } from "./checkins-week.js";
import type { RunRecord } from "./replay.js";
import { DEFAULT_CORPUS } from "./source.js";
import { runCompare } from "./compare.js";
import type { Mode } from "./compare.js";
import { applySettings, expandPreset } from "./settings.js";
import { assertOutsideLive, makeCorpus, renderCorpus } from "./corpus.js";

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Every value a repeated flag carries, refusing one with no value. */
function flags(args: readonly string[], name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a !== name) return;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    out.push(v);
  });
  return out;
}

export function render(r: RunRecord): string {
  const out: string[] = [];
  const s = r.source;
  out.push(`physics-only replay · source v${String(s.schemaVersion)}, day ${String(s.livedDay)}, ${String(s.memories)} memories (${String(s.chapterCopiesSkipped)} chapter copies left out) · returns ${r.mode.returns} · through day ${String(r.mode.throughDay)} · ${(r.elapsedMs / 1000).toFixed(1)}s`);
  if (s.eventsFrom > 0) out.push(`  ! the source's event log starts at day ${String(s.eventsFrom)}: uses before it are not in the record`);
  const g = r.gaps;
  out.push(`gaps: credit ids cut ${String(g.creditIdsCut)} · acts on unknown ids ${String(g.actsOnUnknownIds)} · uses before birth ${String(g.usesBeforeBirth)} · bodies from current row ${String(g.bodiesFromCurrentRow)} · merges undated ${String(g.mergesUndated)} · days dated by fallback ${String(g.daysDatedByFallback)}`);
  const refused = Object.entries(g.refused);
  if (refused.length > 0) out.push(`refused: ${refused.map(([k, n]) => `${k} ${String(n)}`).join(" · ")}`);
  out.push("");
  out.push("day  date        alive  core  born  uses fed/cred/ret  night fed/cnt  settles  promoted");
  for (const d of r.days) {
    out.push(
      [
        String(d.day).padStart(3),
        d.date,
        String(d.alive).padStart(6),
        String(d.identity).padStart(5),
        String(d.births).padStart(5),
        `${String(d.uses.fed)}/${String(d.uses.credited)}/${String(d.uses.returns)}`.padStart(17),
        `${String(d.nightReturns.fed)}/${String(d.nightReturns.counted)}`.padStart(14),
        `${String(d.settles.ok)}/${String(d.settles.fed)}`.padStart(8),
        String(d.promoted).padStart(9),
      ].join("  ") + (d.budgetExhausted.length > 0 ? `  budget: ${d.budgetExhausted.join(",")}` : ""),
    );
  }
  out.push("");
  out.push(`early core (every promotion through day ${String(r.mode.earlyDays)}: ${String(r.early.length)}):`);
  out.push("id                 day  lane  born  rank  returns/days/sessions  pool  recorded  behind it");
  for (const e of r.early) {
    out.push(
      [
        e.id.padEnd(17),
        String(e.day).padStart(4),
        (e.lane ?? "-").padStart(5),
        String(e.birthDay).padStart(5),
        String(e.birthRank).padStart(5),
        `${String(e.returns)}/${String(e.returnDays)}/${String(e.returnSessions)}`.padStart(22),
        String(e.pool).padStart(5),
        (e.recordedDay === null ? "no" : `day ${String(e.recordedDay)}`).padStart(9),
        e.sources,
      ].join("  "),
    );
  }
  if (r.early.length === 0) out.push("  (none)");
  const f = r.fidelity;
  if (f !== null) {
    out.push("");
    out.push("fidelity against the record:");
    out.push(`  uses: recorded ${String(f.uses.recorded)}, replayed ${String(f.uses.replayed)}; per memory exact ${String(f.uses.exact)}, short ${String(f.uses.short)}, over ${String(f.uses.over)} of ${String(f.uses.memories)}`);
    for (const [source, n] of Object.entries(f.awakeReturns)) {
      out.push(`  ${source} returns (id@day): recorded ${String(n.recorded)}, replayed ${String(n.replayed)}, matched ${String(n.matched)}`);
    }
    out.push(`  promotions: recorded ${String(f.promotions.recorded)}, replayed ${String(f.promotions.replayed)}, matched ${String(f.promotions.matched)} (same day ${String(f.promotions.sameDay)})`);
    out.push(`  archived: recorded ${String(f.archived.recorded)}, replayed ${String(f.archived.replayed)}, both ${String(f.archived.both)}`);
    for (const [from, to] of Object.entries(f.bands)) {
      out.push(`  band ${from} → ${Object.entries(to).map(([b, n]) => `${b} ${String(n)}`).join(", ")}`);
    }
  }
  if (r.keptAt !== null) out.push(`\nkept: ${r.keptAt}`);
  return out.join("\n");
}

/** The recorded night's record, as lines. Counts, states and verdicts only. */
export function renderNight(r: NightReplayRecord): string {
  const out: string[] = [];
  const v = (c: { recorded: unknown; replayed: unknown; same: boolean }): string => (c.same ? `same (${JSON.stringify(c.replayed)})` : `recorded ${JSON.stringify(c.recorded)}, replayed ${JSON.stringify(c.replayed)}`);
  out.push(`${r.seat === "harness:recorded" ? "recorded night, replayed" : `the night, with ${r.seat} in the seat`} · ${(r.elapsedMs / 1000).toFixed(1)}s · night ${r.night.state}${r.night.reason === null ? "" : ` (${r.night.reason}${r.night.detail === null ? "" : `: ${r.night.detail}`})`} · parts ${r.night.parts.join(",") || "none"} · children ${r.night.children.join(", ")}`);
  const words = (p: { wordsSame: boolean }): string => (p.wordsSame ? "same words" : "different words");
  out.push(`prompts: dream ${words(r.prompts.dream)}, length ${v(r.prompts.dream)}; reflection ${words(r.prompts.reflection)}, length ${v(r.prompts.reflection)}`);
  for (const [act, t] of Object.entries(r.calls)) {
    out.push(`${act}: ${String(t.calls)} calls, ${String(t.skipped)} skipped, ${String(t.refused)} refused, ${String(t.same)} answered the same`);
    for (const [phase, p] of Object.entries(t.byPhase)) out.push(`  ${phase}: ${String(p.calls)} · refused ${String(p.refused)} · same ${String(p.same)}`);
  }
  out.push(`ids mapped recorded→replayed: ${String(r.idsMapped)}`);
  if (r.dream !== null) {
    out.push(`dream: state ${v(r.dream.state)}; title ${r.dream.titleSame ? "same" : "differs"}; returns ${v(r.dream.returns)}`);
    out.push(`  changes ${v(r.dream.changes)}`);
  }
  if (r.reflection !== null) {
    out.push(`reflection (found by ${r.matchedBy}): state ${v(r.reflection.state)}; page version ${v(r.reflection.pageVersion)}; returns ${v(r.reflection.returns)}; cites ${v(r.reflection.cites)}`);
  }
  for (const [act, init] of Object.entries(r.childInits ?? {})) {
    if (init === null) out.push(`${act} child: said no init line (its output was not read)`);
    else out.push(`${act} child: plugins ${String(init.plugins.length)}${init.plugins.length === 0 ? "" : ` (${init.plugins.join(", ")})`} · servers ${init.servers.map((x) => `${x.name}:${x.status}`).join(", ") || "none"}`);
  }
  if (r.keptAt !== null) out.push(`kept: ${r.keptAt}`);
  return out.join("\n");
}

/** The week's record, as lines: per session, per night, per wake. Counts, states and labels only. */
export function renderWeek(r: WeekRecord): string {
  const out: string[] = [`${r.owner}'s first week (${r.script}, seat ${r.seat}) · ${String(r.days)} days · ${r.elapsedMs < 60_000 ? `${(r.elapsedMs / 1000).toFixed(1)} s` : `${(r.elapsedMs / 60_000).toFixed(1)} min`} · model calls ${String(r.modelCalls)}`];
  for (const x of r.sessions) {
    const c = x.coverage;
    const ledger = c === null ? "ledger: nothing captured" : `captured ${String(c.pieces)}, written ${String(c.written)}, unwritten ${String(c.unwritten)}${c.spanMin === null ? "" : ` over ${String(c.spanMin)} min`} · ${c.owed ? "OWED" : `not owed (${c.whyNot ?? "?"})`}`;
    const tools = x.remembers === null ? "" : ` · remember ${String(x.remembers)}${x.remembersRefused === 0 ? "" : ` (${String(x.remembersRefused)} refused)`}${x.chapters === null || (x.chapters === 0 && x.chaptersRefused === 0) ? "" : ` · chapter ${String(x.chapters)}${x.chaptersRefused === 0 ? "" : ` (${String(x.chaptersRefused)} refused)`}`} · asks answered ${String(x.asksAnswered)}, ignored ${String(x.asksIgnored)}`;
    out.push(`  ${x.label} ${x.scope}: ${String(x.turns)} turns · stops ${String(x.stops)}: asked ${String(x.asks)}, paced ${String(x.paced)}${Object.keys(x.stopReasons).length === 0 ? "" : ` (${Object.entries(x.stopReasons).map(([k, n]) => `${k} ${String(n)}`).join(", ")})`}${tools} · ${ledger} · footnotes ${String(x.footnotes)} · failed ${String(x.failedTurns)} · memories after ${String(x.memoriesAfter)}${x.init === null ? "" : ` · plugins ${String(x.init.plugins.length)}, servers ${x.init.servers.map((v) => `${v.name}:${v.status}`).join(",")}`}`);
  }
  for (const n of r.nights) {
    const cu = n.catchUp;
    const plan = cu === null ? "" : ` · catch-up: owed ${String(cu.owed)}${cu.planned.length === 0 ? "" : `, planned ${cu.planned.map((p) => `${p.session} (${String(p.parts)}/${String(p.of)} parts)`).join(", ")}`}${cu.ran === null ? "" : `, ran ${cu.ran.state} (granted ${String(cu.ran.granted)}, written ${String(cu.ran.written)}, left ${String(cu.ran.left)})`}`;
    out.push(`  night launched day ${String(n.day)} in ${n.launchedIn} (${n.kind}): ${n.state} (${n.parts.join(",") || "none"}) · asked ${n.asked.map((a) => a.act).join(", ") || "nothing"}${plan}`);
  }
  for (const k of r.wakes) {
    if (!k.morning) continue;
    out.push(`  wake ${k.label}: last here ${k.lastHere === null ? "none" : `${k.lastHere.session} (${k.lastHere.episode})`}${k.lastSaid === null ? "" : ` · last said ${k.lastSaid}`} · lines ${k.lines.join(", ") || "none"} · ${String(k.bytes)} bytes · dream gate ${k.gate.reason} (${String(k.gate.newSince)} new)`);
  }
  out.push(`  worker boundaries the product asked for: ${String(r.boundaries)}`);
  out.push(`  owed at the week's end: ${r.owedAtEnd.length === 0 ? "none" : r.owedAtEnd.join(", ")}`);
  for (const d of r.daily) out.push(`  end of day ${String(d.day)} ${d.date}: ${String(d.alive)} memories, core ${String(d.core)}`);
  if (r.out !== null) out.push(`store: ${r.out} (replay it: bun tools/harness/cli.ts replay --source ${r.out})`);
  if (r.keptAt !== null) out.push(`kept: ${r.keptAt}`);
  return out.join("\n");
}

async function main(argv: readonly string[]): Promise<number> {
  const [cmd, ...all] = argv;
  if (cmd === "compare") {
    // Everything after `--` is the mode's own; the compare's flags come before it.
    const cut = all.indexOf("--");
    const own = cut < 0 ? all : all.slice(0, cut);
    const passthrough = cut < 0 ? [] : all.slice(cut + 1);
    const KNOWN = ["--mode", "--base", "--branch", "--set", "--base-set", "--preset", "--base-preset", "--runs", "--pages"];
    own.forEach((a, i) => {
      if (a.startsWith("--") && !KNOWN.includes(a)) throw new Error(`compare has no ${a} (its own flags: ${KNOWN.join(" ")}; the mode's go after --)`);
      if (!a.startsWith("--") && (i === 0 || !KNOWN.includes(own[i - 1]!))) throw new Error(`compare doesn't take "${a}" here; the mode's flags go after --`);
    });
    const mode = flag(own, "--mode");
    if (mode !== "replay" && mode !== "night" && mode !== "week") throw new Error(`--mode must be replay, night or week, not ${mode ?? "(none)"}`);
    const runs = flag(own, "--runs");
    const { text } = runCompare({
      mode: mode as Mode,
      ...(flag(own, "--base") === undefined ? {} : { base: flag(own, "--base")! }),
      ...(flag(own, "--branch") === undefined ? {} : { branch: flag(own, "--branch")! }),
      set: flags(own, "--set"),
      baseSet: flags(own, "--base-set"),
      preset: flags(own, "--preset"),
      basePreset: flags(own, "--base-preset"),
      runs: runs === undefined ? 1 : /^\d+$/.test(runs) ? Number(runs) : NaN,
      passthrough,
      ...(flag(own, "--pages") === undefined ? {} : { pages: flag(own, "--pages")! }),
      onProgress: (line) => process.stderr.write(`${line}\n`),
    });
    process.stdout.write(text + "\n");
    return 0;
  }
  if (cmd === "corpus") {
    const own = ["--from", "--snapshots", "--out", "--json"];
    all.forEach((a, i) => {
      if (a.startsWith("--") && !own.includes(a)) throw new Error(`corpus has no ${a} (its flags: ${own.join(" ")})`);
      if (!a.startsWith("--") && (i === 0 || !own.includes(all[i - 1]!))) throw new Error(`corpus doesn't take "${a}"`);
    });
    for (const f of own) if (all.includes(f) && (flag(all, f) === undefined || flag(all, f)!.startsWith("--"))) throw new Error(`${f} needs a value`);
    // The record is a write too: refused under ~/.counterparts before anything is copied.
    if (flag(all, "--json") !== undefined) assertOutsideLive(flag(all, "--json")!, "the --json record");
    const record = makeCorpus({
      ...(flag(all, "--from") === undefined ? {} : { from: flag(all, "--from")! }),
      ...(flag(all, "--snapshots") === undefined ? {} : { snapshots: flag(all, "--snapshots")! }),
      ...(flag(all, "--out") === undefined ? {} : { out: flag(all, "--out")! }),
    });
    process.stdout.write(renderCorpus(record) + "\n");
    const json = flag(all, "--json");
    if (json !== undefined) writeFileSync(json, JSON.stringify(record, null, 2));
    return 0;
  }
  const args = all;
  // A SETTING FOR THIS RUN (`settings.ts`), set before anything reads it; a preset is its settings, first.
  applySettings([...flags(args, "--preset").flatMap(expandPreset), ...flags(args, "--set")]);
  if (cmd === "week") {
    const days = flag(args, "--days");
    const scriptName = flag(args, "--script");
    // A bare --script is refused too: a paid run of the wrong week costs more than an error.
    if (args.includes("--script") && scriptName !== "plain" && scriptName !== "meaningful" && scriptName !== "checkins") throw new Error(`UNKNOWN_SCRIPT: ${scriptName ?? "(none)"} (plain, meaningful or checkins)`);
    const seatName = flag(args, "--seat");
    if (args.includes("--seat") && seatName !== "model" && seatName !== "scripted") throw new Error(`UNKNOWN_SEAT: ${seatName ?? "(none)"} (model or scripted)`);
    // No model sits in a scripted seat, so naming one is a mistake, not a choice.
    if (seatName === "scripted" && args.includes("--model")) throw new Error("--model has no seat to sit in with --seat scripted");
    const record = await runWeek({
      ...(scriptName === "meaningful" ? { script: OWNER_WEEK_MEANINGFUL, scriptName } : {}),
      ...(scriptName === "checkins" ? { script: OWNER_WEEK_CHECKINS, scriptName, owner: CHECKINS_OWNER } : {}),
      ...(seatName === "scripted" ? { seat: "scripted" as const } : {}),
      ...(days === undefined ? {} : { days: Number(days) }),
      ...(args.includes("--no-nights") ? { nights: false } : {}),
      ...(flag(args, "--out") === undefined ? {} : { out: flag(args, "--out")! }),
      ...((): { model?: string } => {
        const v = flag(args, "--model");
        return v === undefined || v.startsWith("--") ? {} : { model: v };
      })(),
      keep: args.includes("--keep"),
      ...(flag(args, "--page-out") === undefined ? {} : { pageOut: flag(args, "--page-out")! }),
      onProgress: (line) => process.stderr.write(`${line}\n`),
    });
    process.stdout.write(renderWeek(record) + "\n");
    const json = flag(args, "--json");
    if (json !== undefined) writeFileSync(json, JSON.stringify(record, null, 2));
    return 0;
  }
  if (cmd === "night") {
    const dir = flag(args, "--dir");
    const pick = (name: string, file: string): string => {
      const v = flag(args, name) ?? (dir === undefined ? undefined : `${dir}/${file}`);
      if (v === undefined) throw new Error(`${name} or --dir is needed`);
      return v;
    };
    const record = await replayNight({
      source: pick("--source", "pre-night.sqlite"),
      outcome: flag(args, "--outcome") ?? (dir === undefined ? pick("--outcome", "") : `${dir}/../counterparts.sqlite`),
      dreamTranscript: pick("--dream", "dream-child.jsonl"),
      reflectionTranscript: pick("--reflection", "reflection-child.jsonl"),
      keep: args.includes("--keep"),
      ...(flag(args, "--page-out") === undefined ? {} : { pageOut: flag(args, "--page-out")! }),
      ...(flag(args, "--time-zone") === undefined ? {} : { timeZone: flag(args, "--time-zone")! }),
      ...(flag(args, "--budget") === undefined ? {} : { budgetBytes: Number(flag(args, "--budget")) }),
      ...(args.includes("--no-embed") ? { embed: false } : {}),
      ...(args.includes("--model") ? { seat: "model" as const } : {}),
      // `--model <name>`: the name when one follows (`--model opus`), else Claude Code's default.
      ...((): { model?: string } => {
        const v = flag(args, "--model");
        return v === undefined || v.startsWith("--") ? {} : { model: v };
      })(),
    });
    process.stdout.write(renderNight(record) + "\n");
    const json = flag(args, "--json");
    if (json !== undefined) writeFileSync(json, JSON.stringify(record, null, 2));
    return 0;
  }
  if (cmd !== "replay") {
    process.stderr.write(
      "usage: bun tools/harness/cli.ts replay [--source <copy>] [--returns derived|recorded] [--through-day N] [--early-days N] [--keep] [--json <out>]\n" +
        "       bun tools/harness/cli.ts compare --mode replay|night|week [--branch <ref>] [--base <ref>] [--set module.KEY=V]… [--base-set …] [--preset <name>] [--base-preset <name>] [--runs N] [--pages <dir>] -- <the mode's own flags>\n" +
        "       (replay, night and week also take --set module.KEY=V and --preset <name>, and night and week --page-out <file>)\n" +
        "       bun tools/harness/cli.ts corpus [--from <snapshot folder>] [--snapshots <dir>] [--out <dir>] [--json <out>]\n" +
        "       bun tools/harness/cli.ts week [--script plain|meaningful|checkins] [--seat model|scripted] [--days N] [--no-nights] [--model <name>] [--out <week.sqlite>] [--keep] [--json <out>]\n" +
        "       bun tools/harness/cli.ts night --dir <night folder> | --source <pre-night copy> --outcome <after copy> --dream <transcript> --reflection <transcript> [--model [<name>]] [--time-zone Z] [--budget N] [--no-embed] [--keep] [--json <out>]\n",
    );
    return 2;
  }
  const returns = flag(args, "--returns") ?? "derived";
  if (returns !== "derived" && returns !== "recorded") throw new Error(`--returns must be derived or recorded, not ${returns}`);
  const whole = (name: string): number | undefined => {
    const v = flag(args, name);
    if (v === undefined) return undefined;
    if (!/^\d+$/.test(v)) throw new Error(`${name} takes a whole number of days, not ${v}`);
    return Number(v);
  };
  const through = whole("--through-day");
  const early = whole("--early-days");
  const record = await runPhysicsReplay({
    source: flag(args, "--source") ?? DEFAULT_CORPUS,
    returns,
    ...(through === undefined ? {} : { throughDay: through }),
    ...(early === undefined ? {} : { earlyDays: early }),
    keep: args.includes("--keep"),
    onDay: (d, total) => process.stderr.write(`\rday ${String(d)}/${String(total)}`),
  });
  process.stderr.write("\n");
  process.stdout.write(render(record) + "\n");
  const json = flag(args, "--json");
  if (json !== undefined) writeFileSync(json, JSON.stringify(record, null, 2));
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
