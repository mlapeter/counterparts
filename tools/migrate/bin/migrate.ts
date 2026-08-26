#!/usr/bin/env bun
/**
 * `counterparts migrate <v1-dir> <v2-dir> [--apply]`
 *
 * DRY RUN IS THE DEFAULT (CONTRACT §5 G12). Without `--apply` this reads, gates,
 * plans and prints — and never constructs a store, so it cannot leave one behind.
 * The report goes to stdout and never into the data directory: an unclassified
 * top-level file there would make the next `Store.open()` throw by design.
 */
import { migrateAndRender } from "../index.js";

function usage(): never {
  process.stderr.write(
    [
      "usage: migrate <v1-dir> <v2-dir> [--apply]",
      "",
      "  <v1-dir>   a bansai data directory. READ-ONLY: the run proves it by",
      "             content-hashing every file before and after.",
      "  <v2-dir>   where the new store is built. Created only under --apply.",
      "  --apply    write. Without it this is a dry run that reports exactly",
      "             what --apply would do.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

function main(argv: readonly string[]): number {
  const args = argv.filter((a) => a !== "--apply");
  const apply = argv.includes("--apply");
  const source = args[0];
  const target = args[1];
  if (source === undefined || target === undefined || args.length > 2) usage();

  try {
    const { report, text } = migrateAndRender({ source, target, apply });
    process.stdout.write(`${text}\n`);
    // A source that did not come back byte-identical is the one failure that
    // must never be reported as a success: it means the read-only guarantee
    // broke, and the owner's live memory is what was under the pen.
    if (!report.source_readonly.identical) {
      process.stderr.write("FAIL: the source directory changed during the run (§5 G11)\n");
      return 1;
    }
    return 0;
  } catch (err) {
    process.stderr.write(`migrate failed: ${(err as Error).message}\n`);
    return 1;
  }
}

process.exit(main(process.argv.slice(2)));
