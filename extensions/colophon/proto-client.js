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
  inspectorTab: "properties", past: [], future: [], propertyEdit: null,
  freeformDrag: null, suppressInspectClickUntil: 0, savedDocument: null,
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
let renderedScreenId = null;
function renderFrame() {
  cancelFreeformDrag();
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
  const sameScreen = renderedScreenId === state.runtime.currentId;
  const scroll = new Map((sameScreen ? [...currentSurface.querySelectorAll("[data-proto-path]")] : []).map((node) =>
    [node.dataset.protoPath, { top: node.scrollTop, left: node.scrollLeft }]));
  const surfaceScroll = { top: sameScreen ? currentSurface.scrollTop : 0, left: sameScreen ? currentSurface.scrollLeft : 0 };
  ProtoRender.renderScreen(currentSurface, state.runtime, state.design?.tokens || {});
  renderedScreenId = state.runtime.currentId;
  currentSurface.scrollTop = surfaceScroll.top;
  currentSurface.scrollLeft = surfaceScroll.left;
  for (const node of currentSurface.querySelectorAll("[data-proto-path]")) {
    const previous = scroll.get(node.dataset.protoPath);
    if (previous) { node.scrollTop = previous.top; node.scrollLeft = previous.left; }
  }
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
  state.dirty = dirty;
  if (window.__COLOPHON_PROTOTYPE_EXPORT__) return;
  for (const id of ["save-btn", "nav-save-btn"]) $(`#${id}`).disabled = !dirty || state.saving || !!state.freeformDrag;
  for (const id of ["export-btn", "publish-btn"]) $(`#${id}`).disabled = dirty || state.saving;
  setSaveStatus(state.saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved");
}
function refreshDirty() {
  setDirty(JSON.stringify(state.proto.doc) !== state.savedDocument);
  updateHistoryButtons();
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function editorSnapshot() {
  return { doc: clone(state.proto.doc), path: state.selectedPath?.slice() || null, screenId: state.runtime?.currentId };
}
function restoreSnapshot(snapshot) {
  state.proto.doc = clone(snapshot.doc);
  state.selectedPath = snapshot.path?.slice() || null;
  state.runtime.updateDocument(state.proto.doc);
  if (snapshot.screenId && state.runtime.currentId !== snapshot.screenId) state.runtime.setScreen(snapshot.screenId);
}
function prototypeTokenNames() {
  const tokens = state.design?.tokens || {};
  return {
    colors: colorList(tokens).map((token) => token.name),
    spacing: (tokens.spacing?.scale || []).map((token) => token.name),
    radii: (tokens.radii || []).map((token) => token.name),
    shadows: (tokens.shadows || []).map((token) => token.name),
    textStyles: (tokens.typography?.scale || []).map((token) => token.name),
    fontFamilies: ["body", "display", "mono"],
  };
}
function validateDraft() {
  const errors = [];
  const tokens = prototypeTokenNames();
  const visit = (node, parent) => {
    if (!node || typeof node !== "object" || Array.isArray(node) || !ProtoRender.nodeKind(node)) {
      errors.push("Each layer must be an object with a layout, component, text, image, or spacer kind.");
      return;
    }
    errors.push(...ProtoLayout.validateNode(node, parent, tokens).errors);
    if (node.component && !state.runtime.componentNames.includes(node.component)) errors.push(`Unknown component "${node.component}".`);
    if (node.children != null && !Array.isArray(node.children)) errors.push("Layer children must be an array.");
    else for (const child of node.children || []) visit(child, node);
  };
  for (const screen of state.proto.doc.screens || []) {
    if (screen.root) visit(screen.root, null);
    for (const modal of screen.modals || []) if (modal.root) visit(modal.root, null);
  }
  if (errors.length) throw new Error(errors.join(" "));
}
function editorError(error) {
  $("#editor-error").textContent = error?.message || String(error);
}
function updateHistoryButtons() {
  if (window.__COLOPHON_PROTOTYPE_EXPORT__) return;
  $("#layers-undo-btn").disabled = state.past.length === 0 || !!state.freeformDrag;
  $("#layers-redo-btn").disabled = state.future.length === 0 || !!state.freeformDrag;
  const editable = state.selectedPath?.at(-2) === "children";
  $("#layers-duplicate-btn").disabled = !editable;
  $("#layers-delete-btn").disabled = !editable;
}
function recordMutation(before) {
  if (JSON.stringify(before.doc) === JSON.stringify(state.proto.doc)) return;
  state.past.push(before);
  if (state.past.length > 50) state.past.shift();
  state.future = [];
  state.validation = null;
  state.showValidation = false;
  renderValidation();
}
function commitPrototypeMutation(mutator) {
  if (state.freeformDrag) cancelFreeformDrag();
  if (state.propertyEdit && !commitPropertyEdit()) return false;
  const before = editorSnapshot();
  try {
    mutator();
    validateDraft();
    recordMutation(before);
    refreshDirty();
    rebuildRuntime();
    return true;
  } catch (error) {
    restoreSnapshot(before);
    rebuildRuntime();
    editorError(error);
    return false;
  }
}
function previewPropertyEdit(mutator) {
  if (!state.selectedPath) return false;
  state.propertyEdit ||= { before: editorSnapshot(), error: null };
  const previous = clone(state.proto.doc);
  try {
    mutator(valueAtPath(state.proto.doc, state.selectedPath));
    validateDraft();
    state.propertyEdit.error = null;
    $("#editor-error").textContent = "";
    state.runtime.updateDocument(state.proto.doc);
    refreshDirty();
    renderSurface();
    $("#json-editor").value = JSON.stringify(valueAtPath(state.proto.doc, state.selectedPath), null, 2);
    return true;
  } catch (error) {
    state.proto.doc = previous;
    state.runtime.updateDocument(previous);
    state.propertyEdit.error = error;
    editorError(error);
    return false;
  }
}
function commitPropertyEdit(mutator) {
  if (mutator && !state.propertyEdit) {
    return commitPrototypeMutation(() => mutator(valueAtPath(state.proto.doc, state.selectedPath)));
  }
  if (mutator) previewPropertyEdit(mutator);
  const edit = state.propertyEdit;
  if (!edit) return true;
  state.propertyEdit = null;
  if (edit.error) {
    restoreSnapshot(edit.before);
    refreshDirty();
    rebuildRuntime();
    editorError(edit.error);
    return false;
  }
  recordMutation(edit.before);
  refreshDirty();
  if (mutator) rebuildRuntime();
  else {
    renderElementEditor({ preserveProperties: true });
    postSelection();
  }
  return true;
}
function cancelPropertyEdit() {
  const edit = state.propertyEdit;
  if (!edit) return;
  state.propertyEdit = null;
  restoreSnapshot(edit.before);
  refreshDirty();
  rebuildRuntime();
}
function restoreHistory(direction) {
  cancelFreeformDrag();
  if (!commitPropertyEdit()) return;
  const from = direction === "undo" ? state.past : state.future;
  const to = direction === "undo" ? state.future : state.past;
  if (!from.length) return;
  to.push(editorSnapshot());
  restoreSnapshot(from.pop());
  refreshDirty();
  rebuildRuntime();
}
function setSaveStatus(message) {
  for (const id of ["save-status", "nav-save-status"]) $(`#${id}`).textContent = message;
}
function applySelectionHighlight() {
  if (!currentSurface) return;
  for (const node of currentSurface.querySelectorAll("[data-proto-path]")) {
    node.classList.toggle("proto-selected", !!state.selectedPath && node.dataset.protoPath === pathKey(state.selectedPath));
    const path = JSON.parse(node.dataset.protoPath);
    const value = valueAtPath(state.proto.doc, path);
    const parent = valueAtPath(state.proto.doc, path.slice(0, -2));
    node.classList.toggle("is-freeform-movable", value?.position?.mode === "absolute" && parent?.layout === "freeform");
  }
}
function postSelection() {
  if (!state.selectedPath || window.__COLOPHON_PROTOTYPE_EXPORT__) return;
  const element = valueAtPath(state.proto?.doc, state.selectedPath);
  api("/api/prototypes/select", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ screenId: state.runtime?.currentId, path: state.selectedPath, element, draft: state.dirty }),
  }).catch((error) => editorError(new Error(`Could not share selection: ${error.message}`)));
}
function selectPath(path, { notify = true } = {}) {
  if (state.propertyEdit && !commitPropertyEdit()) return;
  const node = valueAtPath(state.proto?.doc, path);
  if (!node || !ProtoRender.nodeKind(node)) return;
  state.selectedPath = path.slice();
  renderLayers();
  renderElementEditor();
  applySelectionHighlight();
  if (notify) postSelection();
}
function clearLayerDrop() {
  for (const row of document.querySelectorAll(".layer-row")) {
    row.classList.remove("is-drop-before", "is-drop-after", "is-drop-inside");
    delete row.dataset.dropPlacement;
  }
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
    row.addEventListener("dragend", () => { state.dragPath = null; clearLayerDrop(); });
  }
  row.addEventListener("dragover", (event) => {
    if (!state.dragPath || isPathPrefix(state.dragPath, path)) return;
    const bounds = row.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    const inside = ProtoRender.nodeKind(node) === "layout";
    const placement = root ? (inside ? "inside" : null)
      : ratio < .28 ? "before" : ratio > .72 ? "after" : inside ? "inside" : "before";
    if (!placement) return;
    event.preventDefault();
    event.stopPropagation();
    clearLayerDrop();
    row.dataset.dropPlacement = placement;
    row.classList.add(`is-drop-${placement}`);
    event.dataTransfer.dropEffect = "move";
  });
  row.addEventListener("dragleave", clearLayerDrop);
  row.addEventListener("drop", (event) => {
    if (!state.dragPath || !row.dataset.dropPlacement) return;
    event.preventDefault();
    event.stopPropagation();
    const source = state.dragPath.slice();
    const placement = row.dataset.dropPlacement;
    state.dragPath = null;
    clearLayerDrop();
    moveLayer(source, path, placement);
  });
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
  const scrollTop = slot.scrollTop;
  slot.innerHTML = "";
  const index = currentScreenIndex();
  const screen = state.proto?.doc?.screens?.[index];
  if (!screen?.root) {
    slot.append(el("div", { class: "proto-empty" }, "No layers on this screen."));
    updateHistoryButtons();
    return;
  }
  slot.append(renderLayerNode(screen.root, ["screens", index, "root"], 0, true));
  for (const [modalIndex, modal] of (screen.modals || []).entries()) {
    if (modal?.root) slot.append(renderLayerNode(modal.root, ["screens", index, "modals", modalIndex, "root"], 0, true));
  }
  slot.scrollTop = scrollTop;
  updateHistoryButtons();
}
function moveLayer(sourcePath, targetPath, placement = "before") {
  return commitPrototypeMutation(() => {
    if (!sourcePath || !targetPath || isPathPrefix(sourcePath, targetPath)) throw new Error("A layer cannot be moved into itself.");
    const doc = state.proto.doc;
    const node = valueAtPath(doc, sourcePath);
    const target = valueAtPath(doc, targetPath);
    const sourceChildren = valueAtPath(doc, sourcePath.slice(0, -1));
    const parent = placement === "inside" ? target : valueAtPath(doc, targetPath.slice(0, -2));
    const oldParent = valueAtPath(doc, sourcePath.slice(0, -2));
    if (!node || !target || sourcePath.at(-2) !== "children" || !Array.isArray(sourceChildren)) throw new Error("Root layers cannot be moved.");
    if (!["before", "after", "inside"].includes(placement) || ProtoRender.nodeKind(parent) !== "layout") throw new Error("Drop layers inside a layout or beside one of its children.");
    if (placement !== "inside" && targetPath.at(-2) !== "children") throw new Error("Cannot move a layer beside a root.");
    const destination = parent.children ||= [];
    if (!Array.isArray(destination)) throw new Error("The destination's children must be an array.");
    sourceChildren.splice(sourceChildren.indexOf(node), 1);
    const index = placement === "inside" ? destination.length : destination.indexOf(target) + (placement === "after" ? 1 : 0);
    destination.splice(index, 0, node);
    if (oldParent !== parent) {
      if (parent.layout === "freeform") node.position = { mode: "absolute", x: 0, y: 0 };
      else delete node.position;
    }
    state.selectedPath = findPathByReference(doc, node);
  });
}
function duplicateLayer() {
  commitPrototypeMutation(() => {
    const path = state.selectedPath;
    if (path?.at(-2) !== "children") throw new Error("Select a non-root layer to duplicate.");
    const node = clone(valueAtPath(state.proto.doc, path));
    const assignIds = (child) => {
      child.id = `layer-${crypto.randomUUID()}`;
      for (const item of child.children || []) assignIds(item);
    };
    assignIds(node);
    const children = valueAtPath(state.proto.doc, path.slice(0, -1));
    children.splice(path.at(-1) + 1, 0, node);
    state.selectedPath = findPathByReference(state.proto.doc, node);
  });
}
function deleteLayer() {
  commitPrototypeMutation(() => {
    const path = state.selectedPath;
    if (path?.at(-2) !== "children") throw new Error("Root layers cannot be deleted.");
    valueAtPath(state.proto.doc, path.slice(0, -1)).splice(path.at(-1), 1);
    state.selectedPath = path.slice(0, -2);
  });
}
function setInspectorTab(tab) {
  if (state.propertyEdit && !commitPropertyEdit()) return;
  state.inspectorTab = tab === "json" ? "json" : "properties";
  for (const name of ["properties", "json"]) {
    const active = name === state.inspectorTab;
    $(`#${name}-tab`).classList.toggle("is-active", active);
    $(`#${name}-tab`).setAttribute("aria-selected", String(active));
    $(`#${name}-tab`).tabIndex = active ? 0 : -1;
  }
  $("#proto-properties").hidden = state.inspectorTab !== "properties";
  $("#proto-json-panel").hidden = state.inspectorTab !== "json";
}
function renderElementEditor({ preserveProperties = false } = {}) {
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
  if (preserveProperties && selected) {
    const row = [...document.querySelectorAll(".layer-row")].find((item) => item.dataset.layerPath === pathKey(state.selectedPath));
    const button = row?.querySelector("button");
    if (button) {
      button.title = label.detail;
      button.lastChild.textContent = label.detail;
    }
  }
  if (!preserveProperties) ProtoProperties.render($("#proto-properties"), {
    node: selected ? node : null,
    parent: selected ? valueAtPath(state.proto.doc, state.selectedPath.slice(0, -2)) : null,
    tokens: state.design?.tokens || {}, theme: state.theme,
    componentNames: state.runtime?.componentNames || [],
    onPreview: previewPropertyEdit, onCommit: commitPropertyEdit, onCancel: cancelPropertyEdit,
  });
  setInspectorTab(state.inspectorTab);
  updateHistoryButtons();
}
function rebuildRuntime(currentId = state.runtime?.currentId) {
  state.runtime.updateDocument(state.proto.doc);
  if (currentId && state.runtime.currentId !== currentId) state.runtime.setScreen(currentId);
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
    commitPrototypeMutation(() => replaceAtPath(state.proto.doc, state.selectedPath, next));
  } catch (error) {
    $("#editor-error").textContent = error.message || String(error);
  }
}
function freeformTarget(start) {
  let element = start.closest?.("[data-proto-path]");
  while (element && currentSurface?.contains(element)) {
    const path = JSON.parse(element.dataset.protoPath);
    const node = valueAtPath(state.proto.doc, path);
    const parent = valueAtPath(state.proto.doc, path.slice(0, -2));
    if (node?.position?.mode === "absolute" && parent?.layout === "freeform") {
      return { element, path, node, parentElement: element.offsetParent || element.parentElement };
    }
    element = element.parentElement?.closest("[data-proto-path]");
  }
  return null;
}
function beginFreeformDrag(event) {
  if (!state.inspectMode || event.button !== 0 || state.freeformDrag) return;
  if (state.propertyEdit && !commitPropertyEdit()) return;
  const target = freeformTarget(event.target);
  if (!target) return;
  const rect = target.parentElement.getBoundingClientRect();
  state.freeformDrag = {
    ...target, before: editorSnapshot(), pointerId: event.pointerId,
    startX: event.clientX, startY: event.clientY,
    originX: target.node.position.x, originY: target.node.position.y,
    scaleX: rect.width / target.parentElement.offsetWidth || 1,
    scaleY: rect.height / target.parentElement.offsetHeight || 1,
    parentLeft: rect.left, parentTop: rect.top,
    scrollLeft: target.parentElement.scrollLeft, scrollTop: target.parentElement.scrollTop,
    active: false,
  };
  event.preventDefault();
}
function updateFreeformPosition(drag, x, y) {
  drag.node.position.x = x;
  drag.node.position.y = y;
  drag.element.style.left = `${x}px`;
  drag.element.style.top = `${y}px`;
  for (const axis of ["x", "y"]) {
    const input = $(`[data-position-axis="${axis}"]`);
    if (input) input.value = String(axis === "x" ? x : y);
  }
  $("#json-editor").value = JSON.stringify(drag.node, null, 2);
}
function moveFreeformDrag(event) {
  const drag = state.freeformDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.active) {
    if (Math.hypot(dx, dy) < 4) return;
    drag.active = true;
    selectPath(drag.path, { notify: false });
    drag.element.classList.add("is-freeform-dragging");
    document.body.classList.add("freeform-drag-active");
    try { drag.element.setPointerCapture(event.pointerId); }
    catch (error) { if (error.name !== "NotFoundError") throw error; }
  }
  const rect = drag.parentElement.getBoundingClientRect();
  const x = drag.originX + (dx - rect.left + drag.parentLeft) / drag.scaleX + drag.parentElement.scrollLeft - drag.scrollLeft;
  const y = drag.originY + (dy - rect.top + drag.parentTop) / drag.scaleY + drag.parentElement.scrollTop - drag.scrollTop;
  updateFreeformPosition(drag, Math.round(x), Math.round(y));
  setDirty(true);
  updateHistoryButtons();
  event.preventDefault();
  event.stopImmediatePropagation();
}
function finishFreeformDrag(event, cancelled = false) {
  const drag = state.freeformDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  state.freeformDrag = null;
  if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
  drag.element.classList.remove("is-freeform-dragging");
  document.body.classList.remove("freeform-drag-active");
  if (!drag.active) return;
  state.suppressInspectClickUntil = Date.now() + 500;
  let error = null;
  try {
    if (cancelled) restoreSnapshot(drag.before);
    else { validateDraft(); recordMutation(drag.before); }
  } catch (failure) {
    restoreSnapshot(drag.before);
    error = failure;
  }
  refreshDirty();
  rebuildRuntime();
  if (error) editorError(error);
  event.preventDefault();
  event.stopImmediatePropagation();
}
function cancelFreeformDrag() {
  const drag = state.freeformDrag;
  if (!drag) return;
  finishFreeformDrag({ pointerId: drag.pointerId, preventDefault() {}, stopImmediatePropagation() {} }, true);
}
async function savePrototype() {
  if (state.freeformDrag || !commitPropertyEdit()) return;
  if (!state.dirty || state.saving) return;
  state.saving = true;
  setDirty(state.dirty);
  const savedDocument = JSON.stringify(state.proto.doc);
  try {
    state.suppressChangedUntil = Date.now() + 750;
    const result = await api("/api/prototypes/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"doc":${savedDocument}}`,
    });
    state.proto.source = "repo";
    state.saving = false;
    state.savedDocument = savedDocument;
    const changedDuringSave = JSON.stringify(state.proto.doc) !== savedDocument;
    refreshDirty();
    if (!changedDuringSave) state.validation = result.validation;
    $("#screen-nav-error").textContent = "";
    renderSourcePill();
    postSelection();
  } catch (error) {
    state.suppressChangedUntil = 0;
    state.saving = false;
    refreshDirty();
    if (error.validation) state.validation = error.validation;
    setSaveStatus("Save failed");
    $("#screen-nav-error").textContent = error.message || "Save failed";
  }
}
async function attachSelection() {
  if (!commitPropertyEdit()) return;
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
  cancelFreeformDrag();
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
        cancelFreeformDrag();
        if (!commitPropertyEdit()) return;
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
  if (!commitPropertyEdit()) return;
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
    if (!commitPrototypeMutation(() => {
      if (!Array.isArray(state.proto.doc.sections)) state.proto.doc.sections = [];
      state.proto.doc.sections.push({ id, name });
      const screen = state.proto.doc.screens.find((screen) => screen.id === $("#screen-dialog").dataset.assignScreenId);
      if (screen) screen.sectionId = id;
      state.selectedPath = null;
    })) return;
  } else {
    let sectionId = $("#new-screen-section").value;
    let newSection = null;
    if ($("#new-screen-section").selectedOptions[0]?.dataset.action === "add-section") {
      const sectionName = $("#new-section-name").value.trim();
      if (!sectionName) {
        $("#new-section-name").setCustomValidity("Enter a section name.");
        $("#new-section-name").reportValidity();
        return;
      }
      sectionId = `section-${crypto.randomUUID()}`;
      newSection = { id: sectionId, name: sectionName };
    }
    if (!commitPrototypeMutation(() => {
      if (newSection) {
        if (!Array.isArray(state.proto.doc.sections)) state.proto.doc.sections = [];
        state.proto.doc.sections.push(newSection);
      }
      state.proto.doc.screens.push({
        id, name, device: state.deviceId,
        ...(sectionId ? { sectionId } : {}),
        root: { id: `${id}-root`, layout: "stack", children: [
          { id: `${id}-title`, text: name, style: "title" },
        ] },
      });
      state.selectedPath = null;
    })) return;
    state.runtime.setScreen(id);
  }
  $("#screen-nav-error").textContent = "";
  $("#screen-dialog").close();
  if (kind === "screen") $("#screen-list [aria-current]")?.focus();
}
function deleteCurrentScreen() {
  cancelFreeformDrag();
  if (!commitPropertyEdit()) return;
  const screen = state.runtime?.screen();
  if (!screen) return;
  if (!window.confirm(`Delete "${screen.name || screen.id}"? Links to this screen and flows that start here will also be removed. Save to keep this deletion.`)) return;
  commitPrototypeMutation(() => {
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
    state.selectedPath = null;
  });
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
  cancelFreeformDrag();
  const previousScreen = state.runtime?.currentId;
  const data = window.__COLOPHON_PROTOTYPE_EXPORT__ || await api("/api/prototypes");
  await whenDSComp();
  state.design = data.design;
  state.proto = data.proto;
  state.past = [];
  state.future = [];
  state.propertyEdit = null;
  state.savedDocument = JSON.stringify(state.proto.doc);
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
    if (!commitPropertyEdit()) return;
    const screen = state.runtime?.screen();
    if (!screen) return;
    if (event.target.selectedOptions[0]?.dataset.action === "add-section") {
      event.target.value = screen.sectionId || "";
      openScreenDialog("section", screen.id);
      return;
    }
    const sectionId = event.target.value;
    commitPrototypeMutation(() => {
      if (sectionId) screen.sectionId = sectionId;
      else delete screen.sectionId;
      state.selectedPath = null;
    });
  });
  $("#nav-save-btn")?.addEventListener("click", () => savePrototype());
  $("#device-select").addEventListener("change", (e) => setDevice(e.target.value));
  $("#w").addEventListener("change", (e) => { state.w = Math.max(120, parseInt(e.target.value, 10) || state.w); renderFrame(); });
  $("#h").addEventListener("change", (e) => { state.h = Math.max(120, parseInt(e.target.value, 10) || state.h); renderFrame(); });
  $("#rotate-btn").addEventListener("click", () => { const w = state.w; state.w = state.h; state.h = w; syncSizeInputs(); renderFrame(); });
  $("#zoom-select").addEventListener("change", (e) => { state.zoom = e.target.value === "fit" ? "fit" : parseFloat(e.target.value); applyZoom(); });
  $("#inspect-btn")?.addEventListener("click", () => {
    cancelFreeformDrag();
    if (!commitPropertyEdit()) return;
    state.inspectMode = !state.inspectMode;
    window.DSInteractions?.resetTree($("#frame-wrap"));
    $("#inspect-btn").classList.toggle("is-active", state.inspectMode);
    $("#inspect-btn").setAttribute("aria-pressed", String(state.inspectMode));
    $("#inspector").hidden = !state.inspectMode;
    $("#layers-panel").hidden = !state.inspectMode;
    $("#frame-wrap").classList.toggle("inspect-mode", state.inspectMode);
    if (state.inspectMode) { renderLayers(); renderElementEditor(); }
    applyZoom();
  });
  $("#frame-wrap").addEventListener("click", (event) => {
    if (!state.inspectMode) return;
    if (Date.now() < state.suppressInspectClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const target = event.target.closest("[data-proto-path]");
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { selectPath(JSON.parse(target.dataset.protoPath)); } catch { /* invalid renderer metadata */ }
  }, true);
  $("#frame-wrap").addEventListener("pointerdown", beginFreeformDrag, true);
  $("#frame-wrap").addEventListener("dragstart", (event) => {
    if (state.inspectMode) event.preventDefault();
  }, true);
  window.addEventListener("pointermove", moveFreeformDrag, true);
  window.addEventListener("pointerup", (event) => finishFreeformDrag(event), true);
  window.addEventListener("pointercancel", (event) => finishFreeformDrag(event, true), true);
  window.addEventListener("lostpointercapture", (event) => finishFreeformDrag(event, true), true);
  window.addEventListener("blur", cancelFreeformDrag);
  $("#layers-undo-btn")?.addEventListener("click", () => restoreHistory("undo"));
  $("#layers-redo-btn")?.addEventListener("click", () => restoreHistory("redo"));
  $("#layers-duplicate-btn")?.addEventListener("click", duplicateLayer);
  $("#layers-delete-btn")?.addEventListener("click", deleteLayer);
  for (const name of ["properties", "json"]) {
    $(`#${name}-tab`)?.addEventListener("click", () => setInspectorTab(name));
    $(`#${name}-tab`)?.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "properties" : event.key === "End" ? "json" : name === "json" ? "properties" : "json";
      setInspectorTab(next);
      $(`#${next}-tab`).focus();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (!state.inspectMode) return;
    if (event.key === "Escape") {
      if (state.freeformDrag || state.propertyEdit) {
        event.preventDefault();
        cancelFreeformDrag();
        cancelPropertyEdit();
      }
      return;
    }
    if (event.target.closest("input, textarea, select, [contenteditable=true]")) return;
    if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      restoreHistory(event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo");
    }
  });
  $("#apply-json-btn")?.addEventListener("click", applyJsonEdit);
  $("#save-btn")?.addEventListener("click", () => savePrototype());
  $("#attach-btn")?.addEventListener("click", () => attachSelection());
  $("#back-btn").addEventListener("click", () => {
    cancelFreeformDrag();
    if (commitPropertyEdit()) state.runtime?.dispatch({ back: true });
  });
  $("#reload-btn").addEventListener("click", () => {
    if (window.__COLOPHON_PROTOTYPE_EXPORT__) window.location.reload();
    else if (!state.dirty || window.confirm("Reload from disk and discard local prototype edits?")) {
      load().catch((error) => { $("#screen-nav-error").textContent = `Reload failed: ${error.message}`; });
    }
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
    if (state.freeformDrag || !commitPropertyEdit() || state.dirty || state.saving) return;
    try {
      const result = await api("/api/prototypes/export", { method: "POST" });
      state.exportPath = result.path;
      renderSourcePill();
    } catch (e) { $("#source-pill").textContent = "Export failed"; $("#source-pill").title = e.message || String(e); }
  });
  $("#publish-btn")?.addEventListener("click", async () => {
    if (state.freeformDrag || !commitPropertyEdit() || state.dirty || state.saving) return;
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
      if (!window.__COLOPHON_PROTOTYPE_EXPORT__) {
        cancelFreeformDrag();
        if (commitPropertyEdit()) renderElementEditor();
      }
    });
  }

  window.addEventListener("resize", () => { if (state.zoom === "fit") applyZoom(); });

  if (!window.__COLOPHON_PROTOTYPE_EXPORT__) {
    try {
      const es = new EventSource("/events");
      es.addEventListener("changed", () => {
        if (state.saving || Date.now() < state.suppressChangedUntil) return;
        if (state.dirty || state.propertyEdit || state.freeformDrag) { setSaveStatus("File changed on disk — reload to replace local edits"); return; }
        load().catch((error) => { $("#screen-nav-error").textContent = `Reload failed: ${error.message}`; });
      });
      es.addEventListener("error", () => setSaveStatus("Live file updates disconnected; reconnecting"));
    } catch (error) { $("#screen-nav-error").textContent = `Live file updates unavailable: ${error.message}`; }
  }
}

wire();
load().catch((e) => { $("#source-pill").textContent = "error"; console.error(e); });
