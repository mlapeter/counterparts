/**
 * TWO SIDES, ONE TABLE (2026-10-21, `harness compare`): the same harness run
 * on a base and a variant, side by side, so a change is read against the build
 * it changes instead of against memory.
 *
 * A side is a build (the current checkout, or a ref in a fresh detached
 * worktree) plus the settings it runs with (`settings.ts`). Each run of each
 * side is its own `bun tools/harness/cli.ts <mode> …` subprocess, from that
 * side's own checkout, on its own copy of the input. So a base never opens a
 * store the variant migrated, and each side's tokens are its own.
 *
 * Everything after `--` goes to the mode as given (`--source`, `--dir`,
 * `--script`, `--model`, …). The runs go one after another. A model run is
 * one sample, so `--runs N` repeats each side, and the table shows the
 * spread beside the difference.
 *
 * Page words are written to the compare's scratch, diffed there and removed,
 * unless `--pages <dir>` keeps them. They never go into a record.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expandPreset, parseSetting } from "./settings.js";

export type Mode = "replay" | "night" | "week";

export interface CompareOptions {
  readonly mode: Mode;
  /** The base's ref; absent, the current checkout. */
  readonly base?: string;
  /** The variant's ref; absent, the same build as the base. */
  readonly branch?: string;
  /** Settings for the variant side (`module.KEY=VALUE`). */
  readonly set: readonly string[];
  /** Settings for the base side, when it isn't the build as it is. */
  readonly baseSet: readonly string[];
  /** Named sets of settings (`settings.ts#PRESETS`) for the variant, expanded ahead of `set`. */
  readonly preset?: readonly string[];
  /** The same for the base, ahead of `baseSet`. */
  readonly basePreset?: readonly string[];
  readonly runs: number;
  /** Passed to the mode as given. */
  readonly passthrough: readonly string[];
  /** Keep each run's page words here. */
  readonly pages?: string;
  /** The repository the refs are read from (default: the one this file is in). */
  readonly repo?: string;
  readonly onProgress?: (line: string) => void;
}

export interface SidePlan {
  readonly name: "base" | "variant";
  /** A ref to check out, or null for the current checkout. */
  readonly ref: string | null;
  /** Every setting, a preset's expanded first. */
  readonly set: readonly string[];
  /** The presets it came from, by name (the table's header names these, not their settings). */
  readonly presets?: readonly string[];
}

export class CompareError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/** The mode flags that name a file or folder: made absolute, since each side runs from its own checkout. */
const PATH_FLAGS = ["--source", "--dir", "--outcome", "--dream", "--reflection"];

/** The passthrough with its paths made absolute against `cwd`. Pure. */
export function absolutePaths(passthrough: readonly string[], cwd: string): string[] {
  return passthrough.map((a, i) => (i > 0 && PATH_FLAGS.includes(passthrough[i - 1]!) && !a.startsWith("--") ? resolve(cwd, a) : a));
}

/** Flags the compare owns: passing one through would split a side from its record. */
const OWNED = ["--json", "--set", "--preset", "--page-out", "--keep", "--out"];

/** The two sides, refusing a compare where nothing differs. Pure. */
export function planSides(o: Pick<CompareOptions, "base" | "branch" | "set" | "baseSet" | "preset" | "basePreset" | "runs" | "passthrough" | "mode">): readonly [SidePlan, SidePlan] {
  for (const f of OWNED) if (o.passthrough.includes(f)) throw new CompareError("COMPARE_OWNS_FLAG", `${f} is set by compare itself; leave it out after --`);
  if (!Number.isInteger(o.runs) || o.runs < 1) throw new CompareError("COMPARE_RUNS", `--runs takes a whole number from 1, not ${String(o.runs)}`);
  // A preset is its settings, ahead of the side's own: each is checked and recorded one by one,
  // and a --set naming one of its keys is refused as set twice.
  const basePresets = o.basePreset ?? [];
  const presets = o.preset ?? [];
  const base: SidePlan = { name: "base", ref: o.base ?? null, set: [...basePresets.flatMap(expandPreset), ...o.baseSet], presets: basePresets };
  const variant: SidePlan = { name: "variant", ref: o.branch ?? o.base ?? null, set: [...presets.flatMap(expandPreset), ...o.set], presets };
  for (const side of [base, variant]) {
    const seen = new Set<string>();
    for (const t of side.set) {
      const key = t.trim().split("=")[0]!;
      if (seen.has(key)) throw new CompareError("COMPARE_SET_TWICE", `${key} is set twice on the ${side.name} (a preset and a --set, or two presets)`);
      seen.add(key);
    }
  }
  const same = base.ref === variant.ref && base.set.join(";") === variant.set.join(";");
  // The same build twice is a noise check: worth it only with repeats.
  if (same && o.runs < 2) throw new CompareError("COMPARE_NOTHING_DIFFERS", "the sides are the same build and settings; name --branch or --set, or --runs 2+ for a noise check");
  return [base, variant];
}

