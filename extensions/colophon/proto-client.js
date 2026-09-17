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
    { id: "winui-modern", label: "Windows (WinUI, modern titlebar)", w: 1024, h: 640, chrome: "windows-modern", title: "App" },
    { id: "winui-modern-sm", label: "Windows modern compact", w: 800, h: 560, chrome: "windows-modern", title: "App" },
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

let state = {
  design: null, proto: null, runtime: null,
  deviceId: "iphone-15", w: 393, h: 852, zoom: "fit", theme: "light",
  validation: null, showOutline: false, showValidation: false, exportPath: null,
  inspectMode: false, selectedPath: null, dragPath: null,
  dirty: false, saving: false, suppressChangedUntil: 0,
  editRevision: 0,
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  const payload = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const error = new Error(payload?.error || `${path} -> ${res.status}`);
    error.validation = payload?.validation;
    throw error;
  }
  return payload;
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
  for (const style of ty.scale || []) {
    if (!style?.name) continue;
    const role = style.role || "body";
    lines.push(`--text-${style.name}-family: var(--font-${role});`);
    if (style.size) lines.push(`--text-${style.name}-size: ${style.size};`);
    if (style.lineHeight) lines.push(`--text-${style.name}-line-height: ${style.lineHeight};`);
    if (style.weight != null) lines.push(`--text-${style.name}-weight: ${style.weight};`);
    lines.push(`--text-${style.name}-tracking: ${style.tracking || "normal"};`);
  }
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
// Classic Windows title bar: a caption strip above the content with the app title and the
// min/max/close buttons on the right. This is the default `windows` chrome.
function chromeWindows(title) {
  return el("div", { class: "chrome-windows" },
    el("span", { class: "title" }, title || "App"),
    el("div", { class: "wbtns" }, el("span", { class: "wbtn" }, "—"), el("span", { class: "wbtn" }, "▢"), el("span", { class: "wbtn close" }, "✕")));
}
// Modern Windows "ExtendsContentIntoTitleBar": the app content fills the whole window and the
// caption buttons (min/max/close) float over the top-right. Opt in via the `windows-modern`
// chrome; screens reserve room for the buttons on their titlebar's right (the
// `tb-caption-reserve` convention in prototypes.jsonc).
function winCaption() {
  return el("div", { class: "win-caption" },
    el("span", { class: "wbtn" }, "\uE921"),
    el("span", { class: "wbtn" }, "\uE922"),
    el("span", { class: "wbtn close" }, "\uE8BB"));
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
    // Classic frame: caption strip above the content.
    device.append(chromeWindows(preset.title));
    device.append(el("div", { class: "viewport", style: `width:${w}px;height:${h}px` }, surface));
  } else if (preset.chrome === "windows-modern") {
    // Modern frame: no caption strip — the content extends into the titlebar and the
    // caption buttons float on top (top-right). The device box clips the overlay.
    device.append(el("div", { class: "viewport", style: `width:${w}px;height:${h}px` }, surface));
    device.append(winCaption());
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
  window.DSInteractions?.disposeTree(wrap);
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
  applySelectionHighlight();
  syncScreenNav();
}

// ---- inspect, edit, and layer ordering --------------------------------------
function pathKey(path) { return JSON.stringify(path || []); }
function pointerFor(path) {
  return "/" + (path || []).map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}
