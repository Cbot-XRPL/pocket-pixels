// Generate the collection: N unique tokens, weighted by trait rarity, with
// one PNG and one metadata JSON per token.
//
//   npm run generate                              -> every unique combo, seed 1
//   npm run generate -- --count 500 --seed 42
//   npm run generate -- --image-base ipfs://<CID>  -> metadata "image" points at IPFS
//
// Output (build/ is gitignored):
//   build/images/<id>.png
//   build/metadata/<id>.json       XLS-24 style: schema, nftType, name, description, image, attributes
//   build/collection.json          every token's traits + rarity counts
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadManifest, render, root } from "./lib/compose.mjs";

const args = parseArgs(process.argv.slice(2));
const manifest = await loadManifest();
const layers = manifest.order;

const maxUnique = layers.reduce((n, l) => n * Object.keys(manifest.layers[l].traits).length, 1);
const count = Math.min(Number(args.count ?? maxUnique), maxUnique);
if (Number(args.count) > maxUnique)
  console.warn(`only ${maxUnique} unique combos exist; capping --count at ${maxUnique}`);

const rand = mulberry32(Number(args.seed ?? 1));
const pick = (layer) => {
  const traits = Object.entries(manifest.layers[layer].traits);
  const total = traits.reduce((s, [, t]) => s + t.weight, 0);
  let r = rand() * total;
  for (const [key, t] of traits) if ((r -= t.weight) < 0) return key;
  return traits.at(-1)[0];
};

// Draw weighted combos, rejecting duplicates. Near the unique ceiling the
// rejection rate climbs, so fall back to a sweep of the remaining combos.
const seen = new Set();
const combos = [];
let misses = 0;
while (combos.length < count && misses < count * 50) {
  const combo = Object.fromEntries(layers.map((l) => [l, pick(l)]));
  const key = layers.map((l) => combo[l]).join("/");
  if (seen.has(key)) { misses++; continue; }
  seen.add(key);
  combos.push(combo);
}
if (combos.length < count) {
  for (const combo of allCombos(manifest)) {
    const key = layers.map((l) => combo[l]).join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push(combo);
    if (combos.length === count) break;
  }
}

const build = path.join(root, args.out ?? "build");
await rm(build, { recursive: true, force: true });
await mkdir(path.join(build, "images"), { recursive: true });
await mkdir(path.join(build, "metadata"), { recursive: true });

const imageBase = (args["image-base"] ?? "./images").replace(/\/$/, "");
const rarity = Object.fromEntries(layers.map((l) => [l, {}]));
const tokens = [];

for (let i = 0; i < combos.length; i++) {
  const id = i + Number(args.start ?? 1);
  const combo = combos[i];
  const png = await render(manifest, combo);
  await writeFile(path.join(build, "images", `${id}.png`), png);

  const attributes = layers.map((l) => ({
    trait_type: titleCase(l),
    value: manifest.layers[l].traits[combo[l]].name,
  }));
  for (const l of layers) rarity[l][combo[l]] = (rarity[l][combo[l]] ?? 0) + 1;

  const meta = {
    schema: "ipfs://QmNpi8rcXEkohca8iQu7SvxSzmZCzHpwcYbS5Qy5DRxdkz",
    nftType: "art.v0",
    name: manifest.collection.namePattern.replace("{id}", id),
    description: manifest.collection.description,
    image: `${imageBase}/${id}.png`,
    collection: { name: manifest.collection.name },
    attributes,
  };
  await writeFile(path.join(build, "metadata", `${id}.json`), JSON.stringify(meta, null, 2) + "\n");
  tokens.push({ id, ...combo });
  if (id % 25 === 0 || i === combos.length - 1) console.log(`rendered ${i + 1}/${combos.length}`);
}

await writeFile(
  path.join(build, "collection.json"),
  JSON.stringify({ name: manifest.collection.name, seed: Number(args.seed ?? 1), count: tokens.length, rarity, tokens }, null, 2) + "\n",
);

console.log(`\n${tokens.length} tokens -> ${path.relative(root, build)}/`);
for (const l of layers) {
  console.log(`${titleCase(l)}:`);
  for (const [k, n] of Object.entries(rarity[l]).sort((a, b) => b[1] - a[1]))
    console.log(`  ${manifest.layers[l].traits[k].name.padEnd(18)} ${String(n).padStart(5)}  ${((n / tokens.length) * 100).toFixed(1)}%`);
}

function* allCombos(m, i = 0, acc = {}) {
  if (i === layers.length) { yield { ...acc }; return; }
  for (const key of Object.keys(m.layers[layers[i]].traits)) yield* allCombos(m, i + 1, { ...acc, [layers[i]]: key });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function titleCase(s) {
  return s.replace(/(^|-)(\w)/g, (_, d, c) => (d ? " " : "") + c.toUpperCase());
}
