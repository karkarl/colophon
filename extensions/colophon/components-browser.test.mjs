import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { parseComponents } from "./componentsio.mjs";
import { renderShell } from "./renderer.mjs";
import { renderProtoShell } from "./proto-renderer.mjs";
import { buildPrototypeExportHtml } from "./prototypeexport.mjs";
import { loadPrototypes, savePrototypes, validatePrototypes } from "./prototypeio.mjs";
import { loadDesign, saveTokens, saveComponents } from "./designio.mjs";

// No browser package dependency: run the same contract against both renderers in
// installed Chromium. CI can set COLOPHON_BROWSER to its Chrome/Edge executable.
async function browserPath() {
  const paths = [process.env.COLOPHON_BROWSER,
    ...(process.platform === "win32" ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ] : ["/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"])];
  for (const candidate of paths.filter(Boolean)) {
    try { await access(candidate); return candidate; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return null;
}

async function switchBehavior(DS, doc, motionOnly = false) {
  const check = (condition, message) => { if (!condition) throw new Error(`Switch: ${message}`); };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const host = document.createElement("div");
  document.body.append(host);
  const before = JSON.stringify(doc);
  const render = (name = "ToggleSwitch", source = doc) => {
    const node = DS.renderComponent(source, name);
    host.append(node);
    return node;
  };
  const toggle = render(), second = render();
  const carrier = toggle.querySelector('[data-ds-node-id="toggle-carrier"]');
  const thumb = toggle.querySelector('[data-ds-node-id="toggle-thumb"]');
  const fire = (node, type, options = {}) => node.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 7, button: 0, isPrimary: true, ...options,
  }));
  const key = (node, type, options = {}) => node.dispatchEvent(new KeyboardEvent(type, {
    bubbles: true, cancelable: true, key: " ", ...options,
  }));
  const checked = (node = toggle) => node.getAttribute("aria-checked") === "true";
  const settle = () => {
    getComputedStyle(thumb).width;
    for (const animation of host.getAnimations({ subtree: true })) animation.finish();
  };
  const size = (width, height) => {
    check(thumb.style.width === `${width}px` && thumb.style.height === `${height}px`, `target size ${width}x${height}`);
    settle();
    const rect = thumb.getBoundingClientRect();
    check(Math.abs(rect.width - width) < .01 && Math.abs(rect.height - height) < .01, `rendered size ${width}x${height}: ${rect.width}x${rect.height}`);
  };
  try {
    await tick();
    check(!checked() && !checked(second) && toggle.getAttribute("role") === "switch", "initial accessible state");
    size(12, 12);
    if (motionOnly) {
      check(matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion preference");
      for (const node of [toggle, carrier, thumb]) check(getComputedStyle(node).transitionProperty === "none", "explicit and legacy motion disabled");
      toggle.click();
      fire(toggle, "pointerenter");
      check(checked() && getComputedStyle(carrier).translate === "20px", "reduced-motion slide reaches target immediately");
      size(14, 14);
      check(host.getAnimations({ subtree: true }).length === 0, "no reduced-motion geometry animations");
      toggle.disabled = true;
      await tick();
      size(12, 12);
      check(getComputedStyle(thumb).transitionProperty === "none", "disabled resize also respects reduced motion");
      return;
    }
    check(getComputedStyle(carrier).transitionDuration === "0.367s" &&
      getComputedStyle(carrier).transitionTimingFunction === "cubic-bezier(0.1, 0.9, 0.2, 1)", "independent WinUI reposition curve");
    check(getComputedStyle(thumb).transitionDuration === "0.083s, 0.083s" &&
      getComputedStyle(thumb).transitionTimingFunction === "cubic-bezier(0, 0, 0, 1), cubic-bezier(0, 0, 0, 1)", "resize duration and curve");
    toggle.focus();
    const off = carrier.getBoundingClientRect().left;
    for (let count = 0; count < 4; count++) {
      const on = !checked();
      fire(toggle, "pointerdown");
      size(17, 14);
      fire(toggle, "pointerup");
      fire(toggle, "click", { detail: 1 });
      check(checked() === on && !checked(second), "repeated pointer activation stays instance-local");
      settle();
      check(Math.abs(carrier.getBoundingClientRect().left - off - (on ? 20 : 0)) < .01, "exact 20px travel");
      check(document.activeElement === toggle, "click preserves keyboard focus");
      fire(toggle, "pointerenter");
      size(14, 14);
      check(checked() === on && (on ? toggle.style.backgroundColor === "var(--color-accent)" : toggle.style.backgroundColor === "var(--color-line)"), "on/off plus hover");
      fire(toggle, "pointerdown");
      size(17, 14);
      check(toggle.style.backgroundColor === (on ? "var(--color-accent)" : "var(--color-surface)"), "on/off plus pressed");
      fire(toggle, "pointerleave");
      size(17, 14);
      fire(document, "pointerup");
      size(12, 12);
      check(checked() === on, "release outside and hover leave preserve position");
    }
    check(!key(toggle, "keydown"), "Space default prevented on native button");
    size(17, 14);
    key(toggle, "keydown", { repeat: true });
    check(!checked(), "Space held does not toggle");
    key(toggle, "keyup");
    check(checked() && document.activeElement === toggle, "Space release activates once and retains focus");
    check(getComputedStyle(toggle).outlineStyle !== "none", "visible keyboard focus treatment");
    key(toggle, "keyup");
    check(checked(), "unmatched keyup does not activate");
    key(toggle, "keydown");
    key(toggle, "keyup");
    check(!checked(), "Space toggles off");

    fire(toggle, "pointerenter");
    fire(toggle, "pointerdown");
    toggle.disabled = true;
    await tick();
    check(getComputedStyle(thumb).transitionDuration === "0.25s, 0.25s", "disabled resize uses 250ms");
    size(12, 12);
    toggle.click();
    key(toggle, "keydown");
    key(toggle, "keyup");
    check(!checked(), "native disabled blocks activation");
    toggle.disabled = false;
    await tick();
    fire(document, "pointerup");
    fire(toggle, "pointerleave");
    size(12, 12);
    check(getComputedStyle(thumb).transitionDuration === "0.083s, 0.083s", "reenable restores resize duration");
    for (const attr of ["aria-disabled", "inert"]) {
      key(toggle, "keydown");
      host.setAttribute(attr, "true");
      await tick();
      size(12, 12);
      toggle.click();
      check(!checked(), `${attr} ancestor blocks click`);
      host.removeAttribute(attr);
      await tick();
      key(toggle, "keyup");
      check(!checked(), `${attr} cancels a held key`);
    }
    toggle.click();
    DSInteractions.forceState(toggle, "hover");
    size(14, 14);
    DSInteractions.forceState(toggle, "disabled");
    size(12, 12);
    toggle.click();
    check(checked() && toggle.disabled, "forced disabled preserves on");
    DSInteractions.forceState(toggle, "live");
    check(checked() && !toggle.disabled && !toggle.hasAttribute("inert"), "forced state reset preserves on");
    key(toggle, "keydown");
    host.classList.add("inspect-mode");
    await tick();
    size(12, 12);
    toggle.click();
    key(toggle, "keyup");
    check(checked(), "Inspect blocks click and keyboard");
    DSInteractions.resetTree(host);
    check(checked(), "Inspect transient reset preserves boolean");
    host.classList.remove("inspect-mode");
    await tick();
    key(toggle, "keyup");
    check(checked(), "leaving Inspect cannot activate an interrupted key");

    for (const interrupt of ["pointercancel", "lostpointercapture", "blur", "remove"]) {
      fire(toggle, "pointerdown");
      if (interrupt === "blur") window.dispatchEvent(new Event("blur"));
      else if (interrupt === "remove") { toggle.remove(); await tick(); host.append(toggle); }
      else fire(toggle, interrupt);
      size(12, 12);
      fire(toggle, "click", { detail: 1 });
      check(checked(), `${interrupt} cannot activate after cancellation`);
    }
    fire(toggle, "pointerdown", { button: 2 });
    size(12, 12);
    fire(toggle, "pointerdown", { isPrimary: false });
    size(12, 12);
    fire(toggle, "pointerdown");
    fire(document, "pointerup", { pointerId: 99 });
    size(17, 14);
    fire(document, "pointercancel");
    size(12, 12);

    const extra = { components: [...doc.components,
      { name: "Pair", root: { el: "div", children: [{ component: "ToggleSwitch" }, { component: "ToggleSwitch", state: { checked: true } }] } },
      { name: "Custom", root: { el: "div", state: { enabled: false }, on: { click: { toggle: "enabled" } }, children: ["Custom control"] } },
      { name: "Scoped", root: { el: "div", state: { enabled: false }, children: [
        { el: "span", states: { pressed: { color: "accent" } } },
        { el: "div", on: { click: { toggle: "enabled" } },
          states: { hover: { color: "accent" }, pressed: { background: "accent" } }, children: ["Nested control"] },
        { el: "span", states: { pressed: { color: "accent" } }, when: [{ state: { enabled: true }, style: { background: "accent" } }] },
        { el: "div", on: { click: { toggle: "enabled" } },
          states: { hover: { color: "accent" }, pressed: { background: "accent" } }, children: ["Other control"] },
      ] } },
      { name: "EditableToggle", root: { el: "div", state: { enabled: false }, on: { click: { toggle: "enabled" } },
        children: [{ el: "input", attrs: { type: "text", "aria-label": "Editable child" } }] } },
    ] };
    const pair = render("Pair", extra).querySelectorAll('[role="switch"]');
    pair[0].click();
    check(checked(pair[0]) && checked(pair[1]), "nested reference defaults and independent scopes");
    pair[1].click();
    check(checked(pair[0]) && !checked(pair[1]), "nested reference toggling stays independent");
    const custom = render("Custom", extra);
    check(custom.tabIndex === 0 && custom.getAttribute("role") === "switch", "custom toggle keyboard semantics");
    key(custom, "keydown"); key(custom, "keyup");
    check(checked(custom), "custom toggle Space activation");
    const scoped = render("Scoped", extra);
    const [beforePart, action, afterPart, otherAction] = scoped.children;
    fire(scoped, "pointerenter");
    check(!action.style.color && !otherAction.style.color, "container hover does not hover nested controls");
    fire(action, "pointerenter");
    check(action.style.color === "var(--color-accent)" && !otherAction.style.color, "controls own their hover");
    for (const source of ["keyboard", "pointer"]) {
      if (source === "keyboard") key(action, "keydown");
      else fire(action, "pointerdown");
      check([beforePart, afterPart].every((part) => part.style.color === "var(--color-accent)"), `${source} drives parts before and after action`);
      check(action.style.backgroundColor === "var(--color-accent)" && !otherAction.style.backgroundColor, "controls own their press");
      action.setAttribute("aria-disabled", "true");
      await tick();
      check([beforePart, afterPart].every((part) => !part.style.color), `${source} disabling cancels all dependent parts before rendering`);
      action.removeAttribute("aria-disabled");
      await tick();
      if (source === "keyboard") key(action, "keyup");
      else fire(document, "pointerup");
      check(!checked(action), "re-enabling never activates an interrupted nested action");
    }
    key(action, "keydown"); key(action, "keyup");
    check(checked(action) && afterPart.style.backgroundColor === "var(--color-accent)" && !afterPart.style.color,
      "nested action updates state and restores sparse part styling");
    fire(action, "pointerleave");
    fire(otherAction, "pointerenter");
    fire(otherAction, "pointerdown");
    check(!action.style.backgroundColor && otherAction.style.backgroundColor === "var(--color-accent)", "second control owns press after first was active");
    fire(document, "pointerup");
    const editable = render("EditableToggle", extra);
    const input = editable.querySelector("input");
    input.focus();
    for (const name of [" ", "Enter"]) {
      check(key(input, "keydown", { key: name }), `${name} default remains available to editable descendants`);
      key(input, "keyup", { key: name });
      check(!checked(editable), `${name} in editable descendant does not activate its toggle ancestor`);
    }
    check(JSON.stringify(doc) === before, "persistent control state does not mutate authored defaults");
    DSInteractions.disposeTree(host);
    toggle.click();
    check(checked(), "disposed toggle no longer responds");
  } finally {
    DSInteractions.disposeTree(host);
    host.remove();
  }
}

