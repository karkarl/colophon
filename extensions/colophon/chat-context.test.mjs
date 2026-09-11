import assert from "node:assert/strict";
import test from "node:test";

import { buildSelectionPrompt, sendSelectionToChat } from "./chat-context.mjs";

test("selection prompts include the exact structured payload", () => {
  const payload = {
    kind: "colophon.design.element",
    file: "design.json",
    jsonPath: "/colors/0",
    value: { name: "ink", value: "#1c1a17" },
    draft: false,
  };
  const prompt = buildSelectionPrompt("Design: ink", payload);

  assert.match(prompt, /context for my next request/);
  assert.match(prompt, /"jsonPath": "\/colors\/0"/);
  assert.match(prompt, /"value": "#1c1a17"/);
});

test("selections are enqueued as a user-visible chat message", async () => {
  const calls = [];
  const result = await sendSelectionToChat(
    { send: async (options) => calls.push(options) },
    { title: "Prototype: hero", payload: { kind: "colophon.prototype.element", element: { id: "hero" } } },
  );

  assert.deepEqual(result, { ok: true, title: "Prototype: hero", delivery: "message" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "enqueue");
  assert.equal(calls[0].displayPrompt, "Prototype: hero sent from Colophon");
  assert.match(calls[0].prompt, /"id": "hero"/);
});
