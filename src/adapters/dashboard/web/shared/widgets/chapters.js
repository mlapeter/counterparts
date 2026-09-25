/* The journal's chapters as clickable rows. The overview and the mind page
   both show them, under their own headings. */
import { absenceLine } from "../absence.js";
import { esc } from "../dom.js";

export function chapterRows(chapters, absent) {
  return absent
    ? absenceLine(absent, "no chapter has been written")
    : chapters.map((c) =>
        '<div class="r click" onclick="openMemory(\'' + c.id + '\')"><span style="color:var(--cyan)">' +
        esc(c.title) + "</span>" +
        '<div style="color:var(--dim);margin-top:4px">' + esc(c.opening) + "</div>" +
        '<div class="meta"><span>lived day ' + c.day + "</span><span>" + c.bytes + " bytes</span></div></div>"
      ).join("");
}
