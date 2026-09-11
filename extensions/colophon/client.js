/* client.js — the Design System inspector that runs inside the canvas iframe.
   Loads /api/design, renders the system, supports inline token editing + save,
   and live-renders the pseudocode-React component patterns. */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) n.append(kid?.nodeType ? kid : document.createTextNode(String(kid ?? "")));
  return n;
};

let state = {
  design: null, tokens: null, componentsDoc: null,
  dirty: false, componentsDirty: false, mode: "normal", proposal: null,
  theme: "light", validation: null, page: "brand",
  inspectMode: false, selection: null,
  inspectorTab: "properties", componentPast: [], componentFuture: [], dragPath: null,
  freeformDrag: null, suppressInspectClickUntil: 0,
  spacingSnap: true,
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  const payload = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(payload?.error || `${path} -> ${res.status}`);
  return payload;
}

const THEMES = ["light", "dark", "highContrast"];
const THEME_LABEL = { light: "Light", dark: "Dark", highContrast: "High contrast" };

function colorList(tokens) {
  const c = tokens?.colors;
  if (Array.isArray(c)) return c;
  if (c && typeof c === "object") return Object.entries(c).map(([name, value]) => ({ name, value, usage: "" }));
  return [];
}

// The base (light) preview value of a color, tolerating a flat `value` or a
// { themes: { light } } shape. Mirrors designio.baseColorValue.
function baseColorValue(c) {
  if (!c) return "";
  if (typeof c.value === "string" && c.value) return c.value;
  const th = c.themes;
  if (th && typeof th === "object") return th.light || th.dark || th.highContrast || "";
  return "";
}

// Preview value for a theme, falling back theme → light → base.
function colorValueForTheme(c, theme = "light") {
  const th = c?.themes;
  if (th && typeof th === "object" && typeof th[theme] === "string" && th[theme]) return th[theme];
  if (theme !== "light" && th && typeof th.light === "string" && th.light) return th.light;
  return baseColorValue(c);
}

// Write a preview value for the active theme. Light writes the flat `value` (unless
// the color already uses a themes map); dark/highContrast write into themes.
function setColorValueForTheme(c, theme, hex) {
  if (theme === "light" && !(c.themes && typeof c.themes === "object")) { c.value = hex; return; }
  c.themes = (c.themes && typeof c.themes === "object") ? c.themes : {};
  if (theme === "light" && typeof c.value === "string" && !c.themes.light) c.themes.light = c.value;
  c.themes[theme] = hex;
  // Keep the canonical `value` aligned with themes.light so readers that prefer
  // `value` (baseColorValue, summaries, validation) don't report a stale hex.
  if (theme === "light" && typeof c.value === "string") c.value = hex;
}

// A port target only "counts" once it names a source/owner. An all-empty object is
// normalized away server-side (designio.normPortTarget / readAuthority), so mirror that
// rule here — otherwise toggling a port on but leaving every field blank would flip the
// canvas into preview-only mode yet silently drop the port on save.
function portTargetFilled(p) {
  if (!p || typeof p !== "object") return false;
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  return !!(s(p.authoritySource) || s(p.syncSource) || s(p.helperAgent) || s(p.owner));
}
function portOverrideFilled(o) {
  if (!o || typeof o !== "object") return false;
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const comps = Array.isArray(o.components) && o.components.some(s);
  return !!(s(o.area) || comps || portTargetFilled(o));
}

// Does this system have a real port target? Then colors are preview-only.
function hasPort(t) {
  const a = t?.authority;
  if (!a || typeof a !== "object") return false;
  if (portTargetFilled(a.port)) return true;
  return Array.isArray(a.portOverrides) && a.portOverrides.some(portOverrideFilled);
}

function cssVarsFromTokens(tokens, theme = "light") {
  const lines = [];
  for (const c of colorList(tokens)) lines.push(`--color-${c.name}: ${colorValueForTheme(c, theme)};`);
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
  let tag = $("#ds-vars");
  if (!tag) { tag = el("style", { id: "ds-vars" }); document.head.append(tag); }
  tag.textContent = cssVarsFromTokens(state.tokens, state.theme);
  document.body.setAttribute("data-ds-theme", state.theme);
}

function updateSaveButton() {
  const save = $("#save-btn");
  if (save) {
    save.disabled = !(state.dirty || state.componentsDirty);
    save.textContent = state.dirty || state.componentsDirty ? "Save changes" : (state.design?.source === "repo" ? "Saved" : "Save to repo");
  }
}

function markDirty() {
  state.dirty = true;
  updateSaveButton();
}

function markComponentsDirty() {
  state.componentsDirty = true;
  updateSaveButton();
}

function pointerFor(path) {
  return "/" + path.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

function valueAtPath(root, path) {
  let value = root;
  for (const part of path) {
    if (value == null || !(part in value)) return undefined;
    value = value[part];
  }
  return value;
}

function replaceAtPath(root, path, value) {
  if (!path.length) throw new Error("The root document cannot be replaced here.");
  const parent = valueAtPath(root, path.slice(0, -1));
  if (parent == null) throw new Error("The selected element no longer exists.");
  parent[path[path.length - 1]] = value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pathKey(path) {
  return JSON.stringify(path || []);
}

function isPathPrefix(parent, child) {
  return parent.length <= child.length && parent.every((part, index) => part === child[index]);
}

function selectedComponentNode() {
  if (state.selection?.file !== "components.jsonc") return null;
  const node = valueAtPath(state.componentsDoc, state.selection.path);
  return node && typeof node === "object" && ("el" in node || "component" in node) ? node : null;
}

function selectedComponentDescriptor() {
  const node = selectedComponentNode();
  return node ? { componentIndex: state.selection.path[1], id: node.id || null, path: state.selection.path.slice() } : null;
}

function restoreComponentSelection(descriptor) {
  if (!descriptor) {
    state.selection = null;
    return;
  }
  let path = descriptor.id
    ? window.DSComp?.findComponentNodePath?.(state.componentsDoc, descriptor.componentIndex, descriptor.id)
    : descriptor.path;
  if (!path) path = ["components", descriptor.componentIndex, "root"];
  const node = path && valueAtPath(state.componentsDoc, path);
  if (!node) {
    state.selection = null;
    return;
  }
  state.selection = {
    file: "components.jsonc",
    path,
    label: componentLayerLabel(node).detail,
    value: node,
  };
}

function updateHistoryButtons() {
  const undo = $("#layers-undo-btn");
  const redo = $("#layers-redo-btn");
  if (undo) undo.disabled = state.componentPast.length === 0;
  if (redo) redo.disabled = state.componentFuture.length === 0;
}

async function commitComponentMutation(mutator, { selectPath = null } = {}) {
  const before = clone(state.componentsDoc);
  const beforeSelection = selectedComponentDescriptor();
  try {
    const resultPath = mutator();
    const validation = window.DSComp?.validateComponentsDoc?.(state.componentsDoc, { tokens: state.tokens });
    if (validation && !validation.ok) throw new Error(validation.errors.join(" "));
    state.componentPast.push(before);
    if (state.componentPast.length > 50) state.componentPast.shift();
    state.componentFuture = [];
    state.design.componentsDoc = state.componentsDoc;
    const nextPath = selectPath || resultPath;
    if (nextPath) {
      const node = valueAtPath(state.componentsDoc, nextPath);
      state.selection = node === undefined ? null : {
        file: "components.jsonc",
        path: nextPath.slice(),
        label: componentLayerLabel(node).detail,
        value: node,
      };
    } else if (beforeSelection && valueAtPath(state.componentsDoc, beforeSelection.path)) {
      const node = valueAtPath(state.componentsDoc, beforeSelection.path);
      state.selection = {
        file: "components.jsonc",
        path: beforeSelection.path.slice(),
        label: componentLayerLabel(node).detail,
        value: node,
      };
    } else {
      restoreComponentSelection(beforeSelection);
    }
    markComponentsDirty();
    $("#inspect-error").textContent = "";
    await render();
    postDesignSelection();
    return true;
  } catch (error) {
    state.componentsDoc = before;
    state.design.componentsDoc = state.componentsDoc;
    restoreComponentSelection(beforeSelection);
    $("#inspect-error").textContent = error.message || String(error);
    renderInspector();
    renderComponentLayers();
    return false;
  }
}

async function restoreComponentHistory(direction) {
  const from = direction === "undo" ? state.componentPast : state.componentFuture;
  const to = direction === "undo" ? state.componentFuture : state.componentPast;
  if (!from.length) return;
  const descriptor = selectedComponentDescriptor();
  to.push(clone(state.componentsDoc));
  state.componentsDoc = from.pop();
  state.design.componentsDoc = state.componentsDoc;
  restoreComponentSelection(descriptor);
  markComponentsDirty();
  await render();
  postDesignSelection();
}

function inspectable(node, file, path, label) {
  if (!node?.dataset) return node;
  node.dataset.designInspect = "true";
  node.dataset.designFile = file;
  node.dataset.designPath = JSON.stringify(path);
  node.dataset.designLabel = label;
  return node;
}

function selectionRoot(file) {
  return file === "components.jsonc" ? state.componentsDoc : state.tokens;
}

function selectDesignElement(target) {
  const file = target.dataset.designFile;
  const path = JSON.parse(target.dataset.designPath || "[]");
  selectDesignPath(file, path, target.dataset.designLabel || path.at(-1));
}

function selectDesignPath(file, path, label) {
  const value = valueAtPath(selectionRoot(file), path);
  if (value === undefined) return;
  state.selection = { file, path, label, value };
  renderInspector();
  applyInspectHighlight();
  postDesignSelection();
}

function componentLayerLabel(node) {
  if (typeof node === "string") return { icon: "T", detail: node.length > 24 ? `${node.slice(0, 24)}…` : node };
  if (!node || typeof node !== "object") return { icon: "?", detail: "Unknown layer" };
  if (node.component) return { icon: "◇", detail: node.id || node.component };
  return { icon: "<>", detail: node.id || node.el || "Element" };
}

function setInspectorTab(tab) {
  state.inspectorTab = tab === "json" ? "json" : "properties";
  const properties = state.inspectorTab === "properties";
  $("#properties-tab")?.classList.toggle("is-active", properties);
  $("#properties-tab")?.setAttribute("aria-selected", String(properties));
  $("#json-tab")?.classList.toggle("is-active", !properties);
  $("#json-tab")?.setAttribute("aria-selected", String(!properties));
  $("#inspect-properties").hidden = !properties;
  $("#inspect-json-panel").hidden = properties;
}

function propertyField(label, control, { wide = false } = {}) {
  return el("div", { class: `property-field${wide ? " is-wide" : ""}` }, el("label", {}, label), control);
}

function propertySelect(label, value, options, onchange, { wide = false } = {}) {
  const select = el("select", { onchange });
  for (const [optionValue, optionLabel] of options) {
    select.append(el("option", { value: optionValue, selected: optionValue === (value ?? "") ? "selected" : undefined }, optionLabel));
  }
  return propertyField(label, select, { wide });
}

function closePicker(button) {
  button.closest("details")?.removeAttribute("open");
}

let floatingPickerEventsReady = false;

function closeFloatingPickers(except = null) {
  for (const picker of document.querySelectorAll(".property-picker[open]")) {
    if (picker !== except) picker.removeAttribute("open");
  }
}

function closeSpacingMenus(except = null) {
  for (const menu of document.querySelectorAll(".spacing-option-menu.is-open")) {
    if (menu !== except) menu.classList.remove("is-open");
  }
}

function positionFloatingMenu(anchorElement, menu) {
  const inspector = anchorElement.closest(".design-inspector");
  if (!inspector) return;
  const anchor = anchorElement.getBoundingClientRect();
  const bounds = inspector.getBoundingClientRect();
  const gutter = 8;
  const width = Math.min(300, bounds.width - gutter * 2);
  const left = Math.max(bounds.left + gutter, Math.min(anchor.right - width, bounds.right - width - gutter));
  const below = bounds.bottom - anchor.bottom - gutter;
  const above = anchor.top - bounds.top - gutter;
  const naturalHeight = Math.min(menu.scrollHeight, 360);
  const opensUp = below < Math.min(naturalHeight, 180) && above > below;
  const available = Math.max(96, opensUp ? above : below);
  const height = Math.min(naturalHeight, available);
  const top = opensUp ? anchor.top - height - 4 : anchor.bottom + 4;
  Object.assign(menu.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    maxHeight: `${available}px`,
  });
  menu.classList.toggle("opens-up", opensUp);
}

function makeFloatingPicker(details, menu) {
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    closeFloatingPickers(details);
    requestAnimationFrame(() => positionFloatingMenu(details.querySelector(":scope > summary"), menu));
  });
  if (floatingPickerEventsReady) return;
  floatingPickerEventsReady = true;
  document.addEventListener("pointerdown", (event) => {
    const active = event.target.closest?.(".property-picker");
    const spacingMenu = event.target.closest?.(".spacing-combo")?.querySelector(".spacing-option-menu");
    closeFloatingPickers(active);
    closeSpacingMenus(spacingMenu);
  });
  document.addEventListener("scroll", () => {
    closeFloatingPickers();
    closeSpacingMenus();
  }, true);
  window.addEventListener("resize", () => {
    closeFloatingPickers();
    closeSpacingMenus();
  });
}

