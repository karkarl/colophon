# One-pass seeding playbook

Read this file completely before you seed a design system, or refresh a
component catalog, from an existing app or a design-system source. Follow it end
to end. The discovery, document-format, and authority rules in SKILL.md still
apply.

One request should produce a complete, source-faithful system that needs no
follow-up corrections:

- `DESIGN.md`: the source's brand language; every foundation token with its
  source name, production mapping, and usage context; rationale, coverage, and
  limits.
- `.agents/design/components.jsonc`: interactive, editable component graphs for
  every recurring element, built from basic components up to composite controls.
- Page metadata that arranges the catalog the way the source is organized.
- The managed AGENTS.md block.

Seeding changes no production code, tests, or build files. The catalog follows
the source; never change the source to match the catalog.

## Source modes

| Mode | Canonical source | Pages follow |
| --- | --- | --- |
| App | Shipping UI code, resources, templates, assets, and the running app | The app's own areas, in user-flow order |
| System | Token packages, component specifications, fixtures, and documentation content; the documentation site for structure and visual language | The documentation site's navigation |

An app built on an upstream system needs both. Seed the app's own usage,
overrides, and composites, and reference the upstream system rather than
copying its whole catalog.

## Run without stopping

A request to seed or refresh from a source approves writing the design files.
Proceed with these defaults instead of asking:

- **Scope:** every user-facing surface (App) or every documented foundation and
  component (System).
- **Fidelity:** exact. A simplified, placeholder, or approximate preview is a
  defect to fix, not a draft to report.
- **Themes:** light, dark, and high contrast, as the source defines them.
- **Wording:** the source's names, and any tagline or copy the user supplies,
  verbatim.
- **Order:** brand, foundations, basic components, composites, pages, then
  verification.

Ask, one question at a time, only when:

- DESIGN.md and a legacy design.json both exist;
- the canonical source is unreachable and no local copy exists;
- the Colophon plugin is unavailable, so previews cannot be rendered or
  validated;
- the request asks for UI the source does not contain, such as an unbuilt
  redesign.

Report every other judgment call at the end.

Track work in the session (todos or SQL), not in repository files. Keep a
coverage ledger with one row per surface or documented item: source owner and
`path:line`, foundations used, basic components, composites, page, evidence
(observed at runtime or source only), and status. For a large source, you may
delegate read-only inventory of separate areas to sub-agents. Give each one a
bounded scope, this evidence format, and no edit rights. Sub-agents may also
draft graphs for one family in session files. The main session reviews and
merges every draft, keeps the ledger, and makes every repository edit. Generate
large files with scripts kept in the session workspace; add a generator to the
repository only when the user asks for reproducible regeneration.

## 1. Preflight

1. Run the discovery in SKILL.md. With an existing system, extend it in place:
   reconcile existing definitions instead of adding duplicates, replace entries
   for redesigned areas, and label any retained historical prose.
2. Use the installed Colophon plugin. Load the system with the `colophon` tool,
   open the canvas, and record a `validate` baseline when a system exists. If
   the plugin lacks a capability you need, ask the user to update it. Do not copy
   or vendor the extension into the repository; duplicate copies collide on tool
   names.
3. Record the canonical sources and the revision you read.
4. Name the platform and its exact design language, and use that platform's own
   references: stock control templates, theme resource dictionaries, icon font,
   and official control galleries. For example, Windows Fluent (WinUI) and Fluent
   on the web differ in focus visuals, input borders, subtle buttons, menus, and
   check glyphs. Never mix them.
5. Establish runtime evidence: an isolated build of the app, UI automation (for
   example the Windows App Development CLI or Computer Use), or the
   documentation site in a browser. Sites behind single sign-on often redirect
   plain HTTP fetches even when a signed-in browser surface can read them, so
   check both before declaring a site unreachable. Never bypass authentication
   or copy credentials or cookies. Do not change the user's real data,
   installation, sign-in, or pairing to reach a screen, and do not treat another
   task's running instance as evidence. Without runtime access, continue from
   source and state the limit.

## 2. Inventory

**App.** Walk the whole app in user order: first-run setup or onboarding with
every step and branch; the main workspace or dashboard; every navigation
destination and settings page; then transient surfaces such as menus, flyouts,
popups, dialogs, notifications, toasts, tooltips, and tray or companion
windows. Include empty, loading, error, and disabled states. For each surface,
read its owning views, styles, templates, resource dictionaries, assets, and any
code that changes defaults at runtime.

**System.** Read the principles, metaphor, values, voice, and positioning; every
foundation; and every component specification: anatomy, variant axes, sizes,
states, per-part token assignments, usage guidance, interaction, and
accessibility. Record the documentation site's navigation exactly: every
foundation section and component, with its name, order, and subtitle.

For every item, record exact geometry, token or resource bindings, typography
roles, states, motion, assets, and `path:line` evidence.

