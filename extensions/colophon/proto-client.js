/* proto-client.js — the Prototype canvas app (runs in the iframe).
   Loads /api/prototypes, builds a ProtoRender runtime, and frames the current screen in a
   selectable device (web breakpoints, Windows/macOS app windows, phones, tablets) with a
   DevTools-style toolbar. Click-through + simple state are handled by the runtime; this
   file owns the chrome, device sizing, theme, screen switching, validation, and outline. */

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};

// ---- device presets --------------------------------------------------------
// w/h describe the screen (content) size; chrome is drawn around it. Grouped for the
// picker. Not web-only — desktop-app windows and native mobile/tablet are first class.
const DEVICES = [
  { group: "Web", items: [
    { id: "responsive", label: "Responsive", w: 1024, h: 720, chrome: "responsive" },
    { id: "web-desktop", label: "Desktop 1440", w: 1440, h: 900, chrome: "browser" },
    { id: "web-laptop", label: "Laptop 1280", w: 1280, h: 800, chrome: "browser" },
    { id: "web-tablet", label: "Tablet 768", w: 768, h: 1024, chrome: "browser" },
    { id: "web-mobile", label: "Mobile 390", w: 390, h: 844, chrome: "browser" },
  ]},
  { group: "Desktop app", items: [
    { id: "winui", label: "Windows (WinUI)", w: 1024, h: 640, chrome: "windows", title: "App" },
    { id: "winui-sm", label: "Windows compact", w: 800, h: 560, chrome: "windows", title: "App" },
    { id: "macos", label: "macOS window", w: 1024, h: 640, chrome: "macos", title: "App" },
    { id: "macos-sm", label: "macOS compact", w: 820, h: 560, chrome: "macos", title: "App" },
  ]},
  { group: "Mobile", items: [
    { id: "iphone-15", label: "iPhone 15", w: 393, h: 852, chrome: "phone", platform: "ios" },
    { id: "iphone-se", label: "iPhone SE", w: 375, h: 667, chrome: "phone", platform: "ios" },
    { id: "pixel-8", label: "Pixel 8", w: 412, h: 915, chrome: "phone", platform: "android" },
  ]},
  { group: "Tablet", items: [
    { id: "ipad", label: 'iPad 11"', w: 834, h: 1194, chrome: "tablet" },
    { id: "surface", label: "Surface Pro", w: 912, h: 1368, chrome: "tablet" },
  ]},
];
function findDevice(id) {
  for (const g of DEVICES) for (const d of g.items) if (d.id === id) return d;
  return DEVICES[0].items[0];
}

let state = { design: null, proto: null, runtime: null, deviceId: "iphone-15", w: 393, h: 852, zoom: "fit", theme: "light", validation: null, showOutline: false };

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
}

// ---- component definitions (rendered by window.DSComp, a pure JSON interpreter) ----
// No React/Babel needed — the interpreter module (components-render.mjs) is loaded as an
// ESM <script type="module"> by the shell and sets window.DSComp before the first render.
// Module scripts are deferred, so briefly wait for it in case a render races module load.
function whenDSComp(timeoutMs = 3000) {
  if (window.DSComp) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.DSComp || Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve(!!window.DSComp); }
    }, 15);
  });
}

// ---- CSS variables from tokens (mirrors designio.tokensToCssVars, theme-aware) ----
function colorList(tokens) {
  const c = tokens?.colors;
  if (Array.isArray(c)) return c;
  if (c && typeof c === "object") return Object.entries(c).map(([name, value]) => ({ name, value }));
  return [];
}
function baseColor(c) {
  if (typeof c.value === "string" && c.value) return c.value;
  const th = c.themes; if (th && typeof th === "object") return th.light || th.dark || th.highContrast || "";
  return "";
}
function colorForTheme(c, theme) {
  const th = c?.themes;
  if (th && typeof th === "object" && th[theme]) return th[theme];
  if (theme !== "light" && th && th.light) return th.light;
  return baseColor(c);
}
function cssVarsFromTokens(tokens, theme) {
  const lines = [];
  for (const c of colorList(tokens)) lines.push(`--color-${c.name}: ${colorForTheme(c, theme)};`);
  const ty = tokens?.typography || {};
  if (ty.display?.family) lines.push(`--font-display: ${ty.display.family};`);
  if (ty.body?.family) lines.push(`--font-body: ${ty.body.family};`);
  if (ty.mono?.family) lines.push(`--font-mono: ${ty.mono.family};`);
  for (const s of tokens?.spacing?.scale || []) lines.push(`--space-${s.name}: ${s.value};`);
  for (const r of tokens?.radii || []) lines.push(`--radius-${r.name}: ${r.value};`);
  for (const sh of tokens?.shadows || []) lines.push(`--shadow-${sh.name}: ${sh.value};`);
  return `:root{\n  ${lines.join("\n  ")}\n}`;
}
function applyVars() {
  let tag = $("#proto-vars");
  if (!tag) { tag = el("style", { id: "proto-vars" }); document.head.append(tag); }
  tag.textContent = cssVarsFromTokens(state.design?.tokens || {}, state.theme);
}