function choicePicker(label, value, choices, onchange, { wide = false, summaryStyle = "" } = {}) {
  const selected = choices.find((choice) => choice.value === value) || choices[0];
  const details = el("details", { class: "property-picker" });
  const summary = el("summary", {},
    el("span", { class: "property-picker-value", style: summaryStyle || selected?.style || "" }, selected?.label || "Select"),
    el("span", { class: "property-picker-chevron", "aria-hidden": "true" }, "⌄"),
  );
  const menu = el("div", { class: "property-picker-menu" });
  for (const choice of choices) {
    menu.append(el("button", {
      type: "button",
      class: `property-picker-option${choice.value === value ? " is-selected" : ""}`,
      style: choice.style || "",
      onclick: (event) => {
        closePicker(event.currentTarget);
        onchange(choice.value);
      },
    }, choice.preview || choice.label));
  }
  details.append(summary, menu);
  makeFloatingPicker(details, menu);
  return propertyField(label, details, { wide });
}

function textStylePreview(style) {
  if (!style?.name) return "";
  return [
    `font-family:var(--text-${style.name}-family,var(--font-${style.role || "body"}))`,
    `font-size:var(--text-${style.name}-size)`,
    `line-height:var(--text-${style.name}-line-height)`,
    `font-weight:var(--text-${style.name}-weight)`,
    `letter-spacing:var(--text-${style.name}-tracking,normal)`,
  ].join(";");
}

function typographyPicker(label, value, kind, onchange) {
  const inherited = { value: "", label: "Inherit / class", style: "" };
  const choices = kind === "textStyle"
    ? [inherited, ...(state.tokens?.typography?.scale || []).filter((style) => style?.name).map((style) => ({
      value: style.name,
      label: style.name,
      style: textStylePreview(style),
      preview: el("span", { class: "type-option" },
        el("span", { class: "type-option-sample", style: textStylePreview(style) }, "Ag"),
        el("span", { class: "type-option-meta" },
          el("strong", {}, style.name),
          el("span", {}, `${style.size || "Inherited"} / ${style.lineHeight || "normal"}`)),
      ),
    }))]
    : [inherited, ...["display", "body", "mono"].filter((role) => state.tokens?.typography?.[role]?.family).map((role) => ({
      value: role,
      label: role[0].toUpperCase() + role.slice(1),
      style: `font-family:var(--font-${role})`,
      preview: el("span", { class: "type-option" },
        el("span", { class: "type-option-sample", style: `font-family:var(--font-${role})` }, "Ag"),
        el("span", { class: "type-option-meta" },
          el("strong", {}, role[0].toUpperCase() + role.slice(1)),
          el("span", {}, state.tokens.typography[role].family)),
      ),
    }))];
  return choicePicker(label, value, choices, onchange);
}

function appearanceColorValue(value) {
  if (/^#[0-9a-f]{6}$/i.test(value || "")) return value;
  const token = colorList(state.tokens).find((color) => color.name === value);
  return colorValueForTheme(token, state.theme) || "transparent";
}

function colorPicker(label, value, onchange) {
  const colors = colorList(state.tokens).filter((color) => color?.name);
  const selectedToken = colors.find((color) => color.name === value);
  const selectedColor = appearanceColorValue(value);
  const details = el("details", { class: "property-picker color-property-picker" });
  const summary = el("summary", {},
    el("span", { class: "color-picker-summary" },
      el("span", { class: "color-picker-chip", style: `background:${selectedColor}` }),
      el("span", {}, value ? (selectedToken?.name || value) : "Inherit / class"),
    ),
    el("span", { class: "property-picker-chevron", "aria-hidden": "true" }, "⌄"),
  );
  const palette = el("div", { class: "color-palette" });
  palette.append(el("button", {
    type: "button",
    class: `color-palette-inherit${value ? "" : " is-selected"}`,
    onclick: (event) => {
      closePicker(event.currentTarget);
      onchange("");
    },
  }, "Inherit / class"));
  for (const color of colors) {
    const preview = colorValueForTheme(color, state.theme);
    palette.append(el("button", {
      type: "button",
      class: `color-palette-token${value === color.name ? " is-selected" : ""}`,
      title: `${color.name}: ${preview}`,
      "aria-label": `${color.name}, ${preview}`,
      onclick: (event) => {
        closePicker(event.currentTarget);
        onchange(color.name);
      },
    },
    el("span", { class: "color-palette-swatch", style: `background:${preview}` }),
    el("span", { class: "color-palette-name" }, color.name)));
  }
  const customValue = /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#000000";
  const customInput = el("input", {
    type: "color",
    value: customValue,
    title: "Choose a custom color",
    "aria-label": `Choose a custom ${label.toLowerCase()}`,
    onchange: (event) => onchange(event.target.value),
  });
  palette.append(el("label", { class: `color-palette-custom${value === customValue ? " is-selected" : ""}` },
    el("span", { class: "spectrum-chip" }),
    el("span", {}, "Custom"),
    customInput));
  details.append(summary, palette);
  makeFloatingPicker(details, palette);
  return propertyField(label, details);
}

function cssPixels(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|rem)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (match[2]?.toLowerCase() === "rem") {
    return number * (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  }
  return number;
}

function spacingTokens() {
  const tokens = (state.tokens?.spacing?.scale || []).map((token) => ({
    name: String(token.name),
    value: String(token.value ?? ""),
    pixels: cssPixels(token.value),
  }));
  if (!tokens.some((token) => token.name === "0")) {
    tokens.unshift({ name: "0", value: "0px", pixels: 0 });
  }
  return tokens;
}

function spacingPixels(value) {
  if (typeof value === "number") return value;
  if (value === "0") return 0;
  return spacingTokens().find((token) => token.name === value)?.pixels ?? null;
}

function nearestSpacingToken(value) {
  const pixels = spacingPixels(value);
  const candidates = spacingTokens().filter((token) => token.pixels != null);
  if (pixels == null || !candidates.length) return null;
  return candidates.reduce((nearest, token) => (
    Math.abs(token.pixels - pixels) < Math.abs(nearest.pixels - pixels) ? token : nearest
  ));
}

function spacingTokenLabel(token) {
  const resolved = token.value || (token.pixels == null ? token.name : `${token.pixels}px`);
  return token.name === "0" ? resolved : `${resolved} · var(--space-${token.name})`;
}

function spacingInputValue(value) {
  if (value == null || value === "") return "";
  if (value === "auto") return "auto";
  if (state.spacingSnap && typeof value === "string") {
    const token = spacingTokens().find((item) => item.name === value);
    return token ? spacingTokenLabel(token) : value;
  }
  const pixels = spacingPixels(value);
  return pixels == null ? String(value) : `${pixels}px`;
}

function parseSpacingInput(value, { allowAuto = false } = {}) {
  const raw = value.trim();
  if (!raw) return "";
  if (allowAuto && raw === "auto") return "auto";
  if (state.spacingSnap) {
    const variable = raw.match(/var\(--space-([^)]+)\)/);
    const tokenName = variable?.[1] || raw.split("·", 1)[0].trim();
    if (spacingTokens().some((token) => token.name === tokenName)) return tokenName;
    const nearest = nearestSpacingToken(cssPixels(tokenName));
    if (nearest) return nearest.name;
    throw new Error(`"${raw}" is not a spacing token.`);
  }
  const pixels = cssPixels(raw);
  if (pixels == null || pixels < 0) throw new Error("Enter a non-negative pixel value.");
  return pixels;
}

function stepSpacingValue(value, direction) {
  if (!state.spacingSnap) return Math.max(0, (spacingPixels(value) ?? 0) + direction);
  const tokens = spacingTokens();
  if (!tokens.length) return value;
  let index = tokens.findIndex((token) => token.name === value);
  if (index < 0) {
    const nearest = nearestSpacingToken(value);
    index = nearest ? tokens.indexOf(nearest) : (direction > 0 ? -1 : 1);
  }
  return tokens[Math.max(0, Math.min(tokens.length - 1, index + direction))].name;
}

function spacingCombo(label, value, onchange, { allowAuto = false, wide = false } = {}) {
  const menu = el("div", { class: "spacing-option-menu" });
  const submitInput = (raw) => {
    try {
      $("#inspect-error").textContent = "";
      onchange(parseSpacingInput(raw, { allowAuto }));
    } catch (error) {
      $("#inspect-error").textContent = error.message || String(error);
    }
  };
  const closeMenu = () => menu.classList.remove("is-open");
  const openMenu = () => {
    closeSpacingMenus(menu);
    closeFloatingPickers();
    menu.classList.add("is-open");
    requestAnimationFrame(() => positionFloatingMenu(input, menu));
  };
  const input = el("input", {
    type: "text",
    value: spacingInputValue(value),
    placeholder: "Unset",
    onchange: (event) => submitInput(event.target.value),
    onclick: openMenu,
    onfocus: openMenu,
    onkeydown: (event) => {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      onchange(stepSpacingValue(value, event.key === "ArrowUp" ? 1 : -1));
    },
  });
  for (const token of spacingTokens()) {
    const next = state.spacingSnap ? token.name : (token.pixels ?? cssPixels(token.value));
    if (next == null) continue;
    menu.append(el("button", {
      type: "button",
      class: value === next ? "is-selected" : "",
      onclick: () => {
        closeMenu();
        onchange(next);
      },
    },
    el("span", { class: "spacing-option-value" }, token.value || `${token.pixels}px`),
    token.name === "0" ? "" : el("span", { class: "spacing-option-token" }, `var(--space-${token.name})`)));
  }
  if (allowAuto) {
    menu.append(el("button", {
      type: "button",
      class: value === "auto" ? "is-selected" : "",
      onclick: () => {
        closeMenu();
        onchange("auto");
      },
    }, el("span", { class: "spacing-option-value" }, "auto")));
  }
  const control = el("div", { class: "spacing-combo" },
    input,
    el("div", { class: "spacing-stepper" },
      el("button", {
        type: "button", title: "Increase spacing", "aria-label": `Increase ${label}`,
        onclick: () => onchange(stepSpacingValue(value, 1)),
      }, "▲"),
      el("button", {
        type: "button", title: "Decrease spacing", "aria-label": `Decrease ${label}`,
        onclick: () => onchange(stepSpacingValue(value, -1)),
      }, "▼"),
    ),
    menu,
  );
  return propertyField(label, control, { wide });
}

