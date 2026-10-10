/**
 * Reference resolution (CONTRACT §9.2) — which memories a session's replies
 * actually USED, decided from the assistant's own turns and nothing else.
 *
 * This is the consumer INTERFACE-GAPS §5 said had no home: `resolveUse` routes
 * a DECIDED tier to physics, and until this module nothing decided one. The
 * live consequence, measured 2026-09-14 on the owner's store: every memory
 * minted since launch sat at `uses = 0`, `reinforced_days = 0`, so nothing new
 * could ever cross into the semantic or identity bands (IMPROVEMENTS U10).
 *
 * THE RULE (owner ruling 2026-09-14): a memory is credited when the assistant
 * EXPANDED it through deliberate recall, or QUOTED it at content level. Never
 * for being named in prose, never for being surfaced, never for being rendered
 * in a wake. Reinforcement is for thinking with a memory, not for having been
 * shown it.
 *
 * REVISED 2026-10-10 (G1b): a THIRD door, "drew on" (`resolveEngagement`,
 * below). Revised by b2+f8, 2026-10-10, from Mike's 09-14 ruling, lightly
 * held. Why: deposit can't work otherwise; the ~0.8 precision bar and the
 * saturating cap keep the anti-rich-get-richer intent. Display still never
 * trains: being shown, surfaced or rendered earns nothing; a reply carrying a
 * rare phrase of what it was shown earns half a use.
 *
 * Two doors, and what each one can see:
 *
 *   **Expanded.** The assistant called the recall tool with `ids` or a
 *   `handle`. The call is an assistant turn; its `input` is the evidence. Ids
 *   are taken from the tool call's input ONLY — never parsed out of prose. The
 *   fixture: on 2026-09-14 the model wrote five `[mem_…]` ids into a reply
 *   having read none of them (IMPROVEMENTS U5). A `handle` that is not itself a
 *   memory id is counted `unresolvedHandles` and credits nothing here: this
 *   module resolves nothing fuzzily, and the tool's own answer was already
 *   exact or not-found.
 *
 *   **Quoted.** A run of `QUOTE_WINDOW_WORDS` consecutive words of a memory's
 *   body appears verbatim (normalized) in an assistant `conversation` turn.
 *   Only a memory that surfaced LOUD is a candidate: a footnoted memory showed
 *   the model nothing but an 80-byte title, so any quote of it is naming, and a
 *   memory the model expanded is credited by the expansion. Paraphrase misses.
 *   That is the contract's bar — precision over recall: a false "used" pollutes
 *   learning permanently, a miss merely leaves weak credit — and the reason
 *   bansai's IDF token overlap (`consolidate/thread-match.ts`) was NOT ported:
 *   an overlap score credits co-mention, a verbatim window credits use.
 *
 * What this module never does: read the store (bodies arrive on the input),
 * call a model, read a file, or judge agreement. A memory the assistant
 * expanded and then argued with is credited — contradiction is engagement,
 * and physics §5.5 counts distinct days, not endorsement.
 *
 * Pure and synchronous: the boundary hook runs under a latency budget, so the
 * caller passes a `deadline` and the resolver stops between candidates rather
 * than truncating silently — an overrun is REPORTED (`budgetExceeded`), and
 * what was decided before it stands.
 */

export const QUOTE_WINDOW_WORDS = 8;

/**
 * Owner ruling 2026-09-14 (R3, review of #99): a matching window must carry at
 * least this many NON-stopword tokens, or it is boilerplate, not a quote.
 * Repro that forced it: body "I think it would be a good idea to keep …" and a
 * reply "I think it would be a good idea to move on" share eight words and
 * say nothing about the memory.
 */
export const QUOTE_CONTENT_WORDS = 3;

