/**
 * SX1 — a password said in a sentence is redacted, the value only.
 *
 * A reviewer said "my password is …" in a sentence; it was kept word for word in
 * the memory and in the raw buffer, because the gate only knew credential SHAPES
 * and a password under its name with `:` or `=` after it. The `password` family
 * takes the value and keeps the sentence. The false-positive table is the other
 * half of the rule: ordinary sentences about passwords, and code, stay exactly as
 * they were. Pure function, no store. The real paths are in `sx1-raw-buffer.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { redactSecrets, scanSecrets } from "../src/core/encode/secrets.js";

/** Each sentence, and the value that must not survive it. */
const MUST_REDACT: readonly (readonly [string, string])[] = [
  ["my password is hunter2", "hunter2"],
  // A hyphenated value whose last part is a describing word: a digit in it, or the whole value.
  ["my password is hunter-secret", "hunter-secret"],
  ["pw 1.2.3-dev-secret", "1.2.3-dev-secret"],
  ["the wifi password is sunflower-private", "sunflower-private"],
  ["my password is tiger7-secret", "tiger7-secret"],
  ["the password is 42-secret", "42-secret"],
  ["pw 99-problem", "99-problem"],
  ["my password was moon-public", "moon-public"],
  ["my password is hunter-secret lol", "hunter-secret"],
  ["the router password is bluefox-new", "bluefox-new"],
  ["password: frog-secret", "frog-secret"],
  ["My password is hunter2.", "hunter2"],
  ["the wifi password's sunflower42", "sunflower42"],
  ["the wifi password’s sunflower42", "sunflower42"],
  ["pw for the router is X9kq7", "X9kq7"],
  ["passcode 4471", "4471"],
  ["the passcode is 4471", "4471"],
  ["my PIN is 4471", "4471"],
  ["the pin for the door is 0815", "0815"],
  ["PIN 1234 opens the side gate", "1234"],
  ["pw hunter2", "hunter2"],
  ["my password hunter2 worked again", "hunter2"],
  ["the password for the admin account is Tr0ub4dor&3", "Tr0ub4dor&3"],
  ["the password I use for gmail is sunflower", "sunflower"],
  ["the password is now hunter3", "hunter3"],
  ["password was changed to Hunter-77 yesterday", "Hunter-77"],
  ["the passphrase is correct-horse-battery-staple", "correct-horse-battery-staple"],
  ["the password is 'correct horse battery staple'", "correct horse battery staple"],
  ['his password is "blue sky 99"', "blue sky 99"],
  ["password is: hunter2", "hunter2"],
  ["password - sunflower42", "sunflower42"],
  ["the laptop password was tigerlily7, I think", "tigerlily7"],
  ["password is hunter2, and the pin is 4471.", "4471"],
  ["wifi pw: hunter2", "hunter2"],
  ["passcode: 4471", "4471"],
  ["Das Passwort ist sonnenblume42", "sonnenblume42"],
  ["mi contraseña es girasol42", "girasol42"],
  ["mon mot de passe est tournesol42", "tournesol42"],
  ["minha senha é girassol42", "girassol42"],
  ["the password is hunter2 in the docs example, which is a meme", "hunter2"],
  // Third check (#788): "to <value> <more words>" read as a "for the router" clause first.
  ["I changed my netflix password to sunflowerRiver88 yesterday", "sunflowerRiver88"],
  ["i set my apple id password to Kestrel*Moon5 just now", "Kestrel*Moon5"],
  ["we updated the router password to Tangerine44 after the outage last week", "Tangerine44"],
  ["she reset her bank password to Orchid&Rain7 on monday morning", "Orchid&Rain7"],
  ["my pw is Quill.Saddle.Fern.12", "Quill.Saddle.Fern.12"],
];

