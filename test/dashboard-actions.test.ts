/**
 * `adapters/dashboard/web/actions.ts` — managing memory from the dashboard,
 * through the console's own doors (owner, 2026-09-25; CONTRACT §5 [A]).
 *
 * What this file proves:
 *
 *   1. **The door refuses anything that is not the page itself**: a GET, a
 *      request with no Origin or another Origin, a non-loopback Host, the wrong
 *      port, a cross-site `Sec-Fetch-Site`, a body that is not JSON, and a
 *      request without this launch's token — over the wire, and none of them
 *      moves a byte of the store.
 *   2. **Arguments are validated and cannot become flags**: `--dir` is the
 *      dashboard's own store and never a field of the request; every positional
 *      follows `--`; ids, paths and numbers are checked; the terminal-only
 *      commands are not actions at all.
 *   3. **A write lands while the dashboard holds its read-only connection open**
 *      (WAL), and the dashboard's own views show it on the next request.
 *   4. **Remove is the console's two steps**: the dry run changes nothing, a
 *      mistyped confirmation is refused by the console's own comparison, and
 *      the typed id removes it — after which the open dashboard stops resolving it.
 *   5. backup, export, scope, rebrief, verify and ask run and say what the
 *      console says; the queue and the timeout behave.
 *
 * Hermetic (CLAUDE.md): every store, configuration and output folder lives in
 * a fresh temp dir removed afterwards; the configuration is always NAMED, so no
 * command falls back to a default one.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Dashboard } from "../src/adapters/dashboard/index.js";
import {
  ACTIONS,
  TOKEN_META,
  buildArgv,
  checkActionRequest,
  newActionToken,
  runAction,
  tokensMatch,
} from "../src/adapters/dashboard/web/actions.js";
import type { ActionRequest, Run } from "../src/adapters/dashboard/web/actions.js";
import { router, startDashboard } from "../src/adapters/dashboard/web/server.js";
import type { RunningDashboard } from "../src/adapters/dashboard/web/server.js";
import { Database } from "bun:sqlite";

import { Store } from "../src/core/store/index.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

let temps: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
beforeEach(() => {
  temps = [];
});
afterEach(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** A store and a configuration naming it, with recall by meaning off (no model load). */
function fixture(): { root: string; dir: string; config: string } {
  const root = tempDir("counterparts-actions-");
  const seeded = seedEmpty({ dir: join(root, "store") });
  const config = join(root, "claude-code.json");
  writeFileSync(
    config,
    JSON.stringify({ dataDir: seeded.dir, injectionBudgetBytes: 9000, embedder: { enabled: false } }),
  );
  return { root, dir: seeded.dir, config };
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      const rel = relative(dir, full);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // Box 3 is rebuildable and rewritten on every open (INTERFACE-GAPS §1);
      // `-shm` takes read-marks from every WAL reader. The `-wal` is kept: a
      // commit lives there until a checkpoint, so it is where a write would show.
      if (rel.startsWith("cache") || entry.name.endsWith("-shm")) continue;
      if (!entry.isFile()) continue;
      out.set(rel, `${statSync(full).size}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
    }
  };
  walk(dir);
  return out;
}

function diff(a: Map<string, string>, b: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [path, hash] of a) {
    if (!b.has(path)) changed.push(`gone: ${path}`);
    else if (b.get(path) !== hash) changed.push(`changed: ${path}`);
  }
  for (const path of b.keys()) if (!a.has(path)) changed.push(`appeared: ${path}`);
  return changed.sort();
}

// ── 1. the request guard ────────────────────────────────────────────────────

describe("the action door answers only the dashboard's own page", () => {
  const TOKEN = "ab".repeat(32);
  const good: ActionRequest = {
    method: "POST",
    host: "127.0.0.1:4462",
    origin: "http://127.0.0.1:4462",
    contentType: "application/json",
    token: TOKEN,
    fetchSite: "same-origin",
  };
  const check = (over: Partial<ActionRequest>): number | null =>
    checkActionRequest({ ...good, ...over }, TOKEN, 4462)?.status ?? null;

  test("the page's own request passes, under every loopback spelling", () => {
    expect(check({})).toBeNull();
    expect(check({ fetchSite: null })).toBeNull();
    expect(check({ host: "localhost:4462", origin: "http://localhost:4462" })).toBeNull();
    expect(check({ host: "[::1]:4462", origin: "http://[::1]:4462" })).toBeNull();
    expect(check({ contentType: "application/json; charset=utf-8" })).toBeNull();
  });

  test("anything else is refused, and says why", () => {
    expect(check({ method: "GET" })).toBe(405);
    expect(check({ host: "evil.example:4462" })).toBe(403); // DNS rebinding
    expect(check({ host: "127.0.0.1:9999", origin: "http://127.0.0.1:9999" })).toBe(403); // another port
    expect(check({ host: null })).toBe(403);
    expect(check({ origin: null })).toBe(403);
    expect(check({ origin: "" })).toBe(403);
    expect(check({ origin: "null" })).toBe(403); // a sandboxed frame or a file:// page
    expect(check({ origin: "http://evil.example" })).toBe(403); // CSRF
    expect(check({ origin: "http://localhost:4462" })).toBe(403); // not the Host it was sent to
    expect(check({ origin: "https://127.0.0.1:4462" })).toBe(403);
    expect(check({ origin: "http://127.0.0.1:4463" })).toBe(403);
    expect(check({ fetchSite: "cross-site" })).toBe(403);
    expect(check({ fetchSite: "same-site" })).toBe(403);
    expect(check({ contentType: "text/plain" })).toBe(415); // what a cross-site form can send
    expect(check({ contentType: "application/x-www-form-urlencoded" })).toBe(415);
    expect(check({ contentType: null })).toBe(415);
    expect(check({ token: null })).toBe(403);
    expect(check({ token: "" })).toBe(403);
    expect(check({ token: "cd".repeat(32) })).toBe(403);
    expect(check({ token: TOKEN.slice(1) })).toBe(403);
  });

  test("a token is 64 hex characters, fresh each launch, and compared whole", () => {
    const a = newActionToken();
    const b = newActionToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(tokensMatch(a, a)).toBe(true);
    expect(tokensMatch(a, b)).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
  });
});

// ── 2. arguments ────────────────────────────────────────────────────────────

describe("an action's fields become an argv the console reads as meant", () => {
  const ctx = { dir: "/tmp/the-store", config: "/tmp/the-config.json" };
  const bad = (name: (typeof ACTIONS)[number], body: Record<string, unknown>, c: typeof ctx | { dir: string } = ctx): string => {
    try {
      buildArgv(name, body, c);
    } catch (err) {
      return (err as Error).message;
    }
    return "accepted";
  };

  test("--dir is the dashboard's own store, never a field; text comes after --", () => {
    const note = buildArgv("note", { text: "the kettle is broken", dir: "/elsewhere", out: "/x" }, ctx);
    expect(note.argv).toEqual(["note", "--dir", "/tmp/the-store", "--config", "/tmp/the-config.json", "--", "the kettle is broken"]);
    expect(note.argv).not.toContain("/elsewhere");
    // Words with a flag INSIDE them stay one positional, after `--`.
    expect(buildArgv("ask", { question: "what did --dir mean?" }, ctx).argv.slice(-2)).toEqual([
      "--",
      "what did --dir mean?",
    ]);
  });

  test("text that begins with -- is refused rather than handed to a flag parser", () => {
    // (After `--` the console would still read it as words, but its unknown-flag
    // check scans every token and would refuse it with a confusing sentence.)
    expect(bad("note", { text: "--dir /elsewhere" })).toContain('may not begin with "--"');
    expect(bad("ask", { question: "  --help" })).toContain('may not begin with "--"');
  });

  test("ids, paths, numbers and modes are checked before anything runs", () => {
    expect(bad("remove", {})).toContain("id is required");
    expect(bad("remove", { id: "mem_x y" })).toContain("not a memory id");
    expect(bad("remove", { id: "../../etc" })).toContain("not a memory id");
    expect(bad("remove", { id: "--confirm" })).toContain("not a memory id");
    expect(bad("remove", { id: "mem_0123456789ab", confirm: 7 })).toContain("typed back");
    expect(bad("backup", { out: "relative/folder" })).toContain("absolute");
    expect(bad("backup", { out: "/tmp/a\u0000b" })).toContain("NUL");
    expect(bad("backup", { out: "/tmp/a\nb" })).toContain("control characters");
    expect(bad("backup", {})).toContain("out is required");
    expect(bad("note", { text: "x", salience: 2 })).toContain("0 to 1");
    expect(bad("note", { text: "x", kind: "two words" })).toContain("one word");
    expect(bad("note", { text: "x".repeat(20_001) })).toContain("longer than");
    expect(bad("ask", {})).toContain("one of them");
    expect(bad("ask", { question: "q", id: "mem_0123456789ab" })).toContain("one of them");
    expect(bad("rebrief", { budget: -3 })).toContain("whole number");
    expect(bad("scope", { path: "/tmp/p", mode: "sideways" })).toContain("mode is one of");
    expect(bad("verify", { rebuild: "yes" })).toContain("true or false");
    // Scope with no configuration named would fall back to the default one.
    expect(bad("scope", { list: true }, { dir: "/tmp/the-store" })).toContain("without one");
  });

  test("remove without a typed confirmation is the console's dry run; with one, --confirm", () => {
    expect(buildArgv("remove", { id: "mem_0123456789ab" }, ctx)).toEqual({
      argv: ["remove", "--dir", "/tmp/the-store", "--", "mem_0123456789ab"],
    });
    expect(buildArgv("remove", { id: "mem_0123456789ab", confirm: "mem_0123456789ab" }, ctx)).toEqual({
      argv: ["remove", "--dir", "/tmp/the-store", "--confirm", "--", "mem_0123456789ab"],
      answer: "mem_0123456789ab",
    });
  });

  test("install, uninstall and start-fresh are not actions", async () => {
    for (const name of ["install", "uninstall", "start-fresh", "connect", "self-page", "migrate-cache"]) {
      const r = await runAction(name, {}, ctx);
      expect(r.status).toBe(404);
    }
    expect([...ACTIONS].sort()).toEqual(["ask", "backup", "export", "note", "rebrief", "remove", "scope", "verify"]);
  });
});

// ── 3–5. over the wire, on a real store ─────────────────────────────────────

async function post(
  running: RunningDashboard,
  name: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${running.url}/api/action/${name}`, {
    method: "POST",
    headers: {
      origin: running.url,
      "content-type": "application/json",
      "x-counterparts-token": running.token,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function getJson(running: RunningDashboard, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${running.url}${path}`);
  return (await res.json()) as Record<string, unknown>;
}

const lines = (r: { json: Record<string, unknown> }): string =>
  [...((r.json["out"] as string[]) ?? []), ...((r.json["err"] as string[]) ?? [])].join("\n");

describe("managing, over the wire", () => {
  test("the served page carries this launch's token; router() alone serves none", async () => {
    const f = fixture();
    const running = await startDashboard({ dir: f.dir, port: 0, config: f.config });
    try {
      const page = await (await fetch(`${running.url}/`)).text();
      expect(page).toContain(`<meta name="${TOKEN_META}" content="${running.token}">`);
    } finally {
      await running.stop();
    }
    const d = Dashboard.open({ dir: f.dir });
    try {
      const bare = router(new URL("http://127.0.0.1:4747/"), "127.0.0.1:4747", d.source);
      expect(bare.body).toContain(`<meta name="${TOKEN_META}" content="">`);
    } finally {
      d.close();
    }
  });

  test("no page of the dashboard may be framed (clickjacking)", async () => {
    const f = fixture();
    const running = await startDashboard({ dir: f.dir, port: 0, config: f.config });
    try {
      for (const path of ["/", "/index.html", "/brain"]) {
        const res = await fetch(`${running.url}${path}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("x-frame-options")).toBe("DENY");
        expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      }
    } finally {
      await running.stop();
    }
  });

  test("every refused request is refused before anything runs, and moves no byte", async () => {
    const f = fixture();
    const running = await startDashboard({ dir: f.dir, port: 0, config: f.config });
    try {
      const before = snapshot(f.dir);
      const note = { text: "this must never be remembered" };
      expect((await post(running, "note", note, { "x-counterparts-token": "" })).status).toBe(403);
      expect((await post(running, "note", note, { "x-counterparts-token": newActionToken() })).status).toBe(403);
      expect((await post(running, "note", note, { origin: "http://evil.example" })).status).toBe(403);
      expect((await post(running, "note", note, { origin: "null" })).status).toBe(403);
      expect((await post(running, "note", note, { "sec-fetch-site": "cross-site" })).status).toBe(403);
      expect((await post(running, "note", note, { "content-type": "text/plain" })).status).toBe(415);
      expect((await post(running, "note", note, { host: "evil.example" })).status).toBe(403);
      // No Origin at all: a request that is not from a page.
      const bare = await fetch(`${running.url}/api/action/note`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-counterparts-token": running.token },
        body: JSON.stringify(note),
      });
      expect(bare.status).toBe(403);
      // A GET never acts; neither does another method on a looking path.
      expect((await fetch(`${running.url}/api/action/note?text=x`)).status).toBe(405);
      expect((await fetch(`${running.url}/api/memories`, { method: "DELETE" })).status).toBe(405);
      expect((await post(running, "note", "{not json")).status).toBe(400);
      expect((await post(running, "note", JSON.stringify([note]))).status).toBe(400);
      expect((await post(running, "note", { text: "x".repeat(70 * 1024) })).status).toBe(413);
      expect((await post(running, "install", {})).status).toBe(404);
      expect(diff(before, snapshot(f.dir))).toEqual([]);
    } finally {
      await running.stop();
    }
  });

  test("a note lands while the dashboard holds its read-only connection, and the views show it", async () => {
    const f = fixture();
    const running = await startDashboard({ dir: f.dir, port: 0, config: f.config });
    // A SECOND observer connection, held open across the write as well: the
    // one the running server holds is inside it; this one is in the test's hand.
    const held = Dashboard.open({ dir: f.dir });
    try {
      const rowsBefore = (await getJson(running, "/api/meta"))["rows"] as number;
      const r = await post(running, "note", { text: "The espresso machine in the kitchen is a Rancilio Silvia.", title: "espresso" });
      expect(r.status).toBe(200);
      expect(r.json["exit"]).toBe(0);
      const said = lines(r);
      expect(said).toContain(`Store: ${f.dir}`);
      const id = /Remembered (mem_[0-9a-f]+)/.exec(said)?.[1];
      expect(id).toBeDefined();
      expect(String(r.json["command"])).toStartWith("counterparts note --dir ");

      // The NEXT request on the long-lived observer source sees the commit.
      const detail = await getJson(running, `/api/memory?id=${id ?? ""}`);
      expect(detail["found"]).toBe(true);
      expect(String(detail["text"])).toContain("Rancilio Silvia");
      expect((await getJson(running, "/api/meta"))["rows"]).toBe(rowsBefore + 1);
      const memories = await getJson(running, "/api/memories");
      expect(JSON.stringify(memories)).toContain(id ?? "");
      // …and so does the connection held in the test's hand since before.
      const heldView = router(new URL(`http://127.0.0.1/api/memory?id=${id ?? ""}`), "127.0.0.1", held.source);
      expect((JSON.parse(heldView.body) as { found: boolean }).found).toBe(true);
    } finally {
      held.close();
      await running.stop();
    }
  });

  test("remove: the dry run changes nothing, a mistyped id is refused, the typed id removes it", async () => {
    const f = fixture();
    const running = await startDashboard({ dir: f.dir, port: 0, config: f.config });
    try {
      const noted = await post(running, "note", { text: "Postgres in dev listens on port 5433, not 5432." });
      const id = /Remembered (mem_[0-9a-f]+)/.exec(lines(noted))?.[1] ?? "";
      expect(id).toMatch(/^mem_/);

      const before = snapshot(f.dir);
      const plan = await post(running, "remove", { id });
      expect(plan.json["exit"]).toBe(0);
      expect(lines(plan)).toContain("Dry run. Nothing has changed.");
      expect(diff(before, snapshot(f.dir))).toEqual([]);

      const wrong = await post(running, "remove", { id, confirm: "mem_000000000000" });
      expect(wrong.status).toBe(200);
      expect(wrong.json["exit"]).toBe(2);
      expect(lines(wrong)).toContain("the confirmation did not match. Nothing has changed.");
      expect((await getJson(running, `/api/memory?id=${id}`))["found"]).toBe(true);

      const gone = await post(running, "remove", { id, confirm: id });
      expect(gone.json["exit"]).toBe(0);
      expect(String(gone.json["command"])).toContain("--confirm");
      // The open dashboard stops resolving it on the very next request.
      expect((await getJson(running, `/api/memory?id=${id}`))["found"]).toBe(false);
    } finally {
      await running.stop();
    }
  });

  test("backup, export, scope, rebrief, verify and ask say what the console says", async () => {
    const f = fixture();
    const running = await startDashboard({ dir: f.dir, port: 0, config: f.config });
    try {
      await post(running, "note", { text: "The rota for the allotment is kept on the shed door." });

      const backupTo = join(f.root, "backups");
      const backup = await post(running, "backup", { out: backupTo });
      expect(backup.json["exit"]).toBe(0);
      expect(lines(backup)).toContain(`Snapshot: ${backupTo}`);
      expect(readdirSync(backupTo).length).toBe(1);

      const exportTo = join(f.root, "export");
      const exported = await post(running, "export", { out: exportTo, plaintext: true });
      expect(exported.json["exit"]).toBe(0);
      expect(lines(exported)).toContain("Exported ");
      expect(existsSync(exportTo)).toBe(true);
      // A backup INTO the store is the console's refusal, said in its words.
      const inside = await post(running, "backup", { out: join(f.dir, "copy") });
      expect(inside.json["exit"]).not.toBe(0);

      // Real path: the registry holds canonical ones (macOS's /var → /private/var).
      const project = realpathSync(tempDir("counterparts-actions-project-"));
      const off = await post(running, "scope", { path: project, mode: "off", note: "not this one" });
      expect(off.json["exit"]).toBe(0);
      expect(lines(off)).toContain(`Scope set: ${project} — off.`);
      expect(existsSync(join(f.root, "scopes.json"))).toBe(true);
      const list = await post(running, "scope", { list: true });
      expect(lines(list)).toContain(project);

      const rebrief = await post(running, "rebrief", {});
      expect(rebrief.json["exit"]).toBe(0);
      expect(lines(rebrief)).toContain(`Re-rendered the wake bundle for ${f.dir}.`);

      const verify = await post(running, "verify", {});
      expect(verify.json["exit"]).toBe(0);

      const ask = await post(running, "ask", { question: "where is the allotment rota kept?" });
      expect(ask.json["exit"]).toBe(0);
      expect(lines(ask)).toContain("shed door");
    } finally {
      await running.stop();
    }
  });

  /**
   * ASKING IS LOOKING (owner, 2026-09-25). On a FRESH store — nothing noted
   * first, recall by meaning ON, so the meaning index is empty and the old
   * writable open backfilled every row's vector into box 3 — the canonical
   * boxes are byte-identical and the cache's every table is row-identical.
   * (The cache FILE is compared by content, not bytes: `openCache` rewrites
   * its schema row on every open, reader or not — INTERFACE-GAPS §1.)
   */
  test("ask on a fresh store changes nothing — canonical bytes and every cache row", async () => {
    const root = tempDir("counterparts-actions-ask-");
    const dir = join(root, "store");
    await seedDemo({ dir });
    const config = join(root, "claude-code.json");
    writeFileSync(config, JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000 }));
    const cacheRows = (): string => {
      const db = new Database(join(dir, "cache", "cache.sqlite"), { readonly: true });
      try {
        const tables = db.query("select name from sqlite_master where type='table' order by name").all() as {
          name: string;
        }[];
        return tables
          .map((t) => {
            const rows = db.query(`select * from "${t.name}"`).all();
            const text = JSON.stringify(rows, (_k, v: unknown) =>
              v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v,
            );
            return `${t.name} ${String(rows.length)} ${createHash("sha256").update(text).digest("hex")}`;
          })
          .join("\n");
      } finally {
        db.close();
      }
    };
    const beforeCanon = snapshot(dir);
    const beforeCache = cacheRows();
    expect(beforeCache).toContain("embeddings 0 ");
    const r = await runAction("ask", { question: "what is on the rota?" }, { dir, config });
    expect(r.status).toBe(200);
    expect(r.body.exit).toBe(0);
    expect((r.body.out ?? []).join("\n")).toContain("found");
    expect(diff(beforeCanon, snapshot(dir))).toEqual([]);
    expect(cacheRows()).toBe(beforeCache);
  }, 60_000);

  test("ask looks without changing the canonical store", async () => {
    const f = fixture();
    const running = await startDashboard({ dir: f.dir, port: 0, config: f.config });
    try {
      await post(running, "note", { text: "The boiler service is booked for the first Tuesday in March." });
      const before = snapshot(f.dir);
      const ask = await post(running, "ask", { question: "when is the boiler service?" });
      expect(ask.json["exit"]).toBe(0);
      expect(lines(ask)).toContain("boiler");
      expect(diff(before, snapshot(f.dir))).toEqual([]);
    } finally {
      await running.stop();
    }
  });
});

