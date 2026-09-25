/* Prospective memory. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` and `inDev` are the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "prospective",
  family: "retrieval",
  name: "Prospective memory",
  short: "Prospective",
  tagline: "Remembering to do something later — the memory that fires itself at the right moment.",
  inDev: true,
  explainer: "Not built yet. A memory can carry a date, like a launch next Tuesday, but nothing brings it back on the day.",
  built: ["Dated reminders can be stored and have their own records."],
  inDevelopment: ["Nothing live can put a date on a memory yet, and nothing brings one back on the day."],
};
