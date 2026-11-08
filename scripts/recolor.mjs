// Recolour a character's accent hue to make a new trait from the same pixels.
//
//   node scripts/recolor.mjs squid squid-gold --hue 44 --sat 0.95 --light 1.0
//   node scripts/recolor.mjs squid squid-grey --sat 0.06 --light 1.0
//
// Only pixels whose hue falls inside --range (default the squid's turquoise
// band, 120-230 degrees) are touched; cream suckers, eyes and outlines stay.
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { layerPath } from "./lib/compose.mjs";

const [src, dst, ...rest] = process.argv.slice(2);
if (!src || !dst) {
  console.error("usage: node scripts/recolor.mjs <source-trait> <new-trait> [--hue H] [--sat S] [--light L] [--range 120-230]");
  process.exit(1);
}
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = rest[i + 1];
const hue = opt.hue !== undefined ? Number(opt.hue) : null;
const sat = opt.sat !== undefined ? Number(opt.sat) : 1;
const light = opt.light !== undefined ? Number(opt.light) : 1;
const [lo, hi] = (opt.range ?? "120-230").split("-").map(Number);

const { data, info } = await sharp(layerPath("character", src)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
}

let touched = 0;
for (let i = 0; i < data.length; i += 4) {
  if (data[i + 3] === 0) continue;
  let [h, s, l] = rgb2hsl(data[i], data[i + 1], data[i + 2]);
  // Accent band, plus any tinted near-white highlight: those carry a trace of
  // the source hue and read as mint specks on a recoloured body.
  const inBand = h >= lo && h <= hi;
  const tintedHighlight = l > 0.85 && s > 0.03;
  if (s < 0.04 || (!inBand && !tintedHighlight)) continue;
  if (hue !== null) h = hue;
  s = Math.min(1, s * sat);
  l = Math.min(1, l * light);
  [data[i], data[i + 1], data[i + 2]] = hsl2rgb(h, s, l);
  touched++;
}
await writeFile(layerPath("character", dst), await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
console.log(`wrote layers/character/${dst}.png (${touched} pixels recoloured)`);
