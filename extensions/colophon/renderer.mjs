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
      <div id="theme-switch" class="theme-switch" role="group" aria-label="Preview theme">
        <button type="button" class="theme-btn is-active" data-theme="light" aria-pressed="true" title="Light theme preview">Light</button>
        <button type="button" class="theme-btn" data-theme="dark" aria-pressed="false" title="Dark theme preview">Dark</button>
        <button type="button" class="theme-btn" data-theme="highContrast" aria-pressed="false" title="High-contrast theme preview">High&nbsp;contrast</button>
      </div>
      <button type="button" id="validate-btn" class="btn" title="Validate the design system for drift">Validate</button>
      <button type="button" id="reload-btn" class="btn" title="Reload from disk">Reload</button>
      <button type="button" id="save-btn" class="btn primary" disabled>Save to repo</button>
    </div>
    <div id="validation-slot" aria-live="polite"></div>
    <div class="wrap"><div id="app"></div></div>
    <script src="/client.js"></script>
  </body>
</html>`;
}
