import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "./editor-geometry.js";
import "./proto-editor-model.js";
import { scaleComponentGeometry, canContainComponentChildren, expandInstance, validateComponentsDoc, parseComponents, serializeComponents } from "./componentsio.mjs";
import { validatePrototypes, parsePrototypes, serializePrototypes } from "./prototypeio.mjs";
import { codegenScreen } from "./protocodegen.mjs";

const fixture = () => ({ screens: [{ id: "one", root: {
  id: "board", layout: "freeform", width: 500, height: 400, children: [
    { id: "label", text: "Label", position: { mode: "absolute", x: 20, y: 10 } },
    { id: "flow", layout: "stack", children: [] },
    { id: "nested", layout: "freeform", children: [] },
  ],
}, modals: [{ id: "modal", root: { id: "frame", layout: "stack", children: [] } }] },
{ id: "two", root: { id: "other", layout: "stack", children: [] } }] });
const path = (...parts) => ["screens", 0, "root", ...parts];

test("shared templates insert prototype layers with IDs unique across screen and modal roots", () => {
  const doc = fixture();
  const frame = EditorGeometry.template("frame", {});
  const at = ProtoEditorModel.insert(doc, path(), frame);
  assert.equal(ProtoEditorModel.find(doc, doc.screens[0].root.children.at(-1)).join(), at.join());
  assert.equal(doc.screens[0].root.children.at(-1).id, "frame-2");
  for (const kind of ["rectangle", "text", "component:Button"]) {
    ProtoEditorModel.insert(doc, at, EditorGeometry.template(kind, {}));
  }
  const inserted = doc.screens[0].root.children.at(-1);
  assert.equal(inserted.children[2].component, "Button");
  assert.deepEqual(inserted.children[0].position, { mode: "absolute", x: 0, y: 0 });
  assert.equal(validatePrototypes(doc, { componentNames: ["Button"] }).ok, true);
  assert.equal(frame.id, "frame", "insertion does not modify palette templates");
});

test("prototype move validates before mutating and preserves identity through reparent/reorder", () => {
  const doc = fixture();
  const label = doc.screens[0].root.children[0];
  const inside = ProtoEditorModel.move(doc, path("children", 0), path("children", 1), "inside");
  assert.equal(label.position, undefined);
  assert.equal(inside.join(), path("children", 0, "children", 0).join());
  ProtoEditorModel.move(doc, inside, path("children", 1), "inside");
  assert.deepEqual(label.position, { mode: "absolute", x: 0, y: 0 });
  const before = JSON.stringify(doc);
  assert.throws(() => ProtoEditorModel.move(doc, path(), path("children", 0)), /Root/);
  assert.throws(() => ProtoEditorModel.move(doc, path("children", 1), path("children", 1, "children", 0), "before"), /itself/);
  assert.throws(() => ProtoEditorModel.move(doc, path("children", 0), ["screens", 1, "root"], "inside"), /same screen/);
  assert.throws(() => ProtoEditorModel.destination(doc, path("children", 1, "children", 0), "inside"), /layout/);
  assert.equal(JSON.stringify(doc), before);
  ProtoEditorModel.move(doc, path("children", 0), path("children", 1), "after");
  assert.deepEqual(doc.screens[0].root.children.map((node) => node.id), ["nested", "flow"]);
});

