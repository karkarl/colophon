// Shared by the headless suite and an interactive browser when diagnosing failures.
export async function inspectWorkspaceBehavior() {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (predicate, message) => {
    for (let count = 0; count < 200; count++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(message);
  };
  const query = (selector) => document.querySelector(selector);
  const ds = (id) => query(`[data-ds-node-id="${id}"]`);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  await wait(() => query(".page-nav-link"), "design did not load");
  query("#inspect-btn").click();
  await wait(() => ds("inspect-board"), "Inspect did not render");
  const index = state.componentsDoc.components.findIndex((component) => component.name === "InspectFixture");
  const pathFor = (id) => window.DSComp.findComponentNodePath(state.componentsDoc, index, id);
  const choose = (id) => {
    const row = [...document.querySelectorAll("[data-component-layer-path]")].find((node) => node.dataset.componentLayerPath === JSON.stringify(pathFor(id)));
    row.querySelector("button").click();
    ds(id)?.scrollIntoView({ block: "center" });
    window.InspectWorkspace.refreshBounds();
  };
  const node = () => selectedComponentNode();
  choose("inspect-board");
  const original = JSON.stringify(state.componentsDoc);
  query("#inspector-dock-btn").click();
  check(document.body.classList.contains("properties-left"), "properties dock left");
  if (innerWidth > 896) check(query("#design-inspector").getBoundingClientRect().left === 0, "left properties geometry");
  else check(query("#component-layers").getBoundingClientRect().bottom <= query("#design-inspector").getBoundingClientRect().top + 1, "narrow panels stack without overlap");
  query("#inspector-dock-btn").click();
  check(JSON.stringify(state.componentsDoc) === original && !state.componentsDirty, "docking does not dirty the graph");
  query("#insert-palette").open = true;
  const add = async (kind) => {
    const count = state.componentPast.length;
    query(`[data-insert-kind="${kind}"]`).click();
    await tick();
    check(state.componentPast.length === count + 1, `${kind} adds one undo step: ${query("#inspect-error").textContent}`);
  };
  await add("frame");
  check(node().el === "div" && node().layout.mode === "freeform", "frame inserted");
  const frameId = node().id;
  await add("rectangle");
  check(node().layout.width === 96 && node().position.mode === "absolute", "rectangle inserted in freeform parent");
  choose(frameId);
  await add("text");
  const textId = node().id;
  const content = query('[aria-label="Text content"]');
  content.value = "A field note";
  content.dispatchEvent(new Event("change"));
  await tick();
  check(node().children[0] === "A field note", "literal text editable");
  await add("rectangle");
  check(pathFor(textId).slice(0, -1).join() === state.selection.path.slice(0, -1).join(), "click insert next to a text leaf, not inside it");
  const snap = query(".snap-toggle");
  snap.click();
  await tick();
  check(query(".snap-toggle").textContent === "Free" && !state.spacingSnap, "no-op graph change still refreshes snap controls");
  choose("inspect-board");
  await add("component:Card");
  check(node().component === "Card", "component inserted as reference");
  choose("inspect-board");
  const beforeCycle = JSON.stringify(state.componentsDoc);
  query('[data-insert-kind="component:InspectFixture"]').click();
  await tick();
  check(query("#inspect-error").textContent.includes("recursive"), "recursive insert reports error");
  check(JSON.stringify(state.componentsDoc) === beforeCycle, "recursive insert rolls back");

  // Synthetic pointer events do not establish browser pointer capture.
  const resize = async (zoom, axes = "se", cancel = false, shiftKey = false) => {
    choose(frameId);
    query("#inspect-zoom").value = String(zoom);
    query("#inspect-zoom").dispatchEvent(new Event("change"));
    const handle = query(`[data-resize="${axes}"]`);
    handle.setPointerCapture = () => {};
    const rect = ds(frameId).getBoundingClientRect();
    const before = structuredClone(node());
    const history = state.componentPast.length;
    const fire = (target, type, options = {}) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 9, button: 0, clientX: rect.right, clientY: rect.bottom, ...options,
    }));
    fire(handle, "pointerdown");
    fire(window, "pointermove", { clientX: rect.right + 20 * zoom, clientY: rect.bottom + 10 * zoom, shiftKey });
    check(JSON.stringify(node()) === JSON.stringify(before), "resize preview does not mutate draft");
    if (cancel === "blur") window.dispatchEvent(new Event("blur"));
    else if (cancel === "pointercancel") fire(window, "pointercancel");
    else if (cancel === "capture") handle.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 9 }));
    else if (cancel) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    else fire(window, "pointerup");
    await tick();
    if (cancel) {
      check(JSON.stringify(node()) === JSON.stringify(before) && state.componentPast.length === history, "Escape restores resize with no history");
    } else {
      check(state.componentPast.length === history + 1, "one resize gesture is one history entry");
      if (axes.includes("e")) check(Math.abs(node().layout.width - before.layout.width - 20) < .1, `width delta at ${zoom} zoom`);
      if (axes.includes("s") && !shiftKey) check(Math.abs(node().layout.height - before.layout.height - 10) < .1, `height delta at ${zoom} zoom`);
      if (axes === "e") check(node().layout.height === before.layout.height, "width-only resize preserves height");
      if (shiftKey) check(Math.abs(node().layout.width / node().layout.height - before.layout.width / before.layout.height) < .001, "Shift preserves ratio");
      check(JSON.stringify(node().children) === JSON.stringify(before.children), "resize preserves child geometry and typography");
      query("#layers-undo-btn").click();
      await tick();
      check(JSON.stringify(node()) === JSON.stringify(before), "resize undo restores exact node");
      query("#layers-redo-btn").click();
      await tick();
      check(node().layout.width !== before.layout.width, "resize redo restores dimensions");
    }
  };
  for (const zoom of [.5, 1, 2]) await resize(zoom);
  await resize(1, "e");
  await resize(1, "se", true);
  for (const cancellation of ["blur", "pointercancel", "capture"]) await resize(1, "se", cancellation);
  await resize(1, "se", false, true);
  const beforeScale = structuredClone(node());
  query('[aria-label="Geometry scale multiplier"]').value = "2";
  [...document.querySelectorAll(".geometry-scale button")][0].click();
  await tick();
  check(node().layout.width === beforeScale.layout.width * 2, "scale geometry applies multiplier");
  check(JSON.stringify(node().appearance) === JSON.stringify(beforeScale.appearance), "scale preserves appearance tokens");
  query('[aria-label="Geometry scale multiplier"]').value = "0";
  [...document.querySelectorAll(".geometry-scale button")][0].click();
  await tick();
  check(query("#inspect-error").textContent.includes("multiplier"), "invalid multiplier reports error");

  choose("inspect-board");
  const sourcePath = pathFor(textId);
  const sourceRow = [...document.querySelectorAll("[data-component-layer-path]")].find((row) => row.dataset.componentLayerPath === JSON.stringify(sourcePath));
  const transfer = new DataTransfer();
  sourceRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  const target = ds("inspect-flow");
  const rect = target.getBoundingClientRect();
  const drag = (type, targetNode = target, extra = {}) => targetNode.dispatchEvent(new DragEvent(type, {
    bubbles: true, cancelable: true, dataTransfer: transfer,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, ...extra,
  }));
  drag("dragover");
  check(!query("#inspect-drop-box").hidden && query("#inspect-drop-label").textContent === "Inside inspect-flow", "canvas shows valid containment destination");
  const beforeInvalidDrop = JSON.stringify(state.componentsDoc);
  drag("dragover", ds("card-root"));
  check(query("#inspect-drop-box").hidden, "cross-definition target clears valid-drop preview");
  drag("drop", ds("card-root"));
  await tick();
  check(JSON.stringify(state.componentsDoc) === beforeInvalidDrop && query("#inspect-error").textContent.includes("same component"), "invalid canvas drop reports error without changing graph");
  sourceRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  drag("dragover");
  drag("drop");
  await tick();
  check(node().id === textId && !node().position, "freeform-to-flow reparent preserves ID and removes absolute position");
  check(state.selection.path.slice(0, -2).join() === pathFor("inspect-flow").join(), "layer moved into intended parent");

  const palette = query('[data-insert-kind="rectangle"]');
  palette.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  const board = ds("inspect-board");
  const boardRect = board.getBoundingClientRect();
  drag("dragover", board, { clientX: boardRect.left + 40, clientY: boardRect.top + 50 });
  check(!query("#inspect-drop-box").hidden, "palette drop preview");
  drag("drop", board, { clientX: boardRect.left + 40, clientY: boardRect.top + 50 });
  await tick();
  check(node().position.x === 40 && node().position.y === 50, "palette drop converts coordinates to parent space");
  const history = state.componentPast.length;
  palette.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  drag("drop", board);
  check(state.componentPast.length === history && query("#inspect-drop-box").hidden, "cancelled palette drag cannot commit");

  choose(textId);
  query("#select-parent-btn").click();
  check(node().id === "inspect-flow", "parent navigation follows reparented graph");
  for (const theme of ["dark", "highContrast", "light"]) {
    query(`[data-theme="${theme}"]`).click();
    await tick();
    choose(frameId);
    check(!query("#inspect-selection-box").hidden, `selection available in ${theme}`);
    check(getComputedStyle(query("#inspect-selection-box")).borderTopColor !== "rgba(0, 0, 0, 0)", `visible geometry cue in ${theme}`);
  }
  const repeatedTitle = [...document.querySelectorAll('[data-ds-node-id="card-title"]')].at(-1);
  repeatedTitle.scrollIntoView({ block: "center" });
  state.suppressInspectClickUntil = 0;
  repeatedTitle.click();
  const actualBounds = repeatedTitle.getBoundingClientRect();
  const selectionBounds = query("#inspect-selection-box").getBoundingClientRect();
  check(Math.abs(actualBounds.left - selectionBounds.left) < 1 && Math.abs(actualBounds.top - selectionBounds.top) < 1,
    "selection bounds follow the clicked instance, not the first shared definition preview");
  const savedDoc = JSON.stringify(state.componentsDoc);
  query("#save-btn").click();
  await wait(() => !state.componentsDirty, "save did not complete");
  query("#reload-btn").click();
  await wait(() => !state.selection, "reload did not clear selection");
  check(JSON.stringify(state.componentsDoc) === savedDoc, "all completed edits survive save and reload");
  query("#inspect-btn").click();
  check(query("#inspect-overlays").hidden, "leaving Inspect hides editing overlays");
  check(window.DSComp.validateComponentsDoc(state.componentsDoc, { tokens: state.tokens }).ok, "saved graph validates");
  return "PASS";
}
