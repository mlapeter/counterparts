/* Live activity — the durable log in my own words. The one overview panel the
   pulse owns: it is registered as a live feed, so new events are prepended. */
import { $ } from "../../../shared/dom.js";
import { registerLiveFeed, renderFeed } from "../../../shared/widgets/feed.js";

export const markup = `
        <h2>Live activity <small style="color:var(--purple)">— in my own words · click any line for the record behind it</small></h2>
        <div class="card feed" id="ov-feed"></div>
        <p class="foot" id="ov-feednote"></p>`;

export function mount() { registerLiveFeed("ov-feed"); }

export function paint(d) {
  renderFeed($("ov-feed"), d.feed, d);
  $("ov-feednote").textContent =
    "Payloads are ids, counts and bytes — never a memory's words, and never a turn of yours. " +
    "The names above are resolved at the moment this page was drawn.";
}

/** True while the feed still shows its absence line — nothing of the pulse's
 *  to lose by repainting it. */
export function showingAbsence() {
  const feedEl = $("ov-feed");
  return !!(feedEl && feedEl.querySelector(".empty"));
}
