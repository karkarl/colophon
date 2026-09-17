// proto-renderer.mjs — the iframe shell for the Prototype canvas. Real UI lives in
// proto-client.js / proto.css (served statically) and proto-render.js (the interpreter).

export function renderScreenNav({ editable = false } = {}) {
  return `<nav class="screen-nav" aria-labelledby="screen-nav-title">
      <div class="screen-nav-heading">
        <h2 id="screen-nav-title" class="screen-nav-title">Screens</h2>
        ${editable ? `<button type="button" id="add-screen-btn" class="screen-nav-add" aria-label="Add screen" title="Add screen">+</button>` : ""}
      </div>
      ${editable ? `<div id="screen-sections-heading" class="screen-nav-heading" hidden>
        <h3 class="screen-nav-subtitle">Sections</h3>
        <button type="button" id="add-section-btn" class="screen-nav-add" aria-label="Add section" title="Add section">+</button>
      </div>` : ""}
      <ul id="screen-list" class="screen-nav-list"></ul>
      ${editable ? `<div class="screen-nav-editor">
        <label for="screen-section">Selected screen's section</label>
        <select id="screen-section" disabled></select>
        <button type="button" id="delete-screen-btn" class="btn" disabled>Delete screen</button>
        <div class="screen-nav-save">
          <span id="nav-save-status" class="save-status" role="status">Saved</span>
          <button type="button" id="nav-save-btn" class="btn primary" disabled>Save</button>
        </div>
        <div id="screen-nav-error" class="editor-error" role="alert"></div>
      </div>` : ""}
    </nav>`;
}

