/**
 * `encode/` — the bouncer's guarantee suite (CONTRACT.md §5) plus the named scars.
 *
 * Encode is pure — it holds no store handle and computes no I/O — so most of this
 * file needs no data dir. The one test that opens a real `Store` does so to prove
 * a negative that only a real substrate can prove: a fully-gated chunk leaves the
 * data directory byte-for-byte as it found it. That test is hermetic the way
 * CLAUDE.md requires: a fresh `mkdtempSync` temp dir via `COUNTERPARTS_DATA_DIR`
 * in `beforeEach`, and ONLY that path removed in `afterEach`.
 *
 * House rule (the tests-lie scar): assert the REASON, not just the outcome. A
 * verdict that comes back right for the wrong reason is a test that lies.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import * as encode from "../src/core/encode/index.js";
import {
  CHANNELS,
  EncodeError,
  GATES,
  SECRET_FAMILIES,
  TUNABLES,
  assertNoBypassOption,
  computeNovelty,
  containsSecret,
  contentFloor,
  countWholeWord,
  emotionClassifierRecord,
  encodeChunk,
  escapeRegExp,
  floorRefusals,
  gateAliases,
  gateEmotion,
  gateProposal,
  hedgePrecision,
  mentionsSchema,
  occursAsWholeWord,
  preselectSchemas,
  redactSecrets,
  renderSchemaContext,
  scanSecrets,
  tagSalience,
  wholeWordRegex,
} from "../src/core/encode/index.js";
import type {
  GateRecord,
  Preselection,
  Proposal,
  SchemaSlice,
  SecretsGateRecord,
} from "../src/core/encode/index.js";
import { sal } from "../src/core/physics/index.js";
import { DATA_DIR_ENV, Store } from "../src/core/store/index.js";

const ENCODE_SRC = fileURLToPath(new URL("../src/core/encode/", import.meta.url));
const SRC_FILES = readdirSync(ENCODE_SRC).filter((f) => f.endsWith(".ts"));

function source(file: string): string {
  return readFileSync(join(ENCODE_SRC, file), "utf8");
}

/**
 * Comments are prose and prose says things like "no off switch". The scans below
 * are about CODE, so comments come off first. Every comment in this module lives
 * on its own line (asserted, so the stripper cannot silently start missing some).
 */
function codeOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** One live-shaped specimen per family. `marker` is the fragment that must never
 *  survive into any output. */
const SPECIMENS: { family: string; text: string; marker: string }[] = [
  {
    family: "google-api-key",
    text: "AIzaSyD-1234567890abcdefghijklmnopqrstuv",
    marker: "AIzaSyD-1234567890abcdefghijklmnopqrstuv",
  },
  {
    family: "aws-access-key-id",
    text: "AKIAIOSFODNN7EXAMPLE",
    marker: "AKIAIOSFODNN7EXAMPLE",
  },
  {
    family: "github-token",
    text: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    marker: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  },
  {
    family: "gitlab-token",
    text: "glpat-abcdefghijklmnopqrst",
    marker: "glpat-abcdefghijklmnopqrst",
  },
  {
    family: "npm-token",
    text: "npm_abcdefghijklmnopqrstuvwxyz0123456789",
    marker: "npm_abcdefghijklmnopqrstuvwxyz0123456789",
  },
  {
    family: "slack-token",
    text: "xoxb-123456789012-abcdefghijkl",
    marker: "xoxb-123456789012-abcdefghijkl",
  },
  {
    family: "stripe-key",
    text: "sk_live_abcdefghij1234567890",
    marker: "sk_live_abcdefghij1234567890",
  },
  {
    family: "model-provider-key",
    text: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    marker: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
  },
  {
    family: "jwt",
    text: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    marker: "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  },
  {
    family: "bearer-token",
    text: "Bearer abcdefghijklmnopqrstuvwxyz012345",
    marker: "abcdefghijklmnopqrstuvwxyz012345",
  },
  {
    family: "url-credentials",
    text: "postgres://svc:hunter2secret@db.example.com/app",
    marker: "hunter2secret",
  },
  {
    family: "url-path-token",
    text: "the staff link is https://hearddd.example/login/g6jXw2mQpR9tnw and it works",
    marker: "g6jXw2mQpR9tnw",
  },
  {
    family: "assigned-credential",
    text: "password: correct-horse-battery",
    marker: "correct-horse-battery",
  },
  {
    family: "private-key-block",
    text: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA9\n-----END RSA PRIVATE KEY-----",
    marker: "MIIEowIBAAKCAQEA9",
  },
];

const REAL_SPAN =
  "Mike uses bun, not npm, for everything in this repo, and the tests are hermetic.";
const REAL_CONTENT = "Mike uses bun, not npm, for everything in this repo";

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    ref: "p1",
    content: REAL_CONTENT,
    kind: "fact",
    ...over,
  };
}

const NO_NOVELTY = computeNovelty(null, []);

function gate(p: Proposal, span = REAL_SPAN) {
  return gateProposal({ proposal: p, span, novelty: NO_NOVELTY });
}

function recordFor(records: readonly GateRecord[], gateName: string): GateRecord {
  const r = records.find((x) => x.gate === gateName);
  if (r === undefined) throw new Error(`no record for gate ${gateName}`);
  return r;
}

