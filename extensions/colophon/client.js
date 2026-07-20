/* client.js — the Design System inspector that runs inside the canvas iframe.
   Loads /api/design, renders the system, supports inline token editing + save,
   and live-renders the pseudocode-React component patterns. */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) n.append(kid?.nodeType ? kid : document.createTextNode(String(kid ?? "")));
  return n;
};

let state = { design: null, tokens: null, dirty: false, mode: "normal", proposal: null, theme: "light", validation: null };

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
}

const THEMES = ["light", "dark", "highContrast"];
const THEME_LABEL = { light: "Light", dark: "Dark", highContrast: "High contrast" };

function colorList(tokens) {
  const c = tokens?.colors;
  if (Array.isArray(c)) return c;
  if (c && typeof c === "object") return Object.entries(c).map(([name, value]) => ({ name, value, usage: "" }));
  return [];
}

// The base (light) preview value of a color, tolerating a flat `value` or a
// { themes: { light } } shape. Mirrors designio.baseColorValue.
function baseColorValue(c) {
  if (!c) return "";
  if (typeof c.value === "string" && c.value) return c.value;
  const th = c.themes;
  if (th && typeof th === "object") return th.light || th.dark || th.highContrast || "";
  return "";
}

// Preview value for a theme, falling back theme → light → base.
function colorValueForTheme(c, theme = "light") {
  const th = c?.themes;
  if (th && typeof th === "object" && typeof th[theme] === "string" && th[theme]) return th[theme];
  if (theme !== "light" && th && typeof th.light === "string" && th.light) return th.light;
  return baseColorValue(c);
}

// Write a preview value for the active theme. Light writes the flat `value` (unless
// the color already uses a themes map); dark/highContrast write into themes.
function setColorValueForTheme(c, theme, hex) {
  if (theme === "light" && !(c.themes && typeof c.themes === "object")) { c.value = hex; return; }
  c.themes = (c.themes && typeof c.themes === "object") ? c.themes : {};
  if (theme === "light" && typeof c.value === "string" && !c.themes.light) c.themes.light = c.value;
  c.themes[theme] = hex;
  // Keep the canonical `value` aligned with themes.light so readers that prefer
  // `value` (baseColorValue, summaries, validation) don't report a stale hex.
  if (theme === "light" && typeof c.value === "string") c.value = hex;
}

// Does this system have a port target? Then colors are preview-only.
function hasPort(t) {
  const a = t?.authority;
  return !!(a && (a.port || (Array.isArray(a.portOverrides) && a.portOverrides.length)));
}

function cssVarsFromTokens(tokens, theme = "light") {
  const lines = [];
  for (const c of colorList(tokens)) lines.push(`--color-${c.name}: ${colorValueForTheme(c, theme)};`);
  const ty = tokens?.typography || {};
  if (ty.display?.family) lines.push(`--font-display: ${ty.display.family};`);
  if (ty.body?.family) lines.push(`--font-body: ${ty.body.family};`);
  if (ty.mono?.family) lines.push(`--font-mono: ${ty.mono.family};`);
  for (const s of tokens?.spacing?.scale || []) lines.push(`--space-${s.name}: ${s.value};`);
  for (const r of tokens?.radii || []) lines.push(`--radius-${r.name}: ${r.value};`);
  for (const sh of tokens?.shadows || []) lines.push(`--shadow-${sh.name}: ${sh.value};`);
  return `:root{\n  ${lines.join("\n  ")}\n}`;
}

function applyVars() {
  let tag = $("#ds-vars");
  if (!tag) { tag = el("style", { id: "ds-vars" }); document.head.append(tag); }
  tag.textContent = cssVarsFromTokens(state.tokens, state.theme);
  document.body.setAttribute("data-ds-theme", state.theme);
}

function markDirty() {
  state.dirty = true;
  const save = $("#save-btn");
  if (save) { save.disabled = false; save.textContent = "Save changes"; }
}

/* ---------- section renderers ---------- */