/** Function words that carry no content. Small on purpose: the floor is a
 *  guard against boilerplate, not a linguistics project. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "so", "if", "then", "than", "as", "at", "by", "for", "from",
  "in", "into", "of", "on", "onto", "to", "up", "with", "without", "about", "over", "under",
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his", "she", "her", "it", "its",
  "they", "them", "their", "this", "that", "these", "those", "there", "here", "what", "which", "who",
  "is", "am", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "will", "would", "can", "could", "should", "may", "might", "must", "shall",
  "not", "no", "yes", "just", "very", "really", "also", "too", "only", "still", "even", "again",
  "think", "thought", "good", "idea", "keep", "make", "made", "get", "got", "go", "going", "want",
  "like", "know", "see", "say", "said", "way", "thing", "things", "some", "any", "all", "more", "most",
  "one", "two", "how", "when", "where", "why", "because", "well", "now", "let", "lets",
]);

/** A memory id as the store mints them. Anything else is not an address. */
export const MEMORY_ID = /^mem_[0-9a-f]{12,16}$/;

export type ReferenceHow = "expanded" | "quoted";

export interface ReferenceCandidate {
  readonly id: string;
  /** Only `surfaced` is quotable; `footnoted` is listed for the accounting. */
  readonly tier: "surfaced" | "footnoted";
  /** Canonical body. Never rendered anywhere by this module. */
  readonly body: string;
}

export interface ReferenceInput {
  /** Assistant `conversation` text for the slice under judgment, in order. */
  readonly assistantTurns: readonly string[];
  /** Raw `ids` / `handle` values from recall tool calls in the same slice. */
  readonly expansions: readonly string[];
  readonly candidates: readonly ReferenceCandidate[];
  /** `Date.now()`-comparable; the resolver stops between candidates past it. */
  readonly deadline?: number;
  readonly now?: () => number;
}

export interface ReferenceUse {
  readonly memoryId: string;
  readonly how: ReferenceHow;
}

export interface ReferenceResult {
  readonly uses: readonly ReferenceUse[];
  readonly expanded: number;
  readonly quoted: number;
  /** Candidates looked at before the deadline (or all of them). */
  readonly considered: number;
  /** Loud candidates never compared because the deadline hit first. */
  readonly skippedForBudget: number;
  readonly unresolvedHandles: number;
  readonly budgetExceeded: boolean;
}

/** Lowercase alphanumeric words, in order. The one normalization, used on both sides. */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0);
}

/** Content tokens in a run of words: what is left after the stopwords. */
export function contentWords(words: readonly string[]): number {
  let n = 0;
  for (const w of words) if (!STOPWORDS.has(w)) n += 1;
  return n;
}

/**
 * True when some `window`-word run of `body` appears verbatim in `text` AND
 * that run carries at least `QUOTE_CONTENT_WORDS` content tokens (R3). A run
 * of function words shared by two sentences is boilerplate, not a quote.
 * O(|text| + |body|): the text's windows go into a set once, the body's are
 * looked up.
 */
export function quotesWindow(body: string, text: string, window: number = QUOTE_WINDOW_WORDS): boolean {
  const t = normalizeWords(text);
  const b = normalizeWords(body);
  if (t.length < window || b.length < window) return false;
  const seen = new Set<string>();
  for (let i = 0; i + window <= t.length; i++) seen.add(t.slice(i, i + window).join(" "));
  for (let i = 0; i + window <= b.length; i++) {
    const run = b.slice(i, i + window);
    if (seen.has(run.join(" ")) && contentWords(run) >= QUOTE_CONTENT_WORDS) return true;
  }
  return false;
}