// ===========================================================================
describe("guarantee 1 — the secrets gate is NOT ABLATABLE", () => {
  test("catches every standard family it claims, by name", () => {
    for (const s of SPECIMENS) {
      const scan = scanSecrets(`before ${s.text} after`);
      expect(scan.fired).toBe(true);
      expect(scan.findings.map((f) => f.family)).toContain(s.family);
      expect(scan.redacted).not.toContain(s.marker);
      expect(scan.redacted).toContain(`[REDACTED:${s.family}]`);
      // Softening the body around it, never dropping it.
      expect(scan.redacted).toContain("before");
      expect(scan.redacted).toContain("after");
    }
  });

  test("url-path-token is scoped to TOKENS on auth-shaped paths — prose URLs never fire it", () => {
    // The family exists because a magic-login link minted whole (review Gap A).
    // Its cost ceiling is that ordinary technical prose stays untouched — the
    // clean list below includes the PR-1 review's live counterexamples, which
    // the first cut of this family redacted (blocker 1): a lowercase
    // hyphen-slug is words, not a token.
    for (const clean of [
      "see https://github.com/mlapeter/counterparts/commit/0879c79ab12cd34ef56a for the fix",
      "docs at https://example.com/guide/getting-started-with-replay-harnesses",
      "https://example.com/session/notes says the meeting moved",
      "https://example.com/docs/auth/getting-started-guide",
      "https://github.com/org/repo/blob/main/src/auth/session-manager-impl.ts",
      "https://wiki.example.com/session/quarterly-planning",
      "https://api.example.com/v1/token/refresh-configuration",
      "https://myapp.dev/login/frequently-asked-questions",
      "https://docs.example.com/sso/enterprise-onboarding",
      "https://example.com/verify/email-address-changes",
    ]) {
      const scan = scanSecrets(clean);
      expect({ clean, fired: scan.findings.map((f) => f.family) }).toEqual({
        clean,
        fired: [],
      });
    }
    // And the shapes it exists for still fire: mixed case, digits, and the
    // original live specimen's shape, with and without an extra segment.
    for (const hot of [
      "https://app.example.com/auth/callback/Zx9mQw2Rt8Kp",
      "https://hearddd.example/login/g6jXw2mQpR9tnw",
      "https://x.example/invite/a1b2c3d4e5f6g7h8",
    ]) {
      const scan = scanSecrets(hot);
      expect({ hot, fired: scan.findings.map((f) => f.family) }).toEqual({
        hot,
        fired: ["url-path-token"],
      });
    }
  });

  test("every declared family has a specimen — the table is total, not a sample", () => {
    const declared = SECRET_FAMILIES.map((f) => f.family).sort();
    const covered = [...new Set(SPECIMENS.map((s) => s.family))].sort();
    // `private-key-header` is the truncated form of `private-key-block`; the block
    // specimen proves both cannot pass, so it is covered by its own case below.
    expect(covered).toEqual(declared.filter((f) => f !== "private-key-header"));
  });

  test("a truncated key block is still refused — the header alone fires", () => {
    const scan = scanSecrets("-----BEGIN OPENSSH PRIVATE KEY-----");
    expect(scan.findings.map((f) => f.family)).toEqual(["private-key-header"]);
    expect(scan.emptyAfterRedaction).toBe(true);
  });

  test("NO source file in encode/ contains a disable-shaped identifier", () => {
    const disableShaped =
      /(disable|skip|bypass|ignore|allow|unsafe|force)[A-Za-z0-9]*secret|secrets?[A-Za-z0-9]*(disabled|enabled|off|bypass|skip|flag|toggle|override)/i;
    for (const file of SRC_FILES) {
      expect({ file, hit: disableShaped.test(codeOnly(source(file))) }).toEqual({
        file,
        hit: false,
      });
    }
  });

  test("no field anywhere is a toggle named after the gate", () => {
    const toggleShaped =
      /(secret|redact|credential)[A-Za-z0-9_]*(enabled|disabled|off|bypass|gate|check|scan|toggle|flag)\s*\??\s*:\s*(boolean|true|false)/i;
    const negationShaped =
      /(disable|skip|bypass|ignore|allow|unsafe|force|no)[A-Za-z0-9_]*(secret|redact|credential)[A-Za-z0-9_]*\s*\??\s*:/i;
    for (const file of SRC_FILES) {
      const code = codeOnly(source(file));
      expect({ file, toggle: toggleShaped.test(code), negation: negationShaped.test(code) }).toEqual(
        { file, toggle: false, negation: false },
      );
    }
  });

  test("the module's ENTIRE option vocabulary is three keys, and none names the gate", () => {
    // Enumerated, not argued: these are the only fields any options object in
    // `encode/` declares. A new one has to be added here to pass.
    const OPTION_KEYS = ["emotionClassifier", "semanticCap", "semanticFloor"];
    const declared = new Set<string>();
    for (const file of SRC_FILES) {
      const code = codeOnly(source(file));
      for (const block of code.matchAll(
        /export interface (BatteryOptions|EncodeOptions)[^{]*\{([^}]*)\}/g,
      )) {
        for (const key of (block[2] ?? "").matchAll(/^\s*([A-Za-z0-9_]+)\??:/gm)) {
          declared.add(key[1] ?? "");
        }
      }
    }
    // EncodeOptions extends BatteryOptions, so the union is the whole vocabulary.
    expect([...declared].sort()).toEqual(["emotionClassifier", "semanticCap", "semanticFloor"]);
    for (const key of OPTION_KEYS) expect(/secret|redact|credential/i.test(key)).toBe(false);
  });

  test("no TUNABLE can reach the gate — the knob does not exist", () => {
    for (const key of Object.keys(TUNABLES)) {
      expect(/secret|redact|credential/i.test(key)).toBe(false);
    }
  });

  test("the disabled STATUS is not representable — enforced in the type, not a comment", () => {
    // A runtime test cannot see a type, so it reads the declaration: this is the
    // one place the guarantee lives, and it must not be quietly widened.
    expect(codeOnly(source("types.ts"))).toContain(
      'export type SecretsGateStatus = Exclude<GateStatus, "stood-down">',
    );
  });

  test("an invented bypass option is REFUSED at runtime, by code", () => {
    for (const key of ["disableSecrets", "secretsOff", "skipRedaction", "noCredentialScan"]) {
      let err: unknown;
      try {
        gateProposal(
          { proposal: proposal(), span: REAL_SPAN, novelty: NO_NOVELTY },
          { [key]: true } as unknown as encode.BatteryOptions,
        );
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(EncodeError);
      expect((err as EncodeError).code).toBe("SECRETS_GATE_NOT_ABLATABLE");
      expect((err as EncodeError).detail["key"]).toBe(key);
    }
  });

  test("assertNoBypassOption passes the options that legitimately exist", () => {
    expect(() => assertNoBypassOption({})).not.toThrow();
    expect(() => assertNoBypassOption({ emotionClassifier: true })).not.toThrow();
    expect(() => assertNoBypassOption({ semanticCap: 0, semanticFloor: 0.9 })).not.toThrow();
  });

  test("the gate fires under EVERY combination of the options that DO exist", () => {
    const secret = SPECIMENS[0]!;
    const combos: encode.EncodeOptions[] = [];
    for (const emotionClassifier of [undefined, true, false]) {
      for (const semanticCap of [undefined, 0, 5]) {
        for (const semanticFloor of [undefined, 0, 0.99]) {
          const o: encode.EncodeOptions = {};
          if (emotionClassifier !== undefined) o.emotionClassifier = emotionClassifier;
          if (semanticCap !== undefined) o.semanticCap = semanticCap;
          if (semanticFloor !== undefined) o.semanticFloor = semanticFloor;
          combos.push(o);
        }
      }
    }
    expect(combos.length).toBe(27);
    for (const opts of combos) {
      const result = encodeChunk(
        {
          chunkRef: "c",
          span: `${REAL_SPAN} ${secret.text}`,
          day: 1,
          proposals: [proposal({ content: `${REAL_CONTENT} with key ${secret.text}` })],
        },
        opts,
      );
      const accepted = result.accepted[0];
      expect(accepted).toBeDefined();
      expect(accepted!.content).not.toContain(secret.marker);
      const rec = recordFor(accepted!.records, "secrets") as SecretsGateRecord;
      expect(rec.status).toBe("fired");
      expect(rec.ablatable).toBe(false);
    }
  });

  test("a secrets record NEVER reports stood-down, across the whole input matrix", () => {
    const inputs: Proposal[] = [
      proposal(),
      proposal({ content: SPECIMENS[0]!.text }),
      proposal({ handles: [SPECIMENS[1]!.text] }),
      proposal({ aliases: ["bun"] }),
      proposal({ content: "" }),
      proposal({ feeling: { type: "relief", quote: "hermetic", subject: "self" } }),
    ];
    for (const p of inputs) {
      const rec = recordFor(gate(p).gated.records, "secrets");
      expect(rec.status).not.toBe("stood-down");
      expect(rec.ablatable).toBe(false);
    }
  });

  test("telemetry is content-by-reference: family + count + site, and NEVER the secret", () => {
    const s = SPECIMENS[0]!;
    const out = gate(proposal({ content: `${REAL_CONTENT} key ${s.text}` }));
    const rec = recordFor(out.gated.records, "secrets") as SecretsGateRecord;
    expect(rec.findings).toEqual([{ family: "google-api-key", count: 1, site: "body" }]);
    const wire = JSON.stringify(out);
    expect(wire).not.toContain(s.marker);
    // Nor the secret's HASH: hashing a low-entropy credential is reversible.
    const h = createHash("sha256").update(s.text, "utf8").digest("hex").slice(0, 16);
    expect(wire).not.toContain(h);
    // What IS logged is the hash of the redacted content.
    expect(rec.contentHash.length).toBe(16);
  });

  test("redaction is idempotent — a second pass finds nothing and changes nothing", () => {
    for (const s of SPECIMENS) {
      const once = redactSecrets(`x ${s.text} y`);
      const twice = scanSecrets(once);
      expect(twice.fired).toBe(false);
      expect(twice.redacted).toBe(once);
    }
  });
});

// ===========================================================================
describe("gate totality — every ingestion path this module exposes", () => {
  /**
   * The enumeration scar §7 asks for, in the only form available before there are
   * callers: every export of the module is classified, and the classification set
   * must equal the export set EXACTLY. A new export with no row fails here.
   */
  const ROLES: Record<string, "gated-text" | "verdict" | "definition" | "constant"> = {
    // functions that can return author-supplied text: each must redact its output
    redactSecrets: "gated-text",
    scanSecrets: "gated-text",
    hedgePrecision: "gated-text",
    renderSchemaContext: "gated-text",
    gateProposal: "gated-text",
    encodeChunk: "gated-text",
    gateEmotion: "gated-text",
    gateAliases: "gated-text",
    // functions that take text and return only a verdict — no text path out
    contentFloor: "verdict",
    floorRefusals: "verdict",
    containsSecret: "verdict",
    preselectSchemas: "verdict",
    computeNovelty: "verdict",
    tagSalience: "verdict",
    emotionClassifierRecord: "verdict",
    assertNoBypassOption: "verdict",
    mentionsSchema: "verdict",
    // the shared definitions (§8 G3): booleans, counts, and a RegExp over the
    // caller's own term — nothing of the author's is returned
    occursAsWholeWord: "definition",
    countWholeWord: "definition",
    wholeWordRegex: "definition",
    escapeRegExp: "definition",
    // constants
    GATES: "constant",
    CHANNELS: "constant",
    SELF_SUBJECT: "constant",
    TUNABLES: "constant",
    SECRET_FAMILIES: "constant",
    REDACTION_MARK: "constant",
    EncodeError: "constant",
  };

  test("the classification covers the public surface exactly", () => {
    expect(Object.keys(ROLES).sort()).toEqual(Object.keys(encode).sort());
  });

  test("EVERY text-returning export redacts, whatever order a caller uses it in", () => {
    for (const s of SPECIMENS) {
      const span = `context ${s.text} more context here for the floor to clear`;
      const content = `${REAL_CONTENT} and the key ${s.text}`;
      const schema: SchemaSlice = { id: "sch_1", name: "bun", beliefs: [`key is ${s.text}`] };

      const outputs: string[] = [
        redactSecrets(content),
        scanSecrets(content).redacted,
        hedgePrecision(content, span).text,
        renderSchemaContext(
          preselectSchemas({ chunkRef: "c", span, schemas: [schema] }),
          [schema],
        ),
        JSON.stringify(gate(proposal({ content }), span)),
        JSON.stringify(
          encodeChunk({ chunkRef: "c", span, day: 1, proposals: [proposal({ content })] }),
        ),
        JSON.stringify(gateEmotion({ type: s.text, quote: "context", subject: "self" }, span, true)),
        JSON.stringify(gateAliases([s.text], span)),
      ];
      for (const [i, out] of outputs.entries()) {
        expect({ family: s.family, path: i, leaked: out.includes(s.marker) }).toEqual({
          family: s.family,
          path: i,
          leaked: false,
        });
      }
    }
  });

  test("a schema BELIEF carrying a credential is redacted on its way to the prompt", () => {
    const s = SPECIMENS[2]!;
    const schema: SchemaSlice = {
      id: "sch_1",
      name: "bun",
      beliefs: [`the deploy token is ${s.text}`],
    };
    const pre = preselectSchemas({ chunkRef: "c", span: REAL_SPAN, schemas: [schema] });
    const rendered = renderSchemaContext(pre, [schema]);
    expect(rendered).not.toContain(s.marker);
    expect(rendered).toContain("[REDACTED:github-token]");
  });
});

// ===========================================================================
describe("guarantee 2 — all five checks, one battery, on every proposal", () => {
  const CASES: [string, Proposal][] = [
    ["plain", proposal()],
    ["with a secret", proposal({ content: `${REAL_CONTENT} ${SPECIMENS[0]!.text}` })],
    ["degenerate", proposal({ content: "placeholder" })],
    ["with aliases", proposal({ aliases: ["bun", "npm"] })],
    ["with a feeling", proposal({ feeling: { type: "relief", quote: "hermetic", subject: "self" } })],
    ["with handles", proposal({ handles: ["bun"] })],
    ["empty", proposal({ content: "" })],
  ];

  test("every proposal gets exactly one record per gate, in order, always", () => {
    for (const [name, p] of CASES) {
      const records = gate(p).gated.records;
      expect({ name, gates: records.map((r) => r.gate) }).toEqual({ name, gates: [...GATES] });
      for (const r of records) {
        expect({ name, gate: r.gate, reason: typeof r.reason }).toEqual({
          name,
          gate: r.gate,
          reason: "string",
        });
        expect(r.reason.length).toBeGreaterThan(0);
      }
    }
  });

  test("no gate short-circuits on refusal — a dead proposal is still fully examined", () => {
    const out = gate(
      proposal({
        content: "TBD",
        aliases: ["zz"],
        feeling: { type: "", quote: "", subject: "" },
      }),
    );
    expect(out.gated.accepted).toBe(false);
    // The floor rejected it, and the alias and emotion gates STILL reported.
    expect(recordFor(out.gated.records, "floor").status).toBe("rejected");
    expect(recordFor(out.gated.records, "aliases").status).toBe("refused-by-design");
    expect(recordFor(out.gated.records, "aliases").reason).toBe("alias-too-short");
    expect(recordFor(out.gated.records, "emotion").status).toBe("refused-by-design");
    expect(recordFor(out.gated.records, "emotion").reason).toBe("feeling-untyped");
  });

  test("blockedBy carries EVERY reason; reason is the first (physics' verdict shape)", () => {
    const out = gate(proposal({ content: SPECIMENS[1]!.text }));
    expect(out.gated.accepted).toBe(false);
    if (out.gated.accepted) throw new Error("unreachable");
    expect(out.gated.reason).toBe("empty-after-redaction");
    expect(out.gated.blockedBy).toEqual(["empty-after-redaction", "content-empty"]);
  });

  test("a refused proposal is not a failed batch — rejection is data, not a throw", () => {
    const result = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 3,
      proposals: [proposal({ ref: "a" }), proposal({ ref: "b", content: "todo" })],
    });
    expect(result.accepted.map((a) => a.ref)).toEqual(["a"]);
    expect(result.refused.map((r) => [r.ref, r.reason])).toEqual([["b", "content-stub"]]);
  });
});

