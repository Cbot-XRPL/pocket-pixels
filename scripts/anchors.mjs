// Debug view: every character on the plate with its anchors drawn, so a new
// character or accessory can be checked for fit.   node scripts/anchors.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { loadManifest, render, placement, layerPath, root } from "./lib/compose.mjs";

const m = await loadManifest();
const size = m.canvas;
const chars = Object.entries(m.layers.character.traits);
const tiles = [];
for (const [key, t] of chars) {
  const png = await render(m, { background: "ink-blue", character: key });
  const meta = await sharp(layerPath("character", key)).metadata();
  const p = placement(m, "character", meta);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`;
  for (const [name, a] of Object.entries(t.anchors ?? {})) {
    const cx = p.left + a.x * p.k, y = p.top + a.y * p.k, w = a.w * p.k;
    svg += `<line x1="${cx - w / 2}" y1="${y}" x2="${cx + w / 2}" y2="${y}" stroke="#ff3b7a" stroke-width="6"/>`;
    svg += `<line x1="${cx}" y1="${y - 40}" x2="${cx}" y2="${y + 40}" stroke="#ff3b7a" stroke-width="6"/>`;
    svg += `<rect x="${cx - w / 2}" y="${y - w * 0.6}" width="${w}" height="${w * 0.6}" fill="none" stroke="#ff3b7a" stroke-width="4" stroke-dasharray="16 12"/>`;
    svg += `<text x="${cx}" y="${y - w * 0.6 - 16}" fill="#ff3b7a" font-family="monospace" font-size="40" text-anchor="middle">${name}</text>`;
  }
  svg += `<text x="24" y="${size - 24}" fill="#fff" font-family="monospace" font-size="40">${t.name}</text></svg>`;
  const overlay = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  const marked = await sharp(png).composite([{ input: overlay }]).png().toBuffer(); // resize runs before composite in one pipeline
  tiles.push(await sharp(marked).resize(512, 512).png().toBuffer());
}
await mkdir(path.join(root, "out"), { recursive: true });
const sheet = await sharp({ create: { width: 512 * tiles.length + 16 * (tiles.length + 1), height: 544, channels: 4, background: "#0a0f1c" } })
  .composite(tiles.map((t, i) => ({ input: t, left: 16 + i * 528, top: 16 })))
  .png().toBuffer();
await writeFile(path.join(root, "out/anchors.png"), sheet);
console.log("wrote out/anchors.png");
