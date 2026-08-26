/**
 * `adapters/mcp/` — the deliberate tools, with the wire faked and nothing else.
 *
 * The host is faked in one direction only: stdin/stdout. Every other thing under
 * test is real — a real `Counterpart` over a real temp data dir, the real gate
 * battery, the real activation pass. What faking the transport buys is the
 * ability to assert JSON-RPC framing (partial chunks, notifications, parse
 * errors) without a child process.
 *
 * The audit block is this suite's reason to exist. CONTRACT §5 G2: **every
 * privilege a tool description states is mechanized.** So the audit does not
 * read the descriptions for plausibility — it walks the registry, checks that
 * every claim names a code path, checks that every named path EXISTS, and then
 * runs the mechanism against a live store to watch it enforce.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test, removed
 * in `afterEach`, and `store/paths.ts` structurally refuses `~/.bansai`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import {
  DELIBERATE_TIERS,
  ERROR_CODES,
  FrameReader,
  HARD_GATES,
  McpServer,
  PROTOCOL_VERSIONS,
  TOOLS,
  TOOL_NAMES,
  encodeMessage,
  openServer,
  parseLine,
  renderDescription,
  serveStdio,
  tierOf,
} from "../src/adapters/mcp/index.js";
import type { Response, ToolResult } from "../src/adapters/mcp/index.js";
import { launchOptions } from "../src/adapters/mcp/bin/serve.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const SESSION = "sess_mcp_1";

let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-mcp-"));
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

function server(opts: Parameters<typeof openServer>[0] = {}): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/one", owner: true, ...opts });
  open.push(s.counterpart);
  return s;
}

/** Sixteen unremarkable memories: enough that the gate leaves the cold-start
 *  regime, so the deliberate path is exercised in the ordinary one. */
const FILLER: readonly string[] = [
  "Ran the morning loop around the reservoir before breakfast.",
  "The tax filing deadline moved to October this year.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The neighbour's cat sits on the fence every evening.",
  "Bought hiking boots that finally fit properly.",
  "The library closes early on Sundays now.",
  "Wrote a short letter to an old teacher.",
  "The kitchen tap drips when the pressure is high.",
  "Set up a standing desk in the spare bedroom.",
  "The bus route changed and adds ten minutes.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
];

function seed(c: Counterpart): void {
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
}

/**
 * A fingerprint of every CANONICAL byte: box 1 (prose + versions), box 2
 * (operational.sqlite) and the span buffer. Box 3 (`cache/`) is excluded by
 * design — it is the declared rebuildable cache — and so is `tmp/`.
 */
function fingerprint(root: string): string {
  const hash = createHash("sha256");
  const walk = (path: string, rel: string): void => {
    if (!existsSync(path)) return;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name), `${rel}/${name}`);
      return;
    }
    hash.update(rel);
    hash.update(readFileSync(path));
  };
  for (const name of ["prose", "versions", "spans", "operational.sqlite"]) {
    walk(join(root, name), name);
  }
  return hash.digest("hex");
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

