/**
 * `core/embed/static` — the zero-dependency static embedder.
 *
 * Hermetic by default: every loader test writes a TINY synthetic table (a few
 * rows, four columns) into a fresh temp dir, so the suite needs no 30 MB file
 * and no network. The basic tokenizer is checked against HF `tokenizers` output
 * recorded once (`static-embed-fixture.ts`) — that half is vocabulary-free and
 * runs every time.
 *
 * The real-table half (WordPiece ids, the vector head, the four pairs from the
 * research proof) runs only when the weights are named:
 *
 *   COUNTERPARTS_STATIC_WEIGHTS_DIR=<dir with potion's model.safetensors + vocab.txt>
 *   COUNTERPARTS_STATIC_RETRIEVAL_DIR=<dir with static-retrieval-mrl-en-v1's, vocab derived>
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MAX_TOKENS,
  STATIC_WEIGHTS_ENV,
  StaticEmbedderError,
  basicTokenize,
  decodeF16,
  loadStaticModel,
  resolveStaticWeights,
  wordpiece,
} from "../src/core/embed/static.js";
import { TOKENIZER_CASES } from "./static-embed-fixture.js";

// ── a synthetic table ────────────────────────────────────────────────────────

const VOCAB = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "hello", "world", "##s", "test", ",", "the", "cafe"];

/** Row i = a distinct, readable vector, so a mean can be computed by hand. */
function rowOf(i: number): number[] {
  return [i + 1, (i % 3) - 1, i % 2 === 0 ? 0.5 : -0.5, 1];
}

function writeSafetensors(path: string, name: string, rows: number[][], dtype: "F32" | "F16" = "F32"): void {
  const width = rows[0]?.length ?? 0;
  const flat = rows.flat();
  let bytes: Uint8Array;
  if (dtype === "F32") {
    bytes = new Uint8Array(new Float32Array(flat).buffer);
  } else {
    const halves = new Uint16Array(flat.map(toF16));
    bytes = new Uint8Array(halves.buffer);
  }
  let header = JSON.stringify({ [name]: { dtype, shape: [rows.length, width], data_offsets: [0, bytes.byteLength] } });
  while ((8 + header.length) % 8 !== 0) header += " ";
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(8 + headerBytes.byteLength + bytes.byteLength);
  new DataView(out.buffer).setBigUint64(0, BigInt(headerBytes.byteLength), true);
  out.set(headerBytes, 8);
  out.set(bytes, 8 + headerBytes.byteLength);
  writeFileSync(path, out);
}

/** Exact for the small integers and halves the synthetic rows use. */
function toF16(x: number): number {
  if (x === 0) return 0;
  const sign = x < 0 ? 0x8000 : 0;
  const a = Math.abs(x);
  const exp = Math.floor(Math.log2(a));
  const frac = Math.round((a / 2 ** exp - 1) * 1024);
  return sign | ((exp + 15) << 10) | frac;
}

function makeTable(dir: string, opts: { name?: string; dtype?: "F32" | "F16"; vocab?: string[] } = {}): void {
  const vocab = opts.vocab ?? VOCAB;
  writeSafetensors(join(dir, "model.safetensors"), opts.name ?? "embeddings", VOCAB.map((_, i) => rowOf(i)), opts.dtype);
  writeFileSync(join(dir, "vocab.txt"), `${vocab.join("\n")}\n`);
}

