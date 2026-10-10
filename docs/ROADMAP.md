# Roadmap

*Updated 2026-10-09. A plan for now, not a rule. Change it when it stops fitting.*
*Earlier rounds: [roadmap-history.md](roadmap-history.md). What shipped when: [CHANGELOG](../CHANGELOG.md).*

**The aim:** memory that follows how human memory works, with a dashboard that shows whether
each mechanism is working. It should run in whatever AI host people use.

---

## Now

| | |
|---|---|
| **On npm** | 0.3.15 (Oct 10) |
| **On master, not released** | nothing yet |
| **Hosts** | Claude Code; the Desktop app's Code tab (verified live 10-02); Claude Desktop chat (0.3.9) |
| **Platforms** | Mac and Linux, under bun or Node 22.15+ (0.3.11); the plugin with neither, as one downloaded program (0.3.14). Not Windows. |

**In flight:**
- **The association walk**: links form but are starved; diagnose why before building anything.

---

## Next

1. **More hosts**: claude.ai, if it's doable (see Under discussion).
2. **Emotion, what's left**: watch feelings over weeks and re-feeling awake in real use (both built, 0.3.12). Coverage is no longer a thread: about 11% of memories carry a feeling, and that is expected.
3. **Mechanisms**, one at a time, each talked through before it's built: association first (above).
4. **Dashboard**: finish the walk (Health, Flow, mobile).
5. **Platforms**: Windows (WSL first).

---

## Mechanisms

| | |
|---|---|
| ✅ **Built** | salience · decay · retrieval · reminders · consolidation · dreaming + reflection · contradictions |
| 🟡 **Partly** | emotion · interference · association · episodic → semantic |
| ⬜ **Not built** | schemas |

**What's left:**
- **Emotion**: built: feelings add weight and slow fading; the seven-core wheel; valence-aware softening (negative fastest, positive slowest); a later feeling beside the first, from reflection (0.3.10); feelings over weeks in the reflection, and re-feeling an old memory awake (#317, 0.3.12). Left: see Next #2. Notes: the 2026-09-30 emotion walk.
- **Schemas**: beliefs and entities that grow from what's lived.
- **Episodic → semantic**: gist, where many episodes become one understanding.
- **Interference**: similar memories competing, not just contradictions.
- **Association**: links form but are starved. The walk is in flight: diagnose first.
- **Contradictions, later**: find disagreements nobody wrote near each other (a sleep pass), if real use shows the need.

---

## Under discussion

- **claude.ai**: it reaches only remote servers, so it needs a tunnel or a hosted piece. Desktop chat shipped in 0.3.9, so this is the next host to decide on.
- **The site as public roadmap**: counterparts.ai should mirror this page. Not set up yet.
- **The nightly run's timing**: it runs at the day's first prompt now. A real night run would need a scheduler.
- **Dates written into memories' words**: why it happens, and whether to fix it at write time.

---

## Ideas (not scheduled)

- **"Her"-style onboarding**: a first conversation that seeds the first memories.
- **A journal entry per new model**, drawing on its system card.
- **A short check-in in the wake**: "how am I feeling, what do I need today".
- **Balance across projects**: context-weighted recall that never becomes silos.
- **Interactive `counterparts ask`**: arrow keys to move, Enter to expand.

---

## Parked

- **Flat dashboard sketch**: the owner's exploratory branch `dashboard/flat`.
- **Three-way identity study**: run it a second time before any write-up.
- **Confidential memories (frozen 2026-10-02)**: the confidentiality gate came over from v1, but no tool can mark a memory confidential and the live store holds none. It still runs through about 48 files. Leave it as it is, build nothing new around it, and don't block a review on it. The plan is to review it and remove it later, unless a real need for it turns up first.
- **A store outside the home directory**: `uninstall --dir` isn't supported.
- **Small open gaps**: sleep §9, handoff §4, mcp §2, mcp §9, cli §10–11, I11/I12. Details are in [roadmap-history.md](roadmap-history.md) under "Parked" and in each module's INTERFACE-GAPS.

---

## Recently done

- **10-10**: 0.3.15 on npm: the self page is never cut in the wake (#358); one delivery per event when the plugin and the npm install are both wired, the claims in a file of their own (#355, #359); `connect` and `install` rewrite Claude Desktop's entry and doctor reads it, so Desktop users run `counterparts connect` once (#354, #356); a yearless "by 1/5" in late December is the coming January (#356); the sidebar mod in the plugin (#342); CI runs the whole suite (#357); RELEASING.md (#356); no store-format change
- **10-09**: 0.3.14 on npm: the plugin runs with no Bun or Node, as one prebuilt program per platform (#351); a project's `.env` and `bunfig.toml` stay out of the hooks and the server, so npm users run `counterparts connect` once (#349); the wake keeps "Still open" beside a long page and says when a reminder was due (#350); facts names corrected versions, reads amounts and "by 12/20" right, meaning says when a name has no card (#345, #347, #348, #352); dashboard and doctor follow-ups (#343, #346, #347); no store-format change
- **10-09**: 0.3.13 on npm: dates that repeat, and corrections held when they look unrelated (#339–#341); facts reads "last Saturday" and "before 7/22", meaning answers about the person asked about, the dashboard's Ask in both modes (#333, #334, #338); doctor without false alarms on Fired and Wake, and the night checks its own transcript (#325, #330, #337); the Claude Code plugin (#328); no store-format change
- **10-08**: 0.3.12 on npm: recall's two modes, facts and meaning, and what a memory records (#321–#323, store v12); with 10-02's work below
- **10-02**: on master: one measured ceiling for tool results (#315); feelings round 3 (#317); follow-ups after 0.3.11 (#318); the Desktop app's Code tab verified live
- **10-01**: 0.3.11 on npm: the morning catch-up and "Yesterday" line; "Work here" vs Nearby; Node 22.15+ and Linux; the Code tab files under its own session; recall by feeling, round 2; dashboard Health fixes (#306)
- **10-01**: 0.3.10 on npm: the feelings wheel v2 (seven cores, store v11); handoffs per session; the "Last here" line; recall by time (a question about time leads with this directory's last session)
- **09-30**: Claude Desktop chat; recall by feeling (0.3.9); handoffs per session; the feelings wheel redesigned with the owner; event log; coverage ("answered" isn't "written up"); the wake keeps up; dashboard feedback; Desktop's Code tab verified
- **09-29**: contradictions (changed / corrected / open, with undo); headless nightly run (0.3.7)
- **09-28**: nightly run (0.3.6); association links; fitting more into a night; looser guards
- **09-27**: reflection and the self page; traits (0.3.5)
- **09-26**: dreaming; reminders; feelings recorded (0.3.3, 0.3.4)
- **09-25**: dashboard, first version; time handling and store v7 (0.3.1, 0.3.2)
- **09-24**: keyless by default; quieter Stop ask (0.3.0)
