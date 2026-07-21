// componentsio.mjs — the components.jsonc format: parse, serialize, validate, and the
// pure interpolation resolver that turns a component instance into a normalized element
// spec ({ tag, class, attrs, children }). No DOM and no Node built-ins, so it runs in
// both the extension host (loading/validation) and the canvas iframes (rendering), and
// is unit-testable in plain Node.
//
// A component is a named template with declared prop defaults and one root node:
//   { "name": "Button", "props": { "variant": "primary" }, "root": <node> }
// Node kinds: element { el, class, attrs, children }, component { component, props },
// string (literal or "{prop}").

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

const NODE_ELEMENT_KEYS = ["el", "class", "attrs", "children"];

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
  for (const c of d.components) {
    if (!c || !c.root) continue;
    walkNode(c.root, (node, path) => {
      if (typeof node === "string") return;
      if (node == null || typeof node !== "object") {
        errors.push(`${c.name}${path}: node must be a string, element, or component reference.`);
        return;
      }
      if ("component" in node) {
        if (!node.component || !nameSet.has(node.component)) {
          errors.push(`${c.name}${path}: references component "${node.component}" which is not defined.`);
        }
        return;
      }
      if ("el" in node) {
        if (typeof node.el !== "string" || !node.el) errors.push(`${c.name}${path}: "el" must be a non-empty tag name.`);
        return;
      }
      errors.push(`${c.name}${path}: node needs one of "el" (element) or "component" (reference).`);
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
  return expandNode(doc, comp.root, props, [...seen, name]);
}

export function expandNode(doc, node, props, seen = []) {
  if (node == null) return null;
  if (typeof node === "string") return interpolate(node, props);
  if (typeof node !== "object") return String(node);

  if ("component" in node) {
    return expandInstance(doc, node.component, resolveProps(node.props, props), seen);
  }

  const spec = { tag: typeof node.el === "string" && node.el ? node.el : "div", class: null, attrs: {}, children: [] };
  if (node.class != null) spec.class = interpolate(node.class, props);
  for (const [k, v] of Object.entries(node.attrs || {})) {
    spec.attrs[k] = typeof v === "string" ? interpolate(v, props) : v;
  }
  const kids = Array.isArray(node.children) ? node.children : (node.children != null ? [node.children] : []);
  for (const kid of kids) {
    const r = expandNode(doc, kid, props, seen);
    if (r != null) spec.children.push(r);
  }
  return spec;
}
