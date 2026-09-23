import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, appendFile, rename } from "node:fs/promises";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const sdk = `data:text/javascript,${encodeURIComponent(`
  export const createCanvas = options => options;
  export class CanvasError extends Error { constructor(code, message) { super(message); this.code = code; } }
  export async function joinSession(options) {
    globalThis.colophonTestExtension = options;
    return { log() {}, send: async () => {} };
  }
`)}`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, next) {
    return specifier === "@github/copilot-sdk/extension"
      ? { url: ${JSON.stringify(sdk)}, shortCircuit: true }
      : next(specifier, context);
  }
`)}`, import.meta.url);
await import("./extension.mjs");
const extension = globalThis.colophonTestExtension;
const canvas = extension.canvases.find((c) => c.id === "colophon");
const tool = extension.tools.find((t) => t.name === "colophon");

test("the SDK tool declaration exposes seeding and discovery arguments", () => {
  assert.equal(tool.parameters.properties.init.type, "boolean");
  assert.equal(tool.parameters.properties.scan.type, "boolean");
  assert.equal(tool.parameters.properties.workingDirectory.type, "string");
});

async function setup(t) {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "colophon-extension-"));
  const instanceId = path.basename(workdir);
  const context = { instanceId, input: { workingDirectory: workdir } };
  const opened = await canvas.open(context);
  t.after(async () => {
    await canvas.onClose(context);
    await rm(workdir, { recursive: true, force: true });
  });
  const request = async (endpoint, data) => {
    const response = await fetch(new URL(endpoint, opened.url), data === undefined ? {} : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  };
  return { workdir, context, opened, request };
}

test("canvas seeds DESIGN.md, saves edits, reports source paths, and rejects stale saves", async (t) => {
  const { workdir, context, request } = await setup(t);
  const initialized = await request("/api/init", { mode: "scratch", name: "Field notes" });
  assert.equal(initialized.status, 200);
  assert.equal(initialized.body.file, "DESIGN.md");
  const first = (await request("/api/design")).body.design;
  assert.equal(first.tokens.brand.name, "Field notes");
  assert.equal(first.format, "markdown");
  first.tokens.brand.name = "Updated field notes";
  const saved = await request("/api/save", { tokens: first.tokens, revision: first.revision });
  assert.equal(saved.status, 200);
  assert.notEqual(saved.body.revision, first.revision);
  assert.equal(saved.body.format, "markdown");
  assert.equal((await request("/api/save", { tokens: first.tokens, revision: first.revision })).status, 400);
  assert.equal((await request("/api/save", { tokens: first.tokens })).status, 400);
  const selected = await request("/api/design/select", {
    file: "DESIGN.md", path: ["brand"], value: first.tokens.brand, label: "Brand",
  });
  assert.equal(selected.body.file, "DESIGN.md");
  assert.match(selected.body.representation, /not a YAML source path/);
  assert.equal((await request("/api/validate")).body.ok, true);
  const read = await canvas.actions.find((a) => a.name === "read").handler(context);
  assert.match(read.summary, /DESIGN.md/);
  const hook = await extension.hooks.onSessionStart({ workingDirectory: workdir });
  assert.match(hook.additionalContext, /read DESIGN.md/);
  const before = await readFile(path.join(workdir, "DESIGN.md"), "utf8");
  const seededAgain = await tool.handler({ init: true, workingDirectory: workdir });
  assert.deepEqual(seededAgain.seeded.written, []);
  assert.equal(await readFile(path.join(workdir, "DESIGN.md"), "utf8"), before);
});

test("tool and hooks expose conflicting authority without returning starter success", async (t) => {
  const { workdir, request } = await setup(t);
  await tool.handler({ init: true, workingDirectory: workdir });
  await writeFile(path.join(workdir, ".agents", "design", "design.json"), "{}");
  const result = await tool.handler({ workingDirectory: workdir });
  assert.equal(result.ok, false);
  assert.match(result.error, /Both DESIGN.md/);
  assert.equal((await request("/api/validate")).body.ok, false);
  const codegen = await request("/api/prototypes/codegen", { screenId: "any" });
  assert.equal(codegen.status, 400);
  assert.match(codegen.body.error, /Both DESIGN.md/);
  const hook = await extension.hooks.onUserPromptSubmitted({ workingDirectory: workdir, prompt: "Build a settings UI" });
  assert.match(hook.additionalContext, /Resolve this/);
});

test("root DESIGN.md edits and atomic replacements notify open canvases", async (t) => {
  const { workdir, opened, request } = await setup(t);
  await request("/api/init", { mode: "starter" });
  const controller = new AbortController();
  const response = await fetch(new URL("/events", opened.url), { signal: controller.signal });
  const reader = response.body.getReader();
  t.after(() => { controller.abort(); });
  async function expectChange(operation) {
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await operation();
      let text = "";
      while (!text.includes("event: changed")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE ended before a change notification.");
        text += new TextDecoder().decode(value);
      }
    } finally { clearTimeout(timeout); }
  }
  await expectChange(() => appendFile(path.join(workdir, "DESIGN.md"), "\nFirst external change.\n"));
  const changed = await readFile(path.join(workdir, "DESIGN.md"), "utf8");
  const replacement = path.join(workdir, "replacement.md");
  await writeFile(replacement, changed + "\nAtomic replacement.\n");
  await expectChange(() => rename(replacement, path.join(workdir, "DESIGN.md")));
  assert.match((await request("/api/design")).body.design.principlesMarkdown, /Atomic replacement/);
  controller.abort();
});
