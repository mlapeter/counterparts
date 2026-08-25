import { describe, expect, test } from "bun:test";
import { batteryGate, gateSweepChunk } from "../src/core/bridge.js";
import type { GateInput } from "../src/core/remember/index.js";
import type { Proposal as EncodeProposal } from "../src/core/encode/index.js";
import type { SweepChunk } from "../src/core/remember/index.js";

function gi(over: Partial<GateInput> = {}): GateInput {
  return {
    content: "Mike decided the storage split should keep prose in markdown files.",
    kind: "fact",
    aliases: [],
    feeling: null,
    title: null,
    claimed: null,
    salience: {},
    span: { hash: "h1", text: "Mike decided the storage split should keep prose in markdown files." },
    source: "session-end",
    day: 3,
    ...over,
  };
}

describe("bridge — the remember→encode composition (SEAMS 1–3)", () => {
  test("a clean session-end proposal passes the battery through the bridge", async () => {
    const verdict = await batteryGate()(gi());
    expect(verdict.ok).toBe(true);
  });

  test("a body secret is REDACTED, not fatal — the cleaned content is what survives", async () => {
    const verdict = await batteryGate()(
      gi({ content: "the deploy key is AKIAIOSFODNN7EXAMPLE and rotating it is on the list" }),
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.content.includes("AKIAIOSFODNN7EXAMPLE")).toBe(false);
    }
  });

  test("a floor refusal maps to refusedByDesign — a working gate, not a broken one", async () => {
    const verdict = await batteryGate()(gi({ content: "x" }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) {
      expect(verdict.refusedByDesign).toBe(true);
      expect(verdict.reason.length).toBeGreaterThan(0);
    }
  });

  test("the emotion exemption is ENGINE-SET from source: session-end feelings pass, sweep feelings do not", async () => {
    const feeling = { feeling: "pride", quote: "genuinely proud of the seam work", subject: "self" };
    const span = {
      hash: "h2",
      text: "I was genuinely proud of the seam work today, it held everything together.",
    };
    const content = "The seam discipline held all day and it mattered.";

    const authored = await batteryGate()(gi({ content, feeling, span, source: "session-end" }));
    expect(authored.ok).toBe(true);

    // The same input arriving from the crash-fallback sweep gets no exemption:
    // gateSweepChunk strips selfAuthoredFeeling even if the interpreter claimed it.
    const chunk: SweepChunk = {
      index: 0,
      spans: [{ text: span.text } as never],
      marked: [],
      prompt: span.text,
      bytes: span.text.length,
    };
    const swept: EncodeProposal = {
      ref: "p1",
      content,
      kind: "fact",
      feeling: { type: "pride", quote: feeling.quote, subject: "self" },
      selfAuthoredFeeling: true, // hallucinated by the interpreter — must be stripped
    };
    const result = gateSweepChunk(chunk, [swept], 3);
    // The strip is the seam's job: no trace of a granted exemption survives.
    const json = JSON.stringify(result);
    expect(json.includes('"selfAuthoredFeeling":true')).toBe(false);
  });

  test("claimed salience and dimensions reach the battery (all-or-nothing dims)", async () => {
    const verdict = await batteryGate()(
      gi({ claimed: 0.8, salience: { relevance: 0.9, emotional: 0.4, predictive: 0.7 } }),
    );
    expect(verdict.ok).toBe(true);
  });

  test("a secret in the TITLE refuses the whole proposal (title is a handle)", async () => {
    const verdict = await batteryGate()(
      gi({ title: "deploy key AKIAIOSFODNN7EXAMPLE" }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) expect(verdict.refusedByDesign).toBe(true);
  });

  test("an all-rejected sweep chunk yields ZERO durable effects (SEAMS 1, through the composition)", () => {
    const chunk: SweepChunk = {
      index: 1,
      spans: [{ text: "token dump follows" } as never],
      marked: [],
      prompt: "token dump follows",
      bytes: 18,
    };
    const badProposals: EncodeProposal[] = [
      { ref: "a", content: "x", kind: "fact" }, // below the content floor
      { ref: "b", content: "yz", kind: "fact" }, // below the content floor
    ];
    const result = gateSweepChunk(chunk, badProposals, 3);
    expect(result.fullyGated).toBe(true);
    expect(result.effects).toEqual([]);
    expect(result.predictionChecks).toEqual([]);
  });
});