function convertSpacingValue(value, snapped) {
  if (value == null || value === "auto") return value;
  if (snapped) return nearestSpacingToken(value)?.name ?? value;
  return spacingPixels(value) ?? value;
}

function convertBoxSpacing(value, snapped) {
  if (value == null || typeof value !== "object") return convertSpacingValue(value, snapped);
  return Object.fromEntries(Object.entries(value).map(([edge, spacing]) => [edge, convertSpacingValue(spacing, snapped)]));
}

async function toggleSpacingSnap() {
  const next = !state.spacingSnap;
  state.spacingSnap = next;
  const committed = await commitComponentMutation(() => {
    const node = selectedComponentNode();
    if (node.layout?.gap != null) node.layout.gap = convertSpacingValue(node.layout.gap, next);
    if (node.layout?.padding != null) node.layout.padding = convertBoxSpacing(node.layout.padding, next);
    if (node.margin != null) node.margin = convertBoxSpacing(node.margin, next);
  });
  if (!committed) {
    state.spacingSnap = !next;
    renderComponentProperties();
  }
}

function boxEdgeValue(value, edge) {
  if (typeof value === "string" || typeof value === "number") return value;
  if (!value || typeof value !== "object") return "";
  const axis = edge === "left" || edge === "right" ? "x" : "y";
  return value[edge] ?? value[axis] ?? "";
}

function updateBoxValue(owner, key, edge, next) {
  const current = owner[key];
  if (edge === "all") {
    if (next !== "") owner[key] = next;
    else delete owner[key];
    return;
  }
  const expanded = {};
  for (const side of ["top", "right", "bottom", "left"]) {
    const value = boxEdgeValue(current, side);
    if (value !== "") expanded[side] = value;
  }
  if (next !== "") expanded[edge] = next;
  else delete expanded[edge];
  if (Object.keys(expanded).length) owner[key] = expanded;
  else delete owner[key];
}

function setAppearanceOverride(key, value) {
  const node = selectedComponentNode();
  node.appearance ||= {};
  if (value) node.appearance[key] = value;
  else delete node.appearance[key];
  if (!Object.keys(node.appearance).length) delete node.appearance;
}

function ensureComponentSchemaV3() {
  state.componentsDoc.meta ||= {};
  state.componentsDoc.meta.version = Math.max(3, Number(state.componentsDoc.meta.version) || 0);
}

function inheritedOptions(values, label = (value) => value) {
  return [["", "Inherit / class"], ...values.map((value) => [value, label(value)])];
}

function alignmentIcon(type, value) {
  if (!value) return el("span", { class: "layout-reset-icon", "aria-hidden": "true" });
  const icon = el("span", { class: `layout-${type}-icon is-${value}`, "aria-hidden": "true" });
  const count = type === "align" ? 3 : 3;
  for (let index = 0; index < count; index += 1) icon.append(el("i"));
  return icon;
}

function alignmentControl(label, type, value, options, onchange) {
  const group = el("div", { class: "layout-icon-group", role: "group", "aria-label": label });
  for (const [optionValue, optionLabel] of options) {
    group.append(el("button", {
      type: "button",
      class: optionValue === value ? "is-selected" : "",
      title: optionLabel,
      "aria-label": `${label}: ${optionLabel}`,
      "aria-pressed": String(optionValue === value),
      onclick: () => onchange(optionValue),
    }, alignmentIcon(type, optionValue)));
  }
  return propertyField(label, group, { wide: true });
}

function boxEditor(title, owner, key, { allowAuto = false } = {}) {
  const current = owner[key];
  const grid = el("div", { class: "box-editor" });
  const allValue = typeof current === "string" ? current : "";
  grid.append(spacingCombo("All", typeof current === "number" ? current : allValue, (value) => {
    commitComponentMutation(() => {
      const node = selectedComponentNode();
      const target = node === owner ? node : (node.layout ||= {});
      updateBoxValue(target, key, "all", value);
    });
  }, { allowAuto, wide: true }));
  for (const edge of ["top", "right", "bottom", "left"]) {
    grid.append(spacingCombo(edge[0].toUpperCase() + edge.slice(1), boxEdgeValue(current, edge), (value) => {
      commitComponentMutation(() => {
        const node = selectedComponentNode();
        const target = owner === selectedComponentNode() ? node : (node.layout ||= {});
        updateBoxValue(target, key, edge, value);
      });
    }, { allowAuto }));
  }
  return el("div", { class: "property-field is-wide" }, el("label", {}, title), grid);
}

function renderComponentProperties() {
  const slot = $("#inspect-properties");
  if (!slot) return;
  slot.textContent = "";
  const node = selectedComponentNode();
  if (!node) {
    slot.append(el("div", { class: "properties-empty" },
      state.selection?.file === "components.jsonc"
        ? "Select an element layer in the canvas or Layers panel to edit Auto Layout."
        : "Structured properties are available for component layers. Use the JSON tab for this design token."));
    return;
  }

  const identity = el("section", { class: "property-section" },
    el("h3", { class: "property-section-title" }, "Layer"),
    el("div", { class: "property-grid" }));
  const identityGrid = $(".property-grid", identity);
  const idInput = el("input", {
    type: "text",
    value: node.id || "",
    onchange: (event) => commitComponentMutation(() => { selectedComponentNode().id = event.target.value.trim(); }),
  });
  identityGrid.append(propertyField("Stable ID", idInput, { wide: true }));
  if (node.el) {
    const elementInput = el("input", {
      type: "text",
      value: node.el,
      onchange: (event) => commitComponentMutation(() => { selectedComponentNode().el = event.target.value.trim(); }),
    });
    const classInput = el("input", {
      type: "text",
      value: node.class || "",
      onchange: (event) => commitComponentMutation(() => {
        const selected = selectedComponentNode();
        if (event.target.value.trim()) selected.class = event.target.value.trim();
        else delete selected.class;
      }),
    });
    identityGrid.append(propertyField("Element", elementInput), propertyField("Class", classInput));
  } else {
    identityGrid.append(propertySelect(
      "Component",
      node.component,
      availableComponentNames().map((name) => [name, name]),
      (event) => commitComponentMutation(() => { selectedComponentNode().component = event.target.value; }),
      { wide: true },
    ));
  }

  const layout = node.layout || {};
  const layoutSection = el("section", { class: "property-section" },
    el("div", { class: "property-section-heading" },
      el("h3", { class: "property-section-title" }, "Layout"),
      el("button", {
        type: "button",
        class: `snap-toggle${state.spacingSnap ? " is-active" : ""}`,
        "aria-pressed": String(state.spacingSnap),
        title: state.spacingSnap ? "Unsnap spacing from design tokens" : "Snap spacing to the nearest design token",
        onclick: toggleSpacingSnap,
      }, state.spacingSnap ? "Snapped" : "Free"),
    ),
    el("div", { class: "property-grid" }));
  const layoutGrid = $(".property-grid", layoutSection);
  layoutGrid.append(
    propertySelect("Direction", layout.mode || "", [
      ["", "Unset"], ["none", "None"], ["vertical", "Vertical"], ["horizontal", "Horizontal"], ["grid", "Grid"], ["freeform", "Freeform"],
    ], (event) => commitComponentMutation(() => {
      const selected = selectedComponentNode();
      if (event.target.value === "freeform") ensureComponentSchemaV3();
      selected.layout ||= {};
      if (event.target.value) selected.layout.mode = event.target.value;
      else delete selected.layout.mode;
      if (event.target.value !== "grid") delete selected.layout.columns;
      if (!Object.keys(selected.layout).length) delete selected.layout;
    })),
    spacingCombo("Gap", layout.gap ?? "", (value) => commitComponentMutation(() => {
      const selected = selectedComponentNode();
      selected.layout ||= {};
      if (value !== "") selected.layout.gap = value;
      else delete selected.layout.gap;
      if (!Object.keys(selected.layout).length) delete selected.layout;
    })),
    alignmentControl("Align", "align", layout.align || "", [
      ["", "Unset"], ["start", "Start"], ["center", "Center"], ["end", "End"], ["stretch", "Stretch"], ["baseline", "Baseline"],
    ], (value) => commitComponentMutation(() => {
      const selected = selectedComponentNode();
      selected.layout ||= {};
      if (value) selected.layout.align = value;
      else delete selected.layout.align;
    })),
    alignmentControl("Justify", "justify", layout.justify || "", [
      ["", "Unset"], ["start", "Start"], ["center", "Center"], ["end", "End"], ["space-between", "Space between"],
      ["space-around", "Space around"], ["space-evenly", "Space evenly"],
    ], (value) => commitComponentMutation(() => {
      const selected = selectedComponentNode();
      selected.layout ||= {};
      if (value) selected.layout.justify = value;
      else delete selected.layout.justify;
    })),
    propertyField("Width", el("input", {
      type: "text",
      inputmode: "decimal",
      placeholder: "Unset, hug, fill, or px",
      value: layout.width ?? "",
      onchange: (event) => commitComponentMutation(() => {
        const raw = event.target.value.trim();
        const selected = selectedComponentNode();
        selected.layout ||= {};
        if (!raw) delete selected.layout.width;
        else selected.layout.width = raw === "hug" || raw === "fill" ? raw : Number(raw);
        if (typeof selected.layout.width === "number" && Number.isFinite(selected.layout.width)) ensureComponentSchemaV3();
      }),
    })),
    propertyField("Height", el("input", {
      type: "text",
      inputmode: "decimal",
      placeholder: "Unset, hug, fill, or px",
      value: layout.height ?? "",
      onchange: (event) => commitComponentMutation(() => {
        const raw = event.target.value.trim();
        const selected = selectedComponentNode();
        selected.layout ||= {};
        if (!raw) delete selected.layout.height;
        else selected.layout.height = raw === "hug" || raw === "fill" ? raw : Number(raw);
        if (typeof selected.layout.height === "number" && Number.isFinite(selected.layout.height)) ensureComponentSchemaV3();
      }),
    })),
  );
  if (layout.mode === "grid") {
    const columns = el("input", {
      type: "number", min: "1", step: "1", value: String(layout.columns || 1),
      onchange: (event) => commitComponentMutation(() => { (selectedComponentNode().layout ||= {}).columns = Math.max(1, Number.parseInt(event.target.value, 10) || 1); }),
    });
    layoutGrid.append(propertyField("Columns", columns));
  }
  const checks = el("div", { class: "property-checks property-field is-wide" });
  for (const [key, label] of [["wrap", "Wrap"], ["grow", "Grow"]]) {
    const input = el("input", {
      type: "checkbox",
      checked: layout[key] ? "checked" : undefined,
      onchange: (event) => commitComponentMutation(() => {
        const selected = selectedComponentNode();
        selected.layout ||= {};
        if (event.target.checked) selected.layout[key] = true;
        else delete selected.layout[key];
      }),
    });
    checks.append(el("label", {}, input, label));
  }
  layoutGrid.append(checks);
  layoutGrid.append(boxEditor("Padding", layout, "padding"));
  layoutSection.append(el("div", { class: "property-help" },
    state.spacingSnap
      ? "Spacing follows design.json increments. Dimensions accept hug, fill, or fixed pixels."
      : "Spacing is unsnapped. Dimensions accept hug, fill, or fixed pixels."));

  const parentPath = state.selection?.path?.slice(0, -2);
  const parentNode = parentPath ? valueAtPath(state.componentsDoc, parentPath) : null;
  const canPosition = parentNode?.layout?.mode === "freeform" || node.position;
  let positionSection = null;
  if (canPosition) {
    const position = node.position || {};
    const coordinate = (axis) => propertyField(axis.toUpperCase(), el("input", {
      type: "number",
      step: "any",
      value: position[axis] ?? 0,
      "data-position-axis": axis,
      onchange: (event) => commitComponentMutation(() => {
        const selected = selectedComponentNode();
        selected.position ||= { mode: "absolute", x: 0, y: 0 };
        selected.position[axis] = event.target.valueAsNumber;
      }),
    }));
    positionSection = el("section", { class: "property-section" },
      el("h3", { class: "property-section-title" }, "Freeform position"),
      el("div", { class: "property-grid" },
        propertySelect("Mode", position.mode || "", [["", "Flow"], ["absolute", "Absolute"]], (event) => commitComponentMutation(() => {
          const selected = selectedComponentNode();
          if (event.target.value === "absolute") {
            ensureComponentSchemaV3();
            selected.position = { mode: "absolute", x: position.x ?? 0, y: position.y ?? 0 };
          }
          else delete selected.position;
        })),
        ...(position.mode === "absolute" ? [coordinate("x"), coordinate("y")] : [])),
      el("div", { class: "property-help" }, "Coordinates are pixels relative to the direct freeform parent."));
  }

  const appearance = node.appearance || {};
  const radii = (state.tokens?.radii || []).map((token) => token?.name).filter(Boolean);
  const shadows = (state.tokens?.shadows || []).map((token) => token?.name).filter(Boolean);
  const appearanceSection = el("section", { class: "property-section" },
    el("h3", { class: "property-section-title" }, "Appearance overrides"),
    el("div", { class: "property-grid" }));
  const appearanceGrid = $(".property-grid", appearanceSection);
  const appearanceField = (label, key, options) => propertySelect(
    label,
    appearance[key] || "",
    options,
    (event) => commitComponentMutation(() => setAppearanceOverride(key, event.target.value)),
  );
  appearanceGrid.append(
    typographyPicker("Text style", appearance.textStyle || "", "textStyle",
      (value) => commitComponentMutation(() => setAppearanceOverride("textStyle", value))),
    typographyPicker("Font family", appearance.fontFamily || "", "fontFamily",
      (value) => commitComponentMutation(() => setAppearanceOverride("fontFamily", value))),
    colorPicker("Text color", appearance.color || "",
      (value) => commitComponentMutation(() => setAppearanceOverride("color", value))),
    colorPicker("Background", appearance.background || "",
      (value) => commitComponentMutation(() => setAppearanceOverride("background", value))),
    colorPicker("Border color", appearance.borderColor || "",
      (value) => commitComponentMutation(() => setAppearanceOverride("borderColor", value))),
    appearanceField("Text align", "textAlign", inheritedOptions(["start", "center", "end", "left", "right"], (value) => value[0].toUpperCase() + value.slice(1))),
    appearanceField("Radius", "radius", inheritedOptions(radii)),
    appearanceField("Shadow", "shadow", inheritedOptions(shadows)),
  );
  appearanceSection.append(el("div", { class: "property-help" },
    "Inherit removes the override from components.jsonc. Explicit choices reference design.json tokens and take precedence over parent or class styling."));

  const spacing = el("section", { class: "property-section" },
    el("h3", { class: "property-section-title" }, "Outer spacing"),
    el("div", { class: "property-grid" }, boxEditor("Margin", node, "margin", { allowAuto: true })),
    el("div", { class: "property-help" }, "Values reference spacing tokens from design.json. Changes update every preview of this component definition."));
  slot.append(identity, layoutSection, ...(positionSection ? [positionSection] : []), appearanceSection, spacing);
}

