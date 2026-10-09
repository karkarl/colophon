// Shared behavioral coverage runs against both document adapters.
export async function creationToolbarBehavior({ schema, choose, node, doc, history, byId, boardId, flowId, zoomSelector, previewSelector, errorSelector }) {
  const q = (selector) => document.querySelector(selector);
  const check = (value, message) => { if (!value) throw new Error(`${schema} toolbar: ${message}`); };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
  const key = (value, target = document.body, extra = {}) => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra }));
  const size = () => schema === "component" ? node().layout : node();
  const activate = (kind) => {
    if (["ellipse", "rectangle", "line", "arrow"].includes(kind)) {
      q("#shape-menu-btn").click();
      q(`[data-shape="${kind}"]`).click();
    } else q(`[data-tool="${kind}"]`).click();
  };
  const checkPosition = () => {
    const toolbar = q("#creation-toolbar").getBoundingClientRect(), viewport = q("#inspect-overlays").getBoundingClientRect();
    check(!q("#creation-toolbar-position").hidden, "visible during Inspect");
    check(Math.abs(toolbar.left + toolbar.width / 2 - viewport.left - viewport.width / 2) < 1, "centered in the canvas viewport");
    check(toolbar.left >= viewport.left && toolbar.right <= viewport.right && toolbar.bottom <= viewport.bottom, "does not overlap editor rails");
  };
  checkPosition();
  check(!q('[data-insert-kind="frame"]') && !q('[data-insert-kind="rectangle"]') && !q('[data-insert-kind="text"]'), "primitives removed from sidebar");
  const beforeTools = JSON.stringify(doc()), beforeHistory = history();
  q('[data-tool="move"]').focus();
  key("ArrowRight", document.activeElement);
  check(document.activeElement.dataset.tool === "frame", "roving toolbar focus");
  key("End", document.activeElement);
  check(document.activeElement.id === "component-menu-btn", "End moves to Add components");
  q("#shape-menu-btn").click();
  check(q("#shape-menu-btn").getAttribute("aria-expanded") === "true", "shape menu opens");
  key("ArrowDown", document.activeElement);
  check(document.activeElement.dataset.shape === "ellipse", "shape menu arrow navigation");
  document.activeElement.click();
  check(q("#shape-tool-btn").dataset.tool === "ellipse" && q("#shape-tool-btn").getAttribute("aria-pressed") === "true", "shape button remembers Ellipse");
  q("#shape-menu-btn").click();
  key("Escape", document.activeElement);
  check(q("#shape-tools-menu").hidden && document.activeElement === q("#shape-menu-btn"), "Escape closes menu and restores focus");
  key("Escape");
  check(q('[data-tool="move"]').getAttribute("aria-pressed") === "true", "Escape returns to Move");
  const field = q("#proto-properties input, #inspect-properties input");
  check(field, "property field is available to exercise typing");
  field.focus();
  key("f", field);
  check(q('[data-tool="move"]').getAttribute("aria-pressed") === "true", "shortcuts leave input typing alone");
  field.blur();
  key("t", document.body, { ctrlKey: true });
  check(q('[data-tool="move"]').getAttribute("aria-pressed") === "true", "modified shortcuts are not hijacked");
  check(JSON.stringify(doc()) === beforeTools && history() === beforeHistory, "tool selection and menus are view-only");
  for (const theme of ["dark", "highContrast", "light"]) {
    q(`[data-theme="${theme}"]`).click();
    await tick();
    choose(boardId);
    activate("frame");
    check(getComputedStyle(q('[data-tool="frame"]')).backgroundColor === "rgb(28, 26, 23)", `selected tool stays neutral black in ${theme}`);
    check(getComputedStyle(q('[data-tool="frame"]')).color === "rgb(255, 255, 255)", `selected glyph stays white in ${theme}`);
    activate("move");
  }

  q("#component-menu-btn").click();
  check(document.activeElement === q("#component-search"), "component menu focuses search");
  const libraryNames = [...q("#insert-items").querySelectorAll("button")].map((button) => button.textContent);
  check(q("#component-search-results").children.length === libraryNames.length, "dropdown reads the same live library");
  const search = (value) => { q("#component-search").value = value; q("#component-search").dispatchEvent(new Event("input")); };
  search("no-component-matches-this");
  check(q("#component-search-results").children.length === 0 && q("#component-search-status").textContent === "No matching components.", "explicit empty search");
  key("Enter", q("#component-search"));
  check(JSON.stringify(doc()) === beforeTools, "empty search does not insert anything");
  search("bUtToN");
  check(q("#component-search-results").children.length === 1 && q("#component-search-results button").textContent === "Button", "case-insensitive component search");
  key("ArrowDown", q("#component-search"));
  check(document.activeElement === q("#component-search-results button"), "Down focuses a search result");
  key("Escape", document.activeElement);
  check(q("#component-tools-menu").hidden && document.activeElement === q("#component-menu-btn"), "component Escape restores focus");
  q("#component-menu-btn").click();
  search("Button");
  const beforeComponent = JSON.stringify(doc()), componentHistory = history();
  key("Enter", q("#component-search"));
  await tick();
  check(node().component === "Button" && history() === componentHistory + 1, "search inserts one reusable instance transaction");
  check(q("#component-tools-menu").hidden, "component insertion closes dropdown");
  q("#layers-undo-btn").click();
  await tick();
  check(JSON.stringify(doc()) === beforeComponent, "searched component insertion undoes cleanly");

  const preview = q(previewSelector), capture = preview.setPointerCapture;
  preview.setPointerCapture = () => {};
  try {
    const draw = async ({ kind = "rectangle", zoom = 1, cancel = null, click = false, shift = false, flow = false } = {}) => {
      activate("move");
      choose(flow ? flowId : boardId);
      q(zoomSelector).value = String(zoom);
      q(zoomSelector).dispatchEvent(new Event("change"));
      byId(flow ? flowId : boardId).scrollIntoView({ block: "center" });
      await tick();
      activate(kind);
      check(q(`[data-tool="${kind}"]`).getAttribute("aria-pressed") === "true", `${kind} activated before ${cancel || "create"}`);
      const target = byId(flow ? flowId : boardId), rect = target.getBoundingClientRect();
      const scaleX = rect.width / parseFloat(getComputedStyle(target).width);
      const scaleY = rect.height / parseFloat(getComputedStyle(target).height);
      const start = { clientX: rect.left + 120 * scaleX, clientY: rect.top + (flow ? 70 : 110) * scaleY };
      const end = click ? start : { clientX: start.clientX - 75 * scaleX, clientY: start.clientY - 50 * scaleY };
      const linear = kind === "line" || kind === "arrow";
      const fire = (element, type, point = end) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 71, isPrimary: true, button: 0, shiftKey: shift, ...point,
      }));
      const before = JSON.stringify(doc()), count = history();
      fire(target, "pointerdown", start);
      if (!click) {
        fire(window, "pointermove");
        check(!q("#inspect-create-box").hidden, `blue ${kind} draw preview at ${zoom}, ${cancel || "create"}: ${q(errorSelector).textContent}`);
      }
      check(JSON.stringify(doc()) === before && history() === count, "drawing preview never mutates the graph");
      if (cancel === "escape") key("Escape");
      else if (cancel === "blur") window.dispatchEvent(new Event("blur"));
      else if (cancel === "capture") fire(preview, "lostpointercapture");
      else fire(window, cancel === "pointer" ? "pointercancel" : "pointerup");
      await tick();
      check(q("#inspect-create-box").hidden && q("#inspect-drop-box").hidden, "gesture feedback is cleaned up");
      if (cancel) {
        check(JSON.stringify(doc()) === before && history() === count, `${cancel} cancels without an edit`);
        return;
      }
      check(history() === count + 1, `${kind} commits one history step at ${zoom}: ${q(errorSelector).textContent}`);
      check(q('[data-tool="move"]').getAttribute("aria-pressed") === "true", "completion returns to Move");
      if (!click) {
        const snappedLength = Math.round(Math.hypot(75, 50) / Math.sqrt(2) * 100) / 100;
        const expectedWidth = shift && linear ? snappedLength : 75;
        const expectedHeight = shift && linear ? snappedLength : shift && kind !== "text" ? 75 : 50;
        check(size().width === expectedWidth && size().height === expectedHeight, `reverse draw uses document geometry at ${zoom}`);
        if (flow) check(!node().position, "flow creation does not add absolute positioning");
        else {
          const expectedX = Math.round((start.clientX - rect.left) / scaleX - target.clientLeft + target.scrollLeft) - expectedWidth;
          const expectedY = Math.round((start.clientY - rect.top) / scaleY - target.clientTop + target.scrollTop) - expectedHeight;
          check(Math.abs(node().position.x - expectedX) < .01 && Math.abs(node().position.y - expectedY) < .01, "reverse draw updates the freeform origin");
        }
      } else if (kind === "frame") check(size().width === 160 && size().height === 96, "click creates default frame");
      else if (linear) check(size().width === 96 && size().height === 16, "click creates default linear shape");
      else if (kind !== "text") check(size().width === 96 && size().height === 64, "click creates default shape");
      if (linear) {
        check(node().shape === kind && byId(node().id).querySelector("svg path"), "linear shape renders SVG in both adapters");
        if (!click) check(node().endpoints.start.x === 1 && node().endpoints.end.x === 0 && node().endpoints.end.y === 0, "reverse arrow/line points to release");
        check(q('[aria-label="Stroke thickness (px)"]'), "linear shape exposes stroke properties");
      }
      if (kind === "ellipse") check(node().shape === "ellipse" && getComputedStyle(byId(node().id)).borderTopLeftRadius === "50%", "true ellipse geometry survives rendering");
      if (kind === "text") {
        check(document.activeElement.tagName === "TEXTAREA", "Text focuses literal content");
        document.activeElement.blur();
      }
      const created = JSON.stringify(doc()), id = node().id;
      byId(boardId).click();
      check(node().id === id, "synthetic click after pointer release does not steal selection");
      q("#layers-undo-btn").click();
      await tick();
      check(JSON.stringify(doc()) === before, "one undo removes the entire creation");
      q("#layers-redo-btn").click();
      await tick();
      check(JSON.stringify(doc()) === created, "redo restores exact geometry");
      q("#layers-undo-btn").click();
      await tick();
    };
    for (const zoom of [.5, 1, 2]) for (const kind of ["frame", "rectangle", "ellipse", "line", "arrow", "text"]) await draw({ zoom, kind });
    for (const cancel of ["escape", "blur", "capture", "pointer"]) await draw({ cancel });
    for (const kind of ["frame", "rectangle", "ellipse", "line", "arrow", "text"]) await draw({ kind, click: true });
    await draw({ kind: "arrow", cancel: "escape" });
    await draw({ kind: "arrow", shift: true });
    await draw({ kind: "ellipse", shift: true });
    await draw({ flow: true });
    activate("rectangle");
    const beforeInvalid = JSON.stringify(doc());
    preview.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 71, button: 0, isPrimary: true }));
    check(JSON.stringify(doc()) === beforeInvalid && q(errorSelector).textContent.includes("layer"), "invalid drawing target reports an error without mutation");
    activate("move");
  } finally { preview.setPointerCapture = capture; }
  choose(boardId);
  key("o");
  key("Enter");
  await tick();
  check(node().shape === "ellipse", "keyboard insertion uses the selected shape");
  choose(boardId);
  key("L", document.body, { shiftKey: true });
  key("Enter");
  await tick();
  check(node().shape === "arrow", "Shift+L selects Arrow for keyboard insertion");
  choose(boardId);
  key("l");
  key("Enter");
  await tick();
  check(node().shape === "line", "L selects Line for keyboard insertion");
  const lineId = node().id, lineEndpoints = JSON.stringify(node().endpoints);
  const stroke = q('[aria-label="Stroke thickness (px)"]');
  stroke.value = "4";
  stroke.dispatchEvent(new Event("input"));
  stroke.dispatchEvent(new Event("change"));
  await tick();
  check(node().appearance.borderWidth === 4 && byId(lineId).querySelector("svg path").getAttribute("stroke-width") === "4", "stroke controls update shared SVG rendering");
  const workspace = schema === "component" ? window.InspectWorkspace : window.PrototypeWorkspace;
  await workspace.scale(2);
  await tick();
  check(JSON.stringify(node().endpoints) === lineEndpoints && byId(lineId).querySelector("svg").getAttribute("viewBox") === "0 0 192 32", "scaling updates SVG bounds without changing direction");
  choose(boardId);
  checkPosition();
}
