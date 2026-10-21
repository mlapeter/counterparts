/**
 * The self map, round 4 (2026-09-28): readable at a glance by someone who
 * knows roughly what this is and none of the details. It answers one
 * question — what is becoming part of who I am? — so:
 *
 *   1. the three rings are named on the map itself ("who I am", "almost
 *      there", "about me and us") and the legend is gone; one caption;
 *   2. only the core and the almost-there memories carry a name (a short
 *      title cut at a whole word); names never overlap each other, a dot or
 *      a ring's name, never leave the box, and where room runs out the rest
 *      are counted ("+N more"), the core named first;
 *   3. links are hidden until a dot is hovered, focused or tapped;
 *   4. Home: "Today" on the left, the brain on the right.
 *
 * Pure: synthetic maps, no store; the page sources are read from disk.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error — a plain browser module, no declarations
import * as M from "../src/adapters/dashboard/web/pages/self/sections/map.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const read = (p: string): string => readFileSync(join(WEB, p), "utf8");

type Node = { id: string; text: string; strength: number; core: boolean; ready: boolean; oneReturnAway: boolean; closeness: number };
type Link = { a: string; b: string; weight: number };
type Box = { x0: number; x1: number; y0: number; y1: number };
type P = { x: number; y: number };
type Layout = { pos: Map<string, P>; cx: number; cy: number; R: number; rc: number; rA: number; rO: number; rings: { key: string; text: string; box: Box }[] };
type Label = { id: string; text: string; lines: string[]; box: Box; lead: { x1: number; y1: number; x2: number; y2: number } | null };

const WORDS = ["I", "keep", "a", "running", "list", "of", "what", "we", "treat", "as", "known", "and", "never", "checked", "before", "the", "next", "meeting"];
const sentence = (i: number): string => {
  const n = 6 + (i % 9);
  const out: string[] = [];
  for (let k = 0; k < n; k++) out.push(WORDS[(i * 7 + k * 3) % WORDS.length] as string);
  return out.join(" ") + ".";
};

/** A crowded map like the owner's: several core, several almost there, forty more, linked. */
function crowd(core = 7, ready = 5, one = 12, others = 40): { nodes: Node[]; links: Link[]; total: number; more: number } {
  const nodes: Node[] = [];
  const mk = (id: string, i: number, extra: Partial<Node>): Node =>
    ({ id, text: sentence(i), strength: 0.4 + (i % 6) / 10, core: false, ready: false, oneReturnAway: false, closeness: 0, ...extra });
  let i = 0;
  for (let k = 0; k < core; k++) nodes.push(mk(`mem_core${k}`, i++, { core: true, closeness: 2 }));
  for (let k = 0; k < ready; k++) nodes.push(mk(`mem_ready${k}`, i++, { ready: true, closeness: 2 }));
  for (let k = 0; k < one; k++) nodes.push(mk(`mem_one${k}`, i++, { oneReturnAway: true, closeness: 1 + (k % 4) / 5 }));
  for (let k = 0; k < others; k++) nodes.push(mk(`mem_o${k}`, i++, { closeness: (k % 10) / 6 }));
  const links: Link[] = [];
  for (let k = 0; k < nodes.length; k++) {
    const j = (k * 7 + 3) % nodes.length;
    if (j !== k) links.push({ a: (nodes[k] as Node).id, b: (nodes[j] as Node).id, weight: 0.2 + (k % 5) * 0.15 });
  }
  return { nodes, links, total: nodes.length, more: 0 };
}

const meet = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const circleMeets = (p: P, r: number, b: Box): boolean => {
  const dx = p.x - Math.max(b.x0, Math.min(p.x, b.x1)), dy = p.y - Math.max(b.y0, Math.min(p.y, b.y1));
  return dx * dx + dy * dy < r * r;
};
const isNear = (n: Node): boolean => !n.core && (n.ready || n.oneReturnAway);

const WIDTHS = [300, 358, 480, 650, 1000];

