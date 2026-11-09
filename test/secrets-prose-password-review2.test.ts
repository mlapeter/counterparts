/**
 * SX1, second review of #788: fresh sentences, written by a reviewer who had not seen the
 * first set (its probes: 70 phrasings carrying a secret, 88 ordinary sentences, 38 edge
 * sentences, 11 Windows-text lines). Every one is a row here with what is expected. The
 * fixes behind them are causes, not rows: CRLF, a passphrase clause only when it reads as
 * one, `pwd` in a possessive frame, product names, "it's" in the clause that names it,
 * seed phrases, emoji and markup before a value. Pure function, no store.
 */
import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../src/core/encode/secrets.js";

/** [sentence, ...values that must not survive]. */
const REVIEW2_SECRETS: readonly (readonly [string, ...string[]])[] = [
  ["the pw on the NAS is Ferret#2210", "Ferret#2210"],
  ["login: mlapeter / password: tangerine9", "tangerine9"],
  ["my bank PIN, 5512, is also my locker code", "5512"],
  ["my bank pin is 5512 btw", "5512"],
  ["my password is 🔐 Zebra!42", "Zebra!42"],
  ["🔑 wifi password: MapleSyrup88 🔑", "MapleSyrup88"],
  ["the router password is **Kangaroo55**", "Kangaroo55"],
  ["the router password is `Kangaroo55`", "Kangaroo55"],
  ["router pw = `Kangaroo55`", "Kangaroo55"],
  ["sorry, I know I shouldn't paste this, but the password is Lobster_2023", "Lobster_2023"],
  ["ugh sorry — pw is Lobster_2023", "Lobster_2023"],
  ["the wifi password is Tulip2024 and the alarm code is 9031", "Tulip2024", "9031"],
  ["gmail password is Orchid#11, outlook password is Daisy#22", "Orchid#11", "Daisy#22"],
  ["ok so the password for the shared drive is pinecone88 and dont tell anyone lol", "pinecone88"],
  ["remember for me: the gate code is 4821", "4821"],
  ["gate code 4821#", "4821"],
  ["the garage door code is 1975", "1975"],
  ["alarm code: 0420", "0420"],
  ["the safe code is 31-17-05", "31-17-05"],
  ["our wifi key is Hedgehog-Party-9", "Hedgehog-Party-9"],
  ["The Wi-Fi key is cornflakes2001", "cornflakes2001"],
  ["recovery phrase: abandon ladder ocean velvet mango tiger orbit", "ladder ocean velvet"],
  ["my seed phrase is abandon ladder ocean velvet mango tiger orbit", "ladder ocean velvet"],
  ["the 12 word recovery phrase is tundra elbow lantern quiz ribbon salmon", "lantern quiz ribbon"],
  ["my passphrase is purple monkey dishwasher", "monkey dishwasher"],
  ["the passphrase for my ssh key: violet-anchor-river", "violet-anchor-river"],
  ["my mom's password is Grandkids4ever!", "Grandkids4ever!"],
  ["netflix pw: CouchPotato99", "CouchPotato99"],
  ["Password => Snowcone7", "Snowcone7"],
  ["passcode for the phone is 902211", "902211"],
  ["my phone passcode's 902211", "902211"],
  ["the iPad passcode = 4455", "4455"],
  ["new password: K9$unrise", "K9$unrise"],
  ["I reset the password to Paprika!3 this morning", "Paprika!3"],
  ["I just updated my password to Paprika!3", "Paprika!3"],
  ["the password, if you need it, is Paprika!3", "Paprika!3"],
  ["The password (case sensitive) is Paprika!3", "Paprika!3"],
  ["password = \"Paprika!3\" for the test account", "Paprika!3"],
  ["fwiw my work password is BlueMoon1999 and my home one is RedSun2001", "BlueMoon1999", "RedSun2001"],
  ["DB password is s3cr3tsauce, user is admin", "s3cr3tsauce"],
  ["here's the password to the VPN account Mxyzptlk42", "Mxyzptlk42"],
  ["the password to the VPN is Mxyzptlk42", "Mxyzptlk42"],
  ["password for wifi at moms house is HappyHome123", "HappyHome123"],
  ["my apple id pw is Granola!Bar5 please remember it", "Granola!Bar5"],
  ["the admin password is still admin123", "admin123"],
  ["the default password was changeme123 and I never changed it", "changeme123"],
  ["PIN for the card: 7720", "7720"],
  ["card pin 7720", "7720"],
  ["password is “Salamander44”", "Salamander44"],
  ["my password: Salamander44.", "Salamander44"],
  ["my pwd is Salamander44", "Salamander44"],
  ["My Password Is Salamander44", "Salamander44"],
  ["MY PASSWORD IS SALAMANDER44", "SALAMANDER44"],
  ["the password is like Salamander44 or something", "Salamander44"],
  ["the keypad code is 2288", "2288"],
  ["my locker combo is 12-34-56", "12-34-56"],
  ["wifi: network GuestNet, password Butterfly2020", "Butterfly2020"],
  ["password\nmarmalade77", "marmalade77"],
  ["- password: marmalade77", "marmalade77"],
  ["| wifi | password | marmalade77 |", "marmalade77"],
  ["it's Hibiscus11 — the wifi password, I mean", "Hibiscus11"],
  ["Hibiscus11 is the wifi password", "Hibiscus11"],
  ["i always forget this so: password is horsefeathers", "horsefeathers"],
  ["password is bluebird", "bluebird"],
  ["the password is Montana", "Montana"],
];

