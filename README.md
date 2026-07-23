# Colophon

> *A colophon is the note at the back of a book naming its typefaces, materials, and makers. This is that — for your app's UI.*

<img width="1867" height="1058" alt="image" src="https://github.com/user-attachments/assets/2b8f85e7-6d3c-447a-aafa-4dc2d0fcc97f" />
<img width="1860" height="1053" alt="image" src="https://github.com/user-attachments/assets/7c8c97f2-6686-4c6b-9472-d0492386fd5d" />

Colophon gives AI coding agents a shared, living design system for every repo — seed it, edit it in a live canvas, prototype flows,
and turn approved designs into production code.


Colophon ships two halves in one plugin:
- a **skill** (`skills/colophon/`) that tells Copilot to treat `.agents/design/` as the design source and build UI from its defined tokens, components, and principles; and
- a **canvas extension** (`extensions/colophon/`) with two canvases:
    - **Colophon canvas**: that renders and edits the defined design system live, and
    - **Prototype canvas**: that renders device-framed, click-through mockups, including `colophon`/`prototype` tools and hooks so the agent has an initialized design system in context.


## Quick start

### Github Copilot App

In a repository you want to design or prototype:

1. Install the plugin:
```javascript
copilot plugin install karkarl/colophon
```

2. Reload or restart Copilot so it discovers the plugin.
3. Open the **Colophon** canvas. If the repository has no design system yet, choose **Start fresh**, **Import tokens**, or **Scan codebase**.
4. Save the proposal to create `.agents/design/`. From then on, Colophon supplies that shared design context when you ask Copilot to build or change UI.

Open the **Prototype** canvas when you are ready to create or preview a click-through flow. Commit `.agents/design/` so the rest of the team works from the same system.

## How it works

### 1. The design system lives in the repo: `.agents/design/`
| File | What it is |
| --- | --- |
| `design.json` | Tokens: authority, brand, colors, typography, spacing, radii, shadows, principles |
| `components.jsonc` | A structured element-tree — the component patterns your team has agreed on |
| `principles.md` | Prose voice / information hierarchy / do & don't |

These are plain files. Commit them, review them in PRs, edit them by hand or in the canvas.

#### `design.json`: the design contract and agent hand-off

`design.json` is the durable contract between people, the canvas, and agents: it names the visual system **and** tells an agent how that system becomes production UI.

The core design fields—`brand`, `colors`, `typography`, `spacing`, `radii`,`shadows`, and `principles`—are framework-agnostic design intent. Agents use their names and usage guidance rather than inventing ad-hoc values. `components.jsonc`describes reusable patterns for canvas preview and implementation guidance; it is
not automatically shipping code.

The `authority` block is the production hand-off. It removes the ambiguity that normally exists when a design-system preview and the app's implementation use different technologies:

