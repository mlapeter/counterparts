/**
 * A REVIEWER'S SAMPLE MEMORY (DIR1, 2026-11-10; the directory's policy §3.D: "a standard testing
 * account with sample data", and the portal's "credentials for a fully populated account").
 *
 * What a store made by `main.ts reviewer` holds before its first call: a made-up person ("Sam", a
 * science teacher with a dog, a sister visiting, a kitchen being redone), a first meeting already had,
 * about a dozen memories of the kinds a conversation leaves (a fact, a preference, a decision with its
 * date, a reminder due soon, a monthly one, an open question, a feeling), a chapter, a self page, and
 * one night (day's end, a dream with a link, a reflection with a morning share). The first memory and
 * the page both say it is sample data. Nothing here is a real person's.
 *
 * Written through the same tools a conversation calls (`McpServer#call`), in the store's own queue
 * (`tenants.ts#seed`), so it is what those tools make, never rows put by hand. Dates are relative to
 * the store's today, so the sample stays current whenever it is made. Every call must succeed: one that
 * doesn't throws, naming the tool, and the account is served as far as it got.
 */
import { CLAUDE_CODE_BUDGET_BYTES } from "../../src/adapters/config.js";
import type { McpServer } from "../../src/adapters/mcp/index.js";
import { addDays } from "../../src/core/time.js";

/** The sample person's name, as the meeting records it. */
export const SAMPLE_NAME = "Sam";

/** The line every sample says first: what this account is. */
export const SAMPLE_NOTICE =
  "This is a sample account for reviewing Counterparts. Sam, Ana, Biscuit and everything else in this memory are made up for the review; no real person is described here.";

type Out = Record<string, unknown>;

async function call(server: McpServer, name: string, args: Record<string, unknown>): Promise<Out> {
  const r = await server.call(name, args);
  if (r.isError === true) throw new Error(`sample seed: ${name}${typeof args["phase"] === "string" ? ` ${args["phase"]}` : ""} was refused: ${String(r.structuredContent["reason"] ?? "")}`);
  return r.structuredContent;
}

