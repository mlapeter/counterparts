/**
 * THE ACCOUNT PAGES (OL2 step 3; design §4.2): log in by email link, the
 * account page, log out. Server-rendered HTML, no framework.
 *
 *   GET  /login            the form (email, an invite code for sign-up, `next`)
 *   POST /login            sends the link — the same words on the page whatever the outcome
 *   GET  /login/link       uses the link: one time, in time, in the browser that asked
 *   GET  /account          who you are, your time zone, your connected AIs
 *   POST /account/timezone
 *   POST /logout
 *
 * THE BROWSER BINDING. Every page sets a long-lived random cookie (`browser`)
 * if it is missing. A link is bound to the hash of that cookie when asked for,
 * and used only by a request carrying the same cookie — so a link forwarded,
 * leaked, or opened by a mail scanner signs nobody in, and a refusal for the
 * wrong browser does NOT spend the link. The same cookie keys the CSRF token on
 * every form.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream, statSync } from "node:fs";

import type { Accounts } from "./accounts.js";
import { LINK_MS } from "./accounts.js";
import type { Mailer } from "./egress.js";
import type { Route } from "./server.js";
import type { CookieNames } from "./web.js";
import { Csrf, RateLimit, clientIp, cookie, cookieNames, escapeHtml, page, parseCookies, readForm, redirect, safeNext, sameOrigin } from "./web.js";

const BROWSER_MAX_AGE_S = 400 * 24 * 60 * 60;
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

/** One connected AI, as the account page lists it (step 4 supplies them). */
export interface ConnectionView {
  readonly id: string;
  readonly client: string;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
}

export interface PagesOptions {
  readonly accounts: Accounts;
  readonly mailer: Mailer;
  readonly publicOrigin: string;
  readonly trustProxy?: boolean;
  readonly csrf?: Csrf;
  /** The person's connected AIs, and how to disconnect one (step 4). */
  readonly connections?: {
    list(personId: string): Promise<ConnectionView[]>;
    disconnect(personId: string, id: string): Promise<void>;
  };
  readonly now?: () => number;
  /** A sign-up just made a person and a store (step 5: the store's key and backup). A throw is audited, not shown. */
  readonly onSignup?: (personId: string, storeId: string) => Promise<void>;
  /** Export (step 5): a file to send, and how to clean it up. */
  readonly exportStore?: (personId: string) => Promise<{ readonly path: string; readonly filename: string; readonly cleanup: () => void }>;
  /** Delete the account, at once (step 5). */
  readonly deleteAccount?: (personId: string) => Promise<void>;
}

export interface Pages {
  readonly route: Route;
  /** The signed-in person for this request, or null (for other routes: the Allow page). */
  personOf(req: IncomingMessage): string | null;
  /** This browser's binding cookie value, setting one on `res` when missing. */
  browserOf(req: IncomingMessage, res: ServerResponse): string;
  readonly csrf: Csrf;
  readonly cookieNames: CookieNames;
}

const SENT_WORDS =
  "If that address can sign in — or your invite code is good — a sign-in link is on its way. It works for 15 minutes, once, in this browser.";

