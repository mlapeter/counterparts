/* Chapters — the journal; these do not decay. */
import { $ } from "../../../shared/dom.js";
import { chapterRows } from "../../../shared/widgets/chapters.js";

export const markup = `
        <h2>Chapters <small>— the journal; these do not decay</small></h2>
        <div class="card rows" id="mind-chapters"></div>`;

export function paint(d) {
  $("mind-chapters").innerHTML = chapterRows(d.chapters, d.chaptersAbsent);
}
