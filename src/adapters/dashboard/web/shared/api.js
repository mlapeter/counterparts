/* Every fetch goes through here. No network beyond this origin; GET only. */
import { $, esc } from "./dom.js";

/** Where the page is mounted: `/` locally, `/dashboard/` on hosted. This file
 *  is `<base>shared/api.js`, so its own address says it. */
const BASE = new URL("../", import.meta.url).pathname;

/** A root-relative `/api/…` path, under the page's base. */
export function apiUrl(path) {
  return BASE + String(path).replace(/^\//, "");
}

/** Every fetch goes through here so one failure is a sentence, never a blank
 *  page and never an unhandled rejection in the console. */
export async function api(path) {
  const res = await fetch(apiUrl(path), { headers: { accept: "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(body && body.error ? body.error : ("HTTP " + res.status));
  return body;
}
export function fail(where, err) {
  const box = $("err");
  box.style.display = "block";
  box.innerHTML = "<b>" + esc(where) + " did not load.</b> " + esc(err && err.message ? err.message : String(err)) +
    " &nbsp;The rest of this page is unaffected — it is built one panel at a time on purpose.";
}