/** Sentences and code that carry no password: left exactly as they were. */
const MUST_NOT_REDACT: readonly string[] = [
  // Hyphenated prose: a description, not a value.
  "a well-known password",
  "the password is top-secret",
  "my password is brand-new",
  "the password is non-public",
  "the password is super-secret",
  "the password is semi-private",
  "the password is time-sensitive and expires friday",
  "the password is user-specific",
  "the password is admin-managed",
  "my password is well-known to the whole team",
  "I forgot my password",
  "the password field is empty",
  "password reset flow",
  "passwords should be long",
  "password: string",
  "password: string;",
  "pin: number",
  "the password is in 1Password",
  "password is required",
  "password is wrong.",
  "the password is incorrect",
  "the password is the one I gave you",
  "the password is your birthday",
  "the password is complicated",
  "the password is still wrong",
  "password's length is 12",
  "the password's strength is weak",
  "my password manager is great",
  "password is $DB_PASSWORD",
  "the password is <your password>",
  "password is ****",
  "the pin is loose",
  "the pin was bent",
  "pin 3 of the connector",
  "pwd is /home/u1/proj",
  "if password is None:",
  "if pin is not None:",
  "pw = getpass()",
  "const pw = req.body.pw;",
  "password = os.environ[\"DB_PASSWORD\"]",
  "the password policy v2 ships Friday",
  "Das Passwort ist falsch",
  "la contraseña es incorrecta",
  "what is the password?",
  "the password is at least 12 characters",
  "I set a new password for the router",
  "the pin\n1234 Main St",
  "I changed my password to something stronger yesterday",
  // Found by running the fix round's family over this repository's own code and notes.
  "Counting a score of at least 0.5 as a pass: 128K 74.1%, 1M 73.3%",
  "Third adversarial pass: 0 BLOCKER, 2 nits",
  "first pass: `web/narrate.ts` gained a line",
  "pin `COUNTERPARTS_SESSION` into the child's env",
  "2. reads the pin from the repository's `marketplace.json` (at a release tag)",
  `...(typeof flags["passphrase"] === "string" ? { passphrase: flags["passphrase"] } : {}),`,
  `style="--pin:' + f.color + '"`,
  `{ question: "what is the bike lock code?", mode: "facts" }`,
  'pass: "PASS",',
  "pass: passRecord(input),",
  "// A year with a noun after it is not a PIN: \"PIN 2024 rollout\".",
];

describe("a password named in a sentence: the value goes, the sentence stays", () => {
  for (const [sentence, value] of MUST_REDACT) {
    test(sentence, () => {
      const out = redactSecrets(sentence);
      expect(out).not.toContain(value);
      expect(out).toContain("[REDACTED:");
      // The sentence stays: what is left still says a password was there.
      expect(out.replace(/\[REDACTED:[a-z-]+\]/g, "").trim().length).toBeGreaterThan(0);
    });
  }

  test("the marker names the family, and the rest of the sentence is untouched", () => {
    expect(redactSecrets("my wifi password is hunter2.")).toBe("my wifi password is [REDACTED:password].");
    expect(redactSecrets("the wifi password's sunflower42")).toBe("the wifi password's [REDACTED:password]");
    expect(redactSecrets("passcode 4471")).toBe("passcode [REDACTED:password]");
  });

  test("telemetry carries the family and the count, never the value", () => {
    const scan = scanSecrets("my password is hunter2 and the pin is 4471");
    expect(scan.findings).toEqual([{ family: "password", count: 2, site: "body" }]);
    expect(JSON.stringify(scan.findings)).not.toContain("hunter2");
  });

  test("redacting twice is redacting once", () => {
    for (const [sentence] of MUST_REDACT) {
      const once = redactSecrets(sentence);
      expect(redactSecrets(once)).toBe(once);
    }
  });

  test("a copy of a long value elsewhere in the text goes too", () => {
    const out = redactSecrets("my password is Sunflower-2024. I typed Sunflower-2024 twice.");
    expect(out).not.toContain("Sunflower-2024");
  });
});

