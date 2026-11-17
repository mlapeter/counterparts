/**
 * LP1: the sign-in pages' warm look and the fox (web.ts#WARM_STYLE, fox.ts).
 * The fox rides in the page's nonce'd script and draws on one canvas, so the
 * CSP stays exactly #762's and the page still loads nothing from anywhere;
 * every other page keeps the default look. Through the real app: /login and
 * an emailed link's error page.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { createApp } from "../src/app.js";
import { memoryMailer } from "../src/egress.js";
import { foxHtml } from "../src/fox.js";
import { listen, tempRoot } from "./helpers.js";

const CSP = (nonce: string): string =>
  `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;

const tmp = tempRoot("lp1");
const app = createApp({ dataRoot: join(tmp.root, "data"), publicOrigin: "http://127.0.0.1", mailer: memoryMailer(), embedder: null, spawner: () => ({ pid: 1 }) });
const served = listen(app.server);
after(async () => {
  await (await served).close();
  await app.close();
  tmp.remove();
});
const get = async (path: string): Promise<{ csp: string; html: string }> => {
  const res = await fetch(`${(await served).base}${path}`);
  return { csp: res.headers.get("content-security-policy") ?? "", html: await res.text() };
};

/** Run the fox's script against a stand-in canvas; returns what it drew: opaque pixels and a checksum per frame. */
function runFox(opts: { reduced: boolean; ticks: number }): { opaque: number; sum: number }[] {
  const script = /<script nonce="n">([\s\S]*)<\/script>/.exec(foxHtml("n"))![1]!;
  const drawn: { opaque: number; sum: number }[] = [];
  const timers: (() => void)[] = [];
  const ctx = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (d: { data: Uint8ClampedArray }) => {
      let opaque = 0;
      let sum = 0;
      for (let i = 0; i < d.data.length; i++) sum = (sum * 31 + d.data[i]!) % 1_000_000_007;
      for (let i = 3; i < d.data.length; i += 4) if (d.data[i] === 255) opaque++;
      drawn.push({ opaque, sum });
    },
  };
  const canvas = { getContext: () => ctx, addEventListener: () => undefined };
  const document = { getElementById: (id: string) => (id === "cp-fox" ? canvas : null) };
  const window = { matchMedia: () => ({ matches: opts.reduced }) };
  const setTimeout = (fn: () => void): number => timers.push(fn);
  new Function("document", "window", "setTimeout", "clearTimeout", script)(document, window, setTimeout, () => undefined);
  for (let i = 0; i < opts.ticks && timers.length > 0; i++) timers.shift()!();
  return drawn;
}

describe("the sign-in pages' look (LP1)", () => {
  test("/login: warm, one fox canvas, the CSP unchanged, nothing loaded from anywhere, every script nonce'd", async () => {
    const { csp, html } = await get("/login");
    const nonce = /style-src 'nonce-([^']+)'/.exec(csp)![1]!;
    assert.equal(csp, CSP(nonce));
    assert.match(html, /<body class="cp-warm">/);
    assert.deepEqual(html.match(/<style\b[^>]*>/g), [`<style nonce="${nonce}">`]);
    assert.equal(html.match(/<canvas\b/g)?.length, 1);
    assert.match(html, /<canvas class="cp-fox" id="cp-fox" width="76" height="81" role="img" aria-label="[^"]+">/);
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    assert.ok(scripts.length >= 2);
    for (const s of scripts) assert.equal(s, `<script nonce="${nonce}">`);
    for (const banned of [/<link\b/i, /<img\b/i, /\ssrc=/i, /\sstyle=/i, /url\(/i, /@import/i, /\son[a-z]+=/i]) assert.doesNotMatch(html, banned);
    // The one line of context, and SU1's words where they were.
    assert.match(html, /Counterparts for claude\.ai/);
    assert.match(html, /<h1>Sign in to Counterparts<\/h1>/);
    assert.match(html, /<button type="submit">Email me a link<\/button>/);
    assert.match(html, /<details><summary>Have an invite code\?<\/summary>/);
  });

  test("an emailed link's error page is warm too, without the fox; the CSP the same", async () => {
    const { csp, html } = await get("/login/link?token=aaaaaaaaaaaaaaaaaaaaaaaa");
    const nonce = /style-src 'nonce-([^']+)'/.exec(csp)![1]!;
    assert.equal(csp, CSP(nonce));
    assert.match(html, /<body class="cp-warm">/);
    assert.match(html, /<h1>That link can&#39;t be used<\/h1>/);
    assert.doesNotMatch(html, /<canvas/);
  });

  test("other pages keep the default look", async () => {
    // An account page's refusal (a sign-out with no form) is #762's look still.
    const res = await fetch(`${(await served).base}/logout`, { method: "POST" });
    const html = await res.text();
    assert.match(html, /<h1>Start again<\/h1>/);
    assert.match(html, /<body>/);
    assert.doesNotMatch(html, /cp-warm|cp-fox/);
  });

  test("the fox draws idle at once; reduced motion stops there", () => {
    const still = runFox({ reduced: true, ticks: 100 });
    assert.equal(still.length, 1);
    assert.ok(still[0]!.opaque > 2500, `idle has its pixels (${String(still[0]!.opaque)})`);
  });

  test("moving, it goes through its frames, each a whole fox", () => {
    const drawn = runFox({ reduced: false, ticks: 200 });
    assert.ok(drawn.length > 20);
    for (const { opaque } of drawn) assert.ok(opaque > 2500 && opaque < 76 * 81, `a whole frame (${String(opaque)} opaque pixels)`);
    assert.ok(new Set(drawn.map((d) => d.sum)).size === 10, "the story's ten frames, each its own (the wave's two come on a point or a tap)");
  });
});
