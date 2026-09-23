# `recall/` — interface gaps

Things this module needs from a neighbour and worked around instead of editing. Each
entry names the owner, the workaround now in the code, and what the real fix looks like.

## 1. `store/` has no meta enumeration or expiry — gate-state rows are unbounded

**Owner:** `store/`.
**Needed:** per-session gate state with a defined store AND lifetime (recall contract §5
G12).
**Have:** `Store.getMeta` / `Store.setMeta`, a flat key/value table with no way to list
keys by prefix and no way to remove one. `setMeta` is the only seam, so gate state is one
JSON row per session at `recall.gate.<sessionId>`.
**Workaround:** the ROW bounds itself — `MAX_SESSION_RECORDS` caps the surfaced and
credited maps, and every row stamps `lastDay` so a future sweep has something to sweep
on. The KEYSPACE does not: a long-lived store accumulates one dead row per session
forever.
**Known race, recorded not fixed — scar §2.1 shape:** the row is read-modify-written.
`setMeta` is transactional per call, but `load → mutate → save` is not, so two writers on
one session — a turn's `recall()` and a late `resolveUse()` from the boundary, in
different processes, which is exactly the multi-process case this persistence exists for
— can have the second save drop the first's records. This is scar §2.1's own sentence
("hand-serialized structured state with more than one writer mints consistency bugs")
arriving inside a transactional database, because the transaction is around the wrong
span. Papering over it with a merge-on-save would be the sidecar-plus-discipline answer
the scar rejects; the fix is the table below, where each record is its own row.

**Real fix (store's call, not recall's):** either `metaKeys(prefix)` plus a meta removal
that respects no-silent-destruction, or a dedicated `gate_session` table with a
`last_day` column and a retention sweep alongside `pruneSupersededVersions`. The latter
is probably right: this is operational state with a lifetime, which is what box 2 is for,
and a table can be pruned where a meta row cannot.

## 2. No alias / handle index — ambiguity is caller-supplied

**Owner:** `encode/` (aliases are first-class and change only through explicit alias
operations — §4.2 G4).
**Needed:** "a name pointing at two people retrieves neither well and must not teach the
graph either" (§9 G5) requires knowing that a handle resolves to more than one memory.
**Have:** nothing. Aliases live in prose `meta` at best; the cache indexes title+body as
undifferentiated text.
**Workaround:** `Turn.aliases?: ReadonlyMap<string, readonly string[]>` — the caller
passes the handle map, and a handle with two or more ids fires at `AMBIGUOUS_WEIGHT` and
sets `trains: false`, which `Recall.resolveUse` enforces as a refusal. Both halves are
live; only the SOURCE of the map is borrowed.
**Real fix:** an alias table in box 2 written by `encode/`'s alias operations, and a
store read (`aliasesFor(token)` or `ambiguousHandles()`) that recall consults itself.
Until then a caller that forgets the map silently loses the safety half — which is
exactly the scar §2.6 shape, so this gap is the one to close first.

## 3. No document-frequency statistics on the cache — idf is approximated by probing

**Owner:** `store/` (box 3).
**Needed:** rarity weighting (§9 G4) needs `df(token)` over the index.
**Have:** `Store.search(cue, limit)` returns up to `limit` hits with summed term
frequency. There is no `df`, and no way to ask the inverted table a question directly.
**Workaround:** one probe per distinct cue token, `df = hits.length`, capped at
`PER_CUE_FETCH`. Two consequences worth stating: a token appearing in more than
`PER_CUE_FETCH` documents is recorded as exactly `PER_CUE_FETCH`, so very common tokens
are scored slightly RARER than they are (the wrong direction, though the smoothed idf
keeps them near zero anyway); and cue extraction costs one query per token.
**Real fix:** `Store.documentFrequency(tokens: string[]): Map<string, number>` — a single
`GROUP BY token` over `doc_tokens`, which the schema already supports.

**Closed in part, 2026-09-04:** the *document-length* half of this gap is gone. `doc_lens`
joined box 3 (cache schema v3) and `Store.search(cue, limit, norm)` takes the normalization
constants, so the cue channel no longer has to pretend every document is the same size. The
`df` half above is unchanged.

