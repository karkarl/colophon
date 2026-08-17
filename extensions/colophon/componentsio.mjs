// componentsio.mjs — the components.jsonc format: parse, serialize, validate, and the
// pure interpolation resolver that turns a component instance into a normalized element
// spec ({ tag, class, attrs, children }). No DOM and no Node built-ins, so it runs in
// both the extension host (loading/validation) and the canvas iframes (rendering), and
// is unit-testable in plain Node.
//
// A component is a named template with declared prop defaults and one root node:
//   { "name": "Button", "props": { "variant": "primary" }, "root": <node> }
// Node kinds: element { id, el, class, attrs, layout, margin, children },
// component { id, component, props, layout, margin }, string (literal or "{prop}").
// Layout spacing values are design.json spacing-token names, never raw CSS lengths.

export const COMPONENTS_FILENAME = "components.jsonc";

// ---- JSONC + (de)serialization -------------------------------------------

// Strip // line and /* */ block comments without touching those sequences inside
// strings. Shared shape with prototypeio.stripJsonc; kept local so this module has
// no cross-imports and stays isomorphic.
export function stripJsonc(text) {
  let out = "";
  let inStr = false, quote = "", inLine = false, inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLine) { if (c === "\n") { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (c === "\\") { out += n; i++; continue; }
      if (c === quote) { inStr = false; }
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

export function parseComponents(text) {
  if (!text || !text.trim()) return emptyComponents();
  const doc = JSON.parse(stripJsonc(text));
  return normalizeDoc(doc);
}

export function emptyComponents() {
  return { meta: { version: 1 }, components: [] };
}

export function normalizeDoc(doc) {
  const d = doc && typeof doc === "object" ? doc : {};
  return {
    meta: d.meta && typeof d.meta === "object" ? d.meta : { version: 1 },
    components: Array.isArray(d.components) ? d.components : [],
  };
}

// Stable, pretty JSON (comments are not preserved on save, same as prototypes.jsonc).
export function serializeComponents(doc) {
  return JSON.stringify(normalizeDoc(doc), null, 2) + "\n";
}

// ---- introspection --------------------------------------------------------

export function componentList(doc) {
  return normalizeDoc(doc).components.filter((c) => c && typeof c === "object" && c.name);
}

export function componentNames(doc) {
  return componentList(doc).map((c) => c.name);
}

export function getComponentMap(doc) {
  const map = Object.create(null);
  for (const c of componentList(doc)) map[c.name] = c;
  return map;
}

// ---- validation -----------------------------------------------------------

const LAYOUT_MODES = new Set(["none", "vertical", "horizontal", "grid"]);
const ALIGN_VALUES = new Set(["start", "center", "end", "stretch", "baseline"]);
const JUSTIFY_VALUES = new Set(["start", "center", "end", "space-between", "space-around", "space-evenly"]);
const SIZE_VALUES = new Set(["fill", "hug"]);

function validSpace(value) {
  return typeof value === "string" && (value === "0" || value === "auto" || /^[A-Za-z0-9_-]+$/.test(value));
}

function validateBox(value, where, errors) {
  if (value == null) return;
  if (validSpace(value)) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${where}: must be a spacing-token name or a box object.`);
    return;
  }
  const allowed = new Set(["x", "y", "top", "right", "bottom", "left"]);
  for (const [key, spacing] of Object.entries(value)) {
    if (!allowed.has(key)) errors.push(`${where}: unknown box edge "${key}".`);
    else if (!validSpace(spacing)) errors.push(`${where}.${key}: must be a spacing-token name.`);
  }
}

function validateAutoLayout(node, where, errors) {
  validateBox(node.margin, `${where}.margin`, errors);
  if (node.layout == null) return;
  if (!node.layout || typeof node.layout !== "object" || Array.isArray(node.layout)) {
    errors.push(`${where}.layout: must be an object.`);
    return;
  }
  const layout = node.layout;
  const allowed = new Set(["mode", "gap", "padding", "align", "justify", "wrap", "grow", "columns", "width", "height"]);
  for (const key of Object.keys(layout)) {
    if (!allowed.has(key)) errors.push(`${where}.layout: unknown property "${key}".`);
  }
  if (layout.mode != null && !LAYOUT_MODES.has(layout.mode)) errors.push(`${where}.layout.mode: must be none, vertical, horizontal, or grid.`);
  if (layout.gap != null && !validSpace(layout.gap)) errors.push(`${where}.layout.gap: must be a spacing-token name.`);
  validateBox(layout.padding, `${where}.layout.padding`, errors);
  if (layout.align != null && !ALIGN_VALUES.has(layout.align)) errors.push(`${where}.layout.align: unsupported value "${layout.align}".`);
  if (layout.justify != null && !JUSTIFY_VALUES.has(layout.justify)) errors.push(`${where}.layout.justify: unsupported value "${layout.justify}".`);
  if (layout.wrap != null && typeof layout.wrap !== "boolean") errors.push(`${where}.layout.wrap: must be boolean.`);
  if (layout.grow != null && typeof layout.grow !== "boolean") errors.push(`${where}.layout.grow: must be boolean.`);
  if (layout.columns != null && (!Number.isInteger(layout.columns) || layout.columns < 1)) errors.push(`${where}.layout.columns: must be a positive integer.`);
  if (layout.columns != null && layout.mode !== "grid") errors.push(`${where}.layout.columns: is only valid for grid layout.`);
  for (const dimension of ["width", "height"]) {
    if (layout[dimension] != null && !SIZE_VALUES.has(layout[dimension])) {
      errors.push(`${where}.layout.${dimension}: must be fill or hug.`);
    }
  }
}

export function validateComponentsDoc(doc, { text = null } = {}) {
  const errors = [];
  const warnings = [];
  let d;
  if (text != null) {
    try { d = parseComponents(text); }
    catch (err) {
      errors.push(`components.jsonc is not valid JSON: ${String(err && err.message ? err.message : err)}`);
      return { ok: false, errors, warnings, names: [] };
    }
  } else {
    d = normalizeDoc(doc);
  }

  if (!d.components.length) {
    warnings.push("components.jsonc defines no components (nothing will render in the canvas).");
    return { ok: true, errors, warnings, names: [] };
  }

  const names = [];
  const seenNames = new Set();
  for (let i = 0; i < d.components.length; i++) {
    const c = d.components[i];
    const where = c && c.name ? `component "${c.name}"` : `component #${i + 1}`;
    if (!c || typeof c !== "object") { errors.push(`${where}: must be an object.`); continue; }
    if (!c.name || typeof c.name !== "string") { errors.push(`${where}: missing a string "name".`); continue; }
    if (seenNames.has(c.name)) errors.push(`Duplicate component name "${c.name}".`);
    seenNames.add(c.name);
    names.push(c.name);
    if (!c.root || typeof c.root !== "object") { errors.push(`${where}: missing a "root" node.`); continue; }
  }

  // Structural walk: known node kinds, and component refs resolve to a defined name.
  const nameSet = new Set(names);
  const requiresIds = Number(d.meta?.version || 0) >= 2;
  for (const c of d.components) {
    if (!c || !c.root) continue;
    const ids = new Set();
    walkNode(c.root, (node, path) => {
      if (typeof node === "string") return;
      if (node == null || typeof node !== "object") {
        errors.push(`${c.name}${path}: node must be a string, element, or component reference.`);
        return;
      }
      const where = `${c.name}${path}`;
      if (requiresIds && (typeof node.id !== "string" || !node.id)) errors.push(`${where}: missing a stable string "id" (required in components.jsonc v2).`);
      if (typeof node.id === "string" && node.id) {
        if (ids.has(node.id)) errors.push(`${c.name}: duplicate node id "${node.id}".`);
        ids.add(node.id);
      }
      validateAutoLayout(node, where, errors);
      if ("component" in node) {
        if (!node.component || !nameSet.has(node.component)) {
          errors.push(`${where}: references component "${node.component}" which is not defined.`);
        }
        return;
      }
      if ("el" in node) {
        if (typeof node.el !== "string" || !node.el) errors.push(`${where}: "el" must be a non-empty tag name.`);
        return;
      }
      errors.push(`${where}: node needs one of "el" (element) or "component" (reference).`);
    });
  }

  return { ok: errors.length === 0, errors, warnings, names };
}

function walkNode(node, fn, path = ".root") {
  fn(node, path);
  if (node && typeof node === "object" && Array.isArray(node.children)) {
    node.children.forEach((kid, i) => walkNode(kid, fn, `${path}.children[${i}]`));
  }
}

// ---- interpolation + resolver (pure) --------------------------------------

// Replace "{prop}" with the prop's value; "{{" / "}}" are literal braces. Unknown
// props are left as-is so authoring mistakes are visible rather than silently blank.
export function interpolate(str, props) {
  if (typeof str !== "string") return str;
  return str
    .replace(/\{\{|\}\}|\{(\w+)\}/g, (m, key) => {
      if (m === "{{") return "\u0001";
      if (m === "}}") return "\u0002";
      return key in props && props[key] != null ? String(props[key]) : m;
    })
    .replace(/\u0001/g, "{").replace(/\u0002/g, "}");
}

function resolveProps(rawProps, parentProps) {
  const out = {};
  for (const [k, v] of Object.entries(rawProps || {})) {
    out[k] = typeof v === "string" ? interpolate(v, parentProps) : v;
  }
  return out;
}

function spacingValue(value) {
  if (value === "0") return "0";
  if (value === "auto") return "auto";
  return `var(--space-${value})`;
}

function applyBox(style, prefix, value) {
  if (value == null) return;
  if (typeof value === "string") {
    style[prefix] = spacingValue(value);
    return;
  }
  const x = value.x;
  const y = value.y;
  const edges = {
    top: value.top ?? y,
    right: value.right ?? x,
    bottom: value.bottom ?? y,
    left: value.left ?? x,
  };
  for (const [edge, spacing] of Object.entries(edges)) {
    if (spacing != null) style[`${prefix}-${edge}`] = spacingValue(spacing);
  }
}

const ALIGN_CSS = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };
const JUSTIFY_CSS = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  "space-between": "space-between",
  "space-around": "space-around",
  "space-evenly": "space-evenly",
};

