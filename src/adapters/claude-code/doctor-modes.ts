/**
 * `doctor`'s line on who can read the store (2026-10-27, R1): amber when the
 * store, its database, the base directory beside it or the snapshots
 * directory is readable by group or other, with the two commands that close
 * it. A handful of `stat` calls, no store read, never red: the store opens
 * either way, and a writer's open tightens it by itself (`core/store/private.ts`),
 * so a line that stays amber is a filesystem that does not keep modes or a
 * store nothing has written to since this version came.
 */
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { DATABASE_FILE, DEFAULT_STORE_SUBDIR, OPEN_BITS, SNAPSHOTS_DIR_NAME } from "../../core/store/index.js";
import { finding } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

function modeOf(path: string): number | null {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

/** The paths the line reads, each with the mode it should have at most. */
export function privatePaths(storeDir: string): { path: string; dir: boolean }[] {
  const store = resolve(storeDir);
  const out: { path: string; dir: boolean }[] = [];
  if (basename(store) === DEFAULT_STORE_SUBDIR) out.push({ path: dirname(store), dir: true });
  out.push({ path: store, dir: true }, { path: join(store, DATABASE_FILE), dir: false });
  if (basename(store) === DEFAULT_STORE_SUBDIR) out.push({ path: join(dirname(store), SNAPSHOTS_DIR_NAME), dir: true });
  return out;
}

export function modesFindings(storeDir: string, platform: string = process.platform): Finding[] {
  if (platform === "win32") return [];
  const paths = privatePaths(storeDir).filter((p) => existsSync(p.path));
  if (paths.length === 0) return [];
  const open = paths
    .map((p) => ({ ...p, mode: modeOf(p.path) }))
    .filter((p): p is { path: string; dir: boolean; mode: number } => p.mode !== null && (p.mode & OPEN_BITS) !== 0);
  const data = { open: open.map((p) => `${p.path}:${p.mode.toString(8)}`).join(",") };
  if (open.length === 0) {
    return [finding("modes", "green", "Privacy", "the store is readable by you alone (directories 700, database 600)", "", data)];
  }
  const dirs = open.filter((p) => p.dir).map((p) => `"${p.path}"`);
  const files = open.filter((p) => !p.dir).map((p) => `"${p.path}"`);
  const fix = [
    ...(dirs.length === 0 ? [] : [`chmod 700 ${dirs.join(" ")}`]),
    ...(files.length === 0 ? [] : [`chmod 600 ${files.join(" ")}*`]),
  ].join(" && ");
  return [
    finding(
      "modes",
      "amber",
      "Privacy",
      `readable by other accounts on this machine: ${open.map((p) => `${p.path} (${p.mode.toString(8)})`).join(", ")}`,
      `Run: ${fix} — the next session that writes does the same, the whole store included. ` +
        "A filesystem that does not keep modes (exFAT, some network drives) reads this way and cannot be tightened.",
      data,
    ),
  ];
}
