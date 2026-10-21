/**
 * `Counterpart`'s PROJECTS (2026-10-21, wave 2 lane G, design §8): which
 * folders are one piece of work. A folder belongs to a project
 * (`folder_projects`, v14); with no row it is its own, and nothing is written
 * to say so — the wake reads `self/work.ts#projectFolders` and writes nothing.
 * A project is a SUBJECT: an entity card with `subject_kind` `project`, the
 * same card its beliefs and tags attach to, made only when a folder is joined.
 *
 * The doors: the owner's (`counterparts project join|leave`, `by: owner`) and
 * the night's proposal once he says yes (`by: night`). Bodies here, delegates
 * on the class, as `counterpart-deposit.ts`. Refusals come back as reasons,
 * never thrown; under observer every write refuses at the store's seam.
 */
import { basename } from "node:path";

import type { Schemas } from "./schemas/index.js";
import { isDirectoryScope, projectFolder } from "./self/index.js";
import type { Store } from "./store/index.js";

/** Who joined a folder (`folder_projects.via`). `default` is the folder a project was first named by. */
export type ProjectVia = "owner" | "night" | "default";

export interface ProjectView {
  /** The project's card. */
  readonly id: string;
  /** Its name, as the card holds it. */
  readonly name: string;
  readonly folders: readonly { readonly folder: string; readonly via: string }[];
}

export type JoinOutcome =
  | {
      readonly ok: true;
      readonly folder: string;
      readonly project: ProjectView;
      /** False when the folder already belonged to it. */
      readonly changed: boolean;
      /** The project it left, when it belonged to another. */
      readonly left: string | null;
      /** The card was made for this join (not found by name). */
      readonly born: boolean;
    }
  | { readonly ok: false; readonly reason: JoinRefusal; readonly detail: string };

export type JoinRefusal =
  | "folder-not-a-directory"
  | "project-empty"
  | "same-folder"
  | "name-names-a-person"
  | "name-ambiguous"
  | "card-refused";

/** Subject kinds a project card may be found as by name: never a person or me. */
const REUSABLE: ReadonlySet<string | null> = new Set([null, "project", "place", "topic"]);

/** Every project that has a folder row, by name, each folder with who joined it. */
export function listProjects(store: Store): ProjectView[] {
  const byProject = new Map<string, { folder: string; via: string }[]>();
  for (const r of store.folderProjects()) {
    const held = byProject.get(r.project_id) ?? [];
    held.push({ folder: r.folder, via: r.via });
    byProject.set(r.project_id, held);
  }
  return [...byProject.entries()]
    .map(([id, folders]) => ({ id, name: cardName(store, id), folders }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}

/** One project's view, or null when no folder belongs to it. */
export function projectView(store: Store, id: string): ProjectView | null {
  const folders = store.folderProjects().filter((r) => r.project_id === id);
  if (folders.length === 0) return null;
  return { id, name: cardName(store, id), folders: folders.map((r) => ({ folder: r.folder, via: r.via })) };
}

/** The project `folder` belongs to, or null when it is its own (no row). */
export function projectOf(store: Store, folder: string): ProjectView | null {
  const row = store.projectOfFolder(projectFolder(folder));
  return row === null ? null : projectView(store, row.project_id);
}

function cardName(store: Store, id: string): string {
  const row = store.row(id);
  if (row === undefined) return id;
  try {
    const name = store.readProse(id).meta["name"];
    if (typeof name === "string" && name.trim().length > 0) return name.trim();
  } catch {
    /* the title, below */
  }
  return row.title ?? id;
}

/**
 * JOIN `folder` TO `project` — a project's name, or another folder, whose
 * project it joins (that folder becomes the project's first, `via: default`,
 * when it was its own). The card is found by name — a live card that is not a
 * person or me, marked a project from now on — or made, as a card is born by
 * mention (`Schemas#mention`), so the alias index holds its name.
 */
export function joinProject(
  store: Store,
  schemas: Schemas,
  input: { readonly folder: string; readonly project: string; readonly by: Exclude<ProjectVia, "default"> },
): JoinOutcome {
  const folder = projectFolder(input.folder);
  if (!isDirectoryScope(folder)) {
    return { ok: false, reason: "folder-not-a-directory", detail: `"${input.folder}" is not a folder (an absolute path).` };
  }
  const named = input.project.trim();
  if (named.length === 0) return { ok: false, reason: "project-empty", detail: "Name a project, or a folder whose project this one joins." };
  let projectId: string;
  let born = false;
  if (isDirectoryScope(named)) {
    const anchor = projectFolder(named);
    if (anchor === folder) return { ok: false, reason: "same-folder", detail: `${folder} is already its own project.` };
    const row = store.projectOfFolder(anchor);
    if (row !== null) {
      projectId = row.project_id;
    } else {
      const card = projectCard(store, schemas, basename(anchor));
      if (!card.ok) return card;
      projectId = card.id;
      born = card.born;
      store.setFolderProject(anchor, projectId, "default");
    }
  } else {
    const card = projectCard(store, schemas, named);
    if (!card.ok) return card;
    projectId = card.id;
    born = card.born;
  }
  const before = store.projectOfFolder(folder);
  const changed = before?.project_id !== projectId;
  if (changed) store.setFolderProject(folder, projectId, input.by);
  const project = projectView(store, projectId) as ProjectView;
  return { ok: true, folder, project, changed, left: changed && before !== null ? before.project_id : null, born };
}

/** `folder` is its own project again. False when it belonged to none. */
export function leaveProject(store: Store, folder: string): { readonly left: string | null; readonly folder: string } {
  const key = projectFolder(folder);
  const row = store.projectOfFolder(key);
  if (row === null) return { left: null, folder: key };
  store.clearFolderProject(key);
  return { left: row.project_id, folder: key };
}

/** The project card for `name`: one found (and marked a project), or one born. */
function projectCard(
  store: Store,
  schemas: Schemas,
  name: string,
): { ok: true; id: string; born: boolean } | { ok: false; reason: JoinRefusal; detail: string } {
  // A project card already, by its name or an alias.
  const holders = schemas
    .aliasIndex()
    .lookup(name)
    .filter((id) => {
      const row = store.row(id);
      return row !== undefined && row.archived === 0 && row.type === "schema";
    });
  if (holders.length > 1) {
    const projects = holders.filter((id) => store.row(id)?.subject_kind === "project");
    if (projects.length === 1) return { ok: true, id: projects[0] as string, born: false };
    return { ok: false, reason: "name-ambiguous", detail: `"${name}" names ${String(holders.length)} cards (${holders.join(", ")}); name the project another way.` };
  }
  const hit = holders[0];
  if (hit !== undefined) {
    const row = store.row(hit);
    const kind = row?.subject_kind ?? null;
    if (row?.kind === "self" || row?.kind === "person" || !REUSABLE.has(kind)) {
      return { ok: false, reason: "name-names-a-person", detail: `"${name}" is ${hit}, a card for ${kind ?? row?.kind ?? "someone"}; name the project another way.` };
    }
    if (kind !== "project") store.setSubjectKind(hit, "project");
    return { ok: true, id: hit, born: false };
  }
  const out = schemas.mention({ name, kind: "entity", source: name, chunkRef: `project:${name}`, day: store.livedDay() });
  if (!out.ok || out.id === null) {
    return { ok: false, reason: "card-refused", detail: `No card could be made for "${name}" (${out.reason}${out.collidedWith.length > 0 ? `: ${out.collidedWith.join(", ")}` : ""}).` };
  }
  store.setSubjectKind(out.id, "project");
  return { ok: true, id: out.id, born: out.born };
}
