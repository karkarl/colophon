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
  let activeTool = "move", shapeTool = "rectangle", drawing = null, preparing = null;
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
      for (const handle of box.querySelectorAll(".resize-handle")) handle.hidden = activeTool !== "move" || !resizeable(element);
    }
    const hover = $("#inspect-hover-box");
    hover.hidden = !hovered?.isConnected || !!resizing || !!drawing || overlay.hidden;
    if (!hover.hidden) placeBox(hover, hovered.getBoundingClientRect());
    const tools = $("#creation-toolbar-position");
    tools.hidden = overlay.hidden;
    if (!tools.hidden) {
      const viewport = overlay.getBoundingClientRect();
      Object.assign(tools.style, { left: `${viewport.left}px`, width: `${viewport.width}px`, bottom: `${Math.max(0, innerHeight - viewport.bottom)}px` });
    }
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

  function insert(kind, destination = null, geometry = null) {
    try {
      destination ||= selectedDestination();
      const node = template(kind);
      if (geometry) Object.assign(window.EditorGeometry.dimensions(node, adapter.schema), { width: geometry.width, height: geometry.height });
      if (geometry?.endpoints) node.endpoints = geometry.endpoints;
      return adapter.commit(() => {
        adapter.prepare(adapter.doc(), { kind, geometry: !!geometry });
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
    renderComponentItems($("#insert-items"), names);
    if (!$("#component-tools-menu").hidden) filterComponents();
  }

  function renderComponentItems(items, names) {
    items.replaceChildren();
    for (const [kind, label] of names.map((name) => [`component:${name}`, name])) {
      const button = el("button", {
        type: "button", draggable: String(items.id === "insert-items"), "data-insert-kind": kind, title: `Insert ${label}`,
        onclick: () => {
          const fromMenu = items.id === "component-search-results";
          setTool("move");
          insert(kind);
          if (fromMenu) $("#component-menu-btn").focus();
        },
        ondragstart: (event) => {
          setTool("move");
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

  function filterComponents() {
    const names = adapter.names();
    const search = $("#component-search").value.trim().toLocaleLowerCase();
    const matches = names.filter((name) => name.toLocaleLowerCase().includes(search));
    renderComponentItems($("#component-search-results"), matches);
    $("#component-search-status").textContent = matches.length ? `${matches.length} component${matches.length === 1 ? "" : "s"}`
      : names.length ? "No matching components." : "This design system has no components.";
  }

  function refresh() {
    adapter.refresh(zoom);
    if (adapter.enabled()) renderPalette();
    else if (activeTool !== "move") cancel();
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

  function dropDestination(event, kind = paletteDrag) {
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
    const { parentPath, parent: destinationParent } = adapter.destination(adapter.doc(), path, placement, kind ? null : adapter.dragPath());
    let parentElement = element;
    while (parentElement && pathKey(adapter.nodePath(parentElement)) !== pathKey(parentPath)) parentElement = parentElement.parentElement;
    if (!parentElement) throw new Error("The destination parent is not visible here.");
    const destination = { path, placement, element, axis, parentElement };
    if (adapter.layout(destinationParent) === "freeform") destination.point = documentPoint(event, parentElement);
    const candidate = clone(adapter.doc());
    adapter.prepare(candidate, { kind });
    const nextPath = kind
      ? adapter.insert(candidate, path, template(kind), placement)
      : adapter.move(candidate, adapter.dragPath(), path, placement);
    positionAtDrop(candidate, nextPath, destination);
    adapter.validate(candidate);
    return destination;
  }

  function documentPoint(event, parent) {
    const rect = parent.getBoundingClientRect(), size = bounds(parent);
    return {
      x: Math.round((event.clientX - rect.left) / size.scaleX - parent.clientLeft + parent.scrollLeft),
      y: Math.round((event.clientY - rect.top) / size.scaleY - parent.clientTop + parent.scrollTop),
    };
  }

  function closeShapeMenu(restoreFocus = false) {
    $("#shape-tools-menu").hidden = true;
    $("#shape-menu-btn").setAttribute("aria-expanded", "false");
    if (restoreFocus) $("#shape-menu-btn").focus();
  }

  function closeComponentMenu(restoreFocus = false) {
    $("#component-tools-menu").hidden = true;
    $("#component-menu-btn").setAttribute("aria-expanded", "false");
    if (restoreFocus) $("#component-menu-btn").focus();
  }

  function renderToolState() {
    document.body.classList.toggle("inspect-creating", activeTool !== "move" && adapter.enabled());
    for (const button of $("#creation-toolbar").querySelectorAll("[data-tool]")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === activeTool));
    }
    for (const button of $("#shape-tools-menu").querySelectorAll("[data-shape]")) {
      button.setAttribute("aria-checked", String(button.dataset.shape === shapeTool));
    }
  }

  function setTool(kind) {
    cancel();
    adapter.cancelMove();
    activeTool = kind;
    if (window.ShapeGeometry.kinds.includes(kind)) {
      shapeTool = kind;
      const button = $("#shape-tool-btn");
      const choice = $(`#shape-tools-menu [data-shape="${kind}"]`);
      button.dataset.tool = kind;
      button.replaceChildren(choice.querySelector("svg").cloneNode(true));
      const label = choice.querySelector("span").textContent, shortcut = choice.querySelector("kbd").textContent.replace(" ", "+");
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-keyshortcuts", shortcut);
      button.title = `${label} (${shortcut})`;
    }
    renderToolState();
    refreshBounds();
    announce(kind === "move" ? "Move tool. Select or move a layer." : `${kind[0].toUpperCase() + kind.slice(1)} tool. Click or drag on a layer to create. Enter inserts into the selection; Escape cancels.`);
  }

  function preparePointer(event, start) {
    try {
      const ready = adapter.beforeGesture?.();
      if (!ready?.then) { if (ready !== false) start(); return; }
      const pending = { pointerId: event.pointerId, latest: null };
      preparing = pending;
      Promise.resolve(ready).then((committed) => {
        if (preparing !== pending) return;
        preparing = null;
        if (committed === false || !adapter.enabled()) return;
        start();
        if (pending.latest) { moveResize(pending.latest); moveDrawing(pending.latest); }
      }).catch((error) => {
        if (preparing === pending) preparing = null;
        finishDrawing(true); finishResize(true);
        report(error);
      });
    } catch (error) { finishDrawing(true); finishResize(true); report(error); }
  }

  function beginDrawing(event) {
    if (!adapter.enabled() || activeTool === "move" || event.button !== 0 || event.isPrimary === false || drawing || preparing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const kind = activeTool, target = event.target.closest?.(adapter.nodeSelector), path = target && adapter.nodePath(target);
    preparePointer(event, () => {
      const destination = dropDestination({ target: target?.isConnected ? target : path ? locate(path) : event.target,
        clientX: event.clientX, clientY: event.clientY }, kind);
      const parent = destination.parentElement;
      activeTool = kind;
      renderToolState();
      drawing = { kind, destination, parent, pointerId: event.pointerId,
        start: documentPoint(event, parent), screenX: event.clientX, screenY: event.clientY, geometry: null };
      adapter.preview().setPointerCapture(event.pointerId);
      showDrop(destination);
    });
  }

  function moveDrawing(event) {
    if (!drawing || event.pointerId !== drawing.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (Math.hypot(event.clientX - drawing.screenX, event.clientY - drawing.screenY) < 3 && !drawing.geometry) return;
    try {
      const linear = window.ShapeGeometry.linear({ shape: drawing.kind });
      const geometry = window.EditorGeometry.creationBounds(drawing.start, documentPoint(event, drawing.parent), event.shiftKey && drawing.kind !== "text", linear);
      drawing.geometry = geometry;
      const rect = drawing.parent.getBoundingClientRect(), size = bounds(drawing.parent);
      const left = rect.left + (geometry.x + drawing.parent.clientLeft - drawing.parent.scrollLeft) * size.scaleX;
      const top = rect.top + (geometry.y + drawing.parent.clientTop - drawing.parent.scrollTop) * size.scaleY;
      const width = geometry.width * size.scaleX, height = geometry.height * size.scaleY;
      const box = $("#inspect-create-box");
      box.dataset.creationShape = drawing.kind;
      box.querySelector("svg")?.remove();
      if (linear) {
        const svg = window.ShapeGeometry.createSvg({ shape: drawing.kind, ...geometry });
        svg.style.color = "var(--inspect-color)";
        box.append(svg);
      }
      placeBox(box, { left, top, width, height, right: left + width, bottom: top + height });
      $("#inspect-create-size").textContent = `${geometry.width} x ${geometry.height}`;
    } catch (error) { finishDrawing(true); report(error); }
  }

  async function finishDrawing(cancelled = false) {
    const gesture = drawing;
    if (!gesture) return;
    drawing = null;
    if (adapter.preview().hasPointerCapture(gesture.pointerId)) adapter.preview().releasePointerCapture(gesture.pointerId);
    $("#inspect-create-box").hidden = true;
    clearDrop();
    adapter.suppressClick();
    if (cancelled) return;
    const { destination, geometry, kind } = gesture;
    if (geometry && destination.point) destination.point = { x: geometry.x, y: geometry.y };
    const committed = await insert(kind, destination, geometry);
    if (committed) {
      setTool("move");
      announce("Layer created. Undo is available.");
      if (kind === "text") adapter.focusText?.();
    }
  }

  function beginResize(event) {
    if (event.button !== 0 || !adapter.enabled() || activeTool !== "move" || adapter.moving() || resizing || preparing) return;
    event.preventDefault();
    const handle = event.currentTarget;
    preparePointer(event, () => {
      const path = adapter.selection();
      if (!path) return;
      const element = locate(path);
      if (!resizeable(element)) return;
      const size = bounds(element);
      handle.setPointerCapture(event.pointerId);
      resizing = {
        pointerId: event.pointerId, handle, axes: handle.dataset.resize,
        path: path.slice(), x: event.clientX, y: event.clientY, size, next: {},
        originals: elementsFor(path).map((node) => [node, node.style.cssText]),
      };
      document.body.classList.add("inspect-resizing");
    });
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
        adapter.prepare(adapter.doc(), { geometry: true });
        const node = adapter.value(adapter.doc(), gesture.path);
        Object.assign(window.EditorGeometry.dimensions(node, adapter.schema), gesture.next);
      })).then((committed) => {
        if (committed) announce("Layer resized. Undo is available.");
      });
    }
    refreshBounds();
  }

  function cancel() {
    preparing = null;
    finishDrawing(true);
    finishResize(true);
    paletteDrag = null;
    adapter.setDragPath(null);
    hovered = null;
    clearDrop();
    activeTool = "move";
    closeShapeMenu();
    closeComponentMenu();
    renderToolState();
  }

  async function scale(factor) {
    const ready = adapter.beforeGesture?.();
    if ((ready?.then ? await ready : ready) === false) return;
    const path = adapter.selection();
    const node = path && adapter.value(adapter.doc(), path);
    const element = node && locate(path);
    if (!element || !resizeable(element)) { report(new Error("Select a visible, resizable layer.")); return; }
    return adapter.commit(() => {
      adapter.prepare(adapter.doc(), { geometry: true });
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
    const controls = [...$("#creation-toolbar").querySelectorAll("[data-toolbar-control]")];
    const focusControl = (button) => {
      for (const control of controls) control.tabIndex = control === button ? 0 : -1;
      button.focus();
    };
    for (const button of controls) {
      button.addEventListener("focus", () => { for (const control of controls) control.tabIndex = control === button ? 0 : -1; });
      if (button.dataset.tool) button.addEventListener("click", () => setTool(button.dataset.tool));
    }
    $("#creation-toolbar").addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = controls.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + controls.length) % controls.length;
      focusControl(controls[next]);
    });
    $("#shape-menu-btn").addEventListener("click", () => {
      if (!$("#shape-tools-menu").hidden) { closeShapeMenu(); return; }
      closeComponentMenu();
      $("#shape-tools-menu").hidden = false;
      $("#shape-menu-btn").setAttribute("aria-expanded", "true");
      $(`#shape-tools-menu [data-shape="${shapeTool}"]`).focus();
    });
    $("#shape-tools-menu").addEventListener("keydown", (event) => {
      const choices = [...$("#shape-tools-menu").querySelectorAll("[data-shape]")];
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeShapeMenu(true); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const index = choices.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
        choices[next].focus();
      } else if (event.key === "Tab") closeShapeMenu(true);
    });
    for (const choice of $("#shape-tools-menu").querySelectorAll("[data-shape]")) choice.addEventListener("click", () => {
      setTool(choice.dataset.shape);
      focusControl($("#shape-tool-btn"));
    });
    $("#component-menu-btn").addEventListener("click", () => {
      if (!$("#component-tools-menu").hidden) { closeComponentMenu(); return; }
      setTool("move");
      $("#component-tools-menu").hidden = false;
      $("#component-menu-btn").setAttribute("aria-expanded", "true");
      $("#component-search").value = "";
      filterComponents();
      $("#component-search").focus();
    });
    $("#component-search").addEventListener("input", filterComponents);
    $("#component-tools-menu").addEventListener("keydown", (event) => {
      const buttons = [...$("#component-search-results").querySelectorAll("button")];
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeComponentMenu(true); }
      else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const index = buttons.indexOf(document.activeElement);
        const next = index + (event.key === "ArrowDown" ? 1 : -1);
        if (index < 0 && event.key === "ArrowUp") buttons.at(-1)?.focus();
        else if (next < 0 || next >= buttons.length) $("#component-search").focus();
        else buttons[next].focus();
      } else if (event.key === "Enter" && event.target === $("#component-search")) {
        event.preventDefault(); event.stopPropagation(); buttons[0]?.click();
      }
    });
    $("#component-tools-menu").addEventListener("focusout", () => queueMicrotask(() => {
      if (!$("#component-tools-menu").contains(document.activeElement)) closeComponentMenu();
    }));
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest?.("#creation-toolbar-position")) { closeShapeMenu(); closeComponentMenu(); }
    });
    adapter.preview().addEventListener("pointerdown", beginDrawing, true);
    adapter.preview().addEventListener("lostpointercapture", (event) => { if (drawing?.pointerId === event.pointerId) cancel(); });
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
    window.addEventListener("pointermove", (event) => {
      if (preparing?.pointerId === event.pointerId) { preparing.latest = event; event.preventDefault(); }
    }, true);
    window.addEventListener("pointermove", moveResize, true);
    window.addEventListener("pointermove", moveDrawing, true);
    window.addEventListener("pointerup", (event) => {
      if (preparing?.pointerId === event.pointerId) preparing = null;
      if (drawing?.pointerId === event.pointerId) { moveDrawing(event); finishDrawing(); }
      if (resizing?.pointerId === event.pointerId) finishResize();
    }, true);
    window.addEventListener("pointercancel", (event) => {
      if (preparing?.pointerId === event.pointerId) preparing = null;
      if (drawing?.pointerId === event.pointerId) cancel();
      if (resizing?.pointerId === event.pointerId) finishResize(true);
    }, true);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
    window.addEventListener("resize", scheduleBounds);
    document.addEventListener("scroll", () => { if (drawing) cancel(); clearDrop(); scheduleBounds(); }, true);
    new ResizeObserver(scheduleBounds).observe(adapter.preview());
    adapter.preview().addEventListener("pointerover", (event) => {
      if (!adapter.enabled() || resizing || drawing || preparing || adapter.moving()) return;
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
      if (event.key === "Escape" && (activeTool !== "move" || resizing || preparing || adapter.moving() || paletteDrag || adapter.dragPath())) {
        event.preventDefault();
        cancel(); adapter.cancelMove(); adapter.clearTreeDrop(); refreshBounds();
        announce("Gesture cancelled.");
        return;
      }
      if (event.target.closest?.("input, textarea, select, [contenteditable], [role=menu], #component-tools-menu") || resizing || drawing || preparing || adapter.moving() || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); selectParent(); }
      else if (event.key === "Enter" && activeTool !== "move" && (!event.target.closest?.("button, a") || event.target.dataset.tool === activeTool)) {
        event.preventDefault();
        const kind = activeTool;
        Promise.resolve(insert(kind)).then((committed) => {
          if (committed) { setTool("move"); if (kind === "text") adapter.focusText?.(); }
        });
      } else if (!event.repeat) {
        const kind = { v: "move", f: "frame", r: "rectangle", o: "ellipse", l: event.shiftKey ? "arrow" : "line", t: "text" }[event.key.toLowerCase()];
        if (kind) { event.preventDefault(); setTool(kind); }
      }
    });
  });
  return {
    refresh, refreshBounds, cancel, clearDrop, showTreeDrop, hoverPath, scale, announce, appendScaleControl,
    rememberSelection: (element) => { selectedElement = element; },
    wantsCreate: () => activeTool !== "move",
    busy: () => !!resizing || !!drawing || !!preparing,
  };
} };
