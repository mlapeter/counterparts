/* Interference. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` and `inDev` are the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "interference",
  family: "storage",
  name: "Interference",
  short: "Interference",
  tagline: "New memories crowd out old ones. Old ones distort new ones. They compete.",
  inDev: true,
  explainer: "Not built yet. Today only exact duplicates are merged; similar memories sit side by side without competing.",
  built: [],
  inDevelopment: ["Nothing yet: only byte-identical memories merge, and similar ones sit side by side without competing."],
};
