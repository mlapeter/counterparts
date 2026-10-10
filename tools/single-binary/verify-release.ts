/**
 * CHECK A PUBLISHED RELEASE AGAINST THE CHECKSUMS THE PLUGIN CARRIES
 * (docs/single-binary.md, "Releasing").
 *
 *   ~/.bun/bin/bun tools/single-binary/verify-release.ts [--url <base>]
 *
 * Reads `.claude-plugin/binaries.json`, downloads every platform's asset from
 * its release URL (or `--url`, for a dry run against a local server), and
 * checks it the way `plugin-run.sh` will: the compressed file's sha256, then
 * the unpacked program's. Exit 0 only when every platform matches — run it
 * after uploading the assets and before announcing the release.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const REPO = resolve(import.meta.dir, "../..");
const manifest = JSON.parse(readFileSync(join(REPO, ".claude-plugin", "binaries.json"), "utf8")) as {
  version: string;
  url: string;
  platforms: Record<string, { file: string; bytes: number; sha256: string; gzBytes: number; gzSha256: string }>;
};
const i = process.argv.indexOf("--url");
const base = (i >= 0 ? (process.argv[i + 1] ?? "") : manifest.url).replace(/\/$/, "");
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

let bad = 0;
process.stdout.write(`counterparts ${manifest.version}, from ${base}\n`);
for (const [platform, p] of Object.entries(manifest.platforms)) {
  try {
    const res = await fetch(`${base}/${p.file}`);
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    const gz = new Uint8Array(await res.arrayBuffer());
    if (sha(gz) !== p.gzSha256) throw new Error("the download does not match gzSha256");
    const raw = gunzipSync(gz);
    if (raw.length !== p.bytes || sha(raw) !== p.sha256) throw new Error("the unpacked program does not match sha256");
    process.stdout.write(`ok    ${platform}  ${p.file}  ${(gz.length / 1048576).toFixed(1)} MiB\n`);
  } catch (err) {
    bad += 1;
    process.stdout.write(`FAIL  ${platform}  ${p.file}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
process.exit(bad === 0 ? 0 : 1);
