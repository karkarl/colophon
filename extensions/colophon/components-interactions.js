// Shared by the ESM gallery and the classic/offline prototype runtime.
(function () {
  const roots = new WeakMap();
  let nextId = 0;
  let overlay = null;
  const focusable = 'button,input,textarea,select,a[href],[tabindex],[contenteditable]';
  const inspecting = (node) => !!node.closest(".inspect-mode");
  const disabled = (node) => !!node.closest(':disabled,[aria-disabled="true"],[data-ds-forced-disabled]');

  function closeOverlay(restore = false) {
    if (!overlay) return;
    const { trigger, panel, abort, observer } = overlay;
    overlay = null;
    abort.abort();
    observer.disconnect();
    disposeTree(panel);
    panel.remove();
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-controls");
    if (restore && trigger.isConnected && !disabled(trigger)) trigger.focus();
  }

  function openOverlay(trigger, name, context) {
    if (context.overlay) return; // Nested overlays are deliberately out of scope.
    const same = overlay?.trigger === trigger;
    closeOverlay();
    if (same) return;
    const panel = document.createElement("div");
    panel.className = "ds-flyout";
    panel.id = `ds-flyout-${++nextId}`;
    panel.tabIndex = -1;
    const dom = context.render(name, { overlay: true });
    if (dom) panel.append(dom);
    document.body.append(panel);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", panel.id);
    const abort = new AbortController();
    const on = (target, type, fn, capture = false) => target.addEventListener(type, fn, { signal: abort.signal, capture });
    const position = () => {
      const computed = getComputedStyle(trigger);
      const variables = new Set([...computed].filter((key) => key.startsWith("--")));
      // Some Chromium hosts omit custom properties from computed-style enumeration.
      // Collect names from local declarations, but copy the trigger's resolved values.
      const collect = (style) => {
        for (const key of style || []) if (key.startsWith("--")) variables.add(key);
      };
      for (let parent = trigger; parent; parent = parent.parentElement) collect(parent.style);
      const rules = (list) => {
        for (const rule of list) {
          collect(rule.style);
          if (rule.cssRules) rules(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) {
        if (sheet.href && new URL(sheet.href).origin !== location.origin) continue;
        rules(sheet.cssRules);
      }
      for (const key of variables) panel.style.setProperty(key, computed.getPropertyValue(key));
      for (const key of ["font-family", "font-size", "line-height", "color", "direction"]) {
        panel.style.setProperty(key, computed.getPropertyValue(key));
      }
      const rect = trigger.getBoundingClientRect();
      const scale = trigger.offsetWidth ? rect.width / trigger.offsetWidth : 1;
      const zoom = scale > 0 ? scale : 1;
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      panel.style.maxWidth = `${width / zoom}px`;
      panel.style.maxHeight = `${height / zoom}px`;
      panel.style.transform = `scale(${zoom})`;
      const w = panel.offsetWidth * zoom, h = panel.offsetHeight * zoom;
      const left = computed.direction === "rtl" ? rect.right - w : rect.left;
      panel.style.left = `${Math.max(0, Math.min(left, width - w))}px`;
      panel.style.top = `${Math.max(0, Math.min(rect.bottom + h <= height ? rect.bottom : rect.top - h, height - h))}px`;
    };
    const observer = new MutationObserver((changes) => {
      if (!trigger.isConnected || inspecting(trigger) || disabled(trigger)) closeOverlay();
      else if (changes.some((change) => !panel.contains(change.target))) position();
    });
    overlay = { trigger, panel, abort, observer };
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-theme", "disabled", "aria-disabled"] });
    on(document, "pointerdown", (event) => {
      if (!panel.contains(event.target) && !trigger.contains(event.target)) closeOverlay();
    }, true);
    on(document, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOverlay(true);
      }
    }, true);
    on(document, "focusin", (event) => {
      if (!panel.contains(event.target) && !trigger.contains(event.target)) closeOverlay();
    });
    on(panel, "change", (event) => {
      if (event.target.matches('input[type="radio"]')) closeOverlay(true);
    });
    on(panel, "click", (event) => event.stopPropagation());
    on(window, "resize", position);
    on(document, "scroll", position, true);
    position();
    const first = [...panel.querySelectorAll(focusable)].find((node) => !disabled(node) && node.tabIndex >= 0 && node.getClientRects().length);
    (first || panel).focus();
  }

  function createContext(render, options = {}) {
    const abort = new AbortController();
    const context = {
      render, overlay: !!options.overlay, id: ++nextId, records: [], abort,
      forced: "live", observer: null,
      on(target, type, listener, capture = false) {
        target.addEventListener(type, listener, { signal: abort.signal, capture });
      },
    };
    return context;
  }

  function attach(node, spec, context) {
    if (node.matches('input[type="radio"]') && node.name) node.name = `ds-${context.id}-${node.name}`;
    if (spec.control) {
      if (spec.control.chrome === "none") node.dataset.dsChrome = "none";
      if (spec.control.focus) {
        node.dataset.dsFocus = spec.control.focus.kind;
        node.style.setProperty("--ds-focus-color", `var(--color-${spec.control.focus.color})`);
      }
    }
    if (!spec.states && !spec.on && !spec.control) return;
    const states = spec.states || {};
    if (spec.states) node.dataset.dsStates = "";
    const keys = new Set(Object.values(states).flatMap((style) => Object.keys(style)));
    const base = new Map([...keys].map((key) => [key, [node.style.getPropertyValue(key), node.style.getPropertyPriority(key)]]));
    const record = { node, hover: false, pointer: null, keyboard: false, release: null, saved: null };
    context.records.push(record);
    const restoreDisabled = () => {
      if (!record.saved) return;
      for (const [key, value] of Object.entries(record.saved)) {
        if (value === null) node.removeAttribute(key);
        else node.setAttribute(key, value);
      }
      record.saved = null;
      delete node.dataset.dsForcedDisabled;
    };
    record.update = () => {
      const forcedDisabled = !!spec.states && context.forced === "disabled";
      if (forcedDisabled && !record.saved) {
        record.saved = {};
        // Native disabled preserves form semantics; inert covers editable descendants.
        const attrs = node.matches("button,input,textarea,select") ? ["disabled", "inert"] : ["aria-disabled", "inert"];
        for (const key of attrs) {
          record.saved[key] = node.getAttribute(key);
          node.setAttribute(key, key === "aria-disabled" ? "true" : "");
        }
        node.dataset.dsForcedDisabled = "";
      } else if (!forcedDisabled) restoreDisabled();
      const isDisabled = disabled(node);
      const live = context.forced === "live";
      const hover = live ? record.hover : ["hover", "hoverPressed"].includes(context.forced);
      const pressed = live ? record.pointer !== null || record.keyboard : ["pressed", "hoverPressed"].includes(context.forced);
      const style = isDisabled ? states.disabled : {
        ...(hover ? states.hover : {}),
        ...(pressed ? states.pressed : {}),
        ...(hover && pressed ? states.hoverPressed : {}),
      };
      for (const [key, [value, priority]] of base) {
        if (style && Object.hasOwn(style, key)) node.style.setProperty(key, style[key]);
        else if (value) node.style.setProperty(key, value, priority);
        else node.style.removeProperty(key);
      }
    };
    record.reset = () => {
      record.hover = false;
      record.pointer = null;
      record.keyboard = false;
      record.release?.();
      record.update();
    };
    context.on(node, "pointerenter", () => { if (!inspecting(node)) { record.hover = true; record.update(); } });
    context.on(node, "pointerleave", () => { record.hover = false; record.update(); });
    context.on(node, "pointerdown", (event) => {
      if (event.button !== 0 || event.isPrimary === false || disabled(node) || inspecting(node)) return;
      record.pointer = event.pointerId;
      record.update();
      record.release?.();
      const press = new AbortController();
      record.release = () => { press.abort(); record.release = null; };
      const end = (up) => {
        if (up.pointerId !== record.pointer) return;
        record.pointer = null;
        record.release?.();
        record.update();
      };
      document.addEventListener("pointerup", end, { signal: press.signal, capture: true });
      document.addEventListener("pointercancel", end, { signal: press.signal, capture: true });
    });
    context.on(node, "lostpointercapture", record.reset);
    context.on(node, "blur", record.reset);
    const button = node.matches('button,[role="button"]') || !!spec.on?.click?.open;
    context.on(node, "keydown", (event) => {
      if (!button || !["Enter", " "].includes(event.key) || inspecting(node)) return;
      if (disabled(node)) { event.preventDefault(); event.stopPropagation(); return; }
      record.keyboard = true;
      record.update();
      if (node.localName !== "button") {
        event.preventDefault();
        if (event.key === "Enter" && !event.repeat) node.click();
      }
    });
    context.on(node, "keyup", (event) => {
      if (!button || !["Enter", " "].includes(event.key)) return;
      const activate = record.keyboard && event.key === " " && node.localName !== "button";
      record.keyboard = false;
      record.update();
      if (activate && !disabled(node) && !inspecting(node)) { event.preventDefault(); node.click(); }
    });
    context.on(node, "beforeinput", (event) => {
      if (disabled(node)) event.preventDefault();
    });
    context.on(node, "keydown", (event) => {
      if (!inspecting(node) && disabled(node) && event.key !== "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    if (spec.on?.click?.open) {
      if (!node.matches('button,input,a[href],[role="button"]')) node.setAttribute("role", "button");
      if (!node.matches("button,input,a[href]") && !node.hasAttribute("tabindex")) node.tabIndex = 0;
      node.setAttribute("aria-haspopup", "true");
      node.setAttribute("aria-expanded", "false");
    }
    context.on(node, "click", (event) => {
      if (inspecting(node)) return;
      if (disabled(node)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (spec.on?.click?.open) {
        event.preventDefault();
        event.stopPropagation();
        openOverlay(node, spec.on.click.open, context);
      }
    });
    // Capture disabled descendants before their own activation/navigation handlers.
    context.on(node, "click", (event) => {
      if (!inspecting(node) && disabled(node)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    record.update();
  }

  function mount(root, context) {
    if (!root || root.nodeType !== 1 || !context.records.length) return root;
    roots.set(root, context);
    context.observer = new MutationObserver(() => {
      for (const record of context.records) record.update();
    });
    context.observer.observe(root, { attributes: true, subtree: true, attributeFilter: ["disabled", "aria-disabled"] });
    context.on(window, "blur", () => {
      for (const record of context.records) record.reset();
      closeOverlay();
    });
    context.on(document, "visibilitychange", () => {
      if (document.hidden) {
        for (const record of context.records) record.reset();
        closeOverlay();
      }
    });
    return root;
  }

  function disposeTree(root) {
    if (!root) return;
    if (overlay && (root === overlay.trigger || root.contains?.(overlay.trigger))) closeOverlay();
    for (const node of [root, ...root.querySelectorAll?.("*") || []]) {
      const context = roots.get(node);
      if (!context) continue;
      context.abort.abort();
      context.observer?.disconnect();
      for (const record of context.records) record.release?.();
      roots.delete(node);
    }
  }

  function forceState(root, state) {
    if (!["live", "rest", "hover", "pressed", "hoverPressed", "disabled"].includes(state)) throw new Error(`Unknown preview state "${state}".`);
    if (overlay && root.contains(overlay.trigger)) closeOverlay();
    for (const node of [root, ...root.querySelectorAll("*")]) {
      const context = roots.get(node);
      if (!context) continue;
      context.forced = state;
      for (const record of context.records) record.update();
    }
  }

  function resetTree(root) {
    closeOverlay();
    for (const node of [root, ...root.querySelectorAll("*")]) {
      const context = roots.get(node);
      if (!context) continue;
      context.forced = "live";
      for (const record of context.records) record.reset();
    }
  }

  window.DSInteractions = { createContext, attach, mount, disposeTree, forceState, resetTree, closeOverlay };
}());
