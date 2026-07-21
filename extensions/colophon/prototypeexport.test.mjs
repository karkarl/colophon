import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPrototypeExportHtml, writePrototypeExport } from "./prototypeexport.mjs";

test("writes a self-contained prototype export", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "colophon-export-"));
  try {
    const html = await buildPrototypeExportHtml({
      design: { source: "repo", tokens: { brand: { name: "Test" }, colors: [] }, componentsDoc: { components: [] } },
      proto: { source: "repo", doc: { state: {}, screens: [], flows: [] }, parseError: null },
      validation: { ok: true, errors: [], warnings: [] },
      outline: "# Test",
    });
    const output = await writePrototypeExport(workspace, html);
    const saved = await readFile(output.path, "utf8");
    assert.equal(output.path, path.join(workspace, ".agents", "design", "prototype-export", "index.html"));
    assert.match(saved, /window\.__COLOPHON_PROTOTYPE_EXPORT__/);
    assert.match(saved, /window\.DSComp/);
    assert.match(saved, /window\.ProtoRender/);
    assert.match(saved, /Standalone export/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
