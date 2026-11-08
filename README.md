# Pocket Pixels

A pixel-art NFT collection built from layered PNG traits. Each token is a
background pane with a character composited on top.

## Starting example

The first character is the CCLU squid: a side-profile pixel-art squid,
turquoise `#2EE6D6` with cream suckers. The first background is its flat blue
plate `#0F3D8A`, no glow. Together they are the CCLU app icon.

![squid on ink blue](examples/squid-on-ink-blue.png)

## Layout

| Path                       | What it is                                             |
| -------------------------- | ------------------------------------------------------ |
| `layers/background/*.png`  | Background panes, 1024x1024, rounded plate with alpha. |
| `layers/character/*.png`   | Characters on transparent backgrounds.                 |
| `layers/layers.json`       | Layer order, trait names, character scale.             |
| `scripts/compose.mjs`      | Composites a character onto a background into `out/`.  |
| `scripts/generate.mjs`     | Builds the collection: weighted draws, PNG + metadata. |
| `scripts/recolor.mjs`      | Makes a colour variant of a character by hue remap.    |
| `scripts/lib/compose.mjs`  | Shared renderer used by both scripts.                  |
| `site/`                    | Home page: gallery, builder, layer info, collection.   |
| `examples/`                | Reference renders checked in for the README.           |

## Backgrounds

| Trait           | Look                                                   |
| --------------- | ------------------------------------------------------ |
| `ink-blue`      | Flat `#0F3D8A` plate. The official one.                |
| `ink-glow-soft` | Dark ink navy, soft turquoise glow lower right.        |
| `ink-glow-grid` | Dark ink navy, turquoise glow, faint pixel grid.       |

## Home page

```sh
npm run dev        # http://127.0.0.1:4610  (PORT overrides)
```

A single dark page served by `site/server.mjs`: the example renders, a live
trait builder that uses the same compositor as the generator, every layer
and trait with its weight, odds and file, and the last generated collection
with a Generate button. All URLs are relative, so it also works behind the
CCLU preview proxy.

## Render

```sh
npm install
npm run compose                      # squid on ink-blue -> out/
npm run compose -- squid ink-glow-grid
npm run compose:all                  # every background x character
```

## Generate the collection

```sh
npm run generate                                # every unique combo, seed 1
npm run generate -- --count 500 --seed 42       # N unique tokens, reproducible
npm run generate -- --image-base ipfs://<CID>   # metadata "image" points at IPFS
```

Writes to `build/` (gitignored):

| Path                       | What it is                                             |
| -------------------------- | ------------------------------------------------------ |
| `build/images/<id>.png`    | One 1024x1024 render per token.                        |
| `build/metadata/<id>.json` | XLS-24 style metadata: name, image, attributes.        |
| `build/collection.json`    | Seed, every token's traits, and rarity counts.         |

Trait rarity lives in `layers/layers.json` as a `weight` per trait (relative,
any scale). Draws are seeded and deduplicated, so the same seed always yields
the same collection. `--count` is capped at the number of unique combos.

### Adding a trait

1. Drop a 1024x1024 transparent PNG at `layers/<layer>/<trait>.png`.
2. Add `"<trait>": { "name": "Display Name", "weight": 10 }` to that layer in
   `layers/layers.json`.
3. `npm run compose -- <character> <background>` to eyeball it.

New layers (hats, eyes, held items) go in `order` bottom to top with
`"fit": "contain"` and a `scale`.

### Colour variants

```sh
node scripts/recolor.mjs squid squid-gold --hue 45 --light 1.14   # shift the accent hue
node scripts/recolor.mjs squid squid-grey --sat 0.05 --light 1.05  # desaturate
```

Only pixels in the source's accent hue band (`--range`, default 150-205 for
the turquoise squid) change, so eyes, suckers and outlines stay put.

## Characters

| Trait        | Weight | Look                                   |
| ------------ | ------ | -------------------------------------- |
| `squid`      | 70     | The original turquoise `#2EE6D6` squid. |
| `squid-grey` | 20     | Desaturated slate grey.                |
| `squid-gold` | 10     | Warm gold, the rare one.               |

## Style rules

Dark, premium, restrained. Crisp square pixels, nearest-neighbour scaling, one
accent colour per piece. No busy backgrounds, no gloss, no clip-art.
