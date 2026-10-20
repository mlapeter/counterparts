/**
 * A RECORDED NIGHT, REPLAYED (2026-10-20, lane 1 step 2b): the harness's own
 * seat, and the night's output-level check.
 *
 * A night's children talked to the memory through its tools; their
 * transcripts keep every call and every answer. This seat answers the
 * night's asks by making the same calls again, through the memory's own
 * server, against a copy of the store as it stood before that night, on that
 * night's clock. No model. The night itself runs as live runs it
 * (`runNight`, Claude Code's adapter, given this seat), so what it composed,
 * what it recorded, and what the store holds afterwards can be set beside
 * what the real night left.
 *
 * Ids the replay mints (the dream's, the reflection's, a merged memory's)
 * differ from the recorded ones; each recorded answer is walked beside the
 * replayed one to learn the pairs, and later calls are sent with the
 * replay's ids.
 *
 * The run record holds counts, states and verdicts. Never a prompt, a body,
 * a journal or a feeling's words: the transcripts and both stores hold the
 * owner's memory, and they stay where they are.
 */
import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, openSync, readSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Database } from "bun:sqlite";

import { openEmbedder, runNight } from "../../src/adapters/claude-code/index.js";
import type { LiveEmbedder, NightAnswer, NightStarter } from "../../src/adapters/claude-code/index.js";
import { McpServer } from "../../src/adapters/mcp/index.js";
import { Counterpart } from "../../src/core/counterpart.js";
import type { Seat, SeatAsk, SeatTool } from "../../src/core/counterpart.js";

import { modelSeat } from "./model-seat.js";
import type { ChildInit } from "./model-seat.js";
import { underLiveRoot } from "./source.js";

const SEAT_TOOLS: readonly SeatTool[] = ["session_end", "dream", "reflect", "self_page", "recall"];
const TOOL_PREFIX = "mcp__counterparts__";
const ID = /\b(mem|epi|sch|drm|rfl|ctr|fel)_[0-9a-f]{12}\b/g;
const WHOLE_ID = /^(mem|epi|sch|drm|rfl|ctr|fel)_[0-9a-f]{12}$/;
const DATABASE_FILE = "counterparts.sqlite";

/** One call a night's child made, and the answer it got. */
export interface RecordedCall {
  readonly tool: SeatTool;
  readonly input: Record<string, unknown>;
  /** The answer as recorded: parsed JSON when it was JSON, else its text. */
  readonly result: unknown;
  /** When the call was made (ms), or null when the transcript line carried no time. */
  readonly at: number | null;
  /** The host answered it with an error of its own, in prose (a tool it would not run): never replayed. A refusal the server answered, as its JSON, is replayed. */
  readonly hostRefused?: true;
}

/** A child's transcript as Claude Code writes it: its launch prompt and its calls to the memory's tools. */
export interface RecordedChild {
  readonly prompt: string;
  readonly calls: readonly RecordedCall[];
  readonly startedAt: number | null;
}

type Row = Record<string, unknown>;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b !== null && typeof b === "object" && typeof (b as Row)["text"] === "string" ? ((b as Row)["text"] as string) : "")).join("");
}