## 3a. `doc_tokens` outlives the memory — removed rows still count in `df` and `avgLen`

**Owner:** `store/` (box 3).
**Have:** removal takes an id dark in box 2 and `activate` filters it with `deniedIds()`,
but nothing deletes its rows from `doc_tokens`. Only `rebuildCache()` clears them.
**Consequence, small and worth stating:** a removed memory still contributes to the `df`
probe (so its tokens read as very slightly less rare than they are) and to `AVG(len)` (so
the normalization constant is computed over a corpus that includes the dead). Neither leaks
content — the ids never become candidates — and both are noise at the store's current size.
**Real fix:** delete the row's `doc_tokens` and `doc_lens` entries at the `dark` stage,
where the deny-list entry is already written.

## 4. The observer predicate lives in `store/`

Not a defect, and recorded so nobody "fixes" it: `Recall.observer` reads
`store.observer` and never re-derives the predicate. `docs/observer-mode.md` G7 says a
second definition is a leak waiting to happen — v1 shipped exactly that. If a second core
module needs the predicate, the store's own note says to MOVE `store/observer.ts` to
`src/core/observer.ts`; recall will follow the move without changing behavior.

## 5. Reference resolution (§9.2) has no home yet — CLOSED 2026-09-14

`Recall.resolveUse(sessionId, memoryId, tier)` routes a DECIDED tier to physics through
the store seam. Deciding which memories the reply actually used — assistant turns only,
no model, no file reads, precision over recall — is §9.2's rule and was not implemented
anywhere. **Closed:** `recall/reference.ts` decides (pure; expansions from recall tool
calls, verbatim eight-word windows against what surfaced loud), `Counterpart.creditReferences`
applies it through `resolveUses`, and `adapters/claude-code/hooks.ts#creditAtBoundary` calls
it on the slice capture just took, at every session-ending hook. Measured before the close
(IMPROVEMENTS U10): 1,374 memories minted since launch, all at `uses = 0`. Proof:
`test/lifecycle.test.ts` — the lifecycle through the adapter, the two fixtures (ids named
in prose credit nothing; expanded-then-contradicted credits), the new-slice-only rule, and
the wake not reinforcing what it renders.

## 6. Nothing computes the turn's embedding — CLOSED 2026-09-04, by moving it

