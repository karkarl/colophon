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
  the design source and build UI from its tokens, components, and principles; and
- a **canvas extension** (`extensions/colophon/`) with two canvases — one that renders
  and edits the system live, and a **Prototype** canvas that generates device-framed,
  click-through mockups from it — plus `colophon`/`prototype` tools and hooks so the
  agent has an initialized design system in context.

## How it works

### 1. The design system lives in the repo: `.agents/design/`
| File | What it is |
| --- | --- |
| `design.json` | Tokens: authority, brand, colors, typography, spacing, radii, shadows, principles |
| `components.jsonc` | A structured element-tree (JSON + comments) — the component patterns your team has agreed on |
| `principles.md` | Prose voice / information hierarchy / do & don't |

These are plain files. Commit them, review them in PRs, edit them by hand or in the canvas.

#### Design vs. port — the design leads, the implementation ships

The design files are always the **source of truth for design** — tokens, component
intent, and principles — and are framework-agnostic. `components.jsonc` is design
intent for the canvas preview, **not** shipping code. What varies is how a design
becomes shipping code, which `design.json` records in an `authority` block:

| Field | Meaning |
| --- | --- |
| `authority.designSource` | Who owns the *design* (default `"self"` = these files). |
| `authority.port` | App-wide default **port target**: `authoritySource` (what the UI ships as — e.g. `Native WinUI 3 / C#`, `SwiftUI`), `syncSource` (the reference/skill to port design → that implementation — e.g. `microsoft/win-dev-skills`), and optional `helperAgent`. |
| `authority.portOverrides[]` | Per-area / per-component overrides — e.g. a React-style **chat** surface targeting [Reactor](https://github.com/microsoft/microsoft-ui-reactor). Each has `area`, `components[]`, and the same three port fields. |

No `port`/overrides ⇒ the files are both the design **and** the implementation
source of truth (web/JSX repos) — Colophon's original behavior, unchanged. Scanning
a repo with no web styling (a native/XAML app) pre-fills a port target for you to
complete. The skill, the injected context, and the `AGENTS.md` pointer all reflect
these port targets, so agents know what each surface ships as and which skill to
port the design with — they never ship `components.jsonc` verbatim.

### 2. The canvas renders + edits it
Open the **Design System** canvas to see the system rendered live:
- Brand board, color palette, type scale, spacing/radii/shadows, principles.
- **Live component previews** — `components.jsonc` is rendered by a small pure JSON→DOM
  interpreter (no React, no Babel, works offline) using the system's own tokens, so you see
  real UI, not just code.
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
review bar (**Save to repo** / **Discard**). Any first save also scaffolds `components.jsonc` +
`principles.md`, and drops an idempotent **`AGENTS.md` pointer** at the repo root (see below).

### 2c. Seeding also writes an `AGENTS.md` pointer
The skill only reaches Copilot when the plugin is loaded — and a design system in `.agents/design/`
is otherwise invisible to agents unless a file they *already* read points to it. `AGENTS.md` is the
emerging cross-agent "README for agents" that tools load by default, so whenever Colophon seeds a repo
(`init`, or the first Save from import/scan) it adds a small **managed block** to the repo-root
`AGENTS.md` telling any agent to read `.agents/design/` before UI work. It's idempotent and
non-destructive: it creates `AGENTS.md` if absent, appends the block if the file exists, and updates
the block in place otherwise — never touching your other content. The block is delimited by
`<!-- colophon:start -->` / `<!-- colophon:end -->`.

### 3. Copilot references it automatically (the skill + tool + hooks)
- **`colophon` skill** — instructs the agent, on any UI work, to read `.agents/design/`
  and generate UI from its tokens, components, and principles (not ad-hoc styles).
- **`colophon` tool** — the agent calls it to get the system as text before UI work.
  `init=true` scaffolds `.agents/design/` from the starter; `scan=true` proposes one from the
  repo's existing UI when none exists yet.
- **Hooks** — when a repository contains `.agents/design/design.json`, `onSessionStart`
  announces the system exists and `onUserPromptSubmitted` detects UI-related prompts
  ("build a settings page", "fix the button styling") to inject it. Repositories without
  an initialized design system receive no Colophon prompt context; use the canvas or
  `colophon` tool explicitly to seed one.

### 4. Prototype canvas: click-through mockups from the design system
A second canvas turns the design system into **click-through prototypes** — so a team can
shape a flow by talking to Copilot instead of redlining in Figma, review it visually, then
convert a screen to code.

- **Format** — prototypes live at `.agents/design/prototypes.jsonc`: a framework-agnostic
  **scene graph** (layout primitives + references to your `components.jsonc` by name +
  **navigation as data**), never shipping code. It's pure data, so it renders safely and
  Copilot can patch a single node by id without rewriting the file. Every save re-emits a
  stable, key-ordered file plus a Markdown flow outline for painless PR review.
- **Device frames** — preview each screen in web breakpoints, desktop-app windows
  (Windows/WinUI, macOS), mobile (iPhone/Android), and tablet — selectable, rotatable, with
  custom sizes and a zoom-to-fit — like Chrome DevTools' device toolbar, but including
  native app chrome.
- **Interactions (v1)** — navigate between screens, simple state (toggles, tabs),
  open/close modals, and visibility bound to state. Click through it live in the canvas,
  rendered with your real tokens + components in Light/Dark/High-contrast.
- **Convert to code** — a first-pass `codegen` action emits code for the screen: faithful
  React/JSX (using your `ds-*` classes + components) when the design *is* the
  implementation, or a native hand-off scaffold + porting notes when `authority.port`
  targets WinUI/SwiftUI — reusing the same port mechanism as the design system.
- **`prototype` tool** — Copilot authors and reads prototypes from conversation:
  `action` of `read` (flow outline), `validate` (dangling navigation / unknown components or
  tokens), `patch` (surgical scene-graph ops), `codegen` (convert a screen), `export`
  (standalone browser artifact), or `publish` (explicit GitHub Pages deployment).

### Sharing a design system or prototype

| Audience | Share this | What they need |
| --- | --- | --- |
| Designers and developers | Commit `.agents/design/` and open a pull request | Repository access; they can open the Colophon and Prototype canvases in Copilot. |
| Someone continuing the agent work | Share the Copilot agent session from the repository's **Agents** view | Repository access. A session is useful for context and hand-off, not as a public presentation. |
| Stakeholders and reviewers | Use **Export** in the Prototype canvas | The generated `.agents/design/prototype-export/index.html` is a self-contained, interactive file that opens in any modern browser. |
| A broad browser audience | Use **Publish** in the Prototype canvas | GitHub authentication with repository admin access. Colophon writes only its generated file to `gh-pages` and opens the resulting GitHub Pages URL. |
| A team adopting the canvas extension | Share the extension as a private GitHub gist | The recipient can install the gist through Copilot, then open it in their own workspace. |

**Export** is the safe default: it preserves screens, device frames, themes, click-through
interactions, and component rendering without a Copilot session, a loopback server, or an
internet connection. **Publish** is intentionally separate and asks for confirmation. It uses
the authenticated GitHub CLI/API, never stages or commits the active working tree, and refuses
to overwrite a GitHub Pages configuration that is not already based on `gh-pages`.

## Agent/host-facing actions
**Colophon canvas:**
- `read` — return the current system as a text summary.
- `init` — scaffold `.agents/design/` (non-destructive); `mode: "starter" | "scratch"`.
- `scan` — scan existing UI and return a proposed system (text + evidence); writes nothing.
- `validate` — schema/parse + component checks; writes nothing.
- `refresh` — tell the open canvas to reload from disk.

**Prototype canvas:**
- `read` / `outline` — return the Markdown flow outline (screens, nodes, navigation).
- `patch` — apply surgical scene-graph ops (`upsertScreen`, `setNode`, `patchNode`,
  `setNav`, …) and save.
- `validate` — dangling navigation targets, unknown component/token references.
- `codegen` — convert a screen to code for the configured port target.
- `export` — write a self-contained interactive `prototype-export/index.html` below
  `.agents/design/`.
- `publish` — explicitly export and publish to the repository's `gh-pages` branch via the
  authenticated GitHub CLI/API, without touching the active working tree.
- `refresh` — tell the open canvas to reload from disk.

## Repo layout
```
plugin.json                       plugin manifest (skills + extensions)
.github/plugin/marketplace.json   makes this repo its own plugin marketplace
skills/colophon/SKILL.md          the "build UI from .agents/design/" skill
extensions/colophon/              the canvas extension:
  extension.mjs   wiring: canvases + tools + hooks + loopback server + file IO
  designio.mjs    locate / load / scaffold / save .agents/design/ ; AGENTS.md pointer ; token → CSS vars
  context.mjs     UI-intent detection + the summary/context text Copilot receives
  sources.mjs     seed generators: scratch skeleton, token importer, codebase scanner
  renderer.mjs    tiny iframe shell (design canvas)
  client.js       the in-canvas inspector app (onboarding, render, edit, live previews)
  styles.css      canvas chrome + the ds-* component runtime (from tokens)
  prototypeio.mjs  load / save / surgically patch / validate prototypes.jsonc (scene graph)
  proto-render.js  in-canvas JSON→DOM interpreter + interaction/state runtime
  components-runtime.js  browser-only component runtime used by standalone exports
  proto-client.js  the Prototype canvas app (device frames, screen switcher, click-through)
  proto-renderer.mjs / proto.css   prototype iframe shell + device-frame styles
  proto-outline.mjs                Markdown flow-outline generator
  protocodegen.mjs                 convert a screen to code for the port target
  prototypeexport.mjs              standalone HTML export writer
  pagespublish.mjs                 explicit GitHub Pages publisher
  sample/         bundled starter design system + sample prototypes.jsonc
```

## Notes & limitations (experimental)
- Component and prototype previews render with a pure in-canvas JSON→DOM interpreter, so
  they work fully offline — no CDN, no React/Babel.
- Editing currently covers tokens (colors, fonts, brand). Editing `components.jsonc` /
  `principles.md` is done in your editor for now.
- Prototypes are authored by Copilot (via the `prototype` tool) or by hand-editing
  `prototypes.jsonc`; the canvas is preview + click-through, not yet a drag-and-drop
  editor. Native `codegen` is a best-effort hand-off scaffold; the web/React target is
  deterministic.
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

After installing, reload Copilot (or restart it) and open the **Colophon** canvas — or
the **Prototype** canvas to build click-through mockups.

## License

MIT — see [LICENSE](./LICENSE).
