import test from "node:test";
import assert from "node:assert/strict";
import "./page-components.js";

const { snapshot, assign, reorder } = globalThis.PageComponents;
const names = ["Button", "Field", "Card", "Example"];
const fixture = () => ({ pages: [
  { id: "components", name: "Components", components: ["Button", "Field"] },
  { id: "setup", name: "Setup", components: ["Example", "Button"], content: "Keep these notes" },
  { id: "empty", name: "Empty", components: [] },
] });

test("snapshot shows every placement, duplicates and unassigned without migrating defaults", () => {
  const tokens = { pages: [{ id: "setup", name: "Setup", components: ["Example"] }] };
  const before = structuredClone(tokens);
  const board = snapshot(tokens, names);
  assert.deepEqual(board.groups[0].components, names);
  assert.deepEqual(board.duplicates, ["Example"]);
  assert.deepEqual(board.unassigned, []);
  assert.deepEqual(tokens, before);
  assert.deepEqual(snapshot(fixture(), names).unassigned, ["Card"]);
});

test("assign chooses one home, keeps order and preserves unrelated duplicates and metadata", () => {
  const tokens = fixture();
  tokens.pages[1].components.push("Field");
  assert.equal(assign(tokens, names, "Button", "setup", "Example"), true);
  assert.deepEqual(tokens.pages[0].components, ["Field"]);
  assert.deepEqual(tokens.pages[1].components, ["Button", "Example", "Field"]);
  assert.deepEqual(snapshot(tokens, names).duplicates, ["Field"]);
  assert.equal(tokens.pages[1].content, "Keep these notes");
});

test("explicitly choosing the current home resolves duplicates without changing its position", () => {
  const tokens = fixture();
  assign(tokens, names, "Button", "components", "Button");
  assert.deepEqual(tokens.pages[0].components, ["Button", "Field"]);
  assert.deepEqual(tokens.pages[1].components, ["Example"]);
});

test("reordering only changes that page and never silently resolves duplicate placements", () => {
  const tokens = fixture();
  reorder(tokens, names, "Button", "components");
  assert.deepEqual(tokens.pages[0].components, ["Field", "Button"]);
  assert.deepEqual(tokens.pages[1].components, ["Example", "Button"]);
  assert.deepEqual(snapshot(tokens, names).duplicates, ["Button"]);
  reorder(tokens, names, "Button", "components", "Field");
  assert.deepEqual(tokens.pages[0].components, ["Button", "Field"]);
  assert.equal(reorder(tokens, names, "Button", "components", "Button"), false);
});

test("moving from default-all pages materializes affected selections, not the registry", () => {
  const tokens = { pages: [{ id: "setup", name: "Setup" }] };
  assign(tokens, names, "Example", "setup");
  assert.deepEqual(tokens.pages.find((page) => page.id === "components").components, ["Button", "Field", "Card"]);
  assert.deepEqual(snapshot(tokens, names).homes.get("Example"), ["setup"]);
  assert.deepEqual(names, ["Button", "Field", "Card", "Example"]);
});

test("unassigning removes all standalone placements; assigning to an empty page appends", () => {
  const tokens = fixture();
  assign(tokens, names, "Button", null);
  assert.deepEqual(snapshot(tokens, names).unassigned, ["Button", "Card"]);
  assign(tokens, names, "Button", "empty");
  assign(tokens, names, "Card", "empty", "Button");
  assert.deepEqual(tokens.pages[2].components, ["Card", "Button"]);
  tokens.pages.splice(2, 1);
  assert.deepEqual(snapshot(tokens, names).unassigned, ["Button", "Card"]);
});

test("unassigning the last default preview preserves explicit empty selections", () => {
  const tokens = {};
  assign(tokens, ["Button"], "Button", null);
  assert.deepEqual(tokens.pages, [{ id: "components", name: "Components", components: [] }]);
  assert.deepEqual(snapshot(tokens, ["Button"]).unassigned, ["Button"]);
  assert.equal(assign(tokens, ["Button"], "Button", null), false);
});

test("missing references stay visible during unrelated moves and can be explicitly removed", () => {
  const tokens = fixture();
  tokens.pages[0].components.unshift("Missing");
  assign(tokens, names, "Card", "empty");
  assert.deepEqual(snapshot(tokens, names).homes.get("Missing"), ["components"]);
  assign(tokens, names, "Missing", null);
  assert.equal(snapshot(tokens, names).homes.has("Missing"), false);
});

test("invalid and stale moves fail atomically instead of losing placements", () => {
  for (const attempt of [
    (tokens) => assign(tokens, names, "Button", "removed-page"),
    (tokens) => assign(tokens, names, "Button", "setup", "Removed"),
    (tokens) => assign(tokens, names, "Removed", "setup"),
    (tokens) => reorder(tokens, names, "Card", "setup"),
  ]) {
    const tokens = fixture();
    const before = structuredClone(tokens);
    assert.throws(() => attempt(tokens), /no longer exists|no longer on/);
    assert.deepEqual(tokens, before);
  }
  for (const components of [null, "Button", [""], ["Button", "Button"]]) {
    const tokens = fixture();
    tokens.pages[1].components = components;
    const before = structuredClone(tokens);
    assert.throws(() => assign(tokens, names, "Button", "components"), /array/);
    assert.deepEqual(tokens, before);
  }
  assert.throws(() => snapshot({ pages: {} }, names), /array/);
  assert.throws(() => snapshot({ pages: [null] }, names), /stable id/);
  assert.throws(() => snapshot({ pages: [fixture().pages[0], fixture().pages[0]] }, names), /Duplicate page id/);
});
