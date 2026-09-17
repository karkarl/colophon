// componentsio.mjs — the components.jsonc format: parse, serialize, validate, and the
// pure interpolation resolver that turns a component instance into a normalized element
// spec ({ tag, class, attrs, children }). No DOM and no Node built-ins, so it runs in
// both the extension host (loading/validation) and the canvas iframes (rendering), and
// is unit-testable in plain Node.
//
// A component is a named template with declared prop defaults and one root node:
//   { "name": "Button", "props": { "variant": "primary" }, "root": <node> }
// Node kinds: element { id, el, class, attrs, layout, position, margin, appearance, children },
// component { id, component, props, layout, position, margin, appearance }, string (literal or "{prop}").
// Layout spacing uses design.json tokens by default; non-negative numbers are
// explicit unsnapped pixel values. In v3, a freeform parent establishes a coordinate
// system for children with absolute, parent-relative positions.

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

// ---- layer editing ---------------------------------------------------------

function valueAtPath(root, path) {
  let value = root;
  for (const part of path || []) {
    if (value == null || !(part in value)) return undefined;
    value = value[part];
  }
  return value;
}

function isPathPrefix(parent, child) {
  return parent.length <= child.length && parent.every((part, index) => part === child[index]);
}

export function findComponentNodePath(doc, componentIndex, match) {
  const root = normalizeDoc(doc).components[componentIndex]?.root;
  if (root == null) return null;
  const visit = (node, path) => {
    if (node === match || (typeof match === "string" && node && typeof node === "object" && node.id === match)) return path;
    if (!node || typeof node !== "object" || !Array.isArray(node.children)) return null;
    for (const [index, child] of node.children.entries()) {
      const found = visit(child, [...path, "children", index]);
      if (found) return found;
    }
    return null;
  };
  return visit(root, ["components", componentIndex, "root"]);
}

function editableChild(doc, path) {
  if (!Array.isArray(path) || path.length < 5 || path[path.length - 2] !== "children") {
    throw new Error("Component roots cannot be moved, duplicated, or deleted.");
  }
  const parent = valueAtPath(doc, path.slice(0, -1));
  const node = valueAtPath(doc, path);
  if (!Array.isArray(parent) || !node || typeof node !== "object") throw new Error("The selected component layer no longer exists.");
  return { parent, node };
}

export function moveComponentNode(doc, sourcePath, targetPath, placement = "before") {
  if (!["before", "after", "inside"].includes(placement)) throw new Error(`Unsupported layer placement "${placement}".`);
  if (sourcePath?.[1] !== targetPath?.[1]) throw new Error("Layers can only move within the same component.");
  const { parent: sourceParent, node: sourceNode } = editableChild(doc, sourcePath);
  if (isPathPrefix(sourcePath, targetPath)) throw new Error("A layer cannot move into itself.");
  const targetNode = valueAtPath(doc, targetPath);
  if (!targetNode || typeof targetNode !== "object") throw new Error("Layers can only be dropped on element or component layers.");
  if (placement === "inside" && !("el" in targetNode)) throw new Error("Only element layers can contain children.");
  if (placement !== "inside") {
    const targetParent = valueAtPath(doc, targetPath.slice(0, -1));
    if (!Array.isArray(targetParent)) throw new Error("Component roots cannot be reordered.");
  }

  sourceParent.splice(sourceParent.indexOf(sourceNode), 1);
  if (placement === "inside") {
    const children = Array.isArray(targetNode.children) ? targetNode.children : (targetNode.children = []);
    children.push(sourceNode);
  } else {
    const freshTargetPath = findComponentNodePath(doc, targetPath[1], targetNode);
    const targetParent = freshTargetPath && valueAtPath(doc, freshTargetPath.slice(0, -1));
    if (!freshTargetPath || !Array.isArray(targetParent)) throw new Error("The target layer no longer exists.");
    const targetIndex = targetParent.indexOf(targetNode);
    targetParent.splice(targetIndex + (placement === "after" ? 1 : 0), 0, sourceNode);
  }
  return findComponentNodePath(doc, sourcePath[1], sourceNode);
}

function collectNodeIds(node, ids) {
  if (!node || typeof node !== "object") return;
  if (typeof node.id === "string" && node.id) ids.add(node.id);
  for (const child of Array.isArray(node.children) ? node.children : []) collectNodeIds(child, ids);
}