function portFields(obj, { withScope = false } = {}) {
  const rows = [];
  if (withScope) {
    const areaIn = el("input", { type: "text", value: obj.area || "", placeholder: "e.g. chat",
      oninput: (e) => { obj.area = e.target.value; markDirty(); } });
    const compIn = el("input", { type: "text", value: (obj.components || []).join(", "), placeholder: "e.g. ChatBubble, ChatComposer",
      oninput: (e) => { obj.components = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); markDirty(); } });
    rows.push(
      el("div", { class: "editable" }, el("label", {}, "Area"), areaIn),
      el("div", { class: "editable" }, el("label", {}, "Components (comma-separated)"), compIn),
    );
  }
  const shipsIn = el("input", { type: "text", value: obj.authoritySource || "", placeholder: "ships as — e.g. Native WinUI 3 / C#",
    oninput: (e) => { obj.authoritySource = e.target.value; markDirty(); } });
  const syncIn = el("input", { type: "text", value: obj.syncSource || "", placeholder: "sync source — e.g. https://github.com/microsoft/win-dev-skills",
    oninput: (e) => { obj.syncSource = e.target.value; markDirty(); } });
  const helperIn = el("input", { type: "text", value: obj.helperAgent || "", placeholder: "helper agent (optional) — e.g. win-dev-skills",
    oninput: (e) => { obj.helperAgent = e.target.value; markDirty(); } });
  const ownerIn = el("input", { type: "text", value: obj.owner || "", placeholder: "owner (optional) — who owns the canonical implementation",
    oninput: (e) => { obj.owner = e.target.value; markDirty(); } });
  rows.push(
    el("div", { class: "editable" }, el("label", {}, "Authority source (ships as)"), shipsIn),
    el("div", { class: "editable" }, el("label", {}, "Sync source (port reference/skill)"), syncIn),
    el("div", { class: "editable" }, el("label", {}, "Helper agent (optional)"), helperIn),
    el("div", { class: "editable" }, el("label", {}, "Owner (optional)"), ownerIn),
  );
  return rows;
}

function renderAuthority(t) {
  const a = (t.authority && typeof t.authority === "object") ? t.authority : (t.authority = {});
  if (typeof a.designSource !== "string" || !a.designSource) a.designSource = "self";
  if (!Array.isArray(a.portOverrides)) a.portOverrides = [];

  const wrap = el("div", { class: "authority", style: "margin-top:14px" }, el("label", {}, "Authority — design vs. port"));
  wrap.append(el("div", { class: "muted", style: "margin-top:4px" },
    "These files are the source of truth for design (framework-agnostic). Port targets say what each surface ships as and which reference/skill to port the design with — leave empty for web/JSX repos where these files are also the implementation."));

  // Default port target (app-wide).
  const hasPort = !!a.port && typeof a.port === "object";
  const defBody = el("div", { class: "authority-port", style: hasPort ? "" : "display:none" });
  if (hasPort) defBody.append(...portFields(a.port));
  const defToggle = el("label", { class: "authority-toggle", style: "margin-top:10px;display:block" },
    el("input", { type: "checkbox", checked: hasPort ? "checked" : undefined,
      onchange: (e) => {
        if (e.target.checked) { a.port = a.port || { authoritySource: "", syncSource: "", helperAgent: "" }; }
        else { a.port = null; }
        markDirty(); render();
      } }),
    " This app has a default port target (ships as native/other, not the JSX itself)");
  wrap.append(defToggle, defBody);

  // App-wide ownership + sync process for the canonical implementation. Most
  // relevant when a port target exists (native/other is canonical), but harmless
  // to record either way — it names who keeps the derived examples aligned.
  const ownerIn = el("input", { type: "text", value: a.owner || "", placeholder: "e.g. @openclaw/windows-ui",
    oninput: (e) => { a.owner = e.target.value; markDirty(); } });
  const syncProcIn = el("input", { type: "text", value: a.syncProcess || "", placeholder: "e.g. Regenerated from XAML each release; see docs/design-sync.md",
    oninput: (e) => { a.syncProcess = e.target.value; markDirty(); } });
  wrap.append(el("div", { class: "faces", style: "margin-top:10px;grid-template-columns:1fr 1fr;display:grid;gap:12px" },
    el("div", { class: "editable" }, el("label", {}, "Implementation owner (optional)"), ownerIn),
    el("div", { class: "editable" }, el("label", {}, "Sync process (optional)"), syncProcIn)));

  // Per-area overrides.
  wrap.append(el("div", { class: "muted", style: "margin-top:12px;font-weight:600" }, "Per-area overrides"));
  a.portOverrides.forEach((o, i) => {
    const card = el("div", { class: "authority-override" }, ...portFields(o, { withScope: true }));
    card.append(el("button", { class: "btn", style: "margin-top:8px",
      onclick: () => { a.portOverrides.splice(i, 1); markDirty(); render(); } }, "Remove override"));
    wrap.append(card);
  });
  wrap.append(el("button", { class: "btn", style: "margin-top:8px",
    onclick: () => { a.portOverrides.push({ area: "", components: [], authoritySource: "", syncSource: "", helperAgent: "" }); markDirty(); render(); } },
    "Add area override"));

  return wrap;
}

