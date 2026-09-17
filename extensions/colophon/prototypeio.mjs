// prototypeio.mjs — locate, load, save, and surgically patch the click-through
// prototypes that live beside the design system at:
//   <workspace>/.agents/design/prototypes.jsonc
//
// The file is JSONC (JSON + comments): we tolerate // and /* */ comments and trailing
// commas on read, and re-emit a deterministic, stable-key-ordered body with a header
// legend on write. Copilot patches individual nodes by id (see applyOps) so edits are
// surgical and diffs stay small. The scene graph is pure data and is never evaluated.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { designDirFor, DESIGN_SUBPATH } from "./designio.mjs";
import "./proto-layout.js";

const { validateNode } = globalThis.ProtoLayout;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = path.join(HERE, "sample");
export const PROTO_FILENAME = "prototypes.jsonc";
export const PROTO_SUBPATH = `${DESIGN_SUBPATH}/${PROTO_FILENAME}`;

// The node discriminator keys, in the order we treat them.
export const NODE_KINDS = ["layout", "component", "text", "image", "spacer"];

// Header legend re-emitted on every write so the on-disk file is self-documenting.
const HEADER = `// prototypes.jsonc — click-through prototypes built from this repo's design system.
// Framework-agnostic scene graph (not shipping code): layout primitives + references to
// components.jsonc by name + navigation as data. Copilot authors/patches this; review it in
// the Prototype canvas. Node kinds: layout | component | text | image | spacer. Every node
// may carry id, on (interactions), visibleWhen/hiddenWhen. Actions: navigate, back,
// setState, toggle, openModal, closeModal. This file is regenerated with stable key order
// Layouts: stack, row, grid, scroll, freeform, none. Common fields: width/height
// (hug, fill, pixels or CSS length), gap, padding/margin (token, pixels or edge box),
// appearance (sparse component-system overrides). Only direct freeform children may
// carry position: { mode: "absolute", x, y }. Appearance overrides legacy flat styles.
// Optional sections: [{ id, name }]. A screen's sectionId assigns it to a sidebar group.
// on save — use "note" fields for durable annotations.
`;

