/* The memories tab: search, the constellation, the histogram, bands, kinds,
   hubs. One fetch (`/api/memories`). */
import { api, fail } from "../../shared/api.js";
import * as bands from "./sections/bands.js";
import * as constellation from "./sections/constellation.js";
import * as histogram from "./sections/histogram.js";
import * as hubs from "./sections/hubs.js";
import * as kinds from "./sections/kinds.js";
import * as manage from "./sections/manage.js";
import * as search from "./sections/search.js";

const markup = `${search.markup}${manage.markup}
    <div class="cols-wide">
      <div>${constellation.markup}${histogram.markup}
      </div>
      <div>${bands.markup}${kinds.markup}
        <!-- GRAPH HUBS lives here, under the kinds table, and not under the
             histogram in the left column: the left column was two charts and
             this list while the right was two short panels, so a reader at
             mid-scroll had roughly 850×750 of empty column beside the graph
             (design review, 2026-09-04, ranked #6). The list is the tallest
             thing that can move, so it is the one that moves. -->${hubs.markup}
      </div>
    </div>
  `;

let MEM = null;

async function render() {
  let d;
  try { d = await api("/api/memories"); } catch (e) { return fail("The memories page", e); }
  MEM = d;
  constellation.paint(d);
  histogram.paint(d);
  bands.paint(d);
  kinds.paint(d);
  hubs.paint(d);
  constellation.draw();
  histogram.draw();
}

export default {
  name: "memories",
  mount(section) {
    section.innerHTML = markup;
    constellation.mount();
    search.mount();
    manage.mount();
  },
  render,
  /** Coming back to the tab: the canvas may have been laid out at zero width. */
  show() { constellation.draw(); },
  resize() { if (MEM) { constellation.draw(); histogram.draw(); } },
  /** After boot, when this is the tab showing. */
  redraw() { constellation.draw(); histogram.draw(); },
};