export function autoLayoutStyle(node) {
  const style = {};
  const layout = node?.layout;
  if (layout && typeof layout === "object") {
    if (layout.mode === "vertical" || layout.mode === "horizontal") {
      style.display = "flex";
      style["flex-direction"] = layout.mode === "vertical" ? "column" : "row";
    } else if (layout.mode === "grid") {
      style.display = "grid";
      style["grid-template-columns"] = `repeat(${layout.columns || 1}, minmax(0, 1fr))`;
    }
    if (layout.gap != null) style.gap = spacingValue(layout.gap);
    applyBox(style, "padding", layout.padding);
    if (layout.align) style["align-items"] = ALIGN_CSS[layout.align] || layout.align;
    if (layout.justify) style["justify-content"] = JUSTIFY_CSS[layout.justify] || layout.justify;
    if (layout.wrap) style["flex-wrap"] = "wrap";
    if (layout.grow) {
      style["flex-grow"] = "1";
      style["min-width"] = "0";
      style["min-height"] = "0";
    }
    if (layout.width === "fill") style.width = "100%";
    else if (layout.width === "hug") style.width = "fit-content";
    if (layout.height === "fill") style.height = "100%";
    else if (layout.height === "hug") style.height = "fit-content";
  }
  applyBox(style, "margin", node?.margin);
  return style;
}

