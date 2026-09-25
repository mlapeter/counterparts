/* Where every memory sits — the band bars, with a gloss under each. */
import { $, esc } from "../../../shared/dom.js";
import { bandBars } from "../../../shared/widgets/bar.js";

export const markup = `
        <h2>Where every memory sits <small>— the consolidation gradient, computed now</small></h2>
        <div class="card pad" id="ov-bands"></div>`;

export function paint(d) {
  $("ov-bands").innerHTML = bandBars(d.bands, true) + '<p class="foot">' + esc(d.bandNote) + "</p>";
}
