import assert from "node:assert/strict";
import test from "node:test";

import { prototypePointerForPath, resolvePrototypeSelection } from "./prototypeio.mjs";

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
