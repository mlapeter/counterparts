/**
 * PLACING A FEELING WORD ON A CORE (2026-11-13, the write tools' fail-open
 * lane). Pure: a word in, a core and how it was found out — or null.
 *
 * A feeling written with no core takes its word's home core when the word is
 * on the wheel (`store/feelings.ts#checkFeelings`). Off the wheel, with no core,
 * it used to refuse the whole memory. This is the backend placement the owner
 * ruled for that case (2026-11-13), in order, the first that answers wins:
 *
 *   1. the wheel itself and its aliases (`lookupWord`), then the thesaurus
 *      (`feelings-thesaurus.ts`) — whole value only;
 *   2. an inflection (`stemTerm`: "worrying" meets "worried") of a wheel,
 *      alias or thesaurus participle or a core, then a misspelling with the
 *      same first letter: for 6-7 letters only a typo's shape (two letters
 *      swapped, one doubled or undoubled), one edit from 8 letters, two from
 *      10 — single words only. A real word one letter from a feeling word
 *      ("better", "wired", "closed") is not a misspelling of it;
 *   3. the embedder, only when it is confident — that step needs a live
 *      embedder, so it is the MCP adapter's (`server-normalize.ts`), not here.
 *
 * Never a guessed core. Steps 2 and 3 answer only when every best candidate
 * agrees on the core; a word that carries a negation ("not happy", "no
 * longer afraid") is never placed by anything but step 1 (it is not on the
 * wheel or in the thesaurus, so: never); and a misspelling match is refused
 * when the two words differ by a negating prefix ("uncaring" is not "caring").
 * The caller keeps the writer's own word (`other` + `other_word`): this
 * decides only the core.
 */
import { ALIASES, FEELINGS_WHEEL, isCoreEmotion, lookupWord } from "./feelings-wheel.js";
import type { CoreEmotion } from "./feelings-wheel.js";
import { FEELINGS_THESAURUS } from "./feelings-thesaurus.js";
import { stemTerm } from "./store/stem.js";

export type PlacedBy = "wheel" | "thesaurus" | "stem" | "spelling";

export interface Placement {
  readonly core: CoreEmotion;
  readonly by: PlacedBy;
  /** The wheel, alias or thesaurus word it matched. */
  readonly match: string;
}