// ===========================================================================
describe("guarantee 11 — three distinct records, and the two ways of not acting", () => {
  test('"not-invoked" means nothing was declared', () => {
    const out = gate(proposal());
    expect(recordFor(out.gated.records, "aliases").status).toBe("not-invoked");
    expect(recordFor(out.gated.records, "aliases").reason).toBe("no-aliases-declared");
    expect(recordFor(out.gated.records, "emotion").status).toBe("not-invoked");
    expect(recordFor(out.gated.records, "emotion").reason).toBe("no-feeling-declared");
  });

  test('"clear" means it ran and found nothing — a different fact', () => {
    const out = gate(proposal({ aliases: ["bun"] }));
    expect(recordFor(out.gated.records, "aliases").status).toBe("clear");
    expect(recordFor(out.gated.records, "aliases").reason).toBe("all-aliases-verbatim-and-clean");
    expect(recordFor(out.gated.records, "secrets").reason).toBe("no-credential-shapes-found");
  });

  test('"refused-by-design" is flagged AT the refusal site, not inferred from a message', () => {
    const out = gate(proposal({ aliases: ["ledger"] }));
    const rec = recordFor(out.gated.records, "aliases");
    expect(rec.status).toBe("refused-by-design");
    expect(rec.reason).toBe("alias-not-verbatim-in-source");
    // and the PROPOSAL still landed: losing a handle is not losing the memory
    expect(out.gated.accepted).toBe(true);
  });

  test('"stood-down" is a CHANNEL fact and never a gate fact', () => {
    const off = emotionClassifierRecord(false);
    expect(off.state).toBe("off");
    expect(off.reason).toContain("ships-disabled");
    // asking for a channel that is not there is LOUD; leaving it off is silence
    const asked = emotionClassifierRecord(true);
    expect(asked.state).toBe("skipped");
    expect(asked.reason).toBe("enabled-but-no-classifier-shipped");
    expect(TUNABLES.EMOTION_CLASSIFIER_ENABLED).toBe(false);
  });

  test("the channel roster is total: every declared channel reports on every chunk", () => {
    const result = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 1,
      proposals: [proposal()],
      schemas: [{ id: "sch_1", name: "bun" }],
    });
    expect(result.channels.map((c) => c.channel).sort()).toEqual([...CHANNELS].sort());
    for (const c of result.channels) expect(c.reason.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("the ops rule — a credential must never become an entity the store indexes", () => {
  test("a secret in a NAME rejects the whole operation", () => {
    const out = gate(proposal({ handles: [SPECIMENS[1]!.text] }));
    expect(out.gated.accepted).toBe(false);
    if (out.gated.accepted) throw new Error("unreachable");
    expect(out.gated.reason).toBe("secret-in-name");
    const rec = recordFor(out.gated.records, "secrets") as SecretsGateRecord;
    expect(rec.status).toBe("rejected");
    expect(rec.findings.map((f) => f.site)).toContain("handle");
  });

  test("a clean name is left alone — a name is not a claim, so it is not hedged", () => {
    const out = gate(proposal({ handles: ["2026-07-14"], content: REAL_CONTENT }));
    expect(out.gated.accepted).toBe(true);
    expect(recordFor(out.gated.records, "precision").status).toBe("clear");
  });

  test("a proposal that is nothing but a credential reports BOTH true reasons", () => {
    const out = gate(proposal({ content: SPECIMENS[6]!.text }));
    if (out.gated.accepted) throw new Error("unreachable");
    expect(out.gated.blockedBy).toEqual(["empty-after-redaction", "content-empty"]);
  });
});

// ===========================================================================
describe("guarantee 4 — aliases pass their own secrets scan, AFTER verbatim", () => {
  test("a verbatim-in-source alias that IS a credential is dropped, and counted as a secret", () => {
    const s = SPECIMENS[3]!;
    const span = `the token ${s.text} is in this span`;
    const result = gateAliases([s.text], span);
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([{ index: 0, reason: "alias-is-secret" }]);
    expect(result.secretFindings.map((f) => [f.family, f.site])).toEqual([
      ["gitlab-token", "alias"],
    ]);
  });

  test("the order is verbatim-then-secrets: a non-verbatim secret reports the FIRST failure", () => {
    const result = gateAliases([SPECIMENS[3]!.text], "a span mentioning nothing of the sort");
    expect(result.dropped).toEqual([{ index: 0, reason: "alias-not-verbatim-in-source" }]);
  });

  test("aliases are dropped by INDEX — the alias text never reaches telemetry", () => {
    const out = gate(proposal({ aliases: ["bun", "invented", "zz"] }));
    const rec = recordFor(out.gated.records, "aliases") as encode.AliasGateRecord;
    expect(JSON.stringify(rec)).not.toContain("invented");
    expect(rec.declared).toBe(3);
    expect(rec.kept).toBe(1);
    expect(rec.dropped.map((d) => d.index)).toEqual([1, 2]);
  });

  test("empty and too-short aliases name their own reasons", () => {
    const r = gateAliases(["", "zz", "bun"], REAL_SPAN);
    expect(r.dropped).toEqual([
      { index: 0, reason: "alias-empty" },
      { index: 1, reason: "alias-too-short" },
    ]);
    expect(r.kept).toEqual(["bun"]);
    expect(TUNABLES.ALIAS_MIN_CHARS).toBe(3);
  });
});

// ===========================================================================
describe("guarantee 5 — stated-only emotion, and an exemption that cannot widen", () => {
  const span = 'I said "that landed badly" and moved on.';

  test("a cited quote the span contains, plus a named subject, survives — minus the quote", () => {
    const r = gateEmotion(
      { type: "frustration", quote: "that landed badly", subject: "mike" },
      span,
      false,
    );
    expect(r.verdict).toBe("accepted");
    expect(r.feeling).toEqual({ type: "frustration", subject: "mike" });
    expect(r.quoteStripped).toBe(true);
    expect(JSON.stringify(r.feeling)).not.toContain("that landed badly");
  });

  test("a quote the span does not contain is refused BY DESIGN, and the feeling is NULL", () => {
    const r = gateEmotion(
      { type: "delight", quote: "I was thrilled", subject: "mike" },
      span,
      false,
    );
    expect(r.verdict).toBe("quote-not-in-span");
    expect(r.feeling).toBeNull();
  });

  test("absent means null, NEVER neutral; and encode never types an untyped feeling", () => {
    expect(gateEmotion(null, span, false).feeling).toBeNull();
    expect(gateEmotion(null, span, false).verdict).toBe("no-feeling-declared");
    const untyped = gateEmotion({ type: "  ", quote: "that landed badly", subject: "mike" }, span, false);
    expect(untyped.feeling).toBeNull();
    expect(untyped.verdict).toBe("feeling-untyped");
  });

  test("an unattributed feeling is refused — a feeling needs a subject", () => {
    const r = gateEmotion({ type: "relief", quote: "that landed badly", subject: "" }, span, false);
    expect(r.verdict).toBe("feeling-unattributed");
    expect(r.feeling).toBeNull();
  });

  test("the exemption waives the CITATION and nothing else, and only for the author", () => {
    const ok = gateEmotion({ type: "relief", quote: "", subject: "self" }, "any span", true);
    expect(ok.verdict).toBe("accepted-by-exemption");
    expect(ok.exemption).toBe(true);
    expect(ok.feeling).toEqual({ type: "relief", subject: "self" });
    // still needs a type
    expect(gateEmotion({ type: "", quote: "", subject: "self" }, "s", true).verdict).toBe(
      "feeling-untyped",
    );
  });

  test("THE EXEMPTION CANNOT WIDEN: a claim about someone else's interior takes the ordinary path", () => {
    const r = gateEmotion({ type: "anger", quote: "", subject: "mike" }, "any span", true);
    expect(r.verdict).toBe("exemption-not-available");
    expect(r.exemption).toBe(false);
    expect(r.feeling).toBeNull();
  });

  test("encode never INFERS the exemption — it is an input the engine sets", () => {
    const r = gateEmotion({ type: "relief", quote: "", subject: "self" }, "any span", undefined);
    expect(r.verdict).toBe("quote-missing");
    expect(r.feeling).toBeNull();
  });
});

// ===========================================================================
describe("the content floor — the earned mechanism", () => {
  test('the literal "placeholder" trace that minted this mechanism cannot become a memory', () => {
    const f = contentFloor("placeholder");
    expect(f.ok).toBe(false);
    expect(f.reason).toBe("content-stub");
    expect(floorRefusals(f)).toContain("content-stub");
  });

  test("the stub list is matched EXACTLY after normalization, never as a substring", () => {
    expect(contentFloor("keeps a TODO list in vim and never loses one").ok).toBe(true);
    expect(contentFloor("TODO").reason).toBe("content-stub");
    expect(contentFloor("  n/a  ").reason).toBe("content-stub");
  });

  test("empty, punctuation-only, too short, too few words — each names itself", () => {
    expect(contentFloor("").reason).toBe("content-empty");
    expect(contentFloor("...!!! ***").reason).toBe("content-empty");
    expect(contentFloor("a b c").reason).toBe("content-too-short");
    expect(contentFloor("supercalifragilisticexpialidocious").reason).toBe("content-too-few-words");
  });

  test("redaction placeholders are not content: they are stripped before measuring", () => {
    const redacted = redactSecrets(SPECIMENS[0]!.text);
    expect(redacted.length).toBeGreaterThan(TUNABLES.FLOOR_MIN_CHARS);
    expect(contentFloor(redacted).reason).toBe("content-empty");
  });

  test("a real short memory survives the floor", () => {
    const f = contentFloor("Mike uses bun, not npm");
    expect(f.ok).toBe(true);
    expect(f.reason).toBe("above-floor");
    expect(f.minChars).toBe(20);
    expect(f.minWords).toBe(3);
  });
});

// ===========================================================================
describe("precision — softening, never dropping", () => {
  test("a date the source never stated is hedged to month precision", () => {
    const r = hedgePrecision("we shipped on 2026-07-14", "we shipped it");
    expect(r.text).toBe("we shipped on mid-July 2026");
    expect(r.hedges).toEqual([{ kind: "date", count: 1 }]);
  });

  test("a date the source DID state is left exactly as written", () => {
    const r = hedgePrecision("we shipped on 2026-07-14", "logs say 2026-07-14");
    expect(r.text).toBe("we shipped on 2026-07-14");
    expect(r.fired).toBe(false);
  });

  test("a bare year is hedged; the day band picks early / mid / late", () => {
    expect(hedgePrecision("back in 2019", "back then").text).toBe("back in around 2019");
    expect(hedgePrecision("on 2026-07-03", "x").text).toBe("on early July 2026");
    expect(hedgePrecision("on 2026-07-28", "x").text).toBe("on late July 2026");
  });

  test("a quotation the span never contained keeps its words and loses its quote marks", () => {
    const r = hedgePrecision('he said "exactly this" firmly', "he said something firmly");
    expect(r.text).toBe("he said exactly this firmly");
    expect(r.hedges).toEqual([{ kind: "quote", count: 1 }]);
  });

  test("a quotation the span DID contain keeps its marks", () => {
    const r = hedgePrecision('he said "exactly this"', 'he said "exactly this" firmly');
    expect(r.fired).toBe(false);
  });

  test("an apostrophe is not a quotation", () => {
    const r = hedgePrecision("Mike's tool doesn't break", "nothing at all");
    expect(r.text).toBe("Mike's tool doesn't break");
    expect(r.fired).toBe(false);
  });

  test("one pass only: a hedge's own output is never hedged again", () => {
    const r = hedgePrecision("on 2026-07-14 exactly", "nothing");
    expect(r.text).toBe("on mid-July 2026 exactly");
    expect(r.text).not.toContain("around");
    expect(r.hedges).toEqual([{ kind: "date", count: 1 }]);
  });
});

// ===========================================================================
describe("the ONE whole-word definition (§8 G3) — the measured 21%", () => {
  test('"self" does not match "myself", "itself", or "self-contained"', () => {
    for (const s of ["myself", "itself", "self-contained", "selfish"]) {
      expect({ s, hit: occursAsWholeWord(s, "self") }).toEqual({ s, hit: false });
    }
  });

  test('"self" matches "the self is first-class"', () => {
    expect(occursAsWholeWord("the self is first-class", "self")).toBe(true);
  });

  test("a hyphenated name matches as one word", () => {
    expect(occursAsWholeWord("we use claude-code here", "claude-code")).toBe(true);
    expect(occursAsWholeWord("we use claude-code here", "claude")).toBe(false);
  });

  test("case does not decide verbatim-ness; counts are whole-word counts", () => {
    expect(occursAsWholeWord("Bun is fast", "bun")).toBe(true);
    expect(countWholeWord("bun and bun and bunny", "bun")).toBe(2);
    expect(countWholeWord("", "bun")).toBe(0);
    expect(occursAsWholeWord("anything", "")).toBe(false);
  });

  test("regex metacharacters in a term are escaped, not executed", () => {
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
    expect(occursAsWholeWord("a.b*c is here", "a.b*c")).toBe(true);
    expect(occursAsWholeWord("axbyc is here", "a.b*c")).toBe(false);
    expect(wholeWordRegex("bun").test("bun")).toBe(true);
  });

  test("the mention rule the effects use is the same function", () => {
    expect(mentionsSchema("Mike uses bun", "bun")).toBe(true);
    expect(mentionsSchema("Mike uses bunny", "bun")).toBe(false);
  });
});

// ===========================================================================
describe("preselection — two channels, unioned, and blindness measured", () => {
  const schemas: SchemaSlice[] = [
    { id: "sch_self", name: "self", vector: [1, 0, 0], beliefs: ["I prefer bun"] },
    { id: "sch_bun", name: "bun", aliases: ["bunjs"], vector: [0, 1, 0] },
    { id: "sch_far", name: "kayaking", vector: [0, 0, 1] },
  ];

  test("the union is the point: lexical never gives ground, semantic only adds", () => {
    const pre = preselectSchemas({
      chunkRef: "c",
      span: "self-contained notes about bun",
      schemas,
      chunkVector: [0.95, 0.3, 0],
    });
    expect(pre.lexicalIds).toEqual(["sch_bun"]);
    expect(pre.semanticIds).toEqual(["sch_self"]);
    expect(pre.semanticOnlyIds).toEqual(["sch_self"]);
    expect(pre.overlapIds).toEqual([]);
    expect(pre.shown.map((s) => s.id).sort()).toEqual(["sch_bun", "sch_self"]);
    expect(pre.semantic.state).toBe("ran");
  });

  test("attribution is per schema and includes the overlap", () => {
    const pre = preselectSchemas({
      chunkRef: "c",
      span: "notes about bun",
      schemas,
      chunkVector: [0, 1, 0],
    });
    const bun = pre.shown.find((s) => s.id === "sch_bun");
    expect(bun?.channels.sort()).toEqual(["lexical", "semantic"]);
    expect(pre.overlapIds).toEqual(["sch_bun"]);
    expect(bun?.score).toBeCloseTo(1, 10);
  });

  test("an alias reaches the lexical channel too", () => {
    const pre = preselectSchemas({ chunkRef: "c", span: "we run bunjs here", schemas });
    expect(pre.lexicalIds).toEqual(["sch_bun"]);
  });

  test("DELIBERATELY OFF is silence: cap zero degrades to exactly lexical-only", () => {
    const pre = preselectSchemas({
      chunkRef: "c",
      span: "notes about bun",
      schemas,
      chunkVector: [0, 1, 0],
      semanticCap: 0,
    });
    expect(pre.semantic.state).toBe("off");
    expect(pre.semantic.reason).toBe("cap-zero-deliberately-off");
    expect(pre.semanticIds).toEqual([]);
    expect(pre.lexicalIds).toEqual(["sch_bun"]);
  });

  test("A FAILURE IS A SKIP, and each failure names itself", () => {
    const noVec = preselectSchemas({ chunkRef: "c", span: "notes about bun", schemas });
    expect(noVec.semantic.state).toBe("skipped");
    expect(noVec.semantic.reason).toBe("no-chunk-vector");

    const noSchemaVecs = preselectSchemas({
      chunkRef: "c",
      span: "notes about bun",
      schemas: [{ id: "sch_bun", name: "bun" }],
      chunkVector: [0, 1, 0],
    });
    expect(noSchemaVecs.semantic.reason).toBe("no-schema-vectors");

    const mismatch = preselectSchemas({
      chunkRef: "c",
      span: "notes about bun",
      schemas,
      chunkVector: [0, 1],
    });
    expect(mismatch.semantic.state).toBe("skipped");
    expect(mismatch.semantic.reason).toBe("vector-dimension-mismatch");
    // never a thrown chunk: the worst case is exactly lexical-only
    expect(mismatch.lexicalIds).toEqual(["sch_bun"]);
  });

  test("the floor is applied before the cap, and both are the recorded TUNABLEs", () => {
    const pre = preselectSchemas({
      chunkRef: "c",
      span: "nothing named here",
      schemas,
      chunkVector: [0.5, 0.5, 0.5],
    });
    // every cosine here is ~0.577, below the measured 0.60 floor
    expect(pre.floor).toBe(0.6);
    expect(pre.cap).toBe(2);
    expect(pre.semanticIds).toEqual([]);
    expect(pre.blind).toBe(true);
  });

  test("blindness is COUNTED, not assumed, and gets its own event", () => {
    const pre = preselectSchemas({ chunkRef: "c9", span: "nothing named here", schemas: [] });
    expect(pre.blind).toBe(true);
    const blind = pre.events.find((e) => e.event === "preselect.blind");
    expect(blind?.ref).toBe("c9");
    expect(blind?.data?.["candidates"]).toBe(0);
  });

  test("the render tells the truth about WHY a slice is present", () => {
    const pre = preselectSchemas({
      chunkRef: "c",
      span: "self-contained notes about bun",
      schemas,
      chunkVector: [0.95, 0.3, 0],
    });
    const text = renderSchemaContext(pre, schemas);
    expect(text).toContain("## bun (named in this span)");
    expect(text).toContain("## self (named in — or closely related to — this span)");
    expect(text).not.toContain("## self (named in this span)");
  });

  test("beliefs and current state render VERBATIM; identity core renders compressed", () => {
    const long = "x".repeat(200);
    const s: SchemaSlice = {
      id: "sch_bun",
      name: "bun",
      beliefs: ["Mike prefers bun over npm, always"],
      currentState: ["currently on bun 1.1"],
      identityCore: long,
    };
    const pre = preselectSchemas({ chunkRef: "c", span: "about bun", schemas: [s] });
    const text = renderSchemaContext(pre, [s], 50);
    expect(text).toContain("- belief: Mike prefers bun over npm, always");
    expect(text).toContain("- now: currently on bun 1.1");
    expect(text).toContain("[… 150 further characters elided]");
    expect(text).not.toContain(long);
  });

  test("preselection happens ONCE per chunk: the render takes the result, not the inputs", () => {
    const result = encodeChunk({
      chunkRef: "c",
      span: "self-contained notes about bun",
      day: 1,
      proposals: [proposal()],
      schemas,
      chunkVector: [0.95, 0.3, 0],
    });
    const shown: Preselection = result.preselection;
    // The chunk's blind-rate telemetry and the prompt read the SAME object.
    const rendered = renderSchemaContext(shown, schemas);
    expect(shown.shown.length).toBe(2);
    expect(rendered.split("## ").length - 1).toBe(shown.shown.length);
  });
});

// ===========================================================================
describe("novelty — prediction error, or an explicit null", () => {
  test("blind context comes back NULL, and says why", () => {
    expect(computeNovelty([1, 0, 0], [])).toEqual({
      novelty: null,
      reason: "blind-no-context",
      blind: true,
      contextCount: 0,
    });
  });

  test("a missing chunk vector is a DIFFERENT null with a different reason", () => {
    const r = computeNovelty(null, [[1, 0, 0]]);
    expect(r.novelty).toBeNull();
    expect(r.reason).toBe("no-chunk-vector");
  });

  test("a dimension mismatch degrades to null — it never throws", () => {
    const r = computeNovelty([1, 0, 0], [[1, 0]]);
    expect(r.novelty).toBeNull();
    expect(r.reason).toBe("vector-dimension-mismatch");
  });

  test("with context, it is 1 − max cosine", () => {
    expect(computeNovelty([1, 0, 0], [[1, 0, 0]]).novelty).toBeCloseTo(0, 10);
    expect(computeNovelty([1, 0, 0], [[0, 1, 0]]).novelty).toBeCloseTo(1, 10);
    expect(computeNovelty([1, 0, 0], [[1, 0, 0]]).reason).toBe("computed");
  });

  test("a blind chunk's memory carries a NULL novelty — never a defaulted number", () => {
    const result = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 1,
      proposals: [proposal({ dimensions: { relevance: 0.8, emotional: 0.2, predictive: 0.4 } })],
    });
    const accepted = result.accepted[0]!;
    expect(accepted.salience.novelty).toBeNull();
    expect(result.novelty.blind).toBe(true);
    expect(result.novelty.reason).toBe("no-chunk-vector");
    // physics then averages the THREE supplied dimensions, not four with a zero
    expect(sal(accepted.salience)).toBeCloseTo((0.8 + 0.2 + 0.4) / 3, 10);
    expect(result.events.some((e) => e.event === "encode.blind")).toBe(true);
  });

  test("a claimed floor NEVER rescues a null novelty into a number", () => {
    const result = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 1,
      proposals: [proposal({ claimedSalience: 1 })],
    });
    expect(result.accepted[0]!.salience.novelty).toBeNull();
  });
});

