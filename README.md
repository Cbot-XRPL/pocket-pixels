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
| `examples/`                | Reference renders checked in for the README.           |

## Backgrounds

| Trait           | Look                                                   |
| --------------- | ------------------------------------------------------ |
| `ink-blue`      | Flat `#0F3D8A` plate. The official one.                |
| `ink-glow-soft` | Dark ink navy, soft turquoise glow lower right.        |
| `ink-glow-grid` | Dark ink navy, turquoise glow, faint pixel grid.       |

## Render

```sh
npm install
npm run compose                      # squid on ink-blue -> out/
npm run compose -- squid ink-glow-grid
npm run compose:all                  # every background x character
```

## Style rules

Dark, premium, restrained. Crisp square pixels, nearest-neighbour scaling, one
accent colour per piece. No busy backgrounds, no gloss, no clip-art.