/** One run's subprocess arguments. Pure. */
export function runArgs(mode: Mode, side: SidePlan, passthrough: readonly string[], json: string, pageOut: string | null): string[] {
  return [
    "tools/harness/cli.ts",
    mode,
    ...passthrough,
    ...side.set.flatMap((s) => ["--set", s]),
    "--json",
    json,
    ...(pageOut === null || mode === "replay" ? [] : ["--page-out", pageOut]),
  ];
}

interface Checkout {
  readonly dir: string;
  readonly sha: string;
  readonly dirty: boolean;
  readonly remove: () => void;
}

function git(repo: string, args: readonly string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new CompareError("COMPARE_GIT", `git ${args.join(" ")}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** The current checkout, or a ref in a fresh detached worktree beside the repo's own. */
function checkout(repo: string, ref: string | null, label: string): Checkout {
  if (ref === null) {
    return { dir: repo, sha: git(repo, ["rev-parse", "HEAD"]), dirty: git(repo, ["status", "--porcelain"]) !== "", remove: () => {} };
  }
  const sha = git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]);
  const root = join(git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "..", ".claude", "worktrees");
  mkdirSync(root, { recursive: true });
  const dir = join(root, `harness-compare-${String(process.pid)}-${label}`);
  git(repo, ["worktree", "add", "-q", "--detach", dir, sha]);
  const remove = (): void => {
    spawnSync("git", ["-C", repo, "worktree", "remove", "--force", dir]);
  };
  try {
    const modules = join(repo, "node_modules");
    if (existsSync(modules) && !existsSync(join(dir, "node_modules"))) symlinkSync(modules, join(dir, "node_modules"));
  } catch (err) {
    remove();
    throw err;
  }
  return { dir, sha, dirty: false, remove };
}

/** What one run's record says, in the numbers the table shows; absent fields are null (an older build's record). */
export interface Reading {
  readonly ok: boolean;
  readonly error: string | null;
  readonly elapsedMs: number | null;
  readonly tokens: number | null;
  readonly costUsd: number | null;
  readonly calls: number | null;
  /** Children that ran but said no usage (a crash, a timeout): their tokens are missing from `tokens`. */
  readonly unread: number | null;
  readonly settings: readonly string[];
  /** Named rows, mode by mode: a number, a string, or null. */
  readonly rows: Readonly<Record<string, number | string | null>>;
  /** The page's words, when it was read. */
  readonly pageText: string | null;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const obj = (x: unknown): Record<string, unknown> => (x !== null && typeof x === "object" ? (x as Record<string, unknown>) : {});

/** The rows a record gives, by mode. Pure. */
export function readRecord(mode: Mode, rec: Record<string, unknown>, pageText: string | null): Reading {
  const rows: Record<string, number | string | null> = {};
  // The build the run ran, first (2026-10-22): `package.json#version`, or "unknown"; null from a build before the stamp.
  rows["build"] = typeof rec["build"] === "string" ? rec["build"] : null;
  const usage = obj(rec["usage"]);
  const tokens = rec["usage"] === undefined ? null : ["input", "output", "cacheRead", "cacheCreate"].reduce((a, k) => a + (num(usage[k]) ?? 0), 0);
  const page = rec["page"] === undefined ? undefined : rec["page"] === null ? null : obj(rec["page"]);
  if (mode === "replay") {
    const days = Array.isArray(rec["days"]) ? (rec["days"] as Record<string, unknown>[]) : [];
    const last = days[days.length - 1];
    // The core on the first, the weekly and the last day: enough to see when it forms and where it ends.
    const marks = new Set<number>();
    for (const d of days) {
      const n = num(d["day"]) ?? -1;
      if (n === 1 || (n > 0 && n % 7 === 0)) marks.add(n);
    }
    if (last !== undefined) marks.add(num(last["day"]) ?? -1);
    for (const d of days) if (marks.has(num(d["day"]) ?? -1)) rows[`core, day ${String(num(d["day"]))}`] = num(d["identity"]);
    rows["promoted, all days"] = days.reduce((a, d) => a + (num(d["promoted"]) ?? 0), 0);
    rows["early promotions"] = Array.isArray(rec["early"]) ? (rec["early"] as unknown[]).length : null;
    rows["alive, last day"] = last === undefined ? null : num(last["alive"]);
    // What decay, use and the prune move (2026-10-22); null from a build before these fields.
    rows["semantic, last day"] = last === undefined ? null : num(last["semantic"]);
    rows["below reach, last day"] = last === undefined ? null : num(last["belowReach"]);
    rows["pruned, through the last day"] = last === undefined ? null : num(last["pruned"]);
  } else if (mode === "night") {
    const night = obj(rec["night"]);
    rows["night"] = typeof night["state"] === "string" ? night["state"] : null;
    const dream = rec["dream"] === null || rec["dream"] === undefined ? null : obj(rec["dream"]);
    const changes = dream === null ? {} : obj(obj(dream["changes"])["replayed"]);
    for (const [k, v] of Object.entries(changes).sort()) rows[`dream ${k}`] = num(v);
    rows["dream returns"] = dream === null ? null : num(obj(dream["returns"])["replayed"]);
    const refl = rec["reflection"] === null || rec["reflection"] === undefined ? null : obj(rec["reflection"]);
    rows["reflection cites"] = refl === null ? null : num(obj(refl["cites"])["replayed"]);
    rows["reflection returns"] = refl === null ? null : num(obj(refl["returns"])["replayed"]);
  } else {
    const daily = Array.isArray(rec["daily"]) ? (rec["daily"] as Record<string, unknown>[]) : [];
    for (const d of daily) rows[`core, end of day ${String(num(d["day"]))}`] = num(d["core"]);
    // Lane F: the core from beliefs (`week.ts#beliefCoreNow`), when the record has it.
    for (const d of daily) if (d["beliefCore"] !== undefined) rows[`core from beliefs, end of day ${String(num(d["day"]))}`] = num(d["beliefCore"]);
    const last = daily[daily.length - 1];
    rows["memories, last day"] = last === undefined ? null : num(last["alive"]);
    const nights = Array.isArray(rec["nights"]) ? (rec["nights"] as Record<string, unknown>[]) : [];
    rows["nights done"] = nights.filter((n) => n["state"] === "done").length;
    const sessions = Array.isArray(rec["sessions"]) ? (rec["sessions"] as Record<string, unknown>[]) : [];
    rows["footnotes shown"] = sessions.reduce((a, s) => a + (num(s["footnotes"]) ?? 0), 0);
    rows["failed turns"] = sessions.reduce((a, s) => a + (num(s["failedTurns"]) ?? 0), 0);
    // Tier 0's own readings (2026-10-26), when the record has them: what the Stop asked, what was owed, what the nights planned.
    if (rec["modelCalls"] !== undefined) rows["model children started"] = num(rec["modelCalls"]);
    if (sessions.some((s) => s["stops"] !== undefined)) rows["Stop asks raised"] = sessions.reduce((a, s) => a + (num(s["asks"]) ?? 0), 0);
    if (sessions.some((s) => s["coverage"] !== undefined)) rows["sessions owed at their end"] = sessions.filter((s) => obj(s["coverage"])["owed"] === true).length;
    if (Array.isArray(rec["owedAtEnd"])) rows["sessions owed at the week's end"] = (rec["owedAtEnd"] as unknown[]).length;
    if (Array.isArray(rec["wakes"])) rows["night catch-up parts planned"] = nights.reduce((a, n) => a + (Array.isArray(obj(n["catchUp"])["planned"]) ? (obj(n["catchUp"])["planned"] as Record<string, unknown>[]).reduce((b, p) => b + (num(p["parts"]) ?? 0), 0) : 0), 0);
    if (Array.isArray(rec["wakes"]) && (rec["wakes"] as Record<string, unknown>[]).some((k) => k["doctor"] !== undefined)) rows["mornings doctor's Catch-up is amber"] = (rec["wakes"] as Record<string, unknown>[]).filter((k) => obj(k["doctor"])["severity"] === "amber").length;
    if (Array.isArray(rec["wakes"])) rows["mornings with a Last here"] = (rec["wakes"] as Record<string, unknown>[]).filter((k) => k["morning"] === true && k["lastHere"] !== null).length;
  }
  if (mode !== "replay") {
    rows["page version"] = page === undefined ? null : page === null ? "none" : typeof page["error"] === "string" ? "unread" : num(page["version"]);
    rows["page bytes"] = page === undefined || page === null ? null : num(page["bytes"]);
    rows["page claims"] = page === undefined || page === null ? null : num(page["claims"]);
    rows["page cites"] = page === undefined || page === null ? null : num(page["cites"]);
    rows["page uncited claims"] = page === undefined || page === null ? null : num(page["uncited"]);
  }
  // Settled things over the run's whole record (lane R, `settled.ts`): every mode, when the record has it.
  if (rec["settled"] !== undefined) {
    const s = rec["settled"] === null ? null : obj(rec["settled"]);
    rows["settled pairs"] = s === null ? "unread" : num(s["pairs"]);
    rows["settled drawn on again"] = s === null ? null : num(s["repeats"]);
    rows["settled came up again"] = s === null ? null : num(s["reraised"]);
    // Beside it, not in it (review of #596); absent from a record before the split.
    rows["settled: the winner in a newer pair"] = s === null ? null : num(s["viaWinner"]);
    rows["settled shown only"] = s === null ? null : num(s["shownOnly"]);
  }
  const settings = Array.isArray(rec["settings"]) ? (rec["settings"] as Record<string, unknown>[]).map((s) => `${String(s["module"])}.${String(s["key"])}=${String(s["value"])}`) : [];
  return {
    ok: true,
    error: null,
    elapsedMs: num(rec["elapsedMs"]),
    tokens,
    costUsd: rec["usage"] === undefined ? null : num(usage["costUsd"]),
    calls: rec["usage"] === undefined ? null : num(usage["calls"]),
    unread: rec["usage"] === undefined ? null : num(usage["unread"]),
    settings,
    rows,
    pageText,
  };
}

/** Lines in `b` not in `a`, plus lines in `a` not in `b` (a multiset difference): how much the page moved. Pure. */
export function linesChanged(a: string, b: string): number {
  const count = (t: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const l of t.split("\n")) if (l.trim() !== "") m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const ma = count(a);
  const mb = count(b);
  let diff = 0;
  for (const [l, n] of mb) diff += Math.max(0, n - (ma.get(l) ?? 0));
  for (const [l, n] of ma) diff += Math.max(0, n - (mb.get(l) ?? 0));
  return diff;
}

/** Do the record's settings say what the side asked for? Values compared as values (`1` and `1.0` are the same). Pure. */
export function sameSettings(recorded: readonly string[], asked: readonly string[]): boolean {
  const norm = (xs: readonly string[]): string =>
    xs
      .map((x) => {
        const at = x.indexOf("=");
        const v = x.slice(at + 1);
        return `${x.slice(0, at)}=${v === "true" || v === "false" || !Number.isFinite(Number(v)) ? v : String(Number(v))}`;
      })
      .sort()
      .join(";");
  return norm(recorded) === norm(asked);
}

const show = (v: number | string | null): string => (v === null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v);

/** One side's runs as one cell: the value when the runs agree, else each run's. Pure. */
export function cell(values: readonly (number | string | null)[]): string {
  if (values.length === 0) return "—";
  const shown = values.map(show);
  return shown.every((s) => s === shown[0]) ? shown[0]! : shown.join(" / ");
}

export interface SideResult {
  readonly plan: SidePlan;
  readonly sha: string;
  readonly dirty: boolean;
  readonly runs: readonly Reading[];
}

/** The table, as text. Pure. */
export function renderCompare(mode: Mode, sides: readonly [SideResult, SideResult]): string {
  const [base, variant] = sides;
  const out: string[] = [];
  const name = (s: SideResult): string => {
    // A preset is named, not listed: its settings are in each run's record.
    const presets = s.plan.presets ?? [];
    const own = s.plan.set.slice(presets.reduce((a, p) => a + expandPreset(p).length, 0));
    const said = [...presets.map((p) => `preset ${p} (${String(expandPreset(p).length)} settings)`), ...own];
    return `${s.plan.ref ?? "checkout"} ${s.sha.slice(0, 8)}${s.dirty ? " (uncommitted changes)" : ""}${said.length === 0 ? "" : ` · ${said.join(", ")}`}`;
  };
  out.push(`harness compare · ${mode} · ${String(base.runs.length)} run${base.runs.length === 1 ? "" : "s"} a side`);
  out.push(`  base:    ${name(base)}`);
  out.push(`  variant: ${name(variant)}`);
  for (const s of sides) {
    s.runs.forEach((r, i) => {
      if (!r.ok) out.push(`  ${s.plan.name} run ${String(i + 1)} FAILED: ${r.error ?? "?"}`);
      const asked = s.plan.set.join(";");
      if (r.ok && sameSettings(r.settings, s.plan.set) === false) out.push(`  ${s.plan.name} run ${String(i + 1)}: its record says settings [${r.settings.join(", ")}], asked [${s.plan.set.join(", ")}] (an older build ignores --set)`);
    });
  }
  const keys: string[] = [];
  for (const s of sides) for (const r of s.runs) for (const k of Object.keys(r.rows)) if (!keys.includes(k)) keys.push(k);
  const rows: [string, string, string, string][] = [];
  for (const k of keys) {
    const a = base.runs.filter((r) => r.ok).map((r) => r.rows[k] ?? null);
    const b = variant.runs.filter((r) => r.ok).map((r) => r.rows[k] ?? null);
    const ca = cell(a);
    const cb = cell(b);
    rows.push([k, ca, cb, ca === cb ? "" : "≠"]);
  }
  if (mode !== "replay") {
    const texts = (s: SideResult): (string | null)[] => s.runs.map((r) => r.pageText);
    const ta = texts(base);
    const tb = texts(variant);
    const changed: number[] = [];
    for (let i = 0; i < Math.min(ta.length, tb.length); i++) if (ta[i] !== null && tb[i] !== null) changed.push(linesChanged(ta[i]!, tb[i]!));
    if (changed.length > 0) rows.push(["page lines differing, variant vs base", "", cell(changed), ""]);
    // The noise floor: how far a side's own runs differ from each other.
    const spread = (t: (string | null)[]): number[] => (t.length < 2 || t[0] === null ? [] : t.slice(1).filter((x): x is string => x !== null).map((x) => linesChanged(t[0]!, x)));
    const sa = spread(ta);
    const sb = spread(tb);
    if (sa.length > 0 || sb.length > 0) rows.push(["page lines differing, run 1 vs later runs", cell(sa), cell(sb), ""]);
  }
  const usage = (s: SideResult, f: (r: Reading) => number | null): (number | null)[] => s.runs.filter((r) => r.ok).map(f);
  rows.push(["model calls", cell(usage(base, (r) => r.calls)), cell(usage(variant, (r) => r.calls)), ""]);
  const unread = (s: SideResult): (number | null)[] => usage(s, (r) => r.unread);
  if ([...unread(base), ...unread(variant)].some((x) => x !== null && x > 0)) rows.push(["children with no usage line", cell(unread(base)), cell(unread(variant)), ""]);
  rows.push(["tokens (all, incl. cache)", cell(usage(base, (r) => r.tokens)), cell(usage(variant, (r) => r.tokens)), ""]);
  rows.push(["minutes", cell(usage(base, (r) => (r.elapsedMs === null ? null : Math.round(r.elapsedMs / 6000) / 10))), cell(usage(variant, (r) => (r.elapsedMs === null ? null : Math.round(r.elapsedMs / 6000) / 10))), ""]);
  const w0 = Math.max(...rows.map((r) => r[0].length), 4);
  const w1 = Math.max(...rows.map((r) => r[1].length), 4);
  const w2 = Math.max(...rows.map((r) => r[2].length), 7);
  out.push("");
  out.push(`  ${"".padEnd(w0)}  ${"base".padEnd(w1)}  ${"variant".padEnd(w2)}`);
  for (const [k, a, b, d] of rows) out.push(`  ${k.padEnd(w0)}  ${a.padEnd(w1)}  ${b.padEnd(w2)}  ${d}`.trimEnd());
  if (base.runs.length === 1 && mode !== "replay") out.push("", "  One run a side: a model's run is one sample. --runs 2+ shows how much a side differs from itself.");
  return out.join("\n");
}

/** Parses each setting with the checkout's own `settings.ts`; exits 1 with the refusal. */
const SETTINGS_CHECK =
  'const m = await import("./tools/harness/settings.ts"); try { for (const t of JSON.parse(process.argv[1])) m.parseSetting(t); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); }';

/** Run the compare: sides, runs, the table. Removes its worktrees and scratch whatever happens. */
export function runCompare(o: CompareOptions): { readonly text: string; readonly sides: readonly [SideResult, SideResult] } {
  const sides = planSides(o);
  // A side on this checkout reads its settings with this build: refused here, before anything runs.
  // (A ref's build checks its own when its run starts.)
  for (const side of sides) if (side.ref === null) for (const t of side.set) parseSetting(t);
  const repo = resolve(o.repo ?? join(import.meta.dir, "..", ".."));
  const say = o.onProgress ?? (() => {});
  const pages = o.pages === undefined ? undefined : resolve(o.pages);
  const passthrough = absolutePaths(o.passthrough, process.cwd());
  const scratch = mkdtempSync(join(tmpdir(), "harness-compare-"));
  if (pages !== undefined) mkdirSync(pages, { recursive: true });
  const checkouts: Checkout[] = [];
  try {
    if (sides.some((s) => s.ref !== null)) spawnSync("git", ["-C", repo, "fetch", "-q", "origin"]);
    // Both builds first: a bad ref is found before any run spends anything.
    const made = new Map<string | null, Checkout>();
    for (const side of sides) {
      if (made.has(side.ref)) continue;
      const co = checkout(repo, side.ref, side.name);
      made.set(side.ref, co);
      checkouts.push(co);
    }
    // A ref's settings, read by that ref's own build before anything runs (a build from before
    // `settings.ts` has none to check, and the table says it ignored them).
    for (const side of sides) {
      const co = made.get(side.ref)!;
      if (side.ref === null || side.set.length === 0 || !existsSync(join(co.dir, "tools", "harness", "settings.ts"))) continue;
      const check = spawnSync(process.execPath, ["-e", SETTINGS_CHECK, JSON.stringify(side.set)], { cwd: co.dir, encoding: "utf8" });
      if (check.status !== 0) throw new CompareError("COMPARE_SETTING", `${side.name} (${side.ref}): ${(check.stderr || check.stdout).trim()}`);
    }
    const results: SideResult[] = [];
    for (const side of sides) {
      const co = made.get(side.ref)!;
      const runs: Reading[] = [];
      for (let i = 1; i <= o.runs; i++) {
        const json = join(scratch, `${side.name}-${String(i)}.json`);
        const pageOut = o.mode === "replay" ? null : join(pages ?? scratch, `${side.name}-${String(i)}.page.md`);
        say(`${side.name} run ${String(i)}/${String(o.runs)} (${o.mode}) …`);
        const r = spawnSync(process.execPath, runArgs(o.mode, side, passthrough, json, pageOut), { cwd: co.dir, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
        if (r.status !== 0 || !existsSync(json)) {
          runs.push({ ok: false, error: (r.stderr || r.stdout || `exit ${String(r.status)}`).trim().split("\n").slice(-3).join(" | "), elapsedMs: null, tokens: null, costUsd: null, calls: null, unread: null, settings: [], rows: {}, pageText: null });
          continue;
        }
        const text = pageOut !== null && existsSync(pageOut) ? readFileSync(pageOut, "utf8") : null;
        runs.push(readRecord(o.mode, JSON.parse(readFileSync(json, "utf8")) as Record<string, unknown>, text));
      }
      results.push({ plan: side, sha: co.sha, dirty: co.dirty, runs });
    }
    const pair = [results[0]!, results[1]!] as const;
    return { text: renderCompare(o.mode, pair), sides: pair };
  } finally {
    for (const c of checkouts) c.remove();
    rmSync(scratch, { recursive: true, force: true });
  }
}
