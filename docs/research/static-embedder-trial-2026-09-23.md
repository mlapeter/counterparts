# The static embedder trial — 2026-09-23

*Roadmap C1, step 5, revised after the adversarial review of #190. Builder C1's
measurements from branch `keyless/static-embedder`. bun 1.3.10, Apple M3 Pro, warm page
cache. Every store here was a fresh temp dir seeded by `tools/demo/seed.ts` (the synthetic
Fernbrook/Halfmoon persona); no real store was opened. Working material, not a ruling.*

## The answer, first

- **potion-base-8M is the better of the two static tables.** On paraphrased questions its
  raw semantic ranking has MRR **0.404**, against static-retrieval-mrl-en-v1@256's 0.207
  (and the lexical channel's 0.169 through recall). static-retrieval wins only on
  questions that already share the memory's words, which the lexical channel answers
  anyway.
- **At the shipped tunables the static channel is near-inert on both recall paths.** It
  delivers exactly what lexical-only delivers (deliberate: 6/30 paraphrase, 10/10 lexical;
  per-turn: 9/30 within two turns) with no lost delivery — but not *identical* output:
  the lexical set's items per turn move **2.90 → 2.80** (static-retrieval: 2.70), so the
  channel does change what is delivered. The cause is not the table:
  `SEMANTIC_SEED_FLOOR = 0.45` and `SEMANTIC_WEIGHT = 1.0` were calibrated for Voyage's
  cosine scale; a static table's cosines sit lower and closer together (mean best-relevant
  0.430 vs best-irrelevant 0.432 on this corpus; 12 of 40 queries' best relevant clears
  0.45).
- **With the floor and weight moved (bench parameters only), it beats lexical-only — by
  a different amount on each path:**
  - **Deliberate** (the MCP `recall` tool: the question's own vector, in line), floor
    0.15 / weight 6: paraphrase targets delivered **11/30 vs 6/30**, MRR 0.211 vs 0.169,
    lexical 10/10, +0.13 items per turn, **~7 rank slips, 0 deliveries lost** (six
    paraphrase targets that were not delivered either way slip a few ranks; one lexical
    target goes 3 → 4 and stays delivered). At floor 0 one delivery is lost.
  - **Per-turn** (the hook: a turn is never embedded while it is answered; the worker's
    rank of the previous exchange is the next turn's lagged cue): **+1** within two turns
    (10/30) at floor 0.25–0.15 / weight 3–6, **+3 (12/30) at floor 0 / weight 6**, 0 lost,
    items per turn 5.26 → 5.13. The lag adds less than the in-line vector, and floor 0
    costs this path nothing measurable.

**Recommendation: include potion-base-8M — embedder, identity tag, weights package —
and do not claim a recall improvement until `recall/` moves its floor/weight for this
model, per path.** Against the brief's criterion ("beat lexical-only on the bench with no
recall-test regressions"): at the shipped tunables it **ties** (no delivery gained or
lost); with a per-model, per-path floor/weight it **beats**, with no lost delivery at the
settings named above. The calibration is `recall/tunables.ts`'s (filed as
`recall/INTERFACE-GAPS.md` §8: per-identity, per-path floor/weight, keyed by the cache's
new `<model>@<dim>` tag). Including the tier costs no lost delivery at shipped values and
~31 ms per hook process to load and verify the table, and gives every memory a vector at
write time, so the calibration has data to work on.

Voyage was **not measured**: no `VOYAGE_API_KEY` in this process, and the brief said not to
look for one. The bench runs a Voyage arm automatically when the key is present (a paid
call per memory).

## The models

