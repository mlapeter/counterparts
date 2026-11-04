/**
 * CHECKABLE EXPECTATIONS FOR A SCRIPTED WEEK (2026-11-04, the developer week).
 *
 * A script can say, fact by fact, where what its person said should come back
 * and where it must not: a personal or "us" fact in every folder, a work fact
 * in its own folder only. The week then reads that off the run itself instead
 * of a person reading a trace by hand:
 *
 *   - at every wake (a session's start, and a compaction's fresh one) and every
 *     prompt's injection, each fact's `probe` is tried against what the memory
 *     handed the model, and a match is kept as a hit: the session's label, its
 *     folder, where (wake, compact-wake, prompt), and in a wake the heading it
 *     sat under (the product's own furniture, cut at its colon);
 *   - at the week's end, the store's live memories that match, counted by the
 *     folder they were written in and by their `about` mark.
 *
 * Ids, labels, folders and headings only: no text of the run goes into the
 * record, as with the rest of `WeekRecord`.
 *
 * What a hit is NOT: proof the model used the fact, or that a reply said it.
 * It is what the memory delivered. Replies are the model's.
 */

export interface Expectation {
  /** Short and stable: "P1-partner", "W3-flaky-test". */
  readonly id: string;
  readonly kind: "personal" | "us" | "work";
  /** The fact in a few words, for the scorecard. Synthetic, never a run's text. */
  readonly fact: string;
  /** Tried against what the memory handed the model. Pick words no starter note or manual line carries. */
  readonly probe: RegExp;
  /** The session it is first said in (`d<day>s<n>`), and that session's folder. */
  readonly told: string;
  readonly folder: string;
  /** Folders it should reach after it is told: every folder the week has, or these. */
  readonly reach: "every" | readonly string[];
  /** Folders it must not reach: every folder but its own, or these (none: `[]`). */
  readonly never: "others" | readonly string[];
}

export type HitWhere = "wake" | "compact-wake" | "prompt";

export interface ExpectationHit {
  readonly id: string;
  readonly label: string;
  readonly folder: string;
  readonly where: HitWhere;
  /** The heading above the match in a wake ("Elsewhere", "Who I am", ...), or null. */
  readonly section: string | null;
}

export interface ExpectationReading {
  readonly id: string;
  readonly kind: Expectation["kind"];
  readonly fact: string;
  readonly told: string;
  readonly folder: string;
  /**
   * Per folder it should reach: `seen` (first session it came back in),
   * `missed` (sessions there after it was told, none carried it), or
   * `no-session` (the week had no session there after it was told).
   */
  readonly reach: readonly { readonly folder: string; readonly verdict: "seen" | "missed" | "no-session"; readonly first: string | null; readonly sessions: number }[];
  /** Hits in a folder it must not reach, after it was told. */
  readonly leaks: readonly Omit<ExpectationHit, "id">[];
  /** Live memories at the week's end that match, by the folder they were written in ("?" when none). */
  readonly store: Readonly<Record<string, number>>;
  /** The same memories by their `about` mark ("none" when unmarked). */
  readonly about: Readonly<Record<string, number>>;
}

