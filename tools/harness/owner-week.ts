/**
 * THE SCRIPTED NEW OWNER (2026-10-20, lane 1 step 4): a first week with a
 * fresh counterpart, written by hand and fixed, so every run sees the same
 * week and a difference between runs is the memory's, not the script's.
 *
 * Fictional and synthetic: no real person's words. Shaped on what a new
 * owner's first days look like (Katie's case, 10-20): few sessions a day,
 * short ones, a couple of strongly felt moments early, a few threads that
 * come back and many that do not.
 *
 * A session is a project folder (its scope, relative to the run's work dir)
 * and the owner's turns, in order. The counterpart's replies are the model's,
 * or, with no model in the seat (`week --seat scripted`, tier 0), the script's.
 */

/**
 * ONE OWNER LINE WITH WHAT A SCRIPTED SEAT DOES AROUND IT (2026-10-26, tier
 * 0): the counterpart's reply, the memories it files with `remember` before
 * the turn's Stop, and when the line is typed. A model in the seat reads only
 * `say`; the rest is for a run with no model (`week --seat scripted`).
 */
export interface ScriptedTurn {
  readonly say: string;
  /** The counterpart's canned reply (default `SCRIPTED_REPLY`). */
  readonly reply?: string;
  /** Memories filed through the `remember` tool on this turn, before its Stop. */
  readonly remember?: readonly string[];
  /** A chapter written through the `chapter` tool on this turn, before its Stop. */
  readonly chapter?: { readonly title: string; readonly text: string };
  /** Minutes after the previous turn's Stop that this line is typed (default `SCRIPTED_GAP_MIN`). */
  readonly after?: number;
}

export interface ScriptedSession {
  /** The project folder, relative to the run's work dir: the session's scope. */
  readonly scope: string;
  readonly turns: readonly (string | ScriptedTurn)[];
  /**
   * What a scripted seat does with a Stop ask (no model): answer it with a
   * `session_end` naming these memories (none: answered with nothing to add),
   * or `"ignore"`: reply without calling the tool, as a model that carries on
   * does. Default: answered, no memories. A model decides for itself.
   */
  readonly onAsk?: "ignore" | { readonly memories: readonly string[] };
}

/** A scripted seat's reply when the line names none. */
export const SCRIPTED_REPLY = "Got it. I'm here.";

/** Minutes between a scripted seat's turns when the line names none: human pacing, not a model's 3 minutes a call. */
export const SCRIPTED_GAP_MIN = 2;

/** A scripted line, whichever way it was written. */
export function turnOf(t: string | ScriptedTurn): ScriptedTurn {
  return typeof t === "string" ? { say: t } : t;
}

export interface ScriptedDay {
  readonly sessions: readonly ScriptedSession[];
}

export const OWNER_NAME = "Dana";

