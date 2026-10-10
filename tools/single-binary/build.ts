/**
 * BUILD THE SINGLE BINARY — docs/single-binary.md.
 *
 *   ~/.bun/bin/bun tools/single-binary/build.ts                 this machine's platform (development, CI)
 *   ~/.bun/bin/bun tools/single-binary/build.ts --release       the four RELEASED, signed, gzipped, and
 *                                                               .claude-plugin/binaries.json written
 *   … --target darwin-arm64,linux-x64                           named platforms
 *   … --no-bytecode                                             plain JS in the binary (slower start)
 *
 * What it does, in order:
 *
 * 1. **Stages** every file the running code reads from its own install —
 *    package.json (the version), the model table's package, the dashboard's
 *    page and static modules, and the licences that travel with vendored
 *    code — into `dist/single-binary/stage/`, mirroring the repository, and
 *    writes `assets.gen.ts`: one `import … with { type: "file" }` per staged
 *    file. With `--root <stage>` Bun embeds each at its repository-relative
 *    path under the binary's virtual root, which is where
 *    `adapters/runtime.ts#packagePath` looks. The copy is not ceremony: a file
 *    that is ALSO imported as code (`web/shared/dates.js`, by `narrate.ts`)
 *    cannot be imported as a file from the same path (Bun keeps one loader per
 *    path). The stage path is FIXED, so the binary's bytes do not depend on
 *    where the output goes (the bundle carries the staged paths as comments).
 * 2. **Compiles** `main.ts` per platform with `--bytecode` and the runtime's
 *    working-directory autoloads OFF: a hook runs in the person's project, and
 *    a compiled Bun binary would otherwise read that project's `.env` and
 *    `bunfig.toml` into itself.
 * 3. **Re-signs macOS ad-hoc** (`codesign --remove-signature`, then
 *    `--sign -`): Bun's arm64 output is linker-signed and fails a strict
 *    verify, and a cross-built x64 carries Bun's own Developer ID signature,
 *    broken by the payload. Needs macOS; `--release` refuses elsewhere.
 * 4. **Checks** the binary this machine can run: `<binary> selfcheck`.
 * 5. **Gzips** each, writes `SHA256SUMS`, and with `--release` writes
 *    `.claude-plugin/binaries.json` — the checksums `plugin-run.sh` verifies a
 *    download against, committed in the release commit (one platform per line,
 *    `"key": value`, because the launcher reads it with shell built-ins).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const REPO = resolve(import.meta.dir, "../..");
const HERE = import.meta.dir;
const STAGE = join(REPO, "dist", "single-binary", "stage");

/** The five platforms CI builds, and the Bun target each is built with.
 *  linux-x64 is `-baseline` (no AVX2 needed: pre-2013 CPUs, some VMs); it is
 *  the same size. */
export const PLATFORMS: Readonly<Record<string, string>> = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64-baseline",
  "linux-arm64": "bun-linux-arm64",
  "windows-x64": "bun-windows-x64",
};

/** The platforms a release ships: what `--release` builds and binaries.json
 *  offers. Not Windows yet: CI builds it, but its binary has not yet run
 *  through `plugin-run.sh` under Git Bash, so the plugin keeps telling a
 *  Windows computer with no runtime to install one. */
export const RELEASED: readonly string[] = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];

/** Where a release's assets are downloaded from, `/v<version>` appended. */
export const RELEASE_URL = "https://github.com/mlapeter/counterparts/releases/download";

/** This machine's platform, in the names above (macOS arm64 even under Rosetta). */
export function hostPlatform(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return "windows-x64";
  return `linux-${arch}`;
}

/** The asset a platform ships as. */
export function assetName(version: string, platform: string): string {
  return `counterparts-${version}-${platform}${platform.startsWith("windows") ? ".exe" : ""}.gz`;
}

/** Every file the code reads from its own install at run time. */
export function embeddedFiles(): string[] {
  const out: string[] = ["package.json"];
  const model = "node_modules/counterparts-model-potion";
  for (const f of ["model.safetensors", "vocab.txt", "package.json", "LICENSE"]) out.push(`${model}/${f}`);
  const web = "src/adapters/dashboard/web";
  out.push(`${web}/app.html`, `${web}/app.js`);
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(REPO, dir)).sort()) {
      const rel = `${dir}/${name}`;
      if (statSync(join(REPO, rel)).isDirectory()) walk(rel);
      else if (/\.(js|css|woff2|txt)$/.test(name)) out.push(rel);
    }
  };
  for (const d of ["shared", "shell", "pages", "mechanisms"]) walk(`${web}/${d}`);
  return out;
}

