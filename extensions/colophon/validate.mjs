// validate.mjs — a schema / parse / render smoke-check for .agents/design/*.
//
// Two layers, so drift is caught automatically:
//   validateTokens(tokens)        — parse + structural checks on design.json
//   validateComponents(src)       — structural checks on components.jsonc
//   validateDesignDir(dir)        — read both from disk and aggregate
//
// The design.json checks are authoritative (JSON parses, required shape present,
// theme/resource contract honored when a port target is set). The components.jsonc
// check verifies valid JSON, that each component has a name + root, that node kinds
// are known, and that component references resolve — the same doc the canvas renders
// with a pure interpreter (no React/Babel needed), so what validates here previews there.
//
// Run as a CLI to gate CI:  node validate.mjs [path-to/.agents/design]
// Exits 0 when valid (warnings allowed), 1 on errors or a JSON parse failure.

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { colorList, readAuthority, baseColorValue, THEMES } from "./designio.mjs";
import { validateComponentsDoc, COMPONENTS_FILENAME } from "./componentsio.mjs";

// ---- design.json -----------------------------------------------------------
export function validateTokens(tokens) {
  const errors = [];
  const warnings = [];
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return { ok: false, errors: ["design.json is not a JSON object."], warnings };
  }

  const brand = tokens.brand || {};
  if (!brand.name) warnings.push("brand.name is empty — the system has no name.");

  const colors = colorList(tokens);
  if (!colors.length) errors.push("No colors defined (colors[] is empty).");
  const seen = new Set();
  for (const c of colors) {
    if (!c.name) { errors.push("A color entry is missing a name."); continue; }
    if (seen.has(c.name)) errors.push(`Duplicate color name: "${c.name}".`);
    else seen.add(c.name);
    if (!baseColorValue(c)) errors.push(`Color "${c.name}" has no value or themes.light preview.`);
    if (c.themes && typeof c.themes === "object") {
      for (const k of Object.keys(c.themes)) {
        if (!THEMES.includes(k)) warnings.push(`Color "${c.name}" has unknown theme "${k}" (expected ${THEMES.join("/")}).`);
      }
    }
  }

  const ty = tokens.typography || {};
  if (!ty.body || !ty.body.family) warnings.push("typography.body.family is empty.");
  if (!Array.isArray(ty.scale) || !ty.scale.length) warnings.push("typography.scale is empty.");

  if (!Array.isArray(tokens.spacing?.scale) || !tokens.spacing.scale.length) warnings.push("spacing.scale is empty.");
  if (!Array.isArray(tokens.principles) || !tokens.principles.length) warnings.push("principles[] is empty.");

  // Port / theme contract. When a port target exists, the shipping implementation is
  // canonical: preview hex must map to a `resource` key, and an owner + sync process
  // must be named so the derived examples stay aligned.
  const authority = readAuthority(tokens);
  if (authority.hasPort) {
    // These three are the drift contract: when the shipping implementation is
    // canonical, agents must be told how to bind the real resource, who owns it,
    // and how the preview stays aligned. Missing any of them lets design and code
    // drift silently, so they are errors (non-zero exit) — not advisories.
    const missing = colors.filter((c) => !c.resource).map((c) => c.name);
    if (missing.length) {
      errors.push(
        `A port target is set (shipping implementation is canonical), but ${missing.length} color(s) have no ` +
          `\`resource\` mapping, so agents only have preview hex to bind: ${missing.join(", ")}.`,
      );
    }
    if (!authority.owner) errors.push("A port target is set but authority.owner does not name who owns the canonical implementation.");
    if (!authority.syncProcess) errors.push("A port target is set but authority.syncProcess does not describe how the examples stay aligned.");
    if (authority.port && !authority.port.syncSource) warnings.push("The default port target has no syncSource (reference/skill to port design → code).");
    for (const o of authority.portOverrides) {
      if (!o.syncSource) {
        const scope = o.area || (o.components.length ? o.components.join(", ") : "override");
        warnings.push(`Port override "${scope}" has no syncSource.`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---- components.jsonc ------------------------------------------------------
// Structural check on the component definitions: valid JSON, each component has a
// name + root, node kinds are known, and component references resolve. The canvas
// renders the same doc with a pure interpreter (no React/Babel), so what validates
// here is what previews there.
export function validateComponents(src) {
  const text = typeof src === "string" ? src : "";
  if (!text.trim()) {
    return { ok: true, errors: [], warnings: ["components.jsonc is empty — no component patterns to preview."], exports: [] };
  }
  const res = validateComponentsDoc(null, { text });
  return { ok: res.ok, errors: res.errors, warnings: res.warnings, exports: res.names };
}

// ---- aggregate over a directory -------------------------------------------
export async function validateDesignDir(dir) {
  const out = { dir, ok: false, parseError: null, design: null, components: null };
  let raw;
  try {
    raw = await fs.readFile(path.join(dir, "design.json"), "utf8");
  } catch (err) {
    out.parseError = `Could not read design.json: ${String(err && err.message ? err.message : err)}`;
    return out;
  }
  let tokens;
  try {
    tokens = JSON.parse(raw);
  } catch (err) {
    out.parseError = `design.json is not valid JSON: ${String(err && err.message ? err.message : err)}`;
    return out;
  }
  out.design = validateTokens(tokens);

  let csrc = "";
  try { csrc = await fs.readFile(path.join(dir, COMPONENTS_FILENAME), "utf8"); } catch { /* optional */ }
  out.components = validateComponents(csrc);

  out.ok = !out.parseError && out.design.ok && out.components.ok;
  return out;
}

// Flatten an aggregate result into { ok, errors, warnings } for API/UI consumers.
export function flattenResult(res) {
  const errors = [];
  const warnings = [];
  if (res.parseError) errors.push(res.parseError);
  if (res.design) { errors.push(...res.design.errors); warnings.push(...res.design.warnings); }
  if (res.components) { errors.push(...res.components.errors); warnings.push(...res.components.warnings); }
  return { ok: errors.length === 0, errors, warnings };
}

// ---- CLI -------------------------------------------------------------------
async function runCli(argv) {
  const target = argv[2] || path.join(process.cwd(), ".agents", "design");
  const res = await validateDesignDir(target);
  const flat = flattenResult(res);
  const label = path.relative(process.cwd(), res.dir) || res.dir;
  if (flat.errors.length) {
    console.error(`✗ ${label}: ${flat.errors.length} error(s)`);
    for (const e of flat.errors) console.error(`  • ${e}`);
  }
  if (flat.warnings.length) {
    console.warn(`⚠ ${label}: ${flat.warnings.length} warning(s)`);
    for (const w of flat.warnings) console.warn(`  • ${w}`);
  }
  if (flat.ok) console.log(`✓ ${label}: design system is valid${flat.warnings.length ? " (with warnings)" : ""}.`);
  process.exit(flat.ok ? 0 : 1);
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  runCli(process.argv).catch((err) => {
    console.error("validate failed:", err && err.message ? err.message : err);
    process.exit(2);
  });
}
