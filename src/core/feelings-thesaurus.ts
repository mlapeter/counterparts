/**
 * THE FEELINGS THESAURUS — everyday feeling words that are NOT on the wheel
 * (`feelings-wheel.ts`), each with the one core it sits nearest (2026-11-13,
 * the write tools' fail-open lane, owner's ruling that day).
 *
 * WHAT IT IS FOR. A writer who names a feeling with no core, in a word the
 * wheel does not hold ("chuffed", "stressed", "gutted"), used to lose the
 * whole memory (`checkFeelings` → `core-unknown`). The write door now places
 * such a word on a core from this table first; inflections and misspellings
 * of a wheel or thesaurus word next; the embedder, only when it is confident,
 * after that; and otherwise drops that ONE feeling and says so
 * (`adapters/mcp/server-normalize.ts`). The word itself is never replaced: it
 * is kept as the writer's own (`emotion: other`, `other_word`), so this table
 * decides a CORE, never a word, and it changes no stored row's numbers (a
 * word here is not an alias: `lookupWord` and `feelingNumbers` never read it).
 *
 * DATA, NOT LOGIC. Each core's list is a plain array; the checks at load are
 * the only code: a word here may not be a wheel key or an alias (those already
 * place themselves), and a word may sit under one core only. A word whose
 * core is genuinely ambiguous ("bothered": annoyed or worried? "humbled":
 * grateful or caught out?) is left OUT on purpose: a miss is said and counted,
 * a wrong core distorts recall by feeling for as long as the memory lives.
 *
 * GROW IT FROM MISSES. Every feeling the door could not place is named in the
 * write's `dropped` list and counted on the durable `mcp.write` row, word
 * only (`adapters/mcp/server.ts#noteWrite`). Those words are the queue.
 */
import { ALIASES, CORE_EMOTIONS, FEELINGS_WHEEL } from "./feelings-wheel.js";
import type { CoreEmotion } from "./feelings-wheel.js";

