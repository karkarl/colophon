import assert from "node:assert/strict";
import test from "node:test";

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyOps, loadPrototypes, savePrototypes, validatePrototypes, prototypePointerForPath, resolvePrototypeSelection } from "./prototypeio.mjs";
import { buildOutline } from "./proto-outline.mjs";

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
  const workspace = await mkdtemp(path.join(os.tmpdir(), "colophon-sections-"));
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
