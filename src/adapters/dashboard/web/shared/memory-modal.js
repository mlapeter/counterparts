/* One memory, opened — from any row, dot or reference on any page. Resolved at
   the moment it is opened, so a memory that left the store says so. */
import { act, resultHtml } from "./actions.js";
import { api, fail } from "./api.js";
import { emptyBox } from "./absence.js";
import { esc } from "./dom.js";
import { headline, n2, n3, said } from "./format.js";
import { openModal, section } from "./modal.js";
import { confirmTyped } from "./widgets/confirm.js";

export async function openMemory(id) {
  let d;
  try { d = await api("/api/memory?id=" + encodeURIComponent(id)); }
  catch (e) { return fail("That memory", e); }
  if (!d.found) {
    return openModal("<h3>" + esc(id) + "</h3><div class='sub'>resolved just now</div>" +
      emptyBox(d.absence || "[no longer at this address]",
        "Ids are resolved at the moment a page is drawn, so a memory that has left the store stops resolving immediately."));
  }
  const kv = (k, v) => '<div class="k">' + esc(k) + '</div><div class="v">' + v + "</div>";
  const s = d.salience;
  openModal(
    "<h3>" + (d.title ? esc(d.title) : d.confidential ? said(d.text, true) : esc(headline(d.text))) + "</h3>" +
    "<div class='sub'><span>" + esc(d.id) + "</span>" +
      (d.askedFor ? "<span>you asked for " + esc(d.askedFor) + ", which forwards here</span>" : "") +
      "<span class='path'>rev " + esc(String(d.revision)) + " · " + esc(d.contentHash || "—") + "</span>" +
      "<button class='copy' data-id=\"" + esc(d.id) + "\" onclick=\"copyId(this)\">copy id</button>" +
      "<button class='copy act-danger' data-id=\"" + esc(d.id) + "\" onclick=\"removeMemory(this)\">remove…</button>" +
      "</div>" +
      "<div id='remove-out'></div>" +
    "<div class='body'>" + (d.confidential ? '<span class="withheld">' + esc(d.text) + "</span>" : esc(d.text)) + "</div>" +
    (d.journal
      ? "<p style='color:var(--purple);font-size:11px;line-height:1.7;margin:-4px 0 14px'>" +
        "This is a journal entry, not a memory. It is the account a memory was made from, it sits outside " +
        "every sleep phase, and the physics below is recorded but never acted on — nothing here decays.</p>"
      : "") +
    '<div class="kv">' +
      kv("kind", esc(d.kind)) +
      kv("band", esc(d.band) + " <span style='color:var(--faint)'>(recorded " + esc(d.recordedBand) + ")</span>") +
      kv("strength", n3(d.strength) + " <span style='color:var(--faint)'>· repetition " + n3(d.repetition) + "</span>") +
      kv("salience", n3(s.combined) + " <span style='color:var(--faint)'>relevance " + n2(s.relevance) +
        " · emotional " + n2(s.emotional) + " · predictive " + n2(s.predictive) +
        (s.novelty === null ? " · <span style='color:var(--amber)'>novelty blind (no schema context existed)</span>" : " · novelty " + n2(s.novelty)) +
        (s.claimed === null ? "" : " · claimed floor " + n2(s.claimed)) + "</span>") +
      kv("lived", "born day " + d.bornDay + " · used " + d.uses + "× over " + d.reinforcedDays +
        " separate days · last used day " + d.lastUsedDay) +
      kv("recorded", esc(d.learnedOn) + (d.happenedOn ? " · happened " + esc(d.happenedOn) : "") +
        "<span style='color:var(--faint)'> — the calendar day this entered the store; " +
        "on a migrated or seeded store, the day of the import</span>") +
      kv("standing", (d.consolidated ? "consolidated" : "not yet consolidated") + " · " +
        (d.promoted ? "promoted into identity" : "not promoted") + " · " +
        (d.protected ? "<span style='color:var(--amber)'>PROTECTED — no revision path reaches it</span>" : "revisable")) +
      kv("pressure", d.pressure === 0
        ? "<span style='color:var(--dim)'>(none yet) — nothing has argued with it</span>"
        : n3(d.pressure) + (d.bar === null ? "" : " against a bar of " + n3(d.bar))) +
      (d.archived ? kv("archived", "<span style='color:var(--amber)'>" + esc(d.archived) + "</span>") : "") +
    "</div>" +
    section("Wired together with", d.edges.map((e) =>
      "<div class='ref' onclick=\"openMemory('" + e.id + "')\"><span class='role'>" + n2(e.weight) + "</span>" +
      said(e.text, e.confidential) + "</div>").join(""),
      "(none yet) — it fires with nothing.") +
    section("What it points at, resolved just now", d.points.map((p) =>
      "<div class='ref' onclick=\"openMemory('" + p.id + "')\"><span class='role'>" + esc(p.role) + "</span>" +
      esc(p.text) + "</div>").join(""), "(none yet) — it points at nothing.") +
    section("Version history", d.versions.map((v) =>
      "<div class='ref'><span class='role'>v" + v.seq + " · " + esc(v.reason) + " · day " + v.day + "</span>" +
      esc(v.became) + "</div>").join(""), "(none yet) — it has never been revised.") +
    section("Looks ahead to", d.prospective.map((p) =>
      "<div class='ref'><span class='role'>" + esc(p.date) + " (" + esc(p.precision) + ")</span>" +
      esc(p.state) + ", fired " + p.fires + "×</div>").join(""), "(none yet) — it holds no intention.") +
    (d.removal.length === 0 ? "" : section("Removal record", d.removal.map((r) =>
      "<div class='ref'><span class='role'>" + esc(r.stage) + "</span>by " + esc(r.actor) +
      " — " + esc(r.reason || "no reason recorded") + "</div>").join(""), ""))
  );
}

