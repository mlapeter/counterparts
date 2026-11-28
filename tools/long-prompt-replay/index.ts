/**
 * LONG-PROMPT REPLAY — does ambient recall miss the request inside a long
 * prompt, on the owner's real use? A diagnosis tool: it reads a store COPY and
 * the owner's Claude Code transcripts, never writes either, and prints ids,
 * counts, lengths, positions and scores only.
 *
 *   bun tools/long-prompt-replay/index.ts <command> --store <copy dir> --work <private work dir>
 *       [--transcripts <root>] [--scopes <scopes.json>] [--limit N]
 *
 *   join      align each ambient `recall.decision` row to the prompt it answered,
 *             validated by recomputing the turn's cue words (writes work/aligned.jsonl)
 *   describe  lengths, origins, cue eligibility and cue positions of aligned turns
 *   replay    the real `recallForTurn` (observer) over each long aligned turn,
 *             born-before filtered, for the four text variants (writes work/replay.jsonl)
 *   report    reproduction, the rated denominator and the variant overlaps
 *   handread  the PRIVATE hand-read sheet (writes the path given by --out)
 *
 * PRIVACY: the work dir holds prompt text (aligned.jsonl, mode 0600) and must
 * live outside the repo; `--work` inside a git checkout is refused. Nothing the
 * tool prints carries text, except `handread`, whose output goes only to --out.
 *
 * SAFETY: the store must be a copy. A store dir under ~/.counterparts is refused,
 * the Counterpart is opened as an observer, and the store's event and memory
 * counts are checked unchanged at the end of `replay`.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Counterpart } from "../../src/core/counterpart.ts";
import { stripBoilerplate } from "../../src/core/recall/cues.ts";
import { openStaticEmbedder } from "../../src/adapters/claude-code/embed-client.ts";
import { startedByHost } from "../../src/adapters/claude-code/transcript.ts";
import type { Store } from "../../src/core/store/index.ts";
import { analyseCues, keptTerms } from "./cues.ts";
import { readStoreData, type DecisionRow, type StoreData } from "./data.ts";
import { locateTranscripts, readTranscript, type PromptEntry } from "./transcripts.ts";
import { wrapBornBefore } from "./born-before.ts";

// ── arguments and guards ─────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const command = argv[0] ?? "";
function arg(name: string, fallback?: string): string {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`--${name} is required`);
  return v;
}
const storeDir = resolve(arg("store"));
const workDir = resolve(arg("work"));
const limit = Number(arg("limit", "0")) || Infinity;

if (storeDir.startsWith(resolve(homedir(), ".counterparts"))) throw new Error("refusing: --store is under ~/.counterparts (use a copy)");
for (let d = workDir; d !== "/" && d.length > 1; d = resolve(d, "..")) {
  if (existsSync(join(d, ".git"))) throw new Error("refusing: --work is inside a git checkout (it holds private text)");
}
mkdirSync(workDir, { recursive: true });

/** Long-prompt thresholds (stripped characters). */
const THRESHOLDS = [2000, 5000, 10000] as const;
const LONG = 2000;
/** A recorded cue row is matched when at least this share of its terms is in the recomputed window. */
const ALIGN_SHARE = 0.8;

