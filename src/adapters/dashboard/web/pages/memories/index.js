/* The memories tab: find (search + ask), the page's buttons (note, back up,
   export), one picture of everything held, the kinds in words, and every
   memory as a paged list. `/api/memories` feeds the picture and the kinds;
   the list fetches its own page (`/api/memories/list`). */
import { api, fail } from "../../shared/api.js";
import * as constellation from "./sections/constellation.js";
import * as kinds from "./sections/kinds.js";
import * as list from "./sections/list.js";
import * as search from "./sections/search.js";
import * as tools from "./sections/tools.js";

const markup = `
    <div class="mem-top">
      <p class="mem-lede" id="mem-lede">Everything I remember, and why it is where it is.</p>${tools.markup}
    </div>${tools.notePanel}${search.markup}
    ${constellation.markup}
    ${kinds.markup}
    ${list.markup}
  `;

let MEM = null;

async function render() {
  let d;
  try { d = await api("/api/memories"); } catch (e) { return fail("The memories page", e); }
  MEM = d;
  document.getElementById("mem-lede").textContent = lede(d);
  constellation.paint(d);
  kinds.paint(d);
  constellation.draw();
  await list.render();
}

/** "121 memories and 24 entities and beliefs" — the census counts both, and
 *  `counterparts status` prints them apart, so this page does too. */
function heldWords(d) {
  const m = d.memories + (d.memories === 1 ? " memory" : " memories");
  return d.schemas ? m + " and " + d.schemas + (d.schemas === 1 ? " entity or belief" : " entities and beliefs") : m;
}

function lede(d) {
  if (d.total === 0) return "Nothing held yet. Write a note, or just talk — what matters settles here.";
  if (d.total < 20) return "A young memory: " + heldWords(d) + " so far. Every one is below, with its words; it fills in as we talk.";
  return heldWords(d) + ". Search by words, ask a question, or browse every one below, newest first.";
}

export default {
  name: "memories",
  mount(section) {
    section.innerHTML = markup;
    constellation.mount();
    kinds.mount();
    list.mount();
    search.mount();
    tools.mount();
    // A note or a removal made on purpose: re-read now rather than on the next poll.
    addEventListener("counterparts:changed", () => { render(); });
  },
  render,
  /** The store moved (the pulse): re-read everything this page shows. */
  refresh: render,
  /** Coming back to the tab: the canvas may have been laid out at zero width. */
  show() { constellation.draw(); },
  resize() { if (MEM) constellation.draw(); },
  /** After boot, when this is the tab showing. */
  redraw() { constellation.draw(); },
};
