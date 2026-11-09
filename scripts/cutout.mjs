// Cut a character out of a flat-colour background and save it as a trait.
//
//   node scripts/cutout.mjs <image> <trait> [--layer character] [--tolerance 70] [--pad 0.04] [--tight 1]
//
// --tight keeps the exact opaque bounds (no squaring): use it for accessories
// whose bottom edge must be the seat line (hat brims).
//
// The key colour is sampled from the four corners. Pixels within --tolerance
// (RGB distance) of it become transparent; the result is cropped to the
// opaque bounds, padded to a square, and written to layers/character/<trait>.png.
// Run scripts/defringe.mjs on it afterwards (always).
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { layerPath } from "./lib/compose.mjs";

const [src, trait, ...rest] = process.argv.slice(2);
if (!src || !trait) { console.error("usage: node scripts/cutout.mjs <image> <trait> [--tolerance N] [--pad F]"); process.exit(1); }
const opt = {}; for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = rest[i + 1];
const tol = Number(opt.tolerance ?? 70), padF = Number(opt.pad ?? 0.04), layer = opt.layer ?? "character", tight = opt.tight === "1";

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, at = (x, y) => (y * W + x) * 4;
const corners = [at(2, 2), at(W - 3, 2), at(2, H - 3), at(W - 3, H - 3)];
const key = [0, 1, 2].map((c) => Math.round(corners.reduce((s, i) => s + data[i + c], 0) / 4));
console.log("key colour", `rgb(${key})`);

// Flood fill from the border so same-coloured pixels INSIDE the character stay.
const seen = new Uint8Array(W * H), stack = [];
const near = (i) => Math.hypot(data[i] - key[0], data[i + 1] - key[1], data[i + 2] - key[2]) <= tol;
for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1); }
for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y); }
while (stack.length) {
  const y = stack.pop(), x = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const p = y * W + x; if (seen[p]) continue; seen[p] = 1;
  if (!near(at(x, y))) continue;
  data[at(x, y) + 3] = 0;
  stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
}
// Enclosed pockets of key colour (between fingers, under an arm) are still
// background: the palette never contains the key, so clear them everywhere.
let pockets = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = at(x, y); if (data[i + 3] && near(i)) { data[i + 3] = 0; pockets++; } }
console.log("enclosed key pixels cleared:", pockets);
let x0 = W, y0 = H, x1 = 0, y1 = 0, opaque = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[at(x, y) + 3]) { opaque++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const cropped = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x0, top: y0, width: bw, height: bh }).png().toBuffer();
let out = cropped, outW = bw, outH = bh;
if (!tight) {
  const side = Math.round(Math.max(bw, bh) * (1 + padF * 2));
  const left = Math.round((side - bw) / 2), top = Math.round((side - bh) / 2);
  out = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: cropped, left, top }]).png().toBuffer();
  outW = outH = side;
}
console.log({ bounds: { x0, y0, w: bw, h: bh }, opaque, tight });
await writeFile(layerPath(layer, trait), out);
console.log("wrote", `layers/${layer}/${trait}.png`, `${outW}x${outH}`);