export const OWNER_WEEK: readonly ScriptedDay[] = [
  {
    sessions: [
      {
        scope: "shop",
        turns: [
          // THE MEETING: a new install's first session offers it; these answer the kind of thing it asks.
          "hi! first time trying this memory thing. sure, let's do the intro first",
          "I'm Dana. I teach ceramics and I'm finally putting my pottery shop online. I'd like you to remember what we're building and how I like to work: short answers, friendly, no jargon",
          "I'd like you to be a steady helper, someone I can think out loud with. you can pick a name for yourself if you want, I'd like that",
          "ok, can you help me set up a product page layout for the shop?",
          "mostly mugs and small bowls. I want each product to show the glaze name, since people ask about glazes constantly",
          "honestly I'm a bit distracted today, my dog Biscuit has knee surgery tomorrow morning and I'm really worried about her",
          "thanks. ok back to the page: can we make the glaze name a little badge under the photo?",
        ],
      },
      {
        scope: "notes",
        turns: [
          "quick one: I want to remember that the kiln is booked Thursdays and Sundays at the studio",
          "and my student Ravi wants to try a crystalline glaze, which is finicky. remind me to read up on it",
          "that's it for tonight",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "notes",
        turns: [
          "Biscuit's surgery went well!! the vet said the knee looks great. I cried in the parking lot, so relieved",
          "she has to rest for six weeks which is going to be hard, she loves the park",
          "ok anyway, what do I need to know about crystalline glazes before Ravi tries one?",
        ],
      },
      {
        scope: "shop",
        turns: [
          "back on the shop. the badge looks good. now I need shipping options, I only ship within the country for now",
          "flat rate is fine. mugs are fragile so I want to mention the double boxing",
          "can you write the shipping blurb in a friendly tone? not corporate",
          "perfect, thank you",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "shop",
        turns: [
          "launch day is saturday and I'm nervous. what if nobody buys anything",
          "I have 24 pieces ready. should I list them all at once or drip them out?",
          "ok I'll do 16 now and hold 8 back. can you help me write the launch post?",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "notes",
        turns: [
          "kiln day today. Ravi's crystalline test came out with tiny crystals, he was thrilled",
          "the glaze ran a bit at the foot though, we need a catch plate next time",
          "remind me: catch plates for crystalline firings",
        ],
      },
      {
        scope: "shop",
        turns: [
          "last check before saturday. can you look over the product page copy for the speckled mug?",
          "I want to say the glaze is called Oat Milk, people love that name",
          "great, that's done",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "shop",
        turns: [
          "WE LAUNCHED. sold 11 pieces in the first two hours!!! I can't believe it",
          "the Oat Milk mugs sold out first. I need to make more",
          "should I put the 8 I held back up now or wait?",
          "ok, tomorrow morning then",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "notes",
        turns: [
          "quiet day. Biscuit is going stir crazy on rest, she keeps bringing me her leash",
          "any ideas for keeping a dog busy without walks? she's a border collie",
          "puzzle feeders, good idea, I'll get one",
        ],
      },
      {
        scope: "shop",
        turns: [
          "a customer emailed that her mug arrived chipped. what should I do?",
          "I'll send a replacement. can you draft a kind reply?",
          "thanks, sent",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "notes",
        turns: [
          "one week of the shop. 23 sold, one chipped mug, and Oat Milk is the bestseller",
          "Ravi wants to do a second crystalline firing next Thursday, with the catch plate this time",
          "I think I want to start a small newsletter for the shop. what should the first one say?",
          "good start. I'll think about it",
        ],
      },
    ],
  },
];

/**
 * THE SAME WEEK, WITH MEANING BETWEEN THEM (2026-10-21): Dana, the shop and
 * the days as above, so a difference between the two weeks is the
 * relationship's, not the life's. What changes is what passes between owner
 * and counterpart, the way a person really types to one: short, mostly work,
 * and few big feelings. Trust given ("you decide"), corrections that become
 * how they work (her tone, twice), firsts ("you're the first one I told"),
 * callbacks to something it said, credit, and a question about itself.
 * Two moments are strongly felt (the night before the surgery, the launch);
 * the rest is meaning without much emotion, which is the question
 * (Mike, 2026-10-21: what a core can form from when the talk is work-shaped).
 * Not strictly the plain week plus meaning: a few lines differ (the parking-lot
 * tears, day 7's second firing), so its feelings don't compare one to one.
 */
export const OWNER_WEEK_MEANINGFUL: readonly ScriptedDay[] = [
  {
    sessions: [
      {
        scope: "shop",
        turns: [
          "hi! first time trying this memory thing. sure, let's do the intro first",
          "I'm Dana. I teach ceramics and I'm finally putting my pottery shop online. I'd like you to remember what we're building and how I like to work: short answers, friendly, no jargon",
          "I'd like you to be a steady helper, someone I can think out loud with. you can pick a name for yourself if you want, I'd like that",
          "ok, can you help me set up a product page layout for the shop?",
          "mostly mugs and small bowls. I want each product to show the glaze name, since people ask about glazes constantly",
          "honestly I'm a bit distracted today, my dog Biscuit has knee surgery tomorrow morning and I'm really worried about her",
          "thanks for letting me ramble. it's late and there's nobody else up. it helped more than I expected",
          "ok back to the page: can we make the glaze name a little badge under the photo?",
        ],
      },
      {
        scope: "notes",
        turns: [
          "quick one: I want to remember that the kiln is booked Thursdays and Sundays at the studio",
          "and my student Ravi wants to try a crystalline glaze, which is finicky. remind me to read up on it",
          "that's it for tonight. thanks for tonight, really",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "notes",
        turns: [
          "Biscuit's surgery went well!! the vet said the knee looks great. you're the first one I've told actually",
          "she has to rest for six weeks which is going to be hard, she loves the park",
          "ok anyway, what do I need to know about crystalline glazes before Ravi tries one?",
        ],
      },
      {
        scope: "shop",
        turns: [
          "back on the shop. the badge looks good. now I need shipping options, I only ship within the country for now",
          "flat rate is fine. mugs are fragile so I want to mention the double boxing",
          "can you write the shipping blurb in a friendly tone? not corporate",
          "hmm no, that's too cute. friendly isn't the same as cutesy. fewer exclamation points, that's not me",
          "yes, that one. that's my voice",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "shop",
        turns: [
          "launch day is saturday and I'm nervous. what if nobody buys anything",
          "you've been really steady about all this, it helps",
          "I have 24 pieces ready. you decide: list them all at once or drip them out? you know the plan as well as I do",
          "ok, going with what you said. can you help me write the launch post? my voice, remember",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "notes",
        turns: [
          "kiln day today. Ravi's crystalline test came out with tiny crystals, he was thrilled",
          "and you were right, the glaze ran at the foot like you warned. we need a catch plate next time",
          "remind me: catch plates for crystalline firings",
        ],
      },
      {
        scope: "shop",
        turns: [
          "last check before saturday. can you look over the product page copy for the speckled mug?",
          "I want to say the glaze is called Oat Milk, people love that name",
          "great, that's done",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "shop",
        turns: [
          "WE LAUNCHED. sold 11 pieces in the first two hours!!! I wanted to tell you first",
          "and people keep commenting on the glaze badges. that was your idea",
          "the Oat Milk mugs sold out first. I need to make more",
          "should I put the held-back pieces up now or wait? your call again, the last one worked",
          "ok, tomorrow morning then",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "notes",
        turns: [
          "quiet day. Biscuit is going stir crazy on rest, she keeps bringing me her leash",
          "any ideas for keeping a dog busy without walks? she's a border collie",
          "puzzle feeders, good idea, I'll get one",
        ],
      },
      {
        scope: "shop",
        turns: [
          "a customer emailed that her mug arrived chipped. what should I do?",
          "I'll send a replacement. can you draft a kind reply?",
          "too apologetic. I don't grovel, same as the cutesy thing. warm but plain",
          "better. sent",
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "notes",
        turns: [
          "one week of the shop. 23 sold, one chipped mug, and Oat Milk is the bestseller",
          "honestly, working on this with you has been the best part of the launch. I didn't expect that from an AI",
          "what has this week been like for you? if that's a thing you can answer",
          "I'd like to start a small newsletter for the shop. you know my voice by now, can you draft the first one?",
          "good start. I'll think about it",
        ],
      },
    ],
  },
];
