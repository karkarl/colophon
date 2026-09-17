// protocodegen.mjs — first-pass "convert prototype to code". Turns a screen's scene
// graph into code for the repo's configured port target (from design.json `authority`):
//   • No port target (the files are the implementation) → faithful React/JSX using the
//     design system's ds-* classes + components, with navigation + simple state wired.
//   • A native port target (WinUI / SwiftUI / …) → a hand-off scaffold: a semantic node
//     outline + a mapping table + the port instructions, so the port skill/syncSource can
//     finish it natively. We never pretend to emit production native code deterministically.

import { readAuthority, portLines } from "./designio.mjs";
import { walkScreen, nodeKind } from "./prototypeio.mjs";
import "./proto-layout.js";

const { style: nodeStyle } = globalThis.ProtoLayout;

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).replace(/[^A-Za-z0-9]/g, "") : s);
const pascal = (s) => (s || "screen").split(/[^A-Za-z0-9]+/).filter(Boolean).map(cap).join("") || "Screen";

// Which target applies to this screen: a per-area override that names the screen id, else
// the app-wide port, else web (self).
function pickTarget(authority, screen) {
  if (!authority.hasPort) return { kind: "web", label: "React / JSX (design source is self)", syncSource: "" };
  const ov = (authority.portOverrides || []).find((o) => o.area && (o.area === screen.id || (screen.name && o.area === screen.name)));
  const t = ov || authority.port;
  if (!t) return { kind: "web", label: "React / JSX", syncSource: "" };
  return { kind: "native", label: t.authoritySource || "native", syncSource: t.syncSource || "", target: t };
}

// ---- collect the state keys a screen touches ------------------------------
function collectState(screen) {
  const keys = new Map(); // key -> sample value (for init inference)
  let usesModal = false;
  walkScreen(screen, (node) => {
    for (const cond of [node.visibleWhen, node.hiddenWhen]) if (cond) for (const [k, v] of Object.entries(cond)) if (!keys.has(k)) keys.set(k, v);
    const tap = node.on?.tap;
    if (!tap) return;
    if (tap.setState) for (const [k, v] of Object.entries(tap.setState)) if (!keys.has(k)) keys.set(k, v);
    if (tap.toggle && !keys.has(tap.toggle)) keys.set(tap.toggle, false);
    if (tap.openModal || tap.closeModal) usesModal = true;
  });
  return { keys, usesModal };
}

// ---- React generator -------------------------------------------------------
const spaceVar = (v) => `var(--space-${v})`;

