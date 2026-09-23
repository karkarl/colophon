import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseDesignMarkdown, seedDesignMarkdown, updateDesignMarkdown } from "./designmd.mjs";

const sample = JSON.parse(await readFile(new URL("./sample/design.json", import.meta.url), "utf8"));

test("Northlight seed round-trips every token and richer metadata without a second token copy", () => {
  const tokens = structuredClone(sample);
  tokens.pages = [{ id: "notes", name: "Notes", content: "Authored content.", components: ["Button"] }];
  tokens.authority = { designSource: "self", owner: "team", syncProcess: "Review together", port: { authoritySource: "WinUI", syncSource: "guide" } };
  tokens.colors[0].resource = "TextFillColorPrimaryBrush";
  const source = seedDesignMarkdown(tokens);
  const parsed = parseDesignMarkdown(source);
  assert.deepEqual(parsed.tokens, tokens);
  assert.equal(updateDesignMarkdown(source, parsed.tokens), source);
  assert.equal(parsed.data.colors.ink, sample.colors[0].value);
  assert.equal(parsed.data["x-colophon"].tokens.colors.ink.value, undefined);
  assert.equal(parsed.data["x-colophon"].tokens.typography.body.family, undefined);
  assert.match(source, /copilot plugin install karkarl\/colophon/);
  assert.match(source, /Agents without Colophon/);
  assert.match(source, /Production implementation/);
  assert.match(source, /bind their mapped `resource`/);
});

test("editing front matter retains CRLF, Unicode, comments, unknown keys, and exact prose", () => {
  const source = [
    "---", "name: Test", "# Keep this comment", "colors:",
    '  ink: "#112233" # ink comment', '  accent: "{colors.ink}"',
    "typography:", "  title:", "    fontFamily: Fraunces", "    fontSize: 2rem",
    "    lineHeight: 1.2", "    custom: keep-me",
    "spacing:", '  "1": 4px', "  columns: 3", "rounded:", "  sm: 4px",
    "custom:", "  author: Söhne", "components:", "  button:", '    textColor: "{colors.accent}"',
    "---", "", "## Overview", "", "A precise, warm tool.", "",
    "## Motion", "", "Keep this **exactly** as written.", "",
  ].join("\r\n");
  const parsed = parseDesignMarkdown(source);
  assert.equal(parsed.tokens.colors[1].value, "#112233");
  assert.equal(parsed.tokens.spacing.scale[1].value, 3);
  parsed.tokens.colors[0].value = "#445566";
  const next = updateDesignMarkdown(source, parsed.tokens);
  const result = parseDesignMarkdown(next);
  assert.equal(result.body, parsed.body);
  assert.match(next, /# Keep this comment/);
  assert.match(next, /# ink comment/);
  assert.equal(next.replace(/\r\n/g, "").includes("\n"), false);
  assert.equal(result.data.colors.accent, "{colors.ink}");
  assert.equal(result.tokens.colors[1].value, "#445566");
  assert.equal(result.data.typography.title.custom, "keep-me");
  assert.equal(result.data.custom.author, "Söhne");
  assert.deepEqual(result.data.components, parsed.data.components);
});

test("family roles and per-style families survive edits and retain exact values", () => {
  const source = "---\nname: Type\ncolors: { ink: '#112233' }\ntypography:\n  heading: { fontFamily: Fraunces, fontSize: 2rem }\n  body: { fontFamily: Söhne, fontSize: 1rem }\n---\n## Overview\nKeep it warm.\n";
  const parsed = parseDesignMarkdown(source);
  assert.equal(parsed.tokens.typography.body.family, "Fraunces");
  assert.equal(parsed.tokens.typography.scale[1].family, "Söhne");
  parsed.tokens.typography.scale[1].size = "18px";
  const next = parseDesignMarkdown(updateDesignMarkdown(source, parsed.tokens));
  assert.equal(next.data.typography.body.fontFamily, "Söhne");
  assert.equal(next.data.typography.body.fontSize, "18px");
});

test("prose-only documents and horizontal rules are not replaced with starter values", () => {
  const source = "# Notes\n\n## Overview\nA small journal.\n\n---\n\n## Motion\nNo animation.\n---\n";
  const parsed = parseDesignMarkdown(source);
  assert.deepEqual(parsed.tokens.colors, []);
  assert.deepEqual(parsed.tokens.typography.scale, []);
  assert.equal(parsed.tokens.brand.name, "Notes");
  assert.equal(parsed.body, source);
  assert.equal(updateDesignMarkdown(source, parsed.tokens), source);
  assert.match(parsed.warnings[0], /no concrete color tokens/);
});

test("invalid YAML, duplicate sections, bad shapes and broken/circular references are explicit errors", () => {
  for (const [source, error] of [
    ["---\nname: [\n---\n", /flow sequence|FLOW_END/i],
    ["---\nname: Test", /closing/],
    ["---\nname: Test\nname: Again\n---\n", /unique/],
    ["---\ncolors: [red]\n---\n", /mapping/],
    ["---\ncolors: { ink: '{colors.missing}' }\n---\n", /Broken token reference/],
    ["---\ncolors: { a: '{colors.b}', b: '{colors.a}' }\n---\n", /Circular token reference/],
    ["---\ncustom: &loop { self: *loop }\n---\n", /Cyclic YAML/],
    ["## Overview\nFirst\n## Brand & Style\nDuplicate\n", /Duplicate/],
    ["---\nx-colophon: { version: 99 }\n---\n", /Unsupported/],
  ]) assert.throws(() => parseDesignMarkdown(source), error);
  assert.doesNotThrow(() => parseDesignMarkdown("## Overview\n```\n## Overview\n```\n"));
});

test("removing tokens preserves unrelated YAML without adding generated metadata", () => {
  const source = "---\nname: Minimal\ncolors: { ink: '#112233', accent: '#ff0000' }\ncustom: retained\n---\n## Overview\nAuthored.\n";
  const parsed = parseDesignMarkdown(source);
  parsed.tokens.colors.pop();
  const next = parseDesignMarkdown(updateDesignMarkdown(source, parsed.tokens));
  assert.equal(next.data.colors.accent, undefined);
  assert.equal(next.data.custom, "retained");
  assert.equal(next.data["x-colophon"], undefined);
});

test("editing a standard color also updates its light-theme preview without duplicate values", () => {
  const tokens = structuredClone(sample);
  tokens.colors[0].themes.light = tokens.colors[0].value;
  const source = seedDesignMarkdown(tokens);
  const initial = parseDesignMarkdown(source);
  assert.deepEqual(initial.tokens, tokens);
  assert.equal(initial.data["x-colophon"].tokens.colors.ink.themes.light, undefined);
  const externalEdit = source.replace('ink: "#1c1a17"', 'ink: "#112233"');
  assert.notEqual(externalEdit, source);
  const edited = parseDesignMarkdown(externalEdit);
  assert.equal(edited.tokens.colors[0].value, "#112233");
  assert.equal(edited.tokens.colors[0].themes.light, "#112233");
});

test("legacy flat color maps can seed a portable document", () => {
  const tokens = { ...sample, colors: { ink: "#123456", accent: "#abcdef" } };
  const seeded = parseDesignMarkdown(seedDesignMarkdown(tokens));
  assert.deepEqual(seeded.data.colors, tokens.colors);
  assert.match(seeded.body, /\{colors.ink\}/);
});