function unit(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

function meanOf(ids: number[], dim = 4): number[] {
  const acc = new Array<number>(dim).fill(0);
  for (const id of ids) rowOf(id).slice(0, dim).forEach((x, d) => (acc[d] = (acc[d] ?? 0) + x));
  return acc;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-static-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the basic tokenizer — HF BertNormalizer + BertPreTokenizer parity", () => {
  // Vocabulary-free, so it runs on every machine: 21 adversarial strings
  // (accents, Greek final sigma, CJK, emoji, symbols, every whitespace and
  // control shape, zero-width and soft hyphen, a 110-char word, empty input).
  for (const c of TOKENIZER_CASES) {
    test(`pieces: ${JSON.stringify(c.text).slice(0, 48)}`, () => {
      expect(basicTokenize(c.text)).toEqual([...c.pieces]);
    });
  }

  test("symbols are NOT punctuation to BERT; ASCII symbols are", () => {
    // `©` and `→` are Unicode S*, so they stay attached; `$` and `|` are ASCII
    // punctuation by BERT's table even though Unicode calls them symbols.
    expect(basicTokenize("a©b")).toEqual(["a©b"]);
    expect(basicTokenize("a$b|c")).toEqual(["a", "$", "b", "|", "c"]);
  });

  test("a vertical tab is REMOVED, not spaced (HF clean_text)", () => {
    expect(basicTokenize("ab\u000bcd")).toEqual(["abcd"]);
    expect(basicTokenize("ab\tcd")).toEqual(["ab", "cd"]);
  });
});

describe("WordPiece", () => {
  const vocab = new Map(VOCAB.map((t, i) => [t, i] as const));

  test("whole word, then greedy longest-match continuation", () => {
    expect(wordpiece("hello", vocab, 1)).toEqual([5]);
    expect(wordpiece("worlds", vocab, 1)).toEqual([6, 7]);
  });

  test("a word with no full decomposition is ONE unk, never a partial", () => {
    expect(wordpiece("worldz", vocab, 1)).toEqual([1]);
  });

  test("over 100 code points is unk; an emoji counts as one", () => {
    expect(wordpiece("s".repeat(101), vocab, 1)).toEqual([1]);
    const v = new Map([["🙂", 0]]);
    expect(wordpiece("🙂", v, 9)).toEqual([0]);
  });
});

