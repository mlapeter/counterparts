/**
 * `web.ts#clientIp`: which X-Forwarded-For entry is the client, for a given
 * number of trusted proxy hops (TRUST_PROXY). Railway's first deploy showed two.
 * And the forms' CSRF key from the current cookie key (`keys.ts#csrfKey`, H1).
 */
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, test } from "node:test";

import { csrfKey } from "../src/keys.js";
import { Csrf, clientIp, page } from "../src/web.js";

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

describe("the page frame's style (gate S: the site's look, under the same CSP)", () => {
  const render = (opts: { nonce?: string } = {}): { headers: Record<string, string>; html: string } => {
    let headers: Record<string, string> = {};
    let html = "";
    const res = {
      writeHead: (_status: number, h: Record<string, string>) => {
        headers = h;
      },
      end: (b: string) => {
        html = b;
      },
    } as unknown as ServerResponse;
    page(res, 200, { title: "T", body: "<h1>T</h1><p>words</p>", ...opts });
    return { headers, html };
  };

  test("exactly one <style>, carrying the nonce the CSP names, and the CSP is unchanged", () => {
    const { headers, html } = render({ nonce: "abc123" });
    const csp = headers["Content-Security-Policy"]!;
    assert.equal(csp, "default-src 'none'; style-src 'nonce-abc123'; script-src 'nonce-abc123'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const styles = html.match(/<style\b[^>]*>/g) ?? [];
    assert.deepEqual(styles, ['<style nonce="abc123">']);
    const fresh = render();
    const nonce = /style-src 'nonce-([^']+)'/.exec(fresh.headers["Content-Security-Policy"]!)![1]!;
    assert.ok(fresh.html.includes(`<style nonce="${nonce}">`));
  });

  test("the frame loads nothing from anywhere: no link, image, src, style attribute, url() or @import", () => {
    const { html } = render();
    for (const banned of [/<link\b/i, /<img\b/i, /\ssrc=/i, /\sstyle=/i, /url\(/i, /@import/i, /https?:\/\//i, /\/\/[a-z0-9.-]+\.[a-z]{2,}/i]) {
      assert.doesNotMatch(html, banned);
    }
  });

  test("dark mode follows the browser, and the wordmark is text", () => {
    const { html } = render();
    assert.match(html, /@media \(prefers-color-scheme:dark\)/);
    assert.match(html, /<span class="cp-mark">Counterparts<\/span>/);
    assert.match(html, /<main class="cp-main">\n<h1>T<\/h1>/);
  });
});
