import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  appearanceStyle,
  autoLayoutStyle,
  duplicateComponentNode,
  expandInstance,
  findComponentNodePath,
  moveComponentNode,
  parseComponents,
  removeComponentNode,
  validateComponentsDoc,
} from "./componentsio.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("v1 components remain valid without stable node IDs", () => {
  const doc = {
    meta: { version: 1 },
    components: [{ name: "Notice", root: { el: "p", children: ["Hello"] } }],
  };
  assert.equal(validateComponentsDoc(doc).ok, true);
});

test("v2 requires unique stable IDs and validates Auto Layout fields", () => {
  const doc = {
    meta: { version: 2 },
    components: [{
      name: "Broken",
      root: {
        id: "same",
        el: "div",
        layout: { mode: "diagonal", columns: 0, mystery: true },
        children: [
          { id: "same", el: "span", margin: { top: -12 } },
          { el: "span" },
        ],
      },
    }],
  };
  const result = validateComponentsDoc(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /duplicate node id "same"/);
  assert.match(result.errors.join("\n"), /missing a stable string "id"/);
  assert.match(result.errors.join("\n"), /layout\.mode/);
  assert.match(result.errors.join("\n"), /layout\.columns/);
  assert.match(result.errors.join("\n"), /unknown property "mystery"/);
  assert.match(result.errors.join("\n"), /margin\.top/);
});

test("v3 supports relational freeform layout with fixed dimensions", () => {
  const doc = {
    meta: { version: 3 },
    components: [{
      name: "Board",
      root: {
        id: "board",
        el: "section",
        layout: { mode: "freeform", width: 320, height: 200 },
        children: [{
          id: "card",
          el: "article",
          position: { mode: "absolute", x: 24, y: -8 },
          layout: { width: 120, height: 80 },
        }],
      },
    }],
  };
  assert.equal(validateComponentsDoc(doc).ok, true);
  assert.deepEqual(autoLayoutStyle(doc.components[0].root), {
    display: "block",
    position: "relative",
    width: "320px",
    height: "200px",
  });
  assert.deepEqual(autoLayoutStyle(doc.components[0].root.children[0]), {
    width: "120px",
    height: "80px",
    position: "absolute",
    left: "24px",
    top: "-8px",
  });
});

test("freeform positioning is versioned and parent-relative", () => {
  const node = {
    id: "card",
    el: "article",
    position: { mode: "absolute", x: 12, y: 16 },
    layout: { width: 120 },
  };
  const v2 = {
    meta: { version: 2 },
    components: [{ name: "Old", root: { id: "root", el: "div", children: [structuredClone(node)] } }],
  };
  const v2Errors = validateComponentsDoc(v2).errors.join("\n");
  assert.match(v2Errors, /position: requires components\.jsonc v3/);
  assert.match(v2Errors, /layout\.width: must be fill or hug/);

  const v3 = {
    meta: { version: 3 },
    components: [{ name: "Broken", root: { id: "root", el: "div", children: [structuredClone(node)] } }],
  };
  assert.match(validateComponentsDoc(v3).errors.join("\n"), /direct children of a freeform layout/);
  v3.components[0].root.layout = { mode: "freeform" };
  v3.components[0].root.children[0].position.x = Infinity;
  assert.match(validateComponentsDoc(v3).errors.join("\n"), /position\.x: must be a finite pixel number/);
});

test("Auto Layout produces token-bound CSS", () => {
  assert.deepEqual(autoLayoutStyle({
    layout: {
      mode: "horizontal",
      gap: "3",
      padding: { x: "5", top: "2" },
      align: "center",
      justify: "space-between",
      wrap: true,
      grow: true,
      width: "fill",
      height: "hug",
    },
    margin: { y: "1", left: "auto" },
  }), {
    display: "flex",
    "flex-direction": "row",
    gap: "var(--space-3)",
    "padding-top": "var(--space-2)",
    "padding-right": "var(--space-5)",
    "padding-left": "var(--space-5)",
    "align-items": "center",
    "justify-content": "space-between",
    "flex-wrap": "wrap",
    "flex-grow": "1",
    "min-width": "0",
    "min-height": "0",
    width: "100%",
    height: "fit-content",
    "margin-top": "var(--space-1)",
    "margin-bottom": "var(--space-1)",
    "margin-left": "auto",
  });
});

