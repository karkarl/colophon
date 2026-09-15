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
import { buildPrototypeExportHtml } from "./prototypeexport.mjs";

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
    document.querySelector("#inspect-btn").click();
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
    document.querySelector("#rotate-btn").click();
    check(!document.querySelector(".ds-flyout"), "frame replacement cleans portal");
    picker = await waitFor('[data-ds-node-id="subtle-picker"]');
    picker.click();
    const screens = document.querySelector("#screen-select");
    screens.value = "second";
    screens.dispatchEvent(new Event("change"));
    check(!document.querySelector(".ds-flyout"), "export navigation cleans portal");
  }
  DSInteractions.closeOverlay();
}

test("gallery shell and self-contained export wire interactions end to end", { timeout: 60000 }, async (t) => {
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
      { id: "preview", title: "Preview", device: "responsive", root: { id: "picker", component: "SubtlePicker" } },
      { id: "second", title: "Second", root: { id: "composer", component: "BorderlessComposer" } },
    ], state: {}, flows: [] } },
    validation: { ok: true, errors: [], warnings: [] }, outline: "# Preview",
  };
  const inject = (html, kind) => html.replace("</body>", `<script>(async () => {
    const result = document.createElement("pre"); result.id = "browser-result";
    document.body.append(result);
    try { await (${shellBehavior.toString()})(${JSON.stringify(kind)}); result.textContent = "PASS"; }
    catch (error) { result.textContent = "FAIL " + error.stack; }
    document.body.append(result);
    })();</script></body>`);
  const resources = new Map([
    ["/", ["text/html", inject(renderShell(), "gallery")]],
    ["/api/design", ["application/json", JSON.stringify({ design: bundle.design })]],
    ["/api/design/select", ["application/json", "{}"]],
    ["/events", ["text/event-stream", ": connected\n\n"]],
  ]);
  for (const name of ["client.js", "styles.css", "components-render.mjs", "componentsio.mjs", "components-interactions.js", "components-interactions.css"]) {
    resources.set(`/${name}`, [name.endsWith(".css") ? "text/css" : "text/javascript", await asset(name)]);
  }
  const server = createServer((request, response) => {
    const item = resources.get(request.url);
    response.writeHead(item ? 200 : 404, { "content-type": item?.[0] || "text/plain" });
    response.end(item?.[1] || "Not found");
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const exported = inject(await buildPrototypeExportHtml(bundle), "export").replace("<body>", `<body><script>
      window.addEventListener("error", event => document.body.dataset.testError = event.message);
      window.addEventListener("unhandledrejection", event => document.body.dataset.testError = String(event.reason));
      </script>`);
    await writeFile(path.join(dir, "export.html"), exported);
    for (const [name, url] of [
      ["gallery", `http://127.0.0.1:${server.address().port}`],
      ["export", pathToFileURL(path.join(dir, "export.html")).href],
    ]) {
      const { stdout } = await promisify(execFile)(browser, [
        "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
        `--user-data-dir=${path.join(dir, name)}`, "--dump-dom", "--virtual-time-budget=8000", url,
      ], { timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
      const result = stdout.match(/<pre id="browser-result">([\s\S]*?)<\/pre>/)?.[1];
      assert.equal(result, "PASS", `${name}: ${result}; ${stdout.match(/<body[^>]*>/)?.[0]}`);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
