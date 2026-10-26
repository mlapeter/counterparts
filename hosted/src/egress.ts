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
 *
 * Nothing here logs a token, an address or a message body.
 */

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
