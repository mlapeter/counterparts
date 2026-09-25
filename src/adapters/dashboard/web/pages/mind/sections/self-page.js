/* My page, and what it used to say. Read-only: there is no write door here. */
import { absenceLine, emptyBox } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";

export const markup = `
        <h2>My page <small>— the prose the wake opens with; read-only here</small></h2>
        <div class="card pad" id="mind-page"></div>
        <h2>What the page used to say <small>— every earlier version, newest first</small></h2>
        <div class="card rows" id="mind-page-versions"></div>`;

export function paint(d) {
  $("mind-page").innerHTML = d.pageAbsent
    ? absenceLine(d.pageAbsent, "no page has been written — still forming")
    : '<div class="wakehead"><b style="color:var(--cyan);font-weight:400">' + d.page.bytes + " bytes</b>, version " +
        d.page.version + ", last revised " + esc(d.page.revisedOn || "an unrecorded date") +
        (d.page.by ? " by " + esc(d.page.by) : "") +
        (d.page.stale ? ' <span style="color:var(--amber)">— STALE</span>' : "") +
        (d.page.reason ? "<br><br>Last change: " + esc(d.page.reason) : "") + "</div>" +
      '<div class="lane"><div class="item" style="white-space:pre-wrap">' + esc(d.page.body) + "</div></div>";
  $("mind-page-versions").innerHTML = d.pageVersions.length === 0
    ? emptyBox("(none yet) — the page has been written once, or not at all.", "")
    : d.pageVersions.map((v) =>
        '<div class="r"><span style="color:var(--cyan)">version ' + v.seq + "</span>" +
        '<div class="meta"><span>lived day ' + v.day + "</span><span>" + esc(v.reason) + "</span></div>" +
        '<div style="color:var(--dim);margin-top:6px;white-space:pre-wrap">' +
        esc(v.body === null ? "(this version's prose could not be read)" : v.body) + "</div></div>"
      ).join("");
}
