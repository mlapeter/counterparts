/**
 * THE NIGHT PROPOSES A PROJECT (2026-10-21, wave 2 lane G, design §8:
 * "related folders join one project on Mike's word, or the night proposes it
 * from co-use and asks"). Mechanical, no model: two folders whose memories
 * were written on the same lived days and name the same subjects
 * (`memory_subjects`) in the last `PROJECT_JOIN_WINDOW` days look like one
 * piece of work. The reflection's finish adds ONE such pair a night to its
 * morning share as a question (`joinSentence`), keeps it on its row
 * (`detail.joinProposed`), and tells the session how to act on a yes
 * (`joinHow`): the reflect tool's phase "join" joins them, `by: night`
 * (`Counterpart.joinProject`). A no, or no answer, changes nothing, and the
 * pair rests `PROJECT_JOIN_REST` reflections before it is asked again.
 *
 * Never proposed: two folders already one project; a folder the host keeps
 * home (`folderOn`, as the reflection's other gates); the store's own folder
 * (the nightly run's) or one inside it. Lightly held; `PROJECT_JOIN_ASK` off
 * stops it. Kept apart from `reflect.ts`, as `core-ask.ts` is.
 */
import { folderName, projectFolder } from "../self/index.js";
import type { Store } from "../store/index.js";
import { DREAM_TUNABLES } from "./tunables.js";

export interface JoinProposal {
  /** The folder whose project the other joins (the busier one). */
  readonly into: string;
  /** The folder that would join it. */
  readonly folder: string;
  /** Lived days both were written in, inside the window. */
  readonly days: number;
  /** A few of the subjects both named, by name. */
  readonly subjects: readonly string[];
}

/** The key a pair rests under, either way round. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** A proposal read back from a reflection's detail, or null. */
export function joinProposalOf(raw: unknown): JoinProposal | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["into"] !== "string" || typeof r["folder"] !== "string") return null;
  return {
    into: r["into"],
    folder: r["folder"],
    days: typeof r["days"] === "number" ? r["days"] : 0,
    subjects: Array.isArray(r["subjects"]) ? r["subjects"].filter((x): x is string => typeof x === "string") : [],
  };
}

/**
 * THE BEST PAIR TONIGHT, or null. `rested`: pair keys asked about lately.
 * Reads only. Never throws: a store that will not answer proposes nothing.
 */