test("Auto Layout accepts unsnapped pixel spacing", () => {
  const doc = {
    meta: { version: 2 },
    components: [{
      name: "Free spacing",
      root: {
        id: "free-root",
        el: "div",
        layout: { mode: "vertical", gap: 10, padding: { x: 6.5, top: 3 } },
        margin: { bottom: 7 },
      },
    }],
  };
  assert.equal(validateComponentsDoc(doc).ok, true);
  assert.deepEqual(autoLayoutStyle(doc.components[0].root), {
    display: "flex",
    "flex-direction": "column",
    gap: "10px",
    "padding-top": "3px",
    "padding-right": "6.5px",
    "padding-left": "6.5px",
    "margin-bottom": "7px",
  });
  doc.components[0].root.layout.gap = -1;
  assert.match(validateComponentsDoc(doc).errors.join("\n"), /non-negative pixel number/);
});

test("appearance overrides produce token-bound CSS while omitted values inherit", () => {
  assert.deepEqual(appearanceStyle({}), {});
  assert.deepEqual(appearanceStyle({
    appearance: {
      textStyle: "heading",
      fontFamily: "display",
      color: "ink",
      background: "surface",
      borderColor: "line",
      radius: "lg",
      shadow: "sm",
      textAlign: "center",
    },
  }), {
    "font-family": "var(--font-display)",
    "font-size": "var(--text-heading-size)",
    "line-height": "var(--text-heading-line-height)",
    "font-weight": "var(--text-heading-weight)",
    "letter-spacing": "var(--text-heading-tracking, normal)",
    color: "var(--color-ink)",
    "background-color": "var(--color-surface)",
    "border-color": "var(--color-line)",
    "border-radius": "var(--radius-lg)",
    "box-shadow": "var(--shadow-sm)",
    "text-align": "center",
  });
});

test("border thickness validates finite non-negative pixels in base and state overrides", () => {
  const root = { el: "div", appearance: {}, states: { hover: {} } };
  const doc = { components: [{ name: "Border", root }] };
  for (const borderWidth of [0, 0.5, 1, 4, 100]) {
    root.appearance.borderWidth = borderWidth;
    root.states.hover.borderWidth = borderWidth;
    assert.equal(validateComponentsDoc(doc).ok, true);
    assert.deepEqual(appearanceStyle(root), { "border-width": `${borderWidth}px`, "border-style": "solid" });
    assert.deepEqual(expandInstance(doc, "Border").states.hover, appearanceStyle(root));
  }
  for (const borderWidth of [-1, NaN, Infinity, -Infinity, "2", "2px", "$none", null, true, {}]) {
    root.appearance.borderWidth = borderWidth;
    root.states.hover.borderWidth = borderWidth;
    const { errors } = validateComponentsDoc(doc);
    assert.match(errors.join("\n"), /appearance\.borderWidth: must be a non-negative finite pixel number/);
    assert.match(errors.join("\n"), /states\.hover\.borderWidth: must be a non-negative finite pixel number/);
  }
});

test("appearance overrides support explicit none values", () => {
  assert.deepEqual(appearanceStyle({
    appearance: {
      color: "$none",
      background: "$none",
      borderColor: "$none",
      radius: "$none",
      shadow: "$none",
    },
  }), {
    color: "transparent",
    "background-color": "transparent",
    "border-color": "transparent",
    "border-radius": "0",
    "box-shadow": "none",
  });
});

test("appearance overrides validate against design tokens", () => {
  const tokens = {
    colors: [{ name: "ink" }, { name: "transparent" }],
    typography: {
      body: { family: "system-ui" },
      scale: [{ name: "body", role: "body", size: "16px" }],
    },
    radii: [{ name: "md" }, { name: "none" }],
    shadows: [{ name: "sm" }, { name: "none" }],
  };
  const doc = {
    meta: { version: 2 },
    components: [{
      name: "Text",
      root: {
        id: "text",
        el: "p",
        appearance: { color: "missing", textStyle: "body", fontFamily: "body", radius: "md", shadow: "sm" },
      },
    }],
  };
  const result = validateComponentsDoc(doc, { tokens });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /unknown colors token "missing"/);
  doc.components[0].root.appearance.color = "ink";
  assert.equal(validateComponentsDoc(doc, { tokens }).ok, true);
  doc.components[0].root.appearance.color = "#2f81f7";
  assert.equal(validateComponentsDoc(doc, { tokens }).ok, true);
  assert.equal(appearanceStyle(doc.components[0].root).color, "#2f81f7");
  doc.components[0].root.appearance = { color: "$none", background: "$none", borderColor: "$none", radius: "$none", shadow: "$none" };
  assert.equal(validateComponentsDoc(doc, { tokens }).ok, true);
  doc.components[0].root.appearance = { color: "transparent", background: "transparent", borderColor: "transparent", radius: "none", shadow: "none" };
  assert.equal(validateComponentsDoc(doc, { tokens }).ok, true);
  assert.deepEqual(appearanceStyle(doc.components[0].root), {
    color: "var(--color-transparent)",
    "background-color": "var(--color-transparent)",
    "border-color": "var(--color-transparent)",
    "border-radius": "var(--radius-none)",
    "box-shadow": "var(--shadow-none)",
  });
  doc.components[0].root.appearance.fontFamily = "$none";
  assert.match(validateComponentsDoc(doc, { tokens }).errors.join("\n"), /appearance\.fontFamily: must be display, body, or mono/);
  delete doc.components[0].root.appearance.fontFamily;
  doc.components[0].root.appearance.color = "rgb(47, 129, 247)";
  assert.match(validateComponentsDoc(doc, { tokens }).errors.join("\n"), /must be a token name/);
});

