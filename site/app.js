const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) n.append(k?.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const title = (s) => s.replace(/(^|-)(\w)/g, (_, d, c) => (d ? " " : "") + c.toUpperCase());
const pct = (n) => `${n.toFixed(n < 10 ? 1 : 0)}%`;

let info = await (await fetch("api/manifest")).json();
const pick = {};
let fitting = false, fitState = null; // fit editor state, declared early: updatePreview() reads it
for (const layer of info.layers) pick[layer.name] = layer.traits[0].key;

// ---- hero stats ----
$('[data-stat="layers"]').textContent = info.layers.length;
$('[data-stat="traits"]').textContent = info.layers.reduce((s, l) => s + l.traits.length, 0);
$('[data-stat="unique"]').textContent = info.unique.toLocaleString();
$('[data-stat="canvas"]').textContent = `${info.canvas}px`;
if (info.collection?.description) $("#lede").textContent = info.collection.description;

// ---- examples ----
const gallery = $("#gallery");
if (!info.examples.length) gallery.replaceWith(el("p", { class: "empty" }, "No example renders yet. Run npm run compose and copy the result into examples/."));
for (const ex of info.examples) {
  gallery.append(el("figure", { class: "card", style: "margin:0" },
    el("img", { src: `examples/${ex.file}`, alt: ex.label, width: 1024, height: 1024, loading: "lazy" }),
    el("figcaption", { class: "cap" }, el("strong", {}, ex.label), `examples/${ex.file}`)));
}

// ---- builder ----
const controls = $("#controls");
const preview = $("#preview");
const download = $("#download");
const metadata = $("#metadata");

function renderUrl(extra = "") {
  const q = new URLSearchParams();
  for (const layer of info.order) q.set(layer, pick[layer]);
  return `render?${q}${extra}`;
}
const anchorLayers = () => info.layers.filter((l) => l.fit === "anchor" && pick[l.name] && pick[l.name] !== "none");
function updatePreview() {
  if (fitting) { exitFit(false); }
  preview.src = renderUrl();
  $("#fit-toggle").hidden = anchorLayers().length === 0;
  download.href = renderUrl("&download=1");
  download.setAttribute("download", info.order.map((l) => pick[l]).join("-on-") + ".png");
  for (const b of controls.querySelectorAll(".chip")) b.setAttribute("aria-pressed", String(pick[b.dataset.layer] === b.dataset.trait));
  const attributes = info.layers.map((l) => ({ trait_type: title(l.name), value: l.traits.find((t) => t.key === pick[l.name]).name }));
  const odds = info.layers.reduce((p, l) => p * (l.traits.find((t) => t.key === pick[l.name]).pct / 100), 1);
  metadata.textContent = JSON.stringify({
    name: (info.collection?.namePattern ?? "#{id}").replace("{id}", "…"),
    description: info.collection?.description,
    image: "ipfs://<CID>/<id>.png",
    attributes,
    _draw_odds: pct(odds * 100),
  }, null, 2);
}
for (const layer of info.layers) {
  const block = el("div", { class: "layer-block" },
    el("h3", {}, title(layer.name), el("small", {}, `${layer.fit}${layer.fit === "contain" ? ` · ${Math.round(layer.scale * 100)}%` : layer.fit === "anchor" ? ` · on ${layer.on} ${layer.anchor}` : ""} · ${layer.traits.length} trait${layer.traits.length === 1 ? "" : "s"}`)),
    el("div", { class: "chips", role: "group", "aria-label": `${title(layer.name)} traits` },
      layer.traits.map((t) => el("button", {
        type: "button", class: "chip", "data-layer": layer.name, "data-trait": t.key, "aria-pressed": "false",
        onclick: () => { pick[layer.name] = t.key; updatePreview(); },
      },
        t.file ? el("img", { src: t.file, alt: "", width: 44, height: 44, loading: "lazy", class: layer.fit !== "fill" ? "clear" : "" }) : el("span", { class: "chip-none", "aria-hidden": "true" }, "–"),
        el("span", {}, el("span", { class: "name" }, t.name), el("br"), el("span", { class: "odds" }, `${pct(t.pct)} · w${t.weight}`))))));
  controls.append(block);
}
$("#random").addEventListener("click", () => {
  for (const layer of info.layers) {
    let r = Math.random() * layer.totalWeight;
    pick[layer.name] = layer.traits.find((t) => (r -= t.weight) < 0)?.key ?? layer.traits.at(-1).key;
  }
  updatePreview();
});
updatePreview();

// ---- fit editor ----
// Drag/resize/rotate an anchor-fit accessory on the current character; Save
// persists { x, y, scale, rotate } for this asset on this character.
const stage = $("#stage"), fitLayer = $("#fit-layer"), fitItem = $("#fit-item"), fitImg = $("#fit-img"), fitPanel = $("#fit-panel"), fitStatus = $("#fit-status");
const C = () => info.canvas;
const toCanvas = (px) => (px * C()) / stage.getBoundingClientRect().width;

async function enterFit() {
  const layer = anchorLayers()[0];
  if (!layer) return;
  const trait = layer.traits.find((t) => t.key === pick[layer.name]);
  const q = new URLSearchParams(); for (const l of info.order) q.set(l, pick[l]);
  const placeRes = await (await fetch(`api/place?${q}`)).json();
  const box = placeRes.layers[layer.name];
  if (!box) { fitStatus.textContent = `${title(pick[layer.host ?? "character"])} has no "${layer.anchor}" anchor.`; return; }
  const fit = box.fit ?? {};
  fitState = {
    layer: layer.name, trait: trait.key, character: box.hostTrait,
    base: { cx: box.cx - (fit.x ?? 0), cy: box.cy - (fit.y ?? 0), width: box.width / (fit.scale ?? 1), aspect: box.height / box.width, deg: box.deg - (fit.rotate ?? 0) },
    cur: { cx: box.cx, cy: box.cy, width: box.width, deg: box.deg },
  };
  fitting = true;
  fitStatus.textContent = "";
  // base render without this accessory, accessory drawn live on top
  const base = { ...pick, [layer.name]: "none" };
  const bq = new URLSearchParams(); for (const l of info.order) bq.set(l, base[l]);
  preview.src = `render?${bq}`;
  fitImg.src = trait.file;
  fitLayer.hidden = false; fitPanel.hidden = false;
  $("#fit-title").textContent = `${trait.name} on ${title(box.hostTrait)}`;
  $("#fit-toggle").hidden = true;
  paintFit();
}
function exitFit(refresh = true) {
  fitting = false; fitState = null;
  fitLayer.hidden = true; fitPanel.hidden = true;
  $("#fit-toggle").hidden = anchorLayers().length === 0;
  if (refresh) preview.src = renderUrl();
}
function currentFit() {
  const { base, cur } = fitState;
  return { x: cur.cx - base.cx, y: cur.cy - base.cy, scale: cur.width / base.width, rotate: cur.deg - base.deg };
}
function paintFit() {
  const { cur, base } = fitState, c = C();
  const h = cur.width * base.aspect;
  fitItem.style.left = `${((cur.cx - cur.width / 2) / c) * 100}%`;
  fitItem.style.top = `${((cur.cy - h / 2) / c) * 100}%`;
  fitItem.style.width = `${(cur.width / c) * 100}%`;
  fitItem.style.height = `${(h / c) * 100}%`;
  fitItem.style.transform = `rotate(${cur.deg}deg)`;
  const f = currentFit(), form = fitPanel.elements;
  form.x.value = Math.round(f.x); form.y.value = Math.round(f.y);
  form.scale.value = f.scale.toFixed(2); form.rotate.value = f.rotate.toFixed(1);
}
function setFromForm() {
  const form = fitPanel.elements, { base } = fitState;
  fitState.cur = {
    cx: base.cx + Number(form.x.value || 0), cy: base.cy + Number(form.y.value || 0),
    width: base.width * Math.max(0.1, Number(form.scale.value || 1)), deg: base.deg + Number(form.rotate.value || 0),
  };
  paintFit();
}
fitPanel.addEventListener("input", (e) => { if (e.target.matches("input")) setFromForm(); });

function drag(el, onMove) {
  el.addEventListener("pointerdown", (e) => {
    if (!fitting) return;
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, cur: { ...fitState.cur } };
    const rect = () => stage.getBoundingClientRect();
    const centreClient = () => { const r = rect(); return { x: r.left + (start.cur.cx / C()) * r.width, y: r.top + (start.cur.cy / C()) * r.height }; };
    const move = (ev) => { onMove(ev, start, centreClient()); paintFit(); };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  });
}
drag(fitItem, (ev, start) => {
  fitState.cur.cx = start.cur.cx + toCanvas(ev.clientX - start.x);
  fitState.cur.cy = start.cur.cy + toCanvas(ev.clientY - start.y);
});
drag($("#h-scale"), (ev, start, centre) => {
  const d0 = Math.hypot(start.x - centre.x, start.y - centre.y) || 1;
  const d1 = Math.hypot(ev.clientX - centre.x, ev.clientY - centre.y);
  fitState.cur.width = Math.max(8, start.cur.width * (d1 / d0));
});
drag($("#h-rotate"), (ev, start, centre) => {
  const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
  const a1 = Math.atan2(ev.clientY - centre.y, ev.clientX - centre.x);
  fitState.cur.deg = start.cur.deg + ((a1 - a0) * 180) / Math.PI;
});