| Field | What it tells people and agents |
| --- | --- |
| `authority.designSource` | Who owns the design. `"self"` (the default) means `.agents/design/` is the design source of truth. |
| `authority.port` | The app-wide default production target. Leave it `null` when no separate implementation needs a port from the design contract. |
| `authority.port.authoritySource` | What the UI actually ships as, such as `Native WinUI 3 / C#` or `SwiftUI`. That implementation wins when it differs from the canvas preview. |
| `authority.port.syncSource` | The skill, repository, or reference an agent must use to port the design into the production target—for example, `microsoft/win-dev-skills`. |
| `authority.port.helperAgent` | An optional specialist agent or skill that performs the port. |
| `authority.owner` / `authority.port.owner` | The team or person responsible for keeping the canonical implementation aligned with the design. |
| `authority.syncProcess` | How the preview examples and production implementation stay in sync, such as a documented XAML-to-design update process. |
| `authority.portOverrides[]` | Exceptions for a particular `area` or \\`components[]\\`. An override uses the same port fields, so a chat surface can ship with [Reactor](https://github.com/microsoft/microsoft-ui-reactor) while the rest of an app ships natively. |

For example, a native app can keep Colophon as its shared design source while
explicitly directing agents to the implementation that ships:

```json
{
  "authority": {
    "designSource": "self",
    "owner": "@contoso/design-systems",
    "syncProcess": "Review preview and WinUI changes together in every UI PR.",
    "port": {
      "authoritySource": "Native WinUI 3 / C#",
      "syncSource": "microsoft/win-dev-skills",
      "helperAgent": "win-dev-skills",
      "owner": "@contoso/windows-ui"
    },
    "portOverrides": []
  }
}
```

With no `port` or overrides, `design.json` and `components.jsonc` remain the framework-agnostic design contract and an agent implements that contract in the repository's chosen production technology. With a port target, the skill, injected context, and managed `AGENTS.md` pointer tell agents what is canonical, what reference to use, and what **not** to copy verbatim. This keeps the canvas useful without turning `components.jsonc` into a competing source of production code.

### 2. The canvas renders + edits it
Open the **Design System** canvas to see the system rendered live:
- **Design system** - Brand board, color palette, type scale, spacing/radii/shadows, principles.
- **Live component previews** — `components.jsonc` is rendered by a small pure JSON→DOM interpreter (no framework runtime, works offline) using the system's own tokens, so you see real UI, not just code.
- **Inline editing** — change a color/font/brand text and **Save to repo** writes`design.json` back. File edits stream back into the canvas via SSE.
If a repo has no `.agents/design/` yet, the canvas shows a bundled **starter** system plus a 3-way **onboarding** panel (below).

### 2b. Seeding a repo — three ways
When there's no `.agents/design/`, choose how to start; refine everything in the canvas after.
| Mode | What it does |
| --- | --- |
| **Start fresh** | *Bundled starter* (the "Northlight" system) or a *blank skeleton* (grayscale + one accent, system fonts). Writes immediately. |
| **Import tokens** | Point at a repo-relative `.json` path or paste token JSON. Adapts our schema, flat `{name:hex}`, nested Tailwind / Style-Dictionary (`colors`/`fontFamily`/`spacing`/`borderRadius`), and W3C `{$value}` tokens. Loads as a **proposal** to refine, then Save. |
| **Scan codebase** | Walks the repo's CSS/JSX/styles and extracts colors (prefers named CSS vars), fonts, spacing, radii, shadows — classifying unnamed colors into ink/paper/accent. Loads as a **proposal** to refine, then Save. |

Starter/scratch write straight to `.agents/design/`; import/scan load an **unsaved proposal** with a review bar (**Save to repo** / **Discard**). Any first save also scaffolds `components.jsonc` + `principles.md`, and drops an idempotent **`AGENTS.md` pointer** at the repo root (see below).

### 2c. Seeding also writes an `AGENTS.md` pointer
When it seeds a repository, Colophon idempotently adds a managed `AGENTS.md` block—creating the file if needed—so agents load `.agents/design/` before UI work.

### 3. Copilot references it automatically (the skill + tool + hooks)
- **`colophon` skill** — instructs the agent, on any UI work, to read `.agents/design/`and generate UI from its tokens, components, and principles (not ad-hoc styles).
- **`colophon` tool** — the agent calls it to get the system as text before UI work.`init=true` scaffolds `.agents/design/` from the starter; `scan=true` proposes one from the repo's existing UI when none exists yet.
- **Hooks** — when a repository contains `.agents/design/design.json`, `onSessionStart`announces the system exists and `onUserPromptSubmitted` detects UI-related prompts ("build a settings page", "fix the button styling") to inject it. Repositories without an initialized design system receive no Colophon prompt context; use the canvas or`colophon` tool explicitly to seed one.

### 4. Prototype canvas: click-through mockups from the design system
A second canvas turns the design system into **click-through prototypes** — so a team can shape a flow by talking to Copilot instead of redlining in Figma, review it visually, then convert a screen to code.

- **Format** — prototypes live at `.agents/design/prototypes.jsonc`: a framework-agnostic **scene graph** (layout primitives + references to your `components.jsonc` by name + **navigation as data**), never shipping code. It's pure data, so it renders safely and Copilot can patch a single node by id without rewriting the file. Every save re-emits a stable, key-ordered file plus a Markdown flow outline for painless PR review.
- **Device frames** — preview each screen in web breakpoints, desktop-app windows (Windows/WinUI, macOS), mobile (iPhone/Android), and tablet — selectable, rotatable, with custom sizes and a zoom-to-fit — like Chrome DevTools' device toolbar, but including native app chrome.
- **Interactions (v1)** — navigate between screens, simple state (toggles, tabs), open/close modals, and visibility bound to state. Click through it live in the canvas, rendered with your real tokens + components in Light/Dark/High-contrast.
- **Convert to code** — a first-pass `codegen` action turns the JSONC scene graph and component intent into code for the configured production target. The current web target emits React/JSX using `ds-*` conventions; a native port target emits a hand-off scaffold and porting notes for WinUI/SwiftUI through the same authority mechanism.
- **`prototype` tool** — Copilot authors and reads prototypes from conversation: `action` of `read` (flow outline), `validate` (dangling navigation / unknown components or tokens), `patch` (surgical scene-graph ops), `codegen` (convert a screen), `export`(standalone browser artifact), or `publish` (explicit GitHub Pages deployment).

### Sharing a design system or prototype

| Audience | Share this | What they need |
| --- | --- | --- |
| Designers and developers | Commit `.agents/design/` and open a pull request | Repository access; they can open the Colophon and Prototype canvases in Copilot. |
| Someone continuing the agent work | Share the Copilot agent session from the repository's **Agents** view | Repository access. A session is useful for context and hand-off, not as a public presentation. |
| Stakeholders and reviewers | Use **Export** in the Prototype canvas | The generated `.agents/design/prototype-export/index.html` is a self-contained, interactive file that opens in any modern browser. |
| A broad browser audience | Use **Publish** in the Prototype canvas | GitHub authentication with repository admin access. Colophon writes only its generated file to `gh-pages` and opens the resulting GitHub Pages URL. |
| A team adopting the canvas extension | Share the extension as a private GitHub gist | The recipient can install the gist through Copilot, then open it in their own workspace. |

**Export** is the safe default: it preserves screens, device frames, themes, click-through interactions, and component rendering without a Copilot session, a loopback server, or an internet connection. **Publish** is intentionally separate and asks for confirmation. It uses the authenticated GitHub CLI/API, never stages or commits the active working tree, and refuses to overwrite a GitHub Pages configuration that is not already based on `gh-pages`.

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
````javascript
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

## Installation and team setup

Colophon is a Copilot plugin **and** its own marketplace, so there are a few ways in.

**Install it as a plugin (recommended — includes the skill and both canvases):**
```bash
copilot plugin install karkarl/colophon
```

**Or register Colophon's marketplace, then install by name:**
```bash
copilot plugin marketplace add karkarl/colophon
copilot plugin install colophon@colophon
```

Restart or reload Copilot after installation, then open the **Colophon** or
**Prototype** canvas in the workspace.

**Configure it for a team:** declare the plugin in the repository's
`.github/copilot/settings.json` through the `enabledPlugins` field and commit that
file. Each teammate also needs repository access and a Copilot environment that
supports plugins. Use `~/.copilot/settings.json` instead to enable it across all of
your own repositories.

**Install only the canvas extension (no skill):** the extension lives in
`extensions/colophon/`. Install that subdirectory into
`~/.copilot/extensions/colophon/`, or point the `install_extension` tool at
`https://github.com/karkarl/colophon/tree/main/extensions/colophon`.

The standalone extension is useful for canvas-only evaluation. Prefer the plugin for
normal use because it also provides the UI-design skill and automatic design-system
context.

## License

MIT — see [LICENSE](./LICENSE).
````
