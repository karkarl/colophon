import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { expandInstance, parseComponents, validateComponentsDoc } from "./componentsio.mjs";

const tokens = { colors: [{ name: "ink" }, { name: "accent" }], radii: [{ name: "md" }] };
function fixture() {
  return { meta: { version: 3 }, components: [
    { name: "Trigger", root: { id: "trigger", el: "button",
      states: { hover: { color: "accent" }, disabled: { color: "ink" } },
      on: { click: { open: "Options" } },
      control: { chrome: "none", focus: { kind: "outline", color: "accent" } },
    } },
    { name: "Options", root: { id: "options", el: "div" } },
    { name: "Instance", root: { id: "instance", component: "Trigger",
      states: { hover: { background: "$none" }, pressed: { color: "#abcdef" } },
      control: { focus: { kind: "underline", color: "ink" } },
    } },
  ] };
}

test("states and control metadata validate and merge through component instances", () => {
  const doc = fixture();
  assert.deepEqual(validateComponentsDoc(doc, { tokens }).errors, []);
  const spec = expandInstance(doc, "Instance");
  assert.deepEqual(spec.states, {
    hover: { color: "var(--color-accent)", "background-color": "transparent" },
    pressed: { color: "#abcdef" },
    disabled: { color: "var(--color-ink)" },
  });
  assert.deepEqual(spec.control, { chrome: "none", focus: { kind: "underline", color: "ink" } });
  assert.deepEqual(spec.on, { click: { open: "Options" } });
  assert.equal(spec.source.nodeId, "instance");
  doc.components[2].root.on = { click: { open: "Instance" } };
  assert.equal(expandInstance(doc, "Instance").on.click.open, "Instance");
});

test("invalid state shapes, appearance values and action targets produce precise errors", () => {
  const cases = [
    ["states", [], /\.states: must be an object/],
    ["states", { focus: {} }, /unknown state "focus"/],
    ["states", { hover: null }, /\.states.hover: must be an appearance object/],
    ["states", { hover: { opacity: 0.5 } }, /\.states.hover: unknown property "opacity"/],
    ["states", { hover: { color: "missing" } }, /\.states.hover.color: references unknown colors token/],
    ["states", { hover: { color: "red()" } }, /\.states.hover.color: must be a token name/],
    ["on", {}, /\.on: expected/],
    ["on", { tap: { open: "Options" } }, /\.on: expected/],
    ["on", { click: { open: "options" } }, /\.on: expected/],
    ["on", { click: { open: "{target}" } }, /\.on: expected/],
    ["on", { click: { open: "Options", close: true } }, /\.on: expected/],
    ["on", { click: [] }, /\.on: expected/],
  ];
  for (const [key, value, pattern] of cases) {
    const doc = fixture();
    doc.components[0].root[key] = value;
    assert.match(validateComponentsDoc(doc, { tokens }).errors.join("\n"), pattern);
  }
});

test("control resets are opt-in, restricted, and require token-bound focus cues", () => {
  for (const control of [
    [], { chrome: "all" }, { chrome: "none" }, { outline: "none" },
    { focus: { kind: "none", color: "accent" } },
    { focus: { kind: "outline", color: "#abcdef" } },
    { focus: { kind: "outline", color: "$none" } },
    { focus: { kind: "outline", color: "missing" } },
    { focus: { kind: "outline", color: "ink", width: 2 } },
  ]) {
    const doc = fixture();
    doc.components[0].root.control = control;
    assert.equal(validateComponentsDoc(doc, { tokens }).ok, false, JSON.stringify(control));
  }
  for (const [el, attrs, ok] of [
    ["input", { type: "text" }, true], ["textarea", {}, true],
    ["div", { contenteditable: "plaintext-only" }, true],
    ["input", { type: "radio" }, false], ["select", {}, false], ["div", {}, false],
  ]) {
    const doc = fixture();
    Object.assign(doc.components[0].root, { el, attrs });
    assert.equal(validateComponentsDoc(doc, { tokens }).ok, ok, el + JSON.stringify(attrs));
  }
});

