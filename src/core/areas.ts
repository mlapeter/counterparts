/**
 * THE AREAS A LASTING FACT BEARS ON (BO1, 2026-11-17; the writer's field is
 * `bearsOn`): the everyday areas a lasting fact about the owner, the two of
 * us, or someone they care for changes advice about without naming them —
 * vegan: cooking, restaurants, gifts. Measured miss (Memorilla "Buried
 * Clue"): "vegan, so they avoid leather" was never reached by "what should I
 * cook for my parents", because nothing it was indexed under said food.
 *
 * KEPT IN THE TEXT, as its last paragraph (`Also about: cooking, gifts.`),
 * because the token index and the embedder read exactly title + body
 * (`store/index-text.ts#indexTextOf`) at every site that indexes: no index
 * change, no store-format change. The label's two words are both query
 * stopwords (`recall/reference.ts#STOPWORDS`, which the facts search drops)
 * and among the commonest words a store holds (the per-prompt cues weight by
 * rarity), so the label itself reaches nothing — "Bears on:" matched "bear
 * safety" and "the Chicago Bears".
 *
 * Folded AFTER the battery (`remember/proposals.ts#prepareProposal`): the
 * content floor and the redaction judge the writer's own words, so the line
 * never rescues a stub or a credential, and the duplicate check hashes the
 * text without it. Two engine backstops, because a description alone did not
 * hold on the bench writer (e7's smoke, 11-17): areas are kept only on a
 * memory about the owner or us, or a person; and an area whose words the text
 * already names is dropped.
 */
import { STOPWORDS } from "./recall/reference.js";
import { indexTerms } from "./store/index.js";
import { screenTags } from "./tag-screen.js";

export const AREAS_LABEL = "Also about:";
const AREAS_LINE = /^\s*also about:/i;

/** What `admitAreas` drops off-subject, said once for the whole list. */
export const AREAS_OFF_SUBJECT = "areas are for lasting facts about people (about owner or us, or a person)";

/** Does the text already carry an areas line (the writer's own, or a fold)? */
export function hasAreasLine(text: string): boolean {
  return text.split("\n").some((l) => AREAS_LINE.test(l));
}

/** The text's areas line, or null. */
export function areasLineOf(text: string): string | null {
  return text.split("\n").find((l) => AREAS_LINE.test(l))?.trim() ?? null;
}

/** The text without its areas line: what a heading, an excerpt or a neighbour's word overlap reads. */
export function stripAreasLine(text: string): string {
  if (!hasAreasLine(text)) return text;
  return text
    .split("\n")
    .filter((l) => !AREAS_LINE.test(l))
    .join("\n")
    .trimEnd();
}

/** The text with `line` as its last paragraph, the text first ending as a sentence (so a first-sentence heading stops there). */
function appendLine(text: string, line: string): string {
  const body = text.trimEnd();
  const ended = /[.!?…)"'”’\]]$/u.test(body) ? body : `${body}.`;
  return `${ended}\n\n${line}`;
}

/** The areas folded into the text. Nothing to fold, or a line already there: the text as it was. */
export function foldAreas(text: string, areas: readonly string[]): string {
  if (areas.length === 0 || text.trim().length === 0 || hasAreasLine(text)) return text;
  return appendLine(text, `${AREAS_LABEL} ${areas.join(", ")}.`);
}

/** A carried areas line (a revision's), onto text that has none. */
export function carryAreasLine(text: string, line: string): string {
  if (text.trim().length === 0 || hasAreasLine(text)) return text;
  return appendLine(text, line);
}

export interface AreasRead {
  /** Absent: not sent. Null: sent as none (a revision carries nothing over). */
  readonly sent?: readonly string[] | null;
  /** Why each one went, plainly — never the value itself (it may hold a secret). */
  readonly dropped: readonly string[];
}

/** The writer's `bearsOn`, loose first: a list or a comma-separated string, through the tags' one screen. */
export function readAreas(raw: unknown): AreasRead {
  if (raw === undefined) return { dropped: [] };
  if (raw === null || (Array.isArray(raw) && raw.length === 0)) return { sent: null, dropped: [] };
  const items: unknown[] = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [raw];
  const { kept, dropped } = screenTags(items);
  const said = dropped.map((d) => d.replace(/\btag\b/g, "area").replace(/\btags\b/g, "areas"));
  return kept.length === 0 ? { dropped: said } : { sent: [...kept], dropped: said };
}

/**
 * The engine's two backstops. Off-subject (not about owner or us, and not a
 * person): none kept. Otherwise each area whose words (stemmed, as the index
 * stems them, stopwords aside) the title or text already holds is dropped —
 * it adds nothing a search there would not already find.
 */
export function admitAreas(
  areas: readonly string[],
  on: { readonly about: string | null | undefined; readonly kind: unknown; readonly text: string },
): { readonly areas: readonly string[]; readonly dropped: readonly string[] } {
  if (areas.length === 0) return { areas: [], dropped: [] };
  const person = on.about === "owner" || on.about === "us" || on.kind === "person";
  if (!person) return { areas: [], dropped: [AREAS_OFF_SUBJECT] };
  const named = new Set(indexTerms(on.text));
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const a of areas) {
    const terms = indexTerms(a).filter((t) => !STOPWORDS.has(t));
    if (terms.length === 0) dropped.push(`"${a}" (no word a search would use)`);
    else if (terms.some((t) => named.has(t))) dropped.push(`"${a}" (the text already names it)`);
    else kept.push(a);
  }
  return { areas: kept, dropped };
}

/** The areas an areas line names, in order. */
export function areasOfLine(line: string): string[] {
  return line
    .replace(AREAS_LINE, "")
    .replace(/\.\s*$/, "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/**
 * A NIGHT'S MERGE OR FOLD KEEPS WHAT ITS SOURCES BORE ON (review of #846,
 * round 2): the dream writes the model's words as the new body, so a line the
 * sources carried would go with them. When the new body has none and any
 * source had one, the union of their areas — through the one screen, so at
 * most `TAGS_PER_MEMORY` — becomes its line. Not re-judged for subject: each
 * was admitted when its source was written.
 */
export function keepSourcesAreas(body: string, sources: readonly string[]): string {
  if (hasAreasLine(body)) return body;
  const all = sources.flatMap((s) => {
    const line = areasLineOf(s);
    return line === null ? [] : areasOfLine(line);
  });
  if (all.length === 0) return body;
  return foldAreas(body, screenTags(all).kept);
}
