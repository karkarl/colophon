// Extension: colophon
// A live, editable, in-repo design system that renders in the Copilot canvas and
// that Copilot consults before doing any UI work.
//
// Pieces:
//   • Canvas "colophon"  — renders/edits .agents/design/ (falls back to a starter)
//   • Tool  "colophon"   — hands the agent the system as text (and can seed a repo)
//   • Hooks                   — announce the system + inject it when a prompt is UI-related
//
// Static UI (styles.css, client.js) is served from disk by a per-instance loopback
// server. Design I/O and the "skill" text live in designio.mjs / context.mjs.

import { createServer } from "node:http";
import { promises as fs, watch as fsWatch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { loadDesign, initDesign, saveTokens, tokensToCssVars, designDirFor, readAuthority, colorList, DESIGN_SUBPATH } from "./designio.mjs";
import { buildSummary, looksLikeUiWork, sessionStartContext, promptContext } from "./context.mjs";
import { scratchTokens, normalizeTokens, scanCodebase } from "./sources.mjs";
import { validateTokens, validateComponentsSource, flattenResult } from "./validate.mjs";
import { renderShell } from "./renderer.mjs";
import { renderProtoShell } from "./proto-renderer.mjs";
import { loadPrototypes, savePrototypes, applyOps, validatePrototypes, findScreen, PROTO_SUBPATH } from "./prototypeio.mjs";
import { buildOutline } from "./proto-outline.mjs";
import { codegenScreen } from "./protocodegen.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let sessionRef = null;

// The repo whose .agents/design/ we load. Learned strictly from per-invocation,
// session-scoped signals: hook inputs (BaseHookInput.workingDirectory is always the
// session's repo) and canvas ctx.session.workingDirectory. We must NEVER anchor to
// process.cwd() (the Copilot home dir) or sessionRef.workspacePath (the CLI's
// session-state dir) — neither is the repo, and reusing a value from another
// session/invocation would leak one repo's design system into another. Starts null;
// when null, loadDesign(null) resolves to the bundled sample (a safe default that is
// never another repo's system).
let sessionWorkdir = null;
function setWorkdir(dir) { if (dir && typeof dir === "string") sessionWorkdir = dir; }

function log(message, level = "info") {
  try { sessionRef?.log?.(message, { level }); } catch { /* pre-join */ }
}

// Best-effort package name (used to name a scanned design system).
async function pkgNameFor(workdir) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(workdir, "package.json"), "utf8"));
    return pkg?.name || null;
  } catch { return null; }
}

// Validate a loaded design object (falls back to the sample when there's no repo
// system). Merges the JSON parse error, design.json schema checks, and the
// components.jsx structural check into one { ok, errors, warnings } result.
function validateLoaded(design) {
  return flattenResult({
    parseError: design.parseError || null,
    design: validateTokens(design.tokens),
    components: validateComponentsSource(design.componentsSource || ""),
  });
}

// Extract the component names exported by components.jsx (top-level function/const
// declarations with a Capitalized name) so prototype validation can flag references to
// components that don't exist.
function componentNamesFrom(source) {
  const names = new Set();
  const re = /(?:export\s+)?(?:function|const)\s+([A-Z]\w*)/g;
  let m;
  while ((m = re.exec(source || ""))) names.add(m[1]);
  return [...names];
}

// The defined token names a prototype may reference, used by validatePrototypes.
function tokenNamesFrom(tokens) {
  return {
    colors: colorList(tokens).map((c) => c.name),
    spacing: (tokens?.spacing?.scale || []).map((s) => String(s.name)),
    radii: (tokens?.radii || []).map((r) => r.name),
  };
}

// Load the design + prototypes together and validate the scene graph against the
// design's components/tokens. Shared by the canvas route, the actions, and the tool.
async function loadProtoBundle(workdir) {
  const design = await loadDesign(workdir);
  const proto = await loadPrototypes(workdir);
  const validation = validatePrototypes(proto.doc, {
    componentNames: componentNamesFrom(design.componentsSource || ""),
    tokenNames: tokenNamesFrom(design.tokens),
  });
  return { design, proto, validation };
}

