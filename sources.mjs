// sources.mjs — three ways to bring a design system into a repo:
//   scratchTokens()   -> a clean neutral skeleton to build up from
//   normalizeTokens() -> adaptively map arbitrary JSON tokens into our schema
//   scanCodebase()    -> extract the design system already implied by the code
//
// scan/import produce a *proposal* (tokens + evidence/warnings) that the canvas
// loads as an unsaved working copy, so a human refines it before Save to repo.

import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// 1. From scratch — neutral, honest defaults. One accent, system fonts.
// ---------------------------------------------------------------------------
export function scratchTokens({ name = "Untitled", tagline = "", description = "" } = {}) {
  return {
    $schema: "https://agents.design/schema/v1",
    meta: { version: 1, updatedBy: "scratch", note: "Fresh skeleton — replace these with your real brand." },
    brand: { name, tagline, description, surface: "product", voice: "", personality: [], antiReferences: [] },
    colors: [
      { name: "ink", value: "#141414", usage: "Primary text, headings" },
      { name: "paper", value: "#ffffff", usage: "App / page background" },
      { name: "surface", value: "#f6f6f6", usage: "Raised surfaces, inputs" },
      { name: "muted", value: "#6b6b6b", usage: "Secondary text, captions" },
      { name: "line", value: "#e4e4e4", usage: "Borders, dividers" },
      { name: "accent", value: "#2f6feb", usage: "Primary actions, links, focus" },
      { name: "accentInk", value: "#ffffff", usage: "Text on accent" },
      { name: "positive", value: "#2f7d55", usage: "Success states" },
      { name: "warning", value: "#9a6b00", usage: "Warnings" },
      { name: "critical", value: "#b42318", usage: "Errors, destructive" },
    ],
    typography: {
      display: { family: "system-ui, -apple-system, Segoe UI, sans-serif", weights: [600, 700], usage: "Headlines, section titles" },
      body: { family: "system-ui, -apple-system, Segoe UI, sans-serif", weights: [400, 500], usage: "Body copy, UI labels, buttons" },
      mono: { family: "ui-monospace, SFMono-Regular, Consolas, monospace", weights: [400], usage: "Code, data" },
      scale: [
        { name: "display", size: "40px", lineHeight: "46px", weight: 700, role: "display", tracking: "-0.02em" },
        { name: "title", size: "26px", lineHeight: "32px", weight: 700, role: "display", tracking: "-0.01em" },
        { name: "heading", size: "19px", lineHeight: "25px", weight: 600, role: "body" },
        { name: "body", size: "16px", lineHeight: "24px", weight: 400, role: "body" },
        { name: "small", size: "14px", lineHeight: "20px", weight: 400, role: "body" },
        { name: "caption", size: "12px", lineHeight: "16px", weight: 500, role: "mono" },
      ],
    },
    spacing: { unit: 4, scale: ["4px", "8px", "12px", "16px", "24px", "32px", "48px", "64px"].map((v, i) => ({ name: String(i + 1), value: v })) },
    radii: [ { name: "sm", value: "4px" }, { name: "md", value: "8px" }, { name: "lg", value: "14px" }, { name: "pill", value: "999px" } ],
    shadows: [
      { name: "sm", value: "0 1px 2px rgba(0,0,0,0.06)" },
      { name: "md", value: "0 4px 16px rgba(0,0,0,0.08)" },
      { name: "lg", value: "0 12px 40px rgba(0,0,0,0.12)" },
    ],
    principles: [
      "Establish hierarchy with size, weight, and space before reaching for color.",
      "Keep one accent so it always means \"act here\".",
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. Import — normalize arbitrary token JSON into our schema (best-effort).
//    Understands: our own schema, flat { name: hex } color maps, nested
//    { colors|palette, typography|fonts, spacing|space, radii|radius|borderRadius,
//    shadows|boxShadow }, and W3C-ish { $value } tokens.
// ---------------------------------------------------------------------------
const COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^(?:rgb|rgba|hsl|hsla)\(/i;
const isColor = (v) => typeof v === "string" && COLOR_RE.test(v.trim());
const val = (v) => (v && typeof v === "object" && "$value" in v ? v.$value : v);

function flattenColors(obj, prefix = "", out = []) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, raw] of Object.entries(obj)) {
    const v = val(raw);
    const name = prefix ? `${prefix}-${k}` : k;
    if (isColor(v)) out.push({ name, value: String(v).trim(), usage: "" });
    else if (v && typeof v === "object") flattenColors(v, name, out);
  }
  return out;
}

function pickSizeList(obj) {
  const out = [];
  if (Array.isArray(obj)) obj.forEach((v, i) => out.push({ name: String(i + 1), value: String(val(v)) }));
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) out.push({ name: k, value: String(val(v)) });
  return out.filter((x) => x.value && x.value !== "undefined");
}

