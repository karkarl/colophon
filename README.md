# Colophon

> *A colophon is the note at the back of a book naming its typefaces, materials, and makers. This is that — for your app's UI.*

An **experimental** Copilot CLI canvas extension that turns a repo's design system
into a live, editable canvas — and makes Copilot reference it whenever it builds or
fixes UI. Inspired by Anthropic's `frontend-design` skill and
[pbakaus/impeccable](https://github.com/pbakaus/impeccable).

The distinguishing idea: the design system is a **shared, human-readable artifact in
the repo** that designers and developers refine together, and that the agent reads
automatically.

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

### 3. Copilot references it automatically (the "skill" half)
- **`design_system` tool** — the agent calls it to get the system as text before UI work.
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

## Files
```
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

Colophon is a user-scoped Copilot CLI canvas extension. Install it into
`~/.copilot/extensions/colophon/` (or `$COPILOT_HOME/extensions/colophon/`):

```bash
git clone https://github.com/karkarl/colophon.git ~/.copilot/extensions/colophon
```

Then reload extensions in Copilot CLI (or restart it). `copilot-extension.json` marks the
folder as a Copilot extension. You can also install it from the command palette
("Install extension from gist…") or via the `install_extension` tool pointed at this repo.

## License

MIT — see [LICENSE](./LICENSE).