/** The id, on demand — it is how the owner addresses this memory anywhere else
 *  (`counterparts recall`, the MCP tools, a note to themselves). Failure is
 *  silent and local: a clipboard a browser refuses is not worth a console
 *  error. */
export function copyId(btn) {
  const id = btn.dataset.id || "";
  const done = () => { btn.textContent = "copied"; setTimeout(() => { btn.textContent = "copy id"; }, 1400); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id).then(done, () => { btn.textContent = "select it above"; });
      return;
    }
  } catch (e) { /* fall through */ }
  btn.textContent = id;
}

/**
 * REMOVE, the loud way — the console's own two steps. First the dry run
 * (`counterparts remove <id>`), whose plan is shown in the confirmation; then,
 * only once the owner has typed the id back, `remove <id> --confirm`, with what
 * they typed handed to the console's own prompt.
 */
export async function removeMemory(btn) {
  const id = btn.dataset.id || "";
  const out = document.getElementById("remove-out");
  const show = (html) => { if (out) out.innerHTML = html; };
  btn.disabled = true;
  const plan = await act("remove", { id });
  btn.disabled = false;
  if (plan.error || !plan.ok) return show(resultHtml(plan));
  const typed = await confirmTyped({
    title: "Remove this memory permanently?",
    bodyHtml: "<div style='color:var(--dim);margin-bottom:6px'>What the console plans to do:</div>" + resultHtml(plan),
    phrase: id,
    action: "remove it",
  });
  if (typed === null) return show("<div class='act-out'>Nothing was removed.</div>");
  show(resultHtml({ out: ["removing…"] }));
  const r = await act("remove", { id, confirm: typed });
  show(resultHtml(r));
  // Pages that list memories re-read now, not on the next poll.
  if (r && r.ok) window.dispatchEvent(new CustomEvent("counterparts:changed"));
}

// Every row on every page opens a memory through an inline `onclick` string.
window.openMemory = openMemory;
window.copyId = copyId;
window.removeMemory = removeMemory;
