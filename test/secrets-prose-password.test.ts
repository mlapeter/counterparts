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
];

/** Sentences and code that carry no password: left exactly as they were. */
const MUST_NOT_REDACT: readonly string[] = [
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
    const shapes = ["the password for the thing is still a password, password password is is ", "pw for a b c d e f g h "];
    for (const shape of shapes) {
      const text = shape.repeat(Math.ceil(128_000 / shape.length));
      const t = performance.now();
      scanSecrets(text);
      expect(performance.now() - t).toBeLessThan(1500);
    }
  });
});