test("shared scaling freezes root geometry but preserves tokens, references, actions and CSS descendant dimensions", () => {
  for (const schema of ["component", "prototype"]) {
    const flat = schema === "prototype";
    const node = {
      ...(flat ? { layout: "freeform", width: "fill" } : { el: "div", layout: { mode: "freeform", width: "fill" } }),
      position: { mode: "absolute", x: 30, y: 10 }, appearance: { textStyle: "body", borderWidth: 1 }, padding: "4",
      children: [
        { component: "Button", props: { children: "Next" }, on: { tap: { navigate: "next" } },
          ...(flat ? { width: 40, height: "50%" } : { layout: { width: 40, height: "fill" } }),
          position: { mode: "absolute", x: 3, y: 7 } },
        { component: "Card" },
      ],
    };
    const first = structuredClone(node);
    if (flat) EditorGeometry.scale(node, 2, { width: 160, height: 96 });
    else scaleComponentGeometry(node, 2, { width: 160, height: 96 });
    const size = flat ? node : node.layout;
    assert.equal(size.width, 320);
    assert.equal(size.height, 192);
    assert.deepEqual(node.position, first.position);
    assert.deepEqual(node.appearance, first.appearance);
    assert.deepEqual(node.children[1], first.children[1]);
    assert.deepEqual(node.children[0].on, first.children[0].on);
    assert.equal((flat ? node.children[0] : node.children[0].layout).width, 80);
    assert.deepEqual(node.children[0].position, { mode: "absolute", x: 6, y: 14 });
    const before = JSON.stringify(node);
    for (const factor of [0, Infinity, 11, NaN]) assert.throws(() => EditorGeometry.scale(node, factor, { width: 1, height: 1 }, schema), /multiplier/);
    assert.throws(() => EditorGeometry.scale(node, 10, { width: 999999, height: 1 }, schema), /range/);
    assert.equal(JSON.stringify(node), before, "failed scaling is atomic");
  }
});

test("creation bounds normalize reverse drags, square constraints, and invalid geometry", () => {
  assert.deepEqual(EditorGeometry.creationBounds({ x: 120, y: 110 }, { x: 45, y: 60 }), { x: 45, y: 60, width: 75, height: 50 });
  assert.deepEqual(EditorGeometry.creationBounds({ x: 120, y: 110 }, { x: 45, y: 60 }, true), { x: 45, y: 35, width: 75, height: 75 });
  assert.deepEqual(EditorGeometry.creationBounds({ x: 0, y: 0 }, { x: 0, y: 0 }), { x: 0, y: 0, width: 1, height: 1 });
  for (const x of [NaN, Infinity, 1000001]) assert.throws(() => EditorGeometry.creationBounds({ x: 0, y: 0 }, { x, y: 0 }), /range/);
});

test("ellipse primitives roundtrip and render consistently in components, exports, prototypes, and codegen", async () => {
  const tokens = { colors: [{ name: "line" }] };
  const root = EditorGeometry.template("ellipse", tokens, "component");
  root.appearance.radius = "pill";
  const components = { meta: { version: 3 }, components: [{ name: "Shape", root }] };
  assert.equal(validateComponentsDoc(components).ok, true);
  assert.equal(canContainComponentChildren(root), false);
  assert.equal(parseComponents(serializeComponents(components)).components[0].root.shape, "ellipse");
  assert.equal(expandInstance(components, "Shape").style["border-radius"], "50%");
  const window = {};
  vm.runInNewContext(await readFile(new URL("./components-runtime.js", import.meta.url), "utf8"), { window, ShapeGeometry });
  assert.equal(window.DSComp.expandInstance(components, "Shape").style["border-radius"], "50%");
  root.children = ["Not a container"];
  assert.match(validateComponentsDoc(components).errors.join(), /cannot contain children/);
  delete root.children;
  root.shape = "capsule";
  assert.match(validateComponentsDoc(components).errors.join(), /shape/);
  const ellipse = EditorGeometry.template("ellipse", tokens);
  const prototypes = { screens: [{ id: "one", root: ellipse }] };
  assert.equal(validatePrototypes(prototypes).ok, true);
  assert.equal(ProtoEditorModel.container(ellipse), false);
  assert.equal(parsePrototypes(serializePrototypes(prototypes)).screens[0].root.shape, "ellipse");
  assert.equal(ProtoLayout.style(ellipse)["border-radius"], "50%");
  assert.match(codegenScreen(prototypes, "one", {}).code, /"borderRadius":"50%"/);
  EditorGeometry.scale(ellipse, 2, { width: 96, height: 64 });
  assert.equal(ellipse.shape, "ellipse");
  assert.equal(ellipse.width, 192);
  ellipse.children = [{ id: "nested", text: "Not a container" }];
  assert.match(validatePrototypes(prototypes).errors.join(), /cannot contain children/);
  ellipse.children = [];
  ellipse.shape = "capsule";
  assert.match(validatePrototypes(prototypes).errors.join(), /shape/);
});

