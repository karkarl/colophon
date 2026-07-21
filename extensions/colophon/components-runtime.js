// Browser-only component runtime for prototype exports. It intentionally mirrors the
// pure component expansion logic so exported files do not depend on ESM imports.
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";

  function componentList(doc) {
    return Array.isArray(doc?.components) ? doc.components.filter((component) => component?.name) : [];
  }

  function componentNames(doc) {
    return componentList(doc).map((component) => component.name);
  }

  function getComponentMap(doc) {
    const map = Object.create(null);
    for (const component of componentList(doc)) map[component.name] = component;
    return map;
  }

  function interpolate(value, props) {
    if (typeof value !== "string") return value;
    return value
      .replace(/\{\{|\}\}|\{(\w+)\}/g, (match, key) => {
        if (match === "{{") return "\u0001";
        if (match === "}}") return "\u0002";
        return key in props && props[key] != null ? String(props[key]) : match;
      })
      .replace(/\u0001/g, "{")
      .replace(/\u0002/g, "}");
  }

  function resolveProps(rawProps, parentProps) {
    return Object.fromEntries(
      Object.entries(rawProps || {}).map(([key, value]) => [key, typeof value === "string" ? interpolate(value, parentProps) : value]),
    );
  }

  function expandInstance(doc, name, callerProps = {}, seen = []) {
    const component = getComponentMap(doc)[name];
    if (!component) return { tag: "div", class: "ds-missing", attrs: {}, children: [`Unknown component "${name}"`] };
    if (seen.includes(name)) return { tag: "div", class: "ds-missing", attrs: {}, children: [`Recursive component "${name}"`] };
    return expandNode(doc, component.root, { ...(component.props || {}), ...(callerProps || {}) }, [...seen, name]);
  }

  function expandNode(doc, node, props, seen = []) {
    if (node == null) return null;
    if (typeof node === "string") return interpolate(node, props);
    if (typeof node !== "object") return String(node);
    if ("component" in node) return expandInstance(doc, node.component, resolveProps(node.props, props), seen);

    const spec = {
      tag: typeof node.el === "string" && node.el ? node.el : "div",
      class: node.class == null ? null : interpolate(node.class, props),
      attrs: {},
      children: [],
    };
    for (const [key, value] of Object.entries(node.attrs || {})) spec.attrs[key] = typeof value === "string" ? interpolate(value, props) : value;
    for (const child of Array.isArray(node.children) ? node.children : node.children == null ? [] : [node.children]) {
      const expanded = expandNode(doc, child, props, seen);
      if (expanded != null) spec.children.push(expanded);
    }
    return spec;
  }

  function specToDom(spec, inSvg = false) {
    if (spec == null) return null;
    if (typeof spec === "string") return document.createTextNode(spec);
    const svg = inSvg || spec.tag === "svg";
    const node = svg ? document.createElementNS(SVG_NS, spec.tag || "div") : document.createElement(spec.tag || "div");
    if (spec.class) node.setAttribute("class", spec.class);
    for (const [key, value] of Object.entries(spec.attrs || {})) if (value != null) node.setAttribute(key, String(value));
    for (const child of spec.children || []) {
      const childNode = specToDom(child, svg);
      if (childNode) node.append(childNode);
    }
    return node;
  }

  window.DSComp = {
    componentNames,
    getComponentMap,
    expandInstance,
    specToDom,
    renderComponent(doc, name, props) { return specToDom(expandInstance(doc, name, props || {})); },
  };
}());