function mergeNodeStyle(spec, node, source) {
  if (!spec || typeof spec === "string") return spec;
  return {
    ...spec,
    style: { ...(spec.style || {}), ...autoLayoutStyle(node) },
    source,
  };
}

// Expand a component instance into a normalized spec tree:
//   element -> { tag, class, attrs, children: [spec|string] }
//   string  -> string (interpolated)
// Component references are expanded inline. Recursion is guarded against cycles.
export function expandInstance(doc, name, callerProps = {}, seen = []) {
  const map = getComponentMap(doc);
  const comp = map[name];
  if (!comp) return { tag: "div", class: "ds-missing", attrs: {}, children: [`⚠ unknown component "${name}"`] };
  if (seen.includes(name)) return { tag: "div", class: "ds-missing", attrs: {}, children: [`⚠ recursive component "${name}"`] };
  const props = { ...(comp.props || {}), ...(callerProps || {}) };
  const componentIndex = normalizeDoc(doc).components.indexOf(comp);
  return expandNode(doc, comp.root, props, [...seen, name], { component: name, path: ["components", componentIndex, "root"], nodeId: comp.root?.id || null });
}

export function expandNode(doc, node, props, seen = [], source = null) {
  if (node == null) return null;
  if (typeof node === "string") return interpolate(node, props);
  if (typeof node !== "object") return String(node);

  if ("component" in node) {
    return mergeNodeStyle(
      expandInstance(doc, node.component, resolveProps(node.props, props), seen),
      node,
      source ? { ...source, nodeId: node.id || null } : null,
    );
  }

  const spec = {
    tag: typeof node.el === "string" && node.el ? node.el : "div",
    class: null,
    attrs: {},
    style: autoLayoutStyle(node),
    source: source ? { ...source, nodeId: node.id || null } : null,
    children: [],
  };
  if (node.class != null) spec.class = interpolate(node.class, props);
  for (const [k, v] of Object.entries(node.attrs || {})) {
    spec.attrs[k] = typeof v === "string" ? interpolate(v, props) : v;
  }
  const kids = Array.isArray(node.children) ? node.children : (node.children != null ? [node.children] : []);
  for (const [index, kid] of kids.entries()) {
    const childSource = source && typeof kid === "object" && kid != null
      ? { component: source.component, path: [...source.path, "children", index], nodeId: kid.id || null }
      : null;
    const r = expandNode(doc, kid, props, seen, childSource);
    if (r != null) spec.children.push(r);
  }
  return spec;
}
