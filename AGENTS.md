<!-- colophon:start -->
## Design system

This repository has a living design system at [`.agents/design/`](.agents/design/).
**Read it before creating or changing any UI** — pages, components, layouts, CSS, or themes:

- `.agents/design/design.json` — design tokens: brand, colors, typography, spacing, radii, shadows, principles.
- `.agents/design/components.jsonc` — the component patterns to reuse (structure, variants, states).
- `.agents/design/principles.md` — voice, information hierarchy, and do/don't guidance.

Generate UI from these tokens and patterns: use token names (e.g. `accent`, `ink`, spacing step `4`, radius `md`), not raw hex or ad-hoc px; reuse the documented components instead of inventing new ones; honor the brand voice; and avoid the system's listed anti-references. If you need a value the system doesn't cover, add it to `.agents/design/` rather than hard-coding a one-off.

<sub>Managed by [Colophon](https://github.com/karkarl/colophon) — edit `.agents/design/` to change the system; this block only points to it.</sub>
<!-- colophon:end -->