test("linear geometry retains drag direction, horizontal/vertical endpoints, and Shift angle snapping", () => {
  for (const [dx, dy] of [[75, 50], [-75, 50], [75, -50], [-75, -50], [0, 50], [0, -50], [75, 0], [-75, 0]]) {
    const geometry = EditorGeometry.creationBounds({ x: 0, y: 0 }, { x: dx, y: dy }, false, true);
    assert.equal(geometry.width, Math.max(1, Math.abs(dx)));
    assert.equal(geometry.height, Math.max(1, Math.abs(dy)));
    const { start, end } = geometry.endpoints;
    assert.equal(Math.sign(end.x - start.x), Math.sign(dx));
    assert.equal(Math.sign(end.y - start.y), Math.sign(dy));
    assert.deepEqual(ShapeGeometry.validate({ shape: "arrow", ...geometry }), []);
  }
  const diagonal = EditorGeometry.creationBounds({ x: 0, y: 0 }, { x: -75, y: 50 }, true, true);
  assert.equal(diagonal.width, diagonal.height);
  assert.deepEqual(diagonal.endpoints, { start: { x: 1, y: 0 }, end: { x: 0, y: 1 } });
  const horizontal = EditorGeometry.creationBounds({ x: 0, y: 0 }, { x: 75, y: 10 }, true, true);
  assert.equal(horizontal.height, 1);
  assert.equal(horizontal.endpoints.end.y, .5);
});

test("line and arrow share SVG paths, stroke controls, serialization, scale and generated code", async () => {
  const window = {};
  vm.runInNewContext(await readFile(new URL("./components-runtime.js", import.meta.url), "utf8"), { window, ShapeGeometry });
  for (const kind of ["line", "arrow"]) {
    const flat = EditorGeometry.template(kind, { colors: [{ name: "ink" }] });
    flat.endpoints = { start: { x: 1, y: 0 }, end: { x: 0, y: 1 } };
    const component = { ...structuredClone(flat), el: "div", layout: { width: flat.width, height: flat.height } };
    delete component.width; delete component.height;
    const components = { meta: { version: 3 }, components: [{ name: "Connector", root: component }] };
    const prototypes = { screens: [{ id: "one", root: flat }] };
    assert.equal(validateComponentsDoc(components).ok, true);
    assert.equal(validatePrototypes(prototypes).ok, true);
    const classic = window.DSComp.expandInstance(components, "Connector");
    const esm = expandInstance(components, "Connector");
    assert.deepEqual(JSON.parse(JSON.stringify(classic.children)), esm.children);
    const path = ShapeGeometry.svgSpec(flat).children[0].attrs;
    assert.equal(path.d.startsWith("M 96 0 L 0 16"), true);
    assert.equal(path.stroke, "var(--color-ink)");
    assert.equal(path["stroke-width"], 2);
    assert.equal(path["vector-effect"], "non-scaling-stroke");
    assert.equal(path.d.split("M").length - 1, kind === "arrow" ? 2 : 1);
    assert.match(codegenScreen(prototypes, "one", {}).code, /<svg.*<path/);
    assert.match(codegenScreen(prototypes, "one", {}).code, /vectorEffect=\{"non-scaling-stroke"\}/);
    assert.match(codegenScreen(prototypes, "one", { authority: { port: { authoritySource: "WinUI" } } }).code, /stroke=\{"color":"ink","width":2\}/);
    assert.deepEqual(parsePrototypes(serializePrototypes(prototypes)).screens[0].root, flat);
    assert.deepEqual(parseComponents(serializeComponents(components)).components[0].root, component);
    const before = structuredClone(flat.endpoints);
    EditorGeometry.scale(flat, 2, { width: flat.width, height: flat.height });
    assert.deepEqual(flat.endpoints, before);
    assert.match(ShapeGeometry.svgSpec(flat).children[0].attrs.d, /^M 192 0 L 0 32/);
    flat.appearance = { borderColor: "#123456", borderWidth: 4 };
    assert.equal(ShapeGeometry.svgSpec(flat).children[0].attrs.stroke, "#123456");
    assert.equal(ShapeGeometry.svgSpec(flat).children[0].attrs["stroke-width"], 4);
    flat.appearance = { borderColor: "$none", borderWidth: 0 };
    assert.equal(ShapeGeometry.svgSpec(flat).children[0].attrs.stroke, "transparent");
    for (const endpoints of [{}, { start: { x: -1, y: 0 }, end: { x: 1, y: 0 } }, { start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }]) {
      assert.equal(validatePrototypes({ screens: [{ id: "one", root: { ...flat, endpoints } }] }).ok, false);
    }
    assert.equal(validatePrototypes({ screens: [{ id: "one", root: { ...flat, width: "fill" } }] }).ok, false);
  }
});

