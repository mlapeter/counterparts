/* Search what I hold — debounced, results open the memory. */
import { absenceLine } from "../../../shared/absence.js";
import { api, fail } from "../../../shared/api.js";
import { $, esc } from "../../../shared/dom.js";
import { n2, said } from "../../../shared/format.js";

export const markup = `
    <div class="searchrow">
      <input id="q" type="search" autocomplete="off" spellcheck="false"
        placeholder="search what I hold — click a result to open the memory">
      <span id="qn"></span>
    </div>
    <div class="card rows" id="qout" hidden></div>`;

let qtimer = null;
export function mount() {
  $("q").addEventListener("input", () => {
    clearTimeout(qtimer);
    qtimer = setTimeout(runSearch, 180);
  });
}

async function runSearch() {
  const q = $("q").value.trim();
  const out = $("qout");
  if (q.length === 0) { out.hidden = true; $("qn").textContent = ""; return; }
  let d;
  try { d = await api("/api/search?limit=25&q=" + encodeURIComponent(q)); }
  catch (e) { return fail("Search", e); }
  out.hidden = false;
  $("qn").textContent = d.hits.length + (d.hits.length === 1 ? " match" : " matches");
  out.innerHTML = d.absent
    ? absenceLine(d.absent, "nothing I hold matches those words")
    : d.hits.map((hit) =>
        '<div class="r click" onclick="openMemory(\'' + hit.id + '\')">' + said(hit.text, hit.confidential) +
        '<div class="meta"><span class="k">' + esc(hit.kind) + "</span><span>" + esc(hit.band) +
        "</span><span>strength " + n2(hit.strength) + "</span><span>score " + n2(hit.score) + "</span></div></div>"
      ).join("");
}
