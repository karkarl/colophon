import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { designDirFor } from "./designio.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROTOTYPE_EXPORT_DIRNAME = "prototype-export";

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function inlineScript(source) {
  return source.replace(/<\/script/gi, "<\\/script");
}

async function readAsset(name) {
  return fs.readFile(path.join(HERE, name), "utf8");
}

export function prototypeExportDir(workspacePath) {
  const designDir = designDirFor(workspacePath);
  return designDir ? path.join(designDir, PROTOTYPE_EXPORT_DIRNAME) : null;
}

export async function buildPrototypeExportHtml({ design, proto, validation, outline }) {
  const [styles, componentsRuntime, protoRuntime, client] = await Promise.all([
    readAsset("proto.css"),
    readAsset("components-runtime.js"),
    readAsset("proto-render.js"),
    readAsset("proto-client.js"),
  ]);
  const data = {
    design: {
      tokens: design.tokens,
      componentsDoc: design.componentsDoc || { meta: { version: 1 }, components: [] },
      source: design.source,
    },
    proto: {
      doc: proto.doc,
      source: proto.source,
      parseError: proto.parseError || null,
    },
    validation,
    outline,
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="generator" content="Colophon Prototype Export" />
    <title>Prototype</title>
    <style>${styles}</style>
  </head>
  <body>
    <div class="topbar">
      <h1>Prototype</h1>
      <span id="source-pill" class="source-pill repo">Standalone export</span>
      <span class="grow"></span>
      <div id="theme-switch" class="theme-switch" role="group" aria-label="Preview theme">
        <button type="button" class="theme-btn is-active" data-theme="light" aria-pressed="true">Light</button>
        <button type="button" class="theme-btn" data-theme="dark" aria-pressed="false">Dark</button>
        <button type="button" class="theme-btn" data-theme="highContrast" aria-pressed="false">High contrast</button>
      </div>
      <button type="button" id="outline-btn" class="btn" title="Show the flow outline">Outline</button>
      <button type="button" id="validate-btn" class="btn" title="Validate the prototype">Validate</button>
      <button type="button" id="reload-btn" class="btn" title="Restart the prototype">Restart</button>
    </div>
    <div class="devbar">
      <label>Device <select id="device-select"></select></label>
      <span class="seg">
        <input type="number" id="w" class="size" aria-label="Width" />
        <span class="dim">&nbsp;×&nbsp;</span>
        <input type="number" id="h" class="size" aria-label="Height" />
      </span>
      <button type="button" id="rotate-btn" class="btn" title="Rotate">Rotate</button>
      <label>Zoom <select id="zoom-select"><option value="fit">Fit</option><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label>
      <span class="grow"></span>
      <button type="button" id="back-btn" class="btn" title="Back">Back</button>
      <label>Screen <select id="screen-select"></select></label>
    </div>
    <div id="validation-slot" aria-live="polite"></div>
    <div id="outline-slot"></div>
    <div class="stage"><div id="frame-wrap" class="frame-wrap"></div></div>
    <script>window.__COLOPHON_PROTOTYPE_EXPORT__ = ${safeJson(data)};</script>
    <script>${inlineScript(componentsRuntime)}</script>
    <script>${inlineScript(protoRuntime)}</script>
    <script>${inlineScript(client)}</script>
  </body>
</html>
`;
}

export async function writePrototypeExport(workspacePath, bundle) {
  const dir = prototypeExportDir(workspacePath);
  if (!dir) throw new Error("No workspace path available to export the prototype");
  await fs.mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, "index.html");
  try {
    if ((await fs.lstat(outputPath)).isSymbolicLink()) throw new Error(`Refusing to overwrite symlinked export at ${outputPath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryPath = `${outputPath}.tmp`;
  await fs.writeFile(temporaryPath, bundle, "utf8");
  await fs.rename(temporaryPath, outputPath);
  return { dir, path: outputPath };
}
