/* The few plain counts under the home page's headline (`/api/overview`'s
   `hero.counts`). Drawn with the tile classes, so the page reads its numbers
   the way it always did. Each is a link to where that number is shown in full
   (a hash route: `shell/tabs.js#parseRoute`). */
import { $, esc } from "../../../shared/dom.js";

const GOES_TO = {
  "memories held": "memories?state=live",
  "core memories": "self/settling",
  "chapters written": "self/journal",
  "archived": "memories?state=archived",
};

export const markup = `<div class="tiles home-counts" id="ov-tiles"></div>`;

export function paint(d) {
  $("ov-tiles").innerHTML = d.hero.counts.map((t) => {
    const to = GOES_TO[t.label];
    const open = to ? '<a class="tile tile-link' + (t.absent ? " quiet" : "") + '" href="#' + esc(to) + '">'
      : '<div class="tile' + (t.absent ? " quiet" : "") + '">';
    return open +
      '<div class="n">' + esc(t.value) + "</div>" +
      '<div class="l">' + esc(t.label) + "</div>" +
      '<div class="s">' + esc(t.note) + "</div>" + (to ? "</a>" : "</div>");
  }).join("");
}

/** A link changes the hash and the nav follows it (`shell/tabs.js`). A second
 *  click on the same card changes nothing, so it re-announces the hash itself. */
export function mount() {
  $("ov-tiles").addEventListener("click", (e) => {
    const a = e.target.closest("a.tile-link");
    if (!a || location.hash !== a.getAttribute("href")) return;
    e.preventDefault();
    dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

/** One home count's number, READ OFF THE PAGE rather than out of a variable:
 *  the flow diagram's counters were proved live while the tiles beside them
 *  were not, and a harness that asked the payload would have believed a page
 *  that never repainted. (`tools/visual-loop` calls this.) */
window.tileValue = (label) => {
  for (const tile of document.querySelectorAll("#ov-tiles .tile")) {
    const l = tile.querySelector(".l");
    if (l && l.textContent === label) {
      const n = tile.querySelector(".n");
      return n ? n.textContent : "";
    }
  }
  return "";
};