/** Read a night child's transcript. Calls to anything but the memory's tools (the host's ToolSearch) are left out. */
export function readChild(path: string): RecordedChild {
  const uses = new Map<string, { tool: SeatTool; input: Record<string, unknown>; at: number | null }>();
  const results = new Map<string, unknown>();
  const hostRefused = new Set<string>();
  let prompt = "";
  let startedAt: number | null = null;
  let lastAt: number | null = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    let o: Row;
    try {
      o = JSON.parse(line) as Row;
    } catch {
      continue;
    }
    const stamp = typeof o["timestamp"] === "string" ? Date.parse(o["timestamp"]) : Number.NaN;
    if (!Number.isNaN(stamp)) {
      lastAt = stamp;
      startedAt ??= stamp;
    }
    // MESSAGE LINES ONLY: Claude Code also writes lines (an API request's
    // blob) that repeat earlier blocks with no time of their own.
    if (o["type"] !== "user" && o["type"] !== "assistant") continue;
    const message = o["message"] as Row | undefined;
    const content = message?.["content"];
    if (o["type"] === "user" && prompt.length === 0 && message !== undefined) {
      const t = textOf(content);
      if (t.length > 0 && !(Array.isArray(content) && content.some((b) => (b as Row)["type"] === "tool_result"))) prompt = t;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content as Row[]) {
      if (b["type"] === "tool_use" && typeof b["name"] === "string" && b["name"].startsWith(TOOL_PREFIX)) {
        const tool = b["name"].slice(TOOL_PREFIX.length) as SeatTool;
        if (!SEAT_TOOLS.includes(tool) || uses.has(String(b["id"]))) continue;
        uses.set(String(b["id"]), { tool, input: (b["input"] as Record<string, unknown>) ?? {}, at: lastAt });
      }
      if (b["type"] === "tool_result" && !results.has(String(b["tool_use_id"]))) {
        const text = textOf(b["content"]);
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* kept as text */
        }
        // THE HOST'S OWN REFUSAL, not the server's: an error the server
        // answered is its JSON (and changed what it changes, so it is
        // replayed); one the host said in prose never reached the server.
        if (b["is_error"] === true && (parsed === null || typeof parsed !== "object")) hostRefused.add(String(b["tool_use_id"]));
        results.set(String(b["tool_use_id"]), parsed);
      }
    }
  }
  const calls = [...uses.entries()].map(([id, u]) => ({ ...u, result: results.get(id) ?? null, ...(hostRefused.has(id) ? { hostRefused: true as const } : {}) }));
  return { prompt, calls, startedAt };
}

/**
 * Learn recorded → replayed id pairs by walking two answers side by side.
 * ONLY IDS BOTH NIGHTS MINTED are paired: the recorded one absent from the
 * store the night started from, the replayed one new to it too, and each
 * replayed id the target of one pair. Without `existed`, every pair is
 * learned (a test's own walk). An id that already existed is the same memory
 * in both runs: pairing it by position would send later calls to another one.
 */
export function learnIds(recorded: unknown, replayed: unknown, map: Map<string, string>, existed?: ReadonlySet<string>): void {
  if (typeof recorded === "string" && typeof replayed === "string") {
    if (!WHOLE_ID.test(recorded) || !WHOLE_ID.test(replayed) || recorded === replayed || map.has(recorded)) return;
    if (existed !== undefined && (existed.has(recorded) || existed.has(replayed))) return;
    if ([...map.values()].includes(replayed)) return;
    map.set(recorded, replayed);
    return;
  }
  if (Array.isArray(recorded) && Array.isArray(replayed)) {
    for (let i = 0; i < Math.min(recorded.length, replayed.length); i++) learnIds(recorded[i], replayed[i], map, existed);
    return;
  }
  if (recorded !== null && replayed !== null && typeof recorded === "object" && typeof replayed === "object" && !Array.isArray(recorded) && !Array.isArray(replayed)) {
    for (const k of Object.keys(recorded)) if (k in replayed) learnIds((recorded as Row)[k], (replayed as Row)[k], map, existed);
  }
}

/** A value with every recorded id the replay renamed put under its replayed name, wherever it appears. */
export function withIds(v: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof v === "string") return map.size === 0 ? v : v.replace(ID, (id) => map.get(id) ?? id);
  if (Array.isArray(v)) return v.map((x) => withIds(x, map));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withIds(x, map)]));
  return v;
}

function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Row).sort(([a], [b]) => a.localeCompare(b))) : x,
  );
}