async function behavior(DS, doc, motionOnly = false) {
  await switchBehavior(DS, doc, motionOnly);
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
  const host = document.createElement("div");
  document.body.append(host);
  const render = (name, source = doc) => { const node = DS.renderComponent(source, name); host.append(node); return node; };
  const fire = (node, type, options = {}) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, isPrimary: true, ...options }));
  const picker = render("SubtlePicker");
  if (motionOnly) {
    check(matchMedia("(prefers-reduced-motion: reduce)").matches, "browser reduced-motion preference");
    check(getComputedStyle(picker).transitionProperty === "none", "reduced motion disables state transitions");
    picker.click();
    check(getComputedStyle(document.querySelector(".ds-flyout")).transitionProperty === "none", "flyout placement never transitions");
    DSInteractions.disposeTree(host);
    host.remove();
    return;
  }
  const before = JSON.stringify(doc);
  const border = render("Border", { components: [{
    name: "Border", root: {
      el: "div", appearance: { borderWidth: 4, borderColor: "accent" },
      states: { hover: { borderWidth: 0 }, pressed: { borderWidth: 2.5 } },
    },
  }] });
  check(getComputedStyle(border).borderTopWidth === "4px" && getComputedStyle(border).borderTopStyle === "solid", "thickness draws a border without class styling");
  fire(border, "pointerenter");
  check(getComputedStyle(border).borderTopWidth === "0px", "zero state thickness removes border");
  fire(border, "pointerdown");
  check(border.style.borderWidth === "2.5px", "fractional state thickness");
  fire(border, "pointerleave");
  fire(document, "pointerup");
  check(getComputedStyle(border).borderTopWidth === "4px", "state cleanup restores border thickness");
  const initial = picker.style.backgroundColor;
  fire(picker, "pointerenter");
  check(picker.style.backgroundColor === "var(--color-line)", "hover");
  fire(picker, "pointerdown");
  check(picker.style.backgroundColor === "var(--color-surface)", "hoverPressed precedence");
  fire(picker, "pointerleave");
  check(picker.style.backgroundColor === "var(--color-paper)", "pressed outside");
  fire(document, "pointerup");
  check(picker.style.backgroundColor === initial, "release outside restores base");
  fire(picker, "pointerdown");
  fire(document, "pointercancel");
  check(picker.style.backgroundColor === initial, "pointer cancel");
  fire(picker, "pointerdown");
  fire(picker, "lostpointercapture");
  check(picker.style.backgroundColor === initial, "lost capture clears press");
  fire(picker, "pointerdown", { button: 2 });
  check(picker.style.backgroundColor === initial, "ignore secondary button");
  picker.focus();
  picker.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  check(picker.style.backgroundColor === "var(--color-paper)", "keyboard pressed");
  picker.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
  check(picker.style.backgroundColor === initial, "keyboard release");
  fire(picker, "pointerdown");
  window.dispatchEvent(new Event("blur"));
  check(picker.style.backgroundColor === initial, "window blur clears press");

  for (const [state, expected] of [["rest", initial], ["hover", "var(--color-line)"], ["pressed", "var(--color-paper)"], ["hoverPressed", "var(--color-surface)"]]) {
    DSInteractions.forceState(picker, state);
    check(picker.style.backgroundColor === expected, `forced ${state}`);
  }
  DSInteractions.forceState(picker, "disabled");
  picker.click();
  check(picker.disabled && !document.querySelector(".ds-flyout"), "forced disabled blocks flyout");
  DSInteractions.forceState(picker, "live");
  check(!picker.disabled && !picker.hasAttribute("inert"), "forced disabled restores attributes");
  picker.disabled = true;
  await tick();
  DSInteractions.forceState(picker, "hover");
  check(picker.style.color === "var(--color-muted)" && picker.disabled, "authored disabled takes priority");
  picker.disabled = false;
  DSInteractions.forceState(picker, "live");
  await tick();
  picker.setAttribute("aria-disabled", "true");
  await tick();
  picker.click();
  check(picker.style.color === "var(--color-muted)" && !document.querySelector(".ds-flyout"), "ARIA disabled appearance and activation");
  picker.removeAttribute("aria-disabled");
  await tick();

  const radioPreview = render("PickerOptions");
  let navCount = 0;
  host.addEventListener("click", () => navCount++);
  picker.click();
  let panel = document.querySelector(".ds-flyout");
  check(panel && panel.parentElement === document.body, "portal escapes clipping");
  check(panel.contains(document.activeElement), "initial flyout focus");
  check(picker.getAttribute("aria-expanded") === "true" && picker.getAttribute("aria-controls") === panel.id, "trigger ARIA");
  check(navCount === 0, "flyout click does not navigate prototype");
  check(panel.querySelector("input").name !== radioPreview.querySelector("input").name, "radio groups are isolated");
  panel.querySelectorAll("input")[1].click();
  check(!document.querySelector(".ds-flyout") && document.activeElement === picker, "radio selection closes and restores focus");
  check(radioPreview.querySelector("input").checked, "radio selection leaves other preview alone");
  picker.click();
  check(document.querySelector(".ds-flyout input").checked, "reopen restores defaults");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  check(!document.querySelector(".ds-flyout") && document.activeElement === picker, "Escape");
  picker.click();
  picker.click();
  check(!document.querySelector(".ds-flyout"), "trigger toggles closed");

  const outside = document.createElement("button");
  host.append(outside);
  picker.click();
  fire(outside, "pointerdown");
  outside.focus();
  check(!document.querySelector(".ds-flyout") && document.activeElement === outside, "outside focus not stolen");
  picker.click();
  outside.focus();
  check(!document.querySelector(".ds-flyout"), "focus leaving dismisses");

  host.style.cssText = "position:fixed;right:0;bottom:0;transform:scale(.75);transform-origin:bottom right;overflow:hidden";
  host.style.setProperty("transition", "none", "important");
  host.style.setProperty("--color-surface", "rgb(34, 30, 26)");
  picker.click();
  panel = document.querySelector(".ds-flyout");
  let rect = panel.getBoundingClientRect();
  check(rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, "clamped scaled portal");
  check(Math.abs(Number(panel.style.transform.match(/scale\(([\d.]+)/)?.[1]) - 0.75) < 0.01,
    `prototype zoom preserved: ${panel.style.transform}`);
  await tick();
  check(getComputedStyle(panel.firstElementChild).backgroundColor === "rgb(34, 30, 26)",
    `portal theme inherited: ${getComputedStyle(panel.firstElementChild).backgroundColor}; token ${panel.style.getPropertyValue("--color-surface")}; trigger ${getComputedStyle(picker).getPropertyValue("--color-surface")}`);
  host.classList.add("inspect-mode");
  await tick();
  check(!document.querySelector(".ds-flyout"), "Inspect closes overlay");
  picker.click();
  check(!document.querySelector(".ds-flyout"), "Inspect suppresses activation");
  host.classList.remove("inspect-mode");
  host.style.cssText = "";

  const composer = render("BorderlessComposer");
  composer.focus();
  await tick();
  check(getComputedStyle(composer).outlineStyle === "none", "no UA focus ring");
  check(getComputedStyle(composer).borderTopWidth === "0px", "no UA border");
  check(getComputedStyle(composer).resize === "none", "no UA textarea resize");
  check(getComputedStyle(composer).boxShadow !== "none", "underline focus cue");
  check(!composer.readOnly && !composer.disabled, "composer editable");
  document.execCommand("insertText", false, "A field note");
  check(composer.value === "A field note", "native textarea accepts editing");
  const field = render("Field").querySelector("input");
  field.focus();
  check(getComputedStyle(field).outlineStyle !== "none", "unopted Field focus unchanged");

  const extra = { components: [
    { name: "Role", root: { el: "div", on: { click: { open: "Options" } }, states: { hover: { color: "accent" } } } },
    { name: "Options", root: { el: "button", on: { click: { open: "Role" } }, children: ["Nested"] } },
    { name: "Editable", root: { el: "div", attrs: { contenteditable: "true" }, control: { chrome: "none", focus: { kind: "underline", color: "accent" } } } },
    { name: "Shadow", root: { el: "textarea", appearance: { shadow: "$none" }, control: { focus: { kind: "underline", color: "accent" } } } },
    { name: "Sparse", root: { el: "button", states: { hover: { color: "accent", radius: "md" } } } },
    { name: "False", root: { el: "input", attrs: { disabled: false, readonly: false } } },
  ] };
  const shadow = render("Shadow", extra);
  shadow.focus();
  await tick();
  check(getComputedStyle(shadow).boxShadow !== "none", "focus cue overrides an authored no-shadow appearance");
  const sparse = render("Sparse", extra);
  fire(sparse, "pointerenter");
  fire(sparse, "pointerleave");
  check(!sparse.style.color && !sparse.style.borderRadius, "sparse state restores class/inherited styling");
  const enabled = render("False", extra);
  check(!enabled.disabled && !enabled.readOnly, "false native boolean attributes are not emitted");
  const role = render("Role", extra);
  check(role.tabIndex === 0 && role.getAttribute("role") === "button", "generic trigger semantics");
  role.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  panel = document.querySelector(".ds-flyout");
  check(!!panel, "generic trigger keyboard opens");
  panel.querySelector("button").click();
  check(document.querySelector(".ds-flyout") === panel, "no nested overlays");
  DSInteractions.closeOverlay();
  const editable = render("Editable", extra);
  editable.focus();
  document.execCommand("insertText", false, "Editable");
  await tick();
  check(editable.textContent === "Editable" && getComputedStyle(editable).boxShadow !== "none", "contenteditable typeable with focus cue");
  editable.setAttribute("aria-disabled", "true");
  check(!editable.dispatchEvent(new InputEvent("beforeinput", { cancelable: true, inputType: "insertText", data: "x" })), "ARIA disabled blocks edits");

  picker.click();
  picker.remove();
  await tick();
  check(!document.querySelector(".ds-flyout"), "removed trigger closes portal");
  host.append(picker);
  picker.click();
  DSInteractions.disposeTree(host);
  check(!document.querySelector(".ds-flyout"), "dispose closes portal");
  picker.click();
  check(!document.querySelector(".ds-flyout"), "disposed handlers are removed");
  check(JSON.stringify(doc) === before, "preview interaction never mutates document");
  host.remove();
}