describe("1. the rings are named on the map; no legend; one caption", () => {
  test("the three names, where the rings are, clear of every dot", () => {
    expect(M.RING_WORDS).toEqual({ core: "who I am", near: "almost there", about: "about me and us" });
    for (const w of WIDTHS) {
      const map = crowd();
      const h = M.heightFor(w) as number;
      const L = M.layout(map, w, h) as Layout;
      expect(L.rings.map((r) => r.text)).toEqual(["who I am", "almost there", "about me and us"]);
      for (const r of L.rings) {
        for (const n of map.nodes) expect(`${w} ${r.text} × ${n.id}: ${circleMeets(L.pos.get(n.id) as P, M.markRadius(n) + 1, r.box)}`).toBe(`${w} ${r.text} × ${n.id}: false`);
        expect(r.box.x0).toBeGreaterThanOrEqual(0);
        expect(r.box.x1).toBeLessThanOrEqual(w);
        expect(r.box.y0).toBeGreaterThanOrEqual(0);
      }
      // The names do not meet each other either.
      for (let i = 0; i < L.rings.length; i++) for (let j = i + 1; j < L.rings.length; j++) expect(meet(L.rings[i]!.box, L.rings[j]!.box)).toBe(false);
      // And the zones they name are true: the core inside its disc, the
      // almost-there dots on their ring, every other dot outside it.
      const d = (id: string): number => Math.hypot((L.pos.get(id) as P).x - L.cx, (L.pos.get(id) as P).y - L.cy);
      for (const n of map.nodes) {
        if (n.core) expect(d(n.id)).toBeLessThan(L.rc);
        else if (isNear(n)) expect(d(n.id)).toBeCloseTo(L.rA, 5);
        else {
          expect(d(n.id)).toBeGreaterThanOrEqual(L.rO - 1e-6);
          expect(d(n.id)).toBeLessThanOrEqual(L.R + 1e-6);
        }
      }
    }
  });

  test("the markup: the ring names drawn, the legend gone, the one caption", () => {
    const { html } = M.markup(crowd(), 650, {}) as { html: string };
    for (const k of ["core", "near", "about"]) expect(html).toContain(`sm-ring-w-${k}`);
    expect(html).toContain(">who I am</text>");
    expect(html).toContain(">almost there</text>");
    expect(html).toContain(">about me and us</text>");
    expect(html).not.toContain("sm-legend");
    expect(html).not.toContain("nearer the middle");
    expect(html).not.toContain("brighter =");
    expect(M.CAPTION).toBe("Memories about me and us. The closer to the middle, the closer to being part of who I am.");
    expect(html.split(M.CAPTION).length - 1).toBe(1);
    expect(read("pages/self/self.css")).not.toContain(".sm-legend");
    expect(read("pages/self/sections/map.js")).not.toContain("sm-legend");
  });

  test("the Self tab keeps its line of counts; Home leaves it out", () => {
    const map = crowd(2, 1, 1, 5);
    expect((M.markup(map, 650, {}) as { html: string }).html).toContain('class="sm-count"');
    expect((M.markup(map, 650, { count: false }) as { html: string }).html).not.toContain('class="sm-count"');
    expect(read("pages/home/sections/map.js")).toContain("{ count: false }");
  });
});

describe("2. only what matters is named, and names never overlap", () => {
  test("a short title: the first sentence, cut at a whole word, not left on a small word", () => {
    expect(M.shortTitle("We finish one thing properly before starting the next.")).toBe("We finish one thing properly…");
    expect(M.shortTitle("I say plainly when I do not know something, before I guess at it.")).toBe("I say plainly when I do not…");
    expect(M.shortTitle("Short and whole.")).toBe("Short and whole");
    expect(M.shortTitle("I keep a running list of what I am treating as known.")).toBe("I keep a running list…");
    for (let i = 0; i < 40; i++) {
      const t = M.shortTitle(sentence(i)) as string;
      expect(t.replace(/…$/, "").length).toBeLessThanOrEqual(28);
      // Cut at a whole word: what is left is a prefix of the sentence, ending where a word ends.
      const bare = t.replace(/…$/, "");
      expect(sentence(i).startsWith(bare)).toBe(true);
      expect(/[\s.]/.test(sentence(i)[bare.length] ?? " ")).toBe(true);
    }
    expect(M.wrapTitle("I would rather ask a second…", 15)).toEqual(["I would rather", "ask a second…"]);
  });

  test("names only on the core and the almost-there dots; the others unnamed and fainter", () => {
    const map = crowd(3, 2, 2, 12);
    const { html, labels, hidden } = M.markup(map, 650, {}) as { html: string; labels: Label[]; hidden: string[] };
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    for (const l of labels) {
      const n = byId.get(l.id) as Node;
      expect(n.core || isNear(n)).toBe(true);
    }
    // With room to spare, every one of them is named.
    expect(hidden).toEqual([]);
    expect(labels.length).toBe(7);
    expect(html).not.toContain("sm-more");
    // In the markup: a named group is core or near; a plain one has no label and is dimmer.
    const groups = html.split('<g class="sm-node ').slice(1);
    expect(groups.length).toBe(map.nodes.length);
    for (const g of groups) {
      const plain = g.startsWith("plain");
      expect(`${plain} ${g.includes("sm-label")}`).toBe(`${plain} ${!plain}`);
    }
    const op = (id: string): number => Number(new RegExp(`data-id="${id}"[^]*?fill-opacity:([0-9.]+)`).exec(html)?.[1]);
    const same = map.nodes.find((n) => !n.core && !isNear(n) && n.strength === (map.nodes[0] as Node).strength) as Node;
    expect(op(same.id)).toBeLessThan(op((map.nodes[0] as Node).id));
  });

  test("no name overlaps another, a dot or a ring's name, or leaves the box — at every width", () => {
    for (const w of WIDTHS) {
      for (const map of [crowd(), crowd(1, 0, 3, 20), crowd(12, 8, 8, 30), crowd(0, 2, 0, 6)]) {
        const h = M.heightFor(w) as number;
        const L = M.layout(map, w, h) as Layout;
        const { labels, hidden } = M.placeLabels(map, L, w, h) as { labels: Label[]; hidden: string[] };
        for (const l of labels) {
          expect(l.box.x0).toBeGreaterThanOrEqual(0);
          expect(l.box.x1).toBeLessThanOrEqual(w);
          expect(l.box.y0).toBeGreaterThanOrEqual(0);
          expect(l.box.y1).toBeLessThanOrEqual(h);
          for (const r of L.rings) expect(meet(l.box, r.box)).toBe(false);
          for (const n of map.nodes) expect(`${w} ${l.id} × ${n.id}: ${circleMeets(L.pos.get(n.id) as P, M.markRadius(n), l.box)}`).toBe(`${w} ${l.id} × ${n.id}: false`);
        }
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) expect(`${w} ${labels[i]!.id} × ${labels[j]!.id}: ${meet(labels[i]!.box, labels[j]!.box)}`).toBe(`${w} ${labels[i]!.id} × ${labels[j]!.id}: false`);
        }
        // Every one that matters is either named or counted.
        const want = map.nodes.filter((n) => n.core || isNear(n)).length;
        expect(labels.length + hidden.length).toBe(want);
      }
    }
  });

  test("where room runs out: '+N more', never an overlap; the core named first", () => {
    const map = crowd(7, 5, 12, 40);
    const phone = M.markup(map, 300, {}) as { html: string; labels: Label[]; hidden: string[] };
    expect(phone.hidden.length).toBeGreaterThan(0);
    expect(phone.html).toContain(`+${phone.hidden.length} more not named here, for room.`);
    // The order names are tried in: the core (firmest first), then ready, then one return away.
    const order = (M.labelOrder(map) as Node[]).map((n) => n.id);
    expect(order.slice(0, 7).every((id) => id.startsWith("mem_core"))).toBe(true);
    expect(order.slice(7, 12).every((id) => id.startsWith("mem_ready"))).toBe(true);
    // On a desktop-sized box, all of the core is named.
    const wide = M.markup(map, 650, {}) as { labels: Label[] };
    const named = new Set(wide.labels.map((l) => l.id));
    for (let k = 0; k < 7; k++) expect(named.has(`mem_core${k}`)).toBe(true);
  });

  test("the same data draws the same picture", () => {
    for (const w of [358, 650]) expect((M.markup(crowd(), w, {}) as { html: string }).html).toBe((M.markup(crowd(), w, {}) as { html: string }).html);
  });

  test("the hover words use the rings' names", () => {
    expect(M.nodeWords({ core: true, strength: 0.5 })).toBe("who I am · held 50%");
    expect(M.nodeWords({ ready: true, strength: 0.5 })).toBe("almost there: it joins who I am at the next check · held 50%");
    expect(M.nodeWords({ oneReturnAway: true, strength: 0.72 })).toBe("almost there: one more return and it can join · held 72%");
    expect(M.nodeWords({ strength: 0.1 })).toBe("about me and us · held 10%");
  });
});