/** Still kept: known trade-offs, each with its reason in the PR. Move a row up when it is caught. */
const REVIEW2_KNOWN_MISSES: readonly (readonly [string, ...string[]])[] = [
  ["login: mike / Quokka77 (that's the password)", "Quokka77"],
  ["the PIN is seven seven two zero", "seven seven two zero"],
  ["password hint no, actual password yes: Salamander44", "Salamander44"],
  ["oh and the code to the building is 2288*", "2288"],
  ["my password is the same as my username plus 99, so mike99", "mike99"],
];

/** Ordinary sentences, the review's 88 and its 38 edge cases: left exactly as they were. */
const REVIEW2_ORDINARY: readonly string[] = [
  // security advice
  "Use a password manager and turn on two-factor authentication everywhere.",
  "A good password is long, unique and random.",
  "Never reuse a password across sites.",
  "Your PIN should not be your birthday.",
  "The passphrase approach is easier to remember than a complex password.",
  "If your password is short, attackers can brute force it.",
  "Change your password if you think it was exposed in a breach.",
  "A password is only as strong as the weakest place you've reused it.",
  "The password is the weakest link in most systems.",
  "Pick a passphrase of four or more random words.",
  "The PIN is four digits by default but can be up to twelve.",
  "Your password is never sent to our servers in plain text.",
  "the password is hashed with argon2 before storage",
  "the password is stored in the keychain",
  "the password is on a sticky note under the keyboard, which is terrible",
  "my passphrase is on the sticky note",
  "the passphrase is the same as before",
  "the password is the word that you chose at signup",
  "the password is something only you know",
  "the password is too short to be safe",
  "the password is twelve characters long",
  "the password is at least 8 characters",
  "the password is 8+ characters",
  // incident write-ups
  "Incident 2026-04: the admin password was reused from a 2019 breach.",
  "Root cause: the password was committed to a public repo.",
  "The attacker guessed the PIN after 3 attempts because lockout was disabled.",
  "Timeline: at 14:02 the password reset email was sent; at 14:05 the account was taken over.",
  "The password was rotated within 20 minutes of detection.",
  "The door code was shared in a Slack channel with 400 members.",
  "We found 312 accounts whose password was in the rockyou list.",
  "The passcode was brute-forced over 6 hours.",
  // product UI copy
  "Password must be at least 12 characters.",
  "Password for the account: enter at least 8 characters",
  "Enter your PIN to continue.",
  "Forgot your password? Reset it here.",
  "Confirm password",
  "Show password",
  "Your password was changed successfully.",
  "Your PIN has been updated.",
  "Wrong password. 2 attempts remaining.",
  "Passwords do not match.",
  "Passcode required after 5 minutes.",
  // password-manager reviews
  "1Password is my password manager and I love it.",
  "Bitwarden is my password manager of choice.",
  "1Password is the best password manager for families.",
  "KeePassXC is our team's password manager now.",
  "The password generator in Bitwarden defaults to 14 characters.",
  "Dashlane's password health score flagged 40 weak passwords.",
  "LastPass was breached in 2022 and password vaults were stolen.",
  "the password manager is 1Password 8",
  // code review comments
  "nit: the password is logged at debug level here, please remove",
  "the password field is optional in this schema, should it be?",
  "this test sets password to null and expects a 400",
  "Rename `pw` to `password` for clarity.",
  "We should never compare passwords with ==, use a constant-time compare.",
  "the PIN validation regex is wrong for 6-digit codes",
  "pass the config through instead of reading the env",
  "set it to 3600 when you reset the password expiry",
  "set it to v2 when the password schema migrates",
  // counterparts docs / changelog voice
  "Counterparts strips credentials in recognisable shapes, and passwords named in a sentence.",
  "The gate redacts a password before it is stored; the memory keeps that a password exists.",
  "0.3.48: a PIN named in a sentence is now redacted in the raw buffer too.",
  "first pass: 0 BLOCKER, 2 nits",
  "second pass: 12/15 rows green",
  "pass: 1200ms on the cold start",
  "Pass: 12/15",
  "The dream pass ran at 03:10 and kept 14 memories.",
  "pin the version to 0.3.47 until the migration lands",
  "pin `COUNTERPARTS_SESSION` in the test so it never drifts",
  "it's 4471, I'll pin it to the board",
  // pass in other senses
  "We drove over Independence Pass at dawn.",
  "The mountain pass was closed for snow until May.",
  "She'll pass the test easily.",
  "Did the build pass? It's green now.",
  "My boarding pass is in the Wallet app.",
  "The boarding pass says gate B12, seat 14C.",
  "Can you pass the salt?",
  "He made a pass at the bartender.",
  "The season pass is $899 this year.",
  "I'll take a pass on dinner tonight.",
  "the pin on the map is wrong, it's 2 blocks north",
  "my PIN code reader broke",
  "the bowling pin count was 9",
  "the code is 404 not found",
  "the password reset flow is broken on Safari 17",
  "my password is too long for their form, it's 2026 people",
  "the passphrase is mandatory for every export",
  "the passphrase is optional for local stores",
  "the passphrase is different from your password",
  "the passphrase is kinda long i made it from a song lyric my mom used to sing when we drove to the lake every summer",
  "the passphrase is unrecoverable if you lose it",
  "the passphrase is cached for 15 minutes",
  "the passphrase is only asked once per boot",
  "the passphrase is weak if it's a famous quote",
  "Your recovery passphrase is shown once, write it down",
  "Note on the password: we rotate it every 90 days",
  "About the PIN: four to twelve digits, no repeats",
  "Password for staging: ask Dana in #infra",
  "password for the wiki: same as SSO",
  "the password check fails because it's utf8mb4 in the db",
  "the password expired, it's v2.1 of the policy",
  "the PIN pad is broken, it's model X200 from 2019",
  "password reset is slow, it's 30s on average",
  "the password field moved, it's on step 2 now",
  "Password Manager Pro is what IT uses",
  "the password is Microsoft Authenticator based now",
  "the password is Okta managed",
  "the password is SSO only",
  "the password is N/A for service accounts",
  "the password is TBD",
  "the password is WIP",
  "the password is AWS Secrets Manager's job now",
  "the wifi password is on the fridge",
  "the wifi password is printed on the back of the router",
  "the pin is 2 inches long",
  "the PIN is 4-6 digits",
  "the door code changed again",
  "pw reset tickets doubled in Q3",
  "the passcode is up to the user",
];

