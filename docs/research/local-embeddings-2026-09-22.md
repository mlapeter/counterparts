# Local embeddings without a key — research, 2026-09-22

*An Opus research agent's report, run from the ~/counterparts session on 2026-09-22 at the owner's request ("a lot of good small ones have been made recently"). Measured on bun 1.3.10, Apple M3 Pro. Nothing in the repository was changed; the two proof scripts it wrote are appended below. Working material, not a ruling.*

**Local embeddings, 2026-09-22.** Measured on bun 1.3.10 / M3 Pro, one ~98-token string. Compare only within a scale: v1 ret = MTEB v1 retrieval (model cards), v2 = MTEB English v2, NanoBEIR = one shared HF table.

**1. Models**

| Model | Params | Dims | Load size | Quality | License |
|---|---|---|---|---|---|
| all-MiniLM-L6-v2 | 23M | 384 | ONNX q8 23MB | v1 ret 41.95; NanoBEIR .562 | Apache-2.0 |
| bge-small-en-v1.5 | 33M | 384 | ONNX q8 34MB; GGUF Q8 37MB | v1 ret 51.68; NanoBEIR .627 | MIT |
| arctic-embed xs/s | 22M/33M | 384 | ONNX q8 23/34MB | v1 ret 50.15/51.98 | Apache-2.0 |
| nomic-embed-text-v1.5 | 137M | 768 | ONNX q8 137MB; GGUF Q4 78MB | v1 ret 53.25 | Apache-2.0 |
| granite-small-english-r2 (2025-08) | 47M | 384 | ONNX q8 52MB | v2 ret 53.9 (bge-small also 53.9) | Apache-2.0 |
| EmbeddingGemma-300M (2025-09) | 308M | 768 | ONNX q4 197MB; GGUF Q8 329MB | v2 mean 69.67 | Gemma terms (not OSI) |
| Qwen3-Embedding-0.6B (2025-06) | 600M | ≤1024 | ONNX q8 614MB; GGUF Q8 639MB | v2 mean 70.70 | Apache-2.0 |
| potion-base-8M (static) | 7.6M | 256 | F32 30MB | NanoBEIR .442; v1 ret 31.1 (MiniLM 42.9, their run) | MIT |
| static-retrieval-mrl-en-v1 (static) | 31M | 1024 | F32 125MB; 256d slice 31MB | NanoBEIR .503 (−1.5% at 256d) | Apache-2.0 |

Newer: voyage-4-nano (2026-01, Apache) shares the voyage-4 API space, not the pinned voyage-3-large. harrier-oss-v1-270m (2026-03, MIT). jina-v5-nano is CC-BY-NC.