// ---- device frame ----------------------------------------------------------
function chromeBrowser() {
  return el("div", { class: "chrome-browser" },
    el("div", { class: "dots" },
      el("span", { class: "dot", style: "background:#ff5f57" }),
      el("span", { class: "dot", style: "background:#febc2e" }),
      el("span", { class: "dot", style: "background:#28c840" })),
    el("div", { class: "addr" }, "localhost:3000"));
}
function chromeWindows(title) {
  return el("div", { class: "chrome-windows" },
    el("span", { class: "title" }, title || "App"),
    el("div", { class: "wbtns" }, el("span", { class: "wbtn" }, "—"), el("span", { class: "wbtn" }, "▢"), el("span", { class: "wbtn close" }, "✕")));
}
function chromeMac(title) {
  return el("div", { class: "chrome-macos" },
    el("div", { class: "lights" }, el("span", { class: "light r" }), el("span", { class: "light y" }), el("span", { class: "light g" })),
    el("span", { class: "title" }, title || "App"));
}

// Build the device element and return the surface node the scene renders into.
function buildDevice(preset, w, h) {
  const device = el("div", { class: `device ${preset.chrome}` });
  const surface = el("div", { class: "screen-surface", style: "height:100%;overflow:auto" });

  if (preset.chrome === "browser") {
    device.append(chromeBrowser());
    device.append(el("div", { class: "viewport", style: `width:${w}px;height:${h}px` }, surface));
  } else if (preset.chrome === "windows") {
    device.append(chromeWindows(preset.title));
    device.append(el("div", { class: "viewport", style: `width:${w}px;height:${h}px` }, surface));
  } else if (preset.chrome === "macos") {
    device.append(chromeMac(preset.title));
    device.append(el("div", { class: "viewport", style: `width:${w}px;height:${h}px` }, surface));
  } else if (preset.chrome === "phone") {
    device.append(el("div", { class: "notch" }));
    const status = el("div", { class: "chrome-phone-status" }, el("span", {}, "9:41"), el("span", {}, "5G ▾ 100%"));
    const home = el("div", { class: "chrome-phone-home" }, el("span", { class: "bar" }));
    const vp = el("div", { class: "viewport", style: `width:${w}px;height:${h}px;display:flex;flex-direction:column` }, status, surface, home);
    surface.style.cssText = "flex:1;min-height:0;overflow:auto;position:relative";
    device.append(vp);
  } else { // tablet / responsive
    device.append(el("div", { class: "viewport", style: `width:${w}px;height:${h}px` }, surface));
  }
  return { device, surface };
}

let currentSurface = null;
function renderFrame() {
  const wrap = $("#frame-wrap");
  wrap.innerHTML = "";
  const preset = findDevice(state.deviceId);
  const { device, surface } = buildDevice(preset, state.w, state.h);
  currentSurface = surface;
  wrap.append(device);
  renderSurface();
  applyZoom();
}
function renderSurface() {
  if (!currentSurface || !state.runtime) return;
  ProtoRender.renderScreen(currentSurface, state.runtime, state.design?.tokens || {});
  syncScreenSelect();
}

function applyZoom() {
  const wrap = $("#frame-wrap");
  if (state.zoom === "fit") {
    const stage = $(".stage");
    const fw = wrap.firstChild ? wrap.firstChild.offsetWidth : state.w;
    const fh = wrap.firstChild ? wrap.firstChild.offsetHeight : state.h;
    const sw = stage.clientWidth - 56, sh = stage.clientHeight - 56;
    const scale = Math.min(1, sw / fw, sh / fh);
    wrap.style.transform = `scale(${scale > 0 ? scale : 1})`;
  } else {
    wrap.style.transform = `scale(${state.zoom})`;
  }
}

// ---- toolbar wiring --------------------------------------------------------
function fillDeviceSelect() {
  const sel = $("#device-select");
  sel.innerHTML = "";
  for (const g of DEVICES) {
    const og = el("optgroup", { label: g.group });
    for (const d of g.items) og.append(el("option", { value: d.id }, `${d.label} · ${d.w}×${d.h}`));
    sel.append(og);
  }
  sel.value = state.deviceId;
}
function syncSizeInputs() { $("#w").value = state.w; $("#h").value = state.h; }
function fillScreenSelect() {
  const sel = $("#screen-select");
  sel.innerHTML = "";
  for (const s of state.runtime?.screens || []) sel.append(el("option", { value: s.id }, s.name || s.id));
  syncScreenSelect();
}
function syncScreenSelect() { const sel = $("#screen-select"); if (sel && state.runtime) sel.value = state.runtime.currentId; }

