import assert from "node:assert/strict";
import test from "node:test";

import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { applyOps, loadPrototypes, savePrototypes, validatePrototypes, prototypePointerForPath, resolvePrototypeSelection } from "./prototypeio.mjs";
import { buildOutline } from "./proto-outline.mjs";
import { codegenScreen } from "./protocodegen.mjs";
import { appearanceStyle as componentAppearanceStyle } from "./componentsio.mjs";
import "./proto-render.js";

const { validateNode, style, appearanceStyle } = globalThis.ProtoLayout;
const { createRuntime } = globalThis.ProtoRender;

const doc = {
  meta: { version: 1 },
  state: {},
  screens: [{
    id: "home",
    root: {
      id: "root",
      layout: "stack",
      children: [
        { id: "duplicate", text: "First" },
        { id: "duplicate", text: "Second" },
      ],
    },
  }],
  flows: [],
};

test("selection paths resolve the exact node even when IDs are duplicated", () => {
  const selected = resolvePrototypeSelection(doc, {
    screenId: "home",
    path: ["screens", 0, "root", "children", 1],
  });

  assert.equal(selected.node.text, "Second");
  assert.equal(selected.jsonPointer, "/screens/0/root/children/1");
  assert.equal(selected.screen.id, "home");
});

test("selection paths cannot claim a different screen", () => {
  assert.throws(() => resolvePrototypeSelection(doc, {
    screenId: "settings",
    path: ["screens", 0, "root"],
  }), /does not belong to screen/);
});

test("selection paths must resolve to scene-graph nodes", () => {
  assert.throws(() => resolvePrototypeSelection(doc, {
    screenId: "home",
    path: ["screens", 0, "root", "children"],
  }), /must resolve to a prototype node/);
});

test("JSON Pointer paths escape reserved characters", () => {
  assert.equal(prototypePointerForPath(["screens", 0, "a/b~c"]), "/screens/0/a~1b~0c");
});

