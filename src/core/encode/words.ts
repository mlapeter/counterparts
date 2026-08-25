/**
 * The ONE whole-word definition, and the ONE normalization the content floor
 * uses.
 *
 * Substring name matching is gone, settled by measurement (CONTRACT §4): the self
 * schema is *named* "self", so 21% of its matches came from the English inside
 * "myself", "itself", and "self-contained" — dragging ~100 KB of identity core
 * into prompts about nothing of the sort while the schemas the span actually
 * named went unshown.
 *
 * Behavioral-spec §8 G3: whole-word matching has ONE definition, SHARED WITH
 * SCHEMA BIRTH. `schemas/` must import this function rather than write its own,
 * or the two drift and a name that "was in the span" for one is not for the
 * other. That is why it lives in its own file with no other dependencies.
 */

/**
 * What counts as inside a word. Hyphens and apostrophes ARE word characters,
 * which is the whole point: it is precisely because `-` does not break a word
 * that "self" fails to match "self-contained" — the measured false positive.
 * A multi-word term like "claude code" still matches, because the boundary test
 * only looks at the characters on either END of the term.
 */
const WORD_CHAR = "[\\p{L}\\p{N}_'’-]";

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A regex matching `term` as a whole word. Case-insensitive, deliberately and
 * without an option: an option is how two callers drift apart, and "verbatim in
 * the source" is a claim about the WORDS, not about the shift key (NOTES.md).
 */
export function wholeWordRegex(term: string, flags = "iu"): RegExp {
  const t = escapeRegExp(term.trim());
  return new RegExp(`(?<!${WORD_CHAR})${t}(?!${WORD_CHAR})`, flags);
}

/** True when `term` occurs in `haystack` as a whole word. Empty terms never match. */
export function occursAsWholeWord(haystack: string, term: string): boolean {
  const t = term.trim();
  if (t.length === 0) return false;
  return wholeWordRegex(t).test(haystack);
}

/** How many whole-word occurrences. Used for per-channel attribution, not counts of text. */
export function countWholeWord(haystack: string, term: string): number {
  const t = term.trim();
  if (t.length === 0) return 0;
  const re = wholeWordRegex(t, "giu");
  let n = 0;
  while (re.exec(haystack) !== null) n += 1;
  return n;
}

/**
 * The floor's normalization: case-folded, punctuation and markdown scaffolding
 * removed, whitespace collapsed. The stub list is matched against THIS, exactly
 * — never as a substring (§3), so "keeps a TODO list in vim" survives.
 */
export function normalizeForFloor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~>#\[\]()]/g, " ")
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word count over the normalized form. */
export function countWords(text: string): number {
  const n = normalizeForFloor(text);
  return n.length === 0 ? 0 : n.split(" ").length;
}