function renderBrand(t) {
  const b = t.brand || {};
  const nameIn = el("input", { type: "text", value: b.name || "", oninput: (e) => { b.name = e.target.value; markDirty(); $("#brand-name").textContent = e.target.value; } });
  const tagIn = el("input", { type: "text", value: b.tagline || "", oninput: (e) => { b.tagline = e.target.value; markDirty(); $("#brand-tag").textContent = e.target.value; } });
  const descIn = el("textarea", { class: "otextarea", rows: "3", placeholder: "What is this app/project? Who is it for? What does it do? (codegen reads this for context)",
    oninput: (e) => { b.description = e.target.value; markDirty(); const d = $("#brand-desc"); if (d) { d.textContent = e.target.value; d.style.display = e.target.value ? "" : "none"; } } });
  descIn.value = b.description || "";
  return el("section", { class: "block" },
    el("h2", {}, "Brand"),
    el("div", { class: "brand" },
      el("div", { class: "name", id: "brand-name" }, b.name || "Untitled"),
      el("div", { class: "tagline", id: "brand-tag" }, b.tagline || ""),
      el("div", { class: "brand-desc", id: "brand-desc", style: b.description ? "" : "display:none" }, b.description || ""),
      el("div", { class: "chips" }, ...(b.personality || []).map((p) => el("span", { class: "chip" }, p))),
      b.voice ? el("div", { class: "muted", style: "margin-top:6px" }, "Voice — " + b.voice) : "",
      (b.antiReferences || []).length ? el("div", { class: "muted", style: "margin-top:2px" }, "Avoid — " + b.antiReferences.join("; ")) : "",
    ),
    el("div", { class: "faces", style: "margin-top:14px;grid-template-columns:1fr 1fr;display:grid;gap:12px" },
      el("div", { class: "editable" }, el("label", {}, "Brand name"), nameIn),
      el("div", { class: "editable" }, el("label", {}, "Tagline"), tagIn),
    ),
    el("div", { class: "editable", style: "margin-top:12px" }, el("label", {}, "Description (app / project context for codegen)"), descIn),
    renderAuthority(t),
  );
}

