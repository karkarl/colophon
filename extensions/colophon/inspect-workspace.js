/* Direct manipulation uses the same validated graph/history as Properties. */
window.InspectWorkspace = (() => {
  let zoom = 1, paletteKey = "", paletteDrag = null, resizing = null, hovered = null, selectedElement = null;
  let frame = 0;
  const elementsFor = (path) => [...document.querySelectorAll("#app [data-ds-node-path]")]
    .filter((node) => node.dataset.dsNodePath === pathKey(path));
  const announce = (message) => {
    const slot = $("#inspect-announcement");
    if (slot && slot.textContent !== message) slot.textContent = message;
  };
  const report = (error) => { $("#inspect-error").textContent = error.message; announce(error.message); };
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
  const textLeaf = (node) => typeof node?.children === "string"
    || (Array.isArray(node?.children) && node.children.length > 0 && node.children.every((child) => typeof child === "string"));

  function refreshBounds() {
    const overlay = $("#inspect-overlays");
    if (!overlay) return;
    overlay.hidden = !state.inspectMode || state.page !== "components";
    const box = $("#inspect-selection-box");
    const element = state.selection?.file === "components.jsonc" && selectedComponentNode() ? locate(state.selection.path) : null;
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
    const color = (name) => colorList(state.tokens).some((token) => token.name === name) ? name : undefined;
    if (kind.startsWith("component:")) return { component: kind.slice(10) };
    if (kind === "frame") return {
      id: "frame", el: "div", layout: { mode: "freeform", width: 160, height: 96 },
      appearance: { background: color("surface"), borderColor: color("line"), borderWidth: 1 }, children: [],
    };
    if (kind === "rectangle") return {
      id: "rectangle", el: "div", layout: { width: 96, height: 64 },
      appearance: { background: color("line") },
    };
    if (kind === "text") return {
      id: "text", el: "p", layout: { width: "hug" },
      appearance: {
        color: color("ink"),
        ...(state.tokens?.typography?.scale?.some((style) => style.name === "body") ? { textStyle: "body" } : {}),
      }, children: ["Text"],
    };
    throw new Error("Unknown insert tool.");
  }

  function selectedDestination() {
    if (!selectedComponentNode()) throw new Error("Select a component layer before inserting.");
    const path = state.selection.path.slice();
    const node = selectedComponentNode();
    return { path, placement: window.DSComp.canContainComponentChildren(node) && !textLeaf(node) ? "inside" : "after" };
  }

  function insert(kind, destination = null) {
    try {
      destination ||= selectedDestination();
      const node = template(kind);
      return commitComponentMutation(() => {
        ensureComponentSchemaV3();
        const path = window.DSComp.insertComponentNode(state.componentsDoc, destination.path, node, destination.placement);
        positionAtDrop(state.componentsDoc, path, destination);
        return path;
      });
    } catch (error) { report(error); }
  }

  function renderPalette() {
    const names = availableComponentNames();
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
          state.dragPath = null;
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("text/plain", label);
        },
        ondragend: () => { paletteDrag = null; clearDrop(); },
      }, label);
      items.append(button);
    }
  }

  function refresh() {
    document.body.classList.toggle("inspect-components", state.inspectMode && state.page === "components");
    for (const surface of document.querySelectorAll("#app .ds-preview-surface")) surface.style.zoom = state.inspectMode ? String(zoom) : "";
    if (state.inspectMode) renderPalette();
    const parentButton = $("#select-parent-btn");
    if (parentButton) parentButton.disabled = !selectedComponentNode() || state.selection.path.at(-2) !== "children";
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
    const node = valueAtPath(state.componentsDoc, destination.path);
    const label = `${placement[0].toUpperCase() + placement.slice(1)} ${componentLayerLabel(node).detail}`;
    $("#inspect-drop-label").textContent = label;
    announce(label);
  }

  function showTreeDrop(path, placement) {
    const parent = valueAtPath(state.componentsDoc, path.slice(0, -2));
    showDrop({ path, placement, element: locate(path), axis: parent?.layout?.mode === "horizontal" ? "x" : "y" });
  }

  function positionAtDrop(doc, path, destination) {
    const node = valueAtPath(doc, path);
    const parent = valueAtPath(doc, path.slice(0, -2));
    if (parent.layout?.mode !== "freeform") { delete node.position; return; }
    if (destination.point) node.position = { mode: "absolute", ...destination.point };
    else node.position ||= { mode: "absolute", x: 0, y: 0 };
  }

  function dropDestination(event) {
    const element = event.target.closest?.("[data-ds-node-path]");
    const path = renderedNodePath(element);
    if (!path) throw new Error("Drop on a component layer.");
    const node = valueAtPath(state.componentsDoc, path);
    const parent = valueAtPath(state.componentsDoc, path.slice(0, -2));
    const axis = parent?.layout?.mode === "horizontal" ? "x" : "y";
    const rect = element.getBoundingClientRect();
    const ratio = axis === "x" ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
    const root = path.at(-2) !== "children";
    const inside = window.DSComp.canContainComponentChildren(node) && !textLeaf(node) && (root || (ratio >= .28 && ratio <= .72));
    const placement = inside ? "inside" : ratio < .5 ? "before" : "after";
    const { parentPath, parent: destinationParent } = window.DSComp.componentDropDestination(state.componentsDoc, path, placement, state.dragPath);
    const destination = { path, placement, element, axis };
    if (destinationParent.layout?.mode === "freeform") {
      let parentElement = element;
      while (parentElement && parentElement.dataset.dsNodePath !== pathKey(parentPath)) parentElement = parentElement.parentElement;
      if (!parentElement) throw new Error("The freeform parent is not visible here.");
      const parentRect = parentElement.getBoundingClientRect();
      const size = bounds(parentElement);
      destination.point = {
        x: Math.round((event.clientX - parentRect.left) / size.scaleX - parentElement.clientLeft + parentElement.scrollLeft),
        y: Math.round((event.clientY - parentRect.top) / size.scaleY - parentElement.clientTop + parentElement.scrollTop),
      };
    }
    const candidate = clone(state.componentsDoc);
    candidate.meta ||= {};
    candidate.meta.version = Math.max(3, Number(candidate.meta.version) || 0);
    const nextPath = paletteDrag
      ? window.DSComp.insertComponentNode(candidate, path, template(paletteDrag), placement)
      : window.DSComp.moveComponentNode(candidate, state.dragPath, path, placement);
    positionAtDrop(candidate, nextPath, destination);
    const validation = window.DSComp.validateComponentsDoc(candidate, { tokens: state.tokens });
    if (!validation.ok) throw new Error(validation.errors.join(" "));
    return destination;
  }

  function beginResize(event) {
    if (event.button !== 0 || !state.inspectMode || state.freeformDrag || resizing) return;
    const element = locate(state.selection?.path);
    if (!resizeable(element)) return;
    event.preventDefault();
    const size = bounds(element);
    resizing = {
      pointerId: event.pointerId, handle: event.currentTarget, axes: event.currentTarget.dataset.resize,
      path: state.selection.path.slice(), x: event.clientX, y: event.clientY, size, next: {},
      originals: elementsFor(state.selection.path).map((node) => [node, node.style.cssText]),
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
    state.suppressInspectClickUntil = Date.now() + 500;
    if (!cancelled && Object.entries(gesture.next).some(([key, value]) => Math.abs(value - gesture.size[key]) > .01)) {
      commitComponentMutation(() => {
        ensureComponentSchemaV3();
        const node = valueAtPath(state.componentsDoc, gesture.path);
        node.layout = { ...node.layout, ...gesture.next };
      }).then((committed) => {
        if (committed) announce("Layer resized. Undo is available.");
      });
    }
    refreshBounds();
  }

  function cancel() {
    finishResize(true);
    paletteDrag = null;
    state.dragPath = null;
    hovered = null;
    clearDrop();
  }

  function scale(factor) {
    const node = selectedComponentNode();
    const element = node && locate(state.selection.path);
    if (!element || !resizeable(element)) { report(new Error("Select a visible, resizable layer.")); return; }
    return commitComponentMutation(() => {
      ensureComponentSchemaV3();
      window.DSComp.scaleComponentGeometry(node, factor, bounds(element));
    });
  }

  function selectParent() {
    if (state.selection?.file !== "components.jsonc" || state.selection.path.at(-2) !== "children") return;
    const path = state.selection.path.slice(0, -2);
    selectDesignPath("components.jsonc", path, componentLayerLabel(valueAtPath(state.componentsDoc, path)).detail);
  }

  window.addEventListener("DOMContentLoaded", () => {
    $("#inspect-zoom").addEventListener("change", (event) => {
      cancel(); cancelFreeformDrag();
      zoom = Number(event.target.value);
      refresh();
    });
    $("#select-parent-btn").addEventListener("click", selectParent);
    $("#inspector-dock-btn").addEventListener("click", (event) => {
      const left = document.body.classList.toggle("properties-left");
      event.currentTarget.setAttribute("aria-pressed", String(left));
      event.currentTarget.textContent = left ? "Properties on right" : "Properties on left";
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
    new ResizeObserver(scheduleBounds).observe($("#app"));
    $("#app").addEventListener("pointerover", (event) => {
      if (!state.inspectMode || resizing || state.freeformDrag) return;
      hovered = event.target.closest?.("[data-ds-node-path]");
      refreshBounds();
    });
    $("#app").addEventListener("pointerleave", () => hoverPath(null));
    $("#app").addEventListener("dragover", (event) => {
      if (!state.inspectMode || (!state.dragPath && !paletteDrag)) return;
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
    $("#app").addEventListener("dragleave", (event) => {
      if (!$("#app").contains(event.relatedTarget)) clearDrop();
    });
    $("#app").addEventListener("drop", (event) => {
      if (!state.inspectMode || (!state.dragPath && !paletteDrag)) return;
      event.preventDefault();
      try {
        const destination = dropDestination(event);
        if (paletteDrag) insert(paletteDrag, destination);
        else {
          const source = state.dragPath.slice();
          commitComponentMutation(() => {
            ensureComponentSchemaV3();
            const path = window.DSComp.moveComponentNode(state.componentsDoc, source, destination.path, destination.placement);
            positionAtDrop(state.componentsDoc, path, destination);
            return path;
          });
        }
      } catch (error) { report(error); }
      paletteDrag = null;
      state.dragPath = null;
      clearDrop();
    });
    document.addEventListener("dragend", () => { paletteDrag = null; state.dragPath = null; clearDropClasses(); });
    document.addEventListener("keydown", (event) => {
      if (!state.inspectMode) return;
      if (event.key === "Escape" && (resizing || state.freeformDrag || paletteDrag || state.dragPath)) {
        event.preventDefault();
        cancel(); cancelFreeformDrag(); clearDropClasses(); refreshBounds();
        announce("Gesture cancelled.");
        return;
      }
      if (event.target.closest("input, textarea, select, [contenteditable]") || resizing || state.freeformDrag) return;
      if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); selectParent(); }
    });
  });
  return {
    refresh, refreshBounds, cancel, clearDrop, showTreeDrop, hoverPath, scale, announce,
    rememberSelection: (element) => { selectedElement = element; },
    busy: () => !!resizing,
  };
})();
