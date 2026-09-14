// Browser-only component runtime for prototype exports. It intentionally mirrors the
// pure component expansion logic so exported files do not depend on ESM imports.
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const APPEARANCE_NONE = "$none";

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
    const edges = {
      top: value.top ?? value.y,
      right: value.right ?? value.x,
      bottom: value.bottom ?? value.y,
      left: value.left ?? value.x,
    };
    for (const [edge, spacing] of Object.entries(edges)) {
      if (spacing != null) style[`${prefix}-${edge}`] = spacingValue(spacing);
    }
  }

  function autoLayoutStyle(node) {
    const style = {};
    const layout = node?.layout;
    const align = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };
    const justify = { start: "flex-start", center: "center", end: "flex-end", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" };
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
      if (layout.align) style["align-items"] = align[layout.align] || layout.align;
      if (layout.justify) style["justify-content"] = justify[layout.justify] || layout.justify;
      if (layout.wrap) style["flex-wrap"] = "wrap";
      if (layout.grow) Object.assign(style, { "flex-grow": "1", "min-width": "0", "min-height": "0" });
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

  function appearanceStyle(node) {
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
    const colorValue = (value) => value === APPEARANCE_NONE ? "transparent" : (/^#[0-9a-f]{6}$/i.test(value) ? value : `var(--color-${value})`);
    if (appearance.color) style.color = colorValue(appearance.color);
    if (appearance.background) style["background-color"] = colorValue(appearance.background);
    if (appearance.borderColor) style["border-color"] = colorValue(appearance.borderColor);
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
    return { ...spec, style: { ...(spec.style || {}), ...nodeStyle(node) }, source };
  }

  function expandInstance(doc, name, callerProps = {}, seen = []) {
    const component = getComponentMap(doc)[name];
    if (!component) return { tag: "div", class: "ds-missing", attrs: {}, children: [`Unknown component "${name}"`] };
    if (seen.includes(name)) return { tag: "div", class: "ds-missing", attrs: {}, children: [`Recursive component "${name}"`] };
    const componentIndex = Array.isArray(doc?.components) ? doc.components.indexOf(component) : -1;
    return expandNode(
      doc,
      component.root,
      { ...(component.props || {}), ...(callerProps || {}) },
      [...seen, name],
      { component: name, path: ["components", componentIndex, "root"], nodeId: component.root?.id || null },
    );
  }

  function expandNode(doc, node, props, seen = [], source = null) {
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
      class: node.class == null ? null : interpolate(node.class, props),
      attrs: {},
      style: nodeStyle(node),
      source: source ? { ...source, nodeId: node.id || null } : null,
      children: [],
    };
    for (const [key, value] of Object.entries(node.attrs || {})) spec.attrs[key] = typeof value === "string" ? interpolate(value, props) : value;
    const children = Array.isArray(node.children) ? node.children : node.children == null ? [] : [node.children];
    for (const [index, child] of children.entries()) {
      const childSource = source && typeof child === "object" && child != null
        ? { component: source.component, path: [...source.path, "children", index], nodeId: child.id || null }
        : null;
      const expanded = expandNode(doc, child, props, seen, childSource);
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
    for (const [property, value] of Object.entries(spec.style || {})) node.style.setProperty(property, String(value));
    for (const [key, value] of Object.entries(spec.attrs || {})) if (value != null) node.setAttribute(key, String(value));
    // Internal selection metadata must not be replaceable by authored attributes.
    if (spec.source) {
      node.dataset.dsComponent = spec.source.component || "";
      node.dataset.dsNodePath = JSON.stringify(spec.source.path || []);
      if (spec.source.nodeId) node.dataset.dsNodeId = spec.source.nodeId;
      else delete node.dataset.dsNodeId;
    }
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