describe("the false-positive table: ordinary sentences and code stay exactly as they were", () => {
  for (const sentence of MUST_NOT_REDACT) {
    test(sentence, () => {
      const scan = scanSecrets(sentence);
      expect({ sentence, out: scan.redacted, fired: scan.fired }).toEqual({ sentence, out: sentence, fired: false });
    });
  }
});

describe("the scan stays linear on long prose about passwords", () => {
  test("128 KB of near-misses scans in well under a second", () => {
    // A run of spaces with no line break is the shape a lookbehind at every position made quadratic
    // (43 s at 200 KB during the fix round); "pin " and "it's … password" exercise the anchors' reads.
    const shapes = [
      "the password for the thing is still a password, password password is is ",
      "pw for a b c d e f g h ",
      " ",
      "pin ",
      "it's x1x1 password ",
    ];
    for (const shape of shapes) {
      const text = shape.repeat(Math.ceil(128_000 / shape.length));
      const t = performance.now();
      scanSecrets(text);
      expect(performance.now() - t).toBeLessThan(1500);
    }
  });
});

/** The first reviewer's 53 phrasings of a real password (fix round of #788): [sentence, value]. */
const REVIEW_PASSWORDS: readonly (readonly [string, string])[] = [
  ["hey can you remember my netflix password? it's bluefish88", "bluefish88"],
  ["the wifi is HomeNet5G and the password is mangotango", "mangotango"],
  ["set it to Kx7#mPq2 when you reset the admin password", "Kx7#mPq2"],
  ["The password is \"Purple Elephant 42\"", "Purple Elephant 42"],
  ["Rosebud1979 is my password for everything lol", "Rosebud1979"],
  ["my passphrase is correct horse battery staple", "correct horse battery staple"],
  ["password is hunter2!!", "hunter2"],
  ["my password is\nzebra-crossing-91", "zebra-crossing-91"],
  ["MY PASSWORD IS TIGERLILY77", "TIGERLILY77"],
  ["PW: snowcat42", "snowcat42"],
  ["my pasword is lemonade12", "lemonade12"],
  ["my passwrod is lemonade12", "lemonade12"],
  ["my password iz lemonade12", "lemonade12"],
  ["the password to my laptop is qwerty123", "qwerty123"],
  ["My Gmail password is Bananas#2020.", "Bananas#2020"],
  ["I changed my password to Ocelot!99 yesterday", "Ocelot!99"],
  ["my new password is Ocelot!99", "Ocelot!99"],
  ["Password = Ocelot!99", "Ocelot!99"],
  ["password -> Ocelot!99", "Ocelot!99"],
  ["username mike, password Ocelot!99", "Ocelot!99"],
  ["my bank PIN is 4419", "4419"],
  ["pin number 4419", "4419"],
  ["my debit card pin's 4419", "4419"],
  ["the alarm code is 7731", "7731"],
  ["the door code is 7731#", "7731"],
  ["our wifi password: sunnyday2023", "sunnyday2023"],
  ["the password is sunshine", "sunshine"],
  ["my password is literally just password123", "password123"],
  ["my password is 'iloveyou'", "iloveyou"],
  ["password for the router: admin1234", "admin1234"],
  ["remember that my apple id password is Gr33nTea", "Gr33nTea"],
  ["My passcode for the iPad is 482915", "482915"],
  ["it's Gr33nTea, the password I mean", "Gr33nTea"],
  ["the password for wifi is “coffee-shop-77”", "coffee-shop-77"],
  ["password is Gr33nTea — don't share it", "Gr33nTea"],
  ["Password: Gr33nTea\nUsername: mike", "Gr33nTea"],
  ["the master password is MaplesyrupInJanuary", "MaplesyrupInJanuary"],
  ["my password was pancakes and now it's waffles99", "waffles99"],
  ["my wifi password is the word dragonfly", "dragonfly"],
  ["The PASSWORD is hunter2", "hunter2"],
  ["password? hunter2", "hunter2"],
  ["pass: hunter2xx", "hunter2xx"],
  ["The wifi key is FrogPond2024", "FrogPond2024"],
  ["my password is hunter2 lol", "hunter2"],
  ["my password is: blue skies over denver", "blue skies over denver"],
  ["my password is Blue Skies Over Denver", "Blue Skies Over Denver"],
  ["my password is purple", "purple"],
  ["the password I gave you is Gr33nTea", "Gr33nTea"],
  ["the vpn password is 'S3cure Tunnel'", "S3cure Tunnel"],
];

