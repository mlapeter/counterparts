/* Decay & forgetting. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `tagline` and `inDev` are the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "decay",
  family: "storage",
  name: "Decay & forgetting",
  short: "Forgetting",
  tagline: "Forgetting isn’t a failure of memory. It’s one of its jobs.",
  inDev: false,
  explainer: "Unused memories fade over the days you actually work together, not calendar days. Very faint ones are archived, not deleted, and memories in the core identity band do not fade at all.",
};
