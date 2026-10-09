---
version: alpha
name: Northlight
description: Northlight is a writing and publishing tool for engineers who document their work in public — a calm, editorial space for long-form field notes, changelogs, and technical essays. It favors readable typography and a quiet, unhurried interface over dashboard clutter.
colors:
  ink: "#1c1a17"
  paper: "#f7f4ee"
  surface: "#ffffff"
  muted: "#6b6459"
  line: "#e4ddd0"
  accent: "#b5502a"
  accentInk: "#fbf7f0"
  positive: "#3f6b4c"
  warning: "#a8791f"
  critical: "#8f2f2a"
  selection: "#0969da"
typography:
  display:
    fontFamily: '"Fraunces", "Iowan Old Style", Georgia, serif'
    fontSize: 44px
    fontWeight: 600
    lineHeight: 48px
    letterSpacing: -0.02em
  title:
    fontFamily: '"Fraunces", "Iowan Old Style", Georgia, serif'
    fontSize: 28px
    fontWeight: 600
    lineHeight: 34px
    letterSpacing: -0.01em
  heading:
    fontFamily: '"Söhne", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 20px
    fontWeight: 600
    lineHeight: 26px
  body:
    fontFamily: '"Söhne", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 16px
    fontWeight: 400
    lineHeight: 25px
  small:
    fontFamily: '"Söhne", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  caption:
    fontFamily: '"Berkeley Mono", "SFMono-Regular", Consolas, monospace'
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.04em
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "5": 24px
  "6": 32px
  "7": 48px
  "8": 64px
rounded:
  sm: 4px
  md: 8px
  lg: 14px
  pill: 999px
x-colophon:
  version: 1
  tokens:
    $schema: https://agents.design/schema/v1
    meta:
      version: 1
      updatedBy: starter
      note: Edit this in the Design System canvas or directly. Devs + designers share this file.
    authority:
      designSource: self
      port: null
      portOverrides: []
    shadows:
      - name: sm
        value: 0 1px 2px rgba(28,26,23,0.06)
      - name: md
        value: 0 4px 16px rgba(28,26,23,0.08)
      - name: lg
        value: 0 12px 40px rgba(28,26,23,0.12)
    principles:
      - Hierarchy over decoration — size, weight, and space do the work before color does.
      - One accent. Reach for `accent` sparingly so it always means "act here".
      - "Never gray text on a colored background. Tint neutrals toward the brand, never pure #000/#888."
      - "Motion is a cue, not a garnish: 120-200ms ease-out, no bounce/elastic."
      - Prefer one confident element over three tentative ones.
    brand:
      tagline: Field notes for people who build in the open.
      surface: product
      voice: Plain-spoken, exact, quietly confident. Short sentences. No hype words.
      personality:
        - editorial
        - precise
        - warm
        - unhurried
      antiReferences:
        - generic SaaS landing pages
        - purple-to-blue gradients
        - Inter for everything
        - cards nested inside cards
    colors:
      ink:
        usage: Primary text, headings
        themes:
          dark: "#f2ede3"
          highContrast: "#ffffff"
      paper:
        usage: App / page background
        themes:
          dark: "#1a1714"
          highContrast: "#000000"
      surface:
        usage: Raised surfaces, inputs
        themes:
          dark: "#221e1a"
          highContrast: "#000000"
      muted:
        usage: Secondary text, captions
        themes:
          dark: "#a89f90"
          highContrast: "#ffffff"
      line:
        usage: Borders, dividers
        themes:
          dark: "#3a342c"
          highContrast: "#ffffff"
      accent:
        usage: Primary actions, links, focus
        themes:
          dark: "#e0794f"
          highContrast: "#ffd60a"
      accentInk:
        usage: Text on accent
        themes:
          dark: "#1a1714"
          highContrast: "#000000"
      positive:
        usage: Success states
        themes:
          dark: "#5c9b70"
          highContrast: "#3ff07a"
      warning:
        usage: Warnings
        themes:
          dark: "#d0a54e"
          highContrast: "#ffb000"
      critical:
        usage: Errors, destructive
        themes:
          dark: "#d1554e"
          highContrast: "#ff5449"
      selection:
        usage: Editor-only geometry selection, hover bounds, resize handles, and valid drop targets
        themes:
          dark: "#79c0ff"
          highContrast: "#58e1ff"
    typography:
      display:
        weights:
          - 400
          - 600
        usage: Headlines, hero, section titles. Used with restraint.
      body:
        weights:
          - 400
          - 500
        usage: Body copy, UI labels, buttons
      mono:
        weights:
          - 400
        usage: Code, data, timestamps
      scale:
        display:
          role: display
        title:
          role: display
        heading:
          role: body
        body:
          role: body
        small:
          role: body
        caption:
          role: mono
    spacing:
      unit: 4
---

## Overview

Northlight is a writing and publishing tool for engineers who document their work in public — a calm, editorial space for long-form field notes, changelogs, and technical essays. It favors readable typography and a quiet, unhurried interface over dashboard clutter.

