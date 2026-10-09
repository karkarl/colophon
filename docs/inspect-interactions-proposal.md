# Colophon Inspect: direct manipulation proposal

## Evidence and limits

Research date: 8 October 2026. This analysis uses Figma's public help pages, not
an authenticated Figma session or access to private designs. Documentation can
differ from a staged rollout. Exact animation timing, hit regions, and drop
outline styling have not been measured in the live app.

Figma is a reference for interaction semantics, not a visual skin to copy.
Colophon remains an editor of relational, token-bound component definitions.
Northlight owns the typography, spacing, surfaces, voice, and action colors.

## Feature analysis and Colophon mapping

| Area | Figma behavior and source | Current Colophon | Proposed port |
| --- | --- | --- | --- |
| Workspace | Layers on the left; contextual properties on the right. Frame presets are in the right sidebar. [1], [2], [3] | Layers left, Properties/JSON right, plus a page index that consumes canvas space. | Retain familiar defaults; allow properties on the left. Remove the extra page index from the component editing workspace, not from browsing. |
| Creation | Toolbar tools create frames, text, shapes, images, and vectors. Text supports click for auto-sized text or drag for fixed bounds; frames support click, draw, presets, and duplication. [1], [2] | Existing layers can be edited/duplicated, but there is no structured insert flow. | Add a shared bottom toolbar for Move, Frame, Shapes, and Text, with click/default sizing and drag-to-create. Keep existing component instances in a sidebar picker. Preserve stable IDs, token references, and reusable components. |
| Selection | Canvas and Layers selections are synchronized. Figma selects a containing group first, supports double-click/Enter to descend, modifier deep-select, and Shift+Enter to ascend. Layer hover highlights its canvas bounds. [3] | Click selects an exact rendered source path. Native CSS hover can outline multiple ancestors. | Preserve Colophon's exact-source selection rather than silently changing its meaning. Highlight only the closest hovered source, synchronize layer hover, add parent navigation and a persistent selection frame. |
| Resizing | Edge/corner handles and W/H fields resize a frame; constraints and Auto Layout affect its children. Aspect-ratio locking is distinct from scaling. [2], [4] | W/H fields accept fixed, hug, and fill; no direct resize handles. | Add east, south, and southeast handles. Dragging changes only the requested axes to fixed pixels; Shift on the corner preserves aspect ratio. Do not rewrite text, spacing, or child dimensions. |
| Scaling | K activates Scale. Figma proportionally scales geometry, nested layers, strokes, and effects, bypassing constraints. Multiplier, dimensions, and anchor control are available. [5] | No scale operation. The schema intentionally references shared type/radius/shadow tokens. | Provide explicitly named **Scale geometry**: multiply fixed dimensions and descendant absolute positions; freeze the selected root's measured dimensions. Preserve typography, effects, token-bound spacing, and the root's position. Never present this as full Figma Scale. |
| Viewport | Hand and Scale are separate tools; holding Space temporarily activates Hand. [1] | Scrollable component gallery without zoom controls. | Preview zoom presets (50-200%) change the viewport only; scrolling remains native. Pointer geometry is converted back to document coordinates. Infinite pan and hand-tool gestures are a later stage. |
| Drag feedback | Moving/adding objects can reparent into frames; Figma's parenting decision considers bounds and can be bypassed with Space. Layer hover and selection use bounding-box cues. [3], [6] | Tree drag has before/after/inside cues; freeform dragging changes X/Y only. | Extend tree and palette drops to rendered previews. Show a blue destination outline for containment, an insertion line for before/after, and a textual destination label. The proposed blue *drop* cue follows the requested interaction; the cited pages do not establish its exact current live styling. |
| Structure | Frames can nest; component instances have restrictions on editing internals. [2], [4], [5] | Element trees and component references already retain source identity. | Accept drops only into child-capable HTML containers or valid sibling positions. Reject roots, cycles, void elements, cross-definition moves, and recursive component references before showing a valid preview. Instance insertion creates a reference, not a detached copy. |
| Auto Layout | Horizontal, vertical, grid, padding, gap, hug/fill/fixed, and ignore-layout positioning are distinct concepts. [4] | Token-backed vertical/horizontal/grid/freeform layouts, sparse appearance overrides, margin controls. | Reuse existing controls. Moving from freeform to flow removes stale absolute positioning; inserting into a freeform parent writes parent-relative coordinates. Do not invent CSS that conflicts with the document model. |
| Properties | The panel changes with selection; dimensions and layout are not the same as fill, stroke, and effects. [2], [4], [5] | Layer identity, Layout, Freeform position, Appearance, and Outer spacing sections. | Keep those sections, add editable literal text, geometry scale, and an accessible dock toggle. Keep exact JSON and Send to chat. |
| Recovery | Direct manipulation needs reversible, predictable edits. | Draft graph, validation, undo/redo, explicit save already exist. | One completed gesture is one history entry. Escape, pointer cancellation, blur, and leaving Inspect cancel active gestures. Hover and zoom never dirty the graph. Invalid mutations surface an error and preserve the prior draft. |
| Larger Figma surface | Vectors, image fills, comments, annotations, Dev Mode, plugins, AI actions, and prototyping are separate tool families. [1] | Colophon has its own Prototype canvas and agent handoff. | Do not recreate an illustration suite, cloud collaboration service, or proprietary file importer inside Inspect. Keep prototype navigation and publishing in the Prototype canvas. |

## Interaction contract

The first delivery is a complete component-editing slice, not Figma parity:

1. Use the shared bottom toolbar's Move (V), Frame (F), Shape tools
   (Rectangle R / Ellipse O / Line L / Arrow Shift+L), Text (T), and Add components.
   The latter searches the current design system and inserts reusable instances.
   Select a creation mode, then click a
   preview layer for default geometry or drag in either direction to set bounds.
   Shift constrains frames/area shapes to a square/circle and lines/arrows to
   45-degree directions. Arrowheads follow the release endpoint. Enter inserts into the
   current selection; Escape cancels. Completion returns to Move and Text focuses
   its property input. Component instances remain in a separate sidebar picker
   with click insertion and drag/drop. A selected leaf inserts a sibling.
2. Drag an existing layer from the Layers panel to a rendered target. The
   preview identifies the target and exact operation before release. Central
   container drops mean inside; edge drops mean before/after along the parent's
   layout axis. Freeform movement stays within its current parent; intentional
   reparenting uses the Layers drag.
3. Resize with visible handles at any supported zoom. Only a successful release
   changes the draft. Shift preserves the corner aspect ratio. Numeric W/H
   controls remain the non-pointer alternative.
4. Scale geometry using a positive multiplier. The panel explains that type,
   spacing, radii, and effects stay token-bound. This is intentionally less broad
   than Figma's K tool.
5. Move the properties panel left when preferred. At narrow widths, use a single
   left rail with vertically stacked Layers/Properties and a horizontally
   scrollable editing area instead of overlapping fixed sidebars.
6. Undo, redo, edit exact JSON, send a selection to chat, and save/reload without
   changing the design authority or silently publishing anything.

## Visual language

Reuse Field, SubtlePicker, and Button interaction patterns: quiet labeled
controls, restrained hover surfaces, clear focus outlines, and one prominent
save action. Selected editor buttons use neutral black app chrome, never the
sample design's orange accent. No nested-card chrome. New control spacing, typography, radii,
and surfaces reference Northlight tokens.

Add one semantic `selection` color to DESIGN.md with light, dark, and
high-contrast values. Blue denotes editor geometry only: hover bounds,
selection handles, valid destination outline, insertion line. It is not a
second brand/action accent, a component fill, or a saved appearance override.
Use line styles, handles, and destination text so feedback is not color-only.

## Architecture

Keep graph operations pure in `componentsio.mjs`; reuse them for tree and canvas
drop validation and mutation. Add the direct-manipulation controller as a
classic browser script alongside `client.js`, using the existing commit,
selection, rendering, and history functions. Overlays live outside preview DOM
so they neither resize component layouts nor enter saved component JSON.

No new runtime dependency or document version is needed. New object layers get
unique IDs; geometry edits use the existing v3 fixed-pixel representation.
The click-through prototype documents the flow, not executable editor behavior.
Use the repository's vanilla DOM implementation rather than copying generated
React scaffolding into the extension.

The Prototype port reuses `editor-workspace.js`, `editor-geometry.js`, the
workspace shell fragments, and `inspect-workspace.css`. Small document adapters
map component `layout.width/height` to prototype `width/height` and route edits
through each editor's existing transactions. Prototype instance props,
navigation, device frames, Fit zoom, and standalone exports remain intact.
Screens navigation moves into a collapsible Layers section while inspecting.
The toolbar and draw gesture also live in this shared controller. Their temporary
bounds never enter the document until release. `shape: "rectangle" | "ellipse" | "line" | "arrow"`
marks primitive leaves; ellipse geometry renders at a true 50% radius in the
component interpreter, standalone runtime, Prototype layout helper, and codegen.
It is not a rounded-pill token approximation. `shape-geometry.js` shares line
and arrow SVG paths, normalized endpoints, validation, and styles across all
renderers and codegen. Flow containers retain flow
semantics when drawing; freeform parents receive parent-relative coordinates.

## Acceptance criteria

- Insert each supported kind, reject recursive references and invalid parents,
  and retain unrelated siblings and stable IDs.
- Validate a drop before displaying a destination. Dropping on an invalid
  target or cancelling leaves the document and history unchanged.
- Tree-to-canvas moves preserve identity, cannot cross definitions, and convert
  flow/freeform positioning correctly.
- At 50%, 100%, and 200%, a 20-document-pixel resize produces the same W/H delta.
  Resizing does not scale typography or unrelated child dimensions.
- Geometry scaling is bounded, finite, atomic, and preserves design tokens.
- Escape/cancel/blur leave no stale overlays or partial edits. Undo/redo and
  save/reload retain completed edits.
- Tool changes, menus, hover, zoom, panel docking, and focus do not create edits.
- Draw each primitive at 50%, 100%, and 200%, including reverse drags, Shift
  constraints, default-size clicks, keyboard insertion, and all cancellation
  paths. A successful gesture is exactly one undo step.
- Existing live preview interactions still work outside Inspect; all three
  design preview themes remain readable.

## Later stages (not claimed in this delivery)

True token-aware whole-subtree scaling requires an explicit decision about
local versus shared token overrides. Multi-select, marquee selection, snapping
guides, infinite canvas pan, rotation, locks/visibility, layer
search/collapse, image import, and vector authoring also need separate graph and
interaction contracts. These should not be simulated with CSS-only transforms
that disagree with saved JSON.

## Primary sources

[1]: https://help.figma.com/hc/en-us/articles/360041064174-Access-design-tools-from-the-toolbar
[2]: https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design
[3]: https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects
[4]: https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout-in-Figma
[5]: https://help.figma.com/hc/en-us/articles/360040451453-Scale-layers-while-maintaining-proportions
[6]: https://help.figma.com/hc/en-us/articles/360039959014-Parent-child-and-sibling-relationships