## 3. Brand and principles

- Take the name, tagline, description, voice, personality, metaphor,
  principles, and anti-references from the source's own language, and link the
  passages. Never paraphrase a stated tagline.
- Port the source's signature brand moment, such as a homepage animation,
  interactive banner, or animated logo, into `brand.hero` in
  `x-colophon.tokens`. Keep its artwork, layout, motion, and pointer behavior.
  Bundle the source's own markup, styles, and animation code inline, with assets
  as inline SVG or data URIs; HTTPS media also works, but external scripts and
  network requests are blocked. Use the design's CSS variables where the source
  uses tokens, and honor reduced motion. Set `title`, and set `height` to the
  banner's rendered height with document overflow hidden, so the frame shows no
  scrollbars. Add no controls the source lacks, such as a Replay button. Omit
  the hero when the source has none.

## 4. Foundations

- **Names.** Seed every token under its source name. For a token package, drop
  only syntax prefixes such as `--`. For app resources, use a readable form of
  the key, such as `cardBackground` for `CardBackgroundFillColorDefaultBrush`,
  with the exact key in `resource`. A token that fills a canvas role takes the
  role name instead (see Canvas roles).
- **Coverage.** App mode covers every app-defined resource and every platform
  resource the app's UI binds. System mode covers every token the system
  defines: colors, typography, spacing, radii, strokes, elevation, materials,
  motion, focus, grid, and breakpoints. Record values Colophon cannot hold as
  tokens in metadata or prose; do not invent token families for them.
- **No invention.** Never invent palettes, roles, high-contrast values, or
  fonts. Mark a value you cannot resolve as unresolved. No starter values may
  remain in a system that is not the starter.
- **Production mapping.** With a production port target, give every color a
  `resource`, such as a theme resource key or CSS custom property, and `themes`
  values (`dark` and `highContrast`) resolved from the platform's actual theme
  dictionaries. Do not infer high-contrast values from resource names. Label
  representative system colors as representative.
- **Usage context.** Give every token context an agent can act on: when to use
  it, when not to, and what it pairs with. In DESIGN.md, write each family's
  rules, such as surfaces versus fills, status versus decorative color, on-color
  pairing, how interaction states derive, component versus layout spacing, and
  which surfaces use each elevation tier. Link the source passages.
- **Typography.** Keep authored styles exactly: family stack, size, weight, line
  height, and tracking, including non-standard weights. Give every style a
  `role` (`display`, `body`, or `mono`) in `x-colophon.tokens.typography.scale`.
  Colophon takes each role's font family from the first style with that role, so
  list the default heading and interface styles first. Place editorial,
  marketing, or ceremonial styles after them; they remain available by name.
- **Canvas roles.** Colophon's own surfaces read the colors `ink`, `paper`,
  `surface`, `muted`, `line`, and `accent` (with `accentInk`, `positive`,
  `warning`, and `critical` for states) and the text styles `title`, `small`, and
  `caption`. Missing roles fall back to built-in values, mostly from the
  Northlight starter, so the system looks partly like Northlight. Map every role
  to the source token that fills it. In App mode, give that token the role name
  and keep its exact key in `resource`, so it is listed once. In System mode,
  keep the published names and add each role as a reference, such as
  `ink: "{colors.<source-token>}"` or `title: "{typography.<source-style>}"`,
  with the same `resource` and theme values. Never point a role at a value the
  source lacks.
- **Geometry.** Control dimensions, icon sizes, and artwork bounds are component
  geometry, not new spacing tokens.

## 5. Basic components

Start with the smallest reusable controls and visual atoms: buttons, links, text
inputs, selection controls, switches, badges, avatars, status and progress
indicators, glyph tiles, dividers, and artwork. Search existing definitions
first. Define each element that recurs or that composites need; one-off content
stays inside its composite.

- **Name:** use the source's name, for traceability.
- **Tokens:** bind every part to the seeded token the source assigns to it. Use
  exact pixel values only for control geometry the tokens do not cover.
- **Geometry and typography:** match the source exactly. Read pinned upstream
  templates for stock controls rather than guessing metrics, then apply caller
  code that restyles or overrides those defaults. Use one CSS pixel per source
  unit (DIP or point). Never round to the nearest token step.
- **Artwork and glyphs:** use real ones only: the platform icon font code point
  or the source SVG path, embedded images, every gradient stop, and the actual
  shadows. Placeholder shapes, generic icons, and flat substitutes are defects.
- **States:** `states` holds only the interaction states `hover`, `pressed`,
  `hoverPressed`, and `disabled`, which the preview's State selector can force.
  Model selected, checked, expanded, and similar states as boolean `state` keys,
  styled by `when` rules (optionally combined with an `interaction`) and switched
  by `on.click.toggle`. Put the platform's focus visual in `control.focus`. Show
  error, empty, loading, and other configured states as separate instances with
  their own props or `state`. Mark static atoms as static and give them no focus
  or tab stop.
