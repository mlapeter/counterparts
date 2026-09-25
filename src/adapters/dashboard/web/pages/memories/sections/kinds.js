/* The six kinds, in words: what each is, how many I hold, how fast it fades
   and how easily it is corrected. Click one to filter the list. (The physics
   numbers behind the words are still in `/api/memories`; the flow tab is
   where they will be shown.) */
import { $, esc } from "../../../shared/dom.js";
import { filters, onFilter, toggle } from "../state.js";

export const markup = `
        <h2>Kinds <small>— what sort of thing each memory is</small></h2>
        <div class="kindgrid" id="kinds" role="group" aria-label="kinds — click one to filter the list"></div>`;

let data = null;

export function mount() {
  $("kinds").addEventListener("click", (e) => {
    const card = e.target.closest("[data-kind]");
    if (card) toggle("kind", card.dataset.kind);
  });
  onFilter(paintCards);
}

export function paint(d) { data = d; paintCards(); }

function paintCards() {
  if (!data) return;
  const peak = Math.max(1, ...data.kinds.map((k) => k.count));
  $("kinds").innerHTML = data.kinds.map((k) => {
    const p = k.plain || { label: k.kind, what: k.gloss, fades: "", corrects: "" };
    const on = filters.kind === k.kind;
    return '<button type="button" class="kcard' + (k.absent ? " none" : "") + (on ? " on" : "") +
      '" data-kind="' + esc(k.kind) + '" aria-pressed="' + on + '">' +
      '<span class="kline"><span class="kname">' + esc(p.label) + '</span><span class="kn">' +
        (k.absent ? esc(k.absent) : k.count) + "</span></span>" +
      '<span class="kbar"><span style="width:' + (k.count / peak) * 100 + '%"></span></span>' +
      '<span class="kwhat">' + esc(p.what) + "</span>" +
      '<span class="kfade">' + esc(p.fades) + (p.corrects ? ", " + esc(p.corrects) : "") + "</span>" +
      '<span class="kspeed" title="how fast it fades">' +
        [0, 1, 2, 3, 4].map((i) => '<i class="' + (i < Math.round((k.fadeSpeed || 0) * 5) ? "f" : "") + '"></i>').join("") +
        "<em>fades</em></span>" +
      "</button>";
  }).join("");
}
