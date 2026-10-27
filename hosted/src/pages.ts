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
  /** Delete everything now: the account and memory erased at once (step 5). */
  readonly deleteAccount?: (personId: string) => Promise<void>;
  /** Delete, the default (R6): locked at once, erased after 24 hours unless kept. Resolves to the deadline (null: not active). */
  readonly scheduleDelete?: (personId: string) => Promise<number | null>;
  /** Keep an account whose delete is pending (R6). False: nothing to keep, or too late. */
  readonly keepAccount?: (personId: string) => boolean;
  /** A delete's email failed to send (R9): for the operator's log, by store. Never given the address or the error. */
  readonly onDeleteMailFailed?: (storeId: string | null) => void;
}

/** A deadline in the person's own zone, e.g. "Tuesday, October 28 at 2:05 PM MDT". */
export function deadlineWords(at: number, timeZone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timeZone ?? "UTC" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(at);
  }
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

// THE DELETE WORDS (R6, Mike 2026-10-27: plain and honest). DESIGN §5.2 and §5.4 say the same.
const DELETE_LATER_WORDS =
  "Deleting locks your account and your memory at once: every connected AI is disconnected, and your memory isn't read by us or any AI, shown or used. After 24 hours your memory, its backups and its key are erased, unless you sign in before then and keep your account. Download your memory first if you want a copy.";
const DELETE_NOW_WORDS = "your memory, its backups and its key are erased at once, and your account is closed. It can't be undone.";
const AFTER_ERASE_WORDS = "Your account email is purged from our encrypted account backups within 24 hours of the erase.";
const FORGET_WORDS =
  "Forgetting one memory is different: it is gone from your memory at once, though traces can stay in unused space in your memory's file (on our encrypted disks) and in its encrypted backups until they are overwritten or expire. When your account is erased, all of it becomes unreadable at once.";
const KEEP_WORDS = "Keeping it brings your account and memory back as they were. Your connected AIs stay disconnected: connect them again from Claude.";
// The done pages' words, shared with their emails (R9) so the two say the same thing.
const LOCKED_WORDS = "Your account and memory are locked, every connected AI is disconnected, and you're signed out.";
const ERASED_WORDS = "Your memory, its backups and its key are erased, and your account is closed. Your account email is purged from our encrypted account backups within 24 hours.";
const ERASING_WORDS =
  "Your account is closed. Part of the deletion didn't finish just now, so the server will keep retrying on its own until everything is gone. You don't need to do anything. Your account email is purged from our encrypted account backups within 24 hours of the deletion finishing.";
const MAIL_ON_ITS_WAY = "An email with this is on its way to you.";

/**
 * THE DELETE EMAILS (R9, Mike 2026-10-27): one at a delete (24 hours), one at
 * delete everything now. Plain text, the pages' own words. No link that carries
 * a token (the person signs in at the plain /login), no ids, nothing of the memory.
 */
export function deleteLaterMail(to: string, deadline: string, origin: string): { to: string; subject: string; text: string } {
  return {
    to,
    subject: "Your Counterparts account is set to be deleted",
    text: `Your Counterparts account was set to be deleted. Your account and memory are locked, and every connected AI is disconnected. After ${deadline} your memory, its backups and its key are erased. Until then your memory isn't read, shown or used.

Changed your mind? Sign in at ${origin}/login before then and click "Keep my account". Your connected AIs stay disconnected: you connect them again.

If it wasn't you, sign in and keep your account before then.
`,
  };
}