function clearDropClasses() {
  for (const row of document.querySelectorAll(".component-layer-row")) {
    row.classList.remove("is-drop-before", "is-drop-after", "is-drop-inside");
    delete row.dataset.dropPlacement;
  }
}

function renderComponentLayerNode(node, path, depth, root = false) {
  const label = componentLayerLabel(node);
  const row = el("div", {
    class: `component-layer-row${state.selection?.file === "components.jsonc" && pathKey(path) === pathKey(state.selection.path) ? " is-selected" : ""}`,
    draggable: !root && node && typeof node === "object" ? "true" : "false",
    style: `--layer-depth:${depth}`,
    "data-component-layer-path": pathKey(path),
  });
  row.append(el("button", { type: "button", title: label.detail },
    el("span", { class: "layer-icon" }, label.icon),
    label.detail,
    node?.id ? el("span", { class: "layer-id" }, ` · ${node.el || node.component || ""}`) : ""));
  row.querySelector("button").addEventListener("click", () => {
    const pageChanged = state.page !== "components";
    state.page = "components";
    selectDesignPath("components.jsonc", path, label.detail);
    if (pageChanged) render();
  });
  if (!root && node && typeof node === "object") {
    row.addEventListener("dragstart", (event) => {
      state.dragPath = path.slice();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", pathKey(path));
    });
    row.addEventListener("dragend", () => {
      state.dragPath = null;
      clearDropClasses();
    });
  }
  if (node && typeof node === "object") {
    row.addEventListener("dragover", (event) => {
      if (!state.dragPath || state.dragPath[1] !== path[1] || isPathPrefix(state.dragPath, path)) return;
      event.preventDefault();
      event.stopPropagation();
      clearDropClasses();
      const ratio = (event.clientY - row.getBoundingClientRect().top) / row.getBoundingClientRect().height;
      const placement = !root && ratio < .28 ? "before" : !root && ratio > .72 ? "after" : ("el" in node ? "inside" : "before");
      row.dataset.dropPlacement = placement;
      row.classList.add(`is-drop-${placement}`);
      event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", (event) => {
      if (!state.dragPath || !row.dataset.dropPlacement) return;
      event.preventDefault();
      event.stopPropagation();
      const source = state.dragPath.slice();
      const placement = row.dataset.dropPlacement;
      state.dragPath = null;
      clearDropClasses();
      commitComponentMutation(() => window.DSComp.moveComponentNode(state.componentsDoc, source, path, placement));
    });
  }
  const fragment = document.createDocumentFragment();
  fragment.append(row);
  if (node && typeof node === "object") {
    for (const [index, child] of (Array.isArray(node.children) ? node.children : []).entries()) {
      fragment.append(renderComponentLayerNode(child, [...path, "children", index], depth + 1));
    }
  }
  return fragment;
}

function renderComponentLayers() {
  const slot = $("#component-layer-tree");
  if (!slot) return;
  const scrollTop = slot.scrollTop;
  const scrollLeft = slot.scrollLeft;
  slot.textContent = "";
  const components = state.componentsDoc?.components || [];
  for (const [index, component] of components.entries()) {
    if (!component?.root) continue;
    const group = el("section", { class: "component-layer-group" },
      el("div", { class: "component-layer-name" }, component.name || `Component ${index + 1}`));
    group.append(renderComponentLayerNode(component.root, ["components", index, "root"], 0, true));
    slot.append(group);
  }
  if (!slot.childNodes.length) slot.append(el("div", { class: "properties-empty" }, "No component layers."));
  const selected = selectedComponentNode();
  const editable = !!selected && state.selection.path.at(-2) === "children";
  $("#layers-duplicate-btn").disabled = !editable;
  $("#layers-delete-btn").disabled = !editable;
  updateHistoryButtons();
  slot.scrollTop = scrollTop;
  slot.scrollLeft = scrollLeft;
}

function renderInspector() {
  const selection = state.selection;
  const valid = !!selection;
  $("#inspect-title").textContent = valid ? selection.label : "No selection";
  $("#inspect-path").textContent = valid ? `${selection.file}${pointerFor(selection.path)}` : "";
  $("#inspect-path").title = valid ? `${selection.file}${pointerFor(selection.path)}` : "";
  $("#inspect-json").disabled = !valid;
  $("#inspect-json").value = valid ? JSON.stringify(valueAtPath(selectionRoot(selection.file), selection.path), null, 2) : "";
  $("#inspect-apply-btn").disabled = !valid;
  $("#inspect-attach-btn").disabled = !valid;
  $("#inspect-error").textContent = "";
  renderComponentProperties();
  renderComponentLayers();
  setInspectorTab(state.inspectorTab);
}

function applyInspectHighlight() {
  for (const node of document.querySelectorAll("[data-design-inspect], [data-ds-node-path]")) {
    const file = node.dataset.designFile || (node.dataset.dsNodePath ? "components.jsonc" : "");
    const path = node.dataset.designPath || node.dataset.dsNodePath;
    const selected = state.selection && file === state.selection.file && path === JSON.stringify(state.selection.path);
    node.classList.toggle("is-inspected", !!selected);
    if (node.dataset.dsNodePath) {
      const nodePath = renderedNodePath(node);
      if (!nodePath) continue;
      const componentNode = valueAtPath(state.componentsDoc, nodePath);
      const parentNode = valueAtPath(state.componentsDoc, nodePath.slice(0, -2));
      node.classList.toggle("is-freeform-movable",
        componentNode?.position?.mode === "absolute" && parentNode?.layout?.mode === "freeform");
    }
  }
}

function renderedNodePath(element) {
  try {
    const path = JSON.parse(element?.dataset?.dsNodePath || "");
    return Array.isArray(path) ? path : null;
  } catch {
    return null;
  }
}

function freeformDragTarget(start) {
  let element = start?.closest?.("[data-ds-node-path]");
  while (element && $("#app").contains(element)) {
    const path = renderedNodePath(element);
    if (!path) {
      element = element.parentElement?.closest?.("[data-ds-node-path]");
      continue;
    }
    const node = valueAtPath(state.componentsDoc, path);
    const parentPath = path.slice(0, -2);
    const parent = valueAtPath(state.componentsDoc, parentPath);
    if (node?.position?.mode === "absolute" && parent?.layout?.mode === "freeform") {
      return { element, path, node, parentElement: element.offsetParent || element.parentElement };
    }
    element = element.parentElement?.closest?.("[data-ds-node-path]");
  }
  return null;
}

function updateFreeformPosition(path, x, y) {
  const key = pathKey(path);
  for (const element of document.querySelectorAll("[data-ds-node-path]")) {
    if (element.dataset.dsNodePath !== key) continue;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }
  for (const axis of ["x", "y"]) {
    const input = $(`[data-position-axis="${axis}"]`);
    if (input) input.value = String(axis === "x" ? x : y);
  }
  const selected = selectedComponentNode();
  if (selected && pathKey(state.selection.path) === key) {
    $("#inspect-json").value = JSON.stringify(selected, null, 2);
  }
}

