// Remove the white matte fringe from a character's edge and make it hard.
//
//   node scripts/defringe.mjs squid            # rewrites layers/character/squid.png in place
//   node scripts/defringe.mjs squid --dry      # just report
//
// Semi-transparent edge pixels left by a cut-out from white carry a pale
// tint that shows as a light rim on dark plates. Pixel art has no
// anti-aliasing, so: alpha < 128 becomes clear; alpha >= 128 becomes solid
// and takes the colour of its nearest fully opaque neighbour.
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { layerPath } from "./lib/compose.mjs";

const [trait, ...flags] = process.argv.slice(2);
if (!trait) { console.error("usage: node scripts/defringe.mjs <trait> [--dry]"); process.exit(1); }
const file = layerPath("character", trait);
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const src = Buffer.from(data);
const at = (x, y) => (y * W + x) * 4;

let cleared = 0, snapped = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = at(x, y), a = src[i + 3];
  if (a === 0 || a === 255) continue;
  if (a < 128) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; cleared++; continue; }
  // nearest fully opaque neighbour, searching rings outward
  let found = null;
  for (let r = 1; r <= 4 && !found; r++) {
    const votes = new Map();
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = at(nx, ny);
      if (src[j + 3] !== 255) continue;
      const k = (src[j] << 16) | (src[j + 1] << 8) | src[j + 2];
      votes.set(k, (votes.get(k) ?? 0) + 1);
    }
    if (votes.size) found = [...votes.entries()].sort((p, q) => q[1] - p[1])[0][0];
  }
  if (found === null) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; cleared++; continue; }
  data[i] = (found >> 16) & 255; data[i + 1] = (found >> 8) & 255; data[i + 2] = found & 255; data[i + 3] = 255; snapped++;
}
// Pass 2: the outermost OPAQUE ring. A cut-out from white also leaves fully
// opaque edge pixels that are the outline colour mixed with white (one pixel
// deep). Any edge pixel clearly lighter than the pixel two steps inward along
// its outward normal takes that inward colour.
const pass1 = Buffer.from(data);
const lum = (b, i) => (b[i] + b[i + 1] + b[i + 2]) / 3;
let ringed = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = at(x, y);
  if (pass1[i + 3] !== 255) continue;
  let out = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || pass1[at(nx, ny) + 3] === 0) { out = [dx, dy]; break; }
  }
  if (!out) continue;
  let ref = null;
  for (const k of [2, 1]) {
    const rx = x - out[0] * k, ry = y - out[1] * k;
    if (rx < 0 || ry < 0 || rx >= W || ry >= H) continue;
    const j = at(rx, ry);
    if (pass1[j + 3] === 255) { ref = j; break; }
  }
  if (ref === null || lum(pass1, i) - lum(pass1, ref) < 25) continue;
  data[i] = pass1[ref]; data[i + 1] = pass1[ref + 1]; data[i + 2] = pass1[ref + 2];
  ringed++;
}
console.log(`${trait}: ${cleared} edge pixels cleared, ${snapped} snapped to a neighbour colour, ${ringed} light rim pixels darkened`);
if (!flags.includes("--dry")) {
  await writeFile(file, await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());
  console.log("wrote", file);
}
