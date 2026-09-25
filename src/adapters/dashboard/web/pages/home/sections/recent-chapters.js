/* Recent chapters — the journal, in the first person. */
import { $ } from "../../../shared/dom.js";
import { chapterRows } from "../../../shared/widgets/chapters.js";

export const markup = `
        <h2>Recent chapters <small>— the journal, in the first person; these do not decay</small></h2>
        <div class="card rows" id="ov-chapters"></div>`;

export function paint(d) {
  $("ov-chapters").innerHTML = chapterRows(d.chapters, d.chaptersAbsent);
}