/** Drive a list of already-framed lines through the real stdio pump. */
async function pump(s: McpServer, chunks: readonly string[]): Promise<Response[]> {
  const out: Response[] = [];
  const input = (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
  await serveStdio(s, input, {
    write: (chunk) => {
      for (const line of chunk.trim().split("\n")) out.push(JSON.parse(line) as Response);
    },
  });
  return out;
}

function rpc(id: number | string | null, method: string, params?: Record<string, unknown>): string {
  return encodeMessage({
    jsonrpc: "2.0",
    ...(id === null ? {} : { id }),
    method,
    ...(params === undefined ? {} : { params }),
  } as never);
}

// ── the wire ────────────────────────────────────────────────────────────────

describe("the wire", () => {
  test("initialize handshakes, echoes a supported protocol version, and declares tools", async () => {
    const s = server();
    const [response] = await pump(s, [
      rpc(1, "initialize", { protocolVersion: PROTOCOL_VERSIONS[1], capabilities: {} }),
    ]);
    const result = (response as { result: Record<string, unknown> }).result;
    expect(result["protocolVersion"]).toBe(PROTOCOL_VERSIONS[1] as string);
    expect((result["capabilities"] as Record<string, unknown>)["tools"]).toBeDefined();
    expect((result["serverInfo"] as Record<string, string>)["name"]).toBe("counterparts");
    expect(s.ready()).toBe(true);
  });

  test("an unknown protocol version is answered with ours, never with a hard failure", async () => {
    const s = server();
    const [response] = await pump(s, [rpc(1, "initialize", { protocolVersion: "2099-01-01" })]);
    expect((response as unknown as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      PROTOCOL_VERSIONS[0] as string,
    );
  });

  test("a notification is answered with nothing at all", async () => {
    const s = server();
    const responses = await pump(s, [rpc(null, "notifications/initialized"), rpc(7, "ping")]);
    expect(responses.length).toBe(1);
    expect((responses[0] as { id: number }).id).toBe(7);
  });

  test("framing survives a message split across chunks, and two on one chunk", async () => {
    const s = server();
    const first = rpc(1, "ping");
    const second = rpc(2, "tools/list");
    const joined = first + second;
    const cut = Math.floor(joined.length / 3);
    const responses = await pump(s, [joined.slice(0, cut), joined.slice(cut)]);
    expect(responses.map((r) => (r as { id: number }).id)).toEqual([1, 2]);
  });

  test("a partial line with no newline is held, not parsed", () => {
    const reader = new FrameReader();
    expect(reader.feed('{"jsonrpc":"2.0"')).toEqual([]);
    expect(reader.pending()).toBeGreaterThan(0);
    expect(reader.feed(',"id":1,"method":"ping"}\n')).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    ]);
    expect(reader.pending()).toBe(0);
  });

  test("protocol faults are JSON-RPC errors; a tool that refuses is a RESULT", async () => {
    const s = server();
    const responses = await pump(s, [
      "not json at all\n",
      rpc(2, "no/such/method"),
      rpc(3, "tools/call", { name: "note", arguments: {} }),
    ]);
    const [parseErr, unknownMethod, refusal] = responses as {
      error?: { code: number };
      result?: Record<string, unknown>;
      id: number | null;
    }[];
    expect(parseErr?.error?.code).toBe(ERROR_CODES.PARSE_ERROR);
    expect(parseErr?.id).toBe(null);
    expect(unknownMethod?.error?.code).toBe(ERROR_CODES.METHOD_NOT_FOUND);
    // The refusal arrived as a successful JSON-RPC response carrying isError —
    // scar §2.4: a tool that said no must be readable as having said no.
    expect(refusal?.error).toBeUndefined();
    expect(refusal?.result?.["isError"]).toBe(true);
  });

  test("an unknown TOOL is a protocol fault, since the client called something that is not there", async () => {
    const s = server();
    const [response] = await pump(s, [rpc(1, "tools/call", { name: "self_write", arguments: {} })]);
    expect((response as { error: { code: number } }).error.code).toBe(ERROR_CODES.METHOD_NOT_FOUND);
  });

  test("parseLine refuses a non-2.0 envelope and a non-object params", () => {
    expect(parseLine('{"jsonrpc":"1.0","id":1,"method":"ping"}').ok).toBe(false);
    expect(parseLine('{"jsonrpc":"2.0","id":1,"method":"ping","params":[]}').ok).toBe(false);
    expect(parseLine('{"jsonrpc":"2.0","id":1,"method":"ping"}').ok).toBe(true);
  });

  test("launch options come from flags and environment, never from a guessed default", () => {
    expect(launchOptions(["--session", "abc", "--owner"], {})).toEqual({
      session: "abc",
      owner: true,
      observer: false,
    });
    const fromEnv = launchOptions([], { COUNTERPARTS_SESSION: "xyz", COUNTERPARTS_OBSERVER: "1" });
    expect(fromEnv.session).toBe("xyz");
    expect(fromEnv.observer).toBe(true);
    expect(launchOptions([], {}).session).toBeUndefined();
  });
});

// ── the description audit (CONTRACT §5 G2/G3) ───────────────────────────────

