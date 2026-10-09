# Single-binary spike — 2026-10-09

**Question.** Can all of Counterparts compile into one self-contained executable
with `bun build --compile`, so the Claude Code plugin works when the machine has
neither Bun nor Node? (The download path in `plugin-run.sh` is out of scope; this
spike decides whether there is a binary worth downloading.)

**Verdict: GO.** One binary per platform runs every mode the plugin uses, from a
PATH with no Bun and no Node on it, against a temp store: install, a SessionStart
wake, UserPromptSubmit, the worker it spawns of itself, the MCP server (note,
recall, recall by meaning), doctor, the dashboard, and the nightly mode. It
passes 21 of 21 smoke checks on macOS arm64 (plain and `--bytecode`) and on
Linux arm64, which ran in Docker with `--network none`. `src/` needed about 120
changed lines across 15 files. No change was needed to the store, the sleep cycle
or any brain module. The only `core/` change is one option on
`resolveStaticWeights`.

The two things to decide before building it for real are **size** (50–68 MiB
gzipped per platform, 27 MiB of it the model) and **macOS signing** (details
below). Neither one stops the plan.

Builds were made with Bun 1.3.10 on an M3 Pro running macOS 14.1.1, with
`counterparts` 0.3.13 at master 23aa4f85.

---

## What works, what needed a change, what is blocked

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Four entries → one binary, dispatching on a first argument | **works with a change** | `tools/single-binary/main.ts` dispatches `hook \| mcp \| cli \| dashboard \| runner \| nightly` (plus `selfcheck`). All 362 modules bundle cleanly. The `.mjs` shims and `node-hooks.mjs` are not used: the build compiles the TS sources directly. |
| 2 | `bun:sqlite` inside the binary | **works, no change** | `cli install` creates and migrates the store. `note` writes through the MCP server. Doctor reports "Store open" green, with journal mode `wal` and a 5000 ms busy timeout. On macOS, `bun:sqlite` uses the system libsqlite3 (3.39.5 on 14.1), which is also what today's `bun` uses, so nothing new. |
| 3 | The model package (29 MB) | **works with a change** | The table is embedded with `import … with { type: "file" }`. `require.resolve` cannot see embedded `node_modules` (measured), so the three callers pass the directory in. Recall by meaning works from the binary: "which coffee maker do we own?" shares no word with the note and still finds "The espresso machine … Rancilio Silvia" (`semantic: in-line`). **Control:** with the table pointed at an empty folder, the same question finds nothing (`semantic: embed-failed`). Doctor: "Recall by meaning: on — a local table (weights from the counterparts-model-potion package)". |
| 4 | Self-spawning | **works with a change** | `scriptArgs()` returns `[mode]` when compiled, so the binary spawns `<binary> runner`. In the smoke test, Stop and SessionEnd each started a worker that logged `proc:"worker"` … `process.end reason:"ran"` (sleep cycle ran, briefing rendered). The same function builds the night run's `--mcp-config` (`<binary> mcp`), the plugin's first-run `spawnSync` (`<binary> cli install --no-connect`), and the commands `install` prints (`"<binary>" hook --config …`, `claude mcp add … -- "<binary>" mcp`). Not run end to end: the night run's `claude -p` (that needs Claude Code), and the plugin first run (the explicit-dir guard skips it by design; it uses the same `scriptArgs` path as the worker). |
| 5 | Dashboard static files, three.js | **works with a change** | Served from inside the binary: page 200, `app.js` 200, `shared/vendor/three.module.min.js` 200 (687,458 B), a `.woff2` font 200, `/api/overview` 200. |
| 6 | Measurements | **done** | See sizes and cold start below. All 5 targets cross-compile from one Mac in 1–2 s each. |
| 7 | End-to-end smoke test, hermetic | **works** | `tools/single-binary/smoke.sh`: 21/21 on darwin-arm64 (plain and bytecode), 21/21 on linux-arm64 in Docker `--network none`. |
| + | Knowing it is the plugin | **works with a change** | `runningAsPlugin` compares `CLAUDE_PLUGIN_ROOT` with a package root on disk that the binary doesn't have. With the change: a binary under `CLAUDE_PLUGIN_DATA` with a live npm hook in settings **stands down** ("installed twice" `systemMessage`). The same binary outside the data dir runs normally. Inside the data dir with no npm wiring it runs in plugin mode ("plugin first run skipped: configuration named"). |
| — | darwin-x64, linux-x64, windows-x64 | **built, not run** | All three compile. darwin-x64 **cannot be checked on Apple Silicon**: even a one-line `console.log` compiled for `bun-darwin-x64` or `-baseline` dies with SIGILL under Rosetta 2 on macOS 14.1, so it is Bun-under-Rosetta, not Counterparts. linux-x64 and windows-x64 need native runners. |

