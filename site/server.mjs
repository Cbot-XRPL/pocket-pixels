// Pocket Pixels home page: examples gallery, live trait builder, layer/trait
// info and the last generated collection. Plain Node, no framework.
//
//   npm run dev            -> http://127.0.0.1:4610  (PORT overrides)
//
// Every URL the page uses is relative so it works behind the CCLU preview
// proxy (/preview/<id>/) as well as at the root.
import http from "node:http";
import { readFile, writeFile, stat, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadManifest, render, plan, layerPath, root, NONE } from "../scripts/lib/compose.mjs";

const MANIFEST = path.join(root, "layers/layers.json");

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4610);
const run = promisify(execFile);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// Keyed by combo + layer file mtimes, so editing a PNG invalidates its renders.
const renderCache = new Map();

async function manifestInfo() {
  const m = await loadManifest();
  const layers = [];
  let unique = 1;
  for (const name of m.order) {
    const cfg = m.layers[name];
    const total = Object.values(cfg.traits).reduce((s, t) => s + t.weight, 0);
    const traits = [];
    for (const [key, t] of Object.entries(cfg.traits)) {
      let dims = null;
      const file = key === NONE ? null : `layers/${name}/${key}.png`;
      if (file) {
        try {
          const meta = await sharp(layerPath(name, key)).metadata();
          dims = { width: meta.width, height: meta.height };
        } catch {}
      }
      traits.push({ key, name: t.name, weight: t.weight, pct: (t.weight / total) * 100, file, dims, anchors: t.anchors ?? null, fit: t.fit ?? null });
    }
    unique *= traits.length;
    layers.push({ name, fit: cfg.fit, scale: cfg.scale ?? 1, anchor: cfg.anchor ?? null, on: cfg.on ?? null, widthScale: cfg.widthScale ?? null, overlap: cfg.overlap ?? null, traits, totalWeight: total });
  }
  const examples = (await readdir(path.join(root, "examples")).catch(() => []))
    .filter((f) => f.endsWith(".png"))
    .map((f) => ({ file: f, label: f.replace(/\.png$/, "").replace(/-/g, " ") }));
  return { canvas: m.canvas, collection: m.collection, order: m.order, layers, unique, examples };
}

async function collectionInfo() {
  try {
    const c = JSON.parse(await readFile(path.join(root, "build/collection.json"), "utf8"));
    const built = (await stat(path.join(root, "build/collection.json"))).mtimeMs;
    return { ...c, built };
  } catch {
    return null;
  }
}

function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...extra });
  res.end(body);
}

