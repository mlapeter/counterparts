/* The home tab (was "overview"): the page the dashboard opens on. One fetch
   (`/api/overview`), painted section by section. */
import { api, fail } from "../../shared/api.js";
import { $ } from "../../shared/dom.js";
import * as bands from "./sections/bands.js";
import * as contested from "./sections/contested.js";
import * as identity from "./sections/identity.js";
import * as liveActivity from "./sections/live-activity.js";
import * as mechanisms from "./sections/mechanisms.js";
import * as protectedInk from "./sections/protected.js";
import * as recentChapters from "./sections/recent-chapters.js";
import * as tiles from "./sections/tiles.js";

const markup = `
    ${mechanisms.markup}
    <p class="lede" id="ov-opening"></p>
    ${tiles.markup}
    <div class="cols" style="margin-top:22px">
      <div>${bands.markup}${liveActivity.markup}${recentChapters.markup}
      </div>
      <div>${identity.markup}${protectedInk.markup}${contested.markup}
      </div>
    </div>
  `;

async function render() {
  await Promise.all([mechanisms.render(), (async () => {
    let d;
    try { d = await api("/api/overview"); } catch (e) { return fail("The home page", e); }
    paintHome(d, true);
  })()]);
}

/**
 * Draw the overview from a payload. Called once at boot with the feed, and
 * again from the poll WITHOUT it whenever the store moved.
 *
 * The feed is the one panel the poll owns: it prepends flashed rows as events
 * arrive, and a repaint from `/api/overview` underneath that would wipe them
 * mid-flash. So the refresh path passes `withFeed = false` — except while the
 * feed is still showing its absence line, where there is nothing to wipe and
 * everything to gain (a store's first event should not need a reload to
 * appear).
 */
export function paintHome(d, withFeed) {
  $("ov-opening").textContent = d.opening;
  tiles.paint(d);
  bands.paint(d);
  if (withFeed) liveActivity.paint(d);
  identity.paint(d);
  protectedInk.paint(d);
  contested.paint(d);
  recentChapters.paint(d);
}

/**
 * The store moved: re-read the overview. THE FLOW PAGE WAS NOT THE ONLY PAGE
 * COUNTING — the overview's tiles, band bars and identity panel used to stay
 * frozen at boot while the flow tab beside them moved. The feed belongs to the
 * poll (see `paintHome`), unless it is still the absence line.
 */
async function refresh() {
  mechanisms.render();
  const fresh = await api("/api/overview");
  paintHome(fresh, liveActivity.showingAbsence());
}

export default {
  name: "home",
  mount(section) {
    section.innerHTML = markup;
    liveActivity.mount();
  },
  render,
  refresh,
};
