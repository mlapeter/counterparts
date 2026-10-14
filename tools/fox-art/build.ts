/**
 * The sidebar fox's picture tier, built from the art agent's PNG export
 * (2026-10-12). Reads `<src>/<frame>.png` and `<src>/fx-<name>.png` (native
 * art pixels x 8, palette or RGBA PNGs), and writes:
 *
 *   hooks/sidebar/art/fox/<key>.png   every frame, and every frame + effects
 *                                     pair a moment draws, at x SCALE (crisp)
 *
 * The mod reads them as files under `$.plugin.root` (an `Image` `{ file }` on
 * the terminal, the bytes once for the desktop's Svg); `fox.ts#PNG_FRAMES` names
 * the same set from the art data, and `PNG_SCALE` must match --scale. (Until
 * 2026-10-14 this also wrote hooks/sidebar/hooks/fox-png.ts, the PNGs as
 * base64; the plugin directory's validator refuses a module that looks like
 * encoded data.)
 *
 * The frame names, effects and their places come from the art data module
 * (`hooks/sidebar/hooks/fox-art.ts`), so an art fix is: copy the new data
 * module over fox-art.ts, run this on the new PNG folder, commit both.
 *
 * Usage: bun tools/fox-art/build.ts <png folder> [--scale 3]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

import { FOX_FINAL } from '../../hooks/sidebar/hooks/fox-art.js';

type Rgba = { w: number; h: number; px: Uint8Array };

const NATIVE = FOX_FINAL.png.scale; // the export's art pixel, in PNG pixels

function decode(buf: Uint8Array): Rgba {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 8;
  let w = 0, h = 0, depth = 8, type = 6;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o < buf.length) {
    const len = dv.getUint32(o);
    const name = String.fromCharCode(...buf.subarray(o + 4, o + 8));
    const data = buf.subarray(o + 8, o + 8 + len);
    if (name === 'IHDR') {
      w = dv.getUint32(o + 8);
      h = dv.getUint32(o + 12);
      depth = data[8] ?? 8;
      type = data[9] ?? 6;
      if ((data[12] ?? 0) !== 0) throw new Error('interlaced PNGs are not read');
    } else if (name === 'PLTE') plte = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = type === 6 ? 4 : type === 2 ? 3 : type === 4 ? 2 : 1;
  const bitsPx = depth * channels;
  const stride = Math.ceil((w * bitsPx) / 8);
  const bpp = Math.max(1, bitsPx / 8);
  const lines = new Uint8Array(stride * h);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? (out[i - bpp] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
      const x = line[i] ?? 0;
      let v = x;
      if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[i] = v & 255;
    }
    lines.set(out, y * stride);
    prev = out;
  }
  const px = new Uint8Array(w * h * 4);
  const sample = (y: number, i: number): number => {
    // the i-th sample of row y, at this bit depth
    if (depth === 8) return lines[y * stride + i] ?? 0;
    const bit = i * depth;
    const byte = lines[y * stride + (bit >> 3)] ?? 0;
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      if (type === 3) {
        const k = sample(y, x);
        px[d] = plte?.[k * 3] ?? 0;
        px[d + 1] = plte?.[k * 3 + 1] ?? 0;
        px[d + 2] = plte?.[k * 3 + 2] ?? 0;
        px[d + 3] = trns !== null && k < trns.length ? (trns[k] ?? 255) : 255;
      } else if (type === 6 && depth === 8) {
        for (let c = 0; c < 4; c++) px[d + c] = sample(y, x * 4 + c);
      } else throw new Error(`PNG type ${String(type)} at depth ${String(depth)} is not read`);
    }
  }
  return { w, h, px };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(name: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...name].map(c => c.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

function encode(img: Rgba): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, img.w);
  dv.setUint32(4, img.h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) raw.set(img.px.subarray(y * img.w * 4, (y + 1) * img.w * 4), y * (img.w * 4 + 1) + 1);
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

/** Native art pixels x NATIVE down to x scale, by sampling each art pixel's centre: crisp. */
function rescale(img: Rgba, scale: number): Rgba {
  const aw = Math.round(img.w / NATIVE), ah = Math.round(img.h / NATIVE);
  const w = aw * scale, h = ah * scale;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x / scale) * NATIVE + (NATIVE >> 1), sy = Math.floor(y / scale) * NATIVE + (NATIVE >> 1);
      px.set(img.px.subarray((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return { w, h, px };
}

/** `top` over `base` at (x, y), clipped; alpha over. */
function over(base: Rgba, top: Rgba, x0: number, y0: number): Rgba {
  const px = base.px.slice();
  for (let y = 0; y < top.h; y++) {
    for (let x = 0; x < top.w; x++) {
      const X = x0 + x, Y = y0 + y;
      if (X < 0 || Y < 0 || X >= base.w || Y >= base.h) continue;
      const s = (y * top.w + x) * 4, d = (Y * base.w + X) * 4;
      const a = (top.px[s + 3] ?? 0) / 255;
      if (a === 0) continue;
      for (let c = 0; c < 3; c++) px[d + c] = Math.round((top.px[s + c] ?? 0) * a + (px[d + c] ?? 0) * (1 - a));
      px[d + 3] = Math.max(px[d + 3] ?? 0, top.px[s + 3] ?? 0);
    }
  }
  return { w: base.w, h: base.h, px };
}

/** The key a frame and its effects are drawn under: `nap1+zSmall+z`. */
export function pngKey(frame: string, fx: readonly (readonly [string, string])[]): string {
  return [frame, ...fx.map(f => f[0])].join('+');
}

function main(): void {
  const args = process.argv.slice(2);
  const src = args.find(a => !a.startsWith('--'));
  if (src === undefined) throw new Error('usage: bun tools/fox-art/build.ts <png folder> [--scale 3]');
  const si = args.indexOf('--scale');
  const scale = si >= 0 ? Number(args[si + 1]) : 3;
  const root = join(import.meta.dir, '..', '..', 'hooks', 'sidebar');
  const outDir = join(root, 'art', 'fox');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const read = (file: string): Rgba => rescale(decode(new Uint8Array(readFileSync(join(src, file)))), scale);
  const frames = new Map<string, Rgba>();
  for (const name of Object.keys(FOX_FINAL.png.frames)) frames.set(name, read(`${name}.png`));
  const fx = new Map<string, Rgba>();
  for (const name of Object.keys(FOX_FINAL.png.fx)) fx.set(name, read(`fx-${name}.png`));
  const places = FOX_FINAL.png.fxPlace as Record<string, readonly number[]>;
  const out = new Map<string, Rgba>(frames);
  for (const steps of Object.values(FOX_FINAL.moments) as unknown as (readonly unknown[])[][]) {
    for (const step of steps) {
      const [frame, , ...rest] = step as [string, number, ...[string, string][]];
      if (rest.length === 0) continue;
      let img = frames.get(frame);
      if (img === undefined) throw new Error(`no frame ${frame}`);
      for (const [name, place] of rest) {
        const f = fx.get(name), p = places[place];
        if (f === undefined || p === undefined) throw new Error(`no effect ${name} at ${place}`);
        img = over(img, f, (p[0] ?? 0) * scale, (p[1] ?? 0) * scale);
      }
      out.set(pngKey(frame, rest), img);
    }
  }
  let bytes = 0;
  for (const [key, img] of out) {
    const png = encode(img);
    bytes += png.length;
    writeFileSync(join(outDir, `${key}.png`), png);
  }
  const first = out.values().next().value as Rgba;
  console.log(`${String(out.size)} PNGs, ${String(bytes)} bytes, ${String(first.w)} x ${String(first.h)}`);
}

if (import.meta.main) main();
