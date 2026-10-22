# Roadmap

*Updated 2026-10-20. A plan for now, not a rule. Change it when it stops fitting. Details: [WORKLIST](WORKLIST.md).*
*Earlier rounds: [roadmap-history.md](roadmap-history.md). What shipped when: [CHANGELOG](../CHANGELOG.md).*

**The aim:** memory that follows how human memory works, with a dashboard that shows whether
each mechanism is working. It should run in whatever AI host people use.

---

## Now

| | |
|---|---|
| **On npm** | 0.3.31 (Oct 22) |
| **On master, not released** | nothing yet |
| **Hosts** | Claude Code; the Desktop app's Code tab (verified live 10-02); Claude Desktop chat (0.3.9) |
| **Platforms** | Mac and Linux, under bun or Node 22.15+ (0.3.11); the plugin with neither, as one downloaded program (0.3.14). Not Windows. |

---

## To do

*One line each; the details, and where each stands, are in [WORKLIST](WORKLIST.md). Experiments waiting on a
check are in [CHECK-AFTER](CHECK-AFTER.md).*

**Next:** follow-ups in [WORKLIST](WORKLIST.md) (scopes off for folders kept apart, the plugin-split messages, same-session
neighbours after the bench measures the tail)

**Checks coming up:** 0.3.27's seven experiments ~10-22 · lists vs attachments 10-22 · F4 ~10-23 · F1 ~10-24 · personal news across folders ~10-24 ·
10-18's benchmark-motivated changes ~10-25 · F6 10-27 · emotion's weight 11-01 · forgetting resumes late October

**Needs a talk:**
- Notes and schemas, designed together (brief: `~/counterparts-notes/2026-10-20-notes-and-schemas-brief.md`), with lists vs attachments
- Dream throughput (after ~10-22)
- The decisive memory staying quiet at the moment of action, with footnote noise (F3, at the ~10-22 check)

**Elsewhere:** the plugin directory approval and whether to post without it (10-21) · the site's SEO push

---

## Later

1. **More hosts**: claude.ai, if it's doable (see Under discussion).
2. **Emotion, what's left**: watch feelings over weeks and re-feeling awake in real use (both built, 0.3.12). Coverage is no longer a thread: about 11% of memories carry a feeling, and that is expected.
3. **Mechanisms**, one at a time, each talked through before it's built: the notes module, dream throughput, then schemas with gist. (What counts as use and association went into 0.3.27 as experiments.)
4. **Dashboard**: finish the walk (Health, Flow, mobile).
5. **Platforms**: Windows (WSL first).

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
- **Confidential memories (removed 2026-10-21, Mike's call)**: the gate that came over from v1 is gone in three pull requests shipped in one release — core and MCP behaviour, the adapters (dashboard, sidebar, export, CLI), then the leftover types (all three merged). The `confidential` column was dropped at store v14 (2026-10-21, wave 2's one bump), after the rows still marked were counted.
- **A store outside the home directory**: `uninstall --dir` isn't supported.
- **Small open gaps**: sleep §9, handoff §4, mcp §2, mcp §9, cli §10–11, I11/I12. Details are in [roadmap-history.md](roadmap-history.md) under "Parked" and in each module's INTERFACE-GAPS.

---

## Recently done

