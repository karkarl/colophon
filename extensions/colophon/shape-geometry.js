/* Shared shape validation and SVG specs for editor previews, exports, and codegen. */
(function (root) {
  const kinds = ["rectangle", "ellipse", "line", "arrow"];
  const linear = (node) => node?.shape === "line" || node?.shape === "arrow";
  const defaultEndpoints = () => ({ start: { x: 0, y: .5 }, end: { x: 1, y: .5 } });
  function validate(node) {
    const errors = [];
    if (node.shape != null && !kinds.includes(node.shape)) errors.push("shape: must be rectangle, ellipse, line, or arrow.");
    if (node.shape && node.children?.length) errors.push("shape primitives cannot contain children; use a frame.");
    if (node.endpoints != null) {
      const points = node.endpoints;
      if (!linear(node) || !points || typeof points !== "object" || Object.keys(points).some((key) => !["start", "end"].includes(key))
        || ["start", "end"].some((key) => !points[key] || Object.keys(points[key]).some((axis) => !["x", "y"].includes(axis))
          || ["x", "y"].some((axis) => !Number.isFinite(points[key][axis]) || points[key][axis] < 0 || points[key][axis] > 1))) {
        errors.push("endpoints: line/arrow start and end must have normalized x/y coordinates from 0 to 1.");
      } else if (points.start.x === points.end.x && points.start.y === points.end.y) errors.push("endpoints: start and end must differ.");
    }
    if (linear(node)) {
      if (node.component || node.text != null || node.image != null || node.spacer != null) errors.push("line/arrow must be an element or layout primitive.");
      const size = typeof node.layout === "object" ? node.layout : node;
      if (["width", "height"].some((key) => !Number.isFinite(size[key]) || size[key] <= 0 || size[key] > 1000000)) {
        errors.push("line/arrow width and height must be positive pixel numbers up to 1000000.");
      }
    }
    return errors;
  }
  function style(node) {
    if (node.shape === "ellipse") return { "border-radius": "50%" };
    if (!linear(node)) return {};
    return { position: node.position?.mode === "absolute" ? "absolute" : "relative",
      display: "block", overflow: "visible", padding: "0", "border-width": "0", "background-color": "transparent" };
  }
  function svgSpec(node) {
    if (!linear(node)) return null;
    const size = typeof node.layout === "object" ? node.layout : node;
    const { start, end } = node.endpoints || defaultEndpoints();
    const x1 = start.x * size.width, y1 = start.y * size.height;
    const x2 = end.x * size.width, y2 = end.y * size.height;
    const length = Math.hypot(x2 - x1, y2 - y1);
    let d = `M ${x1} ${y1} L ${x2} ${y2}`;
    if (node.shape === "arrow" && length > 0) {
      const ux = (x2 - x1) / length, uy = (y2 - y1) / length;
      const head = Math.min(8, length / 3), half = head / 2;
      d += ` M ${x2 - ux * head - uy * half} ${y2 - uy * head + ux * half} L ${x2} ${y2} L ${x2 - ux * head + uy * half} ${y2 - uy * head - ux * half}`;
    }
    const color = node.appearance?.borderColor || node.appearance?.color;
    const stroke = !color ? "currentColor" : color === "$none" ? "transparent" : /^#[0-9a-f]{6}$/i.test(color) ? color : `var(--color-${color})`;
    return { tag: "svg", attrs: { viewBox: `0 0 ${size.width} ${size.height}`, preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" },
      style: { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", overflow: "visible", "pointer-events": "none" },
      children: [{ tag: "path", attrs: { d, fill: "none", stroke, "stroke-width": node.appearance?.borderWidth ?? 2,
        "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" } }] };
  }
  function createSvg(node, doc = document) {
    const create = (spec) => {
      const element = doc.createElementNS("http://www.w3.org/2000/svg", spec.tag);
      for (const [key, value] of Object.entries(spec.attrs || {})) element.setAttribute(key, String(value));
      for (const [key, value] of Object.entries(spec.style || {})) element.style.setProperty(key, value);
      for (const child of spec.children || []) element.append(create(child));
      return element;
    };
    const spec = svgSpec(node);
    return spec ? create(spec) : null;
  }
  function applyToSpec(spec, node) {
    if (!spec || typeof spec !== "object" || (!node.shape && !spec.shapeGeometry)) return spec;
    const base = spec.shapeGeometry || {};
    const size = typeof node.layout === "object" ? node.layout : node;
    const geometry = {
      ...base, shape: node.shape || base.shape,
      ...(node.endpoints ? { endpoints: node.endpoints } : {}),
      ...(node.position ? { position: node.position } : {}),
      appearance: { ...base.appearance, ...(node.color ? { color: node.color } : {}), ...node.appearance },
    };
    for (const key of ["width", "height"]) {
      if (Number.isFinite(size[key]) && size[key] > 0) geometry[key] = size[key];
    }
    const svg = svgSpec(geometry);
    return {
      ...spec, shapeGeometry: geometry,
      style: { ...spec.style, ...style(geometry) },
      ...(svg ? { children: [svg] } : {}),
    };
  }
  root.ShapeGeometry = { kinds, linear, defaultEndpoints, validate, style, svgSpec, createSvg, applyToSpec };
  if (typeof window !== "undefined") window.ShapeGeometry = root.ShapeGeometry;
})(globalThis);
