/* Shared token-backed inspector controls. Consumers own their document and edits. */
(function () {
  "use strict";
  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else if (value != null) node.setAttribute(key, value);
    }
    for (const kid of kids.flat()) node.append(kid?.nodeType ? kid : document.createTextNode(String(kid ?? "")));
    return node;
  };
  const NONE = "$none";
  let floatingPickerEventsReady = false;
  function closePicker(button) { button.closest("details")?.removeAttribute("open"); }
  function closeFloatingPickers(except = null) {
    for (const picker of document.querySelectorAll(".property-picker[open]")) {
      if (picker !== except) picker.removeAttribute("open");
    }
  }
  function closeSpacingMenus(except = null) {
    for (const menu of document.querySelectorAll(".spacing-option-menu.is-open")) {
      if (menu !== except) menu.classList.remove("is-open");
    }
  }
  function positionFloatingMenu(anchorElement, menu) {
    const inspector = anchorElement.closest(".design-inspector, .inspector");
    if (!inspector) return;
    const anchor = anchorElement.getBoundingClientRect();
    const bounds = inspector.getBoundingClientRect();
    const gutter = 8;
    const width = Math.min(300, bounds.width - gutter * 2);
    const left = Math.max(bounds.left + gutter, Math.min(anchor.right - width, bounds.right - width - gutter));
    const below = bounds.bottom - anchor.bottom - gutter;
    const above = anchor.top - bounds.top - gutter;
    const naturalHeight = Math.min(menu.scrollHeight, 360);
    const opensUp = below < Math.min(naturalHeight, 180) && above > below;
    const available = Math.max(96, opensUp ? above : below);
    const height = Math.min(naturalHeight, available);
    Object.assign(menu.style, {
      left: `${left}px`, top: `${opensUp ? anchor.top - height - 4 : anchor.bottom + 4}px`,
      width: `${width}px`, maxHeight: `${available}px`,
    });
    menu.classList.toggle("opens-up", opensUp);
  }
  function floatingEvents() {
    if (floatingPickerEventsReady) return;
    floatingPickerEventsReady = true;
    document.addEventListener("pointerdown", (event) => {
      closeFloatingPickers(event.target.closest?.(".property-picker"));
      closeSpacingMenus(event.target.closest?.(".spacing-combo")?.querySelector(".spacing-option-menu"));
    });
    const close = () => { closeFloatingPickers(); closeSpacingMenus(); };
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
  }
  function makeFloatingPicker(details, menu) {
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      closeFloatingPickers(details);
      requestAnimationFrame(() => {
        if (details.isConnected && details.open) positionFloatingMenu(details.querySelector(":scope > summary"), menu);
      });
    });
    floatingEvents();
  }
  function propertyField(label, control, { wide = false } = {}) {
    const input = control.matches("input, select, textarea, summary") ? control : control.querySelector("input, select, textarea, summary");
    if (input && !input.hasAttribute("aria-label")) input.setAttribute("aria-label", label);
    return el("div", { class: `property-field${wide ? " is-wide" : ""}` }, el("label", {}, label), control);
  }
  function propertySelect(label, value, options, onchange, { wide = false } = {}) {
    const select = el("select", { onchange });
    for (const [optionValue, optionLabel] of options) {
      select.append(el("option", { value: optionValue, selected: optionValue === (value ?? "") ? "selected" : undefined }, optionLabel));
    }
    return propertyField(label, el("div", { class: "property-select" }, select, dropdownChevron()), { wide });
  }
  function dropdownChevron() {
    return el("span", { class: "property-picker-chevron", "aria-hidden": "true" });
  }
  function choicePicker(label, value, choices, onchange, { wide = false, summaryStyle = "" } = {}) {
    const selected = choices.find((choice) => choice.value === value) || choices[0];
    const details = el("details", { class: "property-picker" });
    const summary = el("summary", {},
      el("span", { class: "property-picker-value", style: summaryStyle || selected?.style || "" }, selected?.label || "Select"),
      dropdownChevron());
    const menu = el("div", { class: "property-picker-menu" });
    for (const choice of choices) {
      menu.append(el("button", {
        type: "button", class: `property-picker-option${choice.value === value ? " is-selected" : ""}`, style: choice.style || "",
        onclick: (event) => { closePicker(event.currentTarget); onchange(choice.value); },
      }, choice.preview || choice.label));
    }
    details.append(summary, menu);
    makeFloatingPicker(details, menu);
    return propertyField(label, details, { wide });
  }
  function textStylePreview(style) {
    if (!style?.name) return "";
    return [
      `font-family:var(--text-${style.name}-family,var(--font-${style.role || "body"}))`,
      `font-size:var(--text-${style.name}-size)`, `line-height:var(--text-${style.name}-line-height)`,
      `font-weight:var(--text-${style.name}-weight)`, `letter-spacing:var(--text-${style.name}-tracking,normal)`,
    ].join(";");
  }
  function cssPixels(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|rem)?$/i);
    if (!match) return null;
    const number = Number(match[1]);
    return match[2]?.toLowerCase() === "rem"
      ? number * (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) : number;
  }
  function boxEdgeValue(value, edge) {
    if (typeof value === "string" || typeof value === "number") return value;
    if (!value || typeof value !== "object") return "";
    return value[edge] ?? value[edge === "left" || edge === "right" ? "x" : "y"] ?? "";
  }
  function updateBoxValue(owner, key, edge, next) {
    const current = owner[key];
    if (edge === "all") {
      if (next !== "") owner[key] = next;
      else delete owner[key];
      return;
    }
    const expanded = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      const value = boxEdgeValue(current, side);
      if (value !== "") expanded[side] = value;
    }
    if (next !== "") expanded[edge] = next;
    else delete expanded[edge];
    if (Object.keys(expanded).length) owner[key] = expanded;
    else delete owner[key];
  }
  function inheritedOptions(values, label = (value) => value) {
    return [["", "Inherit / class"], ...values.map((value) => [value, label(value)])];
  }
  function alignmentIcon(type, value) {
    if (!value) return el("span", { class: "layout-reset-icon", "aria-hidden": "true" });
    const icon = el("span", { class: `layout-${type}-icon is-${value}`, "aria-hidden": "true" });
    for (let index = 0; index < 3; index += 1) icon.append(el("i"));
    return icon;
  }
  function alignmentControl(label, type, value, options, onchange) {
    const group = el("div", { class: "layout-icon-group", role: "group", "aria-label": label });
    for (const [optionValue, optionLabel] of options) {
      group.append(el("button", {
        type: "button", class: optionValue === value ? "is-selected" : "", title: optionLabel,
        "aria-label": `${label}: ${optionLabel}`, "aria-pressed": String(optionValue === value),
        onclick: () => onchange(optionValue),
      }, alignmentIcon(type, optionValue)));
    }
    return propertyField(label, group, { wide: true });
  }
  function numberBox(label, input, step, ...children) {
    return el("div", { class: "spacing-combo" }, input,
      el("div", { class: "spacing-stepper" },
        ...[[1, "Increase", "▲"], [-1, "Decrease", "▼"]].map(([direction, action, icon]) => el("button", {
          type: "button", title: `${action} ${label}`, "aria-label": `${action} ${label}`,
          onmousedown: (event) => event.preventDefault(),
          onclick: () => step(direction),
        }, icon))), children);
  }
  function create(options = {}) {
    const read = (key, fallback) => {
      const value = typeof options[key] === "function" ? options[key]() : options[key];
      return value ?? fallback;
    };
    const tokens = () => read("tokens", {});
    const snapped = () => read("spacingSnap", true);
    const colors = () => {
      const value = tokens().colors;
      return Array.isArray(value) ? value : Object.entries(value || {}).map(([name, value]) => ({ name, value }));
    };
    const colorValue = (color) => {
      const theme = read("theme", "light");
      return color?.themes?.[theme] || (theme !== "light" && color?.themes?.light) ||
        color?.value || color?.themes?.light || color?.themes?.dark || color?.themes?.highContrast || "";
    };
    function typographyPicker(label, value, kind, onchange) {
      const inherited = { value: "", label: "Inherit / class", style: "" };
      const choices = kind === "textStyle"
        ? [inherited, ...(tokens().typography?.scale || []).filter((style) => style?.name).map((style) => ({
          value: style.name, label: style.name, style: textStylePreview(style),
          preview: el("span", { class: "type-option" },
            el("span", { class: "type-option-sample", style: textStylePreview(style) }, "Ag"),
            el("span", { class: "type-option-meta" }, el("strong", {}, style.name),
              el("span", {}, `${style.size || "Inherited"} / ${style.lineHeight || "normal"}`))),
        }))]
        : [inherited, ...["display", "body", "mono"].filter((role) => tokens().typography?.[role]?.family).map((role) => ({
          value: role, label: role[0].toUpperCase() + role.slice(1), style: `font-family:var(--font-${role})`,
          preview: el("span", { class: "type-option" },
            el("span", { class: "type-option-sample", style: `font-family:var(--font-${role})` }, "Ag"),
            el("span", { class: "type-option-meta" }, el("strong", {}, role[0].toUpperCase() + role.slice(1)),
              el("span", {}, tokens().typography[role].family))),
        }))];
      return choicePicker(label, value, choices, onchange);
    }
    function appearanceColorValue(value) {
      if (value === NONE) return "transparent";
      if (/^#[0-9a-f]{6}$/i.test(value || "")) return value;
      return colorValue(colors().find((color) => color.name === value)) || "transparent";
    }
    function colorPicker(label, value, onchange, { gesture } = {}) {
      const paletteColors = colors().filter((color) => color?.name);
      const selectedToken = paletteColors.find((color) => color.name === value);
      const selectedLabel = value === NONE ? "None / transparent" : (selectedToken?.name || value);
      const details = el("details", { class: "property-picker color-property-picker" });
      const summary = el("summary", {},
        el("span", { class: "color-picker-summary" },
          el("span", { class: `color-picker-chip${value === NONE ? " is-transparent" : ""}`, style: `background-color:${appearanceColorValue(value)}` }),
          el("span", {}, value ? selectedLabel : "Inherit / class")),
        dropdownChevron());
      const palette = el("div", { class: "color-palette" });
      palette.append(el("button", {
        type: "button", class: `color-palette-token color-palette-none${value === NONE ? " is-selected" : ""}`,
        title: "None / transparent", "aria-label": "None / transparent",
        onclick: (event) => { closePicker(event.currentTarget); onchange(NONE); },
      }, el("span", { class: "color-palette-swatch is-transparent" }), el("span", { class: "color-palette-name" }, "none")));
      for (const color of paletteColors) {
        const preview = colorValue(color);
        palette.append(el("button", {
          type: "button", class: `color-palette-token${value === color.name ? " is-selected" : ""}`,
          title: `${color.name}: ${preview}`, "aria-label": `${color.name}, ${preview}`,
          onclick: (event) => { closePicker(event.currentTarget); onchange(color.name); },
        }, el("span", { class: "color-palette-swatch", style: `background:${preview}` }),
        el("span", { class: "color-palette-name" }, color.name)));
      }
      palette.append(el("button", {
        type: "button", class: `color-palette-inherit${value ? "" : " is-selected"}`,
        onclick: (event) => { closePicker(event.currentTarget); onchange(""); },
      }, "Inherit / class"));
      const customValue = /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#000000";
      const customInput = el("input", {
        type: "color", value: customValue, title: "Choose a custom color",
        "aria-label": `Choose a custom ${label.toLowerCase()}`,
      });
      if (gesture) gesture(customInput, (raw) => raw);
      else customInput.addEventListener("change", (event) => onchange(event.target.value));
      palette.append(el("label", { class: `color-palette-custom${value === customValue ? " is-selected" : ""}` },
        el("span", { class: "spectrum-chip" }), el("span", {}, "Custom"), customInput));
      details.append(summary, palette);
      makeFloatingPicker(details, palette);
      return propertyField(label, details);
    }
    function spacingTokens() {
      const scale = (tokens().spacing?.scale || []).map((token) => ({
        name: String(token.name), value: String(token.value ?? ""), pixels: cssPixels(token.value),
      }));
      if (!scale.some((token) => token.name === "0")) scale.unshift({ name: "0", value: "0px", pixels: 0 });
      return scale;
    }
    function spacingPixels(value) {
      if (typeof value === "number") return value;
      if (value === "0") return 0;
      return spacingTokens().find((token) => token.name === value)?.pixels ?? null;
    }
    function nearestSpacingToken(value) {
      const pixels = spacingPixels(value);
      const candidates = spacingTokens().filter((token) => token.pixels != null);
      if (pixels == null || !candidates.length) return null;
      return candidates.reduce((nearest, token) => Math.abs(token.pixels - pixels) < Math.abs(nearest.pixels - pixels) ? token : nearest);
    }
    function spacingTokenLabel(token) {
      const resolved = token.value || (token.pixels == null ? token.name : `${token.pixels}px`);
      return token.name === "0" ? resolved : `${resolved} · var(--space-${token.name})`;
    }
    function spacingInputValue(value) {
      if (value == null || value === "") return "";
      if (value === "auto") return "auto";
      if (snapped() && typeof value === "string") {
        const token = spacingTokens().find((item) => item.name === value);
        return token ? spacingTokenLabel(token) : value;
      }
      const pixels = spacingPixels(value);
      return pixels == null ? String(value) : `${pixels}px`;
    }
    function parseSpacingInput(value, { allowAuto = false } = {}) {
      const raw = value.trim();
      if (!raw) return "";
      if (allowAuto && raw === "auto") return "auto";
      if (snapped()) {
        const variable = raw.match(/var\(--space-([^)]+)\)/);
        const tokenName = variable?.[1] || raw.split("·", 1)[0].trim();
        if (spacingTokens().some((token) => token.name === tokenName)) return tokenName;
        const nearest = nearestSpacingToken(cssPixels(tokenName));
        if (nearest) return nearest.name;
        throw new Error(`"${raw}" is not a spacing token.`);
      }
      const pixels = cssPixels(raw);
      if (pixels == null || pixels < 0) throw new Error("Enter a non-negative pixel value.");
      return pixels;
    }
    function stepSpacingValue(value, direction) {
      if (!snapped()) return Math.max(0, (spacingPixels(value) ?? 0) + direction);
      const scale = spacingTokens();
      let index = scale.findIndex((token) => token.name === value);
      if (index < 0) {
        const nearest = nearestSpacingToken(value);
        index = nearest ? scale.indexOf(nearest) : (direction > 0 ? -1 : 1);
      }
      return scale[Math.max(0, Math.min(scale.length - 1, index + direction))].name;
    }
    function spacingCombo(label, value, onchange, { allowAuto = false, wide = false, gesture } = {}) {
      floatingEvents();
      const menu = el("div", { class: "spacing-option-menu" });
      const submitInput = (raw) => {
        try { options.onError?.(""); onchange(parseSpacingInput(raw, { allowAuto })); }
        catch (error) { options.onError?.(error.message || String(error)); }
      };
      const closeMenu = () => menu.classList.remove("is-open");
      const openMenu = () => {
        closeSpacingMenus(menu); closeFloatingPickers(); menu.classList.add("is-open");
        requestAnimationFrame(() => { if (input.isConnected) positionFloatingMenu(input, menu); });
      };
      const input = el("input", {
        type: "text", value: spacingInputValue(value), placeholder: "Unset", onclick: openMenu, onfocus: openMenu,
        onkeydown: (event) => {
          if (event.key === "Escape") { closeMenu(); return; }
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          onchange(stepSpacingValue(value, event.key === "ArrowUp" ? 1 : -1));
        },
      });
      if (gesture) gesture(input, (raw) => parseSpacingInput(raw, { allowAuto }));
      else input.addEventListener("change", (event) => submitInput(event.target.value));
      for (const token of spacingTokens()) {
        const next = snapped() ? token.name : (token.pixels ?? cssPixels(token.value));
        if (next == null) continue;
        menu.append(el("button", {
          type: "button", class: value === next ? "is-selected" : "",
          onclick: () => { closeMenu(); onchange(next); },
        }, el("span", { class: "spacing-option-value" }, token.value || `${token.pixels}px`),
        token.name === "0" ? "" : el("span", { class: "spacing-option-token" }, `var(--space-${token.name})`)));
      }
      if (allowAuto) menu.append(el("button", {
        type: "button", class: value === "auto" ? "is-selected" : "",
        onclick: () => { closeMenu(); onchange("auto"); },
      }, el("span", { class: "spacing-option-value" }, "auto")));
      const control = numberBox(label, input, (direction) => onchange(stepSpacingValue(value, direction)), menu);
      return propertyField(label, control, { wide });
    }
    function pixelNumberbox(label, value, onchange, { gesture } = {}) {
      const pixelsFromInput = (raw) => {
        const match = raw.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(?:px)?$/i);
        return match ? Number(match[1]) : NaN;
      };
      const parse = (raw) => {
        if (!raw.trim()) return "";
        const pixels = pixelsFromInput(raw);
        if (!Number.isFinite(pixels) || pixels < 0) {
          throw new Error("Enter a non-negative finite pixel number.");
        }
        return pixels;
      };
      const input = el("input", {
        type: "text", inputmode: "decimal", value: value ?? "", placeholder: "Inherit / class",
        onkeydown: (event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          step(event.key === "ArrowUp" ? 1 : -1);
        },
      });
      if (gesture) gesture(input, parse);
      else input.addEventListener("change", () => {
        try {
          const next = parse(input.value);
          input.setAttribute("aria-invalid", "false");
          options.onError?.("");
          onchange(next);
        } catch (error) {
          input.setAttribute("aria-invalid", "true");
          if (!options.onError) throw error;
          options.onError(error.message || String(error));
        }
      });
      const step = (direction) => {
        const raw = input.value.trim();
        const current = raw ? pixelsFromInput(raw) : 0;
        if (Number.isFinite(current) && current >= 0) {
          input.value = String(Math.max(0, current + direction));
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      return propertyField(label, numberBox(label, input, step));
    }
    function convertSpacingValue(value, snap) {
      if (value == null || value === "auto") return value;
      return snap ? nearestSpacingToken(value)?.name ?? value : spacingPixels(value) ?? value;
    }
    function convertBoxSpacing(value, snap) {
      if (value == null || typeof value !== "object") return convertSpacingValue(value, snap);
      return Object.fromEntries(Object.entries(value).map(([edge, spacing]) => [edge, convertSpacingValue(spacing, snap)]));
    }
    function boxEditor(title, current, onchange, { allowAuto = false, gesture } = {}) {
      const grid = el("div", { class: "box-editor" });
      for (const edge of ["all", "top", "right", "bottom", "left"]) {
        const label = edge[0].toUpperCase() + edge.slice(1);
        const value = edge === "all" ? (typeof current === "object" ? "" : current ?? "") : boxEdgeValue(current, edge);
        const control = spacingCombo(label, value, (next) => onchange(edge, next), {
          allowAuto, wide: edge === "all", gesture: gesture?.(edge),
        });
        control.querySelector("input").setAttribute("aria-label", `${title} ${label}`);
        grid.append(control);
      }
      return propertyField(title, grid, { wide: true });
    }
    return {
      el, propertyField, propertySelect, choicePicker, typographyPicker, colorPicker, appearanceColorValue,
      spacingCombo, pixelNumberbox, spacingTokens, spacingPixels, spacingInputValue, parseSpacingInput, stepSpacingValue,
      nearestSpacingToken, convertSpacingValue, convertBoxSpacing, cssPixels, boxEdgeValue, updateBoxValue, boxEditor,
      inheritedOptions, alignmentControl, closeFloatingPickers, closeSpacingMenus,
    };
  }
  window.PropertyControls = { create, NONE };
})();