const pct = (n: number, d: number): string => (d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}%`);
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] as number;
}

// ── the store copy, opened once ──────────────────────────────────────────────

function openCopy(): { cp: Counterpart; store: Store } {
  const emb = openStaticEmbedder({});
  const cp = Counterpart.open({ dir: storeDir, observer: true, embed: emb.embed } as Parameters<typeof Counterpart.open>[0]);
  const store = (cp as unknown as { store: Store }).store;
  const opened = resolve((store as unknown as { dir: string }).dir);
  console.log(`opened data dir: ${opened} (copy: ${opened === storeDir ? "yes" : "NO"}) observer: ${cp.observer}`);
  if (opened !== storeDir || !cp.observer) throw new Error("refusing: the opened store is not the named copy as an observer");
  return { cp, store };
}

// ── aligned turns (private file) ─────────────────────────────────────────────

interface Aligned {
  seq: number;
  session: string;
  turn: number;
  day: number;
  at: number;
  budgetBytes: number | null;
  footnotes: string[];
  surfaced: string[];
  startedBy: string | null;
  origin: PromptEntry["origin"];
  isMeta: boolean;
  promptIndex: number;
  dtMs: number;
  share: number;
  text: string;
}
const alignedPath = join(workDir, "aligned.jsonl");
const replayPath = join(workDir, "replay.jsonl");
function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as T);
}

function excludedFolders(scopesPath: string): string[] {
  try {
    const s = JSON.parse(readFileSync(scopesPath, "utf8")) as { scopes?: Record<string, { mode?: string }> };
    return Object.entries(s.scopes ?? {}).filter(([, v]) => v.mode === "observer" || v.mode === "off").map(([k]) => k);
  } catch {
    console.log("scopes: not read (none excluded by setting; the 'books' rule still applies)");
    return [];
  }
}

function join_(): void {
  const { cp, store } = openCopy();
  const data = readStoreData(storeDir);
  const root = arg("transcripts", join(homedir(), ".claude", "projects"));
  const off = excludedFolders(arg("scopes", join(homedir(), ".counterparts", "scopes.json")));
  const sessions = new Set(data.decisions.map((d) => d.session));
  const where = locateTranscripts(root, sessions);
  const counts = { decisions: data.decisions.length, observerRows: 0, noTranscript: 0, excludedFolder: 0, noEntry: 0, noCueRow: 0, noCueRowNearestLong: 0, nearestMatched: 0, fallbackMatched: 0, mismatched: 0, mismatchedNearestLong: 0 };
  const sharesNearest: number[] = [];
  const out: Aligned[] = [];
  let turnIsIndex = 0;
  let turnIsPromptRank = 0;
  const bySession = new Map<string, DecisionRow[]>();
  for (const d of data.decisions) {
    if (d.observer) {
      counts.observerRows += 1;
      continue;
    }
    const list = bySession.get(d.session) ?? [];
    list.push(d);
    bySession.set(d.session, list);
  }
  let sessionsSeen = 0;
  for (const [session, rows] of bySession) {
    if (sessionsSeen++ >= limit) break;
    const path = where.get(session);
    if (path === undefined) {
      counts.noTranscript += rows.length;
      continue;
    }
    const entries = readTranscript(path, session);
    const cwd = entries.find((e) => e.cwd !== null)?.cwd ?? "";
    if (/books/i.test(path) || /books/i.test(cwd) || off.some((f) => cwd === f || cwd.startsWith(`${f}/`))) {
      counts.excludedFolder += rows.length;
      continue;
    }
    const nonMeta = entries.filter((e) => !e.isMeta);
    const used = new Set<number>();
    for (const d of rows.sort((a, b) => a.at - b.at)) {
      const recorded = data.cueRows.get(`${session}\u0000t${d.turn}`);
      // Candidate entries: written up to 5 s after the row, or up to 10 min before it.
      const near = entries.filter((e) => e.at <= d.at + 5_000 && e.at >= d.at - 600_000 && !used.has(e.index)).sort((a, b) => Math.abs(d.at - a.at) - Math.abs(d.at - b.at));
      if (near.length === 0) {
        counts.noEntry += 1;
        continue;
      }
      if (recorded === undefined || recorded.length === 0) {
        counts.noCueRow += 1;
        // Unvalidated, so unused; counted by the nearest entry's length to show what the sample loses.
        if (stripBoilerplate((near[0] as PromptEntry).text).text.length > LONG) counts.noCueRowNearestLong += 1;
        continue;
      }
      const shareOf = (e: PromptEntry): number => {
        const terms = new Set(keptTerms(analyseCues(store, stripBoilerplate(e.text).text), "window"));
        return recorded.filter((t) => terms.has(t)).length / recorded.length;
      };
      const first = near[0] as PromptEntry;
      let pick: PromptEntry | null = null;
      let share = shareOf(first);
      sharesNearest.push(share);
      if (share >= ALIGN_SHARE) {
        pick = first;
        counts.nearestMatched += 1;
      } else {
        for (const e of near.slice(1, 6)) {
          const s = shareOf(e);
          if (s >= ALIGN_SHARE) {
            pick = e;
            share = s;
            counts.fallbackMatched += 1;
            break;
          }
        }
      }
      if (pick === null) {
        counts.mismatched += 1;
        if (stripBoilerplate(first.text).text.length > LONG) counts.mismatchedNearestLong += 1;
        continue;
      }
      used.add(pick.index);
      if (pick.index + 1 === d.turn) turnIsIndex += 1;
      if (nonMeta.indexOf(pick) + 1 === d.turn) turnIsPromptRank += 1;
      out.push({
        seq: d.seq,
        session,
        turn: d.turn,
        day: d.day,
        at: d.at,
        budgetBytes: d.budgetBytes,
        footnotes: d.footnotes,
        surfaced: d.surfaced,
        startedBy: d.startedBy,
        origin: pick.origin,
        isMeta: pick.isMeta,
        promptIndex: pick.index,
        dtMs: d.at - pick.at,
        share,
        text: pick.text,
      });
    }
  }
  writeFileSync(alignedPath, out.map((a) => JSON.stringify(a)).join("\n") + "\n", { mode: 0o600 });
  chmodSync(alignedPath, 0o600);
  const attempted = counts.nearestMatched + counts.fallbackMatched + counts.mismatched;
  console.log("JOIN", JSON.stringify(counts));
  console.log(`sessions with decisions: ${bySession.size}, with a transcript found: ${[...bySession.keys()].filter((s) => where.has(s)).length}`);
  console.log(`validated (had entry + cue row): ${attempted}; aligned ${out.length} = ${pct(out.length, attempted)} (nearest-in-time ${counts.nearestMatched}, next-nearest ${counts.fallbackMatched}); mismatched ${counts.mismatched}`);
  console.log(`nearest-entry share of recorded terms found: p10 ${quantile(sharesNearest, 0.1).toFixed(2)} p50 ${quantile(sharesNearest, 0.5).toFixed(2)}`);
  console.log(`turn number == 1 + entry index: ${pct(turnIsIndex, out.length)}; == rank among non-meta entries: ${pct(turnIsPromptRank, out.length)}`);
  const dts = out.map((a) => a.dtMs);
  console.log(`row time minus entry time (ms): p10 ${quantile(dts, 0.1)} p50 ${quantile(dts, 0.5)} p90 ${quantile(dts, 0.9)}`);
  cp.close();
}

// ── describe ─────────────────────────────────────────────────────────────────

/** Who or what started a prompt, by a mechanical rule on the entry and its text. */
export function startedKind(a: Pick<Aligned, "origin" | "isMeta" | "text">): string {
  const probe = a.text.trimStart();
  if (/^<command-(name|message|args)>/.test(probe)) return "slash-command";
  if (a.origin === "task-notification" || /^<task-notification>/.test(probe)) return "task-notification";
  if (a.origin === "peer" || startedByHost(a.text)) return "peer-or-hand-back";
  if (a.isMeta || a.origin === "meta") return "host-meta";
  // Typed by the person: "pasted" when 40%+ of it is inside ``` fences or "> " lines, or one blank-line-free block is 1,500+ chars.
  const t = a.text;
  let fenced = 0;
  for (const m of t.matchAll(/```[\s\S]*?```/g)) fenced += m[0].length;
  for (const m of t.matchAll(/^> .*$/gm)) fenced += m[0].length;
  const longestBlock = Math.max(0, ...t.split(/\n\s*\n/).map((b) => b.length));
  return fenced >= 0.4 * t.length || longestBlock >= 1500 ? "typed-with-pasted-block" : "typed";
}

