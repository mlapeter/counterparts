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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { UPDATES_META_KEY } from "../src/core/mint.js";
import { TUNABLES } from "../src/core/physics/index.js";
import { Store } from "../src/core/store/index.js";
import { SESSION_TTL_MS, recordSession } from "../src/adapters/sessions.js";
import {
  DELIBERATE_TIERS,
  ERROR_CODES,
  FrameReader,
  HARD_GATES,
  McpServer,
  PROTOCOL_VERSIONS,
  RECALL_BODY_CHARS,
  RECALL_EXCERPT_CHARS,
  RECALL_MAX_IDS,
  RECALL_RESULT_CHARS,
  SERVER_VERSION,
  TOOLS,
  TOOL_NAMES,
  encodeMessage,
  openServer,
  parseLine,
  renderDescription,
  resolveScope,
  serveStdio,
  tierOf,
  toolSpec,
} from "../src/adapters/mcp/index.js";
import type { Response, ToolResult } from "../src/adapters/mcp/index.js";
import { launchOptions } from "../src/adapters/mcp/bin/serve.js";
import { TUNABLES as RECALL_TUNABLES } from "../src/core/recall/index.js";

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

  test("the version in the handshake is the PACKAGE's version, not a literal that drifted", () => {
    // The one number a client can see about this server. `npm version` moves
    // package.json and nothing else, so this test is what keeps the handshake
    // honest across a release.
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
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

// ═══════════════════════════════════════════════════════════════════════════
/**
 * THE CHAPTER DOOR. The ask has said "add chapter N to this session's episode"
 * since the ritual shipped; until 2026-09-04 nothing on this host could accept
 * one. `Counterpart.appendEpisode` existed with no adapter calling it, so the
 * model wrote its chapters as notes titled "chapter N" and the store held zero
 * episodes for the whole run. These tests are the door, and the number on it.
 */
describe("the chapter tool — the episode's return channel", () => {
  function live(sessionId: string, scope: string, phase: "start" | "boundary" | "end" = "start"): void {
    expect(recordSession(dir, { sessionId, scope, phase })).not.toBeNull();
  }

  test("a bound chapter is APPENDED, and the number comes from the store", async () => {
    const s = server();
    const first = payload(
      await s.call("chapter", {
        session: SESSION,
        text: "We found the door that was never built, and the finding felt like relief rather than embarrassment.",
      }),
    );
    expect(first["stored"]).toBe(true);
    expect(first["chapter"]).toBe(1);
    expect(first["created"]).toBe(true);
    const episodeId = first["episodeId"] as string;
    expect(s.counterpart.store.readProse(episodeId).body).toContain("## chapter 1");

    // A second call with no ask in between CONTINUES chapter 1 — appending in
    // the moment is the doctrine's headline case, not an edge (§13 G2).
    const again = payload(
      await s.call("chapter", { session: SESSION, text: "And eighty seconds later, the thing that mattered." }),
    );
    expect(again["chapter"]).toBe(1);
    expect(again["episodeId"]).toBe(episodeId);
    const body = s.counterpart.store.readProse(episodeId).body;
    expect(body.split("## chapter 1").length - 1).toBe(1);
    expect(body).toContain("eighty seconds later");

    // A new ask opens chapter 2, and the ask's number matches what comes back.
    const ask = s.counterpart.episodeAsk(SESSION, { turns: 40, bytes: 40_000 });
    expect(ask.asked).toBe(true);
    expect(ask.chapter).toBe(2);
    const second = payload(await s.call("chapter", { session: SESSION, text: "The evening, which was different." }));
    expect(second["chapter"]).toBe(2);
  });

  test("it binds through the SAME registry rules as session_end, and says which refusal it was", async () => {
    live("sess_chapter", "/proj/alpha");
    const bound = server({ session: undefined, scope: "/proj/alpha" });
    const ok = payload(await bound.call("chapter", { session: "sess_chapter", text: "The first-person account." }));
    expect(ok["stored"]).toBe(true);
    expect(bound.session).toBe("sess_chapter");

    // Unknown id: refused, and the refusal names THIS tool, not `session_end`.
    const unknown = server({ session: undefined, scope: "/proj/alpha" });
    const refused = payload(await unknown.call("chapter", { session: "sess_invented", text: "Anything at all." }));
    expect(refused["reason"]).toBe("session-unknown");
    expect(refused["tool"]).toBe("chapter");
    // Nothing was written for the id nobody recorded: the ONE episode in this
    // store is the bound session's, from the call above.
    const episodes = unknown.counterpart.store.list({ type: "episode" });
    expect(episodes.length).toBe(1);
    expect(unknown.counterpart.store.readProse(episodes[0] ?? "").meta["sessionId"]).toBe("sess_chapter");

    // Ended: its memories belong to the sweep now, and so does its journal.
    live("sess_done", "/proj/alpha");
    live("sess_done", "/proj/alpha", "end");
    const ended = server({ session: undefined, scope: "/proj/alpha" });
    expect(payload(await ended.call("chapter", { session: "sess_done", text: "A late chapter." }))["reason"]).toBe(
      "session-not-live",
    );
  });

  test("an empty chapter is refused with a reason, and the gate refusal surfaces one too", async () => {
    const s = server();
    const empty = payload(await s.call("chapter", { session: SESSION, text: "   " }));
    expect(empty["stored"]).toBe(false);
    expect(empty["reason"]).toBe("text-required");

    // The journal is a gated entrance: a chapter that is nothing but a
    // credential is refused, with the gate that refused it named (scar §2.7).
    const credential = payload(
      await s.call("chapter", { session: SESSION, text: "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
    );
    expect(credential["stored"]).toBe(false);
    expect(typeof credential["reason"]).toBe("string");
    // Either the gate refused it outright or it was redacted before landing —
    // what must never happen is the credential reaching canonical prose.
    for (const id of s.counterpart.store.list({ type: "episode" })) {
      expect(s.counterpart.store.readProse(id).body).not.toContain("sk-ant-api03-AAAA");
    }
  });

  test("A FULL DAY: the ask, the chapter, the episode file, and ONE ingestion at the boundary", async () => {
    const s = server();
    // 1. The ask is due and names chapter 1.
    const ask = s.counterpart.episodeAsk(SESSION, { turns: 9, bytes: 6_000 });
    expect(ask.asked).toBe(true);
    expect(ask.chapter).toBe(1);

    // 2. The model answers it through the door.
    const written = payload(
      await s.call("chapter", {
        session: SESSION,
        text: "I learned that I stall when the spec is ambiguous, and that saying so early is cheaper than guessing.",
      }),
    );
    expect(written["stored"]).toBe(true);
    const episodeId = written["episodeId"] as string;

    // 3. The episode EXISTS as a file — the thing that did not exist at all for
    //    the whole first run of this system.
    expect(s.counterpart.store.list({ type: "episode" })).toEqual([episodeId]);

    // 4. The boundary ingests it, ONCE, as an ordinary self-kind memory.
    const report = await s.counterpart.sessionEnd({ date: "2026-09-05" });
    expect(report.episodes.ingested).toBe(1);
    const minted = s.counterpart.store
      .list({ type: "memory", archived: false })
      .map((id) => s.counterpart.store.readProse(id))
      .filter((d) => d.meta["episodeId"] === episodeId);
    expect(minted.length).toBe(1);
    expect(minted[0]?.body).toContain("ambiguous");

    // 5. A second boundary with nothing new ingests nothing: idempotent by
    //    identity, so the reconciler is safe to run at every boundary forever.
    const again = await s.counterpart.sessionEnd({ date: "2026-09-06" });
    expect(again.episodes.ingested).toBe(0);
    expect(again.episodes.skipped).toBe(1);
    expect(
      s.counterpart.store
        .list({ type: "memory", archived: false })
        .map((id) => s.counterpart.store.readProse(id))
        .filter((d) => d.meta["episodeId"] === episodeId).length,
    ).toBe(1);
  });
});

// ── the description audit (CONTRACT §5 G2/G3) ───────────────────────────────

describe("the tool-description audit", () => {
  test("the shipped list is exactly three verbs plus the two return channels — and no self-authorship tool", async () => {
    const s = server();
    const [response] = await pump(s, [rpc(1, "tools/list")]);
    const tools = (response as unknown as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(TOOL_NAMES).toEqual(["note", "recall", "status", "session_end", "chapter"]);
    // §4: self-writing is the boundary's job by construction, and `protected.add`
    // went with the second-signature queue. Enumerated absent, not assumed
    // absent. `chapter` is not a re-opened self-store: it appends to the
    // session's journal, which becomes memory only through gated ingestion.
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

  test("the mechanism behind the default-floor claim fires: an unclaimed note is ordinary, not zero", async () => {
    const s = server();
    const result = await s.call("note", {
      text: "The invoice import silently skips rows whose currency column is empty.",
    });
    const body = payload(result);
    expect(body["stored"]).toBe(true);
    const id = body["id"] as string;
    const physics = s.counterpart.store.physicsOf(id);
    expect(physics.salience.claimed).toBe(TUNABLES.AUTHORED_DEFAULT_CLAIM);
    // Durable, and countable tomorrow: the flag is on canonical prose.
    expect(s.counterpart.store.readProse(id).meta["claimedDefault"]).toBe(true);
    // Ordinary, not important: an unclaimed note is still episodic, and the
    // engine's floor is not reported back as a lift the model made.
    expect(s.counterpart.store.row(id)?.band).toBe("episodic");
    expect(body["salienceLifted"]).toBeUndefined();
  });

  test("an explicit LOW claim survives the default: testimony is never overwritten", async () => {
    const s = server();
    const body = payload(
      await s.call("note", {
        text: "A minor formatting preference, marked as barely worth holding onto.",
        salience: 0.05,
      }),
    );
    const id = body["id"] as string;
    expect(s.counterpart.store.physicsOf(id).salience.claimed).toBe(0.05);
    expect(s.counterpart.store.readProse(id).meta["claimedDefault"]).toBeUndefined();
  });

  test("the mechanism behind the dimensions claim fires: the author's three reach the row", async () => {
    const s = server();
    const body = payload(
      await s.call("note", {
        text: "The retry loop doubles the delay each time, which is why the last attempt takes a minute.",
        relevance: 0.8,
        emotional: 0.2,
        predictive: 0.6,
      }),
    );
    expect(body["stored"]).toBe(true);
    const row = s.counterpart.store.row(body["id"] as string);
    expect({ rel: row?.relevance, emo: row?.emotional, pred: row?.predictive }).toEqual({
      rel: 0.8,
      emo: 0.2,
      pred: 0.6,
    });
    // Novelty is not the author's to claim, whatever it sends.
    const sneaky = payload(
      await s.call("note", {
        text: "A second unrelated thing about the retry loop's jitter window.",
        novelty: 0.99,
      }),
    );
    expect(s.counterpart.store.row(sneaky["id"] as string)?.novelty).toBeNull();
  });

  test("an out-of-range dimension is REFUSED by name, not clamped and not silently dropped", async () => {
    const s = server();
    const body = payload(
      await s.call("note", { text: "A perfectly ordinary thing to remember.", relevance: 7 }),
    );
    expect({ stored: body["stored"], reason: body["reason"] }).toEqual({
      stored: false,
      reason: "dimension-out-of-range",
    });
  });

  test("session_end entries carry their own dimensions, and a bad one fails only itself", async () => {
    const s = server();
    const body = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [
          {
            content: "The nightly export runs before the backup, which is why a failed export leaves a stale copy.",
            relevance: 0.7,
            emotional: 0.1,
            predictive: 0.9,
          },
          { content: "A sibling entry whose relevance is nonsense.", relevance: 4 },
          { content: "A third entry that claims nothing at all and should still land." },
        ],
      }),
    );
    const outcomes = body["outcomes"] as Record<string, unknown>[];
    expect(outcomes[0]?.["stored"]).toBe(true);
    expect(outcomes[1]?.["stored"]).toBe(false);
    expect(outcomes[2]?.["stored"]).toBe(true);
    const first = s.counterpart.store.row(outcomes[0]?.["id"] as string);
    expect({ rel: first?.relevance, emo: first?.emotional, pred: first?.predictive }).toEqual({
      rel: 0.7,
      emo: 0.1,
      pred: 0.9,
    });
    // The unclaimed sibling got the floor rather than a zero.
    expect(s.counterpart.store.row(outcomes[2]?.["id"] as string)?.claimed).toBe(
      TUNABLES.AUTHORED_DEFAULT_CLAIM,
    );
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
    // ADJUSTED 2026-09-04: the payload field is `excerpt`, not `body`. The old
    // field shipped every body at full length and overflowed the host's
    // tool-result ceiling on 3 of 3 real calls; the bound is the fix, and the
    // rename is what makes "this may be less than the whole thing" visible.
    expect((byId["memories"] as { excerpt: string }[])[0]?.excerpt).toContain("sourdough");

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
    // `ids` is a THIRD path, under the same rule.
    expect(payload(await s.call("recall", { question: "y", ids: ["mem_x"] }))["reason"]).toBe(
      "both-arguments",
    );
    expect(payload(await s.call("recall", { ids: "mem_x" }))["reason"]).toBe(
      "ids-not-a-string-array",
    );
  });

  test("the result is bounded: excerpts in a list, and it says when it cut something", async () => {
    // MEASURED 2026-09-04: three real `recall` calls returned 7, 8 and 12 full
    // bodies — 73,000 to 122,000 characters — and every one overflowed the
    // host's tool-result ceiling. The bound is the fix; this is its floor.
    const s = server();
    seed(s.counterpart);
    const long = "Sourdough notes. ".repeat(600); // ~10 KB, the shape of a hub
    for (let i = 0; i < 6; i++) {
      s.counterpart.store.put({
        type: "memory",
        kind: "skill",
        title: `Sourdough ${i}`,
        body: `${long} Entry ${i}: the sourdough starter died after neglect.`,
      });
    }
    const result = payload(await s.call("recall", { question: "my sourdough starter died" }));
    const memories = result["memories"] as { id: string; excerpt: string; bodyChars: number; truncated: boolean }[];
    expect(memories.length).toBeGreaterThan(0);

    // Every excerpt is bounded, the total is bounded, and the whole rendered
    // result is comfortably under the ceiling the live calls blew through.
    for (const m of memories) {
      expect(m.excerpt.length).toBeLessThanOrEqual(RECALL_EXCERPT_CHARS);
      expect(m.bodyChars).toBeGreaterThan(m.excerpt.length);
      expect(m.truncated).toBe(true);
    }
    expect(result["chars"] as number).toBeLessThanOrEqual(RECALL_RESULT_CHARS);
    expect(JSON.stringify(result).length).toBeLessThan(RECALL_RESULT_CHARS + 4000);
    // Truncation is STATED, never silent, and the budget names its own remedy.
    expect(result["truncated"]).toBe(true);
    expect(result["budget"] as string).toContain("ids");
    // `considered` is a cap, and the payload says which one (§9.1 G3).
    expect(result["consideredCap"]).toBe(RECALL_TUNABLES.MAX_CANDIDATES);
    expect(result["considered"] as number).toBeLessThanOrEqual(RECALL_TUNABLES.MAX_CANDIDATES);
  });

  test("ids expands a few of those in full, capped, and refuses a fourth", async () => {
    const s = server();
    seed(s.counterpart);
    const bodies = [
      "The sourdough starter died after two weeks of neglect and needs daily feeding.",
      "The rye levain doubles in four hours at twenty-four degrees.",
      "The banneton needs rice flour or the dough welds itself to the cloth.",
      "The oven spring collapses when the score is too shallow.",
    ];
    const ids = bodies.map((body, i) =>
      s.counterpart.store.put({ type: "memory", kind: "skill", title: `Bread ${i}`, body }),
    );

    const three = payload(await s.call("recall", { ids: ids.slice(0, 3) }));
    expect(three["reason"]).toBe("expanded");
    expect(three["path"]).toBe("handle");
    const got = three["memories"] as { id: string; excerpt: string; truncated: boolean }[];
    expect(got.map((m) => m.id).sort()).toEqual([...ids.slice(0, 3)].sort());
    // FULL bodies on this path — that is what asking by id buys.
    for (const m of got) expect(m.truncated).toBe(false);
    expect(got.map((m) => m.excerpt).join("")).toContain("banneton");

    // A fourth is a refusal by name, not a silent slice.
    const four = payload(await s.call("recall", { ids }));
    expect(four["reason"]).toBe("ids-too-many");
    expect((four["memories"] as unknown[]).length).toBe(0);
    expect(four["refused"] as string).toContain(String(RECALL_MAX_IDS));

    // An unresolvable id is stated per id rather than folded into a total.
    const mixed = payload(await s.call("recall", { ids: [ids[0] as string, "mem_notreal"] }));
    expect(mixed["reason"]).toBe("expanded");
    expect(mixed["perId"]).toEqual([
      { id: ids[0] as string, reason: "expanded" },
      { id: "mem_notreal", reason: "handle-unknown" },
    ]);
  });

  test("even the id path stays under the wire budget", async () => {
    const s = server();
    seed(s.counterpart);
    const huge = "Long-form migrated material. ".repeat(2000); // ~58 KB each
    const ids = [0, 1, 2].map((i) =>
      s.counterpart.store.put({ type: "memory", kind: "fact", title: `Hub ${i}`, body: `${huge} ${i}` }),
    );
    const result = payload(await s.call("recall", { ids }));
    expect(result["chars"] as number).toBeLessThanOrEqual(RECALL_RESULT_CHARS);
    expect(result["truncated"]).toBe(true);
    for (const m of result["memories"] as { excerpt: string }[]) {
      expect(m.excerpt.length).toBeLessThanOrEqual(RECALL_BODY_CHARS);
    }
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
    const memories = result["memories"] as { tier: string; excerpt: string }[];

    expect(result["reason"]).toBe("answered");
    expect(memories.length).toBeGreaterThan(0);
    // ADJUSTED 2026-09-04: `body` -> `excerpt` (see the handle test above).
    expect(memories[0]?.excerpt.length).toBeGreaterThan(0);
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
  test("the journal is counted APART from the memories, and the census says so", async () => {
    // An episode neither decays nor exits (`sleep/types.ts#isJournal`), so
    // counting it as a memory would report as "held" a row that can never
    // leave — and a count that quietly excludes something is worse.
    const s = server();
    s.counterpart.store.put({
      type: "memory",
      kind: "self",
      body: "What that day taught, which is a different thing from the account of it.",
    });
    s.counterpart.store.put({
      type: "episode",
      kind: "self",
      body: "## chapter 1 — lived day 0\n\nThe account itself.\n",
      source: "episode",
    });
    const census = payload(await s.call("status", {}));
    expect(census["live"]).toBe(1);
    expect(census["journal"]).toBe(1);
    expect((census["byKind"] as Record<string, number>)["self"]).toBe(1);
    expect(String(census["counts"])).toContain("MEMORIES");
  });


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

describe("session_end — the memories half of the Stop ask's return channel", () => {
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

  test("an unbound server refuses a bare dump — a claim with no id is not a wildcard", async () => {
    const s = server({ session: undefined });
    const result = payload(
      await s.call("session_end", { memories: [{ content: "A dump with no day to belong to." }] }),
    );
    expect(result["reason"]).toBe("session-required");
    // The refusal tells the model what to do about it, which is the whole
    // difference between a refusal and a dead end.
    expect(String(result["detail"])).toContain("session");
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

// ── the lazy bind ───────────────────────────────────────────────────────────

/**
 * The bind matrix. This host launches its MCP servers from a static config, so
 * `--session` never arrives and every dump for the first run was refused; the
 * lazy bind is the answer, and its whole safety argument is that the id is
 * CORROBORATED against host state the model cannot write.
 *
 * Every row here writes the registry through `recordSession` — the same function
 * the hooks call — rather than hand-rolling JSON, so a change to the record
 * shape cannot pass this suite while breaking the hooks.
 */
describe("the lazy session bind", () => {
  const dump = (session?: string): Record<string, unknown> => ({
    ...(session === undefined ? {} : { session }),
    memories: [{ content: "The MCP server learns its session from the hooks' registry, not from the model." }],
  });

  function live(sessionId: string, scope: string, phase: "start" | "boundary" | "end" = "start"): void {
    expect(recordSession(dir, { sessionId, scope, phase })).not.toBeNull();
  }

  test("a valid claim binds the server, and the deposit lands under the claimed session", async () => {
    live("sess_live_1", "/proj/alpha");
    const s = server({ session: undefined, scope: "/proj/alpha" });
    const result = payload(await s.call("session_end", dump("sess_live_1")));
    expect(result["session"]).toBe("sess_live_1");
    expect(result["deposited"]).toBe(1);
    expect(s.session).toBe("sess_live_1");
    expect(s.events("mcp.session.bound")[0]?.data?.["source"]).toBe("registry");
  });

  test("the bind is for the life of the process: a second, different id is refused", async () => {
    live("sess_live_1", "/proj/alpha");
    live("sess_live_2", "/proj/alpha");
    const s = server({ session: undefined, scope: "/proj/alpha" });
    expect(payload(await s.call("session_end", dump("sess_live_1")))["deposited"]).toBe(1);
    const second = payload(await s.call("session_end", dump("sess_live_2")));
    expect(second["reason"]).toBe("session-mismatch");
    // The first session's memory stands; the second session's does not exist.
    expect(s.counterpart.store.list().length).toBe(1);
  });

  test("an id nobody recorded is refused — the registry is the corroboration", async () => {
    const s = server({ session: undefined, scope: "/proj/alpha" });
    const result = payload(await s.call("session_end", dump("sess_invented")));
    expect(result["reason"]).toBe("session-unknown");
    expect(s.session).toBeNull();
    expect(s.counterpart.store.list().length).toBe(0);
  });

  test("an ENDED session is refused: its memories belong to the sweep now", async () => {
    live("sess_over", "/proj/alpha");
    live("sess_over", "/proj/alpha", "end");
    const s = server({ session: undefined, scope: "/proj/alpha" });
    const result = payload(await s.call("session_end", dump("sess_over")));
    expect(result["reason"]).toBe("session-not-live");
    expect(s.events("mcp.session.unbound").at(-1)?.data?.["reason"]).toBe("ended");
  });

  test("a session silent past the TTL is refused, and the TTL is the only thing that decides it", async () => {
    live("sess_stale", "/proj/alpha");
    const stale = server({ session: undefined, scope: "/proj/alpha", now: () => Date.now() + SESSION_TTL_MS + 1_000 });
    expect(payload(await stale.call("session_end", dump("sess_stale")))["reason"]).toBe("session-not-live");
    expect(stale.events("mcp.session.unbound").at(-1)?.data?.["reason"]).toBe("stale");
    // The same record, one second inside the window: bound.
    const fresh = server({ session: undefined, scope: "/proj/alpha", now: () => Date.now() + SESSION_TTL_MS - 1_000 });
    expect(payload(await fresh.call("session_end", dump("sess_stale")))["deposited"]).toBe(1);
  });

  test("a live session in ANOTHER project is refused — a dump belongs to the project that lived it", async () => {
    live("sess_elsewhere", "/proj/beta");
    const s = server({ session: undefined, scope: "/proj/alpha" });
    const result = payload(await s.call("session_end", dump("sess_elsewhere")));
    expect(result["reason"]).toBe("scope-mismatch");
    expect(s.counterpart.store.list().length).toBe(0);
  });

  test("scope comparison is PHYSICAL: a symlinked path and its target are the same project", async () => {
    const realProject = mkdtempSync(join(tmpdir(), "counterparts-proj-"));
    const links = mkdtempSync(join(tmpdir(), "counterparts-link-"));
    const linked = join(links, "link-to-project");
    try {
      symlinkSync(realProject, linked);
      live("sess_symlink", linked);
      // The server's own scope names the target; the hook recorded the link.
      const s = server({ session: undefined, scope: realProject });
      expect(payload(await s.call("session_end", dump("sess_symlink")))["deposited"]).toBe(1);
    } finally {
      rmSync(links, { recursive: true, force: true });
      rmSync(realProject, { recursive: true, force: true });
    }
  });

  test("an explicit --session still wins: the registry is never consulted, and a bad claim is a mismatch", async () => {
    // A registry that says something ELSE about both ids. The launched server
    // does not care: being told is the preferred path and it is unchanged.
    live("sess_other", "/proj/beta");
    const s = server({ scope: "/proj/alpha" });
    expect(s.launchedSession).toBe(SESSION);
    expect(payload(await s.call("session_end", dump(SESSION)))["deposited"]).toBe(1);
    expect(payload(await s.call("session_end", dump("sess_other")))["reason"]).toBe("session-mismatch");
    expect(s.events("mcp.session.bound")).toEqual([]);
  });

  test("a session id is a FILENAME, and the claim comes from a model: traversal is not looked up", async () => {
    const s = server({ session: undefined, scope: "/proj/alpha" });
    for (const bad of ["../../etc/passwd", "..", "sess/../other", "sess one"]) {
      expect(payload(await s.call("session_end", dump(bad)))["reason"]).toBe("session-unknown");
    }
    expect(s.session).toBeNull();
  });

  test("once bound, the session id reaches the other tools too — no more literal \"mcp\"", async () => {
    live("sess_gate", "/proj/alpha");
    const s = server({ session: undefined, scope: "/proj/alpha" });
    await s.call("session_end", dump("sess_gate"));
    expect(s.session).toBe("sess_gate");
    // `note` and `recall` both read `this.session`, so both stop borrowing the
    // shared "mcp" gate-state row the moment the bind lands (INTERFACE-GAPS §6).
    const noted = payload(await s.call("note", { text: "A note written after the bind rides the same session as the dump." }));
    expect(noted["stored"]).toBe(true);
    expect(payload(await s.call("recall", { question: "what binds this server?" }))["path"]).toBeDefined();
    expect(s.counterpart.store.row(noted["id"] as string)?.origin_scope).toBe("/proj/alpha");
  });
});

describe("the scope default", () => {
  test("no --scope means this process's working directory, not the store dir", () => {
    const s = server({ scope: undefined });
    expect(s.scope).toBe(process.cwd());
    expect(s.scopeSource).toBe("cwd");
    // Reported at startup: which default won is on the record from event one.
    expect(s.events("mcp.scope")[0]?.data?.["source"]).toBe("cwd");
  });

  test("an explicit scope wins, and the store dir is the last resort only", () => {
    expect(resolveScope("/proj/alpha", "/data")).toEqual({ scope: "/proj/alpha", source: "flag" });
    expect(resolveScope(undefined, "/data").source).toBe("cwd");
    // The one case the store fallback exists for: no working directory at all.
    const cwd = process.cwd;
    try {
      process.cwd = (): string => {
        throw new Error("ENOENT");
      };
      expect(resolveScope(undefined, "/data")).toEqual({ scope: "/data", source: "store" });
    } finally {
      process.cwd = cwd;
    }
  });

  test("a memory authored through the server is stamped with the PROJECT, not the store path", async () => {
    const s = server({ scope: "/proj/alpha" });
    const body = payload(await s.call("note", { text: "Origin scope is the project the session ran in, never the store's own directory." }));
    const id = body["id"] as string;
    expect(s.counterpart.store.row(id)?.origin_scope).toBe("/proj/alpha");
    expect(s.counterpart.store.row(id)?.origin_scope).not.toBe(dir);
  });
});

// ── `updates` as a field ────────────────────────────────────────────────────

describe("`updates` is a field on `note`, not prose", () => {
  test("a declared id that resolves is written to meta as the RESOLVED id", async () => {
    const s = server();
    const first = payload(
      await s.call("note", { text: "Deploys go out at 4pm on Thursdays, after the migration window closes." }),
    );
    const target = first["id"] as string;
    const second = payload(
      await s.call("note", {
        text: "Deploys moved to 10am on Tuesdays, because the Thursday window collided with the finance batch.",
        updates: target,
      }),
    );
    expect(second["stored"]).toBe(true);
    expect(s.counterpart.store.readProse(second["id"] as string).meta[UPDATES_META_KEY]).toBe(target);
  });

  test("an unresolvable declaration lands UNLINKED — never refused", async () => {
    const s = server();
    const body = payload(
      await s.call("note", {
        text: "The retro moved to Fridays, which is a real thing to remember whatever it revises.",
        updates: "mem_that_never_existed",
      }),
    );
    expect(body["stored"]).toBe(true);
    expect(
      s.counterpart.store.readProse(body["id"] as string).meta[UPDATES_META_KEY],
    ).toBeUndefined();
  });

  test("the schema OFFERS the field — the ask tells the model it is a field, so it has to exist", () => {
    const props = (toolSpec("note")?.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props["updates"]).toBeDefined();
    const entry = (
      (toolSpec("session_end")?.inputSchema as { properties: Record<string, { items?: { properties?: Record<string, unknown> } }> })
        .properties["memories"]?.items?.properties ?? {}
    );
    expect(entry["updates"]).toBeDefined();
  });
});

// ── observer ────────────────────────────────────────────────────────────────

describe("observer stands down over the wire", () => {
  test("every tool stands down and SAYS so, and nothing durable moves", async () => {
    // An observer no longer mints an absent store (cli INTERFACE-GAPS §7).
    Store.open({ dir }).close();
    const s = server({ observer: true, owner: true });
    const before = fingerprint(dir);

    const calls: [string, Record<string, unknown>][] = [
      ["note", { text: "An instrument must not deposit this." }],
      ["recall", { question: "anything at all" }],
      ["status", {}],
      ["session_end", { session: SESSION, memories: [{ content: "Nor this." }] }],
      ["chapter", { session: SESSION, text: "Nor an instrument's own first-person reflection." }],
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
    Store.open({ dir }).close();
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

// ═══════════════════════════════════════════════════════════════════════════
// The deliberate ask embeds IN LINE — the half of the ruling that may
// ═══════════════════════════════════════════════════════════════════════════
/**
 * The ruling of 2026-09-04 splits the two retrieval paths on latency, not on
 * principle: the ambient hook may not embed (a 1200 ms budget, a person
 * mid-sentence, and a synchronous pass that ABORTS rather than degrades), and
 * the deliberate ask may (someone typed a question and is waiting).
 *
 * Before this, `answerQuestion` built its turn with no vector at all, so the
 * tool that exists to look harder looked with one channel of three.
 */
describe("the recall tool embeds the question when it can, and SAYS SO when it cannot", () => {
  /** The narrow face the server takes. A test supplies its own; production
   *  supplies `claude-code/embed-client.ts`'s `LiveEmbedder`, opened by the
   *  entry point that holds the credential. */
  function embedder(vector: number[] | null): { vector(text: string): Promise<number[] | null>; asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      vector: async (text: string) => {
        asked.push(text);
        return vector;
      },
    };
  }

  test("a question is embedded once, and the answer names the channel that ran", async () => {
    const emb = embedder([0.1, 0.2, 0.3]);
    const s = server({ embedder: emb });
    seed(s.counterpart);
    const out = await s.call("recall", { question: "What did we decide about the storage split?" });
    expect(emb.asked).toEqual(["What did we decide about the storage split?"]);
    expect(out.structuredContent["semantic"]).toBe("in-line");
    expect(s.events("mcp.recall")[0]?.data?.["semantic"]).toBe("in-line");
  });

  test("no embedder ⇒ the ask still answers, LEXICALLY, and says which channel was dark", async () => {
    const s = server();
    seed(s.counterpart);
    const out = await s.call("recall", { question: "What did we decide about the storage split?" });
    // Degraded, not failed: guarantee 1 is "degrade to lexical-only rather than
    // fail", and the caller is told rather than handed a quietly thinner answer.
    expect(out.structuredContent["semantic"]).toBe("embedder-off");
    expect(out.isError).toBeUndefined();
  });

  test("an embedder that refuses is `embed-failed`, not silence", async () => {
    const s = server({ embedder: embedder(null) });
    seed(s.counterpart);
    const out = await s.call("recall", { question: "What did we decide about the storage split?" });
    expect(out.structuredContent["semantic"]).toBe("embed-failed");
  });

  test("the HANDLE path embeds nothing — an exact address needs no vector", async () => {
    const emb = embedder([0.1, 0.2, 0.3]);
    const s = server({ embedder: emb });
    seed(s.counterpart);
    const out = await s.call("recall", { handle: "nothing-by-this-name" });
    expect(emb.asked).toEqual([]);
    expect(out.structuredContent["semantic"]).toBe("none");
  });

  test("an OBSERVER opens no socket, whatever the host handed it (scar E7)", async () => {
    const emb = embedder([0.1, 0.2, 0.3]);
    // An observer refuses to open a store that does not exist, so the dir is
    // initialized by an ordinary session first — as it would be in life.
    server().counterpart.close();
    const s = server({ observer: true, embedder: emb });
    await s.call("recall", { question: "Anything at all?" });
    expect(emb.asked).toEqual([]);
  });
});
