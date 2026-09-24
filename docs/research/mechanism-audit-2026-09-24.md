*A read of the site's mechanisms against the code, done 2026-09-24 against master 8e1a698 (0.3.0). It is the baseline for the mechanism-first dashboard and for roadmap step 5. Since then #215 and #218 changed entity cards: the prune no longer archives them, they fade gently, and a card named in a saved memory counts as used. Nothing else below has changed. Re-check before relying on a line.*

# Site mechanism audit vs master 8e1a698 (0.3.0), 2026-09-24

**Headline:** npm `latest` is **0.2.0** (0.3.0 is the unpublished trial tarball; `counterparts@0.2.0` has no dependencies). So `bun add -g counterparts` installs 0.2.0 today: no bundled model, setup asks about two keys, and search is words-only without Voyage. The install section describes 0.3.0. **Hold the copy until 0.3.0 is published, or gate it on that.**

## 1. The 13 mechanisms (live path: hook.ts → recallForTurn; Stop/SessionEnd → runner → sessionEnd → runCycle, called with no `candidates`)

| Mechanism | Site tag | Verdict now | Changed since 09-23? | Site copy | Evidence |
|---|---|---|---|---|---|
| Encoding & salience | shown | Built | **Yes.** Novelty is now computed locally by default (static potion embedder, on when the config has no block). It is null only when the store has no neighbours yet. The journal→memory door stays blind by design | Accurate. Could now add "and how new it is" | `config.ts#resolveEmbedder/withEmbedderDefault` (hook, runner, serve); `counterpart.ts:1331` vectors; `bridge.ts#batteryGate`; `physics#novelty,sal` |
| Consolidation | shown | Built (narrow) | No | **Overclaims.** (a) "similar ones are merged": only byte-identical bodies merge; near-duplicates are left alone on purpose. (b) "stay strong over several days → core": promotion needs base ≥0.85 **and** credited use on 3 distinct days. Use caps at 0.5 and consolidation adds 0.2 (0.70 total), so a memory only gets there if its author scored it ≥~0.65. skill/place kinds can never get there. (c) Runs every 3 lived days, not every session | `sleep/dedup.ts#contentHashCandidates`; `physics#promotionEligibility`, REP_CAP/CONS_BONUS/THETA_ID; `sleep/tunables CADENCE.consolidate=3` |
| Association | shown | Built but starved | Slightly: the semantic channel is live by default now, so hops have more candidates to boost | **Overclaims** "nudge the others to mind." A hop only boosts a memory the turn's words or meaning already reached; it can never bring one in by itself. Edges form only when both memories were *used* (expanded or quoted 8 words) in the same turn. Weak credit is 0 | `recall/activate.ts` hop gate (a) ~L400; `associate/tunables` EDGE_WEAK_CREDIT 0 |
| Retrieval & strengthening | shown | Built | Semantic cue is keyless now (lagged one turn, retuned per model). Correction to 09-23: being shown earns **nothing** live. Expand or quote earns +1 | Accurate ("fade more slowly" is true: stability grows with log uses, and the curve restarts from the last use) | `physics#creditUse,stability`; `recall/reference.ts`; `counterpart.ts#creditReferences` |
| Reconsolidation | shown | Partial | No | Mild overclaim. It revises only when the writer *declares* `updates:` (nothing detects a contradiction), and slow kinds need pressure over ≥3 days. The old version is kept **90 lived days**, then deleted | `physics#applyChallenge`, H_SUPERSEDED_DAYS; `store#pruneSupersededVersions` (DELETE) |
| Emotional modulation | shown | Partial / starved | No | **Overclaims and mixes up two fields.** The quoted `feeling` is stored as a label with **no weight** (bridge.ts NAMED GAP). Weight comes only from the author's numeric `salience.emotional`, which needs no quote and is dropped unless all 3 dimensions are given. The classifier is off. "Come up more easily when you're expressing a feeling" is **accurate** (`gatedSal`) but only matters if `emotional` was scored | `bridge.ts#dimensionsFrom`; `encode/emotion.ts`; `recall/activate.ts#gatedSal`; `EMOTION_CLASSIFIER_ENABLED:false` |
| Decay & forgetting | shown | Built | No | Mostly accurate. "Core memories *about who it is*" is off: the exemption covers the identity band, whatever kind the memory is (see consolidation for how hard that band is to reach). Archived memories never surface | `physics#decay` (D=1 if promoted); `sleep/prune.ts` |
| Interference | inDev | Not built | No | inDev badge honest | `sleep/dedup.ts` (exact only; TAU_DUP unmeasured and unwired) |
| Prospective | inDev | Wired but starved | No (DRAFT_FIELDS still has no date) | inDev honest | `remember/proposals.ts#DRAFT_FIELDS`; `prospective/INTERFACE-GAPS #2` |
| Schema & assimilation | inDev | Partial; beliefs missing | No (`addBelief` still called only by tools/demo/seed.ts) | inDev honest | `schemas/index.ts` |
| Episodic → semantic | inDev | Label only | No | inDev honest | `physics#band` |
| Identity (parked) | parked | Partial | No | "Lines that keep proving true" really means lines *used* on 3 days with a high score. The page is AI-written, but the rest of the briefing is put together by code | `sleep/consolidate.ts`, `self/` |
| Storage (parked) | parked | Built | No | Near enough. Captured transcripts (7-day retention), snapshots and cache also sit beside `counterparts.sqlite` | `store/paths.ts`; `remember/retention.ts` |