function beginFreeformDrag(event) {
  if (!state.inspectMode || event.button !== 0 || state.freeformDrag) return;
  const target = freeformDragTarget(event.target);
  if (!target) return;
  const parentRect = target.parentElement?.getBoundingClientRect();
  const scaleX = parentRect && target.parentElement.offsetWidth ? parentRect.width / target.parentElement.offsetWidth : 1;
  const scaleY = parentRect && target.parentElement.offsetHeight ? parentRect.height / target.parentElement.offsetHeight : 1;
  state.freeformDrag = {
    ...target,
    pointerId: event.pointerId,
    before: clone(state.componentsDoc),
    startX: event.clientX,
    startY: event.clientY,
    originX: target.node.position.x,
    originY: target.node.position.y,
    scaleX: scaleX || 1,
    scaleY: scaleY || 1,
    active: false,
    moved: false,
  };
}

function moveFreeformDrag(event) {
  const drag = state.freeformDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;
  if (!drag.active) {
    if (Math.hypot(deltaX, deltaY) < 4) return;
    drag.active = true;
    selectDesignPath("components.jsonc", drag.path, componentLayerLabel(drag.node).detail);
    drag.element.classList.add("is-freeform-dragging");
    document.body.classList.add("freeform-drag-active");
    drag.element.setPointerCapture?.(event.pointerId);
  }
  const x = Math.round(drag.originX + deltaX / drag.scaleX);
  const y = Math.round(drag.originY + deltaY / drag.scaleY);
  if (x === drag.node.position.x && y === drag.node.position.y) return;
  drag.moved = true;
  drag.node.position.x = x;
  drag.node.position.y = y;
  updateFreeformPosition(drag.path, x, y);
  event.preventDefault();
}

function finishFreeformDrag(event, cancelled = false) {
  const drag = state.freeformDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  state.freeformDrag = null;
  if (!drag.active) return;
  drag.element.releasePointerCapture?.(event.pointerId);
  drag.element.classList.remove("is-freeform-dragging");
  document.body.classList.remove("freeform-drag-active");
  state.suppressInspectClickUntil = Date.now() + 500;
  if (cancelled) {
    drag.node.position.x = drag.originX;
    drag.node.position.y = drag.originY;
    updateFreeformPosition(drag.path, drag.originX, drag.originY);
  } else if (drag.moved) {
    state.componentPast.push(drag.before);
    if (state.componentPast.length > 50) state.componentPast.shift();
    state.componentFuture = [];
    state.design.componentsDoc = state.componentsDoc;
    markComponentsDirty();
    renderInspector();
    applyInspectHighlight();
    postDesignSelection();
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}

function cancelFreeformDrag() {
  const drag = state.freeformDrag;
  if (!drag) return;
  finishFreeformDrag({
    pointerId: drag.pointerId,
    preventDefault() {},
    stopImmediatePropagation() {},
  }, true);
}

function selectionPayload() {
  if (!state.selection) return null;
  const value = valueAtPath(selectionRoot(state.selection.file), state.selection.path);
  return {
    file: state.selection.file,
    path: state.selection.path,
    jsonPointer: pointerFor(state.selection.path),
    label: state.selection.label,
    value,
    draft: state.selection.file === "components.jsonc" ? state.componentsDirty : state.dirty,
  };
}

function postDesignSelection() {
  const selection = selectionPayload();
  if (!selection) return;
  api("/api/design/select", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(selection),
  }).catch(() => {});
}

async function applyInspectorJson() {
  let root;
  let previous;
  let previousComponentsDoc;
  const priorDirty = state.dirty;
  const priorComponentsDirty = state.componentsDirty;
  try {
    if (!state.selection) return;
    const next = JSON.parse($("#inspect-json").value);
    root = selectionRoot(state.selection.file);
    previous = valueAtPath(root, state.selection.path);
    if (state.selection.file === "components.jsonc") previousComponentsDoc = clone(state.componentsDoc);
    replaceAtPath(root, state.selection.path, next);
    if (state.selection.file === "components.jsonc") {
      const validation = window.DSComp?.validateComponentsDoc?.(state.componentsDoc, { tokens: state.tokens });
      if (validation && !validation.ok) {
        replaceAtPath(root, state.selection.path, previous);
        throw new Error(validation.errors.join(" "));
      }
      state.componentPast.push(previousComponentsDoc);
      if (state.componentPast.length > 50) state.componentPast.shift();
      state.componentFuture = [];
      state.design.componentsDoc = state.componentsDoc;
      markComponentsDirty();
    } else {
      await api("/api/design/validate-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokens: state.tokens }),
      });
      markDirty();
    }
    await render();
    renderInspector();
    applyInspectHighlight();
    postDesignSelection();
  } catch (error) {
    if (root && previous !== undefined) {
      if (state.selection.file === "components.jsonc" && previousComponentsDoc) {
        state.componentsDoc = previousComponentsDoc;
        state.design.componentsDoc = state.componentsDoc;
      } else {
        replaceAtPath(root, state.selection.path, previous);
      }
      state.dirty = priorDirty;
      state.componentsDirty = priorComponentsDirty;
      updateSaveButton();
      await render().catch(() => {});
      renderInspector();
      applyInspectHighlight();
    }
    $("#inspect-error").textContent = error.message || String(error);
  }
}

async function attachDesignSelection() {
  const selection = selectionPayload();
  if (!selection) return;
  const button = $("#inspect-attach-btn");
  try {
    button.disabled = true;
    const result = await api("/api/design/attach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(selection),
    });
    button.textContent = "Sent";
    setTimeout(() => { button.textContent = "Send to chat"; button.disabled = false; }, 1400);
    return result;
  } catch (error) {
    button.disabled = false;
    $("#inspect-error").textContent = error.message || String(error);
  }
}

/* ---------- section renderers ---------- */

function portFields(obj, { withScope = false } = {}) {
  const rows = [];
  if (withScope) {
    const areaIn = el("input", { type: "text", value: obj.area || "", placeholder: "e.g. chat",
      oninput: (e) => { obj.area = e.target.value; markDirty(); } });
    const compIn = el("input", { type: "text", value: (obj.components || []).join(", "), placeholder: "e.g. ChatBubble, ChatComposer",
      oninput: (e) => { obj.components = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); markDirty(); } });
    rows.push(
      el("div", { class: "editable" }, el("label", {}, "Area"), areaIn),
      el("div", { class: "editable" }, el("label", {}, "Components (comma-separated)"), compIn),
    );
  }
  const shipsIn = el("input", { type: "text", value: obj.authoritySource || "", placeholder: "ships as — e.g. Native WinUI 3 / C#",
    oninput: (e) => { obj.authoritySource = e.target.value; markDirty(); } });
  const syncIn = el("input", { type: "text", value: obj.syncSource || "", placeholder: "sync source — e.g. https://github.com/microsoft/win-dev-skills",
    oninput: (e) => { obj.syncSource = e.target.value; markDirty(); } });
  const helperIn = el("input", { type: "text", value: obj.helperAgent || "", placeholder: "helper agent (optional) — e.g. win-dev-skills",
    oninput: (e) => { obj.helperAgent = e.target.value; markDirty(); } });
  const ownerIn = el("input", { type: "text", value: obj.owner || "", placeholder: "owner (optional) — who owns the canonical implementation",
    oninput: (e) => { obj.owner = e.target.value; markDirty(); } });
  rows.push(
    el("div", { class: "editable" }, el("label", {}, "Authority source (ships as)"), shipsIn),
    el("div", { class: "editable" }, el("label", {}, "Sync source (port reference/skill)"), syncIn),
    el("div", { class: "editable" }, el("label", {}, "Helper agent (optional)"), helperIn),
    el("div", { class: "editable" }, el("label", {}, "Owner (optional)"), ownerIn),
  );
  return rows;
}

function renderAuthority(t) {
  const a = (t.authority && typeof t.authority === "object") ? t.authority : (t.authority = {});
  if (typeof a.designSource !== "string" || !a.designSource) a.designSource = "self";
  if (!Array.isArray(a.portOverrides)) a.portOverrides = [];

  const wrap = el("div", { class: "authority", style: "margin-top:14px" }, el("label", {}, "Authority — design vs. port"));
  wrap.append(el("div", { class: "muted", style: "margin-top:4px" },
    "These files are the source of truth for design (framework-agnostic). Port targets say what each surface ships as and which reference/skill to port the design with — leave empty for web/JSX repos where these files are also the implementation."));

  // Default port target (app-wide). The checkbox/fields track whether the object
  // exists so they appear the moment you toggle it on; whether it actually "counts"
  // as a port (preview-only mode, validation) is decided by hasPort() once filled.
  const hasDefaultPort = !!a.port && typeof a.port === "object";
  const defBody = el("div", { class: "authority-port", style: hasDefaultPort ? "" : "display:none" });
  if (hasDefaultPort) defBody.append(...portFields(a.port));
  const defToggle = el("label", { class: "authority-toggle", style: "margin-top:10px;display:block" },
    el("input", { type: "checkbox", checked: hasDefaultPort ? "checked" : undefined,
      onchange: (e) => {
        if (e.target.checked) { a.port = a.port || { authoritySource: "", syncSource: "", helperAgent: "" }; }
        else { a.port = null; }
        markDirty(); render();
      } }),
    " This app has a default port target (ships as native/other, not the JSX itself)");
  wrap.append(defToggle, defBody);

  // App-wide ownership + sync process for the canonical implementation. Most
  // relevant when a port target exists (native/other is canonical), but harmless
  // to record either way — it names who keeps the derived examples aligned.
  const ownerIn = el("input", { type: "text", value: a.owner || "", placeholder: "e.g. @openclaw/windows-ui",
    oninput: (e) => { a.owner = e.target.value; markDirty(); } });
  const syncProcIn = el("input", { type: "text", value: a.syncProcess || "", placeholder: "e.g. Regenerated from XAML each release; see docs/design-sync.md",
    oninput: (e) => { a.syncProcess = e.target.value; markDirty(); } });
  wrap.append(el("div", { class: "faces", style: "margin-top:10px;grid-template-columns:1fr 1fr;display:grid;gap:12px" },
    el("div", { class: "editable" }, el("label", {}, "Implementation owner (optional)"), ownerIn),
    el("div", { class: "editable" }, el("label", {}, "Sync process (optional)"), syncProcIn)));

  // Per-area overrides.
  wrap.append(el("div", { class: "muted", style: "margin-top:12px;font-weight:600" }, "Per-area overrides"));
  a.portOverrides.forEach((o, i) => {
    const card = el("div", { class: "authority-override" }, ...portFields(o, { withScope: true }));
    card.append(el("button", { class: "btn", style: "margin-top:8px",
      onclick: () => { a.portOverrides.splice(i, 1); markDirty(); render(); } }, "Remove override"));
    wrap.append(card);
  });
  wrap.append(el("button", { class: "btn", style: "margin-top:8px",
    onclick: () => { a.portOverrides.push({ area: "", components: [], authoritySource: "", syncSource: "", helperAgent: "" }); markDirty(); render(); } },
    "Add area override"));

  return wrap;
}