export function normalizeTokens(raw, { sourceName } = {}) {
  const warnings = [];
  if (!raw || typeof raw !== "object") throw new Error("Imported JSON is not an object.");

  // Already our schema? Pass through with light validation.
  if (raw.brand || raw.$schema?.includes("agents.design")) {
    const t = { ...scratchTokens(), ...raw };
    t.meta = { ...(t.meta || {}), updatedBy: "import", note: `Imported${sourceName ? " from " + sourceName : ""}` };
    return { tokens: t, warnings };
  }

  const base = scratchTokens();
  const colorsSrc = raw.colors || raw.palette || raw.color || (Object.values(raw).every(isColor) ? raw : null) || raw;
  let colors = flattenColors(colorsSrc);
  if (!colors.length) { colors = base.colors; warnings.push("No colors found in the imported JSON; kept neutral defaults."); }

  const t = { ...base, colors };
  t.meta = { version: 1, updatedBy: "import", note: `Imported${sourceName ? " from " + sourceName : ""} — refine before shipping.` };

  // Typography
  const ty = raw.typography || raw.fonts || raw.fontFamily || raw.font;
  if (ty && typeof ty === "object") {
    const fam = (x) => (Array.isArray(x) ? x.join(", ") : typeof x === "string" ? x : val(x?.family) || null);
    const display = fam(ty.display || ty.heading || ty.serif || ty.title);
    const body = fam(ty.body || ty.sans || ty.base || ty.default);
    const mono = fam(ty.mono || ty.code || ty.monospace);
    if (display) t.typography.display.family = display;
    if (body) t.typography.body.family = body;
    if (mono) t.typography.mono.family = mono;
  }

  // Spacing / radii / shadows
  const sp = pickSizeList(raw.spacing || raw.space || raw.spacings);
  if (sp.length) t.spacing = { unit: 4, scale: sp };
  const rad = pickSizeList(raw.radii || raw.radius || raw.borderRadius || raw.radiuses);
  if (rad.length) t.radii = rad;
  const sh = pickSizeList(raw.shadows || raw.boxShadow || raw.elevation);
  if (sh.length) t.shadows = sh;

  return { tokens: t, warnings };
}

// ---------------------------------------------------------------------------
// 3. Scan — read the codebase and infer the design system already in use.
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".agents", "dist", "build", "out", ".next", ".nuxt",
  ".svelte-kit", "coverage", "vendor", ".turbo", ".cache", "__pycache__", ".venv",
  "bin", "obj", "target", ".idea", ".vscode",
]);
const SCAN_EXT = new Set([".css", ".scss", ".sass", ".less", ".pcss", ".styl", ".html", ".htm", ".vue", ".svelte", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".astro"]);
const MAX_FILES = 600;
const MAX_BYTES = 600 * 1024;

async function walk(dir, files, budget) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (files.length >= MAX_FILES) return;
    if (e.name.startsWith(".") && e.name !== ".agents") { /* skip dotfiles except handled */ }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      await walk(full, files, budget);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      const isTailwind = /^tailwind\.config\.(js|cjs|mjs|ts)$/.test(e.name);
      if (SCAN_EXT.has(ext) || isTailwind) files.push(full);
    }
  }
}