## 2. Other home-page claims
- **"Three lines. No API keys." / "A small model (28 MB) comes with it"**: **stale on npm** (0.2.0). True of 0.3.0. The size is 30.2 MB decimal (28.8 MiB for model.safetensors; the package unpacks to 30.5 MB), so say "~30 MB."
- **"so nothing is sent anywhere"**: at 0.3.0 defaults Counterparts makes no network calls of its own. The embedder is local, crash write-ups happen in the next session, the API sweep is opt-in, and the page writer runs in `session` mode, so no `claude -p` is spawned. But the briefing, recalled memories and the next-session write-up all travel inside your Claude Code conversation to Anthropic, like any other context. Suggest: "nothing goes anywhere your Claude Code conversation doesn't already go."
- **"Mac or Linux"**: unverified. There is no CI, and Linux has never been run per the docs. It's bun-only and Node is untested. Windows is simply not handled.
- **"asks your name, connects Claude Code"**: accurate for 0.3.0. 0.2.0 also asks for keys.
- **"Restart Claude Code once"**: accurate. Upgraders to 0.3.0 must quit every session first (ROADMAP E).
- **Card "It changes its mind slowly… what it believes about you"**: leans on beliefs, which have no live producer. What really exists is declared revision of person/self memories with a multi-day pressure bar. It's fair if read that way.
- **Card "Things come to mind"**: accurate.
- **Cards for journal and briefing**: accurate as long as the model complies with the Stop ask.
- **"Where it's going"**: a plan, not a claim. Fine.
- Also stale: repo `README.md` L22 and L113–115 still say "two optional API keys" and "Without keys, search matches on words only" (QUICKSTART is current). Field Guide `papers.json` `counterparts` row still claims 10 mechanisms, and its "Markdown files plus SQLite" is stale since the floor.

## 3. modules.ts
It renders only at `/review/how-it-works/` and `/review/home/` (the `page.review.tsx` pages, which exist only with SITE_REVIEW=1), so **it is not in the public build**. It is stale all the same:
- `remember.plain` and `HALVES.deliberate` call the sweep "the crash fallback". It's now opt-in (`crashWriteUp:"api"` plus a key), and the default is the next-session write-up.
- `TOOLS`/"Five of them": the server now has 7 tools (scope and self_page added).
- `sleep.divergence` says "prunes… by actually deleting". It archives.
- `encode` "scores how new": that part is now true by default.

## 4. Human phenomena not on the list
| Phenomenon | Resemblance in Counterparts |
|---|---|
| Testing effect | Yes. A used retrieval resets the curve and raises stability (`physics#creditUse` says so) |
| Spacing effect | Yes. At most one credit per memory per lived day, and promotion needs 3 *distinct* days |
| Priming | Partial. Last turn's embedding cues this turn (lagged semantic), and cue tokens carry over (`carriedCues`) |
| Working-memory limits | Only as byte budgets and top-M caps on the wake and on recall. Not modeled |
| Context-dependent / encoding specificity | Mostly absent. Recall ignores project scope; only the handoff pointer at wake is per-directory |
| Source monitoring | Yes. Author channel (`by`, source), a salience ceiling on retold (sweep) memories, subject plus quote on feelings, revision reasons |
| Levels of processing | Design-level. Authored-in-own-words memories rank above transcript retellings (`SWEEP_CLAIM_CEILING`) |
| Retrieval-induced forgetting | No. Competitors are never suppressed |
| Sleep replay | No. "Sleep" is arithmetic with no content replay (the chapter/page asks are the closest thing) |
| Pattern completion | Partial. Partial cues via tokens, meaning and 2-hop spread |
| Pattern separation | Design stance only. Traces never blend; there is no near-duplicate machinery |
| Reminiscence | Only via the journal chapters. No reminiscence bump |
| Tip-of-tongue / feeling of knowing | Loosely. The footnote tier shows only a title, which it can then expand |
| Refractory / habituation | Yes. Affect flag refractory for 2 turns; each memory surfaces once per session |
| Synaptic scaling | Yes. Edge caps and proportional renormalization (`associate`) |
| Zeigarnik (unfinished tasks) | Loosely. A session that "owes" a write-up is kept until it's done (`remember/owes.ts`) |

## Overall
About 4 of the 11 Field Guide mechanisms are really built (salience, decay, retrieval, a narrow consolidation). Three are partial (reconsolidation, emotion, association, the last two starved in practice). Four aren't there (interference, prospective, schemas, episodic→semantic).
0.3.0's real gain is keyless novelty and semantic recall. No sleep, physics, association, schema or prospective code changed since 09-23.
The non-inDev copy overclaims in four places: dedup "similar merged", association "nudge", emotion "feeling adds weight", and core-memory "stay strong". The install block runs ahead of what npm actually ships.
