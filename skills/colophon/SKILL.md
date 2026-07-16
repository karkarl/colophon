---
name: colophon
description: >-
  Use whenever you create, edit, review, or fix UI in a repository — pages,
  screens, components, layouts, CSS/styling, themes, or any visual change.
  Colophon makes the repo's own design system at `.agents/design/` the shared
  reference: read it first and generate UI from its color, typography, spacing,
  radius tokens, component patterns, voice, and anti-references instead of
  inventing new styles. The design files are the source of truth for *design*;
  read `authority` to see what each surface ships as and which reference/skill to
  port the design with. If no design system exists yet, offer to seed one.
---

# Colophon — build UI from the repo's design system

Colophon treats a repository's **`.agents/design/`** folder as the shared, agreed
reference for how UI in that repo should look and feel. Your job when doing any UI
work is to read it first and produce UI that conforms to it — reusing the team's
tokens and component patterns rather than improvising one-off values.

## Design leads, the implementation ships — read `authority` first

The design files are **always the source of truth for design** — tokens, component
intent, and principles — and are framework-agnostic. `components.jsx` is design
intent for preview, **not** shipping code. What varies is how a design becomes
shipping code, recorded in `design.json`'s `authority` block:

- **`authority.designSource`** — who owns the *design* (default `"self"` = these files).
- **`authority.port`** — the app-wide default **port target**:
  - `authoritySource` — what the surface actually ships as (e.g. `Native WinUI 3 / C#`, `SwiftUI (iOS)`, `React web`).
  - `syncSource` — the reference/skill you use to port design → that implementation (e.g. `https://github.com/microsoft/win-dev-skills`).
  - `helperAgent` — an optional skill/agent that performs the port (may be empty — e.g. Reactor has none yet).
- **`authority.portOverrides[]`** — per-area / per-component overrides (each with
  `area`, `components[]`, and the same three port fields). Example: a React-style
  **chat** surface targeting [Reactor](https://github.com/microsoft/microsoft-ui-reactor).

**When there's a port target:** follow the design tokens/patterns, then port the
design into the app's implementation using the matching `syncSource` (and
`helperAgent` if present). Don't ship `components.jsx` verbatim, and don't treat the
JSX as a parallel product authority — it's design intent.

**When there's no port target** (no `port`/overrides — the web/JSX case): the files
are both the design and the implementation source of truth. Generate UI directly
from them, and if you need a value they don't cover, add it here.

Everything below applies either way; the only difference is whether there's a port
step to the app's implementation, and which reference/skill performs it.

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
   - `design.json` — tokens: `authority` (design source + port targets), `brand`
     (name, tagline, description), `colors`, `typography` (families + scale),
     `spacing`, `radii`, `shadows`, `principles`.
   - `components.jsx` — "pseudocode React": the component patterns the team has
     agreed on. Treat these as the structure/props/variants to reuse.
   - `principles.md` — voice, information hierarchy, and do/don't guidance.

Read `authority` (see the top of this doc) to know what each surface ships as and
which reference/skill to port the design with. Read `brand.description` for
app/project context — it tells you what you're building and for whom, which should
inform layout and copy, not just styling.

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
  a human can review it in the PR. (When there's a port target, add the value to
  the design here, then port it into the app's implementation via the `syncSource`.)
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
keep every UI change faithful to it — and, when there's a port target, to port that
design faithfully into the app's implementation via the configured reference/skill.
