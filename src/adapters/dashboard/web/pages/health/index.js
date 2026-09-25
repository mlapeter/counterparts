/* The health tab: "is it working?" first — doctor's checks as a checklist
   with lights — then the last sleep cycle as one line, where archived
   memories went as one picture, and a button that checks the search index.
   The developer panels that used to live here (band symmetry, what fired,
   every durable record, the heatmap, what I cannot see) are on the flow tab,
   under the diagram. `/api/health` for the cycle and the archive; doctor and
   verify through the actions seam (both reads). */
import { api, fail } from "../../shared/api.js";
import * as archive from "./sections/archive.js";
import * as checks from "./sections/checks.js";
import * as cycle from "./sections/cycle.js";
import * as verify from "./sections/verify.js";

const markup = `
    ${checks.markup}
    ${cycle.markup}
    ${archive.markup}
    ${verify.markup}
  `;

let checked = false;

async function paint() {
  let d;
  try { d = await api("/api/health"); } catch (e) { return fail("The health page", e); }
  cycle.paint(d);
  archive.paint(d);
}

async function render() {
  // Doctor runs once, when the tab is first opened; "Check again" re-runs it.
  if (!checked) { checked = true; void checks.run(); }
  await paint();
}

export default {
  name: "health",
  mount(section) { section.innerHTML = markup; verify.mount(); },
  render,
  refresh: paint,
};
