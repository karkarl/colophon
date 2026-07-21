// proto-outline.mjs — render a click-through prototype as a plain-English Markdown flow
// outline, so anyone can review the screens and navigation in a PR without reading the
// scene-graph nodes. Derived entirely from the JSON; writes nothing.

import { walkScreen, nodeKind } from "./prototypeio.mjs";

function tapSummary(node) {
  const tap = node.on?.tap;
  if (!tap) return null;
  if (tap.navigate) return `→ **${tap.navigate}**`;
  if (tap.back) return "→ back";
  if (tap.openModal) return `opens modal *${tap.openModal}*`;
  if (tap.closeModal) return "closes modal";
  if (tap.toggle) return `toggles \`${tap.toggle}\``;
  if (tap.setState) return `sets ${Object.entries(tap.setState).map(([k, v]) => `\`${k}=${JSON.stringify(v)}\``).join(", ")}`;
  return "interactive";
}

function nodeLabel(node) {
  if (node.text) return `"${node.text}"`;
  if (node.component) {
    const p = node.props || {};
    const inner = p.children || p.title || p.label;
    return inner ? `${node.component} "${inner}"` : node.component;
  }
  return node.id || nodeKind(node) || "node";
}

export function buildOutline(doc, { title = "Prototype" } = {}) {
  const lines = [];
  const screens = doc.screens || [];
  lines.push(`# ${title} — flow outline`, "");

  if (doc.flows?.length) {
    lines.push("## Entry points", "");
    for (const f of doc.flows) lines.push(`- **${f.name || f.id}** → starts at \`${f.start}\``);
    lines.push("");
  }

  lines.push(`## Screens (${screens.length})`, "");
  for (const screen of screens) {
    lines.push(`### ${screen.name || screen.id}  \`${screen.id}\`${screen.device ? ` · ${screen.device}` : ""}`);
    const nav = [];
    const acts = [];
    const modals = new Set();
    walkScreen(screen, (node) => {
      const t = tapSummary(node);
      if (!t) return;
      if (t.startsWith("→")) nav.push(`- ${nodeLabel(node)} ${t}`);
      else acts.push(`- ${nodeLabel(node)} ${t}`);
    });
    for (const m of screen.modals || []) modals.add(m.id);
    if (nav.length) { lines.push("", "**Navigates:**", ...nav); }
    if (acts.length) { lines.push("", "**Interactions:**", ...acts); }
    if (modals.size) lines.push("", `**Modals:** ${[...modals].map((m) => `*${m}*`).join(", ")}`);
    if (!nav.length && !acts.length && !modals.size) lines.push("", "_No interactions — static screen._");
    lines.push("");
  }

  // A compact edge list of the navigation graph.
  const edges = [];
  for (const screen of screens) {
    walkScreen(screen, (node) => {
      const to = node.on?.tap?.navigate;
      if (to) edges.push(`${screen.id} → ${to}`);
    });
  }
  if (edges.length) { lines.push("## Navigation graph", "", "```", ...edges, "```", ""); }

  return lines.join("\n");
}