export function resolveReferences(input: ReferenceInput): ReferenceResult {
  const now = input.now ?? Date.now;
  const uses: ReferenceUse[] = [];
  const credited = new Set<string>();
  let unresolvedHandles = 0;

  // Door one: expansions. Exact addresses only, each memory once.
  for (const raw of input.expansions) {
    const id = raw.trim();
    if (!MEMORY_ID.test(id)) {
      unresolvedHandles += 1;
      continue;
    }
    if (credited.has(id)) continue;
    credited.add(id);
    uses.push({ memoryId: id, how: "expanded" });
  }
  const expanded = uses.length;

  // Door two: verbatim windows against what surfaced loud, one turn at a
  // time: a quote split across two assistant turns is not a quote.
  const turns = input.assistantTurns.filter((t) => t.trim().length > 0);
  let considered = 0;
  let skippedForBudget = 0;
  let budgetExceeded = false;
  for (const c of input.candidates) {
    if (input.deadline !== undefined && now() > input.deadline) {
      budgetExceeded = true;
      if (c.tier === "surfaced" && !credited.has(c.id)) skippedForBudget += 1;
      continue;
    }
    considered += 1;
    if (c.tier !== "surfaced" || credited.has(c.id)) continue;
    if (turns.some((text) => quotesWindow(c.body, text))) {
      credited.add(c.id);
      uses.push({ memoryId: c.id, how: "quoted" });
    }
  }

  return {
    uses,
    expanded,
    quoted: uses.length - expanded,
    considered,
    skippedForBudget,
    unresolvedHandles,
    budgetExceeded,
  };
}

// ── the third door: "drew on" (engagement), 2026-10-10 ──────────────────────
//
// Revised by b2+f8, 2026-10-10, from Mike's 09-14 ruling, lightly held. Why:
// deposit can't work otherwise; the ~0.8 precision bar and the saturating cap
// keep the anti-rich-get-richer intent.
//
// The 09-14 ruling above ("never for being named in prose") kept the two doors
// precise, and starved everything that learns from use: a footnote is ~98% of
// what recall shows, and in the owner's first 19 lived days the quote door
// fired 4 times (review 05, 2026-10-10). This door credits a footnoted or
// loud memory the reply visibly DREW ON, at a lower tier (`engaged`, half a
// use). It is still not "named in prose": the evidence is a RARE phrase from
// the title the model was shown, new to what the person said. Measured against
// a topically matched control (memories not shown that turn): ~0.8 precision
// for this rule, where any shared title word or any title bigram was ~0.5
// (half of it co-mention). Hand-labelled (review of #371, NOTES §29): ~0.2
// when only a visible draw counts, ~0.75 when carrying on the footnote's
// topic counts; the control is matched on the prompt, not the session. What
// it never does: credit a memory for being shown, read a body, call a model,
// or read the store (titles and word frequencies arrive on the input).

/**
 * "Rare" is a word in at most this share of the live store's memories (review
 * 05's 3%). Decided by g1b-builder, 2026-10-10, lightly held; revisit after ~5
 * lived days. Why: it is the share the precision was measured at; looser rules
 * fell to ~0.5.
 */
export const ENGAGED_RARE_SHARE = 0.03;

/**
 * …and a word in this many memories or fewer is rare whatever the share says,
 * so a young store (3% of 40 memories is not one memory) can engage at all.
 * Decided by g1b-builder, 2026-10-10, lightly held; revisit after ~5 lived
 * days. Why: the title's own memory is always one of the documents; two means
 * "this memory and one other", the tightest bar that is not "never".
 */
export const ENGAGED_RARE_MIN_DF = 2;

/**
 * At most this many ENGAGED credits land per boundary (2026-10-10, G1b,
 * review 05 C2). Decided by g1b-builder, 2026-10-10, lightly held; revisit
 * after ~5 lived days. Why: the review's cap; a reply that touches many
 * footnotes at once is more likely summarizing a topic than drawing on each.
 */
export const ENGAGED_MAX_PER_BOUNDARY = 3;

/**
 * A footnote shown this many recall turns before the stretch a boundary
 * judges can still be drawn on by its replies (the review's "same turn, or
 * the next 2"). Decided by g1b-builder, 2026-10-10, lightly held; revisit
 * after ~5 lived days. Why: the review's window; a boundary usually judges
 * one reply, so the window is that reply's turn and the two before it.
 */
