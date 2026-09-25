/* Association. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `tagline` and `inDev` are the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "association",
  family: "retrieval",
  name: "Association",
  short: "Association",
  tagline: "Recalling one thing pulls its neighbours along with it.",
  inDev: true,
  explainer: "Memories used together in the same turn get linked, and a link can lift its partner later. It only lifts a memory the conversation already reached; a link cannot bring one to mind by itself.",
};
