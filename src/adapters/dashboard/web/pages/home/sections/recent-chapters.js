/* The latest three chapters — the journal, in the first person. The rest are
   on the self tab. */
import { $ } from "../../../shared/dom.js";
import { chapterRows } from "../../../shared/widgets/chapters.js";

export const markup = `
        <h2>Latest chapters <small>— the journal, in the first person; these do not decay</small></h2>
        <div class="card rows" id="ov-chapters"></div>
        <p class="foot"><a href="#self" class="home-more">every chapter, on the self tab →</a></p>`;

export function paint(d) {
  $("ov-chapters").innerHTML = chapterRows((d.chapters || []).slice(0, 3), d.chaptersAbsent);
}