function renderColors(t) {
  const list = colorList(t);
  const previewOnly = hasPort(t);
  const section = el("section", { class: "block" }, el("h2", {}, "Color"));
  section.append(el("div", { class: "muted", style: "margin:-6px 0 12px" },
    previewOnly
      ? el("span", {}, "Previewing ", el("strong", {}, THEME_LABEL[state.theme]),
          " — these hex values are preview-only swatches. Bind each color's ",
          el("span", { class: "mono" }, "resource"), " key in code, never the raw hex.")
      : el("span", {}, "Previewing ", el("strong", {}, THEME_LABEL[state.theme]), " theme.")));
  const grid = el("div", { class: "swatches" });
  list.forEach((c, i) => {
    const shown = colorValueForTheme(c, state.theme);
    const colorIn = el("input", { type: "color", value: /^#([0-9a-f]{6})$/i.test(shown) ? shown : "#000000",
      oninput: (e) => {
        setColorValueForTheme(list[i], state.theme, e.target.value);
        if (Array.isArray(t.colors)) setColorValueForTheme(t.colors[i], state.theme, e.target.value);
        fill.style.background = e.target.value; valEl.textContent = e.target.value; applyVars(); markDirty();
      } });
    const fill = el("div", { class: "chipfill", style: `background:${shown}` });
    const valEl = el("span", { class: "val mono" }, shown);
    const themeChips = el("div", { class: "theme-chips" });
    if (c.themes && typeof c.themes === "object") {
      for (const th of THEMES) {
        const v = c.themes[th];
        if (!v) continue;
        themeChips.append(el("span", { class: "theme-chip" + (th === state.theme ? " is-active" : ""), title: `${THEME_LABEL[th]}: ${v}` },
          el("span", { class: "dot", style: `background:${v}` }), th === "highContrast" ? "HC" : THEME_LABEL[th]));
      }
    }
    grid.append(el("div", { class: "swatch" }, fill,
      el("div", { class: "meta" },
        el("div", { class: "row" }, el("span", { class: "name" }, c.name), colorIn),
        el("div", { class: "row" }, valEl),
        c.resource ? el("div", { class: "resource mono", title: "Canonical implementation resource key" }, "→ " + c.resource) : "",
        themeChips.childNodes.length ? themeChips : "",
        c.usage ? el("div", { class: "usage" }, c.usage) : "",
      )));
  });
  section.append(grid);
  return section;
}

function renderTypography(t) {
  const ty = t.typography || {};
  const facesWrap = el("div", { class: "faces" });
  for (const role of ["display", "body", "mono"]) {
    const f = ty[role];
    if (!f) continue;
    const input = el("input", { type: "text", value: f.family || "",
      oninput: (e) => { f.family = e.target.value; applyVars(); markDirty(); sample.style.fontFamily = e.target.value; } });
    const sample = el("div", { style: `font-family:${f.family};font-size:20px` }, role === "mono" ? "0123 const x = 42;" : "The quick brown fox");
    facesWrap.append(el("div", { class: "face" }, el("div", { class: "k" }, role), el("div", { class: "editable" }, sample, input)));
  }
  const scaleWrap = el("div", {});
  for (const s of ty.scale || []) {
    const fam = s.role === "display" ? "var(--font-display)" : s.role === "mono" ? "var(--font-mono)" : "var(--font-body)";
    scaleWrap.append(el("div", { class: "type-row" },
      el("div", { class: "tag mono" }, `${s.name} · ${s.size}/${s.lineHeight} · ${s.weight}`),
      el("div", { style: `font-family:${fam};font-size:${s.size};line-height:${s.lineHeight};font-weight:${s.weight};letter-spacing:${s.tracking || "normal"}` }, "Design is how it works"),
    ));
  }
  return el("section", { class: "block" }, el("h2", {}, "Typography"), facesWrap, scaleWrap);
}

function renderScales(t) {
  const sp = el("div", { class: "scale-strip" });
  for (const s of t.spacing?.scale || []) sp.append(el("div", { class: "space-demo" }, el("div", { class: "bar", style: `width:${s.value}` }), el("span", { class: "tag mono" }, `${s.name}·${s.value}`)));
  const rad = el("div", { class: "scale-strip" });
  for (const r of t.radii || []) rad.append(el("div", { class: "radius-demo" }, el("div", { class: "box", style: `border-radius:${r.value}` }), el("span", { class: "tag mono" }, `${r.name}·${r.value}`)));
  const sh = el("div", { class: "scale-strip" });
  for (const s of t.shadows || []) sh.append(el("div", { class: "shadow-demo" }, el("div", { class: "box", style: `box-shadow:${s.value}` }), el("span", { class: "tag mono" }, s.name)));
  return el("section", { class: "block" }, el("h2", {}, "Spacing"), sp,
    el("h2", { style: "margin-top:22px" }, "Radii"), rad,
    el("h2", { style: "margin-top:22px" }, "Shadows"), sh);
}