/** What the recorded seat did with one ask's calls. Counts only. */
export interface CallTally {
  readonly calls: number;
  /** The replayed answer was an error or a refusal (`ok: false`). */
  readonly refused: number;
  /** Answers identical to the recorded ones once ids are mapped. */
  readonly same: number;
  /** Calls not replayed: the host refused them then, or the ask did not grant the tool (or withheld it). */
  readonly skipped: number;
  /** By tool and phase: how many, refused, same. */
  readonly byPhase: Readonly<Record<string, { calls: number; refused: number; same: number }>>;
}

export interface RecordedSeatInput {
  readonly dream: RecordedChild;
  readonly reflection: RecordedChild;
  /** Opens the store the night runs on, on the replay's clock, as the child's server opens it. */
  readonly open: () => Counterpart;
  /** The server's embedder, as the live server has one (`serve.ts`); null for none. */
  readonly embedder?: LiveEmbedder | null;
  /** Moves the replay's clock to a recorded call's instant. */
  readonly setClock: (at: number) => void;
  readonly now: () => number;
  /** Every id the store held before the night: only ids minted that night are paired. */
  readonly existed?: ReadonlySet<string>;
  /** Each call as it is replayed, beside its recorded answer: for a diagnosis, never for the record. */
  readonly onCall?: (call: RecordedCall, replayed: Record<string, unknown>, ids: ReadonlyMap<string, string>) => void;
}

/**
 * THE RECORDED SEAT: answers the dream's and the reflection's asks with the
 * calls the recorded night made, through the memory's own server (as the
 * night's child's server: not the owner's, and told which act it serves).
 * A write-up owed is not in the record: refused, by name.
 */
export function recordedSeat(input: RecordedSeatInput): Seat<NightAnswer> & { readonly tallies: Readonly<Record<string, CallTally>>; readonly ids: ReadonlyMap<string, string> } {
  const ids = new Map<string, string>();
  const tallies: Record<string, CallTally> = {};
  return {
    name: "harness:recorded",
    tallies,
    ids,
    async answer(ask: SeatAsk): Promise<NightAnswer> {
      const started = input.now();
      if (ask.act === "catch-up") {
        const was = tallies["catch-up"];
        tallies["catch-up"] = { calls: (was?.calls ?? 0) + 1, refused: (was?.refused ?? 0) + 1, same: 0, skipped: 0, byPhase: {} };
        return { refused: "not-recorded", started: false, code: null, timedOut: false, error: null, ms: 0 };
      }
      const child = ask.act === "dream" ? input.dream : input.reflection;
      const counterpart = input.open();
      const server = new McpServer({
        counterpart,
        session: ask.session,
        scope: ask.scope,
        owner: false,
        ...(input.embedder === undefined || input.embedder === null ? {} : { embedder: input.embedder }),
        // As the night's child's server is launched (`night-run.ts#nightMcpConfig`).
        env: { COUNTERPARTS_NIGHT_CHILD: ask.act, COUNTERPARTS_NIGHT_RUN: ask.run },
        now: input.now,
      });
      const byPhase: Record<string, { calls: number; refused: number; same: number }> = {};
      let refused = 0;
      let same = 0;
      let skipped = 0;
      try {
        for (const call of child.calls) {
          if (call.hostRefused === true || !ask.tools.includes(call.tool) || ask.withhold.includes(call.tool)) {
            skipped += 1;
            continue;
          }
          if (call.at !== null) input.setClock(call.at);
          const out = await server.call(call.tool, withIds(call.input, ids) as Record<string, unknown>);
          const replayed = out.structuredContent;
          learnIds(call.result, replayed, ids, input.existed);
          input.onCall?.(call, replayed, ids);
          const phase = `${call.tool}${typeof call.input["phase"] === "string" ? `:${call.input["phase"]}` : ""}`;
          const p = (byPhase[phase] ??= { calls: 0, refused: 0, same: 0 });
          p.calls += 1;
          if (out.isError === true || replayed["ok"] === false) {
            refused += 1;
            p.refused += 1;
          }
          if (canonical(withIds(call.result, ids)) === canonical(replayed)) {
            same += 1;
            p.same += 1;
          }
        }
      } finally {
        counterpart.close();
      }
      tallies[ask.act] = { calls: child.calls.length, refused, same, skipped, byPhase };
      return { refused: null, started: true, code: 0, timedOut: false, error: null, ms: input.now() - started };
    },
  };
}

