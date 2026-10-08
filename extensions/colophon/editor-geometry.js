/* Geometry shared by both editors; no DOM or renderer dependencies. */
(function (root) {
  const dimensions = (node, schema) => schema === "component" ? (node.layout ||= {}) : node;
  function scale(node, factor, bounds, schema = "prototype") {
    if (!Number.isFinite(factor) || factor < 0.1 || factor > 10) throw new Error("Scale geometry requires a multiplier from 0.1 to 10.");
    if (!node || typeof node !== "object" || !Number.isFinite(bounds?.width) || !Number.isFinite(bounds?.height) || bounds.width <= 0 || bounds.height <= 0) {
      throw new Error("Select a visible layer with measurable dimensions.");
    }
    const scaled = JSON.parse(JSON.stringify(node));
    const multiply = (value) => {
      const result = Math.round(value * factor * 100) / 100;
      if (!Number.isFinite(result) || Math.abs(result) > 1000000) throw new Error("Scaled geometry exceeds the supported range.");
      return result;
    };
    const visit = (value, first = false) => {
      if (!value || typeof value !== "object") return;
      const size = first ? dimensions(value, schema) : schema === "component" ? value.layout || {} : value;
      if (first) Object.assign(size, { width: bounds.width, height: bounds.height });
      for (const key of ["width", "height"]) if (typeof size[key] === "number") size[key] = multiply(size[key]);
      if (!first && value.position) {
        value.position.x = multiply(value.position.x);
        value.position.y = multiply(value.position.y);
      }
      for (const child of Array.isArray(value.children) ? value.children : []) visit(child);
    };
    visit(scaled, true);
    Object.assign(node, scaled);
  }
  function template(kind, tokens, schema = "prototype") {
    const colors = Array.isArray(tokens?.colors) ? tokens.colors.map((token) => token.name) : Object.keys(tokens?.colors || {});
    const color = (name) => colors.includes(name) ? name : undefined;
    if (kind.startsWith("component:")) return { component: kind.slice(10) };
    const component = schema === "component";
    if (kind === "frame") return {
      id: "frame", ...(component ? { el: "div", layout: { mode: "freeform", width: 160, height: 96 } } : { layout: "freeform", width: 160, height: 96 }),
      appearance: { background: color("surface"), borderColor: color("line"), borderWidth: 1 }, children: [],
    };
    if (kind === "rectangle") return {
      id: "rectangle", ...(component ? { el: "div", layout: { width: 96, height: 64 } } : { layout: "none", width: 96, height: 64, children: [] }),
      appearance: { background: color("line") },
    };
    if (kind === "text") return {
      id: "text", ...(component ? { el: "p", layout: { width: "hug" }, children: ["Text"] } : { text: "Text", width: "hug" }),
      appearance: { color: color("ink"), ...(tokens?.typography?.scale?.some((style) => style.name === "body") ? { textStyle: "body" } : {}) },
    };
    throw new Error("Unknown insert tool.");
  }
  root.EditorGeometry = { scale, template, dimensions };
})(globalThis);
