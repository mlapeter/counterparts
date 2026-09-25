/* What the next session wakes up with — folded to one line and a stacked bar of
   its parts; click to read the whole text. And the one management door on this
   tab: rebuild it now (`counterparts rebrief`, through the actions seam). */
import { absenceLine } from "../../../shared/absence.js";
import { act, resultHtml } from "../../../shared/actions.js";
import { $, esc } from "../../../shared/dom.js";

export const markup = `
        <h2>What the next session wakes up with</h2>
        <div class="card pad" id="self-wake"></div>
        <div class="wk-act">
          <button type="button" class="act-btn" id="rebrief-go">Rebuild what the next session wakes up with</button>
          <div id="rebrief-out"></div>
        </div>`;

let open = false;
let onDone = null;

export const kb = (b) => (b / 1000).toFixed(1) + " KB";

/** The parts, in reading order, with a colour each. */
const TONE = { furniture: "p-furn", page: "p-page", identity: "p-page", craft: "p-craft", threads: "p-threads", hints: "p-hints", horizon: "p-horizon" };

export function mount(refresh) {
  onDone = refresh;
  $("rebrief-go").addEventListener("click", async () => {
    const go = $("rebrief-go");
    go.disabled = true;
    $("rebrief-out").innerHTML = resultHtml({ out: ["rebuilding…"] });
    const r = await act("rebrief", {});
    go.disabled = false;
    $("rebrief-out").innerHTML = resultHtml(r);
    if (r && r.ok && onDone) onDone();
  });
}

export function paint(d) {
  const w = d.wake;
  if (!w.ok) {
    $("self-wake").innerHTML = absenceLine(w.absent || "(never run)", "no wake has been composed yet (" + w.reason + ")");
    return;
  }
  const budget = d.wakeBudget;
  const total = budget && budget > w.bytes ? budget : w.bytes;
  const parts = d.wakeParts || [];
  const seg = parts.map((p) =>
    '<span class="wk-seg ' + (TONE[p.key] || "p-furn") + '" style="width:' + (p.bytes / total * 100).toFixed(2) + '%" title="' +
      esc(p.label) + ": " + p.bytes + ' bytes"></span>').join("");
  const legend = parts.map((p) =>
    '<span class="wk-key"><i class="' + (TONE[p.key] || "p-furn") + '"></i>' + esc(p.label) + " <em>" + kb(p.bytes) + "</em></span>").join("") +
    (budget && budget > w.bytes ? '<span class="wk-key"><i class="p-room"></i>room left <em>' + kb(budget - w.bytes) + "</em></span>" : "");
  $("self-wake").innerHTML =
    '<button type="button" class="wk-sum" id="wake-toggle" aria-expanded="' + open + '">' +
      '<span class="wk-line"><b>' + kb(w.bytes) + "</b>" +
        (budget ? " of " + kb(budget) : " <small>(the size it may take was not recorded)</small>") + "</span>" +
      '<span class="wk-open">' + (open ? "hide the text" : "read it") + "</span>" +
    "</button>" +
    '<div class="wk-bar" role="img" aria-label="' + esc(parts.map((p) => p.label + " " + p.bytes + " bytes").join(", ")) + '">' + seg + "</div>" +
    '<div class="wk-legend">' + legend + "</div>" +
    '<div class="wk-full"' + (open ? "" : " hidden") + ">" + fullText(w) + "</div>" +
    '<p class="foot">When a session starts, a line with today\'s date goes on top, and in a folder with a handoff note, a pointer to it. It is composed without a model, at the end of each day.</p>';
  $("wake-toggle").addEventListener("click", () => { open = !open; paint(d); });
}

function fullText(w) {
  return (w.preface ? '<div class="wakehead">Delivery preface: ' + esc(w.preface) + "</div>" : "") +
    w.lanes.map((lane) =>
      '<div class="lane"><h4>' + esc(lane.heading) + "</h4>" +
      lane.items.map((item) => {
        const m = /^(\S+\s·\s|by\s\S+\s·\s)/.exec(item);
        return '<div class="item">' + (m ? '<span class="date">' + esc(m[1]) + "</span>" + esc(item.slice(m[1].length)) : esc(item)) + "</div>";
      }).join("") + "</div>"
    ).join("");
}