describe("3. links hidden until a dot is hovered, focused or tapped", () => {
  test("drawn invisible, shown only for the lit dot, its linked dots lit too", () => {
    const { html } = M.markup(crowd(), 650, {}) as { html: string };
    const lines = html.match(/<line class="sm-link"[^>]*>/g) ?? [];
    expect(lines.length).toBeGreaterThan(0);
    // No inline opacity to beat the stylesheet.
    for (const l of lines) expect(l).not.toContain("style=");
    const css = read("pages/self/self.css");
    expect(css).toMatch(/\.sm-link\{[^}]*stroke-opacity:0[;}]/);
    expect(css).toMatch(/\.sm-link\.on\{stroke-opacity:\.85\}/);
    expect(css).toContain(".sm-svg.focus .sm-node:not(.on):not(.linked)");
    const js = read("pages/self/sections/map.js");
    for (const s of ['addEventListener("mouseenter"', 'addEventListener("focus"', 'addEventListener("blur"', 'addEventListener("pointerdown"',
      'ln.classList.toggle("on"', 'g.classList.toggle("linked"', 'window.openMemory(n.id)', 'e.key === "Enter"']) expect(js).toContain(s);
    // Every dot is reachable from the keyboard.
    const groups = html.match(/<g class="sm-node[^>]*>/g) ?? [];
    for (const g of groups) expect(g).toContain('tabindex="0"');
  });
});

describe("4. Home: Today on the left, the brain on the right", () => {
  test("Today comes first in the row (and so first on a phone); the brain's column is the wider", () => {
    const home = read("pages/home/index.js");
    expect(home.indexOf("${today.markup}")).toBeGreaterThan(0);
    expect(home.indexOf("${today.markup}")).toBeLessThan(home.indexOf("${brain.markup}"));
    // Headline, Today, brain, radar, map.
    const order = ["${hero.markup}", "${today.markup}", "${brain.markup}", "${feel.markup}", "${map.markup}"].map((m) => home.indexOf(m));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const css = read("pages/home/home.css");
    expect(css).toContain(".home-row-a{grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);");
    expect(css).toMatch(/@media\(max-width:900px\)\{\s*\.home-row-a,\.home-row-b\{grid-template-columns:1fr\}/);
  });
});
