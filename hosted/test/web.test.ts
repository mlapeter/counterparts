/**
 * `web.ts#clientIp`: which X-Forwarded-For entry is the client, for a given
 * number of trusted proxy hops (TRUST_PROXY). Railway's first deploy showed two.
 */
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { describe, test } from "node:test";

import { clientIp } from "../src/web.js";

const SOCKET = "10.0.0.9";
const req = (xff?: string | string[]): IncomingMessage =>
  ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: SOCKET } }) as unknown as IncomingMessage;

describe("clientIp", () => {
  test("hops 0 never reads the header", () => {
    assert.equal(clientIp(req("198.51.100.1, 203.0.113.7"), 0), SOCKET);
  });

  test("one hop: the last entry, the one the proxy appended", () => {
    assert.equal(clientIp(req("198.51.100.1, 203.0.113.7"), 1), "203.0.113.7");
    assert.equal(clientIp(req("203.0.113.7"), 1), "203.0.113.7");
  });

  test("two hops: the second-to-last entry (Railway: the client, then its edge)", () => {
    assert.equal(clientIp(req("198.51.100.1, 203.0.113.7"), 2), "198.51.100.1");
  });

  test("two hops: a prefix the client wrote itself is never the address", () => {
    assert.equal(clientIp(req("evil, real, edge"), 2), "real");
    assert.equal(clientIp(req(["evil", "real, edge"]), 2), "real");
  });

  test("a header shorter than the hops, or none, is the socket address", () => {
    assert.equal(clientIp(req("203.0.113.7"), 2), SOCKET);
    assert.equal(clientIp(req(), 2), SOCKET);
    assert.equal(clientIp(req(""), 1), SOCKET);
  });

  test("an empty or overlong entry is the socket address", () => {
    assert.equal(clientIp(req(" , 203.0.113.7"), 2), SOCKET);
    assert.equal(clientIp(req(`${"a".repeat(64)}, 203.0.113.7`), 2), SOCKET);
  });
});
