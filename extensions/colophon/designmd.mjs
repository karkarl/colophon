// DESIGN.md is the portable document; x-colophon carries only the richer metadata.
import { isDeepStrictEqual } from "node:util";
import { Document, isMap, isScalar, parseDocument } from "./vendor/yaml.mjs";

export const DESIGN_MD = "DESIGN.md";
const ROLES = ["display", "body", "mono"];
const object = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const entries = (value) => Object.entries(value || {});
const without = (value, keys) => Object.fromEntries(entries(value).filter(([key]) => !keys.includes(key)));

function mapping(value, label) {
  if (value != null && !object(value)) throw new Error(`${label} must be a mapping.`);
  return value || {};
}

function checkSections(body) {
  const seen = new Set();
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const match = line.match(/^ {0,3}##\s+(.+?)(?:\s+#+)?\s*$/);
    if (!match) continue;
    let name = match[1].trim().toLowerCase();
    name = ({ "brand & style": "overview", "layout & spacing": "layout", elevation: "elevation & depth" })[name] || name;
    if (seen.has(name)) throw new Error(`Duplicate DESIGN.md section: ${match[1]}`);
    seen.add(name);
  }
}

function resolve(value, root, visited = new Set()) {
  if (typeof value !== "string" || !/^\{[^{}]+\}$/.test(value)) return value;
  const ref = value.slice(1, -1);
  if (visited.has(ref)) throw new Error(`Circular token reference: ${value}`);
  visited.add(ref);
  let target = root;
  for (const part of ref.split(".")) {
    if (!object(target) || !Object.hasOwn(target, part)) throw new Error(`Broken token reference: ${value}`);
    target = target[part];
  }
  return resolve(target, root, visited);
}

function checkReferences(value, root, ancestors = new Set()) {
  if (typeof value === "string") resolve(value, root);
  else if (object(value) || Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("Cyclic YAML aliases are not supported.");
    ancestors.add(value);
    for (const child of Object.values(value)) checkReferences(child, root, ancestors);
    ancestors.delete(value);
  }
}

function toTokens(data, body) {
  const extension = mapping(data["x-colophon"], "x-colophon");
  if (extension.version != null && extension.version !== 1) throw new Error("Unsupported x-colophon version; leave this document unchanged.");
  const extra = mapping(extension.tokens, "x-colophon.tokens");
  for (const name of ["principles", "shadows", "pages"]) {
    if (extra[name] != null && !Array.isArray(extra[name])) throw new Error(`x-colophon.tokens.${name} must be an array.`);
  }
  mapping(extra.colors, "x-colophon.tokens.colors");
  mapping(extra.spacing, "x-colophon.tokens.spacing");
  const brand = { ...mapping(extra.brand, "x-colophon.tokens.brand") };
  brand.name = data.name ?? body.match(/^#\s+(.+)$/m)?.[1] ?? "";
  brand.description = data.description ?? "";
  if (typeof brand.name !== "string" || typeof brand.description !== "string") throw new Error("Design name and description must be strings.");
  const colors = entries(mapping(data.colors, "colors")).map(([name, raw]) => {
    const value = resolve(raw, data);
    if (typeof value !== "string") throw new Error(`Color "${name}" must resolve to a CSS color string.`);
    const metadata = extra.colors?.[name] || {};
    const color = { ...without(metadata, ["$lightTheme"]), name, value };
    if (metadata.$lightTheme || Object.hasOwn(metadata.themes || {}, "light")) color.themes = { ...metadata.themes, light: value };
    return color;
  });
  const ty = mapping(extra.typography, "x-colophon.tokens.typography");
  mapping(ty.scale, "x-colophon.tokens.typography.scale");
  const typography = { ...without(ty, ["scale"]), scale: [] };
  for (const [name, raw] of entries(mapping(data.typography, "typography"))) {
    const style = mapping(resolve(raw, data), `typography.${name}`);
    const metadata = ty.scale?.[name] || {};
    const role = ROLES.includes(metadata.role) ? metadata.role : "body";
    const family = resolve(style.fontFamily, data);
    if (family != null && typeof family !== "string") throw new Error(`typography.${name}.fontFamily must be a string.`);
    if (family && !typography[role]?.family) typography[role] = { ...typography[role], family };
    const s = { ...metadata, name, role };
    if (family && family !== typography[role]?.family) s.family = family;
    for (const [from, to] of [["fontSize", "size"], ["fontWeight", "weight"], ["lineHeight", "lineHeight"], ["letterSpacing", "tracking"], ["fontFeature", "fontFeature"], ["fontVariation", "fontVariation"]]) {
      if (style[from] != null) s[to] = resolve(style[from], data);
    }
    typography.scale.push(s);
  }
  const scale = (group) => entries(mapping(data[group], group)).map(([name, raw]) => {
    const value = resolve(raw, data);
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`${group}.${name} must resolve to a dimension or number.`);
    return { name, value };
  });
  return {
    ...extra, brand, colors, typography,
    spacing: { ...extra.spacing, scale: scale("spacing") },
    radii: scale("rounded"),
    principles: extra.principles || [],
  };
}

