/**
 * WHAT THE PAGE SETS DOWN (PG1, 2026-11-09; Mike's decision 11-07, the
 * Fable fresh-eyes review's batch 1, lightly held).
 *
 * The page sits at its room every night, so every new line pushes an old one
 * out, and the night's page writers decide what goes. Until this, nothing
 * recorded it: nobody could tell a line folded into a story from a line gone.
 * The room stays (the pressure is what made the page stories rather than
 * stone tablets); what changes is that a nightly write says what it set down,
 * and the engine checks it.
 *
 *   1. The writer NAMES what it sets down (`setDown: [{line, why}]`, at the
 *      `self_page` door and on the reflection's `page`).
 *   2. A SENTENCE DIFF of the page before and after (`diffSetDowns`, pure)
 *      sorts every sentence gone word for word: REWORDED when most of its
 *      words are still in one new sentence (or two side by side), not a
 *      set-down; FOLDED when the writer said so and enough of its words are
 *      found across a short run of new sentences; otherwise SET DOWN, as
 *      named, or "unnamed" when the writer did not name it. A line the writer
 *      called folded that is not found is recorded anyway. So a silent drop
 *      can't happen, whatever the writer says.
 *   3. Each set-down becomes a memory (`recordSetDowns`): about me, tagged
 *      `set down`, the line word for word, the why, the version it left.
 *      Written by the night (`source: reflection`), so the night's own reads
 *      (the news since last night, the reflection's lived lists, beliefs)
 *      pass it by as they pass every night row.
 *   4. The wake says it once, the morning after (`counterpart-wake-shape.ts`).
 *   5. The way back: the night's page writers are shown the set-downs life
 *      touched since (`setDownsTouched`); nothing comes back by itself.
 *
 * Only the nightly doors are read (`writer`, `reflection`): a session's or the
 * owner's own edit is theirs and is not second-guessed here.
 *
 * Every number is in `tunables.ts#SET_DOWN_LIMITS`.
 */
import { scanSecrets } from "../encode/secrets.js";
import type { Store } from "../store/index.js";
import { stemTerm } from "../store/stem.js";
import { monthDay } from "../time.js";
import { CLAIM_PREFIX_MIN_CHARS, claimKey, pageClaims, pageSections, type StoredTrace } from "./page.js";
import type { SelfPageAuthor } from "./page.js";
import { SET_DOWN_LIMITS as L } from "./tunables.js";

/** The tag every set-down memory carries, and recall's handle for them. */
export const SET_DOWN_TAG = "set down";
export const SET_DOWN_HANDLE = "set down";
/** The meta key with the set-down's facts (`SetDownFacts`): the structured truth; the tag is the index. */
export const SET_DOWN_META = "setDown";
/** One per nightly write that set anything down or kept anything by rewording or folding: counts and ids only. */
export const SET_DOWN_EVENT = "self.page.set_down";
/** A write that put a set-down line back on the page: the set-down's id. */
export const SET_DOWN_BACK_EVENT = "self.page.brought_back";
/** The why recorded for a line the writer did not name. */
export const UNNAMED_WHY = "set down, unnamed";

/** What a writer names: the line as it was on the page, and a short why. */
export interface SetDownNamed {
  readonly line: string;
  readonly why: string;
}

/** One sentence the page had, with the heading it sat under ("" before any). */
export interface PageSentence {
  readonly text: string;
  readonly section: string;
}

/**
 * What became of one sentence gone word for word. `reworded` and `folded` are
 * kept (not set-downs); `named` and `unnamed` are set down.
 */
export interface SetDownVerdict {
  readonly line: string;
  readonly section: string;
  readonly outcome: "reworded" | "folded" | "named" | "unnamed";
  readonly why: string;
  /** The best share of its words found: in one or two new sentences for `reworded`, in a run for `folded`. */
  readonly share: number;
  /** The new sentence(s) it was best matched to, for a reviewer. */
  readonly match: string | null;
}

export interface SetDownDiff {
  readonly verdicts: readonly SetDownVerdict[];
  /** Named lines that matched no sentence gone (still on the page, or never on it). */
  readonly unmatchedNamed: readonly SetDownNamed[];
}