**Owner:** was nobody's, which was the defect.
**Needed:** `Turn.vector` is an input this module has taken since it was written, and
guarantee 1's whole point is that the ambient path MAY consult an embedding.
**Had:** neither live caller set it. The UserPromptSubmit hook built its turn without
one; the MCP recall tool built its own without one. So the semantic channel was live
code reached only by tests and by the sweep's card preselection, and the store's 13,862
embeddings were consulted by nothing a person could feel — the §2.6 shape again ("a
pure function over caller-owned state is only as real as its caller"), one layer up.

**Closed, but NOT by giving recall a client.** There is still no fetch in this
directory. Two things moved instead:

1. `Counterpart.recallForTurn` now wires the semantic channel the way it already wires
   aliases, temporal cues and hops — from the composition root, so a caller cannot
   forget it. What it wires is a **lagged** cue: `recall/session.ts`'s `gate_session`
   `semantic` row, written by the detached worker after the previous turn.
2. The row carries a **ranking**, not a vector. This is the part worth remembering:
   moving the embedding call off the hot path would not have been enough, because
   `Store.nearestTo` reads and `JSON.parse`s every row in box 3 and measured 590-1040 ms
   at the live index's size — inside a 1200 ms budget that aborts rather than degrades.

**What is still borrowed, and from whom:** the WORDS. `adapters/claude-code/vectors.ts`
decides what text becomes the cue (the owner's prompt to 2000 bytes plus 800 bytes of
the reply) and does the embedding and the ranking. That is correct — the host owns its
transcript and its credential — but it means a host that never runs that worker gets a
permanently dark semantic channel, and the only sign is `semanticSource` staying
`"none"` on every turn. That field exists so the sign is legible.

**The real fix, if box 3 ever earns it:** an approximate index (IVF/HNSW) would make
`nearestTo` cheap enough that the hot path could rank a vector itself, and the lag would
become a choice rather than a constraint. Not built: constitution line 15, and one
measured failure is not yet a case for an index.

**Addendum 2026-09-23 (roadmap C1) — the static tier needs no worker for its writes.**
With `embedder.kind: "static"`, the store's sync `embed` COMPUTES (a local table,
~0.03 ms a text), so every memory gets its vector at write time in whatever process
writes, and the lagged cue needs no key. What is still worker-only for this tier: the
lagged cue itself (the hook does not embed the turn — `hooks.ts`'s to change, and at
0.03 ms it now could). The MCP server's `note` no longer writes vectorless under the
static table: `openServer` now hands the server's store the embedder's sync face and
identity (mcp INTERFACE-GAPS §7's option 1, taken in #190 — that page still describes
the gap as open and is its owner's to close).

## 7. Box 3 is 278 MB and 65% of it is JSON punctuation — NAMED, not fixed here

**Owner:** `store/` (box 3).
**Measured 2026-09-04**, on the live cache (`dbstat`, 15,421 indexed documents):

| table                        | bytes | note |
|---|---|---|
| `embeddings`                 | 177.5 MB | 13,868 vectors × 1024 dims, stored as **TEXT JSON** |
| `doc_tokens` + its 2 indexes |  99.1 MB | 1,070,086 rows |
| everything else              |   1.6 MB | |

A 1024-dim float32 vector is 4,096 bytes. As `JSON.stringify(number[])` the same vector
averages **12,690 bytes** — a 3.1× multiplier, and `nearest()` then pays `JSON.parse` on
every row of a full-table scan for every semantic query. Stored as a `BLOB` the embeddings
table would be roughly 57 MB and the scan would be a `Float32Array` view rather than a
parse.

**Why it is not fixed in the change that measured it:** it is a box-3 storage-format change
with a migration of its own, it sits under the semantic channel gap 6 has just closed, and
the measured problem there was ranking, not size. Gap 6's 590-1040 ms `nearestTo` and this
table are the same fact seen twice: the scan is slow BECAUSE every row is parsed from JSON. Named so it is a decision somebody makes rather
than a number that quietly gets worse. Related and cheap: the same 278 MB is what makes the
FIRST recall in a fresh hook process cost ~800 ms of page-cache warming (`BUDGET_MS`'s day-0
recalibration).

## 8. The semantic fusion is calibrated for ONE embedder's cosine scale — CLOSED 2026-09-23 (keyless/recall-tune)

**Owner:** `recall/` (`tunables.ts`: `SEMANTIC_SEED_FLOOR`, `SEMANTIC_WEIGHT`, `SEMANTIC_TOP_M`).
**Needed:** a semantic hit's contribution that means the same thing whichever model
produced the cosine — measured on BOTH recall paths, because they use the channel
differently.
**Had:** `SEMANTIC_SEED_FLOOR = 0.45` and `SEMANTIC_WEIGHT = 1.0`, chosen when Voyage was
the only embedder. A static table's cosines sit lower and closer together (potion-base-8M:
related pairs 0.42–0.58; on the seeded bench the mean best-relevant cosine 0.430 against
the mean best-irrelevant 0.432, and only 12 of 40 queries' best relevant clears 0.45).
Measured on the C1 bench (`tools/bench/embedder-trial.ts`, 30 paraphrase + 10 lexical
queries, a seeded store, 5 reseeds):

- **Raw channel:** potion's own ranking is strong — paraphrase MRR 0.404 against
  lexical-only's 0.169 through recall.
- **Deliberate path** (the MCP `recall` tool: the question's own vector, in line). At the
  shipped values potion is near-inert: the same MRR (0.169) and the same 6/30 paraphrase
  targets delivered as lexical-only — but not identical: lexical-set items per turn move
  2.90 → 2.80 (static-retrieval: 2.70). At floor 0.15 / weight 6: **11/30** delivered,
  10/10 lexical kept, +0.13 items per turn, **~7 rank slips, 0 deliveries lost** (six
  undelivered paraphrase targets and one lexical target 3→4, still delivered). At floor
  0 one delivery is lost.
- **Per-turn path** (the hook: the turn is never embedded while it is answered; the
  worker's rank of the previous exchange is the next turn's lagged cue). Simulated as
  question → worker rank → a follow-up that names no topic. At the shipped values: 9/30
  paraphrase targets delivered within two turns, identical to lexical-only. The lag adds
  less than the in-line vector does: +1 (10/30) at floor 0.25–0.15 / weight 3–6, **+3
  (12/30) at floor 0 / weight 6**, 0 lost on this arm, items per turn 5.26 → 5.13.
  **That is the lag's CEILING, not its cost:** the arm embeds only the question (the real
  lag text is the prompt plus up to 800 bytes of the reply), and its turn 2 is one
  follow-up that stays on the question's topic. What a floor-0 lag does to a turn that
  CHANGES topic — the lag then carries the previous subject into it — is **unmeasured,
  not zero**.

**Caveats that travel with these numbers** (the write-up's, repeated here because this
is where a calibration will be read from): one synthetic persona, 161 memories, 40
queries written by the builder; the paraphrase set was written to avoid the target's
words, which is the case the channel exists for and so flatters it; the per-turn arm is
the ceiling described above; per-query ranks are over the activation ranking, and the
gate's relative bar decides delivery.

**Closed by per-identity, per-path tunables** (`SEMANTIC_BY_IDENTITY`, `tunables.ts`;
looked up in `activate.ts` from the identity box 3 records, READ FRESH at every activation
— `recordedIdentity` → `Store.rankingIdentity()`, the file's tag when this handle may rank
against it — and by the path: `vector` → inline, `hits` → lagged; anything unlisted gets
0.45 / 1.0):

| identity | inline (deliberate) | lagged (per-turn) |
|---|---|---|
| `potion-base-8M@256` | floor 0.15, weight 6 | floor 0.05, weight 1 |
| `voyage-3-large` | 0.45 / 1.0 (unmeasured, frozen) | 0.45 / 1.0 |

**The per-turn floor-0 cost is now MEASURED, not guessed** — a topic-changing arm (turn 1
query i, its lag, turn 2 a query j about something else), counting j's targets lost and the
stale items the lag ADDED (turn-2 deliveries among i's lagged hits, not about j, that
lexical-only did not deliver anyway), over 40 pairs: weight 1, 0 lost and 1.2 added;
weight 2, 0 and 4.8; weight 4, 0 and 11.8; **weight 6, one lost and 25.8 added**; weight 8,
one lost and 39.4. The weight costs far more than the floor, which is why the lagged pair
is 0.05 / 1 (on topic 9.8/30 vs lexical-only's 8.4–9.0; on a topic change 0 lost, 1.2
added) while the deliberate pair is 0.15 / 6 (11/30 vs 6, 0 deliveries lost, 7–8 rank
slips, lexical 10/10). Every number, the grid and the confirmation run:
`docs/research/static-embedder-trial-2026-09-23.md`, "the retune".

**The two holes the review of #193 found, and how they are closed:**
- *A lagged row is never RANKED, so the store's per-ranking claim check never saw it:* a
  row ranked under one table and read after the store was reset to another would have
  scaled that table's cosines by the new table's pair for a turn. `loadSessionSemantic`
  now answers `other-model` (no hits) when the row's model differs from the one the file
  records now.
- *A `deferred` open (a lost lock) knew no identity and ran the defaults for the handle's
  life* — the MCP server's whole session, if its open lost the lock. The identity is now
  read from the file per activation, so the handle gets the pair of the vectors it ranks.
  (This took one read-only `Store` method, `rankingIdentity()`.)

**Still owed, and named in the write-up:**
- **Transfer to a live-sized store.** The semantic contribution is absolute (at most
  `weight`) while the cue channel and the gate's floors are in cue units,
  `floorUnit(N) = log((N+1)/2)` — ≈ 4.4 at the bench's 161 memories, ≈ 6.9 at 2,000, ≈ 9.0
  at 17,000 — so weight 6 counts roughly 1.5–2× less against the floors on a live-sized
  store. The recall-bench's labelled real prompts, on a store copy, should re-earn both pairs.
- One synthetic persona and builder-written queries; a lag embedded from the question
  alone; one topic-change partner per query.
- The MCP `recall` tool builds rather than records, so its pair rides `BuildOutput.semantic`
  but reaches no telemetry ring until `server.ts` logs it.
