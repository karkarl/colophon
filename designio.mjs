// designio.mjs — locate, load, scaffold, and save the in-repo design system.
//
// The design system lives at <workspace>/.agents/design/:
//   design.json     tokens (brand, colors, typography, spacing, radii, shadows, principles)
//   components.jsx  pseudocode-React component patterns
//   principles.md   prose voice / do & don't
//
// When a workspace has no .agents/design/ yet, we fall back to the bundled
// sample so the canvas always renders something and `init` can seed a repo.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = path.join(HERE, "sample");
export const DESIGN_SUBPATH = ".agents/design";

export function designDirFor(workspacePath) {
  if (!workspacePath) return null;
  return path.join(workspacePath, DESIGN_SUBPATH);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readIfPresent(p) {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

// Load the design system for a workspace. Returns a normalized object plus the
// raw component/principles text and where it came from.
export async function loadDesign(workspacePath) {
  const dir = designDirFor(workspacePath);
  const usingRepo = dir && (await exists(path.join(dir, "design.json")));
  const baseDir = usingRepo ? dir : SAMPLE_DIR;

  const rawJson = await readIfPresent(path.join(baseDir, "design.json"));
  let tokens;
  let parseError = null;
  try {
    tokens = rawJson ? JSON.parse(rawJson) : {};
  } catch (err) {
    parseError = String(err && err.message ? err.message : err);
    // Fall back to the sample tokens so the canvas still renders.
    tokens = JSON.parse(await fs.readFile(path.join(SAMPLE_DIR, "design.json"), "utf8"));
  }

  const components = await readIfPresent(path.join(baseDir, "components.jsx"));
  const principles = await readIfPresent(path.join(baseDir, "principles.md"));

  return {
    source: usingRepo ? "repo" : "sample",
    dir: usingRepo ? dir : null,
    workspacePath: workspacePath || null,
    parseError,
    tokens,
    componentsSource: components || "",
    principlesMarkdown: principles || "",
  };
}

// Ensure the sibling scaffold files (components.jsx, principles.md) exist so any
// first save/init yields a complete .agents/design/. Returns the names written.
async function ensureSiblings(dir, { force = false, only } = {}) {
  const files = only || ["components.jsx", "principles.md"];
  const written = [];
  for (const name of files) {
    const dest = path.join(dir, name);
    if (!force && (await exists(dest))) continue;
    await fs.copyFile(path.join(SAMPLE_DIR, name), dest);
    written.push(name);
  }
  return written;
}

// Scaffold <workspace>/.agents/design/ (non-destructive). By default copies the
// bundled starter. Pass `tokens` to seed design.json from a specific token object
// (used by "from scratch", import, and scan). components.jsx + principles.md are
// always scaffolded from the sample so teams have patterns/prose to edit.
export async function initDesign(workspacePath, { force = false, tokens = null } = {}) {
  const dir = designDirFor(workspacePath);
  if (!dir) throw new Error("No workspace path available to scaffold .agents/design/");
  await fs.mkdir(dir, { recursive: true });

  const written = [];
  const skipped = [];
  const designDest = path.join(dir, "design.json");
  if (!force && (await exists(designDest))) {
    skipped.push("design.json");
  } else if (tokens) {
    const seeded = { ...tokens, meta: { ...(tokens.meta || {}), version: tokens?.meta?.version || 1, updatedAt: new Date().toISOString() } };
    await fs.writeFile(designDest, JSON.stringify(seeded, null, 2) + "\n", "utf8");
    written.push("design.json");
  } else {
    await fs.copyFile(path.join(SAMPLE_DIR, "design.json"), designDest);
    written.push("design.json");
  }

  for (const name of ["components.jsx", "principles.md"]) {
    const dest = path.join(dir, name);
    if (!force && (await exists(dest))) { skipped.push(name); continue; }
    await fs.copyFile(path.join(SAMPLE_DIR, name), dest);
    written.push(name);
  }
  return { dir, written, skipped };
}

// Persist edited tokens back to design.json (repo if present, else scaffold first).
// Also ensures components.jsx + principles.md exist so a first save is complete.
export async function saveTokens(workspacePath, tokens) {
  let dir = designDirFor(workspacePath);
  if (!dir) throw new Error("No workspace path available to save design.json");
  await fs.mkdir(dir, { recursive: true });
  const next = {
    ...tokens,
    meta: { ...(tokens.meta || {}), version: (tokens?.meta?.version || 0) + 1, updatedAt: new Date().toISOString() },
  };
  await fs.writeFile(path.join(dir, "design.json"), JSON.stringify(next, null, 2) + "\n", "utf8");
  const scaffolded = await ensureSiblings(dir);
  return { dir, tokens: next, scaffolded };
}

// ---- token helpers ---------------------------------------------------------

export function colorList(tokens) {
  const c = tokens?.colors;
  if (Array.isArray(c)) return c.map((x) => ({ name: x.name, value: x.value, usage: x.usage || "" }));
  if (c && typeof c === "object") return Object.entries(c).map(([name, value]) => ({ name, value, usage: "" }));
  return [];
}

// Build the CSS custom properties that both the canvas chrome and the live
// component previews consume: --color-*, --font-*, --space-*, --radius-*, --shadow-*.
export function tokensToCssVars(tokens) {
  const lines = [];
  for (const { name, value } of colorList(tokens)) lines.push(`--color-${name}: ${value};`);

  const ty = tokens?.typography || {};
  if (ty.display?.family) lines.push(`--font-display: ${ty.display.family};`);
  if (ty.body?.family) lines.push(`--font-body: ${ty.body.family};`);
  if (ty.mono?.family) lines.push(`--font-mono: ${ty.mono.family};`);

  for (const s of tokens?.spacing?.scale || []) lines.push(`--space-${s.name}: ${s.value};`);
  for (const r of tokens?.radii || []) lines.push(`--radius-${r.name}: ${r.value};`);
  for (const sh of tokens?.shadows || []) lines.push(`--shadow-${sh.name}: ${sh.value};`);

  return lines.join("\n  ");
}