describe("the tool-description audit", () => {
  test("the shipped list is exactly three verbs plus the return channel — and no self-authorship tool", async () => {
    const s = server();
    const [response] = await pump(s, [rpc(1, "tools/list")]);
    const tools = (response as unknown as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(TOOL_NAMES).toEqual(["note", "recall", "status", "session_end"]);
    // §4: self-writing is the boundary's job by construction, and `protected.add`
    // went with the second-signature queue. Enumerated absent, not assumed absent.
    for (const banned of ["self", "self_store", "protect", "protected_add", "revise", "entity"]) {
      expect(tools.some((t) => t.name === banned)).toBe(false);
    }
  });

  test("every tool carries an admission test and at least one named negative example", () => {
    for (const spec of TOOLS) {
      expect(spec.admission.length).toBeGreaterThan(20);
      expect(spec.negativeExamples.length).toBeGreaterThanOrEqual(1);
      for (const negative of spec.negativeExamples) {
        expect(negative.toLowerCase()).toContain("do not");
      }
    }
  });

  test("every stated privilege names a mechanized path, and every path it names exists", () => {
    const root = join(import.meta.dir, "..");
    let checked = 0;
    for (const spec of TOOLS) {
      expect(spec.privileges.length).toBeGreaterThan(0);
      for (const privilege of spec.privileges) {
        expect(privilege.claim.trim().length).toBeGreaterThan(0);
        expect(privilege.mechanizedBy.trim().length).toBeGreaterThan(0);
        // The pointer cannot rot into a lie: every `src/**.ts` it names must be
        // a file on disk. A renamed module fails this test, loudly.
        const paths = privilege.mechanizedBy.match(/src\/[A-Za-z0-9/_.-]+\.ts/g) ?? [];
        expect(paths.length).toBeGreaterThan(0);
        for (const path of paths) {
          expect(existsSync(join(root, path))).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(TOOLS.length);
  });

  test("a description is RENDERED from the registry, so a claim cannot exist without a mechanism", async () => {
    const s = server();
    const [response] = await pump(s, [rpc(1, "tools/list")]);
    const tools = (response as unknown as { result: { tools: { name: string; description: string }[] } })
      .result.tools;
    for (const spec of TOOLS) {
      const shipped = tools.find((t) => t.name === spec.name);
      expect(shipped?.description).toBe(renderDescription(spec));
      // Every claim appears; nothing else does. The rendered text is the union
      // of registry rows, which is what makes "stated ⇒ mechanized" checkable.
      for (const privilege of spec.privileges) {
        expect(shipped?.description).toContain(privilege.claim);
      }
    }
  });

  test("the mechanism behind the salience claim actually fires: a claim is a floor, and the lift is recorded", async () => {
    const s = server();
    const result = await s.call("note", {
      text: "The staging deploy needs the migration run before the container starts, or it boots empty.",
      salience: 0.9,
    });
    const body = payload(result);
    expect(body["stored"]).toBe(true);
    const id = body["id"] as string;
    const physics = s.counterpart.store.physicsOf(id);
    // The dimensions are NOT rewritten to satisfy the claim; the claim rides as
    // a floor on the row, which is what keeps `sal(m)` reproducible from state.
    expect(physics.salience.claimed).toBe(0.9);
    expect(body["salienceLifted"]).toBe(true);
  });

  test("the mechanism behind the credential claim actually fires: redacted, and a bare credential is refused", async () => {
    const s = server();
    const stored = await s.call("note", {
      text: "The staging deploy key is ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789 and it rotates every month.",
    });
    expect(payload(stored)["stored"]).toBe(true);
    const doc = s.counterpart.store.readProse(payload(stored)["id"] as string);
    expect(doc.body).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789");
    expect(doc.body).toContain("REDACTED");

    const bare = await s.call("note", { text: "ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789" });
    expect(payload(bare)["stored"]).toBe(false);
    // A note that was nothing but a credential is empty once the credential is
    // gone, and the battery says exactly that rather than "stored, redacted".
    expect(payload(bare)["gate"]).toBe("empty-after-redaction");
  });

  test("the mechanism behind the duplicate claim actually fires", async () => {
    const s = server();
    const text = "The reservoir path floods after heavy rain and the loop has to go the long way.";
    expect(payload(await s.call("note", { text }))["stored"]).toBe(true);
    const again = payload(await s.call("note", { text }));
    expect(again["stored"]).toBe(false);
    expect(again["reason"]).toBe("duplicate-content");
  });
});

// ── note ────────────────────────────────────────────────────────────────────

describe("note — the ambient exception", () => {
  test("the note's own words ride the buffer as a span the deposit claims", async () => {
    const s = server();
    const text = "Decided the interpreter seat stays on the strongest tier, since the fallback carries the day.";
    const result = await s.call("note", { text });
    expect(payload(result)["stored"]).toBe(true);
    // The jot's span is COVERED by the deposit, which is what stops the
    // end-of-session sweep from minting the same words a second time.
    const spans = s.counterpart.spans.spans("/scope/one");
    const jot = spans.find((span) => span.kind === "jot" && span.text === text);
    expect(jot).toBeDefined();
    expect(s.counterpart.spans.coverageReport("/scope/one").uncovered).toBe(0);
    expect(s.events("mcp.note")[0]?.data?.["covers"]).toBeGreaterThanOrEqual(1);
  });

  test("a stub is refused: a note has to say something", async () => {
    const s = server();
    const result = payload(await s.call("note", { text: "TODO" }));
    expect(result["stored"]).toBe(false);
    expect(result["gate"]).toBe("content-stub");
  });

  test("a missing or non-string text is the tool's own answer, not a protocol error", async () => {
    const s = server();
    expect(payload(await s.call("note", {}))["reason"]).toBe("text-required");
    expect(payload(await s.call("note", { text: "  " }))["reason"]).toBe("text-required");
    expect(payload(await s.call("note", { text: "ok", salience: "high" }))["reason"]).toBe(
      "salience-not-a-number",
    );
  });
});

// ── recall ──────────────────────────────────────────────────────────────────

describe("recall — deliberate retrieval", () => {
  test("a handle expands exactly that memory; a near-miss is not-found, never a fuzzy search", async () => {
    const s = server();
    seed(s.counterpart);
    const id = s.counterpart.store.put({
      type: "memory",
      kind: "skill",
      title: "Sourdough starter",
      body: "The sourdough starter died after two weeks of neglect and needs daily feeding.",
    });

    const byId = payload(await s.call("recall", { handle: id }));
    expect(byId["reason"]).toBe("expanded");
    expect((byId["memories"] as { body: string }[])[0]?.body).toContain("sourdough");

    const byTitle = payload(await s.call("recall", { handle: "sourdough starter" }));
    expect(byTitle["reason"]).toBe("expanded");

    // The near miss is the whole point: a fuzzy search would have found it.
    const nearMiss = payload(await s.call("recall", { handle: "sourdough" }));
    expect(nearMiss["reason"]).toBe("handle-unknown");
    expect((nearMiss["memories"] as unknown[]).length).toBe(0);
  });

  test("exactly one argument: neither and both are refusals, not a best guess", async () => {
    const s = server();
    expect(payload(await s.call("recall", {}))["reason"]).toBe("no-argument");
    expect(payload(await s.call("recall", { handle: "x", question: "y" }))["reason"]).toBe(
      "both-arguments",
    );
  });

  test("a question answers in labeled tiers, and reports what it considered separately from what it returned", async () => {
    const s = server();
    seed(s.counterpart);
    s.counterpart.store.put({
      type: "memory",
      kind: "skill",
      title: "Sourdough starter",
      body: "The sourdough starter died after two weeks of neglect and needs daily feeding.",
      salience: { relevance: 0.6, emotional: 0.2, predictive: 0.4 },
    });
    const result = payload(await s.call("recall", { question: "my sourdough starter died again" }));
    const memories = result["memories"] as { tier: string; body: string }[];

    expect(result["reason"]).toBe("answered");
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0]?.body.length).toBeGreaterThan(0);
    expect(["vivid", "quiet", "dim"]).toContain(memories[0]?.tier as string);
    // §9.1 G3: considered is the candidate count, storeSize the denominator.
    // Neither is "how many I chose to show you".
    expect(result["considered"] as number).toBeGreaterThanOrEqual(memories.length);
    expect(result["storeSize"] as number).toBeGreaterThanOrEqual(FILLER.length);
    expect((result["tiers"] as Record<string, string>)["dim"]).toContain("deliberately");
  });

  test("effort lowers the bar and never overturns a hard gate", () => {
    for (const verdict of HARD_GATES) {
      expect(tierOf(verdict, false, false)).toBe(null);
    }
    for (const verdict of DELIBERATE_TIERS) {
      expect(tierOf(verdict, false, false)).toBe("dim");
    }
    expect(tierOf("confidential-withheld", false, false)).toBe(null);
    expect(tierOf("inhibited", false, false)).toBe(null);
    expect(tierOf("below-bar", true, false)).toBe("vivid");
    expect(tierOf("below-bar", false, true)).toBe("quiet");
  });

  test("a question nothing answers comes back empty rather than reaching for something", async () => {
    const s = server();
    seed(s.counterpart);
    const result = payload(
      await s.call("recall", { question: "zygomorphic bryophyte taxonomy fieldwork" }),
    );
    expect(result["reason"]).toBe("nothing-came");
    expect((result["memories"] as unknown[]).length).toBe(0);
  });

  test("confidentiality: STATED for a direct lookup, SILENT in a list", async () => {
    const s = server({ owner: false });
    seed(s.counterpart);
    const id = s.counterpart.store.put({
      type: "memory",
      kind: "person",
      title: "Clinic appointment",
      body: "The clinic appointment about the recurring migraines is on the fourteenth.",
      salience: { relevance: 0.7, emotional: 0.5, predictive: 0.5 },
      meta: { confidential: true },
    });

    const direct = payload(await s.call("recall", { handle: id }));
    expect(direct["reason"]).toBe("handle-confidential-withheld");
    expect(direct["withheld"]).toContain("confidential");
    expect((direct["memories"] as unknown[]).length).toBe(0);

    const listed = payload(await s.call("recall", { question: "the clinic appointment migraines" }));
    const ids = (listed["memories"] as { id: string }[]).map((m) => m.id);
    expect(ids).not.toContain(id);
    // Silent means silent: no count, no gap announced, nothing that says a
    // withheld thing exists. Only the memories that were shown are named.
    expect(JSON.stringify(listed)).not.toContain("withheld");

    // The owner's own session gets it.
    const asOwner = server({ owner: true });
    const ownerView = payload(await asOwner.call("recall", { handle: id }));
    expect(ownerView["reason"]).toBe("expanded");
  });

  test("recall and status write nothing and train nothing — canonical state is byte-identical", async () => {
    const s = server();
    seed(s.counterpart);
    await s.call("note", { text: "The sourdough starter needs feeding every day or it dies off." });
    const before = fingerprint(dir);
    const beforeUses = s.counterpart.store
      .list({ archived: false })
      .map((id) => s.counterpart.store.physicsOf(id).uses);

    await s.call("recall", { question: "sourdough starter feeding" });
    await s.call("recall", { handle: "Sourdough" });
    await s.call("status", {});

    expect(fingerprint(dir)).toBe(before);
    const afterUses = s.counterpart.store
      .list({ archived: false })
      .map((id) => s.counterpart.store.physicsOf(id).uses);
    expect(afterUses).toEqual(beforeUses);
  });
});

// ── status ──────────────────────────────────────────────────────────────────

describe("status — the census", () => {
  test("counts by kind and band, symmetry counters, and what was removed — no ids, bodies or hashes", async () => {
    const s = server();
    seed(s.counterpart);
    const removed = s.counterpart.store.put({
      type: "memory",
      kind: "person",
      body: "An acquaintance from the climbing gym who moved away last spring.",
    });
    const secret = "a body that must never appear in a census";
    const kept = s.counterpart.store.put({ type: "memory", kind: "place", body: secret });
    s.counterpart.store.appendRemovalRecord({ memoryId: removed, stage: "requested", actor: "owner" });
    s.counterpart.store.appendRemovalRecord({ memoryId: removed, stage: "complete", actor: "owner" });

    const census = payload(await s.call("status", {}));
    const text = JSON.stringify(census);

    expect(census["live"] as number).toBeGreaterThan(0);
    expect((census["byKind"] as Record<string, number>)["fact"]).toBe(FILLER.length);
    expect((census["byBand"] as Record<string, number>)["episodic"]).toBeGreaterThan(0);
    const removals = census["removed"] as Record<string, unknown>;
    expect(removals["count"]).toBe(1);
    expect((removals["kinds"] as Record<string, number>)["person"]).toBe(1);
    expect((removals["dates"] as string[])[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Symmetry (CONTRACT §7 OQ2): born versus left, per kind.
    const symmetry = census["symmetry"] as Record<string, Record<string, number>>;
    expect(symmetry["created"]?.["person"]).toBe(1);
    expect(symmetry["exited"]?.["person"]).toBe(1);

    // Content-by-reference, checked rather than promised: no bodies, no ids,
    // no content hashes anywhere in the payload (scar §2.20).
    expect(text).not.toContain(secret);
    expect(text).not.toContain(removed);
    expect(text).not.toContain(kept);
    expect(text).not.toContain(s.counterpart.store.read(kept).contentHash);
  });
});

// ── session_end ─────────────────────────────────────────────────────────────

describe("session_end — the authorship ask's return channel", () => {
  test("the dump lands as authored memory, one entry at a time", async () => {
    const s = server();
    const result = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [
          { content: "The flow-walk fix arc closed with the accommodation firing at the 0.52 bar.", kind: "fact" },
          { content: "Mike prefers the decision talked through in chat, not filed in a document.", kind: "person" },
        ],
      }),
    );
    expect(result["deposited"]).toBe(2);
    expect(result["refused"]).toBe(0);
    const ids = (result["outcomes"] as { id?: string }[]).map((o) => o.id);
    for (const id of ids) {
      expect(s.counterpart.store.has(id as string)).toBe(true);
    }
  });

  test("it is bound to one session: another session's id is refused", async () => {
    const s = server();
    const result = payload(
      await s.call("session_end", {
        session: "sess_someone_else",
        memories: [{ content: "Something learned in a session this server never saw." }],
      }),
    );
    expect(result["reason"]).toBe("session-mismatch");
    expect(s.counterpart.store.list().length).toBe(0);
  });

  test("an unbound server refuses everyone — unbound is a refusal, not a wildcard", async () => {
    const s = server({ session: undefined });
    const result = payload(
      await s.call("session_end", { memories: [{ content: "A dump with no day to belong to." }] }),
    );
    expect(result["reason"]).toBe("no-bound-session");
    expect(s.counterpart.store.list().length).toBe(0);
  });

  test("entries are isolated: one refused entry does not take its siblings down", async () => {
    const s = server();
    const result = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [
          { content: "ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789" },
          { content: "The migration has to run before the container boots, or it comes up empty." },
          { content: "TODO" },
        ],
      }),
    );
    expect(result["deposited"]).toBe(1);
    expect(result["refused"]).toBe(2);
    const outcomes = result["outcomes"] as { stored: boolean; gate?: string }[];
    expect(outcomes[0]?.stored).toBe(false);
    expect(outcomes[1]?.stored).toBe(true);
    expect(outcomes[2]?.gate).toBe("content-stub");
  });
});