function renderPrinciples(t) {
  if (!(t.principles || []).length) return "";
  return el("section", { class: "block" }, el("h2", {}, "Principles"),
    el("ul", { class: "principles" }, ...t.principles.map((p) => el("li", {}, p))));
}

/* ---------- component previews (React + Babel) ---------- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = el("script", { src }); s.onload = resolve; s.onerror = () => reject(new Error("failed " + src));
    document.head.append(s);
  });
}

let reactReady = null;
async function ensureReact() {
  if (window.React && window.ReactDOM && window.Babel) return true;
  if (!reactReady) {
    reactReady = (async () => {
      await loadScript("https://unpkg.com/react@18/umd/react.production.min.js");
      await loadScript("https://unpkg.com/react-dom@18/umd/react-dom.production.min.js");
      // Pin to Babel 7: Babel 8's preset-react defaults runtime to "automatic",
      // which emits a top-level `import ... from "react/jsx-runtime"` that is illegal
      // inside the `new Function` body we build below. (We also force classic runtime
      // explicitly at transform time as a belt-and-suspenders guard.)
      await loadScript("https://unpkg.com/@babel/standalone@7/babel.min.js");
    })();
  }
  try { await reactReady; return !!(window.React && window.ReactDOM && window.Babel); }
  catch { return false; }
}

function exportNames(src) {
  const names = [];
  const re = /export\s+(?:default\s+)?(?:function|const|let|var)\s+([A-Za-z0-9_$]+)/g;
  let m; while ((m = re.exec(src))) names.push(m[1]);
  return [...new Set(names)];
}

async function renderComponents(t, src) {
  const section = el("section", { class: "block" }, el("h2", {}, "Components"));
  if (!src.trim()) { section.append(el("div", { class: "muted" }, "No components.jsx yet.")); return section; }

  const names = exportNames(src);
  const ok = await ensureReact();

  state.componentBuildError = null;
  let comps = null, buildErr = null;
  if (ok) {
    try {
      const stripped = src.replace(/export\s+default\s+/g, "").replace(/export\s+/g, "");
      // Force the classic runtime so JSX compiles to React.createElement(...) — the
      // automatic runtime would emit a top-level jsx-runtime import that can't live
      // inside a `new Function` body. Works on both Babel 7 and 8.
      const code = window.Babel.transform(stripped, { presets: [["react", { runtime: "classic" }]], filename: "components.jsx" }).code;
      const factory = new Function("React", `${code}\nreturn {${names.join(",")}};`);
      comps = factory(window.React);
    } catch (e) {
      buildErr = String(e && e.message ? e.message : e);
      state.componentBuildError = buildErr;
      try { console.error("[colophon] component preview build failed:", e); } catch { /* noop */ }
    }
  }

  for (const name of names) {
    const card = el("div", { class: "preview" });
    card.append(el("div", { class: "head" }, el("span", { class: "cname" }, name)));
    const stage = el("div", { class: "stage" });
    const surface = el("div", { class: "ds-preview-surface", style: "padding:20px" });
    stage.append(surface);
    card.append(stage);

    if (comps && comps[name]) {
      try { window.ReactDOM.createRoot(surface).render(window.React.createElement(comps[name])); }
      catch (e) { surface.append(el("div", { class: "err" }, "Render error: " + (e.message || e))); }
    } else {
      surface.append(el("div", { class: "err" }, ok ? ("Build error: " + (buildErr || "component not found")) : "Live preview needs network access to load React. Source shown below."));
    }
    const blockSrc = sliceComponent(src, name);
    card.append(el("details", { class: "src" }, el("summary", {}, "Source"), el("pre", { class: "mono" }, el("code", {}, blockSrc))));
    section.append(card);
  }
  return section;
}

function sliceComponent(src, name) {
  const idx = src.search(new RegExp(`(export\\s+)?(function|const|let|var)\\s+${name}\\b`));
  if (idx < 0) return src;
  // Grab from the declaration to the next top-level export/function or EOF.
  const after = src.slice(idx);
  const next = after.slice(1).search(/\n(export\s+)?(function|const)\s/);
  return (next < 0 ? after : after.slice(0, next + 1)).trim();
}

/* ---------- onboarding + proposal ---------- */

