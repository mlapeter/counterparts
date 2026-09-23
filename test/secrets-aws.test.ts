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

  test("EVERY copy goes, not the first one (review M3): a repeat, an old and a new secret, two ids then two secrets", () => {
    const S2 = "je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY"; // AWS's second documented example secret
    const ID2 = "AKIAI44QH8DHBEXAMPLE";
    const cases: [string, string][] = [
      [
        `key ${KEY_ID} secret ${SECRET} — to be clear, the secret is ${SECRET}`,
        `key ${ID_MARK} secret ${SECRET_MARK} — to be clear, the secret is ${SECRET_MARK}`,
      ],
      [`key ${KEY_ID}: old secret ${SECRET}, new secret ${S2}`, `key ${ID_MARK}: old secret ${SECRET_MARK}, new secret ${SECRET_MARK}`],
      [`ids: ${KEY_ID}, ${ID2}\nsecrets: ${SECRET}, ${S2}`, `ids: ${ID_MARK}, ${ID_MARK}\nsecrets: ${SECRET_MARK}, ${SECRET_MARK}`],
      // Far past the 200-character window: the value is taken wherever it stands.
      [`key ${KEY_ID} secret ${SECRET}. ${"More notes. ".repeat(40)}Again: ${SECRET}`, `key ${ID_MARK} secret ${SECRET_MARK}. ${"More notes. ".repeat(40)}Again: ${SECRET_MARK}`],
      // ...and a value caught by NAME is taken everywhere too.
      [`AWS_SECRET_ACCESS_KEY=${SECRET}\n# copied from ${SECRET}`, `AWS_SECRET_ACCESS_KEY=${SECRET_MARK}\n# copied from ${SECRET_MARK}`],
    ];
    for (const [input, expected] of cases) {
      const out = redactSecrets(input);
      expect({ input, out }).toEqual({ input, out: expected });
      expect(out).not.toContain("EXAMPLEKEY");
    }
    // A longer token that merely CONTAINS a caught value is not a copy of it.
    const longer = `key ${KEY_ID} secret ${SECRET} and ${SECRET}XYZ9`;
    expect(redactSecrets(longer)).toContain(`${SECRET}XYZ9`);
  });

  test("the forms with no `=` beside the name, and no key id nearby (review M4)", () => {
    const cases: [string, string][] = [
      [`aws configure set aws_secret_access_key ${SECRET}`, `aws configure set aws_secret_access_key ${SECRET_MARK}`],
      [`ENV AWS_SECRET_ACCESS_KEY ${SECRET}`, `ENV AWS_SECRET_ACCESS_KEY ${SECRET_MARK}`],
      [`os.environ["AWS_SECRET_ACCESS_KEY"] = "${SECRET}"`, `os.environ["AWS_SECRET_ACCESS_KEY"] = "${SECRET_MARK}"`],
      [`<SecretAccessKey>${SECRET}</SecretAccessKey>`, `<SecretAccessKey>${SECRET_MARK}</SecretAccessKey>`],
      [`--aws-secret-access-key ${SECRET}`, `--aws-secret-access-key ${SECRET_MARK}`],
    ];
    for (const [input, expected] of cases) {
      expect({ input, out: redactSecrets(input) }).toEqual({ input, out: expected });
    }
  });

  test("near a key id, PATHS are not secrets, and by name a plain WORD is not one (review m8)", () => {
    for (const clean of [
      `${KEY_ID} is the key the job at /Users/alice/projects/myapp/src/core/enc uses`,
      `${KEY_ID} lives in ~/Users/alice/projectsXX/myapp/src/core/enc today`,
      `${KEY_ID} see ./Users/alice/projectsXX/myapp/src/core/enc for it`,
      `${KEY_ID} is documented at docs.example.com/Users/alice/projectsXX/myapp/src/co`,
    ]) {
      expect({ clean, out: redactSecrets(clean) }).toEqual({ clean, out: clean.replace(KEY_ID, ID_MARK) });
    }
    const prose = "SecretAccessKey: ConfigurationDocumentation is the page to read";
    expect(redactSecrets(prose)).toBe(prose);
    // A bare leading `/` is NOT excluded: one real secret in 64 begins with one.
    const slashSecret = "/alrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY1";
    expect(redactSecrets(`key ${KEY_ID} secret ${slashSecret}`)).toBe(`key ${ID_MARK} secret ${SECRET_MARK}`);
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

  test("a QUOTED placeholder is still a placeholder: a re-scan of `KEY=\"[REDACTED:…]\"` finds nothing", () => {
    const once = redactSecrets(`export AWS_SECRET_ACCESS_KEY="${SECRET}"`);
    expect(once).toBe(`export AWS_SECRET_ACCESS_KEY="${SECRET_MARK}"`);
    expect(scanSecrets(once).fired).toBe(false);
    expect(scanSecrets('password: "[REDACTED:assigned-credential]"').fired).toBe(false);
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
      // A thousand pairs: every value propagates, in one pass, not one each.
      Array.from({ length: 1000 }, (_, i) => `AKIA${String(i).padStart(16, "0")} ${SECRET.slice(0, 36)}${String(i).padStart(4, "0")}`).join("\n"),
    ];
    for (const text of shapes) {
      const t0 = performance.now();
      scanSecrets(text);
      expect(performance.now() - t0).toBeLessThan(250);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the ROOT cause, fixed for every name — the catch-all's fence (review M5)", () => {
  test("snake_case and JSON names ending in a credential word are redacted, name kept", () => {
    const cases: [string, string][] = [
      ["DB_PASSWORD=hunter2hunter2", "DB_PASSWORD=[REDACTED:assigned-credential]"],
      ["POSTGRES_PASSWORD=supersecret9", "POSTGRES_PASSWORD=[REDACTED:assigned-credential]"],
      ["JWT_SECRET=abcDEF123456xyz", "JWT_SECRET=[REDACTED:assigned-credential]"],
      ["AWS_SESSION_TOKEN=FwoGZXIvYXdzEBYaDExampleToken", "AWS_SESSION_TOKEN=[REDACTED:assigned-credential]"],
      ["HF_TOKEN=hf_abcdefghijklmnopqrstu", "HF_TOKEN=[REDACTED:assigned-credential]"],
      ["STRIPE_API_KEY=pk9_abcdefghijklm", "STRIPE_API_KEY=[REDACTED:assigned-credential]"],
      ['"SessionToken": "FwoGZXIvYXdzEBYaDExampleToken"', '"SessionToken": [REDACTED:assigned-credential]'],
      ['{"password": "correct-horse"}', '{"password": [REDACTED:assigned-credential]}'],
      // A numeric password is still a password.
      ["DB_PASSWORD=12345678", "DB_PASSWORD=[REDACTED:assigned-credential]"],
    ];
    for (const [input, expected] of cases) {
      expect({ input, out: redactSecrets(input) }).toEqual({ input, out: expected });
    }
  });

  test("the false-positive guard: settings that only look like it are left alone", () => {
    for (const clean of [
      "MAX_TOKENS=4096",
      "MAX_TOKEN=4096",
      'TOKEN_LIMIT: "4096"',
      'token: "4096"',
      '"secret": "false"',
      "SECRET_ROTATION_DAYS=30",
      "TOKEN_URL=https://auth.example.com/token",
      "PASSWORD_MIN_LENGTH=12",
      "ACCESS_KEY_ID_ROTATION=monthly",
      "USE_SECRET=undefined",
      "the password reset form moved to the settings page",
    ]) {
      expect({ clean, out: redactSecrets(clean) }).toEqual({ clean, out: clean });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the re-review's residuals (R2, R3, R4, R6, R10)", () => {
  test("R2: a copy GLUED on by = / ? & : @ is still a copy, and `key=S` beside an id is the first one", () => {
    const text = [
      `id ${KEY_ID} secret ${SECRET}`,
      `export SK=${SECRET}`,
      `https://x.example/?sk=${SECRET}&a=1`,
      `s3://bucket/${SECRET}/obj`,
      `user:${SECRET}@host`,
    ].join("\n");
    const out = redactSecrets(text);
    expect(out).not.toContain("EXAMPLEKEY");
    expect(out).toContain(`export SK=${SECRET_MARK}`);
    expect(out).toContain(`?sk=${SECRET_MARK}&a=1`);
    expect(out).toContain(`s3://bucket/${SECRET_MARK}/obj`);
    for (const first of [`${KEY_ID} key=${SECRET}`, `aws_access_key_id=${KEY_ID} sk=${SECRET}`]) {
      const once = redactSecrets(first);
      expect({ first, once }).toEqual({ first, once: first.replace(KEY_ID, ID_MARK).replace(SECRET, SECRET_MARK) });
    }
  });

  test("R3: a hard-coded FALLBACK after the name is the secret too", () => {
    const cases: [string, string][] = [
      [`os.getenv("AWS_SECRET_ACCESS_KEY", "${SECRET}")`, `os.getenv("AWS_SECRET_ACCESS_KEY", "${SECRET_MARK}")`],
      [`os.environ.get('AWS_SECRET_ACCESS_KEY', '${SECRET}')`, `os.environ.get('AWS_SECRET_ACCESS_KEY', '${SECRET_MARK}')`],
      [`process.env.AWS_SECRET_ACCESS_KEY || "${SECRET}"`, `process.env.AWS_SECRET_ACCESS_KEY || "${SECRET_MARK}"`],
      [`process.env.AWS_SECRET_ACCESS_KEY ?? "${SECRET}"`, `process.env.AWS_SECRET_ACCESS_KEY ?? "${SECRET_MARK}"`],
      ['process.env.API_TOKEN || "tok_abc123XYZ"', "process.env.API_TOKEN || [REDACTED:assigned-credential]"],
    ];
    for (const [input, expected] of cases) {
      expect({ input, out: redactSecrets(input) }).toEqual({ input, out: expected });
    }
    // The generic `, "…"` form is NOT taken by the catch-all: with names as
    // common as `token`, it matched every JSON array of strings.
    const json = '{"families":["secret","token","password"],"family":"aws-secret-access-key","count":1}';
    expect(redactSecrets(json)).toBe(json);
  });

  test("R4: camelCase, glued and keyword-not-last names; short and punctuated passwords; non-AWS second copies", () => {
    const cases: [string, string][] = [
      ['dbPassword: "Xk9mP2vLq7"', "dbPassword: [REDACTED:assigned-credential]"],
      ['apiToken = "Xk9mP2vLq7ab"', "apiToken = [REDACTED:assigned-credential]"],
      ['secretKey: "Xk9mP2vLq7ab"', "secretKey: [REDACTED:assigned-credential]"],
      ['webhookSecret: "whsec_Xk9mP2vLq7"', "webhookSecret: [REDACTED:assigned-credential]"],
      ["PGPASSWORD=hunter2x", "PGPASSWORD=[REDACTED:assigned-credential]"],
      ["MYSQLPASSWORD=hunter2x", "MYSQLPASSWORD=[REDACTED:assigned-credential]"],
      ["SECRET_KEY_BASE=abcdef0123456789", "SECRET_KEY_BASE=[REDACTED:assigned-credential]"],
      ["DB_PASSWD=hunter22x", "DB_PASSWD=[REDACTED:assigned-credential]"],
      ["DB_PASSWORD=abc,defghij", "DB_PASSWORD=[REDACTED:assigned-credential]"],
      ["DB_PASSWORD=abcd;efgh1234", "DB_PASSWORD=[REDACTED:assigned-credential]"],
      ["DB_PASSWORD=Ab3$x", "DB_PASSWORD=[REDACTED:assigned-credential]"],
      [
        "DB_PASSWORD=Xk9mP2vLq7 and later psql with Xk9mP2vLq7 again",
        "DB_PASSWORD=[REDACTED:assigned-credential] and later psql with [REDACTED:assigned-credential] again",
      ],
    ];
    for (const [input, expected] of cases) {
      expect({ input, out: redactSecrets(input) }).toEqual({ input, out: expected });
    }
    // An ordinary WORD caught as a value does not travel: `production` stays
    // everywhere else it stands.
    expect(redactSecrets('secret: "production" and production again')).toBe(
      "secret: [REDACTED:assigned-credential] and production again",
    );
    // A bare `Key` is not a camelCase keyword.
    for (const clean of ['primaryKey: "user_id"', 'sortKey = "createdAt"', 'cacheKey: "v2:users"']) {
      expect(redactSecrets(clean)).toBe(clean);
    }
  });

  test("R6: a TYPE annotation, a code reference or a plain number is a setting, not a secret", () => {
    for (const clean of [
      "openai_api_key: Optional[str] = None",
      "db_password: SecretStr",
      "api_token: str",
      "input_token = 123456",
      "refresh_token = self._refresh",
      "password = settings.DB_PASSWORD",
      'secret = os.environ["APP_SECRET"]',
      "access_token = get_token(user)",
    ]) {
      expect({ clean, out: redactSecrets(clean) }).toEqual({ clean, out: clean });
    }
    // ...but a numeric PASSWORD of six digits or more is a PIN, and a bare word
    // ASSIGNED is a value.
    expect(redactSecrets("DB_PASSWORD=12345678")).toBe("DB_PASSWORD=[REDACTED:assigned-credential]");
    expect(redactSecrets("password = HunterTwo")).toBe("password = [REDACTED:assigned-credential]");
  });

  test("R10: a 40-character LETTERS-ONLY secret in the whitespace and XML forms", () => {
    const letters = "AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMn";
    expect(redactSecrets(`<SecretAccessKey>${letters}</SecretAccessKey>`)).toBe(`<SecretAccessKey>${SECRET_MARK}</SecretAccessKey>`);
    expect(redactSecrets(`ENV AWS_SECRET_ACCESS_KEY ${letters}`)).toBe(`ENV AWS_SECRET_ACCESS_KEY ${SECRET_MARK}`);
    // Not a 26-letter prose word.
    const prose = "SecretAccessKey: ConfigurationDocumentation is the page to read";
    expect(redactSecrets(prose)).toBe(prose);
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
