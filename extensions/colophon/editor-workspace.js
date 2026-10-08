/* Both editors supply document operations; gestures and feedback live here. */
window.EditorWorkspace = { create(adapter) {
  const $ = (selector) => document.querySelector(selector);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const pathKey = (path) => JSON.stringify(path || []);
  const el = (tag, attrs, ...children) => {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
      else element.setAttribute(key, value);
    }
    element.append(...children);
    return element;
  };
  let zoom = 1, paletteKey = "", paletteDrag = null, resizing = null, hovered = null, selectedElement = null;
  let frame = 0;
  const elementsFor = (path) => [...adapter.preview().querySelectorAll(adapter.nodeSelector)]
    .filter((node) => pathKey(adapter.nodePath(node)) === pathKey(path));
  const announce = (message) => {
    const slot = $("#inspect-announcement");
    if (slot && slot.textContent !== message) slot.textContent = message;
  };
  const report = (error) => { adapter.report(error); announce(error.message); };
  const bounds = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.width) || element.offsetWidth;
    const height = Number.parseFloat(style.height) || element.offsetHeight;
    return { width, height, scaleX: rect.width / width || zoom, scaleY: rect.height / height || zoom };
  };
  const locate = (path) => {
    const candidates = elementsFor(path);
    if (candidates.includes(selectedElement)) return selectedElement;
    return candidates.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0;
    }) || candidates[0];
  };
  const placeBox = (box, rect) => {
    const origin = $("#inspect-overlays").getBoundingClientRect();
    box.style.left = `${rect.left - origin.left}px`;
    box.style.top = `${rect.top - origin.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.hidden = rect.bottom < origin.top || rect.top > origin.bottom || rect.right < origin.left || rect.left > origin.right;
  };
  const resizeable = (element) => element && element.namespaceURI === "http://www.w3.org/1999/xhtml"
    && !["inline", "contents", "none"].includes(getComputedStyle(element).display);
  function refreshBounds() {
    const overlay = $("#inspect-overlays");
    if (!overlay) return;
    overlay.hidden = !adapter.enabled();
    if (adapter.viewport) {
      const viewport = adapter.viewport().getBoundingClientRect();
      Object.assign(overlay.style, { left: `${viewport.left}px`, top: `${viewport.top}px`, width: `${viewport.width}px`, height: `${viewport.height}px`, right: "auto", bottom: "auto" });
    }
    const box = $("#inspect-selection-box");
    const element = adapter.selection() ? locate(adapter.selection()) : null;
    box.hidden = !element || overlay.hidden;
    if (element && !overlay.hidden) {
      placeBox(box, element.getBoundingClientRect());
      const size = bounds(element);
      $("#inspect-measurement").textContent = `${Math.round(size.width)} x ${Math.round(size.height)}`;
      for (const handle of box.querySelectorAll(".resize-handle")) handle.hidden = !resizeable(element);
    }
    const hover = $("#inspect-hover-box");
    hover.hidden = !hovered?.isConnected || !!resizing || overlay.hidden;
    if (!hover.hidden) placeBox(hover, hovered.getBoundingClientRect());
  }

  function scheduleBounds() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; refreshBounds(); });
  }

  function template(kind) {
    return window.EditorGeometry.template(kind, adapter.tokens(), adapter.schema);
  }

  function selectedDestination() {
    const path = adapter.selection()?.slice();
    if (!path) throw new Error("Select a layer before inserting.");
    return { path, placement: adapter.canContain(adapter.value(adapter.doc(), path)) ? "inside" : "after" };
  }

  function insert(kind, destination = null) {
    try {
      destination ||= selectedDestination();
      const node = template(kind);
      return adapter.commit(() => {
        adapter.prepare(adapter.doc());
        const path = adapter.insert(adapter.doc(), destination.path, node, destination.placement);
        positionAtDrop(adapter.doc(), path, destination);
        return path;
      });
    } catch (error) { report(error); }
  }

  function renderPalette() {
    const names = adapter.names();
    const key = JSON.stringify(names);
    if (key === paletteKey) return;
    paletteKey = key;
    const items = $("#insert-items");
    items.replaceChildren();
    for (const [kind, label] of [["frame", "Frame"], ["rectangle", "Rectangle"], ["text", "Text"], ...names.map((name) => [`component:${name}`, name])]) {
      const button = el("button", {
        type: "button", draggable: "true", "data-insert-kind": kind, title: `Insert ${label}`,
        onclick: () => insert(kind),
        ondragstart: (event) => {
          paletteDrag = kind;
          adapter.setDragPath(null);
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("text/plain", label);
        },
        ondragend: () => { paletteDrag = null; clearDrop(); },
      }, label);
      items.append(button);
    }
  }

  function refresh() {
    adapter.refresh(zoom);
    if (adapter.enabled()) renderPalette();
    const parentButton = $("#select-parent-btn");
    if (parentButton) parentButton.disabled = adapter.selection()?.at(-2) !== "children";
    refreshBounds();
  }

  function clearDrop() {
    const box = $("#inspect-drop-box");
    if (box) box.hidden = true;
  }

  function hoverPath(path) {
    hovered = path ? locate(path) : null;
    refreshBounds();
  }

  function showDrop(destination) {
    const { element, placement, axis = "y" } = destination;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const box = $("#inspect-drop-box");
    const horizontal = axis === "x";
    const edge = placement === "after" ? (horizontal ? rect.right : rect.bottom) : (horizontal ? rect.left : rect.top);
    const line = placement !== "inside";
    placeBox(box, {
      left: line && horizontal ? edge : rect.left, top: line && !horizontal ? edge : rect.top,
      width: line && horizontal ? 0 : rect.width, height: line && !horizontal ? 0 : rect.height,
      right: rect.right, bottom: rect.bottom,
    });
    box.dataset.axis = line ? axis : "";
    const node = adapter.value(adapter.doc(), destination.path);
    const label = `${placement[0].toUpperCase() + placement.slice(1)} ${adapter.label(node)}`;
    $("#inspect-drop-label").textContent = label;
    announce(label);
  }

  function showTreeDrop(path, placement) {
    const parent = adapter.value(adapter.doc(), path.slice(0, -2));
    showDrop({ path, placement, element: locate(path), axis: adapter.layout(parent) === "horizontal" ? "x" : "y" });
  }

  function positionAtDrop(doc, path, destination) {
    const node = adapter.value(doc, path);
    const parent = adapter.value(doc, path.slice(0, -2));
    if (adapter.layout(parent) !== "freeform") { delete node.position; return; }
    if (destination.point) node.position = { mode: "absolute", ...destination.point };
    else node.position ||= { mode: "absolute", x: 0, y: 0 };
  }

  function dropDestination(event) {
    const element = event.target.closest?.(adapter.nodeSelector);
    const path = element && adapter.nodePath(element);
    if (!path) throw new Error("Drop on a layer.");
    const node = adapter.value(adapter.doc(), path);
    const parent = adapter.value(adapter.doc(), path.slice(0, -2));
    const axis = adapter.layout(parent) === "horizontal" ? "x" : "y";
    const rect = element.getBoundingClientRect();
    const ratio = axis === "x" ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
    const root = path.at(-2) !== "children";
    const inside = adapter.canContain(node) && (root || (ratio >= .28 && ratio <= .72));
    const placement = inside ? "inside" : ratio < .5 ? "before" : "after";
    const { parentPath, parent: destinationParent } = adapter.destination(adapter.doc(), path, placement, adapter.dragPath());
    const destination = { path, placement, element, axis };
    if (adapter.layout(destinationParent) === "freeform") {
      let parentElement = element;
      while (parentElement && pathKey(adapter.nodePath(parentElement)) !== pathKey(parentPath)) parentElement = parentElement.parentElement;
      if (!parentElement) throw new Error("The freeform parent is not visible here.");
      const parentRect = parentElement.getBoundingClientRect();
      const size = bounds(parentElement);
      destination.point = {
        x: Math.round((event.clientX - parentRect.left) / size.scaleX - parentElement.clientLeft + parentElement.scrollLeft),
        y: Math.round((event.clientY - parentRect.top) / size.scaleY - parentElement.clientTop + parentElement.scrollTop),
      };
    }
    const candidate = clone(adapter.doc());
    adapter.prepare(candidate);
    const nextPath = paletteDrag
      ? adapter.insert(candidate, path, template(paletteDrag), placement)
      : adapter.move(candidate, adapter.dragPath(), path, placement);
    positionAtDrop(candidate, nextPath, destination);
    adapter.validate(candidate);
    return destination;
  }

  function beginResize(event) {
    if (event.button !== 0 || !adapter.enabled() || adapter.moving() || resizing || adapter.beforeGesture?.() === false) return;
    const path = adapter.selection();
    if (!path) return;
    const element = locate(path);
    if (!resizeable(element)) return;
    event.preventDefault();
    const size = bounds(element);
    resizing = {
      pointerId: event.pointerId, handle: event.currentTarget, axes: event.currentTarget.dataset.resize,
      path: path.slice(), x: event.clientX, y: event.clientY, size, next: {},
      originals: elementsFor(path).map((node) => [node, node.style.cssText]),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("inspect-resizing");
  }

  function moveResize(event) {
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    const gesture = resizing;
    const { size, axes } = gesture;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 2 && !Object.keys(gesture.next).length) return;
    let width = Math.max(1, Math.min(1000000, size.width + (event.clientX - gesture.x) / size.scaleX));
    let height = Math.max(1, Math.min(1000000, size.height + (event.clientY - gesture.y) / size.scaleY));
    if (event.shiftKey && axes === "se" && size.width > 0 && size.height > 0) {
      const factor = Math.min(1000000 / Math.max(size.width, size.height), Math.max(width / size.width, height / size.height));
      width = size.width * factor;
      height = size.height * factor;
    }
    gesture.next = {
      ...(axes.includes("e") ? { width: Math.round(width * 100) / 100 } : {}),
      ...(axes.includes("s") ? { height: Math.round(height * 100) / 100 } : {}),
    };
    for (const [element] of gesture.originals) {
      for (const [key, value] of Object.entries(gesture.next)) element.style[key] = `${value}px`;
    }
    refreshBounds();
    event.preventDefault();
  }

  function finishResize(cancelled = false) {
    const gesture = resizing;
    if (!gesture) return;
    resizing = null;
    if (gesture.handle.hasPointerCapture(gesture.pointerId)) gesture.handle.releasePointerCapture(gesture.pointerId);
    for (const [element, style] of gesture.originals) element.style.cssText = style;
    document.body.classList.remove("inspect-resizing");
    adapter.suppressClick();
    if (!cancelled && Object.entries(gesture.next).some(([key, value]) => Math.abs(value - gesture.size[key]) > .01)) {
      Promise.resolve(adapter.commit(() => {
        adapter.prepare(adapter.doc());
        const node = adapter.value(adapter.doc(), gesture.path);
        Object.assign(window.EditorGeometry.dimensions(node, adapter.schema), gesture.next);
      })).then((committed) => {
        if (committed) announce("Layer resized. Undo is available.");
      });
    }
    refreshBounds();
  }

  function cancel() {
    finishResize(true);
    paletteDrag = null;
    adapter.setDragPath(null);
    hovered = null;
    clearDrop();
  }

  function scale(factor) {
    if (adapter.beforeGesture?.() === false) return;
    const path = adapter.selection();
    const node = path && adapter.value(adapter.doc(), path);
    const element = node && locate(path);
    if (!element || !resizeable(element)) { report(new Error("Select a visible, resizable layer.")); return; }
    return adapter.commit(() => {
      adapter.prepare(adapter.doc());
      window.EditorGeometry.scale(node, factor, bounds(element), adapter.schema);
    });
  }

  function selectParent() {
    if (adapter.selection()?.at(-2) !== "children") return;
    adapter.select(adapter.selection().slice(0, -2));
  }

  function appendScaleControl(slot, propertyField) {
    const multiplier = el("input", { type: "number", min: "0.1", max: "10", step: "0.1", value: "1", "aria-label": "Geometry scale multiplier" });
    slot.append(el("div", { class: "geometry-scale" },
      propertyField("Geometry multiplier", multiplier),
      el("button", { type: "button", class: "btn", onclick: () => scale(multiplier.valueAsNumber) }, "Scale geometry")),
    el("p", { class: "property-help" }, "Scales fixed dimensions and child positions only. Type, spacing, radii, and effects keep their tokens."));
  }

  window.addEventListener("DOMContentLoaded", () => {
    $("#inspect-zoom")?.addEventListener("change", (event) => {
      cancel(); adapter.cancelMove();
      zoom = Number(event.target.value);
      refresh();
    });
    $("#select-parent-btn").addEventListener("click", selectParent);
    $("#inspector-dock-btn").addEventListener("click", (event) => {
      const left = document.body.classList.toggle("properties-left");
      event.currentTarget.setAttribute("aria-pressed", String(left));
      event.currentTarget.textContent = left ? "Properties on right" : "Properties on left";
      adapter.docked?.();
      scheduleBounds();
    });
    for (const handle of document.querySelectorAll("[data-resize]")) {
      handle.addEventListener("pointerdown", beginResize);
      handle.addEventListener("lostpointercapture", () => finishResize(true));
    }
    window.addEventListener("pointermove", moveResize, true);
    window.addEventListener("pointerup", (event) => {
      if (resizing?.pointerId === event.pointerId) finishResize();
    }, true);
    window.addEventListener("pointercancel", (event) => {
      if (resizing?.pointerId === event.pointerId) finishResize(true);
    }, true);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
    window.addEventListener("resize", scheduleBounds);
    document.addEventListener("scroll", () => { clearDrop(); scheduleBounds(); }, true);
    new ResizeObserver(scheduleBounds).observe(adapter.preview());
    adapter.preview().addEventListener("pointerover", (event) => {
      if (!adapter.enabled() || resizing || adapter.moving()) return;
      hovered = event.target.closest?.(adapter.nodeSelector);
      refreshBounds();
    });
    adapter.preview().addEventListener("pointerleave", () => hoverPath(null));
    adapter.preview().addEventListener("dragover", (event) => {
      if (!adapter.enabled() || (!adapter.dragPath() && !paletteDrag)) return;
      event.preventDefault();
      clearDrop();
      try {
        showDrop(dropDestination(event));
        event.dataTransfer.dropEffect = paletteDrag ? "copy" : "move";
      } catch (error) {
        event.dataTransfer.dropEffect = "none";
        announce(error.message);
      }
    });
    adapter.preview().addEventListener("dragleave", (event) => {
      if (!adapter.preview().contains(event.relatedTarget)) clearDrop();
    });
    adapter.preview().addEventListener("drop", (event) => {
      if (!adapter.enabled() || (!adapter.dragPath() && !paletteDrag)) return;
      event.preventDefault();
      try {
        const destination = dropDestination(event);
        if (paletteDrag) insert(paletteDrag, destination);
        else {
          const source = adapter.dragPath().slice();
          adapter.commit(() => {
            adapter.prepare(adapter.doc());
            const path = adapter.move(adapter.doc(), source, destination.path, destination.placement);
            positionAtDrop(adapter.doc(), path, destination);
            return path;
          });
        }
      } catch (error) { report(error); }
      paletteDrag = null;
      adapter.setDragPath(null);
      clearDrop();
    });
    document.addEventListener("dragend", () => { paletteDrag = null; adapter.setDragPath(null); adapter.clearTreeDrop(); });
    document.addEventListener("keydown", (event) => {
      if (!adapter.enabled()) return;
      if (event.key === "Escape" && (resizing || adapter.moving() || paletteDrag || adapter.dragPath())) {
        event.preventDefault();
        cancel(); adapter.cancelMove(); adapter.clearTreeDrop(); refreshBounds();
        announce("Gesture cancelled.");
        return;
      }
      if (event.target.closest("input, textarea, select, [contenteditable]") || resizing || adapter.moving()) return;
      if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); selectParent(); }
    });
  });
  return {
    refresh, refreshBounds, cancel, clearDrop, showTreeDrop, hoverPath, scale, announce, appendScaleControl,
    rememberSelection: (element) => { selectedElement = element; },
    busy: () => !!resizing,
  };
} };
