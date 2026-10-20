# Roadmap

*Updated 2026-10-20. A plan for now, not a rule. Change it when it stops fitting. Details: [WORKLIST](WORKLIST.md).*
*Earlier rounds: [roadmap-history.md](roadmap-history.md). What shipped when: [CHANGELOG](../CHANGELOG.md).*

**The aim:** memory that follows how human memory works closely enough that the AI living in it has
a self of its own: earned from what it lived, legible to its owner, and portable across hosts and
models. A dashboard shows whether each mechanism is working. It runs in whatever AI host people use.

---

## Now

| | |
|---|---|
| **On npm** | 0.3.27 (Oct 19) |
| **On master, not released** | nothing yet |
| **Hosts** | Claude Code; the Desktop app's Code tab (verified live 10-02); Claude Desktop chat (0.3.9) |
| **Platforms** | Mac and Linux, under bun or Node 22.15+ (0.3.11); the plugin with neither, as one downloaded program (0.3.14). Not Windows. |

---

## To do

*One line each; the details, and where each stands, are in [WORKLIST](WORKLIST.md). Experiments waiting on a
check are in [CHECK-AFTER](CHECK-AFTER.md).*

**Being built:**
- The reflection closes threads that are plainly done, across folders, and says so (F1, #535)
- Wake fixes: each session named once, one top tag, no bare ids, Coming up shows ids (F2)
- A weekly reminder marked done for this week only; drewOn credit for a just-superseded memory (F6, F6b)
- Reading a dream's or reflection's record from a session (F7)

**Next, after those:**
- Sessions see what other open sessions wrote (F4, after F2)
- The self page held to its room (F5, after F1)

**Checks coming up:** 0.3.27's seven experiments ~10-22 · lists vs attachments 10-22 · F1 ~10-24 ·
10-18's benchmark-motivated changes ~10-25 · F6 10-27 · emotion's weight 11-01 · forgetting resumes late October

**Needs a talk:**
- Lists vs attachments, and the notes module (recommended next: it leaves the running experiments alone)
- Dream throughput (after ~10-22) · schemas with gist
- The decisive memory staying quiet at the moment of action, with footnote noise (F3, at the ~10-22 check)
- Retiring the 10-10 "Decisions to review" walk in IMPROVEMENTS

**Elsewhere:** the plugin directory approval and whether to post without it (10-21) · the site's SEO push

---

## The plan

*No dates. Time isn't the limit; planning and delegation are. Work runs in waves of parallel lanes,
each from a brief talked through first, each naming the number it moves and how to revert. Every
choice below is a starting point, revised when real use says so.*

**What's wrong today.** Every stage of the human memory loop exists here: encode, recall, use,
strengthen, consolidate, abstract, self. The junctions leak. Use barely strengthens anything
(about 3% of shown memories are credited, 18% are rated useful). Episodes barely become
understanding (about 8 gists a week; the dream reaches about 1 in 10 new memories). And the self
page is rewritten nightly from core nominations in a model's prose rather than grown from what was
lived. The five threads under Mechanisms say the same in more detail.

**The idea that organizes the plan.** Beliefs that grow from what's lived, about people and
projects, and "who am I becoming," about the self, are one mechanism applied to two subjects. Build
it once and the self is its first customer: a core made of beliefs with strength, support and
history, earned by physics rather than written by the night.

**Wave 1: see faster, measure, reread the rules.**
- *A simulation harness*, built as a second host against the public seams: replay recorded days on a
  snapshot copy with a simulated clock, so a two-week question is answered in an hour. Three
  subjects: the owner's own record, a fresh start (what a new user's first week does), and a
  fictional character (below). Dev-only, never shipped.
- *The seat as a protocol*: the model that does the memory work (reads the wake, rates, writes the
  session end, dreams, reflects) becomes one interface any host or model can fill. Claude Code is
  one way to fill it; the harness is another. Invisible to users; what makes the self portable.
- *Two self measures*: traceability (does each claim on the self page rest on a memory) and support
  (how much lived experience stands behind each core element, over how long), as doctor lines; the
  page's layers over time on the dashboard.
- *A rules audit*: every rule still steering behavior that was decided before real use, with the
  evidence from use beside it, for one batch of decisions. Reads, changes nothing.