| | potion-base-8M | static-retrieval-mrl-en-v1 |
|---|---|---|
| source | huggingface.co/minishlab/potion-base-8M | huggingface.co/sentence-transformers/static-retrieval-mrl-en-v1 |
| revision | `bf8b056651a2c21b8d2565580b8569da283cab23` | `f60985c706f192d45d218078e49e5a8b6f15283a` |
| license | MIT | Apache-2.0 |
| tensor | `embeddings` F32 [29528, 256] | `embedding.weight` F32 [30522, 1024], sliced to 256 (Matryoshka) |
| model.safetensors sha256 | `f65d0f325faadc1e121c319e2faa41170d3fa07d8c89abd48ca5358d9a223de2` | `164fc63ee9f9267be7378fcbd7df99d09788a2f45244c92aa99ae5a574925716` |
| vocab.txt sha256 | `1394523a67ddd404a825428018c0582a6998bcfa044ecbcbf1f4d71adb94c61c` (shipped) | `07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3` (DERIVED: `0_StaticEmbedding/tokenizer.json`'s `model.vocab` sorted by id, one per line, trailing newline) |
| identity in a store | `potion-base-8M@256` | `static-retrieval-mrl-en-v1@256` |

Both weight sha256s match the LFS pointers Hugging Face states for those revisions. **The
identity is derived from these hashes** (`core/embed/static.ts#KNOWN_TABLES`), not from a
directory or package name: the same bytes found through any path give the same identity,
and a table not in the list is named `static-<12 hex of its hashes>`. The weights live
outside the repo: potion in the package at `~/counterparts-model-potion/`, whose
`package.json` declares both sha256s (verified at every load), the comparison model only
in a scratch dir.

## The embedder

`src/core/embed/static.ts`, zero dependencies. Parity with `tokenizers` 0.23.2 +
`model2vec` 0.9.0 on 21 adversarial strings (accents, final sigma, CJK, emoji, every
whitespace/control shape, zero-width chars, a 110-char word, empty input, literal
`[MASK]`): **21/21 pieces, 21/21 token ids, 21/21 vectors within 1e-5, both models.** The
reviewer spot-checked the real table (truncation, emoji-only → null, `[MASK]` → one id,
CJK, accents, final sigma, byte-identical vectors across loads) but could not re-run the
HF parity itself; the fixture was recorded by the builder, and its regeneration recipe is
in `src/core/embed/NOTES.md`.

| | potion F32 | potion F16 | static-retrieval @256 |
|---|---|---|---|
| load, including both sha256s | **24.6–25.8 ms** | 25.5–27.8 ms | ~30–80 ms (125 MB) |
| module import | ~6 ms | ~6 ms | ~6 ms |
| per embed, ~100 tokens | **0.032 ms** | 0.034 ms | 0.034 ms |
| proof pairs, related | **0.580 / 0.420** | same | 0.270 / 0.187 |
| proof pairs, unrelated | **0.062 / 0.092** | same | −0.053 / 0.093 |

F32 kept: F16 halves the package (15 MB) and, now that every load hashes the file, is
within ~2 ms of F32 — not "clearly better". Empty or unknown-only text returns **null**,
not a zero vector.

## The bench

`tools/bench/embedder-trial.ts --potion ~/counterparts-model-potion --retrieval <dir> --runs 5`.
Each run seeds a fresh temp store (161 live memories) and labels 40 queries **by content**
(a distinctive substring of the memory that answers — seed ids are random):
**paraphrase (30)**, the answer in other words ("our office sits upstairs from a shop that
sells boat supplies" → *"two rooms above a chandlery"*); **lexical (10)**, the answer in its
own words, the no-regression half. `SEMANTIC_SEED_FLOOR` and `SEMANTIC_WEIGHT` are swept as
bench parameters; nothing in `recall/` was changed. Five reseeds; the ranges are tiny (the
seed's content is fixed, only id tie-breaks move).

**Two paths, measured separately — they are not the same path.** The deliberate path hands
`Recall.build` the question's own vector (the MCP `recall` tool's shape). The hook never
embeds the turn it is answering: the worker ranks the previous exchange after the
boundary and the next turn gets that ranking as its lagged cue. The per-turn arm runs that
through `Recall.recall` (the recording half, so per-session dedup and the lag row's
one-turn lifetime are live): turn 1 is the question with no lagged cue, the worker's rank
of the question is stored exactly as `Counterpart.noteSessionSemantic` stores it, and turn
2 is "go on — what else do we know about that?".

### Deliberate path (the question's own vector, in line)

R@k and MRR over the activation ranking (`recall.activate`, no candidate cap); delivered =
`Recall.build`, the real gate. Regressions = queries (either set) ranked lower than
lexical-only ranked them, or a delivery lexical-only made and this arm lost; mean per run
(max).

| arm | floor | weight | para R@1 | R@3 | R@5 | R@10 | MRR (range) | delivered (range) | items/turn | lex R@1 | R@3 | MRR | delivered | items/turn | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **lexical-only** | — | — | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.90 | — |
| **potion-base-8M** (shipped) | 0.45 | 1 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.80 | 0 (0) |
| potion-base-8M | 0.35 | 1 | 3 | 5 | 6 | 10 | 0.171 (0.171–0.171) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.80 | 1 (1) |
| potion-base-8M | 0.25 | 1 | 3 | 5 | 6 | 10 | 0.174 (0.174–0.174) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.80 | 4 (4) |
| potion-base-8M | 0.15 | 1 | 3 | 5 | 6 | 10 | 0.179 (0.179–0.179) | 7 (7–7) | 4.93 | 9 | 10 | 0.933 | 10 | 2.80 | 5 (5) |
| potion-base-8M | 0 | 1 | 3 | 5 | 6 | 10 | 0.181 (0.181–0.181) | 9 (9–9) | 4.97 | 9 | 10 | 0.933 | 10 | 2.90 | 5 (5) |
| potion-base-8M | 0.45 | 3 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 9 | 0.925 | 10 | 2.60 | 1 (1) |
| potion-base-8M | 0.35 | 3 | 3 | 5 | 6 | 10 | 0.172 (0.172–0.172) | 7 (7–7) | 4.93 | 9 | 9 | 0.925 | 10 | 2.70 | 3 (3) |
| potion-base-8M | 0.25 | 3 | 3 | 5 | 7 | 11 | 0.179 (0.179–0.179) | 8 (8–8) | 4.93 | 9 | 9 | 0.925 | 10 | 2.80 | 6 (6) |
| potion-base-8M | 0.15 | 3 | 4 | 4 | 7 | 12 | 0.199 (0.199–0.200) | 9 (9–9) | 4.97 | 9 | 9 | 0.925 | 10 | 2.90 | 7 (7) |
| potion-base-8M | 0 | 3 | 4 | 4 | 6 | 14 | 0.202 (0.202–0.202) | 10 (10–10) | 5.03 | 9 | 9 | 0.925 | 10 | 2.92 | 6 (6) |
| potion-base-8M | 0.45 | 6 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 9 | 0.925 | 10 | 2.70 | 1 (1) |
| potion-base-8M | 0.35 | 6 | 4 | 5 | 6 | 11 | 0.190 (0.189–0.190) | 7 (7–7) | 4.93 | 9 | 9 | 0.925 | 10 | 2.54 | 4 (4) |
| potion-base-8M | 0.25 | 6 | 4 | 4 | 6 | 13 | 0.196 (0.196–0.196) | 8 (8–8) | 5.00 | 9 | 9 | 0.925 | 10 | 2.80 | 7 (7) |
| potion-base-8M | 0.15 | 6 | 4 | 4 | 8 | 14 | 0.211 (0.211–0.211) | 11 (11–11) | 5.03 | 9 | 9 | 0.925 | 10 | 2.98 | 7 (7) |
| potion-base-8M | 0 | 6 | 3 | 7 | 10 | 17 | 0.225 (0.225–0.226) | 11 (11–11) | 4.90 | 9 | 9 | 0.925 | 10 | 3.28 | 9 (9) |
| **static-retrieval-mrl-en-v1@256** (shipped) | 0.45 | 1 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.70 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.35 | 1 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.70 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.25 | 1 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.80 | 1 (1) |
| static-retrieval-mrl-en-v1@256 | 0.15 | 1 | 3 | 5 | 6 | 10 | 0.174 (0.174–0.174) | 7 (7–7) | 4.93 | 9 | 10 | 0.933 | 10 | 2.80 | 2 (2) |
| static-retrieval-mrl-en-v1@256 | 0 | 1 | 3 | 5 | 6 | 11 | 0.177 (0.177–0.177) | 7 (7–7) | 4.98 | 9 | 10 | 0.933 | 10 | 3.00 | 2 (2) |
| static-retrieval-mrl-en-v1@256 | 0.45 | 3 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.70 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.35 | 3 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.60 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.25 | 3 | 2 | 5 | 6 | 10 | 0.152 (0.152–0.152) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.60 | 2 (2) |
| static-retrieval-mrl-en-v1@256 | 0.15 | 3 | 2 | 5 | 6 | 10 | 0.152 (0.152–0.152) | 7 (7–7) | 4.98 | 9 | 10 | 0.933 | 10 | 2.80 | 3 (3) |
| static-retrieval-mrl-en-v1@256 | 0 | 3 | 2 | 5 | 6 | 12 | 0.157 (0.157–0.157) | 7 (7–7) | 4.98 | 9 | 10 | 0.933 | 10 | 3.10 | 6 (6) |
| static-retrieval-mrl-en-v1@256 | 0.45 | 6 | 3 | 5 | 6 | 10 | 0.169 (0.169–0.169) | 6 (6–6) | 4.90 | 9 | 10 | 0.950 | 10 | 2.60 | 0 (0) |
| static-retrieval-mrl-en-v1@256 | 0.35 | 6 | 2 | 5 | 6 | 10 | 0.152 (0.152–0.152) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.50 | 1 (1) |
| static-retrieval-mrl-en-v1@256 | 0.25 | 6 | 2 | 5 | 6 | 10 | 0.152 (0.152–0.153) | 6 (6–6) | 4.90 | 9 | 10 | 0.933 | 10 | 2.72 | 2 (2) |
| static-retrieval-mrl-en-v1@256 | 0.15 | 6 | 3 | 4.2 | 6 | 11 | 0.166 (0.166–0.169) | 7 (7–7) | 4.95 | 9 | 10 | 0.933 | 10 | 2.78 | 6 (6) |
| static-retrieval-mrl-en-v1@256 | 0 | 6 | 3 | 4 | 6 | 12 | 0.171 (0.171–0.172) | 8 (8–8) | 5.03 | 9 | 10 | 0.933 | 10 | 2.88 | 9 (9) |

### Per-turn path (the hook: the previous exchange's lagged cue)

within two = a relevant memory delivered on turn 1 or 2; by lag = delivered only on turn 2
(lexical-only's 3 come from the carried lexical cues, not from any vector); lost =
delivered within two turns by lexical-only and not by this arm.

| arm | floor | weight | para within two | para by lag | para lost | lex within two | lex lost | items/turn (para) |
|---|---|---|---|---|---|---|---|---|
| **lexical-only** | — | — | 9/30 | 3 | — | 10/10 | — | 5.26 |
| **potion-base-8M** (shipped) | 0.45 | 1 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| potion-base-8M | 0.35 | 1 | 9/30 | 3 | 0 | 10/10 | 0 | 5.25 |
| potion-base-8M | 0.25 | 1 | 9/30 | 3 | 0 | 10/10 | 0 | 5.25 |
| potion-base-8M | 0.15 | 1 | 9/30 | 3 | 0 | 10/10 | 0 | 5.27 |
| potion-base-8M | 0 | 1 | 10/30 | 4 | 0 | 10/10 | 0 | 5.27 |
| potion-base-8M | 0.45 | 3 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| potion-base-8M | 0.35 | 3 | 9/30 | 3 | 0 | 10/10 | 0 | 5.23 |
| potion-base-8M | 0.25 | 3 | 10/30 | 4 | 0 | 10/10 | 0 | 5.24 |
| potion-base-8M | 0.15 | 3 | 10/30 | 4 | 0 | 10/10 | 0 | 5.24 |
| potion-base-8M | 0 | 3 | 10/30 | 4 | 0 | 10/10 | 0 | 5.22 |
| potion-base-8M | 0.45 | 6 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| potion-base-8M | 0.35 | 6 | 9/30 | 3 | 0 | 10/10 | 0 | 5.21 |
| potion-base-8M | 0.25 | 6 | 10/30 | 4 | 0 | 10/10 | 0 | 5.24 |
| potion-base-8M | 0.15 | 6 | 10/30 | 4 | 0 | 10/10 | 0 | 5.18 |
| potion-base-8M | 0 | 6 | 12/30 | 6 | 0 | 10/10 | 0 | 5.13 |
| **static-retrieval-mrl-en-v1@256** (shipped) | 0.45 | 1 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| static-retrieval-mrl-en-v1@256 | 0.35 | 1 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| static-retrieval-mrl-en-v1@256 | 0.25 | 1 | 9/30 | 3 | 0 | 10/10 | 0 | 5.27 |
| static-retrieval-mrl-en-v1@256 | 0.15 | 1 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| static-retrieval-mrl-en-v1@256 | 0 | 1 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| static-retrieval-mrl-en-v1@256 | 0.45 | 3 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| static-retrieval-mrl-en-v1@256 | 0.35 | 3 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| static-retrieval-mrl-en-v1@256 | 0.25 | 3 | 9/30 | 3 | 0 | 10/10 | 0 | 5.27 |
| static-retrieval-mrl-en-v1@256 | 0.15 | 3 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| static-retrieval-mrl-en-v1@256 | 0 | 3 | 9/30 | 3 | 0 | 10/10 | 0 | 5.25 |
| static-retrieval-mrl-en-v1@256 | 0.45 | 6 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| static-retrieval-mrl-en-v1@256 | 0.35 | 6 | 9/30 | 3 | 0 | 10/10 | 0 | 5.26 |
| static-retrieval-mrl-en-v1@256 | 0.25 | 6 | 9/30 | 3 | 0 | 10/10 | 0 | 5.29 |
| static-retrieval-mrl-en-v1@256 | 0.15 | 6 | 9/30 | 3 | 0 | 10/10 | 0 | 5.29 |
| static-retrieval-mrl-en-v1@256 | 0 | 6 | 10/30 | 4 | 0 | 10/10 | 0 | 5.28 |

### The raw semantic channel (first run)

| model | para R@1 | R@3 | R@5 | R@10 | MRR | lex R@1 | R@5 | MRR | mean best-relevant cos | mean best-other cos | queries whose best relevant ≥ shipped floor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| potion-base-8M@256 | 8 | 13 | 17 | 19 | 0.404 | 8 | 10 | 0.900 | 0.430 | 0.432 | 12/40 |
| static-retrieval-mrl-en-v1@256 | 3 | 6 | 8 | 15 | 0.207 | 10 | 10 | 1.000 | 0.300 | 0.334 | 10/40 |

### Per query, deliberate path (first run)

Rank of the first relevant memory in the activation ranking (— = never a candidate); `*` =
delivered by the gate.

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
| paraphrase | the developer won't accept a database change that takes more than a single step to undo | 19 | 19 | 6 | 19 | 20 |
| paraphrase | the design library only has pieces for when everything goes right | 32 | 32 | 32 | 32 | 33 |
| paraphrase | how many manual fixes people made to each automatically produced schedule | — | — | 36 | — | — |
| paraphrase | our office sits upstairs from a shop that sells boat supplies | — | — | 39 | — | — |
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

`REFILL_BUDGET_MS = 1500` covers ~13K memories at open (the reviewer measured 16,000:
1,572 ms in the constructor, 14,500 refilled inline, the rest left for the worker); the
rest is the worker's (`STATIC_BACKFILL_LIMIT = 1000` per run, ~0.2 s). Since the review,
an open never drops PAID vectors to refill them: those are held until the owner chooses.

## The suite

On a clean detached checkout of the branch head (after the review fixes): `tsc --noEmit`
clean; `bun test` **3299 pass / 5 skip / 0 fail** without the weights (the five skips are
the real-table tests), **3304 / 0** with `COUNTERPARTS_STATIC_WEIGHTS_DIR` and
`COUNTERPARTS_STATIC_RETRIEVAL_DIR` set. The recall suites build their stores with stub embedders,
so "the recall tests with the static embedder wired" is honestly the bench above:
`Recall.build`, `Recall.recall` and `activate` over a store whose every vector came from
potion, with the no-regression half measured on both paths.

## Caveats

- **One synthetic persona, 161 memories, 40 queries written by the builder.** The
  paraphrase set was written to avoid the target's words — the case the channel exists
  for — and so flatters it. A calibration wants real turns (the recall-bench's labelled
  prompts on a copy of a real store) before the tunables move.
- The per-turn arm embeds only the question; the real lag text is the prompt plus up to
  800 bytes of the reply (`vectors.ts#lagText`). Turn 2 is one fixed topic-free follow-up.
- Per-query ranks are over the activation ranking; the gate's relative bar decides
  delivery, and a candidate far down the ranking is not a near miss.
- static-retrieval's `[UNK]` handling differs from sentence-transformers' (dropped here,
  kept there): it moves only texts with unknown words, and it was the losing model either
  way.