function renderBrand(t) {
  const b = t.brand || {};
  const nameIn = el("input", { type: "text", value: b.name || "", oninput: (e) => { b.name = e.target.value; markDirty(); $("#brand-name").textContent = e.target.value; } });
  const tagIn = el("input", { type: "text", value: b.tagline || "", oninput: (e) => { b.tagline = e.target.value; markDirty(); $("#brand-tag").textContent = e.target.value; } });
  const descIn = el("textarea", { class: "otextarea", rows: "3", placeholder: "What is this app/project? Who is it for? What does it do? (codegen reads this for context)",
    oninput: (e) => { b.description = e.target.value; markDirty(); const d = $("#brand-desc"); if (d) { d.textContent = e.target.value; d.style.display = e.target.value ? "" : "none"; } } });
  descIn.value = b.description || "";
  return inspectable(el("section", { class: "block" },
    el("h2", {}, "Brand"),
    el("div", { class: "brand" },
      el("div", { class: "name", id: "brand-name" }, b.name || "Untitled"),
      el("div", { class: "tagline", id: "brand-tag" }, b.tagline || ""),
      el("div", { class: "brand-desc", id: "brand-desc", style: b.description ? "" : "display:none" }, b.description || ""),
      el("div", { class: "chips" }, ...(b.personality || []).map((p) => el("span", { class: "chip" }, p))),
      b.voice ? el("div", { class: "muted", style: "margin-top:6px" }, "Voice — " + b.voice) : "",
      (b.antiReferences || []).length ? el("div", { class: "muted", style: "margin-top:2px" }, "Avoid — " + b.antiReferences.join("; ")) : "",
    ),
    el("div", { class: "faces", style: "margin-top:14px;grid-template-columns:1fr 1fr;display:grid;gap:12px" },
      el("div", { class: "editable" }, el("label", {}, "Brand name"), nameIn),
      el("div", { class: "editable" }, el("label", {}, "Tagline"), tagIn),
    ),
    el("div", { class: "editable", style: "margin-top:12px" }, el("label", {}, "Description (app / project context for codegen)"), descIn),
    renderAuthority(t),
  ), "design.json", ["brand"], "Brand");
}

function renderColors(t) {
  const list = colorList(t);
  const previewOnly = hasPort(t);
  const section = inspectable(el("section", { class: "block" }, el("h2", {}, "Color")), "design.json", ["colors"], "Colors");
  section.append(el("div", { class: "muted", style: "margin:-6px 0 12px" },
    previewOnly
      ? el("span", {}, "Previewing ", el("strong", {}, THEME_LABEL[state.theme]),
          " — these hex values are preview-only swatches. Bind each color's ",
          el("span", { class: "mono" }, "resource"), " key in code, never the raw hex.")
      : el("span", {}, "Previewing ", el("strong", {}, THEME_LABEL[state.theme]), " theme.")));
  const grid = el("div", { class: "swatches" });
  list.forEach((c, i) => {
    const shown = colorValueForTheme(c, state.theme);
    const colorIn = el("input", { type: "color", value: /^#([0-9a-f]{6})$/i.test(shown) ? shown : "#000000",
      oninput: (e) => {
        setColorValueForTheme(list[i], state.theme, e.target.value);
        if (Array.isArray(t.colors)) setColorValueForTheme(t.colors[i], state.theme, e.target.value);
        fill.style.background = e.target.value; valEl.textContent = e.target.value; applyVars(); markDirty();
      } });
    const fill = el("div", { class: "chipfill", style: `background:${shown}` });
    const valEl = el("span", { class: "val mono" }, shown);
    const themeChips = el("div", { class: "theme-chips" });
    if (c.themes && typeof c.themes === "object") {
      for (const th of THEMES) {
        const v = c.themes[th];
        if (!v) continue;
        themeChips.append(el("span", { class: "theme-chip" + (th === state.theme ? " is-active" : ""), title: `${THEME_LABEL[th]}: ${v}` },
          el("span", { class: "dot", style: `background:${v}` }), th === "highContrast" ? "HC" : THEME_LABEL[th]));
      }
    }
    grid.append(inspectable(el("div", { class: "swatch" }, fill,
      el("div", { class: "meta" },
        el("div", { class: "row" }, el("span", { class: "name" }, c.name), colorIn),
        el("div", { class: "row" }, valEl),
        c.resource ? el("div", { class: "resource mono", title: "Canonical implementation resource key" }, "→ " + c.resource) : "",
        themeChips.childNodes.length ? themeChips : "",
        c.usage ? el("div", { class: "usage" }, c.usage) : "",
      )), "design.json", Array.isArray(t.colors) ? ["colors", i] : ["colors", c.name], `Color: ${c.name}`));
  });
  section.append(grid);
  return section;
}

function renderTypography(t) {
  const ty = t.typography || {};
  const facesWrap = el("div", { class: "faces" });
  for (const role of ["display", "body", "mono"]) {
    const f = ty[role];
    if (!f) continue;
    const input = el("input", { type: "text", value: f.family || "",
      oninput: (e) => { f.family = e.target.value; applyVars(); markDirty(); sample.style.fontFamily = e.target.value; } });
    const sample = el("div", { style: `font-family:${f.family};font-size:20px` }, role === "mono" ? "0123 const x = 42;" : "The quick brown fox");
    facesWrap.append(el("div", { class: "face" }, el("div", { class: "k" }, role), el("div", { class: "editable" }, sample, input)));
  }
  const scaleWrap = el("div", {});
  for (const [index, s] of (ty.scale || []).entries()) {
    const fam = s.role === "display" ? "var(--font-display)" : s.role === "mono" ? "var(--font-mono)" : "var(--font-body)";
    scaleWrap.append(inspectable(el("div", { class: "type-row" },
      el("div", { class: "tag mono" }, `${s.name} · ${s.size}/${s.lineHeight} · ${s.weight}`),
      el("div", { style: `font-family:${fam};font-size:${s.size};line-height:${s.lineHeight};font-weight:${s.weight};letter-spacing:${s.tracking || "normal"}` }, "Design is how it works"),
    ), "design.json", ["typography", "scale", index], `Type style: ${s.name}`));
  }
  return inspectable(el("section", { class: "block" }, el("h2", {}, "Typography"), facesWrap, scaleWrap), "design.json", ["typography"], "Typography");
}

function renderScales(t) {
  const sp = el("div", { class: "scale-strip" });
  for (const [index, s] of (t.spacing?.scale || []).entries()) sp.append(inspectable(el("div", { class: "space-demo" }, el("div", { class: "bar", style: `width:${s.value}` }), el("span", { class: "tag mono" }, `${s.name}·${s.value}`)), "design.json", ["spacing", "scale", index], `Spacing: ${s.name}`));
  const rad = el("div", { class: "scale-strip" });
  for (const [index, r] of (t.radii || []).entries()) rad.append(inspectable(el("div", { class: "radius-demo" }, el("div", { class: "box", style: `border-radius:${r.value}` }), el("span", { class: "tag mono" }, `${r.name}·${r.value}`)), "design.json", ["radii", index], `Radius: ${r.name}`));
  const sh = el("div", { class: "scale-strip" });
  for (const [index, s] of (t.shadows || []).entries()) sh.append(inspectable(el("div", { class: "shadow-demo" }, el("div", { class: "box", style: `box-shadow:${s.value}` }), el("span", { class: "tag mono" }, s.name)), "design.json", ["shadows", index], `Shadow: ${s.name}`));
  return el("section", { class: "block" },
    inspectable(el("div", {}, el("h2", {}, "Spacing"), sp), "design.json", ["spacing"], "Spacing"),
    inspectable(el("div", {}, el("h2", { style: "margin-top:22px" }, "Radii"), rad), "design.json", ["radii"], "Radii"),
    inspectable(el("div", {}, el("h2", { style: "margin-top:22px" }, "Shadows"), sh), "design.json", ["shadows"], "Shadows"));
}

function renderPrinciples(t) {
  if (!(t.principles || []).length) return "";
  return inspectable(el("section", { class: "block" }, el("h2", {}, "Principles"),
    el("ul", { class: "principles" }, ...t.principles.map((p, index) => inspectable(el("li", {}, p), "design.json", ["principles", index], `Principle ${index + 1}`)))),
    "design.json", ["principles"], "Principles");
}

/* ---------- component previews (pure JSON interpreter, no React/Babel) ---------- */

// The interpreter (components-render.mjs) loads as a deferred ESM module and sets
// window.DSComp; briefly wait for it in case a render races the module load.
function whenDSComp(timeoutMs = 3000) {
  if (window.DSComp) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.DSComp || Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve(!!window.DSComp); }
    }, 15);
  });
}

async function renderComponents(t, doc, { names = null, heading = "Components" } = {}) {
  const section = el("section", { class: "block" }, el("h2", {}, heading));
  const DS = window.DSComp;
  const availableNames = DS && doc ? DS.componentNames(doc) : [];
  if (!doc || !availableNames.length) {
    section.append(el("div", { class: "muted" }, "No components.jsonc yet."));
    return section;
  }
  const previewNames = Array.isArray(names)
    ? names.filter((name) => availableNames.includes(name))
    : availableNames;
  if (!previewNames.length) {
    section.append(el("div", { class: "muted" }, "No components selected for this page."));
    return section;
  }

  for (const name of previewNames) {
    const componentIndex = doc.components.findIndex((component) => component?.name === name);
    const card = inspectable(el("div", { class: "preview" }), "components.jsonc", ["components", componentIndex], `Component: ${name}`);
    card.append(el("div", { class: "head" }, el("span", { class: "cname" }, name)));
    const stage = el("div", { class: "stage" });
    const surface = el("div", { class: "ds-preview-surface", style: "padding:20px" });
    stage.append(surface);
    card.append(stage);

    try {
      const dom = DS.renderComponent(doc, name, {});
      if (dom) surface.append(dom);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      surface.append(el("div", { class: "err" }, "Render error: " + msg));
    }

    card.append(el("details", { class: "src" },
      el("summary", {}, "Definition"),
      el("pre", { class: "mono" }, el("code", {}, componentDefJson(doc, name)))));
    section.append(card);
  }
  return section;
}

function checkComponentPreviews(doc) {
  state.componentBuildError = null;
  const DS = window.DSComp;
  if (!DS || !doc) return;
  for (const name of DS.componentNames(doc)) {
    try { DS.renderComponent(doc, name, {}); }
    catch (error) {
      state.componentBuildError = String(error && error.message ? error.message : error);
      return;
    }
  }
}

function renderBrandPage(t) {
  const page = document.createDocumentFragment();
  if (state.design.parseError) {
    page.append(el("div", { class: "banner warn" }, "design.json has a JSON error and could not be parsed — showing the starter tokens. Fix: " + state.design.parseError));
  }
  if (state.mode === "proposal") page.append(proposalBar());
  else if (state.design.source === "sample") page.append(onboarding());
  page.append(renderBrand(t), renderColors(t), renderTypography(t), renderScales(t), renderPrinciples(t));
  return page;
}

const BUILTIN_PAGES = Object.freeze([
  {
    id: "brand",
    label: "Brand",
    description: "Identity, tokens, and principles",
    render: (tokens) => renderBrandPage(tokens),
  },
  {
    id: "components",
    label: "Components",
    description: "Live patterns and definitions",
    render: (tokens) => renderComponents(tokens, state.componentsDoc || null),
  },
]);

function userPages() {
  return Array.isArray(state.tokens?.pages)
    ? state.tokens.pages.filter((page) => page && typeof page === "object" && typeof page.id === "string" && page.id && typeof page.name === "string")
    : [];
}