export interface NightReplayOptions {
  /** A copy of the store as it stood before the night (a snapshot taken at its start). */
  readonly source: string;
  /** A copy of the store after the night: what the real night left. */
  readonly outcome: string;
  readonly dreamTranscript: string;
  readonly reflectionTranscript: string;
  readonly workRoot?: string;
  readonly keep?: boolean;
  /** The store's zone; absent, the machine's (as a config without one runs live). */
  readonly timeZone?: string;
  readonly budgetBytes?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** See `RecordedSeatInput.onCall`. */
  readonly onCall?: RecordedSeatInput["onCall"];
  /** Open the local embedder for the child's server, as live does (default true): what a dream is shown leans on similarity. */
  readonly embed?: boolean;
  /** Who answers: the recorded night's own calls (default), or a model (headless Claude Code, `model-seat.ts`). */
  readonly seat?: "recorded" | "model";
  /** With `seat: "model"`, the model the child runs; absent, Claude Code's default. */
  readonly model?: string;
  /** TESTS ONLY, with `seat: "model"`: the child's starter in place of a real `claude -p`. */
  readonly start?: NightStarter;
}

/** One side's verdict. */
export interface Compared<T> {
  readonly recorded: T;
  readonly replayed: T;
  readonly same: boolean;
}

export interface NightReplayRecord {
  readonly harness: "recorded-night";
  readonly ranAt: string;
  readonly elapsedMs: number;
  readonly night: { readonly state: string; readonly reason: string | null; readonly detail: string | null; readonly parts: readonly string[]; readonly children: readonly string[] };
  /** The composed launch prompts beside the recorded ones: lengths, and whether the words are the same once minted ids are mapped (by hash). */
  readonly prompts: { readonly dream: Compared<number> & { readonly wordsSame: boolean }; readonly reflection: Compared<number> & { readonly wordsSame: boolean } };
  /** Who sat in the seat: `harness:recorded`, or `harness:model[:<model>]`. */
  readonly seat: string;
  /** A model's children, as each said at start: the plugins it loaded (none expected) and its MCP servers (only `counterparts`). */
  readonly childInits?: Readonly<Record<string, ChildInit | null>>;
  readonly calls: Readonly<Record<string, CallTally>>;
  readonly idsMapped: number;
  readonly dream: {
    readonly state: Compared<string | null>;
    readonly titleSame: boolean;
    readonly changes: Compared<Readonly<Record<string, number>>>;
    readonly returns: Compared<number>;
  } | null;
  readonly reflection: {
    readonly state: Compared<string | null>;
    readonly pageVersion: Compared<number | null>;
    readonly returns: Compared<number>;
    readonly cites: Compared<number>;
  } | null;
  readonly keptAt: string | null;
}

export class NightReplayError extends Error {
  readonly code: string;
  constructor(code: string, detail = "") {
    super(detail.length > 0 ? `${code}: ${detail}` : code);
    this.name = "NightReplayError";
    this.code = code;
  }
}

function one<T>(db: Database, sql: string, ...args: (string | number)[]): T | null {
  return (db.query(sql).get(...args) as T | null) ?? null;
}

/** A dream's changes that stand, by kind (an undo since is not the night's). */
function changesOf(db: Database, dream: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.query("SELECT action, COUNT(*) AS n FROM dream_changes WHERE dream_id = ? AND undone = 0 GROUP BY action ORDER BY action").all(dream) as { action: string; n: number }[]) out[r.action] = r.n;
  return out;
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

