import assert from "node:assert/strict";
import test from "node:test";

import { validatePageComponents, validateTokens } from "./validate.mjs";

const base = {
  brand: { name: "Test system" },
  colors: [{ name: "ink", value: "#111111" }],
  typography: { body: { family: "system-ui" }, scale: [{ name: "body" }] },
  spacing: { scale: [{ name: "1", value: "4px" }] },
  principles: ["Keep it clear."],
};

test("pages are optional and valid pages preserve their authored shape", () => {
  const tokens = {
    ...base,
    pages: [{
      id: "release-notes",
      name: "Release notes",
      description: "What changed this week.",
      content: "Use this page to collect rollout notes.",
      components: ["Button", "Badge"],
    }],
  };
  assert.deepEqual(validateTokens(tokens), { ok: true, errors: [], warnings: [] });
  assert.deepEqual(validatePageComponents(tokens, ["Button"]), [
    'Page "Release notes" selects component(s) not defined in components.jsonc: Badge.',
  ]);
});

test("pages reject duplicate IDs and invalid editor fields", () => {
  const result = validateTokens({
    ...base,
    pages: [
      { id: "notes", name: "Notes", components: ["Button", "Button"] },
      { id: "notes", name: "", content: 1 },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Duplicate page id/);
  assert.match(result.errors.join("\n"), /non-empty name/);
  assert.match(result.errors.join("\n"), /content must be a string/);
  assert.match(result.errors.join("\n"), /duplicate names/);
});
