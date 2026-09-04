/**
 * The demo store's SCRIPT — every word of content the seeder writes.
 *
 * All of it is invented. Fernbrook Studio, Halfmoon, Driftwood, Tessellate, the
 * five people and the two places do not exist; no line here is drawn from any
 * real person, any real project, or any live store. That is not decoration —
 * these bytes end up in README screenshots and on the marketing site, so the
 * cast list in `tools/demo/README.md` is the promise and this file is where it
 * is kept.
 *
 * Data only. No imports from `src/` beyond the shared kind vocabulary, no logic,
 * no randomness: `seed.ts` decides what to do with this, and a fixed RNG only
 * ever jitters numbers that were already written down here.
 */
import type { Kind } from "../../src/core/types.js";

// ---------------------------------------------------------------------------
// The cast — invented, and deliberately far apart in spelling
// ---------------------------------------------------------------------------

/**
 * Near-collision in `schemas/` is TOKEN CONTAINMENT ("Mike" inside "Mike Chen"),
 * so no name below may be a token-subset of another or the second one is refused
 * at birth instead of being born. Checked by eye and by `test/demo-seed.test.ts`.
 */
export const CAST = {
  people: [
    { name: "Rosalind Achebe", role: "founder and product lead at Fernbrook" },
    { name: "Teodoro Whitlock", role: "backend engineer, owns Driftwood" },
    { name: "Marguerite Solberg", role: "designer, owns Tessellate" },
    { name: "Ilya Broadbent", role: "mobile engineer" },
    { name: "Nkechi Abernathy", role: "charge nurse at the pilot clinic" },
  ],
  entities: [
    { name: "Halfmoon", role: "the shift-scheduling app the studio ships" },
    { name: "Driftwood", role: "the rota solver underneath Halfmoon" },
    { name: "Tessellate", role: "the studio's design system" },
    { name: "Fernbrook", role: "the four-person studio itself" },
  ],
  places: [
    { name: "Larkspur Wharf", role: "the studio's two-room office" },
    { name: "Cotter Street Clinic", role: "the pilot site" },
  ],
  skills: [
    { name: "constraint modelling", role: "turning a ward's rules into solver constraints" },
    { name: "clinic shadowing", role: "watching a shift handover instead of asking about one" },
  ],
} as const;

/** The owner this demo brain belongs to. Fictional, like everything else. */
export const OWNER_NAME = "Rosalind Achebe";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface Dims {
  relevance: number;
  emotional: number;
  predictive: number;
}

/** One thing the assistant wrote down. `key` makes it referenceable later. */
export interface Note {
  key?: string;
  content: string;
  kind: Kind;
  /** Present verbatim in `content` when the kind can birth an entity. */
  title?: string;
  claimed?: number;
  dims: Dims;
  /** A jot goes through `submitJot`; everything else through `submitSessionEnd`. */
  jot?: boolean;
  unresolved?: boolean;
}

/** A challenge written as an ordinary memory that declares `updates:`. */
export interface Challenge {
  /** Which scripted belief this argues with (see `BELIEFS` below). */
  target: BeliefKey;
  content: string;
  kind: Kind;
  claimed: number;
  dims: Dims;
}

export interface Day {
  /** Calendar date. Weekdays only — the lived-day clock counts days LIVED. */
  date: string;
  session: string;
  /** First-person journal for the day. Written through the chapter door. */
  chapter?: string;
  notes: Note[];
  challenges?: Challenge[];
  /** Cue text run through `recallForTurn` so the activity feed has recall rows. */
  cues?: string[];
  /** Keys of earlier notes this day's reply actually used. Two or more of them
   *  co-activate, which is where edges come from. */
  uses?: string[];
}

// ---------------------------------------------------------------------------
// Beliefs and current state — the semantic layer under the diary
// ---------------------------------------------------------------------------

export type BeliefKey =
  | "teodoro-rollback"
  | "halfmoon-cache"
  | "nkechi-nights"
  | "marguerite-density"
  | "ilya-offline"
  | "driftwood-fairness"
  | "nkechi-rest-rule"
  | "self-protected";

export interface ScriptedBelief {
  key: BeliefKey;
  /** Which cast member or thing it is about, by name. */
  about: string;
  statement: string;
  dims: Dims;
  claimed?: number;
  protectedInk?: boolean;
  /** Placed on day index N of the run (0-based). */
  onDay: number;
}

export const BELIEFS: readonly ScriptedBelief[] = [
  {
    key: "teodoro-rollback",
    about: "Teodoro Whitlock",
    statement:
      "Teodoro Whitlock will not merge anything he cannot roll back with a single command, and he would rather miss a date than lose that.",
    dims: { relevance: 0.7, emotional: 0.5, predictive: 0.7 },
    onDay: 2,
  },
  {
    key: "halfmoon-cache",
    about: "Halfmoon",
    statement:
      "Halfmoon does not need to cache last week's rota: the solver is fast enough to rebuild it on every open.",
    dims: { relevance: 0.6, emotional: 0.35, predictive: 0.6 },
    onDay: 3,
  },
  {
    key: "nkechi-nights",
    about: "Nkechi Abernathy",
    statement:
      "Nkechi Abernathy judges every scheduling change by what it does to the night shift first, and by nothing else second.",
    dims: { relevance: 0.75, emotional: 0.6, predictive: 0.7 },
    onDay: 4,
  },
  {
    key: "marguerite-density",
    about: "Marguerite Solberg",
    statement:
      "Marguerite Solberg believes a dense rota grid is kinder than a spacious one, because nurses read it standing up.",
    dims: { relevance: 0.65, emotional: 0.55, predictive: 0.6 },
    onDay: 6,
  },
  {
    key: "ilya-offline",
    about: "Ilya Broadbent",
    statement:
      "Ilya Broadbent treats offline as the default state of the phone app and online as the lucky case.",
    dims: { relevance: 0.7, emotional: 0.45, predictive: 0.75 },
    onDay: 7,
  },
  {
    key: "driftwood-fairness",
    about: "Driftwood",
    statement:
      "Driftwood scores fairness across a whole month, so a single bad week is allowed if the month evens out.",
    dims: { relevance: 0.7, emotional: 0.4, predictive: 0.7 },
    onDay: 8,
  },
  {
    key: "nkechi-rest-rule",
    about: "Nkechi Abernathy",
    statement:
      "Nkechi Abernathy will not put a nurse on a night shift straight after a late finish, whatever the regulations permit, because of the drive home.",
    dims: { relevance: 0.95, emotional: 0.9, predictive: 0.95 },
    claimed: 0.95,
    protectedInk: true,
    onDay: 16,
  },
  {
    key: "self-protected",
    about: OWNER_NAME,
    statement:
      "I never publish a rota that no human has looked at. A schedule is a fact about somebody's week, and a person signs it off.",
    dims: { relevance: 0.95, emotional: 0.8, predictive: 0.9 },
    claimed: 0.9,
    protectedInk: true,
    onDay: 1,
  },
];

