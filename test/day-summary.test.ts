/**
 * THE DAY SUMMARY (lane D2, 2026-10-23; Mike's go 15:32, lightly held;
 * `self.DAY_SUMMARY`). Day's end leaves a few lines about the day with its
 * closing `self_page` call — with the page, or alone when the page stands —
 * stored on the night's own row (`self.page.writer.ran`'s payload); the dream
 * reads it first, as a header over its bundle, and the reflection reads the
 * last `TIMELINE_DAYS` days as a line a day, beside the chapters.
 *
 * Every check goes through the doors: `runNight` with a stubbed claude whose
 * children call the memory's MCP server as a night child does (the dream
 * tool's `writer` and `begin`, `self_page`, the reflect tool's `begin` and
 * `part`), the CLI (`counterparts night last`), and the dashboard's view.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNight } from "../src/adapters/claude-code/index.js";
import type { NightAnswer } from "../src/adapters/claude-code/index.js";
import { nightRunFindings } from "../src/adapters/claude-code/doctor-self-page.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import { run as cliRun } from "../src/adapters/cli/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { mindView } from "../src/adapters/dashboard/web/views.js";
import { toldWords } from "../src/adapters/dashboard/web/pages/self/sections/page.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { Seat, SeatAct, SeatAsk } from "../src/core/counterpart.js";
import { DREAM_TUNABLES, renderDream } from "../src/core/dream/index.js";
import type { DreamBundle } from "../src/core/dream/index.js";
import { AliasMap, readIndex } from "../src/core/fit/index.js";
import { SELF_TUNABLES, pageWriterNight } from "../src/core/self/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { addDays } from "../src/core/time.js";
import { daySummaryFor } from "../src/core/self/writer.js";

const S = SELF_TUNABLES as { DAY_SUMMARY: boolean; DAY_SUMMARY_CHARS: number; DAYS_END_INPUT: boolean; PAGE_SPLIT: boolean };
const WAS = { ...S };
const D = DREAM_TUNABLES as unknown as Record<string, number | boolean>;
const DWAS = { ...D };
const SESSION = "s-day-summary";
const DAY_MS = 86_400_000;
const LIVED = "2026-10-22";
const NIGHT_AT = Date.parse("2026-10-23T09:00:00Z");
let root: string;
let dir: string;
let clock = NIGHT_AT;
let substance = 0;
let zone = "UTC";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-day-summary-"));
  dir = join(root, "store");
  clock = NIGHT_AT;
  substance = 0;
  zone = "UTC";
  S.DAY_SUMMARY = true;
  S.DAYS_END_INPUT = true;
  S.PAGE_SPLIT = true;
});

afterEach(() => {
  Object.assign(S, WAS);
  for (const k of Object.keys(DWAS)) D[k] = DWAS[k] as number | boolean;
  rmSync(root, { recursive: true, force: true });
});

const sc = (r: ToolResult): Record<string, unknown> => r.structuredContent;

function open(at: () => number = () => clock, at2: string = dir): Counterpart {
  return Counterpart.open({ dir: at2, snapshotsDir: join(root, "snaps"), identity: { name: "Mike" }, now: at, timeZone: zone });
}

const PAGE = ["## Core", "", "I say what I do not know before I guess.", "", "## Lately", "", "Lately the work has been the night's children.", "", "## How I work", "", "I test through the real doors."].join("\n");
const HOLD = "The zqkiln's cone-six hold is thirty-five minutes at 1,100 degrees, Mira and I settled it.";
const CHAPTER_SUMMARY = "Settled the zqkiln hold at thirty-five minutes with Mira.";
const TOLD = "Today was the zqkiln: Mira and I settled the cone-six hold at thirty-five minutes.\nStill in motion: the glaze tests for the new clay body.";

/** Yesterday, lived: a page, a chapter with its summary, the hold, and a few weaker memories. */
function lived(fillers = 6): { episode: string; hold: string } {
  const c = open(() => Date.parse(`${LIVED}T15:00:00Z`));
  try {
    c.revisePage(PAGE, { reason: "a first page", by: "owner" });
    substance += 400;
    expect(c.episodeAsk(SESSION, { turns: substance, bytes: substance * 1_000 }).asked).toBe(true);
    const written = c.appendEpisode(SESSION, `We spent the afternoon at the zqkiln. ${"Mira and I compared the firing logs, cone by cone. ".repeat(30)}`, { summary: CHAPTER_SUMMARY, title: "The zqkiln afternoon" });
    const put = (body: string, over: Partial<PutInput> = {}): string => {
      const day = c.store.livedDay();
      return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.5, emotional: 0.2, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
    };
    const hold = put(HOLD, { salience: { relevance: 0.95, emotional: 0.9, predictive: 0.95 } });
    for (let i = 0; i < fillers; i += 1) put(`A smaller zqthing from the day, number ${String(i)}: the shelf paper and the door latch ${String(i)}.`);
    return { episode: written.episodeId as string, hold };
  } finally {
    c.close();
  }
}

