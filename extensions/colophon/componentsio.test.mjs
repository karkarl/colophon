import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  autoLayoutStyle,
  expandInstance,
  parseComponents,
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
          { id: "same", el: "span", margin: { top: 12 } },
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
  assert.deepEqual(instance.children[0].source, {
    component: "Base",
    path: ["components", 0, "root", "children", 0],
    nodeId: "base-label",
  });
});

test("bundled sample is valid v2 Auto Layout", async () => {
  const raw = await fs.readFile(path.join(here, "sample", "components.jsonc"), "utf8");
  const doc = parseComponents(raw);
  const result = validateComponentsDoc(doc);
  assert.equal(doc.meta.version, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});
