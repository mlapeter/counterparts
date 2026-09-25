/* What I would say on waking — the briefing, as it renders. */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";

export const markup = `
        <h2>What I would say on waking <small>— the briefing, as it renders</small></h2>
        <div class="card pad" id="mind-wake"></div>`;

export function paint(d) {
  const w = d.wake;
  $("mind-wake").innerHTML = !w.ok
    ? absenceLine(w.absent || "(never run)", "I have composed no briefing (" + w.reason + ")")
    : '<div class="wakehead"><b style="color:var(--cyan);font-weight:400">' + w.bytes + " bytes</b>, composed and waiting. " +
        "This is the text the next session opens with — rendered without a model, and read from the store just now." +
        (w.preface ? "<br><br>Delivery preface: " + esc(w.preface) : "") + "</div>" +
      w.lanes.map((lane) =>
        '<div class="lane"><h4>' + esc(lane.heading) + "</h4>" +
        lane.items.map((item) => {
          const m = /^(\S+\s·\s|by\s\S+\s·\s)/.exec(item);
          return '<div class="item">' + (m ? '<span class="date">' + esc(m[1]) + "</span>" + esc(item.slice(m[1].length)) : esc(item)) + "</div>";
        }).join("") + "</div>"
      ).join("");
}