/** Of those, the ones still kept: known trade-offs, each with its reason in the PR. Move a row up when it is caught. */
const KNOWN_MISSES: readonly (readonly [string, string])[] = [
  ["use Spring2024! for the staging login", "Spring2024!"],
  ["the code is 8812 for the garage", "8812"],
  ["the login is mike@example.com / Ocelot!99", "Ocelot!99"],
  ["the password is my dog's name plus 2019, so Biscuit2019", "Biscuit2019"],
];

/** The reviewer's 97 ordinary sentences: left exactly as they were. */
const REVIEW_ORDINARY: readonly string[] = [
  "my password is too short",
  "the password is wrong",
  "the PIN is 4 digits long",
  "the PIN is four digits long",
  "my password is expired again",
  "your password is not strong enough",
  "the password is case-sensitive",
  "the password is stored in the keychain",
  "the password is hashed with bcrypt",
  "the password is never logged",
  "the password is sent over TLS",
  "the password was rejected by the server",
  "my password was reset by IT",
  "the password is on a sticky note somewhere",
  "your password must be at least 8 characters",
  "Enter your password to continue",
  "Password must contain a number and a symbol",
  "the password is too weak, try again",
  "the password is the same as last time",
  "my password is saved in Chrome",
  "the password is managed by Okta",
  "the password was compromised in a breach",
  "the password is generated by the script",
  "the password is passed as an env var",
  "the password is optional for guests",
  "password is null when the user signs in with Google",
  "the pin is 2.54mm pitch",
  "the PIN is 6 digits on new cards",
  "my PIN is locked after three tries",
  "the PIN was blocked",
  "the password is a secret, obviously",
  "the password was changed recently",
  "my password is not working",
  "your password is about to expire",
  "the password is longer than 64 characters",
  "the password is validated on the client",
  "the password was 12 characters",
  "the password is hidden behind dots",
  "in this PR the password is read from vault",
  "the password is checked against HIBP",
  "Forgot password? Click here",
  "the password is encrypted at rest",
  "password is a required field",
  "the password should be rotated every 90 days",
  "my wifi password is written on the router",
  "the password is under the keyboard",
  "the code is 404 not found",
  "the password for the account is what you set during onboarding",
  "pw reset emails are slow today",
  "PIN 2 on the Arduino is ground",
  "the password is: see 1Password",
  "the password was v2 of the policy",
  "the password is mine to choose",
  "password is TBD",
  "the password is up to you",
  "the password is irrelevant here",
  "the password is stolen",
  "the password is shown in plain text",
  "the password is set by the admin",
  "the password is given to new hires",
  "the password is kept in vault",
  "the password is plaintext in config.yml",
  "the password is base64-encoded",
  "the password is weaker than before",
  "the passcode is numeric",
  "Password - Show",
  "Password — Forgot?",
  "the password is bcrypt-hashed",
  "the password is UTF-8",
  "the password is SHA256 hashed",
  "the password is argon2id",
  "the password is 2FA-protected",
  "PIN 2024 rollout is next week",
  "the password is sent in the clear",
  "his password was leaked",
  "her password was obvious",
  "the password is whatever you want",
  "the password is ok",
  "the password is fine now",
  "this password is weird",
  "that password is gone",
  "the password is unchanged",
  "the password is overwritten",
  "the password is mandatory",
  "the password is lowercase",
  "the password is alphanumeric",
  "the password is too",
  "my password is also my username",
  "password is 8+ chars",
  "Password is >= 12 chars",
  "password's min length is 8",
  "my password is like 20 characters",
  "the password is: hidden",
  "the old password was compromised",
  "the password is a 4-digit PIN",
];