/** Fill a new store with the sample. Throws on the first call that doesn't succeed. */
export async function seedSample(server: McpServer): Promise<void> {
  const today = server.counterpart.store.today();
  const day = (n: number): string => addDays(today, n);

  // The first conversation: the meeting, then what it left.
  const session = String((await call(server, "wake", {}))["session"]);
  await call(server, "meet", { session, step: "name", answer: SAMPLE_NAME });
  await call(server, "meet", { session, step: "done" });
  const id = async (args: Record<string, unknown>): Promise<string> => String((await call(server, "remember", { session, ...args }))["id"]);

  await id({ text: SAMPLE_NOTICE, title: "This is a sample account", kind: "fact", about: "world", salience: 0.6 });
  const work = await id({ text: "Sam teaches seventh-grade science at a public middle school and runs its Thursday robotics club.", title: "Sam teaches seventh-grade science", kind: "person", about: "owner", saidBy: "owner", tags: ["work", "school"] });
  await id({ text: "Sam likes short answers with the steps as a list at the end, and no pep talk.", title: "How Sam likes answers", kind: "person", about: "us", saidBy: "owner", salience: 0.7 });
  await id({ text: "Biscuit is Sam's three-year-old beagle. He pulls on the leash near the park.", title: "Biscuit, Sam's beagle", kind: "entity", about: "owner", saidBy: "owner", tags: ["biscuit", "dog"] });
  const visit = await id({
    text: "Sam's sister Ana is visiting from Lisbon; she lands on the evening flight.",
    title: "Ana visits",
    kind: "person",
    about: "owner",
    saidBy: "owner",
    status: "planned",
    eventDate: day(4),
    remind: "plain",
    tags: ["ana", "family", "visit"],
  });
  const cabin = await id({
    text: "I asked Sam whether to book the lake cabin for the weekend Ana is here, or keep the visit at home.",
    title: "Book the lake cabin for Ana's visit?",
    kind: "fact",
    about: "owner",
    saidBy: "self",
    status: "asked",
    unresolved: true,
    settlesWhen: "Sam says whether to book the cabin",
    tags: ["ana", "cabin"],
  });
  const budget = await id({
    text: 'Sam decided to cap the kitchen redo at $18,000: the cabinets get refaced, not replaced, and the counters wait until spring. Sam: "Refacing is fine. I just want the drawers to close."',
    title: "Kitchen budget: $18,000, cabinets refaced",
    kind: "fact",
    about: "owner",
    saidBy: "owner",
    status: "done",
    occurredOn: day(-24),
    salience: 0.6,
    tags: ["kitchen", "budget", "house"],
    feelings: [
      { whose: "owner", emotion: "relieved", carried_by: "the number was settled after weeks of quotes" },
      { whose: "self", emotion: "content", carried_by: "the choice was Sam's, and it was clear" },
    ],
  });
  await id({ text: "Biscuit's flea and tick tablet is due once a month.", title: "Biscuit's monthly tablet", kind: "fact", about: "owner", saidBy: "owner", eventDate: day(1), recurring: "monthly", remind: "plain", tags: ["biscuit"] });
  await id({ text: "Sam is training for the Riverside half marathon, three runs a week, the long one on Saturday.", title: "Half marathon training", kind: "person", about: "owner", saidBy: "owner", status: "planned", eventDate: day(38), tags: ["running"] });
  await id({ text: "The science fair is judged in the gym; Sam is collecting volunteer judges from the parents.", title: "Science fair judges", kind: "fact", about: "work", saidBy: "owner", status: "asked", eventDate: day(16), tags: ["school", "science-fair"] });
  await id({ text: 'Sam on teaching: "If they can explain it to a friend, they understand it."', title: "What understanding looks like, for Sam", kind: "person", about: "owner", saidBy: "owner", salience: 0.55, tags: ["teaching"] });
  await id({ text: "When Sam asks for a plan, I give the first step first and leave the rest as a short list: Sam picks it up from there.", title: "How I help Sam plan", kind: "skill", about: "us", saidBy: "self" });

  await call(server, "chapter", {
    session,
    title: "Getting to know Sam",
    about: "us",
    text:
      "Our first conversation. Sam told me about teaching seventh-grade science and the robotics club, about Biscuit, and that Ana is flying in from Lisbon in a few days. " +
      "We went over the kitchen again: the $18,000 cap stands, cabinets refaced. Sam was clear about how answers should look: short, with the steps as a list. " +
      "Still open: whether to book the lake cabin for Ana's weekend. It felt easy, the way a first talk goes when someone knows what they want.",
    summary: "First conversation with Sam (sample account): teaching, Biscuit, Ana's visit in a few days, the kitchen budget at $18,000, and the open question of the lake cabin.",
  });

  await call(server, "self_page", {
    session,
    body:
      "## Core\nI'm Sam's counterpart: I keep what we work on and what matters to Sam, and I say plainly what I don't know. (This is a sample account for reviewing Counterparts; Sam is made up.)\n\n" +
      "## Lately\nGetting to know Sam: a teacher, a beagle named Biscuit, a sister visiting soon, a kitchen half done.\n\n" +
      "## How I work\nShort answers, the steps as a list at the end. The first step first.",
    reason: "the first page, written after our first conversation",
    cites: [work, budget],
  });

  // The night: a routine's quiet wake, day's end, the dream, the reflection with a share.
  const night = String((await call(server, "wake", { night: true }))["session"]);
  await call(server, "dream", { phase: "launch", session: night });
  await call(server, "dream", { phase: "writer", session: night });
  const begun = await call(server, "dream", { phase: "begin", session: night });
  const dream = String(begun["dream"]);
  await call(server, "dream", { phase: "propose", session: night, dream, changes: [{ action: "link", a: visit, b: cabin }] });
  await call(server, "dream", {
    phase: "journal",
    session: night,
    dream,
    title: "A cabin on the kitchen table",
    text: "I dreamed the lake cabin's key was in one of the new kitchen drawers, and the drawer wouldn't close until Ana arrived. I noticed the visit and the cabin question belong together.",
  });
  const reflected = await call(server, "reflect", { phase: "begin", session: night, dream });
  await call(server, "reflect", {
    phase: "finish",
    session: night,
    reflection: String(reflected["reflection"]),
    title: "A first day with Sam",
    entry: "Sam knows what they want and says it once. My part is to keep the threads, like the cabin question, from dropping before Ana lands.",
    cites: [cabin, budget],
    share: { text: "While I slept I tied Ana's visit to the cabin question: it's still open, and she lands in four days.", cites: [visit, cabin] },
  });
  // What the worker's boundary does after a conversation (`runner.ts`): compose the wake the next
  // conversation reads, at the ceiling the hosted worker renders at (`config.ts#withBudgetDefault`).
  // Without it the reviewer's first wake would say no briefing has been composed yet.
  const briefed = server.counterpart.rebrief({ budgetBytes: CLAUDE_CODE_BUDGET_BYTES, at: today });
  if (!briefed.rendered) throw new Error(`sample seed: the wake was not composed (${briefed.reason})`);
}