test("shape geometry follows nested instance overrides in both component runtimes", async () => {
  const window = {};
  vm.runInNewContext(await readFile(new URL("./components-runtime.js", import.meta.url), "utf8"), { window, ShapeGeometry });
  const doc = { meta: { version: 3 }, components: [
    { name: "Ellipse", root: { id: "ellipse", el: "div", shape: "ellipse", layout: { width: 96, height: 64 } } },
    { name: "EllipseInstance", root: { id: "ellipse-instance", component: "Ellipse", appearance: { radius: "md" } } },
    { name: "Arrow", root: { id: "arrow", el: "div", shape: "arrow", layout: { width: 96, height: 16 },
      endpoints: { start: { x: 1, y: 1 }, end: { x: 0, y: 0 } }, appearance: { borderColor: "#000000", borderWidth: 2 } } },
    { name: "ArrowInstance", root: { id: "arrow-instance", component: "Arrow", layout: { width: 192 },
      appearance: { borderColor: "#ff0000", borderWidth: 4, background: "#ffffff" } } },
    { name: "Nested", root: { id: "nested", component: "ArrowInstance", appearance: { borderColor: "$none", borderWidth: 0 } } },
  ] };
  assert.equal(validateComponentsDoc(doc).ok, true);
  const before = structuredClone(doc);
  for (const expand of [expandInstance, window.DSComp.expandInstance]) {
    assert.equal(expand(doc, "EllipseInstance").style["border-radius"], "50%");
    const arrow = expand(doc, "ArrowInstance");
    assert.equal(arrow.style["border-width"], "0");
    assert.equal(arrow.style["background-color"], "transparent");
    assert.equal(arrow.children.length, 1);
    assert.equal(arrow.children[0].attrs.viewBox, "0 0 192 16");
    assert.equal(arrow.children[0].children[0].attrs.stroke, "#ff0000");
    assert.equal(arrow.children[0].children[0].attrs["stroke-width"], 4);
    assert.match(arrow.children[0].children[0].attrs.d, /^M 192 16 L 0 0/);
    const nested = expand(doc, "Nested");
    assert.equal(nested.children[0].children[0].attrs.stroke, "transparent");
    assert.equal(nested.children[0].children[0].attrs["stroke-width"], 0);
    const prototype = ShapeGeometry.applyToSpec({ ...arrow, style: { ...arrow.style, ...ProtoLayout.style({
      component: "ArrowInstance", width: "fill", position: { mode: "absolute", x: 10, y: 20 }, appearance: { borderWidth: 6 },
    }) } }, { width: "fill", position: { mode: "absolute", x: 10, y: 20 }, appearance: { borderWidth: 6 } });
    assert.equal(prototype.style.position, "absolute");
    assert.equal(prototype.style.width, "100%");
    assert.equal(prototype.style["border-width"], "0");
    assert.equal(prototype.children[0].attrs.viewBox, "0 0 192 16");
    assert.equal(prototype.children[0].children[0].attrs["stroke-width"], 6);
    assert.equal(arrow.children[0].children[0].attrs["stroke-width"], 4, "overrides do not mutate the expanded definition");
  }
  assert.deepEqual(doc, before);
});
