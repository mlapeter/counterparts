# The single binary (2026-10-09)

Counterparts' sources run under Bun 1.3+ or Node 22.15+. The Claude Code plugin ships
those sources but can't ship a runtime. So on a computer with neither, the plugin
downloads one prebuilt **single binary** instead: every part of Counterparts, the model
table and the dashboard's files packed into one executable by `bun build --compile`.

The spike that decided this, with its measurements, is
[`notes/single-binary-spike.md`](notes/single-binary-spike.md). This page is how it works
now, and how a release ships it.

## What it is

One file per platform, named `counterparts`, whose first argument picks what it runs:

| Mode | What runs | Who starts it |
| :- | :- | :- |
| `hook` | `claude-code/bin/hook.ts` | the plugin's five hooks, through `plugin-run.sh` |
| `mcp` | `mcp/bin/serve.ts` | the plugin's memory server |
| `cli …` | `cli/bin/counterparts.ts` | `/counterparts:doctor`, or a person |
| `dashboard …` | `dashboard/bin/dashboard.ts` | a person |
| `runner`, `nightly` | the worker and the nightly run | the binary itself (`runtime.ts#scriptArgs`) |
| `selfcheck`, `--version` | the build's own check; the version | `build.ts`, a person |

The dispatcher is `tools/single-binary/main.ts`. It is not in the npm package.

What the binary changes in `src/`, and why:

- **Every module shares one `import.meta.url`** inside the binary
  (`file:///$bunfs/root/<name>`). So every "am I the main script" guard would fire at
  once.
  - Each entry's `isEntryPoint` says no when compiled, and exports a `start()` that the
    dispatcher calls.
  - `runtime.ts#BINARY` knows which case this is: null from source, `{ root, self }` in
    the binary. Every compiled branch takes it as a parameter, so
    `test/single-binary.test.ts` runs them all from source.
- **Its own files.** The build embeds `package.json` (the version), the model table and
  the dashboard's page and modules at their repository paths. `runtime.ts#packagePath`
  finds them; `bundledModelDir` names the table.
- **Running itself.** `scriptArgs(script, exe)` returns `[mode]` when `exe` is the binary.
  So the worker, the nightly run, the night run's `--mcp-config` and the plugin's
  first-run install all become `<binary> <mode>`.
- **Reading its commands back.** `parseScriptInvocation` reads `<binary> <mode> …`
  (`runtime: "binary"`, the binary itself as the file that must exist). So
  `isOurHookCommand`, doctor's Runtime line, `hookTargetPath`, the plugin's
  "npm wiring is live" check and the process lister all know it.
- **Knowing it is the plugin's.** It has no package root on disk, so
  `plugin.ts#runningAsPlugin` asks whether it sits under `CLAUDE_PLUGIN_DATA`.
- **It wires no host.**
  - `connect` and `install --host claude-desktop` refuse, and say to use the npm
    install.
  - `install` makes the store and the configuration, then says there is nothing to
    connect. It prints no hooks block naming itself.
  - The reason: the binary lives in the plugin's data directory, which Claude Code
    deletes with the plugin.
- **No `.env`, no `bunfig.toml`.** It is built with
  `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`. Hooks run in the person's
  project.

## How the plugin gets it

`plugin-run.sh` looks for a runtime in this order:

1. `COUNTERPARTS_RUNTIME`.
2. Bun.
3. Node.
4. `$CLAUDE_PLUGIN_DATA/bin/<version>/counterparts`, if it is there.

With none of them, it fetches the binary:

- **Which file.** The platform is darwin-arm64 (`sysctl hw.optional.arm64`, which stays
  truthful under Rosetta), darwin-x64, linux-x64 or linux-arm64 (glibc; musl is told it
  has no binary). **Not Windows yet:** CI builds a Windows binary, but no release offers
  one (`build.ts#RELEASED`), so on Windows the launcher still says to install Bun or
  Node. The version is `.claude-plugin/plugin.json`'s, and the URL is built from it
  alone: `https://github.com/mlapeter/counterparts/releases/download/v<version>/counterparts-<version>-<platform>.gz`.
