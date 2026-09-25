/* ───────────────────────────────────────────────────────────────────────────
   The dashboard's one entry module. No dependencies, no bundler, no network
   beyond this origin. Every panel is a pure function of one JSON view; nothing
   is cached between loads, because the whole point of render-time resolution
   is that a memory removed a minute ago stops resolving on the next request.

   Where things live: `README.md` beside this file.
   ─────────────────────────────────────────────────────────────────────────── */
import { api, fail } from "./shared/api.js";
import { $ } from "./shared/dom.js";
import { mountModal } from "./shared/modal.js";
import { live, tabs } from "./shared/state.js";
import { PAGE, PAGES, TABS } from "./shell/pages.js";
import { poll } from "./shell/pulse.js";
import { mountNav, showTab } from "./shell/tabs.js";

// Each page writes its own markup into its section and wires its listeners.
for (const page of PAGES) page.mount($("tab-" + page.name));
mountNav();
mountModal();

let resizeTimer = null;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const page = PAGE[tabs.current];
    if (page && page.resize) page.resize();
  }, 120);
});

(async function boot() {
  try {
    const meta = await api("/api/meta");
    // The NAME of the store, not its address. A temp path in the header is in
    // every screenshot this dashboard produces, and it says nothing about the
    // store — the full path is one hover away for the moment it matters.
    const name = meta.dir.replace(/\/+$/, "").split("/").pop() || meta.dir;
    $("dir").textContent = name;
    $("dir").title = "reading " + meta.dir;
    $("clock").textContent = "day " + meta.day;
    live.fingerprint = { rows: meta.rows, day: meta.day };
  } catch (e) { fail("The header", e); }
  showTab(location.hash.slice(1) || "overview", false);
  // Every tab is built once, up front: a screenshot of any of them should never
  // be waiting on a fetch, and the flow diagram needs its data before it can be
  // drawn at all.
  await Promise.all(TABS.filter((t) => !tabs.loaded[t]).map((t) => { tabs.loaded[t] = true; return PAGE[t].render(); }));
  const current = PAGE[tabs.current];
  if (current.redraw) current.redraw();
  setInterval(poll, 4000);
  document.documentElement.dataset.loaded = "1";
})();