test("real Chromium behavior: classic and ESM component previews", { timeout: 45000 }, async (t) => {
  const browser = await browserPath();
  if (!browser) { t.skip("Set COLOPHON_BROWSER to run real-browser interaction coverage."); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), "colophon-browser-"));
  try {
    const asset = (name) => readFile(new URL(name, import.meta.url), "utf8");
    const [interactions, classic, styles, css, sample, io, esm] = await Promise.all([
      asset("components-interactions.js"), asset("components-runtime.js"), asset("styles.css"),
      asset("components-interactions.css"), asset("sample/components.jsonc"), asset("componentsio.mjs"), asset("components-render.mjs"),
    ]);
    await Promise.all([writeFile(path.join(dir, "componentsio.mjs"), io), writeFile(path.join(dir, "components-render.mjs"), esm),
      writeFile(path.join(dir, "shape-geometry.js"), await asset("shape-geometry.js")),
      writeFile(path.join(dir, "editor-geometry.js"), await asset("editor-geometry.js"))]);
    const html = `<!doctype html><meta charset="utf-8"><style>${styles}\n${css}
    :root { --color-ink:#1c1a17;--color-muted:#6b6459;--color-accent:#b5502a;--color-paper:#f7f4ee;--color-surface:#fff;--color-line:#e4ddd0;--space-2:8px;--space-3:12px;--space-4:16px;--radius-md:8px;--font-body:sans-serif; }
    </style><body><script src="./shape-geometry.js"></script><script>${interactions}</script><script>${classic}</script><script type="module">
    const result = document.createElement("pre"); result.id = "browser-result";
    try {
      const switchBehavior = ${switchBehavior.toString()};
      const behavior = ${behavior.toString()};
      const doc = ${JSON.stringify(parseComponents(sample)).replace(/</g, "\\u003c")};
      await behavior(window.DSComp, doc, location.search === "?motion");
      await import("./components-render.mjs");
      await behavior(window.DSComp, doc, location.search === "?motion");
      result.textContent = "PASS classic and ESM";
    } catch (error) { result.textContent = "FAIL " + error.stack; }
    document.body.append(result);
    </script>`;
    await writeFile(path.join(dir, "index.html"), html);
    for (const motionOnly of [false, true]) {
      const { stdout } = await promisify(execFile)(browser, [
        "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
        "--allow-file-access-from-files", ...(motionOnly ? ["--force-prefers-reduced-motion=reduce"] : []), `--user-data-dir=${path.join(dir, motionOnly ? "motion-profile" : "profile")}`,
        "--dump-dom", "--virtual-time-budget=8000", pathToFileURL(path.join(dir, "index.html")).href + (motionOnly ? "?motion" : ""),
      ], { timeout: 35000, maxBuffer: 4 * 1024 * 1024 });
      const result = stdout.match(/<pre id="browser-result">([\s\S]*?)<\/pre>/)?.[1];
      assert.equal(result, "PASS classic and ESM", result || "Browser did not complete the test script.");
    }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

async function shellBehavior(kind) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const waitFor = async (selector) => {
    for (let count = 0; count < 150; count++) {
      const node = document.querySelector(selector);
      if (node) return node;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Never rendered ${selector}`);
  };
  const waitUntil = async (predicate, message) => {
    for (let count = 0; count < 150; count++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(message);
  };
  const verifySwitch = async () => {
    const node = await waitFor('[data-ds-node-id="toggle-switch"]');
    const thumb = node.querySelector('[data-ds-node-id="toggle-thumb"]');
    const carrier = node.querySelector('[data-ds-node-id="toggle-carrier"]');
    check(node.getAttribute("aria-checked") === "false", `${kind} switch starts off`);
    node.focus();
    node.click();
    check(node.getAttribute("aria-checked") === "true" && document.activeElement === node, `${kind} switch toggles on without replacing focus`);
    node.dispatchEvent(new PointerEvent("pointerenter"));
    check(thumb.style.width === "14px" && parseFloat(carrier.style.translate) === 20, `${kind} on plus hover geometry`);
    for (const type of ["keydown", "keyup"]) node.dispatchEvent(new KeyboardEvent(type, { key: " ", bubbles: true, cancelable: true }));
    check(node.getAttribute("aria-checked") === "false" && parseFloat(carrier.style.translate) === 0, `${kind} Space toggles off`);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      check(getComputedStyle(thumb).transitionProperty === "none" && getComputedStyle(carrier).transitionProperty === "none", `${kind} reduced motion disables authored transitions`);
    }
    node.dispatchEvent(new PointerEvent("pointerleave"));
    node.click();
    return node;
  };
  if (kind === "component-pages") {
    await waitFor(".page-nav-link");
    const registry = DSComp.componentNames(state.componentsDoc);
    const previews = () => [...document.querySelectorAll(".page-content .preview .cname")].map((node) => node.textContent);
    const expectPreviews = (names, message) => check(JSON.stringify(previews()) === JSON.stringify(names), message);
    const pageButton = (name) => [...document.querySelectorAll(".page-nav-link")]
      .find((node) => node.querySelector(".page-nav-label")?.textContent === name);
    pageButton("Components").click();
    await waitFor(".page-content .preview");
    expectPreviews(["Badge", "Button"], "built-in previews follow selection order, not registry order");
    check(document.querySelectorAll(".page-nav-link").length === 3, "built-in configuration does not create a duplicate page");
    check(!document.querySelector(".page-editor"), "built-in selection does not expose custom-page editors");
    const buttonIndex = registry.indexOf("Button");
    check(document.querySelectorAll(".page-content .preview")[1].dataset.designPath === JSON.stringify(["components", buttonIndex]),
      "filtered previews retain original registry inspection paths");

    for (const selection of [{}, { components: [] }, { components: ["Badge", "Button"] }]) {
      state.tokens.pages[0] = { id: "components", name: "Components", ...selection };
      markDirty();
      await doSave();
      check(!state.dirty, "page configuration saves through the canvas");
      await load();
      check(JSON.stringify(state.tokens.pages[0]) === JSON.stringify({ id: "components", name: "Components", ...selection }),
        "page configuration survives canvas reload");
      expectPreviews(selection.components ?? registry, "absent and explicit empty selections remain distinct after reload");
      check(JSON.stringify(DSComp.componentNames(state.componentsDoc)) === JSON.stringify(registry), "save/reload never filters definitions");
    }
    const configuredPages = structuredClone(state.tokens.pages);
    state.tokens.pages = configuredPages.slice(1);
    await render();
    expectPreviews(registry, "no built-in entry retains all-components behavior");
    state.tokens.pages = structuredClone(configuredPages);
    state.tokens.pages[0].components = ["Missing", "Button"];
    await render();
    expectPreviews(["Button"], "unknown names do not cause unrelated previews to appear");
    check(document.querySelector(".page-content .banner.warn")?.textContent.includes("Missing"), "unknown name is reported on the page");
    state.tokens.pages[0].components = null;
    await render();
    expectPreviews([], "malformed selection never falls back to all components");
    check(document.querySelector(".page-content .err")?.textContent.includes("array"), "malformed selection has a visible diagnostic");
    state.tokens.pages = configuredPages;
    await render();

    pageButton("Publishing").click();
    await waitFor(".page-title-input");
    expectPreviews(["ExampleScreen", "SubtlePicker"], "omitted feature previews still render on their custom page");
    check(!!document.querySelector('[data-ds-node-id="example-screen-field"] input') &&
      document.querySelector('[data-ds-node-id="example-screen-deploys"]')?.textContent.includes("Deploys"), "nested references resolve omitted controls");
    check(document.querySelector('[data-ds-node-id="example-screen-submit"]')?.textContent === "Send invite", "shared controls still render inside compositions");
    const picker = await waitFor('[data-ds-node-id="subtle-picker"]');
    picker.click();
    const flyout = await waitFor(".ds-flyout");
    check(!!flyout.querySelector('[data-ds-node-id="picker-options"]'), "flyout resolves an omitted registry definition");
    flyout.querySelector('input[value="essay"]').click();
    check(!document.querySelector(".ds-flyout"), "omitted flyout interactions remain live");

    document.querySelector("#inspect-btn").click();
    await waitFor(".component-layer-group");
    check(document.querySelectorAll(".component-layer-group").length === registry.length, "Inspect retains the entire registry");
    const fieldGroup = [...document.querySelectorAll(".component-layer-group")]
      .find((group) => group.querySelector(".component-layer-name").textContent === "Field");
    fieldGroup.querySelector(".component-layer-row button").click();
    await waitUntil(() => state.selection?.path?.[1] === registry.indexOf("Field"), "omitted definition is selectable in Inspect");
    document.querySelector("#json-tab").click();
    const draft = JSON.parse(document.querySelector("#inspect-json").value);
    draft.attrs = { ...draft.attrs, title: "Edited omitted field" };
    document.querySelector("#inspect-json").value = JSON.stringify(draft);
    document.querySelector("#inspect-apply-btn").click();
    await waitUntil(() => selectedComponentNode()?.attrs?.title === "Edited omitted field", "omitted definition remains editable");
    expectPreviews(["Badge", "Button"], "editing an omitted definition does not add it to the gallery");
    document.querySelector("#layers-undo-btn").click();
    await waitUntil(() => !selectedComponentNode()?.attrs?.title, "omitted definition edit supports undo");
    check(JSON.stringify(DSComp.componentNames(state.componentsDoc)) === JSON.stringify(registry), "full registry survives inspection and editing");
    return;
  }
  if (kind === "brand") {
    await waitFor("#brand-name");
    const pageButton = (name) => [...document.querySelectorAll(".page-nav-link")]
      .find((node) => node.querySelector(".page-nav-label")?.textContent === name);
    const inputFor = (label) => document.querySelector(`.inline-text-input[aria-label="${label}"]`);
    const editFor = (label) => document.querySelector(`button[aria-label="Edit ${label}"]`);
    const finish = (input, key = "Enter", options = {}) => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
    const editText = (label, value, key = "Enter", options = {}) => {
      const input = inputFor(label);
      check(input.hidden && input.readOnly, `${label} starts read-only`);
      editFor(label).click();
      check(!input.hidden && !input.readOnly && document.activeElement === input, `${label} edit icon opens and focuses its input`);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      finish(input, key, options);
      check(input.hidden && input.readOnly && document.activeElement === editFor(label), `${label} finishes and restores edit-button focus`);
    };
    check(document.querySelector(".page-nav-title").textContent === "Pages", "sidebar is labeled Pages");
    check(document.querySelector("#save-btn").disabled, "viewing brand does not dirty the document");
    for (const input of document.querySelectorAll(".brand input, .brand textarea, .authority input[type=text]")) {
      check(input.hidden && input.readOnly && getComputedStyle(input).display === "none", "brand and authority inputs are hidden and read-only initially");
    }
    document.querySelector("#brand-name").click();
    check(inputFor("Brand name").hidden, "clicking brand text does not start editing");
    const edit = editFor("Brand name");
    edit.style.transition = "none";
    check(getComputedStyle(edit).opacity === (matchMedia("(hover: none)").matches ? "1" : "0"), "edit icon is hidden at rest except on touch devices");
    edit.focus();
    check(getComputedStyle(edit).opacity === "1", "keyboard focus reveals the edit icon");
    edit.blur();

    if (innerWidth > 720) {
      const toolbar = document.querySelector(".topbar");
      const saveButton = document.querySelector("#save-btn");
      const initialHeight = toolbar.offsetHeight;
      saveButton.style.flexBasis = "100%";
      await waitUntil(() => parseFloat(document.documentElement.style.getPropertyValue("--canvas-topbar-offset")) === toolbar.offsetHeight && toolbar.offsetHeight > initialHeight,
        "sidebar offset follows toolbar wrapping without a window resize or rerender");
      check(document.querySelector(".page-nav").getBoundingClientRect().top >= toolbar.getBoundingClientRect().bottom, "wrapped toolbar remains above Pages");
      const saveRect = saveButton.getBoundingClientRect();
      check(saveButton.contains(document.elementFromPoint(saveRect.left + 5, saveRect.top + saveRect.height / 2)), "Pages cannot cover the wrapped Save button");
      saveButton.style.flexBasis = "";
      await waitUntil(() => parseFloat(document.documentElement.style.getPropertyValue("--canvas-topbar-offset")) === toolbar.offsetHeight && toolbar.offsetHeight === initialHeight,
        "sidebar offset follows the toolbar shrinking again");
    }
    state.validation = { ok: false, errors: ["An actionable validation error"], warnings: [] };
    renderValidation();
    const banner = document.querySelector("#validation-slot .banner");
    banner.style.animation = "none";
    if (innerWidth > 720) {
      // Exercise the overlapping region at desktop widths even in a wide test window.
      document.querySelector("#validation-slot").style.left = "100px";
      const error = banner.querySelector(".err li").getBoundingClientRect();
      check(banner.contains(document.elementFromPoint(error.left + 1, error.top + error.height / 2)), "validation error text stays above Pages");
      document.querySelector("#validation-slot").style.left = "";
    }
    state.validation = null;
    renderValidation();

    const navigationStyles = () => {
      const styles = {};
      for (const selector of [".page-nav", ".page-nav-title", ".page-nav-list", ".page-nav-link.is-active", ".page-add"]) {
        const computed = getComputedStyle(document.querySelector(selector));
        styles[selector] = Object.fromEntries(["backgroundColor", "color", "borderTopColor", "borderRightColor", "fontSize", "padding", "borderRadius"]
          .map((name) => [name, computed[name]]));
      }
      const indicator = getComputedStyle(document.querySelector(".page-nav-link.is-active"), "::before");
      styles.indicator = Object.fromEntries(["backgroundColor", "content", "width", "height", "borderRadius", "insetInlineStart", "top", "transform"]
        .map((name) => [name, indicator[name]]));
      return styles;
    };
    const genericNavigation = navigationStyles();
    const activeNavigation = genericNavigation[".page-nav-link.is-active"];
    check(activeNavigation.backgroundColor !== genericNavigation[".page-nav"].color && activeNavigation.backgroundColor !== genericNavigation[".page-nav"].backgroundColor &&
      activeNavigation.backgroundColor !== "rgba(0, 0, 0, 0)", "active page uses a soft backplate, not a solid ink row");
    check(activeNavigation.color === genericNavigation[".page-nav"].color &&
      genericNavigation.indicator.backgroundColor === genericNavigation[".page-nav"].color,
      "active page uses generic ink for text and its selection pill");
    check(genericNavigation.indicator.content === '""' && genericNavigation.indicator.width === "4px" && genericNavigation.indicator.height === "20px" &&
      parseFloat(genericNavigation.indicator.borderRadius) >= 2, "selection pill is small with fully rounded ends");
    check(getComputedStyle(pageButton("Components"), "::before").content === "none", "inactive pages do not show a selection pill");
    check(getComputedStyle(pageButton("Components")).paddingInlineStart === getComputedStyle(pageButton("Brand")).paddingInlineStart,
      "selection does not shift navigation labels");
    for (const theme of ["dark", "highContrast", "light"]) {
      document.querySelector(`[data-theme="${theme}"]`).click();
      await waitFor("#brand-name");
      const nav = document.querySelector(".page-nav");
      check(JSON.stringify(navigationStyles()) === JSON.stringify(genericNavigation), "preview themes do not recolor or resize generic Pages navigation");
      if (innerWidth > 720) {
        const bounds = nav.getBoundingClientRect();
        check(bounds.left === 0 && Math.abs(bounds.bottom - innerHeight) < 1, "Pages fills the left edge down to the viewport bottom");
        check(Math.abs(bounds.top - document.querySelector(".topbar").getBoundingClientRect().bottom) < 1, "Pages starts directly below the toolbar");
        check(bounds.right <= document.querySelector(".page-content").getBoundingClientRect().left, "Pages never overlaps content");
      } else {
        check(nav.getBoundingClientRect().bottom <= document.querySelector(".page-content").getBoundingClientRect().top, "narrow Pages index stays above content");
        check(document.documentElement.scrollWidth <= innerWidth, "narrow brand page has no horizontal overflow");
      }
    }
    const originalTokens = structuredClone(state.tokens);
    for (const color of state.tokens.colors) {
      color.value = "#ff00ff";
      color.themes = { dark: "#00ff00", highContrast: "#0000ff" };
    }
    for (const step of state.tokens.spacing.scale) step.value = "40px";
    for (const radius of state.tokens.radii) radius.value = "40px";
    state.tokens.typography.scale.find((style) => style.name === "caption").size = "40px";
    applyVars();
    check(JSON.stringify(navigationStyles()) === JSON.stringify(genericNavigation), "authored palette, type, spacing, and radii cannot leak into Pages chrome");
    state.tokens = originalTokens;
    applyVars();
    const rootStyle = document.documentElement.style;
    const hostColors = { "--background-color-default": "rgb(20, 20, 20)", "--text-color-default": "rgb(240, 240, 240)", "--border-color-default": "rgb(70, 70, 70)" };
    const originalHost = Object.fromEntries(Object.keys(hostColors).map((key) => [key, rootStyle.getPropertyValue(key)]));
    for (const [key, value] of Object.entries(hostColors)) rootStyle.setProperty(key, value);
    await waitUntil(() => getComputedStyle(document.querySelector(".page-nav-link.is-active")).color === "rgb(240, 240, 240)",
      "generic sidebar transitions to the host's updated ink");
    const hostNavigation = navigationStyles();
    check(hostNavigation[".page-nav"].backgroundColor === "rgb(20, 20, 20)" && hostNavigation.indicator.backgroundColor === "rgb(240, 240, 240)" &&
      hostNavigation[".page-nav-link.is-active"].backgroundColor !== "rgb(240, 240, 240)",
      "Pages responds to the host theme independently of the preview");
    for (const [key, value] of Object.entries(originalHost)) {
      if (value) rootStyle.setProperty(key, value);
      else rootStyle.removeProperty(key);
    }
    state.tokens.pages = Array.from({ length: 40 }, (_, index) => ({ id: `page-${index}`, name: `Page ${index}` }));
    await render();
    const list = document.querySelector(".page-nav-list");
    check(list.scrollHeight > list.clientHeight, "long page list scrolls independently");
    const add = document.querySelector(".page-add").getBoundingClientRect();
    check(add.bottom <= document.querySelector(".page-nav").getBoundingClientRect().bottom, "Add page remains reachable below a long list");
    list.scrollTop = list.scrollHeight;
    const scrollTop = list.scrollTop;
    pageButton("Page 39").click();
    await waitUntil(() => document.querySelector(".page-nav-list") && document.querySelector(".page-nav-list") !== list, "lower page navigation renders");
    const checkActiveVisible = () => {
      const viewport = document.querySelector(".page-nav-list").getBoundingClientRect();
      const active = document.querySelector(".page-nav-link.is-active").getBoundingClientRect();
      check(active.top >= viewport.top - 1 && active.bottom <= viewport.bottom + 1, "active page remains visible within the scrolling list");
    };
    check(Math.abs(document.querySelector(".page-nav-list").scrollTop - scrollTop) < 1, "page navigation preserves internal scroll position");
    checkActiveVisible();
    await render();
    checkActiveVisible();
    check(Math.abs(document.querySelector(".page-nav-list").scrollTop - scrollTop) < 1, "rerender preserves internal scroll position");
    const beforeAdd = document.querySelector(".page-nav-list");
    document.querySelector(".page-add").click();
    await waitUntil(() => document.querySelector(".page-nav-list") && document.querySelector(".page-nav-list") !== beforeAdd, "new page navigation renders");
    checkActiveVisible();
    state.tokens.pages = [];
    await render();
    check(pageButton("Brand").getAttribute("aria-current") === "page", "removing the current custom page selects the fallback page");
    editText("Brand name", "Northlight notes");
    editText("Tagline", "A quieter workspace", "Escape");
    check(state.tokens.brand.tagline === "A quieter workspace", "Escape finishes without losing edits");
    const descriptionLabel = "Description (app / project context for codegen)";
    editFor(descriptionLabel).click();
    const description = inputFor(descriptionLabel);
    description.value = "First line\nSecond line";
    description.dispatchEvent(new Event("input", { bubbles: true }));
    finish(description);
    check(!description.hidden, "Enter stays inside multiline editing");
    description.blur();
    check(description.hidden && description.readOnly && document.querySelector("#brand-desc").textContent === description.value, "blur returns multiline text to read-only");
    editText("Personality (one per line)", "calm\nprecise", "Enter", { ctrlKey: true });
    check(state.tokens.brand.personality.join("|") === "calm|precise" && document.querySelectorAll(".brand .chip").length === 2, "personality edits keep array values and chips");
    editText("Voice", "Plain and exact", "Enter", { metaKey: true });
    editFor("Voice").click();
    const nextEdit = editFor("Avoid (one per line)");
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    nextEdit.dispatchEvent(mouseDown);
    check(mouseDown.defaultPrevented && document.activeElement === inputFor("Voice"), "next pencil keeps the current editor focused until click completes");
    const secondaryDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 });
    nextEdit.dispatchEvent(secondaryDown);
    check(!secondaryDown.defaultPrevented, "secondary mouse button retains its native behavior");
    nextEdit.click();
    check(document.activeElement === inputFor("Avoid (one per line)") && inputFor("Voice").hidden, "one pencil activation switches editors");
    finish(inputFor("Avoid (one per line)"), "Escape");
    editText("Avoid (one per line)", "noise\nclutter", "Enter", { ctrlKey: true });
    editText("Implementation owner (optional)", "@northlight");
    editText("Sync process (optional)", "Review each release");
    editFor("Tagline").click();
    const tagline = inputFor("Tagline");
    tagline.value = "";
    tagline.dispatchEvent(new Event("input", { bubbles: true }));
    tagline.blur();
    check(document.querySelector("#brand-tag").textContent === "Not set" && editFor("Tagline"), "empty text stays editable");
    editText("Tagline", "A quieter workspace");
    pageButton("Components").click();
    await waitFor(".preview");
    pageButton("Brand").click();
    await waitFor("#brand-name");
    check(document.querySelector("#brand-name").textContent === "Northlight notes" && inputFor("Brand name").hidden, "navigation preserves draft text and restores read-only mode");
    if (innerWidth > 720) {
      document.querySelector("#inspect-btn").click();
      await waitFor(".preview");
      check(getComputedStyle(document.querySelector(".page-nav")).display === "none", "component Inspect reserves the workspace for Layers and Properties");
      pageButton("Brand").click();
      await waitFor("#brand-name");
      const checkInspectLayout = () => {
        const layers = document.querySelector("#component-layers").getBoundingClientRect();
        const properties = document.querySelector("#design-inspector").getBoundingClientRect();
        const pages = document.querySelector(".page-nav").getBoundingClientRect();
        const content = document.querySelector(".page-content").getBoundingClientRect();
        const leftPanel = properties.left === 0 ? properties : layers;
        check(leftPanel.right <= pages.left && pages.right <= content.left, "Inspect keeps its docked panel, Pages, and content separate");
        if (innerWidth > 896) {
          const rightPanel = properties.left === 0 ? layers : properties;
          check(content.right <= rightPanel.left, "Inspect right panel does not cover content");
        }
      };
      checkInspectLayout();
      document.querySelector("#inspector-dock-btn").click();
      checkInspectLayout();
      document.querySelector("#inspector-dock-btn").click();
      document.querySelector("#brand-name").click();
      check(state.selection.path.join("/") === "brand" && inputFor("Brand name").hidden, "Inspect still selects brand without editing text");
      for (const pencil of document.querySelectorAll(".inline-text-edit")) {
        check(getComputedStyle(pencil).display === "none", "Inspect hides misleading inline-edit controls from pointer and keyboard navigation");
      }
      editFor("Brand name").click();
      check(inputFor("Brand name").hidden, "Inspect cannot accidentally open a hidden inline editor");
      document.querySelector("#inspect-btn").click();
      check(getComputedStyle(editFor("Brand name")).display !== "none", "leaving Inspect restores inline-edit controls");
    }
    document.querySelector("#save-btn").click();
    await waitUntil(() => !state.dirty && document.querySelector("#save-btn").disabled, "brand edits save");
    document.querySelector("#reload-btn").click();
    await waitUntil(() => state.tokens.brand.name === "Northlight notes" && document.querySelector("#save-btn").textContent === "Saved", "saved brand reloads");
    check(state.tokens.brand.description === "First line\nSecond line" && state.tokens.brand.antiReferences.join("|") === "noise|clutter", "multiline and list edits persist");
    check(state.tokens.authority.owner === "@northlight" && inputFor("Implementation owner (optional)").hidden, "authority edits persist in read-only mode");
    return;
  }
  if (kind === "compact") {
    await waitFor("#screen-list [data-screen-id]");
    const list = document.querySelector("#screen-list");
    const buttons = [...list.querySelectorAll("[data-screen-id]")];
    check(buttons.length === 2, "short-list fixture has two screens");
    for (const button of buttons) {
      check(Math.abs(button.parentElement.getBoundingClientRect().height - button.getBoundingClientRect().height) < 1, "short-list rows keep their natural height");
    }
    const first = buttons[0].getBoundingClientRect();
    const last = buttons[1].getBoundingClientRect();
    check(Math.abs(last.top - first.bottom - 4) < 1, "short-list screen spacing stays at 4px");
    const section = list.querySelector(".screen-section");
    if (section) {
      check(list.querySelectorAll(".screen-section").length === 1, "single-section fixture");
      check(section.getBoundingClientRect().bottom - last.bottom < 1, "single section does not stretch to fill the sidebar");
    }
    check(list.getBoundingClientRect().bottom - last.bottom > 100, "unused space stays below the short list");
    buttons[1].click();
    check(buttons[1].getAttribute("aria-current") === "page", "short-list navigation still works");
    const sectionsHeading = document.querySelector("#screen-sections-heading");
    if (sectionsHeading) {
      check(sectionsHeading.hidden === !section, "Sections heading is hidden only when there are no sections");
      check((getComputedStyle(sectionsHeading).display === "none") === !section, "empty Sections heading takes no layout space");
    }
    if (sectionsHeading && !section) {
      const chooseAddSection = (select) => {
        select.selectedIndex = [...select.options].findIndex((option) => option.dataset.action === "add-section");
        select.dispatchEvent(new Event("change"));
      };
      const assignment = document.querySelector("#screen-section");
      const name = document.querySelector("#screen-name");
      const submit = () => document.querySelector("#screen-form").requestSubmit();
      check([...assignment.options].map((option) => option.textContent).join("|") === "Ungrouped|Add section", "empty section dropdown offers Ungrouped then Add section");
      chooseAddSection(assignment);
      check(document.querySelector("#screen-dialog").open && document.querySelector("#screen-dialog-title").textContent === "Add section", "dropdown opens section creation");
      document.querySelector("#screen-dialog-cancel").click();
      check(assignment.selectedIndex === 0 && sectionsHeading.hidden && document.querySelector("#nav-save-btn").disabled, "cancel preserves Ungrouped without making edits");
      chooseAddSection(assignment);
      name.value = "First group";
      submit();
      check(!sectionsHeading.hidden && assignment.selectedOptions[0].textContent === "First group", "creation reveals Sections and assigns selected screen");
      const assigned = list.querySelector('[aria-current="page"]');
      check(assigned.dataset.screenId === "second" && assigned.closest("[data-section-id]"), "screen moves into the new group without changing selection");
      const originalSectionId = assignment.value;
      chooseAddSection(assignment);
      document.querySelector("#screen-dialog-cancel").click();
      check(assignment.value === originalSectionId, "cancel restores an existing assignment");
      const newScreenSection = document.querySelector("#new-screen-section");
      const newSectionName = document.querySelector("#new-section-name");
      document.querySelector("#add-screen-btn").click();
      name.value = "Screen draft";
      chooseAddSection(newScreenSection);
      check(name.value === "Screen draft" && !newSectionName.disabled, "new-screen dropdown preserves screen name and enables section name");
      newSectionName.value = "Discarded group";
      document.querySelector("#screen-dialog-cancel").click();
      check(list.querySelectorAll("[data-section-id]").length === 1, "canceling new screen creates no section");
      document.querySelector("#add-screen-btn").click();
      name.value = "Grouped screen";
      chooseAddSection(newScreenSection);
      submit();
      check(document.querySelector("#screen-dialog").open && !newSectionName.validity.valid, "section name is required");
      newSectionName.value = "Second group";
      submit();
      check(assignment.selectedOptions[0].textContent === "Second group", "new screen and section are created together");
      document.querySelector("#nav-save-btn").click();
      await waitUntil(() => document.querySelector("#nav-save-status").textContent === "Saved", "dropdown section edits save");
      const saved = await (await fetch("/api/prototypes")).json();
      check(saved.proto.doc.sections.length === 2 && saved.proto.doc.screens.length === 3, "both dropdown workflows persist");
      check(saved.proto.doc.screens.find((screen) => screen.id === "second").sectionId === originalSectionId, "selected screen assignment is persisted");
      const beforeReload = list.querySelector("[aria-current]");
      document.querySelector("#reload-btn").click();
      await waitUntil(() => list.querySelector("[aria-current]") !== beforeReload, "reload completes after dropdown editing");
      check(!sectionsHeading.hidden && assignment.selectedOptions[0].textContent === "Second group", "reload keeps heading and section assignment");
    }
    return;
  }
  if (kind === "gallery") {
    await waitFor(".page-nav-link");
    const components = [...document.querySelectorAll(".page-nav-link")].find((node) => node.querySelector(".page-nav-label")?.textContent === "Components");
    components.click();
    let select = await waitFor('select[aria-label="SubtlePicker preview state"]');
    let picker = await waitFor('[data-ds-node-id="subtle-picker"]');
    const originalSwitch = await verifySwitch();
    select.value = "hover";
    select.dispatchEvent(new Event("change"));
    check(picker.style.backgroundColor === "var(--color-line)", "gallery selector forces hover");
    select.value = "disabled";
    select.dispatchEvent(new Event("change"));
    check(picker.disabled, "gallery selector disables");
    document.querySelector("#inspect-btn").click();
    select = await waitFor('select[aria-label="SubtlePicker preview state"]');
    picker = await waitFor('[data-ds-node-id="subtle-picker"]');
    check(!picker.disabled && select.disabled && select.value === "live", "Inspect restores temporary disabled state");
    const inspectedSwitch = document.querySelector('[data-ds-node-id="toggle-switch"]');
    check(!originalSwitch.isConnected && inspectedSwitch.getAttribute("aria-checked") === "false", "first gallery Inspect render starts from authored defaults");
    const wasChecked = inspectedSwitch.getAttribute("aria-checked");
    inspectedSwitch.click();
    check(inspectedSwitch.getAttribute("aria-checked") === wasChecked, "gallery Inspect does not activate toggle");
    picker.click();
    check(!document.querySelector(".ds-flyout"), "Inspect selects instead of opening");
    check(document.querySelector("#design-inspector").hidden === false, "inspector remains usable");
    const borderInput = () => document.querySelector('#inspect-properties input[aria-label="Border thickness (px)"]');
    const editBorder = async (value) => {
      const input = borderInput();
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await waitUntil(() => borderInput() !== input || input.getAttribute("aria-invalid") === "true", "border edit rerenders properties or reports invalid input");
    };
    check(borderInput()?.value === "", "component border control initially inherits");
    const margin = document.querySelector('#inspect-properties input[aria-label="Margin All"]');
    check(borderInput().closest(".spacing-combo") && margin, "border thickness reuses the margin numberbox");
    for (const property of ["height", "fontFamily", "fontSize", "paddingRight", "borderRadius", "backgroundColor"]) {
      check(getComputedStyle(borderInput())[property] === getComputedStyle(margin)[property], `border thickness matches margin ${property}`);
    }
    for (const dropdown of document.querySelectorAll("#inspect-properties select")) {
      check(getComputedStyle(dropdown).appearance === "none" && dropdown.parentElement.querySelector(".property-picker-chevron"), "component selects use the shared chevron, not a platform arrow");
    }
    for (const summary of document.querySelectorAll("#inspect-properties .property-picker > summary")) {
      check(summary.querySelector(".property-picker-chevron")?.textContent === "", "component pickers share the CSS chevron instead of a text glyph");
    }
    await editBorder("4");
    check(selectedComponentNode().appearance.borderWidth === 4, "component thickness is numeric");
    check(getComputedStyle(document.querySelector('[data-ds-node-id="subtle-picker"]')).borderTopWidth === "4px", "component thickness overrides borderless chrome");
    document.querySelector("#layers-undo-btn").click();
    await waitUntil(() => borderInput()?.value === "", "component thickness undo");
    document.querySelector("#layers-redo-btn").click();
    await waitUntil(() => borderInput()?.value === "4", "component thickness redo");
    document.querySelector('#inspect-properties button[aria-label="Increase Border thickness (px)"]').click();
    await waitUntil(() => borderInput()?.value === "5", "component border stepper increments pixels");
    borderInput().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    await waitUntil(() => borderInput()?.value === "4", "component border keyboard decrements pixels");
    await editBorder("-1");
    check(document.querySelector("#inspect-error").textContent && selectedComponentNode().appearance.borderWidth === 4, "invalid component thickness reports an error and rolls back");
    await editBorder("0");
    check(selectedComponentNode().appearance.borderWidth === 0 && borderInput().value === "0", "component zero thickness is preserved");
    check(getComputedStyle(document.querySelector('[data-ds-node-id="subtle-picker"]')).borderTopWidth === "0px", "component zero thickness removes border");
    document.querySelector('#inspect-properties button[aria-label="Decrease Border thickness (px)"]').click();
    await waitUntil(() => borderInput()?.value === "0", "component decrement clamps at zero");
    await editBorder("");
    check(selectedComponentNode().appearance.borderWidth === undefined, "clearing component thickness restores inheritance");
    document.querySelector("#inspect-btn").click();
    picker = await waitFor('[data-ds-node-id="subtle-picker"]');
    picker.click();
    check(!!document.querySelector(".ds-flyout"), "gallery opens flyout");
    document.querySelector('[data-theme="dark"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    check(!document.querySelector(".ds-flyout"), "gallery rerender cleans portal");
    select = await waitFor('select[aria-label="SubtlePicker preview state"]');
    check(select.value === "live" && !select.disabled, "new preview is live");
    const fresh = document.querySelector('[data-ds-node-id="subtle-picker"]');
    fresh.click();
    check(getComputedStyle(document.querySelector(".ds-flyout").firstElementChild).backgroundColor === "rgb(34, 30, 26)", "dark gallery token fidelity");
  } else {
    let picker = await waitFor('[data-ds-node-id="subtle-picker"]');
    await verifySwitch();
    check(getComputedStyle(picker).borderTopWidth === "4px" && getComputedStyle(picker).borderTopStyle === "solid", "prototype and standalone export preserve instance border thickness");
    const screenList = document.querySelector("#screen-list");
    const current = () => screenList.querySelector('[aria-current="page"]');
    const first = screenList.querySelector('[data-screen-id="preview"]');
    const second = screenList.querySelector('[data-screen-id="second"]');
    check(!document.querySelector("#screen-select"), "screen dropdown is replaced");
    check(first.textContent === "Preview" && second.textContent === "second", "screen names fall back to IDs");
    check(current() === first && first.classList.contains("is-active"), "initial current screen");
    const nav = document.querySelector(".screen-nav");
    const stage = document.querySelector(".stage");
    if (kind === "prototype") {
      for (const [id, label, heading] of [
        ["add-screen-btn", "Add screen", "Screens"],
        ["add-section-btn", "Add section", "Sections"],
      ]) {
        const add = document.getElementById(id);
        const title = add.parentElement.querySelector("h2, h3");
        const buttonRect = add.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        check(add.textContent === "+" && add.getAttribute("aria-label") === label && add.title === label, "plus controls retain accessible names and tooltips");
        check(title.textContent === heading && buttonRect.left >= titleRect.right, "plus control sits to the right of its heading");
        check(Math.abs((buttonRect.top + buttonRect.bottom) / 2 - (titleRect.top + titleRect.bottom) / 2) < 1, "plus control is vertically centered beside its heading");
        check(getComputedStyle(add).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(add).borderTopWidth === "0px", "plus controls are subtle and borderless");
        add.focus();
        check(document.activeElement === add, "plus controls support keyboard focus");
      }
    }
    const checkChrome = () => {
      const bar = getComputedStyle(document.querySelector(".topbar"));
      const sidebar = getComputedStyle(nav);
      const title = getComputedStyle(document.querySelector(".screen-nav-title"));
      const heading = getComputedStyle(document.querySelector(".topbar h1"));
      const selected = getComputedStyle(first);
      const theme = getComputedStyle(document.querySelector(".theme-btn.is-active"));
      const button = getComputedStyle(document.querySelector("#validate-btn"));
      check(sidebar.backgroundColor === bar.backgroundColor && sidebar.color === bar.color, "sidebar matches neutral toolbar colors");
      check(sidebar.borderRightColor === bar.borderBottomColor, "sidebar matches toolbar divider");
      check(title.fontFamily === heading.fontFamily && title.fontSize === heading.fontSize && title.fontWeight === heading.fontWeight, "sidebar heading matches toolbar typography");
      check(getComputedStyle(second).fontFamily === button.fontFamily && getComputedStyle(second).fontSize === button.fontSize, "screen labels match toolbar controls");
      check(selected.backgroundColor === theme.backgroundColor && selected.color === theme.color, "screen selection matches toolbar selection");
    };
    for (const theme of ["dark", "highContrast", "light"]) {
      document.querySelector(`[data-theme="${theme}"]`).click();
      checkChrome();
    }
    check(nav.getBoundingClientRect().right <= stage.getBoundingClientRect().left, "screen menu is on the left");
    check(screenList.clientHeight < screenList.scrollHeight, "long screen menu scrolls independently");
    first.focus();
    check(document.activeElement === first, "screen buttons support keyboard focus");
    picker.click();
    check(!!document.querySelector(".ds-flyout"), "standalone flyout opens");
    const zoom = document.querySelector("#zoom-select");
    zoom.value = "0.5";
    zoom.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    check(document.querySelector(".ds-flyout").style.transform.startsWith("scale(0.5"), "live export zoom updates portal");
    document.querySelector('[data-theme="highContrast"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    check(getComputedStyle(document.querySelector(".ds-flyout").firstElementChild).backgroundColor === "rgb(0, 0, 0)", "export high contrast tokens");
    checkChrome();
    document.querySelector("#rotate-btn").click();
    check(!document.querySelector(".ds-flyout"), "frame replacement cleans portal");
    picker = await waitFor('[data-ds-node-id="subtle-picker"]');
    picker.click();
    second.click();
    check(!document.querySelector(".ds-flyout"), "export navigation cleans portal");
    check(current() === second && !first.hasAttribute("aria-current"), "menu click updates current screen");
    check(!!document.querySelector('[data-ds-node-id="borderless-composer"]'), "menu click renders selected screen");
    document.querySelector("#back-btn").click();
    check(current() === first, "Back updates menu");
    first.click();
    document.querySelector("#back-btn").click();
    check(current() === first, "current-screen clicks do not add history");
    document.querySelector('[data-proto-node-id="next-screen"]').click();
    check(current() === second, "click-through navigation updates menu");
    const last = [...screenList.querySelectorAll("[data-screen-id]")].at(-1);
    last.click();
    check(current() === last && screenList.scrollTop > 0, "selected screen is scrolled into view");
    if (kind === "prototype") {
      first.click();
      document.querySelector("#inspect-btn").click();
      document.querySelector('[data-ds-node-id="subtle-picker"]').click();
      check(!document.querySelector("#json-editor").disabled, "inspect selects a layer");
      second.click();
      check(document.querySelector("#json-editor").disabled, "screen switch clears inspected selection");
      check(!!document.querySelector('#layers button[title="composer"]') && !document.querySelector('#layers button[title="picker"]'), "screen switch refreshes layers");
      check(nav.getBoundingClientRect().right <= stage.getBoundingClientRect().left, "inspector keeps menu on the left");
      document.querySelector("#inspect-btn").click();
      const add = (kind, name) => {
        document.querySelector(`#add-${kind}-btn`).click();
        check(document.querySelector("#screen-dialog").open, "add dialog opens");
        const input = document.querySelector("#screen-name");
        input.value = name;
        input.dispatchEvent(new Event("input"));
        document.querySelector("#screen-form").requestSubmit();
      };
      add("section", "Writing");
      const group = [...screenList.querySelectorAll("[data-section-id]")].find((node) => node.querySelector("h3").textContent === "Writing");
      check(!!group && group.textContent.includes("No screens yet."), "creates an empty named section");
      const groupId = group.dataset.sectionId;
      const move = document.querySelector("#screen-section");
      move.value = groupId;
      move.dispatchEvent(new Event("change"));
      check(current().closest("[data-section-id]").dataset.sectionId === groupId, "moves the selected screen into the section");
      move.value = "";
      move.dispatchEvent(new Event("change"));
      check(!current().closest("[data-section-id]"), "moves screen back to Ungrouped");
      move.value = groupId;
      move.dispatchEvent(new Event("change"));
      document.querySelector("#add-screen-btn").click();
      document.querySelector("#screen-dialog-cancel").click();
      check(!document.querySelector("#screen-dialog").open, "cancel closes add dialog");
      add("screen", "  ");
      check(document.querySelector("#screen-dialog").open && !document.querySelector("#screen-name").validity.valid, "blank names are rejected");
      document.querySelector("#screen-dialog-cancel").click();
      add("screen", "<New> screen");
      check(current().textContent === "<New> screen" && !current().querySelector("new"), "new screen name renders safely");
      check(current().closest("[data-section-id]").dataset.sectionId === groupId, "new screen inherits the chosen section");
      check(document.querySelector(".screen-surface").textContent.includes("<New> screen"), "new screen preview is selected");
      const newId = current().dataset.screenId;
      check(!document.querySelector("#nav-save-btn").disabled, "sidebar Save is available without Inspect");
      check(document.querySelector("#export-btn").disabled, "unsaved screens cannot be exported accidentally");
      document.querySelector("#validate-btn").click();
      await waitFor(".validation-popover");
      check(document.querySelector(".validation-popover").textContent.includes("No issues"), "Validate checks the edited draft");
      await fetch("/test/fail-save", { method: "POST" });
      document.querySelector("#nav-save-btn").click();
      await waitUntil(() => document.querySelector("#nav-save-status").textContent === "Save failed", "save failure is reported");
      check(document.querySelector("#screen-nav-error").textContent.includes("Test save failure") && current().dataset.screenId === newId, "failed save retains the draft and reports the error");
      document.querySelector("#nav-save-btn").click();
      await waitUntil(() => document.querySelector("#nav-save-status").textContent === "Saved", "retry saves the draft");
      const saved = await (await fetch("/api/prototypes")).json();
      check(saved.proto.doc.sections.some((section) => section.id === groupId), "section is persisted to disk");
      check(saved.proto.doc.screens.find((screen) => screen.id === newId)?.sectionId === groupId, "screen assignment is persisted to disk");
      const beforeReload = current();
      document.querySelector("#reload-btn").click();
      await waitUntil(() => current() !== null && current().dataset.screenId === newId && current() !== beforeReload, "reload restores selected screen");
      screenList.querySelector('[data-screen-id="second"]').click();
      window.confirm = () => false;
      document.querySelector("#delete-screen-btn").click();
      check(current().dataset.screenId === "second", "cancel leaves screen intact");
      window.confirm = () => true;
      document.querySelector("#delete-screen-btn").click();
      check(!screenList.querySelector('[data-screen-id="second"]'), "deletes selected screen");
      document.querySelector("#nav-save-btn").click();
      await waitUntil(() => document.querySelector("#nav-save-status").textContent === "Saved", "deletion saves");
      const deleted = await (await fetch("/api/prototypes")).json();
      check(!deleted.proto.doc.screens[0].root.children[1].on, "deletion removes incoming navigation");
      check(deleted.proto.doc.flows.length === 1 && deleted.proto.doc.flows[0].start === "preview", "deletion removes only flows starting at deleted screen");
      while (screenList.querySelector("[data-screen-id]")) document.querySelector("#delete-screen-btn").click();
      check(!current() && document.querySelector("#delete-screen-btn").disabled, "deleting last screen leaves usable empty state");
      check(document.querySelector("#screen-section").disabled, "empty state disables section assignment");
      document.querySelector("#nav-save-btn").click();
      await waitUntil(() => document.querySelector("#nav-save-status").textContent === "Saved", "empty prototype saves");
      check((await (await fetch("/api/prototypes")).json()).proto.doc.screens.length === 0, "empty prototype persists");
      add("screen", "Fresh start");
      check(current()?.textContent === "Fresh start", "can add a screen from empty state");
      document.querySelector("#nav-save-btn").click();
      await waitUntil(() => document.querySelector("#nav-save-status").textContent === "Saved", "fresh screen saves");
    } else {
      check(!!screenList.querySelector('[data-section-id="existing"]'), "export preserves sidebar sections");
      check(!document.querySelector("#add-screen-btn") && !document.querySelector("#delete-screen-btn") && !document.querySelector("#add-section-btn"), "export omits authoring controls");
    }
  }
  DSInteractions.closeOverlay();
}