export function parseDesignMarkdown(source) {
  if (typeof source !== "string") throw new Error("DESIGN.md must be text.");
  const hasFrontmatter = /^(?:\uFEFF)?---(?:\r?\n|$)/.test(source);
  const match = hasFrontmatter ? source.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m) : null;
  if (!match && /^(?:\uFEFF)?---(?:\r?\n|$)/.test(source)) throw new Error("DESIGN.md front matter is missing its closing --- fence.");
  const yaml = parseDocument(match?.[1] || "", { uniqueKeys: true, keepSourceTokens: true });
  if (yaml.errors.length || yaml.warnings.length) throw new Error([...yaml.errors, ...yaml.warnings].map((e) => e.message).join("\n"));
  const data = mapping(yaml.toJS({ maxAliasCount: 50 }), "DESIGN.md front matter");
  for (const group of ["colors", "typography", "spacing", "rounded", "components"]) mapping(data[group], group);
  checkReferences(data, data);
  const body = match ? source.slice(match[0].length) : source;
  checkSections(body);
  const tokens = toTokens(data, body);
  const warnings = [];
  if (!tokens.colors.length) warnings.push("DESIGN.md has no concrete color tokens. Prose is available; add tokens before using the visual editor.");
  if (data.components) warnings.push("DESIGN.md component style tokens are preserved. Live component structures come from .agents/design/components.jsonc.");
  return { yaml, data, body, tokens, warnings, source, eol: source.includes("\r\n") ? "\r\n" : "\n" };
}

function projection(tokens) {
  const { brand = {}, typography = {}, spacing = {} } = tokens;
  const colorList = Array.isArray(tokens.colors) ? tokens.colors : entries(tokens.colors).map(([name, value]) => ({ name, value }));
  const colors = Object.fromEntries(colorList.map((c) => [c.name, c.value || c.themes?.light]));
  const styles = typography.scale || [];
  const typeMap = Object.fromEntries(styles.map((s) => [s.name, {
    ...((s.family || typography[s.role || "body"]?.family) ? { fontFamily: s.family || typography[s.role || "body"].family } : {}),
    ...(s.size != null ? { fontSize: s.size } : {}),
    ...(s.weight != null ? { fontWeight: s.weight } : {}),
    ...(s.lineHeight != null ? { lineHeight: s.lineHeight } : {}),
    ...(s.tracking != null ? { letterSpacing: s.tracking } : {}),
    ...(s.fontFeature != null ? { fontFeature: s.fontFeature } : {}),
    ...(s.fontVariation != null ? { fontVariation: s.fontVariation } : {}),
  }]));
  const typeMetadata = without(typography, ["scale"]);
  for (const role of ROLES) {
    if (typeMetadata[role] && styles.some((s) => (s.role || "body") === role && !s.family)) {
      typeMetadata[role] = without(typeMetadata[role], ["family"]);
    }
  }
  const extra = {
    ...without(tokens, ["brand", "colors", "typography", "spacing", "radii"]),
    brand: without(brand, ["name", "description"]),
    colors: Object.fromEntries(colorList.map((c) => [c.name, {
      ...without(c, ["name", "value"]),
      ...(Object.hasOwn(c.themes || {}, "light") ? { $lightTheme: true, themes: without(c.themes, ["light"]) } : {}),
    }])),
    typography: {
      ...typeMetadata,
      scale: Object.fromEntries(styles.map((s) => [s.name, without(s, ["name", "family", "size", "weight", "lineHeight", "tracking", "fontFeature", "fontVariation"])])),
    },
    spacing: without(spacing, ["scale"]),
  };
  return {
    name: brand.name || "Untitled",
    description: brand.description || "",
    colors,
    typography: typeMap,
    spacing: Object.fromEntries((spacing.scale || []).map((s) => [s.name, s.value])),
    rounded: Object.fromEntries((tokens.radii || []).map((r) => [r.name, r.value])),
    "x-colophon": { version: 1, tokens: extra },
  };
}