function valueAtPath(root, path) {
  let value = root;
  for (const part of path || []) {
    if (value == null || !(part in value)) return null;
    value = value[part];
  }
  return value;
}
function replaceAtPath(root, path, value) {
  const parent = valueAtPath(root, path.slice(0, -1));
  if (parent == null) throw new Error("The selected layer no longer exists.");
  parent[path[path.length - 1]] = value;
}
function findPathByReference(root, wanted) {
  let found = null;
  const visit = (value, path) => {
    if (found || value == null || typeof value !== "object") return;
    if (value === wanted) { found = path; return; }
    if (Array.isArray(value)) value.forEach((child, index) => visit(child, [...path, index]));
    else for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(root, []);
  return found;
}
function isPathPrefix(parent, child) {
  return parent.length <= child.length && parent.every((part, index) => part === child[index]);
}
function currentScreenIndex() {
  return (state.proto?.doc?.screens || []).findIndex((screen) => screen.id === state.runtime?.currentId);
}
function layerLabel(node) {
  const kind = ProtoRender.nodeKind(node) || "node";
  const detail = node.id || node.component || node.text || node.alt || kind;
  return { kind, detail: String(detail) };
}
function setDirty(dirty = true) {
  if (dirty) state.editRevision++;
  state.dirty = dirty;
  if (window.__COLOPHON_PROTOTYPE_EXPORT__) return;
  for (const id of ["save-btn", "nav-save-btn"]) $(`#${id}`).disabled = !dirty || state.saving;
  for (const id of ["export-btn", "publish-btn"]) $(`#${id}`).disabled = dirty || state.saving;
  setSaveStatus(state.saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved");
}
function setSaveStatus(message) {
  for (const id of ["save-status", "nav-save-status"]) $(`#${id}`).textContent = message;
}
function applySelectionHighlight() {
  if (!currentSurface) return;
  for (const node of currentSurface.querySelectorAll("[data-proto-path]")) {
    node.classList.toggle("proto-selected", !!state.selectedPath && node.dataset.protoPath === pathKey(state.selectedPath));
  }
}
function postSelection() {
  if (!state.selectedPath || window.__COLOPHON_PROTOTYPE_EXPORT__) return;
  const element = valueAtPath(state.proto?.doc, state.selectedPath);
  api("/api/prototypes/select", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ screenId: state.runtime?.currentId, path: state.selectedPath, element, draft: state.dirty }),
  }).catch(() => {});
}
function selectPath(path, { notify = true } = {}) {
  const node = valueAtPath(state.proto?.doc, path);
  if (!node || !ProtoRender.nodeKind(node)) return;
  state.selectedPath = path.slice();
  renderLayers();
  renderElementEditor();
  applySelectionHighlight();
  if (notify) postSelection();
}
function renderLayerNode(node, path, depth, root = false) {
  const { kind, detail } = layerLabel(node);
  const row = el("div", {
    class: `layer-row${pathKey(path) === pathKey(state.selectedPath) ? " is-selected" : ""}`,
    draggable: root ? "false" : "true",
    style: `padding-left:${depth * 14}px`,
    "data-layer-path": pathKey(path),
  });
  row.append(el("button", { type: "button", title: detail },
    el("span", { class: "layer-kind" }, `${kind} `), detail));
  row.querySelector("button").addEventListener("click", () => selectPath(path));
  if (!root) {
    row.addEventListener("dragstart", (event) => {
      state.dragPath = path.slice();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", pathKey(path));
    });
    row.addEventListener("dragend", () => { state.dragPath = null; row.classList.remove("is-drop-before"); });
    row.addEventListener("dragover", (event) => {
      if (!state.dragPath || isPathPrefix(state.dragPath, path)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      row.classList.add("is-drop-before");
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-drop-before"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("is-drop-before");
      moveLayerBefore(state.dragPath, path);
      state.dragPath = null;
    });
  }
  const fragment = document.createDocumentFragment();
  fragment.append(row);
  for (const [index, child] of (node.children || []).entries()) {
    fragment.append(renderLayerNode(child, [...path, "children", index], depth + 1));
  }
  return fragment;
}
function renderLayers() {
  const slot = $("#layers");
  if (!slot) return;
  slot.innerHTML = "";
  const index = currentScreenIndex();
  const screen = state.proto?.doc?.screens?.[index];
  if (!screen?.root) {
    slot.append(el("div", { class: "proto-empty" }, "No layers on this screen."));
    return;
  }
  slot.append(renderLayerNode(screen.root, ["screens", index, "root"], 0, true));
  for (const [modalIndex, modal] of (screen.modals || []).entries()) {
    if (modal?.root) slot.append(renderLayerNode(modal.root, ["screens", index, "modals", modalIndex, "root"], 0, true));
  }
}
function moveLayerBefore(sourcePath, targetPath) {
  if (!sourcePath || !targetPath || isPathPrefix(sourcePath, targetPath)) return;
  const doc = state.proto?.doc;
  const sourceNode = valueAtPath(doc, sourcePath);
  const targetNode = valueAtPath(doc, targetPath);
  const sourceParent = valueAtPath(doc, sourcePath.slice(0, -1));
  if (!sourceNode || !targetNode || !Array.isArray(sourceParent)) return;
  sourceParent.splice(sourceParent.indexOf(sourceNode), 1);
  const freshTargetPath = findPathByReference(doc, targetNode);
  const targetParent = freshTargetPath && valueAtPath(doc, freshTargetPath.slice(0, -1));
  if (!freshTargetPath || !Array.isArray(targetParent)) return;
  targetParent.splice(freshTargetPath[freshTargetPath.length - 1], 0, sourceNode);
  state.selectedPath = findPathByReference(doc, sourceNode);
  setDirty();
  rebuildRuntime();
}
function renderElementEditor() {
  if (window.__COLOPHON_PROTOTYPE_EXPORT__) return;
  const node = valueAtPath(state.proto?.doc, state.selectedPath || []);
  const selected = !!node && !!ProtoRender.nodeKind(node);
  const label = selected ? layerLabel(node) : null;
  $("#selection-title").textContent = selected ? label.detail : "No selection";
  $("#selection-path").textContent = selected ? pointerFor(state.selectedPath) : "";
  $("#selection-path").title = selected ? pointerFor(state.selectedPath) : "";
  $("#json-editor").disabled = !selected;
  $("#apply-json-btn").disabled = !selected;
  $("#attach-btn").disabled = !selected || !!window.__COLOPHON_PROTOTYPE_EXPORT__;
  $("#json-editor").value = selected ? JSON.stringify(node, null, 2) : "";
  $("#editor-error").textContent = "";
}
function rebuildRuntime(currentId = state.runtime?.currentId) {
  state.runtime = ProtoRender.createRuntime({ doc: state.proto.doc, componentsDoc: state.design.componentsDoc });
  state.runtime.onChange(() => renderSurface());
  state.runtime.onNavigate(() => {
    state.selectedPath = null;
    syncScreenNav();
    renderLayers();
    renderElementEditor();
  });
  if (currentId) state.runtime.setScreen(currentId);
  fillScreenNav();
  renderLayers();
  renderElementEditor();
  renderSurface();
  if (state.selectedPath) postSelection();
}
function applyJsonEdit() {
  try {
    const next = JSON.parse($("#json-editor").value);
    if (!next || typeof next !== "object" || Array.isArray(next) || !ProtoRender.nodeKind(next)) {
      throw new Error("Element JSON must be an object with a layout, component, text, image, or spacer kind.");
    }
    replaceAtPath(state.proto.doc, state.selectedPath, next);
    setDirty();
    rebuildRuntime();
    $("#editor-error").textContent = "";
  } catch (error) {
    $("#editor-error").textContent = error.message || String(error);
  }
}
async function savePrototype() {
  if (!state.dirty || state.saving) return;
  state.saving = true;
  setDirty(true);
  const revision = state.editRevision;
  try {
    state.suppressChangedUntil = Date.now() + 750;
    const result = await api("/api/prototypes/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc: state.proto.doc }),
    });
    state.proto.source = "repo";
    state.saving = false;
    const changedDuringSave = state.editRevision !== revision;
    setDirty(changedDuringSave);
    if (!changedDuringSave) state.validation = result.validation;
    $("#screen-nav-error").textContent = "";
    renderSourcePill();
    postSelection();
  } catch (error) {
    state.suppressChangedUntil = 0;
    state.saving = false;
    setDirty(true);
    if (error.validation) state.validation = error.validation;
    setSaveStatus("Save failed");
    $("#screen-nav-error").textContent = error.message || "Save failed";
  }
}
async function attachSelection() {
  if (!state.selectedPath) return;
  const button = $("#attach-btn");
  try {
    button.disabled = true;
    const result = await api("/api/prototypes/attach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        screenId: state.runtime.currentId,
        path: state.selectedPath,
        element: valueAtPath(state.proto.doc, state.selectedPath),
        draft: state.dirty,
      }),
    });
    button.textContent = "Sent";
    $("#save-status").textContent = `${result.title} sent to chat`;
    setTimeout(() => { button.textContent = "Send to chat"; button.disabled = false; }, 1400);
  } catch (error) {
    button.disabled = false;
    $("#editor-error").textContent = error.message || String(error);
  }
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
function fillScreenNav() {
  const list = $("#screen-list");
  list.replaceChildren();
  const sections = Array.isArray(state.proto?.doc?.sections) ? state.proto.doc.sections : [];
  if ($("#screen-sections-heading")) $("#screen-sections-heading").hidden = sections.length === 0;
  const groups = new Map();
  const ungrouped = [];
  for (const screen of state.runtime?.screens || []) {
    const label = screen.name || screen.id;
    const row = el("li", {}, el("button", {
      type: "button", class: "screen-nav-link", "data-screen-id": screen.id, title: label,
      onclick: () => {
        if (state.runtime.currentId !== screen.id) state.runtime.dispatch({ navigate: screen.id });
      },
    }, label));
    if (sections.some((section) => section.id === screen.sectionId)) {
      if (!groups.has(screen.sectionId)) groups.set(screen.sectionId, []);
      groups.get(screen.sectionId).push(row);
    } else ungrouped.push(row);
  }
  if (ungrouped.length) {
    if (sections.length) {
      list.append(el("li", { class: "screen-section" },
        el("h3", { class: "screen-section-title" }, "Ungrouped"),
        el("ul", { class: "screen-nav-list", "aria-label": "Ungrouped" }, ungrouped)));
    } else list.append(...ungrouped);
  }
  for (const section of sections) {
    const rows = groups.get(section.id) || [];
    list.append(el("li", { class: "screen-section", "data-section-id": section.id },
      el("h3", { class: "screen-section-title" }, section.name),
      el("ul", { class: "screen-nav-list", "aria-label": section.name },
        rows.length ? rows : el("li", { class: "screen-nav-empty" }, "No screens yet."))));
  }
  if (!list.children.length) list.append(el("li", { class: "screen-nav-empty" }, "No screens yet."));
  if ($("#screen-section")) fillSectionOptions($("#screen-section"));
  syncScreenNav();
}
function syncScreenNav() {
  for (const button of $("#screen-list").querySelectorAll("[data-screen-id]")) {
    const active = button.dataset.screenId === state.runtime?.currentId;
    const changed = active && !button.classList.contains("is-active");
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    if (changed) button.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  if ($("#screen-section")) {
    const screen = state.runtime?.screen();
    $("#screen-section").disabled = !screen;
    $("#screen-section").value = screen?.sectionId || "";
    $("#delete-screen-btn").disabled = !screen;
  }
}

function fillSectionOptions(select, selected = "") {
  select.replaceChildren(el("option", { value: "" }, "Ungrouped"));
  for (const section of Array.isArray(state.proto?.doc?.sections) ? state.proto.doc.sections : []) {
    select.append(el("option", { value: section.id }, section.name));
  }
  select.append(el("option", { value: "", "data-action": "add-section" }, "Add section"));
  select.value = selected;
}
function openScreenDialog(kind, assignScreenId = "") {
  const dialog = $("#screen-dialog");
  dialog.dataset.kind = kind;
  dialog.dataset.assignScreenId = assignScreenId;
  $("#screen-dialog-title").textContent = kind === "section" ? "Add section" : "Add screen";
  $("#screen-name").value = "";
  $("#screen-name").setCustomValidity("");
  $("#new-screen-section-field").hidden = kind === "section";
  $("#new-section-name-field").hidden = true;
  $("#new-section-name").disabled = true;
  $("#new-section-name").value = "";
  $("#new-section-name").setCustomValidity("");
  fillSectionOptions($("#new-screen-section"), state.runtime?.screen()?.sectionId || "");
  dialog.showModal();
  $("#screen-name").focus();
}
function finishScreenEdit(currentId = state.runtime?.currentId) {
  state.selectedPath = null;
  state.validation = null;
  state.showValidation = false;
  renderValidation();
  $("#screen-nav-error").textContent = "";
  setDirty();
  rebuildRuntime(currentId);
}
function addScreenOrSection(event) {
  event.preventDefault();
  const name = $("#screen-name").value.trim();
  if (!name) {
    $("#screen-name").setCustomValidity("Enter a name.");
    $("#screen-name").reportValidity();
    return;
  }
  const kind = $("#screen-dialog").dataset.kind;
  const id = `${kind}-${crypto.randomUUID()}`;
  if (kind === "section") {
    if (!Array.isArray(state.proto.doc.sections)) state.proto.doc.sections = [];
    state.proto.doc.sections.push({ id, name });
    const screen = state.proto.doc.screens.find((screen) => screen.id === $("#screen-dialog").dataset.assignScreenId);
    if (screen) screen.sectionId = id;
    finishScreenEdit();
  } else {
    let sectionId = $("#new-screen-section").value;
    if ($("#new-screen-section").selectedOptions[0]?.dataset.action === "add-section") {
      const sectionName = $("#new-section-name").value.trim();
      if (!sectionName) {
        $("#new-section-name").setCustomValidity("Enter a section name.");
        $("#new-section-name").reportValidity();
        return;
      }
      sectionId = `section-${crypto.randomUUID()}`;
      if (!Array.isArray(state.proto.doc.sections)) state.proto.doc.sections = [];
      state.proto.doc.sections.push({ id: sectionId, name: sectionName });
    }
    state.proto.doc.screens.push({
      id, name, device: state.deviceId,
      ...(sectionId ? { sectionId } : {}),
      root: { id: `${id}-root`, layout: "stack", children: [
        { id: `${id}-title`, text: name, style: "title" },
      ] },
    });
    finishScreenEdit(id);
  }
  $("#screen-dialog").close();
  if (kind === "screen") $("#screen-list [aria-current]")?.focus();
}
function deleteCurrentScreen() {
  const screen = state.runtime?.screen();
  if (!screen) return;
  if (!window.confirm(`Delete "${screen.name || screen.id}"? Links to this screen and flows that start here will also be removed. Save to keep this deletion.`)) return;
  const doc = state.proto.doc;
  const index = doc.screens.indexOf(screen);
  doc.screens.splice(index, 1);
  // Only remove navigation references, never matching text or arbitrary state values.
  const removeLinks = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.on?.tap?.navigate === screen.id) {
      delete node.on.tap.navigate;
      if (!Object.keys(node.on.tap).length) delete node.on.tap;
      if (!Object.keys(node.on).length) delete node.on;
    }
    for (const child of node.children || []) removeLinks(child);
  };
  for (const remaining of doc.screens) {
    removeLinks(remaining.root);
    for (const modal of remaining.modals || []) removeLinks(modal.root);
  }
  doc.flows = (doc.flows || []).filter((flow) => flow.start !== screen.id);
  finishScreenEdit(doc.screens[Math.min(index, doc.screens.length - 1)]?.id);
  ($("#screen-list [aria-current]") || $("#add-screen-btn")).focus();
}

