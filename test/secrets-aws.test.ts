/**
 * The AWS SECRET access key — the half of the pair the shared battery missed.
 *
 * The 2026-09-20 adversarial review of the handoff (`docs/adversarial-review-
 * e1-2026-09-20.md`, MINOR-3; `handoff/INTERFACE-GAPS` §6) put a fake AWS pair
 * into a handoff and measured: the key id redacted, the 40-character secret
 * stored verbatim. The battery is shared, so the journal and the self page had
 * the same hole. The fixture is AWS's own DOCUMENTED EXAMPLE pair — never a
 * real key.
 *
 * Three parts:
 *   1. the shapes the new family catches, and the ordinary 40-character tokens
 *      it must leave alone (context + shape, never shape alone);
 *   2. its cost — bounded, like every family in the gate with no off switch;
 *   3. EVERY ENTRANCE (encode INTERFACE-GAPS §3, the caller-side half): the
 *      real MCP tool doors — `note`, `session_end` (its memories and its
 *      `handoff` field), `chapter`, `self_page` — and the crash fallback's
 *      mint, each read back from the store; then a walk of every byte the store
 *      holds outside the raw capture buffer.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { SECRET_FAMILIES, containsSecret, redactSecrets, scanSecrets } from "../src/core/encode/index.js";
import { TUNABLES as REMEMBER_TUNABLES } from "../src/core/remember/index.js";
import type { SweepChunk } from "../src/core/remember/index.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";

/** AWS's documented example pair (docs.aws.amazon.com). Not a credential. */
const KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const ID_MARK = "[REDACTED:aws-access-key-id]";
const SECRET_MARK = "[REDACTED:aws-secret-access-key]";
/** The review's own sentence, whole. */
const PROSE = `The AWS key is ${KEY_ID} and the secret ${SECRET} — rotate both before Friday's deploy.`;

