// context.mjs — the "skill" half: detect UI work and give Copilot the design system.
//
// buildSummary()      -> compact text of the design system (used by the tool + hooks)
// looksLikeUiWork()   -> heuristic: is this prompt about building/changing UI?
// sessionStartContext -> one-time announcement the design system exists
// promptContext()     -> per-turn nudge to consult it before writing UI

import { colorList, readAuthority, portLines, DESIGN_SUBPATH } from "./designio.mjs";

// One-line pointer to the prototype feature, woven into the UI-work context so Copilot
// knows it can build click-through mockups instead of one-off static UI.
const PROTO_HINT =
  `To design a flow before writing code, build a click-through prototype from this design system: use the "prototype" tool (action=patch to author screens, codegen to convert one to code) and open the "Prototype" canvas to click through it in web/desktop/mobile/tablet frames. Prototypes live at ${DESIGN_SUBPATH}/prototypes.jsonc.`;

const UI_TERMS = [
  "ui", "ux", "page", "screen", "view", "component", "layout", "design",
  "style", "styling", "css", "tailwind", "theme", "color", "colour", "palette",
  "font", "typography", "button", "form", "input", "modal", "dialog", "card",
  "nav", "navbar", "sidebar", "header", "footer", "hero", "landing", "dashboard",
  "responsive", "spacing", "icon", "brand", "frontend", "front-end", "react",
  "vue", "svelte", "html", "figma", "accessib", "a11y", "dark mode", "menu",
  "table", "chart", "badge", "tooltip", "toast", "banner", "widget", "onboarding",
  "mockup", "mock-up", "prototype", "click-through", "clickthrough", "wireframe", "flow",
];

const BUILD_TERMS = [
  "build", "create", "add", "make", "implement", "design", "redesign", "restyle",
  "fix", "improve", "polish", "update", "change", "refactor", "tweak", "render",
  "prototype", "mock", "wire", "lay out", "revamp",
];

export function looksLikeUiWork(prompt) {
  if (!prompt || typeof prompt !== "string") return false;
  const p = prompt.toLowerCase();
  const hasUi = UI_TERMS.some((t) => p.includes(t));
  if (!hasUi) return false;
  // A bare mention of "color" in an unrelated sentence shouldn't trigger, but
  // any build/change verb alongside a UI term is a strong signal.
  const hasBuild = BUILD_TERMS.some((t) => p.includes(t));
  return hasBuild || /\b(ui|ux|frontend|front-end|design system|landing page|dashboard)\b/.test(p);
}

function firstLine(s, max = 400) {
  if (!s) return "";
  const line = String(s).replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max) + "…" : line;
}

// Compact, model-friendly rendering of the design system.
export function buildSummary(design) {
  const t = design.tokens || {};
  const brand = t.brand || {};
  const colors = colorList(t);
  const ty = t.typography || {};
  const lines = [];

  lines.push(`# Design system: ${brand.name || "(unnamed)"}`);
  if (brand.tagline) lines.push(brand.tagline);
  if (brand.description) lines.push(`About: ${brand.description}`);
  const sourceLine = design.source === "repo"
    ? `Source: ${DESIGN_SUBPATH}/ (in this repo)`
    : design.source === "scan"
      ? `Source: proposed from scanning this repo's existing UI — not saved yet. Review in the Design System canvas, then save to ${DESIGN_SUBPATH}/.`
      : design.source === "import"
        ? `Source: proposed from imported tokens — not saved yet. Review in the Design System canvas, then save to ${DESIGN_SUBPATH}/.`
        : `Source: bundled starter (no ${DESIGN_SUBPATH}/ in this repo yet — call the "init" action to seed it)`;
  lines.push(sourceLine);

  const authority = readAuthority(t);
  if (authority.hasPort) {
    lines.push(
      "Authority: these files are the source of truth for DESIGN (tokens, component intent, principles) " +
      "and are framework-agnostic — components.jsonc is design intent for preview, not shipping code. The " +
      "shipping implementation below is canonical; treat token values and components.jsonc as derived examples. " +
      "To ship, port the design into this app's implementation via the port target(s) below:"
    );
    for (const l of portLines(authority, { bullet: "  - " })) lines.push(l);
  }
  lines.push("");

  if (brand.voice) lines.push(`Voice: ${brand.voice}`);
  if (Array.isArray(brand.personality) && brand.personality.length) lines.push(`Personality: ${brand.personality.join(", ")}`);
  if (Array.isArray(brand.antiReferences) && brand.antiReferences.length) lines.push(`Avoid (anti-references): ${brand.antiReferences.join("; ")}`);
  lines.push("");

  if (colors.length) {
    const previewOnly = authority.hasPort;
    lines.push(previewOnly
      ? "Colors (PREVIEW-ONLY hex — bind the mapped `resource` in code, never the raw value, so light/dark/high-contrast stay correct):"
      : "Colors:");
    for (const c of colors) {
      const res = c.resource ? ` → resource ${c.resource}` : "";
      lines.push(`  - ${c.name}: ${c.value}${res}${c.usage ? ` — ${c.usage}` : ""}`);
    }
    lines.push("");
  }

  const faces = ["display", "body", "mono"].filter((k) => ty[k]?.family);
  if (faces.length) {
    lines.push("Typography:");
    for (const k of faces) lines.push(`  - ${k}: ${ty[k].family}${ty[k].usage ? ` — ${ty[k].usage}` : ""}`);
    if (Array.isArray(ty.scale) && ty.scale.length) {
      lines.push(`  - scale: ${ty.scale.map((s) => `${s.name} ${s.size}/${s.lineHeight}`).join(", ")}`);
    }
    lines.push("");
  }

  const sp = t.spacing?.scale || [];
  if (sp.length) lines.push(`Spacing scale: ${sp.map((s) => `${s.name}=${s.value}`).join(", ")}`);
  if (Array.isArray(t.radii) && t.radii.length) lines.push(`Radii: ${t.radii.map((r) => `${r.name}=${r.value}`).join(", ")}`);
  if (sp.length || (t.radii || []).length) lines.push("");

  if (Array.isArray(t.principles) && t.principles.length) {
    lines.push("Principles:");
    for (const p of t.principles) lines.push(`  - ${p}`);
    lines.push("");
  }

  if (design.componentsSource) {
    lines.push(`Component patterns are documented in ${DESIGN_SUBPATH}/components.jsonc — match those patterns and class/token names.`);
  }
  if (design.principlesMarkdown) {
    lines.push(`Prose guidance: ${DESIGN_SUBPATH}/principles.md — ${firstLine(design.principlesMarkdown.replace(/^#.*$/m, ""))}`);
  }

  return lines.join("\n").trim();
}

