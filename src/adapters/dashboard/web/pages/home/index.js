/* The home tab: the page the dashboard opens on, shaped like counterparts.ai's
   home. The hero (one line about this memory, a few counts, the brain), the
   mechanism panel under it, then the live feed and the latest chapters.

   Two fetches: `/api/overview` for the words and the feed, `/api/mechanisms`
   (and `/api/mechanism?id=` for the picked one) for the panel and the brain. */
import { api, fail } from "../../shared/api.js";
import { $ } from "../../shared/dom.js";
import { mountBrain } from "./brain.js";
import * as explorer from "./sections/explorer.js";
import * as hero from "./sections/hero.js";
import * as liveActivity from "./sections/live-activity.js";
import * as recentChapters from "./sections/recent-chapters.js";

const markup = `
    ${hero.markup}
    ${explorer.markup}
    <div class="cols home-below">
      <div>${liveActivity.markup}
      </div>
      <div>${recentChapters.markup}
      </div>
    </div>
  `;

async function render() {
  await Promise.all([explorer.render(), (async () => {
    let d;
    try { d = await api("/api/overview"); } catch (e) { return fail("The home page", e); }
    paintHome(d, true);
  })()]);
}

/**
 * Draw the home page's words from a payload. Called once at boot with the feed,
 * and again from the poll WITHOUT it whenever the store moved.
 *
 * The feed is the one panel the poll owns: it prepends flashed rows as events
 * arrive, and a repaint from `/api/overview` underneath that would wipe them
 * mid-flash. So the refresh path passes `withFeed = false` — except while the
 * feed is still showing its absence line, where there is nothing to wipe and
 * everything to gain (a store's first event should not need a reload to
 * appear).
 */
export function paintHome(d, withFeed) {
  hero.paint(d);
  if (withFeed) liveActivity.paint(d);
  recentChapters.paint(d);
}

/**
 * The store moved: re-read the overview and the mechanisms. THE FLOW PAGE WAS
 * NOT THE ONLY PAGE COUNTING — the home page's counts used to stay frozen at
 * boot while the flow tab beside them moved. The feed belongs to the poll (see
 * `paintHome`), unless it is still the absence line. The mechanisms' refresh is
 * also what lights the brain: a mechanism whose newest row moved flares.
 */
async function refresh() {
  explorer.refresh();
  const fresh = await api("/api/overview");
  paintHome(fresh, liveActivity.showingAbsence());
}

export default {
  name: "home",
  mount(section) {
    section.innerHTML = markup;
    hero.mount();
    liveActivity.mount();
    // The brain is built once and kept; a failure to start is a calm sentence
    // in its place, never an error on the page.
    try {
      explorer.attachBrain(mountBrain($("home-brain"), explorer.pickRegion));
    } catch (e) {
      const wrap = $("home-brain");
      wrap.classList.add("is-nogl");
      wrap.innerHTML = '<div class="brain-off"><p>The brain picture could not start in this browser.</p>' +
        "<p>Everything it shows is in the mechanisms below.</p></div>";
      wrap.dataset.ready = "1";
    }
  },
  render,
  refresh,
};