/**
 * Still cut. Two of these (`Password: ••••` / `****`) and "Password: rotate…" are the
 * catch-all's, unchanged from master; four are example passwords, which are passwords.
 */
const REVIEW2_KNOWN_CUTS: readonly string[] = [
  "Password: ••••••••",
  "Password: ********",
  "Password: rotate every 90 days and never share",
  "PIN 1234 is the most common PIN, so never use it",
  "the password is 123456 in 23% of breaches, per the report",
  "the password was Password1 in the 2019 audit, a known example",
  "the password hunter2 is a famous IRC joke",
];

/** Windows text: a `\r` never hides a word from the lists, and is never eaten. */
const REVIEW2_CRLF: readonly string[] = [
  "Password - Show\r\nUsername",
  "Password -> Hidden\r\nnext",
  "pass: done\r\nnext",
  "Pass: green\r\nnext",
  "the password is fine\r\nnext",
  "the password is wrong\r\nnext",
  "password? yes\r\nnext",
  "I reset the password to default\r\nnext",
  "the password is it\r\n",
  "Change password\r\nPassword is required\r\nPassword is invalid\r\n",
  "pw - none\r\n",
];

describe("the second review's set (#788): fresh phrasings", () => {
  for (const [sentence, ...values] of REVIEW2_SECRETS) {
    test(`redacts: ${JSON.stringify(sentence)}`, () => {
      const out = redactSecrets(sentence);
      expect({ sentence, survived: values.filter((v) => out.includes(v)) }).toEqual({ sentence, survived: [] });
    });
  }
  for (const [sentence, ...values] of REVIEW2_KNOWN_MISSES) {
    test(`known miss: ${JSON.stringify(sentence)}`, () => {
      const out = redactSecrets(sentence);
      expect(values.some((v) => out.includes(v))).toBe(true);
    });
  }
  for (const sentence of REVIEW2_ORDINARY) {
    test(`leaves: ${JSON.stringify(sentence)}`, () => {
      expect(redactSecrets(sentence)).toBe(sentence);
    });
  }
  for (const sentence of REVIEW2_KNOWN_CUTS) {
    test(`known cut: ${JSON.stringify(sentence)}`, () => {
      expect(redactSecrets(sentence)).not.toBe(sentence);
    });
  }
  for (const sentence of REVIEW2_CRLF) {
    test(`Windows text left whole: ${JSON.stringify(sentence)}`, () => {
      expect(redactSecrets(sentence)).toBe(sentence);
    });
  }
  test("counts: 5 of 70 kept, 2 of 88 cut (both the catch-all's, as on master)", () => {
    expect(REVIEW2_SECRETS.length + REVIEW2_KNOWN_MISSES.length).toBe(70);
    expect(REVIEW2_KNOWN_MISSES.length).toBe(5);
  });
});