type Act = (ask: SeatAsk, s: McpServer, c: Counterpart) => Promise<void>;

/** A stubbed claude: each act's child calls the memory's MCP server as a night child does. */
function seat(acts: Partial<Record<SeatAct, Act>>, asks: SeatAsk[] = []): Seat<NightAnswer> {
  return {
    name: "test",
    async answer(ask) {
      asks.push(ask);
      const act = acts[ask.act];
      if (act !== undefined) {
        const c = open();
        try {
          const s = new McpServer({ counterpart: c, session: ask.session, scope: ask.scope, registryDir: dir, env: { COUNTERPARTS_NIGHT_CHILD: ask.act, COUNTERPARTS_NIGHT_RUN: ask.run }, now: () => clock });
          await act(ask, s, c);
        } finally {
          c.close();
        }
      }
      return { refused: null, started: true, code: 0, timedOut: false, error: null, ms: 1 };
    },
  };
}

function night(s: Seat<NightAnswer>, run = "nrn_day_summary"): ReturnType<typeof runNight> {
  return runNight({ open: () => open(), config: { dataDir: dir, timeZone: zone }, run, session: SESSION, scope: "/proj", kind: { kind: "night" }, seat: s, now: () => clock });
}

/** The lines under "## <name>" in one text. */
function section(text: string, name: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inside = line.startsWith(`## ${name}`);
      if (inside) out.push(line);
      continue;
    }
    if (inside) out.push(line);
  }
  return out;
}

/** A day's end act: reads its block, writes the page with the summary (or the summary alone). */
function daysEnd(opts: { summary?: unknown; cites?: unknown; alone?: boolean; out?: Record<string, unknown>[]; how?: string[] }): Act {
  return async (_ask, s) => {
    const r = await s.call("dream", { phase: "writer", session: SESSION });
    expect(r.isError ?? false).toBe(false);
    opts.how?.push(String(sc(r)["how"]));
    const body = PAGE.replace("Lately the work has been the night's children.", "Lately the zqkiln's hold has been the steady part.");
    const args: Record<string, unknown> = opts.alone === true ? { session: SESSION } : { body, reason: "day's end", session: SESSION, ifVersion: sc(r)["ifVersion"] };
    if (opts.summary !== undefined) args["summary"] = opts.summary;
    if (opts.cites !== undefined) args["summaryCites"] = opts.cites;
    const answer = sc(await s.call("self_page", args));
    opts.out?.push(answer);
  };
}