/** Words that soften or strengthen a feeling and say nothing about which one ("very", "a bit"). */
const INTENSIFIER = /^(?:(?:very|really|so|quite|rather|pretty|super|extremely|incredibly|deeply|truly|genuinely|totally|completely|utterly|a (?:bit|little|tad)|a little bit|slightly|somewhat|mildly|kind of|kinda|sort of|sorta|more|most|a lot|feeling|felt|feel|i feel|i felt|i'm|i am|i was|am|was|being|got|getting|became|become)\s+)+/u;

/** A negation anywhere in the value: never placed past the wheel and the thesaurus. */
const NEGATION = /(?:^|\s)(?:not|no|never|none|neither|nor|without|hardly|barely|no longer|isn't|wasn't|aren't|weren't|don't|didn't|doesn't|can't|couldn't|won't|wouldn't)(?:\s|$)|n't\b/u;

/** Prefixes that turn a word into its opposite: a misspelling match across one is refused. */
const NEGATING_PREFIX = ["un", "dis", "in", "im", "ir", "il", "non", "mis", "de"] as const;

/** The value as compared: lower-case, single-spaced, without outer punctuation or leading intensifiers. */
export function feelingWordForm(word: string): string {
  const flat = word
    .trim()
    .toLowerCase()
    .replace(/[’`]/gu, "'")
    .replace(/\s+/gu, " ")
    .replace(/^[\s"'.,;:!?()[\]-]+|[\s"'.,;:!?()[\]-]+$/gu, "");
  const stripped = flat.replace(INTENSIFIER, "").trim();
  return stripped.length === 0 ? flat : stripped;
}

/** Whether the value carries a negation (so only steps 1 places it). */
export function feelingWordNegated(word: string): boolean {
  return NEGATION.test(word.trim().toLowerCase().replace(/[’`]/gu, "'"));
}

interface Known {
  readonly word: string;
  readonly core: CoreEmotion;
}

/** Every single word steps 2 compare against: the wheel's, its aliases', the thesaurus's. */
const KNOWN: readonly Known[] = (() => {
  const out: Known[] = [];
  for (const e of FEELINGS_WHEEL) out.push({ word: e.key, core: e.core });
  for (const [alias, key] of Object.entries(ALIASES)) {
    const e = FEELINGS_WHEEL.find((x) => x.key === key);
    if (e !== undefined) out.push({ word: alias, core: e.core });
  }
  for (const [word, core] of FEELINGS_THESAURUS) out.push({ word, core });
  return out.filter((k) => /^[a-z]+$/u.test(k.word));
})();

/**
 * The words an inflection may meet: the participles ("worried", "unsettled":
 * "worrying" and "unsettling" mean them) and the seven cores ("calming"). Not
 * a bare verb-shaped word ("close", "open", "present", "cross", "alert"):
 * "closed", "opened" and "crossed" are ordinary words, not those feelings.
 */
const BY_STEM: ReadonlyMap<string, readonly Known[]> = (() => {
  const out = new Map<string, Known[]>();
  for (const k of KNOWN) {
    if (!(k.word.endsWith("ed") || k.word.endsWith("ing") || isCoreEmotion(k.word))) continue;
    const s = stemTerm(k.word);
    const list = out.get(s) ?? [];
    list.push(k);
    out.set(s, list);
  }
  return out;
})();

/** One core all of these agree on, or null. */
function agreed(list: readonly Known[]): CoreEmotion | null {
  const cores = new Set(list.map((k) => k.core));
  return cores.size === 1 ? (list[0] as Known).core : null;
}

/** `a` is `b` with a negating prefix, or the other way round. */
function prefixedOpposite(a: string, b: string): boolean {
  for (const p of NEGATING_PREFIX) {
    if (a === p + b || b === p + a) return true;
  }
  return false;
}

/**
 * The edit distance a misspelling may be from the word, by the word's length
 * (0: none). Under 8 letters only a TYPO's shape counts (`typoShaped`), never a
 * free edit: "better" is one letter from "bitter", "wired" from "tired",
 * "yucky" from "lucky", and each is a real word, not a slip.
 */
export function spellingReach(length: number): number {
  return length >= 10 ? 2 : length >= 6 ? 1 : 0;
}

/**
 * The slips a short word is allowed: two neighbouring letters swapped
 * ("lonley"), or a letter doubled or undoubled ("happpy", "hapy").
 */
function typoShaped(a: string, b: string): boolean {
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    return diff.length === 2 && diff[1] === (diff[0] as number) + 1 && a[diff[0] as number] === b[diff[1] as number] && a[diff[1] as number] === b[diff[0] as number];
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  if (long.length !== short.length + 1) return false;
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) {
      return (i > 0 && long[i] === long[i - 1]) || (i + 1 < long.length && long[i] === long[i + 1]);
    }
  }
  return false;
}

/**
 * Steps 1 and 2: the core this word is placed on, how, and the word it
 * matched — or null when neither the wheel, the thesaurus, an inflection nor a
 * misspelling places it with one agreed core.
 */
export function placeFeelingWord(word: string): Placement | null {
  const form = feelingWordForm(word);
  if (form.length === 0) return null;
  const onWheel = lookupWord(form);
  if (onWheel !== undefined) return { core: onWheel.entry.core, by: "wheel", match: onWheel.entry.key };
  const listed = FEELINGS_THESAURUS.get(form);
  if (listed !== undefined) return { core: listed, by: "thesaurus", match: form };
  if (feelingWordNegated(form) || !/^[a-z]+$/u.test(form)) return null;
  const stemmed = BY_STEM.get(stemTerm(form));
  if (stemmed !== undefined && stemmed.length > 0) {
    const core = agreed(stemmed);
    if (core !== null) return { core, by: "stem", match: (stemmed[0] as Known).word };
    return null;
  }
  const reach = spellingReach(form.length);
  if (reach === 0) return null;
  let best = Number.POSITIVE_INFINITY;
  let near: Known[] = [];
  for (const k of KNOWN) {
    if (Math.abs(k.word.length - form.length) > reach) continue;
    // A slip keeps the first letter ("believed" is not a slip for "relieved").
    if (k.word[0] !== form[0]) continue;
    if (prefixedOpposite(form, k.word)) continue;
    if (form.length < 8 && !typoShaped(form, k.word)) continue;
    const d = editDistance(form, k.word, reach);
    if (d > reach) continue;
    if (d < best) {
      best = d;
      near = [k];
    } else if (d === best) near.push(k);
  }
  if (near.length === 0) return null;
  const core = agreed(near);
  return core === null ? null : { core, by: "spelling", match: (near[0] as Known).word };
}

/**
 * Edit distance with a swap of two neighbouring letters counted as one edit
 * (optimal string alignment: "lonley" is one from "lonely"), stopping early
 * once every path is past `cap` (it returns cap + 1 then).
 */
function editDistance(a: string, b: string, cap: number): number {
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (before[j - 2] as number) + 1);
      row.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    before = prev;
    prev = row;
  }
  return prev[b.length] as number;
}