function patchYaml(doc, before, after, path = []) {
  if (isDeepStrictEqual(before, after)) return false;
  if (object(before) && object(after)) {
    const node = path.length ? doc.getIn(path, true) : doc.contents;
    if (node != null && !isMap(node)) throw new Error(`Cannot safely edit YAML alias or non-mapping at ${path.join(".")}. Edit DESIGN.md directly.`);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      patchYaml(doc, before[key], after[key], [...path, key]);
    }
  } else if (after === undefined) {
    if (doc.hasIn(path)) doc.deleteIn(path);
  } else {
    const node = doc.getIn(path, true);
    if (isScalar(node) && (after == null || typeof after !== "object")) node.value = after;
    else doc.setIn(path, after);
  }
  return true;
}

export function updateDesignMarkdown(source, tokens) {
  const parsed = parseDesignMarkdown(source);
  if (!patchYaml(parsed.yaml, projection(parsed.tokens), projection(tokens))) return source;
  if (!parsed.data["x-colophon"] && parsed.yaml.hasIn(["x-colophon"])) parsed.yaml.setIn(["x-colophon", "version"], 1);
  const yaml = parsed.yaml.toString({ lineWidth: 0 }).replace(/\r?\n/g, parsed.eol);
  const result = `${source.startsWith("\uFEFF") ? "\uFEFF" : ""}---${parsed.eol}${yaml}---${parsed.eol}${parsed.body}`;
  parseDesignMarkdown(result);
  return result;
}

export function seedDesignMarkdown(tokens) {
  const brand = tokens.brand || {};
  const lines = [
    "", "## Overview", "",
    brand.description || brand.tagline || `The visual identity for ${brand.name || "this project"}. Refine this brief before shipping UI.`,
    "", "<!-- colophon:note -->",
    "Edit and preview this design with the **Colophon** canvas in the GitHub Copilot app.",
    "Install the optional plugin with `copilot plugin install karkarl/colophon`.",
    "Agents without Colophon can read and edit this file directly.",
    "[Colophon documentation](https://github.com/karkarl/colophon).",
    "<!-- colophon:note -->", "",
    "This file owns the design tokens and rationale. `x-colophon` preserves preview",
    "themes, production resource mappings, and other Colophon-specific metadata.", "",
  ];
  if (brand.voice) lines.push(`Voice: ${brand.voice}`, "");
  if (brand.personality?.length) lines.push(`Personality: ${brand.personality.join(", ")}.`, "");
  lines.push("## Colors", "");
  const colors = Array.isArray(tokens.colors) ? tokens.colors : entries(tokens.colors).map(([name]) => ({ name }));
  for (const c of colors) lines.push(`- **${c.name}** {colors.${c.name}}${c.usage ? `: ${c.usage}` : ""}`);
  lines.push("", "## Typography", "");
  for (const s of tokens.typography?.scale || []) lines.push(`- **${s.name}**: {typography.${s.name}}${tokens.typography[s.role]?.usage ? ` - ${tokens.typography[s.role].usage}` : ""}`);
  lines.push("", "## Layout", "", "Use the named spacing tokens rather than ad-hoc values.",
    "", "## Elevation & Depth", "", "Use the named shadows in `x-colophon.tokens.shadows` when elevation is needed.",
    "", "## Shapes", "", "Use the `rounded` tokens for corner radii.",
    "", "## Components", "",
    "Reuse [component patterns](.agents/design/components.jsonc); these describe design intent, not shipping code.",
    "Optional click-through flows live in `.agents/design/prototypes.jsonc`.",
    "", "## Do's and Don'ts", "");
  for (const p of tokens.principles || []) lines.push(`- ${p}`);
  for (const p of brand.antiReferences || []) lines.push(`- Avoid ${p}.`);
  if (tokens.authority?.port || tokens.authority?.portOverrides?.length) {
    lines.push("", "## Production implementation", "",
      "Follow `x-colophon.tokens.authority` for port targets, ownership, and synchronization.",
      "Colors are preview swatches: bind their mapped `resource` keys rather than hard-coding",
      "hex values. The shipping implementation is canonical; component patterns are not shipping code.");
  }
  lines.push("");
  const doc = new Document({ version: "alpha", ...projection(tokens) });
  const result = `---\n${doc.toString({ lineWidth: 0 })}---\n${lines.join("\n")}`;
  parseDesignMarkdown(result);
  return result;
}