test("gallery, prototype shell and self-contained export wire interactions end to end", { timeout: 120000 }, async (t) => {
  const browser = await browserPath();
  if (!browser) { t.skip("Set COLOPHON_BROWSER to run gallery/export browser coverage."); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), "colophon-shell-browser-"));
  const asset = (name) => readFile(new URL(name, import.meta.url), "utf8");
  const [tokens, componentsDoc] = await Promise.all([
    asset("sample/design.json").then(JSON.parse), asset("sample/components.jsonc").then(parseComponents),
  ]);
  const bundle = {
    design: { source: "repo", tokens, componentsDoc },
    proto: { source: "repo", doc: { screens: [
      { id: "preview", name: "Preview", device: "responsive", root: { id: "preview-root", layout: "stack", children: [
        { id: "picker", component: "SubtlePicker", appearance: { borderWidth: 4, borderColor: "accent" } },
        { id: "next-screen", text: "Next", on: { tap: { navigate: "second" } } },
        { id: "switch", component: "ToggleSwitch" },
        { id: "other-switch", component: "ToggleSwitch" },
      ] } },
      { id: "second", root: { id: "composer", component: "BorderlessComposer" } },
      ...Array.from({ length: 30 }, (_, index) => ({
        id: `screen-${index}`, name: `Screen ${index} with a long descriptive name that wraps`, sectionId: "existing",
        root: { id: `text-${index}`, text: `Screen ${index}` },
      })),
    ], sections: [{ id: "existing", name: "Existing" }], state: {}, flows: [{ id: "home", start: "preview" }, { id: "compose", start: "second" }] } },
    validation: { ok: true, errors: [], warnings: [] }, outline: "# Preview",
  };
  const inject = (html, kind) => html.replace("</body>", `<script>(async () => {
    const result = document.createElement("pre"); result.id = "browser-result";
    document.body.append(result);
    try {
      ${kind === "inspect"
        ? 'await (await import("/inspect-browser-scenario.mjs")).inspectWorkspaceBehavior();'
        : `await (${shellBehavior.toString()})(${JSON.stringify(kind)});`}
      result.textContent = "PASS";
    }
    catch (error) { result.textContent = "FAIL " + error.stack; }
    document.body.append(result);
    })();</script></body>`);
  const compactBundle = (grouped) => ({
    ...bundle,
    proto: { ...bundle.proto, doc: {
      state: {}, flows: [], sections: grouped ? [{ id: "only", name: "Only section" }] : [],
      screens: ["first", "second"].map((id) => ({
        id, name: id, ...(grouped ? { sectionId: "only" } : {}),
        root: { id: `${id}-root`, text: id },
      })),
    } },
  });
  const resources = new Map([
    ["/", ["text/html", inject(renderShell(), "gallery")]],
    ["/brand", ["text/html", inject(renderShell(), "brand")]],
    ["/component-pages", ["text/html", inject(renderShell(), "component-pages")]],
    ["/inspect", ["text/html", inject(renderShell(), "inspect")]],
    ["/prototype", ["text/html", inject(renderProtoShell(), "prototype")]],
    ["/compact", ["text/html", inject(renderProtoShell(), "compact")]],
    ["/api/prototypes", ["application/json", JSON.stringify(bundle)]],
    ["/api/prototypes/select", ["application/json", "{}"]],
    ["/api/design", ["application/json", JSON.stringify({ design: bundle.design })]],
    ["/api/design/select", ["application/json", "{}"]],
    ["/events", ["text/event-stream", ": connected\n\n"]],
  ]);
  for (const name of ["client.js", "styles.css", "inspect-workspace.js", "inspect-workspace.css", "editor-workspace.js", "editor-geometry.js", "shape-geometry.js", "inspect-browser-scenario.mjs", "creation-toolbar-scenario.mjs", "proto-editor-model.js", "proto-workspace.js", "property-controls.js", "property-controls.css", "components-render.mjs", "componentsio.mjs", "components-interactions.js", "components-interactions.css", "proto.css", "proto-client.js", "proto-layout.js", "proto-render.js", "proto-properties.js", "components-runtime.js"]) {
    resources.set(`/${name}`, [name.endsWith(".css") ? "text/css" : "text/javascript", await asset(name)]);
  }
  let prototypeWorkspace;
  let brandWorkspace;
  let savedPrototype = false;
  let savedComponents = false;
  let failSave = false;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/api/components/save") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const { doc } = JSON.parse(Buffer.concat(chunks).toString());
        await saveComponents(prototypeWorkspace, doc);
        savedComponents = true;
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
        return;
      }
      if (request.url === "/api/design" && savedComponents) {
        const componentsDoc = parseComponents(await readFile(path.join(prototypeWorkspace, ".agents", "design", "components.jsonc"), "utf8"));
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ design: { ...bundle.design, componentsDoc } }));
        return;
      }
      if (request.url === "/test/fail-save") {
        failSave = true;
        response.writeHead(200).end();
        return;
      }
      if (request.url === "/api/save") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const { tokens, revision } = JSON.parse(Buffer.concat(chunks).toString());
        const saved = await saveTokens(brandWorkspace, tokens, { revision });
        resources.set("/api/design", ["application/json", JSON.stringify({ design: await loadDesign(brandWorkspace) })]);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(saved));
        return;
      }
      if (request.url === "/api/prototypes/save" || request.url === "/api/prototypes/validate") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const { doc } = JSON.parse(Buffer.concat(chunks).toString());
        const validation = validatePrototypes(doc);
        if (request.url.endsWith("/validate")) {
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(validation));
          return;
        }
        if (failSave || !validation.ok) {
          failSave = false;
          response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "Test save failure", validation }));
          return;
        }
        await savePrototypes(prototypeWorkspace, doc);
        savedPrototype = true;
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, validation }));
        return;
      }
      if (request.url === "/api/prototypes" && savedPrototype) {
        const proto = await loadPrototypes(prototypeWorkspace);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...bundle, proto }));
        return;
      }
      const item = resources.get(request.url);
      response.writeHead(item ? 200 : 404, { "content-type": item?.[0] || "text/plain" });
      response.end(item?.[1] || "Not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }));
    }
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const exportBundle = { ...bundle, design: { ...bundle.design, tokens: {
      ...tokens, pages: [{ id: "components", name: "Components", components: [] }],
    } } };
    const exported = inject(await buildPrototypeExportHtml(exportBundle), "export").replace("<body>", `<body><script>
      window.addEventListener("error", event => document.body.dataset.testError = event.message);
      window.addEventListener("unhandledrejection", event => document.body.dataset.testError = String(event.reason));
      </script>`);
    await writeFile(path.join(dir, "export.html"), exported);
    await writeFile(path.join(dir, "compact-export.html"), inject(await buildPrototypeExportHtml(compactBundle(true)), "compact"));
    const scenarios = [
      ["brand", `http://127.0.0.1:${server.address().port}/brand`],
      ["brand-narrow", `http://127.0.0.1:${server.address().port}/brand`],
      ["gallery", `http://127.0.0.1:${server.address().port}`],
      ["component-pages", `http://127.0.0.1:${server.address().port}/component-pages`],
      ["inspect", `http://127.0.0.1:${server.address().port}/inspect`],
      ["inspect-narrow", `http://127.0.0.1:${server.address().port}/inspect`],
      ["prototype", `http://127.0.0.1:${server.address().port}/prototype`],
      ["prototype-narrow", `http://127.0.0.1:${server.address().port}/prototype`],
      ["export", pathToFileURL(path.join(dir, "export.html")).href],
      ["export-reduced-motion", pathToFileURL(path.join(dir, "export.html")).href],
      ["compact-flat", `http://127.0.0.1:${server.address().port}/compact`],
      ["compact-section", `http://127.0.0.1:${server.address().port}/compact`],
      ["compact-export", pathToFileURL(path.join(dir, "compact-export.html")).href],
    ];
    const selected = process.env.COLOPHON_BROWSER_CASES?.split(",");
    if (selected) assert.ok(selected.every((name) => scenarios.some(([scenario]) => scenario === name)), "COLOPHON_BROWSER_CASES contains an unknown scenario.");
    for (const [name, url] of scenarios) {
      if (selected && !selected.includes(name)) continue;
      resources.set("/api/prototypes", ["application/json", JSON.stringify(name.startsWith("compact") ? compactBundle(name !== "compact-flat") : bundle)]);
      prototypeWorkspace = path.join(dir, `${name}-repo`);
      let design = structuredClone(bundle.design);
      if (name.startsWith("brand") || name === "component-pages") {
        brandWorkspace = prototypeWorkspace;
        const initialTokens = structuredClone(tokens);
        if (name === "component-pages") initialTokens.pages = [
          { id: "components", name: "Components", components: ["Badge", "Button"] },
          { id: "publishing", name: "Publishing", components: ["ExampleScreen", "SubtlePicker"] },
        ];
        await saveTokens(brandWorkspace, initialTokens);
        design = await loadDesign(brandWorkspace);
      }
      savedPrototype = false;
      savedComponents = false;
      failSave = false;
      if (name.startsWith("inspect")) design.componentsDoc.components.push({ name: "InspectFixture", root: {
        id: "inspect-board", el: "div", layout: { mode: "freeform", width: 560, height: 400 }, children: [
          { id: "inspect-flow", el: "div", layout: { mode: "vertical", width: 200, height: 160 },
            position: { mode: "absolute", x: 300, y: 200 }, children: [] },
        ],
      } });
      resources.set("/api/design", ["application/json", JSON.stringify({ design })]);
      const { stdout } = await promisify(execFile)(browser, [
        "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
        ...(name === "export-reduced-motion" ? ["--force-prefers-reduced-motion=reduce"] : []),
        `--window-size=${name.endsWith("-narrow") ? "700,900" : "1400,1000"}`,
        `--user-data-dir=${path.join(dir, name)}`, "--dump-dom", "--virtual-time-budget=8000", url,
      ], { timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
      const result = stdout.match(/<pre id="browser-result">([\s\S]*?)<\/pre>/)?.[1];
      assert.equal(result, "PASS", `${name}: ${result}; ${stdout.match(/<body[^>]*>/)?.[0]}`);
      if (name === "component-pages") {
        const persisted = await loadDesign(brandWorkspace);
        assert.deepEqual(persisted.tokens.pages, [
          { id: "components", name: "Components", components: ["Badge", "Button"] },
          { id: "publishing", name: "Publishing", components: ["ExampleScreen", "SubtlePicker"] },
        ]);
        assert.deepEqual(persisted.componentsDoc, componentsDoc);
      }
      if (name.startsWith("brand")) {
        const persisted = await loadDesign(brandWorkspace);
        assert.equal(persisted.format, "markdown");
        assert.equal(persisted.tokens.brand.name, "Northlight notes");
        assert.deepEqual(persisted.tokens.brand.personality, ["calm", "precise"]);
        assert.equal(persisted.tokens.authority.owner, "@northlight");
      }
      if (name.startsWith("prototype")) {
        const persisted = await loadPrototypes(prototypeWorkspace);
        assert.equal(persisted.source, "repo");
        assert.equal(persisted.doc.screens.length, 1);
        assert.equal(persisted.doc.screens[0].name, "Fresh start");
        assert.equal(persisted.doc.sections.length, 2);
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