async function sendFile(res, abs) {
  try {
    const data = await readFile(abs);
    send(res, 200, data, MIME[path.extname(abs)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "not found", "text/plain");
  }
}

// Only serve files from these roots, never anything else on disk.
const PUBLIC = { "examples/": path.join(root, "examples"), "layers/": path.join(root, "layers"), "build/images/": path.join(root, "build/images"), "build/metadata/": path.join(root, "build/metadata") };

function parseCombo(m, params) {
  const combo = {};
  for (const layer of m.order) {
    const trait = params.get(layer) ?? (m.layers[layer].traits[NONE] ? NONE : null);
    if (!trait || !m.layers[layer].traits[trait]) return `missing or unknown trait for layer "${layer}"`;
    combo[layer] = trait;
  }
  return combo;
}
const readBody = (req) => new Promise((resolve, reject) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => resolve(b)); req.on("error", reject); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const p = url.pathname.replace(/^\/+/, "");
  try {
    if (req.method === "GET" && (p === "" || p === "index.html")) return sendFile(res, path.join(here, "index.html"));
    if (req.method === "GET" && (p === "app.js" || p === "style.css")) return sendFile(res, path.join(here, p));

    if (req.method === "GET" && p === "api/manifest") return send(res, 200, JSON.stringify(await manifestInfo()));
    if (req.method === "GET" && p === "api/collection") return send(res, 200, JSON.stringify(await collectionInfo()));

    if (req.method === "GET" && p === "api/place") {
      const m = await loadManifest();
      const combo = parseCombo(m, url.searchParams);
      if (typeof combo === "string") return send(res, 400, combo, "text/plain");
      return send(res, 200, JSON.stringify({ canvas: m.canvas, layers: await plan(m, combo) }));
    }

    // Save how one accessory trait sits on one character: { layer, trait, character, fit: { x, y, scale, rotate } | null }
    if (req.method === "POST" && p === "api/fit") {
      const body = JSON.parse(await readBody(req) || "{}");
      const raw = JSON.parse(await readFile(MANIFEST, "utf8"));
      const layer = raw.layers[body.layer], traitRaw = layer?.traits?.[body.trait];
      const host = layer?.on ?? "character";
      if (!layer || layer.fit !== "anchor" || !traitRaw || typeof traitRaw !== "object") return send(res, 400, "unknown anchor layer/trait", "text/plain");
      if (!raw.layers[host]?.traits?.[body.character]) return send(res, 400, `unknown ${host} "${body.character}"`, "text/plain");
      traitRaw.fit ??= {};
      if (body.fit == null) delete traitRaw.fit[body.character];
      else {
        const f = body.fit;
        const clean = {};
        if (Math.round(f.x ?? 0)) clean.x = Math.round(f.x);
        if (Math.round(f.y ?? 0)) clean.y = Math.round(f.y);
        if (Math.abs((f.scale ?? 1) - 1) > 0.001) clean.scale = Math.round(f.scale * 1000) / 1000;
        if (Math.abs(f.rotate ?? 0) > 0.05) clean.rotate = Math.round(f.rotate * 10) / 10;
        if (Object.keys(clean).length) traitRaw.fit[body.character] = clean; else delete traitRaw.fit[body.character];
      }
      if (!Object.keys(traitRaw.fit).length) delete traitRaw.fit;
      await writeFile(MANIFEST, JSON.stringify(raw, null, 2) + "\n");
      renderCache.clear();
      return send(res, 200, JSON.stringify({ ok: true, fit: traitRaw.fit?.[body.character] ?? null }));
    }

    if (req.method === "GET" && p === "render") {
      const m = await loadManifest();
      const combo = parseCombo(m, url.searchParams);
      if (typeof combo === "string") return send(res, 400, combo, "text/plain");
      const stamps = await Promise.all([stat(MANIFEST).then((s) => s.mtimeMs), ...m.order.map((l) => (combo[l] === NONE ? Promise.resolve(0) : stat(layerPath(l, combo[l])).then((s) => s.mtimeMs)))]);
      const key = m.order.map((l) => combo[l]).join("/") + "@" + stamps.join(",");
      let png = renderCache.get(key);
      if (!png) {
        png = await render(m, combo);
        renderCache.set(key, png);
      }
      const name = m.order.map((l) => combo[l]).join("-on-") + ".png";
      return send(res, 200, png, "image/png", url.searchParams.has("download") ? { "content-disposition": `attachment; filename="${name}"` } : {});
    }

    if (req.method === "POST" && p === "api/generate") {
      const count = Math.max(1, Math.min(10000, Number(url.searchParams.get("count") ?? 0) || 0));
      const seed = Number(url.searchParams.get("seed") ?? 1) || 1;
      const args = [path.join(root, "scripts/generate.mjs"), "--seed", String(seed)];
      if (count) args.push("--count", String(count));
      const { stdout, stderr } = await run(process.execPath, args, { cwd: root, timeout: 10 * 60_000 });
      renderCache.clear();
      return send(res, 200, JSON.stringify({ ok: true, log: (stderr + stdout).trim(), collection: await collectionInfo() }));
    }

    for (const [prefix, dir] of Object.entries(PUBLIC)) {
      if (req.method === "GET" && p.startsWith(prefix)) {
        const rel = path.normalize(p.slice(prefix.length));
        if (rel.startsWith("..") || path.isAbsolute(rel)) return send(res, 400, "bad path", "text/plain");
        return sendFile(res, path.join(dir, rel));
      }
    }
    send(res, 404, "not found", "text/plain");
  } catch (err) {
    console.error(err);
    send(res, 500, String(err?.message ?? err), "text/plain");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`pocket-pixels home page on http://127.0.0.1:${port}`));
