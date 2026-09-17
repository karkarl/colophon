import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { renderProtoShell } from "./proto-renderer.mjs";
import { parseComponents } from "./componentsio.mjs";
import { loadPrototypes, savePrototypes, validatePrototypes } from "./prototypeio.mjs";

async function browserPath() {
  for (const candidate of [
    process.env.COLOPHON_BROWSER,
    ...(process.platform === "win32" ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ] : ["/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]),
  ].filter(Boolean)) {
    try { await access(candidate); return candidate; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return null;
}

async function editorBehavior() {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
  for (let count = 0; !document.querySelector("[data-proto-node-id=card]") && count < 100; count++) await tick();
  check(document.querySelector("[data-proto-node-id=card]"), "prototype loaded");
  check(document.querySelector("#layers-panel").hidden, "Layers is hidden outside Inspect");
  document.querySelector("#inspect-btn").click();
  const layersPanel = document.querySelector("#layers-panel");
  const screensPanel = document.querySelector(".screen-nav");
  const inspector = document.querySelector("#inspector");
  check(!layersPanel.hidden && !inspector.hidden, "Inspect opens both editor sidebars");
  check(layersPanel.getBoundingClientRect().right <= screensPanel.getBoundingClientRect().left + 1, "Layers is left of Screens");
  check(screensPanel.getBoundingClientRect().right <= document.querySelector(".stage").getBoundingClientRect().left + 1, "Screens is left of the preview");
  check(document.querySelector(".stage").getBoundingClientRect().right <= inspector.getBoundingClientRect().left + 1, "Properties stays right of the preview");
  check(layersPanel.contains(document.querySelector("#layers-undo-btn")) && layersPanel.contains(document.querySelector("#layers-duplicate-btn")), "Layer actions stay with the left tree");
  document.querySelector("#inspect-btn").click();
  check(layersPanel.hidden && inspector.hidden, "leaving Inspect hides both sidebars");
  document.querySelector("#inspect-btn").click();
  const node = (id) => document.querySelector(`[data-proto-node-id="${id}"]`);
  const selected = () => valueAtPath(state.proto.doc, state.selectedPath);
  const select = (id) => {
    state.suppressInspectClickUntil = 0;
    node(id).click();
    check(selected()?.id === id, `selected ${id}`);
  };
  const undo = () => document.querySelector("#layers-undo-btn").click();
  const redo = () => document.querySelector("#layers-redo-btn").click();
  const dropLayer = (sourcePath, targetPath, ratio) => {
    const rowFor = (path) => [...document.querySelectorAll(".layer-row")]
      .find((row) => row.dataset.layerPath === JSON.stringify(path));
    const source = rowFor(sourcePath);
    const target = rowFor(targetPath);
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    const rect = target.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, dataTransfer, clientY: rect.top + rect.height * ratio };
    target.dispatchEvent(new DragEvent("dragover", options));
    check(target.dataset.dropPlacement, "tree drag advertises a drop placement");
    target.dispatchEvent(new DragEvent("drop", options));
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
  };

  select("card");
  check(!document.querySelector("#proto-properties").hidden, "Properties is the default tab");
  check(document.querySelector("#proto-json-panel").hidden, "JSON tab initially hidden");
  const matchingButtons = (actual, reference) => {
    const button = getComputedStyle(document.querySelector(actual));
    const toolbar = getComputedStyle(document.querySelector(reference));
    for (const property of ["color", "backgroundColor", "borderTopColor", "borderRadius", "fontSize"]) {
      check(button[property] === toolbar[property], `${actual} shares toolbar ${property}`);
    }
  };
  for (const theme of ["light", "dark", "highContrast"]) {
    document.querySelector(`.theme-btn[data-theme="${theme}"]`).click();
    matchingButtons("#save-btn", "#nav-save-btn");
    matchingButtons("#layers-undo-btn", "#reload-btn");
    matchingButtons("#layers-redo-btn", "#reload-btn");
    matchingButtons("#layers-duplicate-btn", "#outline-btn");
    matchingButtons("#layers-delete-btn", "#outline-btn");
    matchingButtons("#attach-btn", "#outline-btn");
    matchingButtons("#apply-json-btn", "#outline-btn");
    const ink = getComputedStyle(inspector).color;
    check(getComputedStyle(document.querySelector("#properties-tab")).borderBottomColor === ink, "active tab uses neutral ink");
    check(getComputedStyle(node("card")).outlineColor === ink, "preview selection uses neutral ink");
    const field = document.querySelector("#proto-properties input");
    field.focus();
    check(getComputedStyle(field).outlineColor === ink, "property focus uses neutral ink");
    document.querySelector("#json-tab").click();
    const json = document.querySelector("#json-editor");
    json.focus();
    check(getComputedStyle(json).outlineColor === ink, "JSON focus uses neutral ink");
    check(getComputedStyle(json, "::selection").color === ink, "text selection preserves neutral ink");
    document.querySelector("#properties-tab").click();
    const accent = document.createElement("span");
    accent.style.color = "var(--color-accent)";
    document.body.append(accent);
    node("card").style.transition = "none";
    check(getComputedStyle(node("card")).backgroundColor === getComputedStyle(accent).color, "prototype keeps its authored accent");
    const swatch = [...document.querySelectorAll("#proto-properties .color-palette-token")]
      .find((button) => button.querySelector(".color-palette-name")?.textContent === "accent")?.querySelector(".color-palette-swatch");
    check(swatch && getComputedStyle(swatch).backgroundColor === getComputedStyle(accent).color, "palette keeps its authored accent");
    accent.remove();
  }
  document.querySelector('.theme-btn[data-theme="light"]').click();
  const propertyInput = (label) => [...document.querySelectorAll("#proto-properties .property-field")]
    .find((field) => field.querySelector("label")?.textContent === label)?.querySelector("input");
  const width = propertyInput("Width");
  check(width, "Width property control");
  const history = state.past.length;
  width.focus();
  width.value = "220";
  width.dispatchEvent(new Event("input", { bubbles: true }));
  check(selected().width === 220, "input previews a live dimension");
  check(document.activeElement === width, "preview preserves input focus");
  check(parseFloat(getComputedStyle(node("card")).width) === 220, "preview applies the exact requested width");
  check(state.past.length === history, "preview does not create an undo entry");
  width.value = "230";
  width.dispatchEvent(new Event("input", { bubbles: true }));
  width.dispatchEvent(new Event("change", { bubbles: true }));
  check(state.past.length === history + 1, "one property gesture creates one undo entry");
  check(propertyInput("Width") === width, "finishing a gesture preserves property controls");
  const height = propertyInput("Height");
  height.focus();
  check(document.activeElement === height, "focus can move to an adjacent property");
  undo();
  check(selected().width === 180, "undo restores original width");
  redo();
  check(selected().width === 230, "redo restores edited width");

  const previous = JSON.stringify(state.proto.doc);
  previewPropertyEdit((layer) => { layer.width = 250; });
  cancelPropertyEdit();
  check(JSON.stringify(state.proto.doc) === previous, "cancel restores the property draft");
  previewPropertyEdit((layer) => { layer.position.x = Number.NaN; });
  check(document.querySelector("#editor-error").textContent, "invalid input reports an error");
  check(commitPropertyEdit() === false, "invalid gesture is rejected");
  check(JSON.stringify(state.proto.doc) === previous, "invalid gesture rolls back");

  document.querySelector("#json-tab").click();
  const textarea = document.querySelector("#json-editor");
  textarea.value = JSON.stringify({ ...selected(), position: { mode: "absolute", x: "bad", y: 0 } });
  document.querySelector("#apply-json-btn").click();
  check(document.querySelector("#editor-error").textContent, "invalid JSON geometry reports an error");
  check(JSON.stringify(state.proto.doc) === previous, "JSON validation is transactional");
  document.querySelector("#properties-tab").click();

  const componentsBefore = JSON.stringify(state.design.componentsDoc);
  commitPropertyEdit((layer) => { layer.appearance = { background: "accent", color: "$none" }; });
  check(JSON.stringify(state.design.componentsDoc) === componentsBefore, "instance edits never modify component definitions");

  const drag = (id, dx, dy, cancel = false) => {
    const element = node(id);
    const parent = element.offsetParent;
    const bounds = element.getBoundingClientRect();
    const scaleX = parent.getBoundingClientRect().width / parent.offsetWidth;
    const scaleY = parent.getBoundingClientRect().height / parent.offsetHeight;
    const start = { clientX: bounds.left + 10, clientY: bounds.top + 10 };
    const dispatch = (target, type, point) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, ...point,
    }));
    dispatch(element, "pointerdown", start);
    dispatch(window, "pointermove", { clientX: start.clientX + dx * scaleX, clientY: start.clientY + dy * scaleY });
    const during = valueAtPath(state.proto.doc, state.selectedPath).position;
    check(Number(document.querySelector('[data-position-axis="x"]').value) === during.x, "drag synchronizes X");
    check(Number(document.querySelector('[data-position-axis="y"]').value) === during.y, "drag synchronizes Y");
    check(document.querySelector("#layers-undo-btn").disabled, "history is disabled during a drag");
    dispatch(window, cancel ? "pointercancel" : "pointerup", start);
  };
  for (const zoom of ["1", "0.75", "0.5", "fit"]) {
    const picker = document.querySelector("#zoom-select");
    picker.value = zoom;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    select("card");
    const origin = { ...selected().position };
    const before = state.past.length;
    drag("card", 28, -12);
    check(selected().position.x === origin.x + 28 && selected().position.y === origin.y - 12, `zoom-correct coordinates at ${zoom}`);
    check(state.past.length === before + 1, "one drag creates one undo entry");
    undo();
    check(selected().position.x === origin.x && selected().position.y === origin.y, "drag undo");
    redo();
    check(selected().position.x === origin.x + 28, "drag redo");
    const moved = selected().position.x;
    drag("card", 50, 20, true);
    check(selected().position.x === moved, "pointer cancellation restores position");
    node("card").click();
    check(state.runtime.currentId === "first", "post-drag click does not navigate");
  }
  select("card");
  {
    const element = node("card");
    const before = JSON.stringify(state.proto.doc);
    const count = state.past.length;
    const pointer = (target, type, dx = 0) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 9, button: 0, clientX: 40 + dx, clientY: 50,
    }));
    pointer(element, "pointerdown");
    pointer(window, "pointermove", 1);
    pointer(window, "pointerup", 1);
    check(state.past.length === count && JSON.stringify(state.proto.doc) === before, "click jitter is not a drag");
    pointer(element, "pointerdown");
    pointer(window, "pointermove", 30);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    check(!state.freeformDrag && JSON.stringify(state.proto.doc) === before, "Escape cancels dragging");
    check(state.past.length === count, "cancelled dragging records no undo");
  }
  select("nested-text");
  const nestedOrigin = { ...selected().position };
  drag("nested-text", -8, 18);
  check(selected().position.x === nestedOrigin.x - 8 && selected().position.y === nestedOrigin.y + 18, "nested freeform coordinates");

  select("card");
  let source = state.selectedPath.slice();
  const rootPath = ["screens", 0, "root"];
  const beforeInvalidMove = JSON.stringify(state.proto.doc);
  check(!moveLayer(source, rootPath, "before"), "root sibling drop rejected");
  check(JSON.stringify(state.proto.doc) === beforeInvalidMove, "invalid drop never removes source");
  const flowPath = findPathByReference(state.proto.doc, state.proto.doc.screens[0].root.children.find((child) => child.id === "flow"));
  dropLayer(source, flowPath, .5);
  check(valueAtPath(state.proto.doc, state.selectedPath.slice(0, -2)).id === "flow", "tree drag moves inside a flow container");
  check(!selected().position, "flow reparent clears freeform coordinates");
  undo();
  check(selected().position.mode === "absolute", "undo reparent restores position");
  source = state.selectedPath.slice();
  const labelPath = findPathByReference(state.proto.doc, state.proto.doc.screens[0].root.children.find((child) => child.id === "label"));
  dropLayer(source, labelPath, .95);
  check(state.proto.doc.screens[0].root.children[state.selectedPath.at(-1) - 1].id === "label", "after ordering is correct");
  undo();
  select("nested");
  check(!moveLayer(state.selectedPath, [...state.selectedPath, "children", 0], "inside"), "cyclic drop rejected");
  select("card");
  document.querySelector("#layers-duplicate-btn").click();
  const duplicateId = selected().id;
  check(duplicateId !== "card", "duplicate gets a unique stable ID");
  document.querySelector("#layers-delete-btn").click();
  undo();
  check(selected().id === duplicateId, "undo delete restores selection");
  undo();
  check(selected().id === "card", "undo duplicate restores selection");
  {
    const count = state.past.length;
    commitPropertyEdit((layer) => { layer.width = layer.width; });
    check(state.past.length === count, "no-op property changes record no history");
  }

  state.runtime.dispatch({ setState: { expanded: true } });
  state.runtime.dispatch({ navigate: "second" });
  state.runtime.dispatch({ openModal: "details" });
  select("modal-text");
  commitPropertyEdit((layer) => { layer.text = "Edited modal"; });
  check(state.runtime.state.expanded === true, "edit preserves playback state");
  check(state.runtime.openModalId === "details", "edit preserves the open modal");
  state.runtime.dispatch({ back: true });
  check(state.runtime.currentId === "first", "edit preserves navigation history");

  const writes = await fetch("/test/writes").then((response) => response.json());
  check(writes.count === 0, "live edits never write until Save");
  await savePrototype();
  check(!state.dirty, "save clears dirty state");
  check(document.querySelector("#save-btn").disabled, "Save is disabled after saving");
  select("card");
  const savedWidth = selected().width;
  commitPropertyEdit((layer) => { layer.width = 260; });
  undo();
  check(!state.dirty && selected().width === savedWidth, "undo to saved content clears dirty state");
  await fetch("/test/hold-save", { method: "POST" });
  commitPropertyEdit((layer) => { layer.width = 255; });
  const saving = savePrototype();
  let saveWaiting = false;
  for (let count = 0; !saveWaiting && count < 100; count++) {
    saveWaiting = (await fetch("/test/saving").then((response) => response.json())).waiting;
    if (!saveWaiting) await tick();
  }
  check(saveWaiting, "save request is in flight");
  commitPropertyEdit((layer) => { layer.width = 260; });
  await fetch("/test/release-save", { method: "POST" });
  await saving;
  check(state.dirty && selected().width === 260, "save response preserves newer edits");
  undo();
  check(!state.dirty && selected().width === 255, "undo uses the acknowledged save snapshot");
  await fetch("/test/fail-save", { method: "POST" });
  commitPropertyEdit((layer) => { layer.width = 280; });
  await savePrototype();
  check(state.dirty && document.querySelector("#screen-nav-error").textContent, "failed save keeps draft and reports failure");
  await savePrototype();
  await load();
  select("card");
  check(selected().width === 280, "saved edit survives reload");
  check(state.past.length === 0 && state.future.length === 0, "reload resets obsolete history");
}

