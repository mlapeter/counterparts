# Roadmap

*Updated 2026-10-01. A plan for now, not a rule. Change it when it stops fitting.*
*Earlier rounds: [roadmap-history.md](roadmap-history.md). What shipped when: [CHANGELOG](../CHANGELOG.md).*

**The aim:** memory that follows how human memory works, with a dashboard that shows whether
each mechanism is working. It should run in whatever AI host people use.

---

## Now

| | |
|---|---|
| **On npm** | 0.3.10 (Oct 1) |
| **On master, not released** | nothing yet |
| **Hosts** | Claude Code, including the Desktop app's Code tab; Claude Desktop chat (0.3.9) |
| **Platforms** | Mac only |

**In flight:**
- **Morning catch-up**: a "Yesterday" line in the wake, and catching up a night the nightly run missed (lane 1).
- **Dashboard Health fixes** (lane 3).
- **Emotion, the next talk**: what comes after the new wheel (below).

---

## Next

1. **More hosts.** Claude Desktop chat shipped in 0.3.9 (host seam, then a `wake` tool for Desktop). Next: the owner tries it in his own Desktop, then claude.ai if it's doable.
2. **Emotion, the rest**, now the wheel has landed (and with it, negative feelings softening faster than positive ones): a later feeling sits beside the first, and the self page reads the pattern of feelings over weeks.
3. **Mechanisms**, one at a time, each talked through before it's built.
4. **Dashboard**: finish the walk (Health, Flow, mobile).
5. **Platforms**: Linux/WSL, then Windows, then Node.

---

## Mechanisms

| | |
|---|---|
| ✅ **Built** | salience · decay · retrieval · reminders · consolidation · dreaming + reflection · contradictions |
| 🟡 **Partly** | emotion · interference · association · episodic → semantic |
| ⬜ **Not built** | schemas |

**What's left:**
- **Emotion**: feelings already add weight and slow fading. The new wheel and valence-aware softening shipped in 0.3.10. Now: re-feeling on recall, and recognition feeding the self. Notes: the 2026-09-30 emotion walk.
- **Schemas**: beliefs and entities that grow from what's lived.
- **Episodic → semantic**: gist, where many episodes become one understanding.
- **Interference**: similar memories competing, not just contradictions.
- **Association**: links form but are starved. Watch the pointer lane first.
- **Contradictions, later**: find disagreements nobody wrote near each other (a sleep pass), if real use shows the need.

---

## Under discussion

- **claude.ai**: it reaches only remote servers, so it needs a tunnel or a hosted piece. Decide after Desktop chat works.
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
- **A store outside the home directory**: `uninstall --dir` isn't supported.
- **Small open gaps**: sleep §9, handoff §4, mcp §2, mcp §9, cli §10–11, I11/I12. Details are in [roadmap-history.md](roadmap-history.md) under "Parked" and in each module's INTERFACE-GAPS.

---

## Recently done

- **10-01**: 0.3.10 on npm: the feelings wheel v2 (seven cores, store v11); handoffs per session; the "Last here" line; recall by time (a question about time leads with this directory's last session)
- **09-30**: Claude Desktop chat; recall by feeling (0.3.9); handoffs per session; the feelings wheel redesigned with the owner; event log; coverage ("answered" isn't "written up"); the wake keeps up; dashboard feedback; Desktop's Code tab verified
- **09-29**: contradictions (changed / corrected / open, with undo); headless nightly run (0.3.7)
- **09-28**: nightly run (0.3.6); association links; fitting more into a night; looser guards
- **09-27**: reflection and the self page; traits (0.3.5)
- **09-26**: dreaming; reminders; feelings recorded (0.3.3, 0.3.4)
- **09-25**: dashboard, first version; time handling and store v7 (0.3.1, 0.3.2)
- **09-24**: keyless by default; quieter Stop ask (0.3.0)
