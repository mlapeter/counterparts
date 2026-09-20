/**
 * `adapters/cli/` — the owner's console.
 *
 * The dependency direction is one-way and asserted by a test: the core imports
 * NOTHING from this directory, and — the sharper rule — **nothing outside this
 * directory imports `removal.ts`** (§5 G1, §16 G2). `removal.ts` is deliberately
 * NOT re-exported here: a module that is easy to import is a module a future
 * caller imports. The console reaches it directly; nobody else may.
 */
export {
  COMMANDS,
  COMMAND_BLURB,
  COMMAND_FLAGS,
  COMMON_FLAGS,
  commandHelp,
  unknownFlag,
  EXIT,
  OWNER_OPS,
  openCounterpart,
  parse,
  run,
  usage,
} from "./commands.js";
export type { Command, Io, RunOptions } from "./commands.js";

export {
  BLOB_NAME,
  CIPHER,
  EXPORT_FORMAT,
  KDF,
  decryptBundle,
  encryptBundle,
  exportStore,
} from "./export.js";
export type { ExportMode, ExportOptions, ExportReport } from "./export.js";

export {
  BIN,
  CONFIG_FILE,
  CREDENTIALS_FILE,
  HOOK_SCRIPT,
  HOST_EVENTS,
  MCP_SCRIPT,
  MCP_SERVER_NAME,
  configObject,
  credentialsTemplate,
  DEFAULT_STORE_DIR,
  installLayout,
  layoutRefusal,
  tempRoots,
  throwawayDefaultRefusal,
  mcpCommand,
  readHost,
  hostMcpFile,
  hostSettingsFiles,
  hostConfigBase,
  runCommand,
  settingsBlock,
  shellQuote,
  writeOnce,
} from "./install.js";
export type { ConfigInput, FileResult, HostRead, InstallLayout, WroteWhat } from "./install.js";

export { assertSafeTarget, snapshot, snapshotName, vacuumInto } from "./snapshot.js";
export type { CopiedEntry, CopyMethod, SnapshotReport } from "./snapshot.js";