- **Interaction:** interactivity is what a Colophon catalog adds over static
  mockups, so controls behave in the canvas. Inputs and text areas accept typing.
  Switches and check boxes use `on.click.toggle` with role `switch` or
  `checkbox`. Buttons that open menus or flyouts use `on.click.open` with a
  registered flyout component. Radio groups are exclusive, password fields mask,
  number fields enforce bounds, and disclosures expand. Record behavior the
  runtime cannot express, such as native animation, focus management, or
  virtualization, as a port requirement.
- **Variants:** a different label, icon, size, severity, or style preset is a
  configuration set through props. Add a separately named definition only when
  structure, brushes, or behavior differ, as with accent and standard buttons.
  Show each variant axis and size as a composite of configured instances, the
  way the source documents its variants.
- **Note:** give the purpose, anatomy, usage do's and don'ts, accessible name
  and role, source owner, and fidelity limits in plain text. Agents read notes,
  but people see them only in the preview's Definition panel, so put visible
  context on the page (section 7).

## 6. Composite controls

Build upward: basic components into rows, fields, cards, and menus; those into
scenario patterns such as wizard steps, settings groups, composers, and
dashboard cards; then into panels, windows, and shells. Each layer references
the one below through `component` instances and props. Never copy a referenced
tree.

Update an existing composite when its source changed, and remove retired
anatomy. Use the source's real content, order, and copy. Use synthetic,
non-sensitive values where user data would appear, and mark them as samples.
Render fixed-size references, such as a full window, at actual size; let them
scroll rather than scaling them down.

## 7. Pages

Store placement in `x-colophon.tokens.pages`. The sidebar is a flat list:
Brand, Components, custom pages in array order, and Configuration last. Give
every definition exactly one standalone home; nested reuse is not duplication.
Order each page bottom-up: artwork and atoms, then rows, patterns, and shells. A
page's `description` appears under its name in the sidebar; use the source's
one-line summary. `content` holds edit-mode notes: record sources, unit
conversion, sample data, and fidelity limits there. Never use the reserved
`brand` or `configuration` ids.

**App.** List the shared basic controls and shared compositions on the built-in
`components` entry. Add one custom page per app area, named as the app names it,
such as Setup, Chat, Settings, or Dashboards, in user-flow order.

**System.** Keep every foundation on Brand, which presents the token library;
add a foundation page with `sections` only when the user asks for one. Brand's
section headings are fixed (Color, Typography, Spacing, Radii, Shadows, and
Principles), so order tokens as the documentation site does, begin each token's
usage with its site subsection (for example "Surface:"), and record the
subtitles in DESIGN.md. After Components, add one custom page per documented
component, with id `component-<slug>` and the site's name, summary, and order.
The sidebar cannot nest these under Components; report that as a limit. On each
component page, list the base definition, its variant and state composites,
composed examples, and a documentation composite whose text layers carry the
site's usage, interaction, and accessibility guidance, for example in `details`
disclosures. Use the built-in `components` entry for a curated overview of the
basic building blocks.

Gallery pages are not app routing. Create `.agents/design/prototypes.jsonc` only
when the user asks for a click-through flow.

## 8. Present the source faithfully

- Canvas and typography roles carry the source's colors and fonts into
  Colophon's page titles, Brand page, and previews.
- Treat a documentation site's structure and visual language as the reference
  for page organization, section titles, and component documentation. Where its
  layout carries information Colophon's built-in sections cannot show, such as
  variant and state matrices or component anatomy, build it as editable
  composites bound to the seeded tokens. Do not fall back to generic placeholder
  layouts.
- Keep it a Colophon canvas: the toolbar, persistent page sidebar, Inspect,
  Validate, Export, and Save remain. Deliberate differences from the site are
  expected.
- Inspect must be able to select and edit every layer. Never substitute iframes,
  screenshots, captured site builds, or opaque fixtures for catalog components;
  the brand hero is the only embedded document.
- Restyling Colophon's own chrome beyond tokens and page metadata is an
  extension change. Propose it separately; do not fork or vendor the extension
  as part of a seed.

## 9. Component graph rules

`components.jsonc` is strict JSON at `meta.version` 3. These renderer rules
prevent rework:

- Give every object layer a unique, stable `id`.
- Appearance colors, radii, shadows, and text styles are token names and cannot
  come from props; vary them per instance with `appearance` overrides. Hex
  colors validate but bypass theme mapping; do not use them.
- `layout` accepts only `mode`, `gap`, `padding`, `align`, `justify`, `wrap`,
  `grow`, `columns`, `width`, and `height`. Sizes are pixel numbers, `fill`, or
  `hug`; there are no minimum, maximum, or percentage sizes. Use `grow` for
  flexible children. `justify` accepts `space-between`, not `between`.