test("classic runtime expansion matches ESM, including metadata and legacy samples", async () => {
  const context = { window: {} };
  vm.runInNewContext(await readFile(new URL("./shape-geometry.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(await readFile(new URL("./components-runtime.js", import.meta.url), "utf8"), context);
  const sample = parseComponents(await readFile(new URL("./sample/components.jsonc", import.meta.url), "utf8"));
  const design = JSON.parse(await readFile(new URL("./sample/design.json", import.meta.url), "utf8"));
  assert.deepEqual(validateComponentsDoc(sample, { tokens: design }).errors, []);
  for (const doc of [fixture(), sample, { components: [{ name: "Old", root: { el: "span", children: ["old"] } }] }]) {
    for (const component of doc.components) {
      assert.deepEqual(JSON.parse(JSON.stringify(context.window.DSComp.expandInstance(doc, component.name))), expandInstance(doc, component.name));
    }
  }
  const old = expandInstance({ components: [{ name: "Old", root: { el: "span" } }] }, "Old");
  for (const key of ["states", "control", "on"]) assert.equal(Object.hasOwn(old, key), false);
});

test("control eligibility uses resolved defaults and props through reference chains", () => {
  const control = { chrome: "none", focus: { kind: "outline", color: "accent" } };
  const doc = { meta: { version: 3 }, components: [
    { name: "Input", props: { kind: "text" }, root: { id: "input", el: "input", attrs: { type: "{kind}" }, control } },
    { name: "Alias", props: { kind: "email" }, root: { id: "alias", component: "Input", props: { kind: "{kind}" } } },
    { name: "Form", props: { type: "password" }, root: { id: "form", el: "div", children: [
      { id: "field", component: "Alias", props: { kind: "{type}" } },
    ] } },
  ] };
  assert.deepEqual(validateComponentsDoc(doc, { tokens }).errors, []);
  assert.equal(expandInstance(doc, "Form").children[0].attrs.type, "password");
  for (const kind of ["checkbox", "radio", "color", "hidden", "{missing}"]) {
    doc.components[2].props.type = kind;
    assert.match(validateComponentsDoc(doc, { tokens }).errors.join("\n"), /Form\.root\.children\[0\]\.control: only buttons/);
  }
  doc.components[2].props.type = "search";
  delete doc.components[0].root.control;
  doc.components[1].root.control = control;
  assert.deepEqual(validateComponentsDoc(doc, { tokens }).errors, []);
});

test("editable control eligibility uses resolved contenteditable props", () => {
  const doc = { components: [
    { name: "Editor", props: { editable: true }, root: { el: "div", attrs: { contenteditable: "{editable}" },
      control: { chrome: "none", focus: { kind: "underline", color: "accent" } } } },
    { name: "Instance", root: { component: "Editor", props: { editable: "plaintext-only" } } },
  ] };
  assert.deepEqual(validateComponentsDoc(doc, { tokens }).errors, []);
  doc.components[1].root.props.editable = false;
  assert.match(validateComponentsDoc(doc, { tokens }).errors.join("\n"), /Instance\.root\.control: only buttons/);
});

test("SVG subtrees reject interaction metadata on roots, descendants, and references", () => {
  for (const metadata of [
    { states: { hover: { color: "accent" } } },
    { on: { click: { open: "Panel" } } },
    { control: { focus: { kind: "outline", color: "accent" } } },
    { state: { checked: false } },
    { geometry: { translateX: 20 } },
    { transitions: [] },
  ]) {
    for (const root of [
      { el: "svg", ...metadata },
      { el: "svg", children: [{ el: "g", children: [{ el: "path", ...metadata }] }] },
      { el: "svg", children: [{ component: "Button", ...metadata }] },
      { component: "Icon", ...metadata },
    ]) {
      const doc = { components: [
        { name: "Trigger", root },
        { name: "Panel", root: { el: "div" } },
        { name: "Button", root: { el: "button" } },
        { name: "Icon", root: { el: "svg" } },
      ] };
      const key = Object.keys(metadata)[0];
      const errors = validateComponentsDoc(doc, { tokens }).errors;
      assert.ok(errors.some((error) => error.startsWith("Trigger.root") && error.endsWith(`.${key}: interaction metadata is not supported in SVG subtrees.`)), errors.join("\n"));
    }
  }
  const doc = { components: [
    { name: "IconButton", root: { el: "button", on: { click: { open: "Panel" } }, children: [{ el: "svg", children: [{ el: "path" }] }] } },
    { name: "Panel", root: { el: "div" } },
  ] };
  assert.deepEqual(validateComponentsDoc(doc, { tokens }).errors, []);
  doc.components.push({ name: "Container", root: { el: "svg", children: [{ component: "IconButton" }] } });
  assert.match(validateComponentsDoc(doc, { tokens }).errors.join("\n"), /Container\.root\.children\[0\]\.on: interaction metadata is not supported in SVG subtrees/);
});

function toggleFixture() {
  return { components: [
    { name: "Toggle", root: { el: "button", state: { checked: false }, on: { click: { toggle: "checked" } },
      children: [{ el: "span", geometry: { width: 12, height: 12, translateX: 0 },
        transitions: [{ properties: ["width", "height"], duration: 83, easing: [0, 0, 0, 1] }],
        states: { pressed: { geometry: { width: 17, height: 14 } } },
        when: [
          { state: { checked: true }, style: { geometry: { translateX: 20 }, background: "accent" } },
          { state: { checked: false }, interaction: "hover", style: { geometry: { width: 14 } } },
        ],
      }],
    } },
    { name: "On", root: { component: "Toggle", state: { checked: true },
      when: [{ state: { checked: true }, interaction: "disabled", style: { color: "ink" } }],
    } },
  ] };
}

test("boolean defaults, conditional geometry and explicit motion round-trip in both renderers", async () => {
  const doc = toggleFixture();
  const before = JSON.stringify(doc);
  assert.deepEqual(validateComponentsDoc(doc, { tokens }).errors, []);
  const scope = { window: {} };
  vm.runInNewContext(await readFile(new URL("./shape-geometry.js", import.meta.url), "utf8"), scope);
  vm.runInNewContext(await readFile(new URL("./components-runtime.js", import.meta.url), "utf8"), scope);
  for (const name of ["Toggle", "On"]) {
    const spec = expandInstance(doc, name);
    assert.deepEqual(JSON.parse(JSON.stringify(scope.window.DSComp.expandInstance(doc, name))), spec);
    assert.equal(spec.state.checked, name === "On");
    assert.equal(spec.children[0].style.transition, "width 83ms cubic-bezier(0,0,0,1), height 83ms cubic-bezier(0,0,0,1)");
    assert.deepEqual(spec.children[0].when[0].style, { "background-color": "var(--color-accent)", translate: "20px 0px" });
    assert.deepEqual(spec.children[0].states.pressed, { width: "17px", height: "14px" });
  }
  assert.equal(JSON.stringify(doc), before);
});

test("invalid state, geometry, conditional and transition contracts are rejected", () => {
  for (const [key, value, pattern] of [
    ["state", {}, /state: must be a non-empty object/],
    ["state", { checked: "false" }, /state.checked: requires a literal boolean/],
    ["state", { "bad-name": false }, /state.bad-name/],
    ["state", { other: true }, /undeclared boolean state "checked"/],
    ["on", { click: { toggle: "{checked}" } }, /\.on: expected/],
    ["on", { click: { toggle: "checked", open: "On" } }, /\.on: expected/],
    ["on", { click: { toggle: "missing" } }, /on.click.toggle: references undeclared/],
    ["geometry", { width: -1 }, /geometry.width/],
    ["geometry", { height: Infinity }, /geometry.height/],
    ["geometry", { translateX: "20px" }, /geometry.translateX/],
    ["geometry", { transform: "translateX(20px)" }, /geometry: unknown property/],
    ["when", {}, /when: must be an array/],
    ["when", [{ state: { missing: true }, style: {} }], /when\[0\].state: references undeclared/],
    ["when", [{ state: { checked: 1 }, style: {} }], /requires a literal boolean/],
    ["when", [{ state: { checked: true }, interaction: "focus", style: {} }], /unknown interaction state/],
    ["when", [{ state: { checked: true }, style: { geometry: { width: -2 } } }], /when\[0\].style.geometry.width/],
    ["when", [{ state: { checked: true }, style: { background: "missing" } }], /unknown colors token/],
    ["when", [{ state: { checked: true }, style: {}, script: "alert(1)" }], /unknown condition field/],
    ["transitions", "all .1s", /transitions: must be an array/],
    ["transitions", [{ properties: ["all"], duration: 83, easing: "linear" }], /unsupported or duplicate property/],
    ["transitions", [{ properties: ["width", "width"], duration: 83, easing: "linear" }], /duplicate property/],
    ["transitions", [{ properties: ["width"], duration: -1, easing: "linear" }], /duration/],
    ["transitions", [{ properties: ["width"], duration: 83, easing: [2, 0, 0, 1] }], /easing/],
    ["transitions", [{ properties: ["width"], duration: 83, easing: "var(--motion)" }], /easing/],
  ]) {
    const doc = toggleFixture();
    doc.components[0].root[key] = value;
    assert.match(validateComponentsDoc(doc, { tokens }).errors.join("\n"), pattern, key + JSON.stringify(value));
  }
  for (const el of ["input", "textarea", "a"]) {
    const doc = toggleFixture();
    doc.components[0].root.el = el;
    assert.match(validateComponentsDoc(doc, { tokens }).errors.join("\n"), /on.click.toggle: use a button/);
  }
  const doc = toggleFixture();
  doc.components[0].root.children[0].state = { own: false };
  assert.match(validateComponentsDoc(doc, { tokens }).errors.join("\n"), /undeclared boolean state "checked"/, "nested declarations start an independent scope");
});

test("the repository and bundled switch use identical declarative platform geometry", async () => {
  const sample = parseComponents(await readFile(new URL("./sample/components.jsonc", import.meta.url), "utf8"));
  const repo = parseComponents(await readFile(new URL("../../.agents/design/components.jsonc", import.meta.url), "utf8"));
  const from = (doc) => doc.components.find((component) => component.name === "ToggleSwitch");
  assert.deepEqual(from(repo), from(sample));
  const root = from(sample).root;
  assert.deepEqual(root.state, { checked: false });
  const carrier = root.children[0], thumb = carrier.children[0];
  assert.equal(carrier.when[0].style.geometry.translateX, 20);
  assert.deepEqual(carrier.transitions, [{ properties: ["translate"], duration: 367, easing: [0.1, 0.9, 0.2, 1] }]);
  assert.deepEqual(thumb.layout, { width: 12, height: 12 });
  assert.deepEqual(thumb.states.hover.geometry, { width: 14, height: 14 });
  assert.deepEqual(thumb.states.pressed.geometry, { width: 17, height: 14 });
  assert.equal(thumb.transitions[0].duration, 83);
  assert.equal(thumb.states.disabled.transitions[0].duration, 250);
});