export function sessionStartContext(design) {
  const brand = design.tokens?.brand || {};
  const authority = readAuthority(design.tokens);
  if (design.source === "repo") {
    if (authority.hasPort) {
      const targets = portLines(authority, { bullet: "" }).join("; ");
      return [
        `This repository has a design system at ${DESIGN_SUBPATH}/ (brand: ${brand.name || "unnamed"}). These files are the source of truth for DESIGN and are framework-agnostic — components.jsonc is design intent for preview, not shipping code, and the color hex values are preview-only swatches.`,
        `Before creating or changing any UI, read ${DESIGN_SUBPATH}/design.json, components.jsonc, and principles.md and follow their tokens and patterns. The shipping implementation is canonical: to ship, port the design using the port target(s): ${targets}. Bind each color's mapped resource key rather than hard-coding the preview hex.`,
        `You can open the "Colophon" canvas to view/edit it (with Light/Dark/High-contrast preview), or call the colophon tool for a text summary.`,
      ].join(" ");
    }
    return [
      `This repository has a design system at ${DESIGN_SUBPATH}/ (brand: ${brand.name || "unnamed"}).`,
      `Before creating or changing any UI, read ${DESIGN_SUBPATH}/design.json, components.jsonc, and principles.md and follow them — reuse the defined color/type/spacing tokens and component patterns instead of inventing new ones.`,
      `You can open the "Colophon" canvas to view/edit it, or call the colophon tool for a text summary.`,
    ].join(" ");
  }
  return `A "Colophon" canvas is available (via the colophon plugin). This repo has no ${DESIGN_SUBPATH}/ yet; if the user does UI work, offer to seed one with the colophon tool or the canvas "init" action.`;
}

export function promptContext(design) {
  const brand = design.tokens?.brand || {};
  const authority = readAuthority(design.tokens);
  const head = design.source !== "repo"
    ? `The user's request looks UI-related. There's no ${DESIGN_SUBPATH}/ in this repo yet, but a starter design system is available.`
    : authority.hasPort
      ? `The user's request looks UI-related and this repo has a design system (${brand.name || "unnamed"}) at ${DESIGN_SUBPATH}/ — the source of truth for design (framework-agnostic). Follow its tokens/patterns, then port the design into this app's canonical implementation via the configured port target(s); the color hex is preview-only, so bind each color's mapped resource key instead.`
      : `The user's request looks UI-related and this repo has a design system (${brand.name || "unnamed"}) at ${DESIGN_SUBPATH}/.`;
  return [
    head,
    "Consult it before writing UI: use the colophon tool (or read the files) and honor its color, typography, spacing, radius tokens, component patterns, principles, and anti-references.",
    PROTO_HINT,
    "Here is the current design system for quick reference:",
    "",
    buildSummary(design),
  ].join("\n");
}