- **10-22**: 0.3.31 on npm, wave 2: store v14 with room for tags, beliefs and their support, folder projects and what recall showed, people and places marked among cards, the confidential column dropped after counting (#569); tags at `remember` and `session_end` (#570); the dashboard's subjects tab and tag cloud (#573); beliefs earned from memories, formed by the reflection and suggested by the dream, shown nowhere yet (#575, #577, #583); folders joined into one project and craft that travels (#572), the night asks about a folder join (#580), another project's work a little harder to recall (#579); the night tidies tags on a small model (#576); one nightly cycle at a time per store (#581) and no more twin cards (#578); store v14, restart everything after upgrading from 0.3.30, `counterparts rollback` is the way back
- **10-21 (afternoon)**: 0.3.30 on npm: confidential memories removed, nothing held back, doctor amber only while recorded ones remain, `export --include-confidential` accepted and ignored this release, the confidential API gone for embedders (#564, #565, #571); the yours/guest split removed: any session, Desktop chats and the night run included, closes a thread or reminder by id from any folder and gets "Last said here", `owner` / `--owner` / `COUNTERPARTS_OWNER` accepted and ignored, observer unchanged (#568); night children run with `--no-session-persistence`, so no Claude Code transcript is kept (#574); a test fix (#567); harness compare and a second scripted week, dev-only (#563, #566); no store-format change, nothing to run after upgrading from 0.3.29
- **10-21**: 0.3.29 on npm, mostly experiments: personal news flows across folders, the reflection offered 24 unmarked memories a night (was 5), personal-looking first, marks said in the share, a folder set off or paused keeps its work, the `about` field says what a mark does (#558); the sidebar's fox at work while Claude's turn runs (#549); the self page keeps cites per claim, doctor's "Self page claims" and "Core" lines, `core --list` support, the dashboard's page in layers (#550); mechanism proofs count dream folds and band rises, fold settles off Reconsolidation, the exact-copy merge reworded (#555); the night asks a seat, `Seat` exported, no behavior change (#556); contracts guide the work without limiting it, constitution line 13 (#553); the lane-1 harness, dev-only (#557, #559, #560); no store-format change, nothing to run after upgrading from 0.3.28
- **10-20**: 0.3.28 on npm, mostly experiments to check ~10-22 to ~10-27: the nightly reflection closes plainly done threads and says so in the share, `reopen` by the thread id (#535); recall opens dream and reflection ids, `counterparts night` reads them and writes nothing (#538); "done" at a repeating reminder closes this occurrence only, a done memory beside a due reminder gets a hint, drewOn credits a memory replaced that day (#540); the wake without repeats, one tag at its head (`meet=` and `store=` in it), Coming up items carry their own id, the daily snapshot claimed (#536); the nightly writers held to the self page's 4,600-byte room, the wake shows a long page's short version (#541); the reflection answers core memories that waited 7+ lived days, doctor counts them, an owner retire is sticky (#542); facts list the next 20 matches by title and "lately" orders by recency (#544); "Today, elsewhere", "Since you started" and "Here, also open" name other sessions' work by title (#543); the fox follows activity (#545); the plugin must update with this core; no store-format change, nothing to run after upgrading from 0.3.27
- **10-19**: 0.3.27 on npm, recall that learns from use, most of it experiments to check ~10-22: a session's first prompt matched by meaning, facts ignore quantity words (#521); footnotes skip what this session wrote, the dream replays what the day used, the nightly run's sessions get no footnotes (#523); footnote ratings count as use, memories used together linked strongly, a memory rated 0 twice surfaces less, doctor's Feedback loop line (#525); a newer memory stands in for the one it replaced (#526); no links written at store time, the slot detector flags only (#528); light stemming and everyday words count less (#529); context priming along links and a train-of-thought vector (#530); no store migration (store v13), cache v6 to v7 re-indexes words once in the background; going back to 0.3.26 needs the cache deleted and rebuilt
- **10-18**: 0.3.26 on npm: "Still open" leads with what was touched in the last 14 lived days and counts the untouched, a stale handoff says its staleness in one sentence and only the newest shows whole when all are stale, the Yesterday line names folders (#517); "Today, elsewhere" dates a session started on an earlier day (#513); doctor's Fired line reads mood matching as disabled (#515); facts say a coarse date may be inside the time asked (#516); no store-format change, nothing to run after upgrading from 0.3.25
- **10-16**: 0.3.25 on npm: a chapter is stood for by a summary memory that fades, not a full copy; the `chapter` tool takes `summary`, the engine writes one when none is given (#504); the nightly reflection proposes closing stale open items and the reflect tool's `close` phase closes them on the owner's yes (#507); the wake lists long items as one line (#508) and is trimmed: one tag line, the date once, a shorter header, the page written to 4,600 bytes, craft out, Coming up = due today (#511); recall's rolling "last month"/"past N months" and weekdays in facts dates (#510); the sidebar says where you left off, its fox tries a picture first, its clickable rows are back in the full flavor, and the directory build stands down beside the npm install (#498, #499, #500, #501, #505, #509); no store-format change, nothing to run after upgrading from 0.3.24
- Earlier: [roadmap-history.md](roadmap-history.md) under "Recently done, before 10-16".