function onboarding() {
  // Collapsible: once you've seen the setup options you rarely need them again,
  // and this block only shows pre-setup (source === "sample"). Remember the
  // open/closed choice best-effort; default open so first-run is guided.
  let open = true;
  try { const s = localStorage.getItem("colophon.onboardOpen"); if (s !== null) open = s === "1"; } catch { /* no storage */ }

  const wrap = el("details", open ? { class: "onboard", open: "" } : { class: "onboard" });
  wrap.addEventListener("toggle", () => { try { localStorage.setItem("colophon.onboardOpen", wrap.open ? "1" : "0"); } catch { /* no storage */ } });

  wrap.append(el("summary", { class: "onboard-summary" },
    el("span", { class: "chev", "aria-hidden": "true" }, "▸"),
    el("div", { class: "onboard-head" },
      el("h2", {}, "Set up a design system"),
      el("div", { class: "muted" }, "This repo has no ", el("span", { class: "mono" }, ".agents/design/"), " yet — the starter below is a preview. Choose how to start; refine everything in the canvas afterward."))));

  const body = el("div", { class: "onboard-body" });
  body.append(el("div", { class: "muted" }, "Seeding also adds an ", el("span", { class: "mono" }, "AGENTS.md"), " pointer so every agent reads the system before UI work."));

  const cards = el("div", { class: "onboard-cards" });

  // 1) Start fresh
  cards.append(el("div", { class: "ocard" },
    el("div", { class: "otitle" }, "Start fresh"),
    el("div", { class: "muted" }, "Generate a new system and refine it here."),
    el("div", { class: "orow" },
      el("button", { class: "btn primary", onclick: () => doInit("starter") }, "Use bundled starter"),
      el("button", { class: "btn", onclick: () => doInit("scratch") }, "Blank skeleton")),
  ));

  // 2) Import tokens
  const pathIn = el("input", { type: "text", placeholder: "path/to/tokens.json (repo-relative)", class: "otext" });
  const jsonIn = el("textarea", { placeholder: "…or paste token JSON here", class: "otextarea", rows: "3" });
  cards.append(el("div", { class: "ocard" },
    el("div", { class: "otitle" }, "Import tokens"),
    el("div", { class: "muted" }, "Inherit an existing token set, then refine."),
    el("div", { class: "orow" }, pathIn, el("button", { class: "btn", onclick: () => doImport({ path: pathIn.value.trim() }) }, "Import file")),
    jsonIn,
    el("div", { class: "orow" }, el("button", { class: "btn", onclick: () => doImport({ json: jsonIn.value }) }, "Import JSON")),
  ));

  // 3) Scan codebase
  const scanBtn = el("button", { class: "btn", onclick: () => doScan(scanBtn) }, "Scan this repo");
  cards.append(el("div", { class: "ocard" },
    el("div", { class: "otitle" }, "Scan existing UI"),
    el("div", { class: "muted" }, "Extract colors, type & spacing from current code."),
    el("div", { class: "orow" }, scanBtn),
  ));

  body.append(cards);
  wrap.append(body);
  return wrap;
}

function proposalBar() {
  const p = state.proposal || {};
  const bar = el("section", { class: "banner proposal" });
  bar.append(el("div", { class: "prow" },
    el("div", {},
      el("strong", {}, "Proposed from " + (p.label || "import")),
      el("span", { class: "muted", style: "margin-left:8px" }, "Not saved yet — refine below, then save."),
    ),
    el("div", { class: "pactions" },
      el("button", { class: "btn primary", onclick: doSaveProposal }, "Save to repo"),
      el("button", { class: "btn", onclick: discardProposal }, "Discard"),
    )));
  if (p.evidence) {
    const ev = p.evidence;
    bar.append(el("div", { class: "muted", style: "margin-top:6px" },
      `Scanned ${ev.fileCount} files · ${(ev.topColors || []).length} colors · ${(ev.fonts || []).length} font(s)${ev.hasTailwind ? " · Tailwind detected" : ""}`));
  }
  if (state.tokens?.authority?.port || (state.tokens?.authority?.portOverrides || []).length) {
    bar.append(el("div", { class: "muted", style: "margin-top:6px" },
      "Little/no web styling was found, so this looks like a native app. These tokens are a design starting point — set the ",
      el("strong", {}, "port target"),
      " (what it ships as + the sync source/skill to port with) in Brand → Authority before saving."));
  }
  if ((p.warnings || []).length) {
    bar.append(el("ul", { class: "warnlist" }, ...p.warnings.map((w) => el("li", {}, w))));
  }
  return bar;
}