- **Which checksum.** `.claude-plugin/binaries.json`, **inside the plugin**, gives the
  asset's sha256 twice: compressed and unpacked. A checksum fetched from the same
  release as the file would prove the transfer and nothing about where it came from. A
  `binaries.json` for another version is not used.
- **The download.**
  - It runs in the background, detached: `setsid` where it exists, job control
    otherwise.
  - It runs once: a lock in `$CLAUDE_PLUGIN_DATA/bin`, taken by the hook or the server,
    whichever starts first; a lock older than 30 minutes is a dead download (curl gives
    up at 25).
  - `curl` takes HTTPS only, redirects included, at most five redirects and no more
    bytes than `binaries.json` names. GitHub hands a release asset on to its own CDN,
    whose host curl can't pin (and GitHub has changed it before); the pinned sha256 is
    what makes any host's bytes safe.
  - The steps, in a directory only this user can enter (`umask 077`): check the `.gz`,
    unpack, check the program, `chmod 700`, then one `mv` into place. Nothing is ever
    run, or made executable, before both checks pass. A failed file is deleted, and a
    partial left by a killed download is swept at the next one.
- **Every later launch re-checks it.** A full check writes `verified` beside the
  program: the sha256 it matched, and the file's inode, size and mtime. A hook runs the
  program when that stamp names this plugin's checksum and this very file and is under a
  day old (one `stat`, about 1 ms). The server's start, once a session, re-hashes the
  whole file, as does a hook finding the stamp old, missing or different (about 75 ms
  for 100 MiB with `openssl`). A program that no longer matches is deleted, never run,
  and downloaded again.
- **Old versions.** When a new version's program lands, another version's whose stamp
  is a week old (no server has started it since) is deleted: each is 100–150 MiB
  unpacked.
- **What the person sees.**
  - The first SessionStart says Counterparts is getting ready, the size, where it comes
    from, and that memory starts next session.
  - Other hooks are silent.
  - The server answers the protocol with no tools, and its instructions say the same.
    `/mcp` shows it connected, and the model can answer "is memory on?".
- **A failure** gets one line naming what failed, and is retried at a session start ten
  minutes or more later.
- **Opt-outs and overrides.**
  - `COUNTERPARTS_BINARY_DOWNLOAD=off` forbids the download; the message then names a
    runtime to install.
  - `COUNTERPARTS_BINARY_URL` replaces the release URL (tests). The checksums still come
    from the plugin.
- **Without `CLAUDE_PLUGIN_DATA`.** `/counterparts:doctor` runs the launcher through
  Claude Code's Bash tool, whose environment may lack `CLAUDE_PLUGIN_DATA`. In that case
  the launcher uses the directory Claude Code gives this plugin,
  `${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/data/counterparts-counterparts`, if it
  exists.

None of this blocks a hook or the server's start-up: the launcher's own work is a few
milliseconds (measured 23–33 ms for the first SessionStart).

## Releasing

The binary must be built from the release's own code, and its checksums must be in the
release commit. The plugin pins that commit's tag, so `binaries.json` has to be at the
tag. `binaries.json` itself is not embedded in the binaries, so committing it doesn't
change them.

Who does what: the release agent builds, commits `binaries.json` and keeps the files;
**the upload is the owner's**, at publish, from the PUBLISH sheet, like the tag push.

1. **Build, after the last change to `src/` in the release** (the version bump
   included), on macOS, in the clean clone of the release branch after
   `bun install --frozen-lockfile`:

   ```sh
   bun tools/single-binary/build.ts --release
   ```

   This builds the four released platforms (`build.ts#RELEASED`: both macOS, both
   Linux; not Windows yet) with `--bytecode`. It re-signs both macOS binaries ad-hoc,
   which needs `codesign`, so `--release` refuses on any other OS. It runs `selfcheck`
   on the one this Mac can run, and gzips each into `dist/single-binary/<version>/`
   beside a `SHA256SUMS`. Finally it writes `.claude-plugin/binaries.json`.
   - **Commit `binaries.json`** on the release branch; the tarball is packed from that
     head. `test/single-binary.test.ts` fails while it names another version.
   - **Any later change to `src/`** means building again and committing the new
     `binaries.json`.
   - **Copy `dist/single-binary/<version>/`** into the release folder beside the
     tarball. The clean clone is thrown away, and the builds are not byte-reproducible
     (two differ in about 6 KB), so the uploaded files must be these very ones.
