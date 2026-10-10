export async function prototypeWorkspaceBehavior() {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const q = (selector) => document.querySelector(selector);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
  const runtimeErrors = [];
  const onError = (event) => runtimeErrors.push(event.message);
  window.addEventListener("error", onError);
  if (!state.inspectMode) q("#inspect-btn").click();
  const byId = (id) => q(`[data-proto-node-id="${id}"]`);
  const selected = () => valueAtPath(state.proto.doc, state.selectedPath);
  const choose = (id) => {
    state.suppressInspectClickUntil = 0;
    byId(id).click();
    byId(id).scrollIntoView({ block: "center" });
    window.PrototypeWorkspace.refreshBounds();
  };
  choose("board");
  const original = JSON.stringify(state.proto.doc), components = JSON.stringify(state.design.componentsDoc);
  q("#inspector-dock-btn").click();
  if (innerWidth > 896) check(q("#inspector").getBoundingClientRect().left === 0, "properties dock left");
  else check(q("#layers-panel").getBoundingClientRect().bottom <= q("#inspector").getBoundingClientRect().top + 1, "narrow editor rails stack");
  q("#inspector-dock-btn").click();
  check(JSON.stringify(state.proto.doc) === original && !state.dirty, "docking is view-only");
  const { creationToolbarBehavior } = await import("/creation-toolbar-scenario.mjs");
  await creationToolbarBehavior({ schema: "prototype", choose, node: selected, doc: () => state.proto.doc,
    history: () => state.past.length, byId, boardId: "board", flowId: "flow",
    zoomSelector: "#zoom-select", previewSelector: "#frame-wrap", errorSelector: "#editor-error" });
  q("#insert-palette").open = true;
  const add = (kind) => {
    const history = state.past.length;
    if (kind.startsWith("component:")) q(`[data-insert-kind="${kind}"]`).click();
    else {
      document.activeElement?.blur();
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: { frame: "f", rectangle: "r", text: "t" }[kind], bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
    check(state.past.length === history + 1, `insert ${kind} in one transaction: ${q("#editor-error").textContent}`);
  };
  add("frame");
  const frameId = selected().id;
  add("rectangle");
  check(selected().width === 96 && selected().position.mode === "absolute", "rectangle geometry in freeform parent");
  choose(frameId);
  add("text");
  const textId = selected().id;
  const content = q("#proto-properties textarea");
  content.value = "Prototype field note";
  content.dispatchEvent(new Event("input"));
  content.dispatchEvent(new Event("change"));
  check(selected().text === "Prototype field note", "literal text editing");
  add("component:Button");
  check(valueAtPath(state.proto.doc, state.selectedPath.slice(0, -2)).id === frameId, "inserted instance is a text sibling, not its child");
  check(selected().component === "Button" && selected().position, "component instance inserted beside text");
  const resize = async (zoom, cancellation = null, axes = "se", shiftKey = false) => {
    choose(frameId);
    q("#zoom-select").value = String(zoom);
    q("#zoom-select").dispatchEvent(new Event("change"));
    const handle = q(`[data-resize="${axes}"]`);
    handle.setPointerCapture = () => {};
    const rect = byId(frameId).getBoundingClientRect(), before = JSON.stringify(selected()), history = state.past.length;
    const width = selected().width, height = selected().height;
    const fire = (target, type, x = rect.right, y = rect.bottom) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 19, button: 0, clientX: x, clientY: y, shiftKey,
    }));
    fire(handle, "pointerdown");
    fire(window, "pointermove", rect.right + 20 * zoom, rect.bottom + 10 * zoom);
    check(JSON.stringify(selected()) === before, "resize preview leaves draft untouched");
    if (cancellation === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else if (cancellation === "blur") window.dispatchEvent(new Event("blur"));
    else if (cancellation === "capture") fire(handle, "lostpointercapture");
    else fire(window, cancellation === "cancel" ? "pointercancel" : "pointerup");
    await tick();
    const resizedPath = JSON.stringify(state.selectedPath);
    byId("card").click();
    check(JSON.stringify(state.selectedPath) === resizedPath, "post-gesture click is suppressed");
    if (cancellation) check(JSON.stringify(selected()) === before && state.past.length === history, "cancelled resize restores dimensions and history");
    else {
      check(state.past.length === history + 1 && Math.abs(selected().width - width - 20) < .1, `resize document width at ${zoom}`);
      if (axes === "e") check(selected().height === height, "width handle preserves height");
      else if (shiftKey) check(Math.abs(selected().width / selected().height - width / height) < .001, "Shift ratio preserved");
      else check(Math.abs(selected().height - height - 10) < .1, "height resize");
      q("#layers-undo-btn").click();
      check(JSON.stringify(selected()) === before, "resize undo");
      q("#layers-redo-btn").click();
      check(selected().width !== width, "resize redo");
    }
  };
  for (const zoom of [.5, 1, 2]) await resize(zoom);
  await resize(1, null, "e");
  await resize(1, null, "se", true);
  for (const cancel of ["escape", "blur", "capture", "cancel"]) await resize(1, cancel);
  const beforeScale = structuredClone(selected());
  q('[aria-label="Geometry scale multiplier"]').value = "2";
  q(".geometry-scale button").click();
  check(selected().width === beforeScale.width * 2, "scale geometry");
  check(JSON.stringify(selected().appearance) === JSON.stringify(beforeScale.appearance), "scale preserves appearance");
  const beforeInvalid = JSON.stringify(state.proto.doc);
  q('[aria-label="Geometry scale multiplier"]').value = "0";
  q(".geometry-scale button").click();
  check(JSON.stringify(state.proto.doc) === beforeInvalid && q("#editor-error").textContent.includes("multiplier"), "invalid scaling rolls back visibly");

  const transfer = new DataTransfer();
  const drag = (type, node, ratio = .5) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: rect.left + rect.width * ratio, clientY: rect.top + rect.height * ratio }));
  };
  choose(textId);
  const source = q('.layer-row.is-selected');
  source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  drag("dragover", byId("flow"));
  check(!q("#inspect-drop-box").hidden && q("#inspect-drop-label").textContent === "Inside flow", "tree-to-preview containment feedback");
  drag("drop", byId("flow"));
  check(selected().id === textId && !selected().position, "flow reparent removes absolute geometry");
  q("#select-parent-btn").click();
  check(selected().id === "flow", "parent navigation");
  const palette = q('[data-insert-kind="component:Button"]');
  palette.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  drag("dragover", byId(textId), .9);
  check(q("#inspect-drop-label").textContent === `After ${textId}` && q("#inspect-drop-box").dataset.axis === "y", "text leaf shows sibling insertion line");
  drag("drop", byId(textId), .9);
  check(selected().id !== textId && !selected().position, "palette sibling drop");
  for (const zoom of [.5, 1, 2]) {
    q("#zoom-select").value = String(zoom);
    q("#zoom-select").dispatchEvent(new Event("change"));
    const board = byId("board");
    board.scrollIntoView({ block: "center" });
    const rect = board.getBoundingClientRect();
    palette.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    const options = { bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: rect.left + 40 * zoom, clientY: rect.top + 50 * zoom };
    const over = new DragEvent("dragover", options);
    const expected = {
      x: Math.round((over.clientX - rect.left) / zoom - board.clientLeft + board.scrollLeft),
      y: Math.round((over.clientY - rect.top) / zoom - board.clientTop + board.scrollTop),
    };
    board.dispatchEvent(over);
    check(!q("#inspect-drop-box").hidden, `valid palette preview at ${zoom}`);
    board.dispatchEvent(new DragEvent("drop", options));
    check(selected().position.x === expected.x && selected().position.y === expected.y, `palette drop document coordinates at ${zoom}`);
  }
  const beforeCancel = JSON.stringify(state.proto.doc);
  palette.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  drag("drop", byId("board"));
  check(JSON.stringify(state.proto.doc) === beforeCancel && q("#inspect-drop-box").hidden, "Escape cancels pending palette drop");
  choose(frameId);
  q(".layer-row.is-selected").dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  drag("dragover", byId(frameId));
  check(q("#inspect-drop-box").hidden, "cyclic drop has no valid cue");
  drag("drop", byId(frameId));
  check(JSON.stringify(state.proto.doc) === beforeCancel && q("#editor-error").textContent.includes("itself"), "cyclic drop rejected without mutation");
  for (const theme of ["dark", "highContrast", "light"]) {
    q(`[data-theme="${theme}"]`).click();
    choose(frameId);
    check(!q("#inspect-selection-box").hidden, `selection remains visible in ${theme}`);
  }
  check(JSON.stringify(state.design.componentsDoc) === components, "prototype editing never mutates component definitions");
  const saved = JSON.stringify(state.proto.doc);
  await savePrototype();
  check(!state.dirty, "prototype saved");
  await load();
  check(JSON.stringify(state.proto.doc) === saved, "created/resized/reparented layers persist after reload");
  q("#inspect-btn").click();
  check(q("#inspect-overlays").hidden && q(".prototype-layout").contains(q(".screen-nav")), "live preview restores Screens and hides editor cues");
  byId("card").click();
  check(state.runtime.currentId === "second", "prototype navigation still works after editing");
  window.removeEventListener("error", onError);
  check(runtimeErrors.length === 0, `no runtime errors: ${runtimeErrors.join("; ")}`);
  return "PASS";
}