function describe(): void {
  const { cp, store } = openCopy();
  const rows = readJsonl<Aligned>(alignedPath);
  const lens = rows.map((r) => stripBoilerplate(r.text).text.length);
  console.log(`ALIGNED TURNS ${rows.length}, sessions ${new Set(rows.map((r) => r.session)).size}`);
  console.log(`stripped length: p50 ${quantile(lens, 0.5)} p90 ${quantile(lens, 0.9)} p99 ${quantile(lens, 0.99)} max ${Math.max(...lens)}`);
  for (const t of THRESHOLDS) console.log(`  over ${t}: ${lens.filter((l) => l > t).length} (${pct(lens.filter((l) => l > t).length, lens.length)})`);
  const long = rows.filter((_, i) => (lens[i] as number) > LONG);
  const kinds = new Map<string, number[]>();
  for (const r of long) {
    const k = startedKind(r);
    const l = stripBoilerplate(r.text).text.length;
    kinds.set(k, [...(kinds.get(k) ?? []), l]);
  }
  console.log(`LONG (>${LONG}) by origin rule:`);
  for (const [k, ls] of [...kinds].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${k}: ${ls.length} (>5000: ${ls.filter((l) => l > 5000).length}, >10000: ${ls.filter((l) => l > 10000).length})`);
  }
  const sb = new Map<string, number>();
  for (const r of long) sb.set(r.startedBy ?? "unrecorded", (sb.get(r.startedBy ?? "unrecorded") ?? 0) + 1);
  console.log(`  recorded startedBy: ${JSON.stringify(Object.fromEntries(sb))}`);

  const eligibleWhole: number[] = [];
  const eligibleWindow: number[] = [];
  const distinct: number[] = [];
  const windowEnd: number[] = [];
  const beyond: number[] = [];
  const keptLostToWindow: number[] = [];
  const deciles = new Array<number>(10).fill(0);
  let keptTotal = 0;
  let wholeTopAfterWindow = 0;
  let wholeTopTotal = 0;
  for (const r of long) {
    const text = stripBoilerplate(r.text).text;
    const a = analyseCues(store, text);
    distinct.push(a.distinctTerms);
    eligibleWhole.push(a.eligibleWhole);
    eligibleWindow.push(a.eligibleWindow);
    windowEnd.push(a.windowEndChar);
    beyond.push(Math.max(0, text.length - 2000) / text.length);
    const kept = new Set(keptTerms(a, "kept"));
    const top24Whole = keptTerms(a, "whole").slice(0, 24);
    keptLostToWindow.push(top24Whole.filter((t) => !kept.has(t)).length);
    for (const t of kept) {
      const at = a.firstAt.get(t);
      if (at === undefined) continue;
      deciles[Math.min(9, Math.floor((10 * at) / text.length))]! += 1;
      keptTotal += 1;
    }
    for (const t of top24Whole) {
      wholeTopTotal += 1;
      if ((a.firstAt.get(t) ?? 0) >= a.windowEndChar) wholeTopAfterWindow += 1;
    }
  }
  const q = (xs: number[]): string => `p50 ${quantile(xs, 0.5)} p90 ${quantile(xs, 0.9)}`;
  console.log(`LONG TURNS: ${long.length}`);
  console.log(`  distinct index terms: ${q(distinct)}`);
  console.log(`  eligible as cues, whole text: ${q(eligibleWhole)}; inside the 72-token window: ${q(eligibleWindow)}; kept: 24 at most`);
  console.log(`  token window ends at char: ${q(windowEnd)} (of lengths ${q(long.map((r) => stripBoilerplate(r.text).text.length))})`);
  console.log(`  share of each prompt beyond the first 2,000 chars: ${q(beyond.map((x) => Math.round(100 * x)))} (percent)`);
  console.log(`  kept cue words, first occurrence by char decile (0 = head): ${deciles.map((n) => pct(n, keptTotal)).join(" ")}`);
  console.log(`  of a no-window top 24, terms first seen after the window ends: ${pct(wholeTopAfterWindow, wholeTopTotal)}; per turn, top-24 terms the window loses: ${q(keptLostToWindow)}`);
  cp.close();
}

// ── replay ───────────────────────────────────────────────────────────────────

const VARIANTS = ["whole", "head2000", "tail2000", "head1000+tail1000"] as const;
/**
 * Two more that split the channels apart, each changing ONE input of the whole-prompt turn:
 * "cues-tail" takes its cue words from the last 2,000 chars but keeps the shipped head vector;
 * "vector-tail" keeps the shipped cue words but embeds the last 2,000 chars. And
 * "whole-unfiltered", the shipped turn with no born-before filter, for the reproduction check.
 */
const ISOLATING = ["cues-tail", "vector-tail"] as const;
type Variant = (typeof VARIANTS)[number] | (typeof ISOLATING)[number] | "whole-unfiltered";
const ALL: readonly Variant[] = [...VARIANTS, ...ISOLATING, "whole-unfiltered"];
function variantText(text: string, v: Variant): string {
  if (v === "whole" || v === "whole-unfiltered" || text.length <= 2000) return text;
  if (v === "head2000") return text.slice(0, 2000);
  if (v === "tail2000" || v === "cues-tail") return text.slice(-2000);
  if (v === "vector-tail") return text;
  return `${text.slice(0, 1000)}\n${text.slice(-1000)}`;
}
interface ReplayRow {
  seq: number;
  session: string;
  turn: number;
  day: number;
  len: number;
  variant: Variant;
  shown: string[];
  surfaced: string[];
  candidates: string[];
  candidateCount: number;
  semantic: string;
  leaks: number;
  ms: number;
}

function counts(store: Store): string {
  const db = (store as unknown as { ops?: { all: (sql: string) => { n: number }[] } }).ops;
  if (db === undefined) return "unknown";
  return `${db.all("SELECT max(seq) AS n FROM events")[0]?.n}/${db.all("SELECT count(*) AS n FROM memories")[0]?.n}`;
}

function replay(): void {
  const { cp, store } = openCopy();
  const before = counts(store);
  const data: StoreData = readStoreData(storeDir);
  const filter = wrapBornBefore(store, data.birthDay);
  const rows = readJsonl<Aligned>(alignedPath).filter((r) => stripBoilerplate(r.text).text.length > LONG);
  const out: string[] = [];
  let n = 0;
  for (const r of rows.slice(0, limit === Infinity ? undefined : limit)) {
    const text = stripBoilerplate(r.text).text;
    for (const v of ALL) {
      filter.setDay(v === "whole-unfiltered" ? null : r.day);
      const sessionId = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const t0 = performance.now();
      // The vector as `session.ts#inLineSemantic` makes it, from the head or (vector-tail) the tail.
      const vecText = v === "cues-tail" ? text.trim().slice(0, 2000) : v === "vector-tail" ? text.trim().slice(-2000) : null;
      const vector = vecText === null ? null : store.textVector(vecText);
      const res = cp.recallForTurn({
        sessionId,
        text: variantText(text, v),
        day: r.day,
        ...(vector === null || vector.length === 0 ? {} : { vector, semanticSource: "in-line" }),
        ...(r.budgetBytes === null ? {} : { budgetBytes: r.budgetBytes }),
      } as Parameters<Counterpart["recallForTurn"]>[0]);
      const d = res.decision;
      const shown = [...d.surfaced, ...d.footnotes].map((x) => (typeof x === "string" ? x : (x as { id: string }).id));
      const row: ReplayRow = {
        seq: r.seq,
        session: r.session,
        turn: r.turn,
        day: r.day,
        len: text.length,
        variant: v,
        shown,
        surfaced: d.surfaced.map((x) => (typeof x === "string" ? x : (x as { id: string }).id)),
        candidates: d.verdicts.map((x) => x.id),
        candidateCount: d.candidates,
        semantic: String((d as { semanticSource?: unknown }).semanticSource ?? ""),
        leaks: v === "whole-unfiltered" ? 0 : shown.filter((id) => (data.birthDay.get(id) ?? Infinity) >= r.day).length,
        ms: Math.round(performance.now() - t0),
      };
      out.push(JSON.stringify(row));
    }
    if ((out.length / ALL.length) % 50 === 0) {
      writeFileSync(replayPath, out.join("\n") + "\n");
      console.log(`  replayed ${out.length / ALL.length} of ${rows.length}`);
    }
  }
  filter.restore();
  writeFileSync(replayPath, out.join("\n") + "\n");
  const after = counts(store);
  console.log(`REPLAY ${out.length / ALL.length} long turns x ${ALL.length} variants; copy events/memories before ${before} after ${after} (${before === after ? "unchanged" : "CHANGED"})`);
  data.close();
  cp.close();
}

