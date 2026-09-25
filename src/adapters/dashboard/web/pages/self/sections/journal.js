/* The journal: chapters grouped by the day they were written, newest first,
   each with its title, the model that wrote it (when recorded) and its first
   line. Click one to read it in full; the whole entry opens as a record. */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";
import { said } from "../../../shared/format.js";
import { renderMarkdown } from "../markdown.js";

export const markup = `
    <h2>Journal <small>— a chapter at the end of a session; these do not fade</small></h2>
    <div id="self-journal"></div>`;

export function paint(d) {
  if (d.journalAbsent) {
    $("self-journal").innerHTML = absenceLine(d.journalAbsent, "no chapter has been written yet");
    return;
  }
  $("self-journal").innerHTML = d.journal.map((day) =>
    '<div class="jd"><div class="jd-h"><b>' + esc(day.date || "lived day " + day.day) + "</b>" +
      (day.date ? "<span>lived day " + day.day + "</span>" : "") + "</div>" +
      day.chapters.map((c) =>
        '<details class="jc"><summary>' +
          '<span class="jc-top"><span class="jc-title">' + esc(c.title) + "</span>" +
            (c.model ? '<span class="chip model" title="the model that wrote it">' + esc(c.model) + "</span>" : "") + "</span>" +
          '<span class="jc-first">' + said(c.first, c.confidential) + "</span>" +
        "</summary>" +
        '<div class="jc-body">' + (c.text === null ? '<p class="foot">This chapter is withheld here, as it is everywhere.</p>' : renderMarkdown(c.text)) +
          '<button type="button" class="act-btn jc-open" onclick="openMemory(\'' + c.id + '\')">open the whole entry</button></div>' +
        "</details>").join("") +
    "</div>").join("") +
    (d.journalMore > 0 ? '<p class="foot">' + d.journalMore + " older chapters are not shown here.</p>" : "");
}