describe("one action at a time, and a timeout that says what it could not do", () => {
  test("two real actions sent in the same tick: one runs, the other is refused", async () => {
    // No `opts.run`: the real console, loaded lazily — the path where the slot
    // used to be claimed only after the import had been awaited.
    const f = fixture();
    const ctx = { dir: f.dir, config: f.config };
    const [a, b] = await Promise.all([
      runAction("note", { text: "The first of two notes sent together." }, ctx),
      runAction("note", { text: "The second of two notes sent together." }, ctx),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const said = [a, b].map((r) => (r.body.out ?? []).join("\n")).join("\n");
    expect(said.match(/Remembered mem_/g)?.length).toBe(1);
  });

  test("a note from the dashboard is filed under the store, not the server's working directory", async () => {
    const f = fixture();
    const r = await runAction("note", { text: "The shed key hangs behind the blue door." }, { dir: f.dir, config: f.config });
    const id = /Remembered (mem_[0-9a-f]+)/.exec((r.body.out ?? []).join("\n"))?.[1] ?? "";
    const store = Store.open({ dir: f.dir, observer: true });
    try {
      const origin = (store.readProse(id).meta as { origin?: { scope?: string } }).origin;
      expect(origin?.scope).toBe(f.dir);
      expect(origin?.scope).not.toBe(process.cwd());
    } finally {
      store.close();
    }
  });

  test("a second action while one runs is refused; a slow one reports that it is still running", async () => {
    let release: () => void = () => {};
    const slow: Run = () =>
      new Promise<number>((done) => {
        release = () => done(0);
      });
    const ctx = { dir: "/tmp/never-opened" };
    const first = runAction("verify", {}, ctx, { run: slow, timeoutMs: 20 });
    const second = await runAction("verify", {}, ctx, { run: slow });
    expect(second.status).toBe(409);
    const timedOut = await first;
    expect(timedOut.status).toBe(504);
    expect(String(timedOut.body.error)).toContain("still running");
    // Still held after the timeout: the command has not really finished.
    expect((await runAction("verify", {}, ctx, { run: slow })).status).toBe(409);
    release();
    await new Promise((r) => setTimeout(r, 5));
    const fast: Run = async (_argv, { io }) => {
      io.out("x".repeat(300 * 1024));
      io.out("after the cap");
      return 0;
    };
    const capped = await runAction("verify", {}, ctx, { run: fast });
    expect(capped.status).toBe(200);
    expect(capped.body.truncated).toBe(true);
    expect(capped.body.out).toEqual([]);
  });
});