export function accountPages(opts: PagesOptions): Pages {
  const names = cookieNames(opts.publicOrigin);
  const csrf = opts.csrf ?? new Csrf();
  const now = opts.now ?? ((): number => Date.now());
  const perIp = new RateLimit(20, 60 * 60 * 1000, now);
  const perEmail = new RateLimit(5, 60 * 60 * 1000, now);

  const browserOf = (req: IncomingMessage, res: ServerResponse): string => {
    const have = parseCookies(req).get(names.browser);
    if (have !== undefined && /^[A-Za-z0-9_-]{32,64}$/.test(have)) return have;
    const fresh = randomBytes(32).toString("base64url");
    const prev = res.getHeader("Set-Cookie");
    const list = prev === undefined ? [] : Array.isArray(prev) ? prev.map(String) : [String(prev)];
    res.setHeader("Set-Cookie", [...list, cookie(names.browser, fresh, { secure: names.secure, maxAgeS: BROWSER_MAX_AGE_S })]);
    // Visible to the rest of this request as if it had arrived with it.
    req.headers["cookie"] = `${req.headers["cookie"] ?? ""}; ${names.browser}=${fresh}`;
    return fresh;
  };

  const personOf = (req: IncomingMessage): string | null => opts.accounts.sessionPerson(parseCookies(req).get(names.session) ?? null);

  const loginForm = (res: ServerResponse, browser: string, next: string, status = 200, notice = ""): void => {
    const nonce = randomBytes(16).toString("base64");
    page(res, status, {
      title: "Sign in",
      nonce,
      body: `<h1>Sign in to Counterparts</h1>
${notice.length > 0 ? `<p>${escapeHtml(notice)}</p>` : ""}
<form method="post" action="/login">
<input type="hidden" name="csrf" value="${escapeHtml(csrf.token(browser))}">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<input type="hidden" name="tz" id="tz" value="">
<label>Email<br><input type="email" name="email" required autocomplete="email"></label><br>
<label>Invite code <span class="muted">(only the first time)</span><br><input type="text" name="invite" autocomplete="off"></label><br>
<button type="submit">Email me a sign-in link</button>
</form>
<script nonce="${nonce}">try{document.getElementById("tz").value=Intl.DateTimeFormat().resolvedOptions().timeZone}catch(e){}</script>`,
    });
  };

  const message = (res: ServerResponse, status: number, title: string, words: string, link?: { href: string; text: string }): void => {
    page(res, status, {
      title,
      body: `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(words)}</p>${link === undefined ? "" : `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a></p>`}`,
    });
  };

  const route: Route = async (req, res, url) => {
    const p = url.pathname;
    if (p === "/login" && req.method === "GET") {
      const browser = browserOf(req, res);
      if (personOf(req) !== null) {
        redirect(res, safeNext(url.searchParams.get("next")));
        return true;
      }
      loginForm(res, browser, safeNext(url.searchParams.get("next")));
      return true;
    }
    if (p === "/login" && req.method === "POST") {
      const browser = parseCookies(req).get(names.browser);
      const form = await readForm(req);
      if (form === null || !sameOrigin(req, opts.publicOrigin) || !csrf.check(browser, form.get("csrf"))) {
        message(res, 403, "Start again", "This form expired or came from somewhere else. Open the sign-in page again.", { href: "/login", text: "Sign in" });
        return true;
      }
      const next = safeNext(form.get("next"));
      const email = (form.get("email") ?? "").trim().toLowerCase();
      if (!perIp.take(clientIp(req, opts.trustProxy === true)) || (email.length > 0 && !perEmail.take(email))) {
        message(res, 429, "Too many tries", "Too many sign-in emails asked for in the last hour. Try again later.");
        return true;
      }
      const asked = opts.accounts.requestLink({ email: form.get("email"), inviteCode: form.get("invite"), timeZone: form.get("tz"), browser: browser! });
      if (!asked.send && asked.reason === "bad-email") {
        loginForm(res, browser!, next, 400, "That doesn't look like an email address.");
        return true;
      }
      if (asked.send) {
        const link = `${opts.publicOrigin}/login/link?token=${encodeURIComponent(asked.token)}&next=${encodeURIComponent(next)}`;
        const minutes = String(Math.round(LINK_MS / 60_000));
        // NOT awaited: a sent link and no link must take the same time to answer,
        // or the page would say who has an account by how long it took.
        void opts.mailer
          .send({
            to: asked.to,
            subject: asked.signUp ? "Finish signing up for Counterparts" : "Your Counterparts sign-in link",
            text: `Open this link in the same browser where you asked for it. It works once, for ${minutes} minutes:\n\n${link}\n\nIf you didn't ask, ignore this email: nobody can sign in without it.\n`,
          })
          .catch(() => {
            // The page says the same thing either way; the failure is the operator's to see.
            opts.accounts.audit(null, null, "mail.failed", null);
          });
      }
      message(res, 200, "Check your email", SENT_WORDS);
      return true;
    }
    if (p === "/login/link" && req.method === "GET") {
      const token = url.searchParams.get("token") ?? "";
      const browser = parseCookies(req).get(names.browser) ?? null;
      const used = token.length < 16 || token.length > 128 ? ({ ok: false, reason: "unknown" } as const) : opts.accounts.useLink({ token, browser });
      if (!used.ok) {
        if (used.reason === "wrong-browser") {
          message(res, 400, "Open it in the other browser", "This link works only in the browser where you asked for it. Open it there, or ask for a new link here.", { href: "/login", text: "Ask for a new link" });
        } else {
          message(res, 400, "That link can't be used", "It has expired, was already used, or isn't one of ours. Ask for a new one.", { href: "/login", text: "Ask for a new link" });
        }
        return true;
      }
      if (used.created && opts.onSignup !== undefined) {
        const storeId = opts.accounts.person(used.personId)?.storeId ?? null;
        if (storeId !== null) {
          // Start-up's `ensureAll` finishes whatever fails here.
          await opts.onSignup(used.personId, storeId).catch(() => opts.accounts.audit(used.personId, storeId, "signup.backup.failed", null));
        }
      }
      const session = opts.accounts.startSession(used.personId);
      redirect(res, safeNext(url.searchParams.get("next")), { "Set-Cookie": cookie(names.session, session, { secure: names.secure, maxAgeS: SESSION_MAX_AGE_S }) });
      return true;
    }
    if (p === "/account" && req.method === "GET") {
      const browser = browserOf(req, res);
      const personId = personOf(req);
      if (personId === null) {
        redirect(res, "/login?next=%2Faccount");
        return true;
      }
      const person = opts.accounts.person(personId)!;
      const connections = (await opts.connections?.list(personId)) ?? [];
      const token = escapeHtml(csrf.token(browser));
      const fmt = (t: number): string => new Date(t).toISOString().slice(0, 10);
      page(res, 200, {
        title: "Your account",
        body: `<h1>Your Counterparts account</h1>
<p>Signed in as <strong>${escapeHtml(person.email ?? "")}</strong>.</p>
<h2>Connected AIs</h2>
${
  connections.length === 0
    ? `<p class="muted">None yet. Add Counterparts as a connector in Claude with the address <code>${escapeHtml(opts.publicOrigin)}/mcp</code>.</p>`
    : `<ul>${connections
        .map(
          (c) =>
            `<li>${escapeHtml(c.client)} <span class="muted">— connected ${fmt(c.createdAt)}${c.lastUsedAt === null ? "" : `, last used ${fmt(c.lastUsedAt)}`}</span>
<form method="post" action="/account/disconnect"><input type="hidden" name="csrf" value="${token}"><input type="hidden" name="id" value="${escapeHtml(c.id)}"><button type="submit">Disconnect</button></form></li>`,
        )
        .join("\n")}</ul>`
}
<h2>Your day</h2>
<form method="post" action="/account/timezone"><input type="hidden" name="csrf" value="${token}">
<label>Time zone (your memory's day turns over at your midnight)<br><input type="text" name="tz" value="${escapeHtml(person.timeZone ?? "")}"></label>
<button type="submit">Save</button></form>
${
  opts.exportStore === undefined
    ? ""
    : `<h2>Take your memory with you</h2>
<form method="post" action="/account/export"><input type="hidden" name="csrf" value="${token}">
<p class="muted">The whole memory as one SQLite file: complete, readable by any SQLite tool, and the shape a local install can take in.</p>
<button type="submit">Download my memory</button></form>`
}
${
  opts.deleteAccount === undefined
    ? ""
    : `<h2>Delete everything</h2>
<form method="post" action="/account/delete"><input type="hidden" name="csrf" value="${token}">
<p class="muted">Deletes your memory, its backups and your account, at once. It can't be undone. Download it first if you want to keep it.</p>
<label>Type your email address to confirm<br><input type="email" name="confirm" autocomplete="off"></label>
<button type="submit">Delete my account and memory</button></form>`
}
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${token}"><button type="submit">Sign out</button></form>`,
      });
      return true;
    }
    if ((p === "/account/export" || p === "/account/delete") && req.method === "POST") {
      const browser = parseCookies(req).get(names.browser);
      const form = await readForm(req);
      const personId = personOf(req);
      if (form === null || !sameOrigin(req, opts.publicOrigin) || !csrf.check(browser, form.get("csrf")) || personId === null) {
        message(res, 403, "Start again", "This form expired or came from somewhere else.", { href: "/account", text: "Your account" });
        return true;
      }
      if (p === "/account/export") {
        if (opts.exportStore === undefined) return false;
        const out = await opts.exportStore(personId);
        try {
          res.writeHead(200, {
            "Content-Type": "application/vnd.sqlite3",
            "Content-Disposition": `attachment; filename="${out.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
            "Content-Length": String(statSync(out.path).size),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          await new Promise<void>((done, fail) => {
            const stream = createReadStream(out.path);
            stream.once("error", fail);
            res.once("finish", () => done());
            res.once("close", () => done());
            stream.pipe(res);
          });
        } finally {
          out.cleanup();
        }
        opts.accounts.audit(personId, null, "account.exported", null);
        return true;
      }
      if (opts.deleteAccount === undefined) return false;
      const person = opts.accounts.person(personId);
      const typed = (form.get("confirm") ?? "").trim().toLowerCase();
      if (person === null || person.email === null || typed !== person.email) {
        message(res, 400, "Not deleted", "The address you typed doesn't match this account's. Nothing was deleted.", { href: "/account", text: "Back" });
        return true;
      }
      await opts.deleteAccount(personId);
      page(res, 200, {
        title: "Deleted",
        headers: { "Set-Cookie": cookie(names.session, "", { secure: names.secure, maxAgeS: 0 }) },
        body: `<h1>Deleted</h1><p>Your memory, its backups and your account are gone. Thank you for trying Counterparts.</p>`,
      });
      return true;
    }
    if ((p === "/account/timezone" || p === "/account/disconnect" || p === "/logout") && req.method === "POST") {
      const browser = parseCookies(req).get(names.browser);
      const form = await readForm(req);
      const personId = personOf(req);
      if (form === null || !sameOrigin(req, opts.publicOrigin) || !csrf.check(browser, form.get("csrf")) || personId === null) {
        message(res, 403, "Start again", "This form expired or came from somewhere else.", { href: "/account", text: "Your account" });
        return true;
      }
      if (p === "/logout") {
        opts.accounts.endSession(parseCookies(req).get(names.session) ?? null);
        redirect(res, "/login", { "Set-Cookie": cookie(names.session, "", { secure: names.secure, maxAgeS: 0 }) });
        return true;
      }
      if (p === "/account/disconnect") {
        const id = form.get("id");
        if (id !== null && opts.connections !== undefined) await opts.connections.disconnect(personId, id);
        redirect(res, "/account");
        return true;
      }
      if (!opts.accounts.setTimeZone(personId, form.get("tz"))) {
        message(res, 400, "Not a time zone", "Use a name like America/Denver or Europe/Berlin.", { href: "/account", text: "Back" });
        return true;
      }
      redirect(res, "/account");
      return true;
    }
    return false;
  };

  return { route, personOf, browserOf, csrf, cookieNames: names };
}
