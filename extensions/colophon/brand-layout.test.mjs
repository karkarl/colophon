import assert from "node:assert/strict";
import test from "node:test";
import { FOUNDATION_SECTIONS, foundationHome, foundationSectionsForPage, moveFoundationSection, validateBrandLayout, heroDocument } from "./brand-layout.mjs";
import { validateTokens } from "./validate.mjs";

test("foundations default to Brand without migrating existing documents", () => {
  const tokens = { pages: [{ id: "notes", name: "Notes", components: ["Button"] }] };
  const before = structuredClone(tokens);
  assert.deepEqual(foundationSectionsForPage(tokens, "brand"), FOUNDATION_SECTIONS.map(({ id }) => id));
  assert.deepEqual(foundationSectionsForPage(tokens, "notes"), []);
  assert.equal(moveFoundationSection(tokens, "colors", "brand"), false);
  assert.deepEqual(tokens, before);
});

test("foundation moves have one home, preserve content and order, and return on deletion", () => {
  const tokens = { colors: [{ name: "ink", value: "#123456" }], pages: [
    { id: "foundations", name: "Foundations", sections: ["typography"], components: ["Button"], content: "Keep me" },
    { id: "notes", name: "Notes", components: [] },
  ] };
  const color = structuredClone(tokens.colors);
  assert.equal(moveFoundationSection(tokens, "colors", "foundations"), true);
  assert.deepEqual(tokens.pages[0].sections, ["typography", "colors"]);
  assert.equal(foundationHome(tokens, "colors"), "foundations");
  assert.equal(foundationSectionsForPage(tokens, "brand").includes("colors"), false);
  assert.equal(moveFoundationSection(tokens, "colors", "notes"), true);
  assert.deepEqual(tokens.pages[0], { id: "foundations", name: "Foundations", sections: ["typography"], components: ["Button"], content: "Keep me" });
  assert.deepEqual(tokens.colors, color);
  tokens.pages.pop();
  assert.equal(foundationHome(tokens, "colors"), "brand");
});

test("malformed, duplicate, reserved and stale destinations fail without mutation", () => {
  for (const pages of [
    [{ id: "notes", sections: null }],
    [{ id: "notes", sections: ["spacing", "spacing"] }],
    [{ id: "notes", sections: ["colors"] }, { id: "other", sections: ["colors"] }],
    [{ id: "notes", sections: ["missing"] }],
    [{ id: "components", sections: ["colors"] }],
    [{ id: "configuration", sections: ["colors"] }],
    [{ id: "brand", sections: [] }],
  ]) {
    const tokens = { pages };
    const before = structuredClone(tokens);
    assert.ok(validateBrandLayout(tokens).length);
    assert.throws(() => moveFoundationSection(tokens, "colors", "brand"));
    assert.deepEqual(tokens, before);
    assert.equal(validateTokens(tokens).ok, false);
  }
  const tokens = { pages: [] };
  for (const target of ["configuration", "components", "gone"]) {
    assert.throws(() => moveFoundationSection(tokens, "colors", target), /destination/);
    assert.deepEqual(tokens, { pages: [] });
  }
});

test("optional heroes validate shape, accessible names, and exact height bounds", () => {
  for (const hero of [undefined, null, { html: "" }, { html: "<svg></svg>", title: "Brand", height: 80 }, { html: "<video></video>", height: 1200 }]) {
    assert.deepEqual(validateBrandLayout({ brand: { hero } }), []);
  }
  for (const hero of ["<div>", [], {}, { html: 3 }, { html: "", title: "" }, { html: "", height: 79 }, { html: "", height: 1201 }, { html: "", height: 240.5 }]) {
    assert.ok(validateBrandLayout({ brand: { hero } }).length, JSON.stringify(hero));
  }
});

test("hero documents isolate web content and supply tokens and reduced-motion CSS", () => {
  const html = '<svg aria-label="Logo"></svg><script>window.heroReady=true</script>';
  const source = heroDocument(html, ":root{--color-ink:#123456}");
  assert.ok(source.includes(html));
  assert.match(source, /--color-ink:#123456/);
  assert.match(source, /prefers-reduced-motion:reduce/);
  assert.match(source, /script-src 'unsafe-inline';/);
  assert.match(source, /connect-src 'none'/);
  assert.match(source, /form-action 'none'/);
  assert.match(source, /base-uri 'none'/);
  assert.ok(source.indexOf("Content-Security-Policy") < source.indexOf(html));
  assert.ok(!heroDocument("", "</style><script>bad()</script>").includes("</style><script>bad()"));
});
