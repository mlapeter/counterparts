/**
 * The fox's sheet, the real file: every frame the sidebar can cut from it is a
 * whole PNG of the size the tier expects, and the cut base64 is exactly what
 * encoding those bytes would give. The sidebar's own tests (hooks/sidebar/tests,
 * `claude plugin test`) read a stand-in, since a module's `$.fs` is faked there.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SHEET_BYTES, SHEET_FILE, SHEET_FRAMES } from "../hooks/sidebar/hooks/fox-sheet.js";
import { packFrames } from "../tools/fox-art/build.js";

// By a computed path: the mod has its own tsconfig (no file extensions), so the repository's typecheck stays out of it.
const { frameBase64, sheetFits, PNG_FRAMES, PNG_SIZE } = (await import(join(import.meta.dir, "..", "hooks/sidebar/hooks/fox.ts"))) as {
  frameBase64: (sheet: string, key: string) => string;
  sheetFits: (sheet: string) => boolean;
  PNG_FRAMES: ReadonlySet<string>;
  PNG_SIZE: readonly [number, number];
};

const sheet =readFileSync(join(import.meta.dir, "..", "hooks/sidebar/art/fox", SHEET_FILE));
const sheet64 = sheet.toString("base64");
const IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("the fox's sheet", () => {
  test("is the size the table says, and holds no = to cut around", () => {
    expect(sheet.length).toBe(SHEET_BYTES);
    expect(sheet64.length).toBe((SHEET_BYTES / 3) * 4);
    expect(sheet64).not.toContain("=");
  });

  test("every frame is a whole PNG at the picture tier's size, and its cut base64 is those bytes' own", () => {
    expect(Object.keys(SHEET_FRAMES).sort()).toEqual([...PNG_FRAMES].sort());
    for (const [key, [at, len]] of Object.entries(SHEET_FRAMES)) {
      const png = sheet.subarray(at, at + len);
      expect(png.subarray(0, 8).equals(SIGNATURE)).toBe(true);
      expect(png.subarray(len - 12).equals(IEND)).toBe(true);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([PNG_SIZE[0], PNG_SIZE[1]]);
      expect(frameBase64(sheet64, key)).toBe(png.toString("base64"));
    }
  });

  test("fits its table; shortened, or moved at the same length, it doesn't", () => {
    expect(sheetFits(sheet64)).toBe(true);
    expect(sheetFits(sheet64.slice(0, -4))).toBe(false);
    expect(sheetFits(sheet64.slice(4) + "AAAA")).toBe(false);
    // One frame's start damaged, the rest whole.
    const [lastAt] = Object.values(SHEET_FRAMES).at(-1) as readonly [number, number];
    const at = (lastAt / 3) * 4;
    expect(sheetFits(`${sheet64.slice(0, at)}AAAA${sheet64.slice(at + 4)}`)).toBe(false);
  });

  test("a key it doesn't hold draws the idle frame", () => {
    expect(frameBase64(sheet64, "no-such")).toBe(frameBase64(sheet64, "idle"));
  });

  test("packing is order-free and keeps each frame's bytes, for every remainder of 3", () => {
    const frames = new Map([
      ["c", Uint8Array.of(1, 2, 3, 4)],
      ["a", Uint8Array.of(9)],
      ["b", Uint8Array.of(7, 8)],
      ["d", Uint8Array.of(5, 6, 7)],
    ]);
    const { sheet: s, table } = packFrames(frames);
    expect(table).toEqual({ a: [0, 1], b: [3, 2], c: [6, 4], d: [12, 3] });
    expect(s.length).toBe(15);
    const b64 = Buffer.from(s).toString("base64");
    for (const [key, bytes] of frames) {
      const [at, len] = table[key] as [number, number];
      const pad = (3 - (len % 3)) % 3;
      const start = (at / 3) * 4;
      expect(b64.slice(start, start + Math.ceil(len / 3) * 4 - pad) + "=".repeat(pad)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });
});