function enterProposal(data, label) {
  state.tokens = JSON.parse(JSON.stringify(data.tokens || {}));
  state.mode = "proposal";
  state.proposal = { label, warnings: data.warnings || [], evidence: data.evidence || null };
  state.dirty = true;
  applyVars();
  render();
  const save = $("#save-btn"); if (save) { save.disabled = false; save.textContent = "Save to repo"; }
}

async function doImport(body) {
  if (!body.path && !(body.json && body.json.trim())) { alert("Enter a file path or paste JSON."); return; }
  try {
    const out = await api("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    enterProposal(out, body.path ? body.path : "pasted JSON");
  } catch (e) { alert("Import failed: " + e.message); }
}

async function doScan(btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Scanning…"; }
  try {
    const out = await api("/api/scan", { method: "POST" });
    enterProposal(out, "codebase scan");
  } catch (e) { alert("Scan failed: " + e.message); if (btn) { btn.disabled = false; btn.textContent = "Scan this repo"; } }
}

async function doSaveProposal() {
  try {
    const out = await api("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokens: state.tokens }) });
    state.design.source = "repo"; state.design.dir = out.dir;
    state.mode = "normal"; state.proposal = null;
    await load();
  } catch (e) { alert("Save failed: " + e.message); }
}

function discardProposal() {
  state.mode = "normal"; state.proposal = null;
  load();
}

/* ---------- validation ---------- */

function checksDescription() {
  const ported = hasPort(state.tokens);
  const nodes = [
    el("p", { class: "vdesc-line" },
      el("strong", {}, "What this checks: "),
      "that ", el("code", {}, "design.json"), " parses and defines the core token groups (colors, type, spacing, radii), and that ",
      el("code", {}, "components.jsx"), " exports patterns with balanced syntax — the authoritative render check runs live here in the canvas."),
  ];
  if (ported) {
    nodes.push(el("p", { class: "vdesc-line" },
      "A native port is declared, so the shipping implementation — not this preview — is the source of truth. It also requires every color to carry a ",
      el("code", {}, "resource"), " key and the authority to name an ",
      el("code", {}, "owner"), " and a ", el("code", {}, "syncProcess"),
      ". Those are the breadcrumbs that keep the design files and the shipping code from silently drifting apart."));
  } else {
    nodes.push(el("p", { class: "vdesc-line muted" },
      "No port is declared, so the design files are canonical (there is no second copy to drift against) — the drift checks for ",
      el("code", {}, "resource"), " keys, ", el("code", {}, "owner"), ", and ", el("code", {}, "syncProcess"), " don't apply here."));
  }
  return nodes;
}

function validationPanel() {
  const v = state.validation;
  if (!v) return "";
  const errors = [...(v.errors || [])];
  const warnings = [...(v.warnings || [])];
  if (state.componentBuildError) errors.push("components.jsx failed to compile/render in the live preview: " + state.componentBuildError);
  const ok = errors.length === 0;
  const bar = el("section", { class: "banner validation " + (ok ? "vok" : "vbad"), role: "status" });
  bar.append(el("div", { class: "prow" },
    el("div", {},
      el("strong", {}, ok ? "✓ Design system valid" : "✗ Validation found issues"),
      el("span", { class: "muted", style: "margin-left:8px" }, `${errors.length} error(s), ${warnings.length} warning(s)`),
      state.dirty ? el("span", { class: "muted", style: "margin-left:8px" }, "· validates the saved system — save to include unsaved edits") : "",
    ),
    el("div", { class: "pactions" }, el("button", { class: "btn", onclick: () => { state.validation = null; renderValidation(); } }, "Dismiss"))));
  bar.append(el("div", { class: "vdesc" }, ...checksDescription()));
  if (errors.length) bar.append(el("ul", { class: "warnlist err" }, ...errors.map((e) => el("li", {}, e))));
  if (warnings.length) bar.append(el("ul", { class: "warnlist" }, ...warnings.map((w) => el("li", {}, w))));
  return bar;
}

// The validation result floats in a fixed bar just below the sticky topbar,
// so it stays visible while scrolling and doesn't shove the page content down.
function positionValidationSlot() {
  const slot = $("#validation-slot");
  const bar = $(".topbar");
  if (slot && bar) slot.style.top = (bar.offsetHeight + 8) + "px";
}

function renderValidation() {
  const slot = $("#validation-slot");
  if (!slot) return;
  slot.textContent = "";
  const panel = validationPanel();
  if (panel) { slot.append(panel); positionValidationSlot(); }
}

async function doValidate() {
  const btn = $("#validate-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Validating…"; }
  try {
    state.validation = await api("/api/validate");
    renderValidation();
  } catch (e) { alert("Validate failed: " + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Validate"; } }
}

/* ---------- theme preview ---------- */

function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  state.theme = theme;
  for (const b of document.querySelectorAll("#theme-switch .theme-btn")) {
    const active = b.dataset.theme === theme;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-pressed", active ? "true" : "false");
  }
  applyVars();
  render();
}

/* ---------- top-level render ---------- */

async function render() {
  const t = state.tokens;
  const root = $("#app");
  root.textContent = "";

  if (state.design.parseError) {
    root.append(el("div", { class: "banner warn" }, "design.json has a JSON error and could not be parsed — showing the starter tokens. Fix: " + state.design.parseError));
  }

  if (state.mode === "proposal") {
    root.append(proposalBar());
  } else if (state.design.source === "sample") {
    root.append(onboarding());
  }

  renderValidation();

  root.append(renderBrand(t));
  root.append(renderColors(t));
  root.append(renderTypography(t));
  root.append(renderScales(t));
  root.append(renderPrinciples(t));
  root.append(await renderComponents(t, state.design.componentsSource || ""));
}

async function doInit(mode) {
  try { await api("/api/init", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: mode || "starter" }) }); await load(); }
  catch (e) { alert("Init failed: " + e.message); }
}

