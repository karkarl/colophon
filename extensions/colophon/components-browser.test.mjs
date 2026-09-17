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

async function behavior(DS, doc, motionOnly = false) {
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
    await Promise.all([writeFile(path.join(dir, "componentsio.mjs"), io), writeFile(path.join(dir, "components-render.mjs"), esm)]);
    const html = `<!doctype html><meta charset="utf-8"><style>${styles}\n${css}
    :root { --color-ink:#1c1a17;--color-muted:#6b6459;--color-accent:#b5502a;--color-paper:#f7f4ee;--color-surface:#fff;--color-line:#e4ddd0;--space-2:8px;--space-3:12px;--space-4:16px;--radius-md:8px;--font-body:sans-serif; }
    </style><body><script>${interactions}</script><script>${classic}</script><script type="module">
    const result = document.createElement("pre"); result.id = "browser-result";
    try {
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
    try { await (${shellBehavior.toString()})(${JSON.stringify(kind)}); result.textContent = "PASS"; }
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
    ["/prototype", ["text/html", inject(renderProtoShell(), "prototype")]],
    ["/compact", ["text/html", inject(renderProtoShell(), "compact")]],
    ["/api/prototypes", ["application/json", JSON.stringify(bundle)]],
    ["/api/prototypes/select", ["application/json", "{}"]],
    ["/api/design", ["application/json", JSON.stringify({ design: bundle.design })]],
    ["/api/design/select", ["application/json", "{}"]],
    ["/events", ["text/event-stream", ": connected\n\n"]],
  ]);
  for (const name of ["client.js", "styles.css", "property-controls.js", "property-controls.css", "components-render.mjs", "componentsio.mjs", "components-interactions.js", "components-interactions.css", "proto.css", "proto-client.js", "proto-layout.js", "proto-render.js", "proto-properties.js", "components-runtime.js"]) {
    resources.set(`/${name}`, [name.endsWith(".css") ? "text/css" : "text/javascript", await asset(name)]);
  }
  let prototypeWorkspace;
  let savedPrototype = false;
  let failSave = false;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/test/fail-save") {
        failSave = true;
        response.writeHead(200).end();
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
    const exported = inject(await buildPrototypeExportHtml(bundle), "export").replace("<body>", `<body><script>
      window.addEventListener("error", event => document.body.dataset.testError = event.message);
      window.addEventListener("unhandledrejection", event => document.body.dataset.testError = String(event.reason));
      </script>`);
    await writeFile(path.join(dir, "export.html"), exported);
    await writeFile(path.join(dir, "compact-export.html"), inject(await buildPrototypeExportHtml(compactBundle(true)), "compact"));
    for (const [name, url] of [
      ["gallery", `http://127.0.0.1:${server.address().port}`],
      ["prototype", `http://127.0.0.1:${server.address().port}/prototype`],
      ["prototype-narrow", `http://127.0.0.1:${server.address().port}/prototype`],
      ["export", pathToFileURL(path.join(dir, "export.html")).href],
      ["compact-flat", `http://127.0.0.1:${server.address().port}/compact`],
      ["compact-section", `http://127.0.0.1:${server.address().port}/compact`],
      ["compact-export", pathToFileURL(path.join(dir, "compact-export.html")).href],
    ]) {
      resources.set("/api/prototypes", ["application/json", JSON.stringify(name.startsWith("compact") ? compactBundle(name !== "compact-flat") : bundle)]);
      prototypeWorkspace = path.join(dir, `${name}-repo`);
      savedPrototype = false;
      failSave = false;
      const { stdout } = await promisify(execFile)(browser, [
        "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
        `--window-size=${name === "prototype-narrow" ? "700,900" : "1400,1000"}`,
        `--user-data-dir=${path.join(dir, name)}`, "--dump-dom", "--virtual-time-budget=8000", url,
      ], { timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
      const result = stdout.match(/<pre id="browser-result">([\s\S]*?)<\/pre>/)?.[1];
      assert.equal(result, "PASS", `${name}: ${result}; ${stdout.match(/<body[^>]*>/)?.[0]}`);
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
