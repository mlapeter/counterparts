/* The mind tab: identity, the page, the briefing, the journal, the revision
   stories. One fetch (`/api/mind`). */
import { api, fail } from "../../shared/api.js";
import { $ } from "../../shared/dom.js";
import * as chapters from "./sections/chapters.js";
import * as identityBand from "./sections/identity-band.js";
import * as selfPage from "./sections/self-page.js";
import * as stories from "./sections/stories.js";
import * as wake from "./sections/wake.js";

const markup = `
    <p class="lede" id="mind-opening"></p>
    <div class="cols">
      <div>${identityBand.markup}
      </div>
      <div>${selfPage.markup}${wake.markup}${chapters.markup}
      </div>
    </div>${stories.markup}
  `;

async function render() {
  let d;
  try { d = await api("/api/mind"); } catch (e) { return fail("The mind page", e); }
  $("mind-opening").textContent = d.opening;
  identityBand.paint(d);
  selfPage.paint(d);
  wake.paint(d);
  chapters.paint(d);
  stories.paint(d);
}

export default {
  name: "mind",
  mount(section) { section.innerHTML = markup; },
  render,
};