function setDevice(id) {
  const d = findDevice(id);
  state.deviceId = id; state.w = d.w; state.h = d.h;
  syncSizeInputs(); renderFrame();
}

// ---- validation + outline panels ------------------------------------------
function renderValidation() {
  const slot = $("#validation-slot");
  slot.innerHTML = "";
  if (!state.showValidation) return;
  const v = state.validation;
  if (!v) return;
  const messages = [];
  if (state.proto?.parseError) messages.push(["err", `Parse error: ${state.proto.parseError}`]);
  for (const error of v.errors || []) messages.push(["err", error]);
  for (const warning of v.warnings || []) messages.push(["warn", warning]);
  if (!messages.length) messages.push(["ok", "No issues — navigation, components, and tokens all resolve."]);

  const close = el("button", { class: "validation-close", type: "button", "aria-label": "Dismiss validation results", title: "Dismiss" }, "×");
  close.addEventListener("click", () => { state.showValidation = false; renderValidation(); });
  slot.append(el("div", { class: "validation-popover" },
    el("div", { class: "validation-heading" }, "Validation", close),
    messages.map(([kind, message]) => el("div", { class: `vmsg ${kind}` }, message))));
}
async function toggleOutline() {
  const slot = $("#outline-slot");
  state.showOutline = !state.showOutline;
  $("#outline-btn").classList.toggle("is-active", state.showOutline);
  $("#outline-btn").setAttribute("aria-pressed", String(state.showOutline));
  if (!state.showOutline) { slot.innerHTML = ""; return; }
  try {
    const exported = window.__COLOPHON_PROTOTYPE_EXPORT__;
    const markdown = exported ? exported.outline : (await api("/api/prototypes/outline")).markdown;
    slot.append(el("pre", {}, markdown || "No screens yet."));
  }
  catch (e) {
    slot.append(el("pre", {}, "Outline failed: " + (e.message || e)));
  }
}

