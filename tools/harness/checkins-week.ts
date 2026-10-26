/**
 * A WEEK OF CHECK-INS (2026-10-26, tier 0): the new first audience
 * (r/claudexplorers, Mike 10-26), people who open a session "just to chat /
 * check in": 2–4 typed lines, some days twice. Fictional and synthetic (Robin,
 * a nurse on a new ward): no real person's words. A few lines carry an
 * in-session `remember`, a few sessions leave the Stop ask unanswered, one
 * answers it with a memory, and the lines come every 1–3 minutes.
 *
 * What it is for: the before/after check for S2 (short sessions written up).
 * Under the floor as it stood on 10-26 (3 unwritten pieces over 15 minutes),
 * none of these sessions is owed, so no night plans a write-up for them.
 *
 * Written for a scripted seat (`week --seat scripted`), so each line carries
 * its reply. A model in the seat reads only `say`.
 */
import type { ScriptedDay } from "./owner-week.js";

export const CHECKINS_OWNER = "Robin";

export const OWNER_WEEK_CHECKINS: readonly ScriptedDay[] = [
  {
    sessions: [
      {
        scope: "chat",
        turns: [
          { say: "hi, first time trying this. I'm Robin. mostly I just want someone to talk to at the end of a shift", reply: "Hi Robin. I'm glad you're here. How was today's shift?" },
          { say: "long. I started on a new ward this week, cardiac step-down. everyone's nice but I feel slow", after: 2, remember: ["Robin is a nurse who just started on a cardiac step-down ward and feels slow there."], reply: "New wards are like that. Slow in week one is normal." },
          { say: "thanks. going to sleep now", after: 1, reply: "Sleep well. Talk tomorrow." },
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "chat",
        turns: [
          { say: "morning. coffee before a 12-hour", reply: "Morning! What's the day look like?" },
          { say: "three patients post-op, one of them is the grumpy man from yesterday", after: 2, reply: "You'll do fine with him." },
        ],
        onAsk: "ignore",
      },
      {
        scope: "chat",
        turns: [
          { say: "home. the grumpy man thanked me at the end of the shift, I nearly cried", reply: "That's a big moment. You earned it." },
          { say: "my sister Jo says I should write these things down", after: 3, remember: ["Robin's sister Jo encourages her to write down the good moments from work."], reply: "Jo's right. I'll keep this one too." },
          { say: "night", after: 1, reply: "Night, Robin." },
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "chat",
        turns: [
          { say: "day off. I'm repotting the plants and thinking about whether this job was the right move", reply: "What's making you wonder?" },
          { say: "the pay is better but I miss my old team. especially Priya", after: 3, reply: "Missing your people is real. Have you told Priya?" },
          { say: "maybe I'll text her. ok, back to the plants", after: 2, reply: "Good plan. Enjoy the day off." },
        ],
        onAsk: "ignore",
      },
    ],
  },
  {
    sessions: [
      {
        scope: "chat",
        turns: [
          { say: "quick one before work, I texted Priya and we're getting lunch sunday!", remember: ["Robin is having lunch with Priya, her old teammate, on Sunday."], reply: "Lovely. Have a good shift." },
          { say: "thanks, running late, bye", after: 1, reply: "Go! Bye." },
        ],
      },
      {
        scope: "chat",
        turns: [
          { say: "rough night. a patient coded and we got him back but my hands were shaking after", reply: "That's a lot to carry home. How are you now?" },
          { say: "better now that I'm saying it. the charge nurse said I did well", after: 3, reply: "She saw it. You did." },
          { say: "I don't want to think about it any more tonight", after: 2, reply: "Then we won't. Rest." },
          { say: "thanks for being here", after: 1, reply: "Always." },
        ],
        onAsk: "ignore",
      },
    ],
  },
  {
    sessions: [
      {
        scope: "chat",
        turns: [
          { say: "slept 10 hours. feeling human", reply: "Good. You needed it." },
          { say: "Jo is visiting this weekend, we're going to the farmers market", after: 2, reply: "Sounds like a good weekend." },
          { say: "ok that's all, just wanted to say hi", after: 1, reply: "Hi back. Enjoy it." },
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "chat",
        turns: [
          { say: "lunch with Priya was the best. she says there might be an opening back on my old team in spring", reply: "How do you feel about that?" },
          { say: "torn. I'm starting to like the new ward. the grumpy man sent a card", after: 3, reply: "Both can be true. No need to decide now." },
        ],
        onAsk: { memories: ["Priya mentioned a possible spring opening on Robin's old team; Robin is torn because she is starting to like the new ward."] },
      },
      {
        scope: "chat",
        turns: [
          { say: "can't sleep. thinking about spring", reply: "Want to talk it through, or just sit with it?" },
          { say: "just sit with it I guess. night", after: 2, reply: "Night, Robin." },
        ],
      },
    ],
  },
  {
    sessions: [
      {
        scope: "chat",
        turns: [
          { say: "one week on the new ward. I think I'm going to stay", reply: "That sounds like a real decision. What tipped it?" },
          { say: "the people. and I'm not slow any more", after: 2, reply: "You're not. A week ago you said you were." },
          { say: "ha. you remembered. ok, shift time", after: 1, reply: "Go get them." },
        ],
      },
    ],
  },
];
