export function buildSelectionPrompt(title, payload) {
  return [
    "Use this Colophon selection as context for my next request. No implementation is requested yet.",
    "",
    title,
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

export async function sendSelectionToChat(session, { title, payload }) {
  if (typeof session?.send !== "function") throw new Error("This Copilot session cannot receive messages from canvases");
  await session.send({
    prompt: buildSelectionPrompt(title, payload),
    displayPrompt: `${title} sent from Colophon`,
    mode: "enqueue",
  });
  return { ok: true, title, delivery: "message" };
}
