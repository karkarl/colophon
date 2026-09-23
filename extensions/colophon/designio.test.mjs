import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadDesign, saveComponents, tokensToCssVars, initDesign, saveTokens, ensureAgentsPointer } from "./designio.mjs";
import { seedDesignMarkdown, parseDesignMarkdown } from "./designmd.mjs";
import { validateDesignDir } from "./validate.mjs";
import { buildSummary, sessionStartContext, promptContext } from "./context.mjs";

async function workspaceFor(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "colophon-seed-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  return workspace;
}

test("seeding creates DESIGN.md and companions, preserves AGENTS.md and is idempotent", async (t) => {
  const workspace = await workspaceFor(t);
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "# Team instructions\r\n\r\nKeep me.\r\n");
  const first = await initDesign(workspace);
  assert.deepEqual(first.written, ["DESIGN.md", "components.jsonc"]);
  const source = await fs.readFile(path.join(workspace, "DESIGN.md"), "utf8");
  const agents = await fs.readFile(path.join(workspace, "AGENTS.md"), "utf8");
  assert.match(agents, /^# Team instructions\r\n\r\nKeep me\.\r\n/);
  assert.match(agents, /\[`DESIGN.md`\]\(DESIGN.md\)/);
  assert.match(agents, /Without the extension/);
  assert.match(agents, /copilot plugin install/);
  assert.equal(agents.replace(/\r\n/g, "").includes("\n"), false);
  await assert.rejects(fs.access(path.join(workspace, ".agents", "design", "design.json")), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(workspace, ".agents", "design", "principles.md")), { code: "ENOENT" });
  const second = await initDesign(workspace);
  assert.deepEqual(second.written, []);
  assert.equal(second.agents.action, "unchanged");
  assert.equal(await fs.readFile(path.join(workspace, "DESIGN.md"), "utf8"), source);
  const loaded = await loadDesign(workspace);
  assert.equal(loaded.file, "DESIGN.md");
  assert.equal(loaded.format, "markdown");
  assert.equal((await validateDesignDir(workspace)).ok, true);
  assert.equal((await validateDesignDir(first.dir)).ok, true);
  assert.match(buildSummary(loaded), /Design rationale \(DESIGN.md\)/);
  assert.match(sessionStartContext(loaded), /read DESIGN.md/);
  assert.match(promptContext(loaded), /DESIGN.md/);
});

test("first save seeds Markdown and subsequent token edits preserve authored prose", async (t) => {
  const workspace = await workspaceFor(t);
  const sample = await loadDesign(null);
  const initial = await loadDesign(workspace);
  const out = await saveTokens(workspace, sample.tokens, { revision: initial.revision });
  assert.equal(out.file, "DESIGN.md");
  const file = path.join(workspace, out.file);
  await fs.appendFile(file, "\n## Custom section\nAuthored outside Colophon.\n");
  const loaded = await loadDesign(workspace);
  loaded.tokens.colors[0].value = "#102030";
  await saveTokens(workspace, loaded.tokens, { revision: loaded.revision });
  const next = await fs.readFile(file, "utf8");
  assert.match(next, /Authored outside Colophon/);
  assert.equal(parseDesignMarkdown(next).tokens.colors[0].value, "#102030");
  const current = await loadDesign(workspace);
  await saveTokens(workspace, current.tokens, { revision: current.revision });
  assert.equal(await fs.readFile(file, "utf8"), next);
});

test("legacy systems continue loading and saving without migration or replaced prose", async (t) => {
  const workspace = await workspaceFor(t);
  const dir = path.join(workspace, ".agents", "design");
  await fs.mkdir(dir, { recursive: true });
  const sample = await loadDesign(null);
  await fs.writeFile(path.join(dir, "design.json"), JSON.stringify(sample.tokens));
  await fs.writeFile(path.join(dir, "principles.md"), "# Existing prose\nKeep it.");
  const init = await initDesign(workspace, { tokens: { brand: { name: "Do not overwrite" } } });
  assert.deepEqual(init.written, []);
  const loaded = await loadDesign(workspace);
  loaded.tokens.brand.name = "Changed";
  const saved = await saveTokens(workspace, loaded.tokens, { revision: loaded.revision });
  assert.equal(saved.format, "json");
  assert.equal(saved.tokens.meta.version, loaded.tokens.meta.version + 1);
  assert.equal((await loadDesign(workspace)).tokens.brand.name, "Changed");
  assert.equal(await fs.readFile(path.join(dir, "principles.md"), "utf8"), "# Existing prose\nKeep it.");
  await assert.rejects(fs.access(path.join(workspace, "DESIGN.md")), { code: "ENOENT" });
});

test("existing prose-only DESIGN.md remains untouched and receives no starter components", async (t) => {
  const workspace = await workspaceFor(t);
  const file = path.join(workspace, "DESIGN.md");
  const content = "# Existing identity\n\n## Overview\nA paper journal.";
  await fs.writeFile(file, content);
  await initDesign(workspace);
  assert.equal(await fs.readFile(file, "utf8"), content);
  await assert.rejects(fs.access(path.join(workspace, ".agents", "design", "components.jsonc")), { code: "ENOENT" });
  assert.equal((await validateDesignDir(workspace)).ok, true);
});