// ── report ───────────────────────────────────────────────────────────────────

function report(): void {
  const data = readStoreData(storeDir);
  const aligned = readJsonl<Aligned>(alignedPath);
  const lenOf = new Map(aligned.map((a) => [a.seq, stripBoilerplate(a.text).text.length]));
  const live = new Map(aligned.map((a) => [a.seq, a]));
  const reps = readJsonl<ReplayRow>(replayPath);
  const by = new Map<string, ReplayRow>(reps.map((r) => [`${r.seq}:${r.variant}`, r]));
  const seqs = [...new Set(reps.map((r) => r.seq))];

  // 3. reproduction
  for (const v of ["whole", "whole-unfiltered"] as const) {
    let liveShown = 0, reShown = 0, reCand = 0, sameDay = 0, sameDayShown = 0, turnsAll = 0, turnsAny = 0, liveEmpty = 0, replayEmptyToo = 0;
    for (const s of seqs) {
      const a = live.get(s)!;
      const r = by.get(`${s}:${v}`)!;
      const ids = [...a.footnotes, ...a.surfaced];
      if (ids.length === 0) {
        liveEmpty += 1;
        if (r.shown.length === 0) replayEmptyToo += 1;
        continue;
      }
      const shown = new Set(r.shown);
      const cand = new Set(r.candidates);
      let hit = 0;
      for (const id of ids) {
        liveShown += 1;
        if ((data.birthDay.get(id) ?? Infinity) >= a.day) {
          sameDay += 1;
          if (shown.has(id)) sameDayShown += 1;
        }
        if (shown.has(id)) {
          reShown += 1;
          hit += 1;
        }
        if (cand.has(id)) reCand += 1;
      }
      if (hit === ids.length) turnsAll += 1;
      if (hit > 0) turnsAny += 1;
    }
    const withShown = seqs.length - liveEmpty;
    console.log(`REPRODUCTION [${v}] over ${seqs.length} long turns (${withShown} with live ids): live ids ${liveShown}; reshown ${reShown} (${pct(reShown, liveShown)}); among replay candidates ${reCand} (${pct(reCand, liveShown)}); live ids born on/after the turn's day ${sameDay} (reshown ${sameDayShown}); reproducible-by-construction share reshown ${pct(reShown - sameDayShown, liveShown - sameDay)}; turns all reproduced ${turnsAll}, any ${turnsAny}; live-empty turns ${liveEmpty} (replay empty too ${replayEmptyToo})`);
  }
  const leaks = reps.filter((r) => r.variant !== "whole-unfiltered").reduce((n, r) => n + r.leaks, 0);
  console.log(`  born-before leaks into shown slots (filtered variants): ${leaks}; semantic sources: ${JSON.stringify(Object.fromEntries([...new Set(reps.map((r) => r.semantic))].map((k) => [k, reps.filter((r) => r.semantic === k).length])))}`);
  console.log(`  replay ms per call: p50 ${quantile(reps.map((r) => r.ms), 0.5)} p90 ${quantile(reps.map((r) => r.ms), 0.9)}`);

  // 4. denominator: ratings joined to the decision that showed the id (since < turn <= rated turn)
  const decisionsBySession = new Map<string, DecisionRow[]>();
  for (const d of data.decisions) decisionsBySession.set(d.session, [...(decisionsBySession.get(d.session) ?? []), d]);
  const ratedOn = new Map<number, Map<string, number>>(); // decision seq -> id -> score
  let ratingsJoined = 0;
  for (const x of data.ratings) {
    const cands = (decisionsBySession.get(x.session) ?? []).filter((d) => d.turn > x.since && d.turn <= x.turn && (d.footnotes.includes(x.id) || d.surfaced.includes(x.id)));
    const d = cands.sort((a, b) => b.turn - a.turn)[0];
    if (d === undefined) continue;
    ratingsJoined += 1;
    const m = ratedOn.get(d.seq) ?? new Map<string, number>();
    m.set(x.id, x.score);
    ratedOn.set(d.seq, m);
  }
  console.log(`DENOMINATOR: ratings ${data.ratings.length}, joined to a showing decision ${ratingsJoined}; decisions with any rating ${ratedOn.size}`);
  for (const t of [0, ...THRESHOLDS]) {
    const turns = aligned.filter((a) => (lenOf.get(a.seq) ?? 0) > t && ratedOn.has(a.seq));
    const byScore = [0, 1, 2, 3].map((s) => turns.filter((a) => [...ratedOn.get(a.seq)!.values()].includes(s)).length);
    const ids = turns.flatMap((a) => [...ratedOn.get(a.seq)!.values()]);
    console.log(`  aligned turns over ${t} chars with a rated footnote: ${turns.length} (turns having a score 0/1/2/3: ${byScore.join("/")}; rated ids ${ids.length}: ${[0, 1, 2, 3].map((s) => ids.filter((x) => x === s).length).join("/")})`);
  }

  // 5. variants
  console.log("VARIANTS (long turns; filtered replays):");
  const base = (s: number) => by.get(`${s}:whole`)!;
  for (const v of [...VARIANTS, ...ISOLATING]) {
    let good = 0, zero = 0, goodCand = 0, zeroCand = 0, diffShown = 0, diffCand = 0, sizeShown = 0, turnsWithGood = 0;
    for (const s of seqs) {
      const r = by.get(`${s}:${v}`)!;
      const rated = ratedOn.get(s);
      if (rated !== undefined) {
        for (const [id, sc] of rated) {
          if (sc >= 2) {
            if (r.shown.includes(id)) good += 1;
            if (r.candidates.includes(id)) goodCand += 1;
          } else if (sc === 0) {
            if (r.shown.includes(id)) zero += 1;
            if (r.candidates.includes(id)) zeroCand += 1;
          }
        }
        if ([...rated.values()].some((x) => x >= 2)) turnsWithGood += 1;
      }
      const b = base(s);
      const bs = new Set(b.shown), bc = new Set(b.candidates);
      diffShown += r.shown.filter((id) => !bs.has(id)).length + b.shown.filter((id) => !r.shown.includes(id)).length;
      diffCand += r.candidates.filter((id) => !bc.has(id)).length;
      sizeShown += r.shown.length;
    }
    const goodTotal = [...ratedOn].filter(([s]) => seqs.includes(s)).flatMap(([, m]) => [...m.values()]).filter((x) => x >= 2).length;
    const zeroTotal = [...ratedOn].filter(([s]) => seqs.includes(s)).flatMap(([, m]) => [...m.values()]).filter((x) => x === 0).length;
    console.log(`  ${v.padEnd(18)} shown ${sizeShown}; rated-2/3 shown ${good}/${goodTotal} (candidates ${goodCand}); rated-0 shown ${zero}/${zeroTotal} (candidates ${zeroCand}); shown ids differing from whole ${diffShown}; candidate ids not in whole ${diffCand}; turns with a rated-2/3 ${turnsWithGood}`);
  }
  data.close();
}