/** SQLite's header says WAL at bytes 18-19 (2, 2): a lone copy of the main file would lose what the log holds. */
function inWalMode(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(20);
    readSync(fd, b, 0, 20, 0);
    return b[18] === 2 || b[19] === 2;
  } finally {
    closeSync(fd);
  }
}

/** Every id the store holds, in the tables a night mints into. */
function idsIn(path: string): Set<string> {
  const db = new Database(path, { readonly: true });
  try {
    const out = new Set<string>();
    for (const t of ["memories", "dreams", "reflections", "contradictions", "feelings"]) {
      for (const r of db.query(`SELECT id FROM ${t}`).all() as { id: string }[]) out.add(r.id);
    }
    return out;
  } finally {
    db.close();
  }
}

function compared<T>(recorded: T, replayed: T): Compared<T> {
  return { recorded, replayed, same: canonical(recorded) === canonical(replayed) };
}

/** Run a recorded night again on a copy of the store before it, and set it beside what the real night left. */
export async function replayNight(opts: NightReplayOptions): Promise<NightReplayRecord> {
  const startedAt = Date.now();
  const env = opts.env ?? process.env;
  const preset = env["COUNTERPARTS_DATA_DIR"];
  if (preset !== undefined && preset.trim().length > 0) throw new NightReplayError("DATA_DIR_PRESET", "the harness makes its own store; unset COUNTERPARTS_DATA_DIR");
  for (const [name, p] of [["source", opts.source], ["outcome", opts.outcome]] as const) {
    if (!existsSync(p)) throw new NightReplayError("MISSING", `${name}: ${p}`);
    if (underLiveRoot(p, env)) throw new NightReplayError("SOURCE_IS_LIVE", `${name}: copy it out of ~/.counterparts first`);
  }
  for (const [name, p] of [["source", opts.source], ["outcome", opts.outcome]] as const) {
    if (inWalMode(p)) throw new NightReplayError("SOURCE_IN_WAL", `${name}: its log would be left behind; take a snapshot (a single file) or checkpoint first`);
  }
  const dream = readChild(opts.dreamTranscript);
  const reflection = readChild(opts.reflectionTranscript);
  const recordedDream = dream.calls.map((c) => (c.result as Row | null)?.["dream"]).find((d): d is string => typeof d === "string" && WHOLE_ID.test(d)) ?? null;
  if (recordedDream === null) throw new NightReplayError("NO_DREAM", "the dream transcript never began a dream");

  const out = new Database(opts.outcome, { readonly: true });
  const night = one<{ session: string | null; scope: string | null }>(out, "SELECT session, scope FROM dreams WHERE id = ?", recordedDream);
  out.close();
  if (night === null) throw new NightReplayError("NO_OUTCOME", `the outcome store has no dream ${recordedDream}`);

  const root = resolve(opts.workRoot ?? tmpdir());
  if (underLiveRoot(root, env)) throw new NightReplayError("TARGET_IS_LIVE", root);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  // THE WORK FOLDER holds the store (in `store/`, which refuses any file it
  // does not know) and, beside it, the child's temp config.
  const work = mkdtempSync(join(realpathSync(root), "counterparts-night-"));
  const dir = join(work, "store");
  mkdirSync(dir);
  try {
    copyFileSync(opts.source, join(dir, DATABASE_FILE));
    // The copy is the replay's own to write, whatever mode the kept-aside source has.
    chmodSync(join(dir, DATABASE_FILE), 0o600);
    let clock = (dream.startedAt ?? dream.calls[0]?.at ?? Date.now()) - 1_000;
    // A MODEL IN THE SEAT takes real time: the clock runs on from the night's
    // start as the child's own server's does (`serve-at.ts`). The recorded
    // seat moves it to each call's recorded instant instead.
    const realStart = Date.now();
    const base = clock;
    const now = opts.seat === "model" ? (): number => base + (Date.now() - realStart) : (): number => clock;
    // THE CHILD'S SERVER EMBEDS, the night's own process does not: as live
    // (`mcp/bin/serve.ts` opens the static table; `openNightCounterpart` none).
    const embedder = opts.embed === false ? null : openEmbedder({ embedder: { enabled: true } });
    const store = (owner: boolean, withEmbedder: boolean): Counterpart =>
      Counterpart.open({
        dir,
        owner,
        budgetBytes: opts.budgetBytes ?? 9_000,
        now,
        ...(opts.timeZone === undefined ? {} : { timeZone: opts.timeZone }),
        ...(withEmbedder && embedder !== null && embedder.embed !== undefined ? { embed: embedder.embed } : {}),
      });
    const configPath = join(work, "harness-config.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: dir, owner: false, injectionBudgetBytes: opts.budgetBytes ?? 9_000 }));
    const model =
      opts.seat === "model"
        ? modelSeat({
            dir,
            configPath,
            now,
            ...(opts.timeZone === undefined ? {} : { timeZone: opts.timeZone }),
            ...(opts.budgetBytes === undefined ? {} : { budgetBytes: opts.budgetBytes }),
            ...(opts.embed === false ? { embed: false } : {}),
            ...(opts.model === undefined ? {} : { model: opts.model }),
            ...(opts.start === undefined ? {} : { start: opts.start }),
            env,
          })
        : null;
    const seat: Seat<NightAnswer> & { readonly tallies: Readonly<Record<string, CallTally>>; readonly ids: ReadonlyMap<string, string> } =
      model !== null
        ? {
            name: model.name,
            answer: (ask) => model.answer(ask),
            tallies: {},
            ids: new Map(),
          }
        : recordedSeat({
            dream,
            reflection,
            existed: idsIn(opts.source),
            open: () => store(false, true),
            embedder,
            setClock: (at) => {
              clock = Math.max(clock, at);
            },
            now,
            ...(opts.onCall === undefined ? {} : { onCall: opts.onCall }),
          });
    // The night's own prompts, captured as the seat is asked (compared by length and sameness only).
    const asked: Record<string, string> = {};
    const watching: Seat<NightAnswer> = {
      name: seat.name,
      answer: (ask) => {
        asked[ask.act] = ask.prompt;
        return seat.answer(ask);
      },
    };
    const replayStart = now();
    const run = await runNight({
      open: () => store(true, false),
      config: { dataDir: dir, owner: true, injectionBudgetBytes: opts.budgetBytes ?? 9_000, ...(opts.timeZone === undefined ? {} : { timeZone: opts.timeZone }) },
      run: "nrn_harness_replay",
      session: night.session ?? "",
      scope: night.scope ?? dir,
      kind: { kind: "night" },
      seat: watching,
      now,
    });

    const rec = new Database(opts.outcome, { readonly: true });
    const rep = new Database(join(dir, DATABASE_FILE), { readonly: true });
    try {
      // The replay's dream: the recorded one under its replayed id, or (a model in
      // the seat mints its own) the first begun since the replay started.
      const replayedDream =
        model !== null
          ? (one<{ id: string }>(rep, "SELECT id FROM dreams WHERE started_at >= ? ORDER BY started_at ASC LIMIT 1", replayStart - 1_000)?.id ?? "none")
          : (seat.ids.get(recordedDream) ?? recordedDream);
      const dreamRow = (db: Database, id: string) => one<{ state: string; title: string | null }>(db, "SELECT state, title FROM dreams WHERE id = ?", id);
      // The prompts name the night's dream: under the replay's id, whoever minted it.
      const promptIds = new Map(seat.ids);
      if (replayedDream !== recordedDream && replayedDream !== "none") promptIds.set(recordedDream, replayedDream);
      const recD = dreamRow(rec, recordedDream);
      const repD = dreamRow(rep, replayedDream);
      const returns = (db: Database, id: string, source: string): number => one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM returns WHERE dream_id = ? AND source = ?", id, source)?.n ?? 0;
      // THE NIGHT'S OWN reflection: the first on this dream started within the night's window.
      const reflectionRow = (db: Database, id: string, from: number, to: number) =>
        one<{ id: string; state: string; page_version: number | null; cites: string; day: number }>(
          db,
          "SELECT id, state, page_version, cites, day FROM reflections WHERE dream_id = ? AND started_at BETWEEN ? AND ? ORDER BY started_at ASC LIMIT 1",
          id,
          from,
          to,
        );
      const lastCall = Math.max(...[...dream.calls, ...reflection.calls].map((c) => c.at ?? 0), dream.startedAt ?? 0);
      const recR = reflectionRow(rec, recordedDream, (dream.startedAt ?? 0) - 60_000, lastCall + 60_000);
      const repR = reflectionRow(rep, replayedDream, replayStart - 60_000, now() + 60_000);
      // A reflection's returns carry its id as their session (`Store#reflectReturn`).
      const reflectionReturns = (db: Database, r: { id: string; day: number } | null): number =>
        r === null ? 0 : (one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM returns WHERE source = 'reflection' AND day = ? AND session = ?", r.day, r.id)?.n ?? 0);
      const count = (json: string | undefined): number => {
        try {
          const v = JSON.parse(json ?? "[]") as unknown;
          return Array.isArray(v) ? v.length : 0;
        } catch {
          return 0;
        }
      };
      return {
        harness: "recorded-night",
        ranAt: new Date(startedAt).toISOString(),
        elapsedMs: Date.now() - startedAt,
        night: {
          state: run.state,
          reason: run.reason,
          detail: run.detail,
          parts: [...(run.parts ?? [])],
          children: (run.children ?? []).map((c) => `${c.child}:${c.skipped ?? (c.code === null ? "no-code" : String(c.code))}`),
        },
        prompts: {
          dream: { ...compared(dream.prompt.length, (asked["dream"] ?? "").length), wordsSame: hash(withIds(dream.prompt, promptIds) as string) === hash(asked["dream"] ?? "") },
          reflection: { ...compared(reflection.prompt.length, (asked["reflection"] ?? "").length), wordsSame: hash(withIds(reflection.prompt, promptIds) as string) === hash(asked["reflection"] ?? "") },
        },
        seat: seat.name,
        ...(model === null ? {} : { childInits: model.inits }),
        calls: seat.tallies,
        idsMapped: seat.ids.size,
        dream:
          recD === null
            ? null
            : {
                state: compared<string | null>(recD.state, repD?.state ?? null),
                titleSame: repD !== null && recD.title === repD.title,
                changes: compared(changesOf(rec, recordedDream), changesOf(rep, replayedDream)),
                returns: compared(returns(rec, recordedDream, "dream"), returns(rep, replayedDream, "dream")),
              },
        reflection:
          recR === null
            ? null
            : {
                state: compared<string | null>(recR.state, repR?.state ?? null),
                pageVersion: compared(recR.page_version, repR?.page_version ?? null),
                returns: compared(reflectionReturns(rec, recR), reflectionReturns(rep, repR)),
                cites: compared(count(recR.cites), count(repR?.cites)),
              },
        keptAt: opts.keep === true ? work : null,
      };
    } finally {
      rec.close();
      rep.close();
    }
  } finally {
    if (opts.keep !== true) {
      rmSync(work, { recursive: true, force: true });
      // A model's children leave their transcripts (the copy's words in them)
      // under ~/.claude/projects, named after their working folder: the store
      // copy just removed. Only that folder, only when the name says it is ours.
      if (opts.seat === "model") {
        // `work` was made under a realpath, so `dir` is the path the child saw.
        const slug = dir.replace(/[^A-Za-z0-9-]/g, "-");
        const projects = join(env["HOME"] ?? "", ".claude", "projects", slug);
        if (slug.includes("counterparts-night-") && existsSync(projects)) rmSync(projects, { recursive: true, force: true });
      }
    }
  }
}
