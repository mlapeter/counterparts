/**
 * DIR1 (2026-11-10): the hosted connector, as the directory's reviewers and its clients meet it.
 * Through the real hosted door (`createApp` on a free port, real OAuth, real `/mcp`):
 *
 *   - Claude Code signs in with its own Client ID Metadata Document: `localhost` and `127.0.0.1` on any
 *     port come back (RFC 8252 §7.3), through the token and a `tools/list`; another path, another host
 *     or an https look-alike still needs an exact match.
 *
 * Hermetic: a temp data root per test, removed after; an in-memory mailer; a CIMD fetch serving fixture
 * documents (Claude Code's is its real one, copied); a stub spawner. No network, no live store.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import * as oauth from "oauth4webapi";

import { rpc, tempRoot } from "./helpers.js";
import { CLAUDE_CODE_CIMD, CLAUDE_CODE_CIMD_URL, bearer, connect, insecure, rig } from "./oauth-rig.js";
import type { Rig } from "./oauth-rig.js";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];

beforeEach(() => {
  tmp = tempRoot("dir1");
});
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* closed */
    }
  }
  tmp.remove();
});

async function open(): Promise<Rig> {
  const r = await rig(tmp.root);
  closers.push(() => r.close());
  return r;
}

/** Where `/oauth/authorize` sends a client with this redirect: the Allow page (accepted), or an error. */
async function authorizeAnswer(r: Rig, clientId: string, redirectUri: string): Promise<{ status: number; location: string | null; body: string }> {
  const as = await oauth.processDiscoveryResponse(new URL(r.origin), await oauth.discoveryRequest(new URL(r.origin), { algorithm: "oauth2", ...insecure }));
  const u = new URL(as.authorization_endpoint!);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "memory",
    resource: `${r.origin}/mcp`,
    code_challenge: await oauth.calculatePKCECodeChallenge(oauth.generateRandomCodeVerifier()),
    code_challenge_method: "S256",
    state: "s",
  }).toString();
  const res = await fetch(u, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), body: await res.text() };
}

describe("Claude Code signs in to hosted with its own CIMD document (item 5)", () => {
  for (const host of ["localhost", "127.0.0.1"]) {
    test(`a loopback return on an arbitrary port (${host}:3118) goes through the Allow page, the token and tools/list`, async () => {
      const r = await open();
      r.cimd.set(CLAUDE_CODE_CIMD_URL, CLAUDE_CODE_CIMD);
      const { code } = r.app.accounts.createInvite();
      const c = await connect(r, { clientId: CLAUDE_CODE_CIMD_URL, redirectUri: `http://${host}:3118/callback`, email: `cc-${host}@example.com`, invite: code });
      const list = await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access));
      assert.equal(list.status, 200);
      const names = ((list.body["result"] as { tools: { name: string }[] }).tools).map((t) => t.name);
      assert.ok(names.includes("wake") && names.includes("delete_memory"), names.join(","));
    });
  }

  test("any other port is accepted too (localhost:61999): the authorization goes on to the Allow page", async () => {
    const r = await open();
    r.cimd.set(CLAUDE_CODE_CIMD_URL, CLAUDE_CODE_CIMD);
    const answer = await authorizeAnswer(r, CLAUDE_CODE_CIMD_URL, "http://localhost:61999/callback");
    assert.equal(answer.status, 303, answer.body);
    assert.match(String(answer.location), /\/oauth\/allow\//);
  });

  test("still refused: another path, a look-alike host, a non-loopback http host, and https that isn't listed", async () => {
    const r = await open();
    r.cimd.set(CLAUDE_CODE_CIMD_URL, CLAUDE_CODE_CIMD);
    for (const bad of ["http://localhost:3118/other", "http://localhost.evil.example:3118/callback", "http://192.168.1.5:3118/callback", "https://localhost/callback", "http://127.0.0.2:3118/callback"]) {
      const answer = await authorizeAnswer(r, CLAUDE_CODE_CIMD_URL, bad);
      assert.notEqual(answer.status, 303, `${bad} was accepted`);
      assert.match(answer.body, /redirect_uri/i, bad);
    }
  });

  test("an https client still needs its exact redirect: claude.ai's callback with a port or path changed is refused", async () => {
    const r = await open();
    const id = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    r.cimd.set(id, { client_id: id, redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    assert.equal((await authorizeAnswer(r, id, "https://claude.ai/api/mcp/auth_callback")).status, 303);
    for (const bad of ["https://claude.ai:8443/api/mcp/auth_callback", "https://claude.ai/api/mcp/other"]) {
      assert.notEqual((await authorizeAnswer(r, id, bad)).status, 303, bad);
    }
  });
});
