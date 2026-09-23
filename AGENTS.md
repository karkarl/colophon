<!-- colophon:start -->
## Design system

This repository has a living design system at [`DESIGN.md`](DESIGN.md).
**Read it before creating or changing any UI** — pages, components, layouts, CSS, or themes:

- `DESIGN.md` — design tokens and rationale: brand, colors, typography, spacing, radii, shadows, principles.
- `.agents/design/components.jsonc` — the component patterns to reuse (structure, variants, states).

Generate UI from these tokens and patterns: use token names (e.g. `accent`, `ink`, spacing step `4`, radius `md`), not raw hex or ad-hoc px; reuse the documented components instead of inventing new ones; honor the brand voice; and avoid the system's listed anti-references. If you need a value the system doesn't cover, add it to `DESIGN.md` rather than hard-coding a one-off.

Use the **Colophon** tool/canvas to inspect, edit, and preview this system when available. Install the optional plugin with `copilot plugin install karkarl/colophon`. Without the extension, read and edit the files directly; Colophon is not required.

<sub>Managed by [Colophon](https://github.com/karkarl/colophon) — edit `DESIGN.md` to change the system; this block only points to it.</sub>
<!-- colophon:end -->