**2. Running from bun**
- **transformers.js 4.3.0** (runs on native onnxruntime-node): **471MB node_modules**; bun blocks its postinstall, it works anyway. Measured: MiniLM q8 **4.1ms**, bge-small q8 **6.2ms**, EmbeddingGemma q4 **26.5ms**. Bun had teardown crashes with it (#19917/#30431; fix merged 2026-07-08, presumably in 1.4.0); 3/3 `bun test` runs clean here. `bun --compile` needs patches (#1672).
- **node-llama-cpp 3.21.1 with GGUF:** ~55MB installed, claims bun support; open issues: Metal hang on M5 (#595), ARM64-Linux segfault (#590). Not run; third-party report: Gemma Q8 ~23ms on M1.
- Use documented pooling/prefixes: bge/arctic = CLS pooling + query prefix; nomic/Gemma/Qwen = task prefixes.

**3. Static with zero dependencies: yes, built and run.** BERT-uncased WordPiece (no special tokens) → row lookup → mean → L2. ~60 lines of TS, no imports, reads safetensors directly; tokenization matched transformers.js. **0.04ms/embed** for both models; both ranked my 4 test pairs correctly (potion with wider margins — anecdotal). Versus MiniLM on NanoBEIR retrieval: potion ≈79%, static-retrieval ≈89% (potion's "92%" headline is overall MTEB). Bag-of-words loses order and negation: fuse with lexical, don't replace it.

**4. Subscriptions**
- **Anthropic:** "does not offer its own embedding model" and points to Voyage, which needs a key.
- **ChatGPT Plus/Pro:** no API credit. Embeddings are billed through the API only.
- **`claude -p`:** returns text, never vectors. Since the 2026-06-15 update it "still draw[s] from your subscription's usage limits". A set ANTHROPIC_API_KEY switches it to API billing. Third-party products may not offer claude.ai login without approval. At most: rerank a lexical top-k.

**5. Ollama (port 11434):** `POST /api/embed {model, input: string|string[], dimensions?, truncate?, keep_alive?}` returns `{embeddings: number[][]}`. OpenAI-shaped `/v1/embeddings` also works — the same shape LM Studio and llama-server expose, so one adapter covers all three. Models: nomic-embed-text, mxbai-embed-large, all-minilm, snowflake-arctic-embed, bge-m3, embeddinggemma, qwen3-embedding, granite-embedding.

**Recommendation.** *Zero-dependency:* static-retrieval-mrl-en-v1 sliced to 256d (31MB F32; ~16MB as f16 with a small decode) plus the 60-line embedder: 0.04ms, ≈89% of MiniLM retrieval. potion-base-8M (same size, MIT) is benchmark-weaker; same code runs both, so pick on your own recall set. *Real model:* bge-small-en-v1.5 q8 (MIT, 34MB download, 6ms measured) via transformers.js as an optional dynamic import — cost 471MB node_modules; node-llama-cpp (~55MB) if install weight beats tested-under-bun.

Sources: https://platform.claude.com/docs/en/build-with-claude/embeddings · https://support.claude.com/en/articles/15036540 (2026-06-15) · https://code.claude.com/docs/en/agent-sdk/overview · https://folding-sky.com/blog/why-use-api-keys-not-chatgpt (OpenAI help center 403'd) · https://github.com/MinishLab/model2vec/blob/main/results/README.md · https://huggingface.co/blog/static-embeddings (2025-01-15) · https://huggingface.co/Snowflake/snowflake-arctic-embed-xs · https://huggingface.co/ibm-granite/granite-embedding-small-english-r2 · https://huggingface.co/google/embeddinggemma-300m · https://huggingface.co/Qwen/Qwen3-Embedding-0.6B · https://huggingface.co/voyageai/voyage-4-nano · https://github.com/oven-sh/bun/issues/30431 · https://github.com/huggingface/transformers.js/issues/1672 · https://github.com/AlfoldiMate/agmem/pull/182 · https://docs.ollama.com/api/embed · https://ollama.com/search?c=embedding

## Appendix — the zero-dependency static embedder proof (static-retrieval-mrl-en-v1 version)

```ts
// Zero-dependency model2vec (potion) embedder: BERT basic tokenizer + WordPiece + table lookup + mean + L2.
const buf = new Uint8Array(await Bun.file("model.safetensors").arrayBuffer());
const hlen = Number(new DataView(buf.buffer).getBigUint64(0, true));
const header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hlen)));
const { shape, data_offsets } = header["embedding.weight"];
const [rows, dim] = shape; const DIM = Number(process.env.DIM ?? dim);
const table = new Float32Array(buf.buffer.slice(8 + hlen + data_offsets[0], 8 + hlen + data_offsets[1]));
const vocab = new Map<string, number>();
(await Bun.file("vocab.txt").text()).split("\n").forEach((t, i) => t && vocab.set(t, i));
const UNK = vocab.get("[UNK]")!;
const isPunct = (c: string) => /[\p{P}\p{S}]/u.test(c) || /[!-\/:-@\[-`{-~]/.test(c);
function basicTokenize(text: string): string[] {
  text = text.replace(/[\u0000�\p{Cc}]/gu, (c) => (/\s/.test(c) ? " " : ""));
  text = text.replace(/[一-鿿㐀-䶿豈-﫿]/g, (c) => ` ${c} `);
  text = text.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
  const out: string[] = [];
  for (const w of text.split(/\s+/)) {
    let cur = "";
    for (const ch of w) { if (isPunct(ch)) { if (cur) out.push(cur); out.push(ch); cur = ""; } else cur += ch; }
    if (cur) out.push(cur);
  }
  return out;
}
function wordpiece(word: string): number[] {
  if (word.length > 100) return [UNK];
  const ids: number[] = []; let start = 0;
  while (start < word.length) {
    let end = word.length, id = -1;
    while (start < end) { const sub = (start > 0 ? "##" : "") + word.slice(start, end); const v = vocab.get(sub); if (v !== undefined) { id = v; break; } end--; }
    if (id < 0) return [UNK];
    ids.push(id); start = end;
  }
  return ids;
}
export function embed(text: string): Float32Array {
  const ids = basicTokenize(text).flatMap(wordpiece).filter((i) => i !== UNK).slice(0, 512);
  const v = new Float32Array(DIM);
  for (const id of ids) for (let d = 0, o = id * dim; d < DIM; d++) v[d] += table[o + d];
  let n = 0; for (let d = 0; d < DIM; d++) n += v[d] * v[d]; n = Math.sqrt(n) + 1e-32;
  for (let d = 0; d < DIM; d++) v[d] /= n;
  return v;
}
const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
const text = "The owner prefers to decide things in conversation rather than across many markdown documents, and wants answers that are self-contained and moderately concise, a few items at a time. He now runs the published npm install on a fresh store he started that day, and the old hooks are switched off, so the development repository is nothing more than a place to build. Tests are hermetic and never touch the live stores; decisions are defaults that stay revisable.";
embed(text); const N = 2000; let t0 = performance.now();
for (let i = 0; i < N; i++) embed(text + i);
console.log(`rows=${rows} dim=${dim} ms/embed=${((performance.now() - t0) / N).toFixed(3)}`);
const pairs: [string, string][] = [
  ["he likes to talk decisions through out loud", "the owner prefers to decide things in conversation"],
  ["he likes to talk decisions through out loud", "the database uses write-ahead logging"],
  ["never open the live memory store from a test", "tests must not touch the real data directory"],
  ["never open the live memory store from a test", "the website launched with a coming-soon page"],
];
for (const [a, b] of pairs) console.log(cos(embed(a), embed(b)).toFixed(3), "|", a, "<->", b);
```