export function proposeJoin(
  store: Pick<Store, "folderCoUse" | "projectOfFolder" | "dir" | "row">,
  opts: { readonly day: number; readonly rested?: ReadonlySet<string>; readonly folderOn?: (scope: string) => boolean },
): JoinProposal | null {
  const T = DREAM_TUNABLES;
  if (!T.PROJECT_JOIN_ASK) return null;
  try {
    const home = projectFolder(store.dir);
    const days = new Map<string, Set<number>>();
    const subjects = new Map<string, Map<string, number>>();
    const written = new Map<string, number>();
    const names = new Map<string, string>();
    const shown = new Map<string, string>();
    for (const r of store.folderCoUse(opts.day - T.PROJECT_JOIN_WINDOW + 1)) {
      const f = projectFolder(r.scope);
      if (f === home || f.startsWith(`${home}/`) || home.startsWith(`${f}/`)) continue;
      (days.get(f) ?? days.set(f, new Set()).get(f) as Set<number>).add(r.day);
      written.set(f, (written.get(f) ?? 0) + 1);
      if (r.subject !== null) {
        // By NAME: two cards of one name ("Apple", "Apple") are one thing here.
        const name = (names.get(r.subject) ?? names.set(r.subject, (store.row(r.subject)?.title ?? "").trim()).get(r.subject)) as string;
        if (name.length === 0) continue;
        const held = subjects.get(f) ?? subjects.set(f, new Map()).get(f) as Map<string, number>;
        const key = name.toLowerCase();
        held.set(key, (held.get(key) ?? 0) + 1);
        shown.set(key, name);
      }
    }
    const on = (f: string): boolean => {
      if (opts.folderOn === undefined) return true;
      try {
        return opts.folderOn(f);
      } catch {
        return false;
      }
    };
    const folders = [...days.keys()].filter((f) => (days.get(f)?.size ?? 0) >= T.PROJECT_JOIN_DAYS && on(f)).sort();
    // A SUBJECT EVERY FOLDER NAMES SAYS NOTHING ABOUT WHICH GO TOGETHER: the
    // owner, the assistant, the product everything is about. Measured on the
    // corpus copy, "Mike, Counterparts, Claude" paired every busy folder with
    // every other. Only subjects named in at most half the active folders
    // (and never fewer than two) count.
    const spread = new Map<string, number>();
    for (const f of folders) for (const s of subjects.get(f)?.keys() ?? []) spread.set(s, (spread.get(s) ?? 0) + 1);
    const telling = (s: string): boolean => (spread.get(s) ?? 0) <= Math.max(2, Math.floor(folders.length / 2));
    const projectOf = (f: string): string => store.projectOfFolder(f)?.project_id ?? `folder:${f}`;
    let best: (JoinProposal & { score: number }) | null = null;
    for (let i = 0; i < folders.length; i++) {
      for (let j = i + 1; j < folders.length; j++) {
        const a = folders[i] as string;
        const b = folders[j] as string;
        if (opts.rested?.has(pairKey(a, b)) === true || projectOf(a) === projectOf(b)) continue;
        const da = days.get(a) as Set<number>;
        const shared = [...(days.get(b) as Set<number>)].filter((d) => da.has(d)).length;
        // USED ON THE SAME DAYS: at least `PROJECT_JOIN_DAYS`, and at least
        // half the days of the less-used folder — two busy folders share many
        // days by chance alone.
        const fewer = Math.min(da.size, (days.get(b) as Set<number>).size);
        if (shared < T.PROJECT_JOIN_DAYS || shared * 2 < fewer) continue;
        const sa = subjects.get(a) ?? new Map<string, number>();
        const sb = subjects.get(b) ?? new Map<string, number>();
        const both = [...sa.keys()].filter((s) => sb.has(s) && telling(s)).sort((x, y) => (sa.get(y) ?? 0) + (sb.get(y) ?? 0) - ((sa.get(x) ?? 0) + (sb.get(x) ?? 0)) || (x < y ? -1 : 1));
        // NAMING THE SAME THINGS: at least `PROJECT_JOIN_SUBJECTS`, and at least
        // `PROJECT_JOIN_OVERLAP` of the telling subjects of the folder that
        // names fewer (on the corpus copy ~/random and ~/counterparts shared
        // 0.64; every other pair 0.25 or under).
        const tellingOf = (m: Map<string, number>): number => [...m.keys()].filter(telling).length;
        const smaller = Math.min(tellingOf(sa), tellingOf(sb));
        if (both.length < T.PROJECT_JOIN_SUBJECTS || both.length < T.PROJECT_JOIN_OVERLAP * smaller) continue;
        const score = shared * both.length;
        if (best !== null && score <= best.score) continue;
        const [into, folder] = (written.get(a) ?? 0) >= (written.get(b) ?? 0) ? [a, b] : [b, a];
        best = { into, folder, days: shared, subjects: both.slice(0, 3).map((k) => shown.get(k) ?? k), score };
      }
    }
    if (best === null) return null;
    const { score: _score, ...proposal } = best;
    return proposal;
  } catch {
    return null;
  }
}

/** The share's question, in the counterpart's voice. */
export function joinSentence(p: JoinProposal): string {
  const things = p.subjects.filter((x) => x.length > 0);
  return (
    `${folderName(p.folder)} and ${folderName(p.into)} look like one piece of work: written in on the same ${String(p.days)} days lately` +
    `${things.length > 0 ? `, both about ${things.join(", ")}` : ""}. Shall I treat them as one project, so each one's wake shows the other's work? ` +
    `If you'd rather not, I won't ask about these two again for a while.`
  );
}

/** How the session acts on the owner's answer. */
export function joinHow(reflection: string, p: JoinProposal, who: string): string {
  return (
    `The share asks ${who} whether ${folderName(p.folder)} and ${folderName(p.into)} are one project: ask it plainly. ` +
    `On ${who}'s yes, the counterparts reflect tool's phase "join", reflection: ${reflection}, joins them. On a no, or no answer, nothing changes.`
  );
}