function bothGone(text: string): void {
  expect(text).not.toContain(KEY_ID);
  expect(text).not.toContain(SECRET);
  // Nor any recognisable piece of the secret: the review printed it shortened
  // as `wJalr…EXAMPLEKEY`, and a partial leak is still a leak.
  expect(text).not.toContain("bPxRfiCY");
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the shapes — by name, and beside its key id either way round", () => {
  test("the review's own sentence: BOTH halves redacted, the prose around them kept", () => {
    const scan = scanSecrets(PROSE);
    bothGone(scan.redacted);
    expect(scan.redacted).toBe(
      `The AWS key is ${ID_MARK} and the secret ${SECRET_MARK} — rotate both before Friday's deploy.`,
    );
    expect(scan.findings.map((f) => [f.family, f.count])).toEqual([
      ["aws-access-key-id", 1],
      ["aws-secret-access-key", 1],
    ]);
  });

  test("every place a secret key is written under its own name keeps the NAME and loses the value", () => {
    const cases: [string, string][] = [
      [`aws_secret_access_key = ${SECRET}`, `aws_secret_access_key = ${SECRET_MARK}`],
      [`export AWS_SECRET_ACCESS_KEY="${SECRET}"`, `export AWS_SECRET_ACCESS_KEY="${SECRET_MARK}"`],
      [`MY_AWS_SECRET_ACCESS_KEY=${SECRET}`, `MY_AWS_SECRET_ACCESS_KEY=${SECRET_MARK}`],
      [`"SecretAccessKey": "${SECRET}"`, `"SecretAccessKey": "${SECRET_MARK}"`],
      [`secretAccessKey: '${SECRET}'`, `secretAccessKey: '${SECRET_MARK}'`],
      [`AWS Secret Access Key [None]: ${SECRET}`, `AWS Secret Access Key [None]: ${SECRET_MARK}`],
      [`aws-secret-key=${SECRET}`, `aws-secret-key=${SECRET_MARK}`],
      // A truncated paste under the name is still the secret.
      [`AWS_SECRET_ACCESS_KEY=${SECRET.slice(0, 30)}`, `AWS_SECRET_ACCESS_KEY=${SECRET_MARK}`],
    ];
    for (const [input, expected] of cases) {
      expect({ input, out: redactSecrets(input) }).toEqual({ input, out: expected });
    }
  });

  test("the credentials file, the env pair, the JSON and the CSV AWS hands out — all of it", () => {
    const shapes = [
      `[default]\naws_access_key_id = ${KEY_ID}\naws_secret_access_key = ${SECRET}\n`,
      `AWS_ACCESS_KEY_ID=${KEY_ID}\nAWS_SECRET_ACCESS_KEY=${SECRET}`,
      `{"AccessKey": {"AccessKeyId": "${KEY_ID}", "SecretAccessKey": "${SECRET}", "Status": "Active"}}`,
      `User name,Password,Access key ID,Secret access key\nbob,,${KEY_ID},${SECRET}`,
      `secret ${SECRET}, and the id that goes with it is ${KEY_ID}`,
      `key ${KEY_ID}\nand on the next line the secret: ${SECRET}`,
    ];
    for (const text of shapes) {
      const out = redactSecrets(text);
      bothGone(out);
      expect({ text, id: out.includes(ID_MARK), secret: out.includes(SECRET_MARK) || out.includes("[REDACTED:assigned-credential]") }).toEqual({
        text,
        id: true,
        secret: true,
      });
    }
  });

  test("text an OLDER build redacted half of is finished by a re-scan, and a re-scan is a no-op after that", () => {
    // Exactly what the review found stored: the id's placeholder beside the
    // secret. Anchoring on the placeholder is what lets the gate finish it.
    const halfDone = `${ID_MARK} and the secret ${SECRET}`;
    const once = redactSecrets(halfDone);
    expect(once).toBe(`${ID_MARK} and the secret ${SECRET_MARK}`);
    expect(redactSecrets(once)).toBe(once);
    expect(scanSecrets(once).fired).toBe(false);
  });

  test("a body that is ONLY the pair is empty once the pair is gone", () => {
    const scan = scanSecrets(`${KEY_ID} ${SECRET}`);
    expect(scan.emptyAfterRedaction).toBe(true);
  });

  test("ordinary 40-character tokens are LEFT ALONE — shape alone is never enough", () => {
    for (const clean of [
      // A git SHA, alone and even right after a key id: hex has no upper case.
      "commit 0123456789abcdef0123456789abcdef01234567 fixed the flaky test",
      `${KEY_ID} rotated in commit 0123456789abcdef0123456789abcdef01234567`,
      // The secret's own shape with no context at all: a declared non-goal.
      `the token ${SECRET} with nothing around it`,
      // A 40-character CamelCase identifier, and an all-caps constant beside an id.
      "AbstractSingletonProxyFactoryBeanManager is a class name",
      `${KEY_ID} beside SOMEALLCAPSCONSTANTNAMEWITHFORTYCHARS1234`,
      // A lowercase slug of the right length.
      "see docs/getting-started-with-replay-harnesses-and-more",
    ]) {
      const out = redactSecrets(clean);
      // The only thing any of these may lose is the key id itself.
      expect({ clean, out }).toEqual({ clean, out: clean.replace(KEY_ID, ID_MARK) });
    }
  });

  test("the pairing window is bounded: a secret-shaped token 200+ characters from the id is not taken", () => {
    const far = `${KEY_ID} ${"and so on ".repeat(25)}${SECRET}`;
    const out = redactSecrets(far);
    expect(out).toContain(SECRET);
    expect(out).toContain(ID_MARK);
  });

  test("the family is declared once by NAME and three times by pattern, all fenced by context", () => {
    const patterns = SECRET_FAMILIES.filter((f) => f.family === "aws-secret-access-key");
    expect(patterns).toHaveLength(3);
    // After the key-id family: two of the three anchor on its placeholder.
    const order = SECRET_FAMILIES.map((f) => f.family);
    expect(order.indexOf("aws-access-key-id")).toBeLessThan(order.indexOf("aws-secret-access-key"));
  });

  test("it stays linear in the gate with no off switch", () => {
    const shapes = [
      `${SECRET} `.repeat(Math.ceil((64 * 1024) / 41)),
      `${ID_MARK} ${"a".repeat(190)} `.repeat(300),
      "aws_secret_access_key".repeat(3000),
      "aB".repeat(32 * 1024),
      `${SECRET.slice(0, 39)}/`.repeat(1600),
    ];
    for (const text of shapes) {
      const t0 = performance.now();
      scanSecrets(text);
      expect(performance.now() - t0).toBeLessThan(250);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Every entrance — the real tool doors, read back from the store
// ═══════════════════════════════════════════════════════════════════════════
const ENV = "COUNTERPARTS_DATA_DIR";
const SESSION = "sess_aws_1";
const SCOPE = "/scope/aws";

let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-aws-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function server(): McpServer {
  const s = openServer({ dir, session: SESSION, scope: SCOPE, owner: true });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

/** Every byte the store holds EXCEPT the raw capture buffer (`spans/`, which is
 *  verbatim by design and is what retention bounds). Box 1, box 2 and its WAL,
 *  the journal's markdown copies, the cache, meta files — all of it. */
function storeBytes(root: string): string {
  let out = "";
  const walk = (path: string, rel: string): void => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      if (rel === "spans") return;
      for (const name of readdirSync(path)) walk(join(path, name), rel === "" ? name : `${rel}/${name}`);
      return;
    }
    out += readFileSync(path).toString("latin1");
  };
  walk(root, "");
  return out;
}

describe("every entrance takes BOTH halves out — the caller-side half of encode §3", () => {
  test("note (memory)", async () => {
    const s = server();
    const r = payload(await s.call("note", { text: PROSE }));
    expect(r["stored"]).toBe(true);
    const body = s.counterpart.store.readProse(r["id"] as string).body;
    bothGone(body);
    expect(body).toContain(ID_MARK);
    expect(body).toContain(SECRET_MARK);
  });

  test("session_end (memories, and the handoff field)", async () => {
    const s = server();
    const r = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [{ content: PROSE, kind: "fact" }],
        handoff: `Where it stands: the deploy is blocked on rotating the keys. ${PROSE}`,
      }),
    );
    const outcomes = r["outcomes"] as Record<string, unknown>[];
    expect(outcomes[0]?.["stored"]).toBe(true);
    const memory = s.counterpart.store.readProse(outcomes[0]?.["id"] as string).body;
    bothGone(memory);
    expect(memory).toContain(SECRET_MARK);

    const handoff = r["handoff"] as Record<string, unknown>;
    expect(handoff["written"]).toBe(true);
    const pointer = s.counterpart.store.readProse(handoff["id"] as string).body;
    bothGone(pointer);
    expect(pointer).toContain(ID_MARK);
    expect(pointer).toContain(SECRET_MARK);
  });

  test("chapter (the journal)", async () => {
    const s = server();
    const r = payload(await s.call("chapter", { session: SESSION, text: `The afternoon went to the deploy. ${PROSE}` }));
    expect(r["stored"]).toBe(true);
    const body = s.counterpart.store.readProse(r["episodeId"] as string).body;
    bothGone(body);
    expect(body).toContain(SECRET_MARK);
  });

  test("self_page (the page)", async () => {
    const s = server();
    const page = `## Core\n\nI keep credentials out of prose. ${PROSE}\n\n## Lately\n\nA week of deploys.`;
    const r = payload(await s.call("self_page", { body: page }));
    expect(r["stored"]).toBe(true);
    const body = s.counterpart.selfPage()?.body ?? "";
    bothGone(body);
    expect(body).toContain(ID_MARK);
    expect(body).toContain(SECRET_MARK);
  });

  test("a note that is ONLY the pair is refused, not stored as two placeholders", async () => {
    const s = server();
    const r = payload(await s.call("note", { text: `${KEY_ID} ${SECRET}` }));
    expect(r["stored"]).toBe(false);
    expect(r["gate"]).toBe("empty-after-redaction");
  });

  test("the crash fallback's mint (the one entrance no model-facing door reaches)", async () => {
    let now = Date.parse("2026-09-23T15:00:00Z");
    const c = Counterpart.open({ dir, owner: true, now: () => now });
    open.push(c);
    const turns = [
      { role: "user" as const, text: `Can you check the deploy config? ${PROSE}` },
      { role: "assistant" as const, text: "Looked at it; the keys need rotating before the deploy can go." },
      { role: "user" as const, text: "Right, and the bucket policy needs the new role too, then we ship." },
    ];
    c.captureSpans({ session: "crashed", scope: SCOPE, turns });
    c.boundary({ session: "crashed", scope: SCOPE, kind: "stop" });
    now += REMEMBER_TUNABLES.CRASH_STALE_MS + 60_000;
    const seen: SweepChunk[] = [];
    const reports = await c.sweepFallback({
      interpret: async (chunk) => {
        seen.push(chunk);
        return {
          stopReason: "end_turn",
          proposals: [{ content: `The deploy was blocked on rotating the AWS pair. ${PROSE}`, kind: "fact" }],
        };
      },
      minBytes: 0,
    });
    expect(reports.some((r) => r.ran)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    const minted = c.store.list({ type: "memory" });
    expect(minted.length).toBe(1);
    const body = c.store.readProse(minted[0] as string).body;
    bothGone(body);
    expect(body).toContain(SECRET_MARK);
  });

  test("after every door has been used, neither half is anywhere in the store outside the raw buffer", async () => {
    const s = server();
    await s.call("note", { text: PROSE });
    await s.call("session_end", {
      session: SESSION,
      memories: [{ content: `A second memory of the same afternoon. ${PROSE}`, kind: "fact" }],
      handoff: `Blocked on rotation. ${PROSE}`,
    });
    await s.call("chapter", { session: SESSION, text: `The journal's account. ${PROSE}` });
    await s.call("self_page", { body: `## Core\n\nSteady. ${PROSE}\n\n## Lately\n\nDeploys.` });
    s.counterpart.close();
    open.length = 0;
    const bytes = storeBytes(dir);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.includes(KEY_ID)).toBe(false);
    expect(bytes.includes(SECRET)).toBe(false);
    expect(containsSecret(bytes.replace(/[^\x20-\x7e\n]/g, " "))).toBe(false);
  });
});
