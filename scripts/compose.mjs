// Compose one or every background x character pair into out/.
//
//   npm run compose                      -> squid on ink-blue (the example)
//   npm run compose -- squid ink-glow-soft
//   npm run compose:all                  -> every pair
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadManifest, render, root } from "./lib/compose.mjs";

const manifest = await loadManifest();
await mkdir(path.join(root, "out"), { recursive: true });

async function compose(character, background) {
  const out = path.join(root, "out", `${character}-on-${background}.png`);
  await writeFile(out, await render(manifest, { background, character }));
  console.log("wrote", path.relative(root, out));
}

const args = process.argv.slice(2);
if (args.includes("--all")) {
  for (const bg of Object.keys(manifest.layers.background.traits))
    for (const ch of Object.keys(manifest.layers.character.traits)) await compose(ch, bg);
} else {
  const [character = "squid", background = "ink-blue"] = args;
  await compose(character, background);
}