function pageRegistry() {
  return [
    ...BUILTIN_PAGES,
    ...userPages().map((page) => ({
      id: page.id,
      label: page.name || "Untitled page",
      description: page.description || "Custom design-system page",
      render: (tokens) => renderUserPage(tokens, page),
    })),
  ];
}

function activePage() {
  return pageRegistry().find((page) => page.id === state.page) || BUILTIN_PAGES[0];
}

function selectPage(id) {
  if (!pageRegistry().some((page) => page.id === id) || state.page === id) return;
  state.page = id;
  render();
}

function availableComponentNames() {
  const DS = window.DSComp;
  const doc = state.componentsDoc;
  return DS && doc ? DS.componentNames(doc) : [];
}

function selectedPageComponents(page, names) {
  return Array.isArray(page.components) ? page.components : names;
}

function pageId() {
  const suffix = window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `page-${suffix}`;
}

function createPage() {
  const pages = Array.isArray(state.tokens.pages) ? state.tokens.pages : (state.tokens.pages = []);
  const existing = new Set(pages.map((page) => page?.id));
  let id = pageId();
  while (existing.has(id)) id = pageId();
  const number = pages.length + 1;
  pages.push({
    id,
    name: `Untitled page ${number}`,
    description: "",
    content: "",
    components: availableComponentNames(),
  });
  state.page = id;
  markDirty();
  render();
}

function deletePage(page) {
  if (!window.confirm(`Delete "${page.name || "this page"}"? This change will be saved with your next save.`)) return;
  const pages = Array.isArray(state.tokens.pages) ? state.tokens.pages : [];
  const index = pages.indexOf(page);
  if (index < 0) return;
  pages.splice(index, 1);
  state.page = "brand";
  markDirty();
  render();
}

function updateCurrentPageNavigation(page) {
  const link = $(".page-nav-link.is-active");
  const label = $(".page-nav-label", link);
  const description = $(".page-nav-description", link);
  if (label) label.textContent = page.name || "Untitled page";
  if (description) description.textContent = page.description || "Custom design-system page";
}

function renderPageNavigation() {
  const nav = el("nav", { class: "page-nav", "aria-label": "Design system pages" },
    el("div", { class: "page-nav-title" }, "Design system"),
    el("div", { class: "page-nav-list" }));
  const list = $(".page-nav-list", nav);
  for (const page of pageRegistry()) {
    const active = page.id === state.page;
    list.append(el("button", {
      type: "button",
      class: "page-nav-link" + (active ? " is-active" : ""),
      "aria-current": active ? "page" : undefined,
      onclick: () => selectPage(page.id),
    },
    el("span", { class: "page-nav-label" }, page.label),
    el("span", { class: "page-nav-description" }, page.description)));
  }
  nav.append(el("button", {
    type: "button",
    class: "page-add",
    onclick: createPage,
  }, "+ Add page"));
  return nav;
}

async function renderUserPage(t, page) {
  const content = document.createDocumentFragment();
  const names = availableComponentNames();
  const selected = selectedPageComponents(page, names);
  const selectedSet = new Set(selected);
  const title = el("input", {
    type: "text",
    class: "page-title-input",
    value: page.name || "",
    "aria-label": "Page title",
    oninput: (event) => { page.name = event.target.value; updateCurrentPageNavigation(page); markDirty(); },
  });
  const description = el("textarea", {
    class: "page-description-input",
    rows: "2",
    placeholder: "Describe what this page helps the team understand.",
    oninput: (event) => { page.description = event.target.value; updateCurrentPageNavigation(page); markDirty(); },
  });
  description.value = page.description || "";
  const notes = el("textarea", {
    class: "page-notes-input",
    rows: "8",
    placeholder: "Add decisions, guidance, links, or other working notes for this page.",
    oninput: (event) => { page.content = event.target.value; markDirty(); },
  });
  notes.value = page.content || "";
  const choices = el("div", { class: "page-component-list" });
  if (names.length) {
    for (const name of names) {
      const box = el("input", {
        type: "checkbox",
        checked: selectedSet.has(name) ? "checked" : undefined,
        onchange: (event) => {
          const next = new Set(selectedPageComponents(page, names));
          if (event.target.checked) next.add(name);
          else next.delete(name);
          page.components = names.filter((component) => next.has(component));
          markDirty();
          render();
        },
      });
      choices.append(el("label", { class: "page-component-option" }, box, el("span", {}, name)));
    }
  } else {
    choices.append(el("div", { class: "muted" }, "Add component patterns to components.jsonc to organize them here."));
  }

  content.append(
    el("section", { class: "page-editor" },
      el("div", { class: "page-editor-head" },
        el("div", { class: "page-editor-heading" }, title),
        el("button", { type: "button", class: "btn page-delete", onclick: () => deletePage(page) }, "Delete page"),
      ),
      el("div", { class: "editable" }, el("label", {}, "Description"), description),
      el("div", { class: "editable" }, el("label", {}, "Notes"), notes),
    ),
    el("section", { class: "page-organization" },
      el("h2", {}, "Components"),
      el("p", { class: "muted" }, "Choose the component previews this page should collect. Changes appear when you save the design system."),
      choices,
    ),
  );
  content.append(await renderComponents(t, state.componentsDoc || null, {
    names: selectedPageComponents(page, names),
    heading: "Selected previews",
  }));
  return content;
}

// Pretty-print just one component's JSON definition for the collapsible source view.
function componentDefJson(doc, name) {
  const list = (doc && Array.isArray(doc.components)) ? doc.components : [];
  const one = list.find((c) => c && c.name === name);
  try { return JSON.stringify(one ?? {}, null, 2); }
  catch { return ""; }
}

/* ---------- onboarding + proposal ---------- */

function onboarding() {
  // Collapsible: once you've seen the setup options you rarely need them again,
  // and this block only shows pre-setup (source === "sample"). Remember the
  // open/closed choice best-effort; default open so first-run is guided.
  let open = true;
  try { const s = localStorage.getItem("colophon.onboardOpen"); if (s !== null) open = s === "1"; } catch { /* no storage */ }

  const wrap = el("details", open ? { class: "onboard", open: "" } : { class: "onboard" });
  wrap.addEventListener("toggle", () => { try { localStorage.setItem("colophon.onboardOpen", wrap.open ? "1" : "0"); } catch { /* no storage */ } });

  wrap.append(el("summary", { class: "onboard-summary" },
    el("span", { class: "chev", "aria-hidden": "true" }, "▸"),
    el("div", { class: "onboard-head" },
      el("h2", {}, "Set up a design system"),
      el("div", { class: "muted" }, "This repo has no ", el("span", { class: "mono" }, ".agents/design/"), " yet — the starter below is a preview. Choose how to start; refine everything in the canvas afterward."))));

  const body = el("div", { class: "onboard-body" });
  body.append(el("div", { class: "muted" }, "Seeding also adds an ", el("span", { class: "mono" }, "AGENTS.md"), " pointer so every agent reads the system before UI work."));

  const cards = el("div", { class: "onboard-cards" });

  // 1) Start fresh
  cards.append(el("div", { class: "ocard" },
    el("div", { class: "otitle" }, "Start fresh"),
    el("div", { class: "muted" }, "Generate a new system and refine it here."),
    el("div", { class: "orow" },
      el("button", { class: "btn primary", onclick: () => doInit("starter") }, "Use bundled starter"),
      el("button", { class: "btn", onclick: () => doInit("scratch") }, "Blank skeleton")),
  ));

  // 2) Import tokens
  const pathIn = el("input", { type: "text", placeholder: "path/to/tokens.json (repo-relative)", class: "otext" });
  const jsonIn = el("textarea", { placeholder: "…or paste token JSON here", class: "otextarea", rows: "3" });
  cards.append(el("div", { class: "ocard" },
    el("div", { class: "otitle" }, "Import tokens"),
    el("div", { class: "muted" }, "Inherit an existing token set, then refine."),
    el("div", { class: "orow" }, pathIn, el("button", { class: "btn", onclick: () => doImport({ path: pathIn.value.trim() }) }, "Import file")),
    jsonIn,
    el("div", { class: "orow" }, el("button", { class: "btn", onclick: () => doImport({ json: jsonIn.value }) }, "Import JSON")),
  ));

  // 3) Scan codebase
  const scanBtn = el("button", { class: "btn", onclick: () => doScan(scanBtn) }, "Scan this repo");
  cards.append(el("div", { class: "ocard" },
    el("div", { class: "otitle" }, "Scan existing UI"),
    el("div", { class: "muted" }, "Extract colors, type & spacing from current code."),
    el("div", { class: "orow" }, scanBtn),
  ));

  body.append(cards);
  wrap.append(body);
  return wrap;
}

function proposalBar() {
  const p = state.proposal || {};
  const bar = el("section", { class: "banner proposal" });
  bar.append(el("div", { class: "prow" },
    el("div", {},
      el("strong", {}, "Proposed from " + (p.label || "import")),
      el("span", { class: "muted", style: "margin-left:8px" }, "Not saved yet — refine below, then save."),
    ),
    el("div", { class: "pactions" },
      el("button", { class: "btn primary", onclick: doSaveProposal }, "Save to repo"),
      el("button", { class: "btn", onclick: discardProposal }, "Discard"),
    )));
  if (p.evidence) {
    const ev = p.evidence;
    bar.append(el("div", { class: "muted", style: "margin-top:6px" },
      `Scanned ${ev.fileCount} files · ${(ev.topColors || []).length} colors · ${(ev.fonts || []).length} font(s)${ev.hasTailwind ? " · Tailwind detected" : ""}`));
  }
  if (state.tokens?.authority?.port || (state.tokens?.authority?.portOverrides || []).length) {
    bar.append(el("div", { class: "muted", style: "margin-top:6px" },
      "Little/no web styling was found, so this looks like a native app. These tokens are a design starting point — set the ",
      el("strong", {}, "port target"),
      " (what it ships as + the sync source/skill to port with) in Brand → Authority before saving."));
  }
  if ((p.warnings || []).length) {
    bar.append(el("ul", { class: "warnlist" }, ...p.warnings.map((w) => el("li", {}, w))));
  }
  return bar;
}

function enterProposal(data, label) {
  state.tokens = JSON.parse(JSON.stringify(data.tokens || {}));
  state.mode = "proposal";
  state.proposal = { label, warnings: data.warnings || [], evidence: data.evidence || null };
  state.dirty = true;
  applyVars();
  render();
  const save = $("#save-btn"); if (save) { save.disabled = false; save.textContent = "Save to repo"; }
}

