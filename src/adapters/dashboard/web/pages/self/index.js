/* The self tab (was "mind"): the self page on top with its history as a line of
   dots, what is settling into the core (and what is closest), the wake folded to
   one line, and the journal by day. One fetch (`/api/mind`). */
import { api, fail } from "../../shared/api.js";
import { $ } from "../../shared/dom.js";
import * as journal from "./sections/journal.js";
import * as page from "./sections/page.js";
import * as settling from "./sections/settling.js";
import * as wake from "./sections/wake.js";

const markup = `
    <p class="lede" id="mind-opening"></p>${page.markup}
    <div class="cols self-cols">
      <div>${settling.markup}
      </div>
      <div>${wake.markup}
      </div>
    </div>${journal.markup}
  `;

async function render() {
  let d;
  try { d = await api("/api/mind"); } catch (e) { return fail("The self page", e); }
  $("mind-opening").textContent = d.opening;
  page.paint(d);
  settling.paint(d);
  wake.paint(d);
  journal.paint(d);
}

export default {
  name: "self",
  mount(section) {
    section.innerHTML = markup;
    wake.mount(render);
  },
  render,
  refresh: render,
};
