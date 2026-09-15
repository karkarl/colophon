// components-render.mjs — browser ESM. Turns the pure element specs from componentsio
// into DOM, and exposes a small window.DSComp API the two canvas clients use to render
// components.jsonc without React or Babel. Loaded as <script type="module"> by the
// canvas shells, which is why it also stamps window.DSComp for the classic client scripts.
import {
  expandInstance,
  componentNames,
  getComponentMap,
  validateComponentsDoc,
  findComponentNodePath,
  moveComponentNode,
  duplicateComponentNode,
  removeComponentNode,
} from "./componentsio.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

// Render a normalized spec ({ tag, class, attrs, children } | string) into a DOM node.
// SVG elements must be created in the SVG namespace (document.createElement would make
// an inert HTML element), so once we enter an <svg> we keep creating descendants there.
function specToDom(spec, inSvg = false, context = null) {
  if (!context) {
    const ctx = window.DSInteractions.createContext(() => { throw new Error("Flyouts require renderComponent with a component document."); });
    return window.DSInteractions.mount(specToDom(spec, inSvg, ctx), ctx);
  }
  if (spec == null) return null;
  if (typeof spec === "string") return document.createTextNode(spec);
  const tag = spec.tag || "div";
  const svg = inSvg || tag === "svg";
  const node = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (spec.class) {
    if (svg) node.setAttribute("class", spec.class);
    else node.className = spec.class;
  }
  for (const [property, value] of Object.entries(spec.style || {})) {
    node.style.setProperty(property, String(value));
  }
  for (const [k, v] of Object.entries(spec.attrs || {})) {
    if (v != null && !(v === false && ["disabled", "checked", "readonly", "multiple"].includes(k))) node.setAttribute(k, String(v));
  }
  // Internal selection metadata must not be replaceable by authored attributes.
  if (spec.source) {
    node.dataset.dsComponent = spec.source.component || "";
    node.dataset.dsNodePath = JSON.stringify(spec.source.path || []);
    if (spec.source.nodeId) node.dataset.dsNodeId = spec.source.nodeId;
    else delete node.dataset.dsNodeId;
  }
  for (const kid of spec.children || []) {
    const dom = specToDom(kid, svg, context);
    if (dom) node.append(dom);
  }
  if (!svg) window.DSInteractions.attach(node, spec, context);
  return node;
}

// Expand a component instance (by name, with props) and render it to DOM.
function renderComponent(doc, name, props, options = {}) {
  const interactions = window.DSInteractions;
  const context = interactions.createContext((target, opts) => {
    if (!Object.hasOwn(getComponentMap(doc), target)) throw new Error(`Unknown flyout component "${target}".`);
    return renderComponent(doc, target, {}, opts);
  }, options);
  return interactions.mount(specToDom(expandInstance(doc, name, props || {}), false, context), context);
}

const DSComp = {
  expandInstance,
  componentNames,
  getComponentMap,
  validateComponentsDoc,
  findComponentNodePath,
  moveComponentNode,
  duplicateComponentNode,
  removeComponentNode,
  specToDom,
  renderComponent,
};

if (typeof window !== "undefined") window.DSComp = DSComp;

export default DSComp;
export { specToDom, renderComponent };
