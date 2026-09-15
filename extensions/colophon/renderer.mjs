// renderer.mjs — the iframe shell. All the real UI lives in client.js / styles.css,
// which the loopback server serves statically. Keeping the shell tiny avoids
// template-escaping pain and lets us edit the app without touching wiring.

export function renderShell() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Design System</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="topbar">
      <h1>Design System</h1>
      <span id="source-pill" class="source-pill">loading…</span>
      <span class="grow"></span>
      <button type="button" id="inspect-btn" class="btn" title="Inspect and edit exact design-system JSON" aria-pressed="false">Inspect</button>
      <button type="button" id="reload-btn" class="btn icon-btn" aria-label="Reload from disk" title="Reload from disk">↻</button>
      <div id="theme-switch" class="theme-switch" role="group" aria-label="Preview theme">
        <button type="button" class="theme-btn is-active" data-theme="light" aria-pressed="true" title="Light theme preview">Light</button>
        <button type="button" class="theme-btn" data-theme="dark" aria-pressed="false" title="Dark theme preview">Dark</button>
        <button type="button" class="theme-btn" data-theme="highContrast" aria-pressed="false" title="High-contrast theme preview">High&nbsp;contrast</button>
      </div>
      <button type="button" id="validate-btn" class="btn" title="Validate the design system for drift">Validate</button>
      <div class="split-button">
        <button type="button" id="export-btn" class="btn primary" title="Write a standalone HTML export">Export</button>
        <button type="button" id="export-menu-btn" class="btn primary split-toggle" aria-label="Export options" aria-expanded="false" aria-haspopup="menu">▾</button>
        <div id="export-menu" class="split-menu" role="menu" hidden>
          <button type="button" id="publish-btn" role="menuitem">Publish to GitHub Pages</button>
        </div>
      </div>
      <button type="button" id="save-btn" class="btn primary" disabled>Save to repo</button>
    </div>
    <div id="validation-slot" aria-live="polite"></div>
    <aside id="component-layers" class="component-layers" hidden>
      <div class="inspector-panel-head">
        <div>
          <strong>Layers</strong>
          <span class="panel-hint">components.jsonc</span>
        </div>
        <div class="history-actions">
          <button type="button" id="layers-undo-btn" class="panel-icon-btn" title="Undo" aria-label="Undo" disabled>↶</button>
          <button type="button" id="layers-redo-btn" class="panel-icon-btn" title="Redo" aria-label="Redo" disabled>↷</button>
        </div>
      </div>
      <div id="component-layer-tree" class="component-layer-tree"></div>
      <div class="layer-actions">
        <button type="button" id="layers-duplicate-btn" class="btn" disabled>Duplicate</button>
        <button type="button" id="layers-delete-btn" class="btn danger" disabled>Delete</button>
      </div>
    </aside>
    <div class="wrap"><div id="app"></div></div>
    <aside id="design-inspector" class="design-inspector" hidden>
      <div class="design-inspector-head">
        <div>
          <div id="inspect-title" class="inspect-title">No selection</div>
          <code id="inspect-path" class="inspect-path"></code>
        </div>
        <button type="button" id="inspect-attach-btn" class="btn" disabled>Send to chat</button>
      </div>
      <div class="inspector-tabs" role="tablist" aria-label="Inspector view">
        <button type="button" id="properties-tab" role="tab" aria-selected="true" class="is-active">Properties</button>
        <button type="button" id="json-tab" role="tab" aria-selected="false">JSON</button>
      </div>
      <div id="inspect-properties" class="inspector-panel" role="tabpanel"></div>
      <div id="inspect-json-panel" class="inspector-panel json-panel" role="tabpanel" hidden>
        <textarea id="inspect-json" aria-label="Selected design-system JSON" spellcheck="false" disabled></textarea>
        <div class="design-inspector-actions">
          <span></span>
          <button type="button" id="inspect-apply-btn" class="btn primary" disabled>Apply JSON</button>
        </div>
      </div>
      <div class="inspector-status">
        <span id="inspect-error" role="alert"></span>
      </div>
    </aside>
    <link rel="stylesheet" href="/components-interactions.css" />
    <script src="/components-interactions.js"></script>
    <script type="module" src="/components-render.mjs"></script>
    <script src="/client.js"></script>
  </body>
</html>`;
}