2. **The PUBLISH sheet** carries, right after the tag push, the two commands below with
   the release folder's absolute paths, and a notes file there (the version's CHANGELOG
   entry).
3. **At publish**, as `docs/plugin.md` describes: `npm publish`, then tag the packed
   commit and push the tag. **Then attach the binaries to that tag's release, right
   away.** Until they are there, a plugin install with no runtime gets a "download
   failed" line and retries ten minutes later; nothing else breaks.

   ```sh
   gh release create v<version> --verify-tag --title "counterparts <version>" --notes-file <folder>/release-notes.md \
     <folder>/single-binary/*.gz <folder>/single-binary/SHA256SUMS
   # or, if the release exists: gh release upload v<version> <folder>/single-binary/*.gz <folder>/single-binary/SHA256SUMS
   ```

4. **Check** what is published against what the plugin carries, from the tagged commit:

   ```sh
   bun tools/single-binary/verify-release.ts
   ```

   It downloads every asset from the release and checks both checksums. Exit 0 means a
   plugin user on any released platform gets a program that runs.

A version released without binaries (every one up to 0.3.13, whose launcher has no
download at all) keeps the old behaviour: with no Bun or Node, one line saying to
install one.

Signing is ad-hoc. That is enough here because `curl` sets no quarantine attribute, so
macOS's Gatekeeper never assesses the file and only the kernel's signature check applies.
A Developer ID signature and notarization would be needed only if the binary were ever
offered as a browser download.

## Tests and CI

- **From source:**
  - `test/single-binary.test.ts`: every compiled branch, through a fake `Binary`.
  - `test/plugin-binary.test.ts`: the launcher's download path, against a local server
    and a two-line fake program. It covers the message and the timing, one download for
    concurrent starts, the not-ready server, a checksum failure that is never run and
    is retried later, the opt-out, and another version's checksums; the kept program's
    permissions and stamp, a changed program deleted and fetched again (by a hook, and
    by the server's re-hash when only the bytes changed), a refused redirect to plain
    HTTP, and old versions cleared.
  - `test/project-env.test.ts`: a project's `.env` changes nothing.
- **The real binary:**
  - `tools/single-binary/smoke.sh <binary>`: the binary alone, under `env -i` with no
    bun or node on PATH, a temp HOME and store, and `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`.
  - `tools/single-binary/launcher-e2e.ts <dist dir>`: the binary through
    `plugin-run.sh`, downloaded from a local server and verified.
- **CI** (`.github/workflows/single-binary.yml`): on pull requests that touch the binary
  or the launcher, each of macOS arm64, macOS Intel, Linux x64, Linux arm64 and Windows
  builds its own platform and runs all of the above. **Windows may fail** for now, and
  is not released until it doesn't.

## Limits, said plainly

- **Size**: 54–72 MiB to download (gzipped), per platform, per version; 27 MiB of that
  is the model table, which barely compresses. If update size ever bothers anyone, the
  table can ship as its own asset, kept across versions. `COUNTERPARTS_STATIC_WEIGHTS_DIR`
  already points the binary at one, at no cost in speed (measured).
- **Start-up**: a UserPromptSubmit hook takes about 86 ms with the bytecode build, vs.
  about 102 ms for `bun hook.mjs` today (M3 Pro).
- **Untested so far:**
  - **darwin-x64**: no Bun x64 program runs under Rosetta 2 on macOS 14, so only CI's
    Intel runner has run it (green on 2026-10-09); no person has.
  - **Windows is not supported by the binary path yet.** No release offers a Windows
    binary, so a Windows computer with no Bun or Node is told to install one, as before.
    CI builds it to get there; its open parts are the `B:\~BUN\root` path handling,
    `plugin-run.sh` under Git Bash, and an unsigned exe that Defender may flag. To
    release it, add it to `build.ts#RELEASED` once its CI job is green.
- **"Version on disk"** in the binary is its own embedded version. Each plugin version
  runs its own binary, and an open MCP server keeps the code it started with, as with
  the sources.
