/**
 * `web.ts#clientIp`: which X-Forwarded-For entry is the client, for a given
 * number of trusted proxy hops (TRUST_PROXY). Railway's first deploy showed two.
 * And the forms' CSRF key from the current cookie key (`keys.ts#csrfKey`, H1).
 */
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { describe, test } from "node:test";

import { csrfKey } from "../src/keys.js";
import { Csrf, clientIp } from "../src/web.js";

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

describe("the CSRF key from COOKIE_KEYS (H1: a restart keeps the forms)", () => {
  const derived = (k: string): Csrf => new Csrf(csrfKey(k));
  const A = "a".repeat(32);
  const B = "b".repeat(32);
  test("the same cookie key gives the same token for a browser; another key, another token", () => {
    assert.equal(derived(A).token("browser-1"), derived(A).token("browser-1"));
    assert.ok(derived(A).check("browser-1", derived(A).token("browser-1")));
    assert.notEqual(derived(A).token("browser-1"), derived(B).token("browser-1"));
    assert.equal(derived(B).check("browser-1", derived(A).token("browser-1")), false);
  });
  test("still bound to the browser, and never the cookie key itself", () => {
    assert.notEqual(derived(A).token("browser-1"), derived(A).token("browser-2"));
    assert.equal(derived(A).check("browser-2", derived(A).token("browser-1")), false);
    // HKDF, not the key used as the HMAC key directly: a plain HMAC under A says something else.
    assert.notEqual(derived(A).token("browser-1"), new Csrf(Buffer.from(A, "utf8")).token("browser-1"));
  });
  test("no key: random per instance, as before", () => {
    assert.notEqual(new Csrf().token("browser-1"), new Csrf().token("browser-1"));
  });
});