test("component references preserve exact source paths and apply instance layout", () => {
  const doc = {
    meta: { version: 2 },
    components: [
      {
        name: "Base",
        root: {
          id: "base-root",
          el: "div",
          layout: { mode: "vertical", gap: "2" },
          children: [{ id: "base-label", el: "span", children: ["Label"] }],
        },
      },
      {
        name: "Wrapper",
        root: {
          id: "wrapper-root",
          el: "section",
          children: [{
            id: "base-instance",
            component: "Base",
            layout: { grow: true },
            margin: { top: "3" },
            appearance: { color: "accent" },
          }],
        },
      },
    ],
  };
  const spec = expandInstance(doc, "Wrapper");
  const instance = spec.children[0];
  assert.deepEqual(instance.source, {
    component: "Wrapper",
    path: ["components", 1, "root", "children", 0],
    nodeId: "base-instance",
  });
  assert.equal(instance.style.display, "flex");
  assert.equal(instance.style["flex-grow"], "1");
  assert.equal(instance.style["margin-top"], "var(--space-3)");
  assert.equal(instance.style.color, "var(--color-accent)");
  assert.deepEqual(instance.children[0].source, {
    component: "Base",
    path: ["components", 0, "root", "children", 0],
    nodeId: "base-label",
  });
});

test("component layers can be reordered, reparented, duplicated, and removed", () => {
  const doc = {
    meta: { version: 2 },
    components: [{
      name: "Stack",
      root: {
        id: "root",
        el: "section",
        children: [
          { id: "group", el: "div", children: [{ id: "nested", el: "span" }] },
          { id: "action", el: "button" },
        ],
      },
    }],
  };
  const actionPath = ["components", 0, "root", "children", 1];
  const groupPath = ["components", 0, "root", "children", 0];
  assert.deepEqual(moveComponentNode(doc, actionPath, groupPath, "inside"), [
    "components", 0, "root", "children", 0, "children", 1,
  ]);
  assert.equal(doc.components[0].root.children[0].children[1].id, "action");

  const copyPath = duplicateComponentNode(doc, groupPath);
  assert.equal(doc.components[0].root.children[1].id, "group-copy");
  assert.equal(doc.components[0].root.children[1].children[0].id, "nested-copy");
  assert.deepEqual(copyPath, ["components", 0, "root", "children", 1]);

  const selectedAfterDelete = removeComponentNode(doc, copyPath);
  assert.deepEqual(selectedAfterDelete, ["components", 0, "root"]);
  assert.equal(findComponentNodePath(doc, 0, "group-copy"), null);
  assert.equal(validateComponentsDoc(doc).ok, true);
});

test("component layer moves reject roots, cycles, and cross-component drops", () => {
  const doc = {
    meta: { version: 2 },
    components: [
      { name: "One", root: { id: "one", el: "div", children: [{ id: "child", el: "div", children: [] }] } },
      { name: "Two", root: { id: "two", el: "div", children: [{ id: "other", el: "span" }] } },
    ],
  };
  assert.throws(
    () => moveComponentNode(doc, ["components", 0, "root"], ["components", 0, "root", "children", 0], "before"),
    /roots cannot be moved/,
  );
  assert.throws(
    () => moveComponentNode(doc, ["components", 0, "root", "children", 0], ["components", 0, "root", "children", 0], "inside"),
    /cannot move into itself/,
  );
  assert.throws(
    () => moveComponentNode(doc, ["components", 0, "root", "children", 0], ["components", 1, "root"], "inside"),
    /same component/,
  );
});

test("bundled sample is valid v3 hybrid layout", async () => {
  const raw = await fs.readFile(path.join(here, "sample", "components.jsonc"), "utf8");
  const doc = parseComponents(raw);
  const result = validateComponentsDoc(doc);
  assert.equal(doc.meta.version, 3);
  const example = doc.components.find((component) => component.name === "ExampleScreen");
  const board = example.root.children.find((node) => node.id === "example-screen-grid");
  assert.equal(board.layout.mode, "freeform");
  assert.equal(board.children.every((node) => node.position?.mode === "absolute"), true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});
