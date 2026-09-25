/**
 * THE FEELINGS WHEEL — the vocabulary a recorded feeling is spelled in
 * (owner-approved 2026-09-25, transcribed from his poster).
 *
 * Six CORE emotions at the centre (happy, sad, fear, anger, surprise, disgust),
 * a MIDDLE ring of named feelings under each, and an OUTER ring of two finer
 * words under each middle one. A recorded feeling (`store` table `feelings`,
 * schema v7) names one core and one entry from this list — or `other`, with the
 * person's own word kept beside it.
 *
 * **The key scheme.** An entry's key is its word, lower-case (`furious`,
 * `hopeful`). A word the wheel prints under TWO DIFFERENT cores gets a
 * core-qualified key on BOTH sides — `<core>.<word>` — so no key silently means
 * one of two feelings: `anger.insecure` / `fear.insecure`, `sad.inferior` /
 * `fear.inferior`. A word printed twice under the SAME core is one key (sad's
 * `abandoned` is a middle-ring feeling and also under `lonely`; it is kept once,
 * on the middle ring, with `alsoUnder: "lonely"`). The six cores are entries
 * too (ring `core`), for a feeling named only at the centre. `other` is the
 * one key that is not on the wheel. `resolveEmotion` accepts a bare word where
 * it is unambiguous, and qualifies an ambiguous one by the core it was given.
 *
 * **Valence** is +1 or −1 per entry, and 0 for `surprise` itself: surprise's
 * children take their own (amazed, awe, astonished, excited, energetic, eager
 * lean positive; startled, shocked, dismayed, confused, perplexed, disillusioned
 * lean negative). Nothing reads valence yet — it is here so the emotion build
 * that comes later does not have to re-transcribe the poster.
 *
 * A leaf: no imports, so `store/` (which validates against it) and anything
 * above can read it without a layering question.
 */

export const CORE_EMOTIONS = ["happy", "sad", "fear", "anger", "surprise", "disgust"] as const;
export type CoreEmotion = (typeof CORE_EMOTIONS)[number];

export type WheelRing = "core" | "middle" | "outer";
export type Valence = 1 | 0 | -1;

export interface WheelEntry {
  /** The stored key (see the scheme above). */
  readonly key: string;
  /** The word as the wheel prints it. */
  readonly word: string;
  readonly core: CoreEmotion;
  readonly ring: WheelRing;
  /** The middle-ring key an outer word sits under; null for the core and middle rings. */
  readonly parent: string | null;
  readonly valence: Valence;
  /** A middle-ring word the wheel ALSO prints on the outer ring of the same core. */
  readonly alsoUnder?: string;
}

/** The one emotion key that is not on the wheel: the person's own word is kept beside it. */
export const OTHER_EMOTION = "other";

type Branch = readonly [middle: string, outer: readonly [string, string]];

const TREE: Record<CoreEmotion, readonly Branch[]> = {
  anger: [
    ["hurt", ["embarrassed", "devastated"]],
    ["threatened", ["insecure", "jealous"]],
    ["hateful", ["resentful", "violated"]],
    ["mad", ["furious", "enraged"]],
    ["aggressive", ["provoked", "hostile"]],
    ["frustrated", ["infuriated", "irritated"]],
    ["distant", ["withdrawn", "suspicious"]],
    ["critical", ["skeptical", "sarcastic"]],
  ],
  disgust: [
    ["disapproval", ["judgmental", "loathing"]],
    ["disappointed", ["repugnant", "revolted"]],
    ["awful", ["revulsion", "detestable"]],
    ["avoidance", ["aversion", "hesitant"]],
  ],
  sad: [
    ["guilty", ["remorseful", "ashamed"]],
    ["abandoned", ["ignored", "victimized"]],
    ["despair", ["powerless", "vulnerable"]],
    ["depressed", ["inferior", "empty"]],
    ["lonely", ["abandoned", "isolated"]],
    ["bored", ["apathetic", "indifferent"]],
  ],
  happy: [
    ["optimistic", ["inspired", "open"]],
    ["intimate", ["playful", "sensitive"]],
    ["peaceful", ["hopeful", "loving"]],
    ["powerful", ["provocative", "courageous"]],
    ["accepted", ["fulfilled", "respected"]],
    ["proud", ["confident", "important"]],
    ["interested", ["inquisitive", "amused"]],
    ["joyful", ["ecstatic", "liberated"]],
  ],
  surprise: [
    ["excited", ["energetic", "eager"]],
    ["amazed", ["awe", "astonished"]],
    ["confused", ["perplexed", "disillusioned"]],
    ["startled", ["dismayed", "shocked"]],
  ],
  fear: [
    ["scared", ["terrified", "frightened"]],
    ["anxious", ["overwhelmed", "worried"]],
    ["insecure", ["incompetent", "inferior"]],
    ["submissive", ["worthless", "insignificant"]],
    ["rejected", ["inadequate", "alienated"]],
    ["humiliated", ["disrespected", "ridiculed"]],
  ],
};