// ===========================================================================
describe("guarantee 6 — the claimed salience is a FLOOR, and the lift emits its event", () => {
  test("the clamp lifts sal(m) and emits salience.lifted with all three numbers", () => {
    const result = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 1,
      proposals: [
        proposal({
          claimedSalience: 0.9,
          dimensions: { relevance: 0.2, emotional: 0.1, predictive: 0.1 },
        }),
      ],
    });
    const accepted = result.accepted[0]!;
    expect(sal(accepted.salience)).toBeCloseTo(0.9, 10);
    const evt = result.events.find((e) => e.event === "salience.lifted");
    expect(evt).toBeDefined();
    expect(evt!.ref).toBe("p1");
    expect(evt!.data?.["claimed"]).toBeCloseTo(0.9, 10);
    expect(evt!.data?.["applied"]).toBeCloseTo(0.9, 10);
    expect(evt!.data?.["computed"]).toBeCloseTo(0.4 / 3, 10);
  });

  test("the stored dimensions are NEVER rewritten to satisfy the claim", () => {
    const tag = tagSalience(
      { relevance: 0.2, emotional: 0.1, predictive: 0.1 },
      0.9,
      computeNovelty(null, []),
    );
    expect(tag.salience.relevance).toBe(0.2);
    expect(tag.salience.emotional).toBe(0.1);
    expect(tag.salience.predictive).toBe(0.1);
    expect(tag.salience.novelty).toBeNull();
    expect(tag.salience.claimed).toBe(0.9);
    expect(tag.lifted).toBe(true);
  });

  test("a claim BELOW the computed value lifts nothing and emits nothing", () => {
    const result = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 1,
      proposals: [
        proposal({
          claimedSalience: 0.1,
          dimensions: { relevance: 0.9, emotional: 0.9, predictive: 0.9 },
        }),
      ],
    });
    expect(result.events.some((e) => e.event === "salience.lifted")).toBe(false);
    expect(sal(result.accepted[0]!.salience)).toBeCloseTo(0.9, 10);
  });

  test("no claim at all is a null floor, not a zero", () => {
    const tag = tagSalience(undefined, undefined, computeNovelty(null, []));
    expect(tag.salience.claimed).toBeNull();
    expect(tag.lifted).toBe(false);
    expect(tag.event).toBeNull();
  });
});