## Why each change was needed

1. **Every module shares one `import.meta.url` in the binary**
   (`file:///$bunfs/root/<binary name>`), and `process.argv[1]` equals it. So
   every `isEntryPoint(argv[1], import.meta.url)` guard is true at once. A
   dispatcher that imported `nightly.ts` would also run `runner.ts`'s `main()`,
   because `nightly.ts` imports `runner.ts`. Fix: `isEntryPoint` returns false
   when compiled, each entry exports `start()` (its old guard body, unchanged),
   and the dispatcher calls the one it chose after splicing the mode out of
   `argv`.
2. **Paths from `import.meta.url` stop meaning "this file's directory".** The
   files the build embeds sit under the virtual root at their repo-relative
   paths. That holds because of `--root <stage> --asset-naming
   '[dir]/[name].[ext]'`. A new `packagePath(rel)` resolves on disk from source
   and in the virtual root when compiled.
3. **Two quirks of Bun's bundler shaped the build** (measured on 1.3.10):
   - A file imported as code can't also be imported as a file from the same
     path, because Bun keeps one loader per path. `web/shared/dates.js` is both a
     browser module and imported by `narrate.ts`. So the build copies the
     embedded files into a stage that mirrors the repo, and the manifest imports
     the copies.
   - A file at the top of the root embeds as `/$bunfs/root/./package.json`, the
     virtual filesystem matches names exactly, and `packagePath` encodes that.
     `<binary> selfcheck` checks the rule on every build.
