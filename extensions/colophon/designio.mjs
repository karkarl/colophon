// designio.mjs — locate, load, scaffold, and save the in-repo design system.
//
// The design system lives at <workspace>/.agents/design/:
//   design.json       tokens (brand, colors, typography, spacing, radii, shadows, principles)
//   components.jsonc   component patterns as a framework-agnostic element tree
//   principles.md      prose voice / do & don't
//
// When a workspace has no .agents/design/ yet, we fall back to the bundled
// sample so the canvas always renders something and `init` can seed a repo.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS_FILENAME, parseComponents, emptyComponents } from "./componentsio.mjs";

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

  const compInfo = await loadComponentsFrom(baseDir);
  const principles = await readIfPresent(path.join(baseDir, "principles.md"));

  return {
    source: usingRepo ? "repo" : "sample",
    dir: usingRepo ? dir : null,
    workspacePath: workspacePath || null,
    parseError,
    tokens,
    componentsSource: compInfo.text,
    componentsDoc: compInfo.doc,
    componentsFormat: compInfo.format,
    componentsError: compInfo.error,
    principlesMarkdown: principles || "",
  };
}

// Read the components definition, preferring the current components.jsonc format and
// falling back to a legacy components.jsx (exposed as raw text with format "jsx" and a
// null doc, so the canvas can show it read-only and prompt a migration). Returns
// { text, format: "jsonc" | "jsx" | null, doc, error }.
async function loadComponentsFrom(baseDir) {
  const jsoncRaw = await readIfPresent(path.join(baseDir, COMPONENTS_FILENAME));
  if (jsoncRaw != null) {
    try {
      return { text: jsoncRaw, format: "jsonc", doc: parseComponents(jsoncRaw), error: null };
    } catch (err) {
      return { text: jsoncRaw, format: "jsonc", doc: emptyComponents(), error: String(err && err.message ? err.message : err) };
    }
  }
  const jsxRaw = await readIfPresent(path.join(baseDir, "components.jsx"));
  if (jsxRaw != null) {
    return { text: jsxRaw, format: "jsx", doc: null, error: null };
  }
  return { text: "", format: null, doc: emptyComponents(), error: null };
}

// Ensure the sibling scaffold files (components.jsonc, principles.md) exist so any
// first save/init yields a complete .agents/design/. Returns the names written.
async function ensureSiblings(dir, { force = false, only } = {}) {
  const files = only || [COMPONENTS_FILENAME, "principles.md"];
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
// (used by "from scratch", import, and scan). components.jsonc + principles.md are
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

  for (const name of [COMPONENTS_FILENAME, "principles.md"]) {
    const dest = path.join(dir, name);
    if (!force && (await exists(dest))) { skipped.push(name); continue; }
    await fs.copyFile(path.join(SAMPLE_DIR, name), dest);
    written.push(name);
  }
  const agents = await ensureAgentsPointer(workspacePath);
  return { dir, written, skipped, agents };
}

