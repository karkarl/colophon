import assert from "node:assert/strict";
import test from "node:test";

import { publishPrototypeToPages } from "./pagespublish.mjs";

test("publishes only the generated prototype path and configures Pages when absent", async () => {
  const calls = [];
  const run = async (args, options) => {
    calls.push({ args, options });
    const endpoint = args.find((arg) => arg.startsWith("repos/"));
    if (args[0] === "repo") return JSON.stringify({ nameWithOwner: "octo/example", viewerPermission: "ADMIN", isArchived: false });
    if (args.includes("GET") && endpoint === "repos/octo/example/pages") {
      const error = new Error("not found");
      error.status = 404;
      throw error;
    }
    if (args.includes("GET") && endpoint === "repos/octo/example/git/ref/heads/gh-pages") {
      const error = new Error("not found");
      error.status = 404;
      throw error;
    }
    if (endpoint.endsWith("/git/blobs")) return JSON.stringify({ sha: "blob" });
    if (endpoint.endsWith("/git/trees")) return JSON.stringify({ sha: "tree" });
    if (endpoint.endsWith("/git/commits")) return JSON.stringify({ sha: "commit" });
    if (endpoint.endsWith("/git/refs")) return JSON.stringify({ ref: "refs/heads/gh-pages" });
    if (endpoint.endsWith("/pages")) return JSON.stringify({ html_url: "https://octo.github.io/example/" });
    throw new Error(`Unexpected GitHub CLI call: ${args.join(" ")}`);
  };

  const result = await publishPrototypeToPages({ html: "<!doctype html>", name: "My Prototype", workingDirectory: "C:\\workspace", run });

  assert.equal(result.url, "https://octo.github.io/example/colophon/my-prototype/");
  assert.equal(calls[0].options.cwd, "C:\\workspace");
  const treeCall = calls.find(({ args }) => args.find((arg) => arg.startsWith("repos/"))?.endsWith("/git/trees"));
  assert.deepEqual(JSON.parse(treeCall.options.input).tree, [{ path: "colophon/my-prototype/index.html", mode: "100644", type: "blob", sha: "blob" }]);
  const pagesCall = calls.find(({ args }) => args.find((arg) => arg.startsWith("repos/")) === "repos/octo/example/pages" && args.includes("POST"));
  assert.deepEqual(JSON.parse(pagesCall.options.input), { build_type: "legacy", source: { branch: "gh-pages", path: "/" } });
});

test("preserves an existing gh-pages tree", async () => {
  const calls = [];
  const run = async (args, options) => {
    calls.push({ args, options });
    const endpoint = args.find((arg) => arg.startsWith("repos/"));
    if (args[0] === "repo") return JSON.stringify({ nameWithOwner: "octo/example", viewerPermission: "ADMIN", isArchived: false });
    if (args.includes("GET") && endpoint === "repos/octo/example/pages") return JSON.stringify({ build_type: "legacy", source: { branch: "gh-pages", path: "/" }, html_url: "https://octo.github.io/example/" });
    if (args.includes("GET") && endpoint.endsWith("/git/ref/heads/gh-pages")) return JSON.stringify({ object: { sha: "head" } });
    if (args.includes("GET") && endpoint.endsWith("/git/commits/head")) return JSON.stringify({ tree: { sha: "existing-tree" } });
    if (endpoint.endsWith("/git/blobs")) return JSON.stringify({ sha: "blob" });
    if (endpoint.endsWith("/git/trees")) return JSON.stringify({ sha: "tree" });
    if (endpoint.endsWith("/git/commits")) return JSON.stringify({ sha: "commit" });
    if (endpoint.endsWith("/git/refs/heads/gh-pages")) return JSON.stringify({ object: { sha: "commit" } });
    throw new Error(`Unexpected GitHub CLI call: ${args.join(" ")}`);
  };

  await publishPrototypeToPages({ html: "<!doctype html>", name: "Prototype", workingDirectory: "C:\\workspace", run });

  const treeCall = calls.find(({ args }) => args.find((arg) => arg.startsWith("repos/"))?.endsWith("/git/trees"));
  assert.equal(JSON.parse(treeCall.options.input).base_tree, "existing-tree");
  const updateCall = calls.find(({ args }) => args.includes("PATCH") && args.find((arg) => arg.startsWith("repos/"))?.endsWith("/git/refs/heads/gh-pages"));
  assert.deepEqual(JSON.parse(updateCall.options.input), { sha: "commit", force: false });
});
