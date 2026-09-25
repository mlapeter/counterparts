/* Band composition — the same bars as the overview, without the gloss. */
import { $ } from "../../../shared/dom.js";
import { bandBars } from "../../../shared/widgets/bar.js";

export const markup = `
        <h2>Band composition</h2>
        <div class="card pad" id="mem-bands"></div>`;

export function paint(d) {
  $("mem-bands").innerHTML = bandBars(d.bands, false);
}
