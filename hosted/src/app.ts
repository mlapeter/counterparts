/**
 * THE COMPOSITION (OL2 step 4): accounts, the account pages, OAuth, the
 * tenants and the door, wired into one unlistened HTTP server.
 *
 * The data root is NAMED, always (`dataRoot`), and refused when it sits in a
 * live store (`remote/bin/serve-http.ts#livePathRefusal`). Under it:
 *
 *   control/accounts.sqlite   people, identities, stores, invites, sessions, audit
 *   control/oauth.sqlite      the OAuth library's rows, bearer values hashed
 *   tenants/<storeId>/        one per person (tenants.ts)
 *
 * Mike's hosted store is new and separate: nothing here reads a local store.
 */
import type { Server } from "node:http";
import { isAbsolute, join } from "node:path";

import { livePathRefusal } from "../../src/adapters/remote/bin/serve-http.js";
import { Accounts } from "./accounts.js";
import type { Mailer } from "./egress.js";
import type { CimdFetch } from "./egress.js";
import { createOAuth } from "./oauth.js";
import type { OAuth } from "./oauth.js";
import { accountPages } from "./pages.js";
import type { ConnectionView, Pages } from "./pages.js";
import { createHostedServer } from "./server.js";
import type { HostedCallRecord } from "./server.js";
import { Tenants } from "./tenants.js";
import type { SharedEmbedder } from "./tenants.js";
import type { Spawner } from "../../src/adapters/spawn.js";

export interface AppOptions {
  /** HOSTED_DATA_ROOT: absolute, named, never a live store. */
  readonly dataRoot: string;
  /** `https://app.counterparts.ai` in production. */
  readonly publicOrigin: string;
  readonly mailer: Mailer;
  readonly trustProxy?: boolean;
  readonly embedder?: SharedEmbedder;
  readonly spawner?: Spawner;
  readonly cookieKeys?: readonly string[];
  readonly cimdFetch?: CimdFetch;
  readonly allowedOrigins?: readonly string[];
  readonly onCall?: (record: HostedCallRecord) => void;
  readonly maxOpenStores?: number;
}

export interface App {
  readonly server: Server;
  readonly accounts: Accounts;
  readonly pages: Pages;
  readonly oauth: OAuth;
  readonly tenants: Tenants;
  close(): Promise<void>;
}

export function createApp(opts: AppOptions): App {
  if (!isAbsolute(opts.dataRoot)) throw new Error("the hosted data root must be an absolute path");
  const refused = livePathRefusal(opts.dataRoot, "the hosted data root");
  if (refused !== null) throw new Error(refused);
  const publicOrigin = opts.publicOrigin.replace(/\/+$/, "");
  const accounts = new Accounts({ path: join(opts.dataRoot, "control", "accounts.sqlite") });
  // Pages and OAuth need each other (the account page lists connections; the
  // Allow page needs the signed-in person). Bound late, through this holder.
  let oauth: OAuth | null = null;
  const pages = accountPages({
    accounts,
    mailer: opts.mailer,
    publicOrigin,
    ...(opts.trustProxy === undefined ? {} : { trustProxy: opts.trustProxy }),
    connections: {
      list: (personId: string): Promise<ConnectionView[]> => oauth?.connections.list(personId) ?? Promise.resolve([]),
      disconnect: (personId: string, id: string): Promise<void> => oauth?.connections.disconnect(personId, id) ?? Promise.resolve(),
    },
  });
  oauth = createOAuth({
    publicOrigin,
    accounts,
    pages,
    storePath: join(opts.dataRoot, "control", "oauth.sqlite"),
    ...(opts.trustProxy === undefined ? {} : { trustProxy: opts.trustProxy }),
    ...(opts.cookieKeys === undefined ? {} : { cookieKeys: opts.cookieKeys }),
    ...(opts.cimdFetch === undefined ? {} : { fetch: opts.cimdFetch }),
  });
  const tenants = new Tenants({
    root: join(opts.dataRoot, "tenants"),
    ...(opts.embedder === undefined ? {} : { embedder: opts.embedder }),
    ...(opts.spawner === undefined ? {} : { spawner: opts.spawner }),
    ...(opts.maxOpenStores === undefined ? {} : { maxOpen: opts.maxOpenStores }),
  });
  tenants.startSweeping();
  const o = oauth;
  const server = createHostedServer({
    tenants,
    publicOrigin,
    authenticate: o.authenticate,
    routes: [o.route, pages.route],
    ...(opts.allowedOrigins === undefined ? {} : { allowedOrigins: opts.allowedOrigins }),
    ...(opts.onCall === undefined ? {} : { onCall: opts.onCall }),
  });
  return {
    server,
    accounts,
    pages,
    oauth: o,
    tenants,
    async close(): Promise<void> {
      await tenants.closeAll();
      o.close();
      accounts.close();
    },
  };
}
