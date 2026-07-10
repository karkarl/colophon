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
      <button id="reload-btn" class="btn" title="Reload from disk">Reload</button>
      <button id="save-btn" class="btn primary" disabled>Save to repo</button>
    </div>
    <div class="wrap"><div id="app"></div></div>
    <script src="/client.js"></script>
  </body>
</html>`;
}