/** The facts a set-down memory carries in its meta (`SET_DOWN_META`). */
export interface SetDownFacts {
  readonly line: string;
  readonly why: string;
  readonly named: boolean;
  readonly section: string;
  /** The page version it left (the one before the write), and the one written without it. */
  readonly from: number;
  readonly to: number;
  readonly by: SelfPageAuthor;
  /** The calendar date of the night (`YYYY-MM-DD`). */
  readonly date: string;
  /** The ids the line rested on, from the page's trace, when it had any. */
  readonly restedOn?: readonly string[];
  /** Its place among the lines one write set down (0 first), so a night's are told in the page's order. */
  readonly pos?: number;
}

/** A set-down memory as the readers see it. */
export interface SetDownRow extends SetDownFacts {
  readonly id: string;
  readonly createdAt: number;
  readonly birthDay: number;
  readonly uses: number;
  readonly lastUsedDay: number;
}

// ── the diff (pure) ─────────────────────────────────────────────────────────

/** The page's sentences in order, each with its section's heading (`page.ts#pageClaims`, section by section). Pure. */
export function pageSentences(body: string): PageSentence[] {
  const s = pageSections(body);
  if (!s.headed) return pageClaims(body).map((text) => ({ text, section: "" }));
  const out: PageSentence[] = pageClaims(s.preamble).map((text) => ({ text, section: "" }));
  for (const sec of s.sections) for (const text of pageClaims(sec.body)) out.push({ text, section: sec.heading });
  return out;
}

/**
 * Function words: not a stop list for search (the store has none on purpose),
 * only what tells "the same point" from "the same grammar" in this one diff.
 */
const FUNCTION_WORDS = new Set(
  (
    "the and but for nor yet not with from into onto than then that this these those there here what when where which who whom whose why how " +
    "are was were been being have has had having does did doing done will would can could should shall may might must " +
    "its it's i'm i've i'd i'll you your yours our ours his her hers him she they them their theirs mine myself " +
    "also just very more most much many some any all each every other such only own same too about over under again once " +
    "because while until though although whether both either neither"
  ).split(" "),
);

/** A sentence's content words, folded and stemmed, function words aside. Pure. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().replace(/[’‘]/g, "'").matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)) {
    const w = m[0].replace(/'s$/, "").replace(/^-+|-+$/g, "");
    if (w.length < L.WORD_MIN || FUNCTION_WORDS.has(w)) continue;
    out.add(stemTerm(w));
  }
  return out;
}

/** The share of `of`'s words found in `in`, 0..1. An empty `of` is 0. Pure. */
export function shareOf(of: ReadonlySet<string>, inWords: ReadonlySet<string>): number {
  if (of.size === 0) return 0;
  let hit = 0;
  for (const w of of) if (inWords.has(w)) hit += 1;
  return hit / of.size;
}

/** The best share of `words` in a run of at most `window` adjacent sentences of `page`, and that run. Pure. */
export function bestRun(words: ReadonlySet<string>, page: readonly { text: string; words: ReadonlySet<string> }[], window: number): { share: number; match: string | null } {
  let best = { share: 0, match: null as string | null };
  for (let i = 0; i < page.length; i += 1) {
    const run = new Set<string>();
    const texts: string[] = [];
    for (let k = 0; k < window && i + k < page.length; k += 1) {
      const s = page[i + k];
      if (s === undefined) break;
      for (const w of s.words) run.add(w);
      texts.push(s.text);
      const share = shareOf(words, run);
      if (share > best.share) best = { share, match: texts.join(" ") };
    }
  }
  return best;
}

