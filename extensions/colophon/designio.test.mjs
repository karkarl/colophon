import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadDesign, saveComponents, tokensToCssVars } from "./designio.mjs";

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
