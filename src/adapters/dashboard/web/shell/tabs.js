/* The nav strip and tab switching. A tab is built once, on first show (or at
   boot — see `app.js`); coming back to it only redraws what is laid out by
   width. */
import { $ } from "../shared/dom.js";
import { tabs } from "../shared/state.js";
import { PAGE, TABS } from "./pages.js";

export function showTab(name, push) {
  if (!TABS.includes(name)) name = "overview";
  tabs.current = name;
  for (const t of TABS) {
    $("tab-" + t).hidden = t !== name;
    const link = $("nav-" + t);
    if (link) link.classList.toggle("on", t === name);
  }
  if (push) history.replaceState(null, "", "#" + name);
  const page = PAGE[name];
  if (!tabs.loaded[name]) { tabs.loaded[name] = true; page.render(); }
  else if (page.show) page.show();
}

export function mountNav() {
  $("nav").innerHTML = TABS.map((t) => '<a id="nav-' + t + '" href="#' + t + '">' + t + "</a>").join("");
  for (const t of TABS) $("nav-" + t).onclick = (e) => { e.preventDefault(); showTab(t, true); };
  addEventListener("hashchange", () => showTab(location.hash.slice(1), false));
}