describe("day's end leaves a day summary — the night entry with a stubbed claude", () => {
  test("asked for in the writer's how, kept on the night's row with its cites, read first by the dream, shown by `night last`, the dashboard and doctor", async () => {
    const y = lived();
    const out: Record<string, unknown>[] = [];
    const how: string[] = [];
    let dreamText = "";
    let bundleFresh: string[] = [];
    await night(
      seat({
        writer: daysEnd({ summary: TOLD, cites: [y.hold, "mem_000000000000", 7], out, how }),
        dream: async (_ask, s) => {
          const b = await s.call("dream", { phase: "begin", session: SESSION });
          expect(b.isError ?? false).toBe(false);
          dreamText = String(sc(b)["bundle"]);
          await s.call("dream", { phase: "journal", session: SESSION, dream: String(sc(b)["dream"]), text: "I dreamed of the kiln door." });
        },
      }),
    );
    // Asked for, with its cap and the one-call rule.
    expect(how[0]).toContain("send `summary`");
    expect(how[0]).toContain(`at most ${String(SELF_TUNABLES.DAY_SUMMARY_CHARS)} characters`);
    // Kept, with what its cites came to.
    expect(out[0]?.["stored"]).toBe(true);
    expect(out[0]?.["summary"]).toMatchObject({ kept: true, about: LIVED, chars: TOLD.length, cites: 1 });
    expect(out[0]?.["refusedSummaryCites"]).toEqual(["mem_000000000000", "7"]);
    const c = open();
    try {
      // On the night's own row: the revised one, with the session and run that told it.
      const row = c.pageWriterRuns({ about: pageWriterNight(c.store).about }).find((r) => r.outcome === "revised");
      expect(row?.summary).toBe(TOLD);
      expect(row?.summaryCites).toEqual([y.hold]);
      expect(row?.session).toBe(SESSION);
      // The dream read it first: the first section, before the page, the wake and fresh.
      const firstSection = dreamText.split("\n").find((l) => l.startsWith("## "));
      expect(firstSection).toMatch(/^## today, as day's end told it \(2026-10-22 · rests on m\d+\)$/);
      const head = section(dreamText, "today, as day's end told it");
      expect(head.slice(1).join("\n")).toBe(TOLD);
      // Its cite is put short, as tonight numbers it.
      const index = readIndex(c.store, "dream");
      const aliases = new AliasMap(index?.aliases ?? null);
      expect(aliases.resolve(/rests on (m\d+)/.exec(firstSection ?? "")?.[1] ?? "")).toBe(y.hold);
      bundleFresh = index?.fresh ?? [];
      expect(bundleFresh).toContain(y.hold);
      // dream.begun says it opened with it.
      const begun = c.store.eventLog({ name: "dream.begun", order: "desc", limit: 1 })[0];
      expect(JSON.parse(begun?.payload ?? "{}")["daysEnd"]).toBe(LIVED);
      // Doctor's Nightly line says so.
      const f = nightRunFindings({ today: "2026-10-23", config: { dataDir: dir } } as unknown as DoctorInput, c.store)[0];
      expect(f?.detail).toContain("day summary: yes");
    } finally {
      c.close();
    }
    // The CLI: `night last` shows what the dream opened with.
    const lines: string[] = [];
    await cliRun(["night", "last", "--dir", dir], { io: { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } });
    const said = lines.join("\n");
    expect(said).toContain(`Day's end told ${LIVED} (resting on ${y.hold}):`);
    expect(said).toContain("  Still in motion: the glaze tests for the new clay body.");
    // The dashboard: under the night's dot, the one place it shows.
    const dash = Dashboard.open({ dir });
    try {
      const v = mindView(dash.source);
      const day = v.pageDays.find((x) => x.told !== undefined);
      expect(day?.told).toEqual({ about: LIVED, text: TOLD });
      expect(toldWords(day)).toContain("Day's end told");
      expect(toldWords({ ...day, told: undefined })).toBe("");
    } finally {
      dash.close();
    }
  });

  test("the page standing: the summary alone answers the night as nothing-to-say, on a row carrying it; the dream still reads it first", async () => {
    lived();
    const out: Record<string, unknown>[] = [];
    let dreamText = "";
    await night(
      seat({
        writer: daysEnd({ summary: TOLD, alone: true, out }),
        dream: async (_ask, s) => {
          dreamText = String(sc(await s.call("dream", { phase: "begin", session: SESSION }))["bundle"]);
        },
      }),
    );
    expect(out[0]).toMatchObject({ stored: false, answered: "nothing-to-say", summary: { kept: true, about: LIVED } });
    const c = open();
    try {
      const runs = c.pageWriterRuns({ about: LIVED });
      const answer = runs.find((r) => r.outcome === "nothing-to-say");
      expect(answer?.summary).toBe(TOLD);
      expect(answer?.detail).toBe("day's end left the page as it stands");
      // The page is the one it was; the night is answered once (the dream's begin closed nothing more).
      expect(c.selfPage()?.body).toBe(PAGE);
      expect(runs.filter((r) => r.outcome === "nothing-to-say")).toHaveLength(1);
      expect(c.pageWriterStatus(LIVED).outcome).toBe("nothing-to-say");
    } finally {
      c.close();
    }
    expect(dreamText.split("\n").find((l) => l.startsWith("## "))).toBe(`## today, as day's end told it (${LIVED})`);
  });

  test("the cap, in characters: exactly the cap is kept; one over is refused with the numbers and nothing is written — page, row or summary", async () => {
    lived();
    const cap = SELF_TUNABLES.DAY_SUMMARY_CHARS;
    // An em dash is one character and three bytes: the cap counts characters.
    const exact = `Today — ${"z".repeat(cap - "Today — ".length)}`;
    expect(exact.length).toBe(cap);
    expect(Buffer.byteLength(exact, "utf8")).toBeGreaterThan(cap);
    const over = `${exact}z`;
    const out: Record<string, unknown>[] = [];
    let versionBefore = -2;
    let versionAfterRefusal = -2;
    let rowsAfterRefusal = -1;
    await night(
      seat({
        writer: async (ask, s, c) => {
          versionBefore = c.selfPage()?.version ?? -1;
          await daysEnd({ summary: over, out })(ask, s, c);
          versionAfterRefusal = c.selfPage()?.version ?? -1;
          rowsAfterRefusal = c.pageWriterRuns({ about: LIVED }).filter((r) => r.outcome !== "asked").length;
          const body = PAGE.replace("Lately the work has been the night's children.", "Lately the zqkiln's hold has been the steady part.");
          out.push(sc(await s.call("self_page", { body, reason: "day's end", session: SESSION, summary: exact })));
        },
      }),
    );
    const refused = out[0] as Record<string, unknown>;
    expect(refused["reason"]).toBe("summary-too-long");
    expect(refused).toMatchObject({ chars: cap + 1, cap, over: 1 });
    expect(String(refused["detail"])).toContain("Nothing was written.");
    expect(versionAfterRefusal).toBe(versionBefore);
    expect(rowsAfterRefusal).toBe(0);
    expect(out[1]).toMatchObject({ stored: true, summary: { kept: true, chars: cap } });
    const c = open();
    try {
      expect(c.pageWriterRuns({ about: LIVED }).find((r) => r.outcome === "revised")?.summary).toBe(exact);
    } finally {
      c.close();
    }
  });

  test("not day's end: an ordinary session's summary is named back as not kept — with a page, the page is written; alone, refused", async () => {
    lived(1);
    const c = open();
    try {
      const s = new McpServer({ counterpart: c, session: "s-awake", scope: "/proj", registryDir: dir, now: () => clock });
      const withPage = sc(await s.call("self_page", { body: `${PAGE}\n\nOne more line.`, reason: "by hand", summary: TOLD }));
      expect(withPage["stored"]).toBe(true);
      expect(String(withPage["summaryNotKept"])).toContain("day's end's");
      const alone = sc(await s.call("self_page", { summary: TOLD }));
      expect(alone["reason"]).toBe("summary-not-days-end");
      const bad = sc(await s.call("self_page", { summary: 42 }));
      expect(bad["reason"]).toBe("summary-not-text");
      expect(c.pageWriterRuns().filter((r) => r.summary.length > 0)).toHaveLength(0);
    } finally {
      c.close();
    }
  });

  test("a page written without a summary is said to have none, and the dream opens as it did", async () => {
    lived();
    const out: Record<string, unknown>[] = [];
    let dreamText = "";
    await night(
      seat({
        writer: daysEnd({ out }),
        dream: async (_ask, s) => {
          dreamText = String(sc(await s.call("dream", { phase: "begin", session: SESSION }))["bundle"]);
        },
      }),
    );
    expect(String(out[0]?.["summaryNotSent"])).toContain("No day summary");
    expect(dreamText).not.toContain("## today, as day's end told it");
  });

  test("day's end reading the ranked list (DAYS_END_INPUT off) is still asked for, and keeps, its summary", async () => {
    S.DAYS_END_INPUT = false;
    lived();
    const out: Record<string, unknown>[] = [];
    const how: string[] = [];
    await night(seat({ writer: daysEnd({ summary: TOLD, out, how }) }));
    expect(how[0]).toContain("send `summary`");
    expect(out[0]?.["summary"]).toMatchObject({ kept: true });
  });

  test("a night that crosses midnight between day's end and the dream: the dream still opens with what day's end told", async () => {
    lived();
    let dreamText = "";
    // Day's end at 23:50 on the 23rd; the dream at 00:10 on the 24th.
    clock = Date.parse("2026-10-23T23:50:00Z");
    await night(
      seat({
        writer: async (ask, s, c) => {
          await daysEnd({ summary: TOLD })(ask, s, c);
          clock = Date.parse("2026-10-24T00:10:00Z");
        },
        dream: async (_ask, s, c) => {
          // The night's own date has moved on: the 23rd, not the 22nd day's end told.
          expect(pageWriterNight(c.store).about).toBe("2026-10-23");
          dreamText = String(sc(await s.call("dream", { phase: "begin", session: SESSION }))["bundle"]);
        },
      }),
    );
    expect(dreamText.split("\n").find((l) => l.startsWith("## "))).toMatch(/^## today, as day's end told it \(2026-10-22/);
  });
});

describe("the dream's header is a header, not a replacement", () => {
  test("fresh, today, mixing and lookback unchanged in count and order; the text is the off text with the header added; off, no header at all", async () => {
    const y = lived(8);
    // Day's end, run once and stopped: its row carries the summary.
    await night(seat({ writer: daysEnd({ summary: TOLD, cites: [y.hold] }) }));
    // The same store twice, the night's dream not yet begun.
    const offDir = join(root, "store-off");
    cpSync(dir, offDir, { recursive: true });
    const begin = async (d: string): Promise<{ text: string; bundle: DreamBundle; id: string; aliases: AliasMap }> => {
      const c = open(() => clock, d);
      try {
        const s = new McpServer({ counterpart: c, session: SESSION, scope: "/proj", registryDir: d, env: { COUNTERPARTS_NIGHT_CHILD: "dream", COUNTERPARTS_NIGHT_RUN: "nrn_day_summary" }, now: () => clock });
        const r = await s.call("dream", { phase: "begin", session: SESSION });
        expect(r.isError ?? false).toBe(false);
        const id = String(sc(r)["dream"]);
        const index = readIndex(c.store, "dream");
        const fresh = index?.fresh ?? [];
        return { text: String(sc(r)["bundle"]), bundle: { fresh: fresh.map((f) => ({ id: f, neighbours: [] })) } as unknown as DreamBundle, id, aliases: new AliasMap(index?.aliases ?? null) };
      } finally {
        c.close();
      }
    };
    const on = await begin(dir);
    S.DAY_SUMMARY = false;
    const off = await begin(offDir);
    expect(off.text).not.toContain("today, as day's end told it");
    // The same night: what fresh shows, in what order.
    expect(on.bundle.fresh.map((f) => f.id)).toEqual(off.bundle.fresh.map((f) => f.id));
    // The header is the only difference, once the dream's own id (and its seeded picks) are set aside.
    const strip = (t: string, id: string): string[] =>
      t
        .replaceAll(id, "drm_X")
        .split("\n")
        .filter((l) => !l.startsWith("mixing") && !l.startsWith("lookback"));
    const onLines = strip(on.text, on.id);
    const at = onLines.findIndex((l) => l.startsWith("## today, as day's end told it"));
    expect(at).toBeGreaterThan(0);
    expect(onLines.slice(at + 1, at + 1 + TOLD.split("\n").length).join("\n")).toBe(TOLD);
    expect([...onLines.slice(0, at), ...onLines.slice(at + 1 + TOLD.split("\n").length)]).toEqual(strip(off.text, off.id));
    for (const key of ["fresh", "today", "mixing (", "lookback ("]) {
      expect(on.text.split("\n").filter((l) => l.startsWith(key)).length).toBe(off.text.split("\n").filter((l) => l.startsWith(key)).length);
    }
  });

  test("the JSON bundle (lean off): `daysEnd` sits before `limits` and `fresh`, and renders back as it went out", async () => {
    D["LEAN_BUNDLE"] = false;
    lived();
    let text = "";
    const out: Record<string, unknown>[] = [];
    await night(
      seat({
        writer: daysEnd({ summary: TOLD, out }),
        dream: async (_ask, s) => {
          text = String(sc(await s.call("dream", { phase: "begin", session: SESSION }))["bundle"]);
        },
      }),
    );
    expect(out[0]).toMatchObject({ stored: true });
    const json = text.slice(text.indexOf("\n") + 1);
    const b = JSON.parse(json) as DreamBundle;
    expect(b.daysEnd).toEqual({ about: LIVED, text: TOLD, cites: [] });
    const keys = Object.keys(b);
    expect(keys.indexOf("daysEnd")).toBeLessThan(keys.indexOf("limits"));
    expect(keys.indexOf("daysEnd")).toBeLessThan(keys.indexOf("fresh"));
    expect(renderDream(b.dream, b, "")).toBe(text);
  });
});

describe("the reflection's timeline — the last three weeks, a line a day", () => {
  /** Day's end's rows for `n` days ending the day before the reflection, every `step`th day. */
  function told(c: Counterpart, days: readonly string[]): void {
    for (const about of days) c.recordPageWriterRun({ about, mode: "session", outcome: "revised", summary: `On ${about} the zqkiln, and the glaze tests went on.\nA second line for ${about}.` });
  }

  /** A dream begun and journaled (the first time), then a reflection begun on it and every part read. A reflection begun and not finished can be begun again. */
  async function reflect(c: Counterpart): Promise<{ texts: string[]; rid: string }> {
    let dream = c.store.dreams({ limit: 1 })[0]?.id ?? "";
    if (dream === "") {
      const ds = new McpServer({ counterpart: c, session: SESSION, scope: "/proj", registryDir: dir, env: { COUNTERPARTS_NIGHT_CHILD: "dream", COUNTERPARTS_NIGHT_RUN: "nrn_t" }, now: () => clock });
      const b = await ds.call("dream", { phase: "begin", session: SESSION });
      expect(b.isError ?? false).toBe(false);
      dream = String(sc(b)["dream"]);
      await ds.call("dream", { phase: "journal", session: SESSION, dream, text: "A dream that changed nothing." });
    }
    const rs = new McpServer({ counterpart: c, session: SESSION, scope: "/proj", registryDir: dir, env: { COUNTERPARTS_NIGHT_CHILD: "reflection", COUNTERPARTS_NIGHT_RUN: "nrn_t" }, now: () => clock });
    const rb = await rs.call("reflect", { phase: "begin", session: SESSION, dream });
    expect(rb.isError ?? false).toBe(false);
    const rid = String(sc(rb)["reflection"]);
    const texts = [String(sc(rb)["bundle"])];
    const of = Number(/parts: part 1 of (\d+)/.exec(texts[0] as string)?.[1] ?? "1");
    for (let p = 2; p <= of; p += 1) texts.push(String(sc(await rs.call("reflect", { phase: "part", session: SESSION, reflection: rid, part: p }))["bundle"]));
    return { texts, rid };
  }

  test("21 summaries: 21 day lines, newest first, each its summary's first line when the whole is past the line's cap, beside the chapters; once, in part 1", async () => {
    lived();
    const c = open();
    try {
      const days = Array.from({ length: 21 }, (_, i) => addDays(LIVED, -i));
      told(c, days);
      const { texts } = await reflect(c);
      const t = section(texts[0] as string, "timeline");
      expect(t[0]).toContain("## timeline: the last 21 days through 10-22");
      expect(t[0]).not.toContain("without");
      const lines = t.slice(1).filter((l) => /^\d\d-\d\d/.test(l));
      expect(lines).toHaveLength(21);
      expect(lines[0]).toBe(`10-22 · On ${LIVED} the zqkiln, and the glaze tests went on. A second line for ${LIVED}.`);
      expect(lines.map((l) => l.slice(0, 5))).toEqual(days.map((d) => d.slice(5)));
      // The timeline sits beside the chapters: right before them.
      const head = (texts[0] as string).split("\n").filter((l) => l.startsWith("## "));
      expect(head.indexOf(t[0] as string) + 1).toBe(head.findIndex((l) => l.startsWith("## chapters")));
      for (const later of texts.slice(1)) expect(later).not.toContain("## timeline");
      // A summary past the line's cap: its first line, with the whole length.
      D["TIMELINE_LINE_CHARS"] = 50;
      const again = await reflect(c);
      const cut = section(again.texts[0] as string, "timeline").find((l) => l.startsWith("10-22"));
      expect(cut).toMatch(/^10-22 · On 2026-10-22 the zqkiln, and the glaze tests…? \(\d+\)$|^10-22 · .{1,50} \(\d+\)$/);
    } finally {
      c.close();
    }
  });

  test("21 days with 3 summaries: those 3 from day's end, a day with chapters from its chapters, the rest counted as without", async () => {
    lived();
    const c = open();
    try {
      told(c, [addDays(LIVED, -1), addDays(LIVED, -5), addDays(LIVED, -20)]);
      const { texts } = await reflect(c);
      const t = section(texts[0] as string, "timeline");
      const lines = t.slice(1).filter((l) => /^\d\d-\d\d/.test(l));
      // The 22nd has no summary but a chapter: from its chapters, marked so.
      expect(lines[0]).toBe(`10-22 (chapters; 1) · ${CHAPTER_SUMMARY}`);
      expect(lines.filter((l) => !l.includes("(chapters"))).toHaveLength(3);
      expect(lines).toHaveLength(4);
      expect(t[0]).toContain("; 17 days without a summary or a chapter");
    } finally {
      c.close();
    }
  });

  test("off: no timeline at all, and the reflection's text is the one it was before any summary existed", async () => {
    lived();
    const c = open();
    try {
      S.DAY_SUMMARY = false;
      const before = await reflect(c);
      expect(before.texts[0]).not.toContain("## timeline");
      // A day summary on the record changes nothing while the switch is off.
      told(c, [LIVED, addDays(LIVED, -1)]);
      const after = await reflect(c);
      // The same, but for the reflection's id and its three questions (they turn each begin).
      const same = (t: string, rid: string): string => t.replaceAll(rid, "rfl_X").replace(/questions:\n1\. .*\n2\. .*\n3\. .*\n/, "questions:\n");
      expect(same(after.texts[0] as string, after.rid)).toBe(same(before.texts[0] as string, before.rid));
      expect(after.texts.length).toBe(before.texts.length);
    } finally {
      c.close();
    }
  });

  test("a busy night: the long view still whole with the timeline present", async () => {
    lived();
    const c = open();
    try {
      // A big core and candidates, and 21 days told at the cap.
      const day = c.store.livedDay();
      const core: string[] = [];
      for (let i = 0; i < 40; i += 1) core.push(c.store.put({ type: "memory", kind: "self", about: "me", body: `Who I am, zq${String(i)}: ${"I hold to this across the work. ".repeat(20)}`, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day, promotedIdentity: true } }));
      for (const about of Array.from({ length: 21 }, (_, i) => addDays(LIVED, -i))) c.recordPageWriterRun({ about, mode: "session", outcome: "revised", summary: "z".repeat(SELF_TUNABLES.DAY_SUMMARY_CHARS) });
      const { texts, rid } = await reflect(c);
      const aliases = c.reflections.aliasesOf(rid) as AliasMap;
      const memLines = texts.flatMap((t) => section(t, "memories").slice(1)).map((l) => aliases.resolve(l.split(" · ")[0]?.trim() ?? "") ?? "");
      for (const id of core) expect(memLines).toContain(id);
      const t = section(texts[0] as string, "timeline");
      expect(t.slice(1).filter((l) => /^\d\d-\d\d/.test(l))).toHaveLength(21);
    } finally {
      c.close();
    }
  });
});

void DAY_MS;
