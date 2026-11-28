/**
 * A turn's cue words as the shipped path builds them, and as they would be
 * without its token window — measured on the store copy, never recorded.
 *
 * THE SHIPPED PATH (`recall/activate.ts#activate`, read 2026-11-28): the token
 * loop collects the prompt's distinct tokens of `MIN_CUE_LENGTH`+ characters
 * in order and STOPS at `MAX_CUES * 3` (72). Document frequency is asked only
 * for those, and `buildCues` drops a df-0 word, so a word that first appears
 * after the 72nd distinct token can never be a cue, however rare. The 24 kept
 * are the 24 heaviest of that window. `window` below replicates exactly that
 * (checked against `Recall.build().cueWords` by `index.ts check-cues`);
 * `whole` is the same rule with no window, for comparison only.
 */
import { buildCues, type Cue } from "../../src/core/recall/cues.js";
import { TUNABLES as RECALL_TUNABLES, type RecallTunables } from "../../src/core/recall/tunables.js";
import { stemTerm, tokenize } from "../../src/core/store/index.js";
import type { Store } from "../../src/core/store/index.js";

export interface CueAnalysis {
  /** Distinct index terms of MIN_CUE_LENGTH+ tokens anywhere in the text. */
  readonly distinctTerms: number;
  /** Of those, how many carry weight (df > 0 and not everyday-zeroed) over the whole text. */
  readonly eligibleWhole: number;
  /** How many carry weight inside the shipped token window. */
  readonly eligibleWindow: number;
  /** Char offset (in the analysed text) where the token window ends; text length if it never filled. */
  readonly windowEndChar: number;
  /** The kept cues, shipped path: top MAX_CUES of the window. */
  readonly kept: Cue[];
  /** Window-eligible cues, heaviest first (the window, no cap). */
  readonly window: Cue[];
  /** Whole-text eligible cues, heaviest first (no window, no cap). */
  readonly whole: Cue[];
  /** First char offset of each term (by index term), in the analysed text. */
  readonly firstAt: Map<string, number>;
}

/** tokenize() with each token's char offset (same split rule as `store/cache.ts#tokenize`). */
export function tokensWithOffsets(text: string): { tok: string; at: number }[] {
  const out: { tok: string; at: number }[] = [];
  const lower = text.toLowerCase();
  const re = /[a-z0-9]+/g;
  for (let m = re.exec(lower); m !== null; m = re.exec(lower)) if (m[0].length >= 2) out.push({ tok: m[0], at: m.index });
  return out;
}

function dfFor(store: Store, forms: Map<string, string[]>): Map<string, number> {
  const byForms = store.docFrequency([...forms.values()].map((f) => f.join(" ")));
  const df = new Map<string, number>();
  for (const [key, f] of forms) {
    const n = byForms.get(f.join(" "));
    if (n !== undefined) df.set(key, n);
  }
  return df;
}

export function analyseCues(store: Store, text: string, t: RecallTunables = RECALL_TUNABLES): CueAnalysis {
  const toks = tokensWithOffsets(text);
  const firstAt = new Map<string, number>();
  const allForms = new Map<string, string[]>();
  const windowForms = new Map<string, string[]>();
  const seen = new Set<string>();
  let windowEndChar = text.length;
  let windowCount = 0;
  for (const { tok, at } of toks) {
    if (tok.length < t.MIN_CUE_LENGTH) continue;
    const key = stemTerm(tok);
    if (!firstAt.has(key)) firstAt.set(key, at);
    const f = allForms.get(key) ?? [];
    if (!f.includes(tok)) f.push(tok);
    allForms.set(key, f);
    if (seen.has(tok)) continue;
    if (windowCount >= t.MAX_CUES * 3) {
      if (windowEndChar === text.length) windowEndChar = at;
      continue;
    }
    seen.add(tok);
    windowCount += 1;
    const w = windowForms.get(key) ?? [];
    if (!w.includes(tok)) w.push(tok);
    windowForms.set(key, w);
  }
  const storeSize = store.countMemories({ archived: false });
  const wordNorm = (w: string): number | null => (store as unknown as { wordNorm?: (w: string) => number | null }).wordNorm?.(w) ?? null;
  const uncapped: RecallTunables = { ...t, MAX_CUES: 1_000_000 };
  const windowCues = buildCues({ text, carried: [], storeSize, df: dfFor(store, windowForms), term: stemTerm, wordNorm }, uncapped);
  const whole = buildCues({ text, carried: [], storeSize, df: dfFor(store, allForms), term: stemTerm, wordNorm }, uncapped);
  return {
    distinctTerms: allForms.size,
    eligibleWhole: whole.length,
    eligibleWindow: windowCues.length,
    windowEndChar,
    kept: windowCues.slice(0, t.MAX_CUES),
    window: windowCues,
    whole,
    firstAt,
  };
}

/** The kept cues as recorded terms are written (`recall/index.ts#cueWordsOf`, minus the ambiguity drop, which needs the alias map). */
export function keptTerms(a: CueAnalysis, which: "kept" | "window" | "whole" = "kept"): string[] {
  const out: string[] = [];
  for (const c of a[which]) {
    const term = stemTerm(c.token);
    if (term.length > 0 && !out.includes(term)) out.push(term);
  }
  return out;
}

export { tokenize };