- Spacing (`gap`, `padding`, and `margin`) takes a spacing token name or an
  exact pixel number.
- For exact or overlapping placement, give the parent a `freeform` layout and the
  child an absolute position, for example
  `"position": { "mode": "absolute", "x": 0, "y": 49 }`.
- `borderWidth` is one number for every edge. Draw single-edge dividers as
  separate hairline layers.
- `attrs.style` replaces every generated layout and appearance style. Avoid it;
  if it is unavoidable, write the complete style with token variables.
- Component instances merge overrides for layout, margin, position, appearance,
  motion, `states`, `state`, `when`, `on`, and `control`, but ignore `attrs` and
  `children`. Parameterize the definition with props instead. Set initial state
  per instance, for example `"state": { "checked": false }`.
- To drop browser control chrome, set `control.chrome` to `none` and give
  `control.focus` the platform's kind (`outline` or `underline`) and color token.
- Transitions animate only color, background color, border color and width,
  radius, shadow, width, height, and translate. Record other motion as a port
  requirement.
- Strings interpolate `{prop}` and collapse `{{` and `}}` to single braces.
  Double every brace in embedded code and sample text.
- Descendants of `svg` stay in the SVG namespace, so `defs`, gradients, filters,
  paths, and data URI images work. Give gradients and filters ids specific to
  their definition.
- Elements with browser defaults, such as lists, add margins, padding, and
  markers the source lacks. Use `div` layers with ARIA roles, or reset the
  defaults. Keep `summary` as the first child of `details`.
- In YAML front matter, quote hex and `rgba(...)` values and numeric-looking
  keys.

## 10. Verify, then iterate until exact

1. Run `validate` until it reports no errors. Resolve every warning the source
   can answer. A warning may remain only when it reflects a real gap in the
   source, such as an app with no written principles; list it in the final
   report. With a port target, every color needs a `resource`, and authority
   needs an `owner`, a `syncProcess`, and a `syncSource` for each target.
2. Confirm that every definition has exactly one page and that every page lists
   only defined components.
3. Render every page in each theme. In a scriptable browser surface on the
   canvas URL, switch themes with `#theme-switch .theme-btn[data-theme]` and
   pages with `.page-nav-link[data-page-id]`, waiting two animation frames after
   each switch. Check for missing tokens, clipping, overflow, nested interactive
   elements, and unnamed inputs.
4. Exercise every interactive control: typing, toggles, exclusive selection,
   menus and flyouts, disclosure, masking, and bounds. Force each interaction
   state with the preview's State selector, and check the instances that show
   the other states.
5. Measure layers by `data-ds-node-id` against the recorded source values,
   allowing only browser rounding (under half a pixel).
6. Compare screenshots with the source at the same size: an isolated native
   build, or the documentation site at the same viewport. Fix catalog errors and
   repeat until only renderer or platform limits remain, such as font
   rasterization, system materials, stock template visuals, or animation.
   Document those limits. Never claim pixel parity without this comparison.

## 11. Document and deliver

Besides the sections SKILL.md requires, DESIGN.md records:

- The source mode, canonical sources and revisions, and authority: owner,
  `syncProcess`, port targets, and per-area overrides. Name any tooling the port
  relies on, such as a UI automation or packaging CLI, in `syncProcess`.
- A section for each app area or foundation family: layout and geometry,
  resource bindings, typography roles, states, motion, reduced motion, and high
  contrast, with source links.
- In Components: the families and counts per page, the composition hierarchy,
  and a coverage table from each surface or documented item to its source owner,
  reused basic components, and composed reference.
- A fidelity audit: corrected or preserved source contracts, and how each was
  verified.
- Explicit limits: runtime walkthroughs not completed, unverified themes or
  states, and preview approximations.

Report concisely: counts by page, coverage, what remains unverified, and the
defaults you chose. Commit or push only as the user or repository instructs.

## Definition of done

- [ ] Every in-scope surface or documented item is in the coverage ledger with
      evidence, a page, and a status.
- [ ] Brand language and hero come from the source.
- [ ] Every source token is seeded with usage context, theme values, and a
      production mapping where required; no invented or starter values remain.
- [ ] Canvas roles map to source tokens, so the canvas shows the source's colors
      and default fonts.
- [ ] Every recurring element is an editable component graph with exact
      geometry, real artwork and glyphs, and platform-correct states.
- [ ] Composites reference basic components; nothing is duplicated.
- [ ] Pages mirror the source's organization, every definition has one home, and
      each page shows its variants, states, and usage context.
- [ ] Validation reports no errors, every remaining warning is a reported source
      gap, and every preview renders and behaves in every theme.
- [ ] Visual comparison is complete, or its limits are documented.
- [ ] No production code, tests, or build files changed.