function stageAndWriteManifest(files: readonly string[]): void {
  rmSync(STAGE, { recursive: true, force: true });
  for (const f of files) {
    mkdirSync(dirname(join(STAGE, f)), { recursive: true });
    copyFileSync(join(REPO, f), join(STAGE, f));
  }
  const lines = [
    "// @ts-nocheck — data imports, not code; typechecking them is noise.",
    "// GENERATED by tools/single-binary/build.ts — do not edit, not committed.",
    "// Each import embeds one file in the compiled binary (`with { type: \"file\" }`).",
    ...files.map((f, i) => `import f${String(i)} from ${JSON.stringify(relative(HERE, join(STAGE, f)))} with { type: "file" };`),
    `export const EMBEDDED: readonly string[] = [${files.map((_, i) => `f${String(i)}`).join(", ")}];`,
    "",
  ];
  writeFileSync(join(HERE, "assets.gen.ts"), lines.join("\n"));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(cmd: string, args: readonly string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, [...args], { cwd: REPO, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

export interface Built {
  readonly platform: string;
  readonly file: string;
  readonly asset: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly gzBytes: number;
  readonly gzSha256: string;
}

/** `.claude-plugin/binaries.json`: one platform per line, `"key": value` with
 *  one space — `plugin-run.sh` reads it with shell parameter expansion. */
export function binariesJson(version: string, built: readonly Built[]): string {
  const rows = built.map(
    (b, i) =>
      `    ${JSON.stringify(b.platform)}: { "file": ${JSON.stringify(b.asset)}, "bytes": ${String(b.bytes)}, "sha256": "${b.sha256}", "gzBytes": ${String(b.gzBytes)}, "gzSha256": "${b.gzSha256}" }${i === built.length - 1 ? "" : ","}`,
  );
  return [
    "{",
    `  "version": ${JSON.stringify(version)},`,
    `  "url": ${JSON.stringify(`${RELEASE_URL}/v${version}`)},`,
    '  "platforms": {',
    ...rows,
    "  }",
    "}",
    "",
  ].join("\n");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const release = process.argv.includes("--release");
  const bytecode = !process.argv.includes("--no-bytecode");
  const named = arg("--target");
  const platforms = release ? [...RELEASED] : named === "all" ? Object.keys(PLATFORMS) : (named ?? hostPlatform()).split(",");
  for (const p of platforms) {
    if (PLATFORMS[p] === undefined) throw new Error(`unknown platform ${p}; one of ${Object.keys(PLATFORMS).join(", ")}`);
  }
  const signDarwin = process.platform === "darwin";
  if (release && !signDarwin) {
    throw new Error("--release signs the macOS binaries with codesign, so it runs on macOS.");
  }
  const version = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version: string }).version;
  const outDir = resolve(REPO, arg("--out") ?? join("dist", "single-binary", version));
  mkdirSync(outDir, { recursive: true });

  const files = embeddedFiles();
  stageAndWriteManifest(files);
  process.stdout.write(`counterparts ${version}: embedding ${String(files.length)} files${bytecode ? ", bytecode" : ""}\n`);

  const built: Built[] = [];
  let failed = false;
  for (const platform of platforms) {
    const target = PLATFORMS[platform] as string;
    const name = `counterparts-${version}-${platform}${platform.startsWith("windows") ? ".exe" : ""}`;
    const file = join(outDir, name);
    const t0 = performance.now();
    const compiled = run(process.execPath, [
      "build",
      "--compile",
      `--target=${target}`,
      `--root=${STAGE}`,
      "--asset-naming=[dir]/[name].[ext]",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      ...(bytecode ? ["--bytecode", "--format=esm"] : []),
      `--outfile=${file}`,
      join(HERE, "main.ts"),
    ]);
    if (!compiled.ok) {
      process.stdout.write(`${platform}: BUILD FAILED\n${compiled.out}\n`);
      failed = true;
      continue;
    }
    if (platform.startsWith("darwin")) {
      if (signDarwin) {
        const unsigned = run("codesign", ["--remove-signature", file]);
        const signed = unsigned.ok ? run("codesign", ["--force", "--sign", "-", file]) : unsigned;
        const verified = signed.ok ? run("codesign", ["--verify", "--strict", file]) : signed;
        if (!verified.ok) {
          process.stdout.write(`${platform}: SIGNING FAILED\n${verified.out}\n`);
          failed = true;
          continue;
        }
      } else {
        process.stdout.write(`${platform}: not re-signed (codesign needs macOS); fine for a test build, never for a release\n`);
      }
    }
    if (platform === hostPlatform()) {
      const check = run(file, ["selfcheck"]);
      if (!check.ok) {
        process.stdout.write(`${platform}: SELFCHECK FAILED\n${check.out}\n`);
        failed = true;
        continue;
      }
    }
    const bytes = readFileSync(file);
    const gz = gzipSync(bytes, { level: 9 });
    const asset = assetName(version, platform);
    writeFileSync(join(outDir, asset), gz);
    built.push({ platform, file: name, asset, bytes: bytes.length, sha256: sha256(bytes), gzBytes: gz.length, gzSha256: sha256(gz) });
    const mib = (n: number): string => (n / 1024 / 1024).toFixed(1);
    process.stdout.write(
      `${platform}: ${mib(bytes.length)} MiB, ${mib(gz.length)} MiB gzipped, ${String(Math.round(performance.now() - t0))} ms${platform === hostPlatform() ? ", selfcheck ok" : ""} -> ${relative(REPO, file)}\n`,
    );
  }
  writeFileSync(
    join(outDir, "SHA256SUMS"),
    `${built.flatMap((b) => [`${b.sha256}  ${b.file}`, `${b.gzSha256}  ${b.asset}`]).join("\n")}\n`,
  );
  if (failed) process.exit(1);
  if (release) {
    const manifest = join(REPO, ".claude-plugin", "binaries.json");
    writeFileSync(manifest, binariesJson(version, built));
    process.stdout.write(`wrote ${relative(REPO, manifest)} — commit it in the release commit (docs/single-binary.md)\n`);
  }
}
