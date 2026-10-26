/**
 * Shared test helpers for the hosted package. Every test makes its own temp
 * root and removes it (CLAUDE.md: tests are hermetic); nothing here names a
 * real store or a home directory. Written for `node:test` so the same files
 * run under Node (production's runtime) and under `bun test`.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// THE GUARD, armed here: Node has no test/preload.ts.
process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";

export function tempRoot(label: string): { root: string; remove: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `counterparts-hosted-${label}-`)));
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

export async function listen(server: Server): Promise<{ base: string; close: () => Promise<void> }> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections?.();
      }),
  };
}

let nextId = 1;

export interface RpcAnswer {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

/** One JSON-RPC POST, as a real client sends it. */
export async function rpc(url: string, method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}): Promise<RpcAnswer> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    body = { text };
  }
  return { status: res.status, body, headers: res.headers };
}

/** A tool call's structured result (throws when the call was not a 200 result). */
export async function tool(url: string, name: string, args: Record<string, unknown>, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const out = await rpc(url, "tools/call", { name, arguments: args }, headers);
  if (out.status !== 200) throw new Error(`tools/call ${name}: HTTP ${String(out.status)}`);
  const result = out.body["result"] as Record<string, unknown> | undefined;
  if (result === undefined) throw new Error(`tools/call ${name}: ${JSON.stringify(out.body)}`);
  return result["structuredContent"] as Record<string, unknown>;
}

/** A fresh store id (the accounts table's shape). */
export function storeId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