function renderSourcePill() {
  const pill = $("#source-pill");
  if (state.exportPath) {
    pill.textContent = `Exported: ${state.exportPath}`;
    pill.title = `${state.exportPath}\nClick to copy`;
    pill.classList.add("repo", "copyable");
    return;
  }
  pill.textContent = window.__COLOPHON_PROTOTYPE_EXPORT__ ? "Standalone export" : state.proto?.source === "repo" ? ".agents/design/prototypes.jsonc" : "starter (sample)";
  pill.title = "";
  pill.classList.toggle("repo", !!window.__COLOPHON_PROTOTYPE_EXPORT__ || state.proto?.source === "repo");
  pill.classList.remove("copyable");
}

async function copyExportPath() {
  if (!state.exportPath) return;
  try {
    await navigator.clipboard.writeText(state.exportPath);
    const pill = $("#source-pill");
    pill.textContent = "Copied export path";
    setTimeout(renderSourcePill, 1400);
  } catch (error) {
    $("#source-pill").title = `Could not copy automatically. Path: ${state.exportPath}`;
  }
}

// ---- load ------------------------------------------------------------------
async function load() {
  const previousScreen = state.runtime?.currentId;
  const data = window.__COLOPHON_PROTOTYPE_EXPORT__ || await api("/api/prototypes");
  await whenDSComp();
  state.design = data.design;
  state.proto = data.proto;
  state.validation = data.validation;
  state.runtime = ProtoRender.createRuntime({ doc: data.proto.doc, componentsDoc: data.design.componentsDoc });
  state.runtime.onChange(() => { renderSurface(); });
  state.runtime.onNavigate(() => {
    state.selectedPath = null;
    syncScreenNav();
    renderLayers();
    renderElementEditor();
  });
  if (previousScreen) state.runtime.setScreen(previousScreen);

  // Default device: honor the first screen's declared device if present.
  const firstDevice = data.proto.doc.screens?.[0]?.device;
  if (firstDevice && findDevice(firstDevice).id === firstDevice) { state.deviceId = firstDevice; const d = findDevice(firstDevice); state.w = d.w; state.h = d.h; }

  renderSourcePill();
  if (!state.exportPath && state.runtime.buildError) $("#source-pill").title = "Component preview build error: " + state.runtime.buildError;

  state.selectedPath = null;
  setDirty(false);
  fillDeviceSelect(); syncSizeInputs(); fillScreenNav(); applyVars(); renderValidation(); renderFrame(); renderLayers(); renderElementEditor();
}