export function deleteNowMail(to: string, finished: boolean): { to: string; subject: string; text: string } {
  return finished
    ? { to, subject: "Your Counterparts account is deleted", text: `${ERASED_WORDS}\n\nThank you for trying Counterparts.\n` }
    : { to, subject: "Your Counterparts account is being deleted", text: `${ERASING_WORDS}\n` };
}

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
  /** A signed-in person whose delete is pending (R6): served the pending page, keep, and delete now, and nothing else. */
  const pendingOf = (req: IncomingMessage): string | null => opts.accounts.sessionPendingDelete(parseCookies(req).get(names.session) ?? null);

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

  /**
   * THE PENDING PAGE (R6): the whole account page of a person whose delete is
   * pending. When the erase happens, keep the account, or delete everything now.
   * Nothing of the memory or the connections is shown.
   */
  const pendingPage = (res: ServerResponse, browser: string, personId: string): void => {
    const person = opts.accounts.person(personId);
    const at = person?.deleteAfter ?? now();
    const when = escapeHtml(deadlineWords(at, person?.timeZone ?? null));
    const token = escapeHtml(csrf.token(browser));
    const due = at <= now();
    page(res, 200, {
      title: "Set to be deleted",
      body: `<h1>Your account is set to be deleted</h1>
${
  due
    ? `<p>The time to keep it has passed (${when}). Your memory, its backups and its key are being erased now.</p>`
    : `<p>Your account and memory are locked, and will be erased after <strong>${when}</strong>: your memory, its backups and its key. Until then your memory isn't read by us or any AI, shown or used.</p>
${
  opts.keepAccount === undefined
    ? ""
    : `<form method="post" action="/account/keep"><input type="hidden" name="csrf" value="${token}"><button type="submit">Keep my account</button></form>
<p class="muted">${escapeHtml(KEEP_WORDS)}</p>`
}
${
  opts.deleteAccount === undefined
    ? ""
    : `<h2>Delete everything now</h2>
<form method="post" action="/account/delete"><input type="hidden" name="csrf" value="${token}"><input type="hidden" name="when" value="now">
<p class="muted">Instead of waiting until ${when}: ${escapeHtml(DELETE_NOW_WORDS)} ${escapeHtml(AFTER_ERASE_WORDS)}</p>
<label>Type your email address to confirm<br><input type="email" name="confirm" autocomplete="off"></label>
<button type="submit">Delete everything now</button></form>`
}`
}
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${token}"><button type="submit">Sign out</button></form>`,
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
      if (pendingOf(req) !== null) {
        // Signed in, with a delete pending: the one page they have (an Allow page's `next` would only send them back here).
        redirect(res, "/account");
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
            try {
              opts.accounts.audit(null, null, "mail.failed", null);
            } catch {
              /* a late failure on a closed or busy database is not an unhandled rejection */
            }
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
      // A session this browser already carried ends here: one browser, one session row.
      opts.accounts.endSession(parseCookies(req).get(names.session) ?? null);
      const session = opts.accounts.startSession(used.personId);
      redirect(res, safeNext(url.searchParams.get("next")), { "Set-Cookie": cookie(names.session, session, { secure: names.secure, maxAgeS: SESSION_MAX_AGE_S }) });
      return true;
    }
    if (p === "/account" && req.method === "GET") {
      const browser = browserOf(req, res);
      const personId = personOf(req);
      if (personId === null) {
        const pending = pendingOf(req);
        if (pending !== null) {
          pendingPage(res, browser, pending);
          return true;
        }
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
    : `<h2>Delete your account</h2>
<form method="post" action="/account/delete"><input type="hidden" name="csrf" value="${token}">
${opts.scheduleDelete === undefined ? "" : `<p class="muted">${escapeHtml(DELETE_LATER_WORDS)}</p>`}
<label>Type your email address to confirm<br><input type="email" name="confirm" autocomplete="off"></label>
${opts.scheduleDelete === undefined ? "" : `<button type="submit" name="when" value="later">Delete my account (24 hours to change your mind)</button>\n<p class="muted">Or delete everything now: ${escapeHtml(DELETE_NOW_WORDS)}</p>`}
<button type="submit" name="when" value="now">Delete everything now</button>
<p class="muted">${escapeHtml(AFTER_ERASE_WORDS)} ${escapeHtml(FORGET_WORDS)}</p></form>`
}
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${token}"><button type="submit">Sign out</button></form>`,
      });
      return true;
    }
    if ((p === "/account/delete" || p === "/account/keep") && req.method === "POST") {
      // The two doors a pending delete keeps open (R6): keep, and delete now.
      const browser = parseCookies(req).get(names.browser);
      const form = await readForm(req);
      const active = personOf(req);
      const pending = active === null ? pendingOf(req) : null;
      const personId = active ?? pending;
      if (form === null || !sameOrigin(req, opts.publicOrigin) || !csrf.check(browser, form.get("csrf")) || personId === null) {
        message(res, 403, "Start again", "This form expired or came from somewhere else.", { href: "/account", text: "Your account" });
        return true;
      }
      if (p === "/account/keep") {
        if (opts.keepAccount === undefined) return false;
        if (pending === null) {
          redirect(res, "/account");
          return true;
        }
        let kept: boolean;
        try {
          kept = opts.keepAccount(pending);
        } catch {
          // The connections couldn't be revoked first, so nothing was kept (#659 review).
          message(res, 503, "Try again", "Your account couldn't be kept just now. Nothing changed: it is still set to be deleted. Try again in a minute.", { href: "/account", text: "Your account" });
          return true;
        }
        if (!kept) {
          message(res, 409, "Too late to keep it", "The time to keep your account has passed, and it is being erased now.");
          return true;
        }
        page(res, 200, {
          title: "Kept",
          body: `<h1>Your account is kept</h1><p>Your account and memory are back as they were. Your connected AIs were disconnected when you deleted: connect them again from Claude, with the address <code>${escapeHtml(opts.publicOrigin)}/mcp</code>.</p><p><a href="/account">Your account</a></p>`,
        });
        return true;
      }
      if (opts.deleteAccount === undefined) return false;
      const person = opts.accounts.person(personId);
      const typed = (form.get("confirm") ?? "").trim().toLowerCase();
      if (person === null || person.email === null || typed !== person.email) {
        message(res, 400, "Not deleted", "The address you typed doesn't match this account's. Nothing was deleted.", { href: "/account", text: "Back" });
        return true;
      }
      const signOut = { "Set-Cookie": cookie(names.session, "", { secure: names.secure, maxAgeS: 0 }) };
      // The address and the zone, read BEFORE the delete: delete now purges them (R9).
      const to = person.email;
      // (A pending person's `storeId` is null: the store is locked. Its id is still the log's tag.)
      const storeId = person.storeId ?? opts.accounts.storesToDelete(personId)[0] ?? null;
      /**
       * One email per delete the person made (R9). NOT awaited, and a failure
       * changes nothing: the delete stands and the page is the same. The failure
       * is audited and logged by store (the operator's tag), never by address.
       */
      const mail = (m: { to: string; subject: string; text: string }): void => {
        let sending: Promise<void>;
        try {
          sending = opts.mailer.send(m);
        } catch (err) {
          sending = Promise.reject(err);
        }
        void sending.catch(() => {
          // It can land long after the page (a provider's timeout), on a closed or busy database.
          try {
            opts.accounts.audit(personId, storeId, "delete.mail.failed", null);
          } catch {
            /* the log line below still says it */
          }
          try {
            opts.onDeleteMailFailed?.(storeId);
          } catch {
            /* a log, not a gate */
          }
        });
      };
      // Delete is LATER unless "now" was pressed (R6). A pending delete can only be made "now".
      if (form.get("when") !== "now" && opts.scheduleDelete !== undefined) {
        if (pending !== null) {
          redirect(res, "/account");
          return true;
        }
        const deadline = await opts.scheduleDelete(personId);
        const words = deadlineWords(deadline ?? now(), person.timeZone);
        // Only a delete that set the deadline sends: a second one (two tabs) set nothing.
        if (deadline !== null) mail(deleteLaterMail(to, words, opts.publicOrigin));
        page(res, 200, {
          title: "Set to be deleted",
          headers: signOut,
          body: `<h1>Your account is set to be deleted</h1><p>${escapeHtml(LOCKED_WORDS)} After <strong>${escapeHtml(words)}</strong> your memory, its backups and its key are erased.</p><p>Changed your mind? Sign in before then and keep your account. Your connected AIs stay disconnected: you connect them again.</p><p class="muted">${escapeHtml(AFTER_ERASE_WORDS)}</p>${deadline === null ? "" : `<p class="muted">${escapeHtml(MAIL_ON_ITS_WAY)}</p>`}<p><a href="/login">Sign in</a></p>`,
        });
        return true;
      }
      const finished = await opts.deleteAccount(personId).then(
        () => true,
        () => false,
      );
      if (!finished) {
        // Did the erase begin (the person marked deleting, durably)? A failure before
        // that (a database error, a server not ready) changed nothing: no email, and
        // the person is told to try again (the #662 review).
        let state: string | null = null;
        try {
          state = opts.accounts.person(personId)?.state ?? null;
        } catch {
          state = null;
        }
        if (state !== "suspended" && state !== "deleted") {
          message(
            res,
            503,
            "Try again",
            pending === null
              ? "Your account couldn't be deleted just now. Nothing changed. Try again in a minute."
              : "Your account couldn't be deleted just now. Nothing changed: it is still set to be deleted. Try again in a minute.",
            { href: "/account", text: "Your account" },
          );
          return true;
        }
      }
      mail(deleteNowMail(to, finished));
      if (!finished) {
        // The account is already closed (sessions and grants gone, the store marked
        // deleting); the server finishes the rest on its own (`finishPendingDeletes`).
        page(res, 202, {
          title: "Deleting",
          headers: signOut,
          body: `<h1>Deleting</h1><p>${escapeHtml(ERASING_WORDS)}</p><p class="muted">${escapeHtml(MAIL_ON_ITS_WAY)}</p>`,
        });
        return true;
      }
      page(res, 200, {
        title: "Deleted",
        headers: signOut,
        body: `<h1>Deleted</h1><p>${escapeHtml(ERASED_WORDS)} Thank you for trying Counterparts.</p><p class="muted">${escapeHtml(MAIL_ON_ITS_WAY)}</p>`,
      });
      return true;
    }
    if (p === "/account/export" && req.method === "POST") {
      const browser = parseCookies(req).get(names.browser);
      const form = await readForm(req);
      const personId = personOf(req);
      if (form === null || !sameOrigin(req, opts.publicOrigin) || !csrf.check(browser, form.get("csrf")) || personId === null) {
        message(res, 403, "Start again", "This form expired or came from somewhere else.", { href: "/account", text: "Your account" });
        return true;
      }
      {
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
    }
    if ((p === "/account/timezone" || p === "/account/disconnect" || p === "/logout") && req.method === "POST") {
      const browser = parseCookies(req).get(names.browser);
      const form = await readForm(req);
      // Signing out is open to a pending delete too; the other two are not (R6).
      const personId = personOf(req) ?? (p === "/logout" ? pendingOf(req) : null);
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
