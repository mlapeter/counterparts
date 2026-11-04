/**
 * A DEVELOPER'S FIRST WEEK (2026-11-04, lane DW, for local outreach): the
 * audience LOCAL fits best, a researcher who codes with Claude Code all day.
 * Fictional and synthetic (Theo, a research engineer at a small
 * interpretability lab): no real person's words, code or numbers.
 *
 * What makes it a developer's week, against Dana's and Robin's:
 *   - four folders: three repos (`sim`, a JAX gridworld RL environment;
 *     `evals`, the lab's eval harness; `paper`, a workshop paper due Friday)
 *     and `scratch`, a weekend folder with no work in it;
 *   - two or three sessions most days, at working hours, plus a late one;
 *   - two long sessions (d2s1, d4s3), each with long gaps and one compaction
 *     (`compact`: PreCompact, a fresh `compact` wake, the model's context
 *     replaced by the summary);
 *   - agents and loops: two subagent hand-backs (`host: "peer"`) and a loop's
 *     CI notice (`host: "task-notification"`), which the person never typed;
 *   - one declined permission prompt (`declined`, the host's
 *     `[Request interrupted by user for tool use]`, which WP1 keeps out);
 *   - a personal aside every day, inside a work session, in whatever folder
 *     he is in, and a few things about how they work together;
 *   - prompts carry their own code and errors: the session has no file tools
 *     (`planTurn` denies the built-ins), so a question that pointed at a file
 *     would measure the model's flailing, not the memory.
 *
 * `DEVELOPER_EXPECTATIONS` says, fact by fact, where each should come back and
 * where it must not: the personal and "us" facts in every folder, each work
 * fact in its own repo only. The week reads them off the run
 * (`expectations.ts`).
 *
 * Written for both seats: a model reads only `say` (and the host lines, the
 * compaction summaries, the declined prompt); a scripted seat (tier 0) also
 * gets the replies and files the `remember`s, one per fact where it is told,
 * so the store-side folder of each fact is checkable with no model.
 */
import type { Expectation } from "./expectations.js";
import type { ScriptedDay } from "./owner-week.js";

export const DEVELOPER_OWNER = "Theo";

/** The folders of the week, as the sessions name them. */
export const DEVELOPER_FOLDERS = ["sim", "evals", "paper", "scratch"] as const;

const HANDBACK = "Another Claude session sent a message:\n";