function uniqueCopyId(id, ids) {
  const base = `${id || "layer"}-copy`;
  let next = base;
  let suffix = 2;
  while (ids.has(next)) next = `${base}-${suffix++}`;
  ids.add(next);
  return next;
}

export function duplicateComponentNode(doc, sourcePath) {
  const { parent, node } = editableChild(doc, sourcePath);
  const component = normalizeDoc(doc).components[sourcePath[1]];
  const ids = new Set();
  collectNodeIds(component?.root, ids);
  const copy = JSON.parse(JSON.stringify(node));
  const refreshIds = (value) => {
    if (!value || typeof value !== "object") return;
    value.id = uniqueCopyId(value.id, ids);
    for (const child of Array.isArray(value.children) ? value.children : []) refreshIds(child);
  };
  refreshIds(copy);
  parent.splice(parent.indexOf(node) + 1, 0, copy);
  return findComponentNodePath(doc, sourcePath[1], copy);
}

export function removeComponentNode(doc, sourcePath) {
  const { parent, node } = editableChild(doc, sourcePath);
  const index = parent.indexOf(node);
  parent.splice(index, 1);
  const parentPath = sourcePath.slice(0, -2);
  return valueAtPath(doc, parentPath) ? parentPath : ["components", sourcePath[1], "root"];
}

// ---- validation -----------------------------------------------------------