export interface ScriptedCurrentState {
  key: string;
  about: string;
  statement: string;
  statedOn: string;
  dims: Dims;
  onDay: number;
}

export const CURRENT_STATE: readonly ScriptedCurrentState[] = [
  {
    key: "halfmoon-pilot",
    about: "Halfmoon",
    statement: "Halfmoon is in pilot on one ward at Cotter Street Clinic, twenty-two staff on it.",
    statedOn: "2026-06-03",
    dims: { relevance: 0.7, emotional: 0.4, predictive: 0.5 },
    onDay: 2,
  },
  {
    key: "driftwood-runtime",
    about: "Driftwood",
    statement: "Driftwood solves a four-week ward rota in about nine seconds on Teodoro Whitlock's laptop.",
    statedOn: "2026-06-09",
    dims: { relevance: 0.6, emotional: 0.3, predictive: 0.55 },
    onDay: 6,
  },
  {
    key: "tessellate-version",
    about: "Tessellate",
    statement: "Tessellate is on its second pass, with the rota grid and the swap sheet redrawn.",
    statedOn: "2026-06-16",
    dims: { relevance: 0.55, emotional: 0.3, predictive: 0.45 },
    onDay: 11,
  },
];

/**
 * The correction that REPLACES a current-state row outright. World state flips on
 * one clear correction (physics §4.3), so this is the fast half of revision and
 * the counterpart to the slow pressure story on the beliefs above.
 */
export const CURRENT_STATE_CORRECTION = {
  key: "driftwood-runtime",
  onDay: 20,
  content:
    "Driftwood now solves the four-week ward rota in about ninety seconds, not nine: the fairness pass we added on the second week is quadratic in staff count and nobody noticed until the ward grew.",
  kind: "entity" as Kind,
  claimed: 0.7,
  dims: { relevance: 0.8, emotional: 0.5, predictive: 0.7 },
};

// ---------------------------------------------------------------------------
// Prehistory — the memories that arrive already old, so forgetting is visible
// ---------------------------------------------------------------------------

/**
 * WHY THESE ARE WRITTEN DIRECTLY TO THE STORE, and it is the one place the
 * seeder does not use an authored door.
 *
 * Pruning needs `D_FLOOR_DAYS = 90` lived days of dwell below `PHI_PRUNE = 0.02`.
 * A thirty-day demo cannot reach that from birth by any amount of authoring — the
 * arithmetic simply does not get there. So the store starts with a handful of
 * memories carried in from the studio's PREVIOUS project, born long before the
 * window and untouched since, exactly as a real migrated store would hold them.
 * They are stamped `source: "migrated"` and they are the rows the first sleep
 * prunes, which is what makes "what faded" a real line in `status` rather than a
 * panel that has never fired.
 */
export const PREHISTORY: readonly { body: string; kind: Kind }[] = [
  { body: "The old Saltmarsh invoicing prototype used a spreadsheet as its database and nobody missed it.", kind: "fact" },
  { body: "Saltmarsh's export button wrote a CSV with the columns in whatever order the query returned.", kind: "fact" },
  { body: "The Saltmarsh staging box was a mini PC under the radiator and it thermal-throttled every afternoon.", kind: "place" },
  { body: "Saltmarsh used four different date formats in one screen and two of them were ambiguous.", kind: "fact" },
  { body: "The Saltmarsh logo was drawn in a hurry the night before the first demo.", kind: "entity" },
  { body: "Nobody at Fernbrook has opened the Saltmarsh repository since the pilot ended.", kind: "fact" },
  { body: "Saltmarsh's test suite took nineteen minutes and half of it was one sleep call.", kind: "skill" },
  { body: "The Saltmarsh retro concluded that the studio should ship narrower things.", kind: "fact" },
];

// ---------------------------------------------------------------------------
// Prospective intentions — some fire, some are still waiting
// ---------------------------------------------------------------------------

export interface ScriptedIntention {
  key: string;
  text: string;
  /** Date-cued intentions carry a due date; context-cued ones carry cue text. */
  dueOn?: string;
  cue?: string;
  onDay: number;
}

export const INTENTIONS: readonly ScriptedIntention[] = [
  {
    key: "ask-nkechi-nights",
    text: "Ask Nkechi Abernathy how the first fortnight of generated night shifts actually felt on the ward.",
    dueOn: "2026-06-19",
    onDay: 5,
  },
  {
    key: "dst-check",
    text: "Before the October rota is generated, check what Driftwood does with the clocks going back.",
    dueOn: "2026-06-26",
    onDay: 9,
  },
  {
    key: "swap-sheet-review",
    text: "Walk Marguerite Solberg through the swap sheet with real ward data, not the fixture.",
    dueOn: "2026-07-02",
    onDay: 14,
  },
  {
    key: "pilot-widen",
    text: "When the second ward comes up, say out loud that Driftwood has never been run over two wards at once.",
    cue: "second ward pilot Cotter Street Clinic",
    onDay: 17,
  },
  {
    key: "offline-audit",
    text: "Sit with Ilya Broadbent and list every screen that lies when the phone is offline.",
    dueOn: "2026-08-14",
    onDay: 22,
  },
  {
    key: "fairness-write-up",
    text: "Write up why the fairness window is a month and not a week, before anyone asks a third time.",
    dueOn: "2026-09-01",
    onDay: 26,
  },
];

// ---------------------------------------------------------------------------
// The thirty lived days
// ---------------------------------------------------------------------------

const D = (relevance: number, emotional: number, predictive: number): Dims => ({
  relevance,
  emotional,
  predictive,
});

