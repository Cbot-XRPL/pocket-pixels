// Compose one or every background x character pair into out/.
//
//   npm run compose                      -> squid on ink-blue (the example)
//   npm run compose -- squid ink-glow-soft
//   npm run compose:all                  -> every pair
//
// Each layer is a transparent PNG in layers/<layer>/<trait>.png. Backgrounds
// fill the canvas; characters are scaled (layers.json "scale") and centred.
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "layers/layers.json"), "utf8"));
const size = manifest.canvas;

const layerPath = (layer, trait) => path.join(root, "layers", layer, `${trait}.png`);

async function compose(character, background) {
  const charCfg = manifest.layers.character;
  const target = Math.round(size * charCfg.scale);
  const squid = await sharp(layerPath("character", character))
    .resize(target, target, { fit: "inside", kernel: "nearest" })
    .toBuffer();

  const out = path.join(root, "out", `${character}-on-${background}.png`);
  await sharp(layerPath("background", background))
    .resize(size, size, { fit: "fill" })
    .composite([{ input: squid, gravity: "centre" }])
    .png()
    .toFile(out);
  console.log("wrote", path.relative(root, out));
}

await mkdir(path.join(root, "out"), { recursive: true });

const args = process.argv.slice(2);
if (args.includes("--all")) {
  for (const bg of Object.keys(manifest.layers.background.traits))
    for (const ch of Object.keys(manifest.layers.character.traits)) await compose(ch, bg);
} else {
  const [character = "squid", background = "ink-blue"] = args;
  await compose(character, background);
}