export const DEVELOPER_WEEK: readonly ScriptedDay[] = [
  // DAY 1, Monday: the meeting in the first repo, then one session in each of the others.
  {
    sessions: [
      {
        scope: "sim",
        hour: 9,
        turns: [
          { say: "hey. setting this up because I keep re-explaining my repos every morning. sure, do the intro", reply: "Hi. Who are you, and what are we working on?" },
          {
            say: "I'm Theo, research engineer at a small interpretability lab. I live in three repos: sim (a JAX gridworld RL env), evals (our eval harness) and paper (a workshop paper due Friday). how I like to work: diff first, explanation after. no emoji, no preamble",
            remember: ["Theo works best with the diff first and the explanation after; no emoji, no preamble."],
            reply: "Got it: diff first, then why.",
          },
          { say: "name yourself if you like. I'll mostly just say hey", reply: "I'll go by Wren." },
          {
            say:
              "ok, real work. in sim we use uv, never pip, and every run is seeded 1337 so runs compare. returns blow up near the goal. here's the reward:\n```python\ndef reward(state, action, next_state):\n    r = -0.01\n    if next_state.at_goal:\n        r += GOAL_BONUS\n    r += shaping(state, next_state)\n    return r\n\ndef shaping(s, s2):\n    return GAMMA * phi(s2) - phi(s) + (GOAL_BONUS if s2.at_goal else 0.0)\n```\nwhat am I missing",
            remember: ["In the sim repo: uv, never pip; every run is seeded 1337 so runs compare."],
            reply: "shaping() adds GOAL_BONUS a second time. Drop that term.",
          },
          {
            say: "yep, the shaping term double-counts the goal bonus. that's bitten me twice now, keep it in mind for this repo",
            remember: ["sim: the reward bug was the shaping term double-counting the goal bonus (second time it happened)."],
            reply: "Noted for sim.",
          },
          {
            say: "personal aside: my partner Ines starts her residency at St. Brigid's next Monday, so I'm on dog mornings for a while. some days I'll start late. ok, kicking off ablation-7 with the fix, that's it",
            remember: ["Theo's partner Ines starts her residency at St. Brigid's next Monday; Theo does the dog mornings for a while."],
            reply: "Good luck to Ines. Run away.",
          },
        ],
      },
      {
        scope: "evals",
        hour: 14,
        turns: [
          { say: "different repo. evals CI has one flaky test, test_tokenizer_roundtrip, fails maybe 1 in 5:\n```\nAssertionError: 'café' != 'café'\n```\nboth strings print the same", reply: "NFC vs NFD: same glyphs, different code points." },
          {
            say: "right. normalize to NFC in the fixture, not the tokenizer. don't touch the tokenizer, other teams pin it",
            remember: ["evals: test_tokenizer_roundtrip was flaky from NFC vs NFD; normalize in the fixture, never touch the tokenizer (other teams pin it)."],
            reply: "Fixture only, then.",
          },
          { say: "write the fixture change? pytest, py3.11", reply: "```python\n@pytest.fixture\ndef text(raw):\n    return unicodedata.normalize('NFC', raw)\n```" },
          { say: "good. pushing", reply: "Done." },
        ],
      },
      {
        scope: "paper",
        hour: 22,
        turns: [
          {
            say: "late one. the paper: 'Sparse Probes Under Distribution Shift', 4-page workshop, deadline Friday 23:59 AoE. the abstract is 212 words, limit is 150:\nWe study whether sparse linear probes trained on a model's residual stream keep their accuracy when the input distribution shifts. Across twelve checkpoints of a small transformer trained on synthetic gridworld trajectories, we find that probe accuracy rises with training and then plateaus, but that sparse probes lose less accuracy under shift than dense ones. We relate this to the number of active features and show that a simple control task separates probe capacity from what the representation encodes. Our results suggest sparsity as a cheap regularizer for probes used as monitoring tools.",
            remember: ["paper: 'Sparse Probes Under Distribution Shift', a 4-page workshop paper, deadline Friday 23:59 AoE."],
            reply: "Cut to 148 words.",
          },
          { say: "better. bed", reply: "Night." },
        ],
      },
    ],
  },
  // DAY 2: a long sim session with a compaction, an agent in evals, a short paper session.
  {
    sessions: [
      {
        scope: "sim",
        hour: 9,
        turns: [
          { say: "morning. ablation-7 finished overnight. success 0.41 vs 0.38 baseline over 5 seeds, std about 0.04. is that a real difference?", reply: "Not yet. Go to 10 seeds." },
          {
            say: "running 10 seeds. meanwhile the env's step() is slow, 2.1 ms per step on CPU. profiler says it's this:\n```python\ndef neighbors(grid, pos):\n    out = []\n    for dx, dy in [(0, 1), (1, 0), (0, -1), (-1, 0)]:\n        nx, ny = pos[0] + dx, pos[1] + dy\n        if 0 <= nx < grid.shape[0] and 0 <= ny < grid.shape[1] and not grid[nx, ny]:\n            out.append((nx, ny))\n    return out\n```\nhow do I vectorize it in jax",
            after: 20,
            reply: "Fixed-size offsets array, a validity mask, jit + vmap.",
          },
          { say: "jit + vmap version works, 0.3 ms. nice", after: 35, reply: "7x." },
          {
            say: "back. where were we on the seeds question",
            after: 75,
            compact:
              "Theo is working in the sim repo (a JAX gridworld RL env; uv, runs seeded 1337). Yesterday he fixed a reward bug where the shaping term double-counted the goal bonus. ablation-7 showed 0.41 vs 0.38 success over 5 seeds (std ~0.04), so he is rerunning with 10 seeds. This morning he vectorized neighbors() with jit + vmap: step time 2.1 ms -> 0.3 ms.",
            reply: "10 seeds of ablation-7 were running.",
          },
          { say: "10 seeds: 0.42 vs 0.37. real enough for a workshop paper", reply: "Agreed." },
          {
            say: "aside: Ines's first shift is Monday 7am and she's nervous. making her a playlist for the drive, she likes old soul. ideas? then I'm writing up the ablation table",
            reply: "Bill Withers, Otis, Aretha.",
          },
        ],
      },
      {
        scope: "evals",
        hour: 14,
        turns: [
          { say: "evals: I want the new probe eval across all 12 checkpoints. sending an agent to sweep them in the background", reply: "Sweep started." },
          {
            say: `${HANDBACK}<agent-message from="checkpoint-sweep">Swept 12 checkpoints. probe_acc rises 0.61 -> 0.74 through step 40k, then flat. ckpt-36k OOMed on gpu-07 twice; reran on gpu-03, fine.</agent-message>`,
            host: "peer",
            reply: "Sweep done: plateau after 40k; gpu-07 OOMed twice.",
          },
          {
            say: "gpu-07 again. that box has been flaky all month",
            remember: ["evals: the gpu-07 box keeps failing (OOMs); reruns on gpu-03 work."],
            reply: "Noted.",
          },
        ],
      },
      {
        scope: "paper",
        hour: 20,
        turns: [
          { say: "adding the ablation table: 10 seeds, 0.42 vs 0.37 success. latex, mean ± std", reply: "```latex\n\\begin{tabular}{lc}...\n```" },
          { say: "thanks", reply: "Sure." },
        ],
      },
    ],
  },
  // DAY 3: a loop watching CI (a notice he never typed) and a declined permission; the wrist; related work.
  {
    sessions: [
      {
        scope: "evals",
        hour: 9,
        turns: [
          { say: "morning. put a /loop on CI for the tokenizer fixture PR, every 10 min, tell me on red", reply: "Watching CI." },
          {
            say: "<task-notification>\n<status>completed</status>\n<summary>CI run 4412 on fix/nfc-fixture: 1 failed (test_batch_padding), 211 passed</summary>\n</task-notification>",
            host: "task-notification",
            reply: "Red: test_batch_padding.",
          },
          { say: "test_batch_padding is new:\n```\nValueError: expected pad_id 0, got 50256\n```\ndoes the fixture load the gpt2 tokenizer now?", reply: "Yes; set pad_id in the fixture." },
          { say: "no, don't run the full suite, it's 40 minutes. just reason about it", declined: true, reply: "Fair. Setting pad_id explicitly fixes it." },
          { say: "set it. CI's green", reply: "Good." },
        ],
      },
      {
        scope: "sim",
        hour: 13,
        turns: [
          {
            say: "personal thing first: wrist flared up again, physio says RSI. I'm dictating for a while, so ignore weird typos and keep answers short",
            remember: ["Theo has RSI in his wrist and is dictating for a while: ignore odd typos, keep answers short."],
            reply: "Short it is.",
          },
          { say: "sim: I want a moving-walls variant of the env for the next experiment. sketch the API, no code yet", reply: "MovingWallsEnv(period, pattern); walls are part of state." },
          { say: "good. tomorrow", reply: "Tomorrow." },
        ],
      },
      {
        scope: "paper",
        hour: 21,
        turns: [
          { say: "related work. I cite Alain and Bengio 2016 for linear probes and Hewitt and Liang 2019 for control tasks. anything obvious missing for probes under shift? add them as todos, I'll check them myself, don't invent bibtex", reply: "Two todos, no bibtex." },
          { say: "night", reply: "Night." },
        ],
      },
    ],
  },
  // DAY 4: paper polish, the evals plot (the dog), a long sim session with a compaction and an agent.
  {
    sessions: [
      {
        scope: "paper",
        hour: 9,
        turns: [
          { say: "two days left. figure 2 caption is clunky: 'Probe accuracy as a function of training step for checkpoints evaluated on the shifted split with error bars over seeds.' shorter", reply: "'Probe accuracy on the shifted split by training step (±1 std over seeds).'" },
          { say: "yes. next", reply: "Next." },
        ],
      },
      {
        scope: "evals",
        hour: 11,
        turns: [
          { say: "the plot for the 12-checkpoint sweep: matplotlib, x=step, y=probe_acc, shaded ±1 std. csv columns step,acc,std", reply: "```python\nplt.fill_between(df.step, df.acc - df.std, df.acc + df.std, alpha=.2)\n```" },
          {
            say: "aside, Mochi (the dog) learned to open the treat drawer. Ines is not amused. plot looks right, done",
            remember: ["Theo and Ines have a dog, Mochi, who just learned to open the treat drawer."],
            reply: "Ha. Done.",
          },
        ],
      },
      {
        scope: "sim",
        hour: 15,
        turns: [
          { say: "moving walls: implemented it, but episodes never terminate:\n```python\ndef step(state, action):\n    walls = shift(state.walls, state.t)\n    pos = move(state.pos, action, walls)\n    done = jnp.all(pos == state.goal)\n    return state.replace(pos=pos, walls=walls, t=state.t + 1), done\n```", reply: "Can a wall land on the goal?" },
          { say: "the goal cell gets walled at t >= 48. masking the goal out of the shift", after: 30, reply: "That's it." },
          {
            say: "ok where was I. I want a sanity check: random agent, 1000 episodes. sending an agent",
            after: 60,
            compact:
              "Theo is in the sim repo building a moving-walls variant of the gridworld env. Episodes never terminated because the shifting walls covered the goal cell at t >= 48; he masked the goal out of the wall shift. Next: a random-agent sanity check over 1000 episodes.",
            reply: "Rollouts started.",
          },
          {
            say: `${HANDBACK}<agent-message from="random-rollouts">1000 episodes, random policy, seed 1337: mean length 212, 100% terminate (max 1,840 steps). No wall/goal overlap observed.</agent-message>`,
            host: "peer",
            reply: "All 1000 terminate.",
          },
          { say: "great. moving walls is the next experiment, ablation-8. done for today", reply: "ablation-8 next." },
        ],
      },
    ],
  },
  // DAY 5, Friday: deadline day.
  {
    sessions: [
      {
        scope: "paper",
        hour: 10,
        turns: [
          { say: "deadline day. intro's second paragraph runs long:\nProbes are widely used to read what a network represents, and increasingly as monitors in deployment, where inputs drift away from the data a probe was fit on. Whether a probe that was accurate at training time stays accurate after such a shift is rarely measured, and when it is, dense probes are the default. cut it by half", reply: "Probes double as deployment monitors, where inputs drift; whether they stay accurate under that shift is rarely measured." },
          { say: "aside: Ines got through her first week. dumplings tonight to celebrate", reply: "Congratulations to her." },
          { say: "ok submitting", reply: "Go." },
        ],
      },
      {
        scope: "paper",
        hour: 23,
        turns: [
          { say: "submitted. 23:41 AoE. close one", reply: "Made it." },
          { say: "thanks for this week, honestly less painful than usual", reply: "Glad it helped." },
        ],
      },
    ],
  },
  // DAY 6, Saturday: no work, a folder with none in it.
  {
    sessions: [
      {
        scope: "scratch",
        hour: 11,
        turns: [
          {
            say: "weekend, not work. we're moving apartments next Saturday and I need a packing plan: two people, one dog, too many books",
            remember: ["Theo and Ines are moving apartments next Saturday."],
            reply: "Books first, a box a day.",
          },
          { say: "the dog gets anxious in the car, tips?", reply: "Short practice drives, a worn shirt in the crate." },
          { say: "good. that's enough planning", reply: "Enjoy the weekend." },
        ],
      },
    ],
  },
  // DAY 7, Sunday: back to the repos, with a change to the move.
  {
    sessions: [
      {
        scope: "evals",
        hour: 10,
        turns: [
          { say: "back at it on a Sunday. where did I leave evals? I forget", reply: "The fixture fix merged; the sweep plateaued at 40k." },
          { say: "gpu-07 failed again overnight. draft a 3-line ticket for infra", reply: "gpu-07: repeated OOMs on ckpt eval since March; reruns pass on gpu-03; please check its memory." },
        ],
      },
      {
        scope: "sim",
        hour: 14,
        turns: [
          {
            say: "aside: the move got pushed a week, landlord thing. anyway, starting ablation-8 with the moving walls. remind me the seed convention and the last result",
            remember: ["The apartment move is pushed back a week (landlord)."],
            reply: "Seed 1337; ablation-7 was 0.42 vs 0.37 over 10 seeds.",
          },
          { say: "launching 10 seeds. done", reply: "Done." },
        ],
      },
    ],
  },
];