<!-- colophon:note -->
Edit and preview this design with the **Colophon** canvas in the GitHub Copilot app.
Install the optional plugin with `copilot plugin install karkarl/colophon`.
Agents without Colophon can read and edit this file directly.
[Colophon documentation](https://github.com/karkarl/colophon).
<!-- colophon:note -->

This file owns the design tokens and rationale. `x-colophon` preserves preview
themes, production resource mappings, and other Colophon-specific metadata.

Voice: Plain-spoken, exact, quietly confident. Short sentences. No hype words.

Personality: editorial, precise, warm, unhurried.

## Colors

- **ink** {colors.ink}: Primary text, headings
- **paper** {colors.paper}: App / page background
- **surface** {colors.surface}: Raised surfaces, inputs
- **muted** {colors.muted}: Secondary text, captions
- **line** {colors.line}: Borders, dividers
- **accent** {colors.accent}: Primary actions, links, focus
- **accentInk** {colors.accentInk}: Text on accent
- **positive** {colors.positive}: Success states
- **warning** {colors.warning}: Warnings
- **critical** {colors.critical}: Errors, destructive
- **selection** {colors.selection}: Editor geometry feedback only. Never a
  component fill or secondary action accent. Pair blue outlines with handles,
  insertion lines, and destination text; invalid targets get no valid-drop cue.

## Typography

- **display**: {typography.display} - Headlines, hero, section titles. Used with restraint.
- **title**: {typography.title} - Headlines, hero, section titles. Used with restraint.
- **heading**: {typography.heading} - Body copy, UI labels, buttons
- **body**: {typography.body} - Body copy, UI labels, buttons
- **small**: {typography.small} - Body copy, UI labels, buttons
- **caption**: {typography.caption} - Code, data, timestamps

## Layout

Use the named spacing tokens rather than ad-hoc values.

Both Colophon and Prototype Inspect use a Layers rail of four spacing-8 units and a Properties
rail of five spacing-8 units. Below their combined width plus five spacing-8
units of canvas, stack the rails into one column. Editor controls reuse the
small/caption type styles, spacing 1-4, and radius sm/md. Pointer hit areas use
spacing 4; resize-handle glyphs use spacing 2.

Prototype keeps device framing and Fit zoom. In Inspect, its existing Screens
navigation lives in a collapsible section of the Layers rail; leaving Inspect
restores the full screen menu. Reuse the same selection overlays, insertion
component palette, geometry controls, and panel docking across both editors.

Primitive creation belongs in one floating bottom toolbar, centered in the
editing viewport rather than over either rail. Reuse the Button/SubtlePicker
patterns: `surface` background, `line` border, `ink` icons, `lg` outer radius,
`md` shadow, spacing `2` padding and `1` gaps. Tool targets use spacing `5 + 4`
with icons at `4 + 1`; the shape-menu toggle uses `5`. Keep spacing `4` clear
below the toolbar. App-selected buttons use neutral black chrome, independent of
the sample system: `--editor-control-ink` is #1c1a17 and
`--editor-control-surface` is #ffffff, matching Prototype's existing controls.
Do not bind selected editor buttons or their focus rings to the preview's orange
`accent`. Keep those sample tokens unchanged for rendered design components.
Blue `selection` remains reserved for geometry feedback.

Move selects and repositions. Frame, Rectangle, Ellipse, Line, Arrow, and Text are modes:
click creates default geometry; dragging sets bounds, including reverse
directions. Shift constrains frames and area shapes to a square/circle; for lines
and arrows it snaps the direction to 45-degree increments. Enter inserts
into the selected container without a pointer; Escape cancels. Completion
returns to Move, and Text focuses the literal-text property. Retain flow layout
when drawing into a flow container. Keep component instances in the Layers
rail's Components picker; do not duplicate primitive tools there. Add components
in the toolbar opens a searchable dropdown of the same live component names,
not a second library. It uses the SubtlePicker/Field patterns, spacing `2`,
radius `md`, shadow `md`, and a four-spacing-8-unit width bounded by the viewport.
Search and result text use the same `small` typography as the Components header.
Result rows are borderless subtle buttons: transparent at rest, `line` on hover,
and `paper` when pressed, with a visible neutral keyboard focus outline.
Show an explicit empty-search message. Selecting an item inserts a reference
into the selected container, or beside a leaf; Escape closes and restores focus.

New freeform frames default to 160 by 96 document pixels; rectangles and ellipses
to 96 by 64. Text defaults to hug sizing, or fixed bounds when drawn.
Lines and arrows default to a horizontal 96 by 16 box, with a 2-pixel stroke
and an arrowhead up to 8 pixels long. Stroke color defaults to `ink`.
These are editable object geometry, not UI spacing tokens. Geometry scaling
preserves typography, spacing, radius, and shadow token references.

## Elevation & Depth

Use the named shadows in `x-colophon.tokens.shadows` when elevation is needed.

## Shapes

Use the `rounded` tokens for corner radii.
Layer `shape: "ellipse"` is geometric, not a radius token: a 50% border radius
preserves a true ellipse at any aspect ratio and takes precedence over appearance
radii. All shape primitives are leaves; Frame is the container tool.
Line/arrow `endpoints` store start/end normalized x/y coordinates in their fixed
pixel bounds. The arrowhead is at the drag's release point, including reverse
drags. Shared SVG geometry drives both previews, exports, and generated code.
Use `appearance.borderColor` and `borderWidth` for the labeled stroke controls;
these shapes have no background fill or rectangular border.

## Components

Reuse [component patterns](.agents/design/components.jsonc); these describe design intent, not shipping code.
Optional click-through flows live in `.agents/design/prototypes.jsonc`.

## Do's and Don'ts

- Hierarchy over decoration — size, weight, and space do the work before color does.
- One accent. Reach for `accent` sparingly so it always means "act here".
- Never gray text on a colored background. Tint neutrals toward the brand, never pure #000/#888.
- Motion is a cue, not a garnish: 120-200ms ease-out, no bounce/elastic.
- Prefer one confident element over three tentative ones.
- Avoid generic SaaS landing pages.
- Avoid purple-to-blue gradients.
- Avoid Inter for everything.
- Avoid cards nested inside cards.
