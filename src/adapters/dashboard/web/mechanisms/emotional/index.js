/* Emotional modulation. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` and `inDev` are the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "emotional",
  family: "encoding",
  name: "Emotional modulation",
  short: "Emotion",
  tagline: "The moments that mattered are the ones you keep. Feeling is the encoder’s thumb on the scale.",
  inDev: true,
  explainer: "A memory its author scored as emotional comes back more easily while you are expressing a feeling. The quoted feeling itself is kept as a label and does not add weight yet.",
  built: ["A memory its author scored as emotional comes back more easily while you are expressing a feeling."],
  inDevelopment: ["A quoted feeling is kept as a label only; it adds no weight.", "The score is dropped unless all three salience parts are given, and the feeling classifier is switched off."],
};
