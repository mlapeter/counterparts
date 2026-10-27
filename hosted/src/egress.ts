/**
 * EVERY CONNECTION THE HOSTED SERVER OPENS, IN ONE FILE (OL2; design §1, the
 * G6 row): the core is inbound-only and its guard (`test/claude-code.test.ts`)
 * says so of `src/`; the hosted server is not, so its egress is named here and
 * pinned by `hosted/test/accounts.test.ts` ("egress") — a new destination is a review event.
 *
 *   1. Resend's HTTP API, to send a login email (`resendMailer`).
 *   2. a client's CIMD document (`cimdFetch`): oidc-provider calls it with its own
 *      guard already applied — https only, no redirects, a 2.5 s timeout, a body
 *      limit, and (on Node) a dispatcher that refuses special-use addresses —
 *      and `oauth.ts` adds https-on-443 only.
 *   3. Cloudflare R2, through its S3 API (`r2ObjectStore`), signed with
 *      `aws4fetch` (SigV4; pinned, zero dependencies): the per-store wrapped
 *      keys under `keys/`, and the delete of a store's Litestream prefix. The
 *      Litestream sidecar is a separate process and talks to R2 itself.
 *
 * Nothing here logs a token, an address or a message body.
 */
import { AwsClient } from "aws4fetch";

export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Resend, the phone project's provider. `fetchFn` is injectable so tests never reach the network. */
export function resendMailer(opts: { apiKey: string; from: string; fetchFn?: typeof fetch; timeoutMs?: number }): Mailer {
  const doFetch = opts.fetchFn ?? fetch;
  return {
    async send(mail: Mail): Promise<void> {
      const res = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) throw new Error(`mail provider answered ${String(res.status)}`);
    },
  };
}

/** For tests and local runs: keeps what would have been sent. */
export function memoryMailer(): Mailer & { readonly sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    async send(mail: Mail): Promise<void> {
      sent.push(mail);
    },
  };
}

/** The CIMD fetch oidc-provider uses (its `fetch` option). It arrives with the library's options (signal, dispatcher, manual redirect) and passes them on unchanged. */
export type CimdFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export const cimdFetch: CimdFetch = (input, init) => fetch(input, init);

/** What the hosted server needs of an object store. Keys are `/`-separated paths, never starting with `/`. */
export interface ObjectStore {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Every object under `prefix`; returns how many were deleted. */
  deletePrefix(prefix: string): Promise<number>;
}

export interface R2Options {
  /** `https://<account>.r2.cloudflarestorage.com` */
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Injectable so tests reach a local stand-in, never the network. */
  readonly fetchFn?: (request: Request) => Promise<Response>;
  readonly timeoutMs?: number;
}

function objectKey(key: string): string {
  if (key.length === 0 || key.startsWith("/") || key.includes("..") || key.length > 512) throw new Error("not an object key");
  return key.split("/").map(encodeURIComponent).join("/");
}

/** R2 over its S3 API, path-style, region `auto`. */
export function r2ObjectStore(opts: R2Options): ObjectStore {
  const client = new AwsClient({ accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, service: "s3", region: "auto" });
  const base = `${opts.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(opts.bucket)}`;
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    const signed = await client.sign(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
    try {
      return await (opts.fetchFn ?? fetch)(signed);
    } catch (err) {
      // Said plainly: a boot that stops here should name the bucket, not "fetch failed".
      throw new Error(`the object store (R2_ENDPOINT) didn't answer: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const store: ObjectStore = {
    async put(key, body) {
      const res = await send(`${base}/${objectKey(key)}`, { method: "PUT", body, headers: { "content-type": "application/octet-stream" } });
      if (!res.ok) throw new Error(`object store PUT answered ${String(res.status)}`);
    },
    async get(key) {
      const res = await send(`${base}/${objectKey(key)}`, { method: "GET" });
      if (res.status === 404) {
        // A wrong R2_BUCKET answers 404 too (NoSuchBucket). That is not "no such
        // object": a start must not read a missing bucket as an empty one (R5).
        if (/<Code>NoSuchBucket<\/Code>/.test(await res.text())) throw new Error("the object store says the bucket (R2_BUCKET) doesn't exist");
        return null;
      }
      if (!res.ok) throw new Error(`object store GET answered ${String(res.status)}`);
      return res.text();
    },
    async delete(key) {
      const res = await send(`${base}/${objectKey(key)}`, { method: "DELETE" });
      // Like GET (the #658 review): a delete in a bucket that doesn't exist deleted nothing, and must not read as done.
      if (res.status === 404 && /<Code>NoSuchBucket<\/Code>/.test(await res.text())) throw new Error("the object store says the bucket (R2_BUCKET) doesn't exist");
      if (!res.ok && res.status !== 404) throw new Error(`object store DELETE answered ${String(res.status)}`);
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | null = null;
      for (let page = 0; page < 1000; page++) {
        const q = new URLSearchParams({ "list-type": "2", prefix, ...(token === null ? {} : { "continuation-token": token }) });
        const res = await send(`${base}?${q.toString()}`, { method: "GET" });
        if (!res.ok) throw new Error(`object store LIST answered ${String(res.status)}`);
        const xml = await res.text();
        for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(decodeXml(m[1]!));
        const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
        token = truncated ? decodeXml(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") : null;
        if (token === null || token.length === 0) break;
      }
      return keys;
    },
    async deletePrefix(prefix) {
      if (prefix.length === 0 || !prefix.endsWith("/")) throw new Error("a prefix delete names a directory-like prefix ending in /");
      const keys = await store.list(prefix);
      for (const k of keys) await store.delete(k);
      return keys.length;
    },
  };
  return store;
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** For tests and local runs. */
export function memoryObjectStore(): ObjectStore & { readonly objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    async deletePrefix(prefix) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      for (const k of keys) objects.delete(k);
      return keys.length;
    },
  };
}