export const ENGAGED_TURN_WINDOW = 2;

/** Rare title words new to the prompt needed when no phrase matched (R6's second arm). */
export const ENGAGED_MIN_RARE_WORDS = 2;

export type EngagementRule = "phrase" | "words";

export interface EngagementCandidate {
  readonly id: string;
  /** The title AS THE MODEL SAW IT, clipped to the footnote's bytes. Words the
   *  clip cut were never shown, so matching them would be co-mention. */
  readonly title: string;
  /** The recall turn it was shown on; the newer showing wins a tie at the cap. */
  readonly shownTurn: number;
}

export interface EngagementInput {
  /** What the replies SAID: assistant conversation text. */
  readonly replyTexts: readonly string[];
  /** What the replies DID: tool-call inputs, as text. Only a title phrase
   *  counts here (see `resolveEngagement`). */
  readonly toolTexts?: readonly string[];
  /** What the person typed in the same slice. A title word they said first is
   *  the conversation's word, not the memory's. */
  readonly promptTexts: readonly string[];
  readonly candidates: readonly EngagementCandidate[];
  /** Document frequency of the candidates' title words in the live index
   *  (`store/cache.ts#docFrequency`). A word missing from it is NOT rare:
   *  precision over recall. */
  readonly df: ReadonlyMap<string, number>;
  /** Live memories: the share's denominator. */
  readonly storeSize: number;
  readonly deadline?: number;
  readonly now?: () => number;
}

export interface EngagedUse {
  readonly memoryId: string;
  readonly how: "engaged";
  readonly rule: EngagementRule;
  /** Rare title words the replies carried that the prompt did not. */
  readonly rareWords: number;
  readonly shownTurn: number;
}

export interface EngagementResult {
  /** Strongest first: a phrase before two words, then more rare words, then
   *  the newer showing, then id. The caller's cap takes from the front. */
  readonly engaged: readonly EngagedUse[];
  readonly considered: number;
  readonly budgetExceeded: boolean;
}

function isNumber(w: string): boolean {
  return /^[0-9]+$/.test(w);
}

/** A content word for this door: not a stopword, and three letters or more, or a number of two digits or more. */
function engagementWord(w: string): boolean {
  if (STOPWORDS.has(w)) return false;
  return w.length >= 3 || (isNumber(w) && w.length >= 2);
}

/** The title words this door could ever call rare: what the caller asks the index's df for. */
export function engagementTitleWords(title: string): string[] {
  return [...new Set(normalizeWords(title).filter((w) => engagementWord(w) && !isNumber(w)))];
}

/** A typed memory address never counts as drawing on anything (IMPROVEMENTS U5: ids echoed unread). */
const ID_IN_TEXT = /\bmem_[0-9a-f]{12,16}\b/gi;

/**
 * A recall or wake block quoted back whole — the reply (or a brief it writes)
 * pasting what it was shown, markers and all. Its titles are the DISPLAY, not
 * the reply drawing on it: "never for being shown" would leak through an echo
 * (review of #371, 2026-10-10: five of ~200 hand-labelled hits were pasted
 * blocks). Only a span with both markers is cut; prose about a block stays.
 */
const SHOWN_BLOCK = /<!-- counterparts:(recall|wake)\b[^>]*-->[\s\S]*?<!-- counterparts:\1\/end\b[^>]*-->/g;

/** Words of some texts, with an empty word between texts: a phrase split across two texts is not a phrase. */
function wordsOf(texts: readonly string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    if (text.trim().length === 0) continue;
    out.push("", ...normalizeWords(text.replace(SHOWN_BLOCK, " ").replace(ID_IN_TEXT, " ")));
  }
  return out;
}

