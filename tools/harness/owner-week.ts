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
 * and the owner's turns, in order. The counterpart's replies are the model's.
 */

export interface ScriptedSession {
  /** The project folder, relative to the run's work dir: the session's scope. */
  readonly scope: string;
  readonly turns: readonly string[];
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
          "hi! first time trying this memory thing. I'm Dana, I teach ceramics and I'm finally putting my pottery shop online. can you help me set up a product page layout?",
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