$("#fit-toggle").addEventListener("click", enterFit);
$("#fit-cancel").addEventListener("click", () => exitFit(true));
async function saveFit(fit) {
  const { layer, trait, character } = fitState;
  fitStatus.textContent = "Saving…";
  // text/plain on purpose: a JSON content-type gets consumed by the CCLU
  // preview proxy's body parser and arrives empty. The server parses it anyway.
  const r = await fetch("api/fit", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ layer, trait, character, fit }) });
  if (!r.ok) { fitStatus.textContent = `Failed: ${await r.text()}`; return; }
  info = await (await fetch("api/manifest")).json();
  exitFit(true);
  const names = `${title(trait)} on ${title(character)}`;
  const msg = fit ? `Saved. ${names} remembers this fit.` : `Reset. ${names} uses the anchor default.`;
  $("#fit-toggle").insertAdjacentElement("afterend", el("output", { class: "fit-saved" }, msg));
  setTimeout(() => $(".fit-saved")?.remove(), 4000);
}
fitPanel.addEventListener("submit", (e) => { e.preventDefault(); saveFit(currentFit()); });
$("#fit-reset").addEventListener("click", () => saveFit(null));

// ---- layers & traits ----
const tables = $("#layer-tables");
info.layers.forEach((layer, i) => {
  tables.append(el("div", { class: "table-wrap" },
    el("div", { class: "table-head" },
      el("h3", {}, `${i + 1}. ${title(layer.name)}`),
      el("span", {}, `fit: ${layer.fit}`),
      layer.fit === "contain" ? el("span", {}, `scale: ${Math.round(layer.scale * 100)}% of canvas`) : "",
      layer.fit === "anchor" ? el("span", {}, `sits on ${layer.on} anchor "${layer.anchor}" · width ×${layer.widthScale} · overlap ${Math.round(layer.overlap * 100)}%`) : "",
      el("span", {}, `total weight: ${layer.totalWeight}`)),
    el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "Trait"), el("th", {}, "Key"), el("th", { class: "num" }, "Weight"), el("th", { class: "num" }, "Odds"), el("th", {}, ""), el("th", {}, "Size"), el("th", {}, "File"))),
      el("tbody", {}, layer.traits.map((t) => el("tr", {},
        el("td", {}, t.file ? el("img", { src: t.file, alt: "", width: 32, height: 32, loading: "lazy", class: layer.fit !== "fill" ? "clear" : "" }) : ""),
        el("td", {}, t.name),
        el("td", {}, el("code", {}, t.key)),
        el("td", { class: "num" }, t.weight),
        el("td", { class: "num" }, pct(t.pct)),
        el("td", {}, el("span", { class: "bar" }, el("i", { style: `width:${t.pct}%` }))),
        el("td", {}, t.dims ? `${t.dims.width}×${t.dims.height}` : "–"),
        el("td", {}, t.file ? el("code", {}, t.file) : el("span", { class: "muted" }, "absent on this token"))))))));
});

