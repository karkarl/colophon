export function renderInsertPalette() {
  return `<details id="insert-palette" class="insert-palette">
    <summary>Components</summary>
    <p>Insert an instance into the selection, or drag it onto the canvas.</p>
    <div id="insert-items" class="insert-items"></div>
  </details>`;
}
const icons = {
  move: '<path d="m5 3 14 9-7 1-3 7z"/>',
  frame: '<path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>',
  rectangle: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  line: '<path d="m4 20 16-16"/>',
  arrow: '<path d="m4 20 16-16M9 4h11v11"/>',
  components: '<path d="m12 3 4 4-4 4-4-4zm-5 5 4 4-4 4-4-4zm10 0 4 4-4 4-4-4zm-5 5 4 4-4 4-4-4z"/>',
  text: '<path d="M4 6V4h16v2M12 4v16M8 20h8"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
export function renderCreationToolbar() {
  const button = (kind, label, shortcut, selected = false) => `<button type="button" class="creation-tool" data-tool="${kind}" data-toolbar-control
    aria-label="${label}" title="${label} (${shortcut})" aria-keyshortcuts="${shortcut}" aria-pressed="${selected}" tabindex="${selected ? 0 : -1}">${icon(kind)}</button>`;
  return `<div id="creation-toolbar-position" hidden>
    <div id="creation-toolbar" role="toolbar" aria-label="Canvas tools" aria-orientation="horizontal" aria-describedby="creation-tool-help">
      ${button("move", "Move", "V", true)}
      ${button("frame", "Frame", "F")}
      <div class="shape-tool-group">
        <button type="button" id="shape-tool-btn" class="creation-tool" data-toolbar-control data-tool="rectangle" aria-label="Rectangle" title="Rectangle (R)" aria-keyshortcuts="R" aria-pressed="false" tabindex="-1">${icon("rectangle")}</button>
        <button type="button" id="shape-menu-btn" class="shape-menu-toggle" data-toolbar-control aria-label="Shape tools" title="Shape tools" aria-haspopup="menu" aria-controls="shape-tools-menu" aria-expanded="false" tabindex="-1">${icon("chevron")}</button>
      </div>
      ${button("text", "Text", "T")}
      <button type="button" id="component-menu-btn" class="creation-tool" data-toolbar-control aria-label="Add components" title="Add components" aria-haspopup="dialog" aria-controls="component-tools-menu" aria-expanded="false" tabindex="-1">${icon("components")}</button>
    </div>
    <div id="shape-tools-menu" role="menu" aria-label="Shape tools" hidden>
      <button type="button" role="menuitemradio" data-shape="rectangle" aria-checked="true" tabindex="-1">${icon("rectangle")}<span>Rectangle</span><kbd>R</kbd></button>
      <button type="button" role="menuitemradio" data-shape="ellipse" aria-checked="false" tabindex="-1">${icon("ellipse")}<span>Ellipse</span><kbd>O</kbd></button>
      <button type="button" role="menuitemradio" data-shape="line" aria-checked="false" tabindex="-1">${icon("line")}<span>Line</span><kbd>L</kbd></button>
      <button type="button" role="menuitemradio" data-shape="arrow" aria-checked="false" tabindex="-1">${icon("arrow")}<span>Arrow</span><kbd>Shift L</kbd></button>
    </div>
    <div id="component-tools-menu" role="dialog" aria-label="Add components" aria-describedby="component-tools-help" hidden>
      <input id="component-search" type="search" aria-label="Search components" placeholder="Search components" autocomplete="off" />
      <p id="component-tools-help">Insert into the selection, or beside a leaf.</p>
      <div id="component-search-results" class="insert-items"></div>
      <p id="component-search-status" role="status" aria-live="polite"></p>
    </div>
    <span id="creation-tool-help" class="inspect-sr-only">V: Move. F: Frame. R: Rectangle. O: Ellipse. L: Line. Shift+L: Arrow. T: Text. Choose a tool, then click or drag on a layer to create. Enter inserts into the selection. Escape returns to Move.</span>
  </div>`;
}
export function renderWorkspaceControls({ zoom = true } = {}) {
  return `<div class="inspect-view-controls">
    ${zoom ? `<label>Zoom <select id="inspect-zoom" aria-label="Canvas zoom">
      <option value="0.5">50%</option><option value="0.75">75%</option>
      <option value="1" selected>100%</option><option value="1.5">150%</option><option value="2">200%</option>
    </select></label>` : ""}
    <button type="button" id="select-parent-btn" class="btn" disabled>Parent</button>
  </div>`;
}
export function renderWorkspaceOverlays() {
  return `<div id="inspect-overlays" hidden>
    <div id="inspect-hover-box" class="inspect-bounds hover-bounds" hidden></div>
    <div id="inspect-selection-box" class="inspect-bounds" hidden>
      <span id="inspect-measurement" class="inspect-measurement"></span>
      <button type="button" class="resize-handle" data-resize="e" aria-label="Resize width" title="Drag to resize width; use Width in Properties for keyboard editing"></button>
      <button type="button" class="resize-handle" data-resize="s" aria-label="Resize height" title="Drag to resize height; use Height in Properties for keyboard editing"></button>
      <button type="button" class="resize-handle" data-resize="se" aria-label="Resize width and height" title="Drag to resize; Shift preserves aspect ratio"></button>
    </div>
    <div id="inspect-drop-box" class="inspect-bounds drop-bounds" hidden><span id="inspect-drop-label" class="inspect-measurement"></span></div>
    <div id="inspect-create-box" class="inspect-bounds create-bounds" hidden><span id="inspect-create-size" class="inspect-measurement"></span></div>
  </div>
  ${renderCreationToolbar()}
  <div id="inspect-announcement" class="inspect-sr-only" role="status" aria-live="polite"></div>`;
}
