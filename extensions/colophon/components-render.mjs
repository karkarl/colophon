// components-render.mjs — browser ESM. Turns the pure element specs from componentsio
// into DOM, and exposes a small window.DSComp API the two canvas clients use to render
// components.jsonc without React or Babel. Loaded as <script type="module"> by the
// canvas shells, which is why it also stamps window.DSComp for the classic client scripts.
import {
  expandInstance,
  componentNames,
  getComponentMap,
  validateComponentsDoc,
} from "./componentsio.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

// Render a normalized spec ({ tag, class, attrs, children } | string) into a DOM node.
// SVG elements must be created in the SVG namespace (document.createElement would make
// an inert HTML element), so once we enter an <svg> we keep creating descendants there.
function specToDom(spec, inSvg = false) {
  if (spec == null) return null;
  if (typeof spec === "string") return document.createTextNode(spec);
  const tag = spec.tag || "div";
  const svg = inSvg || tag === "svg";
  const node = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (spec.class) {
    if (svg) node.setAttribute("class", spec.class);
    else node.className = spec.class;
  }
  for (const [k, v] of Object.entries(spec.attrs || {})) {
    if (v != null) node.setAttribute(k, String(v));
  }
  for (const kid of spec.children || []) {
    const dom = specToDom(kid, svg);
    if (dom) node.append(dom);
  }
  return node;
}

// Expand a component instance (by name, with props) and render it to DOM.
function renderComponent(doc, name, props) {
  return specToDom(expandInstance(doc, name, props || {}));
}

const DSComp = {
  expandInstance,
  componentNames,
  getComponentMap,
  validateComponentsDoc,
  specToDom,
  renderComponent,
};

if (typeof window !== "undefined") window.DSComp = DSComp;

export default DSComp;
export { specToDom, renderComponent };
