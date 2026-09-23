---
name: colophon
description: >-
  Use whenever you seed a design system or create, edit, review, or fix UI.
  Follow AGENTS.md to the repository's DESIGN.md or legacy .agents/design/
  contract before generating UI. Reuse its tokens, component patterns, rationale,
  voice, and anti-references. Colophon is an optional visual editor, not a
  requirement for reading the design. If no system exists, offer to seed
  DESIGN.md, companion component patterns, and an AGENTS.md pointer.
---

# Colophon - seed and follow the repository's design system

The design belongs to the repository, not to the extension. Agents must be able
to discover and apply it without installing Colophon:

```text
AGENTS.md -> DESIGN.md -> optional Colophon editor
                      -> .agents/design/components.jsonc
                      -> optional .agents/design/prototypes.jsonc
```

Use this skill before working on pages, components, layouts, CSS, themes, or
visual behavior. Purely non-visual work does not require it.

## 1. Discover the design authority before seeding

Read the applicable AGENTS.md guidance and check for both root `DESIGN.md` and
`.agents/design/design.json`. Do not interpret a missing `.agents/design/` folder
as permission to seed over an existing DESIGN.md.

| Existing files | What to do |
| --- | --- |
| DESIGN.md only | Read its front matter and full prose. Read companion component patterns if present. |
| Legacy design.json only | Read it, components.jsonc, and principles.md. Preserve this format. |
| Both | Explain the conflict and ask which document should own the design. Do not overwrite, merge, delete, or migrate either automatically. |
| Neither | Offer to seed a design system before generating UI. |
| Invalid or unreadable document | Report the error and resolve it before proceeding. Do not replace it with starter values. |

When available, call the `colophon` tool to load the system and its diagnostics.
The canvas can inspect, edit, and preview it. Without the extension, read and
edit the files directly. Do not install the plugin unless the user requests it.

Prose-only DESIGN.md files are valid guidance. Read them as such; do not invent a
palette or silently fill missing tokens with Northlight. Propose concrete tokens
only when the requested work needs them.

## 2. Seed only when no design system exists

Choose an appropriate starting point with the user. Preserve the repository's
identity instead of applying the bundled Northlight example to an unrelated app.

- **Existing UI:** use the `colophon` tool with `scan: true` to propose tokens
  from the codebase without writing files. Review and refine in the canvas before
  Save to repo.
- **New identity:** use the Colophon canvas `init` action with `mode: "scratch"`
  and the project's name, tagline, and description, then refine the neutral
  skeleton with the user.
- **Bundled example:** use the `colophon` tool with `init: true`, or the canvas
  `init` action with `mode: "starter"`, only when the user wants that starting
  point.

New seeds and first saves create:

- Root `DESIGN.md`: portable tokens and design rationale.
- `.agents/design/components.jsonc`: editable, framework-agnostic component
  patterns for preview and implementation guidance.
- An idempotent managed block in root `AGENTS.md`: directs agents to DESIGN.md
  and the companion patterns, and explains the optional Colophon workflow.

The extension preserves existing systems when `init` is called. It does not
create a competing `design.json`, seed legacy principles.md for a new system, or
automatically migrate old files. Check the result's written/skipped files and
AGENTS.md status; report pointer failures instead of claiming complete setup.

### Seeding without the extension

Create the same document contract directly after approval. DESIGN.md uses
optional YAML front matter followed by Markdown rationale. Follow the
[upstream specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md);
the supported format is currently alpha.

- Define `name` and, when known, `description`, `colors`, `typography`, `spacing`,
  and `rounded`. Keep existing semantic token names; do not rename `ink` or
  `accent` merely to satisfy a naming convention.
- Use typography objects with `fontFamily`, `fontSize`, `fontWeight`,
  `lineHeight`, and `letterSpacing` where specified. Quote hex values and
  numeric-looking spacing keys. References use `{colors.accent}` and similar
  paths; every reference must resolve.
- Write specific rationale, not only token lists. Use the relevant sections in
  order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes,
  Components, and Do's and Don'ts. Preserve custom sections; avoid duplicates.
- Explain the intended audience, visual reference, usage rules, and deliberate
  exclusions. Do not fabricate brand decisions to fill every section.
- Link actual companion files from Components. Create component patterns only
  when their structure is known; never invent references to nonexistent patterns.
- Keep richer Colophon metadata in `x-colophon` only when needed. The extension's
  versioned shape is `x-colophon: { version: 1, tokens: ... }`; it is not an
  upstream standard. Do not duplicate portable token values there.

In Overview, add a short note that the optional **Colophon** canvas can edit and
preview the system. Include `copilot plugin install karkarl/colophon` and
https://github.com/karkarl/colophon, and explicitly say direct file editing works.

Add or update only the `<!-- colophon:start -->` / `<!-- colophon:end -->` block
in AGENTS.md. Point to DESIGN.md, existing companion files, and the optional
tool/canvas; keep the palette and rationale in DESIGN.md instead of repeating
them. Preserve unrelated instructions and line endings. If markers are
malformed or the target is a symlink, report it and ask before changing it.

## 3. Respect design and production authority

Read `authority` in legacy design.json or `x-colophon.tokens.authority` in
DESIGN.md when present:

- `designSource` identifies design ownership.
- `port` identifies the default shipping technology (`authoritySource`), porting
  reference (`syncSource`), optional specialist (`helperAgent`), and owner.
- `portOverrides` identifies exceptions by area or component.
- `owner` and `syncProcess` describe responsibility and synchronization.

With a port target, follow its reference and bind each color's mapped `resource`
instead of hard-coding preview hex values. Preserve light, dark, and
high-contrast mappings. The shipping implementation is canonical for production;
component graphs describe design intent and must not be copied as shipping code.

Without a port target, implement the design contract in the repository's chosen
technology. `components.jsonc` is still a framework-agnostic pattern document,
not an executable React implementation.

## 4. Generate UI and keep the system coherent

Use named tokens through the repository's styling mechanism. Reuse component
patterns, honor the prose, and preserve the intended hierarchy, voice, and
anti-references. If a needed value is missing, propose and add it to the active
design authority rather than scattering one-off values in code.

For DESIGN.md-backed systems, canvas token saves update its front matter and
preserve authored prose and unknown content. Edit rationale in DESIGN.md
directly. Inspector JSON paths refer to Colophon's normalized token model, not
literal YAML paths. Preserve unknown fields and report unsupported constructs.

Do not maintain a second editable token copy, silently convert legacy systems,
or overwrite concurrent disk edits. Reload after a stale-save error and
reconcile the user's changes before retrying.

After seeding, read the created files and verify the authority, references,
companion links, and AGENTS.md pointer. Use the canvas `validate` action or
`/design-validate` when available; report all errors and relevant warnings.