test("prototype Properties, transactions, zoomed drag and persistence", { timeout: 90000 }, async (t) => {
  const browser = await browserPath();
  if (!browser) { t.skip("Set COLOPHON_BROWSER to run editor browser coverage."); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), "colophon-editor-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const asset = (name) => readFile(new URL(name, import.meta.url), "utf8");
  const tokens = JSON.parse(await asset("sample/design.json"));
  const componentsDoc = parseComponents(await asset("sample/components.jsonc"));
  const design = { tokens, componentsDoc, source: "repo" };
  const original = { meta: { version: 1 }, state: {}, screens: [
    { id: "first", device: "responsive", root: { id: "board", layout: "freeform", width: 700, height: 550, children: [
      { id: "card", component: "Button", props: { children: "Next" }, width: 180, height: 48, position: { mode: "absolute", x: 30, y: 40 }, on: { tap: { navigate: "second" } } },
      { id: "label", text: "Label", position: { mode: "absolute", x: 300, y: 40 } },
      { id: "flow", layout: "stack", width: 220, height: 100, position: { mode: "absolute", x: 30, y: 150 }, children: [] },
      { id: "nested", layout: "freeform", width: 220, height: 150, position: { mode: "absolute", x: 300, y: 150 }, children: [
        { id: "nested-text", text: "Nested", position: { mode: "absolute", x: 10, y: 10 } },
      ] },
    ] } },
    { id: "second", root: { id: "second-title", text: "Second" }, modals: [
      { id: "details", root: { id: "modal-text", text: "Details" } },
    ] },
  ], flows: [] };
  let writes = 0;
  let failSave = false;
  let holdSave = false;
  let releaseSave = null;
  const assets = new Map();
  for (const name of ["proto.css", "property-controls.css", "property-controls.js", "proto-properties.js", "proto-layout.js",
    "proto-render.js", "proto-client.js", "components-runtime.js", "components-interactions.js", "components-interactions.css"]) {
    assets.set(`/${name}`, [name.endsWith(".css") ? "text/css" : "text/javascript", await asset(name)]);
  }
  const html = renderProtoShell().replace("</body>", `<script>
    (async () => {
      const result = document.createElement("pre"); result.id = "editor-result";
      try { await (${editorBehavior.toString()})(); result.textContent = "PASS"; }
      catch (error) { result.textContent = "FAIL " + error.stack; }
      document.body.append(result);
    })();
    </script></body>`);
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/events") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(": connected\n\n");
        return;
      }
      if (request.url === "/test/writes") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ count: writes }));
        return;
      }
      if (request.url === "/test/fail-save") {
        failSave = true;
        response.writeHead(200).end();
        return;
      }
      if (request.url === "/test/hold-save") {
        holdSave = true;
        response.writeHead(200).end();
        return;
      }
      if (request.url === "/test/saving") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ waiting: !!releaseSave }));
        return;
      }
      if (request.url === "/test/release-save") {
        releaseSave?.();
        releaseSave = null;
        response.writeHead(200).end();
        return;
      }
      if (request.url === "/api/prototypes/save") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const { doc } = JSON.parse(Buffer.concat(chunks).toString());
        const validation = validatePrototypes(doc);
        if (failSave || !validation.ok) {
          failSave = false;
          response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "Save rejected", validation }));
          return;
        }
        if (holdSave) {
          holdSave = false;
          await new Promise((resolve) => { releaseSave = resolve; });
        }
        await savePrototypes(dir, doc);
        writes++;
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ validation }));
        return;
      }
      if (request.url === "/api/prototypes") {
        const proto = writes ? await loadPrototypes(dir) : { source: "repo", doc: original };
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ design, proto, validation: validatePrototypes(proto.doc) }));
        return;
      }
      if (request.url === "/api/prototypes/select") {
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
        return;
      }
      const item = request.url === "/" ? ["text/html", html] : assets.get(request.url);
      response.writeHead(item ? 200 : 404, { "content-type": item?.[0] || "text/plain" }).end(item?.[1] || "Not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }));
    }
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { stdout } = await promisify(execFile)(browser, [
      "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
      "--window-size=1600,1000", `--user-data-dir=${path.join(dir, "browser")}`, "--dump-dom", "--virtual-time-budget=12000",
      `http://127.0.0.1:${server.address().port}`,
    ], { timeout: 40000, maxBuffer: 4 * 1024 * 1024 });
    const result = stdout.match(/<pre id="editor-result">([\s\S]*?)<\/pre>/)?.[1];
    assert.equal(result, "PASS", result || stdout.slice(-4000));
    const persisted = await loadPrototypes(dir);
    assert.equal(persisted.doc.screens[0].root.children.find((child) => child.id === "card").width, 280);
    assert.equal(writes, 3);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