// ---- per-instance loopback servers ----------------------------------------
const servers = new Map(); // instanceId -> { server, url, workdir, sse:Set, watcher }

const STATIC = {
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/client.js": { file: "client.js", type: "text/javascript; charset=utf-8" },
  "/proto.css": { file: "proto.css", type: "text/css; charset=utf-8" },
  "/proto-client.js": { file: "proto-client.js", type: "text/javascript; charset=utf-8" },
  "/proto-render.js": { file: "proto-render.js", type: "text/javascript; charset=utf-8" },
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function broadcast(entry, event) {
  for (const res of entry.sse) {
    try { res.write(`event: ${event}\ndata: {}\n\n`); } catch { /* client gone */ }
  }
}

function watchDesign(entry) {
  const dir = designDirFor(entry.workdir);
  if (!dir) return;
  try {
    entry.watcher = fsWatch(dir, { persistent: false }, () => {
      clearTimeout(entry._debounce);
      entry._debounce = setTimeout(() => broadcast(entry, "changed"), 150);
    });
  } catch { /* dir may not exist yet; re-armed after init/save */ }
}

async function handle(entry, req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const pathname = url.pathname;

  if (pathname === "/" || pathname === "/index.html") {
    const html = entry.kind === "prototype" ? renderProtoShell() : renderShell();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  const stat = STATIC[pathname];
  if (stat) {
    try {
      const buf = await fs.readFile(path.join(HERE, stat.file));
      res.writeHead(200, { "content-type": stat.type, "cache-control": "no-store" });
      return res.end(buf);
    } catch { res.writeHead(404); return res.end("not found"); }
  }

  if (pathname === "/api/design") {
    const design = await loadDesign(entry.workdir);
    return sendJson(res, 200, { design, cssVars: tokensToCssVars(design.tokens) });
  }

  if (pathname === "/api/validate") {
    const design = await loadDesign(entry.workdir);
    return sendJson(res, 200, { source: design.source, parseError: design.parseError || null, ...validateLoaded(design) });
  }

  if (pathname === "/api/save" && req.method === "POST") {
    try {
      const { tokens } = await readBody(req);
      const out = await saveTokens(entry.workdir, tokens);
      if (!entry.watcher) watchDesign(entry); // arm now that the dir exists
      log(`Saved design tokens to ${out.dir}${out.agents?.file ? `; AGENTS.md pointer ${out.agents.action}` : ""}`);
      return sendJson(res, 200, { ok: true, dir: out.dir, agents: out.agents });
    } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
  }

  if (pathname === "/api/init" && req.method === "POST") {
    try {
      const body = await readBody(req).catch(() => ({}));
      const mode = body?.mode === "scratch" ? "scratch" : "starter";
      const opts = mode === "scratch" ? { tokens: scratchTokens({ name: body?.name, tagline: body?.tagline, description: body?.description }) } : {};
      const out = await initDesign(entry.workdir, opts);
      if (!entry.watcher) watchDesign(entry);
      log(`Seeded design system (${mode}) at ${out.dir} (wrote: ${out.written.join(", ") || "nothing"})${out.agents?.file ? `; AGENTS.md ${out.agents.action}` : ""}`);
      return sendJson(res, 200, { ok: true, mode, ...out });
    } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
  }

  // Scan the codebase for existing design signals — returns a proposal, writes nothing.
  if (pathname === "/api/scan" && req.method === "POST") {
    try {
      const pkgName = await pkgNameFor(entry.workdir);
      const { tokens, evidence } = await scanCodebase(entry.workdir, { pkgName });
      log(`Scanned ${evidence.fileCount} files; proposing a design system from existing UI.`);
      return sendJson(res, 200, { ok: true, tokens, evidence, cssVars: tokensToCssVars(tokens) });
    } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
  }

  // Import tokens from a repo-relative .json path or pasted JSON — returns a proposal, writes nothing.
  if (pathname === "/api/import" && req.method === "POST") {
    try {
      const body = await readBody(req);
      let raw = null, sourceName = body?.sourceName;
      if (body?.path) {
        const abs = path.isAbsolute(body.path) ? body.path : path.join(entry.workdir, body.path);
        raw = JSON.parse(await fs.readFile(abs, "utf8"));
        sourceName = sourceName || path.basename(body.path);
      } else if (typeof body?.json === "string" && body.json.trim()) {
        raw = JSON.parse(body.json);
        sourceName = sourceName || "pasted tokens";
      } else if (body?.json && typeof body.json === "object") {
        raw = body.json;
      } else {
        throw new Error("Provide a { path } to a .json file or { json } token text.");
      }
      const { tokens, warnings } = normalizeTokens(raw, { sourceName });
      log(`Imported tokens from ${sourceName || "input"}${warnings.length ? ` (${warnings.length} warning(s))` : ""}.`);
      return sendJson(res, 200, { ok: true, tokens, warnings, cssVars: tokensToCssVars(tokens) });
    } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
  }

  // ---- prototype canvas routes ---------------------------------------------
  if (pathname === "/api/prototypes") {
    const { design, proto, validation } = await loadProtoBundle(entry.workdir);
    return sendJson(res, 200, {
      design: { tokens: design.tokens, componentsSource: design.componentsSource || "", source: design.source },
      proto: { source: proto.source, doc: proto.doc, parseError: proto.parseError || null },
      validation,
    });
  }

  if (pathname === "/api/prototypes/outline") {
    const proto = await loadPrototypes(entry.workdir);
    return sendJson(res, 200, { markdown: buildOutline(proto.doc, { title: "Prototype" }) });
  }

  if (pathname === "/api/prototypes/save" && req.method === "POST") {
    try {
      const { doc } = await readBody(req);
      const out = await savePrototypes(entry.workdir, doc);
      if (!entry.watcher) watchDesign(entry);
      broadcast(entry, "changed");
      log(`Saved prototypes to ${out.path}`);
      return sendJson(res, 200, { ok: true, path: out.path });
    } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
  }

  if (pathname === "/api/prototypes/patch" && req.method === "POST") {
    try {
      const { ops } = await readBody(req);
      const current = await loadPrototypes(entry.workdir);
      const { doc, applied, errors } = applyOps(current.doc, Array.isArray(ops) ? ops : []);
      if (errors.length) return sendJson(res, 400, { error: errors.join("; "), applied });
      const out = await savePrototypes(entry.workdir, doc);
      if (!entry.watcher) watchDesign(entry);
      broadcast(entry, "changed");
      log(`Patched prototypes (${applied} op(s)) at ${out.path}`);
      return sendJson(res, 200, { ok: true, applied, path: out.path });
    } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
  }

  if (pathname === "/api/prototypes/codegen" && req.method === "POST") {
    try {
      const { screenId } = await readBody(req);
      const design = await loadDesign(entry.workdir);
      const proto = await loadPrototypes(entry.workdir);
      const out = codegenScreen(proto.doc, screenId, design.tokens);
      return sendJson(res, 200, { ok: true, ...out });
    } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
  }

  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write("event: ready\ndata: {}\n\n");
    entry.sse.add(res);
    req.on("close", () => entry.sse.delete(res));
    return;
  }

  res.writeHead(404);
  res.end("not found");
}

async function startServer(instanceId, workdir, kind = "design") {
  const entry = { workdir, kind, sse: new Set(), watcher: null };
  const server = createServer((req, res) => {
    handle(entry, req, res).catch((err) => {
      log(`request error: ${err.message || err}`, "error");
      try { res.writeHead(500); res.end("error"); } catch { /* noop */ }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  entry.server = server;
  entry.url = `http://127.0.0.1:${server.address().port}/`;
  watchDesign(entry);
  return entry;
}

// ---- canvas ----------------------------------------------------------------
const canvas = createCanvas({
  id: "colophon",
  displayName: "Colophon",
  description: "View, edit, and live-preview this repo's design system (.agents/design/): brand, color, type, spacing, components. Previews Light, Dark, and High-contrast themes and validates the system for drift.",
  inputSchema: { type: "object", properties: { workingDirectory: { type: "string", description: "Repo/working directory whose .agents/design/ to load" } }, additionalProperties: true },

  open: async (ctx) => {
    const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
    setWorkdir(workdir);
    let entry = servers.get(ctx.instanceId);
    if (!entry) {
      entry = await startServer(ctx.instanceId, workdir);
      servers.set(ctx.instanceId, entry);
    } else if (workdir && entry.workdir !== workdir) {
      entry.workdir = workdir; // rehydrate against a new repo
    }
    const design = await loadDesign(entry.workdir);
    return {
      title: `Colophon — ${design.tokens?.brand?.name || "starter"}`,
      status: design.source === "repo" ? ".agents/design/" : "starter (unsaved)",
      url: entry.url,
    };
  },

  actions: [
    {
      name: "read",
      description: "Return the current design system as a text summary the agent can follow.",
      handler: async (ctx) => {
        const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
        setWorkdir(workdir);
        const design = await loadDesign(workdir);
        return { source: design.source, summary: buildSummary(design) };
      },
    },
    {
      name: "init",
      description: "Scaffold .agents/design/ in the repo (non-destructive). mode 'starter' (default) copies the bundled starter; 'scratch' writes a neutral skeleton to refine.",
      inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["starter", "scratch"] }, name: { type: "string" }, tagline: { type: "string" }, description: { type: "string", description: "One-paragraph description of the app/project for codegen context." }, workingDirectory: { type: "string" } }, additionalProperties: false },
      handler: async (ctx) => {
        const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
        setWorkdir(workdir);
        const mode = ctx.input?.mode === "scratch" ? "scratch" : "starter";
        try {
          const opts = mode === "scratch" ? { tokens: scratchTokens({ name: ctx.input?.name, tagline: ctx.input?.tagline, description: ctx.input?.description }) } : {};
          const out = await initDesign(workdir, opts);
          const entry = servers.get(ctx.instanceId);
          if (entry) { entry.workdir = workdir; if (!entry.watcher) watchDesign(entry); broadcast(entry, "changed"); }
          return { ok: true, mode, ...out };
        } catch (err) { throw new CanvasError("init_failed", String(err.message || err)); }
      },
    },
    {
      name: "scan",
      description: "Scan the repo's existing UI (CSS/JSX/styles) and return a proposed design system as text + evidence. Writes nothing; open the canvas to review and save.",
      handler: async (ctx) => {
        const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
        setWorkdir(workdir);
        try {
          const pkgName = await pkgNameFor(workdir);
          const { tokens, evidence } = await scanCodebase(workdir, { pkgName });
          return { ok: true, evidence, proposal: buildSummary({ source: "scan", tokens }) };
        } catch (err) { throw new CanvasError("scan_failed", String(err.message || err)); }
      },
    },
    {
      name: "refresh",
      description: "Tell the open canvas to reload the design system from disk.",
      handler: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (entry) broadcast(entry, "changed");
        return { ok: true };
      },
    },
    {
      name: "validate",
      description: "Validate this repo's .agents/design/: schema/parse checks on design.json plus a structural check on components.jsx. Returns errors and warnings so drift is caught (e.g. a port target set without resource mappings or an owner). Writes nothing.",
      handler: async (ctx) => {
        const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
        setWorkdir(workdir);
        const design = await loadDesign(workdir);
        return { source: design.source, ...validateLoaded(design) };
      },
    },
  ],

  onClose: async (ctx) => {
    const entry = servers.get(ctx.instanceId);
    if (!entry) return;
    servers.delete(ctx.instanceId);
    try { entry.watcher?.close?.(); } catch { /* noop */ }
    for (const res of entry.sse) { try { res.end(); } catch { /* noop */ } }
    await new Promise((r) => entry.server.close(() => r()));
  },
});

// Shared teardown for both canvases' loopback servers.
async function closeInstance(instanceId) {
  const entry = servers.get(instanceId);
  if (!entry) return;
  servers.delete(instanceId);
  try { entry.watcher?.close?.(); } catch { /* noop */ }
  for (const res of entry.sse) { try { res.end(); } catch { /* noop */ } }
  await new Promise((r) => entry.server.close(() => r()));
}

// ---- prototype canvas ------------------------------------------------------
// A second canvas in the same extension: a device-framed, click-through preview of the
// prototypes.jsonc scene graph, rendered with the repo's own design tokens + components.
const protoCanvas = createCanvas({
  id: "prototype",
  displayName: "Prototype",
  description: "Device-framed, click-through prototypes generated from this repo's design system (.agents/design/prototypes.jsonc). Pick web/desktop/mobile/tablet frames, navigate between screens, and convert a screen to code for the configured port target.",
  inputSchema: { type: "object", properties: { workingDirectory: { type: "string", description: "Repo/working directory whose .agents/design/prototypes.jsonc to load" } }, additionalProperties: true },

  open: async (ctx) => {
    const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
    setWorkdir(workdir);
    let entry = servers.get(ctx.instanceId);
    if (!entry) {
      entry = await startServer(ctx.instanceId, workdir, "prototype");
      servers.set(ctx.instanceId, entry);
    } else if (workdir && entry.workdir !== workdir) {
      entry.workdir = workdir;
    }
    const proto = await loadPrototypes(entry.workdir);
    const count = proto.doc.screens?.length || 0;
    return {
      title: `Prototype — ${count} screen${count === 1 ? "" : "s"}`,
      status: proto.source === "repo" ? ".agents/design/prototypes.jsonc" : "sample (unsaved)",
      url: entry.url,
    };
  },

  actions: [
    {
      name: "read",
      description: "Return the current prototypes as a Markdown flow outline (screens, nodes, navigation) the agent can follow without parsing JSON.",
      handler: async (ctx) => {
        const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
        setWorkdir(workdir);
        const proto = await loadPrototypes(workdir);
        return { source: proto.source, outline: buildOutline(proto.doc, { title: "Prototype" }) };
      },
    },
    {
      name: "patch",
      description: "Apply surgical scene-graph ops (setState/setMeta/upsertScreen/deleteScreen/setNode/patchNode/deleteNode/insertNode/setNav) to prototypes.jsonc and save. Prefer this over rewriting the whole file so diffs stay small.",
      inputSchema: { type: "object", properties: { ops: { type: "array", items: { type: "object" }, description: "Ordered list of scene-graph ops." }, workingDirectory: { type: "string" } }, required: ["ops"], additionalProperties: false },
      handler: async (ctx) => {
        const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
        setWorkdir(workdir);
        try {
          const current = await loadPrototypes(workdir);
          const { doc, applied, errors } = applyOps(current.doc, ctx.input?.ops || []);
          if (errors.length) throw new CanvasError("patch_failed", errors.join("; "));
          const out = await savePrototypes(workdir, doc);
          const entry = servers.get(ctx.instanceId);
          if (entry) { entry.workdir = workdir; if (!entry.watcher) watchDesign(entry); broadcast(entry, "changed"); }
          return { ok: true, applied, path: out.path };
        } catch (err) { if (err instanceof CanvasError) throw err; throw new CanvasError("patch_failed", String(err.message || err)); }
      },
    },
    {
      name: "outline",
      description: "Return the Markdown flow outline of all screens and navigation (same as 'read').",
      handler: async (ctx) => {
        const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
        setWorkdir(workdir);
        const proto = await loadPrototypes(workdir);
        return { markdown: buildOutline(proto.doc, { title: "Prototype" }) };
      },
    },
    {
      name: "codegen",
      description: "Convert one screen to code for the repo's configured port target (React when the design is the source; a native hand-off scaffold + notes when a port target is set).",
      inputSchema: { type: "object", properties: { screenId: { type: "string" }, workingDirectory: { type: "string" } }, required: ["screenId"], additionalProperties: false },
      handler: async (ctx) => {
        const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
        setWorkdir(workdir);
        try {
          const design = await loadDesign(workdir);
          const proto = await loadPrototypes(workdir);
          return codegenScreen(proto.doc, ctx.input?.screenId, design.tokens);
        } catch (err) { throw new CanvasError("codegen_failed", String(err.message || err)); }
      },
    },
    {
      name: "validate",
      description: "Validate prototypes.jsonc against the design system: dangling navigation targets, unknown component references, unknown token references. Writes nothing.",
      handler: async (ctx) => {
        const workdir = ctx.input?.workingDirectory || ctx.session?.workingDirectory || sessionWorkdir;
        setWorkdir(workdir);
        const { proto, validation } = await loadProtoBundle(workdir);
        return { source: proto.source, parseError: proto.parseError || null, ...validation };
      },
    },
    {
      name: "refresh",
      description: "Tell the open prototype canvas to reload from disk.",
      handler: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (entry) broadcast(entry, "changed");
        return { ok: true };
      },
    },
  ],

  onClose: async (ctx) => { await closeInstance(ctx.instanceId); },
});

