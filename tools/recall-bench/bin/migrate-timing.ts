#!/usr/bin/env bun
/**
 * Time the v2 → v3 cache migration against a real-sized index, and prove it
 * keeps the embeddings. Hand-run, on a COPY of a cache file:
 *
 *   bun tools/recall-bench/bin/migrate-timing.ts --cache /tmp/copy/cache.sqlite
 *
 * The number matters because the migration runs inside whichever process opens
 * box 3 first after deploy, and on this machine that is a hook with a 1200 ms
 * recall budget.
 */
import { openDb } from "../../../src/core/store/db.js";
import { openCache } from "../../../src/core/store/cache.js";

const argv = process.argv.slice(2);
const i = argv.indexOf("--cache");
const path = i >= 0 ? argv[i + 1] : undefined;
if (path === undefined) {
  process.stderr.write("usage: migrate-timing --cache <path to a COPY of cache.sqlite>\n");
  process.exit(2);
}

const before = openDb(path);
const v0 = before.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value;
const emb0 = before.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings")?.n ?? 0;
const docs0 = before.get<{ n: number }>("SELECT COUNT(DISTINCT memory_id) AS n FROM doc_tokens")?.n ?? 0;
before.close();

const t0 = performance.now();
const db = openCache(path);
const ms = performance.now() - t0;
const v1 = db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value;
const emb1 = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings")?.n ?? 0;
const lens = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM doc_lens")?.n ?? 0;
const avg = db.get<{ a: number }>("SELECT AVG(len) AS a FROM doc_lens")?.a ?? 0;
const max = db.get<{ a: number }>("SELECT MAX(len) AS a FROM doc_lens")?.a ?? 0;

const t1 = performance.now();
const again = openCache(path);
const msIdempotent = performance.now() - t1;
again.close();
db.close();

process.stdout.write(
  [
    `schemaVersion ${v0} -> ${v1}`,
    `doc_lens rows ${lens} (docs in index: ${docs0})`,
    `embeddings ${emb0} -> ${emb1}  ${emb0 === emb1 ? "KEPT" : "LOST"}`,
    `mean len ${avg.toFixed(1)} tokens, max ${max}`,
    `migration ${ms.toFixed(0)} ms; reopen (steady state, no write) ${msIdempotent.toFixed(0)} ms`,
    "",
  ].join("\n"),
);
