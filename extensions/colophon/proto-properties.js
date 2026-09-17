/* Structured prototype editing. Mutation callbacks own validation, draft and history. */
(function () {
  "use strict";
  const preferences = new WeakMap();
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const set = (node, key, value) => {
    if (value === "" || value == null) delete node[key];
    else node[key] = value;
  };
  const numeric = (raw) => {
    if (!raw.trim()) return "";
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("Enter a finite number.");
    return value;
  };
  const dimension = (raw) => {
    const value = raw.trim();
    if (!value || value === "hug" || value === "fill") return value;
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
    if (!window.CSS?.supports("width", value)) throw new Error("Enter hug, fill, a pixel number, or a CSS length.");
    return value;
  };

  function render(slot, { node, parent, tokens, theme, componentNames = [], onPreview, onCommit, onCancel }) {
    if (!slot) return;
    slot.replaceChildren();
    const prefs = preferences.get(slot) || { snapped: true };
    preferences.set(slot, prefs);
    const controls = window.PropertyControls.create({ tokens, theme, spacingSnap: () => prefs.snapped });
    const { el, propertyField, propertySelect, spacingCombo, typographyPicker, colorPicker,
      inheritedOptions, alignmentControl, boxEditor, updateBoxValue } = controls;
    if (!node || typeof node !== "object") {
      slot.append(el("div", { class: "properties-empty" }, "Select a layer in the preview or Layers panel to edit its properties."));
      return;
    }
    const commit = (mutator) => onCommit(mutator);
    const fieldCommit = (key) => (value) => commit((selected) => set(selected, key, value));
    // Parsing runs inside the caller's transaction so invalid intermediate input
    // appears in its error surface and can never silently commit a stale preview.
    const gesture = (mutate) => (input, parse = (raw) => raw) => {
      let pending = false;
      let lastValue = input.value;
      let escaped = false;
      const preview = () => {
        escaped = false;
        pending = true;
        lastValue = input.value;
        const raw = input.value;
        const result = onPreview((selected) => mutate(selected, parse(raw)));
        input.setAttribute("aria-invalid", String(result === false));
      };
      const finish = () => {
        if (escaped) return;
        // Programmatic changes and some native color pickers emit only change.
        if (!pending && input.value !== lastValue) preview();
        if (!pending) return;
        pending = false;
        onCommit();
      };
      input.addEventListener("input", preview);
      input.addEventListener("change", finish);
      input.addEventListener("blur", finish);
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        escaped = true;
        pending = false;
        onCancel();
      });
    };
    const fieldGesture = (key) => gesture((selected, value) => set(selected, key, value));
    const inputField = (label, value, mutate, { parse, multiline = false, wide = false, ...attrs } = {}) => {
      const input = el(multiline ? "textarea" : "input", {
        ...(multiline ? { rows: "3" } : { type: "text" }), ...attrs,
      });
      input.value = value ?? "";
      gesture(mutate)(input, parse);
      return propertyField(label, input, { wide });
    };
    const field = (label, key, options = {}) => inputField(label, node[key], (selected, value) => set(selected, key, value), options);
    const section = (title, ...children) => {
      const grid = el("div", { class: "property-grid" }, children);
      const root = el("section", { class: "property-section" }, el("h3", { class: "property-section-title" }, title), grid);
      slot.append(root);
      return { root, grid };
    };
    const check = (label, key, defaultValue = false) => {
      const input = el("input", {
        type: "checkbox", checked: (node[key] ?? defaultValue) ? "checked" : null,
        onchange: (event) => commit((selected) => { selected[key] = event.target.checked; }),
      });
      return el("label", {}, input, label);
    };
    const box = (title, key, { allowAuto = false } = {}) => {
      return boxEditor(title, node[key], (edge, value) => commit((selected) => updateBoxValue(selected, key, edge, value)), {
        allowAuto, gesture: (edge) => gesture((selected, value) => updateBoxValue(selected, key, edge, value)),
      });
    };

    const identity = section("Layer",
      field("Stable ID", "id", { wide: true, parse: (raw) => raw.trim() }));
    if (own(node, "component")) {
      const names = [...new Set([node.component, ...componentNames])].filter(Boolean);
      identity.grid.append(propertySelect("Component", node.component, names.map((name) => [name, name]),
        (event) => commit((selected) => { selected.component = event.target.value; }), { wide: true }));
      const content = section("Instance content");
      const props = node.props && typeof node.props === "object" && !Array.isArray(node.props) ? node.props : {};
      const keys = [...new Set(["children", ...Object.keys(props)])];
      for (const key of keys) {
        const value = props[key];
        if (value != null && !["string", "number", "boolean"].includes(typeof value)) continue;
        const update = (selected, next) => {
          if (!own(selected, "props")) selected.props = {};
          if (next === "") delete selected.props[key];
          else Object.defineProperty(selected.props, key, { value: next, writable: true, enumerable: true, configurable: true });
          if (!Object.keys(selected.props).length) delete selected.props;
        };
        if (typeof value === "boolean") {
          content.grid.append(propertySelect(key, String(value), [["true", "True"], ["false", "False"], ["", "Inherit"]],
            (event) => commit((selected) => update(selected, event.target.value === "" ? "" : event.target.value === "true"))));
        } else {
          const property = inputField(key, value, (selected, next) => {
            if (typeof value === "number") { update(selected, next); return; }
            selected.props ||= {};
            Object.defineProperty(selected.props, key, { value: next, writable: true, enumerable: true, configurable: true });
          }, {
            wide: true, multiline: typeof value !== "number", parse: typeof value === "number" ? numeric : undefined,
            placeholder: own(props, key) ? "" : "Use component default",
          });
          if (own(props, key)) property.append(el("button", {
            type: "button", class: "btn", "aria-label": `Reset ${key} to component default`,
            onclick: () => commit((selected) => update(selected, "")),
          }, "Use default"));
          content.grid.append(property);
        }
      }
      const name = el("input", { type: "text", placeholder: "Property name", "aria-label": "New property name" });
      const value = el("input", { type: "text", placeholder: "Text value", "aria-label": "New property value" });
      content.grid.append(propertyField("New property", name), propertyField("Value", value),
        el("button", { type: "button", class: "btn property-field is-wide",
          onclick: () => commit((selected) => {
            const key = name.value.trim();
            if (!key || ["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Enter a valid property name.");
            selected.props ||= {};
            if (own(selected.props, key)) throw new Error(`Property "${key}" already exists.`);
            selected.props[key] = value.value;
          }),
        }, "Add property"));
      content.root.append(el("div", { class: "property-help" },
        "These values belong to this instance only. Component definitions stay unchanged. Use JSON for object or array props."));
    } else if (own(node, "text")) {
      section("Content", inputField("Text", node.text, (selected, value) => { selected.text = value; }, { multiline: true, wide: true }));
    } else if (own(node, "image")) {
      section("Image",
        inputField("Source", node.image || node.src || "", (selected, value) => { selected.image = value; delete selected.src; }, { wide: true }),
        field("Alternative text", "alt", { wide: true }),
        propertySelect("Fit", node.fit || "", [["", "Default"], ["cover", "Cover"], ["contain", "Contain"], ["fill", "Fill"], ["none", "None"], ["scale-down", "Scale down"]],
          (event) => fieldCommit("fit")(event.target.value)));
    } else if (own(node, "spacer")) {
      section("Spacer", spacingCombo("Size", node.size ?? "", fieldCommit("size"), { gesture: fieldGesture("size") }));
    }

    const layout = section("Layout");
    const title = layout.root.querySelector("h3");
    const toggle = el("button", {
      type: "button", class: `snap-toggle${prefs.snapped ? " is-active" : ""}`,
      "aria-pressed": String(prefs.snapped), title: "Use spacing tokens or custom pixels",
      onclick: () => {
        const snapped = !prefs.snapped;
        prefs.snapped = snapped;
        const result = commit((selected) => {
          if (selected.gap != null) selected.gap = controls.convertSpacingValue(selected.gap, snapped);
          for (const key of ["padding", "margin"]) {
            if (selected[key] != null) selected[key] = controls.convertBoxSpacing(selected[key], snapped);
          }
        });
        if (result === false) prefs.snapped = !snapped;
        toggle.classList.toggle("is-active", prefs.snapped);
        toggle.setAttribute("aria-pressed", String(prefs.snapped));
        toggle.textContent = prefs.snapped ? "Snapped" : "Free";
      },
    }, prefs.snapped ? "Snapped" : "Free");
    const heading = el("div", { class: "property-section-heading" });
    title.replaceWith(heading);
    heading.append(title, toggle);
    if (own(node, "layout")) {
      layout.grid.append(propertySelect("Direction", node.layout,
        [["stack", "Vertical stack"], ["row", "Horizontal row"], ["grid", "Grid"], ["scroll", "Scroll"], ["freeform", "Freeform"], ["none", "None"]],
        (event) => commit((selected) => {
          selected.layout = event.target.value;
          delete selected.direction;
          if (selected.layout !== "grid") delete selected.columns;
          if (["freeform", "none"].includes(selected.layout)) {
            for (const key of ["gap", "align", "justify", "wrap"]) delete selected[key];
          }
          if (selected.layout !== "freeform") {
            for (const child of selected.children || []) {
              if (child && typeof child === "object") delete child.position;
            }
          }
        }), { wide: true }));
      if (!["freeform", "none"].includes(node.layout)) {
        layout.grid.append(spacingCombo("Gap", node.gap ?? "", fieldCommit("gap"), { gesture: fieldGesture("gap") }),
          alignmentControl("Align", "align", node.align || "", [
            ["", "Unset"], ["start", "Start"], ["center", "Center"], ["end", "End"], ["stretch", "Stretch"], ["baseline", "Baseline"],
          ], fieldCommit("align")),
          alignmentControl("Justify", "justify", node.justify || "", [
            ["", "Unset"], ["start", "Start"], ["center", "Center"], ["end", "End"],
            ["space-between", "Space between"], ["space-around", "Space around"], ["space-evenly", "Space evenly"],
          ], fieldCommit("justify")));
      }
      if (node.layout === "grid") layout.grid.append(field("Columns", "columns", { type: "number", min: "1", step: "1", parse: numeric }));
    }
    layout.grid.append(field("Width", "width", { parse: dimension, placeholder: "Hug, fill, or pixels" }),
      field("Height", "height", { parse: dimension, placeholder: "Hug, fill, or pixels" }));
    const checks = [];
    if (own(node, "layout") && ["stack", "row", "scroll"].includes(node.layout)) checks.push(check("Wrap", "wrap", node.layout === "row"));
    if (parent && ["stack", "row", "scroll"].includes(parent.layout) && !node.position) checks.push(check("Grow", "grow"));
    if (checks.length) layout.grid.append(el("div", { class: "property-checks property-field is-wide" }, checks));
    // The image element and spacer have no content box to pad.
    if (!own(node, "image") && !own(node, "spacer")) layout.grid.append(box("Padding", "padding"));
    layout.root.append(el("div", { class: "property-help" }, "Spacing uses design tokens or custom pixels. Dimensions accept hug, fill, pixels, or existing CSS lengths."));

    if (parent?.layout === "freeform") {
      const position = node.position;
      const positionSection = section("Freeform position",
        propertySelect("Position", position?.mode || "", [["", "Flow"], ["absolute", "Absolute"]],
          (event) => commit((selected) => {
            if (event.target.value === "absolute") selected.position = { mode: "absolute", x: position?.x ?? 0, y: position?.y ?? 0 };
            else delete selected.position;
          }), { wide: true }));
      if (position?.mode === "absolute") {
        for (const axis of ["x", "y"]) positionSection.grid.append(inputField(axis.toUpperCase(), position[axis],
          (selected, value) => {
            if (value === "") throw new Error("Enter a coordinate in pixels.");
            selected.position ||= { mode: "absolute", x: 0, y: 0 };
            selected.position[axis] = value;
          }, { type: "number", step: "any", parse: numeric, "data-position-axis": axis }));
      }
      positionSection.root.append(el("div", { class: "property-help" }, "Pixels relative to the direct freeform parent. Drag this layer in the preview to move it."));
    }

    const appearance = node.appearance || {};
    const appearanceSection = section("Appearance overrides");
    const appearanceValue = (key) => appearance[key] || "";
    const updateAppearance = (key) => (selected, value) => {
      selected.appearance ||= {};
      set(selected.appearance, key, value);
      if (!Object.keys(selected.appearance).length) delete selected.appearance;
    };
    const appearanceCommit = (key) => (value) => commit((selected) => updateAppearance(key)(selected, value));
    appearanceSection.grid.append(
      typographyPicker("Text style", appearanceValue("textStyle"), "textStyle", appearanceCommit("textStyle")),
      typographyPicker("Font family", appearanceValue("fontFamily"), "fontFamily", appearanceCommit("fontFamily")));
    for (const [label, key] of [["Text color", "color"], ["Background", "background"], ["Border color", "borderColor"]]) {
      appearanceSection.grid.append(colorPicker(label, appearanceValue(key), appearanceCommit(key), { gesture: gesture(updateAppearance(key)) }));
    }
    appearanceSection.grid.append(propertySelect("Text align", appearanceValue("textAlign"),
      inheritedOptions(["start", "center", "end", "left", "right", "justify"]), (event) => appearanceCommit("textAlign")(event.target.value)));
    for (const [label, key, group] of [["Radius", "radius", "radii"], ["Shadow", "shadow", "shadows"]]) {
      appearanceSection.grid.append(propertySelect(label, appearanceValue(key),
        [...inheritedOptions((tokens?.[group] || []).map((token) => token.name).filter(Boolean)), [window.PropertyControls.NONE, "None"]],
        (event) => appearanceCommit(key)(event.target.value)));
    }
    appearanceSection.root.append(el("div", { class: "property-help" },
      "Inherit removes an override. None is explicit transparency, square corners, or no shadow. Legacy text style and colors remain the defaults."));
    const legacy = [["style", "textStyle", "Text style"], ["color", "color", "Text color"], ["background", "background", "Background"], ["radius", "radius", "Radius"]]
      .filter(([key]) => own(node, key));
    if (legacy.length) {
      const legacySection = section("Legacy defaults");
      for (const [key, kind, label] of legacy) {
        if (kind === "textStyle") legacySection.grid.append(typographyPicker(label, node[key], kind, fieldCommit(key)));
        else if (kind === "radius") legacySection.grid.append(propertySelect(label, node[key],
          [...inheritedOptions((tokens?.radii || []).map((token) => token.name)), [window.PropertyControls.NONE, "None"]],
          (event) => fieldCommit(key)(event.target.value)));
        else legacySection.grid.append(colorPicker(label, node[key], fieldCommit(key), { gesture: fieldGesture(key) }));
      }
    }
    section("Outer spacing", box("Margin", "margin", { allowAuto: true }));
  }
  window.ProtoProperties = { render };
})();