4. **Per-process cwd autoloads are switched off.** A compiled Bun binary reads
   `.env` and `bunfig.toml` from the working directory by default, and hooks run
   in the person's project. The build passes `--no-compile-autoload-dotenv
   --no-compile-autoload-bunfig`. Measured: with the flag the binary ignores a
   project `.env`; without it, it reads it.

## Code changes (this branch, `spike/single-binary`)

`src/` (about 120 lines across 15 files):

- `src/adapters/runtime.ts:38` `COMPILED_ROOT`, `:41` `isCompiled()`, `:47`
  `packagePath()`, `:57` `bundledModelDir()`, `:63` `COMPILED_MODES` (entry file
  name → mode), `:103` `scriptArgs()` returns `[mode]` when compiled and `exe`
  is the binary.
- Entry guards plus `start()`:
  - `claude-code/bin/hook.ts:1228,1234`
  - `mcp/bin/serve.ts:506,512`
  - `cli/bin/counterparts.ts:106,112`
  - `dashboard/bin/dashboard.ts:472,478` (async, because it had a top-level
    `await`)
  - `claude-code/bin/runner.ts:549,649`
  - `claude-code/bin/nightly.ts:90` (uses `runner.ts`'s guard)
- Model: `core/embed/static.ts:422,430` adds a `packageDir` option. The callers
  pass `bundledModelDir()`: `claude-code/embed-client.ts:205`,
  `claude-code/doctor.ts:1231` and `cli/commands.ts:3851`.
- Version: `cli/commands.ts:546` and `sessions.ts:966` read
  `packagePath("package.json")`.
- Dashboard root: `dashboard/web/server.ts:107` uses
  `packagePath("src/adapters/dashboard/web")`.
- Log: `log/index.ts:182` builds `SRC_ROOT` from `packagePath("src")`.
- Plugin: `plugin.ts:91` — when compiled, "this very copy" means the binary
  sits under `CLAUDE_PLUGIN_DATA`.

New, outside `src/` (none of it ships in the npm package):

- `tools/single-binary/main.ts`: the dispatcher and `selfcheck`.
- `tools/single-binary/build.ts`: stages the files, generates the manifest,
  compiles per target, gzips, writes `SHA256SUMS`.
- `tools/single-binary/smoke.sh`: the hermetic end-to-end test. It runs only the
  binary, under `env -i` with a clean PATH, a temp HOME and
  `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`.
- `tools/single-binary/coldstart.ts`: the timing harness.
- `.gitignore`: `dist/` and the generated `tools/single-binary/assets.gen.ts`.

Tests:

- `tsc --noEmit` is clean, with or without a generated manifest present.
- Full `bun test`: 5331 pass, 0 fail, 5 skip.
- `bun run test:node` (Node 22.23): 7/7.
- After the last import tidy-up, the targeted suites were rerun (runtime,
  plugin, dashboard-web, static-*, install-loop): 255/0.

### Still owed before a real build (not done in the spike)

- **`parseScriptInvocation` (`runtime.ts:124`) cannot read the binary's own
  command shape** (`"<binary>" hook`). Its readers are `install.ts:723`,
  `host-wiring.ts:84,152,193` (the plugin's "npm wiring is live" detector),
  `wire.ts` (`isOurHookCommand`, the `connect`/`disconnect` matcher) and
  doctor's runtime line. In the plugin flow the binary never writes settings, so
  nothing breaks. But `<binary> cli connect` would write hooks that
  `disconnect`, doctor and the plugin gate don't recognize. Either teach
  `parseScriptInvocation` the `<exe> <mode>` shape, or have the binary refuse
  `connect`. Recommendation: refuse for now, because the binary is the plugin's
  runtime.
- **"Version on disk" means something else in the binary.**
  `manifestVersionOnDisk()` (`sessions.ts:966`) now reads the binary's own
  embedded `package.json`, so Claude Desktop's "Counterparts was updated" notice
  can't fire from a binary-launched server. For the plugin this is the same as
  today: each plugin version runs its own binary, and an open MCP server keeps
  the code it started with. It needs a sentence in the contract.
- **Unit tests for the compiled branches.** `COMPILED_ROOT` is a module
  constant, so `scriptArgs`' compiled branch and `runningAsPlugin`'s can only be
  tested in a built binary. Either make the root injectable, or run `smoke.sh`
  in CI on each platform (recommended either way).
- **Error locations in the process log.** `errorFields().where` will name
  `/$bunfs/root/<binary>:<line>` (the bundle), not a source file. Options are
  `--sourcemap` (size not measured) or accepting it.
- **Windows code paths are untested.** The `B:\~BUN\root` pattern, the `./`
  naming quirk, the `${data}/` prefix test in `plugin.ts:91` (should use
  `path.relative`/`sep`), and whether `plugin-run.sh` runs at all on Windows.

## Measurements

### Size per target (`counterparts` 0.3.13, 133 embedded files)

| target | binary raw | binary gz -9 | Bun runtime alone, raw / gz |
|---|---|---|---|
| darwin-arm64 | 91.2 MiB | 50.1 MiB | 58 / 21 MiB |
| darwin-x64 | 95.7 MiB | 51.7 MiB | 62 / 23 MiB |
| linux-x64 | 131.9 MiB | 66.2 MiB | 99 / 37 MiB |
| linux-arm64 | 129.5 MiB | 66.2 MiB | 96 / 36 MiB |
| windows-x64 | 142.2 MiB | 68.3 MiB | 109 / 39 MiB |
| darwin-arm64 `--bytecode` | 104.6 MiB | 54.1 MiB | |

- **The model is 28.8 MiB raw and 26.9 MiB gzipped.** f32 weights barely
  compress (xz is no better: 26.6 MiB).
- **The rest is small:** the JS bundle is 2.7 MB, and the dashboard plus
  package.json is about 2 MB.
- **The `-baseline` x64 targets are the same size** (linux-x64-baseline is 131.5
  MiB).

### Cold start of `hook` mode

Wall time, spawn to exit. 25 interleaved runs each, 3 warm-ups discarded. Same
temp store with 40 notes, same config, same payload. M3 Pro.

| launcher | UserPromptSubmit median / p95 | SessionStart median / p95 |
|---|---|---|
| `bun run hook.ts` (the npm install's hook command) | 122 / 130 ms | 194 / 224 ms |
| `bun hook.mjs` (what `plugin-run.sh` runs today) | 102 / 112 ms | 176 / 188 ms |
| `node` 22.23 `--import node-hooks.mjs hook.ts` | 221 / 242 ms | 298 / 325 ms |
| **binary** | **116 / 125 ms** | **123 / 134 ms** |
| **binary `--bytecode`** | **86 / 92 ms** | **90 / 98 ms** |

- **The binary is within about 10–15 ms of today's Bun launch, and the bytecode
  build beats every launcher** (about 20 ms under `bun hook.mjs`), for +13 MiB
  raw / +4 MiB gz. The bytecode build passed the same 21/21 smoke test.
- **SessionStart from source is slower for reasons that have nothing to do with
  the binary.** Measured with the hook's own `process.end`, 12 runs each: 71 ms
  of in-process work from a checkout vs. 18 ms in the binary. So about 53 ms is
  work only a checkout does, probably the git checkout grade (which step was not
  isolated). Compare the UserPromptSubmit column instead.
- **Bare startup** (`--version`): 63 ms for `bun counterparts.mjs`, 65 ms for
  the binary, 40 ms for bytecode.
- **The hook's own in-process work is about 9 ms** (`process.end` in its log).
  The rest is runtime start, parsing the 2.7 MB bundle (bytecode skips this),
  and loading the 30 MB table.
- **Where the model lives doesn't change hook time** (interleaved, 25 runs):
  binary with the model embedded 110 ms vs. read from a folder beside it 109 ms;
  bytecode 81 vs. 80 ms. So whether to embed it or ship it beside the binary is
  a download-size question, not a speed question.

### Reproducibility

Building twice with the same Bun, the same sources and the same `--out` gives
byte-identical binaries. Only repo-relative paths get into the bundle: the stage
directory appears as `// dist/<out>/stage/...` comments, and no absolute paths.
So CI can rebuild to check a published checksum.