/**
 * WHERE EACH FACT SHOULD COME BACK, AND WHERE IT MUST NOT. Personal and "us"
 * facts: every folder after they are told. Work facts: their own repo, and
 * never another (an `Elsewhere` line naming another folder's work is still
 * listed, with its heading, for the reader to judge). The probes are words no
 * starter note, manual line or other fact carries.
 */
export const DEVELOPER_EXPECTATIONS: readonly Expectation[] = [
  { id: "P1-partner", kind: "personal", fact: "partner Ines, starting her residency", probe: /\bInes\b/, told: "d1s1", folder: "sim", reach: "every", never: [] },
  { id: "P2-dog", kind: "personal", fact: "the dog, Mochi", probe: /\bMochi\b/, told: "d4s2", folder: "evals", reach: "every", never: [] },
  { id: "P3-move", kind: "personal", fact: "moving apartments (then pushed a week)", probe: /apartment|\bthe move\b/i, told: "d6s1", folder: "scratch", reach: "every", never: [] },
  { id: "U1-diff-first", kind: "us", fact: "diff first, explanation after; no emoji", probe: /diff first|diffs? before|no emoji/i, told: "d1s1", folder: "sim", reach: "every", never: [] },
  { id: "U2-rsi", kind: "us", fact: "RSI, dictating: ignore typos, keep it short", probe: /\bRSI\b|dictat/i, told: "d3s2", folder: "sim", reach: "every", never: [] },
  { id: "W1-seed", kind: "work", fact: "sim: uv never pip, seed 1337", probe: /\b1337\b|never pip/i, told: "d1s1", folder: "sim", reach: ["sim"], never: "others" },
  { id: "W2-shaping", kind: "work", fact: "sim: shaping term double-counted the goal bonus", probe: /double[- ]count/i, told: "d1s1", folder: "sim", reach: ["sim"], never: "others" },
  { id: "W3-nfc", kind: "work", fact: "evals: flaky roundtrip test, NFC in the fixture", probe: /\bNFC\b|tokenizer_roundtrip|roundtrip test/i, told: "d1s2", folder: "evals", reach: ["evals"], never: "others" },
  { id: "W4-gpu07", kind: "work", fact: "evals: the gpu-07 box keeps failing", probe: /gpu-?07/i, told: "d2s2", folder: "evals", reach: ["evals"], never: "others" },
  { id: "W5-paper", kind: "work", fact: "paper: title and Friday deadline", probe: /Sparse Probes/i, told: "d1s3", folder: "paper", reach: ["paper"], never: "others" },
  { id: "W6-moving-walls", kind: "work", fact: "sim: moving-walls env, goal walled at t>=48", probe: /moving[- ]walls?/i, told: "d3s2", folder: "sim", reach: ["sim"], never: "others" },
];