export function prototypesPathFor(workspacePath) {
  const dir = designDirFor(workspacePath);
  return dir ? path.join(dir, PROTO_FILENAME) : null;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// Strip // line comments, /* */ block comments (respecting string literals), and
// trailing commas, so a JSONC file parses with JSON.parse.
export function stripJsonc(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  let inStr = false, quote = "", esc = false;
  while (i < n) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === quote) inStr = false;
      i++; continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; i++; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < n && text[i] !== "\n") i++; continue; }
    if (c === "/" && text[i + 1] === "*") { i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function parsePrototypes(text) {
  return JSON.parse(stripJsonc(text));
}

// ---- stable-key serialization ---------------------------------------------
// Priority order for object keys so diffs are stable regardless of author order.
const KEY_ORDER = [
  "$schema", "meta", "version", "updatedBy", "updatedAt", "note",
  "state", "sections", "screens", "flows",
  "id", "name", "sectionId", "device", "start",
  "layout", "component", "text", "image", "spacer",
  "direction", "columns", "gap", "padding", "margin", "align", "justify", "wrap",
  "background", "radius", "grow", "size", "fit", "width", "height",
  "position", "appearance", "style", "color", "alt", "src", "props",
  "on", "visibleWhen", "hiddenWhen",
  "root", "modals", "children",
];
const KEY_RANK = new Map(KEY_ORDER.map((k, i) => [k, i]));

function orderedKeys(obj) {
  return Object.keys(obj).sort((a, b) => {
    const ra = KEY_RANK.has(a) ? KEY_RANK.get(a) : KEY_ORDER.length;
    const rb = KEY_RANK.has(b) ? KEY_RANK.get(b) : KEY_ORDER.length;
    if (ra !== rb) return ra - rb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function stableStringify(value, indent = "") {
  const next = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => next + stableStringify(v, next));
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const keys = orderedKeys(value);
    if (keys.length === 0) return "{}";
    const items = keys.map((k) => `${next}${JSON.stringify(k)}: ${stableStringify(value[k], next)}`);
    return `{\n${items.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function serializePrototypes(doc) {
  return HEADER + stableStringify(doc, "") + "\n";
}

// ---- load / save -----------------------------------------------------------
// Load prototypes for a workspace. Falls back to the bundled sample so the canvas
// always renders something. `source` is "repo" | "sample".
export async function loadPrototypes(workspacePath) {
  const repoPath = prototypesPathFor(workspacePath);
  const usingRepo = repoPath && (await exists(repoPath));
  const file = usingRepo ? repoPath : path.join(SAMPLE_DIR, PROTO_FILENAME);
  const raw = await fs.readFile(file, "utf8").catch(() => null);

  let doc = emptyPrototypes();
  let parseError = null;
  if (raw != null) {
    try { doc = normalizeDoc(parsePrototypes(raw)); }
    catch (err) {
      parseError = String(err && err.message ? err.message : err);
      // Fall back to the sample so the canvas still renders on a bad edit.
      try { doc = normalizeDoc(parsePrototypes(await fs.readFile(path.join(SAMPLE_DIR, PROTO_FILENAME), "utf8"))); }
      catch { doc = emptyPrototypes(); }
    }
  }

  return {
    source: usingRepo ? "repo" : "sample",
    dir: usingRepo ? path.dirname(repoPath) : null,
    path: usingRepo ? repoPath : null,
    parseError,
    doc,
  };
}

export async function savePrototypes(workspacePath, doc) {
  const repoPath = prototypesPathFor(workspacePath);
  if (!repoPath) throw new Error("No workspace path available to save prototypes.jsonc");
  await fs.mkdir(path.dirname(repoPath), { recursive: true });
  const next = normalizeDoc(doc);
  next.meta = { ...(next.meta || {}), version: (next.meta?.version || 0), updatedBy: next.meta?.updatedBy || "canvas", updatedAt: new Date().toISOString() };
  await fs.writeFile(repoPath, serializePrototypes(next), "utf8");
  return { path: repoPath, doc: next };
}

export function emptyPrototypes() {
  return { meta: { version: 1, updatedBy: "canvas" }, state: {}, screens: [], flows: [] };
}

// Coerce a parsed object into the shape the renderer/validator expect.
function normalizeDoc(doc) {
  const d = doc && typeof doc === "object" ? doc : {};
  return {
    meta: d.meta && typeof d.meta === "object" ? d.meta : { version: 1 },
    state: d.state && typeof d.state === "object" ? d.state : {},
    screens: Array.isArray(d.screens) ? d.screens : [],
    flows: Array.isArray(d.flows) ? d.flows : [],
    ...(d.sections !== undefined ? { sections: d.sections } : {}),
  };
}

// ---- node helpers ----------------------------------------------------------
export function nodeKind(node) {
  if (!node || typeof node !== "object") return null;
  for (const k of NODE_KINDS) if (k in node) return k;
  return null;
}

function childrenOf(node) {
  return Array.isArray(node?.children) ? node.children : null;
}

// The root nodes to walk for a screen: its root plus any modal roots.
function screenRoots(screen) {
  const roots = [];
  if (screen?.root) roots.push(screen.root);
  for (const m of Array.isArray(screen?.modals) ? screen.modals : []) if (m?.root) roots.push(m.root);
  return roots;
}

// Depth-first walk of every node under a screen. Calls fn(node, parent).
export function walkScreen(screen, fn) {
  const visit = (node, parent) => {
    if (!node || typeof node !== "object") return;
    fn(node, parent);
    for (const c of childrenOf(node) || []) visit(c, node);
  };
  for (const r of screenRoots(screen)) visit(r, null);
}

export function findScreen(doc, screenId) {
  return (doc.screens || []).find((s) => s?.id === screenId) || null;
}

export function findNode(screen, nodeId) {
  let found = null;
  walkScreen(screen, (n) => { if (!found && n.id === nodeId) found = n; });
  return found;
}

export function prototypeValueAtPath(doc, pathSegments) {
  if (!Array.isArray(pathSegments) || !pathSegments.length) throw new Error("selection requires a non-empty JSON path");
  let value = doc;
  for (const segment of pathSegments) {
    if (typeof segment !== "string" && !Number.isInteger(segment)) throw new Error("selection path contains an invalid segment");
    if (value == null || (typeof value !== "object" && !Array.isArray(value)) || !(segment in value)) {
      throw new Error(`selection path does not exist at ${JSON.stringify(segment)}`);
    }
    value = value[segment];
  }
  return value;
}

export function prototypePointerForPath(pathSegments) {
  if (!Array.isArray(pathSegments) || !pathSegments.length) throw new Error("selection requires a non-empty JSON path");
  return "/" + pathSegments.map((segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

export function resolvePrototypeSelection(doc, selection) {
  const screenId = selection?.screenId;
  const pathSegments = selection?.path;
  const value = prototypeValueAtPath(doc, pathSegments);
  if (!value || typeof value !== "object" || Array.isArray(value) || !nodeKind(value)) {
    throw new Error("selection path must resolve to a prototype node");
  }
  const screenIndex = pathSegments[0] === "screens" && Number.isInteger(pathSegments[1]) ? pathSegments[1] : -1;
  const screen = doc?.screens?.[screenIndex];
  if (!screen || screen.id !== screenId) throw new Error(`selection does not belong to screen "${screenId || "?"}"`);
  return {
    screen,
    node: value,
    path: pathSegments.slice(),
    jsonPointer: prototypePointerForPath(pathSegments),
  };
}

function findNodeParent(screen, nodeId) {
  let hit = null;
  walkScreen(screen, (n, parent) => { if (!hit && n.id === nodeId) hit = { node: n, parent }; });
  return hit;
}

// ---- surgical patch ops ----------------------------------------------------
// Apply a list of ops to a doc (mutates a clone). Each op names the smallest unit it
// touches so Copilot can make targeted edits. Returns { doc, applied, errors }.
export function applyOps(inputDoc, ops) {
  const doc = normalizeDoc(JSON.parse(JSON.stringify(inputDoc || {})));
  const applied = [];
  const errors = [];
  const list = Array.isArray(ops) ? ops : [ops];

  for (const op of list) {
    try {
      switch (op?.op) {
        case "setState":
          doc.state = { ...(doc.state || {}), ...(op.state || {}) };
          break;
        case "setMeta":
          doc.meta = { ...(doc.meta || {}), ...(op.meta || {}) };
          break;
        case "upsertScreen": {
          if (!op.screen?.id) throw new Error("upsertScreen requires screen.id");
          const idx = doc.screens.findIndex((s) => s.id === op.screen.id);
          if (idx >= 0) doc.screens[idx] = op.screen; else doc.screens.push(op.screen);
          break;
        }
        case "upsertSection": {
          if (typeof op.section?.id !== "string" || !op.section.id.trim() ||
              typeof op.section?.name !== "string" || !op.section.name.trim()) {
            throw new Error("upsertSection requires a non-empty section.id and section.name");
          }
          if (!doc.sections) doc.sections = [];
          const idx = doc.sections.findIndex((section) => section.id === op.section.id);
          if (idx >= 0) doc.sections[idx] = op.section; else doc.sections.push(op.section);
          break;
        }
        case "deleteScreen": {
          const before = doc.screens.length;
          doc.screens = doc.screens.filter((s) => s.id !== op.screenId);
          if (doc.screens.length === before) throw new Error(`no screen "${op.screenId}"`);
          break;
        }
        case "setNode":
        case "patchNode":
        case "deleteNode":
        case "insertNode":
        case "setNav": {
          const screen = findScreen(doc, op.screenId);
          if (!screen) throw new Error(`no screen "${op.screenId}"`);
          applyNodeOp(screen, op);
          break;
        }
        default:
          throw new Error(`unknown op "${op?.op}"`);
      }
      applied.push(op.op);
    } catch (err) {
      errors.push({ op: op?.op, error: String(err && err.message ? err.message : err) });
    }
  }
  return { doc, applied, errors };
}

function applyNodeOp(screen, op) {
  if (op.op === "insertNode") {
    if (!op.node?.id) throw new Error("insertNode requires node.id");
    const parentId = op.parentId || screen.root?.id;
    const parent = parentId ? findNode(screen, parentId) : screen.root;
    if (!parent) throw new Error(`no parent node "${parentId}"`);
    if (!Array.isArray(parent.children)) parent.children = [];
    const at = Number.isInteger(op.index) ? op.index : parent.children.length;
    parent.children.splice(Math.max(0, Math.min(at, parent.children.length)), 0, op.node);
    return;
  }

  const hit = findNodeParent(screen, op.nodeId);
  if (!hit) throw new Error(`no node "${op.nodeId}" in screen "${screen.id}"`);

  if (op.op === "setNode") {
    if (!op.node) throw new Error("setNode requires node");
    op.node.id = op.node.id || op.nodeId;
    if (hit.parent) {
      const arr = hit.parent.children;
      arr[arr.indexOf(hit.node)] = op.node;
    } else {
      // Replacing a root (screen root or a modal root).
      if (screen.root === hit.node) screen.root = op.node;
      else for (const m of screen.modals || []) if (m.root === hit.node) m.root = op.node;
    }
  } else if (op.op === "patchNode") {
    const merge = op.merge || {};
    for (const [k, v] of Object.entries(merge)) {
      if (k === "props" && v && typeof v === "object" && hit.node.props && typeof hit.node.props === "object") {
        hit.node.props = { ...hit.node.props, ...v };
      } else {
        hit.node[k] = v;
      }
    }
  } else if (op.op === "deleteNode") {
    if (!hit.parent) throw new Error(`cannot delete a root node ("${op.nodeId}")`);
    const arr = hit.parent.children;
    arr.splice(arr.indexOf(hit.node), 1);
  } else if (op.op === "setNav") {
    hit.node.on = { ...(hit.node.on || {}), tap: { navigate: op.target } };
  }
}

// ---- validation ------------------------------------------------------------
// Structural checks that catch the drift a scene graph is prone to: navigation to a
// screen that doesn't exist, references to components not in components.jsonc, and token
// names (color/space/radius) that aren't defined. Writes nothing.
export function validatePrototypes(doc, { componentNames = [], tokenNames = {} } = {}) {
  const errors = [];
  const warnings = [];
  const d = normalizeDoc(doc);
  const screenIds = new Set(d.screens.map((s) => s?.id).filter(Boolean));
  const comps = new Set(componentNames);

  const seenIds = new Set();
  const sectionIds = new Set();
  if (d.sections !== undefined && !Array.isArray(d.sections)) {
    errors.push("Sections must be an array.");
  }
  for (const section of Array.isArray(d.sections) ? d.sections : []) {
    if (typeof section?.id !== "string" || !section.id.trim()) {
      errors.push("A section is missing a non-empty id.");
      continue;
    }
    if (sectionIds.has(section.id)) errors.push(`Duplicate section id "${section.id}".`);
    sectionIds.add(section.id);
    if (typeof section.name !== "string" || !section.name.trim()) errors.push(`Section "${section.id}" is missing a name.`);
  }

  if (!d.screens.length) warnings.push("No screens defined yet.");

  for (const flow of d.flows) {
    if (flow?.start && !screenIds.has(flow.start)) errors.push(`Flow "${flow.id || flow.name}" starts at unknown screen "${flow.start}".`);
  }

  for (const screen of d.screens) {
    if (!screen?.id) { errors.push("A screen is missing an id."); continue; }
    if (screen.sectionId != null && !sectionIds.has(screen.sectionId)) {
      errors.push(`Screen "${screen.id}" belongs to unknown section "${screen.sectionId}".`);
    }
    walkScreen(screen, (node, parent) => {
      if (node.id) {
        if (seenIds.has(node.id)) warnings.push(`Duplicate node id "${node.id}" (ids should be unique for surgical patches).`);
        seenIds.add(node.id);
      }
      const kind = nodeKind(node);
      if (!kind) { errors.push(`Node "${node.id || "?"}" in screen "${screen.id}" has no kind (layout/component/text/image/spacer).`); return; }
      if (kind === "component" && comps.size && !comps.has(node.component)) {
        errors.push(`Screen "${screen.id}": component "${node.component}" is not defined in components.jsonc.`);
      }
      const validation = validateNode(node, parent, tokenNames);
      const where = `Screen "${screen.id}", node "${node.id || "?"}": `;
      errors.push(...validation.errors.map((message) => where + message));
      warnings.push(...validation.warnings.map((message) => where + message));

      const tap = node.on?.tap;
      if (tap?.navigate && !screenIds.has(tap.navigate)) errors.push(`Screen "${screen.id}", node "${node.id}": navigates to unknown screen "${tap.navigate}".`);
      if (tap?.openModal) {
        const modalIds = new Set((screen.modals || []).map((m) => m?.id));
        if (!modalIds.has(tap.openModal)) errors.push(`Screen "${screen.id}", node "${node.id}": opens unknown modal "${tap.openModal}".`);
      }
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