// ── observer ────────────────────────────────────────────────────────────────

describe("observer stands down over the wire", () => {
  test("every tool stands down and SAYS so, and nothing durable moves", async () => {
    const s = server({ observer: true, owner: true });
    const before = fingerprint(dir);

    const calls: [string, Record<string, unknown>][] = [
      ["note", { text: "An instrument must not deposit this." }],
      ["recall", { question: "anything at all" }],
      ["status", {}],
      ["session_end", { session: SESSION, memories: [{ content: "Nor this." }] }],
    ];
    for (const [name, args] of calls) {
      const result = await s.call(name, args);
      const body = payload(result);
      expect(body["stoodDown"]).toBe(true);
      expect(body["stance"]).toBe("observer");
      expect(result.isError).toBe(true);
    }
    expect(fingerprint(dir)).toBe(before);
    // A stood-down tool is DISTINGUISHABLE from a broken one (scar §2.4): the
    // telemetry says which tool stood down, every time.
    expect(s.events("mcp.observer.standdown").length).toBe(calls.length);
  });

  test("an observer is a non-owner regardless of what the host claimed", () => {
    const s = server({ observer: true, owner: true });
    expect(s.owner).toBe(false);
  });
});

// ── dependency direction ────────────────────────────────────────────────────

describe("the core imports nothing from this adapter", () => {
  test("no file under src/core mentions adapters/mcp", () => {
    const root = join(import.meta.dir, "..", "src", "core");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        if (readFileSync(full, "utf8").includes("adapters/mcp")) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  test("a Store opened straight at the temp dir sees what the tools wrote — the tools compose, they do not re-wire", async () => {
    const s = server();
    await s.call("note", { text: "Composition means the store is the same store, not a private one." });
    const direct = Store.open({ dir });
    open.push(direct);
    expect(direct.list({ archived: false }).length).toBe(1);
  });
});
