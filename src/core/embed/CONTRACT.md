# `embed/` — CONTRACT

## 1. Purpose

Text in, vector out, **on this machine, for nothing**: the static embedding table that
gives the semantic channel a source when no paid embedder is configured — which, on
2026-09-23, is every store including the owner's. One file, `static.ts`, zero
dependencies.

## 2. Brain analog

None worth claiming. A static table is a lookup of learned word meanings averaged over a
sentence — closer to a gist than to a reading. It is kept honest by being a SECOND
channel beside the lexical one (`recall/activate.ts` fuses the two), never the only one.

## 3. Keeps

- **The zero-dependency proof** (`docs/research/local-embeddings-2026-09-22.md`,
  appendices 1 and 2): BERT basic tokenizer + WordPiece + row mean + L2 over a
  safetensors table read directly. [research agent, 2026-09-22]
- **model2vec's `encode()` defaults as the parity target** — added-vocabulary special
  tokens, HF `BertNormalizer` order, `[UNK]` dropped before pooling, the 512-token cap and
  its character pre-cut. Checked token-for-token and vector-for-vector against
  `tokenizers` 0.23.2 / `model2vec` 0.9.0 (`test/static-embed.test.ts`).
- **A vector's generation is part of its identity** ([claude-code] `embed-client.ts`
  §2.15): every loaded table has an identity `<model>@<dim>`, and the embedder the adapter
  builds carries it to `store/`, which checks it against box 3's tag at open.

## 4. Drops / simplifies

- **No runtime.** No ONNX, no transformers.js (471 MB of node_modules), no llama.cpp.
  Contextual models are a later, separate tier if the measurements ever ask for one.
- **No zero vector for an empty text.** model2vec returns zeros; this returns `null`
  (`store.Embedder`'s null arm), so box 3 never holds a vector every cosine reads as 0.
- **sentence-transformers' `[UNK]`-in-the-mean** is not reproduced for
  static-retrieval-mrl-en-v1 (named in `static.ts`'s header).

## 5. Contract

- **G1 — Deterministic.** The same table and the same text give the same numbers, across
  loads and processes.
- **G2 — Host-agnostic.** `node:fs`, `node:module`, `node:path`, `node:os`, `node:crypto`
  only. Little-endian hosts only (every supported target): a big-endian host is refused
  by name (`BIG_ENDIAN`), not by a comment.
- **G3 — Refusals by name.** A missing or malformed table throws `StaticEmbedderError`
  with a code (`MISSING_FILE`, `BAD_SAFETENSORS`, `NO_TENSOR`, `BAD_DTYPE`, `BAD_VOCAB`,
  `BAD_DIM`, `HASH_MISMATCH`, `BIG_ENDIAN`); the adapter turns that into an UNAVAILABLE
  embedder (every ask answers null, no identity) whose code the worker's backfill row
  carries durably, never a failed hook.
- **G4 — Weights resolution, in order:** an explicit directory; `COUNTERPARTS_STATIC_WEIGHTS_DIR`;
  the installed `counterparts-model-potion` package, resolved from this module. Nothing
  else — no search of the filesystem, no download.
- **G5 — Identity from the bytes** (review of #190, MAJOR 5). The sha256 of
  `model.safetensors` and of `vocab.txt` are computed at every load (~10 ms for 30 MB);
  the pair names the table through `KNOWN_TABLES` (`potion-base-8M`,
  `static-retrieval-mrl-en-v1`), else `static-<12 hex of their combined hash>`. The same
  bytes give the same identity through any directory, symlink or package; different
  bytes never share one. A `package.json` that DECLARES a sha256 for a file is checked
  (`HASH_MISMATCH` on a mismatch). `counterparts.model` and the caller's `label` are
  display names only.
- **G6 — Nothing leaves the process.** No network, no telemetry of text; the adapter's
  events carry hashes, model names, widths and timings only.

## 6. Scars honored

| Scar | Where |
|---|---|
| §2.15 a vector's generation is part of its identity | G5; `store/cache.ts#reconcileEmbedder` |
| §2.4 every discard says what | G3; the adapter's `embed.refused` / `embed.static.empty` events |
| "a lie with a number on it" (store `Embedder` null arm) | §4's null-not-zero |

## 7. Open questions

- The recall fusion (`SEMANTIC_SEED_FLOOR`, `SEMANTIC_WEIGHT`) was calibrated for
  Voyage's cosine scale; at those values this table's channel is inert. Recall's to
  decide — `recall/INTERFACE-GAPS.md` §8, with the bench numbers.
- F16 weights halve the package (15 MB) for ~5 ms more load; not taken (NOTES).
