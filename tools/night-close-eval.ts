/**
 * SO1 STEP 1'S DRY RUN: WHAT THE NIGHT WOULD CLOSE, ON A COPY (2026-11-07;
 * dev-only, never shipped). Applied: the copy is opened, the night's close
 * sweep (`open-close.ts#openCloseSweep`) runs on it with writes on, and the
 * copy's Still open is read before and after. The source is never written.
 *
 *   COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 bun tools/night-close-eval.ts --source <store.sqlite> [--seed 7] [--sample 20] [--all] [--labels ids.txt]
 *
 * `--labels`: a file of memory ids known to be done (one per line, e.g. a
 * hand sweep's "close" table): how many the night closed, listed as may be
 * done, or left, and which closes the labels don't name.
 *
 * Prints counts, then a seeded sample of the closes (all of them with `--all`,
 * or when there are fewer than `--sample`) for a reviewer to hand-check: each
 * item's title, its settlesWhen, and the title of the memory that showed it
 * done, with ids. Titles only, never bodies. Then every "may be done", and
 * the open items that named a version but weren't closed, with why.
 *
 * Refuses a source under the live root (`~/.counterparts`, or the env's).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { underLiveRoot } from "./harness/source.js";

import { Counterpart } from "../src/core/counterpart.js";
import { headline, subjectKeys } from "../src/core/interference.js";
import { openCloseSweep } from "../src/core/open-close.js";
import { settlesWhenOf } from "../src/core/types.js";

interface Args {
  source: string;
  seed: number;
  sample: number;
  all: boolean;
  labels: string | null;
}

function args(argv: readonly string[]): Args {
  const out: Args = { source: "", seed: 1, sample: 20, all: false, labels: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => argv[++i] ?? "";
    if (a === "--source") out.source = next();
    else if (a === "--seed") out.seed = Number(next());
    else if (a === "--sample") out.sample = Number(next());
    else if (a === "--all") out.all = true;
    else if (a === "--labels") out.labels = next();
  }
  if (out.source === "") throw new Error("--source <store.sqlite> is required");
  if (!Number.isFinite(out.seed)) throw new Error("--seed takes a number");
  return out;
}

/** A small seeded shuffle (mulberry32), so a reviewer's draw is repeatable. */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function main(): void {
  const a = args(process.argv.slice(2));
  const source = resolve(a.source);
  if (underLiveRoot(source)) throw new Error(`refusing a source under the live root: ${source}`);
  if (!existsSync(source)) throw new Error(`no such store: ${source}`);
  const work = mkdtempSync(join(tmpdir(), "counterparts-night-close-"));
  try {
    mkdirSync(join(work, "store"), { recursive: true });
    copyFileSync(source, join(work, "store", "counterparts.sqlite"));
    const c = Counterpart.open({ dir: join(work, "store"), snapshotsDir: join(work, "snapshots") });
    try {
      const store = c.store;
      const title = (id: string): string => {
        const r = store.row(id);
        if (r === undefined) return "(gone)";
        return headline({ title: r.title ?? null, body: r.body }).replace(/\s+/g, " ").slice(0, 140);
      };
      const settles = (id: string): string => {
        try {
          return settlesWhenOf(store.readProse(id).meta) ?? "-";
        } catch {
          return "-";
        }
      };
      const scopeOf = (id: string): string => (store.row(id)?.origin_scope ?? "").replace(/^.*\//, "");
      const before = c.stillOpen();
      const openBefore = store.openThreadIds().length;
      const t0 = performance.now();
      const out = openCloseSweep(store, { day: store.livedDay(), apply: true, budget: 10_000 });
      const ms = Math.round(performance.now() - t0);
      const after = c.stillOpen();
      console.log(`store: lived day ${String(store.livedDay())}; open (flagged) ${String(openBefore)}; Still open (all folders) ${String(before.items.length)} → ${String(after.items.length)}, parked ${String(before.parked)} → ${String(after.parked)}`);
      console.log(`sweep: examined ${String(out.examined)}, CLOSED ${String(out.closed.length)}, MAY BE DONE ${String(out.mayBeDone.length)}, ${String(ms)} ms`);
      console.log(`skipped: ${JSON.stringify(out.skipped)}`);
      const pick = a.all || out.closed.length <= a.sample ? out.closed : shuffled(out.closed, a.seed).slice(0, a.sample);
      console.log(`\n== closes${pick.length < out.closed.length ? `, sample of ${String(pick.length)} (seed ${String(a.seed)})` : ", all"} ==`);
      pick.forEach((x, i) => {
        console.log(`${String(i + 1)}. [${x.id}] (${scopeOf(x.id)}) ${title(x.id)}`);
        console.log(`   settlesWhen: ${settles(x.id)}`);
        console.log(`   closed by: ${x.why} (${x.key}) — [${x.shows}] ${title(x.shows)}`);
      });
      console.log(`\n== may be done (listed, not closed) ==`);
      out.mayBeDone.forEach((m, i) => {
        console.log(`${String(i + 1)}. [${m.id}] (${scopeOf(m.id)}) ${title(m.id)}`);
        console.log(`   settlesWhen: ${settles(m.id)}`);
        console.log(`   why: ${m.why}${m.shows === undefined ? "" : ` — [${m.shows}] ${title(m.shows)}`}`);
      });
      // The open items that name a version and were not closed, for the misses.
      const closedIds = new Set(out.closed.map((x) => x.id));
      const maybeIds = new Set(out.mayBeDone.map((x) => x.id));
      const named = store.openThreadIds().filter((id) => {
        if (closedIds.has(id) || maybeIds.has(id)) return false;
        const r = store.row(id);
        return r !== undefined && subjectKeys(headline({ title: r.title ?? null, body: r.body }), "any").versions.size > 0;
      });
      if (a.labels !== null) {
        const want = readFileSync(a.labels, "utf8").split(/\s+/).filter((x) => /^mem_[0-9a-f]+$/.test(x));
        const set = new Set(want);
        const hit = want.filter((id) => closedIds.has(id));
        const listed = want.filter((id) => maybeIds.has(id));
        console.log(`\n== labels (${String(want.length)}): closed ${String(hit.length)}, may be done ${String(listed.length)}, left ${String(want.length - hit.length - listed.length)} ==`);
        for (const id of want) console.log(`- ${closedIds.has(id) ? "CLOSED" : maybeIds.has(id) ? "maybe " : "left  "} [${id}] ${title(id)}`);
        const extra = out.closed.filter((x) => !set.has(x.id));
        console.log(`closes the labels don't name: ${String(extra.length)}${extra.length === 0 ? "" : ` (${extra.map((x) => x.id).join(", ")})`}`);
      }
      console.log(`\n== named a version, left open (${String(named.length)}) ==`);
      for (const id of named) console.log(`- [${id}] (${scopeOf(id)}) ${title(id)} | settlesWhen: ${settles(id)}`);
    } finally {
      c.close();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
