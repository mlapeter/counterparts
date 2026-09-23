# The static embedder trial — 2026-09-23

*Roadmap C1, step 5. Builder C1's measurements, from a clean worktree of branch
`keyless/static-embedder`. bun 1.3.10, Apple M3 Pro, warm page cache. Every store in
this document was a fresh temp dir seeded by `tools/demo/seed.ts` (the synthetic
Fernbrook/Halfmoon persona); no real store was opened. Working material, not a ruling.*

## The answer, first

- **potion-base-8M is the better of the two static tables**, by a wide margin where it
  matters: on paraphrased questions its raw semantic ranking has MRR **0.404** against
  static-retrieval-mrl-en-v1@256's 0.207 (and against the lexical channel's 0.169
  through recall). static-retrieval is better only on questions that already share the
  memory's words — which the lexical channel answers anyway.
- **Through recall, at the shipped tunables, the static channel is inert.** Lexical-only
  and potion-wired recall produce *identical* numbers (paraphrase MRR 0.169, 6/30
  delivered; lexical 10/10 delivered) — no gain, and no regression. The reason is not
  the table: `SEMANTIC_SEED_FLOOR = 0.45` and `SEMANTIC_WEIGHT = 1.0` were calibrated
  for Voyage's cosine scale, and a static table's cosines sit lower and closer together
  (mean best-relevant 0.430 vs best-irrelevant 0.432 on this corpus; only 12 of 40
  queries' best relevant memory clears 0.45).
- **With the floor and weight moved (bench parameters only), it beats lexical-only.**
  floor 0.15 / weight 6: paraphrase targets delivered **11/30 vs 6/30**, MRR 0.211 vs
  0.169, lexical set still 10/10 delivered, +0.13 items per turn, **no delivery lost**;
  the cost is rank slips for ~7 targets per run (six paraphrase targets that were not
  delivered either way, one lexical target 3→4 that stays delivered). At floor 0 one
  delivery is lost — too far.

**Recommendation: include potion-base-8M** — the embedder, the identity tag, the
weights package — **and do not claim a recall improvement until `recall/` moves its
floor/weight for this model.** Against the brief's criterion ("beat lexical-only on the
bench with no recall-test regressions"): at the shipped tunables it *ties* (no
regression, no gain); with a per-model floor/weight it *beats* with no lost delivery.
That calibration is `recall/tunables.ts`'s to make (not this builder's files), filed as
`recall/INTERFACE-GAPS.md` §8 with the shape of the fix: per-identity floor/weight,
keyed by the cache's new `<model>@<dim>` tag. Including the tier now costs nothing
measurable (no regression at shipped values, ~20 ms per hook to load the table) and
gives every memory a vector at write time, so the calibration has data to work on.

Voyage was **not measured**: no `VOYAGE_API_KEY` in this process, and the brief said not
to look for one. The bench runs a Voyage arm automatically when the key is present
(a paid call per memory).

## The models

| | potion-base-8M | static-retrieval-mrl-en-v1 |
|---|---|---|
| source | huggingface.co/minishlab/potion-base-8M | huggingface.co/sentence-transformers/static-retrieval-mrl-en-v1 |
| revision | `bf8b056651a2c21b8d2565580b8569da283cab23` | `f60985c706f192d45d218078e49e5a8b6f15283a` |
| license | MIT | Apache-2.0 |
| tensor | `embeddings` F32 [29528, 256] | `embedding.weight` F32 [30522, 1024], sliced to 256 (Matryoshka) |
| model.safetensors sha256 | `f65d0f32…9a223de2` (30,236,760 B) | `164fc63e…a574925716` (125,018,208 B) |
| vocab.txt | shipped; sha256 `1394523a…adb94c61c` | NOT shipped — derived from `0_StaticEmbedding/tokenizer.json`'s `model.vocab` sorted by id (sha256 `07eced37…c992038a3`) |

