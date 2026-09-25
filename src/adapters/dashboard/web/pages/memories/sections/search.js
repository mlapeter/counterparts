/* Find a memory: search by its words (live, as you type) and ask a question
   (the console's own `counterparts ask`, through the actions seam). Both lists
   open the memory on click. */
import { absenceLine } from "../../../shared/absence.js";
import { act, resultHtml } from "../../../shared/actions.js";
import { api, fail } from "../../../shared/api.js";
import { $, esc } from "../../../shared/dom.js";
import { said } from "../../../shared/format.js";
import { BANDCOL } from "../../../shared/colors.js";

export const markup = `
    <div class="find">
      <div class="find-col">
        <label class="find-lab" for="q">Search by words</label>
        <div class="find-row">
          <input id="q" type="search" autocomplete="off" spellcheck="false"
            placeholder="a word the memory would use…">
          <span id="qn"></span>
        </div>
        <div class="card rows" id="qout" hidden></div>
      </div>
      <div class="find-col">
        <label class="find-lab" for="ask-q">Ask your memory a question</label>
        <div class="find-row">
          <input id="ask-q" type="text" autocomplete="off" spellcheck="false"
            placeholder="what do I know about…?">
          <button class="mbtn primary" id="ask-go" type="button">Ask</button>
        </div>
        <div id="ask-out"></div>
      </div>
    </div>`;

/** One found memory as a row: words, then kind · band · strength. */
function hitRow(id, title, text, confidential, kind, band, extra) {
  const words = confidential ? said(text, true)
    : (title ? "<b>" + esc(title) + "</b> " : "") + esc(text);
  return '<div class="r click" onclick="openMemory(\'' + esc(id) + '\')">' + words +
    '<div class="meta"><span class="k">' + esc(kind) + "</span>" +
    (band ? '<span><span class="bdot" style="background:' + (BANDCOL[band] || "var(--dim)") + '"></span>' + esc(band) + "</span>" : "") +
    (extra || "") + "</div></div>";
}

let qtimer = null;
export function mount() {
  $("q").addEventListener("input", () => {
    clearTimeout(qtimer);
    qtimer = setTimeout(runSearch, 180);
  });
  $("ask-go").addEventListener("click", ask);
  $("ask-q").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
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
    : d.hits.map((h) => hitRow(h.id, null, h.text, h.confidential, h.kind, h.band,
        "<span>strength " + Math.round(h.strength * 100) + "%</span>")).join("");
}

/** The tiers `ask` sorts answers into, in the words a person would use. */
const TIER = { vivid: "came clearly to mind", quiet: "came quietly", dim: "a faint lead" };

async function ask() {
  const q = $("ask-q").value.trim();
  const out = $("ask-out");
  if (!q) return;
  $("ask-go").disabled = true;
  out.innerHTML = '<div class="act-out">thinking…</div>';
  const r = await act("ask", { question: q, json: true });
  $("ask-go").disabled = false;
  let result = null;
  if (r && r.ok && Array.isArray(r.out)) {
    try { result = JSON.parse(r.out.join("\n")); } catch (e) { result = null; }
  }
  if (!result) { out.innerHTML = resultHtml(r); return; }
  const mems = Array.isArray(result.memories) ? result.memories : [];
  if (mems.length === 0) {
    out.innerHTML = '<div class="empty"><b>Nothing came back.</b> ' +
      (result.considered === 0
        ? "Nothing I hold shared a word with the question."
        : esc(String(result.considered)) + " memories were weighed and none was close enough.") +
      " Try the words the memory itself would use.</div>";
    return;
  }
  out.innerHTML = '<div class="ask-head">What came to mind — ' + mems.length +
    (mems.length === 1 ? " memory" : " memories") + ", best first</div>" +
    '<div class="card rows">' + mems.map((m) => {
      const body = String(m.body || "");
      const first = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) || body;
      const text = first.length > 200 ? first.slice(0, 199) + "…" : first;
      return hitRow(m.id, m.title, text, false, m.journal ? "journal" : m.kind, null,
        '<span class="tier tier-' + esc(m.tier) + '">' + esc(TIER[m.tier] || m.tier) + "</span>");
    }).join("") + "</div>";
}