export function renderProtoShell() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Prototype</title>
    <link rel="stylesheet" href="/proto.css" />
    <link rel="stylesheet" href="/property-controls.css" />
  </head>
  <body>
    <div class="topbar">
      <h1>Prototype</h1>
      <button type="button" id="source-pill" class="source-pill">loading…</button>
      <span class="grow"></span>
      <button type="button" id="reload-btn" class="btn icon-btn" aria-label="Reload from disk" title="Reload from disk">↻</button>
      <div id="theme-switch" class="theme-switch" role="group" aria-label="Preview theme">
        <button type="button" class="theme-btn is-active" data-theme="light" aria-pressed="true">Light</button>
        <button type="button" class="theme-btn" data-theme="dark" aria-pressed="false">Dark</button>
        <button type="button" class="theme-btn" data-theme="highContrast" aria-pressed="false">High&nbsp;contrast</button>
      </div>
      <button type="button" id="outline-btn" class="btn" title="Show the flow outline" aria-pressed="false">Outline</button>
      <button type="button" id="validate-btn" class="btn" title="Validate the prototype">Validate</button>
      <div class="split-button">
        <button type="button" id="export-btn" class="btn primary" title="Write a standalone HTML export">Export</button>
        <button type="button" id="export-menu-btn" class="btn primary split-toggle" aria-label="Export options" aria-expanded="false" aria-haspopup="menu">▾</button>
        <div id="export-menu" class="split-menu" role="menu" hidden>
          <button type="button" id="publish-btn" role="menuitem">Publish to GitHub Pages</button>
        </div>
      </div>
    </div>

    <div class="devbar">
      <label>Device
        <select id="device-select"></select>
      </label>
      <span class="seg">
        <input type="number" id="w" class="size" aria-label="Width" />
        <span class="dim">&nbsp;×&nbsp;</span>
        <input type="number" id="h" class="size" aria-label="Height" />
      </span>
      <button type="button" id="rotate-btn" class="btn" title="Rotate">⟳ Rotate</button>
      <label>Zoom
        <select id="zoom-select">
          <option value="fit">Fit</option>
          <option value="1">100%</option>
          <option value="0.75">75%</option>
          <option value="0.5">50%</option>
        </select>
      </label>
      <span class="grow"></span>
      <button type="button" id="inspect-btn" class="btn" title="Inspect and edit prototype layers" aria-pressed="false">Inspect</button>
      <button type="button" id="back-btn" class="btn" title="Back">←</button>
    </div>

    <div id="outline-slot"></div>
    <div class="prototype-layout">
      <aside id="layers-panel" class="layers-panel" aria-labelledby="layers-title" hidden>
        <div class="inspector-head">
          <div id="layers-title" class="inspector-title">Layers</div>
          <div class="layers-history" role="group" aria-label="Edit history">
            <button type="button" id="layers-undo-btn" class="btn icon-btn" title="Undo" aria-label="Undo" disabled>↶</button>
            <button type="button" id="layers-redo-btn" class="btn icon-btn" title="Redo" aria-label="Redo" disabled>↷</button>
          </div>
        </div>
        <div id="layers" class="layers" aria-label="Prototype layers"></div>
        <div class="layers-actions">
          <button type="button" id="layers-duplicate-btn" class="btn" disabled>Duplicate</button>
          <button type="button" id="layers-delete-btn" class="btn danger" disabled>Delete</button>
        </div>
      </aside>
      ${renderScreenNav({ editable: true })}
    <div class="workspace">
      <div class="stage">
        <div id="validation-slot" aria-live="polite"></div>
        <div id="frame-wrap" class="frame-wrap"></div>
      </div>
      <aside id="inspector" class="inspector" hidden>
        <div class="inspector-head">
          <div>
            <div class="inspector-title">Layer editor</div>
            <div id="save-status" class="save-status">Saved</div>
          </div>
          <button type="button" id="save-btn" class="btn primary" disabled>Save</button>
        </div>
        <div class="element-editor">
          <div class="editor-head">
            <div>
              <div id="selection-title" class="inspector-title">No selection</div>
              <code id="selection-path" class="selection-path"></code>
            </div>
            <button type="button" id="attach-btn" class="btn" disabled>Send to chat</button>
          </div>
          <div class="inspector-tabs" role="tablist" aria-label="Layer editor">
            <button type="button" id="properties-tab" class="is-active" role="tab" aria-selected="true" aria-controls="proto-properties">Properties</button>
            <button type="button" id="json-tab" role="tab" aria-selected="false" aria-controls="proto-json-panel">JSON</button>
          </div>
          <div id="proto-properties" role="tabpanel" aria-labelledby="properties-tab"></div>
          <div id="proto-json-panel" role="tabpanel" aria-labelledby="json-tab" hidden>
            <textarea id="json-editor" aria-label="Selected element JSON" spellcheck="false" disabled></textarea>
            <div class="editor-actions">
              <button type="button" id="apply-json-btn" class="btn" disabled>Apply JSON</button>
            </div>
          </div>
          <div id="editor-error" class="editor-error" role="alert"></div>
        </div>
      </aside>
    </div>
    </div>

    <dialog id="screen-dialog" class="screen-dialog" aria-labelledby="screen-dialog-title">
      <form id="screen-form">
        <h2 id="screen-dialog-title">Add screen</h2>
        <label for="screen-name">Name</label>
        <input id="screen-name" name="name" required maxlength="120" autocomplete="off" />
        <label id="new-screen-section-field">Section
          <select id="new-screen-section"></select>
        </label>
        <label id="new-section-name-field" hidden>New section name
          <input id="new-section-name" required disabled maxlength="120" autocomplete="off" />
        </label>
        <div class="editor-actions">
          <button type="button" id="screen-dialog-cancel" class="btn">Cancel</button>
          <button type="submit" class="btn primary">Add</button>
        </div>
      </form>
    </dialog>

    <link rel="stylesheet" href="/components-interactions.css" />
    <script src="/components-interactions.js"></script>
    <script src="/components-runtime.js"></script>
    <script src="/proto-layout.js"></script>
    <script src="/proto-render.js"></script>
    <script src="/property-controls.js"></script>
    <script src="/proto-properties.js"></script>
    <script src="/proto-client.js"></script>
  </body>
</html>`;
}