function wire() {
  $("#add-screen-btn")?.addEventListener("click", () => openScreenDialog("screen"));
  $("#add-section-btn")?.addEventListener("click", () => openScreenDialog("section"));
  $("#screen-form")?.addEventListener("submit", addScreenOrSection);
  $("#screen-name")?.addEventListener("input", () => $("#screen-name").setCustomValidity(""));
  $("#new-section-name")?.addEventListener("input", () => $("#new-section-name").setCustomValidity(""));
  $("#new-screen-section")?.addEventListener("change", (event) => {
    const adding = event.target.selectedOptions[0]?.dataset.action === "add-section";
    $("#new-section-name-field").hidden = !adding;
    $("#new-section-name").disabled = !adding;
    if (adding) $("#new-section-name").focus();
  });
  $("#screen-dialog-cancel")?.addEventListener("click", () => $("#screen-dialog").close());
  $("#delete-screen-btn")?.addEventListener("click", deleteCurrentScreen);
  $("#screen-section")?.addEventListener("change", (event) => {
    const screen = state.runtime?.screen();
    if (!screen) return;
    if (event.target.selectedOptions[0]?.dataset.action === "add-section") {
      event.target.value = screen.sectionId || "";
      openScreenDialog("section", screen.id);
      return;
    }
    if (event.target.value) screen.sectionId = event.target.value;
    else delete screen.sectionId;
    finishScreenEdit();
  });
  $("#nav-save-btn")?.addEventListener("click", () => savePrototype());
  $("#device-select").addEventListener("change", (e) => setDevice(e.target.value));
  $("#w").addEventListener("change", (e) => { state.w = Math.max(120, parseInt(e.target.value, 10) || state.w); renderFrame(); });
  $("#h").addEventListener("change", (e) => { state.h = Math.max(120, parseInt(e.target.value, 10) || state.h); renderFrame(); });
  $("#rotate-btn").addEventListener("click", () => { const w = state.w; state.w = state.h; state.h = w; syncSizeInputs(); renderFrame(); });
  $("#zoom-select").addEventListener("change", (e) => { state.zoom = e.target.value === "fit" ? "fit" : parseFloat(e.target.value); applyZoom(); });
  $("#inspect-btn")?.addEventListener("click", () => {
    state.inspectMode = !state.inspectMode;
    window.DSInteractions?.resetTree($("#frame-wrap"));
    $("#inspect-btn").classList.toggle("is-active", state.inspectMode);
    $("#inspect-btn").setAttribute("aria-pressed", String(state.inspectMode));
    $("#inspector").hidden = !state.inspectMode;
    $("#frame-wrap").classList.toggle("inspect-mode", state.inspectMode);
    if (state.inspectMode) { renderLayers(); renderElementEditor(); }
    applyZoom();
  });
  $("#frame-wrap").addEventListener("click", (event) => {
    if (!state.inspectMode) return;
    const target = event.target.closest("[data-proto-path]");
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { selectPath(JSON.parse(target.dataset.protoPath)); } catch { /* invalid renderer metadata */ }
  }, true);
  $("#apply-json-btn")?.addEventListener("click", applyJsonEdit);
  $("#save-btn")?.addEventListener("click", () => savePrototype());
  $("#attach-btn")?.addEventListener("click", () => attachSelection());
  $("#back-btn").addEventListener("click", () => state.runtime?.dispatch({ back: true }));
  $("#reload-btn").addEventListener("click", () => {
    if (window.__COLOPHON_PROTOTYPE_EXPORT__) window.location.reload();
    else load().catch((e) => console.error(e));
  });
  $("#validate-btn").addEventListener("click", async () => {
    try {
      if (!window.__COLOPHON_PROTOTYPE_EXPORT__) {
        state.validation = await api("/api/prototypes/validate", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ doc: state.proto.doc }),
        });
      }
      state.showValidation = true;
      renderValidation();
    } catch (error) {
      $("#screen-nav-error").textContent = `Validation failed: ${error.message}`;
    }
  });
  $("#outline-btn").addEventListener("click", () => toggleOutline().catch((e) => console.error(e)));
  $("#source-pill").addEventListener("click", () => copyExportPath());
  $("#export-btn")?.addEventListener("click", async () => {
    try {
      const result = await api("/api/prototypes/export", { method: "POST" });
      state.exportPath = result.path;
      renderSourcePill();
    } catch (e) { $("#source-pill").textContent = "Export failed"; $("#source-pill").title = e.message || String(e); }
  });
  $("#publish-btn")?.addEventListener("click", async () => {
    $("#export-menu").hidden = true;
    $("#export-menu-btn").setAttribute("aria-expanded", "false");
    if (!window.confirm("Publish this prototype to GitHub Pages? This creates a commit on the gh-pages branch.")) return;
    try {
      const result = await api("/api/prototypes/publish", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      state.exportPath = result.export.path;
      renderSourcePill();
      window.open(result.published.url, "_blank", "noopener");
    } catch (e) { $("#source-pill").textContent = "Publish failed"; $("#source-pill").title = e.message || String(e); }
  });
  $("#export-menu-btn")?.addEventListener("click", () => {
    const menu = $("#export-menu");
    const open = menu.hidden;
    menu.hidden = !open;
    $("#export-menu-btn").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".split-button")) {
      const menu = $("#export-menu");
      if (menu) menu.hidden = true;
      $("#export-menu-btn")?.setAttribute("aria-expanded", "false");
    }
  });

  for (const btn of document.querySelectorAll(".theme-btn")) {
    btn.addEventListener("click", () => {
      state.theme = btn.dataset.theme;
      for (const b of document.querySelectorAll(".theme-btn")) { const on = b === btn; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); }
      applyVars();
    });
  }

  window.addEventListener("resize", () => { if (state.zoom === "fit") applyZoom(); });

  if (!window.__COLOPHON_PROTOTYPE_EXPORT__) {
    try {
      const es = new EventSource("/events");
      es.addEventListener("changed", () => {
        if (state.saving || Date.now() < state.suppressChangedUntil) return;
        if (state.dirty) { setSaveStatus("File changed on disk — reload to replace local edits"); return; }
        load().catch(() => {});
      });
    } catch { /* no SSE */ }
  }
}

wire();
load().catch((e) => { $("#source-pill").textContent = "error"; console.error(e); });
