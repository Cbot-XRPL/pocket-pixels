// Shared compositing: load the layer manifest and render one trait combo.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function loadManifest() {
  const manifest = JSON.parse(await readFile(path.join(root, "layers/layers.json"), "utf8"));
  // Accept both the short form ("trait": "Display Name") and the long form
  // ("trait": { name, weight }) so hand-edits stay easy.
  for (const layer of Object.values(manifest.layers)) {
    for (const [key, value] of Object.entries(layer.traits)) {
      if (typeof value === "string") layer.traits[key] = { name: value, weight: 1 };
      else layer.traits[key] = { name: value.name ?? key, weight: value.weight ?? 1 };
    }
  }
  return manifest;
}

export const layerPath = (layer, trait) => path.join(root, "layers", layer, `${trait}.png`);

/**
 * Render a combo ({ background: "ink-blue", character: "squid", ... }) to a
 * PNG buffer, following manifest.order bottom to top. Backgrounds fill the
 * canvas; "contain" layers are scaled by their `scale` with nearest-neighbour
 * sampling so pixels stay square, then centred.
 */
export async function render(manifest, combo) {
  const size = manifest.canvas;
  const [baseLayer, ...rest] = manifest.order;
  const base = sharp(layerPath(baseLayer, combo[baseLayer])).resize(size, size, { fit: "fill" });

  const overlays = [];
  for (const layer of rest) {
    const cfg = manifest.layers[layer];
    const trait = combo[layer];
    if (!trait) continue;
    let img = sharp(layerPath(layer, trait));
    if (cfg.fit === "contain") {
      const target = Math.round(size * (cfg.scale ?? 1));
      img = img.resize(target, target, { fit: "inside", kernel: "nearest" });
    } else {
      img = img.resize(size, size, { fit: "fill" });
    }
    overlays.push({ input: await img.toBuffer(), gravity: "centre" });
  }
  return base.composite(overlays).png().toBuffer();
}