// ── hand-read (PRIVATE output) ───────────────────────────────────────────────

/** FNV-1a, for the fixed selection rule and the per-turn shuffle. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

function handread(): void {
  const outPath = resolve(arg("out"));
  if (!outPath.startsWith(resolve(homedir(), "counterparts-notes"))) throw new Error("refusing: the hand-read sheet goes under ~/counterparts-notes only");
  const { cp, store } = openCopy();
  const data = readStoreData(storeDir);
  const aligned = new Map(readJsonl<Aligned>(alignedPath).map((a) => [a.seq, a]));
  const reps = readJsonl<ReplayRow>(replayPath);
  const by = new Map(reps.map((r) => [`${r.seq}:${r.variant}`, r]));
  // THE RULE, fixed before looking: long turns ordered by FNV-1a of `${session}:${turn}`, the first 25.
  const picked = [...new Set(reps.map((r) => r.seq))].map((s) => aligned.get(s)!).sort((a, b) => fnv(`${a.session}:${a.turn}`) - fnv(`${b.session}:${b.turn}`)).slice(0, 25);
  const lines: string[] = [
    "# Long-prompt hand-read, 2026-11-28 (PRIVATE)",
    "",
    "Selection rule (fixed before reading): long aligned turns (>2,000 stripped chars) sorted by FNV-1a of `session:turn`, first 25.",
    "Variant labels A-D are shuffled per turn (FNV of `seq:variant`); the key is at the bottom. Titles marked * were shown live on that turn.",
    "",
  ];
  const key: string[] = [];
  picked.forEach((a, i) => {
    const text = stripBoilerplate(a.text).text;
    const an = analyseCues(store, text);
    const kept = keptTerms(an, "kept");
    const dropped = keptTerms(an, "whole").filter((t) => !kept.includes(t)).slice(0, 10);
    const liveIds = new Set([...a.footnotes, ...a.surfaced]);
    lines.push(`## ${i + 1}. turn ${a.turn} of session ${a.session.slice(0, 8)}, day ${a.day}, ${text.length} chars, ${startedKind(a)}`, "");
    lines.push("First 300:", "", "```", text.slice(0, 300), "```", "", "Last 300:", "", "```", text.slice(-300), "```", "");
    lines.push(`Kept cues (24): ${kept.join(", ")}`, "", `Top dropped cues (10): ${dropped.join(", ")}`, "");
    const order = [...VARIANTS].sort((x, y) => fnv(`${a.seq}:${x}`) - fnv(`${a.seq}:${y}`));
    order.forEach((v, j) => {
      const label = "ABCD"[j] as string;
      const r = by.get(`${a.seq}:${v}`);
      lines.push(`Shown under ${label}:`);
      for (const id of r?.shown ?? []) lines.push(`- ${data.title(id)}${liveIds.has(id) ? " *" : ""}`);
      if ((r?.shown.length ?? 0) === 0) lines.push("- (nothing)");
      lines.push("");
    });
    key.push(`${i + 1}: ${order.map((v, j) => `${"ABCD"[j]}=${v}`).join(" ")}`);
  });
  lines.push("---", "", "## Key", "", ...key.map((k) => `- ${k}`), "");
  writeFileSync(outPath, lines.join("\n"), { mode: 0o600 });
  console.log(`hand-read: ${picked.length} turns written to the private sheet`);
  data.close();
  cp.close();
}

if (command === "join") join_();
else if (command === "describe") describe();
else if (command === "replay") replay();
else if (command === "report") report();
else if (command === "handread") handread();
else console.log("commands: join | describe | replay | report | handread (see the header)");