const SURPRISE_POSITIVE = new Set(["excited", "energetic", "eager", "amazed", "awe", "astonished"]);

function valenceOf(core: CoreEmotion, word: string, ring: WheelRing): Valence {
  if (core === "happy") return 1;
  if (core !== "surprise") return -1;
  if (ring === "core") return 0;
  return SURPRISE_POSITIVE.has(word) ? 1 : -1;
}

function build(): WheelEntry[] {
  // Which words sit under more than one core decides which keys are qualified.
  const coresOf = new Map<string, Set<CoreEmotion>>();
  for (const core of CORE_EMOTIONS) {
    for (const [middle, outer] of TREE[core]) {
      for (const w of [middle, ...outer]) {
        const set = coresOf.get(w) ?? new Set<CoreEmotion>();
        set.add(core);
        coresOf.set(w, set);
      }
    }
  }
  const keyOf = (core: CoreEmotion, word: string): string =>
    (coresOf.get(word)?.size ?? 0) > 1 ? `${core}.${word}` : word;
  const out: WheelEntry[] = [];
  const seen = new Set<string>();
  for (const core of CORE_EMOTIONS) {
    out.push({ key: core, word: core, core, ring: "core", parent: null, valence: valenceOf(core, core, "core") });
    seen.add(core);
    const middles = new Set(TREE[core].map(([m]) => m));
    for (const [middle] of TREE[core]) {
      const key = keyOf(core, middle);
      const alsoUnder = TREE[core].find(([m, o]) => m !== middle && o.includes(middle))?.[0];
      out.push({
        key,
        word: middle,
        core,
        ring: "middle",
        parent: null,
        valence: valenceOf(core, middle, "middle"),
        ...(alsoUnder === undefined ? {} : { alsoUnder: keyOf(core, alsoUnder) }),
      });
      seen.add(key);
    }
    for (const [middle, outer] of TREE[core]) {
      for (const word of outer) {
        const key = keyOf(core, word);
        if (seen.has(key) || middles.has(word)) continue; // sad's `abandoned`: one key
        out.push({ key, word, core, ring: "outer", parent: keyOf(core, middle), valence: valenceOf(core, word, "outer") });
        seen.add(key);
      }
    }
  }
  return out;
}

/** Every entry on the wheel, cores first within each core's block. */
export const FEELINGS_WHEEL: readonly WheelEntry[] = build();

const BY_KEY = new Map(FEELINGS_WHEEL.map((e) => [e.key, e]));

export function isCoreEmotion(value: unknown): value is CoreEmotion {
  return typeof value === "string" && (CORE_EMOTIONS as readonly string[]).includes(value);
}

export function wheelEntry(key: string): WheelEntry | undefined {
  return BY_KEY.get(key);
}

/** How an emotion as given reads against the wheel, under the core it was given with. */
export type EmotionResolution =
  | { readonly kind: "wheel"; readonly entry: WheelEntry }
  | { readonly kind: "wrong-core"; readonly entry: WheelEntry }
  | { readonly kind: "other"; readonly word: string; readonly closest: readonly string[] };

/**
 * Read `emotion` (a key or a bare word, any case) under `core`. A bare word the
 * wheel prints under two cores is qualified by `core`; a word that is on the
 * wheel under a DIFFERENT core only is `wrong-core`; anything else is `other`,
 * with the closest keys under `core` for the caller to rewrite with.
 */
export function resolveEmotion(core: CoreEmotion, emotion: string): EmotionResolution {
  const raw = emotion.trim().toLowerCase();
  const direct = BY_KEY.get(raw) ?? BY_KEY.get(`${core}.${raw}`);
  if (direct !== undefined) return direct.core === core ? { kind: "wheel", entry: direct } : { kind: "wrong-core", entry: direct };
  const elsewhere = FEELINGS_WHEEL.find((e) => e.word === raw);
  if (elsewhere !== undefined) return { kind: "wrong-core", entry: elsewhere };
  return { kind: "other", word: emotion.trim(), closest: closestKeys(core, raw) };
}

/** Up to `n` keys under `core`, nearest first by edit distance to `word`. */
export function closestKeys(core: CoreEmotion, word: string, n = 5): string[] {
  return FEELINGS_WHEEL.filter((e) => e.core === core && e.ring !== "core")
    .map((e) => ({ key: e.key, d: editDistance(word, e.word) }))
    .sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1))
    .slice(0, n)
    .map((x) => x.key);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number;
      prev[j] = Math.min(up + 1, (prev[j - 1] as number) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] as number;
}