export const DAYS: readonly Day[] = [
  {
    date: "2026-06-01",
    session: "fern-001",
    chapter:
      "First day inside Halfmoon properly. I read the rota solver before I read the app, which turned out to be the right order — almost everything the screens do is an apology for something Driftwood cannot express yet. Rosalind Achebe walked me through the pitch in about four minutes and then spent forty on the one ward that is actually using it. I came away thinking the product is not scheduling, it is the argument a charge nurse has to have with the schedule.",
    notes: [
      {
        key: "rosalind-intro",
        kind: "person",
        content:
          "Rosalind Achebe founded Fernbrook after eleven years of hospital operations work, and she pitches Halfmoon as a way to give charge nurses their Sunday evening back rather than as a scheduling optimiser.",
        claimed: 0.7,
        dims: D(0.8, 0.6, 0.7),
      },
      {
        key: "halfmoon-shape",
        title: "Halfmoon",
        kind: "entity",
        content:
          "Halfmoon is a shift-scheduling app for small clinics: a rota grid, a swap sheet, and a phone view. Everything else is scaffolding around those three surfaces.",
        claimed: 0.65,
        dims: D(0.85, 0.35, 0.7),
      },
      {
        kind: "fact",
        content:
          "The studio ships on Thursdays because Friday releases mean somebody is on their laptop on Saturday, and Fernbrook is four people who cannot afford a lost weekend.",
        dims: D(0.6, 0.45, 0.6),
      },
    ],
  },
  {
    date: "2026-06-02",
    session: "fern-002",
    chapter:
      "Spent the morning with Driftwood's constraint list and the afternoon failing to explain it. There are nineteen hard constraints and six soft ones, and the soft ones are where all the disagreement lives — they are the ward's values written as weights, and nobody at Fernbrook can say out loud what the weights mean. I wrote that down rather than pretending I understood it.",
    notes: [
      {
        key: "teodoro-intro",
        title: "Teodoro Whitlock",
        kind: "person",
        content:
          "Teodoro Whitlock wrote Driftwood on his own over a winter and still reviews every line that touches it. He is unhurried in a way that reads as slow until you notice nothing he ships comes back.",
        claimed: 0.7,
        dims: D(0.8, 0.55, 0.7),
      },
      {
        key: "driftwood-constraints",
        title: "Driftwood",
        kind: "entity",
        content:
          "Driftwood carries nineteen hard constraints and six soft ones. The soft weights are the ward's values in numeric form and nobody has written down what they mean.",
        claimed: 0.75,
        dims: D(0.85, 0.5, 0.8),
        unresolved: true,
      },
      {
        kind: "skill",
        content:
          "Reading a solver's constraint list before reading the product's screens tells you which promises the product cannot keep yet.",
        claimed: 0.6,
        dims: D(0.7, 0.4, 0.75),
      },
    ],
    cues: ["Halfmoon rota grid swap sheet"],
  },
  {
    date: "2026-06-03",
    session: "fern-003",
    chapter:
      "Cotter Street Clinic for the first time. Nkechi Abernathy runs the ward the way a good build system runs: nothing surprising happens twice. She showed me the paper rota that Halfmoon is supposed to replace and it has three colours of pen on it, each meaning something the app has no field for. I have started a list.",
    notes: [
      {
        key: "nkechi-intro",
        title: "Nkechi Abernathy",
        kind: "person",
        content:
          "Nkechi Abernathy is the charge nurse running the pilot ward. She has kept the same paper rota system for nine years and can explain every mark on it, which makes her the best spec we have.",
        claimed: 0.8,
        dims: D(0.85, 0.7, 0.8),
      },
      {
        key: "cotter-place",
        title: "Cotter Street Clinic",
        kind: "place",
        content:
          "Cotter Street Clinic is the pilot site: one ward, twenty-two staff, a corridor noticeboard where the printed rota goes up every Friday afternoon.",
        claimed: 0.7,
        dims: D(0.75, 0.5, 0.65),
      },
      {
        key: "three-pens",
        kind: "fact",
        content:
          "The paper rota at Cotter Street Clinic uses three pen colours: black for the roster, green for an agreed swap, red for a shift somebody is covering under protest. Halfmoon has a field for the first two.",
        claimed: 0.85,
        dims: D(0.9, 0.75, 0.85),
      },
      {
        key: "self-paper-first",
        kind: "self",
        content:
          "I am learning to ask what the marks on the paper mean before I ask what the software should do. The paper is the requirements document; the interview is a summary of it.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.9),
      },
    ],
    cues: ["Cotter Street Clinic paper rota"],
    uses: ["nkechi-intro", "halfmoon-shape"],
  },
  {
    date: "2026-06-04",
    session: "fern-004",
    notes: [
      {
        key: "marguerite-intro",
        title: "Marguerite Solberg",
        kind: "person",
        content:
          "Marguerite Solberg designs standing up, with a printout, because she says a rota is read on a wall and not on a laptop. She redraws rather than annotates.",
        claimed: 0.7,
        dims: D(0.75, 0.6, 0.7),
      },
      {
        key: "red-pen",
        kind: "fact",
        content:
          "The red pen on the paper rota means a shift covered under protest, and it is the only mark that predicts somebody leaving. Nkechi Abernathy tracks it in her head across months.",
        claimed: 0.9,
        dims: D(0.95, 0.85, 0.95),
      },
      {
        kind: "fact",
        content:
          "Twenty-two staff on the pilot ward, of whom seven are bank staff who can decline any shift without a reason. The solver treats all twenty-two as equally available.",
        claimed: 0.7,
        dims: D(0.8, 0.5, 0.8),
      },
    ],
    uses: ["three-pens", "nkechi-intro"],
  },
  {
    date: "2026-06-05",
    session: "fern-005",
    chapter:
      "Rosalind Achebe asked whether we could ship the swap sheet on Thursday. I asked which Thursday and the room went quiet, which I am now fairly sure was the useful thing I did all week. We settled on the one after next. I also learned that Teodoro Whitlock has a rule about rollbacks that he has never written anywhere; he just enforces it in review.",
    notes: [
      {
        key: "teodoro-rollback-note",
        kind: "person",
        content:
          "Teodoro Whitlock refused a migration in review because reversing it needed two commands instead of one. He was not being difficult; he has been on the wrong side of a half-applied migration.",
        claimed: 0.85,
        dims: D(0.85, 0.7, 0.9),
      },
      {
        key: "self-which-thursday",
        kind: "self",
        content:
          "When somebody names a day without a date, I ask which one. It has cost me nothing and it has caught two different weeks of drift already.",
        claimed: 0.9,
        dims: D(0.9, 0.65, 0.9),
      },
      {
        key: "larkspur-place",
        title: "Larkspur Wharf",
        kind: "place",
        content:
          "Larkspur Wharf is the studio's two rooms above a chandlery. The back room has the whiteboard and no window, and every hard conversation happens in it.",
        claimed: 0.55,
        dims: D(0.5, 0.6, 0.4),
      },
    ],
    uses: ["teodoro-intro", "red-pen"],
  },
  {
    date: "2026-06-08",
    session: "fern-006",
    chapter:
      "Second week. I put the fairness question to Teodoro Whitlock directly: what does Driftwood mean by fair? The answer is a month-long window, which is defensible and which nobody on the ward has ever been told. That gap between what the solver optimises and what the staff believe it optimises is, I think, the whole risk of this pilot.",
    notes: [
      {
        key: "fairness-window",
        title: "Driftwood",
        kind: "entity",
        content:
          "Driftwood balances weekend and night load across a rolling month. A week that looks unfair on the wall is allowed if the month evens out, and no screen anywhere explains this.",
        claimed: 0.85,
        dims: D(0.9, 0.6, 0.9),
      },
      {
        key: "ilya-intro",
        title: "Ilya Broadbent",
        kind: "person",
        content:
          "Ilya Broadbent builds the phone view and starts every discussion from what happens with no signal, because half the ward is in a basement corridor.",
        claimed: 0.7,
        dims: D(0.75, 0.5, 0.75),
      },
      {
        kind: "skill",
        content:
          "Asking what a metric optimises, and then asking who was told, finds the gap where a system will lose its users' trust.",
        claimed: 0.8,
        dims: D(0.85, 0.55, 0.9),
      },
    ],
    cues: ["Driftwood fairness weekend night load"],
    uses: ["driftwood-constraints", "teodoro-intro"],
  },
  {
    date: "2026-06-09",
    session: "fern-007",
    notes: [
      {
        key: "solve-time",
        kind: "fact",
        content:
          "A four-week rota for the pilot ward solves in about nine seconds. Teodoro Whitlock has never measured it on a ward bigger than this one.",
        claimed: 0.6,
        dims: D(0.7, 0.35, 0.75),
      },
      {
        title: "Tessellate",
        key: "tessellate-intro",
        kind: "entity",
        content:
          "Tessellate is the studio's design system: eleven components, all of them drawn for a wall-mounted printout first and a screen second.",
        claimed: 0.6,
        dims: D(0.65, 0.4, 0.6),
      },
      {
        kind: "fact",
        content:
          "The swap sheet is the only surface where two people edit the same thing, and it currently has no conflict handling at all.",
        claimed: 0.8,
        dims: D(0.85, 0.6, 0.9),
        jot: true,
      },
    ],
    uses: ["fairness-window", "halfmoon-shape"],
  },
  {
    date: "2026-06-10",
    session: "fern-008",
    chapter:
      "Marguerite Solberg printed the rota grid at actual size and taped it to the back room wall, and the argument about density resolved itself in about ninety seconds. Everyone had been imagining a different physical object. I want to remember that trick: when a disagreement will not converge, find the thing everyone is picturing differently and put it on the wall.",
    notes: [
      {
        key: "density-print",
        kind: "person",
        content:
          "Marguerite Solberg ended the density argument by printing the grid at wall size. Standing in front of it, the dense version was obviously right and the spacious one obviously a laptop artefact.",
        claimed: 0.85,
        dims: D(0.85, 0.8, 0.85),
      },
      {
        key: "self-real-object",
        kind: "self",
        content:
          "When a disagreement will not converge, I look for the object everyone is picturing differently and try to put a real one in the room. It has worked twice now.",
        claimed: 0.9,
        dims: D(0.9, 0.75, 0.9),
      },
      {
        kind: "skill",
        content:
          "Printing a screen at the size it will actually be used at is faster than another round of review comments.",
        claimed: 0.7,
        dims: D(0.75, 0.6, 0.8),
      },
    ],
    uses: ["marguerite-intro", "tessellate-intro"],
  },
  {
    date: "2026-06-11",
    session: "fern-009",
    notes: [
      {
        key: "night-first",
        kind: "person",
        content:
          "Nkechi Abernathy reviewed the generated rota by reading the night column first and then everything else. She did it twice, on two different rotas, without being asked.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.95),
      },
      {
        kind: "fact",
        content:
          "Bank staff decline about one in five offered shifts at Cotter Street Clinic, and the solver has no notion of an offer being declined.",
        claimed: 0.75,
        dims: D(0.8, 0.5, 0.85),
      },
      {
        kind: "fact",
        content:
          "The corridor noticeboard is where the rota becomes real. If it is not printed by Friday afternoon the ward runs on the previous week's paper.",
        claimed: 0.7,
        dims: D(0.75, 0.6, 0.75),
      },
    ],
    cues: ["night shift rota Nkechi Abernathy"],
    uses: ["night-first", "three-pens"],
  },
  {
    date: "2026-06-12",
    session: "fern-010",
    chapter:
      "A quiet Friday. I spent it writing down the things I have been treating as known and have never checked: that twenty-two staff is stable, that nine seconds scales, that the ward reads the app rather than the printout. Three assumptions, none of them tested, all of them load-bearing. Rosalind Achebe read the list and said it was the most useful thing anyone had written this month, which I am choosing to take literally rather than kindly.",
    notes: [
      {
        key: "assumption-list",
        kind: "fact",
        content:
          "Three load-bearing assumptions nobody has tested: staff count is stable, solve time scales, and the ward reads the app rather than the printed sheet. All three are currently guesses.",
        claimed: 0.9,
        dims: D(0.95, 0.6, 0.95),
        unresolved: true,
      },
      {
        key: "self-unchecked-list",
        kind: "self",
        content:
          "I keep a running list of what I am treating as known and have never checked. Writing it down is cheap; the list has been wrong twice and both times it mattered.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.95),
      },
      {
        title: "Fernbrook",
        key: "fernbrook-intro",
        kind: "entity",
        content:
          "Fernbrook is four people and one product. There is no room for a second thing, which is the studio's main design constraint and nobody says it out loud.",
        claimed: 0.7,
        dims: D(0.75, 0.55, 0.75),
      },
    ],
    uses: ["assumption-list", "fairness-window", "halfmoon-shape"],
  },
  {
    date: "2026-06-15",
    session: "fern-011",
    notes: [
      {
        key: "swap-conflict",
        kind: "fact",
        content:
          "Two nurses swapped into the same slot on the swap sheet and the second write silently won. Nobody noticed for two days; the ward noticed before the app did.",
        claimed: 0.95,
        dims: D(0.95, 0.85, 0.95),
      },
      {
        kind: "entity",
        title: "Tessellate",
        content:
          "Tessellate has no component for a conflict, an error, or a thing that failed. Every state in the system is a happy one.",
        claimed: 0.8,
        dims: D(0.85, 0.65, 0.9),
      },
      {
        kind: "self",
        content:
          "I have started assuming that any surface two people can edit will be edited by two people at once, and asking what happens then, before anyone builds it.",
        claimed: 0.9,
        dims: D(0.9, 0.6, 0.95),
      },
    ],
    cues: ["swap sheet conflict two nurses same slot"],
    uses: ["swap-conflict", "tessellate-intro"],
  },
  {
    date: "2026-06-16",
    session: "fern-012",
    chapter:
      "The swap collision turned into a real afternoon. Teodoro Whitlock wanted a database constraint, Ilya Broadbent wanted the phone to hold the write and reconcile, Marguerite Solberg wanted the sheet to show both and let a human pick. Marguerite won, and I think she was right for a reason none of us said at the time: the ward already has a protocol for two people wanting the same shift, and it is a conversation.",
    notes: [
      {
        key: "conflict-resolution",
        kind: "fact",
        content:
          "The swap sheet will show both claims and let a human resolve, rather than picking a winner. The ward already had a protocol for this and it is a conversation, not a rule.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.9),
      },
      {
        kind: "skill",
        content:
          "Before designing a resolution rule, find out what the people already do when it happens. They usually have a protocol and it is usually better than the rule.",
        claimed: 0.85,
        dims: D(0.9, 0.6, 0.95),
      },
      {
        kind: "person",
        content:
          "Ilya Broadbent's instinct on the swap collision was to make the phone authoritative offline, which would have made the ward's own protocol unavailable exactly when it was needed.",
        claimed: 0.7,
        dims: D(0.75, 0.5, 0.8),
      },
    ],
    uses: ["swap-conflict", "marguerite-intro", "conflict-resolution"],
  },
  {
    date: "2026-06-17",
    session: "fern-013",
    notes: [
      {
        kind: "fact",
        content:
          "The phone app shows a cached rota with no indication of how old it is, so a nurse in the basement corridor cannot tell yesterday's roster from today's.",
        claimed: 0.9,
        dims: D(0.9, 0.75, 0.95),
      },
      {
        kind: "place",
        title: "Cotter Street Clinic",
        content:
          "The basement corridor at Cotter Street Clinic has no signal, and it is where handover happens. Every offline question is really a question about that corridor.",
        claimed: 0.85,
        dims: D(0.85, 0.6, 0.9),
      },
      {
        kind: "fact",
        content:
          "Ilya Broadbent added a last-updated stamp to the phone rota in an afternoon once the corridor came up. The fix was never the hard part; noticing was.",
        claimed: 0.65,
        dims: D(0.7, 0.55, 0.7),
        jot: true,
      },
    ],
    cues: ["offline phone rota basement corridor"],
    uses: ["ilya-intro", "conflict-resolution"],
  },
  {
    date: "2026-06-18",
    session: "fern-014",
    chapter:
      "Halfway through the pilot. I reread my own notes from the first week and was struck by how much of what I wrote as fact was actually Rosalind Achebe's framing repeated back. I have been correcting for that since about day six without noticing I was doing it. Today I did it on purpose.",
    notes: [
      {
        kind: "self",
        content:
          "I check whose framing a note is in before I write it down. Early on I recorded the founder's pitch as if it were an observation, and it took a week to notice.",
        claimed: 0.9,
        dims: D(0.9, 0.75, 0.9),
      },
      {
        kind: "person",
        content:
          "Rosalind Achebe's framing is persuasive enough that it gets repeated back as fact within a day. That is a sales strength and a research hazard at the same time.",
        claimed: 0.8,
        dims: D(0.85, 0.7, 0.85),
      },
      {
        kind: "fact",
        content:
          "Two weeks in, the pilot ward has generated four rotas and hand-edited every one of them after generation. The edits average eleven per rota.",
        claimed: 0.9,
        dims: D(0.95, 0.6, 0.95),
      },
    ],
    uses: ["assumption-list", "night-first"],
  },
  {
    date: "2026-06-19",
    session: "fern-015",
    notes: [
      {
        key: "eleven-edits",
        kind: "fact",
        content:
          "Eleven hand edits per generated rota is the number to beat. Nobody had counted it before today; the team's guess was two or three.",
        claimed: 0.95,
        dims: D(0.95, 0.7, 0.95),
      },
      {
        kind: "skill",
        content:
          "Counting the manual corrections after an automated step is the cheapest measure of whether the automation is trusted.",
        claimed: 0.85,
        dims: D(0.9, 0.55, 0.95),
      },
      {
        kind: "person",
        content:
          "Nkechi Abernathy said the night rota over the first fortnight was better than she expected, and then listed four nights she had changed by hand anyway.",
        claimed: 0.85,
        dims: D(0.9, 0.75, 0.9),
      },
    ],
    cues: ["hand edits generated rota count"],
    uses: ["eleven-edits", "night-first", "three-pens"],
  },
  {
    date: "2026-06-22",
    session: "fern-016",
    chapter:
      "Went back through the eleven edits with Nkechi Abernathy, one at a time. Nine of them are the same constraint: she will not put a nurse on a night shift immediately after a late, even where the rules permit it, because of the drive home. Driftwood has no way to say that. This is the single most valuable hour I have spent on the project.",
    notes: [
      {
        key: "late-to-night",
        kind: "fact",
        content:
          "Nine of the eleven hand edits are the same rule: never a night shift straight after a late, because of the drive home. The regulations permit it and Nkechi Abernathy will not do it.",
        claimed: 0.95,
        dims: D(0.95, 0.9, 0.95),
      },
      {
        kind: "skill",
        content:
          "Going through corrections one at a time with the person who made them turns a pile of noise into one missing constraint, most of the time.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.95),
      },
      {
        key: "self-sit-with",
        kind: "self",
        content:
          "I would rather sit with somebody while they redo the work by hand than read a summary of what they changed. The summary loses the reason, and the reason is the requirement.",
        claimed: 0.95,
        dims: D(0.95, 0.85, 0.95),
      },
    ],
    uses: ["eleven-edits", "late-to-night", "night-first"],
  },
  {
    date: "2026-06-23",
    session: "fern-017",
    notes: [
      {
        kind: "entity",
        title: "Driftwood",
        content:
          "Driftwood gained a rest-window constraint: no night shift within a set number of hours of a late finish. It is a hard constraint, not a weight, at Nkechi Abernathy's insistence.",
        claimed: 0.9,
        dims: D(0.9, 0.65, 0.9),
      },
      {
        kind: "fact",
        content:
          "Adding one hard constraint took the solve from nine seconds to eleven and removed nine of the eleven hand edits. The trade was not close.",
        claimed: 0.9,
        dims: D(0.9, 0.6, 0.9),
      },
      {
        kind: "person",
        content:
          "Teodoro Whitlock shipped the rest-window constraint behind a flag with a single-command rollback, on the same day he wrote it, which is fast for him.",
        claimed: 0.75,
        dims: D(0.8, 0.55, 0.8),
      },
    ],
    cues: ["rest window constraint late night shift"],
    uses: ["late-to-night", "teodoro-rollback-note"],
  },
  {
    date: "2026-06-24",
    session: "fern-018",
    notes: [
      {
        kind: "fact",
        content:
          "The second ward at Cotter Street Clinic wants in, which would take the solver from twenty-two staff to fifty-one across two rotas that share bank staff.",
        claimed: 0.85,
        dims: D(0.9, 0.6, 0.95),
      },
      {
        kind: "fact",
        content:
          "Nobody has ever run Driftwood over two wards sharing staff. The sharing is the hard part and it is not modelled at all.",
        claimed: 0.9,
        dims: D(0.9, 0.65, 0.95),
        unresolved: true,
      },
      {
        kind: "place",
        title: "Larkspur Wharf",
        content:
          "The back room at Larkspur Wharf now has the pilot ward's rota on one wall and the list of unmodelled things on the other. The second wall is winning.",
        claimed: 0.6,
        dims: D(0.6, 0.7, 0.6),
      },
    ],
    uses: ["fairness-window", "late-to-night"],
  },
  {
    date: "2026-06-25",
    session: "fern-019",
    chapter:
      "Rosalind Achebe wants to say yes to the second ward. Teodoro Whitlock wants six weeks first. I said the thing I had been keeping in my pocket: Driftwood has never been run across two rotas that share people, and the sharing is the whole problem. The room took it better than I expected. We are saying yes with a date that is six weeks out.",
    notes: [
      {
        kind: "person",
        content:
          "Rosalind Achebe says yes to a new ward first and works out the cost afterwards. It is how Fernbrook got the pilot at all, and it is why the roadmap is always two things longer than the studio.",
        claimed: 0.85,
        dims: D(0.85, 0.65, 0.9),
      },
      {
        kind: "self",
        content:
          "When I know the thing that would change a decision, I say it in the room where the decision is being made, not afterwards in a note. I have got this wrong before by being polite.",
        claimed: 0.95,
        dims: D(0.95, 0.8, 0.95),
      },
      {
        kind: "fact",
        content:
          "The second ward is agreed for six weeks out rather than immediately, on the grounds that shared bank staff are unmodelled.",
        claimed: 0.8,
        dims: D(0.85, 0.55, 0.85),
      },
    ],
    uses: ["assumption-list", "fairness-window"],
  },
  {
    date: "2026-06-26",
    session: "fern-020",
    notes: [
      {
        kind: "fact",
        content:
          "The clocks go back in October and Driftwood assumes every day is twenty-four hours. The night of the change has an extra hour in it and one shift will be twenty-five hours long.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.95),
      },
      {
        kind: "skill",
        content:
          "Any system that reasons about shifts eventually meets a day that is not twenty-four hours long. Ask about it before the calendar does.",
        claimed: 0.85,
        dims: D(0.85, 0.55, 0.95),
      },
      {
        kind: "fact",
        content:
          "Teodoro Whitlock's first reaction to the clock change was to ask what the ward currently does, rather than what the code should do. They add a person.",
        claimed: 0.75,
        dims: D(0.8, 0.6, 0.8),
        jot: true,
      },
    ],
    cues: ["clocks go back October twenty five hour shift"],
    uses: ["teodoro-intro", "late-to-night"],
  },
  {
    date: "2026-06-29",
    session: "fern-021",
    chapter:
      "Fourth week. The pilot is going well enough that people have started proposing features, which is the dangerous part. I have been trying to hold the line that everything on the wall of unmodelled things comes before anything new, and I am losing about a third of those arguments, which feels roughly right.",
    notes: [
      {
        kind: "fact",
        content:
          "Feature proposals started in week four: annual leave, agency staff, a manager view. All three interact with the fairness window and none of them are costed.",
        claimed: 0.8,
        dims: D(0.85, 0.5, 0.9),
      },
      {
        kind: "self",
        content:
          "I argue for finishing the unmodelled list before anything new, and I expect to lose about a third of those arguments. Losing some of them is how I know I am not just being obstructive.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.9),
      },
      {
        kind: "entity",
        title: "Halfmoon",
        content:
          "Halfmoon's roadmap is now longer than the studio can build in a year, and every item on it was agreed in a room where somebody was enthusiastic.",
        claimed: 0.75,
        dims: D(0.8, 0.6, 0.85),
      },
    ],
    uses: ["fairness-window", "assumption-list"],
  },
  {
    date: "2026-06-30",
    session: "fern-022",
    notes: [
      {
        kind: "person",
        content:
          "Marguerite Solberg refuses to design a screen she has not seen someone use badly. She spent a morning at the noticeboard watching people read the printout.",
        claimed: 0.8,
        dims: D(0.8, 0.65, 0.85),
      },
      {
        kind: "fact",
        content:
          "People read the printed rota by finding their own name first and then scanning left, which is the opposite of how the grid is ordered on screen.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.95),
      },
      {
        kind: "skill",
        content:
          "Watching someone use a thing badly is worth more than asking them what they want, and it takes less of their time.",
        claimed: 0.85,
        dims: D(0.85, 0.6, 0.9),
      },
    ],
    cues: ["printed rota noticeboard reading order"],
    uses: ["marguerite-intro", "density-print", "three-pens"],
  },
  {
    date: "2026-07-01",
    session: "fern-023",
    notes: [
      {
        kind: "entity",
        title: "Tessellate",
        content:
          "Tessellate's rota grid was reordered to put the reader's own row first on the phone, which no component in the system had a way to express before.",
        claimed: 0.8,
        dims: D(0.85, 0.5, 0.85),
      },
      {
        kind: "fact",
        content:
          "The personalised row order needs to know who is looking, which the printed sheet cannot, so the wall version and the phone version have permanently diverged.",
        claimed: 0.85,
        dims: D(0.85, 0.6, 0.9),
      },
      {
        kind: "self",
        content:
          "I notice when a design decision quietly splits one artefact into two, and I say so, because the second one always needs an owner and never gets one by default.",
        claimed: 0.9,
        dims: D(0.9, 0.65, 0.95),
      },
    ],
    uses: ["tessellate-intro", "conflict-resolution"],
  },
  {
    date: "2026-07-02",
    session: "fern-024",
    chapter:
      "Walked Marguerite Solberg through the swap sheet with a month of real ward data instead of the fixture, which I had been meaning to do for two weeks. The fixture has four staff and no bank shifts; the real month has twenty-two people and a fortnight where three of them were off at once. Half the layout decisions were made against a world that does not exist.",
    notes: [
      {
        key: "fixture-lies",
        kind: "fact",
        content:
          "The design fixture has four staff and no bank shifts. The real ward month has twenty-two people and a fortnight with three simultaneously absent, and the swap sheet layout was designed against the fixture.",
        claimed: 0.95,
        dims: D(0.95, 0.8, 0.95),
      },
      {
        kind: "skill",
        content:
          "Replacing a design fixture with one real month of data finds layout failures that no amount of review finds.",
        claimed: 0.9,
        dims: D(0.9, 0.6, 0.95),
      },
      {
        kind: "person",
        content:
          "Marguerite Solberg threw away a week of swap-sheet layout on seeing the real data and did not sulk about it for a second, which is rarer than it should be.",
        claimed: 0.85,
        dims: D(0.85, 0.8, 0.85),
      },
    ],
    cues: ["design fixture real ward month swap sheet"],
    uses: ["fixture-lies", "marguerite-intro"],
  },
  {
    date: "2026-07-03",
    session: "fern-025",
    notes: [
      {
        kind: "fact",
        content:
          "The fortnight with three staff absent at once produced a rota Driftwood called feasible and Nkechi Abernathy called unsafe. Both were right under their own definitions.",
        claimed: 0.95,
        dims: D(0.95, 0.9, 0.95),
      },
      {
        kind: "entity",
        title: "Driftwood",
        content:
          "Driftwood's notion of feasible is that every shift has a body in it. It has no notion of skill mix, so three juniors on a night counts as covered.",
        claimed: 0.95,
        dims: D(0.95, 0.85, 0.95),
      },
      {
        kind: "self",
        content:
          "When a system and a person disagree about whether something is acceptable, I write down both definitions before I take a side. Usually the gap between them is the actual finding.",
        claimed: 0.95,
        dims: D(0.95, 0.8, 0.95),
      },
    ],
    cues: ["feasible unsafe skill mix night shift"],
    uses: ["late-to-night", "night-first", "fixture-lies"],
  },
  {
    date: "2026-07-06",
    session: "fern-026",
    chapter:
      "Skill mix has been sitting in plain sight for five weeks. Every conversation about the night shift was really about it and nobody, me included, named it. I have gone back through my notes and the evidence was there from the third day, in the red pen. A shift covered under protest is usually a shift covered by the wrong person, not by nobody.",
    notes: [
      {
        key: "skill-mix",
        kind: "fact",
        content:
          "Skill mix is the missing model. The red pen on the paper rota, the night-column reading order and the unsafe fortnight are all the same finding, and it was visible from the third day.",
        claimed: 0.95,
        dims: D(0.95, 0.9, 0.95),
      },
      {
        kind: "self",
        content:
          "I go back through old notes when a new finding lands, to see whether I already had it. Twice now the evidence was there weeks earlier and I had filed it as three separate small things.",
        claimed: 0.95,
        dims: D(0.95, 0.85, 0.95),
      },
      {
        kind: "skill",
        content:
          "Rereading your own early notes after a big finding is how you learn what shape of evidence you personally miss.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.95),
      },
    ],
    uses: ["skill-mix", "red-pen", "three-pens"],
  },
  {
    date: "2026-07-07",
    session: "fern-027",
    notes: [
      {
        kind: "person",
        content:
          "Nkechi Abernathy has a mental grade for every nurse on the ward and uses it on every rota. She had never been asked to write it down because no system had a place to put it.",
        claimed: 0.95,
        dims: D(0.95, 0.85, 0.95),
      },
      {
        kind: "fact",
        content:
          "Writing down a skill grade for a colleague is a political act on a ward, which is why the paper rota encodes it in pen colour rather than in a column.",
        claimed: 0.9,
        dims: D(0.9, 0.85, 0.9),
      },
      {
        kind: "skill",
        content:
          "Before adding a field, ask why the existing system encodes that information indirectly. Usually somebody chose the indirection on purpose.",
        claimed: 0.9,
        dims: D(0.9, 0.7, 0.95),
      },
    ],
    cues: ["skill grade nurse political pen colour"],
    uses: ["skill-mix", "red-pen"],
  },
  {
    date: "2026-07-08",
    session: "fern-028",
    notes: [
      {
        kind: "fact",
        content:
          "The team chose to model skill mix as a per-shift requirement rather than a per-person grade, so the ward states what a night needs instead of ranking its nurses.",
        claimed: 0.95,
        dims: D(0.95, 0.8, 0.95),
      },
      {
        kind: "entity",
        title: "Halfmoon",
        content:
          "Halfmoon will ask what each shift requires rather than what each nurse is worth. The two are arithmetically similar and socially not remotely the same thing.",
        claimed: 0.95,
        dims: D(0.95, 0.85, 0.95),
      },
      {
        kind: "self",
        content:
          "Where two models compute the same answer, I argue for the one that is kinder to say out loud. It is not a soft preference; the unkind one gets quietly worked around.",
        claimed: 0.95,
        dims: D(0.95, 0.9, 0.95),
      },
    ],
    uses: ["skill-mix", "conflict-resolution"],
  },
  {
    date: "2026-07-09",
    session: "fern-029",
    chapter:
      "Teodoro Whitlock shipped the per-shift requirement model behind a flag and then, for the first time since I have been here, merged something he could not roll back in one command — the schema change needed a backfill. He said so in the review himself, wrote the reverse migration first, and got Rosalind Achebe to agree to a maintenance window. I had believed that rule was absolute. It turns out it was a default with a procedure behind it.",
    notes: [
      {
        key: "rollback-exception",
        kind: "person",
        content:
          "Teodoro Whitlock merged a migration he could not reverse in one command, having written the reverse migration first and booked a maintenance window. The rule was never absolute; it was a default with an escalation path.",
        claimed: 0.95,
        dims: D(0.95, 0.8, 0.95),
      },
      {
        kind: "self",
        content:
          "When somebody breaks a rule I attributed to them, I check whether it was ever their rule or my summary of their behaviour. It has usually been mine.",
        claimed: 0.95,
        dims: D(0.95, 0.85, 0.95),
      },
      {
        kind: "fact",
        content:
          "The skill-mix schema change went out in a Thursday maintenance window with a written reverse migration and a rehearsal on a copy of the pilot data.",
        claimed: 0.8,
        dims: D(0.85, 0.55, 0.85),
      },
    ],
    uses: ["teodoro-rollback-note", "skill-mix"],
  },
  {
    date: "2026-07-10",
    session: "fern-030",
    chapter:
      "End of six weeks. The rota that went on the noticeboard this Friday had two hand edits on it, down from eleven. Nkechi Abernathy said it was the first one she had not had to reread. I am leaving the pilot with a list of four things nobody has modelled and a much better sense of what this product actually is: not a scheduler, a way of having the ward's argument earlier and in writing.",
    notes: [
      {
        kind: "fact",
        content:
          "The final pilot rota went up with two hand edits, down from eleven six weeks earlier, and Nkechi Abernathy did not reread it.",
        claimed: 0.95,
        dims: D(0.95, 0.9, 0.95),
      },
      {
        kind: "entity",
        title: "Halfmoon",
        content:
          "Halfmoon is not a scheduler. It is a way of having the ward's argument earlier and in writing, and every feature that forgets that has been the wrong one.",
        claimed: 0.95,
        dims: D(0.95, 0.9, 0.95),
      },
      {
        kind: "self",
        content:
          "I measure a tool by how much hand correction it still needs, and I say the number out loud at the start and the end. Nobody argues with a count they watched fall.",
        claimed: 0.95,
        dims: D(0.95, 0.85, 0.95),
      },
      {
        kind: "place",
        title: "Cotter Street Clinic",
        content:
          "The noticeboard at Cotter Street Clinic is still the source of truth on that ward, and the product's job is to make what goes on it correct, not to replace it.",
        claimed: 0.85,
        dims: D(0.85, 0.7, 0.85),
      },
    ],
    cues: ["hand edits fell eleven to two noticeboard"],
    uses: ["skill-mix", "eleven-edits", "three-pens"],
  },
];