/** Of those, the ones still cut: an adjective at the end of the clause, kept as a trade (a missed password costs more). */
const KNOWN_FALSE_POSITIVES: readonly string[] = [
  "the password is irrelevant",
  "the password is important",
];

/** Gone: the value, and for a value of several words every word of four letters or more in it. */
function leaked(sentence: string, value: string, out: string): boolean {
  if (out.includes(value)) return true;
  return value.includes(" ") && value.split(" ").some((w) => w.length >= 4 && out.includes(w) && !sentence.toLowerCase().startsWith(w.toLowerCase()));
}

describe("the first review's set (fix round of #788): every phrasing, with what is expected", () => {
  for (const [sentence, value] of REVIEW_PASSWORDS) {
    test(`redacts: ${sentence}`, () => {
      const out = redactSecrets(sentence);
      expect({ sentence, out, leaked: leaked(sentence, value, out) }).toEqual({ sentence, out, leaked: false });
    });
  }
  for (const [sentence, value] of KNOWN_MISSES) {
    test(`known miss (a trade-off, PR body): ${sentence}`, () => {
      expect(redactSecrets(sentence)).toContain(value);
    });
  }
  for (const sentence of REVIEW_ORDINARY) {
    test(`leaves: ${sentence}`, () => {
      expect(redactSecrets(sentence)).toBe(sentence);
    });
  }
  for (const sentence of KNOWN_FALSE_POSITIVES) {
    test(`known false positive (a trade-off, PR body): ${sentence}`, () => {
      expect(redactSecrets(sentence)).toBe(sentence.replace(/is \S+$/, "is [REDACTED:password]"));
    });
  }
  test("counts on the review's set: 4 of 53 kept, 2 of 97 cut", () => {
    expect(REVIEW_PASSWORDS.length + KNOWN_MISSES.length).toBe(53);
    expect(KNOWN_MISSES.length).toBe(4);
    expect(REVIEW_ORDINARY.length + KNOWN_FALSE_POSITIVES.length).toBe(97);
    expect(KNOWN_FALSE_POSITIVES.length).toBe(2);
  });
});

describe("how much is taken: the value, never the rest of the line", () => {
  test("a multi-word value: a passphrase or a run of capitalised words goes to the end of its clause", () => {
    expect(redactSecrets("my passphrase is correct horse battery staple, I think")).toBe("my passphrase is [REDACTED:password], I think");
    expect(redactSecrets("my password is Blue Skies Over Denver. Easy.")).toBe("my password is [REDACTED:password]. Easy.");
    expect(redactSecrets("my password is: blue skies over denver")).toBe("my password is: [REDACTED:password]");
  });

  test("never across a line break, unless the next line is one secret-looking token", () => {
    expect(redactSecrets("the password is\nTomorrow we ship the release.")).toBe("the password is\nTomorrow we ship the release.");
    expect(redactSecrets("my password is\nzebra-crossing-91")).toBe("my password is\n[REDACTED:password]");
    expect(redactSecrets("my password is hunter2.\nNext line keeps going.")).toBe("my password is [REDACTED:password].\nNext line keeps going.");
  });

  test("a stray apostrophe does not open a quoted run", () => {
    const s = "the password is 'cause I said so, and that's that";
    expect(redactSecrets(s)).toBe(s);
  });

  test("a description with more of the clause after it is the sentence", () => {
    for (const s of [
      "my wifi password is written on the router. I have written three letters.",
      "the password is sent over TLS. I sent mom the photos.",
      "the password is longer than the pin. A longer walk.",
    ]) {
      expect(redactSecrets(s)).toBe(s);
    }
  });
});