const LAYOUT_MODES = new Set(["none", "vertical", "horizontal", "grid", "freeform"]);
const ALIGN_VALUES = new Set(["start", "center", "end", "stretch", "baseline"]);
const JUSTIFY_VALUES = new Set(["start", "center", "end", "space-between", "space-around", "space-evenly"]);
const SIZE_VALUES = new Set(["fill", "hug"]);
const FONT_FAMILY_VALUES = new Set(["display", "body", "mono"]);
const TEXT_ALIGN_VALUES = new Set(["start", "center", "end", "left", "right"]);
const APPEARANCE_KEYS = new Set(["fontFamily", "textStyle", "color", "background", "borderColor", "borderWidth", "radius", "shadow", "textAlign"]);
const COLOR_KEYS = new Set(["color", "background", "borderColor"]);
const NONE_KEYS = new Set(["color", "background", "borderColor", "radius", "shadow"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const APPEARANCE_NONE = "$none";
const STATE_NAMES = new Set(["hover", "pressed", "hoverPressed", "disabled"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validateInteraction(node, where, errors, tokens, map) {
  if (node.states != null) {
    if (!object(node.states)) errors.push(`${where}.states: must be an object.`);
    else for (const [state, appearance] of Object.entries(node.states)) {
      if (!STATE_NAMES.has(state)) errors.push(`${where}.states: unknown state "${state}".`);
      if (!object(appearance)) errors.push(`${where}.states.${state}: must be an appearance object.`);
      else {
        const stateErrors = [];
        validateAppearance({ appearance }, where, stateErrors, tokens);
        errors.push(...stateErrors.map((error) => error.replace(`${where}.appearance`, `${where}.states.${state}`)));
      }
    }
  }
  if (node.on != null) {
    if (!object(node.on) || Object.keys(node.on).some((key) => key !== "click")
      || !object(node.on.click) || Object.keys(node.on.click).some((key) => key !== "open")
      || typeof node.on.click.open !== "string" || !Object.hasOwn(map, node.on.click.open)) {
      errors.push(`${where}.on: expected { click: { open: "DefinedComponentName" } } with a literal component name.`);
    }
  }
  if (node.control == null) return;
  const control = node.control;
  if (!object(control)) { errors.push(`${where}.control: must be an object.`); return; }
  for (const key of Object.keys(control)) {
    if (!["chrome", "focus"].includes(key)) errors.push(`${where}.control: unknown property "${key}".`);
  }
  if (control.chrome != null && control.chrome !== "none") errors.push(`${where}.control.chrome: must be none.`);
  if (control.focus != null) {
    const focus = control.focus;
    const colors = tokenNames(tokens, "colors");
    if (!object(focus) || !["outline", "underline"].includes(focus.kind)
      || Object.keys(focus).some((key) => !["kind", "color"].includes(key))
      || typeof focus.color !== "string" || !/^[A-Za-z0-9_-]+$/.test(focus.color)
      || (colors && !colors.has(focus.color))) {
      errors.push(`${where}.control.focus: requires kind outline or underline and a defined color token.`);
    }
  }
}

function validateResolvedInteractions(spec, where, errors, inSvg = false) {
  if (!spec || typeof spec === "string") return;
  const svg = inSvg || spec.tag === "svg";
  if (svg) {
    for (const key of ["states", "on", "control"]) {
      if (spec[key] != null) errors.push(`${where}.${key}: interaction metadata is not supported in SVG subtrees.`);
    }
  } else if (spec.control) {
    if (spec.control.chrome === "none" && !spec.control.focus) errors.push(`${where}.control: removing chrome requires a visible focus treatment.`);
    const editable = ["true", "plaintext-only", ""].includes(String(spec.attrs?.contenteditable ?? false));
    const textInput = spec.tag === "input" && ["text", "search", "url", "tel", "email", "password", "number"].includes(spec.attrs?.type || "text");
    if (!editable && spec.tag !== "button" && spec.tag !== "textarea" && !textInput) {
      errors.push(`${where}.control: only buttons, textual inputs, textareas, and editable elements support control styling.`);
    }
  }
  for (const [index, child] of (spec.children || []).entries()) {
    validateResolvedInteractions(child, `${where}.children[${index}]`, errors, svg);
  }
}

function validSpace(value) {
  return (typeof value === "number" && Number.isFinite(value) && value >= 0)
    || (typeof value === "string" && (value === "0" || value === "auto" || /^[A-Za-z0-9_-]+$/.test(value)));
}

function validateBox(value, where, errors) {
  if (value == null) return;
  if (validSpace(value)) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${where}: must be a spacing-token name, a non-negative pixel number, or a box object.`);
    return;
  }
  const allowed = new Set(["x", "y", "top", "right", "bottom", "left"]);
  for (const [key, spacing] of Object.entries(value)) {
    if (!allowed.has(key)) errors.push(`${where}: unknown box edge "${key}".`);
    else if (!validSpace(spacing)) errors.push(`${where}.${key}: must be a spacing-token name or a non-negative pixel number.`);
  }
}

function tokenNames(tokens, group) {
  if (!tokens) return null;
  if (group === "colors") {
    const colors = tokens.colors;
    return new Set(Array.isArray(colors) ? colors.map((item) => item?.name).filter(Boolean) : Object.keys(colors || {}));
  }
  if (group === "fontFamily") return new Set(Object.entries(tokens.typography || {}).filter(([key, value]) => key !== "scale" && value?.family).map(([key]) => key));
  if (group === "textStyle") return new Set((tokens.typography?.scale || []).map((item) => item?.name).filter(Boolean));
  return new Set((tokens[group] || []).map((item) => item?.name).filter(Boolean));
}

function validateAppearance(node, where, errors, tokens) {
  if (node.appearance == null) return;
  if (!node.appearance || typeof node.appearance !== "object" || Array.isArray(node.appearance)) {
    errors.push(`${where}.appearance: must be an object.`);
    return;
  }
  for (const [key, value] of Object.entries(node.appearance)) {
    if (!APPEARANCE_KEYS.has(key)) {
      errors.push(`${where}.appearance: unknown property "${key}".`);
      continue;
    }
    if (key === "borderWidth") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        errors.push(`${where}.appearance.borderWidth: must be a non-negative finite pixel number.`);
      }
      continue;
    }
    if (typeof value !== "string" || !value) {
      errors.push(`${where}.appearance.${key}: must be a token name.`);
      continue;
    }
    if (key === "fontFamily" && !FONT_FAMILY_VALUES.has(value)) errors.push(`${where}.appearance.fontFamily: must be display, body, or mono.`);
    else if (key === "textAlign" && !TEXT_ALIGN_VALUES.has(value)) errors.push(`${where}.appearance.textAlign: unsupported value "${value}".`);
    else if (value === APPEARANCE_NONE && NONE_KEYS.has(key)) continue;
    else if (COLOR_KEYS.has(key) && HEX_COLOR.test(value)) continue;
    else if (!/^[A-Za-z0-9_-]+$/.test(value)) errors.push(`${where}.appearance.${key}: must be a token name.`);
  }
  if (!tokens) return;
  const groups = {
    fontFamily: "fontFamily",
    textStyle: "textStyle",
    color: "colors",
    background: "colors",
    borderColor: "colors",
    radius: "radii",
    shadow: "shadows",
  };
  for (const [key, group] of Object.entries(groups)) {
    const value = node.appearance[key];
    const names = tokenNames(tokens, group);
    if (value && names && !(value === APPEARANCE_NONE && NONE_KEYS.has(key)) && !(COLOR_KEYS.has(key) && HEX_COLOR.test(value)) && !names.has(value)) {
      errors.push(`${where}.appearance.${key}: references unknown ${group} token "${value}".`);
    }
  }
}

function validateAutoLayout(node, where, errors, tokens) {
  validateBox(node.margin, `${where}.margin`, errors);
  validateAppearance(node, where, errors, tokens);
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
  if (layout.mode != null && !LAYOUT_MODES.has(layout.mode)) errors.push(`${where}.layout.mode: must be none, vertical, horizontal, grid, or freeform.`);
  if (layout.gap != null && !validSpace(layout.gap)) errors.push(`${where}.layout.gap: must be a spacing-token name or a non-negative pixel number.`);
  validateBox(layout.padding, `${where}.layout.padding`, errors);
  if (layout.align != null && !ALIGN_VALUES.has(layout.align)) errors.push(`${where}.layout.align: unsupported value "${layout.align}".`);
  if (layout.justify != null && !JUSTIFY_VALUES.has(layout.justify)) errors.push(`${where}.layout.justify: unsupported value "${layout.justify}".`);
  if (layout.wrap != null && typeof layout.wrap !== "boolean") errors.push(`${where}.layout.wrap: must be boolean.`);
  if (layout.grow != null && typeof layout.grow !== "boolean") errors.push(`${where}.layout.grow: must be boolean.`);
  if (layout.columns != null && (!Number.isInteger(layout.columns) || layout.columns < 1)) errors.push(`${where}.layout.columns: must be a positive integer.`);
  if (layout.columns != null && layout.mode !== "grid") errors.push(`${where}.layout.columns: is only valid for grid layout.`);
}

function validatePosition(node, parent, where, errors, version) {
  if (node.position == null) return;
  if (version < 3) errors.push(`${where}.position: requires components.jsonc v3.`);
  if (!node.position || typeof node.position !== "object" || Array.isArray(node.position)) {
    errors.push(`${where}.position: must be an object.`);
    return;
  }
  const allowed = new Set(["mode", "x", "y"]);
  for (const key of Object.keys(node.position)) {
    if (!allowed.has(key)) errors.push(`${where}.position: unknown property "${key}".`);
  }
  if (node.position.mode !== "absolute") errors.push(`${where}.position.mode: must be absolute.`);
  for (const axis of ["x", "y"]) {
    if (typeof node.position[axis] !== "number" || !Number.isFinite(node.position[axis])) {
      errors.push(`${where}.position.${axis}: must be a finite pixel number.`);
    }
  }
  if (node.position.mode === "absolute" && parent?.layout?.mode !== "freeform") {
    errors.push(`${where}.position: absolute nodes must be direct children of a freeform layout.`);
  }
}

export function validateComponentsDoc(doc, { text = null, tokens = null } = {}) {
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
  const map = getComponentMap(d);
  const version = Number(d.meta?.version || 0);
  const requiresIds = version >= 2;
  for (const c of d.components) {
    if (!c || !c.root) continue;
    const ids = new Set();
    walkNode(c.root, (node, path, parent) => {
      if (typeof node === "string") return;
      if (node == null || typeof node !== "object") {
        errors.push(`${c.name}${path}: node must be a string, element, or component reference.`);
        return;
      }
      const where = `${c.name}${path}`;
      if (requiresIds && (typeof node.id !== "string" || !node.id)) errors.push(`${where}: missing a stable string "id" (required in components.jsonc v2+).`);
      if (typeof node.id === "string" && node.id) {
        if (ids.has(node.id)) errors.push(`${c.name}: duplicate node id "${node.id}".`);
        ids.add(node.id);
      }
      validateAutoLayout(node, where, errors, tokens);
      validateInteraction(node, where, errors, tokens, map);
      if (node.layout?.mode === "freeform" && version < 3) errors.push(`${where}.layout.mode: freeform requires components.jsonc v3.`);
      for (const dimension of ["width", "height"]) {
        const value = node.layout?.[dimension];
        if (value != null && !SIZE_VALUES.has(value) && !(version >= 3 && typeof value === "number" && Number.isFinite(value) && value >= 0)) {
          errors.push(`${where}.layout.${dimension}: must be fill or hug${version >= 3 ? ", or a non-negative pixel number" : ""}.`);
        }
      }
      validatePosition(node, parent, where, errors, version);
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

  // Resolve props and reference overrides exactly as rendering does, after shapes are valid.
  if (!errors.length) {
    for (const c of d.components) {
      validateResolvedInteractions(expandInstance(d, c.name), `${c.name}.root`, errors);
    }
  }
  return { ok: errors.length === 0, errors, warnings, names };
}

function walkNode(node, fn, path = ".root", parent = null) {
  fn(node, path, parent);
  if (node && typeof node === "object" && Array.isArray(node.children)) {
    node.children.forEach((kid, i) => walkNode(kid, fn, `${path}.children[${i}]`, node));
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
  if (typeof value === "number") return `${value}px`;
  if (value === "0") return "0";
  if (value === "auto") return "auto";
  return `var(--space-${value})`;
}

function applyBox(style, prefix, value) {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number") {
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
    } else if (layout.mode === "freeform") {
      style.display = "block";
      style.position = "relative";
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
    if (typeof layout.width === "number") style.width = `${layout.width}px`;
    else if (layout.width === "fill") style.width = "100%";
    else if (layout.width === "hug") style.width = "fit-content";
    if (typeof layout.height === "number") style.height = `${layout.height}px`;
    else if (layout.height === "fill") style.height = "100%";
    else if (layout.height === "hug") style.height = "fit-content";
  }
  applyBox(style, "margin", node?.margin);
  if (node?.position?.mode === "absolute") {
    style.position = "absolute";
    style.left = `${node.position.x}px`;
    style.top = `${node.position.y}px`;
  }
  return style;
}

export function appearanceStyle(node) {
  const appearance = node?.appearance;
  if (!appearance || typeof appearance !== "object") return {};
  const style = {};
  if (appearance.textStyle) {
    const prefix = `var(--text-${appearance.textStyle}`;
    style["font-family"] = `${prefix}-family)`;
    style["font-size"] = `${prefix}-size)`;
    style["line-height"] = `${prefix}-line-height)`;
    style["font-weight"] = `${prefix}-weight)`;
    style["letter-spacing"] = `${prefix}-tracking, normal)`;
  }
  if (appearance.fontFamily) style["font-family"] = `var(--font-${appearance.fontFamily})`;
  const colorValue = (value) => value === APPEARANCE_NONE ? "transparent" : (HEX_COLOR.test(value) ? value : `var(--color-${value})`);
  if (appearance.color) style.color = colorValue(appearance.color);
  if (appearance.background) style["background-color"] = colorValue(appearance.background);
  if (appearance.borderColor) style["border-color"] = colorValue(appearance.borderColor);
  if (appearance.borderWidth != null) {
    style["border-width"] = `${appearance.borderWidth}px`;
    style["border-style"] = "solid";
  }
  if (appearance.radius) style["border-radius"] = appearance.radius === APPEARANCE_NONE ? "0" : `var(--radius-${appearance.radius})`;
  if (appearance.shadow) style["box-shadow"] = appearance.shadow === APPEARANCE_NONE ? "none" : `var(--shadow-${appearance.shadow})`;
  if (appearance.textAlign) style["text-align"] = appearance.textAlign;
  return style;
}

function nodeStyle(node) {
  return { ...autoLayoutStyle(node), ...appearanceStyle(node) };
}

function mergeNodeStyle(spec, node, source) {
  if (!spec || typeof spec === "string") return spec;
  return {
    ...spec,
    style: { ...(spec.style || {}), ...nodeStyle(node) },
    ...interactionSpec(node, spec),
    source,
  };
}

function interactionSpec(node, base = {}) {
  const result = {};
  if (node.states != null) {
    result.states = { ...base.states };
    for (const [state, appearance] of Object.entries(node.states)) {
      result.states[state] = { ...base.states?.[state], ...appearanceStyle({ appearance }) };
    }
  }
  if (node.on != null) result.on = node.on;
  if (node.control != null) result.control = { ...base.control, ...node.control };
  return result;
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
    style: nodeStyle(node),
    ...interactionSpec(node),
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