function setDevice(id) {
  const d = findDevice(id);
  state.deviceId = id; state.w = d.w; state.h = d.h;
  syncSizeInputs(); renderFrame();
}

// ---- validation + outline panels ------------------------------------------
function renderValidation() {
  const slot = $("#validation-slot");
  slot.innerHTML = "";
  const v = state.validation;
  if (!v) return;
  if (state.proto?.parseError) slot.append(el("div", { class: "vmsg err" }, `Parse error: ${state.proto.parseError}`));
  for (const e of v.errors || []) slot.append(el("div", { class: "vmsg err" }, e));
  for (const w of v.warnings || []) slot.append(el("div", { class: "vmsg warn" }, w));
  if (v.ok && !(v.warnings || []).length && !state.proto?.parseError) slot.append(el("div", { class: "vmsg ok" }, "No issues — navigation, components, and tokens all resolve."));
}
async function toggleOutline() {
  const slot = $("#outline-slot");
  if (slot.innerHTML) { slot.innerHTML = ""; return; }
  try { const { markdown } = await api("/api/prototypes/outline"); slot.append(el("pre", {}, markdown || "No screens yet.")); }
  catch (e) { slot.append(el("pre", {}, "Outline failed: " + (e.message || e))); }
}

// ---- load ------------------------------------------------------------------
async function load() {
  const data = await api("/api/prototypes");
  await whenDSComp();
  state.design = data.design;
  state.proto = data.proto;
  state.validation = data.validation;
  state.runtime = ProtoRender.createRuntime({ doc: data.proto.doc, componentsDoc: data.design.componentsDoc });
  state.runtime.onChange(() => { renderSurface(); });
  state.runtime.onNavigate(() => { syncScreenSelect(); });

  // Default device: honor the first screen's declared device if present.
  const firstDevice = data.proto.doc.screens?.[0]?.device;
  if (firstDevice && findDevice(firstDevice).id === firstDevice) { state.deviceId = firstDevice; const d = findDevice(firstDevice); state.w = d.w; state.h = d.h; }

  const pill = $("#source-pill");
  pill.textContent = data.proto.source === "repo" ? ".agents/design/prototypes.jsonc" : "starter (sample)";
  pill.classList.toggle("repo", data.proto.source === "repo");

  if (state.runtime.buildError) $("#source-pill").title = "Component preview build error: " + state.runtime.buildError;

  fillDeviceSelect(); syncSizeInputs(); fillScreenSelect(); applyVars(); renderValidation(); renderFrame();
}

function wire() {
  $("#device-select").addEventListener("change", (e) => setDevice(e.target.value));
  $("#w").addEventListener("change", (e) => { state.w = Math.max(120, parseInt(e.target.value, 10) || state.w); renderFrame(); });
  $("#h").addEventListener("change", (e) => { state.h = Math.max(120, parseInt(e.target.value, 10) || state.h); renderFrame(); });
  $("#rotate-btn").addEventListener("click", () => { const w = state.w; state.w = state.h; state.h = w; syncSizeInputs(); renderFrame(); });
  $("#zoom-select").addEventListener("change", (e) => { state.zoom = e.target.value === "fit" ? "fit" : parseFloat(e.target.value); applyZoom(); });
  $("#screen-select").addEventListener("change", (e) => state.runtime?.setScreen(e.target.value));
  $("#back-btn").addEventListener("click", () => state.runtime?.dispatch({ back: true }));
  $("#reload-btn").addEventListener("click", () => load().catch((e) => console.error(e)));
  $("#validate-btn").addEventListener("click", () => { const slot = $("#validation-slot"); slot.innerHTML ? (slot.innerHTML = "") : renderValidation(); });
  $("#outline-btn").addEventListener("click", () => toggleOutline().catch((e) => console.error(e)));

  for (const btn of document.querySelectorAll(".theme-btn")) {
    btn.addEventListener("click", () => {
      state.theme = btn.dataset.theme;
      for (const b of document.querySelectorAll(".theme-btn")) { const on = b === btn; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); }
      applyVars();
    });
  }

  window.addEventListener("resize", () => { if (state.zoom === "fit") applyZoom(); });

  // Live reload when the file changes on disk.
  try {
    const es = new EventSource("/events");
    es.addEventListener("changed", () => load().catch(() => {}));
  } catch { /* no SSE */ }
}

wire();
load().catch((e) => { $("#source-pill").textContent = "error"; console.error(e); });
