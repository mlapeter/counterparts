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

## 5. Reference resolution (§9.2) has no home yet

`Recall.resolveUse(sessionId, memoryId, tier)` routes a DECIDED tier to physics through
the store seam. Deciding which memories the reply actually used — assistant turns only,
no model, no file reads, precision over recall — is §9.2's rule and is not implemented
anywhere. Whoever builds it (boundary adapter, most likely) calls this method; recall
adds the two refusals that belong to the gate state it owns (ambiguous-handle, and never
downgrade a credited item) and nothing else.

## 6. Box 3 is 278 MB and 65% of it is JSON punctuation — NAMED, not fixed here

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

**Why it is not fixed in this PR:** it is a box-3 storage-format change with a migration of
its own, it touches the semantic channel that another agent is currently wiring, and the
measured problem here was ranking, not size. Named so it is a decision somebody makes rather
than a number that quietly gets worse. Related and cheap: the same 278 MB is what makes the
FIRST recall in a fresh hook process cost ~800 ms of page-cache warming (`BUDGET_MS`'s day-0
recalibration).