test("sidebar sections survive saves, reloads and unrelated agent patches", async () => {
  const workspace = await mkdtemp(path.join(process.cwd(), ".prototypeio-workspace-"));
  try {
    const grouped = { ...structuredClone(doc), sections: [{ id: "notes", name: "Notes" }, { id: "empty", name: "Empty" }] };
    grouped.screens[0].sectionId = "notes";
    assert.equal(validatePrototypes(grouped).ok, true);
    await savePrototypes(workspace, grouped);
    const loaded = await loadPrototypes(workspace);
    assert.deepEqual(loaded.doc.sections, grouped.sections);
    assert.equal(loaded.doc.screens[0].sectionId, "notes");
    const patched = applyOps(loaded.doc, [
      { op: "setState", state: { ready: true } },
      { op: "upsertSection", section: { id: "notes", name: "Field notes" } },
      { op: "upsertSection", section: { id: "new", name: "New section" } },
    ]);
    assert.deepEqual(patched.errors, []);
    assert.equal(patched.doc.sections.length, 3);
    assert.equal(patched.doc.sections[0].name, "Field notes");
    assert.equal(patched.doc.screens[0].sectionId, "notes");
    assert.equal(loaded.doc.sections[0].name, "Notes");
    assert.match(buildOutline(patched.doc), /Field notes.*`home`/);
    assert.match(buildOutline(patched.doc), /Empty.*_Empty_/);
    await savePrototypes(workspace, { ...patched.doc, screens: [] });
    assert.deepEqual((await loadPrototypes(workspace)).doc.screens, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("section validation reports malformed groups and dangling assignments", () => {
  for (const sections of [null, {}, [null], [{ id: "", name: "Name" }], [{ id: "a", name: " " }],
    [{ id: "a", name: "A" }, { id: "a", name: "B" }]]) {
    assert.equal(validatePrototypes({ ...doc, sections }).ok, false, JSON.stringify(sections));
  }
  const invalid = structuredClone(doc);
  invalid.screens[0].sectionId = "missing";
  assert.match(validatePrototypes(invalid).errors.join(" "), /unknown section "missing"/);
  assert.match(applyOps(doc, [{ op: "upsertSection", section: { id: "a" } }]).errors[0].error, /section.name/);
  assert.equal(validatePrototypes(doc).ok, true);
  assert.equal(Object.hasOwn(applyOps(doc, []).doc, "sections"), false);
});

const tokenNames = {
  colors: ["ink", "paper", "accent", "transparent"],
  spacing: ["0", "2", "4"],
  radii: ["md", "none"],
  shadows: ["sm", "none"],
  textStyle: ["body", "heading"],
  fontFamily: ["display", "body", "mono"],
};

test("layout model preserves legacy discriminators and validates common fields for every kind", () => {
  for (const layout of ["stack", "row", "grid", "scroll", "freeform", "none"]) {
    assert.deepEqual(validateNode({ layout, gap: "2", padding: "4" }, null, tokenNames), { errors: [], warnings: [] });
  }
  for (const kind of [{ text: "Text" }, { image: "/image.png" }, { spacer: true }, { component: "Button" }]) {
    const node = {
      ...kind, width: "fill", height: 0, gap: 12,
      padding: { x: "2", top: 0 }, margin: { x: "auto", bottom: 8 },
      position: { mode: "absolute", x: -4.5, y: 0 },
      appearance: { color: "#aabbcc", background: "$none", textStyle: "body" },
    };
    assert.deepEqual(validateNode(node, { layout: "freeform" }, tokenNames), { errors: [], warnings: [] });
  }
  for (const width of ["hug", "fill", "100%", "auto", "12rem", "calc(100% - 12px)", "calc(100% / 3)", "var(--width)", 0, 123.5]) {
    assert.deepEqual(validateNode({ text: "", width }, null).errors, []);
  }
});

test("layout model rejects malformed dimensions, boxes, appearance and unsafe colors", () => {
  for (const node of [
    { layout: { mode: "freeform" } }, { layout: "unknown" },
    { columns: 0 }, { columns: -1 }, { columns: 1.5 }, { columns: "bad" }, { columns: {} },
    { wrap: "false" }, { grow: -1 }, { align: "unknown" }, { justify: "unknown" },
    { width: -1 }, { height: Infinity }, { width: NaN }, { width: {} },
    { width: "1px;position:fixed" }, { height: "url(evil)" },
    { gap: -1 }, { gap: {} }, { padding: ["2"] }, { padding: "auto" },
    { padding: { left: -1 } }, { margin: { inline: "auto" } }, { margin: { x: null } },
    { appearance: [] }, { appearance: { opacity: 0 } }, { appearance: { color: 12 } },
    { appearance: { color: "rgb(47, 129, 247)" } }, { appearance: { color: "#fff" } },
    { appearance: { color: "red;display:none" } }, { appearance: { textAlign: "weird" } },
    { appearance: { fontFamily: "$none" } }, { appearance: { textStyle: "missing" } },
    { appearance: { color: "missing" } },
  ]) {
    assert.ok(validateNode({ text: "", ...node }, null, tokenNames).errors.length, JSON.stringify(node));
  }
});

test("absolute positions require finite coordinates and a direct freeform parent", () => {
  const node = { text: "Floating", position: { mode: "absolute", x: 1, y: 2 } };
  assert.deepEqual(validateNode(node, { layout: "freeform" }).errors, []);
  for (const parent of [null, { layout: "stack" }, { component: "Card" }, { layout: "none" }]) {
    assert.match(validateNode(node, parent).errors.join("\n"), /direct children/);
  }
  for (const position of [null, {}, { mode: "relative", x: 1, y: 2 }, { mode: "absolute", x: "1", y: 2 }, { mode: "absolute", x: 1, y: NaN }, { mode: "absolute", x: 1, y: 2, z: 3 }]) {
    if (position === null) continue;
    assert.ok(validateNode({ ...node, position }, { layout: "freeform" }).errors.length);
  }
  const nested = { screens: [{ id: "a", root: { layout: "freeform", children: [{ layout: "stack", children: [node] }] } }] };
  assert.match(validatePrototypes(nested).errors.join("\n"), /direct children/);
});

test("server validation shares token diagnostics without mistaking pixel numbers or boxes for tokens", () => {
  const root = {
    layout: "freeform", gap: 8, padding: { x: "4", y: 0 },
    children: [{ component: "Button", width: 90, position: { mode: "absolute", x: 0, y: 1 }, appearance: { color: "accent" } }],
  };
  const document = { screens: [{ id: "a", root }] };
  assert.deepEqual(validatePrototypes(document, { componentNames: ["Button"], tokenNames }), { ok: true, errors: [], warnings: [] });
  root.children[0].appearance.color = "missing";
  assert.match(validatePrototypes(document, { tokenNames }).errors.join("\n"), /appearance.color.*unknown colors/);
  assert.match(validateNode({ text: "", padding: "unknown" }, null, tokenNames).warnings.join("\n"), /unknown spacing/);
  assert.equal(validateNode({ text: "", color: "unknown" }, null, tokenNames).errors.length, 0);
});

test("appearance typography validation accepts the client's plural token group names", () => {
  const names = { textStyles: ["body"], fontFamilies: ["body"] };
  assert.deepEqual(validateNode({ text: "", appearance: { textStyle: "body", fontFamily: "body" } }, null, names).errors, []);
  assert.match(validateNode({ text: "", appearance: { textStyle: "missing" } }, null, names).errors.join("\n"), /unknown textStyle/);
  assert.match(validateNode({ text: "", appearance: { fontFamily: "mono" } }, null, names).errors.join("\n"), /unknown fontFamily/);
});

test("shared styles resolve dimensions, boxes, freeform coordinates and no-layout flow", () => {
  const css = style({
    layout: "freeform", width: "fill", height: 320, gap: 0,
    padding: { x: "4", y: 8, top: 0 }, margin: { x: "auto", right: "2" },
  });
  assert.deepEqual(css, {
    "box-sizing": "border-box", display: "block", position: "relative", gap: "0px",
    "padding-top": "0px", "padding-right": "var(--space-4)", "padding-bottom": "8px", "padding-left": "var(--space-4)",
    "margin-right": "var(--space-2)", "margin-left": "auto",
    width: "100%", "min-width": "0", height: "320px", flex: "0 0 auto",
  });
  assert.equal(style({ layout: "none" }).display, "block");
  assert.equal(style({ layout: "none" })["flex-direction"], undefined);
  assert.equal(style({ layout: "row" })["flex-wrap"], "wrap");
  assert.equal(style({ layout: "row", wrap: false })["flex-wrap"], "nowrap");
  assert.equal(style({ layout: "stack", wrap: true })["flex-wrap"], "wrap");
  assert.deepEqual(validateNode({ layout: "grid", columns: "3", grow: 1, align: "flex-start", justify: "space-between", wrap: false }, null).errors, []);
  assert.equal(style({ layout: "stack", direction: "horizontal" })["flex-direction"], "row");
  assert.equal(style({ layout: "scroll" }).overflow, "auto");
  assert.equal(style({ layout: "grid", columns: 3 })["grid-template-columns"], "repeat(3, minmax(0, 1fr))");
  assert.deepEqual(style({ text: "", width: "hug", position: { mode: "absolute", x: -2.5, y: 0 } }), {
    width: "fit-content", "box-sizing": "border-box", flex: "0 0 auto", position: "absolute", left: "-2.5px", top: "0px",
  });
  assert.deepEqual(style({ component: "Button" }), {});
});

test("appearance matches component-system CSS and sparse overrides beat legacy values", () => {
  for (const appearance of [
    { textStyle: "heading", fontFamily: "mono", color: "ink", background: "#abcdef", borderColor: "accent", textAlign: "center", radius: "md", shadow: "sm" },
    { color: "$none", background: "$none", borderColor: "$none", radius: "$none", shadow: "$none" },
    { color: "transparent", radius: "none", shadow: "none" },
  ]) {
    assert.deepEqual(appearanceStyle({ appearance }), componentAppearanceStyle({ appearance }));
    assert.deepEqual(validateNode({ text: "", appearance }, null, tokenNames).errors, []);
  }
  const node = { component: "Card", color: "ink", background: "paper", style: "body", radius: "md", appearance: { color: "#abcdef", textStyle: "heading", radius: "$none" } };
  const before = structuredClone(node);
  const css = style(node);
  assert.equal(css.color, "#abcdef");
  assert.equal(css["background-color"], "var(--color-paper)");
  assert.equal(css["font-size"], "var(--text-heading-size)");
  assert.equal(css["border-radius"], "0");
  assert.deepEqual(node, before);
});

test("runtime replacement preserves state, navigation history and valid open modals without emitting", () => {
  const initial = { state: { count: 0 }, screens: [
    { id: "a", root: { text: "A" } },
    { id: "b", root: { text: "B" }, modals: [{ id: "dialog", root: { text: "Old modal" } }] },
  ] };
  const runtime = createRuntime({ doc: initial });
  runtime.dispatch({ setState: { count: 7 } });
  runtime.dispatch({ navigate: "b" });
  runtime.dispatch({ openModal: "dialog" });
  let changes = 0, navigations = 0;
  runtime.onChange(() => changes++);
  runtime.onNavigate(() => navigations++);
  const next = structuredClone(initial);
  next.state = { count: 99, added: true };
  next.screens[1].root.text = "Updated B";
  next.screens[1].modals[0].root.text = "Updated modal";
  runtime.updateDocument(next);
  assert.equal(runtime.doc, next);
  assert.equal(runtime.screens, next.screens);
  assert.equal(runtime.screen().root.text, "Updated B");
  assert.equal(runtime.currentId, "b");
  assert.equal(runtime.openModalId, "dialog");
  assert.deepEqual(runtime.state, { count: 7, added: true });
  assert.equal(changes, 0);
  assert.equal(navigations, 0);
  runtime.dispatch({ back: true });
  assert.equal(runtime.currentId, "a");
});

test("runtime replacement cleans missing screens, history and modals and accepts empty documents", () => {
  const runtime = createRuntime({ doc: { screens: [{ id: "a" }, { id: "b" }, { id: "c", modals: [{ id: "m" }] }] } });
  runtime.dispatch({ navigate: "b" });
  runtime.dispatch({ navigate: "c" });
  runtime.dispatch({ openModal: "m" });
  runtime.updateDocument({ screens: [{ id: "a" }, { id: "c" }] });
  assert.equal(runtime.openModalId, null);
  runtime.dispatch({ back: true });
  assert.equal(runtime.currentId, "a");
  runtime.dispatch({ navigate: "c" });
  runtime.updateDocument({ screens: [{ id: "new" }] });
  assert.equal(runtime.currentId, "new");
  runtime.dispatch({ back: true });
  assert.equal(runtime.currentId, "new");
  runtime.updateDocument({ screens: [] });
  assert.equal(runtime.currentId, null);
  assert.equal(runtime.screen(), null);
});

const freeformDoc = {
  screens: [{
    id: "freeform", root: {
      layout: "freeform", width: "fill", height: 400, padding: { x: "4" },
      children: [
        { text: "Headline <safe>", appearance: { textStyle: "heading", color: "#abcdef" }, margin: { top: 2 }, position: { mode: "absolute", x: 10, y: 20 }, on: { tap: { navigate: "next" } } },
        { component: "Button", width: 140, height: "hug", props: { children: "Go", style: { opacity: 0.8 } }, appearance: { radius: "$none", background: "accent" }, position: { mode: "absolute", x: 30, y: 60 }, on: { tap: { toggle: "ready" } } },
        { image: "/cover.png", width: 0, height: 24, appearance: { radius: "md" } },
        { spacer: true, width: 7, margin: "auto" },
        { layout: "none", children: [] },
      ],
    },
  }],
};

test("codegen carries common styles on every node and handlers directly on positioned instance roots", () => {
  const code = codegenScreen(freeformDoc, "freeform", {}).code;
  assert.match(code, /"position":"relative"/);
  assert.match(code, /"position":"absolute","left":"10px","top":"20px"/);
  assert.match(code, /"fontSize":"var\(--text-heading-size\)"/);
  assert.match(code, /"color":"#abcdef"/);
  assert.match(code, /<Button[^>]*"opacity":0.8[^>]*"width":"140px"[^>]*"borderRadius":"0"[^>]*onClick=/);
  assert.match(code, /<img[^>]*"width":"0px"[^>]*"height":"24px"/);
  assert.match(code, /"width":"7px".*"margin":"auto"/);
  assert.match(code, /<h2[^>]*onClick=.*\{"Headline <safe>"\}/);
  assert.doesNotMatch(code, /<span/);
  assert.match(code, /forward style\/onClick to their instance root/);
});

test("native handoff records freeform mapping, dimensions, appearance and positions", () => {
  const generated = codegenScreen(freeformDoc, "freeform", { authority: { designSource: "self", port: { authoritySource: "WinUI", syncSource: "native-guide" } } });
  assert.equal(generated.language, "text");
  assert.match(generated.code, /Canvas \+ Canvas.Left\/Top/);
  assert.match(generated.code, /ZStack \+ top-leading offset/);
  assert.match(generated.code, /"width":"140px"/);
  assert.match(generated.code, /"left":"30px"/);
  assert.match(generated.code, /"background-color":"var\(--color-accent\)"/);
});

test("renderer applies instance styles before DS interaction capture and keeps component roots wrapper-free", async () => {
  class Element {
    constructor(tag) {
      this.nodeType = 1; this.tagName = tag; this.children = []; this.dataset = {}; this.events = {};
      this.style = { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } };
      this.classList = { add: (...names) => { this.className = [this.className || "", ...names].join(" "); } };
    }
    setAttribute(key, value) {
      if (key === "style") for (const declaration of value.split(";")) {
        const at = declaration.indexOf(":");
        if (at >= 0) this.style.setProperty(declaration.slice(0, at), declaration.slice(at + 1));
      } else this[key] = value;
    }
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
    set innerHTML(value) { if (value === "") this.children = []; }
  }
  const componentsDoc = { components: [{ name: "Button", root: { el: "button", appearance: { background: "paper" } } }] };
  const original = structuredClone(componentsDoc);
  let captured, disposed = 0;
  const document = { createElement: (tag) => new Element(tag), createTextNode: (text) => ({ nodeType: 3, textContent: text }) };
  const window = {
    DSComp: {
      componentNames: () => ["Button"],
      expandInstance: () => ({ tag: "button", style: { "background-color": "var(--color-paper)" }, states: { hover: { "background-color": "var(--color-ink)" } } }),
      specToDom(spec) {
        captured = spec;
        const dom = new Element(spec.tag);
        for (const [key, value] of Object.entries(spec.style)) dom.style.setProperty(key, value);
        dom.addEventListener("click", () => {});
        return dom;
      },
      renderComponent() { throw new Error("Expected instance spec expansion before mount"); },
    },
    DSInteractions: { createContext: (render) => ({ render }), mount: (dom) => dom, disposeTree: () => disposed++ },
  };
  const context = vm.createContext({ window, document });
  for (const name of ["proto-layout.js", "proto-render.js"]) {
    vm.runInContext(await readFile(new URL(name, import.meta.url), "utf8"), context);
  }
  const runtime = window.ProtoRender.createRuntime({ doc: freeformDoc, componentsDoc });
  const surface = new Element("main");
  window.ProtoRender.renderScreen(surface, runtime, {});
  const root = surface.children[0], button = root.children[1];
  assert.equal(root.style.position, "relative");
  assert.equal(button.tagName, "button");
  assert.equal(button.dataset.protoKind, "component");
  assert.equal(button.style.width, "140px");
  assert.equal(button.style.position, "absolute");
  assert.equal(captured.style["background-color"], "var(--color-accent)");
  assert.equal(captured.states.hover["background-color"], "var(--color-ink)");
  assert.equal(button.events.click.length, 2);
  assert.equal(root.children[2].style.width, "0px");
  assert.equal(root.children[3].style.width, "7px");
  assert.equal(root.children[4].style.display, "block");
  assert.equal(disposed, 1);
  assert.deepEqual(componentsDoc, original);
  button.events.click[1]({ stopPropagation() {} });
  assert.equal(runtime.state.ready, true);
  button.events.click[1]({ defaultPrevented: true, stopPropagation() { throw new Error("DS action should win"); } });
  assert.equal(runtime.state.ready, true);
});