// ===========================================================================
describe("guarantee 3 — GATED MEANS GATED: a fully-gated chunk moves NOTHING", () => {
  const schemas: SchemaSlice[] = [{ id: "sch_bun", name: "bun", vector: [1, 0] }];

  function fullyGatedChunk() {
    return encodeChunk({
      chunkRef: "c_gated",
      span: `notes about bun and the key ${SPECIMENS[0]!.text}`,
      day: 7,
      chunkVector: [1, 0],
      schemas,
      proposals: [
        proposal({ ref: "a", content: SPECIMENS[0]!.text }),
        proposal({ ref: "b", content: "placeholder" }),
        proposal({ ref: "c", content: "TBD", updates: "mem_deadbeef" }),
      ],
      predictionChecks: [
        { schemaId: "sch_bun", ref: "a", outcome: "confirmed" },
        { schemaId: "sch_bun", ref: null, outcome: "contradicted" },
      ],
    });
  }

  test("it is recognized as fully gated, with every proposal's reason recorded", () => {
    const r = fullyGatedChunk();
    expect(r.fullyGated).toBe(true);
    expect(r.accepted).toEqual([]);
    expect(r.refused.map((x) => [x.ref, x.reason])).toEqual([
      ["a", "empty-after-redaction"],
      ["b", "content-stub"],
      ["c", "content-stub"],
    ]);
  });

  test("ZERO durable state, asserted PER STATE KIND — not per happy path", () => {
    const r = fullyGatedChunk();
    expect(r.effects).toEqual([]);
    for (const kind of [
      "memory.create",
      "entity.mention",
      "revision.challenge",
      "prediction.check",
    ]) {
      expect({ kind, moved: r.effects.some((e) => e.effect === kind) }).toEqual({
        kind,
        moved: false,
      });
    }
  });

  test("THE ELEMENT-LEVEL SIDE CHANNEL IS CLOSED: prediction checks are dropped too", () => {
    const r = fullyGatedChunk();
    expect(r.predictionChecks).toEqual([]);
    const evt = r.events.find((e) => e.event === "encode.fullyGated");
    expect(evt).toBeDefined();
    expect(evt!.data?.["droppedPredictionChecks"]).toBe(2);
  });

  test("a chunk with ONE survivor was gated in part, not refused", () => {
    const r = encodeChunk({
      chunkRef: "c_part",
      span: `${REAL_SPAN} and a key ${SPECIMENS[0]!.text}`,
      day: 7,
      chunkVector: [1, 0],
      schemas,
      proposals: [
        proposal({ ref: "a", content: SPECIMENS[0]!.text }),
        proposal({ ref: "b", content: REAL_CONTENT, updates: "mem_deadbeef" }),
      ],
      predictionChecks: [
        { schemaId: "sch_bun", ref: "a", outcome: "confirmed" },
        { schemaId: "sch_bun", ref: "b", outcome: "contradicted" },
      ],
    });
    expect(r.fullyGated).toBe(false);
    // ONLY the survivor's effects exist.
    expect(r.effects.filter((e) => e.effect === "memory.create").map((e) => e.ref)).toEqual(["b"]);
    expect(r.effects.some((e) => e.effect === "revision.challenge")).toBe(true);
    // and only the survivor's prediction check rides along
    expect(r.effects.filter((e) => e.effect === "prediction.check").map((e) => e.ref)).toEqual([
      "b",
    ]);
    expect(r.predictionChecks.length).toBe(2);
  });

  test("a mention that only existed in redacted text is not a mention", () => {
    const s: SchemaSlice = { id: "sch_key", name: "AKIAIOSFODNN7EXAMPLE" };
    const r = encodeChunk({
      chunkRef: "c",
      span: `Mike uses AKIAIOSFODNN7EXAMPLE in this repo for everything here`,
      day: 1,
      schemas: [s],
      proposals: [proposal({ content: "Mike uses AKIAIOSFODNN7EXAMPLE in this repo somewhere" })],
    });
    expect(r.preselection.lexicalIds).toEqual(["sch_key"]);
    expect(r.effects.some((e) => e.effect === "entity.mention")).toBe(false);
  });

  test("a prediction check naming a schema the author never SAW does not survive", () => {
    const r = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 1,
      schemas,
      proposals: [proposal({ ref: "b" })],
      predictionChecks: [{ schemaId: "sch_never_shown", ref: "b", outcome: "confirmed" }],
    });
    expect(r.predictionChecks).toEqual([]);
    expect(r.effects.some((e) => e.effect === "prediction.check")).toBe(false);
  });

  test("an OBSERVER emits no effects, and its stand-down is logged (scar E7)", () => {
    const r = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 1,
      schemas,
      proposals: [proposal()],
      observer: true,
    });
    expect(r.accepted.length).toBe(1);
    expect(r.effects).toEqual([]);
    expect(r.predictionChecks).toEqual([]);
    const evt = r.events.find((e) => e.event === "encode.observer.standdown");
    expect(evt).toBeDefined();
    expect(evt!.data?.["suppressedEffects"]).toBe(true);
  });

  test("an empty chunk is not 'fully gated' — nothing was refused", () => {
    const r = encodeChunk({ chunkRef: "c", span: REAL_SPAN, day: 1, proposals: [] });
    expect(r.fullyGated).toBe(false);
    expect(r.effects).toEqual([]);
  });
});