/** Words as matched for naming: case, spacing, emphasis and curly quotes folded. */
function fold(text: string): string {
  return text.replace(/[*_`]/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Does the writer's named line name this sentence? Same words, an opening of it, or most of its words. */
function names(named: string, sentence: string): boolean {
  if (claimKey(named) === claimKey(sentence)) return true;
  const a = fold(named).replace(/[.!?…"]+$/u, "");
  const b = fold(sentence).replace(/[.!?…"]+$/u, "");
  if (a.length >= CLAIM_PREFIX_MIN_CHARS && b.startsWith(a)) return true;
  if (b.length >= CLAIM_PREFIX_MIN_CHARS && a.startsWith(b)) return true;
  return shareOf(contentWords(sentence), contentWords(named)) >= L.NEAR_SHARE;
}

/** A why that says "folded": its first word. */
function saysFolded(why: string): boolean {
  return /^\s*fold/i.test(why);
}

/**
 * THE DIFF: every sentence of `before` not on `after` word for word, sorted
 * (see the header). `named` is the writer's own list. Sentences with no
 * content word are passed by. Pure and deterministic.
 */
export function diffSetDowns(before: string, after: string, named: readonly SetDownNamed[] = []): SetDownDiff {
  const now = pageSentences(after).map((s) => ({ ...s, words: contentWords(s.text) }));
  const nowKeys = new Set(now.map((s) => claimKey(s.text)));
  const seen = new Set<string>();
  const used = new Set<number>();
  const verdicts: SetDownVerdict[] = [];
  for (const s of pageSentences(before)) {
    const key = claimKey(s.text);
    if (nowKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    const words = contentWords(s.text);
    if (words.size === 0) continue;
    const near = bestRun(words, now, L.NEAR_WINDOW);
    const at = named.findIndex((n, i) => !used.has(i) && names(n.line, s.text));
    const n = at < 0 ? undefined : named[at];
    if (near.share >= L.NEAR_SHARE) {
      // Still on the page in other words: kept, whatever was named for it (a
      // named "folded" is the writer's word for the same thing).
      if (at >= 0) used.add(at);
      const folded = n !== undefined && saysFolded(n.why);
      verdicts.push({ line: s.text, section: s.section, outcome: folded ? "folded" : "reworded", why: folded ? n.why.replace(/\s+/g, " ").trim() : "reworded", share: near.share, match: near.match });
      continue;
    }
    if (n === undefined) {
      verdicts.push({ line: s.text, section: s.section, outcome: "unnamed", why: UNNAMED_WHY, share: near.share, match: near.match });
      continue;
    }
    used.add(at);
    const why = n.why.replace(/\s+/g, " ").trim();
    if (saysFolded(why)) {
      const folded = bestRun(words, now, L.FOLD_WINDOW);
      verdicts.push(
        folded.share >= L.FOLD_SHARE
          ? { line: s.text, section: s.section, outcome: "folded", why, share: folded.share, match: folded.match }
          : { line: s.text, section: s.section, outcome: "named", why: `said folded, but not found on the page (${why})`, share: folded.share, match: folded.match },
      );
      continue;
    }
    verdicts.push({ line: s.text, section: s.section, outcome: "named", why: why.length === 0 ? "named, no why given" : why, share: near.share, match: near.match });
  }
  return { verdicts, unmatchedNamed: named.filter((_, i) => !used.has(i)) };
}

/** True when a verdict is a set-down (a memory is made of it). */
export function isSetDown(v: SetDownVerdict): boolean {
  return v.outcome === "named" || v.outcome === "unnamed";
}

/** A page read once for many `lineOnPage` questions. */
export interface PreparedPage {
  readonly keys: ReadonlySet<string>;
  readonly sentences: readonly { text: string; words: ReadonlySet<string> }[];
}

/** The page's sentences, keys and words, read once. Pure. */
export function preparePage(page: string): PreparedPage {
  const sentences = pageSentences(page).map((s) => ({ text: s.text, words: contentWords(s.text) }));
  return { keys: new Set(sentences.map((s) => claimKey(s.text))), sentences };
}

/** Is `line` on `page` — word for word, or reworded past `NEAR_SHARE`? Pure. */
export function lineOnPage(line: string, page: string | PreparedPage): boolean {
  const p = typeof page === "string" ? preparePage(page) : page;
  if (p.keys.has(claimKey(line))) return true;
  const words = contentWords(line);
  return words.size > 0 && bestRun(words, p.sentences, L.NEAR_WINDOW).share >= L.NEAR_SHARE;
}

/** "Set down from my page MM-DD: <line>", the line cut at a word past `TITLE_CHARS`. Pure. */
export function setDownTitle(line: string, date: string): string {
  const flat = line.replace(/\s+/g, " ").trim();
  let shown = flat;
  if (flat.length > L.TITLE_CHARS) {
    const cut = flat.slice(0, L.TITLE_CHARS);
    const space = cut.lastIndexOf(" ");
    shown = `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:—-]+$/u, "")}…`;
  }
  return `Set down from my page ${monthDay(date)}: ${shown}`;
}

/** The memory's words: the line whole, then where it left and why. Pure. */
export function setDownBody(f: Pick<SetDownFacts, "line" | "why" | "from" | "by" | "date" | "section">): string {
  const who = f.by === "writer" ? "day's end" : "the reflection";
  const where = f.section.length === 0 ? "" : ` (under "${f.section}")`;
  return `${f.line}\n\nSet down from my self page${where} on ${f.date}, when ${who} rewrote it (the line was on version ${String(f.from)}). Why: ${f.why}.`;
}

// ── the store's side ────────────────────────────────────────────────────────

/** A row's set-down facts, or null when it is not one. */
export function setDownFactsOf(meta: Readonly<Record<string, unknown>>): SetDownFacts | null {
  const v = meta[SET_DOWN_META];
  if (v === null || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  if (typeof f["line"] !== "string" || typeof f["why"] !== "string") return null;
  const by = f["by"] === "writer" || f["by"] === "reflection" ? f["by"] : "reflection";
  return {
    line: f["line"],
    why: f["why"],
    named: f["named"] === true,
    section: typeof f["section"] === "string" ? f["section"] : "",
    from: typeof f["from"] === "number" ? f["from"] : -1,
    to: typeof f["to"] === "number" ? f["to"] : -1,
    by,
    date: typeof f["date"] === "string" ? f["date"] : "",
    ...(Array.isArray(f["restedOn"]) ? { restedOn: (f["restedOn"] as unknown[]).filter((x): x is string => typeof x === "string") } : {}),
    ...(typeof f["pos"] === "number" ? { pos: f["pos"] } : {}),
  };
}

/**
 * THE LIVE SET-DOWNS, newest first, at most `limit` (`SCAN` by default):
 * tagged `set down` and carrying the facts. Never throws.
 */
export function readSetDowns(store: Store, limit: number = L.SCAN): SetDownRow[] {
  const out: SetDownRow[] = [];
  let ids: string[];
  try {
    // The tag is the index; a store without the tag table finds them by their facts.
    ids = store.memoriesTagged(SET_DOWN_TAG);
    if (ids.length === 0) ids = store.idsWithMetaKey(SET_DOWN_META);
  } catch {
    return [];
  }
  for (const id of ids) {
    try {
      const r = store.row(id);
      if (r === undefined || r.archived !== 0 || r.superseded_by !== null) continue;
      const f = setDownFactsOf(store.readProse(id).meta);
      if (f === null) continue;
      out.push({ ...f, id, createdAt: r.created_at ?? 0, birthDay: r.birth_day, uses: r.uses, lastUsedDay: r.last_used_day });
    } catch {
      /* one unreadable row is not the list */
    }
  }
  // Newest first: by write (its moment, then the version it wrote), then the page's order reversed.
  out.sort((a, b) => b.createdAt - a.createdAt || b.to - a.to || (b.pos ?? 0) - (a.pos ?? 0) || (a.id < b.id ? 1 : -1));
  return out.slice(0, limit);
}

/**
 * THE SET-DOWNS OF ONE NIGHT, by its calendar date (both doors of a night
 * write under it), oldest first: the order the page had them. Never throws.
 */
export function nightSetDowns(store: Store, date: string): SetDownRow[] {
  return readSetDowns(store)
    .filter((r) => r.date === date)
    .reverse();
}

/** What `recordSetDowns` did, for the door's answer and the event. */
export interface SetDownRecord {
  /** Memories made, one per line set down. */
  readonly ids: readonly string[];
  readonly named: number;
  readonly unnamed: number;
  readonly reworded: number;
  readonly folded: number;
  /** Set down past `MAX_PER_WRITE`, counted only. */
  readonly over: number;
  /** Named lines that matched no sentence gone. */
  readonly unmatchedNamed: number;
  /** Set-downs this write put back on the page. */
  readonly back: readonly string[];
}

/**
 * RECORD A NIGHTLY WRITE'S SET-DOWNS: the diff of `before` and `after`, a
 * memory per line set down (at most `MAX_PER_WRITE`), the set-downs this write
 * brought back (an event each; nothing is changed on them), and one event with
 * the counts. Throws only what the store throws; the caller keeps the page
 * written either way.
 */
export function recordSetDowns(
  store: Store,
  input: {
    readonly before: { readonly body: string; readonly version: number; readonly trace: StoredTrace | null };
    readonly after: string;
    readonly version: number;
    readonly named: readonly SetDownNamed[];
    readonly by: SelfPageAuthor;
    readonly session: string | null;
    readonly date: string;
    readonly day: number;
    readonly pageId: string;
    readonly model?: string;
    /** The starting claim of a memory about me (`physics.defaultClaimFor`), from the caller. */
    readonly claim: number;
  },
): SetDownRecord {
  const diff = diffSetDowns(input.before.body, input.after, input.named);
  const down = diff.verdicts.filter(isSetDown);
  const kept = down.slice(0, L.MAX_PER_WRITE);
  const restedOf = (line: string): string[] => {
    const claims = input.before.trace?.claims ?? null;
    if (claims === null) return [];
    const key = claimKey(line);
    return [...(claims.find((c) => c.of === key)?.cites ?? [])];
  };
  const ids: string[] = [];
  for (const [pos, v] of kept.entries()) {
    const restedOn = restedOf(v.line);
    // The why is the writer's own words, never through the page's gate:
    // through the secrets scan, as a chapter title is. The line was on the page.
    const scanned = scanSecrets(v.why, "title");
    const facts: SetDownFacts = {
      line: v.line,
      why: scanned.emptyAfterRedaction ? UNNAMED_WHY : scanned.redacted,
      named: v.outcome === "named",
      section: v.section,
      from: input.before.version,
      to: input.version,
      by: input.by,
      date: input.date,
      ...(restedOn.length === 0 ? {} : { restedOn }),
      pos,
    };
    ids.push(
      store.put({
        type: "memory",
        kind: "self",
        title: setDownTitle(v.line, input.date),
        body: setDownBody(facts),
        meta: { [SET_DOWN_META]: facts },
        about: "me",
        aboutBy: input.by === "writer" ? "writer" : "reflection",
        // The night's words, not a lived act: the night's own reads pass it by.
        source: "reflection",
        origin: { ...(input.session === null ? {} : { session: input.session }), ref: input.pageId },
        salience: { claimed: input.claim },
        physics: { birthDay: input.day, lastUsedDay: input.day },
        tags: [SET_DOWN_TAG],
        tagsVia: "write",
        ...(input.model === undefined ? {} : { model: input.model }),
      }),
    );
  }
  // BROUGHT BACK: a set-down whose line this write put back (not on the page
  // before, on it now). Said by event; the memory stays as it was.
  const back: string[] = [];
  if (input.after !== input.before.body) {
    const was = preparePage(input.before.body);
    const now = preparePage(input.after);
    for (const r of readSetDowns(store)) {
      if (ids.includes(r.id)) continue;
      if (lineOnPage(r.line, now) && !lineOnPage(r.line, was)) {
        back.push(r.id);
        store.appendEvent({ name: SET_DOWN_BACK_EVENT, day: input.day, ref: r.id, payload: { by: input.by, session: input.session, version: input.version } });
      }
    }
  }
  const count = (o: SetDownVerdict["outcome"]): number => diff.verdicts.filter((v) => v.outcome === o).length;
  const record: SetDownRecord = {
    ids,
    named: count("named"),
    unnamed: count("unnamed"),
    reworded: count("reworded"),
    folded: count("folded"),
    over: down.length - kept.length,
    unmatchedNamed: diff.unmatchedNamed.length,
    back,
  };
  if (diff.verdicts.length > 0 || input.named.length > 0 || back.length > 0) {
    // Counts and ids only: the lines are on the memories, never in the log.
    store.appendEvent({
      name: SET_DOWN_EVENT,
      day: input.day,
      ref: input.pageId,
      payload: {
        by: input.by,
        session: input.session,
        from: input.before.version,
        to: input.version,
        ids,
        named: record.named,
        unnamed: record.unnamed,
        reworded: record.reworded,
        folded: record.folded,
        over: record.over,
        sentNamed: input.named.length,
        unmatchedNamed: record.unmatchedNamed,
        back,
      },
    });
  }
  return record;
}

/** A set-down life touched since, and how. */
export interface SetDownTouched extends SetDownRow {
  readonly touched: "used" | "restated";
  /** On `restated`: the newer memory that says it again. */
  readonly by_memory?: string;
}

/**
 * THE WAY BACK: live set-downs that life touched since they were set down —
 * used (recalled and credited, drawn on, cited: `uses`, a later
 * `last_used_day`), or restated by a newer memory (most of the line's words in
 * one newer memory, `NEAR_SHARE`) — and not on the page now. `lane` keeps
 * them to the lane that can bring them back (`Core` for the reflection, the
 * rest for day's end; null: all). Newest first, at most `BACK_SHOWN`. Never
 * throws.
 */
export function setDownsTouched(store: Store, opts: { page: string | null; lane: "core" | "rest" | null; core: string }): SetDownTouched[] {
  try {
    const page = opts.page === null ? null : preparePage(opts.page);
    const all = readSetDowns(store).filter((r) => {
      const isCore = r.section.toLowerCase() === opts.core.toLowerCase();
      if (opts.lane === "core" && !isCore) return false;
      if (opts.lane === "rest" && isCore) return false;
      return page === null || !lineOnPage(r.line, page);
    });
    if (all.length === 0) return [];
    const out: SetDownTouched[] = [];
    const untouched: SetDownRow[] = [];
    for (const r of all) {
      if (r.uses > 0 || r.lastUsedDay > r.birthDay) out.push({ ...r, touched: "used" });
      else untouched.push(r);
    }
    if (untouched.length > 0) {
      const oldest = untouched.reduce((m, r) => (r.createdAt < m.createdAt ? r : m));
      const newer = store
        .newMemoryIds({ sinceAt: oldest.createdAt, sinceDay: oldest.birthDay, limit: L.RESTATED_READ })
        .flatMap((id) => {
          const row = store.row(id);
          if (row === undefined || row.type !== "memory") return [];
          try {
            const p = store.readProse(id);
            if (setDownFactsOf(p.meta) !== null) return [];
            return [{ id, at: row.created_at ?? 0, words: contentWords(`${p.title ?? ""} ${p.body}`) }];
          } catch {
            return [];
          }
        });
      for (const r of untouched) {
        const words = contentWords(r.line);
        const hit = newer.find((m) => m.at > r.createdAt && shareOf(words, m.words) >= L.NEAR_SHARE);
        if (hit !== undefined) out.push({ ...r, touched: "restated", by_memory: hit.id });
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, L.BACK_SHOWN);
  } catch {
    return [];
  }
}

/**
 * THE WAY BACK, AS THE NIGHT'S WRITER READS IT: a short block, or null when
 * nothing was touched. `flat` makes a quoted line one line (the caller's
 * marker-stripping flattener).
 */
export function setDownsBackLines(touched: readonly SetDownTouched[], flat: (s: string) => string): string[] | null {
  if (touched.length === 0) return null;
  return [
    `Lines your page set down that life has touched since (used, or said again in a newer memory). You may bring one back if it holds again, in your own words or as it was; nothing comes back unless you write it:`,
    ...touched.map(
      (t) =>
        `- ${t.id} · set down ${t.date} (${flat(t.why)}); ${t.touched === "used" ? "used since" : `said again in ${t.by_memory ?? "a newer memory"}`}${
          t.restedOn === undefined || t.restedOn.length === 0 ? "" : `; it rested on ${t.restedOn.join(", ")} (cite those, or the newer memory, if it goes back)`
        }: "${flat(t.line)}"`,
    ),
  ];
}

/** What a door says back about a write's set-downs, one or two sentences; null when there is nothing to say. Pure. */
export function setDownNote(r: SetDownRecord | undefined): string | null {
  if (r === undefined) return null;
  const parts: string[] = [];
  const set = r.ids.length + r.over;
  if (set > 0) {
    const how = [r.named > 0 ? `${String(r.named)} named` : "", r.unnamed > 0 ? `${String(r.unnamed)} not named, recorded as set down unnamed` : ""].filter((s) => s.length > 0).join(", ");
    parts.push(`Set down ${String(set)} ${set === 1 ? "line" : "lines"} (${how}), each kept as a memory: recall "${SET_DOWN_HANDLE}".`);
  }
  if (r.folded + r.reworded > 0) parts.push(`${String(r.folded + r.reworded)} gone word for word ${r.folded + r.reworded === 1 ? "was" : "were"} found on the page reworded or folded, and not set down.`);
  if (r.unmatchedNamed > 0) parts.push(`${String(r.unmatchedNamed)} named in setDown ${r.unmatchedNamed === 1 ? "is" : "are"} still on the page or never were, and nothing was recorded for ${r.unmatchedNamed === 1 ? "it" : "them"}.`);
  if (r.back.length > 0) parts.push(`Brought back: ${r.back.join(", ")}.`);
  return parts.length === 0 ? null : parts.join(" ");
}

/** The why words a writer is told to use (and the field's shape), the same at both doors. */
export const SET_DOWN_RULE =
  'With the page, pass `setDown`: each line of the page as it stood that you are taking out and not keeping elsewhere on it, word for word, with a short why — "retired by <the newer ruling>", "folded into <where>" (only when its point is still on the page), "no longer lived", or "room". A sentence you only reworded needs no entry. Anything gone that you did not name is recorded anyway, as set down unnamed, and every set-down line is kept as a memory, so taking one out loses nothing.';
