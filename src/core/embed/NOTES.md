# `embed/` — NOTES

## 2026-09-23 — the static tier (roadmap C1)

**What was built.** `static.ts`: the research proof's 54 lines grown into a loader with
named refusals, a DIM slice, an F16 decoder, special-token handling and exact HF
normalization. The adapter wraps it in the same `LiveEmbedder` seat the Voyage client
fills (`adapters/claude-code/embed-client.ts#createStaticEmbedder`), so every
composition root that already wires `embedder.embed` into the store wires this too.

### Parity, and the three places the proof was not HF

Checked against `tokenizers` 0.23.2 (`normalizer.normalize_str` + `pre_tokenizer.pre_tokenize_str`,
and `encode(text, add_special_tokens=False)`) and `model2vec` 0.9.0 (`StaticModel.encode`)
on 21 adversarial strings, for both models. After the fixes below: 21/21 pieces, 21/21
ids, 21/21 vectors within 1e-5 — both models.

1. **Symbols are not punctuation.** The proof split on `\p{S}` as well as `\p{P}`; BERT
   splits on ASCII punctuation (which includes `$ + < = > ^ \` | ~`) and Unicode `P*`
   only. `a©b` is one word to HF.
2. **clean_text removes, it does not space.** Every "other" code point (`\p{C}`: Cc, Cf,
   Cs, Co, Cn) except tab/newline/CR is deleted — so `\v`, `\f`, U+0085, zero-width
   joiners and soft hyphens vanish, where the proof turned some of them into spaces and
   kept the rest.
3. **Added vocabulary runs first.** `[MASK]` in raw text is ONE id in HF (the special
   tokens match verbatim before normalization). The proof tokenized it as `[`, `mask`,
   `]`. Only a text that quotes BERT's special tokens is affected — but it is affected by
   up to 0.37 in cosine (measured on `"[UNK] [CLS] [SEP]"`), so it is handled.

Also: lowercase is per code point (Rust's), so capital sigma never becomes final sigma;
WordPiece walks code points, not UTF-16 units; the 512-token cap and model2vec's
character pre-cut (`maxTokens × medianTokenLength`, 3,072 chars for both vocabularies)
are kept for parity.

Regenerating the fixture (`test/static-embed-fixture.ts`): a scratch venv with
`pip install tokenizers model2vec`, then for each string `tok.normalizer.normalize_str` →
`tok.pre_tokenizer.pre_tokenize_str` (pieces), `tok.encode(s, add_special_tokens=False).ids`,
and `StaticModel.from_pretrained(dir).encode([...])[i][:8]` (potion head).

### Measured (bun 1.3.10, Apple M3 Pro, warm page cache)

| | potion-base-8M F32 | potion-base-8M F16 | static-retrieval-mrl-en-v1 @256 (F32, 1024 stored) |
|---|---|---|---|
| file | 30.2 MB | 15.1 MB | 125 MB |
| module import | ~5 ms | ~5 ms | ~5 ms |
| table load (`loadStaticModel`) | **14.5 ms** | 19.6–21.2 ms | 24–30 ms |
| per embed (~100-token text, after warm-up) | 0.032 ms | 0.034 ms | 0.034 ms (0.066 at 1024) |
| first embed (JIT cold) | ~0.8 ms | ~0.8 ms | ~0.8 ms |
| four proof pairs (related / unrelated) | 0.580 0.420 / 0.062 0.092 | identical to 3 dp | 0.270 0.187 / −0.053 0.093 |

**F32, not F16.** F16 halves the package but costs ~5 ms of decode on every load, and a
hook pays the load every turn; the vectors are identical to three decimals. The decoder
stays (a 65,536-entry table) so the choice can be revisited on a measured reason.

**Zero-copy load.** `readFileSync` returns a buffer of its own for a 30 MB file and
safetensors pads its header to 8 bytes, so the F32 table is a `Float32Array` VIEW over the
file bytes — no 30 MB copy (the proof's `buf.buffer.slice` made one).

### What a hook pays

The adapter loads the table when it builds the embedder, so every hook process whose
config says `kind: "static"` pays ~20 ms (import + load) whether or not it embeds. It is
~2% of a cold hook and was left eager on purpose: lazy loading would move the "no weights
here" refusal from the composition root to the first write, where nothing reports it.
Revisit if a hook-latency measurement ever names it.
