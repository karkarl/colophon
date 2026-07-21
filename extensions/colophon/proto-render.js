/* proto-render.js — the in-canvas scene-graph interpreter + interaction runtime.
   Runs inside the Prototype canvas iframe (plain script, exposes window.ProtoRender).

   It turns the JSONC scene graph into DOM using the design system's CSS variables
   (--color-*, --space-*, --radius-*, --font-*). Leaf `component` nodes are rendered by
   expanding the repo's components.jsonc definitions (via window.DSComp, a pure JSON→DOM
   interpreter — no React or Babel) so previews match the real house style; everything
   else is plain, deterministic DOM. Nothing here is ever evaluated as code — both the
   scene graph and the component definitions are pure data. */

(function () {
  const NODE_KINDS = ["layout", "component", "text", "image", "spacer"];
  function nodeKind(node) {
    if (!node || typeof node !== "object") return null;
    for (const k of NODE_KINDS) if (k in node) return k;
    return null;
  }

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  };

  // ---- component definitions (pure JSON interpreter) ----------------------
  // components.jsonc is expanded to DOM by window.DSComp (components-render.mjs); this
  // just captures the doc + the defined names so the interpreter can render `component`
  // nodes and report unknown references.
  function prepareComponents(doc) {
    const DS = window.DSComp;
    if (!doc || !DS) return { doc: null, names: [], error: DS ? null : "component interpreter not loaded" };
    try {
      return { doc, names: DS.componentNames(doc), error: null };
    } catch (e) {
      return { doc: null, names: [], error: String(e && e.message ? e.message : e) };
    }
  }

  // ---- type scale ---------------------------------------------------------
  // Build a name → {fontSize,...} map + role → family map from tokens, so text nodes can
  // style themselves from the design system's typography instead of magic numbers.
  function buildTypeScale(tokens) {
    const ty = tokens?.typography || {};
    const fonts = {
      display: ty.display?.family || "serif",
      body: ty.body?.family || "sans-serif",
      mono: ty.mono?.family || "monospace",
    };
    const scale = {};
    for (const s of ty.scale || []) scale[s.name] = s;
    // Semantic aliases the scene graph may use that aren't literal scale rows.
    if (!scale.eyebrow) scale.eyebrow = { size: "12px", lineHeight: "16px", weight: 500, role: "mono", tracking: "0.04em", uppercase: true };
    return { scale, fonts };
  }

  function textStyle(styleName, { scale, fonts }, colorToken) {
    const s = scale[styleName] || scale.body || { size: "16px", lineHeight: "24px", weight: 400, role: "body" };
    const fam = fonts[s.role] || fonts.body;
    const parts = [
      `font-family:${fam}`,
      `font-size:${s.size || "16px"}`,
      `line-height:${s.lineHeight || "1.4"}`,
      `font-weight:${s.weight || 400}`,
      "margin:0",
    ];
    if (s.tracking) parts.push(`letter-spacing:${s.tracking}`);
    if (s.uppercase) parts.push("text-transform:uppercase");
    parts.push(`color:var(--color-${colorToken || "ink"})`);
    return parts.join(";");
  }

  // ---- runtime ------------------------------------------------------------
  function createRuntime({ doc, componentsDoc }) {
    const prepared = prepareComponents(componentsDoc || null);
    const state = { ...(doc.state || {}) };
    const screens = doc.screens || [];
    let currentId = screens[0]?.id || null;
    let openModalId = null;
    const history = [];
    let onChange = () => {};
    let onNavigate = () => {};

    function dispatch(action) {
      if (!action || typeof action !== "object") return;
      if (action.navigate) { if (currentId && currentId !== action.navigate) history.push(currentId); currentId = action.navigate; openModalId = null; onNavigate(currentId); }
      else if (action.back) { if (history.length) { currentId = history.pop(); openModalId = null; onNavigate(currentId); } }
      else if (action.setState && typeof action.setState === "object") { Object.assign(state, action.setState); }
      else if (action.toggle) { state[action.toggle] = !state[action.toggle]; }
      else if (action.openModal) { openModalId = action.openModal; }
      else if (action.closeModal) { openModalId = null; }
      onChange();
    }

    return {
      state,
      buildError: prepared.error,
      get componentNames() { return prepared.names.slice(); },
      componentsDoc: prepared.doc,
      get currentId() { return currentId; },
      setScreen(id) { if (screens.some((s) => s.id === id)) { currentId = id; openModalId = null; onChange(); } },
      get openModalId() { return openModalId; },
      dispatch,
      onChange(cb) { onChange = cb; },
      onNavigate(cb) { onNavigate = cb; },
      screen() { return screens.find((s) => s.id === currentId) || null; },
      screens,
      doc,
    };
  }

  // ---- visibility ---------------------------------------------------------
  function matches(cond, state) {
    if (!cond || typeof cond !== "object") return true;
    return Object.entries(cond).every(([k, v]) => state[k] === v);
  }
  function isVisible(node, state) {
    if (node.visibleWhen && !matches(node.visibleWhen, state)) return false;
    if (node.hiddenWhen && matches(node.hiddenWhen, state)) return false;
    return true;
  }

  // ---- node renderers -----------------------------------------------------
  function spaceVar(v) { return v == null ? null : `var(--space-${v})`; }

  function renderLayout(node, ctx) {
    const kind = node.layout;
    const style = [];
    if (kind === "grid") {
      style.push("display:grid");
      style.push(`grid-template-columns:repeat(${node.columns || 1}, minmax(0, 1fr))`);
    } else {
      style.push("display:flex");
      const horizontal = kind === "row" || node.direction === "horizontal";
      style.push(`flex-direction:${horizontal ? "row" : "column"}`);
      if (kind === "row") style.push("flex-wrap:wrap");
      if (node.wrap) style.push("flex-wrap:wrap");
      if (kind === "scroll") style.push("overflow:auto");
    }
    if (node.gap != null) style.push(`gap:${spaceVar(node.gap)}`);
    if (node.padding != null) style.push(`padding:${spaceVar(node.padding)}`);
    if (node.align) style.push(`align-items:${node.align}`);
    if (node.justify) style.push(`justify-content:${node.justify}`);
    if (node.background) style.push(`background:var(--color-${node.background})`);
    if (node.radius) style.push(`border-radius:var(--radius-${node.radius})`);
    if (node.grow) style.push("flex:1");
    style.push("box-sizing:border-box");
    const box = el("div", { class: "proto-node proto-layout", style: style.join(";") });
    for (const child of node.children || []) {
      const rendered = renderNode(child, ctx);
      if (rendered) box.append(rendered);
    }
    return box;
  }

  function renderText(node, ctx) {
    const tag = /^(display|title|heading)$/.test(node.style) ? "h2" : "p";
    return el(tag, { class: "proto-node proto-text", style: textStyle(node.style || "body", ctx.type, node.color) }, node.text);
  }

  function renderImage(node) {
    const style = [];
    if (node.width) style.push(`width:${node.width}`);
    if (node.height) style.push(`height:${node.height}`);
    if (node.radius) style.push(`border-radius:var(--radius-${node.radius})`);
    const src = node.image || node.src;
    if (src && /^(https?:|data:|\/)/.test(src)) {
      style.push(`object-fit:${node.fit || "cover"}`);
      return el("img", { class: "proto-node proto-image", src, alt: node.alt || "", style: style.join(";") });
    }
    // Placeholder tile when there's no real URL.
    style.push("display:flex", "align-items:center", "justify-content:center", "min-height:80px", "background:var(--color-line)", "color:var(--color-muted)", "font:12px var(--font-mono)");
    return el("div", { class: "proto-node proto-image proto-image-ph", style: style.join(";") }, node.alt || "image");
  }

  function renderSpacer(node) {
    return el("div", { class: "proto-node proto-spacer", style: `flex:0 0 auto;width:${spaceVar(node.size || "4")};height:${spaceVar(node.size || "4")}` });
  }

  function renderComponent(node, ctx) {
    const name = node.component;
    const host = el("div", { class: "proto-node proto-component", style: "display:inline-flex;max-width:100%" });
    const DS = window.DSComp;
    const known = ctx.componentsDoc && ctx.componentNames && ctx.componentNames.includes(name);
    if (DS && ctx.componentsDoc && known) {
      try {
        const dom = DS.renderComponent(ctx.componentsDoc, name, node.props || {});
        if (dom) host.append(dom);
        return host;
      } catch (e) {
        host.append(el("div", { class: "proto-err" }, `Render error: ${e.message || e}`));
        return host;
      }
    }
    // Not-found / interpreter-missing fallback: a labeled tile so the flow is still legible.
    const label = node.props && (node.props.children || node.props.title || node.props.label);
    host.append(el("div", { class: "proto-fallback" },
      el("span", { class: "proto-fallback-name" }, name || "component"),
      label ? el("span", { class: "proto-fallback-label" }, String(label)) : null));
    return host;
  }

  function renderNode(node, ctx) {
    if (!node || !isVisible(node, ctx.state)) return null;
    const kind = nodeKind(node);
    let dom;
    if (kind === "layout") dom = renderLayout(node, ctx);
    else if (kind === "text") dom = renderText(node, ctx);
    else if (kind === "image") dom = renderImage(node);
    else if (kind === "spacer") dom = renderSpacer(node);
    else if (kind === "component") dom = renderComponent(node, ctx);
    else dom = el("div", { class: "proto-err" }, `Unknown node "${node.id || "?"}"`);

    const tap = node.on?.tap;
    if (tap) {
      dom.classList.add("proto-tappable");
      dom.addEventListener("click", (e) => { e.stopPropagation(); ctx.dispatch(tap); });
    }
    return dom;
  }

  // Mount any React `component` nodes collected during the DOM build.
  // Render the runtime's current screen (and any open modal) into `surface`.
  function renderScreen(surface, runtime, tokens) {
    surface.innerHTML = "";
    const screen = runtime.screen();
    if (!screen) { surface.append(el("div", { class: "proto-empty" }, "No screen selected.")); return; }
    const ctx = { state: runtime.state, componentsDoc: runtime.componentsDoc, componentNames: runtime.componentNames, dispatch: (a) => runtime.dispatch(a), type: buildTypeScale(tokens) };

    const root = renderNode(screen.root, ctx);
    if (root) { root.classList.add("proto-screen-root"); surface.append(root); }

    if (runtime.openModalId) {
      const modal = (screen.modals || []).find((m) => m.id === runtime.openModalId);
      if (modal) {
        const backdrop = el("div", { class: "proto-modal-backdrop" });
        backdrop.addEventListener("click", () => runtime.dispatch({ closeModal: true }));
        const panel = renderNode(modal.root, ctx);
        if (panel) { panel.classList.add("proto-modal-panel"); panel.addEventListener("click", (e) => e.stopPropagation()); backdrop.append(panel); }
        surface.append(backdrop);
      }
    }
  }

  window.ProtoRender = { createRuntime, renderScreen, buildTypeScale, nodeKind };
})();
