/**
 * `doctor`'s line on who can read the store (2026-10-27, R1): amber when the
 * store, its database, our entries in the base directory beside it (and the
 * base itself when it is ours) or ours in the snapshots directory is readable
 * by group or other, with the two commands that close
 * it. A handful of `stat` calls, no store read, never red: the store opens
 * either way, and a writer's open tightens it by itself (`core/store/private.ts`),
 * so a line that stays amber is a filesystem that does not keep modes or a
 * store nothing has written to since this version came.
 */
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

import { DATABASE_FILE, OPEN_BITS, realRoot, storeRoots } from "../../core/store/index.js";
import { configuredSnapshots, installBaseRoots } from "../private-base.js";
import { finding } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

function modeOf(path: string): number | null {
  try {
    const st = lstatSync(path);
    // A link is never chmodded through (`core/store/private.ts`), so never graded either.
    return st.isSymbolicLink() ? null : st.mode & 0o777;
  } catch {
    return null;
  }
}

/**
 * The paths the line reads, each with the mode it should have at most: exactly
 * the roots a session start (or `connect`) and a writer's open tighten
 * (`private-base.ts#installBaseRoots`, `core/store/private.ts#storeRoots`), a
 * configured snapshots directory outside the base included, plus the database.
 * Each root by itself: a tree is read at its top, as the gate reads it.
 */
export function privatePaths(storeDir: string, configPath?: string, home?: string): { path: string; dir: boolean }[] {
  const store = realRoot(storeDir);
  // The base only when this IS an install's layout (`private-base.ts`), the
  // configuration sitting in it: a dir that is merely named `store` says nothing.
  const roots =
    (configPath === undefined ? null : installBaseRoots(configPath, storeDir, home)) ??
    storeRoots(storeDir, configPath === undefined ? null : (configuredSnapshots(configPath) ?? null), home);
  const out: { path: string; dir: boolean }[] = [];
  const seen = new Set<string>();
  const add = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ path, dir: isDir(path) });
  };
  add(store);
  out.push({ path: join(store, DATABASE_FILE), dir: false });
  for (const p of [...(roots.only ?? []), ...roots.recursive]) add(p);
  return out;
}

function isDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function modesFindings(storeDir: string, platform: string = process.platform, configPath?: string, home?: string): Finding[] {
  if (platform === "win32") return [];
  const paths = privatePaths(storeDir, configPath, home).filter((p) => existsSync(p.path));
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
      `Run: ${fix} — the next Claude Code session (or counterparts connect) does the same, the whole store included. ` +
        "A filesystem that does not keep modes (exFAT, some network drives) reads this way and cannot be tightened.",
      data,
    ),
  ];
}