// Persist edited tokens back to design.json (repo if present, else scaffold first).
// Also ensures components.jsonc + principles.md exist so a first save is complete.
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
// re-seeding never rewrites it and editing the design system never churns it — the
// only thing that varies is the `authority` framing (canonical vs derived), because
// that changes what agents are being *told to do* with the files. The `eol` is
// applied so the block matches the host file's line-ending style.
function agentsBlock(eol = "\n", authority = { hasPort: false, port: null, portOverrides: [] }) {
  const hasPort = !!authority?.hasPort;
  const lead = hasPort
    ? [
        "This repository has a living design system at [`.agents/design/`](.agents/design/). " +
          "These files are the **source of truth for design** — tokens, component intent, and " +
          "principles — and are framework-agnostic. `components.jsonc` shows design intent for preview; " +
          "it is **not** shipping code.",
        "**Read it before creating or changing any UI.** To ship, port the design into this app's " +
          "implementation using the port target(s) below — don't copy `components.jsonc` verbatim.",
      ]
    : [
        "This repository has a living design system at [`.agents/design/`](.agents/design/).",
        "**Read it before creating or changing any UI** — pages, components, layouts, CSS, or themes:",
      ];
  const lines = [
    BLOCK_START,
    "## Design system",
    "",
    ...lead,
    "",
    "- `.agents/design/design.json` — design tokens: brand, colors, typography, spacing, radii, shadows, principles.",
    "- `.agents/design/components.jsonc` — the component patterns to reuse (structure, variants, states).",
    "- `.agents/design/principles.md` — voice, information hierarchy, and do/don't guidance.",
    "",
    "Generate UI from these tokens and patterns: use token names (e.g. `accent`, `ink`, spacing step " +
      "`4`, radius `md`), not raw hex or ad-hoc px; reuse the documented components instead of inventing " +
      "new ones; honor the brand voice; and avoid the system's listed anti-references. If you need a value " +
      "the system doesn't cover, add it to `.agents/design/` rather than hard-coding a one-off.",
  ];
  if (hasPort) {
    lines.push(
      "",
      "**Port targets** — how a design becomes shipping code here (design stays the source of truth; " +
        "these say what each surface ships as and which reference/skill to port it with):",
      ...portLines(authority, { bullet: "- " }),
    );
    lines.push(
      "",
      "Colors in `design.json` are **preview-only** swatches. When a color has a `resource` (e.g. a WinUI " +
        "`ThemeResource` key), bind that resource in code — never hard-code the preview hex — so light, dark, " +
        "and high-contrast themes stay correct. The shipping implementation is canonical; treat `components.jsonc` " +
        "and the token values as derived visual examples, not a parallel upstream source.",
    );
  }
  lines.push(
    "",
    "<sub>Managed by [Colophon](https://github.com/karkarl/colophon) — edit `.agents/design/` to change the " +
      "system; this block only points to it.</sub>",
    BLOCK_END,
  );
  return lines.join(eol);
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

// Best-effort read of the design system's authority model from the on-disk
// design.json, so the AGENTS.md pointer frames the files correctly (design source
// of truth + any port targets). Falls back to design-only if missing/unparseable.
async function authorityFor(workspacePath) {
  const dir = designDirFor(workspacePath);
  if (!dir) return readAuthority(null);
  const raw = await readIfPresent(path.join(dir, "design.json"));
  try {
    return readAuthority(raw ? JSON.parse(raw) : null);
  } catch {
    return readAuthority(null);
  }
}

// Ensure the repo-root AGENTS.md contains Colophon's pointer block. Idempotent,
// non-destructive, and best-effort — it never throws, reporting the outcome via
// `action` instead so a failure here can't break the caller's token save:
//   - no file                 -> create it with the block            ("created")
//   - file, block present      -> replace in place, dedupe extras     ("updated"/"unchanged")
//   - file, no block           -> append the block, preserve content  ("updated")
//   - file, stray/partial marker but no valid block -> leave it alone ("skipped-malformed")
//   - symlink / write error    -> leave it alone      ("skipped-symlink"/"failed")
// Handles CRLF/LF, orphaned or duplicated markers, and symlinked targets. The block
// text reflects the system's authority model (design source of truth + port targets).
export async function ensureAgentsPointer(workspacePath) {
  if (!workspacePath) return { file: null, action: "skipped" };
  const file = path.join(workspacePath, AGENTS_FILE);
  const authority = await authorityFor(workspacePath);
  try {
    const existing = await readIfPresent(file);

    if (existing == null) {
      const ok = await writeFileSafely(file, agentsBlock("\n", authority) + "\n");
      return { file, action: ok ? "created" : "skipped-symlink" };
    }

    const eol = existing.includes("\r\n") ? "\r\n" : "\n";
    const block = agentsBlock(eol, authority);
    const matches = [...existing.matchAll(BLOCK_RE)];

    let next;
    if (matches.length) {
      // Replace the first well-formed block with the fresh one; drop duplicates.
      let out = "";
      let cursor = 0;
      matches.forEach((m, i) => {
        out += existing.slice(cursor, m.index);
        if (i === 0) out += block;
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
      next = existing + sep + block + eol;
    }

    if (next === existing) return { file, action: "unchanged" };
    const ok = await writeFileSafely(file, next);
    return { file, action: ok ? "updated" : "skipped-symlink" };
  } catch (err) {
    return { file, action: "failed", error: String(err?.message || err) };
  }
}

// ---- token helpers ---------------------------------------------------------

// The design system's *authority model*. Two orthogonal axes:
//
//   1. Design authority — the files in .agents/design/ are the source of truth for
//      DESIGN (tokens, component intent, principles). They are framework-agnostic:
//      the JSON element tree in components.jsonc is a canvas rendering convenience,
//      NOT shipping code. `designSource` defaults to "self" (these files).
//
//   2. Implementation / port authority — how a design becomes shipping code, which
//      is framework-specific and can vary per surface. A `port` target names:
//        - authoritySource: what the surface actually ships as / wins for
//          implementation (e.g. "Native WinUI 3 / C#", "React web", "SwiftUI").
//        - syncSource: the reference/skill an agent uses to port design → that
//          implementation (e.g. github.com/microsoft/win-dev-skills).
//        - helperAgent: an optional skill/agent that performs the port (may be
//          absent — e.g. Reactor has none yet).
//        - owner: an optional owner of the canonical shipping implementation for
//          that surface (who keeps the derived examples aligned).
//      `port` is the app-wide default; `portOverrides` override it per area or per
//      component (e.g. a React-style chat surface targeting Reactor). The authority
//      block also carries an app-wide `owner` and a `syncProcess` (how the design
//      examples stay aligned with the canonical implementation).
//
//   When a port target exists the shipping implementation is canonical, so each
//   color's hex is PREVIEW-ONLY and should map to an implementation `resource` key
//   (e.g. a WinUI ThemeResource) that agents bind instead of the raw value. Colors
//   may also carry per-theme preview values under `themes` (light/dark/highContrast).
//
// No port/overrides ⇒ the files are both the design and the implementation source
// of truth (web/JSX repos) — the original behavior. Everything normalizes so a
// missing/partial block is safe.
function normPortTarget(p) {
  if (!p || typeof p !== "object") return null;
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const authoritySource = str(p.authoritySource);
  const syncSource = str(p.syncSource);
  const helperAgent = str(p.helperAgent);
  const owner = str(p.owner);
  if (!authoritySource && !syncSource && !helperAgent && !owner) return null;
  return { authoritySource, syncSource, helperAgent, owner };
}

export function readAuthority(tokens) {
  const a = (tokens && typeof tokens.authority === "object" && tokens.authority) || {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const designSource = str(a.designSource) || "self";
  // Who owns the canonical (shipping) implementation and the process that keeps the
  // design-file examples aligned with it. Only meaningful when there's a port target
  // (native/other implementation is canonical); harmless otherwise.
  const owner = str(a.owner);
  const syncProcess = str(a.syncProcess);

  const port = normPortTarget(a.port);
  const portOverrides = (Array.isArray(a.portOverrides) ? a.portOverrides : [])
    .map((o) => {
      const base = normPortTarget(o) || { authoritySource: "", syncSource: "", helperAgent: "", owner: "" };
      const components = Array.isArray(o.components) ? o.components.map(str).filter(Boolean) : [];
      return { area: str(o.area), components, ...base };
    })
    .filter((o) => o.area || o.components.length || o.authoritySource || o.syncSource || o.helperAgent || o.owner);

  return {
    designSource,
    designIsSelf: designSource === "self" || designSource === "",
    owner,
    syncProcess,
    hasPort: !!port || portOverrides.length > 0,
    port,
    portOverrides,
  };
}

// Human-readable lines describing the port targets, reused by the summary, the
// AGENTS.md pointer, and the injected context. `bullet` prefixes list items.
export function portLines(authority, { bullet = "- " } = {}) {
  const lines = [];
  const fmt = (t) => {
    const ships = t.authoritySource || "(unspecified)";
    const via = t.syncSource ? ` — port via ${t.syncSource}` : " — no sync source set";
    const helper = t.helperAgent ? ` (helper agent: ${t.helperAgent})` : (t.syncSource ? " (no helper agent yet)" : "");
    const owner = t.owner ? ` [owner: ${t.owner}]` : "";
    return `ships as ${ships}${via}${helper}${owner}`;
  };
  if (authority.port) lines.push(`${bullet}Default: ${fmt(authority.port)}`);
  for (const o of authority.portOverrides) {
    const scope = [o.area && `area "${o.area}"`, o.components.length && `components ${o.components.join(", ")}`]
      .filter(Boolean).join(", ") || "override";
    lines.push(`${bullet}${scope}: ${fmt(o)}`);
  }
  if (authority.owner) lines.push(`${bullet}Canonical implementation owner: ${authority.owner}`);
  if (authority.syncProcess) lines.push(`${bullet}Examples kept aligned via: ${authority.syncProcess}`);
  return lines;
}

// When there's a port target, the shipping implementation (native/other) is
// canonical, so the hex/rgba in design.json are PREVIEW-ONLY swatches — agents must
// bind each color's `resource` key (e.g. a WinUI ThemeResource) rather than the raw
// value, so light/dark/high-contrast stay correct. With no port, the files are the
// implementation and the values are canonical.
export function colorsArePreviewOnly(authorityOrTokens) {
  const a = authorityOrTokens && "hasPort" in authorityOrTokens
    ? authorityOrTokens
    : readAuthority(authorityOrTokens);
  return !!a.hasPort;
}

// The known preview themes. A color may carry per-theme preview values under
// `themes`; missing themes fall back to light/base so the canvas still renders.
export const THEMES = ["light", "dark", "highContrast"];

// The base (light) preview value of a color, tolerating either a flat `value` or a
// { themes: { light } } shape.
export function baseColorValue(color) {
  if (!color) return "";
  if (typeof color.value === "string" && color.value) return color.value;
  const th = color.themes;
  if (th && typeof th === "object") return th.light || th.dark || th.highContrast || "";
  return "";
}

// The PREVIEW value to render for a given theme (never an implementation value —
// that's the color's `resource`). Falls back light → base when a theme is absent.
export function colorValueForTheme(color, theme = "light") {
  const th = color?.themes;
  if (th && typeof th === "object" && typeof th[theme] === "string" && th[theme]) return th[theme];
  if (theme !== "light" && th && typeof th.light === "string" && th.light) return th.light;
  return baseColorValue(color);
}

export function colorList(tokens) {
  const c = tokens?.colors;
  const norm = (name, x) => ({
    name,
    value: baseColorValue(x),
    usage: (x && x.usage) || "",
    resource: x && typeof x.resource === "string" ? x.resource.trim() : "",
    themes: x && x.themes && typeof x.themes === "object" ? x.themes : null,
  });
  if (Array.isArray(c)) return c.map((x) => norm(x.name, x));
  if (c && typeof c === "object") return Object.entries(c).map(([name, value]) => norm(name, { value }));
  return [];
}

// Build the CSS custom properties that both the canvas chrome and the live
// component previews consume: --color-*, --font-*, --space-*, --radius-*, --shadow-*.
// `theme` selects which per-theme preview color to emit (default light).
export function tokensToCssVars(tokens, theme = "light") {
  const lines = [];
  for (const c of colorList(tokens)) lines.push(`--color-${c.name}: ${colorValueForTheme(c, theme)};`);

  const ty = tokens?.typography || {};
  if (ty.display?.family) lines.push(`--font-display: ${ty.display.family};`);
  if (ty.body?.family) lines.push(`--font-body: ${ty.body.family};`);
  if (ty.mono?.family) lines.push(`--font-mono: ${ty.mono.family};`);

  for (const s of tokens?.spacing?.scale || []) lines.push(`--space-${s.name}: ${s.value};`);
  for (const r of tokens?.radii || []) lines.push(`--radius-${r.name}: ${r.value};`);
  for (const sh of tokens?.shadows || []) lines.push(`--shadow-${sh.name}: ${sh.value};`);

  return lines.join("\n  ");
}