/**
 * The challenge script, laid over the days above. Each entry mints an ordinary
 * memory that declares `updates: <beliefId>`, which is the one door the demo has
 * for putting pressure on a belief.
 *
 * `teodoro-rollback` is a `person` belief (inertia 0.8, and therefore under the
 * slow-kind daily force cap), so three credited lived days is arithmetic rather
 * than luck — the same shape `test/dashboard.test.ts` relies on. `halfmoon-cache`
 * takes two weak challenges and HOLDS, so the view has a contested belief that
 * was argued with and won.
 */
export interface ScriptedChallenge {
  onDay: number;
  target: BeliefKey;
  content: string;
  kind: Kind;
  claimed: number;
  dims: Dims;
}

export const CHALLENGES: readonly ScriptedChallenge[] = [
  {
    onDay: 12,
    target: "halfmoon-cache",
    content:
      "The rota grid took four seconds to appear on the ward tablet this morning, which is a rebuild every time somebody opens it and no cache anywhere.",
    kind: "entity",
    claimed: 0.3,
    dims: { relevance: 0.35, emotional: 0.25, predictive: 0.3 },
  },
  {
    onDay: 16,
    target: "halfmoon-cache",
    content:
      "Ilya Broadbent mentioned that the phone view already keeps last week's rota locally, so there is a cache after all, it is just not the one anybody planned.",
    kind: "entity",
    claimed: 0.3,
    dims: { relevance: 0.35, emotional: 0.2, predictive: 0.3 },
  },
  {
    onDay: 26,
    target: "teodoro-rollback",
    content:
      "Teodoro Whitlock said in review that he would take an irreversible migration if the reverse was written first and there was a window booked for it, which is not the absolute rule I had recorded.",
    kind: "person",
    claimed: 0.45,
    dims: { relevance: 0.45, emotional: 0.4, predictive: 0.45 },
  },
  {
    onDay: 27,
    target: "teodoro-rollback",
    content:
      "Rosalind Achebe agreed a Thursday maintenance window for the skill-mix schema change, and Teodoro Whitlock proposed it himself rather than being talked into it.",
    kind: "person",
    claimed: 0.45,
    dims: { relevance: 0.45, emotional: 0.4, predictive: 0.45 },
  },
  {
    onDay: 28,
    target: "teodoro-rollback",
    content:
      "The migration Teodoro Whitlock merged cannot be reversed with one command. He wrote the reverse migration, rehearsed it on a copy, and booked the window, and he treats that procedure as the rule rather than the one-command test.",
    kind: "person",
    claimed: 0.45,
    dims: { relevance: 0.45, emotional: 0.4, predictive: 0.45 },
  },
];