// ===========================================================================
describe("guarantee 3, structurally — encode cannot write, because it cannot reach", () => {
  test("no file imports the store's write surface", () => {
    for (const file of SRC_FILES) {
      const code = codeOnly(source(file));
      expect({ file, hit: /from ["']\.\.\/store\/index\.js["']/.test(code) }).toEqual({
        file,
        hit: false,
      });
      for (const forbidden of ["Store.open", "new Store", "openOperational", "openCache"]) {
        expect({ file, forbidden, hit: code.includes(forbidden) }).toEqual({
          file,
          forbidden,
          hit: false,
        });
      }
    }
  });

  test("the only store import in the whole module is the content-address function", () => {
    const imports: string[] = [];
    for (const file of SRC_FILES) {
      for (const line of codeOnly(source(file)).split("\n")) {
        if (line.includes("../store/")) imports.push(`${file}: ${line.trim()}`);
      }
    }
    expect(imports).toEqual(['battery.ts: import { hashText } from "../store/prose.js";']);
  });

  test("no file performs I/O or calls a model — vectors are inputs", () => {
    for (const file of SRC_FILES) {
      const code = codeOnly(source(file));
      for (const forbidden of ["node:fs", "node:child_process", "fetch(", "readFileSync", "writeFileSync"]) {
        expect({ file, forbidden, hit: code.includes(forbidden) }).toEqual({
          file,
          forbidden,
          hit: false,
        });
      }
    }
  });

  test("every comment in the module lives on its own line — the scans above depend on it", () => {
    for (const file of SRC_FILES) {
      for (const [n, line] of source(file).split("\n").entries()) {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
        const stripped = t.replace(/:\/\//g, "");
        expect({ file, n, trailing: stripped.includes("//") || stripped.includes("/*") }).toEqual({
          file,
          n,
          trailing: false,
        });
      }
    }
  });
});

// ===========================================================================
describe("gated means gated, against a REAL store", () => {
  let dir: string;
  let priorEnv: string | undefined;
  const open: Store[] = [];

  beforeEach(() => {
    priorEnv = process.env[DATA_DIR_ENV];
    dir = mkdtempSync(join(tmpdir(), "counterparts-encode-"));
    process.env[DATA_DIR_ENV] = dir;
  });

  afterEach(() => {
    for (const s of open.splice(0)) s.close();
    if (priorEnv === undefined) delete process.env[DATA_DIR_ENV];
    else process.env[DATA_DIR_ENV] = priorEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  /** Every file under the data dir, by path and content hash. */
  function snapshot(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (p: string, rel: string) => {
      for (const name of readdirSync(p).sort()) {
        const full = join(p, name);
        const key = rel === "" ? name : `${rel}/${name}`;
        if (statSync(full).isDirectory()) walk(full, key);
        else out[key] = createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    };
    walk(root, "");
    return out;
  }

  test("a fully-gated chunk leaves the data directory byte-for-byte as it found it", () => {
    const store = Store.open();
    open.push(store);
    const before = snapshot(dir);
    const beforeIds = store.list();
    const beforeEvents = store.events().length;
    const beforeDay = store.livedDay();

    const r = encodeChunk({
      chunkRef: "c",
      span: `key ${SPECIMENS[0]!.text}`,
      day: 1,
      schemas: [{ id: "sch_bun", name: "bun" }],
      proposals: [
        proposal({ ref: "a", content: SPECIMENS[0]!.text }),
        proposal({ ref: "b", content: "n/a" }),
      ],
      predictionChecks: [{ schemaId: "sch_bun", ref: "a", outcome: "confirmed" }],
    });

    expect(r.fullyGated).toBe(true);
    expect(r.effects).toEqual([]);
    expect(r.predictionChecks).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
    expect(store.list()).toEqual(beforeIds);
    expect(store.events().length).toBe(beforeEvents);
    expect(store.livedDay()).toBe(beforeDay);
  });

  test("an ACCEPTED chunk still writes nothing — encode returns intents, it does not apply them", () => {
    const store = Store.open();
    open.push(store);
    const before = snapshot(dir);

    const r = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 1,
      proposals: [proposal()],
    });

    expect(r.accepted.length).toBe(1);
    expect(r.effects.map((e) => e.effect)).toEqual(["memory.create"]);
    expect(snapshot(dir)).toEqual(before);
    expect(store.list()).toEqual([]);
  });
});

// ===========================================================================
describe("calibration and telemetry hygiene", () => {
  test("every CAL threshold ships with a recorded measurement, not an intuition", () => {
    const notes = readFileSync(join(ENCODE_SRC, "NOTES.md"), "utf8");
    const tunables = source("tunables.ts");
    expect(TUNABLES.SEMANTIC_FLOOR).toBe(0.6);
    expect(tunables).toContain("0.576");
    expect(tunables).toContain("voyage-3-large");
    expect(notes).toContain("trace-length");
  });

  test("events carry ids, reasons, counts, hashes — and never a body", () => {
    const r = encodeChunk({
      chunkRef: "c",
      span: REAL_SPAN,
      day: 1,
      proposals: [proposal({ aliases: ["invented"] })],
    });
    const wire = JSON.stringify(r.events);
    expect(wire).not.toContain(REAL_CONTENT);
    expect(wire).not.toContain("invented");
    expect(r.events.some((e) => e.event === "encode.chunk")).toBe(true);
  });

  test("containsSecret is the cheap predicate form of the same one scan", () => {
    expect(containsSecret(SPECIMENS[0]!.text)).toBe(true);
    expect(containsSecret(REAL_CONTENT)).toBe(false);
  });

  test("the gate and channel rosters are exported for exactly this kind of check", () => {
    expect([...GATES]).toEqual(["secrets", "precision", "aliases", "emotion", "floor"]);
    expect([...CHANNELS]).toEqual(["emotion-classifier", "semantic-preselection"]);
  });
});
