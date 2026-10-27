/**
 * A STAND-IN FOR THE LITESTREAM BINARY (OL2b's restore drill). It is not
 * Litestream: it proves OUR plumbing — the configuration we generate, the
 * arguments we pass, the SSE-C key file per store, the environment the child
 * gets, and where restored files land — not Litestream's replication.
 *
 *   replicate -config <yml>
 *       every 100 ms and once more on SIGTERM: each configured database's file
 *       (and its -wal) PUT whole to <endpoint>/<bucket>/<replica path>/standin/{db,wal},
 *       under the replica's SSE-C key (read from its key file, as Litestream does).
 *   restore -config <yml> -o <out> [-if-replica-exists] <db path>
 *       the same objects back, with the same key, into <out> (and <out>-wal).
 *
 * It reads only the configuration shape `backup.ts#config()` writes, and it
 * refuses to run without the R2 credentials in its environment.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};

if (!process.env.LITESTREAM_ACCESS_KEY_ID || !process.env.LITESTREAM_SECRET_ACCESS_KEY) {
  process.stderr.write("standin: no R2 credentials in the environment\n");
  process.exit(2);
}
const extra = Object.keys(process.env).filter((k) => !["PATH", "LITESTREAM_ACCESS_KEY_ID", "LITESTREAM_SECRET_ACCESS_KEY"].includes(k) && !k.startsWith("__CF") && k !== "PWD" && k !== "SHLVL" && k !== "_");
if (extra.length > 0) {
  process.stderr.write(`standin: unexpected environment: ${extra.join(",")}\n`);
  process.exit(3);
}

function parseConfig(path) {
  const dbs = [];
  let db = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const top = /^ {2}- path: (.+)$/.exec(line);
    if (top) {
      db = { path: JSON.parse(top[1]) };
      dbs.push(db);
      continue;
    }
    const field = /^ {6}([a-z-]+): (.+)$/.exec(line);
    if (field && db) db[field[1] === "path" ? "replicaPath" : field[1]] = field[2].startsWith('"') ? JSON.parse(field[2]) : field[2];
  }
  return dbs;
}

function sse(db) {
  const key = readFileSync(db["sse-customer-key-path"], "utf8").trim();
  return {
    "x-amz-server-side-encryption-customer-algorithm": "AES256",
    "x-amz-server-side-encryption-customer-key": key,
    "x-amz-server-side-encryption-customer-key-md5": createHash("md5").update(Buffer.from(key, "base64")).digest("base64"),
  };
}

const objectUrl = (db, name) => `${db.endpoint}/${db.bucket}/${db.replicaPath}/standin/${name}`;

const configPath = flag("-config");
if (configPath === undefined) {
  process.stderr.write("standin: -config is required\n");
  process.exit(1);
}

if (command === "replicate") {
  const dbs = parseConfig(configPath);
  const sent = new Map();
  let busy = Promise.resolve();
  const syncOnce = async () => {
    for (const db of dbs) {
      for (const [name, file] of [["db", db.path], ["wal", `${db.path}-wal`]]) {
        if (!existsSync(file)) continue;
        const body = readFileSync(file);
        const digest = createHash("sha256").update(body).digest("hex");
        const id = `${db.path}|${name}`;
        if (sent.get(id) === digest) continue;
        const res = await fetch(objectUrl(db, name), { method: "PUT", body, headers: sse(db) });
        if (res.ok) sent.set(id, digest);
        else process.stderr.write(`standin: PUT answered ${String(res.status)}\n`);
      }
    }
  };
  const tick = () => {
    busy = busy.then(syncOnce).catch((err) => process.stderr.write(`standin: sync failed: ${String(err)}\n`));
  };
  const timer = setInterval(tick, 100);
  tick();
  process.once("SIGTERM", () => {
    clearInterval(timer);
    // The final sync on the way out (Litestream v0.5's shutdown sync).
    busy
      .then(syncOnce)
      .catch((err) => process.stderr.write(`standin: final sync failed: ${String(err)}\n`))
      .finally(() => process.exit(0));
  });
} else if (command === "restore") {
  const out = flag("-o");
  const dbPath = args.at(-1);
  const db = parseConfig(configPath).find((d) => d.path === dbPath);
  if (out === undefined || db === undefined) {
    process.stderr.write("standin: restore needs -o and a configured database path\n");
    process.exit(1);
  }
  const main = await fetch(objectUrl(db, "db"), { headers: sse(db) });
  if (main.status === 404) {
    if (args.includes("-if-replica-exists")) process.exit(0);
    process.stderr.write("standin: no replica\n");
    process.exit(1);
  }
  if (!main.ok) {
    process.stderr.write(`standin: the bucket answered ${String(main.status)}\n`);
    process.exit(1);
  }
  writeFileSync(out, Buffer.from(await main.arrayBuffer()));
  const wal = await fetch(objectUrl(db, "wal"), { headers: sse(db) });
  if (wal.ok) writeFileSync(`${out}-wal`, Buffer.from(await wal.arrayBuffer()));
  process.exit(0);
} else {
  process.stderr.write(`standin: unknown command ${String(command)}\n`);
  process.exit(1);
}