Both sha256s of the weights match the LFS pointers Hugging Face states for those
revisions. The weights live **outside the repo**: potion in the package at
`~/counterparts-model-potion/` (below), the comparison model only in a scratch dir.

## The embedder

`src/core/embed/static.ts`, zero dependencies. Parity with `tokenizers` 0.23.2 +
`model2vec` 0.9.0 on 21 adversarial strings (accents, final sigma, CJK, emoji, every
whitespace/control shape, zero-width chars, a 110-char word, empty input, literal
`[MASK]`): **21/21 pieces, 21/21 token ids, 21/21 vectors within 1e-5, both models.**
Three places the research proof was not HF, fixed: `\p{S}` symbols are not BERT
punctuation; clean_text deletes every `\p{C}` except tab/LF/CR rather than spacing
some; the special tokens match verbatim before normalization (up to 0.37 cosine on a text
that quotes them).

| | potion F32 | potion F16 | static-retrieval @256 |
|---|---|---|---|
| load (read + view) | **14.5 ms** | 19.6–21.2 ms | 24–30 ms |
| module import | ~5 ms | ~5 ms | ~5 ms |
| per embed, ~100 tokens | **0.032 ms** | 0.034 ms | 0.034 ms |
| proof pairs, related | **0.580 / 0.420** | same | 0.270 / 0.187 |
| proof pairs, unrelated | **0.062 / 0.092** | same | −0.053 / 0.093 |

F32 chosen: F16 halves the package (15 MB) but adds ~5 ms of decode to every hook's load
for vectors identical to three decimals. Empty or unknown-only text returns **null**, not
a zero vector.

## The bench

`tools/bench/embedder-trial.ts --potion ~/counterparts-model-potion --retrieval <dir> --runs 5`.
Each run seeds a fresh temp store (161 live memories), labels 40 queries **by content**
(a distinctive substring of the memory that answers — seed ids are random), and scores:

