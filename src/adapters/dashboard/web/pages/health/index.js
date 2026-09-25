/* The health tab: the cycle, the tripwires, the ways out, what fired, what
   can be recorded, the heatmap, the blind spots. `/api/health`, then the
   what-fired panel's own `/api/fired`. */
import { api, fail } from "../../shared/api.js";
import * as blind from "./sections/blind.js";
import * as exits from "./sections/exits.js";
import * as fired from "./sections/fired.js";
import * as heatmap from "./sections/heatmap.js";
import * as phases from "./sections/phases.js";
import * as records from "./sections/records.js";
import * as removals from "./sections/removals.js";
import * as symmetry from "./sections/symmetry.js";

const markup = `
    <div class="cols">
      <div>${phases.markup}${symmetry.markup}${exits.markup}${removals.markup}
      </div>
      <div>${fired.markup}${records.markup}
      </div>
    </div>${heatmap.markup}${blind.markup}
  `;

async function render() {
  let d;
  try { d = await api("/api/health"); } catch (e) { return fail("The health page", e); }
  phases.paint(d);
  symmetry.paint(d);
  exits.paint(d);
  removals.paint(d);
  records.paint(d);
  heatmap.paint(d);
  blind.paint(d);
  await fired.render();
}

export default {
  name: "health",
  mount(section) { section.innerHTML = markup; },
  render,
};