async function doSave() {
  const btn = $("#save-btn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const out = await api("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokens: state.tokens }) });
    state.design.source = "repo"; state.design.dir = out.dir; state.dirty = false;
    btn.textContent = "Saved ✓";
    updateSourcePill();
  } catch (e) { btn.disabled = false; btn.textContent = "Save changes"; alert("Save failed: " + e.message); }
}

function updateSourcePill() {
  const pill = $("#source-pill");
  if (!pill) return;
  pill.className = "source-pill " + state.design.source;
  pill.textContent = state.design.source === "repo" ? ".agents/design/" : "starter (not saved)";
}

async function load() {
  const data = await api("/api/design");
  state.design = data.design;
  state.tokens = JSON.parse(JSON.stringify(data.design.tokens || {}));
  state.dirty = false;
  applyVars();
  updateSourcePill();
  await render();
  const save = $("#save-btn"); if (save) { save.disabled = true; save.textContent = state.design.source === "repo" ? "Saved" : "Save to repo"; }
}

function connectEvents() {
  try {
    const es = new EventSource("/events");
    es.addEventListener("changed", () => { if (!state.dirty) load(); });
  } catch { /* SSE optional */ }
}

window.addEventListener("DOMContentLoaded", () => {
  $("#save-btn").addEventListener("click", doSave);
  $("#reload-btn").addEventListener("click", () => load());
  $("#validate-btn")?.addEventListener("click", doValidate);
  for (const b of document.querySelectorAll("#theme-switch .theme-btn")) {
    b.addEventListener("click", () => setTheme(b.dataset.theme));
  }
  window.addEventListener("resize", positionValidationSlot);
  load().catch((e) => { $("#app").textContent = "Failed to load design system: " + e.message; });
  connectEvents();
});