/**
 * Which candidates the replies DREW ON (review 05's rule R6, with one
 * narrowing), from text alone.
 *
 * A candidate is engaged when
 *   - the replies' text or their tool-call inputs carry a title PHRASE (two
 *     adjacent title words, neither a stopword, at least one a rare
 *     non-numeric word, not both in the prompt) plus at least one rare title
 *     word the prompt lacked; or
 *   - the replies' TEXT carries at least `ENGAGED_MIN_RARE_WORDS` rare
 *     non-numeric title words the prompt lacked.
 *
 * Decided by g1b-builder, 2026-10-10, lightly held; revisit after ~5 lived
 * days. Why: the two-words arm reads prose only. Over tool inputs (paths,
 * commands, JSON, a subagent's whole brief) two stray rare words are cheap,
 * and on the owner's transcripts that arm took the rule's estimated precision
 * from ~0.8 to ~0.65. A phrase in a tool call still counts: running
 * `tools/reddit.py` off a footnote about it is the case this door exists for.
 *
 * Cost is O(reply length + candidates x title words). Nothing here grows with
 * the store; the df map is the caller's one indexed lookup.
 */
export function resolveEngagement(input: EngagementInput): EngagementResult {
  const now = input.now ?? Date.now;
  const proseWords = wordsOf(input.replyTexts);
  const replyWords = [...proseWords, ...wordsOf(input.toolTexts ?? [])];
  const proseTokens = new Set(proseWords.filter(engagementWord));
  const replyTokens = new Set(replyWords.filter(engagementWord));
  const replyPairs = new Set<string>();
  for (let i = 0; i + 1 < replyWords.length; i++) {
    const a = replyWords[i] as string;
    const b = replyWords[i + 1] as string;
    if (a.length > 0 && b.length > 0) replyPairs.add(`${a} ${b}`);
  }
  const prompt = new Set(input.promptTexts.flatMap((t) => normalizeWords(t)));
  const bar = Math.max(ENGAGED_RARE_MIN_DF, ENGAGED_RARE_SHARE * Math.max(0, input.storeSize));
  const rare = (w: string): boolean => {
    if (isNumber(w)) return false;
    const df = input.df.get(w);
    return df !== undefined && df > 0 && df <= bar;
  };

  const engaged: EngagedUse[] = [];
  const seen = new Set<string>();
  let considered = 0;
  let budgetExceeded = false;
  for (const c of input.candidates) {
    if (seen.has(c.id)) continue;
    if (input.deadline !== undefined && now() > input.deadline) {
      budgetExceeded = true;
      break;
    }
    seen.add(c.id);
    considered += 1;
    if (replyTokens.size === 0) continue;
    const words = normalizeWords(c.title);
    const rareTitle = new Set(words.filter((w) => engagementWord(w) && rare(w)));
    let rareWords = 0;
    let proseRare = 0;
    for (const w of rareTitle) {
      if (prompt.has(w)) continue;
      if (replyTokens.has(w)) rareWords += 1;
      if (proseTokens.has(w)) proseRare += 1;
    }
    if (rareWords === 0) continue;
    let phrase = false;
    for (let i = 0; i + 1 < words.length && !phrase; i++) {
      const a = words[i] as string;
      const b = words[i + 1] as string;
      if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
      if (!rareTitle.has(a) && !rareTitle.has(b)) continue;
      if (prompt.has(a) && prompt.has(b)) continue;
      if (replyPairs.has(`${a} ${b}`)) phrase = true;
    }
    if (phrase || proseRare >= ENGAGED_MIN_RARE_WORDS) {
      engaged.push({ memoryId: c.id, how: "engaged", rule: phrase ? "phrase" : "words", rareWords, shownTurn: c.shownTurn });
    }
  }
  engaged.sort(
    (x, y) =>
      (x.rule === y.rule ? 0 : x.rule === "phrase" ? -1 : 1) ||
      y.rareWords - x.rareWords ||
      y.shownTurn - x.shownTurn ||
      (x.memoryId < y.memoryId ? -1 : x.memoryId > y.memoryId ? 1 : 0),
  );
  return { engaged, considered, budgetExceeded };
}
