/* Consolidation. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` and `inDev` are the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "consolidation",
  family: "transformation",
  name: "Consolidation",
  short: "Consolidation",
  tagline: "Memories aren’t saved when they’re made. They’re rebuilt, offline, while you sleep.",
  inDev: true,
  explainer: "Every few lived days a short “sleep” runs: exact duplicates are merged, and a memory that scored high and was used on three separate days becomes a core memory.",
  built: ["A sleep pass every three lived days strengthens memories that held up and merges exact duplicates.", "A memory scored high and used on three separate days becomes a core memory."],
  inDevelopment: ["Near-duplicates are not merged, on purpose, and few memories ever reach core (skills and places never can)."],
};
