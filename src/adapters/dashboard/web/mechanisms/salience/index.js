/* Encoding & salience. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `tagline` and `inDev` are the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "salience",
  family: "encoding",
  name: "Encoding & salience",
  short: "Salience",
  tagline: "Not everything that happens is worth keeping. Something has to decide.",
  inDev: false,
  explainer: "Every memory gets an importance score as it is written, set by the AI that lived the conversation, and now also by how new it is next to what is already stored. Small stuff fades fast; what mattered sticks.",
};
