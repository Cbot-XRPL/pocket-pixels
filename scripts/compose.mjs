// Compose one or every background x character pair into out/.
//
//   npm run compose                      -> squid on ink-blue (the example)
//   npm run compose -- squid ink-glow-soft
//   npm run compose -- robot ink-blue beanie
//   npm run compose:all                  -> every pair
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadManifest, render, root } from "./lib/compose.mjs";

const manifest = await loadManifest();
await mkdir(path.join(root, "out"), { recursive: true });

async function compose(character, background, hat = "none") {
  const out = path.join(root, "out", `${character}${hat !== "none" ? `-${hat}` : ""}-on-${background}.png`);
  await writeFile(out, await render(manifest, { background, character, hat }));
  console.log("wrote", path.relative(root, out));
}

const args = process.argv.slice(2);
if (args.includes("--all")) {
  // every character x background, hat absent, plus every hat on every character on ink-blue
  for (const bg of Object.keys(manifest.layers.background.traits))
    for (const ch of Object.keys(manifest.layers.character.traits)) await compose(ch, bg);
  for (const hat of Object.keys(manifest.layers.hat?.traits ?? {})) {
    if (hat === "none") continue;
    for (const ch of Object.keys(manifest.layers.character.traits)) await compose(ch, "ink-blue", hat);
  }
} else {
  const [character = "squid", background = "ink-blue", hat = "none"] = args;
  await compose(character, background, hat);
}
