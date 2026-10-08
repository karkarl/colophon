import test from "node:test";
import assert from "node:assert/strict";
import "./editor-geometry.js";
import "./proto-editor-model.js";
import { scaleComponentGeometry } from "./componentsio.mjs";
import { validatePrototypes } from "./prototypeio.mjs";

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
