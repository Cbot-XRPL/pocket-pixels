// Shared compositing: load the layer manifest and render one trait combo.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function loadManifest() {
  const manifest = JSON.parse(await readFile(path.join(root, "layers/layers.json"), "utf8"));
  // Accept both the short form ("trait": "Display Name") and the long form
  // ("trait": { name, weight, anchors }) so hand-edits stay easy.
  for (const layer of Object.values(manifest.layers)) {
    for (const [key, value] of Object.entries(layer.traits)) {
      if (typeof value === "string") layer.traits[key] = { name: value, weight: 1 };
      else layer.traits[key] = { ...value, name: value.name ?? key, weight: value.weight ?? 1 };
    }
  }
  return manifest;
}

export const layerPath = (layer, trait) => path.join(root, "layers", layer, `${trait}.png`);

/** The trait key that means "this layer is absent on this token". */
export const NONE = "none";

/**
 * Where a "contain" layer's image lands on the canvas: scaled to fit inside
 * size*scale and centred. Returns { left, top, width, height, k } with k the
 * image-pixel -> canvas-pixel factor.
 */
export function placement(manifest, layer, meta) {
  const size = manifest.canvas;
  const cfg = manifest.layers[layer];
  const box = Math.round(size * (cfg.scale ?? 1));
  const k = Math.min(box / meta.width, box / meta.height);
  const width = Math.round(meta.width * k), height = Math.round(meta.height * k);
  return { left: Math.round((size - width) / 2), top: Math.round((size - height) / 2), width, height, k };
}

/**
 * Render a combo ({ background: "ink-blue", character: "squid", hat: "none" })
 * to a PNG buffer, following manifest.order bottom to top.
 *  - fill:    stretched to the canvas (backgrounds)
 *  - contain: scaled by `scale`, nearest-neighbour, centred (characters)
 *  - anchor:  placed on the `on` layer's chosen trait anchor named `anchor`:
 *             width = anchor.w * widthScale, bottom edge at anchor.y sunk by
 *             `overlap` of its own height (accessories)
 */
export async function render(manifest, combo) {
  const size = manifest.canvas;
  const [baseLayer, ...rest] = manifest.order;
  const base = sharp(layerPath(baseLayer, combo[baseLayer])).resize(size, size, { fit: "fill" });

  const placed = {};
  const overlays = [];
  for (const layer of rest) {
    const cfg = manifest.layers[layer];
    const trait = combo[layer];
    if (!trait || trait === NONE) continue;
    const file = layerPath(layer, trait);
    if (cfg.fit === "anchor") {
      const host = cfg.on ?? "character";
      const hostTrait = manifest.layers[host]?.traits[combo[host]];
      const anchor = hostTrait?.anchors?.[cfg.anchor];
      const hostPlace = placed[host];
      if (!anchor || !hostPlace) continue; // host absent or has no such anchor: skip the accessory
      const meta = await sharp(file).metadata();
      const width = Math.round(anchor.w * hostPlace.k * (cfg.widthScale ?? 1.15));
      const height = Math.round(meta.height * (width / meta.width));
      const cx = hostPlace.left + anchor.x * hostPlace.k;
      const bottom = hostPlace.top + anchor.y * hostPlace.k + height * (cfg.overlap ?? 0.15);
      const img = await sharp(file).resize(width, height, { fit: "fill", kernel: "nearest" }).toBuffer();
      overlays.push({ input: img, left: Math.round(cx - width / 2), top: Math.round(bottom - height) });
      continue;
    }
    if (cfg.fit === "contain") {
      const meta = await sharp(file).metadata();
      const p = placement(manifest, layer, meta);
      placed[layer] = p;
      overlays.push({ input: await sharp(file).resize(p.width, p.height, { fit: "fill", kernel: "nearest" }).toBuffer(), left: p.left, top: p.top });
    } else {
      overlays.push({ input: await sharp(file).resize(size, size, { fit: "fill" }).toBuffer(), gravity: "centre" });
    }
  }
  return base.composite(overlays).png().toBuffer();
}
