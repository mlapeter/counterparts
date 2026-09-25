/* Ask, and write a note — two management doors, folded shut until opened.
   Both run the console's own command (`counterparts ask`, `counterparts note`)
   through `shared/actions.js` and show what it said, in place. */
import { act, resultHtml } from "../../../shared/actions.js";
import { $ } from "../../../shared/dom.js";

export const markup = `
    <div class="act-form">
      <details id="ask-box">
        <summary>ask memory a question</summary>
        <div class="act-row"><input id="ask-q" type="text" autocomplete="off" spellcheck="false"
          placeholder="what does memory hold about…"><button class="act-btn" id="ask-go" type="button">ask</button></div>
        <div id="ask-out"></div>
      </details>
      <details id="note-box">
        <summary>write a note — remember this, on purpose</summary>
        <textarea id="note-text" rows="3" spellcheck="true" placeholder="the thing to remember"></textarea>
        <div class="act-row"><input id="note-title" type="text" autocomplete="off" placeholder="title (optional)">
          <button class="act-btn" id="note-go" type="button">remember</button></div>
        <div id="note-out"></div>
      </details>
    </div>`;

export function mount() {
  const ask = async () => {
    const q = $("ask-q").value.trim();
    if (!q) return;
    $("ask-go").disabled = true;
    $("ask-out").innerHTML = resultHtml({ out: ["asking…"] });
    const r = await act("ask", { question: q });
    $("ask-go").disabled = false;
    $("ask-out").innerHTML = resultHtml(r);
  };
  $("ask-go").addEventListener("click", ask);
  $("ask-q").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });

  $("note-go").addEventListener("click", async () => {
    const text = $("note-text").value.trim();
    if (!text) return;
    const title = $("note-title").value.trim();
    $("note-go").disabled = true;
    $("note-out").innerHTML = resultHtml({ out: ["writing…"] });
    const r = await act("note", title ? { text, title } : { text });
    $("note-go").disabled = false;
    $("note-out").innerHTML = resultHtml(r);
    // The page picks the new memory up on its next poll, like anything else
    // that lands in the store.
    if (r && r.ok) { $("note-text").value = ""; $("note-title").value = ""; }
  });
}
