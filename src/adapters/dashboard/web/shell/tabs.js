/* The nav strip and tab switching. A tab is built once, on first show (or at
   boot — see `app.js`); coming back to it only redraws what is laid out by
   width. */
import { $ } from "../shared/dom.js";
import { tabs } from "../shared/state.js";
import { PAGE, TABS } from "./pages.js";

/* Old hashes still land: a bookmark to `#overview` or `#mind` (and the
   `/brain` page's links) open the tab under its new name, and the address bar
   is corrected to it. */
const RENAMED = { overview: "home", mind: "self" };

export function showTab(name, push) {
  if (RENAMED[name]) { name = RENAMED[name]; push = true; }
  if (!TABS.includes(name)) name = "home";
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
