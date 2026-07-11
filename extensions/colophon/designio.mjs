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

// AGENTS.md is the emerging cross-agent convention ("README for agents"): a file
// agents load by default. The design system in .agents/design/ is only picked up
// when something already-loaded points to it, so seeding drops an idempotent
// pointer here — this is what makes the system reach agents beyond Copilot.
export const AGENTS_FILE = "AGENTS.md";
const BLOCK_START = "<!-- colophon:start -->";
const BLOCK_END = "<!-- colophon:end -->";

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
  const agents = await ensureAgentsPointer(workspacePath);
  return { dir, written, skipped, agents };
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
  const agents = await ensureAgentsPointer(workspacePath);
  return { dir, tokens: next, scaffolded, agents };
}

// The managed AGENTS.md block, from the start marker to the end marker inclusive
// (no surrounding blank lines — the newlines around it are managed separately so it
// sits cleanly wherever it lands). Kept independent of the specific tokens so
// re-seeding never rewrites it and editing the design system never churns it. The
// `eol` is applied so the block matches the host file's line-ending style.
function agentsBlock(eol = "\n") {
  return [
    BLOCK_START,
    "## Design system",
    "",
    "This repository has a living design system at [`.agents/design/`](.agents/design/).",
    "**Read it before creating or changing any UI** — pages, components, layouts, CSS, or themes:",
    "",
    "- `.agents/design/design.json` — design tokens: brand, colors, typography, spacing, radii, shadows, principles.",
    "- `.agents/design/components.jsx` — the component patterns to reuse (structure, variants, states).",
    "- `.agents/design/principles.md` — voice, information hierarchy, and do/don't guidance.",
    "",
    "Generate UI from these tokens and patterns: use token names (e.g. `accent`, `ink`, spacing step " +
      "`4`, radius `md`), not raw hex or ad-hoc px; reuse the documented components instead of inventing " +
      "new ones; honor the brand voice; and avoid the system's listed anti-references. If you need a value " +
      "the system doesn't cover, add it to `.agents/design/` rather than hard-coding a one-off.",
    "",
    "<sub>Managed by [Colophon](https://github.com/karkarl/colophon) — edit `.agents/design/` to change the " +
      "system; this block only points to it.</sub>",
    BLOCK_END,
  ].join(eol);
}

// Match a whole well-formed managed block, EOL-agnostic and anchored to line
// starts — so the markers must *begin a line* (an inline mention of the marker
// strings in prose is not treated as a block). Non-greedy so a START pairs with
// the nearest following END; global so we can find and dedupe multiple blocks.
const BLOCK_RE = /^[ \t]*<!-- colophon:start -->[\s\S]*?<!-- colophon:end -->[ \t]*$/gm;

// Write atomically (temp + rename) and never through a symlink: a repo that ships
// AGENTS.md as a symlink can't redirect the write elsewhere, and a crash mid-write
// can't truncate the file. Returns false (skipped) when the path is a symlink.
async function writeFileSafely(file, content) {
  try {
    const st = await fs.lstat(file);
    if (st.isSymbolicLink()) return false;
  } catch { /* ENOENT — file doesn't exist yet, which is fine */ }
  const tmp = `${file}.colophon-tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
  return true;
}

// Ensure the repo-root AGENTS.md contains Colophon's pointer block. Idempotent,
// non-destructive, and best-effort — it never throws, reporting the outcome via
// `action` instead so a failure here can't break the caller's token save:
//   - no file                 -> create it with the block            ("created")
//   - file, block present      -> replace in place, dedupe extras     ("updated"/"unchanged")
//   - file, no block           -> append the block, preserve content  ("updated")
//   - file, stray/partial marker but no valid block -> leave it alone ("skipped-malformed")
//   - symlink / write error    -> leave it alone      ("skipped-symlink"/"failed")
// Handles CRLF/LF, orphaned or duplicated markers, and symlinked targets.
export async function ensureAgentsPointer(workspacePath) {
  if (!workspacePath) return { file: null, action: "skipped" };
  const file = path.join(workspacePath, AGENTS_FILE);
  try {
    const existing = await readIfPresent(file);

    if (existing == null) {
      const ok = await writeFileSafely(file, agentsBlock("\n") + "\n");
      return { file, action: ok ? "created" : "skipped-symlink" };
    }

    const eol = existing.includes("\r\n") ? "\r\n" : "\n";
    const canonical = agentsBlock(eol);
    const matches = [...existing.matchAll(BLOCK_RE)];

    let next;
    if (matches.length) {
      // Replace the first well-formed block with the canonical one; drop duplicates.
      let out = "";
      let cursor = 0;
      matches.forEach((m, i) => {
        out += existing.slice(cursor, m.index);
        if (i === 0) out += canonical;
        cursor = m.index + m[0].length;
      });
      next = out + existing.slice(cursor);
    } else if (existing.includes(BLOCK_START) || existing.includes(BLOCK_END)) {
      // A stray/partial marker exists but no valid block: appending would risk
      // pairing our new END with the stray START and swallowing content between.
      // Leave it for a human rather than mutate blindly.
      return { file, action: "skipped-malformed" };
    } else {
      const sep = existing === "" ? "" : existing.endsWith(eol + eol) ? "" : existing.endsWith(eol) ? eol : eol + eol;
      next = existing + sep + canonical + eol;
    }

    if (next === existing) return { file, action: "unchanged" };
    const ok = await writeFileSafely(file, next);
    return { file, action: ok ? "updated" : "skipped-symlink" };
  } catch (err) {
    return { file, action: "failed", error: String(err?.message || err) };
  }
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
