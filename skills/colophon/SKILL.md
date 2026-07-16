---
name: colophon
description: >-
  Use whenever you create, edit, review, or fix UI in a repository — pages,
  screens, components, layouts, CSS/styling, themes, or any visual change.
  Colophon makes the repo's own design system at `.agents/design/` the shared
  reference: read it first and generate UI from its color, typography, spacing,
  radius tokens, component patterns, voice, and anti-references instead of
  inventing new styles. Check `authority.model` — `canonical` files are the source
  of truth; `derived` files mirror a canonical (e.g. native) UI that wins on
  conflict. If no design system exists yet, offer to seed one.
---

# Colophon — build UI from the repo's design system

Colophon treats a repository's **`.agents/design/`** folder as the shared, agreed
reference for how UI in that repo should look and feel. Your job when doing any UI
work is to read it first and produce UI that conforms to it — reusing the team's
tokens and component patterns rather than improvising one-off values.

## Know the authority model first

`design.json` carries an `authority.model` that tells you *how much* weight these
files carry. Check it before you rely on them:

- **`canonical`** (the default, and the case when the field is absent) — these
  files **are** the source of truth. Web/JSX-first repos work this way: the tokens
  compile to the CSS variables the app actually ships. Generate UI from them, and
  if you need a value they don't cover, add it here.
- **`derived`** — these files are a **non-shipping visual mirror** of some other
  canonical surface named in `authority.canonicalSource` (e.g. a native WinUI 3
  XAML/C# or SwiftUI app). Match them for consistency, but **do not treat them as
  a parallel product authority**: when the files and the canonical source differ,
  the **canonical source wins**. After you change the canonical (native) UI,
  reflect the change back into `.agents/design/` (see `authority.maintainer`), and
  say so in your PR. Don't silently "fix" native code to match a derived token.

Everything below applies to both modes; the only difference is who wins on a
conflict, and where a genuinely new value should ultimately live.

## When this applies

Consult Colophon **before** you write or change any of:
- new pages, screens, views, or routes with a visual surface
- components, layouts, or design primitives (buttons, inputs, cards, nav, etc.)
- CSS, styling, themes, tokens, or visual polish
- bug fixes that touch spacing, color, type, states, or responsiveness

If a task is purely non-visual (pure logic, data, build config), you can skip it.

## Step 1 — Load the design system

Resolve the repo's design system, in this order:

1. **Preferred:** if the **`colophon` tool** is available (the Colophon canvas
   extension is installed), call it. It returns a text summary of the system —
   brand, colors, typography, spacing, radii, component patterns, principles, and
   anti-references — already condensed for you.
2. **Otherwise, read the files directly** from `.agents/design/`:
   - `design.json` — tokens: `authority` (model + canonical source), `brand`
     (name, tagline, description), `colors`, `typography` (families + scale),
     `spacing`, `radii`, `shadows`, `principles`.
   - `components.jsx` — "pseudocode React": the component patterns the team has
     agreed on. Treat these as the structure/props/variants to reuse.
   - `principles.md` — voice, information hierarchy, and do/don't guidance.

Read `authority.model` (see the top of this doc) to know whether these files lead
or trail the UI. Read `brand.description` for app/project context — it tells you
what you're building and for whom, which should inform layout and copy, not just
styling.

## Step 2 — Generate UI that conforms

- **Use token names, not raw values.** Reference the semantic tokens
  (e.g. `accent`, `ink`, `paper`, spacing step `4`, radius `md`) via whatever the
  repo's mechanism is (CSS variables, a theme object, Tailwind config, etc.).
  Do not paste literal hex codes, arbitrary px, or ad-hoc font stacks when a
  token already covers it.
- **Reuse component patterns.** If `components.jsx` defines a Button, Field, Card,
  etc., mirror its structure, variants, and states instead of authoring a new one.
  Extend the existing pattern rather than forking a parallel one.
- **Respect hierarchy and principles.** Follow the system's stated principles
  (e.g. "hierarchy over decoration", "one accent used sparingly", motion timing).
  Let size, weight, and spacing carry hierarchy before reaching for color.
- **Honor the voice.** Match the brand's tone in any user-facing copy, labels,
  empty states, and errors.
- **Avoid the anti-references.** The system lists patterns to avoid — do not
  produce them, even if they'd otherwise be a common default.

## Step 3 — Keep the system coherent

- If you genuinely need a value the system doesn't cover, **add it to the design
  system** (a new token or a new/updated pattern in `.agents/design/`) rather than
  scattering a one-off magic value in feature code — then use it. Call this out so
  a human can review it in the PR. (For a `derived` system, the value should first
  exist in the canonical/native UI; the file here records it.)
- Prefer one confident, on-system element over several tentative custom ones.

## If there is no `.agents/design/` yet

Don't silently invent an ad-hoc style. When the user is doing UI work in a repo
with no design system, **offer to seed one** first, then build against it:

- Call the **`colophon` tool** with `init` to scaffold a starter system, or with
  `scan` to propose one from the repo's existing UI (colors/fonts/spacing found in
  the codebase). Or tell the user to open the **Colophon canvas** to create/refine
  it visually (start fresh, import `.json` tokens, or scan the codebase).
- Once `.agents/design/` exists, proceed with Steps 1–3.

Seeding also adds an idempotent pointer block to the repo-root **`AGENTS.md`** (the
cross-agent convention), so any agent — not just Copilot with this skill — is told to
read `.agents/design/` before UI work. It's non-destructive: it never overwrites the
user's other `AGENTS.md` content.

The design system is a shared, human-readable artifact that designers and
developers refine together in the repo and in the Colophon canvas. Your role is to
keep every UI change faithful to it — and, when it's a `derived` system, to keep it
faithful to the canonical UI it mirrors.