describe("the second review's extent cases", () => {
  test("a value on the next line of Windows text is taken, and the \r\n stays", () => {
    expect(redactSecrets("PASSWORD IS\r\nhunter22\r\n")).toBe("PASSWORD IS\r\n[REDACTED:password]\r\n");
  });
  test("a plain-word value is not carried to its other copies; a secret-shaped one is", () => {
    expect(redactSecrets("my password is Wednesday. See you Wednesday at the Wednesday meeting.")).toBe(
      "my password is [REDACTED:password]. See you Wednesday at the Wednesday meeting.",
    );
    expect(redactSecrets("my password is Hunter2024. Hunter2024 is also my dog's name.")).toBe(
      "my password is [REDACTED:password]. [REDACTED:password] is also my dog's name.",
    );
  });
  test("a product name is never a value, and never spreads", () => {
    const s = "1Password is my password manager. I installed 1Password on the Mac.";
    expect(redactSecrets(s)).toBe(s);
  });
  test("a seed phrase goes whole", () => {
    expect(redactSecrets("my seed phrase is abandon ladder ocean velvet mango tiger orbit")).toBe(
      "my seed phrase is [REDACTED:password]",
    );
  });
  test("`pwd` alone is the working directory; in a possessive frame it is a password", () => {
    expect(redactSecrets("pwd is /home/u1/proj and pwd prints it")).toBe("pwd is /home/u1/proj and pwd prints it");
    expect(redactSecrets("the pwd for the NAS is Salamander44")).toBe("the pwd for the NAS is [REDACTED:password]");
  });
});