test("stale saves and competing initializations cannot overwrite external edits", async (t) => {
  const workspace = await workspaceFor(t);
  const results = await Promise.all([initDesign(workspace), initDesign(workspace)]);
  assert.equal(results.filter((r) => r.written.length).length, 1);
  const loaded = await loadDesign(workspace);
  await fs.appendFile(path.join(workspace, "DESIGN.md"), "\nExternal edit.\n");
  await assert.rejects(saveTokens(workspace, loaded.tokens, { revision: loaded.revision }), /changed on disk/);
  assert.match(await fs.readFile(path.join(workspace, "DESIGN.md"), "utf8"), /External edit/);
});

test("dual sources and invalid documents never fall back to starter values or permit writes", async (t) => {
  const workspace = await workspaceFor(t);
  await initDesign(workspace);
  const file = path.join(workspace, "DESIGN.md");
  const original = await fs.readFile(file, "utf8");
  await fs.writeFile(path.join(workspace, ".agents", "design", "design.json"), "{}");
  const conflict = await loadDesign(workspace);
  assert.match(conflict.parseError, /Both DESIGN.md/);
  assert.deepEqual(conflict.tokens, {});
  await assert.rejects(saveTokens(workspace, {}), /Both DESIGN.md/);
  await assert.rejects(initDesign(workspace), /Both DESIGN.md/);
  assert.equal((await validateDesignDir(workspace)).ok, false);
  assert.match(promptContext(conflict), /Resolve this/);
  assert.equal(await fs.readFile(file, "utf8"), original);
  await fs.unlink(path.join(workspace, ".agents", "design", "design.json"));
  await fs.writeFile(file, "---\ninvalid: [\n---\n");
  const invalid = await loadDesign(workspace);
  assert.ok(invalid.parseError);
  assert.deepEqual(invalid.tokens, {});
  await assert.rejects(initDesign(workspace));
});

test("pointer writes preserve malformed markers and deduplicate complete managed blocks", async (t) => {
  const workspace = await workspaceFor(t);
  await initDesign(workspace);
  const file = path.join(workspace, "AGENTS.md");
  const generated = await fs.readFile(file, "utf8");
  await fs.writeFile(file, generated + "\nUser guidance\n\n" + generated);
  await ensureAgentsPointer(workspace);
  const next = await fs.readFile(file, "utf8");
  assert.equal(next.match(/<!-- colophon:start -->/g).length, 1);
  assert.match(next, /User guidance/);
  const malformed = "Keep me.\n<!-- colophon:start -->\nUnfinished";
  await fs.writeFile(file, malformed);
  assert.equal((await ensureAgentsPointer(workspace)).action, "skipped-malformed");
  assert.equal(await fs.readFile(file, "utf8"), malformed);
});

test("symlink-backed DESIGN.md is readable but cannot be overwritten", async (t) => {
  const workspace = await workspaceFor(t);
  const target = path.join(workspace, "real.md");
  await fs.writeFile(target, seedDesignMarkdown((await loadDesign(null)).tokens));
  try { await fs.symlink(target, path.join(workspace, "DESIGN.md")); }
  catch (err) {
    if (err.code === "EPERM") { t.skip("Symlink creation requires Windows developer mode."); return; }
    throw err;
  }
  const loaded = await loadDesign(workspace);
  loaded.tokens.brand.name = "Must not write";
  await assert.rejects(saveTokens(workspace, loaded.tokens), /symlink/);
  assert.equal(parseDesignMarkdown(await fs.readFile(target, "utf8")).tokens.brand.name, "Northlight");
});

test("component edits persist as normalized components.jsonc", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "colophon-components-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const doc = {
    meta: { version: 1 },
    components: [{
      name: "Notice",
      props: { children: "Hello" },
      root: { el: "p", class: "notice", children: ["{children}"] },
    }],
  };

  const saved = await saveComponents(workspace, doc);
  const raw = await fs.readFile(saved.file, "utf8");
  const parsed = JSON.parse(raw);

  assert.equal(parsed.components[0].name, "Notice");
  assert.equal((await loadDesign(workspace)).source, "sample");
});

test("typography scale emits CSS variables for appearance overrides", () => {
  const css = tokensToCssVars({
    typography: {
      display: { family: "Georgia, serif" },
      scale: [{
        name: "title",
        role: "display",
        size: "28px",
        lineHeight: "34px",
        weight: 600,
        tracking: "-0.01em",
      }],
    },
  });
  assert.match(css, /--text-title-family: var\(--font-display\)/);
  assert.match(css, /--text-title-size: 28px/);
  assert.match(css, /--text-title-line-height: 34px/);
  assert.match(css, /--text-title-weight: 600/);
  assert.match(css, /--text-title-tracking: -0\.01em/);
});