// ---- tool: hand the design system to the agent as text ---------------------
const designTool = {
  name: "colophon",
  description:
    "Read this repo's design system (brand, color, typography, spacing, radii, component patterns, principles, anti-references) so new or changed UI matches the house style. Call this BEFORE writing any UI, CSS, or components. Set init=true to scaffold .agents/design/ from the starter (and add an AGENTS.md pointer so every agent loads it) if the repo has none.",
  inputSchema: {
    type: "object",
    properties: {
      init: { type: "boolean", description: "Scaffold .agents/design/ from the starter (non-destructive) before returning." },
      scan: { type: "boolean", description: "If the repo has no .agents/design/, scan its existing UI and return a proposed design system (writes nothing)." },
      workingDirectory: { type: "string", description: "Repo/working directory to read. Defaults to this session's repo (set from hook context); pass it explicitly to target a different repo." },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    // The tool receives no session context, so it can't read ctx.session here. It
    // relies on sessionWorkdir, which onSessionStart / onUserPromptSubmitted set from
    // the hook's authoritative workingDirectory before the agent can call this tool.
    // If neither is available, workdir stays null and loadDesign falls back to the
    // bundled sample — never another repo's design system.
    const workdir = input?.workingDirectory || sessionWorkdir;
    let seeded = null;
    if (input?.init) {
      try { seeded = await initDesign(workdir); } catch (err) { seeded = { error: String(err.message || err) }; }
    }
    const design = await loadDesign(workdir);
    // No repo system yet + scan requested: propose one from existing UI instead of the starter.
    if (design.source !== "repo" && input?.scan && !input?.init) {
      try {
        const pkgName = await pkgNameFor(workdir);
        const { tokens, evidence } = await scanCodebase(workdir, { pkgName });
        return {
          source: "scan",
          dir: design.dir,
          instructions: `No ${DESIGN_SUBPATH}/ yet. Proposed the following from existing UI (${evidence.fileCount} files scanned). Open the Colophon canvas to review, refine, and save it.`,
          evidence,
          designSystem: buildSummary({ source: "scan", tokens }),
        };
      } catch (err) { seeded = { error: String(err.message || err) }; }
    }
    const summary = buildSummary(design);
    const authority = readAuthority(design.tokens);
    const pointerAdded = seeded && !seeded.error && ["created", "updated", "unchanged"].includes(seeded.agents?.action);
    const seededNote = pointerAdded
      ? " Ensured an AGENTS.md pointer so any agent loads this system before UI work."
      : "";
    const repoHeader = authority.hasPort
      ? `Design system loaded from ${DESIGN_SUBPATH}/ — the source of truth for design (framework-agnostic). Follow its tokens/patterns, then port the design into this app's implementation via the configured port target(s); don't ship components.jsx verbatim.${seededNote}`
      : `Design system loaded from ${DESIGN_SUBPATH}/ — follow it exactly.${seededNote}`;
    const header = design.source === "repo"
      ? repoHeader
      : `No ${DESIGN_SUBPATH}/ in this repo yet; this is the bundled starter. ${input?.init ? "" : "Pass init=true to seed it, or scan=true to propose one from existing UI."}`;
    return {
      source: design.source,
      dir: design.dir,
      seeded,
      componentsPath: design.source === "repo" ? path.join(design.dir, "components.jsx") : null,
      instructions: header,
      designSystem: summary,
    };
  },
};

// ---- tool: let the agent author/read/convert prototypes --------------------
const protoTool = {
  name: "prototype",
  description:
    "Author and inspect click-through UI prototypes for this repo, built from its design system (.agents/design/prototypes.jsonc). Use this to turn a described flow into screens the team can click through in the Prototype canvas, then convert a screen to code. The scene graph is framework-agnostic data (layout primitives + references to components.jsx by name + navigation as data) — never shipping code. Actions: 'read' (Markdown flow outline), 'validate' (dangling nav / unknown components or tokens), 'patch' (surgical ops), 'codegen' (one screen to code for the port target).",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "validate", "patch", "codegen"], description: "read (default): flow outline. validate: check the graph. patch: apply ops + save. codegen: convert a screen." },
      ops: { type: "array", items: { type: "object" }, description: "For action=patch: ordered scene-graph ops (setState/setMeta/upsertScreen/deleteScreen/setNode/patchNode/deleteNode/insertNode/setNav)." },
      screenId: { type: "string", description: "For action=codegen: the screen id to convert." },
      workingDirectory: { type: "string", description: "Repo/working directory. Defaults to this session's repo." },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    const workdir = input?.workingDirectory || sessionWorkdir;
    const action = input?.action || "read";
    if (action === "patch") {
      const current = await loadPrototypes(workdir);
      const { doc, applied, errors } = applyOps(current.doc, Array.isArray(input?.ops) ? input.ops : []);
      if (errors.length) return { ok: false, applied, errors };
      const out = await savePrototypes(workdir, doc);
      for (const entry of servers.values()) if (entry.kind === "prototype") broadcast(entry, "changed");
      return { ok: true, applied, path: out.path, outline: buildOutline(doc, { title: "Prototype" }) };
    }
    if (action === "codegen") {
      const design = await loadDesign(workdir);
      const proto = await loadPrototypes(workdir);
      try { return codegenScreen(proto.doc, input?.screenId, design.tokens); }
      catch (err) { return { ok: false, error: String(err.message || err) }; }
    }
    if (action === "validate") {
      const { proto, validation } = await loadProtoBundle(workdir);
      return { source: proto.source, parseError: proto.parseError || null, ...validation };
    }
    const proto = await loadPrototypes(workdir);
    return {
      source: proto.source,
      instructions: proto.source === "repo"
        ? "Prototypes loaded from .agents/design/prototypes.jsonc. Edit with action=patch (surgical ops) and review in the Prototype canvas."
        : "No prototypes.jsonc in this repo yet; showing the bundled sample. Use action=patch to author real screens for this repo.",
      screens: (proto.doc.screens || []).map((s) => ({ id: s.id, name: s.name, device: s.device })),
      outline: buildOutline(proto.doc, { title: "Prototype" }),
    };
  },
};

// ---- hooks: the "skill" that pulls the system into UI work -----------------
const hooks = {
  onSessionStart: async (input) => {
    setWorkdir(input?.workingDirectory);
    try {
      const design = await loadDesign(input?.workingDirectory || sessionWorkdir);
      return { additionalContext: sessionStartContext(design) };
    } catch { return {}; }
  },
  onUserPromptSubmitted: async (input) => {
    setWorkdir(input?.workingDirectory);
    if (!looksLikeUiWork(input?.prompt)) return {};
    try {
      const design = await loadDesign(input?.workingDirectory || sessionWorkdir);
      return { additionalContext: promptContext(design) };
    } catch { return {}; }
  },
};

sessionRef = await joinSession({
  canvases: [canvas, protoCanvas],
  tools: [designTool, protoTool],
  hooks,
});