function bump(map, key, n = 1) { map.set(key, (map.get(key) || 0) + n); }
function topN(map, n) { return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); }

// crude luminance for classifying neutrals
function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function luminance(hex) { const c = hexToRgb(hex); return c ? (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 : 0.5; }
function saturation(hex) {
  const c = hexToRgb(hex); if (!c) return 0;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === 0) return 0; return (mx - mn) / mx;
}
function normHex(s) {
  let h = s.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(h)) h = "#" + h.slice(1).split("").map((c) => c + c).join("");
  return h;
}

export async function scanCodebase(workdir, { pkgName } = {}) {
  if (!workdir) throw new Error("No working directory to scan.");
  const files = [];
  await walk(workdir, files, {});

  const hexes = new Map();       // #rrggbb -> count
  const rgbish = new Map();      // rgb()/hsl() literal -> count
  const cssVars = new Map();     // --name -> { value, count }
  const fontDecls = new Map();   // font-family string -> count
  const radii = new Map();
  const shadows = new Map();
  const spacing = new Map();     // px/rem value -> count
  let scanned = 0;

  const hexRe = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g;
  const funcColorRe = /(?:rgba?|hsla?)\([^)]*\)/gi;
  const cssVarRe = /(--[a-z0-9-]+)\s*:\s*([^;{}\n]+)[;}]/gi;
  const fontRe = /font-family\s*:\s*([^;{}\n]+)[;}]/gi;
  const fontKeyRe = /fontFamily\s*:\s*(\[[^\]]+\]|"[^"]+"|'[^']+'|`[^`]+`)/g;
  const radiusRe = /border-radius\s*:\s*([^;{}\n]+)[;}]/gi;
  const shadowRe = /box-shadow\s*:\s*([^;{}\n]+)[;}]/gi;
  const spaceRe = /(?:padding|margin|gap)[a-z-]*\s*:\s*([^;{}\n]+)[;}]/gi;
  const lenRe = /\b(\d{1,3}(?:\.\d+)?)(px|rem)\b/g;

  for (const file of files) {
    let text;
    try {
      const st = await fs.stat(file);
      if (st.size > MAX_BYTES) continue;
      text = await fs.readFile(file, "utf8");
    } catch { continue; }
    scanned++;

    for (const m of text.matchAll(hexRe)) bump(hexes, normHex(m[0]));
    for (const m of text.matchAll(funcColorRe)) bump(rgbish, m[0].replace(/\s+/g, ""));
    for (const m of text.matchAll(cssVarRe)) {
      const name = m[1]; const value = m[2].trim();
      const cur = cssVars.get(name) || { value, count: 0 };
      cur.count++; cur.value = value; cssVars.set(name, cur);
    }
    for (const m of text.matchAll(fontRe)) { const f = m[1].trim().replace(/["']/g, ""); if (f && !/^(var\(|inherit|initial|unset|none|revert)/i.test(f)) bump(fontDecls, f); }
    for (const m of text.matchAll(fontKeyRe)) { const f = m[1].replace(/[[\]"'`]/g, "").trim(); if (f && !/^(var\(|inherit)/i.test(f)) bump(fontDecls, f); }
    for (const m of text.matchAll(radiusRe)) { const v = m[1].trim(); if (/^\d/.test(v) || v.includes("px") || v.includes("rem") || v.includes("%")) bump(radii, v); }
    for (const m of text.matchAll(shadowRe)) { const v = m[1].trim(); if (v && v !== "none") bump(shadows, v); }
    for (const m of text.matchAll(spaceRe)) { for (const l of m[1].matchAll(lenRe)) bump(spacing, `${l[1]}${l[2]}`); }
  }

  // --- Build proposed tokens ------------------------------------------------
  // Colors: prefer named CSS variables whose value is a color, then fill with
  // the most frequent literal hex colors.
  const varColors = [...cssVars.entries()]
    .filter(([, v]) => isColor(v.value))
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, v]) => ({ name: name.replace(/^--/, ""), value: normHex(v.value), usage: `from ${name}`, count: v.count }));

  const litColors = topN(hexes, 24).map(([value, count]) => ({ value, count }));

  const proposedColors = dedupeColors(varColors, litColors);
  const colors = proposedColors.length ? assignSemanticNames(proposedColors) : scratchTokens().colors;

  const tokens = scratchTokens({ name: pkgName || path.basename(workdir) });
  tokens.meta = { version: 1, updatedBy: "scan", note: `Scanned ${scanned} files in ${path.basename(workdir)} — a proposal to refine, not gospel.` };
  tokens.colors = colors;

  // Fonts
  const fonts = topN(fontDecls, 6).map(([f]) => f).filter(Boolean);
  const mono = fonts.find((f) => /mono|consol|menlo|courier|ui-monospace/i.test(f));
  const serif = fonts.find((f) => /serif|georgia|times|garamond|fraunces|playfair/i.test(f) && !/sans/i.test(f));
  const sans = fonts.find((f) => !/mono|serif/i.test(f)) || fonts[0];
  if (serif) tokens.typography.display.family = serif;
  else if (sans) tokens.typography.display.family = sans;
  if (sans) tokens.typography.body.family = sans;
  if (mono) tokens.typography.mono.family = mono;

  const rad = topN(radii, 4).map(([value], i) => ({ name: ["sm", "md", "lg", "pill"][i] || `r${i}`, value }));
  if (rad.length) tokens.radii = rad;
  const sh = topN(shadows, 3).map(([value], i) => ({ name: ["sm", "md", "lg"][i] || `s${i}`, value }));
  if (sh.length) tokens.shadows = sh;
  const sp = topN(spacing, 8)
    .map(([value]) => value)
    .sort((a, b) => parseFloat(a) - parseFloat(b));
  if (sp.length >= 3) tokens.spacing = { unit: 4, scale: sp.map((value, i) => ({ name: String(i + 1), value })) };

  const evidence = {
    scannedFiles: scanned,
    totalCandidateFiles: files.length,
    uniqueColors: hexes.size + rgbish.size,
    cssVariables: cssVars.size,
    colorVariables: varColors.length,
    topColors: litColors.slice(0, 10),
    fonts,
    hasTailwind: files.some((f) => /tailwind\.config\./.test(f)),
  };
  return { tokens, evidence };
}

function dedupeColors(varColors, litColors) {
  const seen = new Set();
  const out = [];
  for (const c of varColors) {
    const key = c.value;
    if (seen.has(key) || !hexToRgb(key)) continue;
    seen.add(key); out.push(c);
  }
  for (const c of litColors) {
    if (seen.has(c.value) || !hexToRgb(c.value)) continue;
    seen.add(c.value); out.push({ name: null, value: c.value, usage: "", count: c.count });
  }
  return out.slice(0, 12);
}

// Give unnamed scanned colors semantic-ish names by lightness/saturation so the
// result reads like a design system instead of a swatch dump.
function assignSemanticNames(list) {
  const named = list.filter((c) => c.name);
  const unnamed = list.filter((c) => !c.name);
  const usedRoles = new Set(named.map((c) => c.name));
  const takeRole = (role) => { if (usedRoles.has(role)) return null; usedRoles.add(role); return role; };

  // Sort unnamed by luminance to find ink (darkest) and paper (lightest).
  const byLum = [...unnamed].sort((a, b) => luminance(a.value) - luminance(b.value));
  const result = [...named];
  if (byLum.length) {
    const ink = byLum[0]; const paper = byLum[byLum.length - 1];
    const accent = [...unnamed].filter((c) => c !== ink && c !== paper).sort((a, b) => saturation(b.value) - saturation(a.value))[0];
    for (const c of unnamed) {
      let role;
      if (c === ink) role = takeRole("ink");
      else if (c === paper) role = takeRole("paper");
      else if (c === accent) role = takeRole("accent");
      role = role || takeRole(`color-${result.length + 1}`) || `color-${result.length + 1}`;
      result.push({ name: role, value: c.value, usage: c.usage || `${c.count || ""} uses`.trim() });
    }
  }
  return result;
}