const WORDS: Readonly<Record<CoreEmotion, readonly string[]>> = {
  // Pleasure in a thing, a moment, or what's coming; pride; being absorbed.
  happy: [
    "cheerful", "cheery", "pleased", "chuffed", "elated", "thrilled", "overjoyed", "jubilant", "euphoric",
    "giddy", "gleeful", "jolly", "merry", "upbeat", "buoyant", "sunny", "blissful", "bliss", "stoked",
    "pumped", "psyched", "hyped", "keen", "enthusiastic", "enthused", "motivated", "energized", "energised",
    "invigorated", "exhilarated", "exuberant", "triumphant", "victorious", "joy", "happiness", "delight",
    "glee", "elation", "excitement", "anticipation", "hope", "optimism", "pride", "lighthearted",
    "light-hearted", "silly", "goofy", "tickled", "entertained", "fun", "good", "great", "wonderful",
    "fantastic", "awesome", "lucky", "fortunate", "productive", "capable", "competent", "empowered",
    "determined", "immersed", "in the zone", "in flow", "flow", "focused", "accomplishment", "achievement",
    "successful", "chipper", "bubbly", "high-spirited", "jazzed", "eager to start", "satisfied with myself",
    "proud of myself", "pleased with myself", "uplifted", "hopefulness", "elevated", "bright", "zestful", "joyous", "heartened", "cheered", "overjoyous",
  ],
  // Feeling toward someone.
  warm: [
    "caring", "compassionate", "empathetic", "empathic", "sympathetic", "kind", "friendly", "affection",
    "love", "loved", "adoring", "devoted", "cherished", "connected", "bonded", "attached", "warmhearted",
    "warm-hearted", "protective", "supportive", "supported", "cared for", "understood", "heard",
    "appreciative", "gratitude", "thanks", "indebted", "admiring", "admiration", "respectful", "trusting",
    "welcome", "welcomed", "included", "embraced", "companionship", "camaraderie", "solidarity",
    "friendship", "fondness", "tenderness", "warmth", "closeness", "intimacy", "heartwarmed",
    "heart-warmed", "honored", "honoured", "valued", "acknowledged", "believed in", "nurturing",
    "generous", "forgiving", "loyal", "smitten", "infatuated", "romantic", "sentimental", "empathy",
    "compassion", "sympathy", "blessed", "cozy", "cosy", "affectionately", "doting", "tenderhearted",
    "softhearted", "partnership", "teamwork", "rapport", "allied", "reunited", "befriended",
  ],
  // Things settling.
  calm: [
    "tranquil", "placid", "quiet", "still", "composed", "collected", "centered", "centred", "balanced",
    "steady", "stable", "secure", "safe", "comfortable", "comfy", "easy", "easygoing", "mellow", "chill",
    "chilled", "laid-back", "laid back", "unhurried", "patient", "rested", "refreshed", "restored",
    "renewed", "soothed", "comforted", "eased", "released", "lighter", "unworried", "untroubled",
    "carefree", "resolved", "closure", "gratified", "contentment", "peace", "at peace", "serenity",
    "relief", "assured", "certain", "sure", "clear-headed", "present", "mindful", "anchored", "calmer",
    "calmness", "equanimity", "poised", "level-headed", "unbothered", "unflustered", "zen", "restful",
    "quieted", "stilled", "breathing easier", "done and dusted", "wrapped up", "sorted", "satisfaction",
  ],
  // Wanting to know, and the moment something becomes clear.
  curious: [
    "fascinated", "captivated", "wondering", "pondering", "thoughtful", "reflective", "contemplative",
    "introspective", "bewildered", "baffled", "mystified", "stumped", "questioning", "investigative",
    "exploratory", "explorative", "attentive", "alert", "observant", "aha", "enlightened", "insightful",
    "illuminated", "clarity", "self-aware", "realization", "realisation", "epiphany", "eureka",
    "dumbfounded", "flabbergasted", "awed", "awestruck", "in awe", "wonderstruck", "marveling",
    "marvelling", "impressed", "deja vu", "déjà vu", "curiosity", "interest", "intrigue", "wonderment",
    "speculative", "analytical", "puzzlement", "confusion", "perplexity", "mystery", "spellbound",
    "enthralled", "riveted", "gripped", "nosy", "nosey", "probing", "inquiring mind", "seeking",
  ],
  // Loss, distance, regret, and low energy.
  sad: [
    "unhappy", "sorrowful", "sorrow", "sadness", "down", "blue", "low", "glum", "gloomy", "melancholy",
    "melancholic", "mournful", "morose", "downcast", "downhearted", "dejected", "despondent", "crestfallen",
    "dispirited", "discouraged", "disheartened", "demoralized", "demoralised", "deflated", "defeated",
    "hopeless", "miserable", "wretched", "forlorn", "desolate", "heartsick", "heavy-hearted", "heavy",
    "tearful", "weepy", "crying", "mourning", "bereaved", "grief", "homesick", "longing", "yearning",
    "pining", "missing", "nostalgia", "regret", "apologetic", "left out", "excluded", "unwanted", "unloved",
    "neglected", "forgotten", "overlooked", "alone", "lonesome", "disconnected", "letdown", "underwhelmed",
    "flat", "meh", "numb", "hollow", "blah", "listless", "unmotivated", "uninspired", "resigned", "aching",
    "broken", "crushed", "gutted", "shattered", "tired", "exhausted", "drained", "weary", "worn out",
    "fatigued", "burned out", "burnt out", "spent", "loneliness", "disappointment", "heartache",
    "sorry for myself", "down in the dumps", "bummed out", "sombre", "somber", "grim", "dismal", "low-spirited",
  ],
  // Something is off, from caught out to afraid.
  uneasy: [
    "tense", "stressed", "stressed out", "on edge", "edgy", "jittery", "jumpy", "restless", "uncomfortable",
    "awkward", "self-conscious", "shame", "embarrassment", "mortified", "flustered", "rattled", "shaken",
    "shaky", "unnerved", "spooked", "alarmed", "panicked", "panicky", "panic", "dread", "dreading",
    "apprehensive", "fearful", "timid", "shy", "intimidated", "helpless", "out of my depth", "swamped",
    "overloaded", "pressured", "under pressure", "troubled", "disturbed", "distressed", "concerned",
    "preoccupied", "doubtful", "unsure", "torn", "conflicted", "ambivalent", "adrift", "off-balance",
    "off balance", "unsteady", "impostor", "imposter", "like a fraud", "out of place", "defensive", "guilt",
    "culpable", "contrite", "chastened", "corrected", "caught off guard", "blindsided", "reluctant",
    "distrustful", "mistrustful", "paranoid", "creeped out", "horrified", "petrified", "unprepared",
    "uneasiness", "unease", "anxiety", "worry", "nervousness", "stress", "tension", "concern", "antsy",
    "strained", "fretful", "fretting", "frazzled", "harried", "hassled", "insecurity", "self-doubt",
    "doubt", "dread-filled", "queasy", "squeamish", "wobbly", "skittish", "anxiousness", "on tenterhooks", "stressful", "unnerving", "nerve-wracking",
  ],
  // Something is wrong and shouldn't be.
  angry: [
    "irked", "peeved", "miffed", "cross", "vexed", "exasperated", "aggravated", "fed up", "sick of it",
    "indignant", "outraged", "livid", "fuming", "seething", "incensed", "irate", "wrathful", "bitter",
    "spiteful", "vindictive", "frustration", "annoyance", "irritation", "rage", "fury", "resentment",
    "grumpy", "cranky", "crabby", "grouchy", "irritable", "testy", "touchy", "prickly", "impatient",
    "offended", "insulted", "slighted", "affronted", "patronized", "patronised", "cheated", "wronged",
    "envious", "envy", "grossed out", "repulsed", "sickened", "nauseated", "appalled", "scornful",
    "disdainful", "contemptuous", "rebellious", "defiant", "hate", "dislike", "displeased", "pissed",
    "pissed off", "ticked off", "teed off", "hacked off", "riled", "riled up", "worked up", "heated",
    "hot-headed", "bristling", "annoyed as hell", "up in arms", "steamed", "huffy", "galled",
    "bugged", "needled", "provocation", "hostility", "outrage", "indignation", "disgruntled", "sour",
  ],
};

function build(): ReadonlyMap<string, CoreEmotion> {
  const wheel = new Set(FEELINGS_WHEEL.map((e) => e.key));
  const out = new Map<string, CoreEmotion>();
  for (const core of CORE_EMOTIONS) {
    for (const raw of WORDS[core]) {
      const word = raw.trim().toLowerCase();
      if (wheel.has(word)) throw new Error(`feelings thesaurus: "${word}" is on the wheel already`);
      if (Object.hasOwn(ALIASES, word)) throw new Error(`feelings thesaurus: "${word}" is a wheel alias already`);
      const had = out.get(word);
      if (had !== undefined) throw new Error(`feelings thesaurus: "${word}" is under ${had} and ${core}`);
      out.set(word, core);
    }
  }
  return out;
}

/** Every thesaurus word (lower-case) and the one core it sits nearest. */
export const FEELINGS_THESAURUS: ReadonlyMap<string, CoreEmotion> = build();

/** The core a thesaurus word sits nearest, or undefined. Case and outer spaces ignored. */
export function thesaurusCore(word: string): CoreEmotion | undefined {
  return FEELINGS_THESAURUS.get(word.trim().toLowerCase());
}