describe("loadStaticModel — a synthetic table", () => {
  test("loads rows, width, identity from the directory name or the option", () => {
    makeTable(dir);
    const m = loadStaticModel({ dir, model: "tiny" });
    expect(m.rows).toBe(VOCAB.length);
    expect(m.width).toBe(4);
    expect(m.dim).toBe(4);
    expect(m.identity).toBe("tiny@4");
    expect(m.dtype).toBe("F32");
    expect(m.tensor).toBe("embeddings");
    expect(m.maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  test("the model name falls back to package.json's counterparts.model", () => {
    makeTable(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", counterparts: { model: "named-here" } }));
    expect(loadStaticModel({ dir }).identity).toBe("named-here@4");
  });

  test("the vector is the L2-normalized MEAN of the known tokens, UNK dropped", () => {
    makeTable(dir);
    const m = loadStaticModel({ dir, model: "tiny" });
    // hello , worlds ! → [5, 9, 6, 7] and `!` is not in the vocabulary (UNK, dropped)
    expect(m.tokenIds("Hello, worlds!")).toEqual([5, 9, 6, 7]);
    const got = m.embed("Hello, worlds!");
    const want = unit(meanOf([5, 9, 6, 7]));
    expect(got).not.toBeNull();
    got?.forEach((x, i) => expect(x).toBeCloseTo(want[i] ?? 0, 6));
  });

  test("accents are stripped before lookup (café → cafe)", () => {
    makeTable(dir);
    const m = loadStaticModel({ dir, model: "tiny" });
    expect(m.tokenIds("Café")).toEqual([11]);
  });

  test("a literal special token is ONE id (HF added vocabulary), and [UNK] is still dropped", () => {
    makeTable(dir);
    const m = loadStaticModel({ dir, model: "tiny" });
    expect(m.tokenIds("the[MASK]test")).toEqual([10, 4, 8]);
    expect(m.tokenIds("[UNK] hello")).toEqual([5]);
  });

  test("deterministic: the same text gives the same bytes, across loads", () => {
    makeTable(dir);
    const a = loadStaticModel({ dir, model: "tiny" });
    const b = loadStaticModel({ dir, model: "tiny" });
    expect(a.embed("the test worlds")).toEqual(a.embed("the test worlds"));
    expect(a.embed("the test worlds")).toEqual(b.embed("the test worlds"));
  });

  test("empty, whitespace-only and UNK-only input is NULL — never a zero vector", () => {
    makeTable(dir);
    const m = loadStaticModel({ dir, model: "tiny" });
    expect(m.embed("")).toBeNull();
    expect(m.embed("   \n\t")).toBeNull();
    expect(m.embed("zzz qqq !!!")).toBeNull();
    expect(m.embed("[UNK]")).toBeNull();
  });

  test("the DIM slice keeps the leading columns and renormalizes over them", () => {
    makeTable(dir);
    const m = loadStaticModel({ dir, model: "tiny", dim: 2 });
    expect(m.dim).toBe(2);
    expect(m.identity).toBe("tiny@2");
    const got = m.embed("hello the");
    const want = unit(meanOf([5, 10], 2));
    expect(got?.length).toBe(2);
    got?.forEach((x, i) => expect(x).toBeCloseTo(want[i] ?? 0, 6));
  });

  test("sentence-transformers' tensor name loads through the same code", () => {
    makeTable(dir, { name: "embedding.weight" });
    const m = loadStaticModel({ dir, model: "st" });
    expect(m.tensor).toBe("embedding.weight");
    expect(m.embed("hello")).not.toBeNull();
  });

  test("an F16 table decodes to the same vectors (exact for these values)", () => {
    makeTable(dir);
    const f32 = loadStaticModel({ dir, model: "tiny" });
    const dir16 = mkdtempSync(join(tmpdir(), "cp-static16-"));
    try {
      makeTable(dir16, { dtype: "F16" });
      const f16 = loadStaticModel({ dir: dir16, model: "tiny" });
      expect(f16.dtype).toBe("F16");
      expect(f16.embed("hello worlds the")).toEqual(f32.embed("hello worlds the"));
    } finally {
      rmSync(dir16, { recursive: true, force: true });
    }
  });

  test("decodeF16: zero, subnormal, one, negative, infinity", () => {
    const out = decodeF16(new Uint16Array([0x0000, 0x0001, 0x3c00, 0xc000, 0x7c00]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(2 ** -24, 30);
    expect(out[2]).toBe(1);
    expect(out[3]).toBe(-2);
    expect(out[4]).toBe(Infinity);
  });

  test("the text is clipped to maxTokens × medianTokenLength chars, then maxTokens ids", () => {
    makeTable(dir);
    const m = loadStaticModel({ dir, model: "tiny", maxTokens: 3 });
    // The median token length of VOCAB is 5 (sorted lengths' middle pair 5,5),
    // so the string is cut to 15 characters before tokenizing: the third
    // `hello` arrives as `hel`, which is unknown and dropped.
    expect(m.maxChars).toBe(15);
    expect(m.tokenIds("hello hello hello")).toEqual([5, 5]);
    // And the ids are capped after: six one-character tokens, three kept.
    expect(m.tokenIds(",,,,,,")).toEqual([9, 9, 9]);
  });
});

describe("loadStaticModel — refusals, by name", () => {
  const code = (fn: () => unknown): string | null => {
    try {
      fn();
      return null;
    } catch (err) {
      return err instanceof StaticEmbedderError ? err.code : "OTHER";
    }
  };

  test("missing files", () => {
    expect(code(() => loadStaticModel({ dir }))).toBe("MISSING_FILE");
    makeTable(dir);
    rmSync(join(dir, "vocab.txt"));
    expect(code(() => loadStaticModel({ dir }))).toBe("MISSING_FILE");
  });

  test("a header that does not parse", () => {
    writeFileSync(join(dir, "model.safetensors"), new Uint8Array([5, 0, 0, 0, 0, 0, 0, 0, 123, 123, 123, 0, 0]));
    writeFileSync(join(dir, "vocab.txt"), "a\n");
    expect(code(() => loadStaticModel({ dir }))).toBe("BAD_SAFETENSORS");
  });

  test("no recognized tensor", () => {
    makeTable(dir, { name: "something.else" });
    expect(code(() => loadStaticModel({ dir }))).toBe("NO_TENSOR");
  });

  test("a vocabulary whose size disagrees with the table", () => {
    makeTable(dir, { vocab: VOCAB.slice(0, 5) });
    expect(code(() => loadStaticModel({ dir }))).toBe("BAD_VOCAB");
  });

  test("a slice wider than the table, or not a positive integer", () => {
    makeTable(dir);
    expect(code(() => loadStaticModel({ dir, dim: 5 }))).toBe("BAD_DIM");
    expect(code(() => loadStaticModel({ dir, dim: 0 }))).toBe("BAD_DIM");
  });
});

describe("resolveStaticWeights — option, then env, then the package", () => {
  test("an explicit option wins over the environment", () => {
    expect(resolveStaticWeights({ dir: "/x", env: { [STATIC_WEIGHTS_ENV]: "/y" } })).toEqual({
      dir: "/x",
      source: "option",
    });
  });

  test("the environment variable is second", () => {
    expect(resolveStaticWeights({ env: { [STATIC_WEIGHTS_ENV]: " /y " } })).toEqual({ dir: "/y", source: "env" });
  });

  test("with neither, it is the installed package or nothing — never a guess", () => {
    const got = resolveStaticWeights({ env: {} });
    expect(got === null || got.source === "package").toBe(true);
  });
});

// ── the real tables (opt-in) ───────────────────────────────────────────────

const POTION = process.env[STATIC_WEIGHTS_ENV];
const RETRIEVAL = process.env["COUNTERPARTS_STATIC_RETRIEVAL_DIR"];

describe.skipIf(POTION === undefined || POTION === "")("potion-base-8M — the real table", () => {
  test("WordPiece ids match HF tokenizers on every fixture string ([UNK] dropped)", () => {
    const m = loadStaticModel({ dir: POTION ?? "", maxTokens: 1_000_000 });
    for (const c of TOKENIZER_CASES) {
      expect(m.tokenIds(c.text)).toEqual(c.potionIds.filter((id) => id !== 1));
    }
  });

  test("the vector head matches model2vec's encode to 1e-5", () => {
    const m = loadStaticModel({ dir: POTION ?? "" });
    for (const c of TOKENIZER_CASES) {
      const v = m.embed(c.text);
      if (c.potionHead.every((x) => x === 0)) {
        expect(v).toBeNull();
        continue;
      }
      expect(v).not.toBeNull();
      c.potionHead.forEach((x, i) => expect(Math.abs((v?.[i] ?? 0) - x)).toBeLessThan(1e-5));
    }
  });

  test("the research proof's four pairs: related 0.58 / 0.42, unrelated 0.06 / 0.09", () => {
    const m = loadStaticModel({ dir: POTION ?? "" });
    const cos = (a: string, b: string): number => {
      const x = m.embed(a) ?? [];
      const y = m.embed(b) ?? [];
      return x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    };
    const talk = "he likes to talk decisions through out loud";
    const store = "never open the live memory store from a test";
    expect(cos(talk, "the owner prefers to decide things in conversation")).toBeCloseTo(0.58, 2);
    expect(cos(talk, "the database uses write-ahead logging")).toBeCloseTo(0.062, 2);
    expect(cos(store, "tests must not touch the real data directory")).toBeCloseTo(0.42, 2);
    expect(cos(store, "the website launched with a coming-soon page")).toBeCloseTo(0.092, 2);
  });
});

describe.skipIf(RETRIEVAL === undefined || RETRIEVAL === "")("static-retrieval-mrl-en-v1 — the comparison table", () => {
  test("its WordPiece ids match HF tokenizers too — same code, other vocabulary", () => {
    const m = loadStaticModel({ dir: RETRIEVAL ?? "", dim: 256, maxTokens: 1_000_000 });
    expect(m.tensor).toBe("embedding.weight");
    expect(m.width).toBe(1024);
    expect(m.dim).toBe(256);
    for (const c of TOKENIZER_CASES) {
      expect(m.tokenIds(c.text)).toEqual(c.staticRetrievalIds.filter((id) => id !== 100));
    }
  });
});