- *Meanwhile*: the notes module (exact records out of the counterpart's own memory), dream
  throughput, and one calibration pass across all mechanisms against measured rates.

**Wave 2: semantic memory, self included.** Beliefs born from episodes, attached to people and
projects, strength-weighted, revisable with history, visible on the dashboard. The core becomes
beliefs about the self on the same machinery and the page renders from them. Similar memories
competing at recall. One batched store migration.

**Wave 3: the counterpart in time, and portable.** A profile describes; a self intends.
Intentions the counterpart authors (things to raise, try, hold), the reflection ending with what it
wants tomorrow and checking itself the next night, felt time. Calibrated confidence: known from the
record versus guessed. Other models in the seat; claude.ai as a host once the seat is a protocol.

**A benchmark that tests what memory is for.** Today's benchmarks ask questions about transcripts
that fit in context. Ours: build a counterpart from the first half of a book, with the character's
memories, feelings and self, then let it live the second half with the rest of the cast scripted.
It scores what the character knew and didn't, what it remembered when it mattered, and whether it
stayed itself. The harness runs it. The control is the whole first half in context.

**The end state.** In the brain there is no separate store: memory is the weights. The hippocampus
keeps episodes and teaches the cortex by replay during sleep. Counterparts today is a hippocampus
with a frozen cortex. The end state combines it with an open-weight model that learns nightly from
what the night chose, one dated and droppable change per night, with the store staying the legible
record that can raise a new model when a better base arrives. It comes after the loop closes on
rows and the harness can measure a seat.

**Also, when they fit:** emotion in real use (feelings over weeks, re-feeling awake); the dashboard
walk (Health, Flow, mobile); Windows (WSL first).

---

## Mechanisms

*Where each stands, read 2026-10-19 on the owner's store (0.3.26, lived day 28) from `counterparts mechanisms`, doctor, CHECK-AFTER and the 10-18 association diagnosis.*

| | |
|---|---|
| ✅ **Working, watch only** | salience · reminders · contradictions · consolidation · forgetting |
| 🔧 **Working, needs a pass** | retrieval · dreaming · emotion (tuning) |
| 🟡 **Partly** | association · interference · episodic → semantic (gist) |
| ⬜ **Not built** | schemas |

**Working, watch only:**
- **Salience**: every memory scored at write (462 in the last 7 days).
- **Reminders**: 33 came back in the last 7 days (12 said plainly, 21 as footnotes).
- **Contradictions**: 111 settled in 7 days, 0 open. Later, if real use asks: find disagreements nobody wrote near each other (a sleep pass).
- **Consolidation**: returns slow fading; 3 memories became core this week. Returns this week: awake 105, reflection 47, dream 40, so the nightly passes supply nearly half.
- **Forgetting**: 834 memories below reach, 1 archived. Expected: 0.3.24 restarted the 14-lived-day wait, so archiving resumes around late October. Watch it then.

**Working, needs a pass:**
- **Retrieval**: works, quality uneven. Footnotes rated 0–3 at the session's end (288 so far): 47% noise, 35% on topic but not needed, 18% useful or changed what was said. The two benchmark-found gaps, no meaning channel on a session's first prompt and bake/bakes/baking read as different words, are fixed in 0.3.27 (#521, #529); check ~10-22.
- **Dreaming**: works, but takes about 40–55 new memories a night by priority; the queue holds at 400–590 since about 10-10, the tail fading out on its own. On a busy day about 1 in 10 new memories is ever dreamed. Open: whether that's enough.
- **Emotion**: built (weight, slower fading, the seven-core wheel, valence-aware softening, later feelings, feelings over weeks, re-feeling awake). Its weight runs about ×11 slower fading at a strong feeling vs the ×2.8 the review designed; kept on purpose, rechecked 2026-11-01. Mood-matched recall stays off.

**Partly:**
- **Association**: about 9,500 links, and none has ever brought a memory to mind. Every link is far below either threshold, and nothing strengthens them: a link needs about four uses inside a month, and use is rarely credited (below). The hop channel can't change what's shown by construction. Decided 10-19 and in 0.3.27 as experiments: co-use links, no links at store time, priming along links (#525, #528, #530); check ~10-22.
- **Interference**: near-copies merge and a newer state replaces an older one; similar memories competing for recall isn't built.
- **Episodic → semantic**: dreams write about 8 gists a week; many episodes becoming one understanding happens only by chance.

**Not built:**
- **Schemas**: beliefs and entities that grow from what's lived.

**What connects them:** about 3% of shown memories are credited as used (opened by id, quoted, or named in `drewOn`), while 18% are rated useful. Use is what strengthens a memory and its links, so the gap starves association and leaves consolidation leaning on the nightly passes. "What counts as use" is the first mechanism conversation.

**Big-picture threads (2026-10-19), walked one at a time:**
1. **The loop between using a memory and keeping it is mostly open.** Recall runs every turn; almost nothing it shows is credited, so the day barely teaches the system.
2. **The night stands in for the day.** Nearly half the strengthening comes from the dream and reflection rather than lived use.
3. **Recall quality bounds everything downstream.** Use, links and consolidation all flow through what comes to mind.
4. **Each mechanism was tuned alone.** One calibration pass against measured rates (one owner, ~10 sessions a day) beats retuning one at a time.
5. **Almost everything is episodic.** Notes (exact records) and schemas (beliefs that grow) are the missing layers.

Rethinking (owner, 2026-10-19, lightly held): "shown strengthens nothing" was a guard against rich-get-richer for new users. That worry is separate and doesn't outweigh getting the whole system working; feedback between layers, both ways, is the aim.

---

## Under discussion

- **claude.ai**: it reaches only remote servers, so it needs a tunnel or a hosted piece. Wave 3, once the seat is a protocol; the tunnel-or-hosted choice is still open.
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
- **Three-way identity study**: run it a second time before any write-up; the seat protocol makes it a same-store, different-seat run.
- **Confidential memories (frozen 2026-10-02)**: the confidentiality gate came over from v1, but no tool can mark a memory confidential and the live store holds none. It still runs through about 48 files. Leave it as it is, build nothing new around it, and don't block a review on it. The plan is to review it and remove it later, unless a real need for it turns up first.
- **A store outside the home directory**: `uninstall --dir` isn't supported.
- **Small open gaps**: sleep §9, handoff §4, mcp §2, mcp §9, cli §10–11, I11/I12. Details are in [roadmap-history.md](roadmap-history.md) under "Parked" and in each module's INTERFACE-GAPS.

---

## Recently done

- **10-19**: 0.3.27 on npm, recall that learns from use, most of it experiments to check ~10-22: a session's first prompt matched by meaning, facts ignore quantity words (#521); footnotes skip what this session wrote, the dream replays what the day used, the nightly run's sessions get no footnotes (#523); footnote ratings count as use, memories used together linked strongly, a memory rated 0 twice surfaces less, doctor's Feedback loop line (#525); a newer memory stands in for the one it replaced (#526); no links written at store time, the slot detector flags only (#528); light stemming and everyday words count less (#529); context priming along links and a train-of-thought vector (#530); no store migration (store v13), cache v6 to v7 re-indexes words once in the background; going back to 0.3.26 needs the cache deleted and rebuilt
- **10-18**: 0.3.26 on npm: "Still open" leads with what was touched in the last 14 lived days and counts the untouched, a stale handoff says its staleness in one sentence and only the newest shows whole when all are stale, the Yesterday line names folders (#517); "Today, elsewhere" dates a session started on an earlier day (#513); doctor's Fired line reads mood matching as disabled (#515); facts say a coarse date may be inside the time asked (#516); no store-format change, nothing to run after upgrading from 0.3.25
- **10-16**: 0.3.25 on npm: a chapter is stood for by a summary memory that fades, not a full copy; the `chapter` tool takes `summary`, the engine writes one when none is given (#504); the nightly reflection proposes closing stale open items and the reflect tool's `close` phase closes them on the owner's yes (#507); the wake lists long items as one line (#508) and is trimmed: one tag line, the date once, a shorter header, the page written to 4,600 bytes, craft out, Coming up = due today (#511); recall's rolling "last month"/"past N months" and weekdays in facts dates (#510); the sidebar says where you left off, its fox tries a picture first, its clickable rows are back in the full flavor, and the directory build stands down beside the npm install (#498, #499, #500, #501, #505, #509); no store-format change, nothing to run after upgrading from 0.3.24
- Earlier: [roadmap-history.md](roadmap-history.md) under "Recently done, before 10-16".
