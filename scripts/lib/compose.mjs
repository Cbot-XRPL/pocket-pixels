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
  // offsetY (fraction of canvas) nudges the layer down to leave headroom for hats.
  const top = Math.round((size - height) / 2 + size * (cfg.offsetY ?? 0));
  return { left: Math.round((size - width) / 2), top, width, height, k };
}

/**
 * Where an anchor-fit accessory lands, as an UNROTATED box centred at (cx, cy)
 * that is then rotated `deg` clockwise about its centre. Combines the host
 * anchor (x, y, w + optional rotate/scale/overlap) with the accessory trait's
 * saved per-character fit ({ x, y, scale, rotate } under trait.fit[character]).
 * `placed` must already hold the host layer's placement(). Null if the host
 * is absent or lacks the anchor.
 */
export async function anchorBox(manifest, layer, trait, combo, placed) {
  const cfg = manifest.layers[layer];
  const host = cfg.on ?? "character";
  const hostTrait = manifest.layers[host]?.traits[combo[host]];
  const anchor = hostTrait?.anchors?.[cfg.anchor];
  const hostPlace = placed[host];
  if (!anchor || !hostPlace) return null;
  const meta = await sharp(layerPath(layer, trait)).metadata();
  const fit = manifest.layers[layer].traits[trait]?.fit?.[combo[host]] ?? {};
  const width = Math.max(4, Math.round(anchor.w * hostPlace.k * (cfg.widthScale ?? 1.15) * (anchor.scale ?? 1) * (fit.scale ?? 1)));
  const height = Math.max(4, Math.round(meta.height * (width / meta.width)));
  const overlap = anchor.overlap ?? cfg.overlap ?? 0.15;
  const deg = (anchor.rotate ?? 0) + (fit.rotate ?? 0);
  // Seat point S (bottom-centre raised by overlap) sits on the anchor A; the
  // box centre is A minus S rotated. Saved fit offsets then nudge the centre.
  const ax = hostPlace.left + anchor.x * hostPlace.k, ay = hostPlace.top + anchor.y * hostPlace.k;
  const r = (deg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  const sy = height * (0.5 - overlap);
  const cx = ax - (-sy * sn) + (fit.x ?? 0);
  const cy = ay - sy * c + (fit.y ?? 0);
  return { cx, cy, width, height, deg, host, hostTrait: combo[host], anchor: cfg.anchor, fit };
}

/**
 * The placement of every layer in a combo without rendering: fill layers,
 * contain layers (placement()) and anchor layers (anchorBox()).
 */
export async function plan(manifest, combo) {
  const out = {}, placed = {};
  for (const layer of manifest.order) {
    const cfg = manifest.layers[layer];
    const trait = combo[layer];
    if (!trait || trait === NONE) { out[layer] = null; continue; }
    if (cfg.fit === "anchor") out[layer] = await anchorBox(manifest, layer, trait, combo, placed);
    else if (cfg.fit === "contain") { const p = placement(manifest, layer, await sharp(layerPath(layer, trait)).metadata()); placed[layer] = p; out[layer] = p; }
    else out[layer] = { left: 0, top: 0, width: manifest.canvas, height: manifest.canvas };
  }
  return out;
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
      const box = await anchorBox(manifest, layer, trait, combo, placed);
      if (!box) continue; // host absent or has no such anchor: skip the accessory
      const { cx, cy, width, height, deg } = box;
      let img = sharp(await sharp(file).resize(width, height, { fit: "fill", kernel: "nearest" }).toBuffer());
      let ow = width, oh = height;
      if (deg) {
        // Rotate about the image centre with nearest-neighbour sampling so pixels stay hard.
        const r = (deg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
        img = sharp(await img.affine([[c, -sn], [sn, c]], { background: { r: 0, g: 0, b: 0, alpha: 0 }, interpolator: sharp.interpolators.nearest }).png().toBuffer());
        const rm = await img.metadata();
        ow = rm.width; oh = rm.height;
      }
      let left = Math.round(cx - ow / 2), top = Math.round(cy - oh / 2);
      // Clip to the canvas: sharp refuses overlays that hang past the edge.
      const cl = Math.max(0, -left), ct = Math.max(0, -top);
      const cw = Math.min(ow - cl, size - Math.max(0, left)), ch = Math.min(oh - ct, size - Math.max(0, top));
      if (cw <= 0 || ch <= 0) continue;
      if (cl || ct || cw !== ow || ch !== oh) img = img.extract({ left: cl, top: ct, width: cw, height: ch });
      overlays.push({ input: await img.png().toBuffer(), left: Math.max(0, left), top: Math.max(0, top) });
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