/** A wake's line that heads a section: not indented, not a list item, and either a markdown head or words then a colon. */
function headingOf(line: string): string | null {
  if (line.length === 0 || line.startsWith(" ") || line.startsWith("-")) return null;
  const md = /^#{1,4}\s+(.{1,40})/.exec(line);
  if (md !== null) return md[1]!.trim();
  const colon = /^([A-Z][A-Za-z ,'()]{1,40}):/.exec(line);
  return colon === null ? null : colon[1]!.trim();
}

/** The heading the text at `index` sits under, or null when none is above it. */
export function sectionAt(text: string, index: number): string | null {
  const lines = text.slice(0, index).split("\n");
  // The match's own line can be a heading's ("Elsewhere: sim, ..."), so it is read too.
  const own = text.slice(index).split("\n")[0] ?? "";
  lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + own;
  for (let i = lines.length - 1; i >= 0; i--) {
    const h = headingOf(lines[i]!);
    if (h !== null) return h;
  }
  return null;
}

/** Every expectation `text` matches, as hits at this place. */
export function probeHits(expectations: readonly Expectation[], text: string, at: { readonly label: string; readonly folder: string; readonly where: HitWhere }): ExpectationHit[] {
  const out: ExpectationHit[] = [];
  if (text.length === 0) return out;
  for (const e of expectations) {
    const re = new RegExp(e.probe.source, e.probe.flags.replace("g", ""));
    const m = re.exec(text);
    if (m === null) continue;
    out.push({ id: e.id, label: at.label, folder: at.folder, where: at.where, section: at.where === "prompt" ? null : sectionAt(text, m.index) });
  }
  return out;
}

/**
 * The scorecard: each expectation against the run's hits, its sessions in
 * order (label and folder), and the store's live memories at the end. A hit
 * counts from the session after the one that told it; a compaction's wake in
 * the telling session counts too (that is the catch-up the fact had to make).
 */
export function readExpectations(
  expectations: readonly Expectation[],
  hits: readonly ExpectationHit[],
  sessions: readonly { readonly label: string; readonly folder: string }[],
  memories: readonly { readonly folder: string; readonly about: string | null; readonly text: string }[],
): ExpectationReading[] {
  const order = new Map(sessions.map((s, i) => [s.label, i]));
  const folders = [...new Set(sessions.map((s) => s.folder))];
  return expectations.map((e) => {
    const told = order.get(e.told) ?? -1;
    const after = (h: ExpectationHit): boolean => {
      const i = order.get(h.label) ?? -1;
      return i > told || (i === told && h.where === "compact-wake");
    };
    const mine = hits.filter((h) => h.id === e.id && after(h));
    const reachFolders = e.reach === "every" ? folders : e.reach;
    const reach = reachFolders.map((folder) => {
      const there = sessions.filter((s, i) => s.folder === folder && (i > told || (i === told && mine.some((h) => h.label === s.label))));
      const first = mine.find((h) => h.folder === folder)?.label ?? null;
      return { folder, verdict: first !== null ? ("seen" as const) : there.length === 0 ? ("no-session" as const) : ("missed" as const), first, sessions: there.length };
    });
    const never = e.never === "others" ? folders.filter((f) => f !== e.folder) : e.never;
    const leaks = mine.filter((h) => never.includes(h.folder)).map(({ id: _id, ...rest }) => rest);
    const re = new RegExp(e.probe.source, e.probe.flags.replace("g", ""));
    const store: Record<string, number> = {};
    const about: Record<string, number> = {};
    for (const m of memories) {
      if (!re.test(m.text)) continue;
      store[m.folder] = (store[m.folder] ?? 0) + 1;
      const a = m.about ?? "none";
      about[a] = (about[a] ?? 0) + 1;
    }
    return { id: e.id, kind: e.kind, fact: e.fact, told: e.told, folder: e.folder, reach, leaks, store, about };
  });
}

/** The scorecard as lines: one per expectation, then its leaks. */
export function renderExpectations(rows: readonly ExpectationReading[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const reach = r.reach.map((x) => `${x.folder} ${x.verdict === "seen" ? `seen ${x.first ?? ""}` : x.verdict === "missed" ? `MISSED (${String(x.sessions)})` : "no session"}`).join(" · ");
    const store = Object.entries(r.store).map(([f, n]) => `${f} ${String(n)}`).join(", ") || "none";
    const about = Object.entries(r.about).map(([a, n]) => `${a} ${String(n)}`).join(", ") || "none";
    out.push(`  ${r.id} (${r.kind}, told ${r.told} in ${r.folder}): ${reach} · leaks ${String(r.leaks.length)} · in the store: ${store} (about: ${about})`);
    for (const l of r.leaks) out.push(`    LEAK ${l.label} ${l.folder} ${l.where}${l.section === null ? "" : ` under "${l.section}"`}`);
  }
  return out;
}