// ---- collection ----
const body = $("#collection-body");
function showCollection(c) {
  body.replaceChildren();
  if (!c) {
    body.append(el("p", { class: "empty" }, "Nothing generated yet. Set a count and seed above, or run npm run generate."));
    return;
  }
  body.append(el("div", { class: "summary" },
    el("span", {}, el("strong", {}, c.count), " tokens"),
    el("span", {}, "seed ", el("strong", {}, c.seed)),
    el("span", {}, "built ", el("strong", {}, new Date(c.built).toLocaleString()))));
  for (const layer of info.layers) {
    const counts = c.rarity?.[layer.name] ?? {};
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!rows.length) continue;
    body.append(el("div", { class: "table-wrap" },
      el("div", { class: "table-head" }, el("h3", {}, title(layer.name)), el("span", {}, "actual vs target odds")),
      el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Trait"), el("th", { class: "num" }, "Count"), el("th", { class: "num" }, "Actual"), el("th", { class: "num" }, "Target"))),
        el("tbody", {}, rows.map(([key, n]) => {
          const t = layer.traits.find((x) => x.key === key);
          return el("tr", {}, el("td", {}, t?.name ?? key), el("td", { class: "num" }, n), el("td", { class: "num" }, pct((n / c.count) * 100)), el("td", { class: "num" }, t ? pct(t.pct) : "–"));
        })))));
  }
  const shown = c.tokens.slice(0, 24);
  body.append(el("div", { class: "grid tokens" }, shown.map((t) => el("a", { class: "card", href: `build/metadata/${t.id}.json`, target: "_blank", rel: "noopener" },
    el("img", { src: `build/images/${t.id}.png?v=${c.built}`, alt: `Token ${t.id}`, width: 1024, height: 1024 }),
    el("div", { class: "cap" }, el("strong", {}, `#${t.id}`), info.order.filter((l) => t[l] && t[l] !== "none").map((l) => title(t[l])).join(" · "))))));
  if (c.tokens.length > shown.length) body.append(el("p", { class: "summary" }, `Showing ${shown.length} of ${c.tokens.length}. The rest are in build/images/.`));
}
showCollection(await (await fetch("api/collection")).json());

$("#gen-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const q = new URLSearchParams({ seed: fd.get("seed") || "1" });
  if (fd.get("count")) q.set("count", fd.get("count"));
  const btn = $("#gen-btn"), status = $("#gen-status");
  btn.disabled = true; status.textContent = "Rendering…";
  try {
    const r = await fetch(`api/generate?${q}`, { method: "POST" });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    status.textContent = j.log.split("\n").find((l) => l.includes("tokens ->")) ?? "Done.";
    showCollection(j.collection);
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});
