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

## Typography

- **display**: {typography.display} - Headlines, hero, section titles. Used with restraint.
- **title**: {typography.title} - Headlines, hero, section titles. Used with restraint.
- **heading**: {typography.heading} - Body copy, UI labels, buttons
- **body**: {typography.body} - Body copy, UI labels, buttons
- **small**: {typography.small} - Body copy, UI labels, buttons
- **caption**: {typography.caption} - Code, data, timestamps

## Layout

Use the named spacing tokens rather than ad-hoc values.

### Editor navigation

The Colophon Pages sidebar is editor chrome, not a preview of this design.
Use the host's generic surface, text, muted-text, and border tokens. Selected and
hovered rows use the same soft gray backplate with ink text. Mark selection with
a small ink pill at the leading edge, not a solid ink row; retain ink focus rings
(black in the default light theme).
The preview theme and authored tokens must not recolor or resize this navigation.
Reuse the generic editor's compact spacing: 4px gaps/radii, 8px list padding,
and 12px heading/action padding. The selection indicator uses
`--page-nav-indicator-width` (4px) and `--page-nav-indicator-height` (20px), with
fully rounded ends and a 4px leading inset. Reserve 16px of leading row padding
in every state so labels do not shift on selection.
Keep Northlight tokens in the authored preview.

## Elevation & Depth

Use the named shadows in `x-colophon.tokens.shadows` when elevation is needed.

## Shapes

Use the `rounded` tokens for corner radii.

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
