# Colophon

> *A colophon is the note at the back of a book naming its typefaces, materials, and makers. This is that — for your app's UI.*

An **experimental** GitHub Copilot **plugin** that turns a repo's design system
into a live, editable canvas — and makes Copilot generate UI from it whenever it
builds or fixes UI. Inspired by Anthropic's `frontend-design` skill and
[pbakaus/impeccable](https://github.com/pbakaus/impeccable).

The distinguishing idea: the design system is a **shared, human-readable artifact in
the repo** that designers and developers refine together, and that the agent reads
automatically.

Colophon ships two halves in one plugin:
- a **skill** (`skills/colophon/`) that tells Copilot to treat `.agents/design/` as
  the source of truth and build UI from its tokens, components, and principles; and
- a **canvas extension** (`extensions/colophon/`) that renders and edits the system
  live, and exposes a `colophon` tool + hooks so the agent always has it in context.

## How it works

### 1. The design system lives in the repo: `.agents/design/`
| File | What it is |
| --- | --- |
| `design.json` | Tokens: brand, colors, typography, spacing, radii, shadows, principles |
| `components.jsx` | "Pseudocode React" — the component patterns your team has agreed on |
| `principles.md` | Prose voice / information hierarchy / do & don't |

These are plain files. Commit them, review them in PRs, edit them by hand or in the canvas.

### 2. The canvas renders + edits it
Open the **Design System** canvas to see the system rendered live:
- Brand board, color palette, type scale, spacing/radii/shadows, principles.
- **Live component previews** — `components.jsx` is compiled (React + Babel) and rendered
  using the system's own tokens, so you see real UI, not just code.
- **Inline editing** — change a color/font/brand text and **Save to repo** writes
  `design.json` back. File edits stream back into the canvas via SSE.

If a repo has no `.agents/design/` yet, the canvas shows a bundled **starter** system plus a
3-way **onboarding** panel (below).

### 2b. Seeding a repo — three ways
When there's no `.agents/design/`, choose how to start; refine everything in the canvas after.
| Mode | What it does |
| --- | --- |
| **Start fresh** | *Bundled starter* (the "Northlight" system) or a *blank skeleton* (grayscale + one accent, system fonts). Writes immediately. |
| **Import tokens** | Point at a repo-relative `.json` path or paste token JSON. Adapts our schema, flat `{name:hex}`, nested Tailwind / Style-Dictionary (`colors`/`fontFamily`/`spacing`/`borderRadius`), and W3C `{$value}` tokens. Loads as a **proposal** to refine, then Save. |
| **Scan codebase** | Walks the repo's CSS/JSX/styles and extracts colors (prefers named CSS vars), fonts, spacing, radii, shadows — classifying unnamed colors into ink/paper/accent. Loads as a **proposal** to refine, then Save. |

Starter/scratch write straight to `.agents/design/`; import/scan load an **unsaved proposal** with a
review bar (**Save to repo** / **Discard**). Any first save also scaffolds `components.jsx` +
`principles.md`.

### 3. Copilot references it automatically (the skill + tool + hooks)
- **`colophon` skill** — instructs the agent, on any UI work, to read `.agents/design/`
  and generate UI from its tokens, components, and principles (not ad-hoc styles).
- **`colophon` tool** — the agent calls it to get the system as text before UI work.
  `init=true` scaffolds `.agents/design/` from the starter; `scan=true` proposes one from the
  repo's existing UI when none exists yet.
- **Hooks** — `onSessionStart` announces the system exists; `onUserPromptSubmitted` detects
  UI-related prompts ("build a settings page", "fix the button styling") and injects the
  design system so the model honors your tokens, patterns, and anti-references.

## Agent/host-facing actions
- `read` — return the current system as a text summary.
- `init` — scaffold `.agents/design/` (non-destructive); `mode: "starter" | "scratch"`.
- `scan` — scan existing UI and return a proposed system (text + evidence); writes nothing.
- `refresh` — tell the open canvas to reload from disk.

## Repo layout
```
plugin.json                       plugin manifest (skills + extensions)
.github/plugin/marketplace.json   makes this repo its own plugin marketplace
skills/colophon/SKILL.md          the "build UI from .agents/design/" skill
extensions/colophon/              the canvas extension:
  extension.mjs   wiring: canvas + tool + hooks + loopback server + file IO
  designio.mjs    locate / load / scaffold / save .agents/design/ ; token → CSS vars
  context.mjs     UI-intent detection + the summary/context text Copilot receives
  sources.mjs     seed generators: scratch skeleton, token importer, codebase scanner
  renderer.mjs    tiny iframe shell
  client.js       the in-canvas inspector app (onboarding, render, edit, live previews)
  styles.css      canvas chrome + the ds-* component runtime (from tokens)
  sample/         bundled starter design system
```

## Notes & limitations (experimental)
- Live component previews load React + Babel from a CDN; offline, previews fall back to
  showing source. (Vendoring these locally is a possible next step.)
- Editing currently covers tokens (colors, fonts, brand). Editing `components.jsx` /
  `principles.md` is done in your editor for now.
- Canvas APIs are an experimental SDK surface and may change.

## Install

Colophon is a Copilot plugin **and** its own marketplace, so there are a few ways in.

**As a plugin (recommended — gets the skill + canvas together):**
```bash
copilot plugin install karkarl/colophon
```
Or register the marketplace, then install by name:
```bash
copilot plugin marketplace add karkarl/colophon
copilot plugin install colophon@colophon
```
You can also declare it in `~/.copilot/settings.json` (all repos) or a repo's
`.github/copilot/settings.json` (whole team) via the `enabledPlugins` field.

**Just the canvas extension (no plugin):** the extension lives in
`extensions/colophon/`. Install that subdirectory into
`~/.copilot/extensions/colophon/`, or point the `install_extension` tool at
`https://github.com/karkarl/colophon/tree/main/extensions/colophon`.

After installing, reload Copilot (or restart it) and open the **Colophon** canvas.

## License

MIT — see [LICENSE](./LICENSE).