## Risks

- **macOS code signing — must be handled in the release step.**
  - Bun's darwin-arm64 output is ad-hoc and linker-signed. It runs, but
    `codesign --verify --strict` reports "invalid signature (code or signature
    have been modified)" because of the appended payload.
  - The cross-built **darwin-x64 keeps Bun's own Developer ID signature, now
    broken**.
  - `codesign --remove-signature` followed by `codesign --force --sign -`
    (ad-hoc) gives a binary that verifies and runs. That step needs macOS, or
    `rcodesign` on Linux.
- **Gatekeeper and quarantine.**
  - Measured: files fetched with `curl` (and Python's urllib) carry no
    `com.apple.quarantine` attribute, so a binary that `plugin-run.sh`
    downloads with curl is never assessed by Gatekeeper. Only the kernel's
    signature check applies, and an ad-hoc signature passes it on arm64.
  - `spctl --assess` **rejects** the ad-hoc binary. So if a person ever
    downloads it **in a browser**, macOS will refuse to open it. That only
    matters if we offer browser downloads, in which case it needs a Developer ID
    signature plus notarization (an Apple developer account, about $99/yr).
- **Apple Silicon under Rosetta.** No Bun x64 binary runs under Rosetta 2 here,
  so `plugin-run.sh` must never pick darwin-x64 on Apple Silicon. Beware:
  `uname -m` says `x86_64` in a shell that was itself started under Rosetta.
  Check `sysctl -n hw.optional.arm64` instead.
- **x64 CPU floor.** Bun's default x64 targets assume AVX2 (Haswell, 2013 on).
  The `-baseline` builds cost nothing in size. Recommend baseline for
  linux-x64, at least until there is evidence it is slower.
- **Linux libc.** These are glibc builds, which won't run on Alpine/musl. Bun
  has `-musl` targets if anyone asks.
- **Windows.**
  - The `.exe` is built but untested.
  - It is unsigned, so Defender or EDR may flag a 140 MiB unsigned exe that
    runs from a data directory. (SmartScreen keys on Mark-of-the-Web, which
    curl doesn't set.)
  - The code paths listed above are untested, and so is how Claude Code runs a
    plugin's `sh` hook on Windows.
- **Download size on every update.** Each plugin version would download 50–68
  MiB. The model doesn't change between versions. Shipping it as its own
  release asset, keyed by its sha256 and kept in `CLAUDE_PLUGIN_DATA` across
  versions, makes a routine update 21–39 MiB plus a one-time 27 MiB.
  `COUNTERPARTS_STATIC_WEIGHTS_DIR` already does this today (doctor would then
  say "from the environment"), so it costs no new code path.
- **Pinning Bun.** The binary is whatever Bun the release machine has. The
  `./package.json` naming quirk and the bunfs behavior are version-specific.
  Pin Bun in CI, and let `selfcheck` fail the release if the layout moves.
- **The first session waits on the download.** Claude Code gives a hook 60 s and
  an MCP server 30 s to start. A 50 MiB download on a slow line won't fit, so
  the downloader has to run in the background and say "memory starts next
  session". It also needs a lock, because the hook and the server start
  together. (This is design for the download step, not this spike.)

## Side finding, independent of the binary: today's hooks read the project's `.env`

Measured: `bun run <script>`, the npm install's hook command, run with the
project as cwd, loads that project's `.env`. A compiled binary with default
flags does too. Node and the binary built here don't. A project `.env` that
sets `COUNTERPARTS_DATA_DIR`, `COUNTERPARTS_CONFIG` or
`COUNTERPARTS_STATIC_WEIGHTS_DIR` would therefore redirect today's hooks: the
§2.13 scar, from a direction the spawner's pinning doesn't cover. `bun
--no-env-file run …` fixes it (measured). The fix would go in `scriptArgs`'
Bun shape, `plugin-run.sh`'s `exec`, and the `.mjs` shims' `exec bun`. That
changes the printed hook command, so it needs its own small PR and a doctor
check for old commands.

## A plan for the release step

1. **Build** (GitHub Actions, on the release tag, Bun pinned): run `bun install
   --frozen-lockfile`, then `bun tools/single-binary/build.ts --target
   bun-darwin-arm64,bun-darwin-x64,bun-linux-x64-baseline,bun-linux-arm64,bun-windows-x64
   --bytecode`. That gives five binaries, their `.gz` files and `SHA256SUMS`.
   Because the build is reproducible, a second job can rebuild and compare.
2. **Sign macOS** (macOS runner): ad-hoc re-sign both darwin binaries
   (`--remove-signature`, then `--sign -`). Later, optionally, Developer ID plus
   notarization.
3. **Smoke test on each platform**: a matrix of native runners (macos-14 arm64,
   macos-13 Intel, ubuntu x64, ubuntu arm64, windows) runs `smoke.sh` against
   the signed artifact. Windows needs its own variant.
4. **Publish** with `gh release upload v<ver>`: one asset per platform
   (`counterparts-<ver>-<platform>.gz`), plus the model as a separate asset if
   the sidecar route is chosen.
5. **Ship the checksums inside the plugin, not beside the download.** A sums
   file fetched from the same release only proves the transfer, not where it
   came from. Commit `plugin-binaries.sha256` (version, platform, sha256) to the
   plugin's files. The binary doesn't embed that file, so committing it after
   the build doesn't change the binaries, and reproducibility lets anyone check.
   `plugin-run.sh` then downloads `…/releases/download/v<ver>/<asset>`,
   gunzips it, checks the hash (`shasum -a 256` on macOS, `sha256sum` on Linux),
   `chmod +x`, and atomically moves it to
   `$CLAUDE_PLUGIN_DATA/bin/counterparts-<ver>` under a lock. Only then does it
   `exec … hook|mcp|cli`.

## How to rerun this

```sh
~/.bun/bin/bun install
~/.bun/bin/bun tools/single-binary/build.ts --target all            # or: --target native [--bytecode]
TMPDIR=/private/tmp bash tools/single-binary/smoke.sh "$PWD/dist/single-binary/counterparts-<ver>-darwin-arm64"
docker run --rm --network none -v "$PWD":/repo:ro node:22-bookworm \
  bash /repo/tools/single-binary/smoke.sh /repo/dist/single-binary/counterparts-<ver>-linux-arm64
~/.bun/bin/bun tools/single-binary/coldstart.ts dist/single-binary/counterparts-<ver>-darwin-arm64 --node "$(command -v node)"
```