async function doImport(body) {
  if (!body.path && !(body.json && body.json.trim())) { alert("Enter a file path or paste JSON."); return; }
  try {
    const out = await api("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    enterProposal(out, body.path ? body.path : "pasted JSON");
  } catch (e) { alert("Import failed: " + e.message); }
}

async function doScan(btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Scanning…"; }
  try {
    const out = await api("/api/scan", { method: "POST" });
    enterProposal(out, "codebase scan");
  } catch (e) { alert("Scan failed: " + e.message); if (btn) { btn.disabled = false; btn.textContent = "Scan this repo"; } }
}

async function doSaveProposal() {
  try {
    const out = await api("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokens: state.tokens }) });
    state.design.source = "repo"; state.design.dir = out.dir;
    state.mode = "normal"; state.proposal = null;
    await load();
  } catch (e) { alert("Save failed: " + e.message); }
}

function discardProposal() {
  state.mode = "normal"; state.proposal = null;
  load();
}

/* ---------- validation ---------- */

function checksDescription() {
  const ported = hasPort(state.tokens);
  const nodes = [
    el("p", { class: "vdesc-line" },
      el("strong", {}, "What this checks: "),
      "that ", el("code", {}, "design.json"), " parses and defines the core token groups (colors, type, spacing, radii), and that ",
      el("code", {}, "components.jsonc"), " is valid JSON where every component has a root and all component references resolve — the same definitions rendered live here in the canvas."),
  ];
  if (ported) {
    nodes.push(el("p", { class: "vdesc-line" },
      "A native port is declared, so the shipping implementation — not this preview — is the source of truth. It also requires every color to carry a ",
      el("code", {}, "resource"), " key and the authority to name an ",
      el("code", {}, "owner"), " and a ", el("code", {}, "syncProcess"),
      ". Those are the breadcrumbs that keep the design files and the shipping code from silently drifting apart."));
  } else {
    nodes.push(el("p", { class: "vdesc-line muted" },
      "No port is declared, so the design files are canonical (there is no second copy to drift against) — the drift checks for ",
      el("code", {}, "resource"), " keys, ", el("code", {}, "owner"), ", and ", el("code", {}, "syncProcess"), " don't apply here."));
  }
  return nodes;
}

function validationPanel() {
  const v = state.validation;
  if (!v) return "";
  const errors = [...(v.errors || [])];
  const warnings = [...(v.warnings || [])];
  if (state.componentBuildError) errors.push("components.jsonc failed to render in the live preview: " + state.componentBuildError);
  const ok = errors.length === 0;
  const bar = el("section", { class: "banner validation " + (ok ? "vok" : "vbad"), role: "status" });
  bar.append(el("div", { class: "prow" },
    el("div", {},
      el("strong", {}, ok ? "✓ Design system valid" : "✗ Validation found issues"),
      el("span", { class: "muted", style: "margin-left:8px" }, `${errors.length} error(s), ${warnings.length} warning(s)`),
      (state.dirty || state.componentsDirty) ? el("span", { class: "muted", style: "margin-left:8px" }, "· validates the saved system — save to include unsaved edits") : "",
    ),
    el("button", {
      class: "validation-close",
      type: "button",
      "aria-label": "Dismiss validation results",
      title: "Dismiss",
      onclick: () => { state.validation = null; renderValidation(); },
    }, "×")));
  bar.append(el("div", { class: "vdesc" }, ...checksDescription()));
  if (errors.length) bar.append(el("ul", { class: "warnlist err" }, ...errors.map((e) => el("li", {}, e))));
  if (warnings.length) bar.append(el("ul", { class: "warnlist" }, ...warnings.map((w) => el("li", {}, w))));
  return bar;
}

// The validation result floats below the sticky topbar without shifting page content.
function positionValidationSlot() {
  const slot = $("#validation-slot");
  const bar = $(".topbar");
  if (!bar) return;
  const barBottom = `${bar.offsetHeight}px`;
  document.documentElement.style.setProperty("--canvas-topbar-offset", barBottom);
  if (slot) slot.style.top = `${bar.offsetHeight + 14}px`;
}

function renderValidation() {
  const slot = $("#validation-slot");
  if (!slot) return;
  slot.textContent = "";
  const panel = validationPanel();
  if (panel) { slot.append(panel); positionValidationSlot(); }
}

async function doValidate() {
  const btn = $("#validate-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Validating…"; }
  try {
    state.validation = await api("/api/validate");
    renderValidation();
  } catch (e) { alert("Validate failed: " + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Validate"; } }
}

/* ---------- theme preview ---------- */

function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  state.theme = theme;
  for (const b of document.querySelectorAll("#theme-switch .theme-btn")) {
    const active = b.dataset.theme === theme;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-pressed", active ? "true" : "false");
  }
  applyVars();
  render();
}

/* ---------- top-level render ---------- */

// Guards against overlapping async renders: render() is async (it may await other
// work), so a theme switch mid-render could start a second pass and both would append
// their component section. Only the newest render is allowed to append after its await.
let renderSeq = 0;

async function render() {
  const gen = ++renderSeq;
  const t = state.tokens;
  const root = $("#app");
  root.textContent = "";

  renderValidation();
  const page = activePage();
  const content = el("div", { class: "page-content", tabindex: "-1" });
  const pageContent = await page.render(t);
  if (gen !== renderSeq) return; // a newer render superseded this one
  content.append(pageContent);
  root.append(el("div", { class: "canvas-layout" }, renderPageNavigation(), content));
  applyInspectHighlight();
  positionValidationSlot();
  renderInspector();
}

async function doInit(mode) {
  try { await api("/api/init", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: mode || "starter" }) }); await load(); }
  catch (e) { alert("Init failed: " + e.message); }
}

async function doSave() {
  const btn = $("#save-btn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    let out = null;
    if (state.dirty || state.design.source !== "repo") {
      out = await api("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokens: state.tokens }) });
    }
    if (state.componentsDirty) {
      await api("/api/components/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doc: state.componentsDoc }),
      });
    }
    state.design.source = "repo";
    if (out?.dir) state.design.dir = out.dir;
    state.dirty = false;
    state.componentsDirty = false;
    btn.textContent = "Saved ✓";
    btn.disabled = true;
    updateSourcePill();
  } catch (e) { btn.disabled = false; btn.textContent = "Save changes"; alert("Save failed: " + e.message); }
}

async function doExport() {
  const button = $("#export-btn");
  if (button) { button.disabled = true; button.textContent = "Exporting…"; }
  try {
    const result = await api("/api/prototypes/export", { method: "POST" });
    alert(`Exported prototype:\n${result.path}`);
  } catch (error) {
    alert("Export failed: " + error.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = "Export"; }
  }
}

async function doPublish() {
  if (!window.confirm("Publish this prototype to GitHub Pages? This creates a commit on the gh-pages branch.")) return;
  try {
    const result = await api("/api/prototypes/publish", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    window.open(result.published.url, "_blank", "noopener");
  } catch (error) {
    alert("Publish failed: " + error.message);
  }
}

function updateSourcePill() {
  const pill = $("#source-pill");
  if (!pill) return;
  pill.className = "source-pill " + state.design.source;
  pill.textContent = state.design.source === "repo" ? ".agents/design/" : "starter (not saved)";
}

async function load() {
  const data = await api("/api/design");
  await whenDSComp();
  state.design = data.design;
  state.tokens = JSON.parse(JSON.stringify(data.design.tokens || {}));
  state.componentsDoc = JSON.parse(JSON.stringify(data.design.componentsDoc || { meta: { version: 1 }, components: [] }));
  if (!pageRegistry().some((page) => page.id === state.page)) state.page = "brand";
  state.dirty = false;
  state.componentsDirty = false;
  state.selection = null;
  state.componentPast = [];
  state.componentFuture = [];
  checkComponentPreviews(state.componentsDoc);
  applyVars();
  updateSourcePill();
  await render();
  const save = $("#save-btn"); if (save) { save.disabled = true; save.textContent = state.design.source === "repo" ? "Saved" : "Save to repo"; }
}

function connectEvents() {
  try {
    const es = new EventSource("/events");
    es.addEventListener("changed", () => { if (!state.dirty && !state.componentsDirty) load(); });
  } catch { /* SSE optional */ }
}

window.addEventListener("DOMContentLoaded", () => {
  $("#save-btn").addEventListener("click", doSave);
  $("#reload-btn").addEventListener("click", () => load());
  $("#validate-btn")?.addEventListener("click", doValidate);
  $("#inspect-btn")?.addEventListener("click", async () => {
    state.inspectMode = !state.inspectMode;
    $("#inspect-btn").classList.toggle("is-active", state.inspectMode);
    $("#inspect-btn").setAttribute("aria-pressed", String(state.inspectMode));
    $("#design-inspector").hidden = !state.inspectMode;
    $("#component-layers").hidden = !state.inspectMode;
    document.body.classList.toggle("inspect-mode", state.inspectMode);
    document.body.classList.toggle("inspect-open", state.inspectMode);
    if (state.inspectMode && !state.selection && state.componentsDoc?.components?.[0]?.root) {
      state.page = "components";
      const node = state.componentsDoc.components[0].root;
      state.selection = {
        file: "components.jsonc",
        path: ["components", 0, "root"],
        label: componentLayerLabel(node).detail,
        value: node,
      };
      await render();
      postDesignSelection();
    } else {
      renderInspector();
    }
    positionValidationSlot();
  });
  const app = $("#app");
  app.addEventListener("pointerdown", beginFreeformDrag, true);
  window.addEventListener("pointermove", moveFreeformDrag, true);
  window.addEventListener("pointerup", (event) => finishFreeformDrag(event), true);
  window.addEventListener("pointercancel", (event) => finishFreeformDrag(event, true), true);
  window.addEventListener("blur", cancelFreeformDrag);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelFreeformDrag();
  });
  app.addEventListener("click", (event) => {
    if (!state.inspectMode) return;
    if (Date.now() < state.suppressInspectClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const renderedNode = event.target.closest("[data-ds-node-path]");
    if (renderedNode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const path = renderedNodePath(renderedNode);
      if (!path) return;
      selectDesignPath("components.jsonc", path, `Layer: ${renderedNode.dataset.dsNodeId || renderedNode.localName}`);
      return;
    }
    const target = event.target.closest("[data-design-inspect]");
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectDesignElement(target);
  }, true);
  $("#inspect-apply-btn")?.addEventListener("click", applyInspectorJson);
  $("#inspect-attach-btn")?.addEventListener("click", attachDesignSelection);
  $("#properties-tab")?.addEventListener("click", () => setInspectorTab("properties"));
  $("#json-tab")?.addEventListener("click", () => setInspectorTab("json"));
  $("#layers-undo-btn")?.addEventListener("click", () => restoreComponentHistory("undo"));
  $("#layers-redo-btn")?.addEventListener("click", () => restoreComponentHistory("redo"));
  $("#layers-duplicate-btn")?.addEventListener("click", () => {
    if (!state.selection?.path) return;
    commitComponentMutation(() => window.DSComp.duplicateComponentNode(state.componentsDoc, state.selection.path));
  });
  $("#layers-delete-btn")?.addEventListener("click", () => {
    if (!state.selection?.path || !window.confirm("Delete this layer? You can undo this change until the canvas reloads.")) return;
    commitComponentMutation(() => window.DSComp.removeComponentNode(state.componentsDoc, state.selection.path));
  });
  $("#export-btn")?.addEventListener("click", doExport);
  $("#publish-btn")?.addEventListener("click", () => {
    $("#export-menu").hidden = true;
    $("#export-menu-btn").setAttribute("aria-expanded", "false");
    doPublish();
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
  document.addEventListener("keydown", (event) => {
    if (state.freeformDrag) return;
    if (!state.inspectMode || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.target.closest("input, textarea, select")) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      restoreComponentHistory("undo");
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      restoreComponentHistory("redo");
    }
  });
  for (const b of document.querySelectorAll("#theme-switch .theme-btn")) {
    b.addEventListener("click", () => setTheme(b.dataset.theme));
  }
  window.addEventListener("resize", positionValidationSlot);
  load().catch((e) => { $("#app").textContent = "Failed to load design system: " + e.message; });
  connectEvents();
});