- **paraphrase (30)** — the answer in other words ("our office sits upstairs from a shop
  that sells boat supplies" → *"two rooms above a chandlery"*);
- **lexical (10)** — the answer in its own words, the no-regression half.

Per arm: the activation ranking (`recall.activate`, no candidate cap → R@k, MRR), the
delivered set (`Recall.build`, the real gate), and the raw semantic channel
(`Store.nearestTo`). `SEMANTIC_SEED_FLOOR` and `SEMANTIC_WEIGHT` are swept as bench
parameters; nothing in `recall/` was changed. Five reseeds; the ranges are tiny (the
seed's content is deterministic, only id tie-breaks move).

### Through recall

| arm | floor | weight | para R@1 | R@3 | R@5 | R@10 | MRR (range) | delivered (range) | items/turn | lex R@1 | R@3 | MRR | delivered | items/turn | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **lexical-only** | — | — | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.90 | — |
| **potion-base-8M** (shipped) | 0.45 | 1 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.80 | 0 (0) |
| potion-base-8M | 0.35 | 1 | 3 | 5 | 6 | 10 | 0.171 (0.171–0.171) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.80 | 1 (1) |
| potion-base-8M | 0.25 | 1 | 3 | 5 | 6 | 10 | 0.174 (0.174–0.174) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.80 | 4 (4) |
| potion-base-8M | 0.15 | 1 | 3 | 5 | 6 | 10 | 0.179 (0.178–0.179) | 7 (7–7) | 4.93 | 9 | 10 | 0.933 | 10 | 2.80 | 5 (5) |
| potion-base-8M | 0 | 1 | 3 | 5 | 6 | 10 | 0.181 (0.181–0.181) | 9 (9–9) | 4.97 | 9 | 10 | 0.933 | 10 | 2.90 | 5 (5) |
| potion-base-8M | 0.45 | 3 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 9 | 0.925 | 10 | 2.60 | 1 (1) |
| potion-base-8M | 0.35 | 3 | 3 | 5 | 6 | 10 | 0.172 (0.172–0.172) | 7 (7–7) | 4.93 | 9 | 9 | 0.925 | 10 | 2.70 | 3 (3) |
| potion-base-8M | 0.25 | 3 | 3 | 5 | 7 | 11 | 0.179 (0.179–0.179) | 8 (8–8) | 4.93 | 9 | 9 | 0.925 | 10 | 2.80 | 6 (6) |
| potion-base-8M | 0.15 | 3 | 4 | 4 | 7 | 12 | 0.199 (0.199–0.200) | 9 (9–9) | 4.97 | 9 | 9 | 0.925 | 10 | 2.90 | 7 (7) |
| potion-base-8M | 0 | 3 | 4 | 4 | 6 | 14 | 0.202 (0.202–0.202) | 10 (10–10) | 5.03 | 9 | 9 | 0.925 | 10 | 2.92 | 6.2 (7) |
| potion-base-8M | 0.45 | 6 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 9 | 0.925 | 10 | 2.70 | 1 (1) |
| potion-base-8M | 0.35 | 6 | 4 | 5 | 6 | 11 | 0.189 (0.189–0.190) | 7 (7–7) | 4.93 | 9 | 9 | 0.925 | 10 | 2.54 | 4 (4) |
| potion-base-8M | 0.25 | 6 | 4 | 4 | 6 | 13 | 0.196 (0.196–0.196) | 8 (8–8) | 5.00 | 9 | 9 | 0.925 | 10 | 2.80 | 7 (7) |
| potion-base-8M | 0.15 | 6 | 4 | 4 | 8 | 14 | 0.211 (0.211–0.211) | 11 (11–11) | 5.03 | 9 | 9 | 0.925 | 10 | 2.98 | 7.2 (8) |
| potion-base-8M | 0 | 6 | 3 | 7 | 10 | 17 | 0.225 (0.225–0.226) | 11 (11–11) | 4.90 | 9 | 9 | 0.925 | 10 | 3.28 | 9 (9) |
| **static-retrieval-mrl-en-v1@256** (shipped) | 0.45 | 1 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.70 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.35 | 1 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.70 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.25 | 1 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.80 | 1 (1) |
| static-retrieval-mrl-en-v1@256 | 0.15 | 1 | 3 | 5 | 6 | 10 | 0.174 (0.174–0.174) | 7 (7–7) | 4.93 | 9 | 10 | 0.933 | 10 | 2.80 | 1.8 (2) |
| static-retrieval-mrl-en-v1@256 | 0 | 1 | 3 | 5 | 6 | 11 | 0.177 (0.177–0.177) | 7 (7–7) | 4.99 | 9 | 10 | 0.933 | 10 | 3.00 | 1.8 (2) |
| static-retrieval-mrl-en-v1@256 | 0.45 | 3 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.70 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.35 | 3 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.60 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.25 | 3 | 2 | 5 | 6 | 10 | 0.152 (0.152–0.152) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.60 | 2 (2) |
| static-retrieval-mrl-en-v1@256 | 0.15 | 3 | 2 | 5 | 6 | 10 | 0.152 (0.152–0.152) | 7 (7–7) | 4.99 | 9 | 10 | 0.933 | 10 | 2.80 | 2.8 (3) |
| static-retrieval-mrl-en-v1@256 | 0 | 3 | 2 | 5 | 6 | 12 | 0.157 (0.157–0.157) | 7 (7–7) | 4.99 | 9 | 10 | 0.933 | 10 | 3.10 | 6 (6) |
| static-retrieval-mrl-en-v1@256 | 0.45 | 6 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.950 | 10 | 2.60 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.35 | 6 | 2 | 5 | 6 | 10 | 0.152 (0.152–0.152) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.50 | 1 (1) |
| static-retrieval-mrl-en-v1@256 | 0.25 | 6 | 2 | 5 | 6 | 10 | 0.152 (0.152–0.153) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.72 | 2 (2) |
| static-retrieval-mrl-en-v1@256 | 0.15 | 6 | 3 | 4.2 | 6 | 11 | 0.166 (0.166–0.168) | 7 (7–7) | 4.95 | 9 | 10 | 0.933 | 10 | 2.78 | 6 (6) |
| static-retrieval-mrl-en-v1@256 | 0 | 6 | 3 | 4 | 6 | 12 | 0.171 (0.171–0.172) | 8 (8–8) | 5.03 | 9 | 10 | 0.933 | 10 | 2.88 | 9 (9) |

### The raw semantic channel (first run)

| model | para R@1 | R@3 | R@5 | R@10 | MRR | lex R@1 | R@5 | MRR | mean best-relevant cos | mean best-other cos | queries whose best relevant ≥ shipped floor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| potion-base-8M@256 | 8 | 13 | 17 | 19 | 0.404 | 8 | 10 | 0.900 | 0.430 | 0.432 | 12/40 |
| static-retrieval-mrl-en-v1@256 | 3 | 6 | 8 | 15 | 0.207 | 10 | 10 | 1.000 | 0.300 | 0.334 | 10/40 |

### Per query (first run)

| set | query | lexical-only | potion-base-8M f0.45 w1 | potion-base-8M f0.15 w6 | static-retrieval-mrl-en-v1@256 f0.45 w1 | static-retrieval-mrl-en-v1@256 f0.15 w6 |
|---|---|---|---|---|---|---|
| paraphrase | what happened when a pair of staff both claimed one opening and the later edit overwrote the earlier | 82 | 82 | 86 | 82 | 82 |
| paraphrase | why daylight saving time is a hazard for the scheduling engine | — | — | 22 | — | 35 |
| paraphrase | the lead nurse refuses to put someone on overnight duty right after an evening one because of the commute | 2* | 2* | 1* | 2* | 1* |
| paraphrase | no mobile reception underground where the staff hand over | 22 | 22 | 4* | 22 | 17 |
| paraphrase | the optimiser became ten times slower as the headcount rose | 11 | 11 | 18 | 11 | 12 |
| paraphrase | temporary agency workers are able to turn down work they are offered | 6 | 6 | 6* | 6 | 6 |
| paraphrase | what the different ink hues on the handwritten timetable indicate | 29 | 29 | 19 | 29 | 27 |
| paraphrase | a cramped layout won the argument once it was taped up life-size | 1* | 1* | 1* | 1* | 1* |
| paraphrase | the company's head agrees to expansion before working out the price | 18 | 18 | 22 | 18 | 18 |
| paraphrase | the engine counts a slot as staffed even when everyone on it is inexperienced | 5* | 5* | 5* | 5* | 5* |
| paraphrase | the handheld application displays stale schedules without saying how out of date they are | 20 | 20 | 9* | 20 | 20 |
| paraphrase | why we release software midweek instead of at the end of the week | — | — | 18 | — | 35 |
| paraphrase | the developer won't accept a database change that takes more than a single step to undo | 18 | 18 | 6 | 18 | 19 |
| paraphrase | the design library only has pieces for when everything goes right | 32 | 32 | 32 | 32 | 33 |
| paraphrase | how many manual fixes people made to each automatically produced schedule | — | — | 36 | — | — |
| paraphrase | our office sits upstairs from a shop that sells boat supplies | — | — | 40 | — | — |
| paraphrase | workers look for their own entry before anything else when they check the posted timetable | 7 | 7 | 8 | 7 | 7* |
| paraphrase | equity between employees is judged over four weeks rather than seven days | 26 | 26 | 31 | 26 | 28 |
| paraphrase | nobody has simulated two departments drawing on one pool of casual workers | 1* | 1* | 1* | 1* | 4* |
| paraphrase | the senior nurse privately ranks how competent each colleague is | 10 | 10 | 4* | 10 | 10 |
| paraphrase | what three core views make up the product we sell to little medical practices | 22 | 22 | 11 | 22 | 10 |
| paraphrase | the windowless space where difficult discussions always end up | — | — | 25 | — | — |
| paraphrase | the solver's author built it alone during a cold season and still checks each change | 3* | 3* | 6* | 3* | 3* |
| paraphrase | the designer works on her feet with paper rather than at a computer | 6 | 6 | 5* | 6 | 7 |
| paraphrase | a single extra rule made computation a little slower yet wiped out most of the human touch-ups | — | — | — | — | 60 |
| paraphrase | the mobile developer assumes connectivity is usually absent | — | — | 10 | — | — |
| paraphrase | requests to track holidays, contractors and a supervisor dashboard that nobody has estimated | — | — | 13 | — | — |
| paraphrase | the founder sells it as returning personal time to supervisors at the end of the weekend | — | — | — | — | 44 |
| paraphrase | the device quietly stores the previous seven days so it works without a connection | — | — | — | — | 37 |
| paraphrase | another department wants to join, which would more than double the people the optimiser must handle | 1* | 1* | 1* | 1* | 1* |
| lexical | Driftwood nineteen hard constraints six soft ones | 1* | 1* | 1* | 1* | 1* |
| lexical | swap sheet conflict handling | 1* | 1* | 1* | 1* | 1* |
| lexical | Tessellate design system eleven components | 1* | 1* | 1* | 1* | 1* |
| lexical | Ilya Broadbent phone view with no signal | 1* | 1* | 1* | 1* | 1* |
| lexical | skill mix per-shift requirement rather than a per-person grade | 1* | 1* | 1* | 1* | 1* |
| lexical | rota grid took four seconds on the ward tablet | 1* | 1* | 1* | 1* | 1* |
| lexical | red pen shift covered under protest | 3* | 3* | 4* | 3* | 3* |
| lexical | Rosalind Achebe founded Fernbrook after hospital operations work | 1* | 1* | 1* | 1* | 1* |
| lexical | Thursday maintenance window for the skill-mix schema change | 1* | 1* | 1* | 1* | 1* |
| lexical | corridor noticeboard printed rota Friday afternoon | 1* | 1* | 1* | 1* | 1* |

## At scale: the at-open refill and the worker's backfill

Measured on synthetic stores of ~1.2 KB memories (a scratch script, temp dirs):

| store | inline refill at open (identity reset/tag) | worker backfill, 1,000 × `embedOne` |
|---|---|---|
| 161 (seeded) | 11–19 ms | — |
| 1,000 | 118 ms | 233 ms |
| 5,000 | 563 ms | 201 ms |

`REFILL_BUDGET_MS = 1500` covers ~13K memories at open; the rest is the worker's
(`STATIC_BACKFILL_LIMIT = 1000` per run, ~0.2 s).

## The suite

Clean detached checkout of the branch head: see the PR for the final counts. With the
real weights wired (`COUNTERPARTS_STATIC_WEIGHTS_DIR`, `COUNTERPARTS_STATIC_RETRIEVAL_DIR`)
the whole suite, including the four real-table tests, passes (3269/0 at the time of this
write-up). The recall suites themselves (`recall`, `recall-bench`, `probe`, `bridge`:
85/0) build their stores with their own stub embedders, so "the recall tests with the
static embedder wired" is honestly the bench above: `Recall.build` and `activate` over a
store whose every vector came from potion, with the no-regression half measured.

## Caveats

- **One synthetic persona, 161 memories, 40 queries written by the builder.** The
  paraphrase set was written to avoid the target's words, which is the case the channel
  exists for — and so flatters it. A calibration wants real turns (the recall-bench's
  labelled prompts on a copy of a real store) before the tunables move.
- The per-query ranks are over the activation ranking; the gate's relative bar decides
  delivery, and a candidate far down the ranking is not a near miss.
- static-retrieval's `[UNK]` handling differs from sentence-transformers' (dropped here,
  kept there) — it only moves texts with unknown words, and it was the losing model
  either way.
