/* Shared prototype layout model. Dependency-free classic script; Node may import it
   for its globalThis.ProtoLayout side effect. style(node) and appearanceStyle(node)
   return CSS property-name (kebab-case) objects. validateNode validates one node;
   callers traverse children and pass their immediate scene-graph parent. tokenNames
   accepts colors, spacing, radii, shadows, textStyles, fontFamilies (arrays or Sets);
   textStyle/fontFamily are also accepted as compatibility aliases. */
(function (root) {
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const token = (value) => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
  const pixel = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const hex = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  const layouts = new Set(["stack", "row", "grid", "scroll", "freeform", "none"]);
  const edges = ["top", "right", "bottom", "left"];
  const appearanceGroups = {
    textStyle: "textStyle", fontFamily: "fontFamily", color: "colors",
    background: "colors", borderColor: "colors", radius: "radii", shadow: "shadows",
    textAlign: null,
  };
  const noneKeys = new Set(["color", "background", "borderColor", "radius", "shadow"]);
  const colorKeys = new Set(["color", "background", "borderColor"]);
  // Preserve authored CSS lengths (%, rem, calc(), var(), etc.) without accepting
  // declaration delimiters, URLs, escapes, markup, or executable CSS constructs.
  const dimension = (value) => pixel(value) || (typeof value === "string" &&
    value.trim().length > 0 && /^[A-Za-z0-9_.%(), +*/-]+$/.test(value) &&
    !/(?:url|expression)\s*\(|\/\*/i.test(value));
  const spacing = (value, auto) => pixel(value) || (token(value) && (auto || value !== "auto"));
  const names = (all, group) => {
    const plural = { textStyle: "textStyles", fontFamily: "fontFamilies" }[group];
    const values = (plural ? all[plural] : undefined) ?? all[group];
    return values instanceof Set ? values : new Set(Array.isArray(values) ? values.map(String) : []);
  };

  function validateNode(node, parent, tokenNames = {}) {
    const errors = [], warnings = [];
    if (!object(node)) return { errors: ["Node must be an object."], warnings };
    const checkToken = (value, group, where, strict = false) => {
      const known = names(tokenNames, group);
      if (known.size && !known.has(String(value))) {
        (strict ? errors : warnings).push(`${where}: references unknown ${group} token "${value}".`);
      }
    };
    if (node.layout != null && !layouts.has(node.layout)) errors.push("layout: must be stack, row, grid, scroll, freeform, or none.");
    if (node.wrap != null && typeof node.wrap !== "boolean") errors.push("wrap: must be a boolean.");
    if (node.grow != null && typeof node.grow !== "boolean" && !pixel(node.grow)) errors.push("grow: must be a boolean or a non-negative number.");
    if (node.columns != null && !((typeof node.columns === "number" || (typeof node.columns === "string" && /^\d+$/.test(node.columns))) &&
        Number.isSafeInteger(Number(node.columns)) && Number(node.columns) > 0)) errors.push("columns: must be a positive integer.");
    const alignments = ["normal", "start", "end", "center", "stretch", "baseline", "flex-start", "flex-end", "self-start", "self-end", "first baseline", "last baseline", "safe center", "unsafe center"];
    const justifications = ["normal", "start", "end", "center", "stretch", "left", "right", "flex-start", "flex-end", "space-between", "space-around", "space-evenly", "safe center", "unsafe center"];
    if (node.align != null && !alignments.includes(node.align)) errors.push(`align: unsupported value "${node.align}".`);
    if (node.justify != null && !justifications.includes(node.justify)) errors.push(`justify: unsupported value "${node.justify}".`);
    for (const key of ["width", "height"]) {
      if (node[key] != null && !dimension(node[key])) errors.push(`${key}: must be hug, fill, a non-negative pixel number, or a safe CSS dimension string.`);
    }
    const checkSpace = (value, where, auto = false) => {
      if (!spacing(value, auto)) errors.push(`${where}: must be a spacing token${auto ? ", auto," : " or"} a non-negative pixel number.`);
      else if (typeof value === "string" && value !== "auto") checkToken(value, "spacing", where);
    };
    if (node.gap != null) checkSpace(node.gap, "gap");
    for (const key of ["padding", "margin"]) {
      const value = node[key];
      if (value == null) continue;
      if (!object(value)) checkSpace(value, key, key === "margin");
      else for (const [edge, amount] of Object.entries(value)) {
        if (!["x", "y", ...edges].includes(edge)) errors.push(`${key}: unknown box edge "${edge}".`);
        else checkSpace(amount, `${key}.${edge}`, key === "margin");
      }
    }
    if (node.position != null) {
      const p = node.position;
      if (!object(p) || p.mode !== "absolute" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        errors.push("position: must be { mode: 'absolute', x: finite number, y: finite number }.");
      }
      if (parent?.layout !== "freeform") errors.push("position: absolute positioning is only allowed on direct children of a freeform layout.");
      if (object(p)) for (const key of Object.keys(p)) {
        if (!["mode", "x", "y"].includes(key)) errors.push(`position: unknown property "${key}".`);
      }
    }
    for (const key of ["color", "background", "radius"]) {
      const value = node[key];
      if (value != null && value !== "$none" && !hex(value)) checkToken(value, key === "radius" ? "radii" : "colors", key);
    }
    if (node.appearance != null) {
      if (!object(node.appearance)) errors.push("appearance: must be an object.");
      else for (const [key, value] of Object.entries(node.appearance)) {
        if (!Object.hasOwn(appearanceGroups, key)) { errors.push(`appearance: unknown property "${key}".`); continue; }
        const where = `appearance.${key}`;
        if (noneKeys.has(key) && value === "$none") continue;
        if (colorKeys.has(key) && hex(value)) continue;
        if (!token(value)) { errors.push(`${where}: must be a token name${colorKeys.has(key) ? " or a six-digit hex color" : ""}.`); continue; }
        if (key === "fontFamily" && !["display", "body", "mono"].includes(value)) errors.push(`${where}: must be display, body, or mono.`);
        else if (key === "textAlign" && !["left", "center", "right", "justify", "start", "end"].includes(value)) errors.push(`${where}: unsupported value "${value}".`);
        else if (appearanceGroups[key]) checkToken(value, appearanceGroups[key], where, true);
      }
    }
    return { errors, warnings };
  }

  const space = (value) => typeof value === "number" ? `${value}px` : value === "auto" ? "auto" : `var(--space-${value})`;
  const size = (value) => typeof value === "number" ? `${value}px` : value === "hug" ? "fit-content" : value === "fill" ? "100%" : value;
  const color = (value) => value === "$none" ? "transparent" : hex(value) ? value : `var(--color-${value})`;
  function box(style, key, value) {
    if (value == null) return;
    if (!object(value)) { style[key] = space(value); return; }
    for (const edge of edges) {
      const amount = value[edge] ?? value[edge === "left" || edge === "right" ? "x" : "y"];
      if (amount != null) style[`${key}-${edge}`] = space(amount);
    }
  }

  // Includes the legacy flat style/color/background/radius as defaults; sparse
  // appearance values win. No component definition is changed by this conversion.
  function appearanceStyle(node = {}) {
    const appearance = {
      ...(node.style ? { textStyle: node.style } : {}),
      ...(node.color ? { color: node.color } : {}),
      ...(node.background ? { background: node.background } : {}),
      ...(node.radius ? { radius: node.radius } : {}),
      ...(object(node.appearance) ? node.appearance : {}),
    };
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
    if (appearance.color) style.color = color(appearance.color);
    if (appearance.background) style["background-color"] = color(appearance.background);
    if (appearance.borderColor) style["border-color"] = color(appearance.borderColor);
    if (appearance.radius) style["border-radius"] = appearance.radius === "$none" ? "0" : `var(--radius-${appearance.radius})`;
    if (appearance.shadow) style["box-shadow"] = appearance.shadow === "$none" ? "none" : `var(--shadow-${appearance.shadow})`;
    if (appearance.textAlign) style["text-align"] = appearance.textAlign;
    return style;
  }

  function style(node = {}) {
    const css = {};
    if (node.layout != null) {
      css["box-sizing"] = "border-box";
      if (node.layout === "freeform") { css.display = "block"; css.position = "relative"; }
      else if (node.layout === "none") css.display = "block";
      else if (node.layout === "grid") {
        css.display = "grid";
        css["grid-template-columns"] = `repeat(${node.columns || 1}, minmax(0, 1fr))`;
      } else {
        css.display = "flex";
        css["flex-direction"] = node.layout === "row" || node.direction === "horizontal" ? "row" : "column";
        if (node.wrap != null) css["flex-wrap"] = node.wrap ? "wrap" : "nowrap";
        else if (node.layout === "row") css["flex-wrap"] = "wrap";
      }
      if (node.layout === "scroll") css.overflow = "auto";
    }
    if (node.gap != null) css.gap = space(node.gap);
    box(css, "padding", node.padding);
    box(css, "margin", node.margin);
    if (node.align) css["align-items"] = node.align;
    if (node.justify) css["justify-content"] = node.justify;
    if (node.grow) css.flex = "1";
    for (const key of ["width", "height"]) {
      if (node[key] != null) {
        css[key] = size(node[key]);
        css["box-sizing"] = "border-box";
        if (node[key] === "fill") css[`min-${key}`] = "0";
      }
    }
    if ((node.width != null || node.height != null) && !node.grow) css.flex = "0 0 auto";
    if (node.position?.mode === "absolute") {
      css.position = "absolute";
      css.left = `${node.position.x}px`;
      css.top = `${node.position.y}px`;
    }
    return { ...css, ...appearanceStyle(node) };
  }

  root.ProtoLayout = { validateNode, style, appearanceStyle };
  if (typeof window !== "undefined") window.ProtoLayout = root.ProtoLayout;
})(globalThis);