function styleObj(node) {
  const kind = nodeKind(node);
  const defaults = kind === "spacer"
    ? { flex: "0 0 auto", width: spaceVar(node.size || "4"), height: spaceVar(node.size || "4") }
    : kind === "image" ? { "object-fit": node.fit || "cover" }
      : kind === "text" ? { margin: "0", color: "var(--color-ink)" } : {};
  const common = nodeStyle(kind === "text" && !node.style ? { ...node, style: "body" } : node);
  const css = { ...defaults, ...common, ...(node.on?.tap ? { cursor: "pointer" } : {}) };
  const react = Object.fromEntries(Object.entries(css).map(([key, value]) => [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
  return JSON.stringify({ ...(kind === "component" && typeof node.props?.style === "object" ? node.props.style : {}), ...react });
}

function handler(tap, state) {
  if (tap.navigate) return `() => navigate(${JSON.stringify(tap.navigate)})`;
  if (tap.back) return "() => navigate(-1)";
  if (tap.openModal) return `() => setModal(${JSON.stringify(tap.openModal)})`;
  if (tap.closeModal) return "() => setModal(null)";
  if (tap.toggle) return `() => set${cap(tap.toggle)}((v) => !v)`;
  if (tap.setState) { const [k, v] = Object.entries(tap.setState)[0]; return `() => set${cap(k)}(${JSON.stringify(v)})`; }
  return "() => {}";
}

function condExpr(cond, negate) {
  const parts = Object.entries(cond).map(([k, v]) => `${k} === ${JSON.stringify(v)}`);
  const j = parts.join(" && ");
  return negate ? `!(${j})` : (parts.length > 1 ? `(${j})` : j);
}

function textTag(style) { return /^(display|title|heading)$/.test(style) ? "h2" : "p"; }

function reactNode(node, state, indent) {
  const pad = "  ".repeat(indent);
  const kind = nodeKind(node);
  const tap = node.on?.tap;
  const interaction = tap ? ` onClick={(event) => { if (event.defaultPrevented) return; event.stopPropagation(); (${handler(tap, state)})(); }}` : "";
  const style = ` style={${styleObj(node)}}`;
  let jsx;
  if (kind === "layout") {
    const kids = (node.children || []).map((c) => reactNode(c, state, indent + 1)).filter(Boolean).join("\n");
    jsx = `${pad}<div${style}${interaction}>\n${kids}\n${pad}</div>`;
  } else if (kind === "text") {
    const textStyle = node.appearance?.textStyle || node.style;
    const tag = textTag(textStyle);
    const cls = textStyle === "eyebrow" ? ' className="ds-eyebrow"' : "";
    jsx = `${pad}<${tag}${cls}${style}${interaction}>{${JSON.stringify(node.text || "")}}</${tag}>`;
  } else if (kind === "component") {
    const props = node.props || {};
    const attrs = Object.entries(props).filter(([k]) => k !== "children" && k !== "style" && !(tap && k === "onClick")).map(([k, v]) => ` ${k}={${JSON.stringify(v)}}`).join("");
    jsx = props.children != null
      ? `${pad}<${node.component}${attrs}${style}${interaction}>{${JSON.stringify(props.children)}}</${node.component}>`
      : `${pad}<${node.component}${attrs}${style}${interaction} />`;
  } else if (kind === "image") {
    jsx = `${pad}<img src={${JSON.stringify(node.image || node.src || "")}} alt={${JSON.stringify(node.alt || "")}}${style}${interaction} />`;
  } else if (kind === "spacer") {
    jsx = `${pad}<div${style}${interaction} />`;
  } else {
    jsx = `${pad}{/* unknown node ${node.id || ""} */}`;
  }

  // Visibility wrapper.
  if (node.visibleWhen) jsx = `${pad}{${condExpr(node.visibleWhen, false)} && (\n${jsx}\n${pad})}`;
  else if (node.hiddenWhen) jsx = `${pad}{${condExpr(node.hiddenWhen, true)} && (\n${jsx}\n${pad})}`;
  return jsx;
}

function usedComponents(screen) {
  const set = new Set();
  walkScreen(screen, (n) => { if (n.component) set.add(n.component); });
  return [...set];
}

function generateReact(screen, doc) {
  const name = pascal(screen.id) + "Screen";
  const { keys, usesModal } = collectState(screen);
  const comps = usedComponents(screen);
  const hooks = [];
  for (const [k, v] of keys) {
    const init = (doc.state && k in doc.state) ? doc.state[k] : v;
    hooks.push(`  const [${k}, set${cap(k)}] = useState(${JSON.stringify(init)});`);
  }
  if (usesModal) hooks.push(`  const [modal, setModal] = useState(null);`);

  const body = reactNode(screen.root, keys, 3);
  const modals = (screen.modals || []).map((m) =>
    `      {modal === ${JSON.stringify(m.id)} && (\n${reactNode(m.root, keys, 4)}\n      )}`).join("\n");

  const importLine = comps.length ? `import { ${comps.join(", ")} } from "./components";\n` : "";
  return `import React, { useState } from "react";
${importLine}
// Generated from prototypes.jsonc screen "${screen.id}". Styling uses the design system's
// CSS variables + ds-* component classes. Wire the navigate prop to your router.
// Components must forward style/onClick to their instance root; do not wrap positioned
// nodes. Freeform coordinates are relative to their immediate freeform container.
export function ${name}({ navigate = () => {} }) {
${hooks.join("\n")}${hooks.length ? "\n" : ""}  return (
    <>
${body}
${modals ? modals + "\n" : ""}    </>
  );
}
`;
}

// ---- native hand-off scaffold ---------------------------------------------
const NATIVE_MAP = [
  ["stack (vertical)", "StackPanel Orientation=Vertical", "VStack"],
  ["stack (horizontal) / row", "StackPanel Orientation=Horizontal", "HStack"],
  ["grid", "Grid / UniformGrid", "LazyVGrid"],
  ["freeform + absolute x/y", "Canvas + Canvas.Left/Top", "ZStack + top-leading offset"],
  ["none (normal flow)", "native content container", "native content container"],
  ["hug / fill / pixel size", "Auto / Stretch / explicit size", "ideal size / max frame / frame"],
  ["margin / padding edge boxes", "Margin / Padding", "padding / container spacing"],
  ["appearance overrides", "instance-local resources/properties", "instance-local view modifiers"],
  ["text", "TextBlock", "Text"],
  ["image", "Image", "Image"],
  ["component (Button/Card/…)", "the native control for that component", "the native view"],
  ["on.tap navigate", "Frame.Navigate(...)", "NavigationLink / path"],
  ["on.tap setState/toggle", "x:Bind view-model property", "@State property"],
];

function outlineNode(node, indent) {
  const pad = "  ".repeat(indent);
  const kind = nodeKind(node);
  let label;
  if (kind === "layout") label = `${node.layout}${node.direction ? `:${node.direction}` : ""}`;
  else if (kind === "component") label = `${node.component}(${JSON.stringify(node.props || {})})`;
  else if (kind === "text") label = `text "${node.text}"${node.style ? ` [${node.style}]` : ""}`;
  else label = kind;
  const tap = node.on?.tap ? `  ⇒ ${JSON.stringify(node.on.tap)}` : "";
  const vis = node.visibleWhen ? `  (when ${JSON.stringify(node.visibleWhen)})` : "";
  const styling = nodeStyle(node);
  const lines = [`${pad}- ${label}${tap}${vis}${Object.keys(styling).length ? `  styles=${JSON.stringify(styling)}` : ""}`];
  for (const c of node.children || []) lines.push(outlineNode(c, indent + 1));
  return lines.join("\n");
}

function generateNativeScaffold(screen, target) {
  const mapRows = NATIVE_MAP.map(([n, w, s]) => `//   ${n.padEnd(28)} → ${w}  |  ${s}`).join("\n");
  const port = target.syncSource ? `port via ${target.syncSource}` : "no syncSource set in design.json";
  return `// Screen "${screen.id}" → ${target.label} (${port})
//
// This is a HAND-OFF scaffold, not final native code. Port each node below to its native
// equivalent using the port skill/reference above. Mapping guide:
//
${mapRows}
//
// Semantic node tree:
${outlineNode(screen.root, 0)}
${(screen.modals || []).map((m) => `//\n// Modal "${m.id}":\n${outlineNode(m.root, 0)}`).join("\n")}
`;
}

// ---- entry -----------------------------------------------------------------
export function codegenScreen(doc, screenId, tokens) {
  const screen = (doc.screens || []).find((s) => s.id === screenId);
  if (!screen) throw new Error(`no screen "${screenId}"`);
  const authority = readAuthority(tokens);
  const target = pickTarget(authority, screen);
  const name = pascal(screen.id);

  if (target.kind === "web") {
    return { screenId, target: target.label, language: "jsx", filename: `${name}Screen.jsx`, code: generateReact(screen, doc), notes: [] };
  }
  return {
    screenId,
    target: target.label,
    language: "text",
    filename: `${name}.porting.txt`,
    code: generateNativeScaffold(screen, target),
    notes: portLines(authority),
  };
}
