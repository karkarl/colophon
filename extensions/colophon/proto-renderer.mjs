// proto-renderer.mjs — the iframe shell for the Prototype canvas. Real UI lives in
// proto-client.js / proto.css (served statically) and proto-render.js (the interpreter).

export function renderProtoShell() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Prototype</title>
    <link rel="stylesheet" href="/proto.css" />
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
      <label>Screen
        <select id="screen-select"></select>
      </label>
    </div>

    <div id="outline-slot"></div>
    <div class="workspace">
      <div class="stage">
        <div id="validation-slot" aria-live="polite"></div>
        <div id="frame-wrap" class="frame-wrap"></div>
      </div>
      <aside id="inspector" class="inspector" hidden>
        <div class="inspector-head">
          <div>
            <div class="inspector-title">Layers</div>
            <div id="save-status" class="save-status">Saved</div>
          </div>
          <button type="button" id="save-btn" class="btn primary" disabled>Save</button>
        </div>
        <div id="layers" class="layers" aria-label="Prototype layers"></div>
        <div class="element-editor">
          <div class="editor-head">
            <div>
              <div id="selection-title" class="inspector-title">No selection</div>
              <code id="selection-path" class="selection-path"></code>
            </div>
            <button type="button" id="attach-btn" class="btn" disabled>Attach to chat</button>
          </div>
          <textarea id="json-editor" aria-label="Selected element JSON" spellcheck="false" disabled></textarea>
          <div class="editor-actions">
            <span id="editor-error" class="editor-error" role="alert"></span>
            <button type="button" id="apply-json-btn" class="btn" disabled>Apply JSON</button>
          </div>
        </div>
      </aside>
    </div>

    <script src="/components-runtime.js"></script>
    <script src="/proto-render.js"></script>
    <script src="/proto-client.js"></script>
  </body>
</html>`;
}
